#!/usr/bin/env python3
"""
fetch_atlas_wells.py — registered irrigation wells in Nebraska and water rights
in Kansas, summarised by county -> data/atlas/raw/wells.json

TWO STATE LAYERS, BOTH OPEN ARCGIS FEATURE SERVICES (fields read 2026-09-15)
  Nebraska DNR registered groundwater wells (~267k points)
    https://gis.ne.gov/agency3/rest/services/Groundwater_Wells_DWEE/FeatureServer/0
    fields used: CountyName, WellUseDescription, Status, TotalDepth,
    StaticWaterLevel, CompletionDate, DecommissionedDate, Latitude, Longitude
  Kansas DWR WIMAS points of diversion
    https://services.kgs.ku.edu/arcgis/rest/services/wimas/wimas_pd/FeatureServer/0
    fields used: UMW_CODE (IRR, MUN, IND, STK, DOM, REC), FPDIV_ACTIVE_IND,
    SOURCE_OF_SUPPLY, PRIORITY_DATE, RIGHT_TYPE, NUM_WELLS, LATITUDE, LONGITUDE
  Both are paged with resultOffset (2,000 and 1,000 records a page).

WHAT IS KEPT, PER COUNTY
  Nebraska: registered wells; irrigation wells not decommissioned; median
  total depth and median static water level (feet below land surface) of
  those; irrigation wells completed per decade. A well with no coordinates
  and a county name that does not match is dropped and counted.
  Kansas: points of diversion; active ones; irrigation ones; the median
  priority year of active irrigation rights (Kansas is prior appropriation:
  an older priority date is served first in a shortage); how many draw on
  groundwater. The exact strings the service uses for "active" and for the
  source of supply are counted and written to the file so a reader can see
  what was classed how.

  No other Atlas state publishes a comparable open layer that this script
  has verified; the builder says "no state well register read" for them.

USAGE
  python scripts/fetch_atlas_wells.py --selftest
  python scripts/fetch_atlas_wells.py
  python scripts/fetch_atlas_wells.py --limit 5     # first 5 pages per service
"""

import json
import os
import statistics
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

from atlas_common import UA, county_index, names_to_fips, CountyLocator, load_geometry, log

NE_URL = "https://gis.ne.gov/agency3/rest/services/Groundwater_Wells_DWEE/FeatureServer/0/query"
NE_FIELDS = "CountyName,WellUseDescription,Status,TotalDepth,StaticWaterLevel,CompletionDate,DecommissionedDate,Latitude,Longitude"
KS_URL = "https://services.kgs.ku.edu/arcgis/rest/services/wimas/wimas_pd/FeatureServer/0/query"
KS_FIELDS = "UMW_CODE,FPDIV_ACTIVE_IND,SOURCE_OF_SUPPLY,PRIORITY_DATE,RIGHT_TYPE,NUM_WELLS,LATITUDE,LONGITUDE"
OUT = "data/atlas/raw/wells.json"
ACTIVE_STRINGS = {"Y", "YES", "A", "ACTIVE", "1", "T", "TRUE"}
GW_STRINGS = {"G", "GW", "GROUND", "GROUNDWATER", "GROUND WATER"}
SW_STRINGS = {"S", "SW", "SURFACE", "SURFACE WATER"}


def page(url, fields, page_size, offset, retries=4):
    q = {"where": "1=1", "outFields": fields, "returnGeometry": "false", "f": "json",
         "orderByFields": "OBJECTID", "resultOffset": offset, "resultRecordCount": page_size}
    u = url + "?" + urllib.parse.urlencode(q)
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(u, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=180) as r:
                data = json.load(r)
            if "error" in data:
                raise RuntimeError(f"service error: {data['error']}")
            return [f["attributes"] for f in data.get("features", [])], bool(data.get("exceededTransferLimit"))
        except Exception as e:
            last = e
            time.sleep(10 * (attempt + 1))
    raise RuntimeError(f"{url} offset {offset}: {type(last).__name__}: {last}")


def fetch_all(url, fields, page_size, limit=None):
    rows, offset, n = [], 0, 0
    while True:
        got, more = page(url, fields, page_size, offset)
        rows.extend(got)
        offset += len(got)
        n += 1
        if n % 20 == 0:
            log(f"    {offset:,} rows")
        if not got or (not more and len(got) < page_size) or (limit and n >= limit):
            break
        time.sleep(0.2)
    return rows


def year_of_epoch_ms(v):
    try:
        return datetime.fromtimestamp(int(v) / 1000, tz=timezone.utc).year if v is not None else None
    except (ValueError, OSError, OverflowError):
        return None


def fnum(v):
    try:
        return float(v) if v is not None and v != "" else None
    except (TypeError, ValueError):
        return None


def median(xs):
    return round(statistics.median(xs), 1) if xs else None


def place_rows(rows, idx, locator, state, name_key=None, lat_key="Latitude", lon_key="Longitude"):
    """-> ({fips: [rows]}, dropped count). Name first (Nebraska), point second."""
    out, dropped = {}, 0
    if name_key:
        by_name, un = names_to_fips([dict(r, _st=state) for r in rows], idx, state_key="_st", name_key=name_key)
        for f, rs in by_name.items():
            out.setdefault(f, []).extend(rs)
        rest = [r for r in rows if (state, _norm(r.get(name_key))) not in idx]
    else:
        rest = rows
    for r in rest:
        lat, lon = fnum(r.get(lat_key)), fnum(r.get(lon_key))
        f = locator.locate(lon, lat) if lat is not None and lon is not None else None
        if f:
            out.setdefault(f, []).append(r)
        else:
            dropped += 1
    return out, dropped


def _norm(name):
    from atlas_common import norm_name
    return norm_name(name)


def summarise_ne(by_fips):
    out = {}
    for fips, rows in by_fips.items():
        irr = [r for r in rows if "IRRIG" in str(r.get("WellUseDescription") or "").upper() and r.get("DecommissionedDate") is None]
        depths = [d for d in (fnum(r.get("TotalDepth")) for r in irr) if d and d > 0]
        static = [d for d in (fnum(r.get("StaticWaterLevel")) for r in irr) if d is not None and d > 0]
        decades = {}
        for r in irr:
            y = year_of_epoch_ms(r.get("CompletionDate"))
            if y:
                d = f"{y // 10 * 10}s"
                decades[d] = decades.get(d, 0) + 1
        out[fips] = {"wells": len(rows), "irrigation_active": len(irr), "depth_median_ft": median(depths), "depth_n": len(depths),
                     "static_median_ft": median(static), "static_n": len(static),
                     "irrigation_by_decade": dict(sorted(decades.items()))}
    return out


def summarise_ks(by_fips):
    out = {}
    for fips, rows in by_fips.items():
        active = [r for r in rows if str(r.get("FPDIV_ACTIVE_IND") or "").strip().upper() in ACTIVE_STRINGS]
        irr = [r for r in active if str(r.get("UMW_CODE") or "").strip().upper() == "IRR"]
        years = [y for y in (year_of_epoch_ms(r.get("PRIORITY_DATE")) for r in irr) if y]
        gw = sum(1 for r in irr if str(r.get("SOURCE_OF_SUPPLY") or "").strip().upper() in GW_STRINGS)
        sw = sum(1 for r in irr if str(r.get("SOURCE_OF_SUPPLY") or "").strip().upper() in SW_STRINGS)
        out[fips] = {"points": len(rows), "active": len(active), "irrigation_active": len(irr),
                     "priority_year_median": int(statistics.median(years)) if years else None, "priority_n": len(years),
                     "priority_before_1970": sum(1 for y in years if y < 1970),
                     "groundwater": gw, "surface": sw, "unclassed_source": len(irr) - gw - sw}
    return out


def value_counts(rows, key):
    c = {}
    for r in rows:
        v = str(r.get(key) if r.get(key) is not None else "null").strip()
        c[v] = c.get(v, 0) + 1
    return dict(sorted(c.items(), key=lambda kv: -kv[1])[:20])


def selftest():
    geo = {"features": [
        {"id": "31001", "properties": {"name": "Adams", "st": "NE"},
         "geometry": {"type": "Polygon", "coordinates": [[[-98.8, 40.3], [-98.2, 40.3], [-98.2, 40.7], [-98.8, 40.7], [-98.8, 40.3]]]}},
        {"id": "20055", "properties": {"name": "Finney", "st": "KS"},
         "geometry": {"type": "Polygon", "coordinates": [[[-101.2, 37.7], [-100.6, 37.7], [-100.6, 38.3], [-101.2, 38.3], [-101.2, 37.7]]]}}]}
    idx, loc = county_index(geo), CountyLocator(geo)
    ms = lambda y: int(datetime(y, 6, 1, tzinfo=timezone.utc).timestamp() * 1000)
    ne = [{"CountyName": "Adams", "WellUseDescription": "Irrigation", "TotalDepth": 200, "StaticWaterLevel": 80, "CompletionDate": ms(1975), "DecommissionedDate": None, "Latitude": None, "Longitude": None},
          {"CountyName": "ADAMS COUNTY", "WellUseDescription": "Irrigation", "TotalDepth": 300, "StaticWaterLevel": 0, "CompletionDate": ms(2012), "DecommissionedDate": None, "Latitude": 40.5, "Longitude": -98.5},
          {"CountyName": "Adams", "WellUseDescription": "Irrigation", "TotalDepth": 250, "StaticWaterLevel": 100, "CompletionDate": ms(2001), "DecommissionedDate": ms(2020), "Latitude": 40.5, "Longitude": -98.5},
          {"CountyName": "Adams", "WellUseDescription": "Domestic", "TotalDepth": 90, "StaticWaterLevel": 30, "CompletionDate": None, "DecommissionedDate": None, "Latitude": 40.5, "Longitude": -98.5},
          {"CountyName": "Nowhere", "WellUseDescription": "Irrigation", "TotalDepth": 1, "StaticWaterLevel": 1, "CompletionDate": None, "DecommissionedDate": None, "Latitude": 40.5, "Longitude": -98.5},
          {"CountyName": "Nowhere", "WellUseDescription": "Irrigation", "TotalDepth": 1, "StaticWaterLevel": 1, "CompletionDate": None, "DecommissionedDate": None, "Latitude": None, "Longitude": None}]
    by, dropped = place_rows(ne, idx, loc, "NE", name_key="CountyName")
    assert set(by) == {"31001"} and len(by["31001"]) == 5 and dropped == 1, (by.keys(), dropped)
    s = summarise_ne(by)["31001"]
    assert s["wells"] == 5 and s["irrigation_active"] == 3 and s["depth_median_ft"] == 200.0 and s["depth_n"] == 3, s
    assert s["static_median_ft"] == 40.5 and s["static_n"] == 2 and s["irrigation_by_decade"] == {"1970s": 1, "2010s": 1}, s
    ks = [{"UMW_CODE": "IRR", "FPDIV_ACTIVE_IND": "Y", "SOURCE_OF_SUPPLY": "G", "PRIORITY_DATE": ms(1965), "LATITUDE": 38.0, "LONGITUDE": -100.9},
          {"UMW_CODE": "IRR", "FPDIV_ACTIVE_IND": "Y", "SOURCE_OF_SUPPLY": "S", "PRIORITY_DATE": ms(1980), "LATITUDE": 38.0, "LONGITUDE": -100.9},
          {"UMW_CODE": "IRR", "FPDIV_ACTIVE_IND": "N", "SOURCE_OF_SUPPLY": "G", "PRIORITY_DATE": ms(1950), "LATITUDE": 38.0, "LONGITUDE": -100.9},
          {"UMW_CODE": "MUN", "FPDIV_ACTIVE_IND": "Y", "SOURCE_OF_SUPPLY": "G", "PRIORITY_DATE": ms(1990), "LATITUDE": 38.0, "LONGITUDE": -100.9},
          {"UMW_CODE": "IRR", "FPDIV_ACTIVE_IND": "Y", "SOURCE_OF_SUPPLY": "G", "PRIORITY_DATE": ms(1990), "LATITUDE": 0, "LONGITUDE": 0}]
    by2, dropped2 = place_rows(ks, idx, loc, "KS", lat_key="LATITUDE", lon_key="LONGITUDE")
    assert set(by2) == {"20055"} and dropped2 == 1
    k = summarise_ks(by2)["20055"]
    assert k == {"points": 4, "active": 3, "irrigation_active": 2, "priority_year_median": 1972, "priority_n": 2, "priority_before_1970": 1,
                 "groundwater": 1, "surface": 1, "unclassed_source": 0}, k
    assert value_counts(ks, "UMW_CODE") == {"IRR": 4, "MUN": 1}
    assert year_of_epoch_ms(None) is None and year_of_epoch_ms("x") is None
    log("selftest ok")


def main():
    if "--selftest" in sys.argv:
        selftest()
        return
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else None
    geo = load_geometry()
    idx = county_index(geo)
    ne_geo = {"features": [f for f in geo["features"] if f["properties"]["st"] == "NE"]}
    ks_geo = {"features": [f for f in geo["features"] if f["properties"]["st"] == "KS"]}
    log("Nebraska registered wells")
    ne_rows = fetch_all(NE_URL, NE_FIELDS, 2000, limit)
    log(f"  {len(ne_rows):,} rows; use: {value_counts(ne_rows, 'WellUseDescription')}")
    ne_by, ne_dropped = place_rows(ne_rows, idx, CountyLocator(ne_geo), "NE", name_key="CountyName")
    ne = summarise_ne(ne_by)
    log(f"  {len(ne)} counties, {ne_dropped:,} rows unplaced")
    log("Kansas WIMAS points of diversion")
    ks_rows = fetch_all(KS_URL, KS_FIELDS, 1000, limit)
    ks_active_counts = value_counts(ks_rows, "FPDIV_ACTIVE_IND")
    ks_source_counts = value_counts(ks_rows, "SOURCE_OF_SUPPLY")
    log(f"  {len(ks_rows):,} rows; use: {value_counts(ks_rows, 'UMW_CODE')}; active: {ks_active_counts}; source: {ks_source_counts}")
    ks_by, ks_dropped = place_rows(ks_rows, idx, CountyLocator(ks_geo), "KS", lat_key="LATITUDE", lon_key="LONGITUDE")
    ks = summarise_ks(ks_by)
    log(f"  {len(ks)} counties, {ks_dropped:,} rows unplaced")
    # a broken query or join places nothing (measured on a fixture); a real pull
    # places nearly every county, so the gate only needs to tell those apart
    if not limit and (len(ne) < 30 or len(ks) < 30):
        sys.exit(f"Nebraska {len(ne)} and Kansas {len(ks)} counties: too few for a full pull; nothing written")
    unclassed_active = sum(v for k, v in ks_active_counts.items() if k.upper() not in ACTIVE_STRINGS and k.upper() not in {"N", "NO", "I", "INACTIVE", "0", "F", "FALSE", "NULL"})
    if unclassed_active:
        log(f"  WARNING: {unclassed_active:,} Kansas rows carry an FPDIV_ACTIVE_IND value this script does not class; they count as not active")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"source": "Nebraska DNR registered groundwater wells (gis.ne.gov) + Kansas DWR WIMAS points of diversion (services.kgs.ku.edu)",
                   "urls": [NE_URL, KS_URL],
                   "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                   "counts": {"ne_rows": len(ne_rows), "ne_unplaced": ne_dropped, "ks_rows": len(ks_rows), "ks_unplaced": ks_dropped},
                   "ks_value_strings": {"FPDIV_ACTIVE_IND": ks_active_counts, "SOURCE_OF_SUPPLY": ks_source_counts, "UMW_CODE": value_counts(ks_rows, "UMW_CODE")},
                   "ne_value_strings": {"WellUseDescription": value_counts(ne_rows, "WellUseDescription"), "Status": value_counts(ne_rows, "Status")},
                   "classed_as": {"active": sorted(ACTIVE_STRINGS), "groundwater": sorted(GW_STRINGS), "surface": sorted(SW_STRINGS)},
                   "ne": ne, "ks": ks}, f, separators=(",", ":"))
    log(f"wrote {OUT}: NE {len(ne)} counties, KS {len(ks)} counties")


if __name__ == "__main__":
    main()
