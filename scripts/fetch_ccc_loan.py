#!/usr/bin/env python3
"""
AGSIST -- data/ccc-loan.json and data/ccc-loan/<ST>.json for /commodity-loan.

What it reads (USDA Farm Service Agency, public pages):
  * The CCC commodity loan interest rate, set monthly. FSA posts it in a
    monthly news release ("USDA Announces <Month> <Year> Lending Rates for
    Agricultural Producers") and on its current loan rates page.
      https://www.fsa.usda.gov/tools/informational/rates/current-fsa-loan-interest-rates
      https://www.fsa.usda.gov/news-events/news/MM-DD-YYYY/usda-announces-<month>-<year>-lending-rates-agricultural-producers
    Read: the "Commodity Loan" percentage and the month it is for.
  * County loan rates for corn and soybeans. The Apr 8, 2026 release says
    county rates are on fsa.usda.gov; the commodity loan rates page links the
    files. Read: the links on that page whose name says county; .xlsx and .csv
    tables are parsed (header row with a County column and corn or soybean
    rate columns). Other formats are saved by --probe and refused here.
      https://www.fsa.usda.gov/programs-and-services/price-support/commodity-loan-rates

National 2026 rates (corn $2.42, soybeans $6.82, Apr 8, 2026 release) are in
components/commodity-loan.js, not here; they are the yardstick each county
rate is checked against.

Modes:
  (default)   fetch, validate, write. Each block keeps its last good value on
              any failure and records why in `status`.
  --probe     fetch every page and linked county file, save them raw to
              data/ccc-loan-raw/ with a listing, print what parsed. Writes no feed.
  --selftest  offline tests, non-zero exit on any failure.

WHAT THIS FILE WILL NOT DO
  * Write an interest rate outside 0.5 to 15%, or one with no month.
  * Replace a newer month with an older one.
  * Write county rates unless at least 300 counties parse for a crop and every
    rate written is within 30% of that crop's national rate. A table that
    fails is refused whole, never written in part.

LAYOUT: not yet seen. The sandbox that wrote this cannot reach fsa.usda.gov.
The fixtures in selftest are built from how FSA releases are worded in search
results, not copied from a fetched page. Dispatch once with probe, check
data/ccc-loan-raw/ against the parsers, then run for real.

Stdlib only, plus pdftotext or pypdf through fetch_dairy for any PDF text.
"""
import csv
import datetime
import html as htmlmod
import io
import json
import re
import sys
import zipfile
from pathlib import Path
from urllib.parse import urljoin

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch_dairy as FD  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = "data/ccc-loan.json"
STATE_DIR = "data/ccc-loan"
RAW_DIR = "data/ccc-loan-raw"
RATES_PAGE = "https://www.fsa.usda.gov/tools/informational/rates/current-fsa-loan-interest-rates"
LOAN_PAGES = ["https://www.fsa.usda.gov/programs-and-services/price-support/commodity-loan-rates",
              "https://www.fsa.usda.gov/resources/programs/price-support/commodity-loan-rates"]
CROP_YEAR = 2026
NATIONAL = {"corn": 2.42, "soybeans": 6.82}
RATE_RANGE = (0.5, 15.0)
COUNTY_BAND = 0.30
MIN_COUNTIES = 300
MONTHS = ["january", "february", "march", "april", "may", "june", "july",
          "august", "september", "october", "november", "december"]

STATES = {
    "AL": ("01", "Alabama"), "AK": ("02", "Alaska"), "AZ": ("04", "Arizona"), "AR": ("05", "Arkansas"),
    "CA": ("06", "California"), "CO": ("08", "Colorado"), "CT": ("09", "Connecticut"), "DE": ("10", "Delaware"),
    "FL": ("12", "Florida"), "GA": ("13", "Georgia"), "HI": ("15", "Hawaii"), "ID": ("16", "Idaho"),
    "IL": ("17", "Illinois"), "IN": ("18", "Indiana"), "IA": ("19", "Iowa"), "KS": ("20", "Kansas"),
    "KY": ("21", "Kentucky"), "LA": ("22", "Louisiana"), "ME": ("23", "Maine"), "MD": ("24", "Maryland"),
    "MA": ("25", "Massachusetts"), "MI": ("26", "Michigan"), "MN": ("27", "Minnesota"), "MS": ("28", "Mississippi"),
    "MO": ("29", "Missouri"), "MT": ("30", "Montana"), "NE": ("31", "Nebraska"), "NV": ("32", "Nevada"),
    "NH": ("33", "New Hampshire"), "NJ": ("34", "New Jersey"), "NM": ("35", "New Mexico"), "NY": ("36", "New York"),
    "NC": ("37", "North Carolina"), "ND": ("38", "North Dakota"), "OH": ("39", "Ohio"), "OK": ("40", "Oklahoma"),
    "OR": ("41", "Oregon"), "PA": ("42", "Pennsylvania"), "RI": ("44", "Rhode Island"), "SC": ("45", "South Carolina"),
    "SD": ("46", "South Dakota"), "TN": ("47", "Tennessee"), "TX": ("48", "Texas"), "UT": ("49", "Utah"),
    "VT": ("50", "Vermont"), "VA": ("51", "Virginia"), "WA": ("53", "Washington"), "WV": ("54", "West Virginia"),
    "WI": ("55", "Wisconsin"), "WY": ("56", "Wyoming"),
}
BY_NAME = {v[1].lower(): k for k, v in STATES.items()}
BY_FIPS = {v[0]: k for k, v in STATES.items()}


def now_utc():
    return datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0)


def html_text(raw):
    s = raw.decode("utf-8", "replace") if isinstance(raw, (bytes, bytearray)) else str(raw or "")
    s = re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", s)
    s = re.sub(r"(?i)<br\s*/?>|</(p|div|tr|li|h\d|td|th)>", "\n", s)
    s = re.sub(r"<[^>]+>", " ", s)
    s = htmlmod.unescape(s)
    return "\n".join(re.sub(r"[ \t ]+", " ", ln).strip() for ln in s.splitlines() if ln.strip())


# ---------------------------------------------------------------- interest
def find_month(text):
    """'2026-10' from 'October 2026 Lending Rates' or 'effective October 1, 2026'."""
    m = re.search(r"\b(" + "|".join(MONTHS) + r")\s+(?:\d{1,2},\s*)?(20\d\d)\b", text, re.I)
    if not m:
        return None
    return "%s-%02d" % (m.group(2), MONTHS.index(m.group(1).lower()) + 1)


def parse_interest(text, month_hint=None):
    """(dict, None) or (None, why). Wants the commodity loan rate and its month."""
    if not text:
        return None, "no text"
    m = re.search(r"commodity\s+loans?\b(?:\s*\(?(?:less\s+than\s+one\s+year|disbursed)[^)\n]{0,60}\)?)?(?:(?!loan)[^%]){0,80}?(\d{1,2}\.\d{1,4})\s*(?:%|percent)",
                  text, re.I | re.S)
    if not m:
        return None, "no 'Commodity Loan ... N.NNN%' line"
    pct = float(m.group(1))
    if not (RATE_RANGE[0] <= pct <= RATE_RANGE[1]):
        return None, "rate %.3f%% outside %s" % (pct, RATE_RANGE)
    head = text[:max(0, m.start())][-4000:] + "\n" + text[:600]
    month = find_month(text[:600]) or find_month(head) or month_hint
    if not month:
        return None, "no month for the rate"
    return {"pct": round(pct, 4), "month": month}, None


def release_urls(today):
    """Candidate monthly release URLs for this month (FSA posts on the 1st to 3rd business day)."""
    mon = MONTHS[today.month - 1]
    out = []
    for d in range(1, 6):
        base = "https://www.fsa.usda.gov/news-events/news/%02d-%02d-%d/" % (today.month, d, today.year)
        out.append(base + "usda-announces-%s-%d-lending-rates-agricultural-producers" % (mon, today.year))
    return out


# ---------------------------------------------------------------- county tables
def xlsx_rows(raw):
    """Rows of the first sheet of an .xlsx as lists of strings (stdlib zip + xml)."""
    z = zipfile.ZipFile(io.BytesIO(raw))
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        x = z.read("xl/sharedStrings.xml").decode("utf-8", "replace")
        for si in re.findall(r"<si>(.*?)</si>", x, re.S):
            shared.append(htmlmod.unescape("".join(re.findall(r"<t[^>]*>(.*?)</t>", si, re.S))))
    sheets = sorted(n for n in z.namelist() if re.match(r"xl/worksheets/sheet\d+\.xml$", n))
    if not sheets:
        return []
    x = z.read(sheets[0]).decode("utf-8", "replace")
    rows = []
    for r in re.findall(r"<row[^>]*>(.*?)</row>", x, re.S):
        cells = {}
        for c in re.finditer(r'<c r="([A-Z]+)\d+"([^>]*?)(?:/>|>(.*?)</c>)', r, re.S):
            ref, attrs, body = c.group(1), c.group(2), c.group(3) or ""
            v = re.search(r"<v>(.*?)</v>", body, re.S)
            t = re.search(r't="(\w+)"', attrs)
            if t and t.group(1) == "s" and v:
                val = shared[int(v.group(1))]
            elif t and t.group(1) == "inlineStr":
                val = htmlmod.unescape("".join(re.findall(r"<t[^>]*>(.*?)</t>", body, re.S)))
            else:
                val = htmlmod.unescape(v.group(1)) if v else ""
            col = 0
            for ch in ref:
                col = col * 26 + ord(ch) - 64
            cells[col - 1] = val.strip()
        if cells:
            rows.append([cells.get(i, "") for i in range(max(cells) + 1)])
    return rows


def csv_rows(raw):
    return [[c.strip() for c in r] for r in csv.reader(io.StringIO(raw.decode("utf-8-sig", "replace")))]


def crop_of(s):
    s = (s or "").lower()
    if "soy" in s:
        return "soybeans"
    if "corn" in s:
        return "corn"
    return None


def num(s):
    s = re.sub(r"[$,\s]", "", str(s or ""))
    try:
        return float(s)
    except ValueError:
        return None


def state_of(s):
    s = (s or "").strip()
    if s.upper() in STATES:
        return s.upper()
    if s.lower() in BY_NAME:
        return BY_NAME[s.lower()]
    if re.fullmatch(r"\d{1,2}", s) and s.zfill(2) in BY_FIPS:
        return BY_FIPS[s.zfill(2)]
    return None


def parse_table(rows, file_crop=None):
    """{crop: {ST: {county: {"rate", "fips"}}}} and notes, or (None, why)."""
    hdr_i = None
    for i, r in enumerate(rows[:40]):
        low = [c.lower() for c in r]
        if any("county" in c and "code" not in c and "fips" not in c for c in low) and any("state" in c for c in low):
            hdr_i = i
            break
    if hdr_i is None:
        return None, "no header row with State and County columns"
    hdr = [c.lower() for c in rows[hdr_i]]

    def col(pred):
        for j, c in enumerate(hdr):
            if pred(c):
                return j
        return None
    c_state = col(lambda c: "state" in c and "code" not in c) if col(lambda c: "state" in c and "code" not in c) is not None else col(lambda c: "state" in c)
    c_county = col(lambda c: "county" in c and "code" not in c and "fips" not in c)
    c_ccode = col(lambda c: "county" in c and ("code" in c or "fips" in c))
    c_fips = col(lambda c: "fips" in c and "county" not in c)
    crop_cols = {}
    for j, c in enumerate(hdr):
        k = crop_of(c)
        if k and k not in crop_cols:
            crop_cols[k] = j
    if not crop_cols and file_crop:
        j = col(lambda c: "rate" in c or "loan" in c)
        if j is not None:
            crop_cols[file_crop] = j
    if c_state is None or c_county is None or not crop_cols:
        return None, "header lacks state, county or a corn/soybean rate column: %s" % rows[hdr_i]
    out = {k: {} for k in crop_cols}
    bad = 0
    for r in rows[hdr_i + 1:]:
        if len(r) <= max([c_state, c_county] + list(crop_cols.values())):
            continue
        st = state_of(r[c_state])
        county = r[c_county].strip()
        if not st or not county:
            continue
        fips = None
        if c_fips is not None and re.fullmatch(r"\d{5}", r[c_fips].strip()):
            fips = r[c_fips].strip()
        elif c_ccode is not None and re.fullmatch(r"\d{1,3}", r[c_ccode].strip()):
            fips = STATES[st][0] + r[c_ccode].strip().zfill(3)
        for k, j in crop_cols.items():
            v = num(r[j])
            if v is None or v == 0:
                continue
            lo, hi = NATIONAL[k] * (1 - COUNTY_BAND), NATIONAL[k] * (1 + COUNTY_BAND)
            if not (lo <= v <= hi):
                bad += 1
                continue
            out[k].setdefault(st, {})[county] = {"rate": round(v, 4), "fips": fips}
    return out, bad


def validate_counties(parsed):
    """(ok_crops dict, why or None). A crop passes with MIN_COUNTIES or more and no out-of-band rate."""
    tables, bad = parsed
    if bad:
        return None, "%d rate(s) more than %d%% from the national rate; table refused whole" % (bad, COUNTY_BAND * 100)
    ok = {}
    notes = []
    for k, sts in tables.items():
        n = sum(len(v) for v in sts.values())
        if n >= MIN_COUNTIES:
            ok[k] = sts
        else:
            notes.append("%s: only %d counties" % (k, n))
    if not ok:
        return None, "; ".join(notes) or "nothing parsed"
    return ok, ("; ".join(notes) or None)


def county_links(page_html, base):
    """(url, link text) for links that look like county loan rate files."""
    s = page_html.decode("utf-8", "replace") if isinstance(page_html, (bytes, bytearray)) else page_html
    out = []
    for m in re.finditer(r'<a\b[^>]*href="([^"]+)"[^>]*>(.*?)</a>', s, re.I | re.S):
        href, txt = m.group(1), re.sub(r"<[^>]+>|\s+", " ", m.group(2)).strip()
        both = (href + " " + txt).lower()
        if "county" in both and ("loan" in both or "rate" in both) and re.search(r"\.(xlsx|xls|csv|pdf)(\?|$)", href, re.I):
            out.append((urljoin(base, htmlmod.unescape(href)), txt))
    return out


def load_file(url, raw):
    low = url.lower().split("?")[0]
    if low.endswith(".xlsx") or raw[:2] == b"PK":
        return xlsx_rows(raw), None
    if low.endswith(".csv"):
        return csv_rows(raw), None
    if low.endswith(".pdf") or raw[:5] == b"%PDF-":
        return None, "county file is a PDF; no parser written for its layout yet (see --probe)"
    return None, "county file format not read (%s)" % low.rsplit(".", 1)[-1]


# ---------------------------------------------------------------- run
def read_json(p):
    try:
        return json.loads(Path(p).read_text())
    except Exception:
        return None


def get(url):
    raw, err = FD.http_get(url)
    return raw, (None if raw is not None else "fetch failed: %s" % err)


def fetch_interest(today, getter):
    tried = []
    raw, err = getter(RATES_PAGE)
    if raw is not None:
        p, why = parse_interest(html_text(raw))
        if p and p["month"] == today.strftime("%Y-%m"):
            return dict(p, source=RATES_PAGE), None
        tried.append("%s: %s" % (RATES_PAGE, why or "month %s is not this month" % p["month"]))
    else:
        tried.append("%s: %s" % (RATES_PAGE, err))
    for u in release_urls(today):
        raw, err = getter(u)
        if raw is None:
            continue
        p, why = parse_interest(html_text(raw), month_hint=today.strftime("%Y-%m"))
        if p:
            return dict(p, source=u), None
        tried.append("%s: %s" % (u, why))
    return None, "; ".join(tried) or "no page answered"


def fetch_counties(getter):
    for page in LOAN_PAGES:
        raw, err = getter(page)
        if raw is None:
            continue
        links = county_links(raw, page)
        if not links:
            return None, "no county loan rate file linked on %s" % page
        merged, bad, srcs, whys = {}, 0, [], []
        for u, txt in links:
            if str(CROP_YEAR) not in (u + txt):
                continue
            fr, ferr = getter(u)
            if fr is None:
                whys.append("%s: %s" % (u, ferr))
                continue
            rows, why = load_file(u, fr)
            if rows is None:
                whys.append("%s: %s" % (u, why))
                continue
            got, b = parse_table(rows, file_crop=crop_of(u + " " + txt))
            if got is None:
                whys.append("%s: %s" % (u, b))
                continue
            bad += b
            srcs.append(u)
            for k, sts in got.items():
                for st, cs in sts.items():
                    merged.setdefault(k, {}).setdefault(st, {}).update(cs)
        if not srcs:
            return None, "; ".join(whys) or "no %d county file linked" % CROP_YEAR
        ok, why = validate_counties((merged, bad))
        if ok is None:
            return None, why
        return {"tables": ok, "sources": srcs, "page": page, "note": why}, None
    return None, "commodity loan rates page did not answer"


def run(root, today=None, getter=get):
    today = today or datetime.date.today()
    root = Path(root)
    old = read_json(root / OUT) or {}
    out = {
        "note": "Written by scripts/fetch_ccc_loan.py from public FSA pages. /commodity-loan reads it.",
        "generated": now_utc().isoformat().replace("+00:00", "Z"),
        "interest": old.get("interest"), "counties": old.get("counties"),
        "status": {},
    }
    it, why = fetch_interest(today, getter)
    if it:
        prev = old.get("interest") or {}
        if prev.get("month") and prev["month"] > it["month"]:
            out["status"]["interest"] = "kept %s; read an older month %s" % (prev["month"], it["month"])
        else:
            out["interest"] = dict(it, read_utc=out["generated"])
            out["status"]["interest"] = "ok"
    else:
        out["status"]["interest"] = "kept last good; " + why
    ct, why = fetch_counties(getter)
    if ct:
        sd = root / STATE_DIR
        sd.mkdir(parents=True, exist_ok=True)
        states = {}
        for st in sorted(STATES):
            rows = {}
            for k, sts in ct["tables"].items():
                for county, v in (sts.get(st) or {}).items():
                    r = rows.setdefault(county, {"county": county, "fips": v["fips"]})
                    r[k] = v["rate"]
            if not rows:
                continue
            body = {"crop_year": CROP_YEAR, "state": st, "name": STATES[st][1], "sources": ct["sources"],
                    "read_utc": out["generated"], "counties": sorted(rows.values(), key=lambda r: r["county"])}
            (sd / (st + ".json")).write_text(json.dumps(body, separators=(",", ":")) + "\n")
            states[st] = {"name": STATES[st][1], "n": len(rows)}
        out["counties"] = {"crop_year": CROP_YEAR, "crops": sorted(ct["tables"]), "states": states,
                           "page": ct["page"], "sources": ct["sources"], "read_utc": out["generated"]}
        out["status"]["counties"] = "ok" + ("; " + ct["note"] if ct.get("note") else "")
    else:
        out["status"]["counties"] = "kept last good; " + why
    (root / OUT).parent.mkdir(parents=True, exist_ok=True)
    (root / OUT).write_text(json.dumps(out, indent=1) + "\n")
    print(json.dumps(out["status"], indent=1))
    return 0


def probe(root, today=None):
    today = today or datetime.date.today()
    rd = Path(root) / RAW_DIR
    rd.mkdir(parents=True, exist_ok=True)
    listing = []

    def keep(name, url, raw, err):
        listing.append({"file": name if raw is not None else None, "url": url, "bytes": len(raw) if raw is not None else 0, "error": err})
        if raw is not None:
            (rd / name).write_bytes(raw)
        print(url, "->", name if raw is not None else err)

    raw, err = get(RATES_PAGE)
    keep("current-rates.html", RATES_PAGE, raw, err)
    if raw is not None:
        print("  parsed:", parse_interest(html_text(raw)))
    for i, u in enumerate(release_urls(today)):
        raw, err = get(u)
        keep("release-%d.html" % i, u, raw, err)
        if raw is not None:
            print("  parsed:", parse_interest(html_text(raw), today.strftime("%Y-%m")))
    for i, page in enumerate(LOAN_PAGES):
        raw, err = get(page)
        keep("loan-rates-page-%d.html" % i, page, raw, err)
        if raw is None:
            continue
        links = county_links(raw, page)
        print("  county links:", links)
        for j, (u, txt) in enumerate(links[:20]):
            fr, ferr = get(u)
            ext = u.lower().split("?")[0].rsplit(".", 1)[-1][:4]
            keep("county-%d-%d.%s" % (i, j, ext), u, fr, ferr)
            if fr is not None:
                rows, why = load_file(u, fr)
                if rows is None:
                    print("  ", why)
                    if fr[:5] == b"%PDF-":
                        t, _ = FD.pdf_to_text(fr)
                        if t:
                            (rd / ("county-%d-%d.txt" % (i, j))).write_text(t)
                else:
                    (rd / ("county-%d-%d.rows.json" % (i, j))).write_text(json.dumps(rows[:80], indent=0))
                    got, b = parse_table(rows, crop_of(u + " " + txt))
                    print("   parsed:", "NO (%s)" % b if got is None else {k: sum(len(v) for v in s.values()) for k, s in got.items()}, "out of band:", b if got else "")
    (rd / "listing.json").write_text(json.dumps({"run_utc": now_utc().isoformat(), "files": listing}, indent=1) + "\n")
    return 0


# ---------------------------------------------------------------- selftest
# Built from how FSA words the release (search results), not a fetched page.
RELEASE_FIX = """<html><head><title>USDA Announces October 2026 Lending Rates for Agricultural Producers | Farm Service Agency</title></head>
<body><h1>USDA Announces October 2026 Lending Rates for Agricultural Producers</h1>
<p>WASHINGTON, Oct. 1, 2026 \u2013 The U.S. Department of Agriculture announced loan interest rates for October 2026, which are effective Oct. 1, 2026.</p>
<p>Commodity and Storage Facility Loans</p>
<ul><li>Commodity Loans (less than one year disbursed): 5.250%</li>
<li>Farm Storage Facility Loans (3-year loan terms): 4.500%</li></ul>
</body></html>"""
CURRENT_FIX = """<table><tr><th>Loan type</th><th>Rate</th></tr>
<tr><td>Commodity Loan</td><td>5.125%</td></tr></table><p>Rates effective September 1, 2026</p>"""
LINKS_FIX = """<ul><li><a href="/sites/default/files/2026-04/2026-County-Loan-Rates-Corn.xlsx">2026 County Loan Rates - Corn</a></li>
<li><a href="https://www.fsa.usda.gov/sites/default/files/2026-04/2026-Soybean-County-Loan-Rates.csv">2026 Soybeans County Loan Rates</a></li>
<li><a href="/sites/default/files/2026-04/2026-National-Average-Loan-Rates.pdf">National rates</a></li></ul>"""


def make_xlsx(rows):
    """Tiny .xlsx with inline strings, for the selftest."""
    def cell(ref, v):
        if isinstance(v, (int, float)):
            return '<c r="%s"><v>%s</v></c>' % (ref, v)
        return '<c r="%s" t="inlineStr"><is><t>%s</t></is></c>' % (ref, htmlmod.escape(str(v)))
    body = "".join('<row r="%d">%s</row>' % (i + 1, "".join(cell(chr(65 + j) + str(i + 1), v) for j, v in enumerate(r)))
                   for i, r in enumerate(rows))
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as z:
        z.writestr("xl/worksheets/sheet1.xml", '<worksheet><sheetData>%s</sheetData></worksheet>' % body)
    return b.getvalue()


def selftest():
    fails = []

    def ck(name, ok, detail=""):
        print(("ok   " if ok else "FAIL ") + name + ("" if ok else "  " + str(detail)))
        if not ok:
            fails.append(name)

    p, why = parse_interest(html_text(RELEASE_FIX))
    ck("release: 5.250% for 2026-10", p == {"pct": 5.25, "month": "2026-10"}, (p, why))
    p, why = parse_interest(html_text(CURRENT_FIX))
    ck("current page: 5.125% for 2026-09", p == {"pct": 5.125, "month": "2026-09"}, (p, why))
    p, why = parse_interest("Commodity Loans: 52.5%  October 2026")
    ck("refuses 52.5%", p is None and "outside" in why, why)
    p, why = parse_interest("Commodity Loans: 5.250%")
    ck("refuses a rate with no month", p is None and "month" in why, why)
    p, why = parse_interest("Farm Operating Loans (Direct): 5.625% October 2026")
    ck("does not read another loan's rate", p is None, p)
    ck("release urls", release_urls(datetime.date(2026, 10, 16))[0] ==
       "https://www.fsa.usda.gov/news-events/news/10-01-2026/usda-announces-october-2026-lending-rates-agricultural-producers")

    links = county_links(LINKS_FIX, "https://www.fsa.usda.gov/programs-and-services/price-support/commodity-loan-rates")
    ck("county links: two files, absolute urls", [u for u, _ in links] == [
        "https://www.fsa.usda.gov/sites/default/files/2026-04/2026-County-Loan-Rates-Corn.xlsx",
        "https://www.fsa.usda.gov/sites/default/files/2026-04/2026-Soybean-County-Loan-Rates.csv"], links)

    # Wide table: state name, county, corn and soybean columns.
    rows = [["2026 County Loan Rates"], ["State", "County", "County Code", "Corn ($/bu)", "Soybeans ($/bu)"]]
    for i in range(320):
        rows.append(["Iowa" if i < 99 else "Illinois" if i < 201 else "Nebraska", "C%03d" % i, str(i % 200 + 1), 2.25 + (i % 10) / 100, 6.50 + (i % 7) / 100])
    raw = make_xlsx(rows)
    got, bad = parse_table(xlsx_rows(raw))
    ck("xlsx wide table parses 320 counties a crop", got and sum(len(v) for v in got["corn"].values()) == 320 and bad == 0, (bad,))
    ck("county fips from state + county code", got["corn"]["IA"]["C000"]["fips"] == "19001", got["corn"]["IA"]["C000"])
    ok, why = validate_counties((got, bad))
    ck("validates", ok is not None and set(ok) == {"corn", "soybeans"}, why)

    # One out-of-band rate refuses the whole table.
    rows2 = [r[:] for r in rows]
    rows2[5][3] = 24.2
    got2, bad2 = parse_table(xlsx_rows(make_xlsx(rows2)))
    ok2, why2 = validate_counties((got2, bad2))
    ck("a rate 10x the national refuses the table", ok2 is None and "refused" in why2, why2)

    # Too few counties refuses.
    got3, bad3 = parse_table(rows[:50])
    ok3, why3 = validate_counties((got3, bad3))
    ck("48 counties is not enough", ok3 is None and "only" in why3, why3)

    # Per-crop csv with a Loan Rate column; crop from the file name; state codes as numbers.
    csvb = "State Code,State,County Name,County Code,Loan Rate\n" + "".join("19,IA,K%03d,%d,6.6%d\n" % (i, i + 1, i % 10) for i in range(310))
    got4, bad4 = parse_table(csv_rows(csvb.encode()), file_crop=crop_of("2026-Soybean-County-Loan-Rates.csv"))
    ck("per-crop csv", got4 and list(got4) == ["soybeans"] and len(got4["soybeans"]["IA"]) == 310 and bad4 == 0, (got4 and list(got4), bad4))
    ck("pdf refused", load_file("x.pdf", b"%PDF-1.4")[0] is None)

    # run(): with fake pages, writes the feed and state files; with nothing, keeps old values.
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        pages = {
            RATES_PAGE: CURRENT_FIX.encode(),
            release_urls(datetime.date(2026, 10, 16))[0]: RELEASE_FIX.encode(),
            LOAN_PAGES[0]: LINKS_FIX.encode(),
            "https://www.fsa.usda.gov/sites/default/files/2026-04/2026-County-Loan-Rates-Corn.xlsx": raw,
        }
        g = lambda u: (pages.get(u), None if u in pages else "404")  # noqa: E731
        run(d, today=datetime.date(2026, 10, 16), getter=g)
        out = read_json(Path(d) / OUT)
        ck("run: October release wins over a September current page", out["interest"]["month"] == "2026-10" and out["interest"]["pct"] == 5.25, out["interest"])
        ia = read_json(Path(d) / STATE_DIR / "IA.json")
        ck("run: Iowa file with 99 counties", ia and len(ia["counties"]) == 99 and "corn" in ia["counties"][0], ia and len(ia["counties"]))
        ck("run: index lists states", set(out["counties"]["states"]) == {"IA", "IL", "NE"}, out["counties"]["states"])
        run(d, today=datetime.date(2026, 10, 16), getter=lambda u: (None, "offline"))
        out2 = read_json(Path(d) / OUT)
        ck("run offline keeps last good", out2["interest"] == out["interest"] and out2["counties"] == out["counties"]
           and out2["status"]["interest"].startswith("kept"), out2["status"])
        pages[release_urls(datetime.date(2026, 10, 16))[0]] = RELEASE_FIX.replace("October", "September").encode()
        run(d, today=datetime.date(2026, 10, 16), getter=g)
        out3 = read_json(Path(d) / OUT)
        ck("never replaces a newer month with an older one", out3["interest"]["month"] == "2026-10", out3["interest"])
    print("FAILS=%d" % len(fails))
    return 1 if fails else 0


def main(argv):
    if "--selftest" in argv:
        return selftest()
    if "--probe" in argv:
        return probe(ROOT)
    return run(ROOT)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
