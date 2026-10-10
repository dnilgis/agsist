#!/usr/bin/env python3
"""
AGSIST — bake the answer into the title and the description.

WHY THIS EXISTS

The 2026-08-16 export said the traffic problem is not ranking any more. Google
impressions grew 230% in a month and click-through did not move at all: 1.30%
to 1.28%, with average position improving 13.5 to 10.3. The pages sitting in
the top ten are the ones being ignored.

    /usda-calendar      9,017 impressions  position 7.8   CTR 0.33%
    /usda-quick-stats   7,310              position 6.5   CTR 0.18%
    /cot                1,952              position 7.4   CTR 0.41%
    /breakeven          1,295              position 7.2   CTR 0.69%
    /crop-tour            471              position 7.0   CTR 0.42%

At position 7 a normal click-through is 2-4%. And the same shape shows in the
Bing-style report: 31 keywords holding a top-ten position with 24,682
impressions and 177 clicks between them.

The diagnosis is that these titles describe a TOOL and the searcher wants an
ANSWER. Somebody searching "wasde report schedule" against usda.gov in the same
result set does not pick "USDA Report Calendar 2026". They pick the one showing
the date.

So: lead with the answer, keep the keyword. Every title and description here is
computed from a live data file, which is the only way it can say a real number
and still be true next week. A page whose data is missing keeps whatever it has
-- this script never writes a placeholder, because a stale confident title is
worse than a dull accurate one.

RAILS

  - title <= TITLE_MAX chars, description <= DESC_MAX (the new-page checklist's
    160), both asserted before anything is written
  - no double quotes anywhere near a content= attribute
  - a computed date that has already passed is a bug, not a title: refuse
  - missing or unreadable data for a page skips that page loudly
  - a title may not claim a result the data file does not contain
  - --selftest runs offline against synthetic data and plants known failures

Stamps <title>, meta description, og:title, og:description, twitter:title and
twitter:description, so the SERP, the share card and the assistant summary all
say the same thing.
"""

import argparse
import json
import re
import sys
from datetime import date, datetime
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "data"
sys.path.insert(0, str(REPO / "scripts"))

TITLE_MAX = 68          # Google truncates around 600px; 68 chars is a safe ceiling
DESC_MAX = 160          # the site's own new-page checklist
SUFFIX = " | AGSIST"

MONTHS = ["January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]


def mdY(d):
    return f"{MONTHS[d.month - 1][:3]} {d.day}, {d.year}"


def span(a, b):
    """Aug 17-20, 2026 — not Aug 17, 2026-Aug 20, 2026. Descriptions have a
    160-character cap and a repeated year is the cheapest thing to give up."""
    if a.year == b.year and a.month == b.month:
        return f"{MONTHS[a.month - 1][:3]} {a.day}–{b.day}, {a.year}"
    if a.year == b.year:
        return f"{MONTHS[a.month - 1][:3]} {a.day}–{MONTHS[b.month - 1][:3]} {b.day}, {a.year}"
    return f"{mdY(a)}–{mdY(b)}"


# ---------------------------------------------------------------- context

def _load(name):
    p = DATA / name
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:                                     # noqa: BLE001
        return None


def next_unprinted_wasde(today, wasde=None):
    """The next WASDE that has not printed yet. On report day, once
    data/wasde.json records today's release, the next one is next: the title
    read "Next WASDE: Oct 9" all afternoon after the Oct 9 print."""
    import usda_dates
    from datetime import timedelta
    w = usda_dates.next_wasde(today)
    if w and w == today and str((wasde or {}).get("release") or "")[:10] == w.isoformat():
        w = usda_dates.next_wasde(w + timedelta(days=1))
    return w


def build_ctx(today):
    return {
        "today": today,
        "next_wasde": next_unprinted_wasde(today, _load("wasde.json")),
        "cot": _load("cot.json"),
        "state_stats": _load("state-stats.json"),
        "crop_tour": _load("crop-tour.json"),
        "prices": _load("prices.json"),
        "cond_yield": _load("cond-yield/fit.json"),
        "crop_progress": _load("crop-progress.json"),
        "basis": _load("transport/basis.json"),
        "fertilizer": _load("fertilizer.json"),
    }


# ---------------------------------------------------------------- builders
# Each returns (title, description) or None to skip the page. Raising is fine:
# main() catches, reports and leaves the page alone.

def seo_usda_calendar(c):
    w = c["next_wasde"]
    if not w:
        return None
    if w < c["today"]:
        raise ValueError(f"next_wasde returned {w}, already in the past")
    days = (w - c["today"]).days
    when = "today" if days == 0 else ("tomorrow" if days == 1 else f"in {days} days")
    return (f"Next WASDE: {mdY(w)} | USDA Report Calendar{SUFFIX}",
            f"The next WASDE lands {mdY(w)}, {when}. Every 2026 USDA report date "
            f"(WASDE, Crop Production, Grain Stocks, Cattle on Feed) with what "
            f"each one moves.")


def _cot_side(net):
    return "long" if net >= 0 else "short"


def seo_cot(c):
    d = c["cot"]
    if not d or "corn" in d and not isinstance(d.get("corn"), dict):
        return None
    corn = (d or {}).get("corn")
    if not corn or corn.get("net") is None:
        return None
    net = int(corn["net"])
    # The pipeline's side (fetch_cot.side_of): "flat" when |net| is under
    # flat_oi_pct of open interest -- the same band the page's cards use.
    side = corn.get("side") or _cot_side(net)
    k = abs(net) / 1000.0
    kk = f"{k:,.0f}k" if k >= 10 else f"{k:,.1f}k"
    rpt = d.get("report_date") or ""
    prev = corn.get("prev")
    move = ""
    if isinstance(prev, (int, float)):
        delta = net - int(prev)
        if delta:
            move = (f" Funds {'added' if (delta > 0) == (net >= 0) else 'cut'} "
                    f"{abs(delta):,} contracts week over week.")
    if side == "flat":
        head = (f"Managed money is near flat in corn (net {_cot_side(net)} {abs(net):,} "
                f"contracts, under {d.get('flat_oi_pct', 2.0)}% of open interest) as of {rpt}.")
    else:
        head = (f"Managed money is net {side} {abs(net):,} corn contracts as of "
                f"{rpt}.")
    tail = " Weekly CFTC ag positioning, 11 commodities."
    desc = head + move + tail
    if len(desc) > DESC_MAX:          # the move clause is the optional one
        desc = head + tail
    if side == "flat":
        return (f"Managed Money Is Near Flat In Corn: CFTC COT{SUFFIX}", desc)
    return (f"Managed Money Is Net {side.title()} Corn {kk}: CFTC COT{SUFFIX}", desc)


def seo_crop_tour(c):
    d = c["crop_tour"]
    if not d or not d.get("tour"):
        return None
    t = d["tour"]
    yr = t.get("year")
    start = date.fromisoformat(t["start"])
    end = date.fromisoformat(t["end"])
    today = c["today"]
    nights = d.get("nights") or []
    posted = [n for n in nights if n.get("posted")]

    if today < start:
        days = (start - today).days
        # WAS: f"starts in {days} days".
        #
        # That form is 69 to 70 characters once the year, the tail and the
        # suffix are on it, TITLE_MAX is 68, and check() refuses an over-long
        # title by skipping the page entirely. So through the whole run-up to
        # the 2026 tour this branch never wrote anything, and crop-tour.html
        # kept a title left over from an earlier bake. That is how a page ends
        # up saying "Night 1 Results" on a day when the builder was trying to
        # say "starts in 5 days": the refusal was correct and silent, and the
        # stale title outlived it.
        #
        # A date is the same answer at a fixed width, and it fits: 66.
        lead = ("starts tomorrow" if days == 1 else
                "starts today" if days == 0 else f"starts {mdY(start)[:-6]}")
        return (f"Pro Farmer Crop Tour {yr} {lead.title()}: Nightly Results{SUFFIX}",
                f"The {yr} Pro Farmer Crop Tour runs {span(start, end)}. "
                f"State numbers here every night, next to USDA's and ours, plus "
                f"how close the tour has actually been.")

    if today <= end or not posted:
        n = len(posted)
        # WAS: f"... Night {max(n,1)} Results ..."
        #
        # The max() was guarding against printing "Night 0". It did stop that.
        # It stopped it by printing a CLAIM instead of a placeholder: on the
        # first day of the 2026 tour, with all four nights still posted:false
        # and every corn and pods value null, this page went out titled
        # "Night 1 Results" and there were no results. Zero posted nights is
        # not an edge case to round away, it is the true state of the page for
        # the whole week before the tour and for the first day of it.
        #
        # Tested on n == 0, because that is the state it shipped wrong in.
        title = (f"Pro Farmer Crop Tour {yr}: Scout Results Nightly{SUFFIX}"
                 if n == 0 else
                 f"Pro Farmer Crop Tour {yr}: Night {n} Results{SUFFIX}")
        return (title,
                f"Pro Farmer Crop Tour {yr} results by state, posted each night "
                f"of {span(start, end)}, next to USDA's number and ours, "
                f"plus the tour's own accuracy record.")

    tour = (d.get("benchmarks") or {}).get("tour") or {}
    if tour.get("corn"):
        return (f"Pro Farmer Crop Tour {yr}: Corn {tour['corn']} bu/ac{SUFFIX}",
                f"Pro Farmer's {yr} national corn estimate is {tour['corn']} "
                f"bu/ac. Set against USDA's number and ours, with how close the "
                f"tour has actually been since 2015.")
    return (f"Pro Farmer Crop Tour {yr}: Results & Accuracy Record{SUFFIX}",
            f"Every night of the {yr} Pro Farmer Crop Tour by state, next to "
            f"USDA's number and ours, plus the record nobody publishes: how "
            f"close the tour has actually been.")


def seo_quick_stats(c):
    d = c["state_stats"]
    if not d or not d.get("stateStats"):
        return None
    ss = d["stateStats"]
    ia = ss.get("IA") or {}
    y = ia.get("corn_yield")
    if y is None:
        return None
    # label it exactly as the file does; never call a forecast a final
    kind = "forecast" if ia.get("forecast") else "final"
    yr = ia.get("year")
    return (f"Corn & Soybean Yields by State: USDA NASS Data{SUFFIX}",
            f"Iowa corn {y:g} bu/ac ({yr} {kind}). Yields, acres, production "
            f"and prices by state for corn, soybeans and wheat: USDA Quick "
            f"Stats, made readable and free.")


def seo_cond_yield(c):
    """The R-squared curve, read off the file instead of typed into the HTML.

    The hand-written description on this page said "ratings in week 35 explain
    59% of Iowa's final yield. By week 39: 64%." The file said 0.61 and 0.639
    on 2026-09-08, and both of those were computed with the current year
    inside its own fit (fixed 2026-09-13). A number in a search snippet that
    nothing recomputes goes stale silently and nobody sees it but strangers.
    """
    d = c.get("cond_yield")
    if not d:
        return None
    ia = (((d.get("crops") or {}).get("corn") or {}).get("states") or {}).get("IA")
    if not ia or not ia.get("weeks"):
        return None
    # The week that explains the most, computed — not a week somebody liked.
    wk, best = max(ia["weeks"].items(), key=lambda kv: kv[1].get("r2") or 0)
    r2 = best.get("r2")
    n = best.get("n")
    if r2 is None or not n:
        return None
    return ("Do Crop Ratings Predict Yield? The Real R²" + SUFFIX,
            f"Iowa corn: Good+Excellent in its best week (week {wk}) explains {r2 * 100:.0f}% of yield "
            f"deviation ({n} years, in-sample R²). Every state and week shown.")


def seo_conditions(c):
    """Today's national G+E against the same week last year. Both from the file."""
    d = c.get("crop_progress")
    if not d or not d.get("in_season"):
        return None
    corn = d.get("corn") or {}
    ge, prev = corn.get("good_excellent"), corn.get("good_excellent_prev_year")
    if ge is None:
        return None
    soy = (d.get("soybeans") or {}).get("good_excellent")
    # Built clause by clause: with no prior-year figure the old f-string left
    # "soybeans 57%,." in the live meta description.
    lead = f"US corn is {ge:g}% good to excellent"
    if prev is not None:
        lead += f" against {prev:g}% a year ago"
    if soy is not None:
        lead += f"; soybeans {soy:g}%"
    return (f"USDA Crop Conditions: Corn {ge:g}% Good-Excellent{SUFFIX}",
            f"{lead}. Every state's rating ranked "
            f"against the same week since 2000: a percentile, not a feel.")


def _px(prices, key):
    q = ((prices or {}).get("quotes") or {}).get(key) or (prices or {}).get(key)
    if isinstance(q, dict):
        for f in ("last", "close", "price", "px"):
            if isinstance(q.get(f), (int, float)):
                return float(q[f])
    return None


def seo_breakeven(c):
    px = _px(c["prices"], "corn")
    if px is None:
        return None
    dollars = px / 100.0 if px > 50 else px      # cents vs dollars
    return (f"Break-Even Price Calculator: Corn, Soybeans, Wheat{SUFFIX}",
            f"Corn is near ${dollars:.2f}. Enter your cost per acre and your yield "
            f"to get your break-even price per bushel, and the yield where the "
            f"board stops covering them.")


# ---------------------------------------------------------------- futures
# The biggest ranking gap in the 2026-08-16 export is one query cluster:
#
#     "cbot *"   3,205 impressions   1 click   average position 19.7
#
# 120 queries, one click between all of them. And the pattern inside the
# cluster is hard to unsee: the two pages whose TITLE carries the exchange
# name rank best, the two that do not rank worst.
#
#     corn    title says CBOT       corn queries      position 16.2
#     beans   title says CBOT       soybean queries   position 21.8
#     wheat   title says NOTHING    wheat queries     position 33.4, 0 clicks
#     cattle  title says NOTHING    cattle queries    position 28.6, 0 clicks
#
# Both silent pages carry the exchange 26 and 12 times in the body, so this is
# not a coverage problem, it is a title problem. Correlation across four pages
# is not proof, but putting the exact term somebody searched into the title is
# the cheapest thing on the list and the only one that costs nothing if wrong.
#
# These four take TITLE ONLY. seed_static.py already owns their meta
# description and rewrites it with the day's close every trading day; two
# writers on one field is how you get numbers that disagree in public.

FUTURES = {
    "corn-futures-prices.html":
        ("CBOT", "Corn", "corn", "Live Prices"),
    "soybean-futures-prices.html":
        ("CBOT", "Soybean", "beans", "Live Prices"),
    "wheat-futures-prices.html":
        ("CBOT", "Wheat", "wheat", "SRW & KC HRW"),
}

# Cattle is its own case twice over. seed_static.py does NOT write a
# description for it -- its DESC dict is the three grain pages only -- so this
# page owns both fields. And it quotes two different animals: a single number
# in the title would be read as whichever one the searcher came for. The
# biggest keyword in the whole Bing export is "feeder cattle futures", 3,665
# impressions at position 6.5, so that phrase goes in whole and both prices are
# named.
CATTLE_PAGE = "cattle-futures-prices.html"


def seo_cattle(c):
    live = _close(c["prices"], "cattle")
    feed = _close(c["prices"], "feeders")
    if live is None or feed is None:
        return None
    lab = _label(c["prices"], "cattle")
    when = f" {lab}" if lab else ""
    # "closed" only when the session had closed when the quote was fetched;
    # the 13:35 UTC freshness run lands in session (seed_static.quote_state is
    # the one rule for this, shared with the page body).
    from seed_static import quote_state, state_words
    st, asof = quote_state(_quote(c["prices"], "feeders"),
                           (c["prices"] or {}).get("fetched", ""), "cattle")
    verb = state_words(st)[0]
    stamp = ""
    if st is True and ", " in asof:            # "Oct 6, 11:50 a.m. CT"
        day, clock = asof.split(", ", 1)
        stamp = f" as of {clock} {day}"
    tail = (" CME futures every 15 min, with 5-year ranges, the feeder-to-live "
            "ratio and cost of gain." if not stamp else
            " CME futures every 15 min, 5-year ranges, cost of gain.")
    return (f"CME Feeder Cattle Futures ${feed:,.2f} & Live Cattle "
            f"${live:,.2f}{SUFFIX}",
            f"Feeder cattle {verb} ${feed:,.2f}, live cattle{when} "
            f"${live:,.2f}{stamp}.{tail}")


def _quote(prices, key):
    """The same contract seed_static.py seeds into the page body.

    CAUGHT IN TESTING, 2026-08-16: the bare key is a CONTINUOUS series. On this
    day quotes["beans"] was ZS=F repaired from beans-sep26 at 1176.25, while
    nearby["beans"] pointed at beans-aug26 at 1167.0. Reading the bare key and
    printing the nearby LABEL would have published

        CBOT Soybean Futures: Aug '26 $11.76

    -- September's price under August's name, in the title, on a page whose
    body said $11.67 three lines down. Corn and wheat happened to agree that
    day, so only soybeans exposed it.

    seed_static.py v1.4 already settled this: prefer <crop>-nearby, the true
    nearest dated contract. One rule per fact; this is that rule, not a second
    copy of it."""
    q = (prices or {}).get("quotes") or {}
    return q.get(f"{key}-nearby") or q.get(key) or {}


def _close(prices, key):
    q = _quote(prices, key)
    for f in ("close", "last", "price"):
        v = q.get(f)
        if isinstance(v, (int, float)):
            return float(v)
    return None


def _label(prices, key):
    n = ((prices or {}).get("nearby") or {}).get(key) or {}
    return n.get("label")


def make_futures(page):
    exch, crop, key, extra = FUTURES[page]

    def build(c):
        px = _close(c["prices"], key)
        lab = _label(c["prices"], key)
        if px is None or not lab:
            return None
        # grain boards quote in cents; cattle already quotes in dollars per cwt
        dollars = px / 100.0 if key != "cattle" else px
        money = f"${dollars:,.2f}"
        return (f"{exch} {crop} Futures: {lab} {money}, {extra}{SUFFIX}", None)

    build.__name__ = f"seo_{key}_futures"
    return build


# ---------------------------------------------------------------- data pages
# Added 2026-10-06 with the seed_static.py v1.5 body seeds. Same rails as
# everything above, plus one more: a STALENESS limit per file. The no-data rule
# keeps a page from being titled with a blank; it does not stop a page being
# titled with last month's number when the fetcher quietly stops. A file older
# than its limit is "no data" here, and the page keeps what it has.

def _d(s):
    try:
        return date.fromisoformat(str(s)[:10])
    except Exception:                                     # noqa: BLE001
        return None


def _too_old(d, today, days):
    return d is None or (today - d).days > days or d > today


def _usd(v):
    return f"${v:,.2f}"


def seo_markets(c):
    """The board, dated by the corn quote's own close date -- never the run
    date. A quote whose close is from another day is left out rather than
    printed beside a date it does not belong to (livestock and the S&P close
    a session apart from grains on a Monday)."""
    p = c.get("prices")
    if not p:
        return None
    corn = _quote(p, "corn")
    cd = _d(corn.get("close_date")) or _d(p.get("fetched"))
    if _too_old(cd, c["today"], 4) or _too_old(_d(p.get("fetched")), c["today"], 4):
        return None
    picks = []
    for key, name, grain in (("corn", "Corn", True), ("beans", "Soybeans", True),
                             ("wheat", "Wheat", True), ("cattle", "Live Cattle", False),
                             ("crude", "Crude", False)):
        q = _quote(p, key)
        v = q.get("close")
        if not isinstance(v, (int, float)) or _d(q.get("close_date") or cd) != cd:
            continue
        picks.append((key, name, _usd(v / 100.0 if grain else v), q.get("contract")))
    grains = [x for x in picks if x[0] in ("corn", "beans", "wheat")]
    if not grains or grains[0][0] != "corn":
        return None
    day = f"{MONTHS[cd.month - 1][:3]} {cd.day}"
    title = None
    for n in (3, 2, 1):
        cand = (f"Ag Markets {day}: " + ", ".join(f"{nm} {px}" for _, nm, px, _ in grains[:n]) + SUFFIX)
        if len(cand) <= TITLE_MAX:
            title = cand
            break
    if not title:
        return None
    head = (f"Last quotes {mdY(cd)}: " +
            ", ".join(f"{nm.lower() if i else nm}{(' ' + ct) if ct else ''} {px}"
                      for i, (_, nm, px, ct) in enumerate(picks)) + ".")
    tail = " Futures every 15 min, free."
    desc = head + tail if len(head + tail) <= DESC_MAX else head
    while len(desc) > DESC_MAX and len(picks) > 1:   # shed the least-searched quote
        picks = picks[:-1]
        desc = (f"Last quotes {mdY(cd)}: " +
                ", ".join(f"{nm.lower() if i else nm}{(' ' + ct) if ct else ''} {px}"
                          for i, (_, nm, px, ct) in enumerate(picks)) + ".")
    return title, desc


def _basis_rows(j, crop):
    ser = (j or {}).get("series") or {}
    newest = max((_d(s.get("date")) for s in ser.values() if _d(s.get("date"))), default=None)
    rows = []
    for k, s in ser.items():
        parts = k.split("|")
        if len(parts) != 3 or parts[0] != crop or parts[2] != "Elevator Bid":
            continue
        dt = _d(s.get("date"))
        # the page withholds a row more than 14 days behind the newest week
        if newest and dt and (newest - dt).days <= 14 and s.get("delta") is not None:
            rows.append((parts[1], s))
    return newest, sorted(rows, key=lambda r: r[1]["delta"])


def seo_basis(c):
    """Regional corn basis against its own 5-year same-week normal, counted
    with the page's own bands (more than 10 cents either way). Dated by the
    USDA week in the description; the title carries only the count."""
    j = c.get("basis")
    newest, rows = _basis_rows(j, "Corn")
    if not rows or _too_old(newest, c["today"], 21):
        return None
    under = sum(1 for _, s in rows if s["delta"] < -0.1)
    over = sum(1 for _, s in rows if s["delta"] > 0.1)
    n = len(rows)
    if under:
        title = f"Corn Basis vs Normal: Weak in {under} of {n} USDA Regions{SUFFIX}"
    elif over:
        title = f"Corn Basis vs Normal: Strong in {over} of {n} USDA Regions{SUFFIX}"
    else:
        title = f"Corn Basis vs Normal: All {n} USDA Regions Near Normal{SUFFIX}"
    name, w = rows[0]
    sign = lambda v: ("-" if v < 0 else "+") + f"${abs(v):.2f}"      # noqa: E731
    head = (f"Week of {mdY(newest)}: corn basis is over 10¢ under its 5-year normal in "
            f"{under} of {n} regions. Weakest: {name} {sign(w['latest'])} vs {sign(w['avg5'])}.")
    tail = " Barge rates that move it."
    desc = head + tail if len(head + tail) <= DESC_MAX else head
    return title, desc


FERT_TITLE_ORDER = (("Urea", "Urea"), ("MAP + Sulfur", "MAP"), ("Potash", "Potash"),
                    ("Amm. Sulfate", "AMS"))


def seo_fertilizer(c):
    """Dealer quotes are weekly at best and often a month apart, so the TITLE
    carries no date at all -- a date there would read as today's price. The
    as-of date the quotes themselves carry goes in the description, and only
    quotes from that newest date are named."""
    d = c.get("fertilizer")
    rows = (d or {}).get("prices") or []
    dated = [(r, _d(r.get("as_of"))) for r in rows if isinstance(r.get("price"), (int, float))]
    dated = [(r, a) for r, a in dated if a]
    if not dated:
        return None
    newest = max(a for _, a in dated)
    if _too_old(newest, c["today"], 120):
        return None
    cur = {r["name"]: r for r, a in dated if a == newest}
    named = [(short, cur[full]) for full, short in FERT_TITLE_ORDER if full in cur]
    if not named:
        return None
    title = None
    for n in range(len(named), 0, -1):
        bits = [f"{s} ${r['price']:,.0f}" + ("/ton" if i == 0 else "") for i, (s, r) in enumerate(named[:n])]
        cand = "Fertilizer Prices: " + ", ".join(bits) + SUFFIX
        if len(cand) <= TITLE_MAX:
            title = cand
            break
    if not title:
        return None
    parts = []
    for i, (s, r) in enumerate(named):
        bit = f"{s if s.isupper() else s.lower()} ${r['price']:,.0f}" + ("/ton" if i == 0 else "")
        pv, pa = r.get("prev"), _d(r.get("prev_as_of"))
        if i == 0 and isinstance(pv, (int, float)) and pv != r["price"] and pa:
            bit += f" (${pv:,.0f} on {MONTHS[pa.month - 1][:3]} {pa.day})"
        parts.append(bit)
    head = f"Midwest dealer quotes as of {mdY(newest)}: " + ", ".join(parts) + "."
    tail = " Cost per lb of N, P and K."
    desc = head + tail if len(head + tail) <= DESC_MAX else head
    if len(desc) > DESC_MAX:
        desc = f"Midwest dealer quotes as of {mdY(newest)}: " + ", ".join(parts[:2]) + "."
    return title, desc


PAGES = {
    "usda-calendar.html":    (seo_usda_calendar, frozenset({"title", "desc"})),
    "cot.html":              (seo_cot,           frozenset({"title", "desc"})),
    "crop-tour.html":        (seo_crop_tour,     frozenset({"title", "desc"})),
    "usda-quick-stats.html": (seo_quick_stats,   frozenset({"title", "desc"})),
    "breakeven.html":        (seo_breakeven,     frozenset({"title", "desc"})),
    # Added 2026-09-13. Both pages carried a HAND-TYPED number in their search
    # snippet: conditions-yield quoted an R-squared that had already drifted
    # from the file it describes, conditions quoted nothing current at all.
    "conditions-yield.html": (seo_cond_yield,    frozenset({"title", "desc", "alt"})),
    "conditions.html":       (seo_conditions,    frozenset({"title", "desc", "alt"})),
    # Added 2026-10-06. markets and fertilizer keep their descriptive
    # og:image:alt; basis repeated its old title there, so it follows the new.
    "markets.html":          (seo_markets,       frozenset({"title", "desc"})),
    "basis.html":            (seo_basis,         frozenset({"title", "desc", "alt"})),
    "fertilizer.html":       (seo_fertilizer,    frozenset({"title", "desc"})),
}
for _p in FUTURES:
    PAGES[_p] = (make_futures(_p), frozenset({"title"}))
PAGES[CATTLE_PAGE] = (seo_cattle, frozenset({"title", "desc"}))


# ---------------------------------------------------------------- stamping

_ENT = {"&": "&amp;", "<": "&lt;", ">": "&gt;"}


def esc(s):
    for a, b in _ENT.items():
        s = s.replace(a, b)
    return s


def check(title, desc, page, owns=frozenset({"title", "desc"})):
    pairs = [("title", title, TITLE_MAX)] if "title" in owns else []
    if "desc" in owns:
        pairs.append(("description", desc, DESC_MAX))
    for label, val, cap in pairs:
        if not val or not val.strip():
            raise ValueError(f"{page}: empty {label}")
        if '"' in val:
            raise ValueError(f'{page}: {label} contains a double quote, which '
                             f'would break the meta attribute: {val!r}')
        if len(val) > cap:
            raise ValueError(f"{page}: {label} is {len(val)} chars, cap is {cap}: {val!r}")
    return True


def _meta(attr, val):
    # these pages column-align their attributes, so the gap before content= is a
    # RUN of spaces. A single-space pattern matched 3 of 6 tags and said nothing.
    return re.compile(r'(<meta\s+' + attr + r'="' + val + r'"\s+content=")([^"]*)(")')


TAGS = [
    (re.compile(r"(<title>)(.*?)(</title>)", re.S), "title"),
    (_meta("name", "description"), "desc"),
    (_meta("property", "og:title"), "title"),
    (_meta("property", "og:description"), "desc"),
    (_meta("name", "twitter:title"), "title"),
    (_meta("name", "twitter:description"), "desc"),
    # og:image:alt repeats the title on pages that own it ("alt"). It was left
    # out of the stamp list, so /conditions said "Corn 57%" in the share-card
    # alt while its title said 54%. Opt-in per page: on pages whose alt
    # describes the image rather than repeating the title it is left alone.
    (_meta("property", "og:image:alt"), "alt"),
]
EXPECT_TAGS = 6


def stamp(text, title, desc, owns=frozenset({"title", "desc"})):
    vals = {"title": esc(title or ""), "desc": esc(desc or ""), "alt": esc(title or "")}
    n = 0
    for pat, which in TAGS:
        if which not in owns:
            continue
        new, cnt = pat.subn(lambda m: m.group(1) + vals[which] + m.group(3), text, count=1)
        if cnt:
            text, n = new, n + 1
    return text, n


def expected_tags(owns):
    return sum(1 for _, which in TAGS if which in owns)


# ---------------------------------------------------------------- main

def run(today, dry=False, only=None):
    ctx = build_ctx(today)
    changed, skipped = [], []
    for page, (fn, owns) in PAGES.items():
        if only and page != only:
            continue
        p = REPO / page
        if not p.exists():
            skipped.append((page, "file missing")); continue
        try:
            got = fn(ctx)
        except Exception as exc:                          # noqa: BLE001
            skipped.append((page, f"builder raised: {exc}")); continue
        if not got:
            skipped.append((page, "no data — left alone")); continue
        title, desc = got
        try:
            check(title, desc, page, owns)
        except ValueError as exc:
            skipped.append((page, str(exc))); continue
        src = p.read_text(encoding="utf-8")
        out, n = stamp(src, title, desc, owns)
        want = expected_tags(owns)
        if n != want:
            skipped.append((page, f"stamped {n} of {want} tags — markup changed; "
                                  f"refusing to half-update"))
            continue
        print(f"\n{page}  ({n} tags, owns {'+'.join(sorted(owns))})")
        if title:
            print(f"  title [{len(title):>3}] {title}")
        if desc:
            print(f"  desc  [{len(desc):>3}] {desc}")
        if not dry and out != src:
            p.write_text(out, encoding="utf-8")
            changed.append(page)
        elif out == src:
            print("  (unchanged)")
    print("\n" + "-" * 60)
    print(f"changed {len(changed)}: {', '.join(changed) or 'none'}")
    for pg, why in skipped:
        print(f"skipped {pg}: {why}")
    return 0


def selftest():
    fails = []

    def ck(name, ok, detail=""):
        print(("  ok   " if ok else "  FAIL ") + name + (f"  — {detail}" if not ok and detail else ""))
        if not ok:
            fails.append(name)

    T = date(2026, 8, 16)
    ctx = {"today": T, "next_wasde": date(2026, 9, 11),
           "cot": {"report_date": "August 11, 2026",
                   "corn": {"net": 125875, "prev": 144821}},
           "crop_tour": {"tour": {"year": 2026, "start": "2026-08-17", "end": "2026-08-20"},
                         "nights": [{"posted": False}] * 4, "benchmarks": {}},
           "state_stats": {"stateStats": {"IA": {"corn_yield": 216.0, "year": 2026,
                                                 "forecast": True}}},
           # The week with the HIGHEST r2 must win, not the last one in the
           # dict and not a week somebody liked: 39 here, not 22.
           "cond_yield": {"crops": {"corn": {"states": {"IA": {"weeks": {
               "22": {"r2": 0.003, "n": 26}, "35": {"r2": 0.59, "n": 26},
               "39": {"r2": 0.64, "n": 26}}}}}}},
           "crop_progress": {"in_season": True,
                             "corn": {"good_excellent": 57, "good_excellent_prev_year": 66},
                             "soybeans": {"good_excellent": 58}},
           "basis": {"series": {
               "Corn|Iowa|Elevator Bid": {"latest": -0.432, "date": "2026-08-14", "avg5": -0.308, "delta": -0.124},
               "Corn|Minnesota|Elevator Bid": {"latest": -0.912, "date": "2026-08-14", "avg5": -0.448, "delta": -0.464},
               "Corn|Indiana|Elevator Bid": {"latest": -0.202, "date": "2026-08-14", "avg5": -0.334, "delta": 0.132},
               "Corn|Ohio|Elevator Bid": {"latest": -0.9, "date": "2026-07-01", "avg5": -0.3, "delta": -0.6},
               "Soybeans|Iowa|Elevator Bid": {"latest": -0.47, "date": "2026-08-14", "avg5": -0.6, "delta": 0.13}}},
           "fertilizer": {"prices": [
               {"name": "Urea", "price": 590, "prev": 695, "as_of": "2026-08-01", "prev_as_of": "2026-07-20"},
               {"name": "Potash", "price": 460, "prev": 460, "as_of": "2026-08-01"},
               {"name": "MAP + Sulfur", "price": 930, "prev": 930, "as_of": "2026-08-01"},
               {"name": "Amm. Sulfate", "price": 460, "as_of": "2026-08-01"},
               {"name": "K-Mag Premium", "price": 650, "as_of": "2026-06-20"}]},
           "prices": {"fetched": "2026-08-14T20:05:00Z",
                      "quotes": {"corn": {"close": 459.25}, "beans": {"close": 1176.25},
                                 "wheat": {"close": 674.0}, "cattle": {"close": 223.75},
                                 "feeders": {"close": 341.275}},
                      "nearby": {"corn": {"label": "Sep '26"}, "beans": {"label": "Aug '26"},
                                 "wheat": {"label": "Sep '26"}, "cattle": {"label": "Aug '26"}}}}

    print("titles lead with the answer")
    t, d = seo_usda_calendar(ctx)
    ck("WASDE title leads with the date", t.startswith("Next WASDE: Sep 11, 2026"), t)
    ck("WASDE title keeps the keyword", "USDA Report Calendar" in t, t)
    ck("WASDE description counts the days", "in 26 days" in d, d)

    t, d = seo_cot(ctx)
    ck("COT title states the position", "Net Long Corn 126k" in t, t)
    ck("COT description carries the report date", "August 11, 2026" in d, d)

    t, d = seo_crop_tour(ctx)
    ck("tour title says it starts tomorrow", "Starts Tomorrow" in t, t)

    ctx2 = dict(ctx, today=date(2026, 8, 19),
                crop_tour=dict(ctx["crop_tour"],
                               nights=[{"posted": True}, {"posted": True}, {"posted": False}, {"posted": False}]))
    t2, _ = seo_crop_tour(ctx2)
    ck("mid-tour title counts posted nights", "Night 2 Results" in t2, t2)

    ctx3 = dict(ctx, today=date(2026, 8, 22),
                crop_tour=dict(ctx["crop_tour"], nights=[{"posted": True}] * 4,
                               benchmarks={"tour": {"corn": 179.4}}))
    t3, _ = seo_crop_tour(ctx3)
    ck("after the tour the title carries the number", "Corn 179.4 bu/ac" in t3, t3)

    print("\nhonesty")
    t, d = seo_cond_yield(ctx)
    ck("cond-yield picks the strongest week, not the first", "week 39" in d and "64%" in d)
    ck("cond-yield names the sample size", "26 years" in d)
    ck("cond-yield skips when the file is missing",
       seo_cond_yield(dict(ctx, cond_yield=None)) is None)
    t, d = seo_conditions(ctx)
    ck("conditions carries this week's G+E and last year's", "57%" in d and "66%" in d)
    cp = dict(ctx["crop_progress"], corn={"good_excellent": 54, "good_excellent_prev_year": None},
              soybeans={"good_excellent": 57})
    _t, d0 = seo_conditions(dict(ctx, crop_progress=cp))
    ck("conditions with no prior-year figure reads cleanly (no ',.')",
       ",." not in d0 and "soybeans 57%." in d0 and "a year ago" not in d0, d0)
    alt_html = ('<title>Old</title><meta name="description" content="o">'
                '<meta property="og:title" content="o"><meta property="og:description" content="o">'
                '<meta name="twitter:title" content="o"><meta name="twitter:description" content="o">'
                '<meta property="og:image:alt" content="USDA Crop Conditions: Corn 57%">')
    _o, _n = stamp(alt_html, "Corn 54%", "D", frozenset({"title", "desc", "alt"}))
    ck("og:image:alt follows the title on pages that own it",
       _n == 7 and 'og:image:alt" content="Corn 54%"' in _o and "57%" not in _o, _o)
    ck("og:image:alt left alone on pages that do not own it",
       "57%" in stamp(alt_html, "Corn 54%", "D")[0])
    ck("conditions stays quiet out of season",
       seo_conditions(dict(ctx, crop_progress={"in_season": False})) is None)

    t, d = seo_quick_stats(ctx)
    ck("a forecast is called a forecast, never a final", "2026 forecast" in d, d)
    ctx4 = dict(ctx, state_stats={"stateStats": {"IA": {"corn_yield": 211.0, "year": 2025,
                                                        "forecast": False}}})
    _, d4 = seo_quick_stats(ctx4)
    ck("a final is called a final", "2025 final" in d4, d4)

    # THE 2026-08-17 BUG. Day one of the tour, nothing announced yet, and the
    # title said "Night 1 Results". Every assertion below is on the state that
    # shipped wrong, not on the state that happened to work.
    for label, day in (("day one of the tour", date(2026, 8, 17)),
                       ("mid-tour before that night's meeting", date(2026, 8, 19))):
        t0, d0 = seo_crop_tour(dict(ctx, today=day,
                                    crop_tour=dict(ctx["crop_tour"],
                                                   nights=[{"posted": False}] * 4)))
        ck(f"{label} claims no night", re.search(r"Night \d", t0) is None, t0)
        ck(f"{label} still names the tour and the year",
           "Pro Farmer Crop Tour 2026" in t0, t0)
        ck(f"{label} description promises a schedule, not a result",
           "posted each night" in d0, d0)
    t1, _ = seo_crop_tour(dict(ctx, today=date(2026, 8, 17),
                               crop_tour=dict(ctx["crop_tour"],
                                              nights=[{"posted": True}, {"posted": False},
                                                      {"posted": False}, {"posted": False}])))
    ck("the night the first one posts, Night 1 is earned", "Night 1 Results" in t1, t1)
    ck("the pre-tour title fits the cap on every day of the run-up",
       all(len(seo_crop_tour(dict(ctx, today=date(2026, 8, d_)))[0]) <= TITLE_MAX
           for d_ in range(1, 17)),
       max((seo_crop_tour(dict(ctx, today=date(2026, 8, d_)))[0]
            for d_ in range(1, 17)), key=len))
    ck("no reachable state prints Night 0",
       all("Night 0" not in (seo_crop_tour(dict(ctx, today=date(2026, 8, d_),
                                                crop_tour=dict(ctx["crop_tour"],
                                                               nights=[{"posted": False}] * 4)))[0])
           for d_ in (17, 18, 19, 20, 21, 22)))

    print("\nusda calendar rolls at the print")
    ck("report morning, not printed: Oct 9 is next",
       next_unprinted_wasde(date(2026, 10, 9), {"release": "2026-09-11"}) == date(2026, 10, 9))
    ck("report day, printed: Nov 10 is next",
       next_unprinted_wasde(date(2026, 10, 9), {"release": "2026-10-09"}) == date(2026, 11, 10))
    ck("the day after: Nov 10, printed or not",
       next_unprinted_wasde(date(2026, 10, 10), None) == date(2026, 11, 10))
    ck("the title names it", seo_usda_calendar(dict(ctx, today=date(2026, 10, 10),
                                                     next_wasde=date(2026, 11, 10)))[0].startswith("Next WASDE: Nov 10, 2026"))

    print("\nrails")
    try:
        seo_usda_calendar(dict(ctx, next_wasde=date(2026, 1, 1)))
        ck("a WASDE date in the past raises", False, "it returned a title")
    except ValueError:
        ck("a WASDE date in the past raises", True)
    ck("no data means skip, not a placeholder",
       seo_cot(dict(ctx, cot=None)) is None and
       seo_quick_stats(dict(ctx, state_stats=None)) is None and
       seo_breakeven(dict(ctx, prices=None)) is None)
    try:
        check('He said "hello"', "fine", "x.html"); ck("a double quote is refused", False)
    except ValueError:
        ck("a double quote is refused", True)
    try:
        check("t" * (TITLE_MAX + 1), "fine", "x.html"); ck("an over-long title is refused", False)
    except ValueError:
        ck("an over-long title is refused", True)
    try:
        check("fine", "d" * (DESC_MAX + 1), "x.html"); ck("an over-long description is refused", False)
    except ValueError:
        ck("an over-long description is refused", True)

    print("\nevery live builder fits the caps")
    for page, (fn, owns) in PAGES.items():
        got = fn(ctx)
        if not got:
            ck(f"{page} produced output", False, "returned None"); continue
        try:
            check(got[0], got[1], page, owns); ck(f"{page} within caps", True)
        except ValueError as exc:
            ck(f"{page} within caps", False, str(exc))
    # every crop-tour branch, not just the one today's date happens to hit
    for label, day, nights, bench in (
            ("before", date(2026, 8, 14), [{"posted": False}] * 4, {}),
            ("starts tomorrow", date(2026, 8, 16), [{"posted": False}] * 4, {}),
            ("day one, nothing posted", date(2026, 8, 17), [{"posted": False}] * 4, {}),
            ("mid-tour, two posted", date(2026, 8, 19),
             [{"posted": True}, {"posted": True}, {"posted": False}, {"posted": False}], {}),
            ("over, no national number", date(2026, 8, 22), [{"posted": True}] * 4, {}),
            ("over, national number in", date(2026, 8, 22), [{"posted": True}] * 4,
             {"tour": {"corn": 179.4}})):
        got = seo_crop_tour(dict(ctx, today=day,
                                 crop_tour=dict(ctx["crop_tour"], nights=nights,
                                                benchmarks=bench)))
        try:
            check(got[0], got[1], f"crop-tour.html ({label})")
            ck(f"crop tour '{label}' within caps [{len(got[0])}]", True)
        except ValueError as exc:
            ck(f"crop tour '{label}' within caps", False, str(exc))

    print("\nfutures titles carry the exchange the query uses")
    for page, want in (("wheat-futures-prices.html", "CBOT Wheat Futures: Sep '26 $6.74"),
                       ("corn-futures-prices.html", "CBOT Corn Futures: Sep '26 $4.59"),
                       ("soybean-futures-prices.html", "CBOT Soybean Futures: Aug '26 $11.76"),
                       ("cattle-futures-prices.html", "CME Feeder Cattle Futures $341.27")):
        t, d = PAGES[page][0](ctx)
        ck(f"{page.split('-')[0]} title leads with the exchange and the price",
           t.startswith(want), t)
        if page != CATTLE_PAGE:
            ck(f"{page.split('-')[0]} writes no description", d is None)
    ck("grain boards convert from cents, cattle does not",
       "$4.59" in PAGES["corn-futures-prices.html"][0](ctx)[0] and
       "$223.75" in PAGES[CATTLE_PAGE][0](ctx)[0])
    ck("the cattle title names BOTH animals with BOTH prices",
       all(x in PAGES[CATTLE_PAGE][0](ctx)[0]
           for x in ("Feeder Cattle Futures", "$341.27", "Live Cattle", "$223.75")),
       PAGES[CATTLE_PAGE][0](ctx)[0])
    ck("cattle is skipped if only one of the two prices is there",
       PAGES[CATTLE_PAGE][0](dict(ctx, prices={"quotes": {"cattle": {"close": 223.75}}})) is None)
    trap = dict(ctx, prices={
        "quotes": {"beans": {"close": 1176.25},            # continuous, Sep
                   "beans-nearby": {"close": 1167.0}},     # the dated front, Aug
        "nearby": {"beans": {"label": "Aug '26"}}})
    ck("the price matches the contract the label names",
       "$11.67" in PAGES["soybean-futures-prices.html"][0](trap)[0],
       PAGES["soybean-futures-prices.html"][0](trap)[0])
    ck("...and never the continuous series under a dated label",
       "$11.76" not in PAGES["soybean-futures-prices.html"][0](trap)[0])
    ck("a futures page with no price is skipped, not titled with a blank",
       PAGES["wheat-futures-prices.html"][0](dict(ctx, prices=None)) is None)
    ck("a futures page with a price but no contract label is skipped",
       PAGES["wheat-futures-prices.html"][0](
           dict(ctx, prices={"quotes": {"wheat": {"close": 674.0}}})) is None)

    print("\nno field has two writers")
    # seed_static.py owns the meta description on the futures pages and rewrites
    # it with the day's close. If bake_seo ever claims desc on the same page the
    # two will disagree in public on some Tuesday. Assert they cannot overlap.
    import importlib.util as _ilu
    _sp = _ilu.spec_from_file_location("seed_static", REPO / "scripts" / "seed_static.py")
    try:
        _ss = _ilu.module_from_spec(_sp); _sp.loader.exec_module(_ss)
        theirs = set(getattr(_ss, "DESC", {}))
    except Exception as exc:                                  # noqa: BLE001
        theirs = set(FUTURES)                                 # assume the worst
        print(f"  (could not import seed_static: {exc}; assuming it owns {len(theirs)})")
    mine = {pg for pg, (_, owns) in PAGES.items() if "desc" in owns}
    ck("bake_seo writes no description seed_static also writes",
       not (mine & theirs), f"overlap: {sorted(mine & theirs)}")
    ck("every grain futures page is title-only here",
       all("desc" not in PAGES[p][1] for p in FUTURES))
    ck("cattle owns its description because nothing else writes one",
       "desc" in PAGES[CATTLE_PAGE][1] and CATTLE_PAGE not in theirs)

    def _cat(fetched, cd):
        q = {"close": 341.275, "close_date": cd}
        return seo_cattle(dict(ctx, prices={"fetched": fetched, "quotes": {
            "cattle": {"close": 223.75, "close_date": cd}, "feeders": q}}))[1]
    d_in = _cat("2026-10-06T16:50:00Z", "2026-10-06")
    ck("an in-session cattle quote is not called a close",
       "closed" not in d_in and "last traded" in d_in and "CT" in d_in, d_in)
    d_cl = _cat("2026-10-06T20:35:00Z", "2026-10-06")
    ck("an after-close cattle quote says closed", "Feeder cattle closed $341.27" in d_cl, d_cl)
    d_wk = _cat("2026-10-10T13:35:00Z", "2026-10-09")
    ck("a Saturday run on Friday's quote says closed", "closed" in d_wk, d_wk)

    print("\ndata pages: dated by the data, silent when it is old")
    t, d = seo_markets(ctx)
    ck("markets title carries the data's date and the corn price",
       t.startswith("Ag Markets Aug 14: Corn $4.59"), t)
    ck("markets description dates the quotes", "Aug 14, 2026" in d, d)
    ck("markets is skipped when the price file is a week old",
       seo_markets(dict(ctx, today=date(2026, 8, 24))) is None)
    mixed = dict(ctx, prices=dict(ctx["prices"], quotes=dict(
        ctx["prices"]["quotes"], cattle={"close": 223.75, "close_date": "2026-08-13"})))
    ck("a quote from another session is not printed under the board's date",
       "223.75" not in seo_markets(mixed)[1], seo_markets(mixed)[1])
    t, d = seo_basis(ctx)
    ck("basis counts the weak regions with the page's 10c band",
       "Weak in 2 of 3" in t, t)
    ck("basis leaves out a region USDA has not posted for weeks",
       "Ohio" not in d and "of 3 regions" in d, d)
    ck("basis description carries the USDA week", "Aug 14, 2026" in d, d)
    ck("basis is skipped when the newest week is a month old",
       seo_basis(dict(ctx, today=date(2026, 9, 20))) is None)
    ck("basis skipped with no file", seo_basis(dict(ctx, basis=None)) is None)
    t, d = seo_fertilizer(ctx)
    ck("fertilizer title names this round's quotes", "Urea $590/ton" in t, t)
    ck("fertilizer title carries NO date (weekly/monthly data)",
       not re.search(r"\b(20\d\d|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b", t), t)
    ck("fertilizer description carries the quotes' own as-of date",
       "as of Aug 1, 2026" in d and "Aug 16" not in d, d)
    ck("fertilizer leaves out a quote from an older round", "650" not in t + d)
    ck("fertilizer is skipped when the newest quote is over 120 days old",
       seo_fertilizer(dict(ctx, today=date(2026, 12, 15))) is None)
    ck("fertilizer skipped with no file", seo_fertilizer(dict(ctx, fertilizer=None)) is None)

    print("\nstamping")
    html = ('<title>Old</title>\n<meta name="description" content="old">\n'
            '<meta property="og:title" content="old">\n'
            '<meta property="og:description" content="old">\n'
            '<meta name="twitter:title" content="old">\n'
            '<meta name="twitter:description" content="old">')
    out, n = stamp(html, "New & Fresh", "Desc & more")
    ck("all six tags stamped", n == 6, str(n))
    _t, _n = stamp(html, "T", "D", frozenset({"title"}))
    ck("title-only ownership stamps 3 tags and leaves the descriptions alone",
       _n == 3 and 'content="old"' in _t, f"{_n} tags")
    aligned = ('<title>Old</title>\n<meta name="description"      content="old">\n'
               '<meta property="og:title"        content="old">\n'
               '<meta property="og:description"  content="old">\n'
               '<meta name="twitter:title"       content="old">\n'
               '<meta name="twitter:description" content="old">')
    ck("column-aligned attributes stamp too (the live markup)",
       stamp(aligned, "T", "D")[1] == EXPECT_TAGS, str(stamp(aligned, "T", "D")[1]))
    ck("ampersands escaped", out.count("&amp;") == 6, out)
    ck("idempotent", stamp(out, "New & Fresh", "Desc & more")[0] == out)

    print()
    if fails:
        print(f"{len(fails)} FAILED: " + "; ".join(fails))
        return 1
    print("all bake_seo checks pass")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--page", default=None)
    ap.add_argument("--today", default=None, help="YYYY-MM-DD, for tests")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    today = date.fromisoformat(a.today) if a.today else date.today()
    return run(today, dry=a.dry_run, only=a.page)


if __name__ == "__main__":
    sys.exit(main())
