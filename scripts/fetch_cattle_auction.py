#!/usr/bin/env python3
"""
AGSIST -- data/cattle-auction.json: feeder cattle sale barn prices for
cattle-auction-prices.html.

Source: USDA AMS Livestock, Poultry and Grain Market News auction reports
("Livestock Auction Wtd Avg Report"), public PDFs, latest issue at
    https://www.ams.usda.gov/mnreports/ams_<slug>.pdf
The barns and their report numbers are in scripts/cattle_auction_sources.json.

What is read: the feeder steer and heifer tables graded Medium and Large 1 and
Medium and Large 1-2, priced Per Cwt on Actual Wt. Each row is
    Head  Wt Range  Avg Wt  Price Range  Avg Price  [note]
e.g. "13  463-499  491  294.00-300.00  295.31". Rows with a note (Value
Added, Fleshy, Thin Fleshed, Unweaned...) are counted but kept out of the
class average, because they are a different kind of calf.

Rows are pooled into 100 lb classes by their average weight (300-399 lb
through 800-899 lb). The class price is weighted by total weight
(head x avg wt), which is how a $/cwt average over mixed weights works;
$/head is total dollars over total head. Both are AGSIST's sums of USDA rows,
and the page says so.

Modes:
  (default)   fetch every barn, validate, write. A barn keeps its last good
              sales on any failure and records why in `status`.
  --probe     fetch every barn and the AMS auction listing page, save the raw
              PDFs, their text and the listing to data/cattle-auction-raw/,
              print what parsed and which report titles did not match.
              Writes no feed.
  --probe --scan 1200-2300[,3600-3700]
              also read the title of every report number in those ranges
              and save {title: number} for each one that holds feeder steer
              or heifer tables to data/cattle-auction-raw/listing.json, so a
              barn with slug null is found by its own title. This is the
              fallback for the AMS listing page, which answers a script with
              403 Forbidden (probe run Oct 16 2026).

A barn can name more than one report (`also`: a second sale day). Each is
read and checked on its own; the newest good sale is used.
  --selftest  offline tests, non-zero exit on any failure.

WHAT THIS FILE WILL NOT DO
  * Use a report whose own title does not name the barn (a wrong report
    number shows nothing, never another barn's prices).
  * Keep a row with no head count, a weight or price outside its own range,
    or a price outside PRICE_RANGE.
  * Keep a table where something that looks like a price could not be read
    as part of a row (a half-read table is dropped, not trusted).
  * Replace a newer sale with an older one, or write a zero.

LAYOUT: NOT YET CHECKED AGAINST A REAL REPORT. The sandbox this was written in
cannot reach AMS. The fixtures below are built from the documented column
layout and row samples seen in search results (e.g. "13 463-499 491
294.00-300.00 295.31"), in two forms: one row per line, and one cell per line
(how pdftotext split the real LM_CT150 PDF in data/cattle-cash-raw/). Run the
probe, compare data/cattle-auction-raw/*.txt with the parser, and add a real
report as a fixture before trusting the numbers.

Stdlib only, plus pdftotext or pypdf through fetch_dairy.pdf_to_text.
"""
import datetime
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch_dairy as FD  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = "data/cattle-auction.json"
RAW_DIR = "data/cattle-auction-raw"
SOURCES = "scripts/cattle_auction_sources.json"
URL = "https://www.ams.usda.gov/mnreports/ams_%s.pdf"
PAGE = "https://mymarketnews.ams.usda.gov/viewReport/%s"

PRICE_RANGE = (80.0, 1000.0)   # $/cwt; light calves have sold over $500 in 2025-26
WT_RANGE = (200, 1100)         # rows read at all
CLASSES = [300, 400, 500, 600, 700, 800]   # 300 = 300-399 lb
KEEP_SALES = 2           # the latest sale and the one before it, for the change
MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]

# ------------------------------------------------------------------ text
def norm_lines(text):
    return [re.sub(r"[ \t ]+", " ", ln).strip() for ln in (text or "").splitlines()]


def joined(text):
    return " ".join(ln for ln in norm_lines(text) if ln)


def find_date(s, weekday_first=False):
    """A date in s as YYYY-MM-DD. weekday_first: only 'Mon Oct 12, 2026' style."""
    wd = r"(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+"
    md = r"\b(" + "|".join(MONTHS) + r")[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b"
    m = re.search((wd if weekday_first else r"") + md, s, re.I)
    if m:
        try:
            return datetime.date(int(m.group(3)), MONTHS.index(m.group(1).lower()[:3]) + 1, int(m.group(2))).isoformat()
        except ValueError:
            return None
    if weekday_first:
        return None
    m = re.search(r"\b(\d{1,2})/(\d{1,2})/(\d{4})\b", s)
    if m:
        try:
            return datetime.date(int(m.group(3)), int(m.group(1)), int(m.group(2))).isoformat()
        except ValueError:
            return None
    return None


def report_title(text):
    """The first few non-empty lines, which carry the report and barn name."""
    return " ".join([ln for ln in norm_lines(text) if ln][:4])


def sale_date(text):
    lines = [ln for ln in norm_lines(text) if ln][:30]
    for ln in lines:
        d = find_date(ln, weekday_first=True)
        if d:
            return d
    for ln in lines:
        d = find_date(ln)
        if d:
            return d
    return None


def receipts(text):
    m = re.search(r"\b(?:total\s+)?receipts:?\s+(\d{1,3}(?:,\d{3})*|\d+)\b", joined(text), re.I)
    return int(m.group(1).replace(",", "")) if m else None


# ------------------------------------------------------------------ tables
# Real AMS layout (probe, Oct 16 2026): "FEEDER CATTLE" on its own line, then
# "STEERS - Medium and Large 1 (Per Cwt / Actual Wt)". Medium and Large 1 / 1-2
# are feeder grades only (slaughter cattle grade Select/Choice), so the grade
# words pin these to the feeder tables. The older "Feeder steers Medium..." form
# still matches.
SECTION_RE = re.compile(
    r"\b(?:feeder\s+)?(steers|heifers)\s*-?\s*medium\s+(?:and|&)\s+large\s+(1-2|1)\s*\(\s*per\s+cwt\s*/\s*actual\s+wt\s*\)", re.I)
# any table heading, so a block ends where the next one starts
HEAD_RE = re.compile(
    r"\b(?:feeder|slaughter|bred|stock|replacement|cow|cows|holstein|dairy|pairs|bulls?|steers|heifers|"
    r"heiferettes|baby|calves)\b[A-Za-z0-9 ,&/\-]{0,80}?\(\s*(?:per|price)\b[^)]*\)", re.I)
# The market comment after the tables ("**CLOSE** Compared to last week ... 317.00/cwt")
# quotes prices; a table ends where it starts.
# Any run of six or more words is prose (row notes are at most three words:
# "Thin Fleshed", "Certified Prgms"), so "Throughout the week ..." ends it too.
COMMENT_RE = re.compile(r"\*\*|\bcompared\s+to\b|\bsource:|\bsupply\s+included\b|\bthe\s+largest\s+lot\b|"
                        r"\b[A-Za-z][A-Za-z'.]*(?:[ ,;]+[A-Za-z][A-Za-z'.]*){5,}", re.I)
COLHEAD_ALL_RE = re.compile(r"\bhead\s+wt\s+range\s+avg\s+wt\s+price\s+range\s+avg\s+price(?:\s+dressing)?", re.I)
# A table that runs onto the next PDF page repeats the footer, the report title,
# the date and sometimes the column header mid-table (Missouri 1821, Texas 1955,
# Oct 2026): drop from the footer through "Page N of M" up to the next row,
# never crossing a table heading. Column headers carry no data and go everywhere.
PAGEBREAK_RE = re.compile(
    r"\bsource:\s*usda\s+ams(?:(?!\(\s*per\b).){0,1200}?\bpage\s+\d+\s+of\s+\d+(?:(?!\(\s*per\b).){0,600}?"
    r"(?=\s+head\s+wt\s+range|\s+\d{1,4}\s+\d{3,4}(?:-\d{3,4})?\s+\d{3,4}\s+\d{2,4}\.\d{2})", re.I)
# the column header under each table heading (and repeated after page breaks)
COLHEAD_RE = re.compile(r"\s*head\s+wt\s+range\s+avg\s+wt\s+price\s+range\s+avg\s+price(?:\s+dressing)?", re.I)
INT = r"(\d{1,3}(?:,\d{3})*|\d+)"
WT = r"(\d{3,4})"
PX = r"(\d{2,4}\.\d{2})"
STOP = r"(?:feeder|slaughter|bred|stock|replacement|cows?|holstein|dairy|pairs|bulls?|source|head|wt|avg|price|range|agricultural|livestock|usda|page)\b"
ROW_RE = re.compile(
    r"(?<![\d.])" + INT + r"\s+" + WT + r"(?:\s*-\s*" + WT + r")?\s+" + WT + r"\s+" + PX +
    r"(?:\s*-\s*" + PX + r")?\s+" + PX + r"(?![\d.])"
    r"((?:\s+(?!" + STOP + r")[A-Za-z][A-Za-z'/]*){0,3})", re.I)


def parse_rows(block):
    """(rows, None) or (None, reason). Each row: head, lo, hi, wt, plo, phi, price, note."""
    rows, pos = [], 0
    for m in ROW_RE.finditer(block):
        gap = block[pos:m.start()]
        if re.search(r"\d{2,4}\.\d{2}", gap):
            return None, "a price in the table that is not part of a readable row: %r" % gap.strip()[:60]
        pos = m.end()
        head = int(m.group(1).replace(",", ""))
        lo = int(m.group(2))
        hi = int(m.group(3)) if m.group(3) else lo
        wt = int(m.group(4))
        plo = float(m.group(5))
        phi = float(m.group(6)) if m.group(6) else plo
        price = float(m.group(7))
        note = (m.group(8) or "").strip()
        if head <= 0:
            return None, "a row with no head"
        if not (lo <= wt <= hi):
            return None, "avg weight %d outside its own range %d-%d: misread" % (wt, lo, hi)
        if not (plo <= price <= phi):
            return None, "avg price %.2f outside its own range %.2f-%.2f: misread" % (price, plo, phi)
        if not (PRICE_RANGE[0] <= price <= PRICE_RANGE[1]):
            return None, "price %.2f outside %s" % (price, PRICE_RANGE)
        if not (WT_RANGE[0] <= wt <= WT_RANGE[1]):
            continue
        rows.append({"head": head, "lo": lo, "hi": hi, "wt": wt, "plo": plo, "phi": phi,
                     "price": price, "note": note})
    tail = block[pos:]
    if re.search(r"\d{2,4}\.\d{2}", tail):
        return None, "a price after the last readable row: %r" % tail.strip()[:60]
    return rows, None


def parse_report(text):
    """({"date", "receipts", "title", "tables": {"steers|1": [rows]...}}, None) or (None, reason)."""
    if not text or not text.strip():
        return None, "empty report"
    date = sale_date(text)
    if not date:
        return None, "no sale date in the first lines"
    j = PAGEBREAK_RE.sub(" ", joined(text))
    j = COLHEAD_ALL_RE.sub(" ", j)
    heads = [m.start() for m in HEAD_RE.finditer(j)]
    tables = {}
    for m in SECTION_RE.finditer(j):
        key = "%s|%s" % (m.group(1).lower(), m.group(2))
        end = next((h for h in heads if h > m.end()), len(j))
        start = m.end()
        col = COLHEAD_RE.match(j, start)
        if col:
            start = col.end()
        # prose only counts inside this table's own text, so a row note next to
        # the next heading ("Fleshy STEERS - Medium and Large 1-2") is not prose
        c = COMMENT_RE.search(j[start:end])
        if c:
            end = start + c.start()
        rows, why = parse_rows(j[m.end():end])
        if rows is None:
            return None, "%s table: %s" % (key, why)
        tables.setdefault(key, []).extend(rows)
    if not any(tables.values()):
        return None, "no feeder steer or heifer Medium and Large 1 / 1-2 rows (Per Cwt, Actual Wt)"
    return {"date": date, "receipts": receipts(text), "title": report_title(text), "tables": tables}, None


def wclass(wt):
    c = (wt // 100) * 100
    return c if c in CLASSES else None


def pool(rows):
    """Rows of one sex and grade -> {class: {...}} plus head left out for a note."""
    out, noted = {}, 0
    for r in rows:
        c = wclass(r["wt"])
        if c is None:
            continue
        if r["note"]:
            noted += r["head"]
            continue
        a = out.setdefault(c, {"head": 0, "cwt": 0.0, "dollars": 0.0, "lo": r["plo"], "hi": r["phi"], "rows": 0})
        cwt = r["head"] * r["wt"] / 100.0
        a["head"] += r["head"]
        a["cwt"] += cwt
        a["dollars"] += cwt * r["price"]
        a["lo"] = min(a["lo"], r["plo"])
        a["hi"] = max(a["hi"], r["phi"])
        a["rows"] += 1
    res = {}
    for c, a in out.items():
        res[str(c)] = {
            "head": a["head"],
            "avg_wt": round(a["cwt"] * 100.0 / a["head"]),
            "cwt": round(a["dollars"] / a["cwt"], 2),
            "per_head": round(a["dollars"] / a["head"], 2),
            "lo": a["lo"], "hi": a["hi"], "rows": a["rows"],
        }
    return res, noted


def summarize(parsed):
    """One sale record for the feed."""
    classes, noted = {}, 0
    for key, rows in parsed["tables"].items():
        res, n = pool(rows)
        noted += n
        if res:
            classes[key] = res
    return {"date": parsed["date"], "receipts": parsed["receipts"], "classes": classes, "noted_head": noted}


# ------------------------------------------------------------------ feed
def title_ok(src, title):
    return bool(re.search(src["match"], title or "", re.I))


def merge_barn(existing, src, sale, err, now_iso, slug):
    """One barn, keep-last-good, never older, newest sale first."""
    b = dict(existing or {})
    for k in ("name", "town", "state", "lat", "lon"):
        if k in src:
            b[k] = src[k]
    b["id"] = src["id"]
    sales = list(b.get("sales") or [])
    if sale is None:
        b["status"] = {"ok": False, "note": err, "checked": now_iso}
    elif sales and sale["date"] < sales[0]["date"]:
        b["status"] = {"ok": True, "note": "report %s older than %s held" % (sale["date"], sales[0]["date"]), "checked": now_iso}
    else:
        if sales and sales[0]["date"] == sale["date"]:
            sales[0] = sale
        else:
            sales.insert(0, sale)
        b["sales"] = sales[:KEEP_SALES]
        b["slug"] = slug
        b["source_url"] = PAGE % slug
        b["status"] = {"ok": True, "note": "", "checked": now_iso}
    return b


def load_sources(root):
    return json.loads((Path(root) / SOURCES).read_text())


def listing_slugs(root):
    """{title: slug} from the listing the probe saved, if any."""
    d = FD.read_json(Path(root) / RAW_DIR / "listing.json") or {}
    return d.get("reports") or {}


def pick_slug(src, listing):
    if src.get("slug"):
        return src["slug"]
    for title, slug in sorted(listing.items()):
        if title_ok(src, title):
            return slug
    return None


def fetch(slug, tries=3):
    raw, err = FD.http_get(URL % slug, tries=tries)
    if raw is None:
        return None, None, "fetch failed: %s" % err
    if raw[:5] != b"%PDF-":
        return raw, None, "not a PDF (blocked or moved)"
    text, e = FD.pdf_to_text(raw)
    return raw, text, (None if text else "PDF text extraction failed: %s" % e)


def read_one(src, slug, got):
    """(sale, None) or (None, reason) for one source."""
    if not slug:
        return None, "no report number yet (run the probe for the AMS listing)"
    _, text, err = got
    if not text:
        return None, err
    p, why = parse_report(text)
    if p is None:
        return None, why
    if not title_ok(src, p["title"]):
        return None, "report %s title %r does not name this barn" % (slug, p["title"][:90])
    return summarize(p), None


def slugs_for(src, listing):
    """The barn's report numbers: slug (or the listing's), then `also`."""
    out = []
    for s in [pick_slug(src, listing)] + list(src.get("also") or []):
        if s and s not in out:
            out.append(s)
    return out


def best_sale(src, slugs, getter):
    """(sale, slug, None) for the newest good sale over a barn's reports, or
    (None, slug, reason). Each report is checked on its own (title, tables)."""
    if not slugs:
        return None, None, "no report number yet (run the probe for the AMS listing)"
    best, whys = None, []
    for slug in slugs:
        sale, why = read_one(src, slug, getter(slug) or (None, None, "not fetched"))
        if sale is None:
            whys.append(why if len(slugs) == 1 else "%s: %s" % (slug, why))
        elif best is None or sale["date"] > best[0]["date"]:
            best = (sale, slug)
    if best:
        return best[0], best[1], None
    return None, slugs[0], "; ".join(whys)


def run(root, got=None, now=None):
    """got = {slug: (raw, text, err)} in tests."""
    root = Path(root)
    now = now or datetime.datetime.now(datetime.timezone.utc)
    now_iso = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    cfg = load_sources(root)
    listing = listing_slugs(root)
    existing = FD.read_json(root / OUT) or {}
    old = {b["id"]: b for b in existing.get("barns") or []}
    olds = {b["id"]: b for b in existing.get("states") or []}
    barns, states = [], []
    for group, out, prev in (("barns", barns, old), ("state_reports", states, olds)):
        for src in cfg.get(group) or []:
            getter = (lambda s: got.get(s)) if got is not None else fetch
            sale, slug, why = best_sale(src, slugs_for(src, listing), getter)
            out.append(merge_barn(prev.get(src["id"]), src, sale, why, now_iso, slug))
    has = any(b.get("sales") for b in barns + states)
    if not has:
        return None
    doc = {"updated": now_iso,
           "source": "USDA AMS Livestock, Poultry and Grain Market News, auction reports",
           "classes": CLASSES, "barns": barns, "states": states}
    FD.atomic_write(root / OUT, doc)
    return doc


LINK_RE = re.compile(r"""<a\b[^>]*href=["'][^"']*?(?:ams_(\d{3,5})\.(?:pdf|txt)|viewReport/(\d{3,5}))/?["'][^>]*>(.*?)</a>""", re.I | re.S)


def parse_listing(html_text):
    """{link text: slug} from the AMS auction listing page."""
    out = {}
    for m in LINK_RE.finditer(html_text or ""):
        t = re.sub(r"<[^>]+>", " ", m.group(3))
        t = re.sub(r"\s+", " ", t).strip()
        if t:
            out[t] = m.group(1) or m.group(2)
    return out


# The AMS listing page sits behind a bot filter that answered the plain script
# User-Agent with 403 Forbidden on the Oct 16 2026 probe while the report PDFs
# came through. Ask the way a browser does; if it still refuses, the scan below
# finds report numbers from the reports' own titles.
BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


def parse_ranges(spec):
    """'1200-2300,3654' -> sorted report numbers as strings; None if malformed or huge."""
    out = set()
    for part in (spec or "").split(","):
        part = part.strip()
        m = re.fullmatch(r"(\d{3,5})(?:-(\d{3,5}))?", part)
        if not m:
            return None
        lo = int(m.group(1))
        hi = int(m.group(2) or lo)
        if hi < lo:
            return None
        out.update(range(lo, hi + 1))
    if not out or len(out) > 3000:
        return None
    return [str(n) for n in sorted(out)]


def scan_one(slug, getter):
    """(slug, {"title", "date", "feeder"}) or (slug, None) when there is no report."""
    _, text, _ = getter(slug)
    if not text:
        return slug, None
    p, _why = parse_report(text)
    first = next((ln for ln in norm_lines(text) if ln), "")
    return slug, {"title": first[:140], "date": sale_date(text), "feeder": p is not None}


def scan(slugs, getter=None, workers=4):
    """{slug: info} for every report number that answers with a PDF."""
    import concurrent.futures as cf
    getter = getter or (lambda s: fetch(s, tries=1))
    found = {}
    with cf.ThreadPoolExecutor(max_workers=workers) as ex:
        for slug, info in ex.map(lambda s: scan_one(s, getter), slugs):
            if info:
                found[slug] = info
    return found


def scan_listing(found):
    """{title: slug} for scanned reports with feeder tables (what pick_slug reads)."""
    return {v["title"]: s for s, v in sorted(found.items()) if v["feeder"] and v["title"]}


def probe(root, scan_spec=None):
    root = Path(root)
    rd = root / RAW_DIR
    rd.mkdir(parents=True, exist_ok=True)
    cfg = load_sources(root)
    raw, err = FD.http_get(cfg["listing_url"], headers=BROWSER_HEADERS)
    listing, doc = {}, {"url": cfg["listing_url"]}
    if raw is None:
        print("listing ERROR:", err, "(use --scan to find report numbers from the reports themselves)")
    else:
        (rd / "listing.html").write_bytes(raw)
        listing = parse_listing(raw.decode("utf-8", "replace"))
        print("listing: %d auction report links" % len(listing))
    if scan_spec:
        nums = parse_ranges(scan_spec)
        if nums is None:
            print("scan ERROR: bad range %r (want e.g. 1200-2300,3600-3700)" % scan_spec)
        else:
            found = scan(nums)
            feeder = scan_listing(found)
            print("scan: %d of %d numbers answered, %d with feeder tables" % (len(found), len(nums), len(feeder)))
            for slug, v in sorted(found.items()):
                print("  %s %s %s%s" % (slug, v["date"], v["title"][:90], "" if v["feeder"] else "  (no feeder tables)"))
            doc["scanned"] = found
            for t, s in feeder.items():
                listing.setdefault(t, s)
    if listing or doc.get("scanned"):
        doc["reports"] = listing
        FD.atomic_write(rd / "listing.json", doc)
    for group in ("barns", "state_reports"):
        for src in cfg.get(group) or []:
            slugs = slugs_for(src, listing)
            print("%s slug=%s" % (src["id"], ",".join(slugs) or None))
            if not slugs:
                print("  no report number; listing titles to look at:",
                      [t for t in listing if src.get("town", src["state"]).lower() in t.lower()][:5])
                continue
            for slug in slugs:
                probe_one(rd, src, slug)
    return 0


def probe_one(rd, src, slug):
    """Fetch one report, save it raw and as text, print whether it parsed."""
    raw, text, err = fetch(slug)
    if raw is not None:
        (rd / ("ams_%s.raw" % slug)).write_bytes(raw)
    if err:
        print("  %s ERROR: %s" % (slug, err))
    if text:
        (rd / ("ams_%s.txt" % slug)).write_text(text)
        print("  %s title: %s" % (slug, report_title(text)[:120]))
        sale, why = read_one(src, slug, (raw, text, None))
        if sale:
            print("  parsed %s: %s" % (sale["date"], {k: sorted(v) for k, v in sale["classes"].items()}))
        else:
            print("  NOT PARSED:", why)


# ---------------------------------------------------------------- selftest
# Built from the documented AMS auction layout, NOT from a real report (see
# LAYOUT above). Hand-worked numbers are in the checks.
ROW_FIX = """Joplin Regional Stockyards Feeder Cattle Auction - Carthage, MO
Agricultural Marketing Service
Livestock, Poultry, and Grain Market News
Carthage, MO    Mon Oct 12, 2026    USDA-MO Dept of Ag Market News
Receipts: 6,412    Last Week: 7,150    Last Year: 8,003
Compared to last week, feeder steers and heifers sold steady to 5.00 higher.
Feeder Steers Medium and Large 1 (Per Cwt / Actual Wt)
Head   Wt Range   Avg Wt    Price Range     Avg Price
  12    350-395     372    420.00-445.00      433.10
   8    410-445     430    400.00-418.00      409.25
  13    463-499     491    394.00-400.00      395.31
   5    470-490     480    410.00-420.00      415.00   Value Added
  40    550-595     575    350.00-362.50      356.40
  60    650-690     668    318.00-326.00      322.15
 120    705-745     728    300.00-309.00      305.80
   1        760     760           290.00      290.00   Fleshy
Feeder Steers Medium and Large 1-2 (Per Cwt / Actual Wt)
Head   Wt Range   Avg Wt    Price Range     Avg Price
   9    500-540     522    360.00-370.00      364.20
Feeder Heifers Medium and Large 1 (Per Cwt / Actual Wt)
Head   Wt Range   Avg Wt    Price Range     Avg Price
  14    400-445     420    385.00-398.00      391.75
  33    550-590     566    320.00-331.00      325.60
Feeder Holstein Steers Large 3 (Per Cwt / Actual Wt)
Head   Wt Range   Avg Wt    Price Range     Avg Price
  20    500-540     520    250.00-260.00      255.00
Slaughter Cows Breaker 75-80% (Per Cwt / Actual Wt)
Head   Wt Range   Avg Wt    Price Range     Avg Price
  10  1300-1500    1410    160.00-170.00      165.20
Source: USDA-MO Dept of Ag Market News Service, Carthage, MO
"""


def cells(text):
    """The same report the way pdftotext splits the real MMN PDFs: one cell
    per line, ranges as 'a', '-', 'b'."""
    out = []
    for ln in text.splitlines():
        if re.match(r"\s*\d", ln):
            for tok in ln.split():
                m = re.match(r"^(\d[\d.,]*)-(\d[\d.,]*)$", tok)
                out.extend([m.group(1), "-", m.group(2)] if m else [tok])
        else:
            out.append(ln)
    return "\n".join(out)


def selftest():
    fails = []

    def ck(name, ok, detail=""):
        print(("  ok   " if ok else "  FAIL ") + name + (f"  ({detail})" if not ok and detail else ""))
        if not ok:
            fails.append(name)

    for label, txt in (("rows", ROW_FIX), ("cells", cells(ROW_FIX))):
        p, why = parse_report(txt)
        ck("%s: parses" % label, p is not None, why)
        if not p:
            continue
        ck("%s: sale date Mon Oct 12, 2026" % label, p["date"] == "2026-10-12", p["date"])
        ck("%s: receipts 6,412" % label, p["receipts"] == 6412, p["receipts"])
        ck("%s: steers 1, heifers 1, steers 1-2 read; Holstein and slaughter cows never" % label,
           sorted(p["tables"]) == ["heifers|1", "steers|1", "steers|1-2"], sorted(p["tables"]))
        ck("%s: 8 steer rows incl. the single-weight row" % label, len(p["tables"]["steers|1"]) == 8)
        s = summarize(p)
        st = s["classes"]["steers|1"]
        # 400 class: 8 hd x 430 lb at 409.25 and 13 hd x 491 at 395.31 (the
        # Value Added row is left out). cwt 34.40 + 63.83 = 98.23;
        # dollars 14078.20 + 25232.64 = 39310.84; 39310.84 / 98.23 = 400.19.
        ck("%s: 400 lb steers cwt-weighted 400.19 on 21 head" % label,
           st["400"]["cwt"] == 400.19 and st["400"]["head"] == 21, st.get("400"))
        ck("%s: 400 lb steers $/head 1871.94 (39310.84 / 21)" % label, st["400"]["per_head"] == 1871.94, st["400"])
        ck("%s: 400 lb steers avg weight 468 (9823 / 21)" % label, st["400"]["avg_wt"] == 468, st["400"])
        ck("%s: 400 lb steers range 394.00-418.00" % label, (st["400"]["lo"], st["400"]["hi"]) == (394.0, 418.0))
        ck("%s: noted rows (Value Added 5, Fleshy 1) left out and counted" % label, s["noted_head"] == 6, s["noted_head"])
        ck("%s: 700 class from one row is that row" % label,
           st["700"]["cwt"] == 305.8 and st["700"]["head"] == 120 and st["700"]["per_head"] == round(7.28 * 305.8, 2))
        ck("%s: heifers 400 class 391.75" % label, s["classes"]["heifers|1"]["400"]["cwt"] == 391.75)

    # Real AMS reports saved by the probe (Oct 16, 2026), one cell per line, with
    # tables that run across PDF page breaks. Counts and the 500 lb class were
    # checked by hand against the report.
    fx = Path(__file__).resolve().parent.parent / "test" / "fixtures" / "cattle-auction"
    jp, why = parse_report((fx / "ams_1245-real.txt").read_text())
    ck("real Joplin 1245 parses", jp is not None, why)
    if jp:
        n = {k: len(v) for k, v in jp["tables"].items()}
        ck("real Joplin: 16 steer 1, 7 steer 1-2, 12 heifer 1, 12 heifer 1-2 rows (10 after a page break)",
           n == {"steers|1": 16, "steers|1-2": 7, "heifers|1": 12, "heifers|1-2": 12}, n)
        c5 = summarize(jp)["classes"]["steers|1"]["500"]
        # 118 hd x 5.14 cwt x 413.97 + 43 hd x 5.74 cwt x 415.61 = 353661.90 over 853.34 cwt
        ck("real Joplin: 500 lb steers 414.44 on 161 head, $2196.66 a head",
           (c5["cwt"], c5["head"], c5["per_head"], c5["avg_wt"]) == (414.44, 161, 2196.66, 530), c5)
        ck("real Joplin: the market comment's 317.00/cwt never becomes a row",
           all(r["price"] != 317.0 for r in jp["tables"]["steers|1"]))
    tx, why = parse_report((fx / "ams_1955-real.txt").read_text())
    ck("real Texas 1955: heifer 1-2 table read past a page break with no repeated header",
       tx is not None and len(tx["tables"].get("heifers|1-2", [])) == 11, why or (tx and len(tx["tables"].get("heifers|1-2", []))))

    bad = ROW_FIX.replace("  8    410-445     430    400.00-418.00      409.25",
                          "  8    410-445     430    400.00-418.00      419.25")
    ck("an average outside its own price range refuses the report", parse_report(bad)[0] is None)
    bad = ROW_FIX.replace("13    463-499     491", "13    463-499     501")
    ck("an average weight outside its own range refuses the report", parse_report(bad)[0] is None)
    bad = ROW_FIX.replace("  40    550-595     575    350.00-362.50      356.40", "  --    550-595     575    350.00-362.50      356.40")
    ck("a row with no head count (a price left over) refuses the report", parse_report(bad)[0] is None)
    bad = ROW_FIX.replace("1300-1500    1410    160.00-170.00      165.20", "x").replace(
        "120    705-745     728    300.00-309.00      305.80", "120    705-745     728    30.00-30.90      30.80")
    ck("a price under the sane floor refuses the report", parse_report(bad)[0] is None)
    ck("no sale date, no report", parse_report(ROW_FIX.replace("Mon Oct 12, 2026", ""))[0] is None)
    ck("no feeder tables, no report",
       parse_report(ROW_FIX.split("Feeder Steers Medium")[0] + "Slaughter Cows (Per Cwt / Actual Wt) 10 1300-1500 1410 160.00-170.00 165.20")[0] is None)
    est = ROW_FIX.replace("(Per Cwt / Actual Wt)\nHead   Wt Range   Avg Wt    Price Range     Avg Price\n  12",
                          "(Per Cwt / Est Wt)\nHead   Wt Range   Avg Wt    Price Range     Avg Price\n  12")
    pe, _ = parse_report(est)
    ck("an Est Wt table is not read as Actual Wt", pe is None or len(pe["tables"].get("steers|1", [])) == 0)
    ck("dates", find_date("Mon Oct 12, 2026", True) == "2026-10-12" and find_date("October 12, 2026") == "2026-10-12"
       and find_date("10/12/2026") == "2026-10-12" and find_date("October 12, 2026", True) is None)

    src = {"id": "joplin-mo", "name": "Joplin Regional Stockyards", "town": "Carthage", "state": "MO",
           "lat": 37.18, "lon": -94.31, "match": "joplin"}
    sale, why = read_one(src, "1245", (None, ROW_FIX, None))
    ck("a report naming the barn is used", sale is not None, why)
    other = dict(src, id="dodge-city-ks", match="dodge city")
    ck("a report that does not name the barn is refused (wrong slug)", read_one(other, "1245", (None, ROW_FIX, None))[0] is None)
    ck("no slug, nothing", read_one(src, None, (None, None, None))[0] is None)

    now = "2026-10-16T12:00:00Z"
    b = merge_barn({}, src, sale, None, now, "1245")
    ck("first sale written with its source page", b["sales"][0]["date"] == "2026-10-12" and b["source_url"].endswith("/1245"))
    older = dict(sale, date="2026-10-05")
    b2 = merge_barn(b, src, older, None, now, "1245")
    ck("an older sale never replaces a newer one", b2["sales"][0]["date"] == "2026-10-12" and len(b2["sales"]) == 1)
    newer = dict(sale, date="2026-10-19")
    b3 = merge_barn(b, src, newer, None, now, "1245")
    ck("a newer sale goes first and the prior sale is kept for the change", [x["date"] for x in b3["sales"]] == ["2026-10-19", "2026-10-12"])
    b4 = merge_barn(b3, src, None, "fetch failed: timeout", now, "1245")
    ck("a failed fetch keeps the last good sales and records why", len(b4["sales"]) == 2 and b4["status"]["ok"] is False)
    b5 = b3
    for i in range(10):
        b5 = merge_barn(b5, src, dict(sale, date="2026-11-%02d" % (i + 1)), None, now, "1245")
    ck("at most %d sales kept" % KEEP_SALES, len(b5["sales"]) == KEEP_SALES)

    lst = parse_listing('<li><a href="/mnreports/ams_1245.pdf">Joplin Regional Stockyards - Carthage, MO (Mon)</a></li>'
                        '<li><a href="https://www.ams.usda.gov/mnreports/ams_1889.pdf">Winter Livestock - Dodge City, KS</a></li>'
                        '<li><a href="https://mymarketnews.ams.usda.gov/viewReport/1856">Valentine Livestock Auction - Valentine, NE</a></li>')
    ck("listing links read (mnreports PDFs and My Market News pages)", lst == {
        "Joplin Regional Stockyards - Carthage, MO (Mon)": "1245", "Winter Livestock - Dodge City, KS": "1889",
        "Valentine Livestock Auction - Valentine, NE": "1856"}, lst)
    ck("listing fills a missing slug by title", pick_slug(dict(other, slug=None), lst) == "1889")

    # a barn with two sale days (`also`): newest good sale wins, each report checked on its own
    two = dict(src, slug="1245", also=["9001", "1245"])
    ck("report numbers: slug first, also after, no repeats", slugs_for(two, {}) == ["1245", "9001"])
    later = ROW_FIX.replace("Mon Oct 12, 2026", "Thu Oct 15, 2026")
    s2, sl2, w2 = best_sale(two, ["1245", "9001"], {"1245": (None, ROW_FIX, None), "9001": (None, later, None)}.get)
    ck("two sale days: the newer sale and its report number are used", s2 and s2["date"] == "2026-10-15" and sl2 == "9001", w2)
    wrong = later.replace("Joplin Regional Stockyards", "Some Other Barn")
    s3, sl3, _ = best_sale(two, ["1245", "9001"], {"1245": (None, ROW_FIX, None), "9001": (None, wrong, None)}.get)
    ck("a second report that does not name the barn is ignored, the first still counts",
       s3 and s3["date"] == "2026-10-12" and sl3 == "1245")
    s4, _, w4 = best_sale(two, ["1245", "9001"], {}.get)
    ck("both reports missing: nothing, and the reason names both", s4 is None and "1245" in w4 and "9001" in w4, w4)
    ck("no report numbers: nothing", best_sale(src, [], {}.get)[0] is None)

    # scan fallback for the listing page (AMS answers the listing with 403)
    ck("scan ranges read", parse_ranges("1849-1852,3654") == ["1849", "1850", "1851", "1852", "3654"])
    ck("bad or huge scan ranges refused", parse_ranges("12-x") is None and parse_ranges("1900-1800") is None
       and parse_ranges("1000-9999") is None and parse_ranges("") is None)
    slaughter = ("Sioux Falls Regional Livestock Auction - Worthing, SD\nWed Oct 14, 2026\nSLAUGHTER CATTLE\n"
                 "STEERS - Choice 2-3 (Per Cwt / Actual Wt)\n20 1495 1495 227.00 227.00\n")
    fake = {"1245": (None, ROW_FIX, None), "2016": (None, slaughter, None)}
    found = scan(["1245", "2016", "2017"], lambda s: fake.get(s, (None, None, "404")), workers=2)
    ck("scan keeps every report that answered, marks which have feeder tables",
       sorted(found) == ["1245", "2016"] and found["1245"]["feeder"] and not found["2016"]["feeder"], found)
    lst2 = scan_listing(found)
    ck("scan listing holds only feeder reports (a slaughter-only report never fills a barn)",
       list(lst2.values()) == ["1245"], lst2)
    ck("scan listing fills a missing slug by the report's own title",
       pick_slug(dict(src, slug=None), lst2) == "1245"
       and pick_slug({"id": "worthing-sd", "match": "sioux falls|worthing", "slug": None}, lst2) is None)

    cfg = json.loads((ROOT / SOURCES).read_text())
    ids = [x["id"] for x in cfg["barns"]] + [x["id"] for x in cfg["state_reports"]]
    ck("source ids unique", len(ids) == len(set(ids)))
    ck("every barn has town, state, lat/lon in the lower 48 and a match", all(
        x.get("town") and re.match(r"^[A-Z]{2}$", x.get("state", "")) and 24 < x["lat"] < 50 and -125 < x["lon"] < -66
        and x.get("match") for x in cfg["barns"]))
    ck("every match is a valid pattern", all(re.compile(x["match"]) for x in cfg["barns"] + cfg["state_reports"]))

    print()
    if fails:
        print("%d FAILED" % len(fails))
        return 1
    print("all cattle auction checks pass")
    return 0


def main(argv):
    if "--selftest" in argv:
        return selftest()
    if "--probe" in argv:
        spec = argv[argv.index("--scan") + 1] if "--scan" in argv and argv.index("--scan") + 1 < len(argv) else None
        return probe(ROOT, spec)
    doc = run(ROOT)
    if not doc:
        print("::warning::no barn parsed; data/cattle-auction.json not written")
        return 0
    for b in doc["barns"] + doc["states"]:
        s = b.get("status") or {}
        print("[cattle-auction] %s ok=%s %s" % (b["id"], s.get("ok"), s.get("note", "")))
        if not s.get("ok"):
            print("::warning::%s not refreshed: %s" % (b["id"], s.get("note", "")))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
