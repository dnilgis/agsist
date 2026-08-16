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

v1.4 — 2026-07-28 (front seeds prefer <crop>-nearby so "front month" is the
         true nearest contract, named; wheat Dec relabeled "deferred";
         freshly-priced meta descriptions; crawler-visible SEED:pxtable
         last-close table incl. KC/Mpls wheat; honest refresh wording)
v1.3 — 2026-07-03 (seeds hail report totals into hail-map from the manifest)
v1.3 — 2026-07-03 (seeds live report counts into hail-map stats line)
v1.2 — 2026-07-03 (hail-map added to both lists)
v1.1 — 2026-07-03 (added the weekly-changing pages to DATEMOD_ONLY: urea,
         ag-odds, cot, whats-priced-in, drought-monitor)
"""

import html as H
import json
import re
import sys
from datetime import datetime, timezone

PRICES = "data/prices.json"
SITEMAP = "sitemap.xml"

# page → (crop key, benchmark key, benchmark label, crop word)
# Grain prices in prices.json are in CENTS — divide by 100 (soybean key is "beans").
# v1.4: the front price now prefers <crop>-nearby (true nearest dated contract,
# labeled with its month) over the continuous key, which Yahoo pins to the
# MOST-ACTIVE contract — in summer that's new-crop, which is how the seed note
# once read "front-month $4.73 · December new-crop $4.73". Wheat's December is
# labeled "deferred", not "new-crop": winter wheat new-crop is July, and by
# late July the crop is harvested — Dec is a storage month of the same crop year.
PAGES = {
    "corn-futures-prices.html":    ("corn",  "corn-dec",   "December new-crop", "corn"),
    "soybean-futures-prices.html": ("beans", "beans-nov",  "November new-crop", "soybeans"),
    "wheat-futures-prices.html":   ("wheat", "wheat-dec26","December (deferred)", "wheat"),
}

# Meta-description templates. A numeric, dated description is the main
# crawler-visible CTR lever these pages have (Google may rewrite, but a fresh
# number raises the odds it keeps ours). Placeholders: {px} nearby close,
# {chg} signed pct, {mon} contract label, {date} price date, {kc} KC HRW clause.
#
# Split in two on 2026-08-16. All three descriptions were running 167-184
# characters and getting cut mid-clause in the result. The HEAD is the numeric,
# dated sentence -- the reason to click -- and it always ships. The TAIL is the
# keyword clause, and it ships only if the whole thing still fits. Losing the
# tail costs a few secondary terms; a sentence cut mid-word costs the click.
#
# This also has to survive its own inputs: {px} gains a character when beans
# cross $100 wide or a contract label runs long, and the wheat {kc} clause is
# 18 characters that appear only when the KC quote is usable. A fixed string
# cannot be checked once and trusted -- the length is decided at bake time.
DESC_MAX = 160

DESC = {
    "corn-futures-prices.html": (
        "Corn {mon} closed ${px} ({chg}) on {date} — live CBOT corn futures refreshed every "
        "30 min in session.",
        " December new-crop, RP floor, basis-to-cash, daily read."),
    "soybean-futures-prices.html": (
        "Soybeans {mon} closed ${px} ({chg}) on {date} — live CBOT soybean futures refreshed "
        "every 30 min in session.",
        " November new-crop, crush spread, cash bids."),
    "wheat-futures-prices.html": (
        "Wheat {mon} closed ${px} ({chg}) on {date} — live Chicago SRW futures refreshed every "
        "30 min in session{kc}.",
        " Class spreads, cash bids by ZIP."),
}


def render_desc(tmpl, **kw):
    """(description, note). None means do not stamp -- leave what is there.

    Entities are counted decoded, because that is what the result shows: the
    wheat description carries `&middot;` in the attribute and a single `·` in
    the SERP, and counting the source overstates it by six characters.
    """
    head, tail = tmpl
    h, t = head.format(**kw), tail.format(**kw)
    n = len(H.unescape(h))
    if n > DESC_MAX:
        return None, f"head alone is {n} chars — refusing to publish a cut sentence"
    if n + len(H.unescape(t)) <= DESC_MAX:
        return h + t, f"{n + len(H.unescape(t))} chars"
    return h, f"{n} chars, keyword tail dropped to fit"

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


def stamp_meta_description(text, desc):
    """Replace the <meta name="description"> content with a freshly-priced one.
    The description must contain no double quotes."""
    if '"' in desc:
        return text, False
    pat = re.compile(r'(<meta name="description" content=")([^"]*)(")')
    if not pat.search(text):
        return text, False
    new = pat.sub(lambda m: m.group(1) + desc + m.group(3), text, count=1)
    return new, new != text


def _chg(q):
    """Signed pct-change string for a quote, e.g. '-0.3%'. '' if missing."""
    p = q.get("pctChange")
    if p is None:
        return ""
    return ("%+.1f%%" % float(p)).replace("+0.0%", "0.0%").replace("-0.0%", "0.0%")


def px_table(rows, flabel):
    """Small crawler-visible last-close table. rows: [(label, quote)] with
    grain quotes in cents; quotes may be None (row skipped)."""
    out = ['<table class="seed-tbl"><caption>Last close &middot; as of ' + flabel +
           ' &middot; live quotes above update in session</caption>',
           '<thead><tr><th scope="col">Contract</th><th scope="col" class="num">Close</th>'
           '<th scope="col" class="num">Change</th><th scope="col" class="num">52-wk range</th>'
           '</tr></thead><tbody>']
    n = 0
    for label, q in rows:
        usd = grain_dollars(q)
        if not usd:
            continue
        n += 1
        rng = "&mdash;"
        if q.get("wk52_lo") and q.get("wk52_hi"):
            rng = "$%.2f&ndash;$%.2f" % (q["wk52_lo"] / 100.0, q["wk52_hi"] / 100.0)
        stale = " (last good quote)" if q.get("stale") else ""
        # class="num" -> tabular figures, ranged right. A price column set in a
        # proportional face and ranged left is the loudest "not a finance site"
        # signal there is; the styling rule lives once in components/styles.css.
        out.append('<tr><td>' + label + stale + '</td><td class="num">$' + usd +
                   '</td><td class="num">' + (_chg(q) or "&mdash;") +
                   '</td><td class="num">' + rng + '</td></tr>')
    out.append("</tbody></table>")
    return "".join(out) if n else None


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


def seed_cashrent(today):
    """Inject national coverage stats into cash-rent.html's SEED:crstats marker
    from data/cash-rent/national.json — a data page where JS-blind crawlers
    previously saw zero numbers (directly against the citation strategy).
    Numbers change once a year (NASS August release) + whenever the cash-rent
    workflow re-runs; idempotent otherwise."""
    try:
        d = json.load(open("data/cash-rent/national.json"))
        t = open("cash-rent.html", encoding="utf-8").read()
    except Exception:
        return False
    counties = d.get("counties") or {}
    vals = sorted(v["r"] for v in counties.values() if isinstance(v.get("r"), (int, float)))
    if not vals:
        return False
    med = vals[len(vals) // 2] if len(vals) % 2 else (vals[len(vals)//2 - 1] + vals[len(vals)//2]) / 2
    states = len({v.get("s") for v in counties.values()})
    latest_ry = max(v.get("ry", 0) for v in counties.values())
    years = d.get("pct_years") or [None, None]
    line = (f"{d.get('n_rent', len(counties)):,} counties in {states} states with a published "
            f"{latest_ry} rent &middot; median county rate ${med:.2f}/acre (non-irrigated where "
            f"available) &middot; rent-to-revenue ratio computed for {d.get('n_pct', 0):,} counties "
            f"({years[0]}&ndash;{years[-1]}) &middot; data refreshed {d.get('generated', today)}")
    t2, ch = seed_between(t, "crstats", line)
    if ch:
        open("cash-rent.html", "w", encoding="utf-8").write(t2)
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

    for page, (crop_key, bench_key, bench_label, crop) in PAGES.items():
        try:
            t = open(page, "r", encoding="utf-8").read()
        except FileNotFoundError:
            print(f"  {page}: missing — skipped")
            continue
        # True nearest dated contract when the fetcher publishes it; the
        # continuous key is the fallback (it may be pinned to most-active).
        fq = quotes.get(crop_key + "-nearby") or quotes.get(crop_key)
        mon = (fq or {}).get("contract")   # e.g. "Sep '26"; None on fallback
        bq = quotes.get(bench_key)
        f_usd = grain_dollars(fq)
        b_usd = grain_dollars(bq)
        changed = False
        if f_usd:
            stale = " (last good quote)" if fq.get("stale") else ""
            front_label = ("Nearby " + mon + " " + crop) if mon else ("Front-month " + crop)
            t, c1 = seed_between(t, "px", "$" + f_usd)
            note = (front_label + " last closed near <strong>$" + f_usd +
                    "</strong>" + stale +
                    ((" &middot; " + bench_label + " near $" + b_usd) if b_usd else "") +
                    " &middot; as of " + flabel +
                    " &middot; refreshed every 30 minutes during trading hours &mdash; reload for the latest.")
            t, c2 = seed_between(t, "note", note)
            changed = c1 or c2

            # crawler-visible last-close table (marker optional per page)
            rows = [((("Nearby " + mon) if mon else "Front month"), fq),
                    (bench_label, bq)]
            if page.startswith("wheat"):
                rows += [("KC HRW (KE, most-active)", quotes.get("kcwheat")),
                         ("Minneapolis HRS (MWE, most-active)", quotes.get("mplswheat"))]
            tbl = px_table(rows, flabel)
            if tbl:
                t, c4 = seed_between(t, "pxtable", tbl)
                changed = changed or c4

            # freshly-priced meta description
            tmpl = DESC.get(page)
            if tmpl:
                kc_usd = grain_dollars(quotes.get("kcwheat"))
                desc, dnote = render_desc(
                    tmpl, px=f_usd, chg=_chg(fq) or "flat", mon=mon or "front month",
                    date=flabel,
                    kc=(" &middot; KC HRW $" + kc_usd) if kc_usd else "")
                if desc is None:
                    print(f"  {page}: description {dnote}")
                else:
                    # entity-decode for attribute text: &middot; is fine in content=""
                    t, c5 = stamp_meta_description(t, desc)
                    changed = changed or c5
        else:
            print(f"  {page}: no usable {crop_key} quote — seeds left as-is")
        t, c3 = stamp_datemodified(t, today)
        if changed or c3:
            open(page, "w", encoding="utf-8").write(t)
            any_change = True
            print(f"  {page}: seeded ${f_usd or '—'}"
                  f"{(' / $' + b_usd) if b_usd else ''}"
                  f"{(' · ' + mon) if mon else ''} · dateModified {today}")
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
                    + " &middot; refreshed every 30 minutes during trading hours &mdash; reload for the latest.")
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
    if seed_cashrent(today):
        any_change = True
        print("  cash-rent.html: SEED:crstats seeded")

    if bump_sitemap(today):
        any_change = True
        print(f"  sitemap.xml: lastmod → {today} on {len(SITEMAP_URLS)} URLs")
    else:
        print("  sitemap.xml: no change")

    print("CHANGED" if any_change else "NO-CHANGE")


if __name__ == "__main__":
    main()
