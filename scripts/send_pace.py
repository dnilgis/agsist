#!/usr/bin/env python3
"""
send_pace.py: every list sender walks its list through one Pacer (Nov 10, 2026).

Big sends to one mailbox provider at once draw deferrals (soft bounces), and repeat sends to dead
addresses hurt the sender's standing. So every loop that mails a list:

  * sends in batches: SEND_BATCH emails (default 20), SEND_BATCH_PAUSE seconds between batches
    (default 4), and the sender's own short gap between two emails inside a batch (1.2 or 1.5 s,
    SEND_GAP overrides it);
  * keeps the whole run inside its job: the planned waiting is capped at SEND_PACE_MAX seconds
    (default 600), and when a long list would need more, every gap shrinks by the same share;
  * mails one address once: a repeat of an address (or, for a watch, of the same job) is left out;
  * tries a temporary refusal (an SMTP 4xx for that address: a deferral, a busy server) once more
    after the rest of the list, after SEND_RETRY_WAIT seconds (default 60, inside the cap). A soft
    refusal is never a hard bounce;
  * records a hard bounce (scripts/bounces.py) only for a refusal of the recipient itself (RCPT)
    with status 5.1.1, 5.1.2, 5.1.3, 5.1.6, 5.1.10 or 5.2.1, or a 550, 551 or 553 with no status
    whose text says the user or mailbox does not exist. Everything else (other 5.x.x statuses,
    blocks, relays, policy, a sender or DATA refusal) is never charged to a reader. Two hard
    bounces on different days leave an address out of every list.
  * the retry pass starts on a new connection, and every deferred reader who never got a second
    try (the loop stopped first) goes on the failed list.

A dropped socket still costs one email: the loops keep their own reconnect logic, and a Pacer never
sends anything itself. DRY_RUN=1 makes it skip every wait (a dry run sends nothing to wait for).

Use, in a send loop:

    pace = send_pace.Pacer(recipients, sleep=time.sleep)
    for i, r in enumerate(pace):
        conn = pace.fresh(conn, connect)   # the retry pass starts on a new connection
        try:
            conn.send(...)                 # the sender's own send
        except Exception as ex:
            if not pace.defer(ex):         # True: tried once more at the end of the list
                failed.append(...)
            ... reconnect when the socket died and pace.more() ...
        pace.after()                       # the gap, or the pause at a batch boundary
    failed += pace.unsent_addresses()      # deferred, never tried again: on the resend list

Counts only in the log, never an address. scripts/test_send_pace.py tests it and checks that every
loop that mails a list goes through it.

    python3 scripts/send_pace.py --selftest
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass

import math
import os
import re
import smtplib
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

DEFAULT_BATCH = 20
DEFAULT_PAUSE = 4.0
DEFAULT_RETRY_WAIT = 60.0
DEFAULT_MAX = 600.0
# Each setting's sane range; anything else (not a number, inf, nan, out of range) is the default, with a warning.
RANGES = {"SEND_BATCH": (1, 1000), "SEND_GAP": (0.0, 30.0), "SEND_BATCH_PAUSE": (0.0, 300.0),
          "SEND_RETRY_WAIT": (0.0, 900.0), "SEND_PACE_MAX": (1.0, 3600.0)}
WARNED = set()

# An enhanced status code in a reply ("550 5.1.1 The email account does not exist").
STATUS_RE = re.compile(r"\b([245])\.(\d{1,3})\.(\d{1,3})\b")
# What a hard bounce is, and nothing more: the address or its domain does not exist, or the mailbox
# is disabled. Every other permanent status (5.0.0, 5.2.2, 5.2.3, 5.3.x, 5.4.x, 5.5.x, 5.6.x, 5.7.x)
# is about the message, the sender, the route or a policy, and is never charged to a reader.
HARD_STATUS = frozenset(("5.1.1", "5.1.2", "5.1.3", "5.1.6", "5.1.10", "5.2.1"))
# A permanent reply with no status counts only as 550, 551 or 553 whose text says the user or the
# mailbox does not exist, and never when it names a block, a list, spam, a relay or a policy.
NO_SUCH = re.compile(r"\b(?:user|mailbox|recipient|account|address)\b[^.\n]{0,30}?"
                     r"\b(?:unknown|does ?n[o']t exist|not exist|not found|no such)"
                     r"|\b(?:unknown|no such|nonexistent|non-existent|invalid)\s+(?:user|mailbox|recipient|account|address)\b"
                     r"|\bno mailbox\b", re.I)
NOT_ADDRESS = re.compile(r"block|listed|spam|reputation|relay|policy|auth|abuse|blacklist|dnsbl|rbl|rate|limit|quota"
                         r"|suspend|verif|disabled|inactive|locked|over ?quota|exceed", re.I)


def _num(environ, name, default, lo=None):
    raw = str(environ.get(name) or "").strip()
    if not raw:
        return default
    lo_, hi = RANGES.get(name, (lo if lo is not None else 0.0, float("inf")))
    try:
        v = float(raw)
    except ValueError:
        v = None
    ok = v is not None and math.isfinite(v) and lo_ <= v <= hi and (name != "SEND_BATCH" or v == int(v))
    if ok:
        return v
    if name not in WARNED:
        WARNED.add(name)
        print("::warning::%s is not a usable value (%s to %s); using the default %s" % (name, lo_, hi, default))
    return default


def _text(t):
    return t.decode("utf-8", "replace") if isinstance(t, bytes) else str(t or "")


def address(item):
    """The address an item of a send list mails: a string, the first part of a tuple, or a record's email."""
    if isinstance(item, str):
        return item
    if isinstance(item, dict):
        return str(item.get("email") or "")
    if isinstance(item, (tuple, list)) and item:
        return address(item[0])
    return ""


def status_is_hard(status):
    """A delivery-status code (5.1.1) that is a hard bounce. 4.x.x (a delay, an expired try) never is."""
    return str(status or "").strip() in HARD_STATUS


def kind_of(code, text, recipient=False):
    """'hard', 'soft' or None for one SMTP reply. recipient: the reply refused the RCPT itself; only
    such a reply can be a hard bounce (a sender or DATA refusal is never charged to a reader)."""
    try:
        code = int(code)
    except (TypeError, ValueError):
        return None
    if 400 <= code < 500:
        return "soft"
    if not 500 <= code < 600 or not recipient:
        return None
    t = _text(text)
    m = STATUS_RE.search(t)
    if m:
        return "hard" if status_is_hard(m.group(0)) else None
    if code in (550, 551, 553) and NO_SUCH.search(t) and not NOT_ADDRESS.search(t):
        return "hard"
    return None


def classify(ex, addr=""):
    """('hard'|'soft'|None, 'code status') for an exception from one send to `addr`."""
    if isinstance(ex, smtplib.SMTPRecipientsRefused):
        rec = getattr(ex, "recipients", None)
        if not isinstance(rec, dict) or not rec:
            return None, ""
        a = (addr or "").strip().lower()
        hit = next((v for k, v in rec.items() if str(k).strip().lower() == a), None)
        if hit is None and len(rec) == 1:
            hit = next(iter(rec.values()))
        try:
            code, text = hit
        except (TypeError, ValueError):
            return None, ""
        k = kind_of(code, text, recipient=True)
        m = STATUS_RE.search(_text(text))
        return k, ("%s %s" % (code, m.group(0) if m else "")).strip()
    if isinstance(ex, smtplib.SMTPServerDisconnected) and "run connect() first" in str(ex):
        # smtplib closed the connection itself (a 421 before this send), so nothing of this message
        # went out: safe to try again later. Any other drop may have delivered it: a failure, never a retry.
        return "soft", "421"
    if isinstance(ex, (smtplib.SMTPConnectError, smtplib.SMTPHeloError, smtplib.SMTPAuthenticationError)):
        return None, ""
    if isinstance(ex, smtplib.SMTPResponseException):
        # a sender or DATA refusal: a 4xx is tried again later; a 5xx is a failure, never a hard bounce
        code, text = getattr(ex, "smtp_code", None), getattr(ex, "smtp_error", "")
        k = kind_of(code, text, recipient=False)
        m = STATUS_RE.search(_text(text))
        return k, ("%s %s" % (code, m.group(0) if m else "")).strip()
    return None, ""


class Pacer:
    def __init__(self, items, gap=1.2, sleep=time.sleep, key=None, addr=None, environ=None, sender=""):
        env = os.environ if environ is None else environ
        self.batch = int(_num(env, "SEND_BATCH", DEFAULT_BATCH))
        self.gap = _num(env, "SEND_GAP", float(gap))
        self.pause = max(self.gap, _num(env, "SEND_BATCH_PAUSE", DEFAULT_PAUSE))
        self.retry_wait = _num(env, "SEND_RETRY_WAIT", DEFAULT_RETRY_WAIT)
        self.budget = _num(env, "SEND_PACE_MAX", DEFAULT_MAX)
        self.dry = str(env.get("DRY_RUN") or "").strip().lower() in ("1", "true", "yes")
        self._sleep_fn = sleep
        self._addr = addr or address
        self.sender = sender
        keyf = key or (lambda it: self._addr(it).strip().lower())
        seen, self.items, self.repeats = set(), [], 0
        for it in items or []:
            k = keyf(it)
            if k in seen:
                self.repeats += 1
                continue
            seen.add(k)
            self.items.append(it)
        n = len(self.items)
        bounds = max(0, (n - 1) // self.batch)
        planned = self.gap * max(0, n - 1 - bounds) + self.pause * bounds
        self.scale = 1.0
        if planned > self.budget:
            self.scale = self.budget / planned
            self.gap *= self.scale
            self.pause *= self.scale
        self.deferred, self.waiting, self.passno, self.left, self.done, self.current = [], [], 1, 0, 0, None
        self.slept, self.soft, self.soft_final, self.hard, self.refreshed = 0.0, 0, 0, 0, False

    def __len__(self):
        return len(self.items)

    def _sleep(self, s):
        """Wait s seconds, never past the cap on this run's waiting (SEND_PACE_MAX)."""
        s = min(s, self.budget - self.slept)
        if s <= 0 or self.dry:
            return
        self.slept += s
        self._sleep_fn(s)

    def __iter__(self):
        first = list(self.items)
        for idx, it in enumerate(first):
            self.left, self.current = len(first) - idx - 1, it
            yield it
        if self.deferred:
            self.waiting, self.deferred = self.deferred, []
            self.passno = 2
            self._sleep(self.retry_wait)
            while self.waiting:
                it = self.waiting.pop(0)
                self.left, self.current = len(self.waiting), it
                yield it
        self.left = 0

    def more(self):
        """Anything still to send after this one (a later retry counts)."""
        return self.left > 0 or (self.passno == 1 and bool(self.deferred))

    def after(self):
        """The wait after one send: the gap, or the batch pause every `batch` emails. None after the last."""
        self.done += 1
        if self.left <= 0:
            return
        self._sleep(self.pause if self.done % self.batch == 0 else self.gap)

    def fresh(self, conn, connect):
        """Call at the top of the loop: the first retry gets a new connection (the old one sat idle
        through the wait, or died). The old one stays when a new one cannot be had."""
        if self.passno != 2 or self.refreshed:
            return conn
        self.refreshed = True
        try:
            new = connect()
        except Exception:                                  # noqa: BLE001  the send then fails as before
            return conn
        try:
            conn.quit()
        except Exception:                                  # noqa: BLE001
            pass
        return new

    def unsent(self):
        """Deferred items never tried again (the loop stopped first): for the failed list."""
        return list(self.deferred) + list(self.waiting)

    def unsent_addresses(self):
        return [self._addr(it) for it in self.unsent()]

    def defer(self, ex, item=None):
        """True when `ex` was a temporary refusal of this address and the item (the one being sent)
        will be tried once more at the end of the list. A permanent refusal of the address is
        recorded as a hard bounce."""
        item = self.current if item is None else item
        a = self._addr(item)
        k, code = classify(ex, a)
        if k == "hard":
            self.hard += 1
            try:
                import bounces
                bounces.record(a, code, self.sender)
            except Exception:                              # noqa: BLE001  never break a send
                pass
            return False
        if k == "soft":
            if self.passno == 1:
                self.soft += 1
                self.deferred.append(item)
                return True
            self.soft_final += 1
        return False

    def line(self):
        """One log line, counts only."""
        return ("pacing: %d to mail in batches of %d, %.1f s between batches, %.1f s apart%s; "
                "%d repeat(s) left out, %d deferred and tried again, %d deferred twice, %d hard bounce(s)"
                % (len(self.items), self.batch, self.pause, self.gap,
                   " (shortened to fit %d s)" % self.budget if self.scale < 1 else "",
                   self.repeats, self.soft, self.soft_final, self.hard))


def selftest():
    import test_send_pace
    return test_send_pace.main()


if __name__ == "__main__":
    sys.exit(selftest() if "--selftest" in sys.argv else 0)
