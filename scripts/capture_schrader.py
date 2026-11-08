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

Backfill (--backfill; Sig approved one manual run Nov 8, 2026, no schedule; only the
workflow_dispatch input "backfill" runs it): walks Schrader's recent_auctions archive,
filtered by state, for IA NE OH MI KY AR MS TX OK CO WA GA, collects the auction ids,
skips ids captured before (weekly capture pages in this checkout, the saved data file,
pages an earlier backfill run saved) and saves each auction page. Same manners: robots.txt
first and obeyed, 2 s apart (or the Crawl-delay), /buyers/ never fetched, buyer links
blanked. Paging follows the archive page's own pager links (/recent_auctions/<per>/<offset>);
a page with no pager link past it ends the walk, and so does a page that adds no new id.
At most 2,500 requests and 120 minutes per run. Everything goes to land/schrader/backfill/:
  robots.txt, archive/<ST>/<offset>.html, auctions/<NNNN>.html, runs/<stamp>.json, and
  state.json, the resume point (each state's walk, ids saved, ids that failed; a page that
  failed twice is not asked for again). The workflow restores state.json from the raw branch
  first, so a second run goes on where the first stopped. No parsing here either.

Exit: 0 when the feed was saved (page misses are listed in the manifest), 1 when
the feed itself could not be fetched. Backfill: 1 when robots.txt said no or could not
be read, or no archive page ever answered; 0 otherwise (a cap reached is a clean stop).

  python3 scripts/capture_schrader.py              # one capture run
  python3 scripts/capture_schrader.py --backfill   # the archive backfill (dispatch input only)
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


def why_not(rp, u):
    """Why u may not be fetched, or "" when it may: Schrader's host only, never /buyers/, robots.txt obeyed."""
    p = urlsplit(u)
    if p.scheme not in ("http", "https") or (p.hostname or "").lower() not in (HOST, "schraderauction.com"):
        return "not on schraderauction.com"
    if is_buyer_path(p.path):
        return "buyers path"
    if not rp.can_fetch(UA, u):
        return "robots.txt disallows"
    return ""


def get_follow(fetch, rp, u):
    """(status, final url, body, why): a 3xx is followed one hop, only where why_not() allows it."""
    st, loc, body = fetch(u)
    if 300 <= st < 400:
        if not loc:
            return st, u, b"", f"redirect {st} with no Location; not followed"
        nxt = urljoin(u, loc)
        why = why_not(rp, nxt)
        if why:
            return st, nxt, b"", f"redirect to {nxt} not followed ({why})"
        st, loc, body = fetch(nxt)
        if 300 <= st < 400:
            return st, nxt, b"", "a second redirect; not followed"
        return st, nxt, body, ""
    return st, u, body, ""


def read_robots(fetch):
    """Fetch robots.txt first. Returns (parser, pages_ok, body to save or None, skipped notes) and sets
    fetch.delay to the larger of 2 s and the Crawl-delay (fetch.crawl_delay records the latter).
    pages_ok is False when robots.txt could not be read (other than a 404) or asks for over 30 s."""
    st, _, body = fetch(ROBOTS)
    rp = urllib.robotparser.RobotFileParser()
    pages_ok, saved, notes = True, None, []
    if st == 200 and len(body) <= MAX_BYTES:
        saved = body
        rp.parse(body.decode("utf-8", "replace").splitlines())
    elif st in (404, 410):
        rp.parse([])
    else:
        rp.parse([])
        pages_ok = False
        notes.append({"url": ROBOTS, "why": f"robots.txt unreadable (status {st}); no auction pages fetched"})
    cd = rp.crawl_delay(UA)
    if cd is not None:
        try:
            cd = float(cd)
        except (TypeError, ValueError):
            cd = None
    fetch.crawl_delay = cd
    fetch.delay = max(DELAY_S, cd or 0.0)
    if fetch.delay > MAX_DELAY_S:
        pages_ok = False
        notes.append({"url": ROBOTS, "why": f"Crawl-delay {cd:g} s is over {MAX_DELAY_S:g} s; no auction pages fetched"})
    return rp, pages_ok, saved, notes


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
        return why_not(rp, u)

    def get_one(u):
        return get_follow(fetch, rp, u)

    rp, pages_ok, robots_body, notes = read_robots(fetch)
    if robots_body is not None:
        save("robots.txt", ROBOTS, 200, robots_body)
    man["skipped"] += notes
    man["crawl_delay"] = fetch.crawl_delay
    man["delay_s"] = fetch.delay

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


# ---------------------------------------------------------------- backfill (workflow_dispatch input only)

BACKFILL_STATES = ("IA", "NE", "OH", "MI", "KY", "AR", "MS", "TX", "OK", "CO", "WA", "GA")
ARCHIVE = BASE + "/auctions/recent_auctions"
PER_PAGE = 20
MAX_REQUESTS = 2500
MAX_MINUTES = 120
MAX_ARCHIVE_PAGES = 150   # per state: 3,000 rows, past the whole national archive (about 1,730)
MAX_TRIES = 2             # an auction page that failed twice is not asked for again
BACKFILL_BASE = os.path.join("land", "schrader", "backfill")
SAVED_DATA = os.path.join("data", "land", "auctions", "schrader.json")
PAGER = re.compile(r"/auctions/recent_auctions/(\d{1,3})/(\d{1,6})(?:[/?#]|$)")
HREF = re.compile(r"""\bhref\s*=\s*["']?([^"'\s>]+)""", re.I)
# An archive item links by slug ("/auctions/williams-county-ohio-land-auction-63-acres-march-2026"), a
# numeric page by number. A slug has a hyphen and a digit, so /auctions/recent_auctions, /auctions/all
# and the like are never taken. The slug is the key of a backfilled page; a numeric page carries it as
# its <link rel="canonical">.
SLUG = r"(?=[^/]*\d)[a-z0-9]+(?:-[a-z0-9]+)+"
ARCHIVE_ITEM = re.compile(r"^/auctions/(\d{1,7}(?:/[^/]*)?|" + SLUG + r"/?)/?$")
ID_FILE = re.compile(r"(?:\d{1,7}|" + SLUG + r")\.html")
CANONICAL = re.compile(r"""<link\b[^>]*\brel\s*=\s*["']canonical["'][^>]*>""", re.I)
CANON_SLUG = re.compile(r"""\bhref\s*=\s*["']https?://[^"'/]*schraderauction\.com/auctions/(""" + SLUG + r""")/?["']""", re.I)


def id_order(i):
    """Numbers first (oldest number first), then slugs in name order."""
    return (0, int(i), "") if i.isdigit() else (1, 0, i)


def canonical_slug(page_bytes):
    """The slug in a page's <link rel="canonical"> ("" when there is none)."""
    m = CANONICAL.search(page_bytes.decode("latin-1"))
    g = CANON_SLUG.search(m.group(0)) if m else None
    return g.group(1).lower() if g else ""


def archive_url(state, per=PER_PAGE, offset=0):
    if not offset:
        return f"{ARCHIVE}?state={state}"
    return f"{ARCHIVE}/{per}/{offset}?state={state}"


def archive_links(page_bytes, base=ARCHIVE):
    """(auction ids in page order, pager (per, offset) pairs, other recent_auctions links) from one
    archive page; relative links resolve against `base`, the page's own URL. Only links on Schrader's
    host; /buyers/ links are never taken. The other links (at most 10) are kept in the run file so a
    pager of another shape shows up there."""
    text = page_bytes.decode("latin-1")
    ids, pager, other = [], set(), []
    for raw in HREF.findall(text):
        u = urljoin(base, html_unescape(raw))
        p = urlsplit(u)
        if (p.hostname or "").lower() not in (HOST, "schraderauction.com") or is_buyer_path(p.path):
            continue
        m = ARCHIVE_ITEM.match(p.path)
        if m:
            i = m.group(1).split("/")[0]
            if i not in ids:
                ids.append(i)
            continue
        g = PAGER.search(p.path)
        if g:
            pager.add((int(g.group(1)), int(g.group(2))))
        elif "recent_auctions" in p.path and len(other) < 10 and u not in other:
            other.append(u)
    return ids, sorted(pager), other


def html_unescape(s):
    return s.replace("&amp;", "&")


def next_offset(offset, page_ids, pager):
    """The next archive page as (per, offset), or None. The page's own pager wins: the smallest pager
    offset past this one. With no pager link past this one, a full page (PER_PAGE ids or more) is
    followed by offset + PER_PAGE; the walk still stops at the first page that adds no new id."""
    ahead = [(per, off) for per, off in pager if off > offset]
    if ahead:
        return min(ahead, key=lambda x: x[1])
    if pager:
        return None  # a pager with nothing past this page: the last page
    if len(page_ids) >= PER_PAGE:
        return (PER_PAGE, offset + PER_PAGE)
    return None


def known_ids(out_root):
    """Auction ids captured before: weekly capture pages (the number and, from the page's canonical link,
    the slug) and the saved data file (both in this checkout)."""
    ids = set()
    cap = os.path.join(out_root, OUT_BASE)
    for d in sorted(os.listdir(cap)) if os.path.isdir(cap) else []:
        ad = os.path.join(cap, d, "auctions")
        for f in os.listdir(ad) if os.path.isdir(ad) else []:
            if ID_FILE.fullmatch(f):
                ids.add(f[:-5])
                if f[:-5].isdigit():
                    try:
                        with open(os.path.join(ad, f), "rb") as fh:
                            slug = canonical_slug(fh.read(200000))
                    except OSError:
                        slug = ""
                    if slug:
                        ids.add(slug)
    try:
        with open(os.path.join(out_root, SAVED_DATA), encoding="utf-8") as fh:
            ids |= {str(r.get("auction_id")) for r in json.load(fh).get("records") or []}
    except (OSError, ValueError, AttributeError):
        pass
    return ids


def load_state(path, states):
    try:
        with open(path, encoding="utf-8") as fh:
            st = json.load(fh)
    except (OSError, ValueError):
        st = {}
    st.setdefault("states", {})
    for s in states:
        st["states"].setdefault(s, {"done": False, "next": [0, 0], "pages": 0, "ids": [], "stop": ""})
    st.setdefault("saved", [])
    st.setdefault("failed", {})
    st.setdefault("runs", [])
    return st


def write_json(path, doc):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=1, sort_keys=True)
        fh.write("\n")
    os.replace(tmp, path)


def backfill(out_root=ROOT, get=http_get, sleep=time.sleep, now=None, clock=time.monotonic,
             states=BACKFILL_STATES, max_requests=MAX_REQUESTS, max_minutes=MAX_MINUTES):
    """Walk Schrader's recent_auctions archive for each state, then save every auction page not captured
    before. Everything lands under land/schrader/backfill/ (state.json carries the resume point, saved to
    the raw branch with the pages, so a second run goes on where the first stopped). Returns (code, man)."""
    now = now or datetime.now(timezone.utc)
    out = os.path.join(out_root, BACKFILL_BASE)
    os.makedirs(out, exist_ok=True)
    spath = os.path.join(out, "state.json")
    st = load_state(spath, states)
    fetch = Polite(get, sleep)
    t0 = clock()
    stamp = now.strftime("%Y-%m-%dT%H%M%SZ")
    man = {"source": "Schrader Real Estate and Auction Company", "archive": ARCHIVE, "user_agent": UA,
           "started_utc": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "max_requests": max_requests,
           "max_minutes": max_minutes, "archive_pages": [], "files": [], "skipped": [],
           "buyer_links_blanked": 0, "stopped": "", "empty_archive_pages": []}

    def budget():
        """Why no further request may start, or ""."""
        if fetch.n >= max_requests:
            return f"request cap {max_requests} reached"
        if clock() - t0 >= max_minutes * 60:
            return f"time budget {max_minutes} min reached"
        return ""

    def finish(code, why=""):
        if man["empty_archive_pages"]:
            code = 1
            why = why or "archive page(s) with 0 auction links: " + ", ".join(man["empty_archive_pages"])
        man["stopped"] = man["stopped"] or why
        man["requests"] = fetch.n
        man["delay_s"] = fetch.delay
        man["saved_pages"] = sum(1 for f in man["files"] if f["file"].startswith("auctions/"))
        pending = queue_ids() - set(st["saved"]) - done_failed() - known_ids(out_root)
        man["pending_after"] = len(pending)
        man["states_done"] = sorted(s for s in states if st["states"][s]["done"])
        st["runs"].append({k: man[k] for k in ("started_utc", "requests", "saved_pages", "pending_after", "stopped")})
        write_json(os.path.join(out, "runs", stamp + ".json"), man)
        write_json(spath, st)
        print(f"backfill: {fetch.n} request(s), {man['saved_pages']} auction page(s) saved, "
              f"{len(man['archive_pages'])} archive page(s), {man['pending_after']} still to fetch, "
              f"states done {len(man['states_done'])}/{len(states)}; {man['stopped'] or 'all done'}")
        return code, man

    def queue_ids():
        q = set()
        for s in states:
            q |= set(st["states"][s]["ids"])
        return q

    def done_failed():
        return {i for i, n in st["failed"].items() if n >= MAX_TRIES}

    rp, pages_ok, robots_body, notes = read_robots(fetch)
    man["skipped"] += notes
    man["crawl_delay"] = fetch.crawl_delay
    if robots_body is not None:
        with open(os.path.join(out, "robots.txt"), "wb") as fh:
            fh.write(robots_body)
    if not pages_ok:
        return finish(1, "robots.txt said no or could not be read; nothing fetched")

    # 1. the archive, state by state; a state finished in an earlier run is not walked again
    for s in states:
        ss = st["states"][s]
        while not ss["done"]:
            why = budget()
            if why:
                return finish(0, why)
            per, off = ss["next"]
            u = archive_url(s, per or PER_PAGE, off)
            no = why_not(rp, u)
            if no:
                ss.update(done=True, stop=f"archive page not fetched ({no})")
                man["skipped"].append({"url": u, "why": no})
                break
            code, final, body, no = get_follow(fetch, rp, u)
            if no or code != 200 or not body or len(body) > MAX_BYTES:
                why = no or f"archive page status {code}"
                man["skipped"].append({"url": u, "why": why})
                ss["tries"] = ss.get("tries", 0) + 1
                if no or 400 <= code < 500 or ss["tries"] >= MAX_TRIES:
                    ss.update(done=True, stop=why)
                break  # a miss with no answer or a server error: the next run tries this page again
            body, nb = blank_buyer_links(body)
            man["buyer_links_blanked"] += nb
            name = f"archive/{s}/{off}.html"
            path = os.path.join(out, name)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "wb") as fh:
                fh.write(body)
            ids, pager, other = archive_links(body, final)
            if not ids and not (off and not pager):
                # a page with no auction link is a changed page shape, not an end: say so, keep the state
                # open for the next run and make the run fail
                man["empty_archive_pages"].append(name)
                man["skipped"].append({"url": u, "why": "archive page with 0 auction links"})
                print(f"backfill: FAIL {name} yielded 0 auction links; the page shape may have changed")
                break
            new = [i for i in ids if i not in ss["ids"]]
            ss["ids"] += new
            ss["pages"] += 1
            man["archive_pages"].append({"file": name, "url": u, "final_url": final, "status": code,
                                         "ids": len(ids), "new_ids": len(new), "pager": [list(x) for x in pager], "other_links": other})
            nxt = next_offset(off, ids, pager)
            if not new:
                ss.update(done=True, stop="a page with no new auction")
            elif nxt is None:
                ss.update(done=True, stop="last page")
            elif ss["pages"] >= MAX_ARCHIVE_PAGES:
                ss.update(done=True, stop=f"{MAX_ARCHIVE_PAGES} archive pages")
            else:
                ss["next"] = list(nxt)

    # 2. each auction page not captured before, oldest id first
    have = known_ids(out_root) | set(st["saved"])
    adir = os.path.join(out, "auctions")
    if os.path.isdir(adir):
        have |= {f[:-5] for f in os.listdir(adir) if ID_FILE.fullmatch(f)}
    skip = have | done_failed()
    man["already_captured"] = len(queue_ids() & have)
    for i in sorted(queue_ids() - skip, key=id_order):
        why = budget()
        if why:
            return finish(0, why)
        u = f"{BASE}/auctions/{i}"
        no = why_not(rp, u)
        if no:
            st["failed"][i] = MAX_TRIES
            man["skipped"].append({"url": u, "why": no})
            continue
        code, final, page, no = get_follow(fetch, rp, u)
        if no or code != 200 or not page or len(page) > MAX_BYTES:
            st["failed"][i] = st["failed"].get(i, 0) + 1
            man["skipped"].append({"url": u, "why": no or f"status {code}, {len(page)} bytes; not saved"})
            continue
        page, nb = blank_buyer_links(page)
        man["buyer_links_blanked"] += nb
        name = f"auctions/{i}.html"
        os.makedirs(adir, exist_ok=True)
        with open(os.path.join(out, name), "wb") as fh:
            fh.write(page)
        st["saved"].append(i)
        st["failed"].pop(i, None)
        man["files"].append({"file": name, "url": u, "final_url": final, "status": code, "bytes": len(page),
                             "buyer_links_blanked": nb,
                             "buyer_text_markers": len(MARKERS.findall(page.decode("latin-1")))})
        if len(man["files"]) % 25 == 0:
            write_json(spath, st)  # a run cut off mid-way still keeps its place on disk
    if not man["archive_pages"] and not any(st["states"][s]["pages"] for s in states):
        return finish(1, "no archive page answered")
    return finish(0, "")


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

    backfill_selftest(check)
    print(f"capture_schrader selftest: {len(fails)} failure(s)")
    return 1 if fails else 0


def _archive_page(ids, pager_hrefs=(), extra=""):
    rows = "".join(f'<tr><td><a href="/auctions/{i}">Auction {i}</a></td><td>SOLD</td></tr>' for i in ids)
    pager = "".join(f'<a href="{h}">page</a>' for h in pager_hrefs)
    return (f"<html><body><table>{rows}</table><div class=pager>{pager}</div>{extra}"
            f'<a href="/buyers/profile/5">A Buyer</a></body></html>').encode()


def backfill_selftest(check):
    """Offline: a made-up archive for three states, two runs (cap, then resume), robots, /buyers/, budgets."""
    import shutil
    import tempfile
    oh = [str(3001 + n) for n in range(45)]
    ia = [str(4001 + n) for n in range(20)]
    site = {
        archive_url("OH"): _archive_page(oh[:20], ["recent_auctions/20/20?state=OH", "/auctions/recent_auctions/20/40?state=OH"]),
        archive_url("OH", 20, 20): _archive_page(oh[20:40], ["/auctions/recent_auctions/20/0?state=OH", "40?state=OH"]),
        archive_url("OH", 20, 40): _archive_page(oh[40:] + ["3001"], ["/auctions/recent_auctions/20/0?state=OH",
                                                                    "/auctions/recent_auctions/20/20?state=OH"],
                                                 '<a href="/auctions/recent_auctions?state=OH&amp;sort=date">sort</a>'),
        archive_url("IA"): _archive_page(ia),          # no pager: a full page is followed by offset + 20
        archive_url("IA", 20, 20): _archive_page(ia),  # the same rows again: the walk stops there
    }
    robots = b"User-agent: *\nDisallow: /buyers/profile/\nDisallow: /auctions/3005\n"
    calls, sleeps = [], []
    flaky = {"archive": 0}

    def get(url):
        calls.append(url)
        if url == ROBOTS:
            return 200, "", robots
        if url in site:
            return 200, "", site[url]
        if url == archive_url("GA"):
            return 404, "", b""
        if url == archive_url("MS"):
            flaky["archive"] += 1
            return (503, "", b"") if flaky["archive"] == 1 else (200, "", _archive_page(["5001"]))
        if url.endswith("/auctions/3010"):
            return 500, "", b""
        m = re.search(r"/auctions/(\d+)$", url)
        if m:
            return 200, "", PAGE.replace(b"Auction 1001", b"Auction " + m.group(1).encode())
        return 404, "", b""

    tmp = tempfile.mkdtemp(prefix="schrader-bf-")
    try:
        os.makedirs(os.path.join(tmp, OUT_BASE, "2026-11-07", "auctions"))
        open(os.path.join(tmp, OUT_BASE, "2026-11-07", "auctions", "3002.html"), "w").close()
        os.makedirs(os.path.dirname(os.path.join(tmp, SAVED_DATA)))
        with open(os.path.join(tmp, SAVED_DATA), "w", encoding="utf-8") as fh:
            json.dump({"records": [{"auction_id": "3003"}]}, fh)
        now = datetime(2026, 11, 9, 20, 0, tzinfo=timezone.utc)
        states = ("OH", "IA", "GA", "MS")

        ids, pager, other = archive_links(site[archive_url("OH")], archive_url("OH"))
        check(ids == oh[:20] and pager == [(20, 20), (20, 40)], "archive page: auction ids in order, relative pager links read")
        check(not any("buyers" in u for u in other), "archive page: no /buyers/ link taken")
        check(next_offset(0, ids, pager) == (20, 20) and next_offset(40, ids, [(20, 0), (20, 20)]) is None
              and next_offset(0, ia, []) == (20, 20) and next_offset(0, ["1"], []) is None,
              "next page: the pager's next offset; none past the last; a full page with no pager goes on by 20")

        code, man = backfill(tmp, get, sleeps.append, now, lambda: 0.0, states, max_requests=30)
        out = os.path.join(tmp, BACKFILL_BASE)
        st = json.load(open(os.path.join(out, "state.json"), encoding="utf-8"))
        check(code == 0 and calls[0] == ROBOTS and calls.count(ROBOTS) == 1, "backfill: robots.txt first, once")
        check(len(calls) == 30 and "request cap 30" in man["stopped"], f"backfill: stops at the request cap ({len(calls)} requests)")
        check(all(x == DELAY_S for x in sleeps) and len(sleeps) == len(calls) - 1, "backfill: 2 s before every request after the first")
        check(not any("/buyers/" in c.lower() for c in calls), "backfill: no request to a /buyers/ path")
        check(archive_url("OH", 20, 20) in calls and archive_url("OH", 20, 40) in calls and archive_url("OH", 20, 60) not in calls,
              "backfill: OH walked over its three pages, not past the last")
        check(st["states"]["OH"]["ids"] == oh and st["states"]["OH"]["stop"] == "last page", "backfill: 45 OH ids, stopped at the last page")
        check(st["states"]["IA"]["stop"] == "a page with no new auction" and len(st["states"]["IA"]["ids"]) == 20,
              "backfill: a page with no new id ends the walk")
        check(st["states"]["GA"]["done"] and "404" in st["states"]["GA"]["stop"], "backfill: a state with no archive page (404) is done")
        check(not st["states"]["MS"]["done"] and st["states"]["MS"]["tries"] == 1, "backfill: a server error leaves the state for the next run")
        check(f"{BASE}/auctions/3002" not in calls and f"{BASE}/auctions/3003" not in calls,
              "backfill: ids already captured (weekly pages, the data file) are skipped")
        check(f"{BASE}/auctions/3005" not in calls, "backfill: robots.txt Disallow obeyed for an auction page")
        first = [c for c in calls if re.search(r"/auctions/\d+$", c)]
        check(first == sorted(first, key=lambda u: int(u.rsplit("/", 1)[1])), "backfill: oldest id first")
        saved = sorted(os.listdir(os.path.join(out, "auctions")))
        with open(os.path.join(out, "auctions", saved[0]), "rb") as fh:
            check(b"Buyer Name" not in fh.read(), "backfill: saved pages carry no buyer link")
        with open(os.path.join(out, "archive", "OH", "0.html"), "rb") as fh:
            check(b"A Buyer" not in fh.read(), "backfill: archive pages saved raw with buyer links blanked")
        check(os.listdir(os.path.join(out, "runs")) == ["2026-11-09T200000Z.json"], "backfill: one run file per run")
        check(any(p["other_links"] for p in man["archive_pages"]), "backfill: a recent_auctions link of another shape is listed")

        # slug-keyed archive (Nov 8: the real archive links by slug, not number)
        real = open(os.path.join(ROOT, "test", "fixtures", "schrader-archive", "OH-0.html"), "rb").read()
        slugs, pg, _ = archive_links(real, archive_url("OH"))
        check(slugs == ["defiance-county-ohio-land-auction-124-acres-october-2026",
                        "williams-county-ohio-land-auction-39-acres-september-2026",
                        "williams-county-ohio-dekalb-county-indiana-land-auction-404-acres-september-2026"]
              and pg == [(20, 20), (20, 140)], "real OH archive page: three slugs in order, no menu or pager link taken as an auction")
        check(archive_links(b'<a href="/auctions/9580">x</a><a href="/auctions/all">y</a><a href="/auctions/past-auctions">z</a>')[0] == ["9580"],
              "archive links: a number is taken, a menu path or a slug with no digit is not")
        canon = open(os.path.join(ROOT, "test", "fixtures", "schrader", "9580.html"), "rb").read()
        check(canonical_slug(canon) == "knox-county-indiana-land-auction-331-acres-october-2026" and canonical_slug(b"<html></html>") == "",
              "a numeric page's canonical link gives its slug")
        sdir = tempfile.mkdtemp(prefix="schrader-slug-")
        try:
            os.makedirs(os.path.join(sdir, OUT_BASE, "2026-11-07", "auctions"))
            with open(os.path.join(sdir, OUT_BASE, "2026-11-07", "auctions", "9580.html"), "wb") as fh:
                fh.write(canon)
            check({"9580", "knox-county-indiana-land-auction-331-acres-october-2026"} <= known_ids(sdir),
                  "known ids: a captured numeric page also counts under its canonical slug")
            walked = []

            def sget(url):
                if url == ROBOTS:
                    return 200, "", b""
                if url == archive_url("OH"):
                    return 200, "", real
                if url == archive_url("IA"):
                    return 200, "", b"<html><body>changed shape</body></html>"
                if "recent_auctions" in url:
                    return 404, "", b""
                walked.append(url)
                return 200, "", canon
            code, man = backfill(sdir, sget, lambda x: None, now, lambda: 0.0, ("OH",), max_requests=20)
            files = sorted(os.listdir(os.path.join(sdir, BACKFILL_BASE, "auctions")))
            check(code == 0 and len(walked) == 3 and files == sorted(x + ".html" for x in slugs), "backfill by slug: each slug fetched and saved as <slug>.html")
            walked.clear()
            code, man = backfill(sdir, sget, lambda x: None, now, lambda: 0.0, ("OH",), max_requests=20)
            check(code == 0 and not walked, "backfill by slug: a second run fetches nothing twice")
            code, man = backfill(sdir, sget, lambda x: None, now, lambda: 0.0, ("IA",), max_requests=20)
            st2 = json.load(open(os.path.join(sdir, BACKFILL_BASE, "state.json"), encoding="utf-8"))
            check(code == 1 and man["empty_archive_pages"] == ["archive/IA/0.html"] and not st2["states"]["IA"]["done"],
                  "an archive page with 0 items fails the run loudly and the state stays open")
        finally:
            shutil.rmtree(sdir, ignore_errors=True)

        calls.clear(); sleeps.clear()
        code, man2 = backfill(tmp, get, sleeps.append, datetime(2026, 11, 9, 23, 0, tzinfo=timezone.utc), lambda: 0.0, states)
        again = [c for c in calls if c in first and not c.endswith("/3010")]
        check(code == 0 and not again, "resume: no auction page fetched twice across runs")
        check(not any(c in site for c in calls), "resume: a state walked to its end is not walked again")
        check(archive_url("MS") in calls, "resume: the state left by a server error is tried again")
        st = json.load(open(os.path.join(out, "state.json"), encoding="utf-8"))
        want = sorted(set(oh + ia + ["5001"]) - {"3002", "3003", "3005", "3010"}, key=int)
        check(sorted(st["saved"], key=int) == want, f"resume: every id saved once over the two runs ({len(st['saved'])})")
        check(st["failed"].get("3010") == MAX_TRIES and man2["pending_after"] == 0 and man2["stopped"] == "",
              "resume: a page that failed twice is given up, nothing left")
        check(len(st["runs"]) == 2, "resume: both runs logged in state.json")
        calls.clear()
        code, man3 = backfill(tmp, get, lambda x: None, datetime(2026, 11, 10, 1, 0, tzinfo=timezone.utc), lambda: 0.0, states)
        check(code == 0 and calls == [ROBOTS], "a third run with nothing left asks for robots.txt only")

        shutil.rmtree(out)
        calls.clear()
        t = iter(range(0, 100000, 61))
        code, man = backfill(tmp, get, lambda x: None, now, lambda: float(next(t)), states, max_minutes=2)
        check(code == 0 and "time budget 2 min" in man["stopped"] and len(calls) <= 3, "backfill: stops at the time budget")
        shutil.rmtree(out)
        calls.clear()
        robots = b""
        code, man = backfill(tmp, lambda u: (calls.append(u), (500, "", b""))[1], lambda x: None, now, lambda: 0.0, states)
        check(code == 1 and calls == [ROBOTS], "backfill: robots.txt unreadable, nothing else fetched, exit 1")
        shutil.rmtree(out)
        calls.clear()
        code, _ = backfill(tmp, lambda u: (calls.append(u), (200, "", b"User-agent: *\nDisallow: /auctions/\n") if u == ROBOTS else (200, "", b""))[1],
                           lambda x: None, now, lambda: 0.0, states)
        check(calls == [ROBOTS] and code == 1, "backfill: robots.txt disallowing the archive stops the walk before any request")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main(argv):
    if "--selftest" in argv:
        return selftest()
    if "--backfill" in argv:
        return backfill()[0]
    code, _, _ = capture()
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
