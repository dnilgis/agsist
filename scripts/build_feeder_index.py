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

3. The AGSIST USDA feeder steer index: ONE national weekly price, the
   headline of the three boxes. Steers 700 to 899 lb, Medium and Large 1 and
   1-2, every single-barn USDA AMS report in the barn store, weighted by
   pounds sold (the 700-799 and 800-899 classes pooled by their dollars and
   hundredweights, so it equals the table's national 700-899 steer line).
   Why 700 to 899 lb: it is the yearling that goes on feed, the weight RMA's
   steer value beside it covers (6 to 10 cwt), and every week of the record
   has 55 or more barns selling it; the 500s sell more head but those are
   calves most often headed to grass or a backgrounder first.
   A week is published only if IDX_MIN_BARNS barns in IDX_MIN_STATES states
   sold IDX_MIN_HEAD head and no one state sold more than IDX_MAX_STATE_SHARE
   of the head; otherwise it is withheld with its counts and the reasons.
   Set from the data (Oct 12 to Nov 1, 2026: 55 to 89 barns, 15 to 17
   states, 9,600 to 14,600 head a week; Oklahoma the largest at 27 to 33%).
   Drawing 30 of a week's barns at random moved the figure by about $2 (one
   standard deviation) and 10 barns by $5 to $6, so 30 barns is the floor;
   8 states keeps a holiday week with one region open from standing in for
   the country.
   Beside each week: how far it moves when its barns are redrawn (IDX_DRAWS
   draws with replacement, seeded by the week, the 5th to 95th percentile),
   and the change from the prior week only when both weeks pass and
   IDX_MIN_BARNS barns sold in both, with its own redrawn range over the
   barns of both weeks. A change whose range takes in zero is "no clear
   change", whatever its sign.
   Weekly only, no daily rolling figure: each barn sells on its own weekday,
   so a day's figure is a different set of barns, and about 1 in 10 sales in
   the record reached us 4 to 8 days after the sale (measured on the
   committed barn file, Oct 17 to 31), so a 7-day window ending yesterday
   would be revised most days. A week is marked final IDX_FINAL_DAYS days
   after it ends; before that it says late reports can still land.
   History: every finished week from IDX_START (the week our barn reads
   began, Oct 16, 2026; earlier weeks hold only the last two sales each barn
   had then, so they are not a full count) is kept in index.weeks forever.
   A week is recounted while it and the week before it are both inside the
   barn store (KEEP_DAYS); after that it stays as it was published.
   Backfill: the committed data/cattle-auction.json on main goes back to
   Oct 16, 2026 (27 versions checked Nov 2) and the raw branch holds only the
   latest report per barn; every sale in those versions is in barn_sales.
   No CME data is read or compared here (Oct 29).
   Live reads through USDA My Market News (Nov 2 2026):
   with MARS_API_KEY set, read_mars reads every single-barn report of the last
   KEEP_DAYS through MARS with the past weeks' own reader (backfill_feeder_index
   mars_fetch), and a barn's PDF read counts only for a barn and week MARS lacks
   (resolve_store, the rule combined_sales builds the past weeks by). Each stored
   sale says how it was read (barn_sales: a "pdf" list per barn; the rest came
   through MARS) and each live week counts its barns by it ("via"). Two sales of
   one barn in one week with the very same cells are one sale read twice and count
   once (Oklahoma City, weeks of Oct 19 and 26 2026). No key, or no answer: the
   PDF reads stand.
   Before IDX_START: data/feeder-index-history.json (build_history, run by
   scripts/backfill_feeder_index.py from archived copies of the same USDA
   reports, feeder-history.yml). Same index_week and index_change, only weeks
   before IDX_START, so a live week is never replaced by an archive read; each
   week says where it came from and when it was read. The page loads it only
   when the record fold opens.

Modes:
  (default)   read the inputs and the last data/feeder-index.json, write it.
  --selftest  offline tests with hand-worked answers; non-zero exit on failure.
  --check     rebuild in memory from the committed inputs and say whether the
              committed file would change (no write).

Stdlib only.
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import datetime
import json
import os
import random
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

IDX_NAME = "AGSIST USDA feeder steer index"
IDX_LABEL = "AGSIST USDA feeder steer index, not the CME index"
IDX_CLASSES = ("700", "800")   # 700-899 lb steers
IDX_MIN_BARNS = 30
IDX_MIN_HEAD = 4000
IDX_MIN_STATES = 8
IDX_MAX_STATE_SHARE = 0.5
IDX_START = datetime.date(2026, 10, 12)
IDX_FINAL_DAYS = 10
IDX_DRAWS = 1000

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


def load_store(saved):
    """The committed barn_sales -> the working store {barn_id: {"state", "sales": {date: cells},
    "via": {date: "mars"|"pdf"}}}. On file a barn lists only the dates read from its own PDF
    ("pdf"); every other date came through My Market News. A file from before Nov 3 2026
    (no "pdf" list anywhere) was read from the PDFs only."""
    store = json.loads(json.dumps(saved or {}))
    old = not any("pdf" in (e or {}) for e in store.values())
    for e in store.values():
        pdf = set(e.pop("pdf", None) or [])
        e["via"] = {d: ("pdf" if old or d in pdf else "mars") for d in e.get("sales") or {}}
    return store


def save_store(store):
    """The working store -> the compact form kept in the file (see load_store)."""
    out = {}
    for bid in sorted(store):
        e = store[bid]
        o = {"state": e["state"], "sales": {d: e["sales"][d] for d in sorted(e["sales"])}}
        o["pdf"] = sorted(d for d in e["sales"] if (e.get("via") or {}).get(d, "pdf") == "pdf")
        out[bid] = o
    return out


def merge_barn_sales(store, auction, today):
    """Add every sale in the barn file to store {barn_id: {"state", "sales": {date: cells}, "via"}}.
    A newer read of the same barn and date replaces the old one, but never a sale read
    through My Market News (resolve_store). Sales older than KEEP_DAYS or dated after today
    are dropped."""
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
            e = store.setdefault(bid, {"state": st, "sales": {}, "via": {}})
            e.setdefault("via", {})
            e["state"] = st
            if e["via"].get(iso(d)) == "mars":
                continue
            e["sales"][iso(d)] = cells
            e["via"][iso(d)] = "pdf"
    return prune_store(store, lo)


def prune_store(store, lo):
    for bid in list(store):
        sales, via = store[bid]["sales"], store[bid].setdefault("via", {})
        for d in list(sales):
            dd = pdate(d)
            if not dd or dd < lo:
                del sales[d]
        for d in list(via):
            if d not in sales:
                del via[d]
        if not sales:
            del store[bid]
    return store


def merge_mars_sales(store, mars, today):
    """Add the sales read through USDA My Market News (MARS; scripts/backfill_feeder_index.py
    mars_fetch, the same reader the past weeks use) to the store, marked "mars". A MARS sale
    replaces a PDF read of the same barn and date. mars: {"sales": [summarize() + barn,
    state]} or None (no key, or MARS did not answer: the PDF reads stand, fail soft)."""
    lo = today - datetime.timedelta(days=KEEP_DAYS)
    for s in (mars or {}).get("sales") or []:
        d = pdate(s.get("date"))
        bid, st = s.get("barn"), s.get("state")
        if not d or not bid or not st or d < lo or d > today:
            continue
        cells = sale_cells(s)
        if not cells:
            continue
        e = store.setdefault(bid, {"state": st, "sales": {}, "via": {}})
        e.setdefault("via", {})
        e["state"] = st
        e["sales"][iso(d)] = cells
        e["via"][iso(d)] = "mars"
    return store


def resolve_store(store):
    """One barn, one week: when My Market News holds any sale of a barn in a week, that
    week's sales of the barn read from its PDF are dropped (MARS first, the PDF only for a
    barn and week MARS lacks; the rule the past weeks are built by,
    backfill_feeder_index.combined_sales). Then two sales of one barn in one week with the
    very same cells are one sale read twice (Oklahoma City, weeks of Oct 19 and 26 2026:
    the Monday Preliminary and the Tuesday Final of one sale, both kept): the earlier date
    stays. -> [(barn, date dropped, why)]."""
    dropped = []
    for bid in sorted(store):
        e = store[bid]
        via = e.setdefault("via", {})
        weeks = {}
        for d in e["sales"]:
            dd = pdate(d)
            if dd:
                weeks.setdefault(week_start(dd), []).append(d)
        for w, ds in sorted(weeks.items()):
            if any(via.get(d) == "mars" for d in ds):
                for d in ds:
                    if via.get(d, "pdf") != "mars":
                        dropped.append((bid, d, "My Market News holds this barn's week"))
                        del e["sales"][d]
                        via.pop(d, None)
                ds = [d for d in ds if d in e["sales"]]
            seen = {}
            for d in sorted(ds):
                k = json.dumps(e["sales"][d], sort_keys=True)
                if k in seen:
                    dropped.append((bid, d, "same cells as the sale of %s" % seen[k]))
                    del e["sales"][d]
                    via.pop(d, None)
                else:
                    seen[k] = d
    return dropped


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


# ------------------------------------------------------------------ the index
def index_barns(store, monday):
    """{barn_id: [head, cwt, dollars, state]} for 700-899 lb steers sold that week."""
    sunday = monday + datetime.timedelta(days=6)
    out = {}
    for bid, e in store.items():
        for d, cells in e["sales"].items():
            dd = pdate(d)
            if not dd or dd < monday or dd > sunday:
                continue
            for c in IDX_CLASSES:
                v = cells.get("steers|" + c)
                if not v:
                    continue
                a = out.setdefault(bid, [0, 0.0, 0.0, e["state"]])
                a[0] += v[0]
                a[1] += v[1]
                a[2] += v[2]
    return out


def pctl(xs, q):
    """Nearest-rank percentile of a sorted list."""
    return xs[min(len(xs) - 1, max(0, int(round(q * (len(xs) - 1)))))]


def week_seed(monday, salt=0):
    return int(monday.strftime("%Y%m%d")) * 10 + salt


def redraw_range(barns, monday):
    """5th to 95th percentile of the pounds-weighted price over IDX_DRAWS draws
    of the week's barns with replacement."""
    ids = sorted(barns)
    rng = random.Random(week_seed(monday))
    xs = []
    for _ in range(IDX_DRAWS):
        cwt = dollars = 0.0
        for _ in ids:
            b = barns[ids[rng.randrange(len(ids))]]
            cwt += b[1]
            dollars += b[2]
        xs.append(dollars / cwt)
    xs.sort()
    return round(pctl(xs, 0.05), 2), round(pctl(xs, 0.95), 2)


def change_range(cur, prev, monday):
    """5th to 95th percentile of this week minus the prior week when the barns of
    both weeks are drawn together (a barn keeps its sales in each week)."""
    ids = sorted(set(cur) | set(prev))
    rng = random.Random(week_seed(monday, 1))
    xs = []
    for _ in range(IDX_DRAWS):
        c = [0.0, 0.0]
        p = [0.0, 0.0]
        for _ in ids:
            bid = ids[rng.randrange(len(ids))]
            if bid in cur:
                c[0] += cur[bid][1]
                c[1] += cur[bid][2]
            if bid in prev:
                p[0] += prev[bid][1]
                p[1] += prev[bid][2]
        if c[0] > 0 and p[0] > 0:
            xs.append(c[1] / c[0] - p[1] / p[0])
    xs.sort()
    return round(pctl(xs, 0.05), 2), round(pctl(xs, 0.95), 2)


def index_week(store, monday, today):
    """One week of the index, published or withheld with its counts and reasons."""
    sunday = monday + datetime.timedelta(days=6)
    b = index_barns(store, monday)
    head = sum(v[0] for v in b.values())
    cwt = sum(v[1] for v in b.values())
    dollars = sum(v[2] for v in b.values())
    by_state = {}
    for v in b.values():
        by_state[v[3]] = by_state.get(v[3], 0) + v[0]
    top = sorted(by_state.items(), key=lambda kv: (-kv[1], kv[0]))
    o = {"start": iso(monday), "end": iso(sunday), "p": None, "barns": len(b), "head": head,
         "states": len(by_state), "avg_wt": int(round(cwt * 100 / head)) if head else None,
         "top": [[st, int(round(100.0 * h / head))] for st, h in top[:3]] if head else [],
         "final": (today - sunday).days > IDX_FINAL_DAYS}
    why = []
    if len(b) < IDX_MIN_BARNS:
        why.append("%d barns, %d needed" % (len(b), IDX_MIN_BARNS))
    if head < IDX_MIN_HEAD:
        why.append("%s head, %s needed" % (format(head, ","), format(IDX_MIN_HEAD, ",")))
    if len(by_state) < IDX_MIN_STATES:
        why.append("%d state%s, %d needed" % (len(by_state), "" if len(by_state) == 1 else "s", IDX_MIN_STATES))
    if head and top[0][1] > IDX_MAX_STATE_SHARE * head:
        why.append("%s sold %d%% of the head, %d%% at most" % (top[0][0], round(100.0 * top[0][1] / head), round(100 * IDX_MAX_STATE_SHARE)))
    if why or cwt <= 0:
        o["why"] = why or ["no sales"]
        return o, b
    o["p"] = round(dollars / cwt, 2)
    o["lo"], o["hi"] = redraw_range(b, monday)
    return o, b


def index_change(o, b, po, pb, monday):
    """Change from the prior week, only when both pass and IDX_MIN_BARNS sold both."""
    both = len(set(b) & set(pb))
    o["both"] = both
    o["chg"] = None
    if o["p"] is None or po is None or po.get("p") is None:
        o["chg_why"] = ("this week withheld" if o["p"] is None else
                        "first week of the record" if po is None else "prior week withheld")
        return o
    if both < IDX_MIN_BARNS:
        o["chg_why"] = "%d barns sold both weeks, %d needed" % (both, IDX_MIN_BARNS)
        return o
    o["chg"] = round(o["p"] - po["p"], 2)
    o["chg_lo"], o["chg_hi"] = change_range(b, pb, monday)
    o["move"] = "up" if o["chg_lo"] > 0 else "down" if o["chg_hi"] < 0 else "flat"
    return o


def build_index(store, prev_weeks, monday, today):
    """Every finished week from IDX_START to monday. A week is recounted while it
    and the week before are inside the barn store; older weeks keep what was
    published (prev_weeks, {start: week})."""
    lo = today - datetime.timedelta(days=KEEP_DAYS)
    weeks = []
    m = IDX_START
    while m <= monday:
        pm = m - datetime.timedelta(days=7)
        if pm >= lo:
            o, b = index_week(store, m, today)
            po, pb = index_week(store, pm, today) if m > IDX_START else (None, {})
            o = index_change(o, b, po, pb, m)
            o["via"] = week_via(store, b, m, "pdf")   # barns read through My Market News or from their PDF
            weeks.append(o)
        elif iso(m) in prev_weeks:
            w = dict(prev_weeks[iso(m)])
            w["final"] = (today - (m + datetime.timedelta(days=6))).days > IDX_FINAL_DAYS
            weeks.append(w)
        else:
            weeks.append({"start": iso(m), "end": iso(m + datetime.timedelta(days=6)), "p": None,
                          "barns": 0, "head": 0, "states": 0, "avg_wt": None, "top": [], "final": True,
                          "why": ["not held"], "both": 0, "chg": None, "chg_why": "this week withheld"})
        m += datetime.timedelta(days=7)
    ok = [w["start"] for w in weeks if w["p"] is not None]
    return {
        "name": IDX_NAME, "label": IDX_LABEL,
        "what": "Feeder steers 700 to 899 lb, Medium and Large 1 and 1-2, $/cwt, weighted by pounds sold",
        "gates": {"barns": IDX_MIN_BARNS, "head": IDX_MIN_HEAD, "states": IDX_MIN_STATES,
                  "max_state_pct": int(round(100 * IDX_MAX_STATE_SHARE))},
        "draws": IDX_DRAWS, "final_days": IDX_FINAL_DAYS, "start": iso(IDX_START),
        "latest": weeks[-1]["start"] if weeks else None,
        "last_ok": ok[-1] if ok else None,
        "weeks": weeks,
    }


# ------------------------------------------------------------------ history from the archive
HISTORY = "data/feeder-index-history.json"
FAR = datetime.date(2100, 1, 1)   # archive weeks are long over: every one is final


def history_store(sales):
    """Archived barn sales -> the same store merge_barn_sales keeps:
    {barn_id: {"state", "sales": {date: cells}}}. Each sale is one report's
    summarize() (scripts/fetch_cattle_auction.py) plus "barn" and "state". A barn
    with two reports dated the same day (a reissued report) keeps the one with
    more head, so a sale is never counted twice."""
    store = {}
    for s in sales or []:
        d = pdate(s.get("date"))
        bid, st = s.get("barn"), s.get("state")
        if not d or not bid or not st:
            continue
        cells = sale_cells(s)
        if not cells:
            continue
        e = store.setdefault(bid, {"state": st, "sales": {}, "via": {}})
        old = e["sales"].get(iso(d))
        if old is not None:
            if sum(v[0] for v in old.values()) > sum(v[0] for v in cells.values()) or \
               (sum(v[0] for v in old.values()) == sum(v[0] for v in cells.values()) and
                    json.dumps(old, sort_keys=True) <= json.dumps(cells, sort_keys=True)):
                continue
        e["sales"][iso(d)] = cells
        if s.get("via"):
            e["via"][iso(d)] = s["via"]
    return store


def week_via(store, b, monday, default="archive"):
    """{how read: barns} for the barns counted in one week (b from index_week)."""
    sunday = monday + datetime.timedelta(days=6)
    out = {}
    for bid in b:
        vs = {v for d, v in (store[bid].get("via") or {}).items() if pdate(d) and monday <= pdate(d) <= sunday}
        for v in vs or {default}:
            out[v] = out.get(v, 0) + 1
    return out


def _same_week(a, b):
    return {k: v for k, v in a.items() if k != "read"} == {k: v for k, v in b.items() if k != "read"}


def build_history(store, prev, read_date, source, live_start=IDX_START):
    """Past weeks of the index from archived reports, by the same rules as the
    live record (index_week, index_change). Only weeks before live_start: the
    live record (data/feeder-index.json) is never overwritten by an archive
    read. A week whose numbers did not change keeps its first read date, so a
    re-run changes nothing; weeks this store does not reach stay as they were."""
    prev_weeks = {w["start"]: w for w in ((prev or {}).get("weeks") or [])}
    days = sorted(pdate(d) for e in store.values() for d in e["sales"])
    days = [d for d in days if d and d < live_start]
    new = {}
    if days:
        first = week_start(days[0])
        m = first
        while m < live_start:
            o, b = index_week(store, m, FAR)
            pm = m - datetime.timedelta(days=7)
            po, pb = index_week(store, pm, FAR) if m > first else (None, {})
            o = index_change(o, b, po, pb, m)
            o["from"] = "archive"
            if any(e.get("via") for e in store.values()):
                o["via"] = week_via(store, b, m)
            o["read"] = read_date
            old = prev_weeks.get(o["start"])
            if old and _same_week(old, o):
                o["read"] = old["read"]
            new[o["start"]] = o
            m += datetime.timedelta(days=7)
    weeks = dict(prev_weeks)
    weeks.update(new)
    out = [weeks[k] for k in sorted(weeks) if pdate(k) and pdate(k) < live_start]
    ok = [w for w in out if w.get("p") is not None]
    reads = sorted({w.get("read") for w in out if w.get("read")})
    return {
        "v": 1, "name": IDX_NAME, "label": IDX_LABEL,
        "what": "Past weeks of the index, figured from USDA's archived barn reports by the same rules as the live record",
        "source": source,
        "read": reads[-1] if reads else None, "first_read": reads[0] if reads else None,
        "start": out[0]["start"] if out else None, "end": out[-1]["end"] if out else None,
        "live_start": iso(live_start),
        "weeks_ok": len(ok), "barns": len(store),
        "weeks": out,
    }


def write_history(root, doc):
    path = Path(root) / HISTORY
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "w") as f:
        f.write(json.dumps(doc, separators=(",", ":"), ensure_ascii=False) + "\n")
    os.replace(tmp, path)


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


def build_check(cell, rma, monday):
    """The index for the week (cell: p, head, barns) against the mean of RMA's
    values for that week's days. Withheld under 3 RMA days."""
    sunday = monday + datetime.timedelta(days=6)
    days = [v for d, v in (rma.get("hist") or []) if iso(monday) <= d <= iso(sunday)]
    o = {"week": iso(monday), "agsist": cell["p"], "head": cell["head"], "barns": cell["barns"],
         "rma_days": len(days), "rma": round(sum(days) / len(days), 2) if days else None}
    if cell["p"] is None or len(days) < 3:
        o["gap"] = None
        o["why"] = "index withheld" if cell["p"] is None else "RMA has posted %d day%s for that week" % (len(days), "" if len(days) == 1 else "s")
    else:
        o["gap"] = round(cell["p"] - o["rma"], 2)
    return o


# ------------------------------------------------------------------ build
def build(auction, aev, meta, prices, prev, now_utc, mars=None):
    today = central_today(now_utc)
    prev = prev or {}
    store = merge_barn_sales(load_store(prev.get("barn_sales")), auction, today)
    merge_mars_sales(store, mars, today)
    dropped = resolve_store(store)
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
    prev_idx = {w["start"]: w for w in ((prev.get("index") or {}).get("weeks") or [])}
    index = build_index(store, prev_idx, monday, today)
    cur = index["weeks"][-1] if index["weeks"] and index["weeks"][-1]["start"] == iso(monday) else \
        {"p": None, "head": 0, "barns": 0}
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
        "index": index,
        "rma": rma,
        "check": build_check(cur, rma, monday) if rma.get("ok") else None,
        "weeks": weeks,
        "settles": settles,
        "barn_sales": save_store(store),
        "barn_sales_via": "Each barn's sales were read through USDA My Market News, except the dates in its pdf list, read from the barn's USDA PDF report",
        "mars": mars_note(mars, store, dropped),
        "dropped": [list(x) for x in dropped],
    }


def mars_note(mars, store, dropped):
    """How this run read the barns: whether My Market News answered, and what it set aside."""
    n = {"mars": 0, "pdf": 0}
    for e in store.values():
        for d in e["sales"]:
            n[(e.get("via") or {}).get(d, "pdf")] += 1
    o = {"read": bool(mars and mars.get("ok")), "sales_mars": n["mars"], "sales_pdf": n["pdf"], "dropped": len(dropped)}
    if mars and mars.get("note"):
        o["note"] = mars["note"]
    return o


# The builder's own copy of every barn's sales (barn_sales) lives in its own file, which no
# page loads: read through My Market News the store holds 80 to 100 barns a week, over twice
# the PDF reads, and kept in data/feeder-index.json it took that file, which three pages load,
# past 230 KB (Nov 3 2026). A file from before then still holds barn_sales itself; it is read
# from there once and moved.
STORE = "data/feeder-index-store.json"
STORE_KEYS = ("barn_sales", "barn_sales_via", "dropped")


def read_inputs(root):
    prev = load_json(root / OUT)
    st = load_json(root / STORE)
    if prev is not None and st and st.get("barn_sales") is not None:
        prev = dict(prev, barn_sales=st["barn_sales"])
    return (load_json(root / AUCTION), load_json(root / AEV), load_json(root / META),
            load_json(root / PRICES), prev)


def split_doc(doc):
    """(the file the pages load, the store file)."""
    page = {k: v for k, v in doc.items() if k not in STORE_KEYS}
    store = {"v": 1, "what": "The barn sales data/feeder-index.json is built from (scripts/build_feeder_index.py); no page loads this file",
             "updated": doc.get("updated")}
    store.update({k: doc[k] for k in STORE_KEYS if k in doc})
    return page, store


def write(root, doc):
    page, store = split_doc(doc)
    for name, d in ((OUT, page), (STORE, store)):
        path = root / name
        tmp = path.with_name(path.name + ".tmp")
        with open(tmp, "w") as f:
            f.write(json.dumps(d, separators=(",", ":"), ensure_ascii=False) + "\n")
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
    chk = build_check(tb["steers"]["us"]["700-899"], hist, D(2026, 10, 12))
    ck("check: national 700-899 vs mean RMA for the week", chk["rma"] == 341.0 and chk["rma_days"] == 3 and chk["gap"] == round(tb["steers"]["us"]["700-899"]["p"] - 341.0, 2))
    chk2 = build_check(tb["steers"]["us"]["700-899"], {"hist": [["2026-10-12", 340.0]]}, D(2026, 10, 12))
    ck("check withheld under 3 RMA days", chk2["gap"] is None and "1 day" in chk2["why"])

    # ---- the AGSIST USDA feeder steer index
    STATES = ["IA", "IL", "MO", "NE", "SD", "KS", "OK", "TX", "TN", "KY"]

    def wk_barns(n, start, price, head=150, wt=800, cls="800", states=STATES, first=1, day=1):
        return [barn(first + i, states[i % len(states)], iso(start + datetime.timedelta(days=day)), head, price, wt=wt, cls=cls)
                for i in range(n)]

    def store_of(barns_):
        st = {}
        for b in barns_:
            for s_ in b["sales"]:
                e = st.setdefault(b["id"], {"state": b["state"], "sales": {}})
                e["sales"].setdefault(s_["date"], {})
                for k, v in sale_cells(s_).items():
                    e["sales"][s_["date"]][k] = v
        return st

    M = D(2026, 10, 19)
    TODAY = D(2026, 10, 27)
    st30 = store_of(wk_barns(30, M, 350.0))
    o, b = index_week(st30, M, TODAY)
    # 30 barns x 150 head = 4,500 head in 10 states, 10% each: every gate passes
    ck("index: 30 barns, 4,500 head, 10 states is published", o["p"] == 350.0 and o["barns"] == 30 and o["head"] == 4500 and o["states"] == 10)
    ck("index: one price everywhere redraws to itself", o["lo"] == 350.0 and o["hi"] == 350.0)
    ck("index: average weight and the largest states", o["avg_wt"] == 800 and o["top"][0] == ["IA", 10])
    ck("index: a week that ended 2 days before the run is not final", o["final"] is False)
    o29, _ = index_week(store_of(wk_barns(29, M, 350.0, head=200)), M, TODAY)
    ck("index: 29 barns is withheld, with its counts", o29["p"] is None and o29["why"] == ["29 barns, 30 needed"] and o29["head"] == 5800)
    oh, _ = index_week(store_of(wk_barns(30, M, 350.0, head=100)), M, TODAY)
    ck("index: 3,000 head is withheld", oh["p"] is None and oh["why"] == ["3,000 head, 4,000 needed"])
    os_, _ = index_week(store_of(wk_barns(30, M, 350.0, states=STATES[:7])), M, TODAY)
    ck("index: 7 states is withheld", os_["p"] is None and os_["why"] == ["7 states, 8 needed"])
    heavy = wk_barns(29, M, 350.0, head=100) + wk_barns(1, M, 350.0, head=3000, states=["OK"], first=40)
    ok_, _ = index_week(store_of(heavy), M, TODAY)
    # OK: 3 of the 29 (indexes 6, 16, 26) at 100 head + one barn at 3,000 = 3,300 of 5,900 head = 56%
    ck("index: one state over half the head is withheld", ok_["p"] is None and ok_["why"] == ["OK sold 56% of the head, 50% at most"])
    # pounds weighting across the band: 15 barns of 700s at $360 (150 x 7.5 cwt), 15 of 800s at $340 (150 x 8.5 cwt)
    mix = store_of(wk_barns(15, M, 360.0, wt=750, cls="700") + wk_barns(15, M, 340.0, wt=850, cls="800", first=16))
    om, _ = index_week(mix, M, TODAY)
    # dollars 15x150x7.5x360 + 15x150x8.5x340 = 6,075,000 + 6,502,500 = 12,577,500 over 36,000 cwt = 349.375
    ck("index: 700s and 800s pooled by pounds", om["p"] == 349.38 and om["avg_wt"] == 800)
    ck("index: redrawn range brackets the price", om["lo"] <= om["p"] <= om["hi"] and om["lo"] < om["hi"])
    ck("index: the redraw is the same on every run", index_week(mix, M, TODAY)[0]["lo"] == om["lo"])
    ck("index: heifers and lighter steers stay out",
       index_barns(store_of(wk_barns(3, M, 300.0, cls="600") + [barn(9, "IA", "2026-10-20", 100, 300.0, sex="heifers")]), M) == {})

    # change: same 30 barns both weeks, $10 higher
    two = store_of(wk_barns(30, M - datetime.timedelta(days=7), 340.0) + wk_barns(30, M, 350.0))
    idx = build_index(two, {}, M, TODAY)
    w = idx["weeks"][-1]
    ck("index: change when both weeks pass and 30 barns sold both", w["chg"] == 10.0 and w["both"] == 30)
    ck("index: a $10 rise at every barn is a clear rise", w["chg_lo"] == 10.0 and w["chg_hi"] == 10.0 and w["move"] == "up")
    ck("index: the record starts the week of Oct 12, 2026", idx["weeks"][0]["start"] == "2026-10-12" and idx["start"] == "2026-10-12")
    ck("index: the first week has no change to show", idx["weeks"][0]["p"] == 340.0 and idx["weeks"][0]["chg_why"] == "first week of the record")
    ck("index: latest and last published week", idx["latest"] == "2026-10-19" and idx["last_ok"] == "2026-10-19")
    gap = build_index(store_of(wk_barns(10, M - datetime.timedelta(days=7), 340.0) + wk_barns(30, M, 350.0)), {}, M, TODAY)
    ck("index: no change after a withheld week", gap["weeks"][1]["p"] == 350.0 and gap["weeks"][1]["chg"] is None and gap["weeks"][1]["chg_why"] == "prior week withheld")
    nos = build_index(store_of(wk_barns(30, M, 350.0)), {}, M, TODAY)
    ck("index: a week with no sales is in the record, withheld", nos["weeks"][0]["p"] is None and nos["weeks"][0]["barns"] == 0 and nos["weeks"][0]["why"])
    # mixed moves: half the barns up $10, half down $10 -> a range that takes in zero
    mixed = store_of(wk_barns(30, M - datetime.timedelta(days=7), 340.0) +
                     wk_barns(15, M, 350.0) + wk_barns(15, M, 330.0, first=16))
    wm = build_index(mixed, {}, M, TODAY)["weeks"][-1]
    ck("index: up at some barns, down at others is no clear change", wm["chg"] == 0.0 and wm["chg_lo"] < 0 < wm["chg_hi"] and wm["move"] == "flat")
    only20 = store_of(wk_barns(30, M - datetime.timedelta(days=7), 340.0) + wk_barns(20, M, 350.0) +
                      wk_barns(10, M, 350.0, first=60))
    w20 = build_index(only20, {}, M, TODAY)["weeks"][-1]
    ck("index: no change when only 20 barns sold both weeks", w20["p"] == 350.0 and w20["chg"] is None and w20["chg_why"] == "20 barns sold both weeks, 30 needed")
    # weeks older than the barn store keep what was published
    later = D(2026, 12, 9)
    frozen = {"2026-10-12": {"start": "2026-10-12", "end": "2026-10-18", "p": 347.85, "barns": 55, "head": 9595, "final": False}}
    fi = build_index({}, frozen, last_full_week(later), later)
    ck("index: a week past the store keeps its published price and turns final",
       fi["weeks"][0]["p"] == 347.85 and fi["weeks"][0]["final"] is True and fi["weeks"][1]["why"] == ["not held"])
    ck("index: a week ended 11 days before is final", index_week(st30, M, D(2026, 11, 6))[0]["final"] is True)
    # through build(): the index sits beside RMA, and the RMA check reads the index week
    full = {"barns": wk_barns(30, D(2026, 10, 12), 345.0) + wk_barns(30, D(2026, 10, 12), 350.0, first=1, day=8)}
    # barns 1-30 sold Oct 13 and Oct 20: both weeks in the store
    bd = build(full, aev, meta, prices, None, datetime.datetime(2026, 10, 28, 15, 0))
    ck("build: index weeks Oct 12 and Oct 19", [x["start"] for x in bd["index"]["weeks"]] == ["2026-10-12", "2026-10-19"])
    ck("build: index matches the table's national 700-899 steer line",
       bd["index"]["weeks"][-1]["p"] == bd["auction"]["table"]["steers"]["us"]["700-899"]["p"] == 350.0)
    ck("build: the RMA check reads the index week", bd["check"]["agsist"] == 350.0 and bd["check"]["barns"] == 30)
    ck("build: the label says not the CME index", bd["index"]["label"] == "AGSIST USDA feeder steer index, not the CME index")
    thin = build({"barns": wk_barns(10, D(2026, 10, 19), 350.0)}, aev, meta, prices, None, datetime.datetime(2026, 10, 28, 15, 0))
    ck("build: a withheld index week withholds the RMA check", thin["check"]["gap"] is None and thin["check"]["why"] == "index withheld")
    again2 = build(full, aev, meta, prices, bd, datetime.datetime(2026, 10, 28, 15, 0))
    ck("build: a rerun gives the same index", again2["index"] == bd["index"])

    # history from archived reports: same rules, only before the live record, re-run changes nothing
    def arch(n, start, price, first=1, day=1):
        return [dict(b["sales"][0], barn=b["id"], state=b["state"]) for b in wk_barns(n, start, price, first=first, day=day)]
    A1, A2 = D(2025, 1, 6), D(2025, 1, 13)
    sales_a = arch(30, A1, 300.0) + arch(30, A2, 310.0) + arch(5, D(2025, 1, 27), 320.0) + arch(30, D(2026, 10, 12), 999.0)
    hs = history_store(sales_a)
    h1 = build_history(hs, None, "2026-11-02", "test")
    hw = {w["start"]: w for w in h1["weeks"]}
    ck("history: weeks from the first archived sale, none at or after the live start",
       h1["start"] == "2025-01-06" and max(hw) < iso(IDX_START) and "2026-10-12" not in hw)
    ck("history: same rules as the live index", hw["2025-01-06"]["p"] == index_week(hs, A1, FAR)[0]["p"] == 300.0)
    ck("history: change between two passing weeks", hw["2025-01-13"]["chg"] == 10.0 and hw["2025-01-13"]["both"] == 30)
    ck("history: a thin week is withheld with its counts", hw["2025-01-27"]["p"] is None and hw["2025-01-27"]["barns"] == 5
       and hw["2025-01-27"]["why"][0] == "5 barns, 30 needed")
    ck("history: a week with no archived sale is a gap", hw["2025-01-20"]["p"] is None and hw["2025-01-20"]["barns"] == 0)
    ck("history: every week marked as read from the archive", all(w["from"] == "archive" and w["read"] == "2026-11-02" for w in h1["weeks"]))
    ck("history: no week twice", len(h1["weeks"]) == len(hw))
    h2 = build_history(history_store(sales_a), h1, "2026-11-09", "test")
    ck("history: a re-run changes nothing (first read date kept)", h2 == h1)
    more = sales_a + arch(10, A1, 330.0, first=100)
    h3 = build_history(history_store(more), h1, "2026-11-09", "test")
    w3 = {w["start"]: w for w in h3["weeks"]}
    ck("history: a week with more barns read is recounted and dated anew",
       w3["2025-01-06"]["barns"] == 40 and w3["2025-01-06"]["read"] == "2026-11-09" and w3["2025-01-27"]["read"] == "2026-11-02")
    short = build_history(history_store(arch(30, A2, 310.0)), h1, "2026-11-09", "test")
    ck("history: weeks the new store does not reach stay as they were",
       {w["start"]: w for w in short["weeks"]}["2025-01-06"] == hw["2025-01-06"])
    dup = history_store(arch(1, A1, 300.0) + [dict(arch(1, A1, 300.0)[0], classes={"steers|1": {"800": {"head": 5, "avg_wt": 800, "cwt": 1.0, "per_head": 8.0}}})])
    ck("history: a barn's two reports of one sale count once (the fuller one)", dup["b1"]["sales"][iso(A1 + datetime.timedelta(days=1))]["steers|800"][0] == 150)
    ck("history: a live-record week passed in is dropped", all(w["start"] < iso(IDX_START) for w in
       build_history({}, {"weeks": [{"start": "2026-10-12", "end": "2026-10-18", "p": 1.0}]}, "x", "t")["weeks"]))

    print("FAILS=%d" % len(fails))
    return 1 if fails else 0


MARS_MINUTES = 12      # the MARS read never holds the barn job up longer than this


def read_mars(today, out_dir=None, root=ROOT, fetch_=None, log=print):
    """The barn sales of the last KEEP_DAYS through USDA My Market News (MARS), with the
    reader the past weeks use (backfill_feeder_index.mars_fetch: every single-barn report in
    scripts/cattle_auction_sources.json, one ask per report, 1.5 s apart, the PDF reader's
    own row rules and title check). Needs MARS_API_KEY (Actions secret, HTTP basic, never
    printed or saved). The answers go to a scratch folder, never to the repo.
    -> {"ok", "sales": [...], "reports", "answered", "note"} or None with no key."""
    if not os.environ.get("MARS_API_KEY", "").strip() and fetch_ is None:
        return None
    import tempfile
    import backfill_feeder_index as BK   # noqa: E402  imports this file; only the live MARS read needs it
    out_dir = out_dir or tempfile.mkdtemp(prefix="feeder-mars-live-")
    d0, d1 = today - datetime.timedelta(days=KEEP_DAYS), today
    try:
        man = BK.mars_fetch(d0, d1, out=out_dir, fetch_=fetch_, log=log, root=root, minutes=MARS_MINUTES)
    except Exception as e:  # noqa: BLE001  a MARS failure never holds back the PDF reads
        return {"ok": False, "sales": [], "note": "My Market News read failed: %s" % type(e).__name__}
    if not man:
        return {"ok": False, "sales": [], "note": "My Market News not read"}
    reps = man.get("reports") or {}
    answered = sum(1 for m in reps.values() if any(y.get("status") == 200 for y in (m.get("years") or {}).values()))
    sales = BK.mars_saved_sales(out_dir, root)
    ok = answered > 0 and bool(sales)
    o = {"ok": ok, "sales": sales if ok else [], "reports": len(reps), "answered": answered,
         "from": iso(d0), "to": iso(d1)}
    if not ok:
        o["note"] = "My Market News answered %d of %d reports with no sale; the PDF reads stand" % (answered, len(reps))
    return o


def main(argv):
    if "--selftest" in argv:
        return selftest()
    now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    mars = None if "--check" in argv else read_mars(central_today(now))
    if mars is not None:
        print("feeder-index: My Market News %s, %d of %d reports answered, %d sales" % (
            "read" if mars.get("ok") else "NOT read", mars.get("answered", 0), mars.get("reports", 0), len(mars["sales"])))
    doc = build(*read_inputs(ROOT), now, mars=mars)
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
