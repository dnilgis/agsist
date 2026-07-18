#!/usr/bin/env python3
"""fetch_cond_yield.py — do crop ratings actually predict yield? (honest answer)

Probe-verified 2026-07-18 (probe-epic2 log): IA mid-July G+E vs final yield
R² = 0.173 — TOO WEAK to sell as a predictor. So the page doesn't sell one.
THE PAGE'S PROMISE (/conditions-yield): "here is exactly how much the weekly
Good+Excellent share has historically explained of final yield, per state,
per week of the season" — an R²-by-week curve. Early-season ratings barely
predicting anything IS the finding; late-August mattering more IS the
finding. Both are computed, never asserted.

Data (strings verified live in fetch_conditions + probe):
  {CORN|SOYBEANS} - CONDITION, MEASURED IN PCT {GOOD|EXCELLENT}   STATE, 2000+
  CORN, GRAIN - YIELD, MEASURED IN BU / ACRE                      STATE, YEAR only
  SOYBEANS - YIELD, MEASURED IN BU / ACRE                         STATE, YEAR only
  (reference_period_desc='YEAR' pins out the AUG..NOV FORECAST contamination
   the probe re-confirmed.)

Method: for each state, crop, and ISO week 22..40, pair that week's G+E
(week ±0 exact only — no wobble blending inside a regression) with that
year's final yield, over all years with both. R² of the simple linear fit,
n, plus slope sign. States/weeks with n<15 omitted (thin fits lie).
Detrending note: yields trend up ~2 bu/yr; we regress G+E against yield
DEVIATION FROM LINEAR TREND, not raw yield — otherwise the time trend
masquerades as (anti-)signal. The raw-R² is also kept for transparency.

Output data/cond-yield/fit.json:
  {generated, crops:{corn:{states:{IA:{weeks:{wk:{r2,r2_raw,n,slope}},
   latest:{week,ge,year}}}}}}

Fail-loud: zero condition rows exits 1. --selftest offline, gates workflow.
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
OUT = "data/cond-yield/fit.json"
FIRST_YEAR = 2000
WEEKS = range(22, 41)          # ISO weeks late-May .. early-Oct
MIN_N = 15
CROPS = {"corn": ("CORN", "CORN, GRAIN - YIELD, MEASURED IN BU / ACRE"),
         "soybeans": ("SOYBEANS", "SOYBEANS - YIELD, MEASURED IN BU / ACRE")}


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


def iso_week(date_s):
    from datetime import datetime as dt
    return dt.strptime(date_s, "%Y-%m-%d").isocalendar()[1]


def lin_r2(xs, ys):
    """(r2, slope) of simple linear fit y~x."""
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    if not sxx or not syy:
        return 0.0, 0.0
    return (sxy * sxy) / (sxx * syy), sxy / sxx


def detrend(year_yield):
    """{yr: yield} -> {yr: deviation from linear time trend}."""
    yrs = sorted(year_yield)
    xs = [float(y) for y in yrs]
    ys = [year_yield[y] for y in yrs]
    _, slope = lin_r2(xs, ys)
    my, mx = sum(ys) / len(ys), sum(xs) / len(xs)
    return {y: year_yield[y] - (my + slope * (float(y) - mx)) for y in yrs}


def collect(crop_desc, yield_sd, fetch):
    ge = defaultdict(dict)     # st -> (yr, wk) -> ge
    for cat in ("GOOD", "EXCELLENT"):
        rows = fetch({"short_desc": f"{crop_desc} - CONDITION, MEASURED IN PCT {cat}",
                      "agg_level_desc": "STATE", "year__GE": str(FIRST_YEAR)})
        print(f"  {crop_desc} {cat}: {len(rows)} rows")
        for r in rows:
            we = (r.get("week_ending") or "").strip()
            st = (r.get("state_alpha") or "").strip()
            try:
                v = float(str(r.get("Value", "")).replace(",", ""))
            except ValueError:
                continue
            if we and st:
                k = (int(we[:4]), iso_week(we))
                ge[st][k] = ge[st].get(k, 0) + v      # GOOD + EXCELLENT accumulate
        time.sleep(2)
    yrows = fetch({"short_desc": yield_sd, "agg_level_desc": "STATE",
                   "year__GE": str(FIRST_YEAR), "reference_period_desc": "YEAR"})
    print(f"  {crop_desc} final yield: {len(yrows)} rows")
    yields = defaultdict(dict)
    for r in yrows:
        try:
            yields[r.get("state_alpha")][str(r.get("year"))] = float(str(r["Value"]).replace(",", ""))
        except (ValueError, KeyError):
            continue
    return ge, yields


def shape(ge, yields):
    out = {}
    for st in sorted(ge):
        yy = yields.get(st, {})
        if len(yy) < MIN_N:
            continue
        dev = detrend(yy)
        weeks = {}
        newest = max(ge[st])   # (yr, wk)
        for wk in WEEKS:
            pairs = [(ge[st][(int(y), wk)], yy[y], dev[y]) for y in yy
                     if (int(y), wk) in ge[st] and int(y) < newest[0] + 1]
            pairs = [(g, r, d) for g, r, d in pairs]
            if len(pairs) < MIN_N:
                continue
            r2_raw, _ = lin_r2([p[0] for p in pairs], [p[1] for p in pairs])
            r2, slope = lin_r2([p[0] for p in pairs], [p[2] for p in pairs])
            weeks[str(wk)] = {"r2": round(r2, 3), "r2_raw": round(r2_raw, 3),
                              "n": len(pairs), "slope": round(slope, 3)}
        if weeks:
            cur_yr, cur_wk = newest
            out[st] = {"weeks": weeks,
                       "latest": {"year": cur_yr, "week": cur_wk,
                                  "ge": round(ge[st][newest], 1)}}
    return out


def main():
    if "--selftest" in sys.argv:
        return selftest()
    if not KEY:
        raise SystemExit("FATAL: NASS_API_KEY not set")
    out = {"generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "source": "USDA NASS weekly crop condition + annual state yield (YEAR only), 2000-present",
           "note": ("R² is against yield DEVIATION FROM TREND (raw R² kept for transparency). "
                    "Week pairs are exact ISO weeks; states/weeks with under 15 paired years "
                    "are omitted rather than thinly fitted. Slope is bu/acre-deviation per "
                    "G+E point."),
           "min_n": MIN_N, "crops": {}}
    total = 0
    for slug, (desc, ysd) in CROPS.items():
        print(f"{slug}:")
        ge, yields = collect(desc, ysd, api_get)
        pkg = shape(ge, yields)
        if pkg:
            out["crops"][slug] = {"states": pkg}
            total += len(pkg)
            print(f"  -> {len(pkg)} states fitted")
    if total == 0:
        raise SystemExit("FATAL: zero states fitted — refusing to write")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, "w"), separators=(",", ":"))
    print(f"wrote {OUT} ({total} state-crop fits)")


def selftest():
    """Synthetic: G+E linearly tied to detrended yield at week 30, noise at 25."""
    import random
    rnd = random.Random(7)
    def fake(params):
        sd = params["short_desc"]
        if "YIELD" in sd:
            assert params["reference_period_desc"] == "YEAR"
            return [{"state_alpha": "IA", "year": yr, "Value": str(150 + 2 * (yr - 2000) + ((yr * 7) % 11 - 5))}
                    for yr in range(2000, 2026)]
        rows = []
        base = 30.0 if "GOOD" in sd else 10.0
        for yr in range(2000, 2026):
            dev = (yr * 7) % 11 - 5                     # same deviation the yield carries
            # week 30: G+E tracks deviation; week 25: pure noise
            for wk, we in ((25, f"{yr}-06-22"), (30, f"{yr}-07-27")):
                sig = dev * 2 if wk == 30 else rnd.uniform(-8, 8)
                rows.append({"state_alpha": "IA", "week_ending": we,
                             "Value": str(base + sig / 2)})
        return rows
    import time as _t
    real_sleep = _t.sleep
    _t.sleep = lambda s: None
    try:
        ge, yields = collect("CORN", "CORN, GRAIN - YIELD, MEASURED IN BU / ACRE", fake)
    finally:
        _t.sleep = real_sleep
    pkg = shape(ge, yields)
    ia = pkg["IA"]["weeks"]
    wk30, wk25 = ia.get("30"), ia.get("25")
    assert wk30 and wk30["r2"] > 0.9, f"signal week not detected: {wk30}"
    assert wk25 and wk25["r2"] < 0.35, f"noise week shows fake signal: {wk25}"
    assert wk30["n"] >= MIN_N
    print(f"SELFTEST OK — detrended fit finds real signal (wk30 R²={wk30['r2']}) "
          f"and refuses fake signal (wk25 R²={wk25['r2']}); n gating on")


if __name__ == "__main__":
    main()
