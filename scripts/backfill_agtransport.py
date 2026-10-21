#!/usr/bin/env python3
"""backfill_agtransport.py -- USDA AgTransport history back to 2016, to the
private raw branch (history/agtransport/). One-time backfill, dispatched by
hand: history-backfill.yml, source=agtransport. Never run on a schedule.

THE DATASETS are the ones scripts/fetch_transport.py and fx/transport's
fetch_grain_moves.py read (agtransport.usda.gov, Socrata, no key):
  grain_basis v85y-3hep (USDA weekly regional / state elevator basis),
  barge_rates deqi-uken, grain_price_spreads an4w-mnp7, cost_index 8uye-ieij,
  railcar cvu8-kpyk, lock_tons n4pw-9ygw, car_orders 57pa-stwn,
  train_speed 2wy9-nmz4, carloads tb7q-kn5i, inspections sruw-w49i,
  ocean kscj-g8km, vessels uiht-9xts.

HOW
  The date column of each dataset is read from its own metadata
  (/api/views/<id>.json), never assumed (fetch_grain_moves.py's rule). Then one
  chunk per dataset and calendar year:
    count first:  $select=count(*) with the year's $where
    then pages:   $where, $order=:id, $limit=50000, $offset=0, 50000, ...
  A year is "complete" only when the rows read equal the count AND the year is
  over; the current year is always fetched again. Every row is kept as USDA
  sent it (all columns, text as given), one CSV per dataset-year:
    history/agtransport/<name>/<YYYY>.csv.gz
    history/agtransport/meta/<name>.json       the dataset's column list
    history/agtransport/manifest.json          rows, first/last date, URL, fetched, complete
  Polite: one request at a time, at least 1 s apart (SOCRATA_APP_TOKEN, if
  set as a secret, is sent as X-App-Token), retries with backoff.

    python3 scripts/backfill_agtransport.py --selftest
    python3 scripts/backfill_agtransport.py [--from 2016] [--only grain_basis,barge_rates] [--max-minutes 300]
"""
import argparse
import json
import os
import sys
import urllib.parse
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from history_lib import Budget, Fetcher, FetchError, Manifest, Saver, write_csv_gz  # noqa: E402

HOST = "https://agtransport.usda.gov"
OUT = "history/agtransport"
FIRST_YEAR = 2016
PAGE = 50000
DATASETS = {
    "grain_basis": "v85y-3hep",
    "barge_rates": "deqi-uken",
    "grain_price_spreads": "an4w-mnp7",
    "cost_index": "8uye-ieij",
    "railcar": "cvu8-kpyk",
    "lock_tons": "n4pw-9ygw",
    "car_orders": "57pa-stwn",
    "train_speed": "2wy9-nmz4",
    "carloads": "tb7q-kn5i",
    "inspections": "sruw-w49i",
    "ocean": "kscj-g8km",
    "vessels": "uiht-9xts",
}


def date_column(meta):
    """The dataset's date column from /api/views/<id>.json: a calendar_date
    column named 'date' first, else the first calendar_date column, else the
    first column whose name says date or week. None if there is none."""
    cols = [c for c in (meta or {}).get("columns") or [] if isinstance(c, dict) and c.get("fieldName")
            and not str(c["fieldName"]).startswith(":")]
    cal = [c["fieldName"] for c in cols if c.get("dataTypeName") in ("calendar_date", "date")]
    if "date" in cal:
        return "date"
    if cal:
        return cal[0]
    for c in cols:
        n = str(c["fieldName"]).lower()
        if "date" in n or "week" in n:
            return c["fieldName"]
    return None


def year_where(col, year):
    return f"{col} >= '{year}-01-01T00:00:00' AND {col} < '{year + 1}-01-01T00:00:00'"


def url(ds, params):
    return f"{HOST}/resource/{ds}.json?" + urllib.parse.urlencode(params)


def get_json(fetch, u):
    status, body = fetch.get(u)
    if status != 200:
        raise FetchError(f"{u.split('?')[0]}: HTTP {status}")
    return json.loads(body.decode("utf-8"))


def fetch_year(fetch, ds, col, year, page=PAGE):
    """-> (rows, count). count is USDA's own count(*) for the year."""
    where = year_where(col, year)
    got = get_json(fetch, url(ds, {"$select": "count(*)", "$where": where}))
    try:
        count = int(list(got[0].values())[0]) if got else 0
    except (TypeError, ValueError, IndexError, AttributeError):
        raise FetchError(f"{ds} {year}: count(*) answered {str(got)[:120]}")
    rows, off = [], 0
    while off < max(count, 1):
        part = get_json(fetch, url(ds, {"$where": where, "$order": ":id", "$limit": page, "$offset": off}))
        if not isinstance(part, list):
            raise FetchError(f"{ds} {year}: page at {off} is not a list")
        rows += [r for r in part if isinstance(r, dict)]
        if len(part) < page:
            break
        off += page
    return rows, count


def to_table(rows, col):
    """Every column USDA sent, sorted by name with the date column first; rows by date."""
    keys = sorted({k for r in rows for k in r if not str(k).startswith(":")})
    if col in keys:
        keys.remove(col)
        keys.insert(0, col)
    out = []
    for r in rows:
        out.append([json.dumps(r[k], separators=(",", ":"), sort_keys=True) if isinstance(r.get(k), (dict, list)) else r.get(k)
                    for k in keys])
    out.sort(key=lambda x: (str(x[0] or ""), json.dumps(x, default=str)))
    return keys, out


def run(names, y0, y1, out=OUT, fetch=None, budget=None, saver=None, this_year=None, page=PAGE, log=print):
    fetch = fetch or Fetcher(min_gap=1.0, headers=({"X-App-Token": os.environ["SOCRATA_APP_TOKEN"]}
                                                   if os.environ.get("SOCRATA_APP_TOKEN") else None))
    this_year = this_year or datetime.now(timezone.utc).year
    budget = budget or Budget(0)
    man = Manifest(os.path.join(out, "manifest.json"), "USDA AMS AgTransport (Socrata)", HOST,
                   note="One CSV per dataset and calendar year, every column as USDA sent it. "
                        "complete = rows read equal USDA's count(*) and the year is over.")
    saver = saver or Saver(out, "history agtransport", every_min=30)
    failed, stopped = [], False
    for name in names:
        ds = DATASETS[name]
        todo = [y for y in range(y0, y1 + 1) if not man.done(f"{name}/{y}")]
        if not todo:
            log(f"  {name}: every year {y0}-{y1} already complete")
            continue
        if not budget.left():
            stopped = True
            break
        try:
            meta = get_json(fetch, f"{HOST}/api/views/{ds}.json")
        except (FetchError, ValueError) as e:
            log(f"::warning::{name} ({ds}): metadata not read: {e}")
            failed.append(name)
            continue
        col = date_column(meta)
        os.makedirs(os.path.join(out, "meta"), exist_ok=True)
        with open(os.path.join(out, "meta", f"{name}.json"), "w", encoding="utf-8") as f:
            json.dump({"id": ds, "name": meta.get("name"), "date_column": col,
                       "columns": [{k: c.get(k) for k in ("fieldName", "name", "dataTypeName", "description")}
                                   for c in meta.get("columns") or [] if isinstance(c, dict)]}, f, indent=1)
        if not col:
            log(f"::warning::{name} ({ds}): no date column in its metadata; skipped")
            failed.append(name)
            continue
        for y in todo:
            if not budget.left():
                stopped = True
                break
            try:
                rows, count = fetch_year(fetch, ds, col, y, page=page)
            except (FetchError, ValueError) as e:
                log(f"::warning::{name} {y}: {e}")
                failed.append(f"{name}/{y}")
                continue
            keys, table = to_table(rows, col)
            dates = [str(r[0])[:10] for r in table if r and r[0]]
            p = os.path.join(out, name, f"{y}.csv.gz")
            size = write_csv_gz(p, keys, table) if table else 0
            complete = len(rows) == count and y < this_year
            man.record(f"{name}/{y}", len(rows), min(dates) if dates else None, max(dates) if dates else None,
                       url(ds, {"$where": year_where(col, y)}), complete, count=count, bytes=size, dataset=ds)
            log(f"  {name} {y}: {len(rows)} rows (USDA count {count}){'' if complete else ' (not final)'}")
            saver.tick(man)
        if stopped:
            break
    man.save()
    t = man.totals()
    log(f"agtransport: {t['rows']} rows in {t['chunks']} chunks ({t['complete']} complete), {t['first']} to {t['last']}"
        + ("; stopped at the time limit, dispatch again to go on" if stopped else ""))
    return failed, stopped


# ------------------------------------------------------------------ selftest
def selftest():
    import tempfile
    fails = []

    def ck(name, ok, detail=""):
        print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  {detail}"))
        if not ok:
            fails.append(name)

    fx = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "test", "fixtures", "history", "agtransport")
    meta = json.load(open(os.path.join(fx, "views-deqi-uken.json"), encoding="utf-8"))
    rows = json.load(open(os.path.join(fx, "barge-2025.json"), encoding="utf-8"))
    ck("date column from metadata", date_column(meta) == "date", date_column(meta))
    ck("date column fallback: first calendar_date", date_column({"columns": [{"fieldName": "x", "dataTypeName": "text"},
       {"fieldName": "week_ending", "dataTypeName": "calendar_date"}]}) == "week_ending")
    ck("no date column", date_column({"columns": [{"fieldName": "x", "dataTypeName": "text"}]}) is None)
    calls = []

    def opener(u):
        calls.append(u)
        q = urllib.parse.parse_qs(urllib.parse.urlsplit(u).query)
        if "/api/views/" in u:
            return 200, json.dumps(meta).encode(), {}
        yr = int(q["$where"][0].split("'")[1][:4])
        mine = [r for r in rows if r["date"].startswith(str(yr))] if yr == 2025 else []
        if q.get("$select") == ["count(*)"]:
            return 200, json.dumps([{"count": str(len(mine))}]).encode(), {}
        off, lim = int(q["$offset"][0]), int(q["$limit"][0])
        return 200, json.dumps(mine[off:off + lim]).encode(), {}

    with tempfile.TemporaryDirectory() as d:
        f = Fetcher(min_gap=0, opener=opener, sleep=lambda s: None)
        failed, stopped = run(["barge_rates"], 2024, 2026, out=d, fetch=f, this_year=2026, page=4, log=lambda *a: None)
        m = json.load(open(os.path.join(d, "manifest.json")))
        c = m["chunks"]
        ck("three chunks, no failures", sorted(c) == ["barge_rates/2024", "barge_rates/2025", "barge_rates/2026"] and not failed, (sorted(c), failed))
        ck("2025: every row over pages of 4", c["barge_rates/2025"]["rows"] == len(rows) == c["barge_rates/2025"]["count"], c["barge_rates/2025"])
        ck("2025 complete, 2026 (this year) not", c["barge_rates/2025"]["complete"] and not c["barge_rates/2026"]["complete"])
        ck("span", c["barge_rates/2025"]["first"] == "2025-01-07" and c["barge_rates/2025"]["last"] == "2025-03-04", c["barge_rates/2025"])
        from history_lib import read_csv_gz
        head, body = read_csv_gz(os.path.join(d, "barge_rates", "2025.csv.gz"))
        ck("every column kept, date first", head == ["date", "location", "rate"], head)
        ck("rows sorted by date", [r[0] for r in body] == sorted(r[0] for r in body))
        ck("ordered by :id for stable pages", all("%24order=%3Aid" in u for u in calls if "%24offset" in u))
        ck("meta saved", json.load(open(os.path.join(d, "meta", "barge_rates.json")))["date_column"] == "date")
        n = len(calls)
        run(["barge_rates"], 2024, 2026, out=d, fetch=f, this_year=2026, page=4, log=lambda *a: None)
        again = calls[n:]
        ck("resume: complete years skipped, this year asked again",
           not any("2025-01-01" in urllib.parse.unquote(u) for u in again) and any("2026-01-01" in urllib.parse.unquote(u) for u in again), again)
        # a short read is never complete
        def short(u):
            s, b, h = opener(u)
            if "%24offset=4" in u:
                return 200, b"[]", {}
            return s, b, h
        d2 = os.path.join(d, "short")
        run(["barge_rates"], 2025, 2025, out=d2, fetch=Fetcher(min_gap=0, opener=short, sleep=lambda s: None), this_year=2026, page=4, log=lambda *a: None)
        c2 = json.load(open(os.path.join(d2, "manifest.json")))["chunks"]["barge_rates/2025"]
        ck("rows short of USDA's count: not complete", not c2["complete"] and c2["rows"] == 4 and c2["count"] == len(rows), c2)
        # a refused dataset is reported, the rest goes on
        def refuse(u):
            return (403, b"", {}) if "/api/views/" in u else opener(u)
        d3 = os.path.join(d, "refused")
        failed, _ = run(["barge_rates"], 2025, 2025, out=d3, fetch=Fetcher(min_gap=0, opener=refuse, sleep=lambda s: None), this_year=2026, log=lambda *a: None)
        ck("metadata refused: reported, nothing written", failed == ["barge_rates"] and not os.path.exists(os.path.join(d3, "barge_rates")), failed)
        # the time limit stops before a chunk, never inside one
        tick = [0]
        b = Budget(1, clock=lambda: tick[0])
        tick[0] = 120
        d4 = os.path.join(d, "budget")
        _, stopped = run(["barge_rates"], 2025, 2025, out=d4, fetch=f, budget=b, this_year=2026, log=lambda *a: None)
        ck("time limit: stops cleanly", stopped and json.load(open(os.path.join(d4, "manifest.json")))["chunks"] == {})
    ck("every dataset id is a Socrata 4x4", all(len(v) == 9 and v[4] == "-" for v in DATASETS.values()))
    print(f"backfill_agtransport selftest: {len(fails)} failure(s)")
    return 1 if fails else 0


def main(argv=None):
    ap = argparse.ArgumentParser(prog="backfill_agtransport.py")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--from", dest="y0", type=int, default=FIRST_YEAR)
    ap.add_argument("--to", dest="y1", type=int, default=datetime.now(timezone.utc).year)
    ap.add_argument("--only", default="")
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--max-minutes", type=float, default=0)
    a = ap.parse_args(argv)
    if a.selftest:
        return selftest()
    names = [n.strip() for n in a.only.split(",") if n.strip()] or list(DATASETS)
    bad = [n for n in names if n not in DATASETS]
    if bad:
        print(f"unknown dataset(s) {bad}; known: {', '.join(DATASETS)}")
        return 2
    failed, _ = run(names, a.y0, a.y1, out=a.out, budget=Budget(a.max_minutes))
    if failed:
        print(f"::warning::agtransport: not read this run: {', '.join(failed)} (dispatch again; done chunks are kept)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
