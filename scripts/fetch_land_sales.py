"""Recorded land transfers for Field Scout, from each state's own public transfer data.

Writes data/land/<st>/<county fips>.json (one small file per county, loaded only
when a reader picks a field there) and data/land/<st>/index.json. The land card
uses them twice: every recorded transfer of the parcel the reader picked, and the
sold-land comps list with its filters.

Sources (free and public only; a state is built only once its files read cleanly):
  WI  Wisconsin Department of Revenue, electronic Real Estate Transfer Return
      (eRETR) data downloads.
  MN  Minnesota Department of Revenue, electronic Certificate of Real Estate
      Value (eCRV) data, if the public copy is free and carries parcel numbers.

  python3 scripts/fetch_land_sales.py --probe [WI MN]   save the data pages, the file
        links they list and the head of the first files to data/land-raw/sales/ (the
        workflow moves that to the raw branch). Run this first and read the columns.
  python3 scripts/fetch_land_sales.py [WI MN]           fetch every listed file and build
  python3 scripts/fetch_land_sales.py --from DIR WI     build from files already downloaded
  python3 scripts/fetch_land_sales.py --selftest

What it keeps: transfers whose property class is farm, forest, undeveloped or
farm buildings (Wisconsin classes 4, 5, 5M, 6, 7; the same uses by name in
Minnesota). A parcel that only ever sold as a house lot is not in these files.
It refuses to write a state when the columns it needs are not found by name, or
when fewer than 90 percent of rows give a readable date and price: a missing
number stays missing, never a guess. Buyer and seller names are kept only when
the state's public file carries them (the page shows them for the one parcel a
reader picked, and links the official record when they are not there).
"""
import csv
import io
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "land")
RAW = os.path.join(ROOT, "data", "land-raw", "sales")
GEO = os.path.join(ROOT, "data", "atlas", "counties.geo.json")
GAZ = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_cousubs_national.zip"
UA = "Mozilla/5.0 (AGSIST land data; agsist.com; sig@farmers1st.com)"
MAX_STATE_MB = 25          # all county files of one state together (CLAUDE.md budget: data/ is 300 MB)
LEGAL_MAX = 140

STATES = {
    "WI": {
        "name": "Wisconsin", "fips": "55",
        "source": "Wisconsin Department of Revenue, electronic Real Estate Transfer Returns",
        "short": "Wisconsin transfer return",
        "pages": ["https://www.revenue.wi.gov/Pages/ERETR/data-home.aspx"],
        "links": [{"t": "Wisconsin DOR transfer return data", "url": "https://www.revenue.wi.gov/Pages/ERETR/data-home.aspx"}],
        "since_note": "Wisconsin's electronic transfer returns began in the mid-2000s; older deeds are at the county Register of Deeds.",
    },
    "MN": {
        "name": "Minnesota", "fips": "27",
        "source": "Minnesota Department of Revenue, electronic Certificates of Real Estate Value (eCRV)",
        "short": "Minnesota eCRV",
        "pages": ["https://www.revenue.state.mn.us/ecrv-data", "https://www.revenue.state.mn.us/sales-ratio-studies"],
        "links": [{"t": "Minnesota eCRV", "url": "https://www.revenue.state.mn.us/electronic-certificate-real-estate-value-ecrv"}],
        "since_note": "Minnesota's eCRV began in 2014; older certificates and deeds are at the county recorder.",
    },
}

# Column names seen on state transfer files, compared with letters and digits only.
COLS = {
    "doc": ["DOCUMENTNUMBER", "DOCNO", "DOCNUMBER", "RETRNUMBER", "RETRID", "RECEIPTNUMBER", "ECRVID", "ECRVNUMBER", "CRVNUMBER", "DOCID", "TRANSFERID", "RETURNNUMBER"],
    "date": ["DATEOFCONVEYANCE", "CONVEYANCEDATE", "TRANSFERDATE", "SALEDATE", "DEEDDATE", "DATECONVEYED", "DATEOFSALE", "DATEOFDEED", "CONVEYDATE", "RECORDINGDATE", "RECORDEDDATE"],
    "price": ["TOTALVALUE", "TOTALREALESTATEVALUE", "TOTALREALPROPERTYVALUE", "SALEPRICE", "PURCHASEPRICE", "TOTALPURCHASEPRICE", "VALUEOFREALPROPERTY", "CONSIDERATION", "TOTALCONSIDERATION", "SALESPRICE", "ADJUSTEDSALEPRICE"],
    "acres": ["ACRES", "TOTALACRES", "ACREAGE", "LANDACRES", "NUMBEROFACRES", "ACRESTOTAL", "DEEDEDACRES", "TOTALACREAGE"],
    "cls": ["PROPERTYCLASS", "PROPCLASS", "CLASS", "CLASSCODE", "PREDOMINANTUSE", "PROPERTYTYPE", "PROPERTYUSE", "USECODE", "PLANNEDUSE", "PROPERTYCLASSIFICATION"],
    "conv": ["CONVEYANCETYPE", "DEEDTYPE", "INSTRUMENTTYPE", "TYPEOFCONVEYANCE", "CONVEYANCE", "TYPEOFDEED", "INSTRUMENT"],
    "pid": ["PARCELNUMBER", "PARCELID", "TAXPARCELNUMBER", "TAXPARCELID", "TAXKEY", "PIN", "PARCEL", "PARCELNO", "PARCELIDENTIFICATIONNUMBER"],
    "muni": ["MUNICIPALITY", "MUNICIPALITYNAME", "MUNINAME", "MUNI", "CITYTOWNSHIP", "TOWNSHIP", "TOWNSHIPCITY", "CITYTOWNSHIPNAME", "PROPERTYMUNICIPALITY", "MCD"],
    "county": ["COUNTY", "COUNTYNAME", "PROPERTYCOUNTY", "COUNTYOFPROPERTY", "CNTY"],
    "legal": ["LEGALDESCRIPTION", "LEGAL", "ABBREVIATEDLEGAL", "LEGALDESC", "SHORTLEGAL"],
    "grantor": ["GRANTOR", "GRANTORNAME", "GRANTORNAMES", "SELLER", "SELLERNAME", "SELLERNAMES", "GRANTORFULLNAME"],
    "grantee": ["GRANTEE", "GRANTEENAME", "GRANTEENAMES", "BUYER", "BUYERNAME", "BUYERNAMES", "GRANTEEFULLNAME"],
    "exempt": ["EXEMPTION", "EXEMPTIONNUMBER", "EXEMPTNUMBER", "FEEEXEMPT", "EXEMPTIONCODE", "TRANSFERFEEEXEMPTION"],
}
NEED = ["date", "price", "county"]
FARM_WORDS = re.compile(r"\b(AGRIC|AG\b|FARM|FOREST|TIMBER|UNDEVELOP|SWAMP|WASTE|VACANT LAND|PASTURE|TILLABLE|CROPLAND|RURAL VACANT|OTHER)", re.I)
CLASS_CODE = re.compile(r"^(4|5|5M|6|7)$", re.I)


def key(s):
    return re.sub(r"[^A-Z0-9]", "", str(s or "").upper())


def map_columns(header):
    """Our name for each column we know, by its header. First synonym that is present wins."""
    k = [key(h) for h in header]
    out = {}
    for name, syn in COLS.items():
        for s in syn:
            if s in k:
                out[name] = k.index(s)
                break
    return out


def parse_date(s):
    s = str(s or "").strip()
    m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})", s)
    if m:
        y, mo, d = int(m[1]), int(m[2]), int(m[3])
    else:
        m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{2,4})", s)
        if not m:
            return None
        mo, d, y = int(m[1]), int(m[2]), int(m[3])
        if y < 100:
            y += 2000 if y < 50 else 1900
    if not (1990 <= y <= 2100 and 1 <= mo <= 12 and 1 <= d <= 31):
        return None
    return "%04d-%02d-%02d" % (y, mo, d)


def parse_num(s):
    s = str(s or "").strip().replace("$", "").replace(",", "")
    if not s:
        return None
    try:
        v = float(s)
    except ValueError:
        return None
    return v if v == v and abs(v) < 1e10 else None


def farm_class(c):
    c = str(c or "").strip()
    if not c:
        return False
    parts = [p for p in re.split(r"[\s,;/|]+", c) if p]
    if any(CLASS_CODE.match(p) for p in parts):
        return True
    return bool(FARM_WORDS.search(c))


def norm_class(c):
    """Wisconsin codes stay codes; names become the code they mean when it is plain."""
    c = str(c or "").strip()
    parts = [p.upper() for p in re.split(r"[\s,;/|]+", c) if p]
    if parts and all(re.match(r"^([1-7]|5M|X)$", p) for p in parts):
        return " ".join(dict.fromkeys(parts))
    u = c.upper()
    codes = []
    for rx, code in ((r"AGRICULTURAL FOREST|AG FOREST", "5M"), (r"PRODUCTIVE FOREST|\bFOREST", "6"), (r"AGRIC", "4"),
                     (r"UNDEVELOP|SWAMP|WASTE", "5"), (r"\bOTHER\b", "7"), (r"RESIDENT", "1"), (r"COMMERC", "2"), (r"MANUFACT", "3")):
        if re.search(rx, u) and code not in codes:
            codes.append(code)
            if code == "5M":
                u = re.sub(r"AGRICULTURAL FOREST|AG FOREST", "", u)
    return " ".join(codes) if codes else c[:40]


def clean(s, n=None):
    s = re.sub(r"\s+", " ", str(s or "")).strip()
    return s[:n] if n else s


def read_table(name, blob):
    """Rows (header first) out of a csv, txt (comma, tab or pipe), xlsx, or a zip of those."""
    low = name.lower()
    if low.endswith(".zip"):
        z = zipfile.ZipFile(io.BytesIO(blob))
        for n in z.namelist():
            if re.search(r"\.(csv|txt|xlsx)$", n, re.I):
                yield from read_table(n, z.read(n))
        return
    if low.endswith(".xlsx"):
        import openpyxl  # installed by the workflow
        wb = openpyxl.load_workbook(io.BytesIO(blob), read_only=True, data_only=True)
        for ws in wb.worksheets:
            for r in ws.iter_rows(values_only=True):
                yield ["" if v is None else (v.strftime("%Y-%m-%d") if hasattr(v, "strftime") else str(v)) for v in r]
        return
    txt = blob.decode("utf-8-sig", errors="replace")
    first = txt.split("\n", 1)[0]
    delim = max([",", "\t", "|"], key=first.count)
    yield from csv.reader(io.StringIO(txt), delimiter=delim)


def parse_rows(tables):
    """tables: iterables of rows, each with its own header. Returns (records, report)."""
    recs, rep = [], {"files": 0, "rows": 0, "bad_date": 0, "bad_price": 0, "not_farm": 0, "missing": []}
    for rows in tables:
        it = iter(rows)
        try:
            header = next(it)
        except StopIteration:
            continue
        m = map_columns(header)
        miss = [n for n in NEED if n not in m]
        if "pid" not in m and "legal" not in m:
            miss.append("pid or legal")
        rep["files"] += 1
        if miss:
            rep["missing"].append({"header": header[:60], "missing": miss})
            continue
        rep["columns"] = sorted(m)
        for r in it:
            if not any(str(x).strip() for x in r):
                continue
            rep["rows"] += 1

            def g(n, cut=None):
                i = m.get(n)
                return clean(r[i], cut) if i is not None and i < len(r) else ""
            d = parse_date(g("date"))
            p = parse_num(g("price"))
            if not d:
                rep["bad_date"] += 1
                continue
            if p is None:
                rep["bad_price"] += 1
                continue
            cls = g("cls")
            if "cls" in m and not farm_class(cls):
                rep["not_farm"] += 1
                continue
            ex = g("exempt")
            recs.append({
                "doc": g("doc"), "date": d, "price": round(p), "acres": parse_num(g("acres")),
                "cls": norm_class(cls), "conv": g("conv", 40).title(), "pid": g("pid", 40), "muni": g("muni", 60).upper(),
                "county": g("county", 40), "legal": g("legal", LEGAL_MAX),
                "grantor": g("grantor", 80) if "grantor" in m else None, "grantee": g("grantee", 80) if "grantee" in m else None,
                "exempt": 1 if ex and not re.match(r"^(0|N|NO|NONE|FALSE)$", ex, re.I) else 0,
            })
    return recs, rep


def checks_pass(recs, rep):
    """Refuse a state whose files do not read cleanly."""
    if not recs:
        return False, "no rows read; columns missing: %s" % json.dumps(rep["missing"][:3])
    tried = rep["rows"]
    bad = rep["bad_date"] + rep["bad_price"]
    if tried and bad / tried > 0.10:
        return False, "%d of %d rows had no readable date or price" % (bad, tried)
    return True, "ok"


def muni_key(name):
    u = str(name or "").upper()
    kind = "T"
    m = re.match(r"^(TOWN|TOWNSHIP|VILLAGE|CITY|T|V|C)\s+(OF\s+)?(.*)$", u)
    if m:
        kind = {"TOWN": "T", "TOWNSHIP": "T", "T": "T", "VILLAGE": "V", "V": "V", "CITY": "C", "C": "C"}[m[1]]
        u = m[3]
    m = re.match(r"^(.*?)\s+(TOWN|TOWNSHIP|VILLAGE|CITY|UT|UNORG)$", u)
    if m:
        u = m[1]
        kind = {"TOWN": "T", "TOWNSHIP": "T", "VILLAGE": "V", "CITY": "C"}.get(m[2], "T")
    return kind, re.sub(r"[^A-Z]", "", u.replace("SAINT ", "ST ").replace("ST. ", "ST "))


def gazetteer(st_fips, blob=None):
    """{county fips: {(kind, name): (label, lat, lng)}} from the Census county subdivision gazetteer."""
    if blob is None:
        blob = fetch(GAZ)
    z = zipfile.ZipFile(io.BytesIO(blob))
    txt = z.read(z.namelist()[0]).decode("latin-1")
    rd = csv.reader(io.StringIO(txt), delimiter="\t")
    hdr = [h.strip() for h in next(rd)]
    ix = {h: i for i, h in enumerate(hdr)}
    out = {}
    for r in rd:
        geoid = r[ix["GEOID"]].strip()
        if not geoid.startswith(st_fips):
            continue
        name = r[ix["NAME"]].strip()
        kind, base = muni_key(name)
        out.setdefault(geoid[:5], {})[(kind, base)] = (name, round(float(r[ix["INTPTLAT"]]), 4), round(float(r[ix["INTPTLONG"]]), 4))
    return out


def county_index(st):
    g = json.load(open(GEO))
    out = {}
    for f in g["features"]:
        if f["properties"]["st"] != st:
            continue
        gm = f["geometry"]
        ring = gm["coordinates"][0] if gm["type"] == "Polygon" else max(gm["coordinates"], key=lambda p: len(p[0]))[0]
        out[key(f["properties"]["name"])] = {"fips": str(f["id"]), "name": f["properties"]["name"],
                                            "lat": round(sum(p[1] for p in ring) / len(ring), 3), "lng": round(sum(p[0] for p in ring) / len(ring), 3)}
    return out


def build(st, recs, gaz, now):
    cfg = STATES[st]
    cix = county_index(st)
    by = {}
    unplaced = 0
    for r in recs:
        c = cix.get(key(re.sub(r"\s+COUNTY$", "", r["county"].upper())))
        if not c:
            unplaced += 1
            continue
        by.setdefault(c["fips"], []).append(r)
    names = any(r.get("grantor") for r in recs)
    cols = ["doc", "date", "price", "acres", "tac", "np", "cls", "conv", "pid", "muni", "legal", "exempt"] + (["grantor", "grantee"] if names else [])
    os.makedirs(os.path.join(OUT, st.lower()), exist_ok=True)
    index, total = [], 0
    for fips, rs in sorted(by.items()):
        # several parcels on one return: the price is for all of them
        docs = {}
        for r in rs:
            if r["doc"]:
                docs.setdefault(r["doc"], []).append(r)
        for d, grp in docs.items():
            if len(grp) > 1:
                ac = [g["acres"] for g in grp if g["acres"]]
                for g in grp:
                    g["np"] = len(grp)
                    g["tac"] = round(sum(ac), 2) if ac else None
        rs.sort(key=lambda r: (r["date"], r["doc"]), reverse=True)
        munis, mcode = {}, {}
        G = gaz.get(fips, {})
        for r in rs:
            if r["muni"] and r["muni"] not in mcode:
                hit = G.get(muni_key(r["muni"]))
                if not hit:
                    k = muni_key(r["muni"])[1]
                    hit = next((v for (kk, b), v in G.items() if b == k), None)
                code = str(len(mcode))
                mcode[r["muni"]] = code
                munis[code] = [hit[0] if hit else r["muni"].title()] + ([hit[1], hit[2]] if hit else [None, None])
        rows = []
        for r in rs:
            a = r["acres"]
            rows.append([r["doc"], r["date"], r["price"], round(a, 2) if a else None, r.get("tac"), r.get("np", 1), r["cls"], r["conv"],
                         r["pid"], mcode.get(r["muni"], ""), r["legal"], r["exempt"]] + ([r["grantor"], r["grantee"]] if names else []))
        c = next(v for v in cix.values() if v["fips"] == fips)
        doc = {"state": st, "county": c["name"], "fips": fips, "source": cfg["source"], "source_short": cfg["short"],
               "links": cfg["links"], "since_note": cfg["since_note"], "fetched_utc": now, "names": names,
               "coverage": {"from": rs[-1]["date"], "to": rs[0]["date"], "n": len(rs)}, "cols": cols, "munis": munis, "rows": rows}
        s = json.dumps(doc, separators=(",", ":"))
        total += len(s)
        with open(os.path.join(OUT, st.lower(), fips + ".json"), "w") as f:
            f.write(s)
        index.append({"fips": fips, "name": c["name"], "lat": c["lat"], "lng": c["lng"], "n": len(rs), "from": rs[-1]["date"], "to": rs[0]["date"]})
    if total > MAX_STATE_MB * 1048576:
        raise SystemExit("%s: %.1f MB of county files, over the %d MB cap; not written (raise it in this file on purpose)" % (st, total / 1048576, MAX_STATE_MB))
    with open(os.path.join(OUT, st.lower(), "index.json"), "w") as f:
        json.dump({"state": st, "source": cfg["source"], "fetched_utc": now, "names": names, "counties": index,
                   "unplaced_rows": unplaced}, f, separators=(",", ":"))
    return {"counties": len(index), "rows": sum(i["n"] for i in index), "mb": round(total / 1048576, 2), "names": names, "unplaced": unplaced}


_JAR = None


def fetch(url, timeout=120):
    """GET with a cookie jar: Wisconsin's data pages sit behind a cookie check and answer
    'cookies disabled' to a client that drops them."""
    global _JAR
    import http.cookiejar
    if _JAR is None:
        _JAR = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "text/html,application/json,application/xhtml+xml,*/*;q=0.8",
                                               "Accept-Language": "en-US,en;q=0.9"})
    with _JAR.open(req, timeout=timeout) as r:
        return r.read()


# Pages saved by --probe besides each state's data pages: layouts, data dictionaries and catalogs,
# so the real columns can be read on the raw branch before any parser trusts them.
PROBE_DOCS = {
    "WI": ["https://www.revenue.wi.gov/SLFReportsHistSales/RETRmlist.pdf",
           "https://www.revenue.wi.gov/Pages/SLF/Assessor-News/2026-02-24.aspx",
           "https://www.revenue.wi.gov/Pages/RETr/Home.aspx"],
    "MN": ["https://www.revenue.state.mn.us/electronic-certificate-real-estate-value-ecrv",
           "https://www.revenue.state.mn.us/sales-ratio-reports"],
    "IL": ["https://api.us.socrata.com/api/catalog/v1?domains=data.illinois.gov&q=mydec&limit=50",
           "https://tax.illinois.gov/localgovernments/property/mydecdatafiles.html"],
    "IA": ["https://github.com/ui-libraries/Iowa-Parcels",
           "https://raw.githubusercontent.com/ui-libraries/Iowa-Parcels/main/README.md",
           "https://raw.githubusercontent.com/ui-libraries/Iowa-Parcels/master/README.md"],
}


def file_links(page_url, html):
    out = []
    for h in re.findall(r'href="([^"]+)"', html, re.I):
        if re.search(r"\.(zip|csv|xlsx|txt)(\?|$)", h, re.I):
            u = urllib.parse.urljoin(page_url, h.replace("&amp;", "&"))
            if u not in out:
                out.append(u)
    return out


def probe(states):
    os.makedirs(RAW, exist_ok=True)
    log = []
    for st in states:
        d = os.path.join(RAW, st.lower())
        os.makedirs(d, exist_ok=True)
        for i, pg in enumerate(STATES.get(st, {}).get("pages", [])):
            try:
                html = fetch(pg).decode("utf-8", errors="replace")
            except Exception as e:  # noqa: BLE001
                log.append("%s page %s: %s" % (st, pg, e))
                continue
            open(os.path.join(d, "page%d.html" % i), "w").write(html)
            links = file_links(pg, html)
            open(os.path.join(d, "page%d-links.txt" % i), "w").write("\n".join(links) + "\n")
            every = sorted(set(urllib.parse.urljoin(pg, h.replace("&amp;", "&")) for h in re.findall(r'href="([^"#]+)"', html, re.I)))
            open(os.path.join(d, "page%d-alllinks.txt" % i), "w").write("\n".join(every) + "\n")
            log.append("%s page %s: %d file links" % (st, pg, len(links)))
            for j, u in enumerate(links[:3]):
                try:
                    blob = fetch(u)
                except Exception as e:  # noqa: BLE001
                    log.append("  %s: %s" % (u, e))
                    continue
                name = os.path.basename(urllib.parse.urlparse(u).path) or "file%d" % j
                open(os.path.join(d, name), "wb").write(blob[:30_000_000])
                try:
                    rows = list(zip(range(6), read_table(name, blob)))
                    hdr = rows[0][1] if rows else []
                    log.append("  %s: %d bytes; header %s; we read %s" % (u, len(blob), hdr, sorted(map_columns(hdr))))
                except Exception as e:  # noqa: BLE001
                    log.append("  %s: %d bytes; could not read: %s" % (u, len(blob), e))
        for j, u in enumerate(PROBE_DOCS.get(st, [])):
            try:
                blob = fetch(u)
            except Exception as e:  # noqa: BLE001
                log.append("%s doc %s: %s" % (st, u, e))
                continue
            ext = ".pdf" if blob[:4] == b"%PDF" else ".json" if blob[:1] in (b"{", b"[") else ".html"
            fn = os.path.join(d, "doc%d%s" % (j, ext))
            open(fn, "wb").write(blob[:30_000_000])
            if ext == ".pdf":
                try:
                    import subprocess
                    subprocess.run(["pdftotext", "-layout", fn, fn[:-4] + ".txt"], timeout=120, check=False)
                except Exception:  # noqa: BLE001
                    pass
            log.append("%s doc %s: %d bytes -> %s" % (st, u, len(blob), os.path.basename(fn)))
    open(os.path.join(RAW, "probe-log.txt"), "w").write("\n".join(log) + "\n")
    print("\n".join(log))
    return 0


def run(states, from_dir=None):
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    gzblob = fetch(GAZ)
    bad = 0
    for st in states:
        tables = []
        if from_dir:
            for n in sorted(os.listdir(from_dir)):
                if re.search(r"\.(zip|csv|txt|xlsx)$", n, re.I):
                    tables.append(read_table(n, open(os.path.join(from_dir, n), "rb").read()))
        else:
            for pg in STATES[st]["pages"]:
                try:
                    html = fetch(pg).decode("utf-8", errors="replace")
                except Exception as e:  # noqa: BLE001
                    print("::warning::%s data page did not answer: %s" % (st, e))
                    continue
                for u in file_links(pg, html):
                    try:
                        tables.append(read_table(os.path.basename(urllib.parse.urlparse(u).path), fetch(u)))
                    except Exception as e:  # noqa: BLE001
                        print("::warning::%s file %s: %s" % (st, u, e))
        recs, rep = parse_rows(tables)
        ok, why = checks_pass(recs, rep)
        if not ok:
            print("::warning::%s transfers not written: %s" % (st, why))
            bad += 1
            continue
        res = build(st, recs, gazetteer(STATES[st]["fips"], gzblob), now)
        print("::notice::%s transfers: %d rows in %d counties (%.2f MB); names %s; %d rows with no county match; files %d, rows read %d, not farm %d"
              % (st, res["rows"], res["counties"], res["mb"], "in the data" if res["names"] else "not in the data", res["unplaced"], rep["files"], rep["rows"], rep["not_farm"]))
    return 1 if bad == len(states) else 0


def selftest():
    bad = 0

    def ck(name, ok):
        nonlocal bad
        print(("ok   " if ok else "FAIL ") + name)
        bad += 0 if ok else 1
    fx = os.path.join(ROOT, "test", "fixtures", "land-sales", "synthetic-transfers.csv")
    recs, rep = parse_rows([read_table("x.csv", open(fx, "rb").read())])
    ck("reads the columns by name", rep.get("columns") and {"date", "price", "county", "pid", "grantor"} <= set(rep["columns"]))
    ck("keeps farm, forest, undeveloped and farm-building classes only", rep["not_farm"] == 1 and len(recs) == 5)
    ck("drops a row with no readable date", rep["bad_date"] == 1)
    ck("dates to ISO", recs[0]["date"] == "2024-03-15")
    ck("price as a whole number", recs[0]["price"] == 1250000)
    ck("class names become codes", norm_class("Agricultural forest") == "5M" and norm_class("Agricultural, Other") == "4 7" and norm_class("4 7") == "4 7")
    ck("exempt flag", any(r["exempt"] for r in recs) and not recs[0]["exempt"])
    ck("refuses a file with no date column", not checks_pass(*parse_rows([iter([["COUNTY", "PRICE"], ["Barron", "1"]])]))[0])
    ck("refuses when most rows are unreadable", not checks_pass([{"x": 1}], {"rows": 10, "bad_date": 5, "bad_price": 0, "missing": []})[0])
    ck("muni keys", muni_key("TOWN OF CHETEK") == ("T", "CHETEK") and muni_key("Chetek city") == ("C", "CHETEK") and muni_key("Chetek town") == ("T", "CHETEK"))
    ck("dates", parse_date("3/5/24") == "2024-03-05" and parse_date("2023-12-01 00:00:00") == "2023-12-01" and parse_date("13/40/2020") is None)
    ck("numbers", parse_num("$1,234.50") == 1234.5 and parse_num("") is None and parse_num("n/a") is None)
    ck("file links", file_links("https://x.gov/a/b.aspx", '<a href="/d/2024.zip">x</a><a href="c.csv">y</a><a href="z.pdf">') == ["https://x.gov/d/2024.zip", "https://x.gov/a/c.csv"])
    print("FAILS=%d" % bad)
    return 1 if bad else 0


if __name__ == "__main__":
    a = sys.argv[1:]
    if "--selftest" in a:
        sys.exit(selftest())
    if "--probe" in a:
        sys.exit(probe([x for x in a if x in STATES or x in PROBE_DOCS] or sorted(set(STATES) | set(PROBE_DOCS))))
    sts = [x for x in a if x in STATES] or ["WI", "MN"]
    fd = a[a.index("--from") + 1] if "--from" in a else None
    sys.exit(run(sts, fd))
