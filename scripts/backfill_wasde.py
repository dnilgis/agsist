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
          file links it shows (PDF, TXT, XLS, XML), then (--esmis-files) reads
          each report's own U.S. tables from its TXT, else its PDF's text
          (scripts/read_wasde_text.py). Since Oct 27 this is the route: the
          usda.gov data page answers GitHub runners with HTTP 403.

What lands in history/wasde/ (never main: /history/ is in .gitignore):
  landing.html                the data page as fetched (proof of what was linked)
  files/<name>.zip|.csv.gz    each source file as published (CSV gzipped)
  us-grains/<chunk>.csv.gz    the U.S. corn, soybean and wheat rows of that file,
                              read by scripts/build_wasde_history.py
  esmis/index.json            release date -> file links (esmis mode)
  esmis/manifest.json         one chunk per release read (esmis-files mode)
  esmis/text/<date>.txt.gz    the cover and the three U.S. tables as read
  us-grains/esmis-<date>.csv.gz  that report's U.S. grain rows
  manifest.json               one chunk per source file; a complete chunk is
                              skipped on the next run (history_lib.Manifest)

    python3 scripts/backfill_wasde.py [--from 2010] [--to 2026] [--max-minutes 300]
    python3 scripts/backfill_wasde.py --esmis [--max-minutes 300]
    python3 scripts/backfill_wasde.py --selftest     fixtures, no network

    python3 scripts/backfill_wasde.py --esmis [--pages N]          the listing (N: newest pages only)
    python3 scripts/backfill_wasde.py --esmis-files [--newest N]   each report file -> us-grains/esmis-*.csv.gz
    python3 scripts/backfill_wasde.py --update-due                 exit 0 when a WASDE is out the site files lack

The sandbox cannot reach usda.gov; history-backfill.yml / wasde-archive.yml
run this in GitHub Actions. Stdlib only, plus the pdftotext binary for
the reports ESMIS carries only as PDF.
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


# ---------------------------------------------------------------- ESMIS inventory (every release since 1973)
# The Oct 27 crawl showed how ESMIS prints its listing: each release's files come BEFORE its own
# link, and the current release's files are printed once more at the foot of every page. Reading
# "the files after a link" (parser 1) gave every date the files of the release before it and lost
# the first release on each page. Parser 2 never trusts the order on its own: a file whose name
# carries its date (wasde-09-12-2018.pdf, wasde0926.txt, WASDE-582-October-11-2018.pdf) goes to
# that release; the files of one release share their folder; only the undated ones (2018 to 2021
# are all latest.*) are placed by position, and only in the direction the dated ones on the same
# crawl agree on. A file that still has no home is listed as unplaced, never guessed.
ESMIS_PARSER = 2
REL_RE = re.compile(r'href\s*=\s*["\']([^"\']*/publication/world-agricultural-supply-and-demand-estimates/(\d{4}-\d{2}-\d{2})[^"\'?#/]*)["\']', re.I)
ESMIS_FILE_RE = re.compile(r'href\s*=\s*["\']([^"\']*/release-files/[^"\']+\.(pdf|txt|xls|xlsx|xml))["\']', re.I)
PAGE_RE = re.compile(r'[?&]page=(\d+)')
MONTH_WORDS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october",
               "november", "december"]
NAME_DAY_RE = re.compile(r"wasde-?(\d{2})-(\d{2})-(\d{4})", re.I)
NAME_WORD_RE = re.compile(r"wasde-\d+-(" + "|".join(MONTH_WORDS) + r")-(\d{1,2})-(\d{4})", re.I)
NAME_MMYY_RE = re.compile(r"^wasde(\d{2})(\d{2})(v\d+)?\.", re.I)


def esmis_marks(html, base=ESMIS):
    """One listing page -> [("r", date) | ("f", url)] in page order, plus the highest page linked.
    Off-site file links are dropped here."""
    marks = sorted([(m.start(), "r", m.group(2)) for m in REL_RE.finditer(html)] +
                   [(m.start(), "f", urljoin(base, m.group(1))) for m in ESMIS_FILE_RE.finditer(html)])
    out = [(k, v) for _, k, v in marks if k == "r" or is_usda(v)]
    pages = [int(p) for p in PAGE_RE.findall(html)]
    return out, max(pages) if pages else 0


def name_date(url):
    """The release a file's own name dates it to: ("d", YYYY-MM-DD), ("m", YYYY-MM) or None."""
    n = os.path.basename(urlparse(url).path)
    m = NAME_DAY_RE.search(n)
    if m:
        mo, d, y = m.groups()
        return "d", f"{y}-{mo}-{d}"
    m = NAME_WORD_RE.search(n)
    if m:
        w, d, y = m.groups()
        return "d", f"{y}-{MONTH_WORDS.index(w.lower()) + 1:02d}-{int(d):02d}"
    m = NAME_MMYY_RE.match(n)
    if m and 1 <= int(m.group(1)) <= 12:
        yy = int(m.group(2))
        return "m", f"{2000 + yy if yy < 70 else 1900 + yy}-{m.group(1)}"
    return None


def group_key(url):
    """The folder one release's files share: release-files/<collection>/<release>/<file>/name or
    release-files/<release>/name."""
    path = urlparse(url).path
    segs = path.split("/release-files/", 1)[-1].split("/")[:-1]
    return "/".join(segs[:2] if len(segs) >= 3 else segs)


def esmis_assign(pages):
    """[[marks of page 0], [marks of page 1], ...] -> (releases {date: [urls]}, unlisted {key: [urls]}, stats)."""
    listed = sorted({v for pg in pages for k, v in pg if k == "r"})
    by_month = {}
    for d in listed:
        by_month.setdefault(d[:7], []).append(d)
    groups = []                                  # {key, urls, prev, next}
    for pg in pages:
        links = [i for i, (k, _) in enumerate(pg) if k == "r"]
        run = {}
        for i, (k, v) in enumerate(pg + [("r", None)]):
            if k == "f":
                run.setdefault(group_key(v), []).append(v)
                continue
            if run:
                prev = next((pg[j][1] for j in reversed(links) if j < i), None)
                nxt = pg[i][1] if i < len(pg) else None
                for key, urls in run.items():
                    groups.append({"key": key, "urls": urls, "prev": prev, "next": nxt})
                run = {}
    releases, unlisted, placed = {}, {}, {}
    stats = {"by_name": 0, "by_position": 0, "unplaced": [], "direction": None, "votes": {"before": 0, "after": 0}}

    def target(g):
        ds = {name_date(u) for u in g["urls"]} - {None}
        if len(ds) != 1:
            return None
        kind, v = ds.pop()
        if kind == "d":
            return v
        cands = by_month.get(v, [])
        return cands[0] if len(cands) == 1 else (v if not cands else None)
    for g in groups:
        g["to"] = target(g)
        if g["to"] in listed:
            if g["next"] == g["to"]:
                stats["votes"]["before"] += 1
            elif g["prev"] == g["to"]:
                stats["votes"]["after"] += 1
    v = stats["votes"]
    tot = v["before"] + v["after"]
    if tot >= 3 and max(v.values()) >= 0.8 * tot:
        stats["direction"] = "before" if v["before"] >= v["after"] else "after"
    claimed = {}
    for g in groups:                             # dated first, so a positional guess never displaces one
        if g["to"] and g["key"] not in placed:
            placed[g["key"]] = g["to"]
            (releases if g["to"] in listed else unlisted).setdefault(g["to"], []).extend(
                u for u in g["urls"] if u not in releases.get(g["to"], []))
            claimed.setdefault(g["to"], set()).add(g["key"])
            stats["by_name"] += 1
    for g in groups:
        if g["key"] in placed:
            continue
        to = g["next"] if stats["direction"] == "before" else g["prev"] if stats["direction"] == "after" else None
        if not to or claimed.get(to):
            if g["key"] not in [x["key"] for x in stats["unplaced"]]:
                stats["unplaced"].append({"key": g["key"], "file": os.path.basename(g["urls"][0]), "near": g["next"] or g["prev"]})
            continue
        placed[g["key"]] = to
        claimed.setdefault(to, set()).add(g["key"])
        releases.setdefault(to, []).extend(g["urls"])
        stats["by_position"] += 1
    for d in listed:
        releases.setdefault(d, [])
    return releases, unlisted, stats


def run_esmis(fetcher, out, budget, log=print, max_pages=200, pages=None):
    """Crawl the listing. pages=None reads every page and rebuilds the index; pages=N reads the
    first N (the newest releases) and updates a parser-2 index in place."""
    path = os.path.join(out, "esmis", "index.json")
    old = {}
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            old = json.load(f)
    partial = pages is not None and old.get("parser") == ESMIS_PARSER
    seen, page, last = [], 0, None
    limit = min(max_pages, pages - 1) if partial else max_pages
    while page <= limit and budget.left():
        url = ESMIS if page == 0 else f"{ESMIS}?page={page}"
        st, body = fetcher.get(url)
        if st != 200:
            log(f"esmis: page {page}: HTTP {st}; stopping")
            break
        marks, hi = esmis_marks(body.decode("utf-8", errors="replace"))
        seen.append(marks)
        last = hi if last is None else max(last, hi)
        if not any(k == "r" for k, _ in marks) or page >= last:
            break
        page += 1
    if not seen:
        raise H.FetchError("esmis: no listing page read; index left as it was")
    rel, unl, stats = esmis_assign(seen)
    idx = {"source": ESMIS, "parser": ESMIS_PARSER, "releases": {}, "unlisted": {}}
    if partial:
        idx["releases"] = dict(old.get("releases") or {})
        idx["unlisted"] = dict(old.get("unlisted") or {})
    for d, fs in rel.items():
        if fs or d not in idx["releases"]:
            idx["releases"][d] = fs
    idx["unlisted"].update(unl)
    idx["unlisted"] = {k: v for k, v in idx["unlisted"].items() if k not in idx["releases"]}
    ds = sorted(idx["releases"])
    idx.update({"fetched": H.now_iso(), "count": len(ds), "first": ds[0] if ds else None, "last": ds[-1] if ds else None,
                "pages_read": len(seen), "last_page_linked": last, "placement": stats,
                "with_files": sum(1 for d in ds if idx["releases"][d])})
    if partial:
        idx["placement_full_crawl"] = old.get("placement_full_crawl") or old.get("placement")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(idx, f, indent=1, sort_keys=True)
        f.write("\n")
    log(f"esmis: {idx['count']} releases listed, {idx['first']} to {idx['last']}, {idx['with_files']} with files; "
        f"{stats['by_name']} placed by name, {stats['by_position']} by position ({stats['direction']}), "
        f"{len(stats['unplaced'])} unplaced, {len(idx['unlisted'])} not on the listing ({len(seen)} page(s) read)")
    return idx


# ---------------------------------------------------------------- ESMIS report files -> U.S. grain rows
# Which file each period has (Oct 27 crawl): 1973-1994 PDF only (scans); 1995-2009 TXT and PDF;
# 2010-2016 PDF, XLS and XML (TXT only in 2010 and a few others); 2017 on TXT, PDF, XLS, XML.
# The TXT is read where there is one; else the PDF's text (pdftotext -layout), the same tables.
# XLS needs a library this stdlib job does not carry and the XML layout is not on file yet, so they
# are listed in the index and left for a reader built from a saved copy.
READER = 1                                      # bump when read_wasde_text.py reads differently: every report is read again


def pick_file(urls):
    """-> (url, ext) of the file to read, or (None, None). A reissue (v2) wins over the first copy."""
    def ver(u):
        m = re.search(r"v(\d+)\.\w+$", os.path.basename(u), re.I)
        return int(m.group(1)) if m else 1
    for ext in ("txt", "pdf"):
        cand = [u for u in urls if u.lower().endswith("." + ext) and "readme" not in os.path.basename(u).lower()]
        if cand:
            return max(cand, key=lambda u: (ver(u), u)), ext
    return None, None


def pdf_text(body):
    """PDF bytes -> layout text (pdftotext). A missing pdftotext is an error, never an empty report."""
    import shutil
    import subprocess
    if not shutil.which("pdftotext"):
        raise H.FetchError("pdftotext is not installed (poppler-utils); PDF-only reports cannot be read")
    p = subprocess.run(["pdftotext", "-layout", "-", "-"], input=body, capture_output=True, timeout=120)
    if p.returncode != 0:
        raise ValueError(f"pdftotext failed: {p.stderr.decode('utf-8', 'replace')[:200]}")
    return p.stdout.decode("utf-8", errors="replace")


def run_esmis_files(fetcher, out, budget, saver, log=print, year_from=0, year_to=9999, newest=0, to_text=pdf_text):
    """Read each release's report file into us-grains/esmis-<date>.csv.gz. newest=N reads at most N
    releases, newest first (the auto-update); otherwise oldest first, resumable."""
    import read_wasde_text as T
    path = os.path.join(out, "esmis", "index.json")
    if not os.path.exists(path):
        raise H.FetchError("esmis: no index; run --esmis first")
    with open(path, encoding="utf-8") as f:
        idx = json.load(f)
    if idx.get("parser") != ESMIS_PARSER:
        raise H.FetchError("esmis: the saved index is from the old listing reader (files one release off); run --esmis again first")
    man = H.Manifest(os.path.join(out, "esmis", "manifest.json"), "wasde-esmis", ESMIS,
                     note="each WASDE's U.S. corn, soybean and wheat tables, read from the report file ESMIS carries")
    todo = [(k, fs) for k, fs in list(idx["releases"].items()) + list((idx.get("unlisted") or {}).items())
            if fs and year_from <= int(k[:4]) <= year_to]
    todo.sort(reverse=bool(newest))
    done = skipped = tried = 0
    for key, urls in todo:
        chunk = f"esmis-{key}"
        c = man.doc["chunks"].get(chunk) or {}
        if c.get("complete") and c.get("reader") == READER:
            skipped += 1
            continue
        if newest and tried >= newest:
            break
        tried += 1
        if not budget.left():
            log("esmis files: time budget used; the rest waits for the next run")
            break
        url, ext = pick_file(urls)
        if not url:
            man.record(chunk, 0, None, None, None, True, reader=READER, status="no_txt_or_pdf",
                       files=sorted({u.rsplit(".", 1)[-1].lower() for u in urls}))
            continue
        st, body = fetcher.get(url)
        if st != 200:
            man.record(chunk, 0, None, None, url, False, error=f"HTTP {st}")
            log(f"esmis files: {key}: HTTP {st}, left for the next run")
            continue
        try:
            text = body.decode("utf-8") if ext == "txt" else to_text(body)
        except UnicodeDecodeError:
            text = body.decode("latin-1")
        except ValueError as e:
            man.record(chunk, 0, None, None, url, True, reader=READER, status="unreadable", error=str(e)[:200])
            continue
        scan = ext == "pdf" and int(key[:4]) < 1995
        label = f"esmis-{key}" + (f"-v{m.group(1)}" if (m := re.search(r"v(\d+)\.\w+$", url, re.I)) else "")
        if len(re.sub(r"\s", "", text)) < 500:
            rows, rep = [], {"refused": "no_text_layer", "tables": {}}
        else:
            rows, rep = T.read_report(text, key, label, scan=scan)
            write_bytes(os.path.join(out, "esmis", "text", key + ".txt.gz"), gz(T.excerpt(text).encode("utf-8")))
        dest = os.path.join(out, "us-grains", f"esmis-{key}.csv.gz")
        if rows:
            H.write_csv_gz(dest, EXTRACT_HEAD, rows)
        elif os.path.exists(dest):
            os.remove(dest)
        tables = {c: (t.get("refused") or t.get("rows", 0)) for c, t in (rep.get("tables") or {}).items()}
        withheld = sum(int(t.get("columns_withheld") or 0) for t in (rep.get("tables") or {}).values())
        d = rep.get("date") or (key if len(key) == 10 else None)
        man.record(chunk, len(rows), d, d, url, True, reader=READER, ext=ext, scan=scan, wasde=rep.get("wasde"),
                   status=rep.get("refused") or ("read" if rows else "no_rows"), tables=tables, columns_withheld=withheld)
        log(f"esmis files: {key} ({ext}{', scan' if scan else ''}): {len(rows)} rows; tables {tables}"
            + (f"; {withheld} column(s) withheld" if withheld else "") + (f"; {rep['refused']}" if rep.get("refused") else ""))
        done += 1
        saver.tick(man)
    man.save()
    t = man.totals()
    log(f"esmis files: {done} read now, {skipped} already read; {t['complete']} of {t['chunks']} on file, {t['rows']} rows")
    return man, done


def update_due(index_path, now=None):
    """The auto-update's gate: a WASDE is out that data/wasde-history does not have yet.
    -> (due, why). No site files yet means the first full build has not been checked: not due."""
    from datetime import datetime, timezone
    import usda_dates as U
    now = now or datetime.now(timezone.utc)
    if not os.path.exists(index_path):
        return False, "no data/wasde-history yet; the first build is dispatched and checked by hand"
    with open(index_path, encoding="utf-8") as f:
        through = (json.load(f).get("through") or "")
    today = now.date()
    latest = today if (today in U.WASDE_2026 and now.hour >= 16) else U.prior_wasde(today)
    if latest and latest.isoformat() > through:
        return True, f"the {latest.isoformat()} WASDE is out; the archive runs through {through}"
    if not any(d.year == today.year and d.month == today.month for d in U.WASDE_2026) and 9 <= today.day \
            and now.hour >= 16 and through[:7] < today.isoformat()[:7]:
        return True, f"no {today.year} date table; the archive runs through {through}"
    return False, f"the archive runs through {through}; nothing newer is due"


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
       and {r[5] for r in rows} == {"Corn", "Soybeans", "Wheat", "All Wheat"} and stats["rows_read"] > len(rows), (stats, {r[5] for r in rows}))

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
    selftest_esmis(ck)
    print(f"backfill_wasde selftest: {len(fails)} failure(s)")
    return 1 if fails else 0


FIX2 = os.path.join(H.ROOT, "test", "fixtures", "wasde-esmis")


def selftest_esmis(ck):
    """The listing in ESMIS's real order, the report files, the auto-update gate."""
    import tempfile
    from datetime import datetime, timezone

    def read(n):
        with open(os.path.join(FIX2, n), "rb") as f:
            return f.read()
    base = "https://esmis.nal.usda.gov/sites/default/release-files/"
    routes = {ESMIS: read("esmis-order-0.html"), ESMIS + "?page=1": read("esmis-order-1.html"),
              base + "796099/wasde1026.txt": read("wasde-2026-10-09.txt"),
              base + "3t945q76s/aa/bb/wasde-05-10-1996.txt": read("old-layout.txt"),
              base + "3t945q76s/v118rd84f/g732d931g/wasde-09-17-1973.pdf": b"%PDF scan"}
    calls = []

    def opener(url):
        calls.append(url)
        return (200, routes[url], {}) if url in routes else (404, b"", {})
    fe = H.Fetcher(min_gap=0, opener=opener, sleep=lambda s: None)
    with tempfile.TemporaryDirectory() as d:
        os.makedirs(os.path.join(d, "esmis"))
        with open(os.path.join(d, "esmis", "index.json"), "w") as f:
            json.dump({"releases": {"2026-10-09": [base + "796054/wasde0926.pdf"]}, "pages_read": [0]}, f)
        idx = run_esmis(fe, d, H.Budget(0), log=lambda *_: None)
        R = idx["releases"]
        ck("esmis order: a parser-1 index is rebuilt, not merged (its files were one release off)",
           R["2026-10-09"] == [base + "796099/wasde1026.pdf", base + "796099/wasde1026.txt"], R["2026-10-09"])
        ck("esmis order: files that come before their link go to that link",
           R["2026-09-11"] == [base + "796054/wasde0926.pdf", base + "796054/wasde0926.txt"], R["2026-09-11"])
        ck("esmis order: the direction is read from the dated files", idx["placement"]["direction"] == "before", idx["placement"])
        ck("esmis order: undated latest.* placed by position, the first release on a page too",
           [os.path.basename(u) for u in R["2019-05-10"]] == ["latest.pdf", "latest.txt"]
           and [os.path.basename(u) for u in R["2019-03-08"]] == ["latest.txt", "latest.pdf"], (R["2019-05-10"], R["2019-03-08"]))
        ck("esmis order: a name with the month spelled out", R["2018-10-11"] == [base + "3t945q76s/m039k877c/gt54ks040/WASDE-582-October-11-2018.pdf"])
        ck("esmis order: a release with no link of its own is kept by its month, not given to a neighbour",
           idx["unlisted"] == {"2026-05": [base + "795903/wasde0526v2.pdf", base + "795903/wasde0526v2.txt"]}
           and R["2026-04-09"] == [base + "795855/wasde0426.pdf", base + "795855/wasde0426.txt"], (idx["unlisted"], R["2026-04-09"]))
        ck("esmis order: the footer copy of the latest files goes to the latest release only, once",
           sum(1 for fs in R.values() for u in fs if "796099" in u) == 2 and R["1973-09-17"] == [base + "3t945q76s/v118rd84f/g732d931g/wasde-09-17-1973.pdf"]
           and R["1973-08-01"] == [], (R["1973-09-17"], R["1973-08-01"]))
        ck("esmis order: off-site files dropped, parser recorded", idx["parser"] == ESMIS_PARSER
           and not any("mirror.example" in u for fs in R.values() for u in fs))
        n = len(calls)
        routes[ESMIS] = routes[ESMIS].replace(b"2026-10-09\">", b"2026-10-09\">").replace(
            b'<div class="views-row">', b'<div class="views-row"><div class="files"><a href="/sites/default/release-files/796150/wasde1126.txt">txt</a></div>'
            b'<h3><a href="/publication/world-agricultural-supply-and-demand-estimates/2026-11-10">x</a></h3></div><div class="views-row">', 1)
        idx2 = run_esmis(fe, d, H.Budget(0), log=lambda *_: None, pages=1)
        ck("esmis update: one page read, the new release added, the rest kept", len(calls) - n == 1
           and idx2["releases"]["2026-11-10"] == [base + "796150/wasde1126.txt"] and idx2["releases"]["1973-09-17"] == R["1973-09-17"]
           and idx2["count"] == idx["count"] + 1, (calls[n:], idx2["count"]))
        # the report files
        texts = {}

        def to_text(body):
            if body.startswith(b"%PDF scan"):
                return " "
            return texts[body]
        man, done = run_esmis_files(fe, d, H.Budget(0), H.Saver(d, "t"), log=lambda *_: None, to_text=to_text)
        ch = man.doc["chunks"]
        ck("esmis files: the TXT is read where there is one", ch["esmis-2026-10-09"]["ext"] == "txt"
           and ch["esmis-2026-10-09"]["rows"] == 176 and ch["esmis-2026-10-09"]["wasde"] == "676", ch.get("esmis-2026-10-09"))
        ck("esmis files: an older text layout read", ch["esmis-1996-05-10"]["status"] == "read" and ch["esmis-1996-05-10"]["rows"] > 0,
           ch.get("esmis-1996-05-10"))
        ck("esmis files: a scan with no text is on file as unreadable, not as rows",
           ch["esmis-1973-09-17"]["status"] == "no_text_layer" and ch["esmis-1973-09-17"]["scan"] is True
           and not os.path.exists(os.path.join(d, "us-grains", "esmis-1973-09-17.csv.gz")), ch.get("esmis-1973-09-17"))
        ck("esmis files: a file that does not answer waits for the next run", ch["esmis-2026-09-11"]["complete"] is False
           and ch["esmis-2026-09-11"]["error"] == "HTTP 404", ch.get("esmis-2026-09-11"))
        ck("esmis files: a release with no files is not a row", "esmis-1973-08-01" not in ch)
        head, rows = H.read_csv_gz(os.path.join(d, "us-grains", "esmis-2026-10-09.csv.gz"))
        ck("esmis files: rows in the extract layout the build reads", head == EXTRACT_HEAD and rows[0][-1] == "esmis-2026-10-09", rows[:1])
        ck("esmis files: the tables are kept on raw as text", os.path.exists(os.path.join(d, "esmis", "text", "2026-10-09.txt.gz")))
        n = len(calls)
        run_esmis_files(fe, d, H.Budget(0), H.Saver(d, "t"), log=lambda *_: None, to_text=to_text)
        again = [c.rsplit("/", 1)[-1] for c in calls[n:]]
        ck("esmis files: a rerun reads only what is not done", "wasde0926.txt" in again
           and not {"wasde1026.txt", "wasde-05-10-1996.txt", "wasde-09-17-1973.pdf"} & set(again), again)
        n = len(calls)
        global READER
        keep = READER
        READER = keep + 1
        try:
            run_esmis_files(fe, d, H.Budget(0), H.Saver(d, "t"), log=lambda *_: None, to_text=to_text, newest=1)
        finally:
            READER = keep
        ck("esmis update: newest first, one release", [c.rsplit("/", 1)[-1] for c in calls[n:]] == ["wasde1126.txt"], calls[n:])
        # the gate
        ix = os.path.join(d, "index.json")
        ck("update gate: no site files yet is not due", update_due(ix)[0] is False)
        with open(ix, "w") as f:
            json.dump({"through": "2026-10-09"}, f)
        at = lambda s: datetime.fromisoformat(s).replace(tzinfo=timezone.utc)  # noqa: E731
        ck("update gate: before the November print, not due", update_due(ix, at("2026-11-10T15:59:00"))[0] is False)
        ck("update gate: after it, due", update_due(ix, at("2026-11-10T16:05:00"))[0] is True)
        ck("update gate: days later, still due until the archive has it", update_due(ix, at("2026-11-12T17:00:00"))[0] is True)
        with open(ix, "w") as f:
            json.dump({"through": "2026-11-10"}, f)
        ck("update gate: archive current, not due", update_due(ix, at("2026-11-12T17:00:00"))[0] is False)
        with open(ix, "w") as f:
            json.dump({"through": "2026-12-10"}, f)
        ck("update gate: past the date table, the month decides", update_due(ix, at("2027-01-12T16:30:00"))[0] is True
           and update_due(ix, at("2027-01-08T16:30:00"))[0] is False)


def main():
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--esmis", action="store_true")
    ap.add_argument("--pages", type=int, default=None)
    ap.add_argument("--esmis-files", action="store_true")
    ap.add_argument("--newest", type=int, default=0)
    ap.add_argument("--update-due", action="store_true")
    ap.add_argument("--from", dest="year_from", type=int, default=None)
    ap.add_argument("--to", dest="year_to", type=int, default=9999)
    ap.add_argument("--max-minutes", type=float, default=0)
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if a.update_due:
        due, why = update_due(os.path.join(H.ROOT, "data", "wasde-history", "index.json"))
        print(f"wasde archive update: {'due' if due else 'not due'}: {why}")
        return 0 if due else 3
    fe = H.Fetcher(min_gap=2.0)
    budget = H.Budget(a.max_minutes)
    if a.esmis:
        idx = run_esmis(fe, OUT, budget, pages=a.pages)
        return 0 if idx["count"] else 1
    if a.esmis_files:
        a_to = a.year_to
        man, _ = run_esmis_files(fe, OUT, budget, H.Saver("history/wasde", "history backfill wasde esmis"),
                                 year_from=a.year_from or 0, year_to=a_to, newest=a.newest)
        return 0 if man.totals()["complete"] else 1
    man = run_csv(fe, OUT, a.year_from or 2010, a.year_to, budget, H.Saver("history/wasde", "history backfill wasde"))
    t = man.totals()
    print(f"wasde: {t['complete']} of {t['chunks']} file(s) complete, {t['rows']} U.S. grain rows, {t['first']} to {t['last']}")
    return 0 if t["complete"] else 1


if __name__ == "__main__":
    sys.exit(main())
