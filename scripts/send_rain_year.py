#!/usr/bin/env python3
"""
send_rain_year.py: the January full-year rain email (subs worker v5.28).

A reader on a county rain page (/rain/iowa/story-county) asks "Email me Story
County's full 2026 rain total in January." The worker stores topic
rainyear:2026:19169 under note:<email>. This script is the other half: in
January it reads the unsent rainyear:<last year>: sign-ups from GET
/notice-list, mails each address once with that county's total for the whole
year, and marks it with POST /notice-mark only after the send went through.
A marked address is never mailed again, so any number of runs is safe.

WHEN IT SENDS. Only in January (America/Chicago), for last year. It runs as a
step of county-rain.yml (Jan 2 and every Monday), right after that run fetched
and committed the finished year into data/rain/<st>.json, so the email and the
county page carry the same numbers. A county is due when its state's file is
the finished year (fetched through Dec 31, build_county_rain.done_year) AND
its station reported through Dec 31. A station that is still late waits;
from Jan 20 on it is mailed anyway, saying the last day the station reported.
A county with no page this year (no station reported enough days) gets one
plain email from Jan 20 saying so, with the state page, so nobody who asked is
left waiting for an email that cannot come. February and later: nothing.

The numbers are build_county_rain.py's own sentences (answer(), compare()),
so the email never says anything the page does not.

Rain Print asks too (2026-10-19): after a print of the year still going is
drawn, /rain-print offers the same topic with source page:rain-print. That
email carries one more line, that the full-year print can be made now, and
links the county's own rain page; a county page sign-up's email is unchanged.

    python3 scripts/send_rain_year.py                 # dry run: counts and a preview, sends nothing
    python3 scripts/send_rain_year.py --send          # the real thing (county-rain.yml passes this)
    python3 scripts/send_rain_year.py --year 2026 --any-day   # that year outside January (still needs the finished data)
    python3 scripts/send_rain_year.py --selftest      # fake HTTP and fake SMTP; no network

Env: the same as send_notice.py (LIST_URL, LIST_TOKEN, UNSUB_SECRET, SMTP_*,
FROM_ADDR, REPLY_TO, MAX_PER_RUN default 300).

The log carries counts only. No address is ever printed, including in error
lines. The unsubscribe link stops this one notice (send_notice.unsub_link).
"""
import argparse
import glob
import html as H
import json
import os
import re
import smtplib
import sys
import time
from datetime import date, datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(HERE))
import send_notice as SN          # noqa: E402  transport, render, unsubscribe link, mark
import build_county_rain as BCR   # noqa: E402  done_year, answer, the page's own sentences
import county_rain as R           # noqa: E402  state names, county slugs

SITE = SN.SITE
UTM = "utm_source=rain_year&utm_medium=email"
LATE_DAY = 20          # from Jan 20, a late station is mailed with its last day; a county with no page gets a plain note
TOPIC_RE = re.compile(r"rainyear:(\d{4}):(\d{5})")
SRC_RE = re.compile(r"page:(rain/[a-z0-9-]+/[a-z0-9-]+)")
RP_SRC = "page:rain-print"   # the ask under Pay on /rain-print (2026-10-19): one more line, the print can be made now


# ---------------------------------------------------------------- data
def load(rain_dir):
    """fips -> (st, state file, county record) for every county in data/rain/<st>.json."""
    out = {}
    for p in sorted(glob.glob(os.path.join(rain_dir, "*.json"))):
        if not re.fullmatch(r"[a-z]{2}\.json", os.path.basename(p)):
            continue
        try:
            d = json.load(open(p, encoding="utf-8"))
        except ValueError:
            continue
        st = str(d.get("state") or "").upper()
        for fips, c in (d.get("counties") or {}).items():
            out[fips] = (st, d, c)
    return out


def finished(d, year):
    return d.get("year") == year and BCR.done_year(d)


def plain(s):
    return H.unescape(re.sub(r"<[^>]+>", "", str(s))).replace("’", "'")


def page_url(src, st, repo):
    """The county page the ask was on, when it is a real page in this checkout, else the state page."""
    m = SRC_RE.fullmatch(str(src or ""))
    if m and (Path(repo) / (m.group(1) + ".html")).is_file():
        return "%s/%s?%s" % (SITE, m.group(1), UTM)
    if st in R.STATES:
        return "%s/rain/%s?%s" % (SITE, R.slug(R.STATES[st]), UTM)
    return "%s/rain?%s" % (SITE, UTM)


def rp_county_src(fips, st, cmap):
    """A Rain Print ask names no page: its county's rain page, as a county page ask would."""
    info = (cmap() or {}).get(fips) if cmap else None
    if info and info.get("slug") and st in R.STATES:
        return "page:rain/%s/%s" % (R.slug(R.STATES[st]), info["slug"])
    return ""


def state_of(fips, data, cmap):
    if fips in data:
        return data[fips][0]
    c = cmap().get(fips) if cmap else None
    return c["st"] if c else ""


def status(fips, year, today, data, st=""):
    """'send', 'late' (send, the station stopped before Dec 31), 'none' (send the no-total note),
    or why it waits: 'wait-data', 'wait-station'."""
    late_ok = today.month == 1 and today.day >= LATE_DAY or today > date(year + 1, 1, 31)
    if fips not in data:
        # no county record: say so only once its state's finished year is in, and from Jan 20
        return "none" if late_ok and any(s0 == st and finished(d, year) for s0, d, _ in data.values()) else "wait-data"
    st, d, c = data[fips]
    if not finished(d, year):
        return "wait-data"
    if str(c.get("as_of", "")).endswith("-12-31"):
        return "send"
    return "late" if late_ok else "wait-station"


# ---------------------------------------------------------------- the email
def make_parts(data, cmap, repo):
    def parts(topic, src, today, _repo=None):
        m = TOPIC_RE.fullmatch(topic)
        year, fips = int(m.group(1)), m.group(2)
        if fips in data:
            st, d, c = data[fips]
            stn = R.STATES.get(st, st)
            full = "%s, %s" % (c["name"], stn)
            ans = plain(BCR.answer(c, full, year, True))
            subject = "%s: %s inches of rain in %d" % (full, BCR.inch(c["total"]), year)
            paras = [[(ans, None)]]
            if src == RP_SRC:
                rp0 = "%s/rain-print?%s" % (SITE, UTM)
                paras.append([("You asked on Rain Print. All of %d is in now, so the full-year print can be made: "
                               "type your town, pick %d and order it here: " % (year, year), None), (rp0, rp0)])
            page = page_url(src if src != RP_SRC else rp_county_src(fips, st, cmap), st, repo)
            paras.append([("Month by month, the biggest rain and how the station was picked: ", None), (page, page)])
            rp = SITE + BCR.rain_print_href(c, st, year)
            rp += ("&" if "?" in rp else "?") + UTM      # tagged like every other link here (2026-10-19)
            paras.append([("The same year drawn as a Rain Print: ", None), (rp, rp)])
            paras.append([("NOAA daily records through RCC-ACIS. Daily numbers are sometimes corrected after the fact, "
                           "so the page can move by a few hundredths.", None)])
        else:
            st = state_of(fips, data, cmap)
            stn = R.STATES.get(st, "")
            info = (cmap() or {}).get(fips) if cmap else None
            name = (info or {}).get("name") or "your county"
            full = "%s, %s" % (name, stn) if stn else name
            subject = "%s: no full-year rain total for %d" % (full, year)
            page = page_url("", st, repo)
            paras = [[("No weather station in %s reported enough days in %d for a total we can stand behind, "
                       "so there is no full-year number for it this time." % (full, year), None)],
                     [("The counties around it that do have one: ", None), (page, page)]]
        paras.append([("You asked for this one email on agsist.com. There won't be another for this county and year.", None)])
        return subject, paras
    return parts


# ---------------------------------------------------------------- the run
def run(argv, http=SN.http_json, connect=SN.smtp_connect, now=None, sleep=time.sleep, out=print,
        repo=REPO, cmap=None):
    p = argparse.ArgumentParser(add_help=False)
    p.add_argument("--year", type=int, default=0)
    p.add_argument("--send", action="store_true")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--any-day", action="store_true")
    p.add_argument("--max", type=int, default=int(SN.env("MAX_PER_RUN", "300")))
    a = p.parse_args(argv)
    send = a.send and not a.dry_run
    today = (now or datetime.now(SN.TZ)).astimezone(SN.TZ).date()
    year = a.year or today.year - 1
    if not (a.any_day and a.year) and not (today.month == 1 and year == today.year - 1):
        out("rainyear: not January (%s, America/Chicago). Nothing to do." % today.isoformat())
        return 0
    if cmap is None:
        _c = {}

        def cmap():
            if not _c:
                _c.update(R.counties())
            return _c
    data = load(os.path.join(repo, "data", "rain"))
    n_done = sum(1 for d in {id(d): d for _, d, _ in data.values()}.values() if finished(d, year))
    if not n_done:
        out("rainyear:%d: no state file holds the finished year yet. Nothing sent." % year)
        return 0

    base, tok, secret = SN.env("LIST_URL"), SN.env("LIST_TOKEN"), SN.env("UNSUB_SECRET")
    if not (base and tok and secret):
        out("LIST_URL, LIST_TOKEN and UNSUB_SECRET are required")
        return 1
    base = base.rstrip("/")
    from_addr = SN.env("FROM_ADDR") or SN.env("SMTP_USER") or "news@agsist.com"
    reply_to = SN.env("REPLY_TO")
    SN.TEMPLATES["rainyear"] = make_parts(data, cmap, repo)
    out("date %s (America/Chicago), year %d, %d state files finished, mode %s" % (
        today.isoformat(), year, n_done, "SEND" if send else "dry run"))

    pre = "rainyear:%d:" % year
    try:
        rows = http("GET", "%s/notice-list?token=%s&topic=%s&unsent=1" % (
            base, SN.urllib.parse.quote(tok), SN.urllib.parse.quote(pre)))
    except Exception as ex:
        out("rainyear: could not read the list (%s)" % type(ex).__name__)
        return 1
    if not isinstance(rows, list):
        out("rainyear: the list did not come back as a list")
        return 1
    todo, seen, skipped, wait = [], set(), 0, {}
    for r in rows:
        r = r or {}
        e = str(r.get("email") or "").strip().lower()
        t = str(r.get("topic") or "")
        m = TOPIC_RE.fullmatch(t)
        if not m or int(m.group(1)) != year or r.get("sent") or not SN.EMAIL_RE.match(e) or (e, t) in seen:
            skipped += 1
            continue
        seen.add((e, t))
        s = status(m.group(2), year, today, data, state_of(m.group(2), data, cmap))
        if s.startswith("wait"):
            wait[s] = wait.get(s, 0) + 1
            continue
        todo.append((e, t, str(r.get("src") or ""), s))
    later = max(0, len(todo) - a.max)
    todo = todo[:a.max]
    kinds = {}
    for *_, s in todo:
        kinds[s] = kinds.get(s, 0) + 1
    out("%s: %d to mail (%d full year, %d late station, %d no total), %d waiting (%s), %d skipped, %d left for the next run"
        % (pre, len(todo), kinds.get("send", 0), kinds.get("late", 0), kinds.get("none", 0), sum(wait.values()),
           ", ".join("%s %d" % kv for kv in sorted(wait.items())) or "none", skipped, later))

    if not send:
        ex = next((f for f in ("19169",) if f in data), next(iter(data), None))
        if ex:
            m = SN.render(pre + ex, "", "reader@example.com", base, "preview", today, from_addr, reply_to, repo)
            out("preview (a made-up address and unsubscribe token):")
            out("Subject: " + str(m["Subject"]))
            out(m.get_body(("plain",)).get_content().rstrip())
        out("dry run: nothing sent, nothing marked. Pass --send to mail.")
        return 0
    if not todo:
        return 0

    conn, sent, failed, broken, reconnects = None, 0, 0, False, 0
    try:
        conn = connect()
        for i, (e, t, src, _) in enumerate(todo):
            try:
                conn.send_message(SN.render(t, src, e, base, secret, today, from_addr, reply_to, repo))
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
            if not SN.mark(http, base, tok, e, t, sleep):
                out("::error::%s: a sent email could not be marked; stopping so nobody gets two" % pre)
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
    out("%s: sent %d, failed %d" % (pre, sent, failed))
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
    os.makedirs(os.path.join(tmp, "data", "rain"))
    os.makedirs(os.path.join(tmp, "rain", "iowa"))
    open(os.path.join(tmp, "rain", "iowa", "story-county.html"), "w").write("x")
    stn = {"ll": [-93.62, 42.04], "mi": 8, "name": "Ames", "net": "noaa", "raw": "AMES 8 WSW", "sid": "130203 2"}
    story = {"name": "Story County", "as_of": "2026-12-31", "total": 38.4, "usual": 36.12, "pct": 106, "days": 365,
             "missing": 0, "station": stn}
    boone = dict(story, name="Boone County", as_of="2026-12-20", total=30.0, usual=35.0, pct=86)
    ia = {"state": "IA", "year": 2026, "edate": "2026-12-31", "counties": {"19169": story, "19015": boone}}
    wi = {"state": "WI", "year": 2026, "edate": "2026-12-27", "counties": {"55005": dict(story, name="Barron County")}}
    for st, d in (("ia", ia), ("wi", wi)):
        json.dump(d, open(os.path.join(tmp, "data", "rain", st + ".json"), "w"))
    cm = {"19169": {"st": "IA", "name": "Story County"}, "19079": {"st": "IA", "name": "Hamilton County"},
          "55005": {"st": "WI", "name": "Barron County"}}
    data = load(os.path.join(tmp, "data", "rain"))

    # when
    ck("full year, station through Dec 31: send", status("19169", 2026, date(2027, 1, 4), data) == "send")
    ck("station stopped Dec 20: waits before Jan 20", status("19015", 2026, date(2027, 1, 11), data) == "wait-station")
    ck("station stopped Dec 20: mailed from Jan 20", status("19015", 2026, date(2027, 1, 20), data) == "late")
    ck("state not fetched through Dec 31: waits", status("55005", 2026, date(2027, 1, 25), data) == "wait-data")
    ck("no county record: waits before Jan 20", status("19079", 2026, date(2027, 1, 11), data, "IA") == "wait-data")
    ck("no county record: the plain note from Jan 20", status("19079", 2026, date(2027, 1, 20), data, "IA") == "none")
    ck("no county record in a state not yet finished: waits", status("55099", 2026, date(2027, 1, 20), data, "WI") == "wait-data")

    # the email
    os.environ.update({"LIST_URL": "https://w.dev", "LIST_TOKEN": "tok", "UNSUB_SECRET": "sec",
                       "SMTP_USER": "news@agsist.com", "MAX_PER_RUN": "300"})
    SN.TEMPLATES["rainyear"] = make_parts(data, lambda: cm, tmp)
    T = "rainyear:2026:19169"
    m = SN.render(T, "page:rain/iowa/story-county", "a@example.com", "https://w.dev", "sec", date(2027, 1, 4),
                  "news@agsist.com", None, tmp)
    txt = m.get_body(("plain",)).get_content()
    htm = m.get_body(("html",)).get_content()
    ck("subject names the county, the total and the year", m["Subject"] == "Story County, Iowa: 38.40 inches of rain in 2026", m["Subject"])
    ck("the page's own answer sentence", "38.40 inches of rain fell in 2026 at the weather station 8 miles west-southwest of Ames, Story County, Iowa." in txt
       and "2.28 inches more than a usual year (106% of usual)." in txt, txt[:400])
    ck("links the county page it was asked on", SITE + "/rain/iowa/story-county?" + UTM in txt)
    ck("links the Rain Print for that place and year", SITE + "/rain-print?place=Ames%2C+IA&year=2026" in txt)
    ck("every agsist.com link in the email is tagged rain_year (2026-10-19)",
       all(UTM in u for u in re.findall(r'https://agsist\.com/[^\s"<>]*', txt + htm.replace("&amp;", "&"))),
       [u for u in re.findall(r'https://agsist\.com/[^\s"<>]*', txt) if UTM not in u])
    ck("one email, said so", "There won't be another for this county and year." in txt)
    ck("a county page ask gets no Rain Print ask line", "You asked on Rain Print" not in txt)
    mr = SN.render(T, RP_SRC, "a@example.com", "https://w.dev", "sec", date(2027, 1, 4), "news@agsist.com", None, tmp)
    tr = mr.get_body(("plain",)).get_content()
    ck("a Rain Print ask: one more line, the full-year print can be made now",
       "You asked on Rain Print. All of 2026 is in now, so the full-year print can be made: type your town, pick 2026 and order it here: "
       + SITE + "/rain-print?" + UTM in tr and tr.count("You asked on Rain Print") == 1 and mr["Subject"] == m["Subject"], tr[:600])
    cm["19169"]["slug"] = "story-county"
    tr2 = SN.render(T, RP_SRC, "a@example.com", "https://w.dev", "sec", date(2027, 1, 4), "news@agsist.com", None, tmp).get_body(("plain",)).get_content()
    ck("a Rain Print ask links its county's rain page", SITE + "/rain/iowa/story-county?" + UTM in tr2, tr2[:600])
    del cm["19169"]["slug"]
    ck("a Rain Print ask, county slug unknown: the state page", SITE + "/rain/iowa?" + UTM in tr)
    ck("unsubscribe stops this topic", "topic=rainyear%3A2026%3A19169" in txt and m["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click")
    low = (txt + htm).lower()
    ck("no em or en dash, no hype", not any(x in txt + htm for x in ("—", "–", "&mdash;", "&ndash;"))
       and "!" not in txt and not any(x in low for x in ("don't miss", "act now", "hurry", "insurance")))
    m2 = SN.render("rainyear:2026:19015", "page:rain/../../etc", "a@example.com", "https://w.dev", "sec", date(2027, 1, 20),
                   "news@agsist.com", None, tmp)
    t2 = m2.get_body(("plain",)).get_content()
    ck("late station: says the last day reported", "through Dec 20, the last day reported" in t2, t2[:300])
    ck("a source that is not a real page falls back to the state page", SITE + "/rain/iowa?" + UTM in t2)
    m3 = SN.render("rainyear:2026:19079", "", "a@example.com", "https://w.dev", "sec", date(2027, 1, 20), "news@agsist.com", None, tmp)
    t3 = m3.get_body(("plain",)).get_content()
    ck("no total: says so plainly, no number", m3["Subject"] == "Hamilton County, Iowa: no full-year rain total for 2026"
       and "no full-year number" in t3 and not re.search(r"\d+\.\d\d inches", t3), t3[:300])

    # the run, against a fake worker and a fake SMTP
    addrs = {"one@example.com": T, "two@example.com": T, "late@example.com": "rainyear:2026:19015",
             "wi@example.com": "rainyear:2026:55005", "done@example.com": T, "old@example.com": "rainyear:2025:19169"}

    class Worker:
        def __init__(self):
            self.t = {e: {"topic": tp, "sent": 1 if e == "done@example.com" else None} for e, tp in addrs.items()}
            self.log, self.marks = [], []

        def __call__(self, method, url, body=None):
            u = SN.urllib.parse.urlsplit(url)
            qs = SN.urllib.parse.parse_qs(u.query)
            assert qs.get("token") == ["tok"]
            if method == "GET" and u.path == "/notice-list":
                self.log.append(("list", qs.get("topic", [""])[0]))
                return [{"email": e, "topic": v["topic"], "ts": 1, "src": "page:rain/iowa/story-county", "sent": v["sent"]}
                        for e, v in self.t.items() if not (qs.get("unsent") == ["1"] and v["sent"])]
            if method == "POST" and u.path == "/notice-mark":
                self.marks.append(body["email"])
                self.t[body["email"]]["sent"] = 2
                return {"ok": True}
            raise AssertionError(method + " " + u.path)

    class SMTP:
        def __init__(self, refuse=()):
            self.sent, self.refuse = [], set(refuse)

        def __call__(self):
            return self

        def send_message(self, msg):
            if msg["To"] in self.refuse:
                raise smtplib.SMTPRecipientsRefused({msg["To"]: (550, b"no")})
            self.sent.append(msg["To"])

        def quit(self):
            pass

    def go(argv, w, s, when):
        lines = []
        rc = run(argv, http=w, connect=s, now=C(when), sleep=lambda x: None, out=lines.append, repo=tmp, cmap=lambda: cm)
        return rc, "\n".join(lines)

    w, s = Worker(), SMTP()
    rc, log = go(["--send"], w, s, "2026-12-28 09:00")
    ck("December: nothing read, nothing sent", rc == 0 and not w.log and not s.sent, log)
    rc, log = go(["--send"], w, s, "2027-02-01 09:00")
    ck("February: nothing read, nothing sent", rc == 0 and not w.log and not s.sent, log)
    rc, log = go([], w, s, "2027-01-04 09:00")
    ck("dry run: reads the list, sends nothing, previews a made-up address", rc == 0 and not s.sent and not w.marks
       and "reader%40example.com" in log and not any(e in log for e in addrs), log)
    rc, log = go(["--send"], w, s, "2027-01-04 09:00")
    ck("Jan 4: the two full-year sign-ups go, the late one and the unfinished state wait",
       sorted(s.sent) == ["one@example.com", "two@example.com"] and w.log[-1] == ("list", "rainyear:2026:"), (s.sent, log))
    ck("marked only after the send", sorted(w.marks) == ["one@example.com", "two@example.com"])
    ck("an older year's sign-up is never mailed", "old@example.com" not in s.sent)
    ck("no address in the log", not any(e in log for e in addrs), log)
    s2 = SMTP()
    rc, log = go(["--send"], w, s2, "2027-01-11 09:00")
    ck("Jan 11: nobody new", rc == 0 and not s2.sent, s2.sent)
    s3 = SMTP()
    rc, log = go(["--send"], w, s3, "2027-01-25 09:00")
    ck("Jan 25: the late station goes; the unfinished state still waits", s3.sent == ["late@example.com"], s3.sent)
    w, s = Worker(), SMTP(refuse={"one@example.com", "two@example.com"})
    rc, log = go(["--send"], w, s, "2027-01-04 09:00")
    ck("all refused: exit 1, nothing marked", rc == 1 and not w.marks, log)
    for f in os.listdir(os.path.join(tmp, "data", "rain")):
        os.remove(os.path.join(tmp, "data", "rain", f))
    json.dump(dict(ia, year=2027, edate="2027-01-01"), open(os.path.join(tmp, "data", "rain", "ia.json"), "w"))
    w, s = Worker(), SMTP()
    rc, log = go(["--send"], w, s, "2027-01-04 09:00")
    ck("no finished year on file: nothing read, nothing sent", rc == 0 and not w.log and not s.sent, log)

    print("\n%s: %d failure(s)" % ("FAIL" if fails else "OK", len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv[1:]:
        sys.exit(selftest())
    sys.exit(run(sys.argv[1:]))
