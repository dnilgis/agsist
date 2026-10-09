#!/usr/bin/env python3
"""
read_wasde_pdf.py -- the U.S. corn, soybean and wheat balance sheets, read off
USDA's own WASDE PDF.

WHY THE PDF. fetch_wasde.py reads yields from NASS Quick Stats, and NASS has
no ending stocks, no WASDE production line for the new crop and no
season-average price. So on 2026-10-09 the WASDE watch graded the October
corn and soybean yields and nothing else, and the report-day email went out
with two lines. Every one of those figures is printed on two pages of the
WASDE itself (page 11 wheat, 12 corn, 15 soybeans), which usda.gov serves to
GitHub runners (fsa.usda.gov does not).

WHAT IT READS. For each crop, the current marketing year's projection: the
last "Proj." column, and the column before it when that column is the same
marketing year (last month's projection). Four rows: yield, production, ending
stocks, season-average farm price. Units as printed: bu/acre, million bushels,
$/bu. Nothing is rounded, converted or guessed here; board_metrics() does the
one unit change the estimates file asks for (corn stocks and production in
billion bushels) and says so.

WHAT IT REFUSES.
  * A PDF whose cover date is not the release being graded. A stale file in
    data/wasde-pdf/ must never grade a new report.
  * A row whose number count does not match the table's columns. pdftotext
    moves things when USDA moves things; a short row is a refusal, not a
    best guess.
  * A row under the wrong unit heading (production must sit under "Million
    Bushels").
  * Running without pdftotext. The 2026-10-09 fetch workflow did exactly that
    (poppler was never installed and `|| true` hid it). This exits 1 naming
    the package.

    python3 scripts/read_wasde_pdf.py data/wasde-pdf/wasde1026.pdf   print the table
    python3 scripts/read_wasde_pdf.py --json FILE.pdf                the same, as JSON
    python3 scripts/read_wasde_pdf.py --fetch [--date YYYY-MM-DD]    download this release's PDF
    python3 scripts/read_wasde_pdf.py --selftest                     needs pdftotext and the Oct 2026 PDF

Stdlib only, plus the pdftotext binary (poppler-utils).
"""
import json
import re
import shutil
import subprocess
import sys
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
PDF_DIR = ROOT / "data" / "wasde-pdf"
SAMPLE_PDF = PDF_DIR / "wasde1026.pdf"

# usda.gov answers GitHub runners; the second path is where USDA has also
# parked the file. Same two URLs .github/workflows/fetch-wasde-pdf.yml tries.
URLS = ("https://www.usda.gov/oce/commodity/wasde/wasde{mmyy}.pdf",
        "https://www.usda.gov/sites/default/files/documents/wasde{mmyy}.pdf")
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"

MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}

# Where each crop's table starts and stops in the -layout text. The anchor is
# the line the rows follow; the stop is the first line after them that is not
# part of the table.
TABLES = {
    "wheat": {"title": r"^\s*U\.S\. Wheat Supply and Use", "anchor": None,
              "stop": r"U\.S\. Wheat by Class"},
    "corn": {"title": r"^\s*U\.S\. Feed Grain and Corn Supply and Use", "anchor": r"^CORN\s*$",
             "stop": r"^Note:"},
    "soybeans": {"title": r"^\s*U\.S\. Soybeans and Products Supply and Use", "anchor": r"^SOYBEANS\s*$",
                 "stop": r"^SOYBEAN OIL"},
}

# row -> (label at the start of the line, the unit heading it must sit under, unit)
ROWS = {
    "yield": (r"Yield per Harvested Acre", "Bushels", "bu/acre"),
    "production": (r"Production", "Million Bushels", "mil bu"),
    "ending_stocks": (r"Ending Stocks", "Million Bushels", "mil bu"),
    "price": (r"Avg\. Farm Price \(\$/bu\)", None, "$/bu"),
}
UNIT_HEADINGS = ("Million Acres", "Bushels", "Million Bushels", "Metric Tons", "Million Metric Tons")

NUM = re.compile(r"(?<![\d/])-?\d{1,3}(?:,\d{3})*(?:\.\d+)?(?![\d/])")
FOOTNOTE = re.compile(r"\b\d+/")
YEAR_COL = re.compile(r"(\d{4}/\d{2})\s*(E\s?st\.|Proj\.)?")


class PdfRefused(Exception):
    """The PDF was read and something in it did not add up. Never a number."""


def pdftotext(pdf):
    exe = shutil.which("pdftotext")
    if not exe:
        raise PdfRefused("pdftotext is not installed (apt-get install poppler-utils). "
                         "Nothing was read.")
    r = subprocess.run([exe, "-layout", str(pdf), "-"], capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        raise PdfRefused("pdftotext failed on %s: %s" % (pdf, (r.stderr or "")[:200]))
    return r.stdout


def report_identity(text):
    """('WASDE-676', date(2026, 10, 9)) off the cover, or PdfRefused."""
    m = re.search(r"WASDE\s*-\s*(\d+)\s+Approved by the World Agricultural Outlook Board\s+"
                  r"([A-Z][a-z]+ \d{1,2}, \d{4})", text)
    if not m:
        raise PdfRefused("the cover line (WASDE number and release date) was not found")
    return "WASDE-" + m.group(1), datetime.strptime(m.group(2), "%B %d, %Y").date()


def _section(lines, spec):
    start = next((i for i, ln in enumerate(lines) if re.search(spec["title"], ln)), None)
    if start is None:
        raise PdfRefused("table not found: " + spec["title"])
    anchor = start
    if spec["anchor"]:
        anchor = next((i for i in range(start, min(start + 60, len(lines)))
                       if re.search(spec["anchor"], lines[i])), None)
        if anchor is None:
            raise PdfRefused("no %s block under %s" % (spec["anchor"], spec["title"]))
    stop = next((i for i in range(anchor + 1, len(lines)) if re.search(spec["stop"], lines[i])), None)
    if stop is None:
        raise PdfRefused("table end not found: " + spec["stop"])
    return anchor, stop


def _columns(lines, anchor):
    """The year columns nearest the anchor, e.g. ['2024/25', '2025/26 Est.', '2026/27 Proj.', '2026/27 Proj.']."""
    best = None
    for i in range(max(0, anchor - 14), min(len(lines), anchor + 6)):
        cols = YEAR_COL.findall(lines[i])
        if len(cols) >= 3 and any(t.startswith("Proj") for _, t in cols):
            if best is None or abs(i - anchor) < abs(best[0] - anchor):
                best = (i, cols)
    if not best:
        raise PdfRefused("no marketing-year header near line %d" % anchor)
    return best[0], [(y, t.replace(" ", "")) for y, t in best[1]]


def _month_labels(lines, frm, to):
    """The month names over the Proj. columns ('Sep', 'Oct'), first line that is only months."""
    for i in range(frm, min(to, frm + 12)):
        toks = lines[i].split()
        if toks and all(t[:3].lower() in MONTHS and t.isalpha() for t in toks):
            return [t[:3].title() for t in toks]
    return []


def read_table(lines, crop):
    spec = TABLES[crop]
    anchor, stop = _section(lines, spec)
    hdr_line, cols = _columns(lines, anchor)
    ncol = len(cols)
    proj = [i for i, (_, t) in enumerate(cols) if t == "Proj."]
    cur = ncol - 1
    if proj[-1] != cur:
        raise PdfRefused("%s: the last column is not a projection (%s)" % (crop, cols))
    my = cols[cur][0]
    prev = cur - 1 if (cur - 1) in proj and cols[cur - 1][0] == my else None
    months = _month_labels(lines, min(hdr_line, anchor), stop)
    want = 2 if prev is not None else 1
    if len(months) < want:
        raise PdfRefused("%s: month labels over the projection columns not found" % crop)
    months = months[-want:]

    out = {"marketing_year": my, "month": months[-1],
           "prev_month": months[0] if prev is not None else None}
    heading = None
    body_from = max(hdr_line, anchor) + 1
    for i in range(body_from, stop):
        ln = lines[i].strip()
        if ln in UNIT_HEADINGS:
            heading = ln
            continue
        for row, (label, unit_head, unit) in ROWS.items():
            if row in out or not re.match(label + r"(\s|$)", ln):
                continue
            nums = NUM.findall(FOOTNOTE.sub(" ", ln[re.match(label, ln).end():]))
            if len(nums) != ncol:
                raise PdfRefused("%s %s: %d numbers for %d columns: %r" % (crop, row, len(nums), ncol, ln))
            if unit_head and heading != unit_head:
                raise PdfRefused("%s %s sits under %r, expected %r" % (crop, row, heading, unit_head))
            # "1,849" stays a whole number, as the estimates file writes it; "4.70" is 4.7
            vals = [float(n.replace(",", "")) if "." in n else int(n.replace(",", "")) for n in nums]
            out[row] = {"value": vals[cur], "prev": vals[prev] if prev is not None else None, "unit": unit}
    missing = [r for r in ROWS if r not in out]
    if missing:
        raise PdfRefused("%s: rows not found: %s" % (crop, ", ".join(missing)))
    return out


def parse_text(text):
    report, rdate = report_identity(text)
    lines = text.splitlines()
    crops = {c: read_table(lines, c) for c in TABLES}
    for c, t in crops.items():
        if MONTHS[t["month"].lower()] != rdate.month:
            raise PdfRefused("%s: current column is %s, but the report is dated %s" % (c, t["month"], rdate))
    return {"report": report, "date": rdate.isoformat(), "crops": crops}


def parse_pdf(pdf):
    return parse_text(pdftotext(pdf))


# ── what the board calls these ────────────────────────────────────────────
# Keys and units follow data/analyst-estimates.json: corn_2627 is corn ending
# stocks in BILLION bushels, soy_2627 and wheat_2627 are in million. Production
# follows the same split, so a corn line always reads in billions. Yield keys
# are listed so fetch_wasde can cross-check NASS; NASS stays their source.
CROP_WORD = {"corn": "corn", "soybeans": "soybean", "wheat": "wheat"}
KEY_STEM = {"corn": "corn", "soybeans": "soy", "wheat": "wheat"}
ROW_KEY = {"ending_stocks": "", "production": "_prod", "price": "_price", "yield": "_yield"}
ROW_WORD = {"ending_stocks": "ending stocks", "production": "production",
            "price": "season-average farm price", "yield": "yield"}


def _billions(crop, row):
    return crop == "corn" and row in ("ending_stocks", "production")


def board_metrics(parsed):
    """Every figure as a board metric: {key: {key, label, value, prev, unit, row, crop}}."""
    out = {}
    for crop, t in parsed["crops"].items():
        yy = t["marketing_year"].replace("/", "")[2:]          # "2026/27" -> "2627"
        for row in ROWS:
            cell = t[row]
            key = KEY_STEM[crop] + ROW_KEY[row] + "_" + yy
            v, p, unit = cell["value"], cell["prev"], cell["unit"]
            if _billions(crop, row):
                v = round(v / 1000, 3)
                p = round(p / 1000, 3) if p is not None else None
                unit = "bil bu"
            out[key] = {"key": key, "label": "%s %s %s" % (t["marketing_year"], CROP_WORD[crop], ROW_WORD[row]),
                        "value": v, "prev": p, "unit": unit, "row": row, "crop": crop,
                        "column": "%s Proj. %s" % (t["marketing_year"], t["month"])}
    return out


# ── download ──────────────────────────────────────────────────────────────
def pdf_path(release):
    return PDF_DIR / ("wasde%s.pdf" % release.strftime("%m%y"))


def fetch(release, now=None, opener=None):
    """Save this release's PDF to data/wasde-pdf/. Returns (path or None, why).

    Asks scripts/usda_dates.py first: before 16:00 UTC on release day, or on a
    day that is not a WASDE, nothing is downloaded."""
    sys.path.insert(0, str(HERE))
    import usda_dates
    now = now or datetime.now(timezone.utc)
    if release not in usda_dates.WASDE_2026:
        return None, "%s is not a WASDE date in scripts/usda_dates.py" % release
    if release > now.date():
        return None, "%s has not happened" % release
    if release == now.date() and not usda_dates.wasde_results_are_public(release, now):
        return None, "not public yet (USDA prints at 16:00 UTC; it is %s)" % now.strftime("%H:%M")
    out = pdf_path(release)
    if out.exists():
        return out, "already on file"
    mmyy = release.strftime("%m%y")
    tried = []
    for u in URLS:
        url = u.format(mmyy=mmyy)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with (opener or urllib.request.urlopen)(req, timeout=120) as r:
                body = r.read()
        except Exception as ex:
            tried.append("%s -> %s" % (url, type(ex).__name__))
            continue
        if body[:4] != b"%PDF":
            tried.append("%s -> not a PDF (%d bytes)" % (url, len(body)))
            continue
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(body)
        return out, "downloaded %s (%d bytes)" % (url, len(body))
    return None, "no PDF yet: " + "; ".join(tried)


def table_text(parsed):
    L = ["%s, released %s" % (parsed["report"], parsed["date"])]
    for crop, t in parsed["crops"].items():
        L.append("  %s %s (current column %s, previous %s)"
                 % (crop, t["marketing_year"], t["month"], t["prev_month"] or "none"))
        for row in ROWS:
            c = t[row]
            L.append("    %-14s %10s   prev %10s   %s" % (row, c["value"], c["prev"], c["unit"]))
    return "\n".join(L)


def selftest():
    fails = []

    def check(cond, label, detail=""):
        print(("  ok    " if cond else "  FAIL  ") + label + ("" if cond else "  -- " + str(detail)))
        if not cond:
            fails.append(label)

    if not shutil.which("pdftotext"):
        print("FAIL pdftotext is not installed (apt-get install poppler-utils)")
        return 1
    print("THE OCTOBER 2026 WASDE (WASDE-676), every figure checked against the printed page")
    p = parse_pdf(SAMPLE_PDF)
    check(p["report"] == "WASDE-676" and p["date"] == "2026-10-09", "cover: WASDE-676, October 9, 2026", p["report"])
    want = {  # (value, previous month) as printed on pages 11, 12 and 15
        ("corn", "yield"): (181.2, 178.5), ("corn", "production"): (16034, 15800),
        ("corn", "ending_stocks"): (1849, 1567), ("corn", "price"): (4.70, 4.80),
        ("soybeans", "yield"): (53.1, 52.8), ("soybeans", "production"): (4562, 4535),
        ("soybeans", "ending_stocks"): (315, 310), ("soybeans", "price"): (12.00, 12.00),
        ("wheat", "yield"): (48.1, 47.8), ("wheat", "production"): (1534, 1531),
        ("wheat", "ending_stocks"): (740, 717), ("wheat", "price"): (6.30, 6.40),
    }
    for (crop, row), (v, pv) in want.items():
        c = p["crops"][crop][row]
        check((c["value"], c["prev"]) == (v, pv), "%s %s %s (Sep %s)" % (crop, row, v, pv),
              (c["value"], c["prev"]))
    for crop in TABLES:
        t = p["crops"][crop]
        check(t["marketing_year"] == "2026/27" and t["month"] == "Oct" and t["prev_month"] == "Sep",
              "%s reads the 2026/27 Oct column against Sep" % crop, t)

    print("\nBOARD KEYS AND UNITS MATCH data/analyst-estimates.json")
    b = board_metrics(p)
    check(b["corn_2627"]["value"] == 1.849 and b["corn_2627"]["unit"] == "bil bu"
          and b["corn_2627"]["prev"] == 1.567, "corn_2627 ending stocks 1.849 bil bu (Sep 1.567)", b["corn_2627"])
    check(b["soy_2627"]["value"] == 315 and b["soy_2627"]["unit"] == "mil bu", "soy_2627 315 mil bu", b["soy_2627"])
    check(b["wheat_2627"]["value"] == 740 and b["wheat_2627"]["label"] == "2026/27 wheat ending stocks",
          "wheat_2627 740 mil bu, labelled like the June block", b["wheat_2627"])
    check(b["corn_prod_2627"]["value"] == 16.034 and b["corn_prod_2627"]["unit"] == "bil bu",
          "corn production in billions, 16.034", b["corn_prod_2627"])
    check(b["corn_price_2627"]["value"] == 4.70 and b["corn_price_2627"]["unit"] == "$/bu",
          "corn price $4.70/bu", b["corn_price_2627"])
    check(b["corn_yield_2627"]["value"] == 181.2, "corn yield key matches NASS's corn_yield_2627")

    print("\nREFUSALS")
    text = pdftotext(SAMPLE_PDF)
    bad = text.replace("October 9, 2026", "November 10, 2026", 1)
    try:
        parse_text(bad)
        check(False, "a cover dated November with October columns is refused", "parsed")
    except PdfRefused as ex:
        check("Oct" in str(ex), "a cover dated November with October columns is refused", ex)
    short = re.sub(r"(Ending Stocks\s+1,551\s+2,095\s+1,567)\s+1,849", r"\1", text)
    try:
        parse_text(short)
        check(False, "a row missing a column is refused, not read off the wrong column", "parsed")
    except PdfRefused as ex:
        check("columns" in str(ex), "a row missing a column is refused, not read off the wrong column", ex)
    nocover = text.replace("Approved by the World Agricultural Outlook Board", "", 1)
    try:
        parse_text(nocover)
        check(False, "no cover line, no read", "parsed")
    except PdfRefused:
        check(True, "no cover line, no read")

    print("\nTHE DOWNLOAD WAITS FOR THE RELEASE")
    calls = []

    def opener(req, timeout=None):
        calls.append(req.full_url)
        raise OSError("should not be called")
    r, why = fetch(date(2026, 11, 10), now=datetime(2026, 11, 10, 15, 59, tzinfo=timezone.utc), opener=opener)
    check(r is None and "not public" in why and not calls, "15:59 UTC on release day: nothing asked", why)
    r, why = fetch(date(2026, 11, 11), now=datetime(2026, 11, 11, 17, 0, tzinfo=timezone.utc), opener=opener)
    check(r is None and "not a WASDE date" in why and not calls, "a day that is not a WASDE: nothing asked", why)
    r, why = fetch(date(2026, 11, 10), now=datetime(2026, 11, 9, 17, 0, tzinfo=timezone.utc), opener=opener)
    check(r is None and not calls, "tomorrow's report: nothing asked", why)
    r, why = fetch(date(2026, 10, 9), now=datetime(2026, 10, 9, 17, 0, tzinfo=timezone.utc), opener=opener)
    check(r == SAMPLE_PDF and not calls, "a PDF already on file is not downloaded again", why)

    print()
    if fails:
        print("FAILED (%d): %s" % (len(fails), "; ".join(fails)))
        return 1
    print("read_wasde_pdf: all passed")
    return 0


def main(argv):
    if "--selftest" in argv:
        return selftest()
    if "--fetch" in argv:
        now = datetime.now(timezone.utc)
        sys.path.insert(0, str(HERE))
        import usda_dates
        # Same default as fetch_wasde.py: today if it is a WASDE day, else the last one.
        rel = (date.fromisoformat(argv[argv.index("--date") + 1]) if "--date" in argv
               else (now.date() if now.date() in usda_dates.WASDE_2026
                     else usda_dates.prior_wasde(now.date()) or now.date()))
        path, why = fetch(rel, now)
        print("read_wasde_pdf --fetch %s: %s" % (rel, why))
        return 0
    files = [a for a in argv if not a.startswith("--")]
    if not files:
        print("usage: read_wasde_pdf.py [--json] FILE.pdf | --fetch [--date YYYY-MM-DD] | --selftest")
        return 2
    try:
        p = parse_pdf(files[0])
    except PdfRefused as ex:
        print("REFUSED: %s" % ex)
        return 1
    print(json.dumps(p, indent=1) if "--json" in argv else table_text(p))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
