#!/usr/bin/env python3
"""River key: is an elevator a river terminal, near a navigable waterway, or inland (Nov 9 2026).

Reads data/ids/elevators.json, the river inputs that river-pull.yml saved to the raw branch (river/docks.json:
USACE grain docks; river/waterways.json: National Waterway Network lines, simplified) and the bids repo's
data/directory.json (how each point was placed). Writes data/ids/river.json:

  river: {elevId: {"class": ..., "dock_mi": d, "water_mi": w}}  (or {"class": "unsure", "why": ...})
  rule, rule version, thresholds, both source dates, counts

THE RULE (river-key/1)
  Only a facility whose point is the site itself (the bids repo placed it from a street address,
  precision "street", and the point on elevators.json is that row's point) is classified:
    terminal   a USACE grain dock within 0.5 mile of the point
    near       not a terminal, and a National Waterway Network line within 10 miles
    inland     neither
  A point placed at the town or county centre, or one whose placing is not known, is "unsure" with the
  reason: a town centre can sit a mile from the river while the elevator is on the bank, or the other way
  round. It is never guessed. A facility with no point is left out and counted.
  Distances are straight-line miles (great circle to a dock; to a line, a flat projection around the
  point, good to well under 1% at 10 miles), two decimals. Nothing past 300 miles is searched (null).

No river inputs on disk (the one-time pull has not run): prints why, writes nothing, exits 0, so the last
river.json stays. The bids directory unreadable: exits 1, writes nothing.

Usage: python3 scripts/river_key.py [--river-dir river] [--bids-dir DIR] [--elevators FILE] [--out FILE]
       python3 scripts/river_key.py --selftest
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import argparse
import json
import math
import os
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RULE = "river-key/1"
TERMINAL_MI = 0.5
NEAR_MI = 10.0
MAX_MI = 300.0
CELL = 0.25          # grid cell, degrees
SAME_PT = 6e-5       # elevators.json rounds to 4 decimals, the bids directory to 5
NETWORK_BASE = os.environ.get("BIDS_NETWORK_BASE", "https://dnilgis.github.io/bids/")
MI_LAT = 69.0        # miles per degree of latitude
R_MI = 3958.8
WHY = {"town": "the point is the town centre, not the site",
       "county": "the point is the county centre, not the site",
       None: "how the point was placed is not known"}


# ------------------------------------------------------------------ inputs
def read_json(p):
    with open(p, encoding="utf-8") as fh:
        return json.load(fh)


def bids_directory(bids_dir):
    if bids_dir:
        return read_json(os.path.join(bids_dir, "data", "directory.json"))
    req = urllib.request.Request(NETWORK_BASE.rstrip("/") + "/data/directory.json",
                                 headers={"User-Agent": "agsist-ids (+agsist.com)", "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(req, timeout=180) as r:
        raw = r.read()
        if (r.headers.get("Content-Encoding") or "").lower() == "gzip":
            import gzip
            raw = gzip.decompress(raw)
    return json.loads(raw.decode("utf-8"))


def precision_of(fac, rows_by_id):
    """'street', 'town', 'county' or None: the precision of the bids-repo row whose point IS the facility's point."""
    for rid in (fac.get("sources") or {}).get("bids_repo") or []:
        r = rows_by_id.get(rid)
        if not r or r.get("lat") is None or r.get("lon") is None:
            continue
        if abs(r["lat"] - fac["lat"]) < SAME_PT and abs(r["lon"] - fac["lng"]) < SAME_PT:
            return r.get("precision")
    return None


# ------------------------------------------------------------------ geometry
def hav_mi(lat1, lng1, lat2, lng2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lng2 - lng1) / 2) ** 2
    return 2 * R_MI * math.asin(min(1.0, math.sqrt(a)))


def seg_mi(lat0, lng0, a, b):
    """Miles from (lat0, lng0) to segment a-b ([lng, lat] each), flat projection around the point."""
    k = math.cos(math.radians(lat0)) * MI_LAT
    ax, ay = (a[0] - lng0) * k, (a[1] - lat0) * MI_LAT
    bx, by = (b[0] - lng0) * k, (b[1] - lat0) * MI_LAT
    dx, dy = bx - ax, by - ay
    L = dx * dx + dy * dy
    t = 0.0 if L == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / L))
    return math.hypot(ax + t * dx, ay + t * dy)


def cell(lat, lng):
    return (math.floor(lat / CELL), math.floor(lng / CELL))


class Grid:
    def __init__(self):
        self.cells = {}

    def add_point(self, lat, lng, item):
        self.cells.setdefault(cell(lat, lng), []).append(item)

    def add_seg(self, a, b, item):
        (i0, j0), (i1, j1) = cell(min(a[1], b[1]), min(a[0], b[0])), cell(max(a[1], b[1]), max(a[0], b[0]))
        for i in range(i0, i1 + 1):
            for j in range(j0, j1 + 1):
                self.cells.setdefault((i, j), []).append(item)

    def nearest(self, lat, lng, dist):
        """Smallest dist(item) over items, searching rings of cells outward until no closer item can exist."""
        ci, cj = cell(lat, lng)
        best = None
        # a cell k rings out is at least (k - 1) cells away; a cell is narrowest east-west at the pole side
        narrow = CELL * MI_LAT * max(0.2, math.cos(math.radians(min(89.0, abs(lat) + CELL))))
        seen = set()
        k = 0
        while (k - 1) * narrow <= MAX_MI:
            if best is not None and (k - 1) * narrow > best:
                break
            for i in range(ci - k, ci + k + 1):
                for j in range(cj - k, cj + k + 1):
                    if max(abs(i - ci), abs(j - cj)) != k:
                        continue
                    for it in self.cells.get((i, j), ()):
                        if id(it) in seen:
                            continue
                        seen.add(id(it))
                        d = dist(it)
                        if best is None or d < best:
                            best = d
            k += 1
        return best if best is not None and best <= MAX_MI else None


def dock_grid(docks):
    g = Grid()
    for d in docks:
        g.add_point(d["lat"], d["lng"], (d["lat"], d["lng"]))
    return g


def line_grid(lines):
    g = Grid()
    for ln in lines:
        for path in ln.get("paths") or []:
            for a, b in zip(path, path[1:]):
                g.add_seg(a, b, (tuple(a), tuple(b)))
    return g


# ------------------------------------------------------------------ classify
def classify(elevators, rows_by_id, docks, lines):
    dg, lg = dock_grid(docks), line_grid(lines)
    out, counts = {}, {"terminal": 0, "near": 0, "inland": 0, "unsure": 0, "no_point": 0}
    for f in elevators:
        if f.get("lat") is None or f.get("lng") is None:
            counts["no_point"] += 1
            continue
        prec = precision_of(f, rows_by_id)
        if prec != "street":
            out[f["id"]] = {"class": "unsure", "why": WHY.get(prec, WHY[None])}
            counts["unsure"] += 1
            continue
        lat, lng = f["lat"], f["lng"]
        dmi = dg.nearest(lat, lng, lambda p: hav_mi(lat, lng, p[0], p[1]))
        wmi = lg.nearest(lat, lng, lambda s: seg_mi(lat, lng, s[0], s[1]))
        if dmi is not None and dmi <= TERMINAL_MI:
            c = "terminal"
        elif wmi is not None and wmi <= NEAR_MI:
            c = "near"
        else:
            c = "inland"
        counts[c] += 1
        out[f["id"]] = {"class": c, "dock_mi": None if dmi is None else round(dmi, 2),
                        "water_mi": None if wmi is None else round(wmi, 2)}
    return dict(sorted(out.items())), counts


def build(elev_doc, directory, docks_doc, lines_doc):
    rows = {r.get("id"): r for r in directory.get("elevators") or [] if r.get("id")}
    river, counts = classify(elev_doc.get("elevators") or [], rows, docks_doc.get("docks") or [],
                             lines_doc.get("lines") or [])
    ds, ls = docks_doc.get("source") or {}, lines_doc.get("source") or {}
    return {
        "schema": "agsist-river/1",
        "rule": RULE,
        "rule_text": (f"Classified only where the point is the site (placed from a street address). terminal: a USACE "
                      f"grain dock within {TERMINAL_MI} mile. near: a National Waterway Network line within "
                      f"{NEAR_MI:g} miles. inland: neither. A town or county centre point, or one whose placing is "
                      f"not known, is unsure. No point: left out."),
        "thresholds_mi": {"terminal": TERMINAL_MI, "near": NEAR_MI, "search": MAX_MI},
        "sources": {
            "docks": {"what": "USACE Navigation Data Center docks, grain-handling", "source_date": ds.get("source_date"),
                      "source_date_from": ds.get("source_date_from"), "fetched": (ds.get("fetched_utc") or "")[:10] or None,
                      "count": len(docks_doc.get("docks") or [])},
            "waterways": {"what": "National Waterway Network lines", "source_date": ls.get("source_date"),
                          "source_date_from": ls.get("source_date_from"), "fetched": (ls.get("fetched_utc") or "")[:10] or None,
                          "count": len(lines_doc.get("lines") or [])},
            "points": {"what": "elevator points and how each was placed (bids repo directory)",
                       "elevators_generated": elev_doc.get("generated")},
        },
        "counts": counts,
        "river": river,
    }


def write(doc, out):
    tmp = out + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(doc, fh, separators=(",", ":"), sort_keys=False)
        fh.write("\n")
    os.replace(tmp, out)


# ------------------------------------------------------------------ selftest
def selftest():
    ok = 0

    def check(cond, what):
        nonlocal ok
        if not cond:
            raise SystemExit(f"selftest FAILED: {what}")
        ok += 1

    # distances, worked by hand: 1 degree of latitude is 69.09 miles on a 3958.8-mile sphere
    check(abs(hav_mi(40, -90, 41, -90) - 69.09) < 0.01, hav_mi(40, -90, 41, -90))
    check(abs(seg_mi(40.0, -90.0, (-90.1, 40.1), (-89.9, 40.1)) - 6.9) < 1e-9, "0.1 degree north of a level line is 6.9 mi")
    check(abs(seg_mi(40.0, -90.0, (-89.8, 40.0), (-89.7, 40.0)) - 0.2 * math.cos(math.radians(40)) * 69) < 1e-9,
          "past the end of a segment the distance is to its end point")

    # thresholds: a dock 0.49 mi off is a terminal, 0.51 mi is not; a line 9.9 mi off is near, 10.1 is inland
    lat0, lng0 = 40.0, -90.0
    per_mi_lng = 1 / (math.cos(math.radians(lat0)) * MI_LAT)

    def fac(i, prec="street", rows=None):
        return {"id": i, "lat": lat0, "lng": lng0, "sources": {"bids_repo": rows if rows is not None else [i + "-row"]}}, \
               {"id": i + "-row", "lat": lat0, "lon": lng0, "precision": prec}
    cases = []
    for name, dock_off, line_off, prec, want in [
            ("t", 0.49, 0.3, "street", "terminal"), ("n", 0.51, 0.3, "street", "near"),
            ("n2", None, 9.9, "street", "near"), ("i", None, 10.1, "street", "inland"),
            ("u", 0.1, 0.1, "town", "unsure"), ("c", 0.1, 0.1, "county", "unsure"), ("x", 0.1, 0.1, None, "unsure")]:
        f, r = fac(name, prec)
        docks = [] if dock_off is None else [{"lat": lat0, "lng": lng0 + dock_off * per_mi_lng}]
        lines = [{"paths": [[[lng0 - 1, lat0 + line_off / 69.0], [lng0 + 1, lat0 + line_off / 69.0]]]}]
        got, counts = classify([f], {r["id"]: r}, docks, lines)
        cases.append((name, got[name]["class"], want))
        check(got[name]["class"] == want, f"{name}: {got[name]} (want {want})")
    # a street point that is NOT the row's point (the facility took another source's point) is unsure
    f, r = fac("m")
    r["lat"] += 0.01
    got, _ = classify([f], {r["id"]: r}, [{"lat": lat0, "lng": lng0}], [])
    check(got["m"] == {"class": "unsure", "why": WHY[None]}, got)
    # no point: left out and counted
    got, counts = classify([{"id": "z", "lat": None, "lng": None, "sources": {}}], {}, [], [])
    check(got == {} and counts["no_point"] == 1, counts)
    # nothing within the search: null distances, inland
    f, r = fac("far")
    got, _ = classify([f], {r["id"]: r}, [{"lat": 10.0, "lng": -60.0}], [])
    check(got["far"] == {"class": "inland", "dock_mi": None, "water_mi": None}, got)
    # the grid search finds the nearest across many cells (a line 40 miles away, far cells in between)
    f, r = fac("g")
    lines = [{"paths": [[[lng0 - 3, lat0 + 40 / 69.0], [lng0 + 3, lat0 + 40 / 69.0]]]},
             {"paths": [[[lng0 - 3, lat0 + 80 / 69.0], [lng0 + 3, lat0 + 80 / 69.0]]]}]
    got, _ = classify([f], {r["id"]: r}, [], lines)
    check(got["g"]["water_mi"] == 40.0 and got["g"]["class"] == "inland", got)
    # the output names the rule, both source dates and never a run time
    doc = build({"generated": "2026-11-09", "elevators": [f]}, {"elevators": [r]},
                {"source": {"source_date": "2025-06-01", "fetched_utc": "2026-11-10T01:00:00Z"}, "docks": []},
                {"source": {"source_date": "2024-12-01"}, "lines": lines})
    check(doc["rule"] == RULE and doc["sources"]["docks"]["source_date"] == "2025-06-01"
          and doc["sources"]["waterways"]["source_date"] == "2024-12-01" and doc["sources"]["docks"]["fetched"] == "2026-11-10", doc["sources"])
    check("generated" not in doc and "T" not in json.dumps(doc["sources"]["docks"]["fetched"]), "no run time in the file")
    print(f"river_key selftest: {ok} checks ok")
    return 0


def main():
    ap = argparse.ArgumentParser(description="Elevator river key: terminal, near, inland or unsure.")
    ap.add_argument("--river-dir", default=os.path.join(ROOT, "river"))
    ap.add_argument("--bids-dir", default=os.environ.get("BIDS_DIR"))
    ap.add_argument("--elevators", default=os.path.join(ROOT, "data", "ids", "elevators.json"))
    ap.add_argument("--out", default=os.path.join(ROOT, "data", "ids", "river.json"))
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    dp, lp = os.path.join(a.river_dir, "docks.json"), os.path.join(a.river_dir, "waterways.json")
    if not (os.path.exists(dp) and os.path.exists(lp)):
        print(f"[river] no river inputs in {a.river_dir} (river-pull.yml has not run); river.json left as it is")
        return 0
    try:
        directory = bids_directory(a.bids_dir)
    except Exception as e:  # noqa: BLE001
        print(f"::warning::river key: the bids directory is not readable ({type(e).__name__}); river.json left as it is")
        return 1
    doc = build(read_json(a.elevators), directory, read_json(dp), read_json(lp))
    write(doc, a.out)
    c = doc["counts"]
    print(f"RIVER-KEY terminal={c['terminal']} near={c['near']} inland={c['inland']} unsure={c['unsure']} no_point={c['no_point']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
