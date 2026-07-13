#!/usr/bin/env python3
"""
AGSIST daily briefing sender — no paid ESP required.

Reads today's briefing from data/daily-archive/YYYY-MM-DD.json (already in
the checkout when this runs in Actions) and emails a teaser to every address
on the list, linking to https://agsist.com/daily for the full read. Keeping
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
    RECIPIENTS  the list — comma or newline separated
    DRY_RUN     "1" = render and report, send nothing

Safety rails: refuses to send if the newest archived briefing is not dated
today (weekend, holiday, or gate-blocked morning = silent skip, exit 0).
Sends individually (one To: per message — no exposed CC lists, better
deliverability), throttled, with a List-Unsubscribe header. Individual
failures are reported and tolerated; total failure exits nonzero.
"""
import html
import json
import os
import re
import smtplib
import ssl
import sys
import time
from datetime import date
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ARCHIVE = REPO / "data" / "daily-archive"
SITE = "https://agsist.com/daily"


def env(name, default=None, required=False):
    v = os.environ.get(name, default)
    if required and not v:
        print("FATAL: missing env " + name)
        sys.exit(1)
    return v


def strip_md(s):
    """Briefing body fields carry light markdown; emails get plain emphasis."""
    return re.sub(r"\*\*(.+?)\*\*", r"\1", s or "")


def load_today():
    today = date.today().isoformat()
    path = ARCHIVE / (today + ".json")
    if not path.exists():
        print("no briefing dated " + today + " — nothing to send (weekend/holiday/gated). exit 0")
        sys.exit(0)
    with open(path) as f:
        return today, json.load(f)


def build_email(day, b, to_addr, from_name, from_addr, reply_to):
    headline = strip_md(b.get("headline", "AGSIST Daily Briefing"))
    lead = strip_md(b.get("lead", ""))
    takeaway = strip_md(b.get("the_takeaway", ""))
    onum = b.get("one_number") or {}
    date_display = b.get("date_display", day)

    msg = EmailMessage()
    msg["Subject"] = "AGSIST Daily — " + headline
    msg["From"] = formataddr((from_name, from_addr))
    msg["To"] = to_addr
    msg["Message-ID"] = make_msgid(domain=from_addr.split("@", 1)[1])
    if reply_to:
        msg["Reply-To"] = reply_to
    unsub = reply_to or from_addr
    msg["List-Unsubscribe"] = "<mailto:" + unsub + "?subject=unsubscribe>"

    text = (date_display + "\n\n" + headline + "\n\n" + lead + "\n\n"
            + ("THE TAKEAWAY: " + takeaway + "\n\n" if takeaway else "")
            + (("ONE NUMBER: " + str(onum.get("value", "")) + " — "
                + strip_md(onum.get("unit", "")) + "\n\n") if onum.get("value") else "")
            + "Full briefing (charts, calls, basis, and what to watch):\n" + SITE
            + "\n\n—\nAGSIST — free US ag market intelligence · agsist.com"
            + "\nTo unsubscribe, reply with subject line: unsubscribe\n")
    msg.set_content(text)

    e = html.escape
    hbody = (
        '<div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;'
        'padding:24px 16px;color:#1a1a1a;background:#ffffff">'
        '<div style="font-family:Courier,monospace;font-size:12px;color:#6b6b6b;'
        'letter-spacing:.08em;text-transform:uppercase">AGSIST Daily &middot; '
        + e(date_display) + "</div>"
        '<h1 style="font-size:22px;line-height:1.25;margin:10px 0 14px">' + e(headline) + "</h1>"
        '<p style="font-size:15px;line-height:1.6;margin:0 0 14px">' + e(lead) + "</p>"
        + (('<p style="font-size:15px;line-height:1.6;margin:0 0 14px">'
            "<strong>The takeaway:</strong> " + e(takeaway) + "</p>") if takeaway else "")
        + ((('<p style="font-family:Courier,monospace;font-size:14px;'
             'border-left:3px solid #b58a2e;padding-left:10px;margin:0 0 18px">'
             "<strong>" + e(str(onum.get("value", ""))) + "</strong> &mdash; "
             + e(strip_md(onum.get("unit", ""))) + "</p>")) if onum.get("value") else "")
        + '<p style="margin:20px 0"><a href="' + SITE + '" '
        'style="background:#14100a;color:#e9dfc9;text-decoration:none;'
        'padding:10px 18px;font-family:Courier,monospace;font-size:13px">'
        "READ THE FULL BRIEFING &#8594;</a></p>"
        '<p style="font-size:12px;color:#6b6b6b;line-height:1.5">AGSIST &mdash; free US ag '
        'market intelligence &middot; <a href="https://agsist.com" style="color:#6b6b6b">agsist.com</a>'
        "<br>To unsubscribe, reply with subject line: unsubscribe</p></div>")
    msg.add_alternative(hbody, subtype="html")
    return msg


def main():
    day, b = load_today()
    from_addr = env("FROM_ADDR") or env("SMTP_USER", required=True)
    from_name = env("FROM_NAME", "AGSIST Daily")
    reply_to = env("REPLY_TO")
    dry = env("DRY_RUN", "") == "1"

    raw = env("RECIPIENTS", required=True)
    recipients = [r.strip() for r in re.split(r"[,\n]", raw) if r.strip() and "@" in r]
    if not recipients:
        print("FATAL: RECIPIENTS parsed to zero addresses")
        return 1
    print("briefing " + day + " · recipients " + str(len(recipients)) + " · dry_run " + str(dry))

    if dry:
        m = build_email(day, b, recipients[0], from_name, from_addr, reply_to)
        print("SUBJECT: " + m["Subject"])
        print(m.get_body(("plain",)).get_content()[:600])
        print("dry run complete — nothing sent")
        return 0

    host = env("SMTP_HOST", "smtp.gmail.com")
    port = int(env("SMTP_PORT", "587"))
    user = env("SMTP_USER", required=True)
    pw = env("SMTP_PASS", required=True)

    sent, failed = 0, []
    ctx = ssl.create_default_context()
    with smtplib.SMTP(host, port, timeout=30) as s:
        s.starttls(context=ctx)
        s.login(user, pw)
        for i, r in enumerate(recipients):
            try:
                s.send_message(build_email(day, b, r, from_name, from_addr, reply_to))
                sent += 1
            except smtplib.SMTPException as ex:
                failed.append(r + " (" + type(ex).__name__ + ")")
            if i < len(recipients) - 1:
                time.sleep(1.2)  # gentle throttle keeps Gmail happy
    print("sent " + str(sent) + "/" + str(len(recipients)))
    if failed:
        print("failed: " + ", ".join(failed))
    return 0 if sent > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
