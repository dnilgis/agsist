#!/usr/bin/env python3
"""
cot_analysis.py — reads data/cot-deep.json, writes data/cot-analysis.json.

WHAT IT IS FOR
--------------
One question: when positioning looked like this before, what happened next?
And a second question the first one hides: does positioning tell you anything
about the future at all, or only about the past?

The second question is measured here, not assumed. correlations() reports the
same-week correlation between fund flow and price beside the forward
correlation from the same weeks. On real data the first is large and the
second is close to zero, and that is the most useful thing this page knows.

WHAT IT REFUSES TO DO
---------------------
Four mistakes make a positioning backtest look better than the trade. All four
push the same way.

  Measuring from a price that had not printed. Positions are as of Tuesday;
  CFTC publishes Friday 3:30pm ET, after the grains settled, and later than
  that when a federal holiday falls in the report week. Returns here start at
  px_entry, which cot_calendar derives from the week's real publication date.

  Reading a roll as a return. Front-month continuous futures step by the whole
  calendar spread when the front month changes. Corn's July-to-September roll
  is old crop to new crop. Returns here are computed on a roll-repaired index.

  Counting overlapping weeks as independent. Weekly sampling of a 13-week
  return shares twelve weeks of the same path. Two matching weeks a fortnight
  apart are not two observations. Episodes are counted with a gap rule of h
  weeks, and significance comes from a block bootstrap, not a t-test.

  Searching until something is significant. Around a hundred tests run every
  week. At p<0.05 five look real by chance. The family is counted, published,
  and put through a Benjamini-Yekutieli control, which is the version that
  holds under arbitrary dependence between the tests.

If that leaves a market with nothing to say, nothing is the output.
"""

import json
import math
import os
import random
import sys
from datetime import date, datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cot_calendar as CAL

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
DATA = os.path.join(ROOT, "data")
DEEP_PATH = os.path.join(DATA, "cot-deep.json")
OUT_PATH = os.path.join(DATA, "cot-analysis.json")

HORIZONS = [4, 8, 13]
MIN_N = 30                                  # matching weeks
MIN_EPISODES = {4: 12, 8: 9, 13: 7}         # independent spells, by horizon
MAX_BAND_SHARE = 0.28                       # a "condition" matching more than
                                            # this much of history is not one
ALPHA = 0.05
BOOT = 20000
SEED = 20260906

LABELS = {
    "corn": "Corn", "beans": "Soybeans", "wheat": "Chicago Wheat",
    "kcwheat": "KC Wheat", "mplswheat": "Minneapolis Wheat",
    "soymeal": "Soybean Meal", "soyoil": "Soybean Oil",
    "livecattle": "Live Cattle", "feedercattle": "Feeder Cattle",
    "leanhogs": "Lean Hogs", "milk": "Class III Milk",
}
GROUPS = {
    "corn": "grain", "beans": "grain", "wheat": "grain", "kcwheat": "grain",
    "mplswheat": "grain", "soymeal": "crush", "soyoil": "crush",
    "livecattle": "livestock", "feedercattle": "livestock",
    "leanhogs": "livestock", "milk": "dairy",
}
# Who the producer/merchant category actually is, per market. One sentence
# saying "they own the bushels" under Live Cattle loses every livestock reader
# on the page, and it is also false: a feedlot hedging forward feeder purchases
# is structurally LONG.
COMMERCIAL_IS = {
    "grain": ("Elevators, merchandisers and processors. Structurally short, "
              "because they own bushels and sell the board against them."),
    "crush": ("Crushers and refiners. They are long beans and short the "
              "products, so their meal and oil hedges sit on the short side."),
    "livestock": ("Packers, feeders and feedlots. Not a one-way category: a "
                  "packer hedging forward cattle purchases sits long, a feedlot "
                  "hedging cattle it owns sits short."),
    "dairy": ("Processors and cooperatives hedging milk they will buy or sell "
              "forward. Both sides are used."),
}
# What the reader of this market actually has unpriced. "Unpriced bushels" was
# hardcoded into the verdict line and would have printed under Feeder Cattle,
# Lean Hogs and Class III Milk. It also assumed a short hedger; a backgrounder
# buying feeders, or an ethanol plant buying corn, has the exposure the other
# way round.
EXPOSURE = {
    "grain": "unpriced bushels, or unbought needs if you are a buyer",
    "crush": "unpriced product, or unbought beans if you are crushing",
    "livestock": "unpriced production, or unbought feeders if you are on the buy side",
    "dairy": "unpriced milk, or unbought feed if you are on the buy side",
}

UNITS = {
    "corn": ("bushels", 5000), "beans": ("bushels", 5000),
    "wheat": ("bushels", 5000), "kcwheat": ("bushels", 5000),
    "mplswheat": ("bushels", 5000),
    "soymeal": ("short tons", 100), "soyoil": ("pounds", 60000),
    "livecattle": ("pounds", 40000), "feedercattle": ("pounds", 50000),
    "leanhogs": ("pounds", 40000), "milk": ("pounds", 200000),
}


# ── statistics, written out rather than imported ────────────────────────────

def mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def median(xs):
    xs = sorted(x for x in xs if x is not None)
    if not xs:
        return None
    n = len(xs)
    return xs[n // 2] if n % 2 else (xs[n // 2 - 1] + xs[n // 2]) / 2


def stdev(xs):
    xs = [x for x in xs if x is not None]
    if len(xs) < 2:
        return None
    m = sum(xs) / len(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1))


def percentile_rank(xs, v):
    """Percent of the record at or below v. Ties count as below, so the highest
    reading on record returns exactly 100.0 and the lowest returns 100/n, not
    0. Callers that need to say "record" must compare to the min or the max,
    not to this number."""
    xs = [x for x in xs if x is not None]
    if not xs or v is None:
        return None
    return round(100.0 * sum(1 for x in xs if x <= v) / len(xs), 1)


def quantile(xs, q):
    xs = sorted(x for x in xs if x is not None)
    if not xs:
        return None
    if len(xs) == 1:
        return xs[0]
    pos = q * (len(xs) - 1)
    lo = int(math.floor(pos))
    hi = min(lo + 1, len(xs) - 1)
    return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo)


def zscore(xs, v):
    s, m = stdev(xs), mean(xs)
    if s in (None, 0) or m is None or v is None:
        return None
    return round((v - m) / s, 2)


def pearson(xs, ys):
    pairs = [(a, b) for a, b in zip(xs, ys) if a is not None and b is not None]
    if len(pairs) < 20:
        return None, len(pairs)
    a = [p[0] for p in pairs]
    b = [p[1] for p in pairs]
    ma, mb = mean(a), mean(b)
    num = sum((x - ma) * (y - mb) for x, y in pairs)
    da = math.sqrt(sum((x - ma) ** 2 for x in a))
    db = math.sqrt(sum((y - mb) ** 2 for y in b))
    if da == 0 or db == 0:
        return None, len(pairs)
    return round(num / (da * db), 3), len(pairs)


def ordinal(n):
    n = int(round(n))
    if 10 <= n % 100 <= 20:
        return f"{n}th"
    return f"{n}{ {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th') }"


def episodes_in(idxs, gap):
    """Independent spells. Two matching weeks separated by less than `gap`
    weeks share most of the same forward price path, so they are one spell.
    Counting contiguous runs only -- treating a one-week break as independence
    -- is how eighty overlapping weeks get published as forty observations."""
    if not idxs:
        return 0
    runs, prev = 1, idxs[0]
    for i in idxs[1:]:
        if i - prev >= gap:
            runs += 1
        prev = i
    return runs


def block_bootstrap_p(series, sample, block, rng, iters=BOOT):
    """Two-sided p for: is the median of `sample` unusual for this series?

    The null resamples the same series in contiguous blocks, so a draw carries
    the persistence the real sample has. Independent-week resampling, or a
    t-test, makes the null far too tight and turns ordinary trending into a
    discovery. Block length is twice the horizon: the overlap is h weeks, but
    the conditioning variable is itself persistent for months, and h alone
    leaves the test anti-conservative at short horizons.
    """
    series = [x for x in series if x is not None]
    k = len(sample)
    if len(series) < block * 4 or k == 0:
        return None
    obs = median(sample)
    centre = median(series)
    if obs is None or centre is None:
        return None
    n = len(series)
    hits = 0
    for _ in range(iters):
        draw = []
        while len(draw) < k:
            start = rng.randrange(n)
            draw.extend(series[(start + j) % n] for j in range(block))
        if abs(median(draw[:k]) - centre) >= abs(obs - centre):
            hits += 1
    return (hits + 1) / (iters + 1)


def benjamini_yekutieli(pvals, alpha=ALPHA):
    """FDR control that holds under ARBITRARY dependence between the tests.

    Benjamini-Hochberg needs positive regression dependence. These tests are
    two-sided bootstrap p-values on overlapping windows of the same price
    series across three horizons of the same market; that assumption is not
    available, so the harmonic-number penalty is the honest price.
    """
    idx = [i for i, p in enumerate(pvals) if p is not None]
    if not idx:
        return set()
    ordered = sorted(idx, key=lambda i: pvals[i])
    m = len(ordered)
    c = sum(1.0 / j for j in range(1, m + 1))
    thresh = 0
    for rank, i in enumerate(ordered, start=1):
        if pvals[i] <= alpha * rank / (m * c):
            thresh = rank
    return {i for rank, i in enumerate(ordered, start=1) if rank <= thresh}


# ── derived series ──────────────────────────────────────────────────────────

def series_for(block):
    n = len(block["dates"])
    g = lambda f: (block.get(f) or [0] * n)
    mm_l, mm_s, mm_sp = g("mm_long"), g("mm_short"), g("mm_spread")
    pm_l, pm_s = g("pm_long"), g("pm_short")
    sw_l, sw_s, sw_sp = g("swap_long"), g("swap_short"), g("swap_spread")
    or_l, or_s = g("or_long"), g("or_short")
    nr_l, nr_s = g("nr_long"), g("nr_short")
    oi = g("oi")
    net = [mm_l[i] - mm_s[i] for i in range(n)]
    comm = [pm_l[i] - pm_s[i] for i in range(n)]
    swap = [sw_l[i] - sw_s[i] for i in range(n)]
    orep = [or_l[i] - or_s[i] for i in range(n)]
    nrep = [nr_l[i] - nr_s[i] for i in range(n)]
    pcto = lambda a: [round(100.0 * a[i] / oi[i], 3) if oi[i] else None for i in range(n)]
    tr_l, tr_s, tr_t = g("tr_mm_long"), g("tr_mm_short"), g("tr_total")
    per_trader = [round(mm_l[i] / tr_l[i], 1) if tr_l[i] else None for i in range(n)]
    per_short = [round(mm_s[i] / tr_s[i], 1) if tr_s[i] else None for i in range(n)]
    # Average book size trends up over the record: open interest has roughly
    # doubled while the reportable trader count has not. Ranked raw, the
    # crowding number reads "record" almost every recent week. Ranked against
    # the market's own average book (OI per reporting trader) it measures what
    # it claims: whether the fund long is unusually concentrated TODAY.
    mkt_book = [round(oi[i] / tr_t[i], 1) if tr_t[i] else None for i in range(n)]
    conc = [round(per_trader[i] / mkt_book[i], 3)
            if (per_trader[i] and mkt_book[i]) else None for i in range(n)]
    conc_s = [round(per_short[i] / mkt_book[i], 3)
              if (per_short[i] and mkt_book[i]) else None for i in range(n)]
    return {
        "net": net, "comm": comm, "swap": swap, "orep": orep, "nrep": nrep,
        "net_oi": pcto(net), "comm_oi": pcto(comm), "swap_oi": pcto(swap),
        "orep_oi": pcto(orep), "nrep_oi": pcto(nrep),
        "oi": oi, "mm_long": mm_l, "mm_short": mm_s, "mm_spread": mm_sp,
        "tr_long": tr_l, "tr_short": tr_s, "tr_total": tr_t,
        "per_trader": per_trader, "conc": conc,
        "per_short_trader": per_short, "conc_short": conc_s,
    }


def forward_returns(px, dates, h):
    """Percent change from each week's entry close to the entry close h weeks
    later, matched BY DATE. Indexing h rows ahead assumes every row is exactly
    seven days apart; one missing week in the archive silently turns a 13-week
    return into a 14-week one under a label that still says 13."""
    pos = {d: i for i, d in enumerate(dates)}
    out = []
    for i, d in enumerate(dates):
        j = pos.get((date.fromisoformat(d) + timedelta(weeks=h)).isoformat())
        a = px[i]
        b = px[j] if j is not None else None
        out.append(round(100.0 * (b - a) / a, 3) if (a and b and a > 0) else None)
    return out


# ── the conditional study ───────────────────────────────────────────────────

def study(name, question, matches, fwd, base, h, rng, n_hist):
    sample = [fwd[i] for i in matches if fwd[i] is not None]
    live = [i for i in matches if fwd[i] is not None]
    gap = h
    eps = episodes_in(live, gap)
    need_eps = MIN_EPISODES[h]
    out = {"name": name, "question": question, "n": len(sample),
           "episodes": eps, "matched_weeks": len(matches),
           "share_of_history": round(len(matches) / max(1, n_hist), 3)}

    if len(matches) > MAX_BAND_SHARE * n_hist:
        out["verdict"] = "insufficient"
        out["why"] = (f"{len(matches)} of {n_hist} weeks on record match this description. "
                      f"That is not a condition, it is most of the history, so the answer "
                      f"would be the base rate wearing a different label.")
        return out
    if len(sample) < MIN_N or eps < need_eps:
        out["verdict"] = "insufficient"
        out["why"] = (f"{len(sample)} comparable weeks in {eps} separate spells "
                      f"(spells at least {gap} weeks apart). This page wants "
                      f"{MIN_N} weeks across {need_eps} spells before it calls "
                      f"anything a pattern.")
        return out

    up = sum(1 for x in sample if x > 0)
    p = block_bootstrap_p(base, sample, 2 * h, rng)
    out.update({
        "median": round(median(sample), 2),
        "mean": round(mean(sample), 2),
        "hit_up": round(up / len(sample), 3),
        "q10": round(quantile(sample, 0.10), 2),
        "q25": round(quantile(sample, 0.25), 2),
        "q75": round(quantile(sample, 0.75), 2),
        "q90": round(quantile(sample, 0.90), 2),
        "worst": round(min(sample), 2),
        "best": round(max(sample), 2),
        "base_median": round(median(base), 2) if base else None,
        "base_hit_up": round(sum(1 for x in base if x > 0) / len(base), 3) if base else None,
        "base_n": len(base),
        "p": round(p, 4) if p is not None else None,
        # The Monte Carlo error on p itself. Printing p to three decimals off
        # 20,000 draws implies a precision the number does not have.
        "p_se": round(math.sqrt(max(p, 1e-6) * (1 - min(p, 1 - 1e-6)) / BOOT), 4) if p is not None else None,
        "verdict": "measured",
    })
    if out["base_median"] is not None:
        out["edge"] = round(out["median"] - out["base_median"], 2)
        out["edge_hit"] = round(out["hit_up"] - out["base_hit_up"], 3)
    return out


def nearest_analogs(feat, dates, fwd_map, i, k=5, spacing=26, max_distance=0.9):
    """The weeks in the record that most resemble this one.

    Standardisation uses only data up to each candidate week, so the choice of
    which weeks to display cannot use information from after them. Rows with
    any missing feature are excluded outright: scoring them on three of five
    measures makes their distance systematically smaller and floods the table
    with 2006-2008, which is exactly what happened the first time this ran.
    """
    m = len(feat[0])
    scored = []
    for j in range(52, i):
        v = feat[j]
        if any(x is None for x in v):
            continue
        if fwd_map[HORIZONS[-1]][j] is None:
            continue
        d2 = 0.0
        ok = True
        for c in range(m):
            col = [feat[t][c] for t in range(j) if feat[t][c] is not None]
            mu, sd = mean(col), stdev(col)
            if mu is None or not sd:
                ok = False
                break
            d2 += ((v[c] - mu) / sd - (feat[i][c] - mu) / sd) ** 2
        if ok:
            scored.append((math.sqrt(d2 / m), j))
    scored.sort()
    picked, used = [], []
    for dist, j in scored:
        if dist > max_distance:
            break
        if any(abs(j - t) < spacing for t in used):
            continue
        used.append(j)
        row = {"date": dates[j], "distance": round(dist, 3)}
        for h in HORIZONS:
            v = fwd_map[h][j]
            row[f"fwd{h}"] = round(v, 2) if v is not None else None
        picked.append(row)
        if len(picked) >= k:
            break
    return picked


def _corr_ci(xs, ys, block, rng, iters=500):
    """Block-bootstrap confidence interval for a correlation.

    The naive standard error on 1,000 weekly observations is about 0.03, and it
    is wrong: a four-week flow measured weekly overlaps three weeks, and an
    eight-week forward return overlaps seven, so the effective sample is closer
    to a hundred and the real interval is several times wider. Publishing 0.03
    bare implies a precision the number does not have, on the one statistic the
    whole page rests on.
    """
    pairs = [(a, b) for a, b in zip(xs, ys) if a is not None and b is not None]
    n = len(pairs)
    if n < 100:
        return None, None
    out = []
    nb = max(1, n // block)
    for _ in range(iters):
        draw = []
        for _ in range(nb):
            st = rng.randrange(n)
            draw.extend(pairs[(st + j) % n] for j in range(block))
        r, _m = pearson([p[0] for p in draw], [p[1] for p in draw])
        if r is not None:
            out.append(r)
    if len(out) < 50:
        return None, None
    out.sort()
    return round(out[int(0.025 * len(out))], 3), round(out[int(0.975 * len(out))], 3)


def correlations(s, px_adj, dates, fwd_map, rng):
    """Does positioning lead price, or follow it?

    Three questions, and it matters that they are asked with the SAME
    predictor. The first version put a ONE-week change on the left and a
    FOUR-week flow on the right, so the drop from 0.41 to 0.03 mixed a change
    of predictor in with the change of horizon. A reader's quant finds that in
    four minutes and the section is the best thing on the page.

      same_week   four-week fund flow against the SAME four weeks of price.
                  Large and positive on real data: funds buy strength.
      flow        the same four-week flow against the NEXT h weeks. This is
                  the one that would make it a forecast.
      level       how stretched positioning is NOW against the next h weeks.
                  This is the contrarian claim -- "funds are crowded long, so
                  watch out below" -- and it is the one the page's own banner
                  was making. It was computed and never shown.
    """
    n = len(dates)
    def chg(k):
        out = []
        for i in range(n):
            a = px_adj[i - k] if i >= k else None
            b = px_adj[i]
            out.append(round(100.0 * (b - a) / a, 3) if (a and b and a > 0) else None)
        return out
    px1, px4 = chg(1), chg(4)
    d_net = [(s["net_oi"][i] - s["net_oi"][i - 1])
             if (i and s["net_oi"][i] is not None and s["net_oi"][i - 1] is not None) else None
             for i in range(n)]
    flow4 = [(s["net_oi"][i] - s["net_oi"][i - 4])
             if (i >= 4 and s["net_oi"][i] is not None and s["net_oi"][i - 4] is not None) else None
             for i in range(n)]

    r4, n4 = pearson(flow4, px4)
    lo4, hi4 = _corr_ci(flow4, px4, 4, rng)
    r1, n1 = pearson(d_net, px1)
    out = {
        "same_week": {"r": r4, "n": n4, "lo": lo4, "hi": hi4,
                      "what": "four-week fund flow against the same four weeks of price"},
        "same_week_1w": {"r": r1, "n": n1},
        "forward": {},
    }
    for h in HORIZONS:
        rf, nf = pearson(flow4, fwd_map[h])
        rl, nl = pearson(s["net_oi"], fwd_map[h])
        flo, fhi = _corr_ci(flow4, fwd_map[h], h, rng)
        llo, lhi = _corr_ci(s["net_oi"], fwd_map[h], h, rng)
        out["forward"][str(h)] = {"flow_r": rf, "flow_n": nf, "flow_lo": flo, "flow_hi": fhi,
                                  "level_r": rl, "level_n": nl, "level_lo": llo, "level_hi": lhi}
    return out


def _room(net_oi, now, oi, hi=True):
    """Contracts between here and the record share of open interest, converted
    at today's open interest."""
    vals = [x for x in net_oi if x is not None]
    if not vals or now is None or not oi:
        return None
    target = max(vals) if hi else min(vals)
    return int(round(abs(target - now) / 100.0 * oi))


def analyse_commodity(key, block, family):
    d = block["dates"]
    n = len(d)
    if n < 120:
        return None
    s = series_for(block)
    px_entry = block.get("px_entry") or [None] * n
    px_adj = block.get("px_adj") or [None] * n
    px_tue = block.get("px_tue") or [None] * n
    fwd_map = {h: forward_returns(px_entry, d, h) for h in HORIZONS}

    i = n - 1
    net, net_oi, comm = s["net"], s["net_oi"], s["comm"]
    w3y, w5y = max(0, i - 156), max(0, i - 260)

    rank_desc = sorted(range(n), key=lambda j: -net[j]).index(i) + 1
    higher = [d[j] for j in range(n) if net[j] > net[i]]
    hi_j = max(range(n), key=lambda j: net[j])
    lo_j = min(range(n), key=lambda j: net[j])

    # Price momentum comes off the roll-repaired index at the AS-OF Tuesday, a
    # price that exists on release night. Reading it off the entry close would
    # blank the whole board every Friday until the following week filled in.
    mom = []
    for j in range(n):
        a = px_adj[j - 13] if j >= 13 else None
        b = px_adj[j]
        mom.append(round(100.0 * (b - a) / a, 3) if (a and b and a > 0) else None)

    unit, size = UNITS.get(key, ("units", 1))
    out = {
        "key": key, "label": LABELS.get(key, key), "group": GROUPS.get(key, "other"),
        "date": d[i], "release_date": CAL.release_date(date.fromisoformat(d[i])).isoformat(),
        "entry_date": (block.get("px_entry_date") or [None])[i],
        "weeks_of_history": n, "first_week": d[0],
        "gaps": len(block.get("gaps") or []),
        "net": net[i], "net_prev": net[i - 1], "chg": net[i] - net[i - 1],
        "chg4": net[i] - net[i - 4] if i >= 4 else None,
        "oi": s["oi"][i], "net_oi": net_oi[i],
        # The week's change measured so it can be compared across markets, and
        # scored against this market's own history of weekly changes.
        "chg_oi": (round(100.0 * (net[i] - net[i - 1]) / s["oi"][i], 2) if s["oi"][i] else None),
        "chg_z": None,
        "pctl_prev": percentile_rank(net_oi[:i], net_oi[i - 1]),
        "mm_long": s["mm_long"][i], "mm_short": s["mm_short"][i],
        "mm_spread": s["mm_spread"][i],
        "unit": unit, "contract_size": size,
        "price": px_tue[i], "price_prev": px_tue[i - 1],
        "momentum13": mom[i],
        "pctl": {
            "net_oi_all": percentile_rank(net_oi, net_oi[i]),
            "net_oi_5y": percentile_rank(net_oi[w5y:], net_oi[i]),
            "net_all": percentile_rank(net, net[i]),
        },
        "z": {"net_oi_3y": zscore([x for x in net_oi[w3y:i]], net_oi[i])},
        # Records are judged on share of open interest, which is the measure
        # the whole page ranks on. Judged on raw contracts, a market whose open
        # interest has tripled sets a "record" most years for no reason.
        "is_record_high": net_oi[i] is not None and net_oi[i] >= max(x for x in net_oi if x is not None),
        "is_record_low": net_oi[i] is not None and net_oi[i] <= min(x for x in net_oi if x is not None),
        "rank": {"desc": rank_desc, "of": n,
                 "last_higher": higher[-1] if higher else None,
                 "record_high": {"date": d[hi_j], "net": net[hi_j]},
                 "record_low": {"date": d[lo_j], "net": net[lo_j]}},
        # Three different distances, because the old single number answered a
        # question nobody asks. "If it unwound" is going FLAT; the distance to
        # the record on the other side is a full reversal that has essentially
        # never happened inside a quarter. And the record is anchored in share
        # of open interest, then converted at today's open interest, because a
        # raw-contract record set when the market was half this size is not a
        # level this market can return to.
        "capacity": {
            "to_flat": abs(net[i]),
            "to_flat_oi": round(abs(net_oi[i]), 1) if net_oi[i] is not None else None,
            "room_up": _room(net_oi, net_oi[i], s["oi"][i], hi=True),
            "room_down": _room(net_oi, net_oi[i], s["oi"][i], hi=False),
            "room_up_oi": (round(max(x for x in net_oi if x is not None) - net_oi[i], 1)
                           if net_oi[i] is not None else None),
            "room_down_oi": (round(net_oi[i] - min(x for x in net_oi if x is not None), 1)
                             if net_oi[i] is not None else None),
            "record_high_share": round(max(x for x in net_oi if x is not None), 1),
            "record_low_share": round(min(x for x in net_oi if x is not None), 1),
        },
        "exposure_noun": EXPOSURE.get(GROUPS.get(key, ""), "unpriced production"),
        # Every category, netted, summing to zero. This is the only question
        # the report is structured to answer: managed money bought, and
        # somebody sold. Swap dealers carry the index length in grains and
        # were missing from this page entirely.
        "decomposition": [
            {"key": "mm", "label": "Managed money", "net": s["net"][i],
             "oi": net_oi[i], "chg": s["net"][i] - s["net"][i - 1]},
            {"key": "pm", "label": "Producer / merchant", "net": comm[i],
             "oi": s["comm_oi"][i], "chg": comm[i] - comm[i - 1]},
            {"key": "swap", "label": "Swap dealers", "net": s["swap"][i],
             "oi": s["swap_oi"][i], "chg": s["swap"][i] - s["swap"][i - 1]},
            {"key": "or", "label": "Other reportables", "net": s["orep"][i],
             "oi": s["orep_oi"][i], "chg": s["orep"][i] - s["orep"][i - 1]},
            {"key": "nr", "label": "Small traders", "net": s["nrep"][i],
             "oi": s["nrep_oi"][i], "chg": s["nrep"][i] - s["nrep"][i - 1]},
        ],
        "commercial": {
            "net": comm[i], "net_oi": s["comm_oi"][i],
            "pctl_all": percentile_rank(comm, comm[i]),
            "chg": comm[i] - comm[i - 1],
            "who": COMMERCIAL_IS.get(GROUPS.get(key, ""), ""),
            # The static blurb says grain commercials are structurally short.
            # They are, usually. When they are not, saying so is the most
            # interesting line on the panel, and printing "structurally short"
            # above a net long number is the page contradicting itself on
            # screen.
            "against_type": (GROUPS.get(key) in ("grain", "crush") and comm[i] > 0),
        },
    }

    # Concentration on the side the position is actually on. Measuring the long
    # side of a market whose whole story is a record short describes the wrong
    # book: 126 funds holding 442 each is not the number that matters when 61
    # funds hold six times that on the other side.
    tl, ts = s["tr_long"][i], s["tr_short"][i]
    on_long = net[i] >= 0
    tn = tl if on_long else ts
    per = s["per_trader"][i] if on_long else s["per_short_trader"][i]
    conc_series = s["conc"] if on_long else s["conc_short"]
    if tn and tn >= 20 and conc_series[i] is not None:
        out["crowding"] = {
            "side": "long" if on_long else "short",
            "traders_long": tl, "traders_short": ts,
            "traders_on_side": tn,
            "per_trader": per,
            # Ranked against the trailing three years, and against the market's
            # own average book, so it is not just a proxy for the calendar.
            "pctl": percentile_rank([x for x in conc_series[w3y:i] if x], conc_series[i]),
            "window": "3 years",
        }

    # Seasonality, with the year boundary closed. ISO weeks 52 and 1 are one
    # week apart in the world and 51 apart in subtraction, which quietly halved
    # the sample for the first report of January -- the week it is most read.
    wk = date.fromisoformat(d[i]).isocalendar()[1]
    sel = []
    for j in range(n - 1):
        dj = date.fromisoformat(d[j])
        w = dj.isocalendar()[1]
        # A 52-week ISO year makes weeks 52 and 1 one week apart; a 53-week
        # year makes 53 and 1 one week apart. Using a constant 53 closes one of
        # those and leaves the other open, which is how the first report of
        # January lost a third of its sample.
        L = date(dj.year, 12, 28).isocalendar()[1]
        if min(abs(w - wk), L - abs(w - wk)) <= 1 and net_oi[j] is not None:
            sel.append((d[j][:4], net_oi[j]))
    if len(sel) >= 10:
        out["seasonal"] = {
            "week": wk, "weeks": len(sel), "years": len({y for y, _ in sel}),
            "median_net_oi": round(median([v for _, v in sel]), 2),
            "now_net_oi": net_oi[i],
            "deviation": round(net_oi[i] - median([v for _, v in sel]), 2) if net_oi[i] is not None else None,
        }

    wchg = [(100.0 * (net[j] - net[j - 1]) / s["oi"][j]) if (j and s["oi"][j]) else None
            for j in range(n)]
    out["chg_z"] = zscore([x for x in wchg[:i] if x is not None], wchg[i])

    out["correlation"] = correlations(s, px_adj, d, fwd_map,
                                      random.Random(f"{SEED}:corr:{key}"))

    # ── conditions ─────────────────────────────────────────────────────────
    # All three are two-sided and ANCHORED ON THIS WEEK: "weeks that look like
    # this one on measure X". The first version used one-sided bands (z >=
    # cur_z - 0.5), which for an ordinary reading matched half the record and
    # answered a question about the top quartile while claiming to answer one
    # about today.
    z_series = []
    for j in range(n):
        lo = max(0, j - 156)
        z_series.append(zscore(net[lo:j], net[j]) if j - lo >= 52 else None)
    cur_z = z_series[i]

    flow = [(net_oi[j] - net_oi[j - 4])
            if (j >= 4 and net_oi[j] is not None and net_oi[j - 4] is not None) else None
            for j in range(n)]
    cur_f = flow[i]

    sd_oi = stdev([x for x in net_oi if x is not None]) or 1.0
    sd_fl = stdev([x for x in flow if x is not None]) or 1.0

    studies = {}
    for h in HORIZONS:
        fwd = fwd_map[h]
        base = [x for x in fwd if x is not None]
        elig = [j for j in range(n) if fwd[j] is not None]
        hs = {}
        rng_for = lambda cond: random.Random(f"{SEED}:{key}:{h}:{cond}")

        if cur_z is not None and abs(cur_z) >= 1.0:
            band = [j for j in elig if z_series[j] is not None and abs(z_series[j] - cur_z) <= 0.35]
            q = (f"Weeks when managed money sat about this far from its own three-year "
                 f"normal ({'long' if cur_z > 0 else 'short'} side, within a third of a "
                 f"standard deviation of today).")
            hs["positioning"] = study("positioning", q, band, fwd, base, h, rng_for("positioning"), len(elig))
            family.append((key, h, "positioning", hs["positioning"], True))

        if net_oi[i] is not None:
            tol = 0.25 * sd_oi
            band = [j for j in elig if net_oi[j] is not None and abs(net_oi[j] - net_oi[i]) <= tol]
            q = (f"Weeks when funds held about the same share of the market as now "
                 f"({net_oi[i]:+.1f}% of open interest, within {tol:.1f} points). Share of "
                 f"open interest rather than contracts, so a {d[0][:4]} reading and a "
                 f"{d[i][:4]} reading are the same claim.")
            hs["share_of_oi"] = study("share_of_oi", q, band, fwd, base, h, rng_for("share_of_oi"), len(elig))
            family.append((key, h, "share_of_oi", hs["share_of_oi"], True))

        if cur_f is not None and abs(cur_f) >= 0.5:
            tol = 0.4 * sd_fl
            band = [j for j in elig if flow[j] is not None and abs(flow[j] - cur_f) <= tol]
            q = (f"Weeks when funds had just moved at about this pace: a four-week swing of "
                 f"{cur_f:+.1f}% of open interest, within {tol:.1f} points.")
            hs["flow"] = study("flow", q, band, fwd, base, h, rng_for("flow"), len(elig))
            family.append((key, h, "flow", hs["flow"], True))

        studies[str(h)] = hs

    out["studies"] = studies
    out["base"] = {}
    for h in HORIZONS:
        b = [x for x in fwd_map[h] if x is not None]
        out["base"][str(h)] = {
            "n": len(b),
            "median": round(median(b), 2) if b else None,
            "hit_up": round(sum(1 for x in b if x > 0) / len(b), 3) if b else None,
            "q10": round(quantile(b, 0.10), 2) if b else None,
            "q25": round(quantile(b, 0.25), 2) if b else None,
            "q75": round(quantile(b, 0.75), 2) if b else None,
            "q90": round(quantile(b, 0.90), 2) if b else None,
        }

    feat = [[z_series[j], net_oi[j], flow[j], s["comm_oi"][j], mom[j]] for j in range(n)]
    out["analogs"] = nearest_analogs(feat, d, fwd_map, i) if all(x is not None for x in feat[i]) else []
    return out


def build_read(c):
    """One sentence. Plain words, no adjectives the data has not earned."""
    lab, net, p = c["label"], c["net"], c["pctl"]["net_oi_all"]
    side = "long" if net > 0 else "short"
    share = (f" ({abs(c['net_oi']):.1f}% of all open contracts)"
             if c["net_oi"] is not None else "")
    if c["is_record_high"] or c["is_record_low"]:
        where = f"the biggest net {side} of any week since {c['first_week'][:4]}"
    elif p is not None and (p >= 90 or p <= 10):
        rarer = (100 - p) if net > 0 else p
        where = (f"a bigger net {side} than {100 - rarer:.0f}% of weeks since "
                 f"{c['first_week'][:4]}")
    elif p is not None and (p >= 75 or p <= 25):
        where = (f"the {ordinal(p)} percentile since {c['first_week'][:4]}, on the "
                 f"{'high' if p >= 75 else 'low'} side but not extreme")
    elif p is not None:
        where = f"the {ordinal(p)} percentile since {c['first_week'][:4]}, which is normal"
    else:
        where = "with no history to rank it against"
    cap = c["capacity"]
    if net > 0 and cap["room_down"] > 0:
        tail = (f"It would take {cap['room_down']:,} contracts of selling to get back to "
                f"the record low.")
    elif net < 0 and cap["room_up"] > 0:
        tail = (f"It would take {cap['room_up']:,} contracts of buying to get back to "
                f"the record high.")
    else:
        tail = ""
    return f"{lab}: funds are net {side} {abs(net):,} contracts{share}, {where}. {tail}".strip()


def board_summary(out):
    ps = [(k, c["pctl"]["net_oi_all"]) for k, c in out.items() if c["pctl"]["net_oi_all"] is not None]
    if not ps:
        return None
    vals = [v for _, v in ps]
    # WHAT MOVED. 84k contracts in corn and 28k in Chicago wheat are not
    # comparable, and the page had no way to say which was the bigger event.
    # Ranked on the week's change as a share of open interest.
    moves = []
    for k, c in out.items():
        if c.get("chg_oi") is None:
            continue
        moves.append({"key": k, "label": c["label"], "chg": c["chg"], "chg_oi": c["chg_oi"],
                      "z": c.get("chg_z"), "pctl": c["pctl"]["net_oi_all"],
                      "pctl_prev": c.get("pctl_prev")})
    moves.sort(key=lambda m: -abs(m["chg_oi"]))
    return {
        "mean_pctl": round(sum(vals) / len(vals), 1),
        "n": len(vals),
        "stretched_long": [{"key": k, "label": out[k]["label"], "pctl": v}
                           for k, v in sorted(ps, key=lambda kv: -kv[1])[:3]],
        "stretched_short": [{"key": k, "label": out[k]["label"], "pctl": v}
                            for k, v in sorted(ps, key=lambda kv: kv[1])[:3]],
        "extremes": sum(1 for v in vals if v >= 90 or v <= 10),
        "moves": moves,
    }


def board_correlation(out):
    """Three numbers for the whole page. The first says positioning follows
    price. The second says recent buying does not forecast it. The third is the
    contrarian claim itself: does being stretched now predict the next quarter?"""
    rows = []
    for k, c in out.items():
        cor = c.get("correlation") or {}
        f8 = (cor.get("forward") or {}).get("8") or {}
        f13 = (cor.get("forward") or {}).get("13") or {}
        sw = cor.get("same_week") or {}
        if sw.get("r") is None:
            continue
        rows.append({"key": k, "label": c["label"],
                     "same_week_r": sw.get("r"), "same_week_lo": sw.get("lo"), "same_week_hi": sw.get("hi"),
                     "forward_r": f8.get("flow_r"), "forward_lo": f8.get("flow_lo"), "forward_hi": f8.get("flow_hi"),
                     "level_r": f13.get("level_r"), "level_lo": f13.get("level_lo"), "level_hi": f13.get("level_hi")})
    if not rows:
        return None
    take = lambda f: [r[f] for r in rows if r[f] is not None]
    return {"rows": rows,
            "median_same_week": round(median(take("same_week_r")), 3) if take("same_week_r") else None,
            "median_forward": round(median(take("forward_r")), 3) if take("forward_r") else None,
            "median_level": round(median(take("level_r")), 3) if take("level_r") else None,
            "level_negative": sum(1 for v in take("level_r") if v < 0),
            "n_markets": len(rows)}


def main():
    if "--selftest" in sys.argv:
        return selftest()
    if not os.path.exists(DEEP_PATH):
        print(f"FATAL: {DEEP_PATH} missing. Run cot_deep.py --rebuild first.", file=sys.stderr)
        return 1
    with open(DEEP_PATH) as f:
        deep = json.load(f)

    family, out = [], {}
    for key, block in deep["commodities"].items():
        try:
            r = analyse_commodity(key, block, family)
        except Exception as e:
            print(f"  {key}: analysis failed ({e})", flush=True)
            r = None
        if r:
            r["read"] = build_read(r)
            out[key] = r
            print(f"  {key:12s} net={r['net']:>9,}  pctl={r['pctl']['net_oi_all']}  "
                  f"z3y={r['z']['net_oi_3y']}  analogs={len(r['analogs'])}", flush=True)

    measured = [t for t in family if t[3].get("verdict") == "measured" and t[3].get("p") is not None]
    pvals = [t[3]["p"] for t in measured]
    survivors = benjamini_yekutieli(pvals)
    for idx, t in enumerate(measured):
        t[3]["fdr_pass"] = idx in survivors
    for t in family:
        t[3].setdefault("fdr_pass", False)
    raw_hits = sum(1 for p in pvals if p < ALPHA)

    # A p-value grid coarser than the correction threshold makes the correction
    # unpassable, and the page would print "nothing survives" as if it were a
    # finding rather than a rounding artefact.
    m = max(1, len(pvals))
    c = sum(1.0 / j for j in range(1, m + 1))
    floor_p = 1.0 / (BOOT + 1)
    if floor_p >= ALPHA / (m * c):
        print(f"WARNING: bootstrap resolution {floor_p:.5f} is coarser than the BY "
              f"threshold {ALPHA/(m*c):.5f}. Raise BOOT.", file=sys.stderr)

    latest = max((c2["date"] for c2 in out.values()), default=None)
    payload = {
        "updated": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "report_date": latest,
        "release_date": next((c2.get("release_date") for c2 in out.values() if c2.get("release_date")), None),
        "entry_date": next((c2.get("entry_date") for c2 in out.values() if c2.get("entry_date")), None),
        "method": {
            "source": "CFTC Disaggregated Commitments of Traders, futures only, all contract months.",
            "entry": ("Forward returns start at the first session close after CFTC published, "
                      "using each week's real publication date. Federal holidays delay the "
                      "release, and roughly one week in seven is not a Friday."),
            "price": ("Front-month continuous futures with the roll steps removed. The return "
                      "across each front-month change is dropped rather than counted, so an "
                      "old-crop-to-new-crop roll is not read as a rally."),
            "overlap": ("Weekly sampling of multi-week returns overlaps. Each read shows spells "
                        "as well as weeks: matches closer together than the horizon count once."),
            "significance": ("Circular block bootstrap, block length twice the horizon, "
                             f"{BOOT:,} draws."),
            "multiplicity": (f"{len(measured)} tests produced a p-value this week out of "
                             f"{len(family)} attempted. At p<{ALPHA} you would expect "
                             f"{len(measured) * ALPHA:.1f} to look significant by chance. "
                             f"{raw_hits} did. {len(survivors)} survive a Benjamini-Yekutieli "
                             f"false-discovery control across the family."),
            "conditions": ("Each condition is anchored on this week's reading, so the question "
                           "is always 'weeks that looked like this one'. That means the threshold "
                           "moves every week; the correction below covers one week's family, not "
                           "the sequence of weeks a regular reader sees."),
            "gates": (f"A read is withheld below {MIN_N} comparable weeks, below the horizon's "
                      f"spell count, or above {int(MAX_BAND_SHARE*100)}% of the record."),
        },
        "family": {"tests": len(measured), "attempted": len(family),
                   "expected_by_chance": round(len(measured) * ALPHA, 1),
                   "raw_hits": raw_hits, "fdr_survivors": len(survivors)},
        "board": board_summary(out),
        "predictive": board_correlation(out),
        "coverage": {"first_week": min((c2["first_week"] for c2 in out.values()), default=None),
                     "weeks": max((c2["weeks_of_history"] for c2 in out.values()), default=0)},
        "commodities": out,
    }
    with open(OUT_PATH, "w") as f:
        json.dump(payload, f, separators=(",", ":"))
    pr = payload["predictive"]
    print(f"\n{len(measured)} tests · {raw_hits} at p<{ALPHA} · {len(survivors)} survive "
          f"(expected by chance {len(measured)*ALPHA:.1f})")
    if pr:
        print(f"median same-week correlation {pr['median_same_week']}, "
              f"median 8-week forward correlation {pr['median_forward']}")
    print(f"Written {OUT_PATH} ({os.path.getsize(OUT_PATH)/1024:.0f} KB)")
    return 0


# ── selftest ────────────────────────────────────────────────────────────────

def selftest():
    fails = []

    def ck(name, got, want, tol=1e-9):
        ok = (got is None and want is None) or (
            got is not None and want is not None and abs(got - want) <= tol)
        print(f"{'PASS' if ok else 'FAIL'}  {name:56s} {got!r}" + ("" if ok else f"  -- want {want!r}"))
        if not ok:
            fails.append(name)

    def ckt(name, cond, why=""):
        print(f"{'PASS' if cond else 'FAIL'}  {name:56s}{'' if cond else '  -- ' + why}")
        if not cond:
            fails.append(name)

    ck("median odd", median([3, 1, 2]), 2)
    ck("median even", median([4, 1, 3, 2]), 2.5)
    ck("median skips None", median([1, None, 3]), 2)
    ck("stdev of 1,2,3,4 (sample)", stdev([1, 2, 3, 4]), 1.2909944487, 1e-9)
    ck("stdev of a constant", stdev([5, 5, 5]), 0)
    ck("zscore with no spread is None", zscore([5, 5, 5], 9), None)
    ck("percentile of the max is 100", percentile_rank([1, 2, 3, 4], 4), 100.0)
    ck("percentile of a tie", percentile_rank([1, 2, 2, 4], 2), 75.0)
    ck("quantile interpolates", quantile([0, 10], 0.25), 2.5)

    ckt("ordinal 1/2/3", (ordinal(1), ordinal(2), ordinal(3)) == ("1st", "2nd", "3rd"))
    ckt("ordinal 11/12/13 are th", (ordinal(11), ordinal(12), ordinal(13)) == ("11th", "12th", "13th"))
    ckt("ordinal 21/63/100", (ordinal(21), ordinal(63), ordinal(100)) == ("21st", "63rd", "100th"),
        f"got {ordinal(21)},{ordinal(63)},{ordinal(100)}")

    ck("episodes: a run is one spell", float(episodes_in([4, 5, 6, 7], 4)), 1.0)
    ck("episodes: a one-week gap is NOT independence",
       float(episodes_in([1, 2, 4, 5], 13)), 1.0)
    ck("episodes: seven weeks apart is still one spell at h=13",
       float(episodes_in([1, 2, 9, 10], 13)), 1.0)
    ck("episodes: beyond the horizon it is a new spell",
       float(episodes_in([1, 2, 9, 10, 30], 13)), 2.0)
    ck("episodes: same list, shorter horizon, more spells",
       float(episodes_in([1, 2, 9, 10, 30], 4)), 3.0)
    ck("episodes: empty", float(episodes_in([], 4)), 0.0)

    dates = [(date(2026, 1, 6) + timedelta(weeks=i)).isoformat() for i in range(5)]
    px = [100.0, 110.0, 121.0, None, 133.0]
    f1 = forward_returns(px, dates, 1)
    ck("forward 1wk 100->110", f1[0], 10.0, 1e-6)
    ckt("a missing price yields None, never 0", f1[2] is None and f1[3] is None)
    ck("forward 2wk 100->121", forward_returns(px, dates, 2)[0], 21.0, 1e-6)
    # A MISSING WEEK MUST NOT SILENTLY BECOME A LONGER HORIZON.
    holed = dates[:3] + [(date(2026, 1, 6) + timedelta(weeks=4)).isoformat()]
    ckt("a gap in the calendar yields None, not a 4-week return",
        forward_returns([100.0, 110.0, 121.0, 133.0], holed, 3)[0] is None,
        "date-matched, so a missing row cannot stretch the horizon")

    from datetime import date as _d
    ckt("entry is after the release", CAL.entry_date(_d(2026, 9, 1)) > CAL.release_date(_d(2026, 9, 1)))
    ckt("a holiday in the report week delays the release",
        CAL.release_date(_d(2026, 9, 8)) == _d(2026, 9, 14))

    rng = random.Random(1)
    ckt("bootstrap on a flat series is not significant",
        (block_bootstrap_p([0.0] * 400, [0.0] * 40, 8, rng, iters=400) or 0) > ALPHA)
    ckt("bootstrap refuses a series shorter than four blocks",
        block_bootstrap_p([1.0] * 10, [1.0], 8, rng, iters=100) is None)
    ckt("bootstrap is deterministic for a given seed",
        block_bootstrap_p(list(range(200)), list(range(30)), 4, random.Random(7), iters=300)
        == block_bootstrap_p(list(range(200)), list(range(30)), 4, random.Random(7), iters=300))

    # BY is BH divided by the harmonic number. m=5 -> c = 1+1/2+1/3+1/4+1/5
    # = 2.2833, so the rank-k threshold is 0.00438*k: rank 1 admits 0.001,
    # rank 2 would need <= 0.00876 and 0.02 misses it.
    keep = benjamini_yekutieli([0.001, 0.02, 0.039, 0.041, 0.9])
    ckt("BY keeps only the first", keep == {0}, f"got {sorted(keep)}")
    ckt("BY admits a second when it clears the tighter step",
        benjamini_yekutieli([0.001, 0.008, 0.039, 0.041, 0.9]) == {0, 1})
    ckt("BY keeps nothing when nothing is small", benjamini_yekutieli([0.4, 0.6, 0.9]) == set())
    ckt("BY is stricter than BH on the same input", len(keep) <= 2)

    r, nn = pearson([1, 2, 3, 4, 5] * 5, [2, 4, 6, 8, 10] * 5)
    ck("pearson of a perfect line", r, 1.0, 1e-9)
    ckt("pearson refuses a short sample", pearson([1, 2, 3], [1, 2, 3])[0] is None)

    fw = [1.0] * 400
    tiny = study("t", "q", list(range(10)), fw, fw, 4, rng, 400)
    ckt("a 10-week sample is withheld", tiny["verdict"] == "insufficient")
    wide = study("t", "q", list(range(300)), fw, fw, 4, rng, 400)
    ckt("a band covering 75% of history is withheld", wide["verdict"] == "insufficient")
    ckt("and says so in words", "most of the history" in wide.get("why", ""))
    one_spell = study("t", "q", list(range(100)), fw, fw, 13, rng, 400)
    ckt("100 weeks in one spell is withheld", one_spell["verdict"] == "insufficient")

    blk = {"dates": ["2026-01-06"], "oi": [1000], "mm_long": [300], "mm_short": [100],
           "pm_long": [100], "pm_short": [500], "swap_long": [250], "swap_short": [50],
           "or_long": [200], "or_short": [150], "nr_long": [150], "nr_short": [200],
           "tr_mm_long": [10], "tr_mm_short": [5], "tr_total": [100]}
    s = series_for(blk)
    ck("net = long - short", float(s["net"][0]), 200.0)
    ck("net as % of open interest", s["net_oi"][0], 20.0)
    ck("commercial net", float(s["comm"][0]), -400.0)
    ck("contracts per long fund", s["per_trader"][0], 30.0)
    total = s["net"][0] + s["comm"][0] + s["swap"][0] + s["orep"][0] + s["nrep"][0]
    ck("every category nets to zero", float(total), 0.0)
    ckt("zero open interest gives None, not a division error",
        series_for({"dates": ["x"], "oi": [0], "mm_long": [5], "mm_short": [1]})["net_oi"][0] is None)

    print()
    if fails:
        print(f"{len(fails)} check(s) failed: " + ", ".join(fails))
        return 1
    print("All checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
