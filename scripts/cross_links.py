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
rain set changes week to week and those three builders do not run then, so
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

    python3 scripts/cross_links.py --stamp      rewrite the marked rain links in place
    python3 scripts/cross_links.py --selftest

Stdlib only.
"""
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
    """Every PRF, Atlas and ARC/PLC county page: its marked rain link as rain_link() says now."""
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
                if 'data-xl="rain"' not in t:
                    continue
                n_pages += 1
                new, ch = restamp(t, root, fn[:-5])
                if ch:
                    with open(p, "w", encoding="utf-8") as fh:
                        fh.write(new)
                    n_changed += 1
    print(f"[cross-links] {n_pages} pages carry a rain link; {n_changed} rewritten")
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
