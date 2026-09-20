#!/usr/bin/env python3
"""
fetch_atlas_climate.py — NOAA NCEI nClimDiv county precipitation and maximum
temperature -> data/atlas/raw/climate.json

SAME SOURCE AND FORMAT AS THE NIGHT-HEAT LAYER (fetch_atlas_heat.py)
  https://www.ncei.noaa.gov/pub/data/cirs/climdiv/
    climdiv-pcpncy-v1.0.0-YYYYMMDD   element 01, monthly precipitation, inches
    climdiv-tmaxcy-v1.0.0-YYYYMMDD   element 27, monthly mean of daily maximum, deg F
  Fixed width: cols 1-2 NCEI state code (NOT FIPS; the table is in
  fetch_atlas_heat.py), 3-5 county FIPS, 6-7 element, 8-11 year, then twelve
  7-character monthly values. Missing is -9.99 (precipitation) or -99.90 /
  -99.99 (temperature). Each file is about 40 MB.

WHAT IS KEPT, PER COUNTY AND YEAR (1991 on for rain, 1976 on for heat)
  pcp:  [annual total, April-September total, July+August total]; a total is
        written only when every month in it is present
  tmax: July mean of daily highs
  Nothing is smoothed or filled. These are county averages of NOAA's 5 km
  grid, not a station and not a field.

USAGE
  python scripts/fetch_atlas_climate.py --selftest
  python scripts/fetch_atlas_climate.py
  python scripts/fetch_atlas_climate.py --dir /path/with/both/files
"""

import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone

from fetch_atlas_heat import NCEI_STATE, USPS_TO_FIPS, BASE, UA, log

OUT = "data/atlas/raw/climate.json"
FIRST_PCP_YEAR = 1991
FIRST_TMAX_YEAR = 1976
ELEMENTS = {"pcpncy": "01", "tmaxcy": "27"}
MISSING_PCP = {"-9.99"}
MISSING_T = {"-99.90", "-99.99"}


def newest(listing, kind):
    names = re.findall(r"climdiv-%s-v1\.0\.0-(\d{8})" % kind, listing)
    return ("climdiv-%s-v1.0.0-" % kind + max(names)) if names else None


def months(line):
    return [line[11 + 7 * i: 18 + 7 * i].strip() for i in range(12)]


def fnum(raw, missing):
    if not raw or raw in missing:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def parse_pcp(lines):
    out, st = {}, {"rows": 0, "kept": 0, "bad": 0}
    for line in lines:
        if len(line) < 95:
            continue
        st["rows"] += 1
        usps = NCEI_STATE.get(line[0:2])
        if not usps or usps not in USPS_TO_FIPS:
            continue
        if line[5:7] != ELEMENTS["pcpncy"]:
            st["bad"] += 1
            continue
        try:
            year = int(line[7:11])
        except ValueError:
            st["bad"] += 1
            continue
        if year < FIRST_PCP_YEAR:
            continue
        m = [fnum(v, MISSING_PCP) for v in months(line)]
        ann = round(sum(m), 2) if all(v is not None for v in m) else None
        gs = round(sum(m[3:9]), 2) if all(v is not None for v in m[3:9]) else None
        ja = round(m[6] + m[7], 2) if m[6] is not None and m[7] is not None else None
        if ann is None and gs is None and ja is None:
            continue
        out.setdefault(USPS_TO_FIPS[usps] + line[2:5], {})[year] = [ann, gs, ja]
        st["kept"] += 1
    return out, st


def parse_tmax(lines):
    out, st = {}, {"rows": 0, "kept": 0, "bad": 0}
    for line in lines:
        if len(line) < 95:
            continue
        st["rows"] += 1
        usps = NCEI_STATE.get(line[0:2])
        if not usps or usps not in USPS_TO_FIPS:
            continue
        if line[5:7] != ELEMENTS["tmaxcy"]:
            st["bad"] += 1
            continue
        try:
            year = int(line[7:11])
        except ValueError:
            st["bad"] += 1
            continue
        if year < FIRST_TMAX_YEAR:
            continue
        jul = fnum(months(line)[6], MISSING_T)
        if jul is None:
            continue
        out.setdefault(USPS_TO_FIPS[usps] + line[2:5], {})[year] = round(jul, 2)
        st["kept"] += 1
    return out, st


def complete_year(by_county, pick, share=0.9):
    """Newest year with a value for at least `share` of counties."""
    n = {}
    for rec in by_county.values():
        for y, v in rec.items():
            if pick(v) is not None:
                n[y] = n.get(y, 0) + 1
    ok = [y for y, c in n.items() if c >= share * len(by_county)]
    return max(ok) if ok else None


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.read()


def selftest():
    def row(code, el, year, vals):
        return code + el + str(year) + "".join(f"{v:7.2f}" for v in vals)
    # Iowa (NCEI 13) Story 169
    p1 = row("13169", "01", 2024, [1, 1, 2, 3, 4, 5, 4, 4, 3, 2, 1, 1])
    p2 = row("13169", "01", 2025, [1, 1, 2, 3, 4, 5, 4, 4, -9.99, -9.99, -9.99, -9.99])
    p3 = row("13169", "01", 1980, [1] * 12)                  # before 1991: dropped
    p4 = row("13169", "27", 2024, [90] * 12)                 # a tmax row in the pcp file: bad
    assert len(p1) == 95
    out, st = parse_pcp([p1, p2, p3, p4])
    assert out == {"19169": {2024: [31.0, 23.0, 8.0], 2025: [None, None, 8.0]}}, out
    assert st["bad"] == 1 and st["kept"] == 2, st
    t1 = row("41117", "27", 2024, [50, 55, 60, 70, 80, 90, 93.4, 92, 85, 75, 60, 50])
    t2 = row("41117", "27", 2025, [50, 55, 60, 70, 80, 90, -99.99, -99.99, -99.99, -99.99, -99.99, -99.99])
    tout, tst = parse_tmax([t1, t2])
    assert tout == {"48117": {2024: 93.4}}, tout
    assert complete_year(out, lambda v: v[1]) == 2024
    assert newest('climdiv-pcpncy-v1.0.0-20260807 climdiv-pcpncy-v1.0.0-20260904 climdiv-norm-pcpncy-v1.0.0-20260904', "pcpncy") == "climdiv-pcpncy-v1.0.0-20260904"
    log("selftest ok")


def main():
    if "--selftest" in sys.argv:
        selftest()
        return
    texts, names = {}, {}
    if "--dir" in sys.argv:
        d = sys.argv[sys.argv.index("--dir") + 1]
        for kind in ELEMENTS:
            hit = sorted(f for f in os.listdir(d) if f.startswith(f"climdiv-{kind}-"))
            if not hit:
                sys.exit(f"no climdiv-{kind} file in {d}")
            names[kind] = hit[-1]
            with open(os.path.join(d, hit[-1]), encoding="ascii", errors="replace") as f:
                texts[kind] = f.read()
    else:
        listing = fetch(BASE).decode("utf-8", "replace")
        for kind in ELEMENTS:
            names[kind] = newest(listing, kind)
            if not names[kind]:
                sys.exit(f"no climdiv-{kind} file in the NCEI listing; the directory layout changed")
            log(f"downloading {BASE}{names[kind]}")
            texts[kind] = fetch(BASE + names[kind]).decode("ascii", "replace")
    pcp, pst = parse_pcp(texts["pcpncy"].splitlines())
    tmax, tst = parse_tmax(texts["tmaxcy"].splitlines())
    if len(pcp) < 3000 or len(tmax) < 3000:
        sys.exit(f"parsed {len(pcp)} precipitation and {len(tmax)} temperature counties: too few; nothing written ({pst}, {tst})")
    gs_latest = complete_year(pcp, lambda v: v[1])
    ann_latest = complete_year(pcp, lambda v: v[0])
    tmax_latest = complete_year(tmax, lambda v: v)
    log(f"precipitation: {pst}, {len(pcp)} counties, latest complete Apr-Sep {gs_latest}, calendar year {ann_latest}")
    log(f"July highs: {tst}, {len(tmax)} counties, latest complete July {tmax_latest}")
    counties = {}
    for f in set(pcp) | set(tmax):
        counties[f] = {"pcp": {str(y): v for y, v in sorted((pcp.get(f) or {}).items())},
                       "tmax_jul": {str(y): v for y, v in sorted((tmax.get(f) or {}).items())}}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump({"source": "NOAA NCEI nClimDiv county monthly precipitation (climdiv-pcpncy) and maximum temperature (climdiv-tmaxcy)",
                   "files": names, "urls": [BASE + n for n in names.values()],
                   "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                   "pcp_fields": ["annual_in", "apr_sep_in", "jul_aug_in"],
                   "gs_latest_year": gs_latest, "annual_latest_year": ann_latest, "tmax_latest_year": tmax_latest,
                   "parse_stats": {"pcp": pst, "tmax": tst}, "counties": counties}, f, separators=(",", ":"))
    os.replace(tmp, OUT)
    log(f"wrote {OUT}: {len(counties)} counties")


if __name__ == "__main__":
    main()
