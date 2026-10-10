#!/usr/bin/env python3
"""county_yield.py: the one place a county yield figure is fitted, withheld
and named.

Before 2026-10 the site carried three least-squares fits (fetch_cash_rent
fit_trend, build_farmland_atlas ols, build_state_yield_pages ols_slope) and
four unlabelled corn yields for one county. Story County, Iowa read 188.7,
207.5, 204.0, 217 and 223.8 on different pages with nothing saying which was
which. Every builder now fits through ols() here, withholds through trend()
here, and names the figure with one of the label functions here.

THE WITHHOLDING RULE (trend):
  * same practice: the caller passes ONE series (dryland, irrigated or all
    practices). Mixing is the caller's bug; pair_county() in fetch_cash_rent
    decides which series goes with which rent.
  * minimum years: fewer than MIN_TREND_N published years inside the window
    and there is no trend, only the reason.
  * series ends early: a fit is not projected more than MAX_TREND_GAP years
    past its last published year (NASS stopped the Nebraska practice series
    after 2018; a 2012-2018 dryland fit projected to 2026 printed 287 bu for
    Adams NE dryland corn, which yields about 150).

THE NAMES (every yield a page prints carries one of these):
  label_trend(2026)        "15-yr trend (projected 2026)"
  label_year(2025)         "2025 county yield"
  label_avg(2021, 2025)    "2021-25 average"
  LABEL_ARC                "FSA ARC-CO benchmark"
  label_median(2008, 2025) "2008-2025 median"

Pure python, no numpy: the workflow needs none and the math is readable here.

  python3 scripts/county_yield.py --selftest
"""
import math
import sys

TREND_WINDOW = 15     # years of yield history behind the trend
MIN_TREND_N = 6       # fewer published years than this in the window: no trend
MAX_TREND_GAP = 3     # a trend is not projected more than this many years past its last year

LABEL_ARC = "FSA ARC-CO benchmark"

# Critical t for a 95% two-sided interval, df -> t.
_T975 = {1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306,
         9: 2.262, 10: 2.228, 11: 2.201, 12: 2.179, 13: 2.160, 14: 2.145,
         15: 2.131, 16: 2.120, 17: 2.110, 18: 2.101, 19: 2.093, 20: 2.086,
         21: 2.080, 22: 2.074, 23: 2.069, 24: 2.064, 25: 2.060, 26: 2.056,
         27: 2.052, 28: 2.048, 29: 2.045, 30: 2.042, 40: 2.021, 60: 2.000, 120: 1.980}


def t975(df):
    """Critical t for a 95% two-sided interval. Between tabulated rows the value
    for the largest tabulated df AT OR BELOW df is used, which is the conservative
    side (the interval is slightly wider, never narrower, than the exact t)."""
    if df <= 0:
        return None
    if df in _T975:
        return _T975[df]
    return _T975[max(k for k in _T975 if k <= df)]


def ols(pairs):
    """Ordinary least squares y ~ x. pairs: [(x, y)]. -> dict or None when
    there are fewer than 3 points or no spread in x."""
    pts = [(float(x), float(y)) for x, y in pairs if x is not None and y is not None]
    n = len(pts)
    if n < 3:
        return None
    mx = sum(x for x, _ in pts) / n
    my = sum(y for _, y in pts) / n
    sxx = sum((x - mx) ** 2 for x, _ in pts)
    if sxx == 0:
        return None
    sxy = sum((x - mx) * (y - my) for x, y in pts)
    slope = sxy / sxx
    intercept = my - slope * mx
    ss_tot = sum((y - my) ** 2 for _, y in pts)
    ss_res = sum((y - (intercept + slope * x)) ** 2 for x, y in pts)
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0
    se = math.sqrt(ss_res / (n - 2) / sxx) if n > 2 else None
    ci = t975(n - 2) * se if se is not None else None
    return {"slope": slope, "intercept": intercept, "r2": r2, "n": n, "se": se, "ci95": ci}


def ends_early(last_year, cur, max_gap=MAX_TREND_GAP):
    """The reason a series that stopped is not projected, or None."""
    if last_year is None or cur - last_year <= max_gap:
        return None
    return (f"the county series ends in {last_year}; a trend is not "
            f"projected {cur - last_year} years past its last year")


def trend(pairs, cur, window=TREND_WINDOW, min_n=MIN_TREND_N, max_gap=MAX_TREND_GAP):
    """THE TREND RULE. pairs: [(year, yield)] of ONE practice. cur: the year
    the trend is projected to.

    -> {"trend", "slope", "r2", "n", "last", "last_year", "year"} when it holds,
       {"w": reason, "kind": "short" | "ended" | "flat"} when it does not."""
    recent = sorted((int(y), float(v)) for y, v in pairs if v is not None and cur - window < int(y) <= cur)
    if len(recent) < min_n:
        return {"w": f"fewer than {min_n} county yields in the last {window} years", "kind": "short"}
    last_year = recent[-1][0]
    why = ends_early(last_year, cur, max_gap)
    if why:
        return {"w": why, "kind": "ended"}
    fit = ols(recent)
    if not fit:
        return {"w": "no spread in the years to fit a trend", "kind": "flat"}
    return {"trend": round(fit["slope"] * cur + fit["intercept"], 1), "slope": round(fit["slope"], 3),
            "r2": round(fit["r2"], 3), "n": fit["n"], "last": round(recent[-1][1], 1),
            "last_year": last_year, "year": cur}


def recent_avg(hist, last_year=None, years=5, min_n=4):
    """Five years ending at the newest, high and low dropped, at least four
    published. hist: {year: yield} (str or int keys). -> {"from","to","n","avg"} or None."""
    h = {int(k): v for k, v in (hist or {}).items() if v is not None}
    if not h:
        return None
    last = last_year or max(h)
    ys = [k for k in range(last - years + 1, last + 1) if k in h]
    if len(ys) < min_n:
        return None
    vals = sorted(h[k] for k in ys)[1:-1]
    return {"from": last - years + 1, "to": last, "n": len(ys), "avg": sum(vals) / len(vals)}


def label_trend(year, window=TREND_WINDOW):
    return f"{window}-yr trend (projected {year})"


def label_year(year):
    return f"{year} county yield"


def label_avg(a, b):
    return f"{a}-{str(b)[-2:]} average"


def label_median(a, b):
    return f"{a}-{b} median"


PRACTICE_WORDS = {"nonirr": "dryland", "irr": "irrigated", "all": "all practices"}


def selftest():
    # ols on a hand-worked line: y = 2x + 1 exactly
    f = ols([(1, 3), (2, 5), (3, 7), (4, 9)])
    assert abs(f["slope"] - 2) < 1e-12 and abs(f["intercept"] - 1) < 1e-12 and abs(f["r2"] - 1) < 1e-12, f
    # with noise: (0,0),(1,1),(2,1),(3,3): slope 0.9, intercept -0.1 (hand worked)
    f = ols([(0, 0), (1, 1), (2, 1), (3, 3)])
    assert abs(f["slope"] - 0.9) < 1e-12 and abs(f["intercept"] + 0.1) < 1e-12, f
    assert abs(ols([(2020, 1), (2021, 2), (2022, 4)])["slope"] - 1.5) < 1e-12
    assert ols([(1, 5), (2, 5), (3, 5)])["slope"] == 0
    assert ols([(1, 1), (2, 2)]) is None, "fit on 2 points"
    assert ols([(2020, 1.0)] * 8) is None, "no x spread produced a fit"
    assert t975(17) == 2.110 and t975(35) == 2.042 and t975(0) is None
    # a known line is recovered and projected (2011 is outside the 15 years ending 2026)
    t = trend([(y, 2.0 * y - 3830.0) for y in range(2011, 2026)], 2026)
    assert t["trend"] == 222.0 and t["n"] == 14 and t["year"] == 2026 and t["last_year"] == 2025, t
    # the window: 2011 falls out of a 15-year window ending 2026
    assert trend([(y, 100.0 + y - 2000) for y in range(2008, 2026)], 2026)["n"] == 14
    # minimum years
    t = trend([(2021, 180.0), (2022, 181.0), (2023, 182.0), (2024, 183.0), (2025, 184.0)], 2026)
    assert "trend" not in t and t["kind"] == "short" and "fewer than 6" in t["w"], t
    # series ends early: Adams NE dryland corn, 2012-2018 as NASS published it
    adams = [(2012, 51.2), (2013, 97.7), (2014, 111.4), (2015, 128.7), (2016, 121.7), (2017, 147.5), (2018, 159.2)]
    t = trend(adams, 2026)
    assert "trend" not in t and t["kind"] == "ended" and "2018" in t["w"], t
    assert "trend" in trend(adams, 2021)
    # recent average: five years, high and low dropped
    r = recent_avg({"2021": 200, "2022": 100, "2023": 210, "2024": 220, "2025": 230})
    assert r == {"from": 2021, "to": 2025, "n": 5, "avg": 210.0}, r
    assert recent_avg({"2023": 1, "2024": 2, "2025": 3}) is None
    assert label_trend(2026) == "15-yr trend (projected 2026)"
    assert label_year(2025) == "2025 county yield" and label_avg(2021, 2025) == "2021-25 average"
    print("county_yield selftest OK")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
