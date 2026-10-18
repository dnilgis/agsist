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
  python3 scripts/build_land_summary.py --rule <file> <day>   the market-sale rule's rows as JSON (test/land-rule.test.mjs)

WHAT COUNTS: the one market-sale rule, a port of field-scout-land.js (FSLand.rowObjs,
saleRows, screen, marketSale, statOK). test/land-rule.test.mjs runs both on the same rows,
made-up and real, and compares them row for row and the patterns character for character.
  - rowObjs: on a return of several parcels, acres count only when the file was built
    with acres_rule 2 and gives them; one parcel over 640 acres reads as acres uncertain.
  - saleRows: repeated copies of one record count once; deeds of one parcel (or, with no
    parcel number, one legal description) within 31 days are one sale with the total price,
    with a $/acre only when every deed carries the same full acres and one buyer.
  - marketSale: a price, acres (or uncertain acres), not exempt, not related parties, a deed
    type that normally carries a market price (no quit claim, gift, court, sheriff, foreclosure,
    partition, trade, exchange and the like, read even when the state file cuts the type short),
    a whole interest, and not dated after the fetch.
  - statOK: a $/acre of $500 or more. A sale under it never feeds a median or a range.
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
  - The change from the prior 12 months needs 10 or more sales in both windows, middle halves
    that overlap (two years whose middle prices do not meet are different kinds of sales), and acres
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
ONE_PARCEL_MAX_AC = 640 # FSLand.ONE_PARCEL_MAX_AC: one parcel over a full section reads as acres uncertain
PPA_FLOOR = 500         # FSLand.PPA_FLOOR: under this $/acre a sale never feeds a median or a range
GROUP_DAYS = 31         # FSLand.GROUP_DAYS: deeds of one parcel this close together are one sale
GROUP_LEGAL = 40        # FSLand.GROUP_LEGAL
MIN_ACRES = 20          # median and outliers: sales of this many acres or more
MIN_N = 5               # under this many sales, no median, no range, no "unusual"
MIN_N_CHG = 10          # the year-over-year change needs this many sales in each year
MAX_UNSURE = 0.25       # the year-over-year change needs known acres on 3 in 4 market sales in both years
LARGEST = 3             # rows in the largest-sales list
OUTLIERS = 4            # rows in the outside-the-range list
# Same text as FSLand.NON_MARKET and FSLand.PARTIAL in field-scout-land.js (the node tests compare them).
NON_MARKET = r"QUIT|GIFT|CORRECT|TERMINAT|TRANSFER ON DEATH|\bTOD\b|SHERIFF|FORECLOS|EASEM|LEASE|RELATED PART|PARTITION|MINERAL|JUDICIAL|JUDGE|COMMISSIONER|COURT O|BENEFICIAL INTEREST|TRADE|EXCHANGE|IN LIEU|CONDEMN|STATE HIGHWAY|AWARD OF DAMAGES|INSTALLMENT CONTRACT|CONTRACT SATISFIED"
NON_MARKET_RE = re.compile(NON_MARKET)
PARTIAL = r"\bUNDIVIDED\b|LESS THAN (?:FULL|100 ?%|THE WHOLE|ENTIRE)|PARTIAL INTEREST|\b(?:ONE|TWO|THREE)[- ](?:HALF|THIRD|THIRDS|FOURTH|FOURTHS|QUARTER|FIFTH|SIXTH)\s+(?:UNDIVIDED\s+)?INTEREST\b|\b\d{1,2}\s*\/\s*\d{1,2}(?:TH|RD|ND)?\s+(?:UNDIVIDED\s+)?INTEREST\b|\b\d{1,2}(?:\.\d+)?\s*%\s+(?:UNDIVIDED\s+)?INTEREST\b"
PARTIAL_RE = re.compile(PARTIAL)

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
        elif np_ <= 1 and (num(o.get("acres")) or 0) > ONE_PARCEL_MAX_AC:
            o["acBig"] = num(o.get("acres"))
            o["acres"] = None
            o["acUnsure"] = True
        o["ppa"] = per_acre(o.get("price"), o.get("acres"))
        o["fips"], o["county"] = f.get("fips"), f.get("county")
        out.append(o)
    return out


def clean(v):
    """FSLand.clean."""
    return re.sub(r"\s+", " ", "" if v is None else str(v)).strip()


def up(v):
    return clean(v).upper()


def parcel_strip(pid):
    """FSLand.parcelKeys(pid).strip, or None."""
    s = up(pid)
    if not s:
        return None
    strip = re.sub(r"[^A-Z0-9]", "", s)
    if not strip or re.fullmatch(r"0+", strip):
        return None
    return strip


def partial(r):
    """FSLand.partial."""
    if not r:
        return False
    if r.get("grp"):
        return bool(r.get("grpPartial"))
    return bool(PARTIAL_RE.search((str(r.get("legal") or "") + " | " + str(r.get("conv") or "")).upper()))


def screen(r, today):
    """FSLand.screen: why a row is not a market sale, as short keys; empty when it is one."""
    if not r:
        return ["price"]
    out = []
    if not ((num(r.get("price")) or 0) > 0):
        out.append("price")
    if not (((num(r.get("acres")) or 0) > 0) or r.get("acUnsure")):
        out.append("acres")
    if r.get("exempt"):
        out.append("exempt")
    c = str(r.get("conv") or "").upper()
    if "RELATED PART" in c:
        out.append("related")
    elif NON_MARKET_RE.search(c):
        out.append("deed")
    if partial(r):
        out.append("partial")
    d = str(r.get("date") or "")[:10]
    if d and d > today:
        out.append("future")
    return out


def market_sale(r, today):
    """FSLand.marketSale."""
    return not screen(r, today)


def stat_ok(r):
    """FSLand.statOK: a $/acre that may feed a median, a range or a low."""
    return r.get("ppa") is not None and r["ppa"] >= PPA_FLOOR


def day_no(iso):
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", str(iso or ""))
    if not m:
        return None
    try:
        return datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3))).toordinal()
    except ValueError:
        return None


def group_key(r):
    """FSLand.groupKey."""
    k, co = parcel_strip(r.get("pid")), str(r.get("fips") or r.get("county") or "")
    if k:
        return co + "|p|" + k
    lg = up(r.get("legal"))
    return co + "|l|" + lg[:GROUP_LEGAL] if len(lg) >= 10 else None


def sale_rows(rows, today):
    """FSLand.saleRows: one row per sale (repeated records once; deeds of one parcel within 31 days
    merged into one sale with the total price)."""
    seen, once = set(), []
    for r in rows:
        co, p = str(r.get("fips") or r.get("county") or ""), num(r.get("price"))
        k1 = co + "|d|" + up(r.get("doc")) if r.get("doc") else None
        pk = parcel_strip(r.get("pid"))
        where = pk if pk else (up(r.get("legal"))[:GROUP_LEGAL] if len(up(r.get("legal"))) >= 10 else "")
        k2 = ("%s|%s|%s|%s|%s|%s" % (co, str(r.get("date") or "")[:10], "" if p is None else js_round(p * 100), where, up(r.get("grantor")), up(r.get("grantee")))) if where else None
        if (k1 and k1 in seen) or (k2 and k2 in seen):
            continue
        if k1:
            seen.add(k1)
        if k2:
            seen.add(k2)
        once.append(r)
    by, order = {}, []
    for i, r in enumerate(once):
        why = [w for w in screen(r, today) if w != "partial"]
        k = group_key(r) if not why and day_no(r.get("date")) is not None else None
        if not k:
            order.append({"i": i, "r": r})
            continue
        by.setdefault(k, []).append((i, r))
    for k in by:
        lst = sorted(by[k], key=lambda e: (str(e[1].get("date")), e[0]))
        cur = None
        for i, r in lst:
            d = day_no(r.get("date"))
            if cur and d - cur["d0"] <= GROUP_DAYS:
                cur["m"].append(r)
                continue
            cur = {"d0": d, "i": i, "m": [r]}
            order.append(cur)
    order.sort(key=lambda g: g["i"])
    out = []
    for g in order:
        if "r" in g:
            out.append(g["r"])
            continue
        m = g["m"]
        if len(m) == 1:
            out.append(m[0])
            continue
        f = m[0]
        o = dict(f)
        a0 = num(f.get("acres"))
        same_ac = all(not x.get("acUnsure") and (num(x.get("acres")) or 0) > 0 and num(x.get("acres")) == a0 for x in m)
        buyers = []
        for x in m:
            b = up(x.get("grantee"))
            if b and b not in buyers:
                buyers.append(b)
        o["grp"] = len(m)
        o["date2"] = m[-1].get("date")
        o["price"] = sum(num(x.get("price")) for x in m)
        o["grpWhole"] = same_ac and len(buyers) <= 1
        o["acres"] = a0 if same_ac else None
        o["acUnsure"] = not same_ac
        o["ppa"] = per_acre(o["price"], o["acres"]) if o["grpWhole"] else None
        o["grpPartial"] = (not o["grpWhole"]) and any(partial(x) for x in m)
        convs = []
        for x in m:
            c = clean(x.get("conv"))
            if c and c not in convs:
                convs.append(c)
        o["conv"] = "; ".join(convs)
        o["np"] = max(int(num(x.get("np")) or 1) for x in m)
        out.append(o)
    return out


def rule_rows(f, today):
    """The shared rule's result on one county file, for test/land-rule.test.mjs:
    [doc, date, price, acres, $/acre, market, statOK, grp] for every row saleRows keeps."""
    out = []
    for r in sale_rows(row_objs(f), today):
        a = num(r.get("acres"))
        out.append([r.get("doc"), str(r.get("date") or "")[:10], js_round(num(r.get("price")) or 0), a,
                    r.get("ppa"), market_sale(r, today), stat_ok(r), r.get("grp") or 1])
    return out


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


def county_rows(f, today):
    """Market sales, one row per sale, by the shared rule."""
    return [r for r in sale_rows(row_objs(f), today) if market_sale(r, today)]


def county_summary(f, W, today):
    rows = county_rows(f, today)
    cur = [r for r in rows if inw(r, W["cur"])]
    prev = [r for r in rows if inw(r, W["prev"])]
    w24 = [r for r in rows if inw(r, W["w24"])]
    big = lambda rs: [r for r in rs if stat_ok(r) and (num(r.get("acres")) or 0) >= MIN_ACRES]
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
        if s["n"] < MIN_N_CHG or sp["n"] < MIN_N_CHG:
            out["why_chg"] = "%d and %d sales of %d+ acres with known acres; a change needs %d or more in each year" % (s["n"], sp["n"], MIN_ACRES, MIN_N_CHG)
        elif s["q1"] > sp["q3"] or sp["q1"] > s["q3"]:
            out["why_chg"] = "the middle half of prices in one year does not overlap the other's; the two sets of sales are too different to compare"
        elif out["u12"] > MAX_UNSURE * len(cur) or out["u12p"] > MAX_UNSURE * len(prev):
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
    today = fetched[:10]
    counties = {}
    allcur = []
    for f in sorted(files, key=lambda x: x.get("fips") or ""):
        counties[f["fips"]] = county_summary(f, W, today)
        allcur += [r["ppa"] for r in county_rows(f, today) if inw(r, W["cur"]) and stat_ok(r) and (num(r.get("acres")) or 0) >= MIN_ACRES]
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
    """States with transfer files AND a checked source entry above. A new state's files (Indiana,
    Oct 18) get no Atlas summary until its deed types and acres are checked against the market-sale
    rule and it is added to SOURCES."""
    return sorted(os.path.basename(d).upper() for d in glob.glob(os.path.join(LAND, "*"))
                  if os.path.isdir(d) and glob.glob(os.path.join(d, "[0-9]*.json")) and os.path.basename(d).upper() in SOURCES)


def main(argv):
    if "--selftest" in argv:
        return selftest()
    if argv[:1] == ["--rule"]:
        # python3 scripts/build_land_summary.py --rule <county file or fixture> <YYYY-MM-DD>: the shared
        # rule's rows as JSON, for test/land-rule.test.mjs (a fixture holds {"files": [...]})
        with open(argv[1], encoding="utf-8") as fh:
            d = json.load(fh)
        print(json.dumps([rule_rows(f, argv[2]) for f in (d.get("files") or [d])]))
        return 0
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
    ck("market flags match the fixture", [market_sale(o, fx["fetched"][:10]) for o in objs] == exp["market"])
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
    # change gate, worked: 10 and 10 comparables (20 ac each), acres unknown on 1 of 11 in each year (9%),
    # then 4 of 14 in the year before (29%)
    seq = iter(range(1000))
    def mk(d, p, a, np_=1):
        return ["x%d" % next(seq), d, p, a, None, np_, "4", "Warranty Deed", "", "0", "", 0, "", "", None]
    def yr(y, step):
        return [mk("%d-0%d-%s" % (y, m, dd), step * m, 20) for m in range(1, 6) for dd in ("01", "15")]
    g = dict(f, rows=yr(2026, 100000) + [mk("2026-06-01", 5000, None, 2)] + yr(2025, 50000) + [mk("2025-06-01", 5000, None, 2)])
    gc = build_state("IL", [g], fetched=fx["fetched"])["counties"][f["fips"]]
    # 20 ac each: $/ac 5,000 to 25,000 twice over, median 15,000; the year before 2,500 to 12,500, median 7,500
    ck("change shown at 10 and 10 sales, 1 in 11 unknown", gc.get("chg") == 100.0 and gc["u12"] == 1 and gc["med"]["n"] == 10)
    g2 = dict(g, rows=g["rows"] + [mk("2025-07-01", 5000, None, 2), mk("2025-08-01", 5000, None, 2), mk("2025-09-01", 5000, None, 2)])
    gc2 = build_state("IL", [g2], fetched=fx["fetched"])["counties"][f["fips"]]
    ck("change withheld at 4 in 14 unknown", "chg" not in gc2 and gc2["u12p"] == 4 and "4 of 14" in gc2["why_chg"])
    g3 = dict(g, rows=yr(2026, 100000) + [mk("2025-0%d-01" % m, 50000 * m, 20) for m in range(1, 8)])
    gc3 = build_state("IL", [g3], fetched=fx["fetched"])["counties"][f["fips"]]
    ck("change withheld under 10 sales in a year (10 and 7)", "chg" not in gc3 and "needs 10" in gc3["why_chg"])
    g4 = dict(g, rows=yr(2026, 100000) + [mk("2025-0%d-%s" % (m, dd), 30000 * m, 20) for m in range(1, 6) for dd in ("01", "15")])
    gc4 = build_state("IL", [g4], fetched=fx["fetched"])["counties"][f["fips"]]
    ck("change withheld when the middle halves do not overlap", "chg" not in gc4 and "overlap" in gc4["why_chg"])
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
