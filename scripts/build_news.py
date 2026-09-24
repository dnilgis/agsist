#!/usr/bin/env python3
"""
build_news.py — the live wire.

WHAT THIS IS FOR
----------------
The site already reads the primary sources: the WASDE watcher polls NASS inside
the release window, prices refresh every 30 minutes, the COT lands Friday
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

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "news.json")
KEEP = 200

CROPS = {
    "corn":      ("Corn",           "/corn-futures-prices"),
    "corn-dec":  ("December corn",  "/corn-futures-prices"),
    "beans":     ("Soybeans",       "/soybean-futures-prices"),
    "beans-nov": ("November beans", "/soybean-futures-prices"),
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
    """Board prices arrive in cents. Print them the way a farmer says them."""
    return f"${v/100:.2f}" if v is not None else None


def say_day(iso):
    """'2026-09-22' -> '22 September'. Returns None rather than guessing, so a
    caller with an unreadable stamp leaves the clause out instead of printing
    a date nobody can check."""
    try:
        return datetime.strptime(str(iso)[:10], "%Y-%m-%d").strftime("%-d %B")
    except (ValueError, TypeError):
        return None


# ── detectors ──────────────────────────────────────────────────────────────

def wasde(out, state, held):
    d = load("whats-priced-in.json")
    lr = (d or {}).get("latest_result")
    if not lr or not lr.get("date") or not lr.get("report"):
        return
    date, rpt = lr["date"], lr["report"]
    b = lr.get("biggest_surprise") or {}
    if lr.get("all_in_line") is True:
        out.append(item(
            f"wasde:{date}:inline", "usda",
            f"{rpt} printed in line with the trade",
            f"All {lr.get('metric_count')} scored figures landed inside the trade's range.",
            "notable", "/whats-priced-in", "USDA WASDE, graded against the pre-report survey", iso_day(date)))
        return
    if b.get("metric") and b.get("expected") is not None and b.get("actual") is not None:
        unit = (" " + b["unit"]) if b.get("unit") else ""
        out.append(item(
            f"wasde:{date}:{b['metric']}", "usda",
            f"{rpt}: {b['metric']} came in {b.get('surprise') or 'off the trade'}",
            f"Trade looked for {b['expected']}{unit}; USDA printed {b['actual']}{unit}"
            + (f" — {b['gap_pct']:+.1f}% versus the survey." if b.get("gap_pct") is not None else "."),
            "high", "/whats-priced-in", "USDA WASDE, graded against the pre-report survey", iso_day(date)))


def positioning(out, state, held):
    d = load("cot.json")
    if not d or not d.get("report_date"):
        return
    rd = d["report_date"]
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
                "high", "/cot", "CFTC Commitments of Traders", iso_day(rd)))
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
                "high", "/cot", "CFTC Commitments of Traders", iso_day(rd)))
        elif prev is not None and (prev < 0 <= net or net < 0 <= prev):
            side = "long" if net >= 0 else "short"
            out.append(item(
                f"cot:{rd}:{key}:flip", "positioning",
                f"Managed money flipped net {side} in {name.lower()}",
                f"Net {prev:+,} to {net:+,} contracts in a week, as of {rd}.",
                "notable", "/cot", "CFTC Commitments of Traders", iso_day(rd)))


def board(out, state, held):
    d = load("prices.json")
    q = (d or {}).get("quotes") or {}
    day = str((d or {}).get("fetched") or "")[:10]
    if not day:
        return
    px = state.setdefault("px", {})
    for key, (name, url) in CROPS.items():
        v = q.get(key)
        if not isinstance(v, dict):
            continue
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
        direction = "up" if pct > 0 else "down"
        nc = v.get("netChange")
        detail = f"Settled {cents(close)}" if close is not None else "Settled"
        if nc is not None:
            detail += f", {'+' if nc > 0 else ''}{nc:g} cents on the session"
        out.append(item(f"px:{day}:{key}:move", "board",
                        f"{name} {direction} {abs(pct):.1f}% on the day",
                        detail + ".",
                        "high" if abs(pct) >= MOVE_HIGH else "notable",
                        url, "CME settlement via the AGSIST board", iso_day(day)))


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


DETECTORS = (wasde, positioning, board, ratings)


def build():
    old = load("news.json") or {}
    kept = old.get("items") or []
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
    # An item already published keeps the words it was published with.
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
    changed = items != kept
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
           "    <title>AGSIST Wire — What Just Moved</title>",
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

    # 509.5 cents prints $5.09 everywhere else on the site (the corn page hero
    # says exactly that for this close), so the wire must not say $5.10.
    check(cents(509.5) == "$5.09", "cents() agrees with the price pages")
    check(cents(1284.0) == "$12.84", "cents() handles a bean price")
    check(iso_day("September 08, 2026") == "2026-09-08", "iso_day converts the COT's written date")
    check(iso_day("2026-09-11") == "2026-09-11", "iso_day passes ISO through")
    check(iso_day("2026-09-11T14:00:00Z") == "2026-09-11", "iso_day trims a timestamp to its day")
    check(iso_day("") is None and iso_day("not a date") is None, "iso_day invents nothing")
    d1 = item("x", "k", "h", "d", "notable", "/", "s", "2026-09-08")
    check(d1["day_only"] is True and d1["ts"].startswith("2026-09-08T12:00"),
          "a date-only source is flagged so no clock time is shown for it")
    d2 = item("y", "k", "h", "d", "notable", "/", "s")
    check(d2["day_only"] is False, "an item stamped now carries a real clock time")
    check(cents(None) is None, "cents() passes None through")

    o = []
    board_data = {"fetched": "2026-09-12T00:00:00", "quotes": {
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
