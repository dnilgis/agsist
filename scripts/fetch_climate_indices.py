#!/usr/bin/env python3
"""Monthly ocean climate indices for the PRF optimizer's backtest.

Writes data/prf/climate-indices.json: the Pacific Decadal Oscillation and the
Atlantic Multidecadal Oscillation, monthly, from 1940. A few KB. Each series
carries the URL it came from and the last month it holds (as_of).

scripts/prf_opt_backtest.mjs reads the file when it is there and tests the
"PDO with ENSO" and "AMO" tilts (components/prf-optimize.js, PREDICTORS);
without it those two are skipped and data/prf/opt.json says "not tested yet".
The panel on /prf reads it only if one of those tilts held up.

SOURCES
  PDO  NOAA NCEI, ERSST v5 PDO index, monthly, 1854 on. Missing as 99.99.
       https://www.ncei.noaa.gov/pub/data/cmb/ersst/v5/index/ersst.v5.pdo.dat
  AMO  NOAA PSL, AMO unsmoothed, from the Kaplan SST V2, 1948 on. Missing as
       -99.99. PSL's AMO is detrended over its whole record, so a year's value
       depends a little on later years; the backtest uses only its sign.
       https://psl.noaa.gov/data/correlation/amon.us.data

A source that fails or comes back thin keeps the series already published
(merge per series, never replace with less). Exit 1 if any source failed, but
whatever did come back is written.

  python3 scripts/fetch_climate_indices.py              # fetch and write
  python3 scripts/fetch_climate_indices.py --check      # validate the file
  python3 scripts/fetch_climate_indices.py --selftest   # parsers, fixtures, no network

NOT FETCHED, AND WHY

NMME (North American Multi-Model Ensemble) re-forecasts: the only archive that
could test whether seasonal forecasts help pick intervals. Not built yet; the
backtest lists it as "not tested yet" and counts it in the family anyway.
  Access: the IRI Data Library serves every NMME model's hindcast and real-time
  forecast as OPeNDAP / NetCDF with server-side subsetting, under
  https://iridl.ldeo.columbia.edu/SOURCES/.Models/.NMME/ (one entry per model,
  e.g. NCEP-CFSv2, CanSIPS, GFDL-SPEAR, NASA-GEOSS2S, COLA-RSMAS-CCSM4, each with
  HINDCAST and FORECAST monthly precipitation by start month, lead and member).
  NOAA CPC posts the real-time NMME products at
  https://www.cpc.ncep.noaa.gov/products/NMME/ and its files on
  ftp.cpc.ncep.noaa.gov/NMME/. Hindcasts run 1982-2010 (2011 on is the
  real-time archive), 1 degree, 10-24 members per model, leads 0.5-11.5 months.
  Verify the exact dataset paths in the Data Library browser before coding.
  Size: global, all starts, all members, one model is roughly 25 GB. What the
  test needs is far less: November starts only (out about Nov 8-10, before the
  Dec 1 closing), leads 2-13 for the eleven intervals, CONUS (about 1,500 one-
  degree cells), ensemble mean and spread, six models, 1982-2025: about 20 MB
  raw through Data Library subsetting, reducible to tercile probabilities per
  cell per interval per year (about 2 million numbers, a few MB gzipped, kept
  out of the published site as a build input). Each PRF grid (a quarter degree)
  takes its nearest one-degree cell.
  Stub: fetch_nmme() below raises with this note.

April 1 snowpack (NRCS SNOTEL basin indices, wcc.sc.egov.usda.gov report
generator): not fetched. April 1 is four months after the Dec 1 sales closing,
so no buyer can know it when choosing; it cannot be an honest predictor.
"""
import json
import math
import os
import sys
import time
from urllib.request import Request, urlopen

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = "data/prf/climate-indices.json"   # relative to ROOT; main() works from there
FIRST_YEAR = 1940
MIN_YEARS = 70           # a series with fewer whole years than this is refused
UA = "AGSIST-climate-indices (+https://agsist.com)"

SOURCES = {
    "pdo": {
        "name": "Pacific Decadal Oscillation (ERSST v5)",
        "url": "https://www.ncei.noaa.gov/pub/data/cmb/ersst/v5/index/ersst.v5.pdo.dat",
        "publisher": "NOAA NCEI",
        "units": "standardized index",
        "missing": lambda v: abs(v) >= 99,
    },
    "amo": {
        "name": "Atlantic Multidecadal Oscillation, unsmoothed (Kaplan SST V2)",
        "url": "https://psl.noaa.gov/data/correlation/amon.us.data",
        "publisher": "NOAA PSL",
        "units": "degrees C, detrended",
        "missing": lambda v: v <= -99,
    },
}


def parse_monthly(text, missing):
    """Rows of a year and up to twelve monthly values -> {year: [12 or None]}.
    Covers both NCEI's table (a header line, then 'YYYY v1 .. v12', the last
    year short) and PSL's (a 'first last' year line, rows, a missing-value line
    and notes). Anything that is not a year followed by numbers is skipped."""
    out = {}
    for line in text.splitlines():
        p = line.split()
        if len(p) < 2 or not (len(p[0]) == 4 and p[0].isdigit()):
            continue
        try:
            vals = [float(x) for x in p[1:]]
        except ValueError:
            continue
        if len(vals) > 12 or (len(vals) == 1 and len(p) == 2 and float(p[1]).is_integer() and 1800 < float(p[1]) < 2200):
            continue   # PSL's "1948 2026" header line
        row = [None if (missing(v) or not math.isfinite(v)) else round(v, 3) for v in vals]
        row += [None] * (12 - len(row))
        out[int(p[0])] = row
    return out


def as_of(monthly):
    """The last month with a value, as YYYY-MM."""
    for y in sorted(monthly, reverse=True):
        for m in range(11, -1, -1):
            if monthly[y][m] is not None:
                return "%04d-%02d" % (y, m + 1)
    return None


def whole_years(monthly):
    return sum(1 for row in monthly.values() if all(v is not None for v in row))


def build_series(key, text):
    src = SOURCES[key]
    m = parse_monthly(text, src["missing"])
    m = {y: r for y, r in m.items() if y >= FIRST_YEAR}
    if whole_years(m) < MIN_YEARS:
        raise ValueError("%s: only %d whole years from %d" % (key, whole_years(m), FIRST_YEAR))
    return {
        "name": src["name"], "publisher": src["publisher"], "url": src["url"], "units": src["units"],
        "first_year": min(m), "as_of": as_of(m),
        "fetched": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "monthly": {str(y): m[y] for y in sorted(m)},
    }


def fetch(url):
    req = Request(url, headers={"User-Agent": UA})
    with urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8", "replace")


def fetch_nmme():
    raise NotImplementedError("NMME hindcasts are not fetched yet; see this file's docstring for the access path and size.")


def check(d):
    """Raise if the file is not what the backtest expects."""
    assert d.get("v") == 1, "version"
    assert d.get("written_by") == "scripts/fetch_climate_indices.py"
    ser = d.get("series") or {}
    for k, s in ser.items():
        assert k in SOURCES, "unknown series " + k
        assert s["url"].startswith("https://") and s.get("as_of"), k
        mo = s["monthly"]
        assert all(len(r) == 12 for r in mo.values()), k + ": a row without twelve months"
        assert whole_years({int(y): r for y, r in mo.items()}) >= MIN_YEARS, k + ": thin"
        for r in mo.values():
            for v in r:
                assert v is None or (isinstance(v, (int, float)) and abs(v) < 10), k + ": value out of range"
    assert len(json.dumps(d)) < 60 * 1024, "over 60 KB"
    return True


def write(d):
    text = json.dumps(d, separators=(",", ":")) + "\n"
    with open(OUT, "w") as fh:
        fh.write(text)


def main():
    os.chdir(ROOT)
    if "--selftest" in sys.argv:
        selftest()
        return 0
    old = None
    if os.path.exists(OUT):
        with open(OUT) as fh:
            old = json.load(fh)
    if "--check" in sys.argv:
        if old is None:
            print("no file yet: " + OUT)
            return 0
        check(old)
        print("ok: " + ", ".join("%s to %s" % (k, s["as_of"]) for k, s in old["series"].items()))
        return 0
    series = dict((old or {}).get("series") or {})
    failed = []
    for key, src in SOURCES.items():
        try:
            s = build_series(key, fetch(src["url"]))
            prev = series.get(key)
            if prev and prev.get("as_of") and s["as_of"] < prev["as_of"]:
                raise ValueError("%s: refusing to go back from %s to %s" % (key, prev["as_of"], s["as_of"]))
            series[key] = s
            print("%s: %d years, to %s" % (key, len(s["monthly"]), s["as_of"]))
        except Exception as e:   # one dead source keeps its published series
            failed.append(key)
            print("FAILED %s: %s (kept the published series)" % (key, e))
    if not series:
        print("nothing to write")
        return 1
    d = {"v": 1, "written_by": "scripts/fetch_climate_indices.py",
         "built": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
         "note": "Monthly values; null where the source has none. Read by scripts/prf_opt_backtest.mjs.",
         "series": {k: series[k] for k in sorted(series)}}
    # an unchanged payload keeps the old timestamps, so a quiet month does not commit
    if old and old.get("series") and all(
            (old["series"].get(k) or {}).get("monthly") == d["series"][k]["monthly"] for k in d["series"]) \
            and set(old["series"]) == set(d["series"]):
        print("unchanged")
        return 1 if failed else 0
    check(d)
    write(d)
    print("wrote " + OUT)
    return 1 if failed else 0


# ------------------------------------------------------------------ selftest
PDO_FIXTURE = """ ERSST PDO Index:
 Year   Jan   Feb   Mar   Apr   May   Jun   Jul   Aug   Sep   Oct   Nov   Dec
 1939  0.10  0.20  0.30  0.40  0.50  0.60  0.70  0.80  0.90  1.00  1.10  1.20
 1940  1.50  1.20 -0.30  0.10  0.00 -0.40 -1.10 -0.60 -0.20  0.30  0.40  0.10
 2026 -1.10 -0.90 -0.70 -1.20 99.99 99.99 99.99 99.99 99.99 99.99 99.99 99.99
"""
AMO_FIXTURE = """ 1948 2026
 1948   -0.101   0.012   0.111   0.207   0.123  -0.020  -0.045   0.034   0.112   0.067  -0.011  -0.058
 1949    0.010   0.020   0.030   0.040   0.050   0.060   0.070   0.080   0.090   0.100   0.110   0.120
 2026    0.301   0.322   0.290 -99.990 -99.990 -99.990 -99.990 -99.990 -99.990 -99.990 -99.990 -99.990
  -99.99
  AMO unsmoothed from the Kaplan SST V2
  Calculated at NOAA PSL1
"""


def selftest():
    os.chdir(ROOT)
    p = parse_monthly(PDO_FIXTURE, SOURCES["pdo"]["missing"])
    assert sorted(p) == [1939, 1940, 2026], sorted(p)
    assert p[1940][0] == 1.5 and p[1940][11] == 0.1
    assert p[2026][3] == -1.2 and p[2026][4] is None and len(p[2026]) == 12
    assert as_of(p) == "2026-04", as_of(p)
    a = parse_monthly(AMO_FIXTURE, SOURCES["amo"]["missing"])
    assert sorted(a) == [1948, 1949, 2026], sorted(a)   # the "1948 2026" header and the notes are skipped
    assert a[1948][0] == -0.101 and a[2026][2] == 0.29 and a[2026][3] is None
    assert as_of(a) == "2026-03"
    assert whole_years(a) == 2
    # a thin answer is refused
    try:
        build_series("amo", AMO_FIXTURE)
        raise AssertionError("a thin series was accepted")
    except ValueError:
        pass
    # a long synthetic series passes, starts at FIRST_YEAR and checks clean
    rows = "\n".join(" %d " % y + " ".join("%.2f" % (0.1 * ((y + m) % 7 - 3)) for m in range(12)) for y in range(1930, 2026))
    s = build_series("pdo", " Year Jan\n" + rows + "\n 2026 0.50 0.40 99.99 99.99 99.99 99.99 99.99 99.99 99.99 99.99 99.99 99.99\n")
    assert s["first_year"] == FIRST_YEAR and s["as_of"] == "2026-02" and len(s["monthly"]) == 2026 - FIRST_YEAR + 1
    d = {"v": 1, "written_by": "scripts/fetch_climate_indices.py", "series": {"pdo": s}}
    assert check(d)
    try:
        fetch_nmme()
        raise AssertionError("the NMME stub should raise")
    except NotImplementedError:
        pass
    # the shipped file, when there is one, passes the same check
    if os.path.exists(OUT):
        with open(OUT) as fh:
            check(json.load(fh))
    print("selftest ok")


if __name__ == "__main__":
    sys.exit(main())
