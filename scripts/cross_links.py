#!/usr/bin/env python3
"""cross_links.py: one county's pages in the other county sets link to each other.

WHY (night SEO audit, Oct 19, 2026): the county rain pages (2,691) got no links
from the PRF, Farmland Atlas or ARC/PLC county pages, and ARC/PLC got none to PRF
or from rain: 0 of 2,638, 0 of 2,649, 0 of 2,377, 0 of 2,760 and 0 of 2,377.
Search Console holds 4,830 pages "discovered, not indexed"; internal links are
the lever named for them.

THE RAIN LINK. PRF, Atlas and ARC/PLC county pages each carry one link marked
data-xl="rain": the county's own rain page when it is a live page (not a
pointer), else the state rain page, which every county page had before. The
rain set changes day to day and those three builders do not run then, so
scripts/build_county_rain.py's workflow (county-rain.yml) runs `stamp` right
after it builds: every marked link is rewritten to what rain_link() says now.
The builders call rain_link() too, so a builder's --check and the stamp agree.

    county:   <a data-xl="rain" href="/rain/iowa/story-county">Rain so far this year in Story County, Iowa</a>
    fallback: <a data-xl="rain" data-n="Story County" href="/rain/iowa">Rain so far this year in Iowa, county by county</a>

The fallback is the old state link plus the county's name (data-n), so a later
stamp can write the county link without the builder. A plain data link, not a
Rain Print pitch (test/rain-cross-promo.test.mjs counts promo slots only).

THE OTHER LINKS (ARC/PLC to PRF, rain to ARC/PLC) only print when the target is
a live page; those sets change about once a year, with their own rebuilds.

THE SAME-STATE ROW (Nov 10, 2026). One state's pages in the state sets (cash bids,
rent, yield, Farmland Atlas, rain, PRF, hail map, land sales) link to each other
through one row, written by same_state_row() and nothing else. A target is linked
only when its page is live in the checkout; the page's own set is left out.

    <nav class="xl-st" aria-label="Same state on AGSIST"><b>Iowa on AGSIST:</b> <a href="/rent/iowa">Cash rent</a> ...</nav>

BIDS NEAR THIS COUNTY. ARC/PLC and PRF county pages carry one marked line, up to three town bid
pages nearest the county middle (nearest_towns: the Atlas county point, the fold applied):

    <p class="xl-near" data-xl="near" data-f="19169">Bids near this county: <a href="/cash-bids/iowa/ames">Ames</a> (4 mi), ...</p>

Town pages come and go with the bids, and those two sets rebuild about once a year, so --stamp
rewrites the marked line too (county-rain.yml runs it daily), and their --check compares pages with
the line blanked (steady()), so a new town page never turns a check red.

THE BREADCRUMB TRAIL. crumbs(items) gives the visible trail and the BreadcrumbList
JSON-LD from one list, so the two cannot disagree.

    python3 scripts/cross_links.py --stamp      rewrite the marked rain links in place
    python3 scripts/cross_links.py --selftest

Stdlib only.
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import pointer_pages as PP  # noqa: E402

STAMP_SETS = ("prf", "farmland-atlas", "arc-plc")
_LIVE = {}


def live_page(root, rel):
    """True when root/rel is a published page that is not a pointer page."""
    key = (root, rel)
    if key not in _LIVE:
        f = os.path.join(root, rel)
        ok = os.path.isfile(f)
        if ok:
            with open(f, encoding="utf-8", errors="replace") as fh:
                ok = PP.MARKER not in fh.read(PP.MAX_BYTES * 2)
        _LIVE[key] = ok
    return _LIVE[key]


def rain_link(root, st_slug, st_name, county_slug, county_name):
    """The marked rain link for one county page (names are page text, already escaped)."""
    if live_page(root, f"rain/{st_slug}/{county_slug}.html"):
        return (f'<a data-xl="rain" href="/rain/{st_slug}/{county_slug}">Rain so far this year in '
                f'{county_name}, {st_name}</a>')
    return (f'<a data-xl="rain" data-n="{county_name}" href="/rain/{st_slug}">Rain so far this year in '
            f'{st_name}, county by county</a>')


def prf_href(root, st_slug, county_slug):
    rel = f"prf/{st_slug}/{county_slug}.html"
    return f"/prf/{st_slug}/{county_slug}" if live_page(root, rel) else None


def arc_href(root, st_slug, county_slug):
    rel = f"arc-plc/{st_slug}/{county_slug}.html"
    return f"/arc-plc/{st_slug}/{county_slug}" if live_page(root, rel) else None


# ---- the same-state row (Nov 10, 2026)
# (set id, label, the page file, its link): the order the row prints in
STATE_SETS = (
    ("cash-bids", "Cash bids", "cash-bids/{s}/index.html", "/cash-bids/{s}/"),
    ("rent", "Cash rent", "rent/{s}.html", "/rent/{s}"),
    ("yield", "Yield by year", "yield/{s}.html", "/yield/{s}"),
    ("farmland-atlas", "Farmland Atlas", "farmland-atlas/{s}/index.html", "/farmland-atlas/{s}/"),
    ("land-sales", "Farmland sales", "land-sales/{s}/index.html", "/land-sales/{s}/"),
    ("rain", "Rain by county", "rain/{s}.html", "/rain/{s}"),
    ("prf", "PRF pasture insurance", "prf/{s}.html", "/prf/{s}"),
    ("hail-map", "Hail map", "hail-map/{s}.html", "/hail-map/{s}"),
)
ROW_STYLE = "font-size:.85rem;line-height:1.8;margin:18px 0"


def same_state_links(root, st_slug, here):
    """[(label, href)] for every other state set with a live page for this state."""
    return [(lab, href.format(s=st_slug)) for sid, lab, f, href in STATE_SETS
            if sid != here and live_page(root, f.format(s=st_slug))]


def same_state_row(root, st_slug, st_name, here):
    """The one same-state row for a page of set `here` (st_name is page text, already escaped).
    '' when no other set has a page for this state."""
    links = same_state_links(root, st_slug, here)
    if not links:
        return ""
    a = " &middot; ".join(f'<a href="{h}">{lab}</a>' for lab, h in links)
    return (f'<nav class="xl-st" aria-label="Same state on AGSIST" style="{ROW_STYLE}">'
            f'<b>{st_name} on AGSIST:</b> {a}</nav>')


# ---- the breadcrumb trail (Nov 10, 2026)
SITE = "https://agsist.com"
TRAIL_STYLE = "min-height:1.4em;margin:14px 0 6px"


def crumbs_jsonld(items):
    """items: [(name, absolute url)], home first, this page last (names as plain text)."""
    return {"@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": i + 1, "name": n, "item": u} for i, (n, u) in enumerate(items)]}


def crumbs_html(items):
    """The visible trail for the same items: every step a link but the last, same names."""
    import html as H
    bits = []
    for i, (n, u) in enumerate(items):
        href = u[len(SITE):] if u.startswith(SITE) else u
        if i == len(items) - 1:
            bits.append(f'<span aria-current="page">{H.escape(n, quote=False)}</span>')
        else:
            bits.append(f'<a href="{H.escape(href or "/")}">{H.escape(n, quote=False)}</a>')
    return (f'<nav class="breadcrumb" aria-label="Breadcrumb" style="{TRAIL_STYLE}">'
            + " &rsaquo; ".join(bits) + "</nav>")


def crumbs_html_of(ld):
    """The visible trail read back from a page's JSON-LD (a dict with @graph, or a BreadcrumbList)."""
    nodes = ld.get("@graph", [ld]) if isinstance(ld, dict) else []
    bl = next((g for g in nodes if g.get("@type") == "BreadcrumbList"), None)
    return crumbs_html([(x["name"], x["item"]) for x in bl["itemListElement"]]) if bl else ""


def trail_matches(page):
    """None when the page's visible trail names the same steps, in order, as its BreadcrumbList JSON-LD;
    else what differs. A page with neither passes; one with only one of the two fails."""
    import html as H
    import json
    lds = []
    for m in re.finditer(r'<script type="application/ld\+json">(.*?)</script>', page, re.S):
        try:
            d = json.loads(m.group(1))
        except ValueError:
            continue
        for g in (d if isinstance(d, list) else d.get("@graph", [d])):
            if isinstance(g, dict) and g.get("@type") == "BreadcrumbList":
                lds.append([x["name"] for x in g["itemListElement"]])
    nav = re.search(r'<nav class="breadcrumb" aria-label="Breadcrumb"[^>]*>(.*?)</nav>', page, re.S)
    if not lds and not nav:
        return None
    if not nav or not lds:
        return "trail without JSON-LD" if nav else "JSON-LD without a visible trail"
    seen = [H.unescape(re.sub(r"<[^>]+>", "", s)).strip() for s in nav.group(1).split("&rsaquo;")]
    return None if seen == lds[0] else f"visible {seen} vs JSON-LD {lds[0]}"


def crumbs(items):
    """-> (visible html, BreadcrumbList dict) from one list."""
    return crumbs_html(items), crumbs_jsonld(items)


# ---- bids near this county (Nov 10, 2026)
NEAR_SETS = ("prf", "arc-plc")
NEAR_LEAD = "Bids near this county:"


def near_bids(root, fips, st_abbr, cls="xl-near"):
    """The marked line of town bid pages nearest the county middle; an empty hidden marker when none
    (so a later stamp can fill it)."""
    import nearest_towns as NT
    ctr = NT.county_center(root, fips)
    p = NT.links_html(root, ctr[0], ctr[1], st_abbr, NEAR_LEAD, cls) if ctr else ""
    tag = f'<p data-xl="near" data-f="{fips}" data-s="{st_abbr}"'
    if not p:
        return tag + " hidden></p>"
    return tag + p[2:]


_NEAR = re.compile(r'<p data-xl="near" data-f="(\d{5})" data-s="([A-Z]{2})"[^>]*>.*?</p>', re.S)


def steady(text):
    """A page's text with the bids-near line blanked: what a --check compares."""
    return _NEAR.sub(lambda m: f'<p data-xl="near" data-f="{m.group(1)}"></p>', text)


def restamp_near(text, root):
    """Rewrite every marked bids-near line in one page's text. -> (text, changed)."""
    new = _NEAR.sub(lambda m: near_bids(root, m.group(1), m.group(2)), text)
    return new, new != text


_A = re.compile(r'<a data-xl="rain"(?: data-n="([^"]*)")? href="/rain/([a-z0-9-]+)(?:/([a-z0-9-]+))?">'
                r'Rain so far this year in ([^<]*)</a>')


def restamp(text, root, county_slug):
    """Rewrite every marked rain link in one page's text. -> (text, changed)."""
    def sub(m):
        n, st_slug, cty, words = m.groups()
        if cty:
            mm = re.match(r"(.*), ([^,]+)$", words)
            if not mm:
                return m.group(0)
            name, st_name = mm.group(1), mm.group(2)
        else:
            mm = re.match(r"(.*), county by county$", words)
            if not mm or n is None:
                return m.group(0)
            name, st_name = n, mm.group(1)
        return rain_link(root, st_slug, st_name, cty or county_slug, name)
    new = _A.sub(sub, text)
    return new, new != text


def stamp(root=ROOT):
    """Every PRF, Atlas and ARC/PLC county page: its marked rain link as rain_link() says now, and on PRF and
    ARC/PLC pages the bids-near line as near_bids() says now."""
    _LIVE.clear()
    n_pages = n_changed = 0
    for top in STAMP_SETS:
        d = os.path.join(root, top)
        if not os.path.isdir(d):
            continue
        for st in sorted(os.listdir(d)):
            sd = os.path.join(d, st)
            if not os.path.isdir(sd):
                continue
            for fn in sorted(os.listdir(sd)):
                if not fn.endswith(".html"):
                    continue
                p = os.path.join(sd, fn)
                with open(p, encoding="utf-8") as fh:
                    t = fh.read()
                if 'data-xl="rain"' not in t and 'data-xl="near"' not in t:
                    continue
                n_pages += 1
                new, ch = restamp(t, root, fn[:-5])
                if top in NEAR_SETS and 'data-xl="near"' in new:
                    new, _ = restamp_near(new, root)
                    ch = new != t
                if ch:
                    with open(p, "w", encoding="utf-8") as fh:
                        fh.write(new)
                    n_changed += 1
    print(f"[cross-links] {n_pages} pages carry a rain or bids-near link; {n_changed} rewritten")
    return n_changed


def selftest():
    import tempfile
    fails = []

    def ok(c, m):
        if not c:
            fails.append(m)
    with tempfile.TemporaryDirectory() as d:
        def w(rel, s):
            os.makedirs(os.path.dirname(os.path.join(d, rel)), exist_ok=True)
            with open(os.path.join(d, rel), "w", encoding="utf-8") as fh:
                fh.write(s)
        w("rain/iowa/story-county.html", "<html><title>Story</title></html>")
        w("rain/iowa/adams-county.html", PP.page("/rain/iowa", "Adams County", "/rain/iowa"))
        _LIVE.clear()
        ok(live_page(d, "rain/iowa/story-county.html"), "a real page is live")
        ok(not live_page(d, "rain/iowa/adams-county.html"), "a pointer page is not live")
        ok(not live_page(d, "rain/iowa/polk-county.html"), "a missing page is not live")
        a = rain_link(d, "iowa", "Iowa", "story-county", "Story County")
        ok(a == '<a data-xl="rain" href="/rain/iowa/story-county">Rain so far this year in Story County, Iowa</a>', a)
        b = rain_link(d, "iowa", "Iowa", "adams-county", "Adams County")
        ok(b == '<a data-xl="rain" data-n="Adams County" href="/rain/iowa">Rain so far this year in Iowa, county by county</a>', b)
        # the rain set moves: Polk gets a page, Story drops to a pointer; the stamp follows both ways
        page_p = '<p class="note">' + rain_link(d, "iowa", "Iowa", "polk-county", "Polk County") + "</p>"
        page_s = '<p class="note">' + a + "</p>"
        w("rain/iowa/polk-county.html", "<html></html>")
        w("rain/iowa/story-county.html", PP.page("/rain/iowa", "Story County", "/rain/iowa"))
        _LIVE.clear()
        np_, cp = restamp(page_p, d, "polk-county")
        ok(cp and 'href="/rain/iowa/polk-county">Rain so far this year in Polk County, Iowa</a>' in np_, np_)
        ns, cs = restamp(page_s, d, "story-county")
        ok(cs and ns == '<p class="note"><a data-xl="rain" data-n="Story County" href="/rain/iowa">Rain so far this year in Iowa, '
                        'county by county</a></p>', ns)
        ok(restamp(np_, d, "polk-county") == (np_, False), "stamping twice changes nothing")
        # a name with an entity survives the round trip
        w("rain/new-mexico/dona-ana-county.html", "<html></html>")
        _LIVE.clear()
        x = rain_link(d, "new-mexico", "New Mexico", "dona-ana-county", "Do&ntilde;a Ana County")
        ok(restamp(x, d, "dona-ana-county") == (x, False), x)
        ok(prf_href(d, "iowa", "story-county") is None and arc_href(d, "iowa", "story-county") is None, "absent targets give no link")
        w("arc-plc/iowa/story-county.html", "<html></html>")
        _LIVE.clear()
        ok(arc_href(d, "iowa", "story-county") == "/arc-plc/iowa/story-county", "live ARC page links")
        # the whole-tree stamp writes only what moved
        w("prf/iowa/polk-county.html", page_p.replace("/rain/iowa/polk-county", "/rain/iowa").replace(
            'href="/rain/iowa">Rain so far this year in Polk County, Iowa', 'data-n="Polk County" href="/rain/iowa">Rain so far this year in Iowa, county by county'))
        ok(stamp(d) == 1 and 'href="/rain/iowa/polk-county"' in open(os.path.join(d, "prf/iowa/polk-county.html")).read(), "tree stamp")
        ok(stamp(d) == 0, "second tree stamp is a no-op")
        # the same-state row: live targets only, never the page's own set, pointers left out
        w("rent/iowa.html", "<html></html>")
        w("cash-bids/iowa/index.html", "<html></html>")
        w("hail-map/iowa.html", PP.page("/hail-map", "Iowa", "/hail-map"))
        _LIVE.clear()
        row = same_state_row(d, "iowa", "Iowa", "rent")
        ok(row.startswith('<nav class="xl-st" aria-label="Same state on AGSIST"') and '<b>Iowa on AGSIST:</b>' in row, row)
        ok('href="/cash-bids/iowa/">Cash bids</a>' in row and "/rent/iowa" not in row and "/hail-map/" not in row, row)
        ok(same_state_row(d, "ohio", "Ohio", "rent") == "", "no target, no row")
        ok([h for _, h in same_state_links(d, "iowa", "land-sales")] == ["/cash-bids/iowa/", "/rent/iowa"], "land sales sees both")
        # the trail and the JSON-LD from one list
        v, j = crumbs([("AGSIST", SITE + "/"), ("Cash bids", SITE + "/cash-bids"), ("Iowa", SITE + "/cash-bids/iowa/")])
        ok('<a href="/">AGSIST</a> &rsaquo; <a href="/cash-bids">Cash bids</a> &rsaquo; <span aria-current="page">Iowa</span>' in v, v)
        ok([x["name"] for x in j["itemListElement"]] == ["AGSIST", "Cash bids", "Iowa"], j)
        ok(crumbs_html_of({"@graph": [{"@type": "WebPage"}, j]}) == v and crumbs_html_of({"@graph": []}) == "", "trail read back from JSON-LD")
        # bids near this county: the nearest town pages from the Atlas point, a hidden marker when none
        import json as _j
        import nearest_towns as NT
        w("data/atlas/pct/IA.json", _j.dumps({"counties": {"19169": {"c": [42.04, -93.46]}, "19001": {"c": [41.33, -94.47]}}}))
        w("data/atlas/pct/SD.json", _j.dumps({"counties": {"46102": {"c": [43.33, -102.55]}}}))
        NT._CACHE.pop(("ctr", os.path.abspath(d)), None)
        NT._CACHE[os.path.abspath(d)] = [(42.03, -93.62, "Ames", "IA", "/cash-bids/iowa/ames"),
                                         (42.05, -93.40, "Nevada", "IA", "/cash-bids/iowa/nevada")]
        nb = near_bids(d, "19169", "IA")
        ok(nb.startswith('<p data-xl="near" data-f="19169" data-s="IA" class="xl-near">Bids near this county: '
                         '<a href="/cash-bids/iowa/nevada">Nevada</a> (3 mi), <a href="/cash-bids/iowa/ames">Ames</a>'), nb)
        ok(NT.county_center(d, "46113") == (43.33, -102.55), "an old code is folded onto the spine county")
        far = near_bids(d, "46113", "SD")
        ok(far == '<p data-xl="near" data-f="46113" data-s="SD" hidden></p>', far)
        ok(steady(nb) == steady(far.replace("46113", "19169").replace("SD", "IA")), "the check ignores the line")
        # a new town page lands: the stamp writes it, the check never notices
        w("arc-plc/iowa/story-county.html", "<main>" + far.replace("46113", "19169").replace("SD", "IA") + "</main>")
        _LIVE.clear()
        stamp(d)
        got = open(os.path.join(d, "arc-plc/iowa/story-county.html")).read()
        ok(nb in got, got)
        ok(restamp_near(got, d) == (got, False), "stamping twice changes nothing")
        ld = '<script type="application/ld+json">{"@graph": [%s]}</script>' % _j.dumps(j)
        ok(trail_matches(ld + v) is None, trail_matches(ld + v))
        ok(trail_matches(ld + v.replace(">Iowa<", ">Ohio<")) is not None and trail_matches(ld) is not None, "a mismatch is caught")
        ok("&amp;" in crumbs_html([("A", "/"), ("Corn & beans", "/x")]), "names are escaped")
    if fails:
        print("SELFTEST FAILED:\n  " + "\n  ".join(fails))
        sys.exit(1)
    print("cross_links selftest ok")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    elif "--stamp" in sys.argv:
        stamp()
    else:
        print(__doc__)
