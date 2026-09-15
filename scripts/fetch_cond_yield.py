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
  (reference_period_desc='YEAR' drops the explicitly-labelled AUG..NOV
   forecast rows, but it does NOT make the current year safe: until harvest
   is final, what comes back for it is still a forecast. The year filter in
   shape() and emit_pairs is what keeps it out, and only one of the two had
   it until 2026-09-13.)

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
PAIRS_OUT = "data/cond-yield/pairs.json"   # full-history (2000+) pairs at the current week, feeds the Yield Nowcast
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
        yy_all = yields.get(st, {})
        newest = max(ge[st])   # (yr, wk) -- the newest year with a RATING
        # HOLD THE CURRENT YEAR OUT OF ITS OWN FIT, ONCE, HERE.
        #
        # Until harvest is final, what NASS returns for the current year is a
        # forecast, and this file's whole output is a number that predicts the
        # current year. It was leaking in twice:
        #
        #   1. the pair filter read `int(y) < newest[0] + 1`, i.e. `<=`, so the
        #      year being predicted was a training point. Measured on the live
        #      file 2026-09-08: IA corn week 35 published n=27 (2000..2026)
        #      while emit_pairs, the correct form in the same file, used n=26.
        #   2. detrend() was handed every year including the current one, so a
        #      forecast also bent the trend line that every OTHER year's
        #      deviation is measured against -- a subtler leak that survives
        #      fixing the filter alone.
        #
        # Both are closed by cutting the dictionary before either runs.
        yy = {y: v for y, v in yy_all.items() if int(y) < newest[0]}
        if len(yy) < MIN_N:
            continue
        dev = detrend(yy)
        weeks = {}
        for wk in WEEKS:
            pairs = [(ge[st][(int(y), wk)], yy[y], dev[y]) for y in yy
                     if (int(y), wk) in ge[st]]
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


def emit_pairs(ge, yields):
    """Full-history (year, ge, final_yield) pairs at the CURRENT ISO week —
    the Yield Nowcast's food. 26 paired years beat the 16 available from the
    repo-local NASS mirrors, which is the whole point of emitting this here."""
    newest = max(k for st in ge for k in ge[st])          # (yr, wk) globally
    cur_yr, cur_wk = newest
    states = {}
    latest_ge = {}
    for st in sorted(ge):
        yy = yields.get(st, {})
        rows = [[int(y), ge[st][(int(y), cur_wk)], yy[y]] for y in yy
                if (int(y), cur_wk) in ge[st] and int(y) < cur_yr]
        rows.sort()
        if len(rows) >= 12:
            states[st] = rows
        if (cur_yr, cur_wk) in ge[st]:
            latest_ge[st] = round(ge[st][(cur_yr, cur_wk)], 1)
    return {"year": cur_yr, "week": cur_wk, "states": states, "latest_ge": latest_ge}


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
    cached = {}
    for slug, (desc, ysd) in CROPS.items():
        print(f"{slug}:")
        ge, yields = collect(desc, ysd, api_get)
        cached[slug] = (ge, yields)
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
    pairs_out = {"generated": out["generated"],
                 "note": "Full-history (2000+) same-week G+E vs final-yield pairs for the Yield Nowcast. Rebuilt weekly; current year excluded from pairs (it has no final yield yet).",
                 "crops": {slug: emit_pairs(*cached[slug]) for slug in cached}}
    json.dump(pairs_out, open(PAIRS_OUT, "w"), separators=(",", ":"))
    print(f"wrote {PAIRS_OUT} ({sum(len(c['states']) for c in pairs_out['crops'].values())} state panels)")


def _iso_monday(year, week):
    """The Monday of an ISO week, as YYYY-MM-DD. Selftest fixture only."""
    from datetime import date as _d
    return _d.fromisocalendar(year, week, 1).isoformat()


def selftest():
    """Synthetic: G+E linearly tied to detrended yield at week 30, noise at 25."""
    import random
    rnd = random.Random(7)
    # THE FIXTURE MUST CONTAIN A CURRENT YEAR, or the look-ahead is invisible.
    # It used to run 2000..2025 for BOTH conditions and yields, so every year
    # with a rating also had a final yield and `int(y) < newest[0] + 1` could
    # not be caught. 2026 here has ratings and a yield that is a FORECAST --
    # deliberately absurd, 400 bu, so that if it ever enters a fit the numbers
    # move far enough to be unmistakable.
    FORECAST_YEAR, FORECAST_YIELD = 2026, 400.0

    def fake(params):
        sd = params["short_desc"]
        if "YIELD" in sd:
            assert params["reference_period_desc"] == "YEAR"
            rows = [{"state_alpha": "IA", "year": yr, "Value": str(150 + 2 * (yr - 2000) + ((yr * 7) % 11 - 5))}
                    for yr in range(2000, 2026)]
            rows.append({"state_alpha": "IA", "year": FORECAST_YEAR,
                         "Value": str(FORECAST_YIELD)})
            return rows
        rows = []
        base = 30.0 if "GOOD" in sd else 10.0
        for yr in range(2000, 2027):
            dev = (yr * 7) % 11 - 5                     # same deviation the yield carries
            # week 30: G+E tracks deviation; week 25: pure noise.
            # THE DATE IS COMPUTED FROM THE ISO WEEK, not a fixed "06-22" that
            # drifts a week either side depending on the year. With the fixed
            # dates, 5 of 27 years landed in weeks 26 and 31 instead, which
            # thinned every fit and left emit_pairs below its 12-row floor.
            for wk, we in ((25, _iso_monday(yr, 25)), (30, _iso_monday(yr, 30))):
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

    # ── THE LOOK-AHEAD CHECK ────────────────────────────────────────────────
    # Not "is n the number I expect" -- that just restates the filter. The
    # property is that the CURRENT YEAR CANNOT CHANGE THE ANSWER. Its yield is
    # a forecast, so run shape() again with that year's yield removed
    # entirely: if it is being held out, both runs are identical. The fixture
    # gives it 400 bu, so any leak -- through the pair filter OR through
    # detrend() bending the trend line -- moves r2 or slope far enough to be
    # unmistakable.
    #
    # This is what the old fixture could not see: it ran 2000..2025 for both
    # ratings and yields, so every rated year also had a FINAL yield and there
    # was no current year to leak.
    yields_final_only = {st: {y: v for y, v in d.items() if int(y) != FORECAST_YEAR}
                         for st, d in yields.items()}
    pkg_ref = shape(ge, yields_final_only)
    assert pkg["IA"]["weeks"] == pkg_ref["IA"]["weeks"], (
        "the current year's forecast changes the published fit -- it is "
        "leaking into the regression it is supposed to be predicted by.\n"
        f"  with forecast: {pkg['IA']['weeks'].get('30')}\n"
        f"  without      : {pkg_ref['IA']['weeks'].get('30')}")
    # ...and the current year IS in the ratings, so that check is exercising
    # the hold-out rather than an empty case.
    assert pkg["IA"]["latest"]["year"] == FORECAST_YEAR, pkg["IA"]["latest"]

    # emit_pairs has always had the right filter. Pin the two together so they
    # cannot drift apart again -- they did, and one published a wrong n for
    # months while the other sat twelve lines below it being correct.
    ep = emit_pairs(ge, yields)
    yrs = [r[0] for r in ep["states"]["IA"]]
    assert max(yrs) < FORECAST_YEAR, f"emit_pairs leaked {max(yrs)}"
    print(f"SELFTEST OK — detrended fit finds real signal (wk30 R²={wk30['r2']}) "
          f"and refuses fake signal (wk25 R²={wk25['r2']}); n gating on; "
          f"current year cannot move the fit (n={wk30['n']})")


if __name__ == "__main__":
    main()
