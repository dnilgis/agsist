#!/usr/bin/env python3
"""Our own place lookup: ZIP codes and town names to a point (2026-10-29).

WHY THIS EXISTS
    Every ZIP box and town box on the site asked Open-Meteo's geocoder. Open-Meteo's
    terms count ad-supported sites as commercial use and Sig declined the paid key
    (STANDING-DECISIONS, Oct 29), so the lookup moves onto files we serve ourselves.
    components/places.js reads them and answers in the shape the pages already used
    ({results: [{name, latitude, longitude, admin1, admin2, country_code, postcodes}]}).

WHAT IT WRITES (data/places/, static; run it when a source package is updated)
    zip/<first two digits>.json  {"54728": [45.317, -91.6542, "Chetek", "WI", "Barron"], ...}
        The first two items are the same [lat, lon] the bids repo's data/zips/ shards hold
        (same package, same version), so a ZIP lands on the same point on every page.
    us/<key>.json, ca/<key>.json  {"p": [[name, st, lat, lon, county, pop, "zip zip", src], ...]}
        <key> is the first two letters of the folded name (see fold()); src "g" is a
        GeoNames town point, "z" a town known only from its ZIP codes (the point is the
        middle of those ZIP points, labeled as such by the pages that care).
    index.json  counts, sources, built date.

SOURCES (all free to reuse; credited where the pages show a place)
    ZIP codes, primary town, county, coordinates: the `zipcodes` Python package, pinned
        (pip install zipcodes==3.0.0), the same table dnilgis/bids builds data/zips/ from.
        Its coordinates are GeoNames postal-code points (CC BY 4.0); town and county come
        from the USPS-based table it bundles.
    Towns: GeoNames cities500 (CC BY 4.0), the file bundled in the npm package
        cities-500-structured@1.0.1, plus GeoNames cities1000 with seats of government
        from the npm package cities.json@1.1.65 (more Canadian towns).
    County of a town point: our own data/atlas/counties.geo.json (point in polygon).

    python3 scripts/build_places.py --cities500 <cities500.txt> --cities-json <cities.json>
    python3 scripts/build_places.py ... --dry      counts only
    python3 scripts/build_places.py --selftest
"""
import argparse
import datetime
import json
import math
import os
import re
import sys
import unicodedata
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "places")
COUNTIES = os.path.join(ROOT, "data", "atlas", "counties.geo.json")

US_STATES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado",
    "CT": "Connecticut", "DE": "Delaware", "DC": "District of Columbia", "FL": "Florida", "GA": "Georgia",
    "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
    "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts",
    "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri", "MT": "Montana",
    "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico",
    "NY": "New York", "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
    "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota",
    "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington",
    "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming", "PR": "Puerto Rico",
}
# GeoNames admin1 codes for Canada -> postal abbreviation
CA_PROV = {"01": "AB", "02": "BC", "03": "MB", "04": "NB", "05": "NL", "07": "NS", "08": "ON", "09": "PE",
           "10": "QC", "11": "SK", "12": "YT", "13": "NT", "14": "NU"}
KEEP_FEATURES = {"PPL", "PPLA", "PPLA2", "PPLA3", "PPLA4", "PPLC", "PPLL", "PPLS", "PPLF", "PPLG", "PPLR"}
COUNTY_SUFFIX = re.compile(r"\s+(County|Parish|Borough|Census Area|City and Borough|Municipality)$")


def fold(name):
    """The search key: accents dropped, lower case, St./Ste./Mt./Ft. spelled out, letters only.
    components/places.js folds what a reader types the same way (test/places.test.mjs)."""
    s = unicodedata.normalize("NFKD", str(name or "")).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[-'’.,]", " ", s)
    s = re.sub(r"\bste\s+", "sainte ", s)
    s = re.sub(r"\bst\s+", "saint ", s)
    s = re.sub(r"\bmt\s+", "mount ", s)
    s = re.sub(r"\bft\s+", "fort ", s)
    return re.sub(r"[^a-z]", "", s)


def shard_key(k):
    return (k + "__")[:2] if k else "__"


def miles(a, b, c, d):
    p = math.pi / 180
    h = math.sin((c - a) * p / 2) ** 2 + math.cos(a * p) * math.cos(c * p) * math.sin((d - b) * p / 2) ** 2
    return 2 * 3958.8 * math.asin(min(1, math.sqrt(h)))


def county_name(s):
    return COUNTY_SUFFIX.sub("", str(s or "").strip())


class CountyFinder:
    """Point in county on our own Atlas boundaries (shapely when present, a ray test when not)."""
    def __init__(self, path):
        self.feats = []
        if not os.path.exists(path):
            return
        with open(path) as fh:
            g = json.load(fh)
        for f in g.get("features", []):
            geom = f.get("geometry") or {}
            polys = geom.get("coordinates") or []
            if geom.get("type") == "Polygon":
                polys = [polys]
            boxes = []
            for poly in polys:
                ring = poly[0]
                xs = [p[0] for p in ring]; ys = [p[1] for p in ring]
                boxes.append((min(xs), min(ys), max(xs), max(ys), poly))
            self.feats.append((f["properties"].get("name"), f["properties"].get("st"), boxes))

    @staticmethod
    def _in(ring, x, y):
        c = False
        j = len(ring) - 1
        for i in range(len(ring)):
            xi, yi = ring[i][0], ring[i][1]; xj, yj = ring[j][0], ring[j][1]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                c = not c
            j = i
        return c

    def at(self, lat, lon, st=None):
        for name, fst, boxes in self.feats:
            if st and fst != st:
                continue
            for x0, y0, x1, y1, poly in boxes:
                if x0 <= lon <= x1 and y0 <= lat <= y1 and self._in(poly[0], lon, lat) \
                        and not any(self._in(h, lon, lat) for h in poly[1:]):
                    return name
        return None


def read_geonames(cities500, cities_json):
    """US and Canadian towns -> [{name, st, cc, lat, lon, pop}] (one row per town)."""
    rows = []
    if cities500:
        with open(cities500, encoding="utf-8") as fh:
            for line in fh:
                c = line.rstrip("\n").split("\t")
                if len(c) < 15 or c[8] not in ("US", "CA") or c[6] != "P" or c[7] not in KEEP_FEATURES:
                    continue
                st = c[10] if c[8] == "US" else CA_PROV.get(c[10])
                if not st or (c[8] == "US" and st not in US_STATES):
                    continue
                rows.append({"name": c[1], "st": st, "cc": c[8], "lat": float(c[4]), "lon": float(c[5]),
                             "pop": int(c[14] or 0)})
    if cities_json:
        with open(cities_json, encoding="utf-8") as fh:
            for x in json.load(fh):
                if x.get("country") not in ("US", "CA"):
                    continue
                st = x.get("admin1") if x["country"] == "US" else CA_PROV.get(x.get("admin1"))
                if not st or (x["country"] == "US" and st not in US_STATES):
                    continue
                rows.append({"name": x["name"], "st": st, "cc": x["country"], "lat": float(x["lat"]),
                             "lon": float(x["lng"]), "pop": 0})
    # the same town from both files: keep the row with a population
    seen, out = defaultdict(list), []
    for r in sorted(rows, key=lambda r: -r["pop"]):
        k = (r["cc"], r["st"], fold(r["name"]))
        if any(miles(r["lat"], r["lon"], o["lat"], o["lon"]) < 6 for o in seen[k]):
            continue
        seen[k].append(r)
        out.append(r)
    return out


def usable(lat, lon):
    return not (abs(lat) < 0.001 and abs(lon) < 0.001)


def read_zips(rows):
    """zipcodes.list_all() -> {zip: [lat, lon, town, st, county]} for every ZIP with a usable point
    (military APO/FPO codes left out: they are not places)."""
    out = {}
    for z in rows:
        code = z.get("zip_code")
        if not code or len(code) != 5 or z.get("zip_code_type") == "MILITARY":
            continue
        if z.get("lat") is None or z.get("long") is None:
            continue
        lat, lon = float(z["lat"]), float(z["long"])
        if not usable(lat, lon) or z.get("state") not in US_STATES:
            continue
        out[code] = [round(lat, 4), round(lon, 4), z.get("city") or "", z["state"], county_name(z.get("county")),
                     z.get("zip_code_type") or ""]
    return out


def build(zips, towns, county_at):
    """-> (zip shards, us name shards, ca name shards, counts)"""
    zshards = defaultdict(dict)
    for code, v in zips.items():
        zshards[code[:2]][code] = v[:5]
    # ZIP towns: (st, folded town) -> its ZIPs (delivery ZIPs first for the point)
    ztown = defaultdict(list)
    for code, v in sorted(zips.items()):
        if v[2]:
            ztown[(v[3], fold(v[2]))].append((code, v))
    places = []
    used = set()
    for t in towns:
        zs = []
        if t["cc"] == "US":
            k = (t["st"], fold(t["name"]))
            zs = [c for c, v in ztown.get(k, []) if miles(t["lat"], t["lon"], v[0], v[1]) < 25]
            if zs:
                used.add(k)
        county = county_at(t["lat"], t["lon"], t["st"]) if t["cc"] == "US" else ""
        if t["cc"] == "US" and not county and zs:
            county = zips[zs[0]][4]
        places.append([t["name"], t["st"], round(t["lat"], 5), round(t["lon"], 5), county or "", t["pop"],
                       " ".join(zs[:12]), "g", t["cc"]])
    nz = 0
    for k, lst in ztown.items():
        if k in used:
            continue
        std = [v for c, v in lst if v[5] == "STANDARD"] or [v for c, v in lst]
        lat = sum(v[0] for v in std) / len(std); lon = sum(v[1] for v in std) / len(std)
        v0 = lst[0][1]
        county = county_at(lat, lon, v0[3]) or v0[4]
        places.append([v0[2], v0[3], round(lat, 4), round(lon, 4), county, 0, " ".join(c for c, v in lst[:12]), "z", "US"])
        nz += 1
    nshards = {"US": defaultdict(list), "CA": defaultdict(list)}
    for p in places:
        nshards[p[8]][shard_key(fold(p[0]))].append(p[:8])
    for cc in nshards:
        for k in nshards[cc]:
            # bigger towns first: population, then how many ZIP codes the town has
            nshards[cc][k].sort(key=lambda p: (-p[5], -len(p[6].split()) if p[6] else 0, p[0], p[1]))
    counts = {"zips": len(zips), "us_towns": sum(len(v) for v in nshards["US"].values()),
              "us_zip_only_towns": nz, "ca_towns": sum(len(v) for v in nshards["CA"].values())}
    return zshards, nshards["US"], nshards["CA"], counts


def write(zshards, us, ca, counts):
    for sub in ("zip", "us", "ca"):
        os.makedirs(os.path.join(OUT, sub), exist_ok=True)
        for f in os.listdir(os.path.join(OUT, sub)):
            if f.endswith(".json"):
                os.remove(os.path.join(OUT, sub, f))
    for k, t in zshards.items():
        with open(os.path.join(OUT, "zip", k + ".json"), "w") as fh:
            fh.write(json.dumps(t, separators=(",", ":"), sort_keys=True, ensure_ascii=False) + "\n")
    for sub, sh in (("us", us), ("ca", ca)):
        for k, lst in sh.items():
            with open(os.path.join(OUT, sub, k + ".json"), "w") as fh:
                fh.write(json.dumps({"p": lst}, separators=(",", ":"), ensure_ascii=False) + "\n")
    idx = {"schema": "agsist-places/1", "built": datetime.date.today().isoformat(), "counts": counts,
           "zip_shards": sorted(zshards), "us_shards": sorted(us), "ca_shards": sorted(ca),
           "fields": {"zip": ["lat", "lon", "town", "st", "county"],
                      "town": ["name", "st", "lat", "lon", "county", "population", "zips", "src g=GeoNames town point, z=middle of its ZIP points"]},
           "sources": ["GeoNames (geonames.org, CC BY 4.0): town points (cities500, cities1000) and ZIP points",
                       "zipcodes==3.0.0 (PyPI): ZIP code, primary town, county",
                       "data/atlas/counties.geo.json: county of a town point"]}
    with open(os.path.join(OUT, "index.json"), "w") as fh:
        json.dump(idx, fh, indent=1)
        fh.write("\n")


def selftest():
    ok = True
    def ck(name, cond):
        nonlocal ok
        print(("ok   " if cond else "FAIL ") + name)
        ok = ok and cond
    ck("fold St. Paul", fold("St. Paul") == "saintpaul" == fold("Saint Paul"))
    ck("fold accents and dashes", fold("Saint-Hyacinthe") == "sainthyacinthe" == fold("saint hyacinthe"))
    ck("fold apostrophe", fold("Qu'Appelle") == "quappelle")
    ck("shard key short", shard_key("a") == "a_" and shard_key("") == "__")
    zips = read_zips([
        {"zip_code": "54728", "zip_code_type": "STANDARD", "city": "Chetek", "state": "WI", "county": "Barron County", "lat": "45.317", "long": "-91.6542"},
        {"zip_code": "09001", "zip_code_type": "MILITARY", "city": "APO", "state": "AE", "county": "", "lat": "0", "long": "0"},
        {"zip_code": "58255", "zip_code_type": "STANDARD", "city": "Maida", "state": "ND", "county": "Cavalier County", "lat": "48.95", "long": "-98.36"},
    ])
    ck("military dropped, county suffix off", set(zips) == {"54728", "58255"} and zips["54728"][4] == "Barron")
    towns = [{"name": "Chetek", "st": "WI", "cc": "US", "lat": 45.31413, "lon": -91.651, "pop": 2191},
             {"name": "Regina", "st": "SK", "cc": "CA", "lat": 50.45, "lon": -104.6, "pop": 176183}]
    z, us, ca, c = build(zips, towns, lambda la, lo, st: None)
    ck("zip shard keeps 5 fields", z["54"]["54728"] == [45.317, -91.6542, "Chetek", "WI", "Barron"])
    ck("town carries its ZIP", us["ch"][0][6] == "54728" and us["ch"][0][7] == "g")
    ck("ZIP-only town kept", us["ma"][0][0] == "Maida" and us["ma"][0][7] == "z")
    ck("Canada apart", ca["re"][0][:2] == ["Regina", "SK"] and "re" not in us)
    return 0 if ok else 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cities500")
    ap.add_argument("--cities-json")
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if not a.cities500:
        print("::error::--cities500 is required (GeoNames cities500.txt)", file=sys.stderr)
        return 1
    try:
        import zipcodes
    except ImportError:
        print("::error title=zipcodes is not installed::pip install zipcodes==3.0.0", file=sys.stderr)
        return 1
    cf = CountyFinder(COUNTIES)
    zips = read_zips(zipcodes.list_all())
    towns = read_geonames(a.cities500, a.cities_json)
    zs, us, ca, counts = build(zips, towns, cf.at)
    print(json.dumps(counts))
    if a.dry:
        return 0
    write(zs, us, ca, counts)
    print("wrote data/places/: %d zip, %d us, %d ca shards" % (len(zs), len(us), len(ca)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
