#!/usr/bin/env python3
"""
AGSIST -- data/fertilizer-ams.json for fertilizer.html: the public USDA price
series beside the co-op posted prices (see scripts/build_fert_prices.py).

Source (public domain, no key, no login):
  USDA AMS Livestock, Poultry, and Grain Market News, Springfield IL,
  "Illinois Production Cost Report (Bi-weekly)", My Market News report 3195.
    PDF:  https://www.ams.usda.gov/mnreports/ams_3195.pdf
    Page: https://mymarketnews.ams.usda.gov/viewReport/3195
  It replaced the old text report GX_GR210 (retired February 2022). farmdoc
  daily's fertilizer articles cite this same report.

Modes:
  (default)   fetch, parse, validate, write. Keep-last-good on any failure.
  --probe     fetch, save what came back to data/fert-ams-raw/, print what
              parsed and what did not, exit 0. Writes no feed.
  --selftest  offline tests on the saved fixtures (test/fixtures/fert-ams/).

WHAT THIS FILE WILL NOT DO
  * It never writes a number it did not read in the report. A product the
    parser cannot read cleanly is left out, never filled in or carried.
  * It never writes a zero, and never a price whose average falls outside its
    own range or outside a sane band for the product.
  * A product that appears on two lines with different prices (a regional
    table, say) is left out: the page would not know which one to show.
  * It never replaces a newer report with an older one.
  * A move of more than 60% from the last report in any product is taken as a
    misread, and the whole report is refused.
  * On failure it leaves the last good feed alone and only updates `status`.
    If no feed exists yet, it writes nothing, so the page shows nothing.

CHECKED AGAINST THE LIVE REPORT
  * Run 38692414508 (probe, 2026-10-15) reached www.ams.usda.gov from a GitHub
    runner and committed the PDF and its text to data/fert-ams-raw/ (commit
    ae5f057978). The report dated Fri Oct 2, 2026 is the main selftest
    fixture, test/fixtures/fert-ams/ams_3195_real_2026-10-02.txt. Its text has
    one cell per line under "Distributor (Dollars Per Ton)", product names
    sometimes wrapped over two lines; cell_rows() reads that. The two older
    fixtures are reconstructions with made-up numbers and stay as a second
    layout.

Stdlib only, plus pdftotext (poppler) or pypdf for the PDF text.
"""
import datetime
import json
import os
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_dairy import http_get, pdf_to_text  # noqa: E402  same host, same PDF handling

ROOT = Path(__file__).resolve().parent.parent
OUT = "data/fertilizer-ams.json"
HIST = "data/fertilizer-ams-history.json"
RAW_DIR = "data/fert-ams-raw"
FIX_DIR = "test/fixtures/fert-ams"

REPORT_ID = "3195"
AMS_URL = "https://www.ams.usda.gov/mnreports/ams_3195.pdf"
PAGE_URL = "https://mymarketnews.ams.usda.gov/viewReport/3195"
REPORT_NAME = "USDA AMS Illinois Production Cost Report (Bi-weekly)"
UA = "agsist.com fertilizer feed (contact: sig@farmers1st.com)"

MAX_MOVE = 0.60
MIN_PRODUCTS = 3
MAX_AGE_DAYS = 400

# key -> (display name, grade symbol, sane $/ton band)
PRODUCTS = {
    "anhydrous": ("Anhydrous ammonia", "82-0-0", (300, 2500)),
    "uan28":     ("UAN 28%", "28-0-0", (100, 1300)),
    "uan32":     ("UAN 32%", "32-0-0", (100, 1400)),
    "urea":      ("Urea", "46-0-0", (200, 1800)),
    "dap":       ("DAP", "18-46-0", (300, 2000)),
    "potash":    ("Potash", "0-0-60", (150, 1500)),
}
ORDER = list(PRODUCTS)
GRADE_KEY = {"82-0-0": "anhydrous", "28-0-0": "uan28", "32-0-0": "uan32", "46-0-0": "urea",
             "18-46-0": "dap", "0-0-60": "potash", "0-0-62": "potash"}

MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august",
          "september", "october", "november", "december"]
MON = {m[:3]: i + 1 for i, m in enumerate(MONTHS)}
MON["sept"] = 9

GRADE_RE = re.compile(r"(?<![\d.])(\d{1,2})-(\d{1,2})-(\d{1,2})(?![\d.])")
NUM = r"(\d{1,3}(?:,\d{3})*\.\d{2})"
RANGE_RE = re.compile(NUM + r"\s*-\s*" + NUM + r"\s+" + NUM)
LONE_RE = re.compile(NUM)


# ---------------------------------------------------------------- parsing
def norm(line):
    return re.sub(r"\s+", " ", line.replace("–", "-").replace("—", "-")).strip()


def product_key(line):
    """(key, grade) for a report line, or (None, None). The grade column is the
    strongest key; the product name is the fallback."""
    low = line.lower()
    if re.search(r"gallon|diesel|propane|gasoline|\bgal\b", low):
        return None, None
    for m in GRADE_RE.finditer(line):
        g = "%d-%d-%d" % tuple(int(x) for x in m.groups())
        if g in GRADE_KEY:
            return GRADE_KEY[g], g
        return None, None          # a grade we do not carry (10-34-0, 11-52-0 ...)
    if re.match(r"anhydrous\b", low):
        return "anhydrous", "82-0-0"
    m = re.match(r"(?:liquid nitrogen|uan|nitrogen solution)\b\D{0,12}(28|32)\s*%", low)
    if m:
        return ("uan" + m.group(1)), m.group(1) + "-0-0"
    if re.match(r"urea\b", low):
        return "urea", "46-0-0"
    if re.match(r"(?:dap\b|diammonium phosphate)", low):
        return "dap", "18-46-0"
    if re.match(r"potash\b", low):
        return "potash", "0-0-60"
    return None, None


def line_prices(line):
    """(low, high, avg) from a product line, grade and percent tokens removed."""
    t = GRADE_RE.sub(" ", line)
    t = re.sub(r"\d+(?:\.\d+)?\s*%", " ", t)
    m = RANGE_RE.search(t)
    f = lambda s: float(s.replace(",", ""))  # noqa: E731
    if m:
        return f(m.group(1)), f(m.group(2)), f(m.group(3))
    nums = LONE_RE.findall(t)
    if len(nums) == 1:
        v = f(nums[0])
        return v, v, v
    return None


def parse_date(text, today):
    """The report's own date: the first date in the top 25 lines."""
    head = [norm(x) for x in text.splitlines()[:25]]
    for line in head:
        m = re.search(r"\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(20\d\d)\b", line, re.I)
        if m:
            mo, d, y = MON[m.group(1).lower()[:3]], int(m.group(2)), int(m.group(3))
        else:
            m = re.search(r"\b(\d{1,2})/(\d{1,2})/(20\d\d)\b", line)
            if not m:
                continue
            mo, d, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        try:
            dt = datetime.date(y, mo, d)
        except ValueError:
            continue
        if dt > today + datetime.timedelta(days=1) or (today - dt).days > MAX_AGE_DAYS:
            return None
        return dt
    return None


def parse_terms(text):
    """The report's own wording of what the prices are, quoted, or None."""
    for line in text.splitlines()[:40]:
        n = norm(line)
        if re.search(r"state ?wide", n, re.I) and re.search(r"FOB|F\.O\.B", n, re.I):
            return n
    return None


SALE_RE = re.compile(r"^(ask|bid|offer|asking|sale|trade)$", re.I)
UNIT_RE = re.compile(r"\(dollars per (\w+)\)", re.I)
FREIGHT_RE = re.compile(r"^(f\.?o\.?b\.?|dlvd\.?|delivered)$", re.I)
CHANGE_RE = re.compile(r"^(\(?-?\d{1,3}(?:,\d{3})*\.\d{2}\)?|unch\.?|-+)$", re.I)
CELL_HEADERS = {"class", "sale type", "package", "price range", "average", "avg price", "change",
                "freight", "delivery period", "price unit", "product", "grade"}
PERIOD_WORDS = {"current", "prompt", "spot", "forward"}


def _num(s):
    m = re.fullmatch(NUM, s.strip())
    return float(m.group(1).replace(",", "")) if m else None


def cell_rows(text):
    """The real My Market News PDF (pdftotext, Oct 2026) puts every cell on its
    own line: name (sometimes wrapped over two lines), sale type, "low - high"
    (or one price), average, change, freight, delivery period. Each table sits
    under a header such as "Distributor (Dollars Per Ton)".
    -> (rows, terms, problems); a row is dict(name, low, high, avg, unit, freight)."""
    lines = [norm(x) for x in text.splitlines()]
    lines = [x for x in lines if x]
    rows, problems, terms = [], [], None
    unit, buf, i = None, [], 0
    while i < len(lines):
        line = lines[i]
        low = line.lower()
        m = UNIT_RE.search(line)
        if m:
            unit, buf = m.group(1).lower(), []
            if unit == "ton" and terms is None:
                terms = line
            i += 1
            continue
        if SALE_RE.match(line) and buf:
            name = re.sub(r"(\d)\s*-\s*(\d)", r"\1-\2", " ".join(buf))
            buf = []
            rng = lines[i + 1] if i + 1 < len(lines) else ""
            avg = _num(lines[i + 2]) if i + 2 < len(lines) else None
            m = re.fullmatch(NUM + r"\s*-\s*" + NUM, rng)
            lo, hi = (_num(m.group(1)), _num(m.group(2))) if m else (_num(rng), _num(rng))
            if lo is None or avg is None:
                problems.append("%s: price cells not read (%r)" % (name, lines[i + 1:i + 3]))
                i += 1
                continue
            j = i + 3
            if j < len(lines) and CHANGE_RE.match(lines[j]):
                j += 1
            freight = None
            if j < len(lines) and FREIGHT_RE.match(lines[j]):
                freight = lines[j]
                j += 1
                if j < len(lines) and lines[j].lower() in PERIOD_WORDS:
                    j += 1
            rows.append({"name": name, "low": lo, "high": hi, "avg": avg, "unit": unit, "freight": freight})
            i = j
            continue
        if (low in CELL_HEADERS or low in PERIOD_WORDS or FREIGHT_RE.match(line)
                or CHANGE_RE.match(line) or re.match(r"^[\d$(]", line)):
            buf = []
        else:
            buf = (buf + [line])[-3:]
        i += 1
    return rows, terms, problems


def parse_report(text, today):
    """-> dict(date, terms, products{key: {...}}, problems[]).
    Reads both layouts: one row per line (the old text style and the fixtures)
    and one cell per line (the real PDF). A product is checked the same way
    whichever layout it came from."""
    problems = []
    found = {}
    cands = []
    for raw in text.splitlines():
        line = norm(raw)
        if not line:
            continue
        key, grade = product_key(line)
        if not key:
            continue
        px = line_prices(line)
        if not px:
            continue
        cands.append((key, grade) + px + (None,))
    rows, cell_terms, cell_problems = cell_rows(text)
    problems += cell_problems
    for r in rows:
        key, grade = product_key(r["name"])
        if not key:
            continue
        if r["unit"] != "ton":
            problems.append("%s: listed under dollars per %s, not per ton; left out" % (r["name"], r["unit"]))
            continue
        cands.append((key, grade, r["low"], r["high"], r["avg"], r["freight"]))
    for key, grade, lo, hi, avg, freight in cands:
        band = PRODUCTS[key][2]
        if not (0 < lo <= avg <= hi):
            problems.append("%s: average %s outside its range %s-%s" % (key, avg, lo, hi))
            continue
        if not (band[0] <= avg <= band[1]):
            problems.append("%s: %s $/ton is outside %s-%s" % (key, avg, band[0], band[1]))
            continue
        found.setdefault(key, []).append({"low": lo, "high": hi, "avg": avg, "grade": grade, "freight": freight})
    products = {}
    for key, rows_ in found.items():
        if len({(r["low"], r["high"], r["avg"]) for r in rows_}) > 1:
            problems.append("%s: %d different prices on different lines; left out" % (key, len(rows_)))
            continue
        r = rows_[0]
        name, sym, _ = PRODUCTS[key]
        products[key] = {"key": key, "name": name, "symbol": r["grade"] or sym,
                         "low": r["low"], "high": r["high"], "avg": r["avg"], "unit": "$/ton"}
        if r["freight"]:
            products[key]["freight"] = r["freight"]
    return {"date": parse_date(text, today), "terms": parse_terms(text) or cell_terms,
            "products": products, "problems": problems}


# ---------------------------------------------------------------- compose
def read_json(path):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return None


def atomic_write(path, obj):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, indent=1, ensure_ascii=False) + "\n")
    os.replace(tmp, path)


def compose(existing, parsed, err, now_iso):
    """-> (doc or None, reason). doc None means: write nothing new except status."""
    if err:
        return None, err
    if not parsed["date"]:
        return None, "no report date found in the header (or it was in the future / over %d days old)" % MAX_AGE_DAYS
    prods = parsed["products"]
    if len(prods) < MIN_PRODUCTS:
        return None, "only %d products read (%s); layout not recognized" % (len(prods), ", ".join(sorted(prods)) or "none")
    rd = parsed["date"].isoformat()
    if existing and existing.get("report_date"):
        if rd < existing["report_date"]:
            return None, "report dated %s is older than the one on file (%s)" % (rd, existing["report_date"])
        old = {p["key"]: p for p in existing.get("products") or []}
        for k, p in prods.items():
            o = old.get(k)
            if o and o.get("avg") and abs(p["avg"] - o["avg"]) / o["avg"] > MAX_MOVE:
                return None, "%s moved %s -> %s (over %d%%); probable misread" % (k, o["avg"], p["avg"], MAX_MOVE * 100)
    doc = {
        "source": REPORT_NAME,
        "report_id": REPORT_ID,
        "url": AMS_URL,
        "page": PAGE_URL,
        "report_date": rd,
        "terms": parsed["terms"],
        "fetched": now_iso,
        "products": [prods[k] for k in ORDER if k in prods],
        "status": {"ok": True, "checked": now_iso, "note": None},
    }
    return doc, None


def run(root, fetched=None, now=None):
    """fetched = (raw, text, err), injected in tests."""
    root = Path(root)
    now = now or datetime.datetime.now(datetime.timezone.utc)
    now_iso = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    raw, text, err = fetched if fetched is not None else fetch()
    parsed = parse_report(text, now.date()) if text else {"date": None, "terms": None, "products": {}, "problems": []}
    existing = read_json(root / OUT)
    doc, why = compose(existing, parsed, err, now_iso)
    if doc is None:
        if existing:
            existing["status"] = {"ok": False, "checked": now_iso, "note": why}
            atomic_write(root / OUT, existing)
        return {"wrote": False, "why": why, "problems": parsed["problems"]}
    # same report already on file: only the check time moves
    if existing and existing.get("report_date") == doc["report_date"] and existing.get("products") == doc["products"]:
        doc["fetched"] = existing.get("fetched", doc["fetched"])
    atomic_write(root / OUT, doc)
    hist = read_json(root / HIST) or {"note": "one row per USDA AMS report 3195 date, appended by scripts/fetch_fert_ams.py", "reports": []}
    row = {"date": doc["report_date"], "avg": {p["key"]: p["avg"] for p in doc["products"]}}
    hist["reports"] = sorted([r for r in hist["reports"] if r["date"] != row["date"]] + [row], key=lambda r: r["date"])
    atomic_write(root / HIST, hist)
    return {"wrote": True, "why": None, "problems": parsed["problems"], "date": doc["report_date"],
            "products": [p["key"] for p in doc["products"]]}


# ---------------------------------------------------------------- network
def fetch(opener=None, sleep=time.sleep):
    raw, err = http_get(AMS_URL, headers={"User-Agent": UA}, opener=opener, sleep=sleep)
    if raw is None:
        return None, None, "AMS fetch failed: %s" % err
    if raw[:5] == b"%PDF-":
        text, e = pdf_to_text(raw)
        if text is None:
            return raw, None, "AMS PDF text extraction failed: %s" % e
        return raw, text, None
    txt = raw.decode("utf-8", "replace")
    if re.search(r"<html|<!doctype|captcha|access denied", txt[:2000], re.I):
        return raw, None, "AMS returned a web page, not a PDF (blocked or moved)"
    return raw, txt, None


def probe(root, now=None, fetched=None):
    """Save what AMS returned and say what happened as workflow annotations
    (::notice / ::warning), so the run page shows it without opening the log."""
    root = Path(root)
    now = now or datetime.datetime.now(datetime.timezone.utc)
    rd = root / RAW_DIR
    rd.mkdir(parents=True, exist_ok=True)
    raw, text, err = fetched if fetched is not None else fetch()
    print("AMS  %s" % AMS_URL)
    if raw is not None:
        (rd / "ams_3195.raw").write_bytes(raw)
        kind = "PDF" if raw[:5] == b"%PDF-" else "not a PDF"
        print("::notice::fert probe: got %d bytes (%s) -> %s/ams_3195.raw" % (len(raw), kind, RAW_DIR))
    else:
        print("::warning::fert probe: nothing came back from %s; nothing saved" % AMS_URL)
    if err:
        print("::warning::fert probe: %s" % err)
    if text is None:
        return 0
    (rd / "ams_3195.txt").write_text(text)
    p = parse_report(text, now.date())
    print("::notice::fert probe: text %d chars -> %s/ams_3195.txt" % (len(text), RAW_DIR))
    print("  report date:", p["date"] or "NOT FOUND")
    print("  terms:", p["terms"] or "NOT FOUND")
    for k in ORDER:
        print("  %-10s %s" % (k, p["products"].get(k) or "NOT READ"))
    for x in p["problems"]:
        print("  note:", x)
    read = [k for k in ORDER if k in p["products"]]
    missing = [k for k in ORDER if k not in p["products"]]
    summary = "report date %s; read %d of %d (%s)" % (
        p["date"] or "NOT FOUND", len(read), len(ORDER),
        ", ".join("%s %.2f" % (k, p["products"][k]["avg"]) for k in read) or "none")
    if p["date"] and not missing:
        print("::notice::fert probe: %s" % summary)
    else:
        print("::warning::fert probe: %s; not read: %s%s" % (
            summary, ", ".join(missing) or "none",
            ("; " + "; ".join(p["problems"])) if p["problems"] else ""))
    return 0


# ---------------------------------------------------------------- selftest
def selftest():
    fails = []

    def ck(name, cond):
        print(("  ok   " if cond else "  FAIL ") + name)
        if not cond:
            fails.append(name)

    fx = ROOT / FIX_DIR
    today = datetime.date(2026, 10, 15)
    real = (fx / "ams_3195_real_2026-10-02.txt").read_text()
    mmn = (fx / "ams_3195_mmn_layout.txt").read_text()
    flat = (fx / "ams_3195_flat.txt").read_text()

    # The real report: pdftotext of ams_3195.pdf dated Fri Oct 2, 2026, saved by
    # the probe run of 2026-10-15. Every number below was checked by hand
    # against that text.
    rp = parse_report(real, today)
    ck("real report: date Fri Oct 2, 2026", rp["date"] == datetime.date(2026, 10, 2))
    ck("real report: all six products read", sorted(rp["products"]) == sorted(ORDER))
    want = {"anhydrous": (835.0, 1050.0, 945.0), "uan28": (400.0, 550.0, 466.67), "uan32": (530.0, 530.0, 530.0),
            "urea": (650.0, 890.0, 770.0), "dap": (840.0, 995.0, 929.29), "potash": (480.0, 550.0, 516.36)}
    for k, v in want.items():
        g = rp["products"].get(k) or {}
        ck("real report: %s low/high/avg %s" % (k, v), (g.get("low"), g.get("high"), g.get("avg")) == v)
    ck("real report: DAP name wrapped over two lines keeps grade 18-46-0", rp["products"]["dap"]["symbol"] == "18-46-0")
    ck("real report: potash grade from the report (White 0-0-62)", rp["products"]["potash"]["symbol"] == "0-0-62")
    ck("real report: MAP 11-52-0 and the diesel/biodiesel rows are not taken",
       all(v["avg"] not in (936.0, 5.63, 5.52) for v in rp["products"].values()))
    ck("real report: freight F.O.B. on every product", all(v.get("freight") == "F.O.B." for v in rp["products"].values()))
    ck("real report: the table header is quoted as the terms", rp["terms"] == "Distributor (Dollars Per Ton)")
    ck("real report: no problems noted", rp["problems"] == [])
    rbad = real.replace("650.00 - 890.00\n770.00", "650.00 - 890.00\n970.00")
    ck("real layout: urea average outside its range is refused", "urea" not in parse_report(rbad, today)["products"])
    rgal = real.replace("Distributor (Dollars Per Ton)", "Distributor (Dollars Per Gallon)")
    ck("real layout: a table not priced per ton gives nothing", parse_report(rgal, today)["products"] == {})
    rdup = real.replace("Urea (46-0-0)\nAsk\n650.00 - 890.00\n770.00",
                        "Urea (46-0-0)\nAsk\n650.00 - 890.00\n770.00\n48.00\nF.O.B.\nCurrent\n"
                        "Urea (46-0-0)\nAsk\n660.00 - 880.00\n772.00")
    ck("real layout: urea on two rows at different prices is left out",
       "urea" not in parse_report(rdup, today)["products"] and len(parse_report(rdup, today)["products"]) == 5)
    rcut = real.replace("945.00\n37.50", "n/a\n37.50")
    ck("real layout: an unreadable average leaves anhydrous out and says so",
       "anhydrous" not in parse_report(rcut, today)["products"]
       and any("Anhydrous" in x for x in parse_report(rcut, today)["problems"]))
    dr, why = compose(None, rp, None, "2026-10-15T15:00:00Z")
    ck("real report composes", dr is not None and dr["report_date"] == "2026-10-02" and len(dr["products"]) == 6)

    p = parse_report(mmn, today)
    ck("MMN layout: report date from the header", p["date"] == datetime.date(2026, 9, 4))
    ck("MMN layout: all six products read", sorted(p["products"]) == sorted(ORDER))
    a = p["products"].get("anhydrous") or {}
    ck("MMN layout: anhydrous range and average, grade column kept",
       (a.get("low"), a.get("high"), a.get("avg"), a.get("symbol")) == (901.0, 999.0, 950.1, "82-0-0"))
    ck("MMN layout: UAN 28 and 32 kept apart",
       p["products"]["uan28"]["avg"] == 450.2 and p["products"]["uan32"]["avg"] == 500.3)
    ck("MMN layout: DAP grade 18-46-0", p["products"]["dap"]["symbol"] == "18-46-0" and p["products"]["dap"]["avg"] == 850.5)
    ck("MMN layout: 10-34-0 and diesel are not mistaken for a product we carry",
       all(v["avg"] not in (650.7, 3.5) for v in p["products"].values()))
    ck("MMN layout: the report's own terms line is quoted", (p["terms"] or "").startswith("Production costs items state wide"))

    q = parse_report(flat, today)
    ck("flat layout: date written out with the weekday", q["date"] == datetime.date(2026, 9, 18))
    ck("flat layout: all six products read", sorted(q["products"]) == sorted(ORDER))
    ck("flat layout: '(82%)' is not read as a price", q["products"]["anhydrous"]["avg"] == 952.25)
    ck("flat layout: potash 0-0-62 keeps its grade", q["products"]["potash"]["symbol"] == "0-0-62")
    ck("flat layout: no terms line, none claimed", q["terms"] is None)

    # a regional table: the same product twice at different prices is left out
    reg = mmn.replace("Urea                       46-0-0       Ask           601.00 - 699.00         650.40     Per Ton       F.O.B.",
                      "Urea                       46-0-0       Ask           601.00 - 699.00         650.40     Per Ton       F.O.B.\n"
                      "Urea                       46-0-0       Ask           611.00 - 689.00         655.00     Per Ton       F.O.B.")
    r = parse_report(reg, today)
    ck("two different urea lines: urea left out, the rest kept", "urea" not in r["products"] and len(r["products"]) == 5)
    bad = mmn.replace("801.00 - 899.00         850.50", "801.00 - 899.00         950.50")
    ck("an average outside its own range is refused", "dap" not in parse_report(bad, today)["products"])
    silly = mmn.replace("401.00 - 499.00         450.60", "40.10 - 49.90         45.06")
    ck("a potash price outside the sane band is refused", "potash" not in parse_report(silly, today)["products"])
    fut = mmn.replace("Fri Sep 04, 2026", "Fri Sep 04, 2027")
    ck("a report dated in the future has no date", parse_report(fut, today)["date"] is None)

    # compose
    now_iso = "2026-10-15T15:00:00Z"
    d, why = compose(None, p, None, now_iso)
    ck("first good report composes", d is not None and why is None and d["report_date"] == "2026-09-04")
    ck("products in page order", [x["key"] for x in d["products"]] == ORDER)
    ck("no zero anywhere", not any(x["avg"] == 0 or x["low"] == 0 for x in d["products"]))
    ck("source, report id and both links carried",
       d["report_id"] == "3195" and d["url"].endswith("ams_3195.pdf") and d["page"].endswith("/3195"))
    d2, why = compose(d, q, None, now_iso)
    ck("a newer report replaces it", d2 is not None and d2["report_date"] == "2026-09-18")
    d3, why = compose(d2, p, None, now_iso)
    ck("an older report never replaces a newer one", d3 is None and "older" in why)
    jump = dict(q, products=dict(q["products"]))
    jump["products"]["urea"] = dict(q["products"]["urea"], avg=1300.0, low=1290.0, high=1310.0)
    d4, why = compose(d, jump, None, now_iso)
    ck("a >60% move is refused as a misread", d4 is None and "urea" in why)
    few = dict(p, products={k: p["products"][k] for k in ("urea", "dap")})
    ck("fewer than 3 products: refused", compose(None, few, None, now_iso)[0] is None)
    nod = dict(p, date=None)
    ck("no report date: refused", compose(None, nod, None, now_iso)[0] is None)
    ck("a fetch error: refused", compose(None, p, "AMS fetch failed: timeout", now_iso)[0] is None)

    # run(): writes only real numbers, keeps last good, never writes a first file from a failure
    import tempfile
    with tempfile.TemporaryDirectory() as tdir:
        T = datetime.datetime(2026, 10, 15, 15, tzinfo=datetime.timezone.utc)
        info = run(tdir, fetched=(None, None, "AMS fetch failed: blocked"), now=T)
        ck("failure with no file on record writes nothing", not info["wrote"] and not (Path(tdir) / OUT).exists())
        info = run(tdir, fetched=(b"x", "<html>Access denied</html>", None), now=T)
        ck("a block page with no file on record writes nothing", not (Path(tdir) / OUT).exists())
        info = run(tdir, fetched=(b"x", mmn, None), now=T)
        doc = read_json(Path(tdir) / OUT)
        ck("good report writes the feed", info["wrote"] and doc["report_date"] == "2026-09-04")
        hist = read_json(Path(tdir) / HIST)
        ck("history row appended", len(hist["reports"]) == 1 and hist["reports"][0]["avg"]["dap"] == 850.5)
        run(tdir, fetched=(None, None, "AMS fetch failed: timeout"), now=T)
        doc2 = read_json(Path(tdir) / OUT)
        ck("a later failure keeps the last good numbers, status says why",
           doc2["products"] == doc["products"] and doc2["status"]["ok"] is False and "timeout" in doc2["status"]["note"])
        run(tdir, fetched=(b"x", flat, None), now=T)
        run(tdir, fetched=(b"x", flat, None), now=T)
        hist = read_json(Path(tdir) / HIST)
        ck("history: one row per report date", [r["date"] for r in hist["reports"]] == ["2026-09-04", "2026-09-18"])

    # fetch(): PDF check and block page, no network
    def opener_for(body):
        class R:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self):
                return body
        return lambda req, timeout=30: R()
    raw, text, err = fetch(opener=opener_for(b"<!DOCTYPE html><title>Access Denied</title>"), sleep=lambda s: None)
    ck("fetch: a web page instead of the PDF is an error", text is None and "web page" in err)

    # probe(): says what happened as annotations, saves the raw text
    import contextlib
    import io
    with tempfile.TemporaryDirectory() as tdir:
        T = datetime.datetime(2026, 10, 15, 6, 26, tzinfo=datetime.timezone.utc)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            probe(tdir, now=T, fetched=(b"%PDF-1.7 x", real, None))
        out = buf.getvalue()
        ck("probe: notice with the byte count and the six averages",
           "::notice::fert probe: got 10 bytes (PDF)" in out and "read 6 of 6" in out and "dap 929.29" in out)
        ck("probe: raw text saved", (Path(tdir) / RAW_DIR / "ams_3195.txt").read_text() == real)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            probe(tdir, now=T, fetched=(None, None, "AMS fetch failed: HTTP 403"))
        ck("probe: a failed fetch is a warning that names the error",
           "::warning::fert probe: AMS fetch failed: HTTP 403" in buf.getvalue())
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            probe(tdir, now=T, fetched=(b"%PDF-", rcut, None))
        ck("probe: a product not read is a warning naming it",
           "::warning::fert probe:" in buf.getvalue() and "not read: anhydrous" in buf.getvalue())

    if fails:
        print("selftest FAILED: %d" % len(fails))
        return 1
    print("selftest ok")
    return 0


def main(argv):
    if "--selftest" in argv:
        return selftest()
    if "--probe" in argv:
        return probe(ROOT)
    info = run(ROOT)
    print("[fert-ams] wrote=%s %s %s" % (info["wrote"], info.get("date") or "", info.get("products") or info.get("why")))
    for x in info["problems"]:
        print("  note:", x)
    if not info["wrote"]:
        print("::warning::USDA AMS fertilizer report not refreshed: %s" % info["why"])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
