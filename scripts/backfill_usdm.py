#!/usr/bin/env python3
"""backfill_usdm.py -- U.S. Drought Monitor county weekly categories, every
county, every weekly map since 2000-01-04, to the private raw branch
(history/usdm-county/). One-time backfill: history-backfill.yml,
source=usdm. The weekly drought job (drought-county-week.yml) then keeps the
current year's files up to date from the rows it already reads
(scripts/fetch_drought_county_week.py calls ongoing() below), so no new
schedule.

SOURCE: the same NDMC endpoint and form the site reads now
(scripts/fetch_drought_county_week.py, probe of 2026-10-16):
  https://usdmdataservices.unl.edu/api/CountyStatistics/GetDroughtSeverityStatisticsByAreaPercent
    ?aoi=<state>&startdate=1/1/YYYY&enddate=12/31/YYYY&statisticsType=1
statisticsType=1 is cumulative: D1 is the percent of the county's area in D1
OR WORSE, so D0 >= D1 >= ... >= D4. One call per state and year (50 x 27 =
1,350 calls); a state that answers empty is asked county by county, as the
weekly job does.

WHAT IS WRITTEN
  history/usdm-county/<YYYY>/<ST>.csv.gz   fips,date,d0,d1,d2,d3,d4 (NDMC's
                                           figures as sent, two decimals)
  history/usdm-county/manifest.json        per state-year: rows, counties,
                                           maps, first/last map, URL, fetched,
                                           complete
  Every row passes the weekly job's own check (FIPS, date, 0-100, cumulative,
  None + D0 = 100); a failed row is dropped and counted. A state-year is
  complete when the year is over, it has at least 52 weekly maps, under 2% of
  rows were dropped and at least 90% of the state's Atlas counties are in it;
  anything else is fetched again on the next dispatch.

    python3 scripts/backfill_usdm.py --selftest
    python3 scripts/backfill_usdm.py [--from 2000] [--to 2026] [--states IA,MN] [--max-minutes 300]
"""
import argparse
import json
import os
import sys
from datetime import date, datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from history_lib import Budget, Fetcher, FetchError, Manifest, Saver, write_csv_gz  # noqa: E402
from fetch_atlas_drought import parse  # noqa: E402  one parser for every USDM reader
from fetch_drought_county_week import API, check_row, url_for  # noqa: E402

OUT = "history/usdm-county"
FIRST_YEAR = 2000
HEADER = ["fips", "date", "d0", "d1", "d2", "d3", "d4"]
MIN_MAPS = 52
MIN_COVER = 0.90
MAX_BAD = 0.02
INDEX = "farmland-atlas/data/counties-index.json"


def states_index(path=INDEX):
    with open(path, encoding="utf-8") as f:
        idx = json.load(f)
    st = {}
    for fips, name, _ in idx:
        st.setdefault(name.rsplit(", ", 1)[-1], []).append(fips)
    return st


def clean_rows(raw):
    """Parsed API dicts -> (rows [fips, iso date, d0..d4 as sent], dropped count).
    Exact repeats (the same county and map twice) are kept once."""
    out, seen, bad = [], set(), 0
    for r in raw:
        got, why = check_row(r)
        if got is None:
            bad += 1
            continue
        fips, d, _ = got
        if (fips, d) in seen:
            continue
        seen.add((fips, d))
        out.append([fips, d.isoformat()] + [fmt(r.get(k)) for k in ("D0", "D1", "D2", "D3", "D4")])
    out.sort(key=lambda x: (x[1], x[0]))
    return out, bad


def fmt(v):
    """'12.50' stays '12.5'; '0.00' is '0'. The figure is NDMC's, only the zeros go."""
    x = float(v)
    s = f"{x:.2f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def fetch_state_year(fetch, st, counties, year):
    """-> (raw dicts, how). The state form first; county by county if it is empty."""
    start, end = date(year, 1, 1), date(year, 12, 31)
    status, body = fetch.get(url_for(st, start, end))
    raw = parse(body) if status == 200 else []
    if raw:
        return raw, "state"
    out = []
    for f in counties:
        s2, b2 = fetch.get(url_for(f, start, end))
        if s2 == 200:
            out += parse(b2)
    return out, "county"


def judge(rows, bad, counties, year, this_year):
    maps = sorted({r[1] for r in rows})
    have = {r[0] for r in rows}
    cover = len(have & set(counties)) / len(counties) if counties else 0
    n = len(rows) + bad
    complete = (year < this_year and len(maps) >= MIN_MAPS and cover >= MIN_COVER and (not n or bad / n <= MAX_BAD))
    return complete, maps, have, cover


def run(states, y0, y1, out=OUT, fetch=None, budget=None, saver=None, this_year=None, log=print):
    fetch = fetch or Fetcher(min_gap=1.0, headers={"Accept": "application/json, text/csv;q=0.9, */*;q=0.5"})
    this_year = this_year or datetime.now(timezone.utc).year
    budget = budget or Budget(0)
    man = Manifest(os.path.join(out, "manifest.json"), "U.S. Drought Monitor county statistics (NDMC, UNL), cumulative percent of area",
                   API, note="One CSV per year and state: fips, map date, D0-D4 percent of the county's area in that "
                             "category OR WORSE (statisticsType=1), as NDMC sent it.")
    saver = saver or Saver(out, "history usdm-county", every_min=30)
    failed, stopped = [], False
    for y in range(y0, y1 + 1):
        for st in sorted(states):
            key = f"{st}/{y}"
            if man.done(key):
                continue
            if not budget.left():
                stopped = True
                break
            try:
                raw, how = fetch_state_year(fetch, st, states[st], y)
            except FetchError as e:
                log(f"::warning::usdm {key}: {e}")
                failed.append(key)
                continue
            rows, bad = clean_rows(raw)
            complete, maps, have, cover = judge(rows, bad, states[st], y, this_year)
            size = write_csv_gz(os.path.join(out, str(y), f"{st}.csv.gz"), HEADER, rows) if rows else 0
            man.record(key, len(rows), maps[0] if maps else None, maps[-1] if maps else None,
                       url_for(st, date(y, 1, 1), date(y, 12, 31)), complete,
                       maps=len(maps), counties=len(have), cover=round(cover, 3), dropped=bad, how=how, bytes=size)
            if not rows:
                failed.append(key)
            log(f"  {key}: {len(rows)} rows, {len(have)} counties, {len(maps)} maps, {bad} dropped"
                + ("" if complete else " (not final)"))
            saver.tick(man)
        if stopped:
            break
    man.save()
    t = man.totals()
    log(f"usdm-county: {t['rows']} rows in {t['chunks']} state-years ({t['complete']} complete), {t['first']} to {t['last']}"
        + ("; stopped at the time limit, dispatch again to go on" if stopped else ""))
    return failed, stopped


def ongoing(raw_rows, failed_states, window_start, out=OUT, log=print):
    """The weekly job's piece. raw_rows: every parsed API dict it read (all
    states, WINDOW_DAYS back). Rewrites history/usdm-county/<Y>/<ST>.csv.gz
    for each year whose 1 January is inside the window (so the year's file
    holds every map of it to date, never a cut-off start), for every state
    that answered. Writes no manifest (the backfill owns it); logs what it
    wrote to history/usdm-county/weekly/<newest map>.json. -> paths written."""
    rows, bad = clean_rows(raw_rows)
    if not rows:
        return []
    years = [y for y in range(window_start.year, date.fromisoformat(rows[-1][1]).year + 1)
             if date(y, 1, 1) >= window_start]
    by = {}
    for r in rows:
        y = int(r[1][:4])
        if y in years:
            by.setdefault((y, r[0][:2]), []).append(r)
    st_of = {}
    for r in raw_rows:
        s, f = str(r.get("State") or "").strip().upper(), str(r.get("FIPS") or "").strip().zfill(5)
        if len(s) == 2 and f.isdigit():
            st_of[f[:2]] = s
    written = []
    for (y, sf), rs in sorted(by.items()):
        st = st_of.get(sf)
        if not st or st in failed_states:
            continue
        p = os.path.join(out, str(y), f"{st}.csv.gz")
        write_csv_gz(p, HEADER, rs)
        written.append(p)
    newest = rows[-1][1]
    os.makedirs(os.path.join(out, "weekly"), exist_ok=True)
    with open(os.path.join(out, "weekly", f"{newest}.json"), "w", encoding="utf-8") as f:
        json.dump({"newest_map": newest, "years": years, "files": len(written), "rows": len(rows), "dropped": bad,
                   "states_skipped": sorted(failed_states), "written": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}, f)
    log(f"history: {len(written)} state-year files for {years} (newest map {newest})")
    return written


# ------------------------------------------------------------------ selftest
def selftest():
    import tempfile
    from datetime import timedelta
    from history_lib import read_csv_gz
    fails = []

    def ck(name, ok, detail=""):
        print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  {detail}"))
        if not ok:
            fails.append(name)

    fx = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "test", "fixtures", "history", "usdm")
    real = open(os.path.join(fx, "IA-real-2026-10-16.csv"), "rb").read()
    raw = parse(real)
    rows, bad = clean_rows(raw)
    ck("real answer (probe 2026-10-16) parses", len(rows) == len(raw) and bad == 0 and rows[0][:2] == ["19001", "2026-09-15"] and len(rows) == 20, rows[:1])
    ck("figures as sent, zeros trimmed", ["19035", "2026-09-22", "17.81", "0", "0", "0", "0"] in rows, rows)
    ck("fmt", fmt("12.50") == "12.5" and fmt("0.00") == "0" and fmt("100.00") == "100" and fmt("6.79") == "6.79")

    # a year of made-up weekly maps for two Iowa counties, served by state; Story's state call empty -> by county
    def maps(year):
        d = date(year, 1, 1)
        while d.weekday() != 1:
            d += timedelta(days=1)
        while d.year == year:
            yield d
            d += timedelta(days=7)

    def body(fips_list, year, st="IA", bad_rows=0):
        lines = ["MapDate,FIPS,County,State,None,D0,D1,D2,D3,D4,ValidStart,ValidEnd,StatisticFormatID"]
        for f in fips_list:
            for i, m in enumerate(maps(year)):
                d0 = (i * 3) % 60
                lines.append(f"{m:%Y%m%d},{f},X County,{st},{100 - d0:.2f},{d0:.2f},{d0 / 2:.2f},0.00,0.00,0.00,{m},{m},1")
        for _ in range(bad_rows):
            lines.append(f"{year}0105,{fips_list[0]},X County,{st},50.00,40.00,45.00,0.00,0.00,0.00,x,x,1")
        return "\n".join(lines).encode()

    seen = []

    def opener(u):
        seen.append(u)
        y = int(u.split("enddate=12/31/")[1][:4])
        aoi = u.split("aoi=")[1].split("&")[0]
        if aoi == "IA":
            return 200, body(["19001", "19169"], y), {}
        if aoi == "MN":
            return 200, b"", {}
        if aoi in ("27001", "27003"):
            return 200, body([aoi], y, "MN"), {}
        return 404, b"", {}

    states = {"IA": ["19001", "19169"], "MN": ["27001", "27003"]}
    with tempfile.TemporaryDirectory() as d:
        f = Fetcher(min_gap=0, opener=opener, sleep=lambda s: None)
        failed, stopped = run(states, 2024, 2026, out=d, fetch=f, this_year=2026, log=lambda *a: None)
        c = json.load(open(os.path.join(d, "manifest.json")))["chunks"]
        ck("six state-years, none failed", len(c) == 6 and not failed, (sorted(c), failed))
        ck("past years complete, this year not", c["IA/2025"]["complete"] and c["MN/2024"]["complete"] and not c["IA/2026"]["complete"])
        ck("2024 has 53 Tuesday maps", c["IA/2024"]["maps"] == 53 and c["IA/2024"]["rows"] == 106, c["IA/2024"])
        ck("empty state answer -> county by county", c["MN/2025"]["how"] == "county" and c["MN/2025"]["counties"] == 2)
        head, b = read_csv_gz(os.path.join(d, "2025", "IA.csv.gz"))
        ck("file shape", head == HEADER and b[0][:2] == ["19001", "2025-01-07"], b[:1])
        n = len(seen)
        run(states, 2024, 2026, out=d, fetch=f, this_year=2026, log=lambda *a: None)
        ck("resume: only this year asked again", seen[n:] and all("12/31/2026" in u for u in seen[n:]), seen[n:])

        def junk(u):
            y = int(u.split("enddate=12/31/")[1][:4])
            return 200, body(["19001", "19169"], y, bad_rows=5), {}
        d2 = os.path.join(d, "junk")
        run({"IA": states["IA"]}, 2025, 2025, out=d2, fetch=Fetcher(min_gap=0, opener=junk, sleep=lambda s: None), this_year=2026, log=lambda *a: None)
        c2 = json.load(open(os.path.join(d2, "manifest.json")))["chunks"]["IA/2025"]
        ck("over 2% of rows failing the checks: not complete", not c2["complete"] and c2["dropped"] == 5, c2)
        d3 = os.path.join(d, "thin")
        run({"IA": states["IA"] + ["19003", "19005"]}, 2025, 2025, out=d3, fetch=f, this_year=2026, log=lambda *a: None)
        ck("half the counties missing: not complete", not json.load(open(os.path.join(d3, "manifest.json")))["chunks"]["IA/2025"]["complete"])

        # ongoing: a 378-day window read on 2027-01-08 rewrites 2026 whole and 2027, never 2025
        d4 = os.path.join(d, "weekly")
        raw2 = parse(body(["19001"], 2025)) + parse(body(["19001"], 2026)) + parse(body(["19001"], 2027)[:400])
        raw2 = [r for r in raw2 if r["MapDate"] >= "20251226"]
        got = ongoing(raw2, set(), date(2027, 1, 8) - timedelta(days=378), out=d4, log=lambda *a: None)
        ck("ongoing: whole years only", sorted(os.path.relpath(p, d4) for p in got) == ["2026/IA.csv.gz", "2027/IA.csv.gz"], got)
        ck("ongoing: no manifest written", not os.path.exists(os.path.join(d4, "manifest.json")))
        ck("ongoing: a state that failed is not written",
           ongoing(raw2, {"IA"}, date(2027, 1, 8) - timedelta(days=378), out=os.path.join(d, "w2"), log=lambda *a: None) == [])
    print(f"backfill_usdm selftest: {len(fails)} failure(s)")
    return 1 if fails else 0


def main(argv=None):
    ap = argparse.ArgumentParser(prog="backfill_usdm.py")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--from", dest="y0", type=int, default=FIRST_YEAR)
    ap.add_argument("--to", dest="y1", type=int, default=datetime.now(timezone.utc).year)
    ap.add_argument("--states", default="")
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--max-minutes", type=float, default=0)
    a = ap.parse_args(argv)
    if a.selftest:
        return selftest()
    states = states_index()
    if a.states:
        want = {s.strip().upper() for s in a.states.split(",") if s.strip()}
        states = {k: v for k, v in states.items() if k in want}
    failed, _ = run(states, max(a.y0, FIRST_YEAR), a.y1, out=a.out, budget=Budget(a.max_minutes))
    if failed:
        print(f"::warning::usdm: {len(failed)} state-years not read this run: {', '.join(failed[:20])} (dispatch again)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
