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

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import email_links  # noqa: E402  (every send refuses a link to the worker host; scripts/email_links.py)

OWNER_DEFAULT = "sig@agsist.com"   # already public: site contact address
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


FROM_REQUIRED = "FROM_ADDR is required when SMTP_USER is not an address"


def sender_addr(default=""):
    """The From address every sender uses: FROM_ADDR, else SMTP_USER (or
    GMAIL_USER) when that login is an address, else `default` when there is no
    login at all.

    Gmail logs in with the address itself, so FROM_ADDR could stay empty.
    Amazon SES logs in with an access key id, which is not an address: with
    SES and no FROM_ADDR this raises RuntimeError(FROM_REQUIRED) instead of
    sending mail with a key id in the From line. The message has no secret or
    address in it."""
    fa = (os.environ.get("FROM_ADDR") or "").strip()
    if fa:
        return fa
    user = (os.environ.get("SMTP_USER") or os.environ.get("GMAIL_USER") or "").strip()
    if not user:
        return default
    if "@" not in user:
        raise RuntimeError(FROM_REQUIRED)
    return user


def owner_mail(subject, lines):
    """Mail Sig a private list (full addresses). Returns True if it went out.

    Uses the job's own SMTP secrets. Prints one line, with no address in it."""
    user = (os.environ.get("SMTP_USER") or os.environ.get("GMAIL_USER") or "").strip()
    pw = (os.environ.get("SMTP_PASS") or os.environ.get("GMAIL_APP_PASS") or "").strip()
    if not (user and pw):
        print("private list for Sig not mailed (no SMTP credentials in this step)")
        return False
    try:
        sender = sender_addr()
    except RuntimeError as ex:
        print("private list for Sig not mailed (%s)" % ex)
        return False
    to = owner_to()
    m = EmailMessage()
    m["Subject"] = subject
    m["From"] = sender
    m["To"] = to
    run = ""
    if os.environ.get("GITHUB_RUN_ID"):
        run = "\n\nRun: %s/%s/actions/runs/%s" % (
            os.environ.get("GITHUB_SERVER_URL", "https://github.com"),
            os.environ.get("GITHUB_REPOSITORY", ""), os.environ["GITHUB_RUN_ID"])
    # a note that names the worker host says "the subs worker" instead, so the guard never holds back Sig's own notice
    m.set_content(email_links.scrub_text("\n".join(str(x) for x in lines)) + run
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
    saved = {k: os.environ.pop(k, None) for k in ("FROM_ADDR", "SMTP_USER", "GMAIL_USER", "SMTP_PASS", "GMAIL_APP_PASS")}
    try:
        ok(sender_addr("news@agsist.com") == "news@agsist.com", "no login: the default From")
        os.environ["SMTP_USER"] = "me@gmail.example"
        ok(sender_addr() == "me@gmail.example", "Gmail login is the From when FROM_ADDR is empty")
        os.environ["FROM_ADDR"] = "news@agsist.com"
        ok(sender_addr() == "news@agsist.com", "FROM_ADDR wins over the login")
        os.environ["SMTP_USER"] = "AKIAEXAMPLEKEYID"
        ok(sender_addr() == "news@agsist.com", "SES key id login with FROM_ADDR set")
        os.environ["FROM_ADDR"] = "  "
        try:
            sender_addr("news@agsist.com")
            ok(False, "SES key id login with no FROM_ADDR did not raise")
        except RuntimeError as ex:
            ok(str(ex) == FROM_REQUIRED and "AKIA" not in str(ex), "the SES error names FROM_ADDR and not the key: %s" % ex)
        os.environ["SMTP_PASS"] = "x"
        import io
        import contextlib
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            r = owner_mail("s", ["a"])
        ok(r is False and FROM_REQUIRED in buf.getvalue() and "AKIA" not in buf.getvalue(),
           "owner_mail with an SES login and no FROM_ADDR: not mailed, says why, no key in the log")
    finally:
        for k in ("FROM_ADDR", "SMTP_USER", "GMAIL_USER", "SMTP_PASS", "GMAIL_APP_PASS"):
            os.environ.pop(k, None)
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
