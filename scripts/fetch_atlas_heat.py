#!/usr/bin/env python3
"""
fetch_atlas_heat.py — NOAA NCEI nClimDiv county minimum temperature -> data/atlas/raw/heat.json

WHAT THIS IS
  NCEI publishes a monthly mean of the daily minimum temperature for every
  county in the lower 48, every month since January 1895, in one fixed-width
  file: climdiv-tmincy-v1.0.0-YYYYMMDD under
  https://www.ncei.noaa.gov/pub/data/cirs/climdiv/. It is refreshed monthly
  and the file name carries the build date. This script finds the newest,
  downloads it (about 40 MB), keeps July and August for the Atlas states and
  writes them out. Nothing is interpolated.

FORMAT (county-readme.txt, verified 2026-09-13)
  cols 1-2   state code (NCEI's own numbering, NOT FIPS; table below)
  cols 3-5   county FIPS
  cols 6-7   element code; 28 = minimum temperature, degrees F
  cols 8-11  year
  then twelve 7-character monthly values, Jan..Dec, i.e. July = cols 54-60,
  August = cols 61-67. Missing = -99.90 or -99.99.

THE STATE CODE IS THE TRAP
  NCEI numbers the 48 contiguous states alphabetically (01 Alabama ... 48
  Wyoming) and adds 49 Hawaii and 50 Alaska. Nothing above 50 is assigned and
  there is no Puerto Rico in this file. Iowa is 13 in this file and 19 in
  FIPS. The table below is copied from county-readme.txt and the selftest pins
  Iowa, Kansas and Texas.

USAGE
  python scripts/fetch_atlas_heat.py --selftest
  python scripts/fetch_atlas_heat.py
  python scripts/fetch_atlas_heat.py --file /path/to/climdiv-tmincy-v1.0.0-20260707
"""

import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone

from build_farmland_atlas import ATLAS_STATE_FIPS

BASE = "https://www.ncei.noaa.gov/pub/data/cirs/climdiv/"
OUT = "data/atlas/raw/heat.json"
UA = "AGSIST-automation/1.0 (+https://agsist.com/farmland-atlas)"

# NCEI climdiv state code -> USPS, from county-readme.txt
NCEI_STATE = {
    "01": "AL", "02": "AZ", "03": "AR", "04": "CA", "05": "CO", "06": "CT", "07": "DE", "08": "FL",
    "09": "GA", "10": "ID", "11": "IL", "12": "IN", "13": "IA", "14": "KS", "15": "KY", "16": "LA",
    "17": "ME", "18": "MD", "19": "MA", "20": "MI", "21": "MN", "22": "MS", "23": "MO", "24": "MT",
    "25": "NE", "26": "NV", "27": "NH", "28": "NJ", "29": "NM", "30": "NY", "31": "NC", "32": "ND",
    "33": "OH", "34": "OK", "35": "OR", "36": "PA", "37": "RI", "38": "SC", "39": "SD", "40": "TN",
    "41": "TX", "42": "UT", "43": "VT", "44": "VA", "45": "WA", "46": "WV", "47": "WI", "48": "WY",
    "49": "HI", "50": "AK",
}
USPS_TO_FIPS = {v: k for k, v in ATLAS_STATE_FIPS.items()}
ELEMENT_TMIN = "28"
MISSING = {"-99.90", "-99.99"}


def log(*a):
    print(*a, flush=True)


def newest_file_name(listing_html):
    names = re.findall(r"climdiv-tmincy-v1\.0\.0-(\d{8})", listing_html)
    if not names:
        return None
    return "climdiv-tmincy-v1.0.0-" + max(names)


def parse(lines, states=None):
    """lines: iterable of str. Returns ({fips: {"jul": {year: F}, "aug": {...}}}, stats)."""
    want = set(states or ATLAS_STATE_FIPS.values())
    out = {}
    n_rows = 0
    n_kept = 0
    bad = 0
    for line in lines:
        if len(line) < 67:
            continue
        n_rows += 1
        st = NCEI_STATE.get(line[0:2])
        if st is None or st not in want:
            continue
        if line[5:7] != ELEMENT_TMIN:
            bad += 1
            continue
        fips = USPS_TO_FIPS[st] + line[2:5]
        try:
            year = int(line[7:11])
        except ValueError:
            bad += 1
            continue
        jul = line[53:60].strip()
        aug = line[60:67].strip()
        rec = out.setdefault(fips, {"jul": {}, "aug": {}})
        for key, raw in (("jul", jul), ("aug", aug)):
            if raw in MISSING or not raw:
                continue
            try:
                rec[key][year] = round(float(raw), 2)
            except ValueError:
                bad += 1
        n_kept += 1
    return out, {"rows": n_rows, "kept_rows": n_kept, "bad_rows": bad}


def latest_complete_year(counties, month="jul", share=0.9):
    """The newest year in which at least `share` of counties have a July value."""
    if not counties:
        return None
    years = {}
    for rec in counties.values():
        for y in rec[month]:
            years[y] = years.get(y, 0) + 1
    n = len(counties)
    ok = [y for y, c in years.items() if c >= share * n]
    return max(ok) if ok else None


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.read()


def selftest():
    # Iowa (NCEI 13) Story County 169, tmin, 2024: July 64.30 Aug 61.00; 2025 July missing
    row1 = "1316928" + "2024" + "".join(f"{v:7.2f}" for v in [10, 20, 30, 40, 50, 60, 64.30, 61.00, 50, 40, 30, 20])
    row2 = "1316928" + "2025" + "".join(f"{v:7.2f}" for v in [10, 20, 30, 40, 50, 60, -99.99, -99.99, -99.99, -99.99, -99.99, -99.99])
    # Kansas (NCEI 14) Sedgwick 173: 2024 July 71.5
    row3 = "1417328" + "2024" + "".join(f"{v:7.2f}" for v in [10, 20, 30, 40, 50, 60, 71.50, 70.10, 50, 40, 30, 20])
    # Texas (NCEI 41) Deaf Smith 117
    row4 = "4111728" + "2024" + "".join(f"{v:7.2f}" for v in [10, 20, 30, 40, 50, 60, 66.00, 65.00, 50, 40, 30, 20])
    # A state code the file does not use: parse() must drop a row it cannot
    # name. NCEI's county scheme runs 01-48 plus 49 Hawaii and 50 Alaska and
    # assigns nothing above that, so 51 is not a state here and never will be
    # one in the Atlas. It cannot be Puerto Rico -- nClimDiv has no Puerto
    # Rico code at all -- and it cannot be a real NCEI code either, because
    # all 50 states are Atlas states now.
    row5 = "5100128" + "2024" + "".join(f"{v:7.2f}" for v in [10] * 12)
    # a tmax row (27) for Iowa must be dropped
    row6 = "1316927" + "2024" + "".join(f"{v:7.2f}" for v in [90] * 12)
    assert len(row1) == 95, len(row1)
    out, st = parse([row1, row2, row3, row4, row5, row6])
    assert set(out) == {"19169", "20173", "48117"}, out.keys()
    assert not any(f.startswith("51") for f in out), out.keys()
    assert out["19169"]["jul"] == {2024: 64.3} and out["19169"]["aug"] == {2024: 61.0}, out["19169"]
    assert 2025 not in out["19169"]["jul"]
    assert out["20173"]["jul"][2024] == 71.5 and out["48117"]["aug"][2024] == 65.0
    assert st["kept_rows"] == 4 and st["bad_rows"] == 1, st
    assert latest_complete_year(out) == 2024
    assert newest_file_name('<a href="climdiv-tmincy-v1.0.0-20260607">x</a> <a href="climdiv-tmincy-v1.0.0-20260707">y</a> climdiv-norm-tmincy-v1.0.0-20260707') == "climdiv-tmincy-v1.0.0-20260707"
    # positions: July is cols 54-60 (1-based) => slice [53:60]
    assert row1[53:60].strip() == "64.30"
    log("selftest ok")


def main():
    if "--selftest" in sys.argv:
        selftest()
        return
    if "--file" in sys.argv:
        path = sys.argv[sys.argv.index("--file") + 1]
        name = os.path.basename(path)
        with open(path, encoding="ascii", errors="replace") as f:
            text = f.read()
    else:
        listing = fetch(BASE).decode("utf-8", "replace")
        name = newest_file_name(listing)
        if not name:
            sys.exit("no climdiv-tmincy file in the NCEI listing; the directory layout changed")
        log(f"downloading {BASE}{name}")
        text = fetch(BASE + name).decode("ascii", "replace")
    counties, st = parse(text.splitlines())
    if not counties:
        sys.exit(f"parsed zero Atlas counties from {name}: {st}")
    latest = latest_complete_year(counties)
    log(f"{name}: {st}, {len(counties)} counties, latest complete July {latest}")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"source": "NOAA NCEI nClimDiv county monthly minimum temperature",
                   "file": name, "url": BASE + name,
                   "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                   "latest_year": latest, "units": "degrees F, monthly mean of daily minimum",
                   "parse_stats": st, "counties": counties}, f, separators=(",", ":"))
    log(f"wrote {OUT}")


if __name__ == "__main__":
    main()
