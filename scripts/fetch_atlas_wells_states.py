#!/usr/bin/env python3
"""
fetch_atlas_wells_states.py — irrigation wells from ten more state
registers, summarised by county -> data/atlas/raw/wells_states.json

Nebraska and Kansas stay in fetch_atlas_wells.py. This file adds every other
state whose register is open, machine-readable and has a use code that marks
irrigation. Each source below was read on 2026-09-19: the endpoint answered,
the irrigation value was seen in the service's own list of values, and the
fields were seen in a real record.

  MN  Minnesota County Well Index (MDH/MGS)         use_c = 'IR'
  MI  Michigan EGLE Wellogic                        WELL_TYPE = 'IRRI'
  OH  Ohio DNR water well logs                      WELL_USE = 'AGRIC/IRRIG'
  WI  Wisconsin DNR high-capacity wells, active     WATER_USE_SHORT_DESC: five farm irrigation classes
  OK  Oklahoma Water Resources Board wells          use_class = 'Irrigation'
  CA  California DWR well completion reports, new   B118WellUse = 'Irrigation', RecordType = 'New'
  AZ  Arizona DWR well registry (Wells55)           WATER_USE includes IRRIGATION, not cancelled
  ID  Idaho DWR wells                               WellUse = 'Irrigation'
  OR  Oregon WRD well logs, new wells               primary_use = 'Irrigation', work_new = 1
  NV  Nevada DWR well driller reports, new wells    ProposedUse = 'Irrigation', WorkType = 'New'

  Not added, and why: WA has no use field; MT, UT, NM are water-right points
  or need a code table not yet verified; TX, CO need a zip adapter or a key;
  IA, IN, MO, IL, FL, the Dakotas, WY have no irrigation code, no open bulk
  source, or a host that failed (see the 9/19 research notes in the project).

HOW A WELL IS PLACED
  Every row is requested with its point in WGS84 (outSR=4326) and placed in a
  county by point-in-polygon against the Atlas's own boundaries, state by
  state. A county name in the source is never trusted over the point. A row
  with no point or a point outside the state is counted, not guessed. (WI
  serves a small parcel polygon per well; the centre of its outline is used.)

WHAT IS KEPT, PER COUNTY
  irrigation wells on record; median total depth and median water level
  (feet below land surface, as the driller recorded it at completion; in
  Oklahoma the register records first water, not static level, and says so);
  wells completed per decade; and, where the register carries a pump or test
  rate, how many were rated at 100 gpm or more. Registers differ in how far
  back they go and what they count, so a county is compared with its own
  state, never across states.

USAGE
  python scripts/fetch_atlas_wells_states.py --selftest
  python scripts/fetch_atlas_wells_states.py
  python scripts/fetch_atlas_wells_states.py --only MN,OH --limit 2
"""

import json
import os
import statistics
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

from atlas_common import UA, CountyLocator, load_geometry, log

OUT = "data/atlas/raw/wells_states.json"
WI_IRR = ("Agricultural irrigation", "Cranberry irrigation", "Berry irrig not cranb",
          "Orchards/nursery irrig", "Sod irrigation")      # not "Irrigation - other": golf and landscape land there
HICAP_GPM = 100

SOURCES = {
    "MN": {"register": "Minnesota County Well Index (MDH and Minnesota Geological Survey)",
           "url": "https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_health/water_well_information_non_pws/FeatureServer/1/query",
           "where": "use_c='IR'", "oid": "objectid", "page": 2000,
           "depth": "depth_drll", "level": "swlavgmeas", "date": "date_drll", "rate": None, "status": "status_c",
           "level_kind": "static water level (average of recorded measurements)"},
    "MI": {"register": "Michigan EGLE Wellogic water well records",
           "url": "https://gisagoegle.state.mi.us/arcgis/rest/services/EGLE/DwOpenData/MapServer/3/query",
           "where": "WELL_TYPE='IRRI'", "oid": "OBJECTID", "page": 1000,
           "depth": "WELL_DEPTH", "level": "SWL", "date": "CONST_DATE", "rate": "PMP_CPCITY", "status": "WEL_STATUS",
           "level_kind": "static water level at completion"},
    "OH": {"register": "Ohio DNR water well logs",
           "url": "https://gis2.ohiodnr.gov/arcgis/rest/services/DSW_Services/waterwells/MapServer/0/query",
           "where": "WELL_USE='AGRIC/IRRIG'", "oid": "OBJECTID", "page": 1000,
           "depth": "TOTAL_DEPTH", "level": "STATIC_WATER_LEVEL_FT", "date": "COMPLETION_DATE", "rate": "TEST_RATE_GPM", "status": None,
           "level_kind": "static water level at completion"},
    "WI": {"register": "Wisconsin DNR high-capacity wells (active sources)",
           "url": "https://dnrmaps.wi.gov/arcgis/rest/services/DG_HiCap/DG_WATER_USE_LOCATIONS_WTM_EXT/MapServer/1/query",
           "where": "ACTIVE_SOURCE='Y' AND WATER_USE_SHORT_DESC IN (" + ",".join("'%s'" % v for v in WI_IRR) + ")",
           "oid": "OBJECTID", "page": 2000,
           "depth": "WELL_DEPTH_FT", "level": None, "date": "COMPLETION_DATE", "rate": "PUMP_CAPACITY_GPM", "status": "WATER_USE_SHORT_DESC",
           "level_kind": None},
    "OK": {"register": "Oklahoma Water Resources Board groundwater wells",
           "url": "https://owrb.csa.ou.edu/server/rest/services/Groundwater/Groundwater_Wells/MapServer/1/query",
           "where": "use_class='Irrigation'", "oid": "objectid", "page": 1000,
           "depth": "total_dpth", "level": "first_wtr", "date": "const_date", "rate": "approx_yld", "status": None,
           "level_kind": "depth to first water at drilling (not a static level)"},
    "CA": {"register": "California DWR well completion reports (new wells)",
           "url": "https://utility.arcgis.com/usrsvcs/servers/c074ca40fd684e41babd776eebefd009/rest/services/Environment/i07_WellCompletionReports/MapServer/0/query",
           "where": "B118WellUse='Irrigation' AND RecordType='New'", "oid": "OBJECTID", "page": 2000,
           "depth": "TotalCompletedDepth", "level": "StaticWaterLevel", "date": "DateWorkEnded", "rate": "WellYield", "status": None,
           "level_kind": "static water level at completion"},
    "AZ": {"register": "Arizona DWR well registry (Wells55), not cancelled",
           "url": "https://services.arcgis.com/C34zQ7veRS0V1t04/arcgis/rest/services/Well_Registry_2024/FeatureServer/0/query",
           "where": "WATER_USE LIKE '%IRRIGATION%' AND (WELL_CANCELLED IS NULL OR WELL_CANCELLED='N')", "oid": "OBJECTID", "page": 2000,
           "depth": "WELL_DEPTH", "level": "WATER_LEVEL", "date": "INSTALLED", "rate": "PUMPRATE", "status": "WELL_TYPE_GROUP",
           "level_kind": "water level at completion", "zero_is_unknown": True},
    "ID": {"register": "Idaho DWR well records",
           "url": "https://gis.idwr.idaho.gov/hosting/rest/services/Groundwater/Wells/FeatureServer/0/query",
           "where": "WellUse='Irrigation'", "oid": "OBJECTID", "page": 2000,
           "depth": "TotalDepth", "level": "StaticWaterLevel", "date": "ConstructionDate", "rate": "ProductionRate", "status": None,
           "level_kind": "static water level at completion"},
    "OR": {"register": "Oregon WRD water well logs (new wells)",
           "url": "https://arcgis.wrd.state.or.us/arcgis/rest/services/dynamic/wl_well_logs_themes_WGS84/MapServer/0/query",
           "where": "primary_use='Irrigation' AND work_new=1", "oid": "OBJECTID", "page": 1000,
           "depth": "completed_depth", "level": "post_static_water_level", "date": "complete_date", "rate": "yield_gpm", "status": None,
           "level_kind": "static water level at completion"},
    "NV": {"register": "Nevada DWR well driller reports (new wells)",
           "url": "https://arcgis.water.nv.gov/arcgis/rest/services/NDWR/Well_Driller_Reports/FeatureServer/0/query",
           "where": "ProposedUse='Irrigation' AND WorkType='New'", "oid": "OBJECTID", "page": 1000,
           "depth": "DepthDrilled", "level": "StaticWaterLevel", "date": "WellFinishDate", "rate": "yield", "status": None,
           "level_kind": "static water level at completion"},
}


def fields_of(cfg):
    return ",".join(sorted({f for f in (cfg["oid"], cfg["depth"], cfg["level"], cfg["date"], cfg["rate"], cfg["status"]) if f}))


def page(cfg, offset, retries=4):
    q = {"where": cfg["where"], "outFields": fields_of(cfg), "returnGeometry": "true", "outSR": "4326", "f": "json",
         "orderByFields": cfg["oid"], "resultOffset": offset, "resultRecordCount": cfg["page"]}
    u = cfg["url"] + "?" + urllib.parse.urlencode(q)
    last = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": UA}), timeout=180) as r:
                data = json.load(r)
            if "error" in data:
                raise RuntimeError(f"service error: {data['error']}")
            return data.get("features", []), bool(data.get("exceededTransferLimit"))
        except Exception as e:
            last = e
            time.sleep(10 * (attempt + 1))
    raise RuntimeError(f"offset {offset}: {type(last).__name__}: {last}")


def fetch_state(cfg, limit=None):
    rows, offset, n = [], 0, 0
    seen_first = set()
    while True:
        got, more = page(cfg, offset)
        # a service that ignores resultOffset hands back page one forever; stop, do not count it twice
        first = None
        if got:
            at = got[0].get("attributes") or {}
            first = next((v for k, v in at.items() if k.lower() == cfg["oid"].lower()), None)
            if first is None:
                raise RuntimeError(f"no {cfg['oid']} in the rows: the repeat guard cannot work, so nothing is kept")
        if first is not None and first in seen_first:
            raise RuntimeError(f"the service repeated a page at offset {offset}: it does not page; nothing kept")
        seen_first.add(first)
        rows.extend(got)
        offset += len(got)
        n += 1
        if n % 25 == 0:
            log(f"    {offset:,} rows")
        if not got or (not more and len(got) < cfg["page"]) or (limit and n >= limit):
            break
        time.sleep(0.2)
    return rows


def point_of(geom):
    """(lon, lat) of a point, or the centre of a polygon's first ring's box; None if absent."""
    if not geom:
        return None
    if "x" in geom and "y" in geom and geom["x"] is not None and geom["y"] is not None:
        return float(geom["x"]), float(geom["y"])
    rings = geom.get("rings")
    if rings and rings[0]:
        xs = [p[0] for p in rings[0]]
        ys = [p[1] for p in rings[0]]
        return (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
    return None


def fnum(v, zero_unknown=False):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    if zero_unknown and x == 0:
        return None
    return x


def year_of(v):
    """epoch ms (any sign), yyyymmdd as a number, or text starting YYYY."""
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        iv = int(v)
        if iv == 0:
            return None
        if 1850 <= iv <= 2100:
            y = iv                       # a bare year
        elif 185001 <= iv <= 210012:
            y = iv // 100                # yyyymm
        elif 18000101 <= iv <= 21001231:
            y = iv // 10000              # yyyymmdd
        else:
            try:
                y = datetime.fromtimestamp(iv / 1000, tz=timezone.utc).year
            except (ValueError, OSError, OverflowError):
                return None
    else:
        s = str(v).strip()
        if len(s) < 4 or not s[:4].isdigit():
            return None
        y = int(s[:4])
    return y if 1850 <= y <= datetime.now(timezone.utc).year else None


def summarise(by_fips, cfg):
    out = {}
    z = bool(cfg.get("zero_is_unknown"))
    for f, rows in by_fips.items():
        depths = [d for d in (fnum(r.get(cfg["depth"]), z) for r in rows) if d is not None and 0 < d < 5000]
        levels = [d for d in (fnum(r.get(cfg["level"]), z) for r in rows) if d is not None and 0 < d < 3000] if cfg["level"] else []
        rates = [d for d in (fnum(r.get(cfg["rate"]), z) for r in rows) if d is not None and d > 0] if cfg["rate"] else []
        dec = {}
        for r in rows:
            y = year_of(r.get(cfg["date"]))
            if y:
                k = f"{y // 10 * 10}s"
                dec[k] = dec.get(k, 0) + 1
        out[f] = {"irrigation_wells": len(rows),
                  "depth_median_ft": round(statistics.median(depths), 1) if depths else None, "depth_n": len(depths),
                  "level_median_ft": round(statistics.median(levels), 1) if levels else None, "level_n": len(levels),
                  "by_decade": dict(sorted(dec.items()))}
        if cfg["rate"]:
            out[f]["rate_n"] = len(rates)
            out[f]["rated_100gpm"] = sum(1 for x in rates if x >= HICAP_GPM)
    return out


def value_counts(rows, key):
    c = {}
    for r in rows:
        v = str(r.get(key) if r.get(key) is not None else "null").strip()
        c[v] = c.get(v, 0) + 1
    return dict(sorted(c.items(), key=lambda kv: -kv[1])[:15])


def selftest():
    geo = {"features": [{"id": "27009", "properties": {"name": "Benton", "st": "MN"},
                         "geometry": {"type": "Polygon", "coordinates": [[[-94.4, 45.5], [-93.7, 45.5], [-93.7, 45.9], [-94.4, 45.9], [-94.4, 45.5]]]}}]}
    loc = CountyLocator(geo)
    cfg = dict(SOURCES["MN"])
    feats = [{"attributes": {"use_c": "IR", "depth_drll": 112.0, "swlavgmeas": 27.0, "date_drll": 19810508}, "geometry": {"x": -94.0, "y": 45.7}},
             {"attributes": {"use_c": "IR", "depth_drll": 170.0, "swlavgmeas": None, "date_drll": 20120301}, "geometry": {"x": -94.1, "y": 45.6}},
             {"attributes": {"use_c": "IR", "depth_drll": 0, "swlavgmeas": 5, "date_drll": None}, "geometry": {"x": -94.1, "y": 45.6}},
             {"attributes": {"use_c": "IR"}, "geometry": None},
             {"attributes": {"use_c": "IR"}, "geometry": {"x": -80.0, "y": 30.0}}]
    by, dropped = place(feats, loc)
    assert set(by) == {"27009"} and len(by["27009"]) == 3 and dropped == 2, (by, dropped)
    s = summarise(by, cfg)["27009"]
    assert s == {"irrigation_wells": 3, "depth_median_ft": 141.0, "depth_n": 2, "level_median_ft": 16.0, "level_n": 2,
                 "by_decade": {"1980s": 1, "2010s": 1}}, s
    az = summarise({"04021": [{"WELL_DEPTH": 0, "WATER_LEVEL": 0, "INSTALLED": None, "PUMPRATE": 0},
                              {"WELL_DEPTH": 600, "WATER_LEVEL": 250, "INSTALLED": 345168000000, "PUMPRATE": 1500}]}, SOURCES["AZ"])["04021"]
    assert az["depth_n"] == 1 and az["level_median_ft"] == 250.0 and az["rated_100gpm"] == 1 and az["by_decade"] == {"1980s": 1}, az
    assert year_of(1985) == 1985 and year_of(198505) == 1985 and year_of(0) is None
    assert year_of("2000-06-06") == 2000 and year_of(-530564400000) == 1953 and year_of(19810508) == 1981 and year_of("x") is None
    assert point_of({"rings": [[[-91.1, 46.4], [-91.0, 46.4], [-91.0, 46.5], [-91.1, 46.5]]]}) == (-91.05, 46.45)
    assert "IN ('Agricultural irrigation'" in SOURCES["WI"]["where"]
    log("selftest ok")


def place(feats, locator):
    by, dropped = {}, 0
    for ft in feats:
        p = point_of(ft.get("geometry"))
        f = locator.locate(p[0], p[1]) if p else None
        if f:
            by.setdefault(f, []).append(ft.get("attributes") or {})
        else:
            dropped += 1
    return by, dropped


def main():
    if "--selftest" in sys.argv:
        selftest()
        return
    limit = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else None
    only = set(sys.argv[sys.argv.index("--only") + 1].upper().split(",")) if "--only" in sys.argv else None
    geo = load_geometry()
    prev = {}
    if os.path.exists(OUT):
        try:
            with open(OUT, encoding="utf-8") as f:
                prev = json.load(f).get("states") or {}
        except (OSError, ValueError):
            prev = {}
    states, failed = {}, []
    for st, cfg in SOURCES.items():
        if only and st not in only:
            if st in prev:
                states[st] = prev[st]
            continue
        log(f"{st}: {cfg['register']}")
        try:
            feats = fetch_state(cfg, limit)
        except Exception as e:
            log(f"  {st}: FAILED ({str(e)[:200]}); keeping the last good pull" if st in prev else f"  {st}: FAILED ({str(e)[:200]})")
            failed.append(st)
            if st in prev:
                states[st] = prev[st]
            continue
        sgeo = {"features": [ft for ft in geo["features"] if ft["properties"]["st"] == st]}
        by, dropped = place(feats, CountyLocator(sgeo))
        rows = [ft.get("attributes") or {} for ft in feats]
        summ = summarise(by, cfg)
        log(f"  {len(feats):,} rows, {len(summ)} counties, {dropped:,} unplaced")
        if cfg["status"]:
            log(f"  {cfg['status']}: {value_counts(rows, cfg['status'])}")
        # a pull that places almost nothing is a broken query or a moved service, not a state with no wells
        if not limit and (len(feats) < 200 or len(summ) < 5):
            log(f"  {st}: only {len(feats)} rows in {len(summ)} counties; treated as a failed pull")
            failed.append(st)
            if st in prev:
                states[st] = prev[st]
            continue
        states[st] = {"register": cfg["register"], "url": cfg["url"].rsplit("/query", 1)[0], "where": cfg["where"],
                      "level_kind": cfg["level_kind"], "rows": len(feats), "unplaced": dropped,
                      "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                      "status_values": value_counts(rows, cfg["status"]) if cfg["status"] else None,
                      "counties": summ}
    if not states:
        sys.exit("no state register came back; nothing written")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"source": "State well registers: " + "; ".join(f"{s} {v['register']}" for s, v in sorted(states.items())),
                   "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                   "failed": failed, "hicap_gpm": HICAP_GPM, "states": states}, f, separators=(",", ":"))
    os.replace(tmp, OUT)
    log(f"wrote {OUT}: {', '.join(s + ' ' + str(len(v['counties'])) for s, v in sorted(states.items()))}; failed: {failed or 'none'}")


if __name__ == "__main__":
    main()
