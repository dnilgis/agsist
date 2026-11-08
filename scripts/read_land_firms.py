#!/usr/bin/env python3
"""
AGSIST -- read four land auction firms' saved results pages into auction records.

Phase 2 of the firm results readers (Sig, Nov 8, 2026). Input is the raw pages
scripts/capture_land_firms.py saved (land/<firm>/capture/<date>/current.html, archive/*,
Martin's feed.xml); output is data/land/auctions/<firm>.json, one file per firm, in the
record shape of scripts/read_schrader.py:
  {source, auction_id, url, date, state, county, county_fips, headline_acres, total_sold,
   tracts: [{tracts: "1", sold: 1040000 or null, per_acre: 13000 or null}], kind: "auction", credit}
Facts only. No buyer, owner, seller or address is read into anything, and none of it can
reach the output. Credit "Results reported by <firm>"; every record links to the page of the
firm's own site it was read from.

Rules shared by all four:
  county   only when exactly one county and exactly one state are named; a town is never turned
           into a county; two counties, no county, no state or two states are withheld and counted
           by reason. The county text must join to a real county of that state (atlas_common).
  farmland headline acres 20 or more and (for Wieman and Younger) at least one per-acre figure the
           firm printed. Houses, lots, leases, equipment and "personal property" sales are counted,
           never stored. Per acre is only ever the firm's printed figure.
  date     the auction date printed with the result; a result dated after the capture is not kept.

Per firm:
  wieman   (SD) year pages, one panel per sale, one price line per tract. A tract at $0 (or 0 acres
           at $0) is Wieman's placeholder and is skipped. A row is "$A per Acre for a total of $T":
           kept as printed. headline_acres is the sum of the printed acres of the rows with a
           per-acre figure; total_sold the sum of the printed tract prices. Land lease auctions
           are not sales and are skipped. Link: the year page. Id: <date>-<nth sale that day>.
  younger  (MO, KS, IA) one page, lines like "Tract 1 - 68 Acres - $8,500.00 / acre". Only rows with
           acres and a per-acre figure are read. total_sold is null unless every row printed its own
           total; a price is never worked out from acres and per acre. The county comes from the title
           (the title is never stored); a title with no county or no state is withheld. Link: the page.
  horning  (PA) past-auctions pages: one entry per sale with a "Sold Price" and a link to its own page.
           Farm and land entries only, one acre figure in the title, one plain price. The county is
           read only from county words in the title and the listing text, the state from the title or
           the address line's state letters; the street address is never kept. Link: the entry's page.
  martins  (PA, MD) results highlights: "SOLD $X ... / <town>, PA / SAT. AUG. 29, 2026". The date is
           read from the title text, never from the feed's pubDate (that is when the lot was
           published, months before the sale). The county comes only from county words in the feed
           text; a farm title with one acre figure and no personal property in the price. Link: the
           lot's page.

The output keeps history exactly as read_schrader does (records stay, a record seen again changes
only by added tract rows, a run that would shrink the file writes nothing and exits 1).

  python3 scripts/read_land_firms.py --all --out-dir results/firms   # every saved folder, each firm
  python3 scripts/read_land_firms.py --latest --out-dir <dir>        # newest folder per firm
  python3 scripts/read_land_firms.py --firm wieman --capture <folder> --out <file>
  python3 scripts/read_land_firms.py --merge-dir <dir>               # check and merge <dir>/<firm>.json into data/land/auctions
  python3 scripts/read_land_firms.py --selftest                      # fixtures in test/fixtures/land-firms

In Actions the read job (no write token) reads the saved pages into facts-only files; the commit job
checks every record against the shape and the county join, merges under the guard and commits
data/land/auctions/<firm>.json.
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import glob
import html
import json
import os
import re
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from atlas_common import county_index, norm_name  # noqa: E402
from county_rain import STATES  # noqa: E402
import read_schrader as RS  # noqa: E402  the shared merge, money and date helpers

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAND = os.path.join(ROOT, "land")
OUT_DIR = os.path.join(ROOT, "data", "land", "auctions")
FIXTURES = os.path.join(ROOT, "test", "fixtures", "land-firms")
MIN_ACRES = 20
ABBR = RS.ABBR
MONTHS = RS.MONTHS

FIRMS = {
    "wieman": {"name": "Wieman Land & Auction", "base": "https://www.wiemanauction.com/land-auction-results.php",
               "prefix": "https://www.wiemanauction.com/land-auction-results.php", "state": "SD"},
    "younger": {"name": "Younger Auction Company", "base": "https://www.youngerauction.com/land-auction-results.html",
                "prefix": "https://www.youngerauction.com/land-auction-results.html", "state": None},
    "horning": {"name": "Horning Farm Agency", "base": "https://www.horningfarmagency.com/auctions/past-auctions",
                "prefix": "https://www.horningfarmagency.com/auction/", "state": None},
    "martins": {"name": "Martin's Auction Service", "base": "https://martinsauctionservice.com/product-category/auction-results-highlights/",
                "prefix": "https://martinsauctionservice.com/product/", "state": None},
}
for _s, _f in FIRMS.items():
    _f["credit"] = "Results reported by " + _f["name"]
    _f["credit_url"] = _f["base"]
KEYS = {"source", "auction_id", "url", "date", "state", "county", "county_fips", "headline_acres",
        "total_sold", "tracts", "kind", "credit"}
LAST_RUN_KEYS = {"pages", "records_seen", "kept", "captured"}
ID_OK = re.compile(r"^[0-9a-z]+(?:-[0-9a-z]+){1,30}$")
TRACT_OK = re.compile(r"^\d+[A-Za-z]?$")
URL_OK = re.compile(r"^https://[A-Za-z0-9.-]+/[A-Za-z0-9._~:/?=&%-]*$")

text = RS.text


def clean(s):
    return re.sub(r"[​ ]", " ", text(s))


def num(s):
    return float(s.replace(",", ""))


def whole(x):
    return int(x) if x == int(x) else round(x, 2)


def mdy(s):
    """First 'Month D(st), YYYY' in s as an ISO date, or None. Weekday and ordinal suffixes ignored."""
    m = re.search(r"\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*(\d{4})\b", s or "")
    if not m or m.group(1)[:3].lower() not in MONTHS:
        return None
    try:
        return datetime(int(m.group(3)), MONTHS[m.group(1)[:3].lower()], int(m.group(2))).strftime("%Y-%m-%d")
    except ValueError:
        return None


# ---------------------------------------------------------------- county and state

STATE_FULL = re.compile(r"\b(" + "|".join(re.escape(s) for s in sorted(ABBR, key=len, reverse=True)) + r")\b(?!\s+(?:count|co\b|court|twp|township))", re.I)
STATE_AFTER_COUNTY = re.compile(r"\b(?:County|Co)\b\.?,?\s+(" + "|".join(STATES) + r")\b")   # "Page County IA", "Hutchinson County, SD"
STATE_AFTER_COMMA = re.compile(r",\s*(" + "|".join(STATES) + r")\b")                          # "Marion, SD", "Greencastle, PA"
COUNTY_MENTION = re.compile(r"((?:[A-Za-z][A-Za-z.'’]*\s+){0,3}[A-Za-z][A-Za-z.'’]*)\s+(?:County|Co)\b", re.I)
CONNECT = re.compile(r"((?:[A-Za-z][A-Za-z.'’]*\s+){0,1}[A-Za-z][A-Za-z.'’]*)\s*(?:&|\band\b|[–—-]|,|/)\s*$", re.I)


def states_named(s):
    out = {ABBR[m.group(1).lower()] for m in STATE_FULL.finditer(s or "")}
    out |= {m.group(1) for m in STATE_AFTER_COUNTY.finditer(s or "")}
    out |= {m.group(1) for m in STATE_AFTER_COMMA.finditer(s or "")}
    return out


def find_county(county_text, state_text, idx, fallback_state=None):
    """(county, state, fips, reason). reason is None when exactly one county and one state were named
    and the county joins to a real county of that state."""
    sts = states_named(state_text)
    if not sts and fallback_state:
        sts = {fallback_state}
    if re.search(r"\bcounties\b", county_text or "", re.I):
        return None, None, None, "multi_county"
    if len(sts) != 1:
        return None, None, None, "state_unclear" if sts else "no_state_named"
    st = next(iter(sts))
    joined, mentions = {}, 0
    for m in COUNTY_MENTION.finditer(county_text or ""):
        mentions += 1
        words = m.group(1).replace("’", "'").split()
        for k in range(min(3, len(words)), 0, -1):
            cand = " ".join(words[-k:])
            fips = idx.get((st, norm_name(cand)))
            if fips:
                joined[fips] = (cand.title() if cand.isupper() or cand.islower() else cand)
                # a second county before this one ("Hanson - Hutchinson County", "Cass & Van Buren Co.")
                c = CONNECT.search(county_text[:m.start(1) + len(m.group(1)) - len(cand)])
                if c:
                    pw = c.group(1).split()
                    for j in range(min(2, len(pw)), 0, -1):
                        if idx.get((st, norm_name(" ".join(pw[-j:])))):
                            return None, None, None, "multi_county"
                break
    if len(joined) > 1:
        return None, None, None, "multi_county"
    if not joined:
        return None, None, None, "not_a_county_there" if mentions else "no_county_named"
    fips = next(iter(joined))
    return joined[fips], st, fips, None


# ---------------------------------------------------------------- the four readers
# each reader: read(folder) -> list of raw items; build(item, idx, captured) -> (record or None, reason)

def money_i(s):
    m = re.fullmatch(r"\$?\s*(\d[\d,]*)(?:\.\d{1,2})?", (s or "").strip())
    return int(m.group(1).replace(",", "")) if m else None


def record(firm, aid, url, date, st, county, fips, acres, total, tracts):
    return {"source": firm, "auction_id": aid, "url": url, "date": date, "state": st, "county": county,
            "county_fips": fips, "headline_acres": whole(acres), "total_sold": total, "tracts": tracts,
            "kind": "auction", "credit": FIRMS[firm]["credit"]}


# ---- Wieman

W_PANEL = '<div class="panel panel-default">'
W_PRICE = re.compile(r"^\$\s*(\d[\d,]*)\s*per\s*Acre\s*for\s*a\s*total\s*of:?\s*\$\s*(\d[\d,]*)$|^\$\s*(\d[\d,]*)$", re.I)


def wieman_items(folder):
    items = []
    files = [("current.html", None)] + [(os.path.join("archive", f), None) for f in sorted(os.listdir(os.path.join(folder, "archive")))
                                        if os.path.isdir(os.path.join(folder, "archive")) and f.endswith(".html")]
    for rel, _ in files:
        fp = os.path.join(folder, rel)
        if not os.path.isfile(fp):
            continue
        page = open(fp, encoding="utf-8", errors="replace").read()
        yr = re.search(r"<h2><strong>\s*(\d{4})\s+LAND AUCTION RESULTS", page)
        year = yr.group(1) if yr else None
        for pn in page.split(W_PANEL)[1:]:
            t = re.search(r"<h4>\s*<strong>(.*?)</strong>\s*</h4>", pn, re.S)
            w = re.search(r"<strong>When: </strong>(.*?)<br", pn, re.S)
            wh = re.search(r"<strong>Where: </strong>(.*?)<br", pn, re.S)
            rows = []
            for tb in pn.split("<strong>Tract")[1:]:
                lab = re.match(r"\s*(\w+)\s*:?\s*</strong>", tb)
                ac = re.search(r"</div><div[^>]*>\s*([\d,.]+)\s*Acres", tb)
                pr = re.search(r"Price:\s*</div>\s*<div[^>]*>(.*?)</div>", tb, re.S)
                rows.append((lab.group(1) if lab else None, ac.group(1) if ac else None, clean(pr.group(1)) if pr else ""))
            items.append({"title": clean(t.group(1)) if t else "", "when": clean(w.group(1)) if w else "",
                          "where": clean(wh.group(1)) if wh else "", "rows": rows, "year": year, "page": rel})
    return items


def wieman_build(items, idx, captured, stats):
    out, ordinal = [], {}
    for it in items:
        d = mdy(it["when"])
        if not d:
            stats["no_date"] += 1
            continue
        ordinal[d] = ordinal.get(d, 0) + 1
        aid = "%s-%d" % (d, ordinal[d])
        if re.search(r"\bLEASE\b", it["title"], re.I):
            stats["lease_not_a_sale"] += 1
            continue
        rows, acres = [], 0.0
        for lab, ac, pr in it["rows"]:
            m = W_PRICE.match(pr)
            if not m or not lab or not TRACT_OK.match(lab):
                stats["unread_row"] += 1
                continue
            if m.group(3) is not None:
                sold, per = int(m.group(3).replace(",", "")), None
            else:
                per, sold = int(m.group(1).replace(",", "")), int(m.group(2).replace(",", ""))
            if not sold or (per == 0):
                stats["placeholder_row"] += 1  # Wieman's $0 rows
                continue
            rows.append({"tracts": lab, "sold": sold, "per_acre": per})
            if per is not None and ac:
                acres += num(ac)
        if not rows:
            stats["no_priced_row"] += 1
            continue
        if not any(r["per_acre"] is not None for r in rows) or acres < MIN_ACRES:
            stats["not_farmland"] += 1
            continue
        if d > captured:
            stats["future_date"] += 1
            continue
        county, st, fips, why = find_county(it["title"], it["title"] + " ; " + it["where"], idx, FIRMS["wieman"]["state"])
        if why:
            stats["withheld_" + why] += 1
            continue
        yr = it["year"] or d[:4]
        out.append(record("wieman", aid, "%s?year=%s" % (FIRMS["wieman"]["base"], yr), d, st, county, fips, acres,
                          sum(r["sold"] for r in rows), rows))
    return out


# ---- Younger

Y_PLUS = r"(?:\+\s*/\s*-\s*|\+\s*\\\s*-\s*|±\s*)?"
Y_ROW_A = re.compile(r"^(?:Tract\s*(\w+)\s*[–-]\s*)?(\d[\d,.]*)\s*" + Y_PLUS + r"Acres?\s*[–-]\s*\$\s*(\d[\d,]*)(?:\.\d\d)?\s*/\s*acre$", re.I)
Y_ROW_B = re.compile(r"^Tract\s*(\w+)\s*[–-]\s*\$\s*(\d[\d,]*)(?:\.\d\d)?\s*/\s*acre(?:\s*[–-]\s*total\s*\$\s*(\d[\d,]*)(?:\.\d\d)?)?\s*\(\s*(\d[\d,.]*)\s*acres?\s*\)$", re.I)


def younger_items(folder):
    fp = os.path.join(folder, "current.html")
    if not os.path.isfile(fp):
        return []
    page = open(fp, encoding="utf-8", errors="replace").read()
    m = re.search(r'<div id="wsite-content', page)
    items, year = [], None
    for b in re.findall(r'<div class="paragraph">(.*?)</div>', page[m.start():] if m else page, re.S):
        lines = [clean(x) for x in re.split(r"<br\s*/?>", b)]
        lines = [l for l in lines if l]
        if not lines:
            continue
        if len(lines) == 1 and re.fullmatch(r"\d{4}", lines[0]):
            year = lines[0]
            continue
        items.append({"title": lines[0], "lines": [l for l in lines[1:] if not re.match(r"Owner\b", l, re.I)], "year": year})
    return items


def younger_build(items, idx, captured, stats):
    out, ordinal = [], {}
    for it in items:
        d = next((mdy(l) for l in it["lines"] if re.match(r"^(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)[a-z]*,", l, re.I) and mdy(l)), None)
        rows, acres, tot_all = [], 0.0, True
        sawrow = False
        for l in it["lines"]:
            if re.match(r"^(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)[a-z]*,", l, re.I) or re.match(r"Average per acre|Total Average", l, re.I):
                continue
            a, b = Y_ROW_A.match(l), Y_ROW_B.match(l)
            if a:
                lab, ac, per, sold = a.group(1) or "1", num(a.group(2)), int(a.group(3).replace(",", "")), None
            elif b:
                lab, per, ac = b.group(1), int(b.group(2).replace(",", "")), num(b.group(4))
                sold = int(b.group(3).replace(",", "")) if b.group(3) else None
            else:
                if re.search(r"\$", l):
                    stats["row_not_read"] += 1
                continue
            sawrow = True
            if not TRACT_OK.match(lab) or per <= 0 or ac <= 0 or per > RS.MAX_PER_ACRE:
                stats["row_not_read"] += 1
                continue
            rows.append({"tracts": lab, "sold": sold, "per_acre": per})
            acres += ac
            tot_all = tot_all and sold is not None
        if not rows:
            stats["no_per_acre_row"] += 1
            continue
        if not d:
            stats["no_date"] += 1
            continue
        ordinal[d] = ordinal.get(d, 0) + 1
        aid = "%s-%d" % (d, ordinal[d])
        if acres < MIN_ACRES:
            stats["not_farmland"] += 1
            continue
        if d > captured:
            stats["future_date"] += 1
            continue
        county, st, fips, why = find_county(it["title"], it["title"], idx)
        if why:
            stats["withheld_" + why] += 1
            continue
        out.append(record("younger", aid, FIRMS["younger"]["base"], d, st, county, fips, acres,
                          sum(r["sold"] for r in rows) if tot_all else None, rows))
    return out


# ---- Horning

H_ACRES = re.compile(r"(\d[\d,]*(?:\.\d+)?|\.\d+)\s*(?:\+\s*/\s*-\s*|±\s*)?(?:GROSS\s+)?(?:ACRES?|AC\b\.?)", re.I)
H_SOLD = re.compile(r"^Sold Price:\s*\$\s*(\d[\d,]*)(?:\.\d\d)?$", re.I)
H_NOT_LAND = re.compile(r"WOOD|TIMBER|COMMERCIAL|ZONED|HOME\b|HOUSE|APARTMENT|MOBILE|CAMP|EQUIPMENT", re.I)


def horning_items(folder):
    items = []
    names = ["current.html"] + sorted((os.path.join("archive", f) for f in os.listdir(os.path.join(folder, "archive")) if f.endswith(".html")),
                                      key=lambda f: int(re.search(r"(\d+)", f).group(1))) if os.path.isdir(os.path.join(folder, "archive")) else ["current.html"]
    for rel in names:
        fp = os.path.join(folder, rel)
        if not os.path.isfile(fp):
            continue
        page = open(fp, encoding="utf-8", errors="replace").read()
        for e in page.split('<div class="group vertical-align auctionlisting')[1:]:
            h = re.search(r'<h3><a href="([^"]*)">(.*?)</a></h3>', e, re.S)
            if not h:
                continue
            dates = [clean(x) for x in re.findall(r'<p class="auction-date">(.*?)</p>', e, re.S)]
            addr = re.search(r'<p class="auction-address">(.*?)</p>', e, re.S)
            st = re.search(r",\s*([A-Z]{2})\s+\d{5}", clean(addr.group(1))) if addr else None
            desc = re.search(r'<div class="auction-description">(.*?)</div>', e, re.S)
            items.append({"url": html.unescape(h.group(1)), "title": clean(h.group(2)), "dates": dates,
                          "addr_state": st.group(1) if st else None, "desc": clean(desc.group(1)) if desc else "", "page": rel})
    return items


def horning_build(items, idx, captured, stats):
    out, seen = [], set()
    pre = FIRMS["horning"]["prefix"]
    for it in items:
        sold = next((H_SOLD.match(x) for x in it["dates"] if H_SOLD.match(x)), None)
        m = re.match(re.escape(pre) + r"([a-z0-9-]+)/([a-z0-9-]+)/?$", it["url"])
        if not sold:
            stats["no_plain_sold_price"] += 1
            continue
        if not m or m.group(1) not in ("farm", "land"):
            stats["not_a_farm_or_land_entry"] += 1
            continue
        ac = H_ACRES.findall(it["title"])
        if len(ac) != 1 or H_NOT_LAND.search(it["title"]):
            stats["not_farmland" if len(ac) == 1 else "acres_unclear"] += 1
            continue
        acres = num(ac[0])
        if acres < MIN_ACRES:
            stats["not_farmland"] += 1
            continue
        d = mdy(it["dates"][0]) if it["dates"] else None
        if not d:
            stats["no_date"] += 1
            continue
        if d > captured:
            stats["future_date"] += 1
            continue
        aid = m.group(2)
        if aid in seen or not ID_OK.match(aid) or len(aid) > 160:
            stats["id_unusable"] += 1
            continue
        county, st, fips, why = find_county(it["title"] + " ; " + it["desc"], it["title"] + " ; " + (", " + it["addr_state"] + " 00000" if it["addr_state"] else ""),
                                            idx)
        if why:
            stats["withheld_" + why] += 1
            continue
        seen.add(aid)
        out.append(record("horning", aid, it["url"], d, st, county, fips, acres, int(sold.group(1).replace(",", "")),
                          [{"tracts": "1", "sold": int(sold.group(1).replace(",", "")), "per_acre": None}]))
    return out


# ---- Martin's

M_FARM = re.compile(r"\bFARM(?:LAND)?\b|\bTILLABLE\b|\bPASTURE\b|\bFARMLAND\b", re.I)
M_SOLD = re.compile(r"^SOLD\W*\$?\s*(\d[\d,]*)(?:\.\d\d)?\b", re.I)
M_DAY = re.compile(r"\b(?:MON|TUE|WED|THU|FRI|SAT|SUN)[A-Z]*\.?,?\s+([A-Z]{3,9})\.?\s+(\d{1,2})(?:ST|ND|RD|TH)?,?\s+(\d{4})\b", re.I)
M_WEEKDAY = re.compile(r"\b(?:MON|TUE|WED|THU|FRI|SAT|SUN)[A-Z]*\.", re.I)


def martins_items(folder):
    items, seen = [], set()
    fp = os.path.join(folder, "feed.xml")
    pages = 0
    if os.path.isfile(fp):
        pages += 1
        feed = open(fp, encoding="utf-8", errors="replace").read()
        for it in re.findall(r"<item\b.*?</item\s*>", feed, re.I | re.S):
            link = re.search(r"<link>\s*([^<\s]+)", it)
            ti = re.search(r"<title>(.*?)</title>", it, re.S)
            body = re.search(r"<content:encoded><!\[CDATA\[(.*?)\]\]>", it, re.S) or re.search(r"<description><!\[CDATA\[(.*?)\]\]>", it, re.S)
            if link and ti and link.group(1) not in seen:
                seen.add(link.group(1))
                items.append({"url": link.group(1), "title": clean(ti.group(1)), "body": clean(body.group(1)) if body else "", "page": "feed.xml"})
    names = ["current.html"] + [os.path.join("archive", f) for f in sorted(os.listdir(os.path.join(folder, "archive")))
                                if f.endswith(".html")] if os.path.isdir(os.path.join(folder, "archive")) else ["current.html"]
    for rel in names:
        fp = os.path.join(folder, rel)
        if not os.path.isfile(fp):
            continue
        page = open(fp, encoding="utf-8", errors="replace").read()
        for li in re.split(r'<li class="[^"]*\bproduct\b[^"]*"', page)[1:]:
            l = re.search(r'<a href="(https://martinsauctionservice\.com/product/[^"]*)"', li)
            t = re.search(r"woocommerce-loop-product__title[^>]*>(.*?)</h2>", li, re.S)
            if l and t and l.group(1) not in seen:
                seen.add(l.group(1))
                items.append({"url": l.group(1), "title": clean(t.group(1)), "body": "", "page": rel})
    return items


def martins_build(items, idx, captured, stats):
    out, seen = [], set()
    pre = FIRMS["martins"]["prefix"]
    for it in items:
        t = it["title"]
        sold = M_SOLD.match(t)
        if not sold:
            stats["no_sold_price"] += 1
            continue
        ac = H_ACRES.findall(t)
        if len(ac) != 1 or re.search(r"PERSONAL PROPERTY|EQUIPMENT|ANTIQUE", t, re.I) or not M_FARM.search(t) or num(ac[0]) < MIN_ACRES:
            stats["not_farmland" if len(ac) == 1 else "acres_unclear"] += 1
            continue
        days = M_DAY.findall(t)
        if len(days) != 1 or len(M_WEEKDAY.findall(t)) != 1 or days[0][0][:3].lower() not in MONTHS:
            stats["date_not_in_title"] += 1
            continue
        d = datetime(int(days[0][2]), MONTHS[days[0][0][:3].lower()], int(days[0][1])).strftime("%Y-%m-%d")
        if d > captured:
            stats["future_date"] += 1
            continue
        m = re.match(re.escape(pre) + r"([a-z0-9-]+)/?$", it["url"])
        aid = m.group(1) if m else ""
        if not m or aid in seen or not ID_OK.match(aid) or len(aid) > 160:
            stats["id_unusable"] += 1
            continue
        county, st, fips, why = find_county(t + " ; " + it["body"], t, idx)
        if why:
            stats["withheld_" + why] += 1
            continue
        seen.add(aid)
        price = int(sold.group(1).replace(",", ""))
        out.append(record("martins", aid, it["url"], d, st, county, fips, num(ac[0]), price,
                          [{"tracts": "1", "sold": price, "per_acre": None}]))
    return out


READERS = {"wieman": (wieman_items, wieman_build), "younger": (younger_items, younger_build),
           "horning": (horning_items, horning_build), "martins": (martins_items, martins_build)}


def captured_of(folder):
    mp = os.path.join(folder, "manifest.json")
    if os.path.isfile(mp):
        with open(mp, encoding="utf-8") as fh:
            c = (json.load(fh).get("captured_utc") or "")[:10]
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", c):
            return c
    b = os.path.basename(os.path.normpath(folder))
    return b if re.fullmatch(r"\d{4}-\d{2}-\d{2}", b) else datetime.now(timezone.utc).strftime("%Y-%m-%d")


class Counter(dict):
    def __missing__(self, k):
        return 0


def read_folder(firm, folder, idx):
    """(records, stats, captured) for one saved capture folder of one firm."""
    items_fn, build_fn = READERS[firm]
    captured = captured_of(folder)
    items = items_fn(folder)
    stats = Counter()
    recs = build_fn(items, idx, captured, stats)
    stats["records_seen"] = len(items)
    stats["pages"] = sum(1 for _, _, fs in os.walk(folder) for f in fs if f.endswith((".html", ".xml")))
    return recs, stats, captured


def folders(firm, base=LAND):
    d = os.path.join(base, firm, "capture")
    return sorted(os.path.join(d, x) for x in os.listdir(d) if re.fullmatch(r"\d{4}-\d{2}-\d{2}", x)) if os.path.isdir(d) else []


# ---------------------------------------------------------------- output

def valid(rec, firm, idx):
    try:
        f = FIRMS[firm]
        isnum = lambda v: isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0
        ok = (isinstance(rec, dict) and set(rec) == KEYS and rec["source"] == firm and rec["kind"] == "auction"
              and rec["credit"] == f["credit"] and ID_OK.match(rec["auction_id"]) and len(rec["auction_id"]) <= 160
              and isinstance(rec["url"], str) and URL_OK.match(rec["url"]) and rec["url"].startswith(f["prefix"])
              and re.fullmatch(r"\d{4}-\d{2}-\d{2}", rec["date"]) and rec["state"] in STATES
              and RS.COUNTY_NAME.fullmatch(rec["county"]) and idx.get((rec["state"], norm_name(rec["county"]))) == rec["county_fips"]
              and isnum(rec["headline_acres"]) and rec["headline_acres"] >= MIN_ACRES
              and (rec["total_sold"] is None or (type(rec["total_sold"]) is int and rec["total_sold"] > 0))
              and isinstance(rec["tracts"], list) and rec["tracts"]
              and all(isinstance(x, dict) and set(x) == {"tracts", "sold", "per_acre"} and TRACT_OK.match(x["tracts"])
                      and (x["sold"] is None or (type(x["sold"]) is int and x["sold"] > 0))
                      and (x["per_acre"] is None or (type(x["per_acre"]) is int and 0 < x["per_acre"] <= RS.MAX_PER_ACRE))
                      and (x["sold"] is not None or x["per_acre"] is not None) for x in rec["tracts"]))
        return bool(ok)
    except (KeyError, TypeError, AttributeError):
        return False


def write_merged(firm, out, new, last_run, checked):
    old = {}
    if os.path.exists(out):
        with open(out, encoding="utf-8") as fh:
            old = json.load(fh)
    prev = old.get("records") or []
    recs = RS.merge(prev, new)
    if len(recs) < len(prev):
        print(f"read_land_firms: {firm}: refusing to write {len(recs)} record(s) over {len(prev)}")
        return 1
    f = FIRMS[firm]
    doc = {"source": firm, "credit": f["credit"], "credit_url": f["credit_url"],
           "checked": max(filter(None, [checked, old.get("checked")]), default=None), "last_run": last_run, "records": recs}
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out + ".tmp", "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=1, sort_keys=True)
        fh.write("\n")
    os.replace(out + ".tmp", out)
    print(f"read_land_firms: {firm}: {len(recs)} record(s) in {os.path.relpath(out, ROOT)}")
    return 0


def read_firm(firm, dirs, idx):
    """Records over the given folders, oldest first (a later read never rewrites an earlier record)."""
    recs, last, cap = [], {}, None
    for d in dirs:
        r, st, cap = read_folder(firm, d, idx)
        recs = RS.merge(recs, r)
        last = {k: v for k, v in st.items()}
        last["captured"] = cap
    return recs, last, cap


def summary(firm, last):
    skips = ", ".join(f"{k} {v}" for k, v in sorted(last.items()) if k not in ("pages", "records_seen", "captured") and v)
    return f"read_land_firms: {firm}: {last.get('pages', 0)} page(s), {last.get('records_seen', 0)} entries read; skipped: {skips or 'none'}"


def merge_file(firm, src, out, idx):
    with open(src, encoding="utf-8") as fh:
        doc = json.load(fh)
    recs = doc.get("records") if isinstance(doc, dict) else None
    if not isinstance(recs, list):
        print(f"read_land_firms: {firm}: the file to merge has no records list")
        return 1
    good = [r for r in recs if valid(r, firm, idx)]
    if len(good) != len(recs):
        print(f"read_land_firms: {firm}: {len(recs) - len(good)} record(s) in the file to merge are not in the reader's shape; nothing written")
        return 1
    lr = doc.get("last_run") if isinstance(doc.get("last_run"), dict) else {}
    lr = {k: v for k, v in lr.items() if k in LAST_RUN_KEYS and (isinstance(v, int) or (k == "captured" and isinstance(v, str)
          and re.fullmatch(r"\d{4}-\d{2}-\d{2}", v)))}
    # skip counts are plain integers named for a reason; keep the ones we know
    lr.update({k: v for k, v in (doc.get("last_run") or {}).items() if re.fullmatch(r"[a-z_]{3,40}", k) and isinstance(v, int) and not isinstance(v, bool)})
    return write_merged(firm, out, good, lr, lr.get("captured"))


# ---------------------------------------------------------------- selftest

def selftest():
    import shutil
    import tempfile
    fails = []

    def check(ok, what):
        print(("ok   " if ok else "FAIL ") + what)
        if not ok:
            fails.append(what)

    idx = county_index()
    tmp = tempfile.mkdtemp(prefix="land-firms-read-")
    try:
        caps = {}
        for firm in FIRMS:
            src = os.path.join(FIXTURES, firm)
            dst = os.path.join(tmp, firm, "capture", "2026-11-08")
            shutil.copytree(src, dst)
            caps[firm] = dst
        # ---- Wieman
        recs, st, cap = read_folder("wieman", caps["wieman"], idx)
        by = {r["auction_id"]: r for r in recs}
        check(cap == "2026-11-08" and sorted(by) == ["2022-11-29-1", "2022-12-01-1", "2026-10-30-1"],
              f"wieman: three farmland sales kept ({sorted(by)}; {dict(st)})")
        r = by.get("2026-10-30-1") or {}
        check([x["tracts"] for x in r.get("tracts", [])] == ["1", "2", "4"] and r.get("county") == "Aurora" and r.get("state") == "SD"
              and r.get("county_fips") == "46003", "wieman: the $0 placeholder tracts are skipped, Aurora County SD")
        check(r.get("headline_acres") == 358.88 and r.get("total_sold") == 2946973 and [x["per_acre"] for x in r["tracts"]] == [9250, 6000, 8050],
              "wieman: acres and total are the sums of the priced rows, per acre as printed")
        check(r.get("url") == "https://www.wiemanauction.com/land-auction-results.php?year=2026", "wieman: link to the year page")
        r = by.get("2022-11-29-1") or {}
        check(r.get("county") == "Douglas" and r.get("headline_acres") == 130.41 and r["tracts"][0]["sold"] == 1369305, "wieman: single tract, Douglas County")
        check(st["lease_not_a_sale"] == 1 and st["placeholder_row"] == 4 and st["withheld_multi_county"] == 1 and st["not_farmland"] == 1 and st["no_priced_row"] == 1,
              f"wieman: lease, placeholders, an all-$0 sale, a two-county title and a house are counted and left out ({dict(st)})")
        check("2026-11-06-1" not in by, "wieman: a sale with only $0 rows gives no record")
        # ---- Younger
        recs, st, cap = read_folder("younger", caps["younger"], idx)
        by = {r["auction_id"]: r for r in recs}
        check(sorted(by) == ["2023-12-07-1", "2026-03-24-1", "2026-03-26-1", "2026-09-30-1"], f"younger: four records ({sorted(by)}; {dict(st)})")
        r = by.get("2026-03-24-1") or {}
        check(r.get("county") == "Nodaway" and r.get("state") == "MO" and r.get("total_sold") is None
              and r.get("headline_acres") == 166 and [(x["per_acre"], x["sold"]) for x in r["tracts"]] == [(6500, None), (7025, None), (7400, None)],
              "younger: per acre kept, no price worked out from acres, no total")
        r = by.get("2023-12-07-1") or {}
        check(r.get("county") == "Gentry" and r.get("state") == "MO" and r.get("headline_acres") == 148 and r["tracts"][0]["per_acre"] == 8650,
              "younger: '148 +/- Acres - $8650.00 / acre' read, state spelled out in the title")
        r = by.get("2026-09-30-1") or {}
        check(r.get("county") == "Page" and r.get("state") == "IA" and r.get("county_fips") == "19145", "younger: 'Page County IA'")
        check(st["withheld_no_state_named"] == 1 and st["withheld_state_unclear"] == 1 and st["no_date"] == 1 and st["no_per_acre_row"] == 1,
              f"younger: a title with no state, two counties in two states, no date and a house-only sale are left out ({dict(st)})")
        dump = json.dumps(recs)
        check(not any(w in dump for w in ("Jameson", "Owner", "Dalbey")), "younger: no owner or title text in a record")
        # ---- Horning
        recs, st, cap = read_folder("horning", caps["horning"], idx)
        hb = {r["auction_id"]: r for r in recs}
        check(sorted(hb) == ["87-acre-horse-livestock-farm", "compass-road-red-rose-lane-honey-brook"], f"horning: two farms with a county in their text ({sorted(hb)}; {dict(st)})")
        r = hb.get("87-acre-horse-livestock-farm") or {}
        check(r.get("county") == "Berks" and r.get("state") == "PA" and r.get("headline_acres") == 87 and r.get("date") == "2022-05-26"
              and r.get("total_sold") == 1400000 and r.get("tracts") == [{"tracts": "1", "sold": 1400000, "per_acre": None}],
              "horning: Berks County, PA, one price, no per acre")
        check(hb["compass-road-red-rose-lane-honey-brook"]["county"] == "Chester" and recs[0]["url"].startswith("https://www.horningfarmagency.com/auction/farm/") and "Main" not in json.dumps(recs),
              "horning: link is the entry's own page, no street address kept")
        check(st["withheld_no_county_named"] >= 1 and st["not_farmland"] >= 1 and st["no_plain_sold_price"] >= 1,
              f"horning: a farm with no county, a house and an unsold entry are left out ({dict(st)})")
        # ---- Martin's
        recs, st, cap = read_folder("martins", caps["martins"], idx)
        by = {r["auction_id"]: r for r in recs}
        check(sorted(by) == ["33-acre-farm-auction-mt-pleasant-mills-pa-tue-june-30-2026-600-pm",
                             "poultry-farm-auction-on-25-acres-newburg-pa-tue-january-27-2026-100-pm"], f"martins: two farms kept ({sorted(by)}; {dict(st)})")
        r = by.get("33-acre-farm-auction-mt-pleasant-mills-pa-tue-june-30-2026-600-pm") or {}
        check(r.get("date") == "2026-06-30" and r.get("county") == "Snyder" and r.get("total_sold") == 965000,
              "martins: the date is the one in the title (the feed pubDate is April), county from the feed text")
        check(st["withheld_no_county_named"] == 1 and st["not_farmland"] == 3 and st["acres_unclear"] == 1,
              f"martins: a farm with no county text, houses and a mixed personal property sale are left out ({dict(st)})")
        # ---- shape, merge, join
        for firm in FIRMS:
            r, s, c = read_folder(firm, caps[firm], idx)
            bad = {k for rec in r for k in rec} & {"buyer", "buyers", "purchaser", "owner", "name", "bidder", "seller", "address"}
            check(not bad and all(valid(x, firm, idx) for x in r) and all(x["credit"] == "Results reported by " + FIRMS[firm]["name"] for x in r),
                  f"{firm}: no buyer or owner field, every record in the shape, the firm's credit")
        out = os.path.join(tmp, "out", "wieman.json")
        recs, last, cap = read_firm("wieman", [caps["wieman"]], idx)
        check(write_merged("wieman", out, recs, last, cap) == 0 and len(json.load(open(out))["records"]) == 3, "a firm's file is written")
        side = os.path.join(tmp, "side.json")
        write_merged("wieman", side, recs, last, cap)
        tgt = os.path.join(tmp, "tgt.json")
        check(merge_file("wieman", side, tgt, idx) == 0 and len(json.load(open(tgt))["records"]) == 3, "--merge takes a clean file")
        good = json.load(open(side))
        for label, mutate in (("an extra field", lambda r: r.update(buyer="x")),
                              ("county text that is not a county", lambda r: r.update(county="1234 Elm Rd")),
                              ("a link off the firm", lambda r: r.update(url="https://example.com/")),
                              ("another firm's credit", lambda r: r.update(credit="Results reported by Nobody")),
                              ("a bool price", lambda r: r["tracts"][0].update(sold=True)),
                              ("a row with no figure", lambda r: r["tracts"][0].update(sold=None, per_acre=None)),
                              ("a county that does not match its FIPS", lambda r: r.update(county="Hanson"))):
            d = json.loads(json.dumps(good))
            mutate(d["records"][0])
            json.dump(d, open(side, "w"))
            before = open(tgt).read()
            check(merge_file("wieman", side, tgt, idx) == 1 and open(tgt).read() == before, "--merge refuses " + label)
        # a saved record is never rewritten
        d = json.loads(json.dumps(good))
        d["records"][0]["tracts"][0]["sold"] += 1
        json.dump(d, open(side, "w"))
        saved = json.load(open(tgt))["records"]
        check(merge_file("wieman", side, tgt, idx) == 0 and json.load(open(tgt))["records"] == saved, "--merge keeps the saved record over a changed price")
        # ---- county rules
        fc = lambda c, s=None, fb=None: find_county(c, s if s is not None else c, idx, fb)[3] or find_county(c, s if s is not None else c, idx, fb)[:2]
        check(fc("HUTCHINSON & TURNER COUNTY LAND AUCTION", None, "SD") == "multi_county", "two counties joined by & are withheld")
        check(fc("520 ACRES MC COOK - HANSON - HUTCHINSON COUNTY LAND", None, "SD") == "multi_county", "three counties joined by dashes are withheld")
        check(fc("PLEASANT TOWNSHIP - JERAULD COUNTY LAND", None, "SD") == ("Jerauld", "SD"), "a township before the dash is not a county")
        check(fc("Absolute Nodaway County MO Land Auction") == ("Nodaway", "MO"), "state letters right after the county")
        check(fc("Nodaway County Land Auction") == "no_state_named" and fc("Marion, SD", "Marion, SD") == "no_county_named",
              "no state named, and a town never becomes a county")
        check(fc("Absolute Farmland Auction - Brown County, Kansas") == ("Brown", "KS"), "a state spelled out")
        check(fc("Taylor Co., Iowa Land Auction") == ("Taylor", "IA"), "'Co.' for County")
        check(fc("LAND AT AUCTION IN HUTCHINSON COUNTY", None, "SD") == ("Hutchinson", "SD"), "the capital 'IN' in a title is not Indiana")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print(f"read_land_firms selftest: {len(fails)} failure(s)")
    return 1 if fails else 0


def main(argv):
    if "--selftest" in argv:
        return selftest()

    def arg(flag):
        i = argv.index(flag)
        return argv[i + 1] if i + 1 < len(argv) else None
    idx = county_index()
    firms = [arg("--firm")] if "--firm" in argv else list(FIRMS)
    if any(f not in FIRMS for f in firms):
        print("read_land_firms: unknown firm")
        return 2
    if "--merge-dir" in argv:
        d, code = arg("--merge-dir"), 0
        for firm in firms:
            src = os.path.join(d or "", firm + ".json")
            if not os.path.isfile(src):
                print(f"read_land_firms: {firm}: no file to merge ({src}); skipped")
                continue
            code = merge_file(firm, src, os.path.join(OUT_DIR, firm + ".json"), idx) or code
        return code
    if "--capture" in argv:
        dirs = {firms[0]: [arg("--capture")]}
    elif "--latest" in argv:
        dirs = {f: folders(f)[-1:] for f in firms}
    elif "--all" in argv:
        dirs = {f: folders(f) for f in firms}
    else:
        print("read_land_firms: give --all, --latest, --capture <folder> --firm <firm>, --merge-dir <dir> or --selftest")
        return 2
    code = 0
    for firm in firms:
        if not dirs.get(firm) or not all(d and os.path.isdir(d) for d in dirs[firm]):
            print(f"read_land_firms: {firm}: no saved capture folder; skipped")
            continue
        recs, last, cap = read_firm(firm, dirs[firm], idx)
        print(summary(firm, last))
        if "--out" in argv:
            out = arg("--out")
        else:
            od = arg("--out-dir") if "--out-dir" in argv else OUT_DIR
            out = os.path.join(od, firm + ".json")
        kept = len(recs)
        last["kept"] = kept
        # the facts-only file holds this read only; history is merged by --merge-dir on main
        code = write_merged(firm, out, recs, last, cap) or code
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
