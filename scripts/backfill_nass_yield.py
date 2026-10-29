#!/usr/bin/env python3
"""backfill_nass_yield.py -- NASS state yields (annual, every year Quick Stats
has), corn and soybeans, to the private raw branch (history/nass-yield/). The
target the re-test engine scores the ratings-to-yield specs against
(god's-eye panel bet 5, Oct 27 2026; scripts/insight_registry.json).

  Backfill:  history-backfill.yml, source=nass-yield (dispatch only).
  Ongoing:   nass-series.yml (monthly, the 16th) runs it again after its own
             commit, so January's final yields land without a new schedule.

SOURCE: USDA NASS Quick Stats, the API scripts/backfill_nass_progress.py reads,
with the same NASS_API_KEY secret (from the environment only; never written to
a file or a log line, and the URLs in the manifest carry no key):
  https://quickstats.nass.usda.gov/api/get_counts/
  https://quickstats.nass.usda.gov/api/api_GET/
One chunk per crop, asked as
  source_desc=SURVEY, sector_desc=CROPS, commodity_desc=<CORN|SOYBEANS>,
  statisticcat_desc=YIELD, agg_level_desc=STATE, freq_desc=ANNUAL,
  reference_period_desc=YEAR
so two calls per crop (count, rows): about four calls in all. Over 50,000
rows a chunk is split into year ranges. reference_period_desc=YEAR is the
final estimate as Quick Stats holds it TODAY: later revisions included, never
the as-first-published number, and never the August to November forecasts.

WHAT IS WRITTEN
  history/nass-yield/<corn|soybeans>.csv.gz   the KEEP columns as NASS sent them
  history/nass-yield/manifest.json            rows, first/last year, query, fetched, complete
Every run fetches both crops again (four calls; NASS revises old years), so a
chunk is complete when the rows read equal NASS's count.

    python3 scripts/backfill_nass_yield.py --selftest
    python3 scripts/backfill_nass_yield.py
"""
import argparse
import json
import os
import sys
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from history_lib import Fetcher, FetchError, Manifest, write_csv_gz  # noqa: E402

BASE = "https://quickstats.nass.usda.gov/api/"
OUT = "history/nass-yield"
LIMIT = 50000
CROPS = ("CORN", "SOYBEANS")
KEEP = ["year", "reference_period_desc", "agg_level_desc", "state_alpha", "state_fips_code", "commodity_desc",
        "class_desc", "prodn_practice_desc", "util_practice_desc", "statisticcat_desc", "unit_desc", "short_desc",
        "Value", "CV (%)", "load_time"]
SPLITS = ((1800, 1949), (1950, 1989), (1990, 2100))


def query(crop, **more):
    q = {"source_desc": "SURVEY", "sector_desc": "CROPS", "commodity_desc": crop, "statisticcat_desc": "YIELD",
         "agg_level_desc": "STATE", "freq_desc": "ANNUAL", "reference_period_desc": "YEAR"}
    q.update(more)
    return q


def public_url(endpoint, q):
    """The URL as recorded: never the key."""
    return BASE + endpoint + "/?" + urllib.parse.urlencode(q)


class Client:
    def __init__(self, key, fetch=None):
        self.key = key or ""
        self.fetch = fetch or Fetcher(min_gap=1.0, ok=(200, 400, 404))

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
        data = self._get("api_GET", q).get("data")
        if not isinstance(data, list):
            raise FetchError(f"api_GET answered no data list: {str(data)[:120]}")
        return data


def fetch_crop(cli, crop):
    """-> (rows, count, parts). One call when it fits, else one per year range."""
    q = query(crop)
    total = cli.count(q)
    plan = [q] if total <= LIMIT else [dict(q, year__GE=str(a), year__LE=str(b)) for a, b in SPLITS]
    out, parts, counted = [], [], 0
    for p in plan:
        n = total if p is q else cli.count(p)
        counted += n if p is not q else 0
        if n == 0:
            continue
        if n > LIMIT:
            raise FetchError(f"{crop} {p.get('year__GE')}-{p.get('year__LE')}: {n} rows, over the limit")
        got = cli.rows(p)
        if len(got) != n:
            raise FetchError(f"{crop}: {len(got)} rows read where NASS counted {n}")
        out += got
        parts.append({k: v for k, v in p.items() if k.startswith("year")} or "all")
    if plan[0] is not q and counted != total:
        raise FetchError(f"{crop}: the year ranges count {counted}, the whole query {total}")
    return out, total, parts


def table(rows):
    body = [[r.get(k) for k in KEEP] for r in rows]
    body.sort(key=lambda x: (str(x[0] or ""), str(x[3] or ""), str(x[11] or "")))
    return body


def run(out=OUT, cli=None, crops=CROPS, log=print):
    cli = cli or Client(os.environ.get("NASS_API_KEY", ""))
    man = Manifest(os.path.join(out, "manifest.json"), "USDA NASS Quick Stats, state yields (annual, final)", BASE,
                   note="One CSV per crop, state rows, reference period YEAR (the final estimate as Quick Stats "
                        "holds it now, revisions included), the KEEP columns as NASS sent them. Value is text as "
                        "published. Both crops are fetched again on every run.")
    failed = []
    for crop in crops:
        key = crop.lower()
        try:
            rows, count, parts = fetch_crop(cli, crop)
        except FetchError as e:
            log(f"::warning::nass-yield {key}: {e}")
            failed.append(key)
            continue
        years = sorted({int(r["year"]) for r in rows if str(r.get("year", "")).isdigit()})
        size = write_csv_gz(os.path.join(out, f"{key}.csv.gz"), KEEP, table(rows)) if rows else 0
        man.record(key, len(rows), str(years[0]) if years else None, str(years[-1]) if years else None,
                   public_url("api_GET", query(crop)), len(rows) == count, count=count, parts=len(parts), bytes=size,
                   states=len({r.get("state_alpha") for r in rows}))
        log(f"  {key}: {len(rows)} rows ({count} counted), {len(years)} years"
            + (f" {years[0]} to {years[-1]}" if years else ""))
    man.save()
    t = man.totals()
    log(f"nass-yield: {t['rows']} rows in {t['chunks']} chunks ({t['complete']} complete), {t['first']} to {t['last']}")
    return failed


# ------------------------------------------------------------------ selftest
def selftest():
    import tempfile
    from history_lib import read_csv_gz
    fails = []

    def ck(name, ok, detail=""):
        print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  {detail}"))
        if not ok:
            fails.append(name)

    KEY = "made-up-key-456"

    def sample(crop, years):
        out = []
        for y in years:
            for st in ("IA", "IL"):
                out.append({"year": str(y), "reference_period_desc": "YEAR", "agg_level_desc": "STATE",
                            "state_alpha": st, "state_fips_code": "19" if st == "IA" else "17", "commodity_desc": crop,
                            "class_desc": "ALL CLASSES", "prodn_practice_desc": "ALL PRODUCTION PRACTICES",
                            "util_practice_desc": "GRAIN" if crop == "CORN" else "ALL UTILIZATION PRACTICES",
                            "statisticcat_desc": "YIELD", "unit_desc": "BU / ACRE",
                            "short_desc": ("CORN, GRAIN" if crop == "CORN" else "SOYBEANS") + " - YIELD, MEASURED IN BU / ACRE",
                            "Value": "150.0", "CV (%)": "", "load_time": "2026-01-12 12:00:00.000"})
        return out

    data = {"CORN": sample("CORN", range(1980, 1996)), "SOYBEANS": sample("SOYBEANS", range(1990, 1996))}

    def make_opener(refuse=False, short=False):
        def opener(u):
            q = {k: v[0] for k, v in urllib.parse.parse_qs(urllib.parse.urlsplit(u).query).items()}
            if refuse:
                return 401, json.dumps({"error": ["unauthorized"]}).encode(), {}
            rows = data[q["commodity_desc"]]
            if "year__GE" in q:
                rows = [r for r in rows if int(q["year__GE"]) <= int(r["year"]) <= int(q["year__LE"])]
            if "/get_counts/" in u:
                return 200, json.dumps({"count": len(rows)}).encode(), {}
            if short:
                rows = rows[:-1]
            return 200, json.dumps({"data": rows}).encode(), {}
        return opener

    def cli_for(**kw):
        return Client(KEY, Fetcher(min_gap=0, opener=make_opener(**kw), sleep=lambda s: None, ok=(200, 400, 404)))

    with tempfile.TemporaryDirectory() as d:
        failed = run(out=d, cli=cli_for(), log=lambda *a: None)
        mtxt = open(os.path.join(d, "manifest.json")).read()
        c = json.loads(mtxt)["chunks"]
        ck("two chunks, none failed", sorted(c) == ["corn", "soybeans"] and not failed, (sorted(c), failed))
        ck("corn rows = sample, complete", c["corn"]["rows"] == 32 == c["corn"]["count"] and c["corn"]["complete"], c["corn"])
        ck("years span", c["corn"]["first"] == "1980" and c["corn"]["last"] == "1995", c["corn"])
        ck("the key is never in the manifest", KEY not in mtxt)
        head, body = read_csv_gz(os.path.join(d, "corn.csv.gz"))
        ck("KEEP columns, values as sent", head == KEEP and len(body) == 32 and body[0][12] == "150.0", (head, body[:1]))
        # over the limit: split by year range, every range counted
        global LIMIT
        keep, LIMIT = LIMIT, 20
        try:
            rows, count, parts = fetch_crop(cli_for(), "CORN")
        finally:
            LIMIT = keep
        ck("split: one call per year range", len(rows) == 32 == count and len(parts) == 2, parts)
        # a short read is refused, not saved as complete
        logs = []
        failed = run(out=os.path.join(d, "s"), cli=cli_for(short=True), log=logs.append)
        ck("short read: failed, nothing written", failed == ["corn", "soybeans"]
           and not os.path.exists(os.path.join(d, "s", "corn.csv.gz")), failed)
        # a refused key: reported, the key not in the message
        logs = []
        failed = run(out=os.path.join(d, "r"), cli=cli_for(refuse=True), log=logs.append)
        ck("refused: both failed, key never logged", len(failed) == 2 and not any(KEY in l for l in logs), (failed, logs))
    print(f"backfill_nass_yield selftest: {len(fails)} failure(s)")
    return 1 if fails else 0


def main(argv=None):
    ap = argparse.ArgumentParser(prog="backfill_nass_yield.py")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--max-minutes", type=float, default=0, help="accepted for the workflow; a run is four calls")
    ap.add_argument("--from", dest="y0", type=int, default=None, help="accepted for the workflow; every year is read")
    ap.add_argument("--to", dest="y1", type=int, default=None, help="accepted for the workflow; every year is read")
    a = ap.parse_args(argv)
    if a.selftest:
        return selftest()
    if not os.environ.get("NASS_API_KEY"):
        print("::warning::NASS_API_KEY is not set; nothing fetched")
        return 0
    failed = run(out=a.out)
    if failed:
        print(f"::warning::nass-yield: not read this run: {', '.join(failed)} (dispatch again)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
