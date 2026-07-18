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
    for k in FRONT.get(commodity,[]):
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
        if prev:
            cpct=round((close-prev)/prev*100,4)
            if pct is not None and abs(float(pct)-cpct)>PCT_TOL:
                FAIL("math","%s pctChange=%s but (close-open)/open=%.4f"%(key,pct,cpct))
        if net is not None and abs(float(net)-(close-prev))>max(0.02,abs(close)*0.0005):
            FAIL("math","%s netChange=%s but close-open=%.4f"%(key,net,close-prev))
        band=band_for(key)
        if band and not (band[0]<=close<=band[1]):
            FAIL("band","%s close %s outside %s band %s (unit/decimal/contamination?)"%(key,close,band))
        if q.get("stale"):
            WARN("stale","%s is preserved-stale since %s"%(key,q.get("stale_since")))

    # 2) THE BIG ONE: reconcile continuous alias vs dated front-month
    for commodity in FRONT:
        cont=quotes.get(commodity)
        if not cont or cont.get("close") is None: continue
        fk=front_key(commodity, quotes, today)
        if fk is None:
            FAIL("no-front","%s: continuous alias present but NO usable dated front-month to verify against"%commodity)
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

    passed = not any(s=="FAIL" for s,_,_ in issues)
    return passed, issues, data

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("path", nargs="?", default="data/prices.json")
    ap.add_argument("--repair", action="store_true")
    ap.add_argument("--out")
    a=ap.parse_args()
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
