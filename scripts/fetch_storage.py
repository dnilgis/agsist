#!/usr/bin/env python3
"""fetch_storage.py — grain storage capacity vs what the state actually grew.

Probe-verified 2026-07-18 (probe-epic2 log), traps confirmed and handled:
  GRAIN STORAGE CAPACITY, OFF FARM - CAPACITY, MEASURED IN BU
  GRAIN STORAGE CAPACITY, ON FARM - CAPACITY, MEASURED IN BU
    STATE level; 2020+ rows are ALL reference_period_desc='FIRST OF DEC'
    (single ref period — we still pin it explicitly and say so).
    'OT' pseudo-state (= "other states", combined small states) EXCLUDED
    from rankings, kept in the national sum with a note.
  Production: reference_period_desc='YEAR' ONLY (probe shows AUG/SEP/OCT/NOV
    FORECAST rows living beside finals — the classic contamination).

THE PAGE'S PROMISE (was /storage-crunch; now the storage section of /basis): this state grew X bu of grain and has
Y bu of licensed+on-farm space — a crunch ratio, ranked, with history.
Grain = corn + soybeans + wheat + sorghum + barley + oats (page says exactly
this; soybeans are an oilseed but they sit in the same bins).

Output data/storage/storage.json:
  {generated, states:{ST:{cap:{year:[on,off]}, prod:{year:total_bu},
   ratio:{year: prod/cap_total}}}, national:{...}, latest_year}

Fail-loud: zero capacity rows or zero production rows exits 1.
--selftest offline, gates the workflow.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone

API = "https://quickstats.nass.usda.gov/api/api_GET/"
KEY = os.environ.get("NASS_API_KEY", "").strip()
OUT = "data/storage/storage.json"
FIRST_YEAR = 2000
CAP = {"on": "GRAIN STORAGE CAPACITY, ON FARM - CAPACITY, MEASURED IN BU",
       "off": "GRAIN STORAGE CAPACITY, OFF FARM - CAPACITY, MEASURED IN BU"}
CAP_REF = "FIRST OF DEC"
LAST_BY_CROP = {}   # short_desc -> {st: {yr: bu}}, filled by collect()
PROD = ["CORN, GRAIN - PRODUCTION, MEASURED IN BU",
        "SOYBEANS - PRODUCTION, MEASURED IN BU",
        "WHEAT - PRODUCTION, MEASURED IN BU",
        "SORGHUM, GRAIN - PRODUCTION, MEASURED IN BU",
        "BARLEY - PRODUCTION, MEASURED IN BU",
        "OATS - PRODUCTION, MEASURED IN BU"]


def api_get(params):
    q = dict(params)
    q["key"] = KEY
    q["format"] = "JSON"
    url = API + "?" + urllib.parse.urlencode(q)
    last = None
    for attempt, pause in enumerate((0, 45, 120, 300)):
        if pause:
            print(f"  NASS throttled — backoff {pause}s (retry {attempt}/3)", file=sys.stderr)
            time.sleep(pause)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "AGSIST/1.0 (+https://agsist.com)"})
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.loads(r.read().decode("utf-8", "replace")).get("data", [])
        except urllib.error.HTTPError as e:
            if e.code == 400:
                return []
            if e.code in (403, 429) or e.code >= 500:
                last = e
                continue
            raise
        except Exception as e:  # noqa: BLE001
            last = e
    raise SystemExit(f"FATAL: NASS unreachable after retries: {last}")


def val(row):
    try:
        return float(str(row.get("Value", "")).replace(",", ""))
    except ValueError:
        return None


def collect(fetch):
    cap = defaultdict(lambda: defaultdict(lambda: [None, None]))   # st -> yr -> [on, off]
    for which, sd in CAP.items():
        idx = 0 if which == "on" else 1
        rows = fetch({"short_desc": sd, "agg_level_desc": "STATE",
                      "source_desc": "SURVEY",
                      "year__GE": str(FIRST_YEAR),
                      "reference_period_desc": CAP_REF})
        print(f"  capacity {which}-farm: {len(rows)} rows")
        for r in rows:
            v = val(r)
            st, yr = r.get("state_alpha"), str(r.get("year"))
            if v is not None and st and yr:
                cap[st][yr][idx] = v
        time.sleep(2)
    # LEARNED LIVE (first run): census years (2002..2022) carry CENSUS rows and
    # census DOMAIN breakdowns beside the survey total — summing rows blindly
    # made IA 2022 "grow" 36B bu (11x). Pin source SURVEY and ASSIGN one value
    # per (state, year, crop); a duplicate row is a loud warning, never a +=.
    per_crop = defaultdict(dict)                                   # (st,yr) -> {sd: bu}
    prod_n = 0
    dupes = 0
    for sd in PROD:
        rows = fetch({"short_desc": sd, "agg_level_desc": "STATE",
                      "source_desc": "SURVEY",
                      "year__GE": str(FIRST_YEAR),
                      "reference_period_desc": "YEAR"})
        print(f"  production {sd.split(' -')[0]}: {len(rows)} rows")
        prod_n += len(rows)
        for r in rows:
            v = val(r)
            st, yr = r.get("state_alpha"), str(r.get("year"))
            if v is None or not st or not yr:
                continue
            if sd in per_crop[(st, yr)]:
                dupes += 1
                continue
            per_crop[(st, yr)][sd] = v
        time.sleep(2)
    if dupes:
        print(f"  !! {dupes} duplicate production rows ignored (kept first) — "
              f"if this is large, the source pin regressed")
    prod = defaultdict(lambda: defaultdict(float))                 # st -> yr -> bu
    for (st, yr), crops in per_crop.items():
        prod[st][yr] = sum(crops.values())
        for sd, v in crops.items():
            LAST_BY_CROP.setdefault(sd, {}).setdefault(st, {})[yr] = v
    return cap, prod, prod_n


def shape(cap, prod):
    states, national = {}, {"cap": {}, "prod": {}, "ratio": {}}
    nat_cap, nat_prod = defaultdict(float), defaultdict(float)
    for st in sorted(cap):
        c = {yr: p for yr, p in cap[st].items()}
        entry = {"cap": {}, "prod": {}, "ratio": {}}
        for yr, (on, off) in sorted(c.items()):
            total = (on or 0) + (off or 0)
            if total <= 0:
                continue
            entry["cap"][yr] = [on, off]
            # National capacity comes from NASS's own US total downstream, but
            # this running sum is still useful as a cross-check.
            nat_cap[yr] += total
            p = prod.get(st, {}).get(yr)
            if p:
                entry["prod"][yr] = round(p)
                # NASS publishes no separate on-farm capacity for about ten
                # states (AZ CA DE FL LA MD NM SC UT WY) — those bins are
                # reported only inside a combined national bucket. Coercing the
                # blank to zero makes a state look like it has almost no
                # storage: it once put South Carolina on the page at 3.46x,
                # ranked first, purely because its farm bins were missing.
                # No on-farm figure means no honest total, so no ratio.
                if on is None:
                    continue
                entry["ratio"][yr] = round(p / total, 3)
        for yr, p in prod.get(st, {}).items():
            nat_prod[yr] += p
        if st != "OT" and entry["ratio"]:
            states[st] = entry
    for yr in sorted(nat_cap):
        national["cap"][yr] = round(nat_cap[yr])
        if nat_prod.get(yr):
            national["prod"][yr] = round(nat_prod[yr])
            national["ratio"][yr] = round(nat_prod[yr] / nat_cap[yr], 3)
    return states, national


# ---------------------------------------------------------------- this fall
# 2026-10-10: THE PAGE DIVIDED LAST YEAR'S CROP BY BIN SPACE. That ignores the
# grain already in the bins on September 1 and is a year stale by harvest, so
# it said 7 states were short while farmdoc daily (Dhakal and Janzen, "Enough
# Room for the Harvest? Grain Storage Pressure in the Corn Belt", Oct 7, 2026)
# found carry-in plus production over capacity in most Corn Belt states.
# The fall measure is theirs: what has to fit = September 1 stocks (on- and
# off-farm; the plain "- STOCKS" series is the two together) plus this year's
# fall crop (corn, soybeans, sorghum: the latest NASS state forecast, or the
# final once it is out), over the latest December 1 capacity.
# Wheat, barley and oats are harvested by September 1, so their new crop is
# already IN those stocks; adding their production as well would count it twice.
STOCKS = {"CORN": "CORN, GRAIN - STOCKS, MEASURED IN BU",
          "SOYBEANS": "SOYBEANS - STOCKS, MEASURED IN BU",
          "WHEAT": "WHEAT - STOCKS, MEASURED IN BU",
          "SORGHUM": "SORGHUM, GRAIN - STOCKS, MEASURED IN BU",
          "BARLEY": "BARLEY - STOCKS, MEASURED IN BU",
          "OATS": "OATS - STOCKS, MEASURED IN BU"}
STOCKS_REF = "FIRST OF SEP"
FALL = {"CORN": PROD[0], "SOYBEANS": PROD[1], "SORGHUM": PROD[3]}
# latest wins; the final ("YEAR") beats every forecast
FORECAST_ORDER = ["YEAR - AUG FORECAST", "YEAR - SEP FORECAST", "YEAR - OCT FORECAST",
                  "YEAR - NOV FORECAST", "YEAR"]
# a crop that was at least this share of a state's grain last year must have a
# September 1 stocks figure, or the state gets no ratio (NASS publishes state
# stocks for the bigger states only; a missing big crop would make it look roomy)
MIN_SHARE = 0.02


def collect_fall(fetch, year):
    """-> (stocks {st: {crop: bu}}, fall {st: {crop: (bu, period)}})."""
    stocks = defaultdict(dict)
    for crop, sd in STOCKS.items():
        rows = fetch({"short_desc": sd, "agg_level_desc": "STATE", "source_desc": "SURVEY",
                      "year": str(year), "reference_period_desc": STOCKS_REF})
        print(f"  Sept 1 stocks {crop.lower()}: {len(rows)} rows")
        for r in rows:
            v = val(r)
            st = r.get("state_alpha")
            if v is not None and st and str(r.get("year")) == str(year) and crop not in stocks[st]:
                stocks[st][crop] = v
        time.sleep(2)
    fall = defaultdict(dict)
    for crop, sd in FALL.items():
        rows = fetch({"short_desc": sd, "agg_level_desc": "STATE", "source_desc": "SURVEY", "year": str(year)})
        print(f"  {year} production {crop.lower()} (forecast or final): {len(rows)} rows")
        for r in rows:
            v, st, ref = val(r), r.get("state_alpha"), str(r.get("reference_period_desc") or "")
            if v is None or not st or ref not in FORECAST_ORDER or str(r.get("year")) != str(year):
                continue
            have = fall[st].get(crop)
            if have is None or FORECAST_ORDER.index(ref) > FORECAST_ORDER.index(have[1]):
                fall[st][crop] = (v, ref)
        time.sleep(2)
    return stocks, fall


def shape_fall(stocks, fall, cap, last_prod_by_crop, year):
    """One record per state with every input printed, or a reason it has none.
    cap: {st: {yr: [on, off]}}; last_prod_by_crop: {st: {CROP: bu}} for the
    previous year's finals (to know which crops a state must have stocks for)."""
    out = {}
    for st in sorted(set(stocks) | set(fall)):
        if st == "OT":
            continue
        yrs = [y for y, (on, off) in cap.get(st, {}).items() if on is not None and (on or 0) + (off or 0) > 0]
        rec = {"stocks": {k: round(v) for k, v in stocks.get(st, {}).items()},
               "fall": {k: [round(v[0]), v[1]] for k, v in fall.get(st, {}).items()}}
        if not yrs:
            rec["why"] = "no on-farm plus off-farm capacity figure"
            out[st] = rec
            continue
        cy = max(yrs)
        on, off = cap[st][cy]
        rec["cap"], rec["cap_year"] = round(on + off), cy
        last = last_prod_by_crop.get(st, {})
        tot = sum(last.values()) or 0
        need = [c for c, v in last.items() if tot and v / tot >= MIN_SHARE]
        miss = [c for c in need if c not in stocks.get(st, {})]
        miss += [c for c in FALL if c in need and c not in fall.get(st, {})]
        if miss:
            rec["why"] = "NASS has no state figure for " + ", ".join(sorted({m.lower() for m in miss}))
            out[st] = rec
            continue
        held = sum(stocks.get(st, {}).values()) + sum(v[0] for v in fall.get(st, {}).values())
        rec["total"] = round(held)
        rec["ratio"] = round(held / (on + off), 3)
        out[st] = rec
    return {"year": int(year), "stocks_ref": STOCKS_REF, "states": out,
            "method": ("September 1 stocks (on- and off-farm) of corn, soybeans, wheat, sorghum, barley and oats, "
                       "plus this year's corn, soybean and sorghum crop (latest NASS state forecast, or the final), "
                       "over on-farm plus off-farm capacity (latest December 1). Small grains are harvested by "
                       "September 1 and already in the stocks.")}


# ---------------------------------------------------------------- history
# 2026-10-16: HOW FAST EACH STATE CLEARS THE PRESSURE. farmdoc daily (Dhakal and
# Janzen, Oct 7, 2026) compares each fall's storage pressure with December 1
# capacity use, 2000-2025. Same two numbers here, per state and for the US:
#   pressure(y) = (Sept 1 stocks of all six grains + corn, soybean and sorghum
#                  final production of y) / Dec 1 capacity of y
#   use(y)      = Dec 1 stocks of all six grains / Dec 1 capacity of y
# A state-year counts only when every crop that was at least MIN_SHARE of that
# year's grain has the stocks figure (the same rule as this fall's table), and
# a value outside a sane band is dropped and counted, never clipped.
# Output: data/storage/history.json, loaded by the page only when a reader opens
# a state's history (components/storage-detail.js), never with the page.
HIST_OUT = "data/storage/history.json"
STOCK_REFS = {"sep": "FIRST OF SEP", "dec": "FIRST OF DEC"}
CROP_OF = dict(zip(PROD, ["CORN", "SOYBEANS", "WHEAT", "SORGHUM", "BARLEY", "OATS"]))
P_BAND = (0.10, 3.0)      # pressure outside this is a data fault, not a fall
U_BAND = (0.02, 2.0)
MIN_YEARS = 10            # fewer usable falls than this: no averages printed
# farmdoc daily's published 2000-2025 averages (Oct 7, 2026, read from the saved
# copy on the references branch, bench-storage-crunch-1). If our arithmetic on
# NASS's numbers lands far from theirs, something is wrong with the pull, and
# the history file is not written.
FARMDOC_CHECK = {"IL": {"p": 1.03, "u": 0.81}}
FARMDOC_US_DROP = 0.27
CHECK_TOL = 0.08


def collect_history(fetch, year):
    """-> stocks {ref: {st: {yr: {CROP: bu}}}} for STATE and NATIONAL ('US'),
    us_prod {yr: {CROP: (bu, period)}} (finals for past years, latest for this
    year), us_cap {yr: [on, off]}."""
    stocks = {k: defaultdict(lambda: defaultdict(dict)) for k in STOCK_REFS}
    dupes = 0
    for key, ref in STOCK_REFS.items():
        for agg in ("STATE", "NATIONAL"):
            for crop, sd in STOCKS.items():
                rows = fetch({"short_desc": sd, "agg_level_desc": agg, "source_desc": "SURVEY",
                              "year__GE": str(FIRST_YEAR), "reference_period_desc": ref})
                print(f"  history {key} stocks {crop.lower()} {agg.lower()}: {len(rows)} rows")
                for r in rows:
                    v = val(r)
                    st = "US" if agg == "NATIONAL" else r.get("state_alpha")
                    yr = str(r.get("year"))
                    if v is None or not st or not yr or str(r.get("reference_period_desc") or ref) != ref:
                        continue
                    if crop in stocks[key][st][yr]:
                        dupes += 1
                        continue
                    stocks[key][st][yr][crop] = v
                time.sleep(2)
    if dupes:
        print(f"  !! {dupes} duplicate stocks rows ignored (kept first)")
    us_prod = defaultdict(dict)
    for c, sd in FALL.items():
        rows = fetch({"short_desc": sd, "agg_level_desc": "NATIONAL", "source_desc": "SURVEY",
                      "year__GE": str(FIRST_YEAR)})
        print(f"  history US production {sd.split(' -')[0].lower()}: {len(rows)} rows")
        for r in rows:
            v, yr, ref = val(r), str(r.get("year")), str(r.get("reference_period_desc") or "")
            if v is None or ref not in FORECAST_ORDER:
                continue
            have = us_prod[yr].get(c)
            if int(yr) < year and ref != "YEAR":
                continue            # a past year counts its final only
            if have is None or FORECAST_ORDER.index(ref) > FORECAST_ORDER.index(have[1]):
                us_prod[yr][c] = (v, ref)
        time.sleep(2)
    us_cap = defaultdict(lambda: [None, None])
    for which, sd in CAP.items():
        rows = fetch({"short_desc": sd, "agg_level_desc": "NATIONAL", "source_desc": "SURVEY",
                      "year__GE": str(FIRST_YEAR), "reference_period_desc": CAP_REF})
        print(f"  history US capacity {which}-farm: {len(rows)} rows")
        for r in rows:
            v = val(r)
            if v is not None:
                us_cap[str(r.get("year"))][0 if which == "on" else 1] = v
        time.sleep(2)
    return stocks, us_prod, us_cap


def pct(xs, q):
    """q-th percentile, linear between ranks (numpy's default)."""
    s = sorted(xs)
    if not s:
        return None
    k = (len(s) - 1) * q
    lo = int(k)
    hi = min(lo + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def summarize(ys, ps, us, this_p):
    """Averages, 10th-90th ranges, drawdown and a leave-one-out check of the
    'usual drop' line. None when fewer than MIN_YEARS falls have both numbers."""
    both = [(y, p, u) for y, p, u in zip(ys, ps, us) if p is not None and u is not None]
    if len(both) < MIN_YEARS:
        return {"n": len(both), "withheld": f"only {len(both)} falls with both figures (need {MIN_YEARS})"}
    P = [b[1] for b in both]
    U = [b[2] for b in both]
    D = [p - u for p, u in zip(P, U)]
    n = len(both)
    mean = lambda a: sum(a) / len(a)
    # leave-one-out: predict each year's Dec 1 use as its pressure minus the
    # average drop of the OTHER years; how far off was that, in points?
    errs = [abs(both[i][2] - (both[i][1] - (sum(D) - D[i]) / (n - 1))) for i in range(n)]
    r3 = lambda x: None if x is None else round(x, 3)
    out = {"n": n, "first": both[0][0], "last": both[-1][0],
           "p_avg": r3(mean(P)), "p10": r3(pct(P, .1)), "p90": r3(pct(P, .9)),
           "u_avg": r3(mean(U)), "u10": r3(pct(U, .1)), "u90": r3(pct(U, .9)),
           "drop_avg": r3(mean(D)), "drop10": r3(pct(D, .1)), "drop90": r3(pct(D, .9)),
           "loo_mae": r3(mean(errs)), "loo_max": r3(max(errs))}
    if this_p is not None:
        out["this_p"] = r3(this_p)
        out["below"] = sum(1 for p in P if p < this_p)       # past falls with less pressure
        out["if_usual"] = r3(this_p - mean(D))
        out["if_slow"] = r3(this_p - pct(D, .1))
    return out


def shape_history(stocks, prod_by_crop, cap, us_prod, us_cap, year, crunch):
    """prod_by_crop: {st: {yr: {CROP: bu}}} state finals (all six grains).
    cap: {st: {yr: [on, off]}}. crunch: this fall's block (or None)."""
    years = [str(y) for y in range(FIRST_YEAR, year)]
    dropped = defaultdict(int)
    states = {}
    sts = sorted(set(stocks["sep"]) | set(stocks["dec"]))
    for st in sts:
        if st in ("US", "OT"):
            continue
        ps, us = [], []
        for yr in years:
            on, off = (cap.get(st, {}).get(yr) or [None, None])
            tot = (on or 0) + (off or 0)
            grown = prod_by_crop.get(st, {}).get(yr, {})
            gt = sum(grown.values())
            if on is None or tot <= 0 or not gt:
                ps.append(None); us.append(None); continue
            need = [c for c, v in grown.items() if v / gt >= MIN_SHARE]
            sep, dec = stocks["sep"][st].get(yr, {}), stocks["dec"][st].get(yr, {})
            p = u = None
            if all(c in sep for c in need):
                p = (sum(sep.values()) + sum(grown.get(c, 0) for c in FALL)) / tot
                if not (P_BAND[0] <= p <= P_BAND[1]):
                    dropped["pressure out of band"] += 1
                    p = None
            if all(c in dec for c in need):
                u = sum(dec.values()) / tot
                if not (U_BAND[0] <= u <= U_BAND[1]):
                    dropped["use out of band"] += 1
                    u = None
            ps.append(None if p is None else round(p, 3))
            us.append(None if u is None else round(u, 3))
        if not any(x is not None for x in ps + us):
            continue
        this = (((crunch or {}).get("states") or {}).get(st) or {}).get("ratio")
        c20, c_last = cap.get(st, {}).get(str(year - 6)), cap.get(st, {}).get(str(year - 1))
        rec = {"p": ps, "u": us, "stats": summarize(years, ps, us, this)}
        if c20 and c_last and c20[0] is not None and c_last[0] is not None:
            rec["cap"] = {str(year - 6): round(sum(c20)), str(year - 1): round(sum(c_last))}
        states[st] = rec
    # the US line: national rows only, no share rule (NASS publishes every crop)
    ps, us = [], []
    for yr in years:
        on, off = us_cap.get(yr) or [None, None]
        tot = (on or 0) + (off or 0)
        sep, dec = stocks["sep"]["US"].get(yr, {}), stocks["dec"]["US"].get(yr, {})
        crop = {c: v[0] for c, v in us_prod.get(yr, {}).items() if v[1] == "YEAR"}
        ok = tot > 0 and all(c in sep for c in ("CORN", "SOYBEANS", "WHEAT")) and all(c in crop for c in ("CORN", "SOYBEANS"))
        p = (sum(sep.values()) + sum(crop.get(c, 0) for c in FALL)) / tot if ok else None
        u = sum(dec.values()) / tot if tot > 0 and all(c in dec for c in ("CORN", "SOYBEANS", "WHEAT")) else None
        p = p if p is not None and P_BAND[0] <= p <= P_BAND[1] else None
        u = u if u is not None and U_BAND[0] <= u <= U_BAND[1] else None
        ps.append(None if p is None else round(p, 3))
        us.append(None if u is None else round(u, 3))
    us_this = ((crunch or {}).get("us") or {}).get("ratio")
    usrec = {"p": ps, "u": us, "stats": summarize(years, ps, us, us_this)}
    return {"years": years, "states": states, "us": usrec, "dropped": dict(dropped)}


def shape_us_fall(stocks, us_prod, us_cap, year):
    """This fall for the US as a whole: Sept 1 stocks + latest corn, soybean and
    sorghum figure, over the latest US Dec 1 capacity. None when a piece is missing."""
    sep = stocks["sep"]["US"].get(str(year), {})
    fall = {c: v for c, v in us_prod.get(str(year), {}).items() if c in FALL}
    caps = [y for y, (on, off) in us_cap.items() if on is not None and off is not None and int(y) < year]
    if not caps or not all(c in sep for c in ("CORN", "SOYBEANS", "WHEAT")) or not all(c in fall for c in ("CORN", "SOYBEANS")):
        return None
    cy = max(caps)
    tot = sum(us_cap[cy])
    held = sum(sep.values()) + sum(v[0] for v in fall.values())
    r = held / tot
    if not (P_BAND[0] <= r <= P_BAND[1]):
        return None
    return {"stocks": {k: round(v) for k, v in sep.items()}, "fall": {k: [round(v[0]), v[1]] for k, v in fall.items()},
            "cap": round(tot), "cap_year": cy, "total": round(held), "ratio": round(r, 3)}


def history_checks(h):
    """Our arithmetic against farmdoc's published averages. -> list of failures."""
    bad = []
    for st, want in FARMDOC_CHECK.items():
        s = (h["states"].get(st) or {}).get("stats") or {}
        for k in ("p", "u"):
            got = s.get(k + "_avg")
            if got is None or abs(got - want[k]) > CHECK_TOL:
                bad.append(f"{st} average {'pressure' if k == 'p' else 'Dec 1 use'} {got} vs farmdoc {want[k]}")
    d = h["us"]["stats"].get("drop_avg")
    if d is None or abs(d - FARMDOC_US_DROP) > CHECK_TOL:
        bad.append(f"US average drop {d} vs farmdoc {FARMDOC_US_DROP}")
    return bad


def main():
    if "--selftest" in sys.argv:
        return selftest()
    if not KEY:
        raise SystemExit("FATAL: NASS_API_KEY not set")
    if "--probe" in sys.argv:
        return probe()
    cap, prod, prod_n = collect(api_get)
    if not cap:
        raise SystemExit("FATAL: zero capacity rows — refusing to write")
    if prod_n == 0:
        raise SystemExit("FATAL: zero production rows — refusing to write")
    states, national = shape(cap, prod)
    if len(states) < 15:
        raise SystemExit(f"FATAL: only {len(states)} states shaped — something is wrong")
    latest = max(yr for s in states.values() for yr in s["ratio"])
    # This fall: Sept 1 stocks land Sept 30; a run before then (or a year
    # NASS has not posted) writes no fall block and the page says so.
    year = datetime.now(timezone.utc).year
    crunch = None
    stocks, fall = collect_fall(api_get, year)
    if sum(1 for st in stocks if stocks[st].get("CORN")) >= 10 and fall:
        last = defaultdict(dict)
        for sd, crop in zip(PROD, ["CORN", "SOYBEANS", "WHEAT", "SORGHUM", "BARLEY", "OATS"]):
            for st, yrs in LAST_BY_CROP.get(sd, {}).items():
                if str(year - 1) in yrs:
                    last[st][crop] = yrs[str(year - 1)]
        crunch = shape_fall(stocks, fall, cap, last, year)
    else:
        print(f"  no {year} September 1 state stocks yet; the fall block is left out")
    out = {"generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "source": "USDA NASS Quick Stats — Grain Stocks (capacity, first of Dec) + Crop Production annual",
           "note": ("Grain = corn+soybeans+wheat+sorghum+barley+oats, final YEAR figures only "
                    "(forecast rows excluded). Capacity is on-farm + off-farm, first-of-December. "
                    "'OT' combined-small-states rows are in the national total but never ranked. "
                    "Ratio over 1.0 = the state grew more grain than it can store."),
           "latest_year": latest, "states": states, "national": national}
    # History and the US line. Any fault here leaves the history file as it
    # was and still writes this fall's table (the page says history is missing).
    hist = None
    try:
        hs, us_prod, us_cap = collect_history(api_get, year)
        if crunch:
            usf = shape_us_fall(hs, us_prod, us_cap, year)
            if usf:
                crunch["us"] = usf
                sumcap = national["cap"].get(usf["cap_year"])
                if sumcap and abs(sumcap - usf["cap"]) / usf["cap"] > 0.05:
                    print(f"::warning::US capacity {usf['cap']:,} vs sum of states {sumcap:,} differ by more than 5%")
            else:
                print("  no US line this fall: a national figure is missing")
        by_crop = defaultdict(lambda: defaultdict(dict))
        for sd, crop in CROP_OF.items():
            for st, yrs in LAST_BY_CROP.get(sd, {}).items():
                for yr, v in yrs.items():
                    by_crop[st][yr][crop] = v
        hist = shape_history(hs, by_crop, cap, us_prod, us_cap, year, crunch)
        bad = history_checks(hist)
        if bad:
            print("::warning::history not written, it does not match farmdoc's published averages: " + "; ".join(bad))
            hist = None
    except SystemExit as e:
        print(f"::warning::history skipped: {e}")
    except Exception as e:  # noqa: BLE001
        print(f"::warning::history skipped: {type(e).__name__}: {e}")
    if crunch:
        out["crunch"] = crunch
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, "w"), separators=(",", ":"))
    if hist:
        hist = {"generated": out["generated"], "fall_year": (crunch or {}).get("year"),
                "method": ("pressure = (Sept 1 stocks of corn, soybeans, wheat, sorghum, barley and oats + that year's "
                           "final corn, soybean and sorghum crop) / Dec 1 on-farm plus off-farm capacity; Dec 1 use = "
                           "Dec 1 stocks of the same six grains / the same capacity. USDA NASS Quick Stats. A state-year "
                           "counts only when every crop that was at least 2% of its grain has a stocks figure. Ranges "
                           "are the 10th and 90th percentile, linear between ranks."), **hist}
        json.dump(hist, open(HIST_OUT, "w"), separators=(",", ":"))
        s = hist["states"].get("IL", {}).get("stats", {})
        print(f"wrote {HIST_OUT}: {len(hist['states'])} states; IL pressure {s.get('p_avg')} Dec 1 {s.get('u_avg')} "
              f"(farmdoc 1.03 / 0.81); US drop {hist['us']['stats'].get('drop_avg')} (farmdoc 0.27); dropped {hist['dropped']}")
    r = {st: s["ratio"].get(latest) for st, s in states.items() if s["ratio"].get(latest)}
    top = max(r, key=r.get)
    print(f"wrote {OUT}: {len(states)} states, latest {latest}, "
          f"tightest {top} at {r[top]:.2f}x capacity")


def probe():
    """Pull only the history series and print what came back. Writes nothing."""
    year = datetime.now(timezone.utc).year
    hs, us_prod, us_cap = collect_history(api_get, year)
    for key in STOCK_REFS:
        for st in ("IL", "IA", "US"):
            yrs = sorted(hs[key][st])
            print(f"  {key} {st}: {len(yrs)} years {yrs[:1]}..{yrs[-1:]}; {yrs[-1:] and hs[key][st][yrs[-1]]}")
    for yr in (str(year - 1), str(year)):
        print(f"  US crop {yr}: {us_prod.get(yr)}")
    print(f"  US capacity: {dict(list(sorted(us_cap.items()))[-3:])}")


def selftest():
    """Synthetic capacity+production through collect+shape, traps exercised."""
    def fake(params):
        sd = params["short_desc"]
        if "CAPACITY" in sd:
            assert params["reference_period_desc"] == "FIRST OF DEC", "ref pin missing"
            assert params["source_desc"] == "SURVEY", "capacity source pin missing"
            base = 1000 if "ON FARM" in sd else 800
            rows = []
            for yr in (2023, 2024):
                rows += [{"state_alpha": "IA", "year": yr, "Value": f"{base * 2:,}"},
                         {"state_alpha": "KS", "year": yr, "Value": f"{base:,}"},
                         {"state_alpha": "OT", "year": yr, "Value": "99"},
                         {"state_alpha": "MN", "year": yr, "Value": "(D)"}]
            return rows
        assert params["reference_period_desc"] == "YEAR", "forecast filter missing"
        assert params["source_desc"] == "SURVEY", "census contamination pin missing"
        per = {"CORN": 2000, "SOYBEANS": 600}.get(sd.split(",")[0].split(" -")[0], 100)
        rows = [{"state_alpha": "IA", "year": yr, "Value": f"{per * 2:,}"}
                for yr in (2023, 2024)] + \
               [{"state_alpha": "KS", "year": yr, "Value": f"{per:,}"} for yr in (2023, 2024)]
        # duplicate row (as census-year noise would be) — must be IGNORED not summed
        rows.append({"state_alpha": "IA", "year": 2024, "Value": f"{per * 20:,}"})
        return rows
    import time as _t
    real_sleep = _t.sleep
    _t.sleep = lambda s: None
    try:
        cap, prod, n = collect(fake)
    finally:
        _t.sleep = real_sleep
    states, national = shape(cap, prod)
    assert "OT" not in states, "OT pseudo-state ranked"
    assert "MN" not in states, "(D)-only state kept"
    ia = states["IA"]
    assert ia["cap"]["2024"] == [2000, 1600]
    # IA prod = (2000+600+100*4)*2 = 6000; cap total 3600 -> 1.667
    assert abs(ia["ratio"]["2024"] - round(6000 / 3600, 3)) < 1e-9, ia["ratio"]
    assert national["cap"]["2024"] == 2000 + 1600 + 1000 + 800 + 99 * 2  # OT in national sum
    # this fall: hand-worked. IA: stocks corn 600 + soy 100 + wheat 10 = 710,
    # fall crop corn 2400 (SEP beats AUG) + soy 600 = 3000; 3710 / 3600 = 1.031.
    def fake_fall(params):
        sd = params["short_desc"]
        if "STOCKS" in sd:
            assert params["reference_period_desc"] == "FIRST OF SEP" and params["year"] == "2026"
            v = {"CORN": 600, "SOYBEANS": 100, "WHEAT": 10}.get(sd.split(",")[0].split(" -")[0])
            rows = [{"state_alpha": "IA", "year": 2026, "Value": f"{v:,}"}] if v else []
            if sd.startswith("CORN"):
                rows.append({"state_alpha": "KS", "year": 2026, "Value": "50"})
            return rows
        assert "reference_period_desc" not in params, "the forecast must not be pinned to one month"
        if sd.startswith("CORN"):
            return [{"state_alpha": "IA", "year": 2026, "Value": "2,300", "reference_period_desc": "YEAR - AUG FORECAST"},
                    {"state_alpha": "IA", "year": 2026, "Value": "2,400", "reference_period_desc": "YEAR - SEP FORECAST"},
                    {"state_alpha": "KS", "year": 2026, "Value": "900", "reference_period_desc": "YEAR - SEP FORECAST"}]
        if sd.startswith("SOYBEANS"):
            return [{"state_alpha": "IA", "year": 2026, "Value": "600", "reference_period_desc": "YEAR - SEP FORECAST"}]
        return []
    _t.sleep = lambda s: None
    try:
        stk, fl = collect_fall(fake_fall, 2026)
    finally:
        _t.sleep = real_sleep
    assert fl["IA"]["CORN"] == (2400.0, "YEAR - SEP FORECAST"), fl
    last = {"IA": {"CORN": 2000, "SOYBEANS": 600, "WHEAT": 20}, "KS": {"CORN": 800, "WHEAT": 900}}
    cr = shape_fall(stk, fl, cap, last, 2026)
    assert cr["states"]["IA"]["ratio"] == round(3710 / 3600, 3) and cr["states"]["IA"]["total"] == 3710, cr["states"]["IA"]
    # KS grew a big wheat crop and NASS gave it no wheat stocks: no ratio, and it says why
    assert "ratio" not in cr["states"]["KS"] and "wheat" in cr["states"]["KS"]["why"], cr["states"]["KS"]
    # history: hand-worked. IL 2000-2011, capacity 60 + 40 = 100 every year,
    # crop corn 80 + soy 20, Sept 1 stocks corn 10+i + soy 5, Dec 1 stocks 70 + 10.
    # pressure(i) = (15 + i + 100) / 100 = 1.15 + 0.01i, use = 0.80.
    # Averages: pressure 1.205, use 0.80, drop 0.405; 10th pct of pressure:
    # rank 11 * 0.1 = 1.1 -> 1.16 + 0.1 * 0.01 = 1.161. Leave-one-out error for
    # year i is |0.06 - 0.01i * 12/11|, mean 0.0327, worst 0.06 (i = 0 and 11).
    # This fall 1.20: 5 past falls below it (1.15..1.19); usual drop -> 0.795.
    yrs = [str(y) for y in range(2000, 2012)]
    hst = {"sep": defaultdict(lambda: defaultdict(dict)), "dec": defaultdict(lambda: defaultdict(dict))}
    pbc = defaultdict(lambda: defaultdict(dict))
    hcap = defaultdict(dict)
    for i, y in enumerate(yrs):
        hst["sep"]["IL"][y] = {"CORN": 10 + i, "SOYBEANS": 5}
        hst["dec"]["IL"][y] = {"CORN": 70, "SOYBEANS": 10}
        pbc["IL"][y] = {"CORN": 80, "SOYBEANS": 20}
        hcap["IL"][y] = [60, 40]
        # KS grows wheat (50%) but NASS gave it no wheat stocks: no pressure, no use
        hst["sep"]["KS"][y] = {"CORN": 10}
        hst["dec"]["KS"][y] = {"CORN": 10}
        pbc["KS"][y] = {"CORN": 50, "WHEAT": 50}
        hcap["KS"][y] = [50, 50]
        # US: national rows, cap 1000; pressure (100 + 900) / 1000 = 1.0, use 0.7
        hst["sep"]["US"][y] = {"CORN": 60, "SOYBEANS": 20, "WHEAT": 20}
        hst["dec"]["US"][y] = {"CORN": 500, "SOYBEANS": 100, "WHEAT": 100}
    # a capacity typo (1 bu) in 2005 would make MO 115x: dropped and counted, not printed
    for y in yrs:
        hst["sep"]["MO"][y] = {"CORN": 10}
        hst["dec"]["MO"][y] = {"CORN": 5}
        pbc["MO"][y] = {"CORN": 100}
        hcap["MO"][y] = [50, 50] if y != "2005" else [1, 0]
    usp = {y: {"CORN": (800, "YEAR"), "SOYBEANS": (100, "YEAR")} for y in yrs}
    usc = {y: [600, 400] for y in yrs}
    h = shape_history(hst, pbc, hcap, usp, usc, 2012, {"states": {"IL": {"ratio": 1.20}}})
    s = h["states"]["IL"]["stats"]
    assert h["states"]["IL"]["p"][0] == 1.15 and h["states"]["IL"]["p"][11] == 1.26, h["states"]["IL"]["p"]
    assert (s["n"], s["p_avg"], s["u_avg"], s["drop_avg"], s["p10"]) == (12, 1.205, 0.8, 0.405, 1.161), s
    assert (s["loo_mae"], s["loo_max"], s["below"], s["if_usual"]) == (0.033, 0.06, 5, 0.795), s
    assert "KS" not in h["states"], "a state missing a big crop's stocks got a history"
    assert h["states"]["MO"]["p"][5] is None and h["dropped"]["pressure out of band"] == 1, h["dropped"]
    assert h["us"]["p"][0] == 1.0 and h["us"]["u"][0] == 0.7 and h["us"]["stats"]["drop_avg"] == 0.3, h["us"]
    assert history_checks(h), "farmdoc check passed on made-up numbers"
    # under MIN_YEARS falls: averages withheld with the reason
    w = summarize(yrs[:9], [1.0] * 9, [0.7] * 9, 1.1)
    assert "p_avg" not in w and "only 9 falls" in w["withheld"], w
    # this fall's US line: 2012 stocks 100 + crop 900 over the 2011 capacity 1000
    hst["sep"]["US"]["2012"] = {"CORN": 60, "SOYBEANS": 20, "WHEAT": 20}
    usp["2012"] = {"CORN": (800, "YEAR - SEP FORECAST"), "SOYBEANS": (100, "YEAR - SEP FORECAST")}
    uf = shape_us_fall(hst, usp, usc, 2012)
    assert uf["ratio"] == 1.0 and uf["cap_year"] == "2011", uf
    # collect_history: a past year keeps its final, never a forecast; this year keeps the latest
    def fake_hist(params):
        sd, agg = params["short_desc"], params["agg_level_desc"]
        if "STOCKS" in sd:
            assert params["reference_period_desc"] in ("FIRST OF SEP", "FIRST OF DEC")
            if sd.startswith("CORN"):
                st = {} if agg == "NATIONAL" else {"state_alpha": "IL"}
                return [dict(st, year=2025, Value="100", reference_period_desc=params["reference_period_desc"]),
                        dict(st, year=2025, Value="999", reference_period_desc=params["reference_period_desc"])]
            return []
        if "CAPACITY" in sd:
            return [{"year": 2025, "Value": "500"}]
        if sd.startswith("CORN"):
            return [{"year": 2025, "Value": "700", "reference_period_desc": "YEAR - NOV FORECAST"},
                    {"year": 2025, "Value": "650", "reference_period_desc": "YEAR"},
                    {"year": 2026, "Value": "600", "reference_period_desc": "YEAR - SEP FORECAST"},
                    {"year": 2026, "Value": "610", "reference_period_desc": "YEAR - OCT FORECAST"}]
        return []
    _t.sleep = lambda s: None
    try:
        hs, up, uc = collect_history(fake_hist, 2026)
    finally:
        _t.sleep = real_sleep
    assert hs["sep"]["IL"]["2025"] == {"CORN": 100} and hs["dec"]["US"]["2025"] == {"CORN": 100}, "duplicate stocks row summed"
    assert up["2025"]["CORN"] == (650, "YEAR") and up["2026"]["CORN"] == (610, "YEAR - OCT FORECAST"), dict(up)
    assert uc["2025"] == [500, 500]
    print(f"SELFTEST OK — ref-period pins, OT exclusion (rank) + inclusion (national), "
          f"(D) skip, ratio math (IA {ia['ratio']['2024']}x)")


if __name__ == "__main__":
    main()
