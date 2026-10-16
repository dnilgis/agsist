#!/usr/bin/env python3
"""
AGSIST -- data/fertilizer-coops.json for fertilizer.html: retail fertilizer
prices that farm co-ops post on their own websites.

WHY IT LIVES HERE AND NOT IN dnilgis/bids
  The output feeds one agsist page, the same way scripts/fetch_fert_ams.py
  feeds the USDA box beside it: a stdlib Python reader on a GitHub runner that
  writes one small JSON file and commits it. dnilgis/bids is a Node pipeline
  built around grain-bid boards and a browser; a co-op's fertilizer page is a
  hand-typed table, not a bid board, so none of its adapters apply.

WHERE THE CO-OPS COME FROM
  scripts/coop_fert_sources.json, one line per co-op: the four co-op price
  pages Sig sent on 2026-10-15. Nothing searches for more (Sig, Oct 15: "stop
  looking for fertilizer prices for now and just use the pricing data that i
  provided"). A one-off discovery run that day asked 273 Barchart/AgriCharts
  co-op sites from the dnilgis/bids lists and found no others posting prices. Parsers go by page
  LAYOUT, not by co-op, so a new co-op with a known layout is one config line:
    html-table  a price table typed into a Barchart / AgriCharts co-op page
                (pages/custom.php?id=..., /fertilizer). Columns are read from
                the table's own header row: charge, cash, pre-pay, discount,
                ton price, cwt, per unit, date changed.
    pdf-sheet   a dated price sheet PDF (an AgriCharts site's media folder).
                The entry may give "index" (a page on the co-op's site that
                links the current sheet); the newest dated sheet linked there
                is read, else "url".
    sheet       a price list the co-op sent Sig rather than posts (Sig, Oct 16:
                "just publish prices as a new coop"). Its rows are typed into
                the config line itself: "rows": [{raw, cash, charge, date}].
                No fetch. The rows go through the same checks as every other
                co-op (bands, cash not above charge, the 60-day stale rule);
                "url" may be null when no co-op page was verified, and the
                page then names the co-op without a link.

Modes:
  (default)    fetch every co-op, parse, check, write data/fertilizer-coops.json
               and append changes to data/fertilizer-coops-history.json.
  --sheets-only  no network: rebuild only the "sheet" co-ops from the config
               and carry every other co-op's last read exactly as it is on
               file (re-aged to today). For a config change to a sheet co-op.
  --selftest   offline tests on test/fixtures/coop-fert/.

WHAT THIS FILE WILL NOT DO
  * Invent a date. A row's date is the one the co-op shows on that row, else
    the one the page shows for the whole sheet, else none: the row then
    carries first_seen (the first day this reader saw that price) and says so.
  * Count a stale row. A row whose date (or first_seen) is more than 60 days
    old is kept and shown as stale but left out of every summary.
  * Keep a price outside a plausible band for its product. It is dropped and
    the reason is logged in the co-op's `dropped` list.
  * Average blindly. A per-unit or cwt figure that does not match the ton
    price, or a cash price above the charge price, keeps the row out of the
    summary. Summaries are middle values (medians), and a co-op far from the
    others is flagged, not hidden.
  * Call one co-op's price a middle price. With two co-ops the middle is the
    average of the two and says so; with one, the co-op is named.
  * Overwrite a co-op's last good rows with nothing when its page fails.

Stdlib only, plus pdftotext (poppler) or pypdf for a PDF sheet.
"""
import datetime
import html
import html.parser
import json
import os
import re
import sys
import time
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fetch_dairy import http_get, pdf_to_text  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CONFIG = "scripts/coop_fert_sources.json"
OUT = "data/fertilizer-coops.json"
HIST = "data/fertilizer-coops-history.json"
FIX_DIR = "test/fixtures/coop-fert"
UA = "agsist.com fertilizer price reader (contact: sig@farmers1st.com)"

STALE_DAYS = 60
MIN_MEDIAN = 2          # a middle price from 2 co-ops up (2: the average of the two)
FAR_MIN = 3             # "far from the others" needs at least 3 co-ops
FAR_FROM_OTHERS = 0.25  # flag a cash price this far from the middle of the others
HIST_MAX_KB = 1024      # history file cap; also in scripts/check_site_budget.py FILE_KB
PAUSE = 1.5             # seconds between requests to co-op sites

# key -> (display name, canonical grade (N, P2O5, K2O, S), plausible $/ton band)
PRODUCTS = {
    "anhydrous": ("Anhydrous ammonia", (82, 0, 0, 0), (400, 2000)),
    "urea":      ("Urea", (46, 0, 0, 0), (300, 1500)),
    "uan28":     ("UAN 28%", (28, 0, 0, 0), (200, 900)),
    "uan32":     ("UAN 32%", (32, 0, 0, 0), (220, 1000)),
    "dap":       ("DAP", (18, 46, 0, 0), (400, 1600)),
    "map":       ("MAP", (11, 52, 0, 0), (400, 1700)),
    "potash":    ("Potash", (0, 0, 60, 0), (250, 1100)),
    "ams":       ("AMS", (21, 0, 0, 24), (250, 1000)),
    "10-34-0":   ("10-34-0", (10, 34, 0, 0), (300, 1300)),
    "thiosul":   ("Thio-Sul", (12, 0, 0, 26), (200, 900)),
    "other":     ("Other", None, (50, 3000)),
}
ORDER = [k for k in PRODUCTS if k != "other"]
SYMBOL = {"anhydrous": "82-0-0", "urea": "46-0-0", "uan28": "28-0-0", "uan32": "32-0-0", "dap": "18-46-0",
          "map": "11-52-0", "potash": "0-0-60", "ams": "21-0-0-24S", "10-34-0": "10-34-0", "thiosul": "12-0-0-26S"}
GRADE_KEY = {(82, 0, 0, 0): "anhydrous", (46, 0, 0, 0): "urea", (28, 0, 0, 0): "uan28", (32, 0, 0, 0): "uan32",
             (18, 46, 0, 0): "dap", (11, 52, 0, 0): "map", (0, 0, 60, 0): "potash", (0, 0, 62, 0): "potash",
             (21, 0, 0, 24): "ams", (10, 34, 0, 0): "10-34-0", (12, 0, 0, 26): "thiosul"}
MONEY_COLS = ("prepay", "charge", "list", "cash", "discount", "cash_pickup")
BASIS_LABEL = {"prepay": "pre-pay", "charge": "charge", "list": "ton price", "cash": "cash",
               "discount": "discount", "cash_pickup": "cash pickup"}
MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august",
          "september", "october", "november", "december"]
NOT_PRODUCT = re.compile(r"rent|rental|applicat|spread|blend|service|custom|acre|delivery|charge\b|surcharge", re.I)


# ---------------------------------------------------------------- products
GRADE_RE = re.compile(r"(?<![\d.])(\d{1,2})-(\d{1,2})-(\d{1,2})(?:\s*[-+]\s*(\d{1,2})\s*s?\b)?(?![\d.])", re.I)


def grade_of(raw):
    m = GRADE_RE.search(raw or "")
    if not m:
        return None
    return tuple(int(x) for x in m.groups()[:3]) + (int(m.group(4)) if m.group(4) else 0,)


def product_key(raw):
    """Normalize a co-op's product name to one of PRODUCTS (else 'other')."""
    t = re.sub(r"\s+", " ", (raw or "").lower()).strip()
    if re.search(r"super\s*u\b|superu|agrotain|esn|blend|mesz|poly|k-?mag|lime|sulfur|boost", t):
        return "other"
    g = grade_of(t)
    if g:
        return GRADE_KEY.get(g, "other")
    if re.search(r"anhydrous|\bnh3\b", t):
        return "anhydrous"
    if re.search(r"\burea\b", t):
        return "urea"
    m = re.search(r"(?:\buan\b\D{0,4}|^)(28|32)\s*%", t) or re.search(r"\buan\s*(28|32)\b", t)
    if m:
        return "uan" + m.group(1)
    if re.search(r"\bdap\b|diammonium", t):
        return "dap"
    if re.search(r"\bmap\b|monoammonium", t):
        return "map"
    if re.search(r"\bpotash\b|muriate", t):
        return "potash"
    if re.search(r"\bams\b|ammonium sulfate|ammonium sulphate", t):
        return "ams"
    if re.search(r"thio-?sul|\bats\b", t):
        return "thiosul"
    return "other"


# ---------------------------------------------------------------- dates
def mk_date(y, m, d, today):
    if y < 100:
        y += 2000
    try:
        dt = datetime.date(y, m, d)
    except ValueError:
        return None
    if dt > today + datetime.timedelta(days=1) or dt.year < 2015:
        return None
    return dt


def row_date(s, today):
    """A per-row date as co-ops type it: 10.1.26, 6.1.2022, 10/06/2026, 9-24-26."""
    m = re.fullmatch(r"\s*(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})\s*", s or "")
    if not m:
        return None
    return mk_date(int(m.group(3)), int(m.group(1)), int(m.group(2)), today)


def page_dates(text, today):
    """Full dates written on a page or sheet: 'October 6th , 2026', '10/06/2026'."""
    out = []
    for m in re.finditer(r"\b(" + "|".join(MONTHS) + r"|sept?|oct|nov|dec|jan|feb|mar|apr|jun|jul|aug)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*(20\d\d)\b", text, re.I):
        mon = m.group(1).lower()[:3]
        mo = [x[:3] for x in MONTHS].index(mon) + 1
        d = mk_date(int(m.group(3)), mo, int(m.group(2)), today)
        if d:
            out.append(d)
    for m in re.finditer(r"(?<![\d/])(\d{1,2})/(\d{1,2})/(20\d\d)(?![\d/])", text):
        d = mk_date(int(m.group(3)), int(m.group(1)), int(m.group(2)), today)
        if d:
            out.append(d)
    return out


def one_date(text, today):
    """The page's date when it shows exactly one distinct date, else None."""
    ds = sorted(set(page_dates(text, today)))
    return ds[0] if len(ds) == 1 else None


# ---------------------------------------------------------------- html tables
class Tables(html.parser.HTMLParser):
    """Every <table> as a list of rows of cell texts. Text goes to the innermost
    open table, so a layout table wrapped around a price table stays empty."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables, self.stack, self.text, self.skip = [], [], [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.skip += 1
        elif tag == "table":
            t = []
            self.tables.append(t)
            self.stack.append(t)
        elif tag == "tr" and self.stack:
            self.stack[-1].append([])
        elif tag in ("td", "th") and self.stack:
            if not self.stack[-1]:
                self.stack[-1].append([])
            self.stack[-1][-1].append("")
        elif tag in ("br", "p", "div", "li"):
            self._put(" ")
            self.text.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.skip = max(0, self.skip - 1)
        elif tag == "table" and self.stack:
            self.stack.pop()
        elif tag in ("p", "div", "li", "tr", "h1", "h2", "h3", "h4"):
            self.text.append("\n")

    def _put(self, s):
        if self.stack and self.stack[-1] and self.stack[-1][-1]:
            self.stack[-1][-1][-1] += s

    def handle_data(self, data):
        if self.skip:
            return
        self._put(data)
        self.text.append(data)


def clean(s):
    return re.sub(r"\s+", " ", (s or "").replace("\xa0", " ")).strip()


def col_role(h):
    h = clean(h).lower().replace("_", " ")
    if not h:
        return None
    if re.search(r"rent|service", h):
        return "reject"
    if "cash" in h and "unit" in h:
        return "cash+unit"
    if re.search(r"pre-?\s?pay|prepaid", h):
        return "prepay"
    if "charge" in h:
        return "charge"
    if "discount" in h:
        return "discount"
    if re.search(r"cash.*(p/u|pick)", h):
        return "cash_pickup"
    if "cash" in h:
        return "cash"
    if "cwt" in h:
        return "cwt"
    if "unit" in h:
        return "per_unit"
    if re.search(r"change|date|updated|effective", h):
        return "date"
    if re.search(r"ton price|per ton|^price$|^ton$", h):
        return "list"
    if re.search(r"product|fertilizer|item|grade", h):
        return "product"
    return None


MONEY_RE = re.compile(r"\$?\s*(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+\.\d{2}|\d{3,4})(?![\d.])")


def money(cell):
    """A $/ton figure from a cell -> (value or None, note or None)."""
    c = clean(cell)
    if not c or re.fullmatch(r"(?i)n/?a|-+|call|tbd", c):
        return None, None
    if re.search(r"(?i)/\s*(gal|lb)|\bgal|\d\s*lb\b|per\s+(gal|lb)", c):
        return None, "priced per gallon or pound, not per ton (%s)" % c
    m = MONEY_RE.search(c)
    if not m:
        return None, None
    return float(m.group(1).replace(",", "")), None


def small_num(c):
    m = re.fullmatch(r"\$?\s*(\d*\.\d+)", clean(c))
    return float(m.group(1)) if m else None


def html_rows(page, today):
    """html-table layout -> (rows, page_text, problems). A row is
    dict(raw, prices{basis: $/ton}, per_unit, cwt, date, date_text, notes[])."""
    p = Tables()
    p.feed(page)
    text = "".join(p.text)
    rows, problems = [], []
    for t in p.tables:
        roles = None
        for cells in t:
            if not any(clean(c) for c in cells):
                continue
            rs = [col_role(c) for c in cells]
            if roles is None:
                found = [r for r in rs if r]
                money_roles = [r for r in found if r in MONEY_COLS or r == "cash+unit"]
                if "reject" in found:
                    break
                if money_roles and len(found) >= 2 and not any(money(c)[0] for c in cells):
                    roles = rs
                    if "product" not in roles:
                        roles[0] = "product"
                continue
            raw = clean(cells[roles.index("product")]) if roles.index("product") < len(cells) else ""
            if not raw or NOT_PRODUCT.search(raw):
                continue
            row = {"raw": raw, "prices": {}, "per_unit": None, "cwt": None, "date": None, "date_text": None, "notes": []}
            for role, cell in zip(roles, cells):
                if role in MONEY_COLS:
                    v, note = money(cell)
                    if v is not None:
                        row["prices"][role] = v
                    if note:
                        row["notes"].append("%s: %s" % (BASIS_LABEL[role], note))
                elif role == "cash+unit":
                    c = clean(cell)
                    m = re.fullmatch(r"\$?\s*([\d,]+\.\d{2})\s+\$?(\d*\.\d+)", c)
                    if m:
                        row["prices"]["cash"] = float(m.group(1).replace(",", ""))
                        row["per_unit"] = float(m.group(2))
                    else:
                        v, note = money(c)
                        if v is not None:
                            row["prices"]["cash"] = v
                        if note:
                            row["notes"].append("cash: " + note)
                elif role == "cwt":
                    v = small_num(cell)
                    if v is not None and v >= 1:
                        row["cwt"] = v
                elif role == "per_unit":
                    v = small_num(cell)
                    if v is not None and v < 10:
                        row["per_unit"] = v
                elif role == "date":
                    c = clean(cell)
                    if c:
                        d = row_date(c, today)
                        if d:
                            row["date"] = d
                        else:
                            row["date_text"] = c
            if row["prices"] or row["notes"]:
                rows.append(row)
    if not rows:
        problems.append("no price table with a charge, cash, ton price or discount column was found")
    return rows, text, problems


# ---------------------------------------------------------------- pdf sheet
def pdf_rows(text, today):
    """pdf-sheet layout: a header line naming PRODUCT and TON, then one product
    per line: name, an optional per-unit figure, then $ columns in header order.
    -> (rows, sheet_date, problems)."""
    lines = text.splitlines()
    rows, problems, cols, sheet_date = [], [], None, None
    head = "\n".join(lines[:12])
    ds = sorted(set(page_dates(head, today)))
    sheet_date = ds[0] if len(ds) == 1 else None
    for line in lines:
        u = line.upper()
        if cols is None:
            if "PRODUCT" in u and "TON" in u:
                cols = []
                for m in re.finditer(r"\S+(?: \S+)*", line[line.upper().index("PRODUCT") + 7:]):
                    h = m.group(0).strip()
                    hu = h.upper()
                    if hu == "UNIT":
                        continue
                    if "CASH" in hu and ("P/U" in hu or "PICK" in hu):
                        cols.append("cash_pickup")
                    elif "CASH" in hu:
                        cols.append("cash")
                    elif "CWT" in hu:
                        cols.append("cwt")
                    elif "TON" in hu:
                        cols.append("list")
                    elif "CHARGE" in hu:
                        cols.append("charge")
                    else:
                        cols.append(None)
            continue
        if "**" in line or not line.strip():
            if rows and "**" in line:
                break
            continue
        m = re.match(r"\s*(.+?)\s{2,}(.*)$", line)
        if not m or "$" not in m.group(2):
            continue
        raw, rest = clean(m.group(1)), m.group(2)
        if NOT_PRODUCT.search(raw):
            continue
        row = {"raw": raw, "prices": {}, "per_unit": None, "cwt": None, "date": None, "date_text": None, "notes": []}
        pu = re.match(r"\s*(\d*\.\d+)\s+\$", rest)
        if pu:
            row["per_unit"] = float(pu.group(1))
        amts = [float(x.replace(",", "")) for x in re.findall(r"\$\s*([\d,]+\.\d{2})", rest)]
        if len(amts) != len(cols):
            problems.append("%s: %d prices for %d columns; left out" % (raw, len(amts), len(cols)))
            continue
        for role, v in zip(cols, amts):
            if role == "cwt":
                row["cwt"] = v
            elif role:
                row["prices"][role] = v
        rows.append(row)
    if cols is None:
        problems.append("no PRODUCT / TON header line in the sheet")
    if not sheet_date:
        problems.append("no single date at the top of the sheet")
    return rows, sheet_date, problems


# ---------------------------------------------------------------- sheet (typed into the config)
def sheet_rows(cfg, today):
    """sheet layout: the rows typed into the co-op's config line ->
    (rows, sheet date or None, problems). A row with no label, a price that is
    not a number, or a date that is missing, not a date or after today is left
    out with a problem, never patched. n/a on the co-op's list is simply not
    entered. The sheet date is the one date every row shares, else none."""
    rows, problems = [], []
    for i, r in enumerate(cfg.get("rows") or []):
        raw = r.get("raw") if isinstance(r, dict) else None
        if not isinstance(raw, str) or not raw.strip():
            problems.append("row %d has no product name" % (i + 1))
            continue
        raw = clean(raw)
        try:
            d = datetime.date.fromisoformat(r.get("date") or "")
        except (TypeError, ValueError):
            problems.append("%s: no date" % raw)
            continue
        if d > today:
            problems.append("%s: dated after today" % raw)
            continue
        prices, bad = {}, False
        for b in ("cash", "charge"):
            v = r.get(b)
            if v is None:
                continue
            if isinstance(v, bool) or not isinstance(v, (int, float)):
                problems.append("%s: %s %r is not a number" % (raw, b, v))
                bad = True
                continue
            prices[b] = float(v)
        if bad or not prices:
            if not bad:
                problems.append("%s: no price" % raw)
            continue
        rows.append({"raw": raw, "prices": prices, "per_unit": None, "cwt": None, "date": d, "date_text": None, "notes": []})
    if not rows and not problems:
        problems.append("no rows in the config line")
    dates = {r["date"] for r in rows}
    return rows, (dates.pop() if len(dates) == 1 else None), problems


# ---------------------------------------------------------------- checks
def cash_of(row, cash_from):
    """(cash $/ton, basis) by the co-op's own label; None when not posted."""
    for b in ([cash_from] if cash_from else []) + ["cash", "cash_pickup"]:
        if b and b in row["prices"]:
            return row["prices"][b], b
    return None, None


def check_row(row, key, cash_from):
    """Band, per-unit, cwt and cash-vs-charge checks. -> (row or None if
    dropped, drop reasons, flags). A flag keeps the row on the page but out of
    every summary."""
    row = dict(row, prices=dict(row["prices"]))
    lo, hi = PRODUCTS[key][2]
    dropped, flags = [], []
    for b, v in list(row["prices"].items()):
        if not (lo <= v <= hi):
            dropped.append("%s %s $%.2f/ton is outside %d to %d for %s" % (row["raw"], BASIS_LABEL[b], v, lo, hi, key))
            del row["prices"][b]
    if not row["prices"]:
        # nothing priced per ton (a per-gallon row): kept to show, never counted
        return (None if dropped else row), dropped, flags
    tons = list(row["prices"].values())
    if row["per_unit"] is not None:
        grade = grade_of(row["raw"]) or PRODUCTS[key][1]
        ok = False
        if grade:
            for f in grade:
                if f <= 0:
                    continue
                for v in tons:
                    want = v / (2000 * f / 100.0)
                    if abs(row["per_unit"] - want) <= 0.006 + 0.01 * want:
                        ok = True
        if not ok:
            flags.append("per-unit figure %.3f does not match any ton price" % row["per_unit"])
    if row["cwt"] is not None and not any(abs(row["cwt"] * 20 - v) <= 0.006 * v + 0.2 for v in tons):
        flags.append("cwt figure %.2f does not match any ton price" % row["cwt"])
    cash, _ = cash_of(row, cash_from)
    top = max([row["prices"][b] for b in ("charge", "list", "prepay") if b in row["prices"]] or [0])
    if cash is not None and top and cash > top:
        flags.append("cash price above the charge price")
    return row, dropped, flags


def age_days(row, today):
    d = row.get("date") or row.get("first_seen")
    if not d:
        return None
    return (today - datetime.date.fromisoformat(d)).days


def build_coop(cfg, parsed, prev, today):
    """parsed = dict(rows, page_date, problems). prev = this co-op's entry in
    the last file (for first_seen). -> co-op entry."""
    prev_rows = {r["raw"]: r for r in (prev or {}).get("rows") or []}
    rows, dropped = [], []
    for r in parsed["rows"]:
        key = product_key(r["raw"])
        r, drop, flags = check_row(r, key, cfg.get("cash_from"))
        dropped += drop
        if r is None:
            continue
        cash, basis = cash_of(r, cfg.get("cash_from"))
        d = r["date"] or parsed.get("page_date")
        out = {"product": key, "raw": r["raw"], "prices": r["prices"], "cash": cash, "cash_basis": basis,
               "per_unit": r["per_unit"], "cwt": r["cwt"],
               "date": d.isoformat() if d else None,
               "date_from": "row" if r["date"] else ("page" if d else None),
               "date_text": r["date_text"], "notes": r["notes"], "flags": flags}
        if not d:
            p = prev_rows.get(r["raw"])
            same = p and p.get("prices") == out["prices"] and p.get("first_seen")
            out["first_seen"] = p["first_seen"] if same else today.isoformat()
        a = age_days(out, today)
        out["age_days"] = a
        out["stale"] = a is None or a > STALE_DAYS
        rows.append(out)
    return {"id": cfg["id"], "name": cfg["name"], "town": cfg.get("town"), "state": cfg["state"],
            "url": cfg.get("url"), "source_url": parsed.get("source_url") or cfg.get("url"), "layout": cfg["layout"],
            "cash_label": cfg.get("cash_label") or BASIS_LABEL.get(cfg.get("cash_from") or "cash"),
            "posted": parsed["page_date"].isoformat() if parsed.get("page_date") else None,
            "rows": rows, "dropped": dropped, "problems": parsed["problems"]}


def median(xs):
    xs = sorted(xs)
    n = len(xs)
    if not n:
        return None
    return xs[n // 2] if n % 2 else round((xs[n // 2 - 1] + xs[n // 2]) / 2, 2)


def summarize(coops):
    """Per product: one cash price per co-op (its first listed current row),
    the number of co-ops, low, high, their dates and, from MIN_MEDIAN co-ops
    up, the middle price. Flags rows far from the others."""
    out = []
    for key in ORDER:
        picks = []
        for c in coops:
            for r in c["rows"]:
                if r["product"] == key and r["cash"] is not None and not r["stale"] and not r["flags"]:
                    picks.append((c, r))
                    break
        if not picks:
            continue
        vals = [r["cash"] for _, r in picks]
        med = median(vals) if len(vals) >= MIN_MEDIAN else None
        far = []
        if len(vals) >= FAR_MIN:
            for c, r in picks:
                others = median([x["cash"] for cc, x in picks if cc is not c])
                if others and abs(r["cash"] - others) / others > FAR_FROM_OTHERS:
                    r["far_from_others"] = True
                    far.append(c["id"])
        # dates the co-ops show; an undated price is counted apart, never given a date
        dates = sorted(r["date"] for _, r in picks if r["date"])
        out.append({"key": key, "name": PRODUCTS[key][0], "symbol": SYMBOL[key], "n": len(vals),
                    "median": med, "low": min(vals), "high": max(vals),
                    "oldest": dates[0] if dates else None, "newest": dates[-1] if dates else None,
                    "undated": len(vals) - len(dates), "coops": [c["id"] for c, _ in picks], "far": far})
    return out


# ---------------------------------------------------------------- fetch + compose
def read_json(path):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return None


def atomic_write(path, obj, indent=1):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, indent=indent, ensure_ascii=False) + "\n")
    os.replace(tmp, path)


def get(url, opener=None, sleep=time.sleep):
    return http_get(url, headers={"User-Agent": UA}, tries=2, timeout=25, opener=opener, sleep=sleep)


def newest_pdf(index_html, base, today):
    """The newest dated sheet linked from a co-op page: hrefs ending in
    <Y>-<M>-<D>.pdf. -> (url, date) or (None, None)."""
    best = (None, None)
    for href in re.findall(r"""href\s*=\s*["']([^"']+\.pdf)["']""", index_html, re.I):
        m = re.search(r"(20\d\d)-(\d{1,2})-(\d{1,2})\.pdf$", href)
        if not m:
            continue
        d = mk_date(int(m.group(1)), int(m.group(2)), int(m.group(3)), today)
        if d and (best[1] is None or d > best[1]):
            best = (urllib.parse.urljoin(base, html.unescape(href)), d)
    return best


def read_coop(cfg, today, fetcher):
    """-> parsed dict or (None, error)."""
    if cfg["layout"] == "sheet":
        rows, d, problems = sheet_rows(cfg, today)
        return {"rows": rows, "page_date": d, "problems": problems, "source_url": cfg.get("url")}, None
    if cfg["layout"] == "html-table":
        raw, err = fetcher(cfg["url"])
        if raw is None:
            return None, "fetch failed: %s" % err
        page = raw.decode("utf-8", "replace")
        rows, text, problems = html_rows(page, today)
        return {"rows": rows, "page_date": one_date(text, today), "problems": problems, "source_url": cfg["url"]}, None
    if cfg["layout"] == "pdf-sheet":
        url = cfg.get("pdf")
        if cfg.get("index"):
            raw, err = fetcher(cfg["index"])
            if raw is not None:
                u, _ = newest_pdf(raw.decode("utf-8", "replace"), cfg["index"], today)
                url = u or url
        if not url:
            return None, "no sheet linked"
        raw, err = fetcher(url)
        if raw is None:
            return None, "fetch failed: %s" % err
        if raw[:5] != b"%PDF-":
            return None, "not a PDF at %s" % url
        text, err = pdf_to_text(raw)
        if text is None:
            return None, "PDF text: %s" % err
        rows, d, problems = pdf_rows(text, today)
        return {"rows": rows, "page_date": d, "problems": problems, "source_url": url}, None
    return None, "unknown layout %r" % cfg["layout"]


def compose(cfgs, results, existing, now, carry=False):
    """results: {id: (parsed or None, err)}. Keeps a co-op's last good rows on
    a failed read (their dates still age them out). carry=True (--sheets-only):
    a co-op with no result keeps its last read as is (ok, note, fetched), only
    re-aged; it was not read, so it did not fail."""
    today = now.date()
    prev = {c["id"]: c for c in json.loads(json.dumps((existing or {}).get("coops") or []))}  # never edit the caller's copy
    coops = []
    for cfg in cfgs:
        parsed, err = results.get(cfg["id"], (None, "not read"))
        ok = parsed is not None and bool(parsed["rows"])
        if ok:
            c = build_coop(cfg, parsed, prev.get(cfg["id"]), today)
            ok = bool(c["rows"])
        if ok:
            c["fetched"] = now.strftime("%Y-%m-%dT%H:%M:%SZ")
            c["ok"] = True
            c["note"] = None
        elif cfg["id"] in prev:
            c = prev[cfg["id"]]
            for r in c["rows"]:
                r["age_days"] = age_days(r, today)
                r["stale"] = r["age_days"] is None or r["age_days"] > STALE_DAYS
                r.pop("far_from_others", None)  # judged again below
            if carry and cfg["id"] not in results:
                coops.append(c)
                continue
            c["ok"] = False
            c["note"] = err or "; ".join((parsed or {}).get("problems") or []) or "no rows read"
        else:
            continue
        coops.append(c)
    summary = summarize(coops)
    states = {}
    for c in coops:
        if any(not r["stale"] for r in c["rows"]):
            states[c["state"]] = states.get(c["state"], 0) + 1
    return {
        "source": "Posted retail fertilizer prices on co-op websites",
        "generated": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "stale_days": STALE_DAYS, "min_median": MIN_MEDIAN,
        "conventions": "Dollars per ton. Cash is each co-op's own cash price (cash, cash discount or cash pickup, as labeled). "
                       "Rows dated over %d days ago, rows whose per-unit or cwt figure does not match, and products the reader "
                       "cannot name are shown but not summarized. One price per co-op per product: the first listed. "
                       "Middle price from %d co-ops up (from 2 it is their average); one co-op is named." % (STALE_DAYS, MIN_MEDIAN),
        "coops_total": len(coops), "coops_current": sum(states.values()), "states": states,
        "summary": summary, "coops": coops,
    }


def append_history(hist, doc, now):
    """One row per (co-op, product name) when its cash price or date changes."""
    hist = hist or {"note": "Co-op posted fertilizer prices: one row each time a co-op's cash price or its date changes. "
                            "Columns: seen (UTC date), co-op id, product, raw name, cash $/ton, basis, date shown or null.",
                    "rows": []}
    last = {}
    for r in hist["rows"]:
        last[(r[1], r[3])] = r
    seen = now.strftime("%Y-%m-%d")
    for c in doc["coops"]:
        if not c.get("ok"):
            continue
        for r in c["rows"]:
            if r["cash"] is None:
                continue
            new = [seen, c["id"], r["product"], r["raw"], r["cash"], r["cash_basis"], r["date"]]
            old = last.get((c["id"], r["raw"]))
            if old and old[4:] == new[4:]:
                continue
            hist["rows"].append(new)
            last[(c["id"], r["raw"])] = new
    return hist


def run(root, now=None, fetcher=None, sheets_only=False):
    root = Path(root)
    now = now or datetime.datetime.now(datetime.timezone.utc)
    cfgs = read_json(root / CONFIG)["coops"]
    fetcher = fetcher or (lambda u: (time.sleep(PAUSE), get(u))[1])
    results = {}
    for cfg in cfgs:
        if sheets_only and cfg["layout"] != "sheet":
            continue
        try:
            results[cfg["id"]] = read_coop(cfg, now.date(), fetcher)
        except Exception as e:  # noqa: BLE001 one co-op must not stop the rest
            results[cfg["id"]] = (None, "%s: %s" % (type(e).__name__, e))
    existing = read_json(root / OUT)
    doc = compose(cfgs, results, existing, now, carry=sheets_only)
    if not doc["coops"]:
        return {"wrote": False, "why": "no co-op read and none on file", "results": results, "doc": doc}
    atomic_write(root / OUT, doc)
    hist = append_history(read_json(root / HIST), doc, now)
    body = json.dumps(hist, separators=(",", ":"))
    hist_ok = len(body.encode()) <= HIST_MAX_KB * 1024
    if hist_ok:
        (root / HIST).write_text(body + "\n")
    return {"wrote": True, "why": None, "results": results, "doc": doc, "hist_ok": hist_ok}


# ---------------------------------------------------------------- fixture feed
def fixture_doc(now=None, sheets=False):
    """The feed as a run on the saved fixtures would write it (the three co-op
    pages plus the price sheet as a fourth, test-only co-op). Used by the
    selftest and by test/fert-coops.test.mjs. sheets=True adds the config's
    "sheet" co-ops (Synergy) as a run would (test/fert-synergy.test.mjs)."""
    now = now or datetime.datetime(2026, 10, 15, 14, tzinfo=datetime.timezone.utc)
    today = now.date()
    fx = ROOT / FIX_DIR
    cfgs = read_json(ROOT / CONFIG)["coops"] + [
        {"id": "sheet", "name": "Test sheet co-op", "state": "KS", "url": "https://example.com/2026-9-24.pdf",
         "layout": "pdf-sheet", "cash_from": "cash_pickup", "cash_label": "3% cash pickup"}]
    pages = {"tworivers-ks": "tworivers-ks_2026-10-15.html", "mccune-ks": "mccune_2026-10-15.html",
             "mulvane-ks": "mulvane_2026-10-15.html"}
    results = {}
    for c in cfgs:
        if c["id"] in pages:
            rws, txt, pr = html_rows((fx / pages[c["id"]]).read_text(), today)
            results[c["id"]] = ({"rows": rws, "page_date": one_date(txt, today), "problems": pr, "source_url": c["url"]}, None)
    rws, d, pr = pdf_rows((fx / "agricharts-1041_2026-9-24.txt").read_text(), today)
    results["sheet"] = ({"rows": rws, "page_date": d, "problems": pr, "source_url": cfgs[-1]["url"]}, None)
    if sheets:
        for c in cfgs:
            if c["layout"] == "sheet":
                results[c["id"]] = read_coop(c, today, None)
    return compose(cfgs, results, None, now)


# ---------------------------------------------------------------- selftest
def selftest():
    fails = []

    def ck(name, cond):
        print(("  ok   " if cond else "::error::coop-fert selftest FAIL ") + name)
        if not cond:
            fails.append(name)

    fx = ROOT / FIX_DIR
    today = datetime.date(2026, 10, 15)
    tr = (fx / "tworivers-ks_2026-10-15.html").read_text()
    mc = (fx / "mccune_2026-10-15.html").read_text()
    mu = (fx / "mulvane_2026-10-15.html").read_text()
    sheet = (fx / "agricharts-1041_2026-9-24.txt").read_text()

    # normalization
    for raw, want in [("46-0-0", "urea"), ("46-00-00 (UREA)", "urea"), ("NH3", "anhydrous"), ("82-0-0 Own Tank", "anhydrous"),
                      ("82-00-00 (ANHYDROUS)", "anhydrous"), ("ANHYDROUS", "anhydrous"), ("28-0-0", "uan28"), ("28%", "uan28"),
                      ("32%", "uan32"), ("28-0-0-5", "other"), ("18-46-00 (DAP)", "dap"), ("DAP", "dap"), ("11-52-0", "map"),
                      ("0-0-60", "potash"), ("POTASH", "potash"), ("00-00-60 (POTASH)", "potash"), ("21-0-0-24S", "ams"),
                      ("AMS 21-0-0-24", "ams"), ("10-34-0", "10-34-0"), ("12-0-0-26", "thiosul"),
                      ("12-0-0+26S Thio-Sul", "thiosul"), ("Mesz 12-40-0-10s", "other"), ("SUPERU", "other"),
                      ("9-24-3", "other"), ("KMAG", "other"), ("Pel Lime", "other"), ("UREA", "urea")]:
        ck("normalize %r -> %s" % (raw, want), product_key(raw) == want)

    # Two Rivers: one table, a date per row in the Change column
    rows, text, probs = html_rows(tr, today)
    by = {r["raw"]: r for r in rows}
    ck("Two Rivers: rent table not read as products", not any("Rental" in r for r in by))
    u = by.get("46-0-0") or {}
    ck("Two Rivers: urea charge 640, cash 630, cwt 31.50, per unit .685, dated 2026-10-01",
       u.get("prices") == {"charge": 640.0, "cash": 630.0} and u.get("cwt") == 31.5 and u.get("per_unit") == 0.685
       and u.get("date") == datetime.date(2026, 10, 1))
    ck("Two Rivers: DAP 'close out' keeps no date, keeps the words", by["18-46-0"]["date"] is None and by["18-46-0"]["date_text"] == "close out")
    ck("Two Rivers: 9-24-3 priced per gallon has no $/ton, says why",
       by["9-24-3"]["prices"] == {} and any("gallon" in n for n in by["9-24-3"]["notes"]))
    ck("Two Rivers: 9-24-3 dated 2022", by["9-24-3"]["date"] == datetime.date(2022, 6, 1))
    ck("Two Rivers: no single page date", one_date(text, today) is None)

    # McCune: ton price + 5% cash discount, one effective date for the sheet
    rows, text, probs = html_rows(mc, today)
    by = {r["raw"]: r for r in rows}
    ck("McCune: five products", len(rows) == 5)
    ck("McCune: DAP ton 970, discount 921.50",
       by["18-46-00 (DAP)"]["prices"] == {"list": 970.0, "discount": 921.5})
    ck("McCune: page date October 6, 2026", one_date(text, today) == datetime.date(2026, 10, 6))

    # Mulvane: pre-pay column empty, cash and per-unit share a cell, page date 10/06/2026
    rows, text, probs = html_rows(mu, today)
    by = {r["raw"]: r for r in rows}
    ck("Mulvane: nine products", len(rows) == 9)
    ck("Mulvane: urea charge 850, cash 840, per unit .924",
       by["46-0-0"]["prices"] == {"charge": 850.0, "cash": 840.0} and by["46-0-0"]["per_unit"] == 0.924)
    ck("Mulvane: own tank and co-op tank both kept", "82-0-0 Own Tank" in by and "82-0-0 Coop Tank" in by)
    ck("Mulvane: page date 2026-10-06", one_date(text, today) == datetime.date(2026, 10, 6))

    # AgriCharts PDF sheet
    rows, d, probs = pdf_rows(sheet, today)
    by = {r["raw"]: r for r in rows}
    ck("sheet: dated 2026-09-24", d == datetime.date(2026, 9, 24))
    ck("sheet: twelve products, custom rates not read", len(rows) == 12 and not any("SPREAD" in r for r in by))
    ck("sheet: urea ton 635, cash pickup 615.95, cwt 31.75, unit .69",
       by["UREA"]["prices"] == {"list": 635.0, "cash_pickup": 615.95} and by["UREA"]["cwt"] == 31.75 and by["UREA"]["per_unit"] == 0.69)
    ck("sheet: DAP has no unit figure", by["DAP"]["per_unit"] is None and by["DAP"]["prices"]["list"] == 965.0)
    ck("sheet: no problems", probs == [])
    pdf = fx / "agricharts-1041_2026-9-24.pdf"
    t2, err = pdf_to_text(pdf.read_bytes())
    if t2 is not None:
        r2, d2, _ = pdf_rows(t2, today)
        ck("sheet: the PDF itself reads the same", d2 == d and [x["prices"] for x in r2] == [x["prices"] for x in rows])

    # checks: band, per-unit, cwt, stale, first seen
    cfgs = read_json(ROOT / CONFIG)["coops"]
    cf = {c["id"]: c for c in cfgs}
    sheet_cfg = {"id": "sheet", "name": "Test sheet", "state": "KS", "url": "https://example.com/s.pdf",
                 "layout": "pdf-sheet", "cash_from": "cash_pickup"}
    fixtures = {"tworivers-ks": tr, "mccune-ks": mc, "mulvane-ks": mu}
    results = {}
    for cid, page in fixtures.items():
        rws, txt, pr = html_rows(page, today)
        results[cid] = ({"rows": rws, "page_date": one_date(txt, today), "problems": pr, "source_url": cf[cid]["url"]}, None)
    rws, dd, pr = pdf_rows(sheet, today)
    results["sheet"] = ({"rows": rws, "page_date": dd, "problems": pr, "source_url": sheet_cfg["url"]}, None)
    now = datetime.datetime(2026, 10, 15, 14, tzinfo=datetime.timezone.utc)
    allc = cfgs + [sheet_cfg]
    doc = compose(allc, results, None, now)
    co = {c["id"]: c for c in doc["coops"]}
    trr = {r["raw"]: r for r in co["tworivers-ks"]["rows"]}
    ck("stale: 9-24-3 dated 2022 is kept, stale, with no $/ton and no cash; Pel Lime 2023 is stale",
       trr["9-24-3"]["stale"] is True and trr["9-24-3"]["cash"] is None and trr["9-24-3"]["prices"] == {}
       and trr["Pel Lime"]["stale"] is True)
    ck("stale: AMS 21-0-0-24S dated Aug 4 (72 days) is stale, out of the summary",
       trr["21-0-0-24S"]["stale"] is True and trr["21-0-0-24S"]["age_days"] == 72)
    ck("first seen: DAP 'close out' has no date and first_seen today",
       trr["18-46-0"]["date"] is None and trr["18-46-0"]["first_seen"] == "2026-10-15" and not trr["18-46-0"]["stale"])
    ck("row date beats nothing: urea dated from its row", trr["46-0-0"]["date"] == "2026-10-01" and trr["46-0-0"]["date_from"] == "row")
    mcr = {r["raw"]: r for r in co["mccune-ks"]["rows"]}
    ck("McCune: cash is the 5% discount price, dated from the page",
       mcr["46-00-00 (UREA)"]["cash"] == 608.0 and mcr["46-00-00 (UREA)"]["cash_basis"] == "discount"
       and mcr["46-00-00 (UREA)"]["date"] == "2026-10-06" and mcr["46-00-00 (UREA)"]["date_from"] == "page")
    mur = {r["raw"]: r for r in co["mulvane-ks"]["rows"]}
    ck("per-unit check passes on every Mulvane row", all(not r["flags"] for r in mur.values()))
    ck("per-unit and cwt checks pass on Two Rivers", all(not r["flags"] for r in trr.values()))
    ck("sheet: 28% per unit .74 matches 415.63", not {r["raw"]: r for r in co["sheet"]["rows"]}["28%"]["flags"])
    summ = {s["key"]: s for s in doc["summary"]}
    ck("summary urea: four co-ops, middle 622.98 (608, 615.95, 630, 840)",
       summ["urea"]["n"] == 4 and summ["urea"]["median"] == 622.98 and summ["urea"]["low"] == 608.0 and summ["urea"]["high"] == 840.0)
    ck("summary urea: Mulvane flagged far from the others, still counted",
       summ["urea"]["far"] == ["mulvane-ks"] and mur["46-0-0"].get("far_from_others") is True)
    ck("summary anhydrous: Mulvane own tank (first listed) is its price",
       summ["anhydrous"]["n"] == 4 and 965.0 >= summ["anhydrous"]["high"] and "mulvane-ks" in summ["anhydrous"]["coops"])
    ck("summary AMS: the stale Two Rivers row is not counted", summ["ams"]["n"] == 1 and summ["ams"]["coops"] == ["sheet"])
    ck("summary: two co-ops give their average as the middle, one co-op gives no middle",
       summ["map"]["n"] == 2 and summ["map"]["median"] == 980.0 and summ["thiosul"]["median"] == 420.0
       and summ["uan32"]["n"] == 1 and summ["uan32"]["median"] is None)
    ck("summary: far-from-others is not judged from two co-ops", summ["thiosul"]["far"] == [])
    ck("summary: 'other' products never summarized", "other" not in summ)
    ck("summary: dates span 2026-09-24 to 2026-10-06", summ["urea"]["oldest"] == "2026-09-24" and summ["urea"]["newest"] == "2026-10-06")
    ck("summary: the undated DAP is counted as undated, not given today's date",
       summ["dap"]["undated"] == 1 and summ["dap"]["newest"] == "2026-10-06" and summ["urea"]["undated"] == 0)
    ck("states counted", doc["states"] == {"KS": 4} and doc["coops_current"] == 4)

    # a bad per-unit figure keeps the row out of the summary
    bad = tr.replace("<td>.685</td>", "<td>.785</td>")
    rws, txt, pr = html_rows(bad, today)
    r3 = dict(results)
    r3["tworivers-ks"] = ({"rows": rws, "page_date": None, "problems": pr, "source_url": "x"}, None)
    d3 = compose(allc, r3, None, now)
    u3 = [r for c in d3["coops"] if c["id"] == "tworivers-ks" for r in c["rows"] if r["raw"] == "46-0-0"][0]
    ck("per-unit mismatch is flagged and not counted",
       u3["flags"] and "tworivers-ks" not in {s["key"]: s for s in d3["summary"]}["urea"]["coops"])
    # a price outside its band is dropped and logged
    silly = mc.replace("$640.00", "$64.00")
    rws, txt, pr = html_rows(silly, today)
    r4 = dict(results)
    r4["mccune-ks"] = ({"rows": rws, "page_date": one_date(txt, today), "problems": pr, "source_url": "x"}, None)
    d4 = compose(allc, r4, None, now)
    m4 = [c for c in d4["coops"] if c["id"] == "mccune-ks"][0]
    ck("a $64 urea is dropped and logged, the discount price stays",
       any("$64.00" in x for x in m4["dropped"]) and [r for r in m4["rows"] if r["product"] == "urea"][0]["prices"] == {"discount": 608.0})
    # first_seen carries over while the price holds, resets when it moves
    later = datetime.datetime(2026, 12, 20, 14, tzinfo=datetime.timezone.utc)
    d5 = compose(allc, results, doc, later)
    dap5 = [r for c in d5["coops"] if c["id"] == "tworivers-ks" for r in c["rows"] if r["raw"] == "18-46-0"][0]
    ck("first seen held 66 days: the undated DAP is now stale", dap5["first_seen"] == "2026-10-15" and dap5["stale"] is True)
    moved = tr.replace("<td>820.00</td>", "<td>815.00</td>")
    rws, txt, pr = html_rows(moved, today)
    r6 = dict(results)
    r6["tworivers-ks"] = ({"rows": rws, "page_date": None, "problems": pr, "source_url": "x"}, None)
    d6 = compose(allc, r6, doc, later)
    dap6 = [r for c in d6["coops"] if c["id"] == "tworivers-ks" for r in c["rows"] if r["raw"] == "18-46-0"][0]
    ck("a new undated price starts a new first_seen", dap6["first_seen"] == "2026-12-20" and not dap6["stale"])
    # a failed read keeps the last good rows and says why
    r7 = dict(results)
    r7["mccune-ks"] = (None, "fetch failed: HTTP 503")
    d7 = compose(allc, r7, doc, now)
    m7 = [c for c in d7["coops"] if c["id"] == "mccune-ks"][0]
    ck("failed read: last rows kept, ok false, note says why", m7["ok"] is False and "503" in m7["note"] and len(m7["rows"]) == 5)
    ck("failed read does not change the file it was given", [c for c in doc["coops"] if c["id"] == "mccune-ks"][0]["ok"] is True)
    ck("failed read with nothing on file: co-op left out", "mccune-ks" not in {c["id"] for c in compose(allc, r7, None, now)["coops"]})
    # history
    h = append_history(None, doc, now)
    n1 = len(h["rows"])
    h = append_history(h, doc, now)
    ck("history: nothing appended when nothing changed", len(h["rows"]) == n1 and n1 > 30)
    h = append_history(h, d6, later)
    ck("history: one row appended for one changed price", len(h["rows"]) == n1 + 1 and h["rows"][-1][4] == 815.0)
    # dates
    ck("row date 10.1.26", row_date("10.1.26", today) == datetime.date(2026, 10, 1))
    ck("row date in the future is no date", row_date("12.1.26", today) is None)
    ck("page date with 'th' and a stray space", page_dates("effective: October 6th , 2026", today) == [datetime.date(2026, 10, 6)])
    ck("two different page dates: none chosen", one_date("10/06/2026 and 9/24/2026", today) is None)
    # newest dated sheet linked from a page
    idx = '<a href="https://s3.amazonaws.com/media.agricharts.com/sites/1041/2026-9-24.pdf">a</a><a href="/x/2026-10-8.pdf">b</a><a href="/x/2027-1-1.pdf">c</a>'
    ck("newest dated sheet, future sheet ignored",
       newest_pdf(idx, "https://farmerscoop.coop/fert", today) == ("https://farmerscoop.coop/x/2026-10-8.pdf", datetime.date(2026, 10, 8)))
    # sheet layout: rows typed into the config line, same checks as any co-op
    syn = cf.get("synergy-wi")
    ck("config: Synergy Cooperative, WI, no town, no url, sheet layout",
       syn is not None and syn["name"] == "Synergy Cooperative" and syn["state"] == "WI" and syn["town"] is None
       and syn["url"] is None and syn["layout"] == "sheet")
    sp, serr = read_coop(syn, today, lambda u: (_ for _ in ()).throw(AssertionError("sheet must not fetch")))
    ck("sheet: no fetch, two rows, dated Oct 1, no problems",
       serr is None and len(sp["rows"]) == 2 and sp["page_date"] == datetime.date(2026, 10, 1) and sp["problems"] == [])
    sb = build_coop(syn, sp, None, today)
    sr = {r["raw"]: r for r in sb["rows"]}
    ck("sheet: urea cash 610 charge 628, dated from its row, current",
       sr["46-0-0"]["product"] == "urea" and sr["46-0-0"]["cash"] == 610.0 and sr["46-0-0"]["prices"] == {"cash": 610.0, "charge": 628.0}
       and sr["46-0-0"]["date"] == "2026-10-01" and sr["46-0-0"]["date_from"] == "row" and not sr["46-0-0"]["stale"] and not sr["46-0-0"]["flags"])
    ck("sheet: the ESN-type product is shown as other, never summarized", sr["N-EDGE EZ (~ESN 44-0-0)"]["product"] == "other")
    ck("sheet: no url, no source url", sb["url"] is None and sb["source_url"] is None and sb["posted"] == "2026-10-01")
    r8 = dict(results)
    r8["synergy-wi"] = (sp, None)
    d8 = compose(allc, r8, None, now)
    s8 = {s["key"]: s for s in d8["summary"]}
    ck("sheet co-op counts toward the urea middle: 608, 610, 615.95, 630, 840 -> 615.95",
       s8["urea"]["n"] == 5 and s8["urea"]["median"] == 615.95 and "synergy-wi" in s8["urea"]["coops"] and s8["urea"]["low"] == 608.0)
    ck("sheet co-op state counted", d8["states"] == {"KS": 4, "WI": 1})
    ck("sheet: 'other' still not summarized", "other" not in s8)
    def sheet_with(rows):
        return dict(syn, rows=rows)
    sx, _ = read_coop(sheet_with([{"raw": "46-0-0", "cash": 628, "charge": 610, "date": "2026-10-01"}]), today, None)
    bx = build_coop(syn, sx, None, today)
    ck("sheet: cash above charge is flagged, not counted", bx["rows"][0]["flags"] == ["cash price above the charge price"])
    sx, _ = read_coop(sheet_with([{"raw": "46-0-0", "cash": 61, "charge": 628, "date": "2026-10-01"}]), today, None)
    bx = build_coop(syn, sx, None, today)
    ck("sheet: a typo $61 urea is dropped and logged, charge kept",
       any("$61.00" in x for x in bx["dropped"]) and bx["rows"][0]["prices"] == {"charge": 628.0} and bx["rows"][0]["cash"] is None)
    sx, _ = read_coop(sheet_with([{"raw": "46-0-0", "cash": 610, "charge": 628, "date": "2026-08-01"}]), today, None)
    ck("sheet: a row past 60 days is stale like any co-op", build_coop(syn, sx, None, today)["rows"][0]["stale"] is True)
    late8 = compose(allc, r8, None, datetime.datetime(2026, 12, 1, 14, tzinfo=datetime.timezone.utc))
    ck("sheet: Oct 1 rows are out of the summary on Dec 1 (61 days)",
       "synergy-wi" not in {s["key"]: s for s in late8["summary"]}.get("urea", {}).get("coops", []))
    for bad_rows, why in [([{"raw": "46-0-0", "cash": "610", "date": "2026-10-01"}], "not a number"),
                          ([{"raw": "46-0-0", "cash": 610, "date": "2026-11-01"}], "dated after today"),
                          ([{"raw": "46-0-0", "cash": 610}], "no date"),
                          ([{"raw": "", "cash": 610, "date": "2026-10-01"}], "no product name"),
                          ([{"raw": "46-0-0", "cash": None, "charge": None, "date": "2026-10-01"}], "no price"),
                          ([{"raw": "46-0-0", "cash": True, "date": "2026-10-01"}], "not a number")]:
        rx, _, px = sheet_rows(sheet_with(bad_rows), today)
        ck("sheet: refused, %s" % why, rx == [] and any(why in x for x in px))
    rx, dx, _ = sheet_rows(sheet_with([{"raw": "46-0-0", "cash": 610, "date": "2026-10-01"},
                                       {"raw": "DAP", "cash": 900, "date": "2026-10-02"}]), today)
    ck("sheet: two dates on one list, no single sheet date", len(rx) == 2 and dx is None)
    # --sheets-only: carries every other co-op exactly as read
    r9 = {"synergy-wi": (sp, None)}
    d9 = compose(allc, r9, doc, now, carry=True)
    c9 = {c["id"]: c for c in d9["coops"]}
    ck("sheets-only: the web co-ops are carried, ok and fetched unchanged",
       all(c9[k]["ok"] is True and c9[k]["fetched"] == co[k]["fetched"] and c9[k]["rows"] == co[k]["rows"]
           for k in ("tworivers-ks", "mccune-ks", "mulvane-ks", "sheet")))
    ck("sheets-only: Synergy added, the urea middle is the same as a full read",
       "synergy-wi" in c9 and {s["key"]: s for s in d9["summary"]}["urea"]["median"] == 615.95)
    ck("sheets-only: without carry a co-op not read is a failed read",
       {c["id"]: c for c in compose(allc, r9, doc, now)["coops"]}["mccune-ks"]["ok"] is False)
    import check_site_budget
    ck("history cap matches scripts/check_site_budget.py FILE_KB", check_site_budget.FILE_KB.get(HIST) == HIST_MAX_KB)

    if fails:
        print("selftest FAILED: %d" % len(fails))
        return 1
    print("selftest ok")
    return 0


def main(argv):
    if "--selftest" in argv:
        return selftest()
    if "--fixture-feed" in argv:
        print(json.dumps(fixture_doc(sheets="--with-sheets" in argv)))
        return 0
    info = run(ROOT, sheets_only="--sheets-only" in argv)
    for cid, (parsed, err) in info["results"].items():
        if err:
            print("::warning::co-op fertilizer %s: %s" % (cid, err))
        elif parsed:
            for p in parsed["problems"]:
                print("::warning::co-op fertilizer %s: %s" % (cid, p))
    doc = info["doc"]
    for c in doc["coops"]:
        for x in c.get("dropped") or []:
            print("::warning::co-op fertilizer %s dropped: %s" % (c["id"], x))
    print("::notice::co-op fertilizer: %d co-ops, %d current; %s" % (
        doc["coops_total"], doc["coops_current"],
        "; ".join("%s n=%d %s" % (s["key"], s["n"], ("mid %.2f" % s["median"]) if s["median"] else "range %.2f-%.2f" % (s["low"], s["high"]))
                  for s in doc["summary"])))
    if info.get("hist_ok") is False:
        print("::warning::co-op fertilizer history is over %d KB; not appended. Raise HIST_MAX_KB and FILE_KB together, or trim." % HIST_MAX_KB)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
