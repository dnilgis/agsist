#!/usr/bin/env python3
"""build_cash_bid_pages.py -- crawlable cash-bid pages by town, /cash-bids/<state>/<town>,
built from the AGSIST elevator network (dnilgis/bids) ONLY.

WHY
---
/cash-bids draws every price with script after a ZIP is entered, so a search
engine reading that page sees no bid at all. These pages put today's network
bids into plain HTML, one page per town, with a link to the live page at that
town's ZIP.

SOURCE, AND WHAT IS NEVER PRINTED
---------------------------------
Same reader and the same two files as scripts/build_state_basis_pages.py:
data/merged-all.json (every merged network row) and data/index.json (one record
per board). The licensed Barchart feed is never read (data/bids.json is not
opened) and a row whose `source` is not a board in index.json, or whose `via`
is not "scrape", is refused; the build fails if one slips through.
No futures price is printed: rows carry `futuresCents`, and it is never read.
The contract a basis is quoted against is named ("vs Dec '26"), never priced.

WHAT IS SHOWN (every rule must hold for a row to print)
  - row: stale false, sourceStatus "ok", USD, a US state
  - board in index.json with status "ok" and health "live"
  - pricedAt within FRESH_HOURS (72 h) of the snapshot -- the same window the
    state basis pages use, so a board unchanged over a weekend still counts
  - delivery not expired: periodPast false, the month window not behind the
    snapshot's month (the bids repo's deliveryMonth rules, ported), and a
    dated label ("By Oct 7", "Oct 1-9th") not behind the snapshot's day
  - corn, soybeans, wheat, sorghum or oats; cash inside a plain sanity band;
    when the row names a contract and a basis, its implied futures (cash -
    basis, used only for this check, never printed) within 3% of the
    network's median for that contract -- otherwise it is a misread board
A board with rows that fail these is not priced on the page; it is named in a
"no current bid" line with the time it was last read, so nothing stale is
shown as today's.

PAGES
  cash-bids/<state>/<town>.html   every town with a network board that has
                                  posted rows. index,follow when at least one
                                  current bid is shown; otherwise noindex,follow
                                  (kept so a link does not break on a quiet day)
  cash-bids/<state>/index.html    the state's towns. NEVER cash-bids/index.html:
                                  /cash-bids is cash-bids.html, and a directory
                                  index would capture that URL on GitHub Pages
  sitemap-cash-bids.xml           indexable town pages and state indexes
  cash-bids/_new.txt              (with --print-new) URLs first written this
                                  run, for the IndexNow ping

Per-elevator pages were measured and not built: 1,694 places sit in 1,625
towns (2026-10-07), so an elevator page would repeat its town page almost
word for word for 96% of elevators.

Pages are MACHINE-OWNED: edit this script, never cash-bids/*/*.html. No build
time is written into a town page, so a town whose bids did not move produces
the same bytes and no commit.

Usage:
  python3 scripts/build_cash_bid_pages.py                     # fetch live (CI)
  python3 scripts/build_cash_bid_pages.py --bids-dir ../bids  # local clone
  python3 scripts/build_cash_bid_pages.py --selftest
"""
import argparse
import datetime as dt
import json
import math
import os
import re
import shutil
import statistics
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_state_basis_pages as SB  # noqa: E402  (helpers + the network reader, one copy)
import basis_method as BM  # noqa: E402  (the one state-basis method)
from build_state_basis_pages import (  # noqa: E402
    CT, MONTH_ABBR, SITE, STATE_NAMES, contract_label, esc, money_basis, parse_contract, parse_ts)

OUT_DIR = "cash-bids"
SITEMAP = "sitemap-cash-bids.xml"
FRESH_HOURS = 72
MAX_SNAPSHOT_AGE_H = 6        # the network publishes every few minutes; older = something is wrong
MAX_PER_CROP = 6              # nearest delivery windows per elevator and crop
CROPS = ["corn", "soybeans", "wheat", "sorghum", "oats"]
CROP_LABEL = {"corn": "Corn", "soybeans": "Soybeans", "wheat": "Wheat", "sorghum": "Sorghum", "oats": "Oats"}
CASH_BAND = {"corn": (2.0, 9.0), "soybeans": (6.0, 20.0), "wheat": (3.0, 14.0),
             "sorghum": (1.5, 9.0), "oats": (1.0, 7.0)}
NEWCROP = {"wheat": (6, 9), "oats": (6, 9)}
NEWCROP_DEFAULT = (9, 12)
CROP_YEAR_START = {"wheat": 6, "oats": 6}
CROP_YEAR_START_DEFAULT = 9
MON_RE = r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?"
DAY_RE = re.compile(MON_RE + r"\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*(?:-|–|to|thru|through)\s*(\d{1,2})(?:st|nd|rd|th)?)?",
                    re.I)
DATED_VIA = {"deadline-inferred-year", "day-range-inferred-year", "month-day-year"}


# ---------------------------------------------------------------- helpers
def url_slug(s):
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s if s and s != "index" else (s or "town") + "-town"


def town_name(s):
    s = re.sub(r"\s+", " ", (s or "").strip()).replace(" \u2014 ", ", ")
    if s and (s.isupper() or s.islower()):
        s = " ".join(w[:1].upper() + w[1:].lower() for w in s.split(" "))
    return s


def ym(y, m):
    return f"{y:04d}-{m:02d}"


def delivery_month(period, crop, snap_ct):
    """The bids repo's deliveryMonth (scripts/merge_bids.mjs), ported: the
    'YYYY-MM' window this row still delivers in, or None if it is over or
    cannot be placed."""
    cur = ym(snap_ct.year, snap_ct.month)
    p = str(period or "")
    if p == "spot":
        return cur
    if re.fullmatch(r"\d{4}-\d{2}(/\d{4}-\d{2})?", p):
        end = p.split("/")[-1]
        return end if end >= cur else None
    m = re.fullmatch(r"(newcrop|oldcrop)-(\d{4})", p)
    if not m:
        return None
    y = int(m.group(2))
    if m.group(1) == "oldcrop":
        a = CROP_YEAR_START.get(crop, CROP_YEAR_START_DEFAULT)
        start, end = ym(y, a), (ym(y + 1, a - 1) if a > 1 else ym(y, 12))
    else:
        a, b = NEWCROP.get(crop, NEWCROP_DEFAULT)
        start, end = ym(y, a), ym(y, b)
    return start if cur < start else (cur if cur <= end else None)


def dated_label_past(row, snap_ct):
    """True when a label that names a day ("By Oct 7", "Oct 1-9th") ends
    before the snapshot's day. The month key alone would keep it all month."""
    if row.get("periodVia") not in DATED_VIA:
        return False
    lab = re.sub(r"\(\d{4}-\d{2}\)", "", row.get("delivery") or "")
    hits = list(DAY_RE.finditer(lab))
    if not hits:
        return False
    h = hits[-1]
    mon = MONTH_ABBR.index(h.group(1)[:3].title()) + 1
    day = int(h.group(3) or h.group(2))
    per = re.match(r"(\d{4})", str(row.get("period") or ""))
    yr = int(per.group(1)) if per else snap_ct.year
    try:
        end = dt.date(yr, mon, day)
    except ValueError:
        return False
    return end < snap_ct.date()


def delivery_label(row):
    """The board's own words, minus the "(YYYY-MM)" suffix the gradable
    adapter appends -- that is the futures contract, not delivery, and the
    contract is shown in its own column. A DTN-style "10/01/2026" month start
    reads as "Oct 2026"."""
    lab = re.sub(r"\s*\(\d{4}-\d{2}\)\s*$", "", (row.get("delivery") or "").strip())
    m = re.fullmatch(r"(\d{2})/01/(\d{4})", lab)
    if m and 1 <= int(m.group(1)) <= 12:
        lab = f"{MONTH_ABBR[int(m.group(1)) - 1]} {m.group(2)}"
    if not lab:
        lab = "Spot" if row.get("period") == "spot" else str(row.get("period") or "")
    return lab


def fmt_posted(t, snap_ct):
    c = t.astimezone(CT)
    hm = c.strftime("%I:%M %p").lstrip("0")
    tz = c.tzname() or "CT"
    day = f"{MONTH_ABBR[c.month - 1]} {c.day}"
    if c.year != snap_ct.year:
        day += f", {c.year}"
    return f"{day}, {hm} {tz}"


def fmt_day(t):
    c = t.astimezone(CT)
    return f"{MONTH_ABBR[c.month - 1]} {c.day}, {c.year}"


def zip5(z):
    z = re.sub(r"\D", "", str(z or ""))[:5]
    return z if len(z) == 5 else ""


def tel(p):
    d = re.sub(r"\D", "", p or "")
    if len(d) == 11 and d[0] == "1":
        d = d[1:]
    return d if len(d) == 10 else ""


# ---------------------------------------------------------------- selection
def select(merged, index, towns_by_state, zip_towns=None, zip_coord=None, placed=None):
    """-> (towns, drops, unplaced). towns: {(ST, town_key): {...}} with every
    board that has posted rows in that town and, per board, the rows that may
    print. A place town_of() cannot name is tried by place_by_zip_or_pin()."""
    gen = parse_ts(merged.get("generated"))
    snap_ct = gen.astimezone(CT)
    srcs = {s["id"]: s for s in (index.get("sources") or []) if s.get("id")}
    fallback = place_fallbacks(merged, srcs, towns_by_state, zip_towns, zip_coord)
    if placed is not None:
        placed.update(fallback)
    drops = Counter()
    towns, unplaced = {}, {}
    for b in merged.get("bids") or []:
        if not isinstance(b, dict):
            continue
        sid = b.get("source")
        src = srcs.get(sid)
        st = (b.get("state") or "").upper()
        if src is None:
            drops["not_a_network_board"] += 1
            continue
        if b.get("via") != "scrape":
            drops["not_scraped"] += 1
            continue
        if st not in STATE_NAMES or (b.get("currency") or "") != "USD":
            drops["not_us_or_not_usd"] += 1
            continue
        tname = town_of(b, src, towns_by_state)
        how = {"how": "name"}
        if not tname and fallback.get((st, b.get("place") or sid)):
            how = fallback[(st, b.get("place") or sid)]
            tname = how["town"] if how["how"] != "none" else None
        if not tname:
            drops["rows_not_placed_in_a_town"] += 1
            unplaced.setdefault((st, b.get("place") or sid), (b.get("operator") or "", town_name(b.get("city")),
                                                              zip5(b.get("zip") or src.get("zip"))))
            continue
        tk = (st, url_slug(tname))
        t = towns.setdefault(tk, {"state": st, "name": tname, "slug": tk[1], "boards": {}})
        place = b.get("place") or sid
        bd = t["boards"].setdefault(place, {
            "place": place, "source": sid, "operator": (b.get("operator") or src.get("operator") or "").strip(),
            "city": town_name(b.get("city")), "zip": zip5(b.get("zip") or src.get("zip")),
            "phone": src.get("phone") or "", "checked": parse_ts(src.get("checkedAt")),
            "last_priced": None, "rows": [], "why": Counter(), "how": how["how"], "near_mi": how.get("mi"),
            "town": tname, "state": st})
        pt = parse_ts(b.get("pricedAt"))
        if pt and (bd["last_priced"] is None or pt > bd["last_priced"]):
            bd["last_priced"] = pt

        def no(k):
            drops[k] += 1
            bd["why"][k] += 1

        if b.get("stale") is not False or b.get("sourceStatus") != "ok":
            no("stale_or_unconfirmed")
            continue
        if src.get("status") != "ok" or src.get("health") != "live":
            no("board_not_live")
            continue
        if pt is None or (gen - pt).total_seconds() > FRESH_HOURS * 3600:
            no("price_older_than_cutoff")
            continue
        crop = b.get("crop")
        if crop not in CROPS:
            no("other_crop")
            continue
        cash = b.get("cash")
        if not isinstance(cash, (int, float)) or b.get("basisUnit") != "per-bushel":
            no("no_cash_per_bushel")
            continue
        lo, hi = CASH_BAND[crop]
        if not lo <= cash <= hi:
            no("cash_outside_sanity_band")
            continue
        if b.get("periodPast") or delivery_month(b.get("period"), crop, snap_ct) is None \
                or dated_label_past(b, snap_ct):
            no("delivery_expired_or_undated")
            continue
        basis = b.get("basis")
        basis = round(float(basis), 4) if isinstance(basis, (int, float)) else None
        con = parse_contract(b.get("futuresMonth"), crop if crop in ("corn", "soybeans") else
                             ("corn" if crop == "sorghum" else crop), gen.year)
        bd["rows"].append({
            "crop": crop, "commodity": (b.get("commodity") or "").strip(), "label": delivery_label(b),
            "dm": delivery_month(b.get("period"), crop, snap_ct), "period": str(b.get("period") or ""),
            "cash": round(float(cash), 4), "basis": basis, "contract": con, "priced": pt,
            "source": sid, "via": b.get("via")})
    return towns, drops, unplaced


def town_key(name):
    s = (name or "").lower()
    for a, b in ((r"\bsaint\b", "st"), (r"\bmount\b", "mt"), (r"\bfort\b", "ft"), (r"\bsainte\b", "ste")):
        s = re.sub(a, b, s)
    return re.sub(r"[^a-z0-9]", "", s)


def known_towns(zip_towns):
    """{ST: {normalised town name: display name}} from the bids repo's
    geocodes/zip-towns.json (ZIP -> [primary city, state], the `zipcodes`
    table its own geocoder is built from)."""
    out = defaultdict(dict)
    for z, v in ((zip_towns or {}).get("zips") or {}).items():
        if isinstance(v, list) and len(v) == 2:
            out[v[1]].setdefault(town_key(v[0]), v[0])
    return out


def town_of(b, src, towns_by_state):
    """The town a place is in, or None when it cannot be placed:
      1. the bids repo's display `town`, when its table-backed rules set one;
      2. else `city` (minus a trailing ", ST" or state name), when it is a
         postal town name in that state per zip-towns.json;
      3. else one piece of `city` split at " - ", "/" or "," that is such a
         town ("Eastland - Shannon", "ADM - Morris", "Gibson City - West");
      4. else `city` after the leading words that are the operator's own name
         ("CFE Sibley" for Cooperative Farmers Elevator (CFE), "Circle J
         Marengo" for Circle J Grain), when what is left is such a town.
         A processor's name in front ("Cargill Sioux City" posted by another
         company) is not stripped: that is a delivered bid to a plant.
    Nothing else: a `city` that is a facility's name ("Lincolnway Energy",
    "CGB Albany", "Big River") is not turned into a town by reading the name or
    by trusting a head-office ZIP (merge_bids.mjs displayTown() measured why).
    A hamlet on a neighbour's post office is unplaced too; such boards are
    listed on the state index with a link to the live page."""
    st = (b.get("state") or "").upper()
    if b.get("town"):
        return town_name(b["town"])
    known = towns_by_state.get(st, {})
    city = re.sub(rf",?\s+({st}|{re.escape(STATE_NAMES.get(st, st))})\.?$", "", (b.get("city") or "").strip(),
                  flags=re.I)
    hit = known.get(town_key(city))
    if not hit:
        for piece in reversed(re.split(r"\s+-\s*|\s*-\s+|/|,", city)):
            hit = known.get(town_key(piece))
            if hit:
                break
    if not hit:
        op = {w for w in re.split(r"[^a-z0-9]+", (b.get("operator") or src.get("operator") or "").lower()) if w}
        words = city.split()
        k = 0
        while k < len(words) - 1 and re.sub(r"[^a-z0-9]", "", words[k].lower()) in op:
            k += 1
        if k:
            hit = known.get(town_key(" ".join(words[k:])))
    return town_name(hit) if hit else None


NEAR_MI = 10          # a place with no town and no usable ZIP goes on a town page this close, or nowhere
ZIP_PIN_MI = 20       # a pin this far from its ZIP's centre still agrees; rural ZIPs run 10-18 mi, a head-office ZIP is 35+


def miles(a_lat, a_lon, b_lat, b_lon):
    r = math.pi / 180
    x = (math.sin((b_lat - a_lat) * r / 2) ** 2
         + math.cos(a_lat * r) * math.cos(b_lat * r) * math.sin((b_lon - a_lon) * r / 2) ** 2)
    return 2 * 3958.7613 * math.asin(math.sqrt(x))


def _pin(b):
    lat, lon = b.get("lat"), b.get("lon")
    return (lat, lon) if isinstance(lat, (int, float)) and isinstance(lon, (int, float)) else None


def place_fallbacks(merged, srcs, towns_by_state, zip_towns=None, zip_coord=None):
    """{(ST, place): placement} for every network place town_of() cannot name.
    A placement is {"how": "zip"|"near"|"none", "town", "mi", "why"}:

      zip   the place's own ZIP is in zip-towns.json, in the same state. When
            the place has a pin, the pin must sit within ZIP_PIN_MI of that ZIP's
            centroid (data/zips/NN.json); a head-office ZIP on a branch board
            fails that ("Naples" on a Pleasant Plains ZIP, 35 mi off) and the
            place falls through to `near`. A ZIP whose centroid cannot be read
            is not trusted against a pin.
      near  the place has a street-level pin, and a town page already exists
            for a town named by the rules in town_of(): the nearest such town
            within NEAR_MI, measured to the nearest street-level pin of an
            elevator placed in it by name. The card says how far ("8 mi from
            Pana"). A town pin ("precision": "town") is a ZIP centroid and can
            be miles off, so it is not used on either side.
      none  neither: the place stays on the state index, as before.

    A town is never read out of a name, and no page is made for a name that is
    not a town in zip-towns.json."""
    zips = (zip_towns or {}).get("zips") or {}
    first, named, anchors = {}, set(), defaultdict(list)
    for b in merged.get("bids") or []:
        if not isinstance(b, dict):
            continue
        src = srcs.get(b.get("source"))
        st = (b.get("state") or "").upper()
        if src is None or b.get("via") != "scrape" or st not in STATE_NAMES or (b.get("currency") or "") != "USD":
            continue
        k = (st, b.get("place") or b.get("source"))
        if k in first:
            continue
        first[k] = (b, src)
        tname = town_of(b, src, towns_by_state)
        if tname:
            named.add(k)
            if _pin(b) and b.get("precision") == "street":
                anchors[(st, url_slug(tname))].append((_pin(b), tname))
    out = {}
    for k, (b, src) in first.items():
        if k in named:
            continue
        st, pin = k[0], _pin(b)
        z = zip5(b.get("zip") or src.get("zip"))
        zt = zips.get(z) if z else None
        why = "no ZIP on file" if not z else (f"ZIP {z} not in the ZIP table" if not zt else
                                             (f"ZIP {z} is in {zt[1]}" if zt[1] != st else ""))
        if not why and pin:
            c = zip_coord(z) if zip_coord else None
            if not c:
                why = f"ZIP {z} has no centroid to check the pin against"
            else:
                d = miles(pin[0], pin[1], c[0], c[1])
                if d > ZIP_PIN_MI:
                    why = f"pin is {d:.0f} mi from ZIP {z}"
        if not why:
            out[k] = {"how": "zip", "town": town_name(zt[0]), "zip": z, "mi": None, "why": ""}
            continue
        best = None
        if pin and b.get("precision") == "street":
            for (ast, _), pts in anchors.items():
                if ast != st:
                    continue
                for p, tname in pts:
                    d = miles(pin[0], pin[1], p[0], p[1])
                    if d <= NEAR_MI and (best is None or d < best[0]):
                        best = (d, tname)
        if best:
            out[k] = {"how": "near", "town": best[1], "zip": z, "mi": best[0], "why": why}
        else:
            out[k] = {"how": "none", "town": None, "zip": z, "mi": None,
                      "why": why + ("" if pin and b.get("precision") == "street" else
                                    "; no street-level pin" if why else "no street-level pin")}
    return out


def near_text(bd):
    """Where a place sits, for a board not named by its town: "Pana Facility,
    Pana, IL 62557" for a ZIP placement, "8 mi from Pana" for a near one."""
    if bd.get("how") == "zip":
        return f"{bd['city']}, {bd['town']}, {bd['state']} {bd['zip']}".lstrip(", ")
    if bd.get("how") == "near":
        mi = bd["near_mi"]
        dist = "under 1 mi" if mi < 1 else f"{mi:.0f} mi"
        return (f"{bd['city']}, " if bd["city"] else "") + f"{dist} from {bd['town']}"
    return ""


def drop_misreads(towns, drops, tol=0.03):
    """cash - basis is the futures price the board used. One more than 3% off
    the network median for that contract (>= 5 boards) is a misread cash,
    basis or month: the row is not printed. The figure itself is never shown."""
    by = defaultdict(list)
    allrows = [(t, bd, r) for t in towns.values() for bd in t["boards"].values() for r in bd["rows"]]
    for _, _, r in allrows:
        if r["contract"] and r["basis"] is not None:
            by[r["contract"]].append(r["cash"] - r["basis"])
    med = {c: statistics.median(v) for c, v in by.items() if len(v) >= 5}
    for _, bd, r in allrows:
        m = med.get(r["contract"]) if r["contract"] and r["basis"] is not None else None
        r["bad"] = bool(m) and abs((r["cash"] - r["basis"]) / m - 1) > tol
    for t in towns.values():
        for bd in t["boards"].values():
            n = sum(1 for r in bd["rows"] if r["bad"])
            if n:
                drops["implied_futures_disagrees"] += n
                bd["why"]["implied_futures_disagrees"] += n
                bd["rows"] = [r for r in bd["rows"] if not r["bad"]]


def trim(rows):
    """Nearest MAX_PER_CROP delivery windows per crop; returns (kept, n_more)."""
    out, more = [], 0
    by = defaultdict(list)
    for r in rows:
        by[r["crop"]].append(r)
    for c in CROPS:
        rs = sorted(by.get(c, []), key=lambda r: (min(r["dm"], r["period"][:7] if r["period"][:4].isdigit() else r["dm"]),
                                                  r["dm"], r["commodity"].lower(), r["label"], -r["cash"]))
        out += rs[:MAX_PER_CROP]
        more += max(0, len(rs) - MAX_PER_CROP)
    return out, more


# ---------------------------------------------------------------- page parts
CSS = """
    .cbt-wrap{max-width:900px;margin:0 auto;padding:0 16px}
    .cbt-sub{color:var(--text-muted);font-size:.92rem;line-height:1.6}
    .cbt-sub a,.cbt-note a,.cbt-el a{color:var(--gold)}
    h1{font-size:1.5rem;margin:14px 0 4px;line-height:1.25} h2{font-size:1.1rem;margin:22px 0 4px}
    .cbt-live{display:inline-block;margin:10px 0 4px;padding:.55rem .9rem;border:2px solid var(--gold);border-radius:8px;color:var(--gold);font-weight:700;text-decoration:none}
    .cbt-el{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin:14px 0}
    .cbt-el h2{margin:0 0 2px;font-size:1.05rem;color:var(--text)}
    .cbt-el .loc{color:var(--text-muted);font-size:.85rem}
    .cbt-posted{font-size:.85rem;color:var(--text-muted);margin:4px 0 6px}
    .cbt-posted b{color:var(--text);font-weight:600}
    .cbt-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
    table.cbt-t{width:100%;border-collapse:collapse;font-size:.88rem}
    .cbt-t th{text-align:left;color:var(--text-muted);font-size:.68rem;letter-spacing:.06em;text-transform:uppercase;padding:6px 6px;border-bottom:1px solid var(--border)}
    .cbt-t td{padding:6px 6px;border-bottom:1px solid var(--border);color:var(--text);vertical-align:top}
    .cbt-t td.n,.cbt-t th.n{text-align:right;white-space:nowrap}
    .cbt-t td.n{font-family:'JetBrains Mono',monospace}
    .cbt-t .mut,.cbt-mut{color:var(--text-dim);font-size:.78rem}
    .cbt-note{background:var(--surface);border:1px solid var(--border);border-left:3px solid var(--gold);border-radius:8px;padding:12px 15px;font-size:.86rem;line-height:1.65;color:var(--text-muted);margin:16px 0}
    .cbt-note b{color:var(--text)}
    .cbt-list{margin:6px 0 0 18px;padding:0;color:var(--text);font-size:.9rem;line-height:1.8}
    .cbt-list a{color:var(--text);border-bottom:1px dotted var(--border);text-decoration:none}
    .cbt-list a:hover{color:var(--gold)}
    .cbt-cloud{font-size:.82rem;line-height:2;color:var(--text-muted)}
    .cbt-cloud a{color:var(--text-muted);text-decoration:none;border-bottom:1px dotted var(--border)}
    .cbt-hero{display:flex;flex-wrap:wrap;gap:12px;margin:12px 0}
    .cbt-stat{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;min-width:220px;flex:1}
    .cbt-stat .v{font-family:'JetBrains Mono',monospace;font-size:1.4rem;color:var(--text)}
    .cbt-stat .l{font-size:.85rem;color:var(--text-muted);margin-top:2px;line-height:1.4}
    .cbt-stat .s{font-size:.85rem;color:var(--text-muted);margin-top:6px;line-height:1.55}
    .cbt-stat .s b{color:var(--text)}
    h3{font-size:.98rem;margin:16px 0 4px;color:var(--text)}
    .cbt-more{display:inline-block;margin:8px 0 4px;padding:9px 14px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--gold);font-size:.92rem;cursor:pointer;font:inherit}
    .cbt-more[hidden]{display:none}
    @media (max-width:640px){.cbt-stat{min-width:0;flex-basis:100%}.cbt-full-t td,.cbt-full-t th{padding:6px 3px}}
"""


def head(title, desc, path, jsonld, indexable, share=None):
    """build_state_basis_pages.head() with this page's CSS in place of its.
    share=(title, desc) replaces the og: and twitter: title and description
    (the link preview in a text or a post); <title> and the meta description
    stay as they are for search."""
    h = SB.head(title, desc, path, jsonld, indexable)
    h = h.replace(f"<style>{SB.CSS}  </style>", f"<style>{CSS}  </style>")
    h = h.replace('<meta property="og:type" content="article">', '<meta property="og:type" content="website">')
    assert CSS in h, "basis head() changed shape; update head() here"
    m = re.search(r'  <link rel="stylesheet" href="/components/styles\.css\?v=\d+">\n', h)
    assert m, "basis head() changed shape; update head() here"
    sheet = m.group(0)
    h = h.replace(sheet, sheet + '  <link rel="stylesheet" href="/components/asof.css?v=1">\n', 1)
    # the same font preloads every root page carries (inject_static_nav.py): the
    # state page's stat cards rewrapped when the web font landed (CLS 0.03 at 390)
    import inject_static_nav as NAV
    h = NAV.fill_fonts(h)
    if share:
        for prop, old, new in (("og:title", title, share[0]), ("og:description", desc, share[1])):
            for attr in (f'property="{prop}"', f'name="twitter:{prop[3:]}"'):
                a, b = f'<meta {attr} content="{esc(old)}">', f'<meta {attr} content="{esc(new)}">'
                assert a in h, f"basis head() has no {attr}; update head() here"
                h = h.replace(a, b)
    return h


def fmt_share_time(t):
    """"Oct 8, 7:10 pm" in Central time, the way the site's "Updated" lines read."""
    c = t.astimezone(CT)
    return f"{MONTH_ABBR[c.month - 1]} {c.day}, {c.strftime('%I:%M').lstrip('0')} {c.strftime('%p').lower()}"


def asof_time(t):
    """The site's one "Updated" stamp (components/asof.js): absolute in the
    file, since the page is read hours later; the script re-renders it
    ("Updated 7:10 pm", "Updated yesterday 4:10 pm") and greys it with a
    plain age once it is not from today."""
    iso = t.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return f'<time class="asof" data-asof="bids" datetime="{iso}">Updated {fmt_share_time(t)}</time>'


def top_nearby(rows):
    """{crop: (highest cash, its posted time)} over the rows shown, for each
    crop's nearest delivery month present. Only numbers that print on the
    page; on a tie the newer posting."""
    out = {}
    for c in CROPS:
        rs = [r for r in rows if r["crop"] == c and r.get("dm")]
        if rs:
            m = min(r["dm"] for r in rs)
            best = max((r for r in rs if r["dm"] == m), key=lambda r: (r["cash"], r["priced"]))
            out[c] = (best["cash"], best["priced"])
    return out


def share_prices(tops, n=3):
    """-> ("corn $4.38, soybeans $9.87", the oldest posted time among them),
    from top_nearby(), at most n crops."""
    cs = [c for c in CROPS if c in tops][:n]
    return (", ".join(f"{CROP_LABEL[c].lower()} ${tops[c][0]:.2f}" for c in cs),
            min(tops[c][1] for c in cs))


def breadcrumb(items):
    return {"@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": i + 1, "name": n, "item": u} for i, (n, u) in enumerate(items)]}


# Town pages only: components/cb-house.js puts the email ask in the footer's
# open sponsor slot while it is unsold, and leaves a sold one alone.
HOUSE_JS = '<script src="/components/cb-house.js?v=1" defer></script>\n'


def page_end(ftr, house=False, table=False):
    return f"""</main>
{ftr}
<script src="/components/loader.js?v=18" defer></script>
<script src="/components/asof.js?v=1" defer></script>
{HOUSE_JS if house else ''}{TABLE_JS if table else ''}</body>
</html>
"""


def board_section(bd, snap_ct):
    rows, more = trim(bd["rows"])
    times = [r["priced"] for r in rows]
    lo, hi = min(times), max(times)
    posted = fmt_posted(hi, snap_ct)
    if (hi - lo).total_seconds() > 3600:
        posted = f"{fmt_posted(lo, snap_ct)} to {fmt_posted(hi, snap_ct)}"
    ph = tel(bd["phone"])
    call = (f'<a href="tel:+1{ph}">call to confirm ({ph[:3]}-{ph[3:6]}-{ph[6:]})</a>' if ph
            else "call to confirm")
    name = bd["operator"] or bd["city"]
    loc = near_text(bd) or (bd["city"] if bd["city"] and bd["city"].lower() != name.lower() else "")
    trs = []
    for r in rows:
        com = r["commodity"]
        show_com = com and com.lower() not in (r["crop"], CROP_LABEL[r["crop"]].lower(), "yellow corn", "yc", "sb",
                                               "soybean", "beans")
        crop = esc(CROP_LABEL[r["crop"]]) + (f' <span class="mut">{esc(com)}</span>' if show_com else "")
        if r["basis"] is None:
            bas = '<span class="mut">not posted</span>'
        else:
            bas = money_basis(r["basis"])
            if r["contract"]:
                bas += f'<br><span class="mut">vs {contract_label(r["contract"])}</span>'
        trs.append(f'<tr><td>{crop}</td><td>{esc(r["label"])}</td><td class="n">${r["cash"]:.2f}</td>'
                   f'<td class="n">{bas}</td></tr>')
    z = bd["zip"]
    live = f'/cash-bids?zip={z}' if z else "/cash-bids"
    more_html = (f'<p class="cbt-sub" style="margin:6px 0 0">{more} more bid{"s" if more != 1 else ""} for later '
                 f'delivery on the <a href="{esc(live)}">live page</a>.</p>' if more else "")
    return (f'<section class="cbt-el"><h2>{esc(name)}</h2>'
            + (f'<div class="loc">{esc(loc)}</div>' if loc else "")
            + f'<p class="cbt-posted" title="Posted {esc(posted)}">{asof_time(lo)} &middot; {call}</p>'
            f'<div class="cbt-scroll"><table class="cbt-t"><thead><tr><th>Crop</th><th>Delivery</th>'
            f'<th class="n">Cash</th><th class="n">Basis</th></tr></thead><tbody>{"".join(trs)}</tbody></table></div>'
            f'{more_html}</section>'), rows, times


WHY = {"stale_or_unconfirmed": "board not confirmed on the latest read",
       "board_not_live": "board not confirmed on the latest read",
       "price_older_than_cutoff": f"no price posted in the last {FRESH_HOURS} hours",
       "delivery_expired_or_undated": "only expired delivery periods posted",
       "implied_futures_disagrees": "posted figures did not check out",
       "cash_outside_sanity_band": "posted figures did not check out"}


def quiet_line(bd):
    why = next((WHY[k] for k, _ in bd["why"].most_common() if k in WHY), "no current bid")
    seen = f", last read {fmt_day(bd['checked'])}" if bd["checked"] else ""
    name = bd["operator"] or bd["city"]
    where = near_text(bd)
    if where:
        name += f" ({where})"
    return f"<li>{esc(name)}: {esc(why)}{seen}</li>"


def build_town_page(t, ctx):
    st, sname = t["state"], STATE_NAMES[t["state"]]
    ssl = url_slug(sname)
    snap_ct = ctx["snap_ct"]
    order = lambda b: (b["how"] == "near", b["near_mi"] or 0, b["operator"].lower(), b["city"].lower())  # noqa: E731
    live_b = sorted((b for b in t["boards"].values() if b["rows"]), key=order)
    quiet = sorted((b for b in t["boards"].values() if not b["rows"]), key=order)
    secs, times, crops, nrows, shown = [], [], set(), 0, []
    for bd in live_b:
        h, rows, ts = board_section(bd, snap_ct)
        secs.append(h)
        times += ts
        shown += rows
        nrows += len(rows)
        crops |= {r["crop"] for r in rows}
    indexable = bool(live_b)
    path = f"/cash-bids/{ssl}/{t['slug']}"
    place = f"{t['name']}, {st}"
    title = f"Cash Grain Bids in {place} Today | AGSIST"
    if len(title) > 60:
        title = f"Cash Grain Bids in {place} Today"
    if len(title) > 60:
        title = f"{place} Cash Grain Bids"
    zips = Counter(b["zip"] for b in live_b or quiet if b["zip"] and b["how"] != "near")
    if not zips:
        zips = Counter(b["zip"] for b in live_b or quiet if b["zip"])
    z = zips.most_common(1)[0][0] if zips else ""
    live = f"/cash-bids?zip={z}" if z else "/cash-bids"
    if indexable:
        cl = [CROP_LABEL[c].lower() for c in CROPS if c in crops]
        cl_txt = ", ".join(cl[:-1]) + (" and " if len(cl) > 1 else "") + cl[-1]
        n = len(live_b)
        n_near = sum(1 for b in live_b if b["how"] == "near")
        where = f"in and near {place}" if n_near else f"in {place}"
        latest = max(times)
        desc = (f"Cash {cl_txt} bids at {n} elevator{'s' if n != 1 else ''} {where}: delivery month, cash "
                f"price and basis, posted {fmt_day(latest)}. Read from each elevator's own board. Call to confirm.")
        if len(desc) > 160:
            desc = (f"Cash grain bids at {n} elevator{'s' if n != 1 else ''} {where}, posted {fmt_day(latest)}: "
                    f"cash price and basis by delivery month. Call to confirm.")
        desc = desc[:160]
        tops = top_nearby(shown)
        txt, when = share_prices(tops)
        share = (f"{place} cash bids",
                 f"Top bids for nearest delivery: {txt} at {n} elevator{'s' if n != 1 else ''}. "
                 f"Updated {fmt_share_time(when)}.")
        n_in = n - n_near
        who = (f'<b>{n_in}</b> elevator{"s" if n_in != 1 else ""} in {esc(place)}' if n_in else "")
        if n_near:
            who += (" and " if n_in else "") + (f'<b>{n_near}</b> elevator{"s" if n_near != 1 else ""} within '
                                                f'{NEAR_MI} miles of {esc(t["name"])}')
        intro = (f'<p class="cbt-sub">Bids posted by {who} '
                 f'that the AGSIST network reads directly from the elevator&rsquo;s own bid board. Cash is $/bu; '
                 f'basis is cash minus the futures contract named under it. Prices move through the day, '
                 f'each elevator shows when it posted. Call the elevator before you haul.</p>')
    else:
        desc = (f"Cash grain bids in {place}: no current bid from the elevators the AGSIST network reads here. "
                f"See the live page for bids nearby.")[:160]
        tops, share = {}, None
        intro = (f'<div class="cbt-note"><b>No current bid.</b> No elevator the AGSIST network reads in '
                 f'{esc(place)} has a bid we could confirm right now. The live page shows bids nearby.</div>')
    quiet_html = ""
    if quiet:
        quiet_html = (f'<h2>Also in {esc(t["name"])}, no current bid</h2><ul class="cbt-list">'
                      + "".join(quiet_line(b) for b in quiet) + "</ul>"
                      '<p class="cbt-sub">No price is shown for these until their board posts again.</p>')
    links = [f'<a href="/cash-bids/{ssl}/">Every {esc(sname)} town</a>',
             f'<a href="/cash-bids/{ssl}/#basis">{esc(sname)} basis today</a>']
    jsonld = {"@context": "https://schema.org", "@graph": [breadcrumb([
        ("AGSIST", f"{SITE}/"), ("Cash bids", f"{SITE}/cash-bids"),
        (sname, f"{SITE}/cash-bids/{ssl}/"), (t["name"], f"{SITE}{path}")])]}
    hows = {b["how"] for b in t["boards"].values()}
    near_note = ""
    if "zip" in hows:
        near_note += (f" An elevator whose board names a site rather than a town is listed here when its ZIP is a "
                      f"{esc(t['name'])} ZIP; its card shows the board&rsquo;s own name and the ZIP.")
    if "near" in hows:
        near_note += (f" An elevator with no town or ZIP we can confirm is listed here when it is within "
                      f"{NEAR_MI} miles of {esc(t['name'])}, measured from its map pin to the nearest elevator "
                      f"we list in {esc(t['name'])}; its card says how far.")
    hdr, ftr = ctx["chrome"]
    body = f"""
<body>
{hdr}
<main class="cbt-wrap" id="main">
  <p class="cbt-sub" style="margin-top:14px"><a href="/cash-bids" style="color:var(--text-muted)">Cash bids</a> &rsaquo; <a href="/cash-bids/{ssl}/" style="color:var(--text-muted)">{esc(sname)}</a> &rsaquo; <b style="color:var(--text)">{esc(t['name'])}</b></p>
  <h1>Cash grain bids in {esc(place)} today</h1>
  {intro}
  <a class="cbt-live" href="{esc(live)}">Live bids near {esc(z or t['name'])} &rarr;</a>
  {''.join(secs)}
  <!-- a reader already signed up never gets the ask: mark them before first paint (components/styles.css holds the space otherwise) -->
  <script>try{{if(/(^|;\\s*)agsist_subscribed=/.test(document.cookie)||localStorage.getItem('agsist_subscribed')==='1')document.documentElement.classList.add('sa-subbed')}}catch(e){{}}</script>
  <div data-signup-ask="Get {esc(t['name'])} bids by email every weekday morning" data-source="town:{ssl}/{t['slug']}"{f' data-zip="{z}"' if z else ''}></div>
  {quiet_html}
  <div class="cbt-note"><b>Where these come from.</b> The AGSIST elevator network reads each elevator&rsquo;s
  posted bid board directly; no third-party bid feed is used on this page. A bid shows only if the board was
  confirmed on the latest read, the price was posted in the last {FRESH_HOURS} hours, and its delivery period
  has not ended. This page is a snapshot and is rebuilt through the day; the <a href="{esc(live)}">live page</a>
  has the newest board and nearby elevators.{near_note}</div>
  <p class="cbt-sub">{' &middot; '.join(links)}</p>
"""
    meta = {"state": st, "slug": t["slug"], "name": t["name"], "indexable": indexable, "path": path,
            "elevators": len(live_b), "quiet": len(quiet), "rows": nrows, "crops": crops,
            "latest": max(times) if times else None, "title": title, "desc": desc, "tops": tops,
            "share": share}
    return head(title, desc, path, jsonld, indexable, share) + body + page_end(ftr, house=True), meta


# ---------------------------------------------------------------- state basis (merged from /basis/<state>)
# 2026-10-10: /basis/<state> and /cash-bids/<state>/ listed the same elevators
# twice, one by town with no prices and one by basis. They are one page now:
# the state index opens with the best bid and the state's basis (the one
# method, scripts/basis_method.py), then the elevators with bid and basis,
# then the towns. The full elevator table, which made six basis pages over
# 150 KB, is data/state-basis/<ST>.json and loads when the reader asks for it.
STATE_DATA_DIR = os.path.join("data", "state-basis")
BASIS_STATES = os.path.join("data", "basis-states.json")
TOP_ROWS = 10                 # elevators per crop in the page's own bid list
HUB_PAGE = "basis.html"
TABLE_JS = '<script src="/components/state-bids.js?v=1" defer></script>\n'


def state_basis_rows(merged, index):
    """The state-basis inputs, gated exactly as the basis pages always were:
    fresh network bids, misread boards flagged, one bid per elevator and crop
    group at its nearest open delivery."""
    rows = SB.fresh_rows(merged, index)
    SB.flag_futures_disagreement(rows)
    return SB.nearby(rows)


def _plural(n, one, many=None):
    return one if n == 1 else (many or one + "s")


def basis_stat(g, st, prev_gen):
    """One crop's headline: median vs the named contract, n beside it, the
    range, and the week's matched-pair change when there is one."""
    con = st["contract"]
    root = SB.EXCHANGE.get(con[0], con[0])
    wow = ""
    if prev_gen is not None:
        if "wow_median" in st:
            wow = (f'<br>Change in a week: <b>{SB.cents_delta(st["wow_median"])}</b> (middle of {st["wow_n"]} '
                   f'bids posted both weeks; {st["wow_up"]} up, {st["wow_dn"]} down; vs {fmt_day(prev_gen)}).')
        else:
            wow = f"<br>Change in a week: not enough bids posted both weeks (fewer than {BM.MIN_STAT})."
    out = ""
    if st.get("outliers"):
        k = len(st["outliers"])
        out = f' ({k} more left out as {_plural(k, "outlier")}, listed below)'
    return (f'<div class="cbt-stat"><div class="v">{money_basis(st["median"])}</div>'
            f'<div class="l">{SB.CROP_LABEL[g]}: middle basis vs {contract_label(con)} {esc(root)}</div>'
            f'<div class="s">n = <b>{st["n"]}</b> {_plural(st["n"], "elevator")}{out} &middot; range '
            f'{money_basis(st["lo"])} to {money_basis(st["hi"])}{wow}</div></div>')


def best_bids(near):
    """{crop: row} the highest cash among each crop's nearest delivery start
    in the state, for corn and soybeans (and a wheat class with no corn or
    soybeans at all). Suspect and outlier rows never qualify."""
    out = {}
    for g in BM.CROP_ORDER:
        rs = [r for r in near if r["group"] == g and not r.get("suspect") and not r.get("outlier")]
        if not rs:
            continue
        first = min(r["start"] for r in rs)
        out[g] = max((r for r in rs if r["start"] == first), key=lambda r: (r["cash"], r["priced"]))
    return out


def best_card(g, r, town_paths):
    tp = town_paths.get(r["source"])
    town = SB.town_text(r["city"])
    where = f'<a href="{tp[1]}">{esc(town)}</a>' if tp else esc(town)
    bas = (f'basis {money_basis(r["basis"])} vs {contract_label(r["contract"])}' if r["contract"]
           else f'basis {money_basis(r["basis"])}, futures month not named')
    return (f'<div class="cbt-stat"><div class="v">${r["cash"]:.2f}</div>'
            f'<div class="l">Top {SB.CROP_LABEL[g].lower()} bid, nearest delivery ({esc(SB.delivery_text(r))})</div>'
            f'<div class="s">{esc(r["operator"])}, {where} &middot; {bas} &middot; posted {fmt_day(r["priced"])}. '
            f'Call to confirm.</div></div>')


def basis_section(st, summ, prev_gen):
    """The #basis block: one headline per crop, the other contracts, what was
    left out and why, strongest and weakest."""
    sname = STATE_NAMES[st]
    blocks, notes, lists = [], [], []
    for g in BM.CROP_ORDER:
        s = summ.get(g)
        if not s:
            continue
        cons = s["contracts"]
        head0 = cons[0] if cons and "median" in cons[0] else None
        if not head0:
            if g in ("corn", "soybeans") and s["rows"]:
                n = len(s["rows"])
                notes.append(f"{SB.CROP_LABEL[g]}: {n} {_plural(n, 'elevator')} with a fresh bid, too few on one "
                             f"futures month for a middle number (it takes {BM.MIN_STAT}).")
            continue
        blocks.append(basis_stat(g, head0, prev_gen))
        for c in cons[1:]:
            if "median" in c:
                notes.append(f"{SB.CROP_LABEL[g]} vs {contract_label(c['contract'])}: middle {money_basis(c['median'])}, "
                             f"n = {c['n']}. Kept apart: a basis against one month does not compare with another.")
            else:
                notes.append(f"{SB.CROP_LABEL[g]}: {c['n']} {_plural(c['n'], 'elevator')} "
                             f"{'prices' if c['n'] == 1 else 'price'} against "
                             f"{contract_label(c['contract'])}, too few for a middle number; kept out of the headline.")
        if s["no_contract"]:
            k = len(s["no_contract"])
            notes.append(f"{SB.CROP_LABEL[g]}: {k} {_plural(k, 'elevator')} did not name a futures month and "
                         f"{'is' if k == 1 else 'are'} left out of every number.")
        if s["suspect"]:
            k = len(s["suspect"])
            notes.append(f"{SB.CROP_LABEL[g]}: {k} {_plural(k, 'bid')} with a basis past &plusmn;${BM.SANITY[s['rows'][0]['crop']]:.2f} "
                         f"or a cash and basis that do not add up to the network&rsquo;s futures price "
                         f"{'was' if k == 1 else 'were'} read as a misread board and left out.")
        for r in head0.get("outliers") or []:
            o = r["outlier"]
            notes.append(f"Left out as an outlier: {esc(r['operator'])}, {esc(SB.town_text(r['city']))}, "
                         f"{SB.CROP_LABEL[g].lower()} basis {money_basis(r['basis'])}, "
                         f"{abs(o['dist']) * 100:.0f}&cent; {'over' if o['dist'] > 0 else 'under'} the state&rsquo;s "
                         f"middle of {money_basis(o['median'])}. Call that elevator before you count on it.")
        if g in ("corn", "soybeans"):
            lab = contract_label(head0["contract"])
            lists.append(f'<h3>Strongest {SB.CROP_LABEL[g].lower()} basis ({lab})</h3><ul class="cbt-list">'
                         + "".join(SB.loc_li(r) for r in head0["strong"]) + "</ul>"
                         + f'<h3>Weakest {SB.CROP_LABEL[g].lower()} basis ({lab})</h3><ul class="cbt-list">'
                         + "".join(SB.loc_li(r) for r in head0["weak"]) + "</ul>")
    if not blocks and not notes:
        return (f'<h2 id="basis">{esc(sname)} basis today</h2><div class="cbt-note"><b>No basis number today.</b> '
                f'No elevator here had a fresh corn, soybean or wheat bid on a named futures month.</div>')
    html_ = f'<h2 id="basis">{esc(sname)} basis today</h2>'
    html_ += (f'<p class="cbt-sub">Basis is cash minus futures, $/bu. The number is the middle bid (median) of the '
              f'elevators below, each counted once at its nearest delivery, against the futures month most of them '
              f'name. n is how many elevators it rests on.</p>')
    if blocks:
        html_ += f'<div class="cbt-hero">{"".join(blocks)}</div>'
    if notes:
        html_ += '<ul class="cbt-list cbt-sub">' + "".join(f"<li>{n}</li>" for n in notes) + "</ul>"
    return html_ + "".join(lists)


def top_bid_table(g, near, town_paths):
    """The highest TOP_ROWS bids for one crop at its nearest delivery start,
    with the basis beside each. Suspect and outlier rows are not ranked."""
    rs = [r for r in near if r["group"] == g and not r.get("suspect") and not r.get("outlier")]
    if not rs:
        return ""
    first = min(r["start"] for r in rs)
    top = sorted((r for r in rs if r["start"] == first), key=lambda r: (-r["cash"], r["operator"]))[:TOP_ROWS]
    trs = []
    for r in top:
        tp = town_paths.get(r["source"])
        town = SB.town_text(r["city"])
        tl = f'<a href="{tp[1]}">{esc(town)}</a>' if tp else esc(town)
        con = f'<br><span class="mut">vs {contract_label(r["contract"])}</span>' if r["contract"] else ""
        trs.append(f'<tr><td>{esc(r["operator"])}<br><span class="mut">{tl}</span></td>'
                   f'<td>{esc(SB.delivery_text(r))}</td><td class="n">${r["cash"]:.2f}</td>'
                   f'<td class="n">{money_basis(r["basis"])}{con}</td></tr>')
    n = len([r for r in rs if r["start"] == first])
    ym_ = f"{MONTH_ABBR[int(first[5:7]) - 1]} {first[:4]}"
    return (f'<h3>{SB.CROP_LABEL[g]}: top {len(top)} of {n} bids for {ym_} delivery</h3>'
            f'<div class="cbt-scroll"><table class="cbt-t"><thead><tr><th>Elevator</th><th>Delivery</th>'
            f'<th class="n">Cash</th><th class="n">Basis</th></tr></thead><tbody>{"".join(trs)}</tbody></table></div>')


def state_table_doc(st, near, ctx, town_paths):
    """data/state-basis/<ST>.json: every elevator's nearest bid per crop, the
    table /basis/<state> used to print in full. Rows are lists to keep the
    file small; cols names them."""
    rows = []
    for r in sorted(near, key=lambda r: (BM.CROP_ORDER.index(r["group"]) if r["group"] in BM.CROP_ORDER else 9,
                                         SB.town_text(r["city"]).casefold(), r["operator"])):
        tp = town_paths.get(r["source"])
        flag = ("suspect" if r.get("suspect") else "outlier" if r.get("outlier") else
                "" if r["contract"] else "nocon")
        rows.append([r["group"], r["operator"], SB.town_text(r["city"]), tp[1] if tp else "",
                     round(r["cash"], 4), round(r["basis"], 4),
                     SB.contract_plain(r["contract"]) if r["contract"] else "",
                     SB.delivery_text(r), r.get("wow"), r["priced"].strftime("%Y-%m-%dT%H:%M:%SZ"), flag])
    pg = ctx.get("prev_generated")
    return {"schema": "agsist-state-basis/1", "state": st, "name": STATE_NAMES[st],
            "generated": ctx["snap_iso"], "prev": pg.strftime("%Y-%m-%dT%H:%M:%SZ") if pg else None,
            "crops": {g: SB.CROP_LABEL[g] for g in BM.CROP_ORDER},
            "cols": ["crop", "elevator", "town", "path", "cash", "basis", "vs", "delivery", "wow_cents",
                     "priced", "flag"],
            "rows": rows}


def state_counts(towns, near):
    """THE ELEVATOR AND TOWN COUNT, made once (2026-10-10). Four counts were in
    print for one network: boards read on the coverage pass, elevators summed
    over town pages, elevators with a basis row, town pages. Per state:
    elevators = distinct network boards with a current bid on the state's
    pages (a town page or the state's table); towns = towns with a current
    bid. Every page that says how many elevators have a bid reads this, from
    data/elevator-counts.json or from this function."""
    src, tw = defaultdict(set), defaultdict(set)
    for t in towns.values():
        live = [bd for bd in t["boards"].values() if bd["rows"]]
        if live:
            tw[t["state"]].add(t["slug"])
            src[t["state"]] |= {bd["source"] for bd in live}
    for r in near:
        if not r.get("suspect"):          # a misread board's figures are not a current bid
            src[r["state"]].add(r["source"])
    return {st: {"elevators": len(src[st]), "towns": len(tw[st])} for st in sorted(src)}


COUNTS_FILE = "elevator-counts.json"


def counts_doc(counts, ctx, root="."):
    """data/elevator-counts.json: the network's counts in one file. `bids` and
    `states` are made here; `coverage` is copied from the coverage map's own
    counts (data/elevator-coverage-counts.json, scripts/build_coverage_map.mjs),
    with its date, so a page reads every elevator count from one place."""
    cov = None
    try:
        with open(os.path.join(root, "data", "elevator-coverage-counts.json"), encoding="utf-8") as f:
            c = json.load(f)
        k = c.get("counts") or {}
        cov = {"generated": c.get("generated"), "read": k.get("read"), "quiet": k.get("quiet"),
               "known": k.get("known"), "elevators": k.get("elevators")}
    except (OSError, ValueError):
        pass
    return {"schema": "agsist-elevator-counts/1", "generated": ctx["snap_iso"],
            "note": ("bids: AGSIST network elevators with a current bid on a /cash-bids page, and the towns they "
                     "are in (scripts/build_cash_bid_pages.py state_counts). coverage: boards read on the latest "
                     "full coverage pass out of every elevator tracked (copied from "
                     "data/elevator-coverage-counts.json). Different questions: a board can be read and have no "
                     "current bid."),
            "bids": {"elevators": sum(v["elevators"] for v in counts.values()),
                     "towns": sum(v["towns"] for v in counts.values())},
            "states": counts, "coverage": cov}


def basis_states_doc(summaries, ctx, elevators):
    """data/basis-states.json: each state's headline per crop from the one
    method, for /basis (pick your state, the all-states ranking)."""
    states = {}
    for st, summ in sorted(summaries.items()):
        crops = {}
        for g, s in summ.items():
            if s["contracts"]:
                crops[g] = BM.headline_json(s["contracts"][0])
        states[st] = {"name": STATE_NAMES[st], "path": f"/cash-bids/{url_slug(STATE_NAMES[st])}/#basis",
                      "elevators": elevators.get(st, 0), "crops": crops}
    pg = ctx.get("prev_generated")
    return {"schema": "agsist-basis-states/1", "generated": ctx["snap_iso"],
            "prev": pg.strftime("%Y-%m-%dT%H:%M:%SZ") if pg else None,
            "method": ("Median basis (cash minus futures, $/bu) of AGSIST network elevators with a fresh bid, one "
                       "bid per elevator at its nearest open delivery, against the futures month most of the "
                       "state's elevators name. Unnamed months, misread boards and outliers (more than 5 robust "
                       "standard deviations, and never less than 75 cents, from the median) are left out. "
                       "wow = median change of bids posted in both snapshots, in cents. scripts/basis_method.py."),
            "min_n": BM.MIN_STAT, "states": states}


def _cell(c):
    if not c or "median" not in c:
        return '<td class="n"><span class="mut">too few</span></td>'
    return (f'<td class="n">{money_basis(c["median"])}<br><span class="mut">vs {esc(c["label"])} &middot; '
            f'n={c["n"]}</span></td>')


def hub_rank_html(doc):
    """The all-states table on /basis, ranked by the corn median (strongest
    first); a state with no corn number follows, by soybeans."""
    rows = [(st, v) for st, v in doc["states"].items()
            if any("median" in (v["crops"].get(g) or {}) for g in ("corn", "soybeans"))]
    rows.sort(key=lambda kv: (0 if "median" in (kv[1]["crops"].get("corn") or {}) else 1,
                              -(kv[1]["crops"].get("corn") or kv[1]["crops"].get("soybeans") or {}).get("median", 0),
                              kv[1]["name"]))
    thin = sorted(v["name"] for st, v in doc["states"].items() if (st, v) not in rows)
    trs = "".join(f'<tr><td><a href="{v["path"]}">{esc(v["name"])}</a></td>{_cell(v["crops"].get("corn"))}'
                  f'{_cell(v["crops"].get("soybeans"))}</tr>' for st, v in rows)
    t = (f'<div class="tblscroll"><table class="bs-tbl" id="bs-rank"><caption>Network elevators, snapshot of '
         f'{fmt_day(parse_ts(doc["generated"]))} &middot; strongest corn basis first</caption>'
         f'<tr><th>State</th><th style="text-align:right">Corn</th><th style="text-align:right">Soybeans</th></tr>'
         f'{trs}</table></div>')
    if thin:
        t += (f'<p class="bs-seed">Too few elevators on one futures month for a middle number: '
              + ", ".join(esc(n) for n in thin) + ".</p>")
    return t


def hub_pick_html(doc, st="IA"):
    """The default "your state" answer baked into /basis (Iowa); the page's
    script swaps it for the reader's state from the same file."""
    v = doc["states"].get(st)
    if not v:
        return ""
    parts = []
    for g in ("corn", "soybeans"):
        c = v["crops"].get(g)
        if not c or "median" not in c:
            continue
        wk = (f'; {SB.cents_delta(c["wow"])} in a week ({c["wow_n"]} bids both weeks)' if "wow" in c else "")
        parts.append(f'<li><b>{SB.CROP_LABEL[g]}</b> {money_basis(c["median"])} vs {esc(c["label"])} '
                     f'<span class="mut">n = {c["n"]} {_plural(c["n"], "elevator")}{wk}</span></li>')
    if not parts:
        return ""
    return (f'<ul class="bs-pick-l">{"".join(parts)}</ul><p class="bs-seed">Middle bid of {esc(v["name"])} '
            f'elevators in the AGSIST network, snapshot of {fmt_day(parse_ts(doc["generated"]))}. '
            f'<a href="{v["path"]}">{esc(v["name"])} bids and basis by elevator &rarr;</a></p>')


def stamp_basis_hub(path, doc):
    """Bake the network's state answer and ranking into /basis between its
    SEED markers. Nothing else in that page is touched. -> True when written."""
    if not os.path.exists(path):
        print(f"[cash-bid-pages] {path} not found; its state ranking was not updated")
        return False
    with open(path, encoding="utf-8") as f:
        html_ = f.read()
    out = html_
    for key, val in (("staterank", hub_rank_html(doc)), ("statepick", hub_pick_html(doc))):
        pat = re.compile(rf"(<!--SEED:{key}-->).*?(<!--/SEED-->)", re.S)
        if not pat.search(out):
            print(f"[cash-bid-pages] {path} has no SEED:{key}; its state ranking was not updated")
            return False
        out = pat.sub(lambda m: m.group(1) + val + m.group(2), out, count=1)
    if out != html_:
        with open(path, "w", encoding="utf-8") as f:
            f.write(out)
    return True


def build_state_index(st, metas, ctx, unplaced=(), near=(), summ=None, town_paths=None):
    sname = STATE_NAMES[st]
    ssl = url_slug(sname)
    path = f"/cash-bids/{ssl}/"
    summ = summ or {}
    town_paths = town_paths or {}
    live = sorted((m for m in metas if m["indexable"]), key=lambda m: m["name"].lower())
    quiet = sorted((m for m in metas if not m["indexable"]), key=lambda m: m["name"].lower())
    # THE COUNT, from the one place it is made (state_counts(), also written to
    # data/elevator-counts.json): elevators with a current bid on this page
    n_el = (ctx.get("counts") or {}).get(st, {}).get("elevators", sum(m["elevators"] for m in live))
    indexable = bool(live)
    title = f"{sname} Cash Grain Bids and Basis Today | AGSIST"
    if len(title) > 60:
        title = f"{sname} Cash Grain Bids and Basis | AGSIST"
    heads = []
    for g in ("corn", "soybeans"):
        c = (summ.get(g) or {}).get("contracts") or []
        if c and "median" in c[0]:
            heads.append(f"{SB.CROP_LABEL[g].lower()} {SB.plain_basis(c[0]['median'])} vs "
                         f"{SB.contract_plain(c[0]['contract'])} (n={c[0]['n']})")
    if indexable:
        desc = (f"Cash grain bids from {n_el} {sname} elevator{'s' if n_el != 1 else ''} across {len(live)} "
                f"town{'s' if len(live) != 1 else ''}, read from each elevator's own board.")
        if heads:
            d2 = desc + " Middle basis: " + "; ".join(heads) + "."
            desc = d2 if len(d2) <= 160 else (f"{sname} cash bids at {n_el} elevators. Middle basis: "
                                              + "; ".join(heads) + ".")
        desc = desc[:160]
    else:
        desc = f"{sname} cash grain bids by town: no current bid from the elevators the AGSIST network reads."[:160]
    share = None
    if indexable:
        tops = {}
        for m in live:
            for c, v in m["tops"].items():
                tops[c] = max(v, tops.get(c, v))
        top_txt, when = share_prices(tops)
        share = (f"{sname} cash bids and basis",
                 f"Bids from {n_el} elevator{'s' if n_el != 1 else ''} across {len(live)} {sname} "
                 f"town{'s' if len(live) != 1 else ''}. Top bid for nearest delivery: {top_txt}. "
                 f"Updated {fmt_share_time(when)}.")
    items = []
    for m in live:
        cl = ", ".join(CROP_LABEL[c].lower() for c in CROPS if c in m["crops"])
        items.append(f'<li><a href="{m["path"]}">{esc(m["name"])}</a> <span class="cbt-mut">· '
                     f'{m["elevators"]} elevator{"s" if m["elevators"] != 1 else ""}: {esc(cl)}; '
                     f'{asof_time(m["latest"])}</span></li>')
    quiet_html = ""
    if quiet:
        quiet_html = ('<h2>Towns with no current bid</h2><p class="cbt-cloud">'
                      + " &middot; ".join(f'<a href="{m["path"]}">{esc(m["name"])}</a>' for m in quiet) + "</p>")
    if unplaced:
        lis = []
        for op, city, z in sorted(set(unplaced), key=lambda u: (u[0].lower(), u[1].lower())):
            lab = esc(op) + (f" ({esc(city)})" if city and city.lower() != op.lower() else "")
            lis.append(f'<li>{lab}: <a href="/cash-bids?zip={z}">live bids at ZIP {z}</a></li>' if z
                       else f"<li>{lab}</li>")
        quiet_html += ('<h2>Network elevators not placed in a town</h2><p class="cbt-sub">These boards name a '
                       'facility rather than a town, their ZIP does not confirm one, and they are not within '
                       f'{NEAR_MI} miles of a town listed here. We do not guess the town. Their bids are on the live '
                       'page.</p><ul class="cbt-list">' + "".join(lis) + "</ul>")
    others = " &middot; ".join(f'<a href="/cash-bids/{url_slug(STATE_NAMES[o])}/">{STATE_NAMES[o]}</a>'
                               for o in ctx["states"] if o != st)
    crumbs = breadcrumb([("AGSIST", f"{SITE}/"), ("Cash bids", f"{SITE}/cash-bids"), (sname, f"{SITE}{path}")])
    graph = [crumbs]
    if near:
        graph.append({"@type": "Dataset", "@id": f"{SITE}{path}#dataset",
                      "name": f"{sname} cash grain bids and basis, AGSIST elevator network",
                      "description": (f"Cash bids and basis (cash minus the named futures contract, $/bu) posted by "
                                      f"{len({r['source'] for r in near})} elevators in {sname} that the AGSIST "
                                      f"elevator network read from their own bid boards, priced within "
                                      f"{FRESH_HOURS} hours of the snapshot. A sample of elevators, not every "
                                      f"elevator in the state."),
                      "url": f"{SITE}{path}", "isAccessibleForFree": True,
                      "creator": {"@type": "Organization", "name": "AGSIST", "url": SITE},
                      "dateModified": ctx["snap_iso"], "temporalCoverage": ctx["snap_iso"][:10],
                      "spatialCoverage": {"@type": "Place", "name": f"{sname}, United States"},
                      "variableMeasured": ["cash bid ($/bu)", "basis ($/bu, cash minus futures)"],
                      "distribution": {"@type": "DataDownload", "encodingFormat": "application/json",
                                       "contentUrl": f"{SITE}/data/state-basis/{st}.json"}})
    jsonld = {"@context": "https://schema.org", "@graph": graph}
    hdr, ftr = ctx["chrome"]
    lst = (f'<ul class="cbt-list">{"".join(items)}</ul>' if items else
           '<div class="cbt-note"><b>No current bid.</b> No elevator the AGSIST network reads in this state has a '
           'bid we could confirm right now.</div>')
    bests = best_bids(near)
    best_html = ""
    cards = [best_card(g, bests[g], town_paths) for g in ("corn", "soybeans") if g in bests]
    if not cards:
        cards = [best_card(g, bests[g], town_paths) for g in BM.CROP_ORDER[2:] if g in bests][:1]
    if cards:
        best_html = f'<h2 id="best">Best bid today</h2><div class="cbt-hero">{"".join(cards)}</div>'
    tops_html = "".join(top_bid_table(g, near, town_paths) for g in ("corn", "soybeans"))
    n_near = len({r["source"] for r in near})
    el_html = ""
    if near:
        el_html = (f'<h2 id="elevators">Elevators: bid and basis</h2>{tops_html}'
                   f'<p class="cbt-sub">The full table has the {n_near} {esc(sname)} '
                   f'elevator{"s" if n_near != 1 else ""} with a fresh corn, soybean or wheat bid, each crop at its '
                   f'nearest delivery, with the futures month, the change in a week and when it was posted.</p>'
                   f'<button type="button" class="cbt-more" data-state-table="{st}" aria-controls="cbt-full-{st}" '
                   f'aria-expanded="false">Show the full table ({n_near} elevators)</button>'
                   f'<div id="cbt-full-{st}" class="cbt-full" hidden></div>'
                   f'<noscript><p class="cbt-sub">The full table needs JavaScript. The '
                   f'<a href="/data/state-basis/{st}.json">same data as a file</a>, or each town below.</p></noscript>')
    pg = ctx.get("prev_generated")
    wow_note = (f" Change in a week compares each bid with the same elevator&rsquo;s same delivery and futures month "
                f"in the network snapshot of {fmt_day(pg)}." if pg else
                " No change in a week is shown: a network snapshot about seven days back was not available to this "
                "build, and a change is never estimated.")
    body = f"""
<body>
{hdr}
<main class="cbt-wrap" id="main">
  <p class="cbt-sub" style="margin-top:14px"><a href="/cash-bids" style="color:var(--text-muted)">Cash bids</a> &rsaquo; <b style="color:var(--text)">{esc(sname)}</b></p>
  <h1>{esc(sname)} cash grain bids and basis today</h1>
  <p class="cbt-sub">Bids and basis from elevators in the AGSIST network, read directly from each
  elevator&rsquo;s own bid board. This is the network&rsquo;s sample, not every elevator in {esc(sname)}; the
  <a href="/cash-bids">live cash bids page</a> searches by ZIP and adds more sources.</p>
  {best_html}
  {basis_section(st, summ, pg)}
  {el_html}
  <h2 id="towns">{len(live)} town{'s' if len(live) != 1 else ''} with a current bid</h2>
  {lst}
  {quiet_html}
  <div class="cbt-note"><b>How these numbers are made.</b> Source: the AGSIST elevator network (dnilgis/bids),
  boards read directly; no third-party bid feed is used on this page. A bid counts only if its board was confirmed
  live on the latest read and its price was posted within {FRESH_HOURS} hours, long enough that a board unchanged
  over a weekend still counts on Monday. Specialty bids (white, organic, non-GMO, high-oleic, identity-preserved)
  are left out of the basis. A middle number needs at least {BM.MIN_STAT} elevators on the same futures month.{wow_note}
  Prices move through the day; call the elevator before you haul.</div>
  <p class="cbt-sub" style="margin-top:18px"><a href="/cash-bids">Cash bids by ZIP</a> &middot; <a href="/basis#by-state">Basis in every state, and USDA regions vs normal</a></p>
  <h2>Other states</h2>
  <p class="cbt-cloud">{others}</p>
"""
    return head(title, desc, path, jsonld, indexable, share) + body + page_end(ftr, table=bool(near)), {
        "state": st, "path": path, "indexable": indexable, "towns": len(live), "quiet": len(quiet),
        "elevators": n_el, "latest": max((m["latest"] for m in live), default=None)}


LIVE_PAGE = "cash-bids.html"
LIVE_SHARE_GENERIC = {
    "og:description": "Find local cash grain bids by ZIP: corn, soybean and wheat elevator prices, basis, and the "
                      "Worth the Drive net-revenue tool.",
    "twitter:description": "Local cash grain bids by ZIP: corn, soybean, wheat elevator prices today + Worth the "
                           "Drive net revenue tool."}


def stamp_live_page(path, metas, counts=None):
    """Put the network's current counts and time in /cash-bids' link-preview
    description (og: and twitter: only; its <title>, meta description and
    everything else are hand-edited and left alone). With no town priced, the
    generic text goes back, so an old count never stays up. -> the text, or
    None when the page or its tags are missing (warned, never fatal)."""
    live = [m for m in metas if m["indexable"]]
    if not os.path.exists(path):
        print(f"[cash-bid-pages] {path} not found; its share text was not updated")
        return None
    with open(path, encoding="utf-8") as f:
        html = f.read()
    text = None
    if live:
        # the count from data/elevator-counts.json (state_counts) when given
        n_el = counts["bids"]["elevators"] if counts else sum(m["elevators"] for m in live)
        n_tw = counts["bids"]["towns"] if counts else len(live)
        text = (f"Find local cash grain bids by ZIP. The AGSIST network has current bids from {n_el:,} "
                f"elevator{'s' if n_el != 1 else ''} across {n_tw:,} town{'s' if n_tw != 1 else ''}. "
                f"Updated {fmt_share_time(max(m['latest'] for m in live))}.")
    out = html
    for key, generic in LIVE_SHARE_GENERIC.items():
        attr = "property" if key.startswith("og:") else "name"
        pat = re.compile(rf'(<meta {attr}="{re.escape(key)}" content=")[^"]*(">)')
        if not pat.search(out):
            print(f"[cash-bid-pages] {path} has no {key} tag; its share text was not updated")
            return None
        out = pat.sub(lambda m: m.group(1) + esc(text or generic) + m.group(2), out, count=1)
    if out != html:
        with open(path, "w", encoding="utf-8") as f:
            f.write(out)
    return text or LIVE_SHARE_GENERIC["og:description"]


def write_sitemap(path, entries):
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for loc, lm in entries:
        out.append(f"  <url><loc>{esc(loc)}</loc><lastmod>{lm.strftime('%Y-%m-%dT%H:%M:%SZ')}</lastmod>"
                   f"<changefreq>hourly</changefreq><priority>0.6</priority></url>")
    out.append("</urlset>\n")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(out))


# ---------------------------------------------------------------- build
def build_all(merged, index, zip_towns, out_dir=OUT_DIR, root=".", sitemap=None, now=None, check_age=True,
              min_towns=10000, zip_coord=None, prev_doc=None, data_dir=None, hub=None):
    """data_dir: where data/state-basis/<ST>.json and data/basis-states.json
    go (None = not written). hub: /basis page to bake the state ranking into."""
    now = now or dt.datetime.now(dt.timezone.utc)
    gen = parse_ts(merged.get("generated"))
    if gen is None:
        raise SystemExit("[cash-bid-pages] merged-all.json has no generated time; refusing to build")
    age_h = (now - gen).total_seconds() / 3600
    if check_age and age_h > MAX_SNAPSHOT_AGE_H:
        raise SystemExit(f"[cash-bid-pages] network snapshot is {age_h:.1f} h old (> {MAX_SNAPSHOT_AGE_H}); "
                         f"refusing to publish it as today's bids")
    tbs = known_towns(zip_towns)
    if sum(len(v) for v in tbs.values()) < min_towns:
        raise SystemExit("[cash-bid-pages] geocodes/zip-towns.json missing or short; refusing to build "
                         "(every town page would be dropped)")
    placed = {}
    towns, drops, unplaced = select(merged, index, tbs, zip_towns, zip_coord, placed)
    how = Counter(v["how"] for v in placed.values())
    drop_misreads(towns, drops)
    ids = {s["id"] for s in index.get("sources") or []}
    bad = [r for t in towns.values() for bd in t["boards"].values() for r in bd["rows"]
           if r["source"] not in ids or r["via"] != "scrape"]
    if bad:
        raise SystemExit(f"[cash-bid-pages] {len(bad)} non-network rows reached the build; refusing")

    near = state_basis_rows(merged, index)
    prev_map = SB.build_prev_map(prev_doc) if prev_doc else None
    prev_gen = parse_ts(prev_doc.get("generated")) if prev_doc else None
    summaries = {}
    for st_ in sorted({r["state"] for r in near}):
        summaries[st_] = BM.state_basis([r for r in near if r["state"] == st_], prev_map)
    town_paths = {}
    for t in towns.values():
        for bd in t["boards"].values():
            town_paths.setdefault(bd["source"], (t["name"], f"/cash-bids/{url_slug(STATE_NAMES[t['state']])}/{t['slug']}"))
    # every state with a network board gets its page, so /basis/<state> (now
    # forwarding here) never lands on a 404 on a quiet day; no bid = noindex
    boards_st = {(s_.get("usState") or "").upper() for s_ in index.get("sources") or []}
    states = sorted(({t["state"] for t in towns.values()} | {k[0] for k in unplaced} | set(summaries)
                     | boards_st) & set(STATE_NAMES), key=lambda s: STATE_NAMES[s])
    ctx = {"snap_ct": gen.astimezone(CT), "root": root, "chrome": SB.static_chrome(root), "states": states,
           "snap_iso": gen.strftime("%Y-%m-%dT%H:%M:%SZ"), "prev_generated": prev_gen,
           "counts": state_counts(towns, near)}
    before = set()
    if os.path.isdir(out_dir):
        for dp, _, fs in os.walk(out_dir):
            before |= {os.path.relpath(os.path.join(dp, f), out_dir) for f in fs if f.endswith(".html")}
    tmp = out_dir.rstrip("/") + ".tmp"
    shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(tmp)
    metas = []
    for tk in sorted(towns, key=lambda k: (STATE_NAMES[k[0]], k[1])):
        t = towns[tk]
        page, meta = build_town_page(t, ctx)
        d = os.path.join(tmp, url_slug(STATE_NAMES[t["state"]]))
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, f"{t['slug']}.html"), "w", encoding="utf-8") as f:
            f.write(page)
        metas.append(meta)
    smetas = []
    for st in states:
        page, sm = build_state_index(st, [m for m in metas if m["state"] == st], ctx,
                                     [v for k, v in unplaced.items() if k[0] == st],
                                     near=[r for r in near if r["state"] == st], summ=summaries.get(st),
                                     town_paths=town_paths)
        os.makedirs(os.path.join(tmp, url_slug(STATE_NAMES[st])), exist_ok=True)
        with open(os.path.join(tmp, url_slug(STATE_NAMES[st]), "index.html"), "w", encoding="utf-8") as f:
            f.write(page)
        smetas.append(sm)
    assert not os.path.exists(os.path.join(tmp, "index.html")), "cash-bids/index.html would capture /cash-bids"
    # swap in: towns that no longer have any network board disappear with the old tree
    shutil.rmtree(out_dir, ignore_errors=True)
    os.replace(tmp, out_dir)
    after = set()
    for dp, _, fs in os.walk(out_dir):
        after |= {os.path.relpath(os.path.join(dp, f), out_dir) for f in fs if f.endswith(".html")}
    new_urls = []
    for rel in sorted(after - before):
        u = "/" + OUT_DIR + "/" + rel.replace(os.sep, "/")
        u = u[:-len("index.html")] if u.endswith("/index.html") else u[:-5]
        new_urls.append(SITE + u)
    if data_dir:
        sd = os.path.join(data_dir, "state-basis")
        os.makedirs(sd, exist_ok=True)
        keep = set()
        for st in states:
            rs = [r for r in near if r["state"] == st]
            if not rs:
                continue
            keep.add(f"{st}.json")
            with open(os.path.join(sd, f"{st}.json"), "w", encoding="utf-8") as f:
                json.dump(state_table_doc(st, rs, ctx, town_paths), f, separators=(",", ":"))
        for fn in os.listdir(sd):
            if fn.endswith(".json") and fn not in keep:
                os.remove(os.path.join(sd, fn))
        el_by = {st_: v["elevators"] for st_, v in ctx["counts"].items()}
        doc = basis_states_doc(summaries, ctx, el_by)
        with open(os.path.join(data_dir, COUNTS_FILE), "w", encoding="utf-8") as f:
            json.dump(counts_doc(ctx["counts"], ctx, root), f, indent=1)
            f.write("\n")
        with open(os.path.join(data_dir, "basis-states.json"), "w", encoding="utf-8") as f:
            json.dump(doc, f, separators=(",", ":"))
        if hub:
            stamp_basis_hub(hub, doc)
    entries = [(SITE + m["path"], m["latest"]) for m in smetas if m["indexable"]]
    entries += [(SITE + m["path"], m["latest"]) for m in metas if m["indexable"]]
    if sitemap:
        write_sitemap(sitemap, entries)
    size = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(out_dir) for f in fs)
    n_idx = sum(1 for m in metas if m["indexable"])
    print(f"[cash-bid-pages] snapshot {merged.get('generated')} ({age_h:.1f} h old); drops {dict(drops)}; "
          f"{len(unplaced)} places not placed in a town (listed on the state index)")
    print(f"[cash-bid-pages] places with no town in their name: {len(placed)}; placed by ZIP {how['zip']}, "
          f"within {NEAR_MI} mi of a town {how['near']}, not placed {how['none']}")
    print(f"[cash-bid-pages] {len(metas)} town pages ({n_idx} with a current bid, {len(metas) - n_idx} noindex), "
          f"{len(smetas)} state indexes, {sum(m['elevators'] for m in metas)} elevators, "
          f"{sum(m['rows'] for m in metas)} bid rows, {size / 1024:.0f} KB -> {out_dir}/; "
          f"{len(entries)} sitemap URLs; {len(new_urls)} new pages")
    return metas, smetas, drops, new_urls


# ---------------------------------------------------------------- selftest
def _fixture():
    gen = "2026-10-07T18:00:00Z"
    fresh = "2026-10-07T17:00:00Z"
    srcs, bids = [], []

    def add(i, st, city, crop, cash, basis, fm="ZCZ26", period="2026-10", delivery="Oct 2026", stale=False,
            priced=fresh, commodity=None, currency="USD", health="live", via="scrape", in_index=True,
            unit="per-bushel", period_past=False, period_via="month-year", town=None, phone="402-555-0101"):
        sid = f"t-{i}"
        if in_index and sid not in {s["id"] for s in srcs}:
            srcs.append({"id": sid, "operator": f"Op {i}", "location": city, "usState": st, "zip": "68025",
                         "phone": phone, "status": "ok" if health == "live" else health, "health": health,
                         "pricedAt": priced, "checkedAt": "2026-10-07T17:30:00Z"})
        bids.append({"place": f"Op {i}||{city}|{st}", "operator": f"Op {i}", "city": city, "town": town,
                     "state": st, "zip": "68025", "currency": currency, "commodity": commodity or crop.title(),
                     "crop": crop, "delivery": delivery, "period": period, "periodVia": period_via,
                     "periodPast": period_past, "cash": cash, "basis": basis, "basisUnit": unit,
                     "futuresMonth": fm, "futuresCents": 777.77, "via": via, "source": sid,
                     "sourceStatus": "ok" if not stale else "broken", "stale": stale, "pricedAt": priced})
    # five corn boards on Dec at 4.20 futures, so the misread check has a median
    for k in range(5):
        add(f"n{k}", "NE", "FREMONT", "corn", round(4.20 - 0.30 - k * 0.01, 4), -0.30 - k * 0.01)
    add("n0", "NE", "FREMONT", "soybeans", 9.85, -0.35, fm="ZSX26")
    add("n0", "NE", "FREMONT", "corn", 3.91, -0.29, period="2026-11", delivery="Nov 2026 (2026-12)")
    # every one of these must stay off the page
    add("n0", "NE", "FREMONT", "corn", 3.71, None, period="2026-09", delivery="Sep 2026", period_past=True)
    add("n0", "NE", "FREMONT", "corn", 3.72, None, period="2026-10", delivery="By Oct 3",
        period_via="deadline-inferred-year")
    add("n0", "NE", "FREMONT", "corn", 3.73, None, period="newcrop-2025", delivery="New Crop 2025")
    add("bad", "NE", "FREMONT", "corn", 5.55, -0.30)          # implied futures 5.85 vs 4.20
    add("cad", "NE", "FREMONT", "corn", 1.14, -0.3, currency="CAD")
    add("bc", "NE", "FREMONT", "corn", 1.15, -0.3, in_index=False)
    add("old", "NE", "Hooper", "corn", 1.16, -0.3, priced="2026-10-01T12:00:00Z")
    add("dead", "NE", "Hooper", "corn", 1.17, -0.3, stale=True, health="broken")
    add("odd", "NE", "Fremont", "other", 30.0, None, unit="unknown")
    add("kept", "NE", "Fremont", "corn", 3.95, -0.25, period="2026-10", delivery="By Oct 9",
        period_via="deadline-inferred-year")
    # a town named by `town`, not `city`
    add("ag", "IA", "Redfield Elevator", "corn", 3.80, -0.40, town="Redfield")
    add("st", "NE", "Hooper, NE", "soybeans", 9.70, -0.50, fm="ZSX26")   # ", ST" suffix is still Hooper
    add("cfe", "IA", "CFE Ackworth", "corn", 3.81, -0.39)   # the operator's own initials in front
    index_fix = {"t-cfe": "Cooperative Farmers Elevator (CFE)"}
    add("fac", "IA", "Lincolnway Energy", "corn", 3.66, -0.54)   # a facility's name, no `town`
    for b in bids:
        if b["source"] in index_fix:
            b["operator"] = index_fix[b["source"]]
    merged = {"schema": "agsist-merged-all/1", "generated": gen, "bids": bids}
    return merged, {"generated": gen, "sources": srcs}


def selftest():
    import tempfile as _tf
    snap = parse_ts("2026-10-07T18:00:00Z").astimezone(CT)
    assert delivery_month("2026-09", "corn", snap) is None
    assert delivery_month("2026-09/2026-11", "corn", snap) == "2026-11"
    assert delivery_month("newcrop-2026", "corn", snap) == "2026-10"
    assert delivery_month("newcrop-2026", "wheat", snap) is None
    assert delivery_month("oldcrop-2026", "wheat", snap) == "2026-10"
    assert delivery_label({"delivery": "10/01/2026"}) == "Oct 2026"
    assert delivery_label({"delivery": "Fall 2026 (2026-12)"}) == "Fall 2026"
    assert dated_label_past({"periodVia": "deadline-inferred-year", "delivery": "By Oct 3", "period": "2026-10"}, snap)
    assert not dated_label_past({"periodVia": "day-range-inferred-year", "delivery": "Oct 1-9th",
                                 "period": "2026-10"}, snap)
    assert town_name("BAXTER  SPRINGS") == "Baxter Springs" and url_slug("St. Paul") == "st-paul"
    merged, index = _fixture()
    ZT = {"zips": {"68025": ["Fremont", "NE"], "68031": ["Hooper", "NE"], "50001": ["Ackworth", "IA"]}}
    with _tf.TemporaryDirectory() as td:
        out, sm = os.path.join(td, "cash-bids"), os.path.join(td, "sm.xml")
        metas, smetas, drops, new = build_all(merged, index, ZT, out_dir=out, root=".", sitemap=sm, min_towns=0,
                                              now=parse_ts("2026-10-07T19:00:00Z"))
        m = {(x["state"], x["slug"]): x for x in metas}
        assert set(m) == {("NE", "fremont"), ("NE", "hooper"), ("IA", "redfield"), ("IA", "ackworth")}, set(m)
        assert m[("NE", "fremont")]["indexable"] and m[("NE", "hooper")]["elevators"] == 1
        fr = open(os.path.join(out, "nebraska", "fremont.html")).read()
        for leak in ("$1.1", "3.71", "3.72", "3.73", "5.55", "7.77", "777", "Oct 3", "New Crop 2025", "30.00"):
            assert leak not in fr, f"an excluded value leaked: {leak}"
        assert "$3.95" in fr and "By Oct 9" in fr and "Nov 2026" in fr and "(2026-12)" not in fr
        assert '<link rel="canonical" href="https://agsist.com/cash-bids/nebraska/fremont">' in fr
        assert 'content="index,follow"' in fr and "call to confirm" in fr and "/cash-bids?zip=68025" in fr
        assert 'data-signup-ask=' in fr and 'data-zip="68025"' in fr, "a town page asks for an email with its own ZIP"
        assert "/components/cb-house.js" in fr, "a town page carries the house ask for its unsold footer slot"
        assert "Cash grain bids in Fremont, NE today" in fr
        assert "Op bad" not in fr or "did not check out" in fr
        # the link preview carries the page's own top nearby bids and their posted time
        assert '<meta property="og:title" content="Fremont, NE cash bids">' in fr
        assert '<meta name="twitter:title" content="Fremont, NE cash bids">' in fr
        share = re.search(r'<meta property="og:description" content="([^"]*)">', fr).group(1)
        assert share == re.search(r'<meta name="twitter:description" content="([^"]*)">', fr).group(1)
        assert share.startswith("Top bids for nearest delivery: corn $3.95, soybeans $9.85 at "), share
        assert share.endswith("Updated Oct 7, 12:00 pm."), share
        assert "<title>Cash Grain Bids in Fremont, NE Today | AGSIST</title>" in fr, "search title unchanged"
        # each board's posted time is the site's "Updated" stamp, re-rendered and aged by asof.js
        assert '<time class="asof" data-asof="bids" datetime="2026-10-07T17:00:00Z">Updated Oct 7, 12:00 pm</time>' in fr
        assert '/components/asof.js?v=1' in fr and '/components/asof.css?v=1' in fr
        for v in re.findall(r"\$(\d+\.\d\d)", share):
            assert f"${v}</td>" in fr, f"share price {v} is not on the page"
        for blk in re.findall(r'<script type="application/ld\+json">(.*?)</script>', fr, re.S):
            assert {g["@type"] for g in json.loads(blk)["@graph"]} == {"BreadcrumbList"}
        ho = open(os.path.join(out, "nebraska", "hooper.html")).read()
        assert "1.16" not in ho and "1.17" not in ho and "$9.70" in ho
        assert "Op old: no price posted in the last 72 hours" in ho, "a quiet board must be named, unpriced"
        # a town whose only boards are quiet is written noindex and left out of the sitemap
        lone = json.loads(json.dumps(merged))
        lone["bids"] = [x for x in lone["bids"] if x["source"] != "t-st"]
        build_all(lone, index, ZT, out_dir=out + "2", root=".", min_towns=0, now=parse_ts("2026-10-07T19:00:00Z"))
        ho2 = open(os.path.join(out + "2", "nebraska", "hooper.html")).read()
        assert 'content="noindex,follow"' in ho2 and "No current bid." in ho2
        assert "Top bids" not in ho2 and '<meta property="og:title" content="Cash Grain Bids in Hooper, NE Today' in ho2
        assert os.path.exists(os.path.join(out, "iowa", "redfield.html"))
        assert not os.path.exists(os.path.join(out, "iowa", "lincolnway-energy.html"))
        ia = open(os.path.join(out, "iowa", "index.html")).read()
        # an unplaced board is named, never given a guessed town: its bid can sit in the state's
        # elevator list (the state page covers every network elevator) but links to no town page
        assert "Op fac (Lincolnway Energy)" in ia and "lincolnway-energy" not in ia
        assert not os.path.exists(os.path.join(out, "index.html"))
        ne = open(os.path.join(out, "nebraska", "index.html")).read()
        assert 'href="/cash-bids/nebraska/fremont"' in ne and 'href="/cash-bids/iowa/"' in ne
        assert '<meta property="og:title" content="Nebraska cash bids and basis">' in ne
        # the state page is the state's basis page too: the one method, n beside the median,
        # the best bid first, the misread board left out and said so
        assert '<h2 id="basis">Nebraska basis today</h2>' in ne and 'href="/cash-bids/nebraska/#basis"' in fr
        assert ne.index('id="best"') < ne.index('id="basis"') < ne.index('id="elevators"') < ne.index('id="towns"')
        assert "&minus;$0.32</span></div><div class=\"l\">Corn: middle basis vs Dec &rsquo;26" in ne, "median of six Dec bids"
        assert "n = <b>6</b> elevators" in ne and "$3.95</div><div class=\"l\">Top corn bid" in ne
        assert "read as a misread board and left out" in ne and 'data-state-table="NE"' in ne
        assert "/components/state-bids.js?v=1" in ne and "/basis/" not in ne
        assert re.search(r'<meta name="twitter:description" content="Bids from \d+ elevators across 2 Nebraska towns\. '
                         r'Top bid for nearest delivery: corn \$3\.95, soybeans \$9\.85\. Updated Oct 7, 12:00 pm\.">',
                         ne), ne[:3000]
        # the data the state table and /basis read: written only when asked, from the same method
        dd, hubp = os.path.join(td, "data"), os.path.join(td, "basis.html")
        with open(hubp, "w") as f:
            f.write("<p><!--SEED:statepick-->old<!--/SEED--></p><div><!--SEED:staterank-->old<!--/SEED--></div>")
        build_all(merged, index, ZT, out_dir=out + "4", root=".", min_towns=0, now=parse_ts("2026-10-07T19:00:00Z"),
                  data_dir=dd, hub=hubp)
        bs = json.load(open(os.path.join(dd, "basis-states.json")))
        ne_c = bs["states"]["NE"]["crops"]["corn"]
        assert ne_c["median"] == -0.315 and ne_c["n"] == 6 and ne_c["label"] == "Dec '26", ne_c
        tbl = json.load(open(os.path.join(dd, "state-basis", "NE.json")))
        assert tbl["cols"][0] == "crop" and any(r[-1] == "suspect" for r in tbl["rows"]), tbl["rows"]
        assert any(r[3] == "/cash-bids/nebraska/fremont" for r in tbl["rows"])
        # one count: the counts file, the state page and the share text all say the same number
        cn = json.load(open(os.path.join(dd, "elevator-counts.json")))
        assert cn["bids"]["elevators"] == sum(v["elevators"] for v in cn["states"].values()), cn
        assert cn["states"]["NE"] == {"elevators": 7, "towns": 2}, cn["states"]
        ne4 = open(os.path.join(out + "4", "nebraska", "index.html")).read()
        assert "Cash grain bids from 7 Nebraska elevators across 2 towns" in ne4
        assert bs["states"]["NE"]["elevators"] == 7
        hub_html = open(hubp).read()
        assert 'href="/cash-bids/nebraska/#basis"' in hub_html and "old" not in hub_html, hub_html
        assert 'href="/cash-bids/iowa/#basis"' in hub_html and "n=3" in hub_html
        thin = hub_rank_html({"generated": "2026-10-07T18:00:00Z", "states": {"MO": {
            "name": "Missouri", "path": "/cash-bids/missouri/#basis",
            "crops": {"corn": {"n": 2, "label": "Dec '26", "contract": "ZCZ26", "outliers": 0}}}}})
        assert "Too few elevators" in thin and "Missouri" in thin and "/cash-bids/missouri/" not in thin, thin
        # /cash-bids gets the network counts, and the generic text back when nothing is priced
        lp = os.path.join(td, "cash-bids.html")
        gen_tags = (f'<meta property="og:description" content="{esc(LIVE_SHARE_GENERIC["og:description"])}">'
                    f'<meta name="twitter:description" content="{esc(LIVE_SHARE_GENERIC["twitter:description"])}">')
        with open(lp, "w") as f:
            f.write(f"<head>{gen_tags}</head>")
        txt = stamp_live_page(lp, metas)
        live_html = open(lp).read()
        assert txt.endswith("Updated Oct 7, 12:00 pm.") and live_html.count(esc(txt)) == 2, live_html
        assert stamp_live_page(lp, [x for x in metas if not x["indexable"]]) == LIVE_SHARE_GENERIC["og:description"]
        assert open(lp).read() == f"<head>{gen_tags}</head>"
        assert stamp_live_page(os.path.join(td, "missing.html"), metas) is None
        locs = re.findall(r"<loc>(.*?)</loc>", open(sm).read())
        assert "https://agsist.com/cash-bids/nebraska/fremont" in locs and "https://agsist.com/cash-bids/nebraska/" in locs
        for k in ("not_a_network_board", "not_us_or_not_usd", "price_older_than_cutoff", "stale_or_unconfirmed",
                  "delivery_expired_or_undated", "implied_futures_disagrees", "other_crop"):
            assert drops.get(k), (k, drops)
        assert len(new) == 6, new
        try:
            build_all(merged, index, {"zips": {}}, out_dir=out + "3", now=parse_ts("2026-10-07T19:00:00Z"))
            raise AssertionError("built without the town table")
        except SystemExit:
            pass
        # a rebuild from the same snapshot writes the same bytes and nothing new
        _, _, _, new2 = build_all(merged, index, ZT, out_dir=out, root=".", min_towns=0, now=parse_ts("2026-10-07T20:00:00Z"))
        assert new2 == [] and open(os.path.join(out, "nebraska", "fremont.html")).read() == fr
        try:
            build_all(merged, index, ZT, out_dir=out, min_towns=0, now=parse_ts("2026-10-08T03:00:00Z"))
            raise AssertionError("stale snapshot built")
        except SystemExit:
            pass
    print("selftest OK")


def zip_centroids(base):
    """zip -> (lat, lon) from the bids repo's data/zips/NN.json, the table
    merge_bids.mjs checks a ZIP against a pin with. A shard that cannot be read
    gives no centroid, and a ZIP with no centroid is not trusted against a pin."""
    shards = {}

    def get(z):
        if z[:2] not in shards:
            try:
                shards[z[:2]] = SB._net_get_json(base, f"data/zips/{z[:2]}.json") or {}
            except Exception as e:  # noqa: BLE001
                print(f"[cash-bid-pages] data/zips/{z[:2]}.json unreadable ({e}); its ZIPs are not checked")
                shards[z[:2]] = {}
        c = shards[z[:2]].get(z)
        return tuple(c) if isinstance(c, list) and len(c) == 2 else None
    return get


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--bids-dir", help="local dnilgis/bids clone instead of the published URLs")
    ap.add_argument("--base", help="network base URL (default: fetch_bids.BIDS_NETWORK_BASE)")
    ap.add_argument("--out", default=OUT_DIR)
    ap.add_argument("--root", default=".")
    ap.add_argument("--sitemap", default=SITEMAP)
    ap.add_argument("--print-new", metavar="FILE", help="write URLs first created this run, one per line")
    ap.add_argument("--ignore-age", action="store_true", help="build even from an old snapshot (testing)")
    ap.add_argument("--prev-file", help="explicit earlier merged-all.json for the week's basis change")
    ap.add_argument("--no-wow", action="store_true", help="skip the week's basis change")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        selftest()
        return
    merged, index = SB.load_network(a.bids_dir, a.base)
    base = a.bids_dir or a.base or SB.BIDS_NETWORK_BASE
    zip_towns = SB._net_get_json(base, "geocodes/zip-towns.json")
    gen = parse_ts(merged.get("generated"))
    prev = None
    if not a.no_wow and gen:
        prev = SB.load_previous(gen, bids_dir=a.bids_dir, prev_file=a.prev_file, allow_remote=not a.bids_dir)
    metas, smetas, _, new = build_all(merged, index, zip_towns, out_dir=a.out, root=a.root, sitemap=a.sitemap,
                                      check_age=not a.ignore_age, zip_coord=zip_centroids(base), prev_doc=prev,
                                      data_dir=os.path.join(a.root, "data"), hub=os.path.join(a.root, HUB_PAGE))
    try:
        with open(os.path.join(a.root, "data", COUNTS_FILE), encoding="utf-8") as f:
            counts = json.load(f)
    except (OSError, ValueError):
        counts = None
    stamp_live_page(os.path.join(a.root, LIVE_PAGE), metas, counts)
    if a.print_new:
        with open(a.print_new, "w") as f:
            f.write("".join(u + "\n" for u in new))


if __name__ == "__main__":
    main()
