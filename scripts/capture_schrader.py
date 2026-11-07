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

Buyers: nothing about buyers is stored. Any link under /buyers/ is skipped (robots
disallows /buyers/profile/), a page that redirects there is dropped, and any
<a> pointing under /buyers/ inside a saved page is blanked before the file is
written (the count is in the manifest). The robots.txt rules are obeyed for every
page; if robots.txt cannot be read (other than a 404), no auction page is fetched.

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
    out, n = BUYER_A.subn('<a data-agsist-removed="buyer-link"></a>', text)
    return out.encode("latin-1"), n


def http_get(url):
    """(status, final_url, body bytes). status 0 means no answer."""
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
            body = r.read(MAX_BYTES + 1)
            return r.status, r.geturl(), body
    except urllib.error.HTTPError as e:
        return e.code, url, b""
    except Exception as e:  # noqa: BLE001 - any network failure is a miss, recorded
        print(f"capture: {url}: {type(e).__name__}")
        return 0, url, b""


class Polite:
    """Every request after the first waits DELAY_S; `get` and `sleep` are swappable for tests."""
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
           "captured_utc": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "delay_s": DELAY_S, "max_pages": MAX_PAGES,
           "files": [], "skipped": [], "buyer_links_blanked": 0}

    def save(name, url, status, body):
        path = os.path.join(out, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as fh:
            fh.write(body)
        man["files"].append({"file": name, "url": url, "status": status, "bytes": len(body),
                             "fetched_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")})

    st, _, body = fetch(ROBOTS)
    rp = urllib.robotparser.RobotFileParser()
    pages_ok = True
    if st == 200 and len(body) <= MAX_BYTES:
        save("robots.txt", ROBOTS, st, body)
        rp.parse(body.decode("utf-8", "replace").splitlines())
    elif st in (404, 410):
        rp.parse([])
    else:
        pages_ok = False
        man["skipped"].append({"url": ROBOTS, "why": f"robots.txt unreadable (status {st}); no auction pages fetched"})

    st, final, body = fetch(FEED)
    if st != 200 or not body or len(body) > MAX_BYTES:
        man["skipped"].append({"url": FEED, "why": f"feed not saved (status {st}, {len(body)} bytes)"})
        write_manifest(out, man)
        print(f"capture: the sold feed did not answer (status {st}); manifest only in {rel}")
        return 1, rel, man
    save("index-sold.rss", FEED, st, body)

    urls, skipped = item_links(body)
    man["skipped"] += [{"url": u, "why": w} for u, w in skipped]
    for u in urls:
        if not pages_ok:
            man["skipped"].append({"url": u, "why": "robots.txt unreadable"})
            continue
        if not rp.can_fetch(UA, u):
            man["skipped"].append({"url": u, "why": "robots.txt disallows"})
            continue
        st, final, page = fetch(u)
        fp = urlsplit(final)
        if is_buyer_path(fp.path) or (fp.hostname or "").lower() not in (HOST, "schraderauction.com"):
            man["skipped"].append({"url": u, "why": "redirected off the auction page; not saved"})
            continue
        if st != 200 or not page or len(page) > MAX_BYTES:
            man["skipped"].append({"url": u, "why": f"status {st}, {len(page)} bytes; not saved"})
            continue
        page, n = blank_buyer_links(page)
        man["buyer_links_blanked"] += n
        save(f"auctions/{AUCTION_PATH.match(urlsplit(u).path).group(1)}.html", u, st, page)

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
    robots = b"User-agent: *\nDisallow: /buyers/profile/\nDisallow: /auctions/2005\n"

    def fake_get(url):
        calls.append(url)
        if url == ROBOTS:
            return 200, url, robots
        if url == FEED:
            return 200, url, FIXTURE
        if url.endswith("/auctions/2003"):
            return 200, f"{BASE}/buyers/profile/9", b"<html>redirected</html>"
        if url.endswith("/auctions/2004"):
            return 500, url, b""
        return 200, url, PAGE

    tmp = tempfile.mkdtemp(prefix="schrader-")
    try:
        now = datetime(2026, 11, 7, 15, 0, tzinfo=timezone.utc)
        code, rel, man = capture(tmp, fake_get, sleeps.append, now)
        out = os.path.join(tmp, rel)
        check(code == 0 and rel == os.path.join("land", "schrader", "capture", "2026-11-07"),
              "dated folder land/schrader/capture/<YYYY-MM-DD>/")
        check(calls[0] == ROBOTS and calls[1] == FEED and calls.count(ROBOTS) == 1, "robots.txt once, first, then the feed")
        check(not any("/buyers/" in c for c in calls), "no request ever goes to a /buyers/ path")
        check(f"{BASE}/auctions/2005" not in calls, "a robots.txt Disallow is obeyed")
        check(len(calls) == 2 + MAX_PAGES - 1, f"robots + feed + pages under the cap ({len(calls)} requests)")
        check(len(sleeps) == len(calls) - 1 and all(s == DELAY_S for s in sleeps),
              f"a {DELAY_S:g} s wait before every request after the first ({len(sleeps)} waits)")
        with open(os.path.join(out, "index-sold.rss"), "rb") as fh:
            check(fh.read() == FIXTURE, "the feed is saved byte for byte")
        saved = sorted(os.listdir(os.path.join(out, "auctions")))
        check("1001.html" in saved and "2003.html" not in saved and "2004.html" not in saved
              and "2005.html" not in saved, "redirected, failed and disallowed pages are not saved")
        with open(os.path.join(out, "auctions", "1001.html"), "rb") as fh:
            check(b"Buyer Name" not in fh.read(), "a saved page carries no buyer link text")
        check(os.path.exists(os.path.join(out, "robots.txt")), "robots.txt saved")
        with open(os.path.join(out, "manifest.json"), encoding="utf-8") as fh:
            m = json.load(fh)
        check(m["buyer_links_blanked"] == 2 * (len(saved)), "manifest counts the blanked buyer links")
        check(not any("buyer" in k for f in m["files"] for k in f), "manifest rows hold file facts only")

        calls.clear(); sleeps.clear()
        code, _, man = capture(tmp, lambda u: (calls.append(u), (503, u, b""))[1], sleeps.append, now)
        check(code == 1 and calls == [ROBOTS, FEED], "robots and feed both down: exit 1, no page requests")

        calls.clear()
        def robots_down(url):
            calls.append(url)
            return (500, url, b"") if url == ROBOTS else (200, url, FIXTURE)
        code, _, man = capture(tmp, robots_down, lambda s: None, now)
        check(code == 0 and calls == [ROBOTS, FEED], "robots.txt unreadable: feed saved, no auction page fetched")
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
