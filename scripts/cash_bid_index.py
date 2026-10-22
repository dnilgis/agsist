#!/usr/bin/env python3
"""
cash_bid_index.py -- the AGSIST Cash Bid Index: one edition a month, from the
elevator boards AGSIST reads itself. Page: /cash-bid-index.

ONE SOURCE OF TRUTH WITH THE DAILY. The day values are the same ones the
Daily's "Only on AGSIST" block counts (scripts/daily_edge.py): each board's
last posted cash and basis on each trading day, from data/bids-prev/<ST>.json
(scripts/build_bids_prev.py), with the crop of each board taken from the
elevator network's index the same way (daily_edge.fnv, daily_edge.usable_now
rules: US dollars, plain corn and soybeans, the same price bands, no special
grades).

HOW A MONTH IS KEPT (small on purpose)
  --fold        run after each bids-prev update (fetch_bids.yml). For every
                COMPLETE trading day (before today, Central) not yet folded, it
                adds each board's day to data/cash-index/acc-YYYY-MM.json: per
                board its first and last day, the count of days and the sums of
                cash and basis. About 200 KB a month, never a day-by-day table.
                bids-prev keeps four trading days, so up to three missed runs
                in a row lose nothing.
  --build YYYY-MM   (default: last month) folds first, then writes the edition:
                data/cash-index/editions.json gains or replaces that month's
                entry (a few KB), data/cash-index/YYYY-MM.csv is the state
                table, and cash-bid-index.html is rebuilt from every edition.
  --backfill    folds old days out of git history of data/bids-prev (one
                snapshot per Central day), for the first edition.

WHAT A BOARD'S DAY IS, AND WHAT IS LEFT OUT
  A board is one elevator location, crop and delivery period (the bids-prev
  key). A day's row is left out when the board's implied futures (cash minus
  basis) is more than 3% off that day's median for the crop: a misread board
  or one pricing against a far month. Left-out rows are counted.

THE EDITION, PER STATE AND OVERALL, CORN AND SOYBEANS
  elevators      boards with at least one day in the month
  avg / median   of each board's average cash over its days
  basis          average of each board's average basis, cents, against the
                 futures month each board names (in the fall, nearly always
                 December corn and November soybeans); outliers by the same
                 rule as scripts/basis_method.py (5 robust SDs, floor 75 cents)
  raised / cut   the board's last day of the month against its first day,
                 cash and basis, boards seen on two or more days only
  change         against last month's edition, same state, when both have the
                 sample; the boards are not the same set and the page says so

REFUSALS (same spirit as the Daily)
  a state row prints numbers only with MIN_STATE_N (15) boards; a crop is left
  out of the edition under MIN_TOTAL (100) boards; an edition needs MIN_DAYS
  (5) folded trading days; a month still running, or one whose first folded
  day is after the month's first trading day, is labeled partial with its real
  dates. No record claims: the only history is what is here, and findings say
  "since we started tracking" with the first folded date.

    python3 scripts/cash_bid_index.py --fold [--bids-base DIR]
    python3 scripts/cash_bid_index.py --build 2026-10 [--partial-ok]
    python3 scripts/cash_bid_index.py --backfill --since 2026-10-01 [--bids-base DIR]
    python3 scripts/cash_bid_index.py --page        rebuild the page only
    python3 scripts/cash_bid_index.py --check       page matches editions.json
    python3 scripts/cash_bid_index.py --selftest
"""
import csv
import hashlib
import glob
import html
import io
import json
import math
import os
import re
import statistics
import subprocess
import sys
from datetime import date, datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import contract_calendar as cc  # noqa: E402
import daily_edge as de  # noqa: E402  one source of truth: keys, crop rules, states

REPO = os.path.dirname(HERE)
DIR = os.path.join(REPO, "data", "cash-index")
EDITIONS = os.path.join(DIR, "editions.json")
PAGE = os.path.join(REPO, "cash-bid-index.html")
URL = "https://agsist.com/cash-bid-index"
SCHEMA_ACC = "agsist-cash-index-acc/1"
SCHEMA_ED = "agsist-cash-index/1"
CROPS = ("corn", "soybeans")
CROP_NAME = {"corn": "Corn", "soybeans": "Soybeans"}
IMPLIED_TOL = 0.03
MIN_STATE_N = 15
MIN_TOTAL = 100
MIN_DAYS = 5
MIN_COMPANIES = 3     # a state is named widest or narrowest only with boards from 3+ companies
OUT_K, OUT_FLOOR = 5.0, 75.0   # cents, scripts/basis_method.py
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
          "September", "October", "November", "December"]


# ── helpers ────────────────────────────────────────────────────────────────
def ct_today(now=None):
    return de.ct_date(now or datetime.now(timezone.utc))


def month_of(d):
    return str(d)[:7]


def month_words(m):
    y, mo = int(m[:4]), int(m[5:7])
    return f"{MONTHS[mo - 1]} {y}"


def trading_days(m):
    y, mo = int(m[:4]), int(m[5:7])
    d, out = date(y, mo, 1), []
    while d.month == mo:
        if cc.is_trading_day(d):
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


def prev_month(m):
    y, mo = int(m[:4]), int(m[5:7])
    return f"{y - 1}-12" if mo == 1 else f"{y}-{mo - 1:02d}"


def acc_path(m):
    return os.path.join(DIR, f"acc-{m}.json")


def load(fp, default=None):
    try:
        with open(fp, encoding="utf-8") as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return default


def dump(fp, obj, compact=False):
    os.makedirs(os.path.dirname(fp), exist_ok=True)
    with open(fp, "w", encoding="utf-8") as f:
        if compact:
            json.dump(obj, f, separators=(",", ":"), ensure_ascii=False)
        else:
            json.dump(obj, f, indent=1, ensure_ascii=False)
        f.write("\n")


def crop_map(index):
    """{fnv key: (crop, state, board, operator, is_now)} for every corn/soybean period each USD board
    in the network index quotes, so a key from an older period still resolves.
    Same eligibility rules as the Daily (daily_edge.usable_now)."""
    out = {}
    for p in (index or {}).get("places") or []:
        st = str(p.get("state") or "").upper()
        if st not in de.US_STATES or (p.get("currency") or "USD") != "USD" or not p.get("place"):
            continue
        for crop in CROPS:
            n = (p.get("now") or {}).get(crop)
            if n and de.SPECIAL_GRADE.search(str(n.get("commodity") or "")):
                continue
            if crop not in (p.get("crops") or []) and not n:
                continue
            bkey = de.fnv(p["place"] + "|" + crop)
            okey = de.fnv(str(p.get("operator") or p["place"].split("|")[0]).strip().lower())
            nowp = n.get("period") if n else None
            for per in set((p.get("periods") or []) + ([nowp] if nowp else [])):
                out[de.fnv(p["place"] + "|" + crop + "|" + per)] = (crop, st, bkey, okey, per == nowp)
    return out


def new_acc(m):
    return {"schema": SCHEMA_ACC, "month": m, "folded": [], "boards": {},
            "left_out": {"implied": 0, "band": 0}, "other_rows": 0}


# ── fold ───────────────────────────────────────────────────────────────────
def day_rows(prev, cmap, day):
    """[(key, crop, state, cash, basisCents|None)] for one day, after the
    price bands; plus how many rows had no crop."""
    rows, unmapped = [], 0
    for st, shard in prev.items():
        for key, hist in (shard or {}).items():
            for e in hist or []:
                if not isinstance(e, list) or len(e) < 3 or e[0] != day:
                    continue
                cm = cmap.get(key)
                if not cm:
                    unmapped += 1
                    continue
                rows.append((cm[2], cm[0], st, e[1], e[2], cm[3], cm[4], key))
    # one row per elevator and crop a day: on the day a board rolls to its next
    # delivery period both keys can carry that day; the current period wins
    rows.sort(key=lambda r: (r[0], not r[6], r[7]))
    out, seen = [], set()
    for r in rows:
        if r[0] in seen:
            continue
        seen.add(r[0])
        out.append(r[:6])
    return out, unmapped


def filter_day(rows):
    """Drops rows outside the price band and rows whose implied futures is
    more than IMPLIED_TOL off the crop's median that day. (kept, n_band, n_implied)."""
    kept, band, implied = [], 0, 0
    by = {}
    for r in rows:
        lo, hi = de.PPU_BAND[r[1]]
        if not isinstance(r[3], (int, float)) or not (lo <= r[3] <= hi):
            band += 1
            continue
        by.setdefault(r[1], []).append(r)
    for crop, rs in by.items():
        imp = [r[3] - r[4] / 100.0 for r in rs if isinstance(r[4], (int, float))]
        med = statistics.median(imp) if imp else None
        for r in rs:
            if med and isinstance(r[4], (int, float)) and abs((r[3] - r[4] / 100.0) / med - 1) > IMPLIED_TOL:
                implied += 1
                continue
            kept.append(r)
    return kept, band, implied


def fold_day(acc, rows, day, band, implied, unmapped):
    for key, crop, st, cash, basis, op in rows:
        b = acc["boards"].get(key)
        bb = basis if isinstance(basis, (int, float)) else None
        if not b:
            b = acc["boards"][key] = {"c": crop, "s": st, "o": op, "f": [day, cash, bb], "l": [day, cash, bb],
                                      "n": 0, "sc": 0.0, "nb": 0, "sb": 0.0}
        if day < b["f"][0]:
            b["f"] = [day, cash, bb]
        if day >= b["l"][0]:
            b["l"] = [day, cash, bb]
        b["n"] += 1
        b["sc"] = round(b["sc"] + cash, 4)
        if bb is not None:
            b["nb"] += 1
            b["sb"] = round(b["sb"] + bb, 4)
    acc["folded"] = sorted(set(acc["folded"]) | {day})
    acc["left_out"]["band"] += band
    acc["left_out"]["implied"] += implied
    acc["other_rows"] += unmapped


def fold(prev, cmap, today, accs, disk=True):
    """Folds every complete trading day in `prev` not yet folded. `accs` is
    {month: acc} and is updated in place. Returns the days folded."""
    days = sorted({e[0] for sh in prev.values() for h in (sh or {}).values() for e in (h or [])
                   if isinstance(e, list) and e and isinstance(e[0], str)})
    done = []
    for day in days:
        try:
            d = date.fromisoformat(day)
        except ValueError:
            continue
        if d >= today or not cc.is_trading_day(d):
            continue
        m = month_of(day)
        acc = accs.setdefault(m, (load(acc_path(m)) if disk else None) or new_acc(m))
        if day in acc["folded"]:
            continue
        rows, unmapped = day_rows(prev, cmap, day)
        kept, band, implied = filter_day(rows)
        fold_day(acc, kept, day, band, implied, unmapped)
        done.append(day)
    return done


# ── the edition ────────────────────────────────────────────────────────────
def _robust(vals, floor):
    if len(vals) < 3:
        return vals, []
    med = statistics.median(vals)
    mad = statistics.median([abs(v - med) for v in vals])
    band = max(OUT_K * 1.4826 * mad, floor)
    return [v for v in vals if abs(v - med) <= band], [v for v in vals if abs(v - med) > band]


def summarize(boards):
    """One crop in one area. Pure."""
    cash = [b["sc"] / b["n"] for b in boards if b["n"]]
    basis_all = [b["sb"] / b["nb"] for b in boards if b["nb"]]
    basis, out = _robust(basis_all, OUT_FLOOR)
    raised = cut = held = bs = bw = bh = 0
    for b in boards:
        if b["f"][0] == b["l"][0]:
            continue
        dc = (b["l"][1] - b["f"][1]) * 100
        if dc >= 0.125:
            raised += 1
        elif dc <= -0.125:
            cut += 1
        else:
            held += 1
        if b["f"][2] is not None and b["l"][2] is not None:
            db = b["l"][2] - b["f"][2]
            if db >= 0.125:
                bs += 1
            elif db <= -0.125:
                bw += 1
            else:
                bh += 1
    return {
        "n": len(cash), "companies": len({b.get("o") for b in boards if b.get("o")}),
        "avg_cash": round(sum(cash) / len(cash), 4) if cash else None,
        "median_cash": round(statistics.median(cash), 4) if cash else None,
        "avg_basis_cents": round(sum(basis) / len(basis), 2) if basis else None,
        "basis_n": len(basis), "basis_outliers": len(out),
        "raised": raised, "cut": cut, "held": held,
        "basis_stronger": bs, "basis_weaker": bw, "basis_held": bh,
    }


def cents_words(c):
    q = round(c * 4) / 4
    if abs(q) < 0.125:
        return "even with futures"
    return f"{de.qc(q)}¢ {'over' if q > 0 else 'under'} futures"


def money(v):
    return f"${v:,.2f}"


def build_edition(acc, prior=None, now=None):
    """Pure: the edition dict for acc's month, or (None, why)."""
    m = acc["month"]
    folded = sorted(acc.get("folded") or [])
    if len(folded) < MIN_DAYS:
        return None, f"{len(folded)} trading days folded, need {MIN_DAYS}"
    tdays = trading_days(m)
    today = ct_today(now)
    partial = (folded[0] > tdays[0]) or (month_of(today.isoformat()) == m) or (folded[-1] < tdays[-1])
    f0, f1 = date.fromisoformat(folded[0]), date.fromisoformat(folded[-1])
    label = month_words(m)
    if partial:
        label = f"{MONTHS[f0.month - 1]} {f0.day} to {f1.day}, {f0.year}, partial month"
    ed = {"month": m, "label": label, "partial": partial, "first_day": folded[0], "last_day": folded[-1],
          "trading_days": len(folded), "trading_days_in_month": len(tdays),
          "left_out": acc.get("left_out"), "other_rows": acc.get("other_rows", 0),
          "crops": {}, "withheld": [], "findings": [], "first_edition": not prior}
    pstates = (prior or {}).get("crops") or {}
    for crop in CROPS:
        bs = [b for b in acc["boards"].values() if b.get("c") == crop]
        overall = summarize(bs)
        if overall["n"] < MIN_TOTAL:
            ed["withheld"].append({"crop": crop, "why": "sample", "detail": f"{overall['n']} boards, need {MIN_TOTAL}"})
            continue
        states = {}
        for st in sorted({b["s"] for b in bs}):
            s = summarize([b for b in bs if b["s"] == st])
            row = {"state": st, "name": de.US_STATES.get(st, st), "n": s["n"]}
            if s["n"] >= MIN_STATE_N:
                row.update(s)
                pr = ((pstates.get(crop) or {}).get("states") or {}).get(st)
                if pr and pr.get("avg_cash") is not None and s["avg_cash"] is not None:
                    row["chg_cash_cents"] = round((s["avg_cash"] - pr["avg_cash"]) * 100, 2)
                if pr and pr.get("avg_basis_cents") is not None and s["avg_basis_cents"] is not None:
                    row["chg_basis_cents"] = round(s["avg_basis_cents"] - pr["avg_basis_cents"], 2)
            states[st] = row
        po = (pstates.get(crop) or {}).get("overall")
        if po and po.get("avg_cash") is not None:
            overall["chg_cash_cents"] = round((overall["avg_cash"] - po["avg_cash"]) * 100, 2)
        if po and po.get("avg_basis_cents") is not None and overall["avg_basis_cents"] is not None:
            overall["chg_basis_cents"] = round(overall["avg_basis_cents"] - po["avg_basis_cents"], 2)
        ranked = sorted([r for r in states.values() if r.get("avg_basis_cents") is not None
                         and (r.get("companies") or 0) >= MIN_COMPANIES],
                        key=lambda r: r["avg_basis_cents"])
        ed["crops"][crop] = {"overall": overall, "states": states,
                             "widest": [r["state"] for r in ranked[:3]],
                             "narrowest": [r["state"] for r in ranked[::-1][:3]]}
    ed["findings"] = findings(ed, prior)
    return ed, None


def findings(ed, prior):
    """2 to 4 plain sentences, each backed by the edition's own numbers."""
    out = []
    lab = ed["label"].replace(", partial month", "")
    since = date.fromisoformat(ed["first_day"])
    for crop in CROPS:
        c = ed["crops"].get(crop)
        if not c:
            continue
        o = c["overall"]
        if o["avg_cash"] is not None and o["avg_basis_cents"] is not None:
            s = (f"From {lab}, the average cash {crop[:-1] if crop == 'soybeans' else crop} bid at the "
                 f"{de.num(o['n'])} elevators AGSIST reads was {money(o['avg_cash'])}, "
                 f"{cents_words(o['avg_basis_cents'])} on average.")
            if crop == "soybeans":
                s = s.replace("soybean bid", "soybean bid")
            if o.get("chg_cash_cents") is not None:
                d = o["chg_cash_cents"]
                s = s[:-1] + (f", {de.qc(d)}¢ {'higher' if d > 0 else 'lower'} than "
                              f"{month_words(prior['month']).split()[0]}." if abs(d) >= 0.125 else
                              f", unchanged from {month_words(prior['month']).split()[0]}.")
            out.append(s)
    c = ed["crops"].get("corn")
    if c and c["widest"] and c["narrowest"] and c["widest"][0] != c["narrowest"][0]:
        w, n = c["states"][c["widest"][0]], c["states"][c["narrowest"][0]]
        k = sum(1 for r in c["states"].values() if r.get("avg_basis_cents") is not None)
        def who(r):
            co = r.get("companies") or 0
            return f"{de.num(r['n'])} elevators" + (f", {co} companies" if co and co < r["n"] else "")
        out.append(f"Corn basis was widest in {w['name']} ({cents_words(w['avg_basis_cents'])}, {who(w)}) "
                   f"and narrowest in {n['name']} ({cents_words(n['avg_basis_cents'])}, {who(n)}), "
                   f"of {k} states with at least {MIN_STATE_N} elevators.")
    for crop in CROPS:
        cc_ = ed["crops"].get(crop)
        if not cc_:
            continue
        o = cc_["overall"]
        moved = o["basis_stronger"] + o["basis_weaker"]
        if moved and len(out) < 4:
            word = "corn" if crop == "corn" else "soybean"
            out.append(f"Between {_short(ed['first_day'])} and {_short(ed['last_day'])}, {de.num(o['basis_weaker'])} "
                       f"elevators weakened their {word} basis and {de.num(o['basis_stronger'])} strengthened it; "
                       f"{de.num(o['basis_held'])} held it where it was.")
            break
    if not prior and len(out) < 4:
        out.append(f"This is the first edition. AGSIST started keeping these daily board prices on "
                   f"{_short(since.isoformat())}, {since.year}, so there is no earlier month to compare against.")
    return out[:4]


def _short(iso):
    d = date.fromisoformat(iso)
    return f"{de.MON[d.month - 1]} {d.day}"


def csv_text(ed):
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(["month", "crop", "state", "elevators", "companies", "avg_cash_usd", "median_cash_usd", "avg_basis_cents",
                "chg_cash_cents_vs_prior_month", "raised", "cut", "held", "basis_stronger", "basis_weaker", "basis_held"])
    for crop in CROPS:
        c = ed["crops"].get(crop)
        if not c:
            continue
        rows = [("ALL", dict(c["overall"], n=c["overall"]["n"]))] + [(st, r) for st, r in sorted(c["states"].items())]
        for st, r in rows:
            if r.get("avg_cash") is None:
                w.writerow([ed["month"], crop, st, r["n"]] + [""] * 11)
                continue
            w.writerow([ed["month"], crop, st, r["n"], r.get("companies", ""), f"{r['avg_cash']:.4f}", f"{r['median_cash']:.4f}",
                        "" if r.get("avg_basis_cents") is None else f"{r['avg_basis_cents']:.2f}",
                        "" if r.get("chg_cash_cents") is None else f"{r['chg_cash_cents']:.2f}",
                        r["raised"], r["cut"], r["held"], r["basis_stronger"], r["basis_weaker"], r["basis_held"]])
    return buf.getvalue()


# ── the page ───────────────────────────────────────────────────────────────
def esc(x):
    return html.escape(str(x if x is not None else ""), quote=True)


def _nav_blocks():
    """The static header and footer exactly as scripts/inject_static_nav.py
    writes them, copied from a page it maintains."""
    src = open(os.path.join(REPO, "grain-emc.html"), encoding="utf-8").read()
    h = re.search(r"<!-- static-nav:header.*?<!-- /static-nav:header -->", src, re.S).group(0)
    f = re.search(r"<!-- static-nav:footer.*?<!-- /static-nav:footer -->", src, re.S).group(0)
    fonts = re.search(r"<!-- static-nav:fonts.*?<!-- /static-nav:fonts -->", src, re.S).group(0)
    early = re.search(r"<script>/\* agsist-theme-early.*?</script><script>/\* agsist-ga-guard.*?</script>", src, re.S).group(0)
    return h, f, fonts, early


def chart_svg(ed, crop="corn"):
    """Horizontal bars: each state's average basis, cents, zero line marked.
    Labels carry the value, so nothing depends on color."""
    c = ed["crops"].get(crop)
    if not c:
        return ""
    rows = sorted([r for r in c["states"].values() if r.get("avg_basis_cents") is not None],
                  key=lambda r: r["avg_basis_cents"], reverse=True)
    if not rows:
        return ""
    lo = min(0, min(r["avg_basis_cents"] for r in rows))
    hi = max(0, max(r["avg_basis_cents"] for r in rows))
    span = (hi - lo) or 1
    W, LBL, VAL, BH, GAP = 420, 104, 84, 18, 6
    plot = W - LBL - VAL
    x0 = LBL + (0 - lo) / span * plot
    H = len(rows) * (BH + GAP) + 26
    parts = [f'<svg class="cbi-chart" viewBox="0 0 {W} {H}" role="img" aria-labelledby="cbi-ch-t-{crop}" '
             f'preserveAspectRatio="xMinYMin meet"><title id="cbi-ch-t-{crop}">{CROP_NAME[crop]} basis by state, '
             f'{esc(ed["label"])}: average cents over or under futures</title>']
    for i, r in enumerate(rows):
        y = 8 + i * (BH + GAP)
        v = r["avg_basis_cents"]
        x = LBL + (min(v, 0) - lo) / span * plot
        w = max(1.0, abs(v) / span * plot)
        cls = "pos" if v > 0 else "neg"
        parts.append(f'<text x="{LBL - 8}" y="{y + BH - 5}" text-anchor="end" class="cbi-ch-l">{esc(r["name"])}</text>'
                     f'<rect x="{x:.1f}" y="{y}" width="{w:.1f}" height="{BH}" rx="3" class="cbi-ch-b {cls}"/>'
                     f'<text x="{W - VAL + 8}" y="{y + BH - 5}" class="cbi-ch-v">{esc(cents_words(v).replace(" futures", ""))}</text>')
    parts.append(f'<line x1="{x0:.1f}" x2="{x0:.1f}" y1="2" y2="{H - 20}" class="cbi-ch-z"/>'
                 f'<text x="{x0:.1f}" y="{H - 6}" text-anchor="middle" class="cbi-ch-l">even with futures</text></svg>')
    return "".join(parts)


def _cell(v, fmt):
    return "" if v is None else fmt(v)


PHONE_ROWS = 8


def table_html(ed, crop):
    c = ed["crops"].get(crop)
    if not c:
        w = next((x for x in ed["withheld"] if x["crop"] == crop), None)
        return f'<p class="cbi-none">{CROP_NAME[crop]}: not enough elevators this month ({esc(w["detail"] if w else "")}).</p>'
    has_chg = any(r.get("chg_cash_cents") is not None for r in c["states"].values())
    head = ("<tr><th scope=\"col\">State</th><th scope=\"col\">Elevators</th><th scope=\"col\">Avg cash</th>"
            "<th scope=\"col\">Median cash</th><th scope=\"col\">Avg basis</th>"
            + ("<th scope=\"col\">Cash vs last month</th>" if has_chg else "")
            + "<th scope=\"col\">Raised / cut</th><th scope=\"col\">Basis stronger / weaker</th></tr>")

    def row(name, r, cls=""):
        # data-l: the column name, which a phone shows beside each value when the rows stack into cards
        if r.get("avg_cash") is None:
            return (f'<tr class="{cls}"><th scope="row">{esc(name)}</th><td data-l="Elevators">{r["n"]}</td>'
                    f'<td colspan="{6 if has_chg else 5}" class="cbi-few">fewer than {MIN_STATE_N} elevators</td></tr>')
        chg = ""
        if has_chg:
            d = r.get("chg_cash_cents")
            chg = '<td data-l="Cash vs last month">' + ("" if d is None else (f"{'+' if d > 0 else '-'}{de.qc(d)}¢" if abs(d) >= 0.125 else "unch")) + "</td>"
        return (f'<tr class="{cls}"><th scope="row">{esc(name)}</th><td data-l="Elevators">{de.num(r["n"])}</td>'
                f'<td data-l="Avg cash">{money(r["avg_cash"])}</td><td data-l="Median">{money(r["median_cash"])}</td>'
                f'<td data-l="Avg basis">{esc(_cell(r.get("avg_basis_cents"), cents_words).replace(" futures", ""))}</td>{chg}'
                f'<td data-l="Bids raised / cut">{r["raised"]} / {r["cut"]}</td><td data-l="Basis firmer / weaker">{r["basis_stronger"]} / {r["basis_weaker"]}</td></tr>')

    body = row("All states", c["overall"], "cbi-all")
    few, k = [], 0
    for st, r in sorted(c["states"].items(), key=lambda kv: (-kv[1]["n"], kv[0])):
        if r.get("avg_cash") is None:
            few.append(r)
            continue
        k += 1
        # on a phone the first PHONE_ROWS states show; the rest open with "Show all states" (no script needed)
        body += row(r["name"], r, "cbi-more" if k > PHONE_ROWS else "")
    if few:
        names = ", ".join(f'{esc(r["name"])} {r["n"]}' for r in few)
        body += (f'<tr class="{"cbi-more" if k > PHONE_ROWS else ""}"><th scope="row">Other states</th><td data-l="Elevators">{sum(r["n"] for r in few)}</td>'
                 f'<td colspan="{6 if has_chg else 5}" class="cbi-few">fewer than {MIN_STATE_N} elevators each: {names}</td></tr>')
    more = sum(1 for r in c["states"].values() if r.get("avg_cash") is not None) - PHONE_ROWS + (1 if few else 0)
    tid = f'cbi-mt-{esc(ed["month"])}-{crop}'
    # a11y 2026-10-19: the box keeps its own name (its label is hidden once ticked
    # and on a wide screen), and is not drawn at all where it does nothing (over 600px)
    tog = f'<input type="checkbox" class="cbi-mt" id="{tid}" aria-label="Show all states ({more} more)">' if more > 0 else ""
    lab = f'<label class="cbi-ml" for="{tid}">Show all states ({more} more)</label>' if more > 0 else ""
    return ('<div class="cbi-tg">' + tog + f'<div class="cbi-tw" tabindex="0" role="region" aria-label="{CROP_NAME[crop]}, {esc(ed["label"])}, by state (scrolls sideways)">'
            f'<table class="cbi-t"><caption>{CROP_NAME[crop]}, {esc(ed["label"])}</caption>'
            f'<thead>{head}</thead><tbody>{body}</tbody></table></div>' + lab + '</div>')


def edition_html(ed, latest):
    m = ed["month"]
    finds = "".join(f"<li>{esc(s)}</li>" for s in ed["findings"])
    cite = (f'AGSIST Cash Bid Index, {esc(ed["label"])}, {URL}#{m}')
    hx = "h2" if latest else "h3"
    return (f'<section class="cbi-ed" id="{m}" aria-labelledby="h-{m}">'
            f'<{hx} id="h-{m}">{esc(ed["label"])}</{hx}>'
            f'<p class="cbi-meta">{ed["trading_days"]} of {ed["trading_days_in_month"]} trading days, '
            f'{_short(ed["first_day"])} to {_short(ed["last_day"])}.'
            + (' Partial month: the numbers cover only the days listed.' if ed["partial"] else "")
            + (f' First edition: AGSIST began keeping these daily board prices on {_short(ed["first_day"])}, '
               f'{ed["first_day"][:4]}, so there is no earlier month to compare.' if ed.get("first_edition") else "") + "</p>"
            f'<ul class="cbi-find">{finds}</ul>'
            f'<p class="cbi-cite"><b>How to cite:</b> {cite}</p>'
            + (f'<figure class="cbi-fig">{chart_svg(ed, "corn")}<figcaption>Average corn basis by state, states with '
               f'{MIN_STATE_N} or more elevators.</figcaption></figure>' if latest and chart_svg(ed, "corn") else "")
            + table_html(ed, "corn") + table_html(ed, "soybeans")
            + f'<p class="cbi-dl"><a href="/data/cash-index/{m}.csv" download>Download the state table (CSV)</a></p>'
            '</section>')


CSS = """
.cbi{max-width:860px;margin:0 auto;padding:1rem 1rem 4rem}
.cbi .breadcrumb{font-size:.8rem;margin:0 0 .5rem}
.cbi h1{font-size:clamp(1.4rem,4.3vw,2rem);line-height:1.2;margin:0 0 .3rem;color:var(--text)}
.cbi h2{font-size:1.25rem;line-height:1.3;margin:2rem 0 .5rem;color:var(--text)}
.cbi h3{font-size:1.05rem;line-height:1.3;margin:1.6rem 0 .4rem;color:var(--text)}
.cbi p,.cbi li{font-size:.97rem;line-height:1.6;color:var(--text-dim)}
.cbi a{color:var(--link,var(--brand));text-underline-offset:2px;text-decoration:underline}
.cbi b{color:var(--text)}
.cbi .by{font-size:.82rem;color:var(--text-muted);margin:0 0 .8rem}
.cbi-lede{font-size:1.02rem!important;color:var(--text)!important}
.cbi-meta{font-size:.84rem!important;color:var(--text-muted)!important;margin:0 0 .5rem}
.cbi-find{margin:.4rem 0 .8rem;padding:0 0 0 1.1rem}
.cbi-find li{margin:.3rem 0;color:var(--text)}
.cbi-cite{font-size:.86rem!important;padding:.55rem .75rem;border:1px solid var(--border);border-left:3px solid var(--green);border-radius:6px;background:var(--surface)}
.cbi-fig{margin:1rem 0;padding:.6rem .4rem;border:1px solid var(--border);border-radius:8px;background:var(--surface)}
.cbi-fig figcaption{font-size:.78rem;color:var(--text-muted);padding:.3rem .4rem 0}
.cbi-chart{width:100%;max-width:600px;height:auto;display:block}
.cbi-ch-l,.cbi-ch-v{font-family:'JetBrains Mono',monospace;font-size:11px;fill:var(--text-dim)}
.cbi-ch-v{fill:var(--text)}
.cbi-ch-b.neg{fill:#c9853a}.cbi-ch-b.pos{fill:#4aab4c}
.cbi-ch-z{stroke:var(--text-muted);stroke-width:1}
.cbi-tw{overflow-x:auto;margin:.8rem 0;border:1px solid var(--border);border-radius:8px}
.cbi-t{border-collapse:collapse;width:100%;font-size:.84rem;min-width:640px}
.cbi-t caption{text-align:left;font-weight:700;color:var(--text);padding:.55rem .7rem}
.cbi-t th,.cbi-t td{padding:.4rem .6rem;border-top:1px solid var(--border);text-align:right;white-space:nowrap;color:var(--text-dim)}
.cbi-t th[scope=row],.cbi-t thead th:first-child{text-align:left;color:var(--text)}
.cbi-t thead th{font-family:'JetBrains Mono',monospace;font-size:.7rem;letter-spacing:.04em;color:var(--text-muted);font-weight:700}
.cbi-t .cbi-all th,.cbi-t .cbi-all td{font-weight:700;color:var(--text)}
.cbi-few{text-align:left!important;color:var(--text-muted)!important;font-style:italic;white-space:normal!important}
.cbi-dl a{display:inline-block;padding:.55rem .9rem;border:1px solid var(--border);border-radius:6px;text-decoration:none!important}
.cbi-method li{margin:.35rem 0}
.cbi-past{margin-top:2.5rem;border-top:2px solid var(--border)}
@media (max-width:600px){
.cbi-tw{overflow:visible;border:0}
.cbi-t{min-width:0;display:block}
.cbi-t caption{display:block;padding:.2rem 0 .4rem}
.cbi-t thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.cbi-t tbody{display:block}
.cbi-t tr{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));column-gap:.6rem;margin:0 0 .45rem;padding:.45rem .65rem;border:1px solid var(--border);border-radius:8px;background:var(--surface)}
.cbi-t th,.cbi-t td{border:0;padding:.15rem 0;white-space:normal;text-align:left}
.cbi-t th[scope=row]{grid-column:1/-1;font-size:.95rem;padding-bottom:.25rem}
.cbi-t td[data-l]::before{content:attr(data-l);display:block;font-family:'JetBrains Mono',monospace;font-size:.66rem;letter-spacing:.03em;color:var(--text-muted);font-weight:400}
.cbi-t td.cbi-few{grid-column:2/-1}
.cbi-t tr.cbi-more{display:none}
.cbi-mt:checked~.cbi-tw tr.cbi-more{display:grid}
.cbi-ml{display:inline-block;margin:0 0 .6rem;padding:.55rem .9rem;border:1px solid var(--border);border-radius:6px;color:var(--link,var(--brand));font-size:.88rem;cursor:pointer}
.cbi-mt:checked~.cbi-ml{display:none}
}
.cbi-mt{position:absolute;opacity:0;width:1px;height:1px}
@media (min-width:601px){.cbi-ml,.cbi-mt{display:none}}
"""


def share_card():
    """The page's own share card (scripts/build_share_images.py makes it), with
    the same ?v=<hash> that script stamps; the site card until it exists."""
    path = os.path.join(REPO, "img", "og", "cash-bid-index.jpg")
    if not os.path.exists(path):
        return "https://agsist.com/img/og/agsist.jpg", "AGSIST Cash Bid Index: cash corn and soybean bids and basis by state"
    with open(path, "rb") as f:
        v = hashlib.sha1(f.read()).hexdigest()[:8]
    return "https://agsist.com/img/og/cash-bid-index.jpg?v=" + v, "AGSIST Cash Bid Index. Corn and soybean basis by state, each month."


def page_html(editions):
    head_nav, foot_nav, fonts, early = _nav_blocks()
    og_img, og_alt = share_card()
    eds = sorted(editions, key=lambda e: e["month"], reverse=True)
    latest = eds[0] if eds else None
    if latest:
        desc = (f"AGSIST Cash Bid Index, {latest['label']}: average cash corn and soybean bids, basis and how many "
                f"elevators raised or cut bids, by state, from the elevator boards AGSIST reads.")
    else:
        desc = "AGSIST Cash Bid Index: monthly average cash corn and soybean bids and basis by state, from the elevator boards AGSIST reads."
    desc = desc[:300]
    modified = latest["last_day"] if latest else "2026-10-17"
    ld = {"@context": "https://schema.org", "@graph": [
        {"@type": "Dataset", "@id": URL + "#dataset", "name": "AGSIST Cash Bid Index",
         "description": "Monthly average cash corn and soybean bids, basis against futures and counts of elevators that raised or cut bids, by US state, from the elevator boards AGSIST reads each trading day.",
         "url": URL, "creator": {"@type": "Organization", "name": "AGSIST", "url": "https://agsist.com/"},
         "author": de_author(), "license": "https://agsist.com/terms",
         "isAccessibleForFree": True, "inLanguage": "en-US", "keywords": ["cash grain bids", "basis", "corn", "soybeans", "elevators"],
         "spatialCoverage": {"@type": "Place", "name": "United States"},
         "temporalCoverage": (f"{eds[-1]['first_day']}/{latest['last_day']}" if latest else None),
         "dateModified": modified,
         "variableMeasured": ["average cash bid", "median cash bid", "average basis", "elevators that raised bids", "elevators that cut bids"],
         "distribution": [{"@type": "DataDownload", "encodingFormat": "text/csv", "contentUrl": f"https://agsist.com/data/cash-index/{e['month']}.csv",
                           "name": f"State table, {e['label']}"} for e in eds]},
        {"@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://agsist.com/"},
            {"@type": "ListItem", "position": 2, "name": "Cash bids", "item": "https://agsist.com/cash-bids"},
            {"@type": "ListItem", "position": 3, "name": "Cash Bid Index", "item": URL}]}]}
    if not latest:
        ld["@graph"][0].pop("temporalCoverage")
    body = edition_html(latest, True) if latest else (
        '<p class="cbi-none">The first edition is built from the first month of stored board prices.</p>')
    past = ""
    if len(eds) > 1:
        past = '<div class="cbi-past"><h2>Past editions</h2>' + "".join(edition_html(e, False) for e in eds[1:]) + "</div>"
    method = f"""
<h2 id="method">Method</h2>
<ul class="cbi-method">
<li><b>Which elevators.</b> Every elevator board in the AGSIST network (the boards AGSIST reads itself, about every 15 minutes, at each elevator's own website) that posts a plain corn or soybean bid in US dollars. Non-GMO, organic, white and feed grades are left out. Canadian boards are left out.</li>
<li><b>How a bid is chosen.</b> One bid per elevator, crop and delivery period: the board's last posted bid on each trading day, Central time. Each board is its nearest open delivery period as the network reads it.</li>
<li><b>Which contract.</b> Basis is the board's own: cash minus the futures month the elevator names. In the fall that is nearly always December corn and November soybeans. A day's bid is left out when the board's cash minus its basis is more than 3% off that day's middle for the crop, which catches misread boards and far-month contracts.</li>
<li><b>Averages.</b> Each board's average over the days it posted, then the average (and median) of the boards. A state prints numbers only with {MIN_STATE_N} or more elevators. A board's basis more than 5 robust standard deviations (never less than 75 cents) from its state's middle is left out of the basis average.</li>
<li><b>Raised and cut.</b> A board's last posted bid of the month against its first, for boards seen on two or more days. Cash moves mostly with futures; basis moves are the elevator's own call.</li>
<li><b>Month to month.</b> The set of elevators is not exactly the same each month. Changes compare the two editions' averages, not matched boards.</li>
<li><b>No records.</b> AGSIST began keeping these daily board prices in October 2026. Nothing here is called a record; comparisons go back only as far as the editions on this page.</li>
</ul>
<p>Computed by <code>scripts/cash_bid_index.py</code>, the same daily board prices the <a href="/daily">AGSIST Daily</a> counts in its Only on AGSIST block. Questions or corrections: <a href="mailto:sig@agsist.com">sig@agsist.com</a>.</p>"""
    title = "AGSIST Cash Bid Index: cash corn and soybean bids by state"
    ld_json = json.dumps(ld, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    return f"""<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#111a0a">
  <title>{esc(title)} | AGSIST</title>
  <meta name="description" content="{esc(desc)}">
  <meta name="author" content="Sigurd Lindquist">
  <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">
  <link rel="canonical" href="{URL}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="AGSIST">
  <meta property="og:locale" content="en_US">
  <meta property="og:title" content="{esc(title)}">
  <meta property="og:description" content="{esc(desc)}">
  <meta property="og:url" content="{URL}">
  <meta property="og:image" content="{og_img}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="{esc(og_alt)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="{og_img}">
  <meta name="twitter:title" content="{esc(title)}">
  <meta name="twitter:description" content="{esc(desc)}">
  {early}
  <script>window.dataLayer=window.dataLayer||[];function gtag(){{dataLayer.push(arguments);}}gtag('js',new Date());gtag('config','G-6KXCTD5Z9H');</script>
  {fonts}
  <link rel="preload" href="/components/styles.css?v=26" as="style">
  <link rel="stylesheet" href="/components/styles.css?v=26">
  <link rel="icon" href="/img/favicon.ico" sizes="32x32">
  <link rel="icon" type="image/svg+xml" href="/img/icon.svg">
  <style>{CSS}</style>
  <script type="application/ld+json">{ld_json}</script>
</head>
<body>
  <a href="#main" class="skip">Skip to content</a>
  <div id="site-header">
{head_nav}
</div>
  <main id="main" tabindex="-1">
    <article class="cbi">
      <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a> &rarr; <a href="/cash-bids">Cash bids</a> &rarr; Cash Bid Index</nav>
      <h1>AGSIST Cash Bid Index</h1>
      <p class="by">Updated {esc(_short(modified))}, {esc(modified[:4])}.</p>
      <p class="cbi-lede">Each month: what elevators actually bid for corn and soybeans, state by state, from the boards AGSIST reads every trading day. These numbers come from our own reads; no one else has this set.</p>
      {body}
      {past}
      {method}
    </article>
    <div data-signup-ask="Email me my top local bid and the markets, every morning" data-source="page:cash-bid-index"></div>
    <p class="by-end" style="font-size:.78rem;color:var(--text-muted);margin:1.2rem 0 .4rem">Made by <a href="/about">Sigurd Lindquist, CCA</a>, Chetek, Wisconsin.</p>
  </main>
  <div id="site-footer">
{foot_nav}
</div>
  <script src="/components/loader.js?v=19" defer></script>
  <script src="/components/next-links.js?v=3" defer></script>
</body>
</html>
"""


def de_author():
    return {"@type": "Person", "name": "Sigurd Lindquist", "jobTitle": "Certified Crop Adviser (CCA)", "url": "https://agsist.com/about"}


def write_page(editions):
    with open(PAGE, "w", encoding="utf-8") as f:
        f.write(page_html(editions))


# ── git backfill ───────────────────────────────────────────────────────────
def git_snapshots(since):
    """[(commit, ct_day)] the last commit touching data/bids-prev on each
    Central day since `since`, oldest first."""
    out = subprocess.run(["git", "-C", REPO, "log", f"--since={since}", "--format=%H %cI", "--", "data/bids-prev"],
                         capture_output=True, text=True, check=True).stdout.split("\n")
    by_day = {}
    for line in out:
        if not line.strip():
            continue
        h, t = line.split()
        d = de.ct_date(datetime.fromisoformat(t)).isoformat()
        by_day.setdefault(d, h)        # git log is newest first: first seen = last of the day
    return sorted(((h, d) for d, h in by_day.items()), key=lambda x: x[1])


def prev_at(commit):
    names = subprocess.run(["git", "-C", REPO, "ls-tree", "--name-only", commit, "data/bids-prev/"],
                           capture_output=True, text=True, check=True).stdout.split()
    prev, gen = {}, None
    for n in names:
        if not n.endswith(".json"):
            continue
        j = json.loads(subprocess.run(["git", "-C", REPO, "show", f"{commit}:{n}"], capture_output=True, text=True, check=True).stdout)
        prev[os.path.basename(n)[:-5]] = j.get("rows") or {}
    return prev


# ── selftest ───────────────────────────────────────────────────────────────
def _selftest():
    bad = []

    def ok(c, w):
        if not c:
            bad.append(w)

    # crop map: a key from an older period still resolves; special grade and CAD do not
    idx = {"places": [
        {"place": "A||T|IA", "state": "IA", "currency": "USD", "crops": ["corn", "soybeans"], "periods": ["2026-10", "2026-11"],
         "now": {"corn": {"period": "2026-11", "commodity": "Corn"}, "soybeans": {"period": "2026-10", "commodity": "Soybeans"}}},
        {"place": "B||T|IA", "state": "IA", "currency": "USD", "crops": ["corn"], "periods": ["2026-10"],
         "now": {"corn": {"period": "2026-10", "commodity": "Organic Corn"}}},
        {"place": "C||T|ON", "state": "ON", "currency": "CAD", "crops": ["corn"], "periods": ["2026-10"], "now": {"corn": {"period": "2026-10"}}}]}
    cm = crop_map(idx)
    ok(cm.get(de.fnv("A||T|IA|corn|2026-10"))[:2] == ("corn", "IA"), "older period resolves")
    ok(cm[de.fnv("A||T|IA|corn|2026-10")][2] == cm[de.fnv("A||T|IA|corn|2026-11")][2], "both periods are one elevator")
    ok(de.fnv("B||T|IA|corn|2026-10") not in cm and de.fnv("C||T|ON|corn|2026-10") not in cm, "special grade / CAD")

    # hand-worked month: 20 Iowa corn boards over 3 trading days (Oct 13, 14, 15)
    # board i: cash 4.00 + i/100 on day 1, 4.02 + i/100 on day 3; basis -40 then -42 for i < 5, else -40
    prev = {"IA": {}}
    cmap = {}
    for i in range(20):
        k = f"k{i:02d}"
        cmap[k] = ("corn", "IA", k, f"op{i % 4}", True)
        b3 = -42 if i < 5 else -40
        prev["IA"][k] = [["2026-10-13", round(4.00 + i / 100, 4), -40], ["2026-10-14", round(4.01 + i / 100, 4), -40],
                         ["2026-10-15", round(4.02 + i / 100, 4), b3]]
    # one misread board: cash 6.00, basis -40 -> implied 6.40 vs ~4.5: left out each day
    cmap["bad"] = ("corn", "IA", "bad", "op9", True)
    # k00 rolled on Oct 14: its old key carries Oct 13 and 14 too; one row a day, the current period's
    cmap["k00old"] = ("corn", "IA", "k00", "op0", False)
    prev["IA"]["k00old"] = [["2026-10-13", 3.50, -90], ["2026-10-14", 3.50, -90]]
    prev["IA"]["bad"] = [["2026-10-13", 6.0, -40], ["2026-10-14", 6.0, -40], ["2026-10-15", 6.0, -40]]
    prev["IA"]["nomap"] = [["2026-10-14", 4.0, -40]]
    accs = {}
    done = fold(prev, cmap, date(2026, 10, 15), accs, disk=False)        # today Oct 15: only Oct 13 and 14 are complete
    ok(done == ["2026-10-13", "2026-10-14"], f"fold days {done}")
    done2 = fold(prev, cmap, date(2026, 10, 16), accs, disk=False)       # again: only the new day
    ok(done2 == ["2026-10-15"], f"refold {done2}")
    ok(fold(prev, cmap, date(2026, 10, 16), accs, disk=False) == [], "idempotent")
    acc = accs["2026-10"]
    ok(acc["left_out"]["implied"] == 3 and acc["other_rows"] == 1, f"left out {acc['left_out']} {acc['other_rows']}")
    s = summarize(list(acc["boards"].values()))
    # board means: 4.01 + i/100, i = 0..19 -> average 4.105, median 4.105
    ok(s["n"] == 20 and abs(s["avg_cash"] - 4.105) < 1e-9 and abs(s["median_cash"] - 4.105) < 1e-9, f"cash {s}")
    # basis: 5 boards average (-40-40-42)/3 = -40.667, 15 at -40 -> (5*-40.6667 + 15*-40)/20 = -40.1667
    ok(abs(s["avg_basis_cents"] - (-40.17)) < 0.01, f"basis {s['avg_basis_cents']}")
    ok(s["raised"] == 20 and s["cut"] == 0 and s["basis_weaker"] == 5 and s["basis_held"] == 15, f"moves {s}")

    # editions: too few days refused; a 3-day month is partial
    ed, why = build_edition(acc, now=datetime(2026, 10, 17, 12, tzinfo=timezone.utc))
    ok(ed is None and "need 5" in why, f"min days {why}")
    acc5 = json.loads(json.dumps(acc))
    acc5["folded"] = ["2026-10-09", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"]
    ed, why = build_edition(acc5, now=datetime(2026, 10, 17, 12, tzinfo=timezone.utc))
    ok(ed is None or "corn" not in ed["crops"], "20 boards: corn withheld (need 100)")
    ok(ed and ed["partial"] and ed["label"] == "October 9 to 15, 2026, partial month", f"label {ed and ed['label']}")
    # scale to 120 boards in two states: 105 IA, 15 MN; state rows and findings
    big = new_acc("2026-10")
    big["folded"] = acc5["folded"]
    for i in range(120):
        st = "IA" if i < 105 else "MN"
        bs = -40 if st == "IA" else -70
        big["boards"][f"b{i}"] = {"c": "corn", "s": st, "o": f"o{i % 7}", "f": ["2026-10-09", 4.00, bs], "l": ["2026-10-15", 4.10, bs - (2 if i % 10 == 0 else 0)],
                                  "n": 5, "sc": 20.25, "nb": 5, "sb": bs * 5}
    ed, why = build_edition(big, now=datetime(2026, 10, 17, 12, tzinfo=timezone.utc))
    ok(ed and "corn" in ed["crops"], f"big edition {why}")
    if ed:
        c = ed["crops"]["corn"]
        ok(c["overall"]["n"] == 120 and abs(c["overall"]["avg_cash"] - 4.05) < 1e-9, "overall cash 20.25/5")
        ok(abs(c["overall"]["avg_basis_cents"] - (-43.75)) < 1e-9, f"overall basis {c['overall']['avg_basis_cents']}")
        ok(c["states"]["MN"]["avg_basis_cents"] == -70 and c["widest"][0] == "MN" and c["narrowest"][0] == "IA", "widest/narrowest")
        ok(c["overall"]["basis_weaker"] == 12 and c["overall"]["raised"] == 120, "moves")
        ok(any("widest in Minnesota (70¢ under futures, 15 elevators, 7 companies)" in f for f in ed["findings"]), ed["findings"])
        ok(any(f.startswith("This is the first edition.") for f in ed["findings"]), "first edition note")
        ok(2 <= len(ed["findings"]) <= 4, "2 to 4 findings")
        for f in ed["findings"]:
            ok("\u2014" not in f and not re.search(r"\brecord\b|\bever\b", f, re.I), f"words: {f}")
        # month to month: a prior edition 10c lower
        prior = json.loads(json.dumps(ed))
        prior["month"] = "2026-09"
        prior["crops"]["corn"]["overall"]["avg_cash"] = 3.95
        prior["crops"]["corn"]["states"]["IA"]["avg_cash"] = 3.95
        ed2, _ = build_edition(big, prior=prior, now=datetime(2026, 10, 17, 12, tzinfo=timezone.utc))
        ok(ed2["crops"]["corn"]["overall"]["chg_cash_cents"] == 10.0 and ed2["crops"]["corn"]["states"]["IA"]["chg_cash_cents"] == 10.0, "change vs prior")
        ok(any("10¢ higher than September." in f for f in ed2["findings"]), ed2["findings"])
        ok(not any(f.startswith("This is the first edition.") for f in ed2["findings"]), "no first-edition note with a prior")
        # a state under 15 boards prints no numbers
        small = json.loads(json.dumps(big))
        for k in list(small["boards"])[105:111]:
            del small["boards"][k]
        ed3, _ = build_edition(small, now=datetime(2026, 10, 17, 12, tzinfo=timezone.utc))
        ok("avg_cash" not in ed3["crops"]["corn"]["states"]["MN"], "small state withheld")
        t = csv_text(ed)
        ok(t.splitlines()[1].startswith("2026-10,corn,ALL,120,7,4.0500,4.0500,-43.75,"), t.splitlines()[1])
        h = page_html([ed])
        ok('"@type":"Dataset"' in h and "/data/cash-index/2026-10.csv" in h and "How to cite:" in h and "<svg" in h, "page parts")
        ok("\u2014" not in h, "no em dash on the page")
    # a full past month is not partial
    full = new_acc("2026-09")
    full["folded"] = trading_days("2026-09")
    full["boards"] = big["boards"]
    ed4, _ = build_edition(full, now=datetime(2026, 10, 17, 12, tzinfo=timezone.utc))
    ok(ed4 and not ed4["partial"] and ed4["label"] == "September 2026", f"full month {ed4 and ed4['label']}")
    for b in bad:
        print("FAIL", b)
    print("cash_bid_index selftest " + ("FAILED" if bad else "ok"))
    return 1 if bad else 0


# ── main ───────────────────────────────────────────────────────────────────
def _arg(argv, name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


def save_accs(accs):
    for m, a in accs.items():
        dump(acc_path(m), a, compact=True)


def do_fold(argv, now=None):
    import local_bid
    today = ct_today(now)
    prev, _ = de.load_prev(REPO)
    days = sorted({e[0] for sh in prev.values() for h in sh.values() for e in h if isinstance(e, list) and e})
    pending = []
    for d in days:
        try:
            dd = date.fromisoformat(d)
        except ValueError:
            continue
        a = load(acc_path(month_of(d))) or {}
        if dd < today and cc.is_trading_day(dd) and d not in (a.get("folded") or []):
            pending.append(d)
    if not pending:
        print("  [cash-index] nothing new to fold")
        return 0
    index = local_bid.BidsData(_arg(argv, "--bids-base")).index()
    if not index or not index.get("places"):
        print("  [cash-index] network index unreadable; nothing folded (bids-prev keeps 4 days, next run catches up)")
        return 0
    accs = {}
    done = fold(prev, crop_map(index), today, accs)
    save_accs(accs)
    print(f"  [cash-index] folded {', '.join(done) or 'nothing'}")
    return 0


def do_build(m, partial_ok=False, now=None):
    acc = load(acc_path(m))
    if not acc:
        print(f"  [cash-index] no data for {m}")
        return 1
    eds = (load(EDITIONS) or {}).get("editions") or []
    prior = next((e for e in eds if e["month"] == prev_month(m)), None)
    ed, why = build_edition(acc, prior, now)
    if not ed:
        print(f"  [cash-index] {m} withheld: {why}")
        return 1
    if ed["partial"] and not partial_ok:
        print(f"  [cash-index] {m} is partial ({ed['label']}); pass --partial-ok to publish it labeled as such")
        return 1
    eds = [e for e in eds if e["month"] != m] + [ed]
    eds.sort(key=lambda e: e["month"], reverse=True)
    dump(EDITIONS, {"schema": SCHEMA_ED, "url": URL,
                    "note": "One entry per month, built by scripts/cash_bid_index.py from the elevator boards AGSIST reads.",
                    "editions": eds})
    with open(os.path.join(DIR, f"{m}.csv"), "w", encoding="utf-8") as f:
        f.write(csv_text(ed))
    write_page(eds)
    # keep the month's working file for this month and the one before; older
    # ones have an edition already and only cost space on the site
    for fp in glob.glob(os.path.join(DIR, "acc-*.json")):
        old = os.path.basename(fp)[4:11]
        if old < prev_month(m):
            os.remove(fp)
            print(f"  [cash-index] removed {os.path.basename(fp)} (edition {old} is built)")
    for s in ed["findings"]:
        print("  [cash-index] " + s)
    return 0


def main(argv):
    if "--selftest" in argv:
        return _selftest()
    if "--fold" in argv:
        return do_fold(argv)
    if "--backfill" in argv:
        import local_bid
        index = local_bid.BidsData(_arg(argv, "--bids-base")).index()
        cmap = crop_map(index)
        accs = {}
        for commit, day in git_snapshots(_arg(argv, "--since", "2026-10-01")):
            nd = fold(prev_at(commit), cmap, date.fromisoformat(day), accs)
            if nd:
                print(f"  [cash-index] {commit[:9]} ({day}): folded {', '.join(nd)}")
        nd = fold(de.load_prev(REPO)[0], cmap, ct_today(), accs)
        if nd:
            print(f"  [cash-index] working tree: folded {', '.join(nd)}")
        save_accs(accs)
        return 0
    if "--build" in argv:
        m = _arg(argv, "--build")
        if not m or m.startswith("--"):
            m = prev_month(ct_today().isoformat()[:7])
        if "--no-fold" not in argv:
            do_fold(argv)
        return do_build(m, "--partial-ok" in argv)
    if "--page" in argv:
        write_page((load(EDITIONS) or {}).get("editions") or [])
        return 0
    if "--check" in argv:
        want = page_html((load(EDITIONS) or {}).get("editions") or [])
        have = open(PAGE, encoding="utf-8").read() if os.path.exists(PAGE) else ""
        if want != have:
            print("cash-bid-index.html is out of date: run python3 scripts/cash_bid_index.py --page")
            return 1
        print("cash-bid-index.html matches editions.json")
        return 0
    print(__doc__)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
