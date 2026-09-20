#!/usr/bin/env python3
"""
fetch_atlas_storms.py — hail, severe wind and tornado reports by county, from
NOAA NCEI Storm Events -> data/atlas/raw/storms.json

SOURCE
  https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/
  StormEvents_details-ftp_v1.0_dYYYY_cYYYYMMDD.csv.gz, one per year; the
  listing is read for the newest stamp of each year (same as
  fetch_ncei_hail.py, which the runner already reaches). Columns are checked
  by name: STATE_FIPS, CZ_TYPE, CZ_FIPS, EVENT_TYPE, MAGNITUDE,
  BEGIN_YEARMONTH, BEGIN_DAY.

WHAT IS COUNTED, PER COUNTY AND YEAR (2010 on)
  hail days at 1.00 inch or more   (a day with at least one report)
  hail days at 2.00 inches or more
  severe wind days: Thunderstorm Wind at 50 knots (58 mph) or more
  tornado segments that touched the county
  Only rows filed against a county (CZ_TYPE "C") count. Wind filed against a
  forecast zone ("Z") cannot be tied to a county and is counted separately in
  the log, never guessed into one.

WHY 2010
  In January 2010 the National Weather Service raised the severe hail line
  from 0.75 to 1.00 inch. Counting from 2010 keeps one rule for every year.

WHAT A COUNT IS NOT
  A report is where someone saw and reported the storm. Counties with more
  people and more spotters report more. A zero is "no report", not "no hail".

USAGE
  python scripts/fetch_atlas_storms.py --selftest
  python scripts/fetch_atlas_storms.py
"""

import csv
import gzip
import io
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone

from build_farmland_atlas import ATLAS_STATE_FIPS, fold

BASE = "https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/"
OUT = "data/atlas/raw/storms.json"
FIRST_YEAR = 2010
UA = "AGSIST-automation/1.0 (+https://agsist.com/farmland-atlas)"
REQUIRED = {"STATE_FIPS", "CZ_TYPE", "CZ_FIPS", "EVENT_TYPE", "MAGNITUDE", "BEGIN_YEARMONTH", "BEGIN_DAY"}
HAIL_1, HAIL_2, WIND_KT = 1.0, 2.0, 50.0


def log(*a):
    print(*a, flush=True)


def http(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.read()


def year_files(listing):
    files = {}
    for m in re.finditer(r"(StormEvents_details-ftp_v1\.0_d(\d{4})_c(\d{8})\.csv\.gz)", listing):
        y, stamp = int(m.group(2)), m.group(3)
        if y not in files or stamp > files[y][1]:
            files[y] = (m.group(1), stamp)
    return {y: v[0] for y, v in files.items()}


def count_year(text):
    """-> ({fips: [hail1_days, hail2_days, wind_days, tornadoes]}, stats, months_seen)"""
    rdr = csv.DictReader(io.StringIO(text))
    missing = REQUIRED - set(rdr.fieldnames or [])
    if missing:
        raise RuntimeError(f"NCEI Storm Events columns changed: missing {sorted(missing)}")
    h1, h2, wd, tor = {}, {}, {}, {}
    st = {"rows": 0, "zone_wind": 0, "zone_hail": 0, "off_atlas": 0}
    months = set()
    for r in rdr:
        st["rows"] += 1
        ev = (r.get("EVENT_TYPE") or "").strip().lower()
        if ev not in ("hail", "thunderstorm wind", "tornado"):
            continue
        try:
            ym = int(r["BEGIN_YEARMONTH"])
            day = int(r["BEGIN_DAY"])
        except (TypeError, ValueError):
            continue
        months.add(ym % 100)
        if (r.get("CZ_TYPE") or "").strip().upper() != "C":
            if ev == "thunderstorm wind":
                st["zone_wind"] += 1
            elif ev == "hail":
                st["zone_hail"] += 1
            continue
        try:
            # an old code (Shannon SD 46113 before 2015) lands on today's county, and its
            # report days merge with the county's own (a day is a day, never counted twice)
            fips = fold(f"{int(r['STATE_FIPS']):02d}{int(r['CZ_FIPS']):03d}")
        except (TypeError, ValueError):
            continue
        if fips[:2] not in ATLAS_STATE_FIPS:
            st["off_atlas"] += 1
            continue
        try:
            mag = float(r.get("MAGNITUDE") or 0)
        except ValueError:
            mag = 0.0
        date = ym * 100 + day
        if ev == "hail" and 0 < mag <= 8:
            if mag >= HAIL_1:
                h1.setdefault(fips, set()).add(date)
            if mag >= HAIL_2:
                h2.setdefault(fips, set()).add(date)
        elif ev == "thunderstorm wind" and mag >= WIND_KT:
            wd.setdefault(fips, set()).add(date)
        elif ev == "tornado":
            tor[fips] = tor.get(fips, 0) + 1
    out = {}
    for f in set(h1) | set(h2) | set(wd) | set(tor):
        out[f] = [len(h1.get(f, ())), len(h2.get(f, ())), len(wd.get(f, ())), tor.get(f, 0)]
    return out, st, months


def selftest():
    hdr = "BEGIN_YEARMONTH,BEGIN_DAY,STATE_FIPS,CZ_TYPE,CZ_FIPS,EVENT_TYPE,MAGNITUDE\n"
    rows = [
        "202406,1,19,C,169,Hail,1.00",       # Story IA: hail day
        "202406,1,19,C,169,Hail,2.50",       # same day, bigger: still one 1" day, one 2" day
        "202406,9,19,C,169,Hail,0.75",       # under 1": not counted
        "202407,3,19,C,169,Thunderstorm Wind,52",
        "202407,3,19,C,169,Thunderstorm Wind,45",
        "202407,4,19,Z,169,Thunderstorm Wind,70",   # zone: not a county
        "202405,20,19,C,169,Tornado,",
        "202405,20,72,C,1,Hail,1.5",         # Puerto Rico: not an Atlas state
        "202405,20,19,C,1,Hail,9.0",         # 9" is an error
        "202405,20,19,C,1,Flood,",
    ]
    out, st, months = count_year(hdr + "\n".join(rows) + "\n")
    assert out == {"19169": [1, 1, 1, 1]}, out
    sh, _, _ = count_year(hdr + "201206,1,46,C,113,Hail,1.25\n201206,1,46,C,102,Hail,1.00\n201207,2,46,C,113,Hail,1.00\n")
    assert sh == {"46102": [2, 0, 0, 0]}, sh
    assert st["zone_wind"] == 1 and st["off_atlas"] == 1, st
    assert months == {5, 6, 7}
    try:
        count_year("A,B\n1,2\n")
        raise AssertionError("a changed header must stop the run")
    except RuntimeError:
        pass
    lst = ("StormEvents_details-ftp_v1.0_d2024_c20250401.csv.gz StormEvents_details-ftp_v1.0_d2024_c20250818.csv.gz "
           "StormEvents_fatalities-ftp_v1.0_d2024_c20250818.csv.gz")
    assert year_files(lst) == {2024: "StormEvents_details-ftp_v1.0_d2024_c20250818.csv.gz"}
    log("selftest ok")


def main():
    if "--selftest" in sys.argv:
        selftest()
        return
    files = year_files(http(BASE).decode("utf-8", "replace"))
    this_year = datetime.now(timezone.utc).year
    years = [y for y in sorted(files) if FIRST_YEAR <= y < this_year]
    if len(years) < 10:
        sys.exit(f"only {len(years)} Storm Events year files from {FIRST_YEAR}; the listing changed; nothing written")
    counties, stats, complete = {}, {}, []
    for y in years:
        text = gzip.decompress(http(BASE + files[y])).decode("utf-8", "replace")
        out, st, months = count_year(text)
        stats[str(y)] = st
        full = months >= set(range(1, 13))
        if full:
            complete.append(y)
        log(f"  {y}: {st['rows']:,} rows, {len(out)} counties with a report, months {len(months)}{'' if full else ' (INCOMPLETE: left out)'}")
        if not full:
            continue
        for f, v in out.items():
            counties.setdefault(f, {})[str(y)] = v
    if len(complete) < 10:
        sys.exit(f"only {len(complete)} complete years; nothing written")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump({"source": "NOAA NCEI Storm Events Database, details files (county-coded hail, thunderstorm wind, tornado)",
                   "url": BASE, "files": {str(y): files[y] for y in complete},
                   "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                   "years": complete, "fields": ["hail_1in_days", "hail_2in_days", "wind_58mph_days", "tornado_segments"],
                   "absent_means_none_reported": True, "stats": stats, "counties": counties}, fh, separators=(",", ":"))
    os.replace(tmp, OUT)
    log(f"wrote {OUT}: {len(counties)} counties with a report, {complete[0]}-{complete[-1]}")


if __name__ == "__main__":
    main()
