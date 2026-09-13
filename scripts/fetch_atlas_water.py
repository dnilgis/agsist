#!/usr/bin/env python3
"""
fetch_atlas_water.py — how much of a county's cropland runs on irrigation, and
where that water comes from -> data/atlas/raw/water.json

TWO SOURCES, BOTH OFFICIAL, NEITHER MODELLED
  1. USDA Census of Agriculture 2022, county level, via NASS Quick Stats:
       AG LAND, CROPLAND, HARVESTED - ACRES
       AG LAND, CROPLAND, HARVESTED, IRRIGATED - ACRES
     Irrigated share = irrigated / harvested. Suppressed counties "(D)" stay
     suppressed; the builder prints why.
  2. USGS Estimated Use of Water in the United States, county-level data for
     2015 (the latest county release), the workbook usco2015v2.0.xlsx on
     ScienceBase. Columns used, by their exact header (IC = crop irrigation;
     IR would also count golf courses):
       IC-WGWFr  crop irrigation, groundwater withdrawals, fresh, Mgal/d
       IC-WSWFr  crop irrigation, surface-water withdrawals, fresh, Mgal/d
       IC-WFrTo  crop irrigation, total fresh withdrawals, Mgal/d
       IC-IrTot  crop irrigation, acres irrigated, thousands
     Groundwater share = IC-WGWFr / IC-WFrTo. USGS county irrigation figures
     are estimates built from acreage and application rates, not meter
     readings; the page says so.

  The workbook's header names are read, not assumed: if any column above is
  missing the script prints every header it found and exits non-zero. Rule 44
  in STANDING-DECISIONS: open one record and look at its keys before reading
  a field off a file you did not write.

USAGE
  python scripts/fetch_atlas_water.py --selftest
  python scripts/fetch_atlas_water.py                # needs NASS_API_KEY; downloads the USGS workbook
  python scripts/fetch_atlas_water.py --usgs path/to/usco2015v2.0.xlsx
"""

import io
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

from build_farmland_atlas import ATLAS_STATES, ATLAS_STATE_FIPS

NASS_API = "https://quickstats.nass.usda.gov/api/api_GET/"
USGS_URL = "https://www.sciencebase.gov/catalog/file/get/5af3311be4b0da30c1b245d8?name=usco2015v2.0.xlsx"
OUT = "data/atlas/raw/water.json"
UA = "AGSIST-automation/1.0 (+https://agsist.com/farmland-atlas)"

CENSUS_ITEMS = {
    "harvested": "AG LAND, CROPLAND, HARVESTED - ACRES",
    "irrigated": "AG LAND, CROPLAND, HARVESTED, IRRIGATED - ACRES",
}
# IC- is crop irrigation. IR- is all irrigation and includes golf courses (IG-).
# In 2015 the crop/golf split was optional for states, so a county can carry
# "--" in every IC- column and numbers only in IR-. Both sets are read; a
# county uses IC when IC-WFrTo is present and IR otherwise, and says which.
USGS_COLS = {"ir_gw_mgd": "IC-WGWFr", "ir_sw_mgd": "IC-WSWFr", "ir_tot_mgd": "IC-WFrTo", "ir_acres_k": "IC-IrTot"}
USGS_COLS_ALL = {"ir_gw_mgd": "IR-WGWFr", "ir_sw_mgd": "IR-WSWFr", "ir_tot_mgd": "IR-WFrTo", "ir_acres_k": "IR-IrTot"}
SUPPRESSED = re.compile(r"^\s*\((D|L|NA|X|Z|S)\)\s*$", re.I)


def log(*a):
    print(*a, flush=True)


def parse_value(raw):
    """NASS Value -> float, None if suppressed. A published zero is a zero."""
    if raw is None:
        return None
    s = str(raw).strip()
    if not s or SUPPRESSED.match(s):
        return None
    try:
        return float(s.replace(",", ""))
    except ValueError:
        return None


def fips_of(rec):
    st, co = (rec.get("state_fips_code") or "").strip(), (rec.get("county_ansi") or "").strip()
    if not st or not co:
        return None
    return st.zfill(2) + co.zfill(3)


def census_rows_to_counties(rows_by_item):
    """rows_by_item: {"harvested": [nass records], "irrigated": [...]} -> {fips: {harvested, irrigated}}
    A county with harvested acres and no irrigated row is recorded as None with
    irrigated_published False. Whether that absence means zero is decided by
    absent_rows_mean_zero() from the same pull, not assumed: if the census
    publishes explicit zeros for this item anywhere in the Atlas, absence is
    not zero and the builder withholds; if it never does, absence is how the
    census says none."""
    out = {}
    for item, rows in rows_by_item.items():
        for r in rows:
            f = fips_of(r)
            if not f or f[:2] not in ATLAS_STATE_FIPS:
                continue
            rec = out.setdefault(f, {"name": (r.get("county_name") or "").title(), "harvested": None, "irrigated": None,
                                     "irrigated_published": False})
            v = parse_value(r.get("Value"))
            rec[item] = v
            if item == "irrigated":
                rec["irrigated_published"] = True
    return out


def absent_rows_mean_zero(rows_by_item):
    """True when no irrigated row in the pull carries an explicit zero or dash."""
    zeros = 0
    for r in rows_by_item.get("irrigated", []):
        v = str(r.get("Value") or "").strip().replace(",", "")
        if v in ("0", "-", "0.0"):
            zeros += 1
    return zeros == 0


def nass_get(key, params):
    q = dict(params)
    q["key"] = key
    q["format"] = "JSON"
    url = NASS_API + "?" + urllib.parse.urlencode(q)
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.load(r).get("data", [])
        except urllib.error.HTTPError as e:
            if e.code == 400:
                log(f"  NASS 400 for {params.get('short_desc')} {params.get('state_alpha')}: no rows (or the string is wrong)")
                return []
            if attempt == 3:
                raise
            time.sleep(5 * (attempt + 1))
        except Exception:
            if attempt == 3:
                raise
            time.sleep(5 * (attempt + 1))
    return []


def fetch_census(key, states=ATLAS_STATES):
    rows_by_item = {k: [] for k in CENSUS_ITEMS}
    for st in states:
        for item, short in CENSUS_ITEMS.items():
            rows = nass_get(key, {"source_desc": "CENSUS", "year": "2022", "agg_level_desc": "COUNTY",
                                  "domain_desc": "TOTAL", "state_alpha": st, "short_desc": short})
            log(f"  census {st} {item}: {len(rows)} rows")
            rows_by_item[item].extend(rows)
            time.sleep(0.5)
    return rows_by_item


def usgs_rows(xlsx_bytes):
    """Read the county sheet of usco2015v2.0.xlsx by header name. Returns list of dicts."""
    try:
        import openpyxl
    except ImportError:
        sys.exit("openpyxl missing: pip install openpyxl")
    wb = openpyxl.load_workbook(io.BytesIO(xlsx_bytes), read_only=True, data_only=True)
    for ws in wb.worksheets:
        rows = ws.iter_rows(values_only=True)
        header = None
        for row in rows:
            vals = [str(v).strip() if v is not None else "" for v in row]
            if "FIPS" in vals and "STATEFIPS" in vals:
                header = vals
                break
        if header is None:
            continue
        missing = [c for c in list(USGS_COLS.values()) + list(USGS_COLS_ALL.values()) if c not in header]
        if missing:
            sys.exit(f"USGS workbook sheet {ws.title}: missing columns {missing}. Headers found: {header}")
        idx = {name: header.index(name) for name in list(USGS_COLS.values()) + list(USGS_COLS_ALL.values())}
        fi = header.index("FIPS")
        out = []

        def num(v):
            try:
                return float(v) if v not in (None, "", "--") else None
            except (TypeError, ValueError):
                return None
        for row in rows:
            if row is None or row[fi] is None:
                continue
            fips = str(row[fi]).strip().split(".")[0].zfill(5)
            ic = {key: num(row[idx[col]]) for key, col in USGS_COLS.items()}
            ir = {key: num(row[idx[col]]) for key, col in USGS_COLS_ALL.items()}
            rec = {"fips": fips}
            if ic["ir_tot_mgd"] is not None:
                rec.update(ic)
                rec["basis"] = "IC"
            else:
                rec.update(ir)
                rec["basis"] = "IR"
            out.append(rec)
        return out
    sys.exit("USGS workbook: no sheet with a FIPS/STATEFIPS header row")


def usgs_to_counties(rows):
    out = {}
    for r in rows:
        if r["fips"][:2] not in ATLAS_STATE_FIPS:
            continue
        out[r["fips"]] = {k: r.get(k) for k in list(USGS_COLS) + ["basis"]}
    return out


def merge(census, usgs):
    counties = {}
    for f in set(census) | set(usgs):
        c = census.get(f) or {}
        rec = {"name": c.get("name")}
        if c:
            rec["census2022"] = {"harvested": c.get("harvested"),
                                 "irrigated": c.get("irrigated"),
                                 "irrigated_published": c.get("irrigated_published", False)}
        if f in usgs:
            rec["usgs2015"] = usgs[f]
        counties[f] = rec
    return counties


def selftest():
    rows = {"harvested": [
                {"state_fips_code": "31", "county_ansi": "001", "county_name": "ADAMS", "Value": "250,000"},
                {"state_fips_code": "31", "county_ansi": "003", "county_name": "ANTELOPE", "Value": "300,000"},
                {"state_fips_code": "01", "county_ansi": "001", "county_name": "AUTAUGA", "Value": "1"}],
            "irrigated": [
                {"state_fips_code": "31", "county_ansi": "001", "county_name": "ADAMS", "Value": "200,000"},
                {"state_fips_code": "31", "county_ansi": "003", "county_name": "ANTELOPE", "Value": "(D)"}]}
    c = census_rows_to_counties(rows)
    assert set(c) == {"31001", "31003"}, c
    assert c["31001"] == {"name": "Adams", "harvested": 250000.0, "irrigated": 200000.0, "irrigated_published": True}, c["31001"]
    assert c["31003"]["irrigated"] is None and c["31003"]["irrigated_published"] is True
    u = usgs_to_counties([{"fips": "31001", "ir_gw_mgd": 80.0, "ir_sw_mgd": 20.0, "ir_tot_mgd": 100.0, "ir_acres_k": 50.0, "basis": "IC"},
                          {"fips": "01001", "ir_gw_mgd": 1, "ir_sw_mgd": 1, "ir_tot_mgd": 2, "ir_acres_k": 1, "basis": "IC"}])
    assert set(u) == {"31001"} and u["31001"]["basis"] == "IC"
    assert absent_rows_mean_zero(rows) is True
    assert absent_rows_mean_zero({"irrigated": [{"Value": "0"}]}) is False
    m = merge(c, u)
    assert m["31001"]["usgs2015"]["ir_gw_mgd"] == 80.0 and m["31001"]["census2022"]["irrigated"] == 200000.0
    assert "usgs2015" not in m["31003"]
    # the workbook reader, on a tiny workbook built here
    try:
        import openpyxl
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "CountyData"
        ws.append(["STATE", "STATEFIPS", "COUNTY", "COUNTYFIPS", "FIPS", "YEAR", "IC-WGWFr", "IC-WSWFr", "IC-WFrTo", "IC-IrTot", "IR-WGWFr", "IR-WSWFr", "IR-WFrTo", "IR-IrTot"])
        ws.append(["NE", "31", "Adams County", "001", "31001", 2015, 80, 20, 100, 50, 81, 21, 102, 51])
        ws.append(["AL", "01", "Autauga County", "001", "1001", 2015, 1, 1, 2, 1, 1, 1, 2, 1])   # a FIPS that lost its zero
        ws.append(["KS", "20", "Finney County", "055", "20055", 2015, "--", "--", "--", "--", 300, 10, 310, 200])   # state did not split crop/golf
        buf = io.BytesIO()
        wb.save(buf)
        rows = usgs_rows(buf.getvalue())
        assert rows[0]["fips"] == "31001" and rows[0]["ir_tot_mgd"] == 100.0 and rows[0]["basis"] == "IC", rows
        assert rows[1]["fips"] == "01001", rows[1]
        assert rows[2]["ir_tot_mgd"] == 310.0 and rows[2]["basis"] == "IR", rows[2]
    except ImportError:
        log("  (openpyxl not installed here; workbook reader untested in this run)")
    log("selftest ok")


def main():
    if "--selftest" in sys.argv:
        selftest()
        return
    key = os.environ.get("NASS_API_KEY", "").strip()
    if not key:
        sys.exit("NASS_API_KEY missing. Free key: https://quickstats.nass.usda.gov/api")
    log("Census of Agriculture 2022, county irrigated share")
    rows_by_item = fetch_census(key)
    census = census_rows_to_counties(rows_by_item)
    absent_is_zero = absent_rows_mean_zero(rows_by_item)
    log(f"  irrigated rows with an explicit zero: {'none, so an absent row is read as none reported' if absent_is_zero else 'present, so an absent row is withheld'}")
    log(f"  {len(census)} counties with a harvested-cropland row")
    # A wrong short_desc string comes back as HTTP 400, which reads as "no rows",
    # which would turn into "none reported" for every county in the Atlas. Nebraska
    # and Kansas irrigate; if neither has an irrigated row the string is wrong.
    n_irr = sum(1 for f, c in census.items() if f[:2] in ("31", "20") and c.get("irrigated_published"))
    if n_irr == 0:
        sys.exit("no irrigated-acres rows for Nebraska or Kansas: the census short_desc is wrong or NASS is down; refusing to write")
    if "--usgs" in sys.argv:
        with open(sys.argv[sys.argv.index("--usgs") + 1], "rb") as f:
            xlsx = f.read()
    else:
        log(f"downloading {USGS_URL}")
        req = urllib.request.Request(USGS_URL, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=300) as r:
            xlsx = r.read()
    usgs = usgs_to_counties(usgs_rows(xlsx))
    log(f"  USGS 2015: {len(usgs)} Atlas counties")
    counties = merge(census, usgs)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"source": "USDA Census of Agriculture 2022 (NASS Quick Stats) + USGS Estimated Use of Water 2015 county data (usco2015v2.0.xlsx)",
                   "census_year": 2022, "usgs_year": 2015, "absent_is_zero": absent_is_zero,
                   "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                   "counts": {"census": len(census), "usgs": len(usgs), "merged": len(counties)},
                   "counties": counties}, f, separators=(",", ":"))
    log(f"wrote {OUT}")


if __name__ == "__main__":
    main()
