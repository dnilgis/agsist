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
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from contract_calendar import is_trading_day, prior_trading_day   # ONE trading calendar

try:
    from zoneinfo import ZoneInfo
    _CT = ZoneInfo("America/Chicago")
except Exception:                      # pragma: no cover - stdlib since 3.9
    _CT = timezone.utc

# The briefing's board is "the close". A session's closes are all in by 13:30 CT
# (CBOT grain 13:20, CME livestock 13:00, NYMEX crude 13:30), so an issue
# generated from 14:00 CT onward on a trading day holds THAT day's closes;
# anything earlier holds the previous session's. Measured over the 185 archived
# issues: 167 publish before 12:00 CT and 18 are post-close re-runs, none
# between 12:00 and 15:00, so this boundary sits in an empty part of the day.
SETTLE_HOUR_CT = 14

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

def board_session(daily):
    """WHICH SESSION'S CLOSES this issue's board holds. Returns a date or None.

    This is the fix for the grading defect found on 2026-09-13. Every grader in
    the repo picked "the previous archived file" as the briefing to grade
    against. The archive publishes on weekends and holidays, and those issues
    carry the last close forward unchanged, so Sunday graded Saturday's call
    against Saturday's own board: p0 == p1, direction can never be satisfied,
    and the call was recorded as a miss before any market opened. 20 of 81
    graded calls were scored that way.

    Three other places in this repo had already learned this lesson for the
    price table (_same_board in brief_email.py, briefing_gate.py and
    send_morning_brief.py all carry the same docstring about it). The grader
    never got the message, and a price comparison could not have given it:
    locked_prices carries bitcoin, which moves 89% of weekend pairs and makes a
    frozen ag board look like a new session. The session is a CALENDAR fact, so
    it is answered from the calendar."""
    g = daily.get("generated_at")
    dt = None
    if g:
        try:
            dt = datetime.fromisoformat(str(g))
            dt = dt.astimezone(_CT) if dt.tzinfo else dt.replace(tzinfo=timezone.utc).astimezone(_CT)
        except (TypeError, ValueError):
            dt = None
    if dt is not None:
        d = dt.date()
        return d if (is_trading_day(d) and dt.hour >= SETTLE_HOUR_CT) else prior_trading_day(d)
    # No usable timestamp: fall back to the issue date, assuming the normal
    # pre-open publish (167 of 185 issues are before noon CT).
    iso = iso_date(daily)
    if not iso:
        return None
    import datetime as _dt
    return prior_trading_day(_dt.date.fromisoformat(iso))


def _archive_dates(archive_dir):
    import os
    try:
        return sorted(f[:-5] for f in os.listdir(archive_dir)
                      if f.endswith(".json") and f != "index.json")
    except OSError:
        return []


def find_graded_call(today_daily, archive_dir="data/daily-archive"):
    """THE definition of which prior call today's briefing grades.

    Returns (made_date, prior_daily, note) or (None, None, reason).

    Today grades a call only when a session has settled since the previous
    issue. If the board has not moved on (Sunday after Saturday, Monday before
    the open, Tuesday after a Monday holiday) there is nothing new to grade and
    the briefing carries no yesterdays_call block — which is the honest answer,
    not a miss.

    Imported by generate_daily.py, briefing_gate.py and build_scorecard.py so
    the prompt, the page, the gate and the public record cannot disagree about
    which call is being scored."""
    today_iso = iso_date(today_daily)
    if today_iso is None:
        return None, None, "cannot parse today's briefing date"
    sess = board_session(today_daily)
    if sess is None:
        return None, None, "cannot determine which session today's board holds"
    dates = [d for d in _archive_dates(archive_dir) if d < today_iso]
    if not dates:
        return None, None, "no prior archive to grade against"
    arch = Path(archive_dir)

    def _load(d):
        try:
            return json.loads((arch / f"{d}.json").read_text())
        except (OSError, ValueError):
            return None

    prev = _load(dates[-1])
    prev_sess = board_session(prev) if prev else None
    if prev_sess is not None and sess <= prev_sess:
        return None, None, (f"no session has settled since {dates[-1]} "
                            f"(both issues hold the {sess} close)")
    for d in reversed(dates):
        prior = _load(d)
        if not prior:
            continue
        call = prior.get("todays_call")
        if not isinstance(call, dict) or not call.get("instrument"):
            continue
        ps = board_session(prior)
        if ps is None or ps >= sess:
            # Backstop for a malformed archive (a bad generated_at that puts an
            # earlier issue on a later session). Unreachable while the check
            # above stands, and deliberately kept: grading backwards is worse
            # than not grading.
            return None, None, (f"the most recent call ({d}) was made from the "
                                f"{ps} board; today holds {sess}")
        return d, prior, f"grading {d}'s call ({ps} board) against the {sess} close"
    return None, None, "no prior briefing carries a structured call"


def grading_issue_for(made_date, archive_dir="data/daily-archive"):
    """The issue that scores the call made on `made_date`: the FIRST later
    briefing whose board holds a later session. Returns a date string or None
    when no session has settled yet (the call is still pending).

    find_graded_call answers "what does today grade" for the briefing, which
    shows one call. This answers "who grades this call" for the public record,
    which must score every call exactly once. Both read board_session, so they
    cannot disagree about what a session is."""
    prior = None
    try:
        prior = json.loads((Path(archive_dir) / f"{made_date}.json").read_text())
    except (OSError, ValueError):
        return None
    made_sess = board_session(prior)
    if made_sess is None:
        return None
    for d in _archive_dates(archive_dir):
        if d <= made_date:
            continue
        try:
            later = json.loads((Path(archive_dir) / f"{d}.json").read_text())
        except (OSError, ValueError):
            continue
        ls = board_session(later)
        if ls is not None and ls > made_sess:
            return d
    return None


def grade_today(daily_path="data/daily.json", archive_dir="data/daily-archive", write=True):
    daily = json.loads(Path(daily_path).read_text())
    # daily.json carries a DISPLAY date ("Monday, August 3, 2026") while the
    # archive filenames are ISO. The old lexical compare ("2026-08-03" < "Monday...")
    # was always true, so "prior" included TODAY'S OWN archive and every call was
    # graded against its own close (p0==p1 -> direction always false -> forced
    # "didnt") from 2026-06-26 onward. iso_date normalizes; find_graded_call then
    # picks the call by SESSION, not by file order (see board_session).
    made, prior_daily, why = find_graded_call(daily, archive_dir)
    if made is None:
        # Not an error. A Sunday issue, or a Monday before the open, has no new
        # close to grade against. The block is dropped rather than scored.
        print(f"[grade] nothing to grade: {why}")
        if isinstance(daily.get("yesterdays_call"), dict):
            daily["yesterdays_call"] = {}
            if write:
                Path(daily_path).write_text(json.dumps(daily, ensure_ascii=False, indent=2))
        return daily
    outcome, call, p0, p1, note = grade_from_archives(daily, prior_daily)
    if outcome is None:
        print(f"[grade] {note}"); return daily
    yc = daily.get("yesterdays_call") or {}
    llm_outcome = yc.get("outcome")
    yc["outcome"] = outcome                      # deterministic outcome wins
    yc["computed"] = {"outcome": outcome, "made": made, "p0": p0, "p1": p1,
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
