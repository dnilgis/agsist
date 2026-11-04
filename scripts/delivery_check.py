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
printed or saved) and gives each workflow one row, "delivery:<workflow>", that is late when:

  (a) the live switch is on and a scheduled or chained run printed dry=1 (Nov 3: the
      `X && '' || Y` expression that is always Y);
  (b) the live switch is on, readers were waiting over the last 24 hours of runs read, and not one
      email reached a reader (switch on + readers waiting + 0 sent = alert);
  (c) a job only the worker starts (rp-design-email, rp-buyer-email) has no workflow_dispatch run
      in 14 days while its asks or paid orders are above 0 in rp-design-email's logs.

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

UTC = timezone.utc
DELIVERY_EVERY_HOURS = 6      # one pass per saved cron-health file (cron_health.RECOMMIT_HOURS)
WINDOW_HOURS = 24             # (a) and (b) read the runs of the last 24 hours
DISPATCH_DAYS = 14            # (c) a worker-started job with no workflow_dispatch run in 14 days
RUNS_READ = 5                 # run logs read per workflow per pass: the newest 2 and the 3 longest
CALL_BUDGET = 150             # API calls per pass, all workflows together (the repo's token is shared)
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
     # A run that sends ran the gate and the whole generate job: 510 and 529 s on Nov 3 and 4 2026
     # (runs 41647674667, 41823633959); a gate-only tick takes 29 to 40 s. A run shorter than this
     # cannot have reached the send step, so its jobs are not read. Too high fails loud: the day reads late.
     "min_send_s": 240},
    {"workflow": "land-alert.yml", "senders": {"send_land_alert.py": "land-alert"},
     "switch": ("repo", "LANDSALES_MONTHLY_LIVE", "1"), "counts": "the step that runs send_land_alert.py",
     "steps": {"Monthly land sale email": ["land-alert"]}, "due": ("tick",)},
    {"workflow": "rain-monthly.yml", "senders": {"send_rain_month.py": "rain-month"},
     "switch": ("repo", "RAIN_MONTHLY_LIVE", "1"), "counts": "the step that runs send_rain_month.py",
     "steps": {"Monthly county rain": ["rain-month"]}, "due": ("tick",)},
    {"workflow": "dairy.yml", "senders": {"send_milk_month.py": "milk-month"},
     "switch": ("repo", "DAIRY_MONTHLY_LIVE", "!0"), "counts": "the step that runs send_milk_month.py",
     "steps": {"Milk price day email": ["milk-month"]}, "due": ("tick",)},
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
     "steps": {"Rain year emails (January only)": ["rain-year"]}, "due": ("tick",)},
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
]

# Workflows with mail secrets that mail only Sig (or the person who ran them), never readers.
SIG_ONLY = {
    "audit.yml": "audit findings to Sig",
    "cron-health.yml": "the Daily's 7:15 check and the rehearsal mail Sig",
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


def classify(entry, runs, runs_total, state, dispatch_runs=None, evidence=None, now=None):
    """One delivery row from the runs read. runs: [{"id", "event", "lines": [DELIVERY dicts]}],
    newest first. state: switch_state(). dispatch_runs: workflow_dispatch runs in DISPATCH_DAYS
    (None = not read). evidence: the largest asks/orders count seen (None = none read).
    Pure: no clock, no network."""
    wf = entry["workflow"]
    worker = bool(entry.get("worker_started"))
    names = sorted(set(entry["senders"].values()))
    states = state if isinstance(state, dict) else {n: state for n in names}
    several = len({states[n] for n in names}) > 1
    findings, notes = [], []
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
    if worker and dispatch_runs == 0 and evidence:
        src, key = entry["evidence"]
        findings.append("(c) the subs worker has not started this job in %d days (no workflow_dispatch run) while %s=%d "
                        "in %s's log" % (DISPATCH_DAYS, key, evidence, src))
    elif worker and dispatch_runs is not None:
        notes.append("%d workflow_dispatch run(s) in %d days" % (dispatch_runs, DISPATCH_DAYS))
    if not lines:
        notes.append("no DELIVERY line in the %d of %d run(s) read in %d h" % (len(runs), runs_total, WINDOW_HOURS))
    else:
        notes.append("read %d of %d run(s) in %d h" % (len(runs), runs_total, WINDOW_HOURS))
    status = "late" if findings else ("unknown" if any(states[n][0] == "unknown" for n in names) else "ok")
    return {"workflow": "delivery:" + wf, "critical": True,
            "clock": "reader email delivered (BUILD-RULES 56): %s" % entry.get("counts", ""),
            "status": status, "why": "; ".join(findings + notes),
            "switch": {n: states[n][0] for n in names} if several else states[names[0]][0]}


def pick_runs(runs, n=RUNS_READ):
    """The newest 2 and then the longest (a run that mailed takes longer than a gate that skipped)."""
    done = [r for r in runs if r.get("status") == "completed" and r.get("conclusion") != "skipped"]
    done.sort(key=lambda r: r.get("created_at") or "", reverse=True)

    def dur(r):
        try:
            a = datetime.strptime(r["run_started_at"], "%Y-%m-%dT%H:%M:%SZ")
            b = datetime.strptime(r["updated_at"], "%Y-%m-%dT%H:%M:%SZ")
            return (b - a).total_seconds()
        except Exception:                                  # noqa: BLE001
            return 0
    out = done[:2]
    for r in sorted(done[2:], key=dur, reverse=True):
        if len(out) >= n:
            break
        out.append(r)
    out.sort(key=lambda r: r.get("created_at") or "", reverse=True)
    return out


def lines_from_zip(blob):
    """DELIVERY lines from a run's log archive. A job's whole log and its per-step files repeat
    the same timestamped lines, so each raw line counts once."""
    seen, out = set(), []
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        for name in z.namelist():
            if not name.endswith(".txt"):
                continue
            for raw in z.read(name).decode("utf-8", "replace").splitlines():
                if "DELIVERY sender=" not in raw or raw in seen:
                    continue
                seen.add(raw)
                out.extend(delivery_line.parse(raw))
    return out


class _NoAuthOffHost(urllib.request.HTTPRedirectHandler):
    """A run's logs are a redirect to signed storage: never carry the token there."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        new = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new is not None and urllib.parse.urlparse(newurl).netloc != urllib.parse.urlparse(req.full_url).netloc:
            for k in list(new.headers):
                if k.lower() == "authorization":
                    del new.headers[k]
        return new


class Api:
    def __init__(self, repo, token, api, budget=CALL_BUDGET):
        self.repo, self.token, self.api, self.left = repo, token, api.rstrip("/"), budget

    def _open(self, path):
        if self.left <= 0:
            raise RuntimeError("API call budget for this pass used up")
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


def read_runs(api, wf, now):
    since = (now - timedelta(hours=WINDOW_HOURS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    d = api.json("/actions/workflows/%s/runs?per_page=100&exclude_pull_requests=true&created=%s"
                 % (wf, urllib.parse.quote(">=" + since)))
    runs = d.get("workflow_runs") or []
    read = []
    for r in pick_runs(runs):
        try:
            lines = lines_from_zip(api.blob("/actions/runs/%d/logs" % r["id"]))
        except Exception:                                  # noqa: BLE001  a log gone or too big: that run is not read
            continue
        read.append({"id": r["id"], "event": r.get("event"), "lines": lines})
    return read, len(runs)


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
            return old, prev["delivery_checked_at"]
    except Exception:                                      # noqa: BLE001
        pass
    if api is None:
        if not token:
            return [{"workflow": "delivery:all", "critical": False, "clock": "reader email delivered",
                     "status": "unknown", "why": "no Actions token: run logs not read"}], None
        api = Api(repo, token, api_url)
    rows, read_cache = [], {}
    for e in SENDERS:
        wf = e["workflow"]
        try:
            if wf not in read_cache:
                read_cache[wf] = read_runs(api, wf, now)
            runs, total = read_cache[wf]
            evidence = disp = None
            if e.get("worker_started"):
                src, key = e["evidence"]
                if src not in read_cache:
                    read_cache[src] = read_runs(api, src, now)
                vals = [l.get(key, 0) for r in read_cache[src][0] for l in r["lines"]]
                evidence = max(vals) if vals else None
                disp = dispatch_count(api, wf, now)
            rows.append(classify(e, runs, total, sender_states(e, environ), disp, evidence))
        except Exception as ex:                            # noqa: BLE001
            rows.append({"workflow": "delivery:" + wf, "critical": True, "clock": "reader email delivered",
                         "status": "unknown", "why": "could not read runs: %s" % str(ex)[:160]})
    return rows, now.strftime("%Y-%m-%dT%H:%M:%SZ")


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
    ck("one reader email in 24 h clears (b)", row["status"] == "ok", row)
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

    # no lines read
    row = classify(E["daily.yml"], [R(1, "schedule")], 3, ("on", "x"))
    ck("no DELIVERY line read: ok, and says so", row["status"] == "ok" and "no DELIVERY line" in row["why"], row)

    # pick_runs: the newest two, then the longest
    T = lambda h, m: "2026-10-20T%02d:%02d:00Z" % (h, m)
    rs = [{"id": i, "status": "completed", "conclusion": "success", "created_at": T(10, i), "run_started_at": T(10, i),
           "updated_at": T(10 + (i == 3), i + (5 if i == 5 else 0))} for i in range(10)]
    rs.append({"id": 99, "status": "in_progress", "created_at": T(11, 0)})
    got = [r["id"] for r in pick_runs(rs, 4)]
    ck("pick_runs: newest two, then the longest, newest first", got == [9, 8, 5, 3], got)

    # the archive: a line repeated in the job file and the step file counts once
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("0_run.txt", "2026-10-20T10:00:00.1Z x\n2026-10-20T10:00:01.1Z DELIVERY sender=rp-design sent_readers=1 waiting=1 dry=0 asks=2\n")
        z.writestr("run/5_Send.txt", "2026-10-20T10:00:01.1Z DELIVERY sender=rp-design sent_readers=1 waiting=1 dry=0 asks=2\n")
    got = lines_from_zip(buf.getvalue())
    ck("archive: one line, not two", len(got) == 1 and got[0]["asks"] == 2, got)

    # delivery_rows: a fake API, end to end, and the reuse of a recent pass
    class FakeApi:
        def __init__(self):
            self.calls = []

        def json(self, path):
            self.calls.append(path)
            if "event=workflow_dispatch" in path:
                return {"total_count": 0}
            if "rp-design-email.yml" in path:
                return {"workflow_runs": [{"id": 1, "event": "schedule", "status": "completed", "conclusion": "success",
                                           "created_at": T(9, 0), "run_started_at": T(9, 0), "updated_at": T(9, 2)}]}
            return {"workflow_runs": []}

        def blob(self, path):
            self.calls.append(path)
            b = io.BytesIO()
            with zipfile.ZipFile(b, "w") as z:
                z.writestr("0_send.txt", "2026-10-20T09:01:00.1Z DELIVERY sender=rp-design sent_readers=0 waiting=1 dry=1 asks=1 orders=2\n")
            return b.getvalue()
    now = datetime(2026, 10, 20, 12, 0, tzinfo=UTC)
    fa = FakeApi()
    rows, at = delivery_rows(now, "o/r", "t", "https://api", {"RP_DESIGN_EMAIL_LIVE": "1"}, api=fa)
    by = {r["workflow"]: r for r in rows}
    ck("delivery_rows: one row per sender workflow", len(rows) == len(SENDERS) and at == "2026-10-20T12:00:00Z", len(rows))
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
