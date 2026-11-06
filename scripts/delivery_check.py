#!/usr/bin/env python3
"""
delivery_check.py: did the reader emails actually go? (BUILD-RULES 55 and 56, Nov 3 2026)

A green run is not a delivered email. On Nov 3 we found rp-design-email and rp-buyer-email had
run green and dry for two weeks with the live variable at 1, and that the subs worker had never
once started either job through the GitHub API. Nothing noticed, because every check looked at
whether a run happened, not at whether a reader got mail.

Every workflow that mails readers or a list is in SENDERS below, with its live switch, and each of
its sender scripts prints one line per run (scripts/delivery_line.py):

    DELIVERY sender=<name> sent_readers=N waiting=M dry=0|1 [asks=N] [orders=N]

scripts/cron_health.py calls delivery_rows() every DELIVERY_EVERY_HOURS. It reads the DELIVERY
lines from each sender's recent run logs through the Actions API (counts only; a log is never
printed or saved) and gives each workflow one row, "delivery:<workflow>".

WHICH RUNS (Nov 4 2026). The first version read the newest 2 and the 3 longest runs. The Daily runs
about 81 times a day and sends in one (Nov 4: run 41823633959, 11:48 to 11:55 UTC), so the row read
"no DELIVERY line in the 5 of 81 run(s) read" and said ok: a Daily that mailed nobody would have read
green. Now each sender names its send steps and when a send is due (SENDERS "steps" and "due"), and
plan() picks the runs that could have sent: for the Daily, the runs of the day's 04:30 to 14:00
Central window long enough to have run the generate job; for a gated sender, the run that served each
tick of its cron_gate.py schedule; for a sender that may mail on any run, a sample. The jobs of those
runs (one small call each) say whether a send step ran; only the runs that reached a send step have
their log read. The limits per pass are below (LIST_PAGES, JOBS_PER_WF, LOGS_PER_WF, CALL_BUDGET).

A row is late when:

  (a) the live switch is on and a scheduled or chained run printed dry=1 (Nov 3: the
      `X && '' || Y` expression that is always Y);
  (b) the live switch is on, readers were waiting over the last 24 hours of runs read, and not one
      email reached a reader (switch on + readers waiting + 0 sent = alert);
  (c) a job only the worker starts (rp-design-email, rp-buyer-email) has no workflow_dispatch run
      in 14 days while its asks or paid orders are above 0 in rp-design-email's logs.
  (d) a send step ran and its log has no DELIVERY line for that step's sender (the check cannot
      see what it did, so it does not call it fine), except in a month a step's shell skips
      (month_gate: county-rain's January step);
  (e) a send that was due did not happen: the Daily had no live line that mailed readers (or says
      already_sent=1, the day flag set) from a run of its morning by 07:15 Central (a live 0 sent,
      0 waiting without it is an exit before the list: held, no link ids, no recipients, a crash); the run that served a gated sender's tick did not reach its send step (unless
      the step has its own condition, may_skip); a tick had no run after it for TICK_GRACE_HOURS;
      a run that started a sender's job stopped before the send step;
  (f) one live run (dry=0) had readers waiting and mailed none of them.
"Nothing due" reads ok only when nothing was due: no tick in the window, or no run reached a send
step that need not run. A due run whose jobs or log could not be read, or a Daily send run still
going, makes the row unknown; a spent call budget leaves the rest of the rows unknown. A sender that
may mail on any run is sampled, and its row says "sampled N of M run(s)".

The live switches are repository variables, read from the env cron-health.yml passes
(`vars.*`, readable with the Actions token). A switch that lives only in the subs worker
(RP_BUYER_EMAIL_LIVE) cannot be read from here: never a worker secret. The repository variable
of the same name, when Sig sets it to match, stands in for it; unset, that row says unknown.

Workflows that mail only Sig are in SIG_ONLY with the reason. test/delivery-check.test.mjs fails
any workflow with mail secrets that is in neither list, and any sender script that does not
print the line, so a new sender cannot be missed.

    python3 scripts/delivery_check.py --selftest     fixture tests of the classifier (no network)
    python3 scripts/delivery_check.py --inventory    SENDERS and SIG_ONLY as JSON (for the test)
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass

import io
import json
import os
import sys
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import delivery_line  # noqa: E402
import send_cap  # noqa: E402  (the mail plan's daily cap: the send-volume row)
from cron_gate import NOT_A_RUN  # noqa: E402

UTC = timezone.utc
DELIVERY_EVERY_HOURS = 6      # one pass per saved cron-health file (cron_health.RECOMMIT_HOURS)
WINDOW_HOURS = 24             # (a) and (b) read the runs of the last 24 hours
DRY_TITLE = "(dry run)"       # a by-hand workflow names a dry run so a stop before its send step is not a reader miss (run-name)
DISPATCH_DAYS = 14            # (c) a worker-started job with no workflow_dispatch run in 14 days
# The DELIVERY line merged Nov 3 2026 23:40 UTC (#293): a run started before then cannot print it,
# so it is never judged (a send step with no line, or a send due, before the line existed).
LINE_SINCE = "2026-11-04T00:00:00Z"
TICK_GRACE_HOURS = 2          # a gate tick with no run after it for this long: the send it was due never ran
# What one pass may read, per workflow (Nov 4 2026: the Daily runs about 80 times a day and sends in
# one; land-alert, price-watch and form-digest about 100; cot-release-watch about 200). The run list
# is free of logs; the jobs of a run (one small call) say whether its send step ran; only runs that
# reached a send step have their log read. Worst case per pass: 19 workflows x (3 pages + 8 jobs + 3
# logs) for the 18 workflows read, 6 more jobs for the Daily (max_jobs) and 2 dispatch counts: 260 at
# most, under CALL_BUDGET; most workflows stop well short (Nov 4, live: 143 calls). A pass runs every
# DELIVERY_EVERY_HOURS, against GitHub's 1,000 calls an hour for the repository's Actions token.
# Nov 5 2026: the sponsor link email (sponsor-send-link.yml, by hand only, max_jobs 3) adds 9 at most,
# so the worst case is 283 and CALL_BUDGET went from 280 to 300 (still under a third of the hour's calls).
LIST_PAGES = 3                # 300 runs in 24 h; the busiest sender (report-day) had 252 on Nov 4
JOBS_PER_WF = 8               # runs whose jobs are read
MORE_JOBS = 3                 # of those, runs read past the ones that were due (a catch-up, a run by hand)
SAMPLE_SENDS = 3              # a sender that may send on any run: stop after this many runs reached a send step
LOGS_PER_WF = 3               # run logs read per workflow, only of runs that reached a send step
CALL_BUDGET = 300             # API calls per pass, all workflows together (the repo's token is shared)
LOG_MAX_BYTES = 25 * 1024 * 1024

# What each sender prints and where. `switch`: None = no switch, live on every scheduled or
# chained run (a run by hand may ask for a dry run); ("repo", VAR, ON) = the repository variable
# VAR, live when its value is ON ("!0" = anything but "0"); ("worker", VAR, ON) = a subs worker
# variable, judged from the repository variable of the same name when Sig sets it.
# `worker_started`: the subs worker starts it through the GitHub API (rule 55); `evidence` is
# where its open asks or paid orders show. `sig_scripts`: scripts in a mail step that mail only Sig.
SENDERS = [
    {"workflow": "daily.yml", "senders": {"send_daily.py": "daily"}, "switch": None,
     "counts": "job send, step 'Send the Daily' (and the Sig-only test job, dry=1)",
     "sig_scripts": ["notify_critic_status.py"],
     "steps": {"Send daily email": ["daily"]}, "due": ("daily", "07:15", "04:30", "14:00"), "may_skip": True,
     # A run that sends ran the gate and the whole generate job. The send runs still listed on Nov 4
     # 2026 took 433, 458, 465, 510 and 529 s (Oct 28 to Nov 4; older runs are gone from the list); a
     # gate-only tick takes 29 to 40 s. Window runs at or over the floor are read first; the ones under
     # it after, longest first, while the jobs cap allows, so a faster send is still found. (e) is red
     # once every window run at or over the floor was read and none sent.
     "min_send_s": 240, "max_jobs": 14},
    {"workflow": "land-alert.yml", "senders": {"send_land_alert.py": "land-alert"},
     "switch": ("repo", "LANDSALES_MONTHLY_LIVE", "1"), "counts": "the step that runs send_land_alert.py",
     "steps": {"Monthly land sale email": ["land-alert"]}, "due": ("tick",)},
    {"workflow": "rain-monthly.yml", "senders": {"send_rain_month.py": "rain-month"},
     "switch": ("repo", "RAIN_MONTHLY_LIVE", "1"), "counts": "the step that runs send_rain_month.py",
     "steps": {"Monthly county rain": ["rain-month"]}, "due": ("tick",)},
    {"workflow": "dairy.yml", "senders": {"send_milk_month.py": "milk-month"},
     "switch": ("repo", "DAIRY_MONTHLY_LIVE", "!0"), "counts": "the step that runs send_milk_month.py",
     "steps": {"Milk price day email": ["milk-month"]}, "due": ("tick",),
     "own_if": "its if: skips only a probe run by hand, and a run by hand never serves dairy's tick"},
    {"workflow": "funds-weekly.yml", "senders": {"send_cot_weekly.py": "funds-weekly"}, "switch": None,
     "counts": "by hand only; the step that runs send_cot_weekly.py",
     "steps": {"Funds this week": ["funds-weekly"]}, "due": ("run",)},
    {"workflow": "cot-release-watch.yml", "senders": {"send_cot_weekly.py": "funds-weekly"},
     "switch": ("repo", "FUNDS_WEEKLY_LIVE", "1"), "counts": "the Funds this week step after a new report",
     "steps": {"Email Funds this week": ["funds-weekly"]}, "due": ("run",), "may_skip": True},
    {"workflow": "rp-design-email.yml", "senders": {"rp_design_email.py": "rp-design"},
     "switch": ("repo", "RP_DESIGN_EMAIL_LIVE", "1"), "worker_started": True,
     "evidence": ("rp-design-email.yml", "asks"), "counts": "the step that runs rp_design_email.py (asks=, orders=)",
     "steps": {"Run": ["rp-design"]}, "due": ("tick",)},
    {"workflow": "rp-buyer-email.yml", "senders": {"rp_buyer_email.py": "rp-buyer"},
     "switch": ("worker", "RP_BUYER_EMAIL_LIVE", "1"), "worker_started": True,
     "evidence": ("rp-design-email.yml", "orders"), "counts": "the step that runs rp_buyer_email.py",
     "steps": {"Run": ["rp-buyer"]}, "due": ("run",)},
    {"workflow": "elevator-watch.yml", "senders": {"send_elevator_watch.py": "elevator-watch", "send_zip_alert.py": "zip-alert"},
     "switch": None, "counts": "the two send steps after every Fetch Grain Bids",
     "steps": {"Send": ["elevator-watch"], "Send ZIP alerts": ["zip-alert"]}, "due": ("run",)},
    {"workflow": "price-watch.yml", "senders": {"send_price_watch.py": "price-watch"}, "switch": None,
     "counts": "the step that runs send_price_watch.py",
     "steps": {"Send": ["price-watch"]}, "due": ("run",)},
    {"workflow": "arcplc-reminder.yml", "senders": {"send_notice.py": "arcplc-notice"}, "switch": None,
     "counts": "the step that runs send_notice.py",
     "steps": {"Send": ["arcplc-notice"]}, "due": ("tick",)},
    {"workflow": "cash-rent.yml", "senders": {"send_rent_notice.py": "rent-notice",
                                              "send_custom_rates_notice.py": "customrates-notice"}, "switch": None,
     "sender_switches": {"customrates-notice": ("repo", "CUSTOMRATES_NOTICE_LIVE", "1")},
     "counts": "the steps that run send_rent_notice.py --send and send_custom_rates_notice.py --send",
     "steps": {"Rent release emails": ["rent-notice"], "Custom rates new-survey emails": ["customrates-notice"]},
     "due": ("tick",), "may_skip": True},
    {"workflow": "alert-check.yml", "senders": {"check_alerts.py": "hail-alert"}, "switch": None,
     "counts": "the step that runs check_alerts.py",
     "steps": {"Check watch areas and send alerts": ["hail-alert"]}, "due": ("run",)},
    {"workflow": "form-digest.yml", "senders": {"form_digest.py": "form-digest"}, "switch": None,
     "counts": "the step that runs form_digest.py (its readers are the people who posted a form)",
     "steps": {"Run": ["form-digest"]}, "due": ("run",)},
    {"workflow": "county-rain.yml", "senders": {"send_rain_year.py": "rain-year"}, "switch": None,
     "counts": "the January rain year step",
     "steps": {"Rain year emails (January only)": ["rain-year"]}, "due": ("tick",),
     # its shell exits 0 before the script outside January (Central): the step ran, no line, no send due
     "month_gate": {"Rain year emails (January only)": [1]}},
    {"workflow": "prf.yml", "senders": {"send_prf_notice.py": "prf-notice"}, "switch": None,
     "counts": "the PRF grid index email step",
     "steps": {"PRF grid index emails": ["prf-notice"]}, "due": ("tick",), "may_skip": True},
    {"workflow": "farmland-atlas-watch.yml", "senders": {"send_watch.py": "farmland-watch"}, "switch": None,
     "counts": "the step that runs send_watch.py",
     "steps": {"Send": ["farmland-watch"]}, "due": ("run",)},
    {"workflow": "report-day.yml", "senders": {"send_report_day.py": "report-day"}, "switch": None,
     "counts": "the step that runs send_report_day.py",
     "steps": {"Send the report-day email": ["report-day"]}, "due": ("run",)},
    {"workflow": "sponsor-apply.yml", "senders": {"sponsor_apply.py": "sponsor-apply"}, "switch": None,
     "counts": "the step that runs sponsor_apply.py (its readers are the applicants)",
     "steps": {"Run": ["sponsor-apply"]}, "due": ("run",)},
    # By hand only (Nov 5 2026): one sponsor's report link to that sponsor, Sig copied. A rerun after a
    # send skips (waiting=0); a missing address is a reader waiting and not mailed, so it reads red.
    {"workflow": "sponsor-send-link.yml", "senders": {"sponsor_send_link.py": "sponsor-link"}, "switch": None,
     "counts": "by hand only; the step that runs sponsor_send_link.py (its reader is the sponsor)",
     "steps": {"Send the link": ["sponsor-link"]}, "due": ("run",), "max_jobs": 3},
]

# Workflows with mail secrets that mail only Sig (or the person who ran them), never readers.
SIG_ONLY = {
    "audit.yml": "audit findings to Sig",
    "cron-health.yml": "the Daily's 7:15 check, the rehearsal and the Brevo limit reminder mail Sig",
    "elev-create.yml": "an elevator's private portal link, to Sig",
    "list-hygiene.yml": "what changed on the lists, to Sig",
    "morning-report.yml": "the morning report, to Sig",
    "subscriber-report.yml": "subscriber counts, to Sig",
}


def switch_vars():
    out = {e["switch"][1] for e in SENDERS if e.get("switch")}
    out |= {sw[1] for e in SENDERS for sw in (e.get("sender_switches") or {}).values()}
    return sorted(out)


def sender_states(entry, environ):
    """Each sender's switch: the workflow's, or its own (sender_switches) when a step has one."""
    own = entry.get("sender_switches") or {}
    return {n: switch_state(dict(entry, switch=own[n]) if n in own else entry, environ) for n in entry["senders"].values()}


def switch_state(entry, environ):
    """-> ("on" | "off" | "unknown", words). A variable cron-health.yml did not pass is unknown."""
    sw = entry.get("switch")
    if sw is None:
        return "on", "no switch: live on every scheduled or chained run"
    kind, var, on = sw
    if var not in environ:
        if kind == "worker":
            return "unknown", ("the switch is the subs worker variable %s, which this check cannot read; set the "
                               "repository variable %s to match it" % (var, var))
        return "unknown", "the repository variable %s was not passed to the check" % var
    v = (environ.get(var) or "").strip()
    live = (v != "0") if on == "!0" else (v == on)
    return ("on" if live else "off"), "%s is %s" % (var, repr(v) if v else "unset")


def _ts(s):
    try:
        return datetime.strptime(s or "", "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)
    except ValueError:
        return None


def run_seconds(r):
    a, b = _ts(r.get("run_started_at")), _ts(r.get("updated_at"))
    return (b - a).total_seconds() if a and b else 0


def _ct(dt):
    from zoneinfo import ZoneInfo
    return dt.astimezone(ZoneInfo("America/Chicago"))


def _at_ct(day_ct, hhmm):
    """day_ct (a Central datetime) at HH:MM Central, as UTC."""
    return day_ct.replace(hour=int(hhmm[:2]), minute=int(hhmm[3:]), second=0, microsecond=0).astimezone(UTC)


def daily_due(due, now):
    """-> (day, due_at, window_start, window_end): the latest day whose due time has passed (UTC
    datetimes; the window is the Central morning a send can happen in). Before today's due time
    the day judged is yesterday."""
    _k, by, frm, until = due
    today = _ct(now)
    day = today if now >= _at_ct(today, by) else _ct(now - timedelta(days=1))
    return day.strftime("%Y-%m-%d"), _at_ct(day, by), _at_ct(day, frm), _at_ct(day, until)


def list_since(entry, now):
    """The oldest run time to list: 24 hours, or the start of the judged day's send window."""
    since = now - timedelta(hours=WINDOW_HOURS)
    due = entry.get("due") or ("run",)
    if due[0] == "daily":
        since = min(since, daily_due(due, now)[2])
    return since


def plan(entry, runs, now, crons=None, truncated=False):
    """Which runs to read the jobs of, in order, and what was due. Pure: no network.
    runs: the workflow's runs listed since list_since(). crons: the gate's ticks (tick senders).
    truncated: the list stopped at LIST_PAGES, so nothing older than its oldest run is judged.
    -> (order: [run ids], due: dict). Only a run that could have reached a send step is listed;
    the reader stops at JOBS_PER_WF (and, for a "run" sender, once SAMPLE_SENDS sends are found)."""
    due = entry.get("due") or ("run",)
    runs = [r for r in runs if (r.get("created_at") or "") >= LINE_SINCE]
    done = [r for r in runs if r.get("status") == "completed" and r.get("conclusion") not in NOT_A_RUN]
    floor = entry.get("min_send_s") or 0
    every = done
    if floor:
        done = [r for r in done if run_seconds(r) >= floor]
    by_new = sorted(done, key=lambda r: (r.get("created_at") or "", r["id"]), reverse=True)
    by_long = sorted(done, key=lambda r: (run_seconds(r), r.get("created_at") or ""), reverse=True)
    first = []
    if entry.get("worker_started"):
        first += [r for r in by_new if r.get("event") == "workflow_dispatch"]
    info = {"kind": due[0]}
    if due[0] == "daily":
        day, at, w0, w1 = daily_due(due, now)
        in_win = lambda r: w0 <= (_ts(r.get("created_at")) or w0 - timedelta(1)) <= w1
        win = sorted((r for r in done if in_win(r)), key=lambda r: (r.get("created_at") or "", r["id"]))
        # runs under the floor are read after, the longest first, while the jobs cap allows: the floor
        # orders the reading, and (e) is red only once every run at or over it was read
        short = sorted((r for r in every if in_win(r) and r not in win), key=lambda r: (-run_seconds(r), r["id"]))
        info.update(day=day, due_ct=due[1], window_ct="%s to %s" % (due[2], due[3]), past_due=now >= at,
                    window_runs=[r["id"] for r in win], short_runs=[r["id"] for r in short],
                    running=[r["id"] for r in runs if in_win(r) and r.get("status") != "completed"],
                    before_line=w1 < _ts(LINE_SINCE),
                    cut_short=bool(truncated and runs and min(_ts(r.get("created_at")) or now for r in runs) > w0))
        first += win + short
        today = _ct(now).strftime("%Y-%m-%d")
        if today != day:                                   # before today's due time: today's morning so far, after
            t0, t1 = _at_ct(_ct(now), due[2]), _at_ct(_ct(now), due[3])
            nxt = sorted((r for r in done if t0 <= (_ts(r.get("created_at")) or t0 - timedelta(1)) <= t1),
                         key=lambda r: (r.get("created_at") or "", r["id"]))
            info.update(today=today, today_runs=[r["id"] for r in nxt])
            first += nxt
        rest = by_new
    elif due[0] == "tick":
        import cron_gate
        manual = entry["workflow"] in cron_gate.MANUAL_DOES_NOT_SERVE
        ts = cron_gate.ticks(crons or [], now - timedelta(hours=WINDOW_HOURS), now + timedelta(minutes=1))
        ts = [t for t in ts if t <= now and t >= _ts(LINE_SINCE)]
        if truncated and runs:
            oldest = min(_ts(r.get("created_at")) or now for r in runs)
            ts = [t for t in ts if t >= oldest]
        every = sorted((r for r in runs if r.get("conclusion") not in NOT_A_RUN and _ts(r.get("created_at"))
                        and not (manual and r.get("event") in cron_gate.ALWAYS_GO)),
                       key=lambda r: (r["created_at"], r["id"]))
        out = []
        for t in ts:
            served = next((r for r in every if _ts(r["created_at"]) >= t), None)
            pending = served is None and now - t < timedelta(hours=TICK_GRACE_HOURS) or (
                served is not None and served.get("status") != "completed")
            out.append({"tick": t.strftime("%Y-%m-%dT%H:%M:%SZ"), "run": served["id"] if served else None,
                        "pending": bool(pending)})
        info["ticks"] = out
        ids = {x["run"] for x in out if x["run"] and not x["pending"]}
        first += [r for r in by_new if r["id"] in ids]
        rest = by_long
    else:
        rest = by_long
    order, seen = [], set()
    for r in first + rest:
        if r["id"] not in seen:
            seen.add(r["id"])
            order.append(r["id"])
    return order, info


def step_states(jobs, steps):
    """{step name: "ran" | "skipped" | "no_job"} for one run's jobs. A step name matches exactly
    or with the "(...)" a workflow expression adds ("Monthly county rain (scheduled)").
    "skipped": its job ran and the step did not (an earlier step failed, or its own `if:` said no).
    "no_job": no job that ran lists the step (the job was skipped by its `if:`, or never made)."""
    out = {}
    for key in steps:
        state = "no_job"
        for j in jobs or []:
            for s in j.get("steps") or []:
                n = s.get("name") or ""
                if n != key and not n.startswith(key + " ("):
                    continue
                c = s.get("conclusion")
                if c in ("success", "failure") or (c == "cancelled" and s.get("started_at") and s.get("completed_at")
                                                   and s["started_at"] != s["completed_at"]):
                    state = "ran"
                elif state != "ran":
                    state = "skipped"
        out[key] = state
    return out


def classify(entry, runs, runs_total, state, dispatch_runs=None, evidence=None, now=None, due=None):
    """One delivery row from the runs read. runs: [{"id", "event", "lines": [DELIVERY dicts] or None
    (log not read), "steps": step_states() or absent (jobs not read)}], newest first. state:
    switch_state(). due: plan()'s due dict (None: no due check). dispatch_runs: workflow_dispatch
    runs in DISPATCH_DAYS (None = not read). evidence: the largest asks/orders count seen (None =
    none read). Pure: no clock, no network."""
    wf = entry["workflow"]
    worker = bool(entry.get("worker_started"))
    names = sorted(set(entry["senders"].values()))
    states = state if isinstance(state, dict) else {n: state for n in names}
    several = len({states[n] for n in names}) > 1
    findings, notes, unknown = [], [], []
    lines = [(r, l) for r in runs for l in r.get("lines") or [] if l.get("sender") in names]
    for name in names:
        st, st_why = states[name]
        mine = [(r, l) for r, l in lines if l["sender"] == name]
        pre = (name + ": ") if several else ""
        if st == "on":
            dry_runs = sorted({r["id"] for r, l in mine if l["dry"] == 1 and r.get("event") != "workflow_dispatch"})
            if dry_runs:
                findings.append("%s(a) live switch on (%s), but %d scheduled or chained run(s) printed dry=1 (run %s)"
                                % (pre, st_why, len(dry_runs), ", ".join(str(i) for i in dry_runs[:3])))
            counted = [(r, l) for r, l in mine
                       if worker or not (l["dry"] == 1 and r.get("event") == "workflow_dispatch")]
            waiting = sum(l["waiting"] for _r, l in counted)
            sent = sum(l["sent_readers"] for _r, l in counted)
            if waiting > 0 and sent == 0:
                findings.append("%s(b) readers waiting (%d over %d run(s) read) and 0 emails reached a reader in %d h"
                                % (pre, waiting, len({r["id"] for r, _l in counted}), WINDOW_HOURS))
            elif mine:
                notes.append("%s%d sent to readers, %d waiting, over %d run(s) read" % (pre, sent, waiting, len({r["id"] for r, _l in mine})))
        elif st == "off":
            notes.append("%sswitch off (%s): the list is not due mail" % (pre, st_why))
        else:
            notes.append("%sswitch unknown: %s" % (pre, st_why))
        # (f) one live run with readers waiting and none mailed, whatever the rest of the day did
        failed = sorted({r["id"] for r, l in mine if l["dry"] == 0 and l["waiting"] > 0 and l["sent_readers"] == 0})
        if failed:
            findings.append("%s(f) %d live run(s) had readers waiting and mailed none (run %s)"
                            % (pre, len(failed), ", ".join(str(i) for i in failed[:3])))
    if worker and dispatch_runs == 0 and evidence:
        src, key = entry["evidence"]
        findings.append("(c) the subs worker has not started this job in %d days (no workflow_dispatch run) while %s=%d "
                        "in %s's log" % (DISPATCH_DAYS, key, evidence, src))
    elif worker and dispatch_runs is not None:
        notes.append("%d workflow_dispatch run(s) in %d days" % (dispatch_runs, DISPATCH_DAYS))

    # (d) a send step ran and printed no DELIVERY line: the guard cannot see what it did
    steps = entry.get("steps") or {}
    jobs_read = [r for r in runs if r.get("steps") is not None]
    sent_runs = [r for r in jobs_read if any(v == "ran" for v in r["steps"].values())]
    no_log = [r["id"] for r in sent_runs if r.get("lines") is None]
    log_failed = [r["id"] for r in sent_runs if r.get("lines") is None and r.get("log") == "failed"]
    gated = entry.get("month_gate") or {}
    off_month = 0
    for r in sent_runs:
        if r.get("lines") is None:
            continue
        got = {l.get("sender") for l in r["lines"]}
        for key, v in sorted(r["steps"].items()):
            if v == "ran" and not (set(steps.get(key) or names) & got):
                made = _ts(r.get("created_at"))
                if key in gated and made and _ct(made).month not in gated[key]:
                    off_month += 1                     # its shell exits before the script outside its months
                    continue
                findings.append("(d) run %s ran the send step '%s' and printed no DELIVERY line" % (r["id"], key))
    if off_month:
        notes.append("%d run(s) passed the send step outside its months (no line expected)" % off_month)
    jobs_failed = [r["id"] for r in runs if r.get("jobs") == "failed"]
    if jobs_failed:
        unknown.append("the jobs of %d run(s) could not be read (run %s)"
                       % (len(jobs_failed), ", ".join(str(i) for i in jobs_failed[:3])))
    if log_failed:
        unknown.append("%d run(s) reached a send step and their logs could not be read (run %s)"
                       % (len(log_failed), ", ".join(str(i) for i in log_failed[:3])))
    if len(no_log) > len(log_failed):
        notes.append("%d more run(s) reached a send step; their logs are past this pass's %d"
                     % (len(no_log) - len(log_failed), LOGS_PER_WF))

    # (e) a send that was due and did not happen
    due = due or {}
    kind = due.get("kind")
    may_skip = bool(entry.get("may_skip"))
    by_id = {r["id"]: r for r in jobs_read}
    if kind == "daily":
        # sent: a live line that mailed readers, or the day flag already set (already_sent=1). A live
        # 0 sent, 0 waiting without the flag is an exit before the list was counted (a held issue, no
        # link ids, no recipients, a crash): not a send.
        live = {r["id"] for r, l in lines if l["dry"] == 0 and (l["sent_readers"] > 0 or l.get("already_sent") == 1)}
        empty = sorted({r["id"] for r, l in lines if l["dry"] == 0 and l["sent_readers"] == 0
                        and l["waiting"] == 0 and l.get("already_sent") != 1})
        win = due.get("window_runs") or []
        short = due.get("short_runs") or []
        hit = [i for i in win + short if i in live]
        if due.get("before_line"):
            notes.append("%s: before the DELIVERY line existed, not judged" % due.get("day"))
        elif due.get("cut_short"):
            unknown.append("%s: the run list stopped before its %s Central window" % (due.get("day"), due.get("window_ct")))
        elif not due.get("past_due"):
            notes.append("%s: not due until %s Central" % (due.get("day"), due.get("due_ct")))
        elif hit:
            notes.append("%s: sent by run %s" % (due.get("day"), hit[0]))
        elif due.get("running"):
            unknown.append("%s: not sent yet, and run %s is still running" % (due.get("day"), due["running"][0]))
        else:
            unread = [i for i in win if i not in by_id or i in no_log]
            short_unread = [i for i in short if i not in by_id or i in no_log]
            if short_unread:
                notes.append("%d run(s) under %d s in the window not read" % (len(short_unread), entry.get("min_send_s") or 0))
            if empty:
                notes.append("run %s ended with 0 sent and no reader count (held, or stopped before the list)"
                             % ", ".join(str(i) for i in empty[:3]))
            if unread:
                unknown.append("%s: no send found yet in the %d run(s) read between %s Central; %d not read"
                               % (due.get("day"), len(win) - len(unread), due.get("window_ct"), len(unread)))
            else:
                findings.append("(e) %s: no run sent it by %s Central (%d run(s) between %s Central long enough to "
                                "send were read; none reached the send step with a live DELIVERY line)"
                                % (due.get("day"), due.get("due_ct"), len(win), due.get("window_ct")))
        early = [i for i in due.get("today_runs") or [] if i in live]
        if early:
            notes.append("%s: sent by run %s (due %s Central)" % (due.get("today"), early[0], due.get("due_ct")))
    elif kind == "tick":
        ticks = due.get("ticks") or []
        if not ticks:
            notes.append("nothing due: no tick of its schedule in %d h" % WINDOW_HOURS)
        n_unread = 0
        for t in ticks:
            if t.get("pending"):
                notes.append("the %s tick: its run is not finished yet" % t["tick"])
                continue
            if t.get("run") is None:
                findings.append("(e) the %s tick: no run started after it" % t["tick"])
                continue
            r = by_id.get(t["run"])
            if r is None:
                n_unread += 1
                continue
            missed = [k for k, v in sorted(r["steps"].items()) if v != "ran"]
            if missed and not may_skip:
                findings.append("(e) run %s served the %s tick and did not reach the send step '%s' (%s)"
                                % (r["id"], t["tick"], missed[0], r["steps"][missed[0]]))
            elif missed and len(missed) == len(r["steps"]):
                notes.append("the %s tick: run %s, send step not due (its own condition)" % (t["tick"], r["id"]))
        if n_unread:
            notes.append("%d of %d tick run(s) not read this pass" % (n_unread, len(ticks)))
    elif kind == "run" and not may_skip:
        # a dry run (named so by the workflow) mails no reader: stopping before the send step is not a miss
        stopped = sorted({r["id"] for r in jobs_read if any(v == "skipped" for v in r["steps"].values())
                          and not r.get("dry_title")})
        if stopped:
            findings.append("(e) %d run(s) ran the send job and stopped before a send step (run %s)"
                            % (len(stopped), ", ".join(str(i) for i in stopped[:3])))
    if kind and not sent_runs and kind != "daily":
        notes.append("nothing due seen: no send step ran in the %d run(s) whose jobs were read" % len(jobs_read))
    n_logs = sum(1 for r in runs if r.get("lines") is not None)
    if kind == "run":
        notes.append("sampled %d of %d run(s) in %d h (a sample, not every run), logs for %d"
                     % (len(jobs_read), runs_total, WINDOW_HOURS, n_logs))
    else:
        notes.append("jobs read for %d of %d run(s) in %d h, logs for %d" % (len(jobs_read), runs_total, WINDOW_HOURS, n_logs))
    status = "late" if findings else ("unknown" if unknown or any(states[n][0] == "unknown" for n in names) else "ok")
    return {"workflow": "delivery:" + wf, "critical": True,
            "clock": "reader email delivered (BUILD-RULES 56): %s" % entry.get("counts", ""),
            "status": status, "why": "; ".join(findings + unknown + notes),
            "switch": {n: states[n][0] for n in names} if several else states[names[0]][0]}



def scan_zip(blob):
    """DELIVERY lines and SEND-CAP markers (scripts/send_cap.py) from a run's log archive. A job's
    whole log and its per-step files repeat the same timestamped lines, so each raw line counts once.
    -> (lines, markers)."""
    seen, out, caps = set(), [], []
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        for name in z.namelist():
            if not name.endswith(".txt"):
                continue
            for raw in z.read(name).decode("utf-8", "replace").splitlines():
                if ("DELIVERY sender=" not in raw and "SEND-CAP sender=" not in raw) or raw in seen:
                    continue
                seen.add(raw)
                out.extend(delivery_line.parse(raw))
                caps.extend(send_cap.parse(raw))
    return out, caps


def lines_from_zip(blob):
    """DELIVERY lines from a run's log archive (scan_zip without the markers)."""
    return scan_zip(blob)[0]


class _NoAuthOffHost(urllib.request.HTTPRedirectHandler):
    """A run's logs are a redirect to signed storage: never carry the token there."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        new = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new is not None and urllib.parse.urlparse(newurl).netloc != urllib.parse.urlparse(req.full_url).netloc:
            for k in list(new.headers):
                if k.lower() == "authorization":
                    del new.headers[k]
        return new


class BudgetSpent(RuntimeError):
    """The pass used its CALL_BUDGET: never read as a run that did not send."""


class Api:
    def __init__(self, repo, token, api, budget=CALL_BUDGET):
        self.repo, self.token, self.api, self.left = repo, token, api.rstrip("/"), budget

    def _open(self, path):
        if self.left <= 0:
            raise BudgetSpent("API call budget for this pass used up")
        self.left -= 1
        req = urllib.request.Request("%s/repos/%s%s" % (self.api, self.repo, path), headers={
            "Accept": "application/vnd.github+json", "Authorization": "Bearer %s" % self.token,
            "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "agsist-cron-health"})
        return urllib.request.build_opener(_NoAuthOffHost).open(req, timeout=30)

    def json(self, path):
        with self._open(path) as r:
            return json.loads(r.read().decode())

    def blob(self, path):
        with self._open(path) as r:
            return r.read(LOG_MAX_BYTES)


def list_runs(api, wf, since):
    """The workflow's runs created since `since`, up to LIST_PAGES pages of 100 (page by number:
    the API's next links name the repository by id). -> (runs, total)."""
    runs, total = [], 0
    for page in range(1, LIST_PAGES + 1):
        d = api.json("/actions/workflows/%s/runs?per_page=100&page=%d&exclude_pull_requests=true&created=%s"
                     % (wf, page, urllib.parse.quote(">=" + since.strftime("%Y-%m-%dT%H:%M:%SZ"))))
        got = d.get("workflow_runs") or []
        total = max(total, int(d.get("total_count") or 0))
        runs += got
        if len(got) < 100:
            break
    return runs, max(total, len(runs))


def read_runs(api, entry, now, crons=None):
    """The runs a delivery row is judged on. One list call (or a few pages), then the jobs of the
    runs plan() names, at most JOBS_PER_WF (MORE_JOBS past the runs that were due; a "run" sender
    stops once SAMPLE_SENDS runs reached a send step), then the logs of at most LOGS_PER_WF runs
    that reached a send step, the due ones first. -> (runs read, newest first; total; due)."""
    wf = entry["workflow"]
    runs, total = list_runs(api, wf, list_since(entry, now))
    order, due = plan(entry, runs, now, crons, truncated=total > len(runs))
    by = {r["id"]: r for r in runs}
    due_ids = (set(due.get("window_runs") or []) | set(due.get("short_runs") or []) | set(due.get("today_runs") or [])) | {t["run"] for t in due.get("ticks") or [] if t.get("run")}
    if entry.get("worker_started"):
        due_ids |= {r["id"] for r in runs if r.get("event") == "workflow_dispatch"}
    kind = due.get("kind")
    read, found, extra = [], 0, 0
    floor_win, short = set(due.get("window_runs") or []), set(due.get("short_runs") or [])
    for rid in order:
        if rid in short and any(x["id"] in floor_win and "ran" in (x["steps"] or {}).values() for x in read):
            continue                                       # the Daily: a run over the floor reached the send step
        if len(read) >= entry.get("max_jobs", JOBS_PER_WF) or (kind == "run" and found >= SAMPLE_SENDS):
            break
        if rid not in due_ids and kind != "run":
            if extra >= MORE_JOBS:
                continue
            extra += 1
        r = by[rid]
        try:
            jobs = api.json("/actions/runs/%d/jobs?per_page=100" % rid).get("jobs") or []
        except BudgetSpent:
            raise                                          # the pass is out of calls: this row and the rest are unknown
        except Exception:                                  # noqa: BLE001  that run is unread, and the row says so
            read.append({"id": rid, "event": r.get("event"), "created_at": r.get("created_at"), "steps": None,
                         "jobs": "failed", "lines": None, "log": "not read"})
            continue
        item = {"id": rid, "event": r.get("event"), "created_at": r.get("created_at"),
                "dry_title": DRY_TITLE in (r.get("display_title") or ""),
                "steps": step_states(jobs, entry.get("steps") or {}), "lines": None, "log": "not read"}
        found += any(v == "ran" for v in item["steps"].values())
        read.append(item)
    sends = [x for x in read if any(v == "ran" for v in (x["steps"] or {}).values())]
    sends.sort(key=lambda x: (x["id"] in due_ids, x.get("created_at") or "", x["id"]), reverse=True)
    for x in sends[:LOGS_PER_WF]:
        try:
            x["lines"], x["caps"] = scan_zip(api.blob("/actions/runs/%d/logs" % x["id"]))
            x["log"] = "read"
        except BudgetSpent:
            raise
        except Exception:                                  # noqa: BLE001  a log gone or too big: that run is not judged
            x["log"] = "failed"
    read.sort(key=lambda x: (x.get("created_at") or "", x["id"]), reverse=True)
    return read, total, due



def dispatch_count(api, wf, now):
    since = (now - timedelta(days=DISPATCH_DAYS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    d = api.json("/actions/workflows/%s/runs?per_page=1&event=workflow_dispatch&created=%s"
                 % (wf, urllib.parse.quote(">=" + since)))
    return int(d.get("total_count") or 0)


def delivery_rows(now, repo, token, api_url, environ=None, prev=None, api=None):
    """The delivery rows. Reuses the previous pass (prev: the saved cron-health doc) for
    DELIVERY_EVERY_HOURS, so the logs are read about four times a day. -> (rows, checked_at)."""
    environ = os.environ if environ is None else environ
    try:
        at = datetime.strptime((prev or {}).get("delivery_checked_at", ""), "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)
        old = [w for w in (prev or {}).get("workflows") or [] if str(w.get("workflow", "")).startswith("delivery:")]
        if old and now - at < timedelta(hours=DELIVERY_EVERY_HOURS):
            vol = [send_cap.rejudge(w, now, environ) for w in (prev or {}).get("workflows") or []
                   if w.get("workflow") == send_cap.ROW]   # the cap variable may have changed since
            return old + vol, prev["delivery_checked_at"]
    except Exception:                                      # noqa: BLE001
        pass
    if api is None:
        if not token:
            return [{"workflow": "delivery:all", "critical": False, "clock": "reader email delivered",
                     "status": "unknown", "why": "no Actions token: run logs not read"}], None
        api = Api(repo, token, api_url)
    rows, read_cache = [], {}
    entries = {e["workflow"]: e for e in SENDERS}

    def read(wf):
        if wf not in read_cache:
            e = entries[wf]
            crons = None
            if (e.get("due") or ("run",))[0] == "tick":
                import cron_health                        # the gate's own --cron arguments, never a copy
                crons = cron_health.gate_crons(wf)
            read_cache[wf] = read_runs(api, e, now, crons)
        return read_cache[wf]
    for e in SENDERS:
        wf = e["workflow"]
        try:
            runs, total, due = read(wf)
            evidence = disp = None
            if e.get("worker_started"):
                src, key = e["evidence"]
                # the newest run's count: asks already handled in an earlier run are not waiting now
                newest = next((r["lines"] for r in read(src)[0] if r.get("lines")), [])
                vals = [l.get(key, 0) for l in newest]
                evidence = max(vals) if vals else None
                disp = dispatch_count(api, wf, now)
            rows.append(classify(e, runs, total, sender_states(e, environ), disp, evidence, due=due))
        except Exception as ex:                            # noqa: BLE001
            rows.append({"workflow": "delivery:" + wf, "critical": True, "clock": "reader email delivered",
                         "status": "unknown", "why": "could not read runs: %s" % str(ex)[:160]})
    rows.append(volume_row(now, read_cache, environ, prev))
    return rows, now.strftime("%Y-%m-%dT%H:%M:%SZ")


def volume_row(now, read_cache, environ, prev=None):
    """send-volume (scripts/send_cap.py): emails per UTC day from the logs this pass read, against the
    mail plan's cap. No API call of its own. A sender that may mail on any run is sampled (its row
    says so), so the count is a floor."""
    try:
        runs = {wf: v[0] for wf, v in read_cache.items()}
        days, by, markers, logs = send_cap.tally_days(runs)
        keep = (now - timedelta(days=1)).strftime("%Y-%m-%d")
        days = {d: n for d, n in days.items() if d >= keep}
        by = {d: v for d, v in by.items() if d >= keep}
        markers = [m for m in markers if m.get("day", "") >= keep]
        entries = {e["workflow"]: e for e in SENDERS}
        sampled = []
        for wf, (read, total, due) in read_cache.items():
            sends = sum(1 for r in read if "ran" in (r.get("steps") or {}).values())
            logs_read = sum(1 for r in read if r.get("lines") is not None)
            if sends > logs_read or ((due or {}).get("kind") == "run" and total > len(read)):
                sampled.append(wf)
        unread = [wf for wf in entries if wf not in read_cache]
        prev_row = next((w for w in (prev or {}).get("workflows") or [] if w.get("workflow") == send_cap.ROW), None)
        return send_cap.judge(days, by, markers, send_cap.cap(environ), now, logs=logs, sampled=sampled, unread=unread,
                              daily7=send_cap.daily_history(prev_row, by))
    except Exception as ex:                                # noqa: BLE001
        return {"workflow": send_cap.ROW, "critical": True, "clock": "emails per UTC day under the mail plan's cap",
                "status": "unknown", "why": "could not count: %s" % str(ex)[:160]}


def inventory():
    return {"senders": [dict(e, switch=list(e["switch"]) if e.get("switch") else None,
                             evidence=list(e["evidence"]) if e.get("evidence") else None,
                             sender_switches={k: list(v) for k, v in (e.get("sender_switches") or {}).items()})
                        for e in SENDERS],
            "sig_only": SIG_ONLY, "switch_vars": switch_vars()}


# ───────────────────────────── selftest (fixtures only: no network, no clock) ─────────────────────────────

def selftest():
    fails = []

    def ck(what, cond, info=""):
        print(("ok   " if cond else "FAIL ") + what + ("" if cond else "  " + str(info)))
        if not cond:
            fails.append(what)

    E = {e["workflow"]: e for e in SENDERS}
    L = lambda s, sent, wait, dry, **x: dict({"sender": s, "sent_readers": sent, "waiting": wait, "dry": dry}, **x)
    R = lambda i, ev, *lines: {"id": i, "event": ev, "lines": list(lines)}
    ON, OFF = ("on", "X is '1'"), ("off", "X is '0'")

    # switch states
    ck("repo switch on at 1", switch_state(E["land-alert.yml"], {"LANDSALES_MONTHLY_LIVE": "1"})[0] == "on")
    ck("repo switch off when unset", switch_state(E["land-alert.yml"], {"LANDSALES_MONTHLY_LIVE": ""})[0] == "off")
    ck("a variable not passed is unknown", switch_state(E["land-alert.yml"], {})[0] == "unknown")
    ck("dairy is on unless 0", switch_state(E["dairy.yml"], {"DAIRY_MONTHLY_LIVE": ""})[0] == "on"
       and switch_state(E["dairy.yml"], {"DAIRY_MONTHLY_LIVE": "0"})[0] == "off")
    ck("no switch is on", switch_state(E["price-watch.yml"], {})[0] == "on")
    ck("a worker switch with no repo mirror is unknown", switch_state(E["rp-buyer-email.yml"], {})[0] == "unknown")
    ck("a worker switch reads its repo mirror", switch_state(E["rp-buyer-email.yml"], {"RP_BUYER_EMAIL_LIVE": "1"})[0] == "on")

    # Nov 3, rp-design-email: the variable at 1, every hourly run dry, asks waiting
    rd = E["rp-design-email.yml"]
    runs = [R(11, "schedule", L("rp-design", 0, 2, 1, asks=3, orders=1)), R(10, "workflow_run", L("rp-design", 0, 2, 1, asks=3, orders=1))]
    row = classify(rd, runs, 30, ON, dispatch_runs=0, evidence=3)
    ck("Nov 3 rp-design: late", row["status"] == "late", row)
    ck("Nov 3 rp-design: (a) dry with the switch on", "(a)" in row["why"], row["why"])
    ck("Nov 3 rp-design: (b) waiting, none sent", "(b)" in row["why"], row["why"])
    ck("Nov 3 rp-design: (c) never started by the worker", "(c)" in row["why"] and "asks=3" in row["why"], row["why"])
    ck("the row is critical and named for the workflow", row["critical"] and row["workflow"] == "delivery:rp-design-email.yml")

    # a dry run by hand that stopped before its send step is not a reader miss; a real one is
    sl = E["sponsor-send-link.yml"]
    stop = {"id": 31, "event": "workflow_dispatch", "lines": [], "steps": {"Send the link": "skipped"}}
    row = classify(sl, [dict(stop, dry_title=True)], 1, ("on", "no switch"), due={"kind": "run"})
    ck("sponsor link: a dry run stopped before the send is not red", row["status"] == "ok" and "(e)" not in row["why"], row)
    row = classify(sl, [dict(stop)], 1, ("on", "no switch"), due={"kind": "run"})
    ck("sponsor link: a real run stopped before the send is red", row["status"] == "late" and "(e)" in row["why"], row)
    row = classify(sl, [dict(stop, dry_title=True), dict(stop, id=32)], 2, ("on", "no switch"), due={"kind": "run"})
    ck("sponsor link: a real stop beside a dry one stays red", row["status"] == "late" and "run 32" in row["why"] and "31" not in row["why"].split("run 32")[0], row)
    ck("sponsor link: the workflow names a dry run", DRY_TITLE in open(".github/workflows/sponsor-send-link.yml").read())

    # a healthy hourly run
    runs = [R(21, "workflow_run", L("rp-design", 2, 2, 0, asks=2)), R(20, "workflow_dispatch", L("rp-design", 1, 1, 0, asks=1))]
    row = classify(rd, runs, 30, ON, dispatch_runs=4, evidence=2)
    ck("live and sending: ok", row["status"] == "ok", row)
    ck("ok row gives counts", "3 sent to readers" in row["why"], row["why"])

    # (a) alone: dry on a scheduled run, nothing waiting
    row = classify(E["price-watch.yml"], [R(5, "schedule", L("price-watch", 0, 0, 1))], 96, ("on", "no switch"))
    ck("(a) alone: a scheduled dry run with no switch is late", row["status"] == "late" and "(a)" in row["why"] and "(b)" not in row["why"], row)
    # a dry run by hand is not (a), and its waiting is not (b)
    row = classify(E["price-watch.yml"], [R(6, "workflow_dispatch", L("price-watch", 0, 4, 1)), R(5, "schedule", L("price-watch", 0, 0, 0))],
                   96, ("on", "no switch"))
    ck("a dry run by hand is neither (a) nor (b)", row["status"] == "ok", row)

    # (b) alone: live, readers waiting across the day, every send failing
    pw = [R(i, "workflow_run", L("price-watch", 0, 3, 0)) for i in range(5)]
    row = classify(E["price-watch.yml"], pw, 96, ("on", "no switch"))
    ck("(b) alone: live runs, readers waiting, none sent", row["status"] == "late" and "(b)" in row["why"] and "(a)" not in row["why"], row)
    ck("(b) counts what waited", "15 over 5 run(s)" in row["why"], row["why"])
    # one success in the window clears (b)
    row = classify(E["price-watch.yml"], pw + [R(9, "workflow_run", L("price-watch", 1, 1, 0))], 96, ("on", "no switch"))
    ck("one reader email in 24 h clears (b)", "(b)" not in row["why"], row)
    ck("but each live run that mailed none of its waiting readers is (f), named", row["status"] == "late"
       and "(f) 5 live run(s) had readers waiting and mailed none (run 0, 1, 2)" in row["why"], row["why"])
    row = classify(E["price-watch.yml"], [R(9, "workflow_run", L("price-watch", 1, 1, 0)), R(8, "workflow_run", L("price-watch", 0, 0, 0))],
                   96, ("on", "no switch"))
    ck("(f) is not a run with nobody waiting", row["status"] == "ok", row)
    row = classify(E["price-watch.yml"], [R(9, "workflow_dispatch", L("price-watch", 0, 3, 1))], 96, ("on", "no switch"))
    ck("(f) is not a dry run", row["status"] == "ok", row)
    # nothing waiting, nothing sent: fine
    row = classify(E["price-watch.yml"], [R(1, "workflow_run", L("price-watch", 0, 0, 0))], 96, ("on", "no switch"))
    ck("nothing waiting is ok", row["status"] == "ok", row)

    # the switch off: dry and waiting are what Sig asked for
    la = E["land-alert.yml"]
    row = classify(la, [R(3, "schedule", L("land-alert", 0, 40, 1))], 4, OFF)
    ck("switch off: a dry scheduled run with readers waiting is ok", row["status"] == "ok" and "switch off" in row["why"], row)
    row = classify(la, [R(3, "schedule", L("land-alert", 0, 40, 1))], 4, ON)
    ck("switch on: the same run is late", row["status"] == "late" and "(a)" in row["why"] and "(b)" in row["why"], row)
    row = classify(la, [R(3, "schedule", L("land-alert", 0, 40, 1))], 4, ("unknown", "not passed"))
    ck("switch unknown: unknown, not ok", row["status"] == "unknown", row)

    # rp-buyer: only the worker starts it; its dispatch runs are judged dry or not (Nov 3: dry for two weeks)
    rb = E["rp-buyer-email.yml"]
    row = classify(rb, [R(7, "workflow_dispatch", L("rp-buyer", 0, 1, 1, orders=1))], 1, ON, dispatch_runs=1, evidence=1)
    ck("rp-buyer: a worker-started dry run with an order waiting is (b)", row["status"] == "late" and "(b)" in row["why"], row)
    row = classify(rb, [], 0, ON, dispatch_runs=0, evidence=2)
    ck("rp-buyer: no dispatch in 14 days with paid orders is (c)", row["status"] == "late" and "(c)" in row["why"] and "orders=2" in row["why"], row)
    row = classify(rb, [], 0, ("unknown", "worker"), dispatch_runs=0, evidence=None)
    ck("rp-buyer: no runs and no orders seen is not a finding", row["status"] == "unknown", row)
    row = classify(rb, [], 0, ("unknown", "worker"), dispatch_runs=0, evidence=1)
    ck("(c) needs no switch: the worker starts it dry or live", row["status"] == "late" and "(c)" in row["why"], row)
    row = classify(rb, [], 0, ON, dispatch_runs=3, evidence=2)
    ck("rp-buyer: started by the worker, nothing in the window: ok", row["status"] == "ok", row)

    # two senders in one workflow; another sender's line is not counted
    ew = E["elevator-watch.yml"]
    row = classify(ew, [R(4, "workflow_run", L("elevator-watch", 0, 0, 0), L("zip-alert", 0, 2, 0), L("price-watch", 9, 9, 0))], 96, ("on", "x"))
    ck("lines of another sender are ignored", row["status"] == "late" and "(b) readers waiting (2 " in row["why"], row["why"])

    # cash-rent: the rent notice has no switch, the custom rates notice has its own (CUSTOMRATES_NOTICE_LIVE)
    cr = E["cash-rent.yml"]
    sts = sender_states(cr, {"CUSTOMRATES_NOTICE_LIVE": "1"})
    ck("a sender's own switch is read", sts["customrates-notice"][0] == "on" and sts["rent-notice"][0] == "on", sts)
    ck("its own switch off leaves the other on", sender_states(cr, {"CUSTOMRATES_NOTICE_LIVE": ""})["customrates-notice"][0] == "off")
    ck("its own switch not passed is unknown", sender_states(cr, {})["customrates-notice"][0] == "unknown")
    run_ = [R(8, "schedule", L("rent-notice", 3, 3, 0), L("customrates-notice", 0, 5, 1))]
    row = classify(cr, run_, 2, sender_states(cr, {"CUSTOMRATES_NOTICE_LIVE": "1"}))
    ck("custom rates dry with its switch on is late, named", row["status"] == "late" and "customrates-notice: (a)" in row["why"]
       and "rent-notice: 3 sent" in row["why"], row["why"])
    row = classify(cr, run_, 2, sender_states(cr, {"CUSTOMRATES_NOTICE_LIVE": "0"}))
    ck("custom rates switch off: ok", row["status"] == "ok" and "customrates-notice: switch off" in row["why"], row["why"])

    # ── the Nov 4 2026 real case: the Daily runs about 81 times a day and sends in one ──
    # cron-health read the newest 2 and 3 longest of 81 runs, found no DELIVERY line and called it ok:
    # "no DELIVERY line in the 5 of 81 run(s) read in 24 h". The send was run 41823633959, step
    # "Send daily email", 11:48 to 11:55 UTC. The fixture: 81 runs, newest first; the send is the
    # 79th; the newest 5 are gate-only ticks; four long morning runs where the gate waited and the
    # generate job never ran (a long run is not a send).
    now = datetime(2026, 11, 5, 11, 12, tzinfo=UTC)          # before 07:15 CST: the day judged is Nov 4
    SEND = 79

    def daily_runs():
        out = []
        for i in range(81):                                  # i = 0 is the newest
            c = now - timedelta(minutes=2 + i * 18)
            secs = 30
            if i + 1 == SEND:
                secs = 529
            elif i + 1 in (SEND - 2, SEND - 4, SEND - 6, SEND - 8):
                secs = 600                                   # the gate looped, generate was skipped
            out.append({"id": 1000 + i, "event": "workflow_dispatch", "status": "completed", "conclusion": "success",
                        "created_at": c.strftime("%Y-%m-%dT%H:%M:%SZ"), "run_started_at": c.strftime("%Y-%m-%dT%H:%M:%SZ"),
                        "updated_at": (c + timedelta(seconds=secs)).strftime("%Y-%m-%dT%H:%M:%SZ")})
        return out
    DR = daily_runs()
    send_id = DR[SEND - 1]["id"]
    ck("fixture: 81 runs, the send is the 79th and runs 11:46 UTC Nov 4", len(DR) == 81
       and DR[SEND - 1]["created_at"].startswith("2026-11-04T11:4"), DR[SEND - 1])
    JOB_GATE = {"name": "gate", "conclusion": "success", "steps": [{"name": "Run cron gate", "conclusion": "success"}]}

    def daily_jobs(rid, send="ran"):
        if rid != send_id:
            return [JOB_GATE, {"name": "generate", "conclusion": "skipped", "steps": []}]
        st = {"ran": "success", "skipped": "skipped"}[send]
        return [JOB_GATE, {"name": "generate", "conclusion": "success", "steps": [
            {"name": "Generate daily briefing", "conclusion": "success"},
            {"name": "Send daily email", "conclusion": st, "started_at": "x", "completed_at": "y"},
            {"name": "Keep the sent copy", "conclusion": "success"}]}]

    def zip_of(*lines):
        b = io.BytesIO()
        with zipfile.ZipFile(b, "w") as z:
            z.writestr("generate/27_Send daily email.txt", "".join("2026-11-04T11:55:00.1Z %s\n" % l for l in lines)
                       or "2026-11-04T11:55:00.1Z briefing sent\n")
        return b.getvalue()

    class DailyApi:
        def __init__(self, send="ran", line="DELIVERY sender=daily sent_readers=201 waiting=201 dry=0", runs=None):
            self.calls, self.send, self.line, self.runs = [], send, line, runs if runs is not None else DR

        def json(self, path):
            self.calls.append(path)
            if path.startswith("/actions/workflows/daily.yml/runs"):
                page = int(urllib.parse.parse_qs(urllib.parse.urlsplit(path).query)["page"][0])
                got = self.runs[(page - 1) * 100: page * 100]
                return {"total_count": len(self.runs), "workflow_runs": got}
            if path.startswith("/actions/runs/"):
                return {"jobs": daily_jobs(int(path.split("/")[3]), self.send)}
            return {"workflow_runs": [], "total_count": 0}

        def blob(self, path):
            self.calls.append(path)
            rid = int(path.split("/")[3])
            return zip_of(self.line) if rid == send_id and self.line else zip_of()

    dl = E["daily.yml"]
    on = {"daily": ("on", "no switch")}
    # the old view: the newest five runs, no line in any, no due check -> ok
    old = classify(dl, [R(r["id"], r["event"]) for r in DR[:5]], 81, on)
    ck("Nov 4 Daily, the old view: the newest 5 runs say ok with no line (the blind spot)", old["status"] == "ok"
       and "DELIVERY" not in old["why"], old)
    api = DailyApi()
    runs, total, due = read_runs(api, dl, now)
    row = classify(dl, runs, total, on, due=due)
    ck("Nov 4 Daily: the send in run 79 of 81 is found and its line read", row["status"] == "ok"
       and "2026-11-04: sent by run %d" % send_id in row["why"] and "201 sent to readers" in row["why"], row["why"])
    ck("Nov 4 Daily: the day judged before 07:15 CST is the day before", due["day"] == "2026-11-04" and due["past_due"], due)
    jobs_calls = [c for c in api.calls if c.endswith("/jobs?per_page=100")]
    logs_calls = [c for c in api.calls if c.endswith("/logs")]
    ck("Nov 4 Daily: only runs long enough to send are opened (5 of 81), one log", len(jobs_calls) == 5
       and logs_calls == ["/actions/runs/%d/logs" % send_id], (len(jobs_calls), logs_calls))
    ck("Nov 4 Daily: within its call bound", len(api.calls) <= LIST_PAGES + dl["max_jobs"] + LOGS_PER_WF, len(api.calls))
    # the send step ran and printed no DELIVERY line: red
    runs, total, due = read_runs(DailyApi(line=""), dl, now)
    row = classify(dl, runs, total, on, due=due)
    ck("Daily: a send step that ran with no DELIVERY line is late (d)", row["status"] == "late"
       and "(d) run %d ran the send step 'Send daily email' and printed no DELIVERY line" % send_id in row["why"], row["why"])
    # it ran, live, to nobody of the 201 waiting: red
    runs, total, due = read_runs(DailyApi(line="DELIVERY sender=daily sent_readers=0 waiting=201 dry=0"), dl, now)
    row = classify(dl, runs, total, on, due=due)
    ck("Daily: sent_readers=0 with readers waiting, not dry, is late (f)", row["status"] == "late" and "(f)" in row["why"], row["why"])
    # the send step never ran that morning: the expected send is missing
    runs, total, due = read_runs(DailyApi(send="skipped"), dl, now)
    row = classify(dl, runs, total, on, due=due)
    ck("Daily: no run reached the send step by 07:15 Central is late (e)", row["status"] == "late"
       and "(e) 2026-11-04: no run sent it by 07:15 Central" in row["why"], row["why"])
    # a dry run that reached the step (a run by hand) is not the day's send
    runs, total, due = read_runs(DailyApi(line="DELIVERY sender=daily sent_readers=0 waiting=201 dry=1"), dl, now)
    row = classify(dl, runs, total, on, due=due)
    ck("Daily: a dry line is not the day's send (e)", row["status"] == "late" and "(e)" in row["why"], row["why"])
    # a second run the same day finds the day flag set: send_daily.py says so (already_sent=1)
    runs, total, due = read_runs(DailyApi(line="DELIVERY sender=daily sent_readers=0 waiting=0 dry=0 already_sent=1"), dl, now)
    row = classify(dl, runs, total, on, due=due)
    ck("Daily: the day flag already set (already_sent=1) counts as the day sent", row["status"] == "ok", row["why"])
    # every other exit before the list is counted prints a live 0 sent, 0 waiting with no flag: the held
    # issue (v2_gate), no link ids, no recipients, a crash in fetch_subscribers (scripts/test_daily_delivery_line.py
    # runs each through send_daily.main). None of them is a send.
    runs, total, due = read_runs(DailyApi(line="DELIVERY sender=daily sent_readers=0 waiting=0 dry=0"), dl, now)
    row = classify(dl, runs, total, on, due=due)
    ck("Daily: a live 0 sent, 0 waiting with no already_sent is not a send (e)", row["status"] == "late"
       and "(e) 2026-11-04" in row["why"] and "run %d ended with 0 sent and no reader count" % send_id in row["why"], row["why"])
    # no run long enough to send in the morning window: missing, not "nothing seen"
    short = [dict(r, updated_at=r["run_started_at"]) for r in DR]
    runs, total, due = read_runs(DailyApi(runs=short), dl, now)
    row = classify(dl, runs, total, on, due=due)
    ck("Daily: only gate ticks all morning is late (e), not ok", row["status"] == "late" and "(e)" in row["why"], row["why"])
    # before 07:15 Central the same morning's send is not yet due
    early = datetime(2026, 11, 4, 12, 0, tzinfo=UTC)          # 06:00 CST
    ck("Daily: at 06:00 CST the day judged is yesterday", daily_due(dl["due"], early)[0] == "2026-11-03")
    # a real send under the floor: the window still finds it (the floor orders the reading, it does not hide)
    fast = [dict(r, updated_at=(_ts(r["run_started_at"]) + timedelta(seconds=200 if r["id"] == send_id else 30)).strftime("%Y-%m-%dT%H:%M:%SZ"))
            for r in DR]
    runs, total, due = read_runs(DailyApi(runs=fast), dl, now)
    row = classify(dl, runs, total, on, due=due)
    ck("Daily: a 200 s send (under the 240 s floor) is found by the window", row["status"] == "ok"
       and "2026-11-04: sent by run %d" % send_id in row["why"], row["why"])
    # a run of the window still going, nothing sent yet: unknown, not late
    going = [dict(r, status="in_progress") if r["id"] == send_id else r for r in DR]
    runs, total, due = read_runs(DailyApi(send="skipped", runs=going), dl, now)
    row = classify(dl, runs, total, on, due=due)
    ck("Daily: a send run still in progress is unknown, not (e)", row["status"] == "unknown"
       and "still running" in row["why"] and "(e)" not in row["why"], row["why"])

    # an API error on a run's jobs is unknown, never ok; a spent budget stops the pass
    class JobsDown(DailyApi):
        def json(self, path):
            if path.startswith("/actions/runs/"):
                raise OSError("502")
            return DailyApi.json(self, path)
    runs, total, due = read_runs(JobsDown(), dl, now)
    row = classify(dl, runs, total, on, due=due)
    ck("Daily: the jobs API failing is unknown, not ok and not late", row["status"] == "unknown"
       and "could not be read" in row["why"], row["why"])

    class Spent(DailyApi):
        def json(self, path):
            if path.startswith("/actions/runs/"):
                raise BudgetSpent("API call budget for this pass used up")
            return DailyApi.json(self, path)
    try:
        read_runs(Spent(), dl, now)
        ck("a spent call budget is raised, not read as no send", False)
    except BudgetSpent:
        ck("a spent call budget is raised, not read as no send", True)
    ck("the Daily is read first, so a short budget never starves it", SENDERS[0]["workflow"] == "daily.yml")
    distinct = {e["workflow"] for e in SENDERS} | {e["evidence"][0] for e in SENDERS if e.get("evidence")}
    worst = sum(LIST_PAGES + next(e for e in SENDERS if e["workflow"] == w).get("max_jobs", JOBS_PER_WF) + LOGS_PER_WF
                for w in distinct) + sum(1 for e in SENDERS if e.get("worker_started"))
    ck("the worst case of one pass fits its call budget (%d of %d)" % (worst, CALL_BUDGET), worst <= CALL_BUDGET, worst)

    # before 07:15, this morning's long runs are read too, after the day judged
    dr2 = [dict(DR[0], updated_at="2026-11-05T11:20:00Z")] + DR[1:]
    _o, d2 = plan(dl, dr2, now)
    ck("Daily: before 07:15 this morning's runs so far are read after the day judged", d2.get("today") == "2026-11-05"
       and d2.get("today_runs") == [DR[0]["id"]] and _o.index(DR[0]["id"]) == len(d2["window_runs"]) + len(d2["short_runs"]),
       (d2.get("today_runs"), _o[:7]))
    # the list reaches back to the start of the judged day's window, past 24 h
    ck("Daily: the runs listed reach back to 04:30 Central of the day judged",
       list_since(dl, now) == datetime(2026, 11, 4, 10, 30, tzinfo=UTC), list_since(dl, now))
    # the API caps a page at 100: a busier day is read in pages
    many = [dict(DR[0], id=5000 + i) for i in range(150)]
    pa = DailyApi(runs=many)
    got, tot = list_runs(pa, "daily.yml", now - timedelta(hours=24))
    ck("runs are listed in pages of 100", len(got) == 150 and tot == 150 and len(pa.calls) == 2, (len(got), pa.calls))

    # ── a gated sender: the run that served the tick must reach the send step ──
    la = E["land-alert.yml"]
    LAN = datetime(2026, 12, 3, 20, 0, tzinfo=UTC)
    lr = []
    for i in range(16):                                      # chained runs every 15 minutes from 16:00
        c = datetime(2026, 12, 3, 16, 0, tzinfo=UTC) + timedelta(minutes=15 * i)
        lr.append({"id": 2000 + i, "event": "workflow_run", "status": "completed", "conclusion": "success",
                   "created_at": c.strftime("%Y-%m-%dT%H:%M:%SZ"), "run_started_at": c.strftime("%Y-%m-%dT%H:%M:%SZ"),
                   "updated_at": (c + timedelta(seconds=60)).strftime("%Y-%m-%dT%H:%M:%SZ")})
    lr.append({"id": 1999, "event": "workflow_dispatch", "status": "completed", "conclusion": "success",
               "created_at": "2026-12-03T15:50:00Z", "run_started_at": "2026-12-03T15:50:00Z", "updated_at": "2026-12-03T15:59:00Z"})
    lr.append({"id": 1998, "event": "workflow_run", "status": "completed", "conclusion": "success",
               "created_at": "2026-12-03T15:30:00Z", "run_started_at": "2026-12-03T15:30:00Z", "updated_at": "2026-12-03T15:31:00Z"})
    order, due = plan(la, lr, LAN, ["47 15 3 * *"])
    ck("tick: the first chained run after 15:47 served it (a run by hand does not)", due["ticks"] == [
        {"tick": "2026-12-03T15:47:00Z", "run": 2000, "pending": False}] and order[0] == 2000, (due, order[:3]))
    J = lambda st: [{"name": "email", "conclusion": "success", "steps": [{"name": "Monthly land sale email (scheduled)", "conclusion": st}]}]
    LON = {"land-alert": ("on", "LANDSALES_MONTHLY_LIVE is '1'")}
    lines_ok = [L("land-alert", 4, 4, 0)]
    row = classify(la, [dict(R(2000, "workflow_run", *lines_ok), steps=step_states(J("success"), la["steps"]))], 18, LON, due=due)
    ck("tick: the served run reached the step and mailed: ok", row["status"] == "ok", row["why"])
    row = classify(la, [dict(R(2000, "workflow_run"), steps=step_states(J("skipped"), la["steps"]))], 18, LON, due=due)
    ck("tick: the served run stopped before the send step is late (e)", row["status"] == "late"
       and "(e) run 2000 served the 2026-12-03T15:47:00Z tick and did not reach the send step" in row["why"], row["why"])
    row = classify(la, [dict(R(2000, "workflow_run"), steps=step_states([{"name": "email", "conclusion": "skipped", "steps": []}], la["steps"]))],
                   18, LON, due=due)
    ck("tick: the served run's send job never ran is late (e)", row["status"] == "late" and "(no_job)" in row["why"], row["why"])
    cr = E["cash-rent.yml"]
    row = classify(cr, [dict(R(2000, "workflow_run"), steps=step_states([{"name": "build", "conclusion": "success", "steps": [
        {"name": "Rent release emails", "conclusion": "skipped"}, {"name": "Custom rates new-survey emails", "conclusion": "skipped"}]}],
        cr["steps"]))], 18, sender_states(cr, {"CUSTOMRATES_NOTICE_LIVE": "1"}), due=due)
    ck("tick: a send step with its own condition (cash rent outside its window) skipped is ok", row["status"] == "ok", row["why"])
    _o, due2 = plan(la, [r for r in lr if r["id"] in (1998, 1999)], LAN, ["47 15 3 * *"])
    row = classify(la, [], 2, LON, due=due2)
    ck("tick: no run after the tick for 2 h is late (e)", row["status"] == "late" and "no run started after it" in row["why"], row["why"])
    _o, due3 = plan(la, lr, datetime(2026, 12, 2, 20, 0, tzinfo=UTC), ["47 15 3 * *"])
    row = classify(la, [], 0, LON, due=due3)
    ck("tick: no tick in 24 h is nothing due, ok", row["status"] == "ok" and "nothing due: no tick" in row["why"], row["why"])

    late_runs = [r for r in lr if r["created_at"] >= "2026-12-03T17:00:00Z"]
    _o, d4 = plan(la, late_runs, LAN, ["47 15 3 * *"], truncated=True)
    ck("tick: a run list cut short judges no tick older than its oldest run", d4["ticks"] == [], d4)
    _o, d5 = plan(la, late_runs, LAN, ["47 15 3 * *"])
    ck("tick: a whole list with no run near the tick names the first run after it", d5["ticks"][0]["run"] == 2004, d5)
    ran = step_states(J("success"), la["steps"])
    row = classify(la, [dict(R(2000, "workflow_run"), lines=None, log="failed", steps=ran)], 18, LON, due=due)
    ck("a send run whose log could not be read is unknown, not ok", row["status"] == "unknown" and "could not be read" in row["why"], row["why"])
    row = classify(la, [dict(R(2000, "workflow_run", *lines_ok), steps=ran, log="read"),
                        dict(R(2001, "workflow_run"), lines=None, log="not read", steps=ran)], 18, LON, due=due)
    ck("a send run past the log cap is a note", row["status"] == "ok" and "1 more run(s) reached a send step" in row["why"], row["why"])

    _o, d6 = plan(la, [dict(r, created_at=r["created_at"].replace("2026-12-03", "2026-11-03")) for r in lr], datetime(2026, 11, 3, 20, 0, tzinfo=UTC),
                  ["47 15 3 * *"])
    ck("a run or a tick from before the DELIVERY line existed (Nov 3) is never judged", d6["ticks"] == [] and _o == [], d6)
    _o, d7 = plan(dl, DR, datetime(2026, 11, 3, 23, 0, tzinfo=UTC))
    row = classify(dl, [], 0, on, due=d7)
    ck("the Daily's Nov 3 send, before the line existed, is not judged", row["status"] == "ok" and "not judged" in row["why"], row["why"])

    # county-rain: the January step's shell exits 0 before the script in other months (no line, no send due)
    cy = E["county-rain.yml"]
    cyd = {"kind": "tick", "ticks": []}
    cran = step_states([{"name": "rain", "conclusion": "success", "steps": [{"name": "Rain year emails (January only)",
                                                                             "conclusion": "success"}]}], cy["steps"])
    mar = dict(R(4000, "workflow_run"), created_at="2027-03-02T13:30:00Z", steps=cran, log="read")
    row = classify(cy, [mar], 50, ("on", "x"), due=cyd)
    ck("county-rain: the step outside January with no line is ok", row["status"] == "ok" and "outside its months" in row["why"], row["why"])
    jan = dict(mar, created_at="2027-01-05T13:30:00Z")
    row = classify(cy, [jan], 50, ("on", "x"), due=cyd)
    ck("county-rain: the step in January with no line is late (d)", row["status"] == "late" and "(d)" in row["why"], row["why"])
    # Jan 1 03:30 UTC is still December 31 in Central
    nye = dict(mar, created_at="2027-01-01T03:30:00Z")
    ck("county-rain: the month is Central time", classify(cy, [nye], 50, ("on", "x"), due=cyd)["status"] == "ok")

    # ── a sender that may send on any run: a sample, newest-longest first ──
    ew = E["elevator-watch.yml"]
    ewr = [dict(lr[i], id=3000 + i) for i in range(16)]
    stop = [{"name": "watch", "conclusion": "failure", "steps": [{"name": "Fetch", "conclusion": "failure"},
                                                                   {"name": "Send", "conclusion": "skipped"},
                                                                   {"name": "Send ZIP alerts", "conclusion": "skipped"}]}]
    row = classify(ew, [dict(R(3001, "workflow_run"), steps=step_states(stop, ew["steps"]))], 96, ("on", "x"), due={"kind": "run"})
    ck("run: the job ran and stopped before its send steps is late (e)", row["status"] == "late" and "(e) 1 run(s)" in row["why"], row["why"])
    ck("step names match exactly, or with a (...) suffix only", step_states(stop, {"Send": []}) == {"Send": "skipped"}
       and step_states([{"steps": [{"name": "Send ZIP alerts", "conclusion": "success"}]}], {"Send": []}) == {"Send": "no_job"})

    class EwApi(DailyApi):
        def json(self, path):
            self.calls.append(path)
            if "/runs?" in path:
                return {"total_count": 16, "workflow_runs": ewr}
            return {"jobs": [{"name": "watch", "conclusion": "success", "steps": [
                {"name": "Send", "conclusion": "success"}, {"name": "Send ZIP alerts", "conclusion": "success"}]}]}

        def blob(self, path):
            self.calls.append(path)
            b = io.BytesIO()
            with zipfile.ZipFile(b, "w") as z:
                z.writestr("watch/5_Send.txt", "t DELIVERY sender=elevator-watch sent_readers=1 waiting=1 dry=0\n"
                           "t DELIVERY sender=zip-alert sent_readers=0 waiting=0 dry=0\n")
            return b.getvalue()
    ea = EwApi()
    runs, total, due = read_runs(ea, ew, LAN)
    row = classify(ew, runs, total, {"elevator-watch": ("on", "x"), "zip-alert": ("on", "x")}, due=due)
    ck("run: the row says it is a sample", "sampled 3 of 16 run(s)" in row["why"], row["why"])
    ck("run: a sample stops at %d runs that reached a send step" % SAMPLE_SENDS,
       sum(1 for c in ea.calls if c.endswith("/jobs?per_page=100")) == SAMPLE_SENDS and row["status"] == "ok", (ea.calls, row["why"]))

    # the archive: a line repeated in the job file and the step file counts once
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("0_run.txt", "2026-10-20T10:00:00.1Z x\n2026-10-20T10:00:01.1Z DELIVERY sender=rp-design sent_readers=1 waiting=1 dry=0 asks=2\n")
        z.writestr("run/5_Send.txt", "2026-10-20T10:00:01.1Z DELIVERY sender=rp-design sent_readers=1 waiting=1 dry=0 asks=2\n")
    got = lines_from_zip(buf.getvalue())
    ck("archive: one line, not two", len(got) == 1 and got[0]["asks"] == 2, got)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("0_run.txt", "2026-11-04T11:50:00.1Z SEND-CAP sender=daily kind=refused code=550 sent=180\n")
        z.writestr("run/5_Send.txt", "2026-11-04T11:50:00.1Z SEND-CAP sender=daily kind=refused code=550 sent=180\n")
    got = scan_zip(buf.getvalue())
    ck("archive: a SEND-CAP marker is read once, apart from the lines",
       got == ([], [{"sender": "daily", "kind": "refused", "code": 550, "sent": 180}]), got)

    # delivery_rows: a fake API, end to end, and the reuse of a recent pass
    T = lambda h, m: "2026-11-20T%02d:%02d:00Z" % (h, m)
    class FakeApi:
        def __init__(self):
            self.calls = []

        def json(self, path):
            self.calls.append(path)
            if "event=workflow_dispatch" in path:
                return {"total_count": 0}
            if path.startswith("/actions/runs/"):
                return {"jobs": [{"name": "run", "conclusion": "success", "steps": [{"name": "Run", "conclusion": "success"}]}]}
            if "rp-design-email.yml" in path:
                return {"workflow_runs": [{"id": 1, "event": "schedule", "status": "completed", "conclusion": "success",
                                           "created_at": T(9, 0), "run_started_at": T(9, 0), "updated_at": T(9, 2)}]}
            return {"workflow_runs": []}

        def blob(self, path):
            self.calls.append(path)
            b = io.BytesIO()
            with zipfile.ZipFile(b, "w") as z:
                z.writestr("0_send.txt", "2026-11-20T09:01:00.1Z DELIVERY sender=rp-design sent_readers=0 waiting=1 dry=1 asks=1 orders=2\n")
            return b.getvalue()
    now = datetime(2026, 11, 20, 12, 0, tzinfo=UTC)
    fa = FakeApi()
    rows, at = delivery_rows(now, "o/r", "t", "https://api", {"RP_DESIGN_EMAIL_LIVE": "1"}, api=fa)
    by = {r["workflow"]: r for r in rows}
    ck("delivery_rows: one row per sender workflow, and the send-volume row",
       len([r for r in rows if r["workflow"].startswith("delivery:")]) == len(SENDERS) and len(rows) == len(SENDERS) + 1
       and at == "2026-11-20T12:00:00Z", len(rows))
    vol = by.get(send_cap.ROW) or {}
    ck("send-volume: counted from the log read, a dry run counts 0, ok",
       vol.get("status") == "ok" and vol.get("logs") == 1 and vol.get("days") == {"2026-11-20": 0} and vol.get("critical") is True, vol)

    class CapApi(FakeApi):
        def blob(self, path):
            self.calls.append(path)
            b = io.BytesIO()
            with zipfile.ZipFile(b, "w") as z:
                z.writestr("0_send.txt", "2026-11-20T09:01:00.1Z SEND-CAP sender=rp-design kind=refused code=421 sent=3\n"
                           "2026-11-20T09:01:01.1Z DELIVERY sender=rp-design sent_readers=3 waiting=9 dry=0 smtp=3 cap_refused=6\n")
            return b.getvalue()
    vol = {r["workflow"]: r for r in delivery_rows(now, "o/r", "t", "https://api", {"RP_DESIGN_EMAIL_LIVE": "1"}, api=CapApi())[0]}[send_cap.ROW]
    ck("send-volume: a SEND-CAP refusal in a log read is red", vol["status"] == "late" and vol["days"] == {"2026-11-20": 3}
       and "refused" in vol["why"], vol)
    big = {"RP_DESIGN_EMAIL_LIVE": "1", "SEND_DAILY_CAP": "10000"}
    vol = {r["workflow"]: r for r in delivery_rows(now, "o/r", "t", "https://api", big, api=CapApi())[0]}[send_cap.ROW]
    ck("send-volume: a refusal is red even with the cap at 10000", vol["status"] == "late" and vol["cap"] == 10000, vol)
    ck("delivery_rows: rp-design late", by["delivery:rp-design-email.yml"]["status"] == "late", by["delivery:rp-design-email.yml"])
    ck("delivery_rows: rp-buyer (c) from rp-design's orders", "(c)" in by["delivery:rp-buyer-email.yml"]["why"]
       and "orders=2" in by["delivery:rp-buyer-email.yml"]["why"], by["delivery:rp-buyer-email.yml"])
    ck("delivery_rows: rp-design's runs read once", sum(1 for c in fa.calls if c.startswith("/actions/workflows/rp-design-email.yml/runs?per_page=100")) == 1, fa.calls)
    prev = {"delivery_checked_at": at, "workflows": rows}
    fb = FakeApi()
    again, at2 = delivery_rows(now + timedelta(hours=2), "o/r", "t", "https://api", {}, prev=prev, api=fb)
    ck("a pass two hours old is reused, no call made", again == rows and at2 == at and not fb.calls, fb.calls)
    again, at3 = delivery_rows(now + timedelta(hours=DELIVERY_EVERY_HOURS), "o/r", "t", "https://api", {}, prev=prev, api=fb)
    ck("a pass six hours old is redone", fb.calls and at3 != at)
    ck("no token: one unknown row, not critical", delivery_rows(now, "o/r", "", "https://api", {})[0][0]["status"] == "unknown")

    class Broken(FakeApi):
        def json(self, path):
            raise OSError("down")
    rows, _ = delivery_rows(now, "o/r", "t", "https://api", {}, api=Broken())
    ck("the API down: every row unknown, none late", all(r["status"] == "unknown" for r in rows), rows[:1])

    # the inventory is well formed
    names = [s for e in SENDERS for s in e["senders"].values()]
    ck("every sender name is valid", all(delivery_line.NAME_RE.match(n) for n in names), names)
    ck("a workflow is listed once", len({e["workflow"] for e in SENDERS}) == len(SENDERS))
    ck("no workflow is both a sender and Sig only", not ({e["workflow"] for e in SENDERS} & set(SIG_ONLY)))
    ck("worker-started jobs name their evidence", all(e.get("evidence") for e in SENDERS if e.get("worker_started")))
    print("delivery_check selftest: %d failed" % len(fails))
    return 1 if fails else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    if "--inventory" in sys.argv:
        print(json.dumps(inventory(), indent=1))
        sys.exit(0)
    print(__doc__.strip().splitlines()[0])
    sys.exit(0)
