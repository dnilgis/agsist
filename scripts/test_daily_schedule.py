#!/usr/bin/env python3
"""
THE BRIEFING THAT DID NOT GO OUT.

2026-08-28: no data/daily-archive/2026-08-28.json, no email, two hours after
the 11:02 UTC fire. Both preflight gates pass against the prices file that run
would have read. Every other scheduled workflow ran that morning. The fire was
simply not delivered — GitHub drops them, measured at roughly one in six on the
sibling repository — and a job that fires ONCE A DAY has no second chance.

So daily.yml now has backup fires, and this guards the two things that makes
safe:

  1. The backup fires exist and land inside the gate's own morning window.
  2. The gate asks the REMOTE whether today is published, not its checkout.
     A scheduled run checks out the SHA it was triggered at, so a backup fire
     queued behind a run still in flight sees a tree from before that run
     pushed. The old gate would have regenerated and republished on top of a
     briefing that was already live.

The email cannot double-send either way — send_daily.py sets a day flag through
the subs worker and fails closed — but a republished briefing is its own kind of
wrong, and one guard is not redundancy.

Run: python scripts/test_daily_schedule.py
"""
import re
import sys
from pathlib import Path

WF = Path(__file__).resolve().parent.parent / ".github/workflows/daily.yml"
FAILED = []


def check(ok, label, detail=""):
    print(("  ok    " if ok else "  FAIL  ") + label + (("  — " + detail) if detail and not ok else ""))
    if not ok:
        FAILED.append(label)


def main():
    y = WF.read_text()
    crons = re.findall(r"- cron:\s*'([^']+)'", y)
    print("daily.yml fires at: " + ", ".join(crons))

    morning = []
    for c in crons:
        m, h, _, _, dow = (c.split() + ["*"] * 5)[:5]
        if dow in ("*", "*/1") and h.isdigit() and int(h) < 14:
            morning.append(int(h) * 60 + int(m.split(",")[0]))
    morning.sort()

    check(len(morning) >= 3,
          "there is more than one morning fire",
          "only %d — a dropped fire is a missed briefing" % len(morning))

    # Every backup must still be inside the gate's `H < 14` window, or it would
    # regenerate on top of a published day instead of skipping.
    check(all(t < 14 * 60 for t in morning),
          "every morning fire is inside the gate's own skip window")

    # And they must be spread, not stacked: three fires in the same minute are
    # one fire as far as a dropped schedule is concerned.
    gaps = [b - a for a, b in zip(morning, morning[1:])]
    check(gaps and min(gaps) >= 20,
          "the backups are spread by at least twenty minutes",
          "closest pair is %d minutes apart" % (min(gaps) if gaps else 0))

    check(morning[-1] - morning[0] >= 60,
          "the backups cover at least an hour of dropped fires",
          "they span only %d minutes" % (morning[-1] - morning[0]))

    # THE GATE MUST ASK THE REMOTE.
    gate = y[y.index("  gate:"):y.index("  generate:")]
    check("git fetch" in gate and "FETCH_HEAD:data/daily-archive/" in gate,
          "the gate asks the remote whether today is already published",
          "it only looks at its own checkout, which a queued backup fire predates")

    check("$H" in gate and "-lt 14" in gate,
          "the Friday post-close regeneration is still exempt from the gate")

    # The whole job — email included — is what gets skipped.
    check(re.search(r"generate:\s*\n\s*needs: gate", y) is not None
          and "needs.gate.outputs.skip != '1'" in y,
          "a skipped day skips the EMAIL too, not just the generation")

    # The email must still never fire from an untick'd manual run.
    check("github.event_name == 'schedule' || inputs.send_email == true" in y,
          "a manual run is still a dry run unless send_email is ticked")

    print()
    if FAILED:
        print("FAILED: " + "; ".join(FAILED))
        return 1
    print("daily schedule selftest: all passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
