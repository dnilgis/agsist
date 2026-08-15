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
  whats-priced-in.html : PRERENDER:wp-result  (latest-report banner, 5-day window)
                         PRERENDER:wp-nexthead (the <h2> that names the next report)
                         PRERENDER:wp-farmbox (the "here is what to do about it" box)
                         PRERENDER:wp-next    (next-report expectation card)
                         PRERENDER:wp-history (scored track record)
                         PRERENDER:as-board   (analyst leaderboard / building table)
                         + Dataset JSON-LD dateModified stamp
  scorecard.html       : PRERENDER:sc-nextrep (next-report pointer box)
                         PRERENDER:sc-stats   (hit rate / W-L-pending / streak / total)
                         PRERENDER:sc-prose-hit (the "A NN% hit rate" sentence number)
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
from datetime import datetime, timezone

WPI_HTML = "whats-priced-in.html"
SC_HTML = "scorecard.html"
WPI_JSON = "data/whats-priced-in.json"
AS_JSON = "data/analyst-scorecard.json"
SC_JSON = "data/scorecard.json"


def esc(s):
    return htmlmod.escape(str("" if s is None else s), quote=True)


def num(n, u=""):
    if n is None:
        return "—"
    return f"{n} {u}".strip() if u else str(n)


def days_until(date_iso):
    # Mirrors the page JS exactly: Math.ceil((date 12:00 local - now) / 86400000)
    import math
    t = datetime.strptime(date_iso, "%Y-%m-%d").replace(hour=12)
    now = datetime.now()
    return math.ceil((t - now).total_seconds() / 86400)


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
                '<a href="/presell-calculator">safe pre-sell</a>.</div>')
    when = _report_when(n)
    metric = esc(n.get("metric", "the next set of USDA numbers"))
    return ('<div class="wp-farmbox"><b>' + esc(n.get("report", "Next report")) +
            (f' &mdash; {when}.</b> ' if when else '.</b> ') +
            f'{metric}. If you are holding unpriced bushels, know the number to beat '
            'before that morning. Your own numbers: <a href="/breakeven">break-even</a> '
            '&middot; <a href="/presell-calculator">safe pre-sell</a>.</div>')


def sc_next_report(n):
    if not n:
        return ('<b style="color:var(--text)">No USDA report scheduled.</b> '
                'See <a href="/usda-calendar" style="color:var(--gold)">the calendar</a>.')
    when = _report_when(n)
    return ('<b style="color:var(--text)">' + (when + ': ' if when else '') + '</b>' +
            esc(n.get("report", "Next USDA report")) + ' &mdash; ' +
            esc(n.get("metric", "the next USDA numbers")) + '. See '
            '<a href="/whats-priced-in" style="color:var(--gold)">what the trade has '
            'priced in</a> before the number drops.')


def next_card(n):
    if not n:
        return ('<div class="wp-err">No upcoming report is scheduled right now. '
                'Check the <a href="/usda-calendar" style="color:var(--wp-gold2)">USDA calendar</a>.</div>')
    d = days_until(n["date"])
    cd = f"{d} days out" if d > 1 else ("tomorrow" if d == 1 else ("today" if d == 0 else "released"))
    lo, hi, av, u = n.get("estimate_low"), n.get("estimate_high"), n.get("estimate_avg"), n.get("unit") or ""
    range_html = ""
    if lo is not None and hi is not None and hi > lo:
        p_av = ((av - lo) / (hi - lo) * 100) if av is not None else 50
        range_html = (
            f'<div class="wp-range"><span>{lo}</span><span class="wp-rbar">'
            f'<span class="span" style="left:0;right:0"></span>'
            f'<span class="avg" style="left:{p_av:.0f}%"></span></span><span>{hi}</span></div>'
            f'<div class="wp-metric">Trade range for {esc(n["metric"])} &middot; '
            f'avg <b style="color:var(--wp-gold2)">{esc(num(av, u))}</b></div>'
        )
    odds = ""
    if n.get("implied_odds"):
        rows = "".join(
            f'<div class="o"><div class="ol"><span>{o["label"]}</span><span>{o["pct"]}%</span></div>'
            f'<div class="ot"><span class="of" style="width:{o["pct"]}%"></span></div></div>'
            for o in n["implied_odds"]
        )
        odds = f'<div class="wp-odds">{rows}</div>'
    thr = ""
    if n.get("bullish_threshold") or n.get("bearish_threshold"):
        thr = (
            '<div class="wp-thr">'
            f'<div class="t bull"><div class="k">Bullish surprise</div><div class="v">{n.get("bullish_threshold") or "—"}</div></div>'
            f'<div class="t bear"><div class="k">Bearish surprise</div><div class="v">{n.get("bearish_threshold") or "—"}</div></div></div>'
        )
    pos = f'<div class="wp-pos">Fund positioning: {esc(n["positioning"])}</div>' if n.get("positioning") else ""
    commodity = (
        f'<div class="wp-metric">{esc(n["commodity"])} — {esc(n.get("metric", ""))}</div>'
        if n.get("commodity") else ""
    )
    expectation = f'<div class="wp-exp">{esc(n["expectation"])}</div>' if n.get("expectation") else ""
    time_part = f' · {n["time"]}' if n.get("time") else ""
    return (
        f'<div class="wp-card"><div class="hd"><span class="rpt">{esc(n["report"])}</span>'
        f'<span class="cd">{esc(n["date"])}{time_part} · {cd}</span></div>'
        f'{commodity}{expectation}{range_html}{odds}{thr}{pos}</div>'
    )


def result_banner(lr):
    if not lr or not lr.get("date"):
        return ""
    age = (datetime.now().date() - datetime.strptime(lr["date"], "%Y-%m-%d").date()).days
    if age < 0 or age > 5:
        return ""  # mirrors the JS: banner only lives ~5 days, then history has it
    b = lr.get("biggest_surprise") or {}
    sc = "bull" if b.get("surprise") == "bullish" else ("bear" if b.get("surprise") == "bearish" else "flat")
    if lr.get("all_in_line"):
        sum_txt = ("Landed in line across the board &mdash; no real surprise versus "
                   "what the trade had priced in.")
    else:
        sum_txt = (f'{lr["in_line_count"]} of {lr["metric_count"]} figures landed in line '
                   f'with the trade. The one that didn’t:')
    big = ""
    if b.get("metric") and not lr.get("all_in_line"):
        gp = ""
        if b.get("gap_pct") is not None:
            sign = "+" if b["gap_pct"] > 0 else ""
            gp = f' &middot; {sign}{b["gap_pct"]}% vs trade'
        reaction = f'<div class="wp-res-reaction">{esc(b["reaction"])}</div>' if b.get("reaction") else ""
        big = (
            '<div class="wp-res-big">'
            f'<div class="wp-res-row"><span class="wp-res-metric">{esc(b["metric"])}</span>'
            f'<span class="wp-res-tag {sc}">{b.get("surprise") or "in line"}</span></div>'
            f'<div class="wp-res-nums"><b>{num(b.get("actual"), b.get("unit"))}</b> actual &middot; '
            f'{num(b.get("expected"), b.get("unit"))} expected{gp}</div>'
            f'{reaction}</div>'
        )
    return (
        f'<div class="wp-result {sc}"><div class="wp-res-hd">'
        f'<span class="wp-res-k">How the {esc(lr["report"])} landed</span>'
        f'<span class="wp-res-d">{lr["date"]}</span></div>'
        f'<div class="wp-res-sum">{sum_txt}</div>{big}'
        '<div class="wp-res-foot">Every figure, scored, in the '
        '<a href="#track-record">track record</a> below.</div></div>'
    )


def fmt_num_nbsp(n, u):
    if n is None:
        return "—"
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
        pill = f'{len(surp)} surprise{"s" if len(surp) > 1 else ""}' if surp else "all in line"
        pill_cls = "surp" if surp else "line"
        ordered = sorted(g["rows"], key=lambda r: 0 if (r.get("surprise") and r["surprise"] != "in line") else 1)
        body = []
        for r in ordered:
            cls = "bull" if r.get("surprise") == "bullish" else ("bear" if r.get("surprise") == "bearish" else "flat")
            reaction = f'<div class="wp-hr-reaction">{esc(r["reaction"])}</div>' if r.get("reaction") else ""
            body.append(
                f'<div class="wp-hr"><div class="wp-hr-top"><span class="wp-hr-metric">{esc(r["metric"])}</span>'
                f'<span class="wp-tag {cls}">{r.get("surprise") or "in line"}</span></div>'
                f'<div class="wp-hr-nums">{fmt_num_nbsp(r.get("expected"), r.get("unit"))} '
                f'<span class="wp-arrow">→</span> <b class="{cls}">{fmt_num_nbsp(r.get("actual"), r.get("unit"))}</b></div>'
                f'{reaction}</div>'
            )
        out.append(
            f'<div class="wp-hg"><div class="wp-hg-hd"><span class="wp-hg-rpt">{esc(g["report"])}</span>'
            f'<span class="wp-hg-meta"><span class="wp-hg-pill {pill_cls}">{pill}</span>'
            f'<span class="wp-hg-date">{g["date"]}</span></span></div>{"".join(body)}</div>'
        )
    return "".join(out)


def bias_cell(b):
    if b is None:
        return '<span class="as-bias">&mdash;</span>'
    if abs(b) < 0.25:
        return '<span class="as-bias">&#8776; even</span>'
    hi = b > 0
    sign = "+" if hi else ""
    return (f'<span class="as-bias"><span class="{"hi" if hi else "lo"}">'
            f'{sign}{b:.2f}% {"high" if hi else "low"}</span></span>')


def board_tbl(rows, building):
    head = ('<table class="as-tbl"><thead><tr><th>#</th><th>Analyst</th>'
            '<th class="num">Calls</th><th class="num">Accuracy</th>'
            '<th class="num">Beat trade</th><th class="num">Bias</th></tr></thead><tbody>')
    if not rows and not building:
        return '<div class="as-err">No forecasters scored yet.</div>'
    if not rows:
        brows = "".join(
            '<tr style="opacity:.55"><td class="rk" data-label="#">&mdash;</td>'
            f'<td data-label="Analyst"><span class="who">{esc(r["analyst"])}</span>'
            f'<span class="firm">{esc(r["firm"])}</span></td>'
            f'<td class="num" data-label="Calls">{r["n"]} of 3</td>'
            f'<td class="num" data-label="Accuracy"><span class="as-acc">{r["mape"]:.2f}%</span></td>'
            '<td class="num" data-label="Beat trade">&mdash;</td>'
            f'<td class="num" data-label="Bias">{bias_cell(r.get("bias"))}</td></tr>'
            for r in building
        )
        return ('<div class="as-err" style="margin-bottom:.6rem">Rankings post once a forecaster has '
                f'<b>3 scored calls</b> &mdash; building records below.</div>{head}{brows}</tbody></table>')
    body = []
    for i, r in enumerate(rows):
        beat_cls = "as-beat" if (r.get("beat_rate") is not None and r["beat_rate"] >= 50) else "as-beat lo"
        beat = "&mdash;" if r.get("beat_rate") is None else f'<span class="{beat_cls}">{r["beat_rate"]}%</span>'
        body.append(
            f'<tr><td class="rk" data-label="#">{i + 1}</td>'
            f'<td data-label="Analyst"><span class="who">{esc(r["analyst"])}</span>'
            f'<span class="firm">{esc(r["firm"])}</span></td>'
            f'<td class="num" data-label="Calls">{r["n"]}</td>'
            f'<td class="num" data-label="Accuracy"><span class="as-acc">{r["mape"]:.2f}%</span></td>'
            f'<td class="num" data-label="Beat trade">{beat}</td>'
            f'<td class="num" data-label="Bias">{bias_cell(r.get("bias"))}</td></tr>'
        )
    return f'{head}{"".join(body)}</tbody></table>'


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
    return ('<div class="sc-row">'
            f'<div class="sc-row-top">{made}{sc_pill(r.get("outcome"))}</div>'
            f'<div class="sc-call">{esc(r.get("call"))}</div>{note}</div>')


def sc_stats_html(d):
    hit = f'{d["hit_rate"]}%' if d.get("hit_rate") is not None else "—"
    cs = d.get("current_streak") or 0
    streak = f'{cs} win{"" if cs == 1 else "s"}' if cs > 0 else "none"
    total = (d.get("played_out") or 0) + (d.get("didnt") or 0)
    return (
        f'<div class="sc-stat"><div class="sc-stat-num" id="sc-hit">{hit}</div><div class="sc-stat-lbl">Hit rate</div></div>\n'
        f'        <div class="sc-stat"><div class="sc-stat-num" id="sc-record">{d.get("played_out") or 0}&ndash;{d.get("didnt") or 0}&ndash;{d.get("pending") or 0}</div><div class="sc-stat-lbl">W &ndash; L &ndash; pending</div></div>\n'
        f'        <div class="sc-stat"><div class="sc-stat-num" id="sc-streak">{streak}</div><div class="sc-stat-lbl">Current win streak</div></div>\n'
        f'        <div class="sc-stat"><div class="sc-stat-num" id="sc-total">{total}</div><div class="sc-stat-lbl">Calls graded</div></div>'
    )


def sc_list_html(d, limit=25):
    recs = d.get("records") or []
    if not recs:
        return ('<div class="sc-loading">No graded calls yet — check back after '
                'the next briefing.</div>')
    rows = "".join(sc_row(r) for r in recs[:limit])
    more = ""
    if len(recs) > limit:
        more = (f'<p class="sc-note" style="margin-top:.7rem">Showing the latest {limit} of '
                f'{len(recs)} graded calls &mdash; the full record loads on this page with '
                f'JavaScript, and every briefing is readable in the <a href="/archive">archive</a>.</p>')
    return rows + more


# ── Marker machinery ───────────────────────────────────────────────────────

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
    src = replace_region(src, "wp-result", result_banner(wpi.get("latest_result")), WPI_HTML)
    src = replace_region(src, "wp-nexthead", next_head(wpi.get("upcoming")), WPI_HTML)
    src = replace_region(src, "wp-farmbox", farm_box(wpi.get("upcoming")), WPI_HTML)
    src = replace_region(src, "wp-next", next_card(wpi.get("upcoming")), WPI_HTML)
    src = replace_region(src, "wp-history", history_el(wpi.get("history")), WPI_HTML)
    src = replace_region(src, "as-board", board_tbl(asd.get("leaderboard"), asd.get("building")), WPI_HTML)
    if wpi.get("updated"):
        src = re.sub(r'("dateModified":")(\d{4}-\d{2}-\d{2})(")',
                     lambda m: m.group(1) + wpi["updated"] + m.group(3), src, count=1)
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
    if sc.get("hit_rate") is not None:
        src = replace_region(src, "sc-prose-hit", f"{round(sc['hit_rate'])}%", SC_HTML)
    return orig, src, SC_HTML


# ── COT + ag-odds bakes (same pattern; JS hides the baked block on hydrate) ──

COT_HTML = "cot.html"
COT_JSON = "data/cot.json"
AO_HTML = "ag-odds.html"
MKT_JSON = "data/markets.json"

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
        side = "net long" if net >= 0 else "net short"
        chg = ""
        if prev is not None:
            delta = net - prev
            chg = f', {"+" if delta >= 0 else "−"}{abs(delta):,} on the week'
        rows.append(f'<b>{lbl}</b> funds {side} {abs(net):,} contracts{chg}')
    if not rows:
        return ""
    return (f'Managed-money positioning as of the <b>{esc(d.get("report_date", ""))}</b> CFTC report: '
            + "; ".join(rows[:6]) + ". Full 52-week context, price overlay, and every market below.")


def ao_summary(d):
    mkts = d.get("markets") or []
    if not mkts:
        return ""
    items = []
    for m in mkts[:6]:
        t, yes = m.get("title"), m.get("yes")
        if not t or yes is None:
            continue
        items.append(f'{esc(t)} — <b>{yes}%</b> yes')
    if not items:
        return ""
    fetched = (d.get("fetched") or "")[:10]
    return (f'Prediction-market odds as of {esc(fetched)}: ' + "; ".join(items)
            + ". Live odds refresh below; sources are real-money markets (Polymarket and similar).")


def bake_cot():
    with open(COT_JSON, encoding="utf-8") as f:
        d = json.load(f)
    with open(COT_HTML, encoding="utf-8") as f:
        src = f.read()
    orig = src
    src = replace_region(src, "cot-summary", cot_summary(d), COT_HTML)
    return orig, src, COT_HTML


def bake_agodds():
    with open(MKT_JSON, encoding="utf-8") as f:
        d = json.load(f)
    with open(AO_HTML, encoding="utf-8") as f:
        src = f.read()
    orig = src
    src = replace_region(src, "ao-odds", ao_summary(d), AO_HTML)
    return orig, src, AO_HTML


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="verify only; exit 1 if stale")
    args = ap.parse_args()

    stale = []
    for bake in (bake_wpi, bake_scorecard, bake_cot, bake_agodds):
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
    if args.check and stale:
        print(f"STALE: {', '.join(stale)} — run prerender_wpi_scorecard.py")
        sys.exit(1)


if __name__ == "__main__":
    main()
