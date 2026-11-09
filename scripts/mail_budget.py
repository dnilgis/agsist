#!/usr/bin/env python3
"""
mail_budget.py: two cron-health rows about mail (Nov 9, 2026). Counts only; no address is read into
a row, a log or a file here.

1. brevo-month: the Brevo monthly allowance. Sig upgraded Brevo on Nov 9 to Starter, 5,000 emails a
   month, credits renewing on the 9th. The allowance and the renewal day live in two repository
   variables (cron-health.yml passes them), so a plan change is one edit and no code:

       BREVO_MONTHLY     emails per month on the plan (default DEFAULT_MONTHLY, 5000)
       BREVO_RENEW_DAY   day of the month the credits renew (default DEFAULT_RENEW_DAY, 9)

   Counting. The send-volume row's pass (delivery_check.delivery_rows) reads each sender's run logs
   for the last 24 hours and no further back, so a month cannot be summed from one pass. This row
   keeps a per-UTC-day count in its own saved row (private/data/cron-health.json, branch private-data,
   the file cron-health already pulls and saves each run): each pass takes the day counts from the
   logs it already read (send_cap.tally_days; no API call of its own), keeps the larger of the new
   and the saved count for each day (a day's count only grows; a day half outside a pass's 24 hour
   window keeps the count an earlier pass saw), drops days before the last renewal, and sums what is
   left. Each DELIVERY line counts smtp= (every recipient handed to the mail server, Sig's copies
   too, which is what Brevo bills) else sent_readers=; a dry run counts nothing.

   The window starts at 00:00 UTC on the renewal day. Brevo renews at 13:32 local, so up to about
   a day of mail around each renewal can fall on the wrong side; the row accepts that rounding.

   The count is a floor: delivery_check reads at most LOGS_PER_WF logs per workflow (a sender that
   mails on many runs is sampled), Sig-only mail prints no line, and the row has no days from before
   it was first saved (it says "counted since <day>"). The projection is the count so far plus the
   daily rate (the count over the days counted so far) for the days left before the next renewal.
   It is withheld under MIN_PROJECT_DAYS counted days. Warning when the projection (or the count)
   passes 80% of the allowance, red at 95% of it or when the count passes the allowance.

2. signups-waiting: the Formspree backup form (signup-fallback) is recorded by hand into
   private/pending-signups*.jsonl on feedbag private-data with a status field; restore-signups.yml
   adds them and the status is then rewritten. Warning (never red) when any record still has status
   "pending" and was recorded more than PENDING_HOURS ago (its ts; a record without one is dated by
   its file name's day, else counted as age unknown). Counts and ages only.

   Reading. The cron-health job already has PRIVATE_REPO_TOKEN (it reads the private repo for the
   key and engine rows). One contents-API listing of private/ (names and blob shas) per pass; a file
   is read in full only when its sha differs from the one saved in the row, so a settled file is read
   once. Passes are PASS_HOURS apart (the saved row is reused between them and only its ages are
   recomputed). Nothing but timestamps is saved in the row. If the key cannot list the folder the row
   is unknown and says why (not red, not a warning); the smallest safe fix is then contents:read on
   that one repository for the key, which restore-signups.yml already needs.

    python3 scripts/mail_budget.py --selftest
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass

import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone

UTC = timezone.utc
DEFAULT_MONTHLY = 5000           # Brevo Starter, Nov 9 2026
DEFAULT_RENEW_DAY = 9            # credits renew on the 9th
WARN_PCT = 0.80
RED_PCT = 0.95
MIN_PROJECT_DAYS = 2.0           # fewer counted days than this: no projection stated
PENDING_HOURS = 24
PASS_HOURS = 6                   # delivery_check.DELIVERY_EVERY_HOURS; the saved row is reused between passes
MAX_FILES = 12                   # pending files read in full per pass
MAX_BYTES = 1024 * 1024
MONTH_ROW = "brevo-month"
PENDING_ROW = "signups-waiting"
PRIVATE_REPO = "dnilgis/feedbag"
PRIVATE_BRANCH = "private-data"
FILE_RE = re.compile(r"^pending-signups[A-Za-z0-9._-]*\.jsonl$")
DAY_RE = re.compile(r"(\d{4}-\d{2}-\d{2})")


def _int_var(environ, name, default, lo, hi):
    v = str((environ or {}).get(name) or "").strip()
    return int(v) if v.isdigit() and lo <= int(v) <= hi else default


def allowance(environ=None):
    environ = os.environ if environ is None else environ
    return _int_var(environ, "BREVO_MONTHLY", DEFAULT_MONTHLY, 1, 10 ** 9)


def renew_day(environ=None):
    environ = os.environ if environ is None else environ
    return _int_var(environ, "BREVO_RENEW_DAY", DEFAULT_RENEW_DAY, 1, 28)   # 28: every month has it


def window(now, day):
    """(start, next renewal) as UTC datetimes: the last renewal day at 00:00 UTC at or before now, and the next."""
    start = now.replace(day=day, hour=0, minute=0, second=0, microsecond=0)
    if start > now:
        y, m = (start.year - 1, 12) if start.month == 1 else (start.year, start.month - 1)
        start = start.replace(year=y, month=m)
    y, m = (start.year + 1, 1) if start.month == 12 else (start.year, start.month + 1)
    return start, start.replace(year=y, month=m)


def _d(s):
    return datetime.strptime(s, "%Y-%m-%d").replace(tzinfo=UTC)


def merge_days(prev_days, new_days, start):
    """The larger count per day, for days from the window's start on."""
    out = {}
    first = start.strftime("%Y-%m-%d")
    for src in (prev_days or {}, new_days or {}):
        for d, n in src.items():
            if isinstance(n, int) and not isinstance(n, bool) and d >= first:
                out[d] = max(out.get(d, 0), n)
    return dict(sorted(out.items()))


def judge_month(days, since, now, c, rday, logs=0):
    """The brevo-month row from the kept per-day counts. since: first UTC day counted (YYYY-MM-DD)."""
    start, nxt = window(now, rday)
    sent = sum(days.values())
    first = max(start, _d(since)) if since else start
    counted = max(0.0, (now - first).total_seconds() / 86400)
    left = max(0.0, (nxt - now).total_seconds() / 86400)
    proj = int(round(sent + sent / counted * left)) if counted >= MIN_PROJECT_DAYS else None
    row = {"workflow": MONTH_ROW, "critical": True, "allowance": c, "renew_day": rday,
           "window_start": start.strftime("%Y-%m-%d"), "next_renewal": nxt.strftime("%Y-%m-%d"),
           "since": first.strftime("%Y-%m-%d"), "days": dict(days), "sent": sent, "projected": proj, "logs": int(logs or 0),
           "clock": "emails since the renewal on day %d against the Brevo monthly allowance (BREVO_MONTHLY, default %d); "
                    "warns at %d%% projected, red at %d%% projected or when the count passes it"
                    % (rday, DEFAULT_MONTHLY, int(WARN_PCT * 100), int(RED_PCT * 100))}
    pct = lambda n: int(100 * n / c)
    parts = ["at least %d of %d sent since %s (%d%%, counted since %s, UTC days)" % (
        sent, c, start.strftime("%Y-%m-%d"), pct(sent), first.strftime("%Y-%m-%d"))]
    if proj is None:
        parts.append("projection withheld until %g days are counted (%.1f so far)" % (MIN_PROJECT_DAYS, counted))
    else:
        parts.append("projected %d by the %s renewal (%d%%)" % (proj, nxt.strftime("%Y-%m-%d"), pct(proj)))
    parts.append("a floor: sampled senders and Sig-only mail are not all counted")
    top = max(sent, proj or 0)
    if sent >= c or (proj is not None and proj >= RED_PCT * c):
        status = "late"
    elif top >= WARN_PCT * c:
        status = "warn"
    elif not days and not logs:
        status = "unknown"
        parts = ["no run log was read and nothing is saved for this month, so nothing was counted"]
    else:
        status = "ok"
    row.update(status=status, why="; ".join(parts))
    return row


def month_row(now, runs_by_wf, environ, prev_row=None, tally=None):
    """From the run lists a pass read (delivery_check's read_cache: workflow -> runs) and the saved row.
    tally(runs_by_wf) -> (days, by, markers, logs); send_cap.tally_days by default. No API call."""
    if tally is None:
        import send_cap
        tally = send_cap.tally_days
    c, rday = allowance(environ), renew_day(environ)
    start, _ = window(now, rday)
    key = start.strftime("%Y-%m-%d")
    days, _, _, logs = tally(runs_by_wf) if runs_by_wf else ({}, {}, [], 0)
    old = prev_row or {}
    same = old.get("window_start") == key       # a row saved before a renewal keeps no days for this window
    kept = merge_days(old.get("days") if same else {}, days, start)
    since = old.get("since") if same and old.get("since") else (now - timedelta(days=1)).strftime("%Y-%m-%d")
    return judge_month(kept, since, now, c, rday, logs=logs or (old.get("logs") if same else 0) or 0)


def rejudge_month(row, now, environ=None):
    """A saved row judged again at `now` and against the variables in force now."""
    c, rday = allowance(environ), renew_day(environ)
    start, _ = window(now, rday)
    same = row.get("window_start") == start.strftime("%Y-%m-%d")
    days = merge_days(row.get("days") if same else {}, {}, start)
    return judge_month(days, row.get("since") if same else None, now, c, rday, logs=int(row.get("logs") or 0) if same else 0)


# ───────────────────────────── 2. signups waiting ─────────────────────────────

def _ts(s):
    s = str(s or "").strip().replace("+00:00", "+0000")
    for fmt in ("%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            d = datetime.strptime(s, fmt)
            return d.replace(tzinfo=UTC) if d.tzinfo is None else d.astimezone(UTC)
        except ValueError:
            continue
    return None


def pending_stamps(name, text):
    """Timestamps (ISO strings, or None for age unknown) of the records still pending in one file's text.
    Reads status and ts only; no other field leaves this function."""
    fallback = None
    m = DAY_RE.search(name)
    if m:
        fallback = m.group(1) + "T23:59:59Z"       # the end of the file's day: never older than it is
    out = []
    for line in (text or "").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        if not isinstance(rec, dict):
            continue
        st = str(rec.get("status") or "").strip().lower()
        if not (st == "pending" or st.startswith("pending ") or st.startswith("pending:")):
            continue
        t = _ts(rec.get("ts"))
        out.append(t.strftime("%Y-%m-%dT%H:%M:%SZ") if t else fallback)
    return out


def judge_pending(files, now, checked_at, why_extra=""):
    """The signups-waiting row from {file name: {"sha", "pending": [iso or None]}}."""
    stamps = [t for f in files.values() for t in f.get("pending") or []]
    old = unknown = 0
    oldest = None
    for t in stamps:
        d = _ts(t) if t else None
        if d is None:
            unknown += 1
            continue
        h = (now - d).total_seconds() / 3600
        if h > PENDING_HOURS:
            old += 1
        oldest = h if oldest is None else max(oldest, h)
    row = {"workflow": PENDING_ROW, "critical": False, "checked_at": checked_at, "files": files,
           "pending": len(stamps), "over_24h": old, "age_unknown": unknown,
           "clock": "no backup-form signup stays 'pending' in private-data for more than %d h (restore-signups.yml adds them)" % PENDING_HOURS}
    if old or unknown:
        bits = []
        if old:
            bits.append("%d over %d h (oldest %d h)" % (old, PENDING_HOURS, int(oldest or 0)))
        if unknown:
            bits.append("%d with no date" % unknown)
        row.update(status="warn", why="backup-form signups still pending: %s; run restore-signups.yml and set their status%s"
                   % (", ".join(bits), why_extra))
    else:
        row.update(status="ok", why="%d backup-form signup(s) pending, none over %d h; %d file(s) read%s"
                   % (len(stamps), PENDING_HOURS, len(files), why_extra))
    return row


def _api(url, token, accept):
    req = urllib.request.Request(url, headers={
        "Accept": accept, "Authorization": "Bearer %s" % token,
        "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "agsist-cron-health"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read(MAX_BYTES).decode("utf-8", "replace")


def _api_json(url, token):
    return json.loads(_api(url, token, "application/vnd.github+json"))


def _api_raw(url, token):
    return _api(url, token, "application/vnd.github.raw+json")


def pending_row(now, token, prev_row=None, api="https://api.github.com", get_json=None, get_raw=None):
    """signups-waiting. Between passes (PASS_HOURS) the saved row is reused and only the ages move."""
    get_json, get_raw = get_json or _api_json, get_raw or _api_raw
    base = {"workflow": PENDING_ROW, "critical": False,
            "clock": "no backup-form signup stays 'pending' in private-data for more than %d h" % PENDING_HOURS}
    if not token:
        return dict(base, status="unknown", why="PRIVATE_REPO_TOKEN was not given to this job; the pending signups were not read")
    try:
        at = datetime.strptime((prev_row or {}).get("checked_at", ""), "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)
        if prev_row.get("files") is not None and timedelta(0) <= now - at < timedelta(hours=PASS_HOURS):
            return judge_pending(prev_row["files"], now, prev_row["checked_at"])
    except Exception:                                      # noqa: BLE001
        pass
    prev_files = (prev_row or {}).get("files") or {}
    try:
        listing = get_json("%s/repos/%s/contents/private?ref=%s" % (api, PRIVATE_REPO, PRIVATE_BRANCH), token)
        if not isinstance(listing, list):
            raise ValueError("not a folder listing")
    except Exception as e:                                 # noqa: BLE001
        code = getattr(e, "code", None)
        return dict(base, status="unknown",
                    why="could not list private/ on %s %s (%s); the key needs contents:read on that repository"
                        % (PRIVATE_REPO, PRIVATE_BRANCH, ("HTTP %s" % code) if code else type(e).__name__))
    names = sorted((f for f in listing if isinstance(f, dict) and f.get("type") == "file" and FILE_RE.match(str(f.get("name", "")))),
                   key=lambda f: f["name"])
    files, failed, skipped, reads = {}, [], 0, 0
    for f in names:
        n, sha = f["name"], f.get("sha")
        if sha and (prev_files.get(n) or {}).get("sha") == sha:
            files[n] = prev_files[n]
            continue
        if reads >= MAX_FILES:
            skipped += 1
            continue
        reads += 1
        try:
            text = get_raw("%s/repos/%s/contents/private/%s?ref=%s" % (api, PRIVATE_REPO, n, PRIVATE_BRANCH), token)
            files[n] = {"sha": sha, "pending": pending_stamps(n, text)}
        except Exception:                                  # noqa: BLE001
            failed.append(n)
            if n in prev_files:
                files[n] = prev_files[n]
    bad = len(failed) + skipped
    extra = ("; %d file(s) could not be read this pass" % bad) if bad else ""
    row = judge_pending(files, now, now.strftime("%Y-%m-%dT%H:%M:%SZ"), why_extra=extra)
    if bad and row["status"] == "ok":
        row["status"] = "unknown"
        row["why"] = "could not read every pending-signups file this pass (%d of %d), so none overdue is not proven" % (bad, len(names))
    return row


# ───────────────────────────── selftest ─────────────────────────────

def selftest():
    fails = []

    def ck(what, cond, info=""):
        print(("ok   " if cond else "FAIL ") + what + ("" if cond else "  " + str(info)))
        if not cond:
            fails.append(what)

    T = lambda s: datetime.strptime(s, "%Y-%m-%d %H:%M").replace(tzinfo=UTC)
    D = lambda **k: {"2026-11-%02d" % int(d[1:]): n for d, n in k.items()}   # D(d09=50) -> {"2026-11-09": 50}
    # config in one place
    ck("allowance defaults to 5000", allowance({}) == 5000 and allowance({"BREVO_MONTHLY": ""}) == 5000)
    ck("allowance reads BREVO_MONTHLY", allowance({"BREVO_MONTHLY": "25000"}) == 25000)
    ck("a bad allowance falls back", allowance({"BREVO_MONTHLY": "lots"}) == 5000 and allowance({"BREVO_MONTHLY": "0"}) == 5000)
    ck("renew day defaults to 9, reads the variable, ignores nonsense",
       renew_day({}) == 9 and renew_day({"BREVO_RENEW_DAY": "15"}) == 15 and renew_day({"BREVO_RENEW_DAY": "31"}) == 9)
    # the renewal window
    ck("on the 9th the window starts that day", window(T("2026-11-09 05:00"), 9) == (T("2026-11-09 00:00"), T("2026-12-09 00:00")))
    ck("before the 9th it started last month", window(T("2026-11-08 23:59"), 9) == (T("2026-10-09 00:00"), T("2026-11-09 00:00")))
    ck("across the new year", window(T("2027-01-03 12:00"), 9) == (T("2026-12-09 00:00"), T("2027-01-09 00:00"))
       and window(T("2026-12-20 12:00"), 9) == (T("2026-12-09 00:00"), T("2027-01-09 00:00")))
    ck("days before the renewal are dropped",
       merge_days({"2026-11-08": 300, "2026-11-09": 10}, {"2026-11-09": 40, "2026-11-10": 5}, T("2026-11-09 00:00"))
       == {"2026-11-09": 40, "2026-11-10": 5})

    fake_tally = lambda per_day: (lambda runs: (dict(per_day), {}, [], 3))
    now = T("2026-11-12 00:00")        # 3 days into the window, 27 left
    r = judge_month(D(d09=300, d10=300, d11=300), "2026-11-09", now, 5000, 9)
    ck("900 in 3 days projects 9000: red", r["projected"] == 900 + 300 * 27 and r["status"] == "late", r)
    r = judge_month(D(d09=100, d10=100, d11=100), "2026-11-09", now, 5000, 9)
    ck("100 a day projects 3000 (60%): ok", r["projected"] == 3000 and r["status"] == "ok", r)
    r = judge_month(D(d09=130, d10=130, d11=130), "2026-11-09", now, 5000, 9)
    ck("130 a day projects 3900 (78%): ok, just under", r["projected"] == 3900 and r["status"] == "ok", r)
    r = judge_month(D(d09=135, d10=135, d11=135), "2026-11-09", now, 5000, 9)
    ck("135 a day projects 4050 (81%): warn", r["projected"] == 4050 and r["status"] == "warn", r)
    r = judge_month(D(d09=158, d10=158, d11=158), "2026-11-09", now, 5000, 9)
    ck("158 a day projects 4740 (94.8%): still warn", r["projected"] == 4740 and r["status"] == "warn", r)
    r = judge_month(D(d09=159, d10=159, d11=159), "2026-11-09", now, 5000, 9)
    ck("159 a day projects 4770 (95.4%): red", r["projected"] == 4770 and r["status"] == "late", r)
    r = judge_month(D(d09=1000, d10=2000, d11=2100), "2026-11-09", now, 5000, 9)
    ck("sent past the allowance is red", r["sent"] == 5100 and r["status"] == "late", r)
    r = judge_month(D(d09=4100), "2026-11-09", T("2026-11-09 12:00"), 5000, 9)
    ck("under 2 days counted: no projection, but 4100 of 5000 sent is a warning",
       r["projected"] is None and r["status"] == "warn" and "projection withheld" in r["why"], r)
    r = judge_month(D(d09=40), "2026-11-09", T("2026-11-09 12:00"), 5000, 9)
    ck("a quiet first half day is ok, projection withheld", r["status"] == "ok" and r["projected"] is None, r)
    r = judge_month({}, "2026-11-09", T("2026-11-20 12:00"), 5000, 9)
    ck("nothing read, nothing saved: unknown, not ok", r["status"] == "unknown", r)
    r = judge_month({}, "2026-11-09", T("2026-11-20 12:00"), 5000, 9, logs=4)
    ck("logs read and no mail counted: ok, projection 0", r["status"] == "ok" and r["projected"] == 0, r)
    r = judge_month(D(d09=300, d10=300, d11=300), "2026-11-09", now, 25000, 9)
    ck("a plan change is one variable: the same sends are fine against 25000", r["status"] == "ok" and r["allowance"] == 25000, r)
    r = judge_month({"2026-11-20": 200, "2026-11-21": 200}, "2026-11-20", T("2026-11-22 00:00"), 5000, 9)
    ck("counting began on the 20th: 400 over 2 days projects 400+200*17=3800",
       r["projected"] == 3800 and r["since"] == "2026-11-20", r)
    old = judge_month(D(d09=4000), "2026-11-09", T("2026-12-08 12:00"), 5000, 9, logs=3)
    rr = month_row(T("2026-12-09 06:00"), {"x.yml": []}, {}, old, tally=fake_tally({"2026-12-09": 20}))
    ck("a new window starts clean at the renewal", rr["sent"] == 20 and rr["window_start"] == "2026-12-09" and rr["status"] == "ok", rr)
    ck("rejudge on a later day keeps the days, moves the clock", rejudge_month(rr, T("2026-12-12 06:00"))["sent"] == 20)
    ck("rejudge after a renewal drops last window's days", rejudge_month(old, T("2026-12-09 06:00"))["sent"] == 0)
    p = month_row(T("2026-11-10 06:00"), {"x.yml": []}, {}, None, tally=fake_tally({"2026-11-09": 150, "2026-11-10": 20}))
    q = month_row(T("2026-11-10 12:00"), {"x.yml": []}, {}, p, tally=fake_tally({"2026-11-09": 40, "2026-11-10": 90}))
    ck("each day keeps its larger count", q["days"] == {"2026-11-09": 150, "2026-11-10": 90} and q["sent"] == 240, q)
    ck("the first pass counted from the day before", p["since"] == "2026-11-09", p)
    ck("later passes keep the first day counted", q["since"] == "2026-11-09", q)
    runs = {"daily.yml": [{"id": 1, "created_at": "2026-11-10T09:00:00Z",
                           "lines": [{"sender": "daily", "sent_readers": 200, "smtp": 203, "dry": 0},
                                     {"sender": "other", "sent_readers": 0, "dry": 1}]}],
            "price-watch.yml": [{"id": 2, "created_at": "2026-11-10T10:00:00Z",
                                 "lines": [{"sender": "pw", "sent_readers": 7, "dry": 0}]}]}
    z = month_row(T("2026-11-10 12:00"), runs, {}, None)
    ck("smtp= counts when present, sent_readers= otherwise, dry counts 0", z["days"] == {"2026-11-10": 210}, z)
    z = month_row(T("2026-11-10 12:00"), {}, {}, q)
    ck("a pass that read no run keeps the saved days", z["sent"] == 240 and z["status"] == "ok", z)

    # signups waiting
    rec = lambda status, ts=None: json.dumps(dict({"email": "x@example.invalid", "list": "AGSIST Daily", "status": status},
                                                  **({"ts": ts} if ts else {})))
    txt = "\n".join([rec("pending", "2026-11-08T10:00:00Z"), rec("added Nov 9 16:57 UTC by restore-signups.yml"),
                     rec("pending", "2026-11-09T20:00:00Z"), rec("checked Nov 9 by restore-signups.yml run 1"), "", "not json"])
    ck("only pending records are kept, as timestamps",
       pending_stamps("pending-signups.jsonl", txt) == ["2026-11-08T10:00:00Z", "2026-11-09T20:00:00Z"])
    ck("no ts: the file name's day, end of day", pending_stamps("pending-signups-2026-10-27.jsonl", rec("pending")) == ["2026-10-27T23:59:59Z"])
    ck("no ts and no day in the name: age unknown", pending_stamps("pending-signups.jsonl", rec("pending")) == [None])
    ck("a timestamp is read in other common forms", pending_stamps("p.jsonl", rec("pending", "2026-11-08 10:00:00")) == ["2026-11-08T10:00:00Z"])
    ck("no address in anything kept", "example.invalid" not in json.dumps(pending_stamps("pending-signups.jsonl", txt)))
    now = T("2026-11-09 23:00")
    f = lambda *t: {"pending-signups.jsonl": {"sha": "a", "pending": list(t)}}
    e = judge_pending({}, now, "x")
    ck("empty data: ok, nothing pending", e["status"] == "ok" and e["pending"] == 0, e)
    ck("a file with nothing pending is ok", judge_pending(f(), now, "x")["status"] == "ok")
    r = judge_pending(f("2026-11-09T00:00:01Z"), now, "x")
    ck("pending 23 h is ok", r["status"] == "ok" and r["over_24h"] == 0, r)
    r = judge_pending(f("2026-11-08T22:59:59Z"), now, "x")
    ck("pending just over 24 h warns, never red", r["status"] == "warn" and r["over_24h"] == 1 and not r["critical"], r)
    r = judge_pending(f("2026-11-08T22:00:00Z", "2026-11-09T22:00:00Z", "2026-11-01T00:00:00Z"), now, "x")
    ck("counts only the overdue ones (2 of 3), oldest named", r["over_24h"] == 2 and r["pending"] == 3 and "oldest 215 h" in r["why"], r)
    r = judge_pending(f(None), now, "x")
    ck("a pending record with no date warns", r["status"] == "warn" and r["age_unknown"] == 1, r)
    ck("the row holds no address", "@" not in json.dumps(r))

    class Http(Exception):
        def __init__(self, code):
            self.code = code
    NOW = T("2026-11-10 12:00")
    listing = [{"type": "file", "name": "pending-signups.jsonl", "sha": "s1"}, {"type": "file", "name": "pending-signups-2026-11-09.jsonl", "sha": "s2"},
               {"type": "dir", "name": "pending-signups-dir", "sha": "s3"}, {"type": "file", "name": "other.jsonl", "sha": "s4"}]
    texts = {"pending-signups.jsonl": rec("added x"), "pending-signups-2026-11-09.jsonl": rec("pending", "2026-11-08T08:00:00Z")}
    calls = []

    def gj(url, tok):
        calls.append(url)
        assert tok == "k" and "/contents/private?ref=private-data" in url, url
        return listing

    def gr(url, tok):
        calls.append(url)
        return texts[url.split("/private/")[1].split("?")[0]]
    r = pending_row(NOW, "k", None, get_json=gj, get_raw=gr)
    ck("a pass lists once and reads each pending-signups file", len(calls) == 3 and r["status"] == "warn" and r["pending"] == 1, (calls, r))
    calls.clear()
    r2 = pending_row(NOW + timedelta(hours=7), "k", r, get_json=gj, get_raw=gr)
    ck("next pass: one listing call, no file re-read when the sha is unchanged", len(calls) == 1 and r2["pending"] == 1, calls)
    calls.clear()
    r3 = pending_row(NOW + timedelta(hours=1), "k", r, get_json=gj, get_raw=gr)
    ck("inside the pass window: no call, ages move", not calls and r3["pending"] == 1, calls)
    ck("a settled record clears the row",
       pending_row(NOW + timedelta(hours=7), "k", r, get_json=lambda u, t: [dict(listing[1], sha="s9")],
                   get_raw=lambda u, t: rec("added Nov 10 by restore-signups.yml"))["status"] == "ok")
    r = pending_row(NOW, "", None, get_json=gj, get_raw=gr)
    ck("no token: unknown, says so", r["status"] == "unknown" and "PRIVATE_REPO_TOKEN" in r["why"], r)

    def deny(url, tok):
        raise Http(404)
    r = pending_row(NOW, "k", None, get_json=deny, get_raw=gr)
    ck("the key cannot list the folder: unknown with the reason, not red",
       r["status"] == "unknown" and "HTTP 404" in r["why"] and not r["critical"], r)

    def badread(url, tok):
        raise Http(502)
    r = pending_row(NOW, "k", None, get_json=gj, get_raw=badread)
    ck("a file that cannot be read is unknown, never a false ok", r["status"] == "unknown" and "could not read" in r["why"], r)
    r = pending_row(NOW, "k", None, get_json=lambda u, t: [], get_raw=gr)
    ck("no pending files at all: ok", r["status"] == "ok" and r["pending"] == 0, r)
    print("mail_budget selftest: %d failed" % len(fails))
    return 1 if fails else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    print(__doc__.strip().splitlines()[0])
    sys.exit(0)
