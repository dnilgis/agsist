#!/usr/bin/env python3
"""The Daily's DELIVERY line on every exit before the send, and what the delivery check makes of it.

    python3 scripts/test_daily_delivery_line.py

Nov 4 2026 (fx/delivblind checker): send_daily.py prints `sent_readers=0 waiting=0 dry=0` on every exit
before it counts the list: the held issue (v2_gate), the subs worker giving no link ids, no
recipients, a crash in fetch_subscribers. It printed the same line when the day was already sent,
and the delivery check counted that line as "sent", so a Daily that mailed nobody read green.

Now only the day-flag path adds already_sent=1. This drives send_daily.main() through each exit with
its helpers stubbed (no network, no mail, no list; the one address is a made-up example.invalid),
reads the line the run would print, and runs it through scripts/delivery_check.py's classifier as
the day's only send run: the already-sent run is the day sent, every other exit is (e) late.
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import contextlib
import io
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
os.environ["DELIVERY_LINE_OFF"] = "1"          # nothing this test runs prints a real line
for k in ("DRY_RUN", "TEST_TO_SIG"):
    os.environ.pop(k, None)

import delivery_line  # noqa: E402
import delivery_check  # noqa: E402
import send_daily  # noqa: E402

fails, passes = [], 0


def check(cond, msg):
    global passes
    if cond:
        passes += 1
    else:
        fails.append(msg)


def run_main(**stubs):
    """send_daily.main() with stubs; -> (the tally's line, return code or the exception's name)."""
    made = []
    real_start = delivery_line.start

    def start(sender, dry=False, _caller=None):
        t = delivery_line.Tally(sender, dry)
        made.append(t)
        return t
    base = {"load_today": lambda: ("2026-11-04", {}), "flag": lambda day, set_it=False: False,
            "daily_format": lambda: "current"}
    base.update(stubs)
    saved = {k: getattr(send_daily, k) for k in base}
    saved_addr = send_daily.log_safe.sender_addr
    delivery_line.start = start
    send_daily.log_safe.sender_addr = lambda: "sender@example.invalid"
    for k, v in base.items():
        setattr(send_daily, k, v)
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            try:
                rc = send_daily.main()
            except Exception as ex:                        # noqa: BLE001  the crash is the case
                rc = type(ex).__name__
    finally:
        delivery_line.start = real_start
        send_daily.log_safe.sender_addr = saved_addr
        for k, v in saved.items():
            setattr(send_daily, k, v)
    return (made[0].line() if made else None), rc


def judged(line):
    """The row the delivery check gives a day whose only send run printed `line`."""
    e = next(x for x in delivery_check.SENDERS if x["workflow"] == "daily.yml")
    runs = [{"id": 7, "event": "schedule", "created_at": "2026-11-04T11:46:00Z", "steps": {"Send daily email": "ran"},
             "lines": delivery_line.parse(line), "log": "read"}]
    due = {"kind": "daily", "day": "2026-11-04", "due_ct": "07:15", "window_ct": "04:30 to 14:00", "past_due": True,
           "window_runs": [7], "short_runs": [], "running": []}
    return delivery_check.classify(e, runs, 1, {"daily": ("on", "no switch")}, due=due)


def crash():
    raise RuntimeError("worker down")


READER = [{"email": "reader@example.invalid"}]
CASES = [
    ("already sent today (the day flag set)", {"flag": lambda day, set_it=False: True}, 0, True),
    ("the v2 number check held the issue", {"daily_format": lambda: "v2", "v2_gate": lambda day, b, alert=False: False}, 1, False),
    ("the subs worker gave no link ids", {"fetch_subscribers": lambda: (READER, "json")}, 1, False),
    ("the list parsed to zero recipients", {"fetch_subscribers": lambda: ([], "plain")}, 1, False),
    ("fetch_subscribers crashed", {"fetch_subscribers": crash}, "RuntimeError", False),
]
real_ids = send_daily.email_links.link_ids
send_daily.email_links.link_ids = lambda subs: {}
try:
    for name, stubs, want_rc, is_sent in CASES:
        line, rc = run_main(**stubs)
        check(rc == want_rc, "%s: main() returned %r, expected %r" % (name, rc, want_rc))
        check(line is not None and line.startswith("DELIVERY sender=daily sent_readers=0 waiting=0 dry=0"),
              "%s: line %r" % (name, line))
        check(("already_sent=1" in (line or "")) == is_sent, "%s: already_sent on the line is %s" % (name, not is_sent))
        row = judged(line or "")
        if is_sent:
            check(row["status"] == "ok" and "sent by run 7" in row["why"], "%s: the check reads %s" % (name, row["why"]))
        else:
            check(row["status"] == "late" and "(e) 2026-11-04" in row["why"] and "ended with 0 sent" in row["why"],
                  "%s: the check must read it as no send, got %s: %s" % (name, row["status"], row["why"]))
finally:
    send_daily.email_links.link_ids = real_ids

# and a real send is the day sent
row = judged("DELIVERY sender=daily sent_readers=208 waiting=208 dry=0")
check(row["status"] == "ok", "a send to 208 readers: %s" % row["why"])

for f in fails:
    print("FAIL " + f)
print("test_daily_delivery_line: %d passed, %d failed" % (passes, len(fails)))
sys.exit(1 if fails else 0)
