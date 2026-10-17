#!/usr/bin/env python3
"""Where each fertilizer co-op we read sits, for "nearest co-op" lines.

Reads scripts/coop_fert_sources.json (co-op, town, state; the town comes only
from the co-op's own site) and data/elevator-coverage.json (town points from
dnilgis/bids, a town centroid, not a street address). Writes
data/fert-coop-places.json: one entry per co-op whose town matches a town
point in its state. A co-op with no town, or a town with no point, gets no
coordinates and is listed under "unplaced"; a page then prints no distance for
it. Nothing is guessed. No network.

  python3 scripts/build_coop_places.py           write the file
  python3 scripts/build_coop_places.py --check   exit 1 if the file is out of date
  python3 scripts/build_coop_places.py --selftest
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "scripts" / "coop_fert_sources.json"
COV = ROOT / "data" / "elevator-coverage.json"
OUT = ROOT / "data" / "fert-coop-places.json"


def town_points(cov):
    """{(state, TOWN): (lat, lng)} from the coverage places; first point wins
    for a town name seen twice in one state."""
    pts = {}
    for p in (cov or {}).get("places") or []:
        st, y, x = p.get("s"), p.get("y"), p.get("x")
        if not (isinstance(st, str) and isinstance(y, (int, float)) and isinstance(x, (int, float))):
            continue
        for a in p.get("a") or []:
            if isinstance(a, list) and len(a) > 1 and isinstance(a[1], str) and a[1].strip():
                pts.setdefault((st, a[1].strip().upper()), (round(y, 4), round(x, 4)))
    return pts


def build(sources, cov):
    pts = town_points(cov)
    coops, unplaced = {}, []
    for c in sources.get("coops") or []:
        cid, town, st = c.get("id"), c.get("town"), c.get("state")
        if not cid:
            continue
        p = pts.get((st, town.strip().upper())) if isinstance(town, str) and town.strip() else None
        if not p:
            unplaced.append(cid)
            continue
        coops[cid] = {"town": town.strip(), "state": st, "lat": p[0], "lng": p[1]}
    return {
        "note": "Built by scripts/build_coop_places.py from scripts/coop_fert_sources.json (town from the co-op's own site) "
                "and the town points in data/elevator-coverage.json (a town centroid, not the co-op's street address). "
                "Co-ops under unplaced have no town on file or no town point, so no distance is shown for them.",
        "coops": coops,
        "unplaced": sorted(unplaced),
    }


def selftest():
    cov = {"places": [{"y": 37.36661, "x": -95.01744, "s": "KS", "a": [["CoMark", "MCCUNE", "quiet"]]},
                      {"y": 40.0, "x": -90.0, "s": "IA", "a": [["X", "McCune", "read"]]}]}
    src = {"coops": [{"id": "a", "town": "McCune", "state": "KS"}, {"id": "b", "town": None, "state": "KS"},
                     {"id": "c", "town": "Nowhere", "state": "KS"}, {"id": "d", "town": "McCune", "state": "WI"}]}
    out = build(src, cov)
    assert out["coops"] == {"a": {"town": "McCune", "state": "KS", "lat": 37.3666, "lng": -95.0174}}, out
    assert out["unplaced"] == ["b", "c", "d"], out
    print("selftest ok")


def main(argv):
    if "--selftest" in argv:
        selftest()
        return 0
    out = build(json.loads(SRC.read_text()), json.loads(COV.read_text()))
    text = json.dumps(out, indent=1, ensure_ascii=False) + "\n"
    if "--check" in argv:
        cur = OUT.read_text() if OUT.exists() else ""
        if cur != text:
            print("data/fert-coop-places.json is out of date: run python3 scripts/build_coop_places.py")
            return 1
        print("fert-coop-places ok")
        return 0
    OUT.write_text(text)
    print(f"wrote {OUT.relative_to(ROOT)}: {len(out['coops'])} placed, {len(out['unplaced'])} unplaced")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
