#!/usr/bin/env python3
"""nearest_towns.py -- the town cash-bid pages nearest a point, for the county pages
(Farmland Atlas and rain) to link down to (Oct 23, 2026).

Only town pages that exist in the checkout and are indexable (cash-bids/<state>/<town>.html,
not the state index, not noindex) are ever returned. A town's point comes from the same
files the site search uses (build_search_index.town_points: the ZIP grid, the elevator
coverage towns, rain-gauge town names), so a town page with no known point is simply not
offered. Nothing is fetched. No prices are read: a link and a distance, nothing that moves
daily except which towns have a page.

    nearest(root, lat, lon, k=3, max_mi=60) -> [{"name", "st", "url", "mi"}]
    links_html(root, lat, lon, county_state, lead) -> '<p>...</p>' or ''
"""
import glob
import html
import math
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

TOWN_T = re.compile(r"Cash Grain Bids in (.+), ([A-Z]{2}) Today")
MAX_MI = 60
_CACHE = {}


def _miles(a_lat, a_lon, b_lat, b_lon):
    r = math.pi / 180
    x = (math.sin((b_lat - a_lat) * r / 2) ** 2
         + math.cos(a_lat * r) * math.cos(b_lat * r) * math.sin((b_lon - a_lon) * r / 2) ** 2)
    return 3958.8 * 2 * math.asin(math.sqrt(x))


def towns(root):
    """[(lat, lon, name, ST, url)] for every indexable town page with a known point."""
    root = os.path.abspath(root)
    if root in _CACHE:
        return _CACHE[root]
    import build_search_index as B
    old = B.ROOT
    B.ROOT = root
    try:
        pts = B.town_points()
    finally:
        B.ROOT = old
    out = []
    for f in sorted(glob.glob(os.path.join(root, "cash-bids", "*", "*.html"))):
        rel = os.path.relpath(f, root).replace(os.sep, "/")
        if rel.endswith("/index.html"):
            continue
        with open(f, encoding="utf-8") as fh:
            head = fh.read(8000)
        if re.search(r'<meta[^>]+name="robots"[^>]+noindex', head, re.I):
            continue
        t = re.search(r"<title>(.*?)</title>", head, re.S)
        m = TOWN_T.search(html.unescape(t.group(1))) if t else None
        if not m:
            continue
        name, st = re.sub(r"\s+", " ", m.group(1)).strip(), m.group(2)
        p = pts.get((name.lower(), st))
        if p:
            out.append((p[1], p[2], name, st, "/" + rel[:-5]))
    _CACHE[root] = out
    return out


def nearest(root, lat, lon, k=3, max_mi=MAX_MI):
    if lat is None or lon is None:
        return []
    c = sorted((_miles(lat, lon, t[0], t[1]), t) for t in towns(root))
    return [{"name": t[2], "st": t[3], "url": t[4], "mi": d} for d, t in c if d <= max_mi][:k]


def links_html(root, lat, lon, county_state, lead, cls=""):
    """One sentence: lead, then up to 3 town links with the distance from the county middle.
    '' when no town page is within MAX_MI."""
    near = nearest(root, lat, lon)
    if not near:
        return ""
    bits = []
    for n in near:
        lab = n["name"] + ("" if n["st"] == county_state else ", " + n["st"])
        bits.append('<a href="%s">%s</a> (%d mi)' % (html.escape(n["url"]), html.escape(lab), max(1, round(n["mi"]))))
    return '<p%s>%s %s.</p>' % (' class="%s"' % cls if cls else "", lead, ", ".join(bits))
