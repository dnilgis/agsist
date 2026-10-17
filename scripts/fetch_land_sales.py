"""Recorded land transfers for Field Scout, from each state's own public transfer data.

Writes data/land/<st>/<county fips>.json (one small file per county, loaded only
when a reader picks a field there) and data/land/<st>/index.json. The land card
uses them twice: every recorded transfer of the parcel the reader picked, and the
sold-land comps list with its filters.

Sources (free and public only; a state is built only once its files read cleanly):
  IL  Illinois Department of Revenue, MyDec transfer declarations (Form PTAX-203),
      Illinois Open Data portal dataset it54-y4c6 (2014 on, updated weekly), with
      the added-PIN table ay2h-5hx3. Farm declarations only (Line 8 current use j).
      Seller and buyer names are in the public file (Step 4).
  WI  Wisconsin Department of Revenue, Real Estate Transfer Return data. Columns are
      read by the titles in DOR's layout (SLFReportsHistSales/RETRmlist.pdf), which
      carries grantor and grantee names. As of Oct 2026 the monthly files are only
      reachable inside DOR's My Tax Account app (scripts required), so nothing is built.
  MN  Minnesota Department of Revenue, eCRV. The bulk Weekly Sales Extract is sent only
      on request; not built.

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
# 2: multi-parcel acres only when every added PIN reads once, in acres (il_acres); otherwise blank.
# The page treats a multi-parcel row's acres as uncertain in any file without this mark.
ACRES_RULE = 2

STATES = {
    "WI": {
        "name": "Wisconsin", "fips": "55",
        "source": "Wisconsin Department of Revenue, electronic Real Estate Transfer Returns",
        "short": "Wisconsin transfer return",
        "pages": ["https://www.revenue.wi.gov/Pages/ERETR/data-home.aspx"],
        "links": [{"t": "Wisconsin DOR transfer return data", "url": "https://www.revenue.wi.gov/Pages/ERETR/data-home.aspx"}],
        "since_note": "Wisconsin's electronic transfer returns began in the mid-2000s; older deeds are at the county Register of Deeds.",
        # Oct 2026: data-home.aspx is the My Tax Account app ("Javascript must be enabled"); the monthly
        # historical files sit behind its "Download historical RETR data" screen, not a plain link,
        # and 2026 returns are only in its one-at-a-time public search.
        "no_files": " (it is DOR's My Tax Account app, which needs a browser running its scripts; 2026 returns are only in its public search)",
    },
    "IL": {
        "name": "Illinois", "fips": "17", "socrata": True,
        "source": "Illinois Department of Revenue, MyDec real estate transfer declarations (Form PTAX-203), on the Illinois Open Data portal",
        "short": "Illinois transfer declaration",
        "pages": [],
        "links": [{"t": "Illinois MyDec data (PTAX-203)", "url": "https://data.illinois.gov/d/it54-y4c6"},
                  {"t": "Illinois DOR MyDec data files", "url": "https://tax.illinois.gov/localgovernments/property/mydecdatafiles.html"}],
        "since_note": "Illinois' MyDec file starts in 2014; older declarations are with the county clerk and recorder.",
    },
    "MN": {
        "name": "Minnesota", "fips": "27",
        # The bulk copy (eCRV Weekly Sales Extract, zipped XML) goes to those who email ecrv.support@state.mn.us;
        # the free public search (ecrvsearch.revenue.mn.gov) is one sale at a time. Not built until a free file is found.
        "request_only": "the bulk eCRV Weekly Sales Extract is sent only on request (ecrv.support@state.mn.us); the free public search is one sale at a time",
        "source": "Minnesota Department of Revenue, electronic Certificates of Real Estate Value (eCRV)",
        "short": "Minnesota eCRV",
        "pages": [],
        "links": [{"t": "Minnesota eCRV", "url": "https://www.revenue.state.mn.us/electronic-certificate-real-estate-value-ecrv"}],
        "since_note": "Minnesota's eCRV began in 2014; older certificates and deeds are at the county recorder.",
    },
}

# Column names seen on state transfer files, compared with letters and digits only. The first
# name in a list that a file has wins. The Wisconsin names are the column titles in DOR's
# "Real Estate Transfer Return Data" layout (SLFReportsHistSales/RETRmlist.pdf, columns A to CK).
COLS = {
    "doc": ["DOCUMENTNUMBER", "DOCNO", "DOCNUMBER", "RETRNUMBER", "RETRID", "RECEIPTNUMBER", "ECRVID", "ECRVNUMBER", "CRVNUMBER", "DOCID", "TRANSFERID", "RETURNNUMBER", "SALENUMBER"],
    "date": ["DATEOFCONVEYANCE", "CONVEYANCEDATE", "DATECONVEYED", "TRANSFERDATE", "SALEDATE", "DEEDDATE", "DATEOFSALE", "DATEOFDEED", "CONVEYDATE", "RECORDINGDATE", "RECORDEDDATE", "DATERECORDED"],
    "price": ["TOTALVALUE", "TOTALREALESTATEVALUE", "TOTALREALPROPERTYVALUE", "SALEPRICE", "PURCHASEPRICE", "TOTALPURCHASEPRICE", "VALUEOFREALPROPERTY", "CONSIDERATION", "TOTALCONSIDERATION", "SALESPRICE", "ADJUSTEDSALEPRICE"],
    "acres": ["ACRES", "TOTALACRES", "ACREAGE", "LANDACRES", "NUMBEROFACRES", "ACRESTOTAL", "DEEDEDACRES", "TOTALACREAGE"],
    "cls": ["PROPERTYCLASS", "PROPCLASS", "CLASS", "CLASSCODE", "PROPERTYTYPE", "PROPERTYUSE", "USECODE", "PLANNEDUSE", "PROPERTYCLASSIFICATION"],
    # Wisconsin's return: K "Predominate Use", 4=Agricultural, 6=Forest Land (5 is Utility & Misc. here, not undeveloped)
    "use": ["PREDOMINATEUSE", "PREDOMINANTUSE"],
    "conv": ["CONVEYANCETYPE", "DEEDTYPE", "INSTRUMENTTYPE", "TYPEOFCONVEYANCE", "CONVEYANCE", "TYPEOFDEED", "INSTRUMENT", "CONVEYANCECODE"],
    "pid": ["PARCELNUMBER", "PARCELID", "TAXPARCELNUMBER", "TAXPARCELID", "TAXKEY", "PIN", "PARCEL", "PARCELNO", "PARCELIDENTIFICATIONNUMBER", "PARCELIDENTIFICATION"],
    "muni": ["MUNICIPALITY", "MUNICIPALITYNAME", "MUNINAME", "MUNI", "TVCNAMECITYVILLAGETOWN", "TVCNAME", "CITYTOWNSHIP", "TOWNSHIPCITY", "CITYTOWNSHIPNAME", "PROPERTYMUNICIPALITY", "MCD", "TOWNSHIP"],
    "city_yn": ["CITYYN"], "village_yn": ["VILLAGEYN"], "town_yn": ["TOWNYN"],
    "county": ["COUNTY", "COUNTYNAME", "PROPERTYCOUNTY", "COUNTYOFPROPERTY", "CNTY"],
    "legal": ["LEGALDESCRIPTION", "LEGAL", "ABBREVIATEDLEGAL", "LEGALDESC", "SHORTLEGAL"],
    "grantor": ["GRANTOR", "GRANTORNAME", "GRANTORNAMES", "SELLER", "SELLERNAME", "SELLERNAMES", "GRANTORFULLNAME"],
    "grantee": ["GRANTEE", "GRANTEENAME", "GRANTEENAMES", "BUYER", "BUYERNAME", "BUYERNAMES", "GRANTEEFULLNAME"],
    "grantor_last": ["GRANTORLASTNAME"], "grantor_first": ["GRANTORFIRSTNAME"],
    "grantee_last": ["GRANTEELASTNAME"], "grantee_first": ["GRANTEEFIRSTNAME"],
    "np": ["TOTALPARCELS", "NUMBEROFPARCELS"],
    # recorded (filed) date, kept apart from the sale date for the coverage line; Line 3a acres as reported
    "rec": ["DATERECORDED", "RECORDINGDATE", "RECORDEDDATE"],
    "ac1": ["ACRESLINE1"],
    "exempt": ["EXEMPTION", "EXEMPTIONNUMBER", "EXEMPTNUMBER", "FEEEXEMPT", "EXEMPTIONCODE", "TRANSFERFEEEXEMPTION", "TRANSFEREXEMPTIONNUMBER"],
}
WI_CONVEYANCE = {"1": "Warranty Deed", "2": "Land Contract", "3": "Quit Claim Deed", "4": "Other"}
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
    m8 = re.match(r"^(\d{2})(\d{2})(\d{4})$", s)      # Wisconsin MMDDYYYY
    if m:
        y, mo, d = int(m[1]), int(m[2]), int(m[3])
    elif m8:
        mo, d, y = int(m8[1]), int(m8[2]), int(m8[3])
    elif re.match(r"^\d{6,7}$", s):
        return None    # MMDDYYYY with a leading zero dropped: 1112024 is Jan 11 or Nov 1; no guess
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
        hk = [key(h) for h in header]
        if "use" in m and "cls" in m and hk[m["cls"]] == "PROPERTYTYPE":
            del m["cls"]       # Wisconsin's Property Type is land only / with buildings, not a class
        for side in ("grantor", "grantee"):
            if side not in m and side + "_last" in m:
                m[side] = m[side + "_last"]       # a name in two columns; joined below
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
            if "use" in m and "cls" not in m:
                u = g("use")
                if re.match(r"^\d+$", u):
                    cls = {"4": "4", "6": "6"}.get(u.lstrip("0"), "")
                elif farm_class(u):
                    cls = u
                if not cls:
                    rep["not_farm"] += 1
                    continue
            elif "cls" in m and not farm_class(cls):
                rep["not_farm"] += 1
                continue
            conv = g("conv", 40)
            if "conv" in m and hk[m["conv"]] == "CONVEYANCECODE":
                conv = WI_CONVEYANCE.get(conv.lstrip("0"), conv)
            muni = g("muni", 60).upper()
            if muni and not re.match(r"^(TOWN|TOWNSHIP|VILLAGE|CITY)\b", muni):
                kind = [w for w, c in (("CITY OF", "city_yn"), ("VILLAGE OF", "village_yn"), ("TOWN OF", "town_yn")) if g(c) == "1"]
                if len(kind) == 1:
                    muni = kind[0] + " " + muni

            def who(side):
                if side + "_last" in m and m[side] == m[side + "_last"]:
                    return clean("%s %s" % (g(side + "_first"), g(side + "_last")), 80) or None
                return g(side, 80) if side in m else None
            npv = parse_num(g("np")) if "np" in m else None
            ex = g("exempt")
            recs.append({
                "doc": g("doc"), "date": d, "price": round(p), "acres": parse_num(g("acres")),
                "cls": norm_class(cls), "conv": conv.title(), "pid": g("pid", 40), "muni": muni,
                "county": g("county", 40), "legal": g("legal", LEGAL_MAX),
                "grantor": who("grantor"), "grantee": who("grantee"),
                "np": int(npv) if npv and npv >= 1 else None,
                "rec": parse_date(g("rec")) if "rec" in m else None,
                "ac1": parse_num(g("ac1")) if "ac1" in m else None,
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


def coverage(rs):
    """The sale (instrument) dates, and the filed (recorded) dates when the file has them.
    A 2018 filing can carry a 1999 deed date, so the filed range is the file's real span;
    older_deeds counts the rows whose deed date is before the first filing year."""
    ds = sorted(r["date"] for r in rs)
    cov = {"from": ds[0], "to": ds[-1], "n": len(rs)}
    recd = sorted(r["rec"] for r in rs if r.get("rec"))
    if recd:
        cov["filed_from"], cov["filed_to"] = recd[0], recd[-1]
        cov["older_deeds"] = sum(1 for r in rs if r["date"] < recd[0][:4] + "-01-01")
    return cov


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
    ac1 = any(r.get("ac1") for r in recs)
    cols = ["doc", "date", "price", "acres", "tac", "np", "cls", "conv", "pid", "muni", "legal", "exempt"] + (["grantor", "grantee"] if names else []) + (["ac1"] if ac1 else [])
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
            rows.append([r["doc"], r["date"], r["price"], round(a, 2) if a else None, r.get("tac"), r.get("np") or 1, r["cls"], r["conv"],
                         r["pid"], mcode.get(r["muni"], ""), r["legal"], r["exempt"]] + ([r["grantor"], r["grantee"]] if names else [])
                        + ([r.get("ac1")] if ac1 else []))
        c = next(v for v in cix.values() if v["fips"] == fips)
        cov = coverage(rs)
        doc = {"state": st, "county": c["name"], "fips": fips, "source": cfg["source"], "source_short": cfg["short"],
               "links": cfg["links"], "since_note": cfg["since_note"], "fetched_utc": now, "names": names,
               "coverage": cov, "acres_rule": ACRES_RULE, "cols": cols, "munis": munis, "rows": rows}
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


def strip_scripts(blob):
    """Page text without its scripts and inline keys: the raw branch keeps what a person reads,
    and a site's embedded map or analytics key would trip GitHub's secret push protection."""
    t = blob.decode("utf-8", errors="replace")
    t = re.sub(r"(?is)<script\b.*?</script>", "", t)
    t = re.sub(r"(?is)<style\b.*?</style>", "", t)
    t = re.sub(r"\b(AIza[0-9A-Za-z_-]{20,}|gh[pousr]_[0-9A-Za-z]{20,}|xox[abpr]-[0-9A-Za-z-]{10,}|AKIA[0-9A-Z]{16})", "[key removed]", t)
    return t.encode()


IL_SODA = "https://data.illinois.gov/resource/it54-y4c6.json"
IL_PINS = "https://data.illinois.gov/resource/ay2h-5hx3.json"
IL_FIELDS = ["declaration_id", "document_number", "date_recorded", "line_4_instrument_date", "line_1_county", "line_1_township",
             "line_1_city", "line_1_primary_pin", "line_1_lot_size_or_acreage", "line_2_total_parcels", "line_3_additional_pins",
             "line_5_instrument_type", "line_11_full_consideration", "line_13_net_consideration", "line_16_state_exemption",
             "line_10b_sale_between_related", "step_4_seller_name", "step_4_buyer_name"]

# Pages saved by --probe besides each state's data pages: layouts, data dictionaries and catalogs,
# so the real columns can be read on the raw branch before any parser trusts them.
PROBE_DOCS = {
    "WI": ["https://propertyinfo.revenue.wi.gov/",
           "https://www.revenue.wi.gov/SLFReportsHistSales/RETRmlist.pdf"],
    "IL": [IL_SODA + "?$select=" + ",".join(IL_FIELDS) + "&$where=line_8_current_use=%27J%27&$order=date_recorded%20DESC&$limit=6",
           IL_SODA + "?$select=line_16_state_exemption,count(*)&$where=line_8_current_use=%27J%27&$group=line_16_state_exemption&$order=count(*)%20DESC&$limit=20",
           IL_SODA + "?$select=line_1_lot_size_or_acreage,count(*)&$where=line_8_current_use=%27J%27&$group=line_1_lot_size_or_acreage&$order=count(*)%20DESC&$limit=25",
           "https://data.illinois.gov/resource/ay2h-5hx3.json?$limit=4",
           "https://tax.illinois.gov/content/dam/soi/en/web/tax/localgovernments/property/documents/ptax-203.pdf"],
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
    log, pdf_text = [], []
    for st in states:
        d = os.path.join(RAW, st.lower())
        os.makedirs(d, exist_ok=True)
        for i, pg in enumerate(STATES.get(st, {}).get("pages", [])):
            try:
                html = fetch(pg).decode("utf-8", errors="replace")
            except Exception as e:  # noqa: BLE001
                log.append("%s page %s: %s" % (st, pg, e))
                continue
            open(os.path.join(d, "page%d.html" % i), "wb").write(strip_scripts(html.encode()))
            links = file_links(pg, html)
            open(os.path.join(d, "page%d-links.txt" % i), "w").write("\n".join(links) + "\n")
            every = sorted(set(urllib.parse.urljoin(pg, h.replace("&amp;", "&")) for h in re.findall(r'href="([^"#]+)"', html, re.I)))
            open(os.path.join(d, "page%d-alllinks.txt" % i), "w").write("\n".join(every) + "\n")
            log.append("%s page %s: %d bytes, title %r; links: %s" % (st, pg, len(html), (re.findall(r"(?is)<title>(.*?)</title>", html) or [""])[0].strip()[:80],
                                                                  " ".join(h for h in every if not re.search(r"\.(css|js|png|gif|ico)(\?|$)", h))[:3000]))
            if len(every) < 15:      # a thin page (a sign-in or cookie wall): say what it says
                log.append("  text: " + re.sub(r"\s+", " ", re.sub(r"(?s)<[^>]+>", " ", strip_scripts(html.encode()).decode()))[:1500])
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
            if ext == ".html":
                blob = strip_scripts(blob)
                page = blob.decode("utf-8", errors="replace")
                hrefs = sorted(set(urllib.parse.urljoin(u, h.replace("&amp;", "&")) for h in re.findall(r'href="([^"#]+)"', page, re.I)))
                keep = [h for h in hrefs if re.search(r"data\.illinois|dataset|resource|download|\.zip|\.csv|\.xlsx|ecrv|extract|layout|dictionar|HistSales|mydec|sales|tap\.|/mta|retr|histor", h, re.I)]
                log.append("  links: " + " ".join(keep[:60]))
                words = re.sub(r"\s+", " ", re.sub(r"(?s)<[^>]+>", " ", page))
                for kw in ("Weekly Sales Extract", "data files", "request", "download", "layout", "buyer", "grantee", "names"):
                    for m in list(re.finditer(re.escape(kw), words, re.I))[:2]:
                        log.append("  [%s] ...%s..." % (kw, words[max(0, m.start() - 200):m.end() + 300]))
            fn = os.path.join(d, "doc%d%s" % (j, ext))
            open(fn, "wb").write(blob[:30_000_000])
            if ext == ".pdf":
                try:
                    import subprocess
                    subprocess.run(["pdftotext", "-layout", fn, fn[:-4] + ".txt"], timeout=120, check=False)
                    pdf_text.append((st, re.sub(r"[ \t]+", " ", open(fn[:-4] + ".txt", errors="replace").read())))
                except Exception:  # noqa: BLE001
                    pass
            if ext == ".json":
                try:
                    J = json.loads(blob)
                    if isinstance(J, dict) and J.get("encoding") == "base64":   # a GitHub readme
                        import base64
                        md = base64.b64decode(J.get("content", "")).decode("utf-8", errors="replace")
                        open(fn[:-5] + ".md", "w").write(md)
                        rows = [ln.strip() for ln in md.splitlines() if "rest/services" in ln]
                        log.append("  readme: %d lines with a service URL" % len(rows))
                        log.extend("  " + ln[:300] for ln in rows[:120])
                    for r in ((J.get("result") or {}).get("results") or [])[:10] if isinstance(J, dict) else []:
                        log.append("  ckan dataset %s: %s" % (r.get("name"), r.get("title")))
                        for R in r.get("resources") or []:
                            log.append("    resource %s | %s | %s | %s" % (R.get("name"), R.get("format"), R.get("url"), R.get("last_modified")))
                except Exception:  # noqa: BLE001
                    pass
                try:
                    J = json.loads(blob)
                    for r in (J.get("results") or [])[:40] if isinstance(J, dict) else []:
                        R = r.get("resource") or {}
                        if re.search(r"PTAX|MyDec|Transfer Declaration", R.get("name") or "", re.I):
                            log.append("  dataset %s %r updated %s; %d columns" % (R.get("id"), R.get("name"), R.get("data_updated_at"), len(R.get("columns_field_name") or [])))
                    if isinstance(J, dict) and J.get("columns"):            # a Socrata view: every column
                        log.append("  columns: " + " ".join("%s(%s)" % (c.get("fieldName"), c.get("dataTypeName")) for c in J["columns"]))
                    if isinstance(J, list):                                 # a SoQL answer
                        log.append("  rows: " + json.dumps(J[:60])[:4000])
                except Exception:  # noqa: BLE001
                    pass
            log.append("%s doc %s: %d bytes -> %s" % (st, u, len(blob), os.path.basename(fn)))
    open(os.path.join(RAW, "probe-log.txt"), "w").write("\n".join(log) + "\n")
    print("\n".join(log))
    annotate("probe", "\n".join(log))
    for st, t in pdf_text[:2]:
        annotate("layout " + st, t, most=2)
    return 0


def annotate(title, text, chunk=6000, most=6):
    """Print text as ::notice annotations, a few chunks at most (the check-run API returns them)."""
    for i in range(0, min(len(text), chunk * most), chunk):
        part = text[i:i + chunk].replace("%", "%25").replace("\r", "").replace("\n", "%0A")
        print("::notice title=%s %d::%s" % (title, i // chunk + 1, part))


def il_acres(line1, n, adds, primary_pin=""):
    """Total acres on one Illinois declaration, or None when the return does not say for sure.

    PTAX-203 has no total-acres line. Line 3 lists each parcel's PIN with its own lot size
    or acreage; Line 3a (line_1_lot_size_or_acreage in the open data) is the primary PIN's,
    and the instructions say that when only a combined figure is known it goes on Line 3a
    for all the parcels. The added-PIN table (ay2h-5hx3) has one row per added PIN with its
    own lot size and units, but the same PIN can come back more than once (the Oct 2026 build
    summed a 2-parcel Livingston sale, legal "the northwest quarter of section 17 ... excepting",
    to 894.9 acres, six times 149.15). So:
      - one parcel: Line 3a is the sale's acres;
      - several: Line 3a plus each added PIN, only when each added PIN appears once (the
        primary PIN repeated in the added list with Line 3a's own figure is skipped), there
        are exactly total-parcels minus one of them,
        every lot size is in acres or square feet, none is blank or zero (a blank there can
        mean Line 3a already holds the combined figure), and no parcel averages over a
        section (640 acres). Anything else is uncertain: None, never a guess."""
    if line1 is None or not (0 < line1 < 20000):
        return None
    if n <= 1:
        return round(line1, 2)
    pk = key(primary_pin)
    seen = {}
    for x in adds:
        p = key(x.get("pin"))
        v, u = parse_num(x.get("lot_size_or_acreage")), str(x.get("lot_size_units") or "").upper()
        if v is not None and u.startswith("SQ"):
            v = v / 43560.0
        elif v is not None and not u.startswith("ACRE"):
            return None
        if p and p == pk:
            if v is None or abs(v - line1) > 0.01:
                return None        # Line 3a is not this parcel's own figure
            continue
        if not p or v is None or v <= 0:
            return None
        if p in seen:
            return None            # the same added PIN twice: the table does not say which rows are real
        seen[p] = v
    if len(seen) != n - 1:
        return None
    tot = line1 + sum(seen.values())
    if tot / n > 640:
        return None
    return round(tot, 2)


def il_table(decls, extra):
    """Illinois MyDec rows (Socrata JSON, Line 8 current use 'j' Farm) as one table with our column names.
    One row per declaration: the price is for every parcel on it, so acres are the whole sale's
    (il_acres) or left blank when the return does not say for sure; ACRESLINE1 keeps what Line 3a
    says so the page can show it as reported. extra: {declaration_id: [additional PIN rows]}."""
    head = ["DOCUMENTNUMBER", "DATEOFCONVEYANCE", "TOTALVALUE", "ACRES", "PROPERTYCLASS", "CONVEYANCETYPE", "PARCELNUMBER",
            "TOWNSHIP", "COUNTY", "LEGALDESCRIPTION", "GRANTORNAME", "GRANTEENAME", "EXEMPTION", "TOTALPARCELS", "DATERECORDED", "ACRESLINE1"]
    yield head
    for d in decls:
        did = str(d.get("declaration_id") or "")
        n = parse_num(d.get("line_2_total_parcels"))
        n = int(n) if n and n >= 1 else 1
        adds = extra.get(did, [])
        l1 = parse_num(d.get("line_1_lot_size_or_acreage"))
        l1 = l1 if l1 and 0 < l1 < 20000 else None
        ac = il_acres(l1, n, adds, d.get("line_1_primary_pin") or "")
        if n == 1 and d.get("line_3_additional_pins") in (True, "true"):
            ac = None       # one parcel counted, yet added PINs ticked: the return contradicts itself
        price = d.get("line_13_net_consideration")
        if parse_num(price) is None:
            price = d.get("line_11_full_consideration")
        conv = str(d.get("line_5_instrument_type") or "")
        if d.get("line_10b_sale_between_related") in (True, "true"):
            conv += ", related parties"
        yield [str(d.get("document_number") or did), str(d.get("line_4_instrument_date") or d.get("date_recorded") or "")[:10],
               "" if price is None else str(price), "" if ac is None else str(ac), "4", conv, str(d.get("line_1_primary_pin") or ""),
               str(d.get("line_1_township") or ""), str(d.get("line_1_county") or ""), str(d.get("step_3_legal_description") or ""),
               str(d.get("step_4_seller_name") or ""), str(d.get("step_4_buyer_name") or ""), str(d.get("line_16_state_exemption") or ""), str(n),
               str(d.get("date_recorded") or "")[:10], "" if l1 is None or n == 1 else str(l1)]


def soda(url, params):
    return json.loads(fetch(url + "?" + urllib.parse.urlencode(params, safe="(),'=*$", quote_via=urllib.parse.quote), timeout=300))


def fetch_il():
    """Every Illinois farm declaration (Line 8 current use j, Farm) and the added PINs on them."""
    decls, off, page = [], 0, 50000
    while True:
        got = soda(IL_SODA, {"$select": ",".join(IL_FIELDS + ["step_3_legal_description"]), "$where": "line_8_current_use='J'",
                             "$order": "declaration_id", "$limit": page, "$offset": off})
        decls += got
        if len(got) < page:
            break
        off += page
    need = [d["declaration_id"] for d in decls if d.get("declaration_id") and (parse_num(d.get("line_2_total_parcels")) or 1) > 1]
    extra = {}
    for i in range(0, len(need), 80):
        ids = ",".join("'%s'" % re.sub(r"[^0-9A-Za-z]", "", x) for x in need[i:i + 80])
        for x in soda(IL_PINS, {"$where": "declaration_id in(%s)" % ids, "$limit": 50000}):
            extra.setdefault(str(x.get("declaration_id")), []).append(x)
    return decls, extra, len(need)


def run(states, from_dir=None):
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    gzblob = fetch(GAZ)
    bad = 0
    for st in states:
        tables = []
        if STATES[st].get("request_only"):
            print("::notice::%s transfers not built: %s" % (st, STATES[st]["request_only"]))
            continue
        if STATES[st].get("socrata") and not from_dir:
            try:
                decls, extra, multi = fetch_il()
            except Exception as e:  # noqa: BLE001
                print("::warning::%s open data did not answer: %s" % (st, e))
                bad += 1
                continue
            print("%s: %d farm declarations, %d with more than one parcel, %d added PINs read" % (st, len(decls), multi, sum(len(v) for v in extra.values())))
            tables.append(il_table(decls, extra))
        elif from_dir:
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
        if not tables:
            print("::warning::%s transfers not written: the data page lists no file to download%s" % (st, STATES[st].get("no_files", "")))
            bad += 1
            continue
        recs, rep = parse_rows(tables)
        ok, why = checks_pass(recs, rep)
        if not ok:
            print("::warning::%s transfers not written: %s" % (st, why))
            bad += 1
            continue
        res = build(st, recs, gazetteer(STATES[st]["fips"], gzblob), now)
        print("::notice::%s transfers: %d rows in %d counties (%.2f MB); names %s; %d rows with no county match; files %d, rows read %d, not farm %d"
              % (st, res["rows"], res["counties"], res["mb"], "in the data" if res["names"] else "not in the data", res["unplaced"], rep["files"], rep["rows"], rep["not_farm"]))
    return 1 if bad and bad == len([s for s in states if not STATES[s].get("request_only")]) else 0


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
    # Wisconsin, a file shaped like DOR's layout (all 89 column titles, A to CK)
    fx2 = os.path.join(ROOT, "test", "fixtures", "land-sales", "wi-retr-layout-sample.csv")
    w, wr = parse_rows([read_table("wi.csv", open(fx2, "rb").read())])
    ck("WI layout: date, value, county and parcel found by their titles", {"date", "price", "county", "pid", "use", "grantor", "grantee"} <= set(wr.get("columns") or []))
    ck("WI layout: Predominate Use 4 and 6 kept, 1 and 5 dropped", wr["not_farm"] == 2 and sorted(r["cls"] for r in w) == ["4", "4", "6"])
    ck("WI layout: Property Type is not read as a class", "cls" not in (wr.get("columns") or []))
    ck("WI layout: MMDDYYYY dates", w[0]["date"] == "2024-03-15" and w[1]["date"] == "2025-01-10")
    ck("WI layout: a date with its leading zero dropped is not guessed", wr["bad_date"] == 1 and parse_date("1112024") is None)
    ck("WI layout: names from the first and last name columns", w[0]["grantor"] == "SYNTHETIC SELLER A" and w[0]["grantee"] == "SYNTHETIC BUYER A" and w[1]["grantor"] == "SYNTHETIC FARMS LLC")
    ck("WI layout: conveyance codes read as deed types", [r["conv"] for r in w] == ["Warranty Deed", "Land Contract", "Quit Claim Deed"])
    ck("WI layout: town from the TVC name and Town YN", w[0]["muni"] == "TOWN OF CHETEK" and muni_key(w[0]["muni"]) == ("T", "CHETEK"))
    ck("WI layout: exemption number flags the return", w[2]["exempt"] == 1 and w[0]["exempt"] == 0)
    # Illinois, rows shaped like the MyDec open data answer (it54-y4c6, Line 8 current use J)
    decl = [
        {"declaration_id": "1", "document_number": "2026-000001", "date_recorded": "2026-10-09T00:00:00.000", "line_4_instrument_date": "2026-09-23T00:00:00.000",
         "line_1_county": "Mercer", "line_1_township": "Abington", "line_1_primary_pin": "14-14-34-300-004", "line_1_lot_size_or_acreage": "35",
         "line_2_total_parcels": "2", "line_3_additional_pins": True, "line_5_instrument_type": "Warranty Deed", "line_11_full_consideration": "775000.0",
         "line_13_net_consideration": "775000.0", "line_10b_sale_between_related": False, "step_4_seller_name": "SYNTHETIC SELLER A", "step_4_buyer_name": "SYNTHETIC BUYER A"},
        {"declaration_id": "2", "document_number": "2026-000002", "date_recorded": "2026-10-09T00:00:00.000", "line_4_instrument_date": "2026-10-08T00:00:00.000",
         "line_1_county": "Montgomery", "line_1_township": "Pitman", "line_1_primary_pin": "03-22-200-003", "line_1_lot_size_or_acreage": "20",
         "line_2_total_parcels": "1", "line_3_additional_pins": False, "line_5_instrument_type": "Trustee Deed", "line_11_full_consideration": "300000.0",
         "line_13_net_consideration": "300000.0", "line_10b_sale_between_related": True, "step_4_seller_name": "SYNTHETIC SELLER B", "step_4_buyer_name": "SYNTHETIC BUYER B"},
        {"declaration_id": "3", "document_number": "2026-000003", "line_4_instrument_date": "2025-04-01T00:00:00.000", "line_1_county": "Will",
         "line_1_township": "Wilton", "line_1_primary_pin": "13-19-04-100-002-0000", "line_1_lot_size_or_acreage": "40.5", "line_2_total_parcels": "2",
         "line_3_additional_pins": True, "line_5_instrument_type": "Warranty Deed", "line_11_full_consideration": "900000.0", "line_13_net_consideration": "880000.0",
         "line_16_state_exemption": "", "step_4_seller_name": "SYNTHETIC SELLER C", "step_4_buyer_name": "SYNTHETIC BUYER C"},
    ]
    extra = {"1": [{"declaration_id": "1", "pin": "14-14-34-300-005", "lot_size_or_acreage": "45", "lot_size_units": "Acres"}],
             "3": [{"declaration_id": "3", "pin": "13-19-04-100-003-0000", "lot_size_or_acreage": "56' x 208'", "lot_size_units": "Dimensions"}]}
    il, ir = parse_rows([il_table(decl, extra)])
    ck("IL: every farm declaration read", len(il) == 3 and ir["bad_date"] == 0 and ir["bad_price"] == 0)
    ck("IL: instrument date, net consideration for real property", il[0]["date"] == "2026-09-23" and il[2]["price"] == 880000)
    ck("IL: acres for the whole sale when every lot size is in acres", il[0]["acres"] == 80 and il[0]["np"] == 2)
    ck("IL: acres left blank when an added lot size is not in acres", il[2]["acres"] is None and il[2]["np"] == 2)
    ck("IL: one parcel keeps its Line 1 acres", il[1]["acres"] == 20 and il[1]["np"] == 1)
    ck("IL: recorded date read apart from the sale date", il[0]["rec"] == "2026-10-09" and il[0]["date"] == "2026-09-23")
    ck("IL: Line 3a acres kept as reported on a multi-parcel row only", il[0]["ac1"] == 35 and il[1]["ac1"] is None)
    # Multi-parcel acres, shaped like real Oct 2026 rows (names and numbers synthetic, the shapes are the real ones)
    liv = {"declaration_id": "9", "document_number": "2026R-00009", "date_recorded": "2026-08-20T00:00:00.000",
           "line_4_instrument_date": "2026-08-17T00:00:00.000", "line_1_county": "Livingston", "line_1_township": "Nebraska",
           "line_1_primary_pin": "13-13-17-100-002", "line_1_lot_size_or_acreage": "149.15", "line_2_total_parcels": "2",
           "line_3_additional_pins": True, "line_5_instrument_type": "Warranty Deed", "line_13_net_consideration": "2182500.0",
           "step_3_legal_description": "THE NORTHWEST QUARTER OF SECTION 17, TOWNSHIP 28 NORTH, RANGE 3 EAST OF THE THIRD PRINCIPAL MERIDIAN; EXCEPTING"}
    pin2 = {"pin": "13-13-17-100-003", "lot_size_or_acreage": "149.15", "lot_size_units": "Acres"}
    ck("IL: an added PIN that comes back five times is not summed five times (894.9 ac before)",
       il_acres(149.15, 2, [dict(pin2) for _ in range(5)], "13-13-17-100-002") is None)
    ck("IL: the same sale with its added PIN once sums both parcels", il_acres(149.15, 2, [{"pin": "13-13-17-100-003", "lot_size_or_acreage": "10.85", "lot_size_units": "Acres"}], "13-13-17-100-002") == 160)
    ck("IL: the primary PIN repeated in the added list with its own acres is skipped",
       il_acres(80, 3, [{"pin": "13131710000 2", "lot_size_or_acreage": "80", "lot_size_units": "Acres"},
                        {"pin": "13-13-17-200-001", "lot_size_or_acreage": "40", "lot_size_units": "Acres"},
                        {"pin": "13-13-17-200-002", "lot_size_or_acreage": "40", "lot_size_units": "Acres"}], "13-13-17-100-002") == 160)
    ck("IL: the primary PIN in the added list with other acres means Line 3a is a combined figure: uncertain",
       il_acres(160, 2, [{"pin": "13-13-17-100-002", "lot_size_or_acreage": "120", "lot_size_units": "Acres"},
                         {"pin": "13-13-17-100-003", "lot_size_or_acreage": "40", "lot_size_units": "Acres"}], "13-13-17-100-002") is None)
    ck("IL: a blank or zero added lot size (Line 3a may already hold the total) is uncertain",
       il_acres(160, 2, [{"pin": "13-13-17-100-003", "lot_size_or_acreage": "", "lot_size_units": "Acres"}], "x") is None
       and il_acres(160, 2, [{"pin": "13-13-17-100-003", "lot_size_or_acreage": "0", "lot_size_units": "Acres"}], "x") is None)
    ck("IL: fewer added PINs than the parcel count is uncertain", il_acres(40, 3, [dict(pin2)], "x") is None)
    ck("IL: square feet convert, dimensions do not", il_acres(40, 2, [{"pin": "a", "lot_size_or_acreage": "43560", "lot_size_units": "Sq. Feet"}], "x") == 41
       and il_acres(40, 2, [{"pin": "a", "lot_size_or_acreage": "56' x 208'", "lot_size_units": "Dimensions"}], "x") is None)
    ck("IL: over a section per parcel is not believed", il_acres(1000, 2, [{"pin": "a", "lot_size_or_acreage": "500", "lot_size_units": "Acres"}], "x") is None)
    one_more = dict(liv, declaration_id="10", line_2_total_parcels="1")
    old_deed = dict(liv, declaration_id="11", line_2_total_parcels="1", line_3_additional_pins=False, date_recorded="2018-03-02T00:00:00.000",
                    line_4_instrument_date="1999-06-29T00:00:00.000", line_1_lot_size_or_acreage="40")
    il2, _ = parse_rows([il_table([liv, one_more, old_deed], {"9": [dict(pin2) for _ in range(6)]})])
    ck("IL: the duplicated-PIN sale is written with acres blank and Line 3a kept", il2[0]["acres"] is None and il2[0]["ac1"] == 149.15 and il2[0]["np"] == 2)
    ck("IL: one parcel counted but added PINs ticked: acres blank", il2[1]["acres"] is None)
    cv = coverage(il2)
    ck("IL: coverage gives the filed range and counts the older deed dates", cv["from"] == "1999-06-29" and cv["filed_from"] == "2018-03-02"
       and cv["filed_to"] == "2026-08-20" and cv["older_deeds"] == 1)
    ck("IL: a 2018 filing with a 1999 deed date keeps both dates", il2[2]["date"] == "1999-06-29" and il2[2]["rec"] == "2018-03-02" and il2[2]["acres"] == 40)
    ck("IL: names from Step 4", il[0]["grantor"] == "SYNTHETIC SELLER A" and il[0]["grantee"] == "SYNTHETIC BUYER A")
    ck("IL: related-party sales say so", il[1]["conv"].endswith("Related Parties"))
    ck("IL: township as the place", il[0]["muni"] == "ABINGTON" and muni_key(il[0]["muni"]) == ("T", "ABINGTON"))
    ck("MN is not built from a guess", bool(STATES["MN"].get("request_only")))
    print("FAILS=%d" % bad)
    return 1 if bad else 0


if __name__ == "__main__":
    a = sys.argv[1:]
    if "--selftest" in a:
        sys.exit(selftest())
    if "--probe" in a:
        sys.exit(probe([x for x in a if x in STATES or x in PROBE_DOCS] or sorted(set(STATES) | set(PROBE_DOCS))))
    sts = [x for x in a if x in STATES] or ["WI", "MN", "IL"]
    fd = a[a.index("--from") + 1] if "--from" in a else None
    sys.exit(run(sts, fd))
