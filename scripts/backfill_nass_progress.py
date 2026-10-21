#!/usr/bin/env python3
"""backfill_nass_progress.py -- NASS Crop Progress and Condition, weekly,
national and every state, every crop, as far back as Quick Stats has it, to
the private raw branch (history/nass-progress/).

  One-time backfill:  history-backfill.yml, source=nass (dispatch only).
  Ongoing:            crop_progress.yml runs `--current` after its own fetch
                      (last year, this year and next: NASS files fall-seeded
                      winter wheat under the next year), so no new schedule.

SOURCE: USDA NASS Quick Stats, the API scripts/fetch_crop_progress.py reads,
with the same NASS_API_KEY secret (from the environment only; the key is never
written to a file or a log line, and the URLs in the manifest carry no key):
  https://quickstats.nass.usda.gov/api/get_counts/   (rows a query would return)
  https://quickstats.nass.usda.gov/api/api_GET/      (the rows, 50,000 at most per call)
One chunk per statistic (PROGRESS, CONDITION) and year, asked as
  source_desc=SURVEY, statisticcat_desc=<stat>, freq_desc=WEEKLY, year=<year>
(no sector or level filter, so pasture condition and the national rows come
too). The count is asked first: over 50,000 the chunk is split into NATIONAL
and STATE, and STATE into one call per state. A year Quick Stats counts as 0
is recorded and not asked again.

WHAT IS WRITTEN
  history/nass-progress/<progress|condition>/<YYYY>.csv.gz   the columns in KEEP, as NASS sent them
  history/nass-progress/manifest.json                        rows, first/last week, query, fetched, complete
  A chunk is complete when the rows read equal NASS's count and the year is
  at least two years back (NASS revises late weeks and files next year's
  winter wheat early).

    python3 scripts/backfill_nass_progress.py --selftest
    python3 scripts/backfill_nass_progress.py [--from 1950] [--to 2026] [--max-minutes 300]
    python3 scripts/backfill_nass_progress.py --current      # the crop_progress.yml step
"""
import argparse
import json
import os
import sys
import urllib.parse
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from history_lib import Budget, Fetcher, FetchError, Manifest, Saver, write_csv_gz  # noqa: E402

BASE = "https://quickstats.nass.usda.gov/api/"
OUT = "history/nass-progress"
FIRST_YEAR = 1950
LIMIT = 50000
STATS = ("PROGRESS", "CONDITION")
KEEP = ["year", "week_ending", "reference_period_desc", "begin_code", "end_code", "agg_level_desc",
        "state_alpha", "state_fips_code", "commodity_desc", "class_desc", "prodn_practice_desc",
        "util_practice_desc", "statisticcat_desc", "unit_desc", "short_desc", "Value", "load_time"]
STATES = ("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND "
          "OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY").split()


def query(stat, year, **more):
    q = {"source_desc": "SURVEY", "statisticcat_desc": stat, "freq_desc": "WEEKLY", "year": str(year)}
    q.update(more)
    return q


def public_url(endpoint, q):
    """The URL as recorded: never the key."""
    return BASE + endpoint + "/?" + urllib.parse.urlencode(q)


class Client:
    def __init__(self, key, fetch=None):
        self.key = key or ""
        self.fetch = fetch or Fetcher(min_gap=1.0, ok=(200, 400, 404))   # a 400 carries NASS's reason ("no data")

    def _get(self, endpoint, q):
        u = BASE + endpoint + "/?" + urllib.parse.urlencode(dict(q, key=self.key, format="JSON"))
        try:
            status, body = self.fetch.get(u)
        except FetchError as e:
            raise FetchError(str(e).replace(self.key, "***") if self.key else str(e)) from None
        try:
            doc = json.loads(body.decode("utf-8")) if body else {}
        except ValueError:
            doc = {}
        if status == 200:
            return doc
        err = " ".join(doc.get("error") or []) if isinstance(doc, dict) else ""
        if "no data" in err.lower():
            return {"count": 0, "data": []}
        raise FetchError(f"{endpoint}: HTTP {status} {err[:120]}")

    def count(self, q):
        doc = self._get("get_counts", q)
        try:
            return int(doc.get("count"))
        except (TypeError, ValueError):
            raise FetchError(f"get_counts answered {str(doc)[:120]}")

    def rows(self, q):
        doc = self._get("api_GET", q)
        data = doc.get("data")
        if not isinstance(data, list):
            raise FetchError(f"api_GET answered no data list: {str(doc)[:120]}")
        return data


def fetch_chunk(cli, stat, year):
    """-> (rows, count, parts). Splits a query over the 50,000 limit by level, then by state."""
    plan = [query(stat, year)]
    total = None
    out, parts = [], []
    while plan:
        q = plan.pop(0)
        n = cli.count(q)
        if total is None:
            total = n
        if n == 0:
            continue
        if n > LIMIT:
            if "agg_level_desc" not in q:
                plan += [dict(q, agg_level_desc="NATIONAL"), dict(q, agg_level_desc="STATE")]
                plan += [dict(q, agg_level_desc=lv) for lv in ("REGION : MULTI-STATE",)]
                continue
            if q["agg_level_desc"] == "STATE" and "state_alpha" not in q:
                plan += [dict(q, state_alpha=s) for s in STATES]
                continue
            raise FetchError(f"{stat} {year} {q.get('agg_level_desc')} {q.get('state_alpha', '')}: {n} rows, over the limit and no smaller split")
        got = cli.rows(q)
        if len(got) != n:
            raise FetchError(f"{stat} {year}: {len(got)} rows read where NASS counted {n}")
        out += got
        parts.append({k: v for k, v in q.items() if k in ("agg_level_desc", "state_alpha")} or "all")
    return out, total or 0, parts


def table(rows):
    body = [[r.get(k) for k in KEEP] for r in rows]
    body.sort(key=lambda x: (str(x[1] or ""), str(x[5] or ""), str(x[6] or ""), str(x[8] or ""), str(x[14] or "")))
    return body


def run(y0, y1, out=OUT, cli=None, budget=None, saver=None, this_year=None, stats=STATS, manifest=True, log=print):
    cli = cli or Client(os.environ.get("NASS_API_KEY", ""))
    this_year = this_year or datetime.now(timezone.utc).year
    budget = budget or Budget(0)
    man = Manifest(os.path.join(out, "manifest.json"), "USDA NASS Quick Stats, Crop Progress and Condition (weekly)", BASE,
                   note="One CSV per statistic and year, national and state rows, the KEEP columns as NASS sent them. "
                        "Value is text as published (percent of acreage).")
    if manifest is False:
        man.done = lambda k: False
    saver = saver or Saver(out, "history nass-progress", every_min=30)
    failed, stopped, written = [], False, []
    for y in range(y1, y0 - 1, -1):          # newest first: the useful years land first
        for stat in stats:
            key = f"{stat.lower()}/{y}"
            if man.done(key):
                continue
            if not budget.left():
                stopped = True
                break
            try:
                rows, count, parts = fetch_chunk(cli, stat, y)
            except FetchError as e:
                log(f"::warning::nass {key}: {e}")
                failed.append(key)
                continue
            weeks = sorted({str(r.get("week_ending"))[:10] for r in rows if r.get("week_ending")})
            p = os.path.join(out, stat.lower(), f"{y}.csv.gz")
            size = 0
            if rows:
                size = write_csv_gz(p, KEEP, table(rows))
                written.append(p)
            complete = len(rows) == count and y <= this_year - 2
            man.record(key, len(rows), weeks[0] if weeks else None, weeks[-1] if weeks else None,
                       public_url("api_GET", query(stat, y)), complete, count=count, parts=len(parts), bytes=size,
                       states=len({r.get("state_alpha") for r in rows if r.get("agg_level_desc") == "STATE"}))
            log(f"  {key}: {len(rows)} rows ({count} counted), {len(weeks)} weeks" + ("" if complete else " (not final)"))
            if manifest:
                saver.tick(man)
        if stopped:
            break
    if manifest:
        man.save()
        t = man.totals()
        log(f"nass-progress: {t['rows']} rows in {t['chunks']} chunks ({t['complete']} complete), {t['first']} to {t['last']}"
            + ("; stopped at the time limit, dispatch again to go on" if stopped else ""))
    return failed, stopped, written


def current(out=OUT, cli=None, this_year=None, log=print):
    """crop_progress.yml: last year, this year, next year; no manifest (the backfill owns it)."""
    this_year = this_year or datetime.now(timezone.utc).year
    failed, _, written = run(this_year - 1, this_year + 1, out=out, cli=cli, this_year=this_year, manifest=False, log=log)
    os.makedirs(os.path.join(out, "weekly"), exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    with open(os.path.join(out, "weekly", f"{stamp}.json"), "w", encoding="utf-8") as f:
        json.dump({"years": [this_year - 1, this_year, this_year + 1], "files": [os.path.relpath(p, out) for p in written],
                   "failed": failed, "written": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}, f)
    return failed, written


# ------------------------------------------------------------------ selftest
def selftest():
    import tempfile
    from history_lib import read_csv_gz
    fails = []

    def ck(name, ok, detail=""):
        print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  {detail}"))
        if not ok:
            fails.append(name)

    fx = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "test", "fixtures", "history", "nass")
    sample = json.load(open(os.path.join(fx, "progress-2025.json"), encoding="utf-8"))["data"]
    KEY = "made-up-key-123"
    seen = []

    def make_opener(big=False, refuse=False):
        def opener(u):
            seen.append(u)
            q = {k: v[0] for k, v in urllib.parse.parse_qs(urllib.parse.urlsplit(u).query).items()}
            if refuse:
                return 401, json.dumps({"error": ["unauthorized"]}).encode(), {}
            y = int(q["year"])
            rows = [dict(r, year=str(y), week_ending=str(y) + r["week_ending"][4:]) for r in sample] if y in (2025, 2026, 2027) and q["statisticcat_desc"] == "PROGRESS" else []
            if "agg_level_desc" in q:
                rows = [r for r in rows if r["agg_level_desc"] == q["agg_level_desc"]]
            if "state_alpha" in q:
                rows = [r for r in rows if r["state_alpha"] == q["state_alpha"]]
            if "/get_counts/" in u:
                n = len(rows)
                if big and "state_alpha" not in q:
                    n = LIMIT + 1 if q.get("agg_level_desc") in (None, "STATE") else n
                return 200, json.dumps({"count": n}).encode(), {}
            if not rows:
                return 400, json.dumps({"error": ["bad request - no data"]}).encode(), {}
            return 200, json.dumps({"data": rows}).encode(), {}
        return opener

    with tempfile.TemporaryDirectory() as d:
        cli = Client(KEY, Fetcher(min_gap=0, opener=make_opener(), sleep=lambda s: None, ok=(200, 400, 404)))
        ck("a 400 'no data' answer is 0 rows", cli.rows(query("CONDITION", 2025)) == [])
        failed, stopped, _ = run(2024, 2026, out=d, cli=cli, this_year=2026, log=lambda *a: None)
        mtxt = open(os.path.join(d, "manifest.json")).read()
        c = json.loads(mtxt)["chunks"]
        ck("six chunks, none failed", len(c) == 6 and not failed, (sorted(c), failed))
        ck("2025 progress rows = sample", c["progress/2025"]["rows"] == len(sample) == c["progress/2025"]["count"], c["progress/2025"])
        ck("no data years are 0 rows, complete when old", c["condition/2024"]["rows"] == 0 and c["condition/2024"]["complete"])
        ck("last two years never final", not c["progress/2025"]["complete"] and not c["progress/2026"]["complete"])
        ck("the key is never in the manifest", KEY not in mtxt)
        head, body = read_csv_gz(os.path.join(d, "progress", "2025.csv.gz"))
        ck("KEEP columns", head == KEEP and len(body) == len(sample))
        ck("values as sent", sorted(r[15] for r in body) == sorted(r["Value"] for r in sample))
        ck("weeks span", c["progress/2025"]["first"] == "2025-09-28" and c["progress/2025"]["last"] == "2025-10-05", c["progress/2025"])
        # over the limit: split by level, then by state
        seen.clear()
        cli2 = Client(KEY, Fetcher(min_gap=0, opener=make_opener(big=True), sleep=lambda s: None))
        rows, count, parts = fetch_chunk(cli2, "PROGRESS", 2025)
        ck("split: national + one call per state", len(rows) == len(sample) and {"agg_level_desc": "NATIONAL"} in parts
           and {"agg_level_desc": "STATE", "state_alpha": "IA"} in parts, parts)
        # a refused key: reported, the key not in the message
        logs = []
        cli3 = Client(KEY, Fetcher(min_gap=0, opener=make_opener(refuse=True), sleep=lambda s: None))
        failed, _, _ = run(2025, 2025, out=os.path.join(d, "r"), cli=cli3, this_year=2026, log=logs.append)
        ck("refused: every chunk failed, key never logged", len(failed) == 2 and not any(KEY in l for l in logs), (failed, logs))
        # --current: three years, no manifest
        d2 = os.path.join(d, "cur")
        failed, written = current(out=d2, cli=cli, this_year=2026, log=lambda *a: None)
        ck("current: 2025-2027 progress files, no manifest",
           sorted(os.path.relpath(p, d2) for p in written) == ["progress/2025.csv.gz", "progress/2026.csv.gz", "progress/2027.csv.gz"]
           and not os.path.exists(os.path.join(d2, "manifest.json")), written)
        ck("current: run log", len(os.listdir(os.path.join(d2, "weekly"))) == 1)
    print(f"backfill_nass_progress selftest: {len(fails)} failure(s)")
    return 1 if fails else 0


def main(argv=None):
    ap = argparse.ArgumentParser(prog="backfill_nass_progress.py")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--current", action="store_true")
    ap.add_argument("--from", dest="y0", type=int, default=FIRST_YEAR)
    ap.add_argument("--to", dest="y1", type=int, default=datetime.now(timezone.utc).year + 1)
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--max-minutes", type=float, default=0)
    a = ap.parse_args(argv)
    if a.selftest:
        return selftest()
    if not os.environ.get("NASS_API_KEY"):
        print("::warning::NASS_API_KEY is not set; nothing fetched")
        return 0
    if a.current:
        failed, written = current(out=a.out)
        print(f"nass-progress current: {len(written)} files" + (f"; not read: {', '.join(failed)}" if failed else ""))
        return 0
    failed, _, _ = run(a.y0, a.y1, out=a.out, budget=Budget(a.max_minutes))
    if failed:
        print(f"::warning::nass: not read this run: {', '.join(failed[:20])} (dispatch again)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
