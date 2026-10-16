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
  python scripts/fetch_atlas_drought.py --years 2024   # refetch whole years, every county
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


def count_weeks(records, half=HALF, y_min=None, y_max=None):
    """records for one county -> {year: {"maps": n, "d2": n, "d3": n}}

    y_min / y_max drop maps dated outside the years asked for. THEY MUST BE
    PASSED BY EVERY FETCH THAT IS NOT FROM 2000. A query that starts 1/1/2025
    also returns the map dated 2024-12-31 (its valid week runs into January),
    and before 2026-10-16 that one map was counted as "2024: 1 map" and then
    written over the full 53-map 2024 record. Every county lost 2024 that way."""
    years = {}
    for r in records:
        md = str(r.get("MapDate") or "").strip()
        if len(md) < 4 or not md[:4].isdigit():
            continue
        y = int(md[:4])
        if (y_min is not None and y < y_min) or (y_max is not None and y > y_max):
            continue
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


def merge_years(old, new, this_year):
    """Fold one county's fresh {year: rec} into its kept {year: rec}.

    A finished year (before this_year) is never replaced by a record with FEWER
    weekly maps: a short answer is a partial fetch, not a correction. The
    running year always takes the fresh count. Returns (merged, kept_years),
    kept_years being the finished years where the old, fuller record won."""
    out = dict(old or {})
    kept = []
    for y, rec in (new or {}).items():
        y = int(y)
        prev = out.get(y)
        if prev is not None and y < this_year and rec.get("maps", 0) < prev.get("maps", 0):
            kept.append(y)
            continue
        out[y] = rec
    return out, kept


def full_year_gaps(counties, this_year, first_year=FIRST_YEAR, full=40):
    """Finished years that most counties hold with under `full` maps (or not at
    all). A year like that is a hole in the file, not a fact about drought."""
    held = [c for c in counties.values() if c]
    if not held:
        return []
    gaps = []
    for y in range(first_year, this_year):
        short = sum(1 for c in held if (c.get(y) or c.get(str(y)) or {}).get("maps", 0) < full)
        if short > len(held) // 2:
            gaps.append(y)
    return gaps


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
    # THE 2024 HOLE (2026-10-16). A refetch starting 1/1/2025 got the 2024-12-31
    # map too; it must not become "2024: 1 map", and if it ever does it must not
    # replace the full year already kept.
    edge = [{"MapDate": "20241231", "D2": "0", "D3": "0"}, {"MapDate": "20250107", "D2": "60", "D3": "0"}]
    assert count_weeks(edge, y_min=2025) == {2025: {"maps": 1, "d2": 1, "d3": 0}}
    assert count_weeks(edge, y_min=2024, y_max=2024) == {2024: {"maps": 1, "d2": 0, "d3": 0}}
    kept_2024 = {2023: {"maps": 52, "d2": 2, "d3": 0}, 2024: {"maps": 53, "d2": 10, "d3": 1}}
    merged, kept = merge_years(kept_2024, {2024: {"maps": 1, "d2": 0, "d3": 0}, 2026: {"maps": 40, "d2": 3, "d3": 0}}, 2026)
    assert merged[2024]["maps"] == 53 and kept == [2024] and merged[2026]["maps"] == 40, (merged, kept)
    merged, kept = merge_years({2026: {"maps": 39, "d2": 3, "d3": 0}}, {2026: {"maps": 40, "d2": 3, "d3": 0}}, 2026)
    assert merged[2026]["maps"] == 40 and not kept
    merged, kept = merge_years({2024: {"maps": 1, "d2": 0, "d3": 0}}, {2024: {"maps": 53, "d2": 5, "d3": 0}}, 2026)
    assert merged[2024]["maps"] == 53 and not kept
    holes = {"1": {2023: {"maps": 52}, 2024: {"maps": 1}, 2025: {"maps": 52}}, "2": {2023: {"maps": 52}, 2024: {"maps": 1}, 2025: {"maps": 52}}}
    assert full_year_gaps(holes, 2026, first_year=2023) == [2024]
    assert parse_years("2024") == [2024] and parse_years("2023, 2024") == [2023, 2024]
    for bad in ("", "1999", "24", "2024-2025", "abc"):
        try:
            parse_years(bad, this_year=2026)
        except ValueError:
            continue
        raise AssertionError(bad)
    log("selftest ok")


def parse_years(text, this_year=None):
    """--years "2024" or "2023,2024" -> sorted list. Refuses anything else."""
    this_year = this_year or datetime.now(timezone.utc).year
    out = []
    for part in str(text).split(","):
        part = part.strip()
        if not (len(part) == 4 and part.isdigit()) or not (FIRST_YEAR <= int(part) <= this_year):
            raise ValueError(f"--years wants 4-digit years {FIRST_YEAR}-{this_year}, comma-separated; got {text!r}")
        out.append(int(part))
    return sorted(set(out))


def main():
    if "--selftest" in sys.argv:
        selftest()
        return
    this_year = datetime.now(timezone.utc).year
    fips_list = sorted(ft["id"] for ft in load_geometry()["features"])
    only_years = None
    if "--years" in sys.argv:
        only_years = parse_years(sys.argv[sys.argv.index("--years") + 1], this_year)
    existing = None
    if os.path.exists(OUT) and "--all" not in sys.argv:
        with open(OUT, encoding="utf-8") as f:
            existing = json.load(f)
    if only_years and existing is None:
        sys.exit("--years refetches years into an existing file; there is none, run without it first")
    if existing is None:
        y0 = FIRST_YEAR
        counties = {}
    elif only_years:
        # --years: every county, those years only, everything else kept as is.
        # A year comes back in only where it now has at least as many maps.
        y0 = only_years[0]
        counties = {f: {int(y): v for y, v in c.items()} for f, c in existing["counties"].items()}
        log(f"  refetching only {', '.join(map(str, only_years))}; every other year kept")
    else:
        y0 = this_year - REFETCH_YEARS + 1
        # Every kept year stays in, the refetched ones too: merge_years decides
        # per year, so a short answer for 2025 cannot erase a full 2025.
        counties = {f: {int(y): v for y, v in c.items()} for f, c in existing["counties"].items()}
        log(f"  keeping years before {y0}; refetching {y0}-{this_year}")
    # A COUNTY THE FILE HAS NEVER SEEN GETS ITS WHOLE HISTORY, NOT TWO YEARS.
    #
    # 2026-09-19: the Atlas went from 15 states to 50 and the first ordinary run
    # after it fetched 2025-2026 for all 3,141 counties -- right for the 1,450
    # already in the file, wrong for the 1,691 that were not. Fresno CA came
    # out with 52 weeks counted and was coloured on the "since 2000" map as if
    # that were its record. It took a hand-typed refetch_all to repair. Now the
    # start year is decided per county: FIRST_YEAR for any county whose record
    # does not already reach back to it.
    start_of = {}
    if "--limit" in sys.argv:
        fips_list = fips_list[:int(sys.argv[sys.argv.index("--limit") + 1])]
    failed = []
    t0 = time.time()

    # Full history only for a county the file has never held, or one whose record
    # was non-empty and holds nothing before this run's window. NOT for a county
    # the file holds as empty: the Drought Monitor publishes nothing for it (the
    # 8 old Connecticut codes, 02261), and a from-2000 call for it every run
    # would come back empty every run. Found by the audit panel, 2026-09-19.
    prior = (existing or {}).get("counties") or {}
    for fips in fips_list:
        if only_years:
            start_of[fips] = only_years[0]
        elif existing is None:
            start_of[fips] = FIRST_YEAR
        elif fips not in prior:
            start_of[fips] = FIRST_YEAR
        elif prior[fips] and not any(y < y0 for y in counties.get(fips, {})):
            start_of[fips] = FIRST_YEAR
        else:
            start_of[fips] = y0
    n_full = sum(1 for f in fips_list if start_of[f] == FIRST_YEAR)
    if existing is not None and n_full:
        log(f"  {n_full} counties have no history before {y0} in the file; fetching them from {FIRST_YEAR}")

    def work(fips):
        """One county in one worker. Returns (fips, years or None, error or None);
        the exception is carried back rather than raised so the pool keeps
        going and the caller decides, exactly as the serial loop did."""
        try:
            y_end = only_years[-1] if only_years else this_year
            years, err = count_weeks(fetch_county(fips, start_of[fips], y_end), y_min=start_of[fips], y_max=y_end), None
            if only_years and years is not None:
                years = {y: v for y, v in years.items() if y in only_years}
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
    kept_total = {}
    for fips in fips_list:
        if fips in results:
            counties[fips], kept = merge_years(counties.get(fips), results[fips], this_year)
            for y in kept:
                kept_total[y] = kept_total.get(y, 0) + 1
    for y, n in sorted(kept_total.items()):
        log(f"  {y}: kept the fuller record already in the file for {n} counties (the fetch came back shorter)")
    if not counties:
        sys.exit("no counties fetched")
    if len(failed) > len(fips_list) // 10:
        sys.exit(f"{len(failed)} of {len(fips_list)} counties failed; refusing to write a file that is mostly holes")
    all_years = sorted({y for c in counties.values() for y in c})
    # Said out loud in the file, so the Atlas and the drought page can name the
    # years a "since 2000" total leaves out instead of skipping them silently.
    gaps = full_year_gaps(counties, this_year)
    if gaps:
        log(f"  WARNING: finished years short of maps in most counties: {gaps}; dispatch with --years to refetch them")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"source": "U.S. Drought Monitor county statistics API (NDMC/UNL), cumulative area percent, weekly maps since 2000-01-04",
                   "url": API, "half": HALF, "first_year": all_years[0], "latest_year": all_years[-1],
                   "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                   "failed": failed,
                   "missing_years": gaps,
                   "note": f"d2 = weeks with at least {HALF:.0f}% of the county's area in D2 or worse; d3 = same for D3 or worse; maps = weekly maps counted",
                   "counties": counties}, f, separators=(",", ":"))
    log(f"wrote {OUT}: {len(counties)} counties, {all_years[0]}-{all_years[-1]}, {len(failed)} failed")


if __name__ == "__main__":
    main()
