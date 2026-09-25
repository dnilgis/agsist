#!/usr/bin/env python3
"""
fetch_atlas_frost.py — freeze dates, frost-free season, corn growing degree
days and hot days by county, from NOAA nClimGrid-daily county averages
(EpiNOAA) -> data/atlas/raw/frost.json

SOURCE
  NOAA Big Data Program, open on AWS, no key:
  https://noaa-nclimgrid-daily-pds.s3.amazonaws.com/EpiNOAA/v1-0-0/parquet/cty/
    YEAR=YYYY/STATUS=scaled/YYYYMM.parquet   (about 0.8 MB a month; listing
    read 2026-09-19). STATUS=prelim holds the newest months until NOAA's
    quality pass replaces them; only scaled months are used here.
  One row per county per day: the day's high and low averaged over NOAA's
  5 km grid cells in the county.

THE COLUMNS ARE CHECKED, NOT ASSUMED
  NOAA documents date, a region code, tmax, tmin (and tavg, prcp). The first
  file's schema is printed. The county code column is the one whose values
  are 4-5 digit codes; the run stops if no column is. Units are read from the
  first file: a median county high above 40 is Fahrenheit (a Celsius high
  never gets there from March to November), otherwise Celsius and converted.

PER COUNTY AND YEAR (1996 on, 30 seasons)
  last spring freeze: the last day from March 1 to June 30 with a low at or
    below 32 F. None in that window is written as -1 ("before March 1").
  first fall freeze: the first day from August 1 to November 30 at or below
    32 F. None is written as 999 ("after November 30").
  corn growing degree days, May 1 to September 30, base 50 F, cap 86 F
  days with a high of 95 F or more, June to August
  A year is kept only when every day of its window is present.

WHAT IT IS NOT
  A county average. A frost pocket, a river bottom or a hilltop in the
  county will freeze earlier or later than this. In mountain counties the
  average mixes valleys and peaks and says little about any field.

USAGE
  python scripts/fetch_atlas_frost.py --selftest
  python scripts/fetch_atlas_frost.py              # needs pyarrow
"""

import io
import json
import time
import os
import sys
import urllib.request
from datetime import date, datetime, timezone

from build_farmland_atlas import ATLAS_STATE_FIPS

BASE = "https://noaa-nclimgrid-daily-pds.s3.amazonaws.com/EpiNOAA/v1-0-0/parquet/cty/"
OUT = "data/atlas/raw/frost.json"
FIRST_YEAR = 1996
MONTHS = range(3, 12)            # March through November
UA = "AGSIST-automation/1.0 (+https://agsist.com/farmland-atlas)"
FREEZE_F = 32.0
BEFORE, AFTER = -1, 999


def log(*a):
    print(*a, flush=True)


def http(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=300) as r:
        return r.read()


def gdd(hi, lo):
    """Corn GDD, the 86/50 method: the high is capped at 86, both are floored at 50."""
    hi = min(max(hi, 50.0), 86.0)
    lo = min(max(lo, 50.0), 86.0)
    return (hi + lo) / 2 - 50.0


class Season:
    """One county, one year: fed days in any order, answers at the end."""
    __slots__ = ("spring", "fall", "gdd", "hot", "n_spring", "n_fall", "n_gdd", "n_hot")

    def __init__(self):
        self.spring, self.fall = None, None
        self.gdd, self.hot = 0.0, 0
        self.n_spring = self.n_fall = self.n_gdd = self.n_hot = 0

    def add(self, d, hi, lo):
        # a non-leap reference year, so a leap-year May 14 is May 14 on the page (not May 15)
        doy = date(2021, d.month, d.day).timetuple().tm_yday if not (d.month == 2 and d.day == 29) else 59
        if 3 <= d.month <= 6 and lo is not None:
            self.n_spring += 1
            if lo <= FREEZE_F and (self.spring is None or doy > self.spring):
                self.spring = doy
        if 8 <= d.month <= 11 and lo is not None:
            self.n_fall += 1
            if lo <= FREEZE_F and (self.fall is None or doy < self.fall):
                self.fall = doy
        if 5 <= d.month <= 9 and hi is not None and lo is not None:
            self.n_gdd += 1
            self.gdd += gdd(hi, lo)
        if 6 <= d.month <= 8 and hi is not None:
            self.n_hot += 1
            self.hot += hi >= 95.0

    def result(self, year):
        want_spring = 122                 # Mar 1 - Jun 30 (February is outside it, so no leap day)
        want_fall = 122                   # Aug 1 - Nov 30
        want_gdd, want_hot = 153, 92
        return [
            (self.spring if self.spring is not None else BEFORE) if self.n_spring == want_spring else None,
            (self.fall if self.fall is not None else AFTER) if self.n_fall == want_fall else None,
            round(self.gdd) if self.n_gdd == want_gdd else None,
            self.hot if self.n_hot == want_hot else None,
        ]


def find_columns(names, sample):
    """names: column names; sample: {name: [first values]} -> (date_col, fips_col, tmax_col, tmin_col) or raise."""
    low = {n.lower(): n for n in names}
    dcol = low.get("date")
    hi = low.get("tmax") or next((n for n in names if n.lower().startswith("tmax")), None)
    lo = low.get("tmin") or next((n for n in names if n.lower().startswith("tmin")), None)
    fcol = None
    named = [n for n in names if "fips" in n.lower()] + [n for n in names if n.lower() in ("region_code", "code", "county_code", "geoid", "county")]
    # last resort: any other column whose first values are all 4-5 digit codes (a numeric 19169.0 counts).
    # NOAA's county file was never read from here, so the name is not assumed.
    order = named + [n for n in names if n not in named and n not in (dcol, hi, lo)]
    for n in order:
        vals = [str(v).strip() for v in sample.get(n, []) if v is not None]
        vals = [v[:-2] if v.endswith(".0") else v for v in vals]
        if vals and all(v.isdigit() and 4 <= len(v) <= 5 for v in vals):
            fcol = n
            break
    if not (dcol and hi and lo and fcol):
        raise RuntimeError(f"EpiNOAA columns not recognised: {names}; sample {({k: v[:3] for k, v in sample.items()})}")
    return dcol, fcol, hi, lo


def num(x):
    """A temperature as a float, or None. The real EpiNOAA file (read from the run log 2026-09-25)
    stores tmax and tmin as STRINGS, so '' , 'NA' and 'nan' must come out as missing, not raise."""
    if x is None:
        return None
    if isinstance(x, (int, float)):
        v = float(x)
    else:
        s = str(x).strip()
        if not s or s.lower() in ("na", "nan", "null", "none", "--"):
            return None
        try:
            v = float(s)
        except ValueError:
            return None
    return v if v == v and abs(v) != float("inf") else None


def to_date(v):
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    s = str(v).strip()
    if s.endswith(".0"):
        s = s[:-2]
    if s.isdigit() and len(s) == 8:               # 19960301
        return date(int(s[0:4]), int(s[4:6]), int(s[6:8]))
    s = s[:10]
    return date(int(s[0:4]), int(s[5:7]), int(s[8:10]))


def selftest():
    s = Season()
    y = 2021
    d0 = date(y, 3, 1)
    from datetime import timedelta
    for i in range(0, 275):                       # Mar 1 .. Nov 30
        d = d0 + timedelta(days=i)
        if d.month > 11:
            break
        lo = 60.0
        if d == date(y, 5, 2):
            lo = 31.0                              # last spring freeze
        if d == date(y, 4, 10):
            lo = 20.0
        if d == date(y, 10, 5):
            lo = 32.0                              # first fall freeze (at 32 counts)
        if d == date(y, 11, 1):
            lo = 25.0
        hi = 96.0 if d == date(y, 7, 4) else 80.0
        s.add(d, hi, lo)
    r = s.result(y)
    assert r[0] == date(y, 5, 2).timetuple().tm_yday and r[1] == date(y, 10, 5).timetuple().tm_yday, r
    assert r[3] == 1, r
    assert gdd(90, 60) == 23.0 and gdd(45, 30) == 0.0 and gdd(70, 40) == 10.0
    s3 = Season()
    for i in range(0, 275):                        # a leap year: the windows start after February
        d = date(2020, 3, 1) + timedelta(days=i)
        if d.month > 11:
            break
        s3.add(d, 80.0, 60.0)
    assert s3.result(2020)[:2] == [BEFORE, AFTER], s3.result(2020)
    s4 = Season()
    s4.add(date(2020, 5, 14), 70.0, 30.0)
    assert s4.spring == date(2021, 5, 14).timetuple().tm_yday, "a leap-year May 14 is May 14"
    s2 = Season()
    s2.add(date(y, 3, 1), 70, 50)
    assert s2.result(y) == [None, None, None, None], "an incomplete window is not a season"
    assert find_columns(["date", "state_name", "region_code", "tmax", "tmin"], {"region_code": ["19169", "1001"]})[1] == "region_code"
    try:
        find_columns(["date", "region_name", "tmax", "tmin"], {"region_name": ["Story County"]})
        raise AssertionError("no code column must stop the run")
    except RuntimeError:
        pass
    assert to_date("2021-07-04") == date(2021, 7, 4)
    # the column finder must cope with names it was not told about (corrected 2026-09-25: the real schema was never read)
    c = find_columns(["date", "GEOID", "tmax_f", "tmin_f"], {"GEOID": ["19169", "01001"], "date": ["1996-03-01"]})
    assert c == ("date", "GEOID", "tmax_f", "tmin_f"), c
    c = find_columns(["obs", "cty", "TMAX", "TMIN", "date"], {"cty": [19169.0, 1001.0], "obs": ["x"]})
    assert c[1] == "cty", c
    assert num("78.3") == 78.3 and num("") is None and num("NaN") is None and num(None) is None and num("x") is None and num(-999.99) == -999.99
    assert to_date(19960301) == date(1996, 3, 1) and to_date("1996-03-01 00:00:00") == date(1996, 3, 1)
    try:
        find_columns(["date", "tmax", "tmin", "name"], {"name": ["Story"]})
        raise SystemExit("selftest: a column with no county code was accepted")
    except RuntimeError:
        pass
    log("selftest ok")


def main():
    if "--selftest" in sys.argv:
        selftest()
        return
    import pyarrow.parquet as pq
    now = datetime.now(timezone.utc)
    last = now.year - 1                       # a season ends Nov 30; the current year is never whole
    seasons = {}
    cols = None
    fahrenheit = None
    skipped = []
    for year in range(FIRST_YEAR, last + 1):
        for m in MONTHS:
            url = f"{BASE}YEAR={year}/STATUS=scaled/{year}{m:02d}.parquet"
            blob, err = None, None
            for attempt in range(3):
                try:
                    blob = http(url)
                    break
                except Exception as e:
                    err = e
                    time.sleep(5 * (attempt + 1))
            if blob is None:
                skipped.append(f"{year}-{m:02d}")
                log(f"  {year}-{m:02d}: not available as scaled ({type(err).__name__}); that season is incomplete")
                continue
            t = pq.read_table(io.BytesIO(blob))
            if cols is None:
                names = t.column_names
                sample = {n: t.column(n).to_pylist()[:5] for n in names}
                log(f"  schema: {t.schema}")
                cols = find_columns(names, sample)
                log(f"  using date={cols[0]} county={cols[1]} high={cols[2]} low={cols[3]}")
            dcol, fcol, hcol, lcol = cols
            D, F, H, L = (t.column(c).to_pylist() for c in cols)
            H, L = [num(x) for x in H], [num(x) for x in L]
            if fahrenheit is None:
                # decided on the FIRST file read, before any day is used: a median county high
                # above 40 is Fahrenheit in any month from March to November (in Celsius it
                # never gets there); decided in July instead, March to June 1996 were read in
                # the wrong units whenever the file was Fahrenheit (panel 9/20)
                his = sorted(h for h in H if h is not None and h > -900)
                med = his[len(his) // 2] if his else None
                if med is None:
                    sys.exit(f"{year}-{m:02d}: no highs to read the units from; nothing written")
                fahrenheit = med > 40
                log(f"  {year}-{m:02d} median county high {med}: reading as {'Fahrenheit' if fahrenheit else 'Celsius, converted'}")
            conv = (lambda x: x) if fahrenheit else (lambda x: x * 9 / 5 + 32)
            for d, f, h, l in zip(D, F, H, L):
                if f is None:
                    continue
                fips = str(f).strip().zfill(5)
                if fips[:2] not in ATLAS_STATE_FIPS:
                    continue
                hi = conv(h) if h is not None and h > -900 else None
                lo = conv(l) if l is not None and l > -900 else None
                dd = to_date(d)
                seasons.setdefault(fips, {}).setdefault(year, Season()).add(dd, hi, lo)
        log(f"  {year}: {sum(1 for c in seasons.values() if year in c)} counties")
    if fahrenheit is None:
        sys.exit("never read a file; nothing written")
    early = [s for s in skipped if int(s[:4]) < last]
    if len(early) > 6:
        sys.exit(f"{len(early)} months before {last} could not be read ({', '.join(early[:12])}); nothing written")
    counties = {}
    for f, ys in seasons.items():
        rec = {str(y): s.result(y) for y, s in sorted(ys.items())}
        rec = {y: v for y, v in rec.items() if any(x is not None for x in v)}
        if rec:
            counties[f] = rec
    if len(counties) < 3000:
        sys.exit(f"only {len(counties)} counties with a season; nothing written")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump({"source": "NOAA nClimGrid-daily county averages (EpiNOAA v1.0.0, scaled), AWS open data",
                   "url": BASE, "fetched": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
                   "first_year": FIRST_YEAR, "last_year": last, "units_read_as": "F" if fahrenheit else "C",
                   "columns": list(cols), "skipped_months": skipped,
                   "fields": ["last_spring_freeze_doy (-1 before Mar 1)", "first_fall_freeze_doy (999 after Nov 30)",
                              "gdd_may_sep_86_50", "days_high_95_jun_aug"],
                   "counties": counties}, fh, separators=(",", ":"))
    os.replace(tmp, OUT)
    log(f"wrote {OUT}: {len(counties)} counties, {FIRST_YEAR}-{last}")


if __name__ == "__main__":
    main()
