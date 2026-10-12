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

    print("\ncents written as words and fractions are read (2026-10-12)")
    for text, want in [
        ("up a quarter cent from Friday", [0.25]),
        ("Soybeans slipped seven cents", [7.0]),
        ("up 4 and a quarter cents", [4.25]),
        ("down seven and a half cents", [7.5]),
        ("up 1\u00bc\u00a2 on the day", [1.25]),
        ("up 4\u00a2 today", [4.0]),
        ("up 4\u00bd cents", [4.5]),
        ("up 4 1/4 cents", [4.25]),
        ("off a penny and a half", [1.5]),
        ("half a cent lower", [0.5]),
        ("three-quarters of a cent", [0.75]),
        ("up a nickel", [5.0]),
        ("twenty-one cents higher", [21.0]),
        ("in the same 15-cent range", []),
        ("down 20 to 40 cents for the week", []),
        ("a quarter of the crop is out", []),
        ("Friday's $4.79\u00be settle", []),
    ]:
        got = [v for v, _ in G._cent_claims(text)]
        check(got == want, "%r reads as %r" % (text, want), "got %r" % got)

    def cents_verdict(sentence, key, price, prev, own_board=True):
        cur = {"date": "2026-10-12", "generated_at": "2026-10-12T10:47:45+00:00",
               "headline": "h", "lead": "l", "locked_prices": {key: price},
               "sections": [{"title": "Grains", "body": sentence, "bottom_line": ""}]}
        if own_board:
            cur["locked_changes"] = {key: {"prev": prev, "pct": 100.0 * (price - prev) / prev}}
        with open(os.path.join(tmp, "2026-10-09.json"), "w") as fh:
            json.dump({"date": "2026-10-09", "locked_prices": {key: prev}}, fh)
        with open(os.path.join(tmp, "2026-10-12.json"), "w") as fh:
            json.dump(cur, fh)
        issues = []
        G.check_number_binding(cur, lambda c, m: issues.append(("FAIL", c, m)),
                               lambda c, m: issues.append(("WARN", c, m)), archive_dir=tmp)
        c = [i for i in issues if i[1] == "bind:cents"]
        return "FAIL" if any(i[0] == "FAIL" for i in c) else "WARN" if c else "clean"

    for f in os.listdir(tmp):
        os.remove(os.path.join(tmp, f))
    print("\nthe 2026-10-12 sentences, against their own board")
    v = cents_verdict("Corn is at $4.81 overnight, up a quarter cent from Friday's settle.", "corn", 4.81, 4.7975)
    check(v == "FAIL", "corn \"up a quarter cent\" on a 1.25-cent move blocks", "got " + v)
    v = cents_verdict("Corn is at $4.81 overnight, up 1\u00bc\u00a2 from Friday's settle.", "corn", 4.81, 4.7975)
    check(v == "clean", "\"up 1\u00bc\u00a2\" on the same board is clean", "got " + v)
    v = cents_verdict("Corn is at $4.81 overnight, up a penny from Friday's settle.", "corn", 4.81, 4.7975)
    check(v == "clean", "\"up a penny\" (a quarter off) is honest rounding", "got " + v)
    v = cents_verdict("Soybeans slipped seven cents to $12.83.", "beans", 12.8275, 12.92)
    check(v == "WARN", "beans \"seven cents\" on a 9.25-cent move warns", "got " + v)
    v = cents_verdict("Soybeans slipped 9\u00bc cents to $12.83.", "beans", 12.8275, 12.92)
    check(v == "clean", "beans \"9\u00bc cents\" is clean", "got " + v)
    v = cents_verdict("Soybeans slipped nine cents to $12.83.", "beans", 12.8275, 12.92)
    check(v == "clean", "beans \"nine cents\" is clean", "got " + v)
    v = cents_verdict("Corn is at $5.04 overnight, down seven and a half cents.", "corn", 5.04, 5.0775)
    check(v == "FAIL", "corn \"seven and a half cents\" on a 3.75-cent move blocks (2026-10-07)", "got " + v)
    v = cents_verdict("Corn is at $4.81 overnight, up a quarter cent.", "corn", 4.81, 4.7975, own_board=False)
    check(v == "WARN", "without locked_changes a cents miss only warns", "got " + v)
    v = cents_verdict("Chicago wheat is at $6.25, up nearly 15 cents.", "wheat", 6.25, 6.185)
    check(v != "clean", "the 2026-09-01 \"nearly 15 cents\" on 6.5 cents still fires", "got " + v)
    check(G._cent_tol(25.75) == G._CENT_TOL,
          "a big move keeps the old 1.5-cent band, never wider", "got %r" % G._cent_tol(25.75))

    print("\na stated USDA yield revision must match the report")
    est = os.path.join(tmp, "est.json")
    with open(est, "w") as fh:
        json.dump({"reports": [{"report": "October WASDE", "date": "2026-10-09", "metrics": [
            {"key": "corn_yield_2627", "actual": 181.2, "usda_current": 178.5},
            {"key": "soy_yield_2627", "actual": 53.1, "usda_current": 52.8}]}]}, fh)

    def rev_verdict(desc, date="2026-10-12"):
        d = {"date": date, "headline": "h", "lead": "l", "sections": [],
             "watch_list": [{"time": "Tuesday", "desc": desc}]}
        issues = []
        G.check_usda_revisions(d, lambda c, m: issues.append(("FAIL", c, m)),
                               lambda c, m: issues.append(("WARN", c, m)), est_path=est)
        r = [i for i in issues if i[1] == "usda-revision"]
        return "FAIL" if any(i[0] == "FAIL" for i in r) else "WARN" if r else "clean"

    v = rev_verdict("Harvest pace matters more than usual after Friday's yield cut.")
    check(v == "FAIL", "\"Friday's yield cut\" after a raise blocks", "got " + v)
    v = rev_verdict("Harvest pace matters more than usual after Friday's yield raise.")
    check(v == "clean", "\"Friday's yield raise\" is clean", "got " + v)
    v = rev_verdict("USDA raised the corn yield to 181.2 bu/acre.")
    check(v == "clean", "\"USDA raised the corn yield\" is clean", "got " + v)
    v = rev_verdict("USDA cut the soybean yield on Friday.")
    check(v == "FAIL", "\"USDA cut the soybean yield\" after a soy raise blocks", "got " + v)
    v = rev_verdict("A hard frost now cuts yield faster than a dry week.")
    check(v == "clean", "agronomy (\"frost cuts yield\") is not about the report", "got " + v)
    v = rev_verdict("If USDA cuts the yield in November, the carry narrows.")
    check(v == "clean", "a hypothetical is left alone", "got " + v)
    v = rev_verdict("USDA cut corn yield 2.3 bu from July on the Aug 12 WASDE.")
    check(v == "clean", "history about another month's report is left alone", "got " + v)
    v = rev_verdict("After Friday's yield cut, harvest pace matters.", date="2026-10-30")
    check(v == "clean", "outside the week after the report the check stands down", "got " + v)

    print()
    if FAILED:
        print("FAILED (%d): %s" % (len(FAILED), "; ".join(FAILED)))
        return 1
    print("briefing number binding: all passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
