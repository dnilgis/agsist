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
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import smtplib
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import log_safe  # noqa: E402  (the real masker; only its mail is faked below)
import delivery_line  # noqa: E402  (the DELIVERY tally the loop reports its count to)
import send_pace  # noqa: E402  (the real pacer; the loop's sleeps go to the fake clock below)
import bounces  # noqa: E402  (hard bounces recorded in memory; nothing is saved by a test)

# (script, what its own loop calls the messages)
SENDERS = [
    ("check_alerts.py", "hail alerts"),
    ("send_daily.py", "daily briefings"),
    ("send_report_day.py", "report emails"),
    ("send_cot_weekly.py", "Funds this week emails"),
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


def run(body, fail_on=(), fail_with=OSError, n=6, login_fails=False, flag_raises=0, addresses=None, refuse=None):
    """Run one lifted loop against a fake server. Returns (rc, state).
    login_fails: the server refuses the login. flag_raises: the first N
    attempts to set the day flag raise (the worker down mid-send).
    addresses: the list (default n made-up ones). refuse: {address: [exception, ...]}, one raised
    per attempt to that address, in order (a deferral, then a success, and so on)."""
    state = {"sent": [], "connects": 0, "flagged": None, "printed": [], "owner": [], "released": [],
             "flag_calls": 0, "slept": [], "to": []}
    refuse = {k: list(v) for k, v in (refuse or {}).items()}

    class FakeSMTP:
        def __init__(self, *a, **k):
            state["connects"] += 1
        def starttls(self, **k): pass
        def login(self, *a):
            if login_fails:
                raise smtplib.SMTPAuthenticationError(535, b"5.7.8 Username and Password not accepted")
        def quit(self): pass
        def send_message(self, msg):
            pos = len(state["sent"]) + len(state.setdefault("_failed", []))
            to = getattr(msg, "to", None)
            if getattr(self, "closed", False):
                # smtplib after a 421: it closed the socket itself, and refuses before sending anything
                state["_failed"].append(pos)
                raise smtplib.SMTPServerDisconnected("please run connect() first")
            if to is not None and refuse.get(to):
                state["_failed"].append(pos)
                ex = refuse[to].pop(0)
                if getattr(ex, "smtp_code", None) == 421:
                    self.closed = True
                raise ex
            if pos in fail_on:
                state["_failed"].append(pos)
                raise fail_with("simulated failure")
            state["sent"].append(pos)
            state["to"].append(to)

    def flagger(day, set_it=False):
        state["flag_calls"] += 1
        if set_it and state["flag_calls"] <= flag_raises:
            raise OSError("worker unreachable")
        state["flagged"] = (day, set_it)

    addresses = list(addresses) if addresses is not None else ["w%d@example.com" % k for k in range(n)]

    class Msg:
        def __init__(self, to):
            self.to = to

    def build(*a, **k):
        # send_daily and the rest pass the address third; check_alerts passes the watcher first
        for x in a:
            if isinstance(x, dict) and "email" in x:
                return Msg(x["email"])
        return Msg(a[2] if len(a) > 2 else None)
    tally = delivery_line.Tally("loop-test")   # unregistered: prints nothing
    ns = {
        "tally": tally,
        "smtplib": type("S", (), {
            "SMTP": FakeSMTP,
            "SMTPServerDisconnected": smtplib.SMTPServerDisconnected,
            "SMTPConnectError": smtplib.SMTPConnectError,
            "SMTPException": smtplib.SMTPException,
            "SMTPRecipientsRefused": smtplib.SMTPRecipientsRefused,
        }),
        "ssl": type("C", (), {"create_default_context": staticmethod(lambda: None)}),
        "time": type("T", (), {"sleep": staticmethod(lambda s: state["slept"].append(s))}),
        "send_pace": send_pace,
        "host": "smtp.test", "port": 587, "user": "u", "pw": "p",
        "day": "2026-09-05", "from_name": "n", "from_addr": "a", "reply_to": "r",
        # check_alerts iterates `hits` of (watcher, band); send_daily iterates
        # `recipients` of addresses. Both are here, so whichever the lifted
        # body names, it finds — and neither script is edited to be testable.
        "hits": [({"email": a}, 2.0) for a in addresses],
        "recipients": list(addresses),
        "b": {},
        "build_email": build,
        "day_flag": flagger,
        "flag": flagger,
        "release_claim": lambda d: state["released"].append(d) or True,
        "print": lambda *a, **k: state["printed"].append(" ".join(str(x) for x in a)),
        # The private mail to the owner is captured, never sent; masking is real.
        "log_safe": type("L", (), {
            "mask": staticmethod(log_safe.mask),
            "mask_text": staticmethod(log_safe.mask_text),
            "owner_mail": staticmethod(
                lambda subject, lines: state["owner"].append((subject, list(lines))) or True),
        }),
        "isinstance": isinstance, "type": type, "len": len, "str": str,
        "enumerate": enumerate, "OSError": OSError, "Exception": Exception,
    }
    wrapped = "def _send():\n" + "\n".join("    " + ln for ln in body.splitlines())
    exec(compile(wrapped, "<lifted from %s>" % script, "exec"), ns)
    rc = ns["_send"]()
    state["tally"] = tally.sent
    return rc, state


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
    check(st["tally"] == 6, W("a clean run told the DELIVERY line %r sent, not 6" % st["tally"]))
    check(st["flagged"] == ("2026-09-05", True), W("a clean run did not flag the day"))
    check(st["connects"] == 1,
          W("a clean run opened %d connections; one is enough" % st["connects"]))

    # ── a dropped socket does not kill the run ────────────────────────────
    rc, st = run(body, fail_on=(2,), fail_with=OSError)
    check(st["flagged"] is not None,
          W("a dropped socket left the day UNFLAGGED — the rerun will re-mail "
            "everyone who already received this"))

    # ── and the rest of the list still gets its mail ──────────────────────
    check(st["tally"] == len(st["sent"]),
          W("after a drop the DELIVERY line says %r sent, the server got %d" % (st["tally"], len(st["sent"]))))
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
    # ...but the log and the annotation are PUBLIC: no full address in them.
    check("@example.com" not in out,
          W("a full subscriber address was printed to the public Actions log"))
    check("w***@e***.com" in out,
          W("the failed addresses are not even named masked in the annotation"))
    private = "\n".join("\n".join(ln) for _s, ln in st["owner"])
    check("w2@example.com" in private,
          W("the addresses that did not receive are not mailed to Sig, so they "
            "cannot be sent by hand"))

    # ── repeated drops do not loop forever ────────────────────────────────
    rc, st = run(body, fail_on=tuple(range(6)), fail_with=OSError, n=6)
    check(st["connects"] <= 4,
          W("a server refusing everything opened %d connections; the cap is 3"
            % st["connects"]))
    check(rc == 1, W("a run that sent nothing returned success"))
    check(st["flagged"] is None,
          W("a run that sent NOTHING flagged the day anyway — the mail would "
            "never go out at all"))

    # ── Nov 10, 2026: pacing, deferrals, hard bounces (scripts/send_pace.py) ──
    # Batches: 45 readers, batches of 20 -> the long pause after the 20th and the 40th email,
    # the short gap between the others, nothing after the last.
    rc, st = run(body, n=45)
    pauses = [s for s in st["slept"] if s >= send_pace.DEFAULT_PAUSE]
    check(len(st["sent"]) == 45 and len(pauses) == 2,
          W("45 readers: %d sent, %d batch pauses (expected 45 and 2)" % (len(st["sent"]), len(pauses))))
    check(len(st["slept"]) == 44, W("45 readers waited %d times; a wait between each pair, none after the last"
                                     % len(st["slept"])))
    check(sum(st["slept"]) <= send_pace.DEFAULT_MAX, W("the waiting went past the job's cap"))
    # One address once: a repeat on the list (any case) is not mailed twice.
    rc, st = run(body, addresses=["a@example.com", "b@example.com", "A@example.com ", "c@example.com"])
    check(len(st["sent"]) == 3, W("a list with one address twice mailed %d, not 3" % len(st["sent"])))
    # A deferral (4xx) is tried once more after the rest of the list, and is not a failure.
    soft = smtplib.SMTPRecipientsRefused({"w2@example.com": (450, b"4.2.1 try again later")})
    bounces.PENDING[:] = []
    rc, st = run(body, refuse={"w2@example.com": [soft]})
    check(len(st["sent"]) == 6 and st["to"][-1] == "w2@example.com",
          W("a deferred reader was not tried again at the end of the list (sent %d, last %r)"
            % (len(st["sent"]), st["to"][-1:] and "w2" in str(st["to"][-1:]))))
    check("::error::" not in "\n".join(st["printed"]),
          W("a deferral that went through on the second try was still reported as failed"))
    check(st["connects"] == 1, W("a deferral opened a new connection"))
    check(not bounces.PENDING, W("a soft bounce was recorded as a hard one"))
    # Deferred twice: one failure, still not a hard bounce, and never a third try.
    rc, st = run(body, refuse={"w2@example.com": [soft, soft]})
    check(len(st["sent"]) == 5 and "::error::" in "\n".join(st["printed"]),
          W("a reader deferred twice was not reported as one failure (sent %d)" % len(st["sent"])))
    check(not bounces.PENDING, W("a reader deferred twice was recorded as a hard bounce"))
    # A permanent refusal of the address: recorded once as a hard bounce, not retried, no address printed.
    hard = smtplib.SMTPRecipientsRefused({"w3@example.com": (550, b"5.1.1 The email account does not exist")})
    rc, st = run(body, refuse={"w3@example.com": [hard, hard]})
    check(len(st["sent"]) == 5 and len(bounces.PENDING) == 1 and bounces.PENDING[0]["h"] == bounces.key("w3@example.com"),
          W("a 550 5.1.1 was not recorded once as a hard bounce (sent %d, recorded %d)"
            % (len(st["sent"]), len(bounces.PENDING))))
    check("@example.com" not in "\n".join(st["printed"]) and "@" not in repr(bounces.PENDING),
          W("an address reached the public log or the bounce record"))
    # A spam or policy refusal (5.7.1) is about the message, not the address: not a hard bounce.
    bounces.PENDING[:] = []
    pol = smtplib.SMTPRecipientsRefused({"w4@example.com": (550, b"5.7.1 message rejected as spam")})
    rc, st = run(body, refuse={"w4@example.com": [pol]})
    check(not bounces.PENDING and len(st["sent"]) == 5, W("a 5.7.1 policy refusal was counted as a hard bounce"))
    check(any(ln.startswith("pacing: ") for ln in st["printed"]), W("the loop printed no pacing line"))
    # A 421 closes the connection inside smtplib: the next send is refused before anything goes out.
    # Both are tried again (after one reconnect); nobody loses their email to it.
    slow = smtplib.SMTPSenderRefused(421, b"4.7.0 Try again later, closing connection", "news@x")
    rc, st = run(body, refuse={"w2@example.com": [slow]})
    check(len(st["sent"]) == 6 and st["connects"] == 2 and "::error::" not in "\n".join(st["printed"]),
          W("after a 421 that closed the connection: %d of 6 sent, %d connections (expected 6 and 2)"
            % (len(st["sent"]), st["connects"])))

    # ── a run killed mid-list has already flagged the day (send_daily, Oct 28)
    # A published issue that never went out is written again by the next run,
    # and that run asks this flag. A cancel or a lost runner is not an
    # Exception, so it escapes the loop: the flag must already be set by then,
    # or the retry mails everyone who already had it.
    if script == "send_daily.py":
        # ── 2026-10-28 review: a backup-mode claim with nothing delivered is released
        rc, st = run(body, login_fails=True)
        check(rc == 1 and not st["sent"] and st["released"] == ["2026-09-05"],
              W("a refused SMTP login left the day's claim in place (rc %r, released %r); in backup mode the "
                "day then reads as sent and the retry never sends it" % (rc, st["released"])))
        rc, st = run(body, fail_on=tuple(range(6)), fail_with=OSError, n=6)
        check(st["released"] == ["2026-09-05"], W("a run that delivered nothing did not release the claim"))
        rc, st = run(body)
        check(st["released"] == [], W("a run that delivered mail released the day's claim"))
        # ── a flag set that raises is not "flagged": it is set again after the list
        rc, st = run(body, flag_raises=1)
        check(st["flagged"] == ("2026-09-05", True) and st["flag_calls"] == 2,
              W("the day flag failed after the first mail and was never set again (calls %d)" % st["flag_calls"]))

        def lifted_with_state():
            st = {"sent": [], "connects": 0, "flagged": None, "printed": [], "owner": [], "_failed": []}

            class FakeSMTP:
                def __init__(self, *a, **k):
                    st["connects"] += 1
                def starttls(self, **k): pass
                def login(self, *a): pass
                def quit(self): pass
                def send_message(self, msg):
                    if len(st["sent"]) == 3:
                        raise KeyboardInterrupt("runner cancelled")
                    st["sent"].append(len(st["sent"]))
            ns = {
                "smtplib": type("S", (), {"SMTP": FakeSMTP,
                                          "SMTPServerDisconnected": smtplib.SMTPServerDisconnected,
                                          "SMTPConnectError": smtplib.SMTPConnectError,
                                          "SMTPException": smtplib.SMTPException}),
                "ssl": type("C", (), {"create_default_context": staticmethod(lambda: None)}),
                "time": type("T", (), {"sleep": staticmethod(lambda s: None)}),
                "send_pace": send_pace,
                "host": "h", "port": 587, "user": "u", "pw": "p", "day": "2026-10-28",
                "from_name": "n", "from_addr": "a", "reply_to": "r", "b": {},
                "recipients": ["w%d@example.com" % k for k in range(6)],
                "build_email": lambda *a, **k: object(),
                "flag": lambda day, set_it=False: st.__setitem__("flagged", (day, set_it)) or True,
                "release_claim": lambda d: True,
                "print": lambda *a, **k: st["printed"].append(" ".join(str(x) for x in a)),
                "log_safe": type("L", (), {"mask_text": staticmethod(log_safe.mask_text),
                                           "owner_mail": staticmethod(lambda s, l: True)}),
            }
            wrapped = "def _send():\n" + "\n".join("    " + ln for ln in body.splitlines())
            exec(compile(wrapped, "<lifted from send_daily.py>", "exec"), ns)
            try:
                ns["_send"]()
            except KeyboardInterrupt:
                pass
            return st
        st = lifted_with_state()
        check(len(st["sent"]) == 3, W("the killed run sent %d before the cut, expected 3" % len(st["sent"])))
        check(st["flagged"] == ("2026-10-28", True),
              W("a run killed after 3 mails left the day UNFLAGGED; the next run's retry of a published, "
                "unsent issue would mail those 3 readers a second copy"))

if fails:
    for f in fails:
        print("FAIL: " + f)
    print("\n%d passed, %d failed" % (passes, len(fails)))
    sys.exit(1)
print("send loops: %d passed across %d senders — a dropped socket costs one email, "
      "not the tail of the list, and never a second blast to everyone"
      % (passes, len(SENDERS)))
