#!/usr/bin/env python3
"""Fetch the primary sources listed in references/sources.json.

Run by .github/workflows/refs.yml. The sandbox we build in cannot open USDA,
RMA, extension or vendor sites; GitHub Actions can. So Actions downloads each
source once a month (or on demand) into the `references` branch, which Pages
never deploys:

    refs/<id>.pdf or refs/<id>.html   the original, as served
    refs/<id>.txt                     readable text (pdftotext -layout, or
                                      the page's text with menus stripped)
    index.json                        one row per source: id, url, title,
                                      status, bytes, sha256, fetched_utc,
                                      pages, etag, last_modified, error

Anyone can then read a source with
    git fetch origin references && git show origin/references:refs/<id>.txt

Polite: one request at a time, a pause between them, a browser User-Agent,
a 30 MB cap per file. A file that has not changed is not rewritten: a 304 on
If-None-Match / If-Modified-Since, or the same sha256, keeps what is there.
A failure is listed in index.json and the summary, never fatal: the old copy
stays and the run carries on.

    python3 scripts/fetch_refs.py --out DIR [--ids a,b] [--sources FILE]
    python3 scripts/fetch_refs.py --selftest
"""
import argparse
import datetime as dt
import hashlib
import html.parser
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCES = os.path.join(ROOT, "references", "sources.json")
MAX_BYTES = 30 * 1024 * 1024
DELAY = 1.5
TIMEOUT = 60
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,63}$")
KINDS = ("pdf", "html")


def now_utc():
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ── the list ────────────────────────────────────────────────────────────────

def load_sources(path, allow_http=False):
    with open(path, encoding="utf-8") as f:
        doc = json.load(f)
    rows = doc["sources"] if isinstance(doc, dict) else doc
    problems, seen = [], set()
    for i, r in enumerate(rows):
        where = r.get("id") or "row %d" % i
        for k in ("id", "url", "title", "why", "kind"):
            if not isinstance(r.get(k), str) or not r[k].strip():
                problems.append("%s: missing %s" % (where, k))
        if not ID_RE.match(r.get("id") or ""):
            problems.append("%s: id must be lowercase letters, digits, dashes" % where)
        if r.get("id") in seen:
            problems.append("%s: duplicate id" % where)
        seen.add(r.get("id"))
        if r.get("kind") not in KINDS:
            problems.append("%s: kind must be pdf or html" % where)
        if not (r.get("url") or "").startswith("http://" if allow_http else "https://") \
                and not (r.get("url") or "").startswith("https://"):
            problems.append("%s: url must be https" % where)
    return rows, problems


# ── text ────────────────────────────────────────────────────────────────────

class _Text(html.parser.HTMLParser):
    """Readable text from a page: drop scripts, styles, menus, headers and
    footers; keep <main>/<article> alone when the page has one."""
    SKIP = {"script", "style", "noscript", "svg", "nav", "header", "footer",
            "form", "button", "select", "template", "iframe", "aside"}
    BLOCK = {"p", "div", "section", "article", "main", "br", "li", "ul", "ol",
             "table", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "dt", "dd",
             "blockquote", "pre", "hr", "figcaption", "caption"}
    VOID = {"br", "hr", "img", "input", "meta", "link", "area", "base", "col",
            "embed", "source", "track", "wbr"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.skip = 0
        self.main = 0
        self.title, self.in_title = "", False
        self.all, self.inmain = [], []

    def handle_starttag(self, tag, attrs):
        if tag == "title":
            self.in_title = True
        if tag in self.SKIP and tag not in self.VOID:
            self.skip += 1
        if tag in ("main", "article"):
            self.main += 1
        if tag in self.BLOCK:
            self._put("\n")
        if tag in ("td", "th"):
            self._put("\t")
        if tag == "li":
            self._put("- ")

    def handle_endtag(self, tag):
        if tag == "title":
            self.in_title = False
        if tag in self.SKIP and self.skip:
            self.skip -= 1
        if tag in ("main", "article") and self.main:
            self.main -= 1
        if tag in self.BLOCK:
            self._put("\n")

    def handle_data(self, data):
        if self.in_title:
            self.title += data
            return
        if not self.skip:
            self._put(data)

    def _put(self, s):
        self.all.append(s)
        if self.main:
            self.inmain.append(s)


def _tidy(s):
    lines = [re.sub(r"[ \t\r\f\v\xa0]+", " ", ln).strip() for ln in s.split("\n")]
    out, blank = [], 0
    for ln in lines:
        blank = blank + 1 if not ln else 0
        if blank <= 1:
            out.append(ln)
    return "\n".join(out).strip() + "\n"


def html_text(raw):
    m = re.search(rb"charset=[\"']?([\w-]+)", raw[:4096], re.I)
    enc = m.group(1).decode("ascii", "ignore") if m else "utf-8"
    try:
        s = raw.decode(enc, "replace")
    except LookupError:
        s = raw.decode("utf-8", "replace")
    p = _Text()
    p.feed(s)
    p.close()
    body = "".join(p.inmain) if len("".join(p.inmain).strip()) > 200 else "".join(p.all)
    title = re.sub(r"\s+", " ", p.title).strip()
    return (title + "\n\n" if title else "") + _tidy(body)


def pdf_text(path):
    """(text, pages). Without poppler the text is empty and pages None."""
    if not shutil.which("pdftotext"):
        return "", None
    pages = None
    if shutil.which("pdfinfo"):
        r = subprocess.run(["pdfinfo", path], capture_output=True, text=True, timeout=120)
        m = re.search(r"^Pages:\s+(\d+)", r.stdout, re.M)
        pages = int(m.group(1)) if m else None
    r = subprocess.run(["pdftotext", "-layout", "-enc", "UTF-8", path, "-"],
                       capture_output=True, timeout=300)
    return r.stdout.decode("utf-8", "replace"), pages


# ── one download ────────────────────────────────────────────────────────────

class Fail(Exception):
    pass


def download(url, prev, max_bytes):
    """Return (status_code, body or None, headers). 304 gives body None."""
    h = {"User-Agent": UA,
         "Accept": "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8",
         "Accept-Language": "en-US,en;q=0.8"}
    if prev.get("etag"):
        h["If-None-Match"] = prev["etag"]
    if prev.get("last_modified"):
        h["If-Modified-Since"] = prev["last_modified"]
    req = urllib.request.Request(url, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            n = r.headers.get("Content-Length")
            if n and n.isdigit() and int(n) > max_bytes:
                raise Fail("too big: %s bytes (cap %d)" % (n, max_bytes))
            buf = bytearray()
            while True:
                chunk = r.read(65536)
                if not chunk:
                    break
                buf += chunk
                if len(buf) > max_bytes:
                    raise Fail("too big: over %d bytes" % max_bytes)
            return r.status, bytes(buf), r.headers, r.geturl()
    except urllib.error.HTTPError as e:
        if e.code == 304:
            return 304, None, e.headers, url
        raise Fail("HTTP %d" % e.code)
    except urllib.error.URLError as e:
        raise Fail("network: %s" % (e.reason,))
    except (TimeoutError, OSError) as e:
        raise Fail("network: %s" % e)


def fetch_one(src, prev, out, max_bytes, retry_wait=5.0):
    """Fetch one source into out/refs. Returns its index row."""
    sid = src["id"]
    row = {k: prev.get(k) for k in ("bytes", "sha256", "fetched_utc", "pages",
                                    "etag", "last_modified", "saved_as",
                                    "final_url", "content_type")}
    row.update(id=sid, url=src["url"], title=src["title"], why=src["why"],
               kind=src["kind"], checked_utc=now_utc(), error=None)
    have = bool(prev.get("saved_as")) and os.path.exists(os.path.join(out, prev["saved_as"]))
    if prev.get("url") != src["url"] or not have:
        prev = {}            # new url or missing file: no conditional request
    last = None
    for attempt in (1, 2):
        try:
            code, body, hdrs, final = download(src["url"], prev, max_bytes)
            break
        except Fail as e:
            last = str(e)
            transient = last.startswith("network") or re.match(r"HTTP (5\d\d|429)", last)
            if attempt == 1 and transient:
                time.sleep(retry_wait)
                continue
            row.update(status="failed", error=last)
            return row
    else:
        row.update(status="failed", error=last)
        return row

    if code == 304:
        row["status"] = "unchanged"
        return row

    is_pdf = body[:1024].lstrip().startswith(b"%PDF")
    if src["kind"] == "pdf" and not is_pdf:
        snippet = re.sub(rb"\s+", b" ", body[:120]).decode("utf-8", "replace")
        row.update(status="failed",
                   error="expected a PDF, got %s (%d bytes): %s" % (
                       hdrs.get("Content-Type", "?"), len(body), snippet))
        return row
    if not body:
        row.update(status="failed", error="empty body")
        return row

    ext = "pdf" if is_pdf else "html"
    rel = "refs/%s.%s" % (sid, ext)
    sha = hashlib.sha256(body).hexdigest()
    row.update(etag=hdrs.get("ETag"), last_modified=hdrs.get("Last-Modified"),
               final_url=final if final != src["url"] else None,
               content_type=hdrs.get("Content-Type"))
    if sha == prev.get("sha256") and prev.get("saved_as") == rel:
        row["status"] = "unchanged"
        return row

    os.makedirs(os.path.join(out, "refs"), exist_ok=True)
    dest = os.path.join(out, rel)
    with open(dest, "wb") as f:
        f.write(body)
    for other in ("pdf", "html"):          # a source that changed type
        o = os.path.join(out, "refs", "%s.%s" % (sid, other))
        if other != ext and os.path.exists(o):
            os.remove(o)
    if is_pdf:
        text, pages = pdf_text(dest)
    else:
        text, pages = html_text(body), None
    head = "# %s\n# %s\n# fetched %s, sha256 %s\n\n" % (src["title"], src["url"], now_utc(), sha)
    with open(os.path.join(out, "refs", sid + ".txt"), "w", encoding="utf-8") as f:
        f.write(head + text)
    row.update(status="updated" if prev.get("sha256") else "new", bytes=len(body),
               sha256=sha, fetched_utc=now_utc(), pages=pages, saved_as=rel,
               text_chars=len(text))
    if is_pdf and not text.strip():
        row["error"] = "no text extracted (scanned PDF, or pdftotext missing)"
    return row


# ── the run ─────────────────────────────────────────────────────────────────

def run(sources_path, out, ids=None, delay=DELAY, max_bytes=MAX_BYTES,
        retry_wait=5.0, log=print, allow_http=False):
    rows, problems = load_sources(sources_path, allow_http)
    if problems:
        for p in problems:
            log("sources.json: " + p)
        return None, 2
    want = [i.strip() for i in (ids or "").split(",") if i.strip()]
    unknown = [i for i in want if i not in {r["id"] for r in rows}]
    if unknown:
        log("unknown ids: " + ", ".join(unknown))
        return None, 2

    idx_path = os.path.join(out, "index.json")
    old = {}
    if os.path.exists(idx_path):
        with open(idx_path, encoding="utf-8") as f:
            old = {r["id"]: r for r in json.load(f).get("sources", [])}

    todo = [r for r in rows if not want or r["id"] in want]
    result = dict(old)
    for n, src in enumerate(todo):
        if n:
            time.sleep(delay)
        row = fetch_one(src, old.get(src["id"], {}), out, max_bytes, retry_wait)
        result[src["id"]] = row
        log("%-9s %-34s %s" % (row["status"], src["id"],
                                row.get("error") or "%s bytes" % row.get("bytes")))
    # sources dropped from the list: forget them and their files
    listed = {r["id"] for r in rows}
    for sid in list(result):
        if sid not in listed:
            for ext in ("pdf", "html", "txt"):
                p = os.path.join(out, "refs", "%s.%s" % (sid, ext))
                if os.path.exists(p):
                    os.remove(p)
            del result[sid]

    ordered = [result[r["id"]] for r in rows if r["id"] in result]
    doc = {"note": "Written by scripts/fetch_refs.py on agsist main. Read a source: "
                   "git show origin/references:refs/<id>.txt",
           "run_utc": now_utc(), "sources": ordered}
    os.makedirs(out, exist_ok=True)
    with open(idx_path, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=1, sort_keys=False)
        f.write("\n")
    return [result[r["id"]] for r in todo], 0


def summary(done):
    by = {}
    for r in done:
        by.setdefault(r["status"], []).append(r)
    lines = ["Reference fetch: " + ", ".join("%d %s" % (len(v), k) for k, v in sorted(by.items()))]
    for r in by.get("failed", []):
        lines.append("FAILED %s  %s  (%s)" % (r["id"], r["url"], r["error"]))
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", help="checkout of the references branch")
    ap.add_argument("--ids", default="", help="comma-separated ids (blank = all)")
    ap.add_argument("--sources", default=SOURCES)
    ap.add_argument("--delay", type=float, default=DELAY)
    ap.add_argument("--check", action="store_true", help="only validate sources.json")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args(argv)
    if a.selftest:
        return selftest()
    if a.check:
        rows, problems = load_sources(a.sources)
        for p in problems:
            print("sources.json: " + p)
        print("%d sources, %d problems" % (len(rows), len(problems)))
        return 1 if problems else 0
    if not a.out:
        print("--out is required")
        return 2
    done, code = run(a.sources, a.out, a.ids, a.delay)
    if done is None:
        return code
    s = summary(done)
    print(s)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as f:
            f.write("```\n" + s + "\n```\n")
    if os.environ.get("GITHUB_ACTIONS") == "true":
        for r in done:
            if r["status"] == "failed":
                print("::warning::reference %s failed: %s" % (r["id"], r["error"]))
    return 0


# ── selftest: a fake server, no network ─────────────────────────────────────

def _tiny_pdf(text):
    objs = [b"<< /Type /Catalog /Pages 2 0 R >>",
            b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] "
            b"/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
            None,
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    stream = b"BT /F1 12 Tf 20 100 Td (" + text.encode() + b") Tj ET"
    objs[3] = b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream"
    out = bytearray(b"%PDF-1.4\n")
    offs = []
    for i, o in enumerate(objs, 1):
        offs.append(len(out))
        out += b"%d 0 obj\n" % i + o + b"\nendobj\n"
    x = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    for o in offs:
        out += b"%010d 00000 n \n" % o
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, x)
    return bytes(out)


def selftest():
    import http.server
    import threading

    state = {"page": b"<html><head><title>Rootworm page</title><script>var x=1;</script></head>"
                     b"<body><nav>Menu Home About</nav><main><h1>Thresholds</h1>"
                     b"<p>Treat at five beetles per ear when silks are clipped.</p>"
                     + b"<p>" + b"Filler sentence about scouting corn. " * 8 + b"</p>"
                     b"<table><tr><td>A</td><td>1</td></tr></table></main>"
                     b"<footer>Copyright</footer></body></html>",
             "hits": {}}
    pdf = _tiny_pdf("Coverage price is 95 percent")

    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            p = self.path
            state["hits"][p] = state["hits"].get(p, 0) + 1
            if p == "/doc.pdf":
                return self._send(200, pdf, "application/pdf")
            if p == "/page.html":
                etag = '"%s"' % hashlib.sha1(state["page"]).hexdigest()[:12]
                if self.headers.get("If-None-Match") == etag:
                    self.send_response(304)
                    self.end_headers()
                    return
                return self._send(200, state["page"], "text/html; charset=utf-8", {"ETag": etag})
            if p == "/noetag.html":
                return self._send(200, b"<html><body><p>Same every time.</p></body></html>",
                                  "text/html")
            if p == "/nomain.html":
                return self._send(200, b"<html><body><header>Site Header</header><nav>Menu</nav>"
                                  b"<div><p>Run fans when air is cooler.</p></div>"
                                  b"<footer>Footer text</footer></body></html>", "text/html")
            if p == "/blocked.pdf":
                return self._send(200, b"<html>Access Denied</html>", "text/html")
            if p == "/big.pdf":
                return self._send(200, b"%PDF-1.4\n" + b"0" * 5000, "application/pdf")
            if p == "/flaky":
                if state["hits"][p] == 1:
                    return self._send(503, b"busy", "text/plain")
                return self._send(200, b"<p>ok on retry</p>", "text/html")
            if p == "/redirect":
                self.send_response(302)
                self.send_header("Location", "/noetag.html")
                self.end_headers()
                return
            self._send(404, b"nope", "text/plain")

        def _send(self, code, body, ctype, extra=None):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d" % srv.server_address[1]
    tmp = tempfile.mkdtemp(prefix="refs-selftest-")
    fails = []

    def check(ok, what):
        if not ok:
            fails.append(what)

    try:
        # the real list must be valid
        _, problems = load_sources(SOURCES)
        check(not problems, "references/sources.json: %s" % problems)

        srcs = [
            {"id": "doc", "url": base + "/doc.pdf", "kind": "pdf"},
            {"id": "page", "url": base + "/page.html", "kind": "html"},
            {"id": "same", "url": base + "/noetag.html", "kind": "html"},
            {"id": "nomain", "url": base + "/nomain.html", "kind": "html"},
            {"id": "blocked", "url": base + "/blocked.pdf", "kind": "pdf"},
            {"id": "big", "url": base + "/big.pdf", "kind": "pdf"},
            {"id": "gone", "url": base + "/missing", "kind": "html"},
            {"id": "flaky", "url": base + "/flaky", "kind": "html"},
            {"id": "moved", "url": base + "/redirect", "kind": "html"},
        ]
        for s in srcs:
            s.update(title="T " + s["id"], why="selftest")
        sp = os.path.join(tmp, "sources.json")
        out = os.path.join(tmp, "out")

        def write(lst):
            with open(sp, "w") as f:
                json.dump({"sources": lst}, f)

        quiet = lambda *a: None
        kw = dict(delay=0, max_bytes=2000, retry_wait=0, log=quiet, allow_http=True)

        write(srcs)
        done, code = run(sp, out, **kw)
        st = {r["id"]: r for r in done}
        check(code == 0, "run 1 exit %s" % code)
        check(st["doc"]["status"] == "new" and st["doc"]["saved_as"] == "refs/doc.pdf", "pdf saved")
        check(st["doc"]["sha256"] == hashlib.sha256(pdf).hexdigest(), "pdf sha")
        if shutil.which("pdftotext"):
            t = open(os.path.join(out, "refs/doc.txt")).read()
            check("Coverage price is 95 percent" in t, "pdf text: %r" % t[-200:])
            check(st["doc"]["pages"] == 1, "pdf pages %s" % st["doc"]["pages"])
        check(st["page"]["status"] == "new", "html new")
        t = open(os.path.join(out, "refs/page.txt")).read()
        check("five beetles per ear" in t, "html text kept main")
        check("Menu Home" not in t and "Copyright" not in t and "var x" not in t,
              "html text dropped nav/footer/script")
        check(t.splitlines()[0].startswith("# T page"), "txt header")
        check("Rootworm page" in t, "html title kept")
        t = open(os.path.join(out, "refs/nomain.txt")).read()
        check("Run fans" in t and "Site Header" not in t and "Menu" not in t
              and "Footer text" not in t, "page without <main>: chrome dropped: %r" % t)
        check(st["blocked"]["status"] == "failed" and "expected a PDF" in st["blocked"]["error"],
              "block page for a pdf is a failure: %s" % st["blocked"])
        check(not os.path.exists(os.path.join(out, "refs/blocked.html")), "block page not saved")
        check(st["big"]["status"] == "failed" and "too big" in st["big"]["error"], "size cap")
        check(st["gone"]["status"] == "failed" and st["gone"]["error"] == "HTTP 404", "404")
        check(st["flaky"]["status"] == "new", "retry after 503: %s" % st["flaky"])
        check(st["moved"]["status"] == "new" and st["moved"]["final_url"].endswith("/noetag.html"),
              "redirect followed")
        idx = json.load(open(os.path.join(out, "index.json")))
        check([r["id"] for r in idx["sources"]] == [s["id"] for s in srcs], "index order")

        # run 2: ETag gives 304; same bytes give unchanged; files untouched
        m1 = os.path.getmtime(os.path.join(out, "refs/same.html"))
        time.sleep(0.05)
        done, _ = run(sp, out, **kw)
        st = {r["id"]: r for r in done}
        check(st["page"]["status"] == "unchanged", "304 -> unchanged: %s" % st["page"]["status"])
        check(st["same"]["status"] == "unchanged", "same sha -> unchanged")
        check(os.path.getmtime(os.path.join(out, "refs/same.html")) == m1, "unchanged not rewritten")
        check(st["doc"]["sha256"] and st["doc"]["fetched_utc"], "unchanged keeps sha and date")

        # run 3: the page changes; only `page` is asked for
        state["page"] = state["page"].replace(b"five", b"six")
        done, _ = run(sp, out, ids="page", **kw)
        check([r["id"] for r in done] == ["page"], "ids filter")
        check(done[0]["status"] == "updated", "changed page -> updated")
        check("six beetles" in open(os.path.join(out, "refs/page.txt")).read(), "new text written")
        idx = json.load(open(os.path.join(out, "index.json")))
        check(len(idx["sources"]) == len(srcs), "other rows kept on a partial run")

        # a failure keeps the last good copy
        srcs_bad = [dict(s) for s in srcs]
        for s in srcs_bad:
            if s["id"] == "doc":
                s["url"] = base + "/missing"
        write(srcs_bad)
        done, _ = run(sp, out, ids="doc", **kw)
        check(done[0]["status"] == "failed" and done[0]["sha256"], "failure keeps old row data")
        check(os.path.exists(os.path.join(out, "refs/doc.pdf")), "failure keeps old file")

        # a source dropped from the list is removed
        write([s for s in srcs if s["id"] != "same"])
        run(sp, out, ids="page", **kw)
        check(not os.path.exists(os.path.join(out, "refs/same.html")), "dropped source removed")

        # bad lists are refused
        write([{"id": "Bad Id", "url": "x", "title": "", "why": "w", "kind": "doc"},
               {"id": "ok-1", "url": base, "title": "t", "why": "w", "kind": "pdf"},
               {"id": "ok-1", "url": base, "title": "t", "why": "w", "kind": "pdf"}])
        _, probs = load_sources(sp)
        check(any("duplicate" in p for p in probs) and any("kind" in p for p in probs)
              and any("lowercase" in p for p in probs) and any("https" in p for p in probs),
              "validation: %s" % probs)
        done, code = run(sp, out, log=quiet)
        check(done is None and code == 2, "bad list refused")
        write(srcs)
        done, code = run(sp, out, ids="nope", log=quiet)
        check(done is None and code == 2, "unknown id refused")
    finally:
        srv.shutdown()
        shutil.rmtree(tmp, ignore_errors=True)

    if fails:
        for f in fails:
            print("selftest FAILED: " + f)
        return 1
    print("selftest ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
