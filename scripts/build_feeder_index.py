#!/usr/bin/env python3
"""
AGSIST -- data/feeder-index.json: two feeder cattle figures for the cattle
pages (cattle-futures-prices.html, cattle-auction-prices.html, lrp.html),
drawn by components/feeder-index.js. This file computes every number; the
pages only draw them.

1. RMA's feeder steer value. USDA RMA publishes an LRP "actual ending value"
   for every feeder cattle type each trading day (data/lrp/aev.json, from
   scripts/fetch_lrp.py). The type this reads is steers, weight 2 (6.00 to
   10.00 cwt), price adjustment factor 1.00, picked by what the type means in
   data/lrp/meta.json, never by its code (RMA reuses codes from year to year).
   RMA's handbook (FCIC-20010, 2027, section 23C(1)) says LRP feeder cattle
   prices "are based on the CME's Feeder Cattle Contract, which is cash settled
   to the CME Feeder Cattle Index", and that the factors are applied to actual
   ending values before RMA publishes them. The handbook leaves the exact
   definition to the Feeder Cattle endorsement, which our references copy does
   not hold yet (references/sources.json, rma-lrp-feeder-sce). Until it is read,
   RMA_LABEL says what the number is and does not call it the index.
   Beside it: the nearby feeder futures settle for the same day (kept here
   from data/prices.json, which holds only the last few settles), and RMA's
   value minus that settle. A day with no settle held shows no difference.

2. AGSIST feeder cattle prices, by region and weight. A weekly price for
   feeder steers and heifers by 100 lb class (400-499 through 800-899) and
   region, from the USDA AMS barn reports in data/cattle-auction.json
   (scripts/fetch_cattle_auction.py). Medium and Large 1 and 1-2 are pooled,
   rows USDA marks with a note stay out (the barn file already leaves them
   out). The price is weighted by pounds sold (head times weight), so it is
   dollars over hundredweight sold, as on the barn page. Only single-barn
   reports count: USDA's state summaries would count the same cattle twice.
   A week runs Monday to Sunday by sale date; the table shows the latest week
   that has ended. A cell needs MIN_BARNS barns and MIN_HEAD head, else it is
   withheld ("too few sales") with its counts shown. The change from the
   prior week needs both weeks to pass and MIN_BARNS barns that sold in both.
   This is not the CME Feeder Cattle Index and is never called that.
   The barn file keeps only each barn's last two sales, so this file keeps
   its own copy of every barn's sales for KEEP_DAYS (barn_sales) and a short
   history of finished weeks (WEEKS_KEPT).

Modes:
  (default)   read the inputs and the last data/feeder-index.json, write it.
  --selftest  offline tests with hand-worked answers; non-zero exit on failure.
  --check     rebuild in memory from the committed inputs and say whether the
              committed file would change (no write).

Stdlib only.
"""
import datetime
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = "data/feeder-index.json"
AUCTION = "data/cattle-auction.json"
AEV = "data/lrp/aev.json"
META = "data/lrp/meta.json"
PRICES = "data/prices.json"

MIN_BARNS = 3
MIN_HEAD = 300
CLASSES = [400, 500, 600, 700, 800]       # 400 = 400-499 lb
SEXES = ["steers", "heifers"]
KEEP_DAYS = 42           # barn sales kept for recounting a week a late report lands in
WEEKS_KEPT = 26          # finished weeks kept for the short history
RMA_HIST_DAYS = 400      # RMA values kept for the chart
SETTLES_KEPT = 120       # futures settle days kept
RMA_OLD_DAYS = 14        # an RMA value older than this (from the run) is flagged on the page
RMA_LABEL = "RMA's LRP actual ending value, feeder steers 6 to 10 cwt (factor 1.00)"
RMA_SOURCE = "USDA RMA, Livestock Risk Protection actual ending values (ADM livestock files)"
RMA_SOURCE_URL = "https://pubfs-rma.fpac.usda.gov/pub/References/adm_livestock/"
RMA_BASIS_NOTE = ("RMA bases feeder cattle LRP on the CME Feeder Cattle Index, steers 700 to 899 lb "
                  "(LRP Handbook FCIC-20010, 2027, section 23C). The exact definition is in the Feeder "
                  "Cattle endorsement, which we have not read yet, so this page does not call it the index.")

# Regions by the barn's state. A state not listed counts in the national row only.
REGIONS = [
    ("midwest", "Midwest", ["IA", "IL", "IN", "MO", "WI", "MN", "MI", "OH"]),
    ("nplains", "Northern Plains", ["NE", "SD", "ND", "MT", "WY"]),
    ("splains", "Southern Plains", ["KS", "OK", "TX", "NM"]),
    ("southeast", "Southeast", ["AR", "KY", "TN", "VA", "FL", "AL", "GA", "MS", "LA", "NC", "SC", "WV"]),
    ("west", "West", ["CO", "UT", "WA", "ID", "OR", "NV", "AZ", "CA"]),
]
STATE_REGION = {s: rid for rid, _, sts in REGIONS for s in sts}


# ------------------------------------------------------------------ helpers
def load_json(path, default=None):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def iso(d):
    return d.isoformat()


def pdate(s):
    try:
        return datetime.date.fromisoformat(str(s)[:10])
    except ValueError:
        return None


def week_start(d):
    return d - datetime.timedelta(days=d.weekday())


def central_today(now_utc):
    # The barns and AMS run on Central time; six hours back is close enough for a date.
    return (now_utc - datetime.timedelta(hours=6)).date()


def last_full_week(today):
    """Monday of the latest Monday-to-Sunday week that has ended before today."""
    return week_start(today) - datetime.timedelta(days=7)


def pos(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and v > 0


# ------------------------------------------------------------------ barn sales
def sale_cells(sale):
    """One barn sale -> {"steers|400": [head, cwt_total, dollars]} for the classes
    this file uses, grades 1 and 1-2 pooled. The barn file's class price is
    weighted by pounds; dollars = per_head x head and cwt = dollars / price
    rebuild its sums exactly."""
    out = {}
    for key, classes in (sale.get("classes") or {}).items():
        sex, _, grade = key.partition("|")
        if sex not in SEXES or grade not in ("1", "1-2"):
            continue
        for c, cell in (classes or {}).items():
            try:
                ci = int(c)
            except ValueError:
                continue
            if ci not in CLASSES:
                continue
            head, price, ph = cell.get("head"), cell.get("cwt"), cell.get("per_head")
            if not (isinstance(head, int) and head > 0 and pos(price) and pos(ph)):
                continue
            dollars = ph * head
            cwt = dollars / price
            a = out.setdefault("%s|%d" % (sex, ci), [0, 0.0, 0.0])
            a[0] += head
            a[1] += cwt
            a[2] += dollars
    return {k: [v[0], round(v[1], 3), round(v[2], 2)] for k, v in out.items()}


def merge_barn_sales(store, auction, today):
    """Add every sale in the barn file to store {barn_id: {"state", "sales": {date: cells}}}.
    A newer read of the same barn and date replaces the old one. Sales older
    than KEEP_DAYS or dated after today are dropped."""
    lo = today - datetime.timedelta(days=KEEP_DAYS)
    for b in (auction or {}).get("barns") or []:
        bid, st = b.get("id"), b.get("state")
        if not bid or not st:
            continue
        for s in b.get("sales") or []:
            d = pdate(s.get("date"))
            if not d or d < lo or d > today:
                continue
            cells = sale_cells(s)
            if not cells:
                continue
            e = store.setdefault(bid, {"state": st, "sales": {}})
            e["state"] = st
            e["sales"][iso(d)] = cells
    for bid in list(store):
        sales = store[bid]["sales"]
        for d in list(sales):
            dd = pdate(d)
            if not dd or dd < lo:
                del sales[d]
        if not sales:
            del store[bid]
    return store


def week_sums(store, monday):
    """{(sex, region|"us", class): {"head", "cwt", "dollars", "barns": set}} for the week."""
    sunday = monday + datetime.timedelta(days=6)
    acc = {}
    for bid, e in store.items():
        reg = STATE_REGION.get(e["state"])
        for d, cells in e["sales"].items():
            dd = pdate(d)
            if not dd or dd < monday or dd > sunday:
                continue
            for key, (head, cwt, dollars) in cells.items():
                sex, c = key.split("|")
                for r in (["us"] + ([reg] if reg else [])):
                    for cl in (c, "700-899") if c in ("700", "800") else (c,):
                        a = acc.setdefault((sex, r, cl), {"head": 0, "cwt": 0.0, "dollars": 0.0, "barns": set()})
                        a["head"] += head
                        a["cwt"] += cwt
                        a["dollars"] += dollars
                        a["barns"].add(bid)
    return acc


def cell_out(a):
    if not a:
        return {"p": None, "head": 0, "barns": 0, "why": "no sales"}
    n = len(a["barns"])
    ok = n >= MIN_BARNS and a["head"] >= MIN_HEAD and a["cwt"] > 0
    o = {"p": round(a["dollars"] / a["cwt"], 2) if ok else None, "head": a["head"], "barns": n}
    if not ok:
        o["why"] = "too few sales"
    return o


def build_table(store, monday):
    prior = monday - datetime.timedelta(days=7)
    cur, prev = week_sums(store, monday), week_sums(store, prior)
    regions = ["us"] + [r for r, _, _ in REGIONS]
    cls = [str(c) for c in CLASSES] + ["700-899"]
    table = {}
    for sex in SEXES:
        t = table.setdefault(sex, {})
        for r in regions:
            row = t.setdefault(r, {})
            for c in cls:
                a, b = cur.get((sex, r, c)), prev.get((sex, r, c))
                o = cell_out(a)
                po = cell_out(b)
                o["prev"] = po["p"]
                both = len(a["barns"] & b["barns"]) if a and b else 0
                o["both"] = both
                if o["p"] is not None and po["p"] is not None and both >= MIN_BARNS:
                    o["chg"] = round(o["p"] - po["p"], 2)
                else:
                    o["chg"] = None
                row[c] = o
    return table


# ------------------------------------------------------------------ RMA
def steer_type_codes(meta):
    """{reinsurance year: type code} for feeder cattle steers, weight 2, factor 1.00.
    Years whose files did not carry the factor are left out."""
    out = {}
    for ry, types in ((meta or {}).get("types_by_reinsurance_year") or {}).items():
        hits = [k.split("/")[1] for k, v in types.items()
                if k.startswith("0801/") and v.get("ct") == "809" and v.get("cl") == "032"
                and v.get("paf") == "1.00" and (v.get("w") or [None])[0] == "6.00"]
        if len(hits) == 1:
            out[ry] = hits[0]
    return out


def rma_series(aev, meta):
    """{yyyy-mm-dd: $/cwt} across reinsurance years; a day two years disagree on is dropped."""
    codes = steer_type_codes(meta)
    vals, bad = {}, set()
    for ry, comms in ((aev or {}).get("ry") or {}).items():
        t = codes.get(ry)
        fc = (comms or {}).get("0801")
        if not t or not fc or t not in (fc.get("t") or {}):
            continue
        for e, v in zip(fc.get("ends") or [], fc["t"][t]):
            if not isinstance(v, (int, float)) or v <= 0:
                continue
            d = "%s-%s-%s" % (e[:4], e[4:6], e[6:8])
            x = round(v / 1000.0, 2)
            if d in vals and vals[d] != x:
                bad.add(d)
            vals[d] = x
    for d in bad:
        del vals[d]
    return dict(sorted(vals.items())), sorted(bad)


def merge_settles(store, prices):
    """Keep the nearby feeder futures settles: {date: [ticker, settle]}."""
    q = ((prices or {}).get("quotes") or {}).get("feeders-nearby") or {}
    tk = str(q.get("ticker") or "").replace(".CME", "")
    for d, v in (q.get("settles") or {}).items():
        if pdate(d) and pos(v) and tk:
            store[d] = [tk, round(float(v), 3)]
    keep = sorted(store)[-SETTLES_KEPT:]
    return {d: store[d] for d in keep}


def build_rma(aev, meta, settles, today):
    series, bad = rma_series(aev, meta)
    if not series:
        return {"ok": False, "note": "No RMA feeder steer value could be read."}
    last = max(series)
    lo = iso(today - datetime.timedelta(days=RMA_HIST_DAYS))
    hist = [[d, v] for d, v in series.items() if d >= lo]
    o = {"ok": True, "label": RMA_LABEL, "basis_note": RMA_BASIS_NOTE,
         "source": RMA_SOURCE, "source_url": RMA_SOURCE_URL,
         "date": last, "value": series[last], "hist": hist, "dropped_days": bad}
    s = settles.get(last)
    if s:
        o["fut"] = {"ticker": s[0], "settle": s[1], "date": last}
        o["diff"] = round(series[last] - s[1], 2)
    else:
        o["fut"] = None
        o["diff"] = None
        held = sorted(settles)
        o["fut_note"] = ("No futures settle held for %s; we keep settles from %s on." % (last, held[0])) if held \
            else "No futures settle held yet."
    o["stale"] = (today - pdate(last)).days > RMA_OLD_DAYS
    pairs = [[d, v, settles[d][1]] for d, v in hist if d in settles]
    o["diff_hist"] = [[d, round(v - f, 2)] for d, v, f in pairs]
    return o


def build_check(table, rma, monday):
    """AGSIST's national 700-899 lb steer price for the week against the mean
    of RMA's values for that week's days. Withheld under 3 RMA days."""
    cell = table["steers"]["us"]["700-899"]
    sunday = monday + datetime.timedelta(days=6)
    days = [v for d, v in (rma.get("hist") or []) if iso(monday) <= d <= iso(sunday)]
    o = {"week": iso(monday), "agsist": cell["p"], "head": cell["head"], "barns": cell["barns"],
         "rma_days": len(days), "rma": round(sum(days) / len(days), 2) if days else None}
    if cell["p"] is None or len(days) < 3:
        o["gap"] = None
        o["why"] = "too few sales" if cell["p"] is None else "RMA has posted %d day%s for that week" % (len(days), "" if len(days) == 1 else "s")
    else:
        o["gap"] = round(cell["p"] - o["rma"], 2)
    return o


# ------------------------------------------------------------------ build
def build(auction, aev, meta, prices, prev, now_utc):
    today = central_today(now_utc)
    prev = prev or {}
    store = merge_barn_sales(json.loads(json.dumps(prev.get("barn_sales") or {})), auction, today)
    settles = merge_settles(dict(prev.get("settles") or {}), prices)
    monday = last_full_week(today)
    table = build_table(store, monday)
    rma = build_rma(aev, meta, settles, today)
    weeks = {w["start"]: w for w in prev.get("weeks") or []}
    # every week still in the barn store is recounted (late reports); older ones stay as they were
    for k in range(0, KEEP_DAYS // 7):
        m = monday - datetime.timedelta(days=7 * k)
        if m < today - datetime.timedelta(days=KEEP_DAYS):
            break
        t = build_table(store, m) if k else table
        cells = {}
        for sex in SEXES:
            for r, row in t[sex].items():
                for c, o in row.items():
                    if o["p"] is not None:
                        cells["%s|%s|%s" % (sex, r, c)] = [o["p"], o["head"], o["barns"]]
        if cells:
            weeks[iso(m)] = {"start": iso(m), "cells": cells}
        else:
            weeks.pop(iso(m), None)
    weeks = [weeks[k] for k in sorted(weeks)][-WEEKS_KEPT:]
    auction_ok = bool((auction or {}).get("barns"))
    return {
        "v": 1,
        "updated": now_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "auction": {
            "name": "AGSIST feeder cattle prices, by region and weight",
            "week": {"start": iso(monday), "end": iso(monday + datetime.timedelta(days=6))},
            "prior": {"start": iso(monday - datetime.timedelta(days=7)), "end": iso(monday - datetime.timedelta(days=1))},
            "classes": [str(c) for c in CLASSES] + ["700-899"],
            "regions": [{"id": "us", "name": "All barns", "states": []}] +
                       [{"id": r, "name": n, "states": [s for s in sts if any(e["state"] == s for e in store.values())]}
                        for r, n, sts in REGIONS],
            "gates": {"barns": MIN_BARNS, "head": MIN_HEAD},
            "table": table,
            "source": "USDA AMS auction reports, as read for /cattle-auction-prices (data/cattle-auction.json)",
            "source_updated": (auction or {}).get("updated"),
            "ok": auction_ok,
            "barns_held": len(store),
        },
        "rma": rma,
        "check": build_check(table, rma, monday) if rma.get("ok") else None,
        "weeks": weeks,
        "settles": settles,
        "barn_sales": {k: store[k] for k in sorted(store)},
    }


def read_inputs(root):
    return (load_json(root / AUCTION), load_json(root / AEV), load_json(root / META),
            load_json(root / PRICES), load_json(root / OUT))


def write(root, doc):
    path = root / OUT
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(doc, separators=(",", ":"), ensure_ascii=False) + "\n")
    os.replace(tmp, path)


# ------------------------------------------------------------------ selftest
def selftest():
    fails = []

    def ck(name, cond):
        print(("ok   " if cond else "FAIL ") + name)
        if not cond:
            fails.append(name)

    D = datetime.date
    # week boundaries: Monday to Sunday; the shown week is the last one that ended
    ck("week starts Monday", week_start(D(2026, 10, 18)) == D(2026, 10, 12) and week_start(D(2026, 10, 19)) == D(2026, 10, 19))
    ck("shown week on a Wednesday is last week", last_full_week(D(2026, 10, 21)) == D(2026, 10, 12))
    ck("shown week on a Monday is the week just ended", last_full_week(D(2026, 10, 19)) == D(2026, 10, 12))
    ck("shown week on a Sunday is the week before", last_full_week(D(2026, 10, 18)) == D(2026, 10, 5))
    ck("central date: 03:00 UTC Tuesday is Monday", central_today(datetime.datetime(2026, 10, 20, 3, 0)) == D(2026, 10, 19))

    # one sale: pooled grades, pounds weighting rebuilt from per_head and price
    sale = {"date": "2026-10-14", "classes": {
        "steers|1": {"700": {"head": 100, "avg_wt": 750, "cwt": 340.0, "per_head": 2550.0},
                     "300": {"head": 50, "avg_wt": 350, "cwt": 450.0, "per_head": 1575.0}},
        "steers|1-2": {"700": {"head": 50, "avg_wt": 780, "cwt": 330.0, "per_head": 2574.0}},
        "heifers|2": {"700": {"head": 40, "avg_wt": 720, "cwt": 300.0, "per_head": 2160.0}},
        "bulls|1": {"700": {"head": 40, "avg_wt": 720, "cwt": 300.0, "per_head": 2160.0}}}}
    c = sale_cells(sale)
    ck("300 lb class and other grades and sexes left out", set(c) == {"steers|700"})
    # 100 x 7.5 cwt = 750 cwt at $340 = $255,000; 50 x 7.8 = 390 cwt at $330 = $128,700
    ck("pooled head and cwt", c["steers|700"][0] == 150 and abs(c["steers|700"][1] - 1140.0) < 1e-6)
    ck("pooled dollars", abs(c["steers|700"][2] - 383700.0) < 1e-6)
    # weighted by pounds: 383700 / 1140 = 336.58; a plain head-weighted mean would be 336.67
    ck("pounds-weighted price", round(c["steers|700"][2] / c["steers|700"][1], 2) == 336.58)
    ck("a zero or missing price is skipped",
       sale_cells({"classes": {"steers|1": {"500": {"head": 10, "cwt": 0, "per_head": 100.0},
                                            "600": {"head": 10, "cwt": 300.0}}}}) == {})

    # region mapping
    ck("IA is Midwest, NE Northern Plains, OK Southern Plains, TN Southeast, CO West",
       [STATE_REGION.get(s) for s in ("IA", "NE", "OK", "TN", "CO")] == ["midwest", "nplains", "splains", "southeast", "west"])
    ck("an unmapped state counts nationally only", STATE_REGION.get("PR") is None)

    def barn(i, st, date, head, price, wt=750, cls="700", sex="steers", grade="1"):
        return {"id": "b%d" % i, "state": st, "sales": [{"date": date, "classes": {
            "%s|%s" % (sex, grade): {cls: {"head": head, "avg_wt": wt, "cwt": price, "per_head": round(price * wt / 100.0, 2)}}}}]}

    now = datetime.datetime(2026, 10, 21, 15, 0)   # Wednesday; shown week Oct 12-18
    auc = {"updated": "2026-10-21T14:00:00Z", "barns": [
        barn(1, "IA", "2026-10-13", 120, 340.0),
        barn(2, "IA", "2026-10-15", 100, 330.0),
        barn(3, "IL", "2026-10-17", 90, 350.0),
        barn(4, "NE", "2026-10-14", 400, 345.0),
        barn(5, "NE", "2026-10-19", 50, 999.0),     # next week: not in the shown week
        barn(6, "PR", "2026-10-16", 10, 200.0),     # unmapped: national row only
        barn(7, "IA", "2026-10-11", 300, 300.0),    # Sunday before: prior week
        barn(8, "IA", "2024-11-02", 300, 100.0),    # stale: dropped
    ]}
    doc = build(auc, None, None, None, None, now)
    t = doc["auction"]["table"]["steers"]
    mw = t["midwest"]["700"]
    ck("Midwest 700: three barns, 310 head", mw["barns"] == 3 and mw["head"] == 310)
    # pounds: 120x7.5=900, 100x7.5=750, 90x7.5=675 cwt; $ = 306000+247500+236250 = 789750 / 2325 = 339.68
    ck("Midwest 700 price, pounds-weighted", mw["p"] == 339.68)
    ck("Midwest 700-899 slice equals 700 when 800 is empty", t["midwest"]["700-899"]["p"] == 339.68)
    np_ = t["nplains"]["700"]
    ck("Northern Plains: one barn with 400 head is withheld", np_["p"] is None and np_["why"] == "too few sales" and np_["head"] == 400 and np_["barns"] == 1)
    us = t["us"]["700"]
    ck("national row: barns 1-4 and the unmapped one", us["barns"] == 5 and us["head"] == 720)
    ck("Sunday Oct 11 sale is prior week, not this one", t["midwest"]["700"]["prev"] is None)
    ck("no change without a passing prior week", mw["chg"] is None)
    ck("stale sale not kept", "b8" not in doc["barn_sales"])
    ck("next week's sale kept for later", "b5" in doc["barn_sales"])
    ck("an empty cell says no sales", t["west"]["500"] == {"p": None, "head": 0, "barns": 0, "why": "no sales", "prev": None, "both": 0, "chg": None})

    # under the head gate with enough barns: withheld
    small = {"barns": [barn(i, "KS", "2026-10-14", 50, 300.0) for i in range(1, 6)]}
    s = build(small, None, None, None, None, now)["auction"]["table"]["steers"]["splains"]["700"]
    ck("five barns, 250 head: withheld", s["p"] is None and s["barns"] == 5 and s["head"] == 250)
    edge = {"barns": [barn(1, "KS", "2026-10-14", 100, 300.0), barn(2, "OK", "2026-10-14", 100, 300.0), barn(3, "TX", "2026-10-14", 100, 300.0)]}
    e = build(edge, None, None, None, None, now)["auction"]["table"]["steers"]["splains"]["700"]
    ck("exactly 3 barns and 300 head: shown", e["p"] == 300.0)

    # change from the prior week: carried in the barn store from an earlier run
    prev_auc = {"barns": [barn(1, "IA", "2026-10-06", 120, 330.0), barn(2, "IA", "2026-10-08", 100, 320.0),
                          barn(3, "IL", "2026-10-10", 90, 340.0)]}
    first = build(prev_auc, None, None, None, None, datetime.datetime(2026, 10, 14, 15, 0))
    second = build(auc, None, None, None, first, now)
    m2 = second["auction"]["table"]["steers"]["midwest"]["700"]
    # prior week Oct 5-11: barns 1-3 from the first run plus barn 7 (Sunday Oct 11) from this one:
    # 900x330 + 750x320 + 675x340 + 2250x300 = 1,441,500 / 4,575 cwt = 315.08
    ck("prior week from the kept store", m2["prev"] == 315.08 and m2["both"] == 3)
    ck("change = this week minus prior", m2["chg"] == 24.6)
    ck("finished weeks kept in history", [w["start"] for w in second["weeks"]] == ["2026-10-05", "2026-10-12"])
    ck("history cell carries price, head, barns", second["weeks"][-1]["cells"]["steers|midwest|700"] == [339.68, 310, 3])
    # same barns but only two sold both weeks: no change
    third_auc = {"barns": [barn(1, "IA", "2026-10-13", 120, 340.0), barn(2, "IA", "2026-10-15", 100, 330.0),
                           barn(9, "IL", "2026-10-17", 90, 350.0)]}
    third = build(third_auc, None, None, None, first, now)["auction"]["table"]["steers"]["midwest"]["700"]
    ck("change needs 3 barns that sold both weeks", third["both"] == 2 and third["chg"] is None and third["p"] is not None)
    # a re-read of the same barn and date replaces it, never doubles it
    again = build(auc, None, None, None, second, now)["auction"]["table"]["steers"]["midwest"]["700"]
    ck("re-reading the same sales does not double count", again["head"] == 310 and again["p"] == 339.68)

    # RMA: the type is picked by what it means, not by its code
    meta = {"types_by_reinsurance_year": {
        "2026": {"0801/809": {"ct": "809", "cl": "031", "paf": "1.10", "w": ["1.00", "5.99"]},
                 "0801/810": {"ct": "809", "cl": "032", "paf": "1.00", "w": ["6.00", "10.00"]}},
        "2027": {"0801/809": {"ct": "809", "cl": "032", "paf": "1.00", "w": ["6.00", "10.00"]},
                 "0801/810": {"ct": "809", "cl": "031", "paf": "1.10", "w": ["1.00", "5.99"]}},
        "2025": {"0801/810": {"ct": "809", "cl": "032", "paf": None, "w": ["6.00", "10.00"]}}}}
    ck("type codes by meaning", steer_type_codes(meta) == {"2026": "810", "2027": "809"})
    aev = {"units": "dollars per cwt x 1000", "ry": {
        "2025": {"0801": {"ends": ["20250601"], "t": {"810": [300000]}}},
        "2026": {"0801": {"ends": ["20261008", "20261009", "20261012"], "t": {"809": [373000, 374000, 375000], "810": [339090, 340000, 341470]}}},
        "2027": {"0801": {"ends": ["20261009", "20261012"], "t": {"809": [340000, 341470], "810": [374000, 375620]}}}}}
    ser, bad = rma_series(aev, meta)
    ck("RMA values in $/cwt, both years agree", ser == {"2026-10-08": 339.09, "2026-10-09": 340.0, "2026-10-12": 341.47} and bad == [])
    ck("a year without the factor is not used", "2025-06-01" not in ser)
    aev2 = json.loads(json.dumps(aev))
    aev2["ry"]["2027"]["0801"]["t"]["809"][1] = 341000
    ser2, bad2 = rma_series(aev2, meta)
    ck("a day two years disagree on is dropped", "2026-10-12" not in ser2 and bad2 == ["2026-10-12"])
    prices = {"quotes": {"feeders-nearby": {"ticker": "GFV26.CME", "settles": {"2026-10-09": 338.5, "2026-10-12": 340.0}}}}
    st = merge_settles({}, prices)
    ck("settles kept with their contract", st == {"2026-10-09": ["GFV26", 338.5], "2026-10-12": ["GFV26", 340.0]})
    r = build_rma(aev, meta, st, D(2026, 10, 21))
    ck("RMA latest value and date", r["date"] == "2026-10-12" and r["value"] == 341.47)
    ck("difference = RMA value minus the same day's settle", r["diff"] == 1.47 and r["fut"]["ticker"] == "GFV26")
    ck("difference history only on days with a settle", r["diff_hist"] == [["2026-10-09", 1.5], ["2026-10-12", 1.47]])
    ck("label does not call it the index", "index" not in r["label"].lower())
    r2 = build_rma(aev, meta, {"2026-10-15": ["GFV26", 343.375]}, D(2026, 10, 21))
    ck("no settle for the day: no difference, and says why", r2["diff"] is None and "2026-10-12" in r2["fut_note"])
    ck("fresh value not flagged; an old one is", r["stale"] is False and build_rma(aev, meta, st, D(2026, 11, 2))["stale"] is True)
    ck("no RMA data: not ok with a note", build_rma(None, None, {}, D(2026, 10, 21))["ok"] is False)

    # the RMA chain from a real RMA file through scripts/fetch_lrp.py
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import fetch_lrp as FL  # noqa: E402
    fx = ROOT / "test/fixtures/lrp/2026_A00620_LrpActualEndingValue_Daily_20261015.txt"
    new, _, _ = FL.reduce_aev(fx.read_text())
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        os.makedirs(os.path.join(td, "aev"))
        FL.write_json(os.path.join(td, "aev", "2026.json"), FL.compact_aev(new))
        real = FL.build_aev(td)
    # in this file, type 809 is RY2026 steers weight 1 (factor 1.10): not ours
    meta_real = {"types_by_reinsurance_year": {"2026": {"0801/809": {"ct": "809", "cl": "031", "paf": "1.10", "w": ["1.00", "5.99"]}}}}
    ck("real RMA file: a factor 1.10 type is not read", rma_series(real, meta_real)[0] == {})
    meta_as = {"types_by_reinsurance_year": {"2026": {"0801/809": {"ct": "809", "cl": "032", "paf": "1.00", "w": ["6.00", "10.00"]}}}}
    ck("real RMA file: 370.400 reads as $370.40 for Oct 7", rma_series(real, meta_as)[0] == {"2026-10-07": 370.4})

    # the sanity check against RMA
    tb = build(auc, None, None, None, None, now)["auction"]["table"]
    hist = {"hist": [["2026-10-12", 340.0], ["2026-10-13", 341.0], ["2026-10-14", 342.0]]}
    chk = build_check(tb, hist, D(2026, 10, 12))
    ck("check: national 700-899 vs mean RMA for the week", chk["rma"] == 341.0 and chk["rma_days"] == 3 and chk["gap"] == round(tb["steers"]["us"]["700-899"]["p"] - 341.0, 2))
    chk2 = build_check(tb, {"hist": [["2026-10-12", 340.0]]}, D(2026, 10, 12))
    ck("check withheld under 3 RMA days", chk2["gap"] is None and "1 day" in chk2["why"])

    print("FAILS=%d" % len(fails))
    return 1 if fails else 0


def main(argv):
    if "--selftest" in argv:
        return selftest()
    now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    doc = build(*read_inputs(ROOT), now)
    if "--check" in argv:
        print("rma", doc["rma"].get("date"), doc["rma"].get("value"), "week", doc["auction"]["week"])
        return 0
    write(ROOT, doc)
    a = doc["auction"]
    shown = sum(1 for sex in SEXES for r in a["table"][sex].values() for o in r.values() if o["p"] is not None)
    print("feeder-index: week %s, %d cells shown, %d barns held; RMA %s %s" % (
        a["week"]["start"], shown, a["barns_held"], doc["rma"].get("date"), doc["rma"].get("value")))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
