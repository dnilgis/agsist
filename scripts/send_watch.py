#!/usr/bin/env python3
"""
Watch a county: the sender. Runs in Actions (farmland-atlas-watch.yml).

1. Confirmation emails. A reader asked to watch a county on its page; the worker stored a pending
   record. This job mails the confirmation link once per pending record, then marks it mailed.
2. Change emails. For every confirmed watch it compares the county's figures in
   farmland-atlas/data/cards.json with the figures last reported to that address. New watch: the
   current figures are recorded as the baseline and nothing is mailed. Changed: one email that
   names each figure that moved, then the new figures are recorded.

Rules: never invent a figure (a missing one prints "not published"); one mark per message, written
right after that message is sent, so a rerun cannot re-mail anyone; a send failure never marks.
Transport env (same secrets as the briefing sender): SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS,
FROM_ADDR, FROM_NAME, REPLY_TO. Worker: LIST_URL, LIST_TOKEN, UNSUB_SECRET. DRY_RUN=1 sends and
marks nothing. MAX_SENDS caps one run (default 100; Gmail's day limit is shared with the briefing).
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
CARDS = REPO / "farmland-atlas" / "data" / "cards.json"
SITE = "https://agsist.com"
ADDRESS = "AGSIST, PO Box 243, Chetek, WI 54728"
PEND_TTL_MS = 14 * 864e5
TRACK = ("r", "ry", "v", "vy", "vf", "y", "c")


def env(name, default=None):
    v = os.environ.get(name)
    return v if v not in (None, "") else default


def token(secret, email, tail):
    """Same as the worker's hmac16: HMAC-SHA256 of the lowercased string, first 16 hex."""
    return hmac.new(secret.encode(), (email + tail).lower().encode(), hashlib.sha256).hexdigest()[:16]


def link(base, path, email, fips, secret, kind):
    tail = {"c": "|c|" + fips, "w1": "|w|" + fips, "w": "|w"}[kind]
    q = "e=" + urllib.parse.quote(email.lower())
    if kind in ("c", "w1"):
        q += "&f=" + fips
    return f"{base}/{path}?{q}&t={token(secret, email, tail)}"


def snap(c):
    return {k: c.get(k) for k in TRACK}


def money(x, unit="an acre"):
    if x is None:
        return "not published"
    s = f"{x:,.2f}" if abs(x - round(x)) > 1e-9 and x < 1000 else f"{round(x):,}"
    return f"${s} {unit}"


def fmt_line(label, old, new, unit=None, yr=None):
    def one(v, y):
        if v is None:
            return "not published"
        t = money(v, unit) if unit else f"{v:g}"
        return t + (f" ({y})" if y else "")
    return f"{label}: {one(old[0], old[1])} -> {one(new[0], new[1])}"


def changes(old, new):
    """The lines that differ, from stored snapshot to current. Empty list = nothing to say."""
    out = []
    if (old.get("r"), old.get("ry")) != (new.get("r"), new.get("ry")):
        out.append(fmt_line("Dry cash rent", (old.get("r"), old.get("ry")), (new.get("r"), new.get("ry")), "an acre"))
    ov = (old.get("v"), old.get("vy"), old.get("vf"))
    nv = (new.get("v"), new.get("vy"), new.get("vf"))
    if ov != nv:
        line = fmt_line("Land and buildings", (old.get("v"), old.get("vy")), (new.get("v"), new.get("vy")), "an acre")
        if new.get("vf"):
            line += ". This value is flagged: read with care"
        out.append(line)
    if old.get("y") != new.get("y"):
        if new.get("y") is None:
            out.append("Corn yield: no longer published")
        else:
            was = "not published" if old.get("y") is None else f"{old['y']:g}"
            out.append(f"Corn yield: {was} -> {new['y']:g} bu/acre")
    if old.get("c") != new.get("c"):
        out.append(f"Claims per $100 of coverage: {old.get('c') if old.get('c') is not None else 'not published'} -> "
                   f"{new.get('c') if new.get('c') is not None else 'not published'}")
    return out


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
           f'text-decoration:none;padding:10px 18px;font-family:Courier,monospace;font-size:13px">{e(button[0])}</a></p>') if button else ""
    return ('<div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;padding:24px 16px;color:#1a1a1a;background:#fff">'
            f'<h1 style="font-size:20px;line-height:1.3;margin:0 0 12px">{e(title)}</h1>{body}{btn}'
            f'<p style="font-size:12px;color:#6b6b6b;line-height:1.5">{foot}</p></div>')


def confirm_email(w, fips, c, base, secret, fn, fa, rt):
    lab = f"{c['n']}, {c['s']}"
    go = link(base, "watch-confirm", w, fips, secret, "c")
    stop = link(base, "watch-unsubscribe", w, fips, secret, "w1")
    m = base_msg(w, f"Confirm: watch {lab} on AGSIST", fn, fa, rt, stop)
    m.set_content(f"Someone asked to watch {lab} in the AGSIST Farmland Atlas using this address.\n\n"
                  f"If that was you, confirm here:\n{go}\n\n"
                  "Then you get an email when that county's published figures change. That is usually once or twice a year.\n"
                  "If it was not you, ignore this email. Nothing starts until you confirm.\n\n"
                  f"--\n{ADDRESS}\nNo more emails about this county: {stop}\n")
    foot = f'{H.escape(ADDRESS)}<br><a href="{H.escape(stop)}" style="color:#6b6b6b">Not me / stop</a>'
    m.add_alternative(html_wrap(f"Confirm: watch {lab}", [
        f"Someone asked to watch {lab} in the AGSIST Farmland Atlas using this address.",
        "If that was you, confirm below. Then you get an email when that county's published figures change, usually once or twice a year.",
        "If it was not you, ignore this. Nothing starts until you confirm."], ("CONFIRM", go), foot), subtype="html")
    return m


def change_email(w, fips, c, lines, base, secret, fn, fa, rt, page):
    lab = f"{c['n']}, {c['s']}"
    stop1 = link(base, "watch-unsubscribe", w, fips, secret, "w1")
    stopall = link(base, "watch-unsubscribe", w, fips, secret, "w")
    m = base_msg(w, f"{lab}: Farmland Atlas figures updated", fn, fa, rt, stop1)
    m.set_content(f"Published figures changed for {lab}.\n\n" + "\n".join(lines) +
                  f"\n\nFull county page:\n{page}\n\nThese are county averages from public records, not an appraisal of any farm.\n\n"
                  f"--\n{ADDRESS}\nStop watching this county: {stop1}\nStop all county watches: {stopall}\n")
    foot = (f'{H.escape(ADDRESS)}<br><a href="{H.escape(stop1)}" style="color:#6b6b6b">Stop watching this county</a> &middot; '
            f'<a href="{H.escape(stopall)}" style="color:#6b6b6b">Stop all</a>')
    m.add_alternative(html_wrap(f"{lab}: figures updated", lines + [
        "County averages from public records, not an appraisal of any farm."], ("OPEN THE COUNTY PAGE", page), foot), subtype="html")
    return m


def page_url(c):
    return SITE + c["u"] if c.get("u") else SITE + "/farmland-atlas"


def plan(watchers, counties, now_ms):
    """Pure: what to do. Returns (confirms, changes, baselines).
    confirms  [(email, fips)]           pending, not yet mailed, not expired, county known
    changes   [(email, fips, lines, new_snapshot, new_key)]
    baselines [(email, fips, snapshot, key)]   record silently (new watch, or a key change with no tracked figure moved)"""
    confirms, chg, base = [], [], []
    for r in watchers:
        e = r["email"]
        for f, p in (r.get("pend") or {}).items():
            if not p.get("m") and now_ms - p.get("ts", 0) <= PEND_TTL_MS and f in counties:
                confirms.append((e, f))
        for f, st in (r.get("w") or {}).items():
            c = counties.get(f)
            if c is None:
                continue
            new = snap(c)
            if not st:
                base.append((e, f, new, c["k"]))
            elif st.get("k") != c["k"]:
                lines = changes(st.get("s") or {}, new)
                (chg.append((e, f, lines, new, c["k"])) if lines else base.append((e, f, new, c["k"])))
    return confirms, chg, base


def worker(base, path, token_, body=None):
    url = f"{base}/{path}{'&' if '?' in path else '?'}token={urllib.parse.quote(token_)}"
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", "User-Agent": "agsist-watch/1"},
                                 method="POST" if body is not None else "GET")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def selftest():
    s = "sec"
    e = "A@x.com"
    assert token(s, e, "|c|19169") == hmac.new(b"sec", b"a@x.com|c|19169", hashlib.sha256).hexdigest()[:16]
    old = {"r": 250.0, "ry": 2025, "v": 9000, "vy": 2022, "vf": False, "y": 200.5, "c": 5.7}
    assert changes(old, dict(old)) == []
    n = dict(old, r=262.5, ry=2026)
    assert changes(old, n) == ["Dry cash rent: $250 an acre (2025) -> $262.50 an acre (2026)"], changes(old, n)
    assert changes(dict(old, r=None, ry=None), n)[0].startswith("Dry cash rent: not published -> $262.50")
    assert changes(old, dict(old, v=9100, vf=True))[0].endswith("read with care")
    assert changes(old, dict(old, y=None)) == ["Corn yield: no longer published"]
    assert changes(old, dict(old, y=205.0)) == ["Corn yield: 200.5 -> 205 bu/acre"]
    C = {"19169": {"n": "Story County", "s": "Iowa", "k": "new", "r": 262.5, "ry": 2026, "v": 9000, "vy": 2022, "vf": False, "y": 200.5, "c": 5.7},
         "19001": {"n": "Adair County", "s": "Iowa", "k": "same", "r": 1.0, "ry": 2026, "v": 1, "vy": 2022, "vf": False, "y": 1, "c": 1}}
    W = [{"email": "a@x.com", "pend": {"19169": {"ts": 1000, "m": 0}, "19001": {"ts": 1000, "m": 1}, "99999": {"ts": 1000, "m": 0}},
          "w": {"19169": {"k": "old", "s": old}, "19001": None}},
         {"email": "b@x.com", "pend": {"19169": {"ts": 1000, "m": 0}}, "w": {}},
         {"email": "c@x.com", "pend": {}, "w": {"19001": {"k": "other", "s": snap(C["19001"])}}}]
    cf, ch, bs = plan(W, C, 2000)
    assert cf == [("a@x.com", "19169"), ("b@x.com", "19169")], cf           # mailed and unknown-county pendings skipped
    assert [(x[0], x[1]) for x in ch] == [("a@x.com", "19169")]
    assert sorted((x[0], x[1]) for x in bs) == [("a@x.com", "19001"), ("c@x.com", "19001")], bs   # baseline, and key moved with no tracked change
    assert plan([{"email": "z@x.com", "pend": {"19169": {"ts": 0, "m": 0}}, "w": {}}], C, 20 * 864e5)[0] == [], "expired pending is not mailed"
    m = confirm_email("a@x.com", "19169", C["19169"], "https://w.dev", s, "AGSIST", "n@agsist.com", None)
    body = m.get_body(("plain",)).get_content()
    assert "PO Box 243, Chetek, WI 54728" in body and "watch-confirm?e=a%40x.com&f=19169&t=" in body
    assert m["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
    m2 = change_email("a@x.com", "19169", C["19169"], ["x -> y"], "https://w.dev", s, "AGSIST", "n@agsist.com", None, "https://agsist.com/p")
    assert "PO Box 243" in m2.get_body(("plain",)).get_content() and "Stop all county watches" in m2.get_body(("plain",)).get_content()
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
    cards = json.loads(CARDS.read_text())["counties"]
    watchers = worker(base, "watch-list", tok)
    confirms, chg, bs = plan(watchers, cards, time.time() * 1000)
    print(f"watchers {len(watchers)}; confirmations {len(confirms)}; changes {len(chg)}; baselines {len(bs)}")
    if dry:
        for x in confirms:
            print("would confirm", x)
        for x in chg:
            print("would mail", x[0], x[1], x[2])
        return 0
    for e, f, snapshot, k in bs:                    # silent, no mail
        worker(base, "watch-mark", tok, {"email": e, "fips": f, "k": k, "s": snapshot})
    fn, fa, rt = env("FROM_NAME", "AGSIST Farmland Atlas"), env("FROM_ADDR") or env("SMTP_USER"), env("REPLY_TO")
    sent, failed = 0, []
    if (confirms or chg) and cap > 0:
        ctx = ssl.create_default_context()

        def connect():
            c = smtplib.SMTP(env("SMTP_HOST", "smtp.gmail.com"), int(env("SMTP_PORT", "587")), timeout=30)
            c.starttls(context=ctx)
            c.login(env("SMTP_USER"), env("SMTP_PASS"))
            return c
        conn, reconnects = connect(), 0
        jobs = [("c", x) for x in confirms] + [("m", x) for x in chg]
        try:
            for kind, x in jobs[:cap]:
                e, f = x[0], x[1]
                c = cards[f]
                try:
                    if kind == "c":
                        msg = confirm_email(e, f, c, base, secret, fn, fa, rt)
                    else:
                        msg = change_email(e, f, c, x[2], base, secret, fn, fa, rt, page_url(c))
                    conn.send_message(msg)
                    sent += 1
                    worker(base, "watch-mark", tok, {"email": e, "fips": f, "confirm_mailed": True} if kind == "c"
                           else {"email": e, "fips": f, "k": x[4], "s": x[3]})
                    time.sleep(1.5)
                except Exception as ex:             # bare on purpose: a socket error is not an SMTPException
                    failed.append(f"{e} {f} ({type(ex).__name__})")
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
    if len(jobs if (confirms or chg) else []) > cap:
        print(f"cap reached: {len(jobs) - cap} left for the next run")
    return 1 if failed and not sent else 0


if __name__ == "__main__":
    sys.exit(main())
