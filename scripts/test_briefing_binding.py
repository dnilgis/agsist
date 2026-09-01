#!/usr/bin/env python3
"""
THE BRIEFING GATE'S NUMBER BINDING — does the prose agree with the board?

WHY THIS EXISTS. scripts/briefing_gate.py is 673 lines and it decides every
morning whether the flagship product is allowed to go out. On 2026-09-01 it had
no test of any kind.

WHAT IT GUARDS. On that morning's issue, against its own locked board:

    "Live cattle settled at $212.65, up modestly"      board  -3.01%
    "WTI crude rose ... up 1.5%"                       board  +2.27%
    "Natural gas slipped ... down 1.8%"                board  +0.14%
    "Chicago wheat ... up nearly 15 cents"             board  +6.5 cents
    "corn ... essentially flat"                        board  +0.69%

    RESULT: PASS - clear to send.

It sent. A market letter whose prose contradicts the price table eight lines
below it is worse than no letter: a reader who checks one number and finds it
wrong stops trusting all of them.

THE RULE THIS PINS. A direction word against a move of two percent or more now
BLOCKS. The threshold is measured, not chosen -- swept over 173 archived issues:

    |move| >= 0.0%   76 hits   48 issues   27.7%
    |move| >= 1.0%   36 hits   28 issues   16.2%
    |move| >= 2.0%   20 hits   17 issues    9.8%   <- blocking
    |move| >= 3.0%   12 hits   10 issues    5.8%

and every one of the twenty at two percent is indefensible. Below one percent
is where the honest ambiguity lives -- a rounded figure, an overnight window,
nearby versus new crop -- and that stays a warning, exactly as before.

    python3 scripts/test_briefing_binding.py

No network, no archive, under a second.
"""
import copy
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import briefing_gate as G

FAILED = []


def check(ok, name, detail=""):
    print(("  ok    " if ok else "  FAIL  ") + name + ("" if ok else "  -- " + detail))
    if not ok:
        FAILED.append(name)


def issue(sentence, board_pct, price=212.65):
    """A minimal issue: one section, one sentence, and a board that either
    agrees with it or does not. `board_pct` is what the board moved."""
    prior = round(price / (1 + board_pct / 100.0), 4)
    return {
        "date": "2026-09-01",
        "generated_at": "2026-09-01T13:23:00+00:00",
        "headline": "A day on the board",
        "lead": "The lead.",
        "locked_prices": {"cattle": price},
        "sections": [{"title": "Livestock", "body": sentence,
                      "bottom_line": "", "conviction_level": "medium"}],
    }, {"date": "2026-08-31", "locked_prices": {"cattle": prior}}


def verdict(sentence, board_pct, tmp):
    cur, prev = issue(sentence, board_pct)
    with open(os.path.join(tmp, "2026-08-31.json"), "w") as fh:
        json.dump(prev, fh)
    with open(os.path.join(tmp, "2026-09-01.json"), "w") as fh:
        json.dump(cur, fh)
    issues = []
    F = lambda c, m: issues.append(("FAIL", c, m))
    W = lambda c, m: issues.append(("WARN", c, m))
    G.check_number_binding(cur, F, W, archive_dir=tmp)
    dirs = [i for i in issues if i[1] == "bind:dir"]
    return ("FAIL" if any(s == "FAIL" for s, _, _ in dirs)
            else "WARN" if dirs else "clean"), dirs


def main():
    import tempfile
    tmp = tempfile.mkdtemp()

    print("a direction word against a big move BLOCKS")
    UP = "- Live cattle settled at **$212.65**, up modestly on the session."
    v, d = verdict(UP, -3.01, tmp)
    check(v == "FAIL", "cattle \"up\" against a -3.01% board blocks the send",
          "got %s (%s)" % (v, d))
    v, _ = verdict(UP, -14.16, tmp)
    check(v == "FAIL", "and so does a -14.16% board")
    DN = "- Live cattle settled at **$212.65**, giving back ground on the session."
    v, _ = verdict(DN, +2.20, tmp)
    check(v == "FAIL", "\"giving back\" against a +2.20% board blocks too")

    print("\nthe honest ambiguity below the line stays a warning")
    v, _ = verdict(UP, -0.42, tmp)
    check(v == "WARN", "cattle \"up\" against -0.42% warns and still sends",
          "got " + v)
    v, _ = verdict(UP, -1.90, tmp)
    check(v == "WARN", "and -1.90%, just under the line, still only warns", "got " + v)

    print("\nprose that agrees with the board is left alone")
    v, _ = verdict(UP, +3.01, tmp)
    check(v == "clean", "cattle \"up\" against a +3.01% board says nothing", "got " + v)
    v, _ = verdict(DN, -3.01, tmp)
    check(v == "clean", "and \"giving back\" against -3.01% says nothing", "got " + v)

    print("\nthe threshold is where the sweep put it")
    src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            "briefing_gate.py")).read()
    check("DIR_BLOCK_PCT = 2.0" in src,
          "the blocking line is 2.0%, the figure the 173-issue sweep supports",
          "someone moved it without re-running the sweep")

    print()
    if FAILED:
        print("FAILED (%d): %s" % (len(FAILED), "; ".join(FAILED)))
        return 1
    print("briefing number binding: all passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
