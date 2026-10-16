#!/usr/bin/env python3
"""
fetch_drought_county_week.py -- this week's Drought Monitor numbers for every
county, with last week and four weeks back -> data/drought/county-week.json

Read by the county box on drought-monitor.html, only when a reader picks a
county. One national file, rewritten each Thursday after the map comes out.

ONE SOURCE
  USDM county statistics API (National Drought Mitigation Center, UNL), the
  same endpoint scripts/fetch_atlas_drought.py reads for the Atlas:
    https://usdmdataservices.unl.edu/api/CountyStatistics/GetDroughtSeverityStatisticsByAreaPercent
      ?aoi=<state or FIPS>&startdate=M/D/YYYY&enddate=M/D/YYYY&statisticsType=1
  statisticsType=1 is cumulative: D1 is the percent of the county's area in
  D1 OR WORSE, so D0 >= D1 >= D2 >= D3 >= D4, and None + D0 = 100.
  One call per state (aoi=IA). If a state call comes back empty, that state's
  counties are asked one at a time instead (aoi=19169), the form the Atlas
  fetcher has used since 2026-09.

WHAT IS WRITTEN
  The newest weekly map, the one 7 days before it and the one 28 days before
  it, each as [D0, D1, D2, D3, D4] cumulative percent of area, one decimal.
  No number is made here: every figure is NDMC's, rounded to one decimal.
  Counties at zero in all three maps are listed in "zero" instead of
  repeating fifteen zeros, which keeps the file small.

WHAT IS REFUSED
  A row whose percentages are out of 0-100, not cumulative (D1 above D0), or
  whose None + D0 is not 100 (within 0.6) is dropped and counted. If more than
  2% of rows are dropped, or the newest map covers under 90% of the Atlas's
  counties, or the newest map is more than 16 days old, or it is not dated a
  Tuesday, nothing is written and the old file stays.

USAGE
  python scripts/fetch_drought_county_week.py --selftest
  python scripts/fetch_drought_county_week.py --probe   # save raw answers to data/drought/probe/ first
  python scripts/fetch_drought_county_week.py
"""

import concurrent.futures
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_atlas_drought import parse  # noqa: E402  one parser for both USDM readers

API = "https://usdmdataservices.unl.edu/api/CountyStatistics/GetDroughtSeverityStatisticsByAreaPercent"
OUT = "data/drought/county-week.json"
PROBE_DIR = "data/drought/probe"
INDEX = "farmland-atlas/data/counties-index.json"
UA = "AGSIST-automation/1.0 (+https://agsist.com/drought-monitor)"
WINDOW_DAYS = 42
MAX_AGE_DAYS = 16
MIN_COVERAGE = 0.90
MAX_BAD_SHARE = 0.02
TOL = 0.6
WORKERS = 4


def http_get(url, retries=3):
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json, text/csv;q=0.9, */*;q=0.5"})
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            last = e
            if e.code == 404:
                return b""
            time.sleep(30 if e.code == 429 else 8 * (attempt + 1))
        except Exception as e:  # network: retry, then give up loudly
            last = e
            time.sleep(8 * (attempt + 1))
    raise RuntimeError(f"{url}: {type(last).__name__}: {last}")


def url_for(aoi, start, end):
    f = lambda d: f"{d.month}/{d.day}/{d.year}"
    return f"{API}?aoi={aoi}&startdate={f(start)}&enddate={f(end)}&statisticsType=1"


def map_date(v):
    """'20261013', '2026-10-13', '2026-10-13T00:00:00' -> date, else None."""
    t = str(v or "").strip()
    try:
        if len(t) >= 10 and t[4] == "-":
            return date.fromisoformat(t[:10])
        if len(t) == 8 and t.isdigit():
            return date(int(t[:4]), int(t[4:6]), int(t[6:]))
    except ValueError:
        return None
    return None


def check_row(r):
    """One API row -> (fips, date, [d0..d4]) or (None, reason)."""
    fips = str(r.get("FIPS") or "").strip()
    if fips.isdigit() and len(fips) < 5:
        fips = fips.zfill(5)
    if not (len(fips) == 5 and fips.isdigit()):
        return None, "fips"
    d = map_date(r.get("MapDate"))
    if d is None:
        return None, "date"
    try:
        none = float(r.get("None"))
        v = [float(r.get(k)) for k in ("D0", "D1", "D2", "D3", "D4")]
    except (TypeError, ValueError):
        return None, "number"
    if any(x < -0.001 or x > 100.001 for x in v + [none]):
        return None, "range"
    if any(v[i + 1] > v[i] + 0.01 for i in range(4)):
        return None, "not cumulative"
    if abs(none + v[0] - 100.0) > TOL:
        return None, "none+d0"
    # whole numbers go out as 0 and 100, not 0.0 and 100.0: a third of the file is zeros
    return (fips, d, [int(y) if y == int(y) else y for y in (round(x, 1) for x in v)]), None


def build(rows, today, expected):
    """rows: API dicts. expected: set of FIPS the Atlas has. -> (doc, problems).
    doc is None when the read must not be published."""
    by = {}
    bad = {}
    for r in rows:
        got, why = check_row(r)
        if got is None:
            bad[why] = bad.get(why, 0) + 1
            continue
        fips, d, v = got
        by.setdefault(fips, {})[d] = v
    n_bad = sum(bad.values())
    problems = []
    if not by:
        return None, ["no valid rows"]
    if rows and n_bad / len(rows) > MAX_BAD_SHARE:
        problems.append(f"{n_bad} of {len(rows)} rows failed checks {bad}")
    dates = sorted({d for c in by.values() for d in c})
    latest = dates[-1]
    if latest.weekday() != 1:
        problems.append(f"newest map {latest} is not a Tuesday")
    if (today - latest).days > MAX_AGE_DAYS:
        problems.append(f"newest map {latest} is {(today - latest).days} days old")
    prev, prev4 = latest - timedelta(days=7), latest - timedelta(days=28)
    have = {f for f, c in by.items() if latest in c}
    cover = len(have & expected) / len(expected) if expected else 0
    if cover < MIN_COVERAGE:
        problems.append(f"newest map covers {len(have & expected)} of {len(expected)} counties")
    if problems:
        return None, problems
    zero, c = [], {}
    for f in sorted(have):
        w = [by[f].get(latest), by[f].get(prev), by[f].get(prev4)]
        if all(x is not None and not any(x) for x in w):
            zero.append(f)
            continue
        c[f] = w
    doc = {
        "source": "U.S. Drought Monitor county statistics (NDMC, University of Nebraska-Lincoln), cumulative percent of county area",
        "url": API,
        "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "valid": latest.isoformat(), "prev": prev.isoformat(), "prev4": prev4.isoformat(),
        "cols": ["d0", "d1", "d2", "d3", "d4"],
        "note": "Each county: [this week, last week, four weeks back], each [D0, D1, D2, D3, D4] as the percent of the county's area in that category OR WORSE (D1 includes D2-D4). null = no map that week. Counties in 'zero' had no D0-D4 in all three maps.",
        "counties": len(have), "dropped_rows": n_bad,
        "zero": zero, "c": c,
    }
    return doc, []


def states_from_index():
    with open(INDEX, encoding="utf-8") as f:
        idx = json.load(f)
    st = {}
    for fips, name, _ in idx:
        st.setdefault(name.rsplit(", ", 1)[-1], []).append(fips)
    return st


def fetch_all(start, end, states):
    rows, failed = [], []

    def one_state(item):
        st, fl = item
        try:
            got = parse(http_get(url_for(st, start, end)))
        except RuntimeError as e:
            got, err = [], e
        else:
            err = None
        if got:
            return st, got, None
        # the state form gave nothing: ask county by county
        out = []
        for f in fl:
            try:
                out += parse(http_get(url_for(f, start, end)))
            except RuntimeError as e:
                err = e
            time.sleep(0.2)
        return st, out, (err if not out else None)

    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
        for st, got, err in pool.map(one_state, sorted(states.items())):
            if err is not None or not got:
                failed.append(st)
                print(f"  {st}: nothing ({err})", flush=True)
            rows += got
    return rows, failed


def probe():
    """Save what the API says, for one state and one county, before trusting the parser."""
    os.makedirs(PROBE_DIR, exist_ok=True)
    today = datetime.now(timezone.utc).date()
    start = today - timedelta(days=WINDOW_DAYS)
    for aoi in ("IA", "19169", "OK"):
        u = url_for(aoi, start, today)
        try:
            b = http_get(u)
        except RuntimeError as e:
            b = str(e).encode()
        with open(os.path.join(PROBE_DIR, f"{aoi}.txt"), "wb") as f:
            f.write(u.encode() + b"\n\n" + b[:400000])
        rows = parse(b) if b else []
        print(f"  {aoi}: {len(b)} bytes, {len(rows)} rows; first: {rows[:1]}", flush=True)


def selftest():
    today = date(2026, 10, 16)
    mk = lambda f, d, none, d0, d1, d2, d3, d4: {"MapDate": d, "FIPS": f, "None": none, "D0": d0, "D1": d1, "D2": d2, "D3": d3, "D4": d4}
    rows = [
        mk("19169", "20261013", "60.00", "40.00", "25.50", "10.04", "0.00", "0.00"),
        mk("19169", "20261006", "70.00", "30.00", "20.00", "0.00", "0.00", "0.00"),
        mk("19169", "20260915", "100.00", "0.00", "0.00", "0.00", "0.00", "0.00"),
        mk("19001", "2026-10-13", "100", "0", "0", "0", "0", "0"),
        mk("19001", "2026-10-06", "100", "0", "0", "0", "0", "0"),
        mk("19001", "2026-09-15", "100", "0", "0", "0", "0", "0"),
        mk("40139", "20261013", "0", "100", "100", "80.25", "33.33", "0"),
    ]
    doc, p = build(rows, today, {"19169", "19001", "40139"})
    assert not p, p
    assert doc["valid"] == "2026-10-13" and doc["prev"] == "2026-10-06" and doc["prev4"] == "2026-09-15"
    assert doc["c"]["19169"] == [[40.0, 25.5, 10.0, 0.0, 0.0], [30.0, 20.0, 0.0, 0.0, 0.0], [0.0, 0.0, 0.0, 0.0, 0.0]], doc["c"]["19169"]
    assert doc["zero"] == ["19001"] and doc["c"]["40139"] == [[100.0, 100.0, 80.2, 33.3, 0.0], None, None], doc
    # refusals
    assert check_row(mk("19169", "20261013", "60", "40", "45", "0", "0", "0"))[1] == "not cumulative"
    assert check_row(mk("19169", "20261013", "50", "40", "0", "0", "0", "0"))[1] == "none+d0"
    assert check_row(mk("19169", "20261013", "0", "140", "0", "0", "0", "0"))[1] == "range"
    assert check_row(mk("x", "20261013", "100", "0", "0", "0", "0", "0"))[1] == "fips"
    assert check_row(mk("1001", "20261013", "100", "0", "0", "0", "0", "0"))[0][0] == "01001"
    assert build(rows, date(2026, 11, 10), {"19169", "19001", "40139"})[0] is None            # stale
    assert build(rows, today, {"19169", "19001", "40139", "1", "2"})[0] is None               # coverage 3/5
    wed = [dict(r, MapDate="20261014") for r in rows[:1]]
    assert "not a Tuesday" in build(wed, today, {"19169"})[1][0]
    junk = rows + [mk("19169", "20261013", "0", "1", "2", "0", "0", "0")] * 3
    assert build(junk, today, {"19169", "19001", "40139"})[0] is None                         # 3 of 10 bad
    assert url_for("IA", date(2026, 9, 4), date(2026, 10, 16)).endswith("aoi=IA&startdate=9/4/2026&enddate=10/16/2026&statisticsType=1")
    print("selftest ok")


def main():
    if "--selftest" in sys.argv:
        return selftest()
    if "--probe" in sys.argv:
        return probe()
    today = datetime.now(timezone.utc).date()
    states = states_from_index()
    expected = {f for fl in states.values() for f in fl}
    rows, failed = fetch_all(today - timedelta(days=WINDOW_DAYS), today, states)
    print(f"  {len(rows)} rows, states with nothing: {failed or 'none'}", flush=True)
    doc, problems = build(rows, today, expected)
    if doc is None:
        sys.exit("refusing to write: " + "; ".join(problems))
    if os.path.exists(OUT):
        with open(OUT, encoding="utf-8") as f:
            old = json.load(f)
        if old.get("valid", "") > doc["valid"]:
            sys.exit(f"refusing to write: the file already holds {old['valid']}, newer than {doc['valid']}")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(doc, f, separators=(",", ":"))
    print(f"wrote {OUT}: map valid {doc['valid']}, {doc['counties']} counties, {len(doc['zero'])} at zero, {doc['dropped_rows']} rows dropped", flush=True)


if __name__ == "__main__":
    sys.exit(main())
