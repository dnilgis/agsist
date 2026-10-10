#!/usr/bin/env python3
"""
build_news.py — the live wire.

WHAT THIS IS FOR
----------------
The site already reads the primary sources: the WASDE watcher polls NASS inside
the release window, prices refresh every 15 minutes, the COT lands Friday
afternoon. Those are moments AGSIST knows about before a wire story exists,
because a wire story is written after somebody reads the same file we already
parsed. This turns those moments into dated items, and the workflow pings
IndexNow the second one is written, so the URL is in front of a crawler while
the newsroom is still typing.

It is NOT an aggregator. Republishing other people's headlines is slower by
construction and adds nothing. Every item here is something this site measured.

WHAT MAY BECOME AN ITEM
-----------------------
Only a change the data itself defines as a change. Every threshold below is
either a plain percentage or a bound the source file already carries -- the
52-week high in prices.json, min52/max52 in cot.json, last week's rating in
crop-progress.json. Nothing is compared against a number typed in here, because
a threshold somebody invented is a threshold that will one day be wrong and
nobody will know why.

A detector that cannot find its field writes nothing. Silence is the correct
output for missing data; a story built on an absent number is worse than no
story.

DEDUPE AND HISTORY
------------------
Each item carries an id built from what it is about, not from when it ran, so a
detector that fires on the same fact twelve times a day produces one item. The
file keeps the newest KEEP items and never rewrites the text of one already
published.
"""

import json
import os
import sys
from datetime import datetime, timezone
try:
    from zoneinfo import ZoneInfo
    _CT = ZoneInfo("America/Chicago")
except Exception:                                 # pragma: no cover
    _CT = None

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import pricefmt  # noqa: E402  grain price text, the twin of components/util.js AG.px
OUT = os.path.join(ROOT, "data", "news.json")
KEEP = 200

# The named contract comes first: when the front month IS December (from the
# September roll on), "Corn" and "December corn" are one quote, and the item
# names the contract (2026-09-30 and 10-01 carried both, word for word).
CROPS = {
    "corn-dec":  ("December corn",  "/corn-futures-prices"),
    "corn":      ("Corn",           "/corn-futures-prices"),
    "beans-nov": ("November beans", "/soybean-futures-prices"),
    "beans":     ("Soybeans",       "/soybean-futures-prices"),
    "wheat":     ("Wheat",          "/wheat-futures-prices"),
    "kcwheat":   ("KC wheat",       "/wheat-futures-prices"),
}
COT_NAMES = {"corn": "Corn", "beans": "Soybeans", "wheat": "Chicago wheat",
             "kcwheat": "KC wheat", "soymeal": "Soybean meal", "soyoil": "Soybean oil"}

# A session move worth a reader's attention. Percentages, so they mean the same
# thing on a $5 corn board and a $13 bean board.
MOVE_NOTABLE = 2.5
MOVE_HIGH = 4.0
# A crop rating swing. USDA reports whole points; three in a week is a real move.
RATING_POINTS = 3

# AN EXTREME IS NOT AN EVENT. THE MOVE THAT MADE IT IS.
#
# cot.json's `max52` and `min52` INCLUDE the current week. So `net >= max52` is
# not a test, it is an identity: it is true every single week the series sits at
# the top of its year. Through a grinding uptrend the wire therefore published
# "Managed money holds its biggest corn net long in a year" every week, and on
# 15 September 2026 it published it for a move of ONE CONTRACT:
#
#     Net +414,460 contracts as of September 15, 2026, from +414,459 the week
#     before.
#
# One contract in 414,460 is 0.0002%. It is a true sentence and it is not news,
# and it is the reason four of the thirteen items on the wire that week were the
# same headline.
#
# THE BOUND IS THE SERIES' OWN 52-WEEK RANGE, which cot.json already carries, so
# no number is invented here. Measured on data/cot.json of 24 September 2026,
# the week's move as a fraction of each series' own range:
#
#     corn      0.0002%      kcwheat   3.66%
#     soyoil    4.16%        beans     5.46%
#     wheat     6.65%        soymeal   8.43%
#
# The junk item and the real ones are four orders of magnitude apart, so this
# threshold is not load-bearing: anything from 0.01% to 3% gives the same
# answer on this file. 1% sits in the middle of that gap.
COT_MOVE_FRACTION = 0.01

# AND THE SAME TRAP ON THE PRICE BOARD. `wk52_hi` includes today's close, so
# `close >= wk52_hi` is true every day a market closes at its top. Corn
# published "closed at a 52-week high" on 15, 16, 21 and 22 September; the 21st
# and the 22nd were word for word identical -- "$5.43 a bushel, taking out the
# $5.39 top of its range" -- and the second one could not be true, because by
# then the top of the range was $5.43.
#
# So a new high is measured against the last high THIS WIRE PUBLISHED, kept in
# `state` below, and it has to clear it by 1% of the contract's own 52-week
# band. Replayed over those four days, two publish (the 8-cent break on the
# 15th and the 9-cent break on the 21st) and two are withheld (a 2-cent nudge
# and a repeat that moved nothing).
PX_BREAKOUT_FRACTION = 0.01


def load(name):
    p = os.path.join(ROOT, "data", name)
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def item(id_, kind, headline, detail, sig, url, source, ts=None):
    # A date-only stamp is given midday UTC so it sorts sanely against full
    # timestamps instead of landing before everything else on its own day. That
    # midday is a sort key, not a fact: day_only says so, and the page prints no
    # clock for those. USDA does not publish the COT at noon and we do not say it did.
    day_only = bool(ts) and len(ts) == 10
    return {
        "id": id_, "kind": kind, "headline": headline, "detail": detail,
        "significance": sig, "url": url, "source": source,
        "day_only": day_only,
        "ts": (ts + "T12:00:00+00:00") if day_only
              else (ts or datetime.now(timezone.utc).replace(microsecond=0).isoformat()),
    }


def iso_day(v):
    """A timestamp for sorting and for RSS. cot.json states its report_date as
    'September 08, 2026' -- readable, and useless as a sort key. Anything that
    is not already ISO is converted, and anything unparseable returns None so
    the caller falls back rather than emitting a date it made up."""
    s = str(v or "").strip()
    if not s:
        return None
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        return s[:10]
    for fmt in ("%B %d, %Y", "%b %d, %Y", "%m/%d/%Y"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            pass
    return None


def cents(v):
    """Board prices arrive in cents. Printed to the quarter cent, the way the
    price pages print them (scripts/pricefmt.py, the twin of util.js AG.px)."""
    return pricefmt.price(v) if v is not None else None


def say_day(iso):
    """'2026-09-22' -> '22 September'. Returns None rather than guessing, so a
    caller with an unreadable stamp leaves the clause out instead of printing
    a date nobody can check."""
    try:
        return datetime.strptime(str(iso)[:10], "%Y-%m-%d").strftime("%-d %B")
    except (ValueError, TypeError):
        return None


# ── detectors ──────────────────────────────────────────────────────────────

WASDE_PREFIX = "wasde:"


def wasde(out, state, held):
    """The latest graded USDA report, rebuilt from latest_result on EVERY run.

    It counts the same graded set What's Priced In counts (metric_count is the
    graded figures; ungraded ones are named apart). On 2026-10-09 this item was
    written once, when two figures were graded, and kept saying "All 2 scored
    figures" after the page had graded seven. build() now replaces any older
    item for the same report date with this one."""
    d = load("whats-priced-in.json")
    lr = (d or {}).get("latest_result")
    if not lr or not lr.get("date") or not lr.get("report"):
        return
    date, rpt = lr["date"], lr["report"]
    b = lr.get("biggest_surprise") or {}
    n, inl, ung = lr.get("metric_count") or 0, lr.get("in_line_count") or 0, lr.get("ungraded_count") or 0
    tail = f" {ung} had no trade estimate." if ung else ""
    if lr.get("all_in_line") is True:
        out.append(item(
            f"{WASDE_PREFIX}{date}:inline", "usda",
            f"{rpt} printed in line with the trade",
            f"All {n} graded figures landed close to the trade average.{tail}",
            "notable", "/whats-priced-in", "USDA, graded against the pre-report survey", iso_day(date)))
        return
    if b.get("metric") and b.get("expected") is not None and b.get("actual") is not None:
        unit = (" " + b["unit"]) if b.get("unit") else ""
        ctx = f", {b['context']}" if b.get("context") else ""
        out.append(item(
            f"{WASDE_PREFIX}{date}:{b['metric']}", "usda",
            f"{rpt}: {b['metric']} came in {b.get('surprise') or 'off the trade'}",
            f"Trade looked for {b['expected']}{unit}; USDA printed {b['actual']}{unit}"
            + (f", {b['gap_pct']:+.1f}% versus the survey average{ctx}." if b.get("gap_pct") is not None else ".")
            + f" {inl} of {n} graded figures in line.{tail}",
            "high", "/whats-priced-in", "USDA, graded against the pre-report survey", iso_day(date)))


def cot_published(rd):
    """The day CFTC published the report with positions as of `rd`, ISO, or
    the as-of day when the calendar cannot say. A COT item is news the day it
    is published (Friday), not the Tuesday its positions are dated: stamped on
    the Tuesday, Friday's item was already three days old on arrival."""
    a = iso_day(rd)
    if not a:
        return None
    try:
        import cot_calendar
        d = datetime.strptime(a, "%Y-%m-%d").date()
        return a if cot_calendar.release_unknown(d) else cot_calendar.release_date(d).isoformat()
    except Exception:                                   # noqa: BLE001 - fall back, never invent
        return a


def positioning(out, state, held):
    d = load("cot.json")
    if not d or not d.get("report_date"):
        return
    rd = d["report_date"]
    pub = cot_published(rd)
    cot = state.setdefault("cot", {})
    for key, name in COT_NAMES.items():
        c = d.get(key)
        if not isinstance(c, dict):
            continue
        net, prev = c.get("net"), c.get("prev")
        hi, lo = c.get("max52"), c.get("min52")
        if net is None:
            continue
        # See COT_MOVE_FRACTION. An extreme reached by standing still is the
        # series sitting where it already was, not a week that did something.
        rng = (hi - lo) if (hi is not None and lo is not None and hi > lo) else None
        moved = None if prev is None else abs(net - prev)
        material = (rng is not None and moved is not None
                    and moved >= rng * COT_MOVE_FRACTION)
        if (hi is not None and net >= hi) or (lo is not None and net <= lo):
            if not material:
                held.append(
                    f"{name}: at its 52-week "
                    + ("high" if (hi is not None and net >= hi) else "low")
                    + f" but the week moved {moved if moved is not None else 0:+,} "
                    + (f"of a {rng:,} range" if rng else "on an unreadable range"))
        if hi is not None and net >= hi and material:
            _again = (cot.get(key) or {}).get("side") == "max"
            cot[key] = {"side": "max", "rd": rd}
            out.append(item(
                f"cot:{rd}:{key}:max", "positioning",
                (f"Managed money pushed its {name.lower()} net long to another "
                 f"one-year high" if _again else
                 f"Managed money holds its biggest {name.lower()} net long in a year"),
                f"Net {net:+,} contracts as of {rd}"
                + (f", from {prev:+,} the week before." if prev is not None else "."),
                "high", "/cot", "CFTC Commitments of Traders", pub))
        elif lo is not None and net <= lo and material:
            _again = (cot.get(key) or {}).get("side") == "min"
            cot[key] = {"side": "min", "rd": rd}
            out.append(item(
                f"cot:{rd}:{key}:min", "positioning",
                (f"Managed money pushed its {name.lower()} net short to another "
                 f"one-year high" if _again else
                 f"Managed money holds its biggest {name.lower()} net short in a year"),
                f"Net {net:+,} contracts as of {rd}"
                + (f", from {prev:+,} the week before." if prev is not None else "."),
                "high", "/cot", "CFTC Commitments of Traders", pub))
        elif prev is not None and (prev < 0 <= net or net < 0 <= prev):
            side = "long" if net >= 0 else "short"
            out.append(item(
                f"cot:{rd}:{key}:flip", "positioning",
                f"Managed money flipped net {side} in {name.lower()}",
                f"Net {prev:+,} to {net:+,} contracts in a week, as of {rd}.",
                "notable", "/cot", "CFTC Commitments of Traders", pub))


def session_stamp(fetched):
    """The trading day a prices.json fetch belongs to, and whether its prices
    are a settlement.

    The fetch time is UTC. An 8pm Central run on 30 September is stamped
    1 October in UTC, so the Wire dated a Sep 30 move "Oct 1" and ran it
    beside the Sep 30 item it had already published for the same session --
    the same session's move, twice, one of them dated tomorrow. The day is
    the Central calendar date of the fetch.

    "Settled" is only true after the 1:20pm CT grain settle and before the
    7pm reopen on a weekday. Every other fetch is a last trade, and says so.
    Returns (iso_day, settled) or (None, False) when the stamp is unreadable."""
    s = str(fetched or "").strip()
    if not s:
        return None, False
    try:
        t = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return (s[:10] if len(s) >= 10 else None), False
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    if _CT is None:
        return t.date().isoformat(), False
    ct = t.astimezone(_CT)
    minutes = ct.hour * 60 + ct.minute
    settled = ct.weekday() < 5 and 13 * 60 + 20 <= minutes < 19 * 60
    return ct.date().isoformat(), settled


def quote_session(v, fetch_day, fetch_settled):
    """(day, settled) for one quote. The quote's own close_date names its
    session when the file carries it: a quote that did not update on a run
    belongs to the day it closed, not to the day it was read again (Oct 7 and
    Oct 8 2026 both carried KC wheat's $7.37 close as that day's move). A
    close dated before the fetch day has settled; one dated the fetch day has
    settled only inside the post-settle window session_stamp checks; one
    dated after it is the evening session's trade."""
    cd = iso_day((v or {}).get("close_date"))
    if not cd or not fetch_day:
        return fetch_day, fetch_settled
    if cd < fetch_day:
        return cd, True
    if cd == fetch_day:
        return cd, fetch_settled
    return cd, False


def board(out, state, held):
    d = load("prices.json")
    q = (d or {}).get("quotes") or {}
    fday, fsettled = session_stamp((d or {}).get("fetched"))
    if not fday:
        return
    px = state.setdefault("px", {})
    seen_quotes = []
    for key, (name, url) in CROPS.items():
        v = q.get(key)
        if not isinstance(v, dict):
            continue
        day, settled = quote_session(v, fday, fsettled)
        # "Corn down 3.8%" and "December corn down 3.8%" were the same
        # contract twice: from early fall the front month IS December. One
        # contract, one item: same crop, same close, same previous close.
        sig = (key.split("-")[0], v.get("close"), v.get("open"))
        if sig in seen_quotes:
            continue
        seen_quotes.append(sig)
        close, pct = v.get("close"), v.get("pctChange")
        hi, lo = v.get("wk52_hi"), v.get("wk52_lo")
        # See PX_BREAKOUT_FRACTION. `band` is the contract's own 52-week spread,
        # so a penny break on a $1.46 range is withheld and a dime is not, and a
        # $13 bean board is held to the same standard as a $5 corn board.
        band = (hi - lo) if (hi is not None and lo is not None and hi > lo) else None
        mark = px.get(key) or {}
        if close is not None and hi is not None and close >= hi:
            last = mark.get("hi")
            if last is None:
                # Nothing published yet. Seed on the range's own top, once.
                detail = f"{cents(close)} a bushel, the highest it has settled in a year."
            elif band is not None and close - last >= band * PX_BREAKOUT_FRACTION:
                when = say_day(mark.get("hi_day"))
                detail = (f"{cents(close)} a bushel, {close - last:.1f} cents above the "
                          f"{cents(last)} it made"
                          + (f" on {when}." if when else "."))
            else:
                held.append(f"{name}: at a 52-week high, {close - last:+.1f} cents "
                            f"on the {cents(last)} already published")
                continue
            # A RUN OF NEW HIGHS IS A DEVELOPING STORY, NOT ONE STORY FILED
            # FOUR TIMES. Corn made a new high on the 15th, the 16th, the 21st
            # and the 22nd of September and the wire printed the same six words
            # each time. Three of those were real breaks; what was wrong was
            # that the headline could not tell the first from the fourth.
            # Naming the high it took out needs no threshold and no memory of
            # how long ago it was -- it is simply what happened.
            out.append(item(f"px:{day}:{key}:hi", "board",
                            (f"{name} closed at a 52-week high" if last is None
                             else f"{name} took its 52-week high to {cents(close)}"),
                            detail,
                            "high", url, "CME settlement via the AGSIST board", iso_day(day)))
            px[key] = dict(mark, hi=close, hi_day=day)
        elif close is not None and lo is not None and close <= lo:
            last = mark.get("lo")
            if last is None:
                detail = f"{cents(close)} a bushel, the lowest it has settled in a year."
            elif band is not None and last - close >= band * PX_BREAKOUT_FRACTION:
                when = say_day(mark.get("lo_day"))
                detail = (f"{cents(close)} a bushel, {last - close:.1f} cents under the "
                          f"{cents(last)} it made"
                          + (f" on {when}." if when else "."))
            else:
                held.append(f"{name}: at a 52-week low, {close - last:+.1f} cents "
                            f"on the {cents(last)} already published")
                continue
            out.append(item(f"px:{day}:{key}:lo", "board",
                            (f"{name} closed at a 52-week low" if last is None
                             else f"{name} took its 52-week low to {cents(close)}"),
                            detail,
                            "high", url, "CME settlement via the AGSIST board", iso_day(day)))
            px[key] = dict(mark, lo=close, lo_day=day)
        if pct is None or abs(pct) < MOVE_NOTABLE:
            continue
        # A SESSION MOVE IS PUBLISHED ONCE, FROM THE CLOSE. Items written
        # from an intraday print were never corrected when the session closed
        # smaller: on 9 October 2026 the Wire said "Wheat down 2.6%, Last
        # $6.66, -17.5 cents" while wheat closed $6.70 3/4, down 12 1/2
        # (1.8%, under the bar). An intraday move is not an item.
        if not settled:
            held.append(f"{name}: {pct:+.1f}% intraday, waiting for the close")
            continue
        direction = "up" if pct > 0 else "down"
        nc = v.get("netChange")
        detail = f"Closed {cents(close)}" if close is not None else "Closed"
        if nc is not None:
            detail += f", {pricefmt.move(nc, sign=True)} on the session"
        out.append(item(f"px:{day}:{key}:move", "board",
                        f"{name} {direction} {abs(pct):.1f}% on the day",
                        detail + ".",
                        "high" if abs(pct) >= MOVE_HIGH else "notable",
                        url, "Yahoo Finance close via the AGSIST board", iso_day(day)))


def ratings(out, state, held):
    d = load("crop-progress.json")
    if not d or not d.get("in_season"):
        return
    for key, name in (("corn", "Corn"), ("soybeans", "Soybeans"),
                      ("winter_wheat", "Winter wheat"), ("spring_wheat", "Spring wheat")):
        c = d.get(key)
        if not isinstance(c, dict):
            continue
        now, prev = c.get("good_excellent"), c.get("good_excellent_prev_week")
        rd = c.get("report_date") or d.get("report_date")
        if now is None or prev is None or rd is None:
            continue
        delta = now - prev
        if abs(delta) < RATING_POINTS:
            continue
        yr = c.get("good_excellent_prev_year")
        detail = f"{now}% good-to-excellent, {abs(delta)} points {'up' if delta > 0 else 'down'} on the week"
        if yr is not None:
            detail += f", against {yr}% a year ago"
        out.append(item(f"cond:{rd}:{key}", "crop",
                        f"{name} ratings {'improved' if delta > 0 else 'fell'} {abs(delta)} points",
                        detail + ".", "notable" if abs(delta) < 5 else "high",
                        "/conditions", "USDA NASS Crop Progress", iso_day(rd)))


def weather(out, state, held):
    """2026-10-01: frost/freeze alerts, read from data/weather-alerts.json
    (scripts/fetch_weather_alerts.py, which reads NWS's own public alerts
    feed). No invented temperature threshold -- NWS has already decided what
    counts as a Frost Advisory versus a Freeze Warning; this only turns an
    active one into a dated Wire item.

    The id carries the alert's effective/expires window, not just its NWS
    id, so an alert NWS updates (extends, upgrades Advisory to Warning under
    a new VTEC product) reads as a new item through the normal id-based
    dedupe in build() -- the same mechanism every other detector here relies
    on -- while an unchanged alert polled again produces the same id and is
    correctly dropped as nothing new to say.
    """
    d = load("weather-alerts.json")
    if not d:
        return
    fetched_day = iso_day(d.get("fetched"))
    for a in (d.get("alerts") or []):
        aid, event, area = a.get("id"), a.get("event"), a.get("area")
        if not (aid and event and area):
            continue
        eff, exp = a.get("effective"), a.get("expires")
        uid = f"wx:{aid}:{eff}:{exp}"
        short_area = area if len(area) <= 70 else area[:67] + "..."
        detail = a.get("headline") or f"{event} for {area}."
        eff_day, exp_day = say_day(iso_day(eff)), say_day(iso_day(exp))
        if eff_day and exp_day:
            detail += f" In effect {eff_day} through {exp_day}."
        elif exp_day:
            detail += f" In effect through {exp_day}."
        out.append(item(
            uid, "weather", f"{event}: {short_area}", detail,
            "high" if "Warning" in event else "notable",
            a.get("url") or "https://www.weather.gov/alerts",
            "National Weather Service", fetched_day))


DETECTORS = (wasde, positioning, board, ratings, weather)

NAMED = ("corn-dec", "beans-nov")


def tidy(items):
    """Withdraw intraday move items and collapse one contract's move filed
    under two keys on the same day (see build()). Pure; selftested."""
    out = [i for i in items
           if not (str(i.get("id", "")).endswith(":move")
                   and str(i.get("detail", "")).startswith("Last "))]
    by = {}
    for i in out:
        p = str(i.get("id", "")).split(":")
        if len(p) == 4 and p[0] == "px" and p[3] == "move":
            by.setdefault((p[1], p[2].split("-")[0], i.get("detail")), []).append(i)
    drop = set()
    for group in by.values():
        if len(group) > 1:
            keep = next((i for i in group if i["id"].split(":")[2] in NAMED), group[0])
            drop.update(id(i) for i in group if i is not keep)
    return [i for i in out if id(i) not in drop]


def build():
    old = load("news.json") or {}
    kept = old.get("items") or []
    orig = list(kept)
    # THE WIRE'S MEMORY OF WHAT IT HAS ALREADY SAID, and the only reason the
    # 52-week detectors can tell a breakout from the same breakout reported
    # again. It rides in news.json because that is the one file this script
    # owns and the one thing already committed when an item fires -- a mark
    # only ever changes on the run that publishes the item it belongs to, so
    # it can never drift away from what the file says.
    state = dict(old.get("state") or {})
    # WHAT WAS DETECTED AND DELIBERATELY NOT PUBLISHED. A quiet wire and a
    # broken one read the same in the run log, and on 22-24 September 2026 the
    # wire went 65 hours without an item and nothing said whether it was
    # working. It was: it found four things and had already published all
    # four. This is that sentence, printed.
    held = []

    fresh = []
    for fn in DETECTORS:
        try:
            fn(fresh, state, held)
        except Exception as e:                       # one broken reader must not
            print(f"detector {fn.__name__} failed: {e}", file=sys.stderr)  # take the wire down

    seen = {i.get("id") for i in kept}
    # THE SAME SENTENCE IS NOT NEWS TWICE. The id carries the date, so a
    # headline and detail repeated on the next day were two different ids
    # and both published. On 21 and 22 September the wire carried "Corn
    # closed at a 52-week high / $5.43 a bushel, taking out the $5.39 top
    # of its range." twice, word for word, and the second one could not be
    # true: by then the top of the range was $5.43.
    said = {(i.get("headline"), i.get("detail")) for i in kept}
    # An item already published keeps the words it was published with, with
    # two exceptions that correct the record rather than restate it:
    #   - a session move written from an intraday print ("Last $6.66") is
    #     withdrawn; the close replaces it if the close still clears the bar
    #     (moves are now written only from the close, see board());
    #   - the same session move filed under two names for one contract
    #     ("Corn" and "December corn", same day, same numbers) keeps one,
    #     the named contract.
    # THE USDA ITEM FOLLOWS THE GRADES. It is rebuilt from latest_result every
    # run, so an older item for the same report date (written when fewer
    # figures were graded, or under the old rule) gives way to the current one.
    for i in fresh:
        fid = str(i.get("id", ""))
        if fid.startswith(WASDE_PREFIX):
            pre = WASDE_PREFIX + fid[len(WASDE_PREFIX):].split(":", 1)[0] + ":"
            kept = [k for k in kept if not (str(k.get("id", "")).startswith(pre)
                                            and (k.get("id"), k.get("headline"), k.get("detail"))
                                            != (i.get("id"), i.get("headline"), i.get("detail")))]
    kept = tidy(kept)
    seen = {i.get("id") for i in kept}
    said = {(i.get("headline"), i.get("detail")) for i in kept}
    added = [i for i in fresh
             if i.get("id") not in seen
             and (i.get("headline"), i.get("detail")) not in said]
    items = sorted(added + kept, key=lambda i: (i.get("ts") or ""), reverse=True)[:KEEP]

    # Write only when the ITEMS changed. On 2026-09-13 the first live run added
    # nothing and still committed: "updated", "added" and lastBuildDate had moved,
    # so the diff was three timestamps. Three cron schedules times twenty slots a
    # day is dozens of empty commits, and a wire whose "Updated" line advances
    # while nothing happened is claiming a freshness it does not have.
    #
    # So "updated" now means when an item last arrived, which is the only thing
    # that reading it should tell you. Liveness is the feed manifest's job --
    # data/news.json is registered there with no max_gap, precisely because a
    # quiet wire is correct rather than broken.
    changed = items != orig
    out = {
        "updated": (datetime.now(timezone.utc).replace(microsecond=0).isoformat()
                    if changed else (old.get("updated") or "")),
        "count": len(items),
        "added": len(added),
        # The marks move only on a run that publishes, so this cannot make a
        # diff on its own and cannot reintroduce the empty-commit problem the
        # paragraph above solved.
        "state": (state if changed else (old.get("state") or state)),
        "items": items,
    }
    return out, added, changed, held



# ── RSS ────────────────────────────────────────────────────────────────────
# A wire nobody can subscribe to is a page. This mirrors the shape of the
# existing feed.xml so a reader who already follows the briefing gets the same
# thing here, and so the two can be validated the same way.

RSS_PATH = os.path.join(ROOT, "news.xml")
SITE = "https://agsist.com"


def _rfc822(iso):
    try:
        d = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S +0000")


def _x(t):
    return (str("" if t is None else t)
            .replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


def rss(data, limit=40):
    items = (data.get("items") or [])[:limit]
    built = _rfc822(data.get("updated")) or _rfc822(
        datetime.now(timezone.utc).isoformat())
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
           "  <channel>",
           "    <title>AGSIST Wire: What Just Moved</title>",
           f"    <link>{SITE}/news</link>",
           "    <description>Dated grain and livestock market events the moment they are "
           "measurable: USDA report surprises, one-year positioning extremes, 52-week highs "
           "and lows, crop rating swings. Measured, not aggregated.</description>",
           "    <language>en-us</language>",
           f"    <lastBuildDate>{built}</lastBuildDate>",
           f'    <atom:link href="{SITE}/news.xml" rel="self" type="application/rss+xml"/>']
    for i in items:
        pub = _rfc822(i.get("ts") or "")
        link = f"{SITE}{i.get('url') or '/news'}"
        out += ["    <item>",
                f"      <title>{_x(i.get('headline'))}</title>",
                f"      <link>{link}</link>",
                f"      <description>{_x(i.get('detail'))}</description>",
                f"      <guid isPermaLink=\"false\">agsist-news-{_x(i.get('id'))}</guid>"]
        if pub:
            out.append(f"      <pubDate>{pub}</pubDate>")
        if i.get("source"):
            out.append(f"      <source url=\"{SITE}/news.xml\">{_x(i['source'])}</source>")
        out.append("    </item>")
    out += ["  </channel>", "</rss>", ""]
    return "\n".join(out)


def _selftest():
    ok = 0

    def check(cond, what):
        nonlocal ok
        if not cond:
            print(f"FAIL: {what}", file=sys.stderr); sys.exit(1)
        ok += 1

    # 509.5 cents prints $5.09 1/2 on the price pages (components/util.js
    # AG.px, 2026-10-10), so the wire says the same: not $5.10, not $5.09.
    check(cents(509.5) == "$5.09\u00bd", "cents() agrees with the price pages")
    check(cents(1284.0) == "$12.84", "cents() handles a bean price")
    check(iso_day("September 08, 2026") == "2026-09-08", "iso_day converts the COT's written date")
    check(iso_day("2026-09-11") == "2026-09-11", "iso_day passes ISO through")
    check(iso_day("2026-09-11T14:00:00Z") == "2026-09-11", "iso_day trims a timestamp to its day")
    check(iso_day("") is None and iso_day("not a date") is None, "iso_day invents nothing")
    check(cot_published("October 06, 2026") == "2026-10-09", "a Tuesday COT is news on its Friday")
    check(cot_published("September 08, 2026") == "2026-09-11", "a Monday holiday does not delay it")
    check(cot_published("nope") is None, "cot_published invents nothing")
    d1 = item("x", "k", "h", "d", "notable", "/", "s", "2026-09-08")
    check(d1["day_only"] is True and d1["ts"].startswith("2026-09-08T12:00"),
          "a date-only source is flagged so no clock time is shown for it")
    d2 = item("y", "k", "h", "d", "notable", "/", "s")
    check(d2["day_only"] is False, "an item stamped now carries a real clock time")
    check(cents(None) is None, "cents() passes None through")

    o = []
    board_data = {"fetched": "2026-09-11T19:05:00Z", "quotes": {
        "corn": {"close": 600.0, "pctChange": 5.0, "netChange": 28, "wk52_hi": 599.0, "wk52_lo": 400.0}}}
    globals()["load"] = lambda n: board_data if n == "prices.json" else None
    board(o, {}, [])
    check(len(o) == 2, "a new high and a 5% move are two separate items")
    check(any(i["id"].endswith(":hi") for i in o), "the 52-week high is detected from the file's own bound")
    check(all(i["significance"] == "high" for i in o), "a 5% move is high, not notable")

    o = []
    globals()["load"] = lambda n: {"fetched": "2026-09-12T00:00:00", "quotes": {
        "corn": {"close": 500.0, "pctChange": 1.0, "wk52_hi": 599.0, "wk52_lo": 400.0}}} if n == "prices.json" else None
    board(o, {}, [])
    check(o == [], "a 1% move is not news")

    print("a session move is dated the Central day it happened and waits for the close")
    # THE REAL STAMP from 30 September 2026: fetched 01:57Z on 1 October is
    # 8:57pm Central on 30 September. The Wire dated it 1 October.
    check(session_stamp("2026-10-01T01:57:02Z") == ("2026-09-30", False),
          "an evening fetch belongs to the Central day, and is not a settlement")
    check(session_stamp("2026-09-30T19:05:00Z") == ("2026-09-30", True),
          "2:05pm CT on a Wednesday is a settlement")
    check(session_stamp("2026-09-30T17:30:00Z") == ("2026-09-30", False),
          "12:30pm CT is still trading")
    check(session_stamp("2026-10-03T19:05:00Z") == ("2026-10-03", False),
          "Saturday afternoon is not a settlement")
    check(session_stamp("") == (None, False), "no stamp, no item")
    _mv = {"fetched": "2026-10-01T01:57:02Z", "quotes": {
        "corn":     {"close": 501.5, "open": 522.0, "pctChange": -3.93, "netChange": -20.5, "wk52_hi": 549.75, "wk52_lo": 425.75},
        "corn-dec": {"close": 501.5, "open": 522.0, "pctChange": -3.93, "netChange": -20.5, "wk52_hi": 549.75, "wk52_lo": 425.75}}}
    globals()["load"] = lambda n: _mv if n == "prices.json" else None
    o, held = [], []
    board(o, {}, held)
    check(o == [], "an evening print is not a close: no move item")
    check(any("waiting for the close" in h for h in held), "...and the run says it is waiting")
    _mv["fetched"] = "2026-09-30T19:05:00Z"
    o = []
    board(o, {}, [])
    check(len(o) == 1, "corn and December corn carrying one quote is one item, not two")
    check(o[0]["id"] == "px:2026-09-30:corn-dec:move", "...under the named contract, dated 30 September")
    check(o[0]["detail"] == "Closed $5.01\u00bd, \u221220\u00bd\u00a2 on the session.", o[0]["detail"])
    check(o[0]["source"].startswith("Yahoo Finance close"), "a Yahoo close is not called a CME settlement")
    # A quote that did not update on this run keeps its own session's day
    # (2026-10-07 and -08 both filed KC's $7.37 close as that day's move).
    _st = {"fetched": "2026-10-08T19:05:00Z", "quotes": {
        "kcwheat": {"close": 737.0, "open": 756.0, "pctChange": -2.51, "netChange": -19.0,
                    "close_date": "2026-10-07", "wk52_hi": 800.0, "wk52_lo": 600.0}}}
    globals()["load"] = lambda n: _st if n == "prices.json" else None
    o = []
    board(o, {}, [])
    check(len(o) == 1 and o[0]["id"] == "px:2026-10-07:kcwheat:move", "a stale quote is filed under its own day")
    check(quote_session({"close_date": "2026-10-09"}, "2026-10-08", True) == ("2026-10-09", False),
          "a close dated after the fetch day is the evening session, not a close")

    # ── the two traps that put the same sentence on the wire four times ──
    print("an extreme reached by standing still is not an event")
    # THE REAL ROW, from data/cot.json of 2026-09-24. max52 includes this week,
    # so net >= max52 was an identity and this published as "biggest corn net
    # long in a year" for a one-contract week.
    o, held = [], []
    globals()["load"] = lambda n: {"report_date": "2026-09-15", "corn": {
        "net": 414460, "prev": 414459, "max52": 414460, "min52": -187992}} if n == "cot.json" else None
    positioning(o, {}, held)
    check(o == [], "one contract on 414,459 does not make a year's biggest net long")
    check(len(held) == 1 and "414,460" not in held[0].split("moved")[0],
          "...and the run says it was withheld, with the figures")

    # AND THE ONE THAT MUST STILL GET THROUGH: soybean meal the same week,
    # +25,422 on a 301,584 range.
    o = []
    globals()["load"] = lambda n: {"report_date": "2026-09-15", "soymeal": {
        "net": 183111, "prev": 157689, "max52": 183111, "min52": -118473}} if n == "cot.json" else None
    positioning(o, {}, [])
    check(len(o) == 1 and o[0]["id"].endswith(":max"),
          "a 25,422-contract week at the same extreme is still news")

    # A flip is an event whatever its size, and must not be swallowed by the
    # floor that sits above it in the chain.
    o = []
    globals()["load"] = lambda n: {"report_date": "2026-09-15", "wheat": {
        "net": -3674, "prev": 4873, "max52": 14904, "min52": -113560}} if n == "cot.json" else None
    positioning(o, {}, [])
    check(len(o) == 1 and o[0]["id"].endswith(":flip"), "crossing zero survives the floor")

    print("a 52-week high is measured against the last one this wire published")
    _px = {"fetched": "2026-09-22T00:00:00", "quotes": {
        "corn": {"close": 543.0, "pctChange": 0.1, "wk52_hi": 543.0, "wk52_lo": 398.5}}}
    globals()["load"] = lambda n: _px if n == "prices.json" else None
    o, st = [], {}
    board(o, st, [])
    check(len(o) == 1, "with nothing published yet it fires once and seeds the mark")
    check(st["px"]["corn"]["hi"] == 543.0, "...and the mark is what it published")
    # THE 22 SEPTEMBER REPEAT. Same close, same top, nothing moved.
    o, held = [], []
    board(o, st, held)
    check(o == [], "the same high on the next day is not the news a second time")
    check(len(held) == 1, "...and the run says so")
    # A REAL BREAK: 9 cents on a 144.5-cent band is 6.2%.
    _px["quotes"]["corn"].update(close=552.0, wk52_hi=552.0)
    _px["fetched"] = "2026-09-23T00:00:00"
    o = []
    board(o, st, [])
    check(len(o) == 1, "a 9-cent break does publish")
    check("543" in o[0]["detail"] or "5.43" in o[0]["detail"],
          "...and it names the high it took out rather than repeating a range bound")
    # A ONE-CENT NUDGE on the same band is 0.7% and is not a second story.
    _px["quotes"]["corn"].update(close=553.0, wk52_hi=553.0)
    _px["fetched"] = "2026-09-24T00:00:00"
    o = []
    board(o, st, [])
    check(o == [], "a one-cent nudge above it is not")

    # AND THE HEADLINE HAS TO SAY WHICH OF THE FOUR IT IS. Replaying the four
    # September corn highs end to end is the whole complaint in one check.
    print("a run of new highs reads as a developing story, not one filed four times")
    _run = {"fetched": "", "quotes": {"corn": {"close": 0, "pctChange": 0.1,
                                               "wk52_hi": 0, "wk52_lo": 398.5}}}
    globals()["load"] = lambda n: _run if n == "prices.json" else None
    o, st = [], {}
    for _day, _close in (("2026-09-15", 534.0), ("2026-09-16", 536.0),
                         ("2026-09-21", 543.0), ("2026-09-22", 543.0)):
        _run["fetched"] = _day + "T00:00:00"
        _run["quotes"]["corn"].update(close=_close, wk52_hi=_close)
        board(o, st, [])
    heads = [i["headline"] for i in o]
    check(len(heads) == 3, "the 22 September repeat is gone and the three breaks remain")
    check(len(set(heads)) == 3, "and no two of them are the same sentence")
    check(heads[0] == "Corn closed at a 52-week high", "the first one is the break")
    check(all(h.startswith("Corn took its 52-week high to") for h in heads[1:]),
          "and the ones after it say where they took it")

    o = []
    globals()["load"] = lambda n: {"report_date": "2026-09-08", "corn": {
        "net": 414459, "prev": 401003, "max52": 414459, "min52": -187992}} if n == "cot.json" else None
    positioning(o, {}, [])
    check(len(o) == 1 and o[0]["id"].endswith(":max"), "net at max52 is a one-year extreme")

    o = []
    globals()["load"] = lambda n: {"report_date": "2026-09-08", "corn": {
        "net": 1000, "prev": -2000, "max52": 99999, "min52": -99999}} if n == "cot.json" else None
    positioning(o, {}, [])
    check(len(o) == 1 and o[0]["id"].endswith(":flip"), "crossing zero is a flip")

    o = []
    globals()["load"] = lambda n: {"in_season": True, "report_date": "2026-08-30", "corn": {
        "good_excellent": 57, "good_excellent_prev_week": 57}} if n == "crop-progress.json" else None
    ratings(o, {}, [])
    check(o == [], "an unchanged rating is not news")

    print("frost/freeze alerts: no invented threshold, no invented page")
    _wx = {"fetched": "2026-10-02T00:00:00+00:00", "alerts": [
        {"id": "urn:oid:2.49.0.1.840.0.abc", "event": "Freeze Warning",
         "area": "Boone, IA; Story, IA; Marshall, IA",
         "headline": "Freeze Warning issued for central Iowa",
         "effective": "2026-10-05T03:00:00-05:00", "expires": "2026-10-05T13:00:00-05:00",
         "url": "https://api.weather.gov/alerts/urn:oid:2.49.0.1.840.0.abc"}]}
    globals()["load"] = lambda n: _wx if n == "weather-alerts.json" else None
    o = []
    weather(o, {}, [])
    check(len(o) == 1, "an active alert with its required fields becomes one item")
    check(o[0]["kind"] == "weather", "tagged with its own kind, not folded into crop")
    check(o[0]["significance"] == "high", "a Warning is high significance")
    check(o[0]["url"].startswith("https://api.weather.gov/"),
          "links to NWS's own alert page -- no internal frost page exists to link to instead")
    check("Boone" in o[0]["detail"] or "central Iowa" in o[0]["detail"],
          "the detail names the real area, not a placeholder")

    # The same alert, polled again with nothing changed, must be the same id
    # (so build()'s own dedupe drops it) -- not re-published every ten minutes
    # for the whole week it stays active.
    o2 = []
    weather(o2, {}, [])
    check(o2[0]["id"] == o[0]["id"], "an unchanged alert keeps the same id across polls")

    # NWS extends or upgrades an alert under the same id -- that IS new
    # information and must read as a different id.
    _wx["alerts"][0]["expires"] = "2026-10-06T13:00:00-05:00"
    o3 = []
    weather(o3, {}, [])
    check(o3[0]["id"] != o[0]["id"], "an extended window is a different id, so it can publish again")

    o4 = []
    globals()["load"] = lambda n: {"fetched": "2026-10-02T00:00:00+00:00", "alerts": []} if n == "weather-alerts.json" else None
    weather(o4, {}, [])
    check(o4 == [], "an empty active-alerts list is a clean, honest no-news state")

    o5 = []
    globals()["load"] = lambda n: None
    weather(o5, {}, [])
    check(o5 == [], "a missing weather-alerts.json writes nothing rather than guessing")

    o = []
    globals()["load"] = lambda n: None
    for fn in DETECTORS:
        fn(o, {}, [])
    check(o == [], "every detector writes nothing when its file is missing")

    # A run that finds nothing must leave the files alone, or the wire commits a
    # timestamp to main every ten minutes and calls it news.
    _prior = {"updated": "2026-09-01T00:00:00+00:00",
              "items": [{"id": "x", "ts": "2026-09-01T12:00:00+00:00", "kind": "board",
                         "headline": "h", "detail": "d", "significance": "notable",
                         "url": "/", "source": "s", "day_only": True}]}
    globals()["load"] = lambda n: _prior if n == "news.json" else None
    _d, _a, _ch, _held = build()
    check(_ch is False, "an unchanged item list reports no change")
    check(_a == [], "and nothing was added")
    check(_d["updated"] == "2026-09-01T00:00:00+00:00",
          "updated keeps the moment the last item arrived, not the moment the job ran")

    print("an intraday Last is withdrawn; the close replaces it only if it still clears the bar")
    def _it(id_, h, d):
        return {"id": id_, "ts": id_.split(":")[1] + "T12:00:00+00:00", "kind": "board", "headline": h,
                "detail": d, "significance": "notable", "url": "/", "source": "s", "day_only": True}
    # THE 9 OCTOBER 2026 FILE: wheat filed at -2.6% off a 2pm print; it closed
    # $6.70 3/4, -12 1/2 (-1.83%), under the 2.5% bar.
    _prior2 = {"updated": "2026-10-09T18:00:00+00:00", "items": [
        _it("px:2026-10-09:wheat:move", "Wheat down 2.6% on the day", "Last $6.66, -17.5 cents on the session.")]}
    _px2 = {"fetched": "2026-10-09T19:05:00Z", "quotes": {
        "wheat": {"close": 670.75, "open": 683.25, "pctChange": -1.83, "netChange": -12.5,
                  "close_date": "2026-10-09", "wk52_hi": 795.0, "wk52_lo": 557.25}}}
    globals()["load"] = lambda n: _prior2 if n == "news.json" else (_px2 if n == "prices.json" else None)
    _d2, _a2, _ch2, _held2 = build()
    check(not [i for i in _d2["items"] if i["id"] == "px:2026-10-09:wheat:move"],
          "a move that closed under the bar is withdrawn, not left at its intraday number")
    check(_ch2 is True, "...and the withdrawal is a change the run writes")
    # The same day, a move that still clears the bar at the close replaces it.
    _px2["quotes"]["wheat"].update(close=666.0, pctChange=-2.53, netChange=-17.25)
    _d3, _a3, _ch3, _held3 = build()
    _w = [i for i in _d3["items"] if i["id"] == "px:2026-10-09:wheat:move"]
    check(len(_w) == 1 and _w[0]["detail"].startswith("Closed $6.66"), "the close replaces the intraday line")
    # THE 30 SEPTEMBER AND 1 OCTOBER 2026 DUPLICATES: corn and December corn,
    # same day, same numbers. One stays, under the named contract.
    _dup = [_it("px:2026-10-01:corn:move", "Corn down 3.8% on the day", "Settled $5.02, -20 cents on the session."),
            _it("px:2026-10-01:corn-dec:move", "December corn down 3.8% on the day", "Settled $5.02, -20 cents on the session."),
            _it("px:2026-10-01:wheat:move", "Wheat down 2.5% on the day", "Settled $6.77, -17.5 cents on the session.")]
    _t = tidy(_dup)
    check([i["id"] for i in _t] == ["px:2026-10-01:corn-dec:move", "px:2026-10-01:wheat:move"],
          "one contract's move under two names keeps the named one")
    check(len(tidy(_t)) == 2, "tidy is idempotent")

    # THE USDA ITEM FOLLOWS THE GRADES. The real Oct 9 shape: the Wire wrote
    # "All 2 scored figures" when two were graded; the page then graded seven,
    # four of them bearish. The next run must replace that item, not keep it.
    _old_w = {"id": "wasde:2026-10-09:inline", "kind": "usda",
              "headline": "October WASDE printed in line with the trade",
              "detail": "All 2 scored figures landed inside the trade's range.",
              "ts": "2026-10-09T12:00:00+00:00"}
    _wpi_w = {"latest_result": {"date": "2026-10-09", "report": "October WASDE",
              "metric_count": 7, "ungraded_count": 1, "in_line_count": 3, "all_in_line": False,
              "biggest_surprise": {"metric": "2026/27 corn ending stocks", "expected": 1.677,
                                   "actual": 1.849, "unit": "bil bu", "surprise": "bearish",
                                   "gap_pct": 10.3, "context": "inside the range, near the top"}}}
    _pw = {"updated": "2026-10-09T18:00:00+00:00", "items": [_old_w]}
    globals()["load"] = lambda n: _pw if n == "news.json" else (_wpi_w if n == "whats-priced-in.json" else None)
    _dw, _aw, _chw, _hw = build()
    _ws = [i for i in _dw["items"] if str(i["id"]).startswith("wasde:2026-10-09:")]
    check(len(_ws) == 1 and _ws[0]["id"] == "wasde:2026-10-09:2026/27 corn ending stocks",
          "a stale USDA item for the same report is replaced, not kept beside the new one")
    check(_ws and "3 of 7 graded figures in line. 1 had no trade estimate." in _ws[0]["detail"]
          and "+10.3% versus the survey average, inside the range, near the top" in _ws[0]["detail"],
          "the Wire counts the same graded set as What's Priced In: %r" % (_ws[0]["detail"] if _ws else None))
    # and an unchanged grade is not rewritten (no churn, no empty commit)
    _pw2 = {"updated": "x", "items": _dw["items"]}
    globals()["load"] = lambda n: _pw2 if n == "news.json" else (_wpi_w if n == "whats-priced-in.json" else None)
    _dw2, _aw2, _chw2, _ = build()
    check(not _aw2 and not _chw2, "the same grade on the next run changes nothing")

    check(_rfc822("2026-09-11T12:00:00+00:00") == "Fri, 11 Sep 2026 12:00:00 +0000",
          "_rfc822 renders a pubDate RSS readers accept")
    check(_rfc822("nonsense") is None, "_rfc822 invents nothing")
    x = rss({"updated": "2026-09-11T12:00:00+00:00", "items": [
        {"id": "a&b", "headline": 'Corn <up> 4"', "detail": "d", "url": "/corn-futures-prices",
         "ts": "2026-09-11T12:00:00+00:00", "source": "s"}]})
    check("&amp;" in x and "&lt;up&gt;" in x and "&quot;" in x, "rss escapes every field it prints")
    check("<pubDate>Fri, 11 Sep 2026" in x, "rss dates its items")
    import xml.dom.minidom as _m
    _m.parseString(x)
    check(True, "rss output parses as XML")

    print(f"build_news: all {ok} passed")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        _selftest(); raise SystemExit(0)
    data, added, changed, held = build()
    # the workflow reads this line rather than the file, so a run that writes
    # nothing cannot leave a stale "added" behind for the next one to act on
    print(f"added={len(added)}")
    for _h in held:
        print(f"  withheld  {_h}")
    if held:
        print(f"::notice title=wire withheld {len(held)}::"
              + "; ".join(held))
    if not changed:
        print(f"news.json: {data['count']} items, nothing new — files left alone")
        raise SystemExit(0)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1, ensure_ascii=False)
        f.write("\n")
    with open(RSS_PATH, "w", encoding="utf-8") as f:
        f.write(rss(data))
    print(f"news.json: {data['count']} items, {len(added)} new; news.xml written")
    for i in added:
        print(f"  [{i['significance']}] {i['headline']}")
