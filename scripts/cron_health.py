#!/usr/bin/env python3
"""
cron_health.py: did the jobs readers depend on actually run?

GitHub's scheduler drops and delays fires on this repository (see the header
of scripts/cron_gate.py for the numbers), and a dropped fire leaves no trace:
no red run, no email, just a page that quietly stops moving. On 2026-10-07,
08 and 09 the COT watcher did not run once inside its window and nothing said
so until a reader noticed.

It also checks the size of what GitHub Pages publishes (scripts/check_site_budget.py
measures it): over 1 GB, Pages stops deploying and the site freezes on its last
good build, so the row warns at that script's WARN_MB and goes red at FAIL_MB.
A second row warns when any top-level folder reaches 90% of its budget there.

It watches the watchers too: daily-site-check.yml and cron-health.yml are rows,
and the saved cron-health.json going stale (the check stopped, or cannot
push) is a red row that daily-site-check.yml, on GitHub's own cron, reports
even when cron-job.org has stopped dispatching this one.

THE PRIVATE REPO (Oct 20, 2026). No page reads this file, so it lives in the
private repo dnilgis/feedbag (branch private-data) at
private/data/cron-health.json, with the raw and references branches. The
workflows unpack the last copy there with scripts/pull_raw.sh and save the new
one with scripts/push_raw.sh. Two rows watch that link, from one API call with
PRIVATE_REPO_TOKEN: private-repo-key (red when the key fails, a warning when
it expires within KEY_WARN_DAYS; GitHub sends the date in the
github-authentication-token-expiration header) and private-raw-saves (a
warning when nothing has reached the private raw branch for RAW_STALE_HOURS:
the jobs' saves are failing softly).

THE ENGINE (Oct 20, 2026). The collection code is checked out from the private
repo's engine-agsist and engine-bids branches by the "Engine checkout" step
of every job (.github/actions/engine) once the repository variable
ENGINE_MODE is private. One row, engine-checkout: red "Engine checkout
failing" when a run in dnilgis/agsist or dnilgis/bids failed at that step in
the last ENGINE_LOOKBACK_HOURS, or when ENGINE_MODE is private and the key
cannot read an engine branch; a warning when an engine branch cannot be read
while the code still runs from the public repo (do not flip until it can).

This writes private/data/cron-health.json: for each watched workflow, its last
successful run, the longest gap its clock allows, and whether the latest
tick of that clock was served. A tick is served when a run that started
within `max_delay` minutes of it succeeded (or is still running). For a
workflow gated by cron_gate.py the FIRST run after the tick is the one that
did the work, so that run is the one judged.

Where a workflow is gated, its clock is read from the --cron arguments of its
own gate step, so this list cannot drift from the schedule it checks.

Exit code is 0. The workflow reads `red=1` from $GITHUB_OUTPUT and fails the
run after committing, so the file always says why.

    python3 scripts/cron_health.py --out private/data/cron-health.json
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
# Where the file lives (unpacked from the private repo's private-data branch).
HEALTH_PATH = os.path.join("private", "data", "cron-health.json")
PRIVATE_REPO = "dnilgis/feedbag"
KEY_WARN_DAYS = 14
# The raw branch gets the Daily's fact check every day and a bid snapshot every
# weekday; 80 h covers a long weekend with one of them missing.
RAW_STALE_HOURS = 80
# The engine checkout: the branches every job copies the code from, the repos
# whose failed runs are scanned for a failed engine step, and how far back.
ENGINE_BRANCHES = ("engine-agsist", "engine-bids")
ENGINE_REPOS = ("dnilgis/agsist", "dnilgis/bids")
ENGINE_STEP = "Engine checkout"
ENGINE_LOOKBACK_HOURS = 6
ENGINE_RUNS_LOOKED_AT = 15

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
    ("arcplc-reminder.yml", ["10 14,17,20 * 11,12,2,3 *"], 120, False,
     "three times a day in Nov, Dec, Feb, Mar; mails only on an ARC/PLC deadline minus 7 days"),
    ("news.yml", None, 30, False, "chained, gated to its own schedule"),
    ("crop_progress.yml", None, 60, False, "chained, gated to its own schedule"),
    ("export_sales.yml", None, 60, False, "chained, gated to its own schedule"),
    ("price-stats.yml", None, 60, False, "chained, gated to its own schedule"),
    ("harvest-prices.yml", None, 60, False, "chained, gated to its own schedule"),
    ("freshness.yml", None, 60, False, "chained, gated to its own schedule"),
    ("lrp.yml", ["7,22,37,52 19-23 * * 1-5"], 30, False,
     "after every Fetch Grain Bids, Mon-Fri 19:00-23:59 UTC; looks for RMA's LRP offers until today's are in"),
    ("prf.yml", ["23 10 * * 3"], 240, False, "weekly PRF data refresh, Wednesdays; a full run after the August ADM takes about two hours"),
    ("prf-outlook.yml", ["47 15 * * 4", "17 11 * * 5"], 240, False, "PRF long-range outlook (CPC, ENSO, Drought Monitor), Thursdays and Fridays"),
    ("climate-indices.yml", ["37 14 9 * *"], 240, False, "NOAA PDO and AMO for the PRF optimizer test, monthly on the 9th"),
    ("county-rain.yml", ["23 13 * * 1"], 240, False, "rain so far this year by county (RCC-ACIS) and the /rain pages, Mondays"),
    ("land-alert.yml", ["47 15 3-5 * *"], 240, False,
     "the monthly land sale email (after the land data run on the 3rd; the list only once LANDSALES_MONTHLY_LIVE is 1), the 3rd with the 4th and 5th to catch up"),
    # The watchers themselves (2026-10-20). GitHub's own cron runs the site check hours
    # late (3 h and 6 h on Oct 18 and 19, nothing on Oct 17), so 8 h is the limit.
    ("daily-site-check.yml", ["37 11 * * *"], 480, False, "the morning site check and its issue, GitHub cron 11:37 UTC"),
    ("cron-health.yml", None, 60, False, "this check, after every Fetch Grain Bids, gated to every half hour"),
]

# The saved private/data/cron-health.json is rewritten at least every RECOMMIT_HOURS while
# this check runs. Older than this and the check itself stopped (or cannot push):
# daily-site-check.yml, on GitHub's cron and not cron-job.org, sees it here.
SELF_STALE_HOURS = RECOMMIT_HOURS + 2
# A top-level folder at this share of its check_site_budget.py budget gets a warn row.
FOLDER_WARN = 0.90

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


def forgive(status, by, why, last_success):
    """A tick whose run failed stays red only until the workflow succeeds again.
    Without this, one failed report-day run kept the check red every half hour
    until the next report, weeks later, long after the bug was fixed."""
    if status == "late" and by and last_success and parse_ts(last_success) > parse_ts(by["created_at"]):
        return "ok", why + "; a later run succeeded at " + last_success
    return status, why


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
            status, why = forgive(status, by, why, row["last_success"])
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
    row = self_row(now)
    rows.append(row)
    if row["status"] == "late":
        late.append(row["workflow"])
    for row in private_rows(now, os.environ.get("PRIVATE_REPO_TOKEN", "")):
        rows.append(row)
        if row["status"] == "late":
            late.append(row["workflow"])
    row = engine_row(now, os.environ.get("PRIVATE_REPO_TOKEN", ""), token, api,
                     os.environ.get("ENGINE_MODE", ""))
    rows.append(row)
    if row["status"] == "late":
        late.append(row["workflow"])
    for row in budget_rows():
        rows.append(row)
        if row["status"] == "over":
            late.append(row["workflow"])
    return rows, late


GATED = {wf for wf, crons, *_ in CHECKS if crons is None}


def self_row(now, root=ROOT):
    """Age of the saved private/data/cron-health.json (unpacked from the private
    repo before this run overwrites it)."""
    path = os.path.join(root, HEALTH_PATH)
    row = {"workflow": "cron-health.json", "critical": True,
           "clock": "rewritten at least every %d hours while the check runs" % RECOMMIT_HOURS}
    try:
        gen = parse_ts(json.load(open(path))["generated_at"])
    except Exception as e:
        row.update(status="unknown", why="could not read %s (from the private repo): %s" % (HEALTH_PATH, e))
        return row
    hours = (now - gen).total_seconds() / 3600
    row["generated_at"] = gen.strftime("%Y-%m-%dT%H:%M:%SZ")
    if hours > SELF_STALE_HOURS:
        row.update(status="late", why="%s is %.1f h old (limit %d h): the cron health check stopped "
                   "running or could not save to the private repo" % (HEALTH_PATH, hours, SELF_STALE_HOURS))
    else:
        row.update(status="ok", why="written %.1f h ago" % hours)
    return row


def _get_h(url, token):
    """JSON and response headers (the key's expiry date is a header)."""
    req = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github+json", "Authorization": "Bearer %s" % token,
        "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "agsist-cron-health"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode()), dict(r.headers.items())


def parse_expiry(v):
    """github-authentication-token-expiration: "2026-11-03 12:00:00 UTC" or "... -0500"."""
    v = (v or "").strip()
    if not v:
        return None
    for fmt, val in (("%Y-%m-%d %H:%M:%S %z", v.replace(" UTC", " +0000")), ("%Y-%m-%d %H:%M:%S", v[:19])):
        try:
            d = datetime.strptime(val, fmt)
            return (d if d.tzinfo else d.replace(tzinfo=UTC)).astimezone(UTC)
        except ValueError:
            continue
    return None


def private_key_check(now, token, get=None, api="https://api.github.com"):
    """One call with PRIVATE_REPO_TOKEN: does the key work, when does it expire,
    when did the private raw branch last get a save. Never prints the token.
    Returns {ok, why, expires (datetime or None), days_left, raw_at (datetime or None)}."""
    if not token:
        return {"ok": None, "why": "PRIVATE_REPO_TOKEN was not given to this job", "expires": None, "days_left": None, "raw_at": None}
    try:
        body, headers = (get or _get_h)("%s/repos/%s/branches/raw" % (api, PRIVATE_REPO), token)
    except Exception as e:
        code = getattr(e, "code", None)
        why = ("HTTP %s" % code) if code else type(e).__name__
        if code in (401, 403):
            why += " (expired or revoked)"
        elif code == 404:
            why += " (the key cannot see %s, or its raw branch is gone)" % PRIVATE_REPO
        return {"ok": False, "why": "Private repo key failing: %s" % why, "expires": None, "days_left": None, "raw_at": None}
    h = {k.lower(): v for k, v in (headers or {}).items()}
    exp = parse_expiry(h.get("github-authentication-token-expiration"))
    try:
        raw_at = parse_ts(body["commit"]["commit"]["committer"]["date"])
    except Exception:
        raw_at = None
    days = (exp - now).total_seconds() / 86400 if exp else None
    return {"ok": True, "why": "works", "expires": exp, "days_left": days, "raw_at": raw_at}


def private_rows(now, token, get=None):
    """private-repo-key (red when failing, warn under KEY_WARN_DAYS) and private-raw-saves."""
    c = private_key_check(now, token, get)
    key = {"workflow": "private-repo-key", "critical": True,
           "clock": "PRIVATE_REPO_TOKEN reads and writes %s; warns %d days before it expires" % (PRIVATE_REPO, KEY_WARN_DAYS)}
    saves = {"workflow": "private-raw-saves", "critical": False,
             "clock": "a save reaches the private raw branch at least every %d h" % RAW_STALE_HOURS}
    if c["ok"] is None:
        key.update(status="unknown", critical=False, why=c["why"])
        saves.update(status="unknown", why=c["why"])
        return [key, saves]
    if not c["ok"]:
        key.update(status="late", why=c["why"] + "; every save to the private repo is failing")
        saves.update(status="unknown", why="the key failed, so the branch could not be read")
        return [key, saves]
    if c["expires"]:
        key["expires"] = c["expires"].strftime("%Y-%m-%d")
        if c["days_left"] < KEY_WARN_DAYS:
            key.update(status="warn", why="Private repo key expires %s (%d days); make a new one and save it as "
                       "PRIVATE_REPO_TOKEN" % (key["expires"], max(0, int(c["days_left"]))))
        else:
            key.update(status="ok", why="works; expires %s" % key["expires"])
    else:
        key.update(status="ok", why="works; no expiry date sent")
    if c["raw_at"] is None:
        saves.update(status="unknown", why="could not read the raw branch's last commit")
    else:
        hours = (now - c["raw_at"]).total_seconds() / 3600
        saves["last_save"] = c["raw_at"].strftime("%Y-%m-%dT%H:%M:%SZ")
        if hours > RAW_STALE_HOURS:
            saves.update(status="warn", why="nothing has reached the private raw branch for %.0f h (limit %d h): "
                         "the jobs' saves are failing (see the ::warning:: lines in their runs)" % (hours, RAW_STALE_HOURS))
        else:
            saves.update(status="ok", why="last save %.0f h ago" % hours)
    return [key, saves]


def engine_row(now, key, gh_token, api="https://api.github.com", mode="", get=None, get_h=None):
    """engine-checkout: can the key read each engine branch, and did any run in
    the last ENGINE_LOOKBACK_HOURS fail at the Engine checkout step."""
    get, get_h = get or _get, get_h or _get_h
    private = (mode or "").strip() == "private"
    row = {"workflow": "engine-checkout", "critical": True, "mode": "private" if private else "in-repo",
           "clock": "every job copies the code from %s (%s) when ENGINE_MODE is private" % (PRIVATE_REPO, ", ".join(ENGINE_BRANCHES))}
    unreadable = []
    if key:
        for b in ENGINE_BRANCHES:
            try:
                get_h("%s/repos/%s/branches/%s" % (api, PRIVATE_REPO, b), key)
            except Exception as e:
                code = getattr(e, "code", None)
                unreadable.append("%s (%s)" % (b, ("HTTP %s" % code) if code else type(e).__name__))
    failed, scan_err = {}, []
    since = (now - timedelta(hours=ENGINE_LOOKBACK_HOURS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    for repo in ENGINE_REPOS:
        try:
            runs = get("%s/repos/%s/actions/runs?status=failure&per_page=%d&created=%%3E%%3D%s"
                       % (api, repo, ENGINE_RUNS_LOOKED_AT, since), gh_token).get("workflow_runs", [])
            for r in runs[:ENGINE_RUNS_LOOKED_AT]:
                jobs = get(r["jobs_url"] + "?per_page=100", gh_token).get("jobs", [])
                if any(st.get("name") == ENGINE_STEP and st.get("conclusion") == "failure"
                       for j in jobs for st in (j.get("steps") or [])):
                    k = "%s %s" % (repo.split("/")[1], r.get("path", "").split("/")[-1] or r.get("name", "?"))
                    failed[k] = failed.get(k, 0) + 1
        except Exception as e:
            scan_err.append("%s runs could not be read (%s)" % (repo, getattr(e, "code", None) or type(e).__name__))
    if failed:
        row.update(status="late", why="Engine checkout failing: %s in the last %d h; those jobs ran nothing "
                   "(check PRIVATE_REPO_TOKEN in that repository's secrets and the engine branches)"
                   % (", ".join("%s (%d run%s)" % (k, n, "" if n == 1 else "s") for k, n in sorted(failed.items())),
                      ENGINE_LOOKBACK_HOURS))
    elif unreadable and private:
        row.update(status="late", why="Engine checkout failing: the key cannot read %s; every job that runs code will fail"
                   % ", ".join(unreadable))
    elif unreadable:
        row.update(status="warn", critical=False, why="the key cannot read %s; the code still runs from the public repo, "
                   "do not set ENGINE_MODE=private until it can" % ", ".join(unreadable))
    elif not key:
        row.update(status="unknown", critical=private,
                   why="PRIVATE_REPO_TOKEN was not given to this job; no failed engine step in the last %d h" % ENGINE_LOOKBACK_HOURS)
    else:
        row.update(status="ok", why="%s readable; mode %s; no failed engine step in the last %d h"
                   % (" and ".join(ENGINE_BRANCHES), row["mode"], ENGINE_LOOKBACK_HOURS))
    if scan_err and row["status"] == "ok":
        row.update(status="unknown", why=row["why"] + "; " + "; ".join(scan_err))
    return row


def folder_row(r, SB):
    """warn when a top-level folder passes FOLDER_WARN of its check_site_budget.py budget, over
    (red) past the budget itself (the site-budget check then fails every push)."""
    near, over = [], []
    for k, mb in (r.get("folders") or {}).items():
        if k == "(root files)":
            continue
        cap = SB.FOLDER_MB.get(k, SB.DEFAULT_FOLDER_MB)
        if mb > cap:
            over.append("%s/ %s of %s MB" % (k, mb, cap))
        elif mb >= FOLDER_WARN * cap:
            near.append("%s/ %s of %s MB (%d%%)" % (k, mb, cap, int(100 * mb / cap)))
    status = "over" if over else "warn" if near else "ok"
    why = "; ".join(["over budget: " + ", ".join(over)] * bool(over) + ["near budget: " + ", ".join(near)] * bool(near)) \
        or "every folder under %d%% of its budget" % int(100 * FOLDER_WARN)
    return {"workflow": "folder-budgets", "critical": True, "status": status, "why": why,
            "clock": "scripts/check_site_budget.py FOLDER_MB; warns at %d%%" % int(100 * FOLDER_WARN)}


def budget_rows(root=ROOT, measure=None):
    """published-size and folder-budgets from one walk of the tree."""
    try:
        import check_site_budget as SB
        r = (measure or SB.measure)(root)
    except Exception as e:
        r = e
    rows = [size_row(root, measure, measured=r)]
    if not isinstance(r, Exception):
        import check_site_budget as SB
        rows.append(folder_row(r, SB))
    return rows


def size_row(root=ROOT, measure=None, measured=None):
    """The published-size row: the total GitHub Pages serves (scripts/check_site_budget.py measure(),
    one walker for the site check and this). warn past its WARN_MB, over (red) past FAIL_MB."""
    clock = "GitHub Pages stops deploying over 1024 MB"
    try:
        import check_site_budget as SB
    except ImportError as e:
        return {"workflow": "published-size", "critical": True, "clock": clock, "status": "unknown",
                "why": "scripts/check_site_budget.py could not be loaded: %s" % e}
    try:
        if isinstance(measured, Exception):
            raise measured
        r = measured if measured is not None else (measure or SB.measure)(root)
    except Exception as e:
        return {"workflow": "published-size", "critical": True, "clock": clock, "status": "unknown", "why": "could not measure: %s" % e}
    mb, warn, fail = r["total_mb"], r.get("warn_mb", SB.WARN_MB), r.get("fail_mb", SB.FAIL_MB)
    status = "over" if mb > fail else "warn" if mb > warn else "ok"
    top = ", ".join("%s %s MB" % (k, v) for k, v in list(r.get("folders", {}).items())[:4])
    why = "%s MB published (warn at %d, red at %d, Pages limit 1024); biggest: %s" % (mb, warn, fail, top)
    if r.get("over"):
        why += "; budget: " + "; ".join(r["over"][:3])
    return {"workflow": "published-size", "critical": True, "clock": clock, "status": status, "why": why,
            "total_mb": mb, "warn_mb": warn, "fail_mb": fail, "folders": dict(list(r.get("folders", {}).items())[:8])}


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
    p.add_argument("--out", default=HEALTH_PATH)
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
        os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
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
    arc = ["10 14,17,20 * 11,12,2,3 *"]
    check(latest_tick(arc, T("2026-12-04 15:00")) == T("2026-12-04 14:10"), "ARC/PLC reminder: Dec 4 judges the 14:10 UTC fire")
    check(latest_tick(arc, T("2026-10-12 15:00")) is None, "ARC/PLC reminder: no tick due in October")
    failed = R(7, "2026-10-09 18:13", "failure")
    check(forgive("late", failed, "x", "2026-10-09T21:38:00Z")[0] == "ok", "a failed tick clears once a later run succeeds")
    check(forgive("late", failed, "x", "2026-10-09T18:00:00Z")[0] == "late", "a success before the failure does not clear it")
    check(forgive("late", None, "x", "2026-10-09T21:38:00Z")[0] == "late", "a tick nobody ran stays late")

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

    # published size: warn and red lines, from a fake measure (the real walk is check_site_budget's own selftest)
    fake = lambda mb: (lambda root: {"total_mb": mb, "warn_mb": 850, "fail_mb": 900, "folders": {"data": 300.0}, "over": []})
    check(size_row(measure=fake(700))["status"] == "ok", "700 MB published is ok")
    check(size_row(measure=fake(860))["status"] == "warn", "860 MB published warns")
    check(size_row(measure=fake(905))["status"] == "over", "905 MB published is red")
    check(size_row(measure=fake(905))["critical"] and "905" in size_row(measure=fake(905))["why"], "the red row says how big")
    real = size_row()
    check(real["status"] in ("ok", "warn", "over") and real.get("total_mb", 0) > 0, "the real tree measures (%s)" % real.get("why"))

    # folder budgets: a warn row at 90% of any folder's budget, red past the budget
    import check_site_budget as SB
    ff = lambda folders: (lambda root: {"total_mb": 500, "warn_mb": 850, "fail_mb": 900, "folders": folders, "over": []})
    rows = budget_rows(measure=ff({"data": 253.9, "prf": 71.9, "rain": 53.6, "(root files)": 40.0}))
    check([r["workflow"] for r in rows] == ["published-size", "folder-budgets"], "one walk gives both size rows")
    fr = rows[1]
    check(fr["status"] == "warn" and "prf/ 71.9 of 75 MB (95%)" in fr["why"] and "rain" not in fr["why"] and "data" not in fr["why"],
          "prf at 95.9%% of 75 MB warns, rain at 89%% and data at 85%% do not (%s)" % fr["why"])
    check(folder_row({"folders": {"data": 270.0}}, SB)["status"] == "warn", "data at exactly 90% of 300 MB warns")
    check(folder_row({"folders": {"data": 269.9}}, SB)["status"] == "ok", "data just under 90% is ok")
    check(folder_row({"folders": {"newset": 23.0}}, SB)["status"] == "warn", "a folder with no named budget is held to the 25 MB default")
    o = folder_row({"folders": {"arc-plc": 151.0, "prf": 70.0}}, SB)
    check(o["status"] == "over" and "arc-plc/ 151.0 of 150 MB" in o["why"] and "prf/" in o["why"], "over budget is red and still names the near ones")
    check(folder_row({"folders": {"(root files)": 999.0}}, SB)["status"] == "ok", "root files have no folder budget")
    check(budget_rows(measure=lambda root: 1 / 0)[0]["status"] == "unknown", "a failed walk is unknown, not ok")
    check(any(r["workflow"] == "folder-budgets" for r in budget_rows()), "the real tree gives a folder-budgets row")

    # the watchers are watched
    names = [c[0] for c in CHECKS]
    check("daily-site-check.yml" in names and "cron-health.yml" in names, "daily-site-check.yml and cron-health.yml are rows")
    check(gate_crons("cron-health.yml") == ["26,56 * * * *"], "cron-health's own clock is read from its gate step")
    dsc = next(c for c in CHECKS if c[0] == "daily-site-check.yml")
    check("37 11 * * *" in open(os.path.join(WF_DIR, "daily-site-check.yml")).read() and dsc[1] == ["37 11 * * *"],
          "the site check's clock matches its workflow")
    s, *_ = judge(dsc[1], dsc[2], T("2026-10-19 20:00"), [R(3, "2026-10-19 17:42")], False)
    check(s == "ok", "the site check 6 h late (Oct 19) still serves its tick")
    s, *_ = judge(dsc[1], dsc[2], T("2026-10-17 20:00"), [], False)
    check(s == "late", "no site check by 19:37 UTC (Oct 17) is late")
    d2 = tempfile.mkdtemp()
    os.makedirs(os.path.join(d2, "private", "data"))
    check(self_row(T("2026-10-20 12:00"), d2)["status"] == "unknown", "no file: unknown")
    json.dump({"generated_at": "2026-10-20T05:00:00Z"}, open(os.path.join(d2, "private", "data", "cron-health.json"), "w"))
    check(self_row(T("2026-10-20 12:00"), d2)["status"] == "ok", "7 h old file is ok (rewritten every 6 h)")
    st = self_row(T("2026-10-20 14:00"), d2)
    check(st["status"] == "late" and st["critical"] and "9.0 h old" in st["why"], "9 h old file: the check itself stopped (%s)" % st["why"])

    # the private repo key: one call, the expiry header, the raw branch's last save
    import urllib.error
    now = T("2026-10-20 12:00")
    TOK = "github_pat_" + "x" * 20

    def fake(exp, raw="2026-10-20T03:00:00Z", fail=None):
        def get(url, token):
            assert token == TOK and url.endswith("/repos/dnilgis/feedbag/branches/raw"), url
            if fail:
                raise urllib.error.HTTPError(url, fail, "x", {}, None)
            return {"commit": {"commit": {"committer": {"date": raw}}}}, \
                ({"GitHub-Authentication-Token-Expiration": exp} if exp else {})
        return get
    k, sv = private_rows(now, TOK, fake("2027-01-15 12:00:00 UTC"))
    check(k["status"] == "ok" and k["expires"] == "2027-01-15" and sv["status"] == "ok", "a working key far from expiry is ok (%s)" % k["why"])
    k, _ = private_rows(now, TOK, fake("2026-10-30 07:00:00 -0500"))
    check(k["status"] == "warn" and "Private repo key expires 2026-10-30 (10 days)" in k["why"], "10 days left warns (%s)" % k["why"])
    k, sv = private_rows(now, TOK, fake(None, fail=401))
    check(k["status"] == "late" and k["critical"] and k["why"].startswith("Private repo key failing: HTTP 401"), "a refused key is red (%s)" % k["why"])
    check(TOK not in json.dumps([k, sv]), "the token is never in a row")
    k, _ = private_rows(now, TOK, fake(None, fail=404))
    check(k["status"] == "late" and "cannot see dnilgis/feedbag" in k["why"], "404 says the key cannot see the repo")
    _, sv = private_rows(now, TOK, fake("2027-01-15 12:00:00 UTC", raw="2026-10-16T12:00:00Z"))
    check(sv["status"] == "warn" and "96 h" in sv["why"], "no save on raw for 96 h warns (%s)" % sv["why"])
    k, sv = private_rows(now, "", None)
    check(k["status"] == "unknown" and not k["critical"] and sv["status"] == "unknown", "no token in the job: unknown, not red")
    check(parse_expiry("2026-11-03 12:00:00 UTC") == datetime(2026, 11, 3, 12, tzinfo=UTC), "expiry header in UTC")
    check(parse_expiry("2026-11-03 07:00:00 -0500") == datetime(2026, 11, 3, 12, tzinfo=UTC), "expiry header with an offset")
    check(parse_expiry("") is None and parse_expiry("soon") is None, "no or odd header: no date")
    # the engine checkout: branch reads with the key, failed runs scanned for a failed engine step
    GHT = "ghs_" + "y" * 20

    def eng(branch_fail=None, runs=None, jobs=None, runs_fail=None):
        asked = []

        def get_h(url, token):
            asked.append(url)
            assert token == TOK and "/repos/dnilgis/feedbag/branches/engine-" in url, url
            if branch_fail and url.endswith(branch_fail[0]):
                raise urllib.error.HTTPError(url, branch_fail[1], "x", {}, None)
            return {}, {}

        def get(url, token):
            asked.append(url)
            assert token == GHT, url
            if "/actions/runs?" in url:
                assert "status=failure" in url and "created=%3E%3D2026-10-20T06:00:00Z" in url, url
                if runs_fail:
                    raise urllib.error.HTTPError(url, runs_fail, "x", {}, None)
                repo = url.split("/repos/")[1].split("/actions")[0]
                return {"workflow_runs": (runs or {}).get(repo, [])}
            return {"jobs": (jobs or {}).get(url.split("?")[0], [])}
        return get, get_h, asked

    def run(rid, path):
        return {"jobs_url": "https://api/jobs/%d" % rid, "path": ".github/workflows/%s" % path, "name": path}
    step = lambda name, c: {"name": name, "conclusion": c}
    g1, h1, asked = eng()
    r = engine_row(now, TOK, GHT, "https://api.github.com", "", g1, h1)
    check(r["status"] == "ok" and "engine-agsist and engine-bids readable; mode in-repo" in r["why"], "engine ok (%s)" % r["why"])
    check(sum("/branches/engine-" in u for u in asked) == 2, "both engine branches are read (%s)" % asked)
    g1, h1, _ = eng(runs={"dnilgis/bids": [run(1, "poll.yml"), run(2, "poll.yml"), run(3, "tidy.yml")]},
                    jobs={"https://api/jobs/1": [{"steps": [step("Set up job", "success"), step("Engine checkout", "failure")]}],
                          "https://api/jobs/2": [{"steps": [step("Engine checkout", "failure")]}],
                          "https://api/jobs/3": [{"steps": [step("Engine checkout", "success"), step("tidy", "failure")]}]})
    r = engine_row(now, TOK, GHT, "https://api.github.com", "private", g1, h1)
    check(r["status"] == "late" and r["critical"] and r["why"].startswith("Engine checkout failing: bids poll.yml (2 runs)")
          and "tidy" not in r["why"], "a failed engine step in bids is red, other failures are not counted (%s)" % r["why"])
    g1, h1, _ = eng(branch_fail=("engine-bids", 404))
    r = engine_row(now, TOK, GHT, "https://api.github.com", "private", g1, h1)
    check(r["status"] == "late" and "cannot read engine-bids (HTTP 404)" in r["why"], "private mode, unreadable branch: red (%s)" % r["why"])
    r = engine_row(now, TOK, GHT, "https://api.github.com", "", g1, h1)
    check(r["status"] == "warn" and not r["critical"] and "do not set ENGINE_MODE=private" in r["why"],
          "in-repo mode, unreadable branch: a warning, not red (%s)" % r["why"])
    g1, h1, _ = eng(runs_fail=403)
    r = engine_row(now, TOK, GHT, "https://api.github.com", "", g1, h1)
    check(r["status"] == "unknown" and "runs could not be read (403)" in r["why"], "runs unreadable: unknown (%s)" % r["why"])
    check(TOK not in json.dumps(r) and GHT not in json.dumps(r), "no token in the engine row")
    wf = open(os.path.join(WF_DIR, "cron-health.yml")).read()
    check("ENGINE_MODE: ${{ vars.ENGINE_MODE }}" in wf, "cron-health.yml tells the check the engine mode")
    check("PRIVATE_REPO_TOKEN: ${{ secrets.PRIVATE_REPO_TOKEN }}" in wf and "--out private/data/cron-health.json" in wf,
          "cron-health.yml gives the check the key and writes the private copy")

    print("\n%d failed" % len(fails) if fails else "\nall cron_health checks passed")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
