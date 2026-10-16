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
"All Federal Order Areas" row of the first table is used only to check it.

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

CHECKED AGAINST THE LIVE REPORT
  * The probe run of 2026-10-15 saved the live ams_3357.pdf (MMPR-0626,
    released Sep 23 2026, June 2026 $20.18) to data/dairy-raw/ams-mailbox.*;
    a copy is the main selftest fixture, test/fixtures/mailbox/mmpr-0626.txt.
    The sentence wording matched; ams_3357.pdf is the latest issue. Only the
    newest month (the sentence) is taken for the average.
  * Reporting areas (added 2026-10-16): the first table's area rows (year
    ago, last month, this month) are read, and each area's this-month and
    last-month figures must match the same area in the by-month table
    further down (a second print of the same numbers). Any area missing,
    out of order, out of range or disagreeing drops ALL areas for that
    month; the average above is unaffected.

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
    # The real report (MMPR-0626, Sep 23 2026) follows the sentence with a
    # table headed "Mailbox Milk Prices, June 2026" whose "All Federal Order
    # Areas" row is year ago, last month, this month. Where that table is
    # there, it must name the same month and agree with the sentence. The
    # by-month tables further down (Jan to Jun, the annual average) are never read.
    tb = re.search(r"mailbox milk prices,\s+" + MON_RE + r",?\s+(\d{4})\b(.*?)all federal order areas\s*\*?\s*"
                   r"(\d{1,2}\.\d{2})\s+(\d{1,2}\.\d{2})\s+(\d{1,2}\.\d{2})\b", t, re.I)
    if tb:
        if mkey(tb.group(1), tb.group(2)) != key:
            return None, "summary says %s but the table is headed %s %s" % (key, tb.group(1), tb.group(2))
        yago, last, cur = float(tb.group(4)), float(tb.group(5)), float(tb.group(6))
        if abs(cur - value) > 0.001:
            return None, "summary average $%.2f disagrees with the table's All Federal Order Areas $%.2f" % (value, cur)
        for fld, base in (("prev_month_change", last), ("year_ago_change", yago)):
            if out[fld] is not None and abs((value - base) - out[fld]) > 0.011:
                return None, "%s %+.2f disagrees with the table (%.2f vs %.2f)" % (fld, out[fld], value, base)
    return out, None


# The reporting areas in report order (MMPR-0626). An asterisk in the report
# marks a group of states or part of a state; GROUPS says which (report
# footnote, page 3).
AREAS = ["New England States", "New York", "Eastern Pennsylvania", "Appalachian States",
         "Southeast States", "Southern Missouri", "Florida", "Western Pennsylvania", "Ohio",
         "Indiana", "Michigan", "Wisconsin", "Minnesota", "Iowa", "Illinois", "Corn Belt States",
         "Western Texas", "New Mexico", "Northwest States", "California"]
NUM = r"(\d{1,2}\.\d{2})"


def _area_rows(seg, ncols):
    """{area: [n numbers]} for every AREAS name found in seg, in order, each
    followed by exactly the numbers up to the next name (ncols minimum)."""
    names = AREAS + ["All Federal Order Areas"]
    pat = "(" + "|".join(re.escape(n) for n in names) + r")\s*\*?\s*((?:\d{1,2}\.\d{2}\s*)+)"
    out, order = {}, []
    for m in re.finditer(pat, seg):
        nums = [float(x) for x in re.findall(NUM, m.group(2))]
        if m.group(1) in out or len(nums) < ncols:
            return None, order
        out[m.group(1)] = nums
        order.append(m.group(1))
    return out, order


def parse_areas(text, month_key):
    """([{"area", "value", "prev", "year_ago"}...], None) or (None, reason).
    Reads the 'Mailbox Milk Prices, <Month> <Year>' table and checks every
    row against the by-month table for the same half year."""
    t = norm(text)
    y, mo = int(month_key[:4]), int(month_key[5:])
    mname = MONTHS[mo - 1]
    head = re.search(r"Mailbox Milk Prices,\s+" + mname + r",?\s+" + str(y) + r"\b", t, re.I)
    if not head:
        return None, "area table for %s not found" % month_key
    end = re.search(r"All Federal Order Areas\s*\*?\s*" + NUM + r"\s+" + NUM + r"\s+" + NUM, t[head.end():])
    if not end:
        return None, "area table has no All Federal Order Areas row"
    seg = t[head.end(): head.end() + end.end()]
    rows, order = _area_rows(seg, 3)
    if rows is None or order != AREAS + ["All Federal Order Areas"]:
        return None, "area table rows not as expected (%d read)" % len(order)
    if any(len(v) != 3 for v in rows.values()):
        return None, "an area row does not have exactly 3 figures"
    # the by-month table for the same half year: "by Month, January - June 2026"
    half = ("January", "June") if mo <= 6 else ("July", "December")
    bm = re.search(r"by\s+Month,\s+" + half[0] + r"\s*[-\u2013]+\s*" + half[1] + r"\s+" + str(y) + r"\b", t, re.I)
    if not bm:
        return None, "by-month table for %s %s-%s not found" % (y, half[0], half[1])
    k = (mo - 1) % 6
    rest = t[bm.end():]
    stop = re.search(r"All Federal Order Areas\s*\*?\s*((?:\d{1,2}\.\d{2}\s*)+)", rest)
    if not stop:
        return None, "by-month table has no All Federal Order Areas row"
    rows2, order2 = _area_rows(rest[: stop.end()], k + 1)
    if rows2 is None or order2 != AREAS + ["All Federal Order Areas"]:
        return None, "by-month table rows not as expected"
    out = []
    for a in AREAS + ["All Federal Order Areas"]:
        yago, prev, cur = rows[a]
        if not all(RANGE[0] <= x <= RANGE[1] for x in (yago, prev, cur)):
            return None, "%s figure outside %s" % (a, RANGE)
        if abs(rows2[a][k] - cur) > 0.001:
            return None, "%s %s: %.2f in the first table, %.2f in the by-month table" % (a, month_key, cur, rows2[a][k])
        if k > 0 and abs(rows2[a][k - 1] - prev) > 0.001:
            return None, "%s last month: %.2f vs %.2f in the by-month table" % (a, prev, rows2[a][k - 1])
        if a != "All Federal Order Areas":
            out.append({"area": a, "value": cur, "prev": prev, "year_ago": yago})
        else:
            allrow = cur
    return {"month_key": month_key, "all": allrow, "rows": out}, None


def compose(existing, parsed, err, now_iso, areas=None):
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
    # areas belong to one month and must agree with the average just written
    if isinstance(areas, dict) and areas.get("month_key") == parsed["month_key"] \
            and abs(areas.get("all", -1) - parsed["value"]) < 0.001:
        doc["areas"] = areas
    elif (doc.get("areas") or {}).get("month_key") != parsed["month_key"]:
        doc.pop("areas", None)
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
    parsed, areas = None, None
    if text:
        parsed, err = parse(text, now.date())
        if parsed:
            areas, aerr = parse_areas(text, parsed["month_key"])
            if aerr:
                print("::warning::mailbox areas not written: %s" % aerr)
    existing = FD.read_json(root / OUT)
    doc, wrote, note = compose(existing, parsed, err, now.strftime("%Y-%m-%dT%H:%M:%SZ"), areas)
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
        if p:
            a, aw = parse_areas(text, p["month_key"])
            print("  areas:", ("%d read" % len(a["rows"])) if a else "NOT READ (%s)" % aw)
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

    # the real report: MMPR-0626, released Sep 23 2026, covering June 2026
    # (probe of 2026-10-15); every number checked by hand
    real = (ROOT / "test/fixtures/mailbox/mmpr-0626.txt").read_text()
    r, why = parse(real, datetime.date(2026, 10, 15))
    ck("real report: June 2026 $20.18, down $0.25 from May, down $0.37 from June 2025",
       r == {"month": "June 2026", "month_key": "2026-06", "value": 20.18,
             "prev_month_change": -0.25, "year_ago_change": -0.37}, r or why)
    ck("real report: the table's month and its All Federal Order Areas row agree",
       parse(real.replace("All Federal Order Areas *\n20.55\n20.43\n20.18", "All Federal Order Areas *\n20.55\n20.43\n20.28"),
             datetime.date(2026, 10, 15))[0] is None)
    ck("real report: a change that disagrees with the table is refused",
       parse(real.replace("down $0.25 from the May", "down $0.35 from the May"), datetime.date(2026, 10, 15))[0] is None)
    ck("real report: a table headed with another month is refused",
       parse(real.replace("Mailbox Milk Prices, June 2026", "Mailbox Milk Prices, May 2026"), datetime.date(2026, 10, 15))[0] is None)
    # reporting areas, every figure read off MMPR-0626 by hand (Oct 16)
    ar, aw = parse_areas(real, "2026-06")
    byname = {x["area"]: x for x in (ar or {}).get("rows", [])}
    ck("areas: 20 read, in report order", ar is not None and len(ar["rows"]) == 20, aw)
    ck("areas: Wisconsin $18.13 (May $19.13, Jun 2025 $21.15)",
       byname.get("Wisconsin") == {"area": "Wisconsin", "value": 18.13, "prev": 19.13, "year_ago": 21.15})
    ck("areas: Minnesota $18.04, Iowa $18.29, Florida $27.59, California $18.97",
       [byname.get(n, {}).get("value") for n in ("Minnesota", "Iowa", "Florida", "California")] == [18.04, 18.29, 27.59, 18.97])
    ck("areas: All Federal Order Areas $20.18 carried for the cross-check", ar and ar["all"] == 20.18)
    ck("areas: a first-table figure that disagrees with the by-month table drops all areas",
       parse_areas(real.replace("Wisconsin\n21.15\n19.13\n18.13", "Wisconsin\n21.15\n19.13\n18.31"), "2026-06")[0] is None)
    ck("areas: a missing area drops all areas",
       parse_areas(real.replace("Iowa\n20.10\n19.28\n18.29\n", ""), "2026-06")[0] is None)
    ck("areas: asking for another month finds no table", parse_areas(real, "2026-05")[0] is None)
    doc, _, _ = compose({"month_key": "2026-05", "value": 20.43, "history": {"2026-05": 20.43}}, r, None, "2026-10-16T00:00:00Z", ar)
    ck("areas written with the month they belong to", doc.get("areas", {}).get("month_key") == "2026-06")
    doc2, _, _ = compose(dict(doc), dict(r, month="July 2026", month_key="2026-07", value=20.0, prev_month_change=None),
                         None, "2026-11-16T00:00:00Z", None)
    ck("a newer month without readable areas drops the old month's areas", "areas" not in doc2)
    held_mar = {"month": "March 2026", "month_key": "2026-03", "value": 18.84, "history": {"2026-03": 18.84}}
    doc, wrote, note = compose(held_mar, r, None, "2026-10-15T16:23:00Z")
    ck("real report over the held March figure: June written, only the newest month added to history",
       wrote and doc["month_key"] == "2026-06" and doc["value"] == 20.18
       and doc["history"] == {"2026-03": 18.84, "2026-06": 20.18} and doc["status"]["ok"], doc)

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
