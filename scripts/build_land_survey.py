#!/usr/bin/env python3
"""build_land_survey.py: county land values in two states where sale prices are not public record
(Sig, Oct 29, 2026 priority queue: "ND Trust Lands; K-State KS book").

Neither source is a recorded sale, and the files and pages say so every time:

  data/land/nd/survey.json   North Dakota Department of Trust Lands, 2026 County Rents and Prices.
                             EVIDENCE: "state survey of farmers". Each county's average price of
                             rented land and average cash rent, as farmers and ranchers reported
                             them for their locality (cropland, pasture, tame hay), with the number
                             of reports. (D) cells are withheld by the survey and stay withheld here.
  data/land/ks/survey.json   K-State Agricultural Economics and KSFMRA, Kansas Agricultural Land
                             Values and Trends 2025 (the 2025 Kansas Land Values Book).
                             EVIDENCE: "average of reported sales, K-State". County averages of
                             open-market sales reported to the Kansas Property Valuation Department,
                             Oct 2024 to Sep 2025, for parcels at least 75% one land type; a county
                             shows a type only with more than three such parcels. The sales count is
                             all land types together (the book gives no count per type).

Both are read from the pdftotext -layout copy the refs workflow keeps on the references branch
(ids bench-cash-rent-5 and ksu-land-values-book-2025-pdf); the PDF's sha256 goes in the file.
Every county value keeps where it came from: North Dakota keeps the PDF row text itself (a state
agency report), Kansas keeps the PDF page and the table (the book carries no reuse terms, so the
page shows the averages with a link and no part of the book is copied).

Withheld, with the reason in the file (honest numbers: a missing number stays missing):
  - a (D) cell in North Dakota;
  - a Kansas average that falls outside the book's own minimum and maximum for that row;
  - a Kansas sales count that the book prints identical, row for row, for two counties.

  python3 scripts/build_land_survey.py --nd ND.txt --ks KS.txt   write both files
  python3 scripts/build_land_survey.py --check --nd ND.txt --ks KS.txt   compare with the committed files
  python3 scripts/build_land_survey.py --selftest
"""
import argparse
import hashlib
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

ND_SOURCE = {
    "org": "North Dakota Department of Trust Lands",
    "title": "2026 County Rents and Prices, North Dakota",
    "released": "April 2026",
    "url": "https://www.land.nd.gov/sites/www/files/documents/Surface/Rent%20Survey/2026%20County%20Rents%20and%20Prices%20North%20Dakota.pdf",
    "page": "https://www.land.nd.gov/resources/north-dakota-county-rents-prices-annual-survey",
    "ref": "bench-cash-rent-5",
    "terms": "State agency report; cited and linked.",
}
KS_SOURCE = {
    "org": "Kansas State University Agricultural Economics and KSFMRA",
    "title": "Kansas Agricultural Land Values and Trends 2025 (2025 Kansas Land Values Book)",
    "authors": "Robin Reid and Megan Hughes",
    "released": "January 12, 2026",
    "url": "https://www.agmanager.info/sites/default/files/pdf/2025%20KS%20Ag%20Land%20Values%20011226%20web.pdf",
    "page": "https://www.agmanager.info/land-leasing/land-buying-valuing/2025-kansas-land-values-book",
    "ref": "ksu-land-values-book-2025-pdf",
    "terms": "No reuse terms in the book or on its page: county averages are cited with a link; the book itself is not copied.",
}
ND_KINDS = [("cropland", "NON-IRRIGATED CROPLAND"), ("pasture", "NON-IRRIGATED PASTURELAND"), ("hay", "NON-IRRIGATED TAME HAYLAND")]
ND_COLS = ["rent_5y", "value_5y", "n", "rent_min", "rent_max", "rent_mode", "rent", "value"]
NUM = r"(\(D\)|\d[\d,]*(?:\.\d+)?)"
ND_ROW = re.compile(r"^([A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)?)[ .]*?\s+" + r"\s+".join([NUM] * 8) + r"\s*$")
ND_MIN_REPORTS = 15     # the survey: "exercise discretion when using data from counties with less than fifteen reports"


def key(name):
    return re.sub(r"[^a-z]", "", name.lower())


def num(t):
    if t is None or t == "(D)":
        return None
    v = float(t.replace(",", ""))
    return int(v) if v == int(v) and "." not in t else v


def strip_header(text):
    """(url line, sha256, text without the refs header). The refs copy starts with '# title',
    '# url', '# fetched <utc>, sha256 <hex>'."""
    sha = None
    m = re.search(r"sha256 ([0-9a-f]{64})", text[:2000])
    if m:
        sha = m.group(1)
    lines = text.split("\n")
    while lines and lines[0].startswith("# "):
        lines.pop(0)
    return sha, "\n".join(lines)


def county_fips(st_fips):
    """{name key: fips} for one state from the Atlas county list."""
    C = json.load(open(os.path.join(REPO, "data", "atlas", "atlas.json"), encoding="utf-8"))["counties"]
    return {key(c["name"]): f for f, c in C.items() if f.startswith(st_fips)}


# ---------------------------------------------------------------- North Dakota
def parse_nd(text):
    """{county name: {kind: {col: value, "row": raw line}}} from the three county tables."""
    out = {}
    kind = None
    for line in text.split("\n"):
        s = line.strip()
        for k, head in ND_KINDS:
            if s.startswith(head):
                kind = k
        if kind is None:
            continue
        m = ND_ROW.match(s)
        if not m:
            continue
        name = m.group(1)
        vals = [num(t) for t in m.groups()[1:]]
        rec = dict(zip(ND_COLS, vals))
        rec["row"] = re.sub(r"\s+", " ", re.sub(r"\.{2,}", " ", s)).strip()
        if rec["value"] is None or rec["rent"] is None:
            rec["withheld"] = "(D): withheld by the survey to avoid disclosing data for individual operations"
        if name in out and kind in out[name]:
            raise ValueError("North Dakota: %s %s twice" % (name, kind))
        out.setdefault(name, {})[kind] = rec
    return out


def nd_file(text):
    sha, body = strip_header(text)
    rows = parse_nd(body)
    F = county_fips("38")
    counties = {}
    for name, kinds in sorted(rows.items()):
        f = F.get(key(name))
        if not f:
            raise ValueError("North Dakota county not in the Atlas: %s" % name)
        counties[f] = {"name": name, **{k: kinds[k] for k, _ in ND_KINDS if k in kinds}}
    return {
        "about": ("County land values from a state survey of farmers. Not recorded sales: the price of rented land is "
                  "what farmers and ranchers reported as the average for their locality. Read from the PDF by "
                  "scripts/build_land_survey.py; each value keeps its PDF row. A value is null where the survey "
                  "withheld it (D)."),
        "state": "ND",
        "evidence": "state survey of farmers",
        "year": 2026,
        "what": {"value": "average price of rented land, dollars an acre", "rent": "average cash rent, dollars an acre",
                 "n": "reports in the 2026 survey", "value_5y": "2021-2025 average price of rented land",
                 "rent_5y": "2021-2025 average cash rent", "rent_min": "lowest reported local average rent",
                 "rent_max": "highest reported local average rent", "rent_mode": "most frequent reported rent"},
        "kinds": {"cropland": "non-irrigated cropland", "pasture": "non-irrigated pasture", "hay": "non-irrigated tame hay"},
        "few_reports": ND_MIN_REPORTS,
        "survey": "Mailed late December 2025 to about 14,000 of 34,000 sampled producers; replies through March 12, 2026; over 1,600 reports with data. Cash rent arrangements only.",
        "source": dict(ND_SOURCE, sha256=sha),
        "counties": counties,
    }


# ---------------------------------------------------------------- Kansas
KS_NAME = r"([A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)?)"
KS_PRICE = re.compile(KS_NAME + r"\s+(\d[\d,]*)\s+(\d[\d,]*)\s+(\d[\d,]*)(?=\s|$)")
KS_COUNT = re.compile(r"^\s*" + KS_NAME + r"\s+(\d+)\s+(\d[\d,]*)\s+(\d[\d,]*)\s+(\d+(?:\.\d+)?)%\s*$")
KS_FOOT = "Kansas Agricultural Land Values and Trends 2025"


def ks_pages(text):
    """[(page number, text)] by form feed (pdftotext puts one between pages)."""
    return [(i + 1, p) for i, p in enumerate(text.split("\f"))]


def parse_ks(text):
    """{"counts": {name: {...}}, "prices": {name: {kind: {...}}}} from the county pages."""
    counts, prices = {}, {}
    for pno, page in ks_pages(text):
        lines = page.split("\n")
        # sales counts: the '# of Sales Analyzed' table
        for i, line in enumerate(lines):
            if "# of Sales Analyzed" in line:
                for l2 in lines[i + 1:]:
                    m = KS_COUNT.match(l2)
                    if m and m.group(1) != "Total":
                        if m.group(1) in counts:
                            raise ValueError("Kansas: %s counted twice" % m.group(1))
                        counts[m.group(1)] = {"sales_n": int(m.group(2)), "acres_analyzed": num(m.group(3)),
                                              "acres_sold": num(m.group(4)), "pct_sold": float(m.group(5)), "page": pno}
                    elif m and m.group(1) == "Total":
                        break
        # prices: two side-by-side tables, non-irrigated on the left; pasture/hay then irrigated on the right
        split = None
        right = "pasture"
        for line in lines:
            if split is None:
                if re.search(r"Non-irrigated Cropland", line, re.I) and "Pasture/Hay Ground" in line:
                    split = -1     # set by the next header line
                continue
            if split == -1:
                pos = [m.start() for m in re.finditer(r"County", line)]
                if len(pos) >= 2 and "Minimum" in line:
                    split = pos[1] - 2
                continue
            if KS_FOOT in line:
                break
            ir = line.find("Irrigated Cropland")
            if ir >= 0 and ir >= split - 25 and "Non" not in line[max(0, ir - 4):ir]:
                right = "irrigated"
            for m in KS_PRICE.finditer(line):
                name = m.group(1)
                if name in ("Total", "County"):
                    continue
                kind = "nonirr" if m.start() < split else right
                lo, hi, avg = num(m.group(2)), num(m.group(3)), num(m.group(4))
                rec = {"avg": avg, "min": lo, "max": hi, "page": pno}
                if not (lo <= avg <= hi):
                    rec = {"avg": None, "min": lo, "max": hi, "page": pno, "book_avg": avg,
                           "withheld": "the book's average is outside its own minimum and maximum for this row"}
                if kind in prices.get(name, {}):
                    raise ValueError("Kansas: %s %s twice" % (name, kind))
                prices.setdefault(name, {})[kind] = rec
    return {"counts": counts, "prices": prices}


def ks_file(text):
    sha, body = strip_header(text)
    P = parse_ks(body)
    F = county_fips("20")
    # a count row printed identical for two counties: one of them is a copy, and the book does not say which
    sig = {}
    for name, c in P["counts"].items():
        sig.setdefault((c["sales_n"], c["acres_analyzed"]), []).append(name)
    dup = {n for v in sig.values() if len(v) > 1 for n in v}
    counties = {}
    for name in sorted(set(P["counts"]) | set(P["prices"])):
        f = F.get(key(name))
        if not f:
            raise ValueError("Kansas county not in the Atlas: %s" % name)
        rec = {"name": name}
        c = P["counts"].get(name)
        if c:
            rec.update(c)
            if name in dup:
                rec["sales_n"] = None
                rec["withheld_n"] = "the book prints the same sales count and acres for %s" % " and ".join(sorted(sig[(c["sales_n"], c["acres_analyzed"])]))
                rec["book_sales_n"] = c["sales_n"]
        rec.update(P["prices"].get(name) or {})
        counties[f] = rec
    return {
        "about": ("County land values from an average of reported sales. Not our recorded-sale middle: K-State averages "
                  "open-market sales reported to the Kansas Property Valuation Department, Oct 2024 to Sep 2025, by land "
                  "type (a parcel at least 75% one type), and shows a county only with more than three such parcels. "
                  "Read from the PDF by scripts/build_land_survey.py; each value keeps its PDF page."),
        "state": "KS",
        "evidence": "average of reported sales, K-State",
        "year": 2025,
        "period": "Oct 2024 to Sep 2025",
        "what": {"avg": "average dollars per parcel acre", "min": "lowest, not verified by the authors",
                 "max": "highest, not verified by the authors", "sales_n": "sales analyzed in the county, all land types",
                 "page": "page of the PDF"},
        "kinds": {"nonirr": "non-irrigated cropland", "pasture": "pasture and hay", "irrigated": "irrigated cropland"},
        "source": dict(KS_SOURCE, sha256=sha),
        "counties": counties,
    }


def dump(o):
    return json.dumps(o, ensure_ascii=False, indent=1, sort_keys=True) + "\n"


# ---------------------------------------------------------------- selftest
ND_FIX = """# t
# u
# fetched 2026-10-16T16:10:41Z, sha256 """ + "a" * 64 + """
NON-IRRIGATED CROPLAND CASH RENTS AND PRICES
Adams..........................            39.20         1380.00               22         34.00            70.00                  40.00      44.10           1879.00
Golden Valley...............               32.70         1437.00               24         15.00            46.00                  40.00      34.60           1566.00
NON-IRRIGATED PASTURELAND CASH RENTS AND PRICES
Adams..........................             19.80         903.00               20         13.00            40.00               20.00            20.70         1004.00
Cavalier                                    21.20        1318.00                4         10.00            30.00               10.00            19.40         1200.00
Pembina.......................              23.50        1156.00                3           (D)              (D)                 (D)              (D)             (D)
NON-IRRIGATED TAME HAYLAND CASH RENTS AND PRICES
Cavalier                                    37.80        2147.00              (D)          (D)              (D)                 (D)             (D)              (D)
"""
KS_FIX = ("# t\n# u\n# fetched x, sha256 " + "b" * 64 + "\n"
          "               # of Sales Analyzed      Total Acres           Total Acres Sold   % of Total County\n"
          "County                (2025)          Analyzed (2025)              (2025)        Acres Sold (2025)\n"
          "Cheyenne              34                   14,845                 17,938               2.8%\n"
          "McPherson                     65                        6,943               9,690              1.8%\n"
          "Rice                          65                        6,943              13,464              3.0%\n"
          "Total                 270                  73,402                 110,016              2.3%\n\f"
          "                                  Non-Irrigated Cropland                                                Pasture/Hay Ground\n"
          "                    County             Minimum          Maximum             Average          County      Minimum   Maximum   Average\n"
          "                    Cheyenne              1,227            3,059             2,348           Cheyenne     1,017     1,458     1,227\n"
          "                    Riley                 3,117            9,067             5,900           Riley        2,396     3,087     3,327\n"
          "                                                                                                        Irrigated Cropland\n"
          "                    Total                 1,227            4,963             2,603\n"
          "                                                                                             County      Minimum   Maximum   Average\n"
          "                   hay ground if 75% or greater of the parcel acres are of that category.    Cheyenne     6,486      7,598    7,095\n"
          "     18                                                            Kansas Agricultural Land Values and Trends 2025\n")


def selftest():
    bad = []

    def check(name, ok):
        print(("ok   " if ok else "FAIL ") + name)
        if not ok:
            bad.append(name)

    nd = nd_file(ND_FIX)
    C = nd["counties"]
    adams = C.get("38001") or {}
    check("nd: Adams cropland value and rent and n", adams.get("cropland", {}).get("value") == 1879 and adams["cropland"]["rent"] == 44.1 and adams["cropland"]["n"] == 22)
    check("nd: row kept", adams.get("cropland", {}).get("row", "").startswith("Adams 39.20 1380.00 22"))
    check("nd: Adams pasture", adams.get("pasture", {}).get("value") == 1004)
    check("nd: two-word county", any(c["name"] == "Golden Valley" for c in C.values()))
    check("nd: row without dots", any(c["name"] == "Cavalier" and c["pasture"]["value"] == 1200 for c in C.values()))
    pem = next(c for c in C.values() if c["name"] == "Pembina")
    check("nd: (D) is null and withheld, n kept", pem["pasture"]["value"] is None and pem["pasture"]["rent"] is None and pem["pasture"]["withheld"] and pem["pasture"]["n"] == 3)
    cav = next(c for c in C.values() if c["name"] == "Cavalier")
    check("nd: (D) count too", cav["hay"]["n"] is None and cav["hay"]["value"] is None)
    check("nd: sha kept", nd["source"]["sha256"] == "a" * 64)
    ks = ks_file(KS_FIX)
    K = ks["counties"]
    ch = K.get("20023") or {}
    check("ks: Cheyenne count and acres", ch.get("sales_n") == 34 and ch.get("acres_analyzed") == 14845 and ch.get("page") == 1)
    check("ks: Cheyenne non-irrigated", ch.get("nonirr") == {"avg": 2348, "min": 1227, "max": 3059, "page": 2})
    check("ks: Cheyenne pasture", (ch.get("pasture") or {}).get("avg") == 1227)
    check("ks: Cheyenne irrigated after the header", (ch.get("irrigated") or {}).get("avg") == 7095)
    ri = K.get("20161") or {}
    check("ks: average above its own maximum is withheld", ri.get("pasture", {}).get("avg") is None and ri["pasture"]["book_avg"] == 3327 and ri["pasture"]["withheld"])
    check("ks: Riley non-irrigated stays", ri.get("nonirr", {}).get("avg") == 5900)
    mc, rc = K.get("20113") or {}, K.get("20159") or {}
    check("ks: a count printed twice is withheld for both", mc.get("sales_n") is None and rc.get("sales_n") is None and mc.get("book_sales_n") == 65 and "Rice" in mc.get("withheld_n", ""))
    check("ks: Total never a county", not any(c["name"] == "Total" for c in K.values()))
    print("selftest: %d failed" % len(bad))
    return 1 if bad else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--nd")
    ap.add_argument("--ks")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    rc = 0
    for st, path, fn in (("nd", a.nd, nd_file), ("ks", a.ks, ks_file)):
        if not path:
            continue
        txt = dump(fn(open(path, encoding="utf-8").read()))
        out = os.path.join(REPO, "data", "land", st, "survey.json")
        if a.check:
            same = os.path.exists(out) and open(out, encoding="utf-8").read() == txt
            print("%s %s" % ("same" if same else "DIFFERS", out))
            rc |= 0 if same else 1
        else:
            os.makedirs(os.path.dirname(out), exist_ok=True)
            open(out, "w", encoding="utf-8").write(txt)
            print("wrote %s (%d counties)" % (out, len(json.loads(txt)["counties"])))
    return rc


if __name__ == "__main__":
    sys.exit(main())
