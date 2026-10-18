"""Check (and find) the free public parcel services Field Scout reads.

data/land/parcel-services.json lists where the land card asks for parcel lines
and the owner of record. This script is the only thing that marks an entry
verified. An entry passes when all of these hold, read from a GitHub runner:

  * the layer answers its metadata (?f=json) and is a polygon layer,
  * the fields the entry names for the parcel number and the owner exist,
  * a test query at a point inside the county (or state) returns a parcel,
  * the answer carries Access-Control-Allow-Origin for agsist.com (or *), so a
    reader's browser is allowed to read it from the page. Same header a browser
    checks; a service that leaves it out cannot be used from the page at all.

  python3 scripts/probe_land_services.py              # recheck every entry, rewrite the file
  python3 scripts/probe_land_services.py --discover   # also search ArcGIS Online for county
                                                      # parcel layers in discover.states
  python3 scripts/probe_land_services.py --selftest

--discover keeps only layers published by a government office (the publishing
organization reads like a county, state or city office, or the service runs on
a .gov or .us host) and never a vendor assessor site. Every answer it read is
saved under data/land-raw/ (the workflow moves that to the raw branch), so a
person can check what was accepted and why. Coverage counts print at the end
and go into the file as coverage.
"""
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REG = os.path.join(ROOT, "data", "land", "parcel-services.json")
RAW = os.path.join(ROOT, "data", "land-raw", "services")
GEO = os.path.join(ROOT, "data", "atlas", "counties.geo.json")
ORIGIN = "https://agsist.com"
UA = "AGSIST land service check (agsist.com; sig@farmers1st.com)"
COUNTY_TOTAL = {"WI": 72, "MN": 87, "IA": 99, "IL": 102, "ND": 53, "SD": 66, "NE": 93, "IN": 92, "OH": 88, "KS": 105, "MO": 115, "MI": 83}
STNAME = {"WI": "Wisconsin", "MN": "Minnesota", "IA": "Iowa", "IL": "Illinois", "ND": "North Dakota", "SD": "South Dakota",
          "NE": "Nebraska", "IN": "Indiana", "OH": "Ohio", "KS": "Kansas", "MO": "Missouri", "MI": "Michigan"}

PID = re.compile(r"^((COUNTY_|STATE_)?PIN|PARCEL_?ID|PARCELID|PARCEL_?NO|PARCELNUM|PARCEL_?NUMBER|PARID|PID|TAX_?ID|TAXPARCELID|GPIN|PARCEL)$", re.I)
OWN = re.compile(r"^(OWNER_?NAME_?\d?|OWNERNME\d|OWNER\d?|OWNERS|OWN_?NAME\d?|DEED_?HOLD(ER)?_?\d?|TITLE_?OWNER|OWNER_?FULL_?NAME|PROPERTY_?OWNER|"
                 r"TAXPAYER_?NAME|TAXPAYER|OWNER_?1|NAME_?1|OWNNAME|BILL_?NAME|TAX_?NAME)$", re.I)
# an owner split into name parts (Winnebago County IL: OwnerFirstName, OwnerLastName); the page joins them into one line
OWN_PART = [("first", re.compile(r"^OWNER_?FIRST_?NAME$", re.I)), ("middle", re.compile(r"^OWNER_?MIDDLE_?(INIT(IAL)?|NAME)$", re.I)),
            ("last", re.compile(r"^OWNER_?LAST_?NAME$", re.I)), ("suffix", re.compile(r"^OWNER_?SUFFIX$", re.I))]
TAXNAME = re.compile(r"^(BILL_?NAME|TAX_?NAME)$", re.I)
MAIL = re.compile(r"^(MAIL(ING)?_?(ADDR(ESS)?)?\d?|PSTLADRESS|OWNER_?ADDR(ESS)?\d?|OWN_?ADD(R)?\d?|TAXPAYER_?ADDR(ESS)?\d?|MAIL_?CITY|MAIL_?STATE|MAIL_?ZIP)$", re.I)
SITE = re.compile(r"^(SITE_?ADDR(ESS)?|SITEADRESS|PROP(ERTY)?_?ADDR(ESS)?|SITUS(_?ADDR(ESS)?)?|PHYSICAL_?ADDR(ESS)?)$", re.I)
ACRES = re.compile(r"^(GIS_?ACRES|DEED_?ACRES|ACRES|ACREAGE|CALC_?ACRES|TOTAL_?ACRES|ASSD_?ACRES|DEEDACRES|GISACRES)$", re.I)
LAND = re.compile(r"^(LAND_?VAL(UE)?|LNDVALUE|ASSESSED_?LAND|LAND_?ASSESS(ED)?|EMV_?LAND)$", re.I)
IMP = re.compile(r"^(IMP(R(OVEMENT)?)?_?VAL(UE)?|IMPVALUE|BLDG_?VAL(UE)?|BUILDING_?VAL(UE)?|EMV_?BLDG)$", re.I)
TOTAL = re.compile(r"^(TOTAL_?VAL(UE)?|ASSESSED_?VAL(UE)?|TOT_?VAL|CNTASSDVALUE|EMV_?TOTAL|TOTAL_?ASSESS(ED)?)$", re.I)
CLS = re.compile(r"^(PROP(ERTY)?_?CLASS|PROPCLASS|CLASS(_?CODE)?|USE_?CODE|LAND_?USE|USECLASS\d?)$", re.I)
LEGAL = re.compile(r"^(LEGAL(_?DESC(RIPTION)?)?\d?|LEGALDESC\d?|ABBREV_?LEGAL)$", re.I)
GOV = re.compile(r"\b(county|state|city|township|town of|village|dept|department|division|office|commission|authority|"
                 r"gis|government|dnr|dot|mngeo|geospatial|land information|assessor|auditor|recorder|treasurer|"
                 r"university|survey)\b", re.I)
VENDOR = re.compile(r"beacon|schneider|qpublic|vanguard|tyler|devnet|fidlar|landmark|regrid|loveland|reportall|"
                    r"acrevalue|plat ?book|mapping solutions|arch ?beacon|esri (inc|staff)|wthgis", re.I)


LOG = []
# discover.refused: services whose own terms forbid public reuse (Nebraska's statewide file is "for official,
# internal use by the State"). Never checked, never added, whoever finds them.
REFUSED = []


def say(line):
    """Print a line and keep it for the raw log (the runner's own log is not always readable later)."""
    print(line)
    LOG.append(line)


def get(url, params=None, origin=False, timeout=45):
    if params:
        url = url + ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
    h = {"User-Agent": UA, "Accept": "application/json"}
    if origin:
        h["Origin"] = ORIGIN
    req = urllib.request.Request(url, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read()
        return r.status, dict((k.lower(), v) for k, v in r.headers.items()), body


def cors_ok(headers):
    a = (headers or {}).get("access-control-allow-origin", "").strip()
    return a == "*" or a.rstrip("/") == ORIGIN


def guess_fields(fields):
    """Field map for a layer, from its field names. Only names that look like the thing."""
    names = [f.get("name", "") for f in fields or []]

    def all_of(rx):
        return [n for n in names if rx.match(n)]
    out = {}
    for key, rx in (("pid", PID), ("owner", OWN), ("mail", MAIL), ("site", SITE), ("land", LAND),
                    ("imp", IMP), ("total", TOTAL), ("cls", CLS), ("legal", LEGAL)):
        hit = all_of(rx)
        if key == "owner" and any(not TAXNAME.match(n) for n in hit):
            hit = [n for n in hit if not TAXNAME.match(n)]   # the tax bill name only when no owner field
        if hit:
            out[key] = hit[:4]
    parts = dict((k, next((n for n in names if rx.match(n)), None)) for k, rx in OWN_PART)
    if "owner" not in out and parts["last"]:
        out["owner_parts"] = [parts[k] for k in ("first", "middle", "last", "suffix") if parts[k]]
        out["owner"] = [parts["last"]]      # what the checker and a blank-owner test read; the page shows owner_parts joined
    ac = all_of(ACRES)
    for n in ac:
        u = n.upper()
        k = "deed_acres" if "DEED" in u else "assd_acres" if "ASSD" in u else "gis_acres"
        out.setdefault(k, [n])
    return out


def is_gov(publisher, url):
    host = urllib.parse.urlparse(url).hostname or ""
    if VENDOR.search(publisher or "") or VENDOR.search(host):
        return False
    if host.endswith(".gov") or host.endswith(".us") or ".state." in host or host.endswith(".edu"):
        return True
    return bool(GOV.search(publisher or ""))


def county_points():
    g = json.load(open(GEO))
    out = {}
    for f in g["features"]:
        gm = f["geometry"]
        ring = gm["coordinates"][0] if gm["type"] == "Polygon" else max(gm["coordinates"], key=lambda p: len(p[0]))[0]
        # a point inside: try the vertex average, then nudge toward vertices until inside
        x = sum(p[0] for p in ring) / len(ring)
        y = sum(p[1] for p in ring) / len(ring)
        pt = (x, y)
        if not inside(pt, ring):
            for p in ring[:: max(1, len(ring) // 40)]:
                q = ((p[0] + x) / 2, (p[1] + y) / 2)
                if inside(q, ring):
                    pt = q
                    break
        out[str(f["id"])] = {"name": f["properties"]["name"], "st": f["properties"]["st"], "pt": pt}
    return out


def inside(pt, ring):
    x, y = pt
    ins = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi:
            ins = not ins
        j = i
    return ins


def save_raw(name, body):
    os.makedirs(RAW, exist_ok=True)
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", name)[:120]
    with open(os.path.join(RAW, safe), "wb") as f:
        f.write(body if isinstance(body, bytes) else body.encode())


def check(entry, pt, tag):
    """Returns (verified, notes). pt = (lng, lat) inside the area the entry covers."""
    notes = []
    url = entry["url"].rstrip("/")
    bad = [r for r in REFUSED if url.lower().startswith(r["url"].lower().rstrip("/"))]
    if bad:
        return False, ["refused: %s" % bad[0].get("why", "its terms forbid reuse")]
    try:
        st, h, body = get(url, {"f": "json"}, origin=True)
        save_raw(tag + "-meta.json", body)
        meta = json.loads(body)
    except Exception as e:  # noqa: BLE001
        return False, ["metadata did not answer: %s" % e]
    if meta.get("error"):
        return False, ["metadata error: %s" % meta["error"]]
    if "Polygon" not in str(meta.get("geometryType", "")):
        notes.append("not a polygon layer: %s" % meta.get("geometryType"))
    names = set(f.get("name") for f in meta.get("fields") or [])
    F = entry.get("fields") or {}
    for k in ("pid", "owner"):
        have = [n for n in F.get(k, []) if n in names]
        if not have:
            notes.append("no %s field (wanted %s)" % (k, F.get(k)))
    missing = sorted(n for v in F.values() for n in v if n not in names)
    if missing:
        notes.append("named fields not in the layer: %s" % ", ".join(missing))
        entry["fields"] = {k: [n for n in v if n in names] for k, v in F.items() if any(n in names for n in v)}
    t = (meta.get("editingInfo") or {}).get("dataLastEditDate") or (meta.get("editingInfo") or {}).get("lastEditDate")
    if t:
        entry["data_last_edit"] = time.strftime("%Y-%m-%d", time.gmtime(t / 1000))
    try:
        st, h, body = get(url + "/query", {"f": "json", "geometry": "%f,%f" % pt, "geometryType": "esriGeometryPoint", "inSR": 4326,
                                           "spatialRel": "esriSpatialRelIntersects", "outFields": "*", "returnGeometry": "false"}, origin=True)
        save_raw(tag + "-query.json", body)
        q = json.loads(body)
    except Exception as e:  # noqa: BLE001
        return False, notes + ["test query failed: %s" % e]
    feats = q.get("features") or []
    if not feats:
        notes.append("test query at %.4f,%.4f returned no parcel" % (pt[1], pt[0]))
    else:
        a = feats[0].get("attributes") or {}
        own = [a.get(n) for n in (entry.get("fields") or {}).get("owner", [])]
        if not any(str(v or "").strip() for v in own):
            notes.append("test parcel has a blank owner (the publisher may withhold owners)")
    if not cors_ok(h):
        notes.append("no Access-Control-Allow-Origin for agsist.com; a browser page cannot read it")
    ok = not [n for n in notes if not n.startswith("named fields")]
    return ok, notes or ["ok"]


def discover_county(fips, c, seen):
    """Search ArcGIS Online for a public parcel layer this county publishes."""
    stname = STNAME.get(c["st"], c["st"])
    # The state name first: a bare "Story County" search fills up with same-named counties elsewhere.
    items, ids = [], set()
    for i, q in enumerate(('"%s County" %s parcels (type:"Feature Service" OR type:"Map Service")' % (c["name"], stname),
                           '"%s County" parcels (type:"Feature Service" OR type:"Map Service")' % c["name"])):
        try:
            _, _, body = get("https://www.arcgis.com/sharing/rest/search", {"q": q, "f": "json", "num": 25})
            save_raw("search-%s-%d.json" % (fips, i), body)
            got = json.loads(body).get("results") or []
        except Exception as e:  # noqa: BLE001
            if i == 0:
                continue
            if not items:
                return None, "search failed: %s" % e
            got = []
        for it in got:
            if it.get("id") not in ids:
                ids.add(it.get("id"))
                items.append(it)
    for it in items:
        title = (it.get("title") or "") + " " + (it.get("snippet") or "") + " " + " ".join(t for t in (it.get("tags") or []) if t)
        if c["name"].lower() not in title.lower() or not re.search(r"parcel", title, re.I):
            continue
        if it.get("access") != "public" or not it.get("url"):
            continue
        pub = "%s %s" % (it.get("owner") or "", it.get("orgName") or "")
        if it.get("orgId"):
            try:
                _, _, ob = get("https://www.arcgis.com/sharing/rest/portals/%s" % it["orgId"], {"f": "json"})
                pub += " " + (json.loads(ob).get("name") or "")
            except Exception:  # noqa: BLE001
                pass
        if stname.lower() not in (title + pub).lower() and c["st"].lower() not in (it.get("url") or "").lower() and "county" not in pub.lower():
            continue
        if not is_gov(pub, it["url"]):
            continue
        base = it["url"].rstrip("/")
        layers = [base] if re.search(r"/\d+$", base) else []
        if not layers:
            try:
                _, _, sb = get(base, {"f": "json"})
                sv = json.loads(sb)
                for L in sv.get("layers") or []:
                    if "polygon" in str(L.get("geometryType", "")).lower() or re.search(r"parcel", L.get("name") or "", re.I):
                        layers.append("%s/%s" % (base, L["id"]))
            except Exception:  # noqa: BLE001
                continue
        for lu in layers[:4]:
            if lu in seen:
                continue
            seen.add(lu)
            try:
                _, _, mb = get(lu, {"f": "json"})
                meta = json.loads(mb)
            except Exception:  # noqa: BLE001
                continue
            F = guess_fields(meta.get("fields"))
            if "pid" not in F or "owner" not in F:
                continue
            e = {"id": "co-%s" % fips, "verified": False, "name": "%s County parcels" % c["name"], "by": pub.strip(),
                 "url": lu, "about": "https://www.arcgis.com/home/item.html?id=%s" % it.get("id"), "fields": F, "found": "arcgis-search"}
            ok, notes = check(e, c["pt"], "co-%s" % fips)
            e["verified"], e["notes"] = ok, notes
            e["checked_utc"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            if ok:
                return e, "ok"
    return None, "no public government parcel layer with owner fields found"


BTAA = "https://geo.btaa.org/catalog/%s-parcels-05000US%s.json"
# The record pages exist (geo.btaa.org/catalog/ia-parcels-05000US19197) but the .json form answered 404 for
# every county on Oct 17; the raw record, the OAI export and the page itself name the same service URLs.
BTAA_FORMS = ("https://geo.btaa.org/catalog/%s-parcels-05000US%s/raw", "https://geo.btaa.org/catalog/%s-parcels-05000US%s.json",
              "https://geo.btaa.org/catalog/%s-parcels-05000US%s.oai_dc_xml", "https://geo.btaa.org/catalog/%s-parcels-05000US%s")
REST_URL = re.compile(r"https://[^\s\"'\\<>]+?/rest/services/[^\s\"'\\<>?#]+?/(?:MapServer|FeatureServer)(?:/\d+)?(?=[\s\"'\\<>?#/]|$)")


def rest_urls(text):
    """ArcGIS service or layer URLs named in a catalog record, in the order they appear."""
    out = []
    for u in REST_URL.findall(text or ""):
        if u not in out:
            out.append(u)
    return out


def discover_btaa(fips, c, seen):
    """The Big Ten Academic Alliance geoportal keeps a record of each county's own parcel service
    (Iowa and others). Read the service it names, then check it like any other."""
    text, errs = None, []
    for i, form in enumerate(BTAA_FORMS):
        try:
            _, _, body = get(form % (c["st"].lower(), fips))
        except Exception as e:  # noqa: BLE001
            errs.append(str(e))
            continue
        t = body.decode("utf-8", errors="replace")
        if rest_urls(t):
            save_raw("btaa-%s-%d.txt" % (fips, i), body)
            text = t
            break
        errs.append("form %d named no service" % i)
    if text is None:
        return None, "no geoportal record (%s)" % "; ".join(sorted(set(errs)))
    m = re.search(r'"dct_publisher_sm"\s*:\s*\[\s*"([^"]+)"', text) or re.search(r'"schema_provider_s"\s*:\s*"([^"]+)"', text)
    pub = m.group(1) if m else ""
    for su in rest_urls(text):
        if VENDOR.search(su) or VENDOR.search(pub):
            continue
        for lu in layers_of(su):
            if lu in seen:
                continue
            seen.add(lu)
            try:
                _, _, mb = get(lu, {"f": "json"})
                F = guess_fields(json.loads(mb).get("fields"))
            except Exception:  # noqa: BLE001
                continue
            if "pid" not in F or "owner" not in F:
                continue
            e = {"id": "co-%s" % fips, "verified": False, "name": "%s County parcels" % c["name"], "by": pub or "%s County" % c["name"],
                 "url": lu, "about": BTAA.replace(".json", "") % (c["st"].lower(), fips), "fields": F, "found": "btaa-geoportal"}
            ok, notes = check(e, c["pt"], "co-%s" % fips)
            e["verified"], e["notes"] = ok, notes
            e["checked_utc"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            if ok:
                return e, "ok (geoportal record)"
    return None, "geoportal record has no working owner layer"


def slug(n):
    return re.sub(r"[^a-z]", "", (n or "").lower().replace("saint", "st"))


def county_hints(disc, st, pts):
    """{fips: [(url, how, about)]} from a state's own catalogs, read once per run:
    service_roots: a GIS server whose folders are named per county (MnGeo hosts us_mn_co_<county>/plan_parcels);
    ckan: a CKAN catalog whose county parcel datasets name their ArcGIS service (gisdata.mn.gov)."""
    by = dict((slug(c["name"]), f) for f, c in pts.items() if c["st"] == st)
    out = {}
    for r in (disc.get("service_roots") or {}).get(st, []):
        try:
            _, _, b = get(r["url"], {"f": "json"})
            save_raw("root-%s.json" % slug(r["url"])[-60:], b)
            folders = json.loads(b).get("folders") or []
        except Exception as e:  # noqa: BLE001
            say("%s service root %s did not answer: %s" % (st, r["url"], e))
            continue
        pre = r.get("folder_prefix", "")
        for fo in folders:
            if pre and not fo.lower().startswith(pre.lower()):
                continue
            f = by.get(slug(fo[len(pre):]))
            if f:
                out.setdefault(f, []).append((r["url"].rstrip("/") + "/" + fo, "service-root", r.get("about")))
        say("%s service root %s: %d county folders" % (st, r["url"], sum(1 for v in out.values() for h in v if h[1] == "service-root")))
    for ck in (disc.get("ckan") or {}).get(st, []):
        try:
            _, _, b = get(ck["url"], {"q": ck.get("q", "parcels"), "rows": 1000})
            save_raw("ckan-%s.json" % st.lower(), b)
            res = (json.loads(b).get("result") or {}).get("results") or []
        except Exception as e:  # noqa: BLE001
            say("%s catalog %s did not answer: %s" % (st, ck["url"], e))
            continue
        rx = re.compile(ck["name_rx"], re.I)
        n = 0
        for d in res:
            m = rx.search(d.get("name") or "")
            f = m and by.get(slug(m.group(1)))
            if not f:
                continue
            for R in d.get("resources") or []:
                for u in rest_urls(R.get("url") or ""):
                    out.setdefault(f, []).append((u, "catalog", ck.get("page", "").replace("{name}", d.get("name") or "")))
                    n += 1
        say("%s catalog %s: %d county service links" % (st, ck["url"], n))
    return out


def discover_hint(fips, c, seen, hints):
    """Services a state catalog names for this county, checked like any other."""
    why = []
    for u, how, about in hints.get(fips, []):
        for lu in layers_of(u, why):
            if lu in seen:
                continue
            seen.add(lu)
            try:
                _, _, mb = get(lu, {"f": "json"})
                F = guess_fields(json.loads(mb).get("fields"))
            except Exception:  # noqa: BLE001
                continue
            if "pid" not in F or "owner" not in F:
                why.append("%s: no parcel number and owner fields" % lu)
                continue
            e = {"id": "co-%s" % fips, "verified": False, "name": "%s County parcels" % c["name"], "by": "%s County (state catalog)" % c["name"],
                 "url": lu, "about": about or u, "fields": F, "found": how}
            ok, notes = check(e, c["pt"], "co-%s" % fips)
            e["verified"], e["notes"] = ok, notes
            e["checked_utc"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            if ok:
                return e, "ok (%s)" % how
            why.append("%s: %s" % (lu, "; ".join(notes)))
    return None, ("state catalog: " + "; ".join(why[:3])) if why else "no state catalog link"


def owner_at(e, pt):
    """True when the layer has a parcel with a non-blank owner at this point."""
    try:
        _, _, body = get(e["url"].rstrip("/") + "/query", {"f": "json", "geometry": "%f,%f" % pt, "geometryType": "esriGeometryPoint", "inSR": 4326,
                                                         "spatialRel": "esriSpatialRelIntersects", "outFields": "*", "returnGeometry": "false"})
        feats = json.loads(body).get("features") or []
    except Exception:  # noqa: BLE001
        return None
    if not feats:
        return False
    a = feats[0].get("attributes") or {}
    return any(str(a.get(n) or "").strip() for n in (e.get("fields") or {}).get("owner", []))


def county_cover(e, st, pts):
    """A statewide layer can leave counties out or blank their owners (Minnesota counties choose).
    Ask once per county and keep the list of counties where an owner came back."""
    got, blank = [], []
    for fips, c in sorted(pts.items()):
        if c["st"] != st:
            continue
        r = owner_at(e, c["pt"])
        (got if r else blank).append(fips)
        time.sleep(0.2)
    e["covers"] = got
    e["no_owner_counties"] = blank
    return e


def discover_statewide(st, cand, pts, seen):
    try:
        _, _, body = get("https://www.arcgis.com/sharing/rest/search", {"q": '%s (type:"Feature Service" OR type:"Map Service")' % cand["search"], "f": "json", "num": 25})
        save_raw("search-statewide-%s.json" % st, body)
        items = json.loads(body).get("results") or []
    except Exception as e:  # noqa: BLE001
        return None
    cos = [v for v in pts.values() if v["st"] == st]
    for it in items:
        if it.get("access") != "public" or not it.get("url"):
            continue
        pub = "%s %s" % (it.get("owner") or "", it.get("orgName") or "")
        if not is_gov(pub, it["url"]):
            continue
        base = it["url"].rstrip("/")
        layers = [base] if re.search(r"/\d+$", base) else []
        if not layers:
            try:
                _, _, sb = get(base, {"f": "json"})
                layers = ["%s/%s" % (base, L["id"]) for L in json.loads(sb).get("layers") or [] if "polygon" in str(L.get("geometryType", "")).lower()]
            except Exception:  # noqa: BLE001
                continue
        for lu in layers[:3]:
            if lu in seen:
                continue
            seen.add(lu)
            try:
                _, _, mb = get(lu, {"f": "json"})
                F = guess_fields(json.loads(mb).get("fields"))
            except Exception:  # noqa: BLE001
                continue
            if "pid" not in F or "owner" not in F:
                continue
            e = {"id": "%s-statewide" % st.lower(), "verified": False, "name": cand["name"], "by": pub.strip(), "url": lu,
                 "about": cand.get("about"), "fields": F, "found": "arcgis-search"}
            ok, notes = check(e, cos[len(cos) // 2]["pt"], e["id"])
            e["verified"], e["notes"] = ok, notes
            e["checked_utc"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            if ok:
                return county_cover(e, st, pts)
    return None


def coverage(reg, pts):
    out = {}
    for st, total in COUNTY_TOTAL.items():
        sw = [s for s in (reg.get("statewide") or {}).get(st, []) if s.get("verified")]
        whole = any("covers" not in s for s in sw)
        covered = set(f for s in sw for f in s.get("covers", []))
        cos = [f for f, v in pts.items() if v["st"] == st]
        n = 0
        for f in cos:
            ents = (reg.get("counties") or {}).get(f) or []
            if whole or f in covered or any(e.get("verified") for e in ents):
                n += 1
        out[st] = {"parcels_statewide_verified": bool(sw), "parcels_counties_verified": n, "of": total}
    return out


POINT_MISS = ("test query at", "test parcel has a blank owner")


def check_state(e, st, pts):
    """A statewide entry. One that only some counties fill (partial: Minnesota's opt-in file) passes
    when the layer itself checks out and at least one county gives an owner back; covers lists them."""
    cos = [v for v in pts.values() if v["st"] == st]
    ok, notes = check(e, cos[len(cos) // 2]["pt"], e["id"])
    if e.get("partial") or "covers" in e:
        hard = [n for n in notes if n != "ok" and not n.startswith("named fields") and not n.startswith(POINT_MISS)]
        if not hard and (e.get("fields") or {}).get("owner"):
            county_cover(e, st, pts)
            ok = bool(e["covers"])
            notes = [n for n in notes if not n.startswith(POINT_MISS)] + ["owners in %d of %d counties" % (len(e["covers"]), len(cos))]
        else:
            e["covers"] = []
    return ok, notes


SVC_NAME = re.compile(r"parcel|tax|assess|cadast|land_?rec|landrecord|owner|property|plan_parcels", re.I)


def is_dir(url):
    """A services root (.../rest/services) or one folder under it, not a service."""
    return bool(re.search(r"/rest/services(/[^/]+)?$", url, re.I)) and not re.search(r"/(MapServer|FeatureServer)$", url, re.I)


def services_in(url, why=None):
    """Parcel-like services listed in a services root or folder (one folder level down from a root)."""
    try:
        _, _, b = get(url, {"f": "json"})
        d = json.loads(b)
    except Exception as e:  # noqa: BLE001
        if why is not None:
            why.append("directory did not answer: %s" % e)
        return []
    base = re.sub(r"(/rest/services).*$", r"\1", url, flags=re.I)
    out = []
    for sv in d.get("services") or []:
        if sv.get("type") in ("MapServer", "FeatureServer") and SVC_NAME.search(sv.get("name") or ""):
            u = "%s/%s/%s" % (base, sv["name"], sv["type"])
            if u not in out:
                out.append(u)
    out.sort(key=lambda u: not u.endswith("FeatureServer"))   # a feature service names its fields the same and answers faster
    if not out and why is not None:
        why.append("directory lists no parcel-named service (%s)" % ", ".join(str(x.get("name")) for x in (d.get("services") or [])[:20]))
    return out[:4]


def layers_of(url, why=None):
    """A layer URL as is; a service URL becomes its polygon (or parcel-named) layers; a services
    root or folder becomes the layers of its parcel-named services.
    why, a list, gets the reason when nothing comes back."""
    url = url.rstrip("/")
    if re.search(r"/\d+$", url):
        return [url]
    if is_dir(url):
        out = []
        for su in services_in(url, why):
            for lu in layers_of(su, why):
                if lu not in out:
                    out.append(lu)
        return out[:8]
    try:
        _, _, sb = get(url, {"f": "json"})
        sv = json.loads(sb)
    except Exception as e:  # noqa: BLE001
        if why is not None:
            why.append("service did not answer: %s" % e)
        return []
    if sv.get("error") and why is not None:
        why.append("service error: %s" % sv["error"])
    out = ["%s/%s" % (url, L["id"]) for L in sv.get("layers") or []
           if "polygon" in str(L.get("geometryType", "")).lower() or re.search(r"parcel|tax", L.get("name") or "", re.I)][:6]
    if not out and why is not None:
        why.append("layers: %s" % ", ".join("%s %s" % (L.get("id"), L.get("name")) for L in (sv.get("layers") or [])[:30]))
    return out


def check_candidate(c, pts, now):
    """A service someone found by hand (discover.candidates). Its fields are read from the layer;
    it is added to the registry only when check() passes, never on the say-so of the list."""
    st, fips = c["st"], c.get("fips")
    tag = "cand-%s" % (fips or c.get("id") or st.lower())
    why = []
    lays = layers_of(c["url"], why)
    last = ["no polygon layer answered" + (": " + "; ".join(why) if why else "")]
    for i, lu in enumerate(lays):
        try:
            _, _, mb = get(lu, {"f": "json"})
            save_raw("%s-%d-meta.json" % (tag, i), mb)
            F = guess_fields(json.loads(mb).get("fields"))
        except Exception as ex:  # noqa: BLE001
            last = ["metadata did not answer: %s" % ex]
            continue
        if "pid" not in F or "owner" not in F:
            names = [f.get("name") for f in json.loads(mb).get("fields") or []]
            last = ["%s: no parcel number and owner fields by name (fields: %s)" % (lu, ", ".join(map(str, names[:60])))]
            continue
        e = {"id": "co-%s" % fips if fips else c.get("id") or "%s-statewide" % st.lower(), "verified": False,
             "name": c.get("name") or ("%s County parcels" % pts[fips]["name"] if fips else "%s statewide parcels" % st),
             "by": c.get("by", ""), "url": lu, "about": c.get("about"), "fields": F, "found": "candidate"}
        if c.get("terms"):
            e["terms"] = c["terms"]
        if c.get("partial"):
            e["partial"] = True
        if fips:
            ok, notes = check(e, pts[fips]["pt"], tag)
        else:
            ok, notes = check_state(e, st, pts)
        e["verified"], e["notes"], e["checked_utc"] = ok, notes, now
        last = ["%s: %s" % (lu, "; ".join(notes))]
        if ok:
            return e, last
    return None, last


def run(discover, only=None):
    """only: the states to search with --discover (all of discover.states when None)."""
    reg = json.load(open(REG))
    REFUSED[:] = (reg.get("discover") or {}).get("refused") or []
    pts = county_points()
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    for st, ents in (reg.get("statewide") or {}).items():
        for e in ents:
            ok, notes = check_state(e, st, pts)
            e["verified"], e["notes"], e["checked_utc"] = ok, notes, now
            say("%s %s: %s" % ("ok  " if ok else "FAIL", e["id"], "; ".join(notes)))
        ents.sort(key=lambda x: not x.get("verified"))   # a page tries them in order: working ones first
    known = set(e["url"].rstrip("/") for v in list((reg.get("counties") or {}).values()) + list((reg.get("statewide") or {}).values()) for e in v)
    for c in (reg.get("discover") or {}).get("candidates") or []:
        if any(u == c["url"].rstrip("/") or u.startswith(c["url"].rstrip("/") + "/") for u in known):
            c["last"] = {"checked_utc": now, "notes": ["in the registry"]}
            continue
        try:
            e, notes = check_candidate(c, pts, now)
        except Exception as ex:  # noqa: BLE001  one odd answer must not stop the rest
            e, notes = None, ["error: %s" % ex]
        c["last"] = {"checked_utc": now, "notes": notes}
        say("%s candidate %s %s: %s" % ("ok  " if e else "FAIL", c["st"], c.get("fips") or "statewide", "; ".join(notes)))
        if not e:
            continue
        if c.get("fips"):
            reg.setdefault("counties", {})[c["fips"]] = [e] + [x for x in reg["counties"].get(c["fips"], []) if x.get("verified")]
        else:
            if c["st"] == "WI":
                e["builtin"] = True
            reg.setdefault("statewide", {}).setdefault(c["st"], []).insert(0, e)
        known.add(e["url"])
    for fips, ents in list((reg.get("counties") or {}).items()):
        for e in ents:
            ok, notes = check(e, pts[fips]["pt"], e["id"])
            e["verified"], e["notes"], e["checked_utc"] = ok, notes, now
            say("%s %s: %s" % ("ok  " if ok else "FAIL", e["id"], "; ".join(notes)))
    if discover:
        seen = set(e["url"] for v in (reg.get("counties") or {}).values() for e in v)
        for st, cands in ((reg.get("discover") or {}).get("statewide_candidates") or {}).items():
            if any(x.get("verified") for x in (reg.get("statewide") or {}).get(st, [])):
                continue
            for cand in cands:
                e = discover_statewide(st, cand, pts, seen)
                say("%s statewide %s: %s" % (st, cand["name"], "found %s, owners in %d counties" % (e["url"], len(e["covers"])) if e else "none verified"))
                if e:
                    reg.setdefault("statewide", {}).setdefault(st, []).append(e)
                    break
        for st in (reg.get("discover") or {}).get("states", []):
            if only and st not in only:
                continue
            sw = [x for x in (reg.get("statewide") or {}).get(st, []) if x.get("verified")]
            if sw and not any("covers" in x for x in sw):
                continue
            hints = county_hints(reg.get("discover") or {}, st, pts)
            covered = set(f for x in sw for f in x.get("covers", []))
            for fips, c in sorted(pts.items()):
                if c["st"] != st or fips in covered or any(e.get("verified") for e in (reg.get("counties") or {}).get(fips, [])):
                    continue
                e, why = None, ""
                for how in (lambda f, c, s: discover_hint(f, c, s, hints), discover_btaa, discover_county):
                    try:
                        e, w = how(fips, c, seen)
                    except Exception as ex:  # noqa: BLE001  one odd answer must not stop the other counties
                        e, w = None, "discovery error: %s" % ex
                    why = (why + "; " if why else "") + w
                    if e:
                        break
                say("%s %s %s County: %s" % (st, fips, c["name"], why))
                if e:
                    reg.setdefault("counties", {})[fips] = [e]
                time.sleep(0.4)
    reg["checked_utc"] = now
    reg["coverage"] = coverage(reg, pts)
    for st, v in reg["coverage"].items():
        say("::notice::parcel and owner coverage %s: %d of %d counties%s" % (st, v["parcels_counties_verified"], v["of"], " (statewide)" if v["parcels_statewide_verified"] else ""))
    with open(REG, "w") as f:
        json.dump(reg, f, indent=1)
        f.write("\n")
    save_raw("probe-log.txt", "\n".join(LOG) + "\n")
    return 0


def selftest():
    bad = 0

    def ck(name, ok):
        nonlocal bad
        print(("ok   " if ok else "FAIL ") + name)
        bad += 0 if ok else 1
    F = guess_fields([{"name": n} for n in ["OBJECTID", "PIN", "OWNER_NAME", "OWNER_NAME2", "MAIL_ADDR", "SITE_ADDR", "DEED_ACRES", "GIS_ACRES", "LAND_VALUE", "BLDG_VALUE", "LEGAL_DESC", "Shape"]])
    ck("finds parcel number", F.get("pid") == ["PIN"])
    ck("finds both owner fields", F.get("owner") == ["OWNER_NAME", "OWNER_NAME2"])
    ck("finds acres by kind", F.get("deed_acres") == ["DEED_ACRES"] and F.get("gis_acres") == ["GIS_ACRES"])
    ck("finds values", F.get("land") == ["LAND_VALUE"] and F.get("imp") == ["BLDG_VALUE"])
    ck("no owner field, no owner", "owner" not in guess_fields([{"name": "PIN"}, {"name": "ZONING"}]))
    ck("WI V11 schema", guess_fields([{"name": n} for n in ["PARCELID", "OWNERNME1", "PSTLADRESS", "GISACRES", "LNDVALUE", "IMPVALUE", "PROPCLASS"]]).get("owner") == ["OWNERNME1"])
    ck("county office is government", is_gov("Story County Iowa GIS", "https://services.arcgis.com/x/arcgis/rest/services/Parcels/FeatureServer/0"))
    ck(".gov host is government", is_gov("someone", "https://gis.co.example.mn.us/arcgis/rest/services/Parcels/MapServer/0"))
    ck("vendor assessor site is not", not is_gov("Schneider Geospatial Beacon", "https://beacon.schneidercorp.com/x"))
    ck("a private publisher is not", not is_gov("Joe Smith", "https://services.arcgis.com/x/arcgis/rest/services/Parcels/FeatureServer/0"))
    ck("CORS star passes", cors_ok({"access-control-allow-origin": "*"}))
    ck("CORS our origin passes", cors_ok({"access-control-allow-origin": "https://agsist.com"}))
    ck("CORS missing fails", not cors_ok({}))
    ck("CORS other site fails", not cors_ok({"access-control-allow-origin": "https://example.com"}))
    ck("point in ring", inside((0.5, 0.5), [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]) and not inside((2, 2), [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]))
    global get, save_raw
    real_get, real_save = get, save_raw
    get = lambda *a, **k: (200, {}, json.dumps({"results": [{"title": None, "snippet": None, "tags": None, "owner": None, "access": "public", "url": None}]}))
    save_raw = lambda *a, **k: None
    try:
        ck("search answer with empty title and snippet is skipped, not a crash", discover_county("00000", {"name": "Test", "st": "IA"}, set())[0] is None)
    except Exception as ex:  # noqa: BLE001
        ck("search answer with empty title and snippet is skipped, not a crash (%s)" % ex, False)
    finally:
        get, save_raw = real_get, real_save
    G = guess_fields([{"name": n} for n in ["COUNTY_PIN", "OWNER_NAME", "TAX_NAME"]])
    ck("Minnesota standard: county PIN, and the owner field over the tax bill name", G.get("pid") == ["COUNTY_PIN"] and G.get("owner") == ["OWNER_NAME"])
    ck("tax bill name only when there is no owner field", guess_fields([{"name": "PIN"}, {"name": "BILLNAME"}]).get("owner") == ["BILLNAME"])
    ck("deed holder fields", guess_fields([{"name": "PARID"}, {"name": "DeedHolder1"}]).get("owner") == ["DeedHolder1"])
    rec = '{"dct_references_s":"{\\"urn:x-esri:serviceType:ArcGIS#DynamicMapLayer\\":\\"https://gis.co.x.ia.us/arcgis/rest/services/Parcels/MapServer\\"}","u":"https://a.gov/arcgis/rest/services/P/FeatureServer/3?f=json"}'
    ck("service URLs out of a geoportal record", rest_urls(rec) == ["https://gis.co.x.ia.us/arcgis/rest/services/Parcels/MapServer", "https://a.gov/arcgis/rest/services/P/FeatureServer/3"])
    # a statewide layer only some counties fill: passes on the counties that answer with an owner
    pts = county_points()
    mn = sorted(f for f, v in pts.items() if v["st"] == "MN")
    hit = pts[mn[0]]["pt"]

    def fake(url, params=None, origin=False, timeout=45):
        if url.endswith("/query"):
            on = params["geometry"] == "%f,%f" % hit
            return 200, {"access-control-allow-origin": "*"}, json.dumps({"features": [{"attributes": {"PIN": "1", "OWNER_NAME": "SYNTHETIC OWNER" if on else ""}}] if on else []})
        return 200, {"access-control-allow-origin": "*"}, json.dumps({"geometryType": "esriGeometryPolygon", "fields": [{"name": "PIN"}, {"name": "OWNER_NAME"}]})
    real_sleep = time.sleep
    get, save_raw, time.sleep = fake, (lambda *a, **k: None), (lambda *_: None)
    try:
        e = {"id": "mn-t", "partial": True, "url": "https://x.gov/arcgis/rest/services/P/FeatureServer/0", "fields": {"pid": ["PIN"], "owner": ["OWNER_NAME"]}}
        ok, notes = check_state(e, "MN", pts)
        ck("partial statewide layer passes on the one county that answers", ok and e["covers"] == [mn[0]] and len(e["no_owner_counties"]) == len(mn) - 1)
        e2 = {"id": "mn-u", "url": "https://x.gov/arcgis/rest/services/P/FeatureServer/0", "fields": {"pid": ["PIN"], "owner": ["OWNER_NAME"]}}
        ck("a whole-state layer still needs its own test parcel", not check_state(e2, "MN", pts)[0] and "covers" not in e2)
    finally:
        get, save_raw, time.sleep = real_get, real_save, real_sleep
    # Oct 18 field names read from saved layers on the raw branch (Story IA DeedHold, Winnebago IL OwnerLastName, Marshall IA title_owner)
    ck("Story County IA deed holder fields", guess_fields([{"name": n} for n in ["PIN", "DeedHold", "DeedHold2", "MailName"]]).get("owner") == ["DeedHold", "DeedHold2"])
    W = guess_fields([{"name": n} for n in ["PrimaryPIN", "PIN", "OwnerLastName", "OwnerFirstName", "OwnerMiddleInit", "OwnerSuffix", "TaxpayerLastName"]])
    ck("owner in name parts: first middle last suffix, in reading order", W.get("owner_parts") == ["OwnerFirstName", "OwnerMiddleInit", "OwnerLastName", "OwnerSuffix"] and W.get("owner") == ["OwnerLastName"])
    ck("a whole owner field wins over name parts", "owner_parts" not in guess_fields([{"name": n} for n in ["PIN", "OWNER_NAME", "OwnerLastName"]]))
    ck("title owner and numbered owner names", guess_fields([{"name": n} for n in ["parcel_number", "title_owner", "owner_name1"]]).get("owner") == ["title_owner", "owner_name1"])
    ck("a 'major property owner' flag is not an owner", "owner" not in guess_fields([{"name": "PIN"}, {"name": "MAJOR_PROPERTY_OWNER"}]))
    REFUSED[:] = [{"url": "https://giscat.ne.gov/Enterprise/rest/services/TaxParcels2023", "why": "internal use only"}]
    ck("a refused service is never checked", check({"url": "https://giscat.ne.gov/Enterprise/rest/services/TaxParcels2023/FeatureServer/0"}, (0, 0), "t") == (False, ["refused: internal use only"]))
    REFUSED[:] = []
    ck("services root and folder are directories, a service is not",
       is_dir("https://x.gov/arcgis/rest/services") and is_dir("https://x.gov/arcgis/rest/services/us_mn_co_itasca")
       and not is_dir("https://x.gov/arcgis/rest/services/Parcels/MapServer"))

    def fake2(url, params=None, origin=False, timeout=45):
        if url.endswith("/rest/services"):
            return 200, {}, json.dumps({"folders": ["us_mn_co_itasca", "us_mn_co_lake_of_the_woods", "us_mn_state_dnr", "us_mn_co_nowhere"]})
        if url.endswith("/us_mn_co_itasca"):
            return 200, {}, json.dumps({"services": [{"name": "us_mn_co_itasca/plan_parcels", "type": "MapServer"},
                                                     {"name": "us_mn_co_itasca/plan_parcels", "type": "FeatureServer"},
                                                     {"name": "us_mn_co_itasca/trans_roads", "type": "FeatureServer"}]})
        if url.endswith("/FeatureServer") or url.endswith("/MapServer"):
            return 200, {}, json.dumps({"layers": [{"id": 0, "name": "Parcels", "geometryType": "esriGeometryPolygon"}]})
        if "package_search" in url:
            return 200, {}, json.dumps({"result": {"results": [{"name": "us-mn-co-hubbard-plan-parcels", "resources": [
                {"url": "https://gis.co.hubbard.mn.us/arcgis/rest/services/OpenData/TaxParcels/MapServer"}]}]}})
        return 200, {}, "{}"
    get, save_raw = fake2, (lambda *a, **k: None)
    try:
        root = "https://enterprise.gisdata.mn.gov/aghost/rest/services"
        ck("a folder becomes its parcel services' layers, feature service first",
           layers_of(root + "/us_mn_co_itasca") == [root + "/us_mn_co_itasca/plan_parcels/FeatureServer/0", root + "/us_mn_co_itasca/plan_parcels/MapServer/0"])
        H = county_hints({"service_roots": {"MN": [{"url": root, "folder_prefix": "us_mn_co_"}]},
                          "ckan": {"MN": [{"url": "https://gisdata.mn.gov/api/3/action/package_search", "q": "plan-parcels", "name_rx": "^us-mn-co-([a-z-]+)-plan-parcels"}]}}, "MN", pts)
        byname = dict((pts[f]["name"], [h[0] for h in v]) for f, v in H.items())
        ck("county folders map to counties by name (Lake of the Woods too), other folders do not",
           byname.get("Itasca") == [root + "/us_mn_co_itasca"] and byname.get("Lake of the Woods") == [root + "/us_mn_co_lake_of_the_woods"] and len([k for k in byname if k not in ("Itasca", "Lake of the Woods", "Hubbard")]) == 0)
        ck("a catalog dataset's service link maps to its county", byname.get("Hubbard") == ["https://gis.co.hubbard.mn.us/arcgis/rest/services/OpenData/TaxParcels/MapServer"])
    finally:
        get, save_raw = real_get, real_save
    reg = json.load(open(REG))
    ck("registry: Wisconsin statewide entries are builtin", all(e.get("builtin") for e in reg["statewide"]["WI"]))
    ck("registry: nothing is verified by hand (only this script sets it)",
       all(e.get("checked_utc") or not e.get("verified") for v in reg["statewide"].values() for e in v))
    print("FAILS=%d" % bad)
    return 1 if bad else 0


if __name__ == "__main__":
    a = sys.argv[1:]
    if "--selftest" in a:
        sys.exit(selftest())
    only = None
    for x in a:   # --discover=MN,IA searches only those states
        if x.startswith("--discover="):
            only = set(x.split("=", 1)[1].upper().replace(" ", "").split(",")) - {""}
    sys.exit(run("--discover" in a or only is not None, only))
