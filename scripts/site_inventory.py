#!/usr/bin/env python3
"""
site_inventory.py - offline inventory of every published HTML page.

Writes data/site-inventory.json for the site consolidation audit. Nothing is
fetched; everything comes from the repo and its git history.

  pages   every page that is not part of a generated set, one row each
  sets    generated page sets (one file per state, county, town, date...),
          summarized by folder pattern with counts
  summary site-wide counts: redirect stubs, orphans, pages outside nav and
          sitemap, duplicate titles

Per page: title, H1, meta description, word count of the main content,
internal inbound links (distinct published pages with an <a href> to it;
"inboundContextual" counts only links outside <nav>/<header>/<footer>),
which data/*.json files it or its local scripts name, redirect stub (meta
refresh, or a JS redirect on a near-empty page), canonical pointing elsewhere,
noindex, in a sitemap, in the header or footer nav, last git commit touching
the file.

Limits, stated so nobody reads more into the numbers than is there:
  * Links built by JavaScript at run time are not seen; only <a href> in the
    HTML is counted. Nav links come from components/header.html and
    footer.html (and their -fallback copies), which loader.js injects.
  * Data files are what the page and the local scripts it loads name in
    their source (fetch paths, data-src). A path built from pieces shows as
    a pattern with "*". Scripts loaded by other scripts are not followed.
  * In a shallow clone, a file not touched within the fetched history shows
    the oldest fetched commit date and "lastCommitShallow": true (meaning
    "on or before").

    python3 scripts/site_inventory.py             # write data/site-inventory.json
    python3 scripts/site_inventory.py --selftest  # offline unit checks
"""
import html
import json
import os
import re
import subprocess
import sys
import urllib.parse
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "data" / "site-inventory.json"
SKIP_DIRS = {".git", ".github", "node_modules", "__pycache__", ".claude"}
FRAGMENT_DIRS = {"components"}          # HTML fragments injected into pages, not pages
NAV_FILES = {"header": ["components/header.html", "components/header-fallback.html"],
             "footer": ["components/footer.html", "components/footer-fallback.html"]}
HOSTS = {"agsist.com", "www.agsist.com"}

STATES = set("""alabama alaska arizona arkansas california colorado connecticut delaware
florida georgia hawaii idaho illinois indiana iowa kansas kentucky louisiana maine maryland
massachusetts michigan minnesota mississippi missouri montana nebraska nevada new-hampshire
new-jersey new-mexico new-york north-carolina north-dakota ohio oklahoma oregon pennsylvania
rhode-island south-carolina south-dakota tennessee texas utah vermont virginia washington
west-virginia wisconsin wyoming district-of-columbia""".split())
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


# ------------------------------------------------------------------ paths
def norm_path(p):
    """URL or path -> normalized site path (same rule as site_usage_report)."""
    p = (p or "").strip()
    if "://" in p:
        p = urllib.parse.urlsplit(p).path
    p = p.split("#", 1)[0].split("?", 1)[0]
    if not p.startswith("/"):
        p = "/" + p
    p = re.sub(r"/{2,}", "/", p)
    if p.endswith(".html"):
        p = p[:-5]
    p = p.rstrip("/")
    if p == "/index" or p.endswith("/index"):
        p = p[: -len("index")].rstrip("/")
    return p or "/"


def file_to_path(rel):
    return norm_path("/" + rel)


def resolve_href(href, page_rel):
    """href on page -> normalized internal path, or None if external/non-page."""
    href = html.unescape((href or "").strip())
    if not href or href.startswith(("#", "mailto:", "tel:", "javascript:", "data:", "sms:")):
        return None
    if href.startswith("//"):
        href = "https:" + href
    if "://" in href:
        u = urllib.parse.urlsplit(href)
        if u.hostname not in HOSTS:
            return None
        href = u.path or "/"
    base = "https://agsist.com/" + page_rel
    path = urllib.parse.urlsplit(urllib.parse.urljoin(base, href)).path
    ext = os.path.splitext(path)[1].lower()
    if ext and ext != ".html":
        return None               # .json, .xml, .pdf, images: not a page link
    return norm_path(path)


def published_html(root):
    pages, fragments = [], []
    for dp, dns, fns in os.walk(root):
        dns[:] = sorted(d for d in dns if d not in SKIP_DIRS and not d.startswith("."))
        for fn in sorted(fns):
            if fn.endswith(".html"):
                rel = os.path.relpath(os.path.join(dp, fn), root).replace(os.sep, "/")
                (fragments if rel.split("/")[0] in FRAGMENT_DIRS else pages).append(rel)
    return pages, fragments


# ------------------------------------------------------------------ parse
RX = {k: re.compile(v, re.I | re.S) for k, v in {
    "title": r"<title[^>]*>(.*?)</title>",
    "h1": r"<h1\b[^>]*>(.*?)</h1>",
    "meta": r"<meta\b[^>]*>",
    "link": r"<link\b[^>]*>",
    "a": r"<a\b[^>]*?\bhref\s*=\s*(?:\"([^\"]*)\"|'([^']*)')",
    "script_src": r"<script\b[^>]*?\bsrc\s*=\s*[\"']([^\"']+)[\"']",
    "main": r"<main\b[^>]*>(.*)</main>",
    "body": r"<body\b[^>]*>(.*)</body>",
    "strip_blocks": r"<(script|style|noscript|svg|template|nav|header|footer)\b.*?</\1\s*>",
    "chrome_blocks": r"<(nav|header|footer)\b.*?</\1\s*>",
    "comment": r"<!--.*?-->",
    "tag": r"<[^>]+>",
    "js_redirect": r"(?:window\.|document\.)?location(?:\.href)?\s*(?:=|\.replace\(|\.assign\()\s*[\"']([^\"']+)",
}.items()}
DATA_RXS = [
    re.compile(r"""\bdata/((?:[\w\-./]|\$\{[^}`]*\})+?)\.json"""),      # literal or template
    re.compile(r"""\bdata/([\w\-./]*)["'`]\s*\+"""),                 # '/data/x/' + id + '.json'
]


def attr(tag, name):
    m = re.search(r"\b%s\s*=\s*(?:\"([^\"]*)\"|'([^']*)'|([^\s>]+))" % re.escape(name), tag, re.I)
    if not m:
        return None
    return html.unescape(next(g for g in m.groups() if g is not None))


def text_of(fragment):
    t = RX["comment"].sub(" ", fragment or "")
    t = RX["tag"].sub(" ", t)
    return re.sub(r"\s+", " ", html.unescape(t)).strip()


def data_refs(src):
    out = set()
    for m in DATA_RXS[0].finditer(src):
        out.add("data/" + re.sub(r"\$\{[^}]*\}", "*", m.group(1)) + ".json")
    for m in DATA_RXS[1].finditer(src):
        out.add("data/" + m.group(1) + "*")
    return out


def parse_page(src, rel):
    r = {}
    m = RX["title"].search(src)
    r["title"] = text_of(m.group(1)) if m else None
    m = RX["h1"].search(src)
    r["h1"] = text_of(m.group(1)) if m else None
    desc = robots = refresh = None
    for tag in RX["meta"].findall(src):
        name = (attr(tag, "name") or attr(tag, "property") or "").lower()
        if name == "description" and desc is None:
            desc = attr(tag, "content")
        elif name in ("robots", "googlebot") and robots is None:
            robots = attr(tag, "content")
        if (attr(tag, "http-equiv") or "").lower() == "refresh":
            refresh = attr(tag, "content")
    r["description"] = desc.strip() if desc else None
    r["noindex"] = bool(robots and "noindex" in robots.lower())
    canon = None
    for tag in RX["link"].findall(src):
        if "canonical" in (attr(tag, "rel") or "").lower():
            canon = attr(tag, "href")
            break
    own = file_to_path(rel)
    canon_path = None
    if canon:
        u = urllib.parse.urlsplit(canon)
        canon_path = norm_path(canon) if (not u.hostname or u.hostname in HOSTS) else canon
    r["canonical"] = canon
    r["canonicalElsewhere"] = bool(canon and canon_path != own)
    m = RX["main"].search(src) or RX["body"].search(src)
    body = m.group(1) if m else src
    words = len(re.findall(r"[A-Za-z0-9][A-Za-z0-9'.,%$-]*", text_of(RX["strip_blocks"].sub(" ", body))))
    r["words"] = words
    r["mainTag"] = bool(RX["main"].search(src))
    redirect_to = None
    if refresh:
        mm = re.search(r"url\s*=\s*['\"]?([^'\";]+)", refresh, re.I)
        redirect_to = mm.group(1).strip() if mm else refresh
        r["redirect"] = {"type": "meta-refresh", "to": redirect_to}
    else:
        js = RX["js_redirect"].search(src)
        if js and words < 80:
            r["redirect"] = {"type": "js", "to": js.group(1)}
        else:
            r["redirect"] = None
    r["isRedirectStub"] = r["redirect"] is not None
    def links_in(text):
        out = set()
        for m in RX["a"].finditer(text):
            p = resolve_href(m.group(1) if m.group(1) is not None else m.group(2), rel)
            if p and p != own:
                out.add(p)
        return out
    r["_links"] = links_in(src)
    r["_links_ctx"] = links_in(RX["chrome_blocks"].sub(" ", RX["comment"].sub(" ", src)))
    scripts = []
    for s in RX["script_src"].findall(src):
        s = s.split("?", 1)[0].split("#", 1)[0]
        if "://" in s or s.startswith("//"):
            continue
        sp = urllib.parse.urljoin("https://agsist.com/" + rel, s)
        scripts.append(urllib.parse.urlsplit(sp).path.lstrip("/"))
    r["_scripts"] = scripts
    r["_data"] = data_refs(src)
    return r


# -------------------------------------------------------------- grouping
def set_pattern(rel, crowded):
    """Return a set pattern for generated pages, or None for an individual page."""
    parts = rel.split("/")
    if len(parts) == 1:
        return None
    folder, name = parts[0], parts[-1][:-5]
    if len(parts) == 2:
        if name in STATES:
            return f"{folder}/{{state}}.html"
        if DATE_RE.match(name):
            return f"{folder}/{{date}}.html"
        if name != "index" and crowded.get(folder, 0) >= 5:
            return f"{folder}/{{slug}}.html"
        return None
    mid = "/".join("{state}" if p in STATES else "{dir}" for p in parts[1:-1])
    if name == "index":
        leaf = "index"
    elif name.endswith("-sheet"):
        leaf = "{place}-sheet"
    elif re.search(r"-(county|parish|borough|city|census-area|municipality)$", name):
        leaf = "{county}"
    else:
        leaf = "{place}"
    return f"{folder}/{mid}/{leaf}.html"


def crowded_counts(rels):
    c = Counter()
    for rel in rels:
        parts = rel.split("/")
        if len(parts) == 2:
            n = parts[1][:-5]
            if n not in STATES and not DATE_RE.match(n) and n != "index":
                c[parts[0]] += 1
    return c


# ------------------------------------------------------------------- git
def git_last_dates(root, rels):
    """{rel: iso date} from one pass over history. (dates, shallow_boundary)."""
    want = set(rels)
    found = {}
    try:
        shallow = subprocess.run(["git", "rev-parse", "--is-shallow-repository"], cwd=root,
                                 capture_output=True, text=True).stdout.strip() == "true"
        boundary = None
        if shallow:
            boundary = subprocess.run(["git", "log", "--format=%cI", "--max-parents=0", "-1"], cwd=root,
                                      capture_output=True, text=True).stdout.strip() or None
        p = subprocess.Popen(["git", "log", "--format=C %cI", "--name-only", "--no-renames",
                              "--", "*.html"], cwd=root, stdout=subprocess.PIPE, text=True)
        cur = None
        for line in p.stdout:
            line = line.rstrip("\n")
            if line.startswith("C "):
                cur = line[2:12]
            elif line and line in want and line not in found:
                found[line] = cur
                if len(found) == len(want):
                    break
        p.kill()
        p.wait()
        return found, (boundary[:10] if boundary else None)
    except OSError:
        return found, None


# ------------------------------------------------------------------ build
def stats(vals):
    vals = sorted(v for v in vals if v is not None)
    if not vals:
        return None
    return {"min": vals[0], "median": vals[len(vals) // 2], "max": vals[-1]}


def build(root=REPO, git_dates=None, log=print):
    root = Path(root)
    rels, fragments = published_html(root)
    log(f"[inventory] {len(rels)} pages, {len(fragments)} fragments")

    sitemap = set()
    for sm in sorted(root.glob("sitemap*.xml")):
        for loc in re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", sm.read_text(encoding="utf-8", errors="replace")):
            sitemap.add(norm_path(html.unescape(loc)))

    nav = {}
    for where, files in NAV_FILES.items():
        for f in files:
            fp = root / f
            if fp.is_file():
                for m in RX["a"].finditer(fp.read_text(encoding="utf-8", errors="replace")):
                    p = resolve_href(m.group(1) if m.group(1) is not None else m.group(2), "index.html")
                    if p:
                        nav.setdefault(p, set()).add(where)

    js_cache = {}

    def js_data(path):
        if path not in js_cache:
            fp = root / path
            try:
                js_cache[path] = data_refs(fp.read_text(encoding="utf-8", errors="replace")) if fp.is_file() else set()
            except OSError:
                js_cache[path] = set()
        return js_cache[path]

    rows = {}
    inbound = defaultdict(set)
    inbound_ctx = defaultdict(set)
    for i, rel in enumerate(rels):
        src = (root / rel).read_text(encoding="utf-8", errors="replace")
        r = parse_page(src, rel)
        r["file"] = rel
        r["path"] = file_to_path(rel)
        data = set(r.pop("_data"))
        for s in r.pop("_scripts"):
            if s.endswith(".js"):
                data |= js_data(s)
        r["dataFiles"] = sorted(data)
        for l in r.pop("_links"):
            inbound[l].add(r["path"])
        for l in r.pop("_links_ctx"):
            inbound_ctx[l].add(r["path"])
        rows[rel] = r
        if i and i % 2000 == 0:
            log(f"[inventory]   parsed {i}")

    if git_dates is None:
        log("[inventory] reading git history (one pass)")
        dates, boundary = git_last_dates(root, rels)
    else:
        dates, boundary = git_dates

    for rel, r in rows.items():
        p = r["path"]
        r["inbound"] = len(inbound.get(p, ()))
        r["inboundContextual"] = len(inbound_ctx.get(p, ()))
        r["inSitemap"] = p in sitemap
        r["nav"] = sorted(nav.get(p, ()))
        r["inNav"] = bool(r["nav"])
        d = dates.get(rel) or boundary
        r["lastCommit"] = d
        r["lastCommitShallow"] = bool(boundary and d == boundary)

    crowded = crowded_counts(rels)
    groups = defaultdict(list)
    singles = []
    for rel in rels:
        pat = set_pattern(rel, crowded)
        (groups[pat] if pat else singles).append(rows[rel])

    title_count = Counter(r["title"] for r in rows.values() if r["title"])

    def page_row(r):
        return {"path": r["path"], "file": r["file"], "title": r["title"], "h1": r["h1"],
                "description": r["description"], "words": r["words"], "inbound": r["inbound"],
                "inboundContextual": r["inboundContextual"],
                "inboundFrom": sorted(inbound_ctx.get(r["path"], ()) or inbound.get(r["path"], ()))[:5],
                "dataFiles": r["dataFiles"], "isRedirectStub": r["isRedirectStub"],
                "redirect": r["redirect"], "canonical": r["canonical"],
                "canonicalElsewhere": r["canonicalElsewhere"], "noindex": r["noindex"],
                "inSitemap": r["inSitemap"], "nav": r["nav"], "inNav": r["inNav"],
                "lastCommit": r["lastCommit"], "lastCommitShallow": r["lastCommitShallow"],
                "titleSharedWith": title_count[r["title"]] - 1 if r["title"] else None}

    pages = [page_row(r) for r in sorted(singles, key=lambda r: r["path"])]

    sets = []
    for pat, rs in sorted(groups.items(), key=lambda kv: (-len(kv[1]), kv[0])):
        rs = sorted(rs, key=lambda r: r["path"])
        df = Counter(f for r in rs for f in r["dataFiles"])
        dts = [r["lastCommit"] for r in rs if r["lastCommit"]]
        tc = Counter(r["title"] for r in rs if r["title"])
        zero = [r["path"] for r in rs if r["inbound"] == 0]
        sets.append({
            "pattern": pat, "count": len(rs),
            "examples": [r["path"] for r in rs[:3]],
            "exampleTitle": rs[0]["title"], "exampleH1": rs[0]["h1"],
            "words": stats(r["words"] for r in rs),
            "inbound": stats(r["inbound"] for r in rs),
            "zeroInbound": len(zero), "zeroInboundExamples": zero[:10],
            "inboundContextual": stats(r["inboundContextual"] for r in rs),
            "zeroInboundContextual": sum(r["inboundContextual"] == 0 for r in rs),
            "redirectStubs": sum(r["isRedirectStub"] for r in rs),
            "canonicalElsewhere": sum(r["canonicalElsewhere"] for r in rs),
            "noindex": sum(r["noindex"] for r in rs),
            "inSitemap": sum(r["inSitemap"] for r in rs),
            "inNav": sum(r["inNav"] for r in rs),
            "missingTitle": sum(not r["title"] for r in rs),
            "missingH1": sum(not r["h1"] for r in rs),
            "missingDescription": sum(not r["description"] for r in rs),
            "duplicateTitlesInSet": sum(n for n in tc.values() if n > 1),
            "dataFiles": dict(df.most_common()),
            "lastCommit": {"min": min(dts), "max": max(dts)} if dts else None,
        })

    allr = list(rows.values())
    live = [r for r in allr if not r["isRedirectStub"]]
    dup_titles = {t: sorted(r["path"] for r in allr if r["title"] == t)
                  for t, n in title_count.items() if n > 1}
    dup_single = {t: ps for t, ps in dup_titles.items()
                  if any(p in {x["path"] for x in pages} for p in ps)}
    summary = {
        "publishedPages": len(allr),
        "individualPages": len(pages),
        "generatedSets": len(sets),
        "generatedPages": sum(s["count"] for s in sets),
        "fragmentsSkipped": fragments,
        "redirectStubs": sum(r["isRedirectStub"] for r in allr),
        "redirectStubPaths": sorted(r["path"] for r in allr if r["isRedirectStub"]),
        "canonicalElsewhere": sum(r["canonicalElsewhere"] for r in allr),
        "noindex": sum(r["noindex"] for r in allr),
        "orphansZeroInbound": sum(r["inbound"] == 0 for r in live),
        "orphansZeroInboundNotInNav": sum(r["inbound"] == 0 and not r["inNav"] for r in live),
        "zeroContextualInbound": sum(r["inboundContextual"] == 0 for r in live),
        "zeroContextualInboundNotInNav": sum(r["inboundContextual"] == 0 and not r["inNav"] for r in live),
        "zeroContextualIndividualPaths": sorted(p["path"] for p in pages if p["inboundContextual"] == 0
                                                and not p["isRedirectStub"]),
        "orphanIndividualPaths": sorted(p["path"] for p in pages if p["inbound"] == 0 and not p["isRedirectStub"]),
        "notInSitemap": sum(not r["inSitemap"] for r in live),
        "notInNav": sum(not r["inNav"] for r in live),
        "notInNavOrSitemap": sum(not r["inNav"] and not r["inSitemap"] for r in live),
        "notInNavOrSitemapIndividual": sorted(p["path"] for p in pages if not p["inNav"]
                                              and not p["inSitemap"] and not p["isRedirectStub"]),
        "indexableNotInSitemap": sum(not r["inSitemap"] and not r["noindex"] for r in live),
        "sitemapUrlsWithNoPage": sorted(sitemap - {r["path"] for r in allr})[:50],
        "navLinksWithNoPage": sorted(set(nav) - {r["path"] for r in allr}),
        "duplicateTitleGroups": len(dup_titles),
        "pagesWithDuplicateTitle": sum(len(v) for v in dup_titles.values()),
        "duplicateTitlesIndividual": dup_single,
        "missingTitle": sum(not r["title"] for r in live),
        "missingH1": sum(not r["h1"] for r in live),
        "missingDescription": sum(not r["description"] for r in live),
        "note": ("orphan, sitemap and nav counts exclude redirect stubs; inbound counts static <a href> "
                 "only; inboundContextual leaves out links inside <nav>, <header> and <footer>, "
                 "which many pages bake in"),
    }
    return {"schema": "agsist-site-inventory/1",
            "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "pathRule": "query, fragment, .html, trailing slash and /index removed",
            "gitShallowBoundary": boundary,
            "summary": summary, "pages": pages, "sets": sets}


def main():
    out = build()
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    s = out["summary"]
    print(f"[inventory] wrote {OUT.relative_to(REPO)}: {s['publishedPages']} pages, "
          f"{s['individualPages']} individual, {s['generatedSets']} sets")
    return 0


# --------------------------------------------------------------- selftest
def selftest():
    import tempfile
    failed = []

    def check(ok, name, detail=""):
        print(("  ok    " if ok else "  FAIL  ") + name + ("" if ok else "  :: " + str(detail)[:400]))
        if not ok:
            failed.append(name)

    check(resolve_href("../tools.html?x#y", "basis/iowa.html") == "/tools", "relative href resolved")
    check(resolve_href("https://www.agsist.com/cash-bids/", "index.html") == "/cash-bids", "absolute own-host href")
    check(resolve_href("https://example.com/x", "index.html") is None, "external href ignored")
    check(resolve_href("/data/x.json", "index.html") is None, "non-page asset ignored")
    check(resolve_href("mailto:a@b", "index.html") is None, "mailto ignored")
    check(data_refs("fetch('/data/a.json'); x=`/data/cash-bids/${st}.json`; y='/data/rent/'+s+'.json'")
          == {"data/a.json", "data/cash-bids/*.json", "data/rent/*"}, "data refs: literal, template, concat",
          data_refs("fetch('/data/a.json'); x=`/data/cash-bids/${st}.json`; y='/data/rent/'+s+'.json'"))
    check(set_pattern("arc-plc/iowa/story-county-sheet.html", {}) == "arc-plc/{state}/{place}-sheet.html", "sheet pattern")
    check(set_pattern("cash-bids/iowa/index.html", {}) == "cash-bids/{state}/index.html", "state index pattern")
    check(set_pattern("daily/2026-01-02.html", {}) == "daily/{date}.html", "date pattern")
    check(set_pattern("farmland-atlas/methods.html", {"farmland-atlas": 4}) is None, "small folder page stays individual")
    check(set_pattern("about.html", {}) is None, "root page individual")

    with tempfile.TemporaryDirectory() as d:
        R = Path(d)
        (R / "components").mkdir()
        (R / "basis").mkdir()
        (R / "js").mkdir()
        (R / "components/header.html").write_text('<a href="/">Home</a><a href="/tools">Tools</a>')
        (R / "components/footer.html").write_text('<a href="/about.html">About</a>')
        (R / "js/app.js").write_text("fetch('/data/tools.json')")
        (R / "index.html").write_text('<html><head><title>Home</title><meta name="description" content="Hi">'
                                      '</head><body><header><a href="/tools">x</a></header><main><h1>Welcome</h1>'
                                      '<p>one two three</p><a href="basis/iowa.html">Iowa</a>'
                                      '<a href="/old">old</a></main></body></html>')
        (R / "tools.html").write_text('<title>Tools</title><script src="/js/app.js?v=2"></script>'
                                      '<body><h1>Tools <b>x</b></h1><a href="/">h</a></body>')
        (R / "about.html").write_text('<title>Home</title><meta name="robots" content="noindex"><body><main>'
                                      '<h1>About</h1><p>a b</p></main></body>')
        (R / "lonely.html").write_text('<title>Lonely</title><body><p>no one links here</p></body>')
        (R / "old.html").write_text('<title>Old</title><link rel="canonical" href="https://agsist.com/tools">'
                                    '<meta http-equiv="refresh" content="0; url=https://agsist.com/tools"><body>moved</body>')
        (R / "basis/iowa.html").write_text('<title>Iowa basis</title><body><main data-src="/data/basis/iowa.json">'
                                           '<h1>Iowa</h1></main></body>')
        (R / "basis/ohio.html").write_text('<title>Ohio basis</title><body><h1>Ohio</h1></body>')
        (R / "sitemap.xml").write_text("<urlset><url><loc>https://agsist.com/</loc></url>"
                                       "<url><loc>https://agsist.com/basis/iowa</loc></url>"
                                       "<url><loc>https://agsist.com/gone</loc></url></urlset>")
        out = build(R, git_dates=({"index.html": "2026-10-01"}, "2026-01-01"), log=lambda *a: None)
        P = {p["path"]: p for p in out["pages"]}
        S = out["summary"]
        check(set(P) == {"/", "/tools", "/about", "/lonely", "/old"}, "individual pages", list(P))
        check(len(out["sets"]) == 1 and out["sets"][0]["pattern"] == "basis/{state}.html"
              and out["sets"][0]["count"] == 2, "state set summarized", out["sets"])
        check("components/header.html" in S["fragmentsSkipped"], "components are fragments, not pages")
        check(P["/"]["title"] == "Home" and P["/"]["h1"] == "Welcome" and P["/"]["description"] == "Hi", "title/h1/description")
        check(P["/"]["words"] == 6, "word count from <main>, header stripped", P["/"]["words"])
        check(P["/tools"]["h1"] == "Tools x", "h1 tags stripped", P["/tools"]["h1"])
        check(P["/tools"]["inbound"] == 1 and P["/tools"]["inNav"], "inbound counts distinct pages; nav flag", P["/tools"])
        check(P["/tools"]["inboundContextual"] == 0 and P["/old"]["inboundContextual"] == 1,
              "contextual inbound skips <header> links", (P["/tools"]["inboundContextual"], P["/old"]["inboundContextual"]))
        check(P["/tools"]["dataFiles"] == ["data/tools.json"], "data file found through local script", P["/tools"]["dataFiles"])
        check(out["sets"][0]["dataFiles"] == {"data/basis/iowa.json": 1}, "data-src found")
        check(P["/old"]["isRedirectStub"] and P["/old"]["redirect"]["to"] == "https://agsist.com/tools"
              and P["/old"]["canonicalElsewhere"], "meta refresh stub", P["/old"])
        check(P["/about"]["noindex"] and P["/about"]["nav"] == ["footer"], "noindex and footer nav")
        check(P["/lonely"]["inbound"] == 0 and "/lonely" in S["orphanIndividualPaths"], "orphan found")
        check(P["/"]["inSitemap"] and not P["/tools"]["inSitemap"], "sitemap membership")
        check(S["sitemapUrlsWithNoPage"] == ["/gone"], "sitemap URL with no page", S["sitemapUrlsWithNoPage"])
        check(S["duplicateTitleGroups"] == 1 and S["duplicateTitlesIndividual"] == {"Home": ["/", "/about"]},
              "duplicate titles", S["duplicateTitlesIndividual"])
        check(P["/"]["lastCommit"] == "2026-10-01" and not P["/"]["lastCommitShallow"], "git date used")
        check(P["/lonely"]["lastCommit"] == "2026-01-01" and P["/lonely"]["lastCommitShallow"], "shallow boundary flagged")
        check(S["redirectStubs"] == 1 and "/old" not in S["notInNavOrSitemapIndividual"], "stubs excluded from nav/sitemap gaps")

    print("selftest: " + ("FAILED " + ", ".join(failed) if failed else "all passed"))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(selftest() if "--selftest" in sys.argv[1:] else main())
