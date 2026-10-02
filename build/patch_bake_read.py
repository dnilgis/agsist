#!/usr/bin/env python3
"""2026-10-01: the morning bake writes The Read the way the page shows it.

scripts/bake_homepage.py baked "61st pctile" and the Read file's own price
("$12.93 · 5-yr range ...") into index.html. That price is the file's build
time, not the board, and disagreed with the price tiles above it. The page's
script replaces both on load, but a reader without script, or a search
crawler, saw the stale price. Now the bake writes:
  number    61<span class="r7-ord">st</span>   (what the script writes)
  sub       percentile
  price     5-year range $3.68–$8.18            (no price; the script adds
                                                 the live board price)
Usage: python3 patch_bake_read.py --repo DIR
"""
import argparse, os, sys

MARK = '2026-10-01 bake-read'


def once(t, old, new, label):
    n = t.count(old)
    if n != 1:
        sys.exit('ANCHOR %s matched %d times, expected 1' % (label, n))
    return t.replace(old, new)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--repo', required=True)
    a = ap.parse_args()
    p = os.path.join(a.repo, 'scripts/bake_homepage.py')
    t = open(p, encoding='utf-8', newline='').read()
    if MARK in t:
        sys.exit('already applied')
    t = once(t, '''            html, rf'<span id="sig-{sig}-num">', "</span>",
            esc(pct), f"{sig}-num")''', '''            # the number now holds a nested ordinal span, so the inner text
            # runs to the span that closes right before the sub label
            html, rf'<span id="sig-{sig}-num">', f'</span><small id="sig-{sig}-sub">',
            # %s: number + ordinal, as the page script writes it
            (esc(int(round(pct))) + '<span class="r7-ord">' + ordinal(round(pct))[len(str(int(round(pct)))):] + '</span>') if pct is not None else "",
            f"{sig}-num")''' % MARK, 'num')
    t = once(t, '''            esc(ordinal(pct) + " pctile") if pct is not None else "",''',
             '''            "percentile" if pct is not None else "",''', 'sub')
    t = once(t, '''        cur, lo, hi = st.get("cur"), st.get("lo"), st.get("hi")
        if cur is not None and lo is not None and hi is not None:''', '''        # The file's own price is its build time, not the board: bake the
        # range only; the page script adds the live board price on load.
        lo, hi = st.get("lo"), st.get("hi")
        if lo is not None and hi is not None:''', 'price guard')
    t = once(t, '''                f"${cur:.2f} &middot; 5-yr range ${lo:.2f}&ndash;${hi:.2f}",''',
             '''                f"5-year range ${lo:.2f}&ndash;${hi:.2f}",''', 'price text')
    # The read line: the same sentence the page script writes, so a reader
    # without script and the page agree (the file's own sentence carried the
    # "above the 5-year midpoint" labels the page dropped).
    t = once(t, '''def replace_inner(''', '''def read_line(pct, updated):
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


def replace_inner(''', 'read_line helper')
    t = once(t, '''            esc(st["read"]), f"{sig}-read")''', '''            read_line(st.get("pct"), stats.get("updated")), f"{sig}-read")''', 'read text')
    # Cattle: the page shows a feeder/live price ratio there now, not this
    # percentile sentence. Bake nothing into it.
    t = once(t, '''    cattle = stats.get("cattle") or {}
    if cattle.get("read"):''', '''    # cattle tile is a feeder/live ratio now: empty the old sentence
    html, _ = replace_inner(html, r'<div class="sig-read" id="sig-cattle-read">', "</div>", "", "cattle-read")
    cattle = {}
    if cattle.get("read"):''', 'cattle off')
    open(p, 'w', encoding='utf-8', newline='').write(t)
    print('ok')


if __name__ == '__main__':
    main()
