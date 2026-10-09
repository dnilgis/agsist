#!/usr/bin/env python3
"""
bake_homepage.py — static-bake today's briefing + The Read into index.html
═══════════════════════════════════════════════════════════════════════════
WHY: index.html renders its content client-side from /data/daily.json and
/data/price-stats.json. Googlebot executes JS; GPTBot, ClaudeBot,
PerplexityBot and CCBot do not — so the most citable content AGSIST
produces was invisible to the AI crawlers the sponsor pitch is built on.

WHAT: writes today's headline, lead, action, section titles
+ bodies (subheadline is retired as of v5.1 and baked empty), and The Read's percentile numbers/sentences directly into the
empty elements hydrateDaily() targets. The browser then hydrates the same
elements with live data — baked text is the no-JS / crawler fallback, JS
remains the source of truth on screen.

Idempotent: every target is replaced wholesale on each run. Unused section
slots are emptied so a 2-section weekend brief never leaves Friday's text
behind for crawlers.

Runs from daily.yml after the critic pass (baked text == final text).
Exit codes: 0 ok, 2 data missing, 3 anchor drift (index.html markup changed
— fix the regexes here before the next deploy).
"""

import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent
INDEX = REPO_ROOT / "index.html"
DAILY = REPO_ROOT / "data" / "daily.json"
STATS = REPO_ROOT / "data" / "price-stats.json"

MAX_SECTIONS = 4  # slots present in index.html markup


def esc(s):
    if not s:
        return ""
    return (str(s).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


def md(s):
    """Escape, then promote **markdown** bold — mirrors mdInline()/
    html_esc_preserve_strong() in the client and archive renderers."""
    out = esc(s)
    out = re.sub(r"\*\*([^*]+?)\*\*", r"<strong>\1</strong>", out)
    return out


def md_body(s):
    """v5.0 briefing diet: section bodies arrive as '- ' bullet lines.
    Render as a tight inline-styled <ul> (index.html carries no bullet CSS);
    old paragraph bodies fall through to plain md()."""
    lines = [ln.strip() for ln in (s or "").split("\n") if ln.strip()]
    bullets = [ln[2:].strip() for ln in lines if ln.startswith("- ")]
    if not bullets:
        return md(s)
    rest = [ln for ln in lines if not ln.startswith("- ")]
    lis = "".join(
        '<li style="position:relative;padding-left:1rem;margin:0 0 .35rem">'
        '<span style="position:absolute;left:0;top:.55em;width:.36rem;height:.36rem;'
        'border-radius:2px;background:rgba(218,165,32,.55)"></span>'
        + md(b) + "</li>" for b in bullets)
    tail = "".join('<div style="margin-top:.4rem;font-style:italic">' + md(r) + "</div>" for r in rest)
    return '<ul style="list-style:none;margin:0;padding:0">' + lis + "</ul>" + tail


def ordinal(n):
    n = int(n)
    if 10 <= n % 100 <= 20:
        suf = "th"
    else:
        suf = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suf}"


def read_line(pct, updated):
    """Same text the homepage script writes for The Read."""
    from datetime import datetime
    from zoneinfo import ZoneInfo
    if pct is None:
        return ""
    p = int(round(pct))
    band = ("Near a 5-year low." if p < 10 else "Historically low: below most of the last 5 years." if p < 25
            else "Near a 5-year high." if p >= 90 else "Historically high: above most of the last 5 years." if p >= 75 else "")
    when = ""
    try:
        d = datetime.fromisoformat(str(updated).replace("Z", "+00:00")).astimezone(ZoneInfo("America/Chicago"))
        when = " at " + d.strftime("%b ") + str(d.day) + ", " + str(d.hour % 12 or 12) + d.strftime(":%M ") + ("AM" if d.hour < 12 else "PM") + " CT"
    except Exception:
        pass
    return (("<b>" + band + "</b> ") if band else "") + "Ranked" + when + " against 5 years of weekly front-month closes."


def replace_inner(html, open_pat, close_tag, new_inner, tag, required=True):
    """Replace everything between an element's opening tag (regex) and its
    next close_tag with new_inner. Returns (html, ok)."""
    pat = re.compile("(" + open_pat + r")(.*?)(" + re.escape(close_tag) + ")",
                     re.S)
    n = len(pat.findall(html))
    if n != 1:
        if required:
            print(f"[bake] ANCHOR DRIFT: {tag} matched {n} times")
            sys.exit(3)
        return html, False
    html = pat.sub(lambda m: m.group(1) + new_inner + m.group(3), html, count=1)
    return html, True


def main():
    if not INDEX.exists():
        print("[bake] index.html missing"); sys.exit(2)
    try:
        daily = json.loads(DAILY.read_text())
    except Exception as e:
        print(f"[bake] daily.json unreadable: {e}"); sys.exit(2)
    try:
        stats = json.loads(STATS.read_text())
    except Exception as e:
        print(f"[bake] price-stats.json unreadable ({e}) — baking briefing only")
        stats = {}

    if not daily.get("headline"):
        print("[bake] daily.json has no headline — refusing to bake empties")
        sys.exit(2)

    html = INDEX.read_text(encoding="utf-8")
    baked = []

    # ── Briefing core ────────────────────────────────────────────────
    html, _ = replace_inner(
        html, r'<h2 id="daily-headline" class="daily-headline">', "</h2>",
        esc(daily.get("headline", "")), "headline")
    baked.append("headline")

    # 2026-10-06: the briefing's own date, printed and stamped on the hero, so
    # the page script can tell a baked briefing that is still current (keep it
    # when the client fetch fails) from one that is days old (say it did not load).
    html, _ = replace_inner(
        html, r'<div id="daily-date" class="daily-date">', "</div>",
        esc(daily.get("date", "")), "date", required=False)
    iso = str(daily.get("generated_at") or "")[:10]
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", iso):
        html, n = re.subn(r'(<section class="daily-hero[^"]*" id="daily-hero")(?: data-briefing-date="[^"]*")?',
                          rf'\1 data-briefing-date="{iso}"', html, count=1)
        if n:
            baked.append("date")

    html, _ = replace_inner(
        html, r'<p id="daily-subheadline"[^>]*>', "</p>",
        esc(daily.get("subheadline", "")), "subheadline")

    html, _ = replace_inner(
        html, r'<p id="daily-lead" class="daily-lead">', "</p>",
        md(daily.get("lead", "")), "lead")

    # v5.1: the action holds the takeaway's block (same ids, label reads
    # THE ACTION). Empty action -> block stays hidden and its text is emptied,
    # so yesterday's line never survives into a day that has none.
    # 2026-10-09, Sig: the prediction bot is out of the Daily for now (it
    # lives on /scorecard). An issue whose action is the bot's call bakes none.
    action = "" if daily.get("bot_call") else (daily.get("action") or "").strip()
    html, _ = replace_inner(
        html, r'<p id="daily-takeaway-text" class="daily-takeaway-text">',
        "</p>", md(action), "action")
    if action:
        html = re.sub(
            r'(<div id="daily-takeaway"[^>]*?)\s*style="display:none"(>)',
            r"\1\2", html, count=1)
        baked.append("action")
    else:
        html = re.sub(
            r'(<div id="daily-takeaway"(?:(?!style=)[^>])*?)(>)',
            r'\1 style="display:none"\2', html, count=1)

    # ── Sections (fill used slots, EMPTY unused ones) ───────────────
    sections = daily.get("sections") or []
    for i in range(1, MAX_SECTIONS + 1):
        sec = sections[i - 1] if i <= len(sections) else {}
        html, _ = replace_inner(
            html, rf'<div id="daily-section-{i}-title" class="daily-sec-label">',
            "</div>", esc(sec.get("title", "")), f"sec{i}-title")
        html, _ = replace_inner(
            html, rf'<div id="daily-section-{i}-body" class="daily-sec-text">',
            "</div>", md_body(sec.get("body", "")), f"sec{i}-body")
    baked.append(f"{min(len(sections), MAX_SECTIONS)} sections")

    # ── The Read (price-stats) ───────────────────────────────────────
    read_map = {"corn": "corn", "soybean": "beans", "wheat": "wheat"}
    # 2026-10-06: the new homepage dropped The Read (the briefing covers it).
    # No sig-* slots on the page means nothing to bake, not anchor drift.
    if '<span id="sig-corn-num">' not in html:
        read_map = {}
        print("[bake] no Read slots on the page; skipping The Read")
    for key, sig in read_map.items():
        st = stats.get(key) or {}
        if not st.get("read"):
            continue
        pct = st.get("pct")
        html, _ = replace_inner(
            # the number now holds a nested ordinal span, so the inner text
            # runs to the span that closes right before the sub label
            html, rf'<span id="sig-{sig}-num">', f'</span><small id="sig-{sig}-sub">',
            # 2026-10-01 bake-read: number + ordinal, as the page script writes it
            (esc(int(round(pct))) + '<span class="r7-ord">' + ordinal(round(pct))[len(str(int(round(pct)))):] + '</span>') if pct is not None else "",
            f"{sig}-num")
        html, _ = replace_inner(
            html, rf'<small id="sig-{sig}-sub">', "</small>",
            "percentile" if pct is not None else "",
            f"{sig}-sub")
        # The file's own price is its build time, not the board: bake the
        # range only; the page script adds the live board price on load.
        lo, hi = st.get("lo"), st.get("hi")
        if lo is not None and hi is not None:
            html, _ = replace_inner(
                html, rf'<div class="sig-price" id="sig-{sig}-price">', "</div>",
                f"5-year range ${lo:.2f}&ndash;${hi:.2f}",
                f"{sig}-price")
        html, _ = replace_inner(
            html, rf'<div class="sig-read" id="sig-{sig}-read">', "</div>",
            read_line(st.get("pct"), stats.get("updated")), f"{sig}-read")
        baked.append(f"read:{key}")

    # cattle tile is a feeder/live ratio now: empty the old sentence
    html, _ = replace_inner(html, r'<div class="sig-read" id="sig-cattle-read">', "</div>", "", "cattle-read", required=False)
    cattle = {}
    if cattle.get("read"):
        html, _ = replace_inner(
            html, r'<div class="sig-read" id="sig-cattle-read">', "</div>",
            esc(cattle["read"]), "cattle-read")
        baked.append("read:cattle")

    INDEX.write_text(html, encoding="utf-8")
    print(f"[bake] OK ({daily.get('date', '?')}): " + ", ".join(baked))
    return 0


if __name__ == "__main__":
    sys.exit(main())
