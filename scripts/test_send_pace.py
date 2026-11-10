#!/usr/bin/env python3
"""LIST MAIL GOES OUT IN BATCHES, A DEFERRAL IS TRIED ONCE MORE, TWO HARD BOUNCES LEAVE AN ADDRESS OUT.

    python3 scripts/test_send_pace.py

Nov 10, 2026: the mail provider's deliverability score had slipped, bounces were mostly soft
deferrals, and a report-day email had gone to the whole list right behind the morning Daily.

  1. scripts/send_pace.py: batches and pauses, the job's cap on waiting, DRY_RUN, one address once,
     a 4xx tried once more at the end of the list and never counted as a hard bounce, a 5xx for
     the address recorded as one (and a 5.7.x policy reply not).
  2. Count the copies: every script that mails a list walks it through a Pacer. A new sender
     with its own loop fails here until it does (or is named below as one-reader mail).
  3. scripts/bounces.py: two distinct hard bounces suppress an address; the same notice read
     twice counts once; an undo puts it back and only later bounces count.
  4. scripts/list_source.py leaves suppressed addresses out of a sender's list (never out of a
     count or a report), and the DELIVERY line says how many (suppressed=N).
  5. One whole notice run (send_notice.py) against a fake server: a deferral goes out at the end,
     a hard bounce is recorded, the waits are batched.
And everywhere: no address in anything printed or recorded.
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import io
import json
import os
import re
import smtplib
import sys
import tempfile
from contextlib import redirect_stdout
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import send_pace  # noqa: E402
import bounces  # noqa: E402
import delivery_line  # noqa: E402
import list_source  # noqa: E402

fails, passes = [], 0


def check(cond, msg):
    global passes
    if cond:
        passes += 1
    else:
        fails.append(msg)


def walk(items, environ=None, fail=None, gap=1.2, **kw):
    """A send loop as the senders write it, with a fake clock. fail: {address: [exception, ...]}."""
    slept, sent, failed = [], [], []
    fail = {k: list(v) for k, v in (fail or {}).items()}
    pace = send_pace.Pacer(items, gap=gap, sleep=slept.append, environ=environ or {}, **kw)
    for it in pace:
        a = pace._addr(it)
        try:
            if fail.get(a):
                raise fail[a].pop(0)
            sent.append(a)
        except Exception as ex:
            if not pace.defer(ex):
                failed.append(a)
        pace.after()
    return pace, slept, sent, failed


def refused(addr, code, text):
    return smtplib.SMTPRecipientsRefused({addr: (code, text.encode())})


# ───────────────────────── 1. the pacer ─────────────────────────
addrs = ["r%d@example.com" % i for i in range(211)]
p, slept, sent, failed = walk(addrs)
check(len(sent) == 211 and not failed, "211 readers: %d sent" % len(sent))
check(len([s for s in slept if s == 4.0]) == 10, "211 readers in batches of 20: %d pauses, expected 10"
      % len([s for s in slept if s == 4.0]))
check(len(slept) == 210 and abs(sum(slept) - (200 * 1.2 + 10 * 4.0)) < 1e-6,
      "211 readers: %d waits, %.1f s in all (expected 210 waits, 280 s)" % (len(slept), sum(slept)))
p, slept, *_ = walk(addrs, {"SEND_BATCH": "50", "SEND_BATCH_PAUSE": "5", "SEND_GAP": "0.5"})
check(len([s for s in slept if s == 5.0]) == 4 and all(s in (0.5, 5.0) for s in slept),
      "SEND_BATCH, SEND_BATCH_PAUSE and SEND_GAP are read from the environment")
p, slept, *_ = walk(addrs * 1 + ["x%d@example.com" % i for i in range(1800)], {"SEND_PACE_MAX": "300"})
check(sum(slept) <= 300.0 + 1e-6 and p.scale < 1 and "shortened to fit 300 s" in p.line(),
      "a long list fits the job's cap: %.1f s waited, cap 300" % sum(slept))
p, slept, sent, _ = walk(addrs[:30], {"DRY_RUN": "1"})
check(not slept and len(sent) == 30, "DRY_RUN=1 waits for nothing")
p, slept, sent, _ = walk(["a@x.com", "b@x.com", "A@X.com", " b@x.com", "c@x.com"])
check(sent == ["a@x.com", "b@x.com", "c@x.com"] and p.repeats == 2, "one address once, whatever its case: %r" % sent)
p, slept, *_ = walk(["only@x.com"])
check(slept == [], "one reader: no wait at all")
p, slept, *_ = walk([])
check(slept == [] and len(p) == 0, "an empty list: nothing")
check(send_pace.Pacer(["a", "b", "c"], environ={"SEND_BATCH": "0"}).batch == 20
      and send_pace.Pacer(["a"], environ={"SEND_BATCH_PAUSE": "-3"}).pause == 4.0,
      "a nonsense setting falls back to the default")

# deferrals
bounces.PENDING[:] = []
soft = refused("r1@example.com", 451, "4.7.1 Try again later")
p, slept, sent, failed = walk(addrs[:5], fail={"r1@example.com": [soft]})
check(sent == ["r0@example.com", "r2@example.com", "r3@example.com", "r4@example.com", "r1@example.com"] and not failed,
      "a deferred reader is tried once more after the rest: %r" % sent)
check(60.0 in slept, "the retry waits SEND_RETRY_WAIT (60 s) first")
check(not bounces.PENDING and p.soft == 1, "a deferral is not a hard bounce")
p, slept, sent, failed = walk(addrs[:5], fail={"r1@example.com": [soft, soft, soft]})
check(failed == ["r1@example.com"] and len(sent) == 4 and p.soft_final == 1, "deferred twice: one failure, no third try")
check(not bounces.PENDING, "deferred twice is still not a hard bounce")
p, slept, sent, failed = walk(addrs[:3], fail={"r1@example.com": [soft]}, environ={"SEND_PACE_MAX": "10"})
check(sum(slept) <= 10.0 + 1e-6, "the retry wait stays inside the cap (%.1f s, cap 10)" % sum(slept))
dsoft = smtplib.SMTPDataError(421, b"4.7.0 Temporary System Problem. Try again later")
p, _s, sent, failed = walk(["a@x.com", "b@x.com"], fail={"a@x.com": [dsoft]})
check(sent == ["b@x.com", "a@x.com"], "a 421 at DATA is a deferral too")
dropped = OSError("connection reset")
p, _s, sent, failed = walk(["a@x.com", "b@x.com"], fail={"a@x.com": [dropped]})
check(failed == ["a@x.com"] and sent == ["b@x.com"], "a dropped socket costs that one email, never a retry of a maybe-sent mail")
p = send_pace.Pacer(["a@x.com", "b@x.com"], sleep=lambda s: None, environ={})
it = iter(p)
next(it)
check(p.more(), "more(): another reader is waiting")
p.defer(soft)
next(it)
check(p.more(), "more(): the last reader of the first pass, with a retry still to come")
check(next(it, None) == "a@x.com" and not p.more(), "more(): nothing after the retry")

# hard bounces
bounces.PENDING[:] = []
cases = [
    (refused("h@x.com", 550, "5.1.1 The email account that you tried to reach does not exist"), "hard"),
    (refused("h@x.com", 553, "5.1.3 bad address syntax"), "hard"),
    (refused("h@x.com", 550, "no such user"), "hard"),
    (refused("h@x.com", 550, "5.7.1 Our system has detected that this message is likely unsolicited mail"), None),
    (refused("h@x.com", 552, "5.2.2 mailbox full"), None),
    (refused("h@x.com", 452, "4.2.2 mailbox over quota"), "soft"),
    (smtplib.SMTPDataError(550, b"5.1.1 user unknown"), "hard"),
    (smtplib.SMTPDataError(554, b"5.7.1 rejected for policy reasons"), None),
    (smtplib.SMTPDataError(550, b"message refused"), None),
    (smtplib.SMTPSenderRefused(550, b"5.7.0 sender not allowed", "news@x"), None),
    (smtplib.SMTPServerDisconnected("gone"), None),
    (smtplib.SMTPRecipientsRefused("not a dict"), None),
    (smtplib.SMTPAuthenticationError(535, b"5.7.8 bad login"), None),
    (TimeoutError("slow"), None),
    (smtplib.SMTPServerDisconnected("please run connect() first"), "soft"),
    (smtplib.SMTPServerDisconnected("Connection unexpectedly closed"), None),
]
for ex, want in cases:
    got = send_pace.classify(ex, "h@x.com")[0]
    check(got == want, "classify %s %r: %r, expected %r" % (type(ex).__name__, getattr(ex, "smtp_error", ex), got, want))
check(send_pace.classify(smtplib.SMTPRecipientsRefused({"Other@X.com": (550, b"5.1.1 x"), "h@x.com": (450, b"4.0.0 y")}),
                         "h@x.com")[0] == "soft", "a refusal names its recipient: that one's code counts")
hard = refused("dead@example.org", 550, "5.1.1 does not exist")
p, slept, sent, failed = walk(["ok@example.org", "dead@example.org"], fail={"dead@example.org": [hard, hard]})
check(failed == ["dead@example.org"] and len(bounces.PENDING) == 1, "a hard bounce: one failure, recorded once, not retried")
ev = bounces.PENDING[0]
check(ev["h"] == bounces.key("dead@example.org") and ev["src"] == "smtp" and "550" in ev["code"] and "5.1.1" in ev["code"],
      "the record holds the key and the code: %r" % ev)
check("@" not in json.dumps(bounces.PENDING) and "dead" not in json.dumps(bounces.PENDING),
      "no address in a bounce record")
check("@" not in p.line() and p.line().startswith("pacing: ") and "1 hard bounce" in p.line(), "the pacing line: counts only")

# ───────────────────────── 2. count the copies ─────────────────────────
# One-reader mail: a buyer's own order, a sponsor's own link, a form to the owner. Not a list.
ONE_READER = {
    "rp_buyer_email.py": "one email per paid order, to that buyer",
    "rp_design_email.py": "one proof per design ask, to that reader",
    "sponsor_apply.py": "the applicant's own confirmation",
    "sponsor_send_link.py": "one sponsor's own link",
    "form_digest.py": "a digest to the owner",
}
SKIP = {"send_pace.py", "bounces.py", "delivery_line.py", "list_source.py", "send_cap.py", "log_safe.py",
        "email_links.py"}
for path in sorted((ROOT / "scripts").glob("*.py")):
    n = path.name
    if n.startswith("test_") or n in SKIP or n.startswith("_"):
        continue
    src = path.read_text(encoding="utf-8")
    if "delivery_line.start" not in src or ".send_message(" not in src:
        continue
    if n in ONE_READER:
        continue
    check("send_pace.Pacer(" in src,
          "%s mails readers and walks its list without send_pace.Pacer (no batches, no deferral retry, "
          "no hard-bounce record); use it, or name it in ONE_READER with the reason" % n)
    if "send_pace.Pacer(" in src:
        check("pace.defer(ex)" in src and "pace.after()" in src and re.search(r"(enumerate\(pace\)|in pace:)", src),
              "%s makes a Pacer but its loop does not go through it (enumerate(pace), pace.defer(ex), pace.after())" % n)
        check(not re.search(r"if \w+ < len\(\w+\) - 1:\n\s+(?:time\.)?sleep\(1\.[25]\)", src),
              "%s still has its old fixed throttle beside the Pacer" % n)
for n in ONE_READER:
    check((ROOT / "scripts" / n).exists(), "ONE_READER names %s, which is gone: take it off" % n)

# ───────────────────────── 3. the ledger ─────────────────────────
K = bounces.key
a, b = "gone@example.org", "Typo@Example.net"
e1 = {"h": K(a), "id": "dsn:1", "day": "2026-11-10", "code": "5.1.1", "src": "dsn"}
led, ch = bounces.fold(None, [e1], today="2026-11-10")
check(ch["recorded"] == [K(a)] and not led["suppressed"], "one hard bounce: recorded, not suppressed")
led, ch = bounces.fold(led, [e1], today="2026-11-11")
check(not ch["recorded"] and not led["suppressed"], "the same notice read again (an 8-day inbox window) counts once")
e2 = dict(e1, id="smtp:daily:9.1:0", day="2026-11-11", src="smtp")
led, ch = bounces.fold(led, [e2], today="2026-11-11")
check(led["suppressed"] == [K(a)] and ch["suppressed"] == [K(a)], "a second hard bounce suppresses the address")
check(bounces.suppressed_keys(led) == {K(a)}, "suppressed_keys agrees with the ledger")
check(K(b) == K("typo@example.net") == K(" typo@example.net "), "the key ignores case and spaces")
led, ch = bounces.fold(led, [], today="2026-11-12", undo=[K(a)])
check(not led["suppressed"] and ch["undone"] == [K(a)] and len(led["addr"][K(a)]["ids"]) == 2,
      "an undo puts the address back and keeps its history (a flag, never a delete)")
led, _ = bounces.fold(led, [dict(e1, id="dsn:2", day="2026-11-13")], today="2026-11-13")
check(not led["suppressed"], "after an undo one new hard bounce does not suppress again")
led, _ = bounces.fold(led, [dict(e1, id="dsn:3", day="2026-11-14")], today="2026-11-14")
check(led["suppressed"] == [K(a)], "two new ones after the undo do")
hand = json.loads(json.dumps(led))
hand["addr"][K(a)]["undo"] = "2026-11-30"
check(bounces.suppressed_keys(hand) == set(), "a hand-set undo day in the ledger is honoured by the senders")
led, ch = bounces.fold(led, [{"h": "dead@example.org", "id": "x"}, {"h": K(a)}], today="2026-11-14")
check(not ch["recorded"], "an event with an address for a key, or with no id, is refused")
check("@" not in json.dumps(led), "no address anywhere in the ledger")
try:
    bounces.parse(b"[1, 2]")
    check(False, "a broken ledger is refused")
except ValueError:
    check(True, "")
check(bounces.parse(None) == bounces.empty(), "a missing ledger is an empty one")

# ───────────────────────── 4. lists leave suppressed addresses out ─────────────────────────
list_source.reset()
rows = [{"email": "keep@example.com", "lid": "1"}, {"email": "Gone@Example.org", "lid": "2"}, {"email": "two@example.com"}]
check(list_source.drop_suppressed(rows) == rows, "no sender asked: a list (a count, a report) is read as it is")
check(list_source.drop_suppressed(rows, keys={K(a)}) == [rows[0], rows[2]], "a suppressed address is left out")
check(list_source.drop_suppressed(["keep@example.com", "gone@example.org"], keys={K(a)}) == ["keep@example.com"],
      "a plain list of addresses too")
list_source.reset()
t = delivery_line.Tally("pace-test")
list_source.suppress_for(t)
list_source.STATE["sup_keys"] = {K(a)}
kept = list_source.drop_suppressed(rows)
check(kept == [rows[0], rows[2]] and t.extra.get("suppressed") == 1, "a sender's list: left out and counted (%r)" % t.extra)
list_source.drop_suppressed(rows)
check(t.extra.get("suppressed") == 1, "the same address read twice in one run counts once")
check(t.line().endswith("suppressed=1") and "@" not in t.line(), "the DELIVERY line: %s" % t.line())


def fake_request(method, url, body=None, headers=None, timeout=30):
    return [dict(r) for r in rows]


real = list_source._request
try:
    list_source._request = fake_request
    got = list_source.request("GET", "https://w.dev/notice-list?token=t&topic=x")
    check([r["email"] for r in got] == ["keep@example.com", "two@example.com"], "request() filters a list route")
    got = list_source.request("GET", "https://w.dev/count?token=t")
    check(len(got) == 3, "request() leaves a route that is not a list alone")
finally:
    list_source._request = real

# the ledger cannot be read: nobody is left out, one warning, no count claimed
list_source.reset()
t2 = delivery_line.Tally("pace-test")
list_source.suppress_for(t2)
tmp = tempfile.mkdtemp(prefix="pace-")
old = {k: os.environ.get(k) for k in ("LIST_BACKUP_FILE",)}
old_root = list_source.FLAG_ROOT
try:
    os.environ["LIST_BACKUP_FILE"] = "1"
    list_source.FLAG_ROOT = Path(tmp)
    (Path(tmp) / bounces.DIR).mkdir(parents=True)
    (Path(tmp) / bounces.LEDGER).write_text("{broken")
    buf = io.StringIO()
    with redirect_stdout(buf):
        kept = list_source.drop_suppressed(rows)
    check(kept == rows and "::warning::" in buf.getvalue() and "suppressed" not in t2.extra,
          "an unreadable ledger leaves nobody out and says so once")
    # a readable one, through the same path the senders use
    list_source.reset()
    t3 = delivery_line.Tally("pace-test")
    list_source.suppress_for(t3)
    led2, _ = bounces.fold(None, [e1, e2])
    bounces.write_ledger(led2)
    kept = list_source.drop_suppressed(rows)
    check(kept == [rows[0], rows[2]] and t3.extra.get("suppressed") == 1, "the ledger file is read and applied")
    check("@" not in (Path(tmp) / bounces.LEDGER).read_text(), "the written ledger holds no address")
    # a send-time record is saved as an event file with no address in it
    bounces.PENDING[:] = []
    bounces.STATE.update({"saved": False, "sender": "pace-test"})
    bounces.record("dead@example.org", "550 5.1.1")
    with redirect_stdout(io.StringIO()):
        ok = bounces.save()
    evs = bounces.read_events()
    check(ok and len(evs) == 1 and evs[0]["h"] == K("dead@example.org") and "@" not in json.dumps(evs),
          "send-time hard bounces are saved and read back by key")
finally:
    list_source.FLAG_ROOT = old_root
    for k, v in old.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v
    list_source.reset()
    bounces.PENDING[:] = []
    bounces.STATE.update({"saved": False, "sender": ""})

# ───────────────────────── 5. one whole notice run ─────────────────────────
import send_notice  # noqa: E402
from datetime import datetime  # noqa: E402

T = "arcplc:2027-03-15"
addrs5 = ["n%d@farm.com" % i for i in range(25)]
os.environ.update({"LIST_URL": "https://w.dev", "LIST_TOKEN": "tok", "UNSUB_SECRET": "sec",
                   "SMTP_USER": "news@agsist.com", "MAX_PER_RUN": "200"})


class Worker:
    def __init__(self):
        self.t = {e: {"sent": None, "lid": "0000000000000%03d" % i} for i, e in enumerate(addrs5)}
        self.marks = []

    def __call__(self, method, url, body=None):
        path = url.split("?")[0].split("w.dev")[-1]
        if method == "GET" and path == "/notice-list":
            return [{"email": e, "topic": T, "ts": 1, "src": "page:arc-plc", "sent": v["sent"], "lid": v["lid"]}
                    for e, v in self.t.items() if not v["sent"]]
        if method == "POST" and path == "/notice-mark":
            self.marks.append(body["email"])
            self.t[body["email"]]["sent"] = 1
            return {"ok": True}
        raise AssertionError(path)


class SMTP:
    def __init__(self, plan):
        self.plan, self.sent, self.closed, self.connects = {k: list(v) for k, v in plan.items()}, [], False, 0

    def __call__(self):
        self.connects += 1
        self.closed = False
        return self

    def send_message(self, msg):
        to = msg["To"]
        if self.closed:
            raise smtplib.SMTPServerDisconnected("please run connect() first")
        if self.plan.get(to):
            ex = self.plan[to].pop(0)
            self.closed = getattr(ex, "smtp_code", None) == 421
            raise ex
        self.sent.append(to)

    def quit(self):
        pass


bounces.PENDING[:] = []
w = Worker()
s = SMTP({"n3@farm.com": [refused("n3@farm.com", 450, "4.2.1 rate limited, try later")],
          "n7@farm.com": [refused("n7@farm.com", 550, "5.1.1 no such user")]})
waits, lines = [], []


class Clock:
    def __init__(self, s):
        self.s = s

    def astimezone(self, tz):
        return datetime.fromisoformat(self.s).replace(tzinfo=tz)


rc = send_notice.run(["--send", "--topic", T], http=w, connect=s, now=Clock("2027-03-08 08:10"),
                     sleep=waits.append, out=lines.append)
log = "\n".join(lines)
check(rc == 0 and len(s.sent) == 24 and s.sent[-1] == "n3@farm.com", "the notice run: the deferred reader went out last "
      "(rc %r, %d sent, last %r)" % (rc, len(s.sent), "n3" in (s.sent[-1:] or [""])[0]))
check(sorted(w.marks) == sorted(s.sent), "every sent notice is marked, the deferred one too, and only those")
check("n7@farm.com" not in s.sent and w.t["n7@farm.com"]["sent"] is None, "the hard bounce stays unmarked")
check(len(bounces.PENDING) == 1 and bounces.PENDING[0]["h"] == K("n7@farm.com"), "the notice run recorded the hard bounce")
check(4.0 in waits and 60.0 in waits, "the notice run waits in batches and before the retry (%r)" % sorted(set(waits)))
check(not any(e in log for e in addrs5) and "@farm.com" not in log, "no address in the notice run's log")
bounces.PENDING[:] = []
# a 421 that closes the connection: that reader and the next are tried again after a reconnect
w = Worker()
s = SMTP({"n5@farm.com": [smtplib.SMTPSenderRefused(421, b"4.7.0 Try again later, closing connection", "news@x")]})
rc = send_notice.run(["--send", "--topic", T], http=w, connect=s, now=Clock("2027-03-08 08:10"),
                     sleep=lambda x: None, out=lambda *a: None)
check(rc == 0 and len(s.sent) == 25 and s.connects == 2 and set(s.sent[-2:]) == {"n5@farm.com", "n6@farm.com"},
      "the notice run after a 421: %d of 25 sent, %d connections" % (len(s.sent), s.connects))
check(not bounces.PENDING, "a 421 is not a hard bounce")


def main():
    if fails:
        for f in fails:
            print("FAIL: " + f)
        print("\n%d passed, %d failed" % (passes, len(fails)))
        return 1
    print("send pace: %d passed: batches with a pause, one address once, a deferral tried once more, "
          "two hard bounces leave an address out, counts only" % passes)
    return 0


if __name__ == "__main__":
    sys.exit(main())
