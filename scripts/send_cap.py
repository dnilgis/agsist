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

   kind=refused: the server refused the sender, the message or the login with a reply that names the
   plan's cap. smtplib raises SMTPSenderRefused (MAIL FROM), SMTPRecipientsRefused (every RCPT TO),
   SMTPDataError (DATA) and SMTPAuthenticationError (login); on a 421 it closes the connection first
   and raises the same classes with smtp_code 421. Brevo does not publish the reply it gives at the
   daily cap (searched Nov 4: its help pages give the 300 a day, not the reply), so (checker, PR 331):
     - SMTPRecipientsRefused is never the cap (it is one recipient's mailbox), and neither is a reply
       naming a mailbox, a message size or storage (552 5.2.2 mailbox over quota, 5.3.4 size limit);
     - a sender, DATA or login refusal whose text names a daily, sending, account or credit quota is;
     - a sender or DATA refusal with a bare 421 or 451 or a generic limit word is soft: one is a note
       line, SOFT_TO_CAP of them in one run count as the cap.
   When Brevo's real reply is seen in a log, pin it in the selftest. The wrapper never raises an error
   of its own into a sender, and reads nothing over the network.

   kind=preflight: only send_daily.py, before it connects to the mail server. The count already sent
   today (the send-volume row cron_health.py saved in the private repo, a floor: see 3; one HTTPS read
   of that file, HEALTH_SECONDS in all, no retries, else used=unknown) plus this list, plus the
   report-day email on a report day (its Daily readers and its own list, as send_report_day.py merges
   them), would pass the cap. A ::warning:: and the marker print, and the send still goes: the cap can
   be out of date after an upgrade, and a reader is better served by a send that may stop partway
   than by none. The marker makes the send-volume row red early; a raised cap clears it.

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

MARKER_RE = re.compile(r"\bSEND-CAP sender=([a-z0-9][a-z0-9-]{0,40}) kind=(refused|preflight)((?: [a-z_]{1,20}=(?:\d{1,9}|unknown))*)\s*$")
# What counts as the cap (checker, PR 331): a refusal of the sender or of the message (MAIL FROM, DATA,
# or the login), never one recipient's mailbox, whose text names a daily, sending or account quota.
CAP_TEXT = re.compile(r"\bdaily\b|\bsending (?:limit|quota)|\b(?:account|sending|daily) (?:quota|limit)|\bquota (?:exceeded|reached)"
                      r"|\bcredits? (?:exceeded|limit|reached)|\bmaximum credits\b|\bout of credits\b", re.I)
# A softer sign: a sender-level or DATA refusal with a "slow down" code or a generic limit word. One is a
# note (a transient 421 happens); SOFT_TO_CAP of them in one run count as the cap.
SOFT_WORDS = re.compile(r"\b(?:limits?|limited|exceed(?:ed|s)?|rate|too many|throttl\w*|quota)\b", re.I)
NOT_CAP = re.compile(r"\bmailbox\b|\bmessage size\b|\bsize (?:limit|exceeds)\b|\btoo (?:big|large)\b|\bstorage\b|\b5\.2\.2\b|\b5\.3\.4\b", re.I)
SOFT_CODES = (421, 451)
SOFT_TO_CAP = 2
HEALTH_SECONDS = 5.0              # the preflight's whole budget to read today's count; past it, it skips


def cap(environ=None, fallback=None):
    """The cap: SEND_DAILY_CAP when it is a whole number above 0, else `fallback`, else DEFAULT_CAP."""
    environ = os.environ if environ is None else environ
    v = str(environ.get("SEND_DAILY_CAP") or "").strip()
    if v.isdigit() and int(v) > 0:
        return int(v)
    return int(fallback) if isinstance(fallback, int) and fallback > 0 else DEFAULT_CAP


def _text(t):
    return t.decode("utf-8", "replace") if isinstance(t, bytes) else str(t)


def classify(ex, during="send"):
    """("cap", code), ("soft", code) or (None, None) for an smtplib exception. Only a refusal of the
    sender, the message or the login can be the cap: SMTPRecipientsRefused (one or every recipient's
    mailbox) never is. `during` is send, login or connect."""
    if isinstance(ex, smtplib.SMTPRecipientsRefused) or not isinstance(ex, smtplib.SMTPResponseException):
        return None, None
    try:
        code, text = int(ex.smtp_code), _text(ex.smtp_error)
    except Exception:                                      # noqa: BLE001
        return None, None
    if not 400 <= code < 600 or NOT_CAP.search(text):
        return None, None
    if CAP_TEXT.search(text):
        return "cap", code
    if during == "send" and isinstance(ex, (smtplib.SMTPSenderRefused, smtplib.SMTPDataError)) \
            and (code in SOFT_CODES or SOFT_WORDS.search(text)):
        return "soft", code
    return None, None


def cap_code(ex, during="send"):
    """The SMTP code when `ex` on its own names the plan's cap, else None."""
    kind, code = classify(ex, during)
    return code if kind == "cap" else None


def marker(sender, kind, **counts):
    parts = ["SEND-CAP sender=%s kind=%s" % (sender, kind)]
    for k in sorted(counts):
        v = counts[k]
        if not re.match(r"^[a-z_]{1,20}$", k):
            continue
        if v == "unknown":
            parts.append("%s=unknown" % k)
        elif isinstance(v, int) and not isinstance(v, bool):
            parts.append("%s=%d" % (k, max(0, v)))
    return " ".join(parts)


def parse(text):
    """Every SEND-CAP marker in a log -> [{"sender", "kind", counts...}] (a count may be "unknown")."""
    out = []
    for raw in (text or "").splitlines():
        m = MARKER_RE.search(raw.rstrip("\r"))
        if not m:
            continue
        d = {"sender": m.group(1), "kind": m.group(2)}
        for kv in m.group(3).split():
            k, v = kv.split("=", 1)
            d[k] = v if v == "unknown" else int(v)
        out.append(d)
    return out


# ───────────────────────────── 1. the per-run SMTP wrapper ─────────────────────────────

STATE = {"tally": None, "printed": set(), "preflight": False, "installed": False, "soft": 0}


def _out(s):
    try:
        print(s, flush=True)
    except Exception:                                      # noqa: BLE001  never break a send
        pass


def _bump(t, key, n=1):
    """t.extra[key] += n, never raising into a sender."""
    try:
        if not isinstance(t.extra, dict):
            t.extra = {}
        t.extra[key] = int(t.extra.get(key, 0)) + int(n)
    except Exception:                                      # noqa: BLE001
        pass


def note_refusal(ex, during="send"):
    """Count a refusal that names the cap (or the SOFT_TO_CAP-th soft one in this run) on the tally,
    and print the marker once per run. A single soft refusal is a note. Never raises."""
    try:
        t = STATE["tally"]
        kind, code = classify(ex, during)
        if t is None or kind is None:
            return None
        if kind == "soft":
            STATE["soft"] = STATE.get("soft", 0) + 1
            if STATE["soft"] < SOFT_TO_CAP:
                _out("send cap note: the mail server refused a send with code %d (a slow-down or limit reply); "
                     "one is not read as the plan's cap" % code)
                return None
        _bump(t, "cap_refused")
        if "refused" not in STATE["printed"]:
            STATE["printed"].add("refused")
            sent = (t.extra or {}).get("smtp", 0) if isinstance(t.extra, dict) else 0
            _out("::error title=Mail plan daily cap::the mail server refused a send with code %d, which reads as "
                 "the plan's daily cap; the rest of this list may not go out" % code)
            _out(marker(t.sender, "refused", code=code, sent=sent))
        return code
    except Exception:                                      # noqa: BLE001  never break a send
        return None


def _accepted(to_addrs, refused):
    n = 1 if isinstance(to_addrs, str) else len(list(to_addrs or []))
    try:
        n -= len(refused or {})
    except TypeError:
        pass
    return max(0, n)


def install(tally, smtp_cls=None):
    """Wrap smtplib.SMTP (sendmail, login, connect) for this process. Idempotent. The wrapper only
    counts: it reads nothing over the network and never raises an error of its own into a sender."""
    STATE["tally"] = tally
    cls = smtp_cls or smtplib.SMTP
    if cls.__dict__.get("_send_cap_wrapped", False):     # this class itself, not a wrapped parent
        return
    send0, login0, connect0 = cls.sendmail, cls.login, cls.connect

    def sendmail(self, from_addr, to_addrs, msg, *a, **k):
        try:
            refused = send0(self, from_addr, to_addrs, msg, *a, **k)
        except Exception as ex:
            note_refusal(ex, "send")
            raise
        t = STATE["tally"]
        if t is not None:
            try:
                _bump(t, "smtp", _accepted(to_addrs, refused))
            except Exception:                              # noqa: BLE001
                pass
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

def bounded(fn, seconds=HEALTH_SECONDS):
    """fn() in a daemon thread, at most `seconds` in all. -> (value, None) or (None, why). A call still
    hanging is left behind (daemon: it never holds the process open)."""
    import threading
    box = {}

    def run():
        try:
            box["v"] = fn()
        except Exception as ex:                            # noqa: BLE001
            box["e"] = type(ex).__name__
    th = threading.Thread(target=run, daemon=True)
    th.start()
    th.join(seconds)
    if th.is_alive():
        return None, "no answer in %g s" % seconds
    if "e" in box:
        return None, box["e"]
    return box.get("v"), None


def _read_health():
    """The saved cron-health doc, one small HTTPS read of the private repo's file (the contents API,
    PRIVATE_REPO_TOKEN), no retries. None when there is no token. Called through bounded()."""
    p = os.environ.get("SEND_CAP_HEALTH_FILE")
    if p:
        with open(p, encoding="utf-8") as fh:
            return json.load(fh)
    url = os.environ.get("SEND_CAP_HEALTH_URL") or (
        "https://api.github.com/repos/dnilgis/feedbag/contents/%s?ref=private-data" % HEALTH_PATH)
    tok = (os.environ.get("PRIVATE_REPO_TOKEN") or "").strip()
    if not tok and not os.environ.get("SEND_CAP_HEALTH_URL"):
        return None
    import urllib.request
    h = {"Accept": "application/vnd.github.raw+json", "User-Agent": "agsist-send-cap", "X-GitHub-Api-Version": "2022-11-28"}
    if tok:
        h["Authorization"] = "Bearer " + tok
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=HEALTH_SECONDS) as r:
        return json.loads(r.read(2 * 1024 * 1024).decode("utf-8"))


def known_today(doc, now):
    """(count already sent today, the cap the row was judged on) from a cron-health doc, or (None, cap)."""
    row = next((r for r in (doc or {}).get("workflows") or [] if r.get("workflow") == ROW), None)
    if not row:
        return None, None
    rcap = row.get("cap") if isinstance(row.get("cap"), int) else None
    v = (row.get("days") or {}).get(now.strftime("%Y-%m-%d"))
    return (int(v) if isinstance(v, int) else None), rcap


def report_day_count(daily_records, report_only):
    """How many the report-day email goes to: the Daily readers with report days on, plus the
    report-day-only readers not among them (the same merge as send_report_day.merge_lists). A count."""
    seen = {str(r.get("email") or "").strip().lower() for r in daily_records or [] if r.get("reports") is not False}
    seen.discard("")
    n = len(seen)
    for e in report_only or []:
        e = str((e.get("email") if isinstance(e, dict) else e) or "").strip().lower()
        if e and "@" in e and e not in seen:
            seen.add(e)
            n += 1
    return n


def preflight(tally, later=0, later_what="", now=None, doc=None, environ=None, seconds=HEALTH_SECONDS):
    """Before connecting (never inside a send): warn and print the marker when today's count plus this
    send would pass the cap. Reads today's count within `seconds` in all, else judges without it and
    says used=unknown. Never stops the send. Once per process. -> dict of what it judged."""
    if STATE["preflight"]:
        return None
    STATE["preflight"] = True
    environ = os.environ if environ is None else environ
    size = int(getattr(tally, "waiting", 0) or 0)
    if tally.dry or size + int(later or 0) < PREFLIGHT_MIN:
        return None
    now = now or datetime.now(UTC)
    used, rcap, why = None, None, ""
    if doc is None:
        doc, err = bounded(_read_health, seconds)
        if err:
            why = "the saved count could not be read (%s)" % err
    if doc is not None:
        try:
            used, rcap = known_today(doc, now)
        except Exception as ex:                            # noqa: BLE001
            why = "the saved count could not be read (%s)" % type(ex).__name__
        if used is None and not why:
            why = "no count saved for today yet"
    elif not why:
        why = "the saved count could not be read"
    c = cap(environ, rcap)
    total = (used or 0) + size + int(later or 0)
    out = {"used": used, "size": size, "later": int(later or 0), "cap": c, "total": total, "over": total > c}
    shown = "unknown" if used is None else str(used)
    _out("send cap: %s already counted today (UTC), this send %d%s, cap %d%s"
         % (shown, size, (", %s later today %d" % (later_what or "a send", later)) if later else "", c,
            ("; " + why) if why else ""))
    if out["over"]:
        _out("::warning title=Mail plan daily cap::%d%s emails projected today (UTC) against a cap of %d: "
             "%s counted already, %d in this send%s. The send goes on; past the cap the mail server stops it "
             "partway. Raise the plan (and the SEND_DAILY_CAP variable) or move a send."
             % (total, " or more" if used is None else "", c, shown, size,
                (", %d from %s later today" % (later, later_what or "a send")) if later else ""))
        _out(marker(tally.sender, "preflight", used="unknown" if used is None else used, size=size,
                    later=int(later or 0), cap=c))
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
                     % ", ".join("%s on %s (%s counted + %s + %s later, cap %s)" % (
                         m["sender"], m["day"], m.get("used", "?"), m.get("size", "?"), m.get("later", 0), m.get("cap", c))
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


def _projected(m):
    return sum(int(m.get(k)) for k in ("used", "size", "later") if isinstance(m.get(k), int))


def rejudge(row, now, environ=None):
    """A saved row judged again against the cap in force now (the variable may have changed)."""
    c = cap(environ)
    by = {d: dict(v) for d, v in (row.get("top") or {}).items()}
    # A preflight marker is a projection against the cap of its day: once the cap is above that
    # projection it no longer holds (checker, PR 331). Refusals stay red for the window.
    keep = [m for m in row.get("markers") or [] if m.get("kind") != "preflight" or _projected(m) > c]
    return judge(dict(row.get("days") or {}), by, keep, c, now,
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
        # The flag first (checker, PR 331): a flag that does not take sends nothing, so a failing flag
        # store can cost one reminder but never mail Sig on every run.
        try:
            took = set_flag(key)
        except Exception as ex:                            # noqa: BLE001
            took = False
            print("brevo reminder %s: the flag could not be set (%s); not sending" % (key, type(ex).__name__))
        if not took:
            print("brevo reminder %s: the flag did not take; not sending" % key)
            continue
        if mail(subject, lines):
            sent.append(key)
            print("brevo reminder %s: mailed to Sig" % key)
        else:
            print("brevo reminder %s: NOT mailed (see above); the flag is set, so it is not retried today" % key)
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
    pre_row = row_for({"daily.yml": [run("2026-11-04", L("daily", 2), caps=[
        {"sender": "daily", "kind": "preflight", "used": 5, "size": 209, "later": 200, "cap": 300}])]})
    rr = rejudge(dict(pre_row), now, {"SEND_DAILY_CAP": "20000"})
    ck("a raised cap clears a stale preflight marker", pre_row["status"] == "late" and rr["status"] == "ok"
       and not rr["markers"], rr)
    ref_row = row_for({"daily.yml": [run("2026-11-04", L("daily", 2), caps=[{"sender": "daily", "kind": "refused", "code": 550}])]})
    rr = rejudge(dict(ref_row), now, {"SEND_DAILY_CAP": "20000"})
    ck("a refusal stays red for the window, even with a raised cap", rr["status"] == "late", rr)

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
    ck("the cap text on DATA is the cap", cap_code(smtplib.SMTPDataError(550, b"5.7.1 You have exceeded your daily sending limit")) == 550)
    ck("the cap text on MAIL FROM is the cap", cap_code(smtplib.SMTPSenderRefused(450, b"4.7.1 Account quota exceeded", "x@y.z")) == 450)
    ck("a bare 421 during a send is soft, not the cap",
       classify(smtplib.SMTPSenderRefused(421, b"Service not available", "x@y.z")) == ("soft", 421))
    ck("a bare 451 on DATA is soft", classify(smtplib.SMTPDataError(451, b"4.3.0 try again later")) == ("soft", 451))
    ck("a bare 421 at connect is not", classify(smtplib.SMTPConnectError(421, b"Service not available"), "connect") == (None, None))
    ck("a 550 unknown user is not the cap", classify(smtplib.SMTPRecipientsRefused({"x@y.z": (550, b"5.1.1 user unknown")})) == (None, None))
    ck("every recipient refused, even for a limit, is a mailbox reply, never the cap",
       classify(smtplib.SMTPRecipientsRefused({"x@y.z": (451, b"4.7.0 too many messages, daily quota")})) == (None, None))
    ck("mailbox over quota is not the cap",
       classify(smtplib.SMTPDataError(552, b"5.2.2 Mailbox over quota")) == (None, None)
       and classify(smtplib.SMTPSenderRefused(452, b"4.2.2 The email account that you tried to reach is over quota (mailbox full)", "x@y.z")) == (None, None))
    ck("a message size limit is not the cap",
       classify(smtplib.SMTPDataError(552, b"5.3.4 Message size exceeds fixed maximum message size limit")) == (None, None))
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

    # one transient 421 is a note; a second one in the same run reads as the cap
    class Soft(Fake):
        def sendmail(self, f, to, msg, *a, **k):
            raise smtplib.SMTPSenderRefused(421, b"4.7.0 Try again later", f)
    t = delivery_line.Tally("daily")
    STATE.update(tally=None, printed=set(), preflight=True, soft=0)
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        install(t, Soft)
        try:
            Soft().sendmail("a@b.c", ["r1@x.y"], "m")
        except smtplib.SMTPSenderRefused:
            pass
        first, first_extra = buf.getvalue(), dict(t.extra)
        try:
            Soft().sendmail("a@b.c", ["r2@x.y"], "m")
        except smtplib.SMTPSenderRefused:
            pass
    ck("one 421 is a note, no marker", "send cap note" in first and "SEND-CAP" not in first and "cap_refused" not in first_extra, first)
    ck("a second 421 in one run is the cap", "SEND-CAP sender=daily kind=refused code=421" in buf.getvalue()
       and t.extra.get("cap_refused") == 1, buf.getvalue())

    # the wrapper never raises into a sender, even with a broken tally
    class Odd(Fake):
        pass
    t = delivery_line.Tally("daily")
    t.extra = None
    STATE.update(tally=None, printed=set(), preflight=True, soft=0)
    buf = io.StringIO()
    err = None
    with contextlib.redirect_stdout(buf):
        install(t, Odd)
        try:
            Odd().sendmail("a@b.c", ["r1@x.y"], "m")
            o = Odd(fail_at=1)
            o.sendmail("a@b.c", ["r2@x.y"], "m")
        except smtplib.SMTPDataError:
            pass                                           # the server's own error goes through
        except Exception as ex:                            # noqa: BLE001
            err = ex
    ck("a tally whose extra is None: the wrapper raises nothing of its own", err is None, repr(err))
    STATE["tally"] = None
    err = None
    try:
        note_refusal(smtplib.SMTPDataError(550, b"daily sending limit"))
        note_refusal(object())
    except Exception as ex:                                # noqa: BLE001
        err = ex
    ck("note_refusal never raises", err is None, repr(err))

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
    ck("no saved count: the marker says used=unknown, not 0", "kind=preflight cap=300 later=0 size=305 used=unknown" in out, out)
    ck("used=unknown parses", parse(marker("daily", "preflight", used="unknown", size=305))
       == [{"sender": "daily", "kind": "preflight", "size": 305, "used": "unknown"}])

    # a dead remote: the read hangs; the preflight gives up within its budget and the send goes on
    import socket
    import time
    import threading
    srv = socket.socket()
    srv.bind(("127.0.0.1", 0))
    srv.listen(5)
    held = []
    threading.Thread(target=lambda: held.append(srv.accept()), daemon=True).start()
    old_env = {k: os.environ.get(k) for k in ("SEND_CAP_HEALTH_URL", "SEND_CAP_HEALTH_FILE")}
    os.environ.pop("SEND_CAP_HEALTH_FILE", None)
    os.environ["SEND_CAP_HEALTH_URL"] = "http://127.0.0.1:%d/cron-health.json" % srv.getsockname()[1]
    try:
        t0 = time.monotonic()
        res, out = pf(209, d=None)
        took = time.monotonic() - t0
        went = []
        install(delivery_line.Tally("daily"), Fake)        # the send that follows
        Fake().sendmail("a@b.c", ["r@x.y"], "m") and went.append(1)
        went.append(1)
    finally:
        for k, v in old_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        srv.close()
    ck("a dead remote adds under 6 s, says unknown, and the send proceeds",
       took < 6 and res["used"] is None and "unknown" in out and went, (round(took, 2), out))
    res, _ = pf(5)
    ck("a small send skips the preflight", res is None)
    daily = [{"email": "A@x.y"}, {"email": "b@x.y", "reports": False}, {"email": "c@x.y", "reports": True}]
    ck("the report-day projection adds the report-only list, each reader once",
       report_day_count(daily, [{"email": "a@x.y"}, {"email": "d@x.y"}, "e@x.y", {"email": "nope"}]) == 4)
    # reminders to Sig (Nov 4): once a day per level, again at 95% marked urgent, none once the cap is raised
    def vdoc(days, daily7=None, c=300):
        return {"workflows": [{"workflow": ROW, "cap": c, "days": days, "daily7": daily7 or {}}]}
    flags, mailed = set(), []

    def go(doc, env=None, at=now):
        b = io.StringIO()
        with contextlib.redirect_stdout(b):
            keys = remind(doc, at, env or {}, is_set=lambda k: k in flags, set_flag=lambda k: flags.add(k) or True,
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
        ks = remind(vdoc({"2026-11-04": 290}), now, {}, is_set=fail_read, set_flag=lambda k: flags.add(k) or True,
                    mail=lambda s_, l_: mailed.append(1) or True)
    ck("a flag that cannot be read sends nothing", ks == [] and not mailed, b.getvalue())
    order = []
    b = io.StringIO()
    with contextlib.redirect_stdout(b):
        ks = remind(vdoc({"2026-11-04": 245}), now, {}, is_set=lambda k: False,
                    set_flag=lambda k: order.append("flag") or True, mail=lambda s_, l_: order.append("mail") or True)
    ck("the flag is set before the mail", order == ["flag", "mail"] and ks == ["sendcap-80:2026-11-04"], order)
    b = io.StringIO()
    with contextlib.redirect_stdout(b):
        ks = remind(vdoc({"2026-11-04": 245}), now, {}, is_set=lambda k: False,
                    set_flag=lambda k: False, mail=lambda s_, l_: mailed.append(1) or True)
    ck("a flag that does not take sends nothing (no mail every run)", ks == [] and not mailed, b.getvalue())

    def boom(k):
        raise RuntimeError("store down")
    b = io.StringIO()
    with contextlib.redirect_stdout(b):
        ks = remind(vdoc({"2026-11-04": 245}), now, {}, is_set=lambda k: False, set_flag=boom,
                    mail=lambda s_, l_: mailed.append(1) or True)
    ck("a flag store that raises sends nothing", ks == [] and not mailed, b.getvalue())
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
