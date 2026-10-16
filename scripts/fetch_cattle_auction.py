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
SECTION_RE = re.compile(
    r"\bfeeder\s+(steers|heifers)\s+medium\s+(?:and|&)\s+large\s+(1-2|1)\s*\(\s*per\s+cwt\s*/\s*actual\s+wt\s*\)", re.I)
# any table heading, so a block ends where the next one starts
HEAD_RE = re.compile(
    r"\b(?:feeder|slaughter|bred|stock|replacement|cow|cows|holstein|dairy|pairs|bulls?|"
    r"heiferettes|baby|calves)\b[A-Za-z0-9 ,&/\-]{0,80}?\(\s*(?:per|price)\b[^)]*\)", re.I)
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
    j = joined(text)
    heads = [m.start() for m in HEAD_RE.finditer(j)]
    tables = {}
    for m in SECTION_RE.finditer(j):
        key = "%s|%s" % (m.group(1).lower(), m.group(2))
        end = next((h for h in heads if h > m.start()), len(j))
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


def fetch(slug):
    raw, err = FD.http_get(URL % slug)
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
            slug = pick_slug(src, listing)
            g = (got.get(slug) if got is not None else (fetch(slug) if slug else None)) or (None, None, "not fetched")
            sale, why = read_one(src, slug, g)
            out.append(merge_barn(prev.get(src["id"]), src, sale, why, now_iso, slug))
    has = any(b.get("sales") for b in barns + states)
    if not has:
        return None
    doc = {"updated": now_iso,
           "source": "USDA AMS Livestock, Poultry and Grain Market News, auction reports",
           "classes": CLASSES, "barns": barns, "states": states}
    FD.atomic_write(root / OUT, doc)
    return doc


LINK_RE = re.compile(r"""<a\b[^>]*href=["'][^"']*?ams_(\d{3,5})\.(?:pdf|txt)["'][^>]*>(.*?)</a>""", re.I | re.S)


def parse_listing(html_text):
    """{link text: slug} from the AMS auction listing page."""
    out = {}
    for m in LINK_RE.finditer(html_text or ""):
        t = re.sub(r"<[^>]+>", " ", m.group(2))
        t = re.sub(r"\s+", " ", t).strip()
        if t:
            out[t] = m.group(1)
    return out


def probe(root):
    root = Path(root)
    rd = root / RAW_DIR
    rd.mkdir(parents=True, exist_ok=True)
    cfg = load_sources(root)
    raw, err = FD.http_get(cfg["listing_url"])
    listing = {}
    if raw is None:
        print("listing ERROR:", err)
    else:
        (rd / "listing.html").write_bytes(raw)
        listing = parse_listing(raw.decode("utf-8", "replace"))
        FD.atomic_write(rd / "listing.json", {"url": cfg["listing_url"], "reports": listing})
        print("listing: %d auction report links" % len(listing))
    for group in ("barns", "state_reports"):
        for src in cfg.get(group) or []:
            slug = pick_slug(src, listing)
            print("%s slug=%s" % (src["id"], slug))
            if not slug:
                print("  no report number; listing titles to look at:",
                      [t for t in listing if src.get("town", src["state"]).lower() in t.lower()][:5])
                continue
            raw, text, err = fetch(slug)
            if raw is not None:
                (rd / ("ams_%s.raw" % slug)).write_bytes(raw)
            if err:
                print("  ERROR:", err)
            if text:
                (rd / ("ams_%s.txt" % slug)).write_text(text)
                print("  title:", report_title(text)[:120])
                sale, why = read_one(src, slug, (raw, text, None))
                if sale:
                    print("  parsed %s: %s" % (sale["date"], {k: sorted(v) for k, v in sale["classes"].items()}))
                else:
                    print("  NOT PARSED:", why)
    return 0


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
                        '<li><a href="https://www.ams.usda.gov/mnreports/ams_1889.pdf">Winter Livestock - Dodge City, KS</a></li>')
    ck("listing links read", lst == {"Joplin Regional Stockyards - Carthage, MO (Mon)": "1245",
                                     "Winter Livestock - Dodge City, KS": "1889"}, lst)
    ck("listing fills a missing slug by title", pick_slug(dict(other, slug=None), lst) == "1889")

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
        return probe(ROOT)
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
