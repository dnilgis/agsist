#!/usr/bin/env python3
"""
AGSIST -- data/hay/ams-hay.json: this week's hay trades by state, from the
USDA AMS hay market reports, for hay-prices.html (beside the NASS monthly
price received, which scripts/fetch_hay_prices.py reads).

Source: USDA AMS Livestock, Poultry and Grain Market News state hay reports
("Direct Hay Weighted Average Report", and hay auction reports), public PDFs,
latest issue at
    https://www.ams.usda.gov/mnreports/ams_<slug>.pdf
The reports to read are in scripts/hay_ams_sources.json. A report with no
known number is found by its title in the AMS hay report listing the probe
saves.

What is read, per report:
  * the title, the report date ("Fri Oct 16, 2026") and the week ending,
  * the tons this week, last reported and last year (hay and straw),
  * the market comment (first paragraph, as AMS wrote it),
  * every table headed "<Hay> - <Grade> (Trade/Per Ton)" under a "Hay (...)"
    or "Straw (...)" heading: rows of
        Bale type   Qty   Price Range   Wtd Avg   Freight/Use  Description  Crop Age
    e.g. "Large Square 3x4  250  300.00  300.00  F.O.B."
    or   "Large Round  91.5  160.00-200.00  176.26  F.O.B.".
    A row can carry a price and no weighted average ("Small Square 0.5
    400.00"); the average then stays empty, never filled in.
  Per Bale tables are counted and left out: a ton price is never mixed with
  a bale price.

Modes:
  (default)   fetch every report, validate, write. A report keeps its last
              good issue on any failure and records why in `status`.
  --probe     fetch the AMS hay listing and every report it can name, save
              their text to data/hay-ams-raw/, print what parsed and which
              listing titles look like hay reports. Writes no feed.
  --scan A-B  with --probe: also try report numbers A through B and save the
              ones whose own title says hay (finds numbers the listing misses).
  --selftest  offline tests, non-zero exit on any failure.

WHAT THIS FILE WILL NOT DO
  * Use a report whose own title does not name its state and say hay (a
    wrong report number shows nothing, never another state's hay).
  * Keep a row whose average is outside its own range, a range that runs
    backwards, no quantity, or a price outside PRICE_RANGE.
  * Keep a report with a price-looking number in its tables that is not part
    of a readable row (a half-read report is dropped, not trusted).
  * Keep a report whose row tons do not add up to the tons it says traded
    this week (when it gives them and has no per-bale tables).
  * Replace a newer report with an older one, or write a zero.

LAYOUT: checked against three real reports read with pdftotext -layout (the
same call fetch_dairy.pdf_to_text makes): South Dakota Direct Hay 3183 (Oct 16,
2026) and Alabama Direct 3050 (Oct 1 and Sep 2, 2026), saved from the
references branch to test/fixtures/hay-ams/. Hay AUCTION reports were not in
hand: run the probe and add one as a fixture before trusting auction rows.

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
OUT = "data/hay/ams-hay.json"
RAW_DIR = "data/hay-ams-raw"
SOURCES = "scripts/hay_ams_sources.json"
URL = "https://www.ams.usda.gov/mnreports/ams_%s.pdf"
PAGE = "https://mymarketnews.ams.usda.gov/viewReport/%s"

PRICE_RANGE = (15.0, 1500.0)   # $/ton; small squares of top hay run $400+, utility round bales under $50
MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
STATES = {
    "AL": "Alabama", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado", "CT": "Connecticut",
    "DE": "Delaware", "FL": "Florida", "GA": "Georgia", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa",
    "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts",
    "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri", "MT": "Montana", "NE": "Nebraska",
    "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
    "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania",
    "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah",
    "VT": "Vermont", "VA": "Virginia", "WA": "Washington", "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
}


# ------------------------------------------------------------------ text
def norm(ln):
    return re.sub(r"[ \t ]+", " ", ln).strip()


def find_date(s, weekday_first=False):
    """A date in s as YYYY-MM-DD. weekday_first: only 'Fri Oct 16, 2026' style."""
    wd = r"\b(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+"
    md = r"\b(" + "|".join(MONTHS) + r")[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b"
    m = re.search((wd if weekday_first else "") + md, s, re.I)
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


def title_of(lines):
    """The report name: the first non-empty line."""
    for ln in lines:
        if ln:
            return ln
    return ""


# The parts a report repeats at every page break, and links: never data.
NOISE_RE = re.compile(
    r"^(?:source:|general inquiries|https?://|email us|click here|ams livestock|agricultural marketing|"
    r"livestock, poultry|[a-z]{2} dept\.? of ag|page \d+ of \d+|qty\s+price range|n/a$)", re.I)
SECTION_RE = re.compile(r"^(hay|straw)\s*\(([^)]*)\)$", re.I)
TABLE_RE = re.compile(r"^(.+?)\s+-\s*(.*?)\s*\(\s*([a-z ]+?)\s*/\s*per\s+(ton|bale)\s*\)$", re.I)
NUM = r"(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)"
PX = r"(\d{1,4}\.\d{2})"
ROW_RE = re.compile(
    r"^([A-Za-z][A-Za-z0-9/'.() ]*?)\s+" + NUM + r"\s+" + PX + r"(?:\s*-\s*" + PX + r")?"
    r"(?:\s+" + PX + r")?(?:\s+(.*))?$")
PRICE_LIKE = re.compile(r"\d{1,4}\.\d{2}\b")
VOL_RE = re.compile(r"^(hay|straw|total)\s+" + NUM + r"\s+" + NUM + r"\s+" + NUM + r"$", re.I)


def split_rest(raw_line, rest):
    """Freight/Use, Description, Crop Age from what follows the prices. The
    layout text keeps wide gaps between columns; one word group per column."""
    if not rest:
        return "", ""
    tail = raw_line[raw_line.rfind(rest.split()[0]):] if rest.split() else ""
    parts = [p.strip() for p in re.split(r"\s{2,}", tail.strip()) if p.strip()] or [rest.strip()]
    return parts[0], " / ".join(parts[1:])


def parse_report(text):
    """(report, None) or (None, reason). report: title, date, week_ending,
    last_reported, tons, comment, rows, per_bale_tables."""
    if not text or not text.strip():
        return None, "empty report"
    raw_lines = text.splitlines()
    lines = [norm(x) for x in raw_lines]
    title = title_of(lines)
    head = [x for x in lines if x][:6]
    date = None
    for ln in head:
        date = find_date(ln, weekday_first=True)
        if date:
            break
    if not date:
        return None, "no report date in the first lines"
    week = None
    m = re.search(r"week ending\s+(\d{1,2}/\d{1,2}/\d{4})", text, re.I)
    if m:
        week = find_date(m.group(1))
    last_rep = None
    m = re.search(r"last reported\s*\(?\s*(\d{1,2}/\d{1,2}/\d{4})", " ".join(lines), re.I)
    if not m:
        m = re.search(r"^\((\d{1,2}/\d{1,2}/\d{4})\)$", "\n".join(lines), re.M)
    if m:
        last_rep = find_date(m.group(1))

    # tons: "Hay  1625  625  1650" = this week, last reported, last year
    tons = {}
    for ln in lines:
        v = VOL_RE.match(ln)
        if v:
            k = v.group(1).lower()
            if k not in tons:
                tons[k] = [float(v.group(i).replace(",", "")) for i in (2, 3, 4)]

    # the market comment: the paragraph after the "...for week ending" line
    comment, heading = "", ""
    for i, ln in enumerate(lines):
        if re.search(r"weighted average report for week ending|report for week ending", ln, re.I):
            heading = ln
            para, j = [], i + 1
            while j < len(lines) and not lines[j]:
                j += 1
            while j < len(lines) and lines[j] and not re.match(r"^volume$", lines[j], re.I):
                para.append(lines[j])
                j += 1
            comment = " ".join(para)
            break

    rows, per_bale, section, organic, table, began = [], 0, None, False, None, False
    for raw, ln in zip(raw_lines, lines):
        if not ln or NOISE_RE.match(ln) or ln == title:
            continue
        if find_date(ln, weekday_first=True) and not PRICE_LIKE.search(ln):
            continue                                            # the repeated page header
        s = SECTION_RE.match(ln)
        if s:
            section, organic, table = s.group(1).lower(), "organic" in s.group(2).lower(), None
            continue
        t = TABLE_RE.match(ln)
        if t:
            began = True
            if t.group(4).lower() != "ton":
                per_bale += 1
                table = {"skip": True}
                continue
            if section is None:
                return None, "a table before any Hay or Straw heading: %r" % ln[:60]
            table = {"skip": False, "commodity": t.group(1).strip(), "grade": t.group(2).strip().rstrip("-").strip(),
                     "basis": t.group(3).strip().lower()}
            continue
        if not began:
            continue                                            # comment and volume block above the tables
        r = ROW_RE.match(ln)
        if r and table is not None:
            if table["skip"]:
                continue
            qty = float(r.group(2).replace(",", ""))
            lo = float(r.group(3))
            hi = float(r.group(4)) if r.group(4) else lo
            avg = float(r.group(5)) if r.group(5) else None
            freight, desc = split_rest(raw, r.group(6) or "")
            if PRICE_LIKE.search(r.group(6) or ""):
                return None, "a price after the columns in %r" % ln[:70]
            if not qty > 0:
                return None, "a row with no quantity: %r" % ln[:70]
            if hi < lo:
                return None, "price range runs backwards: %r" % ln[:70]
            if avg is not None and not (lo - 0.005 <= avg <= hi + 0.005):
                return None, "weighted average %.2f outside its own range %.2f-%.2f: misread" % (avg, lo, hi)
            for p in (lo, hi) + ((avg,) if avg is not None else ()):
                if not (PRICE_RANGE[0] <= p <= PRICE_RANGE[1]):
                    return None, "price %.2f outside %s" % (p, PRICE_RANGE)
            rows.append({"kind": section, "organic": organic, "commodity": table["commodity"], "grade": table["grade"],
                         "basis": table["basis"], "bale": r.group(1).strip(), "qty": qty, "lo": lo, "hi": hi,
                         "avg": avg, "freight": freight, "desc": desc})
            continue
        if PRICE_LIKE.search(ln):
            return None, "a price in the tables that is not part of a readable row: %r" % ln[:70]
    if not rows:
        return None, "no Per Ton hay or straw rows"

    # the row tons must add up to the tons the report says traded this week
    if not per_bale:
        for k in ("hay", "straw"):
            if k in tons:
                got = sum(r["qty"] for r in rows if r["kind"] == k)
                want = tons[k][0]
                if abs(got - want) > 1.0 + 0.005 * want:
                    return None, "%s rows add to %.2f tons but the report says %.0f: a table was misread" % (k, got, want)
    return {"title": title, "heading": heading, "date": date, "week_ending": week, "last_reported": last_rep,
            "tons": {k: {"week": v[0], "last": v[1], "year": v[2]} for k, v in tons.items()},
            "comment": comment[:600], "rows": rows, "per_bale_tables": per_bale}, None


# ------------------------------------------------------------------ feed
def title_ok(src, title, heading=""):
    """The report's own title must name the state, and the title or the
    report's own heading line ("Direct Hay Weighted Average Report for week
    ending ...") must say hay or straw. Alabama's title is "Alabama Direct
    Report (Bi-Weekly)": the hay is only in its heading."""
    t = (title or "") + " " + (heading or "")
    if not re.search(r"\b(hay|straw)\b", t, re.I):
        return False
    if src.get("match") and not re.search(src["match"], t, re.I):
        return False
    st, ti = src["state"], title or ""
    return bool(re.search(r"\b%s\b" % re.escape(STATES.get(st, st)), ti, re.I) or re.search(r",\s*%s\b" % st, ti))


def kind_of(title):
    return "auction" if re.search(r"\bauction\b", title or "", re.I) else "direct"


def merge(existing, src, rep, err, now_iso, slug):
    """One report, keep-last-good, never older."""
    b = dict(existing or {})
    b.update({"id": src["id"], "state": src["state"], "state_name": STATES.get(src["state"], src["state"])})
    if rep is None:
        b["status"] = {"ok": False, "note": err, "checked": now_iso}
        return b
    if b.get("date") and rep["date"] < b["date"]:
        b["status"] = {"ok": True, "note": "report %s older than %s held" % (rep["date"], b["date"]), "checked": now_iso}
        return b
    b.update({k: rep[k] for k in ("title", "heading", "date", "week_ending", "last_reported", "tons", "comment", "rows", "per_bale_tables")})
    b["kind"] = kind_of(rep["title"])
    b["biweekly"] = bool(re.search(r"bi-?weekly", rep["title"], re.I))
    b["slug"] = slug
    b["source_url"] = PAGE % slug
    b["pdf_url"] = URL % slug
    b["status"] = {"ok": True, "note": "", "checked": now_iso}
    return b


def load_sources(root):
    return json.loads((Path(root) / SOURCES).read_text())


def listing_reports(root):
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
    if not slug:
        return None, "no report number yet (run the probe for the AMS hay listing)"
    _, text, err = got
    if not text:
        return None, err
    rep, why = parse_report(text)
    if rep is None:
        return None, why
    if not title_ok(src, rep["title"], rep.get("heading")):
        return None, "report %s title %r does not name %s hay" % (slug, rep["title"][:90], src["state"])
    return rep, None


def run(root, got=None, now=None):
    """got = {slug: (raw, text, err)} in tests."""
    root = Path(root)
    now = now or datetime.datetime.now(datetime.timezone.utc)
    now_iso = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    cfg = load_sources(root)
    listing = listing_reports(root)
    old = {b["id"]: b for b in (FD.read_json(root / OUT) or {}).get("reports") or []}
    out = []
    for src in cfg["reports"]:
        slug = pick_slug(src, listing)
        g = (got.get(slug) if got is not None else (fetch(slug) if slug else None)) or (None, None, "not fetched")
        rep, why = read_one(src, slug, g)
        out.append(merge(old.get(src["id"]), src, rep, why, now_iso, slug))
    if not any(b.get("rows") for b in out):
        return None
    doc = {"updated": now_iso,
           "source": "USDA AMS Livestock, Poultry and Grain Market News, state hay reports",
           "note": "Confirmed trades as AMS reports them, $ per ton, by grade and bale type. Each report has its own date. "
                   "Not blended with the NASS monthly prices in hay-prices.json.",
           "reports": out}
    FD.atomic_write(root / OUT, doc)
    return doc


LINK_RE = re.compile(r"""<a\b[^>]*href=["'][^"']*?(?:ams_(\d{3,5})\.(?:pdf|txt)|viewReport/(\d{3,5}))/?["'][^>]*>(.*?)</a>""", re.I | re.S)


def parse_listing(html_text):
    """{link text: slug} for links whose text says hay or straw."""
    out = {}
    for m in LINK_RE.finditer(html_text or ""):
        t = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", m.group(3))).strip()
        if t and re.search(r"\b(hay|straw|forage)\b|\bdirect report\b", t, re.I):
            out[t] = m.group(1) or m.group(2)
    return out


def save_text(rd, slug, raw, text):
    if raw is not None:
        import hashlib
        idx = FD.read_json(rd / "index.json") or {}
        idx[slug] = {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
        FD.atomic_write(rd / "index.json", idx)
    if text:
        (rd / ("ams_%s.txt" % slug)).write_text(text)


def probe(root, scan=None):
    root = Path(root)
    rd = root / RAW_DIR
    rd.mkdir(parents=True, exist_ok=True)
    cfg = load_sources(root)
    listing = {}
    for url in cfg.get("listing_urls") or []:
        raw, err = FD.http_get(url)
        if raw is None:
            print("listing ERROR %s: %s" % (url, err))
            continue
        name = re.sub(r"[^a-z0-9]+", "-", url.lower().split("//", 1)[-1])[:80]
        (rd / ("listing-%s.html" % name)).write_bytes(raw)
        got = parse_listing(raw.decode("utf-8", "replace"))
        print("listing %s: %d hay report links" % (url, len(got)))
        listing.update(got)
    if scan:
        a, b = scan
        for n in range(a, b + 1):
            slug = str(n)
            if slug in listing.values():
                continue
            raw, text, err = fetch(slug, tries=1)
            if text:
                t = title_of([norm(x) for x in text.splitlines()])
                if re.search(r"\b(hay|straw)\b", t, re.I) or re.search(r"\bhay weighted average report\b", text[:3000], re.I):
                    listing[t] = slug
                    save_text(rd, slug, raw, text)
                    print("scan %s: %s" % (slug, t))
    FD.atomic_write(rd / "listing.json", {"urls": cfg.get("listing_urls"), "reports": listing})
    for t, s in sorted(listing.items()):
        print("  listed: %s -> %s" % (s, t))
    for src in cfg["reports"]:
        slug = pick_slug(src, listing)
        print("%s slug=%s" % (src["id"], slug))
        if not slug:
            continue
        raw, text, err = fetch(slug)
        save_text(rd, slug, raw, text)
        if err:
            print("  ERROR:", err)
        if text:
            rep, why = read_one(src, slug, (raw, text, None))
            if rep:
                print("  parsed %s: %d rows, tons %s" % (rep["date"], len(rep["rows"]), rep["tons"]))
            else:
                print("  NOT PARSED:", why)
    return 0


# ---------------------------------------------------------------- selftest
FIX = Path(__file__).resolve().parent.parent / "test" / "fixtures" / "hay-ams"


def selftest():
    fails = []

    def ck(name, ok, detail=""):
        print(("  ok   " if ok else "  FAIL ") + name + (f"  ({detail})" if not ok and detail else ""))
        if not ok:
            fails.append(name)

    sd_txt = (FIX / "ams_3183-2026-10-16.txt").read_text()
    sd, why = parse_report(sd_txt)
    ck("real SD 3183 parses", sd is not None, why)
    if sd:
        ck("SD title", sd["title"] == "South Dakota Direct Hay Report", sd["title"])
        ck("SD dated Fri Oct 16, 2026, week ending Oct 16, last reported Aug 31",
           (sd["date"], sd["week_ending"], sd["last_reported"]) == ("2026-10-16", "2026-10-16", "2026-08-31"),
           (sd["date"], sd["week_ending"], sd["last_reported"]))
        ck("SD tons: hay 1625 this week, 625 last reported, 1650 last year",
           sd["tons"]["hay"] == {"week": 1625, "last": 625, "year": 1650}, sd["tons"])
        ck("SD 7 rows, the Grass - Good row read past the page break", len(sd["rows"]) == 7, len(sd["rows"]))
        g = [(r["commodity"], r["grade"], r["bale"], r["qty"], r["lo"], r["hi"], r["avg"], r["freight"]) for r in sd["rows"]]
        ck("SD first row: Alfalfa Supreme, Large Square 3x4, 250 t, $300",
           g[0] == ("Alfalfa", "Supreme", "Large Square 3x4", 250, 300, 300, 300, "F.O.B."), g[0])
        ck("SD Good/Premium grade kept as written", ("Alfalfa", "Good/Premium", "Large Round", 500, 200, 200, 200, "F.O.B.") in g)
        ck("SD last row Grass Good 175", g[-1] == ("Grass", "Good", "Large Round", 200, 175, 175, 175, "F.O.B."), g[-1])
        # hand sum: 250 + 200 + 250 + 500 + 125 + 100 + 200 = 1625, the tons the report gives
        ck("SD row tons add to 1625", sum(r["qty"] for r in sd["rows"]) == 1625)
        ck("SD comment kept", sd["comment"].startswith("Good to very good demand for all classes of hay."), sd["comment"][:60])
        ck("SD alfalfa range across grades $180 to $300",
           (min(r["lo"] for r in sd["rows"] if r["commodity"] == "Alfalfa"), max(r["hi"] for r in sd["rows"] if r["commodity"] == "Alfalfa")) == (180, 300))

    al, why = parse_report((FIX / "ams_3050-2026-10-01.txt").read_text())
    ck("real AL 3050 (Oct 1) parses", al is not None, why)
    if al:
        ck("AL dated Thu Oct 1, week ending Oct 2", (al["date"], al["week_ending"]) == ("2026-10-01", "2026-10-02"))
        ck("AL 9 rows: 8 hay, 1 wheat straw", len(al["rows"]) == 9 and sum(r["kind"] == "straw" for r in al["rows"]) == 1)
        sq = [r for r in al["rows"] if r["commodity"] == "Bahia Grass" and r["bale"] == "Small Square"][0]
        ck("AL Bahia small square: 0.5 t at $400 with NO weighted average (left empty)",
           (sq["qty"], sq["lo"], sq["avg"]) == (0.5, 400, None), sq)
        bp = [r for r in al["rows"] if r["commodity"] == "Bermuda Grass" and r["grade"] == "Premium" and r["bale"] == "Small Square"][0]
        ck("AL Bermuda Premium small square 269.75 t, $280-440, avg 338.21",
           (bp["qty"], bp["lo"], bp["hi"], bp["avg"]) == (269.75, 280, 440, 338.21), bp)
        st = [r for r in al["rows"] if r["kind"] == "straw"][0]
        ck("AL straw: Wheat, no grade, 13.25 t at $300", (st["commodity"], st["grade"], st["qty"], st["avg"]) == ("Wheat", "", 13.25, 300), st)
        # 3 + 0.5 + 91.5 + 77.5 + 269.75 + 18 + 372 + 86 = 918.25 vs 918 reported
        ck("AL hay rows 918.25 t within rounding of 918", abs(sum(r["qty"] for r in al["rows"] if r["kind"] == "hay") - 918.25) < 1e-9)
    al2, why = parse_report((FIX / "ams_3050-2026-09-02.txt").read_text())
    # hand count: Bahia Premium 2, Bahia Fair 2, Bermuda Premium 3, Good 1, Fair 1, Mixed Grass Good 1 (after the
    # page break), wheat straw 1 = 11; hay tons 24.5+5+60+25+24+27+290.75+448+108+71.5 = 1083.75 vs 1083 reported
    ck("real AL 3050 (Sep 2) parses, the Mixed Grass table after a page break read",
       al2 is not None and len(al2["rows"]) == 11 and al2["rows"][-2]["commodity"] == "Mixed Grass", why or len(al2["rows"]))

    # refusals
    bad = sd_txt.replace("Large Round                200           210.00         210.00", "Large Round                200           210.00         220.00")
    ck("an average outside its own range refuses the report", parse_report(bad)[0] is None)
    bad = sd_txt.replace("Large Round                500           200.00         200.00", "Large Round                400           200.00         200.00")
    ck("row tons that do not add to the report's tons refuse it", parse_report(bad)[0] is None)
    bad = sd_txt.replace("Large Round                125           180.00         180.00", "Large Round                125           1 80.00        180.00")
    ck("a price that is not part of a readable row refuses the report", parse_report(bad)[0] is None)
    bad = sd_txt.replace("Large Round                100           200.00         200.00", "Large Round                100           2.00           2.00").replace(
        "1625                                  625", "1625                                  625")
    ck("a price under the sane floor refuses the report", parse_report(bad)[0] is None)
    ck("no report date, no report", parse_report(sd_txt.replace("Fri Oct 16, 2026", ""))[0] is None)
    bale = sd_txt.replace("Grass - Good (Trade/Per Ton)", "Grass - Good (Trade/Per Bale)")
    pb, why = parse_report(bale)
    ck("a Per Bale table is left out, counted, and never mixed with tons",
       pb is not None and pb["per_bale_tables"] == 1 and len(pb["rows"]) == 6, why or (pb and pb["per_bale_tables"]))
    ck("dates", find_date("Fri Oct 16, 2026", True) == "2026-10-16" and find_date("10/16/2026") == "2026-10-16")

    src = {"id": "sd-direct", "state": "SD", "match": "direct hay"}
    rep, why = read_one(src, "3183", (None, sd_txt, None))
    ck("a report naming its state is used", rep is not None, why)
    ck("the same report is refused for another state (wrong slug)", read_one(dict(src, id="nd", state="ND"), "3183", (None, sd_txt, None))[0] is None)
    ck("no slug, nothing", read_one(src, None, (None, None, None))[0] is None)
    ck("title check: auction title with ', IA' names Iowa",
       title_ok({"state": "IA"}, "Rock Valley Hay Auction - Rock Valley, IA") and not title_ok({"state": "IA"}, "Rock Valley Cattle - Rock Valley, IA"))
    ck("kind from title", kind_of("Rock Valley Hay Auction") == "auction" and kind_of("South Dakota Direct Hay Report") == "direct")

    now = "2026-10-16T22:00:00Z"
    b = merge({}, src, rep, None, now, "3183")
    ck("first issue written with its source page", b["date"] == "2026-10-16" and b["source_url"].endswith("/3183") and b["kind"] == "direct")
    b2 = merge(b, src, dict(rep, date="2026-10-09", rows=[]), None, now, "3183")
    ck("an older issue never replaces a newer one", b2["date"] == "2026-10-16" and len(b2["rows"]) == 7)
    b3 = merge(b, src, None, "fetch failed: timeout", now, "3183")
    ck("a failed fetch keeps the last good issue and records why", len(b3["rows"]) == 7 and b3["status"]["ok"] is False)

    lst = parse_listing('<li><a href="/mnreports/ams_3183.pdf">South Dakota Direct Hay Report</a></li>'
                        '<li><a href="https://www.ams.usda.gov/mnreports/ams_1245.pdf">Joplin Regional Stockyards</a></li>'
                        '<li><a href="https://mymarketnews.ams.usda.gov/viewReport/2911">Missouri Weekly Hay Summary</a></li>')
    ck("listing keeps hay links only", lst == {"South Dakota Direct Hay Report": "3183", "Missouri Weekly Hay Summary": "2911"}, lst)
    ck("listing keeps a state 'Direct Report' link (Alabama's title has no 'hay')",
       parse_listing('<a href="/mnreports/ams_3050.pdf">Alabama Direct Report (Bi-Weekly)</a>') == {"Alabama Direct Report (Bi-Weekly)": "3050"})
    alrep, why = read_one({"id": "al-direct", "state": "AL", "match": "direct"}, "3050", (None, (FIX / "ams_3050-2026-10-01.txt").read_text(), None))
    ck("Alabama is used: the hay is in its heading line, the state in its title", alrep is not None, why)
    ck("a title that never says hay anywhere is refused",
       not title_ok({"state": "AL"}, "Alabama Direct Report (Bi-Weekly)", "Feeder Cattle Weighted Average Report for week ending 10/2/2026"))
    ck("listing fills a missing slug by title", pick_slug({"state": "MO"}, lst) == "2911")

    import tempfile
    with tempfile.TemporaryDirectory() as d:
        dp = Path(d)
        (dp / "scripts").mkdir()
        (dp / SOURCES).write_text(json.dumps({"reports": [{"id": "sd-direct", "state": "SD", "slug": "3183"},
                                                           {"id": "al-direct", "state": "AL", "slug": "3050"}]}))
        doc = run(dp, got={"3183": (None, sd_txt, None), "3050": (None, None, "fetch failed: 403")},
                  now=datetime.datetime(2026, 10, 16, 22, tzinfo=datetime.timezone.utc))
        ck("run writes the reports that read and marks the rest", doc and [r["status"]["ok"] for r in doc["reports"]] == [True, False])
        again = run(dp, got={}, now=datetime.datetime(2026, 10, 17, tzinfo=datetime.timezone.utc))
        ck("a run that reads nothing keeps the last good issue, marked not refreshed",
           again is not None and again["reports"][0]["date"] == "2026-10-16" and again["reports"][0]["status"]["ok"] is False)
        (dp / OUT).unlink()
        ck("an empty first run writes no file", run(dp, got={}) is None and not (dp / OUT).exists())

    cfg = json.loads((ROOT / SOURCES).read_text())
    ids = [x["id"] for x in cfg["reports"]]
    ck("source ids unique", len(ids) == len(set(ids)))
    ck("every source has a real state", all(x["state"] in STATES for x in cfg["reports"]))
    ck("every match is a valid pattern", all(re.compile(x.get("match") or "") for x in cfg["reports"]))

    print()
    if fails:
        print("%d FAILED" % len(fails))
        return 1
    print("all AMS hay checks pass")
    return 0


def main(argv):
    if "--selftest" in argv:
        return selftest()
    if "--probe" in argv:
        scan = None
        if "--scan" in argv:
            i = argv.index("--scan")
            m = re.match(r"^(\d{3,5})-(\d{3,5})$", argv[i + 1] if i + 1 < len(argv) else "")
            if m and 0 <= int(m.group(2)) - int(m.group(1)) <= 1500:
                scan = (int(m.group(1)), int(m.group(2)))
            elif argv[i + 1:] and argv[i + 1]:
                print("::warning::--scan wants A-B, at most 1500 numbers; skipped")
        return probe(ROOT, scan)
    doc = run(ROOT)
    if not doc:
        print("::warning::no AMS hay report parsed; %s not written" % OUT)
        return 0
    for b in doc["reports"]:
        s = b.get("status") or {}
        print("[hay-ams] %s ok=%s %s" % (b["id"], s.get("ok"), s.get("note", "")))
        if not s.get("ok"):
            print("::warning::%s not refreshed: %s" % (b["id"], s.get("note", "")))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
