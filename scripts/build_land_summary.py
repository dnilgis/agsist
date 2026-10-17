#!/usr/bin/env python3
"""build_land_summary.py -- county sale-price summaries for the Farmland Atlas.

Reads the committed county transfer files (data/land/<st>/<fips>.json, written by
scripts/fetch_land_sales.py) and writes one small file per state:

  data/land/<st>/summary.json   about 0.5 KB a county, loaded by components/atlas-sales.js
                                on the county pages, the printable sheet and the state page

OFFLINE: reads committed files only, so it runs locally the same way it runs in the
land-data workflow (after the transfer fetch).

  python3 scripts/build_land_summary.py            build every state that has transfer files
  python3 scripts/build_land_summary.py IL         one state
  python3 scripts/build_land_summary.py --check    build to memory, compare with the committed files
  python3 scripts/build_land_summary.py --selftest run the shared fixture (test/fixtures/land-summary.json)

WHAT COUNTS (a port of field-scout-land.js, kept in step by the shared fixture and
test/atlas-sales.test.mjs, which also compares the deed-type pattern below with the
one in field-scout-land.js character for character):
  - rowObjs: on a return of several parcels, acres count only when the file was built
    with acres_rule 2 and gives them; otherwise acres are unknown and give no $/acre.
  - marketSale: a price, acres (or a multi-parcel sale with unknown acres), not exempt
    from the transfer fee, and a deed type that normally carries a market price
    (no related-party, quit claim, gift, sheriff, judicial, partition and the like).
  - $/acre: price over acres, whole dollars, half up (Math.round).

WINDOWS. Everything is dated by the sale date on the return. "Through" is the last day
of the last full month before the state's files were fetched, so a half-filled month
never sits in a count. Last 12 months, the 12 before, and 24 months for the sales list.
A sale dated after the fetch (a typo on a return) is never counted.

HONESTY RULES
  - Median $/acre uses market sales of 20 acres or more with known acres. Under 5 such
    sales, no median: the count and the reason are written instead.
  - The middle half (IQR) is the 25th to 75th percentile, linear between ranks (the
    spreadsheet QUARTILE.INC rule). Whole dollars.
  - The change from the prior 12 months needs 5 or more sales in both windows, and acres
    known on at least 3 in 4 market sales in both (Wisconsin's older returns often leave
    acres unknown on a multi-parcel sale; two years read through different holes in the
    record do not compare). The reason is written when it is withheld.
  - A sale is "outside the usual range" only when 5 or more comparable sales (market,
    20+ acres, known acres, last 24 months) set the range, and its $/acre is more than
    1.5 times the IQR below the 25th or above the 75th percentile.
  - The largest-sales list needs 5 or more market sales with known acres in 24 months.
  - No buyer or seller name, legal description, parcel number or document number is
    written. Names stay on the Field Scout card for one picked parcel.
"""
import datetime
import glob
import json
import math
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAND = os.path.join(ROOT, "data", "land")
FIXTURE = os.path.join(ROOT, "test", "fixtures", "land-summary.json")

ACRES_RULE = 2          # FSLand.ACRES_RULE
MIN_ACRES = 20          # median and outliers: sales of this many acres or more
MIN_N = 5               # under this many sales, no median, no range, no "unusual"
MAX_UNSURE = 0.25       # the year-over-year change needs known acres on 3 in 4 market sales in both years
LARGEST = 3             # rows in the largest-sales list
OUTLIERS = 4            # rows in the outside-the-range list
# Same text as FSLand.NON_MARKET in field-scout-land.js (the node test compares them).
NON_MARKET = r"QUIT|GIFT|CORRECT|TERMINAT|TRANSFER ON DEATH|\bTOD\b|SHERIFF|FORECLOS|EASEMENT|LEASE|RELATED PART|PARTITION|MINERAL|JUDICIAL|JUDGE|COMMISSIONER|COURT OFFICER|BENEFICIAL INTEREST"
NON_MARKET_RE = re.compile(NON_MARKET)

SOURCES = {
    "IL": {"record": "Illinois PTAX-203 (MyDec) transfer declarations",
           "who": "Illinois Department of Revenue",
           "url": "https://data.illinois.gov/d/it54-y4c6",
           "kinds": "farm parcels (Line 8, farm use)"},
    "WI": {"record": "Wisconsin DOR Real Estate Transfer Returns (RETR)",
           "who": "Wisconsin Department of Revenue",
           "url": "https://www.revenue.wi.gov/Pages/ERETR/data-home.aspx",
           "kinds": "agricultural, forest and undeveloped classes"},
}


def num(v):
    if v is None or v == "":
        return None
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v) if math.isfinite(v) else None
    try:
        n = float(re.sub(r"[$,\s]", "", str(v)))
    except ValueError:
        return None
    return n if math.isfinite(n) else None


def js_round(x):
    """Math.round: half up, also for negatives (-2.5 -> -2)."""
    return int(math.floor(x + 0.5))


def per_acre(price, acres):
    """FSLand.perAcre."""
    p, a = num(price), num(acres)
    if p is None or a is None or p <= 0 or a <= 0:
        return None
    return js_round(p / a)


def row_objs(f):
    """FSLand.rowObjs, without the lat/lng the summary does not need."""
    if not f or not f.get("cols") or f.get("rows") is None:
        return []
    cols = f["cols"]
    munis = f.get("munis") or {}
    checked = (num(f.get("acres_rule")) or 0) >= ACRES_RULE
    out = []
    for a in f["rows"]:
        o = dict(zip(cols, a))
        m = munis.get(str(o.get("muni"))) if o.get("muni") is not None else None
        o["muniName"] = m[0] if m else o.get("muni")
        np_ = num(o.get("np")) or 1
        if np_ > 1 and (not checked or not ((num(o.get("acres")) or 0) > 0)):
            o["acres"] = None
            o["acUnsure"] = True
        o["ppa"] = per_acre(o.get("price"), o.get("acres"))
        out.append(o)
    return out


def market_sale(r):
    """FSLand.marketSale."""
    if not r:
        return False
    if not ((num(r.get("price")) or 0) > 0):
        return False
    if not (((num(r.get("acres")) or 0) > 0) or r.get("acUnsure")):
        return False
    if r.get("exempt"):
        return False
    if NON_MARKET_RE.search(str(r.get("conv") or "").upper()):
        return False
    return True


def quantile(v, p):
    """Linear between ranks (QUARTILE.INC, numpy's default). v sorted, not empty."""
    h = (len(v) - 1) * p
    lo = int(math.floor(h))
    hi = min(lo + 1, len(v) - 1)
    return v[lo] + (h - lo) * (v[hi] - v[lo])


def stats(ppas):
    """Median and middle half, whole dollars; None under MIN_N."""
    v = sorted(x for x in ppas if x is not None)
    if len(v) < MIN_N:
        return None
    return {"n": len(v), "med": js_round(quantile(v, 0.5)), "q1": js_round(quantile(v, 0.25)), "q3": js_round(quantile(v, 0.75))}


def month_end_before(iso_day):
    """Last day of the month before the one iso_day falls in."""
    d = datetime.date.fromisoformat(iso_day[:10])
    return d.replace(day=1) - datetime.timedelta(days=1)


def months_back(d, n):
    """First day of the month n-1 months before d's month (n months ending with d's month)."""
    y, m = d.year, d.month - (n - 1)
    while m <= 0:
        m += 12
        y -= 1
    return datetime.date(y, m, 1)


def windows(through):
    t = through
    cur0 = months_back(t, 12)
    prev_t = cur0 - datetime.timedelta(days=1)
    prev0 = months_back(prev_t, 12)
    return {"cur": [cur0.isoformat(), t.isoformat()], "prev": [prev0.isoformat(), prev_t.isoformat()],
            "w24": [prev0.isoformat(), t.isoformat()]}


def inw(r, w):
    d = str(r.get("date") or "")[:10]
    return w[0] <= d <= w[1]


def sale_row(r):
    """[date, acres, price, $/acre, township or municipality]. Nothing else, no names."""
    a = num(r.get("acres"))
    return [str(r["date"])[:10], round(a, 2) if a is not None else None, js_round(num(r["price"])), r.get("ppa"), r.get("muniName") or None]


def county_summary(f, W):
    rows = [r for r in row_objs(f) if market_sale(r)]
    cur = [r for r in rows if inw(r, W["cur"])]
    prev = [r for r in rows if inw(r, W["prev"])]
    w24 = [r for r in rows if inw(r, W["w24"])]
    big = lambda rs: [r for r in rs if r.get("ppa") is not None and (num(r.get("acres")) or 0) >= MIN_ACRES]
    cov = f.get("coverage") or {}
    ff = cov.get("filed_from") or cov.get("from")
    out = {"name": f.get("county"), "from": ff, "to": cov.get("filed_to") or cov.get("to"),
           "n12": len(cur), "n12p": len(prev)}
    # the prior 12 months are only a count when the records reach back that far
    if ff and ff > W["prev"][0]:
        out["n12p"] = None
        out["why_p"] = "records start %s" % ff
    s, sp = stats([r["ppa"] for r in big(cur)]), stats([r["ppa"] for r in big(prev)])
    out["k12"] = len(big(cur))
    out["k12p"] = len(big(prev)) if out["n12p"] is not None else None
    if s:
        out["med"] = s
    if sp and out["n12p"] is not None:
        out["medp"] = sp
    out["u12"] = sum(1 for r in cur if r.get("acUnsure"))
    out["u12p"] = sum(1 for r in prev if r.get("acUnsure")) if out["n12p"] is not None else None
    if s and sp and out["n12p"] is not None:
        if out["u12"] > MAX_UNSURE * len(cur) or out["u12p"] > MAX_UNSURE * len(prev):
            out["why_chg"] = "acres unknown on %d of %d market sales in the last 12 months and %d of %d in the 12 before" % (
                out["u12"], len(cur), out["u12p"], len(prev))
        else:
            out["chg"] = round((s["med"] - sp["med"]) / sp["med"] * 100, 1)
    # the 24-month range and what falls well outside it
    comp = big(w24)
    s24 = stats([r["ppa"] for r in comp])
    out["k24"] = len(comp)
    if s24:
        iqr = s24["q3"] - s24["q1"]
        lo, hi = s24["q1"] - 1.5 * iqr, s24["q3"] + 1.5 * iqr
        s24["lo"], s24["hi"] = js_round(lo), js_round(hi)
        out["r24"] = s24
        far = [r for r in comp if r["ppa"] > hi or r["ppa"] < lo]
        far.sort(key=lambda r: (-(max(r["ppa"] - hi, lo - r["ppa"]) / (iqr or 1)), r["date"]))
        out["out"] = [sale_row(r) + [1 if r["ppa"] > hi else -1] for r in far[:OUTLIERS]]
        out["nout"] = len(far)
    known = [r for r in w24 if (num(r.get("acres")) or 0) > 0]
    out["a24"] = len(known)
    if len(known) >= MIN_N:
        known.sort(key=lambda r: (-num(r["acres"]), str(r["date"])))
        out["large"] = [sale_row(r) for r in known[:LARGEST]]
    return out


def build_state(st, files, fetched=None):
    """files: list of county file dicts. Returns the summary dict."""
    st = st.upper()
    fetched = fetched or max((f.get("fetched_utc") or "") for f in files)
    through = month_end_before(fetched)
    W = windows(through)
    counties = {}
    allcur = []
    for f in sorted(files, key=lambda x: x.get("fips") or ""):
        counties[f["fips"]] = county_summary(f, W)
        allcur += [r["ppa"] for r in row_objs(f) if market_sale(r) and inw(r, W["cur"]) and r.get("ppa") is not None and (num(r.get("acres")) or 0) >= MIN_ACRES]
    src = SOURCES.get(st, {})
    one = files[0] if files else {}
    return {
        "state": st, "record": src.get("record") or one.get("source"), "who": src.get("who"), "url": src.get("url"),
        "kinds": src.get("kinds"), "since_note": one.get("since_note"), "fetched": fetched[:10], "through": through.isoformat(),
        "windows": W, "min_acres": MIN_ACRES, "min_n": MIN_N,
        "state_med": stats(allcur),
        "counties": counties,
    }


def load_state(st):
    out = []
    for p in sorted(glob.glob(os.path.join(LAND, st.lower(), "[0-9]*.json"))):
        with open(p, encoding="utf-8") as fh:
            out.append(json.load(fh))
    return out


def dump(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n"


NAME_COLS = ("grantor", "grantee", "legal", "pid")


def leaks(summary_text, files):
    """Any buyer or seller name, legal description, parcel or document number from the
    source rows that shows up in the summary text. Returns the first few found."""
    found = []
    for f in files:
        cols = f.get("cols") or []
        ix = [cols.index(c) for c in NAME_COLS if c in cols]
        for r in f.get("rows") or []:
            for i in ix:
                v = r[i]
                # an all-digit parcel number could equal a price by chance; those are left out
                if isinstance(v, str) and len(v.strip()) >= 6 and not v.strip().isdigit() and json.dumps(v.strip(), ensure_ascii=False)[1:-1] in summary_text:
                    found.append(v)
                    if len(found) >= 5:
                        return found
    return found


def states_on_disk():
    return sorted(os.path.basename(d).upper() for d in glob.glob(os.path.join(LAND, "*")) if os.path.isdir(d) and glob.glob(os.path.join(d, "[0-9]*.json")))


def main(argv):
    if "--selftest" in argv:
        return selftest()
    check = "--check" in argv
    sts = [a.upper() for a in argv if not a.startswith("--")] or states_on_disk()
    bad = 0
    for st in sts:
        files = load_state(st)
        if not files:
            print("%s: no transfer files; nothing written" % st)
            continue
        s = build_state(st, files)
        text = dump(s)
        lk = leaks(text, files)
        if lk:
            print("FAIL %s: summary carries source names or numbers (%d found); not written" % (st, len(lk)), file=sys.stderr)
            bad += 1
            continue
        path = os.path.join(LAND, st.lower(), "summary.json")
        if check:
            old = open(path, encoding="utf-8").read() if os.path.exists(path) else None
            if old != text:
                print("FAIL %s: data/land/%s/summary.json is not current; run python3 scripts/build_land_summary.py %s" % (st, st.lower(), st), file=sys.stderr)
                bad += 1
            else:
                print("ok   %s summary current" % st)
            continue
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(text)
        withm = sum(1 for c in s["counties"].values() if c.get("med"))
        print("%s: %d counties, %d with a 12-month median, through %s, %.1f KB" % (st, len(s["counties"]), withm, s["through"], len(text.encode()) / 1024))
    return 1 if bad else 0


def selftest():
    """The shared fixture: the same rows field-scout-land.js is tested on in node."""
    fx = json.load(open(FIXTURE, encoding="utf-8"))
    fails = []

    def ck(name, ok):
        if not ok:
            fails.append(name)
            print("FAIL", name)

    f = fx["file"]
    objs = row_objs(f)
    exp = fx["expect"]
    ck("market flags match the fixture", [market_sale(o) for o in objs] == exp["market"])
    ck("$/acre matches the fixture", [o["ppa"] for o in objs] == exp["ppa"])
    ck("deed-type pattern is the field-scout one", NON_MARKET == fx["non_market"])
    s = build_state("IL", [f], fetched=fx["fetched"])
    c = s["counties"][f["fips"]]
    ck("through is the last full month", s["through"] == exp["through"])
    ck("windows", s["windows"] == exp["windows"])
    for k in ("n12", "n12p", "k12", "k12p", "k24", "a24", "u12", "u12p"):
        ck("count " + k, c.get(k) == exp["county"][k])
    ck("median and middle half", c.get("med") == exp["county"]["med"])
    ck("prior median withheld under 5", "medp" not in c and "chg" not in c)
    # change gate, worked: 5 and 5 comparables, acres unknown on 1 of 6 in each year (17%), then 3 of 8 (38%)
    def mk(d, p, a, np_=1):
        return ["x", d, p, a, None, np_, "4", "Warranty Deed", "", "0", "", 0, "", "", None]
    g = dict(f, rows=[mk("2026-0%d-01" % m, 100000 * m, 20) for m in range(1, 6)] + [mk("2026-06-01", 5000, None, 2)]
             + [mk("2025-0%d-01" % m, 50000 * m, 20) for m in range(1, 6)] + [mk("2025-06-01", 5000, None, 2)])
    gc = build_state("IL", [g], fetched=fx["fetched"])["counties"][f["fips"]]
    ck("change shown at 1 in 6 unknown", gc.get("chg") == 100.0 and gc["u12"] == 1)   # 20 ac each: medians 15,000 and 7,500 $/ac
    g2 = dict(g, rows=g["rows"] + [mk("2025-07-01", 5000, None, 2), mk("2025-08-01", 5000, None, 2)])
    gc2 = build_state("IL", [g2], fetched=fx["fetched"])["counties"][f["fips"]]
    ck("change withheld at 3 in 8 unknown", "chg" not in gc2 and gc2["u12p"] == 3 and "3 of 8" in gc2["why_chg"])
    ck("24-month range", c.get("r24") == exp["county"]["r24"])
    ck("outside the range", c.get("out") == exp["county"]["out"])
    ck("largest sales", c.get("large") == exp["county"]["large"])
    text = dump(s)
    ck("no names, legal, parcel or document numbers", not leaks(text, [f]) and "SYNTHETIC" not in text and "SYN-" not in text)
    ck("the leak check finds a name", leaks(text + "SYNTHETIC SELLER A", [f]) == ["SYNTHETIC SELLER A"])
    ck("future-dated sale never counted", "2026-12-01" not in text)
    # hand-worked statistics
    ck("quartiles, odd n", stats([100, 200, 300, 400, 500]) == {"n": 5, "med": 300, "q1": 200, "q3": 400})
    ck("quartiles, even n", stats([100, 200, 300, 400, 500, 600]) == {"n": 6, "med": 350, "q1": 225, "q3": 475})
    ck("withheld under 5", stats([1, 2, 3, 4]) is None)
    ck("half up like Math.round", js_round(2.5) == 3 and js_round(-2.5) == -2 and per_acre(1250000, 160) == 7813)
    ck("window of 12 months", windows(datetime.date(2026, 9, 30))["cur"] == ["2025-10-01", "2026-09-30"]
       and windows(datetime.date(2026, 9, 30))["prev"] == ["2024-10-01", "2025-09-30"])
    ck("month end before", month_end_before("2026-10-17T06:00:00Z").isoformat() == "2026-09-30"
       and month_end_before("2026-03-01").isoformat() == "2026-02-28")
    print("selftest: %s" % ("FAIL (%d)" % len(fails) if fails else "ok"))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
