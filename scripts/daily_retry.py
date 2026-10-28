#!/usr/bin/env python3
"""
daily_retry.py -- a blocked Daily tries again by itself (Oct 28 2026).

WHAT HAPPENED. On Oct 28 the 6:16 a.m. CT run passed the fact check, committed
and published the issue, and then the send step's number check (daily_v2.check,
through send_daily.v2_gate) refused it: a close word over the morning's last
trade. Every later run said "already published" and skipped, so nobody got the
Daily until a manual run, and the refused headline sat on agsist.com/daily for
about two hours. Sig, Oct 27: "if the headline is bad, trigger a fix on the
spot until it passes its test."

THREE PIECES, all used by .github/workflows/daily.yml:

  prepublish   The send step's own number check (send_daily.v2_gate, the same
               function, the same daily_v2.check) on today's issue, BEFORE the
               commit. A draft the send would refuse is never published. Exit 1
               stops the job like GATE 2f, so nothing is committed and the next
               run writes the issue again. The send step keeps its check too.

  flag DAY     For the gate: has today's issue gone to the list? Asks the day
               flag (briefed:<day>, the worker and the private repo, as
               send_daily.py does). Exit 0 = definitely not sent, so a published
               but unsent issue may be written again; 1 = sent; 2 = cannot tell,
               and the gate skips (never risk a second send).

  alert        One email to Sig when a check blocks a run that was meant to
               send: which check, that nothing was published or sent, and
               whether the next run tries again (until 2 p.m. CT, the gate's
               morning window) or not.

  dry-run-mark DAY
               A manual run without send_email publishes and sends nothing on
               purpose. It leaves data/daily-sent/<day>.dry-run.json so the gate
               treats the day as done (deliberately not sent) and does not mail
               the list behind the person's back. No address, count or link.

    python3 scripts/daily_retry.py prepublish [issue.json]
    python3 scripts/daily_retry.py flag 2026-10-28
    python3 scripts/daily_retry.py alert          (FAILED="g2f ..." from daily.yml)
    python3 scripts/daily_retry.py dry-run-mark 2026-10-28
"""
import json
import os
import sys
from datetime import date, datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(HERE))

ARCHIVE = REPO / "data" / "daily-archive"
SENT = REPO / "data" / "daily-sent"
# The gate's own morning window: past 14:00 Central no run regenerates
# (daily.yml, "A DELAYED MORNING FIRE IS NOT A REGENERATION").
RETRY_UNTIL_HOUR = 14

# daily.yml step ids -> what Sig reads
CHECKS = {
    "g0": "a selftest of the checks (GATE 0)",
    "g1": "the price feed check (GATE 1)",
    "gen": "writing the issue (the generator stopped)",
    "g2f": "the fact check against the source data (GATE 2f)",
    "g2h": "the headline check and its rewrites (GATE 2h)",
    "g2": "the pre-publish gate (GATE 2)",
    "schema": "the schema and length check",
    "g2v": "the email's number check on the subject, headline and lead (GATE 2v)",
    "commit": "publishing (the push to agsist.com)",
}
# steps that already mail Sig themselves when they block (headline_fix.hold_alert)
MAILS_ITSELF = {"g2h"}


# ── prepublish: the send's number check, before anything is published ──────

def prepublish(path=None, today=None):
    import send_daily as sd
    if sd.daily_format() != "v2":
        print("GATE 2v: format %s; the v2 number check does not apply" % sd.daily_format())
        return 0
    day = (today or date.today()).isoformat()
    p = Path(path) if path else ARCHIVE / (day + ".json")
    if not p.exists():
        print("GATE 2v: no issue dated %s, nothing to send and nothing to check" % day)
        return 0
    with open(p, encoding="utf-8") as fh:
        b = json.load(fh)
    if sd.v2_gate(day, b, alert=False):
        print("GATE 2v: the email's number check passes; clear to publish")
        return 0
    print("GATE 2v: the send would refuse this issue, so it is not published. "
          "The next run writes it again and checks it again.")
    return 1


# ── flag: has the day gone to the list? ────────────────────────────────────

def flag_state(day):
    """0 not sent, 1 sent, 2 cannot tell."""
    import list_source
    if not ((os.environ.get("LIST_URL") or "").strip() and (os.environ.get("LIST_TOKEN") or "").strip()) \
            and list_source.forced() != "backup":
        print("day flag: no list worker configured here; cannot tell whether %s went out" % day)
        return 2
    try:
        sent = list_source.flag_is_set("briefed:" + day)
    except Exception as ex:                                  # noqa: BLE001  fail closed, like send_daily.flag
        print("day flag for %s not readable (%s); treating the day as possibly sent" % (day, type(ex).__name__))
        return 2
    print("day flag for %s: %s" % (day, "set (it went out)" if sent else "not set (it never went to the list)"))
    return 1 if sent else 0


# ── today's runs of daily.yml, from the GitHub API (job token, read only) ──
#
# Two questions need them, and no file in the repo can answer either:
#   - did a manual run without send_email publish today? (its dry-run mark may
#     not have been pushed; the gate must not mail that day behind it)
#   - how many block alerts went out today, and for which check? (the cap)
# The run's title carries its inputs (daily.yml run-name), because the API
# does not return a dispatch's inputs.

CT = "America/Chicago"
ALERT_STEP = "Tell Sig which check held the Daily"
# daily.yml step names -> check ids (the alert names a check by these)
STEP_IDS = (("GATE 1", "g1"), ("Generate daily briefing", "gen"), ("GATE 2f", "g2f"), ("GATE 2h", "g2h"),
            ("GATE 2v", "g2v"), ("GATE 2 ", "g2"), ("Validate schema", "schema"), ("Commit and push", "commit"))
MAX_ALERTS = 3          # a day
ALERT_GAP_H = 2         # hours between two alerts, and only when the check changed
NEXT_RUN_MIN = 30       # the price loop's heartbeat comes about every half hour


class NoHistory(Exception):
    """The runs could not be read."""


def gh_fetch(path):
    import urllib.request
    tok = (os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN") or "").strip()
    repo = (os.environ.get("GITHUB_REPOSITORY") or "").strip()
    if not (tok and repo):
        raise NoHistory("no GH_TOKEN or GITHUB_REPOSITORY here")
    url = "%s/repos/%s%s" % ((os.environ.get("GITHUB_API_URL") or "https://api.github.com").rstrip("/"), repo, path)
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + tok, "Accept": "application/vnd.github+json",
                                               "X-GitHub-Api-Version": "2022-11-28"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception as ex:                                  # noqa: BLE001
        raise NoHistory("the runs could not be read (%s)" % type(ex).__name__)


def _ct_day(stamp):
    from zoneinfo import ZoneInfo
    t = datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
    return t.astimezone(ZoneInfo(CT))


def runs_today(day, fetch=gh_fetch):
    """daily.yml runs created on the Central day `day`, oldest first."""
    from zoneinfo import ZoneInfo
    from datetime import timezone
    start = datetime.fromisoformat(day).replace(tzinfo=ZoneInfo(CT)).astimezone(timezone.utc)
    out = []
    for page in (1, 2, 3):
        d = fetch("/actions/workflows/daily.yml/runs?per_page=100&page=%d&created=%%3E%%3D%s"
                  % (page, start.strftime("%Y-%m-%dT%H:%M:%SZ")))
        rows = (d or {}).get("workflow_runs") or []
        out += [r for r in rows if _ct_day(r.get("created_at")).date().isoformat() == day]
        if len(rows) < 100:
            break
    return sorted(out, key=lambda r: r.get("created_at") or "")


def is_dry_run(run):
    """A manual run without send_email (not the price loop's heartbeat, not Sig's test copy)."""
    t = str(run.get("display_title") or run.get("name") or "")
    return (run.get("event") == "workflow_dispatch" and "send_email=false" in t and "heartbeat=false" in t
            and "test_to_sig=false" in t)


def dry_run_today(day, fetch=gh_fetch):
    """True when a manual run without send_email finished today (it published
    the issue on purpose). Raises NoHistory when the runs cannot be read."""
    return any(is_dry_run(r) and r.get("conclusion") == "success" for r in runs_today(day, fetch))


def retry_state(day, fetch=gh_fetch):
    """For the gate, about a published issue with no sent copy and no dry-run
    mark: 0 write it again, 1 it went out, 2 cannot tell, 3 a manual dry run
    published it today (its mark was not pushed). Anything unclear skips."""
    try:
        if dry_run_today(day, fetch):
            print("runs today: a manual run without send_email published %s; it is deliberately not sent" % day)
            return 3
    except NoHistory as ex:
        print("runs today: %s; cannot tell whether a dry run published %s" % (ex, day))
        return 2
    return flag_state(day)


def step_check(name):
    for prefix, k in STEP_IDS:
        if str(name).startswith(prefix):
            return k
    return "unknown"


def past_blocks(day, fetch=gh_fetch, this_run=None):
    """[(created_at, check)] for today's earlier runs that were meant for the
    list and were held before publishing: their alert step ran."""
    out = []
    for r in runs_today(day, fetch):
        if str(r.get("id")) == str(this_run) or r.get("conclusion") != "failure":
            continue
        jobs = (fetch("/actions/runs/%s/jobs?per_page=50" % r["id"]) or {}).get("jobs") or []
        for j in jobs:
            steps = j.get("steps") or []
            if not any(st.get("name") == ALERT_STEP and st.get("conclusion") in ("success", "failure") for st in steps):
                continue
            bad = next((st.get("name") for st in steps if st.get("conclusion") == "failure"), None)
            out.append((r.get("created_at"), step_check(bad) if bad else "unknown"))
    return out


def may_mail(check, now, past):
    """The cap (2026-10-28 review): the first block of the day mails; after
    that only a different check, at least ALERT_GAP_H hours after the last
    alert; never more than MAX_ALERTS a day. `past` is today's earlier blocks,
    replayed through the same rule to know which of them mailed."""
    sent = []

    def ok(c, t):
        if len(sent) >= MAX_ALERTS:
            return False
        if not sent:
            return True
        lc, lt = sent[-1]
        return c != lc and (t - lt).total_seconds() >= ALERT_GAP_H * 3600
    for stamp, c in past:
        t = _ct_day(stamp)
        if ok(c, t):
            sent.append((c, t))
    return ok(check, now), len(sent)


def capped(check, now=None, fetch=gh_fetch):
    """True when this block may mail Sig. History unreadable: mail (an alert
    too many beats a block nobody hears about)."""
    from zoneinfo import ZoneInfo
    now = now or datetime.now(ZoneInfo(CT))
    if now.tzinfo is None:
        now = now.replace(tzinfo=ZoneInfo(CT))
    try:
        past = past_blocks(now.date().isoformat(), fetch, os.environ.get("GITHUB_RUN_ID"))
    except NoHistory as ex:
        print("block alert: %s; mailing without the cap" % ex)
        return True
    allowed, n = may_mail(check, now, past)
    print("block alert: %d earlier block(s) today, %d mailed; this one %s"
          % (len(past), n, "mails" if allowed else "does not (same check, under %dh, or %d already)" % (ALERT_GAP_H, MAX_ALERTS)))
    return allowed


def can_retry(now):
    """A run can still start inside the morning window."""
    return now.hour * 60 + now.minute + NEXT_RUN_MIN < RETRY_UNTIL_HOUR * 60


# ── alert: one email to Sig, naming the check ──────────────────────────────

def alert_lines(day, failed, now, run_url=""):
    """(subject, lines) or (None, None) when there is nothing to say."""
    keys = [k for k in failed if k]
    if not keys or set(keys) <= MAILS_ITSELF:
        return None, None
    names = [CHECKS.get(k, k) for k in keys]
    which = " and ".join(names) if keys != ["unknown"] else "a check before publishing (see the run log)"
    lines = ["The AGSIST Daily for %s was held by %s." % (day, which), "",
             "Nothing was published and nothing went to the list. The day is not marked sent.", ""]
    if can_retry(now):
        lines += ["The next scheduled run tries again on its own: it writes today's issue from scratch and runs every "
                  "check again, and if it passes it goes to the list. Runs keep trying until 2 p.m. CT. "
                  "You do not need to do anything.",
                  "You get at most %d of these a day: the first, then only when a different check holds it, "
                  "%d hours apart or more." % (MAX_ALERTS, ALERT_GAP_H)]
    else:
        lines += ["No scheduled run can start again before 2 p.m. CT, so nothing tries again today. "
                  "Tomorrow's run is not affected.",
                  "To send today's issue anyway: GitHub, dnilgis/agsist, Actions, Generate Daily Briefing, Run workflow "
                  "on main with send_email ticked."]
    if run_url:
        lines += ["", "The run, with the check's own log: " + run_url]
    subject = "AGSIST Daily %s held by %s" % (day, names[0] if keys != ["unknown"] else "a check")
    if can_retry(now):
        subject += "; the next run tries again"
    return subject, lines


def alert(failed=None, now=None, mail=None, fetch=gh_fetch):
    failed = failed if failed is not None else (os.environ.get("FAILED") or "").split()
    now = now or datetime.now()
    day = now.date().isoformat()
    failed = [k for k in failed if k] or ["unknown"]
    subject, lines = alert_lines(day, failed, now)
    if not subject:
        print("block alert: the blocking step mailed Sig itself (under the same cap); nothing more to send")
        return 0
    print("block alert: %s" % subject)
    if not capped(failed[0], now, fetch):
        return 0
    if mail is None:
        import log_safe
        mail = log_safe.owner_mail
    print("alert to Sig: " + ("sent" if mail(subject, lines) else "NOT sent (see above)"))
    return 0


# ── dry-run-mark: published on purpose, not sent on purpose ─────────────────

def dry_run_mark(day, sent_dir=None, now=None):
    d = Path(sent_dir) if sent_dir else SENT
    if (d / (day + ".json")).exists():
        print("dry run mark: %s already went to the list; no mark needed" % day)
        return None
    path = d / (day + ".dry-run.json")
    d.mkdir(parents=True, exist_ok=True)
    rec = {"date": day, "at": (now or datetime.now()).astimezone().isoformat(timespec="seconds"),
           "note": "Published by a manual run without send_email: deliberately not sent. "
                   "Later scheduled runs this day do not write or mail it again."}
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(rec, fh, indent=1)
        fh.write("\n")
    print("dry run mark kept: data/daily-sent/%s.dry-run.json" % day)
    return path


def main(argv):
    if not argv:
        print(__doc__)
        return 2
    cmd, rest = argv[0], argv[1:]
    if cmd == "prepublish":
        return prepublish(rest[0] if rest else None)
    if cmd == "flag" and rest:
        return flag_state(rest[0])
    if cmd == "retry" and rest:
        return retry_state(rest[0])
    if cmd == "alert":
        return alert()
    if cmd == "dry-run-mark" and rest:
        dry_run_mark(rest[0])
        return 0
    print("unknown command: " + " ".join(argv))
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
