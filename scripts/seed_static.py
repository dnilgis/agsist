#!/usr/bin/env python3
"""
seed_static.py — bakes the latest closes into the static HTML of the price
pages, stamps dateModified, and bumps sitemap lastmod on the daily pages.

WHY: the AI-citation strategy is static-HTML visibility. JS-blind crawlers
(Bing/ChatGPT/Perplexity fetchers) were landing on "Corn Futures Prices Today"
and finding an em-dash, because prices only ever arrived via JS. This script
runs in GitHub Actions after fetch_prices.py has written data/prices.json and
splices honest, dated, last-close numbers into the pages themselves. JS still
overwrites everything live for humans; crawlers finally see a number.

Idempotent: rewrites only between <!--SEED:*--> markers and inside existing
"dateModified" fields; a run with unchanged prices produces byte-identical
files, so the workflow's diff-gate makes no empty commits.

v1.3 — 2026-07-03 (seeds hail report totals into hail-map from the manifest)
v1.3 — 2026-07-03 (seeds live report counts into hail-map stats line)
v1.2 — 2026-07-03 (hail-map added to both lists)
v1.1 — 2026-07-03 (added the weekly-changing pages to DATEMOD_ONLY: urea,
         ag-odds, cot, whats-priced-in, drought-monitor)
"""

import json
import re
import sys
from datetime import datetime, timezone

PRICES = "data/prices.json"
SITEMAP = "sitemap.xml"

# page → (front-month key, benchmark key, benchmark label, crop word)
# Grain prices in prices.json are in CENTS — divide by 100 (soybean key is "beans").
PAGES = {
    "corn-futures-prices.html":    ("corn",  "corn-dec",   "December new-crop", "corn"),
    "soybean-futures-prices.html": ("beans", "beans-nov",  "November new-crop", "soybeans"),
    "wheat-futures-prices.html":   ("wheat", "wheat-dec26","December new-crop", "wheat"),
}

# pages whose schema dateModified is stamped with today (price pages get it in
# the loop above; these get it too because their content changes daily)
DATEMOD_ONLY = ["index.html", "markets.html", "daily.html",
                "cash-bids.html", "spray.html", "urea.html", "ag-odds.html",
                "cot.html", "whats-priced-in.html", "drought-monitor.html",
                "hail-map.html"]

# sitemap <lastmod> bump list — the daily-changing URLs Google should recrawl
SITEMAP_URLS = [
    "https://agsist.com/",
    "https://agsist.com/markets",
    "https://agsist.com/cash-bids",
    "https://agsist.com/daily",
    "https://agsist.com/corn-futures-prices",
    "https://agsist.com/soybean-futures-prices",
    "https://agsist.com/wheat-futures-prices",
    "https://agsist.com/cattle-futures-prices",
    "https://agsist.com/ag-odds",
    "https://agsist.com/spray",
    "https://agsist.com/hail-map",
]


def load_prices():
    with open(PRICES, "r") as f:
        d = json.load(f)
    return d


def grain_dollars(q):
    """Grain quote (cents) → display dollars string, or None if unusable."""
    if not q:
        return None
    c = q.get("close")
    if c is None:
        return None
    return "%.2f" % (float(c) / 100.0)


def cwt_dollars(q):
    """Cattle/feeder quote (already $/cwt) -> display string, or None."""
    if not q:
        return None
    c = q.get("close")
    if c is None:
        return None
    return "%.2f" % float(c)


def seed_between(text, tag, replacement):
    """Replace content between <!--SEED:tag--> and <!--/SEED--> (first pair after tag)."""
    pat = re.compile(r"(<!--SEED:" + re.escape(tag) + r"-->)(.*?)(<!--/SEED-->)", re.S)
    if not pat.search(text):
        return text, False
    new = pat.sub(lambda m: m.group(1) + replacement + m.group(3), text, count=1)
    return new, new != text


def stamp_datemodified(text, today):
    pat = re.compile(r'("dateModified":\s*")(\d{4}-\d{2}-\d{2})(")')
    if not pat.search(text):
        return text, False
    new = pat.sub(lambda m: m.group(1) + today + m.group(3), text)
    return new, new != text


def seed_hail(today):
    """Inject live report counts into hail-map.html's SEED:hailstats marker
    from data/hail/manifest.json — crawler-visible freshness on the page
    that competes for "recent hail" queries."""
    try:
        m = json.load(open("data/hail/manifest.json"))
        t = open("hail-map.html", encoding="utf-8").read()
    except Exception:
        return False
    years = m.get("years") or []
    counts = m.get("counts") or {}
    total = sum(int(v) for v in counts.values()) if counts else None
    recent = m.get("recent_count")
    gen = m.get("generated", "")
    if not total:
        return False
    line = (f"{total:,} NWS hail reports on the map ({years[0]}\u2013{years[-1]})"
            + (f" \u00b7 {int(recent):,} in the last {m.get('recent_days',30)} days" if recent else "")
            + (f" \u00b7 data through {gen}" if gen else ""))
    t2, ch = seed_between(t, "hailstats", line)
    if ch:
        open("hail-map.html", "w", encoding="utf-8").write(t2)
    return ch


def bump_sitemap(today):
    try:
        t = open(SITEMAP, "r", encoding="utf-8").read()
    except FileNotFoundError:
        print("  sitemap.xml not found — skipped")
        return False
    orig = t
    for url in SITEMAP_URLS:
        # match the <url> block for this exact loc, replace its lastmod
        pat = re.compile(
            r"(<loc>" + re.escape(url) + r"</loc>\s*<lastmod>)([^<]*)(</lastmod>)")
        t = pat.sub(lambda m: m.group(1) + today + m.group(3), t, count=1)
    changed = t != orig
    if changed:
        open(SITEMAP, "w", encoding="utf-8").write(t)
    return changed


def main():
    now = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")
    print(f"seed_static.py — {now.strftime('%Y-%m-%d %H:%M UTC')}")

    try:
        prices = load_prices()
    except Exception as e:
        print(f"FATAL: cannot read {PRICES}: {e}")
        sys.exit(1)
    quotes = prices.get("quotes", {})
    fetched = prices.get("fetched", "")
    # human date label from the prices file's own timestamp — never claim fresher
    # than the data actually is
    try:
        ft = datetime.strptime(fetched, "%Y-%m-%dT%H:%M:%SZ")
        flabel = ft.strftime("%b %-d") if sys.platform != "win32" else ft.strftime("%b %d").replace(" 0", " ")
    except Exception:
        flabel = today

    any_change = False

    for page, (front_key, bench_key, bench_label, crop) in PAGES.items():
        try:
            t = open(page, "r", encoding="utf-8").read()
        except FileNotFoundError:
            print(f"  {page}: missing — skipped")
            continue
        fq = quotes.get(front_key)
        bq = quotes.get(bench_key)
        f_usd = grain_dollars(fq)
        b_usd = grain_dollars(bq)
        changed = False
        if f_usd:
            stale = " (last good quote)" if fq.get("stale") else ""
            t, c1 = seed_between(t, "px", "$" + f_usd)
            note = ("Front-month " + crop + " last closed near <strong>$" + f_usd +
                    "</strong>" + stale +
                    ((" &middot; " + bench_label + " near $" + b_usd) if b_usd else "") +
                    " &middot; as of " + flabel +
                    " &middot; live quotes update every 30 minutes through the session.")
            t, c2 = seed_between(t, "note", note)
            changed = c1 or c2
        else:
            print(f"  {page}: no usable {front_key} quote — seeds left as-is")
        t, c3 = stamp_datemodified(t, today)
        if changed or c3:
            open(page, "w", encoding="utf-8").write(t)
            any_change = True
            print(f"  {page}: seeded ${f_usd or '—'}"
                  f"{(' / $' + b_usd) if b_usd else ''} · dateModified {today}")
        else:
            print(f"  {page}: no change")

    # cattle page: quotes are already $/cwt — no /100
    page = "cattle-futures-prices.html"
    try:
        t = open(page, "r", encoding="utf-8").read()
        lc = cwt_dollars(quotes.get("cattle"))
        gf = cwt_dollars(quotes.get("feeders"))
        changed = False
        if lc:
            stale = " (last good quote)" if quotes.get("cattle", {}).get("stale") else ""
            t, c1 = seed_between(t, "px", "$" + lc)
            note = ("Live cattle last closed near <strong>$" + lc + "</strong>" + stale
                    + ((" &middot; feeders near $" + gf) if gf else "")
                    + " &middot; $/cwt &middot; as of " + flabel
                    + " &middot; live quotes update every 30 minutes through the session.")
            t, c2 = seed_between(t, "note", note)
            changed = c1 or c2
        else:
            print(f"  {page}: no usable cattle quote — seeds left as-is")
        t, c3 = stamp_datemodified(t, today)
        if changed or c3:
            open(page, "w", encoding="utf-8").write(t)
            any_change = True
            print(f"  {page}: seeded ${lc or '—'}{(' / $' + gf) if gf else ''} · dateModified {today}")
        else:
            print(f"  {page}: no change")
    except FileNotFoundError:
        print(f"  {page}: missing — skipped")

    for page in DATEMOD_ONLY:
        try:
            t = open(page, "r", encoding="utf-8").read()
        except FileNotFoundError:
            print(f"  {page}: missing — skipped")
            continue
        t, c = stamp_datemodified(t, today)
        if c:
            open(page, "w", encoding="utf-8").write(t)
            any_change = True
            print(f"  {page}: dateModified {today}")
        else:
            print(f"  {page}: no change")

    # hail-map: seed crawler-visible stats from the manifest the hail Action maintains
    try:
        hm = json.load(open("data/hail/manifest.json"))
        yrs = hm.get("years", [])
        tot = sum(hm.get("counts", {}).values())
        rc = hm.get("recent_count")
        line = (f"{tot:,} National Weather Service hail reports, {yrs[0]}\u2013{yrs[-1]}"
                + (f" \u2014 {rc:,} in the last 30 days" if rc else "")
                + " \u2014 recent reports refresh daily; the full archive rebuilds monthly.") if yrs else None
        if line:
            t = open("hail-map.html", encoding="utf-8").read()
            t, ch = seed_between(t, "hailstats", line)
            t, cd = stamp_datemodified(t, today)
            if ch or cd:
                open("hail-map.html", "w", encoding="utf-8").write(t)
                any_change = True
                print("  hail-map.html: stats seeded ·", line[:60])
    except FileNotFoundError:
        pass
    except Exception as e:
        print("  hail-map stats seed skipped:", e)

    if seed_hail(today):
        any_change = True
        print("  hail-map.html: stats line seeded")

    if bump_sitemap(today):
        any_change = True
        print(f"  sitemap.xml: lastmod → {today} on {len(SITEMAP_URLS)} URLs")
    else:
        print("  sitemap.xml: no change")

    print("CHANGED" if any_change else "NO-CHANGE")


if __name__ == "__main__":
    main()
