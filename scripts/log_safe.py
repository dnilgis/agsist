#!/usr/bin/env python3
"""KEEP SUBSCRIBER ADDRESSES OUT OF THE PUBLIC ACTIONS LOG.

    python3 scripts/log_safe.py --selftest

The repo is public, and so is every Actions run log and every ::error:: /
::warning:: annotation on a run page. A mailer that prints a reader's address
(or the place a reader watches next to their address) publishes it.

The rule for every script that touches the subscriber lists:

  * the log gets COUNTS, and at most a masked address: j***@g***.com
  * a list Sig must act on (failed sends to resend by hand, addresses removed
    by list hygiene) goes to Sig by email through owner_mail(), never the log

mask() and mask_text() never raise. owner_mail() never raises and prints
only whether the private mail went out.
"""
import os
import re
import smtplib
import ssl
import sys
from email.message import EmailMessage

OWNER_DEFAULT = "sig@farmers1st.com"   # already public: site contact address
EMAIL_RX = re.compile(r"[A-Za-z0-9._%+'\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")


def mask(addr):
    """j.smith@gmail.com -> j***@g***.com. Anything not an address -> ***."""
    s = str(addr or "").strip()
    local, at, domain = s.partition("@")
    if not at or not local or not domain:
        return "***"
    host, dot, tld = domain.rpartition(".")
    if not dot or not host:
        return local[:1] + "***@***"
    return local[:1] + "***@" + host[:1] + "***." + tld


def mask_text(text):
    """Mask every address inside a free-text string."""
    return EMAIL_RX.sub(lambda m: mask(m.group(0)), str(text))


def owner_to():
    for k in ("OWNER_TO", "ALERT_TO", "REPORT_TO", "REPLY_TO"):
        v = (os.environ.get(k) or "").strip()
        if v and EMAIL_RX.fullmatch(v):
            return v
    return OWNER_DEFAULT


def owner_mail(subject, lines):
    """Mail Sig a private list (full addresses). Returns True if it went out.

    Uses the job's own SMTP secrets. Prints one line, with no address in it."""
    user = (os.environ.get("SMTP_USER") or os.environ.get("GMAIL_USER") or "").strip()
    pw = (os.environ.get("SMTP_PASS") or os.environ.get("GMAIL_APP_PASS") or "").strip()
    if not (user and pw):
        print("private list for Sig not mailed (no SMTP credentials in this step)")
        return False
    to = owner_to()
    m = EmailMessage()
    m["Subject"] = subject
    m["From"] = (os.environ.get("FROM_ADDR") or "").strip() or user
    m["To"] = to
    run = ""
    if os.environ.get("GITHUB_RUN_ID"):
        run = "\n\nRun: %s/%s/actions/runs/%s" % (
            os.environ.get("GITHUB_SERVER_URL", "https://github.com"),
            os.environ.get("GITHUB_REPOSITORY", ""), os.environ["GITHUB_RUN_ID"])
    m.set_content("\n".join(str(x) for x in lines) + run
                  + "\n\nThis list is mailed to you and is not printed in the public Actions log.\n")
    try:
        c = smtplib.SMTP(os.environ.get("SMTP_HOST") or "smtp.gmail.com",
                         int(os.environ.get("SMTP_PORT") or "587"), timeout=30)
        try:
            c.starttls(context=ssl.create_default_context())
            c.login(user, pw)
            c.send_message(m)
        finally:
            try:
                c.quit()
            except Exception:
                pass
        print("private list (%d line(s)) mailed to Sig" % len(lines))
        return True
    except Exception as ex:
        print("private list for Sig not mailed (%s)" % type(ex).__name__)
        return False


def _selftest():
    fails = []

    def ok(c, m):
        if not c:
            fails.append(m)
    ok(mask("john.smith@gmail.com") == "j***@g***.com", mask("john.smith@gmail.com"))
    ok(mask(" A@b.co.uk ") == "A***@b***.uk", mask(" A@b.co.uk "))
    ok(mask("nobody") == "***", "non-address")
    ok(mask("") == "***" and mask(None) == "***", "empty")
    ok(mask("a@localhost") == "a***@***", mask("a@localhost"))
    t = mask_text("w2@example.com wid1 (SMTPRecipientsRefused), x+y@farm.net")
    ok("w2@example.com" not in t and "x+y@farm.net" not in t, t)
    ok(t.startswith("w***@e***.com wid1 (SMTPRecipientsRefused)"), t)
    ok("x***@f***.net" in t, t)
    saved = {k: os.environ.pop(k, None) for k in ("OWNER_TO", "ALERT_TO", "REPORT_TO", "REPLY_TO")}
    try:
        ok(owner_to() == OWNER_DEFAULT, "default owner")
        os.environ["REPLY_TO"] = "bad value"
        ok(owner_to() == OWNER_DEFAULT, "malformed REPLY_TO used")
        os.environ["REPLY_TO"] = "r@x.com"
        ok(owner_to() == "r@x.com", "REPLY_TO ignored")
    finally:
        os.environ.pop("REPLY_TO", None)
        for k, v in saved.items():
            if v is not None:
                os.environ[k] = v
    if fails:
        for f in fails:
            print("FAIL", f)
        return 1
    print("log_safe selftest ok")
    return 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(_selftest())
