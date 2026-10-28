#!/usr/bin/env python3
"""build_chapter12.py -- Chapter 12 (family farmer and fisherman) bankruptcy
filings by state, from the U.S. Courts Table F-2 PDFs.

Writes data/farm-stress/chapter12.json. The state Farmland Atlas pages print one
small line from it ("Farm bankruptcies (Chapter 12)") and the Daily's fact pool
gets one dated sentence per new period (data/daily-facts.json, id ch12-latest).

WHAT IS COUNTED
  Cases commenced under Chapter 12 in a 12-month period, by federal bankruptcy
  court district, as U.S. Courts prints them. Filings, not farms: one farm can
  file more than once, and a filing is not a closed farm. Never per quarter:
  every F-2 table is a 12-month total. No rate per farm (no denominator here).
  A state with two or more districts is the sum of its districts; the page says
  so. Arkansas is one court for both districts from 2018 on (the table's own
  footnote). Territories (PR, VI, Guam, NMI) are kept in "districts" and the
  national total but have no state.

TWO TABLE LAYOUTS (both read here, both checked)
  2005-2017: Chapter 12 is the 4th number on each district row (Total, 7, 11,
             12, 13, ...). A dash is none: the row adds up only with dashes as 0.
  2018 on:   Chapter 12 sits in "Other Chapters"; a second table lists
             Total, 9, 12, 15, Other. Chapter 12 is its 3rd number.
  Every period must pass: the districts add up to the table's own Total row,
  and (newer layout) each row's Total = 9 + 12 + 15 + Other. A period that
  fails is not written; the run stops and says which.

INPUT
  The F-2 text files as the references branch keeps them
  (refs/uscourts-f2-<year>-<dec|sep|jun|mar>.txt, from refs.yml; the first
  three lines name the URL). The sandbox cannot open uscourts.gov; Actions can.

    python3 scripts/build_chapter12.py --refs DIR          rebuild from every F-2 text in DIR
    python3 scripts/build_chapter12.py --add FILE.txt      add or replace one period, keep the rest
    python3 scripts/build_chapter12.py --check             the committed file passes every rule
    python3 scripts/build_chapter12.py --selftest

NEXT RELEASE (by hand, no schedule; a new schedule needs Sig's OK): add the new
PDF to references/sources.json as uscourts-f2-<year>-<mon>, then run the
"Chapter 12 filings" workflow (.github/workflows/chapter12.yml) with that id. It
fetches the PDF, runs --add, refreshes the Daily fact and commits; the Atlas
pages rebuild after it.
"""
import argparse
import datetime as dt
import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "farm-stress", "chapter12.json")
FACTS = os.path.join(ROOT, "data", "daily-facts.json")
SOURCE_NAME = "U.S. Courts, Table F-2"
TERRITORIES = {"PR", "VI", "GU", "GUAM", "NMI"}
STATES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado",
    "CT": "Connecticut", "DE": "Delaware", "DC": "District of Columbia", "FL": "Florida", "GA": "Georgia",
    "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
    "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts",
    "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri", "MT": "Montana",
    "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico",
    "NY": "New York", "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
    "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota",
    "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington",
    "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
}
MONTHS = {"mar": ("03", "31"), "jun": ("06", "30"), "sep": ("09", "30"), "dec": ("12", "31")}
MON_NAME = {"03": "Mar 31", "06": "Jun 30", "09": "Sep 30", "12": "Dec 31"}
NUM = r"(?:\d{1,3}(?:,\d{3})*|-)"
ROW = re.compile(r"^\s*([A-Za-z][A-Za-z ,]*?|\d+(?:st|nd|rd|th|ST|ND|RD|TH))\.*\s*[¹²³]?\s+((?:" + NUM + r"\s+){3,}" + NUM + r")(?:\s|$)")
OLD_HEAD = re.compile(r"\b(?:Chapter\s+)?7\s+(?:Chapter\s+)?11\s+(?:Chapter\s+)?12\s+(?:Chapter\s+)?13\b", re.I)
PERIOD = re.compile(r"END(?:ING|ED)\s+([A-Z]{3})[A-Z]*\.?\s+(\d{1,2}),\s+(\d{4})", re.I)
SECTION_B = re.compile(r"District\s+Chapters\s+9\s+12\s+15")
CIRCUIT = re.compile(r"^\d+(st|nd|rd|th)$", re.I)


class TableError(ValueError):
    pass


def _n(tok):
    return 0 if tok == "-" else int(tok.replace(",", ""))


def _code(label):
    lab = re.sub(r"\s+", "", label).upper()
    if lab in ("TOTAL",) or CIRCUIT.match(lab):
        return lab
    if re.match(r"^[A-Z]{2}(,[A-Z])?$", lab) or lab in TERRITORIES:
        return lab
    return None


def state_of(code):
    """District code -> two-letter state, or None for a territory."""
    if code in TERRITORIES:
        return None
    st = code.split(",")[0]
    return st if st in STATES else None


def parse_f2(text, min_districts=85):
    """-> {"layout": "old"|"new", "total": n, "districts": {code: n}, "note": the table's own words}.
    Raises TableError when the table does not add up."""
    lines = text.splitlines()
    b_at = next((i for i, l in enumerate(lines) if SECTION_B.search(l)), None)
    layout = "new" if b_at is not None else "old"
    if layout == "old" and not OLD_HEAD.search(text):
        raise TableError("old layout but no header reading chapters 7, 11, 12, 13 in that order")
    body = lines[b_at:] if b_at is not None else lines
    total, districts, bad = None, {}, []
    for l in body:
        m = ROW.match(l)
        if not m:
            continue
        code = _code(m.group(1))
        if not code:
            continue
        toks = m.group(2).split()
        if layout == "new":
            if len(toks) < 5:
                continue
            t, c9, c12, c15, oth = (_n(x) for x in toks[:5])
            if t != c9 + c12 + c15 + oth:
                bad.append("%s: %d != %d+%d+%d+%d" % (code, t, c9, c12, c15, oth))
            v = c12
        else:
            if len(toks) < 14:
                continue
            v = _n(toks[3])
        if code == "TOTAL":
            if total is None:
                total = v
            continue
        if CIRCUIT.match(code):
            continue
        if code in districts:
            continue          # a repeated header page; first read wins, and it must agree
        districts[code] = v
    if bad:
        raise TableError("rows that do not add up: " + "; ".join(bad[:5]))
    if total is None:
        raise TableError("no Total row")
    s = sum(districts.values())
    if s != total:
        raise TableError("districts add to %d, the table's Total row says %d" % (s, total))
    if len(districts) < min_districts:
        raise TableError("only %d districts read" % len(districts))
    # the table's own words for the total: the newer tables' footnote names it
    note = next((re.sub(r"\s+", " ", l).strip(" \u00b9") for l in lines if re.search(r"Other Chapters includes cases filed under chapters", l)), None)
    if note and ("12 (%s)" % format(total, ",")) not in note and ("12 (%d)" % total) not in note:
        raise TableError("footnote does not give %d for chapter 12: %s" % (total, note))
    return {"layout": layout, "total": total, "districts": districts, "note": note}


def read_ref(path):
    """A references-branch text file: '# title' / '# url' / '# fetched ..., sha256 ...' then the text."""
    text = open(path, encoding="utf-8").read()
    head = text.splitlines()[:3]
    url = head[1][2:].strip() if len(head) > 1 and head[1].startswith("# http") else None
    fetched = None
    if len(head) > 2:
        m = re.search(r"fetched (\S+)", head[2])
        fetched = m.group(1)[:10] if m else None
    base = os.path.basename(path)
    m = re.match(r"uscourts-f2-(\d{4})-(mar|jun|sep|dec)\.txt$", base)
    if not m:
        raise TableError("%s: not a uscourts-f2-<year>-<mon>.txt file" % base)
    mm, dd = MONTHS[m.group(2)]
    end = "%s-%s-%s" % (m.group(1), mm, dd)
    # the table states its own period; it must match the file name
    body = "\n".join(text.splitlines()[3:])
    pm = PERIOD.search(body[:3000])
    said = (pm.group(1).lower(), pm.group(2), pm.group(3)) if pm else None
    if said != (m.group(2), dd, m.group(1)):
        raise TableError("%s: the table's own period line says %s, not %s" % (base, said, end))
    return end, url, fetched, base[:-4], text


def label(end):
    y, mm, _ = end.split("-")
    return "12 months to %s, %s" % (MON_NAME[mm], y) if mm != "12" else "calendar %s" % y


def period_row(end, url, fetched, ref_id, parsed):
    return {"end": end, "label": label(end), "national": parsed["total"], "layout": parsed["layout"],
            "url": url, "ref": ref_id, "read": fetched, "note": parsed.get("note")}


def assemble(periods, by_district, built=None):
    """periods: [row]; by_district: {end: {code: n}} -> the document."""
    periods = sorted(periods, key=lambda p: p["end"])
    ends = [p["end"] for p in periods]
    districts = {}
    for end in ends:
        for code, v in by_district[end].items():
            districts.setdefault(code, {})[end] = v
    states = {}
    for st, name in STATES.items():
        codes = sorted(c for c in districts if state_of(c) == st)
        n = {}
        for end in ends:
            here = [by_district[end][c] for c in codes if c in by_district[end]]
            if here:
                n[end] = sum(here)
        # districts in the newest period (Arkansas is one court from 2018 on)
        latest = sorted(c for c in by_district[ends[-1]] if state_of(c) == st)
        if not codes:
            continue
        states[st] = {"name": name, "districts": latest, "n": n}
    return {
        "schema": "agsist-chapter12/1",
        "about": ("Chapter 12 (family farmer and fisherman) bankruptcy cases commenced in each 12-month period, "
                  "by federal court district, from U.S. Courts Table F-2. A state with more than one district is "
                  "the sum of its districts. Filings, not farms. 12-month totals only. Built by scripts/build_chapter12.py; "
                  "every period's districts add up to the table's own Total row."),
        "source": SOURCE_NAME,
        "built": built or dt.date.today().isoformat(),
        "periods": periods,
        "states": states,
        "districts": {c: districts[c] for c in sorted(districts)},
    }


def daily_line(doc):
    """One dated, sourced sentence for the Daily's fact pool, from the newest period."""
    p = doc["periods"][-1]
    fact = "Family farmers and fishermen filed %d Chapter 12 bankruptcy cases in %s" % (
        p["national"], ("the " + p["label"]) if p["label"].startswith("12 months") else p["label"][len("calendar "):])
    # one period, one table: the quote below backs every number in the sentence
    fact += ". Chapter 12 is the bankruptcy chapter written for them. A filing is a case opened, not a farm sold or closed."
    return {"id": "ch12-latest", "fact": fact, "source": "U.S. Courts, Table F-2, %s" % p["label"],
            "url": p["url"], "checked": p["read"],
            "quote": p.get("note") or ("Total Chapter 12 cases commenced: %d" % p["national"])}


def write_fact(doc, path=FACTS):
    d = json.load(open(path, encoding="utf-8"))
    row = daily_line(doc)
    d["facts"] = [f for f in d["facts"] if f.get("id") != row["id"]] + [row]
    with open(path, "w", encoding="utf-8") as f:
        json.dump(d, f, indent=2, ensure_ascii=False)
        f.write("\n")
    return row


def check(doc, full=True):
    """Every rule the page relies on. -> list of problems. full: every state and DC present."""
    out = []
    if full:
        miss = sorted(set(STATES) - set(doc.get("states") or {}))
        if miss:
            out.append("states missing: " + ",".join(miss))
    ps = doc.get("periods") or []
    if not ps:
        return ["no periods"]
    ends = [p["end"] for p in ps]
    if ends != sorted(set(ends)):
        out.append("periods out of order or repeated")
    for p in ps:
        if not (p.get("url") or "").startswith("https://www.uscourts.gov/"):
            out.append("%s: no U.S. Courts link" % p["end"])
        s = sum(v.get(p["end"], 0) for v in doc["districts"].values())
        if s != p["national"]:
            out.append("%s: districts add to %d, national %d" % (p["end"], s, p["national"]))
        st_sum = sum(v["n"].get(p["end"], 0) for v in doc["states"].values())
        terr = sum(v.get(p["end"], 0) for c, v in doc["districts"].items() if state_of(c) is None)
        if st_sum + terr != p["national"]:
            out.append("%s: states %d + territories %d != national %d" % (p["end"], st_sum, terr, p["national"]))
    for st, v in doc["states"].items():
        if st not in STATES or not v.get("districts"):
            out.append("%s: no district" % st)
    return out


def build_from_refs(refs_dir):
    periods, byd = [], {}
    files = sorted(glob.glob(os.path.join(refs_dir, "uscourts-f2-*.txt")))
    if not files:
        raise TableError("no uscourts-f2-*.txt in " + refs_dir)
    for f in files:
        end, url, fetched, ref_id, text = read_ref(f)
        try:
            parsed = parse_f2(text)
        except TableError as e:
            raise TableError("%s: %s" % (os.path.basename(f), e))
        periods.append(period_row(end, url, fetched, ref_id, parsed))
        byd[end] = parsed["districts"]
    return assemble(periods, byd)


def add_one(doc, path):
    end, url, fetched, ref_id, text = read_ref(path)
    parsed = parse_f2(text)
    periods = [p for p in doc["periods"] if p["end"] != end] + [period_row(end, url, fetched, ref_id, parsed)]
    byd = {p["end"]: {c: v[p["end"]] for c, v in doc["districts"].items() if p["end"] in v} for p in doc["periods"] if p["end"] != end}
    byd[end] = parsed["districts"]
    return assemble(periods, byd)


def save(doc, path=OUT):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=1, sort_keys=False)
        f.write("\n")


# ── selftest: real district rows copied from the tables (Maine 2015, Maine and
# Arkansas Sep 2026); the Total rows are cut down so the few rows add up ───────

OLD_FIX = """Table F-2.
During the 12-Month Period Ending December 31, 2015
 District   Filings      7        11      12         13   Total       7         11        12       13       Total      7         11     13   Sort Orde
  TOTAL     %s   535,047   7,241      %s    301,705   24,735    15,917     6,130    407     2,190    819,760   519,130   1,111   299,515 0.0
   1ST       26,400    16,440    339        37      9,583    1,122       660      281      37       143     25,278    15,780     58      9,440 01
ME            1,867     1,553     12         7        294      128        90       11       7        19      1,739     1,463      1        275 010
IA, N         2,000     1,500      -        30        470      100        90       10       30        19      1,739     1,463      1        275 010
IA, S         2,000     1,500      -         5        495      100        90       10       5        19      1,739     1,463      1        275 010
"""

NEW_FIX = """Table F-2.
During the 12-Month Period Ending September 30, 2026
           District           Chapters                  9                      12               15 ¹          Chapters
            Total                        621,111                   3                    %s             259              620,811
     1st                                  14,792                   0                     12               1               14,779
ME                                          710                    0                      4               0                 706
AR ²                                         7,771             0             34              0                7,737
NMI                                             2              0              0              0                    2
¹ Other Chapters includes cases filed under chapters 9 (3), 12 (%s) and 15 (259) as well as Section 304 (0).
"""


def _selftest():
    fails = []

    def ok(c, m):
        print(("ok   " if c else "FAIL ") + m)
        if not c:
            fails.append(m)

    p = parse_f2(OLD_FIX % ("844,495", "42"), min_districts=1)
    ok(p["layout"] == "old" and p["districts"]["ME"] == 7, "old layout: Maine 2015 reads 7 (4th number)")
    ok(p["districts"]["IA,N"] == 30 and p["districts"]["IA,S"] == 5, "old layout: 'IA, N' read as IA,N; a dash elsewhere is none")
    ok("1ST" not in p["districts"], "circuit rows are not districts")
    try:
        parse_f2(OLD_FIX % ("844,495", "407"), min_districts=1)
        ok(False, "a Total that the districts do not add to is refused")
    except TableError:
        ok(True, "a Total that the districts do not add to is refused")
    q = parse_f2(NEW_FIX % ("38", "38"), min_districts=1)
    ok(q["layout"] == "new" and q["districts"]["AR"] == 34 and q["districts"]["ME"] == 4, "new layout: Arkansas 34 and Maine 4, Sep 2026 (3rd number)")
    try:
        parse_f2((NEW_FIX % ("38", "38")).replace("7,737", "7,738"), min_districts=1)
        ok(False, "a row whose Total is not 9+12+15+Other is refused")
    except TableError:
        ok(True, "a row whose Total is not 9+12+15+Other is refused")
    ok(state_of("IA,N") == "IA" and state_of("NMI") is None and state_of("GUAM") is None and state_of("PR") is None, "districts map to states; territories to none")
    doc = assemble([{"end": "2025-12-31", "label": label("2025-12-31"), "national": 10, "layout": "new", "url": "https://www.uscourts.gov/x.pdf", "ref": "a", "read": "2026-10-28"},
                    {"end": "2026-09-30", "label": label("2026-09-30"), "national": 12, "layout": "new", "url": "https://www.uscourts.gov/y.pdf", "ref": "b", "read": "2026-10-28"}],
                   {"2025-12-31": {"IA,N": 4, "IA,S": 3, "PR": 3}, "2026-09-30": {"IA,N": 5, "IA,S": 6, "PR": 1}}, built="2026-10-28")
    ok(doc["states"]["IA"]["n"] == {"2025-12-31": 7, "2026-09-30": 11} and doc["states"]["IA"]["districts"] == ["IA,N", "IA,S"], "a two-district state is the sum of its districts")
    ok(check(doc, full=False) == [], "assembled fixture passes --check: %s" % check(doc, full=False))
    ok(label("2026-09-30") == "12 months to Sep 30, 2026" and label("2025-12-31") == "calendar 2025", "period labels")
    line = daily_line(doc)
    ok("filed 12 Chapter 12 bankruptcy cases in the 12 months to Sep 30, 2026." in line["fact"] and "2025" not in line["fact"], "Daily line: one period, from the newest table: " + line["fact"])
    ok("—" not in line["fact"] and "farms filed" not in line["fact"], "Daily line: no em dash, says filings not farms")
    if os.path.exists(OUT):
        real = json.load(open(OUT, encoding="utf-8"))
        ok(check(real) == [], "committed chapter12.json passes --check")
    print("selftest: %s" % ("PASS" if not fails else "FAIL (%d)" % len(fails)))
    return 0 if not fails else 1


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--refs")
    ap.add_argument("--add")
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--facts", default=FACTS)
    ap.add_argument("--no-fact", action="store_true")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args(argv)
    if a.selftest:
        return _selftest()
    if a.check:
        probs = check(json.load(open(a.out, encoding="utf-8")))
        for p in probs:
            print("FAIL " + p)
        print("chapter12.json: %s" % ("ok" if not probs else "%d problems" % len(probs)))
        return 1 if probs else 0
    try:
        if a.refs:
            doc = build_from_refs(a.refs)
        elif a.add:
            doc = add_one(json.load(open(a.out, encoding="utf-8")), a.add)
        else:
            ap.error("one of --refs, --add, --check, --selftest")
    except TableError as e:
        print("::error::Chapter 12 table not written: %s" % e)
        return 1
    probs = check(doc)
    if probs:
        print("::error::Chapter 12 table not written: " + "; ".join(probs))
        return 1
    save(doc, a.out)
    p = doc["periods"][-1]
    print("chapter12.json: %d periods, newest %s, national %d" % (len(doc["periods"]), p["end"], p["national"]))
    if not a.no_fact:
        print("daily fact: " + write_fact(doc, a.facts)["fact"])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
