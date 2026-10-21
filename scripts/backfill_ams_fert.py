#!/usr/bin/env python3
"""backfill_ams_fert.py -- USDA AMS fertilizer price history back to 2010, the
series the fertilizer-ams job reads (scripts/fetch_fert_ams.py: AMS Market
News, Springfield IL, Illinois Production Cost Report, bi-weekly, My Market
News report 3195, which replaced the text report GX_GR210 in February 2022),
to the private raw branch (history/ams-fert/). One-time backfill:
history-backfill.yml, source=ams-fert. The live job keeps logging each new
report in data/fertilizer-ams-history.json, so nothing new is scheduled.

TWO ROUTES, BOTH CHECKED BY THE FIRST RUN, NEITHER SEEN FROM THE SANDBOX
(it cannot reach AMS; run it once with probe ticked and read the result):
  1. The Market News text archive, 2010 to the switch (GX_GR210):
       https://search.ams.usda.gov/mndms/<YYYY>/<MM>/              the month's listing
       https://search.ams.usda.gov/mndms/<YYYY>/<MM>/GX_GR210<YYYYMMDD>.TXT
     The listing is read first and only the files it names are fetched. A month
     whose listing cannot be read is probed on its Wednesdays, Thursdays and
     Fridays (the report is bi-weekly, late in the week), 1 s apart.
  2. The MARS API (My Market News) for report 3195, 2019 on, only when a
     MARS_API_KEY secret exists (free key, mymarketnews.ams.usda.gov; sent as
     HTTP basic auth, never logged):
       https://marsapi.ams.usda.gov/services/v1.2/reports/3195?q=report_begin_date=01/01/YYYY:12/31/YYYY&allSections=true
     Saved as sent, one JSON per year; not parsed here until its fields have
     been read from a real answer.

WHAT IS WRITTEN
  history/ams-fert/gx_gr210/text/<YYYY-MM-DD>.txt     every report as sent (the record)
  history/ams-fert/gx_gr210/<YYYY>/<YYYY-MM>.csv.gz   report date, product, low, high, avg, $/ton:
                                                      fetch_fert_ams.parse_report()'s reading, with
                                                      every one of its refusals (a product it cannot
                                                      read cleanly is left out, never guessed)
  history/ams-fert/mars-3195/<YYYY>.json.gz           MARS answer as sent
  history/ams-fert/manifest.json                      per month / year: reports, rows, URL, fetched, complete

    python3 scripts/backfill_ams_fert.py --selftest
    python3 scripts/backfill_ams_fert.py [--from 2010] [--to 2026] [--probe] [--max-minutes 300]
"""
import argparse
import base64
import calendar
import gzip
import json
import os
import re
import sys
from datetime import date, datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from history_lib import Budget, Fetcher, FetchError, Manifest, Saver, write_csv_gz  # noqa: E402

OUT = "history/ams-fert"
FIRST_YEAR = 2010
ARCHIVE = "https://search.ams.usda.gov/mndms/{y}/{m:02d}/"
SLUG = "GX_GR210"
SWITCH = date(2022, 2, 28)          # 3195 replaced GX_GR210 (fetch_fert_ams.py)
MARS = "https://marsapi.ams.usda.gov/services/v1.2/reports/3195"
MARS_FIRST = 2019
HEADER = ["report_date", "product", "grade", "low", "high", "avg", "unit", "file"]


def month_listing_names(html, y, m, slug=SLUG):
    """File names for the slug in a month listing -> {date: name}."""
    out = {}
    for name in re.findall(r"(%s(\d{8})\.TXT)" % re.escape(slug), html or "", re.I):
        fn, ds = name
        try:
            d = date(int(ds[:4]), int(ds[4:6]), int(ds[6:]))
        except ValueError:
            continue
        if (d.year, d.month) == (y, m):
            out[d] = fn
    return out


def probe_days(y, m):
    n = calendar.monthrange(y, m)[1]
    return [date(y, m, d) for d in range(1, n + 1) if date(y, m, d).weekday() in (2, 3, 4)]


def parsed_rows(text, d, fname):
    """fetch_fert_ams.parse_report on one archived report -> (rows, problems, report date)."""
    import fetch_fert_ams as FA
    p = FA.parse_report(text, d + timedelta(days=1))
    rd = p["date"] or d
    rows = [[rd.isoformat(), k, v.get("symbol"), v["low"], v["high"], v["avg"], v["unit"], fname]
            for k, v in sorted(p["products"].items())]
    return rows, p["problems"], rd


def do_month(fetch, y, m, out, probe_ok=True):
    """-> (reports, rows, problems, how, complete-able)."""
    base = ARCHIVE.format(y=y, m=m)
    status, body = fetch.get(base)
    html = body.decode("latin-1", "replace") if status == 200 else ""
    # A listing counts only when it names report files at all (a month folder holds
    # hundreds); a 200 page that names none is not a listing, so the month is probed.
    readable = bool(re.search(r"\.TXT\b", html, re.I))
    names = month_listing_names(html, y, m) if readable else {}
    how = "listing"
    if not readable and probe_ok:
        how = "probe"
        names = {d: f"{SLUG}{d:%Y%m%d}.TXT" for d in probe_days(y, m)}
    elif not names:
        how = "listing (none this month)"
    reports, rows, problems = [], [], []
    for d, fn in sorted(names.items()):
        s, b = fetch.get(base + fn)
        if s != 200 or not b.strip():
            continue
        text = b.decode("latin-1", "replace")
        p = os.path.join(out, "gx_gr210", "text", f"{d.isoformat()}.txt")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8") as f:
            f.write(text)
        r, pr, _ = parsed_rows(text, d, fn)
        rows += r
        problems += [f"{fn}: {x}" for x in pr]
        reports.append(d.isoformat())
    # A probed month counts as done only when it found a report: a wrong URL pattern
    # answers 404 for every day and must not mark twelve years "complete, none".
    return reports, rows, problems, how, (readable or (how == "probe" and bool(reports)))


def mars_year(fetch, y):
    q = f"report_begin_date=01/01/{y}:12/31/{y}"
    status, body = fetch.get(f"{MARS}?q={q}&allSections=true")
    if status != 200:
        raise FetchError(f"MARS 3195 {y}: HTTP {status}")
    return json.loads(body.decode("utf-8")), f"{MARS}?q={q}&allSections=true"


def count_results(doc):
    if isinstance(doc, list):
        return sum(count_results(x) for x in doc) if doc and isinstance(doc[0], dict) and "results" in doc[0] else len(doc)
    if isinstance(doc, dict):
        r = doc.get("results")
        return len(r) if isinstance(r, list) else 0
    return 0


def run(y0, y1, out=OUT, fetch=None, mars_fetch=None, budget=None, saver=None, today=None, log=print):
    today = today or datetime.now(timezone.utc).date()
    fetch = fetch or Fetcher(min_gap=1.0)
    budget = budget or Budget(0)
    man = Manifest(os.path.join(out, "manifest.json"), "USDA AMS Market News, Illinois Production Cost Report (GX_GR210 / 3195)",
                   ARCHIVE.format(y="YYYY", m=0).replace("/00/", "/MM/"),
                   note="Text reports as sent (gx_gr210/text) and fetch_fert_ams.parse_report's reading of them; MARS 3195 as sent.")
    saver = saver or Saver(out, "history ams-fert", every_min=30)
    failed, stopped = [], False
    y = y0
    for y in range(y0, y1 + 1):
        for m in range(1, 13):
            if date(y, m, 1) > min(today, SWITCH):
                break
            key = f"gx_gr210/{y}-{m:02d}"
            if man.done(key):
                continue
            if not budget.left():
                stopped = True
                break
            try:
                reports, rows, problems, how, final = do_month(fetch, y, m, out)
            except FetchError as e:
                log(f"::warning::ams-fert {key}: {e}")
                failed.append(key)
                continue
            if rows:
                write_csv_gz(os.path.join(out, "gx_gr210", str(y), f"{y}-{m:02d}.csv.gz"), HEADER, rows)
            month_over = date(y, m, calendar.monthrange(y, m)[1]) < today
            man.record(key, len(rows), reports[0] if reports else None, reports[-1] if reports else None,
                       ARCHIVE.format(y=y, m=m), final and month_over, reports=len(reports), how=how,
                       problems=len(problems), problem_sample=problems[:3] or None)
            log(f"  {key}: {len(reports)} reports, {len(rows)} prices ({how})")
            saver.tick(man)
        if stopped:
            break
    if mars_fetch and not stopped:
        for y in range(max(y0, MARS_FIRST), y1 + 1):
            key = f"mars-3195/{y}"
            if man.done(key) or not budget.left():
                continue
            try:
                doc, u = mars_year(mars_fetch, y)
            except (FetchError, ValueError) as e:
                log(f"::warning::ams-fert {key}: {e}")
                failed.append(key)
                continue
            p = os.path.join(out, "mars-3195", f"{y}.json.gz")
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with gzip.GzipFile(p, "wb", mtime=0) as g:
                g.write(json.dumps(doc, sort_keys=True).encode("utf-8"))
            n = count_results(doc)
            man.record(key, n, f"{y}-01-01", f"{y}-12-31", u, y < today.year, how="MARS")
            log(f"  {key}: {n} result rows")
    man.save()
    t = man.totals()
    log(f"ams-fert: {t['rows']} rows in {t['chunks']} chunks ({t['complete']} complete), {t['first']} to {t['last']}"
        + ("; stopped at the time limit, dispatch again to go on" if stopped else ""))
    return failed, stopped


def mars_fetcher():
    key = os.environ.get("MARS_API_KEY", "").strip()
    if not key:
        return None
    auth = base64.b64encode((key + ":").encode()).decode()
    return Fetcher(min_gap=1.0, headers={"Authorization": "Basic " + auth, "Accept": "application/json"})


def probe(out=OUT, fetch=None, log=print):
    """One month each side of the switch and one MARS year: what came back, saved to history/ams-fert/probe/."""
    fetch = fetch or Fetcher(min_gap=1.0, retries=1)
    d = os.path.join(out, "probe")
    os.makedirs(d, exist_ok=True)
    asks = [ARCHIVE.format(y=2015, m=3), ARCHIVE.format(y=2021, m=10), ARCHIVE.format(y=2022, m=1)]
    for u in asks:
        try:
            s, b = fetch.get(u)
        except FetchError as e:
            s, b = None, str(e).encode()
        name = re.sub(r"[^A-Za-z0-9]+", "_", u.split("//")[1])[:80]
        with open(os.path.join(d, name + ".txt"), "wb") as f:
            f.write(u.encode() + b"\n\n" + (b or b"")[:200000])
        log(f"  {u}: {s}, {len(b or b'')} bytes, {len(month_listing_names((b or b'').decode('latin-1', 'replace'), int(u.split('/')[-3]), int(u.split('/')[-2])))} {SLUG} files named")
    mf = mars_fetcher()
    if mf:
        try:
            doc, u = mars_year(mf, 2024)
            with open(os.path.join(d, "mars-3195-2024.json"), "w", encoding="utf-8") as f:
                json.dump(doc, f)
            log(f"  MARS 2024: {count_results(doc)} result rows")
        except (FetchError, ValueError) as e:
            log(f"  MARS 2024: {e}")
    else:
        log("  MARS: no MARS_API_KEY secret; that route is skipped")


# ------------------------------------------------------------------ selftest
def selftest():
    import tempfile
    from history_lib import read_csv_gz
    fails = []

    def ck(name, ok, detail=""):
        print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  {detail}"))
        if not ok:
            fails.append(name)

    here = os.path.dirname(os.path.abspath(__file__))
    flat = open(os.path.join(here, "..", "test", "fixtures", "fert-ams", "ams_3195_flat.txt"), encoding="utf-8").read()
    listing = open(os.path.join(here, "..", "test", "fixtures", "history", "ams-fert", "listing-2015-03.html"), encoding="utf-8").read()

    def report(d):   # the reconstructed (made-up) row-per-line report, re-dated
        return flat.replace("Friday, September 18, 2026", d.strftime("%A, %B %d, %Y").replace(" 0", " "))

    names = month_listing_names(listing, 2015, 3)
    ck("listing: only this slug, this month", sorted(names) == [date(2015, 3, 6), date(2015, 3, 20)], names)
    ck("probe days: Wed-Fri", [d.day for d in probe_days(2015, 3)][:3] == [4, 5, 6])
    seen = []

    def opener(u):
        seen.append(u)
        m = re.search(r"/mndms/(\d{4})/(\d{2})/$", u)
        if m:
            y, mo = int(m.group(1)), int(m.group(2))
            if (y, mo) == (2015, 3):
                return 200, listing.encode(), {}
            if (y, mo) == (2015, 4):
                return 404, b"", {}           # no listing: probe Wed-Fri
            return 200, b"<html>no files</html>" if (y, mo) == (2015, 5) else b"<a>XX_YY12320150601.TXT</a>", {}
        m = re.search(r"GX_GR210(\d{8})\.TXT$", u)
        if m:
            d = date(int(m.group(1)[:4]), int(m.group(1)[4:6]), int(m.group(1)[6:]))
            if d in (date(2015, 3, 6), date(2015, 3, 20), date(2015, 4, 3)):
                return 200, report(d).encode("latin-1"), {}
        return 404, b"", {}

    with tempfile.TemporaryDirectory() as d:
        f = Fetcher(min_gap=0, opener=opener, sleep=lambda s: None)
        failed, _ = run(2015, 2015, out=d, fetch=f, today=date(2026, 10, 21), log=lambda *a: None)
        c = json.load(open(os.path.join(d, "manifest.json")))["chunks"]
        ck("12 months, none failed", len(c) == 12 and not failed, (len(c), failed))
        ck("March from its listing: 2 reports, 12 prices", c["gx_gr210/2015-03"]["reports"] == 2 and c["gx_gr210/2015-03"]["rows"] == 12, c["gx_gr210/2015-03"])
        ck("April probed: 1 report found", c["gx_gr210/2015-04"]["how"] == "probe" and c["gx_gr210/2015-04"]["reports"] == 1, c["gx_gr210/2015-04"])
        ck("probe asks only Wed-Fri", all(date(int(u[-12:-8]), int(u[-8:-6]), int(u[-6:-4])).weekday() in (2, 3, 4)
                                          for u in seen if "/2015/04/GX" in u))
        head, rows = read_csv_gz(os.path.join(d, "gx_gr210", "2015", "2015-03.csv.gz"))
        ck("parsed by fetch_fert_ams: report date, product, prices", head == HEADER and rows[0][:2] == ["2015-03-06", "anhydrous"] and rows[0][5] == "952.25", rows[:1])
        ck("text kept as sent", open(os.path.join(d, "gx_gr210", "text", "2015-03-06.txt")).read() == report(date(2015, 3, 6)))
        ck("a listing naming no report files is probed, not trusted", c["gx_gr210/2015-05"]["how"] == "probe")
        ck("a probed month with nothing found is not complete", not c["gx_gr210/2015-05"]["complete"] and c["gx_gr210/2015-04"]["complete"])
        ck("a real listing without this report: complete with 0", c["gx_gr210/2015-06"]["complete"] and c["gx_gr210/2015-06"]["reports"] == 0
           and c["gx_gr210/2015-06"]["how"] == "listing (none this month)", c["gx_gr210/2015-06"])
        n = len(seen)
        run(2015, 2015, out=d, fetch=f, today=date(2026, 10, 21), log=lambda *a: None)
        ck("resume: only the unfinished month asked again", seen[n:] and all("/2015/05/" in u for u in seen[n:]), seen[n:])
        # stops at the switch to 3195
        d2 = os.path.join(d, "sw")
        run(2022, 2022, out=d2, fetch=f, today=date(2026, 10, 21), log=lambda *a: None)
        ck("GX_GR210 stops at February 2022", sorted(json.load(open(os.path.join(d2, "manifest.json")))["chunks"]) == ["gx_gr210/2022-01", "gx_gr210/2022-02"])
        # MARS, a made-up answer shape
        def mars(u):
            return 200, json.dumps({"reportSection": "Report Detail", "results": [{"report_date": "01/05/2024"}, {"report_date": "01/19/2024"}]}).encode(), {}
        d3 = os.path.join(d, "mars")
        run(2024, 2024, out=d3, fetch=f, mars_fetch=Fetcher(min_gap=0, opener=mars, sleep=lambda s: None), today=date(2026, 10, 21), log=lambda *a: None)
        c3 = json.load(open(os.path.join(d3, "manifest.json")))["chunks"]
        ck("MARS year saved as sent", c3["mars-3195/2024"]["rows"] == 2 and os.path.exists(os.path.join(d3, "mars-3195", "2024.json.gz")), c3)
    os.environ.pop("MARS_API_KEY", None)
    ck("no MARS key: route off", mars_fetcher() is None)
    print(f"backfill_ams_fert selftest: {len(fails)} failure(s)")
    return 1 if fails else 0


def main(argv=None):
    ap = argparse.ArgumentParser(prog="backfill_ams_fert.py")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--probe", action="store_true")
    ap.add_argument("--from", dest="y0", type=int, default=FIRST_YEAR)
    ap.add_argument("--to", dest="y1", type=int, default=datetime.now(timezone.utc).year)
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--max-minutes", type=float, default=0)
    a = ap.parse_args(argv)
    if a.selftest:
        return selftest()
    if a.probe:
        probe(out=a.out)
        return 0
    failed, _ = run(max(a.y0, FIRST_YEAR), a.y1, out=a.out, mars_fetch=mars_fetcher(), budget=Budget(a.max_minutes))
    if failed:
        print(f"::warning::ams-fert: not read this run: {', '.join(failed[:20])} (dispatch again)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
