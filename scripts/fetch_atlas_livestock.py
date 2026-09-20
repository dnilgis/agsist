#!/usr/bin/env python3
"""
fetch_atlas_livestock.py — cattle, hogs and permanent pasture by county
-> data/atlas/raw/livestock.json

ONE SOURCE
  USDA Census of Agriculture, 2017 and 2022, county level, via NASS Quick
  Stats, domain TOTAL. Per state and census year, three commodity pulls:
    CATTLE    all cattle and calves; beef cows; milk cows; cattle on feed;
              operations with cattle
    HOGS      hogs and pigs
    AG LAND   permanent pasture and rangeland (not cropland, not woodland)
  Same item-picking rules as fetch_atlas_practices.py: an item is kept when
  its short_desc matches one pattern below; two different short_descs on one
  item stop the run; no cattle rows for the cattle states stops the run and
  prints what NASS did send. The first run against a changed layout is a
  probe, not a publish.

WHAT AN ABSENT ROW MEANS
  Decided from the data per item and year, as in fetch_atlas_practices.py:
  when the pull never prints an explicit zero for an item, a county with no
  row had no farm reporting it; otherwise absence is "not published".
  (D) is suppressed to protect a single operation and stays suppressed.

USAGE
  python scripts/fetch_atlas_livestock.py --selftest
  python scripts/fetch_atlas_livestock.py            # needs NASS_API_KEY
"""

import json
import os
import re
import sys
import time
from datetime import datetime, timezone

from build_farmland_atlas import ATLAS_STATES, ATLAS_STATE_FIPS
from fetch_atlas_water import nass_get, parse_value, fips_of, log

OUT = "data/atlas/raw/livestock.json"
YEARS = ("2017", "2022")
COMMODITIES = ("CATTLE", "HOGS", "AG LAND")
ITEMS = {
    "cattle": re.compile(r"^CATTLE, INCL CALVES - INVENTORY$"),
    "cattle_ops": re.compile(r"^CATTLE, INCL CALVES - OPERATIONS WITH INVENTORY$"),
    "beef_cows": re.compile(r"^CATTLE, COWS, BEEF - INVENTORY$"),
    "milk_cows": re.compile(r"^CATTLE, COWS, MILK - INVENTORY$"),
    "on_feed": re.compile(r"^CATTLE, ON FEED - INVENTORY$"),
    "hogs": re.compile(r"^HOGS - INVENTORY$"),
    "pasture": re.compile(r"^AG LAND, PASTURELAND, \(EXCL CROPLAND & WOODLAND\) - ACRES$"),
}
PROBE_STATES = ("48", "31", "19", "20", "40")      # TX NE IA KS OK
UNMATCHED = {}


class Ambiguous(Exception):
    pass


def item_of(short):
    hits = [k for k, p in ITEMS.items() if p.match(short or "")]
    return hits[0] if len(hits) == 1 else None


def rows_to_counties(rows_by_year):
    out, seen = {}, {}
    for year, rows in rows_by_year.items():
        for r in rows:
            short = (r.get("short_desc") or "").strip()
            k = item_of(short)
            if not k:
                continue
            prev = seen.setdefault((year, k), short)
            if prev != short:
                raise Ambiguous(f"{year} {k}: two items match -- {prev!r} and {short!r}")
            f = fips_of(r)
            if not f or f[:2] not in ATLAS_STATE_FIPS:
                continue
            rec = out.setdefault(f, {"name": (r.get("county_name") or "").title(), "y": {}})
            raw = str(r.get("Value") or "").strip()
            rec["y"].setdefault(year, {})[k] = 0.0 if raw.upper() == "(Z)" else parse_value(raw)
    return out, seen


def absence_is_zero(rows_by_year):
    zeros = {}
    for year, rows in rows_by_year.items():
        for r in rows:
            k = item_of((r.get("short_desc") or "").strip())
            if not k:
                continue
            v = str(r.get("Value") or "").strip().replace(",", "")
            zeros[(year, k)] = zeros.get((year, k), 0) + (1 if v in ("0", "-", "0.0") else 0)
    return {yk: n == 0 for yk, n in zeros.items()}


def fetch(key, states=ATLAS_STATES, years=YEARS, failed=None):
    rows_by_year = {y: [] for y in years}
    for st in states:
        for y in years:
            for com in COMMODITIES:
                try:
                    rows = nass_get(key, {"source_desc": "CENSUS", "year": y, "agg_level_desc": "COUNTY",
                                          "domain_desc": "TOTAL", "state_alpha": st, "commodity_desc": com})
                except Exception as e:
                    log(f"  census {y} {st} {com}: FAILED ({type(e).__name__}: {str(e)[:120]})")
                    rows = []
                kept = [r for r in rows if item_of((r.get("short_desc") or "").strip())]
                for r in rows:          # what NASS sent, for the probe when a pattern stops matching
                    sd = (r.get("short_desc") or "").strip()
                    if not item_of(sd) and len(UNMATCHED.setdefault(com, set())) < 60 and re.search(r"INVENTORY|PASTURE", sd):
                        UNMATCHED[com].add(sd)
                log(f"  census {y} {st} {com}: {len(rows)} rows, {len(kept)} kept")
                if not rows and failed is not None:
                    failed.append(f"{st} {y} {com}")
                rows_by_year[y].extend(kept)      # only kept rows are held: AG LAND pulls are large
                time.sleep(0.5)
    return rows_by_year


def probe_or_die(counties, seen_all):
    n = sum(1 for f, c in counties.items() if f[:2] in PROBE_STATES and (c["y"].get("2022") or {}).get("cattle") is not None)
    if n:
        return n
    log("PROBE: no 2022 cattle inventory for TX/NE/IA/KS/OK. Items matched:")
    for s in sorted(seen_all)[:80]:
        log("   ", s)
    log("Inventory and pasture items NASS sent that no pattern matched:")
    for com, ss in sorted(UNMATCHED.items()):
        for s in sorted(ss):
            log(f"    {com}: {s}")
    sys.exit("no cattle rows for the cattle states: the item pattern is wrong or NASS is down; refusing to write")


def selftest():
    rows = {"2022": [
        {"state_fips_code": "31", "county_ansi": "029", "county_name": "CHASE", "short_desc": "CATTLE, INCL CALVES - INVENTORY", "Value": "61,234"},
        {"state_fips_code": "31", "county_ansi": "029", "county_name": "CHASE", "short_desc": "CATTLE, COWS, BEEF - INVENTORY", "Value": "9,000"},
        {"state_fips_code": "31", "county_ansi": "029", "county_name": "CHASE", "short_desc": "CATTLE, COWS, MILK - INVENTORY", "Value": "(D)"},
        {"state_fips_code": "31", "county_ansi": "029", "county_name": "CHASE", "short_desc": "CATTLE, INCL CALVES - SALES, MEASURED IN HEAD", "Value": "99"},
        {"state_fips_code": "31", "county_ansi": "029", "county_name": "CHASE", "short_desc": "AG LAND, PASTURELAND, (EXCL CROPLAND & WOODLAND) - ACRES", "Value": "200,000"},
        {"state_fips_code": "31", "county_ansi": "029", "county_name": "CHASE", "short_desc": "AG LAND, PASTURELAND - ACRES", "Value": "210,000"},
        {"state_fips_code": "31", "county_ansi": "029", "county_name": "CHASE", "short_desc": "HOGS - INVENTORY", "Value": "(Z)"}],
        "2017": [{"state_fips_code": "31", "county_ansi": "029", "county_name": "CHASE", "short_desc": "CATTLE, INCL CALVES - INVENTORY", "Value": "55,000"}]}
    c, seen = rows_to_counties(rows)
    y = c["31029"]["y"]
    assert y["2022"] == {"cattle": 61234.0, "beef_cows": 9000.0, "milk_cows": None, "pasture": 200000.0, "hogs": 0.0}, y
    assert y["2017"] == {"cattle": 55000.0}
    assert item_of("CATTLE, INCL CALVES - SALES, MEASURED IN HEAD") is None
    assert absence_is_zero(rows)[("2022", "cattle")] is True
    try:
        rows_to_counties({"2022": [{"short_desc": "HOGS - INVENTORY", "Value": "1", "state_fips_code": "19", "county_ansi": "1"}],
                          "2017": []} | {"2022": [{"short_desc": "HOGS - INVENTORY", "Value": "1", "state_fips_code": "19", "county_ansi": "1"},
                                                  {"short_desc": "HOGS - INVENTORY ", "Value": "1", "state_fips_code": "19", "county_ansi": "1"}]})
    except Ambiguous:
        raise AssertionError("trailing space is stripped: the same item, not two")
    log("selftest ok")


def main():
    if "--selftest" in sys.argv:
        selftest()
        return
    key = os.environ.get("NASS_API_KEY", "").strip()
    if not key:
        sys.exit("NASS_API_KEY missing. Free key: https://quickstats.nass.usda.gov/api")
    log("Census of Agriculture: cattle, beef and milk cows, cattle on feed, hogs, permanent pasture")
    failed = []
    rows_by_year = fetch(key, failed=failed)
    if failed:
        log(f"  {len(failed)} pull(s) came back empty and count as failed: {', '.join(failed)}")
    counties, seen = rows_to_counties(rows_by_year)
    for (y, k), short in sorted(seen.items()):
        log(f"  {y} {k}: {short}")
    missing = [f"{y} {k}" for y in YEARS for k in ITEMS if (y, k) not in seen]
    if missing:
        log(f"  NOT MATCHED ANYWHERE (the page will say so, not 'not published'): {', '.join(missing)}")
        for com, ss in sorted(UNMATCHED.items()):
            log(f"    {com} sent, unmatched: {'; '.join(sorted(ss)[:15])}")
    n = probe_or_die(counties, {s for (_, _), s in seen.items()})
    zero = absence_is_zero(rows_by_year)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"source": "USDA Census of Agriculture 2017 and 2022, county level (NASS Quick Stats): cattle and calves, beef cows, "
                             "milk cows, cattle on feed, hogs and pigs, permanent pasture and rangeland",
                   "years": list(YEARS),
                   "items": {f"{y} {k}": s for (y, k), s in sorted(seen.items())},
                   "absent_means_none": {f"{y} {k}": v for (y, k), v in sorted(zero.items())},
                   "failed_pulls": failed,
                   "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                   "counties": counties}, f, separators=(",", ":"))
    os.replace(tmp, OUT)
    log(f"wrote {OUT}: {len(counties)} counties, {n} cattle-state counties with 2022 cattle")


if __name__ == "__main__":
    main()
