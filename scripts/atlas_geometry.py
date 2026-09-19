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

WHAT A COUNTY IS CALLED
  135 of the 3,142 units in the 50 states are not called "County". Louisiana
  has 64 parishes; Alaska has boroughs, city-and-boroughs, municipalities and
  census areas; Virginia has 39 independent cities; Nevada has Carson City.
  Concatenating " County" onto the name prints "Acadia County, LA", and for
  Baltimore and St. Louis it prints the name of a DIFFERENT, real county.
  So the unit word is carried in the feature as `u`, and omitted when it is
  "County" — 135 features carry it, 3,007 do not.

FIPS VINTAGE
  The source is 2010. Five codes have moved since, and only two of the five are
  a rename this file can express:
    46113 Shannon SD      -> 46102 Oglala Lakota      (2015)  renamed here
    02270 Wade Hampton AK -> 02158 Kusilvak           (2015)  renamed here
    51515 Bedford city VA -> merged into 51019        (2013)  dropped here
    02261 Valdez-Cordova  -> split 02063 + 02066      (2019)  kept as 02261
    09001-09015 CT counties -> 09110-09190 regions    (2022)  kept as counties
  The last two are a split and a reshape, which a 1:1 map cannot hold. Sources
  disagree about which vintage they publish: NASS cash rents still emits the old
  Connecticut county codes (data/cash-rent/CT.json carries 09003-09015). So the
  fold happens at INGEST, not here — build_farmland_atlas.FIPS_ALIAS maps every
  code a source might emit onto the code this file carries, and anything that
  still does not match is named in the unmatched-FIPS report rather than guessed.

USAGE
  python scripts/atlas_geometry.py path/to/geojson-counties-fips.json
  python scripts/atlas_geometry.py --selftest
"""

import json
import os
import sys

from build_farmland_atlas import ATLAS_STATE_FIPS

OUT = "data/atlas/counties.geo.json"

# FIPS changes since the 2010 boundary vintage that are a 1:1 rename.
FIPS_RENAMED = {
    "46113": ("46102", "Oglala Lakota"),   # Shannon County SD -> Oglala Lakota County, 2015-05-01
    "02270": ("02158", "Kusilvak"),        # Wade Hampton Census Area AK -> Kusilvak, 2015-07-01
}

# Codes in the source that no longer name a place. Dropped, with the reason.
FIPS_RETIRED = {
    "51515": "Bedford city VA reverted to a town and merged into 51019 on 2013-07-01",
}

# Census LSAD -> the word that follows the name. "County" is the default and is
# not stored. The empty string is Carson City NV, whose name is already complete.
UNIT_OF_LSAD = {
    "County": "County",
    "Parish": "Parish",
    "Borough": "Borough",
    "CA": "Census Area",
    "Cty&Bor": "City and Borough",
    "Muny": "Municipality",
    "city": "City",
    "": "",
}


def rnd(coords):
    if isinstance(coords[0], (int, float)):
        return [round(coords[0], 3), round(coords[1], 3)]
    return [rnd(c) for c in coords]


def build(src):
    feats = []
    dropped = []
    for ft in src["features"]:
        fid = str(ft.get("id") or "").zfill(5)
        name = ft["properties"].get("NAME")
        lsad = ft["properties"].get("LSAD", "County")
        if fid in FIPS_RETIRED:
            dropped.append((fid, FIPS_RETIRED[fid]))
            continue
        if fid in FIPS_RENAMED:
            fid, name = FIPS_RENAMED[fid]   # a rename does not change the unit word
        if fid[:2] not in ATLAS_STATE_FIPS:
            continue
        if lsad not in UNIT_OF_LSAD:
            raise SystemExit(f"{fid} {name!r}: unknown LSAD {lsad!r}; add it to UNIT_OF_LSAD")
        props = {"name": name, "st": ATLAS_STATE_FIPS[fid[:2]]}
        unit = UNIT_OF_LSAD[lsad]
        if unit != "County":
            props["u"] = unit
        g = ft["geometry"]
        feats.append({"type": "Feature", "id": fid, "properties": props,
                      "geometry": {"type": g["type"], "coordinates": rnd(g["coordinates"])}})
    feats.sort(key=lambda f: f["id"])
    return {"type": "FeatureCollection",
            "source": "US Census cartographic boundary counties (via plotly/datasets geojson-counties-fips.json), coordinates rounded to 0.001 deg",
            "states": sorted(set(ATLAS_STATE_FIPS.values())),
            "retired": [f"{f}: {why}" for f, why in dropped],
            "features": feats}


def label(props):
    """The full display name. 'Story' -> 'Story County'; 'Acadia' -> 'Acadia Parish'."""
    u = props.get("u", "County")
    return f"{props['name']} {u}".strip()


def selftest():
    src = {"features": [
        {"id": "19001", "properties": {"NAME": "Adair", "LSAD": "County"}, "geometry": {"type": "Polygon", "coordinates": [[[-94.12345, 41.123456], [-94.1, 41.2], [-94.0, 41.1], [-94.12345, 41.123456]]]}},
        {"id": "72001", "properties": {"NAME": "Adjuntas", "LSAD": "Muno"}, "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]}},
        {"id": "46113", "properties": {"NAME": "Shannon", "LSAD": "County"}, "geometry": {"type": "Polygon", "coordinates": [[[-102.5, 43.2], [-102.4, 43.2], [-102.4, 43.3], [-102.5, 43.2]]]}},
        {"id": "48001", "properties": {"NAME": "Anderson", "LSAD": "County"}, "geometry": {"type": "MultiPolygon", "coordinates": [[[[-95.5, 31.5], [-95.4, 31.5], [-95.4, 31.6], [-95.5, 31.5]]]]}},
        {"id": "22001", "properties": {"NAME": "Acadia", "LSAD": "Parish"}, "geometry": {"type": "Polygon", "coordinates": [[[-92.4, 30.2], [-92.3, 30.2], [-92.3, 30.3], [-92.4, 30.2]]]}},
        {"id": "02110", "properties": {"NAME": "Juneau", "LSAD": "Cty&Bor"}, "geometry": {"type": "Polygon", "coordinates": [[[-134.4, 58.3], [-134.3, 58.3], [-134.3, 58.4], [-134.4, 58.3]]]}},
        {"id": "02270", "properties": {"NAME": "Wade Hampton", "LSAD": "CA"}, "geometry": {"type": "Polygon", "coordinates": [[[-163.0, 62.0], [-162.9, 62.0], [-162.9, 62.1], [-163.0, 62.0]]]}},
        {"id": "51510", "properties": {"NAME": "Alexandria", "LSAD": "city"}, "geometry": {"type": "Polygon", "coordinates": [[[-77.1, 38.8], [-77.0, 38.8], [-77.0, 38.9], [-77.1, 38.8]]]}},
        {"id": "51515", "properties": {"NAME": "Bedford", "LSAD": "city"}, "geometry": {"type": "Polygon", "coordinates": [[[-79.6, 37.3], [-79.5, 37.3], [-79.5, 37.4], [-79.6, 37.3]]]}},
        {"id": "32510", "properties": {"NAME": "Carson City", "LSAD": ""}, "geometry": {"type": "Polygon", "coordinates": [[[-119.8, 39.1], [-119.7, 39.1], [-119.7, 39.2], [-119.8, 39.1]]]}},
    ]}
    out = build(src)
    ids = [f["id"] for f in out["features"]]
    # Puerto Rico (72) is never an Atlas state, so 72001 is dropped whatever the dict holds.
    assert "72001" not in ids, ids
    # the retired Bedford city is dropped and named
    assert "51515" not in ids, ids
    assert out["retired"] == ["51515: Bedford city VA reverted to a town and merged into 51019 on 2013-07-01"], out["retired"]
    by = {f["id"]: f for f in out["features"]}
    assert by["19001"]["geometry"]["coordinates"][0][0] == [-94.123, 41.123]
    assert by["19001"]["properties"] == {"name": "Adair", "st": "IA"}, by["19001"]["properties"]
    assert by["48001"]["geometry"]["type"] == "MultiPolygon"
    # renames
    assert "46113" not in ids and by["46102"]["properties"]["name"] == "Oglala Lakota"
    assert "02270" not in ids and by["02158"]["properties"] == {"name": "Kusilvak", "st": "AK", "u": "Census Area"}, by.get("02158", {}).get("properties")
    # the unit word, and only when it is not "County"
    assert "u" not in by["19001"]["properties"]
    assert by["22001"]["properties"]["u"] == "Parish"
    assert by["02110"]["properties"]["u"] == "City and Borough"
    assert by["51510"]["properties"]["u"] == "City"
    assert by["32510"]["properties"]["u"] == ""
    assert label(by["19001"]["properties"]) == "Adair County"
    assert label(by["22001"]["properties"]) == "Acadia Parish"
    assert label(by["02110"]["properties"]) == "Juneau City and Borough"
    assert label(by["51510"]["properties"]) == "Alexandria City"
    assert label(by["32510"]["properties"]) == "Carson City"
    # an LSAD nobody has mapped must stop the build, never be guessed
    bad = {"features": [{"id": "19003", "properties": {"NAME": "X", "LSAD": "Twp"}, "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]}}]}
    try:
        build(bad)
    except SystemExit as e:
        assert "unknown LSAD" in str(e), e
    else:
        raise AssertionError("an unknown LSAD must stop the build")
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
    units = {}
    for ft in out["features"]:
        units[ft["properties"].get("u", "County")] = units.get(ft["properties"].get("u", "County"), 0) + 1
    print(f"wrote {OUT}: {len(out['features'])} counties in {len(out['states'])} states, {os.path.getsize(OUT):,} bytes")
    for u, n in sorted(units.items(), key=lambda kv: -kv[1]):
        print(f"  {u or '(no unit word)'}: {n}")
    for line in out["retired"]:
        print(f"  retired {line}")


if __name__ == "__main__":
    main()
