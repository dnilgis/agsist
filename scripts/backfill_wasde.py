#!/usr/bin/env python3
"""backfill_wasde.py -- every past WASDE, as USDA published it, to the private raw branch.

Brief 04 (Oct 26, Sig: go): every past WASDE plus each figure's month-to-month
revisions. Two sources, both USDA, both read from their own index pages; no
file name is ever guessed (the May and June 2026 files carry a V2 suffix, and
the old ESMIS files use ids that differ per file):

  csv     USDA WAOB "historical WASDE report data", April 2010 on: two ZIPs
          (2010-04 to 2015-12, 2016-01 to 2020-12), then one CSV a month.
          https://www.usda.gov/historical-wasde-report-data-3
          USDA's note on that page: these keep each estimate as published and
          leave out later revisions to the underlying series; the reports
          themselves stay the official record.
  esmis   the NAL ESMIS archive, every release from September 17, 1973:
          crawls the listing pages and records each release date and the
          file links it shows (PDF, TXT, XLS, XML). Inventory only, nothing is
          downloaded yet; reading the pre-2010 PDFs is the second step.

What lands in history/wasde/ (never main: /history/ is in .gitignore):
  landing.html                the data page as fetched (proof of what was linked)
  files/<name>.zip|.csv.gz    each source file as published (CSV gzipped)
  us-grains/<chunk>.csv.gz    the U.S. corn, soybean and wheat rows of that file,
                              read by scripts/build_wasde_history.py
  esmis/index.json            release date -> file links (esmis mode)
  manifest.json               one chunk per source file; a complete chunk is
                              skipped on the next run (history_lib.Manifest)

    python3 scripts/backfill_wasde.py [--from 2010] [--to 2026] [--max-minutes 300]
    python3 scripts/backfill_wasde.py --esmis [--max-minutes 300]
    python3 scripts/backfill_wasde.py --selftest     fixtures, no network

The sandbox cannot reach usda.gov; history-backfill.yml / wasde-archive.yml
run this in GitHub Actions. Stdlib only.
"""
import argparse
import csv
import gzip
import io
import json
import os
import re
import sys
import zipfile
from urllib.parse import urljoin, urlparse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import history_lib as H  # noqa: E402

LANDING = "https://www.usda.gov/historical-wasde-report-data-3"
ESMIS = "https://esmis.nal.usda.gov/publication/world-agricultural-supply-and-demand-estimates"
OUT = os.path.join(H.ROOT, "history", "wasde")
FILE_RE = re.compile(r'href\s*=\s*["\']([^"\']*?oce-wasde-report-data-(\d{4})-(\d{2})(?:-to-(\d{4})-(\d{2}))?(-v\d+)?\.(csv|zip))["\']', re.I)
CROPS = ("corn", "soybeans", "wheat")
US = {"united states", "u.s.", "us", "u.s"}
# The extract keeps these columns, whatever the source spells them (header names vary by case).
COLS = [("wasde", ("wasdenumber",)), ("report_date", ("reportdate",)), ("release_date", ("releasedate",)),
        ("title", ("reporttitle",)), ("attribute", ("attribute",)), ("commodity", ("commodity",)),
        ("region", ("region",)), ("market_year", ("marketyear",)), ("proj_est", ("projestflag",)),
        ("annual_quarter", ("annualquarterflag",)), ("value", ("value",)), ("unit", ("unit",)),
        ("forecast_year", ("forecastyear",)), ("forecast_month", ("forecastmonth",))]
EXTRACT_HEAD = [c for c, _ in COLS] + ["file"]
NEEDED = ("wasde", "attribute", "commodity", "region", "market_year", "value")


def is_usda(url):
    h = (urlparse(url).hostname or "").lower()
    return h == "usda.gov" or h.endswith(".usda.gov")


def list_files(html, base=LANDING):
    """The CSV and ZIP links on the data page -> [{name, url, first, last, ext}], oldest first.
    Only usda.gov links; a name listed twice is kept once."""
    seen, out = set(), []
    for m in FILE_RE.finditer(html):
        href, y1, m1, y2, m2, ver, ext = m.groups()
        url = urljoin(base, href.strip())
        if not is_usda(url):
            continue
        name = os.path.basename(urlparse(url).path)
        stem = name.rsplit(".", 1)[0]
        if stem.lower() in seen:
            continue
        seen.add(stem.lower())
        first = f"{y1}-{m1}"
        last = f"{y2}-{m2}" if y2 else first
        out.append({"name": stem, "url": url, "first": first, "last": last, "ext": ext.lower(),
                    "version": int(ver[2:]) if ver else 1})
    out.sort(key=lambda f: (f["first"], f["version"]))
    return out


def norm_head(h):
    return re.sub(r"[^a-z]", "", (h or "").lower())


def is_crop(commodity):
    c = (commodity or "").strip().lower()
    return c in CROPS or c == "all wheat"


def extract(csv_text, file_label):
    """The U.S. corn, soybean and wheat rows of one WASDE data CSV, in EXTRACT_HEAD order.
    -> (rows, stats). Refuses (ValueError) a file whose header lacks a needed column."""
    r = csv.reader(io.StringIO(csv_text.lstrip("﻿")))
    head = next(r, None) or []
    idx = {norm_head(h): i for i, h in enumerate(head)}
    pos = {}
    for col, names in COLS:
        pos[col] = next((idx[n] for n in names if n in idx), None)
    missing = [c for c in NEEDED if pos[c] is None]
    if missing:
        raise ValueError(f"{file_label}: header has no {', '.join(missing)} column (got {head[:20]})")
    rows, seen = [], 0
    for rec in r:
        if not rec:
            continue
        seen += 1
        get = lambda c: (rec[pos[c]].strip() if pos[c] is not None and pos[c] < len(rec) else "")  # noqa: E731
        if get("region").lower() not in US or not is_crop(get("commodity")):
            continue
        rows.append([get(c) for c, _ in COLS] + [file_label])
    return rows, {"rows_read": seen, "rows_kept": len(rows)}


def csv_texts(name, ext, body):
    """[(label, text)] for one downloaded file: a CSV is itself, a ZIP is each CSV inside it."""
    if ext == "csv":
        return [(name, body.decode("utf-8-sig", errors="replace"))]
    out = []
    with zipfile.ZipFile(io.BytesIO(body)) as z:
        for info in z.infolist():
            if info.filename.lower().endswith(".csv") and not info.filename.startswith("__MACOSX"):
                out.append((os.path.basename(info.filename).rsplit(".", 1)[0], z.read(info).decode("utf-8-sig", errors="replace")))
    if not out:
        raise ValueError(f"{name}.zip holds no CSV")
    return out


def gz(data):
    buf = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=buf, compresslevel=9, mtime=0) as g:
        g.write(data)
    return buf.getvalue()


def write_bytes(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)


def span(rows):
    ds = sorted(d for d in (iso_date(r[2]) or iso_date(r[1]) for r in rows) if d)
    return (ds[0], ds[-1]) if ds else (None, None)


def iso_date(s):
    """'2026-10-09', '2026-10-09T00:00:00', '10/9/2026' -> '2026-10-09'; anything else -> None."""
    s = (s or "").strip()
    m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})", s)
    if m:
        y, mo, d = map(int, m.groups())
    else:
        m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})", s)
        if not m:
            return None
        mo, d, y = map(int, m.groups())
    if not (1 <= mo <= 12 and 1 <= d <= 31 and 1900 < y < 2100):
        return None
    return f"{y:04d}-{mo:02d}-{d:02d}"


def run_csv(fetcher, out, year_from, year_to, budget, saver, log=print):
    man = H.Manifest(os.path.join(out, "manifest.json"), "wasde", LANDING,
                     note="USDA WAOB historical WASDE report data, as published; U.S. corn, soybeans, wheat extracted")
    st, body = fetcher.get(LANDING)
    if st != 200:
        raise H.FetchError(f"{LANDING}: HTTP {st}")
    html = body.decode("utf-8", errors="replace")
    write_bytes(os.path.join(out, "landing.html"), body)
    files = list_files(html)
    if not files:
        raise H.FetchError(f"{LANDING}: no oce-wasde-report-data links found; the page changed, nothing fetched")
    log(f"wasde: {len(files)} file(s) linked, {files[0]['first']} to {files[-1]['last']}")
    done = skipped = 0
    for f in files:
        if int(f["last"][:4]) < year_from or int(f["first"][:4]) > year_to:
            continue
        if man.done(f["name"]):
            skipped += 1
            continue
        if not budget.left():
            log("wasde: time budget used; the rest waits for the next run")
            break
        st, body = fetcher.get(f["url"])
        if st != 200:
            man.record(f["name"], 0, None, None, f["url"], False, error=f"HTTP {st}")
            log(f"wasde: {f['name']}: HTTP {st}, left for the next run")
            continue
        try:
            parts = csv_texts(f["name"], f["ext"], body)
            rows, stats = [], {"rows_read": 0, "rows_kept": 0}
            for label, text in parts:
                r, s = extract(text, f["name"])
                rows += r
                for k in stats:
                    stats[k] += s[k]
        except (ValueError, zipfile.BadZipFile) as e:
            man.record(f["name"], 0, None, None, f["url"], False, error=str(e)[:300])
            log(f"wasde: {f['name']}: {e}")
            continue
        raw_path = os.path.join(out, "files", f["name"] + (".zip" if f["ext"] == "zip" else ".csv.gz"))
        write_bytes(raw_path, body if f["ext"] == "zip" else gz(body))
        H.write_csv_gz(os.path.join(out, "us-grains", f["name"] + ".csv.gz"), EXTRACT_HEAD, rows)
        first, last = span(rows)
        man.record(f["name"], len(rows), first, last, f["url"], bool(rows), bytes=len(body),
                   rows_read=stats["rows_read"], version=f["version"], covers=[f["first"], f["last"]])
        log(f"wasde: {f['name']}: {stats['rows_read']} rows read, {len(rows)} U.S. grain rows, {first} to {last}")
        done += 1
        saver.tick(man)
    man.save()
    log(f"wasde: {done} file(s) fetched, {skipped} already complete")
    return man


# ---------------------------------------------------------------- ESMIS inventory (pre-2010 comes from here)
REL_RE = re.compile(r'href\s*=\s*["\']([^"\']*/publication/world-agricultural-supply-and-demand-estimates/(\d{4}-\d{2}-\d{2}))["\']', re.I)
ESMIS_FILE_RE = re.compile(r'href\s*=\s*["\']([^"\']*/release-files/[^"\']+\.(pdf|txt|xls|xlsx|xml))["\']', re.I)
PAGE_RE = re.compile(r'[?&]page=(\d+)')


def esmis_page(html, base=ESMIS):
    """One listing page -> ({date: [file urls]}, highest page number linked)."""
    rel = {}
    # files listed under a release follow its link; assign each file to the release link before it
    marks = sorted([(m.start(), "r", m.group(2)) for m in REL_RE.finditer(html)] +
                   [(m.start(), "f", urljoin(base, m.group(1))) for m in ESMIS_FILE_RE.finditer(html)])
    cur = None
    for _, kind, v in marks:
        if kind == "r":
            cur = v
            rel.setdefault(v, [])
        elif cur and is_usda(v) and v not in rel[cur]:
            rel[cur].append(v)
    pages = [int(p) for p in PAGE_RE.findall(html)]
    return rel, max(pages) if pages else 0


def run_esmis(fetcher, out, budget, log=print, max_pages=200):
    path = os.path.join(out, "esmis", "index.json")
    idx = {"source": ESMIS, "releases": {}, "pages_read": []}
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            idx.update(json.load(f))
    page, last = 0, None
    while page <= max_pages and budget.left():
        url = ESMIS if page == 0 else f"{ESMIS}?page={page}"
        st, body = fetcher.get(url)
        if st != 200:
            log(f"esmis: page {page}: HTTP {st}; stopping")
            break
        rel, hi = esmis_page(body.decode("utf-8", errors="replace"))
        for d, files in rel.items():
            have = idx["releases"].setdefault(d, [])
            have += [u for u in files if u not in have]
        if page not in idx["pages_read"]:
            idx["pages_read"].append(page)
        last = hi if last is None else max(last, hi)
        if not rel or page >= last:
            break
        page += 1
    ds = sorted(idx["releases"])
    idx.update({"fetched": H.now_iso(), "count": len(ds), "first": ds[0] if ds else None, "last": ds[-1] if ds else None,
                "last_page_linked": last})
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(idx, f, indent=1, sort_keys=True)
        f.write("\n")
    log(f"esmis: {idx['count']} releases listed, {idx['first']} to {idx['last']} ({len(idx['pages_read'])} page(s) read)")
    return idx


# ---------------------------------------------------------------- selftest
FIX = os.path.join(H.ROOT, "test", "fixtures", "wasde-archive")


def fixture_opener():
    """Serves the fixture landing page, a ZIP built from the fixture CSV, and the monthly CSVs."""
    def read(n):
        with open(os.path.join(FIX, n), "rb") as f:
            return f.read()
    zbuf = io.BytesIO()
    with zipfile.ZipFile(zbuf, "w") as z:
        z.writestr("oce-wasde-report-data-2010-04-to-2015-12.csv", read("data-2010-04-to-2015-12.csv"))
    routes = {
        LANDING: read("landing.html"),
        "https://www.usda.gov/sites/default/files/documents/oce-wasde-report-data-2010-04-to-2015-12.zip": zbuf.getvalue(),
        "https://www.usda.gov/sites/default/files/documents/oce-wasde-report-data-2026-09.csv": read("data-2026-09.csv"),
        "https://www.usda.gov/sites/default/files/documents/oce-wasde-report-data-2026-10.csv": read("data-2026-10.csv"),
        ESMIS: read("esmis-0.html"),
        ESMIS + "?page=1": read("esmis-1.html"),
    }
    calls = []

    def opener(url):
        calls.append(url)
        if url in routes:
            return 200, routes[url], {}
        return 404, b"not found", {}
    return opener, calls


def selftest():
    import tempfile
    fails = []

    def ck(name, ok, detail=""):
        print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  {detail}"))
        if not ok:
            fails.append(name)

    with open(os.path.join(FIX, "landing.html"), encoding="utf-8") as f:
        files = list_files(f.read())
    names = [x["name"] for x in files]
    ck("links read from the page, off-site link refused, duplicate kept once",
       names == ["oce-wasde-report-data-2010-04-to-2015-12", "oce-wasde-report-data-2026-05-V2",
                 "oce-wasde-report-data-2026-09", "oce-wasde-report-data-2026-10"], names)
    ck("range and version read from the name", files[0]["last"] == "2015-12" and files[1]["version"] == 2, files[:2])
    ck("dates in both spellings", iso_date("10/9/2026") == "2026-10-09" and iso_date("2026-10-09T00:00:00") == "2026-10-09"
       and iso_date("October 2026") is None)
    try:
        extract("Foo,Bar\n1,2\n", "x")
        ck("a file without the needed columns is refused", False)
    except ValueError as e:
        ck("a file without the needed columns is refused", "no wasde" in str(e), str(e))
    with open(os.path.join(FIX, "data-2026-10.csv"), encoding="utf-8") as f:
        rows, stats = extract(f.read(), "t")
    ck("only U.S. corn, soybeans and wheat kept", rows and all(r[6] == "United States" for r in rows)
       and {r[5] for r in rows} <= {"Corn", "Soybeans", "Wheat"} and stats["rows_read"] > len(rows), (stats, {r[5] for r in rows}))

    with tempfile.TemporaryDirectory() as d:
        opener, calls = fixture_opener()
        fe = H.Fetcher(min_gap=0, opener=opener, sleep=lambda s: None)
        logs = []
        os.environ.pop("HISTORY_PUSH", None)
        man = run_csv(fe, d, 2010, 2026, H.Budget(0), H.Saver(d, "t"), log=logs.append)
        ch = man.doc["chunks"]
        ck("ZIP and monthly CSVs fetched and extracted",
           ch["oce-wasde-report-data-2010-04-to-2015-12"]["complete"] and ch["oce-wasde-report-data-2026-10"]["complete"], ch.keys())
        ck("a 404 file is recorded, not complete", not ch["oce-wasde-report-data-2026-05-V2"]["complete"]
           and ch["oce-wasde-report-data-2026-05-V2"]["error"] == "HTTP 404", ch.get("oce-wasde-report-data-2026-05-V2"))
        ck("raw files saved as published", os.path.exists(os.path.join(d, "files", "oce-wasde-report-data-2010-04-to-2015-12.zip"))
           and os.path.exists(os.path.join(d, "files", "oce-wasde-report-data-2026-10.csv.gz"))
           and os.path.exists(os.path.join(d, "landing.html")))
        head, ex = H.read_csv_gz(os.path.join(d, "us-grains", "oce-wasde-report-data-2026-10.csv.gz"))
        ck("extract header", head == EXTRACT_HEAD, head)
        n = len(calls)
        man2 = run_csv(fe, d, 2010, 2026, H.Budget(0), H.Saver(d, "t"), log=logs.append)
        ck("rerun skips complete files, retries the failed one", len(calls) - n == 2 and calls[-1].endswith("2026-05-V2.csv"), calls[n:])
        n = len(calls)
        run_csv(fe, d, 2026, 2026, H.Budget(0), H.Saver(d, "t"), log=logs.append)
        ck("--from/--to limit the files", all("2010" not in c for c in calls[n:]), calls[n:])
        idx = run_esmis(fe, d, H.Budget(0), log=logs.append)
        ck("esmis: releases from both pages, 1973 first", idx["count"] == 4 and idx["first"] == "1973-09-17", idx)
        ck("esmis: files go with their own release", idx["releases"]["2010-09-10"] ==
           ["https://esmis.nal.usda.gov/sites/default/release-files/3t945q76s/xp68kg723/f1881m24x/wasde-09-10-2010.xml"],
           idx["releases"].get("2010-09-10"))
        ck("esmis: off-site file link dropped", all(is_usda(u) for fs in idx["releases"].values() for u in fs))
    # a landing page with no data links must stop the run, not write an empty manifest
    with tempfile.TemporaryDirectory() as d:
        fe = H.Fetcher(min_gap=0, opener=lambda u: (200, b"<html>moved</html>", {}), sleep=lambda s: None)
        try:
            run_csv(fe, d, 2010, 2026, H.Budget(0), H.Saver(d, "t"), log=lambda *_: None)
            ck("a changed page stops the run", False)
        except H.FetchError as e:
            ck("a changed page stops the run", "no oce-wasde-report-data links" in str(e)
               and not os.path.exists(os.path.join(d, "manifest.json")), str(e))
    print(f"backfill_wasde selftest: {len(fails)} failure(s)")
    return 1 if fails else 0


def main():
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--esmis", action="store_true")
    ap.add_argument("--from", dest="year_from", type=int, default=2010)
    ap.add_argument("--to", dest="year_to", type=int, default=9999)
    ap.add_argument("--max-minutes", type=float, default=0)
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    fe = H.Fetcher(min_gap=2.0)
    budget = H.Budget(a.max_minutes)
    if a.esmis:
        idx = run_esmis(fe, OUT, budget)
        return 0 if idx["count"] else 1
    man = run_csv(fe, OUT, a.year_from, a.year_to, budget, H.Saver("history/wasde", "history backfill wasde"))
    t = man.totals()
    print(f"wasde: {t['complete']} of {t['chunks']} file(s) complete, {t['rows']} U.S. grain rows, {t['first']} to {t['last']}")
    return 0 if t["complete"] else 1


if __name__ == "__main__":
    sys.exit(main())
