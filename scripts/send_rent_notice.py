#!/usr/bin/env python3
"""
send_rent_notice.py: the county cash rent release email (subs worker v5.11,
topic rent:<st>).

A reader on /rent/iowa asks "Email me when the 2027 county rents for Iowa come
out." The worker stores topic rent:ia under note:<email> with the time they
asked (ts). This script is the other half.

THE RULE. A rent:<st> notice waits for the first NASS county cash rent release
for that state published AFTER the notice's ts. The committed data
(data/cash-rent/<ST>.json) says the state's newest survey year Y. Y counts as
published at:
  1. build_state_rent_pages.COUNTY_RENT_RELEASED[Y] (the release date the page
     prints), taken as noon Eastern, when NASS puts county rents out; else
  2. the time of the first commit whose data/cash-rent/<ST>.json held Y
     (git history; the workflow deepens its shallow clone back to July first).
If neither is known, nothing is sent for that state and the log says so.
A notice is mailed once when it is unsent and its ts is before that time, then
marked with POST /notice-mark. A notice made after the release waits for next
year's. While the data is not there nothing is marked.

It runs as a step of cash-rent.yml (Wednesdays in August and September, and on
dispatch), right after that run committed the new rents. The headline numbers
are build_state_rent_pages.state_stats(), the same ones the state page prints.

    python3 scripts/send_rent_notice.py              # dry run: counts and a preview, sends nothing
    python3 scripts/send_rent_notice.py --send       # the real thing (cash-rent.yml passes this)
    python3 scripts/send_rent_notice.py --selftest   # fake HTTP and fake SMTP; no network

Env: the same as send_notice.py. The log carries counts only, never an address.
"""
import argparse
import glob
import json
import os
import re
import smtplib
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(HERE))
import send_notice as SN               # noqa: E402  transport, render, unsubscribe link, mark
import build_state_rent_pages as BR    # noqa: E402  state_stats, money, names, release dates

SITE = SN.SITE
UTM = "utm_source=rent_release&utm_medium=email"
ET = ZoneInfo("America/New_York")
TOPIC_RE = re.compile(r"rent:([a-z]{2})")
MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


# ---------------------------------------------------------------- data
def load(repo):
    """ST -> state file, for every data/cash-rent/<ST>.json with a known state."""
    out = {}
    for p in sorted(glob.glob(os.path.join(repo, "data", "cash-rent", "[A-Z][A-Z].json"))):
        try:
            d = json.load(open(p, encoding="utf-8"))
        except ValueError:
            continue
        if d.get("state") in BR.STATE_NAMES and d.get("years"):
            out[d["state"]] = d
    return out


def newest(d):
    return max(int(y) for y in d["years"])


def released_ms(year, released=None):
    """Noon Eastern on the release date the page prints, in ms, or None."""
    s = (BR.COUNTY_RENT_RELEASED if released is None else released).get(year)
    if not s:
        return None
    try:
        day = datetime.strptime(s, "%b %d, %Y")
    except ValueError:
        return None
    return int(day.replace(hour=12, tzinfo=ET).timestamp() * 1000)


def git_first_ms(repo, st, year):
    """ms of the first commit whose data/cash-rent/<ST>.json held `year` as its
    newest year, or None when history does not reach back before it."""
    rel = "data/cash-rent/%s.json" % st
    try:
        log = subprocess.run(["git", "-C", str(repo), "log", "--reverse", "--format=%H %ct", "--", rel],
                             capture_output=True, text=True, timeout=120).stdout.split("\n")
    except Exception:
        return None
    commits = [l.split() for l in log if l.strip()]
    seen_older = False
    for h, ct in commits:
        try:
            d = json.loads(subprocess.run(["git", "-C", str(repo), "show", "%s:%s" % (h, rel)],
                                          capture_output=True, text=True, timeout=60).stdout)
            y = newest(d)
        except Exception:
            continue
        if y >= year:
            # the first commit in reach already has it: only trust it when an
            # older commit without it was seen (else history is cut short)
            return int(ct) * 1000 if seen_older else None
        seen_older = True
    return None


def published_ms(repo, st, year, released=None, git=git_first_ms):
    """(ms, how) or (None, why)."""
    ms = released_ms(year, released)
    if ms:
        return ms, "release date"
    ms = git(repo, st, year)
    if ms:
        return ms, "first commit"
    return None, "no release date for %d and git history does not reach its first commit" % year


# ---------------------------------------------------------------- the email
def long_day(ms):
    d = datetime.fromtimestamp(ms / 1000, ET)
    return "%s %d, %d" % (MON3[d.month - 1], d.day, d.year)


def make_parts(data, pub):
    def parts(topic, src, today, _repo=None):
        st = TOPIC_RE.fullmatch(topic).group(1).upper()
        d = data[st]
        s = BR.state_stats(d)
        name, yr = BR.STATE_NAMES[st], s["yr"]
        ms, how = pub[st]
        when = (" on %s" % long_day(ms)) if how == "release date" else ""
        first = "USDA NASS put out the %d county cash rents for %s%s. " % (yr, name, when)
        first += "The middle %s county paid %s an acre for %s, across %d counties with a published rent" % (
            name, BR.money(s["median"]), BR.TYPE_LABEL[s["primary"]], s["n"])
        if s["yoy"] is not None:
            first += ", %s%s%% from %d in the same %d counties" % ("up " if s["yoy"] > 0 else "down " if s["yoy"] < 0 else "",
                                                                abs(s["yoy"]) if s["yoy"] else "no change, 0", yr - 1, s["yoy_n"])
        first += "."
        hi = s["hi"][0] if s["hi"] else None
        paras = [[(first, None)]]
        if hi:
            paras.append([("Highest county: %s at %s." % (hi[0], BR.money(hi[1])), None)])
        page = "%s/rent/%s/?%s" % (SITE, BR.slug(name), UTM)
        paras.append([("Every county, with rent against trend yield: ", None), (page, page)])
        paras.append([("These are medians of the counties NASS published. Counties with too few leases in the survey "
                       "are left out by NASS, never filled in.", None)])
        paras.append([("You asked for this one email on agsist.com. There won't be another for this release.", None)])
        return "%s county cash rents for %d are out" % (name, yr), paras
    return parts


# ---------------------------------------------------------------- the run
def run(argv, http=SN.http_json, connect=SN.smtp_connect, now=None, sleep=time.sleep, out=print,
        repo=REPO, released=None, git=git_first_ms):
    p = argparse.ArgumentParser(add_help=False)
    p.add_argument("--topic", default="")
    p.add_argument("--send", action="store_true")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--any-day", action="store_true")   # accepted for send_notice.py's --topic form; the rule has no day
    p.add_argument("--max", type=int, default=int(SN.env("MAX_PER_RUN", "200")))
    a = p.parse_args(argv)
    send = a.send and not a.dry_run
    today = (now or datetime.now(SN.TZ)).astimezone(SN.TZ).date()
    want = a.topic.strip().lower()
    if want and not TOPIC_RE.fullmatch(want):
        out("refused %s: not a rent:<st> topic" % want)
        return 1

    base, tok, secret = SN.env("LIST_URL"), SN.env("LIST_TOKEN"), SN.env("UNSUB_SECRET")
    if not (base and tok and secret):
        out("LIST_URL, LIST_TOKEN and UNSUB_SECRET are required")
        return 1
    base = base.rstrip("/")
    from_addr = SN.env("FROM_ADDR") or SN.env("SMTP_USER") or "news@agsist.com"
    reply_to = SN.env("REPLY_TO")
    data = load(repo)
    out("date %s (America/Chicago), %d state rent files, mode %s" % (today.isoformat(), len(data), "SEND" if send else "dry run"))

    try:
        rows = http("GET", "%s/notice-list?token=%s&topic=%s&unsent=1" % (
            base, SN.urllib.parse.quote(tok), SN.urllib.parse.quote(want or "rent:")))
    except Exception as ex:
        out("rent: could not read the list (%s)" % type(ex).__name__)
        return 1
    if not isinstance(rows, list):
        out("rent: the list did not come back as a list")
        return 1

    pub, todo, seen, skipped, waiting, unknown = {}, [], set(), 0, 0, {}
    for r in rows:
        r = r or {}
        e = str(r.get("email") or "").strip().lower()
        t = str(r.get("topic") or "")
        m = TOPIC_RE.fullmatch(t)
        ts = r.get("ts")
        if not m or (want and t != want) or r.get("sent") or not SN.EMAIL_RE.match(e) or (e, t) in seen \
                or not isinstance(ts, (int, float)) or isinstance(ts, bool) or not SN.email_links.lid_of(r):
            skipped += 1   # v5.46: a row with no link id waits for the next run
            continue
        seen.add((e, t))
        SN.LINK_IDS[e] = SN.email_links.lid_of(r)
        st = m.group(1).upper()
        if st not in data:
            unknown[st] = unknown.get(st, 0) + 1
            continue
        if st not in pub:
            pub[st] = published_ms(repo, st, newest(data[st]), released, git)
        ms, how = pub[st]
        if ms is None:
            unknown[st] = unknown.get(st, 0) + 1
            continue
        if ts < ms:
            todo.append((e, t, str(r.get("src") or "")))
        else:
            waiting += 1
    for st, n in sorted(unknown.items()):
        why = pub.get(st, (None, "no rent file for this state"))[1]
        out("::warning::rent:%s: %d waiting, release time unknown (%s)" % (st.lower(), n, why))
    later = max(0, len(todo) - a.max)
    todo = todo[:a.max]
    out("rent: %d to mail, %d waiting for a release after they asked, %d release unknown, %d skipped, %d left for the next run"
        % (len(todo), waiting, sum(unknown.values()), skipped, later))

    SN.TEMPLATES["rent"] = make_parts(data, pub)
    if not send:
        ex = next((st for st in ("IA",) + tuple(sorted(pub)) if st in data and pub.get(st, (None,))[0]), None)
        if ex:
            m = SN.render("rent:" + ex.lower(), "", "reader@example.com", base, "preview", today, from_addr, reply_to, repo,
                          lid=SN.email_links.SAMPLE_LID)
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
        for i, (e, t, src) in enumerate(todo):
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
                out("::error::rent: a sent notice could not be marked; stopping so nobody gets two")
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
    out("rent: sent %d, failed %d" % (sent, failed))
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
    fails = []

    def ck(name, cond, detail=""):
        print(("ok   " if cond else "FAIL ") + name + (("  " + str(detail)) if detail and not cond else ""))
        if not cond:
            fails.append(name)

    CT = ZoneInfo("America/Chicago")
    ms = lambda s: int(datetime.fromisoformat(s).replace(tzinfo=CT).timestamp() * 1000)
    tmp = tempfile.mkdtemp()
    os.makedirs(os.path.join(tmp, "data", "cash-rent"))
    os.makedirs(os.path.join(tmp, "rent"))

    def county(name, a, b, y=2027):
        return {"fips": "19000", "name": name, "rent": {"nonirr": {str(y): a, str(y - 1): b}}, "yield": {}}
    ia = {"state": "IA", "years": [2025, 2026, 2027], "generated": "2027-08-25",
          "counties": [county("Adair", 240.0, 230.0), county("Boone", 300.0, 290.0), county("Story", 280.0, 270.0),
                       county("Polk", 260.0, 250.0), county("Linn", 250.0, 240.0)]}
    # Wisconsin is a year ahead in this fixture, so its newest year has no printed release date
    wi = {"state": "WI", "years": [2026, 2027, 2028], "generated": "2028-08-25",
          "counties": [county("Barron", 120.0, 118.0, 2028), county("Dunn", 130.0, 125.0, 2028), county("Polk", 125.0, 120.0, 2028)]}
    for d in (ia, wi):
        json.dump(d, open(os.path.join(tmp, "data", "cash-rent", d["state"] + ".json"), "w"))
    REL = {2027: "Aug 20, 2027"}
    data = load(tmp)

    # when
    r27 = released_ms(2027, REL)
    ck("release date is noon Eastern on the printed day", r27 == int(datetime(2027, 8, 20, 12, tzinfo=ET).timestamp() * 1000))
    ck("a year with no printed date has no release time", released_ms(2028, REL) is None)
    ck("the page's own release table is read", released_ms(2026) == int(datetime(2026, 8, 21, 12, tzinfo=ET).timestamp() * 1000))
    ck("falls back to the first commit", published_ms(tmp, "WI", 2028, REL, lambda *a: 123)[0] == 123)
    ck("neither known: unknown, with the reason", published_ms(tmp, "WI", 2028, REL, lambda *a: None)[0] is None)

    # git: a real throwaway history
    g = os.path.join(tmp, "g")
    os.makedirs(os.path.join(g, "data", "cash-rent"))
    run_ = lambda *a, **k: subprocess.run(["git", "-C", g] + list(a), capture_output=True, text=True,
                                         env=dict(os.environ, GIT_AUTHOR_DATE=k.get("t", ""), GIT_COMMITTER_DATE=k.get("t", "")))
    run_("init", "-q")
    run_("config", "user.email", "t@example.com")
    run_("config", "user.name", "t")
    f = os.path.join(g, "data", "cash-rent", "WI.json")
    for yrs, t in (([2025, 2026], "2026-09-01T10:00:00+00:00"), ([2025, 2026, 2027], "2027-08-26T15:00:00+00:00"),
                   ([2025, 2026, 2027], "2027-09-02T15:00:00+00:00")):
        # (the history file only needs its years)
        json.dump(dict(wi, years=yrs), open(f, "w"))
        run_("add", "-A")
        run_("commit", "-qm", "x", t=t)
    ck("git: the first commit that held the year", git_first_ms(g, "WI", 2027) == int(datetime(2027, 8, 26, 15, tzinfo=ZoneInfo("UTC")).timestamp() * 1000))
    ck("git: history that starts with the year already in is not trusted", git_first_ms(g, "WI", 2026) is None)

    # the email
    os.environ.update({"LIST_URL": "https://w.dev", "LIST_TOKEN": "tok", "UNSUB_SECRET": "sec",
                       "SMTP_USER": "news@agsist.com", "MAX_PER_RUN": "200"})
    SN.TEMPLATES["rent"] = make_parts(data, {"IA": (r27, "release date"), "WI": (5, "first commit")})
    SN.LINK_IDS["a@example.com"] = SN.email_links.SAMPLE_LID
    m = SN.render("rent:ia", "rent:ia", "a@example.com", "https://w.dev", "sec", datetime(2027, 8, 25).date(), "news@agsist.com", None, tmp)
    _h, _t = m.get_body(("html",)).get_content(), m.get_body(("plain",)).get_content()
    ck("no @ inside any href, no address in a text link (subs worker v5.46)",
       not [x for x in SN.email_links.hrefs(_h) if "@" in x or "%40" in x.lower()] and not SN.email_links.bad_links(_t)
       and "k=" + SN.email_links.SAMPLE_LID + "&t=" in _t)
    txt = m.get_body(("plain",)).get_content()
    htm = m.get_body(("html",)).get_content()
    ck("subject", m["Subject"] == "Iowa county cash rents for 2027 are out", m["Subject"])
    ck("the state's new county median, from state_stats", "USDA NASS put out the 2027 county cash rents for Iowa on Aug 20, 2027. "
       "The middle Iowa county paid $260 an acre for non-irrigated cropland, across 5 counties with a published rent, up 4.0% from 2026 in the same 5 counties." in txt, txt[:500])
    ck("highest county", "Highest county: Boone at $300." in txt)
    ck("links the state page", SITE + "/rent/iowa/?" + UTM in txt)
    ck("unsubscribe stops this topic", "topic=rent%3Aia" in txt and m["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click")
    ck("no dashes, no hype", not any(x in txt + htm for x in ("—", "–", "&mdash;")) and "!" not in txt)
    mw = SN.render("rent:wi", "", "a@example.com", "https://w.dev", "sec", datetime(2027, 8, 25).date(), "news@agsist.com", None, tmp)
    ck("a release known only by its commit names no date", "for Wisconsin. The middle" in mw.get_body(("plain",)).get_content())

    # the run
    rows0 = [("before@example.com", "rent:ia", ms("2026-10-11 09:00"), None),   # asked after the 2026 release: waits for 2027
             ("sameday@example.com", "rent:ia", ms("2027-08-20 12:00"), None),  # after noon ET on release day: next year
             ("early@example.com", "rent:ia", ms("2027-08-20 09:00"), None),    # before noon ET on release day
             ("done@example.com", "rent:ia", ms("2026-10-11 09:00"), 1),
             ("wi@example.com", "rent:wi", ms("2026-10-11 09:00"), None),
             ("nofile@example.com", "rent:ks", ms("2026-10-11 09:00"), None),
             ("nots@example.com", "rent:ia", None, None)]

    class Worker:
        def __init__(self):
            self.t = {e: {"topic": tp, "ts": ts, "sent": s} for e, tp, ts, s in rows0}
            self.log, self.marks = [], []

        def __call__(self, method, url, body=None):
            u = SN.urllib.parse.urlsplit(url)
            qs = SN.urllib.parse.parse_qs(u.query)
            assert qs.get("token") == ["tok"]
            if method == "GET" and u.path == "/notice-list":
                self.log.append(qs.get("topic", [""])[0])
                return [{"email": e, "topic": v["topic"], "ts": v["ts"], "src": "rent:" + v["topic"][5:], "sent": v["sent"],
                         "lid": "0000000000%06x" % (sum(map(ord, e)) % 0xffffff)}
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

    def go(argv, w, s, rel=REL, git=lambda *a: None, d=tmp):
        lines = []
        rc = run(argv, http=w, connect=s, now=datetime(2027, 8, 25, 9, tzinfo=CT), sleep=lambda x: None,
                 out=lines.append, repo=d, released=rel, git=git)
        return rc, "\n".join(lines)

    addrs = [x[0] for x in rows0]
    w, s = Worker(), SMTP()
    rc, log = go([], w, s)
    ck("dry run: sends and marks nothing, previews a made-up address", rc == 0 and not s.sent and not w.marks
       and "k=" + SN.email_links.SAMPLE_LID in log and "%40" not in log and not any(e in log for e in addrs), log)
    rc, log = go(["--send"], w, s)
    ck("mails the Iowa notices made before the release, not the one made after it",
       sorted(s.sent) == ["before@example.com", "early@example.com"], s.sent)
    ck("marked after the send, the sent one never again", sorted(w.marks) == ["before@example.com", "early@example.com"])
    ck("Wisconsin, release time unknown: nothing sent, nothing marked, a warning", "wi@example.com" not in s.sent
       and "::warning::rent:wi: 1 waiting, release time unknown" in log, log)
    ck("a state with no rent file waits", "nofile@example.com" not in s.sent and "rent:ks" in log)
    ck("a row without a time is skipped", "nots@example.com" not in s.sent)
    ck("no address in the log", not any(e in log for e in addrs), log)
    s2 = SMTP()
    rc, log = go(["--send"], w, s2)
    ck("second run mails nobody", rc == 0 and not s2.sent, s2.sent)
    w, s = Worker(), SMTP()
    rc, log = go(["--send"], w, s, rel={}, git=lambda repo, st, y: ms("2027-08-26 10:00") if st == "WI" else None)
    ck("by first commit: Wisconsin goes, Iowa (no date, no history) waits", s.sent == ["wi@example.com"], (s.sent, log))
    w, s = Worker(), SMTP()
    rc, log = go(["--send", "--topic", "rent:ia"], w, s)
    ck("--topic rent:ia reads only that topic", w.log == ["rent:ia"] and "wi@example.com" not in s.sent and len(s.sent) == 2, (w.log, s.sent))
    rc, log = go(["--send", "--topic", "arcplc:2026-12-11"], w, SMTP())
    ck("a non-rent topic is refused", rc == 1)
    w, s = Worker(), SMTP(refuse={"before@example.com", "early@example.com"})
    rc, log = go(["--send"], w, s)
    ck("all refused: exit 1, nothing marked", rc == 1 and not w.marks, log)
    old = dict(ia, years=[2025, 2026], counties=[dict(c, rent={"nonirr": {"2026": 1.0}}) for c in ia["counties"]])
    json.dump(old, open(os.path.join(tmp, "data", "cash-rent", "IA.json"), "w"))
    w, s = Worker(), SMTP()
    rc, log = go(["--send"], w, s, rel={2026: "Aug 21, 2026", 2027: "Aug 20, 2027"})
    ck("the data still on last year's survey: the October sign-ups wait, nothing marked",
       "before@example.com" not in s.sent and "before@example.com" not in w.marks, (s.sent, log))

    print("\n%s: %d failure(s)" % ("FAIL" if fails else "OK", len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv[1:]:
        sys.exit(selftest())
    sys.exit(run(sys.argv[1:]))
