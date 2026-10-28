#!/usr/bin/env python3
"""
AGSIST -- a small, polite crawler for the first look at a dairy source whose
layout nobody here has seen yet (FSA's DMC margins, the Upper Midwest market
administrator's monthly releases). The sandbox that writes the parsers cannot
reach these hosts; GitHub Actions can. A probe run saves what the servers
actually returned under data/dairy-raw/<name>/ (pushed to the raw branch, never
deployed), with an index.json of url -> file, status, type and size, so a
parser is written against the real thing and not a guess.

Used by scripts/fetch_dmc.py --probe and scripts/fetch_order30.py --probe.
Stdlib only. Never fails the job: every error is recorded in the index.
"""
import hashlib
import html
import json
import re
import urllib.parse
from pathlib import Path

from fetch_dairy import http_get, pdf_to_text

MAX_FILE = 15 * 1024 * 1024
MAX_TOTAL = 60 * 1024 * 1024
HREF = re.compile(r"""href\s*=\s*["']([^"'#]+)["']""", re.I)


def links(base, body):
    """Absolute links in an html body, in page order, de-duplicated."""
    try:
        t = body.decode("utf-8", "replace")
    except Exception:  # noqa: BLE001
        return []
    out, seen = [], set()
    for m in HREF.finditer(t):
        u = urllib.parse.urljoin(base, html.unescape(m.group(1).strip()))
        if u.startswith(("http://", "https://")) and u not in seen:
            seen.add(u)
            out.append(u)
    return out


def safe_name(url):
    p = urllib.parse.urlparse(url)
    tail = re.sub(r"[^A-Za-z0-9._-]+", "_", (p.netloc + p.path + ("_" + p.query if p.query else "")))[-90:]
    return hashlib.sha1(url.encode()).hexdigest()[:8] + "-" + tail.strip("_")


def kind(body):
    if body[:5] == b"%PDF-":
        return "pdf"
    if body[:2] == b"PK":
        return "xlsx"
    if body[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
        return "xls"
    head = body[:600].lower()
    if b"<html" in head or b"<!doctype" in head:
        return "html"
    return "other"


def crawl(out_dir, starts, hosts, follow, keep, depth=2, max_files=40, get=http_get, log=print):
    """Breadth-first from `starts`. A link is fetched when its host ends with one
    of `hosts` and `follow(url)` (html pages, crawled further) or `keep(url)`
    (files: saved, not crawled) says so. Returns the index list."""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    idx, seen, total = [], set(), 0
    queue = [(u, 0) for u in starts]
    while queue and len(idx) < max_files and total < MAX_TOTAL:
        url, d = queue.pop(0)
        if url in seen:
            continue
        seen.add(url)
        body, err = get(url)
        row = {"url": url, "depth": d}
        if body is None:
            row["error"] = (err or "no body")[:300]
            idx.append(row)
            log("  FAIL %s: %s" % (url, row["error"]))
            continue
        body = body[:MAX_FILE]
        total += len(body)
        k = kind(body)
        name = safe_name(url) + "." + ("bin" if k == "other" else k)
        (out / name).write_bytes(body)
        row.update(file=name, kind=k, bytes=len(body), sha1=hashlib.sha1(body).hexdigest())
        if k == "pdf":
            text, terr = pdf_to_text(body)
            if text:
                (out / (name + ".txt")).write_text(text)
                row["text"] = name + ".txt"
            else:
                row["text_error"] = terr
        idx.append(row)
        log("  got  %s (%s, %d bytes)" % (url, k, len(body)))
        if k == "html" and d < depth:
            for u in links(url, body):
                host = urllib.parse.urlparse(u).netloc.lower()
                if u in seen or not any(host == h or host.endswith("." + h) for h in hosts):
                    continue
                if keep(u) or follow(u):
                    queue.append((u, d + 1))
    (out / "index.json").write_text(json.dumps(idx, indent=1) + "\n")
    return idx


def selftest():
    fails = []

    def ck(name, ok):
        print(("  ok   " if ok else "  FAIL ") + name)
        if not ok:
            fails.append(name)

    page = b'<html><a href="/a.pdf">x</a><a href="https://other.org/b.pdf">y</a><a href="/c&amp;d.html">z</a><a href="/a.pdf">dup</a></html>'
    ls = links("https://ex.gov/dir/p.html", page)
    ck("links resolve, unescape and de-duplicate", ls == ["https://ex.gov/a.pdf", "https://other.org/b.pdf", "https://ex.gov/c&d.html"])
    ck("kind sniffs pdf/xlsx/html", kind(b"%PDF-1.4") == "pdf" and kind(b"PK\x03\x04") == "xlsx" and kind(b"<!DOCTYPE html>") == "html")
    import tempfile
    pages = {"https://ex.gov/": page, "https://ex.gov/a.pdf": b"not really", "https://ex.gov/c&d.html": b"<html>leaf</html>"}
    with tempfile.TemporaryDirectory() as d:
        ix = crawl(d, ["https://ex.gov/"], ["ex.gov"], follow=lambda u: u.endswith(".html"), keep=lambda u: u.endswith(".pdf"),
                   get=lambda u: (pages[u], None) if u in pages else (None, "404"), log=lambda *a: None)
        urls = [r["url"] for r in ix]
        ck("crawl stays on the host and keeps both kinds", urls == ["https://ex.gov/", "https://ex.gov/a.pdf", "https://ex.gov/c&d.html"])
        ck("crawl writes an index", json.loads((Path(d) / "index.json").read_text())[0]["kind"] == "html")
    print("dairy_probe selftest: %s" % ("PASS" if not fails else "FAIL (%d)" % len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    import sys
    sys.exit(selftest() if "--selftest" in sys.argv[1:] else 0)
