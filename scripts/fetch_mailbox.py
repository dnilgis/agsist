#!/usr/bin/env python3
"""
AGSIST -- data/dairy-mailbox.json: the newest federal-order mailbox milk price.

Source: USDA AMS Mailbox Milk Price Report (MMN report 3357), monthly, about
three months after the month it covers (February 2026 was in the May 20, 2026
report, March 2026 in the June report).
    https://www.ams.usda.gov/mnreports/ams_3357.pdf     (the latest issue)
    https://mymarketnews.ams.usda.gov/viewReport/3357  (the report page)

What is read: the report's summary sentence, which reads like
    "In February 2026, mailbox milk prices for selected reporting areas in
     Federal milk orders averaged $17.45 per cwt, up $0.72 from the January
     2026 average and down $5.87 per cwt from the February 2025 average."
The all-area average and the two changes come from that sentence. The
reporting-area table is not parsed.

Modes:
  (default)   fetch, validate, write. Keep-last-good on any failure.
  --probe     fetch, save the raw PDF and text to data/dairy-raw/, print what
              parsed. Writes no feed.
  --selftest  offline tests, non-zero exit on any failure.

WHAT THIS FILE WILL NOT DO
  * Write a value it could not read from the sentence, or a zero.
  * Replace a newer month with an older one.
  * Keep a month whose change from the month before disagrees with the
    month before as held here (by more than a cent).
  * On failure it leaves the last good file alone and only updates `status`.

ONLY A LIVE RUN CAN CONFIRM
  * The summary sentence wording in the live PDF. The fixtures below are built
    from the wording quoted in search results for the February and March 2026
    reports, not from captures of the PDF. Run --probe on the first live run.
  * That ams_3357.pdf is the latest-issue alias, as dymclassprices.pdf is for
    the class prices.

Stdlib only, plus pdftotext or pypdf through fetch_dairy.pdf_to_text.
"""
import datetime
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch_dairy as FD  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = "data/dairy-mailbox.json"
RAW_DIR = "data/dairy-raw"
URL = "https://www.ams.usda.gov/mnreports/ams_3357.pdf"
PAGE_URL = "https://mymarketnews.ams.usda.gov/viewReport/3357"
RANGE = (8.0, 45.0)        # $/cwt
MONTHS = ["January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]
MON_RE = r"(January|February|March|April|May|June|July|August|September|October|November|December)"
LEAD = r"mailbox\s+(?:milk\s+)?prices?\s+for\s+(?:the\s+)?selected\s+reporting\s+areas\s+in\s+(?:the\s+)?federal\s+milk\s+orders?\s+averaged\s+\$\s?(\d{1,2}\.\d{2})"


def norm(text):
    t = (text or "").replace(" ", " ").replace("’", "'")
    return re.sub(r"\s+", " ", t)


def mkey(month, year):
    return "%d-%02d" % (int(year), MONTHS.index(month.capitalize()) + 1)


def kidx(key):
    return int(key[:4]) * 12 + int(key[5:]) - 1


def ikey(i):
    return "%d-%02d" % (i // 12, i % 12 + 1)


def parse(text, today):
    """{"month", "month_key", "value", "prev_month_change", "year_ago_change"}
    or (None, reason)."""
    t = norm(text)
    m = re.search(r"(?:In\s+)?" + MON_RE + r",?\s+(\d{4}),?\s+" + LEAD, t, re.I)
    if m:
        month, year, val = m.group(1), m.group(2), m.group(3)
    else:
        m = re.search(LEAD + r"\s*(?:per\s+cwt\.?|per\s+hundredweight)?,?\s+(?:in|for)\s+" + MON_RE + r",?\s+(\d{4})", t, re.I)
        if not m:
            return None, "summary sentence not found"
        val, month, year = m.group(1), m.group(2), m.group(3)
    month = month.capitalize()
    key = mkey(month, year)
    value = float(val)
    if not RANGE[0] <= value <= RANGE[1]:
        return None, "average $%.2f outside %s" % (value, RANGE)
    now = today.year * 12 + today.month - 1
    if kidx(key) >= now:
        return None, "month %s is not over yet" % key
    if kidx(key) < now - 12:
        return None, "month %s is over a year old" % key
    out = {"month": "%s %s" % (month, year), "month_key": key, "value": value,
           "prev_month_change": None, "year_ago_change": None}
    tail = t[m.end(): m.end() + 400]
    tail = tail.split(". ")[0] if ". " in tail else tail
    prev = kidx(key) - 1
    for c in re.finditer(r"(up|down)\s+\$?\s?(\d{1,2}\.\d{2})\s*(?:cents?\s+)?(?:per\s+cwt\.?\s+)?from\s+(?:the\s+)?"
                         + MON_RE + r",?\s+(\d{4})", tail, re.I):
        amt = float(c.group(2)) * (1 if c.group(1).lower() == "up" else -1)
        ck = kidx(mkey(c.group(3), c.group(4)))
        if ck == prev:
            out["prev_month_change"] = amt
        elif ck == kidx(key) - 12:
            out["year_ago_change"] = amt
    for c in re.finditer(r"unchanged\s+from\s+(?:the\s+)?" + MON_RE + r",?\s+(\d{4})", tail, re.I):
        ck = kidx(mkey(c.group(1), c.group(2)))
        if ck == prev:
            out["prev_month_change"] = 0.0
        elif ck == kidx(key) - 12:
            out["year_ago_change"] = 0.0
    return out, None


def compose(existing, parsed, err, now_iso):
    """(doc, wrote, note). Keep-last-good; never older; changes must agree."""
    doc = dict(existing or {})
    hist = dict(doc.get("history") or {})
    if parsed is None:
        if not existing:
            return None, False, err
        doc["status"] = {"ok": False, "note": err, "checked": now_iso}
        return doc, True, err
    held = doc.get("month_key")
    if held and kidx(parsed["month_key"]) < kidx(held):
        doc["status"] = {"ok": True, "note": "report is %s, older than %s held" % (parsed["month_key"], held),
                         "checked": now_iso}
        return doc, True, doc["status"]["note"]
    pk = ikey(kidx(parsed["month_key"]) - 1)
    if parsed["prev_month_change"] is not None and isinstance(hist.get(pk), (int, float)):
        if abs((parsed["value"] - hist[pk]) - parsed["prev_month_change"]) > 0.011:
            note = ("%s change from %s (%+.2f) disagrees with %s held for %s"
                    % (parsed["month_key"], pk, parsed["prev_month_change"], hist[pk], pk))
            doc["status"] = {"ok": False, "note": note, "checked": now_iso}
            return (doc if existing else None), bool(existing), note
    hist[parsed["month_key"]] = parsed["value"]
    doc.update({k: parsed[k] for k in ("month", "month_key", "value", "prev_month_change", "year_ago_change")})
    doc["history"] = dict(sorted(hist.items()))
    doc["source"] = "USDA AMS Mailbox Milk Price Report (MMN 3357)"
    doc["source_url"] = PAGE_URL
    doc["updated"] = now_iso if held != parsed["month_key"] else doc.get("updated", now_iso)
    doc["status"] = {"ok": True, "note": "", "checked": now_iso}
    return doc, True, ""


def fetch(opener=None, sleep=None):
    kw = {"opener": opener} if opener else {}
    if sleep:
        kw["sleep"] = sleep
    raw, err = FD.http_get(URL, **kw)
    if raw is None:
        return None, None, "AMS mailbox fetch failed: %s" % err
    if raw[:5] == b"%PDF-":
        text, e = FD.pdf_to_text(raw)
        return raw, text, (None if text else "AMS mailbox PDF text extraction failed: %s" % e)
    txt = raw.decode("utf-8", "replace")
    if re.search(r"<html|<!doctype|captcha|access denied", txt[:2000], re.I):
        return raw, None, "AMS returned a web page, not the mailbox PDF"
    return raw, txt, None


def run(root, got=None, now=None):
    root = Path(root)
    now = now or datetime.datetime.now(datetime.timezone.utc)
    raw, text, err = got if got is not None else fetch()
    parsed = None
    if text:
        parsed, err = parse(text, now.date())
    existing = FD.read_json(root / OUT)
    doc, wrote, note = compose(existing, parsed, err, now.strftime("%Y-%m-%dT%H:%M:%SZ"))
    if wrote and doc is not None and doc != existing:
        FD.atomic_write(root / OUT, doc)
    return doc, note


def probe(root):
    rd = Path(root) / RAW_DIR
    rd.mkdir(parents=True, exist_ok=True)
    raw, text, err = fetch()
    print("AMS mailbox %s" % URL)
    if raw is not None:
        (rd / "ams-mailbox.raw").write_bytes(raw)
        print("  got %d bytes (%s)" % (len(raw), "PDF" if raw[:5] == b"%PDF-" else "not a PDF"))
    if err:
        print("  ERROR:", err)
    if text:
        (rd / "ams-mailbox.txt").write_text(text)
        p, why = parse(text, datetime.date.today())
        print("  parsed:", p or "NOT PARSED (%s)" % why)
    return 0


# ---------------------------------------------------------------- selftest
FEB = ("Mailbox Milk Price Report\nAgricultural Marketing Service\nMay 20, 2026\n\n"
       "In February 2026, mailbox milk prices for selected reporting areas in Federal\n"
       "milk orders averaged $17.45 per cwt, up $0.72 from the January 2026 average and down\n"
       "$5.87 per cwt from the February 2025 average. The component tests of producer milk\n"
       "in February 2026 were: butterfat, 4.31%; protein, 3.37%; and other solids, 5.80%.\n\n"
       "                         Mailbox Prices 1/\n"
       "Reporting Area           Feb 2026    Jan 2026    Feb 2025\n"
       "All Federal Order Areas 3/  17.45       16.73       23.32\n")
MAR_ALT = ("The March 2026 mailbox prices for selected reporting areas in federal milk orders averaged "
           "$18.84 per cwt, up $1.39 from the February 2026 average, and down $2.62 from the March 2025 average.")
MAR_FLIP = ("Mailbox milk prices for selected reporting areas in Federal milk orders averaged $18.84 per cwt "
            "in March 2026, up $1.39 from the February 2026 average and down $2.62 per cwt from the March 2025 average.")


def selftest():
    fails = []

    def ck(name, ok, detail=""):
        print(("  ok   " if ok else "  FAIL ") + name + (f"  ({detail})" if not ok and detail else ""))
        if not ok:
            fails.append(name)

    today = datetime.date(2026, 6, 1)
    p, why = parse(FEB, today)
    ck("February 2026 sentence: month, average, both changes",
       p == {"month": "February 2026", "month_key": "2026-02", "value": 17.45,
             "prev_month_change": 0.72, "year_ago_change": -5.87}, p or why)
    p2, _ = parse(MAR_ALT, datetime.date(2026, 7, 1))
    ck("'The March 2026 mailbox prices ...' wording", p2 and p2["month_key"] == "2026-03" and p2["value"] == 18.84
       and p2["prev_month_change"] == 1.39 and p2["year_ago_change"] == -2.62, p2)
    p3, _ = parse(MAR_FLIP, datetime.date(2026, 7, 1))
    ck("'averaged $X per cwt in March 2026' wording", p3 and p3["month_key"] == "2026-03" and p3["value"] == 18.84, p3)
    ck("a month not yet over is refused", parse(FEB, datetime.date(2026, 2, 20))[0] is None)
    ck("a month over a year old is refused", parse(FEB, datetime.date(2027, 6, 1))[0] is None)
    ck("an out-of-range average is refused", parse(FEB.replace("$17.45", "$1.74"), today)[0] is None)
    ck("no sentence, no value", parse("Mailbox table only 17.45 16.73", today)[0] is None)

    now = "2026-06-01T00:00:00Z"
    held = {"month": "January 2026", "month_key": "2026-01", "value": 16.73, "history": {"2026-01": 16.73}}
    doc, wrote, note = compose(held, p, None, now)
    ck("a newer month replaces the held one and keeps history",
       wrote and doc["month_key"] == "2026-02" and doc["history"] == {"2026-01": 16.73, "2026-02": 17.45}, doc)
    bad = dict(held, value=16.0, history={"2026-01": 16.0})
    doc, wrote, note = compose(bad, p, None, now)
    ck("a change from last month that disagrees with the held month is refused",
       doc["month_key"] == "2026-01" and doc["status"]["ok"] is False and "disagrees" in note, note)
    newer = {"month": "March 2026", "month_key": "2026-03", "value": 18.84, "history": {"2026-03": 18.84}}
    doc, wrote, note = compose(newer, p, None, now)
    ck("an older report never replaces a newer month", doc["month_key"] == "2026-03" and doc["value"] == 18.84)
    doc, wrote, note = compose(held, None, "AMS mailbox fetch failed: timeout", now)
    ck("a failed fetch keeps the last good month and records why",
       doc["value"] == 16.73 and doc["status"]["ok"] is False and "timeout" in doc["status"]["note"])
    doc, wrote, note = compose(None, None, "x", now)
    ck("no file and nothing parsed writes nothing", doc is None and not wrote)
    ck("Dec to Jan: last month is December of the year before",
       compose({"month_key": "2025-12", "value": 20.0, "history": {"2025-12": 20.0}},
               {"month": "January 2026", "month_key": "2026-01", "value": 20.5,
                "prev_month_change": 0.5, "year_ago_change": None}, None, now)[0]["month_key"] == "2026-01")
    ck("...and a Dec to Jan change that disagrees is caught",
       compose({"month_key": "2025-12", "value": 20.0, "history": {"2025-12": 20.0}},
               {"month": "January 2026", "month_key": "2026-01", "value": 20.5,
                "prev_month_change": 0.9, "year_ago_change": None}, None, now)[0]["month_key"] == "2025-12")

    print()
    if fails:
        print("%d FAILED" % len(fails))
        return 1
    print("all mailbox checks pass")
    return 0


def main(argv):
    if "--selftest" in argv:
        return selftest()
    if "--probe" in argv:
        return probe(ROOT)
    doc, note = run(ROOT)
    st = (doc or {}).get("status") or {}
    print("[mailbox] month=%s value=%s %s" % ((doc or {}).get("month_key"), (doc or {}).get("value"), note or ""))
    if not st.get("ok"):
        print("::warning::mailbox price not refreshed: %s" % (note or "no file"))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
