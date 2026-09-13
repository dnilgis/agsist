#!/usr/bin/env python3
"""
atlas_geometry.py — data/atlas/counties.geo.json, built once, shipped as a file.

The Atlas draws its own ground (standing decision 2026-09-06: no tile vendor,
no CDN geometry). This script reads a county GeoJSON with 5-digit FIPS ids —
the US Census cartographic boundary file as republished by plotly/datasets
(geojson-counties-fips.json, 2010 vintage, 20m resolution) — keeps the Atlas
states, rounds coordinates to three decimals (about 110 m, more than enough at
county scale) and writes a compact file the page can fetch.

It is NOT run by the workflow. Geometry does not change; the runner has no
reason to fetch it monthly. Re-run by hand only when a state is added.

USAGE
  python scripts/atlas_geometry.py path/to/geojson-counties-fips.json
  python scripts/atlas_geometry.py --selftest
"""

import json
import os
import sys

from build_farmland_atlas import ATLAS_STATE_FIPS

OUT = "data/atlas/counties.geo.json"

# FIPS changes since the 2010 boundary vintage. NASS and RMA use the new code.
FIPS_RENAMED = {"46113": ("46102", "Oglala Lakota")}   # Shannon County SD -> Oglala Lakota County, 2015-05-01


def rnd(coords):
    if isinstance(coords[0], (int, float)):
        return [round(coords[0], 3), round(coords[1], 3)]
    return [rnd(c) for c in coords]


def build(src):
    feats = []
    for ft in src["features"]:
        fid = str(ft.get("id") or "").zfill(5)
        name = ft["properties"].get("NAME")
        if fid in FIPS_RENAMED:
            fid, name = FIPS_RENAMED[fid]
        if fid[:2] not in ATLAS_STATE_FIPS:
            continue
        g = ft["geometry"]
        feats.append({"type": "Feature", "id": fid,
                      "properties": {"name": name, "st": ATLAS_STATE_FIPS[fid[:2]]},
                      "geometry": {"type": g["type"], "coordinates": rnd(g["coordinates"])}})
    feats.sort(key=lambda f: f["id"])
    return {"type": "FeatureCollection",
            "source": "US Census cartographic boundary counties (via plotly/datasets geojson-counties-fips.json), coordinates rounded to 0.001 deg",
            "states": sorted(set(ATLAS_STATE_FIPS.values())),
            "features": feats}


def selftest():
    src = {"features": [
        {"id": "19001", "properties": {"NAME": "Adair"}, "geometry": {"type": "Polygon", "coordinates": [[[-94.12345, 41.123456], [-94.1, 41.2], [-94.0, 41.1], [-94.12345, 41.123456]]]}},
        {"id": "01001", "properties": {"NAME": "Autauga"}, "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]}},
        {"id": "46113", "properties": {"NAME": "Shannon"}, "geometry": {"type": "Polygon", "coordinates": [[[-102.5, 43.2], [-102.4, 43.2], [-102.4, 43.3], [-102.5, 43.2]]]}},
        {"id": "48001", "properties": {"NAME": "Anderson"}, "geometry": {"type": "MultiPolygon", "coordinates": [[[[-95.5, 31.5], [-95.4, 31.5], [-95.4, 31.6], [-95.5, 31.5]]]]}},
    ]}
    out = build(src)
    assert [f["id"] for f in out["features"]] == ["19001", "46102", "48001"], out
    assert out["features"][0]["geometry"]["coordinates"][0][0] == [-94.123, 41.123]
    assert out["features"][0]["properties"] == {"name": "Adair", "st": "IA"}
    assert out["features"][2]["geometry"]["type"] == "MultiPolygon"
    assert out["features"][1]["properties"]["name"] == "Oglala Lakota"
    print("selftest ok")


def main():
    if "--selftest" in sys.argv:
        selftest()
        return
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    with open(sys.argv[1], encoding="utf-8") as f:
        src = json.load(f)
    out = build(src)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"wrote {OUT}: {len(out['features'])} counties, {os.path.getsize(OUT):,} bytes")


if __name__ == "__main__":
    main()
