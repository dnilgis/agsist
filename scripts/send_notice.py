#!/usr/bin/env python3
"""
send_notice.py: mail the one-time notices readers asked for (subs worker v5.11).

A reader on an ARC/PLC page clicks "Remind me a week before the Dec 11 signup
deadline" and the worker stores topic arcplc:2026-12-11 under note:<email>.
This script is the other half: on the reminder day it reads the unsent
sign-ups for the topic from GET /notice-list, mails each address once, and
marks it with POST /notice-mark only after the send succeeded. A marked
address is never mailed again, so any number of runs on the same day is safe.

Only the arcplc: template lives here. rent:<st> topics are mailed by
scripts/send_rent_notice.py (cash-rent.yml); `--topic rent:<st>` here hands the
run to it, so neither script refuses a rent notice. Other topics are refused.

WHEN IT SENDS (arcplc). The deadlines are build_arc_plc.py's own YEAR_INFO
closes (2026-12-11, 2027-03-15), the same dates the pages print and the ask
reads. A topic is due when today, in America/Chicago, is deadline - 7 days
(the day the ask promises: "I'll email you on Dec 4"). If every fire that day
was dropped by GitHub's scheduler, the next three days still catch it up; the
email names the deadline date and never says "a week". A deadline already
here or past is never mailed.

    python3 scripts/send_notice.py                  # dry run: counts and a preview, sends nothing
    python3 scripts/send_notice.py --send           # the real thing (the workflow passes this)
    python3 scripts/send_notice.py --topic arcplc:2026-12-11 --any-day   # that topic, any day before its deadline
    python3 scripts/send_notice.py --selftest       # fake HTTP and fake SMTP; no network

Env (the same secrets the other senders use): LIST_URL, LIST_TOKEN, UNSUB_SECRET,
SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, FROM_ADDR, REPLY_TO. MAX_PER_RUN
(default 200) caps one run so a big list never eats the Gmail day the briefing
needs; the rest go on the next fire.

The log carries counts only. No address is ever printed, including in error
lines (an SMTP refusal names the address, so only the error's type is shown).
The unsubscribe link is the same signed token as the daily's
(send_watch.token, the worker's hmac16) with &topic=, so it stops this one
notice and nothing else.
"""
import argparse
import html as H
import json
import os
import re
import smtplib
import ssl
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(HERE))
import log_safe  # noqa: E402  sender_addr: the From line, SES-safe
import build_arc_plc as AP              # noqa: E402  deadlines and signup facts, one copy
from send_watch import token, base_msg  # noqa: E402  the worker's hmac16, and the message headers
import email_links                      # noqa: E402  k=<link id> links; never an address in one

SITE = "https://agsist.com"
TZ = ZoneInfo("America/Chicago")
LEAD_DAYS = 7          # the ask: "Remind me a week before"
CATCHUP_DAYS = 3       # dropped fires: still due through deadline - 4
FROM_NAME = "AGSIST"
SIGNATURE = "Sigurd Lindquist, CCA, AGSIST"
FOOT_LINE = "AGSIST, free US farm markets, agsist.com"          # brief_email.render_text's footer
POSTAL = "PO Box 243, Chetek, WI 54728"
UTM = "utm_source=arcplc_reminder&utm_medium=email"
UA = {"User-Agent": "AGSIST-automation/1.0 (+https://agsist.com)"}
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")
MON = ["January", "February", "March", "April", "May", "June", "July", "August",
       "September", "October", "November", "December"]
DOW = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


# ---------------------------------------------------------------- when
def arcplc_deadlines():
    return sorted(AP.YEAR_INFO[py]["close"] for py in AP.YEARS)


def remind_day(iso):
    return date.fromisoformat(iso) - timedelta(days=LEAD_DAYS)


def due_topics(today):
    """arcplc topics whose reminder day is today (or up to CATCHUP_DAYS ago)."""
    return ["arcplc:" + d for d in arcplc_deadlines()
            if remind_day(d) <= today <= remind_day(d) + timedelta(days=CATCHUP_DAYS)]


def check_topic(topic, today, any_day=False):
    """None when the topic may be mailed today, else why not."""
    if re.fullmatch(r"rent:[a-z]{2}", topic or ""):
        return "rent topics are mailed by scripts/send_rent_notice.py"
    m = re.fullmatch(r"arcplc:(\d{4}-\d{2}-\d{2})", topic or "")
    if not m:
        return "no template for this topic"
    iso = m.group(1)
    if iso not in arcplc_deadlines():
        return "not an ARC/PLC deadline in build_arc_plc.py"
    if date.fromisoformat(iso) <= today:
        return "the deadline is today or past"
    if not any_day and topic not in due_topics(today):
        return "not due today (reminder day %s)" % remind_day(iso).isoformat()
    return None


# ---------------------------------------------------------------- what
def long_date(d):
    return "%s, %s %d, %d" % (DOW[d.weekday()], MON[d.month - 1], d.day, d.year)


def page_for(src, repo=REPO):
    """(page url, counter sheet url or None, is a county page) from the stored source.
    The ask stores page:<path of the page it was on>. Only a path that is a real
    ARC/PLC page in this checkout is linked; anything else gets /arc-plc."""
    m = re.fullmatch(r"page:(arc-plc(?:/[a-z0-9-]+){0,2})", str(src or ""))
    path = m.group(1) if m else ""
    parts = path.split("/")
    if (not path or "sheet" in parts or path.endswith("-sheet") or path.startswith("arc-plc/embed")
            or not (Path(repo) / (path + ".html")).is_file()):
        path, parts = "arc-plc", ["arc-plc"]
    page = SITE + "/" + path + "?" + UTM
    if len(parts) == 3:
        return page, "%s/arc-plc/sheet?c=%s/%s&%s" % (SITE, parts[1], parts[2], UTM), True
    return page, None, False


# Address -> the reader's link id (subs worker v5.46), from the /notice-list
# rows each run reads. render() looks the id up here unless it is given one.
LINK_IDS = {}


def unsub_link(base, secret, lid, topic):
    """Subs worker v5.46: ?k=<link id>&t=hmac16(id)&topic=, never the address."""
    return email_links.signed(base, "notice-unsubscribe", lid, secret, end="&topic=" + urllib.parse.quote(topic))


def arcplc_parts(topic, src, today, repo=REPO):
    """(subject, paragraphs). A paragraph is a list of (text, url-or-None) pieces."""
    iso = topic.split(":", 1)[1]
    d = date.fromisoformat(iso)
    py = next(y for y in AP.YEARS if AP.YEAR_INFO[y]["close"] == iso)
    facts = {k: H.unescape(v).replace("\u2019", "'") for k, v in AP.signup_copy(today)["items"]}
    page, sheet, county = page_for(src, repo)
    first = "The %d ARC/PLC signup at your FSA county office closes %s. " % (py, long_date(d))
    first += " ".join(x for x in (facts.get("Sign"), facts.get("Bring")) if x)
    if py == 2026 and facts.get("Skip it"):
        first += " " + facts["Skip it"]
    paras = [[(first, None)]]
    if county:
        paras.append([("Your county's ARC and PLC numbers: ", None), (page, page)])
        paras.append([("A one-page counter sheet to print and take in: ", None), (sheet, sheet)])
    else:
        paras.append([("Find your county's ARC and PLC numbers, and a one-page counter sheet to print, at ", None),
                      (page, page)])
    paras.append([("Find your county office: ", None), (AP.OFFICE, AP.OFFICE)])
    paras.append([("You asked for this one reminder on agsist.com. There won't be another for this deadline.", None)])
    return "ARC/PLC signup closes %s %d" % (MON[d.month - 1][:3], d.day), paras


TEMPLATES = {"arcplc": arcplc_parts}


def render(topic, src, email, base, secret, today, from_addr, reply_to, repo=REPO, lid=None):
    subject, paras = TEMPLATES[topic.split(":", 1)[0]](topic, src, today, repo)
    # raises email_links.LinkError when the reader has no link id: no mail without one
    stop = unsub_link(base, secret, lid or LINK_IDS.get(str(email).strip().lower()), topic)
    text = "\n\n".join("".join(t for t, _ in p) for p in paras)
    text += "\n\n" + SIGNATURE + "\n\n-- \n" + FOOT_LINE + "\nUnsubscribe: " + stop + "\n" + POSTAL + "\n"
    e = H.escape
    P = '<p style="font-size:15px;line-height:1.6;margin:0 0 14px">%s</p>'
    body = "".join(P % "".join(
        ('<a href="%s" style="color:#8a5a00">%s</a>' % (e(u), e(t))) if u else e(t) for t, u in p) for p in paras)
    body += P % e(SIGNATURE)
    foot = ('%s<br><a href="%s" style="color:#6b6b6b">Unsubscribe</a><br>%s'
            % (e(FOOT_LINE), e(stop), e(POSTAL)))
    htm = ('<!doctype html><html><head><meta charset="utf-8">'
           '<meta name="viewport" content="width=device-width,initial-scale=1"></head>'
           '<body style="margin:0;padding:0;background:#f6f3ec">'
           '<div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;padding:24px 16px;'
           'color:#1a1a1a;background:#fffdf8">'
           '<h1 style="font-size:20px;line-height:1.3;margin:0 0 14px">%s</h1>%s'
           '<p style="font-size:13px;color:#6b6b6b;line-height:1.6;margin:22px 0 0;'
           'border-top:1px solid #ddd5c4;padding-top:12px">%s</p></div></body></html>'
           % (e(subject), body, foot))
    m = base_msg(email, subject, FROM_NAME, from_addr, reply_to, stop)
    m.set_content(text)
    m.add_alternative(htm, subtype="html")
    return email_links.check_message(m)   # v5.46: refuses an address in any link


# ---------------------------------------------------------------- transport
def http_json(method, url, body=None):
    # 2026-10-22: scripts/list_source.py: the worker, or the private copy of its
    # list when it is blocked (a notice-mark then goes to the journal there)
    import list_source
    return list_source.request(method, url, body, UA)


def smtp_connect():
    c = smtplib.SMTP(env("SMTP_HOST", "smtp.gmail.com"), int(env("SMTP_PORT", "587")), timeout=30)
    c.starttls(context=ssl.create_default_context())
    c.login(env("SMTP_USER"), env("SMTP_PASS"))
    return c


def env(name, default=None):
    v = (os.environ.get(name) or "").strip()
    return v or default


def mark(http, base, tok, email, topic, sleep):
    for i in range(3):
        try:
            r = http("POST", "%s/notice-mark?token=%s" % (base, urllib.parse.quote(tok)), {"email": email, "topic": topic})
            if isinstance(r, dict) and r.get("ok"):
                return True
        except Exception:
            pass
        sleep(2 * (i + 1))
    return False


# ---------------------------------------------------------------- the run
def run(argv, http=http_json, connect=smtp_connect, now=None, sleep=time.sleep, out=print, rent_run=None):
    p = argparse.ArgumentParser(add_help=False)
    p.add_argument("--topic", default="")
    p.add_argument("--send", action="store_true")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--any-day", action="store_true")
    p.add_argument("--max", type=int, default=int(env("MAX_PER_RUN", "200")))
    a = p.parse_args(argv)
    send = a.send and not a.dry_run
    today = (now or datetime.now(TZ)).astimezone(TZ).date()
    topic_in = a.topic.strip().lower()
    if re.fullmatch(r"rent:[a-z]{2}", topic_in):
        # the rent release has its own rule (the first release after the sign-up)
        if rent_run is None:
            import send_rent_notice
            rent_run = send_rent_notice.run
        return rent_run(argv, http=http, connect=connect, now=now, sleep=sleep, out=out)

    if topic_in:
        topics = [topic_in]
    else:
        topics = due_topics(today)
        if not topics:
            nxt = [d for d in arcplc_deadlines() if remind_day(d) > today]
            out("no notice due on %s (America/Chicago)%s. Nothing to do." % (
                today.isoformat(), "; next: arcplc:%s on %s" % (nxt[0], remind_day(nxt[0]).isoformat()) if nxt else ""))
            return 0
    for t in topics:
        why = check_topic(t, today, a.any_day and bool(topic_in))
        if why:
            out("refused %s: %s" % (t, why))
            return 1

    base, tok, secret = env("LIST_URL"), env("LIST_TOKEN"), env("UNSUB_SECRET")
    if not (base and tok and secret):
        out("LIST_URL, LIST_TOKEN and UNSUB_SECRET are required")
        return 1
    base = base.rstrip("/")
    from_addr = log_safe.sender_addr("news@agsist.com")
    reply_to = env("REPLY_TO")
    out("date %s (America/Chicago), mode %s" % (today.isoformat(), "SEND" if send else "dry run"))

    total_sent = total_failed = total_todo = 0
    marking_broken = False
    for topic in topics:
        try:
            rows = http("GET", "%s/notice-list?token=%s&topic=%s&unsent=1" % (
                base, urllib.parse.quote(tok), urllib.parse.quote(topic)))
        except Exception as ex:
            out("%s: could not read the list (%s)" % (topic, type(ex).__name__))
            return 1
        if not isinstance(rows, list):
            out("%s: the list did not come back as a list" % topic)
            return 1
        todo, seen, skipped = [], set(), 0
        for r in rows:
            e = str((r or {}).get("email") or "").strip().lower()
            lid = email_links.lid_of(r)   # v5.46: no link id, no mail this run
            if (r or {}).get("topic") != topic or (r or {}).get("sent") or not EMAIL_RE.match(e) or e in seen or not lid:
                skipped += 1
                continue
            seen.add(e)
            LINK_IDS[e] = lid
            todo.append((e, str(r.get("src") or "")))
        later = max(0, len(todo) - a.max)
        todo = todo[:a.max]
        total_todo += len(todo)
        county = sum(1 for _, s in todo if page_for(s)[2])
        out("%s: %d to mail (%d link a county page, %d link /arc-plc), %d skipped (sent or not valid), %d left for the next run"
            % (topic, len(todo), county, len(todo) - county, skipped, later))

        if not send:
            m = render(topic, "page:arc-plc/wisconsin/chippewa-county", "reader@example.com", base, "preview",
                       today, from_addr, reply_to, lid=email_links.SAMPLE_LID)
            out("preview (a made-up address, county and link id, a made-up unsubscribe token):")
            out("Subject: " + str(m["Subject"]))
            out(m.get_body(("plain",)).get_content().rstrip())
            out("dry run: nothing sent, nothing marked. Pass --send to mail.")
            continue
        if not todo:
            continue

        conn, sent, failed, reconnects = None, 0, 0, 0
        try:
            conn = connect()
            for i, (e, src) in enumerate(todo):
                try:
                    conn.send_message(render(topic, src, e, base, secret, today, from_addr, reply_to))
                except Exception as ex:
                    failed += 1
                    out("  send failed (%s)" % type(ex).__name__)
                    dead = isinstance(ex, (smtplib.SMTPServerDisconnected, smtplib.SMTPConnectError)) or \
                        (isinstance(ex, OSError) and not isinstance(ex, smtplib.SMTPException))
                    if dead and reconnects < 3 and i < len(todo) - 1:
                        reconnects += 1
                        try:
                            conn.quit()
                        except Exception:
                            pass
                        try:
                            conn = connect()
                        except Exception as ex2:
                            out("  could not reconnect (%s)" % type(ex2).__name__)
                            break
                    continue
                sent += 1
                if not mark(http, base, tok, e, topic, sleep):
                    # Every send after this would be mailed again on the next run.
                    out("::error::%s: a sent notice could not be marked; stopping so nobody gets two" % topic)
                    marking_broken = True
                    break
                if i < len(todo) - 1:
                    sleep(1.2)
        except Exception as ex:
            out("  could not connect to SMTP (%s)" % type(ex).__name__)
        finally:
            try:
                if conn:
                    conn.quit()
            except Exception:
                pass
        out("%s: sent %d, failed %d" % (topic, sent, failed))
        total_sent += sent
        total_failed += failed
        if marking_broken:
            break

    if not send:
        return 0
    if marking_broken:
        return 1
    if total_todo and not total_sent:
        out("::error::nothing was sent (%d failed)" % total_failed)
        return 1
    if total_failed:
        out("::warning::%d failed; they stay unmarked and the next run tries them again" % total_failed)
    return 0


# ---------------------------------------------------------------- selftest
def selftest():
    import hashlib
    import hmac
    import shutil
    import subprocess
    import tempfile

    fails = []

    def ck(name, cond, detail=""):
        print(("ok   " if cond else "FAIL ") + name + (("  " + str(detail)) if detail and not cond else ""))
        if not cond:
            fails.append(name)

    T = "arcplc:2026-12-11"
    C = lambda s: datetime.fromisoformat(s).replace(tzinfo=TZ)

    # when
    ck("deadlines come from build_arc_plc", arcplc_deadlines() == ["2026-12-11", "2027-03-15"], arcplc_deadlines())
    ck("due on Dec 4 2026", due_topics(date(2026, 12, 4)) == [T])
    ck("not due Dec 3", due_topics(date(2026, 12, 3)) == [])
    ck("catch-up through Dec 7, not Dec 8", due_topics(date(2026, 12, 7)) == [T] and due_topics(date(2026, 12, 8)) == [])
    ck("2027 deadline fires Mar 8 2027", due_topics(date(2027, 3, 8)) == ["arcplc:2027-03-15"])
    ck("Dec 4 2027 is not a reminder day", due_topics(date(2027, 12, 4)) == [])
    ck("ask copy matches: reminder day is deadline - 7", remind_day("2026-12-11") == date(2026, 12, 4))
    ck("rent:wi points at its own sender", check_topic("rent:wi", date(2026, 12, 4)) == "rent topics are mailed by scripts/send_rent_notice.py")
    ck("a made-up topic has no template", check_topic("hail:wi", date(2026, 12, 4)) == "no template for this topic")
    ck("a made-up date is refused", check_topic("arcplc:2026-12-12", date(2026, 12, 4), True) is not None)
    ck("past deadline refused even with --any-day", check_topic(T, date(2026, 12, 11), True) is not None)
    ck("--any-day allows an early manual send", check_topic(T, date(2026, 11, 20), True) is None)

    # links
    pg, sh, cty = page_for("page:arc-plc/wisconsin/chippewa-county")
    ck("county source links its county page and sheet",
       cty and pg.startswith(SITE + "/arc-plc/wisconsin/chippewa-county?") and
       sh.startswith(SITE + "/arc-plc/sheet?c=wisconsin/chippewa-county&"), (pg, sh))
    for bad in ("page:arc-plc/wisconsin/no-such-county", "page:arc-plc/../index", "page:home", "", None,
                "page:arc-plc/sheet", "page:arc-plc/wisconsin/adams-county-sheet", "javascript:alert(1)"):
        pg, sh, cty = page_for(bad)
        ck("source %r falls back to /arc-plc" % (bad,), pg == SITE + "/arc-plc?" + UTM and sh is None and not cty, pg)
    pg, sh, cty = page_for("page:arc-plc/wisconsin")
    ck("state page source links the state page, no sheet", pg.startswith(SITE + "/arc-plc/wisconsin?") and sh is None)

    # the unsubscribe link: the worker's own hmac16 and route
    L0 = email_links.SAMPLE_LID
    LINK_IDS["a@farm.com"] = L0
    u = unsub_link("https://w.dev/", "sec", L0, T)
    q = urllib.parse.parse_qs(urllib.parse.urlsplit(u).query)
    ck("unsubscribe link: link id, topic, worker path, no address (v5.46)",
       u.startswith("https://agsist.com/e?a=notice-unsubscribe&k=" + L0 + "&") and q["k"] == [L0] and q["topic"] == [T] and "e" not in q
       and "@" not in u and "%40" not in u)
    ck("token is HMAC-SHA256 of the link id, first 16 hex (the daily's recipe)",
       q["t"] == [hmac.new(b"sec", L0.encode(), hashlib.sha256).hexdigest()[:16]])
    node = shutil.which("node")
    if node:
        js = (
            "import fs from 'node:fs';import os from 'node:os';import path from 'node:path';"
            "import {pathToFileURL} from 'node:url';"
            "const t=path.join(os.tmpdir(),'sn-'+process.pid+'.mjs');fs.copyFileSync(process.argv[1],t);"
            "const w=(await import(pathToFileURL(t).href)).default;fs.unlinkSync(t);"
            "const env={UNSUB_SECRET:'sec',SUBS:{async get(k){return k==='lid:" + L0 + "'?'a@farm.com':null},async put(){},async delete(){},"
            "async list(){return {keys:[],list_complete:true}}}};"
            "for (const u of process.argv.slice(2)){const r=await w.fetch(new Request(u),env);"
            "console.log((await r.json()).title==='Stop this notice for this address?'?'valid':'invalid');}")
        # what e.html asks: <worker>/fd/notice-unsubscribe?<the same params>
        bad = email_links.as_worker(u.replace("&t=" + q["t"][0], "&t=0000000000000000"), "https://w.dev")
        u = email_links.as_worker(u, "https://w.dev")
        try:
            r = subprocess.run([node, "--input-type=module", "-e", js, str(REPO / "workers" / "subs-worker.js"), u, bad],
                               capture_output=True, text=True, timeout=60)
            ck("the worker accepts the link and refuses a forged token", r.stdout.split() == ["valid", "invalid"],
               (r.stdout + r.stderr)[-300:])
        except Exception as ex:
            ck("the worker check ran", False, ex)
    else:
        print("skip the worker check: node is not installed")

    # the email
    m = render(T, "page:arc-plc/wisconsin/chippewa-county", "a@farm.com", "https://w.dev", "sec",
               date(2026, 12, 4), "news@agsist.com", None)
    txt = m.get_body(("plain",)).get_content()
    htm = m.get_body(("html",)).get_content()
    ck("subject", m["Subject"] == "ARC/PLC signup closes Dec 11", m["Subject"])
    ck("deadline named with its weekday", "closes Friday, December 11, 2026." in txt)
    ck("signup facts are build_arc_plc's own", "Producers with a share in the crop sign. FSA says a landowner with no share interest, such as a cash-rent landlord, cannot enroll." in txt
       and "FSA-156EZ" in txt and "Do nothing for 2026 and that farm gets no 2026 payment." in txt)
    ck("signature", SIGNATURE in txt and H.escape(SIGNATURE) in htm)
    ck("footer and postal address, both parts", POSTAL in txt and POSTAL in htm and "Unsubscribe: " + unsub_link("https://w.dev", "sec", L0, T) in txt)
    ck("no @ inside any href, no address in a text link (v5.46)",
       not [x for x in email_links.hrefs(htm) if "@" in x or "%40" in x.lower()] and not email_links.bad_links(txt))
    ck("List-Unsubscribe one-click header", m["List-Unsubscribe"] == "<%s>, <%s>" % (email_links.STOP_MAILTO, unsub_link("https://w.dev", "sec", L0, T))
       and m["List-Unsubscribe-Post"] is None)
    low = (txt + htm).lower()
    ck("no em or en dash, no hype, no insurance or Farmers First",
       not any(x in txt + htm for x in ("\u2014", "\u2013", "&mdash;", "&ndash;")) and "!" not in txt and
       not any(x in low for x in ("don't miss", "farmers first", "farmers1st", "insurance", "act now", "hurry")))
    m7 = render("arcplc:2027-03-15", "", "a@farm.com", "https://w.dev", "sec", date(2027, 3, 8), "news@agsist.com", None)
    t7 = m7.get_body(("plain",)).get_content()
    ck("2027 reminder: right date, no 2026-only line, /arc-plc link",
       m7["Subject"] == "ARC/PLC signup closes Mar 15" and "Monday, March 15, 2027" in t7 and "2026 payment" not in t7
       and SITE + "/arc-plc?" in t7, t7[:300])

    # the run, against a fake worker and a fake SMTP
    os.environ.update({"LIST_URL": "https://w.dev", "LIST_TOKEN": "tok", "UNSUB_SECRET": "sec",
                       "SMTP_USER": "news@agsist.com", "MAX_PER_RUN": "200"})
    addrs = ["one@farm.com", "two@farm.com", "three@farm.com", "done@farm.com"]

    class Worker:
        def __init__(self):
            self.t = {e: {"src": "page:arc-plc/wisconsin/chippewa-county", "sent": None, "lid": "00000000000000" + "abcd"[i] + "0"}
                      for i, e in enumerate(addrs)}
            self.t["done@farm.com"]["sent"] = 1
            self.log, self.marks, self.fail_marks = [], [], False

        def __call__(self, method, url, body=None):
            path = urllib.parse.urlsplit(url).path
            qs = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
            assert qs.get("token") == ["tok"], "token missing"
            if method == "GET" and path == "/notice-list":
                unsent = qs.get("unsent") == ["1"]
                return [dict({"email": e, "topic": T, "ts": 1, "src": v["src"], "sent": v["sent"]}, **({"lid": v["lid"]} if v.get("lid") else {}))
                        for e, v in self.t.items() if not (unsent and v["sent"])]
            if method == "POST" and path == "/notice-mark":
                if self.fail_marks:
                    raise OSError("down")
                self.log.append(("mark", body["email"]))
                self.marks.append(body["email"])
                self.t[body["email"]]["sent"] = 2
                return {"ok": True}
            raise AssertionError("unexpected call " + method + " " + path)

    class SMTP:
        def __init__(self, w, refuse=(), dead=False):
            self.w, self.refuse, self.dead, self.sent = w, set(refuse), dead, []

        def __call__(self):
            if self.dead:
                raise OSError("no smtp")
            return self

        def send_message(self, msg):
            to = msg["To"]
            self.bodies = getattr(self, "bodies", []) + [msg]
            if to in self.refuse:
                raise smtplib.SMTPRecipientsRefused({to: (550, b"no such user " + to.encode())})
            self.w.log.append(("send", to))
            self.sent.append(to)

        def quit(self):
            pass

    def go(argv, w, s, when="2026-12-04 08:10"):
        lines = []
        rc = run(argv, http=w, connect=s, now=C(when), sleep=lambda x: None, out=lines.append)
        return rc, "\n".join(lines)

    w = Worker()
    s = SMTP(w)
    rc, log = go([], w, s)
    ck("dry run (the default) sends nothing and marks nothing", rc == 0 and not s.sent and not w.marks, log)
    ck("dry run prints a preview with a made-up link id only", "k=" + email_links.SAMPLE_LID in log
       and "%40" not in log and not any(e in log for e in addrs), log)
    rc, log = go(["--dry-run", "--send"], w, s)
    ck("--dry-run wins over --send", rc == 0 and not s.sent and not w.marks)
    rc, log = go(["--send"], w, s, "2026-12-03 08:10")
    ck("not the reminder day: nothing fetched, nothing sent", rc == 0 and not s.sent and not w.log and "next: " + T in log, log)

    w = Worker()
    s = SMTP(w, refuse={"two@farm.com"})
    rc, log = go(["--send"], w, s)
    ck("sends to the unsent, skips the one already marked", sorted(s.sent) == ["one@farm.com", "three@farm.com"], s.sent)
    ck("marks only after a successful send", w.marks == ["one@farm.com", "three@farm.com"]
       and all(w.log.index(("send", e)) < w.log.index(("mark", e)) for e in w.marks), w.log)
    ck("a refused address stays unmarked; exit 0", rc == 0 and w.t["two@farm.com"]["sent"] is None, rc)
    ck("no address in the log, even the refused one", not any(e in log for e in addrs), log)
    s2 = SMTP(w)
    rc, log = go(["--send"], w, s2)
    ck("second run mails only the one that failed", rc == 0 and s2.sent == ["two@farm.com"], s2.sent)
    s3 = SMTP(w)
    rc, log = go(["--send"], w, s3)
    ck("third run mails nobody", rc == 0 and not s3.sent, s3.sent)
    ck("every sent email: its own link id, no address in any link (v5.46)",
       all("k=" + w.t[str(mm["To"])]["lid"] in mm.get_body(("plain",)).get_content()
           and not [x for x in email_links.hrefs(mm.get_body(("html",)).get_content()) if "@" in x or "%40" in x.lower()]
           and not email_links.bad_links(mm.get_body(("plain",)).get_content()) for mm in s.bodies + s2.bodies), len(s.bodies))
    w = Worker()
    w.t["three@farm.com"].pop("lid")
    s = SMTP(w)
    rc, log = go(["--send"], w, s)
    ck("a row with no link id is not mailed (v5.46)", rc == 0 and sorted(s.sent) == ["one@farm.com", "two@farm.com"], s.sent)

    w = Worker()
    s = SMTP(w, refuse=set(addrs))
    rc, log = go(["--send"], w, s)
    ck("total failure exits 1", rc == 1 and not w.marks, log)
    w = Worker()
    rc, log = go(["--send"], w, SMTP(w, dead=True))
    ck("SMTP down exits 1, nothing marked", rc == 1 and not w.marks, log)
    w = Worker()
    w.fail_marks = True
    s = SMTP(w)
    rc, log = go(["--send"], w, s)
    ck("a mark that fails stops the run after one send, exit 1", rc == 1 and len(s.sent) == 1, (rc, s.sent))

    w = Worker()
    s = SMTP(w)
    rc, log = go(["--send", "--max", "1"], w, s)
    ck("--max caps a run and the rest wait", rc == 0 and len(s.sent) == 1 and "2 left for the next run" in log, log)

    # Amazon SES: the login is a key id, not an address, so FROM_ADDR must be set
    saved_from = os.environ.pop("FROM_ADDR", None)
    try:
        os.environ["SMTP_USER"] = "AKIAEXAMPLEKEYID"
        w = Worker()
        s = SMTP(w)
        raised = ""
        try:
            go(["--send"], w, s)
        except RuntimeError as ex:
            raised = str(ex)
        ck("SES login, no FROM_ADDR: stops before reading or sending, and says FROM_ADDR",
           raised == log_safe.FROM_REQUIRED and not s.sent and not w.log, raised)
        os.environ["FROM_ADDR"] = "news@agsist.com"
        froms = []

        class FromSMTP(SMTP):
            def send_message(self, msg):
                froms.append(msg["From"])
                SMTP.send_message(self, msg)
        w = Worker()
        s = FromSMTP(w)
        rc, log = go(["--send"], w, s)
        ck("SES login with FROM_ADDR: sends From the FROM_ADDR, never the key id",
           rc == 0 and len(s.sent) == 3 and froms and all("news@agsist.com" in f and "AKIA" not in f for f in froms), (rc, froms))
    finally:
        os.environ["SMTP_USER"] = "news@agsist.com"
        os.environ.pop("FROM_ADDR", None)
        if saved_from is not None:
            os.environ["FROM_ADDR"] = saved_from
    w = Worker()
    s = SMTP(w)
    handed = []
    rc = run(["--send", "--topic", "rent:wi", "--any-day"], http=w, connect=s, now=C("2026-12-04 08:10"), sleep=lambda x: None,
             out=lambda x: None, rent_run=lambda argv, **k: handed.append(argv) or 7)
    ck("rent:wi is handed to send_rent_notice.py, nothing read here", rc == 7 and handed == [["--send", "--topic", "rent:wi", "--any-day"]] and not w.log)
    rc, log = go(["--send", "--topic", "hail:wi", "--any-day"], w, s)
    ck("a topic with no sender is refused before anything is read", rc == 1 and not w.log, log)
    rc, log = go(["--send", "--topic", T], w, s, "2026-11-20 08:10")
    ck("a manual topic still waits for its day without --any-day", rc == 1 and not s.sent, log)

    print("\n%s: %d failure(s)" % ("FAIL" if fails else "OK", len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv[1:]:
        sys.exit(selftest())
    sys.exit(run(sys.argv[1:]))
