#!/usr/bin/env python3
"""
grade_calls.py — deterministic grading of Yesterday's Call (direction AND level).

The generator emits, each day, a falsifiable forward call:
    todays_call = {"instrument": "corn", "direction": "up"|"down", "level": <price>}
in the SAME display units as locked_prices (grains in $/bu, livestock $/cwt, etc.).

The NEXT trading day, the outcome is COMPUTED here from the actual closes — never
decided by the LLM. A call counts as "played_out" only if BOTH hold:
    direction:  today's close moved the called way vs the close when the call was made
    level:      today's close reached/!held the called level (>= for up, <= for down)
Either one failing => "didnt". Missing data => "pending".

This removes the self-serving classifier: the model can describe the call, but it
cannot score a miss as a win, because a price function decides it.

Used by:
  - generate_daily.py  (compute yesterday's outcome, inject it into the prompt)
  - briefing_gate.py   (verify the published outcome == computed; block on mismatch)
  - build_scorecard.py (recompute from the archive; the public record can't drift)
"""
import json, sys
from pathlib import Path

# call instrument -> locked_prices key
INSTRUMENT_TO_LOCKED = {
    "corn": "corn", "soybeans": "beans", "soybean": "beans", "beans": "beans",
    "wheat": "wheat", "oats": "oats", "soybean meal": "meal", "meal": "meal",
    "soybean oil": "soyoil", "soyoil": "soyoil",
    "live cattle": "cattle", "cattle": "cattle", "feeder": "feeders", "feeders": "feeders",
    "lean hogs": "hogs", "hogs": "hogs", "milk": "milk",
    "crude": "crude", "wti": "crude", "natural gas": "natgas", "natgas": "natgas",
}

def locked_key(instrument):
    return INSTRUMENT_TO_LOCKED.get((instrument or "").strip().lower())

def compute_outcome(call, p0, p1):
    """call={instrument,direction,level}; p0=close when made; p1=close when judged.
    Returns 'played_out' | 'didnt' | 'pending'."""
    if not isinstance(call, dict):
        return "pending"
    d = (call.get("direction") or "").strip().lower()
    L = call.get("level")
    if p0 is None or p1 is None or d not in ("up", "down") or L is None:
        return "pending"
    try:
        p0 = float(p0); p1 = float(p1); L = float(L)
    except (TypeError, ValueError):
        return "pending"
    if d == "up":
        direction_ok = p1 > p0
        level_ok = p1 >= L
    else:
        direction_ok = p1 < p0
        level_ok = p1 <= L
    return "played_out" if (direction_ok and level_ok) else "didnt"

def explain(call, p0, p1, outcome):
    d = (call.get("direction") or "").lower(); L = call.get("level")
    arrow = "above" if d == "up" else "below"
    return (f"{call.get('instrument')}: called {d} to {arrow} ${L} "
            f"(made ${p0}); closed ${p1} -> {outcome} "
            f"[direction {'ok' if ((p1>p0) if d=='up' else (p1<p0)) else 'missed'}, "
            f"level {'ok' if ((p1>=float(L)) if d=='up' else (p1<=float(L))) else 'missed'}]")

def _locked(daily, instrument):
    lp = daily.get("locked_prices") or {}
    k = locked_key(instrument)
    v = lp.get(k) if k else None
    try:
        return float(v) if v is not None else None
    except (TypeError, ValueError):
        return None

def grade_from_archives(today_daily, prior_daily):
    """Given today's and the prior trading day's daily.json dicts, compute the
    outcome of the prior day's todays_call. Returns (outcome, call, p0, p1, note)."""
    call = (prior_daily or {}).get("todays_call")
    if not call or not isinstance(call, dict) or not call.get("instrument"):
        return None, None, None, None, "no structured call in prior briefing"
    p0 = _locked(prior_daily, call["instrument"])     # close when the call was made
    p1 = _locked(today_daily, call["instrument"])      # close when judged
    outcome = compute_outcome(call, p0, p1)
    return outcome, call, p0, p1, explain(call, p0, p1, outcome)

def grade_today(daily_path="data/daily.json", archive_dir="data/daily-archive", write=True):
    daily = json.loads(Path(daily_path).read_text())
    arch = Path(archive_dir)
    dates = sorted(p.stem for p in arch.glob("*.json") if p.stem != "index") if arch.exists() else []
    today = daily.get("date")
    prior = [d for d in dates if d < (today or "9999")]
    if not prior:
        print("[grade] no prior archive to grade against"); return daily
    prior_daily = json.loads((arch / f"{prior[-1]}.json").read_text())
    outcome, call, p0, p1, note = grade_from_archives(daily, prior_daily)
    if outcome is None:
        print(f"[grade] {note}"); return daily
    yc = daily.get("yesterdays_call") or {}
    llm_outcome = yc.get("outcome")
    yc["outcome"] = outcome                      # deterministic outcome wins
    yc["computed"] = {"outcome": outcome, "made": prior[-1], "p0": p0, "p1": p1,
                      "instrument": call.get("instrument"), "direction": call.get("direction"),
                      "level": call.get("level")}
    daily["yesterdays_call"] = yc
    flag = "" if llm_outcome in (None, outcome) else f"  (overrode LLM '{llm_outcome}')"
    print(f"[grade] {note}{flag}")
    if write:
        Path(daily_path).write_text(json.dumps(daily, ensure_ascii=False, indent=2))
    return daily

if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("daily", nargs="?", default="data/daily.json")
    ap.add_argument("--archive", default="data/daily-archive")
    ap.add_argument("--check", action="store_true", help="report only, do not write")
    a = ap.parse_args()
    grade_today(a.daily, a.archive, write=not a.check)
