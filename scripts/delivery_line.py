#!/usr/bin/env python3
"""
delivery_line.py: the one machine-readable line every reader email sender prints per run.

A green run is not a delivered email (build rule 56, Nov 3 2026): rp-design-email and
rp-buyer-email ran green and dry for two weeks with their live variable at 1. So every
script that mails readers or a list prints, once per run, at exit:

    DELIVERY sender=<name> sent_readers=N waiting=M dry=0|1 [asks=N] [orders=N]

  sent_readers  emails that reached a reader this run (the owner's copies and previews never count)
  waiting       readers due an email this run, sent or not (in a dry run: what would have gone)
  dry           1 when this run could not mail the list (dry run, preview, the owner only, send off)
  asks, orders  extra counts a check reads (rp-design-email's design asks, rp-buyer-email's orders)
  already_sent  1 when the Daily found its day flag set: 0 sent is fine (any other 0/0 exit is no send)
  smtp          recipients this run handed to the mail server, the owner's copies too (scripts/send_cap.py; only
                on a run that sent); the send-volume row counts the plan's daily cap from it
  cap_refused   sends the mail server refused like the plan's daily cap or a rate limit (send_cap.py)
  suppressed    addresses left out of this run's list after two hard bounces (scripts/bounces.py); only on
                a run whose list was read with the suppressed-address list

Counts only, never an address. scripts/cron_health.py (the delivery rows) reads these lines
from each sender's run logs; its list of senders is scripts/delivery_check.py SENDERS, and
test/delivery-inventory.test.mjs fails a workflow that mails readers without this line.

Use, in a sender's main(), after its --selftest branch (so a selftest never prints one):

    tally = delivery_line.start("price-watch", dry=dry)
    tally.waiting = len(jobs)
    ...  tally.sent += 1  per reader email sent

The line prints when the script exits, on any return path, a sys.exit or a crash, and only when
the script that called start() is the program being run: a test that imports a sender and calls
its main() (scripts/test_zip_alert.py runs in elevator-watch.yml) prints no line, so no made-up
count reaches a sender's log. DELIVERY_LINE_OFF=1 turns it off by hand.

    python3 scripts/delivery_line.py --selftest
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass

import atexit
import os
import re
import sys

NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,40}$")
LINE_RE = re.compile(r"\bDELIVERY sender=([a-z0-9][a-z0-9-]{0,40})((?: [a-z_]{1,20}=\d{1,9})+)\s*$")
REQUIRED = ("sent_readers", "waiting", "dry")


class Tally:
    def __init__(self, sender, dry=False):
        if not NAME_RE.match(sender or ""):
            raise ValueError("bad sender name")
        self.sender, self.dry, self.sent, self.waiting = sender, bool(dry), 0, 0
        self.extra = {}
        self.printed = False

    def line(self):
        return line(self.sender, self.sent, self.waiting, self.dry, **self.extra)

    def emit(self):
        if self.printed:
            return
        self.printed = True
        try:
            print(self.line(), flush=True)
        except Exception:                                  # noqa: BLE001  never break the sender's exit
            pass


def line(sender, sent_readers, waiting, dry, **extra):
    """The line itself. Every value is a whole number; anything else is dropped."""
    parts = ["DELIVERY sender=%s" % sender, "sent_readers=%d" % max(0, int(sent_readers)),
             "waiting=%d" % max(0, int(waiting)), "dry=%d" % (1 if dry else 0)]
    for k in sorted(extra):
        v = extra[k]
        if re.match(r"^[a-z_]{1,20}$", k) and k not in REQUIRED and isinstance(v, int) and not isinstance(v, bool):
            parts.append("%s=%d" % (k, max(0, v)))
    return " ".join(parts)


def start(sender, dry=False, _caller=None):
    """A tally that prints its line when the process exits, when its caller is the program run."""
    t = Tally(sender, dry)
    caller = _caller or sys._getframe(1).f_code.co_filename
    if os.environ.get("DELIVERY_LINE_OFF") == "1" or not program_is(caller):
        return t          # counted, never printed
    atexit.register(t.emit)
    try:                  # count what reaches the mail server and mark a cap refusal (scripts/send_cap.py)
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import send_cap
        send_cap.install(t)
    except Exception:                                      # noqa: BLE001  never break a sender
        pass
    try:                  # leave out addresses suppressed after two hard bounces; save new ones (scripts/bounces.py)
        import list_source
        import bounces
        list_source.suppress_for(t)
        bounces.arm(sender)
    except Exception:                                      # noqa: BLE001  never break a sender
        pass
    return t


def program_is(path):
    return os.path.basename(path or "") == os.path.basename(sys.argv[0] if sys.argv else "")


def parse(text):
    """Every DELIVERY line in a log (Actions prefixes each line with a timestamp) -> list of dicts."""
    out = []
    for raw in (text or "").splitlines():
        m = LINE_RE.search(raw.rstrip("\r"))
        if not m:
            continue
        d = {"sender": m.group(1)}
        for kv in m.group(2).split():
            k, v = kv.split("=", 1)
            d[k] = int(v)
        if all(k in d for k in REQUIRED):
            out.append(d)
    return out


def selftest():
    fails = []

    def ck(what, cond, info=""):
        print(("ok   " if cond else "FAIL ") + what + ("" if cond else "  " + info))
        if not cond:
            fails.append(what)

    s = line("rp-design", 2, 3, False, asks=5)
    ck("line shape", s == "DELIVERY sender=rp-design sent_readers=2 waiting=3 dry=0 asks=5", s)
    ck("dry prints 1", line("x", 0, 1, True).endswith("dry=1"))
    ck("a non-number extra is dropped", line("x", 0, 0, False, who="a@b.c") == "DELIVERY sender=x sent_readers=0 waiting=0 dry=0")
    ck("a bool extra is dropped", "flag" not in line("x", 0, 0, False, flag=True))
    log = ("2026-11-03T12:00:01.1234567Z Design asks: 4.\n"
           "2026-11-03T12:00:02.1234567Z " + s + "\n"
           "2026-11-03T12:00:03.1234567Z ##[group]Run python3 scripts/x.py\n"
           "2026-11-03T12:00:04.1234567Z DELIVERY sender=y sent_readers=0 waiting=0\n")
    p = parse(log)
    ck("parse reads the line under a timestamp", p == [{"sender": "rp-design", "sent_readers": 2, "waiting": 3, "dry": 0, "asks": 5}], str(p))
    ck("parse skips a line without dry", len(p) == 1)
    ck("parse skips an address", parse("DELIVERY sender=x sent_readers=1 waiting=1 dry=0 to=a@b.c") == [])
    try:
        Tally("Bad Name")
        ck("a bad sender name is refused", False)
    except ValueError:
        ck("a bad sender name is refused", True)
    ck("the program itself arms the line", program_is(sys.argv[0]))
    ck("a sender imported by a test does not", not program_is("/x/send_zip_alert.py"))
    t = Tally("x", dry=True)
    t.sent, t.waiting = 1, 2
    ck("tally line", t.line() == "DELIVERY sender=x sent_readers=1 waiting=2 dry=1")
    print("delivery_line selftest: %d failed" % len(fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(selftest() if "--selftest" in sys.argv else 0)
