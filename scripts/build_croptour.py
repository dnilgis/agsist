#!/usr/bin/env python3
"""
build_croptour.py  —  AGSIST /crop-tour page baker.

Reads data/crop-tour.json and bakes every dynamic region of crop-tour.html
between stable marker comments: the verdict hero, the nightly results board,
the three-way benchmark box, the historical accuracy table, and the stamps.

Everything lands as STATIC HTML — no client fetch — so the page is complete
for readers, search engines, and JS-blind AI crawlers on first byte. That
matters here: the tour is a 4-day search spike and crawlers arrive fast.

Derived statistics (mean absolute error, who-was-closer counts, average
bias) are COMPUTED from the history rows, never hand-typed, so adding a
year updates every claim on the page at once.

Update flow:
    1. edit data/crop-tour.json  (fill a night's corn/pods, or add a year)
    2. run:  python3 scripts/build_croptour.py

Idempotent. Self-validating: refuses to write if the result fails the gauntlet.

Usage:
    python3 scripts/build_croptour.py            # bake in place
    python3 scripts/build_croptour.py --check    # verify only (CI-safe)
    python3 scripts/build_croptour.py --selftest # arithmetic + claim checks
    python3 scripts/build_croptour.py --html PATH --json PATH


2026-08-17 — WHY THE BIAS SENTENCE CHANGED
------------------------------------------
This file printed, for months:

    it came in under the final yield in 7 of 11 years, by an average of
    2.6 bushels

Both numbers were real and neither belonged to that sentence. `tour_low` (7)
counts the years the tour finished below the final. `tour_bias` (-2.6) is the
mean signed error across ALL ELEVEN years, high ones included. Joining them
reads as "in those seven years it was 2.6 low", which is false: in those seven
years it was 5.3 low. The sentence halved the tour's own low bias, in the one
week of the year anybody reads the page, and it said the same thing inside the
FAQPage JSON-LD, where Google reads it.

That is a whole class of bug — a correct statistic wired to the wrong clause —
and it is invisible to a test that only asks whether the arithmetic is right,
because the arithmetic WAS right. So `--selftest` below does not just recompute
the means; it asserts that every number appearing in a rendered claim is one
this module actually derived for that claim. See `_check_claim_numbers`.

The other half of the same bug: "it ran high three times, once by 5.5 bushels"
was hand-typed into a file whose docstring promises derived statistics are
"never hand-typed". True in 2026, wrong the first year the tour runs high.
Both figures are computed now.
"""

import argparse
import json
import re
import sys
from datetime import date, datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path

# The tour lives on Central time. Every nightly meeting, every "about 8pm
# Central", every phase boundary is a Central-time fact.
TOUR_TZ = "America/Chicago"


def today_tour():
    """Today's date in TOUR_TZ. Never silently UTC.

    date.today() on a GitHub Actions runner is UTC, so between 7:00pm Central
    and midnight -- exactly the window the nightly numbers land in -- it
    returns TOMORROW. That walked the ct-night--next highlight and the
    "about 8pm Central" label off tonight's row and onto the next one, on
    every push that published a night's results.

    If the zone is unavailable this raises instead of falling back, because a
    silent fallback to UTC is the bug it is here to prevent.
    """
    try:
        from zoneinfo import ZoneInfo
        tz = ZoneInfo(TOUR_TZ)
    except Exception as e:                                    # pragma: no cover
        raise SystemExit(
            f"build_croptour.py: cannot load {TOUR_TZ} ({type(e).__name__}: {e}). "
            "Refusing to bake, because 'tonight' would silently mean UTC and the "
            "page would move the nightly highlight a day early after 7pm Central. "
            "Fix: `pip install tzdata`, or install the system tzdata package, or "
            "pass --today YYYY-MM-DD explicitly.")
    return datetime.now(timezone.utc).astimezone(tz).date()

MONTHS = ["", "January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]
ABBR = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep",
        "Oct", "Nov", "Dec"]


def esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


def pretty(iso):
    y, m, d = (int(x) for x in iso.split("-"))
    return f"{MONTHS[m]} {d}, {y}"


def short(iso):
    y, m, d = (int(x) for x in iso.split("-"))
    return f"{ABBR[m]} {d}"


# ── statistics ────────────────────────────────────────────────────────────

def stats(history):
    """Mean absolute error, signed bias, and head-to-head counts vs the final.

    Only years carrying BOTH a tour number and a USDA final are scored, so a
    partially-filled current year can sit in the data without polluting the
    record.
    """
    rows = []
    for h in history:
        if h.get("tour_corn") is None or h.get("usda_final_corn") is None:
            continue
        if h.get("usda_aug_corn") is None:
            continue
        te = h["tour_corn"] - h["usda_final_corn"]
        ue = h["usda_aug_corn"] - h["usda_final_corn"]
        rows.append({**h, "tour_err": te, "usda_err": ue,
                     "winner": "tour" if abs(te) < abs(ue)
                     else ("usda" if abs(ue) < abs(te) else "tie")})
    n = len(rows)
    if not n:
        raise AssertionError("no scoreable history rows")
    tour_mae = sum(abs(r["tour_err"]) for r in rows) / n
    usda_mae = sum(abs(r["usda_err"]) for r in rows) / n
    tour_bias = sum(r["tour_err"] for r in rows) / n
    usda_bias = sum(r["usda_err"] for r in rows) / n
    tour_wins = sum(1 for r in rows if r["winner"] == "tour")
    usda_wins = sum(1 for r in rows if r["winner"] == "usda")

    # THE THREE POPULATIONS, KEPT APART ON PURPOSE.
    #
    #   tour_bias      mean signed error over ALL n years          (a net lean)
    #   tour_low_mean  mean shortfall over ONLY the years it ran low
    #   tour_high_*    the same for the years it ran high
    #
    # These are different numbers about different sets of years and they are
    # not interchangeable. Naming them apart is the fix; see the module
    # docstring for what happened when they were not.
    lows = [r["tour_err"] for r in rows if r["tour_err"] < 0]
    highs = [r["tour_err"] for r in rows if r["tour_err"] > 0]
    ties = [r["tour_err"] for r in rows if r["tour_err"] == 0]
    # A year present in `history` but not scoreable (a missing usda_aug_corn,
    # say) is dropped silently above. The lead sentence says "the last N tours
    # (first-last)", which is a lie if a year inside that span was skipped.
    span = [h for h in history if rows[0]["year"] <= h["year"] <= rows[-1]["year"]]
    skipped = len(span) - len(rows)
    tour_low_mean = (sum(abs(e) for e in lows) / len(lows)) if lows else None
    tour_high_mean = (sum(highs) / len(highs)) if highs else None
    tour_high_max = max(highs) if highs else None

    # The soy set is filtered independently of the corn set and is NOT
    # necessarily the same years. render_soy() used to say "across the same N
    # years" regardless, which becomes false the moment one year carries soy
    # figures and no usda_aug_corn, or vice versa.
    soy = [h for h in history
           if h.get("tour_soy_prod") is not None
           and h.get("usda_final_soy_prod") is not None
           and h.get("usda_aug_soy_prod") is not None]
    soy_years = [h["year"] for h in soy]
    corn_years = [r["year"] for r in rows]
    soy_tour_mae = (sum(abs(h["tour_soy_prod"] - h["usda_final_soy_prod"])
                        for h in soy) / len(soy)) if soy else None
    soy_usda_mae = (sum(abs(h["usda_aug_soy_prod"] - h["usda_final_soy_prod"])
                        for h in soy) / len(soy)) if soy else None

    return {"rows": rows, "n": n, "tour_mae": tour_mae, "usda_mae": usda_mae,
            "tour_bias": tour_bias, "usda_bias": usda_bias,
            "tour_wins": tour_wins, "usda_wins": usda_wins,
            "tour_low": len(lows), "tour_low_mean": tour_low_mean,
            "tour_high": len(highs), "tour_high_mean": tour_high_mean,
            "tour_high_max": tour_high_max, "tour_tie": len(ties),
            "first": rows[0]["year"], "last": rows[-1]["year"],
            "skipped": skipped, "years": corn_years,
            "soy_n": len(soy), "soy_tour_mae": soy_tour_mae,
            "soy_usda_mae": soy_usda_mae, "soy_years": soy_years,
            "soy_same_years": soy_years == corn_years,
            "soy_first": soy_years[0] if soy_years else None,
            "soy_last": soy_years[-1] if soy_years else None}


def state_stats(data):
    """Per-state prior-year and 3-year-average tour figures, computed.

    Pro Farmer's own state results pages carry exactly these two comparison
    columns, so this is the context a reader already expects next to a fresh
    state number. Computed from `state_history` rather than typed, for the
    same reason the national statistics are.

    Keyed by state code. A code with no history simply gets nothing, which
    renders as nothing.
    """
    hist = data.get("state_history") or {}
    out = {}
    for code, rows in hist.items():
        rows = sorted(rows, key=lambda r: r["year"])
        if not rows:
            continue
        recent = rows[-3:]
        corn = [r["corn"] for r in recent if r.get("corn") is not None]
        pods = [r["pods"] for r in recent if r.get("pods") is not None]
        prior = rows[-1]
        out[code] = {
            "prior_year": prior["year"],
            "prior_corn": prior.get("corn"),
            "prior_pods": prior.get("pods"),
            "avg_years": [r["year"] for r in recent],
            "avg_corn": (sum(corn) / len(corn)) if corn else None,
            "avg_pods": (sum(pods) / len(pods)) if pods else None,
            # COUNT THE VALUES AVERAGED, NOT THE ROWS SCANNED. A state with a
            # null corn figure in the middle of three rows would otherwise
            # print a two-year mean labelled "3-yr avg", right next to a fresh
            # number the reader is being invited to judge against it. null is
            # the only way to record "the tour did not publish that state that
            # year" and validate() explicitly permits it.
            "avg_corn_n": len(corn),
            "avg_pods_n": len(pods),
            "n": len(recent),
        }
    return out


def tour_progress(data):
    """How far through the nightly board we are, counted rather than averaged.

    Deliberately NOT a running average of the state figures. An unweighted
    mean of state yields is not a national yield and would be read as one;
    Pro Farmer's own national number is acreage-weighted and does not arrive
    until Friday. Counting is the honest summary during the week.

    A state marked `publishes: false` is excluded from the denominator — it is
    not a figure that is late, it is a figure that never comes.
    """
    expected = up = down = flat = posted = 0
    prior_years = set()
    for nt in data["nights"]:
        for s in nt["states"]:
            if s.get("publishes") is False:
                continue
            expected += 1
            if s.get("corn") is None:
                continue
            posted += 1
            prior = s.get("_prior_corn")
            if prior is None:
                # Posted, but with nothing to compare against -- a state code
                # with no state_history entry. It stays in `posted` and in
                # `expected`, so it must NOT be silently absent from the move
                # counts as well, or the summary reads "7 of 7 in - 1 above,
                # 5 below" and the reader does the arithmetic.
                continue
            prior_years.add(s.get("_prior_year"))
            if s["corn"] > prior:
                up += 1
            elif s["corn"] < prior:
                down += 1
            else:
                flat += 1
    compared = up + down + flat
    return {"expected": expected, "posted": posted, "compared": compared,
            "up": up, "down": down, "flat": flat,
            # None unless every comparison is against the same year, in which
            # case the summary may name it instead of saying "last year".
            "prior_year": prior_years.pop() if len(prior_years) == 1 else None}


# How long after the expected final the page may keep saying "posts Friday"
# before it starts saying the number is missing instead. One day of grace for
# a late announcement; after that the promise has expired and repeating it is
# a claim about the future that the calendar has already refuted.
GRACE_DAYS = 1


def phase(data, today):
    """Where we are relative to the tour: before / during / waiting / stale / scored."""
    t = data["tour"]
    start = date.fromisoformat(t["start"])
    end = date.fromisoformat(t["end"])
    if data["benchmarks"]["tour"].get("corn") is not None:
        return "scored"
    if today < start:
        return "before"
    if today <= end:
        return "during"
    # WAS: `return "waiting"` for every day from the Friday after the tour
    # until the heat death of the universe. Baked on 2026-09-15 the page still
    # said "national number posts Friday, Aug 21" -- a past date in the future
    # tense, restated every morning by the 09:20 UTC cron and re-asserted by
    # the client-side kicker script, with the tour benchmark card showing an
    # em-dash under the hand-typed note "Posts Friday evening, Aug 21."
    #
    # Same rule as the rest of the site: a box that has gone stale says so
    # instead of repeating a promise the calendar has already broken.
    fe = t.get("final_expected")
    if fe and today > date.fromisoformat(fe) + timedelta(days=GRACE_DAYS):
        return "stale"
    return "waiting"


def next_night(data, today):
    """The next night that has not posted, or None once they all have."""
    for nt in data["nights"]:
        if not nt.get("posted") and date.fromisoformat(nt["date"]) >= today:
            return nt
    return None


# ── region renderers ──────────────────────────────────────────────────────

def latest_posted_night(data):
    """The most recent night that actually carries a figure, or None.

    Walks the data rather than trusting `posted`, which is an operator flag and
    can be flipped before the numbers are typed in. A hero printing an empty
    card because a checkbox ran ahead of the data would be worse than no hero.
    """
    out = None
    for nt in data["nights"]:
        if any(x.get("corn") is not None or x.get("pods") is not None
               for x in nt["states"]):
            out = nt
    return out


def _lede_figs(s, ctx):
    """The figure rows for one state.

    The value+unit is one nowrap group and the change against last year is
    another, so a 320px column may drop the change onto its own line but can
    never split it into "(-90 vs" / "2025)", which is how it broke before.
    """
    rows = []
    for key, fmt, unit, prior in (("corn", "{:.1f}", "bu corn", "prior_corn"),
                                  ("pods", "{:,.0f}", "pods in 3x3", "prior_pods")):
        v = s.get(key)
        if v is None:
            continue
        chip = ""
        pv = (ctx or {}).get(prior)
        if pv is not None:
            d = v - pv
            way = "up" if d > 0 else ("dn" if d < 0 else "fl")
            txt = ("{:+.1f}" if key == "corn" else "{:+,.0f}").format(d)
            chip = (f'<span class="ct-dlt ct-dlt--{way}">{txt} vs '
                    f'{ctx["prior_year"]}</span>')
        rows.append(f'<div class="ct-fig"><span class="ct-fig-m">'
                    f'<span class="ct-num">{fmt.format(v)}</span> '
                    f'<span class="ct-lbl">{unit}</span></span>{chip}</div>')
    return f'<div class="ct-figs">{"".join(rows)}</div>' if rows else ""


def render_lede_board(data, sst):
    """Last night's state figures, directly under the H1.

    WHY THIS EXISTS. During tour week a reader opens this page to see what the
    scouts found last night. Measured at 320px before this block existed, the
    first posted figure sat 929.6px down the page -- past the fold on every
    phone -- while an eleven-year average rendered at 54.4px above it. The
    numbers that are news should be the biggest thing on the page while they
    are news.

    It reuses the nightly board's own classes, so there is one set of type and
    colour rules for a state figure rather than two that can drift apart. The
    same figures appear again in the board below: that is deliberate emphasis,
    and both are rendered from the same data by the same helper.
    """
    nt = latest_posted_night(data)
    if nt is None:
        return ""
    cards = []
    for x in nt["states"]:
        figs = _lede_figs(x, sst.get(x.get("code")))
        if figs:
            cards.append(f'<div class="ct-hs"><div class="ct-hs-name">'
                         f'{esc(x["name"])}</div>{figs}</div>')
    if not cards:
        return ""
    return (f'<div class="ct-hero-board">'
            f'<div class="ct-hs-hd">{esc(nt["label"])} &middot; {short(nt["date"])}</div>'
            f'<div class="ct-hs-grid">{"".join(cards)}</div></div>')


def render_hero(data, st, ph, today, sst=None):
    t = data["tour"]
    n, first, last = st["n"], st["first"], st["last"]
    # Sentence-start form kept separate: .capitalize() would mangle "USDA".
    usda_ahead = st["usda_wins"] > st["tour_wins"]
    closer_start = "USDA" if usda_ahead else "The tour"
    tm, um = st["tour_mae"], st["usda_mae"]
    big = f"{tm:.1f}"
    if ph == "before":
        days = (date.fromisoformat(t["start"]) - today).days
        kicker = (f"Scouts roll {short(t['start'])}"
                  + (f" &mdash; {days} day{'s' if days != 1 else ''} out" if days > 0 else ""))
        verdict = "Worth watching, not worth trading blind"
    elif ph == "during":
        kicker = "Tour underway &mdash; results post each night"
        verdict = "Read the nightly numbers against this record"
    elif ph == "waiting":
        kicker = f"Scouting done &mdash; national number posts {esc(t['final_expected_label'])}"
        verdict = "Read the nightly numbers against this record"
    elif ph == "stale":
        kicker = (f"Scouting done &mdash; national number was due "
                  f"{esc(t['final_expected_label'])} and is not on this page yet")
        verdict = "This page has not been updated with the tour's final number"
    else:
        kicker = "Tour number is in"
        verdict = "Now compare it to the record below"

    # "the last N tours (first-last)" is only true if nothing inside that span
    # was dropped for want of a figure. stats() counts what it skipped.
    span = (f"the last {n} tours ({first}&ndash;{last})" if not st["skipped"]
            else f"the {n} scoreable tours between {first} and {last}")
    lead = (f"Over {span}, Pro Farmer's final corn number missed "
            f"USDA's eventual final by <b>{tm:.1f} bushels</b> on average. USDA's own August forecast "
            f"missed by <b>{um:.1f}</b>. {closer_start} came closer in "
            f"{max(st['usda_wins'], st['tour_wins'])} of those {n} years.")
    bias = render_bias_claim(st)
    # The page must advance its OWN phase. NOTHING rebakes crop-tour.html on a
    # schedule (2026-08-15 audit: grep the workflows -- no job runs this
    # baker), so a hero baked "before" stayed "before" once scouts rolled.
    # FIXED 2026-08-17: .github/workflows/croptour.yml now runs this baker on
    # push and at 09:20 UTC daily. The data-* attributes below stay anyway --
    # they cost nothing and they are what let the page describe its own state
    # to anything reading it without running the baker.
    _attrs = (f' data-phase="{ph}" data-start="{esc(t["start"])}"'
              f' data-end="{esc(t["end"])}"'
              f' data-final-label="{esc(t.get("final_expected_label", ""))}"')
    # SPLIT IN TWO, 2026-08-18. The big 4.1 is the ACCURACY RECORD's headline,
    # not the tour's news. Measured at 390px it pushed the nightly board -- the
    # thing readers refresh for during tour week -- to y=932px, under 606px of
    # eleven-year statistics, which is the opposite of "the board leads".
    #
    #   render_hero()   the phase lede: kicker + verdict. Stays under the H1 in
    #                   every phase, because "Tour underway" is the one line
    #                   that is always news.
    #   render_record() the big number and the two derived paragraphs. Travels
    #                   inside the accuracy-record section, wherever the flow
    #                   puts that section.
    #
    # The data-* attributes stay on the kicker: the client-side re-dating
    # script in crop-tour.html reads .ct-kick[data-start].
    # The lede carries last night's figures while the tour is live. In the
    # phases where there is nothing to report it stays what it was: a kicker
    # and a verdict, with the eleven-year record leading the flow below.
    board = render_lede_board(data, sst or {}) if ph in ("during", "waiting", "stale") else ""
    return (f'<div class="ct-hero ct-hero--lede{" ct-hero--live" if board else ""}">'
            f'<div class="ct-kick"{_attrs}>{kicker}</div>'
            f'{board}'
            f'<div class="ct-vd"><span class="ct-verdict">{esc(verdict)}</span></div></div>')


def render_record(data, st, ph, today):
    """The eleven-year headline: the big number and the two derived claims."""
    n, first, last = st["n"], st["first"], st["last"]
    usda_ahead = st["usda_wins"] > st["tour_wins"]
    closer_start = "USDA" if usda_ahead else "The tour"
    tm, um = st["tour_mae"], st["usda_mae"]
    span = (f"the last {n} tours ({first}&ndash;{last})" if not st["skipped"]
            else f"the {n} scoreable tours between {first} and {last}")
    lead = (f"Over {span}, Pro Farmer's final corn number missed "
            f"USDA's eventual final by <b>{tm:.1f} bushels</b> on average. USDA's own August forecast "
            f"missed by <b>{um:.1f}</b>. {closer_start} came closer in "
            f"{max(st['usda_wins'], st['tour_wins'])} of those {n} years.")
    return (f'<div class="ct-hero ct-hero--record">'
            f'<div class="ct-big">{tm:.1f}<span class="ct-unit">bu</span></div>'
            f'<div class="ct-vd">Average tour miss vs the final crop</div>'
            f'<p class="ct-lead">{lead}</p>'
            f'<p class="ct-lead">{render_bias_claim(st)}</p></div>')


def render_bias_claim(st, plain=False):
    """The tour's directional lean, with each figure attached to its own set.

    `plain=True` returns the JSON-string-safe form for the FAQ answer, so the
    page and the structured data cannot drift apart: one function, two skins.
    """
    n = st["n"]
    b = "" if plain else "<b>"
    _b = "" if plain else "</b>"
    dash = " - " if plain else " &mdash; "
    parts = [f"The tour has also leaned one way: it came in {b}under{_b} the final yield in "
             f"{st['tour_low']} of {n} years"]
    if st["tour_low_mean"] is not None:
        parts.append(f", and in those years it finished {st['tour_low_mean']:.1f} bushels low "
                     f"on average")
    net = abs(st["tour_bias"])
    if round(net, 1) == 0:
        # "0.0 bushels high" is a direction claim about no direction.
        parts.append(f". Across all {n}, the highs and lows cancel to nothing")
    else:
        parts.append(f". Across all {n}, the net lean is {net:.1f} bushels "
                     f"{'low' if st['tour_bias'] < 0 else 'high'}")
    if st["tour_high"]:
        parts.append(f". That is a real tendency, not a rule{dash}it ran high in "
                     f"{st['tour_high']} of them, the widest by {st['tour_high_max']:.1f} bushels")
    else:
        parts.append(". It has not once finished above the final")
    # Without this the reader is left short: 7 low plus 3 high is 10 of 11, and
    # the missing year is the dead-on one the table already shows as "dead on".
    if st["tour_tie"]:
        one = st["tour_tie"] == 1
        parts.append(f", and it landed exactly on the final "
                     f"{'once' if one else str(st['tour_tie']) + ' times'}")
    parts.append(".")
    return "".join(parts)


def render_nights(data, ph, sst, today):
    out = []
    prog = tour_progress(data)
    nxt = next_night(data, today)
    for nt in data["nights"]:
        posted = bool(nt.get("posted"))
        cls = "ct-night" + (" ct-night--posted" if posted else "")
        if nxt is not None and nt is nxt and ph in ("before", "during"):
            cls += " ct-night--next"
        cells = []
        for s in nt["states"]:
            corn = s.get("corn")
            pods = s.get("pods")
            ctx = sst.get(s.get("code"))
            if s.get("publishes") is False:
                # Not a number that is late. A number that never comes.
                val = ('<span class="ct-pend">'
                       + esc(s.get("note") or "no state figure published this night")
                       + "</span>")
            elif corn is None and pods is None:
                # The expected time goes on the NEXT night only. Repeated down
                # every row it stops being information and becomes wallpaper.
                when = s.get("expected_label") or nt.get("expected_label")
                show = when and nxt is not None and nt is nxt and ph in ("before", "during")
                val = ('<span class="ct-pend">not posted yet'
                       + (f" &mdash; {esc(when)}" if show else "")
                       + "</span>")
            else:
                # Same helper the lede board uses, so a state figure is
                # rendered by exactly one function. The change against last
                # year used to be a loose inline span, which at 320px broke
                # "(-90 vs 2025)" into "(-90 vs" / "2025)" inside a 222.5px
                # column. As its own nowrap chip it can drop to the next line
                # but cannot split.
                val = _lede_figs(s, ctx)
            cells.append(f'<div class="ct-state"><div class="ct-st-name">{esc(s["name"])}</div>'
                         f'{val}{render_state_context(ctx, s)}</div>')
        out.append(f'<div class="{cls}"><div class="ct-n-hd">'
                   f'<span class="ct-n-day">{esc(nt["label"])}</span>'
                   f'<span class="ct-n-date">{short(nt["date"])}</span></div>'
                   f'<div class="ct-states">{"".join(cells)}</div></div>')
    return render_progress(prog, data, ph, today) + "".join(out)


def render_state_context(ctx, s):
    """Last year's figure and the recent average, so a fresh number lands
    with something to land against. Silent when there is no history."""
    if not ctx or s.get("publishes") is False:
        return ""
    bits = []
    if ctx.get("prior_corn") is not None:
        prior = f'{ctx["prior_year"]}: {ctx["prior_corn"]:.1f} bu'
        if ctx.get("prior_pods") is not None:
            prior += f', {ctx["prior_pods"]:,.0f} pods'
        bits.append(prior)
    elif ctx.get("prior_pods") is not None:
        bits.append(f'{ctx["prior_year"]}: {ctx["prior_pods"]:,.0f} pods')
    if ctx.get("avg_corn") is not None and ctx["avg_corn_n"] > 1:
        bits.append(f'{ctx["avg_corn_n"]}-yr avg {ctx["avg_corn"]:.1f} bu')
    if not bits:
        return ""
    return f'<div class="ct-yr-note">{esc(" &middot; ".join(bits))}</div>'.replace(
        "&amp;middot;", "&middot;")


def render_progress(prog, data, ph, today):
    """A counted, not averaged, summary of the week so far.

    See tour_progress() for why this refuses to print a running mean.
    """
    if ph == "before":
        n = next_night(data, today)
        when = (n.get("expected_label") if n else None) or ""
        first = ", ".join(s["name"] for s in n["states"]) if n else ""
        body = (f'First results {esc(first)}'
                + (f' {esc(when)}' if when else "")
                + ". Nothing is posted until scouts report.")
    elif prog["posted"] == 0:
        n = next_night(data, today)
        when = (n.get("expected_label") if n else None) or ""
        body = ("No state figures are posted yet."
                + (f' Tonight\'s come in {esc(when)}.' if when else ""))
    else:
        # The move counts cover only the posted states that HAVE a prior figure
        # to compare against. If that is fewer than the posted count, the
        # sentence has to say so, or "7 of 7 in - 1 above, 5 below" invites the
        # reader to do arithmetic that does not add up.
        against = (f'{prog["prior_year"]}' if prog["prior_year"] else "their last tour figure")
        moved = []
        if prog["up"]:
            moved.append(f'{prog["up"]} above {against}')
        if prog["down"]:
            moved.append(f'{prog["down"]} below')
        if prog["flat"]:
            moved.append(f'{prog["flat"]} level')
        if moved and prog["compared"] == prog["posted"]:
            tail = " &mdash; " + ", ".join(moved) + "."
        elif moved:
            tail = (f' &mdash; of the {prog["compared"]} with a prior figure to compare, '
                    + ", ".join(moved) + ".")
        else:
            tail = "."
        body = (f'<b>{prog["posted"]} of {prog["expected"]}</b> state corn figures are in'
                + tail
                + ' These are state samples, not a national yield: Pro Farmer\'s national '
                  'number is acreage-weighted and posts at the end of the week.')
    return f'<p class="ct-lead ct-progress">{body}</p>'


def render_bench(data, ph="during"):
    """The three published numbers.

    In phase `stale` the tour card stops printing its hand-typed "Posts Friday
    evening, Aug 21." — that string is a promise about a date that has passed,
    and it is in the data file, so no amount of recomputing the statistics
    fixes it. An empty cell that says it is empty beats a full cell that is
    wrong about the calendar.
    """
    b = data["benchmarks"]
    order = [("usda", "usda"), ("agsist", "agsist"), ("tour", "tour")]
    out = []
    for key, cls in order:
        e = b[key]
        corn = e.get("corn")
        val = f'{corn:.1f}' if corn is not None else "&mdash;"
        sub = e.get("note", "")
        if key == "tour" and corn is None and ph == "stale":
            sub = ("Not recorded here yet. Pro Farmer's number was expected "
                   + (data["tour"].get("final_expected_label") or "at the end of tour week")
                   + "; this page has not been updated with it.")
        asof = f' &middot; {short(e["as_of"])}' if e.get("as_of") else ""
        out.append(f'<div class="ct-bench ct-bench--{cls}">'
                   f'<div class="ct-b-lbl">{esc(e["label"])}{asof}</div>'
                   f'<div class="ct-b-val">{val}<span class="ct-b-u">bu</span></div>'
                   f'<div class="ct-b-note">{esc(sub)}</div></div>')
    return "".join(out)


# Widest a bar may reach, as a percentage of the cell measured from the centre
# tick. The remaining 100 - 2*MAXW is gutter the printed value lives in, so the
# biggest miss in the table can never shove its own label into the next column.
BAR_MAXW = 34.0


def render_history(st):
    """The eleven-year record, as ONE table in one DOM order.

    Two things here are load-bearing and were measured, not guessed.

    1. The cell labels are real <span aria-hidden="true"> elements, not
       data-label + ::before generated content. Chromium puts generated content
       into the accessible name, so with the column headers restored a screen
       reader announced every cell twice ("Tour" the header, then "Tour 182.7"
       the name). aria-hidden on a real element keeps the visible label and
       leaves the name clean.
    2. Year footnotes are a <details> inside the year cell, not a loose div.
       A <details> may not wrap table rows (the parser foster-parents it out of
       the table), but inside a <td> it is legal and it collapses a 4-line
       paragraph into a 28px chip.
    """
    rows = list(reversed(st["rows"]))
    span = max(max(abs(r["tour_err"]) for r in rows), 0.1)
    L = lambda s: f'<span class="ct-td-lbl" aria-hidden="true">{s}</span>'
    out = ['<div class="ct-tbl-wrap"><table class="ct-tbl">'
           '<caption class="ct-cap">Pro Farmer Crop Tour final corn yield against '
           'USDA&rsquo;s August forecast and USDA&rsquo;s final yield, '
           f'{st["first"]}&ndash;{st["last"]}, bushels per acre.</caption>'
           '<thead><tr>'
           '<th scope="col">Year</th><th scope="col" class="num">Tour</th>'
           '<th scope="col" class="num">USDA Aug</th><th scope="col" class="num">Final</th>'
           '<th scope="col">Tour vs final &mdash; bushels per acre</th>'
           '</tr></thead><tbody>']
    for r in rows:
        e = r["tour_err"]
        pct = min(abs(e) / span, 1.0) * BAR_MAXW
        side = "neg" if e < 0 else ("pos" if e > 0 else "zero")
        if e == 0:
            bar = '<span class="ct-bar-zero">dead on</span>'
        elif e < 0:
            edge = 50 - pct
            bar = (f'<span class="ct-bar ct-bar--neg" style="left:{edge:.1f}%;width:{pct:.1f}%"></span>'
                   f'<span class="ct-bar-v ct-bar-v--neg" style="right:{100 - edge:.1f}%">{e:.1f}</span>')
        else:
            edge = 50 + pct
            bar = (f'<span class="ct-bar ct-bar--pos" style="left:50%;width:{pct:.1f}%"></span>'
                   f'<span class="ct-bar-v ct-bar-v--pos" style="left:{edge:.1f}%">+{e:.1f}</span>')
        note = (f'<details class="ct-yr-note"><summary>Note on {r["year"]}</summary>'
                f'<p>{esc(r["note"])}</p></details>') if r.get("note") else ""
        out.append(f'<tr><td class="ct-yrcell">{L("Year")}<b>{r["year"]}</b>{note}</td>'
                   f'<td class="num">{L("Tour")}{r["tour_corn"]:.1f}</td>'
                   f'<td class="num">{L("USDA Aug")}{r["usda_aug_corn"]:.1f}</td>'
                   f'<td class="num">{L("Final")}{r["usda_final_corn"]:.1f}</td>'
                   f'<td class="ct-barcell {side}">{L("Tour vs final &mdash; bu/acre")}'
                   f'<span class="ct-tick"></span>{bar}</td></tr>')
    out.append('</tbody></table></div>')
    return "".join(out)


def render_soy(st):
    """The soybean record.

    The soy years are filtered independently of the corn years and are not
    necessarily the same set, so the sentence says which it means instead of
    asserting "the same" and hoping. And the verdict at the end is derived from
    the gap rather than typed: "close to a coin flip" was hand-written and
    would have gone on saying coin flip at 0.30 against 0.10.
    """
    if not st["soy_n"]:
        return ""
    when = (f'Across the same {st["soy_n"]} years' if st["soy_same_years"]
            else f'Across the {st["soy_n"]} tours from {st["soy_first"]} '
                 f'through {st["soy_last"]}')
    gap = abs(st["soy_tour_mae"] - st["soy_usda_mae"])
    if gap < 0.02:
        verdict = "On beans it is close to a coin flip between them."
    elif st["soy_tour_mae"] < st["soy_usda_mae"]:
        verdict = "On beans the tour has been the better of the two."
    else:
        verdict = "On beans USDA's August number has been the better of the two."
    return (f'{when}, the tour\'s soybean production number missed the final '
            f'by <b>{st["soy_tour_mae"]:.2f} billion bushels</b> on average, against '
            f'<b>{st["soy_usda_mae"]:.2f} billion</b> for USDA\'s August forecast. {verdict}')


def bake_faq(html, st):
    """Rewrite the FAQ answer inside the JSON-LD by editing the parsed JSON.

    A text marker cannot be used here: the answer lives inside a JSON string,
    so the marker comments would end up in the answer Google reads. Parse,
    set, re-serialise instead.
    """
    m = re.search(r'(<script type="application/ld\+json">)(.*?)(</script>)', html, re.S)
    assert m, "JSON-LD block missing"
    doc = json.loads(m.group(2))
    faqs = [n for n in doc.get("@graph", []) if n.get("@type") == "FAQPage"]
    assert len(faqs) == 1, "expected exactly one FAQPage node"
    q = faqs[0]["mainEntity"][0]
    assert "accurate" in q["name"].lower(), "first FAQ is not the accuracy question"
    q["acceptedAnswer"]["text"] = render_faq_answer(st)
    body = json.dumps(doc, ensure_ascii=False, separators=(",", ":"))
    return html[:m.start()] + m.group(1) + body + m.group(3) + html[m.end():]


def render_faq_answer(st):
    """Plain-text (JSON-string-safe) restatement of the headline statistics."""
    closer = "USDA" if st["usda_wins"] > st["tour_wins"] else "the tour"
    txt = (f"Over the {st['n']} tours from {st['first']} through {st['last']}, Pro Farmer's final "
           f"national corn yield estimate missed USDA's eventual final figure by "
           f"{st['tour_mae']:.1f} bushels per acre on average. USDA's own August forecast missed by "
           f"{st['usda_mae']:.1f} bushels over the same years, and {closer} came closer in "
           f"{max(st['usda_wins'], st['tour_wins'])} of the {st['n']}. "
           + render_bias_claim(st, plain=True))
    # Lands inside a JSON string literal in the head - no quotes, no backslashes.
    assert "<" not in txt, "a < inside a script block would end it early"
    return txt


def render_sources(data):
    out = []
    for s in data["sources"]:
        out.append(f'<li><a href="{esc(s["url"])}" target="_blank" rel="noopener">{esc(s["name"])}</a></li>')
    return "".join(out)


# ── the flow: section order is a phase decision, taken here ───────────────
#
# The headings and blurbs used to live in crop-tour.html, OUTSIDE the marker
# regions, which made the order of the page a hand-edit. It is not a hand-edit;
# it is a function of the phase, and it changes twice a week during tour week.
#
# So the template now carries ONE empty region, <!-- CT:flow -->, and this
# module emits the whole scaffolding into it: the <section>s, their headings,
# their blurbs, and the nested CT: marker pairs the existing renderers splice
# into afterwards. Real DOM order, not CSS `order:` -- a crawler, a reader-mode
# extractor and a screen reader all walk source order, and `order:` would tell
# them something different from what the sighted reader sees.

SECTIONS = {
    "nights": {
        "id": "nightly-results",
        "h2": "Nightly results",
        "sub": ("Scouts run two routes at once, Monday through Thursday, and states report "
                "at the nightly meetings. Corn is a sampled yield in bushels per acre. "
                "Soybeans are pod counts in a three-foot square &mdash; more pods means more "
                "beans, but pods do not convert cleanly into bushels, so treat them as a "
                "direction, not a yield."),
        "body": '<div id="ct-nights"><!-- CT:nights --><!-- /CT:nights --></div>',
    },
    "bench": {
        "id": "three-numbers",
        "h2": "Three numbers on the table",
        "sub": ("USDA's forecast, our own model's number, and the tour's &mdash; all "
                "published before anyone knows the answer."),
        "body": '<div class="ct-benches"><!-- CT:bench --><!-- /CT:bench --></div>',
    },
    "history": {
        "id": "accuracy-record",
        "h2": "How good has the tour actually been?",
        "sub": ("Every tour since 2015, against the crop that actually came in. Bar shows how "
                "far the tour's final corn number landed from USDA's final yield: left of the "
                "line means the tour called it too small, right means too big."),
        "body": ('<!-- CT:record --><!-- /CT:record -->'
                 '<!-- CT:history --><!-- /CT:history -->'
                 '<p class="ct-legend"><!-- CT:soy --><!-- /CT:soy --></p>'),
    },
}

# ONE TABLE, ONE EDIT. Change the order of a phase here and the DOM changes.
#
#   before / during / waiting   the board leads. It is what the reader came
#                               for and what they refresh; the record is
#                               context for it.
#   scored                      the tour's own number is in, so the record it
#                               has to be read against leads, then the
#                               three-way scorecard that now carries it, then
#                               the week's state detail as the supporting
#                               material it has become.
FLOW_ORDER = {
    "before":  ("nights", "bench", "history"),
    "during":  ("nights", "bench", "history"),
    "waiting": ("nights", "bench", "history"),
    "stale":   ("nights", "bench", "history"),
    "scored":  ("history", "bench", "nights"),
}


def flow_order(ph):
    assert ph in FLOW_ORDER, f"no flow order defined for phase {ph!r}"
    order = FLOW_ORDER[ph]
    assert sorted(order) == sorted(SECTIONS), \
        f"flow order for {ph} does not name every section exactly once: {order}"
    return order


def render_flow(ph):
    """The section scaffolding, in phase order, with empty nested markers."""
    order = flow_order(ph)
    out = [f'<div class="ct-flow" data-phase="{ph}" data-order="{" ".join(order)}">']
    for key in order:
        sec = SECTIONS[key]
        out.append(f'<section class="ct-sec ct-sec--{key}" id="{sec["id"]}">'
                   f'<h2 class="ct-h2">{sec["h2"]}</h2>'
                   f'<p class="ct-sub">{sec["sub"]}</p>'
                   f'{sec["body"]}</section>')
    out.append("</div>")
    return "".join(out)


# ── splice + gauntlet ─────────────────────────────────────────────────────

def splice(html, name, body):
    a, b = f"<!-- CT:{name} -->", f"<!-- /CT:{name} -->"
    pat = re.compile(re.escape(a) + r".*?" + re.escape(b), re.S)
    assert len(pat.findall(html)) == 1, f"marker {name}: expected exactly 1 region"
    return pat.sub(lambda _: a + body + b, html)


class DivBalance(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.depth = 0
        self.bad = False

    TAGS = ("div", "section")

    def handle_starttag(self, t, a):
        if t in self.TAGS:
            self.depth += 1

    def handle_endtag(self, t):
        if t in self.TAGS:
            self.depth -= 1
            if self.depth < 0:
                self.bad = True


def gauntlet(html, st, ph=None):
    p = DivBalance()
    p.feed(html)
    assert not p.bad and p.depth == 0, "div balance broken"
    m = re.search(r'<script type="application/ld\+json">(.*?)</script>', html, re.S)
    assert m, "JSON-LD block missing"
    json.loads(m.group(1))
    assert html.count("ct-night") >= 4, "nightly board did not bake"
    assert html.count("<tr>") >= st["n"], "history table short"
    for cp in html:
        o = ord(cp)
        assert not (0x1F300 <= o <= 0x1FAFF), f"emoji {cp!r} in output"

    # THE ORDER IS THE FEATURE, SO THE ORDER IS CHECKED.
    # Real DOM order, measured in the rendered string: the position of each
    # section in the output must match the order this phase asked for. A page
    # that reordered with CSS would pass a check like this while showing the
    # reader something else; that is why it does not reorder with CSS.
    if ph is not None:
        want = flow_order(ph)
        pos = {}
        for key in SECTIONS:
            i = html.find(f'class="ct-sec ct-sec--{key}"')
            assert i >= 0, f"section {key} missing from the flow"
            assert html.count(f'class="ct-sec ct-sec--{key}"') == 1, \
                f"section {key} appears more than once"
            pos[key] = i
        got = tuple(sorted(pos, key=pos.get))
        assert got == want, f"phase {ph}: DOM order is {got}, expected {want}"
        assert '<h2 class="ct-h2">' in html and html.count('<h2 class="ct-h2">') == len(want), \
            "a section lost or gained its heading"


def validate(data):
    h = data["history"]
    assert h, "history empty"
    yrs = [r["year"] for r in h]
    assert yrs == sorted(yrs), "history must be oldest-first"
    assert len(set(yrs)) == len(yrs), "duplicate year in history"
    for r in h:
        for k in ("tour_corn", "usda_aug_corn", "usda_final_corn"):
            v = r.get(k)
            assert v is None or 80 <= v <= 260, f"{r['year']}: {k}={v} out of plausible range"
        for k in ("tour_soy_prod", "usda_aug_soy_prod", "usda_final_soy_prod"):
            v = r.get(k)
            assert v is None or 1.5 <= v <= 7.0, f"{r['year']}: {k}={v} out of plausible range"
    for nt in data["nights"]:
        date.fromisoformat(nt["date"])
        for s in nt["states"]:
            c, p = s.get("corn"), s.get("pods")
            assert c is None or 40 <= c <= 300, f"{s['code']}: corn {c} implausible"
            assert p is None or 200 <= p <= 2500, f"{s['code']}: pods {p} implausible"
            # A slot the operator never publishes must stay empty. Otherwise
            # the only way to fill it is to compute or guess an aggregate that
            # the tour itself does not report.
            if s.get("publishes") is False:
                assert c is None and p is None, (
                    f"{s['code']} is marked publishes:false but carries numbers. "
                    "Pro Farmer does not publish a figure for this slot, so any "
                    "number here was derived rather than reported.")
        if nt.get("posted"):
            assert any(s.get("corn") is not None or s.get("pods") is not None
                       for s in nt["states"]), \
                f"{nt['date']} marked posted but carries no numbers"
    for code, rows in (data.get("state_history") or {}).items():
        yy = [r["year"] for r in rows]
        assert yy == sorted(yy), f"state_history[{code}] must be oldest-first"
        assert len(set(yy)) == len(yy), f"state_history[{code}] has a duplicate year"
        for r in rows:
            c, p = r.get("corn"), r.get("pods")
            assert c is None or 40 <= c <= 300, f"state_history[{code}] {r['year']}: corn {c}"
            assert p is None or 200 <= p <= 2500, f"state_history[{code}] {r['year']}: pods {p}"


def attach_state_context(data, sst):
    """Hang each state's prior-year corn on its night entry, so
    tour_progress() can count moves without re-walking state_history."""
    for nt in data["nights"]:
        for s in nt["states"]:
            ctx = sst.get(s.get("code"))
            s["_prior_corn"] = ctx.get("prior_corn") if ctx else None
            s["_prior_year"] = ctx.get("prior_year") if ctx else None


# ── selftest ──────────────────────────────────────────────────────────────

def _nums(text):
    """Every number a reader would see in a rendered claim."""
    plain = re.sub(r"<[^>]+>", "", text)
    plain = plain.replace("&mdash;", " ").replace("&ndash;", " ").replace("&middot;", " ")
    return [x.replace(",", "") for x in re.findall(r"\d[\d,]*(?:\.\d+)?", plain)]


def _check_claim_numbers(label, text, allowed, fails):
    """Assert every figure in a claim is one this module derived FOR that claim.

    This is the check the old bias sentence needed and did not have. Its
    arithmetic was correct; its wiring was not. Recomputing the means would
    have passed. Asking "is 2.6 a number this sentence is entitled to print"
    would have failed, because the sentence was only entitled to 5.3.
    """
    ok = {f"{v:g}" for v in allowed} | {f"{v:.1f}" for v in allowed} | \
         {f"{v:.2f}" for v in allowed} | {f"{v:.0f}" for v in allowed}
    for got in _nums(text):
        if got not in ok:
            fails.append(f"{label}: printed {got!r}, which is not a value derived "
                         f"for this claim (allowed: {sorted(ok)})")


def selftest():
    fails = []
    checks = 0

    def ck(name, cond):
        nonlocal checks
        checks += 1
        if cond:
            print(f"  ok   {name}")
        else:
            print(f"  FAIL {name}")
            fails.append(name)

    print("statistics keep their populations apart")
    # Hand-computed: errors -4, -6, +2, 0.  n=4.
    #   mae   = (4+6+2+0)/4 = 3.0
    #   bias  = (-4-6+2+0)/4 = -2.0     <- ALL four years
    #   low   = 2 years, mean shortfall (4+6)/2 = 5.0   <- only the low years
    #   high  = 1 year, max +2.0
    toy = [{"year": 2001, "tour_corn": 96.0, "usda_aug_corn": 100.0, "usda_final_corn": 100.0},
           {"year": 2002, "tour_corn": 94.0, "usda_aug_corn": 100.0, "usda_final_corn": 100.0},
           {"year": 2003, "tour_corn": 102.0, "usda_aug_corn": 100.0, "usda_final_corn": 100.0},
           {"year": 2004, "tour_corn": 100.0, "usda_aug_corn": 100.0, "usda_final_corn": 100.0}]
    t = stats(toy)
    ck("mean absolute error over all years", abs(t["tour_mae"] - 3.0) < 1e-9)
    ck("net bias is the mean over ALL years", abs(t["tour_bias"] - -2.0) < 1e-9)
    ck("low-year mean covers ONLY the low years", abs(t["tour_low_mean"] - 5.0) < 1e-9)
    ck("the two are different numbers here", abs(t["tour_low_mean"] - abs(t["tour_bias"])) > 1e-9)
    ck("low years counted", t["tour_low"] == 2)
    ck("high years counted", t["tour_high"] == 1)
    ck("widest high year", abs(t["tour_high_max"] - 2.0) < 1e-9)
    ck("exact ties counted separately", t["tour_tie"] == 1)

    # The structural invariant the old sentence violated. Whenever the tour has
    # run high at least once, the average shortfall in its low years MUST be
    # strictly larger than the whole-record net lean, because the high years
    # pull the net toward zero. Printing the smaller number as if it were the
    # larger one is exactly the bug.
    ck("low-year mean exceeds the net lean whenever any year ran high",
       t["tour_high"] == 0 or t["tour_low_mean"] > abs(t["tour_bias"]))

    print()
    print("no claim prints a number it did not derive")
    claim = render_bias_claim(t)
    allowed = {t["tour_low"], t["n"], round(t["tour_low_mean"], 1),
               round(abs(t["tour_bias"]), 1), t["tour_high"],
               round(t["tour_high_max"], 1)}
    before = len(fails)
    _check_claim_numbers("bias claim", claim, allowed, fails)
    ck("every figure in the bias claim is derived for it", len(fails) == before)

    # The regression itself, stated as a test: the sentence must not describe
    # the low years using the whole-record lean.
    ck("the low-year clause carries the low-year mean, not the net lean",
       f"{t['tour_low_mean']:.1f} bushels low" in claim)
    ck("the net lean is labelled as covering all years",
       f"Across all {t['n']}" in claim)

    print()
    print("the FAQ answer and the page cannot drift")
    faq = render_faq_answer(t)
    ck("FAQ carries the same bias clause as the page",
       render_bias_claim(t, plain=True) in faq)
    ck("FAQ is JSON-string safe", "<" not in faq and '"' not in faq)
    ck("page version is marked up, FAQ version is not",
       "<b>" in claim and "<b>" not in faq)

    print()
    print("a slot the tour never publishes cannot be filled")
    bad = {"history": toy,
           "nights": [{"date": "2026-08-19", "label": "x", "posted": False,
                       "states": [{"code": "IA-W", "name": "Western Iowa",
                                   "publishes": False, "corn": 190.0, "pods": None}]}],
           "benchmarks": {"tour": {"corn": None}}}
    try:
        validate(bad)
        ck("validate refuses a number in an unpublished slot", False)
    except AssertionError as e:
        ck("validate refuses a number in an unpublished slot", "publishes:false" in str(e))

    good = json.loads(json.dumps(bad))
    good["nights"][0]["states"][0]["corn"] = None
    try:
        validate(good)
        ck("validate accepts the same slot left empty", True)
    except AssertionError:
        ck("validate accepts the same slot left empty", False)

    print()
    print("the running summary counts, it does not average")
    d = {"nights": [{"date": "2026-08-17", "label": "n", "posted": True, "states": [
            {"code": "OH", "name": "Ohio", "corn": 190.0, "pods": 1200, "_prior_corn": 185.0},
            {"code": "SD", "name": "South Dakota", "corn": 170.0, "pods": 1100, "_prior_corn": 174.0}]},
         {"date": "2026-08-19", "label": "n", "posted": False, "states": [
            {"code": "IL", "name": "Illinois", "corn": None, "pods": None, "_prior_corn": 199.0},
            {"code": "IA-W", "name": "Western Iowa", "publishes": False,
             "corn": None, "pods": None}]}]}
    pr = tour_progress(d)
    ck("unpublished slots leave the denominator", pr["expected"] == 3)
    ck("posted figures counted", pr["posted"] == 2)
    ck("moves counted against last year", pr["up"] == 1 and pr["down"] == 1)
    txt = render_progress(pr, d, "during", date(2026, 8, 17))
    ck("the summary prints no running mean of state yields",
       "average" not in txt.lower() or "not a national yield" in txt)
    ck("the summary says these are not a national yield",
       "not a national yield" in txt)

    print()
    print("per-state context is computed, not typed")
    sd = {"state_history": {"OH": [{"year": 2023, "corn": 183.94, "pods": 1252.93},
                                   {"year": 2024, "corn": 183.29, "pods": 1229.93},
                                   {"year": 2025, "corn": 185.69, "pods": 1287.28}]}}
    ss = state_stats(sd)
    ck("prior year is the newest row", ss["OH"]["prior_year"] == 2025)
    ck("prior corn matches", abs(ss["OH"]["prior_corn"] - 185.69) < 1e-9)
    ck("3-year average computed",
       abs(ss["OH"]["avg_corn"] - (183.94 + 183.29 + 185.69) / 3) < 1e-9)
    ck("average window reported", ss["OH"]["avg_years"] == [2023, 2024, 2025])

    print()
    print("the flow orders the DOM, not the CSS")
    for ph_ in FLOW_ORDER:
        f = render_flow(ph_)
        ck(f"flow for phase {ph_} names every section once",
           all(f.count(f'ct-sec--{k}"') == 1 for k in SECTIONS))
    dur = [k for k in ("nights", "bench", "history")
           if True and render_flow("during").find(f'ct-sec--{k}"') >= 0]
    dur.sort(key=lambda k: render_flow("during").find(f'ct-sec--{k}"'))
    sco = sorted(SECTIONS, key=lambda k: render_flow("scored").find(f'ct-sec--{k}"'))
    ck("during: the nightly board is first in source order", dur[0] == "nights")
    ck("scored: the accuracy record is first in source order", sco[0] == "history")
    ck("the flow reorders nothing with CSS", "order:" not in render_flow("during"))
    ck("every section carries its own heading and nested marker",
       all(f'<!-- CT:{m} -->' in render_flow("during")
           for m in ("nights", "bench", "history", "soy", "record")))

    print()
    print("the clock is Central, and never silently UTC")
    ck("the module resolves a real zone, not the runner's local time",
       today_tour() == datetime.now(timezone.utc).astimezone(
           __import__("zoneinfo").ZoneInfo(TOUR_TZ)).date())
    ck("the tour date and the UTC date genuinely differ after 7pm Central",
       datetime(2026, 8, 19, 0, 30, tzinfo=timezone.utc).astimezone(
           __import__("zoneinfo").ZoneInfo(TOUR_TZ)).date() == date(2026, 8, 18))

    print()
    print("a promise whose date has passed stops being printed")
    _d = {"tour": {"start": "2026-08-17", "end": "2026-08-20",
                   "final_expected": "2026-08-21",
                   "final_expected_label": "Friday, Aug 21"},
          "benchmarks": {"tour": {"corn": None}}}
    ck("the day after the final is still 'waiting'",
       phase(_d, date(2026, 8, 22)) == "waiting")
    ck("a week later it is 'stale', not 'waiting'",
       phase(_d, date(2026, 8, 28)) == "stale")
    ck("the stale hero does not say a past date posts in the future",
       "posts Friday, Aug 21" not in
       render_hero({**_d, "nights": []}, t, "stale", date(2026, 8, 28)))

    print()
    print("live data still bakes every claim")
    root = Path(__file__).resolve().parent.parent
    jp = root / "data" / "crop-tour.json"
    if jp.exists():
        live = json.loads(jp.read_text(encoding="utf-8"))
        validate(live)
        lst = stats(live["history"])
        lss = state_stats(live)
        attach_state_context(live, lss)
        lc = render_bias_claim(lst)
        la = {lst["tour_low"], lst["n"], round(lst["tour_low_mean"], 1),
              round(abs(lst["tour_bias"]), 1), lst["tour_high"],
              round(lst["tour_high_max"], 1)}
        before = len(fails)
        _check_claim_numbers("live bias claim", lc, la, fails)
        ck("live bias claim prints only derived figures", len(fails) == before)
        ck("live low-year mean is not the net lean",
           abs(lst["tour_low_mean"] - abs(lst["tour_bias"])) > 0.05)
        for ph in ("before", "during", "waiting", "scored"):
            r = render_nights(live, ph, lss, date(2026, 8, 17))
            ck(f"nights render in phase {ph}", "ct-night" in r)
        ck("no night claims a number for an unpublished slot",
           all(s.get("corn") is None
               for nt in live["nights"] for s in nt["states"]
               if s.get("publishes") is False))
    else:
        ck("live data present", False)

    print()
    if fails:
        print(f"{len(fails)} FAILED of {checks}")
        for f in fails:
            print(f"  - {f}")
        return 1
    print(f"all {checks} crop tour checks pass")
    return 0


def _region_diff(was, now, limit=6):
    """The first few differing fragments of a region, for --check."""
    import difflib
    aw = re.split(r"(?<=>)(?=<)", was)
    an = re.split(r"(?<=>)(?=<)", now)
    out = []
    for ln in difflib.unified_diff(aw, an, n=0, lineterm=""):
        if ln.startswith(("---", "+++", "@@")):
            continue
        out.append(ln[:150])
        if len(out) >= limit:
            out.append("...")
            break
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--html", default=None)
    ap.add_argument("--json", default=None)
    ap.add_argument("--today", default=None, help="override date (YYYY-MM-DD) for testing")
    args = ap.parse_args()

    if args.selftest:
        return selftest()

    root = Path(__file__).resolve().parent.parent
    html_path = Path(args.html) if args.html else root / "crop-tour.html"
    json_path = Path(args.json) if args.json else root / "data" / "crop-tour.json"

    data = json.loads(json_path.read_text(encoding="utf-8"))
    validate(data)
    st = stats(data["history"])
    sst = state_stats(data)
    attach_state_context(data, sst)
    today = date.fromisoformat(args.today) if args.today else today_tour()
    ph = phase(data, today)

    html = html_path.read_text(encoding="utf-8")
    # FLOW FIRST. It emits the empty CT:nights / CT:bench / CT:history / CT:soy
    # marker pairs in phase order; the splices below then fill them. Order
    # matters: filling before the flow is emitted would have the flow overwrite
    # the content it just wrote.
    baked = splice(html, "flow", render_flow(ph))
    baked = splice(baked, "hero", render_hero(data, st, ph, today, sst))
    baked = splice(baked, "nights", render_nights(data, ph, sst, today))
    baked = splice(baked, "bench", render_bench(data, ph))
    baked = splice(baked, "record", render_record(data, st, ph, today))
    baked = splice(baked, "history", render_history(st))
    baked = splice(baked, "soy", render_soy(st))
    baked = splice(baked, "sources", render_sources(data))
    # The FAQ answer restates the headline statistics. It used to be hand-typed
    # in the head, which meant adding a tour year would leave a stale claim in
    # the structured data that nobody would notice. Bake it from the same stats.
    baked = bake_faq(baked, st)
    baked = splice(baked, "stamp", f"Record updated {pretty(data['updated'])} &middot; "
                                   f"{st['n']} tours scored")
    baked, n = re.subn(r'("dateModified":")\d{4}-\d{2}-\d{2}(")',
                       r"\g<1>" + data["updated"] + r"\g<2>", baked)
    # This page carries two: the WebPage node and the Dataset node. Both should
    # move together. Zero means the JSON-LD block was renamed or lost.
    assert n >= 1, "no dateModified found in the JSON-LD — head block changed?"

    gauntlet(baked, st, ph)

    if baked == html:
        print("crop-tour.html already in sync.")
        return 0
    if args.check:
        # NAME THE DRIFT. "OUT OF SYNC" with no detail is a signal people learn
        # to ignore, and this one used to fire every evening for a purely
        # date-driven reason (the runner's UTC clock rolling the nightly
        # highlight forward at 7pm Central). Say which regions moved, so a
        # reader can tell "the daily bake has not run today" from "somebody
        # hand-edited the history table".
        print("crop-tour.html OUT OF SYNC with data/crop-tour.json — run the baker.")
        for name in ("stamp", "hero", "flow", "sources"):
            a, bnd = f"<!-- CT:{name} -->", f"<!-- /CT:{name} -->"
            pat = re.compile(re.escape(a) + r"(.*?)" + re.escape(bnd), re.S)
            was = pat.search(html)
            now = pat.search(baked)
            if was and now and was.group(1) != now.group(1):
                print(f"  region {name}: differs "
                      f"({len(was.group(1))} chars on disk, {len(now.group(1))} baked)")
                for ln in _region_diff(was.group(1), now.group(1)):
                    print(f"      {ln}")
        print(f"  (baked for phase={ph}, today={today.isoformat()})")
        return 1
    html_path.write_text(baked, encoding="utf-8")
    print(f"Baked crop-tour.html — phase={ph}, {st['n']} tours scored, "
          f"tour MAE {st['tour_mae']:.2f} vs USDA {st['usda_mae']:.2f}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
