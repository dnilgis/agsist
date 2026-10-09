#!/usr/bin/env python3
"""
cron_gate.py: the first step of a workflow that GitHub's scheduler cannot be
trusted to start on time.

WHY THIS EXISTS. Measured 2026-10-02 to 10-09 on this repository: GitHub
delivered 443 of 3,230 scheduled fires (13.7%). The fast crons got 3-10% of
theirs; the daily ones all arrived, but a median three to seven hours late.
What does arrive on time is cron-job.org's workflow_dispatch of "Fetch Grain
Bids" every 15 minutes (671 of 672 slots), and the workflow_run events that
follow it (every one of 703 completions started each chained watcher).

So a time-critical workflow also runs `on: workflow_run` after "Fetch Grain
Bids", and this script decides, in a few seconds, whether that run has
anything to do:

  tick   The workflow keeps a cron schedule (its LOGICAL schedule, given with
         --cron). A run has work when a tick of that schedule has passed and no
         other run of this workflow has started since it. The first run after
         a tick does the work, whoever started it; every later run skips. A
         scheduled fire that arrives hours late finds the tick already served
         and skips too, instead of running the job a second time.

  cot    For cot-release-watch.yml: Monday to Friday, 19:00-23:59 UTC, and only
         while this week's report is not yet in data/cot.json.

A manual Run workflow, a push and a repository_dispatch always go.

Writes go=0|1 and reason=... to $GITHUB_OUTPUT (stdout when unset).

    python3 scripts/cron_gate.py tick --workflow news.yml \\
        --cron "7,22,37,52 12-21 * * 1-5" --max-lag 60
    python3 scripts/cron_gate.py cot --cot-file data/cot.json
    python3 scripts/cron_gate.py --selftest
"""

import json
import os
import sys
import urllib.request
from datetime import date, datetime, timedelta, timezone

UTC = timezone.utc
ALWAYS_GO = {"workflow_dispatch", "push", "repository_dispatch", "pull_request", "workflow_call"}
NOT_A_RUN = {"cancelled", "startup_failure"}   # replaced pending runs never reached their gate


# ── cron ─────────────────────────────────────────────────────────────────────
def _field(spec, lo, hi):
    """Values in [lo, hi] one cron field matches: *, a, a-b, a-b/n, */n, lists."""
    out = set()
    for part in spec.split(","):
        step = 1
        if "/" in part:
            part, st = part.split("/", 1)
            step = int(st)
        if part in ("*", "?"):
            a, b = lo, hi
        elif "-" in part:
            a, b = (int(x) for x in part.split("-", 1))
        else:
            a = int(part)
            b = hi if step > 1 else a
        out.update(range(a, b + 1, step))
    return {v for v in out if lo <= v <= hi}


class Cron:
    def __init__(self, expr):
        f = expr.split()
        if len(f) != 5:
            raise ValueError("cron needs five fields: %r" % expr)
        self.expr = expr
        self.mins = _field(f[0], 0, 59)
        self.hours = _field(f[1], 0, 23)
        self.doms = _field(f[2], 1, 31)
        self.months = _field(f[3], 1, 12)
        dows = _field(f[4], 0, 7)
        self.dows = {0 if d == 7 else d for d in dows}
        self.dom_any = f[2] in ("*", "?")
        self.dow_any = f[4] in ("*", "?")

    def day_ok(self, d):
        if d.month not in self.months:
            return False
        dow = d.isoweekday() % 7            # Sunday = 0, as cron counts
        if self.dom_any or self.dow_any:    # one side unrestricted: both must match
            return d.day in self.doms and dow in self.dows
        return d.day in self.doms or dow in self.dows   # both restricted: either


def ticks(crons, start, end):
    """Every tick of any cron in [start, end), ascending, minute precision."""
    crons = [c if isinstance(c, Cron) else Cron(c) for c in crons]
    out = set()
    h = start.replace(minute=0, second=0, microsecond=0)
    while h < end:
        for c in crons:
            if h.hour in c.hours and c.day_ok(h):
                for m in c.mins:
                    t = h.replace(minute=m)
                    if start <= t < end:
                        out.add(t)
        h += timedelta(hours=1)
    return sorted(out)


def latest_tick(crons, now, lookback_hours=24 * 8):
    """The newest tick at or before `now`, or None within the lookback."""
    found = ticks(crons, now - timedelta(hours=lookback_hours), now + timedelta(minutes=1))
    found = [t for t in found if t <= now]
    return found[-1] if found else None


def max_spacing_minutes(crons):
    """Longest gap between consecutive ticks over a sample fortnight."""
    base = datetime(2026, 1, 5, tzinfo=UTC)           # a Monday
    t = ticks(crons, base, base + timedelta(days=14))
    if len(t) < 2:
        return None
    return int(max((b - a).total_seconds() for a, b in zip(t, t[1:])) // 60)


# ── the tick decision ────────────────────────────────────────────────────────
def parse_ts(s):
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)


def decide_tick(event, crons, now, self_id, runs, max_lag_minutes):
    """(go, reason). `runs` are this workflow's runs created at or after the
    tick, as the API returns them (id, created_at, conclusion)."""
    if event in ALWAYS_GO:
        return 1, "%s always runs" % event
    t = latest_tick(crons, now)
    if t is None:
        return (1, "schedule fire with no tick in range") if event == "schedule" else (0, "no tick in range")
    lag = (now - t).total_seconds() / 60
    if event != "schedule" and lag > max_lag_minutes:
        return 0, "last tick %s is %d min old, past the %d min window" % (t.strftime("%a %H:%M"), lag, max_lag_minutes)
    me = next((r for r in runs if int(r["id"]) == int(self_id)), None)
    my_key = (parse_ts(me["created_at"]), int(me["id"])) if me else None
    for r in runs:
        if int(r["id"]) == int(self_id) or r.get("conclusion") in NOT_A_RUN:
            continue
        created = parse_ts(r["created_at"])
        if created < t:
            continue
        earlier = (created, int(r["id"])) < my_key if my_key else int(r["id"]) < int(self_id)
        if earlier:
            return 0, "tick %s already served by run %s (%s)" % (t.strftime("%a %H:%M"), r["id"], r["created_at"])
    return 1, "first run since the %s tick" % t.strftime("%a %H:%M UTC")


def api_runs(repo, workflow, since, token, api="https://api.github.com"):
    url = ("%s/repos/%s/actions/workflows/%s/runs?per_page=100&exclude_pull_requests=true&created=%%3E%%3D%s"
           % (api, repo, workflow, since.strftime("%Y-%m-%dT%H:%M:%SZ")))
    req = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github+json",
        "Authorization": "Bearer %s" % token,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "agsist-cron-gate"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode()).get("workflow_runs", [])


# ── the COT decision ─────────────────────────────────────────────────────────
def cot_target_tuesday(today):
    """The Tuesday whose report should be public by `today` on the ordinary
    calendar: the latest Tuesday at least three days back. On a Friday that is
    this week's Tuesday; on a holiday-delayed Monday it is still last week's."""
    d = today - timedelta(days=3)
    return d - timedelta(days=(d.weekday() - 1) % 7)


def decide_cot(event, now, cot):
    """(go, reason) for cot-release-watch.yml. `cot` is data/cot.json, or None."""
    if event in ALWAYS_GO:
        return 1, "%s always runs" % event
    if now.isoweekday() > 5 or now.hour < 19:
        return 0, "outside Mon-Fri 19:00-23:59 UTC"
    if not cot:
        return 1, "data/cot.json unreadable; probe anyway"
    try:
        have = datetime.strptime(cot.get("report_date", ""), "%B %d, %Y").date()
    except ValueError:
        return 1, "report_date unreadable; probe anyway"
    today = now.date()
    want = cot_target_tuesday(today)
    nxt = None
    try:
        nxt = date.fromisoformat(cot.get("next_release", ""))
    except (TypeError, ValueError):
        pass
    # Either clock saying "due" is enough. next_release knows CFTC's holiday
    # delays; the Tuesday rule does not depend on that file being right.
    if have < want:
        return 1, "have the %s report, %s is due" % (have, want)
    if nxt and today >= nxt:
        return 1, "next release %s is today or past" % nxt
    return 0, "this week's report (%s) is already in; next %s" % (have, nxt or "unknown")


# ── output ───────────────────────────────────────────────────────────────────
def emit(go, reason):
    print("go=%d (%s)" % (go, reason), file=sys.stderr)
    out = os.environ.get("GITHUB_OUTPUT")
    text = "go=%d\nreason=%s\n" % (go, reason.replace("\n", " "))
    if out:
        with open(out, "a") as f:
            f.write(text)
    else:
        sys.stdout.write(text)


def main(argv):
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("mode", nargs="?", choices=["tick", "cot"])
    p.add_argument("--workflow")
    p.add_argument("--cron", action="append", default=[])
    p.add_argument("--max-lag", type=int, default=120)
    p.add_argument("--cot-file", default="data/cot.json")
    p.add_argument("--selftest", action="store_true")
    a = p.parse_args(argv)
    if a.selftest:
        return selftest()
    event = os.environ.get("GITHUB_EVENT_NAME", "workflow_dispatch")
    now = datetime.now(UTC)
    if a.mode == "cot":
        try:
            with open(a.cot_file) as f:
                cot = json.load(f)
        except Exception:
            cot = None
        emit(*decide_cot(event, now, cot))
        return 0
    if a.mode != "tick" or not a.workflow or not a.cron:
        p.error("tick needs --workflow and at least one --cron")
    if event in ALWAYS_GO:
        emit(1, "%s always runs" % event)
        return 0
    t = latest_tick(a.cron, now)
    if t is None or (event != "schedule" and (now - t) > timedelta(minutes=a.max_lag)):
        emit(*decide_tick(event, a.cron, now, 0, [], a.max_lag))   # no API call needed
        return 0
    try:
        runs = api_runs(os.environ["GITHUB_REPOSITORY"], a.workflow, t,
                        os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN", ""),
                        os.environ.get("GITHUB_API_URL", "https://api.github.com"))
    except Exception as e:
        # Fail OPEN. Every workflow gated this way is idempotent, so a second
        # run costs a minute; a skipped tick costs readers a stale page.
        print("::warning::cron_gate could not list runs (%s); running anyway" % e)
        emit(1, "run list unavailable; running")
        return 0
    emit(*decide_tick(event, a.cron, now, os.environ.get("GITHUB_RUN_ID", "0"), runs, a.max_lag))
    return 0


# ── selftest ─────────────────────────────────────────────────────────────────
def selftest():
    fails = []

    def check(cond, what):
        print(("ok   " if cond else "FAIL ") + what)
        if not cond:
            fails.append(what)

    T = lambda s: datetime.strptime(s, "%Y-%m-%d %H:%M").replace(tzinfo=UTC)
    R = lambda i, s, c="success": {"id": i, "created_at": T(s).strftime("%Y-%m-%dT%H:%M:%SZ"), "conclusion": c}

    # cron expansion
    c = Cron("3-58/5 19-21 * * 1-5")
    check(sorted(c.mins)[:3] == [3, 8, 13] and 58 in c.mins and 0 not in c.mins, "a-b/n minute ranges")
    check(len(ticks(["*/5 19-21 * * 1-5"], T("2026-10-05 00:00"), T("2026-10-12 00:00"))) == 180,
          "*/5 19-21 Mon-Fri is 180 fires a week")
    check(ticks(["0 12 * * 7"], T("2026-10-04 00:00"), T("2026-10-05 00:00")) == [T("2026-10-04 12:00")],
          "day-of-week 7 is Sunday")
    # both day fields restricted: either matches (cron's OR rule)
    tk = ticks(["0 6 1 * 1"], T("2026-09-28 00:00"), T("2026-10-06 00:00"))
    check(tk == [T("2026-09-28 06:00"), T("2026-10-01 06:00"), T("2026-10-05 06:00")], "dom+dow is OR")
    check(ticks(["*/5 16-17 9-12 * *"], T("2026-10-08 00:00"), T("2026-10-09 23:59"))[0] == T("2026-10-09 16:00"),
          "day-of-month window")
    check(latest_tick(["15 20 * * 1"], T("2026-10-09 21:00")) == T("2026-10-05 20:15"), "latest weekly tick")
    check(max_spacing_minutes(["7,22,37,52 * * * *"]) == 15, "spacing of a 15-minute cron")
    check(max_spacing_minutes(["40 21 * * 1-5"]) == 3 * 1440, "spacing over a weekend")

    # tick decisions
    cr = ["40 21 * * 1-5"]
    now = T("2026-10-08 21:52")
    check(decide_tick("workflow_run", cr, now, 50, [R(50, "2026-10-08 21:52")], 120)[0] == 1,
          "first chained run after the tick goes")
    check(decide_tick("workflow_run", cr, now, 50,
                      [R(49, "2026-10-08 21:45"), R(50, "2026-10-08 21:52")], 120)[0] == 0,
          "a second run after the tick skips")
    check(decide_tick("workflow_run", cr, now, 50,
                      [R(49, "2026-10-08 21:45", "cancelled"), R(50, "2026-10-08 21:52")], 120)[0] == 1,
          "a cancelled pending run did not serve the tick")
    check(decide_tick("workflow_run", cr, now, 50, [R(48, "2026-10-08 21:30"), R(50, "2026-10-08 21:52")], 120)[0] == 1,
          "a run from before the tick does not count")
    check(decide_tick("workflow_run", cr, T("2026-10-09 01:00"), 50, [], 120)[0] == 0,
          "a chained run past the lag window does nothing")
    check(decide_tick("schedule", cr, T("2026-10-09 01:00"), 60,
                      [R(49, "2026-10-08 21:52"), R(60, "2026-10-09 01:00")], 120)[0] == 0,
          "a scheduled fire hours late finds its tick served and skips")
    check(decide_tick("schedule", cr, T("2026-10-09 01:00"), 60, [R(60, "2026-10-09 01:00")], 120)[0] == 1,
          "a late scheduled fire with nobody ahead of it still runs")
    check(decide_tick("workflow_dispatch", cr, now, 1, [R(0, "2026-10-08 21:41")], 120)[0] == 1,
          "a manual run always goes")
    check(decide_tick("workflow_run", cr, now, 50, [R(51, "2026-10-08 21:53"), R(50, "2026-10-08 21:52")], 120)[0] == 1,
          "a run created after this one does not block it")

    # COT
    cot = {"report_date": "October 06, 2026", "next_release": "2026-10-16"}
    old = {"report_date": "September 29, 2026", "next_release": "2026-10-09"}
    check(decide_cot("workflow_run", T("2026-10-09 18:59"), old)[0] == 0, "COT: before 19:00 UTC, no")
    check(decide_cot("workflow_run", T("2026-10-10 20:00"), old)[0] == 0, "COT: Saturday, no")
    check(decide_cot("workflow_run", T("2026-10-09 19:07"), old)[0] == 1, "COT: Friday, report not in, go")
    check(decide_cot("workflow_run", T("2026-10-09 23:52"), old)[0] == 1, "COT: Friday 23:52 still in window")
    check(decide_cot("workflow_run", T("2026-10-09 19:37"), cot)[0] == 0, "COT: Friday, report in, stop")
    check(decide_cot("schedule", T("2026-10-13 20:00"), cot)[0] == 0, "COT: Tuesday after a normal week, no")
    # holiday week: Friday release pushed to Monday
    check(decide_cot("workflow_run", T("2026-10-12 19:22"), old)[0] == 1, "COT: delayed Monday release, go")
    check(cot_target_tuesday(date(2026, 10, 9)) == date(2026, 10, 6), "Friday's target is this Tuesday")
    check(cot_target_tuesday(date(2026, 10, 12)) == date(2026, 10, 6), "Monday's target is last Tuesday")
    check(cot_target_tuesday(date(2026, 10, 8)) == date(2026, 9, 29), "Thursday's target is last week's")
    check(decide_cot("workflow_run", T("2026-10-16 19:07"), cot)[0] == 1,
          "COT: next_release day goes")
    check(decide_cot("workflow_run", T("2026-10-09 20:00"), None)[0] == 1, "COT: unreadable file probes")
    check(decide_cot("workflow_dispatch", T("2026-10-10 03:00"), cot)[0] == 1, "COT: manual always goes")

    print("\n%d failed" % len(fails) if fails else "\nall cron_gate checks passed")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
