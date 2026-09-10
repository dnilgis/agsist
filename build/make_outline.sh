#!/usr/bin/env bash
# Rebuild data/us-states.geo.json — the basemap.
#
# NO TILE VENDOR. This file IS the background map on /elevators and /hail-map.
# CARTO changed terms in September 2026 and began serving a watermarked
# "API KEY REQUIRED" tile with a 200 status, which walked straight past both
# the page's tileerror guard and basemap-checks. Esri's keyless endpoints are
# the same arrangement one repricing behind. This removes the vendor.
#
# Source: Natural Earth 1:50m admin-1 states and provinces, PUBLIC DOMAIN —
# no attribution required, no licence, no key, no terms to change.
#
# US AND CANADA, and Canada is not decoration. The network carries three
# Ontario elevators (Addis Grain, Sharedon Farms at Owen Sound, and Wanstead
# Farmers Cooperative). All three are unplaced today, so nothing is drawn north
# of 48.95N — but the moment one is geocoded it must land on a province and not
# on a void. scripts/build_coverage_map.mjs asserts exactly that.
#
# Mexico is absent because Natural Earth's admin-1 file carries subdivisions
# for nine countries only and Mexico is not among them. Nothing in the network
# is south of 26.11N, so the map stops at the border, which is honest.
#
#   bash build/make_outline.sh
#
# Needs node + npx. Re-running it on the same input gives the same bytes.
set -euo pipefail
SRC="https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_1_states_provinces_lakes.geojson"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
curl -sSf -o "$TMP/ne50.geojson" "$SRC"

# 20% keeps the Great Lakes and the coastlines readable at zoom 9, which is as
# far in as the map goes. keep-shapes stops small features collapsing entirely.
npx --yes mapshaper "$TMP/ne50.geojson" \
  -filter '["US","CA"].indexOf(iso_a2) > -1' \
  -filter-fields name,postal,iso_a2 \
  -simplify 20% keep-shapes \
  -o precision=0.001 format=geojson "$TMP/out.json"

python3 - "$TMP/out.json" data/us-states.geo.json <<'PY'
import json, sys
src, dst = sys.argv[1], sys.argv[2]
d = json.load(open(src))
# Sorted and separator-normalised so the file is byte-stable across rebuilds
# and a diff shows a real boundary change rather than key ordering.
d["features"].sort(key=lambda f: (f["properties"].get("iso_a2") or "",
                                  f["properties"].get("name") or ""))
lat = [c[1] for f in d["features"] for part in
       (f["geometry"]["coordinates"] if f["geometry"]["type"] == "MultiPolygon"
        else [f["geometry"]["coordinates"]]) for ring in part for c in ring]
lon = [c[0] for f in d["features"] for part in
       (f["geometry"]["coordinates"] if f["geometry"]["type"] == "MultiPolygon"
        else [f["geometry"]["coordinates"]]) for ring in part for c in ring]
d["bbox"] = [round(min(lon), 3), round(min(lat), 3),
             round(max(lon), 3), round(max(lat), 3)]
json.dump(d, open(dst, "w"), separators=(",", ":"), sort_keys=True)
print(f"wrote {dst}: {len(d['features'])} features, bbox {d['bbox']}")
PY
