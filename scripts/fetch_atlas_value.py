#!/usr/bin/env python3
"""
fetch_atlas_value.py — what farmland is worth, by county, as the census counts it
-> data/atlas/raw/value.json

ONE SOURCE
  USDA Census of Agriculture, county level, via NASS Quick Stats:
    AG LAND, INCL BUILDINGS - ASSET VALUE, MEASURED IN $ / ACRE
  for the 2012, 2017 and 2022 censuses. This is the average estimated market
  value of land and buildings per acre, reported by the operators counted, not
  a sale price and not an appraisal. It is the only county-level land value
  published for every Atlas state on one method. Suppressed counties "(D)"
  stay suppressed; the builder prints why.

WHAT THE BUILDER DOES WITH IT
  Gross rent-to-value: the NASS county non-irrigated cropland cash rent for
  the census year over this value for the same year. Lenders call the
  net version a cap rate; this one has no tax, insurance or management taken
  off, so it is called what it is. The 2017 to 2022 change is printed as a
  compound annual rate from the two censuses.

USAGE
  python scripts/fetch_atlas_value.py --selftest
  python scripts/fetch_atlas_value.py            # needs NASS_API_KEY
"""

import json
import os
import sys
import time
from datetime import datetime, timezone

from build_farmland_atlas import ATLAS_STATES, ATLAS_STATE_FIPS
from fetch_atlas_water import nass_get, parse_value, fips_of, log

OUT = "data/atlas/raw/value.json"
SHORT = "AG LAND, INCL BUILDINGS - ASSET VALUE, MEASURED IN $ / ACRE"
YEARS = ("2012", "2017", "2022")


def rows_to_counties(rows_by_year):
    out = {}
    for year, rows in rows_by_year.items():
        for r in rows:
            f = fips_of(r)
            if not f or f[:2] not in ATLAS_STATE_FIPS:
                continue
            rec = out.setdefault(f, {"name": (r.get("county_name") or "").title(), "years": {}})
            v = parse_value(r.get("Value"))
            rec["years"][year] = v          # None = published as suppressed
    return out


def fetch(key, states=ATLAS_STATES, years=YEARS):
    rows_by_year = {y: [] for y in years}
    for st in states:
        for y in years:
            rows = nass_get(key, {"source_desc": "CENSUS", "year": y, "agg_level_desc": "COUNTY",
                                  "domain_desc": "TOTAL", "state_alpha": st, "short_desc": SHORT})
            log(f"  census {y} {st}: {len(rows)} rows")
            rows_by_year[y].extend(rows)
            time.sleep(0.5)
    return rows_by_year


def selftest():
    rows = {"2022": [{"state_fips_code": "19", "county_ansi": "169", "county_name": "STORY", "Value": "12,345"},
                     {"state_fips_code": "19", "county_ansi": "001", "county_name": "ADAIR", "Value": "(D)"},
                     # Puerto Rico 72001 Adjuntas: a real NASS census row, never an Atlas state
                     {"state_fips_code": "72", "county_ansi": "001", "county_name": "ADJUNTAS", "Value": "1"},
                     {"state_fips_code": "19", "county_ansi": "", "county_name": "OTHER", "Value": "1"}],
            "2017": [{"state_fips_code": "19", "county_ansi": "169", "county_name": "STORY", "Value": "10,000"}]}
    c = rows_to_counties(rows)
    assert set(c) == {"19169", "19001"}, c
    assert c["19169"]["years"] == {"2022": 12345.0, "2017": 10000.0} and c["19169"]["name"] == "Story"
    assert c["19001"]["years"] == {"2022": None}
    log("selftest ok")


def main():
    if "--selftest" in sys.argv:
        selftest()
        return
    key = os.environ.get("NASS_API_KEY", "").strip()
    if not key:
        sys.exit("NASS_API_KEY missing. Free key: https://quickstats.nass.usda.gov/api")
    log("Census of Agriculture, land and buildings value per acre")
    rows_by_year = fetch(key)
    counties = rows_to_counties(rows_by_year)
    # A wrong short_desc string comes back as HTTP 400, which reads as "no rows".
    # Iowa has a value for nearly every county in every census; if 2022 has
    # none the string is wrong or NASS is down.
    n_ia = sum(1 for f, c in counties.items() if f[:2] == "19" and c["years"].get("2022") is not None)
    if n_ia == 0:
        sys.exit("no 2022 value rows for Iowa: the census short_desc is wrong or NASS is down; refusing to write")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"source": "USDA Census of Agriculture 2012, 2017, 2022, county level (NASS Quick Stats): " + SHORT,
                   "years": list(YEARS),
                   "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                   "counts": {y: sum(1 for c in counties.values() if c["years"].get(y) is not None) for y in YEARS},
                   "counties": counties}, f, separators=(",", ":"))
    log(f"wrote {OUT}: {len(counties)} counties")


if __name__ == "__main__":
    main()
