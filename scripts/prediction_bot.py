#!/usr/bin/env python3
"""
prediction_bot.py -- AGSIST's statistical prediction bot (rule set bot-v1).

WHAT IT DOES
------------
Once per trading day, after the close, it calls the direction of front-month
corn, soybeans, Chicago wheat and KC wheat over the next 20 trading sessions.
Every call is graded by this code, on a fixed rule, against settlement closes.
It also runs a walk-forward backtest of the same rule on the weekly history
in data/cot-deep.json, and keeps that result beside the live record, never
merged with it.

THE RULE (pre-registered 2026-10-03, before the first live call; one rule,
no search over alternatives -- see RULES below, which the page prints)
------------------------------------------------------------------------
For each crop, at the close of the decision day:

  1. Crowding. Take managed money's net position (long minus short) as a share
     of open interest, from the latest CFTC report a reader could have traded
     on by that close. Rank it against the 156 reports before it (three years).
       - at or above the 90th percentile  -> call DOWN (funds crowded long)
       - at or below the 10th percentile  -> call UP   (funds crowded short)
  2. Otherwise, trend. The 13-week change in the roll-repaired front-month
     index: up -> call UP, down -> call DOWN, exactly flat -> no call.

  Grade: an UP call is right when the settlement 20 sessions later is above
  the entry settlement; a DOWN call when it is below. Equal is a miss.

No seasonal signal. The repo's seasonal figures (price-stats.json) are built
from the full sample, which would classify 2013 using 2026 (honest-numbers
rule 5), and one more signal is one more knob.

LIVE vs BACKTEST -- the instruments differ and the page says so
---------------------------------------------------------------
  live      a named contract (e.g. ZCZ26.CBT), entry = its settlement on the
            call day, exit = its settlement on the 20th trading day after,
            using scripts/contract_calendar.py for the session count. The
            contract is the first listed month still alive on the exit day,
            so no live call spans a roll.
  backtest  the roll-repaired front-month index in data/cot-deep.json, built
            by cot_deep.py from Yahoo's continuous series. One call per weekly
            report, made at px_entry (the first close after CFTC published),
            graded at the px_entry four reports later (about 20 sessions).
            Decisions whose exit falls after BACKTEST_END are excluded, so the
            backtest never overlaps the live period.

USAGE
-----
  python3 scripts/prediction_bot.py --selftest   hand-worked cases, no network
  python3 scripts/prediction_bot.py --backtest   recompute the backtest only
  python3 scripts/prediction_bot.py --live       make today's calls, grade
                                                 matured ones (needs yfinance)
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
    "version": "bot-v1",
    "registered": "2026-10-03",
    "horizon_sessions": 20,
    "trend_lookback_weeks": 13,
    "trend_lookback_days": 91,
    "cot_window_reports": 156,
    "cot_crowded_long_pct": 90.0,
    "cot_crowded_short_pct": 10.0,
    "cot_max_age_days": 14,
    "tie_rule": "a settlement equal to the entry is a miss",
    "min_graded_for_rate": 40,
    "min_spells_for_rate": 8,
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


def chain_spells(calls):
    """Greedy chain of calls whose windows do not overlap, per crop: take the
    first call, then the first call made on or after the previous one's exit
    day, and so on. Each call needs 'crop', 'made', 'exit_day'."""
    out = []
    by_crop = {}
    for c in calls:
        by_crop.setdefault(c["crop"], []).append(c)
    for crop in sorted(by_crop):
        last_exit = None
        for c in sorted(by_crop[crop], key=lambda x: x["made"]):
            if last_exit is None or c["made"] >= last_exit:
                out.append(c)
                last_exit = c["exit_day"]
    return out


def record(calls):
    """Statistics for a list of GRADED calls (outcome hit/miss). Pure."""
    g = [c for c in calls if c.get("outcome") in ("hit", "miss")]
    n = len(g)
    hits = sum(1 for c in g if c["outcome"] == "hit")
    sp = chain_spells(g)
    ns = len(sp)
    sh = sum(1 for c in sp if c["outcome"] == "hit")
    ups = [c for c in g if c.get("rose") is not None]
    rose = sum(1 for c in ups if c["rose"])
    gate = n >= RULES["min_graded_for_rate"] and ns >= RULES["min_spells_for_rate"]
    return {
        "graded": n,
        "hits": hits,
        "hit_rate": round(100.0 * hits / n, 1) if n else None,
        "spells": ns,
        "spell_hits": sh,
        "spell_hit_rate": round(100.0 * sh / ns, 1) if ns else None,
        "p_luck": round(binom_tail_ge(ns, sh), 6) if ns else None,
        "p_worse": round(binom_tail_le(ns, sh), 6) if ns else None,
        "rose": rose if ups else None,
        "rose_of": len(ups) if ups else None,
        "rose_rate": round(100.0 * rose / len(ups), 1) if ups else None,
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


def family(calls):
    """Pooled plus one record per crop, BH-adjusted as one family of tests."""
    groups = [("all", calls)] + [(c["key"], [x for x in calls if x["crop"] == c["key"]]) for c in CROPS]
    recs = [(k, record(v)) for k, v in groups]
    tested = [(k, r) for k, r in recs if r["gate_ok"]]
    adj_l = bh_adjust([r["p_luck"] for _, r in tested])
    adj_w = bh_adjust([r["p_worse"] for _, r in tested])
    adj = {k: (adj_l[i], adj_w[i]) for i, (k, _) in enumerate(tested)}
    out = {}
    for k, r in recs:
        pl, pw = adj.get(k, (None, None))
        r["p_luck_adjusted"] = pl
        r["p_worse_adjusted"] = pw
        r["verdict"] = verdict(r, pl, pw)
        out[k] = r
    return out, len(tested)


# ═══ backtest ═══════════════════════════════════════════════════════════════

def backtest(deep, end=BACKTEST_END):
    """Walk-forward over the weekly file. Each decision at row i reads rows
    <= i only; the exit (row i+4) is read only to grade. Returns (calls,
    skipped-by-reason counts)."""
    H = 4
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
            if i + H >= n or b["px_entry_date"][i + H] is None or b["px_entry"][i + H] is None:
                skip("exit close missing or not yet known")
                continue
            d1 = date.fromisoformat(b["px_entry_date"][i + H])
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
                "rose": round(exit_px, 4) > round(ev, 4),
            })
    return calls, skipped


def backtest_block(deep):
    calls, skipped = backtest(deep)
    fam, ntests = family(calls)
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
        "tests_in_family": ntests,
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
    """One call for one crop on one session, or (None, reason)."""
    b = deep["commodities"].get(crop["key"])
    if not b:
        return None, "crop missing from cot-deep.json"
    r = latest_usable_report(b, day)
    if r is None:
        return None, "no CFTC report usable yet"
    age = (day - date.fromisoformat(b["dates"][r])).days
    if age > RULES["cot_max_age_days"]:
        return None, f"latest usable CFTC report is {age} days old"
    pct = cot_pct(b, r)

    cont, sym = fetch(crop["cont"], day - timedelta(days=200))
    adj = CAL.roll_adjust(cont, crop["key"]) if cont else {}
    trend = None
    if day in adj:
        base_day = day - timedelta(days=RULES["trend_lookback_days"])
        back = [d for d in adj if d <= base_day and (base_day - d).days <= 4]
        if back:
            trend = adj[day] / adj[max(back)] - 1
    elif pct is not None and RULES["cot_crowded_short_pct"] < pct < RULES["cot_crowded_long_pct"]:
        return None, "no continuous-futures close for today yet"

    direction, why = decide(pct, trend)
    if direction is None:
        return None, why

    exit_day = nth_session_after(day, RULES["horizon_sessions"])
    y, m = contract_for(crop["key"], exit_day)
    tk = ticker_for(crop, y, m)
    px, _ = fetch([tk], day - timedelta(days=10))
    if day not in px:
        return None, f"no {tk} settlement for {day} yet"
    entry = px[day]
    target = target_for(direction, entry, crop["tick"])
    validate_call(direction, entry, target)          # refuses, never repairs
    return {
        "id": f"{crop['key']}-{day.isoformat()}",
        "crop": crop["key"], "made": day.isoformat(), "exit_day": exit_day.isoformat(),
        "direction": direction, "signal": why,
        "cot_pct": round(pct, 1) if pct is not None else None,
        "cot_report": b["dates"][r],
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


def action_text(latest, live_all):
    """The briefing's one line. No dollar signs, no percent signs: the gate
    binds those to the morning board, and these numbers are not from it."""
    if not latest:
        return ""
    d = date.fromisoformat(max(c["made"] for c in latest))
    parts = []
    for crop in CROPS:
        c = next((x for x in latest if x["crop"] == crop["key"]), None)
        if c:
            parts.append(f"{crop['inline']} {c['direction']}")
    head = (f"Bot call, {MONTH_ABBR[d.month - 1]} {d.day} settle, "
            f"{RULES['horizon_sessions']} sessions out: " + ", ".join(parts) + ".")
    if not live_all["gate_ok"]:
        tail = " Record: too few graded calls yet."
    else:
        tail = f" Record: {live_all['hits']:,} of {live_all['graded']:,} right."
    return head + tail


def build_output(state, deep, bt=None):
    calls = state.get("calls", [])
    graded = [c for c in calls if c.get("status") == "graded"]
    live, ntests = family(graded)
    days = sorted({c["made"] for c in calls})
    latest = [c for c in calls if days and c["made"] == days[-1]]
    out = {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "rules": RULES,
        "live_start": LIVE_START,
        "crops": [{"key": c["key"], "label": c["label"]} for c in CROPS],
        "latest": {"date": days[-1] if days else None, "calls": latest},
        "live": {"records": live, "tests_in_family": ntests,
                 "open": sum(1 for c in calls if c.get("status") == "open"),
                 "ungradeable": sum(1 for c in calls if c.get("status") == "ungradeable")},
        "action_text": action_text(latest, live["all"]),
        "calls": calls,
        "skipped": state.get("skipped", [])[-120:],
        "backtest": bt if bt is not None else state.get("backtest"),
    }
    return out


def cmd_backtest():
    deep = load_json(DEEP_PATH)
    if not deep:
        raise SystemExit("data/cot-deep.json missing; nothing to backtest")
    state = load_json(OUT_PATH, {}) or {}
    bt = backtest_block(deep)
    out = build_output(state, deep, bt)
    write(out)
    a = bt["records"]["all"]
    print(f"backtest: {a['hits']} of {a['graded']} right ({a['hit_rate']}%), "
          f"{a['spell_hits']} of {a['spells']} separate spells, p_luck={a['p_luck']}, "
          f"verdict={a['verdict']}")
    for c in CROPS:
        r = bt["records"][c["key"]]
        print(f"  {c['key']:8s} {r['hits']:4d}/{r['graded']:<4d} {r['hit_rate']}%  spells "
              f"{r['spell_hits']}/{r['spells']}  p={r['p_luck']} adj={r['p_luck_adjusted']}  "
              f"rose {r['rose']}/{r['rose_of']}  {r['verdict']}")
    print("  skipped:", bt["skipped"])
    return 0


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
    if today < date.fromisoformat(LIVE_START):
        print(f"{today}: before the live start ({LIVE_START}); no calls made")
    elif not CC.is_trading_day(today):
        print(f"{today}: not a trading day; no calls made")
    else:
        for crop in CROPS:
            cid = f"{crop['key']}-{today.isoformat()}"
            if cid in have:
                print(f"  {cid}: already made; calls are never rewritten")
                continue
            try:
                call, why = make_call(crop, today, deep)
            except ValueError as e:
                call, why = None, f"refused: {e}"
            if call:
                calls.append(call)
                print(f"  {cid}: {call['direction']} ({why}) {call['ticker']} entry {call['entry']} -> grade {call['exit_day']}")
            else:
                skipped = [s for s in skipped if not (s["crop"] == crop["key"] and s["date"] == today.isoformat())]
                skipped.append({"crop": crop["key"], "date": today.isoformat(), "reason": why})
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


def _dump(path, out, indent=1):
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

    # record + gate: 3 graded calls is under the gate whatever the rate
    r = record([{"crop": "corn", "made": f"2026-01-0{i}", "exit_day": f"2026-02-0{i}", "outcome": "hit", "rose": True}
                for i in range(1, 4)])
    ck("record counts", (r["graded"], r["hits"], r["hit_rate"], r["spells"]), (3, 3, 100.0, 1))
    ck("3 graded calls fail the gate", r["gate_ok"], False)
    ck("verdict below the gate", verdict(r, 0.0, 1.0), "not_enough")

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

    # the briefing line carries no $ or %
    t = action_text([{"crop": "corn", "made": "2026-10-05", "direction": "up"},
                     {"crop": "beans", "made": "2026-10-05", "direction": "down"}],
                    {"gate_ok": False, "graded": 0, "hits": 0})
    ck("action text", t, "Bot call, Oct 5 settle, 20 sessions out: corn up, soybeans down."
                         " Record: too few graded calls yet.")
    ck("action text has no $ or %", ("$" in t) or ("%" in t), False)
    # The briefing caps The Action at 25 words (briefing_cut.CAP_ACTION). The
    # longest line the bot can write: four crops and a five-digit record.
    worst = action_text([{"crop": c["key"], "made": "2026-12-25", "direction": "down"} for c in CROPS],
                        {"gate_ok": True, "graded": 12345, "hits": 12345})
    ck("longest action text fits 25 words", len(worst.split()) <= 25, True)
    ck("longest action text", worst, "Bot call, Dec 25 settle, 20 sessions out: corn down, soybeans down,"
                                     " Chicago wheat down, KC wheat down. Record: 12,345 of 12,345 right.")

    # make_call end to end on a stub feed, including the refusal path
    def stub(symbols, start):
        day = date(2026, 10, 5)
        if symbols[0].endswith("=F"):
            s = {day - timedelta(days=k): 500.0 - 0.1 * k for k in range(0, 200) if CC.is_trading_day(day - timedelta(days=k))}
            return s, symbols[0]
        return {day: 497.25}, symbols[0]
    dd = {"commodities": {"corn": {
        "dates": [(date(2023, 9, 26) + timedelta(weeks=i)).isoformat() for i in range(158)],
        "oi": [1000] * 158, "mm_long": [300] * 157 + [300], "mm_short": [200] * 158}}}
    # all prior equal to current -> percentile 50 -> trend decides; trend is up
    call, why = make_call(CROP_BY_KEY["corn"], date(2026, 10, 5), dd, fetch=stub)
    ck("stub call direction", (call or {}).get("direction"), "up")
    ck("stub call contract", (call or {}).get("ticker"), "ZCZ26.CBT")
    ck("stub call entry and target", ((call or {}).get("entry"), (call or {}).get("target")), (497.25, 497.5))
    ck("stub call exit day", (call or {}).get("exit_day"), "2026-11-02")

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
