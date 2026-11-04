#!/usr/bin/env python3
"""
send_cap.py: the mail plan's daily cap (Nov 4, 2026).

Every AGSIST sender goes out through one Brevo SMTP account (secrets.SMTP_HOST). On the free plan
Brevo allows 300 emails a day, marketing and transactional together, and the count resets at 00:00
UTC. On Nov 4 the account showed 211 used: the Daily's 209 and 2 more. A report day (the Daily plus
the report-day email to the same readers), a busy alert day or a test send can reach the cap, and
then a send stops partway down its list. The cap is the repository variable SEND_DAILY_CAP (default
300), so an upgrade needs only that variable changed.

Three parts:

1. SMTP volume per run. The start() of delivery_line.py calls install(tally) when the sender is the program
   run. It wraps smtplib.SMTP for that process only: every recipient a send hands to the server
   (Sig's copies too) adds to the DELIVERY line's smtp= count, and a refusal that looks like the cap
   prints one marker line and adds to cap_refused=.

2. The marker line, counts only (never an address):

       SEND-CAP sender=<name> kind=refused code=<SMTP code> sent=<this run so far>
       SEND-CAP sender=<name> kind=preflight used=<counted today> size=<this send> later=<due later> cap=<cap>

   kind=refused: the server refused with a reply that looks like a quota or rate limit. smtplib
   raises SMTPSenderRefused (MAIL FROM), SMTPRecipientsRefused (every RCPT TO; its .recipients maps
   each address to (code, text), and only the codes are read), SMTPDataError (DATA), and on a 421
   it closes the connection first and raises the same classes with smtp_code 421. Brevo does not
   publish the reply it gives at the daily cap (searched Nov 4: its help pages give the 300 a day, not
   the reply), so a refusal counts as the cap when its text names a quota, limit, credit, rate or
   "too many" with any 4xx or 5xx code, or when a send (not a connect or login) gets a bare 421 or
   451, the codes relays use for "slow down". When Brevo's real reply is seen in a log, pin it in the
   selftest.

   kind=preflight: before a send of PREFLIGHT_MIN or more readers, the count already sent today (the
   send-volume row cron_health.py saved in the private repo, a floor: see 3) plus this send's list,
   plus a send known to be coming the same UTC day (the report-day email on a report day, from the
   Daily), would pass the cap. A ::warning:: and the marker print, and the send still goes: the cap
   can be out of date after an upgrade, and a reader is better served by a send that may stop
   partway than by none. The marker makes the send-volume row red early.

3. The send-volume row (cron_health.py, built in delivery_check.delivery_rows from the run logs it
   already reads; no extra API calls). Per UTC day, the sum over every DELIVERY line read of smtp=
   (or sent_readers= from a line without it), against the cap. It is a floor: delivery_check reads
   at most LOGS_PER_WF logs per workflow, so a sender that mails on many runs (report-day, the
   alert senders) is sampled, and the Sig-only workflows (morning report, audit and the rest) print
   no line. The row says which senders were sampled. Warning at WARN_PCT of the cap, red at RED_PCT,
   and red on any SEND-CAP marker in the runs read.

4. Sig's reminder to upgrade (Sig, Nov 4: "remind me to upgrade Brevo as we get closer to the daily
   limit"). cron-health.yml, after the check, runs --remind on the saved file: 80% of the cap on a UTC
   day mails Sig once that day, 95% once more marked urgent, and the Daily's own average over the last
   7 whole days at 70% a gentler heads-up once a week. Through log_safe.owner_mail, the path the
   daily-late check uses; deduped by the send flags. None once SEND_DAILY_CAP is above the day's count.

    python3 scripts/send_cap.py --selftest
    python3 scripts/send_cap.py --remind private/data/cron-health.json
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass

import json
import os
import re
import smtplib
import sys
from datetime import datetime, timezone

UTC = timezone.utc
DEFAULT_CAP = 300                 # Brevo free plan, Nov 4 2026
WARN_PCT = 0.80
RED_PCT = 0.95
HIST_DAYS = 8                     # the Daily's count kept per UTC day (7 whole days and today)
EARLY_PCT = 0.70                  # the Daily's 7-day average: a gentle heads-up, once a week
EARLY_MIN_DAYS = 3                # whole days needed before an average is stated
PREFLIGHT_MIN = 20                # sends to fewer readers skip the preflight (no private repo read)
HEALTH_PATH = "private/data/cron-health.json"
ROW = "send-volume"

MARKER_RE = re.compile(r"\bSEND-CAP sender=([a-z0-9][a-z0-9-]{0,40}) kind=(refused|preflight)((?: [a-z_]{1,20}=\d{1,9})*)\s*$")
QUOTA_WORDS = re.compile(r"\b(quota|limits?|limited|exceed(?:ed|s)?|credits?|rate|too many|throttl\w*)\b", re.I)
RATE_CODES = (421, 451)


def cap(environ=None, fallback=None):
    """The cap: SEND_DAILY_CAP when it is a whole number above 0, else `fallback`, else DEFAULT_CAP."""
    environ = os.environ if environ is None else environ
    v = str(environ.get("SEND_DAILY_CAP") or "").strip()
    if v.isdigit() and int(v) > 0:
        return int(v)
    return int(fallback) if isinstance(fallback, int) and fallback > 0 else DEFAULT_CAP


def _codes(ex):
    """(code, text) pairs from an smtplib exception. Recipient addresses are never read."""
    if isinstance(ex, smtplib.SMTPRecipientsRefused):
        out = []
        for v in (ex.recipients or {}).values():
            try:
                c, t = v
                out.append((int(c), t.decode("utf-8", "replace") if isinstance(t, bytes) else str(t)))
            except Exception:                              # noqa: BLE001
                continue
        return out
    if isinstance(ex, smtplib.SMTPResponseException):
        t = ex.smtp_error
        return [(int(ex.smtp_code), t.decode("utf-8", "replace") if isinstance(t, bytes) else str(t))]
    return []


def cap_code(ex, during="send"):
    """The SMTP code when `ex` looks like a quota or rate refusal, else None. `during` is
    send, connect or login: a bare 421 or 451 counts only during a send."""
    for code, text in _codes(ex):
        if 400 <= code < 600 and QUOTA_WORDS.search(text or ""):
            return code
        if during == "send" and code in RATE_CODES:
            return code
    return None


def marker(sender, kind, **counts):
    parts = ["SEND-CAP sender=%s kind=%s" % (sender, kind)]
    for k in sorted(counts):
        v = counts[k]
        if re.match(r"^[a-z_]{1,20}$", k) and isinstance(v, int) and not isinstance(v, bool):
            parts.append("%s=%d" % (k, max(0, v)))
    return " ".join(parts)


def parse(text):
    """Every SEND-CAP marker in a log -> [{"sender", "kind", counts...}]."""
    out = []
    for raw in (text or "").splitlines():
        m = MARKER_RE.search(raw.rstrip("\r"))
        if not m:
            continue
        d = {"sender": m.group(1), "kind": m.group(2)}
        for kv in m.group(3).split():
            k, v = kv.split("=", 1)
            d[k] = int(v)
        out.append(d)
    return out


# ───────────────────────────── 1. the per-run SMTP wrapper ─────────────────────────────

STATE = {"tally": None, "printed": set(), "preflight": False, "installed": False}


def _out(s):
    try:
        print(s, flush=True)
    except Exception:                                      # noqa: BLE001  never break a send
        pass


def note_refusal(ex, during="send"):
    """Count a cap-like refusal on the tally and print the marker once per run."""
    t = STATE["tally"]
    code = cap_code(ex, during)
    if t is None or code is None:
        return None
    t.extra["cap_refused"] = t.extra.get("cap_refused", 0) + 1
    if "refused" not in STATE["printed"]:
        STATE["printed"].add("refused")
        _out("::error title=Mail plan daily cap::the mail server refused a send with code %d, which looks like "
             "the plan's daily cap or a rate limit; the rest of this list may not go out" % code)
        _out(marker(t.sender, "refused", code=code, sent=t.extra.get("smtp", 0)))
    return code


def _accepted(to_addrs, refused):
    n = 1 if isinstance(to_addrs, str) else len(list(to_addrs or []))
    try:
        n -= len(refused or {})
    except TypeError:
        pass
    return max(0, n)


def install(tally, smtp_cls=None):
    """Wrap smtplib.SMTP (sendmail, login, connect) for this process. Idempotent."""
    STATE["tally"] = tally
    cls = smtp_cls or smtplib.SMTP
    if getattr(cls, "_send_cap_wrapped", False):
        return
    send0, login0, connect0 = cls.sendmail, cls.login, cls.connect

    def sendmail(self, from_addr, to_addrs, msg, *a, **k):
        t = STATE["tally"]
        if t is not None and not STATE["preflight"]:
            try:
                preflight(t)                               # once per run, at the first send
            except Exception:                              # noqa: BLE001
                STATE["preflight"] = True
        try:
            refused = send0(self, from_addr, to_addrs, msg, *a, **k)
        except Exception as ex:
            note_refusal(ex, "send")
            raise
        if t is not None:
            t.extra["smtp"] = t.extra.get("smtp", 0) + _accepted(to_addrs, refused)
        return refused

    def login(self, *a, **k):
        try:
            return login0(self, *a, **k)
        except Exception as ex:
            note_refusal(ex, "login")
            raise

    def connect(self, *a, **k):
        try:
            return connect0(self, *a, **k)
        except Exception as ex:
            note_refusal(ex, "connect")
            raise
    cls.sendmail, cls.login, cls.connect = sendmail, login, connect
    cls._send_cap_wrapped = True
    STATE["installed"] = True


# ───────────────────────────── 2. preflight ─────────────────────────────

def _read_health():
    """The saved cron-health doc from the private repo, or None. Only with PRIVATE_REPO_TOKEN or
    RAW_REMOTE set: without them list_source would read origin's old branch."""
    p = os.environ.get("SEND_CAP_HEALTH_FILE")
    if p:
        with open(p, encoding="utf-8") as fh:
            return json.load(fh)
    if not (os.environ.get("PRIVATE_REPO_TOKEN") or os.environ.get("RAW_REMOTE")):
        return None
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import list_source
    raw = list_source._show(HEALTH_PATH)
    return json.loads(raw.decode("utf-8")) if raw else None


def known_today(doc, now):
    """(count already sent today, the cap the row was judged on) from a cron-health doc, or (None, cap)."""
    row = next((r for r in (doc or {}).get("workflows") or [] if r.get("workflow") == ROW), None)
    if not row:
        return None, None
    rcap = row.get("cap") if isinstance(row.get("cap"), int) else None
    v = (row.get("days") or {}).get(now.strftime("%Y-%m-%d"))
    return (int(v) if isinstance(v, int) else None), rcap


def preflight(tally, later=0, later_what="", now=None, doc=None, environ=None):
    """Warn (and print the marker) when today's count plus this send would pass the cap. Never stops
    the send. Runs once per process. -> dict of what it judged."""
    if STATE["preflight"]:
        return None
    STATE["preflight"] = True
    environ = os.environ if environ is None else environ
    size = int(getattr(tally, "waiting", 0) or 0)
    if tally.dry or size + int(later or 0) < PREFLIGHT_MIN:
        return None
    now = now or datetime.now(UTC)
    used, rcap, why = None, None, ""
    try:
        doc = doc if doc is not None else _read_health()
        used, rcap = known_today(doc, now)
        if doc is None:
            why = "the saved count could not be read"
        elif used is None:
            why = "no count saved for today yet"
    except Exception as ex:                                # noqa: BLE001
        why = "the saved count could not be read (%s)" % type(ex).__name__
    c = cap(environ, rcap)
    total = (used or 0) + size + int(later or 0)
    out = {"used": used, "size": size, "later": int(later or 0), "cap": c, "total": total, "over": total > c}
    _out("send cap: %s already counted today (UTC), this send %d%s, cap %d%s"
         % ("unknown" if used is None else str(used), size,
            (", %s later today %d" % (later_what or "a send", later)) if later else "", c,
            ("; " + why) if why else ""))
    if out["over"]:
        _out("::warning title=Mail plan daily cap::%d emails projected today (UTC) against a cap of %d: "
             "%s counted already, %d in this send%s. The send goes on; past the cap the mail server stops it "
             "partway. Raise the plan (and the SEND_DAILY_CAP variable) or move a send."
             % (total, c, "unknown" if used is None else str(used), size,
                (", %d from %s later today" % (later, later_what or "a send")) if later else ""))
        _out(marker(tally.sender, "preflight", used=used or 0, size=size, later=int(later or 0), cap=c))
    return out


# ───────────────────────────── 3. the send-volume row ─────────────────────────────

def line_volume(l):
    """Emails one DELIVERY line says went to the mail server: smtp= when the line has it, else sent_readers."""
    return int(l["smtp"]) if isinstance(l.get("smtp"), int) else int(l.get("sent_readers") or 0)


def tally_days(runs_by_wf):
    """runs_by_wf: {workflow: [run dicts with created_at, lines, caps]} -> (days, by_sender, markers, logs_read).
    days {YYYY-MM-DD: count}; by_sender {day: {sender: count}}; markers [{day, sender, kind, ...}]."""
    days, by, markers, logs = {}, {}, [], 0
    for wf, runs in runs_by_wf.items():
        for r in runs or []:
            if r.get("lines") is None:
                continue
            logs += 1
            day = str(r.get("created_at") or "")[:10]
            if len(day) != 10:
                continue
            for l in r["lines"]:
                n = line_volume(l)
                days[day] = days.get(day, 0) + n
                if n:
                    s = by.setdefault(day, {})
                    s[l["sender"]] = s.get(l["sender"], 0) + n
            for m in r.get("caps") or []:
                markers.append(dict(m, day=day, run=r.get("id")))
    return days, by, markers, logs


def judge(days, by, markers, c, now, logs=None, sampled=(), unread=(), daily7=None):
    """The send-volume row. Status from the busiest UTC day in the window: warn at WARN_PCT of the
    cap, late (red) at RED_PCT; late on any marker. unknown when no log was read at all."""
    row = {"workflow": ROW, "critical": True, "cap": c, "days": dict(sorted(days.items())),
           "top": {d: sorted(s.items(), key=lambda kv: (-kv[1], kv[0]))[:5] for d, s in sorted(by.items())},
           "markers": markers[:10], "logs": int(logs or 0), "sampled": sorted(sampled), "unread": sorted(unread),
           "daily7": dict(sorted((daily7 or {}).items())[-HIST_DAYS:]),
           "clock": "emails per UTC day under the mail plan's cap (SEND_DAILY_CAP, default %d); warns at %d%%, red at %d%%"
                    % (DEFAULT_CAP, int(WARN_PCT * 100), int(RED_PCT * 100))}
    today = now.strftime("%Y-%m-%d")
    parts = []
    for d in sorted(days, reverse=True)[:2]:
        top = ", ".join("%s %d" % kv for kv in row["top"].get(d, [])[:3])
        parts.append("%s%s: at least %d of %d (%d%%)%s" % (d, " so far" if d == today else "", days[d], c,
                                                        int(100 * days[d] / c), (": " + top) if top else ""))
    refused = [m for m in markers if m["kind"] == "refused"]
    pre = [m for m in markers if m["kind"] == "preflight"]
    notes = []
    if refused:
        notes.append("the mail server refused a send like a cap or rate limit: %s"
                     % ", ".join("%s on %s (code %s)" % (m["sender"], m["day"], m.get("code", "?")) for m in refused[:3]))
    if pre:
        notes.append("projected past the cap before sending: %s"
                     % ", ".join("%s on %s (%d counted + %d + %d later, cap %d)" % (
                         m["sender"], m["day"], m.get("used", 0), m.get("size", 0), m.get("later", 0), m.get("cap", c))
                                 for m in pre[:3]))
    tail = ["counted from %d run log(s) read" % (logs or 0)]
    if sampled:
        tail.append("sampled, more may have gone: %s" % ", ".join(sorted(sampled)))
    if unread:
        tail.append("not read this pass: %s" % ", ".join(sorted(unread)))
    tail.append("Sig-only mail (morning report, audit and the like) prints no count")
    peak = max(days.values()) if days else 0
    if not logs and not markers:
        status = "unknown"
        parts = ["no run log was read, so nothing was counted"]
    elif refused or pre or peak >= RED_PCT * c:
        status = "late"
    elif peak >= WARN_PCT * c:
        status = "warn"
    else:
        status = "ok"
    if not parts:
        parts = ["no email counted in the runs read"]
    row.update(status=status, why="; ".join(notes + parts + tail))
    return row


def rejudge(row, now, environ=None):
    """A saved row judged again against the cap in force now (the variable may have changed)."""
    c = cap(environ)
    by = {d: dict(v) for d, v in (row.get("top") or {}).items()}
    return judge(dict(row.get("days") or {}), by, list(row.get("markers") or []), c, now,
                 logs=int(row.get("logs") or 0), sampled=row.get("sampled") or (), unread=row.get("unread") or (),
                 daily7=row.get("daily7"))


def daily_history(prev_row, by):
    """The Daily's own count per UTC day, carried from pass to pass in the row (daily7), so a 7-day
    average needs no extra reads. Counts only grow within a day, so the larger of the two is kept."""
    h = {d: int(n) for d, n in ((prev_row or {}).get("daily7") or {}).items() if isinstance(n, int)}
    for d, s in (by or {}).items():
        n = int(dict(s).get("daily", 0))
        if n:
            h[d] = max(h.get(d, 0), n)
    return dict(sorted(h.items())[-HIST_DAYS:])


# ───────────────────────────── 4. remind Sig to upgrade (Sig, Nov 4) ─────────────────────────────
# "remind me to upgrade Brevo as we get closer to the daily limit." The path is the one cron-health's
# daily-late check already uses to tell Sig things: log_safe.owner_mail (the job's SMTP secrets, to
# SIG_TO). Once per level per UTC day, deduped through the send flags (list_source.flag_is_set /
# flag_set: the subs worker, else the private repo); a flag that cannot be read sends nothing, so a
# reminder never repeats every half hour. Counts only.

def _pct(n, c):
    return int(100 * n / c) if c else 0


def reminders(doc, now, environ=None):
    """[(flag key, subject, lines)] due from a cron-health doc. Pure: no network, no flags read.
    80% of the cap on a UTC day: a reminder; 95%: an urgent one (the 80% one is then not sent). The
    cap is the one in force now, so raising SEND_DAILY_CAP above the day's count stops them. Below
    80% on every day, the Daily's own average over the last 7 whole UTC days at EARLY_PCT or more
    is a gentler heads-up, once per ISO week."""
    row = next((r for r in (doc or {}).get("workflows") or [] if r.get("workflow") == ROW), None)
    if not row:
        return []
    c = cap(environ, row.get("cap") if isinstance(row.get("cap"), int) else None)
    today = now.strftime("%Y-%m-%d")
    out, near = [], False
    for d, n in sorted((row.get("days") or {}).items()):
        if not isinstance(n, int) or n < WARN_PCT * c:
            continue
        near = True
        when = "today" if d == today else "on %s (UTC)" % d
        urgent = n >= RED_PCT * c
        text = ("AGSIST sent %d of your %d Brevo emails %s (%d%%). Time to upgrade Brevo (Starter removes the "
                "daily cap), then set the repo variable SEND_DAILY_CAP to the new limit." % (n, c, when, _pct(n, c)))
        lines = [("Urgent: " + text) if urgent else text, "",
                 "Past the cap Brevo stops the sends partway down the list, and the readers at the end get nothing.",
                 "The count is read from the senders' run logs and is a floor: the real number can be higher."]
        out.append(("sendcap-%d:%s" % (95 if urgent else 80, d),
                    "%sAGSIST: %d of %d Brevo emails %s" % ("URGENT: " if urgent else "", n, c, when), lines))
    if near:
        return out
    hist = {d: n for d, n in (row.get("daily7") or {}).items() if d < today and isinstance(n, int)}
    last = sorted(hist)[-7:]
    if len(last) >= EARLY_MIN_DAYS:
        avg = sum(hist[d] for d in last) / len(last)
        if avg >= EARLY_PCT * c:
            y, w, _ = now.isocalendar()
            out.append(("sendcap-70:%d-W%02d" % (y, w), "AGSIST: the Daily is near the Brevo daily limit",
                        ["Heads up: the AGSIST Daily averaged %d emails a day over the last %d days, %d%% of your %d "
                         "Brevo emails a day. Nothing has stopped yet. Upgrading Brevo (Starter removes the daily cap) "
                         "before the list grows past it, then setting the repo variable SEND_DAILY_CAP to the new limit, "
                         "keeps every send whole." % (int(avg + 0.5), len(last), _pct(avg, c), c), "",
                         "This heads-up comes at most once a week."]))
    return out


def remind(doc, now, environ=None, is_set=None, set_flag=None, mail=None):
    """Send each due reminder whose flag is not set, then set it. -> the keys mailed."""
    if is_set is None or set_flag is None:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import list_source
        is_set, set_flag = is_set or list_source.flag_is_set, set_flag or list_source.flag_set
    if mail is None:
        import log_safe
        mail = log_safe.owner_mail
    sent = []
    for key, subject, lines in reminders(doc, now, environ):
        try:
            seen = is_set(key)
        except Exception as ex:                            # noqa: BLE001  no dedupe, no email
            print("brevo reminder %s: the flag could not be read (%s); not sending" % (key, type(ex).__name__))
            continue
        if seen:
            print("brevo reminder %s: already sent" % key)
            continue
        if mail(subject, lines):
            try:
                set_flag(key)
            except Exception as ex:                        # noqa: BLE001
                print("::warning::brevo reminder %s sent, flag not set (%s)" % (key, type(ex).__name__))
            sent.append(key)
            print("brevo reminder %s: mailed to Sig" % key)
        else:
            print("brevo reminder %s: NOT mailed (see above)" % key)
    if not sent:
        print("brevo reminder: nothing to send")
    return sent


# ───────────────────────────── selftest (fixtures only: no network, no clock) ─────────────────────────────

def selftest():
    fails = []

    def ck(what, cond, info=""):
        print(("ok   " if cond else "FAIL ") + what + ("" if cond else "  " + str(info)))
        if not cond:
            fails.append(what)

    now = datetime(2026, 11, 4, 21, 0, tzinfo=UTC)
    # cap
    ck("cap defaults to 300", cap({}) == 300)
    ck("cap reads SEND_DAILY_CAP", cap({"SEND_DAILY_CAP": "10000"}) == 10000)
    ck("a bad cap falls back to the default", cap({"SEND_DAILY_CAP": "lots"}) == 300 and cap({"SEND_DAILY_CAP": "0"}) == 300)
    ck("no variable: the cap the saved row used", cap({}, 9000) == 9000)

    # the real case, Nov 4: the Daily's 209 plus 2 against 300 is ok
    def run(day, *lines, rid=1, caps=()):
        return {"id": rid, "created_at": day + "T11:48:00Z", "lines": list(lines), "caps": list(caps)}
    L = lambda s, n, **x: dict({"sender": s, "sent_readers": n, "waiting": n, "dry": 0}, **x)

    def row_for(runs, c=300, **kw):
        d, by, mk, logs = tally_days(runs)
        return judge(d, by, mk, c, now, logs=logs, **kw)
    real = {"daily.yml": [run("2026-11-04", L("daily", 209))], "form-digest.yml": [run("2026-11-04", L("form-digest", 2), rid=2)]}
    r = row_for(real)
    ck("Nov 4: 209 + 2 against 300 is ok", r["status"] == "ok" and r["days"] == {"2026-11-04": 211}, r)
    ck("the row names today's count, the cap and the top senders",
       "at least 211 of 300" in r["why"] and "daily 209" in r["why"] and "form-digest 2" in r["why"], r["why"])
    ck("the row is critical", r["critical"] is True)
    r = row_for({"daily.yml": [run("2026-11-04", L("daily", 245))]})
    ck("245 of 300 is a warning", r["status"] == "warn", r)
    r = row_for({"daily.yml": [run("2026-11-04", L("daily", 285))]})
    ck("285 of 300 (95%) is red", r["status"] == "late", r)
    r = row_for({"daily.yml": [run("2026-11-04", L("daily", 285))]}, c=10000)
    ck("with the cap at 10000, 285 is ok", r["status"] == "ok", r)
    r = row_for({"daily.yml": [run("2026-11-04", L("daily", 3), caps=[{"sender": "daily", "kind": "refused", "code": 421}])]})
    ck("a quota refusal is red, whatever the count", r["status"] == "late" and "refused" in r["why"], r)
    r = row_for({"daily.yml": [run("2026-11-04", L("daily", 2), caps=[{"sender": "daily", "kind": "preflight", "used": 5, "size": 209, "later": 200, "cap": 300}])]})
    ck("a preflight marker is red (projected past the cap)", r["status"] == "late" and "projected past the cap" in r["why"], r)
    r = row_for({"daily.yml": [run("2026-11-04", L("daily", 0, smtp=1))]})
    ck("smtp= counts Sig's test copy (sent_readers 0)", r["days"] == {"2026-11-04": 1}, r)
    r = row_for({"daily.yml": [run("2026-11-03", L("daily", 250), rid=1), run("2026-11-04", L("daily", 3), rid=2)]})
    ck("the busiest UTC day in the window is judged", r["status"] == "warn" and r["days"] == {"2026-11-03": 250, "2026-11-04": 3}, r)
    r = row_for({"daily.yml": [{"id": 1, "created_at": "2026-11-04T11:00:00Z", "lines": None}]})
    ck("no log read is unknown, not ok", r["status"] == "unknown", r)
    r = row_for(real, sampled=["report-day.yml"])
    ck("a sampled sender is named", "sampled, more may have gone: report-day.yml" in r["why"])
    rr = rejudge(dict(row_for({"daily.yml": [run("2026-11-04", L("daily", 245))]}, sampled=["report-day.yml"])), now,
                 {"SEND_DAILY_CAP": "10000"})
    ck("a saved row judged again with the cap at 10000 is ok", rr["status"] == "ok" and rr["cap"] == 10000
       and "report-day.yml" in rr["why"], rr)
    ck("no address in a row", "@" not in json.dumps(row_for(real)))

    # markers
    m = marker("daily", "refused", code=421, sent=12)
    ck("marker shape", m == "SEND-CAP sender=daily kind=refused code=421 sent=12", m)
    ck("a non-number marker field is dropped", "to=" not in marker("daily", "refused", to="a@b.c"))
    p = parse("2026-11-04T11:48:01.1Z " + m + "\n2026-11-04T11:48:02.1Z SEND-CAP sender=daily kind=other\n")
    ck("parse reads a marker under a timestamp, skips an unknown kind",
       p == [{"sender": "daily", "kind": "refused", "code": 421, "sent": 12}], p)

    # what looks like the cap
    q = smtplib.SMTPDataError(550, b"5.7.1 Daily sending quota exceeded")
    ck("550 naming a quota is the cap", cap_code(q) == 550)
    ck("a bare 421 during a send is a rate refusal", cap_code(smtplib.SMTPSenderRefused(421, b"Service not available", "x@y.z")) == 421)
    ck("a bare 421 at connect is not", cap_code(smtplib.SMTPConnectError(421, b"Service not available"), "connect") is None)
    ck("a 550 unknown user is not the cap", cap_code(smtplib.SMTPRecipientsRefused({"x@y.z": (550, b"5.1.1 user unknown")})) is None)
    ck("every recipient refused for a limit is the cap",
       cap_code(smtplib.SMTPRecipientsRefused({"x@y.z": (451, b"4.7.0 too many messages")})) == 451)
    ck("login refused for credits is the cap",
       cap_code(smtplib.SMTPAuthenticationError(535, b"Maximum credits exceeded"), "login") == 535)
    ck("a dropped connection is not the cap", cap_code(smtplib.SMTPServerDisconnected("gone")) is None)
    ck("a plain socket error is not the cap", cap_code(OSError("reset")) is None)

    # the wrapper, on a fake server class (smtplib.SMTP itself is untouched here)
    import delivery_line
    import io
    import contextlib

    class Fake(smtplib.SMTP):
        def __init__(self, fail_at=None):
            self.n, self.fail_at = 0, fail_at

        def connect(self, *a, **k):
            return (220, b"ok")

        def login(self, *a, **k):
            return (235, b"ok")

        def sendmail(self, f, to, msg, *a, **k):
            self.n += 1
            if self.fail_at and self.n >= self.fail_at:
                raise smtplib.SMTPDataError(550, b"5.7.1 daily limit reached")
            return {}

    saved = dict(STATE, printed=set(STATE["printed"]))
    t = delivery_line.Tally("daily")
    t.waiting = 3
    STATE.update(tally=None, printed=set(), preflight=False)
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        install(t, Fake)
        c = Fake(fail_at=3)
        c.sendmail("a@b.c", ["r1@x.y"], "m")
        c.sendmail("a@b.c", "r2@x.y", "m")
        for _ in range(2):
            try:
                c.sendmail("a@b.c", ["r3@x.y"], "m")
            except smtplib.SMTPDataError:
                pass
    out = buf.getvalue()
    ck("the wrapper counts each recipient handed over", t.extra.get("smtp") == 2, t.extra)
    ck("a cap refusal is counted on the line", t.extra.get("cap_refused") == 2, t.extra)
    ck("the marker prints once per run", out.count("SEND-CAP sender=daily kind=refused code=550 sent=2") == 1, out)
    ck("the DELIVERY line carries smtp= and cap_refused=", "cap_refused=2" in t.line() and "smtp=2" in t.line(), t.line())
    ck("no address printed", "@" not in out, out)
    ck("a line with smtp= counts that", line_volume(delivery_line.parse(t.line())[0]) == 2)

    # preflight, from the real case and the report day
    doc = {"workflows": [{"workflow": ROW, "cap": 300, "days": {"2026-11-04": 2}}]}

    def pf(waiting, later=0, d=doc, env=None):
        STATE["preflight"] = False
        tt = delivery_line.Tally("daily")
        tt.waiting = waiting
        b = io.StringIO()
        with contextlib.redirect_stdout(b):
            res = preflight(tt, later=later, later_what="report-day", now=now, doc=d, environ=env or {})
        return res, b.getvalue()
    res, out = pf(209)
    ck("Nov 4: 2 counted + 209 is under 300: no warning", res["over"] is False and "::warning" not in out and "SEND-CAP" not in out, out)
    res, out = pf(209, later=200)
    ck("a report day (209 + 200 later) warns and prints the marker",
       res["over"] and "::warning" in out and "SEND-CAP sender=daily kind=preflight cap=300 later=200 size=209 used=2" in out, out)
    res, out = pf(209, later=200, env={"SEND_DAILY_CAP": "10000"})
    ck("with SEND_DAILY_CAP=10000 nothing warns", res["over"] is False and "::warning" not in out, out)
    res, out = pf(209, later=200, d={"workflows": [{"workflow": ROW, "cap": 10000, "days": {}}]})
    ck("no variable in the sender's step: the saved row's cap is used", res["cap"] == 10000 and not res["over"], res)
    res, out = pf(305, d=None)
    ck("no saved count: this send alone is still judged", res["over"] and res["used"] is None and "could not be read" in out, out)
    res, _ = pf(5)
    ck("a small send skips the preflight", res is None)
    # reminders to Sig (Nov 4): once a day per level, again at 95% marked urgent, none once the cap is raised
    def vdoc(days, daily7=None, c=300):
        return {"workflows": [{"workflow": ROW, "cap": c, "days": days, "daily7": daily7 or {}}]}
    flags, mailed = set(), []

    def go(doc, env=None, at=now):
        b = io.StringIO()
        with contextlib.redirect_stdout(b):
            keys = remind(doc, at, env or {}, is_set=lambda k: k in flags, set_flag=flags.add,
                          mail=lambda subj, lines: mailed.append((subj, lines)) or True)
        return keys
    ck("Nov 4: 211 of 300 sends no reminder", go(vdoc({"2026-11-04": 211})) == [] and not mailed)
    k1 = go(vdoc({"2026-11-04": 245}))
    ck("245 of 300 (81%) mails one reminder", k1 == ["sendcap-80:2026-11-04"] and len(mailed) == 1, (k1, mailed))
    ck("the reminder text names the count, the cap and the variable",
       mailed and mailed[0][1][0] == "AGSIST sent 245 of your 300 Brevo emails today (81%). Time to upgrade Brevo "
       "(Starter removes the daily cap), then set the repo variable SEND_DAILY_CAP to the new limit.", mailed[:1])
    ck("the same day again: once a day, no second mail", go(vdoc({"2026-11-04": 260})) == [] and len(mailed) == 1)
    k2 = go(vdoc({"2026-11-04": 290}))
    ck("95% the same day: one urgent reminder", k2 == ["sendcap-95:2026-11-04"] and len(mailed) == 2
       and mailed[1][0].startswith("URGENT") and mailed[1][1][0].startswith("Urgent: AGSIST sent 290 of your 300"), (k2, mailed[-1:]))
    ck("95% again: no repeat that day", go(vdoc({"2026-11-04": 299})) == [] and len(mailed) == 2)
    ck("the next day at 81%: a new reminder", go(vdoc({"2026-11-05": 245}), at=datetime(2026, 11, 5, 21, tzinfo=UTC))
       == ["sendcap-80:2026-11-05"])
    flags.clear()
    ck("SEND_DAILY_CAP raised above the day's count: no reminder",
       go(vdoc({"2026-11-04": 290}), {"SEND_DAILY_CAP": "20000"}) == [])
    ck("straight to 95%: the urgent one only", go(vdoc({"2026-11-04": 290})) == ["sendcap-95:2026-11-04"])
    flags.clear()
    del mailed[:]

    def fail_read(k):
        raise RuntimeError("down")
    b = io.StringIO()
    with contextlib.redirect_stdout(b):
        ks = remind(vdoc({"2026-11-04": 290}), now, {}, is_set=fail_read, set_flag=flags.add,
                    mail=lambda s_, l_: mailed.append(1) or True)
    ck("a flag that cannot be read sends nothing", ks == [] and not mailed, b.getvalue())
    week = {"2026-10-29": 212, "2026-10-30": 214, "2026-10-31": 213, "2026-11-01": 215, "2026-11-02": 216,
            "2026-11-03": 217, "2026-11-04": 3}
    ke = go(vdoc({"2026-11-04": 3}, week))
    ck("the Daily's 7-day average at 71% of 300: a gentle heads-up", ke == ["sendcap-70:2026-W45"]
       and mailed[-1][1][0].startswith("Heads up: the AGSIST Daily averaged 215 emails a day over the last 6 days, 71%"),
       (ke, mailed[-1:]))
    ck("the heads-up comes once a week", go(vdoc({"2026-11-04": 3}, week), at=datetime(2026, 11, 6, 9, tzinfo=UTC)) == [])
    week2 = dict(week, **{"2026-11-04": 218, "2026-11-05": 219})
    ck("the next week it can come again", go(vdoc({"2026-11-09": 3}, week2), at=datetime(2026, 11, 9, 9, tzinfo=UTC))
       == ["sendcap-70:2026-W46"])
    ck("209 a day (70% of 300 is 210) is no heads-up",
       go(vdoc({}, {d: 209 for d in week}), at=datetime(2026, 11, 20, 9, tzinfo=UTC)) == [])
    ck("two days are not an average", reminders(vdoc({}, {"2026-11-02": 250, "2026-11-03": 250}), now) == [])
    ck("no address in a reminder", "@" not in json.dumps(mailed))
    ck("the history keeps the larger count per day and %d days" % HIST_DAYS,
       daily_history({"daily7": {"2026-11-03": 209, "2026-10-20": 1}}, {"2026-11-03": [["daily", 150]], "2026-11-04": {"daily": 7}})
       == {"2026-10-20": 1, "2026-11-03": 209, "2026-11-04": 7})

    STATE.clear()
    STATE.update(saved)
    print("send_cap selftest: %d failed" % len(fails))
    return 1 if fails else 0


def main(argv):
    if "--selftest" in argv:
        return selftest()
    if "--remind" in argv:
        i = argv.index("--remind")
        path = argv[i + 1] if i + 1 < len(argv) else HEALTH_PATH
        try:
            with open(path, encoding="utf-8") as fh:
                doc = json.load(fh)
        except Exception as ex:                            # noqa: BLE001
            print("brevo reminder: no cron-health file (%s); nothing to send" % type(ex).__name__)
            return 0
        remind(doc, datetime.now(UTC))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
