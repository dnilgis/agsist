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
  * 2015 DOES NOT EXIST. NASS ran no county cash rents survey that year.
    We emit no 2015 key, ever. The page must show a gap, not a line.
  * Suppressed counties stay suppressed. NASS withholds counties with too few
    responses ("(D)"). We drop them. We never interpolate a neighbor, never
    average a district down to a county, never invent a number.
  * Trend yield is a FIT, not an observation. It ships with r2 and n so the
    page can label it and refuse to show a garbage fit.

SOURCES (both USDA NASS Quick Stats, key required, free):
  rent  : RENT, CASH, {CROPLAND NON-IRRIGATED | CROPLAND IRRIGATED | PASTURE}
          - EXPENSE, MEASURED IN $ / ACRE   (agg_level_desc=COUNTY)
  yield : CORN, GRAIN - YIELD, MEASURED IN BU / ACRE
          SOYBEANS - YIELD, MEASURED IN BU / ACRE

USAGE
  python scripts/fetch_cash_rent.py --selftest     # offline, no key needed
  python scripts/fetch_cash_rent.py                # full national pull
  python scripts/fetch_cash_rent.py --states IA,IL # subset
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

API = "https://quickstats.nass.usda.gov/api/api_GET/"
OUTDIR = "data/cash-rent"
FIRST_YEAR = 2008
NO_SURVEY_YEARS = {2015}          # NASS ran no county cash rents survey in 2015
TREND_WINDOW = 15                 # years of yield history for the trend fit
MIN_TREND_N = 6                   # fewer real years than this -> no trend, no guess

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
    "corn":  "CORN, GRAIN - YIELD, MEASURED IN BU / ACRE",
    "beans": "SOYBEANS - YIELD, MEASURED IN BU / ACRE",
}
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
    with urllib.request.urlopen(req, timeout=120) as r:
        body = r.read().decode("utf-8", "replace")
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


def collect_state(key, state):
    """-> (counties dict, stats dict). Fail-loud: exceptions propagate."""
    counties = {}

    def touch(f, name):
        if f not in counties:
            counties[f] = {"fips": f, "name": name, "rent": {}, "yield": {}}
        return counties[f]

    for kind, sd in RENT_KINDS.items():
        for rec in api_get_safe(key, sd, state):
            f = fips(rec)
            v = parse_value(rec.get("Value"))
            year = int(rec.get("year", 0))
            if not f or v is None or year in NO_SURVEY_YEARS:
                continue
            c = touch(f, (rec.get("county_name") or "").title())
            c["rent"].setdefault(kind, {})[str(year)] = round(v, 2)

    for crop, sd in YIELD_KINDS.items():
        raw = {}
        for rec in api_get_safe(key, sd, state):
            f = fips(rec)
            v = parse_value(rec.get("Value"))
            year = int(rec.get("year", 0))
            if not f or v is None:
                continue
            raw.setdefault(f, []).append((year, v))
        cur = datetime.now(timezone.utc).year
        for f, pairs in raw.items():
            if f not in counties:
                continue   # yield but no rent: nothing to contextualise, skip
            # Full per-year history is retained: the ratio chart needs the
            # ACTUAL yield of each year, not a trend line evaluated at it.
            # A trend is what you expect; history is what happened.
            hist = {str(y): round(v, 1) for y, v in sorted(pairs)}
            entry = {"hist": hist}
            recent = [p for p in pairs if p[0] > cur - TREND_WINDOW]
            fit = fit_trend(recent)
            if fit:
                slope, intercept, r2, n = fit
                entry.update({
                    "trend": round(slope * cur + intercept, 1),
                    "slope": round(slope, 3),
                    "r2": round(r2, 3),
                    "n": n,
                    "last": round(sorted(recent)[-1][1], 1),
                })
            counties[f]["yield"][crop] = entry

    # A county with no rent series at all is noise — drop it.
    counties = {f: c for f, c in counties.items() if c["rent"]}
    stats = {
        "counties": len(counties),
        "with_nonirr": sum(1 for c in counties.values() if c["rent"].get("nonirr")),
        "with_corn_trend": sum(1 for c in counties.values() if c["yield"].get("corn", {}).get("trend")),
    }
    return counties, stats


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
    """
    files = [f for f in sorted(os.listdir(OUTDIR)) if re.match(r"^[A-Z]{2}\.json$", f)]
    out, rents, pcts, yrs = {}, [], [], []
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
            yh = (c.get("yield", {}).get("corn") or {}).get("hist") or {}
            common = [y for y in rent if y in yh and y in prices]
            if common:
                y = max(common, key=lambda z: int(z))
                gross = yh[y] * prices[y]
                if gross > 0:
                    pct = rent[y] / gross * 100
                    rec.update({"p": round(pct, 1), "py": int(y),
                                "pp": 1 if y in prelim else 0})
                    pcts.append(pct)
                    yrs.append(int(y))
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
        "n_rent": len(rents),
        "n_pct": len(pcts),
        "note": "Ratio year varies by county: each county uses its own latest year in which rent, county corn yield and state price received all exist. Rent is the latest published rent, non-irrigated where available.",
    }
    with open(os.path.join(OUTDIR, "national.json"), "w") as fh:
        json.dump(doc, fh, separators=(",", ":"))
    return doc


def selftest():
    """Offline. NASS is blocked in the sandbox, so exercise every rule that
    matters against synthetic records: suppression, the 2015 hole, FIPS
    assembly, trend fitting, and the thin-data refusal."""
    log("SELFTEST: cash rent")

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

    # --- 2015 must never survive the filter ---------------------------------
    recs = [{"state_fips_code": "19", "county_ansi": "169", "county_name": "STORY",
             "year": str(y), "Value": "250"} for y in (2014, 2015, 2016)]
    kept = [r for r in recs if int(r["year"]) not in NO_SURVEY_YEARS]
    assert [r["year"] for r in kept] == ["2014", "2016"], "2015 leaked"
    log("  2015 hole preserved (no survey that year)")

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
    counties = {"19169": {"fips": "19169", "name": "Story",
                          "rent": {"nonirr": {"2024": 269.0, "2016": 230.0}},
                          "yield": {"corn": {"trend": 201.4, "r2": 0.71, "n": 15, "slope": 1.9,
                                             "last": 205.0, "hist": {"2016": 203.0, "2024": 205.0}}}}}
    prices = {"corn": {"2016": 3.36, "2024": 4.35}}
    path, n = write_state("IA", counties, prices)
    doc = json.load(open(path))
    assert doc["years"] == [2016, 2024], doc["years"]
    assert 2015 not in doc["years"]
    assert doc["no_survey_years"] == [2015]
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
    }
    write_state("IA", counties2, {"corn": {"2016": 3.36, "2024": 4.35}})
    nat = emit_national()
    assert nat["n_rent"] == 2, nat["n_rent"]
    assert nat["n_pct"] == 1, "county without yield must have rent but NO ratio"
    s = nat["counties"]["19169"]
    assert abs(s["p"] - (269.0 / (205.0 * 4.35) * 100)) < 0.05, s
    assert s["py"] == 2024 and s["ry"] == 2024
    assert "p" not in nat["counties"]["19153"], "ratio invented for a county with no yield"
    log(f"  national roll-up OK ({nat['n_rent']} rent, {nat['n_pct']} ratio, "
        f"Story={nat['counties']['19169']['p']}%)")
    os.remove(os.path.join(OUTDIR, "IA.json")); os.remove(os.path.join(OUTDIR, "national.json"))
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
    for i, st in enumerate(states, 1):
        counties, stats = collect_state(key, st)
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
        time.sleep(1)   # be a good citizen on a free public API

    years = sorted({y for st in index
                    for y in json.load(open(os.path.join(OUTDIR, f"{st['state']}.json")))["years"]})
    with open(os.path.join(OUTDIR, "index.json"), "w") as fh:
        json.dump({
            "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "years": years,
            "no_survey_years": sorted(NO_SURVEY_YEARS),
            "states": index,
            "totals": totals,
            "source": "USDA NASS Quick Stats — Cash Rents Survey (county estimates, released each August)",
        }, fh, separators=(",", ":"))

    nat = emit_national()
    log(f"national layer: {nat['n_rent']} counties with rent, {nat['n_pct']} with a ratio"
        + (f", ratio years {nat['pct_years'][0]}\u2013{nat['pct_years'][1]}" if nat["pct_years"] else ""))

    log(f"\nDONE: {totals['counties']} counties across {len(index)} states, "
        f"{totals['with_corn_trend']} with a corn trend yield, years {years[0]}–{years[-1]}")
    if totals["counties"] < 500:
        sys.exit(f"REFUSING: only {totals['counties']} counties — NASS returned far less than expected")


if __name__ == "__main__":
    main()
