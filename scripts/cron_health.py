#!/usr/bin/env python3
"""
cron_health.py: did the jobs readers depend on actually run?

GitHub's scheduler drops and delays fires on this repository (see the header
of scripts/cron_gate.py for the numbers), and a dropped fire leaves no trace:
no red run, no email, just a page that quietly stops moving. On 2026-10-07,
08 and 09 the COT watcher did not run once inside its window and nothing said
so until a reader noticed.

This writes data/cron-health.json: for each watched workflow, its last
successful run, the longest gap its clock allows, and whether the latest
tick of that clock was served. A tick is served when a run that started
within `max_delay` minutes of it succeeded (or is still running). For a
workflow gated by cron_gate.py the FIRST run after the tick is the one that
did the work, so that run is the one judged.

Where a workflow is gated, its clock is read from the --cron arguments of its
own gate step, so this list cannot drift from the schedule it checks.

Exit code is 0. The workflow reads `red=1` from $GITHUB_OUTPUT and fails the
run after committing, so the file always says why.

    python3 scripts/cron_health.py --out data/cron-health.json
    python3 scripts/cron_health.py --selftest
"""

import json
import os
import re
import shlex
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cron_gate import Cron, latest_tick, max_spacing_minutes, parse_ts, NOT_A_RUN  # noqa: E402

UTC = timezone.utc
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WF_DIR = os.path.join(ROOT, ".github", "workflows")
RECOMMIT_HOURS = 6

# file, clock (None = read it from the workflow's cron_gate step), max delay
# in minutes, critical (fails the run red), and what the clock is.
CHECKS = [
    ("fetch_bids.yml", ["7,22,37,52 * * * *"], 45, True,
     "cron-job.org dispatch every 15 minutes; every chained watcher hangs off this"),
    ("prices.yml", ["0,15,30,45 * * * *"], 45, True,
     "cron-job.org dispatch every 15 minutes"),
    ("price-watch.yml", ["0,15,30,45 * * * *"], 45, True,
     "runs after every Fetch Prices"),
    ("elevator-watch.yml", ["7,22,37,52 * * * *"], 45, True,
     "runs after every Fetch Grain Bids"),
    ("cot-release-watch.yml", ["7,22,37,52 19-23 * * 1-5"], 30, True,
     "after every bids and prices run, Mon-Fri 19:00-23:59 UTC"),
    ("wasde-watch.yml", ["7,22,37,52 16-17 9-12 * *"], 30, True,
     "after every Fetch Grain Bids on WASDE days, 16:00-17:59 UTC"),
    ("report-day.yml", ["47 16 * * 1-5", "13 18 * * 1-5"], 60, True,
     "after WASDE watch, What's Priced In and Fetch Grain Bids"),
    ("news.yml", None, 30, False, "chained, gated to its own schedule"),
    ("crop_progress.yml", None, 60, False, "chained, gated to its own schedule"),
    ("export_sales.yml", None, 60, False, "chained, gated to its own schedule"),
    ("price-stats.yml", None, 60, False, "chained, gated to its own schedule"),
    ("harvest-prices.yml", None, 60, False, "chained, gated to its own schedule"),
    ("freshness.yml", None, 60, False, "chained, gated to its own schedule"),
    ("state-basis-pages.yml", None, 60, False, "chained, gated to its own schedule"),
]

# The briefing is judged by what it publishes: today's archive file, by 07:30
# Central. Its runs prove nothing alone (most heartbeats skip on purpose).
BRIEFING = {"path": "data/daily-archive/{date}.json", "due_ct": "07:30", "critical": True}


def gate_crons(workflow):
    """The --cron arguments of the workflow's cron_gate.py tick step."""
    try:
        text = open(os.path.join(WF_DIR, workflow), encoding="utf-8").read()
    except OSError:
        return []
    m = re.search(r"cron_gate\.py tick((?:[^\n]|\\\n)*(?:\n\s+--[^\n]*)*)", text)
    if not m:
        return []
    args = shlex.split(m.group(1).replace("\\\n", " "))
    return [args[i + 1] for i, a in enumerate(args[:-1]) if a == "--cron"]


def judge(crons, max_delay, now, runs_after_tick, first_only):
    """(status, tick, served_by, why). runs_after_tick: runs created in
    [tick, tick + max_delay], any order."""
    t = latest_tick(crons, now - timedelta(minutes=max_delay))
    if t is None:
        return "ok", None, None, "no tick due in the last eight days"
    runs = sorted((r for r in runs_after_tick if r.get("conclusion") not in NOT_A_RUN
                   and t <= parse_ts(r["created_at"]) <= t + timedelta(minutes=max_delay)),
                  key=lambda r: (r["created_at"], int(r["id"])))
    if first_only:
        runs = runs[:1]
    good = [r for r in runs if r.get("status") != "completed" or r.get("conclusion") == "success"]
    tick = t.strftime("%Y-%m-%dT%H:%MZ")
    if good:
        return "ok", tick, good[0], "served"
    if runs:
        return "late", tick, runs[0], "the run that served the %s tick ended %s" % (
            t.strftime("%a %H:%M UTC"), runs[0].get("conclusion") or runs[0].get("status"))
    return "late", tick, None, "no run started within %d min of the %s tick" % (max_delay, t.strftime("%a %H:%M UTC"))


def briefing_status(now, root=ROOT):
    from zoneinfo import ZoneInfo
    ct = now.astimezone(ZoneInfo("America/Chicago"))
    path = BRIEFING["path"].format(date=ct.strftime("%Y-%m-%d"))
    due = ct.replace(hour=int(BRIEFING["due_ct"][:2]), minute=int(BRIEFING["due_ct"][3:]), second=0, microsecond=0)
    if os.path.exists(os.path.join(root, path)):
        return "ok", path, "published"
    if ct < due:
        return "ok", path, "not due until %s Central" % BRIEFING["due_ct"]
    return "late", path, "today's briefing is not published and it is past %s Central" % BRIEFING["due_ct"]


def _get(url, token):
    req = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github+json", "Authorization": "Bearer %s" % token,
        "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "agsist-cron-health"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode())


def collect(now, repo, token, api):
    rows, late = [], []
    for wf, crons, delay, critical, clock in CHECKS:
        crons = crons or gate_crons(wf)
        row = {"workflow": wf, "critical": critical, "clock": clock, "schedule": crons,
               "max_delay_minutes": delay}
        if not crons:
            row.update(status="unknown", why="no clock found for this workflow")
            rows.append(row)
            continue
        spacing = max_spacing_minutes(crons)
        row["expected_max_gap_minutes"] = (spacing or 0) + delay
        base = "%s/repos/%s/actions/workflows/%s/runs?per_page=100&exclude_pull_requests=true" % (api, repo, wf)
        try:
            last = _get(base.replace("per_page=100", "per_page=1") + "&status=success", token).get("workflow_runs", [])
            row["last_success"] = last[0]["created_at"] if last else None
            t = latest_tick(crons, now - timedelta(minutes=delay))
            runs = []
            if t is not None:
                rng = "%s..%s" % (t.strftime("%Y-%m-%dT%H:%M:%SZ"),
                                  (t + timedelta(minutes=delay)).strftime("%Y-%m-%dT%H:%M:%SZ"))
                runs = _get(base + "&created=" + rng, token).get("workflow_runs", [])
            status, tick, by, why = judge(crons, delay, now, runs, first_only=(wf in GATED))
        except Exception as e:
            row.update(status="unknown", why="could not read runs: %s" % e)
            rows.append(row)
            continue
        row.update(status=status, last_tick=tick, why=why,
                   served_by=({"id": by["id"], "event": by.get("event"), "created_at": by["created_at"],
                               "conclusion": by.get("conclusion") or by.get("status")} if by else None))
        rows.append(row)
        if status == "late":
            late.append(wf)
    st, path, why = briefing_status(now)
    rows.append({"workflow": "daily.yml", "critical": BRIEFING["critical"], "clock": "published by %s Central" % BRIEFING["due_ct"],
                 "check": path, "status": st, "why": why})
    if st == "late":
        late.append("daily.yml")
    # The COT page must say what data/cot.json says (2026-10-09: it did not).
    try:
        from check_cot_baked import stale_parts
        bad = stale_parts()
        row = {"workflow": "cot.html", "critical": True, "clock": "baked from data/cot.json",
               "status": "late" if bad else "ok", "why": "; ".join(bad) or "matches data/cot.json"}
    except Exception as e:
        row = {"workflow": "cot.html", "critical": True, "clock": "baked from data/cot.json",
               "status": "unknown", "why": "check could not run: %s" % e}
    rows.append(row)
    if row["status"] == "late":
        late.append("cot.html")
    return rows, late


GATED = {wf for wf, crons, *_ in CHECKS if crons is None}


def build(now, rows, late):
    crit = {r["workflow"] for r in rows if r.get("critical")}
    return {
        "generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "note": ("Written by scripts/cron_health.py. A workflow is late when the latest tick of its clock "
                 "was not served by a successful run within max_delay_minutes. Committed when a status "
                 "changes or every %d hours, so last_success can trail the live run list." % RECOMMIT_HOURS),
        "late": late,
        "late_critical": [w for w in late if w in crit],
        "workflows": rows,
    }


def should_commit(prev, doc, now):
    if not prev:
        return True
    old = {r["workflow"]: r.get("status") for r in prev.get("workflows", [])}
    new = {r["workflow"]: r.get("status") for r in doc["workflows"]}
    if old != new:
        return True
    try:
        return now - parse_ts(prev["generated_at"]) >= timedelta(hours=RECOMMIT_HOURS)
    except Exception:
        return True


def main(argv):
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--out", default="data/cron-health.json")
    p.add_argument("--selftest", action="store_true")
    a = p.parse_args(argv)
    if a.selftest:
        return selftest()
    now = datetime.now(UTC)
    rows, late = collect(now, os.environ.get("GITHUB_REPOSITORY", "dnilgis/agsist"),
                         os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN", ""),
                         os.environ.get("GITHUB_API_URL", "https://api.github.com"))
    doc = build(now, rows, late)
    try:
        prev = json.load(open(a.out))
    except Exception:
        prev = None
    commit = should_commit(prev, doc, now)
    if commit:
        with open(a.out, "w") as f:
            json.dump(doc, f, indent=1)
            f.write("\n")
    for r in rows:
        print("%-24s %-7s %s" % (r["workflow"], r["status"], r.get("why", "")))
    red = 1 if doc["late_critical"] else 0
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a") as f:
            f.write("commit=%d\nred=%d\nlate=%s\n" % (commit, red, " ".join(doc["late_critical"])))
    return 0


def selftest():
    fails = []

    def check(cond, what):
        print(("ok   " if cond else "FAIL ") + what)
        if not cond:
            fails.append(what)

    T = lambda s: datetime.strptime(s, "%Y-%m-%d %H:%M").replace(tzinfo=UTC)
    R = lambda i, s, c="success", st="completed": {"id": i, "created_at": T(s).strftime("%Y-%m-%dT%H:%M:%SZ"),
                                                   "conclusion": c if st == "completed" else None, "status": st}
    cot = ["7,22,37,52 19-23 * * 1-5"]
    # The week this was written for: nothing ran in the window.
    s, tick, _, why = judge(cot, 30, T("2026-10-09 21:33"), [], False)
    check(s == "late" and tick == "2026-10-09T20:52Z", "COT watcher silent in its window is late (%s)" % why)
    s, *_ = judge(cot, 30, T("2026-10-09 21:33"), [R(5, "2026-10-09 20:54")], False)
    check(s == "ok", "a run two minutes after the tick serves it")
    s, *_ = judge(cot, 30, T("2026-10-09 21:33"), [R(5, "2026-10-09 20:54", "failure")], False)
    check(s == "late", "a failed run does not")
    s, *_ = judge(cot, 30, T("2026-10-09 21:33"), [R(5, "2026-10-09 20:54", st="in_progress")], False)
    check(s == "ok", "a run still going counts")
    s, *_ = judge(cot, 30, T("2026-10-09 21:33"), [R(5, "2026-10-09 20:54", "cancelled"), R(6, "2026-10-09 21:00")], True)
    check(s == "ok", "a cancelled pending run is passed over for the next")
    s, *_ = judge(cot, 30, T("2026-10-10 15:00"), [R(9, "2026-10-09 23:53")], False)
    check(s == "ok", "Saturday judges Friday's last tick")
    s, *_ = judge(["40 21 * * 1-5"], 60, T("2026-10-08 23:00"),
                  [R(1, "2026-10-08 21:41", "failure"), R(2, "2026-10-08 21:52")], True)
    check(s == "late", "gated: the first run after the tick is the one judged")
    s, *_ = judge(["40 21 * * 1-5"], 60, T("2026-10-08 23:00"), [R(2, "2026-10-08 22:52")], True)
    check(s == "late", "a run outside max_delay does not serve the tick")
    check(max_spacing_minutes(cot) > 2 * 1440, "COT's max gap spans the weekend")

    # should_commit
    now = T("2026-10-09 22:00")
    doc = {"generated_at": "2026-10-09T22:00:00Z", "workflows": [{"workflow": "a", "status": "ok"}]}
    check(should_commit(None, doc, now), "first file commits")
    check(not should_commit({"generated_at": "2026-10-09T20:00:00Z", "workflows": [{"workflow": "a", "status": "ok"}]}, doc, now),
          "same status two hours later does not commit")
    check(should_commit({"generated_at": "2026-10-09T20:00:00Z", "workflows": [{"workflow": "a", "status": "late"}]}, doc, now),
          "a status change commits")
    check(should_commit({"generated_at": "2026-10-09T15:00:00Z", "workflows": [{"workflow": "a", "status": "ok"}]}, doc, now),
          "an old file commits")

    # every gated workflow in CHECKS has a gate step this can read
    for wf in sorted(GATED):
        cr = gate_crons(wf)
        ok = bool(cr)
        for c in cr:
            try:
                Cron(c)
            except Exception:
                ok = False
        check(ok, "%s: gate clock read from the workflow (%s)" % (wf, "; ".join(cr) or "none"))

    # briefing file check
    import tempfile
    d = tempfile.mkdtemp()
    os.makedirs(os.path.join(d, "data", "daily-archive"))
    check(briefing_status(T("2026-10-09 11:00"), d)[0] == "ok", "briefing not due at 06:00 CDT")
    check(briefing_status(T("2026-10-09 13:00"), d)[0] == "late", "briefing missing at 08:00 CDT is late")
    open(os.path.join(d, "data", "daily-archive", "2026-10-09.json"), "w").write("{}")
    check(briefing_status(T("2026-10-09 13:00"), d)[0] == "ok", "briefing published is ok")
    check(briefing_status(T("2026-10-10 02:00"), d)[0] == "ok", "21:00 CDT Friday still reads Friday's file")

    print("\n%d failed" % len(fails) if fails else "\nall cron_health checks passed")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
