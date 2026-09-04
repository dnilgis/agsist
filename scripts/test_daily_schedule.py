#!/usr/bin/env python3
"""
THE BRIEFING THAT DID NOT GO OUT — THIRD PASS.

2026-08-28: no archive, no email, two hours after the 11:02 UTC fire. Both
preflight gates passed against the prices file that run would have read; every
other scheduled workflow ran that morning. The fire was simply not delivered.
GitHub drops them, and a job that fires ONCE A DAY has no second chance.

2026-08-29: the fix was a NET — twelve fires every fifteen minutes across a
two-and-a-half hour window, and a gate that decided in Central time which one
publishes. This file grew checks for it: at least three fires between 05:45 and
06:30 Central in both seasons, spread by at least ten minutes.

Every one of those checks passed. The net still failed.

    Sun 08-30   ONE run, committed 14:56Z — 86 minutes after 13:30, the LAST
                fire of the net. The eleven earlier fires produced nothing.
    Mon 08-31   NOTHING by 13:02Z (08:02 Central), ten of twelve fires due.

THE CHECKS WERE ASSERTING THE SHAPE OF THE THING THAT DOES NOT WORK. Twelve
fires an hour apart is a different animal from twelve fires fifteen minutes
apart, and this file could not tell them apart because "spread by at least ten
minutes" was written when there were three fires an hour apart and was never
revisited when there were twelve. It measured the intent of an older design.

The repository already knew. From the top of .github/workflows/prices.yml:

    "GitHub's scheduled-cron is best-effort and silently DROPS high-frequency
     (every-30-min) runs ... Low-frequency, off-:00 minutes (GitHub honors
     these far more reliably than */30)."

And from the standing decisions, measured on the sibling repo 2026-08-26: a
ten-minute cron delivered one to three runs an hour against six asked, while an
hourly cron outside the window delivered every one. **Do not "fix" the schedule
by asking more often.** The net asked more often, with ten of its twelve fires
sitting on :00, :15, :30 and :45.

SO THIS FILE NOW GUARDS THE OPPOSITE PROPERTY, and it stops grepping.

The old checks were all string matches against the YAML: `-lt 0545` is present,
`$DOW != 5` is present. None of them executed anything, which is why "the gate
decides once and exits" — the actual defect — was invisible. A fire arriving at
05:19 Central looked at the clock, said "a later fire takes this one", and
stopped. That was true only while later fires existed.

The gate script is now EXTRACTED FROM THE WORKFLOW AND RUN, against stub
`date`, `git` and `sleep` commands, at the exact times that failed. It is the
only kind of check that could have caught this.

Run: python scripts/test_daily_schedule.py
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

WF = Path(__file__).resolve().parent.parent / ".github/workflows/daily.yml"
FAILED = []
PRICES = ""

# The busy minutes. GitHub's own documentation names the start of the hour as
# the worst time to schedule; :15, :30 and :45 are the same problem one notch
# down, and the net put ten of its twelve fires on them.
BUSY_MINUTES = {0, 15, 30, 45}


def check(ok, label, detail=""):
    print(("  ok    " if ok else "  FAIL  ") + label + (("  — " + detail) if detail and not ok else ""))
    if not ok:
        FAILED.append(label)


# ── running the real gate ────────────────────────────────────────────────────

def gate_script(y):
    """The gate's own `run:` block, dedented, exactly as the runner sees it."""
    a = y.index("      - id: g\n        run: |\n")
    a = y.index("\n", y.index("run: |", a)) + 1
    b = y.index("\n  generate:", a)
    lines = []
    for ln in y[a:b].split("\n"):
        lines.append(ln[10:] if ln.startswith(" " * 10) else ln)
    return "\n".join(lines)


def simulate(script, *, event="schedule", start="05:19", dow=1, published=False,
             heartbeat=False, day="2026-08-31", max_wait_min=600):
    """Run the gate with a fake clock. Returns (skip, minutes_waited, log).

    `sleep` advances the clock instead of sleeping, so a loop that waits for
    the floor completes in milliseconds and the wait is measurable.
    """
    tmp = Path(tempfile.mkdtemp())
    try:
        clock = tmp / "clock"          # minutes since midnight, Central
        h, m = start.split(":")
        clock.write_text(str(int(h) * 60 + int(m)))

        (tmp / "date").write_text(
            "#!/bin/bash\n"
            f'T=$(cat "{clock}")\n'
            'H=$(( (T/60) % 24 )); M=$(( T % 60 ))\n'
            'case "${1:-}" in\n'
            '  +%F)    printf "%s" "' + day + '" ;;\n'
            '  +%H%M)  printf "%02d%02d" "$H" "$M" ;;\n'
            '  +%H)    printf "%02d" "$H" ;;\n'
            '  +%u)    printf "%d" "' + str(dow) + '" ;;\n'
            '  +%H:%M) printf "%02d:%02d" "$H" "$M" ;;\n'
            '  +%s)    printf "%d" $(( T * 60 )) ;;\n'
            '  *)      printf "%02d:%02d" "$H" "$M" ;;\n'
            'esac\n')
        (tmp / "sleep").write_text(
            "#!/bin/bash\n"
            f'T=$(cat "{clock}"); echo $(( T + ${{1:-0}} / 60 )) > "{clock}"\n'
            f'[ $(cat "{clock}") -lt {max_wait_min} ] || exit 1\n')
        (tmp / "git").write_text(
            "#!/bin/bash\n"
            'if [ "${1:-}" = "cat-file" ]; then exit ' + ("0" if published else "1") + '; fi\n'
            'exit 0\n')
        for f in ("date", "sleep", "git"):
            (tmp / f).chmod(0o755)

        # ── RUN IT SOMEWHERE EMPTY. THIS LINE IS THE WHOLE 2026-09-01 BUG.
        #
        # `published()` asks the remote and then falls back to the checkout:
        #
        #     git cat-file -e "FETCH_HEAD:data/daily-archive/$1.json" && return 0
        #     [ -f "data/daily-archive/$1.json" ] && return 0
        #
        # The `git` stub above owns the first line. NOTHING owned the second,
        # because this ran with the repository as its working directory — so
        # `data/daily-archive/2026-08-31.json` was really there, on disk, and
        # `published=False` quietly meant published.
        #
        # It passed on 2026-08-31 for the only reason it could: that day's
        # archive did not exist yet. PUBLISHING IT IS WHAT BROKE THE TEST, and
        # from the next morning the four "should generate" cases all came back
        # skip=1. Wired as GATE 0b under `bash -e`, that failure took the
        # briefing with it. Sig got no briefing on 09-01 and three manual runs
        # died at 26 seconds.
        #
        # A test whose fixture is the live repository is not a fixture.
        work = tmp / "work"
        work.mkdir()

        out = tmp / "out"
        out.write_text("")
        env = dict(os.environ,
                   PATH=f"{tmp}:{os.environ['PATH']}",
                   GITHUB_OUTPUT=str(out))
        body = script.replace("${{ github.event_name }}", event) \
                     .replace("${{ github.event.repository.default_branch || 'main' }}", "main") \
                     .replace("${{ github.event.inputs.heartbeat || 'false' }}",
                              "true" if heartbeat else "false")
        # EVERY EXPRESSION MUST BE SUBSTITUTED, NOT MOST OF THEM. A leftover
        # `${{ … }}` is a bash "bad substitution" that makes the gate exit
        # before it decides anything, and the failure it produces looks exactly
        # like a logic failure. Caught adding the heartbeat input.
        assert "${{" not in body, \
            "unsubstituted workflow expression: " + body[body.index("${{"):][:80]
        sh = tmp / "gate.sh"
        sh.write_text(body)
        r = subprocess.run(["bash", str(sh)], env=env, cwd=str(work),
                           capture_output=True, text=True, timeout=30)
        skip = None
        for ln in out.read_text().split("\n"):
            if ln.startswith("skip="):
                skip = ln.split("=", 1)[1].strip()
        waited = int(clock.read_text()) - (int(h) * 60 + int(m))
        return skip, waited, (r.stdout + r.stderr)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    y = WF.read_text()
    global PRICES
    PRICES = (WF.parent / "prices.yml").read_text()
    crons = re.findall(r"- cron:\s*'([^']+)'", y)
    print("daily.yml fires at: " + ", ".join(crons))

    morning = []
    for c in crons:
        m, h, _, _, dow = (c.split() + ["*"] * 5)[:5]
        if dow not in ("*", "*/1"):
            continue
        for hh in h.split(","):
            if not hh.isdigit() or int(hh) >= 14:
                continue
            for mm in m.split(","):
                if mm.isdigit():
                    morning.append(int(hh) * 60 + int(mm))
    morning = sorted(set(morning))
    print("  %d morning fires (UTC): %s\n" % (
        len(morning), ", ".join("%02d:%02d" % divmod(t, 60) for t in morning)))

    print("the schedule asks rarely, and off the busy minutes")
    check(len(morning) >= 2,
          "there is more than one morning fire",
          "only %d — a dropped fire is a missed briefing" % len(morning))

    # THE ANTI-NET GUARD. This is the check whose absence let the net be built.
    check(len(morning) <= 4,
          "there are at most FOUR morning fires",
          "%d fires is a net, and a net is the pattern this repo has already "
          "measured and rejected — the job waits, it does not ask again" % len(morning))

    gaps = [b - a for a, b in zip(morning, morning[1:])]
    check(not gaps or min(gaps) >= 45,
          "consecutive fires are at least 45 minutes apart",
          "closest pair is %d minutes apart — that is a net, not redundancy"
          % (min(gaps) if gaps else 0))

    busy = ["%02d:%02d" % divmod(t, 60) for t in morning if t % 60 in BUSY_MINUTES]
    check(not busy,
          "no fire sits on :00, :15, :30 or :45",
          "%s — the busiest minutes, which GitHub honours least" % ", ".join(busy))

    print("\nthe window is held open by the JOB, not by more fires")
    for label, offset in (("CDT (summer)", 5), ("CST (winter)", 6)):
        local = sorted((t - offset * 60) % 1440 for t in morning)
        early = [t for t in local if t < 5 * 60 + 45]
        check(bool(early),
              "at least one fire lands before the 05:45 floor in %s" % label,
              "earliest is %s — nothing is left to wait through the floor"
              % ("%02d:%02d" % divmod(local[0], 60) if local else "none"))
        check(any(t <= 8 * 60 + 30 for t in local),
              "and a later launch still lands in the morning in %s" % label)

    check(all(t < 14 * 60 for t in morning),
          "every morning fire is inside the gate's own skip window")

    print("\nthe job runs on the reader's clock")
    check(re.search(r"^env:\s*\n\s*TZ:\s*America/Chicago\s*$", y, re.M) is not None,
          "the workflow runs on America/Chicago",
          "without TZ the gate's `date` is UTC and the Central window is a fiction")

    gate = gate_script(y)
    check("sleep" in gate and "continue" in gate,
          "the gate WAITS for the window instead of handing it to a later fire",
          "this is the 2026-08-30 defect: decide once, exit, and hope")
    check(gate.count("git fetch") >= 1 and "FETCH_HEAD:data/daily-archive/" in gate,
          "the gate asks the remote whether today is already published")
    check("published()" in gate and gate.index("while") < gate.index("published \"$DAY\""),
          "and it re-asks INSIDE the loop, not once before it",
          "a run that waits an hour on a stale answer republishes over a live briefing")

    print("\nthe gate itself, run at the times that failed")

    skip, waited, _ = simulate(gate, start="05:19")
    check(skip == "0" and waited >= 20,
          "a 05:19 fire waits for the floor and then generates",
          "skip=%s after %d minutes — 2026-08-30 exactly" % (skip, waited))

    skip, waited, _ = simulate(gate, start="05:45")
    check(skip == "0" and waited == 0,
          "a fire landing exactly on the floor generates at once",
          "skip=%s waited=%d" % (skip, waited))

    skip, _, _ = simulate(gate, start="06:41")
    check(skip == "0", "a 06:41 recovery fire generates when nothing is published")

    skip, _, _ = simulate(gate, start="06:41", published=True)
    check(skip == "1", "…and skips when the morning already published")

    skip, _, _ = simulate(gate, start="04:19", published=True)
    check(skip == "1",
          "an early fire notices an already-published day WITHOUT waiting first")

    skip, _, _ = simulate(gate, start="21:41", dow=5)
    check(skip == "1",
          "the 9:41 PM Friday fire that started all this is refused",
          "a delayed morning fire is not a post-close regeneration")

    skip, _, _ = simulate(gate, start="15:55", dow=4)
    check(skip == "1", "a Thursday afternoon fire is refused")

    skip, _, _ = simulate(gate, start="15:00", dow=5, published=True)
    check(skip == "0",
          "the Friday post-close regeneration still runs, on top of a published day")

    skip, waited, _ = simulate(gate, event="workflow_dispatch", start="04:00")
    check(skip == "0" and waited == 0,
          "a manual run never waits and never skips",
          "skip=%s waited=%d — somebody is standing at the keyboard" % (skip, waited))

    skip, _, _ = simulate(gate, event="workflow_dispatch", start="09:00", published=True)
    check(skip == "0", "…even when today is already published")

    print("\nthe heartbeat — the path that does not depend on cron")
    # A BOT PUSH TRIGGERS NOTHING. `on: push` was here from 2026-08-31 to
    # 2026-09-01 and could never once have fired: prices.yml pushes with
    # secrets.GITHUB_TOKEN, and GitHub does not create workflow runs from
    # events that token raised. The two events it always creates runs for,
    # whatever sent them, are workflow_dispatch and repository_dispatch.
    check("push:" not in y,
          "the dead `on: push` trigger is gone",
          "a bot push cannot trigger a workflow — see the tombstone in daily.yml")
    check("heartbeat" in y and "github.event.inputs.heartbeat" in gate,
          "the gate can tell the price loop's dispatch from a person",
          "without this a heartbeat reads as a human and republishes every 30 min")

    skip, waited, _ = simulate(gate, event="workflow_dispatch", heartbeat=True, start="05:47")
    check(skip == "0" and waited == 0,
          "a heartbeat past the floor generates the briefing with no cron involved",
          "skip=%s waited=%d" % (skip, waited))

    skip, waited, _ = simulate(gate, event="workflow_dispatch", heartbeat=True, start="04:30")
    check(skip == "1" and waited == 0,
          "a heartbeat BEFORE the floor exits at once and does NOT hold a runner",
          "skip=%s after %d minutes — a waiting heartbeat costs more than the briefing"
          % (skip, waited))

    skip, _, _ = simulate(gate, event="workflow_dispatch", heartbeat=True,
                          start="06:00", published=True)
    check(skip == "1",
          "the heartbeat after the briefing published skips",
          "otherwise every price commit would republish the day")

    # ── THE FRIDAY AFTERNOON HOLE, MEASURED THE HARD WAY ──────────────────
    #
    # The afternoon-heartbeat case below was tested on a TUESDAY and passed for
    # a year. The Friday post-close branch sits above the afternoon skip and
    # asked only what time it was — Friday, after two, before six, regenerate
    # and email — never what had woken the run.
    #
    # prices.yml sends a heartbeat after every successful price push, about
    # every thirty minutes through the trading day. So on Friday 2026-09-04
    # issue #177 went to the live list SEVEN TIMES between 2:23 and 5:04 PM
    # Central, each with a different headline as the market moved under it.
    #
    # Sig found it in his own inbox. No test did.
    for hhmm in ("14:23", "14:54", "15:24", "15:54", "16:25", "16:55", "17:04"):
        skip, _, out = simulate(gate, event="workflow_dispatch", heartbeat=True,
                                start=hhmm, dow=5, published=True)
        check(skip == "1",
              "a Friday %s heartbeat does NOT regenerate and re-email" % hhmm,
              "this is one of the seven that went out on 2026-09-04")
        # AND IT SAYS WHICH RULE STOPPED IT. Behaviourally this is covered by
        # the general afternoon skip below it, so deleting the named heartbeat
        # branch changes no outcome — which is precisely why the message is
        # what has to be pinned. When this recurs, "a delayed fire, not a
        # regeneration" sends the next person to the cron; "the post-close
        # regeneration is the Friday cron's job" sends them to the price loop.
        check("the Friday cron's job" in out,
              "…and the log names the price loop, not a delayed cron",
              "said instead: %r" % out.strip().splitlines()[-1][:90] if out.strip() else "(nothing)")

    # AND THE REGENERATION ITSELF STILL HAPPENS — one scheduled fire, which is
    # the only thing inside that window: `0 20 * * 5`, 3:00 PM CDT. The three
    # morning crons are all before 14:00 Central.
    skip, _, _ = simulate(gate, event="schedule", start="15:00", dow=5, published=True)
    check(skip == "0",
          "the Friday post-close regeneration still runs from its cron")

    # A PERSON ON A FRIDAY AFTERNOON is still a person, and a manual run
    # defaults to send_email=false anyway.
    skip, _, _ = simulate(gate, event="workflow_dispatch", start="15:30", dow=5,
                          published=True)
    check(skip == "0", "a person dispatching on Friday afternoon still gets one")

    skip, _, _ = simulate(gate, event="workflow_dispatch", heartbeat=True,
                          start="16:00", dow=2)
    check(skip == "1", "an afternoon heartbeat is refused like an afternoon fire")

    # THE HEARTBEAT MUST NOT BE ABLE TO BECOME A PERSON. This is the trap the
    # first draft of the fix walked into: without the input, prices.yml's
    # dispatch takes the manual branch and regenerates all day.
    skip, _, _ = simulate(gate, event="workflow_dispatch", heartbeat=False,
                          start="16:00", dow=2, published=True)
    check(skip == "0",
          "…while a PERSON dispatching in the afternoon still gets one")

    check("gh workflow run daily.yml" in PRICES and "heartbeat=true" in PRICES,
          "the price loop actually sends the heartbeat",
          "nothing in prices.yml dispatches the briefing")
    check(re.search(r"actions:\s*write", PRICES) is not None
          and "GH_TOKEN" in PRICES,
          "and it has the permission and the token to send it",
          "`gh workflow run` needs actions: write and GH_TOKEN")

    print("\nwhat a skip costs, and what the email is allowed to do")
    check(re.search(r"generate:\s*\n\s*needs: gate", y) is not None
          and "needs.gate.outputs.skip != '1'" in y,
          "a skipped day skips the EMAIL too, not just the generation")
    email_if = "github.event_name == 'schedule' || inputs.send_email == true"
    check(y.count(email_if) == 2,
          "a manual run is still a dry run unless send_email is ticked")
    # THE TWO HALVES OF THE PUSH CHANGE MUST TRAVEL TOGETHER. A push trigger
    # without `push` in the email condition publishes to the site and sends
    # nothing — an up-to-date page and an empty inbox, which is the complaint
    # that started all of this.
    # STRIP THE COMMENTS FIRST. The tombstone explaining why the push trigger
    # was removed contains the very string this is looking for, so a plain
    # substring search over the file failed on the file that is correct.
    live = "\n".join(ln for ln in y.split("\n") if not ln.lstrip().startswith("#"))
    check("github.event_name == 'push'" not in live,
          "no live condition still names the dead push trigger")
    check("send_email=true" in PRICES,
          "a heartbeat-generated briefing EMAILS as well as publishing",
          "the price loop dispatches without send_email, so the page updates "
          "and the inbox stays empty — the complaint that started all of this")

    print()
    if FAILED:
        print("FAILED (%d): %s" % (len(FAILED), "; ".join(FAILED)))
        return 1
    print("daily schedule selftest: all passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
