#!/usr/bin/env python3
"""
market_board.py — ONE definition of "is this the same session's board".

WHY THIS FILE EXISTS
  Three files carried their own copy of this rule, with the same docstring
  explaining the same outage:

      brief_email._same_board        (the subscriber email's price table)
      briefing_gate._same_board      (the number-binding checks)
      send_morning_brief._same_board (the forwarding brief)

  All three say the archive publishes at weekends and on holidays, that those
  issues carry the last close forward unchanged, and that walking back one file
  therefore lands on a non-session where every change comes out zero.

  All three then tested it the same wrong way: a board counts as "the same"
  only if EVERY shared numeric key is identical. locked_prices carries
  `bitcoin`, which trades around the clock and moved in 89% of consecutive
  archived pairs. One round-the-clock instrument is enough to make a board with
  every grain and livestock contract frozen look like a fresh session.

  Measured on the 185 archived issues before this fix:
    - 55 of 142 issues compared their board against a board holding the SAME
      session's closes.
    - 9 issues emailed a price table where every single row read unchanged,
      which is the exact symptom those three docstrings say the walk-back
      exists to prevent.
    - On 2026-07-03 -> 07-04 the only two values that moved in the entire board
      were bitcoin and the dollar. Every grain and livestock contract was shut
      for Independence Day.

  So the comparison is made over the SESSION-TRADED board only. The
  round-the-clock instruments stay in locked_prices and stay in the briefing;
  they just do not get a vote on whether a session happened.

  This is about the printed BOARD. The separate question of which SESSION'S
  CLOSES an issue holds -- what the call grader needs -- is answered from the
  calendar by grade_calls.board_session, because prices cannot answer it.
"""

import glob
import json
import os
from datetime import date, datetime

# Products with a daily settle on the CBOT/CME agricultural calendar. If every
# one of these is identical to the cent, nothing traded between the two issues.
SESSION_KEYS = frozenset({
    "corn", "corn-dec", "beans", "beans-nov", "wheat", "oats",
    "meal", "soyoil", "cattle", "feeders", "hogs", "milk",
})

# Kept out of the comparison on purpose. These move when the ag board is shut,
# so including them answers "did anything anywhere tick" instead of "was there
# a session". crude and natgas are excluded for the same reason: CME energy
# keeps trading on days the grain floor is closed.
ROUND_THE_CLOCK = frozenset({
    "bitcoin", "gold", "silver", "dollar", "sp500", "crude", "natgas",
})

MIN_SHARED = 3


def same_board(a, b):
    """True when two issues carry the same session's closes.

    Compares only SESSION_KEYS. Returns False when fewer than MIN_SHARED of
    them are shared and numeric, which is the cautious answer: an unknown board
    shape is treated as a real session rather than silently skipped."""
    a = a or {}
    b = b or {}
    shared = [k for k in a
              if k in b and k in SESSION_KEYS
              and isinstance(a[k], (int, float)) and isinstance(b[k], (int, float))]
    if len(shared) < MIN_SHARED:
        return False
    return all(abs(a[k] - b[k]) < 1e-9 for k in shared)


def _ref_date(daily):
    """The issue's own date, from whichever field parses."""
    for cand in (daily.get("date"), str(daily.get("generated_at") or "")[:10]):
        try:
            return datetime.fromisoformat(str(cand)[:10]).date().isoformat()
        except (TypeError, ValueError):
            continue
    return date.today().isoformat()


def _session_of(issue, stem):
    """The date that board's closes belong to. Falls back to the file's own
    date when the session cannot be computed, so a label is never blank."""
    try:
        import grade_calls
        s = grade_calls.board_session(issue)
        return s.isoformat() if s else stem
    except Exception:
        return stem


def _too_far(prior_issue, daily, stem):
    """True when more than one session separates the two boards.

    A briefing that is regenerated after the close overwrites the issue that
    held the previous session's board, and the archive then has no board for
    that session at all. Walking back to the next different board crosses TWO
    sessions, and the prose of a weekend issue is about ONE. Measured: 15 of
    142 archived issues land here, all weekend or holiday editions. Their table
    used to read all-zeros, which was worse: wheat showed "unchanged" in the
    same email whose lead said it fell 3.4%.
    """
    try:
        import grade_calls
        from contract_calendar import sessions_between
        here = grade_calls.board_session(daily)
        there = grade_calls.board_session(prior_issue)
        if here is None or there is None:
            return False
        return sessions_between(there, here) > 1
    except Exception:
        return False


def prior_board(daily, archive_dir="data/daily-archive"):
    """The most recent archived board from a DIFFERENT session than this one.

    Returns (locked_prices, session_date, error).

    session_date is THE DAY THOSE CLOSES BELONG TO, not the filename of the
    issue that carried them. The email prints it as "close, against <date>",
    and 25 of 142 archived issues named a Sunday or a holiday -- a date on
    which nothing closed. The board Sunday's issue carries is Friday's close,
    so Friday is what the reader is told.

    error is None on success and a short string when the archive could not be
    read -- never swallowed, because the first version of the gate's copy hid a
    NameError behind "no earlier archived issue found", which reads like a data
    condition and was a bug.
    """
    cur = (daily or {}).get("locked_prices") or {}
    ref = _ref_date(daily or {})
    try:
        files = sorted(glob.glob(os.path.join(archive_dir, "20*.json")))
        for f in reversed(files):
            stem = os.path.basename(f)[:10]
            if stem >= ref:
                continue
            with open(f, encoding="utf-8") as fh:
                issue = json.load(fh) or {}
            lp = issue.get("locked_prices") or {}
            if lp and not same_board(lp, cur):
                if _too_far(issue, daily or {}, stem):
                    # The nearest genuinely different board is more than one
                    # session back, so no honest one-session change can be
                    # shown. Withhold the column rather than print a two-day
                    # move next to prose that describes one day.
                    return {}, None, None
                return lp, _session_of(issue, stem), None
    except Exception as e:
        return {}, None, f"{type(e).__name__}: {str(e)[:60]}"
    return {}, None, None


def _selftest():
    ok = True

    def chk(cond, msg):
        nonlocal ok
        print(("  OK   " if cond else "  FAIL ") + msg)
        if not cond:
            ok = False

    print("market_board selftest")
    frozen = {"corn": 5.12, "beans": 12.94, "wheat": 7.16, "cattle": 213.15, "hogs": 81.62}
    # THE BUG: one round-the-clock instrument moved, the whole ag board did not.
    chk(same_board(dict(frozen, bitcoin=60000), dict(frozen, bitcoin=61234)),
        "a moving bitcoin does NOT make a frozen ag board a new session")
    chk(same_board(dict(frozen, gold=2400, dollar=99.1), dict(frozen, gold=2455, dollar=98.2)),
        "nor do gold and the dollar")
    chk(same_board(dict(frozen, crude=99.99), dict(frozen, crude=97.10)),
        "nor does crude, which trades when the grain floor is shut")
    chk(not same_board(frozen, dict(frozen, corn=5.13)),
        "a single grain tick IS a new session")
    chk(not same_board(frozen, dict(frozen, hogs=81.70)),
        "so is a livestock tick")
    chk(same_board(frozen, {k: v for k, v in frozen.items() if k != "hogs"}),
        "a key missing from one board is not evidence of a session either way")
    # the 2026-07-03 -> 07-04 board, the real one
    jul3 = {"corn": 4.25, "beans": 10.41, "wheat": 5.44, "cattle": 219.1,
            "bitcoin": 108000, "dollar": 96.8}
    jul4 = dict(jul3, bitcoin=109500, dollar=96.9)
    chk(same_board(jul3, jul4),
        "the real Jul 3 -> Jul 4 boards read as one session (only bitcoin and the dollar moved)")
    chk(not same_board({"corn": 5.0}, {"corn": 5.0}),
        "too few shared session keys -> cautious False, never a silent skip")
    chk(not same_board({}, {}), "empty boards are not 'the same session'")
    chk(same_board(frozen, dict(frozen)), "a board equals itself")

    # ── the walk-back, on a synthetic archive ────────────────────────────
    import json as _json, tempfile, os as _os
    print("prior_board — the walk-back")

    def issue(d, hour_ct, board):
        return {"date": d, "generated_at": f"{d}T{hour_ct + 5:02d}:30:00+00:00",
                "locked_prices": dict(board)}

    THU = {"corn": 5.00, "beans": 12.80, "wheat": 7.00, "cattle": 200.0, "hogs": 80.0}
    FRI = {"corn": 5.12, "beans": 12.94, "wheat": 7.16, "cattle": 213.0, "hogs": 81.6}
    MON = {"corn": 5.20, "beans": 12.99, "wheat": 7.20, "cattle": 214.0, "hogs": 81.9}

    with tempfile.TemporaryDirectory() as tmp:
        # Fri morning holds Thursday's close; Sat and Sun hold Friday's, with a
        # bitcoin that never stops moving.
        issues = {
            "2026-09-10": issue("2026-09-10", 6, dict(THU, bitcoin=60000)),   # Thu am -> Wed
            "2026-09-11": issue("2026-09-11", 6, dict(THU, bitcoin=60500)),   # Fri am -> THU close
            "2026-09-12": issue("2026-09-12", 8, dict(FRI, bitcoin=61000)),   # Sat    -> FRI close
            "2026-09-13": issue("2026-09-13", 8, dict(FRI, bitcoin=62000)),   # Sun    -> FRI close
            "2026-09-14": issue("2026-09-14", 6, dict(MON, bitcoin=63000)),   # Mon am -> overnight
        }
        for d, b in issues.items():
            with open(_os.path.join(tmp, f"{d}.json"), "w") as fh:
                _json.dump(b, fh)

        lp, day, err = prior_board(issues["2026-09-13"], tmp)
        chk(err is None and lp.get("corn") == THU["corn"],
            "Sunday walks PAST Saturday's frozen board to Friday's issue (Thursday's close)")
        chk(day == "2026-09-10",
            f"...and is labelled with the SESSION those closes belong to (Thu 09-10), "
            f"not the filename that carried them (Fri 09-11); got {day}")

        lp, day, err = prior_board(issues["2026-09-12"], tmp)
        chk(lp.get("corn") == THU["corn"] and day == "2026-09-10",
            f"Saturday compares Friday's close against Thursday's (got {day})")

        lp, day, err = prior_board(issues["2026-09-14"], tmp)
        chk(lp.get("corn") == FRI["corn"],
            "Monday's overnight board compares against Friday's close")

        # the post-close re-run: Friday's issue is regenerated after the settle,
        # so no archived board holds Thursday's close any more.
        issues["2026-09-11"] = issue("2026-09-11", 15, dict(FRI, bitcoin=60500))
        with open(_os.path.join(tmp, "2026-09-11.json"), "w") as fh:
            _json.dump(issues["2026-09-11"], fh)
        lp, day, err = prior_board(issues["2026-09-13"], tmp)
        chk(lp == {} and day is None,
            "with Thursday's board overwritten, Sunday shows NO change column "
            "rather than a two-session move beside one-session prose")

    print("SELFTEST OK" if ok else "SELFTEST FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(_selftest())
