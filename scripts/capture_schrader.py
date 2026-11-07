#!/usr/bin/env python3
"""
AGSIST -- capture Schrader Real Estate and Auction's sold feed and result pages, raw.

Step 1 of the auction results reader: real samples before any parser is written.
Nothing here parses a price, writes a data/ file on main or changes a page.

What one run fetches (User-Agent "AGSIST/1.0 (+https://agsist.com)", one request
every 2 seconds, nothing in parallel):
  1. https://www.schraderauction.com/robots.txt, once.
  2. https://www.schraderauction.com/index-sold.rss (the sold feed the site invites
     readers to subscribe to), saved byte for byte.
  3. Each item link of that feed that is an auction page (/auctions/NNNN), at most
     10, each page's HTML.

Where it goes: land/schrader/capture/<YYYY-MM-DD>/ (UTC date) in the checkout:
  robots.txt, index-sold.rss, auctions/<NNNN>.html, manifest.json
The workflow (.github/workflows/schrader-capture.yml) saves that folder to the
private raw branch with scripts/push_raw.sh; /land/schrader/ is in .gitignore, so
it never reaches main.

Buyers: buyer profile links are removed; plain-text names may remain in the private
raw capture. Any link under /buyers/ is skipped (robots disallows /buyers/profile/),
a redirect there is never followed, and any <a> pointing under /buyers/ inside a
saved page is blanked before the file is written. The manifest counts the blanked
links and, per page, the case-blind hits of "buyer", "purchaser" and "sold to"
(buyer_text_markers; the page itself is left as it is), so a parser can be checked.

Robots and manners: the robots.txt rules are obeyed for the feed and every page; if
robots.txt cannot be read (other than a 404), no auction page is fetched. The wait
between requests is the larger of 2 seconds and robots.txt's Crawl-delay; over 30
seconds, no auction page is fetched. Redirects are never followed blindly: one hop
at most, and only to the same host, outside /buyers/, where robots.txt allows it.

Exit: 0 when the feed was saved (page misses are listed in the manifest), 1 when
the feed itself could not be fetched.

  python3 scripts/capture_schrader.py              # one capture run
  python3 scripts/capture_schrader.py --selftest   # offline tests, made-up feed
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import urllib.robotparser
from datetime import datetime, timezone
from urllib.parse import urljoin, urlsplit

BASE = "https://www.schraderauction.com"
HOST = "www.schraderauction.com"
FEED = BASE + "/index-sold.rss"
ROBOTS = BASE + "/robots.txt"
UA = "AGSIST/1.0 (+https://agsist.com)"
MAX_PAGES = 10
DELAY_S = 2.0
TIMEOUT_S = 30
MAX_BYTES = 5 * 1024 * 1024
MAX_DELAY_S = 30.0
MARKERS = re.compile(r"buyer|purchaser|sold to", re.I)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_BASE = os.path.join("land", "schrader", "capture")

AUCTION_PATH = re.compile(r"^/auctions/(\d{1,7})/?$")
BUYER_A = re.compile(r"""<a\b[^>]*\bhref\s*=\s*["']?[^"'\s>]*/buyers/[^>]*>.*?</a\s*>""", re.I | re.S)


def is_buyer_path(path):
    return "/buyers/" in (path or "").lower() + "/"


def item_links(feed_bytes, limit=MAX_PAGES):
    """Auction page URLs from the feed's items, in feed order: on Schrader's host,
    path /auctions/NNNN, never under /buyers/, no repeats, at most `limit`.
    Returns (urls, skipped) where skipped is [(url, why)]."""
    text = feed_bytes.decode("latin-1")  # header says ISO-8859-1, XML says UTF-8; links are ASCII either way
    urls, skipped, seen = [], [], set()
    for item in re.findall(r"<item\b.*?</item\s*>", text, re.I | re.S):
        cands = re.findall(r"<(?:link|guid)\b[^>]*>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)", item, re.I)
        for raw in cands:
            u = urljoin(BASE + "/", raw.strip().replace("&amp;", "&"))
            p = urlsplit(u)
            if u in seen:
                continue
            seen.add(u)
            if is_buyer_path(p.path):
                skipped.append((u, "buyers path"))
                continue
            if p.scheme not in ("http", "https") or (p.hostname or "").lower() not in (HOST, "schraderauction.com"):
                skipped.append((u, "not on schraderauction.com"))
                continue
            m = AUCTION_PATH.match(p.path)
            if not m:
                skipped.append((u, "not an auction page"))
                continue
            canon = f"{BASE}/auctions/{m.group(1)}"
            if canon in urls:
                continue
            if len(urls) >= limit:
                skipped.append((canon, f"over the {limit} page cap"))
                continue
            urls.append(canon)
    return urls, skipped


def blank_buyer_links(html_bytes):
    """Blank every <a> that points under /buyers/. Returns (bytes, count)."""
    text = html_bytes.decode("latin-1")
    out, n = BUYER_A.subn('<a data-agsist-removed="profile-link"></a>', text)
    return out.encode("latin-1"), n


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # the 3xx comes back as an HTTPError; capture() decides whether to follow


_OPENER = urllib.request.build_opener(_NoRedirect)


def http_get(url):
    """One request, never following a redirect: (status, Location header or "", body bytes).
    status 0 means no answer."""
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    try:
        with _OPENER.open(req, timeout=TIMEOUT_S) as r:
            return r.status, "", r.read(MAX_BYTES + 1)
    except urllib.error.HTTPError as e:
        return e.code, (e.headers.get("Location") or "") if e.headers else "", b""
    except Exception as e:  # noqa: BLE001 - any network failure is a miss, recorded
        print(f"capture: {url}: {type(e).__name__}")
        return 0, url, b""


class Polite:
    """Every request after the first waits `delay` seconds; `get` and `sleep` are swappable for tests."""
    def __init__(self, get=http_get, sleep=time.sleep, delay=DELAY_S):
        self.get, self.sleep, self.delay, self.n = get, sleep, delay, 0

    def __call__(self, url):
        if self.n:
            self.sleep(self.delay)
        self.n += 1
        return self.get(url)


def capture(out_root=ROOT, get=http_get, sleep=time.sleep, now=None):
    now = now or datetime.now(timezone.utc)
    day = now.strftime("%Y-%m-%d")
    rel = os.path.join(OUT_BASE, day)
    out = os.path.join(out_root, rel)
    os.makedirs(out, exist_ok=True)
    fetch = Polite(get, sleep)
    man = {"source": "Schrader Real Estate and Auction Company", "feed": FEED, "user_agent": UA,
           "captured_utc": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "delay_s": DELAY_S, "crawl_delay": None,
           "max_pages": MAX_PAGES, "files": [], "skipped": [], "buyer_links_blanked": 0}

    def save(name, url, status, body, **extra):
        path = os.path.join(out, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as fh:
            fh.write(body)
        man["files"].append({"file": name, "url": url, "status": status, "bytes": len(body),
                             "fetched_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), **extra})

    def allowed(u):
        """Why u may not be fetched, or "" when it may."""
        p = urlsplit(u)
        if p.scheme not in ("http", "https") or (p.hostname or "").lower() not in (HOST, "schraderauction.com"):
            return "not on schraderauction.com"
        if is_buyer_path(p.path):
            return "buyers path"
        if not rp.can_fetch(UA, u):
            return "robots.txt disallows"
        return ""

    def get_one(u):
        """(status, final url, body, why): a 3xx is followed one hop, only where allowed()."""
        st, loc, body = fetch(u)
        if 300 <= st < 400:
            if not loc:
                return st, u, b"", f"redirect {st} with no Location; not followed"
            nxt = urljoin(u, loc)
            why = allowed(nxt)
            if why:
                return st, nxt, b"", f"redirect to {nxt} not followed ({why})"
            st, loc, body = fetch(nxt)
            if 300 <= st < 400:
                return st, nxt, b"", "a second redirect; not followed"
            return st, nxt, body, ""
        return st, u, body, ""

    st, _, body = fetch(ROBOTS)
    rp = urllib.robotparser.RobotFileParser()
    pages_ok = True
    if st == 200 and len(body) <= MAX_BYTES:
        save("robots.txt", ROBOTS, st, body)
        rp.parse(body.decode("utf-8", "replace").splitlines())
    elif st in (404, 410):
        rp.parse([])
    else:
        rp.parse([])
        pages_ok = False
        man["skipped"].append({"url": ROBOTS, "why": f"robots.txt unreadable (status {st}); no auction pages fetched"})
    cd = rp.crawl_delay(UA)
    if cd is not None:
        try:
            cd = float(cd)
        except (TypeError, ValueError):
            cd = None
    man["crawl_delay"] = cd
    fetch.delay = max(DELAY_S, cd or 0.0)
    man["delay_s"] = fetch.delay
    if fetch.delay > MAX_DELAY_S:
        pages_ok = False
        man["skipped"].append({"url": ROBOTS, "why": f"Crawl-delay {cd:g} s is over {MAX_DELAY_S:g} s; no auction pages fetched"})

    why = allowed(FEED)
    if why:
        man["skipped"].append({"url": FEED, "why": f"feed not fetched ({why})"})
        write_manifest(out, man)
        print(f"capture: the sold feed is not to be fetched ({why}); manifest only in {rel}")
        return 1, rel, man
    st, final, body, why = get_one(FEED)
    if why or st != 200 or not body or len(body) > MAX_BYTES:
        man["skipped"].append({"url": FEED, "why": why or f"feed not saved (status {st}, {len(body)} bytes)"})
        write_manifest(out, man)
        print(f"capture: the sold feed did not answer (status {st}); manifest only in {rel}")
        return 1, rel, man
    save("index-sold.rss", FEED, st, body)

    urls, skipped = item_links(body)
    man["skipped"] += [{"url": u, "why": w} for u, w in skipped]
    for u in urls:
        if not pages_ok:
            man["skipped"].append({"url": u, "why": "no auction pages this run (see the robots.txt row)"})
            continue
        why = allowed(u)
        if why:
            man["skipped"].append({"url": u, "why": why})
            continue
        st, final, page, why = get_one(u)
        if why:
            man["skipped"].append({"url": u, "why": why})
            continue
        if st != 200 or not page or len(page) > MAX_BYTES:
            man["skipped"].append({"url": u, "why": f"status {st}, {len(page)} bytes; not saved"})
            continue
        page, n = blank_buyer_links(page)
        man["buyer_links_blanked"] += n
        markers = len(MARKERS.findall(page.decode("latin-1")))
        save(f"auctions/{AUCTION_PATH.match(urlsplit(u).path).group(1)}.html", u, st, page,
             final_url=final, buyer_links_blanked=n, buyer_text_markers=markers)

    write_manifest(out, man)
    print(f"capture: {len(man['files'])} file(s) in {rel}, {len(man['skipped'])} skipped, "
          f"{fetch.n} request(s)")
    return 0, rel, man


def write_manifest(out, man):
    with open(os.path.join(out, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(man, fh, indent=1, sort_keys=True)
        fh.write("\n")


# ---------------------------------------------------------------- selftest

FIXTURE = b"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Sold</title><link>https://www.schraderauction.com/</link>
<item><title>$1,000,000 - 100 acres Example County</title><link>https://www.schraderauction.com/auctions/1001</link>
<guid>https://www.schraderauction.com/auctions/1001</guid><pubDate>Mon, 02 Nov 2026 00:00:00 GMT</pubDate></item>
<item><title>buyer</title><link>https://www.schraderauction.com/buyers/profile/77</link></item>
<item><title>off host</title><link>https://example.com/auctions/5</link></item>
<item><title>relative</title><link>/auctions/1002/</link></item>
<item><title>cdata</title><guid><![CDATA[https://www.schraderauction.com/auctions/1003]]></guid></item>
<item><title>other page</title><link>https://www.schraderauction.com/news/1</link></item>
""" + b"".join(b"<item><title>t</title><link>https://www.schraderauction.com/auctions/%d</link></item>\n" % n
               for n in range(2001, 2011)) + b"</channel></rss>\n"

PAGE = (b"<html><body><h1>Auction 1001</h1><p>Sold</p>"
        b"<a href=\"/buyers/profile/77\">A Buyer Name</a> <a href='https://www.schraderauction.com/buyers/x'>Other</a>"
        b"<p>Sold to the high bidder. The Purchaser pays the BUYER premium.</p>"
        b"<a href=\"/auctions/1002\">next</a></body></html>")


def selftest():
    import shutil
    import tempfile
    fails = []

    def check(ok, what):
        print(("ok   " if ok else "FAIL ") + what)
        if not ok:
            fails.append(what)

    urls, skipped = item_links(FIXTURE)
    check(urls[:3] == [f"{BASE}/auctions/1001", f"{BASE}/auctions/1002", f"{BASE}/auctions/1003"],
          "item links extracted in feed order (absolute, relative, CDATA guid; link+guid counted once)")
    check(len(urls) == MAX_PAGES, f"at most {MAX_PAGES} pages ({len(urls)})")
    check(not any("/buyers/" in u for u in urls), "no /buyers/ link kept")
    why = dict(skipped)
    check(why.get(f"{BASE}/buyers/profile/77") == "buyers path", "/buyers/ link skipped and recorded")
    check(why.get("https://example.com/auctions/5") == "not on schraderauction.com", "off-host link skipped")
    check(why.get(f"{BASE}/news/1") == "not an auction page", "non-auction link skipped")
    check(sum(1 for w in why.values() if w.startswith("over the")) == 3, "the three links past the cap are recorded")
    check(item_links(FIXTURE, limit=2)[0] == urls[:2], "the cap is a parameter")
    check(is_buyer_path("/Buyers/profile/1") and is_buyer_path("/buyers") and not is_buyer_path("/auctions/1"),
          "buyers path test is case-blind and catches the bare folder")

    blanked, n = blank_buyer_links(PAGE)
    check(n == 2 and b"Buyer Name" not in blanked and b"Other" not in blanked and b"/auctions/1002" in blanked,
          "buyer links blanked in a saved page, other links kept")

    calls, sleeps = [], []
    robots = b"User-agent: *\nDisallow: /buyers/profile/\nDisallow: /auctions/2005\nDisallow: /private/\n"
    redirects = {f"{BASE}/auctions/1002": "/auction-results/1002",      # allowed: followed one hop
                 f"{BASE}/auctions/2002": "/hop1", f"{BASE}/hop1": "/hop2",  # a second hop: not followed
                 f"{BASE}/auctions/2003": "/Buyers/profile/9",          # buyers: never requested
                 f"{BASE}/auctions/2006": "/private/x",                 # robots disallows: never requested
                 f"{BASE}/auctions/2007": "https://example.com/a"}      # off host: never requested

    def fake(robots_body, robots_status=200):
        def get(url):
            calls.append(url)
            if url == ROBOTS:
                return robots_status, "", robots_body
            if url in redirects:
                return 302, redirects[url], b""
            if url == FEED:
                return 200, "", FIXTURE
            if url.endswith("/auctions/2004"):
                return 500, "", b""
            return 200, "", PAGE
        return get

    tmp = tempfile.mkdtemp(prefix="schrader-")
    try:
        now = datetime(2026, 11, 7, 15, 0, tzinfo=timezone.utc)
        code, rel, man = capture(tmp, fake(robots), sleeps.append, now)
        out = os.path.join(tmp, rel)
        check(code == 0 and rel == os.path.join("land", "schrader", "capture", "2026-11-07"),
              "dated folder land/schrader/capture/<YYYY-MM-DD>/")
        check(calls[0] == ROBOTS and calls[1] == FEED and calls.count(ROBOTS) == 1, "robots.txt once, first, then the feed")
        check(not any("/buyers/" in c.lower() for c in calls), "no request ever goes to a /buyers/ path (redirects included)")
        check(f"{BASE}/auctions/2005" not in calls, "a robots.txt Disallow is obeyed")
        check(f"{BASE}/private/x" not in calls, "no request to a redirect target robots.txt disallows")
        check("https://example.com/a" not in calls, "no request to an off-host redirect target")
        check(f"{BASE}/auction-results/1002" in calls, "an allowed redirect is followed")
        check(f"{BASE}/hop1" in calls and f"{BASE}/hop2" not in calls, "at most one redirect hop")
        check(len(calls) == 13, f"robots + feed + 10 page requests + 1 hop ({len(calls)} requests)")
        check(len(sleeps) == len(calls) - 1 and all(x == DELAY_S for x in sleeps),
              f"a {DELAY_S:g} s wait before every request after the first, hops included ({len(sleeps)} waits)")
        with open(os.path.join(out, "index-sold.rss"), "rb") as fh:
            check(fh.read() == FIXTURE, "the feed is saved byte for byte")
        saved = sorted(os.listdir(os.path.join(out, "auctions")))
        check(saved == ["1001.html", "1002.html", "1003.html", "2001.html"],
              f"redirect-refused, failed and disallowed pages are not saved ({saved})")
        with open(os.path.join(out, "auctions", "1001.html"), "rb") as fh:
            check(b"Buyer Name" not in fh.read(), "a saved page carries no buyer link text")
        check(os.path.exists(os.path.join(out, "robots.txt")), "robots.txt saved")
        with open(os.path.join(out, "manifest.json"), encoding="utf-8") as fh:
            m = json.load(fh)
        why = {r["url"]: r["why"] for r in m["skipped"]}
        check("not followed" in why.get(f"{BASE}/auctions/2006", "") and "robots" in why[f"{BASE}/auctions/2006"]
              and "buyers" in why.get(f"{BASE}/auctions/2003", "") and "second redirect" in why.get(f"{BASE}/auctions/2002", ""),
              "refused redirects are recorded with the reason")
        check(m["buyer_links_blanked"] == 2 * len(saved), "manifest counts the blanked buyer links")
        pages = [f for f in m["files"] if f["file"].startswith("auctions/")]
        check(all(f["buyer_text_markers"] == 3 for f in pages), "per-page buyer_text_markers (buyer, purchaser, sold to; case-blind)")
        with open(os.path.join(out, "auctions", "1001.html"), "rb") as fh:
            check(b"Sold to the high bidder. The Purchaser pays the BUYER premium." in fh.read(), "marker text left in the page")
        check([f["final_url"] for f in pages if f["file"] == "auctions/1002.html"] == [f"{BASE}/auction-results/1002"],
              "a followed redirect records its final URL")
        keys = {"file", "url", "status", "bytes", "fetched_utc", "final_url", "buyer_links_blanked", "buyer_text_markers"}
        check(all(set(f) <= keys for f in m["files"]), "manifest rows hold file facts and counts only")
        check(m["crawl_delay"] is None and m["delay_s"] == DELAY_S, "no Crawl-delay: 2 s, recorded")

        calls.clear(); sleeps.clear()
        code, _, m = capture(tmp, fake(robots + b"Crawl-delay: 5\n"), sleeps.append, now)
        check(code == 0 and sleeps and all(x == 5.0 for x in sleeps) and m["crawl_delay"] == 5.0 and m["delay_s"] == 5.0,
              "Crawl-delay 5 is honored and recorded")
        calls.clear(); sleeps.clear()
        code, _, m = capture(tmp, fake(robots + b"Crawl-delay: 1\n"), sleeps.append, now)
        check(all(x == DELAY_S for x in sleeps), "a Crawl-delay under 2 s never shortens the wait")
        calls.clear(); sleeps.clear()
        code, _, m = capture(tmp, fake(robots + b"Crawl-delay: 60\n"), sleeps.append, now)
        check(code == 0 and calls == [ROBOTS, FEED] and any("Crawl-delay 60" in r["why"] for r in m["skipped"]),
              "Crawl-delay over 30 s: feed only, no auction page, reason recorded")

        calls.clear()
        code, _, m = capture(tmp, fake(b"User-agent: *\nDisallow: /index-sold.rss\n"), lambda x: None, now)
        check(code == 1 and calls == [ROBOTS] and any("robots.txt disallows" in r["why"] for r in m["skipped"]),
              "robots.txt disallows the feed: not fetched, exit 1")

        calls.clear(); sleeps.clear()
        code, _, m = capture(tmp, lambda u: (calls.append(u), (503, "", b""))[1], sleeps.append, now)
        check(code == 1 and calls == [ROBOTS, FEED], "robots and feed both down: exit 1, no page requests")

        calls.clear()
        code, _, m = capture(tmp, fake(b"", 500), lambda x: None, now)
        check(code == 0 and calls == [ROBOTS, FEED], "robots.txt unreadable: feed saved, no auction page fetched")

        calls.clear()
        redirects[FEED] = "/buyers/feed"
        code, _, m = capture(tmp, fake(robots), lambda x: None, now)
        check(code == 1 and calls == [ROBOTS, FEED], "a feed redirect to /buyers/ is not followed")
        del redirects[FEED]
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print(f"capture_schrader selftest: {len(fails)} failure(s)")
    return 1 if fails else 0


def main(argv):
    if "--selftest" in argv:
        return selftest()
    code, _, _ = capture()
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
