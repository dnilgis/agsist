#!/usr/bin/env python3
"""One-time pull of the river inputs for the elevator river key (Sig, Nov 9 2026: dispatch only, no schedule).

Reads two public federal map layers through their ArcGIS REST query endpoints and writes a small derived
copy under river/ (saved to the private raw branch by river-pull.yml, never to main, so the site does not
grow):
  river/docks.json      grain-handling docks: point, name, city, state, waterway, the text that made it a
                        grain dock, and the layer's own date
  river/waterways.json  the national waterway network lines, simplified (Douglas-Peucker, 0.001 degree,
                        about 100 m; coordinates to 4 decimals), with the type fields the layer publishes
  river/manifest.json   where each came from (item, layer URL, field list), source dates, counts, and the
                        tally of what the grain filter matched, so a person can check the filter

Sources: the U.S. Army Corps of Engineers Navigation Data Center docks (port and waterway facilities) and the
National Waterway Network lines, both published through the BTS National Transportation Atlas Database.
The layers are found through ArcGIS Online's public item search (no login); --docks-url / --lines-url name
a layer outright when the search picks the wrong one.

A grain dock: a dock whose commodity, purpose, facility type or name text names grain, corn, soybeans,
wheat, sorghum or milo. When the layer has none of those fields, every text field is read. A dock whose
service termination date is set is left out. Nothing is guessed: a dock with no point is dropped and
counted.

Usage: python3 scripts/fetch_river.py [--out river] [--docks-url URL] [--lines-url URL]
       python3 scripts/fetch_river.py --selftest
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import argparse
import datetime as dt
import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request

SEARCH = "https://www.arcgis.com/sharing/rest/search"
UA = "agsist-river (+agsist.com)"
QUERIES = {
    "docks": 'title:"Docks" AND (type:"Feature Service" OR type:"Map Service") AND (owner:BTS* OR tags:NTAD OR tags:USACE)',
    "lines": 'title:"Navigable Waterway Network Lines" AND (type:"Feature Service" OR type:"Map Service")',
}
TITLE_OK = {"docks": re.compile(r"\bdocks?\b", re.I), "lines": re.compile(r"waterway network lines", re.I)}
OWNER_RANK = re.compile(r"BTS|USDOT|NTAD|USACE", re.I)
LAYER_URL = re.compile(r"^https://[A-Za-z0-9.-]+/[A-Za-z0-9_./%-]*/(?:FeatureServer|MapServer)(?:/\d+)?/?$")

GRAIN = re.compile(r"\b(?:grains?|corn|soy ?beans?|wheat|sorghum|milo)\b", re.I)
GRAIN_FIELDS = re.compile(r"commod|purpose|facility_?type|fac_?type|nav_unit_name|^name$", re.I)
GRAIN_ORDER = [re.compile(r"commod", re.I), re.compile(r"purpose", re.I), re.compile(r"fac", re.I), re.compile(r".")]
END_FIELDS = re.compile(r"termination|term_date|closed", re.I)
PICK = {
    "name": [r"^nav_unit_name$", r"^(dock_)?name$", r"name"],
    "city": [r"^city_or_town$", r"^city", r"town"],
    "st": [r"^state_post_code$", r"^state(_?abbr|_?code)?$", r"^st$", r"state"],
    "waterway": [r"^wtwy_name$", r"wtwy.*name", r"waterway", r"river"],
    "mile": [r"^mile$", r"river_?mile", r"mile"],
}
LINE_KEEP = re.compile(r"type|class|status|^name$|rivername|wtwy_?name|linkname|geo$", re.I)
SIMPLIFY_DEG = 0.001
CHUNK = 500


def log(msg):
    print(f"[river] {msg}", flush=True)


# ------------------------------------------------------------------ http
def http_json(url, data=None, tries=4, opener=None):
    """GET (or POST form data) and parse JSON; ArcGIS errors come back as 200 with an "error" key."""
    if opener:
        return opener(url, data)
    body = urllib.parse.urlencode(data).encode() if data else None
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=body, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=180) as r:
                doc = json.loads(r.read().decode("utf-8"))
            if isinstance(doc, dict) and doc.get("error"):
                raise RuntimeError(f"service error: {doc['error'].get('message') or doc['error']}")
            return doc
        except Exception as e:  # noqa: BLE001  (retried, then raised)
            last = e
            time.sleep(3 * (i + 1))
    raise RuntimeError(f"{url.split('?')[0]}: {last}")


# ------------------------------------------------------------------ discovery
def find_layer(kind, opener=None):
    """The layer URL and the item it came from, by ArcGIS Online's public search. The newest item from a
    BTS/USDOT/USACE owner wins; nothing found is an error that lists what the search saw."""
    q = urllib.parse.urlencode({"q": QUERIES[kind], "num": 50, "f": "json"})
    doc = http_json(f"{SEARCH}?{q}", opener=opener)
    seen, cands = [], []
    for it in doc.get("results") or []:
        url = (it.get("url") or "").rstrip("/")
        seen.append(f"{it.get('title')} | {it.get('owner')} | {url}")
        if not url or not re.search(r"/(FeatureServer|MapServer)(/\d+)?$", url):
            continue
        if not TITLE_OK[kind].search(it.get("title") or ""):
            continue
        cands.append(it)
    if not cands:
        raise SystemExit(f"[river] no {kind} layer found by the search; it saw: " + "; ".join(seen[:20]))
    cands.sort(key=lambda it: (0 if OWNER_RANK.search(it.get("owner") or "") else 1, -(it.get("modified") or 0)))
    it = cands[0]
    url = it["url"].rstrip("/")
    if not re.search(r"/\d+$", url):
        url += "/0"
    return url, {"item": it.get("id"), "title": it.get("title"), "owner": it.get("owner"),
                 "item_modified": ms_date(it.get("modified"))}


def ms_date(ms):
    if not ms:
        return None
    return dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).date().isoformat()


def source_date(layer_info, item):
    """The date the publisher last changed the data, and where that date came from. Never the fetch date."""
    ei = (layer_info or {}).get("editingInfo") or {}
    for k in ("dataLastEditDate", "lastEditDate"):
        if ei.get(k):
            return ms_date(ei[k]), f"layer editingInfo.{k}"
    if item and item.get("item_modified"):
        return item["item_modified"], "item modified date"
    return None, "not published by the layer"


# ------------------------------------------------------------------ reading a layer
def read_layer(url, opener=None, sleep=0.3):
    """(layer info, [feature]) for every record: object ids first, then chunks by id (works on Feature and
    Map services alike, with or without paging support)."""
    info = http_json(f"{url}?f=json", opener=opener)
    ids = http_json(f"{url}/query", {"where": "1=1", "returnIdsOnly": "true", "f": "json"}, opener=opener)
    oids = sorted(ids.get("objectIds") or [])
    feats = []
    for i in range(0, len(oids), CHUNK):
        part = oids[i:i + CHUNK]
        doc = http_json(f"{url}/query", {"objectIds": ",".join(str(x) for x in part), "outFields": "*",
                                         "outSR": "4326", "returnGeometry": "true", "f": "json"}, opener=opener)
        feats.extend(doc.get("features") or [])
        if sleep:
            time.sleep(sleep)
    if len(feats) != len(oids):
        raise RuntimeError(f"{url}: asked for {len(oids)} records, got {len(feats)}")
    return info, feats


def pick_field(fields, kind):
    names = [f for f in fields]
    for pat in PICK[kind]:
        for n in names:
            if re.search(pat, n, re.I):
                return n
    return None


# ------------------------------------------------------------------ docks
def grain_docks(feats, fields):
    """([dock], tally). A dock counts when a grain word appears in a commodity/purpose/type/name field
    (every text field when the layer has none of those); a dock out of service is left out."""
    text_fields = [f["name"] for f in fields if f.get("type") == "esriFieldTypeString"]
    rank = lambda n: next(i for i, rx in enumerate(GRAIN_ORDER) if rx.search(n))
    look = sorted((n for n in text_fields if GRAIN_FIELDS.search(n)), key=rank) or text_fields
    ends = [f["name"] for f in fields if END_FIELDS.search(f["name"])]
    names = [f["name"] for f in fields]
    col = {k: pick_field(names, k) for k in PICK}
    tally = {"records": len(feats), "grain": 0, "out_of_service": 0, "no_point": 0, "by_field": {},
             "fields_read": look, "fields_picked": col}
    out = []
    for ft in feats:
        a = ft.get("attributes") or {}
        hit = None
        for n in look:
            v = a.get(n)
            if isinstance(v, str):
                m = GRAIN.search(v)
                if m:
                    hit = (n, v)
                    break
        if not hit:
            continue
        if any(a.get(n) not in (None, "", 0) for n in ends):
            tally["out_of_service"] += 1
            continue
        g = ft.get("geometry") or {}
        x, y = g.get("x"), g.get("y")
        if not isinstance(x, (int, float)) or not isinstance(y, (int, float)) or (x == 0 and y == 0):
            tally["no_point"] += 1
            continue
        tally["grain"] += 1
        tally["by_field"][hit[0]] = tally["by_field"].get(hit[0], 0) + 1
        snip = re.sub(r"\s+", " ", hit[1]).strip()
        m = GRAIN.search(snip)
        lo = max(0, m.start() - 40)
        row = {"lat": round(y, 5), "lng": round(x, 5), "why": f"{hit[0]}: {snip[lo:lo + 90]}"}
        for k, n in col.items():
            if n and a.get(n) not in (None, ""):
                row[k] = a[n] if not isinstance(a[n], str) else re.sub(r"\s+", " ", a[n]).strip()[:80]
        out.append(row)
    out.sort(key=lambda r: (r.get("st") or "", r["lat"], r["lng"]))
    return out, tally


# ------------------------------------------------------------------ lines
def _seg_dist(p, a, b):
    (px, py), (ax, ay), (bx, by) = p, a, b
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def simplify(pts, tol=SIMPLIFY_DEG):
    """Douglas-Peucker, iterative (long rivers would overflow recursion). Ends always kept."""
    if len(pts) < 3:
        return list(pts)
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        far, at = -1.0, None
        for k in range(i + 1, j):
            d = _seg_dist(pts[k], pts[i], pts[j])
            if d > far:
                far, at = d, k
        if at is not None and far > tol:
            keep[at] = True
            stack.append((i, at))
            stack.append((at, j))
    return [p for p, k in zip(pts, keep) if k]


def waterway_lines(feats, fields):
    keepf = [f["name"] for f in fields if LINE_KEEP.search(f["name"])]
    out, pts_in, pts_out, empty = [], 0, 0, 0
    for ft in feats:
        paths = (ft.get("geometry") or {}).get("paths") or []
        keep_paths = []
        for path in paths:
            pts = [(float(x), float(y)) for x, y, *_ in path]
            pts_in += len(pts)
            s = simplify(pts)
            s = [[round(x, 4), round(y, 4)] for x, y in s]
            s = [p for i, p in enumerate(s) if i == 0 or p != s[i - 1]]
            if len(s) >= 2:
                keep_paths.append(s)
                pts_out += len(s)
        if not keep_paths:
            empty += 1
            continue
        a = ft.get("attributes") or {}
        row = {k: a[k] for k in keepf if a.get(k) not in (None, "")}
        row["paths"] = keep_paths
        out.append(row)
    return out, {"records": len(feats), "kept": len(out), "no_geometry": empty, "points_in": pts_in,
                 "points_out": pts_out, "fields_kept": keepf, "simplify_deg": SIMPLIFY_DEG}


# ------------------------------------------------------------------ run
def run(out_dir, docks_url=None, lines_url=None, opener=None, sleep=0.3, today=None):
    fetched = today or dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    man = {"schema": "agsist-river-pull/1", "fetched_utc": fetched, "note": __doc__.split("\n\n")[2].strip()}
    got = {}
    for kind, given in (("docks", docks_url), ("lines", lines_url)):
        if given:
            if not LAYER_URL.match(given):
                raise SystemExit(f"[river] --{kind}-url must be an https FeatureServer or MapServer layer URL")
            url, item = given.rstrip("/"), {"item": None, "title": None, "owner": None, "item_modified": None}
            if not re.search(r"/\d+$", url):
                url += "/0"
        else:
            url, item = find_layer(kind, opener=opener)
        log(f"{kind}: {item.get('title') or 'layer named by hand'} ({item.get('owner') or 'owner not read'})")
        info, feats = read_layer(url, opener=opener, sleep=sleep)
        sd, sd_from = source_date(info, item)
        got[kind] = (url, item, info, feats, sd, sd_from)
    url, item, info, feats, sd, sd_from = got["docks"]
    docks, tally = grain_docks(feats, info.get("fields") or [])
    if not docks:
        raise SystemExit(f"[river] the grain filter kept no dock out of {len(feats)}; fields read: {tally['fields_read']}")
    src_docks = {"what": "USACE Navigation Data Center docks, grain-handling only", "layer": url, **item,
                 "layer_name": info.get("name"), "source_date": sd, "source_date_from": sd_from, "fetched_utc": fetched}
    man["docks"] = {**src_docks, "fields": [f["name"] for f in info.get("fields") or []], "tally": tally}
    url, item, info, feats, sd, sd_from = got["lines"]
    lines, ltally = waterway_lines(feats, info.get("fields") or [])
    if not lines:
        raise SystemExit("[river] no waterway line had a geometry")
    src_lines = {"what": "National Waterway Network lines, simplified", "layer": url, **item,
                 "layer_name": info.get("name"), "source_date": sd, "source_date_from": sd_from, "fetched_utc": fetched}
    man["lines"] = {**src_lines, "fields": [f["name"] for f in info.get("fields") or []], "tally": ltally}
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "docks.json"), "w") as fh:
        json.dump({"schema": "agsist-river-docks/1", "source": src_docks, "count": len(docks), "docks": docks},
                  fh, separators=(",", ":"))
    with open(os.path.join(out_dir, "waterways.json"), "w") as fh:
        json.dump({"schema": "agsist-river-waterways/1", "source": src_lines, "count": len(lines), "lines": lines},
                  fh, separators=(",", ":"))
    with open(os.path.join(out_dir, "manifest.json"), "w") as fh:
        json.dump(man, fh, indent=1, sort_keys=True)
    log(f"RIVER-PULL docks={len(docks)} dock_records={tally['records']} lines={len(lines)} "
        f"points_out={ltally['points_out']}")
    return man


# ------------------------------------------------------------------ selftest
def selftest():
    import tempfile
    ok = 0

    def check(cond, what):
        nonlocal ok
        if not cond:
            raise SystemExit(f"selftest FAILED: {what}")
        ok += 1

    S = "esriFieldTypeString"
    dock_fields = [{"name": n, "type": S} for n in ("NAV_UNIT_NAME", "CITY_OR_TOWN", "STATE_POST_CODE", "WTWY_NAME",
                                                     "PURPOSE", "COMMODITIES", "REMARKS", "SERVICE_TERMINATION_DATE")]
    dock_fields += [{"name": "MILE", "type": "esriFieldTypeDouble"}, {"name": "OBJECTID", "type": "esriFieldTypeOID"}]

    def dock(oid, name, purpose, comm, x, y, end=None, remarks=""):
        return {"attributes": {"OBJECTID": oid, "NAV_UNIT_NAME": name, "CITY_OR_TOWN": "Havana", "STATE_POST_CODE": "IL",
                               "WTWY_NAME": "Illinois River", "PURPOSE": purpose, "COMMODITIES": comm, "MILE": 119.6,
                               "REMARKS": remarks, "SERVICE_TERMINATION_DATE": end},
                "geometry": {"x": x, "y": y} if x is not None else None}
    feats = [dock(1, "Grain Co. Havana Dock", "Receipt of grain by truck; shipment by barge.", "Corn, soybeans", -90.07, 40.29),
             dock(2, "Fuel Terminal", "Receipt of petroleum products.", "Diesel", -90.06, 40.30),
             dock(3, "Old Elevator Dock", "Shipment of grain by barge.", "Wheat", -90.05, 40.31, end=946684800000),
             dock(4, "Sand Dock", "Receipt of sand.", "Sand", -90.04, 40.32, remarks="near a grain elevator"),
             dock(5, "Fleet Grain", "Mooring barges.", "Soybeans", None, None),
             dock(6, "Cornerstone Fleeting", "Mooring.", "Cornerstone", -90.03, 40.33)]
    docks, tally = grain_docks(feats, dock_fields)
    check([d["name"] for d in docks] == ["Grain Co. Havana Dock"], f"grain filter kept {[d['name'] for d in docks]}")
    check(tally["out_of_service"] == 1 and tally["no_point"] == 1, f"tally {tally}")
    check("REMARKS" not in tally["fields_read"], "remarks is not a grain field when commodity fields exist")
    check(docks[0]["why"].startswith("COMMODITIES: Corn") and docks[0]["st"] == "IL" and docks[0]["mile"] == 119.6, docks[0])
    check(docks[0]["waterway"] == "Illinois River" and docks[0]["city"] == "Havana", docks[0])
    # no commodity-like field: every text field is read
    plain = [{"name": "LABEL", "type": S}, {"name": "NOTE", "type": S}]
    d2, t2 = grain_docks([{"attributes": {"LABEL": "X", "NOTE": "grain elevator"}, "geometry": {"x": -90, "y": 40}}], plain)
    check(len(d2) == 1 and t2["fields_read"] == ["LABEL", "NOTE"], t2)

    # simplify: a straight run collapses, a real bend stays; ends kept
    line = [(0.0, 0.0), (0.0004, 0.0001), (0.001, 0.0), (0.002, 0.0), (0.003, 0.01), (0.004, 0.0)]
    s = simplify(line)
    check(s[0] == line[0] and s[-1] == line[-1] and (0.003, 0.01) in s and (0.0004, 0.0001) not in s, s)
    long_line = [(i * 0.0001, 0.0) for i in range(20000)]
    check(len(simplify(long_line)) == 2, "a 20,000-point straight line simplifies to its ends without recursion")
    lfields = [{"name": "RIVERNAME", "type": S}, {"name": "WTWY_TYPE", "type": "esriFieldTypeInteger"},
               {"name": "LENGTH", "type": "esriFieldTypeDouble"}]
    lines, lt = waterway_lines([{"attributes": {"RIVERNAME": "ILLINOIS RIVER", "WTWY_TYPE": 6, "LENGTH": 3.2},
                                 "geometry": {"paths": [[[-90.1, 40.2], [-90.05, 40.25], [-90.0, 40.3]]]}},
                                {"attributes": {"RIVERNAME": "NONE"}, "geometry": {"paths": []}}], lfields)
    check(len(lines) == 1 and lines[0]["paths"] == [[[-90.1, 40.2], [-90.0, 40.3]]] and "LENGTH" not in lines[0], lines)
    check(lines[0]["WTWY_TYPE"] == 6 and lt["no_geometry"] == 1, lt)

    # source date: the layer's own edit date wins; the fetch date is never used
    check(source_date({"editingInfo": {"lastEditDate": 1700000000000}}, {"item_modified": "2020-01-01"})
          == ("2023-11-14", "layer editingInfo.lastEditDate"), "layer date")
    check(source_date({}, {"item_modified": "2020-01-01"}) == ("2020-01-01", "item modified date"), "item date")
    check(source_date({}, {}) == (None, "not published by the layer"), "no date")

    # the whole run against a fake service: search, ids, chunks, files
    calls = []
    lfeats = [{"attributes": {"OBJECTID": i, "RIVERNAME": "R", "WTWY_TYPE": 6},
               "geometry": {"paths": [[[-90 + i * 0.01, 40.0], [-90 + i * 0.01, 40.1]]]}} for i in range(1, 4)]

    def fake(url, data):
        calls.append(url)
        if url.startswith(SEARCH):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)["q"][0]
            if "Docks" in q:
                return {"results": [{"id": "x1", "title": "Docks", "owner": "someone", "modified": 1800000000000,
                                     "url": "https://example.org/arcgis/rest/services/Other/FeatureServer"},
                                    {"id": "d1", "title": "Docks", "owner": "BTS_GIS", "modified": 1700000000000,
                                     "url": "https://example.org/arcgis/rest/services/Docks/FeatureServer"}]}
            return {"results": [{"id": "l1", "title": "Navigable Waterway Network Lines", "owner": "BTS_GIS",
                                 "modified": 1700000000000,
                                 "url": "https://example.org/arcgis/rest/services/NWN/FeatureServer/0"}]}
        isdocks = "/Docks/" in url
        if url.endswith("?f=json"):
            return {"name": "Docks" if isdocks else "Lines", "fields": dock_fields if isdocks else lfields,
                    "editingInfo": {"lastEditDate": 1750000000000}}
        if data.get("returnIdsOnly"):
            return {"objectIds": [f["attributes"]["OBJECTID"] for f in (feats if isdocks else lfeats)]}
        want = {int(x) for x in data["objectIds"].split(",")}
        return {"features": [f for f in (feats if isdocks else lfeats) if f["attributes"]["OBJECTID"] in want]}
    with tempfile.TemporaryDirectory() as td:
        man = run(td, opener=fake, sleep=0, today="2026-11-09T00:00:00Z")
        dk = json.load(open(os.path.join(td, "docks.json")))
        ww = json.load(open(os.path.join(td, "waterways.json")))
        check(dk["count"] == 1 and dk["source"]["owner"] == "BTS_GIS" and dk["source"]["layer"].endswith("/Docks/FeatureServer/0"),
              f"BTS item wins over a newer item from another owner: {dk['source']}")
        check(dk["source"]["source_date"] == "2025-06-15" and dk["source"]["fetched_utc"] == "2026-11-09T00:00:00Z", dk["source"])
        check(ww["count"] == 3 and man["lines"]["tally"]["kept"] == 3, man["lines"]["tally"])
        check(any("/Docks/FeatureServer/0/query" in c for c in calls), "docks queried by object id")
        try:
            run(td, docks_url="http://example.org/x", opener=fake, sleep=0)
            check(False, "a non-https layer URL is refused")
        except SystemExit as e:
            check("https" in str(e), str(e))
    print(f"fetch_river selftest: {ok} checks ok")
    return 0


def main():
    ap = argparse.ArgumentParser(description="One-time pull of grain docks and waterway lines.")
    ap.add_argument("--out", default="river")
    ap.add_argument("--docks-url", default=os.environ.get("RIVER_DOCKS_URL") or None)
    ap.add_argument("--lines-url", default=os.environ.get("RIVER_LINES_URL") or None)
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    run(a.out, a.docks_url, a.lines_url)
    return 0


if __name__ == "__main__":
    sys.exit(main())
