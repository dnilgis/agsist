#!/usr/bin/env python3
"""
gmail_limit.py -- say so before the list outgrows free Gmail.

Gmail lets a free account send to about 500 recipients in 24 hours. Every
AGSIST sender uses that one account (SMTP_USER). Past the limit Gmail refuses
mail for a day, and the readers at the end of the list simply get nothing.

    projected = daily list size
              + report-day sends, when today is a report day
              (the alert senders -- hail, county, elevator and price watch --
               only mail when something fires; their volume is not kept
               anywhere cheap to read, so it is NOT in the number, and the
               summary says so)

At WARN_AT (400) or more:
  * a warning goes into the GitHub step summary on every run, and
  * Sig gets one email a week at most, at FROM_ADDR, subject
    "AGSIST: email list is near Gmail's daily limit". The week is deduped
    through the subs worker's /flag day-markers (14-day TTL), key
    gmail-near:<ISO year>-W<week>. No flag service, no email: a warning that
    cannot be deduped is not sent, so it can never repeat every morning.

Moving to Amazon SES changes three repo secrets (SMTP_HOST, SMTP_USER,
SMTP_PASS) and no code; send_daily.py's docstring has said so since day one.

    python3 scripts/gmail_limit.py --selftest
"""
import json
import os
import smtplib
import ssl
import sys
import urllib.parse
import urllib.request
from datetime import date
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

GMAIL_LIMIT = 500
WARN_AT = 400
SUBJECT = "AGSIST: email list is near Gmail's daily limit"
UA = {"User-Agent": "AGSIST-automation/1.0 (+https://agsist.com; sig@farmers1st.com)"}

# Quarterly Grain Stocks, month-day. COPY of the table in
# scripts/generate_daily.py (release_calendar, `qs_2026`), the one the
# briefing's calendar block uses; WASDE comes from scripts/usda_dates.py, the
# single source. Two copies of the stocks dates exist; change both.
QS_2026 = {"01-30", "03-31", "06-30", "09-30"}


def report_kinds(day):
    """The major USDA reports released on `day` (a date), by the site's own calendars."""
    out = []
    try:
        import usda_dates
        if day in usda_dates.WASDE_2026:
            # Crop Production often lands the same noon, but no table here
            # says which months, so it is not named.
            out.append("WASDE")
    except Exception:
        pass
    if day.year == 2026 and day.strftime("%m-%d") in QS_2026:
        out.append("Grain Stocks")
    return out


def projection(daily_n, report_n, report_day):
    return int(daily_n) + (int(report_n) if report_day else 0)


def summary(text):
    p = os.environ.get("GITHUB_STEP_SUMMARY")
    if p:
        try:
            with open(p, "a", encoding="utf-8") as fh:
                fh.write(text.rstrip() + "\n")
        except OSError:
            pass


def week_key(day):
    y, w, _ = day.isocalendar()
    return "gmail-near:%d-W%02d" % (y, w)


def _flag(key, set_it=False):
    """True/False from the worker, or None when it cannot be asked."""
    base, token = (os.environ.get("LIST_URL") or "").strip(), (os.environ.get("LIST_TOKEN") or "").strip()
    if not (base and token):
        return None
    u = base.rstrip("/") + "/flag?k=" + urllib.parse.quote(key) + "&token=" + urllib.parse.quote(token)
    try:
        req = urllib.request.Request(u, method="POST" if set_it else "GET", headers=UA)
        with urllib.request.urlopen(req, timeout=20) as r:
            return bool(json.loads(r.read().decode()).get("set", False))
    except Exception as ex:
        print("gmail-limit flag unreachable (%s)" % type(ex).__name__)
        return None


def body_text(projected, daily_n, report_n, kinds):
    lines = [
        "The AGSIST email list is near the free Gmail sending limit.",
        "",
        "Projected recipients in the next 24 hours: %d (warning at %d; Gmail allows about %d)." % (projected, WARN_AT, GMAIL_LIMIT),
        "  AGSIST Daily list: %d" % daily_n,
    ]
    if kinds:
        lines.append("  Report-day email (%s): %d" % (", ".join(kinds), report_n))
    lines += [
        "  Hail, county, elevator and price alerts: not counted (they mail only when something fires).",
        "",
        "Past the limit Gmail stops sending for a day, and the readers at the end of the list get nothing.",
        "",
        "It is time to switch SMTP to Amazon SES. No code changes. Only three repo secrets change:",
        "  SMTP_HOST  email-smtp.<region>.amazonaws.com",
        "  SMTP_USER  the SES SMTP username",
        "  SMTP_PASS  the SES SMTP password",
        "GitHub: the agsist repo > Settings > Secrets and variables > Actions > edit each one.",
        "On the SES side first: verify the From address (or the agsist.com domain) and request production access, or SES will only mail verified addresses.",
        "",
        "This email is sent at most once a week while the projection stays at %d or more." % WARN_AT,
    ]
    return "\n".join(lines) + "\n"


def check(daily_n, report_n=0, day=None, dry=False, send=True):
    """Print, write the step summary, and email Sig weekly at most. Returns the projection."""
    day = day or date.today()
    kinds = report_kinds(day)
    proj = projection(daily_n, report_n, bool(kinds))
    print("gmail limit: projected %d recipient(s) in 24 h (daily %d%s); warn at %d"
          % (proj, daily_n, (", report-day %d" % report_n) if kinds else "", WARN_AT))
    if proj < WARN_AT:
        return proj
    msg = ("Email volume: %d recipients projected in 24 h, at or above the %d warning line "
           "(free Gmail allows about %d). Time to move SMTP to Amazon SES: change SMTP_HOST, "
           "SMTP_USER and SMTP_PASS. Alert senders are not counted." % (proj, WARN_AT, GMAIL_LIMIT))
    print("::warning title=Near Gmail's daily limit::" + msg)
    summary("### Near Gmail's daily limit\n\n" + msg + "\n")
    if dry or not send:
        print("gmail limit: dry run, the weekly email to Sig is not sent")
        return proj
    key = week_key(day)
    seen = _flag(key)
    if seen is None:
        print("gmail limit: cannot dedupe the weekly email (no flag service); not sending it")
        return proj
    if seen:
        print("gmail limit: Sig was already emailed this week (%s)" % key)
        return proj
    try:
        _send(body_text(proj, daily_n, report_n, kinds))
        _flag(key, set_it=True)
        print("gmail limit: emailed Sig (%s)" % key)
    except Exception as ex:
        print("::warning::gmail limit email not sent (%s: %s)" % (type(ex).__name__, str(ex)[:120]))
    return proj


def _send(text):
    user = (os.environ.get("SMTP_USER") or "").strip()
    pw = (os.environ.get("SMTP_PASS") or "").strip()
    to = (os.environ.get("FROM_ADDR") or "").strip() or user
    if not (user and pw and to):
        raise RuntimeError("SMTP_USER/SMTP_PASS not set")
    m = EmailMessage()
    m["Subject"] = SUBJECT
    m["From"] = formataddr(("AGSIST automation", to))
    m["To"] = to
    m["Message-ID"] = make_msgid(domain=to.split("@", 1)[1])
    m.set_content(text)
    host = (os.environ.get("SMTP_HOST") or "").strip() or "smtp.gmail.com"
    port = int((os.environ.get("SMTP_PORT") or "").strip() or 587)
    c = smtplib.SMTP(host, port, timeout=30)
    try:
        c.starttls(context=ssl.create_default_context())
        c.login(user, pw)
        c.send_message(m)
    finally:
        try:
            c.quit()
        except Exception:
            pass


def _selftest():
    fails = []

    def ok(c, m):
        if not c:
            fails.append(m)
    ok(report_kinds(date(2026, 10, 9)) == ["WASDE"], "Oct 9 2026 is a WASDE day")
    ok(report_kinds(date(2026, 9, 30)) == ["Grain Stocks"], "Sep 30 2026 is Grain Stocks")
    ok(report_kinds(date(2026, 10, 6)) == [], "Oct 6 2026 is no report day")
    ok(projection(390, 380, True) == 770 and projection(390, 380, False) == 390, "projection adds report sends only on a report day")
    ok(week_key(date(2026, 10, 6)) == "gmail-near:2026-W41", "ISO week key")
    ok(len(week_key(date(2026, 12, 31))) <= 64, "flag key fits the worker's 64 chars")
    t = body_text(450, 450, 0, [])
    ok("Amazon SES" in t and "SMTP_HOST" in t and "SMTP_USER" in t and "SMTP_PASS" in t, "body names SES and the three secrets")
    import io
    import contextlib
    os.environ.pop("GITHUB_STEP_SUMMARY", None)
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        check(399, 0, date(2026, 10, 6), dry=True)
    ok("::warning" not in buf.getvalue(), "399 does not warn")
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        check(250, 200, date(2026, 10, 9), dry=True)
    ok("::warning" in buf.getvalue() and "projected 450" in buf.getvalue(), "250 + 200 on a report day warns")
    buf = io.StringIO()
    saved = {k: os.environ.pop(k, None) for k in ("LIST_URL", "LIST_TOKEN")}
    with contextlib.redirect_stdout(buf):
        check(450, 0, date(2026, 10, 6), dry=False)
    for k, v in saved.items():
        if v is not None:
            os.environ[k] = v
    ok("not sending it" in buf.getvalue(), "no flag service: the weekly email is withheld, not sent undeduped")
    if fails:
        for f in fails:
            print("FAIL", f)
        return 1
    print("gmail_limit selftest ok")
    return 0


if __name__ == "__main__":
    sys.exit(_selftest() if "--selftest" in sys.argv else 0)
