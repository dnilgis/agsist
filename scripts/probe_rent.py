#!/usr/bin/env python3
"""
probe_rent.py — settle two open questions with data instead of guesses.

Q1  What IS the pasture cash-rent short_desc?
    My guess ('RENT, CASH, PASTURE - EXPENSE, MEASURED IN $ / ACRE') returns
    HTTP 400. Rather than guess a second string, ask NASS to ENUMERATE every
    short_desc it publishes under commodity_desc=RENT. The answer is then a
    fact, not a hypothesis.

Q2  Does county cash rent for 2015 actually exist?
    fetch_cash_rent.py currently deletes 2015 unconditionally, on the strength
    of a secondary article claiming no survey was run that year. If that is
    wrong, the pipeline is destroying real published data. Count the rows.

Q3  Does filtering reference_period_desc='YEAR' collapse the state yield series
    to exactly one row per state-year? (The probe showed AUG/SEP/NOV FORECAST
    rows sharing the same year — unfiltered, a forecast can overwrite a final.)

Writes nothing. Prints answers.
"""

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict

NASS = "https://quickstats.nass.usda.gov/api/api_GET/"
UA = {"User-Agent": "AGSIST-probe/1.0 (+https://agsist.com; sig@farmers1st.com)"}


def out(*a):
    print(*a, flush=True)


def call(key, params, timeout=240):
    q = {"key": key, "format": "JSON"}
    q.update(params)
    url = NASS + "?" + urllib.parse.urlencode(q)
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8", "replace")).get("data", [])
    except urllib.error.HTTPError as e:
        body = e.read()[:160].decode("utf-8", "replace").replace("\n", " ")
        out(f"    HTTP {e.code}: {body}")
        return None
    except Exception as e:
        out(f"    {type(e).__name__}: {e}")
        return None


def q1_enumerate_rent(key):
    out("\n" + "=" * 78)
    out("  Q1 — every short_desc NASS publishes under commodity_desc=RENT")
    out("=" * 78)
    for agg in ("COUNTY", "STATE"):
        out(f"\n  agg_level_desc={agg}, year=2024:")
        rows = call(key, {"commodity_desc": "RENT", "agg_level_desc": agg, "year": "2024"})
        if rows is None:
            out("    (request failed)")
            continue
        c = Counter(r.get("short_desc") for r in rows)
        if not c:
            out("    0 rows")
            continue
        for sd, n in sorted(c.items()):
            mark = ""
            if "PASTURE" in sd.upper():
                mark = "   <-- PASTURE: use this exact string"
            out(f"    {n:>7} rows  {sd!r}{mark}")


def q2_2015(key):
    out("\n" + "=" * 78)
    out("  Q2 — does county cash rent exist for 2015?")
    out("=" * 78)
    sd = "RENT, CASH, CROPLAND, NON-IRRIGATED - EXPENSE, MEASURED IN $ / ACRE"
    for yr in ("2013", "2014", "2015", "2016", "2017"):
        rows = call(key, {"short_desc": sd, "agg_level_desc": "COUNTY", "year": yr})
        n = 0 if rows is None else len(rows)
        flag = ""
        if yr == "2015":
            flag = ("   <-- CONFIRMED: no survey. Deleting 2015 is correct."
                    if n == 0 else
                    "   <-- 2015 EXISTS. fetch_cash_rent.py is DESTROYING REAL DATA. Remove the filter.")
        out(f"    {yr}: {n:>6} counties{flag}")


def q3_forecast_filter(key):
    out("\n" + "=" * 78)
    out("  Q3 — does reference_period_desc='YEAR' give exactly 1 row per state-year?")
    out("=" * 78)
    sd = "CORN, GRAIN - YIELD, MEASURED IN BU / ACRE"
    for label, extra in (("UNFILTERED", {}), ("ref_period=YEAR", {"reference_period_desc": "YEAR"})):
        rows = call(key, dict({"short_desc": sd, "agg_level_desc": "STATE", "year": "2023"}, **extra))
        if rows is None:
            continue
        per = defaultdict(list)
        for r in rows:
            per[r.get("state_alpha")].append(r.get("reference_period_desc"))
        dupes = {k: v for k, v in per.items() if len(v) > 1}
        out(f"\n    {label}: {len(rows)} rows, {len(per)} states, {len(dupes)} states with >1 row")
        if dupes:
            k = sorted(dupes)[0]
            out(f"      e.g. {k} -> {dupes[k]}")
            out("      ^ unfiltered, whichever row lands last wins — a FORECAST can overwrite the FINAL")
        else:
            out("      clean: exactly one row per state — safe to key by year")
    # what a forecast/final disagreement actually costs
    fin = call(key, {"short_desc": sd, "agg_level_desc": "STATE", "year": "2023",
                     "reference_period_desc": "YEAR", "state_alpha": "IA"})
    aug = call(key, {"short_desc": sd, "agg_level_desc": "STATE", "year": "2023",
                     "reference_period_desc": "YEAR - AUG FORECAST", "state_alpha": "IA"})
    if fin and aug:
        out(f"\n    IA 2023 corn: FINAL={fin[0].get('Value')} bu vs AUG FORECAST={aug[0].get('Value')} bu")
        out("      ^ this is the size of the error if the filter is missing")


def main():
    key = os.environ.get("NASS_API_KEY", "").strip()
    if not key:
        sys.exit("NASS_API_KEY missing")
    out("PROBE v2 — settling open questions. Writes nothing.")
    q1_enumerate_rent(key)
    q2_2015(key)
    q3_forecast_filter(key)
    out("\n" + "=" * 78)
    out("  DONE — paste this log back")
    out("=" * 78)


if __name__ == "__main__":
    main()
