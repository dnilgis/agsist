#!/usr/bin/env python3
"""
land_alert.py: the numbers for the monthly land sale email (scripts/send_land_alert.py).

A reader gives a ZIP and a radius (10, 25 or 50 miles). Once a month this module answers:
which farm sales were recorded last month within that radius of the ZIP, and what the
middle price per acre within the radius was over the last 12 months against the 12 before.

THE DATA is the same county transfer files Field Scout, the comp report and the Atlas read
(data/land/<st>/<fips>.json, scripts/fetch_land_sales.py, refreshed by land-data.yml on the
3rd of each month). What counts as a sale is the one shared market-sale rule
(build_land_summary.row_objs, sale_rows, market_sale, stat_ok: the port of field-scout-land.js
that test/land-rule.test.mjs holds to the page row for row). Nothing here re-decides it.

STATES: Illinois and Wisconsin only (STATES). Indiana is held: its sales are live in Field
Scout and the comp report, but Sig's Oct 18 call keeps them off any page beyond those two, and
the Atlas waits on a check of Indiana's deed types and acres against the market-sale rule. The
email reuses that rule and prints a derived median, so Indiana stays out until Sig says it may
go in. Minnesota (eCRV) is not in the data at all.

WHERE A SALE IS. A transfer file places each sale at its township, town, village or city (the
"muni" code), whose point is the Census county subdivision gazetteer's internal point
(Illinois townships; Wisconsin towns, villages and cities). No parcel point is kept, so the
distance is from the ZIP's centroid (the bids repo's ZIP table, the one the cash bid ZIP search
uses) to that point, great-circle miles. A township is about 6 miles on a side, so a sale near
the edge of the radius can be a few miles inside or out; the email says the distances are to
the middle of the township or town. A sale whose place has no point is not placed and not listed
(counted in the log).

WHICH MONTH. A sale belongs to the month it was recorded (filed): Wisconsin rows carry the
filed date (rec); Illinois rows carry it from the land-data run after Oct 23, 2026. A county file
without a rec column is listed by its sale (deed) date instead, and the email says "sale date"
for those rows. A state's sales are read for month M only when its files were fetched after M
ended (fresh); otherwise the reader waits for the next catch-up run.

WHAT IS LISTED: market sales recorded in the month, 10 acres or more with the acres known,
nearest first, at most MAX_ROWS. Market sales with the acres not stated and those under 10
acres are counted in one line, never listed. No buyer or seller name, legal description, parcel
number or document number ever leaves this module (row() is the only shape that does).

THE MIDDLE PRICE (honest-numbers rules): market sales of 20 acres or more with known acres and
a $/acre of $500 or more (stat_ok), within the radius, dated in the 12 months ending with the
month (by sale date, as the Atlas county pages count them) against the 12 months before.
Printed only with 10 or more such sales in EACH window, middle halves that overlap, acres known
on 3 in 4 market sales in both windows, and county records that reach back over both windows.
Otherwise the reason is printed in place of the number. Each median prints its count.

    python3 scripts/land_alert.py --selftest
"""
import datetime
import glob
import json
import math
import os
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(HERE))
import build_land_summary as BLS   # noqa: E402  the shared market-sale rule

STATES = ("IL", "WI")               # Indiana held (see above); MN not in the data
STATE_NAMES = {"IL": "Illinois", "WI": "Wisconsin"}
STATE_SLUGS = {"IL": "illinois", "WI": "wisconsin"}
MILES = (10, 25, 50)
DEFAULT_MILES = 25
EARTH_MI = 3958.8
LIST_MIN_ACRES = 10                 # listed sales: this many acres or more, acres known
MAX_ROWS = 20                       # rows in one email; the rest are counted
MED_MIN_ACRES = BLS.MIN_ACRES       # 20, as the Atlas
MED_MIN_N = BLS.MIN_N_CHG           # 10 in each window, as the Atlas change
MAX_UNSURE = BLS.MAX_UNSURE         # acres known on 3 in 4 market sales in both windows
COUNTY_REACH = 45                   # a county whose center is this far past the radius has no township inside it
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
          "October", "November", "December"]
SOURCES = {
    "IL": "Illinois Department of Revenue, MyDec transfer declarations (PTAX-203), farm parcels",
    "WI": "Wisconsin Department of Revenue, electronic real estate transfer returns, farm and forest classes",
}


def miles(a, b):
    """Great-circle miles between (lat, lon) pairs."""
    rad = math.pi / 180
    dlat, dlon = (b[0] - a[0]) * rad, (b[1] - a[1]) * rad
    s = math.sin(dlat / 2) ** 2 + math.cos(a[0] * rad) * math.cos(b[0] * rad) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_MI * math.asin(min(1.0, math.sqrt(s)))


def month_bounds(year, m0):
    """(first day, last day) ISO of month m0 (0-based)."""
    first = datetime.date(year, m0 + 1, 1)
    nxt = datetime.date(year + (m0 == 11), 1 if m0 == 11 else m0 + 2, 1)
    return first.isoformat(), (nxt - datetime.timedelta(days=1)).isoformat()


def short_day(iso):
    return "%s %d" % (MON[int(iso[5:7]) - 1], int(iso[8:10]))


def long_day(iso):
    return "%s %d, %s" % (MON[int(iso[5:7]) - 1], int(iso[8:10]), iso[:4])


def money(x):
    return "$" + format(int(BLS.js_round(x)), ",")


def acres_text(a):
    r = round(a, 1)
    return ("%d" % r) if r == int(r) else ("%.1f" % r)


class Land:
    """The committed county files, read once a run."""

    def __init__(self, repo=REPO, states=STATES):
        self.repo, self.states = str(repo), tuple(states)
        self._ix, self._f, self._rows = {}, {}, {}

    def index(self, st):
        if st not in self._ix:
            try:
                self._ix[st] = json.load(open(os.path.join(self.repo, "data", "land", st.lower(), "index.json"), encoding="utf-8"))
            except (OSError, ValueError):
                self._ix[st] = None
        return self._ix[st]

    def file(self, st, fips):
        k = (st, fips)
        if k not in self._f:
            try:
                self._f[k] = json.load(open(os.path.join(self.repo, "data", "land", st.lower(), fips + ".json"), encoding="utf-8"))
            except (OSError, ValueError):
                self._f[k] = None
        return self._f[k]

    def counties_near(self, ll, radius):
        """[(st, county index row)] whose center is within radius + COUNTY_REACH miles."""
        out = []
        for st in self.states:
            ix = self.index(st) or {}
            for c in ix.get("counties") or []:
                if isinstance(c.get("lat"), (int, float)) and isinstance(c.get("lng"), (int, float)) and \
                        miles(ll, (c["lat"], c["lng"])) <= radius + COUNTY_REACH:
                    out.append((st, c))
        return out

    def sales(self, st, fips, today):
        """Market sales of one county by the shared rule, each with its place point, filed date and county."""
        k = (st, fips, today)
        if k in self._rows:
            return self._rows[k]
        f = self.file(st, fips)
        out = []
        if f:
            munis = f.get("munis") or {}
            has_rec = "rec" in (f.get("cols") or [])
            for r in BLS.sale_rows(BLS.row_objs(f), today):
                if not BLS.market_sale(r, today):
                    continue
                m = munis.get(str(r.get("muni"))) if r.get("muni") is not None else None
                pt = (m[1], m[2]) if m and isinstance(m[1], (int, float)) and isinstance(m[2], (int, float)) else None
                o = dict(r)
                o["pt"] = pt
                o["st"] = st
                o["has_rec"] = has_rec
                o["when"] = (str(r.get("rec") or "")[:10] or None) if has_rec else str(r.get("date") or "")[:10]
                out.append(o)
        self._rows[k] = out
        return out


def fresh(f, month_last):
    """True when the county file was fetched after the month ended."""
    return bool(f) and str(f.get("fetched_utc") or "")[:10] > month_last


def row(r, d):
    """The only shape a sale leaves this module in: no names, no parcel, no legal, no document.
    pt is the township's or town's public point (the gazetteer's), never a parcel's."""
    a = BLS.num(r.get("acres"))
    with_bldg = "with buildings" in str(r.get("conv") or "").lower()
    return {"when": r["when"], "basis": "recorded" if r["has_rec"] else "sale date", "acres": a,
            "price": BLS.js_round(BLS.num(r.get("price")) or 0), "ppa": r.get("ppa"),
            "place": r.get("muniName") or None, "county": r.get("county"), "fips": r.get("fips"), "st": r["st"], "mi": d,
            "pt": r["pt"], "bldg": with_bldg}


def windows(year, m0):
    """The 12 months ending with month m0 and the 12 before (build_land_summary.windows)."""
    return BLS.windows(datetime.date.fromisoformat(month_bounds(year, m0)[1]))


def median_line(near, W, starts):
    """The middle price within the radius. Returns
      {"n": n, "cur": stats or None, "why": words when cur is withheld,
       "prev": stats, "chg": pct  (only when the two years compare), "why_cmp": words otherwise}
    near: market sales in the radius (any date); starts: each touched county's first filed date."""
    big = lambda rs: [r for r in rs if BLS.stat_ok(r) and (BLS.num(r.get("acres")) or 0) >= MED_MIN_ACRES]
    cur = [r for r in near if BLS.inw(r, W["cur"])]
    prev = [r for r in near if BLS.inw(r, W["prev"])]
    b1, b0 = big(cur), big(prev)
    out = {"n": len(b1), "n0": len(b0)}
    if len(b1) < MED_MIN_N:
        out["cur"] = None
        out["why"] = ("%s of %d acres or more in the last 12 months; I want %d before I give a middle price"
                      % (("only %d sale" if len(b1) == 1 else "only %d sales") % len(b1) if b1 else "no sales", MED_MIN_ACRES, MED_MIN_N))
        return out
    s, sp = BLS.stats([r["ppa"] for r in b1]), BLS.stats([r["ppa"] for r in b0])
    out["cur"] = s
    late = [x for x in starts if x and x > W["prev"][0]]
    u1, u0 = sum(1 for r in cur if r.get("acUnsure")), sum(1 for r in prev if r.get("acUnsure"))
    if late:
        out["why_cmp"] = "the records for part of the area start %s, after the year before began" % long_day(max(late))
    elif len(b0) < MED_MIN_N:
        out["why_cmp"] = "only %d such sale%s the 12 months before, and I want %d" % (len(b0), "" if len(b0) == 1 else "s", MED_MIN_N)
    elif s["q1"] > sp["q3"] or sp["q1"] > s["q3"]:
        out["why_cmp"] = "the middle half of prices one year does not overlap the other's, so the two sets of sales are too different to compare"
    elif u1 > MAX_UNSURE * len(cur) or u0 > MAX_UNSURE * len(prev):
        out["why_cmp"] = ("the acres were left off %d of %d returns in the last 12 months and %d of %d the year before, "
                          "too many holes to compare the two years" % (u1, len(cur), u0, len(prev)))
    else:
        out["prev"] = sp
        out["chg"] = round((s["med"] - sp["med"]) / sp["med"] * 100, 1)
    return out


def month_report(land, ll, radius, year, m0, today, need_fresh=True):
    """Everything one email needs for one ZIP point and radius, or {"skip": reason}.
    skip reasons: outside (no IL or WI county near), wait-data (a state's files not fetched
    since the month ended). An empty month is not a skip: rows == []."""
    first, last = month_bounds(year, m0)
    near_c = land.counties_near(ll, radius)
    if not near_c:
        return {"skip": "outside"}
    rows_in, unplaced, inside, starts, reads = [], 0, [], [], {}
    for st, c in near_c:
        f = land.file(st, c["fips"])
        if not f:
            continue
        if need_fresh and not fresh(f, last):
            return {"skip": "wait-data", "state": st}
        reads[st] = max(reads.get(st, ""), str(f.get("fetched_utc") or "")[:10])
        touched = False
        for r in land.sales(st, c["fips"], today):
            if not r["pt"]:
                if first <= (r["when"] or "") <= last and miles(ll, (c["lat"], c["lng"])) <= radius:
                    unplaced += 1
                continue
            d = miles(ll, r["pt"])
            if d > radius:
                continue
            touched = True
            inside.append(r)
            if r["when"] and first <= r["when"] <= last:
                rows_in.append((r, d))
        if touched:
            cov = f.get("coverage") or {}
            starts.append(cov.get("filed_from") or cov.get("from"))
    listed = [(r, d) for r, d in rows_in if (BLS.num(r.get("acres")) or 0) >= LIST_MIN_ACRES]
    no_ac = sum(1 for r, d in rows_in if not (BLS.num(r.get("acres")) or 0) > 0)
    small = sum(1 for r, d in rows_in if 0 < (BLS.num(r.get("acres")) or 0) < LIST_MIN_ACRES)
    listed.sort(key=lambda x: (round(x[1], 3), x[0]["when"], -(BLS.num(x[0].get("acres")) or 0)))
    out = [row(r, d) for r, d in listed]
    W = windows(year, m0)
    return {"rows": out[:MAX_ROWS], "more": max(0, len(out) - MAX_ROWS), "n": len(out), "no_acres": no_ac, "small": small,
            "unplaced": unplaced, "median": median_line(inside, W, starts), "W": W, "month": (year, m0),
            "states": sorted({r["st"] for r in inside} | {st for st, c in near_c if miles(ll, (c["lat"], c["lng"])) <= radius}),
            "read": reads, "counties": sorted({(r["st"], r["county"]) for r, d in listed})}


# ---------------------------------------------------------------- selftest
def selftest():
    import tempfile
    fails = []

    def ck(name, cond, detail=""):
        print(("ok   " if cond else "FAIL ") + name + (("  " + str(detail)[:400]) if detail and not cond else ""))
        if not cond:
            fails.append(name)

    # the radius math against hand-worked distances
    ck("one degree of latitude is 69.1 miles", abs(miles((45.0, -91.0), (46.0, -91.0)) - 69.09) < 0.02, miles((45.0, -91.0), (46.0, -91.0)))
    ck("one degree of longitude at 45 N is 48.8 miles", abs(miles((45.0, -91.0), (45.0, -92.0)) - 48.85) < 0.05, miles((45.0, -91.0), (45.0, -92.0)))
    ck("same point is zero", miles((45.4, -91.6), (45.4, -91.6)) == 0)
    ck("month bounds, December and February", month_bounds(2026, 11) == ("2026-12-01", "2026-12-31") and month_bounds(2028, 1) == ("2028-02-01", "2028-02-29"))

    tmp = tempfile.mkdtemp()
    os.makedirs(os.path.join(tmp, "data", "land", "wi"))
    os.makedirs(os.path.join(tmp, "data", "land", "il"))
    zipll = (45.0, -91.0)
    # 0.1 degree of latitude is 6.91 miles: points at 7, 14, 24 and 26 miles north of the ZIP
    munis = {"0": ["Near town", 45.1013, -91.0], "1": ["Mid town", 45.2026, -91.0], "2": ["Edge town", 45.3473, -91.0],
             "3": ["Out town", 45.3763, -91.0], "4": ["No point town", None, None]}
    cols = ["doc", "date", "price", "acres", "tac", "np", "cls", "conv", "pid", "muni", "legal", "exempt", "grantor", "grantee", "ac1", "rec"]
    R = []

    def sale(i, date, rec, price, acres, muni, conv="Warranty Deed; land only", np_=1):
        R.append(["D%04d" % i, date, price, acres, None, np_, "4", conv, "P-%04d" % i, muni, "SECRET LEGAL %d" % i, 0,
                  "SELLERNAME%04d" % i, "BUYERNAME%04d" % i, None, rec])
    # September 2026, recorded
    sale(1, "2026-09-02", "2026-09-10", 400000, 80, "0")                       # 7 mi, $5,000
    sale(2, "2026-08-28", "2026-09-03", 300000, 40, "1")                       # 14 mi, recorded in Sep, deed in Aug
    sale(3, "2026-09-20", "2026-10-02", 250000, 40, "0")                       # recorded in October: not September's
    sale(4, "2026-09-05", "2026-09-12", 900000, 150, "3")                      # 26 mi: outside 25
    sale(5, "2026-09-06", "2026-09-14", 120000, 20, "2", "Quit Claim Deed")    # not a market sale
    sale(6, "2026-09-07", "2026-09-15", 60000, 5, "0")                         # under 10 acres: counted
    sale(7, "2026-09-08", "2026-09-16", 500000, None, "1", np_=3)              # acres not stated: counted
    sale(8, "2026-09-09", "2026-09-17", 200000, 30, "4")                       # no point: not placed
    sale(9, "2026-09-11", "2026-09-18", 350000, 50, "2", "Warranty Deed; with buildings")   # 24 mi, with buildings
    # the median windows for September 2026: Oct 2025 to Sep 2026 and Oct 2024 to Sep 2025.
    # 12 more 40-acre sales in each, $/acre 5,000 to 6,100 and 4,800 to 5,900 by 100.
    ym = lambda y, mo: "%d-%02d-15" % (y + (mo - 1) // 12, (mo - 1) % 12 + 1)
    for k in range(12):
        sale(100 + k, ym(2025, 10 + min(k, 10)), "2026-08-20", (5000 + 100 * k) * 40, 40, "0")
        sale(200 + k, ym(2024, 10 + k), "2025-10-01", (4800 + 100 * k) * 40, 40, "1")
    f = {"state": "WI", "county": "Testing", "fips": "55999", "fetched_utc": "2026-10-03T11:00:00Z",
         "coverage": {"from": "2000-01-01", "filed_from": "2021-01-01"}, "acres_rule": 2, "cols": cols, "munis": munis, "rows": R}
    json.dump(f, open(os.path.join(tmp, "data", "land", "wi", "55999.json"), "w"))
    json.dump({"counties": [{"fips": "55999", "name": "Testing", "lat": 45.2, "lng": -91.0}]}, open(os.path.join(tmp, "data", "land", "wi", "index.json"), "w"))
    json.dump({"counties": []}, open(os.path.join(tmp, "data", "land", "il", "index.json"), "w"))
    land = Land(tmp)
    today = "2026-10-03"
    rep = month_report(land, zipll, 25, 2026, 8, today)
    docs = [(r["when"], r["acres"]) for r in rep["rows"]]
    ck("listed: recorded in September, 10+ acres, inside 25 mi, market sales, nearest first",
       docs == [("2026-09-10", 80), ("2026-09-03", 40), ("2026-09-18", 50)], docs)
    ck("distances: about 7, 14 and 24 miles", [round(r["mi"]) for r in rep["rows"]] == [7, 14, 24], [r["mi"] for r in rep["rows"]])
    ck("the 26-mile sale is outside 25 and inside 50",
       "2026-09-12" not in [r["when"] for r in rep["rows"]] and "2026-09-12" in [r["when"] for r in month_report(land, zipll, 50, 2026, 8, today)["rows"]])
    ck("10 miles keeps only the 7-mile sale", [r["when"] for r in month_report(land, zipll, 10, 2026, 8, today)["rows"]] == ["2026-09-10"])
    ck("counted, not listed: one under 10 acres, one without acres, one not placed", rep["small"] == 1 and rep["no_acres"] == 1 and rep["unplaced"] == 1,
       (rep["small"], rep["no_acres"], rep["unplaced"]))
    ck("with buildings marked; $/acre from the shared rule", rep["rows"][2]["bldg"] is True and rep["rows"][0]["ppa"] == 5000)
    ck("a row carries no name, parcel, legal or document", all(set(r) == {"when", "basis", "acres", "price", "ppa", "place", "county", "fips", "st", "mi", "pt", "bldg"} for r in rep["rows"])
       and not re.search(r"SELLERNAME|BUYERNAME|SECRET LEGAL|P-0|D0", json.dumps(rep)))
    med = rep["median"]
    ck("median: both windows have 10+ sales and compare, so both print with their counts", med["cur"] and med["cur"]["n"] >= 10 and med["prev"]["n"] >= 10, med)
    # by hand: the 12 above plus September's 80 ac at 5,000, 40 ac at 7,500, 50 ac at 7,000 and the
    # 40 ac at 6,250 recorded in October (its deed date is in the window): 16 sales, middle 5,600 and 5,700
    ck("median by hand: 16 sales, $5,650; the year before 12 sales, $5,350; up 5.6%",
       med.get("cur", {}).get("n") == 16 and med["cur"]["med"] == 5650 and med["prev"]["n"] == 12 and med["prev"]["med"] == 5350 and med["chg"] == 5.6, med)
    # an empty month: no rows, not a skip
    emp = month_report(land, zipll, 25, 2026, 6, today)
    ck("an empty month is an answer with no rows, not a skip", "skip" not in emp and emp["rows"] == [] and emp["n"] == 0, emp)
    # stale data waits
    ck("files fetched before the month ended: wait-data", month_report(land, zipll, 25, 2026, 9, today)["skip"] == "wait-data")
    ck("a ZIP far from any Illinois or Wisconsin county: outside", month_report(land, (33.0, -97.0), 50, 2026, 8, today)["skip"] == "outside")
    # the median withheld under 10, with the reason in words and the counts
    f2 = dict(f, rows=R[:9])
    json.dump(f2, open(os.path.join(tmp, "data", "land", "wi", "55999.json"), "w"))
    m2 = month_report(Land(tmp), zipll, 25, 2026, 8, today)["median"]
    ck("median withheld under 10 sales, the count and the reason in words", m2["cur"] is None and m2["why"] == "only 4 sales of 20 acres or more in the last 12 months; I want 10 before I give a middle price", m2)
    # records that start inside the year before: withheld
    f3 = dict(f, coverage={"from": "2025-06-01", "filed_from": "2025-06-01"})
    json.dump(f3, open(os.path.join(tmp, "data", "land", "wi", "55999.json"), "w"))
    m3 = month_report(Land(tmp), zipll, 25, 2026, 8, today)["median"]
    ck("records that start inside the year before: this year's median prints, the comparison is withheld with why",
       m3["cur"]["n"] == 16 and "prev" not in m3 and "chg" not in m3 and "records for part of the area start Jun 1, 2025" in m3["why_cmp"], m3)
    # many returns without acres: the comparison is withheld, the median stays
    f5 = dict(f, rows=R + [["U%03d" % k, "2025-03-15", 900000, None, None, 3, "4", "Warranty Deed", "Q%03d" % k, "0", "L", 0, "S", "B", None, "2025-03-20"] for k in range(8)])
    json.dump(f5, open(os.path.join(tmp, "data", "land", "wi", "55999.json"), "w"))
    m5 = month_report(Land(tmp), zipll, 25, 2026, 8, today)["median"]
    ck("acres left off too many returns the year before: no comparison, the reason with its counts",
       m5["cur"]["med"] == 5650 and "chg" not in m5 and m5["why_cmp"].startswith("the acres were left off 1 of 18 returns in the last 12 months and 8 of 20 the year before"), m5)
    # a file with no filed date: listed by sale date, and says so
    f4 = dict(f, cols=cols[:-1], rows=[x[:-1] for x in R])
    json.dump(f4, open(os.path.join(tmp, "data", "land", "wi", "55999.json"), "w"))
    r4 = month_report(Land(tmp), zipll, 25, 2026, 8, today)
    ck("no filed date in the file: listed by sale date, marked sale date",
       [r["when"] for r in r4["rows"]] == ["2026-09-02", "2026-09-20", "2026-09-11"] and all(r["basis"] == "sale date" for r in r4["rows"]), r4["rows"])
    ck("Indiana is not a state this email reads", "IN" not in STATES and Land().states == ("IL", "WI"))
    print("\n%s: %d failure(s)" % ("FAIL" if fails else "OK", len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv[1:]:
        sys.exit(selftest())
    print("land_alert.py is a module; scripts/send_land_alert.py runs it. --selftest checks it.")
