#!/usr/bin/env python3
"""
preflight_prices.py — deterministic feed gate for AGSIST Daily.
Runs AFTER fetch_prices.py, BEFORE generate_daily.py.

Root problem it solves (June 23 2026): yfinance's CONTINUOUS front-month tickers
(ZC=F/ZS=F/ZW=F) splice across the contract roll, so "corn" came back close=437.0
(December's value) spliced onto prev=412.5 (July's) => a fake +5.94% that the
generator locked and the LLM critic happily verified against itself.

Fix: reconcile each continuous alias against the real DATED front-month contract
in the same feed. If they disagree beyond tolerance, REPAIR the alias to track the
dated contract (the truth), tag it, and keep the original under _orig. If a
contaminated alias has no usable dated fallback -> HARD FAIL (exit 1): better to
skip a send than ship a fabricated move.

SECOND HOLE, found 2026-08-08 — the reason this file needs part (2b) and (3):
the reconciliation above compared ONLY `close`. By the time the Saturday feed was
pulled, Yahoo had already rolled the corn close to September (439.00) but was
still carrying December's Thursday settle (464.25) in `open`. Close matched the
dated contract exactly, rel==0, so this gate returned CLEAN -- and the briefing
published "corn fell hard to $4.39, down 5.4%" when September corn was down 2.75
cents (-0.62%). Same shape on beans (-28.00 published vs -1.00 real) and cattle
(+6.50 vs +0.40). A matching close does NOT mean a clean quote; the prior close
has to be reconciled too. That is (2b).

And (3): hogs, oats, milk and soyoil have NO dated contracts in this feed, so
there is nothing to reconcile them against. On 2026-08-08 `hogs` printed +13.825
/cwt -- 2.9x the CME expanded daily limit of $7.00, i.e. a move that cannot have
traded. Across the archive the same instrument shows 16 such impossible moves
since April, mostly landing on Saturday, oscillating between two contracts. The
exchange daily limit is an absolute physical bound and needs no reference
contract, so it catches exactly the cases (2) and (2b) cannot see.

Modes:  --check  (report only, exit 1 if would-block)   --repair  (rewrite file)
Schema note: in prices.json the field "open" actually holds PREVIOUS CLOSE.
"""
import json, sys, argparse, math
from datetime import datetime, timezone

from contract_calendar import is_expired   # ONE definition of contract expiry

# continuous alias -> ordered dated front-month candidates (calendar order)
FRONT = {
 "corn":  ["corn-jul26","corn-sep26","corn-dec","corn-mar27","corn-may27","corn-jul27","corn-dec27"],
 "beans": ["beans-jul26","beans-aug26","beans-sep26","beans-nov","beans-jan27","beans-mar27","beans-jul27","beans-nov27"],
 "wheat": ["wheat-jul26","wheat-sep26","wheat-dec26","wheat-mar27","wheat-jul27","wheat-dec27"],
 "cattle":["cattle-aug26","cattle-oct26","cattle-dec26","cattle-feb27","cattle-apr27","cattle-jun27"],
}
# Curves added 2026-08-08 for the products that had none -- the reason the
# 16.9% lean hog "rally" had nothing to be checked against. Same treatment as
# FRONT, with ONE difference: if the whole curve is missing from the feed, that
# is a WARN rather than a hard block. The symbols have not yet been confirmed
# against a live Yahoo response, and a typo in a ticker must not be able to stop
# the briefing going out. The exchange-limit gate below still covers these
# instruments in the meantime.
# PROMOTE INTO `FRONT` once a full session runs with no SKIP/LOST on these keys;
# then a missing curve becomes the hard failure it should be.
FRONT_OPTIONAL = {
 "hogs":   ["hogs-aug26","hogs-oct26","hogs-dec26","hogs-feb27","hogs-apr27","hogs-jun27"],
 "feeders":["feeders-aug26","feeders-sep26","feeders-oct26","feeders-nov26","feeders-jan27","feeders-mar27"],
 "oats":   ["oats-sep26","oats-dec26","oats-mar27","oats-may27"],
 "meal":   ["meal-aug26","meal-sep26","meal-oct26","meal-dec26","meal-jan27","meal-mar27"],
 "soyoil": ["soyoil-aug26","soyoil-sep26","soyoil-oct26","soyoil-dec26","soyoil-jan27","soyoil-mar27"],
 "milk":   ["milk-aug26","milk-sep26","milk-oct26","milk-nov26","milk-dec26","milk-jan27"],
}
ALL_FRONT = {**FRONT, **FRONT_OPTIONAL}
_MON={'jan':1,'feb':2,'mar':3,'apr':4,'may':5,'jun':6,'jul':7,'aug':8,'sep':9,'oct':10,'nov':11,'dec':12}
# new-crop benchmark aliases that are themselves dated (not continuous) -> trusted
DATED_ALIASES={"corn-dec","beans-nov"}

# plausibility bands in each instrument's native quote unit (catches unit/decimal/contamination)
BAND_BY_KEY={
 'cattle':(90,360),'feeders':(200,450),'hogs':(40,160),'milk':(8,40),
 'meal':(150,600),'soyoil':(20,120),'oats':(150,800),
 'crude':(15,200),'natgas':(1,30),
 'gold':(2000,9000),'silver':(10,200),
 'dollar':(80,130),'treasury10':(1,10),'sp500':(1000,15000),
 'bitcoin':(10000,300000),'ripple':(0.05,10),'kaspa':(0.001,5),
}
def band_for(key):
    if key in BAND_BY_KEY: return BAND_BY_KEY[key]
    for p in ('corn','beans','wheat'):           # grains + their dated curve keys
        if key==p or key.startswith(p+'-'): return (150,1800)
    if key.startswith('cattle-'): return (90,360)
    return None

# CME/CBOT EXPANDED daily price limits, in each key's NATIVE prices.json unit.
# Expanded (not initial) on purpose: this gate should fire only on moves that are
# physically impossible, never on a merely large day. A move at exactly the limit
# is legal, so the test is strictly greater-than.
# Source: https://www.cmegroup.com/trading/price-limits.html  (read 2026-08-08,
# table effective trade date 2026-08-10). CME resets these semi-annually — recheck
# each February and August; a limit that drifts too WIDE only makes this gate
# quieter, never wrong, so a stale table cannot produce a false block.
LIMIT_EXPANDED = {
 # grains quoted in CENTS per bushel
 'corn': 45.0, 'beans': 130.0, 'wheat': 70.0, 'kcwheat': 70.0, 'oats': 40.0,
 # soy products
 'meal': 30.0,        # $ per short ton
 'soyoil': 7.0,       # cents per pound
 # livestock + dairy quoted in $ per hundredweight (= cents per pound)
 'cattle': 12.75, 'feeders': 16.00, 'hogs': 7.00, 'milk': 1.50,
}
# Energy, metals, FX, rates and crypto have no fixed daily limit (they use
# circuit breakers or none at all) -> deliberately absent, so they are skipped.

def limit_for(key):
    """Expanded daily limit for a key, or None if the instrument has no limit.
    Dated curve keys inherit their parent's limit (corn-sep26 -> corn)."""
    if key in LIMIT_EXPANDED: return LIMIT_EXPANDED[key]
    base = key.split('-', 1)[0]
    return LIMIT_EXPANDED.get(base)

REL_TOL = 0.004        # 0.4% — continuous vs dated must agree this tightly
PCT_TOL = 0.06         # stored pctChange vs recomputed (pct points)

def _expired(key, today):
    """Delegates to contract_calendar — the single definition of this rule.

    Kept as a thin wrapper so existing call sites are untouched. Previously this
    held its own copy of the rule, and generate_daily.py held a DIFFERENT copy.
    They disagreed on the 15th of every contract month and blocked the send.
    """
    return is_expired(key, today)


def front_key(commodity, quotes, today):
    for k in ALL_FRONT.get(commodity,[]):
        q=quotes.get(k)
        if not q or q.get("close") is None: continue
        if q.get("stale"): continue
        if _expired(k, today): continue
        return k
    return None

def run(data, today=None, repair=False):
    today=today or datetime.now(timezone.utc)
    quotes=data.get("quotes",{})
    issues=[]   # (sev, code, msg)
    def FAIL(c,m): issues.append(("FAIL",c,m))
    def WARN(c,m): issues.append(("WARN",c,m))
    def REPAIR(c,m): issues.append(("REPAIR",c,m))

    # 1) per-quote internal math + bands
    for key,q in quotes.items():
        if not q or q.get("close") is None: continue
        close=float(q["close"]); prev=float(q.get("open", close))
        net=q.get("netChange"); pct=q.get("pctChange")
        # netChange/pctChange are DERIVED: fetch_prices stores "open" as the prior
        # close and defines net = close - open, pct = net/open*100, so the identity
        # must hold. On 2026-08-10 the feed returned a live, moving close for soyoil
        # alongside net/open frozen at 0.78/67.46 all session — the identity broke on
        # every refresh where close != 68.24, GATE 1 blocked 9 of 12 price commits, and
        # Monday's briefing never generated. Blocking the presses over a field we can
        # recompute exactly is the wrong trade; trusting the stale net would publish a
        # WRONG day-change, which is worse. In --repair mode, re-derive from close and
        # open (both real observed values, using the pipeline's own formula) and say so
        # in the log. Bare check mode still FAILs, so CI and the selftests stay strict.
        cnet=round(close-prev,5) if prev else None
        cpct=round((close-prev)/prev*100,4) if prev else None
        pct_bad = bool(prev) and pct is not None and abs(float(pct)-cpct)>PCT_TOL
        net_bad = net is not None and cnet is not None and abs(float(net)-cnet)>max(0.02,abs(close)*0.0005)
        if pct_bad or net_bad:
            if repair:
                q["netChange"]=cnet; q["pctChange"]=cpct
                q["derived_recomputed"]=True
                REPAIR("math","%s derived fields were stale (net=%s pct=%s) -> recomputed net=%.4f pct=%.4f from close=%.4f open=%.4f"
                       %(key,net,pct,cnet,cpct,close,prev))
            else:
                if pct_bad:
                    FAIL("math","%s pctChange=%s but (close-open)/open=%.4f"%(key,pct,cpct))
                if net_bad:
                    FAIL("math","%s netChange=%s but close-open=%.4f"%(key,net,close-prev))
        band=band_for(key)
        if band and not (band[0]<=close<=band[1]):
            # 4 placeholders, 3 args before this fix: the one path that MUST report
            # honestly (unit/decimal/contamination) raised TypeError instead, and in
            # repair mode died before writing the repaired feed.
            FAIL("band","%s close %s outside band %s (unit/decimal/contamination?)"%(key,close,band))
        if q.get("stale"):
            WARN("stale","%s is preserved-stale since %s"%(key,q.get("stale_since")))

    # 2) THE BIG ONE: reconcile continuous alias vs dated front-month
    for commodity in ALL_FRONT:
        cont=quotes.get(commodity)
        if not cont or cont.get("close") is None: continue
        fk=front_key(commodity, quotes, today)
        if fk is None:
            msg=("%s: continuous alias present but NO usable dated front-month to verify against"
                 %commodity)
            if commodity in FRONT:
                FAIL("no-front",msg)
            elif any(k in quotes for k in FRONT_OPTIONAL[commodity]):
                # the curve IS fetched but every contract is expired or stale --
                # a real problem, and one the annual ticker roll causes
                FAIL("no-front",msg+" (curve is present but fully expired/stale -- roll the tickers)")
            else:
                # curve never arrived: unconfirmed symbols, not a reason to stop
                # the briefing. The exchange-limit gate still covers this key.
                WARN("no-front",msg+" (optional curve absent; limit gate still applies)")
            continue
        f=quotes[fk]
        c_close=float(cont["close"]); f_close=float(f["close"])
        rel=abs(c_close-f_close)/f_close if f_close else 1
        if rel>REL_TOL:
            # contamination: continuous spliced across a roll. Repair to the dated truth.
            msg=("%s continuous (%s) close=%.4f disagrees with dated front %s (%s) close=%.4f by %.2f%%"
                 %(commodity, cont.get("ticker"), c_close, fk, f.get("ticker"), f_close, rel*100))
            if repair:
                orig={k:cont.get(k) for k in ("ticker","close","open","netChange","pctChange")}
                cont.update({"close":f["close"],"open":f.get("open"),
                             "netChange":f.get("netChange"),"pctChange":f.get("pctChange"),
                             "repaired_from":fk,"repair_reason":"continuous-roll-contamination","_orig":orig})
                REPAIR("contamination",msg+"  -> repaired to track "+fk)
            else:
                FAIL("contamination",msg)
            continue

        # 2b) Close agrees -- now reconcile the PRIOR close. Yahoo rolls `close` to
        # the new front month a session before it rolls the reference it measures
        # against, so a quote can carry the right price and an invented move. This
        # is the 2026-08-08 defect: corn close 439.00 == corn-sep26 439.00 (rel 0,
        # passed above) on an `open` of 464.25, which was December's settle, for a
        # published -5.4% against September's real -0.62%.
        c_prev=cont.get("open"); f_prev=f.get("open")
        if c_prev is None or f_prev is None: continue
        c_prev=float(c_prev); f_prev=float(f_prev)
        prel=abs(c_prev-f_prev)/f_prev if f_prev else 1
        if prel>REL_TOL:
            msg=("%s continuous (%s) close matches %s but PRIOR close=%.4f disagrees "
                 "with %s prior=%.4f by %.2f%% -- published move %s is measured across "
                 "two different contracts"
                 %(commodity, cont.get("ticker"), fk, c_prev, fk, f_prev, prel*100,
                   cont.get("netChange")))
            if repair:
                orig={k:cont.get(k) for k in ("ticker","close","open","netChange","pctChange")}
                cont.update({"open":f.get("open"),"netChange":f.get("netChange"),
                             "pctChange":f.get("pctChange"),
                             "repaired_from":fk,"repair_reason":"prior-close-roll-contamination",
                             "_orig":orig})
                REPAIR("prior-close",msg+"  -> change fields repaired from "+fk)
            else:
                FAIL("prior-close",msg)

    # 3) EXCHANGE DAILY LIMIT — an absolute bound that needs no reference contract.
    # This is the only check that can see hogs/oats/milk/soyoil, which have no dated
    # curve in this feed. A move beyond the expanded limit did not happen, so the
    # quote is not a price -- it is two contracts subtracted from each other.
    # Repair mode SUPPRESSES the quote rather than blocking the whole send: we do
    # not know what the real settle was, and the honest output is silence about
    # that instrument, not a number we cannot stand behind.
    for key in sorted(quotes):
        q=quotes[key]
        if not q or q.get("close") is None or q.get("open") is None: continue
        lim=limit_for(key)
        if lim is None: continue
        move=abs(float(q["close"])-float(q["open"]))
        if move<=lim: continue
        msg=("%s moved %.4f in one session against an exchange expanded daily limit "
             "of %.4f (%.1fx) -- close=%s prior=%s. That move cannot have traded."
             %(key, move, lim, move/lim, q.get("close"), q.get("open")))
        if q.get("repaired_from"):
            # already rebuilt from a dated contract and STILL over limit -> the
            # dated contract is bad too. Nothing left to trust.
            FAIL("limit", msg+"  (already repaired from %s)"%q["repaired_from"])
        elif repair:
            orig={k:q.get(k) for k in ("ticker","close","open","netChange","pctChange")}
            q.update({"close":None,"open":None,"netChange":None,"pctChange":None,
                      "suppressed":True,"suppress_reason":"exceeds-exchange-daily-limit",
                      "_orig":orig})
            data.setdefault("suppressed_keys",[]).append(key)
            REPAIR("limit",msg+"  -> suppressed (no dated contract to repair from)")
        else:
            FAIL("limit",msg)

    passed = not any(s=="FAIL" for s,_,_ in issues)
    return passed, issues, data

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("path", nargs="?", default="data/prices.json")
    ap.add_argument("--repair", action="store_true")
    # --check has been in this file's docstring since June but was never wired to
    # argparse, so `preflight_prices.py data/prices.json --check` exited 2 on an
    # unrecognized argument instead of running the gate. Report-only is already
    # the default; this makes the documented invocation work.
    ap.add_argument("--check", action="store_true",
                    help="report only, exit 1 if the feed would block (default)")
    ap.add_argument("--out")
    a=ap.parse_args()
    if a.check and a.repair:
        ap.error("--check and --repair are mutually exclusive")
    data=json.load(open(a.path))
    passed,issues,data=run(data, repair=a.repair)
    for s,c,m in issues: print(f"  [{s:6}] {c}: {m}")
    repaired=any(s=="REPAIR" for s,_,_ in issues)
    if a.repair and repaired:
        out=a.out or a.path
        json.dump(data, open(out,"w"), indent=2, allow_nan=False)
        print(f"  wrote repaired feed -> {out}")
    hard_fail = any(s=="FAIL" for s,_,_ in issues)
    print("RESULT:", "BLOCK ❌ (do not generate)" if hard_fail else ("REPAIRED ✅" if repaired else "CLEAN ✅"))
    sys.exit(1 if hard_fail else 0)

if __name__=="__main__":
    main()
