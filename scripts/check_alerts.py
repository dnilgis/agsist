#!/usr/bin/env python3
"""
AGSIST hail alert checker — runs after the MESH workflow archives a new
swath day. For every registered watch area (pin + radius, stored in the
subs worker's KV), tests whether any radar-estimated hail band intersects
the area, and emails an honest notice for hits: what the radar estimated,
where, the band size, and a dated map link — always labeled an estimate,
never a measurement.

Env (same family as send_daily.py):
    LIST_URL, LIST_TOKEN        subs worker base URL + auth (required)
    UNSUB_SECRET                signs the one-click stop link (required)
    SMTP_HOST/PORT/USER/PASS    transport (Gmail app password fine)
    FROM_ADDR, FROM_NAME, REPLY_TO
    DRY_RUN=1                   evaluate + report, send nothing
    ALERT_DATE=YYYY-MM-DD       override (default: newest date in the
                                MESH index — the day mesh.yml just added)

Idempotence: one run per MESH day; the workflow chains to mesh.yml, which
runs once daily, so a subscriber gets at most one email per swath day.
Requires: shapely (installed by the workflow).
"""
import hashlib
import hmac
import json
import math
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

from shapely.geometry import Point, shape
from shapely.geometry.base import BaseMultipartGeometry
from shapely.ops import unary_union
from shapely.validation import explain_validity, make_valid

REPO = Path(__file__).resolve().parent.parent
MESH_DIR = REPO / "data" / "hail" / "mesh"
MAP = "https://agsist.com/hail-map"


def env(name, default=None, required=False):
    v = os.environ.get(name, default)
    if isinstance(v, str):
        v = v.strip()          # secrets pasted with trailing newlines must never break auth
    if required and not v:
        print("FATAL: missing env " + name)
        sys.exit(1)
    return v


def newest_mesh_date():
    forced = env("ALERT_DATE")
    if forced:
        return forced
    idx = MESH_DIR / "index.json"
    if not idx.exists():
        print("no MESH index — nothing to check. exit 0")
        sys.exit(0)
    dates = json.load(open(idx)).get("dates", [])
    if not dates:
        print("MESH index empty — exit 0")
        sys.exit(0)
    return sorted(dates)[-1]


# How far a repair may move a band's area before this stops trusting the file.
# Measured over the 30 archived days to 2026-08-31: 25 carried an invalid band
# and the worst repair moved 5.667% (2026-08-05); the median was under 0.3%.
# Ten percent is well clear of ordinary repair noise and well under the kind of
# move that would mean the swath itself is wrong.
REPAIR_AREA_TOLERANCE_PCT = 10.0


def _areal(g):
    """make_valid can return stray lines and points. A hail band is an area."""
    if g.geom_type in ("Polygon", "MultiPolygon"):
        return g
    if isinstance(g, BaseMultipartGeometry):
        parts = [x for x in g.geoms if x.geom_type in ("Polygon", "MultiPolygon")]
        return unary_union(parts) if parts else None
    return None


def load_bands(day):
    """{thresh_in: shapely geometry} — bands are stacked (each threshold's
    polygon covers everything >= it), so a point's band = max thresh whose
    geometry contains it.

    ── THE ARCHIVE CONTAINS INVALID GEOMETRY AND ALWAYS WILL ───────────────
    Until 2026-09-01 the mesh pipeline wrote every contour ring as its own
    hole-less polygon, so a hole in a swath came out as a solid shell nested
    inside another. `scripts/fetch_mesh.py` no longer does that — but the 117
    files already in the archive were written by the old one and nothing is
    going to rewrite them.

    Measured over the 30 days to 2026-08-31: 25 carried an invalid band, and
    on 9 of those `unary_union` raised outright. This job died on exactly that
    on 2026-09-01 — `TopologyException: side location conflict at
    -110.85998098859315 40.175954372623572` — and mailed nobody.

    So a repair happens here, and it is REPORTED rather than done quietly:
    a band whose area moves under repair is a band whose alerts move with it,
    and a grower who is not told is worse off than one who sees a red run.
    """
    p = MESH_DIR / (day + ".json")   # NB: the mesh pipeline writes .json, not .geojson
    if not p.exists():
        print("no swath file for " + day + " — quiet day or not yet fetched. exit 0")
        sys.exit(0)
    gj = json.load(open(p))
    by_t = {}
    for f in gj.get("features", []):
        t = f["properties"]["thresh_in"]
        by_t.setdefault(t, []).append(shape(f["geometry"]))

    bands, refuse = {}, []
    for t, gs in sorted(by_t.items()):
        fixed, before = [], 0.0
        for g in gs:
            before += g.area
            if g.is_valid:
                fixed.append(g)
                continue
            why = explain_validity(g)
            r = _areal(make_valid(g))
            if r is None or r.is_empty:
                refuse.append("%.2f\" band: %s repaired to nothing" % (t, why))
                continue
            print("  repaired the %.2f\" band: %s" % (t, why))
            fixed.append(r)
        if not fixed:
            continue
        u = unary_union(fixed)
        after = u.area
        moved = (after - before) / before * 100.0 if before else 0.0
        if abs(moved) > 0.0005:
            print("  %.2f\" band area moved %+.3f%% under repair" % (t, moved))
        if abs(moved) > REPAIR_AREA_TOLERANCE_PCT:
            refuse.append("%.2f\" band moved %+.3f%% under repair, past the %.1f%% limit"
                          % (t, moved, REPAIR_AREA_TOLERANCE_PCT))
        bands[t] = u

    # A REFUSAL, NOT A QUIET ALERT OFF A MANGLED BAND. If the geometry cannot
    # be trusted the run goes red and somebody looks; it does not mail a
    # smaller swath and say nothing.
    if refuse:
        print("REFUSING to alert on " + day + ":")
        for r in refuse:
            print("  - " + r)
        sys.exit(1)
    return bands


def watch_circle(lat, lon, radius_mi):
    """Radius circle in degree space with longitude corrected for latitude —
    accurate to well under 2% at alert scales (1–10 mi, CONUS)."""
    r_deg = radius_mi / 69.0
    pts = []
    coslat = math.cos(math.radians(lat)) or 1e-6
    for k in range(48):
        a = 2 * math.pi * k / 48
        pts.append((lon + (r_deg * math.cos(a)) / coslat, lat + r_deg * math.sin(a)))
    from shapely.geometry import Polygon
    return Polygon(pts)


def day_flag(day, set_it=False):
    base, token = (os.environ.get("LIST_URL") or "").strip() or None, (os.environ.get("LIST_TOKEN") or "").strip() or None
    if not (base and token):
        return False
    u = (base.rstrip("/") + "/flag?k=alerted:" + day + "&token=" + urllib.parse.quote(token))
    try:
        req = urllib.request.Request(u, method="POST" if set_it else "GET", headers={"User-Agent": "AGSIST-automation/1.0 (+https://agsist.com; sig@farmers1st.com)"})
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode()).get("set", False)
    except Exception as ex:
        print("flag check unavailable (" + type(ex).__name__ + ") — proceeding")
        return False


def fetch_watchers():
    base = env("LIST_URL", required=True).rstrip("/")
    token = env("LIST_TOKEN", required=True)
    u = base + "/alert-list?token=" + urllib.parse.quote(token)
    req_ = urllib.request.Request(u, headers={"User-Agent": "AGSIST-automation/1.0 (+https://agsist.com; sig@farmers1st.com)"})
    with urllib.request.urlopen(req_, timeout=30) as r:
        return json.loads(r.read().decode())


def stop_url(email):
    base = env("LIST_URL").rstrip("/")
    secret = env("UNSUB_SECRET", required=True)
    t = hmac.new(secret.encode(), email.lower().encode(), hashlib.sha256).hexdigest()[:16]
    return base + "/alert-unsubscribe?e=" + urllib.parse.quote(email.lower()) + "&t=" + t


def build_email(w, day, band, from_name, from_addr, reply_to):
    place = w.get("place") or (str(w["lat"]) + ", " + str(w["lon"]))
    radius = w.get("radius_mi", 5)
    link = MAP + "?swath=" + day
    stop = stop_url(w["email"])

    msg = EmailMessage()
    msg["Subject"] = "Hail alert — radar-estimated hail near " + place + " (" + day + ")"
    msg["From"] = formataddr((from_name, from_addr))
    msg["To"] = w["email"]
    msg["Message-ID"] = make_msgid(domain=from_addr.split("@", 1)[1])
    if reply_to:
        msg["Reply-To"] = reply_to
    msg["List-Unsubscribe"] = "<" + stop + ">"
    msg["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"

    text = ("HAIL ALERT — " + day + "\n\n"
            "Radar-estimated hail of " + str(band) + "\u2033 or larger touched the "
            + str(radius) + "-mile watch area around " + place + " yesterday.\n\n"
            "This is a radar ESTIMATE (NOAA MRMS MESH), not a ground measurement. "
            "Stones may have been smaller, larger, or absent at your exact spot — "
            "pair it with what you can see on the ground.\n\n"
            "See the dated swath map and pull the ground reports near you:\n"
            + link + "\n\n"
            "If damage is possible: photograph everything with today's date "
            "before cleanup, and note the time hail fell if you saw it.\n\n"
            "\u2014\nAGSIST hail alerts \u00b7 free \u00b7 agsist.com/hail-map\n"
            "Stop these alerts: " + stop + "\n")
    msg.set_content(text)

    import html as H
    e = H.escape
    hbody = (
        '<div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;'
        'padding:24px 16px;color:#1a1a1a;background:#ffffff">'
        '<div style="font-family:Courier,monospace;font-size:12px;color:#6b6b6b;'
        'letter-spacing:.08em;text-transform:uppercase">AGSIST hail alert &middot; '
        + e(day) + "</div>"
        '<h1 style="font-size:20px;line-height:1.3;margin:10px 0 12px">Radar-estimated hail near '
        + e(place) + "</h1>"
        '<p style="font-family:Courier,monospace;font-size:15px;'
        'border-left:3px solid #b58a2e;padding-left:10px;margin:0 0 14px">'
        "<strong>" + e(str(band)) + "&Prime; band</strong> touched your "
        + e(str(radius)) + "-mile watch area</p>"
        '<p style="font-size:14px;line-height:1.6;margin:0 0 14px">This is a radar '
        "<strong>estimate</strong> (NOAA MRMS MESH), not a ground measurement. Stones may "
        "have been smaller, larger, or absent at your exact spot &mdash; pair it with what "
        "you can see on the ground.</p>"
        '<p style="margin:18px 0"><a href="' + link + '" '
        'style="background:#14100a;color:#e9dfc9;text-decoration:none;'
        'padding:10px 18px;font-family:Courier,monospace;font-size:13px">'
        "SEE THE DATED SWATH MAP &#8594;</a></p>"
        '<p style="font-size:13px;line-height:1.6;color:#444">If damage is possible: '
        "photograph everything with today's date before cleanup.</p>"
        '<p style="font-size:12px;color:#6b6b6b;line-height:1.5">AGSIST hail alerts &middot; free &middot; '
        '<a href="https://agsist.com/hail-map" style="color:#6b6b6b">agsist.com/hail-map</a>'
        '<br><a href="' + stop + '" style="color:#6b6b6b">Stop these alerts</a></p></div>')
    msg.add_alternative(hbody, subtype="html")
    return msg


def main():
    day = newest_mesh_date()
    bands = load_bands(day)
    thresholds = sorted(bands.keys())
    watchers = fetch_watchers()
    print("swath day " + day + " · bands " + str(thresholds) + " · watchers " + str(len(watchers)))
    if not watchers:
        print("no watch areas registered — exit 0")
        return 0

    dry = env("DRY_RUN", "") == "1"
    if not dry and day_flag(day):
        print("alerts already sent for " + day + " (day-flag set) — skipping. exit 0")
        return 0
    from_addr = env("FROM_ADDR") or env("SMTP_USER", required=not dry)
    from_name = env("FROM_NAME", "AGSIST Hail Alerts")
    reply_to = env("REPLY_TO")

    hits = []
    for w in watchers:
        try:
            circle = watch_circle(float(w["lat"]), float(w["lon"]), int(w.get("radius_mi", 5)))
        except (KeyError, TypeError, ValueError):
            continue
        band = None
        for t in thresholds:                     # ascending; keep the max that intersects
            if bands[t].intersects(circle):
                band = t
        if band is not None:
            hits.append((w, band))
    print("hits: " + str(len(hits)))
    for w, band in hits:
        print("  " + w["email"] + " · " + str(w.get("place", "")) + " · band " + str(band) + "\u2033")
    if dry or not hits:
        print("dry run — nothing sent" if dry else "no watch areas touched — nothing to send")
        return 0

    host = env("SMTP_HOST", "smtp.gmail.com")
    port = int(env("SMTP_PORT", "587"))
    user = env("SMTP_USER", required=True)
    pw = env("SMTP_PASS", required=True)
    sent, failed = 0, []
    ctx = ssl.create_default_context()

    def connect():
        """A fresh, logged-in connection. Called again if one dies mid-list."""
        c = smtplib.SMTP(host, port, timeout=30)
        c.starttls(context=ctx)
        c.login(user, pw)
        return c

    # BARE Exception, NOT smtplib.SMTPException. A socket timeout, an SSLError
    # or a reset connection is not an SMTPException: it escaped this loop, the
    # step died, and day_flag() -- which is below -- never ran, so the rerun
    # re-alerted everyone who had already been emailed. send_daily.py was
    # widened for exactly this reason and carries the same comment. This is the
    # defect that sent AGSIST Daily #177 seven times in one afternoon.
    #
    # AND ONE RECONNECT. A single connection served the whole list, so a drop
    # at recipient N meant everyone after N got nothing, silently, while
    # `sent > 0` still flagged the day as delivered. One reconnect per failure,
    # at most three in a run, so a bad socket costs one email and not the tail
    # of the list.
    conn = connect()
    reconnects, MAX_RECONNECTS = 0, 3
    try:
        for i, (w, band) in enumerate(hits):
            try:
                conn.send_message(build_email(w, day, band, from_name, from_addr, reply_to))
                sent += 1
            except Exception as ex:
                failed.append(w["email"] + " (" + type(ex).__name__ + ")")
                # A CONNECTION-LEVEL FAILURE POISONS EVERY REMAINING SEND.
                # A rejected address does not; only reconnect for the former.
                #
                # AND THE ORDER OF THESE TESTS MATTERS, because
                # smtplib.SMTPException INHERITS FROM OSError in Python 3:
                #
                #     (SMTPException, OSError, Exception, BaseException)
                #
                # so a bare `isinstance(ex, OSError)` is true for every SMTP
                # error there is, and one subscriber with a typo in their
                # address would open a fresh connection. A raw socket error is
                # an OSError that is NOT an SMTPException; that is the one that
                # means the pipe is dead.
                fatal = (isinstance(ex, (smtplib.SMTPServerDisconnected,
                                         smtplib.SMTPConnectError))
                         or (isinstance(ex, OSError)
                             and not isinstance(ex, smtplib.SMTPException)))
                if fatal and reconnects < MAX_RECONNECTS and i < len(hits) - 1:
                    reconnects += 1
                    print("  connection lost after %d sent; reconnecting (%d/%d)"
                          % (sent, reconnects, MAX_RECONNECTS))
                    try:
                        conn.quit()
                    except Exception:
                        pass
                    try:
                        conn = connect()
                    except Exception as ex2:
                        print("::error::could not reconnect (%s) — %d of %d alerts sent"
                              % (type(ex2).__name__, sent, len(hits)))
                        break
            if i < len(hits) - 1:
                time.sleep(1.2)
    finally:
        try:
            conn.quit()
        except Exception:
            pass

    print("sent " + str(sent) + "/" + str(len(hits)))
    # THE FLAG IS SET FOR ANY SUCCESSFUL SEND, and it is reached now because
    # nothing above it can escape. A partial send that silently repeats is a
    # worse outcome than a partial send that is reported, so the addresses that
    # did not receive are printed as a GitHub error annotation rather than a
    # log line nobody reads.
    if sent > 0:
        day_flag(day, set_it=True)
    if failed:
        print("failed: " + ", ".join(failed))
        print("::error::%d of %d hail alerts did not send. The day is flagged, so a "
              "rerun will NOT retry them — send these by hand: %s"
              % (len(failed), len(hits), ", ".join(failed)))
    return 0 if sent > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
