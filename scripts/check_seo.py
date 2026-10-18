#!/usr/bin/env python3
"""SEO guard for what GitHub Pages publishes.

Runs on every push (.github/workflows/seo-guard.yml). It reads every published
.html page and the sitemaps listed in robots.txt and checks the things that
quietly cost search traffic when a generator or a hand edit gets them wrong:

Hard errors (exit 1):
  * a page has no <title>, an empty one, or more than one in <head>
  * an indexable page has no canonical link, or one that is not absolute
    https://agsist.com/..., or one that points somewhere other than the page's
    own clean URL (the site serves /x for x.html and /x/ for x/index.html)
  * a JSON-LD block does not parse as JSON
  * a page marked noindex (or a redirect stub) is listed in a sitemap
  * a sitemap URL has no file behind it (it would 404), or is not the
    page's own clean URL (/x.html or /x/index.html listed as /x/ or /x)
  * two indexable pages share a title

Warnings (printed, never fail):
  * meta description missing, or shorter than DESC_MIN / longer than DESC_MAX
  * an indexable page is in none of the sitemaps
  * a URL is listed twice across the sitemaps

Skipped by design: dot folders and components/ (partials with no <head>).
Pointer pages (a generated page that dropped out of its set, scripts/pointer_pages.py)
are hard-checked: under 1.5 KB, noindex, follow, canonical and an instant refresh
to one real parent page, and listed in data/pointers.
Redirect stubs (meta refresh) and noindex pages (embed/, sponsor-kit,
sponsor-report, arc-plc/sheet, seo-report) only have to keep one title,
parse their JSON-LD, and stay out of the sitemaps.

Known offenders go in EXCEPTIONS with a date and a reason. Each one is a debt,
not a pass, and the check prints them every run.

  python3 scripts/check_seo.py            # report, exit 1 on any hard error
  python3 scripts/check_seo.py --json     # machine-readable report
  python3 scripts/check_seo.py --selftest
"""
import html
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pointer_pages as PP  # noqa: E402  the pointer marker and the manifest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ORIGIN = "https://agsist.com"

DESC_MIN = 70
DESC_MAX = 170

SKIP_DIRS = {".git", ".github", "node_modules", "__pycache__", ".claude",
             "components", "scripts", "test", "workers", "build"}

# path (relative, forward slashes) -> "YYYY-MM-DD: reason". Exempts that page
# from hard errors; it is still listed every run.
EXCEPTIONS = {
}

RE_HEAD = re.compile(rb"</head\s*>", re.I)
RE_TITLE = re.compile(r"<title\b[^>]*>(.*?)</title\s*>", re.I | re.S)
RE_META = re.compile(r"<meta\b[^>]*>", re.I)
RE_LINK = re.compile(r"<link\b[^>]*>", re.I)
RE_ATTR = re.compile(r"""([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))""")
RE_LDJSON = re.compile(rb"""<script\b[^>]*type\s*=\s*["']?application/ld\+json["']?[^>]*>(.*?)</script\s*>""", re.I | re.S)
RE_LOC = re.compile(r"<loc>\s*([^<\s]+)\s*</loc>", re.I)
RE_SITEMAP = re.compile(r"^\s*sitemap:\s*(\S+)", re.I | re.M)
RE_COMMENT = re.compile(r"<!--.*?-->", re.S)
RE_SCRIPT = re.compile(r"<script\b.*?</script\s*>", re.I | re.S)


def attrs(tag):
    out = {}
    for m in RE_ATTR.finditer(tag):
        v = m.group(3) if m.group(3) is not None else (m.group(4) if m.group(4) is not None else m.group(5))
        out[m.group(1).lower()] = html.unescape(v)
    return out


def clean_url(rel):
    """Published path of a file -> the URL the site uses for it."""
    rel = rel.replace(os.sep, "/")
    if rel == "index.html":
        return ORIGIN + "/"
    if rel.endswith("/index.html"):
        return ORIGIN + "/" + rel[: -len("index.html")]
    if rel.endswith(".html"):
        return ORIGIN + "/" + rel[:-5]
    return ORIGIN + "/" + rel


def url_to_file(url, root):
    """A sitemap URL -> the file Pages would serve for it, or None."""
    if not url.startswith(ORIGIN + "/") and url != ORIGIN:
        return None
    path = url[len(ORIGIN):].split("#", 1)[0].split("?", 1)[0].lstrip("/")
    if path == "" or path.endswith("/"):
        cands = [path + "index.html"]
    else:
        cands = [path + ".html", path, path + "/index.html"]
    for c in cands:
        p = os.path.join(root, *c.split("/"))
        if os.path.isfile(p):
            return c
    return None


def pages(root):
    for dirpath, dirnames, filenames in os.walk(root):
        rel_dir = os.path.relpath(dirpath, root)
        if rel_dir == ".":
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
        else:
            dirnames[:] = [d for d in dirnames if not d.startswith(".") and d not in ("node_modules", "__pycache__")]
        for f in filenames:
            if f.endswith(".html"):
                yield os.path.relpath(os.path.join(dirpath, f), root).replace(os.sep, "/")


def inspect(root, rel):
    with open(os.path.join(root, *rel.split("/")), "rb") as fh:
        raw = fh.read()
    m = RE_HEAD.search(raw)
    head = (raw[: m.start()] if m else raw[:65536]).decode("utf-8", "replace")
    head_scan = RE_SCRIPT.sub(" ", RE_COMMENT.sub(" ", head))
    titles = [html.unescape(re.sub(r"\s+", " ", t)).strip() for t in RE_TITLE.findall(head_scan)]
    robots = ""
    desc = None
    refresh = False
    pointer = None
    for t in RE_META.findall(head_scan):
        a = attrs(t)
        name = a.get("name", "").lower()
        if name in ("robots", "googlebot"):
            robots += " " + a.get("content", "").lower()
        elif name == "description":
            desc = re.sub(r"\s+", " ", a.get("content", "")).strip()
        elif a.get("http-equiv", "").lower() == "refresh":
            refresh = a.get("content", "")
        elif name == PP.MARKER:
            pointer = a.get("content", "")
    canon = []
    for t in RE_LINK.findall(head_scan):
        a = attrs(t)
        if "canonical" in a.get("rel", "").lower().split():
            canon.append(a.get("href", ""))
    ld_bad = []
    for i, b in enumerate(RE_LDJSON.findall(raw)):
        try:
            json.loads(b.decode("utf-8", "replace"))
        except ValueError as e:
            ld_bad.append(f"block {i + 1}: {e}")
    return {
        "titles": titles,
        "noindex": "noindex" in robots,
        "refresh": refresh,
        "desc": desc,
        "canon": canon,
        "ld_bad": ld_bad,
        "pointer": pointer,
        "robots": robots.strip(),
        "bytes": len(raw),
    }


def pointer_errors(rel, p, info, manifest):
    """A pointer page (scripts/pointer_pages.py) is held to its own rules, never fewer: small,
    noindex, one canonical and an instant refresh to the same parent, a parent that is a real
    page (no chains, no 404), and a line in data/pointers."""
    to = p["pointer"]
    out = []
    if p["bytes"] > PP.MAX_BYTES:
        out.append(f"pointer page is {p['bytes']} bytes, over {PP.MAX_BYTES}")
    if "noindex" not in p["robots"] or "follow" not in p["robots"].replace("nofollow", ""):
        out.append(f"pointer page robots is {p['robots']!r}, not 'noindex, follow'")
    if p["canon"] != [ORIGIN + to]:
        out.append(f"pointer canonical {p['canon']} is not {ORIGIN + to}")
    if (p["refresh"] or "").replace(" ", "") != "0;url=" + to:
        out.append(f"pointer refresh {p['refresh']!r} is not an instant refresh to {to}")
    tgt = url_to_file(ORIGIN + to, ROOT_OF[0]) if to.startswith("/") else None
    if tgt is None:
        out.append(f"pointer target {to} has no page behind it")
    elif tgt in info and (info[tgt]["pointer"] is not None or info[tgt]["refresh"]):
        out.append(f"pointer target {to} is itself a pointer or redirect")
    if manifest.get(rel, {}).get("to") != to:
        out.append(f"pointer to {to} is not in data/pointers (or listed with another target)")
    return out


ROOT_OF = [ROOT]


def read_sitemaps(root):
    """{sitemap file: [urls]} for every sitemap robots.txt lists."""
    out = {}
    try:
        robots = open(os.path.join(root, "robots.txt"), encoding="utf-8").read()
    except OSError:
        return out
    for sm in RE_SITEMAP.findall(robots):
        local = url_to_file(sm, root)
        if not local:
            out[sm] = None
            continue
        txt = open(os.path.join(root, *local.split("/")), encoding="utf-8").read()
        out[local] = [html.unescape(u) for u in RE_LOC.findall(txt)]
    return out


def check(root=ROOT):
    ROOT_OF[0] = root
    errors, warnings = [], []
    excused = []
    sitemaps = read_sitemaps(root)
    in_sitemap = {}
    for sm, urls in sitemaps.items():
        if urls is None:
            errors.append(f"robots.txt lists {sm}, which has no file")
            continue
        for u in urls:
            f = url_to_file(u, root)
            if f is None:
                errors.append(f"{sm}: {u} has no file behind it (404)")
                continue
            if f.endswith(".html") and clean_url(f) != u:
                errors.append(f"{sm}: {u} is not the page's own URL {clean_url(f)}")
            if f in in_sitemap and "sitemap-news" not in sm and "sitemap-news" not in in_sitemap[f]:
                # a Google News sitemap repeats recent issues by design
                warnings.append(f"{sm}: {u} is listed more than once (also in {in_sitemap[f]})")
            in_sitemap.setdefault(f, sm)

    info = {}
    for rel in pages(root):
        info[rel] = inspect(root, rel)
    manifest = PP.load_all(root)
    for rel in sorted(manifest):
        if rel not in info:
            errors.append(f"{rel}: listed in data/pointers but there is no such page")
        elif info[rel]["pointer"] is None and info[rel]["bytes"] <= PP.MAX_BYTES:
            errors.append(f"{rel}: listed in data/pointers but is not a pointer page")

    def err(rel, msg):
        if rel in EXCEPTIONS:
            excused.append(f"{rel}: {msg} [{EXCEPTIONS[rel]}]")
        else:
            errors.append(f"{rel}: {msg}")

    titles = {}
    n_index = 0
    no_desc = []
    for rel in sorted(info):
        p = info[rel]
        stub = bool(p["refresh"])
        if p["pointer"] is not None:
            for m in pointer_errors(rel, p, info, manifest):
                err(rel, m)
        if (p["noindex"] or stub) and rel in in_sitemap:
            err(rel, f"is {'a redirect stub' if stub else 'noindex'} but listed in {in_sitemap[rel]}")
        if stub:
            continue
        if len(p["titles"]) != 1:
            err(rel, f"has {len(p['titles'])} <title> tags in <head>")
        elif not p["titles"][0]:
            err(rel, "has an empty <title>")
        for b in p["ld_bad"]:
            err(rel, f"JSON-LD does not parse ({b})")
        if p["noindex"]:
            continue
        n_index += 1
        if p["titles"] and p["titles"][0]:
            titles.setdefault(p["titles"][0], []).append(rel)
        want = clean_url(rel)
        if not p["canon"]:
            err(rel, "has no canonical link")
        elif len(p["canon"]) > 1:
            err(rel, f"has {len(p['canon'])} canonical links")
        else:
            c = p["canon"][0]
            if not c.startswith(ORIGIN + "/"):
                err(rel, f"canonical {c!r} is not absolute {ORIGIN}/...")
            elif c != want:
                err(rel, f"canonical {c} does not match its URL {want}")
        d = p["desc"]
        if not d:
            no_desc.append(rel)
        elif not (DESC_MIN <= len(d) <= DESC_MAX):
            warnings.append(f"{rel}: meta description is {len(d)} chars (aim {DESC_MIN}-{DESC_MAX})")
        if rel not in in_sitemap:
            warnings.append(f"{rel}: indexable but in no sitemap")
    for t, rels in sorted(titles.items()):
        if len(rels) > 1:
            if all(r in EXCEPTIONS for r in rels):
                excused.append(f"duplicate title {t!r}: {', '.join(rels)}")
            else:
                errors.append(f"duplicate title {t!r} on {len(rels)} pages: {', '.join(rels[:5])}"
                              + (" ..." if len(rels) > 5 else ""))
    for rel in no_desc:
        warnings.append(f"{rel}: no meta description")
    return {
        "pages": len(info),
        "indexable": n_index,
        "sitemap_urls": sum(len(v or []) for v in sitemaps.values()),
        "errors": errors,
        "warnings": warnings,
        "excused": excused,
    }


def selftest():
    import tempfile
    fails = []

    def ok(c, m):
        if not c:
            fails.append(m)

    def page(title="T", canon=None, desc="d" * 100, robots=None, extra="", body=""):
        h = "<!doctype html><html><head>"
        if title is not None:
            h += f"<title>{title}</title>"
        if desc is not None:
            h += f'<meta name="description" content="{desc}">'
        if robots:
            h += f'<meta name="robots" content="{robots}">'
        if canon:
            h += f'<link rel="canonical" href="{canon}">'
        return h + extra + "</head><body>" + body + "</body></html>"

    with tempfile.TemporaryDirectory() as d:
        def w(rel, s):
            p = os.path.join(d, *rel.split("/"))
            os.makedirs(os.path.dirname(p), exist_ok=True)
            open(p, "w").write(s)

        w("robots.txt", "Sitemap: https://agsist.com/sitemap.xml\n")
        w("sitemap.xml", "<urlset>" + "".join(f"<url><loc>https://agsist.com/{u}</loc></url>" for u in
                         ["", "a", "dir/", "ni", "gone", "stub", "a.html", "dir"]) + "</urlset>")
        w("index.html", page("Home", "https://agsist.com/", body="<svg><title>icon</title></svg>"))
        w("a.html", page("A", "https://agsist.com/a",
                         extra='<script type="application/ld+json">{"@type": "Thing"}</script>'))
        w("dir/index.html", page("Dir", "https://agsist.com/dir/"))
        w("ni.html", page("NI", robots="noindex,follow"))
        w("stub.html", '<html><head><meta http-equiv="refresh" content="0; url=/a"></head></html>')
        w("components/x.html", "<div>partial, no head</div>")
        r = check(d)
        ok(r["pages"] == 5, f"components/ skipped: {r['pages']}")
        es = "\n".join(r["errors"])
        ok("gone has no file" in es, f"404 sitemap URL flagged: {es}")
        ok("ni.html: is noindex but listed" in es, "noindex in sitemap flagged")
        ok("stub.html: is a redirect stub but listed" in es, "stub in sitemap flagged")
        ok("a.html is not the page's own URL" in es, f"sitemap .html URL flagged: {es}")
        ok("/dir is not the page's own URL" in es, "sitemap dir URL without slash flagged")
        ok(any("listed more than once" in x for x in r["warnings"]), "duplicate sitemap URL warns")
        ok("index.html: has" not in es, "svg <title> in body is not a second title")
        ok(not any(e.startswith(("a.html", "dir/")) for e in r["errors"]), f"good pages pass: {es}")

        w("b.html", page("A", "https://agsist.com/b.html", desc="short",
                         extra='<script type="application/ld+json">{"a": 1,}</script>'))
        w("c.html", page("", "/c", desc=None))
        w("e.html", page("E", None) + "")
        w("f.html", page("F", "https://agsist.com/f", extra="<title>F2</title>"))
        r = check(d)
        es = "\n".join(r["errors"])
        ws = "\n".join(r["warnings"])
        ok("duplicate title 'A'" in es, f"duplicate title flagged: {es}")
        ok("b.html: canonical https://agsist.com/b.html does not match" in es, "wrong canonical flagged")
        ok("b.html: JSON-LD does not parse" in es, "bad JSON-LD flagged")
        ok("c.html: has an empty <title>" in es, "empty title flagged")
        ok("c.html: canonical '/c' is not absolute" in es, "relative canonical flagged")
        ok("e.html: has no canonical" in es, "missing canonical flagged")
        ok("f.html: has 2 <title>" in es, "two titles flagged")
        ok("b.html: meta description is 5 chars" in ws, "short description warns")
        ok("c.html: no meta description" in ws, "missing description warns")
        ok("b.html: indexable but in no sitemap" in ws, "missing from sitemap warns")
        ok(not any("ni.html: has no canonical" in e for e in r["errors"]), "noindex pages need no canonical")

        # pointer pages: a good one passes, each broken rule is caught
        import json as _j
        w("ptr.html", PP.page("/a", "Ptr", "A"))
        w("data/pointers/t.json", _j.dumps({"pointers": {"ptr.html": {"to": "/a", "since": "2026-10-18"},
                                                       "p2.html": {"to": "/stub", "since": "2026-10-18"},
                                                       "missing.html": {"to": "/a", "since": "2026-10-18"}}}))
        w("p2.html", PP.page("/stub", "P2", "Stub"))
        w("p3.html", PP.page("/a", "P3", "A").replace("noindex, follow", "index, follow"))
        w("p4.html", PP.page("/nowhere", "P4", "x").replace('href="https://agsist.com/nowhere"', 'href="https://agsist.com/a"'))
        r = check(d)
        es = "\n".join(r["errors"])
        ok(not any(e.startswith("ptr.html") for e in r["errors"]), f"good pointer passes: {es}")
        ok("p2.html: pointer target /stub is itself a pointer or redirect" in es, "pointer chain caught")
        ok("p3.html: pointer page robots" in es and "p3.html: pointer to /a is not in data/pointers" in es, "indexable or unlisted pointer caught")
        ok("p4.html: pointer canonical" in es and "p4.html: pointer target /nowhere has no page" in es, "canonical mismatch and dead target caught")
        ok("missing.html: listed in data/pointers but there is no such page" in es, "manifest row with no page caught")
        for f in ("ptr.html", "p2.html", "p3.html", "p4.html", "data/pointers/t.json"):
            os.remove(os.path.join(d, f))

        EXCEPTIONS["e.html"] = "2026-10-11: test"
        try:
            r = check(d)
            ok(not any(e.startswith("e.html") for e in r["errors"]), "exception exempts the page")
            ok(any(x.startswith("e.html") for x in r["excused"]), "exception still listed")
        finally:
            EXCEPTIONS.pop("e.html")

    ok(clean_url("x/index.html") == ORIGIN + "/x/", "dir index URL")
    ok(clean_url("x/y.html") == ORIGIN + "/x/y", ".html stripped")
    if fails:
        print("SELFTEST FAIL")
        for f in fails:
            print("  -", f)
        return 1
    print("selftest ok")
    return 0


def main():
    if "--selftest" in sys.argv:
        return selftest()
    t0 = time.time()
    r = check()
    r["seconds"] = round(time.time() - t0, 1)
    if "--json" in sys.argv:
        print(json.dumps(r, indent=1))
        return 1 if r["errors"] else 0
    print(f"SEO guard: {r['pages']} pages, {r['indexable']} indexable, "
          f"{r['sitemap_urls']} sitemap URLs, {r['seconds']}s")
    for x in r["excused"]:
        print("EXCUSED:", x)
    limit = None if "--all" in sys.argv else 40
    for w in r["warnings"][:limit]:
        print("WARN:", w)
    if limit and len(r["warnings"]) > limit:
        print(f"WARN: ...and {len(r['warnings']) - limit} more warnings (--all to list)")
    for e in r["errors"]:
        print("ERROR:", e)
    print(f"{len(r['errors'])} errors, {len(r['warnings'])} warnings")
    return 1 if r["errors"] else 0


if __name__ == "__main__":
    sys.exit(main())
