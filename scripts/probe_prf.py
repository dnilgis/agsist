#!/usr/bin/env python3
"""
probe_prf.py — first contact with the data behind USDA's Pasture, Rangeland,
Forage (PRF) rainfall index. Diagnostic only: it reads, prints and saves what
it found under probe-out/. It writes nothing the site publishes.

WHY A PROBE AND NOT A FETCHER
  Every USDA host is closed to the sandbox the code is written in, and run logs
  cannot be read from there either. So nothing about these sources is known
  until a runner has opened them: not the endpoint names behind RMA's own PRF
  tool, not which Actuarial Data Master tables carry the grid index, the rates
  and the county base values, not the field names. This prints one real record
  of each before any fetcher is written against it (rule 44: open one record
  and look at its keys).

WHAT IT ASKS
  app    RMA's PRF tool page and its scripts: which endpoints does it call?
  api    Those endpoints, plus the names older scrapers used, for one grid.
  gis    The grid layer the Grid Locator draws: fields, count, one feature,
         and the grid under one test point.
  adm    The Actuarial Data Master directory and the newest YTD zip: every
         member's header and first row, and for each member how many rows
         mention commodity 0088 (PRF) with the first three of them.
  pages  RMA's PRF policy pages: every link that names NCEI, rainfall, grid,
         index, or a spreadsheet.

USAGE
  python scripts/probe_prf.py                      # everything
  python scripts/probe_prf.py --steps app,api,gis  # a subset
  python scripts/probe_prf.py --grid 12345         # a grid id to ask the api for
"""

import argparse
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

UA = "AGSIST-automation/1.0 (+https://agsist.com)"
OUT = "probe-out"
REPORT = []

APP_HOSTS = ["https://public-rma.fpac.usda.gov", "https://prodwebnlb.rma.usda.gov"]
GIS = "https://pdgis.rm.usda.net/arcgis/rest/services/PRF/PRF_GRID/MapServer"
ADM = "https://pubfs-rma.fpac.usda.gov/pub/References/actuarial_data_master/"
# A point inside Barron County, Wisconsin. Approximate, used only to ask the
# grid layer "which grid is here". Never published.
TEST_LON, TEST_LAT = -91.65, 45.31


def say(*a):
    line = " ".join(str(x) for x in a)
    print(line, flush=True)
    REPORT.append(line)


def save(name, data):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    mode = "wb" if isinstance(data, (bytes, bytearray)) else "w"
    with open(path, mode) as f:
        f.write(data)
    return path


def get(url, timeout=90, limit=None):
    """Returns (status, headers dict, bytes) or (None, {}, error text as bytes)."""
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read(limit) if limit else r.read()
            say(f"  GET {url} -> {r.status} {len(body)} bytes {time.time()-t0:.1f}s "
                f"type={r.headers.get('Content-Type')}")
            return r.status, dict(r.headers), body
    except urllib.error.HTTPError as e:
        body = b""
        try:
            body = e.read(2000)
        except Exception:
            pass
        say(f"  GET {url} -> HTTP {e.code} {time.time()-t0:.1f}s body={body[:300]!r}")
        return e.code, dict(e.headers or {}), body
    except Exception as e:  # timeout, DNS, TLS, reset
        say(f"  GET {url} -> FAILED {type(e).__name__}: {e} ({time.time()-t0:.1f}s)")
        return None, {}, str(e).encode()


def slug(s):
    return re.sub(r"[^A-Za-z0-9._-]+", "_", s)[:120]


# ---------------------------------------------------------------- app

def step_app():
    say("\n=== app: RMA PRF tool page and scripts ===")
    found = set()
    for host in APP_HOSTS:
        base = host + "/apps/PRF/"
        st, _, body = get(base)
        if st != 200:
            continue
        html = body.decode("utf-8", "replace")
        save(f"app_{slug(host)}.html", html)
        srcs = re.findall(r'<script[^>]+src=["\']([^"\']+)["\']', html, flags=re.I)
        say(f"  {len(srcs)} script tags on {base}")
        inline = re.findall(r"<script(?![^>]+src=)[^>]*>(.*?)</script>", html, flags=re.I | re.S)
        blobs = [("inline", "\n".join(inline))]
        for s in srcs[:40]:
            u = urllib.parse.urljoin(base, s)
            if urllib.parse.urlparse(u).netloc != urllib.parse.urlparse(base).netloc:
                say(f"  (skipping off-host script {u})")
                continue
            st2, _, js = get(u, limit=4_000_000)
            if st2 == 200:
                text = js.decode("utf-8", "replace")
                save("js_" + slug(u.split("/apps/")[-1]), text)
                blobs.append((u, text))
        pat = re.compile(
            r"(PrfWebApi|/[Aa]pi/|Get[A-Z][A-Za-z]+|\$\.(?:ajax|get|getJSON|post)\(|fetch\(|url\s*:)")
        for name, text in blobs:
            hits = 0
            for m in pat.finditer(text):
                a, b = max(0, m.start() - 110), min(len(text), m.end() + 170)
                ctx = re.sub(r"\s+", " ", text[a:b])
                if any(k in ctx for k in ("jquery", "bootstrap", "getElementById", "getAttribute")) \
                        and "Api" not in ctx:
                    continue
                say(f"  [{name.split('/')[-1]}] ...{ctx}...")
                hits += 1
                for u in re.findall(r"[\"'`]([^\"'`]*(?:Api|api)[^\"'`]*)[\"'`]", ctx):
                    found.add(u)
                if hits >= 60:
                    say("  (more hits not shown)")
                    break
        break  # one host that answered is enough
    say("  endpoint-looking strings:", sorted(found)[:80])
    return found


# ---------------------------------------------------------------- api

GUESSES = [
    "/apps/PrfWebApi/PrfExternalStates/GetStates",
    "/apps/PrfWebApi/PrfExternalCounties/GetCountiesByState?stateCode=55",
    "/apps/PrfWebApi/PrfExternalIndexes/GetIndexValues?intervalType=BiMonthly"
    "&sampleYearMinimum=1948&sampleYearMaximum=2026&gridId={grid}",
    "/apps/PrfWebApi/PrfExternalIndexes/GetSampleYears",
    "/apps/PrfWebApi/PrfExternalPricingRates/GetPricingRates?interestPercent=1"
    "&intendedUseCode=030&coverageLevelPercent=0.9&productivityFactor=1&insuredAcres=100"
    "&sampleYear=2024&intervalPercentOfValues=0.5,0,0.5,0,0,0,0,0,0,0,0"
    "&irrigationPracticeCode=003&organicPracticeCode=997&gridId={grid}",
    "/apps/PRF/api/States",
    "/apps/PRF/Home/GetStates",
]


def step_api(grid, found):
    say("\n=== api: endpoints for one grid ===")
    say("  grid asked for:", grid)
    paths = list(GUESSES)
    for u in sorted(found):
        if u.startswith("/") and u not in paths:
            paths.append(u)
    for host in APP_HOSTS:
        ok = 0
        for p in paths:
            url = host + p.replace("{grid}", str(grid))
            st, hdr, body = get(url, timeout=60, limit=400_000)
            if st == 200 and body:
                ok += 1
                save("api_" + slug(p.split("?")[0]) + ".txt", body)
                txt = body.decode("utf-8", "replace")
                say("    first 900 chars:", re.sub(r"\s+", " ", txt[:900]))
                try:
                    j = json.loads(txt)
                    rec = j[0] if isinstance(j, list) and j else j
                    if isinstance(rec, dict):
                        say("    keys:", list(rec.keys())[:40])
                    if isinstance(j, list):
                        say("    records:", len(j))
                except Exception as e:
                    say("    not JSON:", type(e).__name__)
        say(f"  {host}: {ok} of {len(paths)} answered 200")
        if ok:
            break


# ---------------------------------------------------------------- gis

def step_gis():
    say("\n=== gis: the grid layer ===")
    grid = None
    for layer in ("", "/0", "/1"):
        st, _, body = get(GIS + layer + "?f=json")
        if st == 200:
            save(f"gis_layer{slug(layer) or '_root'}.json", body)
            try:
                j = json.loads(body)
                say("    name:", j.get("name") or j.get("mapName"),
                    "| fields:", [(f.get("name"), f.get("type")) for f in j.get("fields", [])][:30],
                    "| maxRecordCount:", j.get("maxRecordCount"),
                    "| extent:", j.get("extent") or j.get("fullExtent"))
            except Exception as e:
                say("    not JSON:", e)
    q = GIS + "/0/query?"
    st, _, body = get(q + urllib.parse.urlencode(
        {"where": "1=1", "returnCountOnly": "true", "f": "json"}))
    say("    count:", body[:200])
    st, _, body = get(q + urllib.parse.urlencode(
        {"where": "1=1", "outFields": "*", "resultRecordCount": 3, "outSR": 4326, "f": "json"}))
    if st == 200:
        save("gis_three_features.json", body)
        say("    three features:", re.sub(r"\s+", " ", body.decode("utf-8", "replace")[:1800]))
    st, _, body = get(q + urllib.parse.urlencode({
        "geometry": f"{TEST_LON},{TEST_LAT}", "geometryType": "esriGeometryPoint",
        "inSR": 4326, "spatialRel": "esriSpatialRelIntersects", "outFields": "*",
        "returnGeometry": "true", "outSR": 4326, "f": "json"}))
    if st == 200:
        save("gis_test_point.json", body)
        txt = body.decode("utf-8", "replace")
        say("    grid under the test point:", re.sub(r"\s+", " ", txt[:1500]))
        try:
            feats = json.loads(txt).get("features", [])
            if feats:
                attrs = feats[0].get("attributes", {})
                for k, v in attrs.items():
                    if "grid" in k.lower() and str(v).strip().isdigit():
                        grid = str(v).strip()
                        break
                say("    attributes:", attrs, "-> grid id read as", grid)
        except Exception as e:
            say("    could not parse:", e)
    return grid


# ---------------------------------------------------------------- adm

def scan_zip(path, minutes=15):
    """Every member: header, first row, row count, and the first three rows
    for commodity 0088. Reads as a stream; nothing is held in memory."""
    try:
        z = zipfile.ZipFile(path)
    except Exception as e:
        say("    not a zip:", e)
        return
    infos = z.infolist()
    say(f"    {len(infos)} members")
    budget = time.time() + minutes * 60
    for zi in infos:
        say(f"\n    -- {zi.filename}  {zi.file_size/1048576:.1f} MB")
        try:
            with z.open(zi) as f:
                rd = io.TextIOWrapper(f, encoding="latin-1", newline="")
                header = rd.readline().rstrip("\r\n")
                say("       header:", header[:1500])
                cols = [c.strip().lower() for c in header.split("|")]
                ci = [i for i, c in enumerate(cols)
                      if c in ("commodity code", "commoditycode", "commodity_code")]

                def is_prf(line):
                    if ci:
                        parts = line.split("|")
                        return len(parts) > ci[0] and parts[ci[0]].strip() == "0088"
                    return "|0088|" in line

                rows = prf = shown = 0
                for line in rd:
                    rows += 1
                    if rows == 1:
                        say("       first :", line.rstrip("\r\n")[:1500])
                    if is_prf(line):
                        prf += 1
                        if shown < 3:
                            say("       0088  :", line.rstrip("\r\n")[:1500])
                            shown += 1
                    if rows % 200000 == 0 and time.time() > budget:
                        say(f"       (time budget spent after {rows} rows; counts below are partial)")
                        break
                say(f"       rows: {rows}  rows for commodity 0088: {prf}"
                    f"  (matched on {'the commodity column' if ci else 'the text |0088|'})")
        except Exception as e:
            say("       could not read:", type(e).__name__, e)


def step_adm():
    say("\n=== adm: Actuarial Data Master ===")
    listings = {}
    for sub in ("", "2027/", "2026/"):
        st, _, body = get(ADM + sub)
        if st != 200:
            continue
        html = body.decode("utf-8", "replace")
        save(f"adm_listing_{slug(sub) or 'root'}.html", html)
        names = re.findall(r'href="([^"?][^"]*)"', html)
        listings[sub] = names
        say(f"    {ADM+sub}: {len(names)} links")
        for n in names:
            say("      ", n)
    # 2027 first: it is the first PRF year priced on NCEI rainfall.
    newest = None
    for sub in ("2027/", "2026/"):
        zips = sorted(n for n in listings.get(sub, []) if n.lower().endswith(".zip"))
        ytd = [n for n in zips if "ytd" in n.lower()]
        if ytd or zips:
            newest = urllib.parse.urljoin(ADM + sub, (ytd or zips)[-1])
            break
    if not newest:
        say("    no zip found in the listings; nothing downloaded")
        return
    say("    downloading", newest)
    tmp = "/tmp/adm.zip"
    req = urllib.request.Request(newest, headers={"User-Agent": UA})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=120) as r, open(tmp, "wb") as f:
            n = 0
            while True:
                chunk = r.read(1 << 20)
                if not chunk:
                    break
                f.write(chunk)
                n += len(chunk)
        say(f"    {n/1048576:.1f} MB in {time.time()-t0:.0f}s")
    except Exception as e:
        say("    download FAILED:", type(e).__name__, e)
        return
    scan_zip(tmp)


# ---------------------------------------------------------------- pages

PAGES = [
    "https://www.rma.usda.gov/policy-procedure/insurance-plans/pasture-rangeland-forage",
    "https://www.rma.usda.gov/Policy-and-Procedure/Insurance-Plans/Pasture-Rangeland-Forage",
    "https://www.rma.usda.gov/tools-reports",
    "https://www.rma.usda.gov/about-crop-insurance/frequently-asked-questions/pasture-rangeland-forage",
    "https://www.rma.usda.gov/policy-procedure/insurance-plans/rainfall-index",
    "https://www.rma.usda.gov/policy-procedure/insurance-plans/apiculture",
]


def step_pages():
    say("\n=== pages: where RMA links the rainfall data ===")
    want = re.compile(r"(ncei|noaa|rainfall|rain-fall|grid|index|\.xlsx?|\.csv|prf|nclim|decision)", re.I)
    seen = set()
    for url in PAGES:
        st, _, body = get(url, timeout=60, limit=3_000_000)
        if st != 200:
            continue
        html = body.decode("utf-8", "replace")
        save("page_" + slug(url.split("usda.gov/")[-1]) + ".html", html)
        for href, text in re.findall(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', html, flags=re.I | re.S):
            label = re.sub(r"<[^>]+>|\s+", " ", text).strip()
            if (want.search(href) or want.search(label)) and href not in seen:
                seen.add(href)
                say(f"      {urllib.parse.urljoin(url, href)}   [{label[:90]}]")
        for m in re.finditer(r"(NCEI|National Centers for Environmental Information)", html):
            a, b = max(0, m.start() - 200), min(len(html), m.end() + 300)
            say("      NCEI mention:", re.sub(r"<[^>]+>|\s+", " ", html[a:b]).strip()[:420])
            break


# ---------------------------------------------------------------- second pass
#
# The first run (2026-10-12) settled the names. RMA's page calls
# public-rma.fpac.usda.gov/apps/PrfWebApi/PrfExternal*/..., the grid layer host
# (pdgis.rm.usda.net) does not resolve from outside and is reached through
# /apps/prf/proxy/proxy.ashx, and the 2027 ADM carries PRF in InsuranceOffer,
# Price, AreaCoverageLevel and AreaRate. These steps read real values for one
# county so a fetcher can be checked against RMA's own answers.

API = "https://public-rma.fpac.usda.gov/apps/PrfWebApi/"
PROXY = "https://public-rma.fpac.usda.gov/apps/prf/proxy/proxy.ashx"
REFERER = "https://public-rma.fpac.usda.gov/apps/PRF/"
TEST_STATE, TEST_COUNTY_NAME = "55", "Barron"


def api(path, params=None, name=None, timeout=90):
    url = API + path + ("?" + urllib.parse.urlencode(params) if params else "")
    st, _, body = get(url, timeout=timeout)
    if st == 200 and name:
        save("api2_" + name + ".json", body)
    try:
        return json.loads(body.decode("utf-8", "replace")) if st == 200 else None
    except Exception as e:
        say("    not JSON:", type(e).__name__, body[:200])
        return None


def show(label, obj, n=700):
    say("   ", label, re.sub(r"\s+", " ", json.dumps(obj))[:n])


def step_api2(grid_arg):
    say("\n=== api2: real answers for one county ===")
    counties = api("PrfExternalStates/GetCountiesByState", {"stateCode": TEST_STATE}, "counties_55")
    show("counties:", counties)
    code = None
    rows = counties if isinstance(counties, list) else (counties or {}).get("counties") or \
        next((v for v in (counties or {}).values() if isinstance(v, list)), [])
    for c in rows or []:
        if TEST_COUNTY_NAME.lower() in json.dumps(c).lower():
            code = c.get("Code") or c.get("CountyCode")
            say("    county record:", c)
            break
    years = api("PrfExternalIndexes/GetListOfAvailableRainfallYears", None, "years")
    show("years:", years)
    glist = api("PrfExternalNoaaGrids/GetContinentalUsGridList", None, "grid_list")
    if glist is not None:
        seq = glist if isinstance(glist, list) else next(
            (v for v in glist.values() if isinstance(v, list)), [])
        say("    grid list length:", len(seq), "first:", seq[:8], "last:", seq[-8:])
    if not code:
        say("    county code not found; stopping api2")
        return
    subs = api("PrfExternalStates/GetSubCountiesByCountyAndState",
               {"stateCode": TEST_STATE, "countyCode": code}, "subcounties")
    show("grids in the county:", subs, 1500)
    seq = subs if isinstance(subs, list) else next(
        (v for v in (subs or {}).values() if isinstance(v, list)), [])
    if not seq:
        return
    g = seq[0]
    gid, gname = g.get("NoaaGridId"), g.get("NoaaGridName")
    if grid_arg:
        gid = gname = grid_arg
    say("    using grid id", gid, "name", gname)
    t0 = time.time()
    idx = api("PrfExternalIndexes/GetIndexValues",
              {"intervalType": "BiMonthly", "sampleYearMinimum": 1948,
               "sampleYearMaximum": 2026, "gridId": gid}, "index_values")
    say(f"    index history took {time.time()-t0:.1f}s")
    if idx:
        rws = idx.get("HistoricalIndexRows", [])
        for r in rws[:1] + rws[-3:]:
            show(f"{r.get('Year')}:", r.get("HistoricalIndexDataColumns"), 1600)
    show("where the grid sits:", api("PrfExternalStates/GetCountiesAndStatesFromGridId",
                                     {"gridId": gid, "gridName": gname}, "grid_counties"), 1500)
    show("grid id for the name:", api("PrfExternalNoaaGrids/GetNoaaGridId", {"gridName": gname}))
    cases = [
        ("hay_nonirr_90", "030", "003", "997", 90, [0, 0, 0, 50, 0, 50, 0, 0, 0, 0, 0]),
        ("hay_nonirr_70", "030", "003", "997", 70, [0, 0, 0, 50, 0, 50, 0, 0, 0, 0, 0]),
        ("graze_85", "007", "997", "997", 85, [0, 0, 20, 0, 30, 0, 30, 0, 20, 0, 0]),
        ("hay_irr_org_90", "030", "002", "001", 90, [60, 0, 0, 0, 0, 0, 0, 0, 0, 40, 0]),
    ]
    for name, use, irr, org, clp, ipov in cases:
        base = {"intervalType": "BiMonthly", "irrigationPracticeCode": irr,
                "organicPracticeCode": org, "intendedUseCode": use,
                "stateCode": TEST_STATE, "countyCode": code,
                "gridId": gid, "gridName": gname}
        say(f"\n    case {name}: use {use} irr {irr} org {org} coverage {clp} split {ipov}")
        show("valid intervals:", api("PrfExternalIntervalCodes/GetValidIntervalCodes",
                                     dict(base, coverageLevelPercent=clp), name + "_valid"), 900)
        show("max acre percent:", api("PrfExternalMaxAcrePercentage/GetMaxAcrePercentage",
                                      base, name + "_maxpct"), 900)
        for acres, pf, ii, yr in ((100, 100, 100, 2012), (237, 135, 50, 2023)):
            calc = dict(base, productivityFactor=pf, insurableInterest=ii, insuredAcres=acres,
                        sampleYear=yr, intervalPercentOfValues=json.dumps(ipov),
                        coverageLevelPercent=clp)
            show(f"pricing {acres} ac pf {pf} interest {ii} year {yr}:",
                 api("PrfExternalPricingRates/GetPricingRates", calc,
                     f"{name}_pricing_{acres}_{pf}_{ii}_{yr}"), 3500)
        est = dict(base, productivityFactor=100, insuredAcres=100, sampleYearMinimum=1948,
                   sampleYearMaximum=2025, intervalPercentOfValues=json.dumps(ipov),
                   insurableInterest=100, coverageLevelPercent=clp)
        show("estimated indemnities 1948-2025:",
             api("PrfExternalEstimatedIndemnities/GetEstimatedIndemnityValues", est,
                 name + "_indemnities"), 2500)


def step_grid():
    say("\n=== grid: the locator tab and the layer behind the proxy ===")
    tab = ("https://public-rma.fpac.usda.gov/apps/PRF/Html/_GridLocatorTab.html?GridsLayerUrl="
           + urllib.parse.quote(GIS + "/0", safe="") + "&CountiesLayerUrl="
           + urllib.parse.quote(GIS + "/1", safe=""))
    st, _, body = get(tab)
    if st == 200:
        html = body.decode("utf-8", "replace")
        save("gridtab.html", html)
        for s in re.findall(r'<script[^>]+src=["\']([^"\']+)["\']', html, flags=re.I):
            u = urllib.parse.urljoin(tab, s)
            say("    script:", u)
            if "public-rma" in u:
                st2, _, js = get(u, limit=3_000_000)
                if st2 == 200:
                    save("gridtab_" + slug(u.split("/")[-1]), js)
        for m in re.finditer(r"(proxy|GRID|gridcode|outFields|queryTask|where)", html, flags=re.I):
            a, b = max(0, m.start() - 100), min(len(html), m.end() + 200)
            say("    ...", re.sub(r"\s+", " ", html[a:b]))

    def via_proxy(tail, name):
        url = PROXY + "?" + GIS + tail
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": REFERER})
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                body = r.read()
                say(f"  GET {url[:230]} -> {r.status} {len(body)} bytes")
                save("grid_" + name + ".json", body)
                return body.decode("utf-8", "replace")
        except Exception as e:
            say(f"  GET {url[:230]} -> FAILED {type(e).__name__}: {e}")
            return ""

    say("    layer 0:", re.sub(r"\s+", " ", via_proxy("/0?f=json", "layer0"))[:1500])
    say("    count:", via_proxy("/0/query?" + urllib.parse.urlencode(
        {"where": "1=1", "returnCountOnly": "true", "f": "json"}), "count")[:300])
    say("    five features:", re.sub(r"\s+", " ", via_proxy("/0/query?" + urllib.parse.urlencode(
        {"where": "1=1", "outFields": "*", "resultRecordCount": 5, "outSR": 4326,
         "returnGeometry": "true", "f": "json"}), "five"))[:3000])
    say("    test point:", re.sub(r"\s+", " ", via_proxy("/0/query?" + urllib.parse.urlencode(
        {"geometry": f"{TEST_LON},{TEST_LAT}", "geometryType": "esriGeometryPoint", "inSR": 4326,
         "spatialRel": "esriSpatialRelIntersects", "outFields": "*", "returnGeometry": "true",
         "outSR": 4326, "f": "json"}), "point"))[:2500])


def step_adm2():
    """One county end to end from the ADM, plus what the whole PRF book looks like."""
    import collections
    say("\n=== adm2: PRF in the 2027 Actuarial Data Master ===")
    url = ADM + "2027/2027_ADM_YTD.zip"
    tmp = "/tmp/adm.zip"
    if not os.path.exists(tmp):
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        t0 = time.time()
        with urllib.request.urlopen(req, timeout=120) as r, open(tmp, "wb") as f:
            while True:
                chunk = r.read(1 << 20)
                if not chunk:
                    break
                f.write(chunk)
        say(f"    downloaded in {time.time()-t0:.0f}s")
    z = zipfile.ZipFile(tmp)
    members = {re.sub(r"^\d{4}_(A\d{5})_.*", r"\1", zi.filename): zi for zi in z.infolist()}

    def rows(code):
        with z.open(members[code]) as f:
            rd = io.TextIOWrapper(f, encoding="latin-1", newline="")
            header = [c.strip() for c in rd.readline().rstrip("\r\n").split("|")]
            for line in rd:
                yield header, line.rstrip("\r\n").split("|")

    def col(header, name):
        return header.index(name)

    # full headers, untruncated
    for code in ("A00810", "A01130", "A01135", "A00030", "A00200", "A00070", "A00480"):
        with z.open(members[code]) as f:
            h = io.TextIOWrapper(f, encoding="latin-1").readline().rstrip("\r\n")
        save(f"adm_header_{code}.txt", h)
        say(f"    {code}: {len(h.split('|'))} header fields")

    say("\n    intervals 625-635:")
    for h, r in rows("A00480"):
        d = dict(zip(h, r))
        if d.get("Interval Code", "") >= "620" and d.get("Interval Code", "") <= "640":
            say("      ", {k: v for k, v in d.items() if v})
    say("\n    subsidy rows naming plan 13:")
    for h, r in rows("A00070"):
        d = dict(zip(h, r))
        if d.get("Insurance Plan Code") == "13":
            say("      ", {k: v for k, v in d.items() if v})

    # every PRF offer
    offers = {}
    for h, r in rows("A00030"):
        if len(r) != len(h):
            say("    A00030 row with", len(r), "fields, header has", len(h)); break
        if r[col(h, "Commodity Code")] == "0088":
            offers[r[col(h, "ADM Insurance Offer ID")]] = (
                r[col(h, "State Code")], r[col(h, "County Code")], r[col(h, "Intended Use Code")],
                r[col(h, "Irrigation Practice Code")], r[col(h, "Organic Practice Code")],
                r[col(h, "Interval Code")], r[col(h, "Insurance Plan Code")],
                r[col(h, "Type Code")], r[col(h, "Practice Code")])
    say(f"\n    PRF offers: {len(offers)}")
    C = collections.Counter
    say("    by plan:", C(v[6] for v in offers.values()))
    say("    by use/irrigation/organic:", sorted(C((v[2], v[3], v[4]) for v in offers.values()).items()))
    say("    by interval:", sorted(C(v[5] for v in offers.values()).items()))
    say("    states:", len({v[0] for v in offers.values()}),
        "counties:", len({v[:2] for v in offers.values()}))

    dates = C()
    for h, r in rows("A00200"):
        if r[col(h, "Commodity Code")] == "0088":
            d = dict(zip(h, r))
            dates[(d.get("Sales Closing Date"), d.get("Acreage Reporting Date"),
                   d.get("Premium Billing Date"), d.get("Contract Change Date"),
                   d.get("Cancellation Date"), d.get("End Of Insurance Date"))] += 1
    say("    dates (sales closing, acreage report, billing, contract change, cancel, end):")
    for k, n in dates.most_common(12):
        say("      ", n, k)

    # Price: grid level
    samp_states = {"55", "48", "30"}
    price = {}                       # (offer, grid) -> (cbv, min, max, expected)  sample states
    grids, minmax, expd = set(), C(), C()
    cbv_by_key = collections.defaultdict(set)   # (state,county,use,irr,org) -> {cbv}
    nprice = bad = 0
    for h, r in rows("A00810"):
        if r[col(h, "Commodity Code")] != "0088":
            continue
        if len(r) != len(h):
            bad += 1
            if bad <= 2:
                say("    A00810 row with", len(r), "fields, header has", len(h))
            continue
        nprice += 1
        oid, grid = r[col(h, "ADM Insurance Offer ID")], r[col(h, "Sub County Code")]
        cbv = r[col(h, "County Base Value")]
        mn, mx = r[col(h, "Minimum Acre Percent")], r[col(h, "Maximum Acre Percent")]
        ex = r[col(h, "Expected Index Value")]
        grids.add(grid)
        minmax[(mn, mx)] += 1
        expd[ex] += 1
        o = offers.get(oid)
        if o:
            cbv_by_key[o[:5]].add(cbv)
            if o[0] in samp_states:
                price[(oid, grid)] = (cbv, mn, mx, ex)
    say(f"\n    Price rows for PRF: {nprice} (rows with a different field count: {bad})")
    say("    distinct grids:", len(grids), "lowest", min(grids), "highest", max(grids))
    say("    min/max acre percent:", minmax.most_common(10))
    say("    expected index values:", expd.most_common(5))
    multi = sum(1 for v in cbv_by_key.values() if len(v) > 1)
    say(f"    county+use+irrigation+organic keys: {len(cbv_by_key)}; keys with more than one "
        f"county base value: {multi}")
    for k, v in list(cbv_by_key.items())[:3]:
        say("      e.g.", k, sorted(v))
    save("adm_grid_ids.txt", "\n".join(sorted(grids)))

    # AreaCoverageLevel -> rate ids, sample states only
    acl = {}        # (offer, grid, cov) -> (rate id, start, end, factor)
    need = set()
    n = 0
    for h, r in rows("A01130"):
        oid = r[col(h, "ADM Insurance Offer ID")]
        o = offers.get(oid)
        if not o:
            continue
        n += 1
        if o[0] in samp_states:
            rid = r[col(h, "Area Rate ID")]
            acl[(oid, r[col(h, "Sub County Code")], r[col(h, "Coverage Level Percent")])] = (
                rid, r[col(h, "Area Loss Start Percent")], r[col(h, "Area Loss End Percent")],
                r[col(h, "Payment Factor")])
            need.add(rid)
    say(f"\n    AreaCoverageLevel rows for PRF offers: {n}; kept for WI, TX, MT: {len(acl)}; "
        f"distinct rate ids there: {len(need)}")
    rate = {}
    for h, r in rows("A01135"):
        rid = r[col(h, "Area Rate ID")]
        if rid in need:
            rate[rid] = (r[col(h, "Base Rate")], r[col(h, "Price Volatility Factor")])
    say(f"    rates found: {len(rate)} of {len(need)}")

    # does the rate depend on anything but grid, interval and coverage level?
    by_gic = collections.defaultdict(set)
    by_gicu = collections.defaultdict(set)
    for (oid, grid, cov), (rid, *_rest) in acl.items():
        o = offers[oid]
        br = rate.get(rid, (None,))[0]
        by_gic[(grid, o[5], cov)].add(br)
        by_gicu[(grid, o[5], cov, o[2], o[3], o[4])].add(br)
    say("    (grid, interval, coverage) keys:", len(by_gic), "with more than one rate:",
        sum(1 for v in by_gic.values() if len(v) > 1))
    say("    (grid, interval, coverage, use, irrigation, organic) keys:", len(by_gicu),
        "with more than one rate (i.e. the county matters):",
        sum(1 for v in by_gicu.values() if len(v) > 1))
    ex = [(k, sorted(v)) for k, v in by_gic.items() if len(v) > 1][:5]
    for k, v in ex:
        say("      e.g.", k, v)

    # the test county, in full
    code = None
    for h, r in rows("A00440"):
        d = dict(zip(h, r))
        if d.get("State Code") == TEST_STATE and TEST_COUNTY_NAME.lower() in json.dumps(d).lower():
            code = d.get("County Code")
            say("\n    county record:", {k: v for k, v in d.items() if v})
    out = ["offer|use|irr|org|interval|grid|coverage|base_rate|cbv|min|max|expected|start|end|factor"]
    for (oid, grid, cov), (rid, st_, en, fac) in sorted(acl.items()):
        o = offers[oid]
        if o[0] == TEST_STATE and o[1] == code:
            p = price.get((oid, grid), ("", "", "", ""))
            out.append("|".join([oid, o[2], o[3], o[4], o[5], grid, cov,
                                 rate.get(rid, ("",))[0], *p, st_, en, fac]))
    save("adm_test_county.txt", "\n".join(out))
    say(f"    test county rows written: {len(out)-1}")
    for line in out[:14]:
        say("      ", line)


def step_pages2():
    say("\n=== pages2: the Rainfall Index policy page ===")
    want = re.compile(r"(ncei|noaa|rainfall|grid|index|\.xlsx?|\.csv|prf|nclim|data)", re.I)
    for url in ("https://www.rma.usda.gov/policy-procedure/general-policies/rainfall-index",
                "https://www.rma.usda.gov/policy-procedure/crop-policies/pasture-rangeland-forage",
                "https://www.rma.usda.gov/policy-procedure/crop-policies"):
        st, _, body = get(url, timeout=60, limit=3_000_000)
        if st != 200:
            continue
        html = body.decode("utf-8", "replace")
        save("page2_" + slug(url.split("usda.gov/")[-1]) + ".html", html)
        seen = set()
        for href, text in re.findall(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', html, flags=re.I | re.S):
            label = re.sub(r"<[^>]+>|\s+", " ", text).strip()
            if (want.search(href) or want.search(label)) and href not in seen:
                seen.add(href)
                say(f"      {urllib.parse.urljoin(url, href)}   [{label[:90]}]")
        for m in re.finditer(r"(NCEI|National Centers for Environmental Information)", html):
            a, b = max(0, m.start() - 300), min(len(html), m.end() + 500)
            say("      NCEI mention:", re.sub(r"<[^>]+>|\s+", " ", html[a:b]).strip()[:700])


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--steps", default="")
    ap.add_argument("--grid", default="")
    a = ap.parse_args()
    steps = [s.strip() for s in a.steps.split(",") if s.strip()] or ["app", "gis", "api", "pages", "adm"]
    found, grid = set(), a.grid.strip()
    for s in steps:
        try:
            if s == "app":
                found = step_app()
            elif s == "gis":
                g = step_gis()
                grid = grid or g or ""
            elif s == "api":
                step_api(grid or "0", found)
            elif s == "pages":
                step_pages()
            elif s == "adm":
                step_adm()
            elif s == "api2":
                step_api2(a.grid.strip())
            elif s == "grid":
                step_grid()
            elif s == "adm2":
                step_adm2()
            elif s == "pages2":
                step_pages2()
            else:
                say("unknown step", s)
        except Exception as e:  # a probe reports, it does not stop
            say(f"STEP {s} RAISED {type(e).__name__}: {e}")
        save("report.txt", "\n".join(REPORT) + "\n")
    say("\ndone:", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    save("report.txt", "\n".join(REPORT) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
