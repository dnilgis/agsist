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
from shapely.ops import unary_union

REPO = Path(__file__).resolve().parent.parent
MESH_DIR = REPO / "data" / "hail" / "mesh"
MAP = "https://agsist.com/hail-map"


def env(name, default=None, required=False):
    v = os.environ.get(name, default)
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


def load_bands(day):
    """{thresh_in: shapely geometry} — bands are stacked (each threshold's
    polygon covers everything >= it), so a point's band = max thresh whose
    geometry contains it."""
    p = MESH_DIR / (day + ".geojson")
    if not p.exists():
        print("no swath file for " + day + " — quiet day or not yet fetched. exit 0")
        sys.exit(0)
    gj = json.load(open(p))
    by_t = {}
    for f in gj.get("features", []):
        t = f["properties"]["thresh_in"]
        by_t.setdefault(t, []).append(shape(f["geometry"]))
    return {t: unary_union(gs) for t, gs in by_t.items()}


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
    base, token = os.environ.get("LIST_URL"), os.environ.get("LIST_TOKEN")
    if not (base and token):
        return False
    u = (base.rstrip("/") + "/flag?k=alerted:" + day + "&token=" + urllib.parse.quote(token))
    try:
        req = urllib.request.Request(u, method="POST" if set_it else "GET")
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode()).get("set", False)
    except Exception as ex:
        print("flag check unavailable (" + type(ex).__name__ + ") — proceeding")
        return False


def fetch_watchers():
    base = env("LIST_URL", required=True).rstrip("/")
    token = env("LIST_TOKEN", required=True)
    u = base + "/alert-list?token=" + urllib.parse.quote(token)
    with urllib.request.urlopen(u, timeout=30) as r:
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
    with smtplib.SMTP(host, port, timeout=30) as s:
        s.starttls(context=ctx)
        s.login(user, pw)
        for i, (w, band) in enumerate(hits):
            try:
                s.send_message(build_email(w, day, band, from_name, from_addr, reply_to))
                sent += 1
            except smtplib.SMTPException as ex:
                failed.append(w["email"] + " (" + type(ex).__name__ + ")")
            if i < len(hits) - 1:
                time.sleep(1.2)
    print("sent " + str(sent) + "/" + str(len(hits)))
    if sent > 0:
        day_flag(day, set_it=True)
    if failed:
        print("failed: " + ", ".join(failed))
    return 0 if sent > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
