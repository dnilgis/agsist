"""Check the public services Field Scout's "on and around this field" card reads.

field-scout-layers.js asks these services from the reader's browser. The sandbox
cannot reach them, so this runs on a GitHub runner (land-data.yml, task=layers)
and, for each service, at a real Iowa field and a real Wisconsin field:

  * sends the same request the page sends (same URL, same form body),
  * records the HTTP status, the bytes, and the Access-Control-Allow-Origin
    header (a browser page can read the answer only when it is * or agsist.com),
  * saves every answer under data/land-raw/layers/ (the workflow moves that
    to the raw branch, never deployed), so a parser is written against a real
    copy and test/fixtures/field-layers/ can be refreshed from it,
  * reads the layer metadata (?f=json) of each ArcGIS layer and saves the field
    names, so the page's field names are checked, not assumed.

With discover it also lists Wisconsin DNR's map services and keeps any whose name
looks like CAFO / animal / feedlot, plus any HIFLD-style national power line layer
that still answers, so the next step is a name to check, not a guess.

  python3 scripts/probe_field_layers.py            # check, save, write the summary
  python3 scripts/probe_field_layers.py --discover # also list WI DNR services
  python3 scripts/probe_field_layers.py --selftest

The summary goes to data/land/field-layers-check.json (small; committed by the
workflow). It never marks anything "used"; it only says what answered.
"""
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "land-raw", "layers")
OUT = os.path.join(ROOT, "data", "land", "field-layers-check.json")
ORIGIN = "https://agsist.com"
UA = "AGSIST field layer check (agsist.com; sig@agsist.com)"

# Two real fields: Story County, Iowa (about 40 ac) and Barron County, Wisconsin (about 40 ac).
FIELDS = {
    "ia": {"st": "IA", "ring": [[-93.5000, 42.0600], [-93.4952, 42.0600], [-93.4952, 42.0636], [-93.5000, 42.0636], [-93.5000, 42.0600]]},
    "wi": {"st": "WI", "ring": [[-91.6550, 45.3100], [-91.6499, 45.3100], [-91.6499, 45.3136], [-91.6550, 45.3136], [-91.6550, 45.3100]]},
}

NFHL = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer"
NWI = "https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0"
DEP = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/getSamples"
WIND = ["https://energy.usgs.gov/api/uswtdb/v1/turbines", "https://eersc.usgs.gov/api/uswtdb/v1/turbines"]
SOLAR = ["https://energy.usgs.gov/api/uspvdb/v1/projects"]
# the page tries these in order (field-scout-layers.js URLS.osm)
OSM = "https://overpass-api.de/api/interpreter"
OSM2 = "https://overpass.private.coffee/api/interpreter"
NCED = "https://services.arcgis.com/QVENGdaPbd4LUkLV/ArcGIS/rest/services/NCED/FeatureServer/0"
FEED = {
    "IA": "https://programs.iowadnr.gov/geospatial/rest/services/OneStop/QueryEnvFacs/MapServer/2",
    "MN": "https://enterprise.gisdata.mn.gov/aghost/rest/services/us_mn_state_pca/env_feedlots/FeatureServer/0",
}
# Old HIFLD Open address and a state copy, to see whether any national line layer still answers
LINES = [
    "https://services1.arcgis.com/Hp6G80Pky0om7QvQ/arcgis/rest/services/Electric_Power_Transmission_Lines/FeatureServer/0",
    "https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/US_Electric_Power_Transmission_Lines/FeatureServer/0",
]
WI_DNR_ROOTS = ["https://dnrmaps.wi.gov/arcgis/rest/services", "https://dnrmaps.wi.gov/arcgis2/rest/services"]
LOOKS_LIVESTOCK = re.compile(r"cafo|animal|feedlot|livestock|manure|nr ?243|ag_?runoff", re.I)

LOG = []


def say(line):
    print(line)
    LOG.append(line)


def fetch(url, form=None, timeout=45):
    """GET (or form POST) with the page's Origin. Returns (status, acao, bytes)."""
    data = urllib.parse.urlencode(form).encode() if form is not None else None
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA, "Origin": ORIGIN, "Accept": "application/json"})
    if data is not None:
        req.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.headers.get("Access-Control-Allow-Origin"), r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("Access-Control-Allow-Origin") if e.headers else None, e.read() or b""
    except Exception as e:  # noqa: BLE001 - a dead host is a result, not a crash
        return None, None, str(e).encode()


def browser_ok(acao):
    return acao is not None and acao.strip() in ("*", ORIGIN)


def centroid(ring):
    pts = ring[:-1]
    return sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)


def box(lng, lat, mi):
    import math
    dy = mi / 69.0
    dx = mi / (69.17 * math.cos(math.radians(lat)))
    return lng - dx, lng + dx, lat - dy, lat + dy


def poly_form(ring, fields):
    return {"f": "json", "where": "1=1", "outFields": fields, "returnGeometry": "true", "outSR": "4326", "inSR": "4326",
            "geometryPrecision": "6", "maxAllowableOffset": "0.00003", "geometryType": "esriGeometryPolygon",
            "spatialRel": "esriSpatialRelIntersects", "geometry": json.dumps({"rings": [ring], "spatialReference": {"wkid": 4326}})}


def slope_points(ring, n=12):
    """A small n x n grid over the field box (the page uses up to about 600)."""
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return [[round(min(xs) + (max(xs) - min(xs)) * i / (n - 1), 6), round(min(ys) + (max(ys) - min(ys)) * j / (n - 1), 6)]
            for j in range(n) for i in range(n)]


def summarize(body):
    """A few facts about an answer: feature count, sample count, list length, error text."""
    try:
        d = json.loads(body)
    except Exception:  # noqa: BLE001
        return {"json": False, "head": body[:200].decode("utf-8", "replace")}
    out = {"json": True}
    if isinstance(d, list):
        out["rows"] = len(d)
        if d and isinstance(d[0], dict):
            out["keys"] = sorted(d[0].keys())
    elif isinstance(d, dict):
        if "error" in d:
            out["error"] = d["error"]
        if "features" in d:
            out["features"] = len(d["features"])
            if d["features"]:
                out["attrs"] = sorted((d["features"][0].get("attributes") or {}).keys())
        if "samples" in d:
            out["samples"] = len(d["samples"])
        if "elements" in d:
            out["elements"] = len(d["elements"])
        if "fields" in d:
            out["fields"] = [{"name": f.get("name"), "alias": f.get("alias"), "type": f.get("type")} for f in d["fields"]]
            out["name"] = d.get("name")
            out["geometryType"] = d.get("geometryType")
            ed = (d.get("editingInfo") or {}).get("lastEditDate") or (d.get("editingInfo") or {}).get("dataLastEditDate")
            if ed:
                out["lastEditUTC"] = time.strftime("%Y-%m-%d", time.gmtime(ed / 1000))
    return out


def save(name, body):
    os.makedirs(RAW, exist_ok=True)
    with open(os.path.join(RAW, name), "wb") as f:
        f.write(body)


def check(results, sid, label, url, form=None, fname=None):
    st, acao, body = fetch(url, form)
    fname = fname or (sid + ".json")
    save(fname, body)
    row = {"id": sid, "what": label, "url": url, "post": form is not None, "status": st, "acao": acao,
           "browser_ok": browser_ok(acao), "bytes": len(body), "saved": "data/land-raw/layers/" + fname}
    row.update(summarize(body) if st else {"error": body.decode("utf-8", "replace")[:200]})
    results.append(row)
    say(f"{sid:24s} {st} acao={acao} bytes={len(body)} {label}")
    time.sleep(1)
    return row


def run(discover=False):
    res = []
    for k, f in FIELDS.items():
        ring = f["ring"]
        lng, lat = centroid(ring)
        check(res, f"nfhl-zones-{k}", "FEMA flood zones in the field", NFHL + "/28/query", poly_form(ring, "FLD_ZONE,ZONE_SUBTY,SFHA_TF"))
        check(res, f"nfhl-panel-{k}", "FEMA FIRM panel at the field center", NFHL + "/3/query",
              {"f": "json", "where": "1=1", "outFields": "FIRM_PAN,EFF_DATE", "returnGeometry": "false", "geometryType": "esriGeometryPoint",
               "inSR": "4326", "spatialRel": "esriSpatialRelIntersects", "geometry": f"{lng:.6f},{lat:.6f}"})
        check(res, f"nwi-{k}", "USFWS wetlands in the field", NWI + "/query", poly_form(ring, "WETLAND_TYPE,ATTRIBUTE"))
        check(res, f"dep-{k}", "USGS 3DEP elevation samples", DEP,
              {"f": "json", "geometryType": "esriGeometryMultipoint", "returnFirstValueOnly": "true", "interpolation": "RSP_BilinearInterpolation",
               "geometry": json.dumps({"points": slope_points(ring), "spatialReference": {"wkid": 4326}})})
        w, e, s, n = box(lng, lat, 5)
        for i, u in enumerate(WIND):
            check(res, f"wind{i}-{k}", "USGS wind turbines within 5 mi box",
                  f"{u}?xlong=gte.{w:.4f}&xlong=lte.{e:.4f}&ylat=gte.{s:.4f}&ylat=lte.{n:.4f}&select=case_id,p_name,t_cap,xlong,ylat")
        w, e, s, n = box(lng, lat, 10)
        for i, u in enumerate(SOLAR):
            check(res, f"solar{i}-{k}", "USGS large solar within 10 mi box",
                  f"{u}?xlong=gte.{w:.4f}&xlong=lte.{e:.4f}&ylat=gte.{s:.4f}&ylat=lte.{n:.4f}&select=case_id,p_year,p_cap_ac,xlong,ylat")
        a = f"(around:8047,{lat:.5f},{lng:.5f})"
        check(res, f"osm-{k}", "OpenStreetMap power lines and substations within 5 mi", OSM,
              {"data": f'[out:json][timeout:25];way["power"="line"]{a};out tags geom;(node["power"="substation"]{a};way["power"="substation"]{a};);out tags center;'})
        check(res, f"osm2-{k}", "OpenStreetMap power lines, second server", OSM2,
              {"data": f'[out:json][timeout:25];way["power"="line"]{a};out tags geom;(node["power"="substation"]{a};way["power"="substation"]{a};);out tags center;'})
        # NCED answered "Token Required" on Oct 18; still checked so a reopened service shows up
        check(res, f"nced-{k}", "NCED easements in the field", NCED + "/query", poly_form(ring, "*"))
    check(res, "nced-meta", "NCED layer fields", NCED + "?f=json")
    check(res, "nfhl-28-meta", "FEMA flood zone layer fields", NFHL + "/28?f=json")
    check(res, "nfhl-3-meta", "FEMA FIRM panel layer fields", NFHL + "/3?f=json")
    check(res, "nwi-meta", "NWI layer fields", NWI + "?f=json")
    for st, u in FEED.items():
        check(res, f"feed-meta-{st.lower()}", f"{st} feedlot layer fields", u + "?f=json")
        # a point in the middle of farm country for each state, 3 mi around
        pt = {"IA": "-93.5,42.06", "MN": "-94.9,45.1"}[st]
        check(res, f"feed-{st.lower()}", f"{st} feedlots within 3 mi of a test point", u + "/query",
              {"f": "json", "where": "1=1", "outFields": "*", "returnGeometry": "true", "outSR": "4326", "inSR": "4326",
               "geometryType": "esriGeometryPoint", "spatialRel": "esriSpatialRelIntersects", "geometry": pt, "distance": "3", "units": "esriSRUnit_StatuteMile"})
    for i, u in enumerate(LINES):
        check(res, f"lines-{i}", "national power line layer (HIFLD style)", u + "?f=json")
    found = []
    if discover:
        for rt in WI_DNR_ROOTS:
            st, acao, body = fetch(rt + "?f=json")
            save("wi-dnr-root-%d.json" % WI_DNR_ROOTS.index(rt), body)
            try:
                folders = json.loads(body).get("folders", [])
            except Exception:  # noqa: BLE001
                folders = []
            for fo in folders:
                st, acao, b2 = fetch(f"{rt}/{fo}?f=json")
                try:
                    svcs = json.loads(b2).get("services", [])
                except Exception:  # noqa: BLE001
                    svcs = []
                for sv in svcs:
                    nm = sv.get("name", "")
                    if LOOKS_LIVESTOCK.search(nm):
                        u = f"{rt}/{nm}/{sv.get('type', 'MapServer')}"
                        st3, acao3, b3 = fetch(u + "?f=json")
                        save("wi-" + re.sub(r"[^A-Za-z0-9]+", "-", nm) + ".json", b3)
                        found.append({"url": u, "status": st3, "acao": acao3, "browser_ok": browser_ok(acao3)})
                        say(f"WI DNR candidate {u} {st3} acao={acao3}")
                time.sleep(0.5)
    summary = {
        "about": "What answered for Field Scout's on-and-around card, read from a GitHub runner with the page's Origin. "
                 "browser_ok means a web page may read the answer. Raw answers are on the raw branch at the saved path.",
        "checked_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "services": res,
        "wi_dnr_candidates": found,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(summary, f, indent=1, sort_keys=True)
    save("probe-log.txt", "\n".join(LOG).encode())
    ok = sum(1 for r in res if r["status"] == 200 and r["browser_ok"])
    print(f"::notice::field layers: {ok}/{len(res)} answers readable from a browser page")
    for r in res:
        if r["status"] != 200 or not r["browser_ok"]:
            print(f"::warning::{r['id']}: status {r['status']}, Access-Control-Allow-Origin {r['acao']}")


def selftest():
    assert browser_ok("*") and browser_ok("https://agsist.com") and not browser_ok(None) and not browser_ok("https://x.org")
    lng, lat = centroid(FIELDS["ia"]["ring"])
    assert abs(lng + 93.4976) < 1e-4 and abs(lat - 42.0618) < 1e-4
    w, e, s, n = box(-93.5, 42.06, 5)
    assert abs((n - s) - 10 / 69.0) < 1e-9 and e > -93.5 > w
    assert len(slope_points(FIELDS["wi"]["ring"], 4)) == 16
    sm = summarize(b'{"features":[{"attributes":{"FLD_ZONE":"AE"}}]}')
    assert sm["features"] == 1 and sm["attrs"] == ["FLD_ZONE"]
    assert summarize(b'[{"xlong":1,"ylat":2}]')["rows"] == 1
    assert summarize(b"<html>")["json"] is False
    assert LOOKS_LIVESTOCK.search("WT_CAFO_Permits") and not LOOKS_LIVESTOCK.search("FR_WIGO_MAP")
    print("selftest ok")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    else:
        run(discover="--discover" in sys.argv)
