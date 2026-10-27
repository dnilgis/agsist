#!/usr/bin/env python3
"""read_wasde_text.py -- the U.S. corn, soybean and wheat tables of one WASDE, read from its text.

Brief 09 (Oct 27): the WASDE archive reads USDA's own report files from the NAL
ESMIS archive, because usda.gov's data page refuses GitHub runners. A release
there carries a TXT file (1995 to 2010, 2017 on) or only a PDF (1973 to 1994 and
2011 to 2016 have no TXT; XLS and XML ride along from 2010). The TXT and the
PDF's `pdftotext -layout` text are the same fixed-width tables, so one reader
does both. Output rows are backfill_wasde.EXTRACT_HEAD, the same rows
build_wasde_history.py already reads.

How a table is read (no column is ever guessed):
  - the table is found by its title (U.S. Wheat Supply and Use, U.S. Feed Grain
    and Corn Supply and Use, U.S. Soybeans and Products Supply and Use), then the
    CORN / SOYBEANS line inside it; it stops at the next table or note;
  - the header gives the columns: each market year (2025/26 Est.), and under
    the current one the months printed (Sep, Oct). A month is tied to the
    market year printed over it;
  - a row is its label plus exactly one figure per column, else it is left out
    and counted;
  - the column for the report's own month is this report's figure; last month's
    column comes out with its own month, so the build drops it as last month's;
  - a header whose months do not include the report's month refuses the table
    (a misfiled report), and so does a market year printed twice with no month.

Honest numbers: each column is checked against the balance sheet (beginning
stocks + production + imports = supply; domestic + exports = use; supply - use =
ending stocks, inside rounding). A column that fails is withheld whole and
counted. For a scanned report (OCR text, 1973 to 1994) a column must pass at
least one check to be kept: a misread digit must never reach the page.

    python3 scripts/read_wasde_text.py FILE.txt --date 2026-10-09   print the rows
    python3 scripts/read_wasde_text.py --selftest

Stdlib only.
"""
import argparse
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FIX = os.path.join(ROOT, "test", "fixtures", "wasde-esmis")

MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september",
               "october", "november", "december"]
HEAD = ["wasde", "report_date", "release_date", "title", "attribute", "commodity", "region", "market_year",
        "proj_est", "annual_quarter", "value", "unit", "forecast_year", "forecast_month", "file"]

TABLES = [
    # crop, commodity, title printed, title regex, anchor line (None = from the title), stop
    ("wheat", "Wheat", "U.S. Wheat Supply and Use",
     re.compile(r"U\.\s?S\.\s+(All\s+)?Wheat\s+Supply\s+(and|&)\s+Use", re.I), None,
     re.compile(r"Wheat\s+by\s+Class|^\s*Note:|Totals\s+may\s+not\s+add|^\s*1/", re.I)),
    ("corn", "Corn", "U.S. Feed Grain and Corn Supply and Use",
     re.compile(r"U\.\s?S\.\s+Feed\s+Grains?\s+(and|&)\s+Corn\s+Supply\s+(and|&)\s+Use", re.I),
     re.compile(r"^\s*CORN\s*$"),
     re.compile(r"^\s*Note:|Totals\s+may\s+not\s+add|^\s*SORGHUM\b|^\s*1/", re.I)),
    ("soybeans", "Soybeans", "U.S. Soybeans and Products Supply and Use",
     re.compile(r"U\.\s?S\.\s+Soybeans\s+(and|&)\s+Products\s+Supply\s+(and|&)\s+Use", re.I),
     re.compile(r"^\s*SOYBEANS\s*$"),
     re.compile(r"^\s*SOYBEAN\s+(OIL|MEAL)\b|^\s*Note:|^\s*1/", re.I)),
]
YEAR_RE = re.compile(r"(\d{4})/(\d{2})(?:\s*(E\s?st(?:imated|imate)?\.?|Proj(?:ected|ection|ections)?\.?|Prel(?:iminary)?\.?))?", re.I)
MONTH_RE = re.compile(r"\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?:[a-z]*)\.?(?=\s|$)")
VALUE_RE = re.compile(r"^(?:-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?|-?\.\d+|\d[\d,.]*-\d[\d,.]*|NA|N/A|--)$")
NUM_RE = re.compile(r"^-?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?$")
UNIT_RE = re.compile(r"^(million\s+|thousand\s+)?(acres|bushels|metric\s+tons|hectares|pounds|short\s+tons|tons)$", re.I)
DATE_RE = re.compile(r"\b(" + "|".join(m.capitalize() for m in MONTH_NAMES) + r")\s+(\d{1,2}),\s+(\d{4})\b")
WASDE_RE = re.compile(r"\bWASDE\s*-\s*(\d{1,4})\b")
FOOT_RE = re.compile(r"(\s+\d{1,2}/)+\s*$|\s*\*+\s*$")
SMALL = {"and", "&", "for", "per", "of", "in", "to", "by"}
# Old and new spellings of one line -> the name today's report prints.
CANON = {
    "total supply": "Supply, Total", "supply, total": "Supply, Total", "supply total": "Supply, Total",
    "total use": "Use, Total", "use, total": "Use, Total", "use total": "Use, Total",
    "domestic, total": "Domestic, Total", "total domestic": "Domestic, Total", "domestic use": "Domestic, Total",
    "domestic total": "Domestic, Total",
    "feed & residual": "Feed and Residual", "feed and residual": "Feed and Residual",
    "food, seed & industrial": "Food, Seed & Industrial", "food, seed, and industrial": "Food, Seed & Industrial",
    "food, seed and industrial": "Food, Seed & Industrial",
    "ethanol & by-products": "Ethanol & by-products", "ethanol and by-products": "Ethanol & by-products",
    "yield per harvested acre": "Yield per Harvested Acre", "yield per harvested": "Yield per Harvested Acre",
    "yield": "Yield per Harvested Acre",
}
CHECK = {"beg": ["Beginning Stocks"], "prod": ["Production"], "imp": ["Imports"], "sup": ["Supply, Total"],
         "dom": ["Domestic, Total"], "exp": ["Exports"], "use": ["Use, Total"], "end": ["Ending Stocks"]}


def clean(line):
    """Tabs out, column rules (: and |) to spaces, rule lines blank; positions kept."""
    line = line.expandtabs(8).rstrip("\r\n")
    line = line.replace(":", " ").replace("|", " ")
    if re.fullmatch(r"[\s=\-_*.]*", line):
        return ""
    return line


def canon_label(label):
    s = FOOT_RE.sub("", re.sub(r"\s+", " ", label)).strip().rstrip(".:").strip()
    s = re.sub(r"\s*\d/$", "", s).strip()
    low = s.lower()
    if "farm price" in low:
        return "Avg. Farm Price ($/bu)", "$/bu"
    if low in CANON:
        return CANON[low], None
    words = s.split(" ")
    out = []
    for i, w in enumerate(words):
        out.append(w if (i and w.lower() in SMALL) else (w[:1].upper() + w[1:] if w[:1].isalpha() else w))
    return " ".join(out), None


def canon_unit(text):
    t = re.sub(r"\s+", " ", text.strip()).lower()
    return " ".join(w.capitalize() for w in t.split(" "))


def tokens(line):
    return [(m.group(0), m.start(), m.end()) for m in re.finditer(r"\S+", line)]


def data_row(line):
    """'Production    14,892   16,964' -> ('Production', ['14,892', '16,964']) or None."""
    toks = tokens(line)
    vals = []
    while toks and VALUE_RE.match(toks[-1][0]):
        vals.insert(0, toks.pop()[0])
    if not vals or not toks:
        return None
    label = line[:toks[-1][2]].strip()
    if not re.search(r"[A-Za-z]{2}", label) or YEAR_RE.search(label):
        return None
    return label, vals


def header_years(line):
    out = []
    for m in YEAR_RE.finditer(line):
        y1, y2, fl = m.group(1), m.group(2), (m.group(3) or "").lower().replace(" ", "")
        if int(y1) < 1960 or int(y1) > 2100 or (int(y1) + 1) % 100 != int(y2):
            continue
        flag = flag_of(fl)
        out.append({"my": f"{y1}/{y2}", "flag": flag, "a": m.start(), "b": m.end()})
    return out


FLAG_RE = re.compile(r"^(E\s?st(?:imated|imate)?\.?|Proj(?:ected|ection|ections)?\.?|Prel(?:iminary)?\.?)$", re.I)
HEAD_WORDS = {"item", "filler", "year", "beginning", "marketing"}


def flag_of(word):
    w = word.lower().replace(" ", "")
    return "Est." if w.startswith("est") else "Proj." if w.startswith("proj") else "Prel." if w.startswith("prel") else ""


def header_line(line):
    """A header line -> (market years, months [(n, centre)], flags [(word, centre)]); anything else -> None.
    A header line holds market years, or only months, flag words (Est., Proj.) and 'Item'."""
    if data_row(line):
        return None
    ys = header_years(line)
    rest = YEAR_RE.sub(lambda m: " " * len(m.group(0)), line) if ys else line
    ms, fl = [], []
    for t, a, b in tokens(rest):
        m = MONTH_RE.fullmatch(t)
        if m:
            ms.append((MONTHS.index(m.group(1).lower()) + 1, (a + b) / 2))
        elif FLAG_RE.match(t):
            fl.append((flag_of(t), (a + b) / 2))
        elif t.lower() in HEAD_WORDS or ys:
            continue
        else:
            return None
    if not ys and not ms and not fl:
        return None
    return ys, ms, fl


def columns(years, months):
    """Header market years and the months under them -> [{my, flag, month}] left to right."""
    tied = {i: [] for i in range(len(years))}
    for mon, c in months:
        best = min(range(len(years)), key=lambda i: (0 if years[i]["a"] <= c <= years[i]["b"] else
                                                     min(abs(c - years[i]["a"]), abs(c - years[i]["b"]))))
        tied[best].append((c, mon))
    cols = []
    for i, y in enumerate(years):
        if tied[i]:
            for _, mon in sorted(tied[i]):
                cols.append({"my": y["my"], "flag": y["flag"], "month": mon})
        else:
            cols.append({"my": y["my"], "flag": y["flag"], "month": None})
    return cols


def report_meta(text):
    """Cover date and WASDE number from the top of the report."""
    head = "\n".join(text.splitlines()[:80])
    d = DATE_RE.search(head)
    date = None
    if d:
        date = f"{int(d.group(3)):04d}-{MONTH_NAMES.index(d.group(1).lower()) + 1:02d}-{int(d.group(2)):02d}"
    n = WASDE_RE.search(head)
    return date, (n.group(1) if n else None)


def find_tables(lines):
    """-> {crop: [(start, end), ...]} line ranges of every place a table's title is printed
    (a contents page can print the title too; the reader takes the first range that reads)."""
    out = {}
    for crop, _, _, title, anchor, stop in TABLES:
        for i, ln in enumerate(lines):
            if title.search(ln) and "..." not in ln:
                j = i + 1
                while j < len(lines) and j - i < 120:
                    if "\f" in lines[j] or (j > i + 2 and stop.search(lines[j])):
                        break
                    if any(t[3].search(lines[j]) for t in TABLES if t[0] != crop):
                        break
                    j += 1
                out.setdefault(crop, []).append((i + 1, j))
    return out


def balance(vals):
    """vals {label: number} for one column -> (checks passed, failures [str])."""
    def g(k):
        for n in CHECK[k]:
            if n in vals:
                return vals[n]
        return None
    ok, bad = 0, []

    def tol(ref):
        return max(2.0, abs(ref or 0) * 0.002)
    beg, prod, imp, sup, dom, exp, use, end = (g(k) for k in ("beg", "prod", "imp", "sup", "dom", "exp", "use", "end"))
    if None not in (beg, prod, imp, sup):
        if abs(beg + prod + imp - sup) <= tol(sup):
            ok += 1
        else:
            bad.append(f"supply {sup} vs {beg}+{prod}+{imp}")
    if None not in (dom, exp, use):
        if abs(dom + exp - use) <= tol(use):
            ok += 1
        else:
            bad.append(f"use {use} vs {dom}+{exp}")
    if None not in (sup, use, end):
        if abs(sup - use - end) <= tol(sup):
            ok += 1
        else:
            bad.append(f"ending {end} vs {sup}-{use}")
    return ok, bad


def num(s):
    s = s.replace(",", "")
    return float(s) if NUM_RE.match(s) and re.search(r"\d", s) else None


def read_table(lines, crop, rel_date, scan=False):
    """One table's lines -> ([(label, unit, col, value_text)], stats)."""
    spec = next(t for t in TABLES if t[0] == crop)
    anchor = spec[4]
    stats = {"rows_read": 0, "rows_bad_count": 0, "columns_withheld": 0, "refused": None}
    years, months, unit = [], [], ""
    hdr_open = False
    active = anchor is None
    cells = []
    rel_m = int(rel_date[5:7])
    cols = None
    for raw in lines:
        ln = clean(raw)
        if not ln.strip():
            continue
        st = ln.strip()
        h = header_line(ln)
        if h is not None:
            ys, ms, fl = h
            if ys and not hdr_open and cells:
                break                                 # the next block's own header (soybean oil and the like)
            if ys and not hdr_open:
                years, months = [], []
            years = sorted(years + ys, key=lambda y: y["a"])
            months += ms
            for word, c in fl:
                if years:
                    y = min(years, key=lambda y: 0 if y["a"] <= c <= y["b"] + 4 else min(abs(c - y["a"]), abs(c - y["b"])))
                    y["flag"] = y["flag"] or word
            hdr_open, cols = True, None
            continue
        hdr_open = False
        if anchor is not None and anchor.match(st):
            active = True
            continue
        if not active:
            continue
        if active and anchor is not None and re.fullmatch(r"[A-Z][A-Z &]+", st) and not anchor.match(st):
            break                                     # the next block (SORGHUM, SOYBEAN OIL ...)
        if UNIT_RE.match(st):
            unit = canon_unit(st)
            continue
        row = data_row(ln)
        if not row:
            continue
        if cols is None:
            if not years:
                stats["refused"] = "no_header"
                return [], stats
            cols = columns(years, months)
            mys = [(c["my"], c["month"]) for c in cols]
            if len(set(mys)) != len(mys):
                stats["refused"] = "market_year_twice_without_month"
                return [], stats
            if any(c["month"] for c in cols) and not any(c["month"] == rel_m for c in cols):
                stats["refused"] = "month_header_mismatch"
                return [], stats
        label, vals = row
        stats["rows_read"] += 1
        if len(vals) != len(cols):
            stats["rows_bad_count"] += 1
            continue
        name, u = canon_label(label)
        for ci, v in enumerate(vals):
            cells.append((name, u or unit, ci, v))
    if cols is None:
        stats["refused"] = stats["refused"] or "no_rows"
        return [], stats
    if stats["rows_read"] and stats["rows_bad_count"] * 2 > stats["rows_read"]:
        stats["refused"] = "most_rows_do_not_fit_the_header"
        return [], stats
    # the balance check, column by column
    keep = []
    withheld = []
    for ci in range(len(cols)):
        vals = {}
        for name, u, c, v in cells:
            if c == ci and u != "$/bu" and num(v) is not None:
                vals.setdefault(name, num(v))
        ok, bad = balance(vals)
        if bad or (scan and ok == 0):
            withheld.append({"column": ci, "market_year": cols[ci]["my"], "why": bad or ["scan_unchecked"]})
            continue
        keep.append(ci)
    stats["columns_withheld"] = len(withheld)
    stats["withheld"] = withheld
    out = [(name, u, cols[c], v) for name, u, c, v in cells if c in keep]
    return out, stats


def read_report(text, rel_date, file_label, scan=False):
    """Text of one WASDE -> (rows in HEAD order, report dict).
    rel_date is the ESMIS release date (YYYY-MM-DD), or YYYY-MM when the listing gave only a month."""
    cover, number = report_meta(text)
    rep = {"cover_date": cover, "wasde": number, "tables": {}, "refused": None}
    if len(rel_date) == 7:
        if not cover or cover[:7] != rel_date:
            rep["refused"] = "no_cover_date_for_unlisted_release"
            return [], rep
        rel_date = cover
    elif cover and cover != rel_date:
        rep["refused"] = f"cover_date_{cover}_is_not_{rel_date}"
        return [], rep
    rep["date"] = rel_date
    lines = text.replace("\r\n", "\n").split("\n")
    # keep page breaks visible to find_tables: a form feed starts its own line
    lines = [ln for chunk in lines for ln in (chunk.split("\f") if "\f" in chunk else [chunk])]
    found = find_tables(lines)
    rows = []
    y, m = int(rel_date[:4]), int(rel_date[5:7])
    wasde = number or f"d{rel_date}"
    for crop, commodity, title, *_ in TABLES:
        if crop not in found:
            rep["tables"][crop] = {"refused": "not_found"}
            continue
        for a, b in found[crop]:
            cells, st = read_table(lines[a:b], crop, rel_date, scan=scan)
            if cells:
                break
        st["rows"] = len(cells)
        rep["tables"][crop] = st
        for name, unit, col, v in cells:
            if col["month"]:
                fy = y - 1 if col["month"] > m and m < 3 else y
                fm = col["month"]
            else:
                fy, fm = y, m
            rows.append([wasde, rel_date, rel_date, title, name, commodity, "United States", col["my"], col["flag"],
                         "Annual", v, unit, str(fy), str(fm), file_label])
    return rows, rep


def excerpt(text, max_lines=140):
    """The cover lines and the three tables, for the raw copy (a full report is ten times this)."""
    lines = text.replace("\r\n", "\n").replace("\f", "\n").split("\n")
    keep = lines[:12]
    for spans in find_tables(lines).values():
        for a, b in spans[:3]:
            keep += ["", "-----"] + lines[max(0, a - 1):min(b, a + max_lines)]
    return "\n".join(keep) + "\n"


# ---------------------------------------------------------------- selftest
def selftest():
    fails = []

    def ck(name, ok, detail=""):
        print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  {detail}"))
        if not ok:
            fails.append(name)

    def rd(n):
        with open(os.path.join(FIX, n), encoding="utf-8") as f:
            return f.read()

    def pick(rows, crop, my, line, month=None):
        c = {"corn": "Corn", "soybeans": "Soybeans", "wheat": "Wheat"}[crop]
        return [(r[10], r[13]) for r in rows if r[5] == c and r[7] == my and r[4] == line
                and (month is None or r[13] == str(month))]

    # 1. the October 2026 report as pdftotext prints it (real USDA figures)
    t = rd("wasde-2026-10-09.txt")
    rows, rep = read_report(t, "2026-10-09", "esmis-2026-10-09-pdf")
    ck("cover date and WASDE number read", rep["cover_date"] == "2026-10-09" and rep["wasde"] == "676", rep)
    ck("all three tables read, none refused", all(not rep["tables"][c].get("refused") for c in ("corn", "soybeans", "wheat")), rep["tables"])
    ck("corn 2026/27 ending stocks: October 1,849, September column marked as last month's",
       pick(rows, "corn", "2026/27", "Ending Stocks") == [("1,567", "9"), ("1,849", "10")], pick(rows, "corn", "2026/27", "Ending Stocks"))
    ck("corn 2025/26 Est. yield 186.5, flag Est.", [(r[10], r[8]) for r in rows if r[5] == "Corn" and r[7] == "2025/26"
                                                   and r[4] == "Yield per Harvested Acre"] == [("186.5", "Est.")])
    ck("feed grains block not read as corn (metric tons never in the corn rows)",
       not any("Metric" in r[11] for r in rows if r[5] == "Corn") and pick(rows, "corn", "2024/25", "Area Planted") == [("90.9", "10")],
       pick(rows, "corn", "2024/25", "Area Planted"))
    ck("soybeans: crush and price with their unit", pick(rows, "soybeans", "2026/27", "Crushings", 10) == [("2,780", "10")]
       and [r[11] for r in rows if r[5] == "Soybeans" and r[4] == "Avg. Farm Price ($/bu)"][:1] == ["$/bu"])
    ck("wheat: by-class table left out (one value per year and line)",
       pick(rows, "wheat", "2026/27", "Ending Stocks", 10) == [("740", "10")]
       and len(pick(rows, "wheat", "2025/26", "Production")) == 1, pick(rows, "wheat", "2025/26", "Production"))
    ck("footnote marks dropped from labels", "Food, Seed & Industrial" in {r[4] for r in rows}
       and "Ethanol & by-products" in {r[4] for r in rows})
    ck("rows in the extract layout", all(len(r) == len(HEAD) for r in rows) and rows[0][6] == "United States")
    toc = t.replace("WASDE - 676", "WASDE - 676\nU.S. Wheat Supply and Use                    11\nU.S. Feed Grain and Corn Supply and Use      12", 1)
    rows_toc, rep_toc = read_report(toc, "2026-10-09", "esmis-2026-10-09-pdf")
    ck("a contents line with the title does not hide the table", len(rows_toc) == len(rows), rep_toc["tables"])
    _, rep2 = read_report(t, "2026-09-11", "x")
    ck("a report whose cover is another date is refused", rep2["refused"] and "cover_date" in rep2["refused"], rep2)
    rows3, rep3 = read_report(t, "2026-10", "x")
    ck("an unlisted release keyed by month takes the cover date", rep3.get("date") == "2026-10-09" and len(rows3) == len(rows))

    # 2. an older text layout: column rules, lower-case labels, months under one market year (invented figures)
    t = rd("old-layout.txt")
    rows, rep = read_report(t, "1996-05-10", "esmis-1996-05-10-txt")
    ck("old layout: tables read", all(not rep["tables"][c].get("refused") for c in ("corn", "wheat")), rep["tables"])
    ck("old layout: April and May under 1996/97, May kept as this report",
       pick(rows, "corn", "1996/97", "Ending Stocks") == [("700", "4"), ("650", "5")], pick(rows, "corn", "1996/97", "Ending Stocks"))
    ck("old layout: labels in today's spelling", {"Supply, Total", "Use, Total", "Yield per Harvested Acre", "Avg. Farm Price ($/bu)"}
       <= {r[4] for r in rows if r[5] == "Corn"}, sorted({r[4] for r in rows if r[5] == "Corn"}))
    ck("old layout: a price range kept as printed (the build counts it, never averages it)",
       pick(rows, "corn", "1996/97", "Avg. Farm Price ($/bu)", 5) == [("2.90-3.30", "5")])
    ck("old layout: a row with a missing figure is left out and counted", rep["tables"]["wheat"]["rows_bad_count"] == 1
       and not pick(rows, "wheat", "1995/96", "Imports"), rep["tables"]["wheat"])
    ck("old layout: soybean table absent is said, not filled", rep["tables"]["soybeans"]["refused"] == "not_found")

    # 3. a misread digit fails the balance sheet and the column is withheld
    bad = t.replace("Ending stocks          :   1,558", "Ending stocks          :   7,558")
    rows, rep = read_report(bad, "1996-05-10", "x")
    ck("a column that does not balance is withheld whole", not pick(rows, "corn", "1994/95", "Production")
       and pick(rows, "corn", "1995/96", "Production") and rep["tables"]["corn"]["columns_withheld"] == 1, rep["tables"]["corn"])
    # scanned text: a column with no check possible is withheld
    thin = "\n".join(ln for ln in t.splitlines() if not re.match(r"\s*(Supply, total|Total use|Ending stocks)", ln))
    rows, rep = read_report(thin, "1996-05-10", "x", scan=True)
    ck("scan: a column that cannot be checked is withheld", not pick(rows, "corn", "1995/96", "Production"), rep["tables"]["corn"])
    rows, rep = read_report(t, "1996-05-10", "x", scan=True)
    ck("scan: a column that balances is kept", pick(rows, "corn", "1995/96", "Production") == [("7,400", "5")])

    # 4. a header that names other months than the report's is refused
    rows, rep = read_report(t.replace("May 10, 1996", "June 12, 1996"), "1996-06-12", "x")
    ck("months in the header that are not this report's refuse the table",
       rep["tables"]["corn"]["refused"] == "month_header_mismatch" and not rows, rep["tables"])
    ck("labels canonical", canon_label("Yield per harvested acre  2/") == ("Yield per Harvested Acre", None)
       and canon_label("Avg. farm price ($/bu)  3/") == ("Avg. Farm Price ($/bu)", "$/bu")
       and canon_label("Total supply") == ("Supply, Total", None))
    ex = excerpt(rd("wasde-2026-10-09.txt"))
    ck("the raw excerpt keeps the cover and the tables", "WASDE - 676" in ex and "U.S. Feed Grain and Corn" in ex
       and len(ex) < len(rd("wasde-2026-10-09.txt")))
    print(f"read_wasde_text selftest: {len(fails)} failure(s)")
    return 1 if fails else 0


def main():
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("file", nargs="?")
    ap.add_argument("--date")
    ap.add_argument("--scan", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if not a.file or not a.date:
        print("read_wasde_text.py FILE --date YYYY-MM-DD")
        return 2
    with open(a.file, encoding="utf-8", errors="replace") as f:
        rows, rep = read_report(f.read(), a.date, os.path.basename(a.file), scan=a.scan)
    for r in rows:
        print(",".join(r))
    print(rep, file=sys.stderr)
    return 0 if rows else 1


if __name__ == "__main__":
    sys.exit(main())
