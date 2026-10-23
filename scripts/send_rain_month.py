#!/usr/bin/env python3
"""
send_rain_month.py: the monthly county rain email (subs worker v5.54).

A reader on a county rain page (/rain/wisconsin/barron-county) asks "Email me
Barron County's rain at the start of each month." The worker stores topic
rain-month:55005 under note:<email>. This script is the other half: on the
2nd of each month (.github/workflows/rain-monthly.yml, right after that run
fetched and committed the county rain data and rebuilt the pages) it reads the
rain-month: sign-ups from GET /notice-list, mails each address once with its
county's month just ended, and marks it with POST /notice-mark {month} only
after the send went through. A row already marked for that month (mo) is
never mailed again, so any number of runs is safe.

THE NUMBERS are the county page's own, from the same files the page was just
built from (scripts/rain_month.py): the month and the year to date are the
page's month table rows, the drought line is /drought-monitor's county figure,
the day bars are the page's daily file. The rank against the station's own
record reads NOAA GHCN-Daily for the same station and is printed only when it
matches the page (rain_month.rank).

MODES (the same three as send_cot_weekly.py):
  dry      the default. Counts the list and renders a sample (a made-up
           address and link id) into the log. Sends nothing.
  preview  Sig's test inbox only (SIG_TEST_EMAILS, else SIG_TO), one email per
           sample county (--fips, default Barron 55005 and Story 19169), with
           "[Preview]" in the subject. BUILD-RULES 13: this is the copy that
           goes to the spam and link checkers before the list gets anything.
           The list is never read for addresses and nothing is marked.
  send     the list. Refused unless RAIN_MONTHLY_LIVE=1 (Sig turns it on;
           the workflow passes the repo variable) and the month is the one
           just ended.

    python3 scripts/send_rain_month.py                       # dry run
    PREVIEW=1 python3 scripts/send_rain_month.py             # Sig's test inbox only
    SEND=1 RAIN_MONTHLY_LIVE=1 python3 scripts/send_rain_month.py
    python3 scripts/send_rain_month.py --month 2026-09 --out <dir>   # write sample renders, send nothing
    python3 scripts/send_rain_month.py --selftest            # fake HTTP and fake SMTP; no network

Env: LIST_URL, LIST_TOKEN, UNSUB_SECRET, SMTP_HOST, SMTP_PORT, SMTP_USER,
SMTP_PASS, FROM_ADDR (the same as the other senders), RAIN_MONTHLY_LIVE,
SIG_TEST_EMAILS / SIG_TO (preview), MAX_PER_RUN (default 300).

The log carries counts only. No address is ever printed, including in error
lines. Reply-To is news@agsist.com (Sig, Oct 22). The unsubscribe link stops
this one county's monthly email (send_notice.unsub_link, the agsist.com front
door).
"""
import argparse
import calendar
import glob
import html as H
import json
import os
import re
import smtplib
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(HERE))
import email_links                 # noqa: E402  link ids, the front door, check_message
import log_safe                    # noqa: E402  sender_addr
import send_notice as SN           # noqa: E402  unsub_link, footer, transport, EMAIL_RE, TZ
from send_watch import base_msg    # noqa: E402  headers, List-Unsubscribe
import build_county_rain as BCR    # noqa: E402  rain_print_href, rp_prices, rp_cutoffs, long_date
import county_rain as R            # noqa: E402  state names, slugs
import rain_month as RM            # noqa: E402  the page's numbers, as sentences

SITE = SN.SITE
TOPIC_PRE = "rain-month:"
TOPIC_RE = re.compile(r"rain-month:(\d{5})")
UTM = "utm_source=rain_month&utm_medium=email"
REPLY_TO = "news@agsist.com"
FROM_NAME = "Sig at AGSIST"
SAMPLES = ("55005", "19169")        # Barron County, Wisconsin; Story County, Iowa
MAX_STATIONS = 400                  # GHCN files read in one run


# ---------------------------------------------------------------- data
def load(repo):
    """fips -> (st, state file, county record, daily record or None)."""
    out = {}
    for p in sorted(glob.glob(os.path.join(repo, "data", "rain", "*.json"))):
        if not re.fullmatch(r"[a-z]{2}\.json", os.path.basename(p)):
            continue
        try:
            d = json.load(open(p, encoding="utf-8"))
        except ValueError:
            continue
        try:
            dl = json.load(open(os.path.join(repo, "data", "rain", "daily", os.path.basename(p)), encoding="utf-8"))
        except (OSError, ValueError):
            dl = {}
        st = str(d.get("state") or "").upper()
        for fips, c in (d.get("counties") or {}).items():
            out[fips] = (st, d, c, (dl.get("counties") or {}).get(fips) if dl.get("year") == d.get("year") else None)
    return out


def load_drought(repo):
    try:
        return json.load(open(os.path.join(repo, "data", "drought", "county-week.json"), encoding="utf-8"))
    except (OSError, ValueError):
        return None


def page_url(st, c, repo):
    """The county's own rain page when it is in this checkout, else the state page."""
    if st not in R.STATES:
        return "%s/rain?%s" % (SITE, UTM)
    s = R.slug(R.STATES[st])
    p = "rain/%s/%s" % (s, R.slug(c["name"]))
    if (Path(repo) / (p + ".html")).is_file():
        return "%s/%s?%s" % (SITE, p, UTM)
    return "%s/rain/%s?%s" % (SITE, s, UTM)


def tag(u):
    return u + ("&" if "?" in u else "?") + UTM


def ghcn_fetch(gid):
    """The station's whole GHCN-Daily file as text, or None."""
    req = urllib.request.Request(RM.GHCN_URL % gid, headers=SN.UA)
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return r.read().decode("utf-8", "replace")
    except Exception:
        return None


class Records:
    """Each station's GHCN months, read once a run, at most MAX_STATIONS."""

    def __init__(self, fetch=ghcn_fetch):
        self.fetch, self.got, self.n = fetch, {}, 0

    def months(self, sid):
        gid = RM.ghcn_id(sid)
        if not gid:
            return {}          # no GHCN twin: rank says it does not line up
        if gid not in self.got:
            if self.n >= MAX_STATIONS:
                return None
            self.n += 1
            t = self.fetch(gid)
            self.got[gid] = RM.ghcn_months(t) if t else None
        return self.got[gid]


# ---------------------------------------------------------------- the email
def rain_print_lines(c, st, year, m, today, repo):
    """(text, url): the one Rain Print line at the bottom. Christmas wording
    from Oct 1 through the framed Christmas cutoff in data/rain-print.json
    (Dec 9 this year), and only then."""
    pr = BCR.rp_prices()
    price = " (framed $%d, print $%d)" % pr if pr else ""
    name = c["name"]
    cut = BCR.rp_cutoffs()
    if cut and cut[0][:4] == str(today.year) and today.month >= 10 and today.isoformat() <= cut[0]:
        last = today.year - 1
        return ("Rain Print: %s's rain drawn as a print, with your name and dates on it%s. Order %d's framed by %s and it comes "
                "by Christmas; this year's can go under the tree as a gift card, with the print in January. "
                % (name, price, last, BCR.short_date(cut[0])), SITE + tag(BCR.rain_print_href_last(c, st, last)))
    if m == 11:
        return ("Rain Print: all of %d is in now, so %s's full year can be drawn as a print with your name and dates on it%s. "
                % (year, name, price), SITE + tag(BCR.rain_print_href(c, st, year)))
    return ("Rain Print: %s's %d so far, drawn as a print with your name and dates on it%s. Prints of %d ship in January, "
            "once the full year is in. " % (name, year, price, year), SITE + tag(BCR.rain_print_href(c, st, year)))


def compose(fips, year, m, data, w, records, today, repo):
    """(subject, preheader, blocks) for one county, or (None, why)."""
    if fips not in data:
        return None, "no-page"
    st, d, c, day = data[fips]
    if d.get("year") != year:
        return None, "wait-data"
    f = RM.month_facts(c, year, m)
    if not f:
        return None, "no-month"
    full = "%s, %s" % (c["name"], R.STATES.get(st, st))
    noun = "gauge" if c["station"]["net"] == "cocorahs" else "station"
    pct = ", %d%% of usual" % f["pct"] if f["pct"] is not None else ""
    subject = "%s rain, %s: %s in%s" % (c["name"], RM.span(f), BCR.inch(f["total"]), pct)
    hist = records.months(c["station"]["sid"])
    rk = RM.rank(f, c, hist)
    dr = RM.drought_words(w, fips)
    fl = RM.field_line(f, w, fips)
    page = page_url(st, c, repo)
    rp_text, rp_url = rain_print_lines(c, st, year, m, today, repo)
    srcs = ("Rain: NOAA daily records through RCC-ACIS, read %s. Usual: NOAA's 1991 to 2020 daily normals for this %s, "
            "added up over the days it reported." % (BCR.long_date(d["fetched"][:10]), noun)
            if d.get("normals") == "1991-2020" else
            "Rain: NOAA daily records through RCC-ACIS, read %s. Usual: NOAA's 30-year daily normals for this %s, "
            "added up over the days it reported." % (BCR.long_date(d["fetched"][:10]), noun))
    if "rank" in rk:
        srcs += " Earlier years: %s for the same %s." % (RM.GHCN_CREDIT, noun)
    if dr:
        srcs += " Drought: U.S. Drought Monitor county figures (NDMC)."
    blocks = [
        ("h1", "%s: %s %d" % (full, RM.span(f), year)),
        ("p", "Here is %s for %s, from the same %s I use on the county page." % (RM.span(f), c["name"], "volunteer gauge" if noun == "gauge" else "weather station")),
        ("p", RM.month_words(f, c)),
        ("p", RM.ytd_words(f, c)),
        ("p", RM.rank_words(f, c, rk)),
    ]
    if dr:
        blocks.append(("p", dr))
    if fl:
        blocks.append(("p", "In the field: " + fl))
    bars = RM.bars_html(RM.month_days(day, year, m), f)
    if bars:
        blocks.append(("bars", bars))
    blocks += [("link", ("Month by month, the biggest rain and how the %s was picked: " % noun, page)),
               ("fine", srcs),
               ("link", (rp_text, rp_url)),
               ("p", "Sig"),
               ("fine", SN.SIGNATURE + ". You asked for this on agsist.com: one email a month for %s." % full)]
    return (subject, RM.ytd_words(f, c), blocks), "send"


def render(fips, email, base, secret, lid, parts, from_addr, preview=False):
    subject, pre, blocks = parts
    if preview:
        subject = "[Preview] " + subject
    topic = TOPIC_PRE + fips
    stop = SN.unsub_link(base, secret, lid, topic)
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
        elif k == "bars":
            htm.append(v)
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
    del msg["List-Unsubscribe-Post"]          # the stop link asks first; no one-click POST (as send_notice)
    msg.set_content(text)
    msg.add_alternative(doc, subtype="html")
    return email_links.check_message(msg)


# ---------------------------------------------------------------- the run
def last_month(today):
    return (today.year - 1, 11) if today.month == 1 else (today.year, today.month - 2)


def mode_of(argv):
    """dry (default), preview or send. DRY_RUN=1 wins; the list only on SEND=1 / --send."""
    if SN.env("DRY_RUN", "") == "1" or "--dry-run" in argv:
        return "dry"
    if SN.env("PREVIEW", "") == "1" or "--preview" in argv:
        return "preview"
    if SN.env("SEND", "") == "1" or "--send" in argv:
        return "send"
    return "dry"


def preview_to():
    """SIG_TEST_EMAILS (comma list), else SIG_TO. Never printed."""
    return [x.strip().lower() for x in (SN.env("SIG_TEST_EMAILS", "") or SN.env("SIG_TO", "") or "").split(",") if "@" in x]


def mark(http, base, tok, email, topic, month, sleep):
    for i in range(3):
        try:
            r = http("POST", "%s/notice-mark?token=%s" % (base, urllib.parse.quote(tok)), {"email": email, "topic": topic, "month": month})
            if isinstance(r, dict) and r.get("ok"):
                return True
        except Exception:
            pass
        sleep(2 * (i + 1))
    return False


def run(argv, http=SN.http_json, connect=SN.smtp_connect, now=None, sleep=time.sleep, out=print, repo=REPO, ghcn=ghcn_fetch):
    p = argparse.ArgumentParser(add_help=False)
    for a in ("--send", "--preview", "--dry-run"):
        p.add_argument(a, action="store_true")
    p.add_argument("--month", default="")
    p.add_argument("--fips", default="")
    p.add_argument("--out", default="")
    p.add_argument("--max", type=int, default=int(SN.env("MAX_PER_RUN", "300")))
    a = p.parse_args(argv)
    mode = mode_of(argv)
    if a.out:
        mode = "dry"           # writing sample files never sends
    today = (now or datetime.now(SN.TZ)).astimezone(SN.TZ).date()
    ly, lm = last_month(today)
    if a.month:
        mm = re.fullmatch(r"(\d{4})-(0[1-9]|1[0-2])", a.month)
        if not mm:
            out("--month is YYYY-MM")
            return 1
        year, m = int(mm.group(1)), int(mm.group(2)) - 1
    else:
        year, m = ly, lm
    month = "%d-%02d" % (year, m + 1)
    out("date %s (America/Chicago), month %s, mode %s" % (today.isoformat(), month, mode))
    if mode == "send":
        if SN.env("RAIN_MONTHLY_LIVE", "") != "1":
            out("refused: RAIN_MONTHLY_LIVE is not 1, so the monthly rain list gets nothing (Sig turns it on). Nothing sent.")
            return 1
        if (year, m) != (ly, lm):
            out("refused: a send is for the month just ended (%d-%02d), not %s. Nothing sent." % (ly, lm + 1, month))
            return 1

    data = load(repo)
    w = load_drought(repo)
    records = Records(ghcn)
    base, tok, secret = SN.env("LIST_URL"), SN.env("LIST_TOKEN"), SN.env("UNSUB_SECRET")
    try:
        from_addr = log_safe.sender_addr("news@agsist.com" if mode == "dry" else "")
    except RuntimeError as ex:
        out("FATAL: " + str(ex))
        return 1

    # dry and preview: the sample counties
    if mode in ("dry", "preview"):
        fl = [x for x in re.split(r"[,\s]+", a.fips) if x] or list(SAMPLES)
        made = []
        for fips in fl:
            parts, why = compose(fips, year, m, data, w, records, today, repo)
            if not parts:
                out("sample %s: no email (%s)" % (fips, why))
                continue
            made.append((fips, parts))
        if mode == "dry":
            n_list = None
            if base and tok:
                try:
                    rows = http("GET", "%s/notice-list?token=%s&topic=%s" % (base.rstrip("/"), urllib.parse.quote(tok), urllib.parse.quote(TOPIC_PRE)))
                    n_list = len([r for r in rows or [] if TOPIC_RE.fullmatch(str((r or {}).get("topic") or ""))]) if isinstance(rows, list) else None
                except Exception as ex:
                    out("could not read the list (%s)" % type(ex).__name__)
            if n_list is not None:
                out("list: %d monthly rain sign-up(s)" % n_list)
            for fips, parts in made:
                msg = render(fips, "reader@example.com", base or "https://w.dev", "preview", email_links.SAMPLE_LID, parts, from_addr)
                out("sample %s (a made-up address and link id):" % fips)
                out("Subject: " + str(msg["Subject"]))
                out(msg.get_body(("plain",)).get_content().rstrip())
                if a.out:
                    os.makedirs(a.out, exist_ok=True)
                    stem = os.path.join(a.out, "rain-month-%s-%s" % (fips, month))
                    open(stem + ".html", "w", encoding="utf-8").write(msg.get_body(("html",)).get_content())
                    open(stem + ".txt", "w", encoding="utf-8").write("Subject: %s\nFrom: %s\nReply-To: %s\nList-Unsubscribe: %s\n\n%s" % (
                        msg["Subject"], msg["From"], msg["Reply-To"], msg["List-Unsubscribe"], msg.get_body(("plain",)).get_content()))
                    out("wrote " + stem + ".html")
            out("dry run: nothing sent, nothing marked.")
            return 0
        to = preview_to()
        if not to:
            out("FATAL: a preview needs SIG_TEST_EMAILS or SIG_TO; nothing sent")
            return 1
        if not (base and secret):
            out("FATAL: a preview needs LIST_URL and UNSUB_SECRET for its stop link; nothing sent")
            return 1
        if not made:
            out("nothing to preview")
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
                lid = list_source.lid_for(addr) or email_links.SAMPLE_LID
                for fips, parts in made:
                    try:
                        conn.send_message(render(fips, addr, base.rstrip("/"), secret, lid, parts, from_addr, preview=True))
                        sent += 1
                    except Exception as ex:
                        out("  preview send failed (%s)" % type(ex).__name__)
                    sleep(1.2)
        finally:
            try:
                conn.quit()
            except Exception:
                pass
        out("preview: %d email(s) to %d address(es), Sig's own; the list gets nothing, nothing marked" % (sent, len(to)))
        return 0 if sent else 1

    # send: the list
    if not (base and tok and secret):
        out("LIST_URL, LIST_TOKEN and UNSUB_SECRET are required")
        return 1
    base = base.rstrip("/")
    try:
        rows = http("GET", "%s/notice-list?token=%s&topic=%s" % (base, urllib.parse.quote(tok), urllib.parse.quote(TOPIC_PRE)))
    except Exception as ex:
        out("rain-month: could not read the list (%s)" % type(ex).__name__)
        return 1
    if not isinstance(rows, list):
        out("rain-month: the list did not come back as a list")
        return 1
    todo, seen, skipped, done, wait, cache = [], set(), 0, 0, {}, {}
    for r in rows:
        r = r or {}
        e = str(r.get("email") or "").strip().lower()
        t = str(r.get("topic") or "")
        mt = TOPIC_RE.fullmatch(t)
        lid = email_links.lid_of(r)
        if not mt or not SN.EMAIL_RE.match(e) or (e, t) in seen or not lid:
            skipped += 1
            continue
        seen.add((e, t))
        if str(r.get("mo") or "") >= month:
            done += 1
            continue
        fips = mt.group(1)
        if fips not in cache:
            cache[fips] = compose(fips, year, m, data, w, records, today, repo)
        parts, why = cache[fips]
        if not parts:
            wait[why] = wait.get(why, 0) + 1
            continue
        todo.append((e, t, fips, lid))
    later = max(0, len(todo) - a.max)
    todo = todo[:a.max]
    out("%s%s: %d to mail, %d already mailed for it, %d waiting (%s), %d skipped, %d left for the next run, %d station record(s) read"
        % (TOPIC_PRE, month, len(todo), done, sum(wait.values()), ", ".join("%s %d" % kv for kv in sorted(wait.items())) or "none",
           skipped, later, records.n))
    if not todo:
        return 0
    conn, sent, failed, broken, reconnects = None, 0, 0, False, 0
    try:
        conn = connect()
        for i, (e, t, fips, lid) in enumerate(todo):
            try:
                conn.send_message(render(fips, e, base, secret, lid, cache[fips][0], from_addr))
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
            if not mark(http, base, tok, e, t, month, sleep):
                out("::error::%s: a sent email could not be marked; stopping so nobody gets two" % TOPIC_PRE)
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
    out("%s%s: sent %d; failed %d" % (TOPIC_PRE, month, sent, failed))   # the line morning_report.py reads
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
    import hashlib
    import hmac
    import shutil
    import subprocess
    import tempfile
    from zoneinfo import ZoneInfo
    fails = []

    def ck(name, cond, detail=""):
        print(("ok   " if cond else "FAIL ") + name + (("  " + str(detail)) if detail and not cond else ""))
        if not cond:
            fails.append(name)

    TZ = ZoneInfo("America/Chicago")
    C = lambda s: datetime.fromisoformat(s).replace(tzinfo=TZ)
    tmp = tempfile.mkdtemp()
    for dd in ("data/rain/daily", "data/drought", "rain/wisconsin", "rain/iowa"):
        os.makedirs(os.path.join(tmp, dd))
    open(os.path.join(tmp, "rain", "wisconsin", "barron-county.html"), "w").write("x")
    stn = {"ll": [-92.0227, 45.5331], "mi": 11.3, "name": "Cumberland", "net": "noaa", "raw": "CUMBERLAND", "sid": "471923 2"}
    months = [[1.11, 0.95, 31, 31], [0.73, 0.99, 28, 28], [1.76, 1.69, 31, 31], [6.25, 2.83, 30, 30], [2.08, 3.84, 31, 31],
              [5.52, 4.54, 30, 30], [4.12, 4.47, 31, 31], [1.75, 4.4, 31, 31], [3.67, 3.61, 30, 30], [1.06, 2.13, 18, 18]]
    barron = {"name": "Barron County", "as_of": "2026-10-18", "total": 28.05, "usual": 29.45, "pct": 95, "days": 291, "missing": 0,
              "months": months, "station": stn}
    story = dict(barron, name="Story County", station=dict(stn, name="Ames", raw="AMES 5 SE", sid="130203 2", ll=[-93.57, 41.95]),
                 months=months[:8] + [[7.13, 3.84, 30, 30], [3.39, 1.51, 17, 18]])
    wi = {"state": "WI", "year": 2026, "edate": "2026-10-18", "fetched": "2026-10-20T03:18:19Z", "normals": "1991-2020", "counties": {"55005": barron}}
    ia = {"state": "IA", "year": 2026, "edate": "2026-10-18", "fetched": "2026-10-20T03:18:19Z", "normals": "1991-2020", "counties": {"19169": story}}
    for st, d in (("wi", wi), ("ia", ia)):
        json.dump(d, open(os.path.join(tmp, "data", "rain", st + ".json"), "w"))
    json.dump({"year": 2026, "counties": {"55005": {"p": "0*243,9,0*4,120,0*21,5,0*30"}}}, open(os.path.join(tmp, "data", "rain", "daily", "wi.json"), "w"))
    json.dump({"valid": "2026-10-20", "prev4": "2026-09-22", "c": {"55005": [[100, 100, 100, 0, 0]] * 3}, "zero": ["19169"]},
              open(os.path.join(tmp, "data", "drought", "county-week.json"), "w"))

    def ghcn_csv(gid):
        rows = ["ID,DATE,ELEMENT,DATA_VALUE,M_FLAG,Q_FLAG,S_FLAG,OBS_TIME"]
        for y in range(1950, 2027):
            for mo in ((1, 2) if y == 2026 else (9,)):
                n = calendar.monthrange(y, mo)[1]
                tot = {1: 282, 2: 185}.get(mo) if y == 2026 else 254 * ((y * 7) % 60) // 10
                for d in range(1, n + 1):
                    rows.append("%s,%d%02d%02d,PRCP,%d,,,7,0800" % (gid, y, mo, d, tot if d == 1 else 0))
        return "\n".join(rows)
    calls = []

    def fake_ghcn(gid):
        calls.append(gid)
        return ghcn_csv(gid)

    os.environ.update({"LIST_URL": "https://w.dev", "LIST_TOKEN": "tok", "UNSUB_SECRET": "sec", "SMTP_USER": "news@agsist.com",
                       "MAX_PER_RUN": "300"})
    for k in ("SEND", "PREVIEW", "DRY_RUN", "RAIN_MONTHLY_LIVE", "SIG_TO", "SIG_TEST_EMAILS", "FROM_ADDR"):
        os.environ.pop(k, None)
    data = load(tmp)
    w = load_drought(tmp)
    today = date(2026, 10, 2)
    parts, why = compose("55005", 2026, 8, data, w, Records(fake_ghcn), today, tmp)
    m = render("55005", "a@example.com", "https://w.dev", "sec", email_links.SAMPLE_LID, parts, "news@agsist.com")
    txt, htm = m.get_body(("plain",)).get_content(), m.get_body(("html",)).get_content()
    # Barron County, 55005: the page's numbers
    ck("subject: county, month, the page's total and percent", m["Subject"] == "Barron County rain, September: 3.67 in, 102% of usual", m["Subject"])
    ck("the month against usual, the page's row", "September: 3.67 inches at the weather station in Cumberland, 0.06 inches more than usual for the month (usual 3.61, 102% of usual)." in txt, txt[:600])
    ck("the year to date, the page's rows added up", "Year to date, Jan 1 to Sep 30: 26.99 inches. That is 0.33 inches less than a usual year to date (99% of usual)." in txt)
    ck("rank against the station's own record, with its years", re.search(r"That makes it the \d+(st|nd|rd|th) (wettest|driest)( \(tied with [^)]+\))? of 77 Septembers on this station's record, 1950 to 2026, counting the years it reported every day\.", txt), txt)
    ck("drought category and the change", "Drought Monitor, map valid Oct 20, 2026: 100% of it in drought (D1 or worse), the worst part severe drought (D2). Four weeks before (Sep 22, 2026) it was the same." in txt)
    ck("one plain line on the field", txt.count("In the field: ") == 1 and "In the field: " + RM.DROUGHT_FIELD in txt)
    ck("the month's day bars in the HTML, the biggest day named", htm.count('<td style="vertical-align:bottom') == 30 and "Biggest: 1.20 inches on September 6." in htm, htm[:200])
    ck("links the county page", SITE + "/rain/wisconsin/barron-county?" + UTM in txt)
    ck("sources and dates", "NOAA daily records through RCC-ACIS, read Oct 20, 2026" in txt and "NOAA GHCN-Daily for the same station" in txt and "U.S. Drought Monitor" in txt)
    ck("Rain Print once, at the bottom, Christmas wording before Dec 9",
       txt.count("Rain Print:") == 1 and "Order 2025's framed by Dec 9 and it comes by Christmas" in txt and txt.index("Rain Print:") > txt.index("Month by month")
       and SITE + "/rain-print?place=Cumberland%2C+WI&year=2025" in txt, txt)
    p12, _ = compose("55005", 2026, 8, data, w, Records(fake_ghcn), date(2026, 12, 10), tmp)
    t12 = render("55005", "a@example.com", "https://w.dev", "sec", email_links.SAMPLE_LID, p12, "news@agsist.com").get_body(("plain",)).get_content()
    ck("no Christmas wording after Dec 9", "Christmas" not in t12 and "Prints of 2026 ship in January" in t12, t12[-700:])
    ck("first person, signed Sig", "from the same weather station I use on the county page" in txt and "\n\nSig\n\n" in txt)
    ck("reply-to news@agsist.com, from Sig at AGSIST", m["Reply-To"] == "news@agsist.com" and m["From"].startswith("Sig at AGSIST"))
    stop = SN.unsub_link("https://w.dev", "sec", email_links.SAMPLE_LID, "rain-month:55005")
    ck("standard footer: postal address, unsubscribe, List-Unsubscribe", SN.POSTAL in txt and SN.FOOT_LINE in txt and "Unsubscribe: " + stop in txt
       and SN.POSTAL in htm and m["List-Unsubscribe"] == "<%s>, <%s>" % (email_links.STOP_MAILTO, stop), m["List-Unsubscribe"])
    low = (txt + htm).lower()
    ck("no em or en dash, no hype, no AI words", not re.search("[–—]|&mdash;|&ndash;", txt + htm) and "!" not in txt
       and not any(x in low for x in ("don't miss", "act now", "hurry", "powered by", "under the hood", "insurance", "farmers first")))
    ck("no @ in any link, no address in a text link", not [x for x in email_links.hrefs(htm) if "@" in x or "%40" in x.lower()] and not email_links.bad_links(txt))
    ck("every agsist.com link but the stop link is tagged rain_month",
       all(UTM in u for u in re.findall(r"https://agsist\.com/(?!e\?)[^\s\"<>]*", txt + htm.replace("&amp;", "&"))))
    # the unsubscribe link: the worker's own hmac16 and route, this county only
    q = urllib.parse.parse_qs(urllib.parse.urlsplit(stop).query)
    ck("unsubscribe link: front door, link id, this county's topic, no address",
       stop.startswith(email_links.FRONT + "?a=notice-unsubscribe&k=" + email_links.SAMPLE_LID + "&") and q["topic"] == ["rain-month:55005"]
       and "@" not in stop and "%40" not in stop)
    ck("its token is HMAC-SHA256 of the link id, first 16 hex", q["t"] == [hmac.new(b"sec", email_links.SAMPLE_LID.encode(), hashlib.sha256).hexdigest()[:16]])
    node = shutil.which("node")
    if node:
        js = ("import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';"
              "const t=path.join(os.tmpdir(),'srm-'+process.pid+'.mjs');fs.copyFileSync(process.argv[1],t);"
              "const w=(await import(pathToFileURL(t).href)).default;fs.unlinkSync(t);"
              "const store=new Map([['lid:" + email_links.SAMPLE_LID + "','a@farm.com'],['note:a@farm.com',JSON.stringify({ts:1,t:{'rain-month:55005':{ts:1,src:'x'},'rain-month:19169':{ts:1,src:'x'}}})]]);"
              "const env={UNSUB_SECRET:'sec',SUBS:{async get(k){return store.has(k)?store.get(k):null},async put(k,v){store.set(k,v)},async delete(k){store.delete(k)},"
              "async list(){return {keys:[],list_complete:true}}}};"
              "const [ok,bad]=process.argv.slice(2);"
              "let r=await w.fetch(new Request(ok),env);const j=await r.json();console.log(j.title===\"Stop the monthly rain email for this county?\"?'asks':'noask:'+j.title);"
              "r=await w.fetch(new Request(ok,{method:'POST'}),env);const k=await r.json();"
              "const n=JSON.parse(store.get('note:a@farm.com'));console.log(k.title==='Stopped. No more monthly rain emails for this county.'&&!n.t['rain-month:55005']&&n.t['rain-month:19169']?'stopped-one':'wrong:'+JSON.stringify(n));"
              "r=await w.fetch(new Request(bad),env);console.log((await r.json()).ok===false?'refused':'accepted');")
        good = email_links.as_worker(stop, "https://w.dev")
        forged = email_links.as_worker(stop.replace("&t=" + q["t"][0], "&t=0000000000000000"), "https://w.dev")
        try:
            r = subprocess.run([node, "--input-type=module", "-e", js, str(REPO / "workers" / "subs-worker.js"), good, forged],
                               capture_output=True, text=True, timeout=60)
            ck("the worker asks, stops this county only, and refuses a forged token", r.stdout.split() == ["asks", "stopped-one", "refused"],
               (r.stdout + r.stderr)[-400:])
        except Exception as ex:
            ck("the worker check ran", False, ex)
    else:
        print("skip the worker check: node is not installed")

    # Story County, Iowa: no drought, the record matches
    ps, _ = compose("19169", 2026, 8, data, w, Records(fake_ghcn), today, tmp)
    ts = render("19169", "a@example.com", "https://w.dev", "sec", email_links.SAMPLE_LID, ps, "news@agsist.com").get_body(("plain",)).get_content()
    ck("Story County: its own month, no drought, the state page when its page is not in the checkout",
       "September: 7.13 inches at the weather station 5 miles southeast of Ames, 3.29 inches more than usual for the month (usual 3.84, 186% of usual)." in ts
       and "no part of it dry or in drought" in ts and SITE + "/rain/iowa?" + UTM in ts and "In the field: " + RM.FIELD["fall"][2] in ts, ts[:900])
    pd, _ = compose("55005", 2026, 8, data, w, Records(lambda g: None), today, tmp)
    td = render("55005", "a@example.com", "https://w.dev", "sec", email_links.SAMPLE_LID, pd, "news@agsist.com").get_body(("plain",)).get_content()
    ck("record down: says so, no rank, no GHCN credit", "past record did not load this time" in td and "That makes it" not in td and "GHCN" not in td)
    ck("a county with no page, or no row for the month, gets no email", compose("19015", 2026, 8, data, w, Records(fake_ghcn), today, tmp)[1] == "no-page"
       and compose("55005", 2026, 10, data, w, Records(fake_ghcn), today, tmp)[1] == "no-month"
       and compose("55005", 2025, 11, data, w, Records(fake_ghcn), today, tmp)[1] == "wait-data")
    ck("the month just ended", last_month(date(2026, 10, 2)) == (2026, 8) and last_month(date(2027, 1, 2)) == (2026, 11))

    # the run, against a fake worker and a fake SMTP
    addrs = {"one@example.com": "rain-month:55005", "two@example.com": "rain-month:55005", "ia@example.com": "rain-month:19169",
             "done@example.com": "rain-month:55005", "nopage@example.com": "rain-month:19015", "nolid@example.com": "rain-month:55005"}

    class Worker:
        def __init__(self):
            self.t = {e: {"topic": tp, "mo": "2026-09" if e == "done@example.com" else None} for e, tp in addrs.items()}
            self.log, self.marks = [], []

        def __call__(self, method, url, body=None):
            u = urllib.parse.urlsplit(url)
            qs = urllib.parse.parse_qs(u.query)
            assert qs.get("token") == ["tok"]
            if method == "GET" and u.path == "/notice-list":
                self.log.append(("list", qs.get("topic", [""])[0]))
                return [dict({"email": e, "topic": v["topic"], "ts": 1, "src": "page:rain/wisconsin/barron-county", "sent": None},
                             **({"mo": v["mo"]} if v["mo"] else {}), **({} if e == "nolid@example.com" else {"lid": "00000000000000%02x" % i}))
                        for i, (e, v) in enumerate(self.t.items())]
            if method == "POST" and u.path == "/notice-mark":
                self.marks.append((body["email"], body["topic"], body["month"]))
                self.t[body["email"]]["mo"] = body["month"]
                return {"ok": True}
            raise AssertionError(method + " " + u.path)

    class SMTP:
        def __init__(self, refuse=()):
            self.sent, self.refuse, self.msgs = [], set(refuse), []

        def __call__(self):
            return self

        def send_message(self, msg):
            if msg["To"] in self.refuse:
                raise smtplib.SMTPRecipientsRefused({msg["To"]: (550, b"no")})
            self.sent.append(msg["To"])
            self.msgs.append(msg)

        def quit(self):
            pass

    def go(argv, w, s, when, env=None):
        lines = []
        old = {k: os.environ.get(k) for k in (env or {})}
        os.environ.update(env or {})
        try:
            rc = run(argv, http=w, connect=s, now=C(when), sleep=lambda x: None, out=lines.append, repo=tmp, ghcn=fake_ghcn)
        finally:
            for k, v in old.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v
        return rc, "\n".join(lines)

    # THE GATE: nothing reaches the list without RAIN_MONTHLY_LIVE=1
    w, s = Worker(), SMTP()
    rc, log = go(["--send"], w, s, "2026-10-02 09:00")
    ck("gate: --send without RAIN_MONTHLY_LIVE sends nothing, reads nothing, exits 1", rc == 1 and not s.sent and not w.log and not w.marks
       and "RAIN_MONTHLY_LIVE is not 1" in log, log)
    for v in ("0", "", "true", "yes", " 1x"):
        w, s = Worker(), SMTP()
        rc, log = go([], w, s, "2026-10-02 09:00", {"SEND": "1", "RAIN_MONTHLY_LIVE": v})
        ck("gate: SEND=1 with RAIN_MONTHLY_LIVE=%r sends nothing" % v, rc == 1 and not s.sent and not w.marks, log)
    w, s = Worker(), SMTP()
    rc, log = go([], w, s, "2026-10-02 09:00", {"RAIN_MONTHLY_LIVE": "1"})
    ck("gate: the variable alone is not a send (dry by default)", rc == 0 and not s.sent and not w.marks and "dry run" in log, log)
    rc, log = go(["--send", "--dry-run"], w, s, "2026-10-02 09:00", {"RAIN_MONTHLY_LIVE": "1"})
    ck("--dry-run wins over --send", rc == 0 and not s.sent and not w.marks)
    w, s = Worker(), SMTP()
    rc, log = go(["--send", "--month", "2026-08"], w, s, "2026-10-02 09:00", {"RAIN_MONTHLY_LIVE": "1"})
    ck("a send is only for the month just ended", rc == 1 and not s.sent and not w.log, log)
    ck("dry run: counts, a sample with a made-up address, no address of the list", "list: 6 monthly rain sign-up(s)" in go([], Worker(), SMTP(), "2026-10-02 09:00")[1]
       and "k=" + email_links.SAMPLE_LID in go([], Worker(), SMTP(), "2026-10-02 09:00")[1])

    # live: the list
    w, s = Worker(), SMTP()
    rc, log = go(["--send"], w, s, "2026-10-02 09:00", {"RAIN_MONTHLY_LIVE": "1"})
    ck("live: each county's readers once; marked one already mailed, no page and no link id skipped",
       rc == 0 and sorted(s.sent) == ["ia@example.com", "one@example.com", "two@example.com"], (rc, s.sent, log))
    ck("each reader gets their own county", all(("Story County" in x["Subject"]) == (x["To"] == "ia@example.com") for x in s.msgs))
    ck("each email carries its own link id and its county's stop link",
       all("k=00000000000000" in x.get_body(("plain",)).get_content() and "topic=" + urllib.parse.quote(addrs[x["To"]]) in x.get_body(("plain",)).get_content() for x in s.msgs))
    ck("marked after the send, with the month", sorted(w.marks) == [("ia@example.com", "rain-month:19169", "2026-09"), ("one@example.com", "rain-month:55005", "2026-09"),
                                                                     ("two@example.com", "rain-month:55005", "2026-09")], w.marks)
    ck("one station record read per station", sorted(set(calls)) == ["USC00130203", "USC00471923"] and "2 station record(s) read" in log, (calls, log))
    ck("no address in the log", not any(e in log for e in addrs), log)
    s2 = SMTP()
    rc, log = go(["--send"], w, s2, "2026-10-03 09:00", {"RAIN_MONTHLY_LIVE": "1"})
    ck("a second run that month mails nobody", rc == 0 and not s2.sent, s2.sent)
    w, s = Worker(), SMTP(refuse={"one@example.com"})
    rc, log = go(["--send"], w, s, "2026-10-02 09:00", {"RAIN_MONTHLY_LIVE": "1"})
    ck("a refused address stays unmarked and the others go", rc == 0 and ("one@example.com", "rain-month:55005", "2026-09") not in w.marks and len(w.marks) == 2, w.marks)
    w, s = Worker(), SMTP(refuse=set(addrs))
    rc, log = go(["--send"], w, s, "2026-10-02 09:00", {"RAIN_MONTHLY_LIVE": "1"})
    ck("all refused: exit 1, nothing marked", rc == 1 and not w.marks, log)
    w, s = Worker(), SMTP()
    rc, log = go(["--send", "--max", "1"], w, s, "2026-10-02 09:00", {"RAIN_MONTHLY_LIVE": "1"})
    ck("--max caps a run", rc == 0 and len(s.sent) == 1 and "2 left for the next run" in log, log)

    # preview: Sig's test inbox only
    w, s = Worker(), SMTP()
    rc, log = go([], w, s, "2026-10-02 09:00", {"PREVIEW": "1", "SIG_TO": "sig@example.org"})
    ck("preview: Sig only, both sample counties, [Preview] subject, list untouched", rc == 0 and s.sent == ["sig@example.org", "sig@example.org"]
       and all(x["Subject"].startswith("[Preview] ") for x in s.msgs) and not w.log and not w.marks and "sig@example.org" not in log, (rc, s.sent, w.log, log))
    w, s = Worker(), SMTP()
    rc, log = go([], w, s, "2026-10-02 09:00", {"PREVIEW": "1", "SIG_TEST_EMAILS": "a@example.org, b@example.org", "SIG_TO": "sig@example.org"})
    ck("preview: SIG_TEST_EMAILS before SIG_TO", sorted(set(s.sent)) == ["a@example.org", "b@example.org"])
    w, s = Worker(), SMTP()
    rc, log = go([], w, s, "2026-10-02 09:00", {"PREVIEW": "1"})
    ck("preview with nobody to send to: refused, the list never stands in", rc == 1 and not s.sent and not w.log, log)
    w, s = Worker(), SMTP()
    rc, log = go(["--fips", "55005", "--month", "2026-08"], w, s, "2026-10-23 09:00", {"PREVIEW": "1", "SIG_TO": "sig@example.org"})
    ck("preview takes any month and county", rc == 0 and len(s.sent) == 1 and "August" in s.msgs[0]["Subject"], log)
    outd = os.path.join(tmp, "out")
    rc, log = go(["--out", outd, "--month", "2026-09"], Worker(), SMTP(), "2026-10-23 09:00", {"SEND": "1", "RAIN_MONTHLY_LIVE": "1"})
    ck("--out writes the samples and never sends", rc == 0 and os.path.isfile(os.path.join(outd, "rain-month-55005-2026-09.html")), log)

    print("\n%s: %d failure(s)" % ("FAIL" if fails else "OK", len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv[1:]:
        sys.exit(selftest())
    sys.exit(run(sys.argv[1:]))
