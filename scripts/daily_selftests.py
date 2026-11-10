#!/usr/bin/env python3
"""
daily_selftests.py -- the Daily's code self-tests, in one list, never holding the send.

WHAT HAPPENED (Nov 3 2026). GATE 0g in daily.yml ran scripts/test_daily_numbers.py,
a self-test whose fixture is checked against live data (data/harvest-prices.json).
The live file moved, the fixture check failed, and because GATE 0g was a hard step
in front of the generator, every morning run from 5:46 to 7:31 CT stopped there.
Today's issue was fine; the test of the code was not. Nobody got the Daily on time.

Sig, Nov 3: "Code self-tests never hold the Daily send; only content gates on the
day's issue may." So every self-test that used to sit in front of the generator
or inside a content step (GATE 0 to 0g, the fact check's, the headline fix's, the
cause fix's and the edge facts' self-tests) runs here, in one step that reports
and never stops the job. Each one still runs on every run.

ONE EXCEPTION STAYS A HARD STEP: scripts/test_send_loops.py, daily.yml's "Neither
send loop can re-mail the whole list", right before the send. It guards readers
against a double or mass send, depends on no date and no live data, and a
failure there must hold the email (lead, Nov 3 2026). It is not in this list.

A failure is reported three ways:
  - the step goes red in the run (exit 1; daily.yml marks it continue-on-error)
  - the job summary lists every test with pass or fail and its telling line
  - one email to Sig: the first failing run of the day mails, later runs do not
    (today's runs read from the GitHub API with the job token; unreadable
    history mails rather than stays quiet)

The same list runs the night before, under tomorrow's date, in the Daily
rehearsal (scripts/daily_rehearsal.py).

    python3 scripts/daily_selftests.py              run all, report, mail on failure
    python3 scripts/daily_selftests.py --no-mail    run all, report, never mail (--selftest: the same)
    python3 scripts/daily_selftests.py --list       print the list and exit
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import os
import re
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(HERE))

# (label, command, extra env). Labels keep the old GATE names so a log search
# for "GATE 0g" still finds where that check runs now. The order is the old one.
NO_KEY = {"ANTHROPIC_API_KEY": ""}
SELFTESTS = [
    ("GATE 0 feed gate", ["scripts/test_preflight_limits.py"], {}),
    ("GATE 0b word budget", ["scripts/briefing_cut.py", "--selftest"], {}),
    ("GATE 0c trading calendar", ["scripts/contract_calendar.py"], {}),
    ("GATE 0d session board", ["scripts/market_board.py"], {}),
    ("GATE 0d number binding", ["scripts/test_number_binding.py"], {}),
    ("GATE 0d ARC/PLC link", ["scripts/test_arc_plc_link.py"], {}),
    ("GATE 0e voice check", ["scripts/voice_lint.py", "--selftest"], {}),
    ("GATE 0f report-day line", ["scripts/report_day.py", "--selftest"], {}),
    ("GATE 0g USDA dates", ["scripts/usda_dates.py", "--selftest"], {}),
    ("GATE 0g daily trust", ["scripts/test_daily_trust.py"], {}),
    ("GATE 0g watch dates", ["scripts/watch_dates.py", "--selftest"], {}),
    ("GATE 0g streak words", ["scripts/streak_words.py", "--selftest"], {}),
    ("GATE 0g daily numbers", ["scripts/test_daily_numbers.py"], {}),
    ("GATE 0g daily claims", ["scripts/daily_claims.py", "--selftest"], {}),
    # The fact check's selftest checks the defaults, so both overrides are cleared (a set model broke it on Oct 18).
    ("GATE 2f fact check selftest", ["scripts/test_fact_check.py"], dict(NO_KEY, FACT_CHECK_MODE="", FACT_CHECK_MODEL="")),
    ("GATE 2h headline fix selftest", ["scripts/headline_fix.py", "--selftest"], NO_KEY),
    ("GATE 2c cause fix selftest", ["scripts/cause_fix.py", "--selftest"], {}),
    ("Only on AGSIST facts selftest", ["scripts/daily_edge.py", "--selftest"], {}),
    # The one clock (#455) and the one fact-keyed memory (#458): frozen fixtures, no network, no live date.
    ("Daily one clock", ["scripts/test_daily_clock.py"], {}),
    ("Daily one memory", ["scripts/test_daily_memory.py"], {}),
]
STEP_NAME = "Code self-tests (report only, never hold the send)"
TIMEOUT_S = 240

ANSI = re.compile(r"\x1b\[[0-9;]*m")
TELLING = re.compile(r"\bFAIL(ED)?\b|Traceback|Error\b|error:|\bBLOCK", re.I)
SUMMARY_COUNT = re.compile(r"^\s*FAIL(ED|S)?\s*[:=]\s*\d+\s*$", re.I)


def telling_line(text):
    """The one line that says why a test failed: its first FAIL line, else a
    traceback's last line, else the last line with an error word, else the
    last line. Addresses masked, at most 300 characters."""
    import log_safe
    lines = [ANSI.sub("", ln).rstrip() for ln in str(text or "").splitlines()]
    lines = [ln for ln in lines if ln.strip() and not ln.startswith("::") and not SUMMARY_COUNT.match(ln)]
    pick = None
    for ln in lines:
        if re.match(r"^\s*FAIL\b", ln):
            pick = ln
            break
    if pick is None and any(ln.startswith("Traceback") for ln in lines):
        pick = lines[-1]
    if pick is None:
        hits = [ln for ln in lines if TELLING.search(ln)]
        pick = hits[-1] if hits else (lines[-1] if lines else "(no output)")
    pick = log_safe.mask_text(pick.strip())
    return pick[:297] + "..." if len(pick) > 300 else pick


def run_one(label, cmd, env_extra, env=None, timeout=TIMEOUT_S):
    """{label, cmd, ok, rc, line, seconds}. Never raises."""
    path = REPO / cmd[0]
    e = dict(env if env is not None else os.environ)
    e.update(env_extra)
    for k, v in env_extra.items():
        if v == "":
            e.pop(k, None)
    t = time.time()
    if not path.exists():
        return {"label": label, "cmd": " ".join(cmd), "ok": False, "rc": None, "seconds": 0.0,
                "line": "%s is not in this checkout" % cmd[0], "output": ""}
    try:
        r = subprocess.run([sys.executable] + [str(path)] + cmd[1:], cwd=str(REPO), env=e,
                           capture_output=True, text=True, timeout=timeout)
        out = (r.stdout or "") + (r.stderr or "")
        ok = r.returncode == 0
        return {"label": label, "cmd": " ".join(cmd), "ok": ok, "rc": r.returncode,
                "seconds": round(time.time() - t, 1), "line": "" if ok else telling_line(out), "output": out}
    except subprocess.TimeoutExpired:
        return {"label": label, "cmd": " ".join(cmd), "ok": False, "rc": None, "seconds": float(timeout),
                "line": "did not finish in %d seconds" % timeout, "output": ""}
    except Exception as ex:                                  # noqa: BLE001  a runner problem is a failed test, not a crash
        return {"label": label, "cmd": " ".join(cmd), "ok": False, "rc": None, "seconds": 0.0,
                "line": "could not start (%s)" % type(ex).__name__, "output": ""}


def run_all(env=None, tests=None, echo=True):
    results = []
    for label, cmd, extra in (tests or SELFTESTS):
        if echo:
            print("::group::%s: python %s" % (label, " ".join(cmd)))
        r = run_one(label, cmd, extra, env=env)
        if echo:
            import log_safe
            sys.stdout.write(log_safe.mask_text(r["output"][-6000:]))
            print("::endgroup::")
            print("%s  %s%s" % ("ok  " if r["ok"] else "FAIL", label, "" if r["ok"] else ": " + r["line"]))
        results.append(r)
    return results


def summary_md(results, title="Daily code self-tests"):
    bad = [r for r in results if not r["ok"]]
    out = ["### %s: %d of %d passed" % (title, len(results) - len(bad), len(results)), ""]
    if bad:
        out += ["These are tests of the code, not of today's issue. They never hold the send.", ""]
    out += ["| test | result | why |", "|---|---|---|"]
    for r in results:
        out.append("| %s | %s | %s |" % (r["label"], "pass" if r["ok"] else "FAIL",
                                         r["line"].replace("|", "/") if not r["ok"] else ""))
    return "\n".join(out) + "\n"


def write_summary(text):
    p = os.environ.get("GITHUB_STEP_SUMMARY")
    if not p:
        return
    try:
        with open(p, "a", encoding="utf-8") as fh:
            fh.write(text)
    except OSError:
        pass


def mail_lines(day, bad):
    subject = "AGSIST Daily %s: %d code self-test%s failed; the Daily still goes out" % (
        day, len(bad), "" if len(bad) == 1 else "s")
    lines = ["A test of the Daily's code failed in this morning's run. It does not hold the send: "
             "today's issue is still written, fact checked and number checked as always, and goes to the list "
             "when those content checks pass.", ""]
    for r in bad:
        lines += ["%s (python %s)" % (r["label"], r["cmd"]), "    " + r["line"], ""]
    lines += ["The test needs a fix in the code. Until then each run reports it in its job summary; "
              "this is the only email about it today."]
    return subject, lines


# ── the cap: one email a day per failing set ──────────────────────────────

def mailed_today(day, fetch=None, this_run=None, max_runs=20):
    """Today's earlier daily.yml runs whose self-test step failed, newest
    first. Reads at most `max_runs` runs. Raises daily_retry.NoHistory when
    the runs cannot be read."""
    import daily_retry as R
    fetch = fetch or R.gh_fetch
    runs = [r for r in R.runs_today(day, fetch) if str(r.get("id")) != str(this_run)]
    seen = []
    for r in list(reversed(runs))[:max_runs]:
        jobs = (fetch("/actions/runs/%s/jobs?per_page=50" % r["id"]) or {}).get("jobs") or []
        for j in jobs:
            for st in j.get("steps") or []:
                if st.get("name") == STEP_NAME and st.get("conclusion") == "failure":
                    seen.append(r)
                    break
    return seen


def may_mail(day, fetch=None, this_run=None):
    """True when this failure should mail Sig: the first run today whose
    self-test step failed mails, later ones do not (their job summaries still
    say what failed). Unreadable history mails rather than stays quiet."""
    import daily_retry as R
    try:
        earlier = mailed_today(day, fetch, this_run)
    except R.NoHistory as ex:
        print("self-test alert: %s; mailing without the cap" % ex)
        return True
    if earlier:
        print("self-test alert: an earlier run today (%s) already reported a failing self-test; not mailing again"
              % earlier[0].get("id"))
        return False
    return True


def main(argv):
    if "--list" in argv:
        for label, cmd, _ in SELFTESTS:
            print("%-36s python %s" % (label, " ".join(cmd)))
        return 0
    from datetime import date
    results = run_all()
    bad = [r for r in results if not r["ok"]]
    text = summary_md(results)
    write_summary(text)
    print("\n%d of %d self-tests passed" % (len(results) - len(bad), len(results)))
    if not bad:
        return 0
    for r in bad:
        print("::warning title=self-test failed (the Daily still goes out)::%s: %s" % (r["label"], r["line"]))
    if "--no-mail" not in argv and "--selftest" not in argv:     # quick.sh runs it with --selftest: report only
        day = date.today().isoformat()
        if may_mail(day, this_run=os.environ.get("GITHUB_RUN_ID")):
            import log_safe
            subject, lines = mail_lines(day, bad)
            print("self-test alert to Sig: " + ("sent" if log_safe.owner_mail(subject, lines) else "NOT sent (see above)"))
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
