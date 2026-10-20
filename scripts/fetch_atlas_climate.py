#!/usr/bin/env python3
"""
fetch_atlas_climate.py — NOAA NCEI nClimDiv county precipitation and maximum
temperature -> data/atlas/raw/climate.json, plus every single month of
precipitation and mean daily high and low -> data/atlas/raw/climate_monthly.json.gz

SAME SOURCE AND FORMAT AS THE NIGHT-HEAT LAYER (fetch_atlas_heat.py)
  https://www.ncei.noaa.gov/pub/data/cirs/climdiv/
    climdiv-pcpncy-v1.0.0-YYYYMMDD   element 01, monthly precipitation, inches
    climdiv-tmaxcy-v1.0.0-YYYYMMDD   element 27, monthly mean of daily maximum, deg F
    climdiv-tmincy-v1.0.0-YYYYMMDD   element 28, monthly mean of daily minimum, deg F
                                     (monthly file only; heat.json has its own pull)
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

THE SINGLE MONTHS -- 2026-10-20. climate.json keeps three totals and July,
  and the files hold all twelve months; the parser threw the rest away, so
  July and September could not be split for any test. climate_monthly.json.gz
  keeps them: per county, "pcp" (inches, 1991 on), "tmax" and "tmin" (deg F,
  1976 on), each {year: [Jan..Dec]}, null where NCEI marks a month missing.
  It lives on the raw branch only (data/atlas/raw is in .gitignore; about
  35 MB as JSON, so it is gzipped). No page and no build reads it: it is for
  analysis. climate.json is written exactly as before, first, and a failure
  on the monthly side never stops it. Before the monthly file is written its
  April-September sums are checked against climate.json's, county by county,
  so the two files cannot read different columns. tmincy is optional: if it
  does not come down, the monthly file is written without "tmin" and says so.

USAGE
  python scripts/fetch_atlas_climate.py --selftest
  python scripts/fetch_atlas_climate.py
  python scripts/fetch_atlas_climate.py --dir /path/with/the/files
      (pcpncy and tmaxcy required; tmincy used when it is there)
"""

import gzip
import json
import os
import tempfile
import re
import sys
import urllib.request
from datetime import datetime, timezone

from fetch_atlas_heat import NCEI_STATE, USPS_TO_FIPS, BASE, UA, log

OUT = "data/atlas/raw/climate.json"
OUT_MONTHLY = "data/atlas/raw/climate_monthly.json.gz"
FIRST_PCP_YEAR = 1991
FIRST_TMAX_YEAR = 1976
ELEMENTS = {"pcpncy": "01", "tmaxcy": "27"}
MISSING_PCP = {"-9.99"}
MISSING_T = {"-99.90", "-99.99"}
# kind -> (element, first year, missing markers, key in the monthly file)
MONTHLY = {"pcpncy": ("01", FIRST_PCP_YEAR, MISSING_PCP, "pcp"),
           "tmaxcy": ("27", FIRST_TMAX_YEAR, MISSING_T, "tmax"),
           "tmincy": ("28", FIRST_TMAX_YEAR, MISSING_T, "tmin")}


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


def parse_monthly(lines, kind):
    """Every month of every kept year: ({fips: {year: [12 values or None]}}, stats).
    Same row tests as parse_pcp / parse_tmax; a year with no month present is dropped."""
    element, first, missing, _ = MONTHLY[kind]
    out, st = {}, {"rows": 0, "kept": 0, "bad": 0}
    for line in lines:
        if len(line) < 95:
            continue
        st["rows"] += 1
        usps = NCEI_STATE.get(line[0:2])
        if not usps or usps not in USPS_TO_FIPS:
            continue
        if line[5:7] != element:
            st["bad"] += 1
            continue
        try:
            year = int(line[7:11])
        except ValueError:
            st["bad"] += 1
            continue
        if year < first:
            continue
        m = [fnum(v, missing) for v in months(line)]
        if all(v is None for v in m):
            continue
        out.setdefault(USPS_TO_FIPS[usps] + line[2:5], {})[year] = [None if v is None else round(v, 2) for v in m]
        st["kept"] += 1
    return out, st


def latest_month(by_county, share=0.9):
    """Newest (year, month 1-12) present for at least `share` of counties."""
    n = {}
    for rec in by_county.values():
        for y, vals in rec.items():
            for i, v in enumerate(vals):
                if v is not None:
                    n[(y, i + 1)] = n.get((y, i + 1), 0) + 1
    ok = [k for k, c in n.items() if c >= share * len(by_county)]
    return list(max(ok)) if ok else None


def check_against(monthly_pcp, pcp):
    """County-years where the monthly April-September sum differs from climate.json's."""
    bad = []
    for f, rec in pcp.items():
        for y, v in rec.items():
            gs = v[1]
            m = (monthly_pcp.get(f) or {}).get(y)
            if gs is None:
                continue
            if m is None or any(x is None for x in m[3:9]) or round(sum(m[3:9]), 2) != gs:
                bad.append((f, y))
    return bad


def write_monthly(path, parsed, names, stats):
    counties = {}
    for key in ("pcp", "tmax", "tmin"):
        for f, rec in (parsed.get(key) or {}).items():
            counties.setdefault(f, {})[key] = {str(y): v for y, v in sorted(rec.items())}
    doc = {"source": "NOAA NCEI nClimDiv county monthly files (climdiv-pcpncy, climdiv-tmaxcy, climdiv-tmincy)",
           "files": names, "urls": [BASE + n for n in names.values()],
           "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "units": {"pcp": "inches, monthly total", "tmax": "deg F, monthly mean of daily maximum",
                     "tmin": "deg F, monthly mean of daily minimum"},
           "layout": "counties[fips][pcp|tmax|tmin][year] = [Jan..Dec], null = missing in the NCEI file",
           "first_year": {k: MONTHLY[kind][1] for kind, (_, _, _, k) in MONTHLY.items()},
           "elements": sorted(k for k in ("pcp", "tmax", "tmin") if parsed.get(k)),
           "latest_month": {k: latest_month(v) for k, v in parsed.items() if v},
           "parse_stats": stats, "counties": counties}
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    # mtime=0: no clock in the gzip header; the fetch time is in the document
    with open(tmp, "wb") as raw, gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0, compresslevel=9) as gz:
        gz.write(json.dumps(doc, separators=(",", ":")).encode("utf-8"))
    os.replace(tmp, path)
    return len(counties)


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
    assert newest('climdiv-tmincy-v1.0.0-20260904 climdiv-norm-tmincy-v1.0.0-20260904', "tmincy") == "climdiv-tmincy-v1.0.0-20260904"

    # Single months. No real climdiv line can be reached from the sandbox and
    # none is saved on the raw or references branch, so these rows are built
    # to NCEI's documented layout (county-readme.txt): state 2, county 3,
    # element 2, year 4, then twelve F7.2 values, 95 characters.
    mout, mst = parse_monthly([p1, p2, p3, p4], "pcpncy")
    assert mout == {"19169": {2024: [1.0, 1.0, 2.0, 3.0, 4.0, 5.0, 4.0, 4.0, 3.0, 2.0, 1.0, 1.0],
                              2025: [1.0, 1.0, 2.0, 3.0, 4.0, 5.0, 4.0, 4.0, None, None, None, None]}}, mout
    assert mst == {"rows": 4, "kept": 2, "bad": 1}, mst
    # July and September apart: the point of the file
    assert mout["19169"][2024][6] == 4.0 and mout["19169"][2024][8] == 3.0
    # an odd value lands in its own month, not a neighbour's
    p5 = row("13169", "01", 2023, [0.11, 0.22, 0.33, 0.44, 0.55, 0.66, 7.77, 0.88, 9.99, 1.01, 1.12, 1.23])
    assert parse_monthly([p5], "pcpncy")[0]["19169"][2023] == [0.11, 0.22, 0.33, 0.44, 0.55, 0.66, 7.77, 0.88, 9.99, 1.01, 1.12, 1.23]
    # a year with every month missing is not kept
    p6 = row("13169", "01", 2026, [-9.99] * 12)
    assert parse_monthly([p6], "pcpncy")[0] == {}
    assert check_against(mout, out) == []
    assert check_against({"19169": {2024: mout["19169"][2024][:6] + [9.0] + mout["19169"][2024][7:]}}, out) == [("19169", 2024)]
    assert check_against({}, out) == [("19169", 2024)]
    # temperature: -99.99 and -99.90 are missing; a tmin row in a tmax file is bad
    tm, tms = parse_monthly([t1, t2, row("41117", "28", 2024, [30] * 12)], "tmaxcy")
    assert tm["48117"][2024][6] == 93.4 and tm["48117"][2025][6:] == [None] * 6, tm
    assert tms["bad"] == 1, tms
    n1 = row("13169", "28", 2024, [10, 14, 25, 37, 50, 60, 64.3, 61.0, 52, 40, 27, 15])
    n2 = row("13169", "28", 2025, [10, 14, 25, 37, 50, 60, 66.1, -99.90, -99.90, -99.90, -99.90, -99.90])
    nm, _ = parse_monthly([n1, n2], "tmincy")
    assert nm["19169"][2024][6] == 64.3 and nm["19169"][2025][6] == 66.1 and nm["19169"][2025][7] is None
    # pre-1976 temperature rows are dropped, as in climate.json
    assert parse_monthly([row("13169", "28", 1975, [10] * 12)], "tmincy")[0] == {}
    assert latest_month(mout) == [2025, 8]
    assert latest_month({"a": {2024: [1] * 12}, "b": {2024: [1] * 6 + [None] * 6}}, share=0.9) == [2024, 6]
    # the written file round-trips, is gzip, and writes the same document twice
    with tempfile.TemporaryDirectory() as d:
        a, b = os.path.join(d, "a.json.gz"), os.path.join(d, "b.json.gz")
        parsed = {"pcp": mout, "tmax": tm, "tmin": nm}
        names = {"pcpncy": "climdiv-pcpncy-v1.0.0-20261007"}
        assert write_monthly(a, parsed, names, {}) == 2
        with gzip.open(a, "rt", encoding="utf-8") as f:
            doc = json.load(f)
        assert doc["counties"]["19169"]["pcp"]["2025"][8] is None
        assert doc["counties"]["19169"]["tmin"]["2024"][6] == 64.3
        assert doc["counties"]["48117"]["tmax"]["2024"][6] == 93.4 and "pcp" not in doc["counties"]["48117"]
        assert doc["first_year"] == {"pcp": 1991, "tmax": 1976, "tmin": 1976}
        assert doc["elements"] == ["pcp", "tmax", "tmin"]
        doc["fetched"] = "x"
        write_monthly(b, parsed, names, {})
        with gzip.open(b, "rt", encoding="utf-8") as f:
            d2 = json.load(f)
        d2["fetched"] = "x"
        assert d2 == doc
        # without tmin the file says so
        write_monthly(b, {"pcp": mout, "tmax": tm, "tmin": {}}, names, {})
        with gzip.open(b, "rt", encoding="utf-8") as f:
            assert json.load(f)["elements"] == ["pcp", "tmax"]
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
        hit = sorted(f for f in os.listdir(d) if f.startswith("climdiv-tmincy-"))
        if hit:
            names["tmincy"] = hit[-1]
            with open(os.path.join(d, hit[-1]), encoding="ascii", errors="replace") as f:
                texts["tmincy"] = f.read()
    else:
        listing = fetch(BASE).decode("utf-8", "replace")
        for kind in ELEMENTS:
            names[kind] = newest(listing, kind)
            if not names[kind]:
                sys.exit(f"no climdiv-{kind} file in the NCEI listing; the directory layout changed")
            log(f"downloading {BASE}{names[kind]}")
            texts[kind] = fetch(BASE + names[kind]).decode("ascii", "replace")
        # monthly file only: a failure here costs the monthly lows, nothing else
        try:
            n = newest(listing, "tmincy")
            if n:
                log(f"downloading {BASE}{n}")
                texts["tmincy"] = fetch(BASE + n).decode("ascii", "replace")
                names["tmincy"] = n
        except Exception as e:  # noqa: BLE001
            log(f"::warning::tmincy did not come down ({e}); the monthly file is written without lows")
    if "tmincy" not in texts:
        log("::warning::no climdiv-tmincy file; the monthly file is written without lows")
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
                   "files": {k: names[k] for k in ELEMENTS}, "urls": [BASE + names[k] for k in ELEMENTS],
                   "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                   "pcp_fields": ["annual_in", "apr_sep_in", "jul_aug_in"],
                   "gs_latest_year": gs_latest, "annual_latest_year": ann_latest, "tmax_latest_year": tmax_latest,
                   "parse_stats": {"pcp": pst, "tmax": tst}, "counties": counties}, f, separators=(",", ":"))
    os.replace(tmp, OUT)
    log(f"wrote {OUT}: {len(counties)} counties")

    # The single months, after climate.json is safely written.
    parsed, mst = {}, {}
    for kind, (_, _, _, key) in MONTHLY.items():
        if kind in texts:
            parsed[key], mst[key] = parse_monthly(texts[kind].splitlines(), kind)
            log(f"monthly {key}: {mst[key]}, {len(parsed[key])} counties, latest month {latest_month(parsed[key])}")
    if parsed.get("tmin") is not None and len(parsed["tmin"]) < 3000:
        log(f"::warning::only {len(parsed['tmin'])} counties of monthly lows; left out of the monthly file")
        parsed.pop("tmin")
        mst.pop("tmin")
        names.pop("tmincy", None)
    bad = check_against(parsed["pcp"], pcp)
    if bad:
        sys.exit(f"monthly April-September sums differ from climate.json in {len(bad)} county-years "
                 f"(first {bad[:5]}); {OUT_MONTHLY} not written, climate.json is fine")
    n = write_monthly(OUT_MONTHLY, parsed, names, mst)
    log(f"wrote {OUT_MONTHLY}: {n} counties, {os.path.getsize(OUT_MONTHLY) / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
