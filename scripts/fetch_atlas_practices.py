#!/usr/bin/env python3
"""
fetch_atlas_practices.py — what the ground has had done to it, by county
-> data/atlas/raw/practices.json

ONE SOURCE
  USDA Census of Agriculture, 2017 and 2022, county level, via NASS Quick Stats,
  domain TOTAL. Two pulls per state and census year, by commodity:
    AG LAND     land drained by tile, land drained by ditches, cropland acres
    PRACTICES   no-till acres, other conservation tillage acres, cover crop
                acres (excluding CRP)
  Tile drainage is the item no farmland product shows for a county (roadmap,
  2026-09-15, "what none of them show", item 3). The census has asked it of
  every farm since 2012.

HOW ITEMS ARE PICKED
  Each commodity pull returns every AG LAND or PRACTICES item for the county.
  An item is kept when its short_desc matches one pattern below, so a small
  wording change at NASS does not silently zero a layer. If a pattern matches
  two different short_descs in one pull, the run stops and prints both. If the
  Corn Belt comes back with no tile rows at all, the run prints every
  short_desc it saw that mentions drain, till or cover, and exits without
  writing: the first run against a changed layout is a probe, not a publish.

WHAT AN ABSENT ROW MEANS
  The census prints a county row only for items some farm reported. If the
  pull carries explicit zeros for an item anywhere, absence is NOT zero and
  the county is recorded as not published; if it never does, absence is how
  the census says none, and the county is recorded as none reported. Decided
  from the data per item and year, the same rule fetch_atlas_water.py uses
  for irrigated acres.

USAGE
  python scripts/fetch_atlas_practices.py --selftest
  python scripts/fetch_atlas_practices.py            # needs NASS_API_KEY
"""

import json
import os
import re
import sys
import time
from datetime import datetime, timezone

from build_farmland_atlas import ATLAS_STATES, ATLAS_STATE_FIPS
from fetch_atlas_water import nass_get, parse_value, fips_of, log

OUT = "data/atlas/raw/practices.json"
YEARS = ("2017", "2022")
COMMODITIES = ("AG LAND", "PRACTICES")
# key -> pattern on short_desc. Anchored on "- ACRES" so the "- NUMBER OF
# OPERATIONS" twin of each item never matches.
ITEMS = {
    "cropland": re.compile(r"^AG LAND, CROPLAND - ACRES$"),
    "tile": re.compile(r"^(AG LAND|PRACTICES), .*DRAINED BY TILE - ACRES$"),
    "ditch": re.compile(r"^(AG LAND|PRACTICES), .*DRAINED BY DITCHES - ACRES$"),
    "notill": re.compile(r"^PRACTICES, .*NO-TILL - ACRES$"),
    "reduced": re.compile(r"^PRACTICES, .*CONSERVATION TILLAGE, \(EXCL NO-TILL\) - ACRES$"),
    "cover": re.compile(r"^PRACTICES, .*COVER CROP PLANTED.* - ACRES$"),
}
PROBE_STATES = ("19", "17", "18", "39", "27")      # IA IL IN OH MN: tile country


class Ambiguous(Exception):
    pass


def item_of(short):
    hits = [k for k, p in ITEMS.items() if p.match(short or "")]
    return hits[0] if len(hits) == 1 else None


def rows_to_counties(rows_by_year):
    """rows_by_year: {"2022": [nass rows], ...} -> ({fips: {name, y: {year: {item: value|None}}}}, seen_shorts)
    A key present with None = published as suppressed. A key absent = no row."""
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
            # (Z) is "less than half an acre", not a suppression
            rec["y"].setdefault(year, {})[k] = 0.0 if raw.upper() == "(Z)" else parse_value(raw)
    return out, seen


def absence_is_zero(rows_by_year):
    """{(year, item): True} when the pull never prints an explicit zero for that item."""
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
    """A whole-commodity pull that comes back empty is a failed pull (nass_get
    turns an HTTP 400 into []), never a state where nothing was reported: it is
    named in `failed` and the builder will not read absence as none there."""
    rows_by_year = {y: [] for y in years}
    for st in states:
        for y in years:
            for com in COMMODITIES:
                try:
                    rows = nass_get(key, {"source_desc": "CENSUS", "year": y, "agg_level_desc": "COUNTY",
                                          "domain_desc": "TOTAL", "state_alpha": st, "commodity_desc": com})
                except Exception as e:     # a 413, a 5xx, a timeout: this pull failed, the other 203 still count
                    log(f"  census {y} {st} {com}: FAILED ({type(e).__name__}: {str(e)[:120]})")
                    rows = []
                kept = [r for r in rows if item_of((r.get("short_desc") or "").strip())]
                log(f"  census {y} {st} {com}: {len(rows)} rows, {len(kept)} kept")
                if not rows and failed is not None:
                    failed.append(f"{st} {y} {com}")
                rows_by_year[y].extend(rows)
                time.sleep(0.5)
    return rows_by_year


def probe_or_die(counties, rows_by_year):
    n = sum(1 for f, c in counties.items() if f[:2] in PROBE_STATES and (c["y"].get("2022") or {}).get("tile") is not None)
    if n:
        return n
    seen = sorted({(r.get("short_desc") or "") for rows in rows_by_year.values() for r in rows
                   if re.search(r"DRAIN|TILL|COVER", r.get("short_desc") or "")})
    log("PROBE: no 2022 tile rows for IA/IL/IN/OH/MN. Items seen that mention drain, till or cover:")
    for s in seen[:60]:
        log("   ", s)
    sys.exit("no tile rows for the Corn Belt: the item pattern is wrong or NASS is down; refusing to write")


def selftest():
    rows = {"2022": [
        {"state_fips_code": "19", "county_ansi": "169", "county_name": "STORY", "short_desc": "AG LAND, CROPLAND - ACRES", "Value": "300,000"},
        {"state_fips_code": "19", "county_ansi": "169", "county_name": "STORY", "short_desc": "AG LAND, DRAINED BY TILE - ACRES", "Value": "180,000"},
        {"state_fips_code": "19", "county_ansi": "169", "county_name": "STORY", "short_desc": "AG LAND, DRAINED BY TILE - NUMBER OF OPERATIONS", "Value": "400"},
        {"state_fips_code": "19", "county_ansi": "169", "county_name": "STORY", "short_desc": "PRACTICES, LAND USE, CROPLAND, CONSERVATION TILLAGE, NO-TILL - ACRES", "Value": "(D)"},
        {"state_fips_code": "19", "county_ansi": "169", "county_name": "STORY", "short_desc": "PRACTICES, LAND USE, CROPLAND, COVER CROP PLANTED, (EXCL CRP) - ACRES", "Value": "12,000"},
        {"state_fips_code": "19", "county_ansi": "001", "county_name": "ADAIR", "short_desc": "AG LAND, CROPLAND - ACRES", "Value": "200,000"},
        {"state_fips_code": "72", "county_ansi": "001", "county_name": "ADJUNTAS", "short_desc": "AG LAND, CROPLAND - ACRES", "Value": "1"},
        {"state_fips_code": "19", "county_ansi": "", "county_name": "OTHER", "short_desc": "AG LAND, CROPLAND - ACRES", "Value": "1"}],
        "2017": [{"state_fips_code": "19", "county_ansi": "169", "county_name": "STORY", "short_desc": "AG LAND, DRAINED BY TILE - ACRES", "Value": "150,000"}]}
    c, seen = rows_to_counties(rows)
    assert set(c) == {"19169", "19001"}, c
    s = c["19169"]["y"]
    assert s["2022"] == {"cropland": 300000.0, "tile": 180000.0, "notill": None, "cover": 12000.0}, s
    assert s["2017"] == {"tile": 150000.0}
    assert "tile" not in c["19001"]["y"]["2022"], "no row is not a zero"
    assert item_of("AG LAND, DRAINED BY TILE - NUMBER OF OPERATIONS") is None
    assert item_of("AG LAND, CROPLAND, HARVESTED - ACRES") is None
    assert item_of("PRACTICES, LAND USE, CROPLAND, CONSERVATION TILLAGE, (EXCL NO-TILL) - ACRES") == "reduced"
    assert item_of("PRACTICES, LAND USE, DRAINED BY TILE - ACRES") == "tile"
    zc, _ = rows_to_counties({"2022": [{"state_fips_code": "19", "county_ansi": "7", "county_name": "X", "short_desc": "AG LAND, DRAINED BY TILE - ACRES", "Value": "(Z)"}]})
    assert zc["19007"]["y"]["2022"]["tile"] == 0.0
    z = absence_is_zero(rows)
    assert z[("2022", "tile")] is True
    rows["2022"].append({"state_fips_code": "19", "county_ansi": "003", "county_name": "ADAMS", "short_desc": "AG LAND, DRAINED BY TILE - ACRES", "Value": "0"})
    assert absence_is_zero(rows)[("2022", "tile")] is False
    try:
        rows_to_counties({"2022": [{"short_desc": "AG LAND, DRAINED BY TILE - ACRES", "Value": "1", "state_fips_code": "19", "county_ansi": "1"},
                                   {"short_desc": "AG LAND, CROPLAND, DRAINED BY TILE - ACRES", "Value": "1", "state_fips_code": "19", "county_ansi": "1"}]})
        raise AssertionError("two short_descs on one item must stop the run")
    except Ambiguous:
        pass
    log("selftest ok")


def main():
    if "--selftest" in sys.argv:
        selftest()
        return
    key = os.environ.get("NASS_API_KEY", "").strip()
    if not key:
        sys.exit("NASS_API_KEY missing. Free key: https://quickstats.nass.usda.gov/api")
    log("Census of Agriculture: tile and ditch drainage, no-till, cover crops, cropland")
    failed = []
    rows_by_year = fetch(key, failed=failed)
    if failed:
        log(f"  {len(failed)} pull(s) came back empty and count as failed: {', '.join(failed)}")
    counties, seen = rows_to_counties(rows_by_year)
    for (y, k), short in sorted(seen.items()):
        log(f"  {y} {k}: {short}")
    n = probe_or_die(counties, rows_by_year)
    zero = absence_is_zero(rows_by_year)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"source": "USDA Census of Agriculture 2017 and 2022, county level (NASS Quick Stats): land drained by tile and by ditches, "
                             "cropland, no-till and other conservation tillage, cover crops excluding CRP",
                   "years": list(YEARS),
                   "items": {f"{y} {k}": s for (y, k), s in sorted(seen.items())},
                   # which pull each item came from: the builder's failed-pull guard looks it up here
                   "item_commodity": {f"{y} {k}": s.split(",")[0] for (y, k), s in sorted(seen.items())},
                   "absent_means_none": {f"{y} {k}": v for (y, k), v in sorted(zero.items())},
                   "failed_pulls": failed,
                   "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                   "counties": counties}, f, separators=(",", ":"))
    os.replace(tmp, OUT)      # a killed write never leaves half a file for the builder
    log(f"wrote {OUT}: {len(counties)} counties, {n} Corn Belt counties with 2022 tile acres")


if __name__ == "__main__":
    main()
