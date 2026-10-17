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
    for k in ("name", "town", "state", "lat", "lon", "label"):
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


def run(root, got=None, now=None, own_got=None):
    """got = {slug: (raw, text, err)} in tests; own_got = a stand-in for own_fetch."""
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
    own = run_own(cfg, existing, now_iso, own_got)
    doc = {"updated": now_iso,
           "source": "USDA AMS Livestock, Poultry and Grain Market News, auction reports",
           "classes": CLASSES, "barns": barns, "states": states, "own": own}
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
    probe_own(rd, cfg)
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


# ------------------------------------------------------- barns' own reports
# Barns USDA AMS does not report (`own_reports` in the sources: no Wisconsin
# or Minnesota barn is on the AMS feeder auction listing, Oct 16 2026) post
# their own market report. These give a $/cwt low-high for a weight range
# ("Beef Steers 400 to 600 lbs 300-415"), not USDA's head-weighted averages,
# so they are kept apart as `ranges` and the page says the barn posted them.
#
# Each layout has its own reader (`parser` in the sources), written against the
# probe's saved copies (raw branch, Oct 17 2026; fixtures in
# test/fixtures/cattle-auction/own-*.html with the URL and fetch date on top):
#   equity     Equity Cooperative market pages ("Beef Steers 400 to 600 lbs  300-415")
#   premier    Premier Livestock & Auctions, Withee ("Beef Str 400#-600# – 310-470")
#   lanesboro  Lanesboro Sales Commission ("300-500LB STEERS 395.00 To 555.00 CWT")
# A source is read in the normal run only when `parser_checked` is true, which
# is set by hand after the numbers were checked against the saved copy.
# What a reader keeps: beef steer and heifer rows with a closed weight range
# (no "under 400" or "over 800"), a low-high price, a sale date it can tie to
# the feeder table. "NT", "& down", "Up to" rows are left out (no range posted).
# Anything else it cannot read refuses the whole report.
OWN_KINDS = ("equity", "premier", "lanesboro")
FILE_DATE_RE = re.compile(r"(20\d\d)[.\-_](\d{1,2})[.\-_](\d{1,2})")
OWN_MAX_AGE = 45            # days; an older newest report is not shown as current
NO_RANGE_RE = re.compile(r"^(?:n\.?\s?t\.?|no test|none|light test|call\b.*|up to\b.*|below\b.*|"
                         r"\$?\d[\d,]*(?:\.\d+)?\s*(?:&|and)\s*(?:down|up|under|less)\b.*)?$", re.I)
PX_PAIR_RE = re.compile(r"^\$?(\d{2,4}(?:\.\d{1,2})?)\s*(?:-|–|—|to)\s*\$?(\d{2,4}(?:\.\d{1,2})?)$", re.I)
EQ_ROW_RE = re.compile(
    r"^(beef|holstein|crossbred|cross\s?bred|dairy(?:\s+beef)?(?:\s+cross)?)\s+(steers?|heifers?)\s+"
    r"(?:(\d{3,4})\s*(?:-|–|to)\s*(\d{3,4})|(?:under|over)\s+\d{3,4})\s*(?:lbs?\.?|#)\s*(.*)$", re.I)
PR_ROW_RE = re.compile(r"^(beef|holstein|dairy beef x)\s+(str|hfr|str/hfr)\s+(\d{3,4})#\s*-\s*(\d{3,4})#\s*[–—-]\s*(.*)$", re.I)
LB_ROW_RE = re.compile(r"\b(\d{3,4})-(\d{3,4})\s*LB\s+(STEERS|HEIFERS)\s+(\S+)\s+To\s+(\S+)", re.I)
WD = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
LOOSE_DATE_RE = re.compile(
    r"(?:\b(?P<wd>mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+)?"
    r"(?:\b(?P<mn>" + "|".join(MONTHS) + r")[a-z]*\.?\s+(?P<d1>\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(?P<y1>20\d\d)\b)?"
    r"|(?<![\d/.])(?P<m2>\d{1,2})/(?P<d2>\d{1,2})(?:/(?P<y2>(?:20)?\d\d))?(?![\d/]))", re.I)


def html_text(raw):
    """HTML bytes or str -> text with one table row, paragraph or line break per line.
    Inline tags go without a space, so '400 to 50</span><span>0 lbs' reads 500."""
    import html as H
    s = raw.decode("utf-8", "replace") if isinstance(raw, bytes) else (raw or "")
    s = re.sub(r"(?is)<(script|style|noscript)\b.*?</\1>", " ", s)
    s = re.sub(r"(?s)<!--.*?-->", " ", s)
    s = re.sub(r"(?i)<br\s*/?>|</(p|tr|li|div|h\d|table|ul|ol)>", "\n", s)
    s = re.sub(r"(?i)</t[dh]>", " ", s)
    s = re.sub(r"(?i)</?(span|font|strong|b|i|em|u|a|sup|sub|small)\b[^>]*>", "", s)
    s = re.sub(r"<[^>]+>", " ", s)
    return H.unescape(s)


def file_date(url):
    """'.../2026.10.2-Market-Report.pdf' or '.../2026-10-12-mr.pdf' -> ISO date, else None."""
    m = FILE_DATE_RE.search(url or "")
    if not m:
        return None
    try:
        return datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3))).isoformat()
    except ValueError:
        return None


def loose_dates(s, ref):
    """Dates in s as [(start, end, date or None, is_next)]. A missing year is the
    latest year that puts the date on or before ref (+1 day) and no more than
    200 days back, else None; a weekday that does
    not match gives None. is_next: the word 'next' stands between the previous
    date (or the start) and this one ('Next Sale is on November 5th')."""
    out, prev_end = [], 0
    for m in LOOSE_DATE_RE.finditer(s):
        if m.group("mn"):
            mo, d, y = MONTHS.index(m.group("mn").lower()[:3]) + 1, int(m.group("d1")), m.group("y1")
        else:
            mo, d, y = int(m.group("m2")), int(m.group("d2")), m.group("y2")
        dt = None
        try:
            if y:
                dt = datetime.date(int(y) if len(y) == 4 else 2000 + int(y), mo, d)
            else:
                for yy in (ref.year, ref.year - 1):
                    c = datetime.date(yy, mo, d)
                    if c <= ref + datetime.timedelta(days=1):
                        # a yearless date months back is more likely a coming sale than last year's
                        dt = c if (ref - c).days <= 200 else None
                        break
        except ValueError:
            dt = None
        if dt and m.group("wd") and WD[dt.weekday()] != m.group("wd").lower()[:3]:
            dt = None
        out.append((m.start(), m.end(), dt, bool(re.search(r"\bnext\b", s[prev_end:m.start()], re.I))))
        prev_end = m.end()
    return out


def _ref(today):
    if isinstance(today, datetime.date):
        return today
    return datetime.date.fromisoformat(today) if today else datetime.datetime.now(datetime.timezone.utc).date()


def _price(sex, lo, hi, cell, line):
    """(range dict, None) | (None, None) for a no-range cell | (None, reason)."""
    cell = cell.strip().rstrip(".").strip()
    m = PX_PAIR_RE.match(cell)
    if not m:
        if NO_RANGE_RE.match(cell):
            return None, None
        return None, "a %s line with no readable price: %r" % (sex, line[:70])
    plo, phi = float(m.group(1)), float(m.group(2))
    if not (WT_RANGE[0] <= lo < hi <= WT_RANGE[1] and hi - lo <= 300):
        return None, "weight range %d-%d not a feeder class: %r" % (lo, hi, line[:70])
    if not (plo <= phi and PRICE_RANGE[0] <= plo and phi <= PRICE_RANGE[1]):
        return None, "price %s-%s outside %s or backwards: %r" % (plo, phi, PRICE_RANGE, line[:70])
    return {"sex": sex, "lo": lo, "hi": hi, "plo": plo, "phi": phi}, None


def _sex(word):
    return "steers" if word.lower().startswith("st") else "heifers"


def _check_date(dt, ref):
    if dt is None:
        return "no sale date tied to the feeder prices"
    if dt > ref + datetime.timedelta(days=1):
        return "sale date %s is after the read date %s" % (dt, ref)
    if (ref - dt).days > OWN_MAX_AGE:
        return "newest report is %s, over %d days old" % (dt, OWN_MAX_AGE)
    return None


def parse_equity(text, ref):
    """Equity Cooperative market page. The feeder table's own date ('Date: 10/02/2026
    325 Head', 'Saturday, September 26', 'October 15th Results'; never a 'Next
    sale' date), else the page's 'As of' date. Head only from the dated line."""
    lines = [ln for ln in norm_lines(text) if ln]
    rows, first, out = [], None, []
    for i, ln in enumerate(lines):
        m = EQ_ROW_RE.match(ln)
        if not m:
            continue
        if first is None:
            first = i
        if m.group(1).lower() != "beef" or not m.group(3):
            continue
        sex, lo, hi = _sex(m.group(2)), int(m.group(3)), int(m.group(4))
        r, why = _price(sex, lo, hi, m.group(5), ln)
        if why:
            return None, why
        if r and r not in out:
            out.append(r)
    if not out:
        return None, "no beef steer or heifer weight range with a $/cwt range"
    head = max([i for i in range(first) if re.match(r"^feeder cattle\b", lines[i], re.I)] or [-1])
    if head < 0:
        return None, "no Feeder Cattle heading above the price rows"
    # the heading down to the first row as one string, so a 'Next sale' on one
    # line still marks the date on the next; head only from the dated line's rest
    win = " | ".join(lines[head:first])
    dated, rec = [], None
    for _s, e, dt, nxt in loose_dates(win, ref):
        if nxt:
            continue
        if dt is None:
            return None, "a feeder date that does not check out: %r" % win[max(0, _s - 30):e + 10]
        dated.append(dt)
        m = re.match(r"[^|]*?\b(\d{1,3}(?:,\d{3})+|\d{1,5})\s+head\b", win[e:], re.I)
        if m:
            rec = int(m.group(1).replace(",", ""))
    if len(set(dated)) > 1:
        return None, "two dates over the feeder table: %s" % sorted(set(dated))
    dt = dated[0] if dated else None
    if dt is None:
        for ln in lines:
            if re.search(r"\bas of\b", ln, re.I):
                ds = [x for x in loose_dates(ln, ref) if not x[3]]
                if ds and ds[0][2]:
                    dt = ds[0][2]
                break
    why = _check_date(dt, ref)
    if why:
        return None, why
    return {"date": dt.isoformat(), "receipts": rec, "ranges": sorted(out, key=lambda r: (r["sex"], r["lo"]))}, None


def parse_premier(text, ref):
    """Premier Livestock & Auctions market page. Feeder 'Date: 10-6 and 10-13-2026'
    (two sales in one report: the later is the date, the note says so); head from
    '835 head sold on 10-6 and 245 head sold on 10-13' when those dates match."""
    lines = [ln for ln in norm_lines(text) if ln]
    out, dline = [], None
    for ln in lines:
        if dline is None and re.match(r"^date:\s*\d", ln, re.I):
            dline = ln
        m = PR_ROW_RE.match(ln)
        if not m:
            continue
        if m.group(1).lower() != "beef" or m.group(2).lower() == "str/hfr":
            continue
        r, why = _price(_sex(m.group(2)), int(m.group(3)), int(m.group(4)), m.group(5), ln)
        if why:
            return None, why
        if r and r not in out:
            out.append(r)
    if not out:
        return None, "no beef steer or heifer weight range with a $/cwt range"
    if not dline:
        return None, "no feeder Date: line"
    ds = re.findall(r"(?<!\d)(\d{1,2})-(\d{1,2})(?:-(20\d\d))?(?!\d)", dline)
    years = [y for _m, _d, y in ds if y]
    if not ds or len(set(years)) != 1:
        return None, "feeder date line not read: %r" % dline[:70]
    try:
        dates = sorted({datetime.date(int(years[0]), int(mo), int(d)) for mo, d, _y in ds})
    except ValueError:
        return None, "feeder date line not read: %r" % dline[:70]
    dt = dates[-1]
    why = _check_date(dt, ref)
    if why:
        return None, why
    if (dates[-1] - dates[0]).days > 21:
        return None, "feeder dates too far apart for one report: %r" % dline[:70]
    heads = {}
    for n, mo, d in re.findall(r"(\d{1,3}(?:,\d{3})*|\d+)\s+head sold on (\d{1,2})-(\d{1,2})\b", joined(text), re.I):
        try:
            heads[datetime.date(dt.year, int(mo), int(d))] = int(n.replace(",", ""))
        except ValueError:
            pass
    rec = sum(heads.values()) if set(heads) == set(dates) else None
    sale = {"date": dt.isoformat(), "receipts": rec, "ranges": sorted(out, key=lambda r: (r["sex"], r["lo"]))}
    if len(dates) > 1:
        sale["note"] = "One report for the %s sales%s" % (
            " and ".join(x.strftime("%b ") + str(x.day) for x in dates),
            " (%s head)" % " and ".join("{:,}".format(heads[x]) for x in dates) if rec else "")
    return sale, None


def parse_lanesboro(text, ref):
    """Lanesboro Sales Commission feeder page: 'Market Reports October 9th 2026
    1722 Head Sold', then '300-500LB STEERS 395.00 To 555.00 CWT' (one cell a line)."""
    s = joined(text)
    m = re.search(r"\bMarket Reports\s+(" + "|".join(MONTHS) + r")[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d\d)\s+"
                  r"(\d{1,3}(?:,\d{3})*|\d+)\s+Head Sold\b", s, re.I)
    if not m:
        return None, "no 'Market Reports <date> <n> Head Sold' line"
    try:
        dt = datetime.date(int(m.group(3)), MONTHS.index(m.group(1).lower()[:3]) + 1, int(m.group(2)))
    except ValueError:
        return None, "sale date not read"
    why = _check_date(dt, ref)
    if why:
        return None, why
    out = []
    for r in LB_ROW_RE.finditer(s, m.end()):
        lo, hi, sex = int(r.group(1)), int(r.group(2)), _sex(r.group(3))
        a, b = r.group(4), re.sub(r"(?i)cwt$", "", r.group(5))
        if a.upper() == "UP" or b in ("#", ""):
            continue
        rr, why = _price(sex, lo, hi, a + "-" + b, r.group(0))
        if why:
            return None, why
        if rr and rr not in out:
            out.append(rr)
    if not out:
        return None, "no steer or heifer weight range with a $/cwt range"
    return {"date": dt.isoformat(), "receipts": int(m.group(4).replace(",", "")),
            "ranges": sorted(out, key=lambda r: (r["sex"], r["lo"]))}, None


def parse_own(text, kind, today=None):
    """A barn's own report -> ({"date", "receipts", "ranges"[, "note"]}, None) or (None, reason).
    kind = the source's `parser`; today = the read date (dates without a year, age check)."""
    fn = {"equity": parse_equity, "premier": parse_premier, "lanesboro": parse_lanesboro}.get(kind)
    if not fn:
        return None, "no reader for layout %r" % kind
    return fn(text or "", _ref(today))


PDF_A_RE = re.compile(r"""<a\b[^>]*href=["']([^"']+\.pdf)["'][^>]*>(.*?)</a>""", re.I | re.S)


def newest_pdf(page_url, html_raw, today=None):
    """(date, url) of the newest cattle market report PDF linked from a barn's page, or None.
    The date is the link's own text ('October 12th, 2026 Market Report', 'CATTLE OCTOBER
    15, 2026'), else the file name's; hay, sheep, goat and horse reports never."""
    from urllib.parse import urljoin
    s = html_raw.decode("utf-8", "replace") if isinstance(html_raw, bytes) else (html_raw or "")
    ref = _ref(today)
    best = None
    for m in PDF_A_RE.finditer(s):
        u = urljoin(page_url, m.group(1))
        label = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", m.group(2))).strip()
        if re.search(r"\b(hay|straw|sheep|goats?|horses?|tack|machinery)\b", label + " " + u, re.I):
            continue
        if not re.search(r"market[-_ ]?report|\bcattle\b|-mr\d*\.pdf$", label + " " + u, re.I):
            continue
        d = None
        for _s, _e, dt, _n in loose_dates(label, ref):
            if dt and re.search(r"20\d\d", label):
                d = dt.isoformat()
                break
        d = d or file_date(u)
        if d and (best is None or d > best[0]):
            best = (d, u)
    return best


def own_fetch(src, tries=3):
    """(text, url, raws, None) or (None, None, raws, reason). raws = [(name, bytes)]."""
    raws = []
    raw, err = FD.http_get(src["site"], headers=BROWSER_HEADERS, tries=tries)
    if raw is None:
        return None, None, raws, "fetch failed: %s" % err
    raws.append(("own_%s.html" % src["id"], raw))
    pdf = newest_pdf(src["site"], raw)
    if not pdf:
        return html_text(raw), src["site"], raws, None
    praw, perr = FD.http_get(pdf[1], headers=BROWSER_HEADERS, tries=tries)
    if praw is None or praw[:5] != b"%PDF-":
        return None, None, raws, "report PDF %s: %s" % (pdf[1], perr or "not a PDF")
    raws.append(("own_%s.pdf" % src["id"], praw))
    text, e = FD.pdf_to_text(praw)
    if not text:
        return None, None, raws, "PDF text extraction failed: %s" % e
    return text, pdf[1], raws, None


def merge_own(existing, src, sale, err, now_iso, url):
    """One own-report barn for the feed. No sale unless its parser is checked."""
    b = {k: src[k] for k in ("id", "name", "town", "state", "lat", "lon", "sale") if k in src}
    if src.get("site") and not src.get("check"):
        b["site"] = src["site"]
    sales = list((existing or {}).get("sales") or []) if src.get("parser_checked") else []
    if sale is not None and (not sales or sale["date"] >= sales[0]["date"]):
        sales = [dict(sale, source_url=url)] + [s for s in sales if s["date"] != sale["date"]]
    if sales:
        b["sales"] = sales[:KEEP_SALES]
    b["status"] = {"ok": sale is not None, "note": err or "", "checked": now_iso}
    return b


def run_own(cfg, existing, now_iso, getter=None):
    old = {b["id"]: b for b in existing.get("own") or []}
    today = now_iso[:10]
    out = []
    for src in cfg.get("own_reports") or []:
        sale, err, url = None, None, None
        if not (src.get("parser") in OWN_KINDS and src.get("parser_checked")):
            err = "needs first read"
        else:
            text, url, _raws, err = (getter or own_fetch)(src)
            if text:
                sale, err = parse_own(text, src["parser"], today)
        out.append(merge_own(old.get(src["id"]), src, sale, err, now_iso, url))
    return out


def probe_own(rd, cfg):
    for src in cfg.get("own_reports") or []:
        text, url, raws, err = own_fetch(src)
        for name, raw in raws:
            (rd / name).write_bytes(raw)
        print("%s own report %s" % (src["id"], url or src["site"]))
        if err:
            print("  ERROR:", err)
            continue
        (rd / ("own_%s.txt" % src["id"])).write_text(text)
        if src.get("parser") not in OWN_KINDS:
            print("  no reader yet (parser %r)" % src.get("parser"))
            continue
        p, why = parse_own(text, src["parser"])
        print("  parsed %s: %d ranges" % (p["date"], len(p["ranges"])) if p else "  NOT PARSED: %s" % why)


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

    # barns' own reports (parse_own): fixtures put together from lines search
    # results quoted, NOT saved reports (see the fixture headers)
    pl = "\n".join(ln for ln in (fx / "own-premier-lines.txt").read_text().splitlines() if not ln.startswith("#"))
    ck("own report: 'Oct 12-15, 2026' is no single sale date, so no hint means no report", parse_own(pl)[0] is None)
    po, why = parse_own(pl, "2026-10-15")
    ck("own Premier lines parse with the PDF's file date", po is not None, why)
    if po:
        ck("own Premier: beef steers 200-400 375-600 and 400-600 310-470, heifers 400-600 300-430; fed, cows, calves, Holsteins never",
           po["ranges"] == [{"sex": "heifers", "lo": 400, "hi": 600, "plo": 300.0, "phi": 430.0},
                            {"sex": "steers", "lo": 200, "hi": 400, "plo": 375.0, "phi": 600.0},
                            {"sex": "steers", "lo": 400, "hi": 600, "plo": 310.0, "phi": 470.0}], po["ranges"])
        ck("own Premier: 3,545 head", po["receipts"] == 3545, po["receipts"])
    eq, why = parse_own(html_text((fx / "own-equity-lines.html").read_text()))
    ck("own Equity table parses, sale date 9/23/26", eq is not None and eq["date"] == "2026-09-23", why or eq["date"])
    if eq:
        ck("own Equity: 3 steer and 2 heifer ranges under their headings, the Holstein table and the script never",
           [(r["sex"], r["lo"], r["plo"], r["phi"]) for r in eq["ranges"]] ==
           [("heifers", 300, 380.0, 442.5), ("heifers", 400, 296.0, 410.0), ("steers", 300, 400.0, 465.0),
            ("steers", 400, 360.0, 440.0), ("steers", 600, 330.0, 372.5)], eq["ranges"])
        ck("own Equity: 665 head", eq["receipts"] == 665, eq["receipts"])
    ck("own: an unreadable price on a steer line refuses the report",
       parse_own(pl.replace("310-470", "31O-470"), "2026-10-15")[0] is None)
    ck("own: a price outside the sane range refuses the report",
       parse_own(pl.replace("310-470", "3100-4700"), "2026-10-15")[0] is None)
    ck("own: a backwards price range refuses the report",
       parse_own(pl.replace("310-470", "470-310"), "2026-10-15")[0] is None)
    ck("own: a weight range that is no feeder class refuses the report",
       parse_own(pl.replace("400#-600# – 310", "600#-400# – 310"), "2026-10-15")[0] is None)
    ck("own: no steer or heifer range, no report", parse_own("Oct 14, 2026\nMarket cows 120-135\n")[0] is None)
    page = ('<a href="/wp-content/uploads/2026/10/2026.10.9-Market-Report.pdf">old</a>'
            '<a href="https://premierlivestockandauctions.com/wp-content/uploads/2026/10/2026.10.16-Market-Report.pdf">new</a>'
            '<a href="/wp-content/uploads/2026/10/sale-flyer.pdf">flyer</a>')
    ck("own: the newest dated market report PDF on the page is the one read",
       newest_pdf("https://premierlivestockandauctions.com/market-reports/", page) ==
       ("2026-10-16", "https://premierlivestockandauctions.com/wp-content/uploads/2026/10/2026.10.16-Market-Report.pdf"))
    ck("own: a page with no dated report PDF is read as the page", newest_pdf("https://x.org/", "<a href='/a.pdf'>a</a>") is None)
    cfgo = {"own_reports": [
        {"id": "a-wi", "name": "A", "town": "A", "state": "WI", "lat": 44, "lon": -90, "sale": "Tue", "site": "https://a.org/r", "parser": "ranges", "parser_checked": False},
        {"id": "b-mn", "name": "B", "town": "B", "state": "MN", "lat": 44, "lon": -93, "sale": "Mon", "site": "https://b.org/", "check": True},
        {"id": "c-wi", "name": "C", "town": "C", "state": "WI", "lat": 44, "lon": -91, "sale": "Wed", "site": "https://c.org/r", "parser": "ranges", "parser_checked": True}]}
    calls = []
    def og(src):
        calls.append(src["id"])
        return pl, "2026-10-15", "https://c.org/r.pdf", [], None
    own = run_own(cfgo, {"own": [{"id": "a-wi", "sales": [{"date": "2026-10-01", "ranges": [{"sex": "steers"}]}]}]}, now, og)
    ck("own: only a source with a checked parser is fetched", calls == ["c-wi"], calls)
    ck("own: an unchecked parser shows no numbers, even ones left in the old feed, and says needs first read",
       "sales" not in own[0] and own[0]["status"]["note"] == "needs first read", own[0])
    ck("own: a site seen in one place only is not linked", "site" not in own[1] and own[0]["site"] == "https://a.org/r")
    ck("own: a checked parser's sale carries its report link", own[2]["sales"][0]["date"] == "2026-10-15"
       and own[2]["sales"][0]["source_url"] == "https://c.org/r.pdf" and own[2]["status"]["ok"])
    own2 = run_own(cfgo, {"own": own}, now, lambda src: (None, None, None, [], "fetch failed: 403"))
    ck("own: a failed fetch keeps the last good sale and records why",
       own2[2]["sales"][0]["date"] == "2026-10-15" and own2[2]["status"]["note"] == "fetch failed: 403")

    cfg = json.loads((ROOT / SOURCES).read_text())
    ids = [x["id"] for x in cfg["barns"]] + [x["id"] for x in cfg["state_reports"]]
    ck("source ids unique", len(ids) == len(set(ids)))
    ck("every barn has town, state, lat/lon in the lower 48 and a match", all(
        x.get("town") and re.match(r"^[A-Z]{2}$", x.get("state", "")) and 24 < x["lat"] < 50 and -125 < x["lon"] < -66
        and x.get("match") for x in cfg["barns"]))
    ck("every match is a valid pattern", all(re.compile(x["match"]) for x in cfg["barns"] + cfg["state_reports"]))
    ids += [x["id"] for x in cfg.get("own_reports") or []]
    ck("source ids unique, own reports too", len(ids) == len(set(ids)))
    ck("every own-report barn has a sale day, an https site and lat/lon in the lower 48", all(
        x.get("sale") and x.get("site", "").startswith("https://") and 24 < x["lat"] < 50 and -125 < x["lon"] < -66
        and re.match(r"^[A-Z]{2}$", x["state"]) for x in cfg.get("own_reports") or []))
    ck("no own-report parser ships checked before a saved report backs it",
       not any(x.get("parser_checked") for x in cfg.get("own_reports") or []))

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
    for b in doc["barns"] + doc["states"] + doc["own"]:
        s = b.get("status") or {}
        print("[cattle-auction] %s ok=%s %s" % (b["id"], s.get("ok"), s.get("note", "")))
        if not s.get("ok") and s.get("note") != "needs first read":
            print("::warning::%s not refreshed: %s" % (b["id"], s.get("note", "")))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
