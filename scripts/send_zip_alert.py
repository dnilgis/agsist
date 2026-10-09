#!/usr/bin/env python3
"""
ZIP-wide cash alert: "Email me when anyone within N mi of <ZIP> pays $X for
<crop>". The sender. Runs in Actions (elevator-watch.yml, the step after
send_elevator_watch.py), same shape and same rules as that script.

STORED WITH NO WORKER CHANGE. The page (components/cb-alerts.js) posts an
ordinary elevator alert to /elevator-watch-subscribe, kind=cash, the shape
worker v5.3 already validates and keeps:
    ewid    "ab" + 5-digit ZIP + 3-digit miles, e.g. ab54728025
            (hex digits only, so it passes the worker's ewid check; a real
            elevator ewid is an 8-char hash, so this never names one)
    crop    corn | soybeans | wheat | sorghum | oats
    period  "nearby", plabel "nearest delivery"
    direction "above", target_cents 100..3200
The worker's double opt-in, 5-per-address cap, HMAC confirm and unsubscribe
links (elevator-watch-confirm / elevator-watch-unsubscribe) all apply as they
are. send_elevator_watch.py skips these records (is_zip_alert).

WHAT IS READ. The bids repo's data/merged-index.json (the network the card
reads) and its ZIP table (data/zips/<first two digits>.json). Each place's
`now[crop]` is its nearest open delivery, with the place's own pricedAt as
the posting time. The licensed feed is never read here: it carries no
posting time, and its rows are not ours to redistribute by email. A place
the index marks as coming from it (via "barchart") is skipped outright.
A place counts when it is: USD, has a coordinate, within N miles of the
ZIP's centroid (same haversine as cash-bids.html netDistanceMi), cash inside
the crop's per-bushel band, a delivery window not yet closed, and posted
within MAX_AGE_H hours (a board not read for days is not "paying" anything).

ONE EMAIL PER CROSSING. State lives in the worker's mark (s.on):
  * off (or never marked) and at least one counted place is at or above the
    target: one email listing every such place (name, town, miles, delivery,
    cash, posted time), then s.on = true.
  * on and the counted places are ALL below the target: mark s.on = false
    and mail nothing. The next crossing mails again.
  * no counted place at all (index down, ZIP unknown, every board stale):
    nothing is sent and nothing is recorded. No evidence is not "dropped below".
The first run after confirming starts from off, so an alert set below what
someone already pays mails once right away, and says so in the email.

Rules (as send_elevator_watch.py): never invent a figure; one mark per
message, written right after it is sent; a failed send never marks.
Env: LIST_URL, LIST_TOKEN, UNSUB_SECRET, SMTP_*, FROM_*, REPLY_TO, DRY_RUN,
MAX_SENDS. For tests and dry runs: NET_INDEX_FILE (a merged-index.json),
ZIPS_DIR (a folder of zips/<nn>.json), WATCH_LIST_FILE (the worker's
/elevator-watch-list answer as JSON). With WATCH_LIST_FILE and DRY_RUN=1 no
worker, no SMTP and no secret is needed.
"""
import html as H
import json
import math
import os
import smtplib
import ssl
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import send_elevator_watch as sew  # noqa: E402

ZIPS_URL = "https://dnilgis.github.io/bids/data/zips/{}.json"
RADII = (10, 25, 50, 75, 100)           # what components/cb-alerts.js offers
MAX_AGE_H = 96                          # a Friday board still counts on Monday afternoon
MAX_LINES = 12                          # places listed in one email; the rest are counted
CARD_URL = sew.SITE + "/cash-bids"
EARTH_MI = 3958.7613                    # cash-bids.html netDistanceMi()


def parse_ewid(ewid):
    """(zip, miles) from "ab" + ZIP + 3-digit miles, or None."""
    m = sew.ZIP_EWID.match(str(ewid or ""))
    if not m:
        return None
    mi = int(m.group(2))
    return (m.group(1), mi) if mi in RADII else None


def miles(a, b):
    rad = math.pi / 180
    dlat, dlon = (b[0] - a[0]) * rad, (b[1] - a[1]) * rad
    s = math.sin(dlat / 2) ** 2 + math.cos(a[0] * rad) * math.cos(b[0] * rad) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_MI * math.asin(min(1, math.sqrt(s)))


def zip_coord(zip5, tables):
    """[lat, lon] from the bids repo's ZIP table, or None. `tables` maps the
    two-digit prefix to its loaded table (None when it could not be read)."""
    t = tables.get(zip5[:2]) if zip5 else None
    p = t.get(zip5) if isinstance(t, dict) else None
    if not isinstance(p, list) or len(p) < 2:
        return None
    try:
        lat, lon = float(p[0]), float(p[1])
    except (TypeError, ValueError):
        return None
    if not (math.isfinite(lat) and math.isfinite(lon)) or (lat == 0 and lon == 0):
        return None
    return (lat, lon)


def places_for(data, crop, coord, radius, now_ms):
    """Every place the alert counts, nearest-delivery row for `crop`, highest
    cash first (then nearest, then name). Each row carries what the email prints."""
    out = []
    if not isinstance(data, dict) or coord is None or crop not in sew.PPU_BAND:
        return out
    month = sew.ct_month(now_ms)
    for p in data.get("places") or []:
        if not isinstance(p, dict) or str(p.get("via") or "").lower() == "barchart":
            continue
        if (p.get("currency") or "USD") != "USD" or p.get("mappable") is False:
            continue
        lat, lon = p.get("lat"), p.get("lon")
        if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)) or (lat == 0 and lon == 0):
            continue
        n = (p.get("now") or {}).get(crop)
        if not isinstance(n, dict) or not isinstance(n.get("cash"), (int, float)):
            continue
        cash = sew.ppu(n["cash"])
        lo, hi = sew.PPU_BAND[crop]
        if not (lo <= cash <= hi):
            continue
        period = str(n.get("period") or "")
        end = period.split("/")[-1]
        if len(end) >= 7 and end[:4].isdigit() and end[4] == "-" and end[:7] < month:
            continue
        pa = sew.parse_iso(p.get("pricedAt"))
        if pa is None or now_ms - pa.timestamp() * 1000 > MAX_AGE_H * 3600e3:
            continue
        d = miles(coord, (float(lat), float(lon)))
        if d > radius:
            continue
        out.append({"state": p.get("state") or "", "facility": p.get("operator") or "", "city": p.get("city") or "",
                    "town": p.get("town") or "", "crop": crop, "period": period,
                    "plabel": sew.period_label(period, n.get("delivery") or "") or "delivery not named",
                    "cash": int(round(cash * 100)), "basis": sew.basis_cents_of(n),
                    "pricedAt": p.get("pricedAt"), "miles": d})
    out.sort(key=lambda r: (-r["cash"], r["miles"], r["facility"], r["city"]))
    return out


def valid_opts(st):
    """(zip, miles, crop, target) when the record is one this job can act on."""
    if not sew.is_zip_alert(st):
        return None
    zm = parse_ewid(st.get("ewid"))
    crop, t = st.get("crop"), st.get("target_cents")
    if not zm or crop not in sew.PPU_BAND or st.get("direction") != "above":
        return None
    if not isinstance(t, int) or isinstance(t, bool) or not (100 <= t <= 3200):
        return None
    return zm[0], zm[1], crop, t


def zip_label(zip5, radius, crop, target):
    """Built from the validated fields, never from the free text the page sent."""
    return (f"Any elevator within {radius} mi of ZIP {zip5}, {sew.CROP_NAMES[crop]}, nearest delivery: "
            f"cash at or above {sew.fmt_cash(target)}")


def plan(watchers, data, tables, now_ms):
    """Pure. Returns (confirms, sends, rearms, counts).
    confirms [(email, wid, label)]
    sends    [(email, wid, label, hits, zip, radius, crop, target, first)]  first: no mark yet
    rearms   [(email, wid, label, best_row)]   every counted place is below: s.on -> false, no mail
    counts   {reason: n} for the log; never an address."""
    confirms, sends, rearms = [], [], []
    n = {"pending to confirm": 0, "pending already mailed": 0, "pending expired": 0, "pending ZIP unknown": 0,
         "invalid": 0, "no places": 0, "still on": 0, "still below": 0}
    for r in watchers or []:
        e = r.get("email")
        for w, p in (r.get("pend") or {}).items():
            if not sew.is_zip_alert(p):
                continue
            o = valid_opts(p)
            if not o:
                n["invalid"] += 1
            elif p.get("m"):
                n["pending already mailed"] += 1
            elif now_ms - p.get("ts", 0) > sew.PEND_TTL_MS:
                n["pending expired"] += 1
            elif zip_coord(o[0], tables) is None:
                n["pending ZIP unknown"] += 1
            else:
                n["pending to confirm"] += 1
                confirms.append((e, w, zip_label(*o)))
        for w, st in (r.get("w") or {}).items():
            if not sew.is_zip_alert(st):
                continue
            o = valid_opts(st)
            if not o:
                n["invalid"] += 1
                continue
            zip5, radius, crop, target = o
            rows = places_for(data, crop, zip_coord(zip5, tables), radius, now_ms)
            if not rows:
                n["no places"] += 1
                continue
            first = st.get("k") is None
            on = (not first) and bool((st.get("s") or {}).get("on"))
            hits = [x for x in rows if x["cash"] >= target]
            label = zip_label(*o)
            if hits and not on:
                sends.append((e, w, label, hits, zip5, radius, crop, target, first))
            elif not hits and on:
                rearms.append((e, w, label, rows[0]))
            elif hits:
                n["still on"] += 1
            else:
                n["still below"] += 1
    return confirms, sends, rearms, n


def state_mark(e, w, on, row):
    """The one worker write: on/off, and the figure and posting that decided it."""
    return {"email": e, "wid": w, "k": f"{'on' if on else 'off'}|{row['pricedAt']}|{row['cash']}",
            "s": {"on": on, "v": row["cash"], "pa": row["pricedAt"]}}


def mark_after_send(job, x):
    if job == "c":
        return {"email": x[0], "wid": x[1], "confirm_mailed": True}
    return state_mark(x[0], x[1], True, x[3][0])


def place_line(r):
    return (f"{sew.net_name(r)} · {r['miles']:.0f} mi · {r['plabel']} · "
            f"{sew.fmt_cash(r['cash'])} · posted {sew.fmt_posted(r['pricedAt'])}")


def confirm_email(w, wid, label, base, secret, fn, fa, rt):
    go = sew.link(base, "elevator-watch-confirm", w, wid, secret, "c")
    stop = sew.link(base, "elevator-watch-unsubscribe", w, wid, secret, "w1")
    m = sew.base_msg(w, "Confirm: ZIP cash alert on AGSIST", fn, fa, rt, stop)
    how = ("You get one email when an elevator in range posts at or above your price. "
           "After that, no more emails until every elevator in range is back below it and one crosses again.")
    m.set_content(f"Someone asked for this cash bid alert on AGSIST using this address:\n{label}\n\n"
                  f"If that was you, confirm here:\n{go}\n\n{how}\n"
                  "It reads boards AGSIST reads direct from the elevators, not every elevator in the area.\n"
                  "If it was not you, ignore this email. Nothing starts until you confirm.\n\n"
                  f"-- \n{sew.ADDRESS}\nNot me / stop: {stop}\n")
    foot = f'{H.escape(sew.ADDRESS)}<br><a href="{H.escape(stop)}" style="color:#6b6b6b">Not me / stop</a>'
    m.add_alternative(sew.html_wrap("Confirm your ZIP cash alert", [
        "Someone asked for this cash bid alert on AGSIST using this address:", label,
        "If that was you, confirm below. " + how,
        "It reads boards AGSIST reads direct from the elevators, not every elevator in the area.",
        "If it was not you, ignore this. Nothing starts until you confirm."], ("CONFIRM", go), foot), subtype="html")
    return m


def alert_email(w, wid, label, hits, zip5, radius, crop, target, first, base, secret, fn, fa, rt):
    stop1 = sew.link(base, "elevator-watch-unsubscribe", w, wid, secret, "w1")
    stopall = sew.link(base, "elevator-watch-unsubscribe", w, wid, secret, "w")
    top = hits[0]
    cropn = sew.CROP_NAMES[crop]
    subj = (f"{cropn.capitalize()} {sew.fmt_cash(top['cash'])}: {top['facility']}, "
            f"{top['miles']:.0f} mi from {zip5} (your alert {sew.fmt_cash(target)})")
    head = f"{cropn.capitalize()} at or above {sew.fmt_cash(target)} within {radius} mi of ZIP {zip5}"
    lead = (f"{len(hits)} elevator{'s' if len(hits) != 1 else ''} in range "
            f"{'is' if len(hits) == 1 else 'are'} posting {cropn} at or above {sew.fmt_cash(target)} "
            "for nearest delivery" + (", already, as your alert starts." if first else "."))
    lines = [place_line(r) for r in hits[:MAX_LINES]]
    if len(hits) > MAX_LINES:
        lines.append(f"and {len(hits) - MAX_LINES} more at or above your price.")
    tail = (f"No more emails for this alert until every elevator in range is back below {sew.fmt_cash(target)} "
            "and one crosses again.")
    note = ("These are the elevators' own posted boards, read by AGSIST, not contracts. Freight, moisture and "
            "grade discounts are theirs and not shown. Miles are straight-line from the ZIP's center. "
            "Call to confirm before you haul.")
    m = sew.base_msg(w, subj, fn, fa, rt, stop1)
    m.set_content(f"{head}\n\n{lead}\n\n" + "\n".join(lines) + f"\n\n{tail}\n\n{note}\n\n"
                  f"All bids near {zip5}:\n{CARD_URL}\n\n"
                  f"-- \n{sew.ADDRESS}\nStop this alert: {stop1}\nStop all elevator alerts: {stopall}\n")
    foot = (f'{H.escape(sew.ADDRESS)}<br><a href="{H.escape(stop1)}" style="color:#6b6b6b">Stop this alert</a> &middot; '
            f'<a href="{H.escape(stopall)}" style="color:#6b6b6b">Stop all</a>')
    m.add_alternative(sew.html_wrap(head, [lead] + lines + [tail, note], ("SEE ALL CASH BIDS", CARD_URL), foot),
                      subtype="html")
    return m


def load_zip_tables(prefixes):
    """{prefix: table or None}. ZIPS_DIR (a local folder with zips/<nn>.json or
    <nn>.json) wins, for tests."""
    out, d = {}, sew.env("ZIPS_DIR")
    for pre in sorted(prefixes):
        try:
            if d:
                f = Path(d) / f"{pre}.json"
                out[pre] = json.loads(f.read_text()) if f.exists() else None
            else:
                req = urllib.request.Request(ZIPS_URL.format(pre), headers={"User-Agent": "agsist-zip-alert/1"})
                with urllib.request.urlopen(req, timeout=30) as r:
                    out[pre] = json.loads(r.read().decode())
        except Exception as ex:
            print(f"ZIP table {pre} not read ({type(ex).__name__})")
            out[pre] = None
    return out


def zip_prefixes(watchers):
    s = set()
    for r in watchers or []:
        for part in ("pend", "w"):
            for st in (r.get(part) or {}).values():
                zm = parse_ewid((st or {}).get("ewid")) if sew.is_zip_alert(st) else None
                if zm:
                    s.add(zm[0][:2])
    return s


def selftest():
    from datetime import datetime, timezone
    NOW = datetime(2026, 10, 7, 21, 0, tzinfo=timezone.utc).timestamp() * 1000
    T = "2026-10-07T18:41:05.604Z"
    OLD = "2026-10-01T12:00:00Z"                 # six days: not counted
    tables = {"54": {"54728": [45.317, -91.6542]}}
    home = zip_coord("54728", tables)
    assert home == (45.317, -91.6542) and zip_coord("54999", tables) is None and zip_coord("50010", tables) is None
    assert parse_ewid("ab54728025") == ("54728", 25) and parse_ewid("ab54728030") is None and parse_ewid("1fa85c8e") is None

    def place(op, city, lat, lon, cash, pa=T, period="2026-10", **kw):
        p = {"operator": op, "city": city, "state": "WI", "lat": lat, "lon": lon, "currency": "USD", "via": "scrape",
             "pricedAt": pa, "now": {"corn": {"cash": cash, "basisCents": -60, "period": period, "delivery": "10/01/2026"}}}
        p.update(kw)
        return p
    data = {"places": [
        place("Near Coop", "Chetek", 45.32, -91.65, 4.55),                      # 0 mi, $4.55
        place("Mid Grain", "Rice Lake", 45.50, -91.73, 4.40),                   # ~13 mi, $4.40
        place("Far Mill", "Eau Claire", 44.81, -91.50, 4.90),                   # ~36 mi: outside 25
        place("Stale Elev", "Cameron", 45.41, -91.74, 5.00, pa=OLD),            # too old
        place("Licensed", "Barron", 45.40, -91.85, 5.00, via="barchart"),       # never read
        place("Loonie", "Chetek", 45.32, -91.65, 5.00, currency="CAD"),
        place("Cents", "Bloomer", 45.10, -91.49, 462),                          # cents: $4.62, ~17 mi
        place("Unit Slip", "Cumberland", 45.53, -92.02, 41.0),                  # out of band
        place("Closed", "Sand Creek", 45.17, -91.68, 6.00, period="2026-09"),  # window closed
    ]}
    rows = places_for(data, "corn", home, 25, NOW)
    assert [r["facility"] for r in rows] == ["Cents", "Near Coop", "Mid Grain"], [r["facility"] for r in rows]
    assert rows[0]["cash"] == 462 and rows[1]["miles"] < 1 and 10 < rows[2]["miles"] < 16, rows
    assert [r["facility"] for r in places_for(data, "corn", home, 50, NOW)][0] == "Far Mill"
    assert places_for(data, "soybeans", home, 25, NOW) == [] and places_for(None, "corn", home, 25, NOW) == []

    def alert(target, k=None, on=None, **kw):
        st = {"kind": "cash", "ewid": "ab54728025", "crop": "corn", "period": "nearby", "plabel": "nearest delivery",
              "direction": "above", "target_cents": target, "label": "<b>free text</b>", "k": k,
              "s": None if on is None else {"on": on}}
        st.update(kw)
        return st
    W = [{"email": "f@x.com",
          "pend": {"p1": dict(alert(450), ts=NOW - 1000, m=0),
                   "p2": dict(alert(450, ewid="ab99999025"), ts=NOW - 1000, m=0),   # ZIP not in the table
                   "p3": dict(alert(450), ts=NOW - 1000, m=1),
                   "p4": dict(alert(450), ts=NOW - 20 * 864e5, m=0),
                   "el": {"kind": "cash", "ewid": "1fa85c8e", "ts": NOW, "m": 0}},  # an elevator alert: not ours
          "w": {"new": alert(450),                       # first look, already met: mails, says "already"
                "fresh": alert(500),                     # first look, not met: nothing
                "on": alert(450, k="on|x", on=True),     # already mailed, still met: nothing
                "down": alert(470, k="on|x", on=True),   # mailed before, now all below: re-arm silently
                "up": alert(460, k="off|x", on=False),   # re-armed, $4.62 crosses: mails
                "edge": alert(462, k="off|x", on=False), # exactly at the price: mails
                "bad": alert(450, direction="below"),    # not a shape this job sends
                "far": alert(450, ewid="ab50010025"),    # ZIP table not loaded: nothing, no state change
                }}]
    cf, sends, rearms, n = plan(W, data, tables, NOW)
    assert [x[1] for x in cf] == ["p1"] and cf[0][2] == ("Any elevator within 25 mi of ZIP 54728, corn, nearest "
                                                          "delivery: cash at or above $4.50"), cf
    assert sorted(x[1] for x in sends) == ["edge", "new", "up"], sends
    got = {x[1]: x for x in sends}
    assert [h["facility"] for h in got["new"][3]] == ["Cents", "Near Coop"] and got["new"][8] is True
    assert [h["facility"] for h in got["up"][3]] == ["Cents"] and got["up"][8] is False
    assert [x[1] for x in rearms] == ["down"] and rearms[0][3]["cash"] == 462
    assert n["invalid"] == 1 and n["no places"] == 1 and n["still on"] == 1 and n["still below"] == 1, n
    assert n["pending ZIP unknown"] == 1 and n["pending already mailed"] == 1 and n["pending expired"] == 1, n

    # One email per crossing, run after run against the worker's own state.
    mk = mark_after_send("a", got["new"])
    assert mk == {"email": "f@x.com", "wid": "new", "k": f"on|{T}|462", "s": {"on": True, "v": 462, "pa": T}}, mk
    assert "fired" not in mk, "a ZIP alert re-arms; it is never removed by a send"
    one = [{"email": "f@x.com", "w": {"a": alert(450)}}]
    for step, (price, mails) in enumerate([(4.62, True), (4.70, False), (4.48, False), (4.49, False),
                                            (4.50, True), (4.55, False), (4.20, False), (4.51, True)]):
        d2 = {"places": [place("Only", "Chetek", 45.32, -91.65, price)]}
        _, s_, r_, _ = plan(one, d2, tables, NOW)
        assert bool(s_) == mails, (step, price, s_, r_)
        st = one[0]["w"]["a"]
        if s_:
            m_ = mark_after_send("a", s_[0])
        elif r_:
            m_ = state_mark("f@x.com", "a", False, r_[0][3])
        else:
            continue
        one[0]["w"]["a"] = dict(st, k=m_["k"], s=m_["s"])         # what /elevator-watch-mark keeps
    # No place in range at all (index down, every board stale) leaves an "on" alert on.
    stuck = [{"email": "f@x.com", "w": {"a": alert(450, k="on|x", on=True)}}]
    assert plan(stuck, {"places": []}, tables, NOW)[1:3] == ([], []), "no evidence is not a drop below"

    # The emails: every field the reader needs, built from the rows, not the form's text.
    m = alert_email("f@x.com", "new", got["new"][2], *got["new"][3:], "https://w.dev", "sec", "AGSIST", "n@agsist.com", None)
    body = m.get_body(("plain",)).get_content()
    for part in ("Cents, Bloomer, WI · 17 mi · Oct 2026 · $4.62 · posted Oct 7, 1:41 PM CT",
                 "Near Coop, Chetek, WI · 0 mi", "already, as your alert starts",
                 "until every elevator in range is back below $4.50", "PO Box 243",
                 "elevator-watch-unsubscribe?e=f%40x.com&w=new&t=", "Stop all elevator alerts"):
        assert part in body, (part, body)
    assert "Mid Grain" not in body, "a place below the price is not listed"
    assert m["Subject"] == "Corn $4.62: Cents, 17 mi from 54728 (your alert $4.50)", m["Subject"]
    assert m["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
    assert "already" not in alert_email("f@x.com", "up", got["up"][2], *got["up"][3:], "https://w.dev", "sec", "A",
                                        "n@agsist.com", None).get_body(("plain",)).get_content()
    c = confirm_email("f@x.com", "p1", cf[0][2], "https://w.dev", "sec", "AGSIST", "n@agsist.com", None)
    cb = c.get_body(("plain",)).get_content()
    assert "elevator-watch-confirm?e=f%40x.com&w=p1&t=" in cb and "<b>free text</b>" not in c.as_string()
    assert "back below it and one crosses again" in cb
    many = [dict(rows[0], facility=f"E{i}") for i in range(15)]
    mb = alert_email("f@x.com", "x", "l", many, "54728", 25, "corn", 450, False, "https://w.dev", "s", "A", "n@agsist.com",
                     None).get_body(("plain",)).get_content()
    assert "and 3 more at or above your price." in mb and mb.count(" mi · ") == MAX_LINES
    assert zip_prefixes(W) == {"54", "99", "50"}
    print("zip alert selftest ok")


def fetch_watchers(base, tok):
    f = sew.env("WATCH_LIST_FILE")
    if f:
        return json.loads(Path(f).read_text())
    return sew.worker(base, "elevator-watch-list", tok)


def main():
    if "--selftest" in sys.argv:
        selftest()
        return 0
    dry = sew.env("DRY_RUN") == "1"
    base = (sew.env("LIST_URL", "") or "").rstrip("/")
    tok, secret = sew.env("LIST_TOKEN"), sew.env("UNSUB_SECRET")
    if not (dry and sew.env("WATCH_LIST_FILE")) and not (base and tok and secret):
        print("LIST_URL, LIST_TOKEN and UNSUB_SECRET are required")
        return 1
    cap = int(sew.env("MAX_SENDS", "100"))
    now_ms = float(sew.env("NOW_MS", "0") or 0) or time.time() * 1000
    watchers = fetch_watchers(base, tok)
    if not any(sew.is_zip_alert(st) for r in watchers for part in ("pend", "w") for st in (r.get(part) or {}).values()):
        print("ZIP alerts: none on the list")
        return 0
    data = sew.fetch_net_index()
    tables = load_zip_tables(zip_prefixes(watchers))
    confirms, sends, rearms, n = plan(watchers, data, tables, now_ms)
    print(f"ZIP alerts: confirmations {len(confirms)}; alerts {len(sends)}; re-armed {len(rearms)}; "
          + "; ".join(f"{k} {v}" for k, v in n.items()))
    if dry:
        for x in confirms:
            print("would confirm", x[0], x[1], x[2])
        for x in sends:
            print("would alert", x[0], x[1], x[2], "|", len(x[3]), "at or above; top", x[3][0]["facility"],
                  sew.fmt_cash(x[3][0]["cash"]), f"{x[3][0]['miles']:.0f} mi", "posted", x[3][0]["pricedAt"])
        for x in rearms:
            print("would re-arm", x[0], x[1], x[2], "| best now", sew.fmt_cash(x[3]["cash"]))
        return 0
    for e, w, label, row in rearms:                        # silent: dropped back below
        sew.worker(base, "elevator-watch-mark", tok, state_mark(e, w, False, row))
    fn, fa, rt = sew.env("FROM_NAME", "AGSIST Cash Bids"), sew.env("FROM_ADDR") or sew.env("SMTP_USER"), sew.env("REPLY_TO")
    sent, failed = 0, []
    jobs = [("c", x) for x in confirms] + [("a", x) for x in sends]
    if jobs and cap > 0:
        ctx = ssl.create_default_context()

        def connect():
            c = smtplib.SMTP(sew.env("SMTP_HOST", "smtp.gmail.com"), int(sew.env("SMTP_PORT", "587")), timeout=30)
            c.starttls(context=ctx)
            c.login(sew.env("SMTP_USER"), sew.env("SMTP_PASS"))
            return c
        conn, reconnects = connect(), 0
        try:
            for kind, x in jobs[:cap]:
                e, w, label = x[0], x[1], x[2]
                try:
                    if kind == "c":
                        msg = confirm_email(e, w, label, base, secret, fn, fa, rt)
                    else:
                        msg = alert_email(e, w, label, *x[3:], base, secret, fn, fa, rt)
                    conn.send_message(msg)
                    sent += 1
                    sew.worker(base, "elevator-watch-mark", tok, mark_after_send(kind, x))
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
