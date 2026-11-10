#!/usr/bin/env python3
"""
send_custom_rates_notice.py: "Email me when my state's new custom rate survey is out" (topic
customrates:<st>, subs worker /notice).

A reader on /custom-rates picks a state and asks for one email when that state's next survey is
on the page. The worker stores topic customrates:<st> under note:<email> with the time they asked
(ts). This script is the other half, the same rule as send_rent_notice.py:

THE RULE. A customrates:<st> notice waits for the first survey edition for that state that reached
the page AFTER the notice's ts. The edition a state reads is its survey file
scripts/custom_rates/<st>.tsv (Delaware reads the Maryland and Delaware file), named by its
"# survey_year:" and "# rate_year:" lines (the title is left out, so a typo fixed in it never
mails anyone again). That edition counts as out at the time of
the first commit whose file held it, trusted only when git history reaches the commit before it
(a shallow clone that starts with the edition already in says nothing about when it came). If that
is not known, nothing is sent for the state and the log says so. A notice is mailed once when it
is unsent and its ts is before that time, then marked with POST /notice-mark; a notice made after
the edition waits for the next one. A state with no survey file yet waits for its first.

It rides an existing job (no new schedule): a step of a workflow that already sends notices, after
its checkout fetched enough history. The email's numbers are the page's own (blend.json and the
state file: the survey's combine corn average, answers and range when the survey prints one).

    python3 scripts/send_custom_rates_notice.py              # dry run: counts and a preview, sends nothing
    CUSTOMRATES_NOTICE_LIVE=1 python3 scripts/send_custom_rates_notice.py --send   # the real thing

LIVE GATE. --send is refused unless CUSTOMRATES_NOTICE_LIVE=1 (the owner turns it on; the workflow passes the
repo variable), the same switch as LANDSALES_MONTHLY_LIVE in send_land_alert.py. Without it a run is a
dry run at most: nothing is sent and nothing is marked.
    python3 scripts/send_custom_rates_notice.py --selftest   # fake HTTP and fake SMTP; no network

Env: the same as send_notice.py, plus CUSTOMRATES_NOTICE_LIVE. The log carries counts only, never an address.
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import argparse
import json
import os
import re
import smtplib
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
sys.path.insert(0, str(HERE))
import email_links  # noqa: E402  (every send refuses a link to the worker host; scripts/email_links.py)
import log_safe  # noqa: E402  sender_addr: the From line, SES-safe
import delivery_line  # noqa: E402  (the DELIVERY count line cron_health reads)
TALLY = None  # set in __main__ only (never by a selftest): delivery_line's per-run counts
import send_notice as SN               # noqa: E402  transport, render, unsubscribe link, mark
import build_custom_rates as BC        # noqa: E402  the survey files, money, the page's words

SITE = SN.SITE
UTM = "utm_source=custom_rates_survey&utm_medium=email"
TOPIC_RE = re.compile(r"customrates:([a-z]{2})")


# ---------------------------------------------------------------- data
def edition(meta):
    """What names a survey edition: its years. A new edition changes the survey year (or the rate year);
    a fix to the title's wording is the same edition and mails nobody."""
    return (meta.get("survey_year", ""), meta.get("rate_year", ""))


def survey_file(repo, st):
    """The survey file a state's readers read: its own, or the shared one that lists it (DE reads md.tsv)."""
    src = os.path.join(repo, "scripts", "custom_rates")
    if not os.path.isdir(src):
        return None
    for fn in sorted(os.listdir(src)):
        if not fn.endswith(".tsv"):
            continue
        meta = BC.parse_tsv(open(os.path.join(src, fn), encoding="utf-8").read(), fn)[0]
        if meta.get("state") == st or st in meta.get("states", "").split():
            return fn
    return None


def load(repo, fn):
    """(meta, the page's state doc) for one survey file as it stands now."""
    meta, rows, _ = BC.parse_tsv(open(os.path.join(repo, "scripts", "custom_rates", fn), encoding="utf-8").read(), fn)
    clean, _ = BC.validate(meta, rows, fn)
    return meta, BC.state_doc(meta, clean)


def git_first_ms(repo, fn, key):
    """ms of the first commit whose scripts/custom_rates/<fn> held this edition, or None when history
    does not reach the commit before it (a shallow clone cut there says nothing about when it came)."""
    rel = "scripts/custom_rates/" + fn
    try:
        log = subprocess.run(["git", "-C", str(repo), "log", "--reverse", "--format=%H %ct", "--", rel],
                             capture_output=True, text=True, timeout=120).stdout.split("\n")
    except Exception:
        return None
    for line in log:
        if not line.strip():
            continue
        h, ct = line.split()
        try:
            text = subprocess.run(["git", "-C", str(repo), "show", "%s:%s" % (h, rel)], capture_output=True, text=True, timeout=60).stdout
        except Exception:
            continue
        if edition(BC.parse_tsv(text, fn)[0]) == key:
            parent = subprocess.run(["git", "-C", str(repo), "rev-parse", "--verify", "-q", h + "^"], capture_output=True, text=True)
            return int(ct) * 1000 if parent.returncode == 0 else None
    return None


# ---------------------------------------------------------------- the email
def make_parts(docs):
    def parts(topic, src, today, _repo=None):
        st = TOPIC_RE.fullmatch(topic).group(1).upper()
        d = docs[st]
        name = BC.STATE_NAMES[st]
        when = BC.survey_words(d["survey_year"], d.get("rate_year"))
        first = "%s put out a new custom rate survey for %s, the %s (%s), and its numbers are on AGSIST now." % (
            d["publisher"], d["name"], d["survey"], when)
        paras = [[(first, None)]]
        r = next((x for x in d["rows"] if x.get("k") == "combine-corn"), None) or next((x for x in d["rows"] if x.get("k") and "a" in x), None)
        if r:
            paras.append([("%s: %s %s (%s, %s)." % (r["o"], BC.money(r["a"], r["u"]), BC.short_unit(r["u"]), BC.ans_words(r.get("n")),
                                                     BC.range_words(r.get("lo"), r.get("hi"), r["u"], d["spread"])), None)])
        href = BC.state_href({"st": d["state"], "slug": d["slug"], "page": d["page"]})
        page = "%s%s%s%s" % (SITE, href, "&" if "?" in href else "?", UTM)
        paras.append([("Every job in the survey, beside the neighbors and the middle across the states: ", None), (page, page)])
        if st != d["state"]:
            paras.append([("%s reads the %s survey, which covers both states." % (name, d["name"]), None)])
        paras.append([("Rates are survey averages; your local custom operator may charge more or less.", None)])
        paras.append([("You asked for this one email on agsist.com. There won't be another for this survey.", None)])
        return "%s's new custom rate survey is out" % name, paras
    return parts


# ---------------------------------------------------------------- the run
def run(argv, http=SN.http_json, connect=SN.smtp_connect, now=None, sleep=time.sleep, out=print,
        repo=REPO, git=git_first_ms):
    p = argparse.ArgumentParser(add_help=False)
    p.add_argument("--send", action="store_true")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--max", type=int, default=int(SN.env("MAX_PER_RUN", "200")))
    a = p.parse_args(argv)
    send = a.send and not a.dry_run
    if TALLY:
        TALLY.dry = not send
    if send and SN.env("CUSTOMRATES_NOTICE_LIVE", "") != "1":
        if TALLY:
            TALLY.dry = True
        out("refused: CUSTOMRATES_NOTICE_LIVE is not 1, so the new-survey list gets nothing (Sig turns it on). Nothing sent.")
        return 1
    today = (now or datetime.now(SN.TZ)).astimezone(SN.TZ).date()
    base, tok, secret = SN.env("LIST_URL"), SN.env("LIST_TOKEN"), SN.env("UNSUB_SECRET")
    if not (base and tok and secret):
        out("LIST_URL, LIST_TOKEN and UNSUB_SECRET are required")
        return 1
    base = base.rstrip("/")
    from_addr = log_safe.sender_addr("news@agsist.com")
    reply_to = SN.env("REPLY_TO")
    out("date %s (America/Chicago), mode %s" % (today.isoformat(), "SEND" if send else "dry run"))
    try:
        rows = http("GET", "%s/notice-list?token=%s&topic=%s&unsent=1" % (
            base, SN.urllib.parse.quote(tok), SN.urllib.parse.quote("customrates:")))
    except Exception as ex:
        out("customrates: could not read the list (%s)" % type(ex).__name__)
        return 1
    if not isinstance(rows, list):
        out("customrates: the list did not come back as a list")
        return 1

    pub, docs, todo, seen, skipped, waiting, nosurvey, unknown = {}, {}, [], set(), 0, 0, 0, {}
    for r in rows:
        r = r or {}
        e = str(r.get("email") or "").strip().lower()
        t = str(r.get("topic") or "")
        m = TOPIC_RE.fullmatch(t)
        ts = r.get("ts")
        if not m or r.get("sent") or not SN.EMAIL_RE.match(e) or (e, t) in seen \
                or not isinstance(ts, (int, float)) or isinstance(ts, bool) or not SN.email_links.lid_of(r):
            skipped += 1
            continue
        seen.add((e, t))
        SN.LINK_IDS[e] = SN.email_links.lid_of(r)
        st = m.group(1).upper()
        if st not in BC.STATE_NAMES:
            skipped += 1
            continue
        if st not in pub:
            fn = survey_file(repo, st)
            if not fn:
                pub[st] = (None, "no survey yet")
            else:
                meta, d = load(repo, fn)
                docs[st] = d
                ms = git(repo, fn, edition(meta))
                pub[st] = (ms, "first commit" if ms else "git history does not reach the commit before this survey edition")
        ms, why = pub[st]
        if ms is None:
            if why == "no survey yet":
                nosurvey += 1
            else:
                unknown[st] = unknown.get(st, 0) + 1
            continue
        if ts < ms:
            todo.append((e, t, str(r.get("src") or "")))
        else:
            waiting += 1
    for st, n in sorted(unknown.items()):
        out("::warning::customrates:%s: %d waiting, when this survey edition came out is unknown (%s)" % (st.lower(), n, pub[st][1]))
    later = max(0, len(todo) - a.max)
    todo = todo[:a.max]
    if TALLY:
        TALLY.waiting += len(todo)
    out("customrates: %d to mail, %d waiting for a survey newer than their ask, %d waiting for a first survey, %d edition time unknown, "
        "%d skipped, %d left for the next run" % (len(todo), waiting, nosurvey, sum(unknown.values()), skipped, later))

    SN.TEMPLATES["customrates"] = make_parts(docs)
    if not send:
        ex = next((st for st in ("IA",) + tuple(sorted(docs)) if st in docs), None)
        if ex is None:
            fn = survey_file(repo, "IA")
            if fn:
                docs["IA"] = load(repo, fn)[1]
                ex = "IA"
        if ex:
            m = SN.render("customrates:" + ex.lower(), "", "reader@example.com", base, "preview", today, from_addr, reply_to, repo,
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
                out("::error::customrates: a sent notice could not be marked; stopping so nobody gets two")
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
    if TALLY:
        TALLY.sent += sent
    out("customrates: sent %d, failed %d" % (sent, failed))
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

    UTC = ZoneInfo("UTC")
    ms = lambda s: int(datetime.fromisoformat(s).replace(tzinfo=UTC).timestamp() * 1000)
    tmp = tempfile.mkdtemp()
    src = os.path.join(tmp, "scripts", "custom_rates")
    os.makedirs(src)

    def tsv(st, name, survey, year, extra=""):
        head = "\n".join("# %s: %s" % kv for kv in [("state", st), ("name", name), ("survey", survey), ("publisher", "Test Extension"),
                                                    ("survey_year", str(year)), ("collected", "c"), ("url", "https://x.edu/a"),
                                                    ("ref", "r"), ("spread", "trimmed"), ("includes", "i"), ("range_note", "n")])
        return head + extra + "\nkey\tsection\toperation\tunit\tavg\tlo\thi\tn\ncombine-corn\tH\tCorn combining\tacre\t46.05\t25.00\t80.00\t119\n"

    sh = lambda *a, **k: subprocess.run(["git", "-C", tmp] + list(a), capture_output=True, text=True,
                                        env=dict(os.environ, GIT_AUTHOR_DATE=k.get("t", ""), GIT_COMMITTER_DATE=k.get("t", "")))
    sh("init", "-q")
    sh("config", "user.email", "t@example.com")
    sh("config", "user.name", "t")
    ia, md = os.path.join(src, "ia.tsv"), os.path.join(src, "md.tsv")
    open(md, "w").write(tsv("MD", "Maryland and Delaware", "MD Survey", 2025, "\n# states: MD DE"))   # in the first commit
    steps = [(ia, tsv("IA", "Iowa", "2026 Iowa Survey", 2026), "2026-03-10T15:00:00+00:00"),
             (ia, tsv("IA", "Iowa", "2026 Iowa Survey", 2026) + "\n", "2026-05-01T15:00:00+00:00"),       # a blank line, same edition
             (ia, tsv("IA", "Iowa", "2027 Iowa Survey", 2027), "2027-03-12T15:00:00+00:00"),               # the new edition
             (ia, tsv("IA", "Iowa", "2027 Iowa Custom Rate Survey", 2027), "2027-04-02T15:00:00+00:00")]   # its title's typo fixed
    for path, text, t in steps:
        open(path, "w").write(text)
        sh("add", "-A")
        sh("commit", "-qm", "x", t=t)
    key27 = ("2027", "")
    ck("git: the first commit that held the new edition", git_first_ms(tmp, "ia.tsv", key27) == ms("2027-03-12T15:00:00"))
    ck("a title typo fix is the same edition: its time stays the first commit's",
       edition(BC.parse_tsv(open(ia).read(), "ia.tsv")[0]) == key27 and git_first_ms(tmp, "ia.tsv", key27) == ms("2027-03-12T15:00:00"))
    ck("git: an edition whose first commit starts the history is not trusted",
       git_first_ms(tmp, "md.tsv", ("2025", "")) is None and git_first_ms(tmp, "ia.tsv", ("2026", "")) is None)
    ck("Delaware reads the shared file", survey_file(tmp, "DE") == "md.tsv" and survey_file(tmp, "MN") is None)

    os.environ.update({"LIST_URL": "https://w.dev", "LIST_TOKEN": "tok", "UNSUB_SECRET": "sec",
                       "SMTP_USER": "news@agsist.com", "MAX_PER_RUN": "200"})
    os.environ.pop("CUSTOMRATES_NOTICE_LIVE", None)
    docs = {"IA": load(tmp, "ia.tsv")[1], "DE": load(tmp, "md.tsv")[1]}
    SN.TEMPLATES["customrates"] = make_parts(docs)
    SN.LINK_IDS["a@example.com"] = SN.email_links.SAMPLE_LID
    m = SN.render("customrates:ia", "page:custom-rates", "a@example.com", "https://w.dev", "sec", datetime(2027, 3, 20).date(), "news@agsist.com", None, tmp)
    txt, htm = m.get_body(("plain",)).get_content(), m.get_body(("html",)).get_content()
    ck("subject", m["Subject"] == "Iowa's new custom rate survey is out", m["Subject"])
    ck("names the survey and its year", "Test Extension put out a new custom rate survey for Iowa, the 2027 Iowa Custom Rate Survey (2027 survey)" in txt, txt[:400])
    ck("the survey's own number, answers and its kind of range",
       "Corn combining: $46.05 an acre (119 answers, trimmed range (lowest and highest answer left out) $25.00 to $80.00)." in txt, txt[:600])
    ck("links the state page", SITE + "/custom-rates/iowa?" + UTM in txt)
    ck("unsubscribe stops this topic, no address in any link", "topic=customrates%3Aia" in txt
       and not [x for x in SN.email_links.hrefs(htm) if "@" in x or "%40" in x.lower()] and not SN.email_links.bad_links(txt))
    ck("no dashes, no hype", not any(x in txt + htm for x in ("\u2014", "\u2013", "&mdash;")) and "!" not in txt)
    mde = SN.render("customrates:de", "", "a@example.com", "https://w.dev", "sec", datetime(2027, 3, 20).date(), "news@agsist.com", None, tmp)
    ck("Delaware: says it reads the shared survey", "Delaware reads the Maryland and Delaware survey" in mde.get_body(("plain",)).get_content())

    rows0 = [("before@example.com", "customrates:ia", ms("2026-11-03T09:00:00"), None),   # asked on the 2026 edition: mailed once
             ("after@example.com", "customrates:ia", ms("2027-03-13T09:00:00"), None),    # asked after the 2027 edition: waits
             ("done@example.com", "customrates:ia", ms("2026-11-03T09:00:00"), 1),
             ("de@example.com", "customrates:de", ms("2026-11-03T09:00:00"), None),       # edition time unknown: waits, warned
             ("mn@example.com", "customrates:mn", ms("2026-11-03T09:00:00"), None),       # no survey yet: waits
             ("nots@example.com", "customrates:ia", None, None)]

    class Worker:
        def __init__(self, fail_mark=False):
            self.t = {e: {"topic": tp, "ts": ts, "sent": s} for e, tp, ts, s in rows0}
            self.log, self.marks, self.fail_mark = [], [], fail_mark

        def __call__(self, method, url, body=None):
            u = SN.urllib.parse.urlsplit(url)
            qs = SN.urllib.parse.parse_qs(u.query)
            assert qs.get("token") == ["tok"]
            if method == "GET" and u.path == "/notice-list":
                self.log.append(qs.get("topic", [""])[0])
                return [{"email": e, "topic": v["topic"], "ts": v["ts"], "src": "page:custom-rates", "sent": v["sent"],
                         "lid": "0000000000%06x" % (sum(map(ord, e)) % 0xffffff)}
                        for e, v in self.t.items() if not (qs.get("unsent") == ["1"] and v["sent"])]
            if method == "POST" and u.path == "/notice-mark":
                if self.fail_mark:
                    return {"ok": False}
                self.marks.append(body["email"])
                self.t[body["email"]]["sent"] = 2
                return {"ok": True}
            raise AssertionError(method + " " + u.path)

    class SMTP:
        def __init__(self):
            self.sent = []

        def __call__(self):
            return self

        def send_message(self, msg):
            self.sent.append(msg["To"])

        def quit(self):
            pass

    def go(argv, w, s):
        lines = []
        rc = run(argv, http=w, connect=s, now=datetime(2027, 3, 20, 9, tzinfo=SN.TZ), sleep=lambda x: None, out=lines.append, repo=tmp)
        return rc, "\n".join(lines)

    addrs = [x[0] for x in rows0]
    w, s = Worker(), SMTP()
    rc, log = go([], w, s)
    ck("dry run: sends and marks nothing, previews a made-up address", rc == 0 and not s.sent and not w.marks
       and "%40" not in log and not any(e in log for e in addrs), log)
    rc, log = go(["--send"], w, s)
    ck("live gate: --send without CUSTOMRATES_NOTICE_LIVE=1 sends and marks nothing, exit 1",
       rc == 1 and not s.sent and not w.marks and "refused: CUSTOMRATES_NOTICE_LIVE is not 1" in log, (rc, s.sent, log))
    os.environ["CUSTOMRATES_NOTICE_LIVE"] = "0"
    rc, log = go(["--send"], w, s)
    ck("live gate: any value but 1 is off", rc == 1 and not s.sent and not w.marks)
    os.environ["CUSTOMRATES_NOTICE_LIVE"] = "1"
    rc, log = go(["--send"], w, s)
    ck("mails the notice made before the new edition, not the one made after it", s.sent == ["before@example.com"], s.sent)
    ck("marked after the send", w.marks == ["before@example.com"])
    ck("Delaware, edition time unknown: nothing sent, a warning", "de@example.com" not in s.sent
       and "::warning::customrates:de: 1 waiting" in log, log)
    ck("a state with no survey yet waits quietly", "mn@example.com" not in s.sent and "1 waiting for a first survey" in log, log)
    ck("a row without a time is skipped", "nots@example.com" not in s.sent)
    ck("no address in the log", not any(e in log for e in addrs), log)
    s2 = SMTP()
    rc, log = go(["--send"], w, s2)
    ck("sent once: the second run mails nobody", rc == 0 and not s2.sent, s2.sent)
    w, s = Worker(fail_mark=True), SMTP()
    rc, log = go(["--send"], w, s)
    ck("a send that cannot be marked stops the run (nobody gets two)", rc == 1 and s.sent == ["before@example.com"], (rc, s.sent, log))

    print("\n%s: %d failure(s)" % ("FAIL" if fails else "OK", len(fails)))
    return 1 if fails else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv[1:]:
        sys.exit(selftest())
    TALLY = delivery_line.start("customrates-notice")
    sys.exit(run(sys.argv[1:]))
