#!/usr/bin/env python3
"""
cause_fix.py -- a Daily cause sentence nobody is named as saying is reworded
(or cut) before the gate, so the issue that is sent, archived and tested is
the same text.

WHY. Oct 29 the Daily went out with "Crude is still pricing in Iran supply
risk, and diesel follows it." briefing_gate only WARNs on the cause rule
(scripts/daily_claims.py r_cause_without_source; Sig: prose heuristics never
hard-block), and the generator's cut leaves a field that would be left empty,
but test/daily-claims.test.mjs requires every archived issue to pass the rule.
So a published issue turned every pull request red until it was reworded by
hand (PR #187).

WHAT. Runs in daily.yml right after GATE 2h (headline_fix.py) and before
GATE 2, on data/daily.json. daily_claims.fix_causes does the work, the same
code the generator and the critic call through daily_claims.strip:
  1. reword by code: the fact kept, the causal wording dropped ("X follows Y"
     -> "X has moved with Y"; ", driven by Y" and "because Y" cut as a clause),
     used only when the result still reads as a sentence;
  2. else cut the sentence, when its field can lose one and keeps other text;
  3. else leave it; the gate WARNs. This step never blocks the send.
Every change is printed and kept in daily.json as "cause_fix". When anything
changed, the archive JSON and page are written again from the fixed issue
(critique_briefing.re_archive, as headline_fix does), so the archive, the
page, the feed and the sent copy (send_daily.py keeps data/daily-sent/<day>.json
from daily.json at the send) all carry the text that was sent.

    python3 scripts/cause_fix.py data/daily.json
    python3 scripts/cause_fix.py --selftest
"""
import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import daily_claims  # noqa: E402  one definition of the rule and its fix


def apply(briefing, repo=REPO, today=None):
    """(briefing, [log lines]). Fails soft: any error leaves the issue as it was."""
    try:
        ctx = daily_claims.from_files(briefing, repo, today)
    except Exception:
        ctx = None
    return daily_claims.fix_causes(briefing, ctx)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("daily", nargs="?", default=os.path.join(REPO, "data", "daily.json"))
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args(argv)
    if a.selftest:
        return selftest()
    try:
        with open(a.daily) as f:
            b = json.load(f)
        b, log = apply(b)
    except Exception as e:                        # never block the send on this step
        print("::warning title=Daily cause check::not run (%s: %s)" % (type(e).__name__, e))
        return 0
    if not log:
        print("[cause-fix] no unsourced cause sentence; nothing to do")
        return 0
    for line in log:
        print("[cause-fix] " + line)
        if " WARN " in line:
            print("::warning title=Daily cause line left::" + line[:300])
    changed = [x for x in log if " WARN " not in x]
    if not changed:
        return 0
    b["cause_fix"] = log
    tmp = a.daily + ".tmp"
    with open(tmp, "w") as f:
        json.dump(b, f, indent=2, ensure_ascii=False)
    os.replace(tmp, a.daily)
    print("::notice title=Daily cause lines fixed::%d change(s)" % len(changed))
    if os.path.abspath(a.daily) == os.path.join(REPO, "data", "daily.json"):
        try:
            import critique_briefing
            critique_briefing.re_archive(b)
        except Exception as e:
            print("[cause-fix] [warn] archive not re-rendered (%s)" % type(e).__name__)
    return 0


def selftest():
    fails = []
    # the Oct 29 issue as it went out (data/daily-archive/2026-10-29.json at ab0a98247f5)
    body = ("- WTI is at **$101.21** overnight, down 1.5%. Oilprice reports Vice President Vance contacted Iran's "
            "security council to restart peace talks. Supply fears from the Iran conflict have kept crude above $100 "
            "for months.\n- Natural gas is at $3.04, up 8.0%, as Oilprice reports record U.S. production.")
    b = {"date": "Thursday, October 29, 2026", "headline": "Corn steady",
         "sections": [{}, {}, {"title": "Crude eases on Iran talk", "body": body,
                               "so_what": "Crude is still pricing in Iran supply risk, and diesel follows it."}]}
    b, log = daily_claims.fix_causes(b)
    s = b["sections"][2]
    if s["so_what"] != "Crude is still pricing in Iran supply risk, and diesel has moved with it.":
        fails.append("Oct 29 so_what: %r" % s["so_what"])
    if s["body"] != body or s["title"] != "Crude eases on Iran talk" or len(log) != 1:
        fails.append("Oct 29: more than the flagged sentence changed: %r" % log)
    # a cut keeps the bullet's other sentence; a lone sentence nothing can fix is left (WARN)
    b = {"lead": "Corn is flat. The grains went out soft not because a catalyst showed up, but because the calendar did."}
    b, log = daily_claims.fix_causes(b)
    if b["lead"] != "Corn is flat." or "cut" not in log[0]:
        fails.append("cut: %r %r" % (b["lead"], log))
    b = {"lead": "The grains went out soft not because a catalyst showed up, but because the calendar did."}
    b, log = daily_claims.fix_causes(b)
    if "WARN" not in log[0] or not b["lead"].startswith("The grains went out soft"):
        fails.append("warn: %r" % log)
    # a headline is reworded, never cut, and its subject line copy follows
    b = {"headline": "BRENT HITS $100; GRAINS AND CATTLE FOLLOW", "subject_line": "BRENT HITS $100; GRAINS AND CATTLE FOLLOW"}
    b, log = daily_claims.fix_causes(b)
    if b["headline"] != "BRENT HITS $100; GRAINS AND CATTLE MOVE TOO" or b["subject_line"] != b["headline"]:
        fails.append("headline: %r" % b)
    # a sourced cause is left alone
    b = {"lead": "Corn fell 4 cents driven by harvest pressure, Reuters reported."}
    if daily_claims.fix_causes(b)[1]:
        fails.append("sourced line touched")
    for f in fails:
        print("FAIL", f)
    print("cause_fix selftest: %s" % ("ok" if not fails else "%d failed" % len(fails)))
    return 0 if not fails else 1


if __name__ == "__main__":
    sys.exit(main())
