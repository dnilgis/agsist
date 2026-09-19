#!/usr/bin/env python3
"""
build_farmland_atlas.py — every statistic on /farmland-atlas, in one place.

WHAT THIS IS
  The Farmland Atlas grades Corn Belt and Plains counties on things nobody
  grades: how warm the nights are in July and August and which way they are
  going, how much of the county's cropland only works with irrigation and
  where that water comes from, and what has actually destroyed crops there
  since 1989 according to the insurance record. Each is its own layer. There
  is no combined score, by decision (Sig, 2026-09): heat and water are graded
  separately and never added.

  The page renders. This script computes. Nothing on the page derives a
  number the pipeline did not print, so a reader can re-derive every figure
  from the "show the arithmetic" block beside it.

INPUTS (all optional except cash rent; a missing input withholds its layer
with a reason instead of leaving a hole)
  data/cash-rent/<ST>.json              cash rent + county corn yield (repo)
  data/atlas/raw/heat.json              fetch_atlas_heat.py  (NCEI nClimDiv county)
  data/atlas/raw/water.json             fetch_atlas_water.py (USDA Census 2022 + USGS 2015)
  data/atlas/raw/loss.json              fetch_atlas_loss.py  (RMA cause of loss 1989-)

OUTPUT
  data/atlas/atlas.json                 one record per county, plus the layer
                                        vintages and the thesis test

HONESTY RULES BAKED IN
  * A gap is a gap. Every withheld figure carries `status` naming why.
  * Minimum samples are explicit constants below and printed on the page.
  * The yield trend is the one already published on /cash-rent (15-year
    window, fitted by fetch_cash_rent.py). It is not refitted here so the two
    pages cannot disagree about one county's slope.
  * The thesis test counts the whole search: four correlations are run, all
    four are published, and the significance line is corrected for four.

USAGE
  python scripts/build_farmland_atlas.py --selftest
  python scripts/build_farmland_atlas.py
  python scripts/build_farmland_atlas.py --seed farmland-atlas.html   # also refresh the page's static block
"""

import glob
import json
import math
import os
import re
import statistics
import sys
from datetime import datetime, timezone

from atlas_layers_p1 import (sob_layer, value_layer, crp_layer, drought_layer, energy_layer, wells_layer,
                             national_p1, summarize_p1, seed_p1,
                             MIN_RATIO_PREMIUM, MIN_RATIO_YEARS, MIN_CRP_ACRES, FULL_YEAR_MAPS, HALF_YEAR_WEEKS)

# Corn Belt + Plains. Extend by adding a state here and to ATLAS_STATE_FIPS;
# the geometry file must carry the state too (scripts/atlas_geometry.py).
ATLAS_STATE_FIPS = {
    "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO",
    "09": "CT", "10": "DE", "12": "FL", "13": "GA", "15": "HI", "16": "ID",
    "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA",
    "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS",
    "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ",
    "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK",
    "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN",
    "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV",
    "55": "WI", "56": "WY"}
ATLAS_STATES = sorted(ATLAS_STATE_FIPS.values())

# COUNTY CODES MOVE AND THE FEDERAL SOURCES DO NOT MOVE TOGETHER. The map is
# built from the 2010 Census boundary file (scripts/atlas_geometry.py). NASS is
# still on the old Connecticut county codes -- data/cash-rent/CT.json carries
# 09003 through 09015, not the 2022 planning regions -- while RMA has already
# moved South Dakota's Shannon County to Oglala Lakota. So neither vintage is
# "the" vintage, and picking one would silently drop whichever source disagreed.
# Instead every code a source might emit is folded onto the code the map carries,
# here, at ingest. A code that is not folded and is not on the map is NOT guessed:
# it is named in the unmatched report at the end of the build.
#
# Shannon SD and Wade Hampton AK are renames, so the fold is exact. Bedford city
# VA was absorbed by Bedford County in 2013, so it folds to the county it is now
# part of. Alaska's Valdez-Cordova split in 2019 into Chugach and Copper River;
# the 2010 map has one polygon for the pair, so both new codes fold onto it and
# the page draws them as one place, which is what the map can honestly show.
# Connecticut's nine 2022 planning regions are not a rename of the eight
# counties -- they cross the old lines -- so they are deliberately NOT folded.
# If a source starts publishing them they will appear in the unmatched report,
# which is the signal to go and get a newer boundary file.
# Names a federal file uses for a row that is not a county. Normalised through
# atlas_common.norm_name before the test, so spacing and case do not matter.
def _plain(name):
    return re.sub(r"[^a-z0-9]+", "", (name or "").lower())


PLACEHOLDER_NAMES = {"unknown", "other", "allother", "notspecified", "statetotal", "othercounties", "allothercounties"}

FIPS_ALIAS = {
    "46113": "46102",   # Shannon SD -> Oglala Lakota, 2015-05-01
    "02270": "02158",   # Wade Hampton AK -> Kusilvak, 2015-07-01
    "51515": "51019",   # Bedford city VA -> Bedford County VA, 2013-07-01
    "02063": "02261",   # Chugach AK      -> the 2010 Valdez-Cordova polygon, split 2019-01-02
    "02066": "02261",   # Copper River AK -> the same polygon
}


def fold(fips):
    """The code the map carries, for a code a federal file published."""
    return FIPS_ALIAS.get(fips, fips)


def fold_keys(d):
    """Re-key a {fips: rec} layer onto the map's codes. A fold that collides --
    two source codes onto one polygon -- keeps the first by sorted code order and
    reports the second, because merging two counties' numbers would invent a
    figure neither source published."""
    if not d:
        return d, []
    out, merged = {}, []
    for f in sorted(d):
        t = fold(f)
        if t in out and t != f:
            merged.append(f)
            continue
        out[t] = d[f]
    return out, merged

RENT_DIR = "data/cash-rent"
RAW_DIR = "data/atlas/raw"
OUT = "data/atlas/atlas.json"

# Gates. Printed on the page beside the figure they protect.
MIN_PREMIUM_PAIRS = 6      # paired irrigated/non-irrigated rent years for a premium trend
MIN_LEADER_PAIRS = 8       # and for a place on the fastest-rising / fastest-falling tables
MIN_YIELD_N = 8            # observed county yields for the worst-year line
MIN_HEAT_TREND_N = 40      # Julys in the 50-year window for a trend
MIN_HEAT_LEVEL_N = 8       # of the last 10 Julys for a recent level
MIN_NORMAL_N = 27          # of 30 for a 1991-2020 normal
MIN_LOSS_PREMIUM = 1_000_000   # dollars of premium in a period before a loss ratio is printed (phase 2)
MIN_LOSS_INDEM = 100_000       # dollars of indemnity in a period before shares are printed
MIN_THESIS_N = 200         # counties before a cross-county correlation is printed

HEAT_TREND_START = 1976    # 50 Julys through 2025
HOT_JULY_F = 70.0          # a July whose average low was at or above this. Extension
                           # literature puts the harm line for corn at nightly lows above
                           # 70 F (Ohio State C.O.R.N. 2019-27; High Plains Journal 2026-09-03).
                           # A monthly MEAN low at 70 means most nights were above it.
REFERENCE_LINES_F = [58, 60, 62, 64, 66, 68, 70, 72]   # decade-crossing lines for the slider

CAUSE_GROUPS = ["heat_drought", "wet", "hail", "wind", "cold", "irrigation", "price", "unassigned", "other"]
LOSS_RATIO_WITHHELD = ("withheld here: the cause-of-loss file carries premium only on rows with a loss; "
                       "the county loss ratio is computed from RMA's Summary of Business premium in the Loss ratio card")


def log(*a):
    print(*a, flush=True)


# ---------------------------------------------------------------- statistics

# two-sided 97.5% t critical values by degrees of freedom; beyond 30 use 1.96+
_T975 = {1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365,
         8: 2.306, 9: 2.262, 10: 2.228, 11: 2.201, 12: 2.179, 13: 2.160, 14: 2.145,
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
    below = max(k for k in _T975 if k <= df)
    return _T975[below]


def ols(pairs):
    """OLS y ~ x. pairs: list of (x, y). Returns dict or None (n < 3 or no x spread)."""
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
    return {"slope": slope, "intercept": intercept, "r2": r2, "n": n,
            "se": se, "ci95": ci}


def pearson(pairs):
    pts = [(float(x), float(y)) for x, y in pairs if x is not None and y is not None]
    n = len(pts)
    if n < 3:
        return None
    mx = sum(x for x, _ in pts) / n
    my = sum(y for _, y in pts) / n
    sxx = sum((x - mx) ** 2 for x, _ in pts)
    syy = sum((y - my) ** 2 for _, y in pts)
    # a column of identical values leaves a spread of ~1e-30 from float rounding,
    # which is not spread; the relative test catches it, the equality test did not
    if sxx <= 1e-12 * n * max(1.0, mx * mx) or syy <= 1e-12 * n * max(1.0, my * my):
        return None
    r = sum((x - mx) * (y - my) for x, y in pts) / math.sqrt(sxx * syy)
    # two-sided p from t = r*sqrt((n-2)/(1-r^2)); normal approximation is fine at n >= 200
    if abs(r) >= 1:
        p = 0.0
    else:
        t = r * math.sqrt((n - 2) / (1 - r * r))
        p = 2 * (1 - _phi(abs(t)))
    return {"r": r, "n": n, "p": p}


def _phi(z):
    return 0.5 * (1 + math.erf(z / math.sqrt(2)))


def r1(x, k=1):
    return None if x is None else round(x, k)


def direction(slope, ci, up="rising", down="falling", k=2):
    """Called on the values AS PRINTED (rounded to k decimals), so a reader who
    checks slope against the interval beside it reaches the same call."""
    if slope is None or ci is None:
        return "no clear direction"
    s, c = round(slope, k), round(ci, k)
    if s - c > 0:
        return up
    if s + c < 0:
        return down
    return "no clear direction"


def half_up(x):
    """Round half away from zero, like the page's rounding; Python's round() is half to even."""
    return int(math.floor(abs(x) + 0.5)) * (-1 if x < 0 else 1)


def record_sha(rec):
    import hashlib
    return hashlib.sha1(json.dumps(rec, sort_keys=True, separators=(",", ":"), default=str).encode()).hexdigest()[:16]


def decade_of(year):
    return f"{(year // 10) * 10}s"


# ---------------------------------------------------------------- rent + yield (repo)

def load_rent(rent_dir=RENT_DIR, states=ATLAS_STATES):
    out = {}
    vintage = None
    for st in states:
        p = os.path.join(rent_dir, f"{st}.json")
        if not os.path.exists(p):
            log(f"  rent: no file for {st}")
            continue
        with open(p, encoding="utf-8") as f:
            d = json.load(f)
        vintage = max(vintage or "", d.get("generated", "") or "")
        for c in d.get("counties", []):
            out[c["fips"]] = {"name": c["name"], "state": st,
                              "rent": c.get("rent", {}), "yield": c.get("yield", {})}
    return out, vintage


def rent_layer(rent):
    """Latest rent per kind, the 10-year change on non-irrigated, and the series."""
    def latest(series):
        if not series:
            return None
        y = max(series, key=int)
        return {"year": int(y), "value": series[y]}

    def change10(series):
        if not series:
            return None
        ys = sorted(int(y) for y in series)
        last = ys[-1]
        # the survey skipped 2015 and some counties skip years; take the closest
        # published year at or before last-10 but not older than last-12
        cands = [y for y in ys if last - 12 <= y <= last - 10]
        if not cands:
            return None
        base = max(cands)
        b, l = series[str(base)], series[str(last)]
        if not b:
            return None
        return {"from_year": base, "to_year": last, "from": b, "to": l,
                "pct": round((l - b) / b * 100, 1)}

    non = rent.get("nonirr") or {}
    irr = rent.get("irr") or {}
    pas = rent.get("pasture") or {}
    rec = {
        "status": "ok" if non else "withheld: NASS published no non-irrigated cash rent for this county",
        "nonirr": latest(non),
        "nonirr_change10": change10(non),
        "irr": latest(irr),
        "pasture": latest(pas),
        "series_nonirr": {int(k): v for k, v in non.items()},
        "series_irr": {int(k): v for k, v in irr.items()},
    }
    return rec


def yield_layer(yld):
    """County corn yield trend fitted here on EVERY published year (2008 onward).

    /cash-rent publishes its own fit over the last fifteen years, which as of
    2026 means 2012 to 2024: it starts on the drought year, so that slope is
    mostly how deep 2012 was and it will jump the year 2012 drops out (measured
    2026-09-13 on 1,022 Atlas counties: median county slope 2.82 over 2012-2024,
    1.80 over 2013-2024). The
    Atlas therefore fits the whole record and says so; the two pages print two
    labelled windows, not two answers to one question.

    The median and the worst year are observations, not fits."""
    corn = (yld or {}).get("corn") or {}
    hist = {int(k): v for k, v in (corn.get("hist") or {}).items() if v}
    if len(hist) < MIN_YIELD_N:
        return {"status": f"withheld: fewer than {MIN_YIELD_N} published county corn yields", "hist": hist}
    vals = list(hist.values())
    med = statistics.median(vals)
    wy = min(hist, key=lambda y: hist[y])
    fit = ols(sorted(hist.items()))
    rec = {
        "status": "ok",
        "last_year": max(hist), "first_year": min(hist), "n": len(hist),
        "median": round(med, 1),
        "worst": {"year": wy, "value": hist[wy], "share_of_median": round(hist[wy] / med, 3)},
        "hist": hist,
        "cash_rent_slope": corn.get("slope"),      # the /cash-rent 15-year fit, kept for reference
    }
    if fit and len(hist) >= 10:
        rec.update({"slope": round(fit["slope"], 3), "slope_ci95": round(fit["ci95"], 3) if fit["ci95"] is not None else None,
                    "r2": round(fit["r2"], 3), "window": f"{min(hist)}-{max(hist)}"})
    else:
        rec["slope"] = None
        rec["trend_status"] = "withheld: fewer than 10 published years for a trend"
    return rec


def water_premium_layer(rent):
    """Irrigated minus non-irrigated cash rent, same county, same year. The land
    market's own price on water. Trend is OLS on the premium in dollars."""
    non = {int(k): v for k, v in (rent.get("nonirr") or {}).items() if v}
    irr = {int(k): v for k, v in (rent.get("irr") or {}).items() if v}
    years = sorted(set(non) & set(irr))
    if not irr:
        return {"status": "withheld: NASS published no irrigated cash rent for this county (little or no irrigated cropland surveyed)"}
    if not non:
        return {"status": "withheld: NASS published no non-irrigated cash rent for this county"}
    series = {y: round(irr[y] - non[y], 1) for y in years}
    ratio = {y: round(irr[y] / non[y], 3) for y in years}
    rec = {"n_pairs": len(years), "series": series, "ratio": ratio}
    if len(years) < MIN_PREMIUM_PAIRS:
        rec["status"] = f"withheld: only {len(years)} paired years, gate is {MIN_PREMIUM_PAIRS}"
        return rec
    fit = ols([(y, series[y]) for y in years])
    first, last = years[0], years[-1]
    rec.update({
        "status": "ok",
        "first": {"year": first, "irr": irr[first], "nonirr": non[first], "premium": series[first], "ratio": ratio[first]},
        "latest": {"year": last, "irr": irr[last], "nonirr": non[last], "premium": series[last], "ratio": ratio[last]},
        "slope_per_year": r1(fit["slope"], 2) if fit else None,
        "slope_ci95": r1(fit["ci95"], 2) if fit and fit["ci95"] is not None else None,
        "r2": r1(fit["r2"], 3) if fit else None,
        # "rising"/"falling" of the premium itself. Not "widening": a premium that
        # goes from $0 to -$29 is falling, and the gap is not narrowing in any
        # sense a tenant would recognise.
        "direction": direction(fit["slope"], fit["ci95"]) if fit else "no clear direction",
    })
    return rec


# ---------------------------------------------------------------- heat (NCEI)

NOT_YET = "not yet measured: this layer publishes after the first data run"


def heat_layer(h, latest_year, ran=False):
    """h: {"jul": {year: F}, "aug": {year: F}} for one county. Values are the monthly
    mean of daily minimum temperature, degrees F, from NCEI nClimDiv county.
    ran: the heat fetch has run, so an absent county is a gap in NCEI, not a pending run."""
    if not h:
        return {"status": "withheld: NCEI publishes no series for this county"} if ran else {"status": NOT_YET}
    if latest_year is None:
        return {"status": "withheld: the heat file carries no complete year"}
    out = {"status": "ok", "months": {}}
    for m in ("jul", "aug"):
        s = {int(k): v for k, v in (h.get(m) or {}).items() if v is not None}
        rec = {"n_years": len(s)}
        if not s:
            rec["status"] = "withheld: NCEI has no county series"
            out["months"][m] = rec
            continue
        # recent level: last 10 years ending at latest_year
        rec_years = [y for y in range(latest_year - 9, latest_year + 1) if y in s]
        if len(rec_years) >= MIN_HEAT_LEVEL_N:
            rec["recent"] = {"from": latest_year - 9, "to": latest_year, "n": len(rec_years),
                             "mean": round(sum(s[y] for y in rec_years) / len(rec_years), 1)}
        else:
            rec["recent"] = {"status": f"withheld: {len(rec_years)} of the last 10 years present, gate is {MIN_HEAT_LEVEL_N}"}
        norm_years = [y for y in range(1991, 2021) if y in s]
        if len(norm_years) >= MIN_NORMAL_N:
            rec["normal_1991_2020"] = {"n": len(norm_years),
                                       "mean": round(sum(s[y] for y in norm_years) / len(norm_years), 1)}
        else:
            rec["normal_1991_2020"] = {"status": f"withheld: {len(norm_years)} of 30 years present, gate is {MIN_NORMAL_N}"}
        # trend over the 50-year window, degrees F per decade
        tw = [(y, s[y]) for y in range(HEAT_TREND_START, latest_year + 1) if y in s]
        if len(tw) >= MIN_HEAT_TREND_N:
            fit = ols(tw)
            rec["trend"] = {"from": HEAT_TREND_START, "to": latest_year, "n": len(tw),
                            "per_decade": round(fit["slope"] * 10, 2),
                            "ci95_per_decade": round(fit["ci95"] * 10, 2) if fit["ci95"] is not None else None,
                            "r2": round(fit["r2"], 3),
                            "direction": direction(fit["slope"] * 10, fit["ci95"] * 10 if fit["ci95"] is not None else None, "warming", "cooling")}
        else:
            rec["trend"] = {"status": f"withheld: {len(tw)} of {latest_year - HEAT_TREND_START + 1} Julys present, gate is {MIN_HEAT_TREND_N}"}
        # the whole record, so a reader can see what the 1976 start point does
        tl = [(y, s[y]) for y in sorted(s) if y <= latest_year]
        if len(tl) >= 80:
            fl = ols(tl)
            rec["trend_full"] = {"from": tl[0][0], "to": latest_year, "n": len(tl), "per_decade": round(fl["slope"] * 10, 2),
                                 "ci95_per_decade": round(fl["ci95"] * 10, 2) if fl["ci95"] is not None else None}
        # decade means and hot-month counts, 1900s onward
        dec = {}
        for y, v in s.items():
            if y < 1900:
                continue
            d = decade_of(y)
            dd = dec.setdefault(d, {"sum": 0.0, "n": 0, "hot": 0})
            dd["sum"] += v
            dd["n"] += 1
            if v >= HOT_JULY_F:
                dd["hot"] += 1
        rec["decades"] = {d: {"mean": round(x["sum"] / x["n"], 1), "n": x["n"], "hot": x["hot"]}
                          for d, x in sorted(dec.items())}
        # the first decade (with at least 5 years) whose mean sits at or above each line
        cross = {}
        for line in REFERENCE_LINES_F:
            first = None
            for d, x in sorted(dec.items()):
                if x["n"] >= 5 and x["sum"] / x["n"] >= line:
                    first = d
                    break
            cross[str(line)] = first
        rec["first_decade_at_or_above"] = cross
        rec["series"] = s
        out["months"][m] = rec
    return out


# ---------------------------------------------------------------- water (Census + USGS)

GAL_PER_ACRE_FT = 325851.0


def water_layer(w, ran=False, absent_is_zero=False):
    """w: {"census2022": {"harvested": acres, "irrigated": acres},
           "usgs2015": {"ir_gw_mgd", "ir_sw_mgd", "ir_tot_mgd", "ir_acres_k"}}"""
    if not w:
        return {"status": "withheld: neither the census nor USGS has a row for this county"} if ran else {"status": NOT_YET}
    out = {"status": "ok"}
    c = w.get("census2022") or {}
    if c.get("harvested") and c.get("irrigated") is not None:
        out["irrigated_share_2022"] = {"harvested_acres": c["harvested"], "irrigated_acres": c["irrigated"],
                                       "share": round(c["irrigated"] / c["harvested"], 3)}
    elif c.get("harvested") and c.get("irrigated") is None and c.get("irrigated_published"):
        out["irrigated_share_2022"] = {"harvested_acres": c["harvested"],
                                       "status": "withheld: NASS suppressed the irrigated acres (D)"}
    elif c.get("harvested") and c.get("irrigated") is None and absent_is_zero:
        # NASS published no irrigated row and, measured at fetch time, published
        # no explicit zeros either, so absence is how the census says "none".
        # Carried as 0 with `reported` false; the card says "none reported".
        out["irrigated_share_2022"] = {"harvested_acres": c["harvested"], "irrigated_acres": None, "share": 0.0,
                                       "reported": False,
                                       "note": "NASS published no irrigated-acres row; the census publishes no zero rows, so no farm reported irrigated harvested cropland"}
    elif c.get("harvested") and c.get("irrigated") is None:
        out["irrigated_share_2022"] = {"harvested_acres": c["harvested"],
                                       "status": "withheld: NASS published no irrigated-acres row, and it does publish zeros, so absence is not zero"}
    else:
        out["irrigated_share_2022"] = {"status": "withheld: NASS published no harvested cropland for this county"}
    u = w.get("usgs2015") or {}
    tot = u.get("ir_tot_mgd")
    gw = u.get("ir_gw_mgd")
    acres_k = u.get("ir_acres_k")
    if tot and gw is not None and tot > 0:
        out["groundwater_share_2015"] = {"gw_mgd": gw, "total_mgd": tot, "share": round(gw / tot, 3),
                                         "basis": u.get("basis", "IC")}      # IC = crop irrigation; IR = all irrigation incl. golf
    elif tot == 0 or tot is None:
        out["groundwater_share_2015"] = {"status": "withheld: USGS reports no irrigation withdrawal for this county"}
    if tot and acres_k and acres_k >= 1:      # under 1,000 irrigated acres the ratio is noise
        ft = tot * 365 * 1e6 / GAL_PER_ACRE_FT / (acres_k * 1000)
        out["applied_2015"] = {"total_mgd": tot, "irrigated_acres": int(round(acres_k * 1000)),
                               "acre_ft_per_acre": round(ft, 2)}
    elif tot and acres_k:
        out["applied_2015"] = {"status": "withheld: under 1,000 irrigated acres"}
    return out


# ---------------------------------------------------------------- loss (RMA)

def loss_layer(l, latest_year, ran=False, partial_year=None):
    """l: {"years": {year: {group: {"indem": $, "prem": $, "liab": $}}},
           "corn": {year: {group: {...}}}}   (aggregated by fetch_atlas_loss.py)
    partial_year: the crop year RMA is still settling (the current one)."""
    if not l:
        return {"status": "withheld: RMA has no cause-of-loss rows for this county"} if ran else {"status": NOT_YET}
    years = {int(k): v for k, v in (l.get("years") or {}).items()}
    if not years:
        return {"status": "withheld: RMA has no cause-of-loss rows for this county"}
    periods = [("1989-1999", 1989, 1999), ("2000-2009", 2000, 2009),
               ("2010-2019", 2010, 2019), (f"2020-{latest_year}", 2020, latest_year)]
    out = {"status": "ok", "first_year": min(years), "last_year": max(years), "periods": {},
           "partial_year": partial_year if partial_year and partial_year in years else None,
           "prf_excluded_indemnity": round(l.get("prf_indemnity", 0) or 0)}
    all_ind = 0.0
    all_prem = 0.0
    by_group_all = {g: 0.0 for g in CAUSE_GROUPS}
    per_year = {}
    for y, groups in sorted(years.items()):
        ti = sum(v.get("indem", 0) for v in groups.values())
        tp = sum(v.get("prem", 0) for v in groups.values())
        hd = groups.get("heat_drought", {}).get("indem", 0)
        per_year[y] = {"indem": round(ti), "prem": round(tp), "heat_drought": round(hd)}
        all_ind += ti
        all_prem += tp
        for g, v in groups.items():
            by_group_all[g] = by_group_all.get(g, 0) + v.get("indem", 0)
    out["per_year"] = per_year
    out["total_indemnity"] = round(all_ind)
    # The cause-of-loss file carries premium only on rows that had a loss, so
    # indemnity / that premium overstates the county's true loss ratio. It is
    # withheld until the Summary of Business county premium is fetched (phase 2).
    # The fields stay so the page and the tests do not change shape when it is.
    out["loss_ratio_all"] = None
    out["loss_ratio_status"] = LOSS_RATIO_WITHHELD
    if all_ind >= MIN_LOSS_INDEM:
        out["share_all"] = {g: round(v / all_ind, 3) for g, v in by_group_all.items()}
        out["top_cause_all"] = max(by_group_all, key=by_group_all.get)
    else:
        out["share_all"] = None
    for label, a, b in periods:
        ind = {g: 0.0 for g in CAUSE_GROUPS}
        prem = 0.0
        n = 0
        for y in range(a, b + 1):
            if y not in years:
                continue
            n += 1
            for g, v in years[y].items():
                ind[g] = ind.get(g, 0) + v.get("indem", 0)
                prem += v.get("prem", 0)
        ti = sum(ind.values())
        rec = {"years_present": n, "indemnity": round(ti)}
        rec["loss_ratio"] = None
        rec["loss_ratio_status"] = LOSS_RATIO_WITHHELD
        if ti >= MIN_LOSS_INDEM:
            rec["share"] = {g: round(v / ti, 3) for g, v in ind.items()}
            rec["top_cause"] = max(ind, key=ind.get)
            rec["heat_drought_share"] = rec["share"]["heat_drought"]
        else:
            rec["share_status"] = f"withheld: under ${MIN_LOSS_INDEM:,} of indemnity in the period"
        out["periods"][label] = rec
    # irrigation failure, all years: a direct water-security signal
    out["irrigation_failure_indemnity"] = round(by_group_all.get("irrigation", 0))
    # corn only, all years
    corn = {int(k): v for k, v in (l.get("corn") or {}).items()}
    if corn:
        ci = {g: 0.0 for g in CAUSE_GROUPS}
        cp = 0.0
        for y, groups in corn.items():
            for g, v in groups.items():
                ci[g] = ci.get(g, 0) + v.get("indem", 0)
                cp += v.get("prem", 0)
        tci = sum(ci.values())
        out["corn"] = {"indemnity": round(tci),
                       "loss_ratio": None, "loss_ratio_status": LOSS_RATIO_WITHHELD,
                       "share": {g: round(v / tci, 3) for g, v in ci.items()} if tci >= MIN_LOSS_INDEM else None,
                       "top_cause": max(ci, key=ci.get) if tci >= MIN_LOSS_INDEM else None}
    return out


# ---------------------------------------------------------------- across the Atlas

def national(counties, loss_latest):
    """Sums and counts across every county, for the page's summary and the static
    seed. Every figure here is a count of counties or a sum of published dollars;
    nothing is averaged across counties of different size."""
    out = {}
    # heat
    trend_n = warming = cooling = 0
    slopes = []
    warmest_last = 0
    hot_by_decade = {}
    n_hot = 0
    by_state = {}
    for c in counties.values():
        j = ((c.get("heat") or {}).get("months") or {}).get("jul") or {}
        t = j.get("trend") or {}
        if t.get("per_decade") is not None:
            trend_n += 1
            slopes.append(t["per_decade"])
            bs = by_state.setdefault(c["state"], {"counties": 0, "warming": 0, "cooling": 0, "slopes": []})
            bs["counties"] += 1
            bs["slopes"].append(t["per_decade"])
            if t["direction"] == "warming":
                warming += 1
                bs["warming"] += 1
            elif t["direction"] == "cooling":
                cooling += 1
                bs["cooling"] += 1
        d = j.get("decades") or {}
        if d:
            n_hot += 1
            full = {k: v for k, v in d.items() if v["n"] >= 10}      # complete decades only
            if full:
                last = sorted(full)[-1]
                if full[last]["mean"] >= max(v["mean"] for v in full.values()):
                    warmest_last += 1
            for k, v in d.items():
                hb = hot_by_decade.setdefault(k, {"hot": 0, "counties": 0})
                hb["hot"] += v.get("hot", 0)
                hb["counties"] += 1
    if trend_n:
        # where the warming is: by state, counted, not averaged across county sizes
        out["heat_by_state"] = {st: {"counties": v["counties"], "warming": v["warming"], "cooling": v["cooling"],
                                     "share_warming": round(v["warming"] / v["counties"], 3),
                                     "median_trend_per_decade": round(statistics.median(v["slopes"]), 2)}
                                for st, v in sorted(by_state.items(), key=lambda kv: -kv[1]["warming"] / kv[1]["counties"])}
        out["heat"] = {"counties_with_trend": trend_n, "warming": warming, "cooling": cooling,
                       "no_clear_direction": trend_n - warming - cooling,
                       "median_trend_per_decade": round(statistics.median(slopes), 2),
                       "latest_full_decade": max((k for k, v in hot_by_decade.items()), default=None),
                       "latest_decade_is_warmest": warmest_last, "counties_with_decades": n_hot,
                       "hot_julys_by_decade": hot_by_decade}
    # water
    shares = [c["water"]["irrigated_share_2022"]["share"] for c in counties.values()
              if (c.get("water") or {}).get("status") == "ok" and (c["water"].get("irrigated_share_2022") or {}).get("share") is not None]
    gws = [c["water"]["groundwater_share_2015"]["share"] for c in counties.values()
           if (c.get("water") or {}).get("status") == "ok" and (c["water"].get("groundwater_share_2015") or {}).get("share") is not None]
    if shares:
        out["water"] = {"counties_with_share": len(shares), "median_irrigated_share": round(statistics.median(shares), 3),
                        "over_half_irrigated": sum(1 for x in shares if x >= 0.5),
                        "over_quarter_irrigated": sum(1 for x in shares if x >= 0.25),
                        "counties_with_gw_share": len(gws), "gw_over_90pct": sum(1 for x in gws if x >= 0.9)}
    # premium
    prem = [c["water_premium"] for c in counties.values() if (c.get("water_premium") or {}).get("status") == "ok"]
    if prem:
        out["premium"] = {"counties": len(prem), "rising": sum(1 for p in prem if p["direction"] == "rising"),
                          "falling": sum(1 for p in prem if p["direction"] == "falling"),
                          # 284 separate 95% tests: about 2.5% would be called in each direction by luck
                          "expected_by_chance_each_way": round(len(prem) * 0.025, 1)}
    # loss: dollars summed across counties, by period and group
    # dollars are summed from every county's per-year totals, gated or not, so
    # the national share has the same denominator as its numerator
    tot = 0.0
    by_period = {}
    irr = 0.0
    n_loss = 0
    prf = 0.0
    for c in counties.values():
        lo = c.get("loss") or {}
        if lo.get("status") != "ok":
            continue
        n_loss += 1
        tot += lo.get("total_indemnity", 0) or 0
        irr += lo.get("irrigation_failure_indemnity", 0) or 0
        prf += lo.get("prf_excluded_indemnity", 0) or 0
        for y, r in (lo.get("per_year") or {}).items():
            y = int(y)
            label = next((k for k in lo.get("periods", {}) if _in_period(k, y)), None)
            if not label:
                continue
            bp = by_period.setdefault(label, {"indemnity": 0.0, "heat_drought": 0.0})
            bp["indemnity"] += r.get("indem", 0) or 0
            bp["heat_drought"] += r.get("heat_drought", 0) or 0
    if n_loss:
        periods = {}
        for k in sorted(by_period):
            bp = by_period[k]
            periods[k] = {"indemnity": round(bp["indemnity"]),
                          "heat_drought_share": round(bp["heat_drought"] / bp["indemnity"], 3) if bp["indemnity"] >= MIN_LOSS_INDEM else None}
        out["loss"] = {"counties": n_loss, "total_indemnity": round(tot), "irrigation_failure_indemnity": round(irr),
                       "prf_excluded_indemnity": round(prf), "periods": periods, "latest_year": loss_latest}
    return out


def _in_period(label, year):
    a, b = label.split("-")
    return int(a) <= year <= int(b)


# ---------------------------------------------------------------- thesis test

def thesis_test(counties):
    """Across counties: does the /cash-rent corn yield slope (bu/ac/yr, 15-yr window)
    move with July or August night heat?

    Two versions of each test. RAW correlates counties as they are; it is confounded
    by geography, because night heat rises to the south and so do several things
    that also move yield trends (soils, season length, state programs). WITHIN-STATE
    subtracts each state's mean from both variables first, so a county is compared
    with its own state's counties. Within-state is the version the verdict reads.
    Eight tests are run; all eight are published; the odds are corrected for eight."""
    tests = [("jul", "recent", "July mean low, last 10 years (F)"),
             ("jul", "trend", "July mean low trend since 1976 (F/decade)"),
             ("aug", "recent", "August mean low, last 10 years (F)"),
             ("aug", "trend", "August mean low trend since 1976 (F/decade)")]
    results = []
    any_heat = False
    n_tests = len(tests) * 2
    for m, kind, label in tests:
        pairs = []
        for fips, c in counties.items():
            y = c.get("yield") or {}
            h = ((c.get("heat") or {}).get("months") or {}).get(m) or {}
            if y.get("status") != "ok" or y.get("slope") is None or (y.get("n") or 0) < 10:
                continue
            x = (h.get("recent") or {}).get("mean") if kind == "recent" else (h.get("trend") or {}).get("per_decade")
            if x is None:
                continue
            any_heat = True
            pairs.append((x, y["slope"], fips))
        for scope in ("raw", "within_state"):
            rec = {"month": m, "kind": kind, "scope": scope, "x": label,
                   "y": "county corn yield trend, bu/ac per year, fitted on every published year since 2008", "n": len(pairs)}
            pts = pairs
            if scope == "within_state":
                by = {}
                for x, yv, f in pairs:
                    by.setdefault(f[:2], []).append((x, yv, f))
                pts = []
                for st, lst in by.items():
                    if len(lst) < 5:
                        continue
                    mx = sum(t[0] for t in lst) / len(lst)
                    my = sum(t[1] for t in lst) / len(lst)
                    pts.extend((x - mx, yv - my, f) for x, yv, f in lst)
                rec["n"] = len(pts)
            if len(pts) < MIN_THESIS_N:
                rec["status"] = f"withheld: {len(pts)} counties, gate is {MIN_THESIS_N}"
                results.append(rec)
                continue
            p = pearson([(x, yv) for x, yv, _ in pts])
            if p is None:
                rec["status"] = "withheld: no spread in x"
                results.append(rec)
                continue
            rec.update({"status": "ok", "r": round(p["r"], 3), "p": p["p"],
                        "p_corrected": min(1.0, p["p"] * n_tests)})
            xs = sorted(pts, key=lambda t: t[0])
            k = len(xs) // 5
            if k >= 20:
                cool = [t[1] for t in xs[:k]]
                hot = [t[1] for t in xs[-k:]]
                rec["fifths"] = {"n_each": k,
                                 "coolest_mean_slope": round(sum(cool) / k, 2),
                                 "hottest_mean_slope": round(sum(hot) / k, 2)}
            results.append(rec)
    verdict = None
    if any_heat:
        oks = [r for r in results if r.get("status") == "ok" and r["scope"] == "within_state"]
        if oks:
            def word(r):
                return "faster" if r["r"] > 0 else "more slowly"
            sig = [r for r in oks if r["p_corrected"] < 0.05]
            lvl = [r for r in sig if r["kind"] == "recent"]
            trd = [r for r in sig if r["kind"] == "trend"]
            if not sig:
                verdict = "No relationship the data can vouch for in this window."
            else:
                parts = []
                # the level of night heat is mostly geography inside a state (south is warmer
                # and has the longer season); the TREND of night heat is the thesis
                if lvl and len(set(word(r) for r in lvl)) == 1:
                    parts.append(f"Within a state, counties with warmer nights gained yield {word(lvl[0])} "
                                 f"(r {max(lvl, key=lambda r: abs(r['r']))['r']:+.2f}); that is where the longer season is, not the thesis.")
                elif lvl:
                    parts.append("The two level tests disagree on sign.")
                if trd and len(set(word(r) for r in trd)) == 1:
                    rr = max(trd, key=lambda r: abs(r['r']))['r']
                    size = "too small to matter on its own" if abs(rr) < 0.15 else "modest" if abs(rr) < 0.3 else "not small"
                    parts.append(f"Counties whose nights warmed faster since 1976 gained yield {word(trd[0])} "
                                 f"(r {rr:+.2f}); the sign is {'the thesis' if rr < 0 else 'the opposite of the thesis'} and the size is {size}.")
                elif trd:
                    parts.append("The two trend tests disagree on sign.")
                elif lvl:
                    parts.append("The trend of night heat, which is the thesis, shows no relationship the data can vouch for.")
                verdict = " ".join(parts)
        else:
            verdict = "Not enough counties within a state to say."
    return {"status": "ok" if any_heat else "not yet measured: heat layer has not run",
            "claim": "Counties with warmer July and August nights have gained corn yield more slowly.",
            "window_note": ("The yield trend is fitted on the published county yields since 2008, a window that holds the 2012 drought "
                            "and is dominated by genetics and management, so a weak result here does not refute a longer-run heat effect; "
                            "the decade series on the map is the longer record. Rows marked across all counties compare counties as they sit, "
                            "and night heat rises to the south along with several other things that move yield, so the verdict reads the "
                            "within-state rows, where each county is compared only with the other counties of its own state, and their fifths "
                            "are deviations from the state's mean, not yield gains. That removes the between-state contrast, which is the "
                            "largest heat contrast in the sample, and it leaves the north-south gradient inside Texas, Kansas and Nebraska in place. "
                            "The chance column treats counties as independent; neighbouring counties are not, so read it as generous."),
            "tests_run": n_tests, "verdict": verdict, "tests": results}


# ---------------------------------------------------------------- assemble

def build(rent_dir=RENT_DIR, raw_dir=RAW_DIR, geometry_names=None, geometry_units=None):
    """geometry_names: {fips: name} from data/atlas/counties.geo.json, so a county that
    is on the map but in no survey still gets a record (all layers withheld).
    geometry_units: {fips: unit word} for the 135 units of the 3,141 that are not
    called "County" -- 64 Louisiana parishes, 40 independent cities, Alaska's
    boroughs and census areas, Carson City. The page prints name + unit, so a
    missing unit word is how "Acadia County, LA" gets published."""
    rent, rent_vintage = load_rent(rent_dir)
    rent, rent_merged = fold_keys(rent)
    if rent_merged:
        log(f"  rent: {len(rent_merged)} code(s) fold onto a polygon already taken, kept the first: {' '.join(rent_merged)}")
    raw = {}
    vint = {}
    for name in ("heat", "water", "loss", "sob", "value", "crp", "drought", "energy", "wells"):
        p = os.path.join(raw_dir, f"{name}.json")
        if os.path.exists(p):
            with open(p, encoding="utf-8") as f:
                d = json.load(f)
            raw[name] = d.get("counties") if name != "wells" else {"ne": d.get("ne") or {}, "ks": d.get("ks") or {}}
            raw[name] = raw[name] or {}
            if name != "wells":
                raw[name], merged = fold_keys(raw[name])
                if merged:
                    log(f"  {name}: {len(merged)} code(s) fold onto a polygon already taken, kept the first: {' '.join(merged)}")
            vint[name] = {k: v for k, v in d.items() if k not in ("counties", "ne", "ks", "unmatched_atlas_names", "unplaced", "failed")}
            log(f"  {name}: {len(raw[name])} counties, {vint[name].get('source', '')}")
        else:
            raw[name] = None
            log(f"  {name}: no raw file, layer will read 'not yet measured'")

    heat_latest = (vint.get("heat") or {}).get("latest_year")
    loss_latest = (vint.get("loss") or {}).get("latest_year")
    # RMA keeps settling the current crop year for a year or more; the builder marks it
    loss_partial = loss_latest if loss_latest and loss_latest >= datetime.now(timezone.utc).year else None
    now = datetime.now(timezone.utc)
    sob_latest = (vint.get("sob") or {}).get("latest_year")
    sob_partial = sob_latest if sob_latest and sob_latest >= now.year else None
    drought_half = (vint.get("drought") or {}).get("half", 50.0)
    energy_year = (vint.get("energy") or {}).get("year")
    # the federal fiscal year starts in October
    this_fy = now.year + (1 if now.month >= 10 else 0)

    # A LAYER CONTRIBUTES A COUNTY; IT DOES NOT INVENT ONE. Every layer may
    # widen this set, because a county in one survey and no other still earns a
    # record with the rest withheld. The state prefix was the only filter, and
    # it is not enough: RMA's sobcov files carry RMA's own county codes, which
    # include state aggregates (county 000) and codes outside the Census range.
    # The name check below is what turns this back into a set of counties.
    fips_all = set(rent)
    for name in ("heat", "water", "loss", "sob", "value", "crp", "drought"):
        if raw[name]:
            fips_all |= {f for f in raw[name] if f[:2] in ATLAS_STATE_FIPS}
    if geometry_names:
        fips_all |= set(geometry_names)

    counties = {}
    unnamed = []
    placeholders = []
    for fips in sorted(fips_all):
        st = ATLAS_STATE_FIPS.get(fips[:2])
        if not st:
            continue
        r = rent.get(fips) or {}
        # Census spelling first (DeKalb, O'Brien, St. Clair); NASS upper-cases and drops punctuation
        name = (geometry_names or {}).get(fips) or r.get("name") or (raw["heat"] or {}).get(fips, {}).get("name") \
            or (raw["loss"] or {}).get(fips, {}).get("name") or (raw["water"] or {}).get(fips, {}).get("name")
        # WE DO NOT PUBLISH A COUNTY WE CANNOT NAME. 2026-09-17: the sob layer
        # landed and the Atlas went from 1455 counties to 1479. All 24 were
        # nameless, none had a polygon, and every layer read "withheld" except
        # sob, whose own numbers were a single 1989 row of zeros. Seven were
        # state totals (17000, 19000, 27000, 31000, 39000, 48000, 55000); the
        # rest were codes no Census county uses (38445, 26179, 18201).
        # The name chain above is the test, and it is the right one: the map,
        # the rent frame, heat, loss and water all carry county names, so a
        # real county is named by at least one of them. sob, value, crp and
        # drought carry numbers only. The five counties that have no polygon
        # but do have a name -- RMA's split units, W Pottawattamie IA, West
        # Otter Tail MN, West Polk MN -- are real places and stay.
        # The map is the primary namer, so the check only runs when we have it:
        # without counties.geo.json, San Juan CO (08111) and St. Louis City MO
        # (29510) are named by nothing else and a blind check would drop two
        # real counties to remove twenty-four codes. Measured both ways.
        # A PLACEHOLDER IS NOT A NAME. RMA's sobcov and colsom files carry a
        # per-state catch-all row whose county name is literally "Unknown"
        # (46131 SD, found on the first 50-state build). It passes the name test
        # above, has no polygon, and would publish as "Unknown County, SD".
        if name and _plain(name) in PLACEHOLDER_NAMES:
            placeholders.append(f"{fips} {name}")
            name = None
        if not name and geometry_names:
            unnamed.append(fips)
            continue
        c = {"name": name, "state": st}
        u = (geometry_units or {}).get(fips)
        if u is not None and u != "County":
            c["u"] = u          # "" is a real value here: Carson City NV
        c["rent"] = rent_layer(r.get("rent") or {}) if r else {"status": "withheld: county not in the NASS cash rents survey frame"}
        c["yield"] = yield_layer(r.get("yield")) if r else {"status": "withheld: county not in the NASS cash rents survey frame"}
        c["water_premium"] = water_premium_layer(r.get("rent") or {}) if r else {"status": "withheld: county not in the NASS cash rents survey frame"}
        c["heat"] = heat_layer((raw["heat"] or {}).get(fips), heat_latest, ran=True) if raw["heat"] is not None else heat_layer(None, None)
        c["water"] = (water_layer((raw["water"] or {}).get(fips), ran=True, absent_is_zero=bool((vint.get("water") or {}).get("absent_is_zero")))
                      if raw["water"] is not None else water_layer(None))
        c["loss"] = (loss_layer((raw["loss"] or {}).get(fips), loss_latest, ran=True, partial_year=loss_partial)
                     if raw["loss"] is not None else loss_layer(None, None))
        c["sob"] = (sob_layer((raw["sob"] or {}).get(fips), sob_latest, ran=True, partial_year=sob_partial,
                              col_total_indemnity=c["loss"].get("total_indemnity") if c["loss"].get("status") == "ok" else None)
                    if raw["sob"] is not None else sob_layer(None, None))
        c["value"] = (value_layer((raw["value"] or {}).get(fips), (r.get("rent") or {}).get("nonirr"), ran=True)
                      if raw["value"] is not None else value_layer(None))
        harvested = (((raw["water"] or {}).get(fips) or {}).get("census2022") or {}).get("harvested")
        c["crp"] = (crp_layer((raw["crp"] or {}).get(fips), harvested_cropland=harvested, ran=True, this_fy=this_fy)
                    if raw["crp"] is not None else crp_layer(None))
        c["drought"] = (drought_layer((raw["drought"] or {}).get(fips), half=drought_half, ran=True, this_year=now.year)
                        if raw["drought"] is not None else drought_layer(None))
        c["energy"] = energy_layer((raw["energy"] or {}).get(fips), ran=raw["energy"] is not None, year=energy_year)
        c["wells"] = wells_layer(st, ne=(raw["wells"] or {}).get("ne", {}).get(fips), ks=(raw["wells"] or {}).get("ks", {}).get(fips),
                                 ran=raw["wells"] is not None)
        # a fingerprint of the numbers. atlas_reads.py stores it beside each AI read
        # and the page shows a read only when the two agree, so a read can never
        # describe numbers the county no longer carries.
        c["sha"] = record_sha(c)
        counties[fips] = c

    if not geometry_names:
        log("  WARNING: no county geometry, so the name check did not run; "
            "a source's own county codes can enter the Atlas unchallenged")
    if geometry_names:
        off_map = {}
        for name in ("heat", "water", "loss", "sob", "value", "crp", "drought"):
            extra = sorted(f for f in (raw[name] or {}) if f[:2] in ATLAS_STATE_FIPS and f not in geometry_names)
            if extra:
                off_map[name] = extra
        for f in sorted(rent):
            if f[:2] in ATLAS_STATE_FIPS and f not in geometry_names:
                off_map.setdefault("rent", []).append(f)
        # A CODE THE MAP DOES NOT CARRY IS NEVER GUESSED INTO A COUNTY. It is
        # named here so the next build can either fold it (FIPS_ALIAS) or go and
        # get a newer boundary file. Connecticut's 09110-09190 showing up here is
        # the specific signal that NASS or RMA has moved to the planning regions.
        if off_map:
            for name, codes in sorted(off_map.items()):
                log(f"  off-map codes in {name}: {len(codes)} — {' '.join(codes[:40])}"
                    + (" ..." if len(codes) > 40 else ""))
        else:
            log("  off-map codes: none; every source code the states cover is on the map")

    if placeholders:
        log(f"  dropped {len(placeholders)} code(s) whose only name is a placeholder: " + ", ".join(placeholders))
    if unnamed:
        by_state = {}
        for f in unnamed:
            by_state.setdefault(ATLAS_STATE_FIPS.get(f[:2], "??"), []).append(f)
        log(f"  dropped {len(unnamed)} code(s) no source could name: "
            + ", ".join(f"{st} {' '.join(sorted(v))}" for st, v in sorted(by_state.items())))

    layers = {
        "rent": {"status": "ok", "source": "USDA NASS Cash Rents Survey (county), via data/cash-rent", "vintage": rent_vintage,
                 "gates": {"min_premium_pairs": MIN_PREMIUM_PAIRS, "min_leader_pairs": MIN_LEADER_PAIRS}},
        "yield": {"status": "ok", "source": "USDA NASS county corn yield; trend fit published on /cash-rent (15-year window)",
                  "vintage": rent_vintage, "gates": {"min_years": MIN_YIELD_N}},
        "heat": {"status": "ok" if raw["heat"] else "not yet measured",
                 "source": "NOAA NCEI nClimDiv county monthly minimum temperature (climdiv-tmincy)",
                 "gates": {"min_trend_years": MIN_HEAT_TREND_N, "min_recent_years": MIN_HEAT_LEVEL_N,
                           "min_normal_years": MIN_NORMAL_N, "hot_month_line_f": HOT_JULY_F,
                           "trend_start": HEAT_TREND_START},
                 **(vint.get("heat") or {})},
        "water": {"status": "ok" if raw["water"] else "not yet measured",
                  "source": "USDA Census of Agriculture 2022 (irrigated share of harvested cropland); USGS Estimated Use of Water 2015 (irrigation withdrawals by source)",
                  **(vint.get("water") or {})},
        "loss": {"status": "ok" if raw["loss"] else "not yet measured",
                 "source": "USDA RMA Summary of Business, Cause of Loss, 1989 onward",
                 "gates": {"min_premium_for_ratio": MIN_LOSS_PREMIUM, "min_indemnity_for_shares": MIN_LOSS_INDEM},
                 **(vint.get("loss") or {})},
        "sob": {"status": "ok" if raw["sob"] else "not yet measured",
                "source": "USDA RMA Summary of Business, state/county/crop/coverage level (sobcov), 1989 onward",
                "gates": {"min_premium_for_ratio": MIN_RATIO_PREMIUM, "min_years_for_period_ratio": MIN_RATIO_YEARS},
                **(vint.get("sob") or {})},
        "value": {"status": "ok" if raw["value"] else "not yet measured",
                  "source": "USDA Census of Agriculture 2012, 2017, 2022: estimated market value of land and buildings, $/acre, county",
                  **(vint.get("value") or {})},
        "crp": {"status": "ok" if raw["crp"] else "not yet measured",
                "source": "USDA FSA CRP statistics: enrollment by county by year; contract expirations by county by fiscal year",
                "gates": {"min_acres_for_share": MIN_CRP_ACRES}, "this_fy": this_fy,
                **(vint.get("crp") or {})},
        "drought": {"status": "ok" if raw["drought"] else "not yet measured",
                    "source": "U.S. Drought Monitor county statistics (NDMC/UNL), weekly since 2000",
                    "gates": {"maps_for_full_year": FULL_YEAR_MAPS, "half_year_weeks": HALF_YEAR_WEEKS, "area_pct": drought_half},
                    **(vint.get("drought") or {})},
        "energy": {"status": "ok" if raw["energy"] else "not yet measured",
                   "source": "EIA Form 860: plant and generator files, operable and proposed",
                   **(vint.get("energy") or {})},
        "wells": {"status": "ok" if raw["wells"] else "not yet measured",
                  "source": "Nebraska DNR registered wells; Kansas DWR WIMAS points of diversion (other states: no open register read yet)",
                  **(vint.get("wells") or {})},
    }
    out = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "states": ATLAS_STATES,
        "layers": layers,
        "national": {**national(counties, loss_latest), **national_p1(counties, this_fy=this_fy)},
        "thesis_test": thesis_test(counties),
        "counts": {"counties": len(counties),
                   "rent_ok": sum(1 for c in counties.values() if c["rent"].get("status") == "ok"),
                   "yield_ok": sum(1 for c in counties.values() if c["yield"].get("status") == "ok"),
                   "premium_ok": sum(1 for c in counties.values() if c["water_premium"].get("status") == "ok"),
                   "heat_ok": sum(1 for c in counties.values() if c["heat"].get("status") == "ok"),
                   "water_ok": sum(1 for c in counties.values() if c["water"].get("status") == "ok"),
                   "loss_ok": sum(1 for c in counties.values() if c["loss"].get("status") == "ok"),
                   "sob_ok": sum(1 for c in counties.values() if c["sob"].get("status") == "ok"),
                   "value_ok": sum(1 for c in counties.values() if c["value"].get("status") == "ok"),
                   "crp_ok": sum(1 for c in counties.values() if c["crp"].get("status") == "ok"),
                   "drought_ok": sum(1 for c in counties.values() if c["drought"].get("status") == "ok"),
                   "energy_ok": sum(1 for c in counties.values() if c["energy"].get("status") == "ok"),
                   "wells_ok": sum(1 for c in counties.values() if c["wells"].get("status") == "ok")},
        "counties": counties,
    }
    return out


# ---------------------------------------------------------------- selftest

def _selftest_unnamed(tmp):
    """A LAYER MAY NOT MINT A COUNTY. The sob layer arrived on 2026-09-17
    carrying RMA's own county codes and the Atlas gained 24 counties that no
    source could name. Build twice off one fixture: once with a map, once
    without."""
    import tempfile
    raw = {"sob": {"counties": {"19155": {"years": {}}, "19000": {"years": {}}, "38445": {"years": {}}},
                   "latest_year": 2026, "source": "fixture"}}
    d = tempfile.mkdtemp()
    with open(os.path.join(d, "sob.json"), "w") as f:
        json.dump(raw["sob"], f)
    rent_dir = tempfile.mkdtemp()          # no rent: the layer is the only source of fips
    geo = {"19155": "Pottawattamie"}       # the map knows one of the three

    out = build(rent_dir=rent_dir, raw_dir=d, geometry_names=geo)
    got = set(out["counties"])
    assert got == {"19155"}, f"a named county survives and the codes do not: {sorted(got)}"

    # and with no map at all the check stands down rather than dropping real counties
    out = build(rent_dir=rent_dir, raw_dir=d, geometry_names=None)
    assert set(out["counties"]) == {"19155", "19000", "38445"}, \
        "without a map there is nothing to check a name against, so nothing is dropped"


def selftest():
    _selftest_unnamed(None)
    # ols on a hand-worked line: y = 2x + 1 exactly
    f = ols([(1, 3), (2, 5), (3, 7), (4, 9)])
    assert abs(f["slope"] - 2) < 1e-9 and abs(f["intercept"] - 1) < 1e-9 and f["r2"] == 1.0, f
    # ols with noise: points (0,0),(1,1),(2,1),(3,3): slope = 0.9, intercept = -0.1 (hand worked)
    f = ols([(0, 0), (1, 1), (2, 1), (3, 3)])
    assert abs(f["slope"] - 0.9) < 1e-9 and abs(f["intercept"] + 0.1) < 1e-9, f
    # pearson exact
    p = pearson([(1, 2), (2, 4), (3, 6), (4, 8)])
    assert abs(p["r"] - 1) < 1e-9
    p = pearson([(1, 8), (2, 6), (3, 4), (4, 2)])
    assert abs(p["r"] + 1) < 1e-9

    # water premium: hand worked. irr 200,210,220,230,240,250; nonirr 100,105,110,115,120,125
    rent = {"irr": {str(2019 + i): 200 + 10 * i for i in range(6)},
            "nonirr": {str(2019 + i): 100 + 5 * i for i in range(6)}}
    w = water_premium_layer(rent)
    assert w["status"] == "ok" and w["n_pairs"] == 6, w
    assert w["latest"]["premium"] == 125 and w["first"]["premium"] == 100, w
    assert abs(w["slope_per_year"] - 5.0) < 1e-9, w          # premium rises 5/yr exactly
    assert w["direction"] == "rising", w
    assert direction(2.33, 2.26) == "rising" and direction(2.3, 2.3) == "no clear direction" and direction(-2.33, 2.26) == "falling"
    assert direction(0.004, 0.001) == "no clear direction", "a call must survive rounding to what is printed"
    assert half_up(104.5) == 105 and half_up(-6.5) == -7 and half_up(2.4) == 2
    assert t975(48) == 2.021 and t975(31) == 2.042 and t975(200) == 1.980 and t975(5) == 2.571
    # gate: 5 pairs withheld
    rent5 = {"irr": {str(2019 + i): 200 for i in range(5)}, "nonirr": {str(2019 + i): 100 for i in range(5)}}
    assert water_premium_layer(rent5)["status"].startswith("withheld"), water_premium_layer(rent5)
    # no irrigated rent at all: withheld with the right reason
    assert "no irrigated" in water_premium_layer({"nonirr": {"2020": 100}})["status"]

    # rent 10-year change: 2015 skipped, so from 2025 the base is 2014 or 2013 (closest at/before 2015 within 12)
    r = rent_layer({"nonirr": {"2013": 100, "2014": 110, "2016": 120, "2025": 165}})
    assert r["nonirr_change10"]["from_year"] == 2014 and r["nonirr_change10"]["pct"] == 50.0, r
    assert r["nonirr"] == {"year": 2025, "value": 165}

    # yield: worst year share of median; hist of 9 values, median 150, worst 90 -> 0.6
    hist = {str(2010 + i): v for i, v in enumerate([150, 160, 90, 155, 150, 145, 170, 150, 165])}
    y = yield_layer({"corn": {"hist": hist, "slope": 1.5, "r2": .3, "n": 9, "trend": 170, "last": 165}})
    assert y["status"] == "ok" and y["median"] == 150 and y["worst"] == {"year": 2012, "value": 90, "share_of_median": 0.6}, y
    assert yield_layer({"corn": {"hist": {"2010": 100}}})["status"].startswith("withheld")

    # heat: synthetic county, July = 60 + 0.05*(year-1976) from 1900..2025 -> slope 0.5 F/decade exactly
    s = {y: 60 + 0.05 * (y - 1976) for y in range(1900, 2026)}
    h = heat_layer({"jul": {str(y): v for y, v in s.items()}, "aug": {}}, 2025)
    j = h["months"]["jul"]
    assert abs(j["trend"]["per_decade"] - 0.5) < 1e-6, j["trend"]
    assert j["trend"]["direction"] == "warming"
    assert j["recent"]["n"] == 10 and abs(j["recent"]["mean"] - (60 + 0.05 * (2020.5 - 1976))) < 0.051, j["recent"]
    assert j["decades"]["1900s"]["n"] == 10 and j["decades"]["2020s"]["n"] == 6
    # 70 F line never reached (max is 60+0.05*49=62.45); 62 line first at the 2020s (mean 2020-2025 = 62.325)
    assert j["first_decade_at_or_above"]["70"] is None and j["first_decade_at_or_above"]["62"] == "2020s", j["first_decade_at_or_above"]
    assert j["decades"]["2020s"]["hot"] == 0
    a = h["months"]["aug"]
    assert a["status"].startswith("withheld")
    assert heat_layer(None, 2025)["status"].startswith("not yet measured")

    # water: 100 Mgal/d over 50 thousand acres = 100*365e6/325851/50000 = 2.24 ft/acre
    w = water_layer({"census2022": {"harvested": 200000, "irrigated": 50000},
                     "usgs2015": {"ir_gw_mgd": 80, "ir_sw_mgd": 20, "ir_tot_mgd": 100, "ir_acres_k": 50}})
    assert w["irrigated_share_2022"]["share"] == 0.25 and w["groundwater_share_2015"]["share"] == 0.8, w
    assert w["applied_2015"]["acre_ft_per_acre"] == 2.24, w["applied_2015"]
    w = water_layer({"census2022": {"harvested": 200000, "irrigated": None, "irrigated_published": True}, "usgs2015": {}})
    assert "suppressed" in w["irrigated_share_2022"]["status"]
    w = water_layer({"census2022": {"harvested": 200000, "irrigated": None, "irrigated_published": False}, "usgs2015": {}}, absent_is_zero=True)
    assert w["irrigated_share_2022"]["share"] == 0.0 and w["irrigated_share_2022"]["reported"] is False
    w = water_layer({"census2022": {"harvested": 200000, "irrigated": None, "irrigated_published": False}, "usgs2015": {}}, absent_is_zero=False)
    assert "withheld" in w["irrigated_share_2022"]["status"] and "share" not in w["irrigated_share_2022"]
    assert "withheld" in w["groundwater_share_2015"]["status"]
    assert "withheld" in water_layer({"census2022": {}, "usgs2015": {"ir_gw_mgd": 0.4, "ir_sw_mgd": 0.1, "ir_tot_mgd": 0.5, "ir_acres_k": 0.05}})["applied_2015"]["status"]
    assert water_layer(None, ran=True)["status"].startswith("withheld") and water_layer(None)["status"].startswith("not yet")

    # loss: two years, hand worked
    l = {"years": {"2012": {"heat_drought": {"indem": 3_000_000, "prem": 1_000_000},
                            "hail": {"indem": 1_000_000, "prem": 500_000}},
                   "2019": {"wet": {"indem": 2_000_000, "prem": 1_500_000}}}}
    L = loss_layer(l, 2025)
    assert L["total_indemnity"] == 6_000_000 and L["loss_ratio_all"] is None and "withheld" in L["loss_ratio_status"], L
    assert L["share_all"]["heat_drought"] == 0.5 and L["top_cause_all"] == "heat_drought"
    p1 = L["periods"]["2010-2019"]
    assert p1["indemnity"] == 6_000_000 and p1["top_cause"] == "heat_drought" and p1["heat_drought_share"] == 0.5, p1
    assert L["periods"]["1989-1999"]["loss_ratio"] is None and "withheld" in L["periods"]["1989-1999"]["loss_ratio_status"]
    assert "share" not in L["periods"]["1989-1999"] and "withheld" in L["periods"]["1989-1999"]["share_status"]
    assert L["per_year"][2012]["heat_drought"] == 3_000_000

    # yield: fit on every published year, not /cash-rent's 15-year window
    hist2 = {str(2008 + i): 150 + 2 * i for i in range(17)}     # exactly +2 bu/yr
    y2 = yield_layer({"corn": {"hist": hist2, "slope": 9.9}})
    assert y2["slope"] == 2.0 and y2["window"] == "2008-2024" and y2["n"] == 17 and y2["cash_rent_slope"] == 9.9, y2
    # thesis: not yet measured when no heat
    t = thesis_test({"19001": {"yield": {"status": "ok", "slope": 1, "n": 12}, "heat": {"status": "not yet measured"}}})
    assert t["status"].startswith("not yet measured") and t["verdict"] is None
    # thesis: 250 synthetic counties with yield slope falling as July low rises -> negative r, verdict says so
    cs = {}
    for i in range(250):
        x = 55 + i * 0.06
        cs[f"19{i:03d}"] = {"yield": {"status": "ok", "slope": 3 - 0.1 * (x - 55) + (0.3 if i % 2 else -0.3), "n": 12},
                            "heat": {"status": "ok", "months": {"jul": {"recent": {"mean": x}, "trend": {"per_decade": 0.3}}}}}
    t = thesis_test(cs)
    tj = [r for r in t["tests"] if r["month"] == "jul" and r["kind"] == "recent" and r["scope"] == "raw"][0]
    assert tj["status"] == "ok" and tj["r"] < -0.5 and tj["p_corrected"] < 0.05, tj
    assert tj["fifths"]["hottest_mean_slope"] < tj["fifths"]["coolest_mean_slope"]
    tw = [r for r in t["tests"] if r["month"] == "jul" and r["kind"] == "recent" and r["scope"] == "within_state"][0]
    assert tw["status"] == "ok" and tw["r"] < -0.5, tw       # all 250 are one state, so demeaning keeps the slope
    # the trend test has no spread in x (all 0.3): withheld, not a crash and not a number
    tt = [r for r in t["tests"] if r["kind"] == "trend" and r["month"] == "jul" and r["scope"] == "raw"][0]
    assert tt["status"] == "withheld: no spread in x", tt
    assert len(t["tests"]) == 8 and t["tests_run"] == 8
    assert "more slowly" in t["verdict"] and "longer season" in t["verdict"], t["verdict"]
    # the seed writes between its markers, once, and is idempotent
    import tempfile
    tmp = tempfile.NamedTemporaryFile("w", suffix=".html", delete=False, encoding="utf-8")
    tmp.write("<p>before</p>\n" + SEED_OPEN + "\nold\n" + SEED_CLOSE + "\n<p>after</p>")
    tmp.close()
    fake = {"generated": "2026-09-13T00:00:00Z", "states": ["IA"], "counts": {"counties": 1},
            "national": {"premium": {"counties": 1, "rising": 1, "falling": 0, "expected_by_chance_each_way": 0.0}},
            "counties": {"19001": {"name": "Adair", "state": "IA", "water_premium": {"status": "ok", "direction": "rising", "slope_per_year": 2.0, "n_pairs": 9,
                                                                                   "first": {"year": 2008, "premium": 10}, "latest": {"year": 2025, "premium": 40}}}}}
    seed_page(tmp.name, fake)
    t1 = open(tmp.name, encoding="utf-8").read()
    assert "old" not in t1 and "Adair County, IA: $10 in 2008 to $40 in 2025" in t1 and t1.startswith("<p>before</p>") and t1.endswith("<p>after</p>"), t1
    assert 'data-built="2026-09-13T00:00:00Z"' in t1 and "not yet measured" in t1
    assert _money(104.5) == "$105" and _money(-29) == "\u2212$29" and _money(1234567.4) == "$1,234,567"
    seed_page(tmp.name, fake)
    assert open(tmp.name, encoding="utf-8").read() == t1, "seed is not idempotent"
    os.unlink(tmp.name)
    # the fingerprint changes when a number changes and not otherwise
    assert record_sha({"a": 1, "b": {"c": 2}}) == record_sha({"b": {"c": 2}, "a": 1})
    assert record_sha({"a": 1}) != record_sha({"a": 2})
    # summarize keeps the map fields and drops the series; the detail record is not mutated
    rec = {"name": "X", "state": "IA", "sha": "s",
           "rent": {"status": "ok", "nonirr": {"year": 2025, "value": 1}, "nonirr_change10": {"pct": 5.0, "from_year": 2014, "to_year": 2025, "from": 1, "to": 2}, "series_nonirr": {2025: 1}},
           "yield": {"status": "ok", "slope": 1.0, "r2": .5, "n": 12, "median": 150, "worst": {"year": 2012, "value": 90, "share_of_median": .6}, "hist": {2012: 90}},
           "water_premium": {"status": "withheld: x"},
           "heat": {"status": "ok", "months": {"jul": {"recent": {"mean": 1}, "trend": {"per_decade": .2}, "decades": {"2010s": {"mean": 64.0, "n": 10, "hot": 1, "sum": 640}}, "series": {2000: 1}},
                                              "aug": {"status": "withheld: none"}}},
           "water": {"status": "not yet measured"},
           "loss": {"status": "ok", "per_year": {2012: 1}, "total_indemnity": 5, "first_year": 1989, "last_year": 2025,
                    "share_all": {"heat_drought": .5, "wet": .2, "hail": .1, "other": .2}, "top_cause_all": "heat_drought",
                    "periods": {"2020-2025": {"heat_drought_share": .7}}, "irrigation_failure_indemnity": 0}}
    sm = summarize(rec)
    assert "series_nonirr" not in sm["rent"] and sm["rent"]["nonirr"]["value"] == 1 and sm["rent"]["nonirr_change10"]["pct"] == 5.0
    assert "hist" not in sm["yield"] and sm["yield"]["worst"]["share_of_median"] == .6
    assert sm["water_premium"] == {"status": "withheld: x"}
    # THE INDEX IS FIRST PAINT ONLY. These are the fields the panel reads and the
    # map does not; every one of them is in the county's detail file. If a field
    # comes back here, every visitor pays for it and only a clicker reads it.
    assert "series" not in sm["heat"]["months"]["jul"]
    assert "decades" not in sm["heat"]["months"]["jul"], "the July decades belong in the sidecar"
    assert "aug" not in sm["heat"]["months"], "the map has no August layer"
    assert sm["heat"]["months"]["jul"]["recent"] == {"mean": 1} and sm["heat"]["months"]["jul"]["trend"] == {"per_decade": .2}
    assert "normal_1991_2020" not in sm["heat"]["months"]["jul"]
    assert "first_year" not in sm["rent"].get("nonirr", {}) and "irr" not in sm["rent"]
    assert set(sm["yield"]) == {"status", "slope", "worst"}, sm["yield"]
    assert "hail" not in (sm["loss"]["share_all"] or {}) and "total_indemnity" not in sm["loss"]
    assert "per_year" not in sm["loss"] and sm["loss"]["heat_drought_2020s"] == .7 and sm["loss"]["share_all"]["heat_drought"] == .5
    assert "series" in rec["heat"]["months"]["jul"], "summarize must not mutate the detail record"
    assert sm["sob"] == {"status": None} and sm["energy"] == {"status": None}, "phase 1 layers absent from the record read as status None"
    # the sidecar carries what the index dropped, keyed the same way
    assert heat_decades(rec) == {"2010s": {"mean": 64.0, "n": 10, "hot": 1}}, heat_decades(rec)
    assert heat_decades({"heat": {"status": "withheld: none"}}) is None
    # the unit word rides through summarize, and only when it is not "County"
    assert "u" not in sm
    rec2 = dict(rec); rec2["u"] = "Parish"
    assert summarize(rec2)["u"] == "Parish"
    rec["drought"] = drought_layer({"2012": {"maps": 52, "d2": 30, "d3": 10}}, ran=True)
    sd = summarize(rec)["drought"]
    assert "latest_d2" not in sd and "worst_year" not in sd, sd
    assert sd["weeks"] == {"share_d2_pct": drought_layer({"2012": {"maps": 52, "d2": 30, "d3": 10}}, ran=True)["weeks"]["share_d2_pct"]}
    # the fold, and its refusal to merge two counties' numbers into one
    assert fold("46113") == "46102" and fold("19169") == "19169"
    folded, merged = fold_keys({"02063": {"a": 1}, "02066": {"a": 2}, "19169": {"a": 3}})
    assert set(folded) == {"02261", "19169"} and merged == ["02066"], (folded, merged)
    assert folded["02261"] == {"a": 1}, "the first code by sorted order wins; nothing is averaged"
    log("selftest ok")


DETAIL_DIR = "data/atlas/counties"
DECADES_OUT = "data/atlas/heat-decades.json"


def _st(layer):
    return (layer or {}).get("status")


def _label(c):
    """'Story County, IA'. `u` is absent for an ordinary county and is the empty
    string for Carson City, whose name is already whole."""
    u = c["u"] if "u" in c else "County"
    return f'{c["name"]}{(" " + u) if u else ""}, {c["state"]}'


def summarize(rec):
    """The map-level record: FIRST PAINT ONLY — what the choropleth, the
    tooltip, the search list, the premium tables, the scatters and the "why is
    this county grey" note need, and nothing else.

    Everything the county panel shows comes from the county's own detail file.
    Carrying the panel's fields here too is a second copy of the same bytes on
    every visitor's first load; at 50 states that copy was about 1.7 MB. The
    July decade series is the other big block and it feeds two of the 34 map
    layers, so it goes to its own sidecar (see write_outputs) and is fetched
    only when one of those two layers is chosen.

    Statuses are carried in full, because the page prints them verbatim to say
    why a county is grey."""
    out = {"name": rec["name"], "state": rec["state"], "sha": rec["sha"]}
    if "u" in rec:
        # membership, not truth: Carson City's unit word is the empty string --
        # its name is already complete -- and `if rec.get("u")` published it as
        # "Carson City County, NV".
        out["u"] = rec["u"]
    r = rec.get("rent") or {}
    out["rent"] = {"status": _st(r)}
    if _st(r) == "ok":
        out["rent"]["nonirr"] = {"value": (r.get("nonirr") or {}).get("value")} if r.get("nonirr") else None
        out["rent"]["nonirr_change10"] = {"pct": r["nonirr_change10"]["pct"]} if r.get("nonirr_change10") else None
    y = rec.get("yield") or {}
    out["yield"] = {"status": _st(y)}
    if _st(y) == "ok":
        out["yield"].update({"slope": y.get("slope"),
                             "worst": {"share_of_median": (y.get("worst") or {}).get("share_of_median")} if y.get("worst") else None})
    w = rec.get("water_premium") or {}
    out["water_premium"] = {"status": _st(w)}
    if _st(w) == "ok":
        out["water_premium"].update({"slope_per_year": w["slope_per_year"], "slope_ci95": w["slope_ci95"],
                                     "direction": w["direction"], "n_pairs": w["n_pairs"],
                                     "first": {"year": (w.get("first") or {}).get("year"), "premium": (w.get("first") or {}).get("premium")},
                                     "latest": {"year": (w.get("latest") or {}).get("year"), "premium": (w.get("latest") or {}).get("premium")}})
    h = rec.get("heat") or {}
    out["heat"] = {"status": _st(h)}
    if _st(h) == "ok":
        # July only. August is in the detail file: the map has no August layer.
        md = ((h.get("months") or {}).get("jul")) or {}
        if md.get("status"):
            out["heat"]["months"] = {"jul": {"status": md["status"]}}
        else:
            out["heat"]["months"] = {"jul": {
                "recent": {"mean": (md.get("recent") or {}).get("mean")} if md.get("recent") else None,
                "trend": {"per_decade": (md.get("trend") or {}).get("per_decade")} if md.get("trend") else None}}
    wa = rec.get("water") or {}
    out["water"] = {"status": _st(wa)}
    if _st(wa) == "ok":
        out["water"].update({"irrigated_share_2022": {"share": (wa.get("irrigated_share_2022") or {}).get("share")},
                             "groundwater_share_2015": {"share": (wa.get("groundwater_share_2015") or {}).get("share")},
                             "applied_2015": {"acre_ft_per_acre": (wa.get("applied_2015") or {}).get("acre_ft_per_acre")} if wa.get("applied_2015") else None})
    lo = rec.get("loss") or {}
    out["loss"] = {"status": _st(lo)}
    if _st(lo) == "ok":
        sa = lo.get("share_all") or {}
        recent = None
        for k, p in (lo.get("periods") or {}).items():
            if k.startswith("2020"):
                recent = p.get("heat_drought_share")
        out["loss"].update({"share_all": {"heat_drought": sa.get("heat_drought"), "wet": sa.get("wet")} if sa else None,
                            "heat_drought_2020s": recent,
                            "irrigation_failure_indemnity": lo.get("irrigation_failure_indemnity")})
    out.update(summarize_p1(rec))
    return out


def heat_decades(rec):
    """The July decade series for one county, or None. Two of the 34 map layers
    read it (the hot-night count and the decade slider); every other visitor
    never needs it, and it is 29% of the index. So it is published beside the
    index and fetched on demand."""
    h = rec.get("heat") or {}
    if _st(h) != "ok":
        return None
    md = ((h.get("months") or {}).get("jul")) or {}
    if md.get("status") or not md.get("decades"):
        return None
    return {d: {"mean": x["mean"], "n": x["n"], "hot": x["hot"]} for d, x in md["decades"].items()}


def write_outputs(out, out_path=OUT, detail_dir=DETAIL_DIR):
    os.makedirs(detail_dir, exist_ok=True)
    full = out["counties"]
    # detail files, one per county, stamped with the same `generated` as the summary
    # so the page can refuse to show a detail that belongs to a different build
    written = set()
    for fips, rec in full.items():
        p = os.path.join(detail_dir, f"{fips}.json")
        with open(p, "w", encoding="utf-8") as f:
            json.dump({"fips": fips, "generated": out["generated"], **rec}, f, separators=(",", ":"), ensure_ascii=False)
        written.add(f"{fips}.json")
    # a county that left the Atlas leaves the folder too
    for name in os.listdir(detail_dir):
        if name.endswith(".json") and name not in written:
            os.remove(os.path.join(detail_dir, name))
    summary = dict(out)
    summary["counties"] = {fips: summarize(rec) for fips, rec in full.items()}
    summary["sidecars"] = {"heat_decades": os.path.basename(DECADES_OUT)}
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, separators=(",", ":"), ensure_ascii=False)
    dec = {fips: d for fips, d in ((f, heat_decades(r)) for f, r in full.items()) if d}
    with open(DECADES_OUT, "w", encoding="utf-8") as f:
        json.dump({"generated": out["generated"], "month": "jul", "counties": dec}, f, separators=(",", ":"))
    log(f"  index {os.path.getsize(out_path):,} bytes; heat-decades sidecar {os.path.getsize(DECADES_OUT):,} bytes for {len(dec)} counties")
    return summary


# ---------------------------------------------------------------- static seed for JS-blind readers

SEED_OPEN = "<!--SEED:atlas-->"
SEED_CLOSE = "<!--/SEED:atlas-->"


def _money(x):
    # half away from zero, the same as the page's Math.round on positives, so the
    # static block and the live table never print 104 and 105 for one number
    v = int(math.floor(abs(x) + 0.5))
    return ("\u2212$" if x < 0 else "$") + f"{v:,}"


def _pct(x):
    return f"{half_up(x * 100)}%"


def seed_html(out):
    """The Atlas's national facts as plain HTML, stamped with the build. The page
    keeps this block only while the stamp matches the data file it loads."""
    n = out["national"]
    c = out["counts"]
    parts = [f'<div id="fa-seed" data-built="{out["generated"]}" class="fa-seedbox">']
    parts.append(f'<p><strong>Across the Atlas</strong> · built {out["generated"][:10]} · {c["counties"]} counties in {len(out["states"])} states.</p>')
    h = n.get("heat")
    if h:
        hb = h["hot_julys_by_decade"]
        dec = " · ".join(f"{k} {v['hot']}" for k, v in sorted(hb.items()) if k >= "1930s" and k <= "2010s")
        parts.append(f'<p>July nights: {h["warming"]} of {h["counties_with_trend"]} counties are warming since 1976 with the 95% interval clear of zero, {h["cooling"]} cooling, {h["no_clear_direction"]} with no clear direction; the median trend is {h["median_trend_per_decade"]:+.2f} F per decade. In {h["latest_decade_is_warmest"]} of {h["counties_with_decades"]} counties the 2010s were the warmest complete decade since the 1900s (the 2020s are not complete and are not counted). Julys with an average low at or above 70 F, summed over every county, by decade: {dec}.</p>')
        bs = n.get("heat_by_state") or {}
        if bs:
            row = " · ".join(f"{st} {v['warming']} of {v['counties']}" for st, v in bs.items())
            parts.append(f'<p>Where the warming is, counties warming since 1976 by state, most to least: {row}.</p>')
    else:
        parts.append('<p>July nights: not yet measured.</p>')
    w = n.get("water")
    if w:
        parts.append(f'<p>Water: {w["over_quarter_irrigated"]} of {w["counties_with_share"]} counties irrigate a quarter or more of their harvested cropland and {w["over_half_irrigated"]} irrigate half or more; the median county irrigates {_pct(w["median_irrigated_share"])}. In {w["gw_over_90pct"]} of {w["counties_with_gw_share"]} counties nine-tenths or more of the irrigation water is pumped from the ground.</p>')
    else:
        parts.append('<p>Water dependence: not yet measured.</p>')
    lo = n.get("loss")
    if lo:
        per = " · ".join(f"{k} {_pct(v['heat_drought_share'])}" for k, v in lo["periods"].items() if v.get("heat_drought_share") is not None)
        parts.append(f'<p>Loss record: {_money(lo["total_indemnity"])} of crop insurance indemnities since 1989 across {lo["counties"]} counties (nominal dollars; pasture and rangeland rainfall-index policies excluded). Heat and drought share by period: {per}. Paid for failure of irrigation supply or equipment: {_money(lo["irrigation_failure_indemnity"])}.</p>')
    else:
        parts.append('<p>Loss record: not yet measured.</p>')
    pr = n.get("premium")
    if pr:
        rows = [(f, cc["water_premium"]) for f, cc in out["counties"].items() if (cc.get("water_premium") or {}).get("status") == "ok"]
        rows = [r for r in rows if r[1]["n_pairs"] >= MIN_LEADER_PAIRS]
        narrow = sorted([r for r in rows if r[1]["direction"] == "falling"], key=lambda r: r[1]["slope_per_year"])[:5]
        wide = sorted([r for r in rows if r[1]["direction"] == "rising"], key=lambda r: -r[1]["slope_per_year"])[:5]
        def li(f, p):
            cc = out["counties"][f]
            return f'{_label(cc)}: {_money(p["first"]["premium"])} in {p["first"]["year"]} to {_money(p["latest"]["premium"])} in {p["latest"]["year"]}'
        parts.append(f'<p>The irrigated rent premium: {pr["counties"]} counties publish both rents with enough paired years; the premium is rising in {pr["rising"]} and falling in {pr["falling"]}, with the 95% interval clear of zero. Falling fastest, fitted through every paired year: ' + "; ".join(li(f, p) for f, p in narrow) + '. Rising fastest: ' + "; ".join(li(f, p) for f, p in wide) + '.</p>')
    parts.extend(seed_p1(n, _money, _pct))
    parts.append('</div>')
    return "\n".join(parts)


def seed_page(path, out):
    with open(path, encoding="utf-8") as f:
        html = f.read()
    a = html.count(SEED_OPEN)
    b = html.count(SEED_CLOSE)
    if a != 1 or b != 1:
        sys.exit(f"{path}: expected one {SEED_OPEN} and one {SEED_CLOSE}, found {a} and {b}")
    i = html.index(SEED_OPEN) + len(SEED_OPEN)
    j = html.index(SEED_CLOSE)
    new = html[:i] + "\n" + seed_html(out) + "\n" + html[j:]
    if new != html:
        with open(path, "w", encoding="utf-8") as f:
            f.write(new)
        log(f"seeded {path}")
    else:
        log(f"{path}: seed unchanged")


def main():
    if "--selftest" in sys.argv:
        selftest()
        return
    geo_names = None
    geo_units = None
    gp = "data/atlas/counties.geo.json"
    if os.path.exists(gp):
        with open(gp, encoding="utf-8") as f:
            feats = json.load(f)["features"]
            geo_names = {ft["id"]: ft["properties"].get("name") for ft in feats}
            geo_units = {ft["id"]: ft["properties"].get("u", "County") for ft in feats}
    out = build(geometry_names=geo_names, geometry_units=geo_units)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    # If no county's numbers changed since the last build, keep the last build's
    # stamp: 1,450 detail files and the seeded page would otherwise be rewritten
    # every month for a timestamp, and the git history would say the Atlas moved
    # when it did not.
    if os.path.exists(OUT):
        try:
            with open(OUT, encoding="utf-8") as f:
                prev = json.load(f)
            same = (prev.get("counties") and set(prev["counties"]) == set(out["counties"])
                    and all(prev["counties"][k].get("sha") == v["sha"] for k, v in out["counties"].items())
                    and prev.get("thesis_test") == out["thesis_test"] and prev.get("national") == out["national"])
            if same and prev.get("generated"):
                out["generated"] = prev["generated"]
                log(f"no county changed; keeping build stamp {out['generated']}")
        except Exception as e:      # a broken previous file is not a reason to stop
            log(f"previous {OUT} unreadable ({e}); new stamp")
    summary = write_outputs(out)
    log(f"wrote {OUT} + {DETAIL_DIR}/: {out['counts']}")
    if "--seed" in sys.argv:
        seed_page(sys.argv[sys.argv.index("--seed") + 1], out)
    log(f"thesis: {out['thesis_test']['status']} — {out['thesis_test'].get('verdict')}")


if __name__ == "__main__":
    main()
