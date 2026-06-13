#!/usr/bin/env python3
"""
bake_homepage.py — static-bake today's briefing + The Read into index.html
═══════════════════════════════════════════════════════════════════════════
WHY: index.html renders its content client-side from /data/daily.json and
/data/price-stats.json. Googlebot executes JS; GPTBot, ClaudeBot,
PerplexityBot and CCBot do not — so the most citable content AGSIST
produces was invisible to the AI crawlers the sponsor pitch is built on.

WHAT: writes today's headline, subheadline, lead, takeaway, section titles
+ bodies, and The Read's percentile numbers/sentences directly into the
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


def ordinal(n):
    n = int(n)
    if 10 <= n % 100 <= 20:
        suf = "th"
    else:
        suf = {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suf}"


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

    html, _ = replace_inner(
        html, r'<p id="daily-subheadline"[^>]*>', "</p>",
        esc(daily.get("subheadline", "")), "subheadline")

    html, _ = replace_inner(
        html, r'<p id="daily-lead" class="daily-lead">', "</p>",
        md(daily.get("lead", "")), "lead")

    takeaway = (daily.get("the_takeaway") or "").strip()
    if takeaway:
        # un-hide the container for the no-JS view (JS manages it after)
        html = re.sub(
            r'(<div id="daily-takeaway"[^>]*?)\s*style="display:none"(>)',
            r"\1\2", html, count=1)
        html, _ = replace_inner(
            html, r'<p id="daily-takeaway-text" class="daily-takeaway-text">',
            "</p>", esc(takeaway), "takeaway")
        baked.append("takeaway")

    # ── Sections (fill used slots, EMPTY unused ones) ───────────────
    sections = daily.get("sections") or []
    for i in range(1, MAX_SECTIONS + 1):
        sec = sections[i - 1] if i <= len(sections) else {}
        html, _ = replace_inner(
            html, rf'<div id="daily-section-{i}-title" class="daily-sec-label">',
            "</div>", esc(sec.get("title", "")), f"sec{i}-title")
        html, _ = replace_inner(
            html, rf'<div id="daily-section-{i}-body" class="daily-sec-text">',
            "</div>", md(sec.get("body", "")), f"sec{i}-body")
    baked.append(f"{min(len(sections), MAX_SECTIONS)} sections")

    # ── The Read (price-stats) ───────────────────────────────────────
    read_map = {"corn": "corn", "soybean": "beans", "wheat": "wheat"}
    for key, sig in read_map.items():
        st = stats.get(key) or {}
        if not st.get("read"):
            continue
        pct = st.get("pct")
        html, _ = replace_inner(
            html, rf'<span id="sig-{sig}-num">', "</span>",
            esc(pct), f"{sig}-num")
        html, _ = replace_inner(
            html, rf'<small id="sig-{sig}-sub">', "</small>",
            esc(ordinal(pct) + " pctile") if pct is not None else "",
            f"{sig}-sub")
        cur, lo, hi = st.get("cur"), st.get("lo"), st.get("hi")
        if cur is not None and lo is not None and hi is not None:
            html, _ = replace_inner(
                html, rf'<div class="sig-price" id="sig-{sig}-price">', "</div>",
                f"${cur:.2f} &middot; range ${lo:.2f}&ndash;${hi:.2f}",
                f"{sig}-price")
        html, _ = replace_inner(
            html, rf'<div class="sig-read" id="sig-{sig}-read">', "</div>",
            esc(st["read"]), f"{sig}-read")
        baked.append(f"read:{key}")

    cattle = stats.get("cattle") or {}
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
