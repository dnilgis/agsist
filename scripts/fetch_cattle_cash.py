#!/usr/bin/env python3
"""
AGSIST -- data/cattle-cash.json: the cash side of cattle-futures-prices.html.

Sources, USDA AMS Livestock Mandatory Reporting, public PDFs (latest issue):
  * Boxed beef cutout, LM_XB403 "National Daily Boxed Beef Cutout & Boxed Beef
    Cuts - Negotiated Sales - PM" (MMN 2453), each trading day.
      https://www.ams.usda.gov/mnreports/ams_2453.pdf
    Read: the "Current Cutout Values" line, Choice 600-900 and Select 600-900.
  * Fed steers, LM_CT150 "5 Area Weekly Weighted Average Direct Slaughter
    Cattle" (MMN 2477), weekly.
      https://www.ams.usda.gov/mnreports/ams_2477.pdf
    Read: in the STEERS: LIVE FOB block, the "Total all grades" line (head
    count first, weighted average price last).

NOT HERE: the CME Feeder Cattle Index. CME publishes it on its own site; no
public file was confirmed for it, so nothing is fetched or shown for it.

Modes:
  (default)   fetch both, validate, write. Each block keeps its last good value
              on any failure and records why in `status`.
  --probe     fetch both, save the raw PDFs and their text to
              data/cattle-cash-raw/, print what parsed. Writes no feed.
  --selftest  offline tests, non-zero exit on any failure.

WHAT THIS FILE WILL NOT DO
  * Write a value it could not read, or a zero.
  * Replace a newer report date with an older one.
  * Keep a cutout where Select is above Choice, or a fed steer price more than
    25% away from the nearby live cattle futures in data/prices.json.

ONLY A LIVE RUN CAN CONFIRM
  * The text layout of either PDF. The fixtures below are RECONSTRUCTIONS from
    the figures quoted in search results (Oct 12 2026 cutout: Choice 375.56,
    Select 354.13; week ending Sep 28 2025: steers live FOB, total all grades
    17,153 head at 232.65). They are not captures. Dispatch the cattle-cash
    workflow once with "probe" ticked, read data/cattle-cash-raw/, and adjust.

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
OUT = "data/cattle-cash.json"
RAW_DIR = "data/cattle-cash-raw"
PRICES = "data/prices.json"
SRC = {
    "cutout": {"url": "https://www.ams.usda.gov/mnreports/ams_2453.pdf",
               "page": "https://mymarketnews.ams.usda.gov/viewReport/2453",
               "name": "USDA AMS LM_XB403, National Daily Boxed Beef Cutout, PM"},
    "fed_steer": {"url": "https://www.ams.usda.gov/mnreports/ams_2477.pdf",
                  "page": "https://mymarketnews.ams.usda.gov/viewReport/2477",
                  "name": "USDA AMS LM_CT150, 5 Area Weekly Weighted Average Direct Slaughter Cattle"},
}
CUTOUT_RANGE = (150.0, 700.0)
STEER_RANGE = (100.0, 450.0)
MONTHS = ["january", "february", "march", "april", "may", "june", "july",
          "august", "september", "october", "november", "december"]


def norm_lines(text):
    return [re.sub(r"[ \t ]+", " ", ln).strip() for ln in (text or "").splitlines()]


def find_date(s):
    """First date in s as YYYY-MM-DD: 'October 12, 2026', '10/12/2026' or '10/12/26'."""
    m = re.search(r"\b(" + "|".join(x[:3] for x in MONTHS) + r")[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b", s, re.I)
    if m:
        try:
            return datetime.date(int(m.group(3)), [x[:3] for x in MONTHS].index(m.group(1).lower()) + 1,
                                 int(m.group(2))).isoformat()
        except ValueError:
            pass
    m = re.search(r"\b(\d{1,2})/(\d{1,2})/(\d{4}|\d{2})\b", s)
    if m:
        y = int(m.group(3))
        y = y + 2000 if y < 100 else y
        try:
            return datetime.date(y, int(m.group(1)), int(m.group(2))).isoformat()
        except ValueError:
            pass
    return None


def parse_cutout(text):
    """({"date", "choice", "select"}, None) or (None, reason)."""
    lines = norm_lines(text)
    date = None
    for ln in lines[:15]:
        date = find_date(ln)
        if date:
            break
    if not date:
        return None, "no report date in the first lines"
    for ln in lines:
        m = re.match(r"^current cutout values:?\s+(\d{3}\.\d{2})\s+(\d{3}\.\d{2})\b", ln, re.I)
        if m:
            ch, se = float(m.group(1)), float(m.group(2))
            if not (CUTOUT_RANGE[0] <= se <= CUTOUT_RANGE[1] and CUTOUT_RANGE[0] <= ch <= CUTOUT_RANGE[1]):
                return None, "cutout %.2f/%.2f outside %s" % (ch, se, CUTOUT_RANGE)
            if se > ch:
                return None, "Select %.2f above Choice %.2f: columns misread" % (se, ch)
            return {"date": date, "choice": ch, "select": se}, None
    return None, "no 'Current Cutout Values' line"


def parse_fed_steer(text):
    """({"week_ending", "price", "head"}, None) or (None, reason)."""
    lines = norm_lines(text)
    week = None
    for ln in lines[:40]:
        if re.search(r"week\s+ending", ln, re.I):
            week = find_date(ln)
            if week:
                break
    if not week:
        return None, "no week-ending date"
    start = next((i for i, ln in enumerate(lines) if re.match(r"^steers?:?\s+live\s+fob\b", ln, re.I)), None)
    if start is None:
        return None, "no STEERS: LIVE FOB block"
    for ln in lines[start + 1: start + 25]:
        if re.match(r"^(heifers?|steers?|mixed)\b.*:", ln, re.I):
            break
        m = re.match(r"^total\s+all\s+grades\s+(\d{1,3}(?:,\d{3})*)\b.*?(\d{3}\.\d{2})\s*$", ln, re.I)
        if m:
            head, price = int(m.group(1).replace(",", "")), float(m.group(2))
            if head <= 0:
                return None, "no head"
            if not STEER_RANGE[0] <= price <= STEER_RANGE[1]:
                return None, "steer price %.2f outside %s" % (price, STEER_RANGE)
            return {"week_ending": week, "price": price, "head": head}, None
    return None, "no 'Total all grades' line in the STEERS: LIVE FOB block"


def nearby_live(prices):
    q = (prices or {}).get("quotes") or {}
    o = q.get("cattle-nearby") or q.get("cattle") or {}
    c = o.get("close")
    return float(c) if isinstance(c, (int, float)) and c > 0 else None


def merge(existing, key, parsed, err, now_iso, date_field, extra_check=None):
    """One block, keep-last-good, never older."""
    doc = dict(existing or {})
    blk = dict(doc.get(key) or {})
    st = dict(doc.get("status") or {})
    if parsed is not None and extra_check:
        why = extra_check(parsed)
        if why:
            parsed, err = None, why
    if parsed is None:
        st[key] = {"ok": False, "note": err, "checked": now_iso}
    elif blk.get(date_field) and parsed[date_field] < blk[date_field]:
        st[key] = {"ok": True, "note": "report %s older than %s held" % (parsed[date_field], blk[date_field]),
                   "checked": now_iso}
    else:
        blk = dict(parsed, source=SRC[key]["name"], source_url=SRC[key]["page"])
        doc[key] = blk
        st[key] = {"ok": True, "note": "", "checked": now_iso}
    doc["status"] = st
    return doc


def fetch(url):
    raw, err = FD.http_get(url)
    if raw is None:
        return None, None, "fetch failed: %s" % err
    if raw[:5] != b"%PDF-":
        return raw, None, "not a PDF (blocked or moved)"
    text, e = FD.pdf_to_text(raw)
    return raw, text, (None if text else "PDF text extraction failed: %s" % e)


def run(root, got=None, now=None):
    """got = {"cutout": (raw, text, err), "fed_steer": (...)} in tests."""
    root = Path(root)
    now = now or datetime.datetime.now(datetime.timezone.utc)
    now_iso = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    got = got or {k: fetch(v["url"]) for k, v in SRC.items()}
    existing = FD.read_json(root / OUT) or {}
    lc = nearby_live(FD.read_json(root / PRICES))
    doc = existing
    _, t, e = got["cutout"]
    p, e = parse_cutout(t) if t else (None, e)
    doc = merge(doc, "cutout", p, e, now_iso, "date")
    _, t, e = got["fed_steer"]
    p, e = parse_fed_steer(t) if t else (None, e)

    def near_futures(x):
        if lc and abs(x["price"] - lc) / lc > 0.25:
            return "steer price %.2f is over 25%% from nearby live cattle futures %.2f" % (x["price"], lc)
        return None
    doc = merge(doc, "fed_steer", p, e, now_iso, "week_ending", near_futures)
    has_value = any(k in doc for k in SRC)
    if has_value:
        doc["updated"] = now_iso
        if doc != existing:
            FD.atomic_write(root / OUT, doc)
    return doc if has_value else None


def probe(root):
    rd = Path(root) / RAW_DIR
    rd.mkdir(parents=True, exist_ok=True)
    for k, v in SRC.items():
        raw, text, err = fetch(v["url"])
        print("%s %s" % (k, v["url"]))
        if raw is not None:
            (rd / (k + ".raw")).write_bytes(raw)
            print("  got %d bytes" % len(raw))
        if err:
            print("  ERROR:", err)
        if text:
            (rd / (k + ".txt")).write_text(text)
            p, why = (parse_cutout if k == "cutout" else parse_fed_steer)(text)
            print("  parsed:", p or "NOT PARSED (%s)" % why)
    return 0


# ---------------------------------------------------------------- selftest
CUTOUT_FIX = """LM_XB403
Des Moines, IA          Mon, Oct 12, 2026          USDA Market News
National Daily Boxed Beef Cutout And Boxed Beef Cuts - Negotiated Sales - PM
Agricultural Marketing Service
October 12, 2026

                                   Choice 600-900      Select 600-900
Current Cutout Values:                 375.56              354.13
Change from prior day:                  -1.12               -0.87
Choice/Select spread:                  21.43
Total Load Count (Cuts, Trimmings, Grinds): 80
"""
STEER_FIX = """LM_CT150
St. Joseph, MO        Mon Sep 29, 2025        USDA-MO Dept of Ag Market News
5 Area Weekly Weighted Average Direct Slaughter Cattle
For Week Ending: 09/28/2025

Confirmed: 47,212

STEERS: LIVE FOB
                     Head Count   Weight Range    Avg Weight   Price Range       Avg Price
Over 80% Choice          15,590   1,250 - 1,750        1,480   228.00 - 236.00      232.35
65 - 80% Choice             980   1,200 - 1,650        1,440   228.00 - 235.00      233.10
Total all grades         17,153   1,200 - 1,750        1,478   228.00 - 236.00      232.65

STEERS: DRESSED DELIVERED
Total all grades          9,000   800 - 1,050            950   362.00 - 368.00      365.10
"""


def selftest():
    fails = []

    def ck(name, ok, detail=""):
        print(("  ok   " if ok else "  FAIL ") + name + (f"  ({detail})" if not ok and detail else ""))
        if not ok:
            fails.append(name)

    p, why = parse_cutout(CUTOUT_FIX)
    ck("cutout: date, Choice and Select", p == {"date": "2026-10-12", "choice": 375.56, "select": 354.13}, p or why)
    ck("cutout: Select above Choice is refused as misread columns",
       parse_cutout(CUTOUT_FIX.replace("375.56              354.13", "354.13              375.56"))[0] is None)
    ck("cutout: no values line, no value", parse_cutout(CUTOUT_FIX.replace("Current Cutout Values:", "x"))[0] is None)
    ck("cutout: no date, no value", parse_cutout("Current Cutout Values: 375.56 354.13")[0] is None)
    ck("dates: 'Mon, Oct 12, 2026', 'October 12, 2026', '10/12/2026', '10/12/26'",
       {find_date(x) for x in ("Mon, Oct 12, 2026", "October 12, 2026", "10/12/2026", "10/12/26")} == {"2026-10-12"})
    s, why = parse_fed_steer(STEER_FIX)
    ck("fed steers: week, live FOB total all grades, head",
       s == {"week_ending": "2025-09-28", "price": 232.65, "head": 17153}, s or why)
    ck("fed steers: the dressed block's total is never read as the live price",
       parse_fed_steer(STEER_FIX.replace("Total all grades         17,153", "Total xx"))[0] is None)
    ck("fed steers: no week-ending date, no value",
       parse_fed_steer(STEER_FIX.replace("For Week Ending: 09/28/2025", ""))[0] is None)

    now = "2026-10-15T22:00:00Z"
    d = merge({}, "cutout", p, None, now, "date")
    ck("first cutout written with its source", d["cutout"]["choice"] == 375.56 and "LM_XB403" in d["cutout"]["source"])
    d2 = merge(d, "cutout", dict(p, date="2026-10-09", choice=380.0), None, now, "date")
    ck("an older report never replaces a newer date", d2["cutout"]["choice"] == 375.56)
    d3 = merge(d, "cutout", None, "fetch failed: timeout", now, "date")
    ck("a failed fetch keeps the last good block and records why",
       d3["cutout"]["choice"] == 375.56 and d3["status"]["cutout"]["ok"] is False)
    far = merge({}, "fed_steer", dict(s, price=150.0), None, now, "week_ending",
                lambda x: "far" if abs(x["price"] - 223.9) / 223.9 > 0.25 else None)
    ck("a steer price far from the board is refused", "fed_steer" not in far and far["status"]["fed_steer"]["ok"] is False)

    print()
    if fails:
        print("%d FAILED" % len(fails))
        return 1
    print("all cattle cash checks pass")
    return 0


def main(argv):
    if "--selftest" in argv:
        return selftest()
    if "--probe" in argv:
        return probe(ROOT)
    doc = run(ROOT)
    st = (doc or {}).get("status") or {}
    for k in SRC:
        s = st.get(k) or {}
        print("[cattle-cash] %s ok=%s %s" % (k, s.get("ok"), s.get("note", "")))
        if not s.get("ok"):
            print("::warning::%s not refreshed: %s" % (k, s.get("note", "no file")))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
