#!/usr/bin/env python3
"""fetch_ethanol_mars.py -- what ethanol plants bid for corn, by state, and what
their co-products sell for, from USDA My Market News (the MARS API), written to
data/ethanol-bids.json for the "Ethanol plants paying" fold on /cash-bids.

Nov 2 2026: build from USDA MARS (fx/marseth). Two reports, both from the
USDA AMS St. Joseph, MO office:
  3617  National Daily Ethanol Report (weekdays). One row per state (Iowa: East
        and West): the range of corn bids at ethanol plants, #2 yellow,
        delivered by truck, current delivery, $/bu, and the range of basis in
        cents against a named futures month, plus USDA's average and its
        average a year ago. The report names no plants.
  3618  National Weekly Grain Co-Products Report (Mondays). Distillers grain
        (dried 10%, wet, modified wet) $/ton and distillers corn oil cents/lb
        by state. Its rows carry no $/ton year ago, so the report for the same
        week a year earlier is read too and matched row by row (same product,
        same area); no match, no year-ago number.

HONEST NUMBERS
  * A row is kept only when every number it shows is there and consistent:
    low <= high, bids $1 to $20, basis within 300 cents, one futures month for
    both ends, and bid minus basis giving the same futures price at both ends
    (within half a cent) and within 2 cents of the day's middle. A state that
    shows twice in one report is dropped (no way to tell which is right).
  * Only reports USDA marks Final. Fewer than 3 good corn rows: the corn table
    is withheld with the reason. A co-product price of 0 or blank is dropped.
  * The raw MARS answers are never written to data/; only this small file is.
  * Nothing is written when the key is missing or a call fails: the last good
    file stays and the page shows its report date (and says when it is old).

The key: MARS_API_KEY (Actions secret; HTTP basic, key as user name, empty
password). Never printed or saved.

    python3 scripts/fetch_ethanol_mars.py [--out data/ethanol-bids.json]
    python3 scripts/fetch_ethanol_mars.py --from-files 3617.json 3618.json [3618-year-ago.json] [--out PATH] [--now ISO]
    python3 scripts/fetch_ethanol_mars.py --selftest
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import argparse
import base64
import datetime as dt
import json
import math
import os
import statistics
import sys
import urllib.error
import urllib.request

BASE = "https://marsapi.ams.usda.gov/services/v1.2/reports"
OUT = "data/ethanol-bids.json"
SCHEMA = "agsist-ethanol-bids/1"
CORN_ID, COPROD_ID = "3617", "3618"
CORN_TITLE = "National Daily Ethanol Report"
COPROD_TITLE = "National Weekly Grain Co-Products Report"
SOURCE = "USDA AMS"
MIN_CORN_ROWS = 3
UA = "AGSIST/1.0 (+https://agsist.com)"

STATES = {
    "Illinois": "IL", "Indiana": "IN", "Iowa": "IA", "Kansas": "KS", "Michigan": "MI", "Minnesota": "MN",
    "Missouri": "MO", "Nebraska": "NE", "Ohio": "OH", "South Dakota": "SD", "Wisconsin": "WI",
    "North Dakota": "ND", "Colorado": "CO", "Kentucky": "KY", "Tennessee": "TN", "Texas": "TX",
    "Oklahoma": "OK", "Pennsylvania": "PA", "New York": "NY", "Idaho": "ID", "California": "CA",
    "Arizona": "AZ", "Oregon": "OR", "Washington": "WA", "Wyoming": "WY", "Montana": "MT",
    "Georgia": "GA", "North Carolina": "NC", "Virginia": "VA", "Arkansas": "AR", "Louisiana": "LA",
    "Mississippi": "MS", "Alabama": "AL", "New Mexico": "NM",
}
MONTHS = {"January": "Jan", "February": "Feb", "March": "Mar", "April": "Apr", "May": "May", "June": "Jun",
          "July": "Jul", "August": "Aug", "September": "Sep", "October": "Oct", "November": "Nov",
          "December": "Dec"}
DG_VARIETIES = ("Dried 10%", "Modified Wet 55-60%", "Wet 65-70%")
EMPTY = (None, "", "N/A", "NA", "null", "None")


# ---------------------------------------------------------------- small readers
def mdy(v):
    """'11/02/2026' or '11/02/2026 11:25:27' -> date, else None."""
    if not isinstance(v, str):
        return None
    try:
        return dt.datetime.strptime(v.strip()[:10], "%m/%d/%Y").date()
    except ValueError:
        return None


def published(v):
    """USDA's published stamp as written ('2026-11-02 11:25:27', no zone given), or None."""
    if not isinstance(v, str):
        return None
    try:
        return dt.datetime.strptime(v.strip()[:19], "%m/%d/%Y %H:%M:%S").strftime("%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None


def num(v):
    """A real number or None. Booleans, blanks and words are None."""
    if isinstance(v, bool) or v in EMPTY:
        return None
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if x == x and abs(x) != float("inf") else None


def text(v):
    v = "" if v is None else str(v).strip()
    return "" if v in EMPTY else v


def sections(body):
    """A MARS answer (bytes, str or parsed) -> {section name: rows}."""
    try:
        d = json.loads(body) if isinstance(body, (bytes, str)) else body
    except ValueError:
        return {}
    out = {}
    if isinstance(d, dict) and isinstance(d.get("results"), list):
        d = [d]
    if isinstance(d, list):
        for i, s in enumerate(d):
            if isinstance(s, dict) and isinstance(s.get("results"), list):
                out.setdefault(s.get("reportSection") or "section%d" % i, []).extend(
                    r for r in s["results"] if isinstance(r, dict))
    return out


def final_dates(header_rows, key="report_date"):
    """Report dates USDA marks Final in the header section."""
    return {mdy(r.get(key)) for r in header_rows if text(r.get("final_ind")).lower() == "final" and mdy(r.get(key))}


def futures_month(v):
    """'December (Z)' -> ('December', 'Z'); anything else -> None."""
    v = text(v)
    if "(" not in v:
        return None
    name, code = v.split("(", 1)
    name, code = name.strip(), code.strip(" )")
    if name not in MONTHS or len(code) != 1 or not code.isalpha():
        return None
    return name, code.upper()


# ---------------------------------------------------------------- 3617: corn bids
def corn_row(r):
    """(row, None) or (None, why) for one 3617 detail row."""
    want = {"commodity": "Corn", "quote_type": "Basis", "sale Type": "Bid", "delivery_period": "Current",
            "freight": "Delivered", "price_unit": "$ Per Bushel", "basis_unit": "¢/Bu"}
    for k, v in want.items():
        if text(r.get(k)) != v:
            return None, "%s is %r, not %r" % (k, text(r.get(k)), v)
    state = text(r.get("state/Province"))
    if state not in STATES:
        return None, "state %r not known" % state
    fm_lo, fm_hi = futures_month(r.get("basis Min Futures Month")), futures_month(r.get("basis Max Futures Month"))
    if not fm_lo or fm_lo != fm_hi:
        return None, "futures month missing or not the same at both ends"
    plo, phi = num(r.get("price Min")), num(r.get("price Max"))
    blo, bhi = num(r.get("basis Min")), num(r.get("basis Max"))
    if None in (plo, phi, blo, bhi):
        return None, "a number is missing"
    if not (1 <= plo <= phi <= 20):
        return None, "bid range %s to %s out of order or out of reach" % (plo, phi)
    if not (-300 <= blo <= bhi <= 300):
        return None, "basis range %s to %s out of order or out of reach" % (blo, bhi)
    f_lo, f_hi = plo - blo / 100.0, phi - bhi / 100.0
    if abs(f_lo - f_hi) > 0.005:
        return None, "bid minus basis gives two futures prices (%.4f, %.4f)" % (f_lo, f_hi)
    avg, ya = num(r.get("avg_price")), num(r.get("avg_price_year_ago"))
    region = text(r.get("region"))
    row = {"state": STATES[state], "state_name": state, "region": region or None,
           "label": state + (" " + region if region else ""),
           "bid_lo": round(plo, 4), "bid_hi": round(phi, 4), "basis_lo": round(blo, 2), "basis_hi": round(bhi, 2),
           "futures": fm_lo[0], "futures_code": fm_lo[1],
           "avg": round(avg, 4) if avg is not None and plo <= avg <= phi else None,
           "avg_year_ago": round(ya, 4) if ya is not None and 1 <= ya <= 20 else None,
           "_fut": (f_lo + f_hi) / 2}
    return row, None


def parse_corn(secs):
    """3617 sections -> (block, notes). block has rows for the latest Final report date."""
    notes = []
    finals = final_dates(secs.get("Report Header", []))
    by_date = {}
    for r in secs.get("Report Detail", []):
        d = mdy(r.get("report_date"))
        if d:
            by_date.setdefault(d, []).append(r)
    days = sorted((d for d in by_date if d in finals), reverse=True)
    skipped = sorted(d for d in by_date if d not in finals)
    if skipped:
        notes.append("not Final, not used: " + ", ".join(d.isoformat() for d in skipped))
    if not days:
        return {"withheld": "No final USDA ethanol corn report in reach."}, notes
    day = days[0]
    rows, seen = [], {}
    for r in by_date[day]:
        row, why = corn_row(r)
        if why:
            notes.append("%s %s: %s" % (day, text(r.get("state/Province")) or "?", why))
            continue
        k = (row["state"], row["region"])
        seen[k] = seen.get(k, 0) + 1
        rows.append(row)
    dups = {k for k, n in seen.items() if n > 1}
    for k in sorted(dups, key=str):
        notes.append("%s %s shows %d times, dropped" % (day, " ".join(x for x in k if x), seen[k]))
    rows = [x for x in rows if (x["state"], x["region"]) not in dups]
    if rows:
        mid = statistics.median(x["_fut"] for x in rows)
        keep = []
        for x in rows:
            if abs(x["_fut"] - mid) > 0.02:
                notes.append("%s %s: futures implied %.4f vs the day's %.4f, dropped" % (day, x["label"], x["_fut"], mid))
            else:
                keep.append(x)
        rows = keep
    months = {x["futures"] for x in rows}
    if len(months) > 1:
        return {"withheld": "Rows price against more than one futures month.", "report_date": day.isoformat()}, notes
    for x in rows:
        x.pop("_fut", None)
    rows.sort(key=lambda x: (x["state_name"], x["region"] or ""))
    pub = next((published(r.get("published_date")) for r in by_date[day] if published(r.get("published_date"))), None)
    block = {"report": CORN_TITLE, "slug": CORN_ID, "report_date": day.isoformat(), "published": pub,
             "unit": "$/bu", "basis_unit": "cents/bu", "terms": "#2 yellow corn, delivered to the plant by truck, current delivery",
             "futures": next(iter(months)) if months else None, "rows": rows}
    if len(rows) < MIN_CORN_ROWS:
        return {"withheld": "Fewer than %d states in the report with every number in place." % MIN_CORN_ROWS,
                "report": CORN_TITLE, "report_date": day.isoformat()}, notes
    return block, notes


# ---------------------------------------------------------------- 3618: co-products
def coprod_key(r):
    """(product key, area, unit) for a row this file publishes, else None."""
    c, v, unit = text(r.get("commodity")), text(r.get("variety")), text(r.get("price_unit"))
    area = text(r.get("trade_loc"))
    if not area:
        return None
    if c == "Distillers Grain" and v in DG_VARIETIES and unit == "$ Per Ton":
        return ("ddgs" if v == "Dried 10%" else "wdg" if v == "Wet 65-70%" else "mwdg"), area, "$/ton"
    if c == "Distillers Corn Oil" and unit == "Cents Per Lb":
        return "corn_oil", area, "cents/lb"
    return None


PRODUCT_NAME = {"ddgs": "Dried distillers grains (10% moisture)", "mwdg": "Modified wet distillers grains (55-60%)",
                "wdg": "Wet distillers grains (65-70%)", "corn_oil": "Distillers corn oil"}
PRODUCT_RANGE = {"$/ton": (5, 1000), "cents/lb": (5, 300)}


def coprod_rows(secs, target=None):
    """3618 sections -> (week begin date, {key: price}, notes) for its latest Final week, or with
    `target` the Final week nearest that date (the year-ago window holds two or three weeks)."""
    notes = []
    finals = final_dates(secs.get("Report Header", []), "report_begin_date") | final_dates(secs.get("Report Header", []))
    by_week = {}
    for r in secs.get("Report Detail", []):
        d = mdy(r.get("report_begin_date")) or mdy(r.get("report_date"))
        if d:
            by_week.setdefault(d, []).append(r)
    weeks = sorted((d for d in by_week if d in finals), reverse=True)
    if target is not None:
        weeks.sort(key=lambda d: abs((d - target).days))
    if not weeks:
        return None, {}, notes, None
    wk = weeks[0]
    prices, seen = {}, {}
    for r in by_week[wk]:
        k = coprod_key(r)
        if not k:
            continue
        p = num(r.get("price"))
        lo, hi = PRODUCT_RANGE[k[2]]
        if p is None or not (lo <= p <= hi):
            notes.append("%s %s %s: price %r not used" % (wk, k[0], k[1], r.get("price")))
            continue
        seen[k] = seen.get(k, 0) + 1
        prices[k] = round(p, 2)
    for k, n in seen.items():
        if n > 1:
            notes.append("%s %s %s shows %d times, dropped" % (wk, k[0], k[1], n))
            prices.pop(k, None)
    end = next((mdy(r.get("report_end_date")) for r in by_week[wk] if mdy(r.get("report_end_date"))), None)
    pub = next((published(r.get("published_date")) for r in by_week[wk] if published(r.get("published_date"))), None)
    return wk, prices, notes, {"end": end, "published": pub}


def parse_coprod(secs, ya_secs=None):
    wk, prices, notes, meta = coprod_rows(secs)
    if wk is None:
        return {"withheld": "No final USDA co-products report in reach."}, notes
    ya_prices, ya_week = {}, None
    if ya_secs:
        ywk, yp, yn, _ = coprod_rows(ya_secs, wk - dt.timedelta(days=364))
        if ywk is not None and 357 <= (wk - ywk).days <= 371:
            ya_prices, ya_week = yp, ywk
        elif ywk is not None:
            notes.append("year-ago report week %s is %d days back, not used" % (ywk, (wk - ywk).days))
        notes.extend("year ago: " + n for n in yn)
    rows = []
    for (prod, area, unit), p in prices.items():
        rows.append({"product": prod, "name": PRODUCT_NAME[prod], "area": area, "unit": unit, "price": p,
                     "year_ago": ya_prices.get((prod, area, unit))})
    order = {"ddgs": 0, "mwdg": 1, "wdg": 2, "corn_oil": 3}
    rows.sort(key=lambda x: (order[x["product"]], x["area"]))
    if not rows:
        return {"withheld": "No co-product price with every number in place.", "week_of": wk.isoformat()}, notes
    return {"report": COPROD_TITLE, "slug": COPROD_ID, "week_of": wk.isoformat(),
            "week_end": meta["end"].isoformat() if meta["end"] else None, "published": meta["published"],
            "year_ago_week_of": ya_week.isoformat() if ya_week else None, "rows": rows}, notes


# ---------------------------------------------------------------- the file
def short_date(iso):
    d = dt.date.fromisoformat(iso)
    return "%s %d, %d" % (d.strftime("%b"), d.day, d.year)


def cents(c):
    c = round(c)
    return ("+%d" % c) if c > 0 else str(c)


def daily_line(corn):
    """One short line the Daily can use, with its source and date; None when corn is withheld."""
    rows = corn.get("rows") if isinstance(corn, dict) else None
    if not rows:
        return None
    # cents, the low end rounded down and the high end up, so the range holds every bid (USDA prints 1/4 cents)
    lo = math.floor(min(r["bid_lo"] for r in rows) * 100 + 1e-6) / 100
    hi = math.ceil(max(r["bid_hi"] for r in rows) * 100 - 1e-6) / 100
    blo, bhi = min(r["basis_lo"] for r in rows), max(r["basis_hi"] for r in rows)
    n = len({r["state"] for r in rows})
    return ("Ethanol plants bid $%.2f to $%.2f for corn in %d states, basis %s to %s cents against %s futures "
            "(%s, %s, %s)." % (lo, hi, n, cents(blo), cents(bhi), corn["futures"], SOURCE, corn["report"],
                                short_date(corn["report_date"])))


def build(corn_secs, coprod_secs, ya_secs=None, now=None):
    corn, n1 = parse_corn(corn_secs)
    co, n2 = parse_coprod(coprod_secs, ya_secs)
    now = now or dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    out = {"schema": SCHEMA, "generated": now, "source": SOURCE,
           "credit": "USDA AMS, %s and %s" % (CORN_TITLE, COPROD_TITLE),
           "corn": corn, "coproducts": co, "daily_line": daily_line(corn)}
    return out, n1 + n2


def write(path, data):
    tmp = path + ".tmp"
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1, sort_keys=False)
        f.write("\n")
    os.replace(tmp, path)


# ---------------------------------------------------------------- live calls
def mars_get(slug, a, b, key, opener=None):
    u = "%s/%s?q=report_begin_date=%s:%s&allSections=true" % (BASE, slug, a.strftime("%m/%d/%Y"), b.strftime("%m/%d/%Y"))
    if opener:
        return opener(u)
    req = urllib.request.Request(u, headers={
        "Authorization": "Basic " + base64.b64encode((key + ":").encode()).decode(),
        "Accept": "application/json", "User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def live(out, now=None, key=None, opener=None, log=print):
    key = key if key is not None else os.environ.get("MARS_API_KEY", "").strip()
    if not key and not opener:
        log("[ethanol] MARS_API_KEY not set; %s left as it was" % out)
        return 0
    today = (now or dt.datetime.now(dt.timezone.utc)).date()
    try:
        corn = sections(mars_get(CORN_ID, today - dt.timedelta(days=10), today, key, opener))
        co = sections(mars_get(COPROD_ID, today - dt.timedelta(days=21), today, key, opener))
        wk, _, _, _ = coprod_rows(co)
        ya = {}
        if wk is not None:
            t = wk - dt.timedelta(days=364)
            ya = sections(mars_get(COPROD_ID, t - dt.timedelta(days=7), t + dt.timedelta(days=7), key, opener))
    except (urllib.error.URLError, OSError, ValueError) as e:
        # the error class and HTTP code only: never the URL's auth or a body
        log("[ethanol] MARS call failed (%s %s); %s left as it was" % (type(e).__name__, getattr(e, "code", ""), out))
        return 0
    data, notes = build(corn, co, ya)
    for n in notes:
        log("[ethanol] " + n)
    if "withheld" in data["corn"] and "withheld" in data["coproducts"] and os.path.exists(out):
        log("[ethanol] nothing usable this run (%s / %s); %s left as it was"
            % (data["corn"]["withheld"], data["coproducts"]["withheld"], out))
        return 0
    write(out, data)
    log("[ethanol] wrote %s: corn %s, co-products %s" % (
        out, data["corn"].get("report_date", "withheld"), data["coproducts"].get("week_of", "withheld")))
    return 0


# ---------------------------------------------------------------- selftest
def _corn(state, plo, phi, blo, bhi, date="11/02/2026", region="N/A", month="December (Z)", **kw):
    r = {"report_date": date, "published_date": date + " 07:01:55", "commodity": "Corn", "quote_type": "Basis",
         "sale Type": "Bid", "delivery_period": "Current", "freight": "Delivered", "price_unit": "$ Per Bushel",
         "basis_unit": "¢/Bu", "state/Province": state, "region": region, "basis Min Futures Month": month,
         "basis Max Futures Month": month, "price Min": plo, "price Max": phi, "basis Min": blo, "basis Max": bhi,
         "avg_price": round((plo + phi) / 2, 4) if None not in (plo, phi) else None, "avg_price_year_ago": 4.0}
    r.update(kw)
    return r


def _hdr(*dates, final="Final", key="report_date"):
    return [{key: d, "final_ind": final} for d in dates]


def selftest():
    ok = 0

    def check(cond, what):
        nonlocal ok
        if not cond:
            raise AssertionError(what)
        ok += 1

    # hand-worked: Illinois 11/02/2026 in the real report: 4.3575 - (-0.12) = 4.4775 = 4.7775 - 0.30
    rows = [_corn("Illinois", 4.3575, 4.7775, -12, 30), _corn("Minnesota", 3.6775, 4.0775, -80, -40),
            _corn("Iowa", 4.0575, 4.3375, -42, -14, region="East"), _corn("Iowa", 4.0575, 4.3775, -42, -10, region="West")]
    corn, notes = parse_corn({"Report Header": _hdr("11/02/2026"), "Report Detail": rows})
    check(len(corn["rows"]) == 4 and corn["futures"] == "December", "four good rows, December")
    il = [r for r in corn["rows"] if r["state"] == "IL"][0]
    check((il["bid_lo"], il["bid_hi"], il["basis_lo"], il["basis_hi"]) == (4.3575, 4.7775, -12, 30), "Illinois numbers kept as sent")
    check([r["label"] for r in corn["rows"]] == ["Illinois", "Iowa East", "Iowa West", "Minnesota"], "sorted, Iowa split")
    check("_fut" not in il, "working value not written")
    line = daily_line(corn)
    check(line == "Ethanol plants bid $3.67 to $4.78 for corn in 3 states, basis -80 to +30 cents against December futures "
                  "(USDA AMS, National Daily Ethanol Report, Nov 2, 2026).", "daily line: %s" % line)
    check(len(line) <= 170, "daily line short")
    check("—" not in line, "no em dash")

    # a row whose ends imply two futures prices is dropped, and one off the day's futures
    bad = rows + [_corn("Ohio", 4.1775, 4.5775, -30, 20), _corn("Kansas", 4.30, 4.40, -30, -20)]
    corn2, notes2 = parse_corn({"Report Header": _hdr("11/02/2026"), "Report Detail": bad})
    check({r["state"] for r in corn2["rows"]} == {"IL", "MN", "IA"}, "Ohio (two futures) and Kansas (off the day) dropped")
    check(any("two futures" in n for n in notes2) and any("Kansas" in n and "implied" in n for n in notes2), "reasons logged")

    # blanks, zeros, wrong order, duplicates, other month
    for r, why in ((_corn("Ohio", None, 4.5, -30, 10), "blank"), (_corn("Ohio", 0, 4.5, -30, 10), "zero"),
                   (_corn("Ohio", 4.6, 4.5, -30, 10), "order"), (_corn("Ohio", 4.2, 4.6, -30, 10, month="March (H)", **{"basis Max Futures Month": "December (Z)"}), "two months"),
                   (_corn("Ohio", 4.2, 4.6, -30, 10, **{"sale Type": "Ask"}), "not a bid")):
        c, _ = parse_corn({"Report Header": _hdr("11/02/2026"), "Report Detail": rows + [r]})
        check("OH" not in {x["state"] for x in c["rows"]}, "Ohio dropped: " + why)
    c, n = parse_corn({"Report Header": _hdr("11/02/2026"), "Report Detail": rows + [_corn("Illinois", 4.3575, 4.7775, -12, 30)]})
    check("IL" not in {x["state"] for x in c["rows"]} and any("2 times" in x for x in n), "duplicate state dropped")

    # latest Final day wins; a later day not Final is skipped
    later = [_corn("Illinois", 4.40, 4.80, -12, 28, date="11/03/2026")]
    c, n = parse_corn({"Report Header": _hdr("11/02/2026") + _hdr("11/03/2026", final="Prelim"), "Report Detail": rows + later})
    check(c["report_date"] == "2026-11-02" and any("not Final" in x for x in n), "prelim day skipped")

    # thin: fewer than 3 rows withheld with the reason
    c, _ = parse_corn({"Report Header": _hdr("11/02/2026"), "Report Detail": rows[:2]})
    check("withheld" in c and "Fewer than 3" in c["withheld"] and daily_line(c) is None, "thin corn withheld")
    c, _ = parse_corn({"Report Header": [], "Report Detail": rows})
    check("withheld" in c, "no Final header, withheld")

    # avg outside the range is not shown
    c, _ = parse_corn({"Report Header": _hdr("11/02/2026"), "Report Detail": [
        _corn("Illinois", 4.3575, 4.7775, -12, 30, avg_price=5.5)] + rows[1:]})
    check([r for r in c["rows"] if r["state"] == "IL"][0]["avg"] is None, "average outside the range withheld")

    # co-products, with a year-ago week matched by product and area
    def cp(c, v, area, unit, p, wk="10/26/2026"):
        return {"report_begin_date": wk, "report_end_date": "10/30/2026", "report_date": wk, "commodity": c,
                "variety": v, "trade_loc": area, "price_unit": unit, "price": p, "published_date": "11/02/2026 10:13:08"}
    now_secs = {"Report Header": _hdr("10/26/2026", key="report_begin_date"), "Report Detail": [
        cp("Distillers Grain", "Dried 10%", "Iowa", "$ Per Ton", 170.65), cp("Distillers Grain", "Wet 65-70%", "Iowa", "$ Per Ton", 56),
        cp("Distillers Corn Oil", "N/A", "Iowa", "Cents Per Lb", 68.65), cp("Distillers Grain", "Dried 10%", "Ohio", "$ Per Ton", 0),
        cp("Soybean Meal", "N/A", "Iowa", "$ Per Ton", 343.6), cp("Distillers Grain", "Dried 10%", "Kansas", "$ Per Ton", None)]}
    ya_secs = {"Report Header": _hdr("10/27/2025", key="report_begin_date"), "Report Detail": [
        cp("Distillers Grain", "Dried 10%", "Iowa", "$ Per Ton", 127.5, wk="10/27/2025")]}
    ya_secs["Report Header"] += _hdr("11/03/2025", key="report_begin_date")
    ya_secs["Report Detail"].append(cp("Distillers Grain", "Dried 10%", "Iowa", "$ Per Ton", 140.0, wk="11/03/2025"))
    co, n = parse_coprod(now_secs, ya_secs)
    got = {(r["product"], r["area"]): (r["price"], r["year_ago"]) for r in co["rows"]}
    check(got == {("ddgs", "Iowa"): (170.65, 127.5), ("wdg", "Iowa"): (56, None), ("corn_oil", "Iowa"): (68.65, None)},
          "co-products: %r" % got)
    check(co["week_of"] == "2026-10-26" and co["year_ago_week_of"] == "2025-10-27", "weeks named")
    wrong_ya = {"Report Header": _hdr("06/02/2025", key="report_begin_date"), "Report Detail": [
        cp("Distillers Grain", "Dried 10%", "Iowa", "$ Per Ton", 150, wk="06/02/2025")]}
    co, n = parse_coprod(now_secs, wrong_ya)
    check(all(r["year_ago"] is None for r in co["rows"]) and any("days back" in x for x in n), "a far week is not a year ago")

    # build + live without a key writes nothing; a failed call writes nothing
    data, _ = build({"Report Header": _hdr("11/02/2026"), "Report Detail": rows}, now_secs, ya_secs, now="2026-11-03T00:00:00Z")
    check(data["schema"] == SCHEMA and data["daily_line"] and data["coproducts"]["rows"], "file shape")
    msgs = []
    live("/nonexistent/x.json", key="", log=msgs.append)
    check(msgs and "not set" in msgs[0], "no key: nothing written")

    def boom(u):
        raise urllib.error.HTTPError(u, 401, "no", {}, None)
    msgs = []
    live("/nonexistent/x.json", key="k", opener=boom, log=msgs.append)
    check(msgs and "401" in msgs[0] and "k:" not in msgs[0], "failed call: nothing written, no key in the log")

    # sections(): allSections list, single section, junk
    check(set(sections(json.dumps([{"reportSection": "Report Detail", "results": [{}]}]))) == {"Report Detail"}, "sections list")
    check(sections(b"<html>") == {}, "a web page is not an answer")
    print("fetch_ethanol_mars selftest: %d checks passed" % ok)
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--from-files", nargs="+")
    ap.add_argument("--now")
    a = ap.parse_args(argv)
    if a.selftest:
        return selftest()
    if a.from_files:
        if len(a.from_files) not in (2, 3):
            ap.error("--from-files takes 3617.json 3618.json [3618-year-ago.json]")
        secs = []
        for p in a.from_files:
            with open(p, "rb") as f:
                secs.append(sections(f.read()))
        data, notes = build(secs[0], secs[1], secs[2] if len(secs) > 2 else None, now=a.now)
        for n in notes:
            print("[ethanol] " + n)
        write(a.out, data)
        print("[ethanol] wrote %s" % a.out)
        return 0
    return live(a.out)


if __name__ == "__main__":
    sys.exit(main())
