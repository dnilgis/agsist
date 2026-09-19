#!/usr/bin/env python3
"""
fetch_atlas_drought.py — how many weeks of every year each county spent in
drought, from the U.S. Drought Monitor -> data/atlas/raw/drought.json

ONE SOURCE
  USDM county statistics API (National Drought Mitigation Center, UNL):
    https://usdmdataservices.unl.edu/api/CountyStatistics/GetDroughtSeverityStatisticsByAreaPercent
      ?aoi=<FIPS>&startdate=M/D/YYYY&enddate=M/D/YYYY&statisticsType=1
  One record per weekly map: MapDate, FIPS, County, State, None, D0, D1, D2,
  D3, D4, ValidStart, ValidEnd, StatisticFormatID. statisticsType=1 is the
  cumulative form, read 2026-09-15 on Story County IA: D2 is the percent of
  the county's area in D2 OR WORSE. The Monitor starts 2000-01-04.

WHAT IS COUNTED
  For each county and year: the number of weekly maps, the weeks in which at
  least half the county's area was in D2 (severe) or worse, and the weeks in
  which at least half was in D3 (extreme) or worse. "Half" is the Atlas's
  threshold (HALF = 50.0), printed with the number wherever it appears. A
  county is one call; at 50 states the Atlas is 3,141 calls, so a first run is
  long and later runs refetch only the current and previous year. The calls
  are made WORKERS at a time; see WORKERS below for why that number.

  The API answers CSV or JSON depending on the client; both are parsed.

USAGE
  python scripts/fetch_atlas_drought.py --selftest
  python scripts/fetch_atlas_drought.py            # first run 2000..now, later runs the last 2 years merged
  python scripts/fetch_atlas_drought.py --all
"""

import concurrent.futures
import csv
import io
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone

from atlas_common import UA, load_geometry, log

API = "https://usdmdataservices.unl.edu/api/CountyStatistics/GetDroughtSeverityStatisticsByAreaPercent"
OUT = "data/atlas/raw/drought.json"
FIRST_YEAR = 2000
HALF = 50.0
REFETCH_YEARS = 2
SLEEP = 0.2
# HOW MANY CALLS ARE IN FLIGHT AT ONCE.
#
# This is one endpoint at one university, not a CDN, and it is answering a
# 26-year query per county. Four is chosen to be small: it is enough to turn
# 3,141 serial calls into a run that finishes well inside the workflow's 300
# minutes, and few enough that if NDMC is having a slow day we are four
# connections of its load and not forty. Each worker keeps the same SLEEP the
# single loop had, so a worker is exactly as polite as the old code was and
# WORKERS is the whole of the increase. Raising it is not free: the 429 path
# below backs off one worker, not the pool, so a rate limit hit by four
# workers is hit four times.
WORKERS = 4
FIELDS = ("MapDate", "FIPS", "County", "State", "None", "D0", "D1", "D2", "D3", "D4", "ValidStart", "ValidEnd", "StatisticFormatID")


def parse(body):
    """API body (bytes) -> list of dicts with the FIELDS keys. CSV with a header,
    or a JSON array of objects, or a JSON array of arrays in FIELDS order."""
    text = body.decode("utf-8-sig", "replace").strip()
    if not text:
        return []
    if text[0] in "[{":
        data = json.loads(text)
        if isinstance(data, dict):
            data = data.get("data") or data.get("value") or []
        out = []
        for r in data:
            if isinstance(r, dict):
                out.append({k: r.get(k) for k in FIELDS})
            else:
                out.append(dict(zip(FIELDS, r)))
        return out
    rows = list(csv.reader(io.StringIO(text)))
    if not rows:
        return []
    head = [h.strip() for h in rows[0]]
    if "MapDate" in head:
        idx = {k: head.index(k) for k in FIELDS if k in head}
        body_rows = rows[1:]
    else:
        idx = {k: i for i, k in enumerate(FIELDS)}
        body_rows = rows
    out = []
    for r in body_rows:
        if len(r) < 10:
            continue
        out.append({k: (r[i] if i < len(r) else None) for k, i in idx.items()})
    return out


def count_weeks(records, half=HALF):
    """records for one county -> {year: {"maps": n, "d2": n, "d3": n}}"""
    years = {}
    for r in records:
        md = str(r.get("MapDate") or "").strip()
        if len(md) < 4 or not md[:4].isdigit():
            continue
        y = int(md[:4])
        try:
            d2, d3 = float(r.get("D2") or 0), float(r.get("D3") or 0)
        except ValueError:
            continue
        rec = years.setdefault(y, {"maps": 0, "d2": 0, "d3": 0})
        rec["maps"] += 1
        if d2 >= half:
            rec["d2"] += 1
        if d3 >= half:
            rec["d3"] += 1
    return years


def fetch_county(fips, y0, y1, retries=4):
    url = f"{API}?aoi={fips}&startdate=1/1/{y0}&enddate=12/31/{y1}&statisticsType=1"
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json, text/csv;q=0.9, */*;q=0.5"})
            with urllib.request.urlopen(req, timeout=120) as r:
                return parse(r.read())
        except urllib.error.HTTPError as e:
            last = e
            if e.code == 404:
                return []
            wait = 30 if e.code == 429 else 10 * (attempt + 1)
            ra = e.headers.get("Retry-After") if e.headers else None
            if ra and ra.isdigit():
                wait = int(ra)
            time.sleep(wait)
        except Exception as e:
            last = e
            time.sleep(10 * (attempt + 1))
    raise RuntimeError(f"{fips}: {type(last).__name__}: {last}")


def selftest():
    csv_body = ("MapDate,FIPS,County,State,None,D0,D1,D2,D3,D4,ValidStart,ValidEnd,StatisticFormatID\r\n"
                "20120717,19169,Story County,IA,0.00,100.00,100.00,80.00,20.00,0.00,2012-07-17,2012-07-23,1\r\n"
                "20120724,19169,Story County,IA,0.00,100.00,100.00,100.00,60.00,0.00,2012-07-24,2012-07-30,1\r\n"
                "20130108,19169,Story County,IA,0.00,100.00,100.00,49.99,0.00,0.00,2013-01-08,2013-01-14,1\r\n").encode()
    rows = parse(csv_body)
    assert len(rows) == 3 and rows[0]["D2"] == "80.00" and rows[2]["MapDate"] == "20130108", rows
    y = count_weeks(rows)
    assert y == {2012: {"maps": 2, "d2": 2, "d3": 1}, 2013: {"maps": 1, "d2": 0, "d3": 0}}, y
    json_body = json.dumps([{"MapDate": "20220830", "FIPS": "20055", "D2": 55.5, "D3": 10}, {"MapDate": "20220906", "FIPS": "20055", "D2": 0, "D3": 0}]).encode()
    y2 = count_weeks(parse(json_body))
    assert y2 == {2022: {"maps": 2, "d2": 1, "d3": 0}}, y2
    y3 = count_weeks(parse(json.dumps([["20240102", "20055", "Finney County", "KS", "0", "100", "100", "100", "100", "50", "2024-01-02", "2024-01-08", 1]]).encode()))
    assert y3 == {2024: {"maps": 1, "d2": 1, "d3": 1}}, y3
    assert parse(b"") == [] and parse(b"MapDate,FIPS\r\n") == []
    log("selftest ok")


def main():
    if "--selftest" in sys.argv:
        selftest()
        return
    this_year = datetime.now(timezone.utc).year
    fips_list = sorted(ft["id"] for ft in load_geometry()["features"])
    existing = None
    if os.path.exists(OUT) and "--all" not in sys.argv:
        with open(OUT, encoding="utf-8") as f:
            existing = json.load(f)
    if existing is None:
        y0 = FIRST_YEAR
        counties = {}
    else:
        y0 = this_year - REFETCH_YEARS + 1
        counties = {f: {int(y): v for y, v in c.items() if int(y) < y0} for f, c in existing["counties"].items()}
        log(f"  keeping years before {y0}; refetching {y0}-{this_year}")
    if "--limit" in sys.argv:
        fips_list = fips_list[:int(sys.argv[sys.argv.index("--limit") + 1])]
    failed = []
    t0 = time.time()

    def work(fips):
        """One county in one worker. Returns (fips, years or None, error or None);
        the exception is carried back rather than raised so the pool keeps
        going and the caller decides, exactly as the serial loop did."""
        try:
            years, err = count_weeks(fetch_county(fips, y0, this_year)), None
        except RuntimeError as e:
            years, err = None, e
        time.sleep(SLEEP)
        return fips, years, err

    done = 0
    results = {}
    log(f"  {len(fips_list)} counties, {WORKERS} at a time, {y0}-{this_year}")
    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
        # map() hands results back in the order the counties went in, so the
        # failed list and the file are the same whatever order the API answers.
        for fips, years, err in pool.map(work, fips_list):
            done += 1
            if err is not None:
                log(f"  {err}")
                failed.append(fips)
            else:
                results[fips] = years
            if done % 100 == 0 or done == len(fips_list):
                log(f"  {done}/{len(fips_list)} counties, {time.time() - t0:.0f}s")
    for fips in fips_list:
        if fips in results:
            counties.setdefault(fips, {}).update(results[fips])
    if not counties:
        sys.exit("no counties fetched")
    if len(failed) > len(fips_list) // 10:
        sys.exit(f"{len(failed)} of {len(fips_list)} counties failed; refusing to write a file that is mostly holes")
    all_years = sorted({y for c in counties.values() for y in c})
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"source": "U.S. Drought Monitor county statistics API (NDMC/UNL), cumulative area percent, weekly maps since 2000-01-04",
                   "url": API, "half": HALF, "first_year": all_years[0], "latest_year": all_years[-1],
                   "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                   "failed": failed,
                   "note": f"d2 = weeks with at least {HALF:.0f}% of the county's area in D2 or worse; d3 = same for D3 or worse; maps = weekly maps counted",
                   "counties": counties}, f, separators=(",", ":"))
    log(f"wrote {OUT}: {len(counties)} counties, {all_years[0]}-{all_years[-1]}, {len(failed)} failed")


if __name__ == "__main__":
    main()
