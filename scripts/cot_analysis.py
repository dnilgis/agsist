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

  Searching until something is significant. Dozens of tests run every week
  (the count is written to the output's "family" block), and at p<0.05 one in
  twenty looks real by chance. The family is counted, published,
  and put through a Benjamini-Yekutieli control, which is the version that
  holds under arbitrary dependence between the tests.

If that leaves a market with nothing to say, nothing is the output.
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass

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

# ONE DEFINITION OF "CROWDED", USED BY EVERY SENTENCE ON THE PAGE. Before
# 2026-10-06 the page had four: 90/10 on share of open interest (board, banner),
# 80/20 (scatter quadrants), 85/15 on raw contracts over 52 weeks ignoring the
# sign (card flag and The Read), and 85/15 on trader concentration. Feeder
# Cattle, net LONG, was called "crowded short" by the third. Crowded now means
# the full-record percentile of net as a share of open interest is at or beyond
# these, AND the position is on that side of zero.
CROWDED_HI = 90.0
CROWDED_LO = 10.0

# ONE DEFINITION OF "FLAT". A fixed +/-5,000 contracts was 0.27% of open
# interest in corn and 13.9% in Class III milk. Flat is now a share of the
# market's own open interest. fetch_cot.py imports side_of() so the cards, the
# banner and this file cannot disagree about which markets are flat.
FLAT_OI_PCT = 2.0

# The card statistics are a trailing year of weekly reports, the current week
# included.
CARD_WEEKS = 52
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


def shown_pct(p, crowded):
    """The whole percentile printed beside 'crowded' or 'not crowded'. Rounding
    must not carry a not-crowded 89.8 up to the 90th, the crowded line itself
    (corn, 2026-10-18 accuracy pass); the same for 10.2 down to the 10th."""
    n = min(99, max(1, round(p)))
    if not crowded and n >= CROWDED_HI and p < CROWDED_HI:
        n = int(CROWDED_HI) - 1
    if not crowded and n <= CROWDED_LO and p > CROWDED_LO:
        n = int(CROWDED_LO) + 1
    return n


def rank_words(p, net, crowded, since):
    """The headline rank in words, never an ordinal (2026-11-06,  read
    like a finishing place). p is the at-or-below percentile of net as a share of
    open interest since `since`. A long (or a net of zero) is "higher than N% of
    weeks since 2010"; a short is "a bigger net short than N% of weeks since 2010",
    N counted from the other end. N is the printed whole number (shown_pct), so the
    words and every other print of this rank agree. None without a percentile."""
    if p is None:
        return None
    n = shown_pct(p, crowded)
    if net is not None and net < 0:
        return f"a bigger net short than {100 - n}% of weeks since {since}"
    return f"higher than {n}% of weeks since {since}"


def record_words(c):
    """A record said with its measure and its start year, or None. Contracts and
    share of open interest are different measures and each is named: lean hogs on
    Oct 27, 2026 (-51,646) were the largest net short in contracts since 2010 while
    the share of open interest was second to Sep 29. Never "record" without both."""
    since = (c.get("first_week") or "")[:4]
    rc = c.get("record_contracts")
    if rc:
        return f"the largest net {rc['side']} in contracts since {since}"
    net = c.get("net") or 0
    if c.get("is_record_high") and net > 0:
        return f"the largest net long as a share of open interest since {since}"
    if c.get("is_record_low") and net < 0:
        return f"the largest net short as a share of open interest since {since}"
    return None


def crowded_side(net, p):
    """'long', 'short' or None. The sign has to agree with the percentile: a
    net-long market at the 6th percentile of its record is a small long, not a
    crowded short."""
    if net is None or p is None:
        return None
    if p >= CROWDED_HI and net > 0:
        return "long"
    if p <= CROWDED_LO and net < 0:
        return "short"
    return None


def crowd_word(p):
    """The page's word for a full-record share-of-open-interest percentile
    (cot.html crowdWord, same cut points). Pipeline copy so the futures pages,
    the homepage and the scorecard print the word without recomputing it."""
    if p is None:
        return "no ranking"
    if p >= 99:
        return "top 1%"
    if p >= 90:
        return f"top {max(1, math.floor(100 - p + 0.5))}%"   # Math.round, as cot.html rounds
    if p >= 75:
        return "high side"
    if p <= 1:
        return "bottom 1%"
    if p <= 10:
        return f"bottom {max(1, math.floor(p + 0.5))}%"
    if p <= 25:
        return "low side"
    return "middling"


# What the COT page's own tests say about using positioning to call price.
# Measured, not assumed: the share-of-open-interest study and the forward
# correlations (board_correlation) find no timing signal; a reading that does
# pass the false-discovery correction is named instead.
TESTED_NONE = ("Nothing the COT page tested says which way price goes next. "
               "Positioning shows how much selling (or buying) could be forced "
               "if the market turns, not when.")


def crowd_summary(c):
    """The one crowding read every page prints, from the one measure: the
    full-record percentile of managed-money net as a share of open interest,
    counted on the side the position is on. Called after the family's
    family's correction has set `passes` on the studies."""
    p = (c.get("pctl") or {}).get("net_oi_all")
    held = any(st.get("verdict") == "measured" and st.get("passes")
               for g in (c.get("studies") or {}).values() for st in g.values())
    side = "long" if (c.get("net") or 0) > 0 else "short" if (c.get("net") or 0) < 0 else "flat"
    return {
        "pctl": p,
        # the whole number every page prints (shown_pct): one rounding and
        # clamp, so the COT card and The Read cannot say 90th and 89th for
        # one 89.8 (soybeans, 2026-10-20 panel F3)
        "shown": shown_pct(p, c.get("crowded")) if p is not None else None,
        "word": crowd_word(p),
        "crowded": c.get("crowded"),
        "side": side,
        "since": (c.get("first_week") or "")[:4] or None,
        "weeks": c.get("weeks_of_history"),
        "measure": "managed-money net as a share of open interest, ranked against every week since "
                   + ((c.get("first_week") or "")[:4] or "the start of the record"),
        "held": held,
        "tested": ("One positioning reading held up against the record after the correction "
                   "for testing many; the COT page names it.") if held else TESTED_NONE,
        # the rank in words, the one form the pages print (no ordinals)
        "words": rank_words(p, c.get("net"), c.get("crowded"),
                            (c.get("first_week") or "")[:4] or "the start of the record"),
        "record": record_words(c),
    }


def side_of(net, oi):
    """'long', 'short' or 'flat'. Flat is |net| under FLAT_OI_PCT of open
    interest; without open interest only the sign is known."""
    if net is None:
        return None
    if oi and abs(net) < FLAT_OI_PCT / 100.0 * oi:
        return "flat"
    return "long" if net > 0 else "short" if net < 0 else "flat"


def flat_band(oi):
    """Contracts either side of zero that count as flat at this open interest."""
    return int(round(FLAT_OI_PCT / 100.0 * oi)) if oi else None


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
    net =[mm_l[i] - mm_s[i] for i in range(n)]
    comm = [pm_l[i] - pm_s[i] for i in range(n)]
    swap = [sw_l[i] - sw_s[i] for i in range(n)]
    orep = [or_l[i] - or_s[i] for i in range(n)]
    nrep = [nr_l[i] - nr_s[i] for i in range(n)]
    pcto = lambda a: [round(100.0 * a[i] / oi[i], 3) if oi[i] else None for i in range(n)]
    tr_l, tr_s, tr_t = g("tr_mm_long"), g("tr_mm_short"), g("tr_total")
    # CFTC SUPPRESSES A TRADER COUNT BELOW FOUR and prints "." in its place.
    # cot_deep.py now stores that as None; files built before 2026-10-06 stored
    # it as 0, which printed "0 funds hold the long side" under Class III milk
    # with 109 contracts held long. Zero traders cannot hold a position, so a 0
    # beside a non-zero position is the suppression marker, not a count.
    sup = lambda t, pos: [None if (t[i] is None or (t[i] == 0 and pos[i])) else t[i]
                          for i in range(n)]
    tr_l, tr_s = sup(tr_l, mm_l), sup(tr_s, mm_s)
    tr_t = [None if not tr_t[i] else tr_t[i] for i in range(n)]
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


def price_withheld_reason(key, px_entry, px_adj):
    """Why a market has no price read, in words a reader can check. None when
    it has one. The page prints this wherever a price figure is missing, so a
    withheld series is never described as one we do not have."""
    if key in UNREPAIRED_ROLL:
        return UNREPAIRED_ROLL[key]
    if not any(v is not None for v in px_entry) and not any(v is not None for v in px_adj):
        return ("no price series: our futures feed does not carry this contract, so there is "
                "nothing to measure a price move against")
    return None


def card_stats(s, d, px_adj, i):
    """The statistics printed on each summary card and used by The Read.

    Computed here, not in the browser, so they use the same convention as every
    other percentile on the page: the share of weeks AT OR BELOW this one, the
    current week included, so the window's high is the 100th and its low is
    100/n -- never "0th percentile". The window is the trailing CARD_WEEKS weekly
    reports and n is stated with every figure.
    """
    net, oi = s["net"], s["oi"]
    mm_l, mm_s = s["mm_long"], s["mm_short"]
    lo = max(0, i - CARD_WEEKS + 1)
    win = list(range(lo, i + 1))
    nets = [net[j] for j in win]
    chgs = [net[j] - net[j - 1] for j in win if j > lo]
    if len(nets) < 6 or not chgs:
        return None
    cur = chgs[-1]

    # Weeks back to an equal-or-larger move the same way. None when there is
    # none in the window, which is "the largest in the window".
    since = None
    for back, c in enumerate(reversed(chgs[:-1]), start=1):
        if (cur < 0 and c <= cur) or (cur > 0 and c >= cur):
            since = back
            break
    streak = 1
    for c in reversed(chgs[:-1]):
        if c != 0 and (c > 0) == (cur > 0):
            streak += 1
        else:
            break
    dL, dS = mm_l[i] - mm_l[i - 1], mm_s[i] - mm_s[i - 1]
    how = how_changed(mm_l[i - 1], mm_s[i - 1], mm_l[i], mm_s[i])
    if "withheld" not in how and net[i] - net[i - 1] != how["long_change"] - how["short_change"]:
        how = {"withheld": "the long and short counts do not add up to the net"}

    # Side changes inside the window, newest first. A side is long, short or
    # flat (side_of: |net| under FLAT_OI_PCT of open interest), and a flip is
    # the week the net leaves the flat band on the other side from where it
    # last stood. A sign change inside the band is not one: KC wheat on
    # 2026-10-27 went from long to net short 517 against a 6,501-contract
    # band, read FLAT on its card, and was still called "flipped net short".
    flips, last = [], None
    for j in range(lo, i + 1):
        sd = side_of(net[j], oi[j])
        if sd == "flat":
            continue
        if last is not None and sd != last:
            flips.append({"date": d[j], "to": sd, "weeks_ago": i - j})
        last = sd
    flips.reverse()
    move_floor = median([abs(c) for c in chgs])

    out = {
        "weeks": len(nets), "changes": len(chgs),
        "pct": percentile_rank(nets, net[i]),
        "z": zscore(nets, net[i]),
        "chg": cur, "chg_long": dL, "chg_short": dS, "how": how,
        "largest_in_window": since is None and cur != 0,
        "weeks_since_larger": since,
        "streak": streak,
        "move_floor": int(round(move_floor)) if move_floor is not None else None,
        "significant_move": move_floor is not None and abs(cur) >= move_floor and cur != 0,
        "flips": flips[:3], "n_flips": len(flips),
        "chg4": net[i] - net[i - 4] if i - 4 >= 0 else None,
        "chg4_long": mm_l[i] - mm_l[i - 4] if i - 4 >= 0 else None,
        "chg4_short": mm_s[i] - mm_s[i - 4] if i - 4 >= 0 else None,
        "chg4_oi": (round(100.0 * (net[i] - net[i - 4]) / oi[i], 2)
                    if (i - 4 >= 0 and oi[i]) else None),
        "price4": None, "divergence": None,
    }
    # Four-week price move on the ROLL-REPAIRED index at the as-of Tuesdays.
    if i - 4 >= 0 and px_adj[i] and px_adj[i - 4]:
        p4 = round(100.0 * (px_adj[i] - px_adj[i - 4]) / px_adj[i - 4], 1)
        nd = (out["chg4"] > 0) - (out["chg4"] < 0)
        pd = (p4 > 0) - (p4 < 0)
        out["price4"] = p4
        out["divergence"] = {(1, -1): "bearish", (-1, 1): "bullish",
                             (1, 1): "confirmed-up", (-1, -1): "confirmed-down"}.get((nd, pd))
    return out


def _signed(v):
    return f"{'+' if v >= 0 else '−'}{abs(v):,}"


def _contracts(v):
    """+52,308 / -20,010 / 0, plain hyphen, for the how-it-changed line."""
    return "0" if v == 0 else f"{'+' if v > 0 else '-'}{abs(v):,}"


def how_changed(long_prev, short_prev, long_now, short_now):
    """HOW THE NET CHANGED, SPLIT INTO ITS TWO SIDES (Nov 7, 2026). The ONE place
    this is figured: written into each card as card["how"], and /cot, the Funds this
    week email and the Daily's fund block print its `line` as it stands, never
    working it out again.

    Positions only, never a motive (CFTC does not know why anyone traded), in
    contracts, never a percent:
      net down: "mostly selling longs they held" when the long drop is at least the
                short rise, else "mostly new short selling"
      net up:   "mostly new buying" when the long rise is at least the short drop,
                else "mostly buying back shorts"
      both sides the same way: "longs and shorts both cut" / "longs and shorts both added"
    -> {long_change, short_change, label, line}, or {"withheld": why} when either
    week lacks a long or a short count."""
    vals = (long_prev, short_prev, long_now, short_now)
    if not all(isinstance(v, int) and not isinstance(v, bool) and v >= 0 for v in vals):
        return {"withheld": "a week without both long and short counts"}
    dl, ds = long_now - long_prev, short_now - short_prev
    if dl == 0 and ds == 0:
        label = "no change on either side"
    elif dl > 0 and ds > 0:
        label = "longs and shorts both added"
    elif dl < 0 and ds < 0:
        label = "longs and shorts both cut"
    elif dl - ds < 0:
        label = "mostly selling longs they held" if -dl >= ds else "mostly new short selling"
    else:
        label = "mostly new buying" if dl >= -ds else "mostly buying back shorts"
    return {"long_change": dl, "short_change": ds, "label": label,
            "line": f"Longs {_contracts(dl)}, shorts {_contracts(ds)}: {label}."}


def _fmt_pct_signed(v):
    return f"{'+' if v >= 0 else '−'}{abs(v):.1f}%"


def _rec_pct(c):
    """The record percentile, said with its measure and its n."""
    p = c["pctl"]["net_oi_all"]
    if p is None:
        return "with no long-run ranking"
    n = f"(share of open interest, n = {c['weeks_of_history']:,} weeks)"
    if c.get("is_record_low"):
        return f"the lowest reading of its record since {c['first_week'][:4]} {n}"
    if c.get("is_record_high"):
        return f"the highest reading of its record since {c['first_week'][:4]} {n}"
    # Not a record, so never "0th" or "100th"; in words, not an ordinal.
    return f"{rank_words(p, c.get('net'), c.get('crowded'), c['first_week'][:4])} {n}"


def _divergence_read(c):
    """The sentence for a four-week window in which net and price went opposite
    ways. Every mechanism word is earned from the long and short legs, never
    from the net alone: Feeder Cattle's net fell 270 contracts because shorts
    rose 1,591 while longs ROSE 1,321, and the old page called that liquidation."""
    k = c["card"]
    lab, net = c["label"], c["net"]
    dl, ds, ch, p4 = k["chg4_long"], k["chg4_short"], k["chg4"], k["price4"]
    legs = f"longs {_signed(dl)}, shorts {_signed(ds)}"
    price = f"price {'rose' if p4 > 0 else 'fell'} {_fmt_pct_signed(p4)} over the same four weeks"
    tail = " It describes the weeks behind, not the ones ahead."
    if k["divergence"] == "bearish":            # net up, price down
        if net > 0:
            how = ("as longs were added" if dl > 0 and dl >= -ds else
                   "as shorts were covered")
            return (f"funds' net long rose {ch:,} contracts {how} ({legs}) while {price}. "
                    f"That is a long position price has stopped confirming." + tail)
        how = ("Shorts leaving into a falling price is short liquidation: the market kept "
               "going their way without them." if ds < 0 else
               "The net short shrank because longs were added, not because shorts left.")
        return (f"funds' net short shrank {ch:,} contracts ({legs}) while {price}. " + how + tail)
    # bullish: net down, price up
    if net > 0:
        if dl < 0:
            return (f"funds cut their net long {abs(ch):,} contracts ({legs}) while {price}. "
                    f"Longs leaving into a rising price is liquidation, not conviction: the "
                    f"market went up without them." + tail)
        return (f"funds' net long fell {abs(ch):,} contracts as shorts were added ({legs}) "
                f"while {price}. Longs did not leave; the net fell because new shorts arrived." + tail)
    if ds > 0:
        return (f"funds added {abs(ch):,} contracts to a net short ({legs}) while {price}. "
                f"That is a short position price has stopped confirming." + tail)
    return (f"funds' net short grew {abs(ch):,} contracts as longs left ({legs}) while {price}." + tail)


GRAIN_FLIP_KEYS = ("corn", "beans", "wheat", "kcwheat")


def build_the_read(out):
    """THE READ: one market, one sentence, chosen here rather than in the
    browser. Returns {key, label, kind, text, why} or None.

    Order: a grain market that changed sign in the last week; a four-week window
    in which net and price went opposite ways, the net move was at least a
    typical week's move (the median absolute weekly change over the card
    window), and the market is crowded on the side it is on or 1+ standard
    deviations from its three-year normal; then the most newsworthy of the
    rest. A move smaller than an ordinary week is not a read.
    """
    cards = {k: c for k, c in out.items() if c.get("card")}
    if not cards:
        return None

    def recent_flip(c, within):
        f = c["card"]["flips"]
        return f[0] if (f and f[0]["weeks_ago"] <= within and c["side"] != "flat") else None

    def say(c, kind, text, why):
        return {"key": c["key"], "label": c["label"], "kind": kind, "text": text, "why": why}

    def flip_text(c, f):
        k = c["card"]
        when = "this week" if f["weeks_ago"] == 0 else (
            "last week" if f["weeks_ago"] == 1 else f"{f['weeks_ago']} weeks ago")
        nf = k["n_flips"]
        hist = ("the only sign change in the last " f"{k['weeks']} weeks" if nf <= 1 else
                f"the {ordinal(nf)} sign change in the last {k['weeks']} weeks, the previous one "
                f"{k['flips'][1]['weeks_ago'] - f['weeks_ago']} weeks earlier")
        return (f"funds flipped net {f['to']} {when}, {hist}. Positioning sits at {_rec_pct(c)}. "
                f"A sign change is a fact about the week, not a signal about the next one.")

    for key in GRAIN_FLIP_KEYS:
        c = cards.get(key)
        f = c and recent_flip(c, 1)
        if f:
            return say(c, "flip", flip_text(c, f), "a grain market changed sign within a week")

    divs = []
    for c in cards.values():
        k = c["card"]
        if k["divergence"] not in ("bearish", "bullish") or k["chg4"] is None:
            continue
        if k["move_floor"] is None or abs(k["chg4"]) < k["move_floor"]:
            continue
        z3 = c["z"]["net_oi_3y"]
        if not (c["crowded"] or (z3 is not None and abs(z3) >= 1)):
            continue
        divs.append(c)
    if divs:
        c = max(divs, key=lambda x: abs(x["card"]["price4"]))
        return say(c, "divergence", _divergence_read(c),
                   f"four-week net move {abs(c['card']['chg4']):,} contracts against a typical "
                   f"week's {c['card']['move_floor']:,}")

    def score(c):
        k, sc = c["card"], 0.0
        if c["crowded"]:
            sc += 2
        z3 = c["z"]["net_oi_3y"]
        sc += min(2.0, abs(z3)) if z3 is not None else 0
        if k["significant_move"]:
            if k["largest_in_window"]:
                sc += 3
            elif (k["weeks_since_larger"] or 0) >= 8:
                sc += 2
            elif (k["weeks_since_larger"] or 0) >= 4:
                sc += 1
        if c.get("chg_z") is not None and abs(c["chg_z"]) >= 2:
            sc += 1
        if recent_flip(c, 2):
            sc += 2
        return sc

    best = max(cards.values(), key=score)
    if score(best) < 2:
        return None
    k = best["card"]
    f = recent_flip(best, 2)
    if f:
        return say(best, "flip", flip_text(best, f), "changed sign within two weeks")
    cr = best["crowded"]
    where = (f"crowded {cr}: {_rec_pct(best)}" if cr else f"at {_rec_pct(best)}")
    if k["significant_move"] and (k["largest_in_window"] or (k["weeks_since_larger"] or 0) >= 4):
        fall = k["chg"] < 0
        size = (f"the largest weekly {'fall' if fall else 'rise'} in net in the last {k['weeks']} weeks"
                if k["largest_in_window"] else
                f"the sharpest {'fall' if fall else 'rise'} in net in {k['weeks_since_larger']} weeks")
        hw = k.get("how") or {}
        mech = f" {hw['label'][0].upper()}{hw['label'][1:]}." if hw.get("label") else ""
        # Said toward the side the position is on: a net short that falls has GROWN.
        grew = (best["net"] > 0) != fall
        what = f"net {'long' if best['net'] > 0 else 'short'} {'grew' if grew else 'shrank'}"
        return say(best, "move",
                   f"funds' {what} by {abs(k['chg']):,} contracts this week, "
                   f"{size} (longs {_signed(k['chg_long'])}, shorts {_signed(k['chg_short'])}), from a position "
                   f"{where}.{mech}",
                   "an unusually large weekly move")
    if cr:
        return say(best, "crowded",
                   f"managed money is {where}. That is a count of who is exposed, not a direction: "
                   f"it says how many contracts could be forced out if the market turns, not that it will.",
                   "crowded on the side it is on")
    return None


GRAIN_LEAD_KEYS = ("corn", "beans")


def build_grain_lines(out):
    """THE READ LEADS WITH CORN AND SOYBEANS, EVERY WEEK (2026-10-15).

    build_the_read() picks the most newsworthy market, which on Oct 6 2026 was
    Lean Hogs. Most readers here grow corn and soybeans, so the box now opens
    with one plain line for each, from the same card and the same one measure
    the cards print, and the newsworthy pick sits under them. Returns a list of
    {key, label, text}; a market missing from the report is left out, never
    filled in."""
    lines = []
    for key in GRAIN_LEAD_KEYS:
        c = out.get(key)
        k = c and c.get("card")
        if not k or not isinstance(c.get("net"), (int, float)):
            continue
        net, chg = c["net"], k.get("chg")
        if c.get("side") == "flat":
            pos = (f"funds are close to flat, net {'long' if net >= 0 else 'short'} "
                   f"{abs(net):,} contracts")
        else:
            pos = f"funds are net {'long' if net > 0 else 'short'} {abs(net):,} contracts"
        if chg is None:
            move = ""
        elif chg == 0:
            move = ", unchanged from last week"
        else:
            # Said toward the side the position is on: a net short that falls has GROWN.
            grew = (net > 0) == (chg > 0)
            move = f", {abs(chg):,} {'more' if grew else 'fewer'} than last week"
        p = (c.get("pctl") or {}).get("net_oi_all")
        since = (c.get("first_week") or "")[:4]
        if p is None:
            rank = " There is no long-run ranking for it yet."
        elif c.get("is_record_high") and net > 0:
            rank = f" As a share of open interest, that is the biggest net long of every week since {since}."
        elif c.get("is_record_low") and net < 0:
            rank = f" As a share of open interest, that is the biggest net short of every week since {since}."
        else:
            cr = c.get("crowded")
            rank = (f" As a share of open interest, that is {rank_words(p, net, cr, since)} "
                    f"({crowd_word(p)}, {'crowded ' + cr if cr else 'not crowded'}).")
        lines.append({"key": key, "label": c["label"], "text": pos + move + "." + rank})
    return lines


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
    # NO ENTRY BEFORE THE REPORT EXISTED. A report held back by a government
    # shutdown was published weeks after the calendar's Friday (the 2025-09-30
    # report: calendar entry 2025-10-06, CFTC published 2025-11-19), so its
    # px_entry is a close that printed before anyone could read the report.
    # cot_calendar.release_unknown() flags those weeks; prediction_bot.py
    # already skips them. They are excluded here as STARTING points. Their
    # px_entry still serves as an exit price for an earlier week, because a
    # close on that date did print and nothing about it depended on the report.
    unknown = [CAL.release_unknown(date.fromisoformat(x)) for x in d]
    shutdown_excluded = sum(1 for j in range(n) if unknown[j] and px_entry[j] is not None)
    for h in HORIZONS:
        fwd_map[h] = [None if unknown[j] else v for j, v in enumerate(fwd_map[h])]

    i = n - 1
    net, net_oi, comm = s["net"], s["net_oi"], s["comm"]
    w3y, w5y = max(0, i - 156), max(0, i - 260)

    rank_desc = sorted(range(n), key=lambda j: -net[j]).index(i) + 1
    higher = [d[j] for j in range(n) if net[j] > net[i]]
    hi_j = max(range(n), key=lambda j: net[j])
    lo_j = min(range(n), key=lambda j: net[j])
    # THE RANK THE PANEL PRINTS IS ON THE SAME MEASURE AS ITS PERCENTILE. "A
    # bigger net long than 98% of weeks" (share of open interest) sat beside
    # "Rank 1st of 874 by net position" (raw contracts). Ranked here on share of
    # open interest, counted toward the side the position is on: first is the
    # biggest net long for a long, the biggest net short for a short. Ties share
    # the better rank.
    oi_vals = [(j, v) for j, v in enumerate(net_oi) if v is not None]
    if net_oi[i] is not None:
        if net[i] >= 0:
            beyond = [j for j, v in oi_vals if v > net_oi[i]]
        else:
            beyond = [j for j, v in oi_vals if v < net_oi[i]]
        rank_oi = {"side": "long" if net[i] >= 0 else "short",
                   "rank": len(beyond) + 1, "of": len(oi_vals),
                   "last_beyond": d[max(beyond)] if beyond else None}
    else:
        rank_oi = None

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
        "side": side_of(net[i], s["oi"][i]),
        "flat_band": flat_band(s["oi"][i]),
        "crowded": crowded_side(net[i], percentile_rank(net_oi, net_oi[i])),
        "shutdown_excluded": shutdown_excluded,
        "rank_oi": rank_oi,
        # A record in CONTRACTS, named as such: this week's net is the largest
        # net long (or short) of every week in the record. Share of open interest
        # has its own flags above; the page names whichever measure it states.
        "record_contracts": ({"side": "long", "since": d[0][:4], "weeks": n} if net[i] > 0 and net[i] >= max(net)
                             else {"side": "short", "since": d[0][:4], "weeks": n} if net[i] < 0 and net[i] <= min(net)
                             else None),
        # Raw contracts, kept for the arithmetic table only. NOT size-adjusted:
        # open interest has roughly doubled over the record.
        "rank": {"desc": rank_desc, "of": n, "measure": "raw contracts (not size-adjusted)",
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
    out["card"] = card_stats(s, d, px_adj, i)
    out["price_withheld_reason"] = price_withheld_reason(key, px_entry, px_adj)

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
        where = (f"the biggest net {side} of any week since {c['first_week'][:4]}, measured as "
                 f"a share of open interest")
    elif p is not None and (p >= CROWDED_HI or p <= CROWDED_LO) and c.get("crowded"):
        rarer = (100 - p) if net > 0 else p
        where = (f"a bigger net {side} than {100 - rarer:.0f}% of weeks since "
                 f"{c['first_week'][:4]}, measured as a share of open interest")
    elif p is not None and (p >= 75 or p <= 25):
        where = (f"{rank_words(p, net, c.get('crowded'), c['first_week'][:4])} as a share of open "
                 f"interest, on the {'high' if p >= 75 else 'low'} side but not extreme")
    elif p is not None:
        where = (f"{rank_words(p, net, c.get('crowded'), c['first_week'][:4])} as a share of open "
                 f"interest, which is normal")
    else:
        where = "with no history to rank it against"
    cap = c["capacity"]
    if net > 0 and cap["room_down"] > 0:
        # 2026-09-25 audit: room_down is the distance to the record-low SHARE of open interest, converted at
        # today's open interest. It is not the record-low net in contracts (corn: 835,308 against a true
        # 770,875 to the -356,415 low). Name the measure.
        tail = (f"At today's open interest, it would take {cap['room_down']:,} contracts of selling "
                f"to get back to the record-low share of open interest.")
    elif net < 0 and cap["room_up"] > 0:
        tail = (f"At today's open interest, it would take {cap['room_up']:,} contracts of buying "
                f"to get back to the record-high share of open interest.")
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
        "stretched_long": [{"key": k, "label": out[k]["label"], "pctl": v, "crowded": out[k].get("crowded")}
                           for k, v in sorted(ps, key=lambda kv: -kv[1])[:3]],
        "stretched_short": [{"key": k, "label": out[k]["label"], "pctl": v, "crowded": out[k].get("crowded")}
                            for k, v in sorted(ps, key=lambda kv: kv[1])[:3]],
        "extremes": sum(1 for k, c in out.items() if c.get("crowded")),
        "flat": [{"key": k, "label": c["label"]} for k, c in out.items() if c.get("side") == "flat"],
        "sides": {sd: sum(1 for c in out.values() if c.get("side") == sd) for sd in ("long", "short", "flat")},
        "moves": moves,
    }


def board_correlation(out):
    """Three numbers for the whole page. The first says positioning follows
    price. The second says recent buying does not forecast it. The third is the
    contrarian claim itself: does being stretched now predict the next quarter?"""
    rows, withheld = [], []
    for k, c in out.items():
        cor = c.get("correlation") or {}
        f8 = (cor.get("forward") or {}).get("8") or {}
        f13 = (cor.get("forward") or {}).get("13") or {}
        sw = cor.get("same_week") or {}
        if sw.get("r") is None:
            withheld.append({"key": k, "label": c["label"],
                             "reason": c.get("price_withheld_reason")
                             or f"fewer than 20 weeks with both a price and a position (n = {sw.get('n', 0)})"})
            continue
        rows.append({"key": k, "label": c["label"],
                     "same_week_r": sw.get("r"), "same_week_lo": sw.get("lo"), "same_week_hi": sw.get("hi"),
                     "same_week_n": sw.get("n"),
                     "forward_r": f8.get("flow_r"), "forward_lo": f8.get("flow_lo"), "forward_hi": f8.get("flow_hi"),
                     "forward_n": f8.get("flow_n"),
                     "level_r": f13.get("level_r"), "level_lo": f13.get("level_lo"), "level_hi": f13.get("level_hi"),
                     "level_n": f13.get("level_n")})
    if not rows:
        return None
    take = lambda f: [r[f] for r in rows if r[f] is not None]
    return {"rows": rows,
            "median_same_week": round(median(take("same_week_r")), 3) if take("same_week_r") else None,
            "median_forward": round(median(take("forward_r")), 3) if take("forward_r") else None,
            "median_level": round(median(take("level_r")), 3) if take("level_r") else None,
            "level_negative": sum(1 for v in take("level_r") if v < 0),
            "n_markets": len(rows),
            "n_weeks": {f: [min(take(f)), max(take(f))] if take(f) else None
                        for f in ("same_week_n", "forward_n", "level_n")},
            "withheld": withheld}


HIST_PATH = os.path.join(DATA, "cot-history.json")


def rk_rows(rows, block):
    """ONE RANK ENGINE (2026-11-06). Put open interest and `rk` on each
    cot-history.json row: the share-of-open-interest percentile since the
    record's first week, counted ONLY over that week and the weeks before it (no
    hindsight), with the at-or-below rule of percentile_rank, the rule the
    headline rank uses. So the latest row's rk is the headline rank exactly, and
    the Compare chart draws the same rank the page prints instead of ranking in
    the browser. Joined by date; a row the deep file does not have gets no rk."""
    s = series_for(block)
    at = {d: i for i, d in enumerate(block["dates"])}
    net_oi = s["net_oi"]
    for r in rows:
        i = at.get(r.get("date"))
        if i is None or net_oi[i] is None:
            r.pop("rk", None)
            continue
        if s["oi"][i]:
            r["oi"] = s["oi"][i]
        r["rk"] = percentile_rank(net_oi[:i + 1], net_oi[i])


def attach_adjusted_prices(deep):
    """Put the roll-repaired price index onto every row of cot-history.json.

    THE CARDS WERE MEASURING THE ROLL. Each commodity card prints a bolded
    four-week price move, and its sign decides the card's divergence label and
    which market becomes "The Read" of the week. That number came from
    cot-history.json's `price`, which enrich_cot_prices.py documents in its own
    docstring as front-month continuous and NOT roll-adjusted -- while
    cot-deep.json has carried a roll-repaired index (`px_adj`) the whole time,
    on the same Tuesdays, used only by the study section.

    Measured 2026-09-11 on the live files: Soybean Oil printed +6.1% against a
    true +2.6%, Live Cattle -8.6% against -4.8%, Feeder Cattle -8.8% against
    -5.1%, Soybeans +13.1% against +10.6%, Soybean Meal +10.1% against +8.9%.
    Corn, both wheats and lean hogs had no roll in the window and agreed exactly,
    which is why nothing ever looked broken on the market most readers open.
    Across all 480 four-week windows in the 52-week file, 42 (8.75%) have the
    OPPOSITE SIGN once repaired -- each of those would print the wrong label.

    Joined by DATE, never by position: the two files can differ in length and a
    missing week must not silently shift the window. A row that cannot be joined
    is left without `px_adj`, and the page says so rather than quietly falling
    back to the unadjusted figure.
    """
    if not os.path.exists(HIST_PATH):
        print(f"  {HIST_PATH} absent; no adjusted prices attached")
        return
    try:
        with open(HIST_PATH) as f:
            hist = json.load(f)
    except (ValueError, OSError) as e:
        print(f"  could not read {HIST_PATH} ({e}); no adjusted prices attached")
        return

    commodities = deep.get("commodities", deep)
    joined = missing = 0
    for key, rows in (hist.get("history") or {}).items():
        block = commodities.get(key) or {}
        if block.get("dates") and len(block["dates"]) >= 120:
            rk_rows(rows, block)
        else:
            for r in rows:
                r.pop("rk", None)
        dates, px = block.get("dates"), block.get("px_adj")
        if not dates or not px:
            missing += len(rows)
            for r in rows:
                r.pop("px_adj", None)
            continue
        at = {d: i for i, d in enumerate(dates)}
        if key in UNREPAIRED_ROLL:
            # The raw front-month price is withheld too, not only the repaired
            # index: the chart overlay drew the unrepaired roll steps (-14.6%,
            # -15.8%) beside a method note saying no hogs price is shown.
            for r in rows:
                r.pop("price", None)
        for r in rows:
            i = at.get(r.get("date"))
            v = px[i] if (i is not None and i < len(px)) else None
            if v is None:
                r.pop("px_adj", None)
                missing += 1
            else:
                r["px_adj"] = v
                joined += 1

    with open(HIST_PATH, "w") as f:
        json.dump(hist, f, separators=(",", ":"))
    print(f"  roll-repaired prices attached to {HIST_PATH}: "
          f"{joined} rows joined, {missing} without one")


# 2026-09-25 audit. contract_calendar.py puts lean hogs on MONTH_END and says so ("UNVERIFIED ... a
# placeholder"). CME lean hogs stop trading on the 10th business day of the contract month, about the 14th,
# so the roll repair drops the wrong day. Measured in cot-deep.json: weekly steps of -23.4%, -17.6%, -15.0%,
# -10.6%, -17.7%, -14.6% and -15.8% sit in the Aug/Oct expiry weeks since 2023, raw and adjusted identical.
# The hogs "-14.5% over 13 weeks" was the Aug 18 2026 roll. A price read built on that is wrong, so it is
# withheld (the same path Minneapolis wheat already takes: no price series, so no price-conditioned read)
# until the calendar rule is fixed and the archive rebuilt.
UNREPAIRED_ROLL = {"leanhogs": ("withheld, not missing: the rule for when lean hogs roll from one "
                                "contract to the next is not yet verified in our contract calendar, "
                                "so the price series still carries jumps of 10% to 23% at contract "
                                "changes. Any price move measured on it would be mostly the roll")}


def withhold_unrepaired_prices(deep):
    for key in UNREPAIRED_ROLL:
        b = (deep.get("commodities") or deep).get(key)
        if b and b.get("dates"):
            n = len(b["dates"])
            for f in ("px_tue", "px_adj", "px_entry"):
                b[f] = [None] * n


def main():
    if "--selftest" in sys.argv:
        return selftest()
    if not os.path.exists(DEEP_PATH):
        print(f"FATAL: {DEEP_PATH} missing. Run cot_deep.py --rebuild first.", file=sys.stderr)
        return 1
    with open(DEEP_PATH) as f:
        deep = json.load(f)
    withhold_unrepaired_prices(deep)

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
        t[3]["passes"] = idx in survivors
    for t in family:
        t[3].setdefault("passes", False)
    for r in out.values():
        r["crowd"] = crowd_summary(r)
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
    shut = sum(c2.get("shutdown_excluded") or 0 for c2 in out.values())
    shut_markets = sum(1 for c2 in out.values() if c2.get("shutdown_excluded"))
    payload = {
        "updated": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "report_date": latest,
        "release_date": next((c2.get("release_date") for c2 in out.values() if c2.get("release_date")), None),
        "entry_date": next((c2.get("entry_date") for c2 in out.values() if c2.get("entry_date")), None),
        # No "method" block (2026-11-06): how the tests run is not published,
        # only the source on the page and the sample sizes below.
        "shutdown_excluded": {"rows": shut, "markets": shut_markets,
                              "windows": [[a.isoformat(), b.isoformat()] for a, b in CAL.SHUTDOWN_SKIP]},
        "thresholds": {"crowded_hi": CROWDED_HI, "crowded_lo": CROWDED_LO,
                       "flat_oi_pct": FLAT_OI_PCT, "card_weeks": CARD_WEEKS,
                       "crowded_measure": "full-record percentile of managed-money net as a share "
                                          "of open interest, on the side the position is on"},
        "read": build_the_read(out),
        "grain_lines": build_grain_lines(out),
        "family": {"tests": len(measured), "attempted": len(family),
                   "expected_by_chance": round(len(measured) * ALPHA, 1),
                   "raw_hits": raw_hits, "survivors": len(survivors)},
        "board": board_summary(out),
        "predictive": board_correlation(out),
        "coverage": {"first_week": min((c2["first_week"] for c2 in out.values()), default=None),
                     "weeks": max((c2["weeks_of_history"] for c2 in out.values()), default=0)},
        "commodities": out,
    }
    # Last week's question, this week's answer (kit v2 part 2, Nov 6): scripts/cot_questions.py, from the
    # history this run reads, in this same step. Written to data/cot-questions.json and carried here too, so the
    # files this workflow already commits hold it. A failure there never stops the analysis.
    try:
        import cot_questions
        with open(HIST_PATH) as f:
            qs = cot_questions.build(json.load(f))
        if qs:
            payload["questions"] = qs
            with open(cot_questions.OUT_PATH, "w") as f:
                json.dump(qs, f, indent=1)
            print(f"questions: {qs['this_week'] and qs['this_week']['question']}")
    except Exception as e:  # noqa: BLE001
        print(f"questions skipped ({e})", file=sys.stderr)
    with open(OUT_PATH, "w") as f:
        json.dump(payload, f, separators=(",", ":"))

    attach_adjusted_prices(deep)
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

    # A sign change inside the flat band is not a flip (KC wheat, 2026-10-27).
    def _fs(nets):
        n = len(nets)
        ser = {"net": nets, "oi": [100000] * n, "mm_long": [50000] * n, "mm_short": [50000] * n}
        dd = [(date(2026, 1, 6) + timedelta(weeks=k)).isoformat() for k in range(n)]
        return card_stats(ser, dd, [None] * n, n - 1)
    k_in = _fs([9000, 8000, 7000, 6000, 5000, 4000, 3000, -500])
    ckt("a sign change into the flat band is not a flip", k_in["flips"] == [] and k_in["n_flips"] == 0, k_in["flips"])
    k_via = _fs([9000, 8000, 7000, 6000, 5000, 4000, -500, -2500])
    ckt("long, then flat, then short is one flip, dated the week it left the band",
        k_via["n_flips"] == 1 and k_via["flips"][0]["weeks_ago"] == 0, k_via["flips"])
    k_back = _fs([9000, 8000, 7000, 6000, 5000, 4000, -500, 2500])
    ckt("long, flat, long again is no flip", k_back["n_flips"] == 0, k_back["flips"])
    k_out = _fs([9000, 8000, 7000, 6000, 5000, 4000, 3000, -2500])
    ckt("a sign change past the flat band is a flip",
        k_out["n_flips"] == 1 and k_out["flips"][0]["to"] == "short" and k_out["flips"][0]["weeks_ago"] == 0, k_out["flips"])

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
    ckt("a Wed-Fri holiday in the report week delays the release; a Monday holiday does not",
        CAL.release_date(_d(2026, 11, 24)) == _d(2026, 11, 30) and CAL.release_date(_d(2026, 9, 8)) == _d(2026, 9, 11))

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

    # ── one definition of crowded and flat ──
    ckt("crowded needs the sign to agree: net long at the 6th pct is not crowded short",
        crowded_side(8166, 6.0) is None)
    ckt("crowded long at the 90th with a net long", crowded_side(100, 90.0) == "long")
    ckt("not crowded at 89.8 prints the 89th, not the 90th", shown_pct(89.8, None) == 89 and shown_pct(90.0, "long") == 90)
    ckt("not crowded at 10.2 prints the 11th", shown_pct(10.2, None) == 11 and shown_pct(10.0, "short") == 10)
    ckt("crowded short at the 10th with a net short", crowded_side(-100, 10.0) == "short")
    ckt("flat is a share of open interest: 5,000 of 1.8m is flat",
        side_of(5000, 1800000) == "flat" and side_of(-5000, 36000) == "short")
    ckt("flat band at 36,020 open interest", flat_band(36020) == 720)

    # ── card statistics use the pipeline's percentile convention ──
    nn = 60
    blk2 = {"dates": [(date(2025, 1, 7) + timedelta(weeks=j)).isoformat() for j in range(nn)],
            "oi": [100000] * nn, "mm_long": [20000 + 100 * j for j in range(nn)],
            "mm_short": [10000] * nn}
    s2 = series_for(blk2)
    cs = card_stats(s2, blk2["dates"], [None] * nn, nn - 1)
    ckt("card window is 52 weeks", cs["weeks"] == 52 and cs["changes"] == 51)
    ck("card percentile of the window high is 100, never past it", cs["pct"], 100.0)
    s2["net"][nn - 1] = -99999
    cs = card_stats(s2, blk2["dates"], [None] * nn, nn - 1)
    ck("card percentile of the window low is 100/n, not 0", cs["pct"], round(100 / 52, 1))
    ckt("no price, no divergence", cs["divergence"] is None and cs["price4"] is None)

    # ── how the net changed, split into longs and shorts (Nov 7) ──
    # pin-ok: fixture. Corn, week to Nov 3, 2026: longs 249,351 -> 229,341, shorts 168,238 -> 220,546.
    hc = how_changed(249351, 168238, 229341, 220546)
    ckt("corn Nov 3: the line", hc == {"long_change": -20010, "short_change": 52308, "label": "mostly new short selling",
        "line": "Longs -20,010, shorts +52,308: mostly new short selling."}, hc)
    for args, want in (((100, 50, 60, 60), "mostly selling longs they held"),
                       ((100, 50, 80, 70), "mostly selling longs they held"),    # a tie goes to the long side
                       ((100, 50, 90, 80), "mostly new short selling"),
                       ((100, 50, 140, 40), "mostly new buying"),
                       ((100, 50, 120, 30), "mostly new buying"),                # a tie goes to the long side
                       ((100, 50, 105, 20), "mostly buying back shorts"),
                       ((100, 50, 90, 40), "longs and shorts both cut"),
                       ((100, 50, 130, 60), "longs and shorts both added"),
                       ((100, 50, 100, 50), "no change on either side")):
        got = how_changed(*args)
        ckt(f"how {args}: {want}", got.get("label") == want, got)
    ckt("how: both cut, said with both numbers",
        how_changed(100, 50, 90, 40)["line"] == "Longs -10, shorts -10: longs and shorts both cut.")
    for bad in ((None, 50, 90, 40), (100, None, 90, 40), (100, 50, None, 40), (100, 50, 90, "40"), (100, 50, -1, 40), (True, 50, 90, 40)):
        ckt(f"how withheld {bad}", "withheld" in how_changed(*bad) and "line" not in how_changed(*bad))
    import re
    _txt = " ".join(how_changed(*a)["line"] for a in ((1, 1, 0, 2), (1, 1, 2, 0), (1, 1, 0, 0), (1, 1, 2, 2), (5, 5, 3, 4), (5, 5, 6, 3)))
    ckt("how: positions only, contracts only", not re.search(r"%|think|bearish|bullish|because|\u2014", _txt), _txt)
    nn3 = 10
    blk3 = {"dates": [(date(2025, 1, 7) + timedelta(weeks=j)).isoformat() for j in range(nn3)],
            "oi": [1918622] * nn3, "mm_long": [249351] * (nn3 - 1) + [229341],
            "mm_short": [168238] * (nn3 - 1) + [220546]}
    cs3 = card_stats(series_for(blk3), blk3["dates"], [None] * nn3, nn3 - 1)
    ckt("the card carries the line", cs3["how"]["line"] == "Longs -20,010, shorts +52,308: mostly new short selling.", cs3["how"])
    s3 = series_for(blk3)
    s3["net"][nn3 - 1] += 1
    ckt("a net that is not longs minus shorts: withheld", "withheld" in card_stats(s3, blk3["dates"], [None] * nn3, nn3 - 1)["how"])

    # ── the Feeder Cattle case (2026-09-29): net -270 = longs +1,321, shorts +1,591 ──
    fc = {"key": "feedercattle", "label": "Feeder Cattle", "net": 8166, "side": "long",
          "crowded": None, "z": {"net_oi_3y": -0.4}, "chg_z": 0.1, "first_week": "2010-01-05",
          "weeks_of_history": 874, "pctl": {"net_oi_all": 50.8},
          "card": {"divergence": "bullish", "chg4": -270, "chg4_long": 1321, "chg4_short": 1591,
                   "price4": 5.0, "move_floor": 797, "flips": [], "n_flips": 0, "weeks": 52,
                   "significant_move": False, "largest_in_window": False,
                   "weeks_since_larger": 1, "chg": 161, "chg_long": 0, "chg_short": 0,
                   "how": how_changed(1000, 1161, 1000, 1000)}}
    ckt("a 270-contract four-week move under a 797 typical week is not a Read",
        build_the_read({"feedercattle": fc}) is None)
    txt = _divergence_read(fc)
    ckt("net fell because shorts were added: no 'liquidation'",
        "liquidation" not in txt and "shorts were added" in txt, txt)
    fc["card"].update({"chg4_long": -900, "chg4_short": 600, "chg4": -1500})
    ckt("longs falling for a net long IS liquidation", "liquidation" in _divergence_read(fc))
    fc["net"] = -8166
    fc["card"].update({"divergence": "bearish", "chg4": 1500, "chg4_long": 200, "chg4_short": -1300,
                       "price4": -5.0})
    t2 = _divergence_read(fc)
    ckt("a net short with net rising is never 'a long position price has stopped confirming'",
        "long position" not in t2 and "net short" in t2, t2)

    # ── The Read leads with corn and soybeans (2026-10-15) ──
    corn = {"key": "corn", "label": "Corn", "net": 329839, "side": "long", "crowded": None,
            "first_week": "2010-01-05", "pctl": {"net_oi_all": 81.4}, "card": {"chg": -51381}}
    beans = {"key": "beans", "label": "Soybeans", "net": -28830, "side": "short", "crowded": "short",
             "first_week": "2010-01-05", "pctl": {"net_oi_all": 6.2}, "card": {"chg": -6721}}
    hogs = {"key": "leanhogs", "label": "Lean Hogs", "net": -5000, "side": "short", "card": {"chg": 9131}}
    gl = build_grain_lines({"leanhogs": hogs, "beans": beans, "corn": corn})
    ckt("grain lines: corn first, then soybeans, never hogs",
        [g["key"] for g in gl] == ["corn", "beans"], gl)
    want_corn = ("funds are net long 329,839 contracts, 51,381 fewer than last week. As a share of open "
                 "interest, that is higher than 81% of weeks since 2010 (high side, not crowded).")
    ckt("grain line: corn Oct 6 2026", gl[0]["text"] == want_corn, gl[0]["text"])
    ckt("grain line: a net short that fell has GROWN", "6,721 more than last week" in gl[1]["text"]
        and "crowded short" in gl[1]["text"], gl[1]["text"])
    ckt("grain lines: a market missing from the report is left out",
        [g["key"] for g in build_grain_lines({"corn": corn})] == ["corn"])

    # ── one crowding read ──
    ckt("crowd word: 81.4 is the high side", crowd_word(81.4) == "high side")
    ckt("crowd word: 97.6 is top 2%", crowd_word(97.6) == "top 2%")
    ckt("crowd word: 0.6 is bottom 1%", crowd_word(0.6) == "bottom 1%")
    ckt("crowd word: 56.3 is middling", crowd_word(56.3) == "middling")
    ckt("crowd word: 97.5 rounds like cot.html (top 3%)", crowd_word(97.5) == "top 3%")
    cs = crowd_summary({"pctl": {"net_oi_all": 81.4}, "net": 329839, "crowded": None,
                        "first_week": "2010-01-05", "weeks_of_history": 875,
                        "card": {"pct": 88.5, "weeks": 52},
                        "studies": {"13": {"share_of_oi": {"verdict": "measured", "passes": False}}}})
    ckt("crowd summary: corn Oct 6 2026, high side, not crowded, nothing held",
        cs["word"] == "high side" and cs["crowded"] is None and cs["held"] is False
        and cs["since"] == "2010" and "pct52_contracts" not in cs and cs["tested"] == TESTED_NONE
        and cs["words"] == "higher than 81% of weeks since 2010", cs)
    cs2 = crowd_summary({"pctl": {"net_oi_all": 97.6}, "net": 1, "crowded": "long", "first_week": "2010-01-05",
                         "studies": {"4": {"flow": {"verdict": "measured", "passes": True}}}})
    ckt("crowd summary: a passing study is named, not hidden", cs2["held"] and cs2["tested"] != TESTED_NONE)
    # one printed percentile: 89.8 not crowded is the 89th everywhere (soybeans, Oct 13 2026 report)
    cs3 = crowd_summary({"pctl": {"net_oi_all": 89.8}, "net": 249807, "crowded": None, "first_week": "2010-01-05"})
    ckt("crowd summary: soybeans 89.8 not crowded is shown as the 89th", cs3["shown"] == 89, cs3)
    ckt("record line uses the same clamp",
        "higher than 89% of weeks since 2010" in _rec_pct({"pctl": {"net_oi_all": 89.8}, "crowded": None, "net": 1,
                                                           "weeks_of_history": 876, "first_week": "2010-01-05"}))
    ckt("rank words: a short counts from the other end",
        rank_words(1.9, -51646, "short", "2010") == "a bigger net short than 98% of weeks since 2010")
    ckt("record words name the measure and the start year",
        record_words({"first_week": "2010-01-05", "net": -51646,
                      "record_contracts": {"side": "short"}}) == "the largest net short in contracts since 2010"
        and record_words({"first_week": "2010-01-05", "net": 5, "is_record_high": True})
        == "the largest net long as a share of open interest since 2010"
        and record_words({"first_week": "2010-01-05", "net": 5}) is None)
    hist_rows = [{"date": "2026-01-06", "net": 1}, {"date": "2026-01-13", "net": 3}, {"date": "2026-01-20", "net": 2},
                 {"date": "2026-01-27", "net": 9}]
    blk = {"dates": ["2026-01-06", "2026-01-13", "2026-01-20"], "oi": [10, 10, 10],
           "mm_long": [1, 3, 2], "mm_short": [0, 0, 0]}
    rk_rows(hist_rows, blk)
    ckt("rk: each week ranked against itself and the weeks before it only, at or below",
        [r.get("rk") for r in hist_rows] == [100.0, 100.0, 66.7, None]
        and [r.get("oi") for r in hist_rows] == [10, 10, 10, None], hist_rows)
    ckt("shown_pct: crowded 90.2 is the 90th, not crowded 10.2 the 11th, 99.7 the 99th",
        shown_pct(90.2, "long") == 90 and shown_pct(10.2, None) == 11 and shown_pct(99.7, "long") == 99)

    # ── shutdown weeks are not entry points ──
    ckt("the 2025-09-30 report's release is unknown", CAL.release_unknown(date(2025, 9, 30)))

    print()
    try:
        import cot_questions
        if cot_questions.selftest():
            fails.append("cot_questions")
    except Exception as e:  # noqa: BLE001
        fails.append(f"cot_questions ({e})")
    if fails:
        print(f"{len(fails)} check(s) failed: " + ", ".join(fails))
        return 1
    print("All checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
