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

READER EMAIL DELIVERED (Nov 3, 2026; BUILD-RULES 55 and 56). A green run is not a delivered
email: rp-design-email and rp-buyer-email ran dry for two weeks with their live variable at 1.
One row per workflow that mails readers, "delivery:<workflow>", from scripts/delivery_check.py:
it reads the DELIVERY line each sender prints (scripts/delivery_line.py) from the run logs, and
is late when a live switch is on and a scheduled run printed dry=1, when readers waited a day and
none got mail, when a job only the subs worker starts was not started in 14 days while its asks
or paid orders are above 0, when a send step ran with no line, when a due send (the Daily by 07:15
Central, a gated sender's tick) did not happen, or when a live run mailed none of its waiting readers.
It finds the runs that sent from each run's jobs, not from the newest few (Nov 4: the Daily sends in
one run of about 81 a day). The logs are read once per DELIVERY_EVERY_HOURS (the last pass is kept
in this file as delivery_checked_at), and the switches come from the repository variables
cron-health.yml passes as env.

THE MAIL PLAN'S DAILY CAP (Nov 4, 2026). Every sender goes through one Brevo SMTP account, 300 emails a
day on the free plan, reset at 00:00 UTC (Nov 4: 211 used). One row, send-volume (critical), built in the
same pass as the delivery rows from the logs that pass already reads (scripts/send_cap.py; no API call of its
own): emails per UTC day (each DELIVERY line's smtp=, else sent_readers=) against the cap, the repository
variable SEND_DAILY_CAP (default 300; cron-health.yml passes it). A warning at 80%, red at 95%, and red on a
SEND-CAP marker: a refusal that looks like the cap, or a sender's preflight that projected past it. The count
is a floor (sampled senders and Sig-only mail are not all counted) and the row says so.

THE ENGINE (Oct 20, 2026). The collection code is checked out from the private
repo's engine-agsist and engine-bids branches by the "Engine checkout" step
of every job (.github/actions/engine) once the repository variable
ENGINE_MODE is private. One row, engine-checkout: red "Engine checkout
failing" when a run in dnilgis/agsist or dnilgis/bids failed at that step in
the last ENGINE_LOOKBACK_HOURS, or when ENGINE_MODE is private and the key
cannot read an engine branch; a warning when an engine branch cannot be read
while the code still runs from the public repo (do not flip until it can).

ENGINE DRIFT (Nov 4, 2026; BUILD-RULES 63). Engine sync is part of every merge that touches scripts/,
test/ or build/: on Nov 3 the engine copy was missing the Daily's new safety checks for hours. One row,
engine-drift: the engine-agsist branch of the private repo (one tree call with PRIVATE_REPO_TOKEN) against
this checkout's HEAD (git ls-tree), the paths in .github/engine-paths, compared by git blob hash only. No
file name or content is printed or saved: the row keeps a short hash of each differing path and when it was
first seen differing. A warning while files differ, red once any has differed for more than
ENGINE_DRIFT_HOURS. A file only in the engine is counted apart: an engine sync (engine.sh save) would delete
it, so .github/workflows/engine-sync.yml refuses to run until the lead looks.

THE COMMIT GUARD (Nov 4, 2026). Every job's commit leaves out a new data/ file dated more than 2 days
ahead (.github/actions/engine/engine.sh hook; a test's made-up day, data/daily-sent/2099-01-01.json,
once reached main). A warning on a green data job is read by nobody, so the hook also writes the line
"COMMIT-GUARD dropped=N path=<first path>" into the commit's message. One row, commit-guard: red when
a commit on main in the last COMMIT_GUARD_HOURS carries that line (one commit list call per 100
commits, up to COMMIT_GUARD_PAGES; reading run logs or annotations would cost a call per run). Merge
commits and pull request merges ("(#N)" in the subject) are not read: only a job's own commit says
what its hook did. A commit the hook refused (nothing left) makes no commit; that job's commit step
fails, a red run of its own. More commits than the pages hold, with none found, is unknown, not ok.

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
from cron_gate import Cron, latest_tick, max_spacing_minutes, parse_ts, NOT_A_RUN, ALWAYS_GO  # noqa: E402

# Workflows whose gate does not count a run by hand as the tick's run (cron_gate.py
# MANUAL_DOES_NOT_SERVE, Nov 2, 2026). Kept here too, so this file runs beside an older
# copy of cron_gate.py; the selftest holds the two lists equal when both have it.
MANUAL_DOES_NOT_SERVE = {"rain-monthly.yml", "land-alert.yml", "arcplc-reminder.yml", "county-rain.yml"} | {
    # gated Nov 3, 2026 (cron_gate.py GATED_NOV3)
    "agstocks.yml", "analyst-scorecard.yml", "cash-bid-index.yml", "cash-rent.yml", "cattle-auction.yml",
    "cattle-cash.yml", "ccc-loan.yml", "climate-indices.yml", "cot-deep-rebuild.yml", "coverage-map.yml",
    "dairy.yml", "drought-county-week.yml", "fall-nitrogen.yml", "farmland-atlas.yml", "fertilizer-ams.yml",
    "fertilizer-coops.yml", "fetch-fsa-arcplc.yml", "hail-data.yml", "hail-states.yml", "hay-ams.yml",
    "hay-prices.yml", "land-data.yml", "list-hygiene.yml", "markets.yml", "mesh.yml", "nass-series.yml",
    "ncei.yml", "planting-normals.yml", "predictions.yml", "prf-outlook.yml", "prf-season.yml", "prf.yml",
    "radar-rain.yml", "refs.yml", "rma-prices.yml", "rp-canada-stations.yml", "rp-design-email.yml",
    "seasonal-models.yml", "share-images.yml", "site-usage.yml", "sitemap.yml", "sponsor-report.yml",
    "state-rent-pages.yml", "stats-ingest.yml", "storage.yml", "tenure.yml", "transport.yml", "vintage.yml",
    "whats-priced-in.yml",
    # gated Nov 4, 2026 (BUILD-RULES 59)
    "main-checks.yml",
    # gated Nov 7, 2026: the weekly Schrader auction results capture
    "schrader-capture.yml",
}
# Gated rows whose gate runs on a denser clock than GitHub's fallback cron, on purpose.
DENSER_GATE = {"news.yml", "cron-health.yml"}

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
COMMIT_GUARD_HOURS = 24     # the commit-guard row reads main's commits of the last 24 h
COMMIT_GUARD_PAGES = 8      # 100 commits a page; main took about 450 a day on Nov 4, 2026
COMMIT_GUARD_RE = re.compile(r"COMMIT-GUARD dropped=(\d+) path=(\S+)")
ENGINE_RUNS_LOOKED_AT = 15
ENGINE_DRIFT_HOURS = 2       # engine-drift is red once a file has differed from main this long (BUILD-RULES 63)
ENGINE_DRIFT_BRANCH = "engine-agsist"

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
    # Gated since Nov 2, 2026 (GitHub's scheduler started neither monthly email that day): the four
    # mail and rain rows read their clock from their own gate step, and a run by hand is not judged
    # as the tick's run (cron_gate.py MANUAL_DOES_NOT_SERVE).
    ("arcplc-reminder.yml", None, 60, False,
     "chained, gated to three times a day in Nov, Dec, Feb, Mar; mails only on an ARC/PLC deadline minus 7 days"),
    ("news.yml", None, 30, False, "chained, gated to its own schedule"),
    ("crop_progress.yml", None, 60, False, "chained, gated to its own schedule"),
    ("export_sales.yml", None, 60, False, "chained, gated to its own schedule"),
    ("price-stats.yml", None, 60, False, "chained, gated to its own schedule"),
    ("harvest-prices.yml", None, 60, False, "chained, gated to its own schedule"),
    ("freshness.yml", None, 60, False, "chained, gated to its own schedule"),
    ("lrp.yml", ["7,22,37,52 19-23 * * 1-5"], 30, False,
     "after every Fetch Grain Bids, Mon-Fri 19:00-23:59 UTC; looks for RMA's LRP offers until today's are in"),
    # Daily since Oct 23, 2026 (was Mondays): a missed day is late by the next morning, not a week later.
    ("county-rain.yml", None, 60, False,
     "chained, gated: rain so far this year by county (RCC-ACIS) and the /rain pages, every day, plus the Jan 2 finished-year run"),
    ("rain-monthly.yml", None, 60, False,
     "chained, gated: the monthly county rain email (fetch, pages, then the list once RAIN_MONTHLY_LIVE is 1), the 2nd of each month"),
    ("land-alert.yml", None, 60, False,
     "chained, gated: the monthly land sale email (after the land data run on the 3rd; the list only once LANDSALES_MONTHLY_LIVE is 1), the 3rd of each month"),
    # Gated Nov 3, 2026 (GitHub's scheduler never started land-data.yml that day, so the land sale
    # email mailed nobody): every data, page and email workflow whose schedule matters runs after
    # Fetch Grain Bids, gated to its own schedule; a run by hand or a push is not the tick's run.
    ("land-data.yml", None, 60, False, "chained, gated: monthly land data on the 3rd (parcel services, IL/WI/VT/NJ transfers, sale pages); the land sale email reads it"),
    ("cash-bid-index.yml", None, 60, False, "chained, gated: the Cash Bid Index, monthly on the 1st"),
    ("ccc-loan.yml", None, 60, False, "chained, gated: CCC loan rates, the 1st to 5th and the 15th"),
    ("climate-indices.yml", None, 60, False, "chained, gated: NOAA PDO and AMO for the PRF optimizer test, monthly on the 9th"),
    ("dairy.yml", None, 60, False, "chained, gated: milk prices and the milk price day email, the announcement windows"),
    ("farmland-atlas.yml", None, 60, False, "chained, gated: the Farmland Atlas data, monthly on the 12th"),
    ("hail-data.yml", None, 60, False, "chained, gated: the national hail map data, monthly on the 1st"),
    ("hail-states.yml", None, 60, False, "chained, gated: the hail state pages, monthly on the 2nd"),
    ("hay-prices.yml", None, 60, False, "chained, gated: NASS hay prices, month end and the 1st and 2nd"),
    ("nass-series.yml", None, 60, False, "chained, gated: NASS series revisions, monthly on the 16th"),
    ("refs.yml", None, 60, False, "chained, gated: the reference library, monthly on the 3rd"),
    ("rp-canada-stations.yml", None, 60, False, "chained, gated: Rain Print Canada stations, monthly on the 3rd"),
    ("site-usage.yml", None, 60, False, "chained, gated: site usage for the audit, monthly on the 2nd"),
    ("ncei.yml", None, 60, False, "chained, gated: the long-term hail record, yearly on Jan 15"),
    ("planting-normals.yml", None, 60, False, "chained, gated: planting date station normals, yearly on Feb 2"),
    ("tenure.yml", None, 60, False, "chained, gated: Census land tenure, yearly on Feb 15"),
    ("storage.yml", None, 60, False, "chained, gated: grain storage vs production, after the Jan, Oct and Nov reports"),
    ("seasonal-models.yml", None, 60, False, "chained, gated: seasonal forecast models, Nov 15 and Dec 15"),
    ("cash-rent.yml", None, 60, False, "chained, gated: NASS county cash rent, Wednesdays (works in Aug and Sep)"),
    ("state-rent-pages.yml", None, 60, False, "chained, gated: the /rent state pages, Wednesdays after cash rent"),
    ("cot-deep-rebuild.yml", None, 60, False, "chained, gated: the COT deep history rebuild, Sundays"),
    ("drought-county-week.yml", None, 60, False, "chained, gated: the drought county week, Thursday and a Friday backstop"),
    ("fertilizer-ams.yml", None, 60, False, "chained, gated: USDA AMS fertilizer series, Friday, Friday evening and Monday"),
    ("fetch-fsa-arcplc.yml", None, 60, False, "chained, gated: FSA ARC/PLC program files, Mondays"),
    ("schrader-capture.yml", None, 60, False, "chained, gated: Schrader auction results capture and read, Mondays"),
    ("prf.yml", None, 60, False, "chained, gated: the PRF rainfall index data, Wednesdays"),
    ("prf-outlook.yml", None, 60, False, "chained, gated: the PRF long-range outlook, Thursdays and Fridays"),
    ("transport.yml", None, 60, False, "chained, gated: AgTransport for /basis and /bushel-journey, Fridays"),
    ("agstocks.yml", None, 60, False, "chained, gated: ag stocks closes and filings, weekday evenings"),
    ("analyst-scorecard.yml", None, 60, False, "chained, gated: the analyst scorecard, daily"),
    ("cattle-auction.yml", None, 60, False, "chained, gated: cattle auction prices, weekday mornings and evenings"),
    ("cattle-cash.yml", None, 60, False, "chained, gated: cattle cash prices, weekday afternoons and the weekly 5-area"),
    ("coverage-map.yml", None, 60, False, "chained, gated: the elevator coverage map, daily"),
    ("fall-nitrogen.yml", None, 60, False, "chained, gated: soil temperature for /fall-nitrogen, twice daily in spring and fall"),
    ("fertilizer-coops.yml", None, 60, False, "chained, gated: co-op posted fertilizer prices, weekday mornings"),
    ("hay-ams.yml", None, 60, False, "chained, gated: AMS hay market reports, weekday evenings and Saturday"),
    ("list-hygiene.yml", None, 60, False, "chained, gated: email list cleanup (bounces), daily"),
    ("markets.yml", None, 60, False, "chained, gated: markets data, daily"),
    ("mesh.yml", None, 60, False, "chained, gated: radar hail swaths for the previous day, daily"),
    ("predictions.yml", None, 60, False, "chained, gated: the prediction bot calls and grades, weekday afternoons"),
    ("prf-season.yml", None, 60, False, "chained, gated: the PRF interval so far, daily"),
    ("radar-rain.yml", None, 60, False, "chained, gated: MRMS radar rain by state, four times a day"),
    ("rma-prices.yml", None, 60, False, "chained, gated: RMA price discovery, daily after settle"),
    ("rp-design-email.yml", None, 60, False, "chained, gated: Rain Print design emails readers asked for, hourly"),
    ("share-images.yml", None, 60, False, "chained, gated: every page's share image, daily"),
    ("sitemap.yml", None, 60, False, "chained, gated: sitemap lastmod for data-driven pages, daily"),
    ("sponsor-report.yml", None, 60, False, "chained, gated: sponsor reports from GA4, daily"),
    ("stats-ingest.yml", None, 60, False, "chained, gated: GA4, Search Console and Bing raw numbers (private), daily"),
    ("vintage.yml", None, 60, False, "chained, gated: the point-in-time archive of outside data, weekdays (a missed day is lost)"),
    ("whats-priced-in.yml", None, 60, False, "chained, gated: What's Priced In, daily"),
    # The watchers themselves (2026-10-20). GitHub's own cron runs the site check hours
    # late (3 h and 6 h on Oct 18 and 19, nothing on Oct 17), so 8 h is the limit.
    ("daily-site-check.yml", ["37 11 * * *"], 480, False, "the morning site check and its issue, GitHub cron 11:37 UTC"),
    ("cron-health.yml", None, 60, False, "this check, after every Fetch Grain Bids, gated to every half hour"),
    # The full suite on main (Oct 29, 2026): a red run opens the "main is red" issue itself; this row
    # catches the suite not running at all. Chained and gated every two hours since Nov 4 (BUILD-RULES 59).
    ("main-checks.yml", None, 100, False, "every test on main, every two hours on the chain and after each merge"),
]

# The saved private/data/cron-health.json is rewritten at least every RECOMMIT_HOURS while
# this check runs. Older than this and the check itself stopped (or cannot push):
# daily-site-check.yml, on GitHub's cron and not cron-job.org, sees it here.
SELF_STALE_HOURS = RECOMMIT_HOURS + 2
# A top-level folder at this share of its check_site_budget.py budget gets a warn row.
FOLDER_WARN = 0.90

# The briefing is judged by what reached the list: today's sent copy, by 07:15
# Central (Sig, Nov 3 2026: published is not sent; that morning the issue was
# published by a manual dry run and mailed to nobody until 7:48). Its runs
# prove nothing alone (most heartbeats skip on purpose). The email to Sig at
# 7:15 is scripts/daily_late.py; this row is the same fact in the health file.
BRIEFING = {"path": "data/daily-sent/{date}.json", "published": "data/daily-archive/{date}.json",
            "due_ct": "07:15", "critical": True}


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


def judge(crons, max_delay, now, runs_after_tick, first_only, manual_serves=True):
    """(status, tick, served_by, why). runs_after_tick: runs created in
    [tick, tick + max_delay], any order. manual_serves=False: runs started by
    hand are not the tick's run (the gate passes them over too)."""
    t = latest_tick(crons, now - timedelta(minutes=max_delay))
    if t is None:
        return "ok", None, None, "no tick due in the last eight days"
    runs = sorted((r for r in runs_after_tick if r.get("conclusion") not in NOT_A_RUN
                   and (manual_serves or r.get("event") not in ALWAYS_GO)
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


def forgive(status, by, why, last_success, tick=None):
    """A late tick stays red only until the workflow succeeds again.
    Without this, one failed report-day run kept the check red every half hour
    until the next report, weeks later, long after the bug was fixed.
    The same holds for a tick nobody ran (Nov 1, 2026): the chained runs went
    missing from the runs list Fri Oct 30 16:31 to Sat 15:45 UTC, the chain was
    back by Saturday afternoon, and still report-day.yml and cot-release-watch.yml
    stayed red every half hour until their next weekday tick (two alert emails an
    hour all weekend). While nothing has succeeded since the tick, it stays red."""
    if status != "late" or not last_success:
        return status, why
    since = by["created_at"] if by else (tick and tick.replace("Z", ":00Z"))
    if since and parse_ts(last_success) > parse_ts(since):
        return "ok", why + "; a later run succeeded at " + last_success
    return status, why


def briefing_status(now, root=ROOT):
    from zoneinfo import ZoneInfo
    ct = now.astimezone(ZoneInfo("America/Chicago"))
    path = BRIEFING["path"].format(date=ct.strftime("%Y-%m-%d"))
    due = ct.replace(hour=int(BRIEFING["due_ct"][:2]), minute=int(BRIEFING["due_ct"][3:]), second=0, microsecond=0)
    if os.path.exists(os.path.join(root, path)):
        return "ok", path, "sent"
    if ct < due:
        return "ok", path, "not due until %s Central" % BRIEFING["due_ct"]
    if os.path.exists(os.path.join(root, BRIEFING["published"].format(date=ct.strftime("%Y-%m-%d")))):
        return "late", path, "today's briefing is published but not sent, and it is past %s Central" % BRIEFING["due_ct"]
    return "late", path, "today's briefing is not sent (not even published) and it is past %s Central" % BRIEFING["due_ct"]


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
            status, tick, by, why = judge(crons, delay, now, runs, first_only=(wf in GATED),
                                          manual_serves=wf not in MANUAL_DOES_NOT_SERVE)
            status, why = forgive(status, by, why, row["last_success"], tick)
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
    rows.append({"workflow": "daily.yml", "critical": BRIEFING["critical"], "clock": "sent by %s Central" % BRIEFING["due_ct"],
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
    row = commit_guard_row(now, repo, token, api)
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


def commit_guard_row(now, repo, token, api="https://api.github.com", get=None):
    """commit-guard: did any job's commit on main in the last COMMIT_GUARD_HOURS leave a future-dated
    data file out (the hook's COMMIT-GUARD line in its message)?"""
    get = get or _get
    row = {"workflow": "commit-guard", "critical": True,
           "clock": "no job's commit on main leaves a future-dated data file out (last %d h)" % COMMIT_GUARD_HOURS}
    since = (now - timedelta(hours=COMMIT_GUARD_HOURS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    hits, n, full, err = [], 0, False, None
    try:
        for page in range(1, COMMIT_GUARD_PAGES + 1):
            cs = get("%s/repos/%s/commits?sha=main&since=%s&per_page=100&page=%d" % (api, repo, since, page), token)
            for c in cs or []:
                n += 1
                msg = ((c.get("commit") or {}).get("message") or "")
                if len(c.get("parents") or []) > 1 or re.search(r"\(#\d+\)\s*$", msg.split("\n", 1)[0]):
                    continue
                for line in msg.splitlines():
                    m = COMMIT_GUARD_RE.fullmatch(line.strip())
                    if m:
                        when = ((c.get("commit") or {}).get("committer") or {}).get("date") or "?"
                        hits.append((when, (c.get("sha") or "?")[:10], int(m.group(1)), m.group(2)))
            full = len(cs or []) >= 100
            if not full:
                break
    except Exception as e:
        err = "main's commits could not be read (%s)" % (getattr(e, "code", None) or type(e).__name__)
        if not hits:     # a drop already found stays red; a later page that fails only adds to the why
            row.update(status="unknown", why=err)
            return row
    row["commits_read"] = n
    if hits:
        hits.sort(reverse=True)
        when, sha, k, path = hits[0]
        row.update(status="late", why="%d commit(s) on main in the last %d h left %d future-dated data file(s) out; newest %s "
                   "at %s left out %s. Add the file to .github/future-dated-data.txt with a reason if it is real, or fix "
                   "the test that wrote it" % (len(hits), COMMIT_GUARD_HOURS, sum(h[2] for h in hits), sha, when, path)
                   + ("; then %s, so there may be more" % err if err else ""))
    elif full:
        row.update(status="unknown", why="read %d commits of the last %d h and there are more; none left a file out so far"
                   % (n, COMMIT_GUARD_HOURS))
    else:
        row.update(status="ok", why="no commit on main in the last %d h left a file out (%d read)" % (COMMIT_GUARD_HOURS, n))
    return row


def engine_paths(root=ROOT):
    """(repo, branch, [paths]) from .github/engine-paths"""
    repo, branch, paths = PRIVATE_REPO, ENGINE_DRIFT_BRANCH, []
    with open(os.path.join(root, ".github", "engine-paths"), encoding="utf-8") as fh:
        for line in fh:
            f = line.split()
            if len(f) == 2 and f[0] == "repo":
                repo = f[1]
            elif len(f) == 2 and f[0] == "branch":
                branch = f[1]
            elif len(f) == 2 and f[0] == "path":
                paths.append(f[1].strip("/"))
    return repo, branch, paths


def main_blobs(paths, root=ROOT):
    """{path: blob hash} of HEAD under the engine paths (the commit, never the working tree)"""
    import subprocess
    r = subprocess.run(["git", "-C", root, "ls-tree", "-r", "HEAD", "--"] + paths, capture_output=True, text=True, check=True)
    out = {}
    for line in r.stdout.splitlines():
        meta, _, path = line.partition("\t")
        f = meta.split()
        if len(f) == 3 and f[1] == "blob":
            out[path] = f[2]
    return out


def _pkey(path):
    import hashlib
    return hashlib.sha256(path.encode("utf-8")).hexdigest()[:16]


def drift_row(now, key, prev=None, api="https://api.github.com", root=ROOT, get_h=None, blobs=None):
    """engine-drift: files under the engine paths whose blob hash differs between the engine branch and HEAD.
    prev: the last saved document (its engine-drift row keeps when each differing path was first seen)."""
    get_h = get_h or _get_h
    row = {"workflow": "engine-drift", "critical": True,
           "clock": "the engine branch matches main's engine paths within %d h of a merge (BUILD-RULES 63)" % ENGINE_DRIFT_HOURS}
    if not key:
        row.update(status="unknown", critical=False, why="PRIVATE_REPO_TOKEN was not given to this job")
        return row
    try:
        repo, branch, paths = engine_paths(root)
        mine = blobs if blobs is not None else main_blobs(paths, root)
        body, _ = get_h("%s/repos/%s/git/trees/%s?recursive=1" % (api, repo, branch), key)
    except Exception as e:
        code = getattr(e, "code", None)
        row.update(status="unknown", why="could not compare: %s" % (("HTTP %s" % code) if code else type(e).__name__))
        return row
    if (body or {}).get("truncated"):
        row.update(status="unknown", why="the engine tree came back truncated; not compared")
        return row
    eng = {t["path"]: t.get("sha") for t in (body or {}).get("tree", [])
           if t.get("type") == "blob" and any(t["path"].startswith(p + "/") for p in paths)}
    if not eng:
        row.update(status="unknown", why="the engine branch has no file under %s" % ", ".join(paths))
        return row
    only_main = [p for p in mine if p not in eng]
    only_eng = [p for p in eng if p not in mine]
    changed = [p for p in mine if p in eng and mine[p] != eng[p]]
    old = {}
    for r in (prev or {}).get("workflows", []):
        if r.get("workflow") == "engine-drift":
            old = r.get("since") or {}
    stamp = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    since = {}
    for p in only_main + only_eng + changed:
        k = _pkey(p)
        since[k] = old.get(k) or stamp
    row.update(compared=len(set(mine) | set(eng)), differ=len(changed), only_main=len(only_main),
               only_engine=len(only_eng), since=since)
    if not since:
        row.update(status="ok", why="%d files match %s (blob hashes)" % (row["compared"], branch))
        return row
    try:
        hours = max((now - parse_ts(t)).total_seconds() / 3600 for t in since.values())
    except Exception:
        hours = 0.0
    what = "%d changed, %d only on main, %d only in the engine" % (len(changed), len(only_main), len(only_eng))
    tail = ("; a file only in the engine is deleted by a sync, so engine-sync.yml refuses: look at it by hand"
            if only_eng else "; run the engine sync (engine-sync.yml, or engine.sh save from a clean main)")
    if hours > ENGINE_DRIFT_HOURS:
        row.update(status="late", why="Engine out of date with main for %.1f h (limit %d h): %s%s" % (hours, ENGINE_DRIFT_HOURS, what, tail))
    else:
        row.update(status="warn", why="engine differs from main for %.1f h (red past %d h): %s%s" % (hours, ENGINE_DRIFT_HOURS, what, tail))
    return row


def add_drift_row(now, rows, late, prev, environ=None, **kw):
    """the engine-drift row, fail soft (a broken check is one unknown row)"""
    environ = os.environ if environ is None else environ
    rows, late = list(rows), list(late)
    try:
        r = drift_row(now, environ.get("PRIVATE_REPO_TOKEN", ""), prev,
                      environ.get("GITHUB_API_URL", "https://api.github.com"), **kw)
    except Exception as e:
        r = {"workflow": "engine-drift", "critical": False, "clock": "engine matches main", "status": "unknown",
             "why": "check could not run: %s" % type(e).__name__}
    rows.append(r)
    if r.get("status") == "late":
        late.append(r["workflow"])
    return rows, late


def prediction_calls_row(now, root=ROOT, path=os.path.join("data", "prediction" + "s.json")):
    """prediction-calls: the bot's weekly calls were made. From 5:30 PM Central on an entry day, a
    crop with no call and no recorded reason is red (the run can still be started by hand until
    6:55 PM). A call recorded as missed stays red for two days after its entry day. The day and
    report come from the file the bot writes, so a run that never came leaves the date behind."""
    from zoneinfo import ZoneInfo
    base = {"workflow": "prediction-calls", "critical": True, "clock": "a call for every crop on its entry day"}
    try:
        d = json.load(open(os.path.join(root, path), encoding="utf-8"))
        ne = d.get("next_entry") or {}
        ct = now.astimezone(ZoneInfo("America/Chicago"))
        today = ct.date()
        bad = []
        if ne.get("day") and ne.get("report"):
            day = datetime.strptime(ne["day"], "%Y-%m-%d").date()
            if day < today or (day == today and (ct.hour, ct.minute) >= (17, 30)):
                have = {c.get("id") for c in d.get("calls", [])}
                seen = {(s.get("crop"), s.get("report")) for s in d.get("skipped", [])}
                bad += ["%s-%s" % (k, ne["report"]) for k in ("corn", "beans", "wheat", "kcwheat")
                        if "%s-%s" % (k, ne["report"]) not in have and (k, ne["report"]) not in seen]
        for s in d.get("skipped", []):
            ed = s.get("entry_day")
            if str(s.get("reason", "")).startswith("missed") and ed and \
                    0 <= (today - datetime.strptime(ed, "%Y-%m-%d").date()).days <= 2:
                bad.append("%s-%s" % (s.get("crop"), s.get("report")))
        base.update(status="late" if bad else "ok",
                    why=("no call for " + ", ".join(sorted(set(bad)))) if bad else "every due call is made")
    except Exception as e:
        base.update(status="unknown", why="check could not run: %s" % type(e).__name__)
    return base


def add_prediction_row(now, rows, late, **kw):
    rows, late = list(rows), list(late)
    r = prediction_calls_row(now, **kw)
    rows.append(r)
    if r.get("status") == "late":
        late.append(r["workflow"])
    return rows, late


def add_share_row(now, rows, late, prev, **kw):
    """agsist-data-images (scripts/share_host.py row()): the og:image of a few pages that point at
    dnilgis.github.io/agsist-data answers, checked once a day; a 404 is red. Fail soft."""
    rows, late = list(rows), list(late)
    old = next((r for r in (prev or {}).get("workflows", []) if r.get("workflow") == "agsist-data-images"), None)
    try:
        import share_host
        r = share_host.row(now, old, **kw)
    except Exception as e:
        r = {"workflow": "agsist-data-images", "critical": False, "clock": "share images on agsist-data answer",
             "status": "unknown", "why": "check could not run: %s" % type(e).__name__}
    rows.append(r)
    if r.get("status") == "late":
        late.append(r["workflow"])
    return rows, late


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


def add_delivery_rows(now, rows, late, repo, token, api, prev, environ=None, fake_api=None):
    """The reader email rows (scripts/delivery_check.py). Fail soft: a broken check is one unknown row."""
    rows, late = list(rows), list(late)
    try:
        import delivery_check
        drows, at = delivery_check.delivery_rows(now, repo, token, api, environ, prev, api=fake_api)
    except Exception as e:
        drows, at = [{"workflow": "delivery:all", "critical": False, "clock": "reader email delivered",
                      "status": "unknown", "why": "check could not run: %s" % e}], None
    for r in drows:
        rows.append(r)
        if r.get("status") == "late":
            late.append(r["workflow"])
    return rows, late, at


def should_commit(prev, doc, now):
    if not prev:
        return True
    old = {r["workflow"]: r.get("status") for r in prev.get("workflows", [])}
    new = {r["workflow"]: r.get("status") for r in doc["workflows"]}
    if old != new:
        return True
    drift = lambda d: next((r.get("since") for r in d.get("workflows", []) if r.get("workflow") == "engine-drift"), None)
    if drift(doc) != drift(prev):
        return True    # when each engine file started to differ is kept, so the 2 h clock runs from then
    if doc.get("delivery_checked_at") != prev.get("delivery_checked_at"):
        return True    # a new pass over the run logs is kept, so the next runs reuse it
    share = lambda d: next((r.get("checked_at") for r in d.get("workflows", []) if r.get("workflow") == "agsist-data-images"), None)
    if share(doc) != share(prev):
        return True    # the day's share image check is kept, so it runs once a day
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
    repo = os.environ.get("GITHUB_REPOSITORY", "dnilgis/agsist")
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN", "")
    api = os.environ.get("GITHUB_API_URL", "https://api.github.com")
    rows, late = collect(now, repo, token, api)
    try:
        prev = json.load(open(a.out))
    except Exception:
        prev = None
    rows, late, checked_at = add_delivery_rows(now, rows, late, repo, token, api, prev)
    rows, late = add_drift_row(now, rows, late, prev)
    rows, late = add_share_row(now, rows, late, prev)
    rows, late = add_prediction_row(now, rows, late)
    doc = build(now, rows, late)
    if checked_at:
        doc["delivery_checked_at"] = checked_at
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
    import tempfile as _tf
    with _tf.TemporaryDirectory() as pd:
        os.makedirs(os.path.join(pd, "data"))
        def pj(ne, calls, skipped=()):
            json.dump({"next_entry": ne, "calls": [{"id": c} for c in calls],
                       "skipped": list(skipped)}, open(os.path.join(pd, "data", "prediction" + "s.json"), "w"))
        allc = ["%s-2026-11-03" % k for k in ("corn", "beans", "wheat", "kcwheat")]
        ne = {"report": "2026-11-03", "day": "2026-11-09"}
        pj(ne, [])
        check(prediction_calls_row(T("2026-11-09 21:00"), pd)["status"] == "ok", "entry day before 5:30 PM CT: not due yet")
        check(prediction_calls_row(T("2026-11-09 23:45"), pd)["status"] == "late", "entry day 5:45 PM CT, no calls: red")
        check(prediction_calls_row(T("2026-11-10 13:00"), pd)["status"] == "late", "day after, no run came: red")
        pj(ne, allc)
        check(prediction_calls_row(T("2026-11-09 23:45"), pd)["status"] == "ok", "all four made: ok")
        pj(ne, allc[:3])
        check("kcwheat" in prediction_calls_row(T("2026-11-09 23:45"), pd)["why"], "one crop short names it")
        pj(ne, allc[:3], [{"crop": "kcwheat", "report": "2026-11-03", "reason": "no usable contract"}])
        check(prediction_calls_row(T("2026-11-09 23:45"), pd)["status"] == "ok", "a recorded reason is not red")
        pj({"report": "2026-11-10", "day": "2026-11-16"}, allc, [{"crop": "beans", "report": "2026-10-27", "entry_day": "2026-11-02",
            "reason": "missed: no run at its entry close on 2026-11-02; never made late"}])
        check(prediction_calls_row(T("2026-11-04 15:00"), pd)["status"] == "late", "a missed call is red two days on")
        check(prediction_calls_row(T("2026-11-05 15:00"), pd)["status"] == "ok", "and clear on the third")
        check(prediction_calls_row(T("2026-11-04 15:00"), os.path.join(pd, "nope"))["status"] == "unknown", "no file: unknown, not a crash")
        check(add_prediction_row(T("2026-11-04 15:00"), [], [], root=pd)[1] == ["prediction-calls"], "a red row lands in the late list")

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
    check(forgive("late", None, "x", "2026-10-09T21:38:00Z")[0] == "late", "a tick nobody ran, with no tick given, stays late")
    check(forgive("late", None, "x", "2026-10-31T15:45:15Z", "2026-10-30T23:52Z")[0] == "ok",
          "a tick nobody ran clears once a later run succeeds (Fri 23:52 miss, Sat 15:45 success)")
    check(forgive("late", None, "x", "2026-10-30T16:31:29Z", "2026-10-30T23:52Z")[0] == "late",
          "a tick nobody ran stays late while the last success is older than the tick")

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
    check(should_commit({"generated_at": "2026-10-09T21:00:00Z", "delivery_checked_at": "2026-10-09T15:00:00Z",
                         "workflows": [{"workflow": "a", "status": "ok"}]},
                        dict(doc, delivery_checked_at="2026-10-09T22:00:00Z"), now),
          "a new pass over the run logs commits, so the next runs reuse it")

    # reader email delivered (scripts/delivery_check.py; its own selftest holds the classifier)
    import delivery_check as DC

    class _Api:
        def json(self, path):
            if "event=workflow_dispatch" in path:
                return {"total_count": 0}
            if path.startswith("/actions/runs/"):          # the run's jobs: its send step ran
                return {"jobs": [{"name": "run", "conclusion": "success", "steps": [{"name": "Run", "conclusion": "success"}]}]}
            return {"workflow_runs": [{"id": 1, "event": "schedule", "status": "completed", "conclusion": "success",
                                       "created_at": "2026-11-20T09:00:00Z", "run_started_at": "2026-11-20T09:00:00Z",
                                       "updated_at": "2026-11-20T09:01:00Z"}]} if "rp-design-email.yml" in path else {"workflow_runs": []}

        def blob(self, path):
            import io
            import zipfile
            b = io.BytesIO()
            with zipfile.ZipFile(b, "w") as z:
                z.writestr("0_send.txt", "2026-11-20T09:00:30.1Z DELIVERY sender=rp-design sent_readers=0 waiting=2 dry=1 asks=2\n")
            return b.getvalue()
    rows, late, at = add_delivery_rows(T("2026-11-20 12:00"), [{"workflow": "x.yml", "status": "ok"}], [], "o/r", "t",
                                       "https://api", None, environ={"RP_DESIGN_EMAIL_LIVE": "1"}, fake_api=_Api())
    d = build(T("2026-11-20 12:00"), rows, late)
    check("delivery:rp-design-email.yml" in d["late_critical"],
          "Nov 3: rp-design dry with its variable at 1 is a late critical row (%s)" % d["late_critical"])
    check(len([r for r in rows if r["workflow"].startswith("delivery:")]) == len(DC.SENDERS) and at,
          "one delivery row per sender workflow, and the pass time kept")
    check("delivery:price-watch.yml" not in late, "a sender with nothing read is not late")
    vol = next((r for r in rows if r["workflow"] == "send-volume"), {})
    check(vol.get("status") == "ok" and vol.get("cap") == 300 and "send-volume" not in late,
          "send-volume: one row, the cap defaults to 300, a dry run counts nothing (%s)" % vol.get("why"))
    _tl = lambda n: {"workflow": "send-volume", "critical": True, "cap": 300, "days": {"2026-11-20": n},
                     "top": {"2026-11-20": [["daily", n]]}, "markers": [], "logs": 1, "sampled": [], "unread": []}
    prev_doc = {"delivery_checked_at": "2026-11-20T11:00:00Z",
                "workflows": [{"workflow": "delivery:daily.yml", "status": "ok"}, _tl(245)]}
    rows, late, at = add_delivery_rows(T("2026-11-20 12:00"), [], [], "o/r", "t", "https://api", prev_doc,
                                       environ={}, fake_api=_Api())
    d = build(T("2026-11-20 12:00"), rows, late)
    vol = next((r for r in rows if r["workflow"] == "send-volume"), {})
    check(vol.get("status") == "warn" and "send-volume" not in d["late_critical"], "a reused pass: 245 of 300 is a warning")
    prev_doc["workflows"][1] = _tl(290)
    rows, late, at = add_delivery_rows(T("2026-11-20 12:00"), [], [], "o/r", "t", "https://api", prev_doc,
                                       environ={}, fake_api=_Api())
    check("send-volume" in build(T("2026-11-20 12:00"), rows, late)["late_critical"], "290 of 300 is a late critical row")
    rows, late, at = add_delivery_rows(T("2026-11-20 12:00"), [], [], "o/r", "t", "https://api", prev_doc,
                                       environ={"SEND_DAILY_CAP": "10000"}, fake_api=_Api())
    check(not late and next(r for r in rows if r["workflow"] == "send-volume")["status"] == "ok",
          "with SEND_DAILY_CAP=10000 the reused 290 is ok, no new pass needed")
    rows, late, at = add_delivery_rows(T("2026-11-20 12:00"), [], [], "o/r", "", "https://api", None, environ={})
    check(rows[0]["status"] == "unknown" and not late and at is None, "no token: one unknown row, nothing late")

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

    # a watched clock that is written here must be the workflow's own (Oct 23, 2026: county-rain.yml
    # went daily; a row left on its old Monday clock would call six days of missed runs "ok")
    for wf, crons, *_ in CHECKS:
        if crons is None:
            continue
        try:
            text = open(os.path.join(WF_DIR, wf), encoding="utf-8").read()
        except OSError:
            continue
        own = re.findall(r"""^\s*-\s*cron:\s*["']([^"']+)["']""", text, re.M)
        if own and wf in ("county-rain.yml", "prf.yml", "daily-site-check.yml"):
            check(sorted(own) == sorted(crons), "%s: the clock watched here is the workflow's own (%s vs %s)" % (wf, crons, own))
    # the four mail and rain workflows are gated (Nov 2, 2026): each row reads its clock from the
    # gate step, and that clock is exactly the workflow's own schedule, so the scheduled fire and
    # the chained runs serve the same ticks
    for wf in sorted(MANUAL_DOES_NOT_SERVE):
        row = next((c for c in CHECKS if c[0] == wf), None)
        check(row is not None and row[1] is None, "%s: watched by its gate clock" % wf)
        try:
            text = open(os.path.join(WF_DIR, wf), encoding="utf-8").read()
        except OSError:
            text = ""
        own = re.findall(r"""^\s*-\s*cron:\s*["']([^"']+)["']""", text, re.M)
        check(own and sorted(own) == sorted(gate_crons(wf)),
              "%s: the gate clock is the workflow's own schedule (%s vs %s)" % (wf, gate_crons(wf), own))
    # every gated row (Nov 3, 2026): the gate clock is the workflow's own schedule, except the two
    # whose gate runs denser on purpose; and every workflow is a row at most once
    for wf in sorted(GATED - DENSER_GATE):
        try:
            text = open(os.path.join(WF_DIR, wf), encoding="utf-8").read()
        except OSError:
            text = ""
        on = text[text.find("\non:"):text.find("\njobs:")]
        own = re.findall(r"""^\s*-\s*cron:\s*["']([^"']+)["']""", on, re.M)
        check(own and sorted(own) == sorted(gate_crons(wf)),
              "%s: gated row, its clock is the workflow's schedule (%s vs %s)" % (wf, gate_crons(wf), own))
    names = [c[0] for c in CHECKS]
    check(len(names) == len(set(names)), "no workflow is watched twice")
    check({"land-data.yml", "land-alert.yml"} <= GATED, "the land data and the land email are both watched by their gate clocks")
    try:
        import cron_gate as CG
        check(getattr(CG, "MANUAL_DOES_NOT_SERVE", MANUAL_DOES_NOT_SERVE) == MANUAL_DOES_NOT_SERVE,
              "the gate and this check pass over runs by hand for the same workflows")
    except ImportError:
        pass
    rain = (gate_crons("county-rain.yml"), next(c for c in CHECKS if c[0] == "county-rain.yml")[2])
    check(sorted(rain[0]) == ["23 13 * * *", "41 14 2 1 *"], "county rain: the gate watches the daily and the Jan 2 clock")
    check(max_spacing_minutes(rain[0]) == 1440, "county rain: the longest gap its clock allows is one day")
    s, tick, _, _ = judge(rain[0], rain[1], T("2026-10-24 18:00"), [], True, False)
    check(s == "late" and tick == "2026-10-24T13:23Z", "county rain: a Saturday with no run is late that day")
    s, *_ = judge(rain[0], rain[1], T("2026-10-24 18:00"), [R(3, "2026-10-24 13:40")], True, False)
    check(s == "ok", "county rain: the day's run serves the day's tick")
    s, tick, *_ = judge(rain[0], rain[1], T("2027-01-02 19:00"), [], True, False)
    check(s == "late" and tick == "2027-01-02T14:41Z", "county rain: Jan 2 judges the finished-year run")
    rm = gate_crons("rain-monthly.yml")
    hand = dict(R(4, "2026-11-02 14:44", "failure"), event="workflow_dispatch")
    s, *_ = judge(rm, 60, T("2026-11-02 16:00"), [hand, dict(R(5, "2026-11-02 14:52"), event="workflow_run")], True, False)
    check(s == "ok", "rain email: a failed dry run by hand is not the tick's run; the chained run that sent is")
    s, *_ = judge(rm, 60, T("2026-11-02 16:00"), [hand], True, False)
    check(s == "late", "rain email: only a run by hand after the tick is late (the month was not sent)")
    s, *_ = judge(gate_crons("land-alert.yml"), 60, T("2026-11-03 17:00"), [], True, False)
    check(s == "late", "land email: no run within an hour of 15:47 on the 3rd is late")

    # briefing file check
    import tempfile
    d = tempfile.mkdtemp()
    os.makedirs(os.path.join(d, "data", "daily-archive"))
    os.makedirs(os.path.join(d, "data", "daily-sent"))
    check(briefing_status(T("2026-10-09 11:00"), d)[0] == "ok", "briefing not due at 06:00 CDT")
    check(briefing_status(T("2026-10-09 12:14"), d)[0] == "ok", "briefing not due at 07:14 CDT")
    check(briefing_status(T("2026-10-09 12:16"), d)[0] == "late", "briefing not sent at 07:16 CDT is late")
    open(os.path.join(d, "data", "daily-archive", "2026-10-09.json"), "w").write("{}")
    # Nov 3 2026: published by a dry run, sent to nobody; published is not sent
    st, _, why = briefing_status(T("2026-10-09 13:00"), d)
    check(st == "late" and "published but not sent" in why, "briefing published but not sent at 08:00 CDT is late")
    open(os.path.join(d, "data", "daily-sent", "2026-10-09.json"), "w").write("{}")
    check(briefing_status(T("2026-10-09 13:00"), d)[0] == "ok", "briefing sent is ok")
    check(briefing_status(T("2026-10-10 02:00"), d)[0] == "ok", "21:00 CDT Friday still reads Friday's file")
    check(briefing_status(T("2026-11-03 13:16"), d)[0] == "late", "Nov 3: nothing sent at 07:16 CST is late")

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

    # share images on agsist-data (scripts/share_host.py row(); its own selftest covers the 404 and the once a day)
    srows, slate = add_share_row(T("2026-11-06 12:00"), [], [], None, get=lambda u: (200, b""))
    check([r["workflow"] for r in srows] == ["agsist-data-images"] and srows[0]["status"] in ("ok", "late", "unknown"),
          "one agsist-data-images row (%s)" % srows[0].get("why"))
    import share_host
    import shutil
    sd = tempfile.mkdtemp()
    os.makedirs(os.path.join(sd, "data"))
    open(os.path.join(sd, "data", "share-host.json"), "w").write('{"folders": {"data/social": "2026-11-05T00:00:00Z"}}')
    open(os.path.join(sd, "index.html"), "w").write(
        '<meta property="og:image" content="%s/data/social/card-2026-11-06.jpg">' % share_host.HOST)
    srows, slate = add_share_row(T("2026-11-06 12:00"), [], [], None, root=sd, get=lambda u: (404, b""))
    check(srows[0]["status"] == "late" and slate == ["agsist-data-images"], "a 404 on agsist-data is a red row")
    prev_doc = {"workflows": [dict(srows[0], status="ok")]}
    srows2, _ = add_share_row(T("2026-11-06 18:00"), [], [], prev_doc, root=sd, get=lambda u: (404, b""))
    check(srows2[0]["status"] == "ok", "an ok check from this morning is kept until tomorrow")
    shutil.rmtree(sd, ignore_errors=True)

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

    # engine-drift (BUILD-RULES 63): blob hashes only, red past ENGINE_DRIFT_HOURS, nothing named
    asked_t = []

    def tree(files, fail=None, truncated=False):
        def g(url, token):
            asked_t.append(url)
            if fail:
                raise urllib.error.HTTPError(url, fail, "x", {}, None)
            return {"truncated": truncated, "tree": [{"path": p, "type": "blob", "sha": h} for p, h in files.items()]
                    + [{"path": "scripts", "type": "tree", "sha": "t"}, {"path": "notes/x.md", "type": "blob", "sha": "n"}]}, {}
        return g
    mine = {"scripts/a.py": "1", "scripts/b.py": "2", "test/c.mjs": "3"}
    r = drift_row(now, TOK, None, get_h=tree(dict(mine)), blobs=dict(mine))
    check(r["status"] == "ok" and r["compared"] == 3 and r["since"] == {}, "engine-drift: same hashes, ok (%s)" % r["why"])
    check(asked_t[-1].endswith("/repos/dnilgis/feedbag/git/trees/engine-agsist?recursive=1"), "one tree call on engine-agsist")
    r = drift_row(now, TOK, None, get_h=tree({"scripts/a.py": "1", "scripts/b.py": "OLD", "test/c.mjs": "3"}), blobs=dict(mine))
    check(r["status"] == "warn" and r["differ"] == 1 and len(r["since"]) == 1, "a file changed on main just now: a warning (%s)" % r["why"])
    prev = {"workflows": [r]}
    later = now + timedelta(hours=ENGINE_DRIFT_HOURS, minutes=5)
    r2 = drift_row(later, TOK, prev, get_h=tree({"scripts/a.py": "1", "scripts/b.py": "OLD", "test/c.mjs": "3"}), blobs=dict(mine))
    check(r2["status"] == "late" and r2["critical"] and r2["why"].startswith("Engine out of date with main for 2.1 h"),
          "the same file still differs past %d h: red (%s)" % (ENGINE_DRIFT_HOURS, r2["why"]))
    r3 = drift_row(later, TOK, prev, get_h=tree({"scripts/a.py": "1", "scripts/b.py": "2", "test/c.mjs": "NEW"}), blobs=dict(mine))
    check(r3["status"] == "warn", "a different file, first seen now, starts its own clock (%s)" % r3["why"])
    r4 = drift_row(now, TOK, None, get_h=tree(dict(mine, **{"scripts/secret_only.py": "9"})), blobs=dict(mine))
    check(r4["only_engine"] == 1 and "engine-sync.yml refuses" in r4["why"], "a file only in the engine is counted apart (%s)" % r4["why"])
    r5 = drift_row(now, TOK, None, get_h=tree({"scripts/a.py": "1"}), blobs=dict(mine))
    check(r5["only_main"] == 2, "files only on main (a sync not run) count as drift")
    blob = json.dumps([r, r2, r3, r4, r5])
    check(not any(n in blob for n in ("a.py", "b.py", "c.mjs", "secret_only")) and TOK not in blob,
          "no file name and no key in the engine-drift rows")
    check(drift_row(now, TOK, None, get_h=tree({}, fail=404), blobs=dict(mine))["status"] == "unknown", "engine tree unreadable: unknown")
    check(drift_row(now, TOK, None, get_h=tree(dict(mine), truncated=True), blobs=dict(mine))["status"] == "unknown", "a truncated tree: unknown")
    check(drift_row(now, "", None, blobs=dict(mine))["status"] == "unknown", "no key: unknown, not red")
    d1 = {"generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "workflows": [{"workflow": "engine-drift", "status": "warn", "since": {"k": "t"}}]}
    d2 = {"generated_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "workflows": [{"workflow": "engine-drift", "status": "warn", "since": {"k": "t", "j": "u"}}]}
    check(should_commit(d1, d2, now) and not should_commit(d1, d1, now), "a new differing file is saved even when the status stays a warning")
    rows, late = add_drift_row(later, [], [], prev, environ={"PRIVATE_REPO_TOKEN": TOK}, get_h=tree({"scripts/a.py": "1", "scripts/b.py": "OLD", "test/c.mjs": "3"}), blobs=dict(mine))
    check(late == ["engine-drift"], "a red engine-drift row makes the run red")
    rp, br, ps = engine_paths()
    check(rp == PRIVATE_REPO and br == ENGINE_DRIFT_BRANCH and ps == ["scripts", "test", "build"], "the engine paths come from .github/engine-paths")
    hb = main_blobs(["scripts"])
    check("scripts/cron_health.py" in hb and len(hb["scripts/cron_health.py"]) == 40, "HEAD's blob hashes from git ls-tree")

    # the commit guard, from the real case: the Daily's sent-copy commit with the 2099 file left out
    def commits(pages, fail=None):
        calls = []
        def g(url, token):
            calls.append(url)
            if fail:
                raise fail
            return pages[len(calls) - 1] if len(calls) <= len(pages) else []
        g.calls = calls
        return g
    def cm(msg, sha="a" * 40, parents=1, when="2026-11-04T12:01:00Z"):
        return {"sha": sha, "parents": [{}] * parents, "commit": {"message": msg, "committer": {"date": when}}}
    now = T("2026-11-04 14:00")
    real = cm("AGSIST Daily sent copy\n\nCOMMIT-GUARD dropped=1 path=data/daily-sent/2099-01-01.json\n", sha="b" * 40)
    g = commits([[cm("data: county rain (50 states)"), real, cm("pages: rebuild")]])
    r = commit_guard_row(now, "o/r", "t", "https://api", get=g)
    check(r["status"] == "late" and r["critical"] and "data/daily-sent/2099-01-01.json" in r["why"]
          and ".github/future-dated-data.txt" in r["why"] and "fix the test" in r["why"] and "bbbbbbbbbb" in r["why"],
          "the 2099 sent copy left out of a commit on main is a red commit-guard row (%s)" % r.get("why"))
    check(len(g.calls) == 1 and "sha=main" in g.calls[0] and "since=2026-11-03T14:00:00Z" in g.calls[0],
          "one call for under 100 commits, main's last 24 h (%s)" % g.calls)
    r = commit_guard_row(now, "o/r", "t", "https://api", get=commits([[cm("data: x"), cm("Merge main\n\nCOMMIT-GUARD dropped=1 path=data/a/2099-01-01.json", parents=2),
                         cm("Guard row (#320)\n\n* COMMIT-GUARD dropped=1 path=data/a/2099-01-01.json\nCOMMIT-GUARD dropped=1 path=data/a/2099-01-01.json"),
                         cm("notes\n\nthe hook prints COMMIT-GUARD dropped=N path=<first path>")]]))
    check(r["status"] == "ok" and r["commits_read"] == 4, "merges, PR merges and prose about the line are not a drop (%s)" % r.get("why"))
    g = commits([[cm("x")] * 100, [cm("x")] * 100, [cm("x")] * 30 + [real]])
    r = commit_guard_row(now, "o/r", "t", "https://api", get=g)
    check(r["status"] == "late" and len(g.calls) == 3, "a drop on the third page is found")
    g = commits([[cm("x")] * 100] * COMMIT_GUARD_PAGES)
    r = commit_guard_row(now, "o/r", "t", "https://api", get=g)
    check(r["status"] == "unknown" and len(g.calls) == COMMIT_GUARD_PAGES, "more commits than the pages hold, none found: unknown, not ok")
    r = commit_guard_row(now, "o/r", "t", "https://api", get=commits([], fail=urllib.error.HTTPError("u", 403, "x", {}, None)))
    check(r["status"] == "unknown" and "403" in r["why"], "an unreadable commit list is unknown (%s)" % r.get("why"))
    r = commit_guard_row(now, "o/r", "t", "https://api", get=commits([[]]))
    check(r["status"] == "ok", "no commits: ok")
    def fail_on(page, pages):
        def g(url, token):
            k = int(url.rsplit("page=", 1)[1])
            if k == page:
                raise urllib.error.HTTPError("u", 502, "x", {}, None)
            return pages[k - 1]
        return g
    r = commit_guard_row(now, "o/r", "t", "https://api", get=fail_on(2, [[cm("x")] * 99 + [real], [], []]))
    check(r["status"] == "late" and "2099-01-01" in r["why"] and "502" in r["why"],
          "a drop on page 1 stays red when page 2 fails (%s)" % r.get("why"))
    r = commit_guard_row(now, "o/r", "t", "https://api", get=fail_on(2, [[cm("x")] * 100, [], []]))
    check(r["status"] == "unknown" and "502" in r["why"], "no drop found before a failed page: unknown")

    print("\n%d failed" % len(fails) if fails else "\nall cron_health checks passed")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
