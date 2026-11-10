#!/usr/bin/env python3
"""
daily_late.py -- tell the owner when the Daily has not gone out by 7:15 AM CT.

WHAT HAPPENED (Nov 3 2026). Every morning run from 5:46 to 7:31 CT stopped at a
self-test, a manual dry run then published the issue without mailing it, and the
heartbeats skipped. Nobody got the Daily until a second manual run, and nothing
told the owner: the self-test step was not one the block alert names, and cron-health
only asks whether the issue is PUBLISHED. Nov 3

    python3 scripts/daily_late.py check            (cron-health.yml, the run after the 7:15 tick)
    python3 scripts/daily_late.py check --now 2026-11-03T07:16:00-06:00

ONE EMAIL, ONCE A DAY. cron-health.yml runs after every "Fetch Grain Bids"
(cron-job.org, every 15 minutes, every day). Its gate passes this job to the
first run after 12:15 and 13:15 UTC (scripts/cron_gate.py tick), and this script
acts only when that run lands between 7:15 and 8:15 AM Central, so one of the
two ticks is the 7:15 one in either season and the other does nothing. Every
day is a send day (the Daily goes out seven days a week).

SENT means: data/daily-sent/<day>.json is on main (send_daily.py writes it on
the first send), or the day flag (briefed:<day>) says the list got it and only
the copy is missing. A flag that cannot be read does not count as sent; the
email says so.

The email names what held it: today's daily.yml runs (GitHub API, the job
token, read only), the newest failing step with its telling log line, the gate's
last word when it skipped, and a manual dry run if one published the issue. No
address, count or link to a reader: run links only.
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import os
import re
import sys
import urllib.request
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(HERE))

CT = "America/Chicago"
DUE = (7, 15)            # Nov 3: sent by 7:15 AM CT
ALERT_UNTIL = (8, 15)    # the run after the 7:15 tick; the other UTC tick lands outside this hour
MAX_RUNS = 12            # newest runs read for a failing step (two API calls each at most)
STAMP = re.compile(r"^\d{4}-\d\d-\d\dT[\d:.]+Z ?")
ANSI = re.compile(r"\x1b\[[0-9;]*m")


def now_ct(now=None):
    from zoneinfo import ZoneInfo
    if now is None:
        return datetime.now(ZoneInfo(CT))
    if isinstance(now, str):
        now = datetime.fromisoformat(now)
    return now.astimezone(ZoneInfo(CT)) if now.tzinfo else now.replace(tzinfo=ZoneInfo(CT))


def in_alert_hour(t):
    hm = (t.hour, t.minute)
    return DUE <= hm < ALERT_UNTIL


def sent_state(day, root=REPO, flag=None):
    """('sent', why) | ('not sent', why) | ('unknown', why)."""
    if (Path(root) / "data" / "daily-sent" / (day + ".json")).exists():
        return "sent", "its sent copy data/daily-sent/%s.json is on main" % day
    if flag is None:
        import daily_retry
        flag = daily_retry.flag_state
    rc = flag(day)
    if rc == 1:
        return "sent", "the day flag says it went to the list; only the sent copy is missing"
    if rc == 0:
        return "not sent", "no sent copy on main, and the day flag says it never went to the list"
    return "unknown", "no sent copy on main, and the day flag could not be read"


# ── the GitHub API, read only ──────────────────────────────────────────────

class _NoAuthOffHost(urllib.request.HTTPRedirectHandler):
    """A job log is a redirect to signed storage: never carry the token there."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        new = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new is not None:
            from urllib.parse import urlparse
            if urlparse(newurl).netloc != urlparse(req.full_url).netloc:
                for k in list(new.headers):
                    if k.lower() == "authorization":
                        del new.headers[k]
        return new


def gh_text(path):
    import daily_retry as R
    tok = (os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN") or "").strip()
    repo = (os.environ.get("GITHUB_REPOSITORY") or "").strip()
    if not (tok and repo):
        raise R.NoHistory("no GH_TOKEN or GITHUB_REPOSITORY here")
    url = "%s/repos/%s%s" % ((os.environ.get("GITHUB_API_URL") or "https://api.github.com").rstrip("/"), repo, path)
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + tok, "X-GitHub-Api-Version": "2022-11-28"})
    try:
        with urllib.request.build_opener(_NoAuthOffHost).open(req, timeout=30) as r:
            return r.read().decode("utf-8", "replace")
    except Exception as ex:                                  # noqa: BLE001
        raise R.NoHistory("a job log could not be read (%s)" % type(ex).__name__)


# ── what held it ──────────────────────────────────────────────────────────

def step_first_line(step_name, wf_text):
    """The first command line of a daily.yml step, as a job log's
    '##[group]Run ...' header shows it; None when the step is not found."""
    i = wf_text.find("- name: " + step_name)
    if i < 0:
        return None
    nxt = wf_text.find("\n      - ", i + 1)
    block = wf_text[i: nxt if nxt > 0 else len(wf_text)]
    m = re.search(r"\n\s+run: (.*)", block)
    if not m:
        return None
    first = m.group(1).strip()
    if first in ("|", ">", "|-", ">-"):
        rest = block[m.end():].split("\n")
        first = next((ln.strip() for ln in rest if ln.strip() and not ln.strip().startswith("#")), "")
    return first or None


def log_line(log, first_line=None):
    """The telling line of the failing step in a job log."""
    import daily_selftests as S
    lines = [ANSI.sub("", STAMP.sub("", ln)) for ln in str(log or "").splitlines()]
    errs = [i for i, ln in enumerate(lines) if ln.startswith("##[error]")]
    if not errs:
        return S.telling_line("\n".join(lines[-40:]))
    end = None
    start = None
    if first_line:
        for i, ln in enumerate(lines):
            if ln.startswith("##[group]Run ") and ln[len("##[group]Run "):].strip() == first_line.strip():
                start = i
                end = next((j for j in errs if j > i), None)
                break
    if end is None:
        # the step not found by its command: the last error, and what came before it
        end = errs[-1]
        own = lines[end][len("##[error]"):].strip()
        if own and not own.startswith("Process completed with exit code"):
            return S.telling_line(own)
        start = max([i for i, ln in enumerate(lines[:end]) if ln.startswith("##[group]Run ")] or [max(0, end - 40)])
    # the step's output starts after GitHub's listing of its script, shell and env
    close = next((i for i in range(start + 1, end) if lines[i].startswith("##[endgroup]")), start)
    body = [ln for ln in lines[close + 1:end] if not ln.startswith("##[")]
    return S.telling_line("\n".join(body))


def gate_word(log):
    """The gate's last decision line, readable: '07:46 Central: SKIPPING: ...'."""
    for ln in reversed(str(log or "").splitlines()):
        ln = ANSI.sub("", STAMP.sub("", ln)).strip()
        if re.match(r"^\d\d:\d\d Central . (SKIPPING|GENERATING|RETRYING|waiting)", ln):
            return ln.replace(" — ", ": ").replace("—", ",")
    return None


def _hm(stamp):
    from zoneinfo import ZoneInfo
    t = datetime.fromisoformat(str(stamp).replace("Z", "+00:00")).astimezone(ZoneInfo(CT))
    return "%d:%02d" % (t.hour, t.minute)


def _kind(run):
    t = str(run.get("display_title") or "")
    if run.get("event") == "schedule":
        return "scheduled run"
    if "heartbeat=true" in t:
        return "heartbeat"
    if "test_to_sig=true" in t:
        return "test copy to Sig"
    if "send_email=false" in t:
        return "manual dry run"
    return "manual run"


def diagnose(day, fetch=None, text=None, wf_text=None, repo=""):
    """Lines that say what happened to today's Daily runs. Never raises."""
    import daily_retry as R
    fetch = fetch or R.gh_fetch
    text = text or gh_text
    if wf_text is None:
        try:
            wf_text = (REPO / ".github" / "workflows" / "daily.yml").read_text(encoding="utf-8")
        except OSError:
            wf_text = ""
    url = lambda r: "https://github.com/%s/actions/runs/%s" % (repo, r["id"]) if repo else "run %s" % r["id"]
    try:
        runs = R.runs_today(day, fetch)
    except R.NoHistory as ex:
        return ["Today's Daily runs could not be read (%s)." % ex]
    if not runs:
        return ["No run of the Daily has started today: the morning fires were dropped and no heartbeat came."]
    out = []
    fails = [r for r in runs if r.get("conclusion") == "failure"]
    going = [r for r in runs if r.get("status") != "completed"]
    out.append("Daily runs today: %d (%d failed%s)." % (len(runs), len(fails),
               ", %d still going" % len(going) if going else ""))
    newest = runs[-1]
    out.append("Newest: %s at %s CT, %s. %s" % (_kind(newest), _hm(newest.get("created_at")),
               newest.get("conclusion") or newest.get("status") or "unknown", url(newest)))
    dry = [r for r in runs if R.is_dry_run(r) and r.get("conclusion") == "success"]
    if dry:
        out.append("A manual run without send_email published today's issue at %s CT and emailed nobody." % _hm(dry[-1]["created_at"]))
    found_fail = found_gate = False
    for r in list(reversed(runs))[:MAX_RUNS]:
        if found_fail and found_gate:
            break
        try:
            jobs = (fetch("/actions/runs/%s/jobs?per_page=50" % r["id"]) or {}).get("jobs") or []
        except R.NoHistory as ex:
            out.append("The jobs of run %s could not be read (%s)." % (r["id"], ex))
            break
        for j in jobs:
            bad = next((st for st in (j.get("steps") or []) if st.get("conclusion") == "failure"), None)
            if bad and not found_fail:
                found_fail = True
                out.append("Failing step: %s, in the %s at %s CT. %s" % (bad.get("name"), _kind(r), _hm(r.get("created_at")), url(r)))
                try:
                    out.append("Log line: " + log_line(text("/actions/jobs/%s/logs" % j["id"]),
                                                        step_first_line(bad.get("name") or "", wf_text)))
                except R.NoHistory as ex:
                    out.append("Log line: not readable (%s)." % ex)
            if j.get("name") == "gate" and not found_gate and r is newest:
                found_gate = True
                try:
                    w = gate_word(text("/actions/jobs/%s/logs" % j["id"]))
                    if w:
                        out.append("The gate's last word: " + w)
                except R.NoHistory:
                    pass
    if not found_fail:
        out.append("No step failed in the newest %d runs." % min(len(runs), MAX_RUNS))
    return out


def alert_lines(day, t, state, why, diag):
    subject = "AGSIST Daily %s not sent by 7:15 AM CT" % day
    lines = ["The Daily for %s has not gone to the list, and it is %d:%02d AM CT." % (t.strftime("%A %b ") + str(t.day), t.hour, t.minute),
             "Sent: %s (%s)." % (state, why), ""] + diag + [
             "", "Scheduled runs and heartbeats keep trying until 2 p.m. CT. To send it now: GitHub, dnilgis/agsist, "
                 "Actions, Generate Daily Briefing, Run workflow on main with send_email ticked. The day flag stops a second send.",
             "This is the only late alert today."]
    return subject, lines


def check(now=None, root=REPO, flag=None, fetch=None, text=None, mail=None, wf_text=None):
    """0 always, except a late day whose alert could not be mailed (1)."""
    t = now_ct(now)
    day = t.date().isoformat()
    if not in_alert_hour(t):
        print("late alert: %d:%02d CT is outside the 7:15 to 8:15 alert hour; nothing to do" % (t.hour, t.minute))
        return 0
    state, why = sent_state(day, root, flag)
    print("late alert: %s, %s: %s" % (day, state, why))
    if state == "sent":
        return 0
    diag = diagnose(day, fetch, text, wf_text, os.environ.get("GITHUB_REPOSITORY", ""))
    subject, lines = alert_lines(day, t, state, why, diag)
    import log_safe
    lines = [log_safe.mask_text(x) for x in lines]
    for ln in lines:
        print("  " + ln)
    p = os.environ.get("GITHUB_STEP_SUMMARY")
    if p:
        try:
            with open(p, "a", encoding="utf-8") as fh:
                fh.write("### %s\n\n%s\n" % (subject, "\n\n".join(x for x in lines if x)))
        except OSError:
            pass
    print("::error title=Daily not sent by 7:15 AM CT::%s" % (diag[0] if diag else why))
    mail = mail or log_safe.owner_mail
    ok = mail(subject, lines)
    print("late alert to Sig: " + ("sent" if ok else "NOT sent (see above)"))
    return 0 if ok else 1


def main(argv):
    if not argv or argv[0] != "check":
        print(__doc__)
        return 2
    now = None
    if "--now" in argv:
        i = argv.index("--now")
        now = argv[i + 1] if i + 1 < len(argv) else None
    return check(now)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
