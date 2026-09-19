#!/usr/bin/env python3
"""
fetch_atlas_energy.py — solar, wind and battery capacity on the ground and
proposed, by county, from the federal generator census -> data/atlas/raw/energy.json

ONE SOURCE
  EIA Form 860, annual, final data for the previous year
    https://www.eia.gov/electricity/data/eia860/xls/eia860YYYY.zip
  (the 2025 final release is dated 2026-09-10 on the EIA page, read 2026-09-15).
  Inside: a Plant workbook (plant code, state, county, latitude, longitude) and
  a Generator workbook with "Operable", "Proposed" and "Retired and Canceled"
  tabs (plant code, technology, nameplate MW, years). Every generator of 1 MW
  or more at a grid-connected plant is in it; rooftop solar is not.

HOW IT IS READ
  The workbook names and column headers are found, not assumed: the plant
  file is the one whose name contains "Plant", the generator file the one
  containing "Generator"; in each sheet the header row is the first row with a
  "Plant Code" cell and columns are matched by header text (NAMEPLATE,
  TECHNOLOGY, OPERATING YEAR, the PLANNED ... YEAR). A missing column prints
  the headers found and exits non-zero. Technology strings are matched on
  SOLAR, WIND and BATTER; everything else is counted as "other".

  Counties: the Plant file's (state, county name) joined to Atlas FIPS by
  name; a plant whose name does not match is placed by its latitude and
  longitude; one that has neither is listed as unplaced.

WHAT IS KEPT (per county, MW)
  operable: solar, wind, storage, other; the year the first solar and first
  wind generator came online; plant count.
  proposed: solar, wind, storage MW with a planned year (the Proposed tab is
  what developers have told EIA, not an interconnection queue).

USAGE
  python scripts/fetch_atlas_energy.py --selftest
  python scripts/fetch_atlas_energy.py                # current year - 1
  python scripts/fetch_atlas_energy.py --year 2024
  python scripts/fetch_atlas_energy.py --zip eia8602025.zip
"""

import io
import json
import os
import sys
import zipfile
from datetime import datetime, timezone

from atlas_common import get, county_index, names_to_fips, CountyLocator, load_geometry, log

BASE = "https://www.eia.gov/electricity/data/eia860/xls/eia860{year}.zip"
OUT = "data/atlas/raw/energy.json"


def cell(v):
    return str(v).strip() if v is not None else ""


def find_header(rows, must="PLANT CODE"):
    rows = list(rows)
    for i, row in enumerate(rows):
        vals = [cell(v).upper() for v in row]
        if any(v == must for v in vals):
            return vals, rows[i + 1:]
    return None, rows


def col(header, *needles, required=True):
    """index of the first header containing every needle (upper)."""
    for i, h in enumerate(header):
        if all(n in h for n in needles):
            return i
    if required:
        raise KeyError(f"no column containing {needles} in header {header}")
    return None


def tech_class(t):
    t = t.upper()
    if "SOLAR" in t:
        return "solar"
    if "WIND" in t:
        return "wind"
    if "BATTER" in t:
        return "storage"
    return "other"


def num(v):
    try:
        return float(cell(v).replace(",", ""))
    except ValueError:
        return None


def read_plants(ws_rows):
    header, body = find_header(ws_rows)
    if header is None:
        raise KeyError("Plant sheet: no row with a PLANT CODE cell")
    i_code, i_state, i_county = col(header, "PLANT CODE"), col(header, "STATE"), col(header, "COUNTY")
    i_lat, i_lon = col(header, "LATITUDE", required=False), col(header, "LONGITUDE", required=False)
    plants = {}
    for r in body:
        code = cell(r[i_code] if i_code < len(r) else "")
        if not code:
            continue
        plants[code] = {"state": cell(r[i_state]) if i_state < len(r) else "", "county": cell(r[i_county]) if i_county < len(r) else "",
                        "lat": num(r[i_lat]) if i_lat is not None and i_lat < len(r) else None,
                        "lon": num(r[i_lon]) if i_lon is not None and i_lon < len(r) else None}
    return plants


def read_generators(ws_rows, year_needles):
    """-> list of (plant code, class, mw, year)"""
    header, body = find_header(ws_rows)
    if header is None:
        raise KeyError("Generator sheet: no row with a PLANT CODE cell")
    i_code, i_tech, i_mw = col(header, "PLANT CODE"), col(header, "TECHNOLOGY"), col(header, "NAMEPLATE")
    i_year = None
    for needles in (year_needles if isinstance(year_needles[0], tuple) else (year_needles,)):
        i_year = col(header, *needles, required=False)
        if i_year is not None:
            break
    out = []
    for r in body:
        code = cell(r[i_code] if i_code < len(r) else "")
        mw = num(r[i_mw]) if i_mw < len(r) else None
        if not code or mw is None:
            continue
        y = num(r[i_year]) if i_year is not None and i_year < len(r) else None
        out.append((code, tech_class(cell(r[i_tech]) if i_tech < len(r) else ""), mw, int(y) if y else None))
    return out


def place(plants, idx, locator):
    """plant code -> fips (or None); returns (map, n_by_name, n_by_point, unplaced)"""
    by_name, _ = names_to_fips([dict(code=c, **p) for c, p in plants.items()], idx)
    out, n_name, n_point, unplaced = {}, 0, 0, []
    for fips, rows in by_name.items():
        for r in rows:
            out[r["code"]] = fips
            n_name += 1
    for code, p in plants.items():
        if code in out:
            continue
        if p["lat"] is not None and p["lon"] is not None:
            f = locator.locate(p["lon"], p["lat"])
            if f:
                out[code] = f
                n_point += 1
                continue
        if p["state"] in {st for st, _ in idx}:
            unplaced.append((p["state"], p["county"]))
    return out, n_name, n_point, unplaced


def aggregate(placed, operable, proposed):
    counties = {}

    def rec(fips):
        return counties.setdefault(fips, {"operable": {"solar": 0.0, "wind": 0.0, "storage": 0.0, "other": 0.0, "plants": 0,
                                                       "first_solar": None, "first_wind": None},
                                          "proposed": {"solar": 0.0, "wind": 0.0, "storage": 0.0, "other": 0.0, "earliest_year": None}})
    seen_plants = set()
    for code, cls, mw, y in operable:
        f = placed.get(code)
        if not f:
            continue
        o = rec(f)["operable"]
        o[cls] += mw
        if code not in seen_plants:
            o["plants"] += 1
            seen_plants.add(code)
        if cls in ("solar", "wind") and y:
            k = "first_" + cls
            o[k] = y if o[k] is None else min(o[k], y)
    for code, cls, mw, y in proposed:
        f = placed.get(code)
        if not f:
            continue
        p = rec(f)["proposed"]
        p[cls] += mw
        if y:
            p["earliest_year"] = y if p["earliest_year"] is None else min(p["earliest_year"], y)
    for c in counties.values():
        for k in ("operable", "proposed"):
            for kk in ("solar", "wind", "storage", "other"):
                c[k][kk] = round(c[k][kk], 1)
    return counties


def sheets_of(zbytes):
    """-> (plant rows, {sheet title: rows} of the generator workbook, file names)"""
    try:
        import openpyxl
    except ImportError:
        sys.exit("openpyxl missing: pip install openpyxl")
    with zipfile.ZipFile(io.BytesIO(zbytes)) as z:
        names = [n for n in z.namelist() if n.lower().endswith(".xlsx")]
        plant = [n for n in names if "plant" in n.lower().rsplit("/", 1)[-1]]
        gen = [n for n in names if "generator" in n.lower().rsplit("/", 1)[-1]]
        if len(plant) != 1 or len(gen) != 1:
            sys.exit(f"expected one Plant and one Generator workbook, found plant={plant} generator={gen} in {names}")
        wb = openpyxl.load_workbook(io.BytesIO(z.read(plant[0])), read_only=True, data_only=True)
        plant_rows = list(wb.worksheets[0].iter_rows(values_only=True))
        wb2 = openpyxl.load_workbook(io.BytesIO(z.read(gen[0])), read_only=True, data_only=True)
        gen_sheets = {ws.title: list(ws.iter_rows(values_only=True)) for ws in wb2.worksheets}
    return plant_rows, gen_sheets, names


def selftest():
    plant_rows = [("title row",), ("Utility ID", "Plant Code", "Plant Name", "State", "County", "Latitude", "Longitude"),
                  (1, 100, "Story Solar", "IA", "Story", 42.0, -93.4), (1, 101, "Somewhere", "IA", "Nowhere", 41.3, -94.5),
                  (1, 102, "Lost", "IA", "Gone", None, None), (1, 103, "Other state", "AL", "Autauga", 32.5, -86.6)]
    plants = read_plants(plant_rows)
    assert plants["100"] == {"state": "IA", "county": "Story", "lat": 42.0, "lon": -93.4}, plants
    gen_rows = [("t",), ("Plant Code", "Generator ID", "Technology", "Nameplate Capacity (MW)", "Operating Year", "Status"),
                (100, "1", "Solar Photovoltaic", "5.5", 2019, "OP"), (100, "2", "Solar Photovoltaic", 4.5, 2021, "OP"),
                (101, "1", "Onshore Wind Turbine", 100, 2010, "OP"), (101, "2", "Batteries", 10, 2023, "OP"),
                (102, "1", "Natural Gas Fired Combined Cycle", 500, 2001, "OP"), (999, "x", "Solar", None, None, None)]
    op = read_generators(gen_rows, ("OPERATING", "YEAR"))
    assert len(op) == 5 and op[0] == ("100", "solar", 5.5, 2019) and op[3] == ("101", "storage", 10.0, 2023), op
    prop_rows = [("Plant Code", "Technology", "Nameplate Capacity (MW)", "Planned Operation Year"), (100, "Solar Photovoltaic", 50, 2027)]
    pr = read_generators(prop_rows, ("PLANNED", "YEAR"))
    assert pr == [("100", "solar", 50.0, 2027)], pr
    geo = {"features": [
        {"id": "19169", "properties": {"name": "Story", "st": "IA"},
         "geometry": {"type": "Polygon", "coordinates": [[[-93.7, 41.8], [-93.2, 41.8], [-93.2, 42.2], [-93.7, 42.2], [-93.7, 41.8]]]}},
        {"id": "19001", "properties": {"name": "Adair", "st": "IA"},
         "geometry": {"type": "Polygon", "coordinates": [[[-94.7, 41.1], [-94.2, 41.1], [-94.2, 41.5], [-94.7, 41.5], [-94.7, 41.1]]]}}]}
    placed, n_name, n_point, unplaced = place(plants, county_index(geo), CountyLocator(geo))
    assert placed == {"100": "19169", "101": "19001"} and n_name == 1 and n_point == 1 and unplaced == [("IA", "Gone")], (placed, unplaced)
    c = aggregate(placed, op, pr)
    assert c["19169"]["operable"] == {"solar": 10.0, "wind": 0.0, "storage": 0.0, "other": 0.0, "plants": 1, "first_solar": 2019, "first_wind": None}, c["19169"]
    assert c["19001"]["operable"]["wind"] == 100.0 and c["19001"]["operable"]["storage"] == 10.0 and c["19001"]["operable"]["first_wind"] == 2010
    assert c["19169"]["proposed"] == {"solar": 50.0, "wind": 0.0, "storage": 0.0, "other": 0.0, "earliest_year": 2027}
    try:
        col(["A", "B"], "NAMEPLATE")
        raise AssertionError("missing column accepted")
    except KeyError:
        pass
    log("selftest ok")


def main():
    if "--selftest" in sys.argv:
        selftest()
        return
    year = int(sys.argv[sys.argv.index("--year") + 1]) if "--year" in sys.argv else datetime.now(timezone.utc).year - 1
    if "--zip" in sys.argv:
        with open(sys.argv[sys.argv.index("--zip") + 1], "rb") as f:
            zb = f.read()
    else:
        url = BASE.format(year=year)
        log(f"downloading {url}")
        zb = get(url)
        if zb is None:
            year -= 1
            url = BASE.format(year=year)
            log(f"  404; trying {url}")
            zb = get(url)
            if zb is None:
                sys.exit("EIA-860 zip not found for either year")
    plant_rows, gen_sheets, names = sheets_of(zb)
    log(f"  workbooks: {names}")
    log(f"  generator tabs: {list(gen_sheets)}")
    plants = read_plants(plant_rows)
    op_tab = next((t for t in gen_sheets if "operable" in t.lower()), None)
    pr_tab = next((t for t in gen_sheets if "proposed" in t.lower()), None)
    if op_tab is None or pr_tab is None:
        sys.exit(f"generator workbook has no Operable/Proposed tab: {list(gen_sheets)}")
    operable = read_generators(gen_sheets[op_tab], ("OPERATING", "YEAR"))
    proposed = read_generators(gen_sheets[pr_tab], (("PLANNED", "YEAR"), ("CURRENT", "YEAR"), ("EFFECTIVE", "YEAR")))
    log(f"  operable {len(operable)} generators (year column {'found' if any(y for *_, y in operable) else 'NOT found'}); "
        f"proposed {len(proposed)} (planned year {'found' if any(y for *_, y in proposed) else 'NOT found'})")
    geo = load_geometry()
    placed, n_name, n_point, unplaced = place(plants, county_index(geo), CountyLocator(geo))
    log(f"  plants: {len(plants)} in file; {n_name} placed by county name, {n_point} by point; {len(unplaced)} Atlas-state plants unplaced")
    counties = aggregate(placed, operable, proposed)
    # A layout that misreads gives zero placed plants (measured on a fixture).
    # 100 told that apart from a real run and nothing else: the last 15-state
    # run placed solar in 543 counties and wind in 360, and `counties` counts
    # the union, so it was already more than five times the gate. A 50-state
    # run covers those same 15 states plus 35 more, so it cannot honestly come
    # back with fewer counties than the 15 states alone produced. The gate is
    # 500 -- just under the observed 543, so one county moving between EIA
    # releases does not fail a good run, and high enough that a broken
    # EIA-860 join that still places a few hundred plants stops the write.
    if len(counties) < 500:
        sys.exit(f"only {len(counties)} Atlas counties carry a generator; the join or the layout is wrong; nothing written")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"source": f"EIA Form 860 {year} (Plant and Generator workbooks, Operable and Proposed tabs)",
                   "url": BASE.format(year=year), "year": year,
                   "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                   "counts": {"plants": len(plants), "placed_by_name": n_name, "placed_by_point": n_point, "unplaced": len(unplaced),
                              "operable_generators": len(operable), "proposed_generators": len(proposed), "counties": len(counties)},
                   "unplaced": sorted(set(unplaced))[:200],
                   "note": "MW are nameplate; technology classed on SOLAR / WIND / BATTER in the EIA technology string; rooftop solar under 1 MW is not in Form 860",
                   "counties": counties}, f, separators=(",", ":"))
    log(f"wrote {OUT}: {len(counties)} counties")


if __name__ == "__main__":
    main()
