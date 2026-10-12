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
