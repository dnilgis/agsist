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

Kinds: "pdf", "html" (plain HTTP), and "rendered": a page that only fills
in with JavaScript, opened in headless Chromium (Playwright) on the runner,
one page at a time, saved as the rendered HTML plus its text. The workflow
installs the browser only when a rendered source is in the run.

Bot walls: a page that answers with a bot check (AWS WAF, Cloudflare,
Incapsula, SiteGround, DataDome, PerimeterX, Akamai) is never saved as the
source. The attempt fails with "bot challenge (<who>)" and the next fallback
is tried; nothing tries to get past the check. An old copy that turns out to
be a bot check is deleted rather than kept as "the last good copy".

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
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCES = os.path.join(ROOT, "references", "sources.json")
MAX_BYTES = 30 * 1024 * 1024
DELAY = 1.5
TIMEOUT = 90
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,63}$")
KINDS = ("pdf", "html", "rendered")
# a page with less readable text than this is noted in its row (a JS app?)
THIN_TEXT = 300


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
            problems.append("%s: kind must be pdf, html or rendered" % where)
        mirrors = r.get("mirrors", [])
        if not isinstance(mirrors, list) or not all(
                isinstance(m, str) and m.startswith("https://") for m in mirrors):
            problems.append("%s: mirrors must be a list of https URLs" % where)
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


# Bot checks seen on the references branch (Oct 2026): Barchart and
# ipcm.wisc.edu answered 202 with an AWS WAF challenge page, canr.msu.edu an
# Incapsula iframe, opisystems.com a SiteGround captcha redirect. Each was
# saved as if it were the page (text_chars 1). A signature counts only on a
# page with little readable text, because real pages behind Cloudflare or AWS
# carry some of the same script names. A plain reCAPTCHA or Turnstile tag is
# not a signature: short articles carry one on their newsletter form (the
# Iowa Farm Bureau page, bench-planting-date-5).
CHALLENGES = (
    ("AWS WAF", (rb"awsWafCookieDomainList", rb"AwsWafIntegration", rb"token\.awswaf\.com")),
    ("Cloudflare", (rb"<title>\s*Just a moment\.\.\.", rb"cf_chl_opt", rb"cf-browser-verification",
                    rb"Attention Required! \| Cloudflare")),
    ("Incapsula", (rb"_Incapsula_Resource", rb"Incapsula incident ID")),
    ("SiteGround", (rb"/\.well-known/sgcaptcha/",)),
    ("DataDome", (rb"captcha-delivery\.com",)),
    ("PerimeterX", (rb"px-captcha", rb"Press &amp; Hold", rb"Press & Hold")),
    ("Akamai", (rb"errors\.edgesuite\.net",)),
    ("robot check", (rb"verify (that )?you('|&#39;|&rsquo;)?re not a robot", rb"[Aa]re you a robot",
                     rb"[Ee]nable JavaScript and cookies to continue")),
)


def challenge_reason(raw, text=None):
    """Who is asking for a bot check, or None. Only pages with little
    readable text are judged."""
    if not raw or raw[:1024].lstrip().startswith(b"%PDF"):
        return None
    if text is None:
        text = html_text(raw)
    body = text.split("\n", 1)[1] if text.count("\n") else text
    if len(body.strip()) >= 1500:
        return None
    head = raw[:300000]
    for who, pats in CHALLENGES:
        if any(re.search(p, head) for p in pats):
            return who
    return None


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
#
# WHY THERE ARE FALLBACKS. The first run on GitHub (2026-10-15) timed out on
# every www.rma.usda.gov source ("The read operation timed out") while
# extension sites answered. So each source is tried, in order:
#   1. the URL itself with Python (conditional: ETag / Last-Modified),
#   2. the same URL with curl over HTTP/1.1 (a different client and TLS stack),
#   3. any "mirrors" listed for the source in sources.json,
#   4. the other RMA host name (www.rma.usda.gov <-> rma.usda.gov),
#   5. the Internet Archive's closest snapshot (archive.org/wayback/available,
#      then web.archive.org/web/<timestamp>id_/<url> for the original bytes).
# The row records which one worked ("via", and "archive_timestamp" for a
# Wayback copy) and every attempt. Later runs always try the live URL first,
# so an archived copy is replaced as soon as the site answers again.
# (Sig saw "Bad Gateway" on www.rma.usda.gov from his own browser the same
# day, so the RMA timeouts were the site, not only GitHub's runners.)
# Once a host has timed out twice, later sources skip it and go straight to
# the fallbacks, so one silent host cannot eat the hour.

# The closest snapshot comes from the availability API; the id_ form returns
# the original bytes without the Wayback toolbar.
WAYBACK_API = "https://archive.org/wayback/available?url="
WAYBACK_RAW = "https://web.archive.org/web/{ts}id_/{url}"
RMA_HOSTS = ("www.rma.usda.gov", "rma.usda.gov")
ACCEPT = "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8"


class Fail(Exception):
    pass


class Headers(dict):
    def get(self, k, d=None):
        return dict.get(self, k.lower(), d)


def _is_timeout(msg):
    return "timed out" in msg or "timeout" in msg.lower()


def download(url, prev, max_bytes, timeout):
    """Python client. Return (status_code, body or None, headers, final_url).
    A 304 gives body None."""
    h = {"User-Agent": UA, "Accept": ACCEPT, "Accept-Language": "en-US,en;q=0.8"}
    if prev.get("etag"):
        h["If-None-Match"] = prev["etag"]
    if prev.get("last_modified"):
        h["If-Modified-Since"] = prev["last_modified"]
    req = urllib.request.Request(url, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
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
            hd = Headers((k.lower(), v) for k, v in r.headers.items())
            return r.status, bytes(buf), hd, r.geturl()
    except urllib.error.HTTPError as e:
        if e.code == 304:
            return 304, None, Headers((k.lower(), v) for k, v in e.headers.items()), url
        raise Fail("HTTP %d" % e.code)
    except urllib.error.URLError as e:
        raise Fail("network: %s" % (e.reason,))
    except (TimeoutError, OSError) as e:
        raise Fail("network: %s" % e)


def download_curl(url, max_bytes, timeout):
    """curl over HTTP/1.1, unconditional. Same return shape as download()."""
    if not shutil.which("curl"):
        raise Fail("no curl")
    with tempfile.TemporaryDirectory(prefix="refs-curl-") as td:
        body_p, hdr_p = os.path.join(td, "b"), os.path.join(td, "h")
        cmd = ["curl", "-sS", "-L", "--http1.1", "--compressed",
               "--connect-timeout", str(min(30, timeout)), "--max-time", str(timeout * 2),
               "--max-filesize", str(max_bytes), "--max-redirs", "8",
               "-A", UA, "-H", "Accept: " + ACCEPT, "-H", "Accept-Language: en-US,en;q=0.8",
               "-o", body_p, "-D", hdr_p, "-w", "%{http_code} %{url_effective}", url]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout * 2 + 30)
        if r.returncode == 28:
            raise Fail("network: curl timed out")
        if r.returncode == 63:
            raise Fail("too big: over %d bytes" % max_bytes)
        if r.returncode != 0:
            raise Fail("network: curl exit %d: %s" % (r.returncode, r.stderr.strip()[:160]))
        code_s, _, final = r.stdout.strip().partition(" ")
        code = int(code_s or 0)
        if code >= 400 or code == 0:
            raise Fail("HTTP %d" % code)
        raw = open(hdr_p, encoding="latin-1").read() if os.path.exists(hdr_p) else ""
        last = re.split(r"\r?\n\r?\n(?=HTTP/)", raw.strip())[-1]
        hd = Headers()
        for ln in last.splitlines()[1:]:
            k, sep, v = ln.partition(":")
            if sep:
                hd[k.strip().lower()] = v.strip()
        body = open(body_p, "rb").read() if os.path.exists(body_p) else b""
        if len(body) > max_bytes:
            raise Fail("too big: over %d bytes" % max_bytes)
        return code, body, hd, final or url


# ── rendered pages (kind "rendered") ───────────────────────────────────────
#
# Headless Chromium through Playwright, started once per run and reused, one
# page at a time. A normal desktop User-Agent and window, no login, nothing
# that hides automation, no captcha solving: if the settled page shows a bot
# check, the attempt fails and nothing is saved. Playwright is imported only
# here, so the plain fetch needs no extra packages. REFS_CHROMIUM may name a
# Chromium binary (the sandbox has one at /opt/pw-browsers/chromium).

class _Browser:
    pw = None
    browser = None

    @classmethod
    def get(cls):
        if cls.browser is None:
            try:
                from playwright.sync_api import sync_playwright
            except ImportError:
                raise Fail("playwright not installed (the workflow installs it when a rendered id is asked for)")
            cls.pw = sync_playwright().start()
            kw = {"headless": True}
            exe = os.environ.get("REFS_CHROMIUM")
            if exe:
                kw["executable_path"] = exe
            try:
                cls.browser = cls.pw.chromium.launch(**kw)
            except Exception as e:
                cls.pw.stop()
                cls.pw = None
                raise Fail("browser would not start: %s" % str(e).splitlines()[0][:160])
        return cls.browser

    @classmethod
    def close(cls):
        try:
            if cls.browser is not None:
                cls.browser.close()
            if cls.pw is not None:
                cls.pw.stop()
        except Exception:
            pass
        cls.browser = cls.pw = None


SETTLE_MS = 1500


def download_rendered(url, max_bytes, timeout):
    """Open url in headless Chromium, let it settle, return the rendered
    document. Same return shape as download()."""
    browser = _Browser.get()
    ctx = browser.new_context(user_agent=UA, locale="en-US",
                              viewport={"width": 1280, "height": 900},
                              extra_http_headers={"Accept-Language": "en-US,en;q=0.8"})
    try:
        page = ctx.new_page()
        try:
            resp = page.goto(url, wait_until="domcontentloaded", timeout=timeout * 1000)
        except Exception as e:
            msg = str(e).splitlines()[0][:160]
            raise Fail("network: timed out" if "Timeout" in msg else "network: %s" % msg)
        if resp is None:
            raise Fail("no response")
        code = resp.status
        if code >= 400:
            raise Fail("HTTP %d" % code)
        try:
            page.wait_for_load_state("networkidle", timeout=min(20, timeout) * 1000)
        except Exception:
            pass                       # pages that never go quiet: take what is there
        page.wait_for_timeout(SETTLE_MS)
        body = page.content().encode("utf-8")
        if len(body) > max_bytes:
            raise Fail("too big: over %d bytes" % max_bytes)
        hd = Headers((k.lower(), v) for k, v in resp.headers.items())
        hd["content-type"] = "text/html; charset=utf-8"   # what we save is the rendered DOM
        return code, body, hd, page.url
    finally:
        ctx.close()


def candidates(src):
    """(url, via) in the order to try them. The Wayback copy is found at run
    time (wayback_url), so it is listed here as None."""
    url = src["url"]
    out = [(url, "direct")]
    for m in src.get("mirrors") or []:
        out.append((m, "mirror"))
    host = urllib.parse.urlsplit(url).hostname or ""
    if host in RMA_HOSTS:
        other = RMA_HOSTS[1] if host == RMA_HOSTS[0] else RMA_HOSTS[0]
        out.append((url.replace("//" + host, "//" + other, 1), "alt-host"))
    if WAYBACK_API and src.get("kind") != "rendered":
        out.append((None, "wayback"))
    return out


def wayback_url(url, timeout):
    """Ask the Internet Archive for its closest snapshot of url. Returns
    (raw-bytes url, timestamp) or raises Fail."""
    api = WAYBACK_API + urllib.parse.quote(url, safe="")
    try:
        req = urllib.request.Request(api, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=min(timeout, 60)) as r:
            doc = json.loads(r.read(1_000_000).decode("utf-8", "replace"))
    except (urllib.error.URLError, OSError, ValueError) as e:
        raise Fail("availability API: %s" % (getattr(e, "reason", None) or e))
    snap = ((doc or {}).get("archived_snapshots") or {}).get("closest") or {}
    ts = str(snap.get("timestamp") or "")
    if not snap.get("available") or not re.match(r"^\d{14}$", ts) or \
            str(snap.get("status", "200")) != "200":
        raise Fail("no archived copy")
    return WAYBACK_RAW.format(ts=ts, url=url), ts


def _try(url, via, client, cond, src, max_bytes, timeout):
    """One request. Returns the download tuple, or raises Fail."""
    if client == "python":
        res = download(url, cond, max_bytes, timeout)
    elif client == "browser":
        res = download_rendered(url, max_bytes, timeout)
    else:
        res = download_curl(url, max_bytes, timeout)
    code, body, hd, final = res
    if code != 304:
        if not body:
            raise Fail("empty body")
        who = challenge_reason(body) if src["kind"] != "pdf" else None
        if who:
            raise Fail("bot challenge (%s), nothing saved" % who)
        if src["kind"] == "pdf" and not body[:1024].lstrip().startswith(b"%PDF"):
            snippet = re.sub(rb"\s+", b" ", body[:100]).decode("utf-8", "replace")
            raise Fail("expected a PDF, got %s (%d bytes): %s" % (
                hd.get("Content-Type", "?"), len(body), snippet))
    return res


def acquire(src, prev, max_bytes, timeout, retry_wait, dead):
    """Try every candidate in turn. Returns
    (code, body, headers, final, via, archive_ts, attempts); raises Fail
    listing every attempt when nothing worked. `dead` counts, per host, the
    times both clients timed out; at 2 the host is skipped for the run."""
    attempts = []
    for url, via in candidates(src):
        ts = None
        if via == "wayback":
            try:
                url, ts = wayback_url(src["url"], timeout)
            except Fail as e:
                attempts.append("wayback: %s" % e)
                continue
        host = urllib.parse.urlsplit(url).hostname or ""
        if via != "wayback" and dead.get(host, 0) >= 2:
            attempts.append("%s: skipped, %s timed out earlier" % (via, host))
            continue
        cond = prev if via == "direct" else {}
        clients = (("browser", 1),) if src["kind"] == "rendered" else (("python", 2), ("curl", 1))
        for client, tries in clients:
            for n in range(tries):
                try:
                    code, body, hd, final = _try(url, via, client, cond, src, max_bytes, timeout)
                except Fail as e:
                    msg = str(e)
                    attempts.append("%s/%s: %s" % (via, client, msg))
                    if msg.startswith("too big") or msg.startswith("playwright not") \
                            or msg.startswith("browser would not"):
                        raise Fail("; ".join(attempts))
                    if _is_timeout(msg) and client in ("curl", "browser"):
                        dead[host] = dead.get(host, 0) + 1
                    if n + 1 < tries and not _is_timeout(msg) and \
                            re.match(r"(network|HTTP (5\d\d|429))", msg):
                        time.sleep(retry_wait)
                        continue
                    break
                attempts.append("%s/%s: ok %d" % (via, client, code))
                dead.pop(host, None)
                return code, body, hd, final, via, ts, attempts
    raise Fail("; ".join(attempts))


def fetch_one(src, prev, out, max_bytes, retry_wait=5.0, timeout=TIMEOUT, dead=None):
    """Fetch one source into out/refs. Returns its index row."""
    dead = {} if dead is None else dead
    sid = src["id"]
    row = {k: prev.get(k) for k in ("bytes", "sha256", "fetched_utc", "pages",
                                    "etag", "last_modified", "saved_as",
                                    "final_url", "content_type", "via",
                                    "archive_timestamp")}
    row.update(id=sid, url=src["url"], title=src["title"], why=src["why"],
               kind=src["kind"], checked_utc=now_utc(), error=None)
    have = bool(prev.get("saved_as")) and os.path.exists(os.path.join(out, prev["saved_as"]))
    if prev.get("url") != src["url"] or not have:
        prev = {}            # new url or missing file: no conditional request
    try:
        code, body, hdrs, final, via, archive_ts, attempts = acquire(
            src, prev, max_bytes, timeout, retry_wait, dead)
    except Fail as e:
        row.update(status="failed", error=str(e))
        if have:
            old = os.path.join(out, row["saved_as"])
            with open(old, "rb") as f:
                who = challenge_reason(f.read())
            if who:
                for ext in ("pdf", "html", "txt"):
                    p = os.path.join(out, "refs", "%s.%s" % (sid, ext))
                    if os.path.exists(p):
                        os.remove(p)
                for k in ("bytes", "sha256", "fetched_utc", "pages", "etag", "last_modified",
                          "saved_as", "final_url", "content_type", "via", "archive_timestamp"):
                    row[k] = None
                row["error"] += "; the old copy was a %s bot check, removed" % who
        return row
    row["attempts"] = attempts
    row["via"] = via
    row["archive_timestamp"] = archive_ts

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
    direct = via == "direct"
    row.update(etag=hdrs.get("ETag") if direct else None,
               last_modified=hdrs.get("Last-Modified") if direct else None,
               final_url=final if final != src["url"] else None,
               content_type=hdrs.get("Content-Type"), via=via)
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
    elif not is_pdf and len(text.split("\n", 1)[-1].strip()) < THIN_TEXT:
        row["error"] = "thin: only %d characters of text%s" % (
            len(text.strip()), "" if src["kind"] == "rendered" else
            " (a page built by JavaScript? try kind rendered)")
    return row


# ── the run ─────────────────────────────────────────────────────────────────

def run(sources_path, out, ids=None, delay=DELAY, max_bytes=MAX_BYTES,
        retry_wait=5.0, log=print, allow_http=False, timeout=TIMEOUT):
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
    dead = {}
    try:
        _run_each(todo, old, result, out, delay, max_bytes, retry_wait, timeout, dead, log)
    finally:
        _Browser.close()
    # sources dropped from the list: forget them and their files
    _forget(rows, result, out)
    ordered = [result[r["id"]] for r in rows if r["id"] in result]
    doc = {"note": "Written by scripts/fetch_refs.py on agsist main. Read a source: "
                   "git show origin/references:refs/<id>.txt",
           "run_utc": now_utc(), "sources": ordered}
    os.makedirs(out, exist_ok=True)
    with open(idx_path, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=1, sort_keys=False)
        f.write("\n")
    return [result[r["id"]] for r in todo], 0


def _run_each(todo, old, result, out, delay, max_bytes, retry_wait, timeout, dead, log):
    for n, src in enumerate(todo):
        if n:
            time.sleep(delay)
        row = fetch_one(src, old.get(src["id"], {}), out, max_bytes, retry_wait,
                        timeout, dead)
        result[src["id"]] = row
        log("%-9s %-34s %s" % (row["status"], src["id"], row.get("error") or "%s bytes via %s%s" % (
            row.get("bytes"), row.get("via"),
            " " + row["archive_timestamp"] if row.get("archive_timestamp") else "")))


def _forget(rows, result, out):
    listed = {r["id"] for r in rows}
    for sid in list(result):
        if sid not in listed:
            for ext in ("pdf", "html", "txt"):
                p = os.path.join(out, "refs", "%s.%s" % (sid, ext))
                if os.path.exists(p):
                    os.remove(p)
            del result[sid]


def summary(done):
    by = {}
    for r in done:
        by.setdefault(r["status"], []).append(r)
    lines = ["Reference fetch: " + ", ".join("%d %s" % (len(v), k) for k, v in sorted(by.items()))]
    for r in done:
        if r["status"] != "failed" and r.get("via") not in (None, "direct"):
            lines.append("NOT LIVE %s  via %s%s  (live URL failed; tried again next run)" % (
                r["id"], r["via"],
                " snapshot " + r["archive_timestamp"] if r.get("archive_timestamp") else ""))
    for r in done:
        if r["status"] != "failed" and (r.get("error") or "").startswith("thin"):
            lines.append("THIN %s  %s" % (r["id"], r["error"]))
    for r in by.get("failed", []):
        lines.append("FAILED %s  %s  (%s)" % (r["id"], r["url"], r["error"]))
    return "\n".join(lines)


def annotations(done):
    """A few ::warning:: lines (GitHub shows only 10 per step), each naming
    many sources, so nothing is cut off."""
    out = []
    failed = [r for r in done if r["status"] == "failed"]
    if failed:
        out.append("::warning::%d reference(s) failed, last good copy kept: %s" % (
            len(failed), ", ".join(r["id"] for r in failed)))
        seen = {}
        for r in failed:
            first = (r.get("error") or "").split("; ")[0]
            seen.setdefault(first[:160], []).append(r["id"])
        for err, ids in list(seen.items())[:5]:
            out.append("::warning::%s -- %s" % (err, ", ".join(ids)))
    side = [r for r in done if r["status"] != "failed" and r.get("via") not in (None, "direct")]
    if side:
        out.append("::warning::%d reference(s) saved from a fallback, not the live URL: %s" % (
            len(side), ", ".join("%s (%s%s)" % (r["id"], r["via"],
                                               " " + r["archive_timestamp"] if r.get("archive_timestamp") else "")
                                 for r in side)))
    return out[:9]


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", help="checkout of the references branch")
    ap.add_argument("--ids", default="", help="comma-separated ids (blank = all)")
    ap.add_argument("--sources", default=SOURCES)
    ap.add_argument("--delay", type=float, default=DELAY)
    ap.add_argument("--timeout", type=int, default=TIMEOUT, help="seconds per request")
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
    done, code = run(a.sources, a.out, a.ids, a.delay, timeout=a.timeout)
    if done is None:
        return code
    s = summary(done)
    print(s)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as f:
            f.write("```\n" + s + "\n```\n")
    if os.environ.get("GITHUB_ACTIONS") == "true":
        for line in annotations(done):
            print(line)
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


JS_PAGE = (b"<html><head><title>Bids app</title></head><body><main id='m'></main>"
           b"<script>var t='Rendered by script: cash corn bid 4.12 at the elevator. ';"
           b"document.getElementById('m').innerHTML='<h1>Bids</h1><p>'+t.repeat(12)+'</p>';"
           b"document.title='Bids app ready';</script></body></html>")
WAF_PAGE = (b"<!DOCTYPE html><html><head><title></title><script>window.awsWafCookieDomainList = ['x.com'];"
            b"</script><script src='/awswaf/challenge.js'></script></head>"
            b"<body><div id='challenge-container'></div><noscript><h1>JavaScript is disabled</h1>"
            b"In order to continue, we need to verify that you're not a robot.</noscript></body></html>")
INCAP_PAGE = (b"<html style='height:100%'><head><script src='/_Incapsula_Resource?SWJIYLWA=1'></script>"
              b"</head><body><iframe id='main-iframe' src='/_Incapsula_Resource?x=1'>Request unsuccessful. "
              b"Incapsula incident ID: 1-2</iframe></body></html>")


def _have_browser():
    try:
        import playwright.sync_api  # noqa: F401
        return True
    except ImportError:
        return False


def selftest():
    import http.server
    import threading

    state = {"page": b"<html><head><title>Rootworm page</title><script>var x=1;</script></head>"
                     b"<body><nav>Menu Home About</nav><main><h1>Thresholds</h1>"
                     b"<p>Treat at five beetles per ear when silks are clipped.</p>"
                     + b"<p>" + b"Filler sentence about scouting corn. " * 8 + b"</p>"
                     b"<table><tr><td>A</td><td>1</td></tr></table></main>"
                     b"<footer>Copyright</footer></body></html>",
             "hits": {}, "rma_up": False, "waf_fixed": False}
    pdf = _tiny_pdf("Coverage price is 95 percent")
    archived_pdf = _tiny_pdf("Archived copy of the handbook")
    live_pdf = _tiny_pdf("Live copy of the handbook")

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
            if p.startswith("/wb/available?url="):
                # the Internet Archive's availability API
                asked = urllib.parse.unquote(p.split("=", 1)[1])
                if "archived" in asked:
                    doc = {"url": asked, "archived_snapshots": {"closest": {
                        "status": "200", "available": True, "timestamp": "20260901123456",
                        "url": "http://web.archive.org/web/20260901123456/" + asked}}}
                else:
                    doc = {"url": asked, "archived_snapshots": {}}
                return self._send(200, json.dumps(doc).encode(), "application/json")
            if p.startswith("/web/20260901123456id_/"):
                return self._send(200, archived_pdf, "application/pdf")
            if p == "/archived-handbook.pdf":
                if state["rma_up"]:
                    return self._send(200, live_pdf, "application/pdf")
                return self._send(502, b"<html>Bad Gateway</html>", "text/html")
            if p == "/curlonly.html":
                # turns away the Python client; curl --compressed asks for gzip
                if "gzip" not in (self.headers.get("Accept-Encoding") or ""):
                    return self._send(403, b"denied", "text/plain")
                return self._send(200, b"<p>curl got it</p>", "text/html")
            if p.startswith("/slow"):
                time.sleep(2.5)
                return self._send(200, b"<p>too late</p>", "text/html")
            if p == "/js.html":
                # the text only exists once a browser runs the script
                return self._send(200, JS_PAGE, "text/html; charset=utf-8")
            if p == "/waf.html":
                # what Barchart sent the plain client: 202 and a bot check
                return self._send(202, WAF_PAGE, "text/html; charset=UTF-8")
            if p == "/incap.html":
                return self._send(200, INCAP_PAGE, "text/html")
            if p == "/longcf.html":
                # a real page behind Cloudflare carries the challenge script name too
                return self._send(200, b"<html><head><title>Just a moment...</title>"
                                  b"<script src='/cdn-cgi/challenge-platform/x.js'></script></head><body><main>"
                                  + b"<p>Long real article about drying corn in the bin. </p>" * 40
                                  + b"</main></body></html>", "text/html")
            if p == "/was-waf.html":
                if state["waf_fixed"]:
                    return self._send(200, state["page"], "text/html")
                return self._send(202, WAF_PAGE, "text/html")
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
    srv.daemon_threads = True
    srv.handle_error = lambda *a: None     # clients that gave up on /slow
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d" % srv.server_address[1]
    # "localhost" is a second host name for the same server, for the
    # timed-out-host test
    slow_base = "http://localhost:%d" % srv.server_address[1]
    g = globals()
    saved = {k: g[k] for k in ("WAYBACK_API", "WAYBACK_RAW")}
    g["WAYBACK_API"] = base + "/wb/available?url="
    g["WAYBACK_RAW"] = base + "/web/{ts}id_/{url}"
    for k in ("no_proxy", "NO_PROXY"):
        os.environ[k] = "localhost,127.0.0.1," + os.environ.get(k, "")
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
        check(st["gone"]["status"] == "failed"
              and st["gone"]["error"].startswith("direct/python: HTTP 404")
              and "wayback: no archived copy" in st["gone"]["error"], "404: %s" % st["gone"])
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

        # RMA-style outage: 502 live, the archive has a copy
        arch = {"id": "handbook", "url": base + "/archived-handbook.pdf", "kind": "pdf",
                "title": "T handbook", "why": "selftest"}
        write(srcs + [arch])
        done, _ = run(sp, out, ids="handbook", **kw)
        r = done[0]
        check(r["status"] == "new" and r["via"] == "wayback"
              and r["archive_timestamp"] == "20260901123456"
              and "/web/20260901123456id_/" in (r["final_url"] or ""), "archive fallback: %s" % r)
        check(any(a.startswith("direct/python: HTTP 502") for a in r.get("attempts", []))
              and any(a.startswith("direct/curl: HTTP 502") for a in r.get("attempts", [])),
              "live URL tried with both clients first: %s" % r.get("attempts"))
        if shutil.which("pdftotext"):
            check("Archived copy" in open(os.path.join(out, "refs/handbook.txt")).read(),
                  "archived text saved")
        s1 = summary(done)
        check("NOT LIVE handbook  via wayback snapshot 20260901123456" in s1, "summary: %s" % s1)
        check(any("fallback" in a and "handbook (wayback 20260901123456)" in a
                  for a in annotations(done)), "annotation for archive copy")
        # the next run tries the live URL again and replaces the archive copy
        state["rma_up"] = True
        done, _ = run(sp, out, ids="handbook", **kw)
        r = done[0]
        check(r["status"] == "updated" and r["via"] == "direct" and not r["archive_timestamp"],
              "live again replaces archive: %s" % r)
        if shutil.which("pdftotext"):
            check("Live copy" in open(os.path.join(out, "refs/handbook.txt")).read(),
                  "live text saved")

        # a client the site turns away: curl over HTTP/1.1 gets it
        cu = {"id": "curlonly", "url": base + "/curlonly.html", "kind": "html",
              "title": "T curl", "why": "selftest"}
        write(srcs + [arch, cu])
        if shutil.which("curl"):
            done, _ = run(sp, out, ids="curlonly", **kw)
            check(done[0]["status"] == "new" and (done[0].get("attempts") or [""])[-1] == "direct/curl: ok 200",
                  "curl fallback: %s" % done[0])

        # a host that never answers: after two sources it is skipped
        slow = [{"id": "slow%d" % i, "url": slow_base + "/slow%d" % i, "kind": "html",
                 "title": "T slow", "why": "selftest"} for i in (1, 2, 3)]
        write(srcs + [arch, cu] + slow)
        done, _ = run(sp, out, ids="slow1,slow2,slow3", **dict(kw, timeout=1))
        st = {r["id"]: r for r in done}
        check(all(st[i]["status"] == "failed" for i in st), "slow host fails")
        check("timed out" in st["slow1"]["error"], "timeout reported: %s" % st["slow1"]["error"])
        check("skipped, localhost timed out earlier" in st["slow3"]["error"],
              "dead host skipped: %s" % st["slow3"]["error"])
        ann = annotations(done)
        check(len(ann) <= 9 and "slow1, slow2, slow3" in ann[0], "annotations: %s" % ann)

        # bot checks are not saved; a real page that names the scripts is
        bots = [{"id": "waf", "url": base + "/waf.html", "kind": "html"},
                {"id": "incap", "url": base + "/incap.html", "kind": "html"},
                {"id": "longcf", "url": base + "/longcf.html", "kind": "html"},
                {"id": "jsplain", "url": base + "/js.html", "kind": "html"},
                {"id": "waswaf", "url": base + "/was-waf.html", "kind": "html"}]
        for b_ in bots:
            b_.update(title="T " + b_["id"], why="selftest")
        check(challenge_reason(WAF_PAGE) == "AWS WAF" and challenge_reason(INCAP_PAGE) == "Incapsula",
              "challenge signatures")
        write(srcs + bots)
        done, _ = run(sp, out, ids="waf,incap,longcf,jsplain", **dict(kw, max_bytes=200000))
        st = {r["id"]: r for r in done}
        for i, who in (("waf", "AWS WAF"), ("incap", "Incapsula")):
            check(st[i]["status"] == "failed" and ("bot challenge (%s)" % who) in st[i]["error"]
                  and "direct/curl: bot challenge" in st[i]["error"]
                  and not os.path.exists(os.path.join(out, "refs/%s.html" % i)),
                  "%s bot check not saved: %s" % (i, st[i]))
        check(st["longcf"]["status"] == "new", "long page behind Cloudflare saved: %s" % st["longcf"])
        check(st["jsplain"]["status"] == "new" and st["jsplain"]["error"].startswith("thin")
              and "try kind rendered" in st["jsplain"]["error"], "thin page noted: %s" % st["jsplain"])
        check("THIN jsplain" in summary(done), "summary lists thin pages")
        # an old copy that is a bot check (saved before this check existed)
        os.makedirs(os.path.join(out, "refs"), exist_ok=True)
        with open(os.path.join(out, "refs/waswaf.html"), "wb") as f:
            f.write(WAF_PAGE)
        with open(os.path.join(out, "refs/waswaf.txt"), "w") as f:
            f.write("old")
        idx = json.load(open(os.path.join(out, "index.json")))
        idx["sources"].append({"id": "waswaf", "url": base + "/was-waf.html", "saved_as": "refs/waswaf.html",
                               "sha256": "x", "bytes": len(WAF_PAGE), "status": "new"})
        with open(os.path.join(out, "index.json"), "w") as f:
            json.dump(idx, f)
        done, _ = run(sp, out, ids="waswaf", **kw)
        r = done[0]
        check(r["status"] == "failed" and r["saved_as"] is None and r["sha256"] is None
              and "old copy was a AWS WAF bot check, removed" in r["error"]
              and not os.path.exists(os.path.join(out, "refs/waswaf.html"))
              and not os.path.exists(os.path.join(out, "refs/waswaf.txt")),
              "old bot-check copy removed: %s" % r)
        state["waf_fixed"] = True
        done, _ = run(sp, out, ids="waswaf", **kw)
        check(done[0]["status"] == "new", "real page saved once the wall is gone: %s" % done[0])

        # kind "rendered": a headless browser runs the page's script
        rend = [{"id": "jsrend", "url": base + "/js.html", "kind": "rendered"},
                {"id": "wafrend", "url": base + "/waf.html", "kind": "rendered"},
                {"id": "gonerend", "url": base + "/missing", "kind": "rendered"}]
        for r_ in rend:
            r_.update(title="T " + r_["id"], why="selftest")
        write(srcs + bots + rend)
        check(not load_sources(sp, allow_http=True)[1], "rendered kind accepted")
        if _have_browser():
            done, _ = run(sp, out, ids="jsrend,wafrend,gonerend", **dict(kw, max_bytes=200000))
            st = {r["id"]: r for r in done}
            t = open(os.path.join(out, "refs/jsrend.txt")).read() \
                if os.path.exists(os.path.join(out, "refs/jsrend.txt")) else ""
            check(st["jsrend"]["status"] == "new" and "cash corn bid 4.12" in t
                  and "Bids app ready" in t and st["jsrend"]["saved_as"] == "refs/jsrend.html"
                  and st["jsrend"]["attempts"] == ["direct/browser: ok 200"]
                  and not st["jsrend"]["error"], "rendered text saved: %s %r" % (st["jsrend"], t[:300]))
            check(b"cash corn bid" in open(os.path.join(out, "refs/jsrend.html"), "rb").read(),
                  "rendered html saved")
            check(st["wafrend"]["status"] == "failed" and "bot challenge (AWS WAF)" in st["wafrend"]["error"]
                  and "wayback" not in st["wafrend"]["error"]
                  and not os.path.exists(os.path.join(out, "refs/wafrend.html")),
                  "rendered bot check not saved: %s" % st["wafrend"])
            check(st["gonerend"]["status"] == "failed"
                  and st["gonerend"]["error"].startswith("direct/browser: HTTP 404"),
                  "rendered 404: %s" % st["gonerend"])
        elif os.environ.get("REFS_REQUIRE_BROWSER") == "1":
            check(False, "REFS_REQUIRE_BROWSER=1 but playwright is not installed")
        else:
            done, _ = run(sp, out, ids="jsrend", **kw)
            check(done[0]["status"] == "failed" and "playwright not installed" in done[0]["error"],
                  "rendered without playwright fails cleanly: %s" % done[0])
            print("selftest: rendered pages not tried in a browser here (no playwright)")

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
        g.update(saved)
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
