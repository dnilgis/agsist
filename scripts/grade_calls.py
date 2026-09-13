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

plain_call() is the ONE reader-facing description of a graded call. The
generator writes it into yesterdays_call.call_line before the archive renders;
this script writes the same thing as its own workflow step; the scorecard
prints it for every row. There is no second copy.
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

# reader-facing names for the instruments the call can be about
_PLAIN_NAMES = {"corn": "corn", "beans": "soybeans", "soybeans": "soybeans", "wheat": "wheat",
                "cattle": "cattle", "feeders": "feeder cattle", "hogs": "hogs",
                "crude": "crude", "natgas": "natural gas", "meal": "soybean meal",
                "soyoil": "soybean oil", "oats": "oats", "milk": "milk"}


def plain_call(call, p0, p1, outcome=None):
    """THE reader-facing sentence for a graded call, built from the structured
    call and the two closes and nothing else. v5.1 (the cut): this replaces
    the model's yesterdays_call.summary everywhere the verdict is shown (the
    page, the email, the scorecard). It cannot describe a different market
    than the one scored, which the prose did on 23 of 40 rows once.
    Example: 'Called soybeans down toward $12.85 ($12.99 when the call was
    made). It closed at $12.99.'"""
    inst = _PLAIN_NAMES.get((call.get("instrument") or "").strip().lower(), call.get("instrument"))
    d = (call.get("direction") or "").lower()
    lvl = call.get("level")
    way = "up toward" if d == "up" else "down toward"
    got = f" It closed at ${p1}." if p1 is not None else ""
    made = f" (${p0} when the call was made)" if p0 is not None else ""
    return f"Called {inst} {way} ${lvl}{made}.{got}"


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

def iso_date(daily):
    """THE definition of a briefing's date as ISO. daily.json carries a DISPLAY
    date ("Monday, August 3, 2026") while archive filenames are ISO, so a lexical
    compare ("2026-08-03" < "Monday...") is ALWAYS true — that made every "prior
    archive" lookup return TODAY'S OWN file, grading each call against its own
    close (p0==p1). It broke grading from 2026-06-26, and the same copy-pasted
    compare in briefing_gate.py blocked the 2026-08-10 send once grading here was
    fixed and the two graders disagreed. One definition, imported by both.
    Returns None rather than guessing when the date can't be parsed."""
    import datetime as _dt
    raw = (daily.get("date") or "").strip()
    if len(raw) == 10 and raw[4] == "-" and raw[7] == "-":
        return raw
    try:
        return _dt.datetime.strptime(raw, "%A, %B %d, %Y").date().isoformat()
    except ValueError:
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
    # daily.json carries a DISPLAY date ("Monday, August 3, 2026") while the
    # archive filenames are ISO. The old lexical compare ("2026-08-03" < "Monday...")
    # was always true, so "prior" included TODAY'S OWN archive and every call was
    # graded against its own close (p0==p1 -> direction always false -> forced
    # "didnt") from 2026-06-26 onward. Normalize to ISO; fail LOUD if we can't.
    today_iso = iso_date(daily)
    if today_iso is None:
        print(f"[grade] FATAL: cannot parse briefing date {raw!r} to ISO — refusing to guess the prior archive")
        return daily
    prior = [d for d in dates if d < today_iso]
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
    # v5.1: the sentence the reader sees, from the record, not the model.
    yc["call_line"] = plain_call(call, p0, p1, outcome)
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
