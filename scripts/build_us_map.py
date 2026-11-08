#!/usr/bin/env python3
"""build_us_map.py: the one shared US states map, drawn once (Nov 8, 2026).

WHY. The state tile grid (squares labelled AK, WA, ...) was copied onto five pages. They now draw a real map from this
one file: data/us-states-map.svg, read by components/usmap.js.

WHAT IT MAKES. data/us-states-map.svg: the 50 states and DC in an Albers USA projection (lower 48 equal-area conic,
Alaska and Hawaii as insets, the same layout d3.geoAlbersUsa uses), taken from vendor/us-atlas-3.0.1 (Census cartographic
boundaries, public domain). One <path id="IL" data-n="Illinois" data-c="x,y" d="..."/> per state: id is the USPS code,
data-c is where its label goes, data-o (small states only) is the middle of its leader-line label out in the water.
Paths are simplified along each shared border once, so neighbours still meet. Nothing is fetched at run time.

RUN BY HAND, ONLY WHEN THE SHAPES CHANGE (needs shapely, for the label points; the output is committed):
    python3 scripts/build_us_map.py
test/us-map.test.mjs holds the committed file to its size, to 51 states once each and to the label rules.
"""
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _argguard  # noqa: E402
_argguard.guard(__file__)

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "vendor" / "us-atlas-3.0.1" / "counties-10m.json"
OUT = ROOT / "data" / "us-states-map.svg"
TOL = 0.55          # simplification tolerance, in map units (the map is about 1000 wide)
MIN_RING = 6.0      # a ring smaller than this (square units) is dropped unless it is the state's biggest

FIPS = {"01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC",
        "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY",
        "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT",
        "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH",
        "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT",
        "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY"}
# Small states get their label out in the water with a leader line (data-o, in final map units).
SMALL = ("VT", "NH", "MA", "RI", "CT", "NJ", "DE", "MD", "DC")


def conic(lat0, lat1, rot, center, scale, tx, ty):
    """d3.geoConicEqualArea: returns f(lon, lat) -> (x, y) in screen units (y down)."""
    r0, r1 = math.radians(lat0), math.radians(lat1)
    n = (math.sin(r0) + math.sin(r1)) / 2
    c = 1 + math.sin(r0) * (2 * n - math.sin(r0))
    rho0 = math.sqrt(c) / n

    def raw(lam, phi):
        r = math.sqrt(max(0.0, c - 2 * n * math.sin(phi))) / n
        return r * math.sin(lam * n), rho0 - r * math.cos(lam * n)

    def rotlon(lon):
        lam = lon + rot
        while lam > 180:
            lam -= 360
        while lam < -180:
            lam += 360
        return math.radians(lam)
    cx, cy = raw(math.radians(center[0]), math.radians(center[1]))

    def f(lon, lat):
        x, y = raw(rotlon(lon), math.radians(lat))
        return tx + scale * (x - cx), ty - scale * (y - cy)
    return f


def projections():
    k, x, y = 1070.0, 480.0, 250.0
    return {
        "lower": conic(29.5, 45.5, 96, (-0.6, 38.7), k, x, y),
        "AK": conic(55, 65, 154, (-2, 58.5), k * 0.35, x - 0.307 * k, y + 0.201 * k),
        "HI": conic(8, 18, 157, (-3, 19.9), k, x - 0.205 * k, y + 0.212 * k),
    }


def dp(pts, tol):
    """Douglas-Peucker on a list of (x, y); the two ends stay."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a]
        bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        ln = math.hypot(dx, dy)
        best, bi = -1.0, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            d = (abs(dy * (px - ax) - dx * (py - ay)) / ln) if ln else math.hypot(px - ax, py - ay)
            if d > best:
                best, bi = d, i
        if best > tol:
            keep[bi] = True
            stack.append((a, bi))
            stack.append((bi, b))
    return [p for p, kp in zip(pts, keep) if kp]


def area(ring):
    return sum(ring[i][0] * ring[(i + 1) % len(ring)][1] - ring[(i + 1) % len(ring)][0] * ring[i][1]
               for i in range(len(ring))) / 2


def load():
    t = json.load(open(SRC, encoding="utf-8"))
    sx, sy = t["transform"]["scale"]
    tx, ty = t["transform"]["translate"]
    arcs = []
    for a in t["arcs"]:
        x = y = 0
        out = []
        for dx, dy in a:
            x += dx
            y += dy
            out.append((x * sx + tx, y * sy + ty))
        arcs.append(out)
    return t, arcs


def build():
    t, arcs = load()
    proj = projections()
    geoms = [g for g in t["objects"]["states"]["geometries"] if g["id"] in FIPS]
    assert len(geoms) == 51, len(geoms)
    use = {}
    for g in geoms:
        st = FIPS[g["id"]]
        p = proj["AK"] if st == "AK" else proj["HI"] if st == "HI" else proj["lower"]
        polys = g["arcs"] if g["type"] == "MultiPolygon" else [g["arcs"]]
        for poly in polys:
            for ring in poly:
                for i in ring:
                    use.setdefault(i if i >= 0 else ~i, p)
    done = {}

    def arc(i):
        if i not in done:
            pts = [use[i](lon, lat) for lon, lat in arcs[i]]
            done[i] = dp(pts, TOL)
        return done[i]

    def ring_pts(ring):
        pts = []
        for i in ring:
            a = arc(i) if i >= 0 else arc(~i)[::-1]
            pts.extend(a if not pts else a[1:])
        return pts

    states = {}
    for g in geoms:
        st = FIPS[g["id"]]
        polys = g["arcs"] if g["type"] == "MultiPolygon" else [g["arcs"]]
        rings = []
        for poly in polys:
            outer = ring_pts(poly[0])
            holes = [ring_pts(r) for r in poly[1:]]
            rings.append((outer, holes))
        rings.sort(key=lambda r: -abs(area(r[0])))
        big = rings[0]
        kept = [r for r in rings if abs(area(r[0])) >= MIN_RING or r is big]
        if st == "AK":   # the Aleutians west of the frame run far off the page: keep the rings that sit inside it
            kept = [r for r in kept if min(p[0] for p in r[0]) > -120 and max(p[1] for p in r[0]) < 640]
        states[st] = {"name": None, "rings": kept}
    return states


def label_point(rings):
    from shapely.geometry import Polygon
    from shapely.ops import polylabel
    best = max(rings, key=lambda r: abs(area(r[0])))
    poly = Polygon(best[0], best[1])
    if not poly.is_valid:
        poly = poly.buffer(0)
    p = polylabel(poly, tolerance=0.5)
    return p.x, p.y


def fmt(v):
    s = ("%.1f" % v).rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def path_d(rings):
    out = []
    for outer, holes in rings:
        for r in [outer] + holes:
            if len(r) < 3:
                continue
            x0, y0 = r[0]
            seg = ["M" + fmt(x0) + " " + fmt(y0)]
            px, py = round(x0, 1), round(y0, 1)
            for x, y in r[1:]:
                qx, qy = round(x, 1), round(y, 1)
                if (qx, qy) == (px, py):
                    continue
                seg.append("l" + fmt(qx - px) + " " + fmt(qy - py))
                px, py = qx, qy
            out.append("".join(seg) + "z")
    return "".join(out)


NAMES = {"AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado",
         "CT": "Connecticut", "DE": "Delaware", "DC": "District of Columbia", "FL": "Florida", "GA": "Georgia",
         "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
         "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts",
         "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri", "MT": "Montana",
         "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico",
         "NY": "New York", "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
         "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota",
         "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington",
         "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming"}


def main():
    states = build()
    xs = [p[0] for s in states.values() for r in s["rings"] for p in r[0]]
    ys = [p[1] for s in states.values() for r in s["rings"] for p in r[0]]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    pad = 6
    # Make room on the right for the leader-line labels of the small states.
    gutter = 136
    ox, oy = pad - x0, pad - y0
    W = (x1 - x0) + 2 * pad + gutter
    H = (y1 - y0) + 2 * pad
    lab = {}
    for st, s in states.items():
        s["rings"] = [([(x + ox, y + oy) for x, y in o], [[(x + ox, y + oy) for x, y in h] for h in hs]) for o, hs in s["rings"]]
        lab[st] = label_point(s["rings"])
    # Out-of-map labels, two columns in the water: New England north to south in the outer one (right of Maine),
    # the mid-Atlantic four in the inner one below it. Rows are 66 apart so a chip is about 24 px on a 390 px phone.
    step = 66
    xo, xi = W - pad - 34, W - pad - 118
    out = {}
    for i, st in enumerate(["VT", "NH", "MA", "RI", "CT"]):
        out[st] = (xo, 40 + i * step)
    for i, st in enumerate(["NJ", "DE", "MD", "DC"]):
        out[st] = (xi, 40 + 5 * step + 8 + i * step)
    H = max(H, 40 + 9 * step + 8 + 34)
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %s %s" width="%s" height="%s">' % (fmt(W), fmt(H), fmt(W), fmt(H))]
    for st in sorted(states):
        a = 'id="%s" data-n="%s" data-c="%s,%s"' % (st, NAMES[st], fmt(lab[st][0]), fmt(lab[st][1]))
        if st in out:
            a += ' data-o="%s,%s"' % (fmt(out[st][0]), fmt(out[st][1]))
        parts.append("<path %s d=\"%s\"/>" % (a, path_d(states[st]["rings"])))
    parts.append("</svg>")
    OUT.write_text("\n".join(parts) + "\n", encoding="utf-8")
    print("wrote %s: %d bytes, viewBox %sx%s" % (OUT.relative_to(ROOT), OUT.stat().st_size, fmt(W), fmt(H)))


if __name__ == "__main__":
    main()
