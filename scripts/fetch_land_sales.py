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
  WI  Wisconsin Department of Revenue, electronic Real Estate Transfer Returns (eRETR).
      The monthly files (the last five years) are on DOR's public My Tax Account screen
      "Real Estate Historical Data", which needs a browser running its scripts:
      scripts/wi_retr_browser.py --fetch DIR downloads each month's XML report there (every
      parcel, grantor and grantee on a return; the CSV report shows only the first) and
      writes DIR/build/wi-retr.csv with our column names, farm and forest returns only;
      then --from DIR/build WI builds. Grantor and grantee names are in the public file.
  MN  Minnesota Department of Revenue, eCRV. The bulk Weekly Sales Extract is sent only
      on request; not built.
  IN  Indiana sales disclosure forms (Department of Local Government Finance), yearly ZIP
      files of five tab-delimited tables on STATS Indiana (Indiana Business Research Center),
      the current year cumulative and refreshed weekly. Free, no login. The newest six years
      (2021 on, the current layout); farm forms only (a parcel in class 100 to 199); forms with no
      valuable consideration, trades, partial interests, charity or government transfers and
      short sales left out; quitclaims, sheriff sales, court orders, partitions, easements and
      family discounts kept and named so the land card's market-sale test leaves them out of comps.
      Buyer and seller names from the contact table (never the preparer, an address or a phone).
      Towns are the parcel's postal city, placed at its ZIP's Census centroid (in_places).
      Kept under 8 MB (data/ is near its budget): 10+ acre sales first, then the oldest year.
  Probe only (Oct 18; saved by --probe, no parser until the saved columns are read):
  IA  Scott County Assessor's agricultural sales list (Excel), one county.
  SD  County Directors of Equalization that post yearly ag sales lists (Douglas, Gregory).
  OH  County auditor sales reports (Pickaway), one county at a time.
  Not free: NE (state sales file, public queries by request for a fee), KS and MO (sale
  prices are not public record). Their notes are in data/land/parcel-services.json salesNote.

  python3 scripts/fetch_land_sales.py --probe [WI MN]   save the data pages, the file
        links they list and the head of the first files to data/land-raw/sales/ (the
        workflow moves that to the raw branch). Run this first and read the columns.
  python3 scripts/fetch_land_sales.py [WI MN]           fetch every listed file and build
  python3 scripts/fetch_land_sales.py --from DIR WI     build from files already downloaded
        (for WI, the wi-retr.csv that scripts/wi_retr_browser.py --fetch writes)
  python3 scripts/fetch_land_sales.py --from DIR WI --merge   add those rows to data/land/wi
        (the monthly newest-only run): a return read again replaces its older copy, nothing
        else on disk is dropped unless the size cap trims it
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
CONV_MAX = 200     # deed type as written; Indiana's list of what the form says runs past 60 characters
# 2: multi-parcel acres only when every added PIN reads once, in acres (il_acres); otherwise blank.
# The page treats a multi-parcel row's acres as uncertain in any file without this mark.
ACRES_RULE = 2

STATES = {
    "WI": {
        "name": "Wisconsin", "fips": "55",
        "source": "Wisconsin Department of Revenue, electronic Real Estate Transfer Returns",
        "short": "Wisconsin transfer return",
        "pages": [],
        "links": [{"t": "Wisconsin DOR transfer return data", "url": "https://www.revenue.wi.gov/Pages/ERETR/data-home.aspx"}],
        "since_note": "Wisconsin DOR's public download holds the last five years of returns; older ones are in DOR's property search and at the county Register of Deeds.",
        # Oct 2026: data-home.aspx redirects to the My Tax Account app (tap.revenue.wi.gov/RETRHistoric):
        # a disclaimer to agree to, then one link per month. The file comes from a session-bound
        # request, so scripts/wi_retr_browser.py fetches it in a real browser and this builds --from it.
        "no_files": " (Wisconsin's monthly files come through scripts/wi_retr_browser.py --fetch; build with --from)",
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

# Sources saved by --probe but never built: the parser for each is written against the saved copy,
# and run() refuses them until then (probe_only says why).
STATES.update({
    "IN": {
        "name": "Indiana", "fips": "18",
        # Built (Oct 18): in_table joins SALEDISC, SALEPARCEL and SALECONTAC, read against the saved SDF_2026.zip.
        "source": "Indiana Department of Local Government Finance, sales disclosure forms, from STATS Indiana (Indiana Business Research Center)",
        "short": "Indiana sales disclosure",
        "pages": ["https://www.stats.indiana.edu/topic/sdf.asp"],
        "links": [{"t": "Indiana sales disclosure data (STATS Indiana)", "url": "https://www.stats.indiana.edu/topic/sdf.asp"},
                  {"t": "Indiana DLGF sales disclosure search", "url": "https://www.in.gov/dlgf/assessments/sales-disclosure-form-information/"}],
        "since_note": "Our Indiana copy starts with 2021 forms (STATS Indiana's current file layout); older forms are in its legacy files and at the county assessor.",
        "terms": "free download, no login; STATS Indiana says the data are made available for research through a DLGF and IBRC partnership; no written reuse terms found (not checked from here: the sandbox cannot open the site)",
        # data/ has its 300 MB budget (264 MB published on Oct 18): Indiana's files stay under 8 MB, trimmed
        # like Wisconsin (10+ acre sales first, then the oldest filing year) when they would not fit.
        "max_mb": 8,
    },
    "IA": {
        "name": "Iowa", "fips": "19",
        "probe_only": "one county's agricultural sales list (Scott County Assessor); no statewide free file",
        "source": "Scott County, Iowa Assessor, agricultural sales", "short": "Scott County IA ag sales",
        "pages": ["https://www.scottcountyiowa.com/assessor/agricultural-sales"],
        "links": [{"t": "Scott County Assessor agricultural sales", "url": "https://www.scottcountyiowa.com/assessor/agricultural-sales"}],
        "terms": "county public page; terms not read yet",
    },
    "SD": {
        "name": "South Dakota", "fips": "46",
        "probe_only": "county Directors of Equalization post yearly ag sales lists (often PDF); saved to read the layout first",
        "source": "South Dakota county Directors of Equalization, agricultural sales lists", "short": "South Dakota county sales list",
        "pages": ["https://douglas.sdcounties.org/director-of-equalization/", "https://gregory.sdcounties.org/?p=19"],
        "files_rx": r"\.(zip|csv|xlsx|txt|pdf)(\?|$)",
        "links": [],
        "terms": "county public pages; terms not read yet",
    },
    "OH": {
        "name": "Ohio", "fips": "39",
        "probe_only": "county auditor sales reports, one county at a time; saved to read the layout first",
        "source": "Ohio county auditors, sales reports", "short": "Ohio county auditor sales",
        "pages": ["https://auditor.pickawaycountyohio.gov/SalesReport"],
        "links": [],
        "terms": "county public pages; terms not read yet",
    },
    # Phase 1 of nationwide coverage (Oct 18): statewide free files named by state agencies, saved by
    # the probe so each layout and its terms are read before a parser exists. Farm acres order.
    "FL": {
        "name": "Florida", "fips": "12",
        "probe_only": "Florida DOR's Sale Data File (SDF) and NAL roll, one file per county; saved to read the layout (land use codes 50 to 69 are agricultural) first",
        "source": "Florida Department of Revenue, Property Tax Oversight, Sale Data File", "short": "Florida sale data file",
        "pages": ["https://floridarevenue.com/property/Pages/DataPortal_RequestAssessmentRollGISData.aspx"],
        "links": [], "terms": "public data portal; confidential owners removed by the state; terms not read yet",
    },
    "NY": {
        "name": "New York", "fips": "36",
        "probe_only": "ORPTS SalesWeb (RP-5217 transfer reports, outside New York City), ten years, downloadable per search; saved to read whether a bulk file exists and its terms",
        "source": "New York State Office of Real Property Tax Services, SalesWeb (Form RP-5217)", "short": "New York RP-5217 sale",
        "pages": ["https://www.tax.ny.gov/research/property/assess/sales/salesweb.htm"],
        "links": [], "terms": "state public search; bulk download not confirmed; terms not read yet",
    },
    "MD": {
        "name": "Maryland", "fips": "24",
        "probe_only": "SDAT sales as published by the Maryland Department of Planning (parcel data and sales, GIS format); saved to read the layout first",
        "source": "Maryland Department of Planning, parcel and sales data from SDAT", "short": "Maryland SDAT sale",
        "pages": ["https://planning.maryland.gov/MSDC/Pages/91_property_mapping/parcel-data.aspx"],
        "links": [], "terms": "state public data; terms not read yet",
    },
    "VT": {
        "name": "Vermont", "fips": "50",
        "probe_only": "Vermont Department of Taxes weekly property transfer tax return data (last five years, new layout since 2020); saved to read the layout first",
        "source": "Vermont Department of Taxes, property transfer tax returns", "short": "Vermont transfer tax return",
        "pages": ["https://tax.vermont.gov/data-and-statistics/ptt"],
        "links": [], "terms": "state public data; the weekly file is linked from the state's page; terms not read yet",
    },
    "NJ": {
        "name": "New Jersey", "fips": "34",
        "probe_only": "Division of Taxation SR-1A sales file (fixed width, layout published); saved to find the file and read the layout first",
        "source": "New Jersey Division of Taxation, SR-1A sales data", "short": "New Jersey SR-1A sale",
        "pages": [],
        "links": [], "terms": "layout public; where the data file is posted not confirmed; terms not read yet",
    },
    "CT": {
        "name": "Connecticut", "fips": "09",
        "probe_only": "OPM Real Estate Sales listing on data.ct.gov (sales of $2,000 or more since 2001, by grand list year); no farm class or acres, so likely vacant land only; saved to read the columns first",
        "source": "Connecticut Office of Policy and Management, Real Estate Sales", "short": "Connecticut real estate sale",
        "pages": [], "links": [], "terms": "state open data portal; license not given on the catalog listing",
    },
})
PROBE_ONLY_DOCS = {
    "IN": ["https://www.in.gov/dlgf/assessments/sales-disclosure-form-information/"],
    "NE": ["https://revenue.nebraska.gov/sites/default/files/doc/legal/regs/pad/Chapter12_Sales_File.pdf"],
    "IN": ["https://www.stats.indiana.edu/about/sdf.asp"],
    "FL": ["https://floridarevenue.com/property/dataportal/Documents/PTO%20Data%20Portal/User%20Guides/2026%20Users%20guide%20and%20quick%20reference/2026_NAL_SDF_NAP_Users_Guide.pdf"],
    "NY": ["https://www.tax.ny.gov/pdf/ORPTS/SalesDataFlowchartHandout.pdf",
           "https://data.ny.gov/api/catalog/v1?q=real%20property%20sales&limit=20"],
    "MD": ["https://opendata.maryland.gov/api/catalog/v1?q=sales&limit=20"],
    "NJ": ["https://nj.gov/treasury/taxation/pdf/lpt/SR1Afilelayout.pdf"],
    "CT": ["https://data.ct.gov/api/catalog/v1?q=real%20estate%20sales&limit=20"],
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
    # Wisconsin: the sum of every parcel's acres above zero, used only to trim to 10+ acre sales (never published)
    "acany": ["ACRESANYPARCEL"],
    # Indiana: the parcel's postal ZIP, used only to place its town (in_places)
    "zip": ["ZIP"],
    # plain words on what kind of sale it was, "; " between them (il_table, in_table, wi_row write them)
    "flags": ["FLAGS"],
    # Wisconsin's CSV: J Property Type (1 Land Only, 2 Land & Buildings), BJ Split Parcel (1 Yes),
    # Q Owner Interest Transferred (1 Full, 2 Partial); read only beside Predominate Use (RETRmlist.pdf)
    "ptype": ["PROPERTYTYPE"], "split": ["SPLITPARCEL"], "interest": ["OWNERINTERESTTRANSFERRED"],
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
            conv = g("conv", CONV_MAX)
            if "conv" in m and hk[m["conv"]] == "CONVEYANCECODE":
                conv = WI_CONVEYANCE.get(conv.lstrip("0"), conv)
            flags = [w for w in (x.strip() for x in g("flags").split(";")) if w]
            if "use" in m:        # Wisconsin's own CSV layout
                pt = g("ptype").lstrip("0")
                if "ptype" in m and pt in ("1", "2"):
                    flags.append("land only" if pt == "1" else "with buildings")
                if "interest" in m and g("interest").lstrip("0") == "2":
                    flags.append("less than full interest")
                if "split" in m and g("split").lstrip("0") == "1":
                    flags.append("split parcel")
            flags = list(dict.fromkeys(flags))
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
            conv = re.sub(r"[A-Za-z]+('[A-Za-z]+)?", lambda w: w.group(0).capitalize(), conv)
            if flags:      # the flag words stay exactly as written (helper words, not deed names)
                conv = "; ".join([conv] + flags) if conv else "; ".join(flags)
            recs.append({
                "doc": g("doc"), "date": d, "price": round(p), "acres": None if "split parcel" in flags else parse_num(g("acres")),
                "cls": norm_class(cls), "conv": conv, "pid": g("pid", 40), "muni": muni,
                "county": g("county", 40), "legal": g("legal", LEGAL_MAX),
                "grantor": who("grantor"), "grantee": who("grantee"),
                "np": int(npv) if npv and npv >= 1 else None,
                "rec": parse_date(g("rec")) if "rec" in m else None,
                "ac1": parse_num(g("ac1")) if "ac1" in m else None,
                "acany": parse_num(g("acany")) if "acany" in m else None,
                "exempt": 1 if ex and not re.match(r"^(0|N|NO|NONE|FALSE)$", ex, re.I) else 0,
                "zip": g("zip", 5) if "zip" in m else None,
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


class OverCap(Exception):
    """A state's county files together are over MAX_STATE_MB; nothing was written."""


def build(st, recs, gaz, now, prior=None, months=None):
    """prior: {fips: coverage} of files merged in (their rows may lack a filed date), so the
    filed span stays the whole span. months: the monthly files the rows came from (index.json)."""
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
    # Wisconsin rows keep their filed date, so a later newest-only run can tell the latest filing of a return
    rec = st == "WI" and any(r.get("rec") for r in recs)
    cols = ["doc", "date", "price", "acres", "tac", "np", "cls", "conv", "pid", "muni", "legal", "exempt"] + (["grantor", "grantee"] if names else []) + (["ac1"] if ac1 else []) + (["rec"] if rec else [])
    index, total, files = [], 0, []
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
                        + ([r.get("ac1")] if ac1 else []) + ([r.get("rec")] if rec else []))
        c = next(v for v in cix.values() if v["fips"] == fips)
        cov = coverage(rs)
        p = (prior or {}).get(fips) or {}
        if p.get("filed_from"):
            cov["filed_from"] = min(p["filed_from"], cov.get("filed_from") or p["filed_from"])
            cov["filed_to"] = max(p.get("filed_to") or "", cov.get("filed_to") or "")
            cov["older_deeds"] = sum(1 for r in rs if r["date"] < cov["filed_from"][:4] + "-01-01")
        doc = {"state": st, "county": c["name"], "fips": fips, "source": cfg["source"], "source_short": cfg["short"],
               "links": cfg["links"], "since_note": cfg["since_note"], "fetched_utc": now, "names": names,
               "coverage": cov, "acres_rule": ACRES_RULE, "cols": cols, "munis": munis, "rows": rows}
        s = json.dumps(doc, separators=(",", ":"))
        total += len(s)
        files.append((fips, s))
        index.append({"fips": fips, "name": c["name"], "lat": c["lat"], "lng": c["lng"], "n": len(rs), "from": rs[-1]["date"], "to": rs[0]["date"]})
    cap = min(MAX_STATE_MB, cfg.get("max_mb") or MAX_STATE_MB)
    if total > cap * 1048576:
        raise OverCap("%s: %.1f MB of county files, over the %d MB cap; not written (raise it in this file on purpose)" % (st, total / 1048576, cap))
    os.makedirs(os.path.join(OUT, st.lower()), exist_ok=True)
    for fips, s in files:
        with open(os.path.join(OUT, st.lower(), fips + ".json"), "w") as f:
            f.write(s)
    with open(os.path.join(OUT, st.lower(), "index.json"), "w") as f:
        ix = {"state": st, "source": cfg["source"], "fetched_utc": now, "names": names, "counties": index, "unplaced_rows": unplaced}
        if months:
            ix["months"] = sorted(months)
        json.dump(ix, f, separators=(",", ":"))
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
             "line_10b_sale_between_related", "step_4_seller_name", "step_4_buyer_name",
             # what kind of sale it was (PTAX-203 Lines 1, 6, 7, 10 and 12b; field names as the open data
             # answer gives them, raw branch data/land-raw/sales/il/doc5.json, Oct 18 2026 probe)
             "line_1_unit", "line_1_split_parcel", "line_6_principal_residence", "line_7_property_advertised",
             "line_10a_fulfillment_of", "line_10c_transfer_of_100", "line_10d_court_ordered_sale", "line_10e_sale_in_lieu_of",
             "line_10f_condemnation", "line_10g_short_sale", "line_10h_bank_reo", "line_10i_auction_sale",
             "line_10n_buyer_is_an_adjacent", "line_10p_trade_of_property", "line_10q_sale_leaseback", "line_12b_mobile_home_included"]
# Line 10 boxes, by letter, as Form PTAX-203 (tax.illinois.gov, saved on the raw branch as
# data/land-raw/sales/il/doc4.pdf) names them. A ticked box here leaves the declaration out:
# not a sale between a willing buyer and seller on the open market.
IL_DROP = (("line_10d_court_ordered_sale", "court-ordered sale (10d)"), ("line_10e_sale_in_lieu_of", "sale in lieu of foreclosure (10e)"),
           ("line_10f_condemnation", "condemnation (10f)"), ("line_10h_bank_reo", "bank REO (10h)"),
           ("line_10p_trade_of_property", "trade of property (10p)"), ("line_10q_sale_leaseback", "sale-leaseback (10q)"))
# A ticked box here keeps the row and says so in plain words after the deed type.
IL_FLAG = (("line_10c_transfer_of_100", "less than full interest"), ("line_10i_auction_sale", "auction"),
           ("line_10n_buyer_is_an_adjacent", "adjacent owner"))

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


def file_links(page_url, html, rx=r"\.(zip|csv|xlsx|txt)(\?|$)"):
    out = []
    for h in re.findall(r'href="([^"]+)"', html, re.I):
        if re.search(rx, h, re.I):
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
            links = file_links(pg, html, STATES[st].get("files_rx") or r"\.(zip|csv|xlsx|txt)(\?|$)")
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
                if blob[:4] == b"%PDF":       # a county sales list as PDF: keep its text beside it to read the layout
                    try:
                        import subprocess
                        subprocess.run(["pdftotext", "-layout", os.path.join(d, name), os.path.join(d, name + ".txt")], timeout=120, check=False)
                        log.append("  %s: PDF, %d bytes; text saved" % (u, len(blob)))
                    except Exception:  # noqa: BLE001
                        log.append("  %s: PDF, %d bytes; no pdftotext" % (u, len(blob)))
                    continue
                try:
                    rows = list(zip(range(6), read_table(name, blob)))
                    hdr = rows[0][1] if rows else []
                    log.append("  %s: %d bytes; header %s; we read %s" % (u, len(blob), hdr, sorted(map_columns(hdr))))
                except Exception as e:  # noqa: BLE001
                    log.append("  %s: %d bytes; could not read: %s" % (u, len(blob), e))
        for j, u in enumerate(PROBE_DOCS.get(st, []) + PROBE_ONLY_DOCS.get(st, [])):
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
                        if re.search(r"PTAX|MyDec|Transfer Declaration|Real Estate Sales|Property Sales|Sales|Transfer", R.get("name") or "", re.I):
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
        return round(line1, 2) if line1 <= 640 else None     # one parcel over a section is a slip (10,124 ac on a $190,000 sale)
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


def il_yes(v):
    return v in (True, "true", "True", "1", 1)


def il_unit_acres(v, unit):
    """Line 3a's lot size in acres by its unit: acres as given, square feet / 43,560, anything else
    (Dimensions, a typed unit we do not know) None. A blank unit is read as acres, as before the unit was fetched."""
    v = parse_num(v)
    u = str(unit or "").strip().upper()
    if v is None:
        return None
    if u.startswith("SQ"):
        return v / 43560.0
    if u and not u.startswith("ACRE"):
        return None
    return v


def il_flags(d, adds=()):
    """Plain words for what kind of sale one declaration says it was (the words field-scout-land.js reads).
    Split parcel: Line 1 split box, the "PT" the instructions say to put before a part parcel's PIN,
    or an added PIN marked split."""
    out = []
    for k, w in IL_FLAG:
        if il_yes(d.get(k)):
            out.append(w)
    yr = parse_num(d.get("line_10a_fulfillment_of"))
    if yr:
        out.append("installment contract")
    adv = d.get("line_7_property_advertised")
    if adv is not None and adv != "":
        out.append("advertised" if il_yes(adv) else "not advertised")
    if (il_yes(d.get("line_1_split_parcel")) or re.match(r"^\s*PT\b", str(d.get("line_1_primary_pin") or ""), re.I)
            or any(il_yes(x.get("split_parcel")) for x in adds)):
        out.append("split parcel")
    # Line 8 is Farm on every row read (the query asks for current use J), which does not say whether
    # there are buildings; a buyer's principal residence (Line 6) or a mobile home in the price (12b) does.
    if il_yes(d.get("line_6_principal_residence")) or il_yes(d.get("line_12b_mobile_home_included")):
        out.append("with buildings")
    return out


def il_table(decls, extra, rep=None):
    """Illinois MyDec rows (Socrata JSON, Line 8 current use 'j' Farm) as one table with our column names.
    One row per declaration: the price is for every parcel on it, so acres are the whole sale's
    (il_acres) or left blank when the return does not say for sure; ACRESLINE1 keeps what Line 3a
    says so the page can show it as reported. extra: {declaration_id: [additional PIN rows]}.
    Declarations with a Line 10 box in IL_DROP ticked are left out and counted in rep."""
    rep = rep if rep is not None else {}
    head = ["DOCUMENTNUMBER", "DATEOFCONVEYANCE", "TOTALVALUE", "ACRES", "PROPERTYCLASS", "CONVEYANCETYPE", "PARCELNUMBER",
            "TOWNSHIP", "COUNTY", "LEGALDESCRIPTION", "GRANTORNAME", "GRANTEENAME", "EXEMPTION", "TOTALPARCELS", "DATERECORDED", "ACRESLINE1",
            "FLAGS"]
    yield head
    for d in decls:
        why = next((w for k, w in IL_DROP if il_yes(d.get(k))), None)
        if why:
            rep["dropped " + why] = rep.get("dropped " + why, 0) + 1
            continue
        did = str(d.get("declaration_id") or "")
        n = parse_num(d.get("line_2_total_parcels"))
        n = int(n) if n and n >= 1 else 1
        adds = extra.get(did, [])
        l1 = il_unit_acres(d.get("line_1_lot_size_or_acreage"), d.get("line_1_unit"))
        l1 = l1 if l1 and 0 < l1 < 20000 else None
        ac = il_acres(l1, n, adds, d.get("line_1_primary_pin") or "")
        if n == 1 and il_yes(d.get("line_3_additional_pins")):
            ac = None       # one parcel counted, yet added PINs ticked: the return contradicts itself
        flags = il_flags(d, adds)
        if "split parcel" in flags:
            ac = None       # part of a parcel: the lot size may be the whole parcel's
        price = d.get("line_13_net_consideration")
        if parse_num(price) is None:
            price = d.get("line_11_full_consideration")
        conv = str(d.get("line_5_instrument_type") or "")
        if il_yes(d.get("line_10b_sale_between_related")):
            conv += ", related parties"
        yield [str(d.get("document_number") or did), str(d.get("line_4_instrument_date") or d.get("date_recorded") or "")[:10],
               "" if price is None else str(price), "" if ac is None else str(round(ac, 2)), "4", conv, str(d.get("line_1_primary_pin") or ""),
               str(d.get("line_1_township") or ""), str(d.get("line_1_county") or ""), str(d.get("step_3_legal_description") or ""),
               str(d.get("step_4_seller_name") or ""), str(d.get("step_4_buyer_name") or ""), str(d.get("line_16_state_exemption") or ""), str(n),
               str(d.get("date_recorded") or "")[:10], "" if l1 is None or n == 1 else str(round(l1, 4)), "; ".join(flags)]


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


# ── Wisconsin eRETR XML (DOR's "Real Estate Historical Data" monthly report) ──────────────
# Codes are DOR's own, from the report's schema (MTA_RETR_Export.xsd, Aug 6, 2026).
# ── Indiana sales disclosure forms (DLGF, on STATS Indiana) ─────────────────────────────────
# Read against the saved SDF_2026.zip (raw branch, Oct 18 probe) and its SDF_File_Parsing_MetaData.xlsx:
# five tab-delimited tables, double quotes around every field; SALEDISC and SALECONTAC are UTF-16,
# SALEPARCEL is a one-byte code page. SALEDISC is one row per form (SDF_ID), SALEPARCEL one row per
# parcel on it, SALECONTAC the buyer (B), seller (S) and preparer (P). Money is "Format 12.2" with the
# decimal point left out (E1_Sales_Price 76000000 is $760,000.00; the state disclosure fee, $20,
# reads 2000) and acres are "Format 8.4" the same way (P2_9_Acreage 358100 is 35.81 acres). in_scale
# checks both on every file before a number is written. Property class codes (CODELIST 1):
# 100 to 199 agricultural (120 timber), 3xx industrial, 4xx commercial, 5xx residential.
IN_PAGE = "https://www.stats.indiana.edu/topic/sdf.asp"
IN_YEARS = 6            # SDF_<year>.zip files in the 2021-on layout: the current year and the five before it
IN_ZCTA = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_zcta_national.zip"
IN_NEED = {"SALEDISC": ["SDF_ID", "County_Name", "B1_Valuable_Consider", "C7_Conveyance_Date", "E1_Sales_Price", "E2_PersProp",
                        "P3_1_Disclosure_Fee", "P3_7_Fee_Collected", "P2_14_Date_Received"],
           "SALEPARCEL": ["SDF_ID", "A1_Parcel_Number", "P2_6_Prop_Class_Code", "P2_9_Acreage", "A4_Improvement", "A5_City", "A5_ZipCode",
                          "A7_Legal_Description"],
           "SALECONTAC": ["SDF_ID", "Contact_Type", "Name", "Company"]}


def in_text(blob):
    if blob[:2] in (b"\xff\xfe", b"\xfe\xff"):
        return blob.decode("utf-16")
    if blob[:3] == b"\xef\xbb\xbf":
        return blob[3:].decode("utf-8")
    return blob.decode("cp1252", errors="replace")


def in_tables(blob):
    """{table name: list of dict rows} out of one SDF_<year>.zip (only the three tables we read)."""
    z = zipfile.ZipFile(io.BytesIO(blob))
    out = {}
    for n in z.namelist():
        t = os.path.splitext(os.path.basename(n))[0].upper()
        if t in IN_NEED:
            rd = csv.DictReader(io.StringIO(in_text(z.read(n)), newline=""), delimiter="\t")
            out[t] = list(rd)
            miss = [c for c in IN_NEED[t] if c not in (rd.fieldnames or [])]
            if miss:
                raise ValueError("%s: columns not found by name: %s" % (n, ", ".join(miss)))
    for t in IN_NEED:
        if t not in out:
            raise ValueError("table %s not in the file" % t)
    return out


def in_scale(T):
    """The implied decimals, checked on the file itself, or a reason to refuse it. The state fee is
    $20 on every form that owes it, so the fee column's most common value is 2000 when two decimals
    are left out; farm parcels run a few acres to a few hundred, so their median raw acreage sits
    between 10,000 and 3,000,000 when four are."""
    fees = {}
    for d in T["SALEDISC"]:
        if d.get("P3_7_Fee_Collected") == "Y":
            fees[d.get("P3_1_Disclosure_Fee")] = fees.get(d.get("P3_1_Disclosure_Fee"), 0) + 1
    top = max(fees, key=fees.get) if fees else None
    if top != "2000" or fees[top] < 0.8 * sum(fees.values()):
        n = sum(fees.values())
        return "the disclosure fee does not read as $20 in cents (of %d forms: %s)" % (
            n, ", ".join("%r %.0f%%" % (k, 100.0 * v / n) for k, v in sorted(fees.items(), key=lambda kv: -kv[1])[:4]))
    ac = sorted(v for v in (parse_num(p.get("P2_9_Acreage")) for p in T["SALEPARCEL"] if re.match(r"^1\d\d$", p.get("P2_6_Prop_Class_Code") or "")) if v)
    if len(ac) < 5 or not (10000 <= ac[len(ac) // 2] <= 3000000):
        return "farm parcel acres do not read as four implied decimals (%d parcels, median %s)" % (len(ac), ac[len(ac) // 2] if ac else None)
    return None


def in_class(code, improved):
    """Indiana class code as the land card's classes: farm 4, timber 6, farm buildings 7 (an improved
    farm parcel), and 1, 2, 3 for residential, commercial, industrial parcels on the same form."""
    c = (code or "").strip()
    if not re.match(r"^\d\d\d$", c):
        return None
    if c[0] == "1":
        return ["6" if c == "120" else "4"] + (["7"] if improved else [])
    return [{"5": "1", "4": "2", "3": "3"}.get(c[0])] if c[0] in "345" else None


def in_county(d, names):
    """The county by its state number (County_ID, 01 Adams to 92 Whitley, alphabetical), whose FIPS
    code is 18000 + 2n - 1; the typed County_Name varies ("Carrol", "BOONE COUNTY")."""
    cid = (d.get("County_ID") or "").strip()
    if not re.match(r"^\d{1,2}$", cid) or not 1 <= int(cid) <= 92 or (d.get("SDF_ID") or "")[1:3] not in (cid.zfill(2), ""):
        return None
    return names.get("18%03d" % (2 * int(cid) - 1))


def in_county_check(T, names):
    """Refuse a file whose county numbers do not agree with its county names on almost every form."""
    n = ok = 0
    for d in T["SALEDISC"]:
        c = in_county(d, names)
        nm = key(re.sub(r"\s+COUNTY$", "", (d.get("County_Name") or "").upper()))
        if nm:
            n += 1
            ok += bool(c) and (key(c) == nm or key(c)[:5] == nm[:5])
    return None if n and ok >= 0.95 * n else "county numbers and names disagree on %d of %d forms" % (n - ok, n)


def in_conv(d):
    """What kind of sale the form says it was, in the words the land card's market-sale test reads
    (quitclaim, sheriff, foreclosure, partition, easement and related-party sales are not comps)."""
    y = lambda k: (d.get(k) or "").strip().upper() == "Y"
    bits = ["Quitclaim Deed" if y("C3_Quitclaim") else "Sale"]
    for k, w in (("B5_Land_Contract", "Land Contract"), ("C4_Auction", "Auction"), ("B2_Buyer_Adjacent", "Buyer Owns Adjacent Land"),
                 ("C1_Sheriff_Sale", "Sheriff Or Tax Sale"), ("B8_Court_Order", "Court Order Or Foreclosure"),
                 ("B9_Partition", "Partition"), ("B7_Easement", "Easement Or Right-Of-Way")):
        if y(k):
            bits.append(w)
    if (parse_num(d.get("E4_Relationship_Discount")) or 0) > 0:
        bits.append("Related Parties")
    return ", ".join(bits)


def in_flags(d, parcels):
    """Plain words on what kind of sale the form says it was (the words field-scout-land.js reads):
    the assessor's P2_16 valid-for-trending call, B3 vacant land, A2 split on any parcel, B5 land
    contract (the box, or a contract date other than the file's 1900-01-01 blank), B2 buyer owns
    adjacent land, C4 auction, B8 court order."""
    y = lambda k: (d.get(k) or "").strip().upper() == "Y"
    n = lambda k: (d.get(k) or "").strip().upper() == "N"
    out = []
    if y("B8_Court_Order"):
        out.append("court ordered")
    if y("C4_Auction"):
        out.append("auction")
    if y("B2_Buyer_Adjacent"):
        out.append("adjacent owner")
    lcd = (d.get("B5_Land_Contract_Date") or "").strip()
    if y("B5_Land_Contract") or (parse_date(lcd) and not lcd.startswith("1900-")):
        out.append("installment contract")
    if any((p.get("A2_Split") or "").strip().upper() == "Y" for p in parcels):
        out.append("split parcel")
    if y("B3_Vacant_Land"):
        out.append("land only")
    elif n("B3_Vacant_Land"):
        out.append("with buildings")
    if y("P2_16_Valid_Trending"):
        out.append("valid for trending")
    elif n("P2_16_Valid_Trending"):
        out.append("not valid for trending")
    return out


def in_drop(d):
    """Forms that are not a sale of a whole property for money, left out of Indiana's files:
    no valuable consideration (B1), a trade (B4), a partial interest (B6), a transfer to a charity
    or government (B10), a short sale (C2)."""
    y = lambda k: (d.get(k) or "").strip().upper() == "Y"
    if not y("B1_Valuable_Consider"):
        return "no valuable consideration"
    for k, w in (("B4_Trade", "trade"), ("B6_Partial_Interest", "partial interest"), ("B10_Charity", "charity or government"), ("C2_Short_Sale", "short sale")):
        if y(k):
            return w
    return None


def in_table(files, rep=None):
    """files: [(name, zip blob)]. One table with our column names, farm forms only: a form is kept
    when any parcel on it carries an agricultural class (100 to 199). The price is the real estate's:
    Sales Price less the personal property in it. Acres are the whole form's when every parcel gives
    its own acres once (no parcel over a section); a form that is one of several for one sale, or any
    other doubt, leaves them blank and keeps the first parcel's figure as reported. rep counts what
    was left out and why."""
    rep = rep if rep is not None else {}
    head = ["DOCUMENTNUMBER", "DATEOFCONVEYANCE", "TOTALVALUE", "ACRES", "PROPERTYCLASS", "CONVEYANCETYPE", "PARCELNUMBER",
            "MUNICIPALITY", "COUNTY", "LEGALDESCRIPTION", "GRANTORNAME", "GRANTEENAME", "EXEMPTION", "TOTALPARCELS", "DATERECORDED",
            "ACRESLINE1", "ZIP", "FLAGS"]
    yield head
    seen = set()
    names = {v["fips"]: v["name"] for v in county_index("IN").values()}
    # A yearly file that fails a check is left out and named in rep; the other years still build.
    # Only when every file is refused is there nothing to build, and that raises.
    refused = []
    for name, blob in files:
        try:
            T = in_tables(blob)
            why = in_scale(T) or in_county_check(T, names)
        except (ValueError, zipfile.BadZipFile) as e:
            why = str(e)
        if why:
            refused.append("%s refused: %s" % (name, why))
            rep["file refused: %s (%s)" % (name, why)] = 1
            if len(refused) == len(files):
                raise ValueError("; ".join(refused))
            continue
        par, who = {}, {}
        for p in T["SALEPARCEL"]:
            par.setdefault(p["SDF_ID"], []).append(p)
        for c in T["SALECONTAC"]:
            if c.get("Contact_Type") in ("B", "S"):
                nm = clean(c.get("Name") or c.get("Company"), 80)
                if nm:
                    who.setdefault((c["SDF_ID"], c["Contact_Type"]), []).append(nm)
        for d in T["SALEDISC"]:
            sid = d["SDF_ID"]
            ps = par.get(sid) or []
            cls = []
            for p in ps:
                for c in in_class(p.get("P2_6_Prop_Class_Code"), (p.get("A4_Improvement") or "").upper() == "Y") or []:
                    if c and c not in cls:
                        cls.append(c)
            if not ({"4", "6"} & set(cls)):
                rep["not_farm"] = rep.get("not_farm", 0) + 1
                continue
            cls.sort(key=lambda c: (c not in ("4", "6"), c))
            dw = in_drop(d)
            if dw:
                rep["dropped " + dw] = rep.get("dropped " + dw, 0) + 1
                continue
            if sid in seen:              # a form can come back in a later year's file; one copy
                continue
            seen.add(sid)
            e1, e2 = parse_num(d.get("E1_Sales_Price")), parse_num(d.get("E2_PersProp")) or 0
            if not e1:     # Section G (commercial and industrial) carries its own price and personal property
                e1 = parse_num(d.get("G1_Sales_Price"))
                e2 = (parse_num(d.get("G12_PersProp")) or 0) + (parse_num(d.get("G13_IntangiblePersProp")) or 0)
            if not e1 or e1 <= 0:
                rep["dropped no price on the form"] = rep.get("dropped no price on the form", 0) + 1
                continue
            price = "%.2f" % ((e1 - min(e2, e1)) / 100.0)
            county = in_county(d, names)
            if not county:
                rep["dropped county number not read"] = rep.get("dropped county number not read", 0) + 1
                continue
            pins = [(p.get("A1_Parcel_Number") or "").strip() for p in ps]
            acs = [parse_num(p.get("P2_9_Acreage")) for p in ps]
            acs = [a / 10000.0 if a is not None else None for a in acs]
            n = max(len(ps), int(parse_num(d.get("C9_Num_Parcels")) or 0), 1)
            several = (d.get("C6_Multiple_Forms") or "").strip().upper() == "Y"
            sure = (not several and len(ps) == n and all(pins) and len(set(pins)) == len(pins)
                    and all(a and 0 < a <= 640 for a in acs)
                    and not (len(acs) > 1 and len(set(acs)) == 1 and acs[0] > 40))   # one tract's figure on every parcel
            ac = round(sum(acs), 4) if sure else None
            flags = in_flags(d, ps)
            if "split parcel" in flags:
                ac = None                # part of a parcel: the acreage may be the whole parcel's
            if several:
                n = max(n, 2)            # the price may cover parcels on another form: no $/acre
            first = ps[0] if ps else {}
            a1 = acs[0] if acs and acs[0] and 0 < acs[0] <= 20000 else None
            yield [sid, d.get("C7_Conveyance_Date") or d.get("P2_13_Date_Sale") or "", price, "" if ac is None else str(ac), " ".join(cls),
                   in_conv(d), pins[0] if pins else "", clean(first.get("A5_City"), 40).upper(), county,
                   clean(first.get("A7_Legal_Description"), LEGAL_MAX), "; ".join(who.get((sid, "S"), [])), "; ".join(who.get((sid, "B"), [])),
                   "", str(n), d.get("P2_14_Date_Received") or "", "" if a1 is None or n == 1 else str(round(a1, 4)),
                   (first.get("A5_ZipCode") or "")[:5], "; ".join(flags)]


def in_places(recs, zcta_blob):
    """{county fips: {muni_key(city): (City, lat, lng)}}: Indiana forms give the parcel's postal city
    and ZIP, not its township, so a town is placed at the Census centroid of its most common ZIP in
    that county, and only when that centroid is within 30 miles of the county's center (a mailing
    ZIP far away is not a location). Otherwise the town is listed with no place."""
    import math
    z = zipfile.ZipFile(io.BytesIO(zcta_blob))
    rd = csv.reader(io.StringIO(z.read(z.namelist()[0]).decode("latin-1")), delimiter="\t")
    hdr = [h.strip() for h in next(rd)]
    ix = {h: i for i, h in enumerate(hdr)}
    zc = {r[ix["GEOID"]].strip(): (float(r[ix["INTPTLAT"]]), float(r[ix["INTPTLONG"]])) for r in rd}
    cix = county_index("IN")
    tally = {}
    for r in recs:
        c = cix.get(key(re.sub(r"\s+COUNTY$", "", r["county"].upper())))
        if c and r.get("muni") and r.get("zip"):
            t = tally.setdefault(c["fips"], {}).setdefault(r["muni"], {})
            t[r["zip"]] = t.get(r["zip"], 0) + 1
    out = {}
    for fips, towns in tally.items():
        c = next(v for v in cix.values() if v["fips"] == fips)
        for town, zips in towns.items():
            zp = max(zips, key=zips.get)
            hit = zc.get(zp)
            if hit:
                mi = 3959 * 2 * math.asin(math.sqrt(math.sin(math.radians(hit[0] - c["lat"]) / 2) ** 2 + math.cos(math.radians(c["lat"]))
                                                    * math.cos(math.radians(hit[0])) * math.sin(math.radians(hit[1] - c["lng"]) / 2) ** 2))
                if mi > 30:
                    hit = None
            out.setdefault(fips, {})[muni_key(town)] = (town.title(), round(hit[0], 4) if hit else None, round(hit[1], 4) if hit else None)
    return out


def fetch_in():
    """The newest IN_YEARS yearly files listed on the STATS Indiana page: [(name, blob)]."""
    html = fetch(IN_PAGE).decode("utf-8", errors="replace")
    links = [u for u in file_links(IN_PAGE, html) if re.search(r"/SDF_\d{4}\.zip$", u, re.I)]
    links.sort(key=lambda u: re.search(r"(\d{4})\.zip$", u).group(1), reverse=True)
    out = []
    for u in links[:IN_YEARS]:
        out.append((os.path.basename(u), fetch(u, timeout=600)))
        time.sleep(2)
    return out


WI_COUNTY = dict(enumerate(["Adams", "Ashland", "Barron", "Bayfield", "Brown", "Buffalo", "Burnett", "Calumet", "Chippewa", "Clark",
                            "Columbia", "Crawford", "Dane", "Dodge", "Door", "Douglas", "Dunn", "Eau Claire", "Florence", "Fond du Lac",
                            "Forest", "Grant", "Green", "Green Lake", "Iowa", "Iron", "Jackson", "Jefferson", "Juneau", "Kenosha",
                            "Kewaunee", "La Crosse", "Lafayette", "Langlade", "Lincoln", "Manitowoc", "Marathon", "Marinette", "Marquette",
                            "Milwaukee", "Monroe", "Oconto", "Oneida", "Outagamie", "Ozaukee", "Pepin", "Pierce", "Polk", "Portage",
                            "Price", "Racine", "Richland", "Rock", "Rusk", "St. Croix", "Sauk", "Sawyer", "Shawano", "Sheboygan",
                            "Taylor", "Trempealeau", "Vernon", "Vilas", "Walworth", "Washburn", "Washington", "Waukesha", "Waupaca",
                            "Waushara", "Winnebago", "Wood", "Menominee"], 1))
# Property Use Type to the assessment class it names (Utility and Telephone have no farm meaning; left out)
WI_USE = {"AGRICULTURE": "4", "AGRFOREST": "5M", "PRODFOREST": "6", "UNDEVELOP": "5", "OTHER": "7", "SINGLE": "1", "MULTI": "1",
          "COMMERCIAL": "2", "MANUFACTUR": "3"}
WI_FARM_USE = ("AGRICULTURE", "AGRFOREST", "PRODFOREST")       # farm and forest: classes 4, 5M, 6
WI_DOC = {"WARRANTY": "Warranty Deed", "QUITDEED": "Quit Claim Deed", "LAND": "Land Contract", "TRUSTEEDEED": "Trustee's Deed",
          "PERSONALDEED": "Personal Representative's Deed", "DECEDENT": "Termination of Decedent's Interest", "CONDO": "Condominium Deed",
          "CORRECTION": "Correction Instrument", "SHERIFFFORE": "Sheriff's Deed (foreclosure)", "JUDGFORE": "Foreclosure Judgment",
          "SHERIFFPART": "Sheriff's Deed (partition)", "TRANSFER": "Transfer by Affidavit", "MINERAL": "Mineral Lease",
          "LANDAMEND": "Land Contract Amendment", "VENDEELAND": "Land Contract Assignment", "LEASE99MORE": "Lease of 99 Years or More",
          "ASSIGN99MORE": "Lease Assignment", "ASSIGN99LESS": "Lease Assignment", "WRPLA": "Improvements Document",
          "WWARRANTY": "State Highway Warranty Deed", "WTRUSTEEDEED": "State Highway Trustee's Deed", "WPERSONDEED": "State Highway Deed",
          "CORPDEED": "State Highway Deed", "AWARDDAMAGE": "State Highway Award of Damages", "QUITCORP": "State Highway Quit Claim Deed",
          "QUITGRANTOR": "State Highway Quit Claim Deed", "QUITPURCHASE": "State Highway Quit Claim Deed", "OTHER": "Other Deed"}
WI_CONV = {"SALE": "Sale", "SALEREPDEED": "Sale", "GIFT": "Gift", "PARENTGIFT": "Parent/Child Gift", "PARENTPART": "Parent/Child Part Gift",
           "TRUSTCONVEY": "To Trust", "TRUSTEEBENE": "Trustee to Beneficiary", "TRUSTEE3RD": "Trustee to Third Party", "WILL": "Will or Survivorship",
           "DECEDENT": "Decedent", "DIVORCE": "Divorce or Spouse", "MEMBERLLC": "To or From LLC", "PARTNER": "To or From Partnership",
           "SHARE": "To or From Corporation", "DEEDLAND": "Land Contract Satisfied", "EXCHANGE": "Exchange", "PARTITION": "Partition",
           "SHERIFFPART": "Partition", "SHERIFF": "Sheriff's Deed", "SHERIFF3RD": "Sheriff's Deed", "FORECLOS": "Foreclosure",
           "FORECLOSE3RD": "Foreclosure", "COUNTYFORE": "Foreclosure", "CORRECTION": "Correction", "MINERAL": "Mineral Lease",
           "MINERALAMEND": "Mineral Lease", "MINERALROYAL": "Mineral Lease", "LANDAMEND": "Land Contract Amendment", "NEWPARCEL": "Parcel Creation",
           "XFRAFFIDAVIT": "Transfer by Affidavit", "OTHER": ""}
WI_RELATED = ("FAMILY", "PARENTCHILD", "SPOUSES", "EXSPOUSES", "SHAREHOLDER", "EMPLOYER")
WI_HEAD = ["DOCUMENTNUMBER", "DATEOFCONVEYANCE", "TOTALVALUE", "ACRES", "PROPERTYCLASS", "CONVEYANCETYPE", "PARCELNUMBER",
           "MUNICIPALITY", "COUNTY", "LEGALDESCRIPTION", "GRANTORNAME", "GRANTEENAME", "EXEMPTION", "TOTALPARCELS", "DATERECORDED", "ACRESLINE1",
           "ACRESANYPARCEL"]


def wi_date(s):
    """DOR's MM-dd-yyyy to ISO; anything else None."""
    m = re.match(r"^(\d{2})-(\d{2})-(\d{4})$", str(s or "").strip())
    return parse_date("%s/%s/%s" % (m[1], m[2], m[3])) if m else None


def wi_name(el, tx):
    """One grantor or grantee as DOR's CSV shows it: LAST, FIRST for a person, the name for an entity."""
    last, first, whole = tx(el, "Name/LastName"), tx(el, "Name/FirstName"), tx(el, "Name/Name")
    if last and first:
        return "%s, %s" % (last, first)
    return clean(last or first or whole)


def wi_returns(fh):
    """Every return in a monthly eRETR XML report, streamed (a month is 60 to 100 MB)."""
    import xml.etree.ElementTree as ET

    def local(t):
        return t.rsplit("}", 1)[-1]

    def find(el, path):
        cur = el
        for part in path.split("/"):
            cur = next((c for c in cur if local(c.tag) == part), None)
            if cur is None:
                return None
        return cur

    def tx(el, path):
        e = find(el, path)
        return clean(e.text) if e is not None and e.text else ""

    def kids(el, path, name):
        e = find(el, path)
        return [c for c in e if local(c.tag) == name] if e is not None else []
    for ev, el in ET.iterparse(fh, events=("end",)):
        if local(el.tag) != "Return":
            continue
        yield {
            "cc": tx(el, "County/CountyCode"), "doc": tx(el, "County/DocumentNumber"), "rec": wi_date(tx(el, "County/RecordedDate")),
            "date": wi_date(tx(el, "Document/ConveyanceDate")), "doctype": tx(el, "Document/DocumentType"),
            "conv": tx(el, "Document/ConveyanceType"), "rel": tx(el, "Document/GrantorGranteeRelationship"),
            "parcels": [{"muni": tx(p, "Municipality"), "pin": tx(p, "ParcelNumber"), "use": tx(p, "PropertyUseType"),
                         "acres": parse_num(tx(p, "TotalAcres")), "part": tx(p, "PartOfParcelTransferred")} for p in kids(el, "Parcels", "Parcel")],
            "grantors": [wi_name(g, tx) for g in kids(el, "Grantors", "Grantor")],
            "grantees": [wi_name(g, tx) for g in kids(el, "Grantees", "Grantee")],
            "price": parse_num(tx(el, "Fee/SalePrice")), "exempt": tx(el, "Fee/Exemption"), "legal": tx(el, "LegalDescription")[:LEGAL_MAX + 20],
        }
        el.clear()


def wi_acres(parcels):
    """Acres for the whole return, and the first parcel's figure as reported, or None when unsure.

    Each parcel on a return carries its own Total Acres. Filers often put the whole sale's acres
    on the first parcel and 0.00 on the rest, so a zero can mean "counted above" or "not known";
    the same parcel can be listed twice; and a large figure can be repeated on every parcel.
    A single parcel over a section is a typing slip, not a farm (the Oct 2026 build had 12,910
    acres on "the East Half of the Northeast Quarter of Section 20", 80 acres at most). So:
      - one parcel: its acres (above 0, a section or less);
      - several: the sum, only when every parcel number appears once, every parcel has acres
        above 0, no parcel averages over a section (640 acres), and the parcels do not all
        repeat one figure above a forty (40.5 acres; a run of forties is common, a repeated
        quarter section is more likely the total typed on each line).
    Anything else is uncertain: None, never a guess (acres_rule 2, the Illinois rule)."""
    n = len(parcels)
    if not n:
        return None, None
    first = parcels[0]["acres"]
    if n == 1:
        return (round(first, 2) if first and 0 < first <= 640 else None), None
    ac1 = round(first, 2) if first and 0 < first < 20000 else None
    pins = [key(p["pin"]) for p in parcels]
    vals = [p["acres"] for p in parcels]
    if any(not k for k in pins) or len(set(pins)) != n:
        return None, ac1
    if any(v is None or v <= 0 for v in vals):
        return None, ac1
    tot = sum(vals)
    if tot / n > 640:
        return None, ac1
    if len(set(vals)) == 1 and vals[0] > 40.5:
        return None, ac1
    return round(tot, 2), ac1


def wi_muni_label(name):
    """'Leon, Town of' (DOR's CSV) to 'TOWN OF LEON', the form muni_key reads."""
    m = re.match(r"^(.*?),\s*(Town|Village|City)\s+of$", clean(name), re.I)
    return ("%s OF %s" % (m[2], m[1])).upper() if m else clean(name).upper()


def wi_learn_munis(csv_blob, index):
    """{(county code, muni code): name} from DOR's CSV report of a month whose XML was read.
    The XML gives each parcel's municipality as a code; the CSV gives the first parcel's by name.
    index: {(document number, first parcel number): (county code, muni code)} from that XML."""
    out = {}
    rows = read_table("x.csv", csv_blob)
    hdr = [key(h) for h in next(rows, [])]
    try:
        i_co, i_doc, i_pin, i_mu = (hdr.index(k) for k in ("COUNTY", "DOCUMENTNUMBER", "PARCELNUMBER", "MUNICIPALITY"))
    except ValueError:
        return out
    names = {key(v): "%02d" % k for k, v in WI_COUNTY.items()}
    for r in rows:
        if len(r) <= max(i_co, i_doc, i_pin, i_mu):
            continue
        hit = index.get((clean(r[i_doc]), clean(r[i_pin])))
        if hit and names.get(key(r[i_co])) == hit[0] and clean(r[i_mu]):
            out[hit] = wi_muni_label(r[i_mu])
    return out


def wi_row(ret, munis):
    """One farm or forest return as a row under WI_HEAD, or None for any other return."""
    ps = ret["parcels"]
    if not ps or not any(p["use"] in WI_FARM_USE for p in ps):
        return None
    try:
        county = WI_COUNTY[int(ret["cc"])]
    except (ValueError, KeyError):
        county = ""
    codes = []
    for u in sorted({p["use"] for p in ps}, key=lambda u: (u not in WI_FARM_USE, WI_FARM_USE.index(u) if u in WI_FARM_USE else 0, u)):
        c = WI_USE.get(u)
        if c and c not in codes:
            codes.append(c)
    ac, ac1 = wi_acres(ps)
    conv = WI_DOC.get(ret["doctype"], ret["doctype"].title())
    if ret["rel"] in WI_RELATED:
        conv += ", related parties"
    what = WI_CONV.get(ret["conv"], ret["conv"].title())
    if what and what.upper() not in conv.upper():
        conv += ", " + what

    def names(xs):
        xs = [x for x in xs if x]
        return "; ".join(dict.fromkeys(xs))
    f = lambda v: "" if v is None else ("%g" % v if isinstance(v, float) else str(v))
    return [ret["doc"], ret["date"] or "", f(ret["price"]), f(ac), " ".join(codes), conv, ps[0]["pin"],
            munis.get((ret["cc"], ps[0]["muni"]), ""), county, ret["legal"], names(ret["grantors"]), names(ret["grantees"]),
            ret["exempt"], str(len(ps)), ret["rec"] or "", f(ac1) if len(ps) > 1 else "",
            f(round(sum(p["acres"] for p in ps if p["acres"] and p["acres"] > 0), 2))]


def held(st, out=None):
    """What a state's files on disk hold: (records, {fips: coverage}, months).
    Records come back in parse_rows' shape so they can be merged and built again; the town is
    the label the file shows (muni_key reads it the same way). Months are index.json's list, or,
    for files written before it was kept, every month between the first and last filed dates
    (the Oct 17, 2026 build read all 69 offered months, Jan 2021 to Sep 2026, none missed)."""
    d = os.path.join(out or OUT, st.lower())
    try:
        ix = json.load(open(os.path.join(d, "index.json")))
    except (OSError, ValueError):
        return [], {}, set()
    recs, covs, lo, hi = [], {}, None, None
    for c in ix.get("counties", []):
        f = json.load(open(os.path.join(d, c["fips"] + ".json")))
        covs[c["fips"]] = f.get("coverage") or {}
        cv = covs[c["fips"]]
        if cv.get("filed_from"):
            lo = min(lo or cv["filed_from"], cv["filed_from"])
            hi = max(hi or cv["filed_to"], cv["filed_to"])
        munis = f.get("munis") or {}
        for row in f["rows"]:
            o = dict(zip(f["cols"], row))
            m = munis.get(str(o.get("muni")))
            recs.append({"doc": o.get("doc") or "", "date": o["date"], "price": o.get("price"), "acres": o.get("acres"), "tac": o.get("tac"),
                         "np": o.get("np"), "cls": o.get("cls") or "", "conv": o.get("conv") or "", "pid": o.get("pid") or "",
                         "muni": m[0] if m else "", "county": f["county"], "legal": o.get("legal") or "",
                         "grantor": o.get("grantor"), "grantee": o.get("grantee"), "exempt": o.get("exempt") or 0,
                         "ac1": o.get("ac1"), "rec": o.get("rec"), "acany": None})
    months = set(ix.get("months") or [])
    if not months and lo:
        y, m = int(lo[:4]), int(lo[5:7])
        while "%04d%02d" % (y, m) <= hi[:4] + hi[5:7]:
            months.add("%04d%02d" % (y, m))
            y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return recs, covs, months


def wi_merge(old, new, read_now):
    """Newest-only merge: the rows on disk plus the rows read now. A month read again (the newest
    one on disk, which DOR keeps adding to) is replaced whole: rows on disk filed in a month read
    now are dropped first, so a return DOR took out of that month does not linger. Rows with no
    filed date on disk cannot be placed in a month and are kept; wi_dedupe then keeps one copy of
    each return (the latest filing). Returns (rows, how many rows on disk were replaced)."""
    def ym(r):
        d = r.get("rec") or ""
        return d[:4] + d[5:7] if len(d) >= 7 else ""
    keep = [r for r in old if not (ym(r) and ym(r) in read_now)]
    return wi_dedupe(keep + list(new)), len(old) - len(keep)


def wi_dedupe(recs):
    """A return can come back in a later month's file (an amended filing): keep the latest filing
    of each county and document number, so a sale is one row and its acres are counted once."""
    best = {}
    for r in recs:
        k = (key(r["county"]), r["doc"]) if r["doc"] else (id(r),)
        if k not in best or (r.get("rec") or "") >= (best[k].get("rec") or ""):
            best[k] = r
    return list(best.values())


def trim(recs, done):
    """The next cut when a state's files are over the cap: first farm sales of 10 acres or more
    (any parcel's acres; a return with no acres at all is dropped), then the oldest filing year,
    one year at a time. None when nothing is left to cut."""
    if "10+ acres" not in done:
        return [r for r in recs if max(r.get("acres") or 0, r.get("ac1") or 0, r.get("acany") or 0) >= 10], "10+ acres"
    yrs = sorted({(r.get("rec") or r["date"])[:4] for r in recs})
    if len(yrs) <= 1:
        return None, None
    return [r for r in recs if (r.get("rec") or r["date"])[:4] != yrs[0]], "dropped filing year %s" % yrs[0]


def summary(st, recs, trims):
    """Rows per filing year, counties, rows with names: what the run report needs."""
    by = {}
    for r in recs:
        y = (r.get("rec") or "")[:4] or ("filed date not kept" if st == "WI" else r["date"][:4])
        by[y] = by.get(y, 0) + 1
    named = sum(1 for r in recs if r.get("grantor") or r.get("grantee"))
    known = sum(1 for r in recs if r.get("acres"))
    multi = sum(1 for r in recs if (r.get("np") or 1) > 1)
    return "%s rows by filing year: %s; %d rows with names; %d multi-parcel; %d with acres; trims: %s" % (
        st, ", ".join("%s %d" % kv for kv in sorted(by.items())), named, multi, known, "; ".join(trims) or "none")


def run(states, from_dir=None, merge=False):
    """merge (Wisconsin newest-only): add the rows read now to the ones on disk; a return read
    again replaces its older copy (wi_dedupe), nothing else on disk is dropped unless the cap trims it."""
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    gzblob = fetch(GAZ)
    bad = 0
    for st in states:
        tables = []
        if STATES[st].get("request_only"):
            print("::notice::%s transfers not built: %s" % (st, STATES[st]["request_only"]))
            continue
        if STATES[st].get("probe_only"):
            print("::notice::%s transfers not built yet: %s" % (st, STATES[st]["probe_only"]))
            continue
        if st == "IN":
            try:
                files = ([(n, open(os.path.join(from_dir, n), "rb").read()) for n in sorted(os.listdir(from_dir)) if re.match(r"^SDF_\d{4}\.zip$", n, re.I)]
                         if from_dir else fetch_in())
                irep = {}
                tables.append(list(in_table(files, irep)))
                print("%s: %d yearly files (%s); left out: %s" % (st, len(files), ", ".join(n for n, _ in files),
                                                                  ", ".join("%s %d" % kv for kv in sorted(irep.items())) or "none"))
            except Exception as e:  # noqa: BLE001
                print("::warning::%s sales disclosure files not read: %s" % (st, e))
                bad += 1
                continue
        elif STATES[st].get("socrata") and not from_dir:
            try:
                decls, extra, multi = fetch_il()
            except Exception as e:  # noqa: BLE001
                print("::warning::%s open data did not answer: %s" % (st, e))
                bad += 1
                continue
            print("%s: %d farm declarations, %d with more than one parcel, %d added PINs read" % (st, len(decls), multi, sum(len(v) for v in extra.values())))
            lrep = {}
            tables.append(list(il_table(decls, extra, lrep)))
            print("%s: left out: %s" % (st, ", ".join("%s %d" % kv for kv in sorted(lrep.items())) or "none"))
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
        prior, months = None, None
        if st == "WI" and from_dir:
            try:
                months = {m["month"] for m in json.load(open(os.path.join(from_dir, "wi-retr-report.json")))["months"]}
            except (OSError, ValueError, KeyError):
                months = None
        if st == "WI" and merge:
            old, prior, had = held(st)
            read_now = set(months or ())
            recs, dropped = wi_merge(old, recs, read_now)
            print("%s: %d rows on disk from %d months; %d rows read now from %s; %d rows on disk from those months replaced"
                  % (st, len(old), len(had), len(recs) - len(old) + dropped, ", ".join(sorted(read_now)) or "no month", dropped))
            months = read_now | had
        if st == "WI":
            recs = wi_dedupe(recs)
        gaz = in_places(recs, fetch(IN_ZCTA, timeout=300)) if st == "IN" else gazetteer(STATES[st]["fips"], gzblob)
        trims = []
        while True:
            try:
                res = build(st, recs, gaz, now, prior, months)
                break
            except OverCap as e:
                cut, why = trim(recs, trims) if st in ("WI", "IN") else (None, None)
                if cut is None:
                    raise SystemExit(str(e))
                print("::warning::%s; trimmed: %s (%d rows left of %d)" % (e, why, len(cut), len(recs)))
                trims.append(why)
                recs = cut
        res["trims"] = trims
        print("::notice::%s" % summary(st, recs, trims))
        print("::notice::%s transfers: %d rows in %d counties (%.2f MB); names %s; %d rows with no county match; files %d, rows read %d, not farm %d"
              % (st, res["rows"], res["counties"], res["mb"], "in the data" if res["names"] else "not in the data", res["unplaced"], rep["files"], rep["rows"], rep["not_farm"]))
    return 1 if bad and bad == len([s for s in states if not STATES[s].get("request_only") and not STATES[s].get("probe_only")]) else 0


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
    ck("WI layout: conveyance codes read as deed types, Property Type kept as words",
       [r["conv"] for r in w] == ["Warranty Deed; land only", "Land Contract; land only", "Quit Claim Deed; with buildings; less than full interest; split parcel"])
    ck("WI layout: a split parcel (column BJ) leaves acres blank", w[2]["acres"] is None and w[0]["acres"] == 160)
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
    # Illinois, every field the real answer gives (raw branch data/land-raw/sales/il/doc5.json), names synthetic
    ild = json.load(open(os.path.join(ROOT, "test", "fixtures", "land-sales", "il-mydec-sample.json")))
    irp = {}
    il3, _ = parse_rows([il_table(ild, {}, irp)])
    ib3 = {r["doc"]: r for r in il3}
    ck("IL acres: one parcel over a section is uncertain (Kankakee 10,124 ac, Lake lot 3,008 ac, Boone 2,044 ac)",
       all(ib3[d]["acres"] is None for d in ("S-000001", "S-000002", "S-000003")) and ib3["S-000002"]["legal"] == "LOT 1 IN WADSWORTH MANOR"
       and ib3["S-000001"]["price"] == 190000 and ib3["S-000001"]["date"] == "2024-11-14")
    ck("IL acres: Line 1 unit read, square feet converted, dimensions not guessed",
       ib3["S-000004"]["acres"] == 40 and ib3["S-000005"]["acres"] is None and il_unit_acres("80", "") == 80)
    ck("IL Line 10: court-ordered, in lieu of foreclosure, condemnation, bank REO, trade and sale-leaseback are left out and counted",
       not any(("S-%06d" % i) in ib3 for i in range(10, 16)) and len(irp) == 6 and all(v == 1 for v in irp.values())
       and "dropped court-ordered sale (10d)" in irp and "dropped sale-leaseback (10q)" in irp)
    ck("IL Line 10: less than full interest, auction, adjacent owner, installment contract and Line 7 said in words",
       ib3["S-000020"]["conv"] == "Warranty Deed; less than full interest; auction; adjacent owner; installment contract; advertised")
    ck("IL Line 7: not advertised said, a missing answer says nothing",
       ib3["S-000023"]["conv"].endswith("; not advertised; with buildings") and ib3["S-000024"]["conv"] == "Warranty Deed")
    ck("IL split parcel (Line 1 box or a PT before the PIN): said, acres blank",
       ib3["S-000021"]["acres"] is None and "split parcel" in ib3["S-000021"]["conv"]
       and ib3["S-000022"]["acres"] is None and "split parcel" in ib3["S-000022"]["conv"]
       and il_flags({"line_1_primary_pin": "1"}, [{"split_parcel": "1"}]) == ["split parcel"])
    ck("IL buildings: a principal residence says with buildings; a plain farm row says nothing either way",
       "with buildings" in ib3["S-000023"]["conv"] and "land only" not in " ".join(r["conv"] for r in il3)
       and "with buildings" not in ib3["S-000004"]["conv"])
    ck("MN is not built from a guess", bool(STATES["MN"].get("request_only")))
    ck("probe-only states (IA, SD, OH) are never built before their parser exists",
       all(STATES[x].get("probe_only") and STATES[x].get("pages") for x in ("IA", "SD", "OH")))
    ck("phase 1 statewide sources (FL, NY, MD, VT, NJ, CT) are saved by the probe and never built",
       all(STATES[x].get("probe_only") and (STATES[x]["pages"] or PROBE_ONLY_DOCS.get(x)) for x in ("FL", "NY", "MD", "VT", "NJ", "CT")))
    # Indiana sales disclosure forms: a synthetic file in the real SDF_<year>.zip shape
    # (test/fixtures/land-sales/make_in_sdf_sample.py writes it with the real column titles)
    sys.path.insert(0, os.path.join(ROOT, "test", "fixtures", "land-sales"))
    import make_in_sdf_sample as MK
    inz = open(os.path.join(ROOT, "test", "fixtures", "land-sales", "in-sdf-sample.zip"), "rb").read()
    ck("IN: the saved fixture is what its maker writes", len(list(in_table([("a.zip", inz)]))) == len(list(in_table([("b.zip", MK.make())]))))
    irep = {}
    ins, inr = parse_rows([iter(list(in_table([("SDF_2026.zip", inz)], irep)))])
    ib = {r["doc"][-2:]: r for r in ins}
    ck("IN: built, not probe-only", not STATES["IN"].get("probe_only") and STATES["IN"]["max_mb"] <= 8)
    ck("IN: farm forms only (any parcel class 100 to 199); a house lot is left out", irep.get("not_farm") == 1 and "03" not in ib)
    ck("IN: no valuable consideration and a partial interest are left out, and counted",
       irep.get("dropped no valuable consideration") == 1 and irep.get("dropped partial interest") == 1 and "04" not in ib and "10" not in ib)
    ck("IN: money read with two implied decimals, personal property taken out", ib["01"]["price"] == 400000 and ib["02"]["price"] == 490000)
    ck("IN: acres read with four implied decimals and summed over the form's parcels", ib["01"]["acres"] == 40 and ib["02"]["acres"] == 40 and ib["02"]["np"] == 2)
    ck("IN: one of several forms for a sale: acres blank, first parcel's acres kept as reported", ib["06"]["acres"] is None and ib["06"]["np"] == 2 and ib["06"]["ac1"] == 80)
    ck("IN: one tract's acres on every parcel is uncertain", ib["07"]["acres"] is None and ib["07"]["ac1"] == 80)
    ck("IN: county from its state number, not the typed name (Carrol, ADAMS COUNTY)", ib["05"]["county"] == "Carroll" and ib["02"]["county"] == "Adams"
       and ib["07"]["county"] == "Whitley")
    ck("IN: classes as the land card reads them (farm 4, timber 6, improved farm 7, commercial 2)",
       ib["01"]["cls"] == "4" and ib["02"]["cls"] == "4 7" and ib["08"]["cls"] == "6" and ib["09"]["cls"] == "4 2")
    ck("IN: quitclaim and a family discount read as non-market words", ib["05"]["conv"].startswith("Quitclaim Deed, Related Parties; ")
       and ib["02"]["conv"].startswith("Sale, Land Contract; ") and ib["08"]["conv"].startswith("Sale, Auction, Buyer Owns Adjacent Land; "))
    ck("IN: the deed type is not cut at 60 characters", len(ib["08"]["conv"]) > 60 and ib["08"]["conv"].endswith("; valid for trending"))
    ck("IN: P2_16 valid for trending read both ways", ib["01"]["conv"].endswith("; valid for trending") and ib["05"]["conv"].endswith("; not valid for trending"))
    ck("IN: B3 vacant land read as land only or with buildings", "; land only;" in ib["01"]["conv"] and "; with buildings;" in ib["05"]["conv"])
    ck("IN: A2 split on a parcel: said, acres blank", ib["11"]["acres"] is None and "; split parcel;" in ib["11"]["conv"] and "split parcel" not in ib["12"]["conv"])
    ck("IN: B5 land contract, the box or a contract date, says installment contract; the 1900-01-01 blank does not",
       "installment contract" in ib["02"]["conv"] and "installment contract" in ib["12"]["conv"] and "installment contract" not in ib["01"]["conv"])
    ck("IN: B2 adjacent and C4 auction in the plain words too", "; auction; adjacent owner;" in ib["08"]["conv"])
    ck("IN: a commercial-section price is read when the residential one is blank", ib["09"]["price"] == 300000)
    ck("IN: buyer and seller names only, never the preparer", ib["01"]["grantor"] == "SYNTHETIC SELLER" and ib["01"]["grantee"] == "SYNTHETIC BUYER")
    ck("IN: conveyance and received dates", ib["01"]["date"] == "2026-03-01" and ib["01"]["rec"] == "2026-04-01")
    for args, what in (((1, 10000), "fee in dollars"), ((100, 1), "acres in whole acres")):
        try:
            list(in_table([("bad.zip", MK.make(*args))]))
            ck("IN: a file whose %s is refused" % what, False)
        except ValueError:
            ck("IN: a file whose %s is refused" % what, True)
    mrep = {}
    mixed = list(in_table([("SDF_2021.zip", MK.make(1, 10000)), ("SDF_2026.zip", MK.make())], mrep))
    ck("IN: a refused year is left out and named; the good year still builds",
       len(mixed) == len(list(in_table([("b.zip", MK.make())]))) and any(k.startswith("file refused: SDF_2021.zip") for k in mrep))
    zb = io.BytesIO()
    with zipfile.ZipFile(zb, "w") as zz:
        zz.writestr("z.txt", "GEOID\tALAND\tINTPTLAT\tINTPTLONG\n46711\t1\t41.10\t-85.45\n46999\t1\t39.00\t-87.00\n")
    pl = in_places([{"county": "Whitley", "muni": "SAMPLETOWN", "zip": "46711"}, {"county": "Adams", "muni": "FARAWAY", "zip": "46999"}], zb.getvalue())
    ck("IN: a town is placed at its ZIP's centroid only when it is near the county",
       pl["18183"][muni_key("SAMPLETOWN")] == ("Sampletown", 41.1, -85.45) and pl["18001"][muni_key("FARAWAY")][1] is None)
    ck("a county PDF sales list is a file link only where the state asks for PDFs",
       file_links("https://x.org/a/", '<a href="s2025.pdf">x</a><a href="s.csv">y</a>') == ["https://x.org/a/s.csv"]
       and file_links("https://x.org/a/", '<a href="s2025.pdf">x</a>', STATES["SD"]["files_rx"]) == ["https://x.org/a/s2025.pdf"])
    # Wisconsin eRETR monthly XML (DOR's Real Estate Historical Data report), a synthetic file in its shape
    fx3 = os.path.join(ROOT, "test", "fixtures", "land-sales", "wi-retr-sample.xml")
    rets = list(wi_returns(open(fx3, "rb")))
    ck("WI XML: every return read, every parcel kept", len(rets) == 10 and [len(r["parcels"]) for r in rets[:3]] == [1, 3, 3])
    ck("WI XML: names as DOR's CSV shows them, every grantor kept", rets[1]["grantors"] == ["SYNTHETIC, SELLER B", "SYNTHETIC, SELLER C"]
       and rets[1]["grantees"] == ["SYNTHETIC FARMS LLC"])
    ck("WI XML: MM-dd-yyyy dates to ISO, other shapes not guessed", rets[0]["date"] == "2024-03-15" and rets[0]["rec"] == "2024-03-18"
       and wi_date("2024-03-21") is None and wi_date("13-01-2024") is None)
    idx = {(r["doc"], r["parcels"][0]["pin"]): (r["cc"], r["parcels"][0]["muni"]) for r in rets}
    mu = wi_learn_munis(("County,Document Number,Municipality,Parcel Number\nBarron,900001,\"Chetek, Town of\",\t022-1234-56-000\n"
                         "St. Croix,900008,\"Hudson, City of\",\t032-1000-01-000\nPolk,900002,\"Wrong, Town of\",\t022-1234-57-000\n").encode(), idx)
    ck("WI munis: named from the CSV by document and first parcel, county must agree", mu == {("03", "010"): "TOWN OF CHETEK", ("55", "032"): "CITY OF HUDSON"})
    rows = [wi_row(r, mu) for r in rets]
    ck("WI XML: farm and forest returns only (any parcel class 4, 5M or 6)", rows[6] is None and all(rows[i] for i in (0, 1, 2, 7, 9)))
    wr, wrep = parse_rows([iter([WI_HEAD] + [x for x in rows if x])])
    by = {r["doc"]: r for r in wr}
    ck("WI XML: rows read through the shared parser", len(wr) == 8 and wrep["bad_date"] == 1 and wrep["not_farm"] == 0)
    ck("WI acres: one parcel", by["900001"]["acres"] == 40 and by["900001"]["np"] == 1 and by["900001"]["ac1"] is None)
    ck("WI acres: several parcels each read once, in acres, are summed", by["900002"]["acres"] == 80 and by["900002"]["np"] == 3)
    ck("WI acres: whole sale on the first parcel and zeros after is uncertain, first figure kept as reported",
       by["900003"]["acres"] is None and by["900003"]["ac1"] == 160 and by["900003"]["np"] == 3)
    ck("WI acres: the same parcel twice is uncertain", by["900004"]["acres"] is None)
    ck("WI acres: one figure above a forty repeated on every parcel is uncertain, a run of forties is summed",
       by["900005"]["acres"] is None and by["900006"]["acres"] == 80)
    ck("WI acres: one parcel over a section is a slip, not believed (12,910 on an 80-acre legal)",
       wi_acres([{"pin": "a", "acres": 12910.0}]) == (None, None) and wi_acres([{"pin": "a", "acres": 640.0}])[0] == 640)
    ck("WI acres: over a section per parcel, or a blank parcel number, is uncertain",
       wi_acres([{"pin": "a", "acres": 1000.0}, {"pin": "b", "acres": 500.0}])[0] is None and wi_acres([{"pin": "", "acres": 10.0}, {"pin": "b", "acres": 5.0}])[0] is None)
    ck("WI class: farm codes first, buildings classes kept", by["900002"]["cls"] == "4 1" and by["900008"]["cls"] == "6" and by["900010"]["cls"] == "5M 1")
    ck("WI names and county: St Croix code 55, entity names whole", by["900008"]["county"] == "St. Croix" and by["900008"]["grantor"] == "SYNTHETIC LAND LLC"
       and by["900002"]["grantor"] == "SYNTHETIC, SELLER B; SYNTHETIC, SELLER C")
    ck("WI deed type: related parties and gift said, fee exemption flagged", by["900008"]["conv"] == "Quit Claim Deed, Related Parties, Parent/Child Gift"
       and by["900008"]["exempt"] == 1 and by["900001"]["exempt"] == 0 and by["900001"]["conv"] == "Warranty Deed, Sale")
    ck("WI town: from the learned name, the form muni_key reads", by["900001"]["muni"] == "TOWN OF CHETEK" and muni_key(by["900001"]["muni"]) == ("T", "CHETEK"))
    ck("WI town: an unknown code is left blank, not guessed", wi_row(dict(rets[0], cc="04"), mu)[7] == "")
    later = dict(by["900001"], rec="2024-05-02", price=1)
    dd = wi_dedupe(list(wr) + [later])
    ck("WI: a return filed again keeps the latest filing only", len(dd) == len(wr) and [r for r in dd if r["doc"] == "900001"][0]["price"] == 1)
    t1, w1 = trim(wr, [])
    ck("WI trim: 10+ acres first, any parcel's acres counted", w1 == "10+ acres" and {r["doc"] for r in t1} == set(by) - {"900010"})
    t2, w2 = trim([dict(r, rec="2021-01-05") for r in t1[:2]] + t1[2:], [w1])
    ck("WI trim: then the oldest filing year", w2 == "dropped filing year 2021" and len(t2) == len(t1) - 2 and trim(t2, [w1, w2])[0] is None)
    # Newest-only merge: files on disk, then one month read again (a return filed again, a late
    # return) and one new month; nothing on disk is lost, nothing is doubled.
    import tempfile
    global OUT
    keep_out = OUT
    OUT = tempfile.mkdtemp(prefix="wi-merge-")
    try:
        first = [dict(r) for r in wr if r["doc"] != "900006"]
        for r in first:
            r["rec"] = None if r["doc"] == "900001" else r["rec"]       # a file written before rows kept their filed date
        build("WI", first, {}, "2026-10-17T00:00:00Z", None, {"202403", "202404"})
        old, covs, had = held("WI")
        ck("merge: the files on disk read back whole", len(old) == len(first) and had == {"202403", "202404"}
           and {r["doc"] for r in old} == {r["doc"] for r in first})
        b1 = [r for r in old if r["doc"] == "900002"][0]
        ck("merge: a row read back keeps its acres, parcels, names and town", b1["acres"] == 80 and b1["np"] == 3
           and b1["grantor"] == "SYNTHETIC, SELLER B; SYNTHETIC, SELLER C" and muni_key(b1["muni"]) == ("T", "CHETEK"))
        again = dict(by["900002"], rec="2024-05-03", price=730000)      # the same return, read again in a later month
        late = dict(by["900006"], rec="2024-05-10")                     # a return the first build did not have
        gone = [r for r in old if r["doc"] == "900003"][0]
        gone_rec = gone["rec"]
        merged, n_drop = wi_merge(old, [again, late], {gone_rec[:4] + gone_rec[5:7], "202405"})
        ck("merge: the month read again is replaced whole (a return gone from it is gone)",
           "900003" not in {r["doc"] for r in merged} and n_drop == sum(1 for r in old if (r["rec"] or "")[:7] == gone_rec[:7]))
        merged, _ = wi_merge(old, [again, late], {"202405"})
        build("WI", merged, {}, "2026-11-03T00:00:00Z", covs, had | {"202405"})
        back, covs2, had2 = held("WI")
        docs = [r["doc"] for r in back]
        ck("merge: no row lost, none doubled", sorted(docs) == sorted({r["doc"] for r in first} | {"900006"}) and len(docs) == len(set(docs)))
        ck("merge: the later filing of a return replaces the older one", [r["price"] for r in back if r["doc"] == "900002"] == [730000])
        ck("merge: a row with no filed date on disk is kept as it was", [r["acres"] for r in back if r["doc"] == "900001"] == [40])
        ck("merge: months and the filed span grow, never shrink", had2 == {"202403", "202404", "202405"}
           and min(c["filed_from"] for c in covs2.values()) <= "2024-03-18" and max(c["filed_to"] for c in covs2.values()) == "2024-05-10")
        ix = json.load(open(os.path.join(OUT, "wi", "index.json")))
        f = json.load(open(os.path.join(OUT, "wi", ix["counties"][0]["fips"] + ".json")))
        ck("merge: acres_rule 2 kept and filed dates written", f["acres_rule"] == 2 and "rec" in f["cols"] and ix["months"] == ["202403", "202404", "202405"])
        del ix["months"]
        json.dump(ix, open(os.path.join(OUT, "wi", "index.json"), "w"))
        ck("merge: files written before the month list hold every month of their filed span", held("WI")[2] == {"202403", "202404", "202405"})
        none_dir = tempfile.mkdtemp(prefix="wi-none-")
        _, _, derived = held("WI", none_dir)
        os.rmdir(none_dir)
        ck("merge: no files on disk means nothing held", derived == set())
    finally:
        import shutil
        shutil.rmtree(OUT, ignore_errors=True)
        OUT = keep_out
    global MAX_STATE_MB
    keep = MAX_STATE_MB
    MAX_STATE_MB = 0
    wd = os.path.join(OUT, "wi")

    def snap():
        return sorted((n, os.path.getmtime(os.path.join(wd, n))) for n in os.listdir(wd)) if os.path.isdir(wd) else None
    before = snap()
    try:
        build("WI", wr, {}, "2026-01-01T00:00:00Z")
        ck("over the cap: refused", False)
    except OverCap:
        ck("over the cap: refused before any file is written", snap() == before)
    finally:
        MAX_STATE_MB = keep
    print("FAILS=%d" % bad)
    return 1 if bad else 0


if __name__ == "__main__":
    a = sys.argv[1:]
    if "--selftest" in a:
        sys.exit(selftest())
    if "--probe" in a:
        sys.exit(probe([x for x in a if x in STATES or x in PROBE_DOCS or x in PROBE_ONLY_DOCS] or sorted(set(STATES) | set(PROBE_DOCS) | set(PROBE_ONLY_DOCS))))
    sts = [x for x in a if x in STATES] or ["WI", "MN", "IL"]
    fd = a[a.index("--from") + 1] if "--from" in a else None
    sys.exit(run(sts, fd, "--merge" in a))
