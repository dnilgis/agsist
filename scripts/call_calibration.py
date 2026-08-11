#!/usr/bin/env python3
"""
call_calibration.py — call-design v2: vol-scaled level bands + the feedback loop.

WHY THIS EXISTS
The scorecard's deterministic era (since 2026-06-24) reads 4 played / 39 missed,
a 9.3% hit rate. That is not a market-reading problem; it is a claim-design
problem: the call demands direction AND a price level resolve by the NEXT close,
and the levels have been multi-day distances. A one-day claim must be one-day
sized. Nothing in grade_calls.py changes — we did not soften the grading, we
redesigned the claim. (Methodology change announced in the changelog; scorecard
keeps the v1 series separate, same precedent as the by_method split.)

Two jobs, one module (single-definition pattern, like grade_calls.iso_date):

1. LEVEL BANDS — realized_moves()/level_band() compute, per instrument, the
   average absolute one-session move from the archive's own locked_prices.
   A v2 call's level should sit within [BAND_MIN_X, BAND_MAX_X] x that average
   from today's close: far enough to mean something, near enough that one
   normal session can get there. generate_daily puts the bands in the prompt;
   briefing_gate WARNs (never blocks — an ambitious level is a choice, not a
   falsehood) when a call lands outside.

2. FEEDBACK LOOP — feedback_block() renders the model's own deterministic
   record (last N graded calls, per-instrument hit rates, streak, and an
   anti-repeat warning after 3 consecutive same-instrument+direction misses)
   into a prompt block. Before this, the generator saw only yesterday's call:
   every day was day one.

Everything fails OPEN: any error here degrades to "no band / no record block",
never to a blocked briefing. Stdlib only. No secrets, no network.
"""
import json
from pathlib import Path

# Band edges, in multiples of the instrument's average absolute daily move.
# 0.25x: below this a level is trivially reachable noise, not a call.
# 0.80x: above this fewer than ~1 session in 3 gets there; that is a
#        multi-day thesis wearing a one-day grade.
BAND_MIN_X = 0.25
BAND_MAX_X = 0.80
# USDA report days (WASDE, Crop Production, Stocks...) run 2-4x a normal
# session; a band built from quiet-day averages would cap the call at a
# distance the day clears by lunch, and a hit that cheap reads as gamed.
# On report days the max widens; the min widens too, so a trivially near
# level cannot bank an easy report-day hit either.
REPORT_DAY_MAX_X = 2.00
REPORT_DAY_MIN_X = 0.50
MIN_SAMPLES = 6      # fewer closes than this -> no band for that instrument
LOOKBACK = 20        # sessions of realized moves to average

# Instruments the call may be made on (locked_prices keys). Order = display order.
BAND_KEYS = ["corn", "beans", "wheat", "cattle", "feeders", "hogs",
             "meal", "soyoil", "oats", "milk", "crude", "natgas"]


def _archive_closes(archive_dir, key, max_days=LOOKBACK + 5):
    """Consecutive available closes for one locked_prices key, oldest->newest.
    Skips market-closed days and days missing the key."""
    arch = Path(archive_dir)
    if not arch.exists():
        return []
    dates = sorted(p.stem for p in arch.glob("*.json") if p.stem != "index")
    closes = []
    for d in dates[-max_days:]:
        try:
            b = json.loads((arch / f"{d}.json").read_text())
        except Exception:
            continue
        if b.get("market_closed"):
            continue
        v = (b.get("locked_prices") or {}).get(key)
        try:
            closes.append(float(v))
        except (TypeError, ValueError):
            continue
    return closes


def realized_moves(archive_dir, key, n=LOOKBACK):
    """Last n absolute close-to-close moves for an instrument. [] if thin."""
    closes = _archive_closes(archive_dir, key)
    moves = [abs(b - a) for a, b in zip(closes, closes[1:])]
    return moves[-n:]


def avg_move(archive_dir, key, n=LOOKBACK):
    """Mean absolute one-session move, or None below MIN_SAMPLES moves."""
    m = realized_moves(archive_dir, key, n)
    if len(m) < MIN_SAMPLES:
        return None
    return sum(m) / len(m)


def level_band(archive_dir, key, report_day=False):
    """(min_dist, max_dist) a v2 level should sit from today's close, or None.
    report_day widens both edges — report sessions are a different regime."""
    a = avg_move(archive_dir, key)
    if a is None or a <= 0:
        return None
    if report_day:
        return (REPORT_DAY_MIN_X * a, REPORT_DAY_MAX_X * a)
    return (BAND_MIN_X * a, BAND_MAX_X * a)


def _fmt(key, v):
    """Format a distance in the instrument's display convention."""
    if key in ("corn", "beans", "wheat", "oats"):        # $/bu -> cents reads best
        return f"{v * 100:.0f}¢" if v * 100 >= 1 else f"{v * 100:.1f}¢"
    if key in ("cattle", "feeders", "hogs", "milk"):     # $/cwt
        return f"${v:.2f}"
    if key == "meal":                                     # $/ton
        return f"${v:.1f}"
    if key == "soyoil":                                   # cents/lb
        return f"{v:.2f}¢"
    return f"${v:.2f}"


def bands_text(archive_dir, keys=None, report_day=False):
    """One line per instrument with enough history: 'corn: 2–6¢ of today's close'."""
    parts = []
    for k in (keys or BAND_KEYS):
        b = level_band(archive_dir, k, report_day=report_day)
        if b is None:
            continue
        parts.append(f"{k}: {_fmt(k, b[0])}–{_fmt(k, b[1])}")
    return " · ".join(parts)


def band_check(call, today_close, archive_dir):
    """Gate-side check of a v2 call's level distance.
    Returns (status, detail): 'ok' | 'too_far' | 'too_near' | 'unknown'.
    Honors the generator's report_day stamp on the call, so a WASDE-day call
    is judged against the widened band it was actually briefed with."""
    try:
        from grade_calls import locked_key
        key = locked_key(call.get("instrument"))
        level = float(call.get("level"))
        close = float(today_close)
    except Exception:
        return "unknown", "unparseable call or close"
    if not key:
        return "unknown", f"no locked key for instrument {call.get('instrument')!r}"
    report_day = bool(call.get("report_day"))
    band = level_band(archive_dir, key, report_day=report_day)
    if band is None:
        return "unknown", f"{key}: not enough archive history for a band"
    dist = abs(level - close)
    lo, hi = band
    tag = " [report-day band]" if report_day else ""
    # Exactly AT an edge is inside (same convention as the exchange-limit
    # gate), and float noise must not flip it: 4.20-4.00 is not 0.2 in
    # binary. Tolerance is relative to the band edge.
    _eps = 1e-9 * max(1.0, hi)
    if dist - hi > _eps:
        return "too_far", (f"{key}: level ${level} is {_fmt(key, dist)} from close ${close}; "
                           f"one-session band is {_fmt(key, lo)}–{_fmt(key, hi)}{tag}")
    if lo - dist > _eps:
        return "too_near", (f"{key}: level ${level} is only {_fmt(key, dist)} from close ${close}; "
                            f"band minimum is {_fmt(key, lo)}{tag} — a level this close grades as noise")
    return "ok", f"{key}: {_fmt(key, dist)} from close, inside {_fmt(key, lo)}–{_fmt(key, hi)}{tag}"


# ────────────────────────────── feedback loop ──────────────────────────────

def _det_records(scorecard):
    """Deterministic-era graded records, oldest->newest, with structured fields
    (build_scorecard writes instrument/direction from the computed call)."""
    recs = [r for r in reversed(scorecard.get("records") or [])   # stored newest-first
            if r.get("method") == "deterministic"
            and r.get("outcome") in ("played_out", "didnt")]
    return recs


def anti_repeat(records, k=3):
    """If the last k graded calls are same instrument+direction and ALL missed,
    return (instrument, direction, k). Else None. Needs structured fields."""
    tail = [r for r in records if r.get("instrument")][-k:]
    if len(tail) < k:
        return None
    inst = {(r.get("instrument") or "").lower() for r in tail}
    dirs = {(r.get("direction") or "").lower() for r in tail}
    if len(inst) == 1 and len(dirs) == 1 and all(r["outcome"] == "didnt" for r in tail):
        return (tail[0]["instrument"], tail[0]["direction"], k)
    return None


def feedback_block(scorecard_path, n=10):
    """Render YOUR RECORD for the generation prompt. '' when nothing usable —
    the caller just omits the block (fail open)."""
    try:
        sc = json.loads(Path(scorecard_path).read_text())
    except Exception:
        return ""
    recs = _det_records(sc)
    if not recs:
        return ""
    tail = recs[-n:]
    lines = []
    for r in tail:
        if r.get("instrument"):
            head = f"{r['instrument']} {r.get('direction', '?')} -> ${r.get('level', '?')}"
        else:
            head = (r.get("call") or "")[:60]
        mark = "HIT " if r["outcome"] == "played_out" else "miss"
        lines.append(f"  {r.get('made', '?')}: {head}  [{mark}]")

    by_inst = {}
    for r in recs:
        k = (r.get("instrument") or "").lower()
        if not k:
            continue
        g = by_inst.setdefault(k, [0, 0])
        g[0] += 1 if r["outcome"] == "played_out" else 0
        g[1] += 1
    inst_bits = [f"{k} {v[0]}/{v[1]}" for k, v in sorted(by_inst.items(), key=lambda kv: -kv[1][1])]

    streak = 0
    for r in reversed(recs):
        if r["outcome"] == "played_out":
            streak += 1
        else:
            break
    hits = sum(1 for r in recs if r["outcome"] == "played_out")

    block = ("══ YOUR RECORD (deterministic grading, do not flatter it) ══\n"
             f"All-time: {hits}/{len(recs)} played out. Last {len(tail)}:\n"
             + "\n".join(lines) + "\n"
             + (f"By instrument: {' · '.join(inst_bits)}.\n" if inst_bits else "")
             + f"Current hit streak: {streak}.\n")
    ar = anti_repeat(recs)
    if ar:
        block += (f"WARNING: your last {ar[2]} calls were all {ar[0]} {ar[1]} and ALL missed. "
                  f"Do not make that call again today unless the data is materially new — "
                  f"change the instrument or the thesis.\n")
    block += ("Use this record: avoid re-running setups that keep missing, keep what is "
              "working, and size your level to the band above, not to the story.")
    return block
