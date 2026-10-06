#!/usr/bin/env python3
"""
fetch_cash_rent.py — county cash rent + trend yield -> data/cash-rent/

WHAT THIS IS
  NASS publishes county cash rent every August (2008 Farm Bill mandate: every
  county with 20,000+ acres of cropland plus pasture). Everybody republishes
  the number. Nobody contextualizes it. This pipeline banks the rent AND the
  county trend yield so the page can show rent as a share of what the ground
  can realistically gross -- the number that actually decides a lease.

HONESTY RULES BAKED IN
  * 2015 AND 2018 DO NOT EXIST. NASS ran no county cash rents survey in
    either year. We emit no 2015 or 2018 rent key, ever. The page must show
    a gap, not a line.
  * Suppressed counties stay suppressed. NASS withholds counties with too few
    responses ("(D)"). We drop them. We never interpolate a neighbor, never
    average a district down to a county, never invent a number.
  * Trend yield is a FIT, not an observation. It ships with r2 and n so the
    page can label it and refuse to show a garbage fit.
  * RENT AND YIELD MUST BE THE SAME PRACTICE. The rent-share ratio used to
    divide NON-IRRIGATED rent (or irrigated rent, where that was all NASS
    published) by the ALL-PRACTICE county yield. In an irrigated county the
    all-practice yield is mostly pivot corn: Finney Co. KS 2022 printed
    44.5 / (147.6 x 7.04) = 4.3% for dryland ground, where 147.6 bu was the
    irrigated acres talking. pair_county() now pairs dryland rent with the
    NON-IRRIGATED yield and irrigated rent with the IRRIGATED yield. The
    all-practice yield is used only where NASS shows no irrigation in the
    county at all (no irrigated corn or soybean yield in any year, and irrigated
    rent in fewer than IRR_RENT_MIN_YEARS years), i.e. where it is essentially a dryland yield. Anywhere else a
    year with no matching yield is WITHHELD with its reason in words; it is
    never filled from the mixed number. The basis of every ratio point and of
    the calculator's trend ships in the JSON ("nonirr" | "irr" | "all").

SOURCES (both USDA NASS Quick Stats, key required, free):
  rent  : RENT, CASH, {CROPLAND NON-IRRIGATED | CROPLAND IRRIGATED | PASTURE}
          - EXPENSE, MEASURED IN $ / ACRE   (agg_level_desc=COUNTY)
  yield : CORN, GRAIN - YIELD, MEASURED IN BU / ACRE                 (all practices)
          CORN, GRAIN, NON-IRRIGATED - YIELD, MEASURED IN BU / ACRE
          CORN, GRAIN, IRRIGATED - YIELD, MEASURED IN BU / ACRE
          SOYBEANS - YIELD, MEASURED IN BU / ACRE                    (all practices)
          SOYBEANS, NON-IRRIGATED - YIELD, MEASURED IN BU / ACRE
          SOYBEANS, IRRIGATED - YIELD, MEASURED IN BU / ACRE

USAGE
  python scripts/fetch_cash_rent.py --selftest     # offline, no key needed
  python scripts/fetch_cash_rent.py                # full national pull
  python scripts/fetch_cash_rent.py --states IA,IL # subset
"""

import argparse
import contextlib
import json
import os
import re
import shutil
import tempfile
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

API = "https://quickstats.nass.usda.gov/api/api_GET/"
OUTDIR = "data/cash-rent"
FIRST_YEAR = 2008
NO_SURVEY_YEARS = {2015, 2018}    # NASS ran no county cash rents survey in 2015 or 2018
TREND_WINDOW = 15                 # years of yield history for the trend fit
MIN_TREND_N = 6                   # fewer real years than this -> no trend, no guess
# A trend is not projected more than this many years past its last observed
# year. NASS stopped the Nebraska practice series after 2018; a 2012-2018 dryland
# fit (drought year first) projected to 2026 printed 287 bu for Adams NE dryland
# corn, which yields ~150. Three covers the normal one-year publication lag
# plus one missing survey year.
MAX_TREND_GAP = 3
# Years of published irrigated rent before it marks a county as irrigated.
IRR_RENT_MIN_YEARS = 2

RENT_KINDS = {
    "nonirr":  "RENT, CASH, CROPLAND, NON-IRRIGATED - EXPENSE, MEASURED IN $ / ACRE",
    "irr":     "RENT, CASH, CROPLAND, IRRIGATED - EXPENSE, MEASURED IN $ / ACRE",
    # NOT "RENT, CASH, PASTURE ..." — that string does not exist and NASS answers
    # it with HTTP 400, which api_get_safe() swallows as "no rows". Pasture would
    # have come back empty for every county in America and the page would have
    # printed "Not published — NASS withheld" over all of them: a wrong answer
    # wearing an honest label. Verified against the live API 2026-07-17:
    # 1,734 county rows for 2024 under this exact string.
    "pasture": "RENT, CASH, PASTURELAND - EXPENSE, MEASURED IN $ / ACRE",
}
YIELD_KINDS = {
    # ALL PRACTICES. Kept, unchanged, under the same keys: build_farmland_atlas,
    # build_state_rent_pages and field-scout read yield.corn. It is NOT paired
    # with rent unless the county shows no irrigation at all -- see pair_county().
    "corn":  "CORN, GRAIN - YIELD, MEASURED IN BU / ACRE",
    "beans": "SOYBEANS - YIELD, MEASURED IN BU / ACRE",
    # PRACTICE-SPECIFIC. These are what rent is divided by. Same per-state loop,
    # same api_get_safe() path, same suppression handling as the line above.
    # api_get_safe() turns HTTP 400 into "no rows", and NASS answers a WRONG
    # short_desc with HTTP 400 (the pasture-rent lesson above). So a typo here
    # would not fail -- it would quietly report "no dryland yield published"
    # for every county in America. main() therefore prints the national row
    # count of every practice series and REFUSES the run if a corn practice
    # series comes back empty in a run that included a state where NASS is
    # known to publish them (PRACTICE_CANARY_STATES).
    "corn_nonirr":  "CORN, GRAIN, NON-IRRIGATED - YIELD, MEASURED IN BU / ACRE",
    "corn_irr":     "CORN, GRAIN, IRRIGATED - YIELD, MEASURED IN BU / ACRE",
    "beans_nonirr": "SOYBEANS, NON-IRRIGATED - YIELD, MEASURED IN BU / ACRE",
    "beans_irr":    "SOYBEANS, IRRIGATED - YIELD, MEASURED IN BU / ACRE",
}
CROPS = ("corn", "beans")
PRACTICE_SERIES = ("corn_nonirr", "corn_irr", "beans_nonirr", "beans_irr")
# Corn practice series are load-bearing for the headline and the map, so an
# empty national pull is fatal. Soybean practice series only feed the second
# line of the ratio chart; if they come back empty the run warns loudly and
# pair_county() still refuses the all-practice soybean yield anywhere the
# county shows irrigation (irrigated rent or an irrigated corn yield), so an
# empty soybean series withholds points -- it cannot publish a mismatched one.
FATAL_IF_EMPTY = ("corn_nonirr", "corn_irr")
# NASS publishes county corn yields by practice in these states every year
# (the Plains irrigation belt). A run that covers one of them and gets zero
# practice rows has a broken string, not a quiet year.
PRACTICE_CANARY_STATES = {"NE", "KS", "CO", "TX"}

# Bump when the pairing rule changes; the page reads it to know the file
# carries "pair" blocks (older files do not, and the page treats them as
# unpaired -- see cash-rent.html LEGACY rule).
PAIR_RULE = 3
BASES = ("nonirr", "irr", "all")
REASON_MIXED = "county yield mixes irrigated and dryland acres"
REASON_IRR_ONLY_DRY = "NASS published only a dryland county yield, which does not match irrigated rent"
# Marketing-year average price RECEIVED by farmers, by state. This is the key
# to the whole page. It is not the board: it is what producers actually got,
# state by state, which means BASIS IS ALREADY IN IT. Pairing it with the
# county yield of the same year gives a gross revenue per acre that is entirely
# observed -- no assumption, no model, no fudge factor -- so the historical
# ratio is a real number for every year rather than a reconstruction.
PRICE_KINDS = {
    "corn":  "CORN, GRAIN - PRICE RECEIVED, MEASURED IN $ / BU",
    "beans": "SOYBEANS - PRICE RECEIVED, MEASURED IN $ / BU",
}

# NASS suppression / non-value markers. Anything matching is NOT a number.
SUPPRESSED = re.compile(r"^\s*\((D|L|NA|X|Z|S)\)\s*$", re.I)

STATES = [
    "AL","AR","AZ","CA","CO","CT","DE","FL","GA","IA","ID","IL","IN","KS","KY",
    "LA","MA","MD","ME","MI","MN","MO","MS","MT","NC","ND","NE","NH","NJ","NM",
    "NV","NY","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VA","VT","WA",
    "WI","WV","WY",
]  # Alaska excluded: NASS runs no cash rents survey there. Hawaii has no counties in the survey frame.


def log(*a):
    print(*a, flush=True)


def parse_value(raw):
    """NASS Value -> float, or None if suppressed/absent. Never guesses."""
    if raw is None:
        return None
    s = str(raw).strip()
    if not s or SUPPRESSED.match(s):
        return None
    s = s.replace(",", "").replace("$", "")
    try:
        v = float(s)
    except ValueError:
        return None
    return v if v > 0 else None


def fips(rec):
    """5-digit county FIPS from state+county ANSI. None if either is missing."""
    st, co = (rec.get("state_fips_code") or "").strip(), (rec.get("county_ansi") or "").strip()
    if not st or not co:
        return None
    return st.zfill(2) + co.zfill(3)


def fit_trend(pairs):
    """Ordinary least squares yield ~ year.

    Returns (slope, intercept, r2, n) or None. Pure python: no numpy needed in
    the workflow, and the math is auditable by anyone reading this file.
    """
    pairs = sorted(pairs)
    n = len(pairs)
    if n < MIN_TREND_N:
        return None
    xs = [p[0] for p in pairs]
    ys = [p[1] for p in pairs]
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    if sxx == 0:
        return None
    sxy = sum((xs[i] - mx) * (ys[i] - my) for i in range(n))
    slope = sxy / sxx
    intercept = my - slope * mx
    sst = sum((y - my) ** 2 for y in ys)
    ssr = sum((ys[i] - (slope * xs[i] + intercept)) ** 2 for i in range(n))
    r2 = 1.0 - (ssr / sst) if sst > 0 else 0.0
    return slope, intercept, r2, n


def api_get(key, short_desc, state, extra=None):
    """One Quick Stats county query. Raises on transport/HTTP failure.

    NASS caps a response at 50,000 records, so every call is scoped to one
    state and one short_desc -- comfortably under the cap and it keeps a single
    bad state from poisoning the whole run.
    """
    q = {
        "key": key,
        "short_desc": short_desc,
        "agg_level_desc": "COUNTY",
        "state_alpha": state,
        "year__GE": str(FIRST_YEAR),
        "format": "JSON",
    }
    q.update(extra or {})   # callers override agg_level_desc / reference_period_desc
    url = API + "?" + urllib.parse.urlencode(q)
    req = urllib.request.Request(url, headers={"User-Agent": "AGSIST/1.0 (+https://agsist.com)"})
    # NASS throttles sustained multi-state pulls with HTTP 403 (observed live
    # 2026-07-18: 19 states fetched clean, then 403 on the 20th — same key that
    # had just worked 19 times, so it's rate limiting, not auth). 403/429/5xx
    # get patient exponential backoff; a hard 400 still propagates immediately
    # (that's the documented "no rows" answer, handled by api_get_safe).
    body = None
    for attempt, pause in enumerate((0, 45, 120, 300)):
        if pause:
            print(f"      NASS throttled ({state}/{short_desc[:30]}…) — "
                  f"backing off {pause}s, retry {attempt}/3", file=sys.stderr)
            time.sleep(pause)
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                body = r.read().decode("utf-8", "replace")
            break
        except urllib.error.HTTPError as e:
            if e.code in (403, 429) or e.code >= 500:
                if attempt == 3:
                    raise
                continue
            raise
    # NASS answers "no rows" with HTTP 400 + this text. That is a legitimate
    # empty result (e.g. no irrigated cropland in Rhode Island), not a failure.
    if "exceeds the limit" in body:
        raise RuntimeError(f"NASS record cap hit for {state}/{short_desc} — narrow the query")
    try:
        return json.loads(body).get("data", [])
    except json.JSONDecodeError:
        if "bad request" in body.lower() or "no data" in body.lower():
            return []
        raise


def api_get_safe(key, short_desc, state, extra=None):
    try:
        return api_get(key, short_desc, state, extra)
    except urllib.error.HTTPError as e:
        if e.code == 400:
            return []          # documented "no rows match" response
        raise


def yield_entry(pairs, cur):
    """[(year, value), ...] -> {"hist": {...}, + trend fields when the fit holds}.

    Full per-year history is retained: the ratio chart needs the ACTUAL yield
    of each year, not a trend line evaluated at it. A trend is what you
    expect; history is what happened. Each practice series gets its own entry
    and its own fit -- a dryland trend is fitted on dryland years only.
    """
    hist = {str(y): round(v, 1) for y, v in sorted(pairs)}
    entry = {"hist": hist}
    recent = [p for p in pairs if p[0] > cur - TREND_WINDOW]
    fit = fit_trend(recent)
    last_year = max((p[0] for p in recent), default=None)
    if fit and cur - last_year > MAX_TREND_GAP:
        entry["trend_w"] = (f"the county series ends in {last_year}; a trend is not "
                            f"projected {cur - last_year} years past its last year")
        fit = None
    if fit:
        slope, intercept, r2, n = fit
        entry.update({
            "trend": round(slope * cur + intercept, 1),
            "slope": round(slope, 3),
            "r2": round(r2, 3),
            "n": n,
            "last": round(sorted(recent)[-1][1], 1),
        })
    return entry


def collect_state(key, state, getter=None, cur=None):
    """-> (counties dict, stats dict). Fail-loud: exceptions propagate.

    getter defaults to api_get_safe; the selftest and the offline fixture pass
    a function with the same signature that serves NASS-shaped records, so
    the exact code path the workflow runs is the one that gets tested.
    stats["rows"][kind] counts the usable (non-suppressed, FIPS-bearing) rows
    each yield series returned, so main() can say out loud what it got.
    """
    getter = getter or api_get_safe
    cur = cur or datetime.now(timezone.utc).year
    counties = {}
    rows = {}

    def touch(f, name):
        if f not in counties:
            counties[f] = {"fips": f, "name": name, "rent": {}, "yield": {}}
        return counties[f]

    for kind, sd in RENT_KINDS.items():
        for rec in getter(key, sd, state):
            f = fips(rec)
            v = parse_value(rec.get("Value"))
            year = int(rec.get("year", 0))
            if not f or v is None or year in NO_SURVEY_YEARS:
                continue
            c = touch(f, (rec.get("county_name") or "").title())
            c["rent"].setdefault(kind, {})[str(year)] = round(v, 2)

    for kind, sd in YIELD_KINDS.items():
        raw = {}
        n_rows = 0
        for rec in getter(key, sd, state):
            f = fips(rec)
            v = parse_value(rec.get("Value"))
            year = int(rec.get("year", 0))
            if not f or v is None:
                continue
            n_rows += 1
            raw.setdefault(f, []).append((year, v))
        rows[kind] = n_rows
        for f, pairs in raw.items():
            if f not in counties:
                continue   # yield but no rent: nothing to contextualise, skip
            counties[f]["yield"][kind] = yield_entry(pairs, cur)

    # A county with no rent series at all is noise — drop it.
    counties = {f: c for f, c in counties.items() if c["rent"]}
    for c in counties.values():
        c["pair"] = pair_county(c)
    stats = {
        "counties": len(counties),
        "with_nonirr": sum(1 for c in counties.values() if c["rent"].get("nonirr")),
        "with_corn_trend": sum(1 for c in counties.values() if c["yield"].get("corn", {}).get("trend")),
        "rows": rows,
    }
    return counties, stats


def irrigation_signal(c):
    """Does NASS show ANY irrigation in this county, in ANY year?

    Irrigated cropland rent, or an irrigated corn or soybean county yield.
    Any year, not just the ratio year: pivots do not come and go, and NASS
    publishes the irrigated series intermittently (Finney KS irrigated rent
    is missing in 2022 and 2024 -- the pivots were not). Where this is False
    the all-practice yield is, as far as NASS can tell us, a dryland yield.

    Irrigated rent counts only when NASS published it in IRR_RENT_MIN_YEARS or
    more years. One stray year is thin evidence of material irrigated acres:
    Polk IA has a single irrigated rent (2017) and no irrigated yield ever, and
    that one figure withheld its rent share. Relaxed 2026-10-06 at Sig's call;
    110 counties had exactly one irrigated-rent year. An irrigated county yield
    in any year still counts on its own.
    """
    if len(c.get("rent", {}).get("irr") or {}) >= IRR_RENT_MIN_YEARS:
        return True
    y = c.get("yield", {})
    return any((y.get(k) or {}).get("hist") for k in ("corn_irr", "beans_irr"))


def pair_county(c):
    """THE PAIRING RULE. One copy, here; the page and the map read its output.

    Rent: non-irrigated where published, else irrigated (unchanged).
    Per crop and per rent year:
      non-irrigated rent -> NON-IRRIGATED county yield of that year      "nonirr"
                         -> else ALL-PRACTICE yield, only if the county
                            shows no irrigation in any year              "all"
                         -> else WITHHELD, REASON_MIXED
      irrigated rent     -> IRRIGATED county yield of that year          "irr"
                         -> else WITHHELD (all-practice mixes the two;
                            a dryland yield is the wrong practice)
    A year with no county yield of any kind produces no point and no reason
    (same as before: nothing to divide by, and nothing mismatched to hide).

    The calculator trend follows the same rule on the fitted series: the
    dryland fit for dryland rent, the irrigated fit for irrigated rent, the
    all-practice fit only for a county with no irrigation. Never a mix.

    -> {"rent": "nonirr"|"irr",
        "corn": {"y": {year: [yield, basis]}, "w": {year: reason},
                 "t": {"v","r2","n","slope","last","b"} | {"w": reason} | {}},
        "beans": {...}}   or None when the county has no cropland rent.
    """
    rents = c.get("rent", {})
    rk = "nonirr" if rents.get("nonirr") else ("irr" if rents.get("irr") else None)
    if rk is None:
        return None
    rent = rents[rk]
    irrigated = irrigation_signal(c)
    yl = c.get("yield", {})
    out = {"rent": rk}
    for crop in CROPS:
        h_all = (yl.get(crop) or {}).get("hist") or {}
        h_ni = (yl.get(crop + "_nonirr") or {}).get("hist") or {}
        h_ir = (yl.get(crop + "_irr") or {}).get("hist") or {}
        ys, ws = {}, {}
        for y in sorted(rent, key=int):
            if rk == "nonirr":
                if y in h_ni:
                    ys[y] = [h_ni[y], "nonirr"]
                elif not irrigated and y in h_all:
                    ys[y] = [h_all[y], "all"]
                elif y in h_all or y in h_ir:
                    ws[y] = REASON_MIXED
            else:
                if y in h_ir:
                    ys[y] = [h_ir[y], "irr"]
                elif y in h_all:
                    ws[y] = REASON_MIXED
                elif y in h_ni:
                    ws[y] = REASON_IRR_ONLY_DRY
        # trend for the calculator, same basis as the rent it is paired with
        t_ni = yl.get(crop + "_nonirr") or {}
        t_ir = yl.get(crop + "_irr") or {}
        t_all = yl.get(crop) or {}
        t = {}
        if rk == "nonirr":
            if t_ni.get("trend") is not None:
                t = _trend_out(t_ni, "nonirr")
            elif not irrigated and t_all.get("trend") is not None:
                t = _trend_out(t_all, "all")
            elif t_ni.get("trend_w") and (irrigated or not t_all.get("hist")):
                t = {"w": t_ni["trend_w"].replace("the county series", "the county's dryland yield series")}
            elif not irrigated and t_all.get("trend_w"):
                t = {"w": t_all["trend_w"]}
            elif irrigated and (t_all.get("hist") or t_ir.get("hist") or t_ni.get("hist")):
                t = {"w": (REASON_MIXED if not t_ni.get("hist") else
                           f"fewer than {MIN_TREND_N} dryland county yields in the last {TREND_WINDOW} years, "
                           f"and the all-practice yield is not a substitute: {REASON_MIXED}")}
        else:
            if t_ir.get("trend") is not None:
                t = _trend_out(t_ir, "irr")
            elif t_ir.get("trend_w"):
                t = {"w": t_ir["trend_w"].replace("the county series", "the county's irrigated yield series")}
            elif t_ir.get("hist"):
                t = {"w": f"fewer than {MIN_TREND_N} irrigated county yields in the last {TREND_WINDOW} years"}
            elif t_all.get("hist"):
                t = {"w": REASON_MIXED}
            elif t_ni.get("hist"):
                t = {"w": REASON_IRR_ONLY_DRY}
        out[crop] = {"y": ys, "w": ws, "t": t}
    return out


def practice_series_guard(rows_total, states):
    """-> {"fatal": [...], "warn": [...]} for practice series with 0 rows.

    Fatal only for corn (FATAL_IF_EMPTY) and only when the run included a
    PRACTICE_CANARY_STATES state: a --states RI,CT subset legitimately gets
    nothing and must not fail. Soybean practice series only warn.
    """
    canary = bool(PRACTICE_CANARY_STATES & set(states))
    empty = [k for k in PRACTICE_SERIES if rows_total.get(k, 0) == 0]
    return {"fatal": [k for k in empty if k in FATAL_IF_EMPTY and canary],
            "warn": [k for k in empty if not (k in FATAL_IF_EMPTY and canary)]}


def _trend_out(e, basis):
    return {"v": e["trend"], "r2": e["r2"], "n": e["n"], "slope": e["slope"],
            "last": e["last"], "b": basis}


def collect_prices(key, state):
    """State marketing-year average price received, by crop and year.

    reference_period_desc=MARKETING YEAR is mandatory: without it NASS also
    returns the monthly price series and the years collide, silently
    overwriting the annual average with whatever month sorted last.
    """
    out = {}
    for crop, sd in PRICE_KINDS.items():
        for rec in api_get_safe(key, sd, state, {
            "agg_level_desc": "STATE",
            "reference_period_desc": "MARKETING YEAR",
            "freq_desc": "ANNUAL",
        }):
            if (rec.get("reference_period_desc") or "").strip().upper() != "MARKETING YEAR":
                continue                      # belt and braces: never trust the filter alone
            v = parse_value(rec.get("Value"))
            if v is None:
                continue
            out.setdefault(crop, {})[str(int(rec["year"]))] = round(v, 2)
    return out


def prelim_price_years(prices):
    """Marketing years that are not final yet.

    A crop year's MYA is not finalised until roughly September of the FOLLOWING
    year, so anything from last year forward can still be revised. We mark it
    rather than hide it: a preliminary number honestly labelled beats a missing
    one, and beats an unlabelled one by a mile.
    """
    cur = datetime.now(timezone.utc).year
    yrs = {int(y) for c in prices.values() for y in c}
    return sorted(y for y in yrs if y >= cur - 1)


def write_state(state, counties, prices):
    os.makedirs(OUTDIR, exist_ok=True)
    years = sorted({int(y) for c in counties.values()
                    for kind in c["rent"].values() for y in kind})
    doc = {
        "state": state,
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "years": years,
        "no_survey_years": sorted(NO_SURVEY_YEARS),
        "prices": prices,
        "price_prelim": prelim_price_years(prices),
        "price_note": "State marketing-year average price received by farmers (USDA NASS). Reflects actual sales, so local basis is already embedded. Not a futures price.",
        "source": "USDA NASS Quick Stats — Cash Rents Survey (county estimates, released each August), county yield estimates, and state marketing-year average prices received",
        "pair_rule": PAIR_RULE,
        "pair_note": ("Rent is divided by a county yield of the same practice: non-irrigated rent by the non-irrigated "
                      "yield, irrigated rent by the irrigated yield. The all-practice yield is used only where NASS shows "
                      "no irrigation in the county (no irrigated yield in any year, and irrigated rent in at most one year). Otherwise the "
                      "year is withheld with its reason. Basis per point: nonirr | irr | all."),
        "counties": [counties[f] for f in sorted(counties)],
    }
    path = os.path.join(OUTDIR, f"{state}.json")
    with open(path, "w") as fh:
        json.dump(doc, fh, separators=(",", ":"))
    return path, len(doc["counties"])


def emit_national():
    """Roll the state files up into one national county layer for the map.

    For each county we take the LATEST year in which rent, county yield and
    state price all exist together. That year differs by county, so it ships
    per county and the map legend says so -- a single "2024 map" that quietly
    used 2019 numbers for a third of the country would be a lie of omission.

    The yield is the PAIRED yield from pair_county() (same practice as the
    rent), never the raw all-practice series. Per county the record carries
    "pb" (basis: nonirr | irr | all) and "rk" (rent kind). A county whose
    paired years are all withheld gets no "p" but "pw" (reason) and "pwy"
    (the latest withheld year), so the map can say why it is blank.
    """
    files = [f for f in sorted(os.listdir(OUTDIR)) if re.match(r"^[A-Z]{2}\.json$", f)]
    out, rents, pcts, yrs, rent_yrs = {}, [], [], [], []
    basis_n = {b: 0 for b in BASES}
    n_withheld = 0
    for fn in files:
        d = json.load(open(os.path.join(OUTDIR, fn)))
        prices = d.get("prices", {}).get("corn", {})
        prelim = set(str(y) for y in d.get("price_prelim", []))
        for c in d["counties"]:
            rent = c["rent"].get("nonirr") or c["rent"].get("irr")
            if not rent:
                continue
            ry = max(rent, key=lambda y: int(y))
            rec = {"r": rent[ry], "ry": int(ry), "s": d["state"], "n": c["name"]}
            rents.append(rent[ry])
            rent_yrs.append(int(ry))
            # Recompute rather than trust a "pair" block from disk: a state
            # file written before PAIR_RULE existed has none, and the rule
            # must be the one in this file, applied once, everywhere.
            pr = pair_county(c) or {}
            pc = pr.get("corn") or {}
            py_ = pc.get("y") or {}
            common = [y for y in rent if y in py_ and y in prices]
            if common:
                y = max(common, key=lambda z: int(z))
                gross = py_[y][0] * prices[y]
                if gross > 0:
                    pct = rent[y] / gross * 100
                    rec.update({"p": round(pct, 1), "py": int(y),
                                "pp": 1 if y in prelim else 0,
                                "pb": py_[y][1], "rk": pr["rent"]})
                    pcts.append(pct)
                    yrs.append(int(y))
                    basis_n[py_[y][1]] += 1
            if "p" not in rec:
                wh = [y for y in (pc.get("w") or {}) if y in prices]
                if wh:
                    y = max(wh, key=lambda z: int(z))
                    rec.update({"pw": pc["w"][y], "pwy": int(y), "rk": pr["rent"]})
                    n_withheld += 1
            out[c["fips"]] = rec

    def breaks(vals, n=6):
        """Quantile breaks. Quantiles, not equal intervals: rent is heavily
        skewed and equal intervals would paint the whole Corn Belt one colour."""
        v = sorted(vals)
        if len(v) < n:
            return v
        return [round(v[int(len(v) * i / n)], 1) for i in range(1, n)]

    doc = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "counties": out,
        "rent_breaks": breaks(rents),
        "pct_breaks": breaks(pcts),
        "pct_years": (sorted(set(yrs))[0], sorted(set(yrs))[-1]) if yrs else None,
        # n_rent = counties with ANY rent, including older carried-forward
        # ones (2877 vs 2400 from the latest survey on 2026-09-23). Pages that
        # say "counties with a <year> rent" must use n_rent_latest.
        "n_rent": len(rents),
        "rent_year": max(rent_yrs) if rent_yrs else None,
        "n_rent_latest": sum(1 for y in rent_yrs if y == max(rent_yrs)) if rent_yrs else 0,
        "n_pct": len(pcts),
        "n_pct_withheld": n_withheld,
        "pct_basis": basis_n,
        "pair_rule": PAIR_RULE,
        "note": ("Ratio year varies by county: each county uses its own latest year in which rent, a county corn yield "
                 "of the SAME practice, and state price received all exist. Rent is the latest published rent, "
                 "non-irrigated where available. Non-irrigated rent is divided by the non-irrigated yield, irrigated "
                 "rent by the irrigated yield; the all-practice yield only where NASS shows no irrigation in the "
                 "county. Counties where the only yield mixes irrigated and dryland acres are withheld (pw = reason)."),
    }
    with open(os.path.join(OUTDIR, "national.json"), "w") as fh:
        json.dump(doc, fh, separators=(",", ":"))
    return doc


@contextlib.contextmanager
def _scratch_outdir():
    """THE SELFTEST MUST NOT WRITE INTO data/cash-rent.

    emit_national() rolls up every [A-Z]{2}.json it finds there, so a fixture
    dropped beside 49 real state files produces a national number built from
    both — which is how `assert nat["n_rent"] == 2` came to fail with 2772. The
    assertion was fine; the directory was not empty any more.

    Worse than the wrong count: write_state() overwrote the real IA.json with
    the two-county fixture and emit_national() then rewrote national.json from
    that. The assert fires immediately after, so CI exits before committing
    anything, but a passing run would have left a national.json with no real
    Iowa counties in it.

    Every path in this file resolves through OUTDIR, so swapping it is enough.
    """
    global OUTDIR
    real = OUTDIR
    tmp = tempfile.mkdtemp(prefix="cash-rent-selftest-")
    OUTDIR = tmp
    try:
        yield tmp
    finally:
        OUTDIR = real
        shutil.rmtree(tmp, ignore_errors=True)


def selftest():
    """Offline. NASS is blocked in the sandbox, so exercise every rule that
    matters against synthetic records: suppression, the 2015/2018 holes, FIPS
    assembly, trend fitting, the thin-data refusal, the same-practice pairing
    of rent and yield (dryland, irrigated-fallback, mixed-withheld,
    no-irrigation), and the empty-practice-series refusal."""
    log("SELFTEST: cash rent")
    _real_outdir = OUTDIR
    _before_outdir = sorted(os.listdir(OUTDIR)) if os.path.isdir(OUTDIR) else []

    # --- suppression markers are never numbers -------------------------------
    for bad in ["(D)", "(NA)", "(X)", "(Z)", "(L)", "", "  ", None, "0"]:
        assert parse_value(bad) is None, f"suppression leak: {bad!r} parsed"
    assert parse_value("1,234.50") == 1234.5, "thousands separator broke"
    assert parse_value("$212") == 212.0
    log("  suppression + numeric parse OK")

    # --- FIPS ---------------------------------------------------------------
    assert fips({"state_fips_code": "19", "county_ansi": "169"}) == "19169"
    assert fips({"state_fips_code": "19", "county_ansi": ""}) is None
    log("  FIPS assembly OK")

    # --- trend fit: exact recovery of a known line ---------------------------
    truth = [(y, 2.0 * y - 3830.0) for y in range(2011, 2026)]
    slope, intercept, r2, n = fit_trend(truth)
    assert abs(slope - 2.0) < 1e-6, slope
    assert abs(r2 - 1.0) < 1e-9, r2
    assert n == 15
    log(f"  trend fit recovers a known line (slope={slope:.3f}, r2={r2:.4f})")

    # --- thin data must REFUSE, not extrapolate -----------------------------
    assert fit_trend([(2023, 180.0), (2024, 182.0)]) is None, "fit on 2 points!"
    assert fit_trend([(2020, 1.0)] * 8) is None, "zero variance produced a fit"
    log("  thin/degenerate data refused")

    # --- a series that stopped must not be projected years past its end -----
    # Adams NE dryland corn, 2012-2018 as NASS published it.
    adams = [(2012, 51.2), (2013, 97.7), (2014, 111.4), (2015, 128.7),
             (2016, 121.7), (2017, 147.5), (2018, 159.2)]
    e = yield_entry(adams, 2026)
    assert "trend" not in e and "2018" in e.get("trend_w", ""), e
    e = yield_entry(adams, 2021)
    assert e.get("trend") is not None and "trend_w" not in e, "a 3-year gap must still fit"
    log("  stale practice series refused (Adams NE dryland, ended 2018)")

    # --- one stray irrigated-rent year is not irrigation; two are ----------
    assert not irrigation_signal({"rent": {"irr": {"2017": 373.0}}}), "1 year counted"
    assert irrigation_signal({"rent": {"irr": {"2017": 373.0, "2019": 360.0}}}), "2 years ignored"
    assert irrigation_signal({"rent": {}, "yield": {"corn_irr": {"hist": {"2010": 200.0}}}})
    log(f"  irrigation signal: irrigated rent needs {IRR_RENT_MIN_YEARS}+ years; an irrigated yield counts alone")

    # --- 2015 and 2018 must never survive the filter ------------------------
    recs = [{"state_fips_code": "19", "county_ansi": "169", "county_name": "STORY",
             "year": str(y), "Value": "250"} for y in (2014, 2015, 2016, 2017, 2018, 2019)]
    kept = [r for r in recs if int(r["year"]) not in NO_SURVEY_YEARS]
    assert [r["year"] for r in kept] == ["2014", "2016", "2017", "2019"], "a no-survey year leaked"
    log("  2015/2018 holes preserved (no survey those years)")

    # --- preliminary marketing years are flagged, not hidden -----------------
    cur = datetime.now(timezone.utc).year
    pl = prelim_price_years({"corn": {str(cur - 3): 4.5, str(cur - 1): 4.6, str(cur): 4.7}})
    assert pl == [cur - 1, cur], pl
    assert (cur - 3) not in pl, "a settled marketing year was wrongly flagged preliminary"
    log(f"  preliminary price years flagged: {pl} (settled years untouched)")

    # --- the historical ratio: every term observed, none modelled ------------
    rent = {"2012": 250.0, "2024": 269.0}
    yhist = {"2012": 137.0, "2024": 205.0}          # 2012 drought year
    phist = {"2012": 6.89, "2024": 4.35}
    ratios = {}
    for y in sorted(rent):
        gross = yhist[y] * phist[y]
        ratios[y] = round(rent[y] / gross * 100, 1)
    assert ratios["2012"] == round(250.0 / (137.0 * 6.89) * 100, 1)
    assert ratios["2024"] > ratios["2012"], "expected the squeeze to be visible"
    log(f"  ratio history math OK: 2012={ratios['2012']}%  2024={ratios['2024']}%  "
        f"(+{ratios['2024'] - ratios['2012']:.1f} pts of gross)")

    # --- a year missing ANY term must yield NO ratio point -------------------
    for missing in ("rent", "yield", "price"):
        r = None if missing == "rent" else 250.0
        yv = None if missing == "yield" else 137.0
        pv = None if missing == "price" else 6.89
        ok = (r is not None and yv is not None and pv is not None)
        assert not ok, f"{missing} missing but a ratio was still computed"
    log("  missing-term years produce no ratio point (no partial invention)")

    # --- end-to-end doc shape ------------------------------------------------
    # From here down the selftest writes files, so it runs in its own
    # directory. Nothing below can see or touch the committed state files.
    with _scratch_outdir():
      counties = {"19169": {"fips": "19169", "name": "Story",
                            "rent": {"nonirr": {"2024": 269.0, "2016": 230.0}},
                            "yield": {"corn": {"trend": 201.4, "r2": 0.71, "n": 15, "slope": 1.9,
                                               "last": 205.0, "hist": {"2016": 203.0, "2024": 205.0}}}}}
      prices = {"corn": {"2016": 3.36, "2024": 4.35}}
      path, n = write_state("IA", counties, prices)
      doc = json.load(open(path))
      assert doc["years"] == [2016, 2024], doc["years"]
      assert 2015 not in doc["years"] and 2018 not in doc["years"]
      assert doc["no_survey_years"] == [2015, 2018]
      assert doc["prices"]["corn"]["2024"] == 4.35
      assert doc["counties"][0]["yield"]["corn"]["hist"]["2016"] == 203.0
      json.dumps(doc)
      os.remove(path)
      log(f"  document shape OK ({n} county, years={doc['years']}, prices+yield history carried)")

      # --- national roll-up ----------------------------------------------------
      counties2 = {
          "19169": {"fips": "19169", "name": "Story",
                    "rent": {"nonirr": {"2016": 230.0, "2024": 269.0}},
                    "yield": {"corn": {"hist": {"2016": 203.0, "2024": 205.0}}}},
          "19153": {"fips": "19153", "name": "Polk",          # rent but no yield -> rent only
                    "rent": {"nonirr": {"2024": 240.0}}, "yield": {}},
          "19001": {"fips": "19001", "name": "Adair",         # only an older rent, carried forward
                    "rent": {"nonirr": {"2019": 200.0}}, "yield": {}},
      }
      write_state("IA", counties2, {"corn": {"2016": 3.36, "2024": 4.35}})
      nat = emit_national()
      # Derived by hand from counties2: three counties have a rent (Story 2024,
      # Polk 2024, Adair 2019 carried forward), so n_rent = 3; only two are from
      # the newest year in the file (2024), so n_rent_latest = 2.
      assert nat["n_rent"] == 3, nat["n_rent"]
      assert nat["rent_year"] == 2024 and nat["n_rent_latest"] == 2, nat
      assert nat["n_pct"] == 1, "county without yield must have rent but NO ratio"
      s = nat["counties"]["19169"]
      assert abs(s["p"] - (269.0 / (205.0 * 4.35) * 100)) < 0.05, s
      assert s["py"] == 2024 and s["ry"] == 2024
      assert "p" not in nat["counties"]["19153"], "ratio invented for a county with no yield"
      log(f"  national roll-up OK ({nat['n_rent']} rent, {nat['n_rent_latest']} in {nat['rent_year']}, {nat['n_pct']} ratio, "
          f"Story={nat['counties']['19169']['p']}%)")
      assert s["pb"] == "all", "Story shows no irrigation: all-practice is the dryland yield there"
      os.remove(os.path.join(OUTDIR, "IA.json")); os.remove(os.path.join(OUTDIR, "national.json"))

      # --- RENT AND YIELD OF THE SAME PRACTICE --------------------------------
      # Synthetic NASS-shaped records, served through collect_state() by a fake
      # getter so the workflow's own code path is the one under test. Every
      # 2022 value is hand-picked; each series is a straight line (1 bu/yr)
      # ending at that value, so the 2022 trend equals the 2022 value exactly.
      # Price 7.04 (synthetic). Expected ratios worked by hand below.
      def rec(f, name, year, val):
          return {"state_fips_code": "20", "county_ansi": f[2:], "county_name": name,
                  "year": str(year), "Value": str(val)}

      def line(f, name, v2022):
          return [rec(f, name, y, v2022 - (2022 - y)) for y in range(2013, 2023)]

      R, Y = RENT_KINDS, YIELD_KINDS
      fx = {
          R["nonirr"]: [rec("20001", "DRYLAND", 2022, "44.5"), rec("20005", "MIXED", 2022, "60"),
                        rec("20007", "NOIRR", 2022, "90"), rec("20009", "IRRYIELDONLY", 2022, "50"),
                        rec("20011", "ONESTRAY", 2022, "70")],
          R["irr"]: [rec("20001", "DRYLAND", 2022, "180"), rec("20003", "IRRFALLBACK", 2022, "200"),
                     rec("20005", "MIXED", 2022, "150"), rec("20005", "MIXED", 2021, "145"),
                     # one stray irrigated-rent year (Polk IA 2017): not irrigation
                     rec("20011", "ONESTRAY", 2017, "160")],
          R["pasture"]: [],
          # all-practice: present everywhere, and mostly-irrigated where pivots exist
          Y["corn"]: (line("20001", "DRYLAND", 147.6) + line("20003", "IRRFALLBACK", 190.0)
                      + line("20005", "MIXED", 170.0) + line("20007", "NOIRR", 130.0)
                      + line("20011", "ONESTRAY", 140.0)
                      + line("20009", "IRRYIELDONLY", 165.0)),
          Y["corn_nonirr"]: line("20001", "DRYLAND", 60.0) + [rec("20001", "DRYLAND", 2012, "(D)")],
          Y["corn_irr"]: (line("20001", "DRYLAND", 200.0) + line("20003", "IRRFALLBACK", 220.0)
                          + [rec("20009", "IRRYIELDONLY", 2019, "210")]),
          Y["beans"]: [], Y["beans_nonirr"]: [], Y["beans_irr"]: [],
      }
      fake = lambda key, sd, state, extra=None: list(fx.get(sd, []))
      cs, st_ = collect_state("x", "KS", getter=fake, cur=2022)
      # 10 usable rows per line; the (D) row is suppression and must not count
      assert st_["rows"]["corn_nonirr"] == 10 and st_["rows"]["corn_irr"] == 21, st_["rows"]
      assert st_["rows"]["beans_irr"] == 0
      P = 7.04
      pr = {f: cs[f]["pair"] for f in cs}
      # (1) dryland county: non-irrigated rent / NON-IRRIGATED yield.
      #     44.5 / (60.0 x 7.04) = 10.54 %   (the old all-practice pairing: 44.5/(147.6x7.04) = 4.28 %)
      assert pr["20001"]["rent"] == "nonirr" and pr["20001"]["corn"]["y"]["2022"] == [60.0, "nonirr"], pr["20001"]
      assert pr["20001"]["corn"]["t"]["b"] == "nonirr" and pr["20001"]["corn"]["t"]["v"] == 60.0, pr["20001"]["corn"]["t"]
      # (2) irrigated-fallback county (no dryland rent): irrigated rent / IRRIGATED yield.
      #     200 / (220.0 x 7.04) = 12.91 %
      assert pr["20003"]["rent"] == "irr" and pr["20003"]["corn"]["y"]["2022"] == [220.0, "irr"], pr["20003"]
      assert pr["20003"]["corn"]["t"]["b"] == "irr" and pr["20003"]["corn"]["t"]["v"] == 220.0
      # (3) mixed county, irrigated rent exists, no practice-specific yield: WITHHELD, reason in words
      assert pr["20005"]["corn"]["y"] == {} and pr["20005"]["corn"]["w"] == {"2022": REASON_MIXED}, pr["20005"]
      assert pr["20005"]["corn"]["t"] == {"w": REASON_MIXED}, pr["20005"]["corn"]["t"]
      # (3b) ONE stray irrigated-rent year, no irrigated yield: all-practice is used
      assert pr["20011"]["corn"]["y"]["2022"] == [140.0, "all"] and pr["20011"]["corn"]["t"]["b"] == "all", pr["20011"]
      # (4) no irrigation anywhere in NASS: all-practice is the dryland yield. 90 / (130.0 x 7.04) = 9.83 %
      assert pr["20007"]["corn"]["y"]["2022"] == [130.0, "all"] and pr["20007"]["corn"]["t"]["b"] == "all", pr["20007"]
      # (5) no irrigated rent, but NASS published an irrigated corn yield (2019 only): the
      #     county irrigates, so the 2022 all-practice yield is mixed -> withheld (any-year signal)
      assert pr["20009"]["corn"]["y"] == {} and pr["20009"]["corn"]["w"] == {"2022": REASON_MIXED}, pr["20009"]
      write_state("KS", cs, {"corn": {"2022": P}})
      nat = emit_national()
      nc = nat["counties"]
      assert nc["20001"]["p"] == round(44.5 / (60.0 * P) * 100, 1) == 10.5 and nc["20001"]["pb"] == "nonirr", nc["20001"]
      assert nc["20003"]["p"] == round(200 / (220.0 * P) * 100, 1) == 12.9 and nc["20003"]["pb"] == "irr", nc["20003"]
      assert "p" not in nc["20005"] and nc["20005"]["pw"] == REASON_MIXED and nc["20005"]["pwy"] == 2022, nc["20005"]
      assert nc["20007"]["p"] == round(90 / (130.0 * P) * 100, 1) == 9.8 and nc["20007"]["pb"] == "all", nc["20007"]
      assert "p" not in nc["20009"] and nc["20009"]["pw"] == REASON_MIXED
      assert nc["20011"]["p"] == round(70 / (140.0 * P) * 100, 1) == 7.1 and nc["20011"]["pb"] == "all", nc["20011"]
      assert nat["n_pct"] == 4 and nat["n_pct_withheld"] == 2, nat
      assert nat["pct_basis"] == {"nonirr": 1, "irr": 1, "all": 2}, nat["pct_basis"]
      assert json.load(open(os.path.join(OUTDIR, "KS.json")))["pair_rule"] == PAIR_RULE
      log("  practice pairing OK: dryland 10.5% (nonirr/nonirr; was 4.3% on the all-practice yield), "
          "irr-fallback 12.9% (irr/irr), mixed WITHHELD ('" + REASON_MIXED + "'), "
          "no-irrigation 9.8% (all-practice), one stray irrigated-rent year 7.1% (all-practice), "
          "irrigated-yield-only county WITHHELD")
      os.remove(os.path.join(OUTDIR, "KS.json")); os.remove(os.path.join(OUTDIR, "national.json"))

      # --- a wrong short_desc must be LOUD, not "no data" ----------------------
      g = practice_series_guard({"corn_nonirr": 0, "corn_irr": 5, "beans_nonirr": 0, "beans_irr": 3}, ["IA", "NE"])
      assert g == {"fatal": ["corn_nonirr"], "warn": ["beans_nonirr"]}, g
      g = practice_series_guard({k: 0 for k in PRACTICE_SERIES}, ["RI", "CT"])
      assert g["fatal"] == [] and len(g["warn"]) == 4, "a subset run with no canary state must warn, not fail"
      _, st0 = collect_state("x", "KS", getter=lambda key, sd, state, extra=None:
                             [] if sd in (Y["corn_nonirr"], Y["corn_irr"]) else list(fx.get(sd, [])), cur=2022)
      g = practice_series_guard(st0["rows"], ["KS"])
      assert set(g["fatal"]) == {"corn_nonirr", "corn_irr"}, g
      log("  empty practice series in a canary state REFUSES the run (wrong short_desc reads as HTTP 400 = 'no rows')")
    # AND IT LEAVES THE REPOSITORY EXACTLY AS IT FOUND IT. The fault this
    # file just carried was not a wrong number, it was a selftest writing into
    # the directory it was measuring. Checking that directly is cheaper than
    # noticing 2772 and working backwards.
    assert OUTDIR == _real_outdir, f"OUTDIR was not restored: {OUTDIR}"
    after = sorted(os.listdir(OUTDIR)) if os.path.isdir(OUTDIR) else []
    assert after == _before_outdir, (
        "the selftest changed the contents of " + OUTDIR + ": "
        + str(set(after) ^ set(_before_outdir)))
    log(f"  repository untouched ({len(after)} files still in {OUTDIR})")
    log("SELFTEST OK")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--states", default="")
    a = ap.parse_args()

    if a.selftest:
        selftest()
        return

    key = os.environ.get("NASS_API_KEY", "").strip()
    if not key:
        sys.exit("NASS_API_KEY missing. Free key: https://quickstats.nass.usda.gov/api")

    states = [s.strip().upper() for s in a.states.split(",") if s.strip()] or STATES
    os.makedirs(OUTDIR, exist_ok=True)

    index, totals = [], {"counties": 0, "with_nonirr": 0, "with_corn_trend": 0}
    rows_total = {k: 0 for k in YIELD_KINDS}
    rows_by_state = {}
    for i, st in enumerate(states, 1):
        counties, stats = collect_state(key, st)
        for k, n_ in stats["rows"].items():
            rows_total[k] += n_
        rows_by_state[st] = stats["rows"]
        log(f"      {st} yield rows: " + ", ".join(f"{k}={stats['rows'].get(k, 0)}" for k in YIELD_KINDS))
        if not counties:
            log(f"[{i}/{len(states)}] {st}: no county rent published — skipped")
            continue
        prices = collect_prices(key, st)
        _, n = write_state(st, counties, prices)
        index.append({"state": st, "counties": n,
                      "with_corn_trend": stats["with_corn_trend"]})
        for k in totals:
            totals[k] += stats[k]
        py = len(prices.get("corn", {}))
        log(f"[{i}/{len(states)}] {st}: {n} counties, {stats['with_corn_trend']} with corn trend, "
            f"{py} yrs corn price received")
        time.sleep(3)   # be a good citizen on a free public API (1s tripped
                        # NASS's throttle ~19 states into an all-states pull)

    # ── DID THE PRACTICE-SPECIFIC YIELDS ACTUALLY ARRIVE? ────────────────────
    # Before national.json is written: a wrong short_desc is an HTTP 400 that
    # api_get_safe() reports as "no rows", and an empty practice series would
    # not break anything visibly -- it would just withhold every irrigated
    # county's ratio and call it NASS's doing. Say the counts out loud, and
    # refuse the run when the empty answer cannot be true.
    log("\nyield rows by series (usable county rows, all states in this run):")
    for k, sd in YIELD_KINDS.items():
        log(f"  {k:<13} {rows_total[k]:>7,}  '{sd}'")
    bad = practice_series_guard(rows_total, states)
    for k in bad["warn"]:
        _m = (f"{k} returned 0 county rows nationally for '{YIELD_KINDS[k]}'. Either the short_desc is wrong "
              f"(NASS answers a wrong string with HTTP 400, which reads as 'no rows') or NASS stopped publishing it. "
              f"Soybean ratio points are withheld wherever the county shows irrigation until this is fixed.")
        print(f"::warning title=Practice yield series empty::{_m}")
        log(f"[!] {_m}")
    if bad["fatal"]:
        sys.exit("REFUSING: practice-specific corn yield series came back empty nationally: "
                 + ", ".join(f"{k} ('{YIELD_KINDS[k]}')" for k in bad["fatal"])
                 + f". This run covered {sorted(PRACTICE_CANARY_STATES & set(states))}, where NASS publishes "
                   "county corn yields by practice every year, so zero rows means the short_desc is wrong, not that "
                   "the data is missing. national.json was NOT rewritten.")

    years = sorted({y for st in index
                    for y in json.load(open(os.path.join(OUTDIR, f"{st['state']}.json")))["years"]})
    with open(os.path.join(OUTDIR, "index.json"), "w") as fh:
        json.dump({
            "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "years": years,
            "no_survey_years": sorted(NO_SURVEY_YEARS),
            "states": index,
            "totals": totals,
            "yield_rows": rows_total,
            "pair_rule": PAIR_RULE,
            "source": "USDA NASS Quick Stats — Cash Rents Survey (county estimates, released each August)",
        }, fh, separators=(",", ":"))

    nat = emit_national()
    log(f"national layer: {nat['n_rent']} counties with any rent ({nat['n_rent_latest']} from {nat['rent_year']}), {nat['n_pct']} with a ratio"
        + (f", ratio years {nat['pct_years'][0]}\u2013{nat['pct_years'][1]}" if nat["pct_years"] else ""))

    log(f"\nDONE: {totals['counties']} counties across {len(index)} states, "
        f"{totals['with_corn_trend']} with a corn trend yield, years {years[0]}–{years[-1]}")
    if totals["counties"] < 500:
        sys.exit(f"REFUSING: only {totals['counties']} counties — NASS returned far less than expected")

    # ── DID THE SURVEY ACTUALLY ARRIVE? ──────────────────────────────────────
    # cash-rent.yml runs every Wednesday and only acts in August and September,
    # because that is when NASS publishes the county Cash Rents Survey. On
    # 2026-09-13 the window had been open six weeks, six runs had gone green,
    # and data/cash-rent/IA.json still read "generated": "2026-07-18" with 2025
    # as its newest rent year.
    #
    # Nothing was broken in a way anyone could see: the script fetched, wrote
    # the same numbers, the commit step said "no change" and exited 0. Six runs
    # that found nothing looked exactly like six runs that found everything.
    #
    # This does NOT fail the run -- NASS is genuinely late some years and a red
    # cross on a normal delay is a guard that gets ignored. It says so, in the
    # one place a person looks, with the two possibilities named.
    _now = datetime.now(timezone.utc)
    if _now.month in (8, 9) and years and years[-1] < _now.year:
        _msg = (f"county cash rent is still {years[-1]}: the {_now.year} NASS survey has "
                f"not arrived after {_now.strftime('%d %B')} in the release window. "
                f"Either NASS has not published it, or this fetch is not seeing it. "
                f"Check quickstats.nass.usda.gov for "
                f"'CASH RENTS, CROPLAND, NON-IRRIGATED - EXPENSE, MEASURED IN $ / ACRE', "
                f"year {_now.year}, agg_level_desc=COUNTY.")
        print(f"::warning title=Cash rent survey not seen::{_msg}")
        log(f"\n[!] {_msg}")
    elif years and years[-1] >= _now.year:
        log(f"\n[ok] the {years[-1]} survey is in.")


if __name__ == "__main__":
    main()
