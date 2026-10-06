#!/usr/bin/env python3
"""
prediction_bot.py -- AGSIST's statistical prediction bot (rule set bot-v1.1).

WHAT IT DOES
------------
Once per weekly CFTC report, at the first close a reader could trade on it, it
calls the direction of corn, soybeans, Chicago wheat and KC wheat over the next
four reports (about four weeks). Every call is graded by this code, on a fixed
rule, against settlement closes. It also runs a walk-forward backtest of the
same rule on the weekly history in data/cot-deep.json, and keeps that result
beside the live record, never merged with it.

THE RULE (written and backtested once, on 2026-10-03, before the first live
call; the result was a coin flip and it is published as such)
------------------------------------------------------------------------
For each crop, at the entry close of each report:

  1. Crowding. Take managed money's net position (long minus short) as a share
     of open interest, from that report. Rank it against the 156 reports
     before it (three years). This is the bot's own threshold; /cot labels
     "crowded" at the 85th/15th percentile of the full record, a different,
     descriptive measure that makes no forecast.
       - at or above the 90th percentile  -> call DOWN
       - at or below the 10th percentile  -> call UP
  2. Otherwise, trend. The 13-report change in the roll-repaired front-month
     index: up -> call UP, down -> call DOWN, exactly flat -> no call.

  Grade: an UP call is right when the settlement at the exit is above the
  entry settlement; a DOWN call when it is below. Equal is a miss.

  Entry: the first close after CFTC published the report (cot_calendar.
  entry_date). Exit: the entry close of the report four weeks later.

No seasonal signal. The repo's seasonal figures (price-stats.json) are built
from the full sample, which would classify 2013 using 2026 (honest-numbers
rule 5), and one more signal is one more knob.

REVISION bot-v1 -> bot-v1.1 (2026-10-03, before any live call was made)
-----------------------------------------------------------------------
The direction rule above did not change. What changed is when it is applied
and how it is graded, so live calls match what was backtested:
  - one call per crop per report (was: every trading day, 20 sessions out);
  - release date = the Friday of the as-of week (was as_of + 3, a Thursday for
    a Monday as-of), and reports held back by a shutdown are skipped;
  - the record is counted every way: all calls with a Newey-West test, and
    non-overlapping windows from each of the four starting offsets;
  - a rate needs 40 graded calls and 30 non-overlapping windows.

LIVE vs BACKTEST -- the instruments differ and the page says so
---------------------------------------------------------------
  live      a named contract (e.g. ZCZ26.CBT): entry = its settlement at the
            report's entry close, exit = its settlement at the entry close of
            the report four weeks later. The contract is the first listed
            month still alive on the exit day, so no live call spans a roll.
  backtest  the roll-repaired front-month index in data/cot-deep.json, built
            by cot_deep.py from Yahoo's continuous series. Same entry and exit
            days. Decisions whose exit falls after BACKTEST_END are excluded,
            so the backtest never overlaps the live period.

USAGE
-----
  python3 scripts/prediction_bot.py --selftest   hand-worked cases, no network
  python3 scripts/prediction_bot.py --backtest   recompute the backtest only
  python3 scripts/prediction_bot.py --live       make this report's calls,
                                                 grade matured ones (yfinance)
Writes data/predictions.json. The generator owns every statistic; the pages
and the briefing only print what this file says (honest-numbers rule 9).
"""

import argparse
import json
import math
import os
import sys
from datetime import date, datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, ".."))
sys.path.insert(0, HERE)

import contract_calendar as CC   # noqa: E402  THE trading calendar and expiry rules
import cot_calendar as CAL       # noqa: E402  release/entry dates, roll repair

DEEP_PATH = os.path.join(ROOT, "data", "cot-deep.json")
OUT_PATH = os.path.join(ROOT, "data", "predictions.json")
# The backtest's every call, for anyone re-deriving the figures. Kept out of
# predictions.json so the homepage card does not download 2,800 rows.
BT_CALLS_PATH = os.path.join(ROOT, "data", "predictions-backtest.json")

# ── THE RULES. Changing any of these is a new rule set with a new version and
# a new, separate record. Never edit them in place. ─────────────────────────
RULES = {
    "version": "bot-v1.1",
    "registered": "2026-10-03",
    "revised": "2026-10-03",
    "revision": ("Before the first live call: one call per report (live had been daily), "
                 "release date fixed for Monday as-of weeks, shutdown weeks skipped, "
                 "record counted every way. The direction rule is unchanged."),
    "horizon_reports": 4,
    "horizon_label": "4 weeks",
    "trend_lookback_weeks": 13,
    "cot_window_reports": 156,
    "cot_crowded_long_pct": 90.0,
    "cot_crowded_short_pct": 10.0,
    "cot_max_age_days": 14,
    "tie_rule": "a settlement equal to the entry is a miss",
    "min_graded_for_rate": 40,
    "min_windows_for_rate": 30,
    "spell_offsets": 4,
    "hac_lag": 8,
    "significance": 0.05,
}
BACKTEST_END = "2026-10-02"      # last exit date the backtest may use
LIVE_START = "2026-10-05"        # first session a live call may be made

# crop key (as in cot-deep.json) -> display, Yahoo roots, tick (cents)
CROPS = [
    {"key": "corn",    "label": "Corn",          "inline": "corn",          "cont": ["ZC=F"],         "root": "ZC", "tick": 0.25},
    {"key": "beans",   "label": "Soybeans",      "inline": "soybeans",      "cont": ["ZS=F"],         "root": "ZS", "tick": 0.25},
    {"key": "wheat",   "label": "Chicago wheat", "inline": "Chicago wheat", "cont": ["ZW=F"],         "root": "ZW", "tick": 0.25},
    {"key": "kcwheat", "label": "KC wheat",      "inline": "KC wheat",      "cont": ["KE=F", "KW=F"], "root": "KE", "tick": 0.25},
]
CROP_BY_KEY = {c["key"]: c for c in CROPS}
MONTH_CODE = {1: "F", 2: "G", 3: "H", 4: "J", 5: "K", 6: "M",
              7: "N", 8: "Q", 9: "U", 10: "V", 11: "X", 12: "Z"}
MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
              "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


# ═══ pure pieces: every one of these has a hand-worked selftest ════════════

def percentile_rank(prior, cur):
    """Share of the prior values below `cur`, ties counted half, 0-100."""
    if not prior:
        return None
    below = sum(1 for v in prior if v < cur)
    ties = sum(1 for v in prior if v == cur)
    return 100.0 * (below + 0.5 * ties) / len(prior)


def net_share(b, i):
    """Managed-money net as a share of open interest for report row i."""
    oi = b["oi"][i]
    if not oi:
        return None
    return (b["mm_long"][i] - b["mm_short"][i]) / oi


def cot_pct(b, r, window=RULES["cot_window_reports"]):
    """Percentile of report r's net share against the `window` reports before
    it. Reads rows r-window .. r only. None without a full window."""
    if r < window:
        return None
    cur = net_share(b, r)
    prior = [net_share(b, j) for j in range(r - window, r)]
    if cur is None or any(v is None for v in prior):
        return None
    return percentile_rank(prior, cur)


def decide(pct, trend):
    """(direction, signal) or (None, reason). The whole rule, in one place."""
    if pct is not None and pct >= RULES["cot_crowded_long_pct"]:
        return "down", "crowded_long"
    if pct is not None and pct <= RULES["cot_crowded_short_pct"]:
        return "up", "crowded_short"
    if pct is None:
        return None, "no positioning read"
    if trend is None:
        return None, "no trend read"
    if trend > 0:
        return "up", "trend_up"
    if trend < 0:
        return "down", "trend_down"
    return None, "13-week change exactly flat"


def target_for(direction, entry, tick):
    """The settlement the call needs: one tick past the entry, in its favour."""
    return round(entry + tick, 4) if direction == "up" else round(entry - tick, 4)


def validate_call(direction, entry, target):
    """Refuse a call whose target sits at or behind its entry. Raises."""
    if direction not in ("up", "down"):
        raise ValueError(f"direction must be up or down, got {direction!r}")
    if entry is None or target is None or not (entry > 0):
        raise ValueError("a call needs an entry and a target")
    if direction == "up" and not (target > entry):
        raise ValueError(f"up call refused: target {target} is not above entry {entry}")
    if direction == "down" and not (target < entry):
        raise ValueError(f"down call refused: target {target} is not below entry {entry}")


def grade(direction, entry, exit_px):
    """'hit' or 'miss'. Equal is a miss. Prices compared at 4 decimals so a
    feed's 218.85001 is 218.85."""
    a, b = round(entry, 4), round(exit_px, 4)
    if direction == "up":
        return "hit" if b > a else "miss"
    return "hit" if b < a else "miss"


def nth_session_after(d, n):
    """The n-th trading session strictly after d (contract_calendar's rule)."""
    for _ in range(n):
        d = CC.next_trading_day(d)
    return d


def contract_for(key, exit_day):
    """(year, month) of the first listed month still trading on exit_day."""
    months = CAL.CONTRACT_MONTHS[key]
    rule = CC.rule_for(CAL._FAMILY.get(key, key))
    for y in (exit_day.year, exit_day.year + 1):
        for m in months:
            if CC.dead_from(y, m, rule) > exit_day:
                return y, m
    raise ValueError(f"no listed contract found for {key} after {exit_day}")


def ticker_for(crop, y, m):
    return f"{crop['root']}{MONTH_CODE[m]}{y % 100:02d}.CBT"


def binom_tail_ge(n, k):
    """P(X >= k), X ~ Binomial(n, 1/2)."""
    if n <= 0:
        return None
    return sum(math.comb(n, j) for j in range(k, n + 1)) / 2 ** n


def binom_tail_le(n, k):
    if n <= 0:
        return None
    return sum(math.comb(n, j) for j in range(0, k + 1)) / 2 ** n


def bh_adjust(ps):
    """Benjamini-Hochberg adjusted values, same order as given. None passes
    through and does not count toward m."""
    idx = [i for i, p in enumerate(ps) if p is not None]
    m = len(idx)
    out = [None] * len(ps)
    if not m:
        return out
    order = sorted(idx, key=lambda i: ps[i])
    run = 1.0
    for rank in range(m, 0, -1):
        i = order[rank - 1]
        run = min(run, ps[i] * m / rank)
        out[i] = round(min(run, 1.0), 6)
    return out


def chain_spells(calls, offset=0):
    """Greedy chain of calls whose windows do not overlap, per crop: skip the
    first `offset` calls, take the next, then the first call made on or after
    the previous one's exit day, and so on. Each call needs 'crop', 'made',
    'exit_day'. Weekly calls on a 4-report window repeat every 4 calls, so
    offsets 0..3 are every distinct way of picking non-overlapping calls."""
    out = []
    by_crop = {}
    for c in calls:
        by_crop.setdefault(c["crop"], []).append(c)
    for crop in sorted(by_crop):
        last_exit = None
        for c in sorted(by_crop[crop], key=lambda x: x["made"])[offset:]:
            if last_exit is None or c["made"] >= last_exit:
                out.append(c)
                last_exit = c["exit_day"]
    return out


def chain_windows(calls, offset=0):
    """Non-overlapping windows in TIME, across crops: one window at a time.
    Calls made on the same day share one window (four crops on one report are
    one bet on one month of markets, not four). Skips the first `offset`
    decision days, then takes a day, then the first day on or after the
    latest exit of the calls made that day, and so on.
    Returns (number of windows, calls inside them)."""
    by_day = {}
    for c in calls:
        by_day.setdefault(c["made"], []).append(c)
    days = sorted(by_day)[offset:]
    n, inside, last_exit = 0, [], None
    for d in days:
        if last_exit is None or d >= last_exit:
            n += 1
            inside.extend(by_day[d])
            last_exit = max(c["exit_day"] for c in by_day[d])
    return n, inside


def _phi(z):
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))


def hac_test(calls, lag=None):
    """Is the hit rate different from one half, allowing for overlap?

    Each decision day t gets s_t = sum over its calls of (hit - 1/2). Calls
    on one day are correlated across crops, and weekly calls on a four-week
    window overlap, so the variance of sum(s_t) is the Newey-West long-run
    variance of the s_t series (Bartlett weights, `lag` days):
        V = T * (g0 + 2 * sum_{l=1..L} (1 - l/(L+1)) * g_l),
        g_l = (1/T) * sum_t (s_t - mean)(s_{t-l} - mean).
    z = sum(s_t) / sqrt(V). Returns (z, p_luck = P(Z >= z), p_worse =
    P(Z <= z)), or (None, None, None) when there is nothing to test."""
    lag = RULES["hac_lag"] if lag is None else lag
    by_day = {}
    for c in calls:
        if c.get("outcome") in ("hit", "miss"):
            by_day.setdefault(c["made"], 0.0)
            by_day[c["made"]] += (1.0 if c["outcome"] == "hit" else 0.0) - 0.5
    s = [by_day[d] for d in sorted(by_day)]
    T = len(s)
    if T < 2:
        return None, None, None
    m = sum(s) / T
    e = [x - m for x in s]
    g = lambda l: sum(e[t] * e[t - l] for t in range(l, T)) / T   # noqa: E731
    lr = g(0) + 2.0 * sum((1.0 - l / (lag + 1.0)) * g(l) for l in range(1, min(lag, T - 1) + 1))
    V = T * lr
    if not V > 0:
        return None, None, None
    z = sum(s) / math.sqrt(V)
    return round(z, 4), round(1.0 - _phi(z), 6), round(_phi(z), 6)


def _moved(c):
    """+1 if the exit settled above the entry, -1 below, 0 equal (4 dp)."""
    if c.get("entry") is None or c.get("exit") is None:
        return None
    a, b = round(c["entry"], 4), round(c["exit"], 4)
    return 1 if b > a else (-1 if b < a else 0)


def record(calls):
    """Statistics for a list of GRADED calls (outcome hit/miss). Pure.

    Counts the record every way it can honestly be counted:
      all calls       hits / graded, tested with hac_test (the verdict's test)
      by offset       for k in 0..3, non-overlapping calls from the k-th one
                      on; for one crop a binomial test is valid on them, for
                      several crops it is not (same window, correlated), so
                      the pooled rows carry a rate and no binomial odds
      windows         independent windows in time across crops; the gate
                      needs the smallest of the four counts to reach 30
      baselines       how often the price fell / rose over the same windows:
                      what "always say down" / "always say up" would score
    """
    g = [c for c in calls if c.get("outcome") in ("hit", "miss")]
    n = len(g)
    hits = sum(1 for c in g if c["outcome"] == "hit")
    crops = {c["crop"] for c in g}
    single = len(crops) == 1
    offs = []
    for k in range(RULES["spell_offsets"]):
        sp = chain_spells(g, k)
        sh = sum(1 for c in sp if c["outcome"] == "hit")
        nw, _ = chain_windows(g, k)
        offs.append({
            "offset": k, "calls": len(sp), "hits": sh,
            "rate": round(100.0 * sh / len(sp), 1) if sp else None,
            "windows": nw,
            "p_luck": round(binom_tail_ge(len(sp), sh), 6) if (sp and single) else None,
            "p_worse": round(binom_tail_le(len(sp), sh), 6) if (sp and single) else None,
        })
    rates = [o["rate"] for o in offs if o["rate"] is not None]
    wmin = min((o["windows"] for o in offs), default=0)
    mv = [_moved(c) for c in g]
    known = [x for x in mv if x is not None]
    rose = sum(1 for x in known if x > 0)
    fell = sum(1 for x in known if x < 0)
    z, pl, pw = hac_test(g)
    gate = n >= RULES["min_graded_for_rate"] and wmin >= RULES["min_windows_for_rate"]
    return {
        "graded": n,
        "hits": hits,
        "hit_rate": round(100.0 * hits / n, 1) if n else None,
        "by_offset": offs,
        "spell_rate_low": min(rates) if rates else None,
        "spell_rate_high": max(rates) if rates else None,
        "windows": wmin,
        "hac_z": z,
        "p_luck": pl,
        "p_worse": pw,
        "rose": rose if known else None,
        "fell": fell if known else None,
        "moves_of": len(known) if known else None,
        "rose_rate": round(100.0 * rose / len(known), 1) if known else None,
        "fell_rate": round(100.0 * fell / len(known), 1) if known else None,
        "first": min(c["made"] for c in g) if g else None,
        "last": max(c["made"] for c in g) if g else None,
        "gate_ok": gate,
    }


def verdict(rec, p_adj_luck, p_adj_worse):
    if not rec["gate_ok"]:
        return "not_enough"
    a = RULES["significance"]
    if p_adj_luck is not None and p_adj_luck <= a:
        return "held_up"
    if p_adj_worse is not None and p_adj_worse <= a:
        return "worse_than_coin"
    return "coin_flip"


def verdict_text(rec):
    """The verdict in words, built from the record's own numbers so it cannot
    say more than they do. Ways of counting: all calls, plus each offset."""
    v = rec.get("verdict")
    if v == "not_enough" or v is None:
        return "Too few calls to grade."
    head = {"held_up": "Better than a coin flip after correction",
            "worse_than_coin": "Worse than a coin flip after correction",
            "coin_flip": "No better than a coin flip"}[v]
    ways = [rec["hit_rate"]] + [o["rate"] for o in rec["by_offset"] if o["rate"] is not None]
    below = sum(1 for r in ways if r < 50.0)
    bits = []
    if v == "coin_flip" and below * 2 > len(ways):
        bits.append(f"below half in {below} of {len(ways)} ways of counting")
    if rec.get("fell_rate") is not None and rec["hit_rate"] < rec["fell_rate"] and rec["fell_rate"] >= (rec.get("rose_rate") or 0):
        bits.append("worse than always saying down")
    elif rec.get("rose_rate") is not None and rec["hit_rate"] < rec["rose_rate"]:
        bits.append("worse than always saying up")
    if not bits:
        return head + "."
    return head + "; " + ", and ".join(bits) + "."


def family(calls):
    """Pooled plus one record per crop. The verdict's test is hac_test on all
    calls, BH-adjusted across the records that pass the gate. Separately, the
    per-crop spell tests (4 crops x 4 offsets) are BH-adjusted as their own
    family and reported, so a bad offset cannot hide."""
    groups = [("all", calls)] + [(c["key"], [x for x in calls if x["crop"] == c["key"]]) for c in CROPS]
    recs = [(k, record(v)) for k, v in groups]
    tested = [(k, r) for k, r in recs if r["gate_ok"]]
    adj_l = bh_adjust([r["p_luck"] for _, r in tested])
    adj_w = bh_adjust([r["p_worse"] for _, r in tested])
    adj = {k: (adj_l[i], adj_w[i]) for i, (k, _) in enumerate(tested)}
    spell_tests = [(k, o) for k, r in tested if k != "all" for o in r["by_offset"] if o["p_luck"] is not None]
    sl = bh_adjust([o["p_luck"] for _, o in spell_tests])
    sw = bh_adjust([o["p_worse"] for _, o in spell_tests])
    for i, (_, o) in enumerate(spell_tests):
        o["p_luck_adjusted"], o["p_worse_adjusted"] = sl[i], sw[i]
    a = RULES["significance"]
    out = {}
    for k, r in recs:
        pl, pw = adj.get(k, (None, None))
        r["p_luck_adjusted"] = pl
        r["p_worse_adjusted"] = pw
        r["verdict"] = verdict(r, pl, pw)
        r["verdict_text"] = verdict_text(r)
        out[k] = r
    meta = {
        "tests_in_family": len(tested),
        "spell_tests": len(spell_tests),
        "spell_tests_worse": sum(1 for _, o in spell_tests if o.get("p_worse_adjusted") is not None and o["p_worse_adjusted"] <= a),
        "spell_tests_better": sum(1 for _, o in spell_tests if o.get("p_luck_adjusted") is not None and o["p_luck_adjusted"] <= a),
    }
    return out, meta


# ═══ backtest ═══════════════════════════════════════════════════════════════

def backtest(deep, end=BACKTEST_END):
    """Walk-forward over the weekly file. Each decision at row i reads rows
    <= i only; the exit (row i+4) is read only to grade. Returns (calls,
    skipped-by-reason counts)."""
    H = RULES["horizon_reports"]
    lb = RULES["trend_lookback_weeks"]
    end_d = date.fromisoformat(end)
    calls, skipped = [], {}

    def skip(reason):
        skipped[reason] = skipped.get(reason, 0) + 1

    for crop in CROPS:
        b = deep["commodities"].get(crop["key"])
        if not b:
            skip(f"{crop['key']}: not in cot-deep.json")
            continue
        n = len(b["dates"])
        for i in range(n):
            ed = b["px_entry_date"][i]
            ev = b["px_entry"][i]
            if ed is None or ev is None:
                skip("entry close missing")
                continue
            d0 = date.fromisoformat(ed)
            as_of = date.fromisoformat(b["dates"][i])
            # NO LOOK-AHEAD ON THE RELEASE DAY. cot-deep.json stores the entry
            # date its builder computed; a file built before the Monday-as-of
            # fix has a Friday entry that printed before CFTC published. The
            # calendar is the authority: an entry dated before it is refused
            # until the Sunday rebuild rewrites it.
            if CAL.release_unknown(as_of):
                skip("report held back by a federal shutdown (release date unknown)")
                continue
            if d0 < CAL.entry_date(as_of):
                skip("entry close predates the corrected release date (cot-deep.json not rebuilt yet)")
                continue
            if i + H >= n or b["px_entry_date"][i + H] is None or b["px_entry"][i + H] is None:
                skip("exit close missing or not yet known")
                continue
            d1 = date.fromisoformat(b["px_entry_date"][i + H])
            if d1 < CAL.entry_date(date.fromisoformat(b["dates"][i + H])):
                skip("exit close predates its report's corrected release date (cot-deep.json not rebuilt yet)")
                continue
            if d1 > end_d:
                skip("exit after the backtest cutoff")
                continue
            if not (25 <= (d1 - d0).days <= 35):
                skip("exit four reports later is not about four weeks later (report gap)")
                continue
            pct = cot_pct(b, i)
            if pct is None:
                skip("fewer than 156 prior reports")
                continue
            trend = None
            j = i - lb
            if j >= 0 and b["px_entry"][j] is not None and b["px_entry_date"][j]:
                gap = (d0 - date.fromisoformat(b["px_entry_date"][j])).days
                if 84 <= gap <= 98:
                    trend = ev / b["px_entry"][j] - 1
            direction, why = decide(pct, trend)
            if direction is None:
                skip(why)
                continue
            exit_px = b["px_entry"][i + H]
            calls.append({
                "crop": crop["key"], "made": ed, "exit_day": b["px_entry_date"][i + H],
                "report": b["dates"][i], "direction": direction, "signal": why,
                "cot_pct": round(pct, 1),
                "trend_pct": round(100 * trend, 2) if trend is not None else None,
                "entry": ev, "exit": exit_px,
                "outcome": grade(direction, ev, exit_px),
            })
    return calls, skipped


def backtest_block(deep):
    calls, skipped = backtest(deep)
    fam, meta = family(calls)
    by_signal = {}
    for s in ("crowded_long", "crowded_short", "trend_up", "trend_down"):
        sub = [c for c in calls if c["signal"] == s]
        r = record(sub)
        by_signal[s] = {"graded": r["graded"], "hits": r["hits"], "hit_rate": r["hit_rate"]}
    return {
        "computed": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "data/cot-deep.json (CFTC disaggregated COT; Yahoo continuous front-month, roll-repaired by cot_calendar.roll_adjust)",
        "source_built": deep.get("build"),
        "cutoff": BACKTEST_END,
        "rules_version": RULES["version"],
        "rules_tested": 1,
        "tests_in_family": meta["tests_in_family"],
        "spell_tests": meta["spell_tests"],
        "spell_tests_worse": meta["spell_tests_worse"],
        "spell_tests_better": meta["spell_tests_better"],
        "records": fam,
        "by_signal": by_signal,
        "skipped": dict(sorted(skipped.items(), key=lambda kv: -kv[1])),
        "calls_file": "data/predictions-backtest.json",
        "_calls": [{k: c[k] for k in ("crop", "report", "made", "exit_day", "direction", "signal",
                                       "cot_pct", "trend_pct", "entry", "exit", "outcome")} for c in calls],
    }


# ═══ live ═══════════════════════════════════════════════════════════════════

def load_json(p, default=None):
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def first_session_on_or_after(d):
    """The first CME session on or after d. The backtest reads the first close
    on or after the calendar's entry day (cot_deep.close_on_or_after); a
    Good Friday entry, say, lands on the Monday. Live does the same."""
    while not CC.is_trading_day(d):
        d += timedelta(days=1)
    return d


def live_entry_day(as_of):
    """The session a call on this report is made at: the first close after
    CFTC published it (cot_calendar.entry_date), moved to a CME session."""
    return first_session_on_or_after(CAL.entry_date(as_of))


def live_exit_day(as_of):
    """Where a call on this report is graded: the entry close of the report
    `horizon_reports` weeks later, the same point the backtest grades at."""
    return live_entry_day(as_of + timedelta(weeks=RULES["horizon_reports"]))


def latest_usable_report(b, day):
    """Index of the newest report a reader could have traded on by `day`'s
    close (its entry date is on or before `day`). None if none."""
    best = None
    for i, d in enumerate(b["dates"]):
        if CAL.entry_date(date.fromisoformat(d)) <= day:
            best = i
    return best


def yahoo_closes(symbols, start):
    """{date: close} from the first symbol that answers. {} on failure."""
    import yfinance as yf   # imported here so --selftest needs no network deps
    for sym in symbols:
        try:
            df = yf.Ticker(sym).history(start=start.isoformat(), interval="1d", auto_adjust=False)
            got = {}
            for idx, val in df["Close"].items():
                if val == val:
                    got[idx.date()] = round(float(val), 4)
            if got:
                return got, sym
        except Exception as e:  # noqa: BLE001  any feed failure = no read
            print(f"  {sym}: {type(e).__name__}: {str(e)[:100]}")
    return {}, None


def make_call(crop, day, deep, fetch=yahoo_closes):
    """The call on the report whose entry close is `day`, or (None, reason).
    One call per crop per report, exactly the backtest's decision."""
    b = deep["commodities"].get(crop["key"])
    if not b:
        return None, "crop missing from cot-deep.json"
    r = latest_usable_report(b, day)
    if r is None:
        return None, "no CFTC report usable yet"
    as_of = date.fromisoformat(b["dates"][r])
    if live_entry_day(as_of) != day:
        return None, f"no report enters today (the {as_of.isoformat()} report entered {live_entry_day(as_of).isoformat()})"
    if CAL.release_unknown(as_of):
        return None, "report held back by a federal shutdown (release date unknown)"
    age = (day - as_of).days
    if age > RULES["cot_max_age_days"]:
        return None, f"latest usable CFTC report is {age} days old"
    pct = cot_pct(b, r)
    exit_day = live_exit_day(as_of)
    if not (25 <= (exit_day - day).days <= 35):
        return None, "exit four reports later is not about four weeks later"

    cont, sym = fetch(crop["cont"], day - timedelta(days=200))
    adj = CAL.roll_adjust(cont, crop["key"]) if cont else {}
    trend = None
    if day in adj:
        base_day = CAL.entry_date(as_of - timedelta(weeks=RULES["trend_lookback_weeks"]))
        back = sorted(d for d in adj if base_day <= d <= base_day + timedelta(days=4))
        if back and 84 <= (day - back[0]).days <= 98:
            trend = adj[day] / adj[back[0]] - 1
    elif pct is not None and RULES["cot_crowded_short_pct"] < pct < RULES["cot_crowded_long_pct"]:
        return None, "no continuous-futures close for today yet"

    direction, why = decide(pct, trend)
    if direction is None:
        return None, why

    y, m = contract_for(crop["key"], exit_day)
    tk = ticker_for(crop, y, m)
    px, _ = fetch([tk], day - timedelta(days=10))
    if day not in px:
        return None, f"no {tk} settlement for {day} yet"
    entry = px[day]
    target = target_for(direction, entry, crop["tick"])
    validate_call(direction, entry, target)          # refuses, never repairs
    return {
        "id": f"{crop['key']}-{as_of.isoformat()}",
        "crop": crop["key"], "made": day.isoformat(), "exit_day": exit_day.isoformat(),
        "direction": direction, "signal": why,
        "cot_pct": round(pct, 1) if pct is not None else None,
        "cot_report": as_of.isoformat(),
        "trend_pct": round(100 * trend, 2) if trend is not None else None,
        "contract": f"{MONTH_ABBR[m - 1]} '{y % 100:02d}", "ticker": tk,
        "entry": entry, "target": target, "status": "open",
        "exit": None, "outcome": None, "graded_on": None,
    }, why


def grade_open(calls, today, fetch=yahoo_closes):
    """Grade every open call whose exit day has settled. A call whose exit
    settlement never appears within 5 sessions is marked ungradeable: it is
    shown with a dash and a reason and never counted."""
    for c in calls:
        if c.get("status") != "open":
            continue
        xd = date.fromisoformat(c["exit_day"])
        if xd > today:
            continue
        px, _ = fetch([c["ticker"]], xd - timedelta(days=5))
        if xd in px:
            c["exit"] = px[xd]
            c["outcome"] = grade(c["direction"], c["entry"], px[xd])
            c["rose"] = round(px[xd], 4) > round(c["entry"], 4)
            c["status"] = "graded"
            c["graded_on"] = today.isoformat()
        elif CC.sessions_between(xd, today) > 5:
            c["status"] = "ungradeable"
            c["note"] = f"no {c['ticker']} settlement for {xd} in the feed"
    return calls


def action_label(live_all):
    """The briefing box is THE ACTION only once the live record has held up.
    Until then it is BOT CALL: a statistical call with no edge shown."""
    return "THE ACTION" if (live_all or {}).get("verdict") == "held_up" else "BOT CALL"


def _price(cents):
    return f"${cents / 100:.2f}"


def action_text(latest, live_all, bt_all=None):
    """The briefing's one line, at most 25 words (briefing_cut.CAP_ACTION).
    Entry prices are the named contract's settlement in dollars. The tail is
    three words: the live verdict once it is graded, else the backtest's."""
    if not latest:
        return ""
    d = date.fromisoformat(max(c["made"] for c in latest))
    parts = []
    for crop in CROPS:
        c = next((x for x in latest if x["crop"] == crop["key"]), None)
        if c:
            p = f" {_price(c['entry'])}" if c.get("entry") is not None else ""
            parts.append(f"{crop['inline']}{p} {c['direction']}")
    head = (f"Bot call, {MONTH_ABBR[d.month - 1]} {d.day} close, "
            f"{RULES['horizon_label']} out: " + ", ".join(parts) + ".")
    if live_all and live_all.get("gate_ok"):
        tail = " Live: held up." if live_all.get("verdict") == "held_up" else " Live: no edge."
    elif bt_all and bt_all.get("gate_ok"):
        tail = " Backtest: held up." if bt_all.get("verdict") == "held_up" else " Backtest: no edge."
    else:
        tail = " Too few graded calls."
    return head + tail


def build_output(state, deep, bt=None):
    calls = state.get("calls", [])
    graded = [c for c in calls if c.get("status") == "graded"]
    live, meta = family(graded)
    days = sorted({c["made"] for c in calls})
    latest = [c for c in calls if days and c["made"] == days[-1]]
    bt = bt if bt is not None else state.get("backtest")
    bt_all = ((bt or {}).get("records") or {}).get("all")
    out = {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "rules": RULES,
        "live_start": LIVE_START,
        "first_live_call": first_live_call(deep),
        "crops": [{"key": c["key"], "label": c["label"]} for c in CROPS],
        "latest": {"date": days[-1] if days else None, "calls": latest},
        "live": {"records": live, "tests_in_family": meta["tests_in_family"],
                 "open": sum(1 for c in calls if c.get("status") == "open"),
                 "ungradeable": sum(1 for c in calls if c.get("status") == "ungradeable")},
        "action_label": action_label(live["all"]),
        "action_text": action_text(latest, live["all"], bt_all),
        "calls": calls,
        "skipped": state.get("skipped", [])[-120:],
        "backtest": bt,
    }
    return out


def first_live_call(deep):
    """The first entry session on or after LIVE_START, from the newest report
    in the file, or that report's successor (a week later) if it entered
    before LIVE_START. Printed by the pages as "First calls after the X
    close"; None if the file has no reports."""
    b = (deep or {}).get("commodities", {}).get("corn")
    if not b or not b.get("dates"):
        return None
    start = date.fromisoformat(LIVE_START)
    a = date.fromisoformat(b["dates"][-1])
    for k in range(0, 8):
        d = a + timedelta(weeks=k)
        if not CAL.release_unknown(d) and live_entry_day(d) >= start:
            return live_entry_day(d).isoformat()
    return None


def cmd_backtest():
    deep = load_json(DEEP_PATH)
    if not deep:
        raise SystemExit("data/cot-deep.json missing; nothing to backtest")
    state = load_json(OUT_PATH, {}) or {}
    bt = backtest_block(deep)
    out = build_output(state, deep, bt)
    write(out)
    report(bt)
    return 0


def report(bt):
    a = bt["records"]["all"]
    print(f"backtest: {a['hits']} of {a['graded']} right ({a['hit_rate']}%), HAC z={a['hac_z']} "
          f"p_luck={a['p_luck']} p_worse={a['p_worse']} adj {a['p_luck_adjusted']}/{a['p_worse_adjusted']}  "
          f"windows={a['windows']}  verdict={a['verdict']}")
    print(f"  {a['verdict_text']}")
    print(f"  always down {a['fell']}/{a['moves_of']} ({a['fell_rate']}%), always up {a['rose']}/{a['moves_of']} ({a['rose_rate']}%)")
    for o in a["by_offset"]:
        print(f"  all     offset {o['offset']}: {o['hits']}/{o['calls']} ({o['rate']}%) windows {o['windows']}")
    for c in CROPS:
        r = bt["records"][c["key"]]
        print(f"  {c['key']:8s} {r['hits']:4d}/{r['graded']:<4d} {r['hit_rate']}%  HAC p_luck={r['p_luck']} "
              f"p_worse={r['p_worse']} adj {r['p_luck_adjusted']}/{r['p_worse_adjusted']}  "
              f"down {r['fell_rate']}% up {r['rose_rate']}%  {r['verdict']}")
        for o in r["by_offset"]:
            print(f"           offset {o['offset']}: {o['hits']}/{o['calls']} ({o['rate']}%) "
                  f"p_luck={o['p_luck']} p_worse={o['p_worse']} adj {o.get('p_luck_adjusted')}/{o.get('p_worse_adjusted')}")
    print(f"  spell tests {bt['spell_tests']}: worse after BH {bt['spell_tests_worse']}, better {bt['spell_tests_better']}")
    print("  skipped:", bt["skipped"])


def cmd_live():
    try:
        from zoneinfo import ZoneInfo
        today = datetime.now(ZoneInfo("America/Chicago")).date()
    except Exception:  # noqa: BLE001
        today = (datetime.now(timezone.utc) - timedelta(hours=6)).date()
    deep = load_json(DEEP_PATH)
    if not deep:
        raise SystemExit("data/cot-deep.json missing")
    state = load_json(OUT_PATH, {}) or {}
    calls = state.get("calls", [])
    skipped = state.get("skipped", [])
    grade_open(calls, today)
    have = {c["id"] for c in calls}
    seen = {(s.get("crop"), s.get("report")) for s in skipped}
    start = date.fromisoformat(LIVE_START)
    if today < start:
        print(f"{today}: before the live start ({LIVE_START}); no calls made")
    elif not CC.is_trading_day(today):
        print(f"{today}: not a trading day; no calls made")
    else:
        for crop in CROPS:
            b = deep["commodities"].get(crop["key"]) or {}
            r = latest_usable_report(b, today) if b else None
            if r is None:
                print(f"  {crop['key']}: no usable CFTC report")
                continue
            as_of = date.fromisoformat(b["dates"][r])
            cid = f"{crop['key']}-{as_of.isoformat()}"
            ed = live_entry_day(as_of)
            if cid in have or (crop["key"], as_of.isoformat()) in seen:
                print(f"  {cid}: already handled; calls are never rewritten")
                continue
            if ed < start:
                print(f"  {cid}: entered {ed}, before the live start")
                continue
            if ed < today:
                why = f"missed: no run at its entry close on {ed.isoformat()}; never made late"
                call = None
            else:
                try:
                    call, why = make_call(crop, today, deep)
                except ValueError as e:
                    call, why = None, f"refused: {e}"
            if call:
                calls.append(call)
                print(f"  {cid}: {call['direction']} ({why}) {call['ticker']} entry {call['entry']} -> grade {call['exit_day']}")
            elif why.startswith("no ") and ("settlement" in why or "close for today" in why):
                # a feed that has not posted yet: the retry fire may still make it
                print(f"  {cid}: not yet -- {why}")
            else:
                skipped.append({"crop": crop["key"], "report": as_of.isoformat(),
                                "date": today.isoformat(), "reason": why})
                print(f"  {cid}: no call -- {why}")
    state["calls"] = calls
    state["skipped"] = skipped
    # Recomputed every run: CFTC revises old weeks and the Sunday rebuild
    # picks that up. The cutoff keeps it from ever reaching the live period.
    out = build_output(state, deep, backtest_block(deep))
    write(out)
    return 0


def write(out):
    bt = out.get("backtest") or {}
    rows = bt.pop("_calls", None)
    if rows is not None:
        _dump(BT_CALLS_PATH, {"rules_version": RULES["version"], "cutoff": BACKTEST_END,
                              "source_built": bt.get("source_built"),
                              "fields": "entry and exit are the roll-repaired index, not prices",
                              "calls": rows}, indent=None)
    _dump(OUT_PATH, out)


_STAMPS = ("updated", "computed")


def _same_but_stamps(path, out):
    """True when the file on disk differs from `out` only in its run
    timestamps, so the workflow does not commit twice a day with no new
    call (2026-10-05)."""
    def strip(x):
        if isinstance(x, dict):
            return {k: strip(v) for k, v in x.items() if k not in _STAMPS}
        if isinstance(x, list):
            return [strip(v) for v in x]
        return x
    try:
        with open(path, encoding="utf-8") as f:
            old = json.load(f)
    except (OSError, ValueError):
        return False
    return strip(old) == strip(json.loads(json.dumps(out, allow_nan=False)))


def _dump(path, out, indent=1):
    if _same_but_stamps(path, out):
        print(f"unchanged {os.path.relpath(path, ROOT)} (only timestamps would move)")
        return
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=indent, ensure_ascii=False, allow_nan=False,
                  separators=(",", ":") if indent is None else None)
        f.write("\n")
    os.replace(tmp, path)
    print(f"wrote {os.path.relpath(path, ROOT)}")


# ═══ selftest ═══════════════════════════════════════════════════════════════

def selftest():
    fails = []

    def ck(name, got, want):
        ok = got == want
        print(f"{'PASS' if ok else 'FAIL'}  {name:60s} {got!r}" + ("" if ok else f"  -- want {want!r}"))
        if not ok:
            fails.append(name)

    def raises(name, fn):
        try:
            fn()
        except ValueError:
            print(f"PASS  {name}")
            return
        print(f"FAIL  {name} -- did not raise")
        fails.append(name)

    # percentile: 9 of 10 prior values are below 9.5 -> 90.0
    ck("percentile 9.5 among 1..10", percentile_rank(list(range(1, 11)), 9.5), 90.0)
    # ties count half: prior [1,2,2,3], cur 2 -> (1 + 0.5*2)/4 = 50
    ck("percentile ties count half", percentile_rank([1, 2, 2, 3], 2), 50.0)
    ck("percentile of nothing is None", percentile_rank([], 1), None)

    # the rule
    ck("crowded long calls down", decide(95.0, 0.03), ("down", "crowded_long"))
    ck("90th percentile exactly is crowded", decide(90.0, 0.03), ("down", "crowded_long"))
    ck("crowded short calls up", decide(5.0, -0.03), ("up", "crowded_short"))
    ck("middle follows trend up", decide(50.0, 0.02), ("up", "trend_up"))
    ck("middle follows trend down", decide(50.0, -0.02), ("down", "trend_down"))
    ck("flat trend makes no call", decide(50.0, 0.0), (None, "13-week change exactly flat"))
    ck("no positioning makes no call", decide(None, 0.05), (None, "no positioning read"))

    # target and refusal
    ck("up target is one tick above", target_for("up", 500.0, 0.25), 500.25)
    ck("down target is one tick below", target_for("down", 500.0, 0.25), 499.75)
    raises("refuses up call with target at entry", lambda: validate_call("up", 500.0, 500.0))
    raises("refuses up call with target behind entry", lambda: validate_call("up", 500.0, 499.75))
    raises("refuses down call with target at entry", lambda: validate_call("down", 500.0, 500.0))
    raises("refuses down call with target above entry", lambda: validate_call("down", 500.0, 500.25))
    raises("refuses a call with no entry", lambda: validate_call("up", None, 1.0))
    validate_call("up", 500.0, 500.25)
    print("PASS  accepts up call one tick above entry")

    # grading, ties are misses, feed float noise ignored
    ck("up graded hit when settle is higher", grade("up", 500.0, 500.25), "hit")
    ck("up graded miss when settle is equal", grade("up", 500.0, 500.0), "miss")
    ck("down graded hit when settle is lower", grade("down", 500.0, 499.75), "hit")
    ck("down graded miss when settle is higher", grade("down", 500.0, 501.0), "miss")
    ck("218.85001 equals 218.85 (a tie, so a miss)", grade("up", 218.85, 218.85001), "miss")

    # sessions: 20th session after Fri 2026-10-02 is Fri 2026-10-30
    # (Oct 5-9, 12-16, 19-23, 26-30; Columbus Day is not a CME closure)
    ck("20 sessions after 2026-10-02", nth_session_after(date(2026, 10, 2), 20), date(2026, 10, 30))
    # Thanksgiving 2026-11-26 is closed: 3 sessions after Tue 11-24 = Wed 25, Fri 27, Mon 30
    ck("3 sessions after 2026-11-24 skips Thanksgiving", nth_session_after(date(2026, 11, 24), 3), date(2026, 11, 30))

    # contract choice: alive on the exit day, GRAIN rule dead from the 15th
    ck("corn exit 2026-11-13 -> Dec 26", contract_for("corn", date(2026, 11, 13)), (2026, 12))
    ck("corn exit 2026-12-14 -> Dec 26", contract_for("corn", date(2026, 12, 14)), (2026, 12))
    ck("corn exit 2026-12-15 -> Mar 27", contract_for("corn", date(2026, 12, 15)), (2027, 3))
    ck("beans exit 2026-10-30 -> Nov 26", contract_for("beans", date(2026, 10, 30)), (2026, 11))
    ck("beans exit 2026-11-16 -> Jan 27", contract_for("beans", date(2026, 11, 16)), (2027, 1))
    ck("ticker for corn Dec 26", ticker_for(CROP_BY_KEY["corn"], 2026, 12), "ZCZ26.CBT")
    ck("ticker for KC wheat Mar 27", ticker_for(CROP_BY_KEY["kcwheat"], 2027, 3), "KEH27.CBT")

    # binomial: n=10, k=8 -> (45+10+1)/1024
    ck("P(X>=8 | 10)", binom_tail_ge(10, 8), 56 / 1024)
    ck("P(X<=2 | 10)", binom_tail_le(10, 2), 56 / 1024)
    ck("P(X>=0 | 4) is 1", binom_tail_ge(4, 0), 1.0)

    # BH by hand: sorted .01 .03 .04 .2 -> .04 .06 .0533 .2 -> monotone .04 .0533 .0533 .2
    ck("BH adjustment", bh_adjust([0.01, 0.04, 0.03, 0.2]), [0.04, 0.053333, 0.053333, 0.2])
    ck("BH ignores None", bh_adjust([None, 0.02]), [None, 0.02])

    # spells: windows [1,5] [3,7] [5,9] [10,14] -> chain takes 1, 5 (made 5 >= exit 5), 10
    sp = chain_spells([
        {"crop": "corn", "made": "2026-01-01", "exit_day": "2026-01-05"},
        {"crop": "corn", "made": "2026-01-03", "exit_day": "2026-01-07"},
        {"crop": "corn", "made": "2026-01-05", "exit_day": "2026-01-09"},
        {"crop": "corn", "made": "2026-01-10", "exit_day": "2026-01-14"},
        {"crop": "beans", "made": "2026-01-02", "exit_day": "2026-01-06"},
    ])
    ck("spells chain", [(c["crop"], c["made"]) for c in sp],
       [("beans", "2026-01-02"), ("corn", "2026-01-01"), ("corn", "2026-01-05"), ("corn", "2026-01-10")])
    # offset 1 skips the first corn call: takes 3 (exit 7), then 10; beans has
    # one call and offset 1 skips it
    sp1 = chain_spells([
        {"crop": "corn", "made": "2026-01-01", "exit_day": "2026-01-05"},
        {"crop": "corn", "made": "2026-01-03", "exit_day": "2026-01-07"},
        {"crop": "corn", "made": "2026-01-05", "exit_day": "2026-01-09"},
        {"crop": "corn", "made": "2026-01-10", "exit_day": "2026-01-14"},
        {"crop": "beans", "made": "2026-01-02", "exit_day": "2026-01-06"},
    ], offset=1)
    ck("spells chain from offset 1", [(c["crop"], c["made"]) for c in sp1],
       [("corn", "2026-01-03"), ("corn", "2026-01-10")])
    # windows in time across crops: two crops on the same day are ONE window
    wc = [{"crop": k, "made": m, "exit_day": x} for k in ("corn", "beans")
          for m, x in (("2026-01-01", "2026-01-29"), ("2026-01-08", "2026-02-05"),
                       ("2026-01-29", "2026-02-26"))]
    nw, inside = chain_windows(wc)
    ck("two crops on one day count as one window", (nw, len(inside)), (2, 4))
    ck("windows from offset 1", chain_windows(wc, 1)[0], 1)

    # HAC by hand. Days A..D with s = +.5, +.5, -.5, +.5 (one call a day:
    # hit hit miss hit). mean .25, e = .25 .25 -.75 .25. g0 = (4*.0625+.5625-
    # .0625)/4 ... worked: e^2 = .0625 .0625 .5625 .0625 -> g0 = .75/4 = .1875;
    # g1 = (.25*.25 + -.75*.25 + .25*-.75)/4 = (.0625-.1875-.1875)/4 = -.078125.
    # lag 1: lr = .1875 + 2*(1/2)*(-.078125) = .109375; V = 4*.109375 = .4375;
    # z = 1.0 / sqrt(.4375) = 1.511858.
    hc = [{"crop": "corn", "made": f"2026-01-0{i}", "exit_day": "2026-02-01", "outcome": o}
          for i, o in zip(range(1, 5), ("hit", "hit", "miss", "hit"))]
    z, pl, pw = hac_test(hc, lag=1)
    ck("HAC z by hand (lag 1)", z, 1.5119)
    ck("HAC one-sided odds add to one", round(pl + pw, 6), 1.0)
    ck("HAC with lag 0 is the plain z", hac_test(hc, lag=0)[0], round(1.0 / math.sqrt(4 * 0.1875), 4))

    # record + gate: 3 graded calls is under the gate whatever the rate
    r = record([{"crop": "corn", "made": f"2026-01-0{i}", "exit_day": f"2026-02-0{i}", "outcome": "hit",
                 "entry": 100.0, "exit": 101.0} for i in range(1, 4)])
    ck("record counts", (r["graded"], r["hits"], r["hit_rate"], r["windows"]), (3, 3, 100.0, 0))
    ck("record offset 0 takes the first call only", (r["by_offset"][0]["calls"], r["by_offset"][0]["windows"]), (1, 1))
    ck("3 graded calls fail the gate", r["gate_ok"], False)
    ck("verdict below the gate", verdict(r, 0.0, 1.0), "not_enough")
    ck("baselines from entry and exit", (r["rose"], r["fell"], r["rose_rate"]), (3, 0, 100.0))
    # the gate needs 30 windows even with thousands of calls: 4 crops x 100
    # days whose windows all overlap is ONE window
    many = [{"crop": k, "made": (date(2020, 1, 1) + timedelta(days=i)).isoformat(),
             "exit_day": "2021-01-01", "outcome": "hit", "entry": 1.0, "exit": 2.0}
            for k in ("corn", "beans", "wheat", "kcwheat") for i in range(100)]
    rm = record(many)
    ck("400 overlapping calls are 1 window and fail the gate", (rm["graded"], rm["windows"], rm["gate_ok"]), (400, 1, False))
    # verdict wording is built from the numbers
    vt = verdict_text({"verdict": "coin_flip", "hit_rate": 47.0, "fell_rate": 51.6, "rose_rate": 48.4,
                       "by_offset": [{"rate": 50.4}, {"rate": 46.9}, {"rate": 46.6}, {"rate": 44.1}]})
    ck("verdict text", vt, "No better than a coin flip; below half in 4 of 5 ways of counting, "
                           "and worse than always saying down.")

    # NO LOOK-AHEAD. Build a synthetic deep file, take the backtest's decision
    # at row 170, then rewrite every row after the decision's own report
    # (except the exit price, which grades it) and confirm the decision holds.
    import random
    rnd = random.Random(7)
    n = 200
    d0 = date(2010, 1, 5)
    dates = [(d0 + timedelta(weeks=i)).isoformat() for i in range(n)]
    b = {"dates": dates,
         "oi": [1000] * n,
         "mm_long": [rnd.randint(100, 600) for _ in range(n)],
         "mm_short": [rnd.randint(100, 600) for _ in range(n)],
         "px_entry": [100 + rnd.uniform(-20, 20) for _ in range(n)],
         "px_entry_date": [CAL.entry_date(date.fromisoformat(x)).isoformat() for x in dates]}
    deep = {"commodities": {"corn": b}}
    calls1, _ = backtest(deep, end="2099-01-01")
    pick = next(c for c in calls1 if c["report"] == dates[170])
    # Rewrite the future twice, once far above and once far below anything
    # before it: a rank only sees which side a value falls on, so a single
    # rewrite can land on the same side by chance and hide a leak.
    picks = []
    for hi in (True, False):
        b2 = json.loads(json.dumps(b))
        for i in range(171, n):
            b2["mm_long"][i] = 1000 if hi else 0
            b2["mm_short"][i] = 0 if hi else 1000
            if i != 174:                      # row 174 is the exit; it grades
                b2["px_entry"][i] = 10 ** 4 if hi else 1
        calls2, _ = backtest({"commodities": {"corn": b2}}, end="2099-01-01")
        p2 = next(c for c in calls2 if c["report"] == dates[170])
        picks.append((p2["direction"], p2["signal"], p2["cot_pct"], p2["trend_pct"]))
    ck("decision at row 170 ignores rows after it",
       picks, [(pick["direction"], pick["signal"], pick["cot_pct"], pick["trend_pct"])] * 2)
    ck("first decision needs 156 prior reports", min(dates.index(c["report"]) for c in calls1) >= 156, True)
    # and a mutation the guard MUST see: change row 170's own positioning
    b3 = json.loads(json.dumps(b))
    b3["mm_long"][170] = 1000
    calls3, _ = backtest({"commodities": {"corn": b3}}, end="2099-01-01")
    pick3 = next(c for c in calls3 if c["report"] == dates[170])
    ck("changing row 170 itself does move the decision", pick3["signal"], "crowded_long")

    # cutoff: nothing graded after the cutoff
    calls4, sk4 = backtest(deep, end=dates[180])
    ck("cutoff excludes later exits", all(c["exit_day"] <= dates[180] for c in calls4), True)

    # ── MONDAY AS-OF: the release-day look-ahead ──────────────────────────
    # Mon 2017-07-03 (Tuesday was July 4). CFTC published Fri Jul 7 at 3:30 PM
    # ET, after grains settled; the first honest close is Mon Jul 10. The old
    # calendar (as_of + 3) said Thu Jul 6 release, Fri Jul 7 entry.
    ck("Monday as-of: entry is Mon 2017-07-10", CAL.entry_date(date(2017, 7, 3)), date(2017, 7, 10))
    # (a) the backtest REFUSES a cot-deep row still carrying the old Friday
    # entry, and accepts the same row with the corrected Monday entry.
    mdates = [(date(2014, 7, 1) + timedelta(weeks=i)).isoformat() for i in range(170)]
    mdates = [x if x != "2017-07-04" else "2017-07-03" for x in mdates]
    k_mon = mdates.index("2017-07-03")
    mb = {"dates": mdates, "oi": [1000] * 170,
          "mm_long": [300 + (i % 7) for i in range(170)], "mm_short": [200] * 170,
          "px_entry": [100.0 + 0.1 * i for i in range(170)],
          "px_entry_date": [CAL.entry_date(date.fromisoformat(x)).isoformat() for x in mdates]}
    stale = json.loads(json.dumps(mb))
    stale["px_entry_date"][k_mon] = "2017-07-07"          # what the old calendar wrote
    cs_stale, sk_stale = backtest({"commodities": {"corn": stale}}, end="2099-01-01")
    cs_good, _ = backtest({"commodities": {"corn": mb}}, end="2099-01-01")
    ck("stale Friday entry for the Monday as-of is refused",
       any(c["report"] == "2017-07-03" for c in cs_stale), False)
    ck("...and the refusal is counted with its reason",
       sk_stale.get("entry close predates the corrected release date (cot-deep.json not rebuilt yet)"), 1)
    ck("...the call 4 reports earlier, whose exit is that row, is refused too",
       any(c["report"] == mdates[k_mon - 4] for c in cs_stale), False)
    got = next((c for c in cs_good if c["report"] == "2017-07-03"), None)
    ck("corrected Monday entry is used, made Mon 2017-07-10", (got or {}).get("made"), "2017-07-10")
    # (b) live: on Fri 2017-07-07 the Monday as-of report is NOT tradable; on
    # Mon 2017-07-10 it is, and that is the day the call is made.
    def mstub(symbols, start):
        if symbols[0].endswith("=F"):
            s = {}
            d = date(2017, 1, 2)
            while d <= date(2017, 7, 14):
                if CC.is_trading_day(d):
                    s[d] = 400.0 + 0.01 * (d - date(2017, 1, 2)).days
                d += timedelta(days=1)
            return s, symbols[0]
        return {date(2017, 7, 7): 380.0, date(2017, 7, 10): 381.0}, symbols[0]
    md = {"commodities": {"corn": {"dates": mdates, "oi": mb["oi"], "mm_long": mb["mm_long"], "mm_short": mb["mm_short"]}}}
    cf, wf = make_call(CROP_BY_KEY["corn"], date(2017, 7, 7), md, fetch=mstub)
    ck("live, Fri 2017-07-07: the Monday as-of report is not usable yet",
       (cf, latest_usable_report(md["commodities"]["corn"], date(2017, 7, 7)) == k_mon), (None, False))
    cm, wm = make_call(CROP_BY_KEY["corn"], date(2017, 7, 10), md, fetch=mstub)
    ck("live, Mon 2017-07-10: the call is made on that report",
       ((cm or {}).get("cot_report"), (cm or {}).get("made"), (cm or {}).get("entry")), ("2017-07-03", "2017-07-10", 381.0))
    ck("live exit is the next report's entry four weeks on", (cm or {}).get("exit_day"),
       live_exit_day(date(2017, 7, 3)).isoformat())
    # (c) shutdown weeks are skipped, never guessed
    sh = [(date(2018, 9, 4) + timedelta(weeks=i)).isoformat() for i in range(170)]
    shb = {"dates": sh, "oi": [1000] * 170, "mm_long": [300] * 170, "mm_short": [200] * 170,
           "px_entry": [100.0 + 0.1 * i for i in range(170)],
           "px_entry_date": [CAL.entry_date(date.fromisoformat(x)).isoformat() for x in sh]}
    cs_sh, sk_sh = backtest({"commodities": {"corn": shb}}, end="2099-01-01")
    ck("no backtest call on a shutdown report (2018-12-25 .. 2019-03-05)",
       any(CAL.release_unknown(date.fromisoformat(c["report"])) for c in cs_sh), False)

    # the briefing line: entry in dollars, 4 weeks, three-word tail, <= 25 words
    t = action_text([{"crop": "corn", "made": "2026-10-05", "direction": "up", "entry": 497.0},
                     {"crop": "beans", "made": "2026-10-05", "direction": "down", "entry": 1020.5}],
                    {"gate_ok": False, "graded": 0, "hits": 0},
                    {"gate_ok": True, "verdict": "coin_flip"})
    ck("action text", t, "Bot call, Oct 5 close, 4 weeks out: corn $4.97 up, soybeans $10.21 down."
                         " Backtest: no edge.")
    ck("action text has no percent sign", "%" in t, False)
    # The briefing caps The Action at 25 words (briefing_cut.CAP_ACTION). The
    # longest line the bot can write: four crops, four-digit prices.
    worst = action_text([{"crop": c["key"], "made": "2026-12-25", "direction": "down", "entry": 1234.5} for c in CROPS],
                        {"gate_ok": True, "verdict": "coin_flip"}, {"gate_ok": True, "verdict": "coin_flip"})
    ck("longest action text fits 25 words", len(worst.split()) <= 25, True)
    ck("longest action text", worst, "Bot call, Dec 25 close, 4 weeks out: corn $12.35 down, soybeans $12.35 down,"
                                     " Chicago wheat $12.35 down, KC wheat $12.35 down. Live: no edge.")
    ck("label is BOT CALL until the live record holds up", action_label({"verdict": "coin_flip"}), "BOT CALL")
    ck("label is THE ACTION once it holds up", action_label({"verdict": "held_up"}), "THE ACTION")

    # make_call end to end on a stub feed, including the refusal path.
    # Report Tue 2026-09-29 -> released Fri Oct 2 -> entry Mon Oct 5; exit is
    # the Oct 27 report's entry, Mon Nov 2; corn alive on Nov 2 -> Dec 26.
    def stub(symbols, start):
        day = date(2026, 10, 5)
        if symbols[0].endswith("=F"):
            s = {day - timedelta(days=k): 500.0 - 0.1 * k for k in range(0, 200) if CC.is_trading_day(day - timedelta(days=k))}
            return s, symbols[0]
        return {day: 497.25}, symbols[0]
    dd = {"commodities": {"corn": {
        "dates": [(date(2023, 9, 26) + timedelta(weeks=i)).isoformat() for i in range(158)],
        "oi": [1000] * 158, "mm_long": [300] * 157 + [300], "mm_short": [200] * 158}}}
    ck("stub file's last report is 2026-09-29", dd["commodities"]["corn"]["dates"][-1], "2026-09-29")
    # all prior equal to current -> percentile 50 -> trend decides; trend is up
    call, why = make_call(CROP_BY_KEY["corn"], date(2026, 10, 5), dd, fetch=stub)
    ck("stub call direction", (call or {}).get("direction"), "up")
    ck("stub call contract", (call or {}).get("ticker"), "ZCZ26.CBT")
    ck("stub call entry and target", ((call or {}).get("entry"), (call or {}).get("target")), (497.25, 497.5))
    ck("stub call exit day", (call or {}).get("exit_day"), "2026-11-02")
    ck("stub call id is crop and report", (call or {}).get("id"), "corn-2026-09-29")
    nc, nwhy = make_call(CROP_BY_KEY["corn"], date(2026, 10, 6), dd, fetch=stub)
    ck("no second call on the same report the next day", nc, None)
    ck("first live call is the Oct 5 close", first_live_call(dd), "2026-10-05")

    # grading on a stub feed
    cs = [dict(call)]
    grade_open(cs, date(2026, 11, 2), fetch=lambda s, st: ({date(2026, 11, 2): 497.25}, s[0]))
    ck("graded tie is a miss", (cs[0]["status"], cs[0]["outcome"]), ("graded", "miss"))
    cs = [dict(call)]
    grade_open(cs, date(2026, 11, 20), fetch=lambda s, st: ({}, None))
    ck("missing exit settlement goes ungradeable", cs[0]["status"], "ungradeable")

    print()
    if fails:
        print(f"{len(fails)} FAILED: {fails}")
        return 1
    print("all prediction_bot selftests passed")
    return 0


def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--selftest", action="store_true")
    g.add_argument("--backtest", action="store_true")
    g.add_argument("--live", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if a.backtest:
        return cmd_backtest()
    return cmd_live()


if __name__ == "__main__":
    sys.exit(main())
