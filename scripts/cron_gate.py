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

  lrp    For lrp.yml: Monday to Friday 19:00-23:59 UTC until today's LRP offers
         are in data/lrp/today.json (RMA posts them 2:17-4:30 pm Central), and
         one look Tuesday to Saturday 15:00-15:19 UTC (a late posting the
         evening before, and the 8:35 am CT ending values).

  behind For conditions.yml and cond-yield.yml (2026-10-16 audit: the nowcast sat a
         week behind because the Wednesday holiday catch-up fires were dropped,
         and a manual run raced conditions.yml and read last week's file). Each
         runs when its input file is on a newer USDA week than its output:
           conditions  have conditions.json  < want crop-progress.json
           condyield   have yield-nowcast    < want conditions.json
         at once when the upstream job that wrote the input just finished, and
         otherwise once every two hours (minute 0-14 of even UTC hours) for
         five days after the week ends, so a slow Quick Stats load is retried
         instead of waiting a week. Nothing runs once the output is caught up.
         condyield also stops when yield-nowcast.json records the input week
         as held_back (a late-season week with too little history, refused on
         purpose; 2026-10-16 it failed every 15 minutes instead).

A manual Run workflow, a push and a repository_dispatch always go.

Writes go=0|1 and reason=... to $GITHUB_OUTPUT (stdout when unset).

    python3 scripts/cron_gate.py tick --workflow news.yml \\
        --cron "7,22,37,52 12-21 * * 1-5" --max-lag 60
    python3 scripts/cron_gate.py cot --cot-file data/cot.json
    python3 scripts/cron_gate.py lrp --lrp-file data/lrp/today.json
    python3 scripts/cron_gate.py predict --predictions-file data/predictions.json
    python3 scripts/cron_gate.py --selftest

  predict  For predictions.yml, next to its tick: on an entry day, every chained run inside the
           window goes until each crop has a call or a recorded reason.
"""

import json
import os
import sys
import urllib.request
from datetime import date, datetime, timedelta, timezone

UTC = timezone.utc
ALWAYS_GO = {"workflow_dispatch", "push", "repository_dispatch", "pull_request", "workflow_call"}
NOT_A_RUN = {"cancelled", "startup_failure"}   # replaced pending runs never reached their gate
# The email and rain workflows (Nov 2, 2026): a run started by hand does not serve their tick.
# A manual run of these takes its own inputs (dry by default, one state, a sample month), so
# a dry run at 14:45 on the 2nd would otherwise make the 14:52 chained run skip the month's
# send. Each sender marks every reader it mails (once per month, or once ever), so a manual
# send followed by the tick's run mails nobody twice. Kept here, not as a flag, so a gate
# step never names an option an older copy of this script does not know.
MAIL_AND_RAIN = {"rain-monthly.yml", "land-alert.yml", "arcplc-reminder.yml", "county-rain.yml"}
# The data, page and email workflows gated Nov 3, 2026 (fx/gateall; GitHub never started
# land-data.yml that day, so the land sale email mailed nobody). Each takes narrower inputs by
# hand (a probe, a month, a state, a dry run) or a narrower path on a push, so a manual run or a
# push must not use up the tick; the chained run that follows is the same idempotent job.
GATED_NOV3 = {
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
    # Nov 4, 2026 (BUILD-RULES 59): the full suite on main, every two hours on the chain; a push or a
    # merge always runs it and does not use up the two-hour tick
    "main-checks.yml",
    # Nov 7, 2026: the weekly Schrader auction results capture (the feed shows only the newest five sales)
    "schrader-capture.yml",
}
MANUAL_DOES_NOT_SERVE = MAIL_AND_RAIN | GATED_NOV3

# A workflow that must run again, once, when the workflow that feeds it finishes after the run
# that served its tick (Nov 3, 2026). land-alert.yml mails at 15:47 UTC on the 3rd; land-data.yml
# fetches the month's transfers from 09:23 the same day and can run 150 minutes. When the land run
# is late, the 15:47 email finds the files older than the month and every reader waits
# ("wait-data"). The first chained run after the land run commits to data/land goes again,
# inside the same max-lag window, and mails the waiting readers; send_land_alert.py marks each
# reader once per topic and month, so nobody already mailed is mailed twice. The signal is a
# commit to the path, not a land-data.yml run: that workflow is chained too, and every one of its
# skipped runs ends "success". Kept here, not as a flag, for the reason above.
RETRY_AFTER = {"land-alert.yml": "data/land"}


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


def decide_tick(event, crons, now, self_id, runs, max_lag_minutes, manual_serves=True):
    """(go, reason). `runs` are this workflow's runs created at or after the
    tick, as the API returns them (id, created_at, conclusion, event).
    manual_serves=False: a run started by hand (an ALWAYS_GO event) does not
    count as the tick's run."""
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
        if not manual_serves and r.get("event") in ALWAYS_GO:
            continue
        created = parse_ts(r["created_at"])
        if created < t:
            continue
        earlier = (created, int(r["id"])) < my_key if my_key else int(r["id"]) < int(self_id)
        if earlier:
            return 0, "tick %s already served by run %s (%s)" % (t.strftime("%a %H:%M"), r["id"], r["created_at"])
    return 1, "first run since the %s tick" % t.strftime("%a %H:%M UTC")


def decide_retry(self_id, runs, fed, manual_serves=True):
    """(go, reason) for a run whose tick is already served (RETRY_AFTER). `runs` are this
    workflow's runs since the tick, `fed` the times of the commits to the feeding path.
    Go once when the feed landed after the run that served the tick started, and no
    other run of this workflow started between that commit and this run."""
    mine = sorted((r for r in runs if r.get("conclusion") not in NOT_A_RUN
                   and (manual_serves or r.get("event") not in ALWAYS_GO)),
                  key=lambda r: (parse_ts(r["created_at"]), int(r["id"])))
    me = next((r for r in mine if int(r["id"]) == int(self_id)), None)
    others = [r for r in mine if int(r["id"]) != int(self_id)]
    if not others:
        return 0, "no earlier run to retry"
    first = parse_ts(others[0]["created_at"])
    my_t = parse_ts(me["created_at"]) if me else None
    done = [d for d in fed if d > first and (my_t is None or d <= my_t)]
    if not done:
        return 0, "no new feed since the tick was served"
    u = max(done)
    for r in others:
        rt = parse_ts(r["created_at"])
        if u < rt and (my_t is None or (rt, int(r["id"])) < (my_t, int(self_id))):
            return 0, "run %s already retried after the feed finished at %s" % (r["id"], u.strftime("%H:%M UTC"))
    return 1, "the feed finished at %s, after the tick's run; one more pass" % u.strftime("%H:%M UTC")


def api_commit_times(repo, path, since, token, api="https://api.github.com"):
    """Committer times of the commits on the default branch that touch `path` since `since`."""
    url = ("%s/repos/%s/commits?per_page=100&path=%s&since=%s"
           % (api, repo, path, since.strftime("%Y-%m-%dT%H:%M:%SZ")))
    req = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github+json",
        "Authorization": "Bearer %s" % token,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "agsist-cron-gate"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return [parse_ts(c["commit"]["committer"]["date"]) for c in json.loads(r.read().decode())]


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


# ── the LRP decision ─────────────────────────────────────────────────────────
def lrp_sales_day(today_json):
    """The sales day data/lrp/today.json holds, as YYYY-MM-DD, or None."""
    if not today_json:
        return None
    d = today_json.get("sales_day")
    if d:
        return d
    sed = str(today_json.get("sed") or "")
    return "%s-%s-%s" % (sed[:4], sed[4:6], sed[6:8]) if len(sed) == 8 else None


def decide_lrp(event, now, today_json):
    """(go, reason) for lrp.yml. `today_json` is data/lrp/today.json, or None."""
    if event in ALWAYS_GO:
        return 1, "%s always runs" % event
    wd = now.isoweekday()
    if 2 <= wd <= 6 and now.hour == 15 and now.minute < 20:
        return 1, "the morning look (Tue-Sat 15:00-15:19 UTC)"
    if wd > 5 or now.hour < 19:
        return 0, "outside Mon-Fri 19:00-23:59 UTC and the morning look"
    from zoneinfo import ZoneInfo
    want = now.astimezone(ZoneInfo("America/Chicago")).date().isoformat()
    have = lrp_sales_day(today_json)
    if have == want:
        return 0, "today's offers (%s) are already on the site" % want
    return 1, "watching for %s's offers; the site has %s" % (want, have or "none")


# ── the "behind" decision (conditions.yml, cond-yield.yml) ───────────────────
BEHIND = {
    # mode: (have file, have path, want file, want path, upstream workflow name)
    "conditions": ("data/conditions/conditions.json", ("crops", "corn", "week_ending"),
                   "data/crop-progress.json", ("corn", "report_date"), "Fetch Crop Progress"),
    "condyield": ("data/yield-nowcast.json", ("crops", "corn", "week_ending"),
                  "data/conditions/conditions.json", ("crops", "corn", "week_ending"), "conditions"),
}
# A week the output deliberately refused (held_back) counts as handled.
REFUSED = {"condyield": ("data/yield-nowcast.json", ("held_back", "week_ending"))}
RETRY_DAYS = 5      # retry window after the week ends (Sunday) -> through Friday
STALE_DAYS = 21     # same off-season rule as build_yield_nowcast.py


def week_at(path, keys):
    """A YYYY-MM-DD date at keys inside a JSON file, or None."""
    try:
        with open(path) as f:
            v = json.load(f)
        for k in keys:
            v = v[k]
        return date.fromisoformat(str(v)[:10])
    except Exception:
        return None


def decide_behind(event, now, have, want, upstream_done, refused=None):
    """(go, reason). have = the week the output is on, want = the week its input
    is on; upstream_done = this run was started by the job that writes the input;
    refused = a week the output recorded as deliberately not built."""
    if event in ALWAYS_GO:
        return 1, "%s always runs" % event
    if want is None:
        return 0, "input week unreadable; nothing to chase"
    age = (now.date() - want).days
    if age > STALE_DAYS:
        return 0, "input is on %s, %d days old: off-season" % (want, age)
    if have is not None and have >= want:
        return 0, "already on the week ending %s" % want
    if refused is not None and refused >= want:
        return 0, "the week ending %s was refused and recorded (held_back); nothing to retry" % want
    if upstream_done:
        return 1, "input just moved to %s (output on %s)" % (want, have)
    if age > RETRY_DAYS:
        return 0, "behind (%s vs %s) but past the %d-day retry window" % (have, want, RETRY_DAYS)
    if now.hour % 2 == 0 and now.minute < 15:
        return 1, "behind (%s vs %s): two-hourly retry" % (have, want)
    return 0, "behind (%s vs %s): waiting for the next two-hourly retry" % (have, want)


# ── output ───────────────────────────────────────────────────────────────────
# ── the prediction bot's entry-day pass ─────────────────────────────────────
# Nov 2 and Oct 13, 2026: one run per tick was not enough and the calls were missed. On an entry
# day every chained run inside the window goes until each crop is handled; handled reports are
# never rewritten, so an extra pass changes nothing.
PREDICT_OPEN = (14, 0)      # Central
PREDICT_SHUT = (18, 50)     # Central


def predict_pending(preds, today):
    """Crop keys still without a call or a recorded reason on the report that enters on
    `today` (a date); [] when nothing enters today or all is handled; None when unreadable."""
    if not isinstance(preds, dict):
        return None
    try:
        nxt = preds.get("next_entry") or {}
        if nxt.get("day") != today.isoformat() or not nxt.get("report"):
            return []
        rep = nxt["report"]
        crops = [c.get("key") for c in preds.get("crops") or [] if c.get("key")]
        done = {c.get("crop") for c in preds.get("calls") or [] if c.get("cot_report") == rep}
        done |= {s.get("crop") for s in preds.get("skipped") or [] if s.get("report") == rep}
        return [k for k in crops if isinstance(k, str) and k not in done]
    except (AttributeError, TypeError):
        return None


def decide_predict(event, now, preds):
    """(go, reason) for predictions.yml's entry-day pass, alongside the tick gate."""
    if event in ALWAYS_GO:
        return 1, "%s always runs" % event
    from zoneinfo import ZoneInfo
    ct = now.astimezone(ZoneInfo("America/Chicago"))
    hm = (ct.hour, ct.minute)
    if hm < PREDICT_OPEN or hm >= PREDICT_SHUT or ct.weekday() > 4:
        return 0, "outside the entry-day window (%s CT)" % ct.strftime("%a %H:%M")
    left = predict_pending(preds, ct.date())
    if left is None:
        return 0, "predictions file unreadable; the tick gate decides"
    if not left:
        return 0, "no entry today, or every crop handled"
    return 1, "entry day, no call or reason yet for %s" % ", ".join(left)


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
    p.add_argument("mode", nargs="?", choices=["tick", "cot", "lrp", "predict", "conditions", "condyield"])
    p.add_argument("--workflow")
    p.add_argument("--cron", action="append", default=[])
    p.add_argument("--max-lag", type=int, default=120)
    p.add_argument("--cot-file", default="data/cot.json")
    p.add_argument("--lrp-file", default="data/lrp/today.json")
    p.add_argument("--predictions-file", default="data/predictions.json")
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
    if a.mode == "lrp":
        try:
            with open(a.lrp_file) as f:
                today_json = json.load(f)
        except Exception:
            today_json = None
        emit(*decide_lrp(event, now, today_json))
        return 0
    if a.mode == "predict":
        try:
            with open(a.predictions_file) as f:
                preds = json.load(f)
        except Exception:
            preds = None
        emit(*decide_predict(event, now, preds))
        return 0
    if a.mode in BEHIND:
        hf, hk, wf, wk, up = BEHIND[a.mode]
        trig = os.environ.get("TRIGGER_WORKFLOW", "")
        rf = REFUSED.get(a.mode)
        emit(*decide_behind(event, now, week_at(hf, hk), week_at(wf, wk),
                            event == "schedule" or (event == "workflow_run" and trig == up),
                            week_at(*rf) if rf else None))
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
    wf = os.path.basename(a.workflow)
    serves = wf not in MANUAL_DOES_NOT_SERVE
    me = os.environ.get("GITHUB_RUN_ID", "0")
    go, why = decide_tick(event, a.cron, now, me, runs, a.max_lag, manual_serves=serves)
    if not go and wf in RETRY_AFTER and "already served" in why:
        try:
            fed = api_commit_times(os.environ["GITHUB_REPOSITORY"], RETRY_AFTER[wf], t,
                                   os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN", ""),
                                   os.environ.get("GITHUB_API_URL", "https://api.github.com"))
            go2, why2 = decide_retry(me, runs, fed, manual_serves=serves)
            if go2:
                go, why = go2, why2
            else:
                why = "%s; %s" % (why, why2)
        except Exception as e:
            # fail closed here: the tick was served, and a retry is only a second chance
            print("::warning::cron_gate could not list %s runs (%s); no retry" % (RETRY_AFTER[wf], e))
    emit(go, why)
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
    # the mail and rain workflows (Nov 2, 2026): a dry run by hand at 14:45 on the 2nd must not
    # make the 14:52 chained run skip the month's send
    M = lambda i, s, ev: dict(R(i, s), event=ev)
    rm = ["41 14 2 * *"]
    hand = [M(70, "2026-11-02 14:45", "workflow_dispatch"), M(71, "2026-11-02 14:52", "workflow_run")]
    check(decide_tick("workflow_run", rm, T("2026-11-02 14:52"), 71, hand, 360, manual_serves=False)[0] == 1,
          "mail workflow: a run by hand after the tick does not serve it; the chained run sends")
    check(decide_tick("workflow_run", rm, T("2026-11-02 14:52"), 71, hand, 360)[0] == 0,
          "other workflows: a run by hand still serves the tick (unchanged)")
    two = [M(70, "2026-11-02 14:45", "workflow_dispatch"), M(71, "2026-11-02 14:52", "workflow_run"),
           M(72, "2026-11-02 15:07", "workflow_run")]
    check(decide_tick("workflow_run", rm, T("2026-11-02 15:07"), 72, two, 360, manual_serves=False)[0] == 0,
          "mail workflow: the second chained run after the tick still skips")
    check(decide_tick("schedule", rm, T("2026-11-02 19:00"), 73, two + [M(73, "2026-11-02 19:00", "schedule")], 360,
                      manual_serves=False)[0] == 0, "mail workflow: GitHub's late scheduled fire finds the tick served and skips")
    check(decide_tick("workflow_run", rm, T("2026-11-02 21:00"), 74, [], 360, manual_serves=False)[0] == 0,
          "mail workflow: a chained run past six hours does not send the month late")
    check(decide_tick("workflow_run", rm, T("2026-11-03 14:52"), 75, [], 360, manual_serves=False)[0] == 0,
          "mail workflow: the next day is no tick")
    check(MAIL_AND_RAIN == {"rain-monthly.yml", "land-alert.yml", "arcplc-reminder.yml", "county-rain.yml"}
          and MANUAL_DOES_NOT_SERVE == MAIL_AND_RAIN | GATED_NOV3 and len(GATED_NOV3) == 51,
          "the four mail and rain workflows and the 51 gated since Nov 3, and only those, ignore runs by hand")
    # The land sale email waits for the land data (Nov 3, 2026). Tick 15:47 on the 3rd; the 15:52
    # chained run served it while the land run was still going.
    la = ["47 15 3 * *"]
    served = [M(80, "2026-11-03 15:52", "workflow_run"), M(81, "2026-11-03 16:07", "workflow_run")]
    check(decide_tick("workflow_run", la, T("2026-11-03 16:07"), 81, served, 360, manual_serves=False)[0] == 0,
          "land email: the second chained run finds the tick served")
    check(decide_retry(81, served, [], False)[0] == 0, "land email: no land run since, no retry")
    check(decide_retry(81, served, [T("2026-11-03 12:00")], False)[0] == 0,
          "land email: the land data landed before the tick's run, no retry")
    late = served + [M(82, "2026-11-03 17:52", "workflow_run")]
    check(decide_retry(82, late, [T("2026-11-03 17:40")], False)[0] == 1,
          "land email: the first chained run after late land data goes once more")
    check(decide_retry(81, served, [T("2026-11-03 17:40")], False)[0] == 0,
          "land email: a run from before the land data landed does not retry")
    later = late + [M(83, "2026-11-03 18:07", "workflow_run")]
    check(decide_retry(83, later, [T("2026-11-03 17:40")], False)[0] == 0,
          "land email: only one retry per land data commit")
    check(decide_retry(83, later, [T("2026-11-03 17:40"), T("2026-11-03 18:01")], False)[0] == 1,
          "land email: a second land commit later that afternoon gets its own pass")
    byhand = served + [M(84, "2026-11-03 17:45", "workflow_dispatch"), M(82, "2026-11-03 17:52", "workflow_run")]
    check(decide_retry(82, byhand, [T("2026-11-03 17:40")], False)[0] == 1,
          "land email: a dry run by hand after the land run does not use up the retry")
    check(RETRY_AFTER == {"land-alert.yml": "data/land"}, "the land email, and only it, retries after its feed")

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

    # LRP
    have14 = {"sed": "20261014"}
    have15 = {"sed": "20261015", "sales_day": "2026-10-15"}
    check(decide_lrp("workflow_run", T("2026-10-15 18:52"), have14)[0] == 0, "LRP: before 19:00 UTC, no")
    check(decide_lrp("workflow_run", T("2026-10-15 19:07"), have14)[0] == 1, "LRP: Thursday, yesterday's offers, go")
    check(decide_lrp("workflow_run", T("2026-10-15 23:52"), have14)[0] == 1, "LRP: 23:52 still in window")
    check(decide_lrp("workflow_run", T("2026-10-15 19:37"), have15)[0] == 0, "LRP: today's offers in, stop")
    check(decide_lrp("workflow_run", T("2026-10-17 20:07"), have14)[0] == 0, "LRP: Saturday afternoon, no")
    check(decide_lrp("workflow_run", T("2026-10-17 15:07"), have15)[0] == 1, "LRP: Saturday morning look")
    check(decide_lrp("workflow_run", T("2026-10-19 15:07"), have15)[0] == 0, "LRP: no Monday morning look")
    check(decide_lrp("workflow_run", T("2026-10-16 15:22"), have15)[0] == 0, "LRP: morning look is 15:00-15:19")
    check(decide_lrp("workflow_run", T("2026-10-15 20:07"), None)[0] == 1, "LRP: unreadable file looks anyway")
    check(decide_lrp("workflow_dispatch", T("2026-10-18 03:00"), have15)[0] == 1, "LRP: manual always goes")
    # 23:30 UTC in December is still the same Central day (17:30 CST)
    check(decide_lrp("schedule", T("2026-12-15 23:30"), {"sed": "20261215"})[0] == 0,
          "LRP: Central date in standard time")

    # behind (conditions.yml, cond-yield.yml). Week ending Sun Oct 11, 2026;
    # NASS released Tue Oct 13 after Columbus Day.
    D = date.fromisoformat
    w4, w11 = D("2026-10-04"), D("2026-10-11")
    check(decide_behind("workflow_run", T("2026-10-14 01:20"), w4, w11, True)[0] == 1,
          "behind: upstream just wrote the new week, go at once")
    check(decide_behind("workflow_run", T("2026-10-14 01:20"), w4, w11, False)[0] == 0,
          "behind: odd hour, wait for the two-hourly slot")
    check(decide_behind("workflow_run", T("2026-10-14 02:07"), w4, w11, False)[0] == 1,
          "behind: even hour minute 7, retry")
    check(decide_behind("workflow_run", T("2026-10-14 02:22"), w4, w11, False)[0] == 0,
          "behind: one retry per slot (minute 0-14 only)")
    check(decide_behind("schedule", T("2026-10-14 04:03"), w11, w11, True)[0] == 0,
          "behind: caught up, nothing runs")
    check(decide_behind("workflow_run", T("2026-10-17 10:07"), w4, w11, False)[0] == 0,
          "behind: past the five-day retry window, stop retrying")
    check(decide_behind("workflow_run", T("2026-10-17 10:07"), w4, w11, True)[0] == 1,
          "behind: upstream still triggers after the retry window")
    check(decide_behind("workflow_run", T("2026-12-15 02:07"), w4, D("2026-11-22"), True)[0] == 0,
          "behind: three-week-old input is off-season")
    check(decide_behind("workflow_run", T("2026-10-14 02:07"), None, w11, False)[0] == 1,
          "behind: no output yet counts as behind")
    check(decide_behind("workflow_run", T("2026-10-14 02:07"), w4, None, True)[0] == 0,
          "behind: unreadable input, no run")
    check(decide_behind("workflow_dispatch", T("2026-10-14 03:00"), w11, w11, False)[0] == 1,
          "behind: manual always goes")
    # 2026-10-16: the Oct 11 week had too little late-season history and the
    # build failed every 15 minutes off each "conditions" completion.
    check(decide_behind("workflow_run", T("2026-10-16 22:43"), w4, w11, True, w11)[0] == 0,
          "behind: a recorded refusal of this week stops the re-runs")
    check(decide_behind("workflow_run", T("2026-10-19 02:07"), w4, D("2026-10-18"), True, w11)[0] == 1,
          "behind: a refusal of last week does not block the next week")
    check(decide_behind("workflow_dispatch", T("2026-10-16 22:43"), w4, w11, False, w11)[0] == 1,
          "behind: manual still goes after a refusal")
    check(decide_behind("workflow_run", T("2026-10-16 22:43"), w4, w11, True, None)[0] == 1,
          "behind: no refusal recorded, a failure keeps failing loud")


    # prediction bot, entry-day pass. Real misses: Tue Oct 13, 2026 (CDT) and Mon Nov 2, 2026 (CST)
    def PR(rep, day, calls=(), skipped=()):
        return {"crops": [{"key": k} for k in ("corn", "beans", "wheat", "kcwheat")],
                "next_entry": {"report": rep, "day": day},
                "calls": [{"crop": k, "cot_report": rep} for k in calls],
                "skipped": [{"crop": k, "report": rep} for k in skipped]}
    oct13 = PR("2026-10-06", "2026-10-13")
    nov2 = PR("2026-10-27", "2026-11-02")
    for ts, want in (("2026-10-13 18:52", 0), ("2026-10-13 19:07", 1), ("2026-10-13 21:52", 1), ("2026-10-13 23:37", 1),
                     ("2026-10-13 23:51", 0)):
        check(decide_predict("workflow_run", T(ts), oct13)[0] == want, "predict: Oct 13 %s UTC -> %d" % (ts[-5:], want))
    for ts, want in (("2026-11-02 19:52", 0), ("2026-11-02 20:07", 1), ("2026-11-02 22:53", 1), ("2026-11-02 23:52", 1),
                     ("2026-11-03 00:37", 1), ("2026-11-03 00:51", 0), ("2026-11-03 01:47", 0)):
        check(decide_predict("workflow_run", T(ts), nov2)[0] == want, "predict: Nov 2 %s UTC -> %d" % (ts[-5:], want))
    check(decide_predict("workflow_run", T("2026-11-02 22:53"), PR("2026-10-27", "2026-11-02", calls=["corn", "beans", "wheat"]))[0] == 1,
          "predict: one crop still short keeps the pass open")
    check("kcwheat" in decide_predict("workflow_run", T("2026-11-02 22:53"), PR("2026-10-27", "2026-11-02", calls=["corn", "beans", "wheat"]))[1],
          "predict: the reason names the crop short")
    check(decide_predict("workflow_run", T("2026-11-02 22:53"),
                         PR("2026-10-27", "2026-11-02", calls=["corn", "beans"], skipped=["wheat", "kcwheat"]))[0] == 0,
          "predict: calls plus recorded reasons close the pass")
    check(decide_predict("workflow_run", T("2026-11-03 22:53"), nov2)[0] == 0, "predict: not an entry day")
    check(decide_predict("workflow_run", T("2026-11-07 20:53"), PR("2026-10-27", "2026-11-07"))[0] == 0, "predict: Saturday")
    check(decide_predict("workflow_run", T("2026-11-02 22:53"), None)[0] == 0, "predict: unreadable file stays shut")
    check(decide_predict("workflow_run", T("2026-11-02 22:53"), {"next_entry": "x", "crops": [1]})[0] == 0,
          "predict: wrong-shaped file stays shut, no crash")
    check(decide_predict("workflow_dispatch", T("2026-11-02 03:00"), nov2)[0] == 1, "predict: manual always goes")

    print("\n%d failed" % len(fails) if fails else "\nall cron_gate checks passed")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
