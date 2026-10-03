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

ALERT OPTIONS (2026-10-03, worker v5.3). A watch record may carry `kind`:
  any    (or no kind) the v5.1 watch above, unchanged, read from data/basis.
  cash   a cash price reaches a target, one crop and one delivery period.
  basis  a basis reaches a target, same.
  move   a basis moves at least N cents from the last email.
These three read the SAME rows the homepage card draws for a network
elevator: the bids repo's data/merged-index.json, `now[crop]` per place,
with the place's own pricedAt as the posting time. The licensed feed's rows
carry no posting time and cannot be read from here, so the card offers
these options only on network rows. `ewid` is wid_for(state, operator,
city, crop), the hash the card computed from the same row.
  * The first run after confirming records the posting time and the value
    and mails nothing. After that only a NEWER posting is looked at: a board
    that has not posted since the last note sends nothing.
  * The row must still be there, for the same period, with a number in the
    card's per-bushel band. Otherwise nothing is sent and nothing recorded.
    Two places hashing to one ewid are treated as missing, never guessed.
  * cash/basis fire once at or past the target and are removed (fired).
    move fires when |new - last note| >= N and records the new level, so it
    re-arms from there. A smaller move records nothing: moves add up from
    the last email, not from the last posting.

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
from datetime import datetime, timezone
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BASIS_DIR = REPO / "data" / "basis"
SITE = "https://agsist.com"
ADDRESS = "AGSIST, PO Box 243, Chetek, WI 54728"
PEND_TTL_MS = 14 * 864e5
CARD_URL = SITE + "/#f1"            # the cash-bids card on the homepage
NET_INDEX_URL = "https://dnilgis.github.io/bids/data/merged-index.json"   # what components/bids-network.js reads
OPT_KINDS = ("cash", "basis", "move")
# components/bids-homepage.js PPU_BAND: a row outside its crop's band is a
# unit mismatch, not a price, and the card does not draw it.
PPU_BAND = {"corn": (2, 12), "soybeans": (6, 32), "wheat": (3, 20), "sorghum": (2, 7), "oats": (1, 8)}
CROP_NAMES = {"corn": "corn", "soybeans": "soybeans", "wheat": "wheat", "sorghum": "sorghum", "oats": "oats"}
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
AMBIGUOUS = "ambiguous"


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
    # UTF-16 code units, which is what JS charCodeAt() walks. Until
    # 2026-10-03 this walked UTF-8 bytes: identical for ASCII, different for
    # "Underwood (13¢ Dump fee)", so three real places could never be found.
    b = s.encode("utf-16-le")
    for i in range(0, len(b), 2):
        h ^= b[i] | (b[i + 1] << 8)
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


def ppu(raw):
    """components/bids-homepage.js ppu(): over 30 is cents, else dollars."""
    if raw is None:
        return None
    return raw / 100 if raw > 30 else raw


def basis_cents_of(n):
    """The card's unit path: basisCents when sent, else basis (dollars when
    under 5 in size, as basisCents() in bids-homepage.js reads it)."""
    bc = n.get("basisCents")
    if isinstance(bc, (int, float)):
        return int(round(bc))
    b = n.get("basis")
    if isinstance(b, (int, float)):
        return int(round(b * 100 if abs(b) < 5 else b))
    return None


def period_label(period, delivery=""):
    """bids-homepage.js periodLabel(r.period) || r.delivery."""
    import re
    m = re.match(r"^(\d{4})-(\d{2})(?:/(\d{4})-(\d{2}))?", period or "")
    if not m or not (1 <= int(m.group(2)) <= 12):
        return delivery or ""
    y1, m1, y2, m2 = m.group(1), int(m.group(2)), m.group(3), m.group(4)
    if y2 and (y2 != y1 or int(m2) != m1) and 1 <= int(m2) <= 12:
        return MON[m1 - 1] + ("" if y2 == y1 else " " + y1) + "\u2013" + MON[int(m2) - 1] + " " + y2
    return MON[m1 - 1] + " " + y1


def ct_month(now_ms):
    try:
        from zoneinfo import ZoneInfo
        return datetime.fromtimestamp(now_ms / 1000, ZoneInfo("America/Chicago")).strftime("%Y-%m")
    except Exception:
        return datetime.fromtimestamp(now_ms / 1000, timezone.utc).strftime("%Y-%m")


def parse_iso(s):
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except Exception:
        return None


def fmt_posted(iso):
    d = parse_iso(iso)
    if d is None:
        return "an unknown time"
    try:
        from zoneinfo import ZoneInfo
        d = d.astimezone(ZoneInfo("America/Chicago"))
        tz = "CT"
    except Exception:
        d = d.astimezone(timezone.utc)
        tz = "UTC"
    h = d.hour % 12 or 12
    return f"{MON[d.month - 1]} {d.day}, {h}:{d.minute:02d} {'AM' if d.hour < 12 else 'PM'} {tz}"


def fmt_cash(c):
    return "not published" if c is None else f"${c / 100:.2f}"


def fmt_basis(c):
    """The card's words: 'even' for zero, a real minus sign, cents."""
    if c is None:
        return "not published"
    return "even" if c == 0 else fmt_cents(c)


def load_net_index(data, now_ms):
    """ewid -> the row the card draws: one place, one crop, `now[crop]`.
    The card's own filters: US dollars, a coordinate, a cash price inside the
    crop's band, a delivery window that has not closed. Two places that hash
    to one ewid map to AMBIGUOUS and are never guessed between."""
    idx = {}
    if not isinstance(data, dict):
        return idx
    month = ct_month(now_ms)
    for p in data.get("places") or []:
        if (p.get("currency") or "USD") != "USD":
            continue
        if not isinstance(p.get("lat"), (int, float)) or not isinstance(p.get("lon"), (int, float)):
            continue
        for crop, n in (p.get("now") or {}).items():
            if crop not in PPU_BAND or not isinstance(n, dict):
                continue
            cash = ppu(n.get("cash")) if isinstance(n.get("cash"), (int, float)) else None
            if cash is None or not (PPU_BAND[crop][0] <= cash <= PPU_BAND[crop][1]):
                continue
            period = str(n.get("period") or "")
            end = period.split("/")[-1]
            if len(end) >= 7 and end[:4].isdigit() and end[4] == "-" and end[:7] < month:
                continue
            w = wid_for(p.get("state"), p.get("operator"), p.get("city"), crop)
            row = {"state": p.get("state") or "", "facility": p.get("operator") or "", "city": p.get("city") or "",
                   "crop": crop, "period": period, "plabel": period_label(period, n.get("delivery") or ""),
                   "cash": int(round(cash * 100)), "basis": basis_cents_of(n), "pricedAt": p.get("pricedAt")}
            idx[w] = AMBIGUOUS if w in idx else row
    return idx


def net_name(row):
    town = ", ".join(x for x in (row["city"], row["state"]) if x)
    return row["facility"] + (", " + town if town else "")


def opt_condition(st):
    kind, t = st.get("kind"), st.get("target_cents")
    side = "at or above" if st.get("direction") == "above" else "at or below"
    if kind == "cash":
        return f"cash {side} {fmt_cash(t)}"
    if kind == "basis":
        return f"basis {side} {fmt_basis(t)}"
    if kind == "move":
        return f"basis moves {st.get('move_cents')}\u00a2 or more"
    return "basis changes"


def opt_label(st, row):
    """Built from the bid row and the validated numbers, never from the free
    text the subscribe call sent."""
    return f"{net_name(row)}, {CROP_NAMES[row['crop']]} {row['plabel']}: {opt_condition(st)}"


def hit(direction, value, target):
    if value is None or target is None:
        return False
    if direction == "above":
        return value >= target
    if direction == "below":
        return value <= target
    return False


def plan_alerts(watchers, net_idx, now_ms):
    """Pure: what to do for cash / basis / move alerts. Returns
    (confirms, sends, baselines).
    confirms  [(email, wid, label)]
    sends     [(email, wid, label, kind, old_value, row)]   kind cash|basis fire once; move re-arms
    baselines [(email, wid, label, row, value)]            first sight after confirming: record, mail nothing"""
    confirms, sends, base = [], [], []
    for r in watchers:
        e = r["email"]
        for w, p in (r.get("pend") or {}).items():
            if p.get("kind") not in OPT_KINDS or p.get("m") or now_ms - p.get("ts", 0) > PEND_TTL_MS:
                continue
            row = net_idx.get(p.get("ewid"))
            if isinstance(row, dict):
                confirms.append((e, w, opt_label(p, row)))
        for w, st in (r.get("w") or {}).items():
            if not st or st.get("kind") not in OPT_KINDS:
                continue
            row = net_idx.get(st.get("ewid"))
            if not isinstance(row, dict) or row["period"] != st.get("period") or row["crop"] != st.get("crop"):
                continue                                   # missing, ambiguous, or that period is off the board
            kind = st["kind"]
            val = row["cash"] if kind == "cash" else row["basis"]
            if val is None or parse_iso(row["pricedAt"]) is None:
                continue                                   # no number, or no posting time: never inferred
            label = opt_label(st, row)
            last = st.get("s") or {}
            if st.get("k") is None or parse_iso(last.get("pa")) is None or not isinstance(last.get("v"), int):
                base.append((e, w, label, row, val))
                continue
            if parse_iso(row["pricedAt"]) <= parse_iso(last["pa"]):
                continue                                   # stale: the board has not posted since the last note
            if kind == "move":
                n = st.get("move_cents")
                if isinstance(n, int) and n > 0 and abs(val - last["v"]) >= n:
                    sends.append((e, w, label, kind, last["v"], row))
            elif hit(st.get("direction"), val, st.get("target_cents")):
                sends.append((e, w, label, kind, last["v"], row))
    return confirms, sends, base


def alert_mark(row, val):
    """What the worker records as the last note: the posting time and the value."""
    return {"k": f"{row['pricedAt']}|{val}", "s": {"pa": row["pricedAt"], "v": val}}


def mark_after_send(job, x):
    """The one worker write after one sent message. job: c / oc confirm,
    m basis change, oa option alert. A cash or basis target is one-shot
    (fired: the worker removes it); a move re-arms at the new level."""
    e, w = x[0], x[1]
    if job in ("c", "oc"):
        return {"email": e, "wid": w, "confirm_mailed": True}
    if job == "oa":
        kind, row = x[3], x[5]
        if kind in ("cash", "basis"):
            return {"email": e, "wid": w, "fired": True}
        return dict({"email": e, "wid": w}, **alert_mark(row, row["basis"]))
    return {"email": e, "wid": w, "label": x[2], "k": basis_key(x[4]), "s": {"basis": x[4]["basis"]}}


def opt_confirm_email(w, wid, label, base, secret, fn, fa, rt):
    go = link(base, "elevator-watch-confirm", w, wid, secret, "c")
    stop = link(base, "elevator-watch-unsubscribe", w, wid, secret, "w1")
    m = base_msg(w, "Confirm: cash bid alert on AGSIST", fn, fa, rt, stop)
    m.set_content(f"Someone asked for this cash bid alert on AGSIST using this address:\n{label}\n\n"
                  f"If that was you, confirm here:\n{go}\n\n"
                  "It looks only at postings made after you confirm.\n"
                  "If it was not you, ignore this email. Nothing starts until you confirm.\n\n"
                  f"--\n{ADDRESS}\nNot me / stop: {stop}\n")
    foot = f'{H.escape(ADDRESS)}<br><a href="{H.escape(stop)}" style="color:#6b6b6b">Not me / stop</a>'
    m.add_alternative(html_wrap("Confirm your cash bid alert", [
        "Someone asked for this cash bid alert on AGSIST using this address:", label,
        "If that was you, confirm below. It looks only at postings made after you confirm.",
        "If it was not you, ignore this. Nothing starts until you confirm."], ("CONFIRM", go), foot), subtype="html")
    return m


def opt_alert_email(w, wid, label, kind, old, row, base, secret, fn, fa, rt):
    stop1 = link(base, "elevator-watch-unsubscribe", w, wid, secret, "w1")
    stopall = link(base, "elevator-watch-unsubscribe", w, wid, secret, "w")
    what = "Cash" if kind == "cash" else "Basis"
    fmt = fmt_cash if kind == "cash" else fmt_basis
    new = row["cash"] if kind == "cash" else row["basis"]
    head = f"{net_name(row)}, {CROP_NAMES[row['crop']]} {row['plabel']}"
    subj = f"{head}: {what.lower()} {'reached' if kind != 'move' else 'moved to'} {fmt(new)}"
    since = "when this alert started" if kind != "move" else "at the last alert, or when it started"
    lines = [f"{what}: {fmt(new)} now, {fmt(old)} {since}.",
             f"Posted by the elevator {fmt_posted(row['pricedAt'])}.",
             f"Your alert: {opt_condition_from_label(label)}"]
    tail = ("This alert has fired and is now cleared. Set it again on the card if you want another."
            if kind != "move" else "The next email comes when a later posting moves the basis this far again from here.")
    m = base_msg(w, subj, fn, fa, rt, stop1)
    m.set_content(f"{head}\n\n" + "\n".join(lines) + f"\n\n{tail}\n\n"
                  "This is the elevator's own posted board, not a contract. Freight, moisture and grade "
                  "discounts are theirs and not shown here. Call to confirm before you haul.\n\n"
                  f"The card:\n{CARD_URL}\n\n"
                  f"--\n{ADDRESS}\nStop this alert: {stop1}\nStop all elevator watches: {stopall}\n")
    foot = (f'{H.escape(ADDRESS)}<br><a href="{H.escape(stop1)}" style="color:#6b6b6b">Stop this alert</a> &middot; '
            f'<a href="{H.escape(stopall)}" style="color:#6b6b6b">Stop all</a>')
    m.add_alternative(html_wrap(head, lines + [tail,
        "Posted price, not a contract. Freight, moisture and grade discounts are the elevator's. Call to confirm before you haul."],
        ("SEE THE CARD", CARD_URL), foot), subtype="html")
    return m


def opt_condition_from_label(label):
    return label.split(": ", 1)[1] if ": " in label else label


def daily_lines(watchers, net_idx, basis_idx):
    """email -> plain lines for the Daily's "Your elevators" block. One line
    per confirmed watch, from the same rows the alerts read. A watch whose
    row is not on today's board says so; nothing is filled in."""
    out = {}
    for r in watchers:
        lines, seen = [], set()
        for w, st in (r.get("w") or {}).items():
            st = st or {}
            if st.get("kind") in OPT_KINDS:
                key = ("n", st.get("ewid"), st.get("period"))
                if key in seen:
                    continue
                seen.add(key)
                row = net_idx.get(st.get("ewid"))
                if isinstance(row, dict) and row["period"] == st.get("period"):
                    lines.append(f"{net_name(row)}, {CROP_NAMES[row['crop']]} {row['plabel']}: "
                                 f"{fmt_cash(row['cash'])}, basis {fmt_basis(row['basis'])}, posted {fmt_posted(row['pricedAt'])}")
                else:
                    lines.append(f"{(st.get('label') or 'A watched elevator').split(' — ')[0]}, {st.get('crop') or ''} "
                                 f"{st.get('plabel') or ''}: \u2014 not on the board this morning")
            else:
                # A plain corn watch's wid is the same hash as the network
                # row's ewid. Where the card has that row, print it, so this
                # block never shows two figures for one elevator's corn from
                # two files of different ages.
                nrow = net_idx.get(w)
                if isinstance(nrow, dict):
                    key = ("n", w, nrow["period"])
                    if key not in seen:
                        seen.add(key)
                        lines.append(f"{net_name(nrow)}, {CROP_NAMES[nrow['crop']]} {nrow['plabel']}: "
                                     f"{fmt_cash(nrow['cash'])}, basis {fmt_basis(nrow['basis'])}, posted {fmt_posted(nrow['pricedAt'])}")
                    continue
                if ("a", w) in seen:
                    continue
                seen.add(("a", w))
                row = basis_idx.get(w)
                name = (st.get("label") or "A watched elevator")
                if row:
                    lines.append(f"{name}: basis {fmt_basis(row['basis'])}, last changed {row['changedOn'] or 'on an unposted date'}")
                else:
                    lines.append(f"{name}: \u2014 not in the basis files this morning")
        if lines:
            out[r["email"].lower()] = lines
    return out


def fetch_net_index():
    """The bids repo's merged index, the file the card reads. NET_INDEX_FILE
    (a local path) wins, for tests; a failure is an empty index, which means
    no option alert sends anything this run."""
    try:
        f = env("NET_INDEX_FILE")
        if f:
            return json.loads(Path(f).read_text())
        req = urllib.request.Request(env("NET_INDEX_URL", NET_INDEX_URL), headers={"User-Agent": "agsist-elevator-watch/1"})
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode())
    except Exception as ex:
        print(f"network index not read ({type(ex).__name__}); option alerts skipped this run")
        return None


def plan(watchers, basis_idx, now_ms):
    """Pure: what to do. Returns (confirms, changes, baselines).
    confirms  [(email, wid, label)]
    changes   [(email, wid, label, old_basis, new_row)]
    baselines [(email, wid, label, new_row)]   new watch, or a key change with the same basis (a rounding/date-only touch)"""
    confirms, chg, base = [], [], []
    for r in watchers:
        e = r["email"]
        for w, p in (r.get("pend") or {}).items():
            if p.get("kind") in OPT_KINDS:
                continue                                  # plan_alerts() owns these
            if not p.get("m") and now_ms - p.get("ts", 0) <= PEND_TTL_MS and w in basis_idx:
                confirms.append((e, w, p.get("label") or "this elevator"))
        for w, st in (r.get("w") or {}).items():
            if st and st.get("kind") in OPT_KINDS:
                continue
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
    # Computed by the page's own widFor() in node, on a real place name with a cent sign in it.
    assert wid_for("MN", "CHS Herman", "Underwood (13\u00a2 Dump fee)", "corn") == "dead77fb", \
        "non-ASCII must hash as JS charCodeAt does (UTF-16 units), not as UTF-8 bytes"
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
    selftest_alerts()
    print("selftest ok")


def selftest_alerts():
    """Hand-worked cases for the cash / basis / move alerts (2026-10-03)."""
    NOW = datetime(2026, 10, 3, 18, 0, tzinfo=timezone.utc).timestamp() * 1000     # Oct 2026 in Chicago
    T1, T2, T3 = "2026-10-03T14:00:00Z", "2026-10-03T16:30:00.759Z", "2026-10-03T17:45:00Z"

    def place(op, city, now, pa=T2, **kw):
        p = {"operator": op, "city": city, "state": "WI", "lat": 45.1, "lon": -91.6, "currency": "USD",
             "pricedAt": pa, "now": now}
        p.update(kw)
        return p

    corn = lambda cash, bc, period="2026-10", **kw: dict({"cash": cash, "basisCents": bc, "period": period, "delivery": ""}, **kw)
    data = {"places": [
        place("Adell Cooperative", "Adell", {"corn": corn(4.52, -60), "soybeans": corn(11.92, -85, "newcrop-2026", delivery="26 New Crop")}),
        place("Cents Grain", "Bloomer", {"corn": corn(436, None, basis=-0.6)}),                  # cash in cents, basis in dollars
        place("Loonie Coop", "Ponoka", {"corn": corn(4.10, -50)}, currency="CAD"),               # not drawn: CAD
        place("No Pin", "Nowhere", {"corn": corn(4.10, -50)}, lat=None),                         # not drawn: no coordinate
        place("Old Window", "Eau Claire", {"corn": corn(4.10, -50, "2026-09")}),                 # closed window
        place("Unit Slip", "Cumberland", {"corn": corn(41.0, -50)}),                             # $0.41: out of band
        place("Twin", "Rice Lake", {"corn": corn(4.20, -40)}),
        place("Twin", "Rice Lake", {"corn": corn(4.25, -35)}),                                   # same hash twice
        place("Window Co", "Barron", {"wheat": corn(5.80, -100, "2026-08/2026-11")}),
    ]}
    idx = load_net_index(data, NOW)
    A_C, A_S = wid_for("WI", "Adell Cooperative", "Adell", "corn"), wid_for("WI", "Adell Cooperative", "Adell", "soybeans")
    B_C = wid_for("WI", "Cents Grain", "Bloomer", "corn")
    assert idx[A_C]["cash"] == 452 and idx[A_C]["basis"] == -60 and idx[A_C]["plabel"] == "Oct 2026", idx[A_C]
    assert idx[A_S]["plabel"] == "26 New Crop", "a period with no month falls back to the delivery words, as the card does"
    assert idx[B_C]["cash"] == 436 and idx[B_C]["basis"] == -60, "cents cash and dollar basis come out as the card prints them"
    for op, city in (("Loonie Coop", "Ponoka"), ("No Pin", "Nowhere"), ("Old Window", "Eau Claire"), ("Unit Slip", "Cumberland")):
        assert wid_for("WI", op, city, "corn") not in idx, op + " is not a row the card draws"
    assert idx[wid_for("WI", "Twin", "Rice Lake", "corn")] == AMBIGUOUS, "two places on one hash are never guessed between"
    assert idx[wid_for("WI", "Window Co", "Barron", "wheat")]["plabel"] == "Aug\u2013Nov 2026"
    assert period_label("2026-12/2027-02") == "Dec 2026\u2013Feb 2027"

    def W(kind, ewid, period="2026-10", crop="corn", k="set", pa=T1, v=None, **kw):
        st = dict({"kind": kind, "ewid": ewid, "crop": crop, "period": period, "plabel": period, "label": "free text",
                   "k": k, "s": None if k is None else {"pa": pa, "v": v}}, **kw)
        return st

    watchers = [{"email": "f@x.com",
                 "pend": {"p1": {"ts": NOW - 1000, "m": 0, "kind": "cash", "ewid": A_C, "crop": "corn", "period": "2026-10",
                                 "direction": "above", "target_cents": 450, "label": "<b>spoof</b>"},
                          "p2": {"ts": NOW - 1000, "m": 0, "kind": "cash", "ewid": "deadbeef", "crop": "corn", "period": "2026-10",
                                 "direction": "above", "target_cents": 450, "label": "nowhere"},
                          "p3": {"ts": NOW - 1000, "m": 1, "kind": "move", "ewid": A_C, "move_cents": 5, "label": "mailed"}},
                 "w": {
                     "new":   W("cash", A_C, k=None, direction="above", target_cents=450),          # first sight: baseline
                     "up":    W("cash", A_C, v=436, direction="above", target_cents=450),           # 436 -> 452, target 450: fires
                     "edge":  W("cash", B_C, v=430, direction="below", target_cents=436),           # exactly at target: fires
                     "edgeup": W("cash", A_C, v=436, direction="above", target_cents=452),          # exactly at target: fires
                     "kreset": W("cash", A_C, k=None, direction="above", target_cents=450),         # k unset: baseline,
                     "mvdown": W("move", A_C, v=-55, move_cents=5),                                 # -55 -> -60 is 5 down: fires
                     "short": W("cash", A_C, v=436, direction="above", target_cents=453),           # 452 < 453: no
                     "stale": W("cash", A_C, pa=T2, v=436, direction="above", target_cents=450),    # no newer posting: no
                     "older": W("cash", A_C, pa=T3, v=436, direction="above", target_cents=450),    # last note is newer: no
                     "beans": W("basis", A_S, period="newcrop-2026", crop="soybeans", v=-80, direction="below", target_cents=-85),
                     "gone":  W("basis", wid_for("WI", "Adell Cooperative", "Adell", "wheat"), crop="wheat", v=-90,
                                direction="below", target_cents=-50),                                # crop not on the board
                     "roll":  W("basis", A_C, period="2026-11", v=-55, direction="below", target_cents=-50),  # period gone
                     "twin":  W("move", wid_for("WI", "Twin", "Rice Lake", "corn"), v=-60, move_cents=1),
                     "mv4":   W("move", A_C, v=-56, move_cents=5),                                   # -56 -> -60 is 4: no
                     "mv5":   W("move", A_C, v=-65, move_cents=5),                                   # -65 -> -60 is 5: fires (up)
                     "legacy": {"label": "ADM, corn", "k": None, "s": None},                         # plan() owns it
                 }}]
    watchers[0]["w"]["kreset"]["s"] = {"pa": T1, "v": 436}           # an old note left behind, k unset: still a baseline
    cf, sends, bs = plan_alerts(watchers, idx, NOW)
    assert [x[1] for x in cf] == ["p1"], cf
    assert cf[0][2] == "Adell Cooperative, Adell, WI, corn Oct 2026: cash at or above $4.50", \
        "the confirm names the elevator from the bid row, not the free-text label"
    assert sorted(x[1] for x in bs) == ["kreset", "new"] and bs[0][4] == 452, bs
    got = {x[1]: x for x in sends}
    assert sorted(got) == ["beans", "edge", "edgeup", "mv5", "mvdown", "up"], sorted(got)
    assert got["up"][4] == 436 and got["up"][5]["cash"] == 452, "old value is the last note, new is the posting"
    assert got["beans"][3] == "basis" and got["beans"][5]["basis"] == -85
    assert got["mv5"][4] == -65 and got["mv5"][5]["basis"] == -60
    legacy_view = {k: {"basis": -1, "changedOn": "2026-10-01", "lastSeen": "2026-10-01"}
                   for k in list(watchers[0]["w"]) + list(watchers[0]["pend"]) if k != "legacy"}
    cf0, ch0, bs0 = plan([dict(watchers[0], w={k: v for k, v in watchers[0]["w"].items() if k != "legacy"})], legacy_view, NOW)
    assert (cf0, ch0, bs0) == ([], [], []), "legacy plan must not touch option alerts, even when a key collides"

    # disarm and re-arm: the marks, then the next run against the worker's state.
    assert mark_after_send("oa", got["up"]) == {"email": "f@x.com", "wid": "up", "fired": True}
    assert mark_after_send("oa", got["beans"])["fired"] is True
    m = mark_after_send("oa", got["mv5"])
    assert m["s"] == {"pa": T2, "v": -60} and "fired" not in m, m
    assert mark_after_send("oc", cf[0]) == {"email": "f@x.com", "wid": "p1", "confirm_mailed": True}
    w2 = dict(watchers[0]["w"])
    del w2["up"]                                                     # the worker removes a fired one-shot
    w2["mv5"] = dict(w2["mv5"], k=m["k"], s=m["s"])                  # and re-arms the move at -60
    nxt = [{"email": "f@x.com", "pend": {}, "w": w2}]
    _, s2, _ = plan_alerts(nxt, idx, NOW)
    assert "up" not in {x[1] for x in s2} and "mv5" not in {x[1] for x in s2}, "disarmed is gone; re-armed is stale until a new post"
    data2 = json.loads(json.dumps(data))
    data2["places"][0]["pricedAt"] = T3
    data2["places"][0]["now"]["corn"]["basisCents"] = -64          # 4 from the re-armed -60: no
    _, s3, _ = plan_alerts(nxt, load_net_index(data2, NOW), NOW)
    assert "mv5" not in {x[1] for x in s3}, "re-armed move measures from the new level"
    data2["places"][0]["now"]["corn"]["basisCents"] = -55          # 5 the other way: fires
    _, s4, _ = plan_alerts(nxt, load_net_index(data2, NOW), NOW)
    assert "mv5" in {x[1] for x in s4} and "mv4" not in {x[1] for x in s4}, s4      # mv4: -56 -> -55 is 1
    assert {x[1]: x for x in s4}["mv5"][4] == -60
    data2["places"][0]["pricedAt"] = None                            # no posting time: never inferred
    assert [x[1] for x in plan_alerts(nxt, load_net_index(data2, NOW), NOW)[1]] == ["edge"], \
        "Adell has no posting time: none of its alerts send; Bloomer's still does"

    # the email: elevator, crop, period, old and new, posting time, the card
    mm = opt_alert_email("f@x.com", "up", got["up"][2], "cash", 436, got["up"][5], "https://w.dev", "sec", "AGSIST", "n@agsist.com", None)
    body = mm.get_body(("plain",)).get_content()
    for part in ("Adell Cooperative, Adell, WI, corn Oct 2026", "Cash: $4.52 now, $4.36 when this alert started.", "Oct 3, 11:30 AM CT",
                 "https://agsist.com/#f1", "fired and is now cleared", "PO Box 243", "elevator-watch-unsubscribe?e=f%40x.com&w=up&t="):
        assert part in body, part
    assert mm["Subject"] == "Adell Cooperative, Adell, WI, corn Oct 2026: cash reached $4.52", mm["Subject"]
    mv = opt_alert_email("f@x.com", "mv5", got["mv5"][2], "move", -65, got["mv5"][5], "https://w.dev", "sec", "AGSIST", "n@agsist.com", None)
    assert "Basis: \u221260\u00a2 now, \u221265\u00a2 at the last alert" in mv.get_body(("plain",)).get_content() and "cleared" not in mv.get_body(("plain",)).get_content()
    assert "<b>spoof</b>" not in opt_confirm_email("f@x.com", "p1", cf[0][2], "https://w.dev", "sec", "AGSIST", "n@agsist.com", None).as_string()

    # the Daily's block
    dl = daily_lines(watchers, idx, {})
    lines = dl["f@x.com"]
    assert "Adell Cooperative, Adell, WI, corn Oct 2026: $4.52, basis \u221260\u00a2, posted Oct 3, 11:30 AM CT" in lines, lines
    assert any(x.endswith("\u2014 not on the board this morning") for x in lines), "a missing row says so"
    assert any(x == "ADM, corn: \u2014 not in the basis files this morning" for x in lines)
    assert len(lines) == len(set(lines)), "one line per elevator, crop and period"
    assert daily_lines([{"email": "z@x.com", "w": {}}], idx, {}) == {}
    both = daily_lines([{"email": "y@x.com", "w": {A_C: {"label": "Adell, corn", "k": "x", "s": {}},
                                                   "c1": W("cash", A_C, v=436, direction="above", target_cents=450)}}],
                       idx, {A_C: {"basis": -70, "changedOn": "2026-09-01"}})["y@x.com"]
    assert both == ["Adell Cooperative, Adell, WI, corn Oct 2026: $4.52, basis \u221260\u00a2, posted Oct 3, 11:30 AM CT"], \
        "a plain watch and an alert on the same row print one line, from the card's row, not a second figure from data/basis"


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
    now_ms = time.time() * 1000
    net_idx = load_net_index(fetch_net_index(), now_ms)
    watchers = worker(base, "elevator-watch-list", tok)
    confirms, chg, bs = plan(watchers, basis_idx, now_ms)
    oconf, osend, obase = plan_alerts(watchers, net_idx, now_ms)
    print(f"basis rows indexed {len(basis_idx)}; network rows indexed {len(net_idx)}; watchers {len(watchers)}; "
          f"confirmations {len(confirms)}+{len(oconf)}; changes {len(chg)}; alerts {len(osend)}; baselines {len(bs)}+{len(obase)}")
    if dry:
        for x in confirms + oconf:
            print("would confirm", x)
        for x in chg:
            print("would mail", x[0], x[1], x[2], "basis", x[3], "->", x[4]["basis"])
        for x in osend:
            print("would alert", x[0], x[1], x[2], x[3], x[4], "->", x[5]["cash" if x[3] == "cash" else "basis"], "posted", x[5]["pricedAt"])
        return 0
    for e, w, label, row in bs:                    # silent, no mail
        worker(base, "elevator-watch-mark", tok, {"email": e, "wid": w, "label": label, "k": basis_key(row), "s": {"basis": row["basis"]}})
    for e, w, label, row, val in obase:            # silent, no mail: the last note an alert compares against
        worker(base, "elevator-watch-mark", tok, dict({"email": e, "wid": w}, **alert_mark(row, val)))
    fn, fa, rt = env("FROM_NAME", "AGSIST Cash Bids"), env("FROM_ADDR") or env("SMTP_USER"), env("REPLY_TO")
    sent, failed = 0, []
    jobs = ([("c", x) for x in confirms] + [("oc", x) for x in oconf]
            + [("m", x) for x in chg] + [("oa", x) for x in osend])
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
                    elif kind == "oc":
                        msg = opt_confirm_email(e, w, label, base, secret, fn, fa, rt)
                    elif kind == "oa":
                        msg = opt_alert_email(e, w, label, x[3], x[4], x[5], base, secret, fn, fa, rt)
                    else:
                        msg = change_email(e, w, label, x[3], x[4], base, secret, fn, fa, rt)
                    conn.send_message(msg)
                    sent += 1
                    worker(base, "elevator-watch-mark", tok, mark_after_send(kind, x))
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
