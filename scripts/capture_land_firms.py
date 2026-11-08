#!/usr/bin/env python3
"""
AGSIST -- capture four land auction firms' published results pages, raw.

Phase 1 of the firm results readers (Sig, Nov 7 and 8, 2026): real pages before any
parser is written. Nothing here parses a price, writes a data/ file on main or
changes a page.

The firms (each one's own published results, no terms found against reading them;
facts only later, credit and link, taken down the same day on an objection):
  wieman      Wieman Land & Auction (SD)      land-auction-results.php, year pages ?year=YYYY
  younger     Younger Auction Company (MO)    land-auction-results.html (one page)
  horning     Horning Farm Agency (PA)        /auctions/past-auctions/, archive /page/N/
  martins     Martin's Auction Service (PA)   results highlights page and its RSS feed, archive /page/N/

What one run fetches, per firm, one firm after another, nothing in parallel
(User-Agent "AGSIST/1.0 (+https://agsist.com)"):
  1. robots.txt, first. A 404 means no rules. Any other miss (403, 5xx, no answer)
     means nothing else is fetched from that firm this run.
  2. The current results page (Martin's: the page and its feed).
  3. Only for the firms named in --archive-for: the archive pages. Wieman's year
     pages are the ?year= links on the current page (2013 to last year if the page
     names none); Horning's and Martin's are /page/2/ up to the last page the
     current page links, or, when it links none, one after another until a 404.
     When every archive page got a final answer (saved, 404/410, or robots says no),
     land/<firm>/archive-complete.json is written and the workflow stops asking for
     that firm's archive. Weekly runs then fetch only robots.txt and the current page.
  4. Wieman in January: last year's page too, so December results posted late land.

Manners: every rule in robots.txt is obeyed (all groups for our name, else all "*"
groups merged, "*" and "$" patterns, the longest match wins, Allow on a tie); the
wait between requests is the larger of 2 seconds and the firm's Crawl-delay, and over
30 seconds nothing past robots.txt is fetched. Redirects: one hop at most, only to the
same firm's host, only where robots.txt allows. Per firm at most 40 requests and
8 minutes a run, and three requests in a row with no answer end that firm's run.
A robots.txt Content-Signal line is copied into the manifest as it stands.

Where it goes: land/<firm>/capture/<YYYY-MM-DD>/ (UTC date) in the checkout:
  robots.txt, current.html (Martin's also feed.xml), archive/<year or page-N>.html,
  manifest.json (per file: url, status, bytes, time, and the case-blind count of
  "buyer", "purchaser" and "sold to"; per skip: url and why). Never a buyer field.
The workflow (.github/workflows/schrader-capture.yml, jobs firms-seen, firms and
firms-save) saves those folders to the private raw branch with scripts/push_raw.sh;
/land/<firm>/ is in .gitignore, so nothing reaches main.

Exit: 0 when at least one firm's current page was saved, 1 when none was.

  python3 scripts/capture_land_firms.py                          # current pages only
  python3 scripts/capture_land_firms.py --archive-for wieman,horning
  python3 scripts/capture_land_firms.py --selftest               # offline tests, made-up pages
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
from datetime import datetime, timezone
from urllib.parse import urljoin, urlsplit

UA = "AGSIST/1.0 (+https://agsist.com)"
UA_TOKEN = "agsist"
DELAY_S = 2.0
MAX_DELAY_S = 30.0
TIMEOUT_S = 30
MAX_BYTES = 5 * 1024 * 1024
MAX_REQUESTS = 40          # per firm per run, robots.txt and redirect hops included
MAX_SECONDS = 8 * 60       # per firm per run
MAX_MISSES = 3             # requests in a row with no answer end the firm's run
MAX_PAGES = 30             # archive pages per firm, whatever the current page links
WIEMAN_FIRST_YEAR = 2013   # the oldest year page the Nov 7 audit opened
MARKERS = re.compile(r"buyer|purchaser|sold to", re.I)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WARN = "::warning::"       # plain "warning: " during the selftest, so made-up misses raise no annotation

FIRMS = [
    {"slug": "wieman", "name": "Wieman Land & Auction", "state": "SD",
     "base": "https://www.wiemanauction.com", "hosts": ("www.wiemanauction.com", "wiemanauction.com"),
     "current": [("current.html", "/land-auction-results.php")], "archive": "years"},
    {"slug": "younger", "name": "Younger Auction Company", "state": "MO",
     "base": "https://www.youngerauction.com", "hosts": ("www.youngerauction.com", "youngerauction.com"),
     "current": [("current.html", "/land-auction-results.html")], "archive": None},
    {"slug": "horning", "name": "Horning Farm Agency", "state": "PA",
     "base": "https://www.horningfarmagency.com", "hosts": ("www.horningfarmagency.com", "horningfarmagency.com"),
     "current": [("current.html", "/auctions/past-auctions/")], "archive": "/auctions/past-auctions/page/{n}/"},
    {"slug": "martins", "name": "Martin's Auction Service", "state": "PA",
     "base": "https://martinsauctionservice.com", "hosts": ("martinsauctionservice.com", "www.martinsauctionservice.com"),
     "current": [("current.html", "/product-category/auction-results-highlights/"),
                 ("feed.xml", "/product-category/auction-results-highlights/feed/")],
     "archive": "/product-category/auction-results-highlights/page/{n}/"},
]
BY_SLUG = {f["slug"]: f for f in FIRMS}
ARCHIVE_FIRMS = [f["slug"] for f in FIRMS if f["archive"]]


# ---------------------------------------------------------------- robots.txt

def _rule_re(pattern):
    end = pattern.endswith("$")
    body = pattern[:-1] if end else pattern
    return re.compile("".join(".*" if c == "*" else re.escape(c) for c in body) + ("$" if end else ""))


class Robots:
    """robots.txt as Google reads it: the groups naming our token (merged), else every
    "*" group (merged; Python's robotparser keeps only the first). A rule matches from
    the start of path?query, "*" is any run, a final "$" anchors the end. The longest
    matching pattern wins and Allow wins a tie. Crawl-delay: the largest in the chosen
    groups. Content-Signal lines are kept as they stand."""

    def __init__(self, text=""):
        groups, cur, agent_run = [], None, False
        self.content_signal = []
        for raw in (text or "").splitlines():
            line = raw.split("#", 1)[0].strip()
            if ":" not in line:
                continue
            key, val = (s.strip() for s in line.split(":", 1))
            key = key.lower()
            if key == "user-agent":
                if cur is None or not agent_run:
                    cur = {"agents": [], "rules": [], "delay": None}
                    groups.append(cur)
                cur["agents"].append(val.lower())
                agent_run = True
                continue
            agent_run = False
            if key == "content-signal":
                self.content_signal.append(val)
            elif cur is None:
                continue
            elif key in ("allow", "disallow") and val:
                cur["rules"].append((key == "allow", val, _rule_re(val)))
            elif key == "crawl-delay":
                try:
                    d = float(val)
                except ValueError:
                    continue
                cur["delay"] = d if cur["delay"] is None else max(cur["delay"], d)
        mine = [g for g in groups if any(a.split("/")[0] == UA_TOKEN for a in g["agents"])]
        chosen = mine or [g for g in groups if "*" in g["agents"]]
        self.rules = [r for g in chosen for r in g["rules"]]
        delays = [g["delay"] for g in chosen if g["delay"] is not None]
        self.crawl_delay = max(delays) if delays else None

    def allows(self, url):
        p = urlsplit(url)
        target = (p.path or "/") + (("?" + p.query) if p.query else "")
        best = None  # (length, allow)
        for allow, pat, rx in self.rules:
            if rx.match(target):
                cand = (len(pat), allow)
                if best is None or cand[0] > best[0] or (cand[0] == best[0] and allow):
                    best = cand
        return True if best is None else best[1]


# ---------------------------------------------------------------- fetching

class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # the 3xx comes back as an HTTPError; the caller decides


_OPENER = urllib.request.build_opener(_NoRedirect)


def http_get(url):
    """One request, never following a redirect: (status, Location or "", body). Status 0: no answer."""
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    try:
        with _OPENER.open(req, timeout=TIMEOUT_S) as r:
            return r.status, "", r.read(MAX_BYTES + 1)
    except urllib.error.HTTPError as e:
        return e.code, (e.headers.get("Location") or "") if e.headers else "", b""
    except Exception as e:  # noqa: BLE001 - any network failure is a miss, recorded
        print(f"capture: {urlsplit(url).hostname}: {type(e).__name__}")
        return 0, "", b""


class Stop(Exception):
    """The firm's request, time or no-answer cap was reached."""


class Polite:
    """Every request after the first waits `delay` seconds, counted against the caps."""

    def __init__(self, get, sleep, clock):
        self.get, self.sleep, self.clock = get, sleep, clock
        self.delay, self.n, self.misses, self.t0 = DELAY_S, 0, 0, clock()

    def __call__(self, url):
        if self.n >= MAX_REQUESTS:
            raise Stop(f"the {MAX_REQUESTS} request cap")
        if self.clock() - self.t0 > MAX_SECONDS:
            raise Stop(f"the {MAX_SECONDS // 60} minute cap")
        if self.misses >= MAX_MISSES:
            raise Stop(f"{MAX_MISSES} requests in a row with no answer")
        if self.n:
            self.sleep(self.delay)
        self.n += 1
        st, loc, body = self.get(url)
        self.misses = self.misses + 1 if st == 0 else 0
        return st, loc, body


def on_host(firm, url):
    p = urlsplit(url)
    return p.scheme in ("http", "https") and (p.hostname or "").lower() in firm["hosts"]


# ---------------------------------------------------------------- archive plans

def wieman_years(body, this_year):
    """Year pages the current page links (?year=YYYY), oldest first, this year left out."""
    text = body.decode("latin-1")
    ys = sorted({int(y) for y in re.findall(r"""href\s*=\s*["']?[^"'\s>]*[?&]year=(\d{4})\b""", text, re.I)})
    return [y for y in ys if WIEMAN_FIRST_YEAR - 10 <= y < this_year]


def last_page(body, pattern):
    """The highest /page/N/ the current page links for this archive, or None."""
    stem = re.escape(pattern.split("{n}")[0])
    ns = [int(n) for n in re.findall(stem + r"(\d{1,4})", body.decode("latin-1"))]
    return max(ns) if ns else None


def archive_plan(firm, body, now):
    """(urls as (file, url), walk) where walk means: keep going until a 404, up to MAX_PAGES."""
    base, kind = firm["base"], firm["archive"]
    if kind == "years":
        years = wieman_years(body, now.year)
        how = "linked"
        if not years:
            years, how = list(range(WIEMAN_FIRST_YEAR, now.year)), "built from the known ?year= pattern"
        return [(f"archive/{y}.html", f"{base}/land-auction-results.php?year={y}") for y in years], False, how
    top = last_page(body, kind)
    if top and top >= 2:
        top = min(top, MAX_PAGES + 1)
        return [(f"archive/page-{n}.html", base + kind.format(n=n)) for n in range(2, top + 1)], False, "linked"
    return [(f"archive/page-{n}.html", base + kind.format(n=n)) for n in range(2, MAX_PAGES + 2)], True, "walked to the first 404"


# ---------------------------------------------------------------- one firm

def capture_firm(firm, out_root, now, get, sleep, clock, archive=False):
    day = now.strftime("%Y-%m-%d")
    rel = os.path.join("land", firm["slug"], "capture", day)
    out = os.path.join(out_root, rel)
    os.makedirs(out, exist_ok=True)
    fetch = Polite(get, sleep, clock)
    man = {"source": firm["name"], "state": firm["state"], "results": firm["base"] + firm["current"][0][1],
           "user_agent": UA, "captured_utc": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "delay_s": DELAY_S,
           "crawl_delay": None, "content_signal": [], "archive": "not this run", "files": [], "skipped": [],
           "requests": 0}
    robots = Robots("")

    def skip(url, why):
        man["skipped"].append({"url": url, "why": why})

    def save(name, url, status, body, **extra):
        path = os.path.join(out, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as fh:
            fh.write(body)
        man["files"].append({"file": name, "url": url, "status": status, "bytes": len(body),
                             "fetched_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), **extra})

    def why_not(u, check_robots=True):
        if not on_host(firm, u):
            return "not on the firm's own site"
        if check_robots and not robots.allows(u):
            return "robots.txt disallows"
        return ""

    def get_one(u, check_robots=True):
        """(status, final url, body, why): one redirect hop, only where why_not() is empty."""
        st, loc, body = fetch(u)
        if 300 <= st < 400:
            if not loc:
                return st, u, b"", f"redirect {st} with no Location; not followed"
            nxt = urljoin(u, loc)
            why = why_not(nxt, check_robots)
            if why:
                return st, nxt, b"", f"redirect to {nxt} not followed ({why})"
            st, loc, body = fetch(nxt)
            if 300 <= st < 400:
                return st, nxt, b"", "a second redirect; not followed"
            return st, nxt, body, ""
        return st, u, body, ""

    def page(name, url):
        """Fetch and save one page. Returns (status, body, final) with status None when not asked."""
        why = why_not(url)
        if why:
            skip(url, why)
            return None, b"", url
        st, final, body, why = get_one(url)
        if why:
            skip(url, why)
            return st, b"", final
        if st != 200 or not body or len(body) > MAX_BYTES:
            skip(url, f"status {st}, {len(body)} bytes; not saved")
            return st, b"", final
        extra = {"buyer_text_markers": len(MARKERS.findall(body.decode("latin-1")))}
        if final != url:
            extra["final_url"] = final
        save(name, url, st, body, **extra)
        return st, body, final

    def finish():
        man["requests"] = fetch.n
        write_json(os.path.join(out, "manifest.json"), man)
        return rel, man

    robots_url = firm["base"] + "/robots.txt"
    try:
        st, _, body, why = get_one(robots_url, check_robots=False)
        if st == 200 and not why and len(body) <= MAX_BYTES:
            save("robots.txt", robots_url, st, body)
            robots = Robots(body.decode("utf-8", "replace"))
        elif st in (404, 410) and not why:
            robots = Robots("")
        else:
            skip(robots_url, f"robots.txt unreadable (status {st}{'; ' + why if why else ''}); nothing else fetched")
            return finish()
        man["crawl_delay"], man["content_signal"] = robots.crawl_delay, robots.content_signal
        fetch.delay = max(DELAY_S, robots.crawl_delay or 0.0)
        man["delay_s"] = fetch.delay
        if fetch.delay > MAX_DELAY_S:
            skip(robots_url, f"Crawl-delay {robots.crawl_delay:g} s is over {MAX_DELAY_S:g} s; nothing else fetched")
            return finish()

        first_body = b""
        for i, (name, path) in enumerate(firm["current"]):
            _, body, _ = page(name, firm["base"] + path)
            if i == 0:
                first_body = body
        if firm["slug"] == "wieman" and now.month == 1:
            y = now.year - 1
            page(f"archive/{y}.html", f"{firm['base']}/land-auction-results.php?year={y}")

        if archive and firm["archive"]:
            if not first_body:
                man["archive"] = "not fetched: the current page was not saved"
                return finish()
            plan, walk, how = archive_plan(firm, first_body, now)
            man["archive_plan"] = {"pages": len(plan), "how": how}
            final = True
            for name, url in plan:
                if os.path.exists(os.path.join(out, name)):
                    continue  # January's last-year page, already saved above
                st, body, _ = page(name, url)
                if st is None:  # robots.txt or the host said no: a final answer
                    continue
                if st in (404, 410):
                    if walk:
                        break
                    continue
                if st != 200 or not body:
                    final = False
            else:
                if walk:
                    final = False  # MAX_PAGES pages and still no 404: not the end, not complete
            man["archive"] = "complete" if final else "partial"
            if final:
                write_json(os.path.join(out_root, "land", firm["slug"], "archive-complete.json"),
                           {"source": firm["name"], "captured": day, "pages": len(plan), "how": how})
    except Stop as e:
        skip("", f"stopped at {e}")
        if archive and firm["archive"] and man["archive"] in ("not this run", "complete"):
            man["archive"] = "partial"
    return finish()


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, indent=1, sort_keys=True)
        fh.write("\n")


def capture(archive_for=(), out_root=ROOT, get=http_get, sleep=time.sleep, clock=time.monotonic, now=None):
    now = now or datetime.now(timezone.utc)
    ok, report = 0, {}
    for firm in FIRMS:
        rel, man = capture_firm(firm, out_root, now, get, sleep, clock, archive=firm["slug"] in archive_for)
        saved = any(f["file"] == firm["current"][0][0] for f in man["files"])
        ok += saved
        report[firm["slug"]] = man
        print(f"capture: {firm['slug']}: {len(man['files'])} file(s), {len(man['skipped'])} skipped, "
              f"{man['requests']} request(s), archive {man['archive']}")
        if not saved:
            print(f"{WARN}land firms capture: {firm['name']}: current results page not saved (see its manifest)")
    return (0 if ok else 1), report


def parse_archive_for(argv):
    if "--archive-for" not in argv:
        return []
    i = argv.index("--archive-for")
    raw = argv[i + 1] if i + 1 < len(argv) and not argv[i + 1].startswith("--") else ""
    want = [s.strip() for s in raw.split(",") if s.strip()]
    for s in want:
        if s not in ARCHIVE_FIRMS:
            print(f"{WARN}land firms capture: no archive for '{s}'; ignored")
    return [s for s in want if s in ARCHIVE_FIRMS]


# ---------------------------------------------------------------- selftest

def selftest():
    global WARN
    WARN = "warning: "
    import shutil
    import tempfile
    fails = []

    def check(ok, what):
        print(("ok   " if ok else "FAIL ") + what)
        if not ok:
            fails.append(what)

    # robots.txt reading
    r = Robots("User-agent: *\nContent-Signal: search=yes,ai-train=no,use=reference\nAllow: /\n"
               "User-agent: GPTBot\nDisallow: /\nUser-agent: *\nDisallow: */page/\n")
    check(not r.allows("https://h/blog/page/2/") and r.allows("https://h/sales/"),
          "every '*' group counts (a second '*' group's */page/ is obeyed)")
    check(r.content_signal == ["search=yes,ai-train=no,use=reference"], "Content-Signal kept as it stands")
    r = Robots("User-agent: *\nDisallow: /*?add-to-cart=\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\nCrawl-delay: 10\n"
               "User-agent: *\nDisallow: /x\nCrawl-delay: 7\n")
    check(not r.allows("https://h/shop/?add-to-cart=5") and r.allows("https://h/shop/"), "'*' inside a pattern")
    check(r.allows("https://h/wp-admin/admin-ajax.php") and not r.allows("https://h/wp-admin/x"), "the longer Allow wins")
    check(r.crawl_delay == 10.0, "Crawl-delay: the largest of the chosen groups")
    r = Robots("User-agent: AGSIST\nDisallow: /a\nUser-agent: *\nDisallow: /\n")
    check(r.allows("https://h/b") and not r.allows("https://h/a"), "a group naming us replaces the '*' groups")
    r = Robots("User-agent: *\nDisallow: /end$\nAllow: /p\nDisallow: /p\n")
    check(not r.allows("https://h/end") and r.allows("https://h/end/more") and r.allows("https://h/p"),
          "'$' anchors the end; Allow wins a tie")
    check(Robots("").allows("https://h/anything") and Robots("User-agent: *\nDisallow:\n").allows("https://h/x"),
          "no rules, or an empty Disallow, allow everything")

    # archive plans
    w = BY_SLUG["wieman"]
    body = (b"<a href='land-auction-results.php?year=2014'>2014</a><a href=\"/land-auction-results.php?year=2013\">"
            b"2013</a><a href='?year=2026'>2026</a><a href='?year=2014'>again</a>")
    now = datetime(2026, 11, 9, 19, 43, tzinfo=timezone.utc)
    plan, walk, how = archive_plan(w, body, now)
    check([u for _, u in plan] == [f"{w['base']}/land-auction-results.php?year={y}" for y in (2013, 2014)] and not walk,
          "Wieman: the year pages the current page links, oldest first, this year left out")
    plan, walk, how = archive_plan(w, b"<p>no links</p>", now)
    check(len(plan) == 2026 - WIEMAN_FIRST_YEAR and plan[0][1].endswith("?year=2013") and "pattern" in how,
          "Wieman: no year links, so 2013 to last year from the known pattern, said so")
    h = BY_SLUG["horning"]
    plan, walk, _ = archive_plan(h, b"<a href='https://www.horningfarmagency.com/auctions/past-auctions/page/2/'>2</a>"
                                    b"<a href='/auctions/past-auctions/page/22/'>22</a>", now)
    check(len(plan) == 21 and plan[-1][0] == "archive/page-22.html" and not walk, "Horning: page 2 to the last linked page")
    plan, walk, _ = archive_plan(h, b"<p>none</p>", now)
    check(walk and len(plan) == MAX_PAGES, "no page links: walk until a 404, capped")
    plan, _, _ = archive_plan(h, b"/auctions/past-auctions/page/999/", now)
    check(len(plan) == MAX_PAGES, f"a silly last page is capped at {MAX_PAGES} archive pages")

    # whole runs against made-up sites
    sites = {
        "https://www.wiemanauction.com/robots.txt": (404, "", b""),
        "https://www.wiemanauction.com/land-auction-results.php":
            (200, "", b"<h2>2026 Results</h2><p>Tract 1 160 acres $7,150/acre</p>"
                      b"<a href='?year=2024'>2024</a><a href='?year=2025'>2025</a>"),
        "https://www.youngerauction.com/robots.txt":
            (200, "", b"User-agent: NerdyBot\nDisallow: /\nUser-agent: *\nDisallow: /ajax/\n"),
        "https://www.youngerauction.com/land-auction-results.html": (200, "", b"<p>68 acres $8,500 per acre. Buyer: x</p>"),
        "https://www.horningfarmagency.com/robots.txt": (200, "", b"User-agent: *\nCrawl-delay: 5\nDisallow: /wp-admin/\n"),
        "https://www.horningfarmagency.com/auctions/past-auctions/":
            (200, "", b"<a href='/auctions/past-auctions/page/2/'>2</a><a href='/auctions/past-auctions/page/3/'>3</a>"),
        "https://www.horningfarmagency.com/auctions/past-auctions/page/2/": (200, "", b"<p>page 2</p>"),
        "https://www.horningfarmagency.com/auctions/past-auctions/page/3/": (301, "/auctions/past-auctions/page/3/x/", b""),
        "https://www.horningfarmagency.com/auctions/past-auctions/page/3/x/": (200, "", b"<p>page 3</p>"),
        "https://martinsauctionservice.com/robots.txt":
            (200, "", b"User-agent: *\nDisallow: /*?add-to-cart=\nCrawl-delay: 10\n"),
        "https://martinsauctionservice.com/product-category/auction-results-highlights/": (200, "", b"<p>sold</p>"),
        "https://martinsauctionservice.com/product-category/auction-results-highlights/feed/":
            (200, "", b"<?xml version='1.0'?><rss><channel><item><title>49 acres</title></item></channel></rss>"),
        "https://martinsauctionservice.com/product-category/auction-results-highlights/page/2/": (200, "", b"<p>p2</p>"),
        "https://martinsauctionservice.com/product-category/auction-results-highlights/page/3/": (404, "", b""),
    }

    def fake(table, calls):
        def get(url):
            calls.append(url)
            return table.get(url, (500, "", b""))
        return get

    tmp = tempfile.mkdtemp(prefix="landfirms-")
    try:
        calls, sleeps = [], []
        code, rep = capture((), tmp, fake(sites, calls), sleeps.append, lambda: 0.0, now)
        check(code == 0, "weekly run: exit 0 when some firm's current page was saved")
        week = [c for c in calls if not c.endswith("/robots.txt")]
        check(len([c for c in calls if c.endswith("/robots.txt")]) == len(FIRMS) and calls[0].endswith("wiemanauction.com/robots.txt"),
              "robots.txt first, once per firm")
        check(week == ["https://www.wiemanauction.com/land-auction-results.php",
                       "https://www.youngerauction.com/land-auction-results.html",
                       "https://www.horningfarmagency.com/auctions/past-auctions/",
                       "https://martinsauctionservice.com/product-category/auction-results-highlights/",
                       "https://martinsauctionservice.com/product-category/auction-results-highlights/feed/"],
              f"weekly run: the current pages only, no archive ({len(calls)} requests)")
        check(len(calls) == 9, "weekly run: 9 requests for the four firms")
        check(sorted(set(sleeps)) == [2.0, 5.0, 10.0], f"waits: 2 s, or the firm's Crawl-delay (5, 10) ({sorted(set(sleeps))})")
        check(rep["martins"]["delay_s"] == 10.0 and rep["horning"]["crawl_delay"] == 5.0, "Crawl-delay recorded")
        out = os.path.join(tmp, "land", "younger", "capture", "2026-11-09")
        with open(os.path.join(out, "current.html"), "rb") as fh:
            check(fh.read() == sites["https://www.youngerauction.com/land-auction-results.html"][2], "a page is saved byte for byte")
        with open(os.path.join(out, "manifest.json"), encoding="utf-8") as fh:
            m = json.load(fh)
        check(m["files"][1]["buyer_text_markers"] == 1 and m["archive"] == "not this run", "manifest: markers counted, no archive")
        keys = {"file", "url", "status", "bytes", "fetched_utc", "final_url", "buyer_text_markers"}
        check(all(set(f) <= keys for f in m["files"]), "manifest rows hold file facts and counts only")
        check(not os.path.exists(os.path.join(tmp, "land", "wieman", "archive-complete.json")), "no archive marker on a weekly run")

        shutil.rmtree(os.path.join(tmp, "land"))
        calls.clear(); sleeps.clear()
        code, rep = capture(("wieman", "horning", "martins"), tmp, fake(sites, calls), sleeps.append, lambda: 0.0, now)
        check("https://www.wiemanauction.com/land-auction-results.php?year=2024" in calls
              and "https://www.wiemanauction.com/land-auction-results.php?year=2025" in calls, "first run: Wieman's linked year pages")
        check(rep["wieman"]["archive"] == "partial", "Wieman: year pages that fail (500) leave the archive partial")
        check(not os.path.exists(os.path.join(tmp, "land", "wieman", "archive-complete.json")), "so no marker: next week asks again")
        check(rep["horning"]["archive"] == "complete"
              and os.path.exists(os.path.join(tmp, "land", "horning", "capture", "2026-11-09", "archive", "page-3.html")),
              "Horning: pages 2 and 3 (one same-site redirect followed), archive complete")
        check(os.path.exists(os.path.join(tmp, "land", "horning", "archive-complete.json")), "Horning: marker written")
        mh = rep["horning"]["files"]
        check([f.get("final_url") for f in mh if f["file"] == "archive/page-3.html"]
              == ["https://www.horningfarmagency.com/auctions/past-auctions/page/3/x/"], "a followed redirect records its final URL")
        m3 = [c for c in calls if "auction-results-highlights/page/" in c]
        check(m3 == ["https://martinsauctionservice.com/product-category/auction-results-highlights/page/2/",
                     "https://martinsauctionservice.com/product-category/auction-results-highlights/page/3/"]
              and rep["martins"]["archive"] == "complete", "Martin's: no page links, walked to the first 404, complete")
        check(rep["younger"]["archive"] == "not this run", "a firm with no archive never fetches one")
        print(f"     first run against the made-up sites: {len(calls)} requests")

        # robots says no, redirects off site, caps
        shutil.rmtree(os.path.join(tmp, "land"))
        t2 = dict(sites)
        t2["https://www.horningfarmagency.com/robots.txt"] = (200, "", b"User-agent: *\nDisallow: /auctions/past-auctions/page/\n")
        t2["https://martinsauctionservice.com/product-category/auction-results-highlights/"] = (302, "https://example.com/x", b"")
        t2["https://www.youngerauction.com/robots.txt"] = (200, "", b"User-agent: *\nCrawl-delay: 60\n")
        t2["https://www.wiemanauction.com/robots.txt"] = (403, "", b"")
        calls.clear()
        code, rep = capture(("horning", "martins"), tmp, fake(t2, calls), lambda x: None, lambda: 0.0, now)
        check(not any("/past-auctions/page/" in c for c in calls) and rep["horning"]["archive"] == "complete",
              "robots.txt disallows the archive: never requested (a final answer)")
        check("https://example.com/x" not in calls and rep["martins"]["archive"].startswith("not fetched"),
              "an off-site redirect is not followed; no archive without the current page")
        check(not any("youngerauction.com/land" in c for c in calls) and any("Crawl-delay 60" in s["why"] for s in rep["younger"]["skipped"]),
              "Crawl-delay over 30 s: nothing past robots.txt")
        check(calls.count("https://www.wiemanauction.com/robots.txt") == 1 and not any("wiemanauction.com/land" in c for c in calls)
              and any("robots.txt unreadable" in s["why"] for s in rep["wieman"]["skipped"]),
              "robots.txt refused (403): nothing else fetched from that firm, reason recorded")

        shutil.rmtree(os.path.join(tmp, "land"))
        calls.clear()
        code, rep = capture(("horning",), tmp, fake({"https://www.horningfarmagency.com/robots.txt": (404, "", b""),
                                                     "https://www.horningfarmagency.com/auctions/past-auctions/": (200, "", b"x")},
                                                    calls), lambda x: None, lambda: 0.0, now)
        hc = [c for c in calls if "horning" in c]
        check(len(hc) == 2 + MAX_PAGES and rep["horning"]["archive"] == "partial",
              "walk with every page failing (500): capped, archive partial")
        calls.clear()
        code, rep = capture(("horning",), tmp, lambda u: (calls.append(u), (0, "", b""))[1], lambda x: None, lambda: 0.0, now)
        check(code == 1 and len(calls) == len(FIRMS), "no firm answers: exit 1, one request each (robots.txt unreadable)")
        t = iter(range(0, 10 ** 6, 100))
        calls.clear()
        code, rep = capture(("horning",), tmp, fake({"https://www.horningfarmagency.com/robots.txt": (404, "", b""),
                                                     "https://www.horningfarmagency.com/auctions/past-auctions/": (200, "", b"x")},
                                                    calls), lambda x: None, lambda: next(t), now)
        check(len([c for c in calls if "horning" in c]) < 10 and any("minute cap" in s["why"] for s in rep["horning"]["skipped"]),
              "the per-firm time cap stops a slow run and says so")
        check(all(r["requests"] <= MAX_REQUESTS for r in rep.values()), f"never over {MAX_REQUESTS} requests a firm")

        jan = datetime(2027, 1, 4, 19, 43, tzinfo=timezone.utc)
        calls.clear()
        capture((), tmp, fake(sites, calls), lambda x: None, lambda: 0.0, jan)
        check("https://www.wiemanauction.com/land-auction-results.php?year=2026" in calls, "January: Wieman's last-year page too")

        check(parse_archive_for(["--archive-for", "wieman,younger,horning"]) == ["wieman", "horning"]
              and parse_archive_for(["--archive-for", ""]) == [] and parse_archive_for([]) == [],
              "--archive-for keeps only firms that have an archive")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print(f"capture_land_firms selftest: {len(fails)} failure(s)")
    return 1 if fails else 0


def main(argv):
    if "--selftest" in argv:
        return selftest()
    code, _ = capture(parse_archive_for(argv))
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
