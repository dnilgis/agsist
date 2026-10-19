#!/usr/bin/env python3
"""Real bids-network rows for test/here-first.test.mjs (Oct 19, 2026).

From a local clone of dnilgis/bids at commit f64b07c8b (data/merged-index.json generated
2026-10-19T00:57:03Z, and the place shards of that commit): the places within 80 miles of
Chetek WI, Champaign IL and Great Bend KS, trimmed to the fields /here reads, and the shards of
the places within 30 miles, trimmed to their corn and soybean rows. Nothing is edited.

  python3 test/fixtures/here-first/make_fixtures.py /home/user/bids
"""
import json, math, os, subprocess, sys

BIDS = sys.argv[1] if len(sys.argv) > 1 else "/home/user/bids"
REV = "f64b07c8b"
HERE = os.path.dirname(os.path.abspath(__file__))
PTS = {"chetek": (45.31413, -91.651), "champaign": (40.1164, -88.2434), "greatbend": (38.36446, -98.76481)}
KEEP = ["place", "shard", "operator", "branch", "city", "town", "state", "lat", "lon", "elevId", "fips", "currency", "zip", "now", "pricedAt"]


def miles(a, b, c, d):
    r = math.pi / 180
    h = math.sin((c - a) * r / 2) ** 2 + math.cos(a * r) * math.cos(c * r) * math.sin((d - b) * r / 2) ** 2
    return 2 * 3958.8 * math.asin(min(1, math.sqrt(h)))


def show(path):
    return subprocess.run(["git", "-C", BIDS, "show", f"{REV}:{path}"], capture_output=True, check=True).stdout


idx = json.loads(show("data/merged-index.json"))
places, shards = [], {}
for p in idx["places"]:
    if not isinstance(p.get("lat"), (int, float)) or not isinstance(p.get("lon"), (int, float)):
        continue
    d = min(miles(a, b, p["lat"], p["lon"]) for a, b in PTS.values())
    if d > 80:
        continue
    places.append({k: p.get(k) for k in KEEP})
    if d <= 30 and p.get("shard"):
        sh = json.loads(show("data/" + p["shard"]))
        sh["bids"] = [{k: b.get(k) for k in ("crop", "period", "delivery", "cash", "basisCents", "futuresMonth", "stale")}
                      for b in sh.get("bids", []) if b.get("crop") in ("corn", "soybeans")]
        shards[p["shard"]] = {k: sh.get(k) for k in ("schema", "place", "elevId", "bids")}
out = {"from": f"dnilgis/bids {REV} data/merged-index.json", "generated": idx["generated"], "places": places}
json.dump(out, open(os.path.join(HERE, "index.json"), "w"), separators=(",", ":"))
json.dump(shards, open(os.path.join(HERE, "shards.json"), "w"), separators=(",", ":"))
print(len(places), "places,", len(shards), "shards")
