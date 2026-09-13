#!/usr/bin/env python3
"""
test_grade_calls.py — the call grader scores a call against a LATER SESSION.

THE DEFECT THIS PINS (found 2026-09-13)
  Every grader in the repo picked "the archived file immediately before this
  one" as the briefing to grade against. The archive publishes on weekends and
  holidays, and those issues carry the last close forward unchanged, so:

      Saturday's issue makes a call from Friday's close.
      Sunday's issue holds Friday's close too.
      Sunday grades Saturday's call: p0 == p1, so "did it move my way" is
      false by construction, and the call is recorded as a MISS before any
      market opens.

  20 of the 81 deterministically graded calls on the live site were scored that
  way. Nothing was red: the row count was right, the outcome was a valid enum,
  and the published hit rate simply read lower than the truth (13.6% against
  18.8% once regraded).

  A price comparison cannot detect this. locked_prices carries bitcoin, which
  trades around the clock and moved in 89% of weekend pairs, so a board with
  every ag contract frozen still looks "different". The session is a calendar
  fact and is answered from the calendar.

Everything here runs against a SYNTHETIC archive. The live archive is written
by a workflow; a suite that asserts over it goes red on its own schedule.
"""
import json
import sys
import tempfile
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import grade_calls as gc
import briefing_gate as bg

PASS = FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok    {name}")
    else:
        FAIL += 1
        print(f"  FAIL  {name}" + (f"  [{detail}]" if detail else ""))


DISPLAY = {0: "Monday", 1: "Tuesday", 2: "Wednesday", 3: "Thursday",
           4: "Friday", 5: "Saturday", 6: "Sunday"}
MONTHS = ["", "January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]


def issue(d, corn, call=None, hour_ct=6, closed=False):
    """One archived briefing. hour_ct is the publish hour in Central; 6 is the
    normal pre-open send, 15 a post-close re-run."""
    dt = date.fromisoformat(d)
    b = {
        "date": f"{DISPLAY[dt.weekday()]}, {MONTHS[dt.month]} {dt.day}, {dt.year}",
        "generated_at": f"{d}T{hour_ct + 5:02d}:30:00+00:00",   # CT -> UTC (CDT)
        "locked_prices": {"corn": corn, "beans": 12.0, "wheat": 7.0,
                          "cattle": 200.0, "bitcoin": 60000 + corn * 1000},
        "market_closed": closed,
    }
    if call:
        b["todays_call"] = call
    return b


def build(tmp, issues):
    ad = Path(tmp) / "daily-archive"
    ad.mkdir(parents=True, exist_ok=True)
    for d, b in issues.items():
        (ad / f"{d}.json").write_text(json.dumps(b))
    return str(ad)


def main():
    print("board_session — which session's closes an issue holds")
    with tempfile.TemporaryDirectory() as tmp:
        # Fri Sep 11, Sat 12, Sun 13, Mon 14, Tue 15 2026 (no holiday)
        pre = issue("2026-09-11", 5.00)
        post = issue("2026-09-11", 5.00, hour_ct=15)
        check("a pre-open Friday issue holds THURSDAY's close",
              gc.board_session(pre) == date(2026, 9, 10), str(gc.board_session(pre)))
        check("a post-close Friday re-run holds FRIDAY's close",
              gc.board_session(post) == date(2026, 9, 11), str(gc.board_session(post)))
        check("a Saturday issue holds Friday's close",
              gc.board_session(issue("2026-09-12", 5.0)) == date(2026, 9, 11))
        check("a Sunday issue holds Friday's close",
              gc.board_session(issue("2026-09-13", 5.0)) == date(2026, 9, 11))
        check("a Monday pre-open issue STILL holds Friday's close",
              gc.board_session(issue("2026-09-14", 5.0)) == date(2026, 9, 11))
        check("a Tuesday pre-open issue holds Monday's close",
              gc.board_session(issue("2026-09-15", 5.0)) == date(2026, 9, 14))
        check("a Tuesday issue after LABOR DAY Monday holds Friday's close",
              gc.board_session(issue("2026-09-08", 5.0)) == date(2026, 9, 4))

    print("\nthe weekend: a frozen board grades nothing")
    UP = {"instrument": "corn", "direction": "up", "level": 5.10}
    with tempfile.TemporaryDirectory() as tmp:
        issues = {
            "2026-09-10": issue("2026-09-10", 4.90, UP),            # Thu, calls
            "2026-09-11": issue("2026-09-11", 5.00, UP),            # Fri, calls
            "2026-09-12": issue("2026-09-12", 5.00, UP, closed=True),   # Sat, frozen board
            "2026-09-13": issue("2026-09-13", 5.00, UP, closed=True),   # Sun, frozen board
            "2026-09-14": issue("2026-09-14", 5.00, UP),            # Mon, pre-open: still Friday
            "2026-09-15": issue("2026-09-15", 5.20, UP),            # Tue: Monday's close at last
        }
        ad = build(tmp, issues)

        made, prior, why = gc.find_graded_call(issues["2026-09-11"], ad)
        check("Friday grades Thursday's call", made == "2026-09-10", why)

        made, prior, why = gc.find_graded_call(issues["2026-09-12"], ad)
        check("Saturday grades FRIDAY's call (it holds Friday's close)",
              made == "2026-09-11", why)

        made, prior, why = gc.find_graded_call(issues["2026-09-13"], ad)
        check("Sunday grades NOTHING (this is the defect)", made is None, why)

        made, prior, why = gc.find_graded_call(issues["2026-09-14"], ad)
        check("Monday before the open grades nothing", made is None, why)

        made, prior, why = gc.find_graded_call(issues["2026-09-15"], ad)
        check("Tuesday grades MONDAY's call", made == "2026-09-14", why)

        # PROVE THE BUG: the old rule, on this very fixture.
        old_outcome, _c, p0, p1, _n = gc.grade_from_archives(
            issues["2026-09-13"], issues["2026-09-12"])     # Sunday vs Saturday
        check("the OLD rule scored Saturday's call a miss off an unchanged price",
              old_outcome == "didnt" and p0 == p1 == 5.00, f"{old_outcome} {p0}->{p1}")

        # ...and each call is scored exactly once across a full replay.
        graded = [gc.find_graded_call(b, ad)[0] for d, b in sorted(issues.items())]
        graded = [g for g in graded if g]
        check("no call is graded twice in a replay",
              len(graded) == len(set(graded)), str(graded))

    print("\nafter this fix, weekend issues make NO call — and must not re-grade Friday's")
    with tempfile.TemporaryDirectory() as tmp:
        # The world v5.2 produces: sanitize_weekend_blocks wipes todays_call on
        # a closed day, so Sat/Sun carry none. The most recent CALL on Sunday is
        # then Friday's, made from Thursday's board, which Saturday already
        # scored. Without the "has a session settled since the last issue" check
        # Sunday would score it a second time.
        issues = {
            "2026-09-11": issue("2026-09-11", 5.00, UP),                 # Fri, calls
            "2026-09-12": issue("2026-09-12", 5.00, closed=True),        # Sat, NO call
            "2026-09-13": issue("2026-09-13", 5.00, closed=True),        # Sun, NO call
            "2026-09-14": issue("2026-09-14", 5.00, UP),                 # Mon, calls
            "2026-09-15": issue("2026-09-15", 5.20, UP),                 # Tue
        }
        ad = build(tmp, issues)
        check("Saturday scores Friday's call",
              gc.find_graded_call(issues["2026-09-12"], ad)[0] == "2026-09-11")
        made, _p, why = gc.find_graded_call(issues["2026-09-13"], ad)
        check("Sunday does NOT score Friday's call a second time", made is None, why)
        made, _p, why = gc.find_graded_call(issues["2026-09-14"], ad)
        check("Monday does not score it a third time", made is None, why)
        check("Tuesday scores Monday's call",
              gc.find_graded_call(issues["2026-09-15"], ad)[0] == "2026-09-14")
        replay = [gc.find_graded_call(b, ad)[0] for _d, b in sorted(issues.items())]
        replay = [r for r in replay if r]
        check("across the week each call is scored exactly once",
              len(replay) == len(set(replay)) == 2, str(replay))

    print("\nholidays: the session, not the weekday")
    with tempfile.TemporaryDirectory() as tmp:
        # Fri Sep 4, Sat 5, Sun 6, Mon 7 = LABOR DAY, Tue 8, Wed 9
        issues = {
            "2026-09-04": issue("2026-09-04", 7.16, UP, hour_ct=15),   # post-close Friday
            "2026-09-05": issue("2026-09-05", 7.16, UP, closed=True),
            "2026-09-06": issue("2026-09-06", 7.16, UP, closed=True),
            "2026-09-07": issue("2026-09-07", 7.16, closed=True),      # Labor Day, no call
            "2026-09-08": issue("2026-09-08", 7.16, UP),               # Tue, still Friday's close
            "2026-09-09": issue("2026-09-09", 7.27, UP),               # Wed: Tuesday's close
        }
        ad = build(tmp, issues)
        check("the Tuesday after Labor Day grades nothing (no session settled)",
              gc.find_graded_call(issues["2026-09-08"], ad)[0] is None)
        made, prior, why = gc.find_graded_call(issues["2026-09-09"], ad)
        check("Wednesday grades Tuesday's call", made == "2026-09-08", why)
        check("the Friday call's scoring issue is WEDNESDAY, not Saturday",
              gc.grading_issue_for("2026-09-04", ad) == "2026-09-09",
              str(gc.grading_issue_for("2026-09-04", ad)))
        o, c, p0, p1, note = gc.grade_from_archives(issues["2026-09-09"], issues["2026-09-04"])
        check("...and it played out (7.16 -> 7.27, called up to 7.10+)",
              o == "played_out", note)

    print("\na genuinely flat close is still a miss (the fix must not swallow one)")
    with tempfile.TemporaryDirectory() as tmp:
        issues = {
            "2026-09-15": issue("2026-09-15", 5.00, UP),   # Tue, calls corn up
            "2026-09-16": issue("2026-09-16", 5.00),       # Wed: a real session, corn unchanged
        }
        ad = build(tmp, issues)
        made, prior, why = gc.find_graded_call(issues["2026-09-16"], ad)
        check("Wednesday does grade Tuesday's call", made == "2026-09-15", why)
        o, _c, p0, p1, note = gc.grade_from_archives(issues["2026-09-16"], issues["2026-09-15"])
        check("a real session that closed unchanged is a MISS, not a skip",
              o == "didnt", note)

    print("\nthe gate refuses a verdict that today cannot support")
    with tempfile.TemporaryDirectory() as tmp:
        issues = {
            "2026-09-11": issue("2026-09-11", 5.00, UP),
            "2026-09-12": issue("2026-09-12", 5.00, UP, closed=True),
        }
        ad = build(tmp, issues)
        sunday = issue("2026-09-13", 5.00, closed=True)
        sunday["yesterdays_call"] = {"outcome": "didnt", "note": "a verdict with no session behind it"}
        (Path(ad) / "2026-09-13.json").write_text(json.dumps(sunday))
        _passed, issues_found = bg.run(sunday, prices=None,
                                       today=date(2026, 9, 13), archive_dir=ad)
        fails = {c for sev, c, _m in issues_found if sev == "FAIL"}
        check("gate FAILS a Sunday that publishes an outcome",
              "call-outcome" in fails, str(sorted(fails)))
        check("...and the gate blocks the send", _passed is False)

        # the mirror: the SAME issue with no verdict is fine by this check
        clean = issue("2026-09-13", 5.00, closed=True)
        clean["yesterdays_call"] = {}
        _p2, iss2 = bg.run(clean, prices=None, today=date(2026, 9, 13), archive_dir=ad)
        check("an empty block on the same day raises no call-outcome failure",
              "call-outcome" not in {c for sev, c, _m in iss2 if sev == "FAIL"})

    print()
    print(f"grade_calls selftest: {PASS} passed, {FAIL} failed")
    return 1 if FAIL else 0


if __name__ == "__main__":
    raise SystemExit(main())
