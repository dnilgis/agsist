#!/usr/bin/env python3
"""
Watch a price target: the sender. Runs in Actions (fetch_prices.yml, a step
after the price pull, continue-on-error -- a failure here must not cost the
price fetch).

Same shape as send_elevator_watch.py and send_watch.py (double opt-in,
HMAC-signed links, a parallel KV prefix so nothing here can touch the two
systems that already work), but a different lifecycle: a price target is
ONE-SHOT, like a resting limit order. It fires once when the current close
crosses the target in the stated direction, mails exactly one email, then
tells the worker to remove it (`fired: true`) -- it never re-arms and never
mails again for the same alert.

Unlike watch-an-elevator, this job never has to recompute an id to match
against -- the worker already stores the full alert (symbol, direction,
target_cents, label) alongside its pid, since there is no canonical
real-world table a price-target hash could be re-derived from the way a
wid can be re-derived from today's basis board. /price-watch-list hands
back everything this job needs; it only has to read data/prices.json and
compare.

Rules: never invent a price; one mark per message, written right after
that message is sent, so a rerun cannot re-mail anyone; a send failure
never marks. Transport env, worker env, DRY_RUN and MAX_SENDS: identical
to send_elevator_watch.py.
"""
import hashlib
import hmac
import html as H
import json
import os
import smtplib
import ssl
import sys
import time
import urllib.parse
import urllib.request
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PRICES_FILE = REPO / "data" / "prices.json"
SITE = "https://agsist.com"
ADDRESS = "AGSIST, PO Box 243, Chetek, WI 54728"
PEND_TTL_MS = 14 * 864e5

# The only symbols a reader can set a price alert on -- real, already-fetched
# contracts with a visible price card on the homepage. Never widen this by
# guessing a key exists; add one here only once it is confirmed live in
# data/prices.json AND has a real display label below.
ALLOWED_SYMBOLS = {
    "corn":      "Corn",
    "corn-dec":  "Corn (new crop)",
    "beans":     "Soybeans",
    "beans-nov": "Soybeans (new crop)",
    "wheat":     "Wheat",
    "cattle":    "Live Cattle",
}


def env(name, default=None):
    v = os.environ.get(name)
    return v if v not in (None, "") else default


def token(secret, email, tail):
    """Same as the worker's hmac16: HMAC-SHA256 of the lowercased string, first 16 hex."""
    return hmac.new(secret.encode(), (email + tail).lower().encode(), hashlib.sha256).hexdigest()[:16]


def link(base, path, email, pid, secret, kind):
    tail = {"c": "|pc|" + pid, "w1": "|pw|" + pid, "w": "|pw"}[kind]
    q = "e=" + urllib.parse.quote(email.lower())
    if kind in ("c", "w1"):
        q += "&p=" + pid
    return f"{base}/{path}?{q}&t={token(secret, email, tail)}"


def load_quotes():
    if not PRICES_FILE.is_file():
        return {}
    try:
        d = json.loads(PRICES_FILE.read_text())
    except Exception:
        return {}
    return d.get("quotes") or {}


def fmt_price(cents):
    """cents is data/prices.json's own unit (501.25 == $5.0125, rounds to
    the $5.01 the homepage shows) -- not dollars, nothing here rescales it."""
    if cents is None:
        return "not published"
    return f"${cents / 100:.2f}"


def hit(direction, close_cents, target_cents):
    if direction == "above":
        return close_cents >= target_cents
    if direction == "below":
        return close_cents <= target_cents
    return False


def base_msg(to, subject, from_name, from_addr, reply_to, stop_url):
    m = EmailMessage()
    m["Subject"] = subject
    m["From"] = formataddr((from_name, from_addr))
    m["To"] = to
    m["Message-ID"] = make_msgid(domain=from_addr.split("@", 1)[1])
    if reply_to:
        m["Reply-To"] = reply_to
    m["List-Unsubscribe"] = "<" + stop_url + ">"
    m["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"
    return m


def html_wrap(title, paras, button=None, foot=""):
    e = H.escape
    body = "".join(f'<p style="font-size:14px;line-height:1.6;margin:0 0 12px">{e(p)}</p>' for p in paras)
    btn = (f'<p style="margin:18px 0"><a href="{H.escape(button[1])}" style="background:#14100a;color:#e9dfc9;'
           f'text-decoration:none;display:inline-block;padding:13px 20px;font-family:Courier,monospace;font-size:14px">{e(button[0])}</a></p>') if button else ""
    return ('<div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;padding:24px 16px;color:#1a1a1a;background:#fff">'
            f'<h1 style="font-size:20px;line-height:1.3;margin:0 0 12px">{e(title)}</h1>{body}{btn}'
            f'<p style="font-size:12px;color:#6b6b6b;line-height:1.5">{foot}</p></div>')


def confirm_email(w, pid, label, base, secret, fn, fa, rt):
    go = link(base, "price-watch-confirm", w, pid, secret, "c")
    stop = link(base, "price-watch-unsubscribe", w, pid, secret, "w1")
    m = base_msg(w, f"Confirm: price alert for {label}", fn, fa, rt, stop)
    m.set_content(f"Someone asked to set a price alert on AGSIST for {label} using this address.\n\n"
                  f"If that was you, confirm here:\n{go}\n\n"
                  "You'll get one email the day it crosses your price, then the alert clears itself.\n"
                  "If it was not you, ignore this email. Nothing starts until you confirm.\n\n"
                  f"--\n{ADDRESS}\nNo more emails about this alert: {stop}\n")
    foot = f'{H.escape(ADDRESS)}<br><a href="{H.escape(stop)}" style="color:#6b6b6b">Not me / stop</a>'
    m.add_alternative(html_wrap(f"Confirm: price alert for {label}", [
        f"Someone asked to set a price alert on AGSIST for {label} using this address.",
        "If that was you, confirm below. You'll get one email the day it crosses your price, then the alert clears itself.",
        "If it was not you, ignore this. Nothing starts until you confirm."], ("CONFIRM", go), foot), subtype="html")
    return m


def hit_email(w, pid, label, close_cents, base, secret, fn, fa, rt):
    stopall = link(base, "price-watch-unsubscribe", w, pid, secret, "w")
    m = base_msg(w, f"{label} -- now {fmt_price(close_cents)}", fn, fa, rt, stopall)
    line = f"{label}: now {fmt_price(close_cents)}, so your alert fired."
    m.set_content(f"{line}\n\n"
                  "This alert has done its job and is now cleared -- it will not fire again. "
                  "Set a new one any time from the homepage.\n\n"
                  "This is the futures price, not a cash bid at any one elevator -- your local "
                  "basis still applies. Check Cash Bids for what your elevator is actually paying.\n\n"
                  f"Full market prices:\n{SITE}/corn-futures-prices\n\n"
                  f"--\n{ADDRESS}\nThis alert is already cleared. Cancel all your other price alerts: {stopall}\n")
    foot = (f'{H.escape(ADDRESS)}<br>This alert is already cleared. '
            f'<a href="{H.escape(stopall)}" style="color:#6b6b6b">Cancel all price alerts</a>')
    m.add_alternative(html_wrap(f"{label}: price alert hit", [
        line, "This alert has done its job and is now cleared. Set a new one any time from the homepage.",
        "This is the futures price, not a cash bid at any one elevator -- check Cash Bids for your local basis."],
        ("SEE ALL MARKET PRICES", SITE + "/corn-futures-prices"), foot), subtype="html")
    return m


def plan(watchers, quotes, now_ms):
    """Pure: what to do. Returns (confirms, fires).
    confirms  [(email, pid, label)]
    fires     [(email, pid, label, close_cents)]"""
    confirms, fires = [], []
    for r in watchers:
        e = r["email"]
        for p, pend in (r.get("pend") or {}).items():
            if not pend.get("m") and now_ms - pend.get("ts", 0) <= PEND_TTL_MS:
                confirms.append((e, p, pend.get("label") or "this alert"))
        for p, w in (r.get("w") or {}).items():
            symbol = w.get("symbol")
            q = quotes.get(symbol)
            if not q or q.get("close") is None:
                continue
            if hit(w.get("direction"), q["close"], w.get("target_cents")):
                fires.append((e, p, w.get("label") or "this alert", q["close"]))
    return confirms, fires


def worker(base, path, token_, body=None):
    url = f"{base}/{path}{'&' if '?' in path else '?'}token={urllib.parse.quote(token_)}"
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", "User-Agent": "agsist-price-watch/1"},
                                 method="POST" if body is not None else "GET")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def selftest():
    assert fmt_price(None) == "not published"
    assert fmt_price(450) == "$4.50"
    assert fmt_price(1294.0) == "$12.94"

    assert hit("above", 450, 450) is True       # at the target counts as hit
    assert hit("above", 449, 450) is False
    assert hit("below", 450, 450) is True
    assert hit("below", 451, 450) is False
    assert hit("sideways", 500, 450) is False   # unknown direction never fires

    W = [
        {"email": "a@x.com",
         "pend": {"pA": {"ts": 1000, "m": 0, "label": "Corn above $4.50"},
                  "pMailed": {"ts": 1000, "m": 1, "label": "Already sent"}},
         "w": {"pB": {"symbol": "corn-dec", "direction": "above", "target_cents": 450, "label": "Corn (new crop) above $4.50"},
               "pC": {"symbol": "beans-nov", "direction": "below", "target_cents": 1300, "label": "Soybeans (new crop) below $13.00"},
               "pGone": {"symbol": "not-a-real-symbol", "direction": "above", "target_cents": 1, "label": "No data for this one"}}},
    ]
    quotes = {
        "corn-dec": {"close": 517.5},     # above 450 -> fires
        "beans-nov": {"close": 1260.75},  # below 1300 -> fires
    }
    cf, fr = plan(W, quotes, 2000)
    assert cf == [("a@x.com", "pA", "Corn above $4.50")], cf   # pMailed already mailed
    fired_pids = sorted(x[1] for x in fr)
    assert fired_pids == ["pB", "pC"], fr   # pGone has no matching quote, never fires
    for x in fr:
        if x[1] == "pB":
            assert x[3] == 517.5
        if x[1] == "pC":
            assert x[3] == 1260.75

    assert plan([{"email": "z@x.com", "pend": {"pX": {"ts": 0, "m": 0, "label": "x"}}, "w": {}}], quotes, 20 * 864e5)[0] == [], \
        "expired pending is not mailed"

    s = "sec"
    m = confirm_email("a@x.com", "pB", "Corn (new crop) above $4.50", "https://w.dev", s, "AGSIST", "n@agsist.com", None)
    body = m.get_body(("plain",)).get_content()
    assert "PO Box 243, Chetek, WI 54728" in body and "price-watch-confirm?e=a%40x.com&p=pB&t=" in body
    assert m["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
    m2 = hit_email("a@x.com", "pB", "Corn (new crop) above $4.50", 517.5, "https://w.dev", s, "AGSIST", "n@agsist.com", None)
    b2 = m2.get_body(("plain",)).get_content()
    assert "$5.17" in b2 and "already cleared" in b2 and "PO Box 243" in b2
    print("selftest ok")


def main():
    if "--selftest" in sys.argv:
        selftest()
        return 0
    base = env("LIST_URL", "").rstrip("/")
    tok, secret = env("LIST_TOKEN"), env("UNSUB_SECRET")
    if not (base and tok and secret):
        print("LIST_URL, LIST_TOKEN and UNSUB_SECRET are required")
        return 1
    dry = env("DRY_RUN") == "1"
    cap = int(env("MAX_SENDS", "100"))
    quotes = load_quotes()
    watchers = worker(base, "price-watch-list", tok)
    confirms, fires = plan(watchers, quotes, time.time() * 1000)
    print(f"quotes loaded {len(quotes)}; watchers {len(watchers)}; confirmations {len(confirms)}; fires {len(fires)}")
    if dry:
        for x in confirms:
            print("would confirm", x)
        for x in fires:
            print("would fire", x[0], x[1], x[2], "close", x[3])
        return 0
    fn, fa, rt = env("FROM_NAME", "AGSIST Market Prices"), env("FROM_ADDR") or env("SMTP_USER"), env("REPLY_TO")
    sent, failed = 0, []
    jobs = [("c", x) for x in confirms] + [("f", x) for x in fires]
    if jobs and cap > 0:
        ctx = ssl.create_default_context()

        def connect():
            c = smtplib.SMTP(env("SMTP_HOST", "smtp.gmail.com"), int(env("SMTP_PORT", "587")), timeout=30)
            c.starttls(context=ctx)
            c.login(env("SMTP_USER"), env("SMTP_PASS"))
            return c
        conn, reconnects = connect(), 0
        try:
            for kind, x in jobs[:cap]:
                e, p, label = x[0], x[1], x[2]
                try:
                    if kind == "c":
                        msg = confirm_email(e, p, label, base, secret, fn, fa, rt)
                    else:
                        msg = hit_email(e, p, label, x[3], base, secret, fn, fa, rt)
                    conn.send_message(msg)
                    sent += 1
                    worker(base, "price-watch-mark", tok,
                           {"email": e, "pid": p, "confirm_mailed": True} if kind == "c"
                           else {"email": e, "pid": p, "fired": True})
                    time.sleep(1.5)
                except Exception as ex:             # bare on purpose: a socket error is not an SMTPException
                    failed.append(f"{e} {p} ({type(ex).__name__})")
                    dead = isinstance(ex, (smtplib.SMTPServerDisconnected, smtplib.SMTPConnectError)) or \
                        (isinstance(ex, OSError) and not isinstance(ex, smtplib.SMTPException))
                    if dead and reconnects < 3:
                        reconnects += 1
                        try:
                            conn = connect()
                        except Exception:
                            break
        finally:
            try:
                conn.quit()
            except Exception:
                pass
    print(f"sent {sent}; failed {len(failed)}" + (": " + ", ".join(failed[:10]) if failed else ""))
    if jobs and len(jobs) > cap:
        print(f"cap reached: {len(jobs) - cap} left for the next run")
    return 1 if failed and not sent else 0


if __name__ == "__main__":
    sys.exit(main())
