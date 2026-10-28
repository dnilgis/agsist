#!/usr/bin/env python3
"""
AGSIST -- data/cull-cows.json: slaughter (cull) cow and bull prices at sale
barns, for the cull cow sections on milk-prices.html and
cattle-auction-prices.html (components/cull-cows.js).

Source: the same USDA AMS Livestock, Poultry and Grain Market News auction
reports as fetch_cattle_auction.py ("Livestock Weighted Average Report"),
latest issue at https://www.ams.usda.gov/mnreports/ams_<n>.pdf. Two kinds:
  * the barns' own feeder reports (barns in scripts/cattle_auction_sources.json,
    slug and `also`), many of which also print a SLAUGHTER CATTLE part;
  * the slaughter/replacement reports in `slaughter_reports` there, which hold
    no feeder rows and are read only here.
In the normal run fetch_cattle_auction.py hands this module the texts it
already fetched, so a feeder report is downloaded once per run.

What is read, and only under the SLAUGHTER CATTLE banner:
    COWS - Breaker 75-80% / Boner 80-85% / Lean 85-90% / Premium White 65-75%
    BULLS - 1-2 (yield grade, slaughter bulls; never the feeder or
            replacement bull tables, which carry a frame and muscle grade)
priced Per Cwt on Actual Wt. Each row is
    Head  Wt Range  Avg Wt  Price Range  Avg Price  Dressing
e.g. "84 1050-1347 1233 115.00-138.00 131.38 Average". Dressing is Average,
High, Low or Very Low, sometimes with "Return to Feed", "Light Weight" or
"Heavy Weight" after it. Rows with the same class and dressing label are
pooled: $/cwt weighted by total weight (head x avg wt), $/head = dollars over
head, exactly as the feeder reader pools a weight class.

The regional line is the middle (median) of each barn's Boner 80-85% Average
dressing $/cwt, over barns whose newest read sale is in the 14 days ending on
the run date, one number per barn. Under MIN_BARNS barns it is withheld with
the reason; it is never filled from an older sale.

WHAT THIS FILE WILL NOT DO
  * Use a report whose own title does not name the barn.
  * Keep any part of a table with a row it cannot read cleanly: words or a
    price between rows, an average outside its own range, an unknown dressing
    word. That table is refused and named in the sale's `refused` list; the
    barn's other tables stand on their own.
  * Replace a newer sale with an older one, or write a zero.

    python3 scripts/fetch_cull_cows.py --selftest
    python3 scripts/fetch_cull_cows.py          (fetches; the workflow runs it
                                                 through fetch_cattle_auction.py)
"""
import datetime
import json
import re
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch_cattle_auction as CA  # noqa: E402  fetch, titles, page breaks, notes
import fetch_dairy as FD  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = "data/cull-cows.json"
WINDOW_DAYS = 14         # the regional line counts sales in the 14 days ending on the run date
MIN_BARNS = 3            # fewer barns than this and the regional line is withheld
PRICE_RANGE = (20.0, 450.0)   # $/cwt; light Boner cows sold 225 at Kalona, Oct 22 2026
WT_RANGE = (500, 3000)

CLASSES = {
    "breaker": "Breaker 75-80%",
    "boner": "Boner 80-85%",
    "lean": "Lean 85-90%",
    "premium-white": "Premium White 65-75%",
    "bulls": "Bulls, yield grade 1-2",
    "dairy-breaker": "Dairy cows, Breaker 75-80%",
    "dairy-boner": "Dairy cows, Boner 80-85%",
    "dairy-lean": "Dairy cows, Lean 85-90%",
    "dairy-bulls": "Dairy bulls, yield grade 1-2",
}
# Some barns split dairy cows out ("DAIRY COWS - Boner 80-85%", Shipshewana IN 1970, Topeka IN
# 3415, Oct 2026); those are their own classes, never pooled with the beef-type COWS rows.
COW_RE = re.compile(r"\b(DAIRY\s+)?COWS\s*-\s*(Breaker\s+75-80|Boner\s+80-85|Lean\s+85-90|Premium\s+White\s+65-75)\s*%\s*"
                    r"\(\s*Per\s+Cwt\s*/\s*Actual\s+Wt\s*\)", re.I)
BULL_RE = re.compile(r"\b(DAIRY\s+)?BULLS\s*-\s*(1-2)\s*\(\s*Per\s+Cwt\s*/\s*Actual\s+Wt\s*\)", re.I)
# USDA's part banners, upper case on their own line; the repeated page title
# ("Slaughter/Replacement Cattle- Carthage, MO") is mixed case and never one.
BANNER_RE = re.compile(r"\b(SLAUGHTER CATTLE|REPLACEMENT DAIRY CATTLE|REPLACEMENT CATTLE|FEEDER CATTLE|"
                       r"FEEDER DAIRY CALVES|SLAUGHTER SHEEP/LAMBS|SLAUGHTER GOATS)\b")
DRESS = r"(Very\s+Low|Average|High|Low)(?:\s+(Return\s+to\s+Feed|Light\s+Weight|Heavy\s+Weight))?(?![A-Za-z])"
ROW_RE = re.compile(
    r"(?<![\d.])" + CA.INT + r"\s+" + CA.WT + r"(?:\s*-\s*" + CA.WT + r")?\s+" + CA.WT + r"\s+" + CA.PX +
    r"(?:\s*-\s*" + CA.PX + r")?\s+" + CA.PX + r"(?![\d.])\s+" + DRESS, re.I)


def _label(m1, m2):
    a = re.sub(r"\s+", " ", m1).title()
    return a + (" " + re.sub(r"\s+", " ", m2).title().replace(" To ", " to ") if m2 else "")


def parse_rows(block):
    """(rows, None) or (None, reason). Only whitespace may sit between rows."""
    rows, pos = [], 0
    for m in ROW_RE.finditer(block):
        gap = block[pos:m.start()]
        if gap.strip():
            return None, "text between rows that is not a row: %r" % gap.strip()[:60]
        pos = m.end()
        head = int(m.group(1).replace(",", ""))
        lo = int(m.group(2))
        hi = int(m.group(3)) if m.group(3) else lo
        wt = int(m.group(4))
        plo = float(m.group(5))
        phi = float(m.group(6)) if m.group(6) else plo
        price = float(m.group(7))
        if head <= 0:
            return None, "a row with no head"
        if not (lo <= wt <= hi):
            return None, "avg weight %d outside its own range %d-%d: misread" % (wt, lo, hi)
        if not (plo <= price <= phi):
            return None, "avg price %.2f outside its own range %.2f-%.2f: misread" % (price, plo, phi)
        if not (PRICE_RANGE[0] <= price <= PRICE_RANGE[1]):
            return None, "price %.2f outside %s" % (price, PRICE_RANGE)
        if not (WT_RANGE[0] <= wt <= WT_RANGE[1]):
            return None, "avg weight %d outside %s" % (wt, WT_RANGE)
        rows.append({"head": head, "wt": wt, "plo": plo, "phi": phi, "price": price,
                     "dressing": _label(m.group(8), m.group(9))})
    tail = block[pos:]
    if re.search(r"\d", tail):
        return None, "text after the last readable row: %r" % tail.strip()[:60]
    if not rows:
        return None, "no readable row"
    return rows, None


def _banner_before(j, pos):
    last = None
    for m in BANNER_RE.finditer(j, 0, pos):
        last = m.group(1)
    return last


def parse_report(text):
    """({"date", "receipts", "title", "tables": {cls: rows}, "refused": [...]}, None) or (None, reason).
    No slaughter cow or bull heading at all is (None, "no slaughter cow tables")."""
    if not text or not text.strip():
        return None, "empty report"
    date = CA.sale_date(text)
    if not date:
        return None, "no sale date in the first lines"
    j = CA.PAGEBREAK_RE.sub(" %s " % CA.PB, CA.joined(text))
    j = CA.COLHEAD_ALL_RE.sub(" ", j)
    found = []
    for m in COW_RE.finditer(j):
        found.append((m, ("dairy-" if m.group(1) else "") + re.sub(r"\s+\d.*", "", m.group(2)).lower().replace(" ", "-")))
    for m in BULL_RE.finditer(j):
        found.append((m, ("dairy-" if m.group(1) else "") + "bulls"))
    found.sort(key=lambda x: x[0].start())
    # CA.HEAD_RE does not see "COWS - Boner 80-85% (Per ..." (the % sign), so the cow
    # headings are added here: a table always ends where the next heading or banner starts.
    heads = sorted(set([m.start() for m in CA.HEAD_RE.finditer(j)] + [m.start() for m in BANNER_RE.finditer(j)] +
                       [m.start() for m, _ in found]))
    tables, refused = {}, []
    for m, cls in found:
        if _banner_before(j, m.start()) != "SLAUGHTER CATTLE":
            continue
        end = next((h for h in heads if h > m.end()), len(j))
        start = m.end()
        col = CA.COLHEAD_RE.match(j, start)
        if col:
            start = col.end()
        block, why = CA.table_block(j, m.end(), start, end, row_re=ROW_RE)
        rows = None
        if block is not None:
            rows, why = parse_rows(block)
        if rows is None:
            refused.append({"class": cls, "why": why})
            continue
        if cls in tables:
            refused.append({"class": cls, "why": "printed twice in one report"})
            del tables[cls]
            continue
        tables[cls] = rows
    if not tables and not refused:
        return None, "no slaughter cow tables"
    return {"date": date, "receipts": CA.receipts(text), "title": CA.report_title(text),
            "tables": tables, "refused": refused}, None


def pool(rows):
    """Rows of one class -> [{dressing, head, avg_wt, cwt, per_head, lo, hi, rows}] in printed order."""
    acc, order = {}, []
    for r in rows:
        d = r["dressing"]
        if d not in acc:
            acc[d] = {"head": 0, "cwt": 0.0, "dollars": 0.0, "lo": r["plo"], "hi": r["phi"], "rows": 0}
            order.append(d)
        a = acc[d]
        cwt = r["head"] * r["wt"] / 100.0
        a["head"] += r["head"]
        a["cwt"] += cwt
        a["dollars"] += cwt * r["price"]
        a["lo"] = min(a["lo"], r["plo"])
        a["hi"] = max(a["hi"], r["phi"])
        a["rows"] += 1
    out = []
    for d in order:
        a = acc[d]
        out.append({"dressing": d, "head": a["head"], "avg_wt": round(a["cwt"] * 100.0 / a["head"]),
                    "cwt": round(a["dollars"] / a["cwt"], 2), "per_head": round(a["dollars"] / a["head"], 2),
                    "lo": a["lo"], "hi": a["hi"], "rows": a["rows"]})
    return out


def summarize(parsed, number):
    classes = {}
    for cls in CLASSES:
        if cls in parsed["tables"]:
            classes[cls] = pool(parsed["tables"][cls])
    return {"date": parsed["date"], "receipts": parsed["receipts"], "report": str(number),
            "url": CA.PAGE % number, "pdf": CA.URL % number, "classes": classes,
            "refused": parsed["refused"]}


# ------------------------------------------------------------------ barns
def barn_list(cfg, listing):
    """[(src, [(number, match)])]: every barn whose reports may print slaughter cows.
    Slaughter reports first (they are the cull cow reports), then the barn's feeder reports."""
    by_id = {}
    order = []
    for src in cfg.get("barns") or []:
        by_id[src["id"]] = (src, [(s, src.get("match")) for s in CA.slugs_for(src, listing)])
        order.append(src["id"])
    own = {b["id"]: b for b in cfg.get("own_reports") or []}
    for r in cfg.get("slaughter_reports") or []:
        bid = r["barn"]
        if bid not in by_id:
            base = own.get(bid) or {"id": bid}
            by_id[bid] = (base, [])
            order.append(bid)
        src, reps = by_id[bid]
        match = r.get("match") or src.get("match")
        by_id[bid] = (src, [(r["number"], match)] + [x for x in reps if x[0] != r["number"]])
    return [by_id[i] for i in order]


def read_barn(src, reports, getter):
    """(sale, None) newest good slaughter sale over the barn's reports, else (None, reason)
    with reason None when no report prints a slaughter cow table at all."""
    best, whys = None, []
    for number, match in reports:
        _, text, err = getter(number) or (None, None, "not fetched")
        if not text:
            whys.append("%s: %s" % (number, err))
            continue
        p, why = parse_report(text)
        if p is None:
            if why != "no slaughter cow tables":
                whys.append("%s: %s" % (number, why))
            continue
        if not match or not re.search(match, p["title"], re.I):
            whys.append("%s: title %r does not name this barn" % (number, p["title"][:90]))
            continue
        sale = summarize(p, number)
        if not sale["classes"]:
            whys.append("%s: %s" % (number, "; ".join("%s table refused: %s" % (r["class"], r["why"]) for r in sale["refused"])))
            continue
        if best is None or sale["date"] > best["date"]:
            best = sale
    if best:
        return best, None
    return None, ("; ".join(whys) if whys else None)


def boner_average(sale):
    for r in (sale.get("classes") or {}).get("boner") or []:
        if r["dressing"] == "Average":
            return r
    return None


def regional(barns, today):
    """The middle Boner 80-85% Average $/cwt over barns sold in the WINDOW_DAYS ending today."""
    lo = (today - datetime.timedelta(days=WINDOW_DAYS - 1)).isoformat()
    hi = today.isoformat()
    vals = []
    for b in barns:
        s = (b.get("sales") or [None])[0]
        if not s or not (lo <= s["date"] <= hi):
            continue
        r = boner_average(s)
        if r:
            vals.append((r["cwt"], b["id"], b.get("state"), s["date"], r["head"], r["per_head"], r["avg_wt"]))
    out = {"class": "boner", "dressing": "Average", "window_days": WINDOW_DAYS, "from": lo, "to": hi,
           "barns": len(vals), "min_barns": MIN_BARNS}
    if len(vals) < MIN_BARNS:
        out["withheld"] = "%d barn%s sold Boner cows of Average dressing in the %d days to %s; the line needs %d" % (
            len(vals), "" if len(vals) == 1 else "s", WINDOW_DAYS, hi, MIN_BARNS)
        return out
    cw = [v[0] for v in vals]
    out.update({"median_cwt": round(statistics.median(cw), 2), "low_cwt": min(cw), "high_cwt": max(cw),
                # each its own middle over the same barns (not the $/head of the middle-price barn)
                "median_per_head": round(statistics.median(v[5] for v in vals), 2),
                "median_wt": round(statistics.median(v[6] for v in vals)),
                "head": sum(v[4] for v in vals), "states": sorted({v[2] for v in vals if v[2]}),
                "first_sale": min(v[3] for v in vals), "last_sale": max(v[3] for v in vals),
                "barn_ids": sorted(v[1] for v in vals)})
    return out


def run(root, getter=None, now=None, listing=None):
    """getter(number) -> (raw, text, err); default fetches. Writes OUT, returns the doc (None: nothing read)."""
    root = Path(root)
    now = now or datetime.datetime.now(datetime.timezone.utc)
    now_iso = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    today = now.astimezone(datetime.timezone(datetime.timedelta(hours=-6))).date()   # Central (standard) day
    cfg = CA.load_sources(root)
    listing = CA.listing_slugs(root) if listing is None else listing
    getter = getter or CA.fetch
    existing = FD.read_json(root / OUT) or {}
    old = {b["id"]: b for b in existing.get("barns") or []}
    barns, checked = [], 0
    slaughter_ids = {r["barn"] for r in cfg.get("slaughter_reports") or []}
    for src, reports in barn_list(cfg, listing):
        checked += len(reports)
        sale, why = read_barn(src, reports, getter)
        if sale is None and src["id"] not in old and src["id"] not in slaughter_ids:
            continue    # a feeder barn whose reports never printed slaughter cows here
        b = CA.merge_barn(old.get(src["id"]), src, sale, why or "no slaughter cow table in this run's reports",
                          now_iso, sale["report"] if sale else (old.get(src["id"]) or {}).get("slug"))
        if sale is None and b.get("slug"):
            b["source_url"] = CA.PAGE % b["slug"]
        barns.append(b)
    if not any(b.get("sales") for b in barns):
        return None
    barns.sort(key=lambda b: (b.get("state") or "", b.get("town") or "", b["id"]))
    doc = {"updated": now_iso, "as_of": today.isoformat(),
           "source": "USDA AMS Livestock, Poultry and Grain Market News, auction reports",
           "classes": CLASSES, "reports_checked": checked,
           "regional": regional(barns, today), "barns": barns}
    FD.atomic_write(root / OUT, doc)
    return doc


def report(doc, out=print):
    if not doc:
        out("::warning::cull cows: no barn read; %s not written" % OUT)
        return
    r = doc["regional"]
    out("[cull-cows] %d barns with a sale; regional %s" % (
        sum(1 for b in doc["barns"] if b.get("sales")),
        ("%.2f/cwt over %d barns" % (r["median_cwt"], r["barns"])) if "median_cwt" in r else "withheld: " + r["withheld"]))
    for b in doc["barns"]:
        s = (b.get("sales") or [{}])[0]
        for x in s.get("refused") or []:
            out("::warning::cull cows %s %s: %s table refused: %s" % (b["id"], s.get("report"), x["class"], x["why"]))
        if not (b.get("status") or {}).get("ok"):
            out("[cull-cows] %s not refreshed: %s" % (b["id"], b["status"].get("note")))


# ------------------------------------------------------------------ selftest
FX = ROOT / "test" / "fixtures" / "cattle-auction"


def selftest():
    fails = []

    def ck(name, ok, detail=""):
        print(("  ok   " if ok else "  FAIL ") + name + (f"  ({detail})" if not ok and detail else ""))
        if not ok:
            fails.append(name)

    def rd(name):
        return (FX / name).read_text()

    def row(sale, cls, dressing):
        return next((r for r in sale["classes"].get(cls, []) if r["dressing"] == dressing), None)

    # Joplin 1797 (Carthage MO), Wed Oct 21 2026, slaughter/replacement report. Hand-read rows.
    p, why = parse_report(rd("ams_1797-real.txt"))
    ck("Joplin 1797 parses", p is not None, why)
    if p:
        s = summarize(p, "1797")
        ck("Joplin: sale Wed Oct 21 2026, receipts 850", (s["date"], s["receipts"]) == ("2026-10-21", 850), (s["date"], s["receipts"]))
        ck("Joplin: breaker, boner, lean, bulls; no table refused",
           sorted(s["classes"]) == ["boner", "breaker", "bulls", "lean"] and not s["refused"], (sorted(s["classes"]), s["refused"]))
        b = row(s, "boner", "Average")
        # one row: 84 hd, 1233 lb, 131.38; 12.33 cwt x 131.38 = 1619.92 a head
        ck("Joplin: Boner Average 131.38/cwt, 84 head, 1233 lb, $1619.92 a head",
           b and (b["cwt"], b["head"], b["avg_wt"], b["per_head"]) == (131.38, 84, 1233, 1619.92), b)
        ck("Joplin: Lean has Very Low 86.73 on 34 head", (row(s, "lean", "Very Low") or {}).get("cwt") == 86.73)
        ck("Joplin: 4 Lean dressing rows in printed order",
           [r["dressing"] for r in s["classes"]["lean"]] == ["Average", "High", "Low", "Very Low"])
        bl = row(s, "bulls", "Low")
        # the Low bull row sits alone at the top of page 2, after the page footer and title
        ck("Joplin: the Low bull row across the page break is read (5 hd, 1767 lb, 162.24)",
           bl and (bl["head"], bl["avg_wt"], bl["cwt"]) == (5, 1767, 162.24), bl)
        ck("Joplin: 'Average Return to Feed' bulls kept apart from Average",
           (row(s, "bulls", "Average Return To Feed") or row(s, "bulls", "Average Return to Feed") or {}).get("cwt") == 210.0
           and row(s, "bulls", "Average")["head"] == 34)
        ck("Joplin: replacement 'BULLS - Medium and Large 1' (per unit) never read",
           sum(r["head"] for r in s["classes"]["bulls"]) == 34 + 2 + 9 + 5)

    # Kalona 2528 (IA), Thu Oct 22 2026: slaughter steers and heifers ahead of the cows.
    p, why = parse_report(rd("ams_2528-real.txt"))
    ck("Kalona 2528 parses", p is not None, why)
    if p:
        s = summarize(p, "2528")
        ck("Kalona: sale Thu Oct 22 2026", s["date"] == "2026-10-22")
        b = row(s, "boner", "Average")
        # 7 hd x 12.11 cwt x 130.42 = 11055.70; / 7 = 1579.39 a head
        ck("Kalona: Boner Average 130.42 on 7 head, 1211 lb, $1579.39 a head",
           b and (b["cwt"], b["head"], b["avg_wt"], b["per_head"]) == (130.42, 7, 1211, 1579.39), b)
        ck("Kalona: light weight Boner (225.08) is its own line, not in Average",
           (row(s, "boner", "Average Light Weight") or {}).get("cwt") == 225.08)
        ck("Kalona: slaughter steers and heifers are not cows", sorted(s["classes"]) == ["boner", "breaker", "bulls", "lean"])
        bl = row(s, "bulls", "Average")
        ck("Kalona: bulls Average 170.78 on 12 head", bl and (bl["cwt"], bl["head"]) == (170.78, 12), bl)

    # OKC West 1825 (El Reno OK).
    p, why = parse_report(rd("ams_1825-real.txt"))
    ck("OKC West 1825 parses", p is not None, why)
    if p:
        s = summarize(p, "1825")
        b = row(s, "boner", "Average")
        ck("OKC West: sale Mon Oct 26 2026, Boner Average read", s["date"] == "2026-10-26" and b is not None, (s["date"], b))
        ck("OKC West: Boner Average " + OKC_BONER_NOTE, b and (b["cwt"], b["head"], b["avg_wt"]) == OKC_BONER, b)

    # Stanford KY 2190 (feeder report with a slaughter part), both text layouts.
    for name in ("ams_2190-2026-10-26.txt", "ams_2190-2026-10-26-pypdf.txt"):
        p, why = parse_report(rd(name))
        ck("Stanford 2190 %s parses" % name, p is not None, why)
        if p:
            s = summarize(p, "2190")
            b = row(s, "boner", "Average")
            ck("Stanford %s: Boner Average %s" % (name, STANFORD_BONER_NOTE),
               b and (b["cwt"], b["head"], b["avg_wt"], b["per_head"]) == STANFORD_BONER, b)
            ck("Stanford %s: feeder bull tables never read as slaughter bulls" % name,
               sum(r["head"] for r in s["classes"].get("bulls", [])) == STANFORD_BULL_HEAD, s["classes"].get("bulls"))
            ck("Stanford %s: nothing refused" % name, not s["refused"], s["refused"])

    # Harned KY 2207, Mon Oct 26 2026: USDA printed one bull row as "1672 5-1550 7 165.00-167.00
    # 166.64 Low" (head and weight run together). The bull table is refused whole; the cows stand.
    p, why = parse_report(rd("ams_2207-real.txt"))
    ck("Harned 2207 parses", p is not None, why)
    if p:
        s = summarize(p, "2207")
        ck("Harned: bull table refused, named", "bulls" not in s["classes"] and [r["class"] for r in s["refused"]] == ["bulls"],
           (sorted(s["classes"]), s["refused"]))
        ck("Harned: cows still read", {"breaker", "boner", "lean"} <= set(s["classes"]), sorted(s["classes"]))
        b = row(s, "boner", "Average")
        # "21 970-1460 1243 112.00-134.00 126.74 Average": 12.43 cwt x 126.74 = 1575.38 a head
        ck("Harned: Boner Average 126.74 on 21 head, $1575.38 a head",
           b and (b["cwt"], b["head"], b["avg_wt"], b["per_head"]) == (126.74, 21, 1243, 1575.38), b)

    # Shipshewana IN 1970: DAIRY COWS tables are their own classes, never pooled with COWS
    p, why = parse_report(rd("ams_1970-real.txt"))
    ck("Shipshewana 1970 parses", p is not None, why)
    if p:
        s = summarize(p, "1970")
        ck("Shipshewana: Boner Average 123.65 on 3 head (beef-type COWS only)",
           (row(s, "boner", "Average") or {}).get("head") == 3 and row(s, "boner", "Average")["cwt"] == 123.65)
        ck("Shipshewana: dairy breaker read apart: 1 head, 1945 lb, 114.00",
           (row(s, "dairy-breaker", "Average") or {}).get("cwt") == 114.0 and row(s, "dairy-breaker", "Average")["head"] == 1)
        ck("Shipshewana: no Breaker COWS table printed, so none read", "breaker" not in s["classes"])
        ck("Shipshewana: the dairy calf 'BULLS - Non Graded' table (650-1175/cwt) is never read",
           all(r["cwt"] < 300 for k in ("bulls", "dairy-bulls") for r in s["classes"].get(k, [])))

    # a feeder report with no slaughter part says so, and is not a failure
    p, why = parse_report(rd("ams_1245-real.txt"))
    ck("Joplin feeder 1245: no slaughter cow tables", p is None and why == "no slaughter cow tables", why)

    # row rules
    rows, why = parse_rows(" 10 1100-1300 1200 120.00-130.00 125.00 Average 4 1000 1000 110.00 110.00 Low ")
    ck("rows: two clean rows", rows is not None and len(rows) == 2, why)
    rows, why = parse_rows(" 10 1100-1300 1200 120.00-130.00 125.00 Average Fancy 4 1000 1000 110.00 110.00 Low ")
    ck("rows: an unknown dressing word refuses the table", rows is None, rows)
    rows, why = parse_rows(" 10 1100-1300 1200 120.00-130.00 135.00 Average ")
    ck("rows: avg price outside its range refuses", rows is None)
    rows, why = parse_rows(" 10 1100-1300 1400 120.00-130.00 125.00 Average ")
    ck("rows: avg weight outside its range refuses", rows is None)
    rows, why = parse_rows(" 10 1100-1300 1200 120.00-130.00 125.00 Average 117.00 ")
    ck("rows: a stray price after the last row refuses", rows is None)

    # pooling two rows of one dressing: 10 hd x 12.00 cwt x 125 = 15000; 4 hd x 10.00 x 110 = 4400
    # = 19400 over 160 cwt = 121.25/cwt; 19400 / 14 = 1385.71 a head; 16000 lb / 14 = 1143 lb
    pr = pool([{"head": 10, "wt": 1200, "plo": 120.0, "phi": 130.0, "price": 125.0, "dressing": "Average"},
               {"head": 4, "wt": 1000, "plo": 105.0, "phi": 115.0, "price": 110.0, "dressing": "Average"}])
    ck("pool: weighted 121.25/cwt, 1385.71/head, 1143 lb, range 105-130",
       pr == [{"dressing": "Average", "head": 14, "avg_wt": 1143, "cwt": 121.25, "per_head": 1385.71,
               "lo": 105.0, "hi": 130.0, "rows": 2}], pr)

    # regional line: middle of barns in the window, withheld under 3
    def bn(i, st, d, c, wt=1200):
        return {"id": i, "state": st, "sales": [{"date": d, "classes": {"boner": [
            {"dressing": "Average", "cwt": c, "head": 10, "avg_wt": wt, "per_head": round(c * wt / 100, 2)}]}}]}
    today = datetime.date(2026, 10, 28)
    bs = [bn("a", "MO", "2026-10-21", 131.38), bn("b", "OK", "2026-10-26", 140.0), bn("c", "IA", "2026-10-22", 130.42),
          bn("old", "KY", "2026-10-14", 99.0)]   # Oct 14 is 15 days back: out
    r = regional(bs, today)
    ck("regional: middle of 3 barns 131.38, Oct 15 to Oct 28, the Oct 14 sale out",
       (r.get("median_cwt"), r["barns"], r["from"], r["to"]) == (131.38, 3, "2026-10-15", "2026-10-28"), r)
    ck("regional: middle $/head 1576.56 (131.38 x 12) and weight 1200, their own middles",
       (r.get("median_per_head"), r.get("median_wt")) == (1576.56, 1200), r)
    bs.append(bn("d", "KY", "2026-10-15", 120.0))
    r = regional(bs, today)
    ck("regional: 4 barns, middle (130.42 + 131.38) / 2 = 130.90", (r.get("median_cwt"), r["barns"]) == (130.9, 4), r)
    r = regional(bs[:2], today)
    ck("regional: 2 barns withheld, with the reason", "median_cwt" not in r and r["barns"] == 2 and "needs 3" in r["withheld"], r)
    r = regional([bn("f", "MO", "2026-10-29", 150.0)] + bs[:2], today)
    ck("regional: a sale dated after the run day is not counted", r["barns"] == 2, r)

    # end to end over the barn list with fixtures; keep-last-good; title check
    import tempfile
    import shutil
    with tempfile.TemporaryDirectory() as d:
        d = Path(d)
        (d / "scripts").mkdir()
        shutil.copy(ROOT / CA.SOURCES, d / CA.SOURCES)
        texts = {"1797": rd("ams_1797-real.txt"), "2528": rd("ams_2528-real.txt"), "1825": rd("ams_1825-real.txt"),
                 "2190": rd("ams_2190-2026-10-26.txt"), "2207": rd("ams_2207-real.txt"),
                 "1245": rd("ams_1245-real.txt")}
        getter = lambda n: (None, texts[n], None) if n in texts else (None, None, "fetch failed: test")  # noqa: E731
        now = datetime.datetime(2026, 10, 28, 20, 0, tzinfo=datetime.timezone.utc)
        doc = run(d, getter=getter, now=now, listing={})
        ids = sorted(b["id"] for b in doc["barns"] if b.get("sales")) if doc else []
        ck("run: the five fixture barns read", ids == ["el-reno-ok", "harned-ky", "joplin-mo", "kalona-ia", "stanford-ky"], ids)
        if doc:
            r = doc["regional"]
            ck("run: regional over 5 barns, middle is " + RUN_MEDIAN_NOTE,
               (r.get("median_cwt"), r["barns"]) == (RUN_MEDIAN, 5), r)
            kal = next(b for b in doc["barns"] if b["id"] == "kalona-ia")
            ck("run: Kalona (own_reports barn) named from its own entry, report 2528",
               kal["name"] == "Kalona Sales Barn" and kal["sales"][0]["report"] == "2528"
               and kal["source_url"].endswith("/2528"), kal)
            ck("run: joplin's newest sale from 1797, not the replacement special 1798",
               next(b for b in doc["barns"] if b["id"] == "joplin-mo")["sales"][0]["report"] == "1797")
            ck("run: barns with no slaughter part and no history are left out",
               all(b.get("sales") or b["id"] in {"west-plains-mo", "springfield-mo", "kingdom-city-mo", "okc-ok",
                   "woodward-ok", "ada-ok", "salina-ks", "greenville-il", "lexington-ky", "tina-mo", "beaver-ok"}
                   for b in doc["barns"]))
            # a second run where Joplin's report is gone keeps Joplin's sale and says why
            texts.pop("1797")
            doc2 = run(d, getter=getter, now=now, listing={})
            jb = next(b for b in doc2["barns"] if b["id"] == "joplin-mo")
            ck("run: a failed fetch keeps the last good sale and records why",
               jb["sales"][0]["date"] == "2026-10-21" and jb["status"]["ok"] is False and "1797" in jb["status"]["note"], jb["status"])
            # a report under the wrong number (another barn's title) is refused
            texts["1797"] = rd("ams_2528-real.txt")
            doc3 = run(d, getter=getter, now=now, listing={})
            jb = next(b for b in doc3["barns"] if b["id"] == "joplin-mo")
            ck("run: another barn's report under Joplin's number is refused by title",
               jb["status"]["ok"] is False and "does not name this barn" in jb["status"]["note"]
               and jb["sales"][0]["report"] == "1797", jb["status"])

    if fails:
        print("%d FAILED" % len(fails))
        return 1
    print("all cull cow checks pass")
    return 0


# Hand-checked numbers for the fixtures, filled from the printed rows (see the checks).
# OKC West 1825: "13 1243-1380 1324 127.00-137.50 130.57 Average"; the Return to Feed row (135.14) apart
OKC_BONER_NOTE = "130.57 on 13 head, 1324 lb"
OKC_BONER = (130.57, 13, 1324)
# Stanford 2190: "7 1160-1465 1284 122.00-127.00 125.51 Average"; 12.84 cwt x 125.51 = 1611.55 a head
STANFORD_BONER_NOTE = "125.51 on 7 head, 1284 lb, $1611.55 a head"
STANFORD_BONER = (125.51, 7, 1284, 1611.55)
STANFORD_BULL_HEAD = 1    # one slaughter bull row, "1 1275 1275 162.00 162.00 Low"
# Boner Average over the five fixture barns, all sold Oct 21-26: 125.51 (Stanford), 126.74 (Harned),
# 130.42 (Kalona), 130.57 (OKC West), 131.38 (Joplin); the middle one is Kalona's
RUN_MEDIAN_NOTE = "130.42 (Kalona, third of five)"
RUN_MEDIAN = 130.42


def main(argv):
    if "--selftest" in argv:
        return selftest()
    doc = run(ROOT)
    report(doc)
    return 0


if __name__ == "__main__":
    _argv = sys.argv[1:]
    _rc = main(_argv)
    sys.exit(_rc if "--selftest" in _argv else CA.AMS.finish("cull-cows", _rc))
