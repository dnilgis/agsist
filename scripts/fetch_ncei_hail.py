#!/usr/bin/env python3
"""
AGSIST NCEI hail backfill — builds the 70-year record.

Downloads NOAA NCEI Storm Events yearly CSVs (1955 -> CUTOFF_YEAR), keeps
hail events, and bins them into 1-degree spatial tiles the map can fetch
per-lookup, plus a national per-year count series.

Outputs (all static, cache-friendly, crawler-safe):
  data/hail/ncei/tiles/{floor_lat}_{floor_lon}.json
      compact: {"e":[[yyyymmdd, mag_x100, lat_x10000, lon_x10000, loc], ...]}
      loc: "p" = reported point, "c" = county-level / approximate
  data/hail/ncei/years.json      {"1955": n, ..., "<cutoff>": n}
  data/hail/ncei/index.json      {years:[first,last], events:N, built:date,
                                  tiles:N, cutoff:<cutoff>, source:"..."}

Honesty rules baked in:
  * CUTOFF_YEAR = 2020: the live map's 5-year NWS LSR window covers recent
    years; the long-term record stops where the live record starts, so the
    two counts are never mixed or double-counted.
  * Events without coordinates get the county's approximate location only if
    NCEI provides one; they are tagged "c" and the UI says "location
    approximate". Events with no location at all still count in years.json
    (national totals) but cannot be placed on the map -- stated in index.

Run in GitHub Actions (full egress). First run downloads ~66 year files
(~400MB compressed transfer, minutes); output is ~10-20MB of tiles.
Schema is validated by header NAME, not position -- if NCEI ever changes
column names this fails loudly instead of writing garbage.
"""
import csv
import gzip
import io
import json
import math
import os
import re
import sys
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "data" / "hail" / "ncei"
BASE = "https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/"
FIRST_YEAR = 1955
CUTOFF_YEAR = int(os.environ.get("NCEI_CUTOFF", "2020"))
LIMIT_YEARS = os.environ.get("NCEI_LIMIT")          # e.g. "3" for a smoke test
REQUIRED_COLS = {"EVENT_TYPE", "MAGNITUDE", "BEGIN_LAT", "BEGIN_LON",
                 "BEGIN_YEARMONTH", "BEGIN_DAY", "STATE", "CZ_NAME"}
CONUS = (24.0, 50.0, -125.0, -66.0)


def http(url):
    req = urllib.request.Request(url, headers={"User-Agent": "AGSIST backfill (sig@farmers1st.com)"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.read()


def year_files():
    """The directory embeds a creation stamp in each filename; scrape the
    listing to find the current file for every year."""
    listing = http(BASE).decode("utf-8", "replace")
    names = re.findall(r'StormEvents_details-ftp_v1\.0_d(\d{4})_c\d{8}\.csv\.gz', listing)
    files = {}
    for m in re.finditer(r'(StormEvents_details-ftp_v1\.0_d(\d{4})_c\d{8}\.csv\.gz)', listing):
        files[int(m.group(2))] = m.group(1)       # last listed wins (newest stamp)
    return files


def parse_year(blob, year):
    """Yield (yyyymmdd, mag_in, lat, lon, loc) hail rows; None coords allowed."""
    text = gzip.decompress(blob).decode("utf-8", "replace")
    rdr = csv.DictReader(io.StringIO(text))
    missing = REQUIRED_COLS - set(rdr.fieldnames or [])
    if missing:
        raise RuntimeError(f"{year}: NCEI schema changed — missing columns {missing}")
    for row in rdr:
        if (row.get("EVENT_TYPE") or "").strip().lower() != "hail":
            continue
        try:
            ym = int(row["BEGIN_YEARMONTH"])
            day = int(row["BEGIN_DAY"])
            ymd = ym * 100 + day
        except (ValueError, TypeError):
            continue
        try:
            mag = float(row.get("MAGNITUDE") or 0)
        except ValueError:
            mag = 0.0
        if mag <= 0 or mag > 8:                    # 8"+ = data error, not hail
            continue
        lat = lon = None
        try:
            lat = float(row["BEGIN_LAT"])
            lon = float(row["BEGIN_LON"])
        except (ValueError, TypeError):
            pass
        loc = "p"
        if lat is None or lon is None or not (CONUS[0] <= lat <= CONUS[1] and CONUS[2] <= lon <= CONUS[3]):
            lat = lon = None                       # counted nationally, unplaceable
        yield ymd, mag, lat, lon, loc


def main():
    files = year_files()
    years = [y for y in sorted(files) if FIRST_YEAR <= y <= CUTOFF_YEAR]
    if LIMIT_YEARS:
        years = years[: int(LIMIT_YEARS)]
    if not years:
        print("FATAL: no year files found in NCEI listing")
        return 1
    print(f"years {years[0]}–{years[-1]} ({len(years)} files)")

    tiles = defaultdict(list)
    year_counts = defaultdict(int)
    placed = unplaced = 0
    for y in years:
        blob = http(BASE + files[y])
        n = 0
        for ymd, mag, lat, lon, loc in parse_year(blob, y):
            year_counts[str(y)] += 1
            n += 1
            if lat is None:
                unplaced += 1
                continue
            placed += 1
            key = f"{math.floor(lat)}_{math.floor(lon)}"
            tiles[key].append([ymd, round(mag * 100), round(lat * 10000), round(lon * 10000), loc])
        print(f"  {y}: {n} hail events")

    tdir = OUT / "tiles"
    tdir.mkdir(parents=True, exist_ok=True)
    for key, evs in tiles.items():
        evs.sort()
        json.dump({"e": evs}, open(tdir / (key + ".json"), "w"), separators=(",", ":"))
    json.dump(dict(sorted(year_counts.items())), open(OUT / "years.json", "w"), separators=(",", ":"))
    json.dump({
        "years": [years[0], years[-1]], "cutoff": CUTOFF_YEAR,
        "events": placed + unplaced, "placed": placed, "unplaced": unplaced,
        "tiles": len(tiles),
        "built": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "source": "NOAA NCEI Storm Events Database (hail events, magnitude in inches)",
    }, open(OUT / "index.json", "w"), separators=(",", ":"))
    print(f"tiles: {len(tiles)} · placed {placed:,} · national-only {unplaced:,}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
