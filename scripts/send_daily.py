#!/usr/bin/env python3
"""
AGSIST daily briefing sender — no paid ESP required.

Reads today's briefing from data/daily-archive/YYYY-MM-DD.json (already in
the checkout when this runs in Actions) and emails a teaser to every address
on the list, linking to the homepage briefing for the full read. Keeping
the email short and the site the destination is deliberate: sponsors buy
pageviews on the site, not opens in an inbox.

All transport is env-driven, so the free Gmail path today becomes Amazon SES
tomorrow by changing three repo secrets — the script never changes:

    SMTP_HOST   default smtp.gmail.com
    SMTP_PORT   default 587 (STARTTLS)
    SMTP_USER   the account (Gmail address, or SES SMTP username)
    SMTP_PASS   Gmail APP PASSWORD (not the account password), or SES key
    FROM_ADDR   defaults to SMTP_USER
    FROM_NAME   default "AGSIST Daily"
    REPLY_TO    optional
    RECIPIENTS  the list — comma or newline separated (fallback)
    LIST_URL    subscriptions worker base URL (e.g.
                https://agsist-subs.dnilgis.workers.dev) — when set with
                LIST_TOKEN, the list is fetched live from KV and
                RECIPIENTS is ignored
    LIST_TOKEN  auth token for the worker's /list endpoint
    UNSUB_SECRET when set with LIST_URL, every email gets a signed
                one-click unsubscribe link
    DRY_RUN     "1" = render and report, send nothing

Safety rails: refuses to send if the newest archived briefing is not dated
today (weekend, holiday, or gate-blocked morning = silent skip, exit 0).
Sends individually (one To: per message — no exposed CC lists, better
deliverability), throttled, with a List-Unsubscribe header. Individual
failures are reported and tolerated; total failure exits nonzero.
"""
import json
import os
import re
import hmac
import hashlib
import smtplib
import ssl
import urllib.request
import urllib.parse
import sys
import time
from datetime import date
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import brief_email        # noqa: E402  (needs the path line above)

REPO = Path(__file__).resolve().parent.parent
ARCHIVE = REPO / "data" / "daily-archive"
# The teaser lands on the HOMEPAGE briefing, not /daily. ?d=1 tells the page the
# reader came from the email and explicitly asked for the briefing, so a "hide
# until tomorrow" dismissal from earlier today must not collapse it on arrival.
# utm_* is plain GA4 attribution: email->site clicks is the one number a sponsor
# actually asks for, and it costs nothing to measure.
SITE = "https://agsist.com/?d=1&utm_source=daily_email&utm_medium=email"
# Same URL, ampersands escaped, for use inside an href="" attribute. A bare "&"
# in an href is tolerated by most clients but is not valid HTML, and email
# sanitisers are not something to gamble a send on.
SITE_HREF = SITE.replace("&", "&amp;")


def env(name, default=None, required=False):
    v = os.environ.get(name, default)
    if isinstance(v, str):
        v = v.strip()          # secrets pasted with trailing newlines must never break auth
    if required and not v:
        print("FATAL: missing env " + name)
        sys.exit(1)
    return v


def load_today():
    today = date.today().isoformat()
    path = ARCHIVE / (today + ".json")
    if not path.exists():
        print("no briefing dated " + today + " — nothing to send (weekend/holiday/gated). exit 0")
        sys.exit(0)
    with open(path) as f:
        return today, json.load(f)


def unsub_url(email):
    base, secret = (os.environ.get("LIST_URL") or "").strip() or None, (os.environ.get("UNSUB_SECRET") or "").strip() or None
    if not (base and secret):
        return None
    t = hmac.new(secret.encode(), email.lower().encode(), hashlib.sha256).hexdigest()[:16]
    return (base.rstrip("/") + "/unsubscribe?e=" + urllib.parse.quote(email.lower()) + "&t=" + t)


def flag(day, set_it=False):
    """Day-marker via the worker; makes sending idempotent no matter how many
    times generation completes (manual + scheduled runs, re-runs). Returns
    True if already sent. No worker configured -> no dedup (old behavior)."""
    base, token = (os.environ.get("LIST_URL") or "").strip() or None, (os.environ.get("LIST_TOKEN") or "").strip() or None
    if not (base and token):
        return False
    u = (base.rstrip("/") + "/flag?k=briefed:" + day + "&token=" + urllib.parse.quote(token))
    try:
        req = urllib.request.Request(u, method="POST" if set_it else "GET", headers={"User-Agent": "AGSIST-automation/1.0 (+https://agsist.com; sig@farmers1st.com)"})
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode()).get("set", False)
    except Exception as ex:
        # FAIL CLOSED. This used to return False ("not sent yet") when the
        # worker was unreachable, which meant a flaky network sent the entire
        # list a SECOND copy of the briefing. A missed send is recoverable by
        # rerunning; a duplicate blast to every subscriber is not. Report the
        # day as already flagged so the run stops, and say so loudly.
        print("FATAL: cannot reach the duplicate-send flag (" + type(ex).__name__
              + ": " + str(ex)[:120] + ") — refusing to send rather than risk "
              "emailing the list twice. Rerun once the worker is reachable.")
        return True


def fetch_recipients():
    base, token = (os.environ.get("LIST_URL") or "").strip() or None, (os.environ.get("LIST_TOKEN") or "").strip() or None
    if base and token:
        u = base.rstrip("/") + "/list?token=" + urllib.parse.quote(token)
        req_ = urllib.request.Request(u, headers={"User-Agent": "AGSIST-automation/1.0 (+https://agsist.com; sig@farmers1st.com)"})
        with urllib.request.urlopen(req_, timeout=30) as r:
            body = r.read().decode()
        print("recipient list fetched live from worker")
        return body
    return env("RECIPIENTS", required=True)


def build_email(day, b, to_addr, from_name, from_addr, reply_to):
    """One issue, two bodies, one message.

    Until 2026-08-27 this built a 130-word teaser by hand: headline, lead,
    takeaway, one number, button. That is an advertisement for a website, not a
    briefing, and Sig said so plainly. The body now comes from brief_email,
    which renders the SAME issue as a full HTML letter and as a real plain-text
    alternative. This function is reduced to what it should always have been:
    addressing, unsubscribe headers, and transport.

    Nothing in here reads live prices. Every number in the letter is the
    issue's own locked board measured against the previous session's locked
    board — see brief_email's module docstring for why that rule exists.
    """
    date_display = b.get("date_display") or b.get("date") or day
    uurl = unsub_url(to_addr)

    prior, _prior_day = brief_email.prior_board(b)
    subject = brief_email.subject_line(b, prior)

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = formataddr((from_name, from_addr))
    msg["To"] = to_addr
    msg["Message-ID"] = make_msgid(domain=from_addr.split("@", 1)[1])
    if reply_to:
        msg["Reply-To"] = reply_to
    unsub = reply_to or from_addr
    if uurl:
        msg["List-Unsubscribe"] = "<" + uurl + ">, <mailto:" + unsub + "?subject=unsubscribe>"
        msg["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
    else:
        msg["List-Unsubscribe"] = "<mailto:" + unsub + "?subject=unsubscribe>"

    text = brief_email.render_text(b, SITE, unsub_url=uurl, date_display=date_display)
    hbody = brief_email.render_html(b, SITE_HREF, unsub_url=uurl, date_display=date_display)

    # set_content first, add_alternative second: that ordering is what makes it
    # multipart/alternative with the HTML preferred and the text a real
    # fallback, not an attachment.
    msg.set_content(text)
    msg.add_alternative(hbody, subtype="html")
    return msg


def main():
    day, b = load_today()
    from_addr = env("FROM_ADDR") or env("SMTP_USER", required=True)
    from_name = env("FROM_NAME", "AGSIST Daily")
    reply_to = env("REPLY_TO")
    dry = env("DRY_RUN", "") == "1"

    if not dry and flag(day):
        print("already sent for " + day + " (day-flag set) — skipping. exit 0")
        return 0
    raw = fetch_recipients()
    recipients = [r.strip() for r in re.split(r"[,\n]", raw) if r.strip() and "@" in r]
    if not recipients:
        print("FATAL: RECIPIENTS parsed to zero addresses")
        return 1
    print("briefing " + day + " · recipients " + str(len(recipients)) + " · dry_run " + str(dry))

    if dry:
        m = build_email(day, b, recipients[0], from_name, from_addr, reply_to)
        _prior, _pday = brief_email.prior_board(b)
        print("SUBJECT: " + str(m["Subject"]))
        print("board: this issue's locked close, against " + str(_pday or "(no prior board found)"))
        htm = m.get_body(("html",))
        txt = m.get_body(("plain",))
        print("parts: html " + str(len(htm.get_content())) + " bytes, text "
              + str(len(txt.get_content().split())) + " words")
        print("-" * 60)
        print(txt.get_content()[:1200])
        if os.environ.get("DUMP_HTML"):
            with open(os.environ["DUMP_HTML"], "w", encoding="utf-8") as fh:
                fh.write(htm.get_content())
            print("html written to " + os.environ["DUMP_HTML"])
        print("dry run complete — nothing sent")
        return 0

    host = env("SMTP_HOST", "smtp.gmail.com")
    port = int(env("SMTP_PORT", "587"))
    user = env("SMTP_USER", required=True)
    pw = env("SMTP_PASS", required=True)

    sent, failed = 0, []
    ctx = ssl.create_default_context()

    def connect():
        """A fresh, logged-in connection. Called again if one dies mid-list."""
        c = smtplib.SMTP(host, port, timeout=30)
        c.starttls(context=ctx)
        c.login(user, pw)
        return c

    # ONE CONNECTION SERVED THE WHOLE LIST, AND THAT WAS THE QUIET HALF.
    #
    # The wide `except Exception` below was added after issue #177 went out
    # seven times: a socket timeout, an SSLError or a reset connection is not
    # an SMTPException, so it aborted the loop with the day flag never set and
    # the rerun re-sent to everyone who already had it.
    #
    # But catching it per recipient is not enough on its own. A dead socket
    # fails EVERY remaining send, so a drop at recipient N meant everyone after
    # N silently got nothing while `sent > 0` still flagged the day delivered
    # and a rerun refused. One reconnect per fatal failure, three at most, so a
    # bad socket costs one email rather than the tail of the list.
    conn = connect()
    reconnects, MAX_RECONNECTS = 0, 3
    try:
        for i, r in enumerate(recipients):
            try:
                conn.send_message(build_email(day, b, r, from_name, from_addr, reply_to))
                sent += 1
            except Exception as ex:
                failed.append(r + " (" + type(ex).__name__ + ")")
                # smtplib.SMTPException INHERITS FROM OSError in Python 3, so a
                # bare isinstance(ex, OSError) is true for every SMTP error
                # there is — including one refused address, which would then
                # open a whole new connection. A raw OSError that is NOT an
                # SMTPException is the one that means the pipe is dead.
                fatal = (isinstance(ex, (smtplib.SMTPServerDisconnected,
                                         smtplib.SMTPConnectError))
                         or (isinstance(ex, OSError)
                             and not isinstance(ex, smtplib.SMTPException)))
                if fatal and reconnects < MAX_RECONNECTS and i < len(recipients) - 1:
                    reconnects += 1
                    print("  connection lost after %d sent; reconnecting (%d/%d)"
                          % (sent, reconnects, MAX_RECONNECTS))
                    try:
                        conn.quit()
                    except Exception:
                        pass
                    try:
                        conn = connect()
                    except Exception as ex2:
                        print("::error::could not reconnect (%s) — %d of %d briefings sent"
                              % (type(ex2).__name__, sent, len(recipients)))
                        break
            if i < len(recipients) - 1:
                time.sleep(1.2)  # gentle throttle keeps Gmail happy
    finally:
        try:
            conn.quit()
        except Exception:
            pass
    print("sent " + str(sent) + "/" + str(len(recipients)))
    # Set the day flag whenever ANY mail went out. Anyone who received a copy
    # must never get a second one, so the flag is about the day, not about
    # success. Failures are reported for a targeted resend, not a full rerun.
    if sent > 0:
        flag(day, set_it=True)
    if failed:
        print("::error::failed (" + str(len(failed)) + " of " + str(len(recipients))
              + ") — the day is flagged, so a plain rerun will NOT resend to "
              "anyone. Resend to these addresses individually: " + ", ".join(failed))
    return 0 if sent > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
