#!/usr/bin/env python3
"""
send_milk_month.py: "Milk price day", one email when USDA announces a month's
Class prices (subs worker v5.58, topic milk-month; dairy board build 5).

A reader on /milk-prices asks "Email me when the month's milk prices are
announced." The worker stores topic milk-month under note:<email>. This script
runs in .github/workflows/dairy.yml right after the AMS announcement was read
and checked, reads the milk-month sign-ups from GET /notice-list, mails each
address once for that class month, and marks it with POST /notice-mark
{month} only after the send went through. A row already marked for that month
(mo) is never mailed again, so any number of runs is safe.

THE NUMBERS are the page's own, from data/dairy-data.json as this run of
scripts/fetch_dairy.py wrote it, and from data/dairy-miss.json (what Read my
check said at the start of the month) and data/dairy-order30.json (the Upper
Midwest order's numbers, only when they are for the same month). Nothing is
computed here that the page does not show.

THE SEND REFUSES (no email to anyone) unless all of these hold:
  * status.class is "ok": this run read the AMS announcement and it passed
    fetch_dairy.py's checks (the three component identities, ranges, the
    month). A failed read keeps last month's file and says so in status.
  * class3_math agrees with class3 (the cheese-milk formula rebuilt from the
    announced components lands on the announced price), and all four
    component prices are there.
  * the class month is the newest one due: the month before today's, or this
    month in its last 3 days (AMS posted September on Sep 30). Nothing older.
  * the file was written in the last 3 days.
  * DAIRY_MONTHLY_LIVE is 1. Sig, Oct 28: on. The workflow passes the repo
    variable and treats it as on unless Sig sets it to 0.

MODES (the same three as send_rain_month.py):
  dry      the default. Counts the list and renders a sample (a made-up
           address and link id) into the log. Sends nothing.
  preview  Sig's test inbox only (SIG_TEST_EMAILS, else SIG_TO), "[Preview]"
           in the subject, any month the file holds. BUILD-RULES 13.
  send     the list. Refused on any check above.

    python3 scripts/send_milk_month.py                    # dry run
    PREVIEW=1 python3 scripts/send_milk_month.py          # Sig's test inbox only
    SEND=1 DAIRY_MONTHLY_LIVE=1 python3 scripts/send_milk_month.py
    python3 scripts/send_milk_month.py --selftest         # fake HTTP and SMTP; no network

Env: LIST_URL, LIST_TOKEN, UNSUB_SECRET, SMTP_*, FROM_ADDR, DAIRY_MONTHLY_LIVE,
SIG_TEST_EMAILS / SIG_TO (preview), MAX_PER_RUN (default 300).
The log carries counts only. No address is ever printed.
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import argparse
import html as H
import json
import os
import smtplib
import sys
import time
import urllib.parse
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(HERE))
import email_links                 # noqa: E402
import log_safe                    # noqa: E402
import send_notice as SN           # noqa: E402
from send_watch import base_msg    # noqa: E402

SITE = SN.SITE
TOPIC = "milk-month"
UTM = "utm_source=milk_month&utm_medium=email"
REPLY_TO = "news@agsist.com"
FROM_NAME = "Sig at AGSIST"
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
          "September", "October", "November", "December"]
MINUS = "−"


def _num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v


def _pos(v):
    return _num(v) and v > 0


def cwt(v):
    return "$%.2f" % v


def sg(v):
    r = round(v + 0.0, 2)
    return ("+" if r > 0 else MINUS if r < 0 else "") + "$%.2f" % abs(r)


def mlabel(k):
    return "%s %s" % (MONTHS[int(k[5:7]) - 1], k[:4])


def mprev(k):
    y, m = int(k[:4]), int(k[5:7])
    return "%d-%02d" % (y - 1, 12) if m == 1 else "%d-%02d" % (y, m - 1)


def _read(repo, rel):
    try:
        return json.loads((Path(repo) / rel).read_text())
    except (OSError, ValueError):
        return None


def due_month(today):
    """The class month a send may be for: the month before today's, or this
    month in its last 3 days."""
    k = "%d-%02d" % (today.year, today.month)
    nxt = (today.replace(day=28) + timedelta(days=4)).replace(day=1)
    if (nxt - today).days <= 3:
        return k
    return mprev(k)


def checked(d, now):
    """(month key, None) when the file is fit to mail, else (None, why)."""
    if not isinstance(d, dict):
        return None, "no dairy-data.json"
    st = d.get("status") or {}
    if st.get("class") != "ok":
        return None, "the AMS announcement was not read in this run (status %s)" % st.get("class")
    k = d.get("class_month_key") or ""
    if len(k) != 7:
        return None, "no class month"
    c = d.get("components") or {}
    if not all(_pos(c.get(x)) for x in ("butterfat", "protein", "nonfat_solids", "other_solids")):
        return None, "component prices missing"
    if not all(_pos(d.get(x)) for x in ("class3", "class4")):
        return None, "class prices missing"
    m3 = d.get("class3_math") or {}
    if not _num(m3.get("class3")) or abs(m3["class3"] - d["class3"]) > 0.005:
        return None, "the Class III formula does not land on the announced price"
    try:
        up = datetime.strptime(str(d.get("updated")), "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return None, "no write time"
    if now - up > timedelta(days=3):
        return None, "the file is %d days old" % (now - up).days
    return k, None


def compose(d, miss, o30, k):
    """(subject, preheader, blocks) for class month k."""
    c3, c4 = d["class3"], d["class4"]
    p3, p4 = d.get("class3_prev"), d.get("class4_prev")
    ml, pm = mlabel(k), MONTHS[int(mprev(k)[5:7]) - 1]
    subj = "Milk price day: %s Class III %s, Class IV %s" % (MONTHS[int(k[5:7]) - 1], cwt(c3), cwt(c4))
    b = [("h1", "%s milk prices are out" % ml)]
    line = "USDA announced %s: Class III %s/cwt" % (ml, cwt(c3))
    if _pos(p3):
        line += " (%s from %s)" % (sg(c3 - p3), pm)
    line += ", Class IV %s/cwt" % cwt(c4)
    if _pos(p4):
        line += " (%s)" % sg(c4 - p4)
    if _pos(d.get("class2")):
        line += ", Class II %s/cwt" % cwt(d["class2"])
    b.append(("p", line + "."))
    cp = d["components"]
    b.append(("p", "Component prices: butterfat $%.4f/lb, protein $%.4f/lb, other solids $%.4f/lb, nonfat solids $%.4f/lb."
              % (cp["butterfat"], cp["protein"], cp["other_solids"], cp["nonfat_solids"])))
    gap = c3 - c4
    if abs(gap) >= 0.005:
        b.append(("p", "Class III minus Class IV: %s/cwt." % sg(gap)))
    r = ((miss or {}).get("months") or {}).get(k) or {}
    if _num(r.get("said")) and _num(r.get("miss")) and r.get("actual") == round(c3, 2):
        mon = MONTHS[int(k[5:7]) - 1]
        ss = str(r.get("said_session") or "")
        sd = "%s %d" % (MONTHS[int(ss[5:7]) - 1][:3], int(ss[8:10])) if len(ss) == 10 else ss
        if r["miss"]:
            b.append(("p", "At the start of %s, Class III futures for the month settled at %s (CME, %s). The announced price came in $%.2f %s that."
                      % (mon, cwt(r["said"]), sd, abs(r["miss"]), "above" if r["miss"] > 0 else "below")))
        else:
            b.append(("p", "At the start of %s, Class III futures for the month settled at %s (CME, %s), the same as the announced price."
                      % (mon, cwt(r["said"]), sd)))
    o = (o30 or {}).get("latest") or {}
    if o.get("month_key") == k and _num(o.get("ppd")) and _pos(o.get("uniform")):
        b.append(("p", "Upper Midwest order (Federal Order 30), %s: producer price differential %s/cwt, statistical uniform price %s/cwt."
                  % (ml, sg(o["ppd"]), cwt(o["uniform"]))))
    b.append(("link", ("Your area, the check reader and the futures: ", "%s/milk-prices?%s" % (SITE, UTM))))
    b.append(("fine", "Class and component prices: USDA AMS, Announcement of Class and Component Prices for %s. "
              "Futures: CME settles. These are announced federal minimums, not your check." % ml))
    b.append(("fine", SN.SIGNATURE + ". You asked for this on agsist.com: one email when each month's milk prices are announced."))
    pre = "Class III %s, Class IV %s for %s." % (cwt(c3), cwt(c4), ml)
    return subj, pre, b


def render(email, base, secret, lid, parts, from_addr, preview=False):
    subject, pre, blocks = parts
    if preview:
        subject = "[Preview] " + subject
    stop = SN.unsub_link(base, secret, lid, TOPIC)
    e = H.escape
    txt, htm = [], []
    P = '<p style="font-size:15px;line-height:1.6;margin:0 0 14px">%s</p>'
    for k, v in blocks:
        if k == "h1":
            htm.append('<h1 style="font-size:20px;line-height:1.3;margin:0 0 14px">%s</h1>' % e(v))
            txt.append(v)
        elif k == "p":
            htm.append(P % e(v))
            txt.append(v)
        elif k == "fine":
            htm.append('<p style="font-size:12px;line-height:1.5;color:#6b6b6b;margin:0 0 14px">%s</p>' % e(v))
            txt.append(v)
        elif k == "link":
            t, u = v
            htm.append(P % (e(t) + '<a href="%s" style="color:#8a5a00">%s</a>' % (e(u), e(u.split("?")[0].replace("https://", "")))))
            txt.append(t + u)
    text = "\n\n".join(txt) + "\n\n-- \n" + SN.FOOT_LINE + "\nUnsubscribe: " + stop + "\n" + SN.POSTAL + "\n"
    foot = '%s<br><a href="%s" style="color:#6b6b6b">Unsubscribe</a><br>%s' % (e(SN.FOOT_LINE), e(stop), e(SN.POSTAL))
    doc = ('<!doctype html><html><head><meta charset="utf-8">'
           '<meta name="viewport" content="width=device-width,initial-scale=1"><title>%s</title></head>'
           '<body style="margin:0;padding:0;background:#f6f3ec">'
           '<div style="display:none;max-height:0;overflow:hidden">%s</div>'
           '<div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;padding:24px 16px;color:#1a1a1a;background:#fffdf8">'
           '%s<p style="font-size:13px;color:#6b6b6b;line-height:1.6;margin:22px 0 0;border-top:1px solid #ddd5c4;padding-top:12px">%s</p>'
           '</div></body></html>') % (e(subject), e(pre), "".join(htm), foot)
    msg = base_msg(email, subject, FROM_NAME, from_addr, REPLY_TO, stop)
    del msg["List-Unsubscribe-Post"]          # the stop link asks first (as send_notice)
    msg.set_content(text)
    msg.add_alternative(doc, subtype="html")
    return email_links.check_message(msg)


def mode_of(argv):
    if SN.env("DRY_RUN", "") == "1" or "--dry-run" in argv:
        return "dry"
    if SN.env("PREVIEW", "") == "1" or "--preview" in argv:
        return "preview"
    if SN.env("SEND", "") == "1" or "--send" in argv:
        return "send"
    return "dry"


def preview_to():
    return [x.strip().lower() for x in (SN.env("SIG_TEST_EMAILS", "") or SN.env("SIG_TO", "") or "").split(",") if "@" in x]


def mark(http, base, tok, email, month, sleep):
    for i in range(3):
        try:
            r = http("POST", "%s/notice-mark?token=%s" % (base, urllib.parse.quote(tok)), {"email": email, "topic": TOPIC, "month": month})
            if isinstance(r, dict) and r.get("ok"):
                return True
        except Exception:
            pass
        sleep(2 * (i + 1))
    return False


def run(argv, http=SN.http_json, connect=SN.smtp_connect, now=None, sleep=time.sleep, out=print, repo=REPO):
    p = argparse.ArgumentParser(add_help=False)
    for a in ("--send", "--preview", "--dry-run"):
        p.add_argument(a, action="store_true")
    p.add_argument("--max", type=int, default=int(SN.env("MAX_PER_RUN", "300")))
    a = p.parse_args(argv)
    mode = mode_of(argv)
    now = now or datetime.now(timezone.utc)
    today = now.astimezone(SN.TZ).date()
    d = _read(repo, "data/dairy-data.json")
    k, why = checked(d, now)
    out("date %s (America/Chicago), mode %s, class month %s" % (today.isoformat(), mode, k or "none"))
    if mode == "send":
        if SN.env("DAIRY_MONTHLY_LIVE", "") != "1":
            out("refused: DAIRY_MONTHLY_LIVE is not 1, so the milk price day list gets nothing. Nothing sent.")
            return 0
        if not k:
            out("not sent: %s. I do not mail old or unchecked numbers. Nothing sent." % why)
            return 0
        if k != due_month(today):
            out("not sent: the class month held is %s, and the month due is %s. Nothing sent." % (k, due_month(today)))
            return 0
    elif not k:
        # dry and preview still show what the file would say, from the newest month held
        k = (d or {}).get("class_month_key") if isinstance(d, dict) and _pos((d or {}).get("class3")) and (d or {}).get("components") else None
        out("note: a send would be refused now (%s)" % why)
        if not k:
            out("nothing to render")
            return 0
    parts = compose(d, _read(repo, "data/dairy-miss.json"), _read(repo, "data/dairy-order30.json"), k)
    base, tok, secret = SN.env("LIST_URL"), SN.env("LIST_TOKEN"), SN.env("UNSUB_SECRET")
    try:
        from_addr = log_safe.sender_addr("news@agsist.com" if mode == "dry" else "")
    except RuntimeError as ex:
        out("FATAL: " + str(ex))
        return 1

    if mode == "dry":
        if base and tok:
            try:
                rows = http("GET", "%s/notice-list?token=%s&topic=%s" % (base.rstrip("/"), urllib.parse.quote(tok), TOPIC))
                if isinstance(rows, list):
                    out("list: %d milk price day sign-up(s)" % len([r for r in rows if (r or {}).get("topic") == TOPIC]))
            except Exception as ex:
                out("could not read the list (%s)" % type(ex).__name__)
        msg = render("reader@example.com", base or "https://w.dev", "preview", email_links.SAMPLE_LID, parts, from_addr)
        out("sample (a made-up address and link id):")
        out("Subject: " + str(msg["Subject"]))
        out(msg.get_body(("plain",)).get_content().rstrip())
        out("dry run: nothing sent, nothing marked.")
        return 0

    if mode == "preview":
        to = preview_to()
        if not to or not (base and secret):
            out("FATAL: a preview needs SIG_TEST_EMAILS or SIG_TO, LIST_URL and UNSUB_SECRET; nothing sent")
            return 1
        import list_source
        sent = 0
        try:
            conn = connect()
        except Exception as ex:
            out("could not connect to SMTP (%s)" % type(ex).__name__)
            return 1
        try:
            for addr in to:
                try:
                    conn.send_message(render(addr, base.rstrip("/"), secret, list_source.lid_for(addr) or email_links.SAMPLE_LID,
                                             parts, from_addr, preview=True))
                    sent += 1
                except Exception as ex:
                    out("  preview send failed (%s)" % type(ex).__name__)
                sleep(1.2)
        finally:
            try:
                conn.quit()
            except Exception:
                pass
        out("preview: %d email(s), Sig's own; the list gets nothing, nothing marked" % sent)
        return 0 if sent else 1

    if not (base and tok and secret):
        out("LIST_URL, LIST_TOKEN and UNSUB_SECRET are required")
        return 1
    base = base.rstrip("/")
    try:
        rows = http("GET", "%s/notice-list?token=%s&topic=%s" % (base, urllib.parse.quote(tok), TOPIC))
    except Exception as ex:
        out("milk-month: could not read the list (%s)" % type(ex).__name__)
        return 1
    if not isinstance(rows, list):
        out("milk-month: the list did not come back as a list")
        return 1
    todo, seen, skipped, done = [], set(), 0, 0
    for r in rows:
        r = r or {}
        e = str(r.get("email") or "").strip().lower()
        lid = email_links.lid_of(r)
        if r.get("topic") != TOPIC or not SN.EMAIL_RE.match(e) or e in seen or not lid:
            skipped += 1
            continue
        seen.add(e)
        if str(r.get("mo") or "") >= k:
            done += 1
            continue
        todo.append((e, lid))
    later = max(0, len(todo) - a.max)
    todo = todo[:a.max]
    out("milk-month:%s: %d to mail, %d already mailed for it, %d skipped, %d left for the next run" % (k, len(todo), done, skipped, later))
    if not todo:
        return 0
    conn, sent, failed, broken, reconnects = None, 0, 0, False, 0
    try:
        conn = connect()
        for i, (e, lid) in enumerate(todo):
            try:
                conn.send_message(render(e, base, secret, lid, parts, from_addr))
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
            if not mark(http, base, tok, e, k, sleep):
                out("::error::milk-month: a sent email could not be marked; stopping so nobody gets two")
                broken = True
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
    out("milk-month:%s: sent %d; failed %d" % (k, sent, failed))
    if broken:
        return 1
    if todo and not sent:
        out("::error::nothing was sent (%d failed)" % failed)
        return 1
    if failed:
        out("::warning::%d failed; they stay unmarked and the next run tries them again" % failed)
    return 0


# ---------------------------------------------------------------- selftest
def selftest():
    import re
    import tempfile
    fails = []

    def ck(name, cond, detail=""):
        print(("ok   " if cond else "FAIL ") + name + (("  " + str(detail)) if detail and not cond else ""))
        if not cond:
            fails.append(name)

    tmp = tempfile.mkdtemp()
    os.makedirs(os.path.join(tmp, "data"))
    # the real September 2026 file (CLS-0926, posted Sep 30)
    sep = {"updated": "2026-09-30T19:59:13Z", "status": {"class": "ok"}, "class_month": "September 2026", "class_month_key": "2026-09",
           "class2": 17.6, "class3": 16.04, "class4": 18.94, "class2_prev": 18.71, "class3_prev": 16.64, "class4_prev": 17.36,
           "components": {"butterfat": 1.4762, "protein": 2.6619, "nonfat_solids": 1.5343, "other_solids": 0.4147},
           "class3_math": {"class3": 16.04, "class3_exact": 16.0423}}

    def put(name, obj):
        json.dump(obj, open(os.path.join(tmp, "data", name), "w"))
    put("dairy-data.json", sep)
    put("dairy-miss.json", {"months": {"2026-09": {"said": 16.30, "said_session": "2026-08-31", "actual": 16.04, "miss": -0.26}}})
    put("dairy-order30.json", {"latest": {"month_key": "2026-08", "ppd": -0.5, "uniform": 16.5}})
    t_ok = datetime(2026, 9, 30, 21, 0, tzinfo=timezone.utc)

    k, why = checked(sep, t_ok)
    ck("the real September file passes", k == "2026-09", why)
    ck("due month on Sep 30 is September (last 3 days)", due_month(date(2026, 9, 30)) == "2026-09")
    ck("due month on Oct 5 is September", due_month(date(2026, 10, 5)) == "2026-09")
    ck("due month on Oct 20 is September, never October", due_month(date(2026, 10, 20)) == "2026-09")
    for bad, label in ((dict(sep, status={"class": "failed"}), "a failed read"),
                       (dict(sep, class3_math={"class3": 16.10}), "a formula that misses"),
                       (dict(sep, components={"butterfat": 1.4762, "protein": 2.6619}), "missing components"),
                       (dict(sep, updated="2026-09-20T00:00:00Z"), "a file ten days old")):
        ck("refused: " + label, checked(bad, t_ok)[0] is None)

    parts = compose(sep, _read(tmp, "data/dairy-miss.json"), _read(tmp, "data/dairy-order30.json"), "2026-09")
    msg = render("a@example.com", "https://w.dev", "sec", email_links.SAMPLE_LID, parts, "news@agsist.com")
    txt = msg.get_body(("plain",)).get_content()
    ck("subject carries the month and both prices", msg["Subject"] == "Milk price day: September Class III $16.04, Class IV $18.94", msg["Subject"])
    ck("Class III with its change", "Class III $16.04/cwt (−$0.60 from August)" in txt, txt)
    ck("components to four places", "protein $2.6619/lb" in txt)
    ck("the miss line, from the log", "settled at $16.30 (CME, Aug 31). The announced price came in $0.26 below that." in txt, txt)
    ck("an Order 30 line for another month is left out", "Federal Order 30" not in txt)
    htm = msg.get_body(("html",)).get_content()
    ck("no @ in any link, no address in a text link",
       not [x for x in email_links.hrefs(htm) if "@" in x or "%40" in x.lower()] and not email_links.bad_links(txt))
    ck("stop link is the milk-month list", "topic=milk-month" in txt)
    ck("no em dash", "—" not in txt and "—" not in str(msg["Subject"]))

    # the run: fake list, fake SMTP
    sent_to, marks = [], []

    class Conn:
        def send_message(self, m):
            sent_to.append(m["To"])

        def quit(self):
            pass

    rows = [{"email": "a@example.com", "topic": "milk-month", "lid": "1" * 16},
            {"email": "b@example.com", "topic": "milk-month", "lid": "2" * 16, "mo": "2026-09"},
            {"email": "c@example.com", "topic": "rent:wi", "lid": "3" * 16}]

    def http(method, url, body=None):
        if method == "GET":
            return rows
        marks.append(body)
        return {"ok": True}

    os.environ.update({"LIST_URL": "https://w.dev", "LIST_TOKEN": "tok", "UNSUB_SECRET": "sec", "SMTP_USER": "news@agsist.com"})
    for v in ("SEND", "PREVIEW", "DRY_RUN", "DAIRY_MONTHLY_LIVE", "FROM_ADDR", "SIG_TO", "SIG_TEST_EMAILS"):
        os.environ.pop(v, None)
    log = []
    run(["--send"], http=http, connect=Conn, now=t_ok, sleep=lambda s: None, out=log.append, repo=tmp)
    ck("not live: nothing sent", not sent_to and any("DAIRY_MONTHLY_LIVE is not 1" in x for x in log), log)
    os.environ["DAIRY_MONTHLY_LIVE"] = "1"
    log = []
    run(["--send"], http=http, connect=Conn, now=t_ok, sleep=lambda s: None, out=log.append, repo=tmp)
    ck("live: only the opted-in reader not yet mailed gets it", sent_to == ["a@example.com"], sent_to)
    ck("marked with the class month", marks == [{"email": "a@example.com", "topic": "milk-month", "month": "2026-09"}], marks)
    ck("the log has counts, no address", not any("@example.com" in x for x in log), log)
    sent_to.clear()
    marks.clear()
    log = []
    run(["--send"], http=http, connect=Conn, now=datetime(2026, 10, 20, 15, tzinfo=timezone.utc), sleep=lambda s: None, out=log.append, repo=tmp)
    ck("a stale file (written Sep 30, now Oct 20) sends nothing", not sent_to and any("not sent" in x for x in log), log)
    put("dairy-data.json", dict(sep, status={"class": "failed"}, updated="2026-10-05T15:00:00Z"))
    log = []
    run(["--send"], http=http, connect=Conn, now=datetime(2026, 10, 5, 16, tzinfo=timezone.utc), sleep=lambda s: None, out=log.append, repo=tmp)
    ck("a failed read in this run sends nothing", not sent_to and any("not read in this run" in x for x in log), log)
    put("dairy-data.json", dict(sep, updated="2026-11-04T15:00:00Z"))
    log = []
    run(["--send"], http=http, connect=Conn, now=datetime(2026, 11, 4, 16, tzinfo=timezone.utc), sleep=lambda s: None, out=log.append, repo=tmp)
    ck("September numbers on Nov 4 (October due) send nothing", not sent_to and any("month due is 2026-10" in x for x in log), log)
    os.environ.pop("DAIRY_MONTHLY_LIVE", None)
    log = []
    rc = run([], http=http, connect=Conn, now=datetime(2026, 11, 4, 16, tzinfo=timezone.utc), sleep=lambda s: None, out=log.append, repo=tmp)
    ck("dry run renders and sends nothing", rc == 0 and not sent_to and any("dry run" in x for x in log), log)
    print()
    if fails:
        print("%d FAILED" % len(fails))
        return 1
    print("OK: 0 failure(s)")
    return 0


if __name__ == "__main__":
    if "--selftest" in sys.argv[1:]:
        sys.exit(selftest())
    sys.exit(run(sys.argv[1:]))
