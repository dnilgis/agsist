#!/usr/bin/env python3
"""
prerender_wpi_scorecard.py — bake WPI + scorecard JSON into static HTML.

Why: whats-priced-in.html and scorecard.html render entirely client-side, so
JS-blind crawlers (GPTBot, ClaudeBot, PerplexityBot, Googlebot's first pass)
see empty containers and a "Loading…" div instead of the trade estimates and
the graded record — the exact content this site wants cited. Same rationale as
bake_homepage.py / build_farmbill.py.

How: Python ports of the pages' OWN JS renderers write the same markup (same
CSS classes) into marker-comment regions inside the JS target containers.
Client JS still fetches the JSON and overwrites innerHTML at runtime, so
hydration is unchanged — the bake only changes what non-JS readers see.

Regions:
  usda-calendar.html   : PRERENDER:cal-top   (top of the page: USDA vs the trade, or the next report)
                         PRERENDER:wp-result  (latest-report banner, 5-day window)
                         PRERENDER:wp-nexthead (the heading that names the next report)
                         PRERENDER:wp-farmbox (the "here is what to do about it" box)
                         PRERENDER:wp-next    (next-report expectation card)
                         PRERENDER:wp-history (scored track record)
                         PRERENDER:as-board   (analyst leaderboard / building table)
                         + Dataset JSON-LD dateModified stamp
  scorecard.html       : PRERENDER:sc-nextrep (next-report pointer box)
                         PRERENDER:sc-stats   (hit rate / W-L-pending / streak / total)
                         PRERENDER:sc-prose-hit (the machine-checked hit rate in the sentence)
                         PRERENDER:sc-sample / sc-selfrow (sample beside the hero; self-graded row)
                         PRERENDER:sc-list    (latest 25 graded calls + archive pointer)

Idempotent: same JSON in, byte-identical file out.  --check verifies sync (CI).

Usage:
    python3 scripts/prerender_wpi_scorecard.py            # bake in place
    python3 scripts/prerender_wpi_scorecard.py --check    # verify only
Paths are repo-root-relative; run from the repo root (CI does).
"""

import argparse
import html as htmlmod
import json
import re
import sys
import source_links  # noqa: E402  no direct links to data sources
from pathlib import Path
from datetime import datetime, timezone

# Oct 22, 2026: both pages became sections of /usda-calendar (#priced-in, #scorecard); the old
# addresses are forward pages. The regions and the Dataset stamp now live there.
WPI_HTML = "usda-calendar.html"
SC_HTML = "usda-calendar.html"
WPI_JSON = "data/whats-priced-in.json"
AS_JSON = "data/analyst-scorecard.json"
SC_JSON = "data/scorecard.json"


def nodash(s):
    """Data prose (reactions, notes) is printed verbatim; the site prints no em
    dashes, so a spaced one reads as a comma and a bare one as a hyphen."""
    return str(s).replace(" \u2014 ", ", ").replace("\u2014", "-")


def esc(s):
    return htmlmod.escape(nodash("" if s is None else s), quote=True)


def num(n, u=""):
    if n is None:
        return "-"
    return f"{n} {u}".strip() if u else str(n)


def days_until(date_iso):
    """Whole calendar days from today to that date. Mirrors the page JS.

    IT STOPPED MIRRORING IT, AND THE COMMENT KEPT SAYING IT DID. The page was
    corrected on 2026-08-11 — "compare calendar DATES, not noon-anchored ceil —
    the old version said 'tomorrow' all report-day morning" — and this port was
    not. So on the morning of a release the baked HTML a crawler reads would
    have said "tomorrow" over a card the hydrated page rendered as "today", from
    one JSON file. Same arithmetic as the JS now: midnight to midnight, rounded."""
    t = datetime.strptime(date_iso, "%Y-%m-%d").date()
    return (t - datetime.now().date()).days


# ── WPI renderers (ports of the page's JS) ─────────────────────────────────

# 2026-08-15 audit: three hand-written blocks named a specific report and went
# stale the moment it printed. On Aug 15 the page's <h2> still read "the August
# WASDE" above a card rendering September, and a farmbox told readers to get
# ready for a report that had printed three days earlier. Anything that names a
# report or a date is baked from data now.

def _report_when(n):
    """'Aug 12, 11:00 a.m. Central' style stamp from the upcoming record."""
    try:
        d = datetime.strptime(n["date"], "%Y-%m-%d")
    except (KeyError, ValueError):
        return ""
    t = (n.get("time") or "").replace("12:00 PM ET", "11:00 a.m. Central")
    return f"{d.strftime('%b %-d')}" + (f", {t}" if t else "")


def next_head(n):
    if not n:
        return "Next report"
    return f"Next report: what the trade expects from the {esc(n.get('report', 'next USDA report'))}"


def farm_box(n):
    if not n:
        return ('<div class="wp-farmbox">No USDA report is on the board right now. '
                'Your own numbers: <a href="/breakeven">break-even</a> &middot; '
                '<a href="/harvest-price-tracker#presell">safe pre-sell</a>.</div>')
    when = _report_when(n)
    # A calendar-only record carries metric None; it used to print ". If you".
    metric = esc(n.get("metric") or "")
    return ('<div class="wp-farmbox"><b>' + esc(n.get("report", "Next report")) +
            (f': {when}.</b> ' if when else '.</b> ') +
            (f'{metric}. ' if metric else '') + 'If you are holding unpriced bushels, know the number to beat '
            'before that morning. Your own numbers: <a href="/breakeven">break-even</a> '
            '&middot; <a href="/harvest-price-tracker#presell">safe pre-sell</a>.</div>')


def sc_next_report(n):
    if not n:
        return ('<b style="color:var(--text)">No USDA report scheduled.</b> '
                'See <a href="/usda-calendar" style="color:var(--gold)">the calendar</a>.')
    when = _report_when(n)
    return ('<b style="color:var(--text)">' + (when + ': ' if when else '') + '</b>' +
            esc(n.get("report", "Next USDA report")) + ': ' +
            esc(n.get("metric") or "the next USDA numbers") + '. See '
            '<a href="/usda-calendar#priced-in" style="color:var(--gold)">what the trade has '
            'priced in</a> before the number drops.')


# ── THE REPORT STRIP, BAKED ────────────────────────────────────────────────
#
# Found 2026-09-12. The page's JS rendered "Every number on this report" and
# this file did not, so the baked HTML a crawler (or a reader before hydration)
# sees carried the card without the strip and the live page grew one. Same JSON,
# two answers, which is the thing this file exists to prevent.
#
# This is a line-for-line port of numbersEl() in whats-priced-in.html.
# test/wpi-numbers-strip.test.mjs runs both against the same rows and fails on
# any byte of difference, so the port cannot quietly drift again.
def _esc4(s):
    """The page's own esc(): & < > and the double quote, and NOT the apostrophe.

    html.escape(quote=True) also turns ' into &#x27;, which would make this port
    differ from the JS by a handful of bytes on any string containing one -- and
    the parity test compares bytes. These strings only ever sit inside
    double-quoted attributes or element text, so four characters is the whole
    job."""
    return (str("" if s is None else s).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


def _sig(n):
    """Render a number the way JSON.stringify/JS would: 178.5, 800, not 800.0."""
    if isinstance(n, float) and n.is_integer():
        return str(int(n))
    return str(n)


def numbers_el(rows):
    if not rows:
        return ""
    DASH = "n/a"
    body = []
    for r in rows:
        u = (" " + r["unit"]) if r.get("unit") else ""
        exp = ((DASH + ('<div style="font-size:.72rem;color:var(--wp-mut)">'
                        + _esc4(r["expected_why"]) + "</div>" if r.get("expected_why") else ""))
               if r.get("expected") is None else (_sig(r["expected"]) + u + (
                   '<div style="font-size:.72rem;color:var(--wp-mut)">source date unknown</div>'
                   if r.get("source_date_unknown") else "")))
        rng = ('<div style="font-size:.72rem;color:var(--wp-mut)">range '
               + _sig(r["low"]) + " to " + _sig(r["high"]) + "</div>") \
            if (r.get("low") is not None and r.get("high") is not None) else ""
        now = DASH if r.get("usda_current") is None else (_sig(r["usda_current"]) + u)
        if r.get("actual") is None:
            printed = '<td class="wait">' + _esc4(r.get("why") or "not printed yet") + "</td>"
        else:
            sur = r.get("surprise")
            if sur == "bullish":
                tag = '<span class="v bull">bullish</span>'
            elif sur == "bearish":
                tag = '<span class="v bear">bearish</span>'
            elif sur == "in line":
                tag = '<span class="v flat">in line</span>'
            else:
                tag = '<span class="v flat" title="' + _esc4(r.get("why") or "") + '">no call</span>'
            # Where it sat against the survey's own low and high, worded by the
            # pipeline (report_bands.range_context). Line-for-line port of
            # numbersEl()'s ctx; test/wpi-numbers-strip.test.mjs holds them.
            ctx = ('<div style="font-size:.72rem;color:var(--wp-mut)">' + _esc4(r["context"]) + "</div>"
                   if r.get("context") else "")
            printed = '<td class="n"><b>' + _sig(r["actual"]) + u + "</b>" + tag + ctx + "</td>"
        body.append("<tr><td>" + _esc4(r.get("label")) + rng + '</td><td class="n">' + exp
                    + '</td><td class="n">' + now + "</td>" + printed + "</tr>")
    # One link per distinct survey, same as numbersEl(): a report's yields and its
    # stocks can come from two surveys, and one link would credit both to the first.
    srcs = []
    for r in rows:
        if r.get("source") and r["source"] not in srcs:
            srcs.append(r["source"])
    src = srcs[0] if srcs else None
    if len(srcs) > 1:
        links = "Survey sources: " + ", ".join(
            source_links.link(s, _esc4(re.sub(r"^https?://(www\.)?", "", s).split("/")[0]), ' rel="nofollow noopener" target="_blank"')
            for s in srcs)
    else:
        links = source_links.link(src or "", "Survey source", ' rel="nofollow noopener" target="_blank"')
    note = ('<div class="src">Trade estimates come from a published pre-report survey, entered '
            'as published. ' + links + '. Graded on the distance '
            'from the trade average: close to it is in line; past that, more supply than the trade expected is bearish and '
            'less is bullish. The survey\u2019s low-high range is shown beside the grade and '
            'does not change it.</div>') if src else ""
    waiting = all(r.get("actual") is None for r in rows)
    head = ("USDA prints at 11:00 a.m. CT. This fills in on its own." if waiting
            else "Graded against the pre-report survey.")
    return ('<div class="wp-nums"><div class="nh"><b>Every number on this report</b><span>'
            + head + '</span></div><table><thead><tr><th>Number</th><th>Trade expects</th>'
            '<th>' + ("USDA now" if waiting else "USDA before") + '</th><th>USDA printed</th></tr></thead><tbody>'
            + "".join(body) + "</tbody></table>" + note + "</div>")


# Line-for-line port of toBeatEl() in whats-priced-in.html; test/wpi-to-beat.test.mjs
# compares the two byte for byte.
MO3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def to_beat_el(tb, next_report):
    if not tb or not tb.get("rows"):
        return ""
    p = str(tb.get("date") or "").split("-")
    md = (MO3[int(p[1]) - 1] + " " + str(int(p[2]))) if len(p) == 3 else _esc4(tb.get("date"))
    body = "".join('<tr><td>' + _esc4(r.get("label")) + '</td><td class="n"><b>' + _esc4(_sig(r.get("value")))
                   + " " + _esc4(r.get("unit")) + "</b></td></tr>" for r in tb["rows"])
    return ('<div class="wp-nums wp-beat"><div class="nh"><b>The number to beat</b><span>USDA\u2019s '
            + _esc4(tb.get("report")) + " (" + md + "), standing until the " + _esc4(next_report or "next report")
            + "</span></div>"
            + "<table><thead><tr><th>Number</th><th>USDA now</th></tr></thead><tbody>" + body + "</tbody></table>"
            + '<div class="src">USDA\u2019s own figures' + ((" (" + _esc4(tb["wasde_no"]) + ")") if tb.get("wasde_no") else "")
            + ". A survey average, high and low go beside them once a pre-report survey posts, with the source and time. "
            + source_links.link(tb.get("source") or "", "USDA WASDE", ' rel="noopener" target="_blank"') + '</div></div>')


def next_card(n, skip_nums=False):
    if not n:
        return ('<div class="wp-err">No upcoming report is scheduled right now. '
                'Check the <a href="/usda-calendar" style="color:var(--wp-gold2)">USDA calendar</a>.</div>')
    d = days_until(n["date"])
    cd = f"{d} days out" if d > 1 else ("tomorrow" if d == 1 else ("today" if d == 0 else "released"))
    lo, hi, av, u = n.get("estimate_low"), n.get("estimate_high"), n.get("estimate_avg"), n.get("unit") or ""

    # A BLOCK THAT IS NOT THERE, SAYING WHY — the same four gaps the page fills.
    withheld = n.get("withheld") or {}

    def gap(key, title):
        return (f'<div class="wp-gap"><b>{title}:</b> {esc(withheld[key])}</div>'
                if withheld.get(key) else "")

    range_html = ""
    if lo is not None and hi is not None and hi > lo:
        # CLAMPED, AND THE BAR IS LABELLED. Mirrors the page's nextCard():
        # an average outside its own published range put the marker off the end
        # of the bar, and the bar itself carried no text for a screen reader.
        p_av_raw = ((av - lo) / (hi - lo) * 100) if av is not None else 50
        p_av = max(0.0, min(100.0, p_av_raw))
        av_out = av is not None and (av < lo or av > hi)
        bar_label = (f"Trade range {lo} to {hi}"
                     + (f" {n['unit']}" if n.get("unit") else "")
                     + (f", average {av}" if av is not None else ""))
        range_html = (
            f'<div class="wp-range"><span aria-hidden="true">{lo}</span>'
            f'<span class="wp-rbar" role="img" aria-label="{esc(bar_label)}">'
            f'<span class="span" style="left:0;right:0"></span>'
            f'<span class="avg" style="left:{p_av:.0f}%"></span></span><span aria-hidden="true">{hi}</span></div>'
            + (f'<div class="wp-gap"><b>Note:</b> the survey average ({av}) falls outside the '
               f'published high and low. The marker is pinned to the end of the bar.</div>'
               if av_out else '')
            + f'<div class="wp-metric">Trade range for {esc(n["metric"])} &middot; '
            f'avg <b style="color:var(--wp-gold2)">{esc(num(av, u))}</b></div>'
        )
    else:
        range_html = gap("range", "No trade range yet")
    odds = ""
    if n.get("implied_odds"):
        rows = "".join(
            f'<div class="o"><div class="ol"><span>{o["label"]}</span><span>{o["pct"]}%</span></div>'
            f'<div class="ot"><span class="of" style="width:{o["pct"]}%"></span></div></div>'
            for o in n["implied_odds"]
        )
        odds = f'<div class="wp-odds">{rows}</div>'
    else:
        odds = gap("odds", "No market odds")
    thr = ""
    if n.get("bullish_threshold") or n.get("bearish_threshold"):
        thr = (
            '<div class="wp-thr">'
            f'<div class="t bull"><div class="k">Bullish surprise</div><div class="v">{n.get("bullish_threshold") or "-"}</div></div>'
            f'<div class="t bear"><div class="k">Bearish surprise</div><div class="v">{n.get("bearish_threshold") or "-"}</div></div></div>'
        )
    else:
        thr = gap("thresholds", "No surprise line yet")
    pos = (f'<div class="wp-pos">Fund positioning: {esc(n["positioning"])}</div>'
           if n.get("positioning") else gap("positioning", "No positioning"))
    commodity = (
        f'<div class="wp-metric">{esc(n["commodity"])}: {esc(n.get("metric", ""))}</div>'
        if n.get("commodity") else ""
    )
    expectation = f'<div class="wp-exp">{esc(n["expectation"])}</div>' if n.get("expectation") else ""
    # one time zone on the page, Central like the rest of the site (2026-10-15)
    time_part = (f' · {n["time"].replace("12:00 PM ET", "11:00 a.m. CT")}'
                 if n.get("time") else "")
    return (
        f'<div class="wp-card"><div class="hd"><span class="rpt">{esc(n["report"])}</span>'
        f'<span class="cd">{esc(n["date"])}{time_part} · {cd}</span></div>'
        f'{commodity}{expectation}{to_beat_el(n.get("to_beat"), n.get("report"))}{range_html}{odds}{thr}{pos}'
        f'{"" if skip_nums else numbers_el(n.get("numbers"))}</div>'
    )


def last_line(lr):
    """The last report in one line, for the weeks between reports. Twin of
    lastLine() in whats-priced-in.html, byte for byte (test/wpi-last-line.test.mjs).
    2026-10-15: after the five-day banner the result was folded into the track
    record and the first screen answered nothing until the next report."""
    b = lr.get("biggest_surprise") or {}
    y, m, d = (int(x) for x in lr["date"].split("-"))
    md = f"{MON3[m - 1]} {d}"

    def n_(v, u):
        return "-" if v is None else (f"{_sig(v)} {u}" if u else _sig(v))
    if not lr.get("metric_count"):
        body = "No figure had a trade estimate to grade it against."
    elif lr.get("all_in_line") or not b.get("metric"):
        body = "Every graded figure landed in line with the trade."
    else:
        gp = ""
        if b.get("gap_pct") is not None:
            gp = f'{"+" if b["gap_pct"] > 0 else ""}{_sig(b["gap_pct"])}%, '
        body = (f'{lr.get("in_line_count")} of {lr.get("metric_count")} graded figures landed in line. '
                f'Biggest miss, {_esc4(b["metric"])}: {n_(b.get("actual"), b.get("unit"))} vs '
                f'{n_(b.get("expected"), b.get("unit"))} expected '
                f'({gp}{b.get("surprise") or "no trade estimate"}).')
    re_ = (f' {_esc4(b["reaction"])}' if b.get("reaction") and b.get("reaction_from") == "settles"
           and not lr.get("all_in_line") else "")
    return (f'<div class="wp-last"><b>Last report, the {_esc4(lr.get("report"))} ({md}):</b> '
            f'{body}{re_} <a href="#track-record">Every figure</a></div>')


MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def result_banner(lr):
    if not lr or not lr.get("date"):
        return ""
    age = (datetime.now().date() - datetime.strptime(lr["date"], "%Y-%m-%d").date()).days
    if age < 0 or age > 45:
        return ""
    if age > 5:
        return last_line(lr)   # between reports: one line (mirrors lastLine() in the page)
    b = lr.get("biggest_surprise") or {}
    sc = "bull" if b.get("surprise") == "bullish" else ("bear" if b.get("surprise") == "bearish" else "flat")
    # metric_count is the GRADED count; a figure with no trade estimate is
    # neither in line nor a surprise, so it is named beside the count instead.
    # Mirrors resultBanner() in whats-priced-in.html.
    ung = f' ({lr["ungraded_count"]} had no trade estimate)' if lr.get("ungraded_count") else ""
    miss = (lr.get("metric_count") or 0) - (lr.get("in_line_count") or 0)
    if not lr.get("metric_count"):
        sum_txt = f"No figure in this report had a trade estimate to grade it against{ung}."
    elif lr.get("all_in_line"):
        sum_txt = ("Landed in line across the board, no real surprise versus "
                   f"what the trade had priced in{ung}.")
    else:
        sum_txt = (f'{lr["in_line_count"]} of {lr["metric_count"]} graded figures landed in line '
                   f'with the trade{ung}. '
                   + ("The biggest miss:" if miss > 1 else "The one that didn’t:"))
    big = ""
    if b.get("metric") and not lr.get("all_in_line"):
        gp = ""
        if b.get("gap_pct") is not None:
            sign = "+" if b["gap_pct"] > 0 else ""
            gp = f' &middot; {sign}{b["gap_pct"]}% vs trade'
        reaction = f'<div class="wp-res-reaction">{esc(b["reaction"])}</div>' if b.get("reaction") else ""
        # Mirrors resultBanner()'s inNote: the pipeline's range context.
        in_note = ""
        if b.get("context") and b.get("low") is not None and b.get("high") is not None:
            c = b["context"]
            in_note = (f'<div class="wp-res-reaction">{esc(c[:1].upper() + c[1:])} '
                       f'({_sig(b["low"])} to {_sig(b["high"])}).</div>')
        big = (
            '<div class="wp-res-big">'
            f'<div class="wp-res-row"><span class="wp-res-metric">{esc(b["metric"])}</span>'
            f'<span class="wp-res-tag {sc}">{b.get("surprise") or "no trade estimate"}</span></div>'
            f'<div class="wp-res-nums"><b>{num(b.get("actual"), b.get("unit"))}</b> actual &middot; '
            f'{num(b.get("expected"), b.get("unit"))} expected{gp}</div>'
            f'{in_note}{reaction}</div>'
        )
    return (
        f'<div class="wp-result {sc}"><div class="wp-res-hd">'
        f'<span class="wp-res-k">How the {esc(lr["report"])} landed</span>'
        f'<span class="wp-res-d">{lr["date"]}</span></div>'
        f'<div class="wp-res-sum">{sum_txt}</div>{big}'
        f'{numbers_el(lr.get("numbers"))}'
        '<div class="wp-res-foot">Every figure, scored, in the '
        '<a href="#track-record">track record</a> below.</div></div>'
    )


def fmt_num_nbsp(n, u):
    if n is None:
        return "n/a"
    return f"{n} {u}" if u else str(n)


def history_el(h):
    if not h:
        return '<div class="wp-err">No scored reports yet.</div>'
    groups, idx = [], {}
    for r in h:
        k = f'{r["date"]}|{r["report"]}'
        if k not in idx:
            idx[k] = len(groups)
            groups.append({"date": r["date"], "report": r["report"], "rows": []})
        groups[idx[k]]["rows"].append(r)
    out = []
    for g in groups:
        surp = [r for r in g["rows"] if r.get("surprise") and r["surprise"] != "in line"]
        # A GROUP WITH NOTHING SCORED DID NOT LAND IN LINE. Mirrors historyEl().
        scored_rows = [r for r in g["rows"] if r.get("surprise")]
        pill = (f'{len(surp)} surprise{"s" if len(surp) > 1 else ""}' if surp
                else ("all in line" if scored_rows else "not scored"))
        pill_cls = "surp" if surp else "line"
        ordered = sorted(g["rows"], key=lambda r: 0 if (r.get("surprise") and r["surprise"] != "in line") else 1)
        body = []
        for r in ordered:
            cls = "bull" if r.get("surprise") == "bullish" else ("bear" if r.get("surprise") == "bearish" else "flat")
            # An empty surprise means there was no estimate to compare against,
            # which is not the same as landing in line. See report_bands.py.
            tag = "not graded" if r.get("ungraded_why") else (r.get("surprise") or "no trade estimate")
            gp = r.get("gap_pct")
            ctx = f' &middot; {esc(r["context"])}' if r.get("context") else ""
            gap_line = (f'<div class="wp-hr-gap">{"+" if gp > 0 else ""}{gp}% vs trade{ctx}</div>'
                        if gp is not None else "")
            if r.get("ungraded_why"):
                gap_line += f'<div class="wp-hr-gap">{esc(r["ungraded_why"])}</div>'
            elif r.get("source_date_unknown"):
                gap_line += '<div class="wp-hr-gap">Trade survey source date unknown.</div>'
            # USDA CORRECTED THE PRINT LATER: the figure above is as printed; the
            # dated correction and the grade against it, from the builder.
            if (r.get("nass_correction") or {}).get("note"):
                gap_line += f'<div class="wp-hr-gap wp-hr-corr">{esc(r["nass_correction"]["note"])}</div>'
            src_link = (" " + source_links.link(r["reaction_source"], "Source", ' rel="nofollow noopener" target="_blank"')
                        if r.get("reaction_source") and not source_links.is_data_source(r["reaction_source"]) else "")
            reaction = (f'<div class="wp-hr-reaction">{esc(r["reaction"])}{src_link}</div>' if r.get("reaction")
                        else f'<div class="wp-hr-gap">{esc(r.get("reaction_why") or "No note written on how the market took it.")}</div>')
            body.append(
                f'<div class="wp-hr"><div class="wp-hr-top"><span class="wp-hr-metric">{esc(r["metric"])}</span>'
                f'<span class="wp-tag {cls}">{tag}</span></div>'
                f'<div class="wp-hr-nums">{fmt_num_nbsp(r.get("expected"), r.get("unit"))} '
                f'<span class="wp-arrow">→</span> <b class="{cls}">{fmt_num_nbsp(r.get("actual"), r.get("unit"))}</b></div>'
                f'{gap_line}{reaction}</div>'
            )
        out.append(
            f'<div class="wp-hg"><div class="wp-hg-hd"><span class="wp-hg-rpt">{esc(g["report"])}</span>'
            f'<span class="wp-hg-meta"><span class="wp-hg-pill {pill_cls}">{pill}</span>'
            f'<span class="wp-hg-date">{g["date"]}</span></span></div>{"".join(body)}</div>'
        )
    return "".join(out)


def bias_cell(b):
    if b is None:
        return '<span class="as-bias">-</span>'
    if abs(b) < 0.25:
        return '<span class="as-bias">&#8776; even</span>'
    hi = b > 0
    sign = "+" if hi else ""
    return (f'<span class="as-bias"><span class="{"hi" if hi else "lo"}">'
            f'{sign}{b:.2f}% {"high" if hi else "low"}</span></span>')


def spread_note(r):
    """THE SPREAD TRAVELS WITH THE MEAN. 2.11% over four calls that ran 1.60%
    to 2.46% and 2.11% over four that all landed on 2.11% are different
    records, and the board printed them the same way."""
    lo, hi = r.get("err_min"), r.get("err_max")
    if lo is None or hi is None:
        return ""
    if (r.get("n") or 0) < 2 or (hi - lo) < 0.005:
        return ""
    return u'<span class="as-spread">calls ran %.2f\u2013%.2f%%</span>' % (lo, hi)


def derived_note(r):
    """A MIDPOINT WE COMPUTED, SAID ON THE BOARD ROW TOO. Port of derivedNote()
    in whats-priced-in.html. The per-report rows already mark it; the board
    averaged the same figure and said nothing."""
    d = r.get("derived_n") or 0
    if not d:
        return ""
    t = (u"midpoint of a stated range" if d == r.get("n")
         else u"%d of %d a midpoint of a stated range" % (d, r.get("n") or 0))
    return (u'<span class="as-res-derived" title="The forecaster published a range, not a '
            u'point. AGSIST scored its midpoint so the call could be scored at all.">%s</span>' % t)


def wins_badge(r):
    """CLOSEST OF WHO FILED IS NOT A WIN. Both badges this board had ever
    awarded sat on forecasts FURTHER from the print than the free consensus
    two columns to the left."""
    wins = r.get("wins") or 0
    if r.get("closest_n") is None:
        # An older scorecard file, where `wins` counted closest alone.
        if not wins:
            return ""
        return (u'<span class="as-wins mut" title="Closest of the forecasters who filed a '
                u'number for that metric. It does not mean the call beat the trade '
                u'consensus.">%d\u00d7 closest filed</span>' % wins)
    out = ""
    if wins:
        out += (u'<span class="as-wins" title="Closest of everyone on record for that metric, '
                u'and closer to the print than the trade consensus. A midpoint we worked out from a published range does not count.">%d\u00d7 closest, beat '
                u'trade</span>' % wins)
    only = (r.get("closest_n") or 0) - wins
    if only > 0:
        out += (u'<span class="as-wins mut" title="Closest of the forecasters who filed a number '
                u'for that metric, but still further from the print than the free trade '
                u'consensus, so it did not beat the trade.">%d\u00d7 closest filed, wider than '
                u'trade</span>' % only)
    return out


def board_row(r, rank, min_n, show_rank):
    beat_cls = "as-beat" if (r.get("beat_rate") is not None and r["beat_rate"] >= 50) else "as-beat lo"
    # THE COUNT, NOT ONLY THE RATE. "0%" over three calls and "0%" over thirty
    # are not the same claim about a forecaster.
    if r.get("beat_yes") is not None and r.get("beat_n") is not None:
        cnt = u'<span class="as-mut"> &middot; %d of %d</span>' % (r["beat_yes"], r["beat_n"])
    elif r.get("beat_n") is not None and r.get("beat_n") != r.get("n"):
        cnt = u'<span class="as-mut"> of %d</span>' % r["beat_n"]
    else:
        cnt = ""
    if r.get("beat_rate") is None:
        beat = (u'<span class="as-mut" title="None of this forecaster\u2019s scored calls had a '
                u'trade estimate to beat">no trade to beat</span>')
    else:
        beat = (u'<span class="as-cell"><span class="%s">%s%%</span>%s</span>'
                % (beat_cls, r["beat_rate"], cnt))
    qualified = bool(r.get("qualified", True))
    calls = str(r["n"]) if qualified else u"%s of %s" % (r["n"], min_n)
    # We run this board AND we are on it. Say so on the row, not only in the
    # firm line -- a reader scanning names should not have to notice the domain.
    ours = (u'<span class="as-ours" title="AGSIST’s own model, scored by the same rules as '
            u'everyone else.">ours</span>'
            if "agsist.com" in (r.get("firm") or "").lower() else "")
    rk = (u'<td class="rk" data-label="#">%s</td>' % (rank if rank else u"n/a")) if show_rank else ""
    return (u'<tr%s>%s'
            u'<td data-label="Analyst"><span class="who">%s</span>%s<span class="firm">%s</span>%s</td>'
            u'<td class="num" data-label="Calls">%s</td>'
            u'<td class="num" data-label="Avg error"><span class="as-cell">'
            u'<span class="as-acc">%.2f%%</span>%s%s</span></td>'
            u'<td class="num" data-label="Beat trade">%s</td>'
            u'<td class="num" data-label="Bias">%s</td></tr>'
            % ("" if qualified else ' class="as-building"', rk,
               esc(r["analyst"]), ours, esc(r["firm"]), wins_badge(r),
               calls, r["mape"], spread_note(r), derived_note(r), beat, bias_cell(r.get("bias"))))


ORD_MIN = 10


def board_tbl(rows, building, min_n=3, cls=None, ord_min=None):
    """ONE TABLE PER METRIC CLASS, AND NO ORDINAL IT CANNOT SUPPORT.

    score() used to add every error percentage into one mean regardless of
    metric, so one soybean ending-stocks call at 2.58% off carried a
    forecaster over the 3-call bar and he printed "#1" on a record that was
    really two yield calls. And "#1 1.81%" over "#2 2.11%" is a finishing
    order asserted on three and four observations with a 0.30-point gap.
    Ordinals now need two qualifying forecasters AND ord_min calls each;
    under that the "#" column is not rendered at all, because a column of
    dashes still tells a reader a place exists and is being withheld.
    """
    min_n = min_n or 3
    ord_min = ord_min or ORD_MIN
    rows = rows or []
    building = building or []
    if not rows and not building:
        return '<div class="as-err">No forecasters scored yet.</div>'
    if cls and cls.get("ordinals_ok") is not None:
        ordinals = bool(cls["ordinals_ok"])
    else:
        ordinals = len(rows) > 1 and all((r.get("n") or 0) >= ord_min for r in rows)
    span = 6 if ordinals else 5
    head = (u'<table class="as-tbl"><thead><tr>'
            + (u'<th>#</th>' if ordinals else u'')
            + u'<th>Analyst</th><th class="num">Calls</th><th class="num">Avg error</th>'
              u'<th class="num">Beat trade</th><th class="num">Bias</th></tr></thead><tbody>')
    cap = ""
    if cls and cls.get("label"):
        n_calls = cls.get("calls")
        cap = (u'<tr class="as-cap"><td colspan="%d"><b>%s</b>%s. Errors are averaged inside '
               u'this group only: a 2%% miss on a yield and a 2%% miss on ending stocks are '
               u'not the same miss, and this page does not add them together.</td></tr>'
               % (span, esc(cls["label"]),
                  (u' \u00b7 %d scored call%s' % (n_calls, "" if n_calls == 1 else "s"))
                  if n_calls is not None else u""))
    body = u"".join(board_row(r, (i + 1) if ordinals else None, min_n, ordinals)
                    for i, r in enumerate(rows))
    brows = u"".join(board_row(r, None, min_n, ordinals) for r in building)
    note = u""
    if building and rows:
        note = (u'<tr class="as-split"><td colspan="%d">Still building. Listed above the '
                u'line once a forecaster has <b>%d scored calls in this group</b>. Their accuracy '
                u'so far is real and is shown; their position is not, because %d calls is not a '
                u'record.</td></tr>' % (span, min_n, min_n - 1))
    lead = u""
    if not rows:
        lead = (u'<div class="as-err" style="margin-bottom:.6rem">Too few scored calls in '
                u'this group yet. Building records below.</div>')
    elif len(rows) == 1:
        lead = (u'<div class="as-err" style="margin-bottom:.6rem">Too few scored calls to rank '
                u'forecasters yet, so this board shows records, not places.</div>')
    elif not ordinals:
        lead = (u'<div class="as-err" style="margin-bottom:.6rem">Listed by average error, with '
                u'no places: too few scored calls yet for an order to mean anything.</div>')
    return lead + head + cap + body + note + brows + u'</tbody></table>'


def primary_class(asd):
    """The class the main board renders, matching the page's own choice."""
    classes = asd.get("classes") or None
    if not classes:
        return None
    key = asd.get("primary_class") or classes[0].get("key")
    for c in classes:
        if c.get("key") == key:
            return c
    return classes[0]


sys.path.insert(0, str(Path(__file__).resolve().parent))
from grade_calls import pct as _pct   # one rounding rule, shared with build_scorecard


# ── Scorecard renderers ────────────────────────────────────────────────────

def fdate(iso):
    if not iso:
        return ""
    y, m, d = iso.split("-")
    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    return f"{months[int(m) - 1]} {int(d)}, {y}"


def sc_pill(o):
    if o == "played_out":
        return '<span class="sc-pill sc-pill--good">✓ Played out</span>'
    if o == "didnt":
        return '<span class="sc-pill sc-pill--bad">✗ Didn’t</span>'
    return '<span class="sc-pill sc-pill--pending">⏳ Pending</span>'


def sc_row(r):
    date_txt = (f'Called {fdate(r["made"])} · graded {fdate(r["judged"])}'
                if r.get("made") else f'Graded {fdate(r.get("judged"))}')
    if r.get("made"):
        made = (f'<a href="/daily/{esc(r["made"])}" class="sc-date" '
                f'aria-label="Read the briefing this call appeared in">{esc(date_txt)}</a>')
    else:
        made = f'<span class="sc-date">{esc(date_txt)}</span>'
    note = f'<div class="sc-note">{esc(r["note"])}</div>' if r.get("note") else ""
    # THE BAND TAG. 61 of the 80 machine-graded calls put the level outside the
    # one-session band computed from that instrument's own realized moves. The
    # gate has said so at generation time since August and the record counted
    # them anyway, so the warning reached nobody. The hit rate is untouched --
    # what a reader gets is the ability to see which calls were the kind that
    # one session could plausibly settle.
    band = ""
    if r.get("band") in ("too_far", "too_near"):
        label = ("beyond one session" if r["band"] == "too_far"
                 else "inside the noise")
        band = (f'<span class="sc-band" title="{esc(r.get("band_detail") or "")}">'
                f'level {label}</span>')
    return ('<div class="sc-row">'
            f'<div class="sc-row-top">{made}{band}{sc_pill(r.get("outcome"))}</div>'
            f'<div class="sc-call">{esc(r.get("call"))}</div>{note}</div>')


def _sc_det(d):
    """The machine-checked series. The headline never blends it with the
    self-graded era (two methods, not comparable)."""
    return (d.get("by_method") or {}).get("deterministic") or {}


def sc_stats_html(d):
    det = _sc_det(d)
    g, p = det.get("graded"), det.get("played")
    hit = f'{det["hit_rate"]}%' if det.get("hit_rate") is not None else "-"
    cs = d.get("current_streak") or 0
    streak = f'{cs} win{"" if cs == 1 else "s"}' if cs > 0 else "none"
    if g is None:
        rec, total = "-", "-"
    else:
        rec = f'{p or 0}&ndash;{det.get("missed") or 0}&ndash;{d.get("pending") or 0}'
        total = str(g)
    return (
        f'<div class="sc-stat"><div class="sc-stat-num" id="sc-hit">{hit}</div><div class="sc-stat-lbl">Hit rate, graded by rule</div></div>\n'
        f'        <div class="sc-stat"><div class="sc-stat-num" id="sc-record">{rec}</div><div class="sc-stat-lbl">W &ndash; L &ndash; pending</div></div>\n'
        f'        <div class="sc-stat"><div class="sc-stat-num" id="sc-streak">{streak}</div><div class="sc-stat-lbl">Current win streak</div></div>\n'
        f'        <div class="sc-stat"><div class="sc-stat-num" id="sc-total">{total}</div><div class="sc-stat-lbl">Calls graded</div></div>'
    )


def sc_sample_html(d):
    det = _sc_det(d)
    if not det.get("graded"):
        return "-"
    return (f'{det["played"]} of {det["graded"]} calls, '
            f'{fdate(det.get("first"))} to {fdate(det.get("last"))}')


def sc_self_html(d):
    sr = (d.get("by_method") or {}).get("self_reported") or {}
    if not sr.get("graded"):
        return "-"
    return (f'{sr["played"]} of {sr["graded"]} ({sr["hit_rate"]}%), '
            f'{fdate(sr.get("first"))} to {fdate(sr.get("last"))}')


def sc_eras_html(d):
    """The two-eras figures. Hand-typed once, they went stale by 2x on the very
    number the paragraph nominates as the honest one. Baked from by_method now."""
    m = d.get("by_method") or {}
    sr, det = m.get("self_reported") or {}, m.get("deterministic") or {}
    def part(label, o):
        p, g = o.get("played"), o.get("graded")
        if p is None or not g:
            return f"{label}, not yet scored"
        return f"{label}, {p} of {g} ({_pct(p, g)}%)"
    return ("<b>" + part("Self-graded", sr) + ". " + part("Graded against the settlement price by rule", det) + ".</b>")


def sc_list_html(d, limit=25):
    recs = d.get("records") or []
    if not recs:
        return ('<div class="sc-loading">No graded calls yet. Check back after '
                'the next briefing.</div>')
    rows = "".join(sc_row(r) for r in recs[:limit])
    more = ""
    # recs includes pending calls; "graded" must not.
    n_graded = sum(1 for r in recs if (r.get("outcome") or "") != "pending")
    n_pending = len(recs) - n_graded
    pend = f" ({n_pending} pending)" if n_pending else ""
    if len(recs) > limit:
        more = (f'<p class="sc-note" style="margin-top:.7rem">Showing the latest {limit} of '
                f'{n_graded} graded calls{pend}. The full record loads on this page with '
                f'JavaScript, and every briefing is readable under <a href="/daily#past">past briefings</a>.</p>')
    return rows + more


# ── Marker machinery ───────────────────────────────────────────────────────

# ── THE HOMEPAGE USDA CARD, BAKED FROM THE SAME GRADES ──────────────────────
#
# Until 2026-10-10 this card was typed into index.html by hand "alongside the
# next report". On Oct 10 it still showed the Sept 30 Grain Stocks over an
# October WASDE that had printed the day before. It is baked here now, every
# time the What's Priced In data is, from the same history rows the track
# record renders, so the homepage and that page cannot grade one print two ways.
HOME_HTML = "index.html"


def _short_day(iso):
    try:
        return datetime.strptime(iso, "%Y-%m-%d").strftime("%b %-d")
    except (TypeError, ValueError):
        return ""


def home_usda_card(wpi):
    lr = (wpi or {}).get("latest_result") or {}
    date, rpt = lr.get("date"), lr.get("report")
    rows = [r for r in (wpi or {}).get("history") or [] if r.get("date") == date]
    if not date or not rpt or not rows:
        return ""
    graded = [r for r in rows if r.get("surprise") in ("bullish", "bearish", "in line")]
    off = [r for r in graded if r["surprise"] != "in line"]
    ung = len(rows) - len(graded)
    if not graded:
        line = "No figure in this report had a trade estimate to grade it against."
    elif not off:
        line = f"All {len(graded)} graded figures landed in line with the trade average."
    else:
        b = max(off, key=lambda r: abs(r.get("gap_pct") or 0))
        sign = "+" if (b.get("gap_pct") or 0) > 0 else ""
        line = (f"{len(graded) - len(off)} of {len(graded)} graded figures in line with the trade. "
                f"Biggest miss: {esc(b['metric'])}, {sign}{b.get('gap_pct')}%, {b['surprise']}.")
    if ung:
        line += f" {ung} had no trade estimate."
    items = []
    for r in rows:
        u = f" {r['unit']}" if r.get("unit") else ""
        if r.get("expected") is None:
            words = "no trade estimate"
        else:
            words = r.get("surprise") or "not graded"
            if r.get("context"):
                words += ", " + r["context"]
            words = f"trade {_sig(r['expected'])}. {words[:1].upper() + words[1:]}"
        items.append(f"<p>{esc(r['metric'])}: {_sig(r['actual'])}{esc(u)}, {esc(words)}.</p>")
    return (
        '<div class="usda-cal-card gs-card">'
        '<div class="gs-head">'
        f'<span class="gs-t">{esc(rpt)} &middot; {_short_day(date)}</span>'
        '<a href="/usda-calendar#priced-in" class="gs-src">USDA, graded</a></div>'
        f'<div class="gs-line">{line}</div>'
        '<details class="gs-more"><summary>Every figure against the trade</summary>'
        + "".join(items) +
        '<p>Graded on the distance from the trade average: 0.5% for a yield, 1% for '
        'production, 2% for stocks. <a href="/usda-calendar#priced-in">What&rsquo;s Priced In</a></p>'
        '</details></div>'
    )


def bake_home():
    with open(WPI_JSON, encoding="utf-8") as f:
        wpi = json.load(f)
    with open(HOME_HTML, encoding="utf-8") as f:
        src = f.read()
    orig = src
    src = replace_region(src, "home-usda", home_usda_card(wpi), HOME_HTML)
    return orig, src, HOME_HTML


# ── THE TOP OF /usda-calendar: USDA AGAINST THE TRADE, AS PICTURES ─────────
#
# Nov 10, 2026: the released numbers sat 16 phone screens down. The page now opens on one card
# per graded number (USDA big, the trade average, USDA's figure before, and a bar: dot = USDA,
# line = the trade's low to high, tick = the trade average), the same look as the share picture.
# Before a release, or when nothing was graded, the same spot shows the next report and what the
# trade expects. Plain numbers only: the grading method stays in the fold at the bottom.
# Static: the jobs that grade a report rebake this in the same commit (and daily).
TOP_ORDER = (r"^corn_yield", r"^corn_\d", r"^soy_yield", r"^soy_\d", r"^wheat_\d", r"^corn_prod", r"^soy_prod")
TOP_UNITS = {"bil bu": "billion bu", "mil bu": "million bu"}
TOP_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
              "October", "November", "December"]
# The big crop reports all print at noon Eastern; the site shows Central.
TOP_NOON = re.compile(r"WASDE|Crop Production|Grain Stocks|Plantings|Acreage", re.I)


def _top_n(x):
    """4574 -> '4,574'; 179.6 stays 179.6."""
    if isinstance(x, (int, float)) and abs(x) >= 1000 and float(x).is_integer():
        return f"{int(x):,}"
    return _sig(x)


def _top_rank(key):
    for i, p in enumerate(TOP_ORDER):
        if re.search(p, key or ""):
            return i
    return len(TOP_ORDER)


def _top_label(label):
    """'2026/27 corn ending stocks' -> ('2026/27', 'Corn ending stocks')."""
    m = re.match(r"^\s*(\d{4}/\d{2})\s+(.*)$", label or "")
    yr, rest = (m.group(1), m.group(2)) if m else ("", label or "")
    return yr, rest[:1].upper() + rest[1:]


def _top_graded(rows):
    return [r for r in (rows or []) if r.get("actual") is not None and r.get("expected") is not None]


def _top_sorted(rows):
    return [r for _, r in sorted(enumerate(rows), key=lambda x: (_top_rank(x[1].get("key")), x[0]))]


def _top_join(names):
    """['corn ending stocks', 'soybean ending stocks'] -> 'corn and soybean ending stocks'."""
    names = [n.lower() for n in names]
    if not names:
        return ""
    tails = {n.split(" ", 1)[1] if " " in n else "" for n in names}
    if len(names) > 1 and len(tails) == 1 and "" not in tails:
        heads = [n.split(" ", 1)[0] for n in names]
        return (", ".join(heads[:-1]) + " and " + heads[-1] + " " + tails.pop())
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]


def top_headline(rows):
    """One plain line from the grades: under or over the trade, never a price call."""
    g = _top_graded(rows)
    out = [r for r in g if r.get("surprise") in ("bullish", "bearish")]
    if not g:
        return ""
    if not out:
        return "In line with the trade: every graded number landed close to the trade average."
    under = [_top_label(r.get("label"))[1] for r in out if r["actual"] < r["expected"]]
    over = [_top_label(r.get("label"))[1] for r in out if r["actual"] > r["expected"]]
    if under and not over:
        return ("Tighter than the trade expected: " + _top_join(under)
                + " came in under the trade average.")
    if over and not under:
        return ("Looser than the trade expected: " + _top_join(over)
                + " came in over the trade average.")
    return ("Mixed against the trade: " + _top_join(under) + " came in under the trade average, "
            + _top_join(over) + " over it.")


def _top_unit(u):
    return TOP_UNITS.get(u or "", u or "")


def _top_bar(v, avg, lo, hi, label):
    """Dot = USDA (or nothing before a release), line = trade low to high, tick = trade average."""
    pts = [x for x in (v, avg, lo, hi) if x is not None]
    if lo is None or hi is None or not pts or max(pts) <= min(pts):
        return ""
    a, b = min(pts), max(pts)

    def p(x):
        return f"{(x - a) / (b - a) * 100:.1f}%"
    tick = f'<span class="ct-tick" style="left:{p(avg)}"></span>' if avg is not None else ""
    dot = f'<span class="ct-dot" style="left:{p(v)}"></span>' if v is not None else ""
    return (f'<div class="ct-bar" role="img" aria-label="{esc(label)}">'
            f'<span class="ct-line" style="left:{p(lo)};right:{100 - (hi - a) / (b - a) * 100:.1f}%"></span>'
            f'{tick}{dot}</div><div class="ct-ends" aria-hidden="true"><span>{_top_n(lo)}</span><span>{_top_n(hi)}</span></div>')


def _top_card(r, before_word):
    _, name = _top_label(r.get("label"))
    u = _top_unit(r.get("unit"))
    v, avg, lo, hi = r.get("actual"), r.get("expected"), r.get("low"), r.get("high")
    tag = ""
    if r.get("surprise") == "in line":
        tag = '<span class="ct-tag">In line</span>'
    elif r.get("surprise") in ("bullish", "bearish"):
        tag = ('<span class="ct-tag ct-off">' + ("Under" if v < avg else "Over") + " the trade</span>")
    prev = (f' &middot; {esc(before_word)} {_top_n(r["usda_current"])}' if r.get("usda_current") is not None else "")
    label = (f"USDA {_top_n(v)} {u}, trade range {_top_n(lo)} to {_top_n(hi)}, trade average {_top_n(avg)}"
             if lo is not None and hi is not None else "")
    return (f'<li class="ct-c"><div class="ct-k">{esc(name)}{tag}</div>'
            f'<div class="ct-v"><b class="ct-big">{_top_n(v)}</b> <span class="ct-u">{esc(u)}</span></div>'
            f'<div class="ct-vs">Trade <b>{_top_n(avg)}</b>{prev}</div>'
            f'{_top_bar(v, avg, lo, hi, label)}</li>')


def _top_next_card(r):
    """Before a release: the trade's average big, its range, and USDA's standing figure."""
    _, name = _top_label(r.get("label"))
    u = _top_unit(r.get("unit"))
    avg, lo, hi, now = r.get("expected"), r.get("low"), r.get("high"), r.get("usda_current")
    if avg is None:
        big, vs = now, "USDA now"
        bar = ""
    else:
        big, vs = avg, ("Trade average" + (f" &middot; USDA now {_top_n(now)}" if now is not None else ""))
        bar = _top_bar(None, avg, lo, hi, f"Trade range {_top_n(lo)} to {_top_n(hi)} {u}, average {_top_n(avg)}")
    if big is None:
        return ""
    return (f'<li class="ct-c"><div class="ct-k">{esc(name)}</div>'
            f'<div class="ct-v"><b class="ct-big">{_top_n(big)}</b> <span class="ct-u">{esc(u)}</span></div>'
            f'<div class="ct-vs">{vs}</div>{bar}</li>')


def _top_day(iso):
    d = datetime.strptime(iso, "%Y-%m-%d")
    return d.strftime("%a, %b ") + str(d.day) + d.strftime(", %Y")


def _top_srcs(rows):
    out = []
    for r in rows:
        s = r.get("source")
        if s and s not in out:
            out.append(s)
    return out


def top_results(lr, up):
    rows = _top_sorted(_top_graded(lr.get("numbers")))
    yr = _top_label(rows[0].get("label"))[0] if rows else ""
    rep = lr.get("report") or "USDA report"
    when = _top_day(lr["date"]) + (", 11:00 a.m. CT" if TOP_NOON.search(rep) else "")
    m = re.match(r"(\d{4})-(\d{2})", lr["date"])
    before = ("USDA in " + TOP_MONTHS[(int(m.group(2)) - 2) % 12]) if (m and re.search("WASDE", rep)) else "USDA before"
    inl = sum(1 for r in rows if r.get("surprise") == "in line")
    tb = (up or {}).get("to_beat") or {}
    no = tb.get("wasde_no") if tb.get("date") == lr.get("date") else None
    usda = source_links.link(tb.get("source") or "https://www.usda.gov/oce/commodity/wasde",
                             "USDA " + esc(no or rep), ' rel="noopener" target="_blank"')
    srcs = _top_srcs(rows)
    trade = ", ".join(source_links.link(s, esc(re.sub(r"^https?://(www\.)?", "", s).split("/")[0]),
                                        ' rel="nofollow noopener" target="_blank"') for s in srcs)
    return ('<div class="ct-hd"><span class="ct-kick">Latest report: USDA vs the trade</span>'
            f'<span class="ct-when">{esc(rep)} &middot; {when}</span></div>'
            f'<h2 class="ct-h" id="latest-h">{esc(top_headline(rows))}</h2>'
            f'<p class="ct-sub">{inl} of {len(rows)} numbers landed in line with the trade average'
            + (f' &middot; {esc(yr)} marketing year' if yr else "") + '.</p>'
            '<ul class="ct-grid">' + "".join(_top_card(r, before) for r in rows) + '</ul>'
            '<p class="ct-key"><span class="ct-key-dot"></span> USDA <span class="ct-key-line"></span> trade range '
            '<span class="ct-key-tick"></span> trade average</p>'
            f'<p class="ct-src">Source: {usda}, {_top_day(lr["date"])}'
            + (f'. Trade average and range: {trade}' if trade else "")
            + '. <a href="#priced-in">Every number in a table</a></p>')


def top_next(up, lr):
    if not up or not up.get("date"):
        return ('<div class="ct-hd"><span class="ct-kick">Next report</span></div>'
                '<h2 class="ct-h" id="latest-h">No USDA report is on the board right now.</h2>'
                '<p class="ct-src"><a href="#all-dates">All 2026 and 2027 dates</a></p>')
    d = days_until(up["date"])
    cd = f"{d} days out" if d > 1 else ("tomorrow" if d == 1 else ("today" if d == 0 else ""))
    rep = up.get("report") or "Next USDA report"
    t = (up.get("time") or "").replace("12:00 PM ET", "11:00 a.m. CT")
    when = _top_day(up["date"]) + (f", {t}" if t else "") + (f" &middot; {cd}" if cd else "")
    rows = [r for r in _top_sorted(up.get("numbers") or []) if r.get("expected") is not None]
    if rows:
        cards = "".join(_top_next_card(r) for r in rows)
        sub = "What the trade expects, from the pre-report survey."
        srcs = _top_srcs(rows)
        src = ("Trade average and range: " + ", ".join(
            source_links.link(s, esc(re.sub(r"^https?://(www\.)?", "", s).split("/")[0]),
                              ' rel="nofollow noopener" target="_blank"') for s in srcs) + ". ") if srcs else ""
    else:
        tb = up.get("to_beat") or {}
        cards = "".join(_top_next_card({"label": x.get("label"), "unit": x.get("unit"), "usda_current": x.get("value"),
                                        "key": x.get("key")}) for x in _top_sorted(tb.get("rows") or []))
        why = ((up.get("withheld") or {}).get("range") or "").split(". ")[0].rstrip(".")
        sub = ("No trade survey is on file yet" if not why else esc(why)) + ". The numbers to beat are USDA&rsquo;s own, standing until then."
        src = (("Numbers to beat: " + source_links.link(tb.get("source") or "", "USDA " + esc(tb.get("wasde_no") or tb.get("report") or ""),
                                                         ' rel="noopener" target="_blank"') + ". ") if tb.get("rows") else "")
    last = ""
    g = _top_graded((lr or {}).get("numbers"))
    if g and lr.get("date") and lr.get("date") != up.get("date"):
        last = (f'Last report: {esc(lr.get("report"))}, {_top_day(lr["date"])}, '
                f'{sum(1 for r in g if r.get("surprise") == "in line")} of {len(g)} numbers in line. ')
    return ('<div class="ct-hd"><span class="ct-kick">Next report</span>'
            f'<span class="ct-when">{when}</span></div>'
            f'<h2 class="ct-h" id="latest-h">{esc(rep)}</h2>'
            f'<p class="ct-sub">{sub}</p>'
            + (f'<ul class="ct-grid">{cards}</ul>' if cards else "")
            + (('<p class="ct-key"><span class="ct-key-line"></span> trade range <span class="ct-key-tick"></span> '
                'trade average</p>') if rows else "")
            + f'<p class="ct-src">{src}{last}<a href="#next-report">What the trade expects, in full</a></p>')


def top_mode(wpi):
    """'results' when the last report has graded numbers, is under 46 days old and the next
    report has no trade survey on file yet; otherwise 'next'."""
    lr, up = wpi.get("latest_result") or {}, wpi.get("upcoming") or {}
    if not lr.get("date") or not _top_graded(lr.get("numbers")):
        return "next"
    age = (datetime.now().date() - datetime.strptime(lr["date"], "%Y-%m-%d").date()).days
    if age < 0 or age > 45:
        return "next"
    survey = any(r.get("expected") is not None for r in (up.get("numbers") or []))
    if survey and up.get("date") and up.get("date") != lr.get("date"):
        return "next"
    return "results"


def top_block(wpi):
    lr, up = wpi.get("latest_result") or {}, wpi.get("upcoming")
    if top_mode(wpi) == "results":
        return f'<div class="ct ct-res" data-mode="results">{top_results(lr, up)}</div>'
    return f'<div class="ct ct-next" data-mode="next">{top_next(up, lr)}</div>'


def replace_region(src, name, content, fname):
    open_m = f"<!-- PRERENDER:{name} -->"
    close_m = f"<!-- /PRERENDER:{name} -->"
    pat = re.compile(re.escape(open_m) + r".*?" + re.escape(close_m), re.S)
    if not pat.search(src):
        sys.exit(f"FATAL: marker {name} not found in {fname} — markers must exist in the HTML.")
    return pat.sub(open_m + content + close_m, src)


def bake_wpi(check_only=False):
    with open(WPI_JSON, encoding="utf-8") as f:
        wpi = json.load(f)
    with open(AS_JSON, encoding="utf-8") as f:
        asd = json.load(f)
    with open(WPI_HTML, encoding="utf-8") as f:
        src = f.read()
    orig = src
    src = replace_region(src, "cal-top", top_block(wpi), WPI_HTML)
    src = replace_region(src, "wp-result", result_banner(wpi.get("latest_result")), WPI_HTML)
    src = replace_region(src, "wp-nexthead", next_head(wpi.get("upcoming")), WPI_HTML)
    src = replace_region(src, "wp-farmbox", farm_box(wpi.get("upcoming")), WPI_HTML)
    # ONE TABLE: if the next card is still the report the banner graded, the
    # banner carries its numbers. Mirrors the page's fetch handler.
    _up, _lr = wpi.get("upcoming") or {}, wpi.get("latest_result") or {}
    _skip = bool(_up.get("date") and _up.get("date") == _lr.get("date")
                 and result_banner(wpi.get("latest_result")))
    src = replace_region(src, "wp-next", next_card(wpi.get("upcoming"), _skip), WPI_HTML)
    src = replace_region(src, "wp-history", history_el(wpi.get("history")), WPI_HTML)
    pcls = primary_class(asd)
    src = replace_region(src, "as-board",
                         board_tbl(asd.get("leaderboard"), asd.get("building"),
                                   asd.get("min_n"), pcls, asd.get("ordinal_min_n")),
                         WPI_HTML)
    if wpi.get("updated"):
        # only the What's priced in Dataset block: the calendar's own markup keeps its date
        def _stamp(b):
            return re.sub(r'("dateModified":")(\d{4}-\d{2}-\d{2})(")',
                          lambda m: m.group(1) + wpi["updated"] + m.group(3), b.group(0), count=1)
        src = re.sub(r'<script type="application/ld\+json" id="wp-dataset-ld">.*?</script>', _stamp, src, count=1, flags=re.S)
    return orig, src, WPI_HTML


def bake_scorecard(check_only=False):
    with open(SC_JSON, encoding="utf-8") as f:
        sc = json.load(f)
    with open(SC_HTML, encoding="utf-8") as f:
        src = f.read()
    # the next-report pointer lives in whats-priced-in.json (single source for
    # "which report is next"), so scorecard reads it rather than keeping a copy
    try:
        with open(WPI_JSON, encoding="utf-8") as f:
            _up = json.load(f).get("upcoming")
    except (OSError, ValueError):
        _up = None
    orig = src
    src = replace_region(src, "sc-nextrep", sc_next_report(_up), SC_HTML)
    src = replace_region(src, "sc-stats", "\n        " + sc_stats_html(sc) + "\n      ", SC_HTML)
    src = replace_region(src, "sc-list", sc_list_html(sc), SC_HTML)
    src = replace_region(src, "sc-eras", sc_eras_html(sc), SC_HTML)
    src = replace_region(src, "sc-sample", sc_sample_html(sc), SC_HTML)
    src = replace_region(src, "sc-selfrow", sc_self_html(sc), SC_HTML)
    if _sc_det(sc).get("hit_rate") is not None:
        src = replace_region(src, "sc-prose-hit", f"{_sc_det(sc)['hit_rate']}%", SC_HTML)
    return orig, src, SC_HTML


# ── COT bake (same pattern; JS hides the baked block on hydrate) ──
# (ag-odds.html was retired 2026-10; its odds now live on the homepage.)

COT_HTML = "cot.html"
COT_JSON = "data/cot.json"

COT_LABELS = {"corn": "Corn", "beans": "Soybeans", "wheat": "Chicago wheat",
              "kcwheat": "KC wheat", "mplswheat": "Minneapolis wheat",
              "soymeal": "Soymeal", "soyoil": "Soyoil", "livecattle": "Live cattle",
              "feedercattle": "Feeder cattle", "leanhogs": "Lean hogs", "milk": "Milk"}


def cot_summary(d):
    rows = []
    for key, lbl in COT_LABELS.items():
        c = d.get(key)
        if not isinstance(c, dict) or c.get("net") is None:
            continue
        net, prev = c["net"], c.get("prev")
        # The pipeline's side (fetch_cot.side_of), so this crawler text and the
        # page's cards cannot disagree about a position inside the flat band.
        sd = c.get("side") or ("long" if net >= 0 else "short")
        chg = ""
        if prev is not None:
            delta = net - prev
            chg = f', {"+" if delta >= 0 else "−"}{abs(delta):,} on the week'
        if sd == "flat":
            side_txt = (f"funds near flat (net {'long' if net >= 0 else 'short'} {abs(net):,} "
                        f"contracts, under {d.get('flat_oi_pct', 2.0)}% of open interest)")
        else:
            side_txt = f"funds net {sd} {abs(net):,} contracts"
        rows.append(f'<b>{lbl}</b> {side_txt}{chg}')
    if not rows:
        return ""
    # Benchmark review, Oct 29, 2026: the Tuesday the positions were held and the day CFTC released
    # them, plainly (cot_calendar.release_date, the rule the release watcher uses).
    rel = ""
    try:
        import cot_calendar
        rd = datetime.strptime(d.get("report_date", ""), "%B %d, %Y").date()
        r = cot_calendar.release_date(rd)
        rel = ", released %s, %s %d" % (r.strftime("%A"), r.strftime("%B"), r.day)
    except Exception:
        rel = ""
    return (f'Managed-money positioning on <b>Tuesday, {esc(d.get("report_date", ""))}</b>{rel}: '
            + "; ".join(rows[:6]) + ". Full 52-week context, price overlay, and every market below.")


COT_CX_JSON = "data/cot-analysis.json"
# components/cot-glance.js NAMES: the market inside a sentence
COT_NAMES = {"corn": "corn", "beans": "soybeans", "wheat": "Chicago wheat", "kcwheat": "KC wheat",
             "mplswheat": "Minneapolis wheat", "soymeal": "soybean meal", "soyoil": "soybean oil",
             "livecattle": "live cattle", "feedercattle": "feeder cattle", "leanhogs": "lean hogs",
             "milk": "Class III milk"}
_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
_MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _clock_et(hhmm):
    h, m = (int(x) for x in (hhmm or "15:30").split(":"))
    return f"{h % 12 or 12}:{m:02d} {'AM' if h < 12 else 'PM'} ET"


def cot_next_words(d):
    """'Friday Nov 6, 3:30 PM ET' (and ' (holiday week)' when moved off Friday), from
    cot.json next_release (cot_calendar.release_date). The JS-off text of the release
    bar and the answer line; the live page says 'today' and counts down
    (components/cot-glance.js release()). Never depends on the clock, so
    check_cot_baked.py gives the same answer every day."""
    try:
        nd = datetime.strptime(d.get("next_release") or "", "%Y-%m-%d").date()
    except ValueError:
        return ""
    mv = " (holiday week)" if nd.weekday() != 4 else ""
    return f"{_DAYS[nd.weekday()]} {_MON3[nd.month - 1]} {nd.day}, {_clock_et(d.get('next_release_time_et'))}{mv}"


def cot_release_html(d):
    w = cot_next_words(d)
    return f"Next report: {esc(w)}" if w else "CFTC releases the report Fridays at 3:30 PM ET"


# components/cot-glance.js WHO: the market before "funds" in a headline
COT_WHO = {"corn": "Corn", "beans": "Soybean", "wheat": "Chicago wheat", "kcwheat": "KC wheat",
           "mplswheat": "Minneapolis wheat", "soymeal": "Soybean meal", "soyoil": "Soybean oil",
           "livecattle": "Live cattle", "feedercattle": "Feeder cattle", "leanhogs": "Lean hog",
           "milk": "Class III milk"}


def _cot_facts(d, cx, key):
    """(report day, net, chg, side, crowd) as components/cot-glance.js facts() reads them, or None."""
    c = d.get(key)
    if not isinstance(c, dict) or c.get("net") is None:
        return None
    try:
        rd = datetime.strptime(d.get("report_date", ""), "%B %d, %Y").date()
    except ValueError:
        return None
    a = ((cx or {}).get("commodities") or {}).get(key)
    if not (a and (a.get("date") or "") == rd.isoformat() and isinstance(a.get("net"), (int, float))):
        a = None
    src = a or c
    net = src["net"]
    chg = src.get("chg") if isinstance(src.get("chg"), int) else (net - src["prev"] if isinstance(src.get("prev"), int) else None)
    sd = "flat" if src.get("side") == "flat" else ("long" if net > 0 else "short" if net < 0 else "flat")
    return rd, net, chg, sd, (a or {}).get("crowd") or {}


def cot_head(d, cx, key="corn"):
    """The chart's headline, the same as components/cot-glance.js brief(): what changed, then where funds stand."""
    f = _cot_facts(d, cx, key)
    if not f:
        return "Managed money net position, last 52 weeks"
    _, net, chg, sd, _ = f
    who, n = COT_WHO.get(key, key) + " funds", (lambda v: f"{abs(v):,}")
    prev = None if chg is None else net - chg
    still = False
    if chg is None:
        head = f"{who}: net {'short' if net < 0 else 'long'} {n(net)} contracts."
    elif chg == 0:
        head, still = f"{who} held their position.", True
    elif prev > 0 and net > 0:
        head, still = (f"{who} cut their net long by {n(chg)} contracts." if chg < 0 else f"{who} added {n(chg)} contracts to their net long."), True
    elif prev < 0 and net < 0:
        head, still = (f"{who} cut their net short by {n(chg)} contracts." if chg > 0 else f"{who} added {n(chg)} contracts to their net short."), True
    elif prev > 0 > net:
        head = f"{who} sold {n(chg)} contracts and flipped to net short."
    elif prev < 0 < net:
        head = f"{who} bought {n(chg)} contracts and flipped to net long."
    else:
        head = f"{who} {'bought' if chg > 0 else 'sold'} {n(chg)} contracts."
    if chg is None:
        stand = ""
    elif net == 0:
        stand = "Now even: no net position."
    elif sd == "flat":
        stand = f"About even: net {'short' if net < 0 else 'long'} {n(net)}."
    else:
        stand = f"{'Still' if still else 'Now'} net {sd}: {n(net)}."
    return f"<b>{esc(head)}</b>" + (f" {esc(stand)}" if stand else "")


def cot_how(d, cx, key="corn"):
    """Longs and shorts under the headline, the same as components/cot-glance.js how(): the line
    scripts/cot_analysis.py how_changed() wrote into the analysis card (card.how.line), as it stands. Empty unless the
    analysis is for the report on the page and its long and short counts are data/cot.json's."""
    c = d.get(key) if isinstance(d.get(key), dict) else {}
    try:
        rd = datetime.strptime(d.get("report_date", ""), "%B %d, %Y").date().isoformat()
    except ValueError:
        return ""
    a = ((cx or {}).get("commodities") or {}).get(key) or {}
    h = (a.get("card") or {}).get("how") or {}
    if a.get("date") != rd or not isinstance(h.get("line"), str) or a.get("mm_long") != c.get("long") \
            or a.get("mm_short") != c.get("short") or c.get("long") is None:
        return ""
    return esc(h["line"])


def _cot_full(dd):
    return f"{_DAYS[dd.weekday()][:3]}, {_MON3[dd.month - 1]} {dd.day}, {dd.year}"


def cot_answer(d, cx, key="corn"):
    """The answer line under the headline, the same sentence as components/cot-glance.js answer() (without
    'today', see cot_next_words): the week and the release day with the year, a measured record, the rank."""
    f = _cot_facts(d, cx, key)
    if not f:
        return ""
    rd, net, chg, sd, cr = f
    rel = None
    for r in (((cx or {}).get("release_date") if (cx or {}).get("report_date") == rd.isoformat() else None), d.get("release_date")):
        try:
            rel = datetime.strptime(r or "", "%Y-%m-%d").date()
            break
        except ValueError:
            continue
    when = f"Week to {_cot_full(rd)}." + (f" Released {_cot_full(rel)}." if rel else "")
    rec = re.sub(r"^the ", "", cr.get("record") or "")
    rec = (rec[0].upper() + rec[1:] + ".") if rec else ""
    words = cr.get("words") if isinstance(cr.get("shown"), (int, float)) and cr.get("since") else None
    rank = f"Rank: {words} (share of open interest)." if words else ""
    did = " ".join(x for x in (when, rec, rank) if x)
    w = cot_next_words(d)
    return esc(did) + (f" Next report: {esc(w)}." if w else "")


COT_Q_JSON = "data/cot-questions.json"


def _qa_day(iso):
    try:
        x = datetime.strptime(iso or "", "%Y-%m-%d").date()
    except ValueError:
        return ""
    return f"{_DAYS[x.weekday()][:3]}, {_MON3[x.month - 1]} {x.day}, {x.year}"


def cot_qa(d, cx):
    """Last week's question, this week's answer (kit v2 part 2): the block on /cot, baked in full from the
    questions the analysis wrote (cot-analysis.json "questions", else data/cot-questions.json,
    scripts/cot_questions.py) when they are for the report on the page; nothing script-drawn, so it moves
    nothing. Empty (the heading's section hidden by its own :empty rule) when they are for another week."""
    q = (cx or {}).get("questions")
    if not q:
        try:
            with open(COT_Q_JSON, encoding="utf-8") as f:
                q = json.load(f)
        except (OSError, ValueError):
            q = None
    try:
        rd = datetime.strptime(d.get("report_date", ""), "%B %d, %Y").date().isoformat()
    except ValueError:
        rd = ""
    if not q or not rd or q.get("report_date") != rd:
        return ""
    out = []
    lw, tw = q.get("last_week"), q.get("this_week")
    if lw:
        a = lw.get("answer", "")
        yn, rest = (a.split(" ", 1) + [""])[:2] if a.startswith(("Yes.", "No.")) else ("", a)
        out.append('<div class="cq-i"><p class="cq-k">Last week&rsquo;s question, from the report of '
                   f'{esc(_qa_day(lw.get("asked")))}</p><p class="cq-q">{esc(lw.get("question", ""))}</p>'
                   f'<p class="cq-a">{"<b>" + esc(yn) + "</b> " if yn else ""}{esc(rest)}</p></div>')
    if tw:
        nw = cot_next_words(d)
        out.append('<div class="cq-i"><p class="cq-k">This week&rsquo;s question, answered by the next report'
                   f'{", " + esc(nw) if nw else ""}</p><p class="cq-q">{esc(tw.get("question", ""))}</p>'
                   f'<p class="cq-f">{esc(tw.get("fact", ""))}</p></div>')
    arch = [x for x in (q.get("archive") or [])[1 if lw else 0:] if x.get("answer")]
    if arch:
        out.append('<details class="cq-arch"><summary>Earlier questions</summary><ol class="cq-ol">' + "".join(
            f'<li><span class="cq-q">{esc(x.get("question", ""))}</span> {esc(x.get("answer", ""))}</li>' for x in arch)
            + "</ol></details>")
    return "".join(out)


def bake_cot():
    with open(COT_JSON, encoding="utf-8") as f:
        d = json.load(f)
    try:
        with open(COT_CX_JSON, encoding="utf-8") as f:
            cx = json.load(f)
    except (OSError, ValueError):
        cx = None
    with open(COT_HTML, encoding="utf-8") as f:
        src = f.read()
    orig = src
    src = replace_region(src, "cot-summary", cot_summary(d), COT_HTML)
    src = replace_region(src, "cot-release", cot_release_html(d), COT_HTML)
    src = replace_region(src, "cot-head", cot_head(d, cx), COT_HTML)
    src = replace_region(src, "cot-answer", cot_answer(d, cx), COT_HTML)
    src = replace_region(src, "cot-how", cot_how(d, cx), COT_HTML)
    src = replace_region(src, "cot-qa", cot_qa(d, cx), COT_HTML)
    return orig, src, COT_HTML


# ── ONE PRINT, ONE VERDICT, ACROSS THE TWO FILES THIS PAGE READS ─────────────
#
# whats-priced-in.json (track record, report strip) and analyst-scorecard.json
# ("Scored, by report") are written by two builders and rendered on one page.
# On 2026-10-06 they disagreed about September 2026 soybean yield: IN LINE in
# the track record (range-first, 52.8 inside 51.5-53.3) and BEARISH under the
# forecaster scores (0.5% band only). Both call report_bands.surprise; one was
# not passing it the range. This compares every (report date, metric label) the
# two files share and --check fails on any difference, so the next drift is a
# red run instead of a page that contradicts itself.
def verdict_conflicts(wpi, asd):
    """[(date, label, wpi_verdict, scorecard_verdict)] wherever they differ."""
    mine = {}
    for r in (wpi or {}).get("history") or []:
        if r.get("date") and r.get("metric"):
            mine.setdefault((r["date"], r["metric"]), set()).add(r.get("surprise") or "")
    for blk in ((wpi or {}).get("latest_result"), (wpi or {}).get("upcoming")):
        for n in (blk or {}).get("numbers") or []:
            if blk.get("date") and n.get("label") and n.get("actual") is not None:
                mine.setdefault((blk["date"], n["label"]), set()).add(n.get("surprise") or "")
    out = []
    for rep in (asd or {}).get("reports") or []:
        for m in rep.get("metrics") or []:
            k = (rep.get("date"), m.get("label"))
            theirs = m.get("surprise") or ""
            for v in sorted(mine.get(k, ())):
                if v != theirs:
                    out.append((k[0], k[1], v, theirs))
    # and the whats-priced-in file must agree with itself
    for k, vs in mine.items():
        if len(vs) > 1:
            out.append((k[0], k[1], " / ".join(sorted(vs)), "(within whats-priced-in.json)"))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="verify only; exit 1 if stale")
    args = ap.parse_args()

    stale = []
    # bake_scorecard is retired (2026-10-03). scorecard.html is now the
    # prediction bot's page, which reads data/predictions.json and carries
    # none of the old PRERENDER:sc-* regions. The old call scorecard's data
    # (data/scorecard.json) stays in the repo as an archive, unshown.
    for bake in (bake_wpi, bake_cot, bake_home):
        orig, new, fname = bake()
        if new != orig:
            if args.check:
                stale.append(fname)
            else:
                with open(fname, "w", encoding="utf-8") as f:
                    f.write(new)
                print(f"Baked {fname}.")
        else:
            print(f"{fname} already in sync.")
    with open(WPI_JSON, encoding="utf-8") as f:
        _wpi = json.load(f)
    with open(AS_JSON, encoding="utf-8") as f:
        _asd = json.load(f)
    conflicts = verdict_conflicts(_wpi, _asd)
    for c in conflicts:
        print("VERDICT CONFLICT: %s %s: whats-priced-in.json says %r, "
              "analyst-scorecard.json says %r" % c)
    if not conflicts:
        print("Verdicts agree across whats-priced-in.json and analyst-scorecard.json.")
    if args.check and (stale or conflicts):
        if stale:
            print(f"STALE: {', '.join(stale)} — run prerender_wpi_scorecard.py")
        sys.exit(1)


if __name__ == "__main__":
    main()
