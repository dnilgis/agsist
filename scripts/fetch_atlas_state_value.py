#!/usr/bin/env python3
"""
fetch_atlas_state_value.py -- the newest public land value, by state
-> data/atlas/state-value.json

WHY. The county land value on every Atlas page is the 2022 Census of
Agriculture (operators' estimate of land and buildings). It is the only
county figure on one method for every state, but by 2026 it is four years old.
NASS publishes a newer number every summer for each state in the Land Values
Summary (from its June survey of farm operators): cropland, pasture and farm
real estate (land and buildings), dollars per acre. It is one number per state
and it is not a county figure, so the page prints it beside the census value
as the state's, never as the county's.

ONE SOURCE
  USDA NASS Quick Stats, SURVEY, STATE level, annual:
    AG LAND, CROPLAND - ASSET VALUE, MEASURED IN $ / ACRE
    AG LAND, PASTURELAND - ASSET VALUE, MEASURED IN $ / ACRE
    AG LAND, INCL BUILDINGS - ASSET VALUE, MEASURED IN $ / ACRE   (farm real estate)
  Prior years come back revised; the builder uses what Quick Stats serves now.
  States NASS groups into a region (New England, some years) have no state
  row and get no line on the page. Nothing is filled in.

USAGE
  python scripts/fetch_atlas_state_value.py --selftest
  python scripts/fetch_atlas_state_value.py            # needs NASS_API_KEY
"""

import json
import os
import sys
import time
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_atlas_water import nass_get, parse_value, log  # noqa: E402

OUT = "data/atlas/state-value.json"
ITEMS = {
    "cropland": "AG LAND, CROPLAND - ASSET VALUE, MEASURED IN $ / ACRE",
    "pasture": "AG LAND, PASTURELAND - ASSET VALUE, MEASURED IN $ / ACRE",
    "real_estate": "AG LAND, INCL BUILDINGS - ASSET VALUE, MEASURED IN $ / ACRE",
}
FIRST_YEAR = 2017   # far enough back to cover the 2022 census year with room


def rows_to_states(rows_by_item):
    """{item: [Quick Stats rows]} -> {ST: {item: {"YYYY": value}}}.
    Only state rows for the whole year (reference period YEAR) count; a
    suppressed or blank value is left out, never zeroed. Where Quick Stats
    serves two rows for one state and year, the later load wins (a revision)."""
    out, loaded = {}, {}
    for item, rows in rows_by_item.items():
        for r in rows:
            if (r.get("agg_level_desc") or "STATE") != "STATE":
                continue
            if (r.get("reference_period_desc") or "YEAR") != "YEAR":
                continue
            st = (r.get("state_alpha") or "").strip()
            y = str(r.get("year") or "").strip()
            if len(st) != 2 or not y.isdigit() or st == "US":
                continue
            v = parse_value(r.get("Value"))
            if v is None:
                continue
            k = (st, item, y)
            lt = r.get("load_time") or ""
            if k in loaded and loaded[k] > lt:
                continue
            loaded[k] = lt
            out.setdefault(st, {}).setdefault(item, {})[y] = v
    return out


def fetch(key):
    rows_by_item = {}
    for item, short in ITEMS.items():
        rows = nass_get(key, {"source_desc": "SURVEY", "agg_level_desc": "STATE", "domain_desc": "TOTAL",
                              "freq_desc": "ANNUAL", "short_desc": short, "year__GE": str(FIRST_YEAR)})
        log(f"  survey {item}: {len(rows)} rows")
        rows_by_item[item] = rows
        time.sleep(0.5)
    return rows_by_item


def selftest():
    rows = {"cropland": [
        {"state_alpha": "IA", "year": 2026, "Value": "10,700", "agg_level_desc": "STATE", "reference_period_desc": "YEAR", "load_time": "2026-07-31 15:00:00"},
        {"state_alpha": "IA", "year": 2025, "Value": "10,300", "agg_level_desc": "STATE", "reference_period_desc": "YEAR", "load_time": "2025-08-01 15:00:00"},
        # the 2025 figure revised in the 2026 release: the later load wins
        {"state_alpha": "IA", "year": 2025, "Value": "10,400", "agg_level_desc": "STATE", "reference_period_desc": "YEAR", "load_time": "2026-07-31 15:00:00"},
        {"state_alpha": "RI", "year": 2026, "Value": "(NA)", "agg_level_desc": "STATE", "reference_period_desc": "YEAR"},
        {"state_alpha": "US", "year": 2026, "Value": "6,020", "agg_level_desc": "NATIONAL", "reference_period_desc": "YEAR"},
        {"state_alpha": "IL", "year": 2026, "Value": "9,999", "agg_level_desc": "STATE", "reference_period_desc": "FIRST OF JAN"},
    ], "pasture": [], "real_estate": [
        {"state_alpha": "IA", "year": 2026, "Value": "10,100", "agg_level_desc": "STATE", "reference_period_desc": "YEAR"}]}
    s = rows_to_states(rows)
    assert s == {"IA": {"cropland": {"2026": 10700.0, "2025": 10400.0}, "real_estate": {"2026": 10100.0}}}, s
    log("selftest ok")


def main():
    if "--selftest" in sys.argv:
        selftest()
        return
    key = os.environ.get("NASS_API_KEY", "").strip()
    if not key:
        sys.exit("NASS_API_KEY missing. Free key: https://quickstats.nass.usda.gov/api")
    log("NASS Land Values, state level")
    states = rows_to_states(fetch(key))
    # A wrong short_desc comes back as HTTP 400, which reads as "no rows". Iowa
    # cropland is published every year; none since 2022 means the string is
    # wrong or NASS is down, and the old file stays.
    ia = (states.get("IA") or {}).get("cropland") or {}
    if not any(int(y) >= 2023 for y in ia):
        sys.exit("no recent Iowa cropland value: the survey short_desc is wrong or NASS is down; refusing to write")
    latest = max(int(y) for st in states.values() for it in st.values() for y in it)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"source": "USDA NASS Land Values, state level (NASS Quick Stats, SURVEY)",
                   "items": ITEMS,
                   "latest_year": latest,
                   "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                   "states": states}, f, separators=(",", ":"), sort_keys=True)
    log(f"wrote {OUT}: {len(states)} states, newest year {latest}")


if __name__ == "__main__":
    main()
