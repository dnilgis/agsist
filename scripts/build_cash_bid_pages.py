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
    (or: board and row "skipped", i.e. not asked this pass, with its last
    successful read within SB.HELD_SKIP_HOURS; see held_skip())
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

UNREAD ELEVATORS (2026-10-13)
  data/directory.json (the bids network's roster) also names elevators it
  knows but cannot read: status "known", ids known:... (the licensed roster)
  and reg:... (state and federal warehouse licences). A town page lists the
  ones in its town under "Also in <town>, bids not read yet", each with a link
  to /list-your-elevator filled in from the roster, so the elevator can ask to
  post its own bids. No price, phone or address of theirs is printed. At most
  KNOWN_MAX per page; the rest are counted with a link to the coverage map.
  When the roster cannot be read the section is left out and every page is
  built exactly as before. Styles are inline on that section only, so a town
  with no unread elevator does not change a byte.

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
from html import unescape as html_unescape
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
import pointer_pages as PP  # noqa: E402  dropped pages leave a pointer, not a 404
import build_state_basis_pages as SB  # noqa: E402  (helpers + the network reader, one copy)
import basis_method as BM  # noqa: E402  (the one state-basis method)
import pricefmt  # noqa: E402  (cash as posted: twin of components/util.js AG.px.cash)
import storesell  # noqa: E402  (the site's one store-or-sell calculation, twin of components/storesell.js)
from elevator_names import clean_place, display_name  # noqa: E402  (page-title names fixed, twin of cb-rank.js)
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
WHEAT_EXCH = {"KE": "KC", "ZW": "Chicago", "MW": "MIAX", "MWO": "MIAX"}


def con_label(c):
    """The futures month a basis is against, as a town page prints it. Wheat
    names its exchange, because Dec wheat is three contracts: "KC Dec '26",
    "Chicago Dec '26". Corn and soybeans: "Dec '26"."""
    ex = WHEAT_EXCH.get(c[0])
    return (ex + " " if ex else "") + contract_label(c)


def cash_c(v):
    """A cash bid on a town or state page, to the cent: $13.4275 -> "$13.43"
    (half up, like the boards round). 293 town pages printed four places on
    2026-10-15; the live page keeps the board's own decimals."""
    if not isinstance(v, (int, float)):
        return pricefmt.cash(v)
    n = float(v)
    r = pricefmt._js_round(abs(n) * 100 + 1e-7) / 100
    return pricefmt.cash(-r if n < 0 else r)


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
    # A month-day-year label on the 1st is a delivery MONTH START, not a deadline:
    # CDR Farms (AgriCharts) posts "Oct 01, 2026" for October delivery (contract
    # code V26) and keeps the row up all month, exactly like the "10/01/2026"
    # us-date rows, which were never treated as dated.
    if row.get("periodVia") == "month-day-year" and re.search(r"\b0?1,?\s+\d{4}\b", row.get("delivery") or ""):
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


_SEASON_RE = re.compile(
    r"^(?:(harv(?:est)?(?:\s+del(?:ivery)?)?|har)|(n/?c|new\s*crop|n\s+crop|new)|(fall)|(o/?c|old\s*crop))"
    r"\s*'?\s*(\d{4}|\d{2})?'?(?![\w/])(.*)$", re.I)
_SEASON_FIRST_RE = re.compile(r"^(\d{4}|\d{2})\s+(new\s*crop|fall|harvest|crop)\b(.*)$", re.I)
_SEASON_WORD = ("Harvest", "New crop", "Fall", "Old crop")
_LAST_DAY = (31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)


def _yy(t):
    return int(t) + 2000 if len(t) == 2 else int(t)


def delivery_text(delivery, period=""):
    """The delivery a board posted, as the page prints it. Twin of
    components/cb-rank.js deliveryText(): the ZIP search and the town pages print
    one board the same way. test/fixtures/delivery-labels.json runs through both
    (test/cb-rank.test.mjs). River Country Co-op's "HAR 26" and "HAR 27" read as
    "Harvest 2026" and "Harvest 2027" on both pages.

    - "(YYYY-MM)" the gradable adapter appends is the futures contract, dropped.
    - A month as a board writes one ("Oct 26", "OCTOBER 2026", "10/01/2026",
      "Oct 01, 2026") is "Oct 2026". A bare "October" ("Dec corn" is "Dec 2026 corn") or a whole-month range
      ("01 Oct 2026 to 31 Oct 2026") takes its year from the month the network
      worked out (period "2026-10"); part of a month ("01 Oct 2026 to
      16 Oct 2026") is "Oct 1-16, 2026". A deadline ("By Oct 9") stays as written.
    - A season code is spelled out in the board's own word: HAR -> Harvest,
      NC / New Crop -> New crop, Fall, OC -> Old crop; a two-digit year is 20xx.
      With no year on the label, the network's season year (newcrop-2026) is used.
    - Anything else is printed as the board wrote it."""
    lab = re.sub(r"\s*\(\d{4}-\d{2}\)\s*$", "", str(delivery or "").strip())
    lab = re.sub(r"\s+", " ", lab).strip()
    per = str(period or "")
    m = re.fullmatch(r"([A-Za-z]{3})[A-Za-z]*\.?\s*'?(\d{2}|\d{4})", lab)
    if m and m.group(1).title() in MONTH_ABBR:
        return f"{m.group(1).title()} {_yy(m.group(2))}"
    m = re.fullmatch(r"(\d{1,2})/0?1/(\d{4})", lab)
    if m and 1 <= int(m.group(1)) <= 12:
        return f"{MONTH_ABBR[int(m.group(1)) - 1]} {m.group(2)}"
    m = re.fullmatch(r"([A-Za-z]{3})[A-Za-z]*\.?\s+0?1,?\s+(\d{4})", lab)
    if m and m.group(1).title() in MONTH_ABBR:
        return f"{m.group(1).title()} {m.group(2)}"
    pm = re.fullmatch(r"(\d{4})-(\d{2})", per)
    if pm and 1 <= int(pm.group(2)) <= 12:
        y, mo = int(pm.group(1)), int(pm.group(2))
        r = re.fullmatch(r"(\d{1,2}) ([A-Za-z]{3}) (\d{4}) to (\d{1,2}) ([A-Za-z]{3}) (\d{4})", lab)
        if r and r.group(2).title() == r.group(5).title() == MONTH_ABBR[mo - 1] \
                and int(r.group(3)) == int(r.group(6)) == y:
            d1, d2 = int(r.group(1)), int(r.group(4))
            last = 29 if mo == 2 and y % 4 == 0 else (28 if mo == 2 else _LAST_DAY[mo - 1])
            if not (d1 == 1 and d2 == last) and 1 <= d1 <= d2 <= last:
                return f"{MONTH_ABBR[mo - 1]} {d1}-{d2}, {y}"
            return f"{MONTH_ABBR[mo - 1]} {y}"
        if not lab:
            return f"{MONTH_ABBR[mo - 1]} {y}"
        b_ = re.match(r"([A-Za-z]{3})[A-Za-z]*\.?\s*(?:'?(\d{4}|\d{2})'?)?(?![\w/'])\s*(.*)$", lab)
        if b_ and b_.group(1).title() == MONTH_ABBR[mo - 1] and (not b_.group(2) or _yy(b_.group(2)) == y) \
                and re.fullmatch(r"(?:[A-Za-z]+(?: [A-Za-z]+)*)?", b_.group(3)) \
                and not re.match(MON_RE + r"(?![a-z])", b_.group(3), re.I):
            return f"{MONTH_ABBR[mo - 1]} {y}" + (" " + b_.group(3) if b_.group(3) else "")
    sy = re.fullmatch(r"(?:new|old)crop-(\d{4})", per)
    m = _SEASON_RE.match(lab)
    if m:
        word = _SEASON_WORD[next(i for i in range(4) if m.group(i + 1))]
        rest = m.group(6).strip()
        year = _yy(m.group(5)) if m.group(5) else None
        if year is None and sy and not re.search(r"\d", rest):
            year = int(sy.group(1))
        out = word + (f" {year}" if year else "")
        if rest:
            out += (", " + rest.lstrip("-,: ").strip()) if re.match(r"[-,:]", rest) else " " + rest
        return out.strip()
    m = _SEASON_FIRST_RE.match(lab)
    if m:
        w = m.group(2).lower()
        word = "New crop" if w.startswith("new") else "Harvest" if w == "harvest" else "Fall" if w == "fall" else "Crop"
        rest = m.group(3).strip()
        return f"{word} {_yy(m.group(1))}" + (" " + rest if rest else "")
    if not lab:
        if per == "spot":
            return "Spot"
        pr = re.fullmatch(r"(\d{4})-(\d{2})/(\d{4})-(\d{2})", per)
        if pr and 1 <= int(pr.group(2)) <= 12 and 1 <= int(pr.group(4)) <= 12:
            a_, b_ = MONTH_ABBR[int(pr.group(2)) - 1], MONTH_ABBR[int(pr.group(4)) - 1]
            return f"{a_}-{b_} {pr.group(3)}" if pr.group(1) == pr.group(3) else f"{a_} {pr.group(1)}-{b_} {pr.group(3)}"
        if sy:
            return f"{'New crop' if per.startswith('new') else 'Old crop'} {sy.group(1)}"
    return lab


def delivery_label(row):
    """What the town page prints for a row's delivery: delivery_text()."""
    return delivery_text(row.get("delivery"), row.get("period"))


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


def _one_line(v, n):
    """A plain one-line string of at most n characters, or "" (typed by the elevator)."""
    if not isinstance(v, str):
        return ""
    v = re.sub(r"\s+", " ", re.sub(r"[\x00-\x1f\x7f]+", " ", v)).strip()
    return v if len(v) <= n else v[:n - 1] + "\u2026"


def portal_info(p):
    """The listing an elevator keeps on agsist.com/post, as the network carries
    it on its index.json row (`portal`: listingId, name, contactName, hours,
    harvestHours, note, closedUntil, infoUpdatedAt). None for every other board.
    Only the fields a town page prints are kept, each one cut to one line."""
    if not isinstance(p, dict):
        return None
    o = {"contact": _one_line(p.get("contactName"), 40), "hours": _one_line(p.get("hours"), 120),
         "harvest": _one_line(p.get("harvestHours"), 120), "note": _one_line(p.get("note"), 140),
         "closed_until": parse_ts(p.get("closedUntil")) if isinstance(p.get("closedUntil"), str) else None}
    return o if any(o.values()) else None


def portal_html(pi, snap):
    """Hours, harvest hours and the note for a portal elevator's section.
    CLOSED TODAY IS NOT BAKED IN: a static page outlives the day. When the
    snapshot still has closedUntil ahead, the page carries the time in a hidden
    line and a few bytes of script show it only while the reader's clock is
    before it (and hide it again when it passes). Past closedUntil, nothing."""
    if not pi:
        return ""
    out = ""
    cu = pi.get("closed_until")
    if cu and snap and cu > snap:
        iso = cu.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        out += (f'<p class="cbt-closed" data-closed-until="{iso}" hidden style="display:inline-block;margin:4px 0 2px;'
                'padding:1px 7px;border:1px solid var(--red);border-radius:5px;color:var(--red);font-size:.8rem;'
                'font-weight:700">Closed today</p>'
                '<script>(function(e){var u=Date.parse(e.getAttribute("data-closed-until")),n=Date.now();'
                'if(u>n){e.hidden=false;setTimeout(function(){e.hidden=true},Math.min(u-n,2147483647))}})'
                '(document.currentScript.previousElementSibling)</script>')
    lines = []
    if pi.get("hours"):
        lines.append(f'<b>Hours</b> {esc(pi["hours"])}')
    if pi.get("harvest"):
        lines.append(f'<b>Harvest</b> {esc(pi["harvest"])}')
    if lines:
        out += f'<p class="cbt-posted" style="margin:2px 0">{"<br>".join(lines)}</p>'
    if pi.get("note"):
        out += (f'<p class="cbt-posted" style="margin:4px 0 6px;color:var(--text);border-left:2px solid var(--gold);'
                f'padding-left:8px;overflow-wrap:anywhere">{esc(pi["note"])}</p>')
    return out


# ---------------------------------------------------------------- selection
# A year the network had to guess (the label names months, no year) can land a
# year off: Michigan Agricultural Commodities' "Oct/Nov27" was read as Oct 2026
# on a Dec '27 contract, Westfield's "SEP/OCT/NOV 26" as Sep 2027 on Nov '26.
# The futures month a board prices a delivery against falls from two months
# before the delivery starts to eleven after; outside that, the guessed year is
# moved one year the way that puts the contract inside, and a row that fits
# neither way is dropped. A year the board wrote (10/01/2026, Jan 27) is never
# moved: Stratton prices Aug 2027 corn off Dec '26 on purpose.
YEAR_GUESS_VIA = {"month-inferred-year", "month-pair-inferred-year"}
CON_BEFORE, CON_AFTER = 2, 11


def _shift_period(p, k):
    return re.sub(r"(\d{4})(?=-\d{2})", lambda m: str(int(m.group(1)) + k), p)


def checked_period(b, con):
    """The row's period, moved a year when its year was guessed and the
    futures month says it is off; None when no year fits."""
    p = str(b.get("period") or "")
    via = b.get("periodVia")
    m = re.fullmatch(r"(\d{4})-(\d{2})(?:/(\d{4})-(\d{2}))?", p)
    if not m or not con:
        return b.get("period")
    wrap = via == "month-pair" and m.group(4) and int(m.group(2)) > int(m.group(4))
    if via not in YEAR_GUESS_VIA and not wrap:
        return b.get("period")
    ci = con[2] * 12 + con[1]
    def fits(k):
        start = (int(m.group(1)) + k) * 12 + int(m.group(2)) - 1
        return start - CON_BEFORE <= ci <= start + CON_AFTER
    for k in (0, -1, 1):
        if fits(k):
            return _shift_period(p, k) if k else b.get("period")
    return None


# A board the network files in the wrong town, fixed by hand with the evidence.
# keycoop-pinelake is posted as "Ackney" (Ackley's ZIP 50601 and its town pin),
# but the board's own label is "Pine Lake": Key Cooperative's Pine Lake elevator
# west of Steamboat Rock, the site Innovative Ag Services lists as Pine Lake at
# 42.4178,-93.0629, 9 mi south of Ackley. It posts corn only.
PLACE_OVERRIDE = {
    "keycoop-pinelake": {"state": "IA", "town": "Steamboat Rock", "zip": "50672", "pin": (42.4178, -93.0629)},
}


def _misspelt(a, b):
    """True when a is b with one letter changed ("ackney" for "ackley")."""
    return a != b and len(a) == len(b) >= 4 and a.isalpha() and b.isalpha() \
        and sum(x != y for x, y in zip(a, b)) == 1


def branch_name(b, src, town, known):
    """The delivery point as the answer names it: the board's own label in its
    feed ("Pine Lake") when it has one, else the posted city, except a city that
    is no known town and is one letter off the town the board is filed in
    ("Ackney" on the Ackley page). Facility names ("Ingredion"), hamlets and
    numbered points ("Creston 1") stay."""
    lab = clean_place(town_name(src.get("labelInFeed") or ""))
    if lab:
        return lab
    city = clean_place(town_name(b.get("city")))
    k = town_key(city)
    if k not in known and _misspelt(k, town_key(town)):
        return ""
    return city


def select(merged, index, towns_by_state, zip_towns=None, zip_coord=None, placed=None, moved=None):
    """-> (towns, drops, unplaced). towns: {(ST, town_key): {...}} with every
    board that has posted rows in that town and, per board, the rows that may
    print. A place town_of() cannot name is tried by place_fallbacks().
    moved: a dict to fill with {(ST, slug of the town its name says): (town it
    went to, operator, branch)} for every board whose name names a town its
    ZIP or pin does not fit (name_fit()), so that page can point to the right one."""
    gen = parse_ts(merged.get("generated"))
    snap_ct = gen.astimezone(CT)
    srcs = {s["id"]: s for s in (index.get("sources") or []) if s.get("id")}
    fit = name_fit(town_zips(zip_towns), zip_coord)
    fallback = place_fallbacks(merged, srcs, towns_by_state, zip_towns, zip_coord, fit=fit)
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
        ovr = PLACE_OVERRIDE.get(sid)
        ovr = ovr if ovr and ovr["state"] == st else None
        wrong = []
        tname = ovr["town"] if ovr else town_of(b, src, towns_by_state, fit, wrong)
        how = {"how": "name"}
        if not tname and fallback.get((st, b.get("place") or sid)):
            how = fallback[(st, b.get("place") or sid)]
            tname = how["town"] if how["how"] != "none" else None
        if not tname:
            drops["rows_not_placed_in_a_town"] += 1
            unplaced.setdefault((st, b.get("place") or sid), (display_name(b.get("operator") or ""),
                                                              clean_place(town_name(b.get("city"))),
                                                              zip5(b.get("zip") or src.get("zip"))))
            continue
        tk = (st, url_slug(tname))
        if moved is not None:
            for w in wrong:
                if url_slug(w) != tk[1]:
                    moved.setdefault((st, url_slug(w)), (tname, display_name(b.get("operator") or src.get("operator") or ""),
                                                         clean_place(town_name(b.get("city")))))
        t = towns.setdefault(tk, {"state": st, "name": tname, "slug": tk[1], "boards": {}})
        place = b.get("place") or sid
        bd = t["boards"].setdefault(place, {
            "place": place, "source": sid,
            "operator": display_name(b.get("operator") or src.get("operator") or ""),
            "city": clean_place(town_name(b.get("city"))), "branch": branch_name(b, src, tname, towns_by_state.get(st, {})),
            "zip": ovr["zip"] if ovr else zip5(b.get("zip") or src.get("zip")),
            "phone": src.get("phone") or "", "checked": parse_ts(src.get("checkedAt")),
            "last_priced": None, "rows": [], "why": Counter(), "how": how["how"], "near_mi": how.get("mi"),
            "town": tname, "state": st, "pin": ovr["pin"] if ovr else _pin(b),
            # hours, contact, note and closed-until of an elevator that posts
            # its own bids through agsist.com/post; None for every other board
            "portal": portal_info(src.get("portal"))})
        pt = parse_ts(b.get("pricedAt"))
        if pt and (bd["last_priced"] is None or pt > bd["last_priced"]):
            bd["last_priced"] = pt

        def no(k):
            drops[k] += 1
            bd["why"][k] += 1

        held = SB.held_skip(b, src, gen)   # skipped this pass, read within HELD_SKIP_HOURS
        if not held and (b.get("stale") is not False or b.get("sourceStatus") != "ok"):
            no("stale_or_unconfirmed")
            continue
        if not held and (src.get("status") != "ok" or src.get("health") != "live"):
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
        con = parse_contract(b.get("futuresMonth"), crop if crop in ("corn", "soybeans") else
                             ("corn" if crop == "sorghum" else crop), gen.year, b.get("commodity"))
        raw_period = b.get("period")
        period = checked_period(b, con)
        if period is None:
            no("delivery_year_did_not_check_out")
            continue
        if period != b.get("period"):
            b = dict(b, period=period, periodPast=False)
        if b.get("periodPast") or delivery_month(period, crop, snap_ct) is None \
                or dated_label_past(b, snap_ct):
            no("delivery_expired_or_undated")
            continue
        basis = b.get("basis")
        basis = round(float(basis), 4) if isinstance(basis, (int, float)) else None
        bd["rows"].append({
            "crop": crop, "commodity": (b.get("commodity") or "").strip(), "label": delivery_label(b),
            "dm": delivery_month(period, crop, snap_ct), "period": str(period or ""),
            "period_feed": str(raw_period or ""),
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


NAME_FIT_MI = 15     # a town read from a board's name must be this close to the board's ZIP centre or street pin


def _one_digit_off(a, b):
    return len(a) == len(b) == 5 and sum(x != y for x, y in zip(a, b)) == 1


def name_fit(zips_of, zip_coord):
    """fit(st, town, b, src) -> False only when a board named for `town` clearly
    is not there. The name stands when any of these holds:
      - the board's ZIP is one of the town's ZIPs (Ashmore and Ingraham, IL:
        own ZIP, pin miles off; a pin that is not street-level is not used to
        throw a name out);
      - the board's ZIP is one digit off one of the town's ZIPs: a typo, the
        name is right (NEW Cooperative's Essex, IA board posts 50638 for 51638;
        Agtegra's Bowdle, SD 57528 for 57428);
      - a street-level pin sits within NAME_FIT_MI of the town;
      - with no street pin: the ZIP's centre, or the board's own pin (the
        network places a pin from the town name when it has no street
        address), is within NAME_FIT_MI of one of the town's ZIP centres;
      - there is nothing to check against (no ZIP centre, no pin, or a town
        with no centre).
    Farmers Win Cooperative's "Granger" board posts ZIP 52136 (Cresco) with its
    pin on that ZIP, 140 mi from Granger, IA: it fails, and the ZIP rule in
    place_fallbacks() puts it in Cresco. A street pin farther than
    NAME_FIT_MI from the named town fails too (FS Grain's "CHS - Elburn/ Morris"
    is in Elburn, 37 mi from Morris)."""
    def fit(st, town, b, src):
        tz = zips_of.get((st, town_key(town))) or []
        z = zip5(b.get("zip") or src.get("zip"))
        if z and (z in tz or any(_one_digit_off(z, x) for x in tz)):
            return True
        cents = [c for c in (zip_coord(x) for x in tz) if c] if zip_coord else []
        if not cents:
            return True

        def near(p):
            return any(miles(p[0], p[1], q[0], q[1]) <= NAME_FIT_MI for q in cents)
        pin = _pin(b)
        if pin and b.get("precision") == "street":
            return near(pin)
        pts = [c for c in [zip_coord(z) if (z and zip_coord) else None, pin] if c]
        return not pts or any(near(p) for p in pts)
    return fit


def town_of(b, src, towns_by_state, fit=None, rejected=None):
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
    A town found by rules 2 to 4 is a name match only; with `fit` (name_fit())
    it must also agree with the board's ZIP or street pin, or it is passed over
    (and added to `rejected`, a list, when one is given). A branch named for a
    town 140 mi away ("Granger" on a Cresco ZIP) is not that town.
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

    def ok(hit):
        if not hit:
            return None
        if fit is None or fit(st, hit, b, src):
            return hit
        if rejected is not None and hit not in rejected:
            rejected.append(hit)
        return None
    hit = ok(known.get(town_key(city)))
    if not hit:
        for piece in reversed(re.split(r"\s+-\s*|\s*-\s+|/|,", city)):
            hit = ok(known.get(town_key(piece)))
            if hit:
                break
    if not hit:
        op = {w for w in re.split(r"[^a-z0-9]+", (b.get("operator") or src.get("operator") or "").lower()) if w}
        words = city.split()
        k = 0
        while k < len(words) - 1 and re.sub(r"[^a-z0-9]", "", words[k].lower()) in op:
            k += 1
        if k:
            hit = ok(known.get(town_key(" ".join(words[k:]))))
    return town_name(hit) if hit else None


KNOWN_MAX = 6         # unread elevators named on one town page; the rest are counted
LISTING_PAGE = "/list-your-elevator"
DIR_ID_RE = re.compile(r'^(known|reg):[^<>"`\\]{1,190}$')   # the worker's and the form's dir_id rule
OP_NOISE = re.compile(r"\b(inc|llc|l\s?l\s?c|co|company|corp|corporation|cooperative|coop|co-op|the|of|grain|"
                      r"elevator|elevators|farmers)\b")
TOWN_ALT = {"saint": "st", "mount": "mt", "fort": "ft", "sainte": "ste"}


def op_key(name, town=""):
    """An operator name with the legal and trade words, and the town's own
    name, taken out: "Bartlett Grain Company- St. Joseph" and "Bartlett Grain
    Company, LLC" in Saint Joseph are one operator there. For telling an unread
    roster entry apart from another one, or from a board already on the page."""
    # "Co-op" first: OP_NOISE's "co" would leave "op" ("Heartland Co-op" vs "Heartland Coop")
    s = OP_NOISE.sub(" ", re.sub(r"\bco\s?-?\s?op\b", "coop", (name or "").lower()))
    for w in re.findall(r"[a-z0-9]+", (town or "").lower()):
        for v in {w, TOWN_ALT.get(w, w)}:
            s = re.sub(rf"\b{v}\b", " ", s)
    return re.sub(r"[^a-z0-9]", "", s)


def known_by_town(directory, towns_by_state):
    """{(ST, town slug): [{id, name, town, state}]} for every roster entry the
    network knows but does not read, placed in a town the same way a board is
    (town_of on its location). One entry per operator per town; sorted by name."""
    out = defaultdict(list)
    seen = set()
    for e in (directory or {}).get("elevators") or []:
        if not isinstance(e, dict) or e.get("status") != "known":
            continue
        st = (e.get("state") or "").upper()
        eid = str(e.get("id") or "")
        name = re.sub(r"\s+", " ", str(e.get("operator") or "")).strip()
        if st not in STATE_NAMES or not name or not DIR_ID_RE.match(eid):
            continue
        tname = town_of({"state": st, "city": e.get("location") or "", "operator": name}, {}, towns_by_state)
        if not tname:
            continue
        tk = (st, url_slug(tname))
        k = (tk, op_key(name, tname) or name.lower())
        if k in seen:
            continue
        seen.add(k)
        out[tk].append({"id": eid, "name": name, "town": tname, "state": st})
    for v in out.values():
        v.sort(key=lambda x: x["name"].lower())
    return out


def listing_link(e, z=""):
    """/list-your-elevator with the form filled in from the roster (components/list-elevator.js prefill)."""
    from urllib.parse import quote
    q = f"id={quote(e['id'], safe='')}&name={quote(e['name'], safe='')}&town={quote(e['town'], safe='')}&state={e['state']}"
    if z and re.fullmatch(r"\d{5}", z):
        q += f"&zip={z}"
    return f"{LISTING_PAGE}?{q}"


def known_section(t, known, z=""):
    """'Also in <town>, bids not read yet': the roster's unread elevators in
    this town that are not already a board on the page. '' when there are none."""
    def key(n):         # a name that is all town and trade words ("Garden City Co-op") keeps its town
        return op_key(n, t["name"]) or op_key(n)
    ops = {key(b["operator"]) for b in t["boards"].values()} - {""}
    ks = [e for e in known if key(e["name"]) not in ops]
    if not ks:
        return ""
    lis = "".join(f'<li>{esc(e["name"])} <a href="{esc(listing_link(e, z))}" style="color:var(--gold);border:0;'
                  f'font-size:.85rem;white-space:nowrap">Is this your elevator? Post your bids free</a></li>'
                  for e in ks[:KNOWN_MAX])
    more = len(ks) - KNOWN_MAX
    more_html = (f'<li style="color:var(--text-muted)">and {more} more on the '
                 f'<a href="/elevators#coverage-map">coverage map</a></li>') if more > 0 else ""
    return (f'<h2>Also in {esc(t["name"])}, bids not read yet</h2>'
            f'<p class="cbt-sub">AGSIST knows these elevators are here but does not read their bids yet, so no '
            f'price is shown for them.</p><ul class="cbt-list">{lis}{more_html}</ul>')


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


def place_fallbacks(merged, srcs, towns_by_state, zip_towns=None, zip_coord=None, fit=None):
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
        tname = town_of(b, src, towns_by_state, fit)
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
    Pana, IL 62557" for a ZIP placement, "8 mi from Pana" for a near one.
    The point is the board's branch name (branch_name()) when select() set one."""
    pt = bd["branch"] if "branch" in bd else bd["city"]
    if bd.get("how") == "zip":
        return f"{pt}, {bd['town']}, {bd['state']} {bd['zip']}".lstrip(", ")
    if bd.get("how") == "near":
        mi = bd["near_mi"]
        dist = "under 1 mi" if mi < 1 else f"{mi:.0f} mi"
        return (f"{pt}, " if pt else "") + f"{dist} from {bd['town']}"
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


ODD_NEAR_MI = 50              # the live page's default search radius


def flag_odd(towns, summaries=None):
    """Mark r["odd"] on a row whose basis is far off the other elevators near
    it for the same futures contract: scripts/basis_method.py's outlier rule,
    one row at a time (BM.relative_outlier), each other board counted once at
    the median of its own rows. The others are the boards within ODD_NEAR_MI
    of this one (the live page compares the elevators in its search, 50 mi by
    default); fewer than BM.OUTLIER_MIN_OTHERS there, the other boards in the
    state; fewer still, the state page's median for that contract. A basis
    past the state pages' SANITY cap is odd too. An odd row still prints,
    flagged "call before you haul"; it never sets a town's top bid, the share
    text, the answer, a hold line or the nearby list.
    Nutrition Service Co., Riceville IA, soybeans +$1.40 vs -$0.63 (2026-10-15)
    headlined six town pages and the Iowa share card before this."""
    vals = defaultdict(lambda: defaultdict(list))        # (crop, contract) -> place -> [basis]
    where = {}
    allrows = []
    for t in towns.values():
        for bd in t["boards"].values():
            where[bd["place"]] = (t["state"], bd.get("pin"))
            for r in bd["rows"]:
                allrows.append((t["state"], bd["place"], r))
                if r["contract"] and r["basis"] is not None:
                    vals[(r["crop"], r["contract"])][bd["place"]].append(r["basis"])
    per = {c: {p: statistics.median(v) for p, v in d.items()} for c, d in vals.items()}
    smed = {}
    for st, gs in (summaries or {}).items():
        for g in gs.values():
            for c in g.get("contracts") or []:
                if "median" in c:
                    smed[(st, c["contract"])] = c["median"]
    memo, n = {}, 0
    for st, place, r in allrows:
        r["odd"] = None
        if r["basis"] is None:
            continue
        cap = BM.SANITY.get(r["crop"])
        if cap is not None and abs(r["basis"]) > cap:
            r["odd"] = {"median": None, "dist": None, "n": 0, "via": "sanity"}
            n += 1
            continue
        if not r["contract"]:
            continue
        ck = (r["crop"], r["contract"])      # milo is never measured against corn on the same ZC month
        key = (place, ck)
        if key not in memo:
            pin = where[place][1]
            pool = per.get(ck, {})
            near = [v for p, v in pool.items() if p != place and pin and where[p][1]
                    and miles(pin[0], pin[1], where[p][1][0], where[p][1][1]) <= ODD_NEAR_MI]
            if len(near) < BM.OUTLIER_MIN_OTHERS:
                near = [v for p, v in pool.items() if p != place and where[p][0] == st]
            memo[key] = near
        sm = smed.get((st, r["contract"])) if r["crop"] in ("corn", "soybeans", "wheat") else None
        r["odd"] = BM.relative_outlier(r["basis"], memo[key], sm)
        n += bool(r["odd"])
    return n


def odd_note(r):
    """The words under an odd row's basis."""
    o = r.get("odd")
    if not o:
        return ""
    if o["via"] == "sanity":
        return "Unusual basis. Call before you haul."
    where = ("the state middle" if o["via"] == "state" else
             f"the middle of {o['n']} other elevators nearby for the same futures month")
    return (f"Unusual basis, {abs(o['dist']) * 100:.0f}&cent; {'over' if o['dist'] > 0 else 'under'} {where} "
            f"({money_basis(o['median'])}). Call before you haul.")


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
    .cbt-sub a,.cbt-note a{text-decoration:underline;text-underline-offset:2px;text-decoration-thickness:1px}
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
    .cbt-t tr.cbt-odd td{color:#b07a10;font-size:.8rem;padding-top:0;line-height:1.4}
    .cbt-hold{font-size:.85rem;color:var(--text-muted);margin:6px 0 0;line-height:1.5}
    .cbt-top{background:var(--surface);border:1px solid var(--border);border-left:3px solid var(--gold);border-radius:8px;padding:10px 14px;margin:12px 0;font-size:.92rem;line-height:1.55;color:var(--text)}
    .cbt-top p{margin:0 0 4px}.cbt-top p:last-child{margin:0}.cbt-top a{color:var(--gold)}
    .cbt-nl{list-style:none;margin:6px 0 0;padding:0}
    .cbt-nl li{padding:9px 0;border-bottom:1px solid var(--border);font-size:.9rem;line-height:1.5;color:var(--text)}
    .cbt-nl li a{color:var(--text);text-decoration:none;border-bottom:1px dotted var(--border)}
    .cbt-nl li a:hover{color:var(--gold)}
    .cbt-nl .np{font-family:'JetBrains Mono',monospace;font-size:.86rem}
    .cbt-nl .cbt-mut{white-space:nowrap}
    .cbt-answer{font-size:1.05rem;line-height:1.5;color:var(--text);margin:6px 0 4px}
    .cbt-cmp{font-size:.88rem;line-height:1.55;color:var(--text-muted);margin:-4px 0 12px}
    .cbt-cmp a{color:var(--gold);white-space:nowrap}
    .cbt-faq h3{margin:14px 0 2px}.cbt-faq p{margin:0;font-size:.92rem;line-height:1.6;color:var(--text-muted)}
    .cbt-hist{background:var(--surface);border:1px solid var(--border);border-radius:10px;margin:14px 0}
    .cbt-hist summary{cursor:pointer;padding:12px 14px;font-weight:700;color:var(--text);min-height:44px;box-sizing:border-box}
    .cbt-hist-body{padding:0 14px 12px}
"""


def share_tags(h):
    """One share image for the whole set (img/og/cash-bids.jpg, drawn by
    build_share_images.py), with an alt that repeats the page's og:title.
    Idempotent, so it also brings an already-built page up to date."""
    h = h.replace("/img/og/agsist.jpg", "/img/og/cash-bids.jpg")
    if 'property="og:image:alt"' not in h:
        m = re.search(r'<meta property="og:title" content="([^"]*)">', h)
        tag = '  <meta property="og:image:height" content="630">\n'
        if m and tag in h:
            h = h.replace(tag, tag + f'  <meta property="og:image:alt" content="{m.group(1)}">\n', 1)
    return h


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
    return share_tags(h)


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
    # the zone named in the file: Wray, CO and Delphos, OH read a Central clock with no label (sets pass, 2026-10-18)
    return f'<time class="asof" data-asof="bids" datetime="{iso}">Updated {fmt_share_time(t)} CT</time>'


def top_nearby(rows):
    """{crop: (highest cash, its posted time)} over the rows shown, for each
    crop's nearest delivery month present. Only numbers that print on the
    page; on a tie the newer posting."""
    out = {}
    for c in CROPS:
        rs = [r for r in rows if r["crop"] == c and r.get("dm") and not r.get("odd") and not restricted(r)]
        if rs:
            m = min(r["dm"] for r in rs)
            best = max((r for r in rs if r["dm"] == m), key=lambda r: (r["cash"], r["priced"]))
            out[c] = (best["cash"], best["priced"])
    return out


def share_prices(tops, n=3):
    """-> ("corn $4.38, soybeans $9.87", the oldest posted time among them),
    from top_nearby(), at most n crops."""
    cs = [c for c in CROPS if c in tops][:n]
    if not cs:
        return "", None
    return (", ".join(f"{CROP_LABEL[c].lower()} {cash_c(tops[c][0])}" for c in cs),
            min(tops[c][1] for c in cs))


def breadcrumb(items):
    return {"@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": i + 1, "name": n, "item": u} for i, (n, u) in enumerate(items)]}


# 2026-10-11: no house ask in the footer's sponsor slot any more. An unsold
# slot shows nothing (components/loader.js keeps the strip hidden), so town
# pages no longer load components/cb-house.js.


# The bid email box (components/cb-signup.js): one shared file, loaded once
# per town page; the page carries only the placeholder tag. Bump ?v= on any
# change to either file.
SIGNUP_CSS = '  <link rel="stylesheet" href="/components/cb-signup.css?v=2">\n'
SIGNUP_JS = '<script src="/components/cb-signup.js?v=2" defer></script>\n'


# Rain Print, one quiet line on each town page in the gift season (Sig, 2026-10-16:
# cross-promotion, at most one a page, after the main content). The page
# carries the line only from Nov 1 to Dec 24 of the snapshot's Central date;
# components/rain-print-promo.js then shows it only while data/rain-print.json
# has promote on and today is inside promote_from..promote_until. Nothing
# else promotes on these pages.
RP_PROMO_SEASON = ((11, 1), (12, 24))
RP_PROMO_JS = '<script src="/components/rain-print-promo.js?v=4" defer></script>\n'


def rain_print_line(snap_ct):
    """The empty, hidden gift-line slot for a town page, or '' out of season."""
    md = (snap_ct.month, snap_ct.day)
    if not (RP_PROMO_SEASON[0] <= md <= RP_PROMO_SEASON[1]):
        return ""
    return '<p class="rp-promo" data-rain-print-promo hidden></p>'


def page_end(ftr, table=False, signup=False, hist=False, promo=False):
    return f"""</main>
{ftr}
<script src="/components/loader.js?v=19" defer></script>
<script src="/components/asof.js?v=1" defer></script>
{TABLE_JS if table else ''}{SIGNUP_JS if signup else ''}{HIST_JS if hist else ''}{RP_PROMO_JS if promo else ''}</body>
</html>
"""


def town_zips(zip_towns):
    """{(ST, normalised town name): [ZIPs]} from geocodes/zip-towns.json, the
    same table known_towns() reads."""
    out = defaultdict(list)
    for zc, v in ((zip_towns or {}).get("zips") or {}).items():
        if isinstance(v, list) and len(v) == 2 and re.fullmatch(r"\d{5}", str(zc)):
            out[(v[1], town_key(v[0]))].append(str(zc))
    return {k: sorted(v) for k, v in out.items()}


def box_zip(t, z, ctx):
    """The ZIP the bid email box sends: the page's own (its boards'), else one
    of the town's own ZIPs from the ZIP table. With pins and centroids, the one
    whose centre is nearest the town's elevators, and only within ZIP_PIN_MI of
    them; without, the lowest. "" when the town has none: no box is drawn."""
    if z:
        return z
    cands = (ctx.get("town_zips") or {}).get((t["state"], town_key(t["name"]))) or []
    if not cands:
        return ""
    zc = ctx.get("zip_coord")
    pins = [bd["pin"] for bd in t["boards"].values() if bd.get("pin")]
    if zc and pins:
        lat, lon = sum(p[0] for p in pins) / len(pins), sum(p[1] for p in pins) / len(pins)
        best = min(((miles(lat, lon, c[0], c[1]), x) for x in cands for c in [zc(x)] if c), default=None)
        return best[1] if best and best[0] <= ZIP_PIN_MI else ""
    return cands[0]


def signup_box(t, z, ssl, crops, tops):
    """The placeholder components/cb-signup.js draws into: "Every morning: the
    top corn and soybean bids within 50 mi of <town>" (AGSIST Daily with this
    ZIP) and "Tell me when <crop> within 25 mi pays $__" (the ZIP price
    alert). Only with a ZIP: both read one. data-top is the page's own top
    nearest-delivery cash per crop, used as the price field's placeholder."""
    if not z:
        return ""
    cs = " ".join(c for c in CROPS if c in crops)
    top = " ".join(f"{c}:{tops[c][0]:.2f}" for c in CROPS if c in tops)
    return (f'<div id="bid-email" data-bid-alerts data-place="{esc(t["name"])}" data-zip="{z}" '
            f'data-source="town:{ssl}/{t["slug"]}"' + (f' data-crops="{cs}"' if cs else "")
            + (f' data-top="{top}"' if top else "") + '></div>')


def hold_lines(bd):
    """One "Hold to Jan? ..." line per crop from this elevator's own posted
    later bids: scripts/storesell.py (the twin of components/storesell.js, so the
    town page, /store-or-sell and the homepage say the same thing), with the
    stated default storage, interest and shrink. All of the board's current rows
    count, not only the ones the table shows. Within a crop the commodity name
    the board posts most is used, so a #2 yellow and a non-GMO bid are never
    mixed. A crop with no later month in this crop year gets no line."""
    inputs = storesell.with_defaults({})
    out = []
    for c in CROPS:
        rs = [r for r in bd["rows"] if r["crop"] == c and not r.get("odd")]
        if not rs:
            continue
        com = Counter(r["commodity"].lower() for r in rs).most_common(1)[0][0]
        per = []
        for r in rs:
            if r["commodity"].lower() != com:
                continue
            m = re.fullmatch(r"\d{4}-\d{2}/(\d{4}-\d{2})", str(r["period"]))
            per.append({"start": r["dm"], "end": max(r["dm"], m.group(1)) if m else r["dm"], "cash": r["cash"]})
        model = storesell.build_periods(per, c)
        pk = storesell.pick_period(model, inputs) if model else None
        if not pk:
            continue
        to = storesell.MON[int(pk["key"][5:]) - 1]
        net = storesell.carry_net(model["spot"]["cash"], pk["carry"], pk["months"], inputs)["net"]
        out.append((c, storesell.hold_line(to, pk["carry"], pk["months"], model["spot"]["cash"], "posted", inputs),
                    pk["carry"] if net is None else net))
    return out


# ---------------------------------------------------------------- nearby elevators (2026-10-11)
# A town page used to end at its own elevators, and a town with no current bid
# was a dead end ("No current bid", then a link). Each town page now lists the
# nearest OTHER network elevators that have a current bid, from the same rows
# this build already gated (72 h, live board, delivery open, misreads out):
# nothing is read or shown that a town page of its own would not show.
NEARBY_MI = 40                # a town with bids: other elevators this close
NEARBY_MAX = 6
NEAREST_N = 5                 # a town with none: the nearest this many ...
NEAREST_MAX_MI = 100          # ... no farther than this


def board_glance(bd):
    """{crop: (cash, 'YYYY-MM', posted)} for one board: per crop, the commodity
    it posts most (a #2 yellow and a non-GMO bid are never mixed), its nearest
    delivery month, the highest cash there."""
    out = {}
    for c in CROPS:
        rs = [r for r in bd["rows"] if r["crop"] == c and not r.get("odd")]
        if not rs:
            continue
        com = Counter(r["commodity"].lower() for r in rs).most_common(1)[0][0]
        rs = [r for r in rs if r["commodity"].lower() == com]
        m = min(r["dm"] for r in rs)
        best = max((r for r in rs if r["dm"] == m), key=lambda r: (r["cash"], r["priced"]))
        out[c] = (best["cash"], m, best["priced"])
    return out


def live_board_list(towns):
    """Every board with a current bid and a map pin, once, for the nearby lists."""
    out = []
    for (st, slug), t in towns.items():
        for bd in t["boards"].values():
            if not bd["rows"] or not bd.get("pin"):
                continue
            g = board_glance(bd)
            if not g:
                continue
            out.append({"town_key": (st, slug), "pin": bd["pin"], "name": head_name(bd, with_town=False),
                        "town": t["name"], "state": st,
                        "path": f"/cash-bids/{url_slug(STATE_NAMES[st])}/{slug}", "glance": g,
                        "posted": max(v[2] for v in g.values())})
    out.sort(key=lambda b: (b["state"], b["town"], b["name"]))
    return out


def town_center(t, z, zip_coord):
    """(lat, lon, what it is): the town's ZIP centroid, else the middle of its
    own boards' pins, else None (no nearby list is drawn)."""
    c = zip_coord(z) if (zip_coord and z) else None
    if c:
        return c[0], c[1], f"the center of ZIP {z}"
    pins = [bd["pin"] for bd in t["boards"].values() if bd.get("pin")]
    if pins:
        return (sum(p[0] for p in pins) / len(pins), sum(p[1] for p in pins) / len(pins),
                f"the elevators in {t['name']}")
    return None


def _mon(dm, snap_ct):
    y, m = int(dm[:4]), int(dm[5:7])
    return MONTH_ABBR[m - 1] + ("" if y == snap_ct.year else f" &rsquo;{y % 100:02d}")


def nearby_pick(t, center, live_all, has_own):
    """[(miles, board)] of the nearest other elevators with a current bid: within
    NEARBY_MI for a town with bids of its own, else the nearest NEAREST_N within
    NEAREST_MAX_MI. [] when there is no center or none qualify."""
    if not center or not live_all:
        return []
    lat, lon, _ = center
    tk = (t["state"], t["slug"])
    cand = sorted(((miles(lat, lon, b["pin"][0], b["pin"][1]), b) for b in live_all if b["town_key"] != tk),
                  key=lambda x: (x[0], x[1]["name"]))
    if has_own:
        return [x for x in cand if x[0] <= NEARBY_MI][:NEARBY_MAX]
    return [x for x in cand if x[0] <= NEAREST_MAX_MI][:NEAREST_N]


def dist_text(d):
    return "under 1 mi" if d < 1 else f"{d:.0f} mi"


def nearby_section(t, center, live_all, snap_ct, has_own):
    """The nearest other elevators with a current bid, or "" when none qualify."""
    if not center or not live_all:
        return ""
    what = center[2]
    pick = nearby_pick(t, center, live_all, has_own)
    h2 = f"Other elevators within {NEARBY_MI} miles" if has_own else "Nearest elevators with a current bid"
    if not pick:
        if has_own:
            return ""
        return (f'<h2>{h2}</h2><p class="cbt-sub">No elevator the AGSIST network reads has a current bid within '
                f'{NEAREST_MAX_MI} miles of {esc(t["name"])}.</p>')
    lis = []
    for d, b in pick:
        g = b["glance"]
        cs = [c for c in ("corn", "soybeans") if c in g] or [c for c in CROPS if c in g][:1]
        prices = " &middot; ".join(f'{CROP_LABEL[c]} {cash_c(g[c][0])} <span class="mut">{_mon(g[c][1], snap_ct)}</span>'
                                   for c in cs)
        p = b["posted"].astimezone(CT)
        dist = dist_text(d)
        lis.append(f'<li><a href="{b["path"]}"><b>{esc(b["name"])}</b>, {esc(b["town"])}, {b["state"]}</a> '
                   f'<span class="cbt-mut">{dist} &middot; posted {MONTH_ABBR[p.month - 1]} {p.day}</span><br>'
                   f'<span class="np">{prices}</span></li>')
    return (f'<h2 id="nearby">{h2}</h2><ul class="cbt-nl">{"".join(lis)}</ul>'
            f'<p class="cbt-sub">Straight-line miles from {esc(what)}. Each price is that elevator&rsquo;s highest '
            f'posted cash for its nearest delivery month, posted in the last {FRESH_HOURS} hours. '
            f'Call to confirm before you haul.</p>')


def top_holds(held, ss):
    """The store-or-sell line worth reading first: per crop (corn and soybeans
    first, two at most), the elevator in town whose own later bid nets the most
    after the stated default costs. The same lines are on each card below."""
    best = {}
    for name, holds in held:
        for c, text, net in holds:
            if c not in best or net > best[c][2] + 1e-9:
                best[c] = (name, text, net)
    cs = [c for c in CROPS if c in best][:2]
    if not cs:
        return ""
    lines = "".join(f'<p><b>{esc(CROP_LABEL[c])}, {esc(best[c][0])}:</b> {esc(best[c][1])}</p>' for c in cs)
    return (f'<div class="cbt-top">{lines}<p class="cbt-mut">Default storage and interest; '
            f'<a href="{esc(ss)}">put in your own costs</a>.</p></div>')


def board_section(bd, snap_ct):
    rows, more = trim(bd["rows"])
    times = [r["priced"] for r in rows]
    lo, hi = min(times), max(times)
    posted = fmt_posted(hi, snap_ct)
    if (hi - lo).total_seconds() > 3600:
        posted = f"{fmt_posted(lo, snap_ct)} to {fmt_posted(hi, snap_ct)}"
    ph = tel(bd["phone"])
    pi = bd.get("portal")
    who = f" {esc(pi['contact'])}" if pi and pi.get("contact") else ""
    call = (f'<a href="tel:+1{ph}">call{who} to confirm ({ph[:3]}-{ph[3:6]}-{ph[6:]})</a>' if ph
            else f"call{who} to confirm")
    name = bd["operator"] or bd["city"]
    pt = bd["branch"] if "branch" in bd else bd["city"]
    loc = near_text(bd) or (pt if pt and pt.lower() != name.lower() else "")
    # the company's own page (scripts/build_company_pages.py), when it has one
    co = (f'<div class="loc"><a href="{esc(bd["company_path"])}">Every {esc(bd["company_short"])} location</a></div>'
          if bd.get("company_path") else "")
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
                bas += f'<br><span class="mut">vs {con_label(r["contract"])}</span>'
        trs.append(f'<tr><td>{crop}</td><td>{esc(r["label"])}</td><td class="n">{cash_c(r["cash"])}</td>'
                   f'<td class="n">{bas}</td></tr>')
        if r.get("odd"):
            trs.append(f'<tr class="cbt-odd"><td colspan="4">{odd_note(r)}</td></tr>')
    z = bd["zip"]
    live = f'/cash-bids?zip={z}' if z else "/cash-bids"
    more_html = (f'<p class="cbt-sub" style="margin:6px 0 0">{more} more bid{"s" if more != 1 else ""} for later '
                 f'delivery on the <a href="{esc(live)}">live page</a>.</p>' if more else "")
    holds = hold_lines(bd)
    more_html += "".join(f'<p class="cbt-hold">{esc(CROP_LABEL[c])}: {esc(t)}</p>' for c, t, _ in holds)
    return (f'<section class="cbt-el"><h2>{esc(name)}</h2>'
            + (f'<div class="loc">{esc(loc)}</div>' if loc else "") + co
            + portal_html(pi, snap_ct)
            + f'<p class="cbt-posted" title="Posted {esc(posted)}">{asof_time(lo)} &middot; {call}</p>'
            f'<div class="cbt-scroll"><table class="cbt-t"><thead><tr><th>Crop</th><th>Delivery</th>'
            f'<th class="n">Cash</th><th class="n">Basis</th></tr></thead><tbody>{"".join(trs)}</tbody></table></div>'
            f'{more_html}</section>'), rows, times, holds


WHY = {"stale_or_unconfirmed": "board not confirmed on the latest read",
       "board_not_live": "board not confirmed on the latest read",
       "price_older_than_cutoff": f"no price posted in the last {FRESH_HOURS} hours",
       "delivery_expired_or_undated": "only expired delivery periods posted",
       "implied_futures_disagrees": "posted figures did not check out",
       "delivery_year_did_not_check_out": "posted figures did not check out",
       "cash_outside_sanity_band": "posted figures did not check out"}


def quiet_line(bd):
    why = next((WHY[k] for k, _ in bd["why"].most_common() if k in WHY), "no current bid")
    seen = f", last read {fmt_day(bd['checked'])}" if bd["checked"] else ""
    name = bd["operator"] or bd["city"]
    where = near_text(bd)
    if where:
        name += f" ({where})"
    return f"<li>{esc(name)}: {esc(why)}{seen}</li>"


# ---------------------------------------------------------------- the answer first (2026-10-15)
# A town page used to open with the store-or-sell box; the price table sat
# below the fold on a phone. It now opens with one sentence that answers
# "what is grain paying here" from the same rows the table prints, then the
# table, then a line putting the basis beside the state's middle basis (the
# one method, scripts/basis_method.py, from this same snapshot), then the
# hold box. The same sentence is the meta description, so search shows the
# answer; it carries its posted date and is rewritten on every build.
ANSWER_CROPS = 2              # crops named in the answer sentence
DESC_MAX = 160
HIST_NOTE = (" The &ldquo;Basis since&rdquo; box reads AGSIST&rsquo;s daily basis log, which keeps the day each "
             "elevator&rsquo;s basis changed; until Oct 11, 2026 that log also drew on a licensed bid feed.")
HIST_JS = '<script src="/components/cb-basis-hist.js?v=2" defer></script>\n'


def head_name(bd, with_town=True):
    """The elevator as the answer, FAQ and structured data name it. When the
    board is a delivery point under the company's name ("Ingredion" posted by
    Linn Coop), the point and the town go with it: "Linn Coop Oil Company
    (Ingredion, Cedar Rapids)". Linn Coop's own board paid 27c less than its
    Ingredion bid on 2026-10-15; the bare company name sent a farmer to the
    wrong scale."""
    op = (bd.get("operator") or "").strip()
    city = bd["branch"] if "branch" in bd else bd.get("city")
    city = re.sub(r"(,\s*[A-Z]{2})+$", "", (city or "").strip().rstrip(", ")).strip()
    town = (bd.get("town") or "").strip()
    if not op:
        return city or (bd.get("city") or "").strip()
    def n(x):          # "Le Roy" = "Leroy", "Co-op" = "Coop", "Mt Vernon" = "Mount Vernon"
        x = re.sub(r"\b(mt|st|ft)\b\.?", lambda m: {"mt": "mount", "st": "saint", "ft": "fort"}[m.group(1)], x.lower())
        return re.sub(r"[^a-z0-9]", "", x)
    if not city or not town or n(city) in n(op) or n(op) in n(city) or n(city) == n(town):
        return op
    if bd.get("how") == "near" or not with_town or n(town) in n(city):
        return f"{op} ({city})"
    return f"{op} ({city}, {town})"


# A bid not every farmer can sell into: River Country Co-op's "HAR 26- contract
# and feed only", "New Crop 26- CONTRACT ONLY". The table prints it as posted;
# the answer and the share card never headline it.
RESTRICTED_RE = re.compile(r"\b(?:contracts?|feed(?:\s+usage)?|members?)(?:\s*(?:and|&|or|/|,)\s*"
                           r"(?:contracts?|feed(?:\s+usage)?|members?))*\s+only\b", re.I)
FAR_OPEN_MONTHS = 10          # the nearest open bid this much later than a restricted one is said so


def restricted(r):
    return bool(RESTRICTED_RE.search(f'{r.get("label") or ""} {r.get("commodity") or ""}'))


def _mi(dm):
    return int(dm[:4]) * 12 + int(dm[5:7]) - 1


def answer_picks(boards):
    """{crop: (row, elevator name)}: per elevator the commodity it posts most
    (a non-GMO premium is never the headline corn price), its nearest delivery
    month and the highest cash there; then across elevators the nearest month
    and the highest cash in it. On a tie the newer posting, then the name.
    A restricted bid (contract, feed or members only) is skipped; when that
    leaves the nearest open bid FAR_OPEN_MONTHS or more past it, the row comes
    back as a copy with "open_far": True so the answer says so."""
    out = {}
    for c in CROPS:
        cands = []
        closed = [r["dm"] for bd in boards for r in bd["rows"]
                  if r["crop"] == c and not r.get("odd") and restricted(r)]
        for bd in boards:
            rs = [r for r in bd["rows"] if r["crop"] == c and not r.get("odd") and not restricted(r)]
            if not rs:
                continue
            com = Counter(r["commodity"].lower() for r in rs).most_common(1)[0][0]
            rs = [r for r in rs if r["commodity"].lower() == com]
            m = min(r["dm"] for r in rs)
            best = max((r for r in rs if r["dm"] == m), key=lambda r: (r["cash"], r["priced"]))
            cands.append((best, head_name(bd)))
        if cands:
            m = min(r["dm"] for r, _ in cands)
            cands = sorted((x for x in cands if x[0]["dm"] == m), key=lambda x: x[1].lower())
            out[c] = max(cands, key=lambda x: (x[0]["cash"], x[0]["priced"]))
            if closed and _mi(m) - _mi(min(closed)) >= FAR_OPEN_MONTHS:
                out[c] = (dict(out[c][0], open_far=True), out[c][1])
    return out


def _basis_plain(r, vs=True):
    if r["basis"] is None:
        return ""
    b = pricefmt.basis(r["basis"] * 100)
    return b + (f" vs {con_label(r['contract'])}" if vs and r["contract"] else "")


def _posted_days(rows):
    ds = sorted({(r["priced"].astimezone(CT).month, r["priced"].astimezone(CT).day) for r in rows})
    a = f"{MONTH_ABBR[ds[0][0] - 1]} {ds[0][1]}"
    if len(ds) == 1:
        return a
    b = ds[-1]
    return f"{a} to {MONTH_ABBR[b[0] - 1] + ' ' if b[0] != ds[0][0] else ''}{b[1]}"


def _deliv_phrase(r, first):
    """The delivery the board itself prints in its Delivery column (r["label"]),
    not the month AGSIST files it under: an ADM board's "New crop 2026" row was
    filed as Oct and the answer said "for Oct delivery" over a table with no
    Oct row (accuracy pass, 2026-10-17)."""
    lab = re.sub(r"\s+", " ", str(r.get("label") or "")).strip()
    if not lab:
        return ""
    if lab.lower().startswith("by "):
        return " for delivery by " + lab[3:]
    return f" for {lab}" + (" delivery" if first else "")


def answer_sentence(picks, snap_ct, n=ANSWER_CROPS, basis=True):
    """"Nearest-delivery bid: corn $4.14 at CDR Farms LLC for Oct 2026 delivery
    (basis -65c) and soybeans $12.04 for New crop 2026 (basis -70c), posted
    Oct 14." The pick is the highest bid in the NEAREST delivery period
    (answer_picks), not the highest on the board, so it is called that. Every
    number and delivery label is one the table below prints."""
    cs = [c for c in CROPS if c in picks][:n]
    if not cs:
        return ""
    parts, prev = [], None
    for i, c in enumerate(cs):
        r, name = picks[c]
        if r.get("open_far"):
            p = f"{CROP_LABEL[c].lower()}: the nearest open bid is{_deliv_phrase(r, False)}, {cash_c(r['cash'])}"
        else:
            p = f"{CROP_LABEL[c].lower()} {cash_c(r['cash'])}"
        if name != prev:
            p += f" at {name}"
        if not r.get("open_far"):
            p += _deliv_phrase(r, i == 0)
        if basis and r["basis"] is not None:
            p += f" (basis {_basis_plain(r)})"
        parts.append(p)
        prev = name
    return (f"Nearest-delivery {'bids' if len(cs) > 1 else 'bid'}: " + " and ".join(parts)
            + f", posted {_posted_days([picks[c][0] for c in cs])}.")


def answer_and_desc(picks, snap_ct, place):
    """(sentence, meta description): the fullest sentence whose description
    fits DESC_MAX, the description being "<place> cash bids. <sentence> Call to
    confirm." -> ("", "") when no variant fits (the caller keeps its old text)."""
    town = place.rsplit(", ", 1)[0]

    def named(lvl):
        # 0 the full name; 1 without this page's own town ("Total Grain Marketing
        # (Fairgrange)"); 2 without the delivery point, for one crop only
        out = {}
        for c, (r, name) in picks.items():
            if lvl >= 1:
                name = re.sub(rf"(\([^()]*), {re.escape(town)}\)$", r"\1)", name)
            if lvl >= 2:
                name = re.sub(r"\s*\([^()]*\)$", "", name) or name
            out[c] = (r, name)
        return out
    for n, lvl, basis in ((ANSWER_CROPS, 0, True), (ANSWER_CROPS, 0, False), (ANSWER_CROPS, 1, True),
                          (ANSWER_CROPS, 1, False), (1, 0, True), (1, 0, False), (1, 1, True), (1, 1, False),
                          (1, 2, True), (1, 2, False)):
        pk = named(lvl) if lvl else picks
        cs = [c for c in CROPS if c in picks][:n]
        if len({pk[c][1] for c in cs}) < len({picks[c][1] for c in cs}):
            continue          # two elevators would read as one
        a = answer_sentence(pk, snap_ct, n, basis)
        if not a:
            return "", ""
        for d in (f"{place} cash bids. {a} Call to confirm.", f"{place} cash bids. {a}"):
            if len(d) <= DESC_MAX:
                return a, d
    return "", ""


ADJ = {"corn": "corn", "soybeans": "soybean", "wheat": "wheat", "sorghum": "sorghum", "oats": "oat"}


def state_compare(picks, summ, sname):
    """[{crop, line, faq}] putting this town's headline basis beside the state's
    middle basis for the same futures contract, corn and soybeans only. line is
    the sentence under the table, faq the shorter one the FAQ adds after its
    own basis sentence. Nothing is compared across contracts: a board quoting
    no month, or one the state has too few bids on, is said so."""
    out = []
    for c in ("corn", "soybeans"):
        g = (summ or {}).get(c)
        stats = [x for x in (g or {}).get("contracts", []) if "median" in x]
        if c not in picks or not stats or picks[c][0]["basis"] is None:
            continue
        r, name = picks[c]
        same = next((x for x in stats if r["contract"] and x["contract"] == r["contract"]), None)
        if same is None:
            head = stats[0]
            mid = f"{pricefmt.basis(head['median'] * 100)} vs {contract_label(head['contract'])}, {head['n']} elevators"
            why = ("posts no futures month with its basis" if not r["contract"] else
                   f"quotes basis vs {contract_label(r['contract'])}, a month too few {sname} elevators use")
            out.append({"crop": c, "name": name, "why": why, "mid": mid,
                        "faq": f"It is not compared with the {sname} middle ({mid}): {name} {why}."})
            continue
        d = round((r["basis"] - same["median"]) * 400) / 4      # to the quarter cent boards post in
        rel = "even with" if abs(d) < 0.25 else (pricefmt.basis(abs(d)).lstrip("+") + (" stronger than" if d > 0 else " weaker than"))
        smid = f"{pricefmt.basis(same['median'] * 100)}, {same['n']} elevators"
        out.append({"crop": c, "line": f"{ADJ[c].capitalize()} basis at {name}, {_basis_plain(r)}, is {rel} the {sname} "
                                        f"middle ({smid}).",
                    "faq": f"That is {rel} the {sname} middle ({smid})."})
    # one sentence for the crops not compared for the same reason
    lines, done = [], set()
    for x in out:
        if "line" in x:
            lines.append(x["line"])
        elif (x["name"], x["why"]) not in done:
            grp = [y for y in out if "line" not in y and (y["name"], y["why"]) == (x["name"], x["why"])]
            done.add((x["name"], x["why"]))
            mids = "; ".join(f"{ADJ[y['crop']]} {y['mid']}" for y in grp)
            lines.append(f"{x['name']} {x['why']}, so it is not compared with the {sname} middle ({mids}).")
    return out, lines


def faq_pairs(t, picks, cmp_lines, near, center, snap_ct, latest=None):
    """Three questions answered from this page's own numbers, as plain text: the
    visible FAQ and the FAQPage JSON-LD are built from these same strings.
    latest: the newest posting on the page; when it is not from today (CT) the
    first question asks for the latest bid, not today's."""
    town, place = t["name"], f"{t['name']}, {t['state']}"
    cs = [c for c in CROPS if c in picks]
    if not cs:
        return []
    c = cs[0]
    crop = CROP_LABEL[c].lower()
    r, name = picks[c]
    qs = []
    a1 = (f"The nearest{' open' if r.get('open_far') else '-delivery'} {crop} bid we read in {place} is "
          f"{cash_c(r['cash'])} a bushel at {name}"
          f"{_deliv_phrase(r, True)}, posted {_posted_days([r])}. Call the elevator to confirm before you haul.")
    today = latest is None or latest.astimezone(CT).date() == snap_ct.date()
    qs.append((f"What is {crop} paying in {town} today?" if today else f"What is the latest {crop} bid in {town}?",
               a1))
    if r["basis"] is not None:
        a2 = f"{name} posts {crop} basis of {_basis_plain(r)}{_deliv_phrase(r, True)}."
        a2 += "".join(" " + x["faq"] for x in cmp_lines if x["crop"] == c)
    else:
        a2 = f"{name} does not post a basis with its {crop} bid, only the cash price."
    qs.append((f"What is the {ADJ[c]} basis in {town}?", a2))
    if near:
        d, b = near[0]
        g = b["glance"]
        pc = [x for x in ("corn", "soybeans") if x in g] or [x for x in CROPS if x in g][:1]
        prices = " and ".join(f"{CROP_LABEL[x].lower()} {cash_c(g[x][0])}" for x in pc)
        p = b["posted"].astimezone(CT)
        a3 = (f"The nearest other elevator with a current bid is {b['name']} in {b['town']}, {b['state']}, "
              f"{dist_text(d).replace('mi', 'miles')} straight-line from {center[2]}. It posted {prices} on "
              f"{MONTH_ABBR[p.month - 1]} {p.day}.")
    else:
        a3 = (f"No other elevator the AGSIST network reads has a current bid within {NEARBY_MI} miles of {town}. "
              f"The live page can search farther.")
    qs.append((f"How far is the next elevator from {town}?", a3))
    return qs


def faq_html(qs, town):
    if not qs:
        return ""
    return (f'<h2 id="faq">Questions about {esc(town)} bids</h2><div class="cbt-faq">'
            + "".join(f"<h3>{esc(q)}</h3><p>{esc(a)}</p>" for q, a in qs) + "</div>")


def faq_jsonld(qs):
    return {"@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in qs]}


FAC_TAIL = {"LLC", "LC", "INC", "INCORPORATED", "CO", "CORP", "CORPORATION", "LTD", "LIMITED", "LP", "LLP",
            "COMPANY", "COOP", "COOPERATIVE", "ASSN", "ASSOCIATION"}


def norm_fac(s):
    """Twin of normFac() in components/cb-basis-hist.js (and homepage-extras.js):
    "CDR FARMS, LLC" and "CDR Farms LLC" are one elevator."""
    t = re.sub(r"\bCO[\s.-]*OP\b", "COOP", str(s or "").upper().replace("&", " AND "))
    t = [x for x in re.sub(r"[^A-Z0-9]+", " ", t).strip().split(" ") if x]
    while len(t) > 1 and t[-1] in FAC_TAIL:
        t.pop()
    return "".join(t)


def norm_town(s):
    """Twin of normKey() in components/cb-basis-hist.js: "St. Ansgar" and
    "SAINT ANSGAR" are one town."""
    t = re.sub(r"^(ST|STE)\b\.?", lambda m: "SAINT" if m.group(1) == "ST" else "SAINTE", str(s or "").upper().strip())
    t = re.sub(r"^FT\b\.?", "FORT", t)
    return re.sub(r"[^A-Z0-9]", "", t)


MM = [m.upper() for m in MONTH_ABBR]
_HIST_MON = re.compile(r"\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\b")


def parse_dm(s, date):
    """Twin of parseDm() in components/cb-basis-hist.js: the basis log's
    delivery-month field -> 'YYYY-MM', or None when it names no month.
    date is the 'YYYY-MM-DD' it was logged, for a month written with no year."""
    t = re.sub(r"\([^)]*\)", " ", str(s or "").upper()).strip()
    m = re.match(r"^(\d{1,2})/\d{1,2}/(\d{4})\b", t)
    if m:
        mi = int(m.group(1)) - 1
        return f"{m.group(2)}-{mi + 1:02d}" if 0 <= mi < 12 else None
    m = re.fullmatch(r"([A-Z]{3})(\d{2})", t)
    if m and m.group(1) in MM:
        return f"20{m.group(2)}-{MM.index(m.group(1)) + 1:02d}"
    m = _HIST_MON.search(t)
    if not m:
        return None
    mi = MM.index(m.group(1))
    rest = t[m.end():]
    y = re.search(r"\b(20\d{2})\b", rest)
    if y:
        return f"{y.group(1)}-{mi + 1:02d}"
    y = re.search(r"(?:^|[\s'-])(\d{2})\b(?!\s*,)", rest)
    if y and not re.match(r"^\s*\d{1,2}\s*,", rest):
        return f"20{y.group(1)}-{mi + 1:02d}"
    yr, dmon = int(date[:4]), int(date[5:7]) - 1
    return f"{yr + (1 if mi < dmon - 2 else 0)}-{mi + 1:02d}"


def history_index(path):
    """{(norm_fac, norm_town): first logged date} for each elevator with at
    least one logged basis change in one state's data/basis-sparklines/<ST>.json;
    empty when it cannot be read. The date heads the box ("Basis since Aug 27";
    2026-10-17 audit N5: it said "since June" over a log that began Aug 27)."""
    try:
        with open(path, encoding="utf-8") as f:
            series = (json.load(f) or {}).get("series") or {}
    except (OSError, ValueError):
        return set()
    out = {}
    for k, pts in series.items():
        p = k.split("|")
        if len(p) >= 6 and p[3] in ("corn", "soybeans", "wheat") and pts and isinstance(pts[0], dict) \
                and parse_dm(p[5], str(pts[0].get("date") or "")) is not None:
            fk, d0 = (norm_fac(p[1]), norm_town(p[2])), str(pts[0].get("date") or "")
            if fk not in out or d0 < out[fk]:
                out[fk] = d0
    return out


def since_words(iso):
    """'2026-08-27' -> 'Aug 27'; '' when unparseable."""
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", str(iso or ""))
    if not m or not 1 <= int(m.group(2)) <= 12:
        return ""
    return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][int(m.group(2)) - 1] + " " + str(int(m.group(3)))


def history_box(t, boards, logged):
    """"Basis since June": a closed box naming this page's elevators that have
    a logged basis change (logged: history_index() of the state). Nothing of
    the history is in the page: components/cb-basis-hist.js fetches
    data/basis-sparklines/<ST>.json the first time the box is opened and draws
    each elevator's nearest-delivery basis from its logged changes. No box
    when none of them has one."""
    names, first = [], ""
    for bd in boards:
        n = bd["operator"] or bd["city"]
        cities = sorted({x for x in (bd["city"], t["name"]) if x})
        hits = [logged[(norm_fac(n), norm_town(c))] for c in cities if n and (norm_fac(n), norm_town(c)) in logged]
        if not hits:
            continue
        d0 = min(h for h in hits if h) if any(hits) else ""
        if d0 and (not first or d0 < first):
            first = d0
        if (n, cities) not in names:
            names.append((n, cities))
    if not names:
        return ""
    head = "Basis since " + since_words(first) if since_words(first) else "Basis log"
    data = json.dumps([[n, c] for n, c in names], separators=(",", ":"), ensure_ascii=False)
    return (f'<details class="cbt-hist" data-basis-hist="{t["state"]}" data-boards="{esc(data)}">'
            f'<summary>{head}</summary><div class="cbt-hist-body">'
            f'<p class="cbt-sub">Opens the basis log for these elevators.</p></div></details>')


def build_town_page(t, ctx):
    st, sname = t["state"], STATE_NAMES[t["state"]]
    ssl = url_slug(sname)
    snap_ct = ctx["snap_ct"]
    order = lambda b: (b["how"] == "near", b["near_mi"] or 0, b["operator"].lower(), b["city"].lower())  # noqa: E731
    live_b = sorted((b for b in t["boards"].values() if b["rows"]), key=order)
    quiet = sorted((b for b in t["boards"].values() if not b["rows"]), key=order)
    secs, times, crops, nrows, shown, any_hold, held_all = [], [], set(), 0, [], False, []
    held_first = False
    for i_bd, bd in enumerate(live_b):
        h, rows, ts, held = board_section(bd, snap_ct)
        if held and i_bd == 0:
            held_first = True
        any_hold = any_hold or bool(held)
        if held:
            held_all.append((head_name(bd), held))
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
        picks = answer_picks(live_b)
        answer, adesc = answer_and_desc(picks, snap_ct, place)
        if adesc:
            desc = adesc
        # the share card and the email box carry the answer's own prices:
        # top_nearby() over every shown row could name a bid the answer skips
        tops = {c: (r["cash"], r["priced"]) for c, (r, _) in picks.items()}
        txt, when = share_prices(tops)
        # every row here unusual (one specialty board): no price on the card
        share = (f"{place} cash bids",
                 (f"Top bids for nearest delivery: {txt} at {n} elevator{'s' if n != 1 else ''}. " if txt else
                  f"Bids from {n} elevator{'s' if n != 1 else ''}; call before you haul. ")
                 + f"Updated {fmt_share_time(when or latest)} CT.")
        n_in = n - n_near
        who = (f'<b>{n_in}</b> elevator{"s" if n_in != 1 else ""} in {esc(place)}' if n_in else "")
        if n_near:
            who += (" and " if n_in else "") + (f'<b>{n_near}</b> elevator{"s" if n_near != 1 else ""} within '
                                                f'{NEAR_MI} miles of {esc(t["name"])}')
        intro = (f'<p class="cbt-sub">Bids posted by {who}, read from each elevator&rsquo;s own bid board. '
                 f'Cash is $/bu. Each elevator shows when it posted; call before you haul.</p>')
    else:
        desc = (f"Cash grain bids in {place}: no current bid from the elevators the AGSIST network reads here. "
                f"The nearest elevators with a current bid are listed.")[:160]
        tops, share, picks, answer = {}, None, {}, ""
        intro = (f'<div class="cbt-note"><b>No current bid.</b> No elevator the AGSIST network reads in '
                 f'{esc(place)} has a bid we could confirm right now. The nearest ones that do are below.</div>')
    quiet_html = ""
    if quiet:
        quiet_html = (f'<h2>Also in {esc(t["name"])}, no current bid</h2><ul class="cbt-list">'
                      + "".join(quiet_line(b) for b in quiet) + "</ul>"
                      '<p class="cbt-sub">No price is shown for these until their board posts again.</p>')
    known_html = known_section(t, (ctx.get("known") or {}).get((st, t["slug"]), []), z)
    links = [f'<a href="/cash-bids/{ssl}/">Every {esc(sname)} town</a>',
             f'<a href="/cash-bids/{ssl}/#basis">{esc(sname)} basis today</a>']
    jsonld = {"@context": "https://schema.org", "@graph": [breadcrumb([
        ("AGSIST", f"{SITE}/"), ("Cash bids", f"{SITE}/cash-bids"),
        (sname, f"{SITE}/cash-bids/{ssl}/"), (t["name"], f"{SITE}{path}")])]}
    hows = {b["how"] for b in t["boards"].values()}
    near_note = ""
    if "zip" in hows:
        near_note += (f" An elevator whose board names a site rather than a town is listed here when its ZIP belongs to "
                      f"{esc(t['name'])}; its card shows the board&rsquo;s own name and the ZIP.")
    if "near" in hows:
        near_note += (f" An elevator with no town or ZIP we can confirm is listed here when it is within "
                      f"{NEAR_MI} miles of {esc(t['name'])}, measured from its map pin to the nearest elevator "
                      f"we list in {esc(t['name'])}; its card says how far.")
    hold_note = ""
    ss = "/store-or-sell" + (f"?zip={z}" if z else "")
    # the box sits right under the first card: when that card is the only one
    # with a hold line (every one-elevator town), it already says it once
    only_first = bool(live_b) and held_first and len(held_all) == 1
    top_html = "" if only_first else top_holds(held_all, ss)
    center = town_center(t, z, ctx.get("zip_coord"))
    near_html = nearby_section(t, center, ctx.get("live_all"), snap_ct, indexable)
    cmp_lines, cmp_text = state_compare(picks, (ctx.get("summaries") or {}).get(st), sname)
    cmp_html = ""
    if cmp_text:
        cmp_html = ('<p class="cbt-cmp">' + " ".join(esc(x) for x in cmp_text)
                    + f' <a href="/cash-bids/{ssl}/#basis">{esc(sname)} basis today</a></p>')
    qs = faq_pairs(t, picks, cmp_lines, nearby_pick(t, center, ctx.get("live_all"), True), center, snap_ct,
                   max(times)) if indexable else []
    hist_html = history_box(t, live_b, ctx["hist"](st)) if indexable and ctx.get("hist") else ""
    answer_html = f'<p class="cbt-answer">{esc(answer)}</p>' if answer else ""
    # the dated lead paragraph (scripts/stories_bids.py): stable facts only, never a price
    story_facts, story_html = None, ""
    if indexable:
        import stories_bids as SBX
        hm = re.search(r"Basis since ([A-Z][a-z]{2} \d{1,2})<", hist_html or "")
        story_facts = SBX.town_facts(t, live_b, crops, picks, cmp_lines, hm and hm.group(1), sname, NEAR_MI, CROPS, CROP_LABEL,
                                     snap_ct, near_text, head_name)
        story_html = SBX.TOWN.story_html((ctx.get("stories") or {}).get("town"), f"{st.lower()}/{t['slug']}", story_facts)
    if any_hold:
        hold_note = (" A &ldquo;Hold to&rdquo; line names the later month this elevator posts that comes out best once "
                     "storage and interest are taken off: its posted carry (that month&rsquo;s bid minus the nearest one), "
                     "net of " + esc(storesell.cost_note(storesell.with_defaults({}), None)[:-1]) +
                     f"; put in your own costs on <a href=\"{ss}\">Store or sell</a>.")
    if qs:
        jsonld["@graph"].append(faq_jsonld(qs))
    if indexable and times:
        # Night audit, Oct 19, 2026: 1,502 town pages carried no date or publisher in
        # their structured data. dateModified is the sitemap's lastmod (the newest bid
        # posted on the page, meta["latest"] below), never the build time, so it moves
        # only when the bids do and never churns 1,500 pages a run.
        jsonld["@graph"].append({"@type": "WebPage", "@id": f"{SITE}{path}", "url": f"{SITE}{path}", "name": title,
                                 "dateModified": lastmod_z(max(times)),
                                 "publisher": {"@type": "Organization", "@id": f"{SITE}/#org", "name": "AGSIST",
                                               "url": f"{SITE}/"}})
    hdr, ftr = ctx["chrome"]
    # The bid email box sits right under the first elevator's table (or under
    # the intro when no elevator here has a current bid), so a phone reaches it
    # without scrolling past every board. A town with no ZIP keeps the plain
    # Daily ask at the bottom: the box's two choices both need a ZIP.
    box = signup_box(t, box_zip(t, z, ctx), ssl, crops, tops)
    promo_html = rain_print_line(snap_ct)
    # one line under the title that jumps to it, when a table sits between
    first = next((c for c in CROPS if c in crops), "corn")
    jump = (f'<p class="cbt-jump"><a href="#bid-email" data-bid-alerts-jump>Email me {esc(t["name"])} bids each '
            f'morning, or when {CROP_LABEL[first].lower()} hits my price</a></p>') if box and secs else ""
    ask = "" if box else (
        "<!-- a reader already signed up never gets the ask: mark them before first paint (components/styles.css holds the space otherwise) -->\n"
        "  <script>try{if(/(^|;\\s*)agsist_subscribed=/.test(document.cookie)||localStorage.getItem('agsist_subscribed')==='1')"
        "document.documentElement.classList.add('sa-subbed')}catch(e){}</script>\n"
        f'  <div data-signup-ask="Get {esc(t["name"])} bids by email every morning" data-source="town:{ssl}/{t["slug"]}"></div>')
    body = f"""
<body>
{hdr}
<main class="cbt-wrap" id="main">
  <p class="cbt-sub" style="margin-top:14px"><a href="/cash-bids" style="color:var(--text-muted)">Cash bids</a> &rsaquo; <a href="/cash-bids/{ssl}/" style="color:var(--text-muted)">{esc(sname)}</a> &rsaquo; <b style="color:var(--text)">{esc(t['name'])}</b></p>
  <h1>Cash grain bids in {esc(place)} today</h1>
  {answer_html}
  {story_html}{intro}
  {'' if indexable else near_html}
  {jump}
  {''.join(secs[:1])}
  {cmp_html}
  {top_html}
  <a class="cbt-live" href="{esc(live)}">Live bids near {esc(z or t['name'])} &rarr;</a>
  {box}
  {''.join(secs[1:])}
  {hist_html}
  {near_html if indexable else ''}
  {faq_html(qs, t['name'])}
  {promo_html}
  {ask}
  {quiet_html}
  {known_html}
  <div class="cbt-note"><b>Where these come from.</b> The AGSIST elevator network reads each elevator&rsquo;s
  posted bid board directly; no third-party bid feed is used for the bids on this page. A bid shows only if the board was
  read successfully in the last {SB.HELD_SKIP_HOURS} hours and did not fail on the latest pass, the price was posted in the last {FRESH_HOURS} hours, and its delivery period
  has not ended. This page is a snapshot and is rebuilt through the day; the <a href="{esc(live)}">live page</a>
  has the newest board and nearby elevators. Basis is cash minus the futures contract named under it.{near_note}{hold_note}{HIST_NOTE if hist_html else ''}</div>
  <p class="cbt-sub">{' &middot; '.join(links)}</p>
"""
    meta = {"state": st, "slug": t["slug"], "name": t["name"], "indexable": indexable, "path": path,
            "elevators": len(live_b), "quiet": len(quiet), "rows": nrows, "crops": crops,
            "latest": max(times) if times else None, "title": title, "desc": desc, "tops": tops,
            "share": share, "story_facts": story_facts}
    h = head(title, desc, path, jsonld, indexable, share)
    if box:
        sheet = '  <link rel="stylesheet" href="/components/asof.css?v=1">\n'
        assert sheet in h, "head() changed shape; update build_town_page()"
        h = h.replace(sheet, sheet + SIGNUP_CSS, 1)
    return h + body + page_end(ftr, signup=bool(box), hist=bool(hist_html), promo=bool(promo_html)), meta


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
TABLE_JS = ('<script src="/components/util.js?v=18" defer></script>\n'
            '<script src="/components/state-bids.js?v=2" defer></script>\n')


def state_basis_rows(merged, index):
    """The state-basis inputs, gated exactly as the basis pages always were:
    fresh network bids, misread boards flagged, one bid per elevator and crop
    group at its nearest open delivery."""
    rows = SB.fresh_rows(merged, index)
    SB.flag_futures_disagreement(rows)
    out = SB.nearby(rows)
    for r in out:        # printed words only; keys stay as the board gave them
        r["operator"] = display_name(r.get("operator"))
        if r.get("city"):
            r["city"] = clean_place(r["city"])
    return out


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


def dtext(r):
    """SB.delivery_text, with a DTN-style "10/01/2026" month start read as
    "Oct 2026" (the state page's best card printed the raw date)."""
    d = SB.delivery_text(r)
    m = re.fullmatch(r"(\d{2})/01/(\d{4})", d.strip())
    return f"{MONTH_ABBR[int(m.group(1)) - 1]} {m.group(2)}" if m and 1 <= int(m.group(1)) <= 12 else d


def odd_keys(towns):
    """The rows flag_odd() marked on the town pages, keyed as best_bids() sees
    a state row: (source, crop, period as the feed gave it, cash)."""
    return {(bd["source"], r["crop"], r.get("period_feed", r["period"]), round(r["cash"], 4))
            for t in towns.values() for bd in t["boards"].values() for r in bd["rows"] if r.get("odd")}


def best_bids(near, odd=frozenset()):
    """{crop: row} the highest cash among each crop's nearest delivery start
    in the state, for corn and soybeans (and a wheat class with no corn or
    soybeans at all). Suspect and outlier rows never qualify, nor a row its
    town page flags as unusual (odd: odd_keys()); Oct 18, 2026 two state cards
    headlined a bid the town page told farmers to call about first."""
    out = {}
    for g in BM.CROP_ORDER:
        rs = [r for r in near if r["group"] == g and not r.get("suspect") and not r.get("outlier")
              and (r["source"], r["crop"], str(r.get("period") or ""), round(r["cash"], 4)) not in odd]
        if not rs:
            continue
        first = min(r["start"] for r in rs)
        out[g] = max((r for r in rs if r["start"] == first), key=lambda r: (r["cash"], r["priced"]))
    return out


_DS_RE = re.compile(r"^\s*DS\s*-\s*(.*?)\s*$", re.I)
_DS_KEEP = {"ADM", "AGP", "CHS", "POET"}


def ds_name(city, feed_label=None):
    """A direct-ship code as the card prints it, or None when city is not one:
    "DS-Pine Lake" -> "direct ship, Pine Lake", "DS-ADM" -> "direct ship, ADM",
    "DS-PEN" or "DS-CRG-CR" (a code the feed does not spell out) -> "direct ship"."""
    m = _DS_RE.match(city or "")
    if not m:
        return None
    if feed_label and not _DS_RE.match(feed_label):      # the board's own label for it
        return f"direct ship, {SB.town_text(feed_label.strip())}"
    rest = m.group(1)
    if rest.upper() in _DS_KEEP:
        return f"direct ship, {rest.upper()}"
    if re.fullmatch(r"[A-Za-z]{4,}(?: [A-Za-z]+)*", rest):
        return f"direct ship, {SB.town_text(rest) if rest.isupper() else rest}"
    return "direct ship"


def best_where(r, town_paths, labels=None):
    """Where a best bid is, as its card prints it: (plain text, html). The
    state FAQ answer and the card read this one function."""
    tp = town_paths.get(r["source"])
    town = SB.town_text(r["city"])
    ds = ds_name(r["city"], (labels or {}).get(r["source"]))
    if ds:
        return ((f"{ds}, {tp[0]}" if tp else ds),
                (f'{esc(ds)}, <a href="{tp[1]}">{esc(tp[0])}</a>' if tp else esc(ds)))
    return town, (f'<a href="{tp[1]}">{esc(town)}</a>' if tp else esc(town))


def best_card_crops(bests):
    """Which crops get a best-bid card: corn and soybeans, else one wheat class."""
    return [g for g in ("corn", "soybeans") if g in bests] or [g for g in BM.CROP_ORDER[2:] if g in bests][:1]


def state_faq_pairs(sname, bests, summ, town_paths, labels, n_el, n_towns, snap_ct):
    """Three questions for a state page, answered from numbers already on it
    (night audit, Oct 19, 2026: the 31 state pages had no FAQ while every town
    page had one): the best-bid cards, the #basis headlines and the counts. The
    visible FAQ and the FAQPage JSON-LD are built from these same strings."""
    qs = []
    gs = best_card_crops(bests)
    if gs:
        parts = []
        for i, g in enumerate(gs):
            r = bests[g]
            where = best_where(r, town_paths, labels)[0]
            lab = ADJ.get(g, SB.CROP_LABEL[g].lower())
            d = dtext(r)
            d = ("by " + d[3:]) if d.startswith("By ") else d
            parts.append((f"The highest nearest-delivery {lab} bid we read in {sname} is " if i == 0 else
                           f"The highest {lab} bid is ") +
                         f"{cash_c(r['cash'])} a bushel at {r['operator']} ({where}) for delivery {d}, "
                         f"posted {fmt_day(r['priced'])}.")
        latest = max(bests[g]["priced"] for g in gs)
        today = latest.astimezone(CT).date() == snap_ct.date()
        crops_q = " and ".join(ADJ.get(g, SB.CROP_LABEL[g].lower()) for g in gs)
        qs.append(((f"What are the best {crops_q} bids in {sname} today?" if today else
                    f"What are the latest best {crops_q} bids in {sname}?") if len(gs) > 1 else
                   (f"What is the best {crops_q} bid in {sname} today?" if today else
                    f"What is the latest best {crops_q} bid in {sname}?"),
                   " ".join(parts) + " Call the elevator to confirm before you haul."))
    bas, bg = [], []
    for g in ("corn", "soybeans"):
        c = ((summ or {}).get(g) or {}).get("contracts") or []
        if c and "median" in c[0]:
            h = c[0]
            bg.append(ADJ[g])
            lead = (f"The middle {ADJ[g]} basis in {sname} is" if not bas else
                    f"For {SB.CROP_LABEL[g].lower()} it is")
            bas.append(f"{lead} {SB.plain_basis(h['median'])} vs {SB.contract_plain(h['contract'])}, across {h['n']} "
                       f"{_plural(h['n'], 'elevator')} (range {SB.plain_basis(h['lo'])} to {SB.plain_basis(h['hi'])}).")
    if bas:
        qs.append((f"What is the {' and '.join(bg)} basis in {sname}?",
                   " ".join(bas) + " Basis is cash minus futures; the middle is the median elevator, each counted once "
                                   "at its nearest delivery."))
    qs.append((f"How many {sname} elevators does AGSIST read?",
               f"AGSIST has a current bid from {n_el} {sname} {_plural(n_el, 'elevator')} across {n_towns} "
               f"{_plural(n_towns, 'town')}, read from each elevator's own bid board. This is the network's sample, not "
               f"every elevator in {sname}; the live cash bids page finds the ones nearest your ZIP."))
    return qs


def best_card(g, r, town_paths, labels=None):
    where = best_where(r, town_paths, labels)[1]
    bas = (f'basis {money_basis(r["basis"])} vs {contract_label(r["contract"])}' if r["contract"]
           else f'basis {money_basis(r["basis"])}, futures month not named')
    return (f'<div class="cbt-stat"><div class="v">{cash_c(r["cash"])}</div>'
            f'<div class="l">Top {SB.CROP_LABEL[g].lower()} bid, nearest delivery ({esc(dtext(r))})</div>'
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
                # the exchange named, as the headline names it: Montana's MW and MWO spring wheat are both "Dec '26"
                # and read as the same month kept apart from itself (sets pass, 2026-10-18)
                ex_ = SB.EXCHANGE.get(c["contract"][0], "")
                notes.append(f"{SB.CROP_LABEL[g]} vs {contract_label(c['contract'])}{(' ' + ex_) if ex_ else ''}: middle {money_basis(c['median'])}, "
                             f"n = {c['n']}. Kept apart: a basis against one futures contract does not compare with another.")
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
                   f'<td>{esc(dtext(r))}</td><td class="n">{cash_c(r["cash"])}</td>'
                   f'<td class="n">{money_basis(r["basis"])}{con}</td></tr>')
    n = len([r for r in rs if r["start"] == first])
    ym_ = f"{MONTH_ABBR[int(first[5:7]) - 1]} {first[:4]}"
    return (f'<h3>{SB.CROP_LABEL[g]}: top {len(top)} of {n} bids at the nearest delivery, starting {ym_}</h3>'
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
                     dtext(r), r.get("wow"), r["priced"].strftime("%Y-%m-%dT%H:%M:%SZ"), flag])
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
                 f"town{'s' if len(live) != 1 else ''}. " + (f"Top bid for nearest delivery: {top_txt}. " if top_txt else "")
                 + f"Updated {fmt_share_time(when or max(m['latest'] for m in live))} CT.")
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
                       f'{NEAR_MI} miles of a town listed here. Their bids are on the live '
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
    bests = best_bids(near, ctx.get("odd") or frozenset())
    best_html = ""
    lab = ctx.get("labels") or {}
    cards = [best_card(g, bests[g], town_paths, lab) for g in best_card_crops(bests)]
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
    qs = (state_faq_pairs(sname, bests, summ, town_paths, lab, n_el, len(live), ctx["snap_ct"])
          if indexable else [])
    if qs:
        jsonld["@graph"].append(faq_jsonld(qs))
    pg = ctx.get("prev_generated")
    wow_note = (f" Change in a week compares each bid with the same elevator&rsquo;s same delivery and futures month "
                f"in the network snapshot of {fmt_day(pg)}." if pg else
                " No change in a week is shown: no network snapshot from about seven days back was available to this "
                "build.")
    body = f"""
<body>
{hdr}
<main class="cbt-wrap" id="main">
  <p class="cbt-sub" style="margin-top:14px"><a href="/cash-bids" style="color:var(--text-muted)">Cash bids</a> &rsaquo; <b style="color:var(--text)">{esc(sname)}</b></p>
  <h1>{esc(sname)} cash grain bids and basis today</h1>
  <p class="cbt-sub">Bids and basis from elevators in the AGSIST network, read directly from each
  elevator&rsquo;s own bid board. This is the network&rsquo;s sample, not every elevator in {esc(sname)}; the
  <a href="/cash-bids">live cash bids page</a> finds the ones nearest your ZIP.</p>
  {best_html}
  {basis_section(st, summ, pg)}
  {el_html}
  {faq_html(qs, sname)}
  <h2 id="towns">{len(live)} town{'s' if len(live) != 1 else ''} with a current bid</h2>
  {lst}
  {quiet_html}
  <div class="cbt-note"><b>How these numbers are made.</b> Source: the AGSIST elevator network (dnilgis/bids),
  boards read directly; no third-party bid feed is used on this page. A bid counts only if its board was read
  successfully in the last {SB.HELD_SKIP_HOURS} hours and did not fail on the latest pass, and its price was posted within {FRESH_HOURS} hours, long enough that a board unchanged
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


STATES_HUB = "states.html"   # /cash-bids/states: never index.html (that would capture /cash-bids)


def build_states_hub(smetas, ctx):
    """/cash-bids/states (2026-10-18 menu, "Bids by state"): every state with a
    network board, with the towns and elevators that have a current bid, from
    the same state_counts() numbers the state pages print. A state with no
    current bid is listed apart, never with a zero passed off as a price."""
    path = "/cash-bids/states"
    live = sorted((m for m in smetas if m["indexable"]), key=lambda m: STATE_NAMES[m["state"]])
    quiet = sorted((m for m in smetas if not m["indexable"]), key=lambda m: STATE_NAMES[m["state"]])
    n_el = sum(m["elevators"] for m in live)
    n_tw = sum(m["towns"] for m in live)
    title = "Cash Grain Bids by State | AGSIST"
    desc = (f"Cash grain bids by state: {n_el} elevators with a current bid in {n_tw} towns across "
            f"{len(live)} states, read from each elevator's own bid board.")[:160]
    latest = max((m["latest"] for m in live if m["latest"]), default=None)

    def li(m):
        sname = STATE_NAMES[m["state"]]
        return (f'<li><a href="{m["path"]}">{esc(sname)}</a> <span class="cbt-mut">&middot; '
                f'{m["elevators"]} elevator{"s" if m["elevators"] != 1 else ""} in {m["towns"]} '
                f'town{"s" if m["towns"] != 1 else ""}</span></li>')
    lst = (f'<ul class="cbt-list">{"".join(li(m) for m in live)}</ul>' if live else
           '<div class="cbt-note"><b>No current bid.</b> No elevator the AGSIST network reads has a bid we '
           'could confirm right now.</div>')
    quiet_html = ""
    if quiet:
        quiet_html = ('<h2>States with no current bid</h2><p class="cbt-sub">The network reads a board here, but '
                      'none has a bid it could confirm right now.</p><p class="cbt-cloud">'
                      + " &middot; ".join(f'<a href="{m["path"]}">{esc(STATE_NAMES[m["state"]])}</a>' for m in quiet)
                      + "</p>")
    crumbs = breadcrumb([("AGSIST", f"{SITE}/"), ("Cash bids", f"{SITE}/cash-bids"), ("By state", f"{SITE}{path}")])
    items = [{"@type": "ListItem", "position": i + 1, "name": f"{STATE_NAMES[m['state']]} cash grain bids",
              "url": f"{SITE}{m['path']}"} for i, m in enumerate(live)]
    graph = [crumbs, {"@type": "ItemList", "@id": f"{SITE}{path}#states", "name": "Cash grain bids by state",
                      "numberOfItems": len(items), "itemListElement": items}]
    jsonld = {"@context": "https://schema.org", "@graph": graph}
    hdr, ftr = ctx["chrome"]
    stamp = f'<p class="cbt-sub">{asof_time(latest)}</p>' if latest else ""
    body = f"""
<body>
{hdr}
<main class="cbt-wrap" id="main">
  <p class="cbt-sub" style="margin-top:14px"><a href="/cash-bids" style="color:var(--text-muted)">Cash bids</a> &rsaquo; <b style="color:var(--text)">By state</b></p>
  <h1>Cash grain bids by state</h1>
  <p class="cbt-sub">Every state where the AGSIST network reads an elevator&rsquo;s own bid board, with how many
  elevators and towns have a current bid. This is the network&rsquo;s sample, not every elevator in a state; the
  <a href="/cash-bids">cash bids page</a> finds the ones nearest your ZIP.</p>
  {stamp}
  <h2 id="states">{len(live)} state{'s' if len(live) != 1 else ''} with a current bid</h2>
  {lst}
  {quiet_html}
  <div class="cbt-note"><b>How these counts are made.</b> An elevator counts when its board was read
  successfully in the last {SB.HELD_SKIP_HOURS} hours and it posted a price within {FRESH_HOURS} hours; a town
  counts when it has one. The same counts are on each state&rsquo;s page and in
  <a href="/data/{COUNTS_FILE}">data/{COUNTS_FILE}</a>. Call the elevator before you haul.</div>
  <p class="cbt-sub" style="margin-top:18px"><a href="/cash-bids">Cash bids by ZIP</a> &middot; <a href="/basis#by-state">Basis in every state, vs normal</a> &middot; <a href="/cash-bid-index">Cash Bid Index</a></p>
"""
    return head(title, desc, path, jsonld, bool(live)) + body + page_end(ftr), {
        "path": path, "indexable": bool(live), "latest": latest or ctx["snap_ct"]}


LIVE_PAGE = "cash-bids.html"
LIVE_SHARE_GENERIC = {
    "og:description": "Grain prices at local elevators near you: corn, soybean and wheat cash bids and basis by ZIP. "
                      "Free, and every bid shows when it was posted.",
    "twitter:description": "Grain prices at local elevators near you: corn, soybean and wheat cash bids and basis by ZIP. "
                           "Free, and every bid shows when it was posted."}


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
        # 2026-10-18: "grain prices at local elevators" (226 impressions, position 5, 2 clicks): its words
        # lead. scripts/check_number_consistency.py reads "current bids from N elevators across N towns".
        text = (f"Grain prices at local elevators near you: current bids from {n_el:,} "
                f"elevator{'s' if n_el != 1 else ''} across {n_tw:,} town{'s' if n_tw != 1 else ''}, by ZIP, free. "
                f"Updated {fmt_share_time(max(m['latest'] for m in live))} CT.")   # time zone named (2026-10-17 audit N11)
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


# ---------------------------------------------------------------- /cash-bids: who is covered
# 2026-10-17 search-terms check: company-name searches ("new coop cash bids" 1,633, "agtegra cash
# bids" 1,016, "new coop grain bids" 938, "ias cash grain bids" 468, "adm cash bids" 421, "alcivia
# cash bids" 401; Search Console + Bing) landed on /cash-bids and saw no company named on the first
# screen. These are the companies searched by name, in that order (IAS = Innovative Ag Services).
# Only a company with a page this run is named; Cargill posts no board we read and is never named.
SEARCHED_COMPANIES = ("new-cooperative", "agtegra", "adm", "alcivia", "innovative-ag-services",
                      "farmward-cooperative", "cooperative-producers", "frontier-ag", "nexus-cooperative",
                      "mercer-landmark")
CO_NAMED = 5
CO_LINE = re.compile(r"(<!--CO-LINE-->)(.*?)(<!--/CO-LINE-->)", re.S)
CO_FAQ = re.compile(r"(<!--CO-FAQ-->)(.*?)(<!--/CO-FAQ-->)", re.S)
CO_FAQ_Q = "Do you show my elevator’s bids?"


def coverage_line(companies):
    """The line under the /cash-bids heading: the companies searched by name that have a page,
    topped up by the most current locations, then how many more. -> html ('' with none)."""
    by = {m["slug"]: m for m in companies}
    named = [by[s] for s in SEARCHED_COMPANIES if s in by][:CO_NAMED]
    for m in sorted(companies, key=lambda m: (-m["live"], m["short"].lower())):
        if len(named) >= CO_NAMED:
            break
        if m not in named:
            named.append(m)
    if not named:
        return ""
    more = len(companies) - len(named)
    links = ", ".join(f'<a href="{esc(m["path"])}">{esc(m["short"])}</a>' for m in named)
    tail = (f" and {more:,} more elevator compan{'ies' if more != 1 else 'y'}" if more else "")
    return f'Bids from {links}{tail}. <a href="/cash-bids/company/">Bids by company &rarr;</a>'


def coverage_faq(companies, counts):
    """(html, text) answering "Do you show my elevator's bids?" from data/elevator-counts.json.
    Each count is printed only when the file has it; None when it has neither block."""
    b = (counts or {}).get("bids") or {}
    c = (counts or {}).get("coverage") or {}
    parts = []
    if c.get("read") and c.get("elevators"):
        parts.append(f"On its latest full pass the AGSIST network read {c['read']:,} bid boards, out of "
                     f"{c['elevators']:,} elevators it keeps track of.")
    if b.get("elevators") and b.get("towns"):
        parts.append(f"{b['elevators']:,} elevators in {b['towns']:,} towns have a current bid on these pages.")
    if not parts:
        return None
    from build_company_pages import COMPANY_MIN
    n = len(companies)
    co_t = (f" {n:,} companies with {COMPANY_MIN} or more locations have their own page, every location on one page."
            if n else "")
    lead = ("Maybe. AGSIST reads the bids elevators post online, so an elevator that does not post them is not here. ")
    end_t = (" Type your ZIP at the top of this page to see which ones post near you. If you run an elevator, List your elevator puts "
             "your bids on AGSIST free. If you farm and your elevator posts bids online but is missing, send its bid "
             "page to sig@farmers1st.com.")
    text = lead + " ".join(parts) + co_t + end_t
    co_h = (f' {n:,} companies with {COMPANY_MIN} or more locations have <a href="/cash-bids/company/">their own page</a>, every '
            f"location on one page." if n else "")
    html = (esc(lead) + esc(" ".join(parts)) + co_h +
            ' Type your ZIP at the top of this page to see which ones post near you. If you run an elevator, '
            '<a href="/list-your-elevator">List your elevator</a> puts your bids on AGSIST free. If you farm and your '
            'elevator posts bids online but is missing, send its bid page to '
            '<a href="mailto:sig@farmers1st.com?subject=Missing%20elevator">sig@farmers1st.com</a>.')
    return html, text


def stamp_live_coverage(path, companies, counts):
    """Bake the companies line and the "my elevator" FAQ (visible and JSON-LD) into /cash-bids.
    Markers missing: warned, nothing written. No company and no counts: the text already there
    stays (an old number is replaced only by a new one). -> True when the file changed."""
    if not os.path.exists(path):
        return False
    with open(path, encoding="utf-8") as f:
        html = f.read()
    out = html
    line = coverage_line(companies or [])
    if line:
        if CO_LINE.search(out):
            out = CO_LINE.sub(lambda m: m.group(1) + line + m.group(3), out, count=1)
        else:
            print(f"[cash-bid-pages] {path} has no CO-LINE markers; companies line not written")
    faq = coverage_faq(companies or [], counts)
    if faq:
        fh, ft = faq
        if CO_FAQ.search(out):
            out = CO_FAQ.sub(lambda m: m.group(1) + fh + m.group(3), out, count=1)
            mm = re.search(r'(<script type="application/ld\+json">)(.*?)(</script>)', out, re.S)
            try:
                doc = json.loads(mm.group(2)) if mm else None
            except ValueError:
                doc = None
            faqp = next((g for g in (doc or {}).get("@graph", []) if g.get("@type") == "FAQPage"), None)
            if faqp is not None:
                qs = [q for q in faqp["mainEntity"] if q.get("name") != CO_FAQ_Q]
                at = next((i + 1 for i, q in enumerate(qs) if q.get("name") == "Which elevators are covered?"), len(qs))
                qs.insert(at, {"@type": "Question", "name": CO_FAQ_Q, "acceptedAnswer": {"@type": "Answer", "text": ft}})
                faqp["mainEntity"] = qs
                out = out[:mm.start(2)] + json.dumps(doc, ensure_ascii=False) + out[mm.end(2):]
        else:
            print(f"[cash-bid-pages] {path} has no CO-FAQ markers; coverage answer not written")
    if out != html:
        with open(path, "w", encoding="utf-8") as f:
            f.write(out)
        return True
    return False


def lastmod_z(lm):
    """The sitemap's <lastmod> text for a page, and the town page's JSON-LD
    dateModified: one formatter, so the two never differ."""
    return lm.strftime('%Y-%m-%dT%H:%M:%SZ')


def write_sitemap(path, entries):
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for loc, lm in entries:
        out.append(f"  <url><loc>{esc(loc)}</loc><lastmod>{lastmod_z(lm)}</lastmod>"
                   f"<changefreq>hourly</changefreq><priority>0.6</priority></url>")
    out.append("</urlset>\n")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(out))


# ---------------------------------------------------------------- build
def _hist_lookup(hist_dir):
    memo = {}

    def get(st):
        if st not in memo:
            memo[st] = history_index(os.path.join(hist_dir, f"{st}.json"))
        return memo[st]
    return get


def cash_parent(rel, pre=OUT_DIR):
    """Where a dropped cash-bids page points: a town at its state page, a company at the company
    list, a state at the states list; the hub /cash-bids last."""
    parts = rel.split("/")
    hub = [("/" + pre, "cash bids")]
    if len(parts) == 3 and parts[1] == "company":
        return [(f"/{pre}/company/", "elevator companies")] + hub
    if len(parts) == 3 and parts[2] != "index.html":
        return [(f"/{pre}/{parts[1]}/", PP.label(parts[1]))] + hub
    return [(f"/{pre}/states", "cash bids by state")] + hub


def build_all(merged, index, zip_towns, out_dir=OUT_DIR, root=".", sitemap=None, now=None, check_age=True,
              min_towns=10000, zip_coord=None, prev_doc=None, data_dir=None, hub=None, directory=None, hist_dir=None,
              companies_out=None):
    """data_dir: where data/state-basis/<ST>.json and data/basis-states.json
    go (None = not written). hub: /basis page to bake the state ranking into.
    directory: the bids network's data/directory.json, for the unread
    elevators on each town page (None = that section is left out).
    hist_dir: data/basis-sparklines, to know which elevators have a logged
    basis change for the "Basis since June" box (None = no box)."""
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
    placed, moved = {}, {}
    towns, drops, unplaced = select(merged, index, tbs, zip_towns, zip_coord, placed, moved)
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
    n_odd = flag_odd(towns, summaries)
    town_odd = odd_keys(towns)
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
           "counts": state_counts(towns, near), "zip_coord": zip_coord, "summaries": summaries,
           "hist": _hist_lookup(hist_dir) if hist_dir else None, "live_all": live_board_list(towns),
           "town_zips": town_zips(zip_towns), "known": known_by_town(directory, tbs) if directory else {},
           "odd": town_odd,
           "labels": {s_["id"]: s_["labelInFeed"] for s_ in index.get("sources") or []
                      if s_.get("id") and s_.get("labelInFeed")}}
    # one page per company with COMPANY_MIN or more boards in towns; each board
    # learns its page first, so its town page can link it
    import build_company_pages as CO
    import stories_core as SKX
    import stories_bids as SBX
    ctx["stories"] = {"town": SKX.load(SBX.TOWN, os.path.join(root, SBX.TOWN.STORE)),
                      "company": SKX.load(SBX.COMPANY, os.path.join(root, SBX.COMPANY.STORE))}
    companies = CO.group(towns, {s_["id"]: s_ for s_ in index.get("sources") or [] if s_.get("id")})
    for co in companies.values():
        for _, bd in co["locs"]:
            bd["company_path"], bd["company_short"] = co["path"], co["short"]
    before, before_real = set(), set()
    if os.path.isdir(out_dir):
        for dp, _, fs in os.walk(out_dir):
            for f in fs:
                if f.endswith(".html"):
                    rel = os.path.relpath(os.path.join(dp, f), out_dir)
                    before.add(rel)
                    if not PP.is_pointer(os.path.join(dp, f)):
                        before_real.add(rel)
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
    hub_page, hub_meta = build_states_hub(smetas, ctx)
    with open(os.path.join(tmp, STATES_HUB), "w", encoding="utf-8") as f:
        f.write(hub_page)
    ctx["towns"] = towns             # a company with no current bid lists elevators near it
    cmetas, cindex = CO.write_all(companies, ctx, tmp)
    if companies_out is not None:      # /cash-bids names them (stamp_live_coverage)
        companies_out.extend(cmetas)
    assert not os.path.exists(os.path.join(tmp, "index.html")), "cash-bids/index.html would capture /cash-bids"
    if os.environ.get("STORY_FACTS_OUT"):     # the facts each page states, for a stories batch (scripts/stories_bids.py)
        with open(os.environ["STORY_FACTS_OUT"], "w", encoding="utf-8") as f:
            json.dump({"town": {f"{m['state'].lower()}/{m['slug']}": m["story_facts"] for m in metas if m.get("story_facts")},
                       "company": {m["slug"]: m["story_facts"] for m in cmetas if m.get("story_facts")}},
                      f, ensure_ascii=False, separators=(",", ":"))
    # a town, state or company page this run did not write (no network board there now) stays as a
    # pointer to its parent page (scripts/pointer_pages.py), never a 404: carry the old file into the
    # new tree, swap, then turn it into a pointer (an old pointer keeps its date)
    built = set()
    for dp, _, fs in os.walk(tmp):
        built |= {os.path.relpath(os.path.join(dp, f), tmp) for f in fs if f.endswith(".html")}
    gone = sorted(before - built)
    for rel in gone:
        os.makedirs(os.path.dirname(os.path.join(tmp, rel)), exist_ok=True)
        shutil.copyfile(os.path.join(out_dir, rel), os.path.join(tmp, rel))
    shutil.rmtree(out_dir, ignore_errors=True)
    os.replace(tmp, out_dir)
    site_root = os.path.dirname(out_dir.rstrip("/")) or "."
    pre = os.path.basename(out_dir.rstrip("/"))
    # a page that was there only because a board's name named the wrong town points at the
    # town that board is in now ("Granger" on a Cresco ZIP: /cash-bids/iowa/granger -> cresco)
    st_of = {url_slug(STATE_NAMES[s_]): s_ for s_ in STATE_NAMES}
    built_towns = {(t["state"], t["slug"]) for t in towns.values()}

    def moved_to(r):
        parts = r.split("/")
        if len(parts) != 3 or parts[1] not in st_of or not parts[2].endswith(".html"):
            return None
        k = (st_of[parts[1]], parts[2][:-5])
        if k not in moved or k in built_towns:
            return None
        return moved[k]

    def target_for(r):
        mv = moved_to(r)
        lead = [(f"/{pre}/{r.split('/')[1]}/{url_slug(mv[0])}", mv[0])] if mv else []
        return lead + cash_parent(r, pre)

    def name_for(r):
        mv = moved_to(r)
        return ", ".join(x for x in (mv[1], mv[2]) if x) if mv else PP.label(r)
    _, orphans = PP.settle(site_root, OUT_DIR, [pre + "/" + r.replace(os.sep, "/") for r in gone],
                           target_for, name_for=name_for)
    for r in orphans:
        os.remove(os.path.join(site_root, r))
    after = set()
    for dp, _, fs in os.walk(out_dir):
        after |= {os.path.relpath(os.path.join(dp, f), out_dir) for f in fs
                  if f.endswith(".html") and not PP.is_pointer(os.path.join(dp, f))}
    new_urls = []
    for rel in sorted(after - before_real):
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
    entries = [(SITE + hub_meta["path"], hub_meta["latest"])] if hub_meta["indexable"] else []
    entries += [(SITE + m["path"], m["latest"]) for m in smetas if m["indexable"]]
    entries += [(SITE + m["path"], m["latest"]) for m in metas if m["indexable"]]
    if cindex["indexable"]:
        entries.append((SITE + cindex["path"], cindex["latest"] or gen))
    entries += [(SITE + m["path"], m["latest"]) for m in cmetas if m["indexable"]]
    if sitemap:
        write_sitemap(sitemap, entries)
    size = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(out_dir) for f in fs)
    n_idx = sum(1 for m in metas if m["indexable"])
    print(f"[cash-bid-pages] snapshot {merged.get('generated')} ({age_h:.1f} h old); drops {dict(drops)}; "
          f"{len(unplaced)} places not placed in a town (listed on the state index); {n_odd} unusual-basis rows flagged")
    if moved:
        print(f"[cash-bid-pages] {len(moved)} boards named for a town their ZIP or pin does not fit, placed by "
              f"ZIP or pin instead: " + ", ".join(f"{k[1]} {k[0]} -> {v[0]}" for k, v in sorted(moved.items())))
    print(f"[cash-bid-pages] places with no town in their name: {len(placed)}; placed by ZIP {how['zip']}, "
          f"within {NEAR_MI} mi of a town {how['near']}, not placed {how['none']}")
    print(f"[cash-bid-pages] {len(metas)} town pages ({n_idx} with a current bid, {len(metas) - n_idx} noindex), "
          f"{len(smetas)} state indexes, {sum(m['elevators'] for m in metas)} elevators, "
          f"{sum(m['rows'] for m in metas)} bid rows, {size / 1024:.0f} KB -> {out_dir}/; "
          f"{len(entries)} sitemap URLs; {len(new_urls)} new pages")
    if cmetas:
        big = max(cmetas, key=lambda m: m["kb"])
        print(f"[cash-bid-pages] {len(cmetas)} company pages ({sum(1 for m in cmetas if m['indexable'])} with a current "
              f"bid), {sum(m['kb'] for m in cmetas):.0f} KB in all, biggest {big['slug']} {big['kb']:.0f} KB "
              f"({big['locations']} locations)")
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
    # an outlier basis never headlines (Riceville IA soybeans +1.40, 2026-10-15)
    pt = parse_ts("2026-10-07T17:00:00Z")

    def _bd(i, basis, cash, lat=43.3, crop="soybeans", con=("ZS", 10, 2026)):
        return {"place": f"p{i}", "operator": f"Op {i}", "city": "", "pin": (lat, -92.5 + i * 0.05),
                "rows": [{"crop": crop, "commodity": "Soybeans", "dm": "2026-10", "period": "2026-10",
                          "cash": cash, "basis": basis, "contract": con, "priced": pt, "label": "Oct 2026"}]}
    tw = {("IA", "a"): {"state": "IA", "boards": {f"p{i}": _bd(i, b, c) for i, (b, c) in enumerate(
        [(-0.70, 11.93), (-0.68, 11.95), (-0.72, 11.91), (-0.75, 11.88), (1.40, 14.04)])}}}
    # milo on the corn month far under corn is not judged against corn
    tw[("IA", "a")]["boards"]["m"] = _bd(9, -1.50, 3.30, crop="sorghum", con=("ZC", 11, 2026))
    assert flag_odd(tw) == 1
    bds = list(tw[("IA", "a")]["boards"].values())
    assert bds[4]["rows"][0]["odd"]["via"] == "nearby" and bds[4]["rows"][0]["odd"]["dist"] == 2.11
    assert not bds[5]["rows"][0]["odd"], "milo judged against corn"
    pk = answer_picks(bds)
    assert pk["soybeans"][0]["cash"] == 11.95, pk
    assert top_nearby([r for b in bds for r in b["rows"]])["soybeans"][0] == 11.95
    assert "soybeans" not in board_glance(bds[4])
    assert "Unusual basis, 211&cent; over" in odd_note(bds[4]["rows"][0])
    # three others only: the state median stands in
    tw2 = {("IA", "b"): {"state": "IA", "boards": {f"q{i}": _bd(i, b, c) for i, (b, c) in enumerate(
        [(-0.70, 11.93), (-0.68, 11.95), (-0.72, 11.91), (1.40, 14.04)])}}}
    summ = {"IA": {"soybeans": {"contracts": [{"contract": ("ZS", 10, 2026), "median": -0.63, "n": 40}]}}}
    assert flag_odd(tw2) == 0 and flag_odd(tw2, summ) == 1
    assert share_prices({}) == ("", None)
    assert con_label(("KE", 11, 2026)) == "KC Dec '26" and con_label(("ZC", 11, 2026)) == "Dec '26"
    assert parse_contract("December 2026", "wheat", 2026, "Hard Red Winter Wheat") == ("KE", 11, 2026)
    assert cash_c(13.4275) == "$13.43" and cash_c(12.475) == "$12.48" and cash_c(4.2) == "$4.20" \
        and cash_c(4.2125) == "$4.21" and cash_c(4.205) == "$4.21", "town pages print to the cent"
    # the delivery point goes with the company's name (Cedar Rapids, 2026-10-15)
    lc = {"operator": "Linn Coop Oil Company", "city": "Ingredion", "town": "Cedar Rapids", "how": "zip"}
    assert head_name(lc) == "Linn Coop Oil Company (Ingredion, Cedar Rapids)"
    assert head_name(lc, with_town=False) == "Linn Coop Oil Company (Ingredion)"
    assert head_name({"operator": "Op", "city": "Hooper, NE", "town": "Hooper"}) == "Op"
    assert head_name({"operator": "Op", "city": "Dewar, IA, IA", "town": "Dewar"}) == "Op"
    assert head_name({"operator": "", "city": "Oran", "town": "Oran"}) == "Oran"
    assert head_name({"operator": "Nexus Cooperative", "city": "Leroy", "town": "Le Roy"}) == "Nexus Cooperative"
    assert head_name({"operator": "Osage Co-op Elevator", "city": "Osage Coop", "town": "Osage"}) == "Osage Co-op Elevator"
    assert head_name({"operator": "Mid-Iowa Cooperative", "city": "Cargill Cedar Rapids", "town": "Cedar Rapids"}) \
        == "Mid-Iowa Cooperative (Cargill Cedar Rapids)"
    merged, index = _fixture()
    # map pins for the nearby lists: Fremont and Hooper are about 13 mi apart, Iowa is far
    PINS = {"FREMONT": (41.433, -96.498), "Fremont": (41.433, -96.498), "Hooper": (41.611, -96.548),
            "Hooper, NE": (41.611, -96.548)}
    for b in merged["bids"]:
        if b["city"] in PINS:
            b["lat"], b["lon"] = PINS[b["city"]]
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
        # Op n0: Oct $3.90, Nov $3.91 (1 month): +1c, less 3.5c storage and 2.3c interest = -5c
        assert ('<p class="cbt-hold">Corn: Hold to Nov? +1¢ posted carry, net of storage and interest: '
                '−5¢ a bushel.</p>') in fr, re.findall(r'<p class="cbt-hold">.*?</p>', fr)
        assert fr.count('class="cbt-hold"') == 1, "only a board with a later month in this crop year gets a line"
        assert "storage at 3.5¢ a month (default), interest at 7% a year (default), no shrink (default); " in fr
        assert '<a href="/store-or-sell?zip=68025">Store or sell</a>' in fr
        assert "$3.95" in fr and "By Oct 9" in fr and "Nov 2026" in fr and "(2026-12)" not in fr
        assert '<link rel="canonical" href="https://agsist.com/cash-bids/nebraska/fremont">' in fr
        assert 'content="index,follow"' in fr and "call to confirm" in fr and "/cash-bids?zip=68025" in fr
        # the bid email box: the town's own ZIP and place, right under the first
        # elevator's table, its script and sheet once each, and no second ask below
        assert 'id="bid-email" data-bid-alerts data-place="Fremont" data-zip="68025" data-source="town:nebraska/fremont"' in fr, \
            "a town page asks for an email with its own ZIP"
        assert fr.index("</table>") < fr.index('id="bid-email"') < fr.index("Where these come from"), \
            "the bid email box sits under the first elevator's table"
        assert re.search(r'data-bid-alerts [^>]*data-top="corn:\d+\.\d\d', fr), "the price field's hint is the page's own top bid"
        assert fr.count('/components/cb-signup.js?v=') == 1 and fr.count('/components/cb-signup.css?v=') == 1
        assert "data-signup-ask=" not in fr, "one email ask per town page"
        assert fr.index('href="#bid-email" data-bid-alerts-jump>Email me Fremont bids each morning, or when corn hits my price') \
            < fr.index("<table"), "a line near the top jumps to the box"
        assert "cb-house" not in fr and "Sponsor this" not in fr and "ad-slot--open" not in fr, \
            "a town page shows nothing in an unsold sponsor slot: no house ask, no open slot"
        assert "Cash grain bids in Fremont, NE today" in fr
        assert "Op bad" not in fr or "did not check out" in fr
        # the link preview carries the page's own top nearby bids and their posted time
        assert '<meta property="og:title" content="Fremont, NE cash bids">' in fr
        assert '<meta name="twitter:title" content="Fremont, NE cash bids">' in fr
        share = re.search(r'<meta property="og:description" content="([^"]*)">', fr).group(1)
        assert share == re.search(r'<meta name="twitter:description" content="([^"]*)">', fr).group(1)
        assert share.startswith("Top bids for nearest delivery: corn $3.95, soybeans $9.85 at "), share
        assert share.endswith("Updated Oct 7, 12:00 pm CT."), share
        assert "<title>Cash Grain Bids in Fremont, NE Today | AGSIST</title>" in fr, "search title unchanged"
        # each board's posted time is the site's "Updated" stamp, re-rendered and aged by asof.js
        assert '<time class="asof" data-asof="bids" datetime="2026-10-07T17:00:00Z">Updated Oct 7, 12:00 pm CT</time>' in fr
        assert '/components/asof.js?v=1' in fr and '/components/asof.css?v=1' in fr
        for v in re.findall(r"\$(\d+\.\d\d)", share):
            assert f"${v}</td>" in fr, f"share price {v} is not on the page"
        # THE ANSWER FIRST (2026-10-15): one sentence from the table's own numbers,
        # the same sentence in the meta description, then the table, then the
        # state line, then the hold box
        # the delivery named is the label the board prints (accuracy pass 2026-10-17:
        # "for Oct delivery" stood over an ADM table whose rows read "New crop 2026"),
        # and the pick is the nearest delivery's best bid, so it is not called the top bid
        ans = ("Nearest-delivery bids: corn $3.95 at Op kept for delivery by Oct 9 (basis \u221225\u00a2 vs Dec &#x27;26) and "
               "soybeans $9.85 at Op n0 for Oct 2026 (basis \u221235\u00a2 vs Nov &#x27;26), posted Oct 7.")
        short = ("Nearest-delivery bids: corn $3.95 at Op kept for delivery by Oct 9 and soybeans $9.85 at Op n0 for Oct 2026, posted Oct 7.")
        a_html = re.search(r'<p class="cbt-answer">(.*?)</p>', fr).group(1)
        assert a_html in (ans, short), a_html
        assert "<td>By Oct 9</td><td class=\"n\">$3.95</td>" in fr and "<td>Oct 2026</td><td class=\"n\">$9.85</td>" in fr, \
            "each delivery the answer names is the table row its price sits on"
        nc = {"label": "New crop 2026", "dm": "2026-10"}
        assert _deliv_phrase(nc, True) == " for New crop 2026 delivery" and _deliv_phrase(nc, False) == " for New crop 2026"
        assert "Top bid" not in a_html
        dsc = re.search(r'<meta name="description" content="([^"]*)">', fr).group(1)
        assert dsc.startswith("Fremont, NE cash bids. ") and a_html in dsc and len(html_unescape(dsc)) <= DESC_MAX, dsc
        for v in re.findall(r"\$(\d+\.\d\d)", a_html):
            assert f"${v}</td>" in fr, f"answer price {v} is not in the table"
        assert fr.index('class="cbt-answer"') < fr.index("<table") < fr.index('class="cbt-cmp"') \
            < fr.index('<div class="cbt-top">'), "answer, table, state line, then the hold box"
        cmp_ = re.search(r'<p class="cbt-cmp">(.*?)</p>', fr).group(1)
        assert cmp_.startswith("Corn basis at Op kept, \u221225\u00a2 vs Dec &#x27;26, is 6\u00bd\u00a2 stronger than the "
                               "Nebraska middle (\u221231\u00bd\u00a2, 6 elevators)."), cmp_
        assert "Soybean basis" not in cmp_, "fewer than three soybean bids on Nov '26: no middle, no comparison"
        # three questions answered from the page's own numbers; the visible FAQ and
        # the FAQPage JSON-LD say the same words
        blks = [json.loads(b) for b in re.findall(r'<script type="application/ld\+json">(.*?)</script>', fr, re.S)]
        assert [sorted(g["@type"] for g in b["@graph"]) for b in blks] == [["BreadcrumbList", "FAQPage", "WebPage"]], blks
        # Oct 19, 2026: the town page's dateModified is its sitemap lastmod, never the build
        # time (now is 19:00Z, the newest bid posted 17:00Z), and the publisher is AGSIST
        # Oct 19, 2026: the state page answers three questions from its own cards and counts
        ne = open(os.path.join(out, "nebraska", "index.html")).read()
        nb = [json.loads(b) for b in re.findall(r'<script type="application/ld\+json">(.*?)</script>', ne, re.S)]
        nfaq = next(g for g in nb[0]["@graph"] if g["@type"] == "FAQPage")["mainEntity"]
        assert [q["name"] for q in nfaq] == ["What are the best corn and soybean bids in Nebraska today?",
                                            "What is the corn basis in Nebraska?",
                                            "How many Nebraska elevators does AGSIST read?"], [q["name"] for q in nfaq]
        nvis = re.search(r'<div class="cbt-faq">(.*?)</div>', ne).group(1)
        assert re.findall(r"<h3>(.*?)</h3><p>(.*?)</p>", nvis) == [(esc(q["name"]), esc(q["acceptedAnswer"]["text"]))
                                                                    for q in nfaq], "state FAQ and JSON-LD word for word"
        a1 = nfaq[0]["acceptedAnswer"]["text"]
        assert a1.startswith("The highest nearest-delivery corn bid we read in Nebraska is $3.95 a bushel at Op kept "
                             "(Fremont) for delivery by Oct 9, posted Oct 7, 2026. The highest soybean bid is $9.85"), a1
        assert '<div class="v">$3.95</div>' in ne and '<div class="v">$9.85</div>' in ne, "answer prices are the cards'"
        assert nfaq[1]["acceptedAnswer"]["text"].startswith(
            "The middle corn basis in Nebraska is \u221231\u00bd\u00a2 vs Dec '26, across 6 elevators (range "), nfaq[1]
        assert ne.index('class="cbt-faq"') > ne.index('id="basis"'), "FAQ after the basis block"
        wp = next(g for g in blks[0]["@graph"] if g["@type"] == "WebPage")
        sm_lm = re.search(r"<loc>https://agsist\.com/cash-bids/nebraska/fremont</loc><lastmod>([^<]+)</lastmod>",
                          open(sm).read()).group(1)
        assert wp["dateModified"] == sm_lm and wp["dateModified"] != "2026-10-07T19:00:00Z", (wp, sm_lm)
        assert wp["publisher"] == {"@type": "Organization", "@id": "https://agsist.com/#org", "name": "AGSIST",
                                   "url": "https://agsist.com/"}, wp
        assert wp["@id"] == wp["url"] == "https://agsist.com/cash-bids/nebraska/fremont"
        faq = next(g for g in blks[0]["@graph"] if g["@type"] == "FAQPage")["mainEntity"]
        assert [q["name"] for q in faq] == ["What is corn paying in Fremont today?", "What is the corn basis in Fremont?",
                                           "How far is the next elevator from Fremont?"]
        vis = re.search(r'<div class="cbt-faq">(.*?)</div>', fr).group(1)
        assert re.findall(r"<h3>(.*?)</h3><p>(.*?)</p>", vis) == [(esc(q["name"]), esc(q["acceptedAnswer"]["text"]))
                                                                   for q in faq], "FAQ and JSON-LD word for word"
        assert faq[0]["acceptedAnswer"]["text"].startswith("The nearest-delivery corn bid we read in Fremont, NE is $3.95 a bushel at Op kept for delivery by Oct 9")
        assert "That is 6\u00bd\u00a2 stronger than the Nebraska middle" in faq[1]["acceptedAnswer"]["text"]
        assert faq[2]["acceptedAnswer"]["text"] == ("The nearest other elevator with a current bid is Op st in Hooper, NE, "
                                                    "13 miles straight-line from the elevators in Fremont. It posted "
                                                    "soybeans $9.70 on Oct 7.")
        assert "cbt-hist" not in fr.split("</style>")[1] and "cb-basis-hist.js" not in fr, \
            "no basis log given: no history box, no script"
        ho = open(os.path.join(out, "nebraska", "hooper.html")).read()
        assert "1.16" not in ho and "1.17" not in ho and "$9.70" in ho
        assert "Op old: no price posted in the last 72 hours" in ho, "a quiet board must be named, unpriced"
        # nearby: a town with bids lists the other elevators within 40 mi, with their own gated numbers
        assert "Other elevators within 40 miles" in fr and 'href="/cash-bids/nebraska/hooper"' in fr
        near_fr = fr[fr.index('id="nearby"'):]
        assert "Soybeans $9.70" in near_fr and "13 mi" in near_fr and "posted Oct 7" in near_fr, near_fr[:900]
        assert "1.16" not in near_fr and "Redfield" not in near_fr, "only gated rows, only within 40 mi"
        assert "Op n0" not in near_fr, "a town's own elevators are not repeated as its neighbours"
        # the store-or-sell line comes after the first table (2026-10-15: the price
        # leads), and still before the other cards and the email box
        top_i = fr.index('<div class="cbt-top"><p><b>Corn, Op n0:</b> Hold to Nov?')
        assert fr.index("</table>") < top_i < fr.index('id="bid-email"')
        assert top_i < [m.start() for m in re.finditer('class="cbt-el"', fr)][1]
        # a town whose only boards are quiet is written noindex and left out of the sitemap
        lone = json.loads(json.dumps(merged))
        lone["bids"] = [x for x in lone["bids"] if x["source"] != "t-st"]
        build_all(lone, index, ZT, out_dir=out + "2", root=".", min_towns=0, now=parse_ts("2026-10-07T19:00:00Z"))
        ho2 = open(os.path.join(out + "2", "nebraska", "hooper.html")).read()
        assert 'content="noindex,follow"' in ho2 and "No current bid." in ho2
        # no dead end: the nearest elevators that do have a bid, above the cards
        assert "Nearest elevators with a current bid" in ho2 and 'href="/cash-bids/nebraska/fremont"' in ho2
        assert "Corn $3.95" in ho2 and "1.17" not in ho2
        assert "cbt-answer" not in ho2.split("</style>")[1] and "FAQPage" not in ho2, "no bid, no answer and no FAQ"
        assert "Top bids" not in ho2 and '<meta property="og:title" content="Cash Grain Bids in Hooper, NE Today' in ho2
        assert os.path.exists(os.path.join(out, "iowa", "redfield.html"))
        assert not os.path.exists(os.path.join(out, "iowa", "lincolnway-energy.html"))
        ia = open(os.path.join(out, "iowa", "index.html")).read()
        # an unplaced board is named, never given a guessed town: its bid can sit in the state's
        # elevator list (the state page covers every network elevator) but links to no town page
        assert "Op fac (Lincolnway Energy)" in ia and "lincolnway-energy" not in ia
        assert not os.path.exists(os.path.join(out, "index.html"))
        # /cash-bids/states: every state page linked, with its counts; the menu's "Bids by state"
        sh = open(os.path.join(out, STATES_HUB)).read()
        assert 'href="/cash-bids/iowa/"' in sh and 'href="/cash-bids/nebraska/"' in sh, "states hub links each state"
        assert re.search(r'href="/cash-bids/iowa/">Iowa</a> <span class="cbt-mut">&middot; \d+ elevators? in \d+ towns?', sh)
        assert '<link rel="canonical" href="https://agsist.com/cash-bids/states">' in sh and "static-nav:header" in sh
        assert "—" not in sh, "no em dash on the states hub"
        ne = open(os.path.join(out, "nebraska", "index.html")).read()
        assert 'href="/cash-bids/nebraska/fremont"' in ne and 'href="/cash-bids/iowa/"' in ne
        assert '<meta property="og:title" content="Nebraska cash bids and basis">' in ne
        # the state page is the state's basis page too: the one method, n beside the median,
        # the best bid first, the misread board left out and said so
        assert '<h2 id="basis">Nebraska basis today</h2>' in ne and 'href="/cash-bids/nebraska/#basis"' in fr
        assert ne.index('id="best"') < ne.index('id="basis"') < ne.index('id="elevators"') < ne.index('id="towns"')
        assert "\u221231\u00bd\u00a2</span></div><div class=\"l\">Corn: middle basis vs Dec '26" in ne, "median of six Dec bids (-31.5c, as posted, not rounded to -32)"
        assert "n = <b>6</b> elevators" in ne and "$3.95</div><div class=\"l\">Top corn bid" in ne
        assert "read as a misread board and left out" in ne and 'data-state-table="NE"' in ne
        assert "/components/state-bids.js?v=2" in ne and "/basis/" not in ne
        assert re.search(r'<meta name="twitter:description" content="Bids from \d+ elevators across 2 Nebraska towns\. '
                         r'Top bid for nearest delivery: corn \$3\.95, soybeans \$9\.85\. Updated Oct 7, 12:00 pm CT\.">',
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
        assert txt.endswith("Updated Oct 7, 12:00 pm CT.") and live_html.count(esc(txt)) == 2, live_html
        assert stamp_live_page(lp, [x for x in metas if not x["indexable"]]) == LIVE_SHARE_GENERIC["og:description"]
        assert open(lp).read() == f"<head>{gen_tags}</head>"
        assert stamp_live_page(os.path.join(td, "missing.html"), metas) is None
        # the companies line and the "my elevator" answer (stamp_live_coverage)
        cos_t = [{"slug": "adm", "path": "/cash-bids/company/adm", "short": "ADM", "live": 9, "locations": 9},
                 {"slug": "acme-co-op", "path": "/cash-bids/company/acme-co-op", "short": "Acme Co-op", "live": 40,
                  "locations": 40},
                 {"slug": "zed", "path": "/cash-bids/company/zed", "short": "Zed & Sons", "live": 1, "locations": 3}]
        ln = coverage_line(cos_t)
        assert ln.index(">ADM<") < ln.index(">Acme Co-op<") < ln.index(">Zed &amp; Sons<"), ln   # searched first, then size
        assert "more elevator" not in ln and "cargill" not in ln.lower(), ln
        six = cos_t + [{"slug": f"c{i}", "path": f"/cash-bids/company/c{i}", "short": f"C{i}", "live": i, "locations": 3}
                       for i in range(4)]
        assert "and 2 more elevator companies." in coverage_line(six), coverage_line(six)
        assert coverage_line([]) == ""
        cnt = {"bids": {"elevators": 1743, "towns": 1369}, "coverage": {"read": 1845, "elevators": 8403}}
        fh, ft = coverage_faq(cos_t, cnt)
        assert "read 1,845 bid boards, out of 8,403 elevators" in ft and "1,743 elevators in 1,369 towns" in ft, ft
        assert "3 companies with 3 or more locations" in ft and 'href="/list-your-elevator"' in fh, fh
        assert coverage_faq(cos_t, {}) is None and "\u2014" not in fh and "\u2014" not in ft
        ld0 = {"@context": "https://schema.org", "@graph": [{"@type": "FAQPage", "mainEntity": [
            {"@type": "Question", "name": "Which elevators are covered?", "acceptedAnswer": {"@type": "Answer", "text": "x"}},
            {"@type": "Question", "name": "Last?", "acceptedAnswer": {"@type": "Answer", "text": "y"}}]}]}
        cp = os.path.join(td, "cov.html")
        with open(cp, "w") as f:
            f.write(f'<script type="application/ld+json">{json.dumps(ld0)}</script><p><!--CO-LINE-->old<!--/CO-LINE--></p>'
                    f'<div><!--CO-FAQ-->old<!--/CO-FAQ--></div>')
        assert stamp_live_coverage(cp, cos_t, cnt) is True
        ch = open(cp).read()
        assert "old" not in ch and ch.count("1,845") == 2, ch
        ldq = [q["name"] for q in json.loads(re.search(r'json">(.*?)</script>', ch).group(1))["@graph"][0]["mainEntity"]]
        assert ldq == ["Which elevators are covered?", CO_FAQ_Q, "Last?"], ldq
        assert stamp_live_coverage(cp, cos_t, cnt) is False          # same data: unchanged, no duplicate question
        assert stamp_live_coverage(cp, [], None) is False and "1,845" in open(cp).read()   # no data: old text stays
        locs = re.findall(r"<loc>(.*?)</loc>", open(sm).read())
        assert "https://agsist.com/cash-bids/nebraska/fremont" in locs and "https://agsist.com/cash-bids/nebraska/" in locs
        for k in ("not_a_network_board", "not_us_or_not_usd", "price_older_than_cutoff", "stale_or_unconfirmed",
                  "delivery_expired_or_undated", "implied_futures_disagrees", "other_crop"):
            assert drops.get(k), (k, drops)
        assert len(new) == 7 and "https://agsist.com/cash-bids/states" in new, new   # 6 pages + the states hub
        assert "https://agsist.com/cash-bids/states" in locs, "the states hub is in the sitemap"
        try:
            build_all(merged, index, {"zips": {}}, out_dir=out + "3", now=parse_ts("2026-10-07T19:00:00Z"))
            raise AssertionError("built without the town table")
        except SystemExit:
            pass
        # a rebuild from the same snapshot writes the same bytes and nothing new
        _, _, _, new2 = build_all(merged, index, ZT, out_dir=out, root=".", min_towns=0, now=parse_ts("2026-10-07T20:00:00Z"))
        assert new2 == [] and open(os.path.join(out, "nebraska", "fremont.html")).read() == fr
        # a town that loses its last board leaves a pointer to its state page, kept on later runs
        with open(os.path.join(out, "iowa", "old-town.html"), "w") as f:
            f.write("<title>a real town page from an earlier run</title>")
        for _ in range(2):
            _, _, _, new3 = build_all(merged, index, ZT, out_dir=out, root=".", min_towns=0, now=parse_ts("2026-10-07T20:00:00Z"))
            pt = open(os.path.join(out, "iowa", "old-town.html")).read()
            assert PP.pointer_target(pt) == "/cash-bids/iowa/" and "Old Town is now covered on the" in pt, pt
            assert new3 == [], new3
        assert PP.load(td, "cash-bids")["cash-bids/iowa/old-town.html"]["to"] == "/cash-bids/iowa/"
        assert len(pt.encode()) <= PP.MAX_BYTES and 'content="noindex, follow"' in pt
        try:
            build_all(merged, index, ZT, out_dir=out, min_towns=0, now=parse_ts("2026-10-08T03:00:00Z"))
            raise AssertionError("stale snapshot built")
        except SystemExit:
            pass
    # AN ELEVATOR THAT KEEPS ITS OWN LISTING (agsist.com/post): hours, harvest
    # hours, contact name and note print escaped; "Closed today" only as a
    # hidden line the reader's clock shows while closedUntil is ahead; boards
    # without `portal` print none of it.
    for closed, want in (("2026-10-08T04:59:59.999Z", True), ("2026-10-07T04:59:59.999Z", False)):
        pm, pidx = _fixture()
        for b in pm["bids"]:
            if b["city"] in PINS:
                b["lat"], b["lon"] = PINS[b["city"]]
        for src in pidx["sources"]:
            if src["id"] == "t-st":
                src["portal"] = {"listingId": "op-st-hooper-ne", "name": "Op st", "contactName": "Wyatt",
                                 "hours": "Mon-Fri 7-5, Sat 7-12", "harvestHours": "7am-9pm <b>through</b> Nov 15",
                                 "note": '<img src=x onerror=alert(1)> Dump closes at 8:30 & "sharp"',
                                 "closedUntil": closed, "infoUpdatedAt": "2026-10-06T16:00:00Z"}
        with _tf.TemporaryDirectory() as td:
            out = os.path.join(td, "cash-bids")
            build_all(pm, pidx, ZT, out_dir=out, root=".", min_towns=0, now=parse_ts("2026-10-07T19:00:00Z"))
            ho = open(os.path.join(out, "nebraska", "hooper.html")).read()
            fr = open(os.path.join(out, "nebraska", "fremont.html")).read()
        assert "<img src=x" not in ho and "<b>through</b>" not in ho, "portal text printed as HTML"
        assert "&lt;img src=x onerror=alert(1)&gt; Dump closes at 8:30 &amp; &quot;sharp&quot;" in ho
        assert "<b>Hours</b> Mon-Fri 7-5, Sat 7-12" in ho and "&lt;b&gt;through&lt;/b&gt;" in ho
        assert "call Wyatt to confirm (402-555-0101)" in ho
        if want:
            assert ('<p class="cbt-closed" data-closed-until="2026-10-08T04:59:59Z" hidden' in ho
                    and "if(u>n){e.hidden=false" in ho), "closed line is hidden and shown only by the clock"
        else:
            assert "cbt-closed" not in ho and "Closed today" not in ho, "a past closedUntil prints nothing"
        for x in ("cbt-closed", "Closed today", "<b>Hours</b>", "Wyatt", "Dump closes"):
            assert x not in fr, f"portal text on a board without a listing: {x}"
    assert portal_info(None) is None and portal_info("x") is None and portal_info({"note": "  "}) is None
    assert portal_info({"note": "a\n<b>" + "x" * 300})["note"] == "a <b>" + "x" * 134 + "\u2026"
    # the bid email box's ZIP: the page's own, else the town's own ZIP nearest
    # its elevators (never one far off), else none and no box
    tz = town_zips({"zips": {"50001": ["Ackworth", "IA"], "50002": ["Ackworth", "IA"], "68025": ["Fremont", "NE"],
                             "5000x": ["Ackworth", "IA"]}})
    assert tz == {("IA", "ackworth"): ["50001", "50002"], ("NE", "fremont"): ["68025"]}, tz
    cent = {"50001": (41.0, -93.0), "50002": (41.40, -93.47)}.get
    tw = {"state": "IA", "name": "Ackworth", "boards": {"a": {"pin": (41.37, -93.47)}}}
    assert box_zip(tw, "50999", {"town_zips": tz, "zip_coord": cent}) == "50999"
    assert box_zip(tw, "", {"town_zips": tz, "zip_coord": cent}) == "50002"
    assert box_zip(dict(tw, boards={"a": {"pin": (43.0, -96.0)}}), "", {"town_zips": tz, "zip_coord": cent}) == ""
    assert box_zip(dict(tw, boards={}), "", {"town_zips": tz, "zip_coord": cent}) == "50001"
    assert box_zip(dict(tw, name="Nowhere"), "", {"town_zips": tz}) == ""
    assert signup_box(tw, "", "iowa", {"corn"}, {}) == ""
    # CDR Farms (AgriCharts) writes October delivery as "Oct 01, 2026": a month start, kept all month
    import datetime as _dt
    oct15 = _dt.datetime(2026, 10, 15, 9)
    cdr = {"periodVia": "month-day-year", "delivery": "Oct 01, 2026", "period": "2026-10"}
    assert not dated_label_past(cdr, oct15), "a month-start label is not a past deadline"
    assert delivery_label(cdr) == "Oct 2026", delivery_label(cdr)
    for d in ("Nov 11, 2026", "Oct 21, 2026"):
        assert delivery_label(dict(cdr, delivery=d)) != d[:3] + " 2026", d
    _selftest_known()
    _selftest_answer()
    _selftest_delivery_year()
    _selftest_place()
    _selftest_name_fit()
    _selftest_share()
    _selftest_best()
    _selftest_restricted()
    # the Rain Print line: Nov 1 to Dec 24 only, one hidden slot, and page_end loads its script only then
    for d, on in ((dt.date(2026, 10, 31), False), (dt.date(2026, 11, 1), True), (dt.date(2026, 12, 24), True),
                  (dt.date(2026, 12, 25), False), (dt.date(2027, 6, 1), False)):
        got = rain_print_line(dt.datetime(d.year, d.month, d.day, 12))
        assert bool(got) == on, d
        assert got in ("", '<p class="rp-promo" data-rain-print-promo hidden></p>')
    assert "rain-print-promo.js" in page_end("", promo=True) and "rain-print-promo.js" not in page_end("")
    import build_company_pages as CO      # the company pages, built inside build_all()
    CO.selftest()
    # sets pass 2026-10-18: two spring wheat contracts that both read "Dec '26" are told apart by exchange
    _sm = {"wheat_hrs": {"contracts": [{"contract": ("MWO", 11, 2026), "median": -0.725, "n": 4, "lo": -0.85, "hi": -0.6},
                                       {"contract": ("MW", 11, 2026), "median": -0.8, "n": 3}],
                         "rows": [], "no_contract": [], "suspect": []}}
    _bs = basis_section("MT", _sm, None)
    _bs = _bs if isinstance(_bs, str) else " ".join(x for x in _bs if isinstance(x, str)) if isinstance(_bs, (list, tuple)) else str(_bs)
    assert "vs Dec '26 MIAX spring wheat: middle" in _bs and "one futures contract does not compare" in _bs, _bs[:600]
    print("selftest OK")


def _selftest_answer():
    """The answer sentence, the state line and the "Basis since June" box."""
    import tempfile as _tf
    snap = parse_ts("2026-10-07T18:00:00Z").astimezone(CT)
    t1, t2 = parse_ts("2026-10-07T17:00:00Z"), parse_ts("2026-10-06T15:00:00Z")
    dec, nov = ("ZC", 11, 2026), ("ZS", 10, 2026)

    def row(crop, cash, basis, con, dm="2026-10", com=None, pt=t1):
        return {"crop": crop, "commodity": com or crop.title(), "dm": dm, "cash": cash, "basis": basis,
                "contract": con, "priced": pt, "label": "Oct 2026", "period": dm}
    a = {"operator": "Alpha Grain", "city": "Town", "rows": [
        row("corn", 4.10, -0.60, dec), row("corn", 4.90, -0.10, dec, com="Non-GMO Corn"),
        row("corn", 4.20, -0.50, dec, dm="2026-11")]}
    b = {"operator": "Beta Co-op", "city": "Town", "rows": [row("corn", 4.12, -0.58, dec, pt=t2),
                                                          row("soybeans", 10.01, -0.70, None, pt=t2)]}
    pk = answer_picks([a, b])
    assert pk["corn"][0]["cash"] == 4.12 and pk["corn"][1] == "Beta Co-op", \
        "the nearest month's best regular bid: never the non-GMO premium, never a later month"
    assert answer_sentence(pk, snap) == ("Nearest-delivery bids: corn $4.12 at Beta Co-op for Oct 2026 delivery "
                                         "(basis \u221258\u00a2 vs Dec '26) and soybeans $10.01 for Oct 2026 "
                                         "(basis \u221270\u00a2), posted Oct 6."), \
        answer_sentence(pk, snap)
    # the Deerfield, MO case: the board row reads "New crop 2026" (filed under Oct)
    # and a later row pays more; the answer names the row's own label and does
    # not call the nearest bid the top one
    adm = {"operator": "ADM", "city": "Town", "rows": [
        dict(row("soybeans", 12.71, 0.10, nov), label="New crop 2026"),
        dict(row("soybeans", 13.04, 0.15, ("ZS", 2, 2027), dm="2027-03"), label="Mar 2027")]}
    s_adm = answer_sentence(answer_picks([adm]), snap)
    assert s_adm.startswith("Nearest-delivery bid: soybeans $12.71 at ADM for New crop 2026 delivery"), s_adm
    assert "for Oct" not in s_adm and "13.04" not in s_adm and "Top" not in s_adm, s_adm
    pk2 = dict(pk, corn=(dict(pk["corn"][0], priced=t1), "Alpha Grain"))
    assert answer_sentence(pk2, snap).endswith("posted Oct 6 to 7."), answer_sentence(pk2, snap)
    sen, dsc = answer_and_desc(pk, snap, "Longname Township Junction, WI")
    assert dsc == f"Longname Township Junction, WI cash bids. {sen} Call to confirm." or dsc.endswith(sen)
    assert len(dsc) <= DESC_MAX and sen in dsc
    summ = {"corn": {"contracts": [{"contract": dec, "n": 9, "median": -0.55}]},
            "soybeans": {"contracts": [{"contract": nov, "n": 4, "median": -0.80}]}}
    out, lines = state_compare(pk, summ, "Wisconsin")
    assert lines == ["Corn basis at Beta Co-op, \u221258\u00a2 vs Dec '26, is 3\u00a2 weaker than the Wisconsin middle "
                     "(\u221255\u00a2, 9 elevators).",
                     "Beta Co-op posts no futures month with its basis, so it is not compared with the Wisconsin middle "
                     "(soybean \u221280\u00a2 vs Nov '26, 4 elevators)."], lines
    pk3 = dict(pk, corn=(dict(pk["corn"][0], contract=("ZC", 2, 2027)), "Beta Co-op"))
    assert "a month too few Wisconsin elevators use" in state_compare(pk3, summ, "Wisconsin")[1][0]
    assert state_compare(pk, {"corn": {"contracts": [{"contract": dec, "n": 2}]}}, "Wisconsin") == ([], []), \
        "fewer than three bids: no middle to compare with"
    pk4 = dict(pk, corn=(dict(pk["corn"][0], basis=-0.551), "Beta Co-op"))
    assert "is even with the Wisconsin middle" in state_compare(pk4, summ, "Wisconsin")[1][0]
    # the basis log's months: twin of components/cb-basis-hist.js parseDm (test/cash-bids-h2h.test.mjs)
    for raw, d, want in (("JUN26", "2026-06-01", "2026-06"), ("OCT 01, 2026", "2026-09-30", "2026-10"),
                         ("NOVEMBER", "2026-09-30", "2026-11"), ("JANUARY", "2026-12-02", "2027-01"),
                         ("10/01/2026", "2026-09-01", "2026-10"), ("OCTOBER (2026-12)", "2026-10-01", "2026-10"),
                         ("HARVEST 26", "2026-09-01", None), ("IN STORE", "2026-09-01", None)):
        assert parse_dm(raw, d) == want, (raw, parse_dm(raw, d))
    assert norm_fac("CDR FARMS, LLC") == norm_fac("CDR Farms LLC") and norm_town("St. Ansgar") == norm_town("SAINT ANSGAR")
    # "Basis since June": only elevators with a logged change get the box, and the
    # page carries their names, never the history itself
    merged, index = _fixture()
    ZT = {"zips": {"68025": ["Fremont", "NE"], "68031": ["Hooper", "NE"], "50001": ["Ackworth", "IA"]}}
    with _tf.TemporaryDirectory() as td:
        hd = os.path.join(td, "spark")
        os.makedirs(hd)
        with open(os.path.join(hd, "NE.json"), "w") as f:
            json.dump({"series": {"NE|OP N0|FREMONT|corn|ZCZ26|OCT26": [{"date": "2026-09-01", "cents": -31}],
                                  "NE|OP N1|FREMONT|corn|ZCZ26|HARVEST 26": [{"date": "2026-09-01", "cents": -33}],
                                  "NE|OP ST|HOOPER|soybeans|ZSX26|NOV26": [{"date": "2026-09-01", "cents": -55}]}}, f)
        out = os.path.join(td, "cb")
        build_all(merged, index, ZT, out_dir=out, min_towns=0, now=parse_ts("2026-10-07T19:00:00Z"), hist_dir=hd)
        fr = open(os.path.join(out, "nebraska", "fremont.html")).read()
        ia = open(os.path.join(out, "iowa", "redfield.html")).read()
    box = re.search(r'<details class="cbt-hist" data-basis-hist="NE" data-boards="([^"]*)">', fr)
    assert box and json.loads(html_unescape(box.group(1))) == [["Op n0", ["Fremont"]]], \
        "Op n1's only key names no month it can draw, so it is not offered"
    assert "-31" not in fr and "\u221231\u00a2" not in fr.split("Nebraska middle")[0].split("cbt-hist")[-1]
    assert fr.count('/components/cb-basis-hist.js?v=2') == 1 and "&ldquo;Basis since&rdquo; box reads" in fr
    assert "<summary>Basis since Sep 1</summary>" in fr and "since June" not in fr, "the heading is the first logged date"
    assert fr.index("cbt-hist\"") > fr.index('id="bid-email"'), "after the email box, with the other cards"
    assert "cb-basis-hist.js" not in ia and "Basis since" not in ia, "no logged change in the state: no box"



def _selftest_delivery_year():
    """A guessed delivery year is checked against the futures month; a year
    the board wrote is never moved (Oct 18, 2026 snapshot cases)."""
    gen = "2026-10-18T22:00:00Z"
    srcs, bids = [], []

    def add(sid, st, city, crop, delivery, period, via, fm, cash, basis):
        if sid not in {s["id"] for s in srcs}:
            srcs.append({"id": sid, "operator": sid, "status": "ok", "health": "live",
                         "checkedAt": "2026-10-18T21:00:00Z"})
        bids.append({"place": sid, "source": sid, "operator": sid, "city": city, "state": st, "currency": "USD",
                     "crop": crop, "commodity": crop.title(), "delivery": delivery, "period": period,
                     "periodVia": via, "periodPast": False, "cash": cash, "basis": basis,
                     "basisUnit": "per-bushel", "futuresMonth": fm, "via": "scrape", "stale": False,
                     "sourceStatus": "ok", "pricedAt": "2026-10-18T13:00:00Z"})
    add("cameron", "MO", "Cameron", "corn", "December January", "2026-12", "month-inferred-year", "Mar 27", 4.40, -0.46)
    add("cameron", "MO", "Cameron", "corn", "Sept Oct Nov 26", "2027-09", "month-inferred-year", "Dec 26", 4.32, -0.42)
    add("cortland", "OH", "Cortland", "soybeans", "SEP/OCT/NOV 26", "2027-09/2027-10", "month-pair-inferred-year",
        "@S6X", 11.9625, -0.65)
    add("cortland", "OH", "Cortland", "soybeans", "JAN 27", "2027-01", "month-year", "@S7F", 12.4075, -0.35)
    add("newaygo", "MI", "Newaygo", "corn", "Oct/Nov27", "2026-10", "month-inferred-year", "ZCZ27", 4.41, -0.65)
    add("newaygo", "MI", "Newaygo", "corn", "Oct/Nov 26", "2026-10/2026-11", "month-pair", "ZCZ26", 4.24, -0.50)
    add("chs", "MN", "Ada", "soybeans", "DEC-JAN 2027", "2027-12/2028-01", "month-pair", "ZSF27", 12.10, -0.60)
    add("stratton", "CO", "Burlington", "corn", "08/01/2027", "2027-08", "us-date", "ZCZ26", 4.50, -0.20)
    add("stratton", "CO", "Burlington", "corn", "Oct", "2026-10", "month-inferred-year", "ZCZ29", 4.30, -0.40)
    zt = {"zips": {"64429": ["Cameron", "MO"], "44410": ["Cortland", "OH"], "49337": ["Newaygo", "MI"],
                   "56510": ["Ada", "MN"], "80807": ["Burlington", "CO"]}}
    towns, drops, _ = select({"generated": gen, "bids": bids}, {"sources": srcs}, known_towns(zt))
    got = {(t["state"], r["crop"], r["label"]): (r["period"], r["dm"])
           for t in towns.values() for bd in t["boards"].values() for r in bd["rows"]}
    assert got[("MO", "corn", "December January")] == ("2026-12", "2026-12"), got
    assert ("MO", "corn", "Sept Oct Nov 26") not in got, "Sep 2026 has passed: off the page, not filed under 2027"
    assert got[("OH", "soybeans", "SEP/OCT/NOV 26")] == ("2026-09/2026-10", "2026-10"), got
    assert got[("OH", "soybeans", "Jan 2027")] == ("2027-01", "2027-01"), got
    assert got[("MI", "corn", "Oct/Nov27")] == ("2027-10", "2027-10"), got
    assert got[("MI", "corn", "Oct/Nov 26")] == ("2026-10/2026-11", "2026-11"), got
    assert got[("MN", "soybeans", "DEC-JAN 2027")] == ("2026-12/2027-01", "2027-01"), got
    assert got[("CO", "corn", "Aug 2027")] == ("2027-08", "2027-08"), "a year the board wrote is never moved"
    assert ("CO", "corn", "Oct 2026") not in got and drops["delivery_year_did_not_check_out"] == 1, (got, drops)
    bd = towns[("CO", "burlington")]["boards"]["stratton"]
    assert bd["why"]["delivery_year_did_not_check_out"] == 1
    assert checked_period({"period": "2026-10", "periodVia": "month-inferred-year"}, None) == "2026-10", \
        "no futures month: nothing to check against"


def _selftest_place():
    """The branch a board names (labelInFeed), a misspelt city dropped, and the
    hand placement of Key Cooperative's Pine Lake board."""
    gen = "2026-10-18T22:00:00Z"
    srcs = [{"id": "keycoop-pinelake", "operator": "Key Cooperative", "status": "ok", "health": "live",
             "labelInFeed": "Pine Lake", "checkedAt": "2026-10-18T21:00:00Z"},
            {"id": "t-typo", "operator": "Typo Grain", "status": "ok", "health": "live",
             "checkedAt": "2026-10-18T21:00:00Z"},
            {"id": "t-fac", "operator": "Linn Coop Oil Company", "status": "ok", "health": "live",
             "checkedAt": "2026-10-18T21:00:00Z"}]

    def bid(sid, city, zp, lat, lon, op):
        return {"place": sid, "source": sid, "operator": op, "city": city, "state": "IA", "zip": zp, "lat": lat,
                "lon": lon, "currency": "USD", "crop": "corn", "commodity": "Corn", "delivery": "10/01/2026",
                "period": "2026-10", "periodVia": "us-date", "periodPast": False, "cash": 4.39, "basis": -0.35,
                "basisUnit": "per-bushel", "futuresMonth": "ZCZ26", "via": "scrape", "stale": False,
                "sourceStatus": "ok", "pricedAt": "2026-10-18T13:00:00Z"}
    bids = [bid("keycoop-pinelake", "Ackney", "50601", 42.5527, -93.0608, "Key Cooperative"),
            bid("t-typo", "Ackney", "50601", 42.5527, -93.0608, "Typo Grain"),
            bid("t-fac", "Ingredion", "52404", None, None, "Linn Coop Oil Company")]
    zt = {"zips": {"50601": ["Ackley", "IA"], "50672": ["Steamboat Rock", "IA"], "52404": ["Cedar Rapids", "IA"]}}
    towns, _, _ = select({"generated": gen, "bids": bids}, {"sources": srcs}, known_towns(zt), zt,
                         {"50601": (42.55, -93.05), "50672": (42.41, -93.07), "52404": (41.95, -91.68)}.get, {})
    pl = towns[("IA", "steamboat-rock")]["boards"]["keycoop-pinelake"]
    assert (pl["zip"], pl["pin"], pl["branch"]) == ("50672", (42.4178, -93.0629), "Pine Lake"), pl
    assert head_name(pl) == "Key Cooperative (Pine Lake, Steamboat Rock)", head_name(pl)
    ty = towns[("IA", "ackley")]["boards"]["t-typo"]
    assert ty["branch"] == "" and head_name(ty) == "Typo Grain", head_name(ty)
    assert "keycoop-pinelake" not in towns[("IA", "ackley")]["boards"]
    fac = towns[("IA", "cedar-rapids")]["boards"]["t-fac"]
    assert head_name(fac) == "Linn Coop Oil Company (Ingredion, Cedar Rapids)", head_name(fac)
    assert branch_name({"city": "Creston 1"}, {}, "Creston", {"creston": "Creston"}) == "Creston 1"
    assert head_name({"operator": "", "city": "Ackney", "branch": "", "town": "Ackley"}) == "Ackney"
    assert op_key("Heartland Co-op") == op_key("Heartland Coop") == op_key("Heartland Cooperative") \
        == op_key("Heartland Co op") == "heartland"
    gc = {"name": "Garden City", "boards": {"p": {"operator": "Garden City Co-op"}}}
    assert known_section(gc, [{"id": "reg:KS|x|gardencity", "name": "The Garden City Co-op, Inc.",
                               "town": "Garden City", "state": "KS"}]) == "", "the board already on the page"
    sec = board_section(pl, parse_ts(gen).astimezone(CT))[0]
    assert '<div class="loc">Pine Lake</div>' in sec and "Ackney" not in sec, sec[:400]
    assert near_text(dict(ty, how="zip")) == "Ackley, IA 50601"


def _selftest_name_fit():
    """Real rows of 2026-10-20: Farmers Win Cooperative's "Granger" board (ZIP
    52136, Cresco, its pin on that ZIP) was the Granger, IA page at corn $3.97,
    140 mi from Granger. It now goes to Cresco, and /cash-bids/iowa/granger points there."""
    import tempfile as _tf
    gen = "2026-10-20T03:37:41Z"
    cents = {"52136": (43.363, -92.126), "50109": (41.7611, -93.8244), "50638": (42.3672, -92.7773),
             "51638": (40.8404, -95.2888), "61912": (39.5254, -88.0341), "60450": (41.3672, -88.4178),
             "60119": (41.8824, -88.4611)}
    zt = {"zips": {"52136": ["Cresco", "IA"], "50109": ["Granger", "IA"], "50638": ["Grundy Center", "IA"],
                   "51638": ["Essex", "IA"], "61912": ["Ashmore", "IL"], "60450": ["Morris", "IL"],
                   "60119": ["Elburn", "IL"]}}
    tbs, fit = known_towns(zt), name_fit(town_zips(zt), cents.get)
    granger = {"source": "farmerswin-granger", "place": "Farmers Win Cooperative||Granger|IA",
               "operator": "Farmers Win Cooperative", "city": "Granger", "town": None, "state": "IA",
               "zip": "52136", "lat": 43.363, "lon": -92.126, "precision": None}
    rej = []
    assert town_of(granger, {}, tbs) == "Granger", "no fit: the old name-only rule"
    assert town_of(granger, {}, tbs, fit, rej) is None and rej == ["Granger"], rej
    # the network's own ZIP, pin miles off and not street-level: stays (Total Grain, Ashmore IL)
    ash = {"city": "Ashmore", "state": "IL", "zip": "61912", "lat": 38.7166, "lon": -88.91525, "precision": None}
    assert town_of(ash, {}, tbs, fit) == "Ashmore"
    # a ZIP one digit off the town's own is a typo: NEW Cooperative's Essex (50638 for 51638) stays in Essex
    essex = {"city": "Essex", "state": "IA", "zip": "50638", "lat": 42.3672, "lon": -92.7773, "precision": None}
    assert town_of(essex, {}, tbs, fit) == "Essex"
    # a street pin decides between two named towns: FS Grain "CHS - Elburn/ Morris" is at Elburn
    fs = {"city": "CHS - Elburn/ Morris", "state": "IL", "lat": 41.9011, "lon": -88.54022, "precision": "street"}
    assert town_of(fs, {}, tbs) == "Morris" and town_of(fs, {}, tbs, fit) == "Elburn"
    assert town_of(dict(granger, zip=None, lat=None, lon=None), {}, tbs, fit) == "Granger", "nothing to check"
    row = dict(granger, currency="USD", crop="corn", commodity="Corn", delivery="Oct 2026", period="2026-10",
               periodVia="month-year", periodPast=False, cash=3.97, basis=-0.70, basisUnit="per-bushel",
               futuresMonth="ZCZ26", via="scrape", stale=False, sourceStatus="ok", pricedAt="2026-10-20T02:00:00Z")
    srcs = [{"id": "farmerswin-granger", "operator": "Farmers Win Cooperative", "status": "ok", "health": "live",
             "zip": "52136", "checkedAt": "2026-10-20T03:00:00Z"}]
    moved = {}
    towns, _, _ = select({"generated": gen, "bids": [row]}, {"sources": srcs}, tbs, zt, cents.get, {}, moved)
    assert list(towns) == [("IA", "cresco")], list(towns)
    bd = towns[("IA", "cresco")]["boards"]["Farmers Win Cooperative||Granger|IA"]
    assert bd["how"] == "zip" and near_text(bd) == "Granger, Cresco, IA 52136", near_text(bd)
    assert moved == {("IA", "granger"): ("Cresco", "Farmers Win Cooperative", "Granger")}, moved
    # the old page is kept as a pointer to Cresco, out of the sitemap
    with _tf.TemporaryDirectory() as d:
        out = os.path.join(d, OUT_DIR)
        os.makedirs(os.path.join(out, "iowa"))
        with open(os.path.join(out, "iowa", "granger.html"), "w") as f:
            f.write("<html>old Granger page, corn $3.97</html>")
        sm = os.path.join(d, SITEMAP)
        idx = {"sources": srcs}
        build_all({"generated": gen, "bids": [row]}, idx, zt, out_dir=out, root=d, sitemap=sm,
                  now=parse_ts(gen), min_towns=1, zip_coord=cents.get)
        with open(os.path.join(out, "iowa", "granger.html")) as f:
            g = f.read()
        assert PP.pointer_target(g) == "/cash-bids/iowa/cresco", g[:600]
        assert "Farmers Win Cooperative, Granger" in g and "$3.97" not in g
        with open(sm) as f:
            x = f.read()
        assert "/iowa/granger<" not in x and "/iowa/cresco<" in x, x


def _selftest_share():
    """The share card names the answer's prices, not a premium row the answer
    skips (Oct 18, 2026: 84 town pages had a share price the answer did not)."""
    import tempfile as _tf
    gen = "2026-10-18T22:00:00Z"
    srcs = [{"id": "t-a", "operator": "Alpha Grain", "status": "ok", "health": "live", "zip": "68025",
             "checkedAt": "2026-10-18T21:00:00Z"}]
    bids = [{"place": "t-a", "source": "t-a", "operator": "Alpha Grain", "city": "Fremont", "state": "NE",
             "zip": "68025", "currency": "USD", "crop": "corn", "commodity": com, "delivery": "Oct 2026",
             "period": "2026-10", "periodVia": "month-year", "periodPast": False, "cash": cash, "basis": basis,
             "basisUnit": "per-bushel", "futuresMonth": "ZCZ26", "via": "scrape", "stale": False,
             "sourceStatus": "ok", "pricedAt": "2026-10-18T13:00:00Z"}
            for com, cash, basis in (("Corn", 4.10, -0.30), ("Corn", 4.05, -0.35), ("Non-GMO Corn", 4.90, 0.50))]
    with _tf.TemporaryDirectory() as td:
        out = os.path.join(td, "cb")
        metas, _, _, _ = build_all({"schema": "agsist-merged-all/1", "generated": gen, "bids": bids},
                                   {"generated": gen, "sources": srcs}, {"zips": {"68025": ["Fremont", "NE"]}},
                                   out_dir=out, root=td, sitemap=os.path.join(td, "sm.xml"), min_towns=0,
                                   now=parse_ts("2026-10-18T22:30:00Z"))
        pg = open(os.path.join(out, "nebraska", "fremont.html")).read()
    og = re.search(r'<meta property="og:description" content="([^"]*)"', pg)
    assert og and "corn $4.10" in og.group(1) and "4.90" not in og.group(1), og and og.group(1)
    assert 'data-top="corn:4.10"' in pg, "the email box's placeholder is the answer's price too"
    assert "What is corn paying in Fremont today?" in pg and "<title>Cash Grain Bids in Fremont, NE Today" in pg
    # nothing posted today (CT): the FAQ asks for the latest bid; title and H1 keep "Today"
    snap = parse_ts(gen).astimezone(CT)
    r = {"crop": "corn", "commodity": "Corn", "dm": "2026-10", "cash": 4.1, "basis": None, "contract": None,
         "label": "Oct 2026", "period": "2026-10", "priced": parse_ts("2026-10-17T22:00:00Z")}
    tf = {"name": "Fremont", "state": "NE"}
    q = faq_pairs(tf, {"corn": (r, "Alpha Grain")}, [], [], None, snap, r["priced"])
    assert q[0][0] == "What is the latest corn bid in Fremont?", q[0]
    q = faq_pairs(tf, {"corn": (r, "Alpha Grain")}, [], [], None, snap, parse_ts("2026-10-18T05:30:00Z"))
    assert q[0][0] == "What is corn paying in Fremont today?", "12:30 am CT Oct 18 is today"


def _selftest_best():
    """A state's best card skips a row its town page flags as unusual, and a
    direct-ship code reads as words."""
    pt = parse_ts("2026-10-18T13:00:00Z")

    def nr(sid, cash, city="Town"):
        return {"source": sid, "state": "IA", "group": "corn", "crop": "corn", "operator": sid, "city": city,
                "period": "2026-10", "start": "2026-10", "contract": ("ZC", 11, 2026), "basis": cash - 4.5,
                "cash": cash, "priced": pt, "delivery": "10/01/2026"}
    near = [nr("a", 4.75, "DS-PEN"), nr("b", 4.40)]
    assert best_bids(near)["corn"]["source"] == "a"
    assert best_bids(near, {("a", "corn", "2026-10", 4.75)})["corn"]["source"] == "b"
    card = best_card("corn", near[0], {"a": ("Cedar Rapids", "/cash-bids/iowa/cedar-rapids")})
    assert "a, direct ship, <a href=\"/cash-bids/iowa/cedar-rapids\">Cedar Rapids</a>" in card and "Ds-" not in card, card
    assert "direct ship, Pen Mill" in best_card("corn", near[0], {}, {"a": "PEN MILL"})
    assert ds_name("DS-Pine Lake") == "direct ship, Pine Lake" and ds_name("DS-ADM") == "direct ship, ADM"
    assert ds_name("DS-CRG-CR") == "direct ship" and ds_name("Desoto") is None
    tw = {("IA", "t"): {"state": "IA", "boards": {"p": {"source": "a", "rows": [
        {"crop": "corn", "period": "2026-10", "period_feed": "2027-10", "cash": 4.75, "odd": {"via": "nearby"}},
        {"crop": "corn", "period": "2026-11", "cash": 4.70, "odd": None}]}}}}
    assert odd_keys(tw) == {("a", "corn", "2027-10", 4.75)}, "keyed by the feed's own period"


def _selftest_restricted():
    """Contract-, feed- or members-only bids stay in the table but never set the
    answer or the share price (River Country Co-op, Sheldon WI, Oct 18 2026)."""
    snap = parse_ts("2026-10-18T22:00:00Z").astimezone(CT)
    pt = parse_ts("2026-10-16T18:31:00Z")

    def row(crop, cash, basis, con, dm, label):
        return {"crop": crop, "commodity": crop.title(), "dm": dm, "period": dm, "cash": cash, "basis": basis,
                "contract": con, "priced": pt, "label": label}
    for lab in ("Harvest 2026, contract and feed only", "Harvest 2026, contract and feed usage only",
                "New crop 2026- CONTRACT ONLY", "Oct 2026 members only", "Oct 2026 feed only"):
        assert restricted({"label": lab}), lab
    for lab in ("Harvest 2026", "Oct 2026", "Contract Oct 2026", "Feed Mill Oct 2026"):
        assert not restricted({"label": lab}), lab
    rc = {"operator": "River Country Co-op", "city": "Sheldon", "town": "Sheldon", "rows": [
        row("corn", 4.05, -0.69, ("ZC", 11, 2026), "2026-10", "Harvest 2026"),
        row("soybeans", 11.67, -0.94, ("ZS", 10, 2026), "2026-10", "Harvest 2026, contract and feed only"),
        row("soybeans", 11.41, -0.99, ("ZS", 10, 2027), "2027-09", "Harvest 2027")]}
    pk = answer_picks([rc])
    assert pk["soybeans"][0]["cash"] == 11.41 and pk["soybeans"][0]["open_far"], pk
    assert not pk["corn"][0].get("open_far")
    sen = answer_sentence(pk, snap)
    assert sen == ("Nearest-delivery bids: corn $4.05 at River Country Co-op for Harvest 2026 delivery "
                   "(basis \u221269\u00a2 vs Dec '26) and soybeans: the nearest open bid is for Harvest 2027, $11.41 "
                   "(basis \u221299\u00a2 vs Nov '27), posted Oct 16."), sen
    assert "11.67" not in sen
    assert top_nearby(rc["rows"])["soybeans"][0] == 11.41
    assert "open_far" not in rc["rows"][2], "the table's own row is not changed"
    # a long delivery-point name gives up the town, then (one crop) the point, before the second crop or the answer
    tg = {"corn": (row("corn", 4.39, -0.35, ("ZC", 11, 2026), "2026-10", "Oct 2026"),
                   "Total Grain Marketing (Fairgrange, Charleston)"),
          "soybeans": (row("soybeans", 12.23, -0.38, ("ZS", 10, 2026), "2026-10", "Oct 2026"),
                       "Total Grain Marketing (Fairgrange, Charleston)")}
    a, d = answer_and_desc(tg, snap, "Charleston, IL")
    assert "Total Grain Marketing (Fairgrange" in a and len(d) <= DESC_MAX, a
    tg2 = {c: (r, "Total Grain Marketing (Lis, Newton)") for c, (r, _) in tg.items()}
    a, d = answer_and_desc(tg2, snap, "Newton, IL")
    assert a.startswith("Nearest-delivery bids: corn $4.39 at Total Grain Marketing (Lis) for Oct 2026") \
        and "soybeans $12.23" in a and len(d) <= DESC_MAX, a
    fv = {"corn": (row("corn", 4.59, None, None, "2026-10", "Oct 2026"),
                   "Frenchman Valley Farmers Cooperative, Inc. (Culbertson Shuttle)")}
    a, d = answer_and_desc(fv, snap, "Culbertson, NE")
    assert a and len(d) <= DESC_MAX, (a, d)
    two = {"corn": (tg["corn"][0], "CHS United Plains Ag"),
           "wheat": (row("wheat", 6.34, -0.5, ("KE", 11, 2026), "2026-10", "Open Storage"),
                     "CHS United Plains Ag (Kanco, Tribune)")}
    a, _ = answer_and_desc(two, snap, "Tribune, KS")
    assert "wheat" not in a or "at CHS United Plains Ag (Kanco" in a, "two boards never read as one: " + a
    # an open bid a month after the restricted one: an ordinary answer
    rc2 = dict(rc, rows=rc["rows"][:2] + [row("soybeans", 11.70, -0.90, ("ZS", 10, 2026), "2026-11", "Nov 2026")])
    p2 = answer_picks([rc2])["soybeans"][0]
    assert p2["cash"] == 11.70 and not p2.get("open_far")
    q = faq_pairs({"name": "Sheldon", "state": "WI"}, {"soybeans": pk["soybeans"]}, [], [], None, snap, pt)
    assert q[0][1].startswith("The nearest open soybeans bid we read in Sheldon, WI is $11.41"), q[0][1]


def _selftest_known():
    """Unread roster elevators on town pages: placed by town, linked to the
    request form with the roster's id, escaped, capped, never a board twice,
    and with no roster every page is byte for byte what it was."""
    import tempfile as _tf
    from urllib.parse import parse_qs, urlsplit
    merged, index = _fixture()
    ZT = {"zips": {"68025": ["Fremont", "NE"], "68031": ["Hooper", "NE"], "50001": ["Ackworth", "IA"]}}
    hostile = 'Sam\'s 12" <b>Co-op</b> & Sons'
    d = {"elevators": [
        {"id": "reg:NE|fremontgrain|fremont", "operator": "FREMONT GRAIN CO", "location": "FREMONT", "state": "NE", "status": "known"},
        {"id": "known:Agrex Inc|Fremont|Fremont|NE", "operator": "Agrex Inc", "location": "Fremont", "state": "NE", "status": "known"},
        {"id": "known:Agrex Inc|Agrex-East|Fremont|NE", "operator": "Agrex Inc", "location": "Fremont, NE", "state": "NE", "status": "known"},
        {"id": "known:9001", "operator": hostile, "location": "Hooper, NE", "state": "NE", "status": "known"},
        {"id": "known:9002", "operator": "Op n1, Inc.", "location": "Fremont", "state": "NE", "status": "known"},
        {"id": "t-n2", "operator": "Read Board", "location": "Fremont", "state": "NE", "status": "read"},
        {"id": "known:9003", "operator": "Nowhere Feed", "location": "Big River Plant", "state": "NE", "status": "known"},
        {"id": "known:9004", "operator": "Ontario Grain", "location": "Fremont", "state": "ON", "status": "known"},
        {"id": "bad:1", "operator": "Bad Id", "location": "Fremont", "state": "NE", "status": "known"},
        {"id": "known:9005", "operator": "Ackworth Co", "location": "Ackworth", "state": "IA", "status": "known"},
    ] + [{"id": f"reg:IA|x{i}|ackworth", "operator": f"Extra Elevator {i}", "location": "ACKWORTH", "state": "IA",
          "status": "known"} for i in range(KNOWN_MAX + 2)]}
    kb = known_by_town(d, known_towns(ZT))
    assert [e["name"] for e in kb[("NE", "fremont")]] == ["Agrex Inc", "FREMONT GRAIN CO", "Op n1, Inc."], kb[("NE", "fremont")]
    assert kb[("NE", "hooper")][0]["id"] == "known:9001" and len(kb[("IA", "ackworth")]) == KNOWN_MAX + 3
    assert not any(e["name"] in ("Read Board", "Nowhere Feed", "Ontario Grain", "Bad Id") for v in kb.values() for e in v)
    assert op_key("Op n1, Inc.") == op_key("Op n1") and op_key("FREMONT GRAIN CO") == "fremont"
    assert op_key("Bartlett Grain Company- St. Joseph", "Saint Joseph") == op_key("Bartlett Grain Company, LLC", "Saint Joseph")
    assert op_key("Frenchman Valley Coop", "Pine Bluffs") == op_key("Frenchman Valley Farmers Cooperative, Inc.", "Pine Bluffs")
    assert op_key("Agrex Inc", "Fremont") != op_key("ADM", "Fremont")
    with _tf.TemporaryDirectory() as td:
        out0 = os.path.join(td, "a")
        build_all(merged, index, ZT, out_dir=out0, root=".", sitemap=None, min_towns=0, now=parse_ts("2026-10-07T19:00:00Z"))
        out1 = os.path.join(td, "b")
        build_all(merged, index, ZT, out_dir=out1, root=".", sitemap=None, min_towns=0, now=parse_ts("2026-10-07T19:00:00Z"),
                  directory=d)
        out2 = os.path.join(td, "c")
        build_all(merged, index, ZT, out_dir=out2, root=".", sitemap=None, min_towns=0, now=parse_ts("2026-10-07T19:00:00Z"),
                  directory={"elevators": []})
        rd = lambda o, *p: open(os.path.join(o, *p), encoding="utf-8").read()  # noqa: E731
        fr, ho, ak = rd(out1, "nebraska", "fremont.html"), rd(out1, "nebraska", "hooper.html"), rd(out1, "iowa", "ackworth.html")
        assert "Also in Fremont, bids not read yet" in fr and "no price is shown for them" in fr
        assert "FREMONT GRAIN CO" in fr and fr.count("Agrex Inc") == 1, "one line per operator in a town"
        assert "Op n1, Inc." not in fr, "a board already on the page is not listed again"
        links = re.findall(r'<a href="([^"]+)" style="color:var\(--gold\)[^"]*">Is this your elevator\? Post your bids free</a>', fr)
        assert len(links) == 2, links
        q = parse_qs(urlsplit(html_unescape(links[1])).query)
        assert urlsplit(links[1]).path == LISTING_PAGE
        assert q == {"id": ["reg:NE|fremontgrain|fremont"], "name": ["FREMONT GRAIN CO"], "town": ["Fremont"],
                     "state": ["NE"], "zip": ["68025"]}, q
        # escaping: the name in text and in the link
        assert hostile not in ho and "Sam&#x27;s 12&quot; &lt;b&gt;Co-op&lt;/b&gt; &amp; Sons" in ho, \
            re.findall(r"Sam.{0,80}", ho)
        hl = re.findall(r'<a href="(/list-your-elevator\?[^"]+)"', ho)[0]
        assert "<" not in hl and '"' not in hl and "'" not in hl, hl
        assert parse_qs(urlsplit(html_unescape(hl)).query)["name"] == [hostile]
        assert f"and 3 more on the " in ak and ak.count("Is this your elevator?") == KNOWN_MAX
        assert "Also in Redfield" not in rd(out1, "iowa", "redfield.html")
        for o in (out1, out2):
            for dp, _, fs in os.walk(out0):
                for fn in fs:
                    rel = os.path.relpath(os.path.join(dp, fn), out0)
                    if o == out2 or rel not in ("nebraska/fremont.html", "nebraska/hooper.html", "iowa/ackworth.html"):
                        assert rd(out0, rel) == rd(o, rel), f"{rel} changed with no unread elevator in its town"


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
    try:
        directory = SB._net_get_json(base, "data/directory.json")
    except Exception as e:  # noqa: BLE001
        print(f"[cash-bid-pages] data/directory.json unreadable ({e}); town pages list no unread elevators")
        directory = None
    cos = []
    metas, smetas, _, new = build_all(merged, index, zip_towns, out_dir=a.out, root=a.root, sitemap=a.sitemap,
                                      check_age=not a.ignore_age, zip_coord=zip_centroids(base), prev_doc=prev,
                                      data_dir=os.path.join(a.root, "data"), hub=os.path.join(a.root, HUB_PAGE),
                                      directory=directory, hist_dir=os.path.join(a.root, "data", "basis-sparklines"),
                                      companies_out=cos)
    try:
        with open(os.path.join(a.root, "data", COUNTS_FILE), encoding="utf-8") as f:
            counts = json.load(f)
    except (OSError, ValueError):
        counts = None
    stamp_live_page(os.path.join(a.root, LIVE_PAGE), metas, counts)
    stamp_live_coverage(os.path.join(a.root, LIVE_PAGE), cos, counts)
    if a.print_new:
        with open(a.print_new, "w") as f:
            f.write("".join(u + "\n" for u in new))


if __name__ == "__main__":
    main()
