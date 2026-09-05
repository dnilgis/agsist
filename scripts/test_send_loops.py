#!/usr/bin/env python3
"""NEITHER SENDER MAY RE-MAIL THE WHOLE LIST WHEN ONE SOCKET DROPS.

    python3 scripts/test_send_loops.py

TWO LOOPS, ONE GUARD, AND THE REASON IS THAT THEY ALREADY DRIFTED APART.

scripts/send_daily.py and scripts/check_alerts.py send by the same loop. Both
sent each message inside `except smtplib.SMTPException`. A socket timeout, an
SSLError and a reset connection are none of those: they escaped the loop, the
step died, and the day flag -- which sits AFTER the loop -- was never set. The
rerun then mailed everyone who had already received it.

That is how AGSIST Daily #177 went out seven times in one afternoon.
send_daily.py was widened afterwards. check_alerts.py was not, and stayed that
way for weeks, because nothing checked the pair.

And the quieter half, which was in both: ONE SMTP connection served the entire
list, so a drop at recipient N meant everyone after N silently received nothing
while `sent > 0` still flagged the day as delivered and a rerun refused. The
only trace was a log line nobody reads until someone asks why they never got
the briefing.

HOW IT IS TESTED

Each send loop is LIFTED OUT OF ITS SCRIPT by its own source text and run
against a fake server that fails on demand. Nothing is copied here, so this
cannot pass against a loop a script no longer has -- and it needs neither
shapely nor a network.
"""
import smtplib
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# (script, what its own loop calls the messages)
SENDERS = [
    ("check_alerts.py", "hail alerts"),
    ("send_daily.py", "daily briefings"),
]

START = "    sent, failed = 0, []"
END = "    return 0 if sent > 0 else 1"

fails = []
passes = 0


def check(cond, msg):
    global passes
    if cond:
        passes += 1
    else:
        fails.append(msg)


def lift(script):
    """Cut the send loop out of the script by its own source text."""
    src = (ROOT / "scripts" / script).read_text(encoding="utf-8")
    i, j = src.find(START), src.find(END)
    if i < 0 or j <= i:
        check(False, "%s: the send loop is no longer delimited by "
                     "`sent, failed = 0, []` ... `return 0 if sent > 0 else 1`" % script)
        return None
    return src[i:j + len(END)]


def run(body, fail_on=(), fail_with=OSError, n=6):
    """Run one lifted loop against a fake server. Returns (rc, state)."""
    state = {"sent": [], "connects": 0, "flagged": None, "printed": []}

    class FakeSMTP:
        def __init__(self, *a, **k):
            state["connects"] += 1
        def starttls(self, **k): pass
        def login(self, *a): pass
        def quit(self): pass
        def send_message(self, msg):
            pos = len(state["sent"]) + len(state.setdefault("_failed", []))
            if pos in fail_on:
                state["_failed"].append(pos)
                raise fail_with("simulated failure")
            state["sent"].append(pos)

    def flagger(day, set_it=False):
        state["flagged"] = (day, set_it)

    addresses = ["w%d@example.com" % k for k in range(n)]
    ns = {
        "smtplib": type("S", (), {
            "SMTP": FakeSMTP,
            "SMTPServerDisconnected": smtplib.SMTPServerDisconnected,
            "SMTPConnectError": smtplib.SMTPConnectError,
            "SMTPException": smtplib.SMTPException,
            "SMTPRecipientsRefused": smtplib.SMTPRecipientsRefused,
        }),
        "ssl": type("C", (), {"create_default_context": staticmethod(lambda: None)}),
        "time": type("T", (), {"sleep": staticmethod(lambda s: None)}),
        "host": "smtp.test", "port": 587, "user": "u", "pw": "p",
        "day": "2026-09-05", "from_name": "n", "from_addr": "a", "reply_to": "r",
        # check_alerts iterates `hits` of (watcher, band); send_daily iterates
        # `recipients` of addresses. Both are here, so whichever the lifted
        # body names, it finds — and neither script is edited to be testable.
        "hits": [({"email": a}, 2.0) for a in addresses],
        "recipients": list(addresses),
        "b": {},
        "build_email": lambda *a, **k: object(),
        "day_flag": flagger,
        "flag": flagger,
        "print": lambda *a, **k: state["printed"].append(" ".join(str(x) for x in a)),
        "isinstance": isinstance, "type": type, "len": len, "str": str,
        "enumerate": enumerate, "OSError": OSError, "Exception": Exception,
    }
    wrapped = "def _send():\n" + "\n".join("    " + ln for ln in body.splitlines())
    exec(compile(wrapped, "<lifted from %s>" % script, "exec"), ns)
    return ns["_send"](), state


for script, plural in SENDERS:
    body = lift(script)
    if body is None:
        continue
    W = lambda m: script + ": " + m

    # The narrow catch must be gone and the wide one present — checked on the
    # LIFTED bytes, so a copy of the right words elsewhere cannot satisfy it.
    check("except smtplib.SMTPException" not in body,
          W("the loop still catches only smtplib.SMTPException — a socket timeout "
            "escapes it and the day flag below is never set, so the rerun re-mails "
            "everyone who already received this"))
    check("except Exception as ex:" in body,
          W("the loop no longer catches Exception per recipient"))

    # ── a clean run is unchanged ──────────────────────────────────────────
    rc, st = run(body)
    check(rc == 0, W("a clean run no longer returns 0"))
    check(len(st["sent"]) == 6, W("a clean run sent %d of 6" % len(st["sent"])))
    check(st["flagged"] == ("2026-09-05", True), W("a clean run did not flag the day"))
    check(st["connects"] == 1,
          W("a clean run opened %d connections; one is enough" % st["connects"]))

    # ── a dropped socket does not kill the run ────────────────────────────
    rc, st = run(body, fail_on=(2,), fail_with=OSError)
    check(st["flagged"] is not None,
          W("a dropped socket left the day UNFLAGGED — the rerun will re-mail "
            "everyone who already received this"))

    # ── and the rest of the list still gets its mail ──────────────────────
    check(len(st["sent"]) == 5,
          W("only %d of the other 5 were sent to after a mid-list drop — one "
            "connection with no reconnect silently skips the tail of the list"
            % len(st["sent"])))
    check(st["connects"] == 2,
          W("the loop opened %d connections; a fatal drop must reconnect exactly "
            "once" % st["connects"]))

    # ── a refused address is not a dead socket ────────────────────────────
    # smtplib.SMTPException inherits from OSError in Python 3, so a careless
    # isinstance(ex, OSError) reconnects for every typo in the list.
    rc, st = run(body, fail_on=(2,), fail_with=smtplib.SMTPRecipientsRefused)
    check(st["connects"] == 1,
          W("a refused recipient opened %d connections; only a connection-level "
            "failure should reconnect — note that SMTPException IS an OSError"
            % st["connects"]))
    check(len(st["sent"]) == 5, W("a refused recipient cost more than its own email"))

    # ── failures are reported loudly, not logged quietly ──────────────────
    out = "\n".join(st["printed"])
    check("::error::" in out,
          W("a partial send printed no ::error:: annotation — the day is flagged, "
            "so a rerun will not retry these and nobody will know they are missing"))
    check("w2@example.com" in out,
          W("the addresses that did not receive are not named, so they cannot be "
            "sent by hand"))

    # ── repeated drops do not loop forever ────────────────────────────────
    rc, st = run(body, fail_on=tuple(range(6)), fail_with=OSError, n=6)
    check(st["connects"] <= 4,
          W("a server refusing everything opened %d connections; the cap is 3"
            % st["connects"]))
    check(rc == 1, W("a run that sent nothing returned success"))
    check(st["flagged"] is None,
          W("a run that sent NOTHING flagged the day anyway — the mail would "
            "never go out at all"))

if fails:
    for f in fails:
        print("FAIL: " + f)
    print("\n%d passed, %d failed" % (passes, len(fails)))
    sys.exit(1)
print("send loops: %d passed across %d senders — a dropped socket costs one email, "
      "not the tail of the list, and never a second blast to everyone"
      % (passes, len(SENDERS)))
