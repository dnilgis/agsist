#!/usr/bin/env python3
"""
Watch an elevator: the sender. Runs in Actions (fetch_bids.yml, a step after
the basis pull, continue-on-error -- a failure here must not cost the bids).

Same shape as send_watch.py (watch a county), reading a different real source:
1. Confirmation emails. A reader asked to watch an elevator's corn (or beans,
   or wheat) basis on the homepage; the worker stored a pending record keyed
   by a short hash (`wid`) of state|facility|city|commodity, plus the
   human-readable label the homepage sent along with it. This job mails the
   confirmation link once per pending record, then marks it mailed.
2. Change emails. For every confirmed watch it compares the current basis in
   data/basis/<ST>.json against the basis last reported to that address. New
   watch: the current basis is recorded as the baseline and nothing is
   mailed. Changed: one email naming the old and new basis and the date the
   board changed, then the new basis is recorded.

THE WID PROBLEM AND HOW IT IS SOLVED
The worker (workers/subs-worker.js) never sees a facility name -- only the
hash and the label the subscribe call sent it, so it cannot look anything up
for itself. This job rebuilds a hash -> current-row index by hashing every
row in every data/basis/<ST>.json file with the SAME function the homepage
uses client-side (FNV-1a 32-bit over STATE|FACILITY|CITY|COMMODITY,
uppercased), then matches watched wids against that index. `--selftest`
asserts this Python hash equals the JS one on a hand-computed example, so the
two can never drift apart silently.

A wid encodes state+facility+city+commodity, not a delivery month -- a board
carries several rows (front month, deferred, new crop) for the same
commodity at the same elevator, and a watch is "this elevator's corn basis",
not one contract that rolls off the board in a few months. Where more than
one row hashes to the same wid, the one with the most recent lastSeen wins --
the same "most recently active" tie-break scripts/build_basis_sparklines.py
already uses for an analogous problem.

An elevator not found in today's basis files (delisted, or never had a
change logged) is left alone: no email, no baseline overwrite. That is a
real, known gap -- see the kit README -- not a bug to paper over here.

Rules: never invent a basis figure; one mark per message, written right
after that message is sent, so a rerun cannot re-mail anyone; a send failure
never marks. Transport env, worker env, DRY_RUN and MAX_SENDS: identical to
send_watch.py.
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
BASIS_DIR = REPO / "data" / "basis"
SITE = "https://agsist.com"
ADDRESS = "AGSIST, PO Box 243, Chetek, WI 54728"
PEND_TTL_MS = 14 * 864e5


def env(name, default=None):
    v = os.environ.get(name)
    return v if v not in (None, "") else default


def token(secret, email, tail):
    """Same as the worker's hmac16: HMAC-SHA256 of the lowercased string, first 16 hex."""
    return hmac.new(secret.encode(), (email + tail).lower().encode(), hashlib.sha256).hexdigest()[:16]


def wid_for(state, facility, city, commodity):
    """FNV-1a 32-bit, 8 lowercase hex chars. Must stay byte-identical to the
    homepage's JS version (components/bids-homepage.js, widFor()) -- checked
    by --selftest against a hand-computed value, not just cross-checked here."""
    s = "|".join(x.strip().upper() for x in (state or "", facility or "", city or "", commodity or ""))
    h = 2166136261
    for ch in s.encode("utf-8"):
        h ^= ch
        h = (h * 16777619) & 0xFFFFFFFF
    return f"{h:08x}"


def link(base, path, email, wid, secret, kind):
    tail = {"c": "|ec|" + wid, "w1": "|ew|" + wid, "w": "|ew"}[kind]
    q = "e=" + urllib.parse.quote(email.lower())
    if kind in ("c", "w1"):
        q += "&w=" + wid
    return f"{base}/{path}?{q}&t={token(secret, email, tail)}"


def load_basis_index():
    """wid -> best row, scanning every state file once. Best = most recently
    seen when two rows (different delivery months) hash to the same wid.

    data/basis/<ST>.json is dictionary-encoded, not a map of facility ->
    rows: `f` and `c` are lookup lists (a row's `facility`/`commodity` slots
    are INDEXES into them, not strings), `d` is a lookup list of dates, and
    `r` is the flat row list, in the order `cols` names. `basis` is already
    an integer number of cents -- the same unit build_basis_sparklines.py
    uses, not dollars."""
    idx = {}
    if not BASIS_DIR.is_dir():
        return idx
    for p in sorted(BASIS_DIR.glob("*.json")):
        try:
            d = json.loads(p.read_text())
        except Exception:
            continue
        state = d.get("state") or p.stem
        cols = d.get("cols") or []
        fac_lut, com_lut, date_lut, rows = d.get("f") or [], d.get("c") or [], d.get("d") or [], d.get("r") or []
        try:
            i_fac, i_com, i_sym, i_del, i_bas, i_chg, i_last = (
                cols.index("facility"), cols.index("commodity"), cols.index("symbol"),
                cols.index("deliveryMonth"), cols.index("basis"),
                cols.index("changedOn"), cols.index("lastSeen"))
        except ValueError:
            continue

        def lut(table, i):
            return table[i] if isinstance(i, int) and 0 <= i < len(table) else None

        for row in rows:
            if len(row) <= max(i_fac, i_com, i_sym, i_del, i_bas, i_chg, i_last):
                continue
            key = lut(fac_lut, row[i_fac])
            commodity = lut(com_lut, row[i_com])
            if key is None or commodity is None or row[i_bas] is None:
                continue
            facility, _, city = key.partition("|")
            w = wid_for(state, facility, city, commodity)
            cand = {
                "state": state, "facility": facility, "city": city,
                "commodity": commodity, "symbol": row[i_sym], "deliveryMonth": row[i_del],
                "basis": row[i_bas], "changedOn": lut(date_lut, row[i_chg]), "lastSeen": lut(date_lut, row[i_last]),
            }
            prev = idx.get(w)
            if prev is None or (cand["lastSeen"] or "") > (prev["lastSeen"] or ""):
                idx[w] = cand
    return idx


def basis_key(row):
    """What counts as 'this basis changed' -- the number and the day it moved,
    not lastSeen (which ticks every poll whether or not the number did)."""
    return f"{row['basis']}@{row['changedOn']}"


def fmt_cents(b):
    """b is already an integer number of cents -- data/basis/<ST>.json's own
    unit, the same one build_basis_sparklines.py uses. Not dollars, and
    nothing here rescales it."""
    if b is None:
        return "not published"
    cents = round(b)
    sign = "+" if cents > 0 else ("−" if cents < 0 else "")
    return f"{sign}{abs(cents)}¢"


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


def confirm_email(w, wid, label, base, secret, fn, fa, rt):
    go = link(base, "elevator-watch-confirm", w, wid, secret, "c")
    stop = link(base, "elevator-watch-unsubscribe", w, wid, secret, "w1")
    m = base_msg(w, f"Confirm: watch {label} on AGSIST", fn, fa, rt, stop)
    m.set_content(f"Someone asked to watch {label} in AGSIST's cash bids using this address.\n\n"
                  f"If that was you, confirm here:\n{go}\n\n"
                  "Then you get an email when this elevator's posted basis changes.\n"
                  "If it was not you, ignore this email. Nothing starts until you confirm.\n\n"
                  f"--\n{ADDRESS}\nNo more emails about this elevator: {stop}\n")
    foot = f'{H.escape(ADDRESS)}<br><a href="{H.escape(stop)}" style="color:#6b6b6b">Not me / stop</a>'
    m.add_alternative(html_wrap(f"Confirm: watch {label}", [
        f"Someone asked to watch {label} in AGSIST's cash bids using this address.",
        "If that was you, confirm below. Then you get an email when this elevator's posted basis changes.",
        "If it was not you, ignore this. Nothing starts until you confirm."], ("CONFIRM", go), foot), subtype="html")
    return m


def change_email(w, wid, label, old_basis, new_row, base, secret, fn, fa, rt):
    stop1 = link(base, "elevator-watch-unsubscribe", w, wid, secret, "w1")
    stopall = link(base, "elevator-watch-unsubscribe", w, wid, secret, "w")
    m = base_msg(w, f"{label}: basis moved to {fmt_cents(new_row['basis'])}", fn, fa, rt, stop1)
    line = f"Basis: {fmt_cents(old_basis)} -> {fmt_cents(new_row['basis'])}, as of {new_row['changedOn'] or 'an unposted date'}."
    m.set_content(f"{label}'s posted basis changed.\n\n{line}\n\n"
                  f"This is the elevator's own posted board, not a contract -- freight, moisture and grade "
                  "discounts are theirs, not shown here. Call to confirm before you haul.\n\n"
                  f"Full cash bids:\n{SITE}/cash-bids\n\n"
                  f"--\n{ADDRESS}\nStop watching this elevator: {stop1}\nStop all elevator watches: {stopall}\n")
    foot = (f'{H.escape(ADDRESS)}<br><a href="{H.escape(stop1)}" style="color:#6b6b6b">Stop watching this elevator</a> &middot; '
            f'<a href="{H.escape(stopall)}" style="color:#6b6b6b">Stop all</a>')
    m.add_alternative(html_wrap(f"{label}: basis moved", [
        line, "Posted price, not a contract. Freight, moisture and grade discounts are the elevator's -- call to confirm before you haul."],
        ("SEE ALL CASH BIDS", SITE + "/cash-bids"), foot), subtype="html")
    return m


def plan(watchers, basis_idx, now_ms):
    """Pure: what to do. Returns (confirms, changes, baselines).
    confirms  [(email, wid, label)]
    changes   [(email, wid, label, old_basis, new_row)]
    baselines [(email, wid, label, new_row)]   new watch, or a key change with the same basis (a rounding/date-only touch)"""
    confirms, chg, base = [], [], []
    for r in watchers:
        e = r["email"]
        for w, p in (r.get("pend") or {}).items():
            if not p.get("m") and now_ms - p.get("ts", 0) <= PEND_TTL_MS and w in basis_idx:
                confirms.append((e, w, p.get("label") or "this elevator"))
        for w, st in (r.get("w") or {}).items():
            row = basis_idx.get(w)
            if row is None:
                continue
            label = (st and st.get("label")) or "this elevator"
            k = basis_key(row)
            if not st or st.get("k") is None:
                base.append((e, w, label, row))
            elif st.get("k") != k:
                old_basis = ((st.get("s") or {}).get("basis"))
                if old_basis != row["basis"]:
                    chg.append((e, w, label, old_basis, row))
                else:
                    base.append((e, w, label, row))
    return confirms, chg, base


def worker(base, path, token_, body=None):
    url = f"{base}/{path}{'&' if '?' in path else '?'}token={urllib.parse.quote(token_)}"
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", "User-Agent": "agsist-elevator-watch/1"},
                                 method="POST" if body is not None else "GET")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def selftest():
    # The one number that must never silently drift from the JS version.
    # Hand-computed FNV-1a 32-bit of "IL|ADM|ALTAMONT|CORN".
    assert wid_for("IL", "ADM", "ALTAMONT", "CORN") == "1fa85c8e", wid_for("IL", "ADM", "ALTAMONT", "CORN")
    assert wid_for("il", " adm ", "altamont", "corn") == wid_for("IL", "ADM", "ALTAMONT", "CORN"), \
        "case and whitespace must fold the same as the client"

    # basis is an integer number of cents (data/basis/<ST>.json's own unit) --
    # not dollars, so these are the values a real row actually carries.
    assert fmt_cents(None) == "not published"
    assert fmt_cents(-25) == "−25¢"
    assert fmt_cents(10) == "+10¢"
    assert fmt_cents(0) == "0¢"

    s = "sec"
    row_old = {"basis": -25, "changedOn": "2026-09-10", "lastSeen": "2026-09-29"}
    row_new = {"basis": -30, "changedOn": "2026-09-29", "lastSeen": "2026-09-29"}
    assert basis_key(row_old) != basis_key(row_new)
    assert basis_key(row_old) == basis_key(dict(row_old))

    W = [
        {"email": "a@x.com",
         "pend": {"wA": {"ts": 1000, "m": 0, "label": "ADM Altamont, IL — corn"},
                  "wGone": {"ts": 1000, "m": 0, "label": "Not on any board"},
                  "wMailed": {"ts": 1000, "m": 1, "label": "Already sent"}},
         "w": {"wB": {"label": "Rochester Elevator, IL — corn", "k": None, "s": None},
               "wC": {"label": "Chatham Coop, IL — corn", "k": basis_key(row_old), "s": {"basis": row_old["basis"]}},
               "wD": {"label": "Springfield Grain, IL — corn", "k": basis_key(row_old), "s": {"basis": row_old["basis"]}}}},
    ]
    idx = {
        "wA": {"basis": -10, "changedOn": "2026-09-29", "lastSeen": "2026-09-29"},
        "wB": {"basis": -15, "changedOn": "2026-09-20", "lastSeen": "2026-09-29"},
        "wC": row_new,                                    # basis actually moved
        "wD": {"basis": row_old["basis"], "changedOn": "2026-09-30", "lastSeen": "2026-09-30"},  # key moved, basis did not (a re-post)
    }
    cf, ch, bs = plan(W, idx, 2000)
    assert cf == [("a@x.com", "wA", "ADM Altamont, IL — corn")], cf              # wGone not in idx, wMailed already mailed
    assert [(x[0], x[1]) for x in ch] == [("a@x.com", "wC")], ch
    assert ch[0][3] == row_old["basis"] and ch[0][4] == row_new
    assert sorted(x[1] for x in bs) == ["wB", "wD"], bs                              # new watch, and a same-basis re-post
    assert plan([{"email": "z@x.com", "pend": {"wA": {"ts": 0, "m": 0, "label": "x"}}, "w": {}}], idx, 20 * 864e5)[0] == [], \
        "expired pending is not mailed"

    m = confirm_email("a@x.com", "wA", "ADM Altamont, IL — corn", "https://w.dev", s, "AGSIST", "n@agsist.com", None)
    body = m.get_body(("plain",)).get_content()
    assert "PO Box 243, Chetek, WI 54728" in body and "elevator-watch-confirm?e=a%40x.com&w=wA&t=" in body
    assert m["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
    m2 = change_email("a@x.com", "wC", "Chatham Coop, IL — corn", row_old["basis"], row_new, "https://w.dev", s, "AGSIST", "n@agsist.com", None)
    b2 = m2.get_body(("plain",)).get_content()
    assert "PO Box 243" in b2 and "Stop all elevator watches" in b2 and "-25¢" in b2.replace("−", "-") and "-30¢" in b2.replace("−", "-")
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
    basis_idx = load_basis_index()
    watchers = worker(base, "elevator-watch-list", tok)
    confirms, chg, bs = plan(watchers, basis_idx, time.time() * 1000)
    print(f"basis rows indexed {len(basis_idx)}; watchers {len(watchers)}; confirmations {len(confirms)}; changes {len(chg)}; baselines {len(bs)}")
    if dry:
        for x in confirms:
            print("would confirm", x)
        for x in chg:
            print("would mail", x[0], x[1], x[2], "basis", x[3], "->", x[4]["basis"])
        return 0
    for e, w, label, row in bs:                    # silent, no mail
        worker(base, "elevator-watch-mark", tok, {"email": e, "wid": w, "label": label, "k": basis_key(row), "s": {"basis": row["basis"]}})
    fn, fa, rt = env("FROM_NAME", "AGSIST Cash Bids"), env("FROM_ADDR") or env("SMTP_USER"), env("REPLY_TO")
    sent, failed = 0, []
    jobs = [("c", x) for x in confirms] + [("m", x) for x in chg]
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
                e, w, label = x[0], x[1], x[2]
                try:
                    if kind == "c":
                        msg = confirm_email(e, w, label, base, secret, fn, fa, rt)
                    else:
                        msg = change_email(e, w, label, x[3], x[4], base, secret, fn, fa, rt)
                    conn.send_message(msg)
                    sent += 1
                    worker(base, "elevator-watch-mark", tok,
                           {"email": e, "wid": w, "label": label, "confirm_mailed": True} if kind == "c"
                           else {"email": e, "wid": w, "label": label, "k": basis_key(x[4]), "s": {"basis": x[4]["basis"]}})
                    time.sleep(1.5)
                except Exception as ex:             # bare on purpose: a socket error is not an SMTPException
                    failed.append(f"{e} {w} ({type(ex).__name__})")
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
