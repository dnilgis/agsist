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


def main():
    if "--selftest" in sys.argv:
        return selftest()
    if not KEY:
        raise SystemExit("FATAL: NASS_API_KEY not set")
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
    if crunch:
        out["crunch"] = crunch
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, "w"), separators=(",", ":"))
    r = {st: s["ratio"].get(latest) for st, s in states.items() if s["ratio"].get(latest)}
    top = max(r, key=r.get)
    print(f"wrote {OUT}: {len(states)} states, latest {latest}, "
          f"tightest {top} at {r[top]:.2f}x capacity")


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
    print(f"SELFTEST OK — ref-period pins, OT exclusion (rank) + inclusion (national), "
          f"(D) skip, ratio math (IA {ia['ratio']['2024']}x)")


if __name__ == "__main__":
    main()
