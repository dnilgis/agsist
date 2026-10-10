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

v1.5 — 2026-10-06 (data-page body seeds: markets, news, conditions,
         scorecard, basis, elevators -- see seed_data_pages; each number
         dated from its file, em-dash with a reason when the file is stale)
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
try:
    from zoneinfo import ZoneInfo
    CT = ZoneInfo("America/Chicago")
except Exception:          # pragma: no cover - py<3.9 / no tzdata
    CT = None

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
        "Corn {mon} {verb} ${px} ({chg}) {when}. Live CBOT corn futures refreshed every "
        "30 min in session.",
        " December new-crop, RP floor, basis-to-cash, daily read."),
    "soybean-futures-prices.html": (
        "Soybeans {mon} {verb} ${px} ({chg}) {when}. Live CBOT soybean futures refreshed "
        "every 15 min in session.",
        " November new-crop, crush spread, cash bids."),
    "wheat-futures-prices.html": (
        "Wheat {mon} {verb} ${px} ({chg}) {when}. Live Chicago SRW futures refreshed every "
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
                "cash-bids.html", "spray.html", "urea.html",
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


# Day-session close, Central time. CBOT grains 1:20 p.m. CT; CME live and
# feeder cattle 1:05 p.m. CT. freshness.yml runs at 13:35 and 20:35 UTC, so the
# morning run lands IN SESSION and prices.json then carries close_date = today
# for a price that is a delayed last trade, not a close. Yahoo quotes are never
# CME settlements either way, so the words used are "closed" and "last trade".
CLOSE_CT = {"grain": (13, 20), "cattle": (13, 5)}


def quote_state(q, fetched, market="grain"):
    """How to word a quote: (in_session, label).

    in_session True  -> the quote's session had not closed when it was fetched:
                        say "last trade", label like "Oct 6, 11:50 a.m. CT".
    in_session False -> the session had closed: say "closed", label is the
                        quote's OWN date ("Oct 6"), never the run date.
    Unknown timing (no fetched/close_date) -> (None, best date label) and the
    caller uses neutral wording.
    """
    cd = (q or {}).get("close_date")
    try:
        fu = datetime.strptime(fetched, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except Exception:
        fu = None
    def md(d):
        return d.strftime("%b ") + str(d.day)
    try:
        cdd = datetime.strptime(cd, "%Y-%m-%d").date() if cd else None
    except Exception:
        cdd = None
    if fu is None or cdd is None or CT is None:
        lab = md(cdd) if cdd else (md(fu) if fu else "")
        return None, lab
    fc = fu.astimezone(CT)
    hm = CLOSE_CT.get(market, CLOSE_CT["grain"])
    before_close = fc.weekday() < 5 and (fc.hour, fc.minute) < hm
    if cdd > fc.date() or (cdd == fc.date() and before_close):
        h12 = fc.hour % 12 or 12
        ampm = "a.m." if fc.hour < 12 else "p.m."
        return True, f"{md(fc)}, {h12}:{fc.minute:02d} {ampm} CT"
    return False, md(cdd)


def state_words(in_session):
    """(verb for a sentence, short noun) for quote_state's first value."""
    if in_session is True:
        return "last traded", "Last trade"
    if in_session is False:
        return "closed", "Last close"
    return "last quoted", "Last quote"


def px_table(rows, flabel, in_session=False):
    """Small crawler-visible last-close table. rows: [(label, quote)] with
    grain quotes in cents; quotes may be None (row skipped)."""
    noun = state_words(in_session)[1]
    out = ['<table class="seed-tbl"><caption>' + noun + ' &middot; as of ' + flabel +
           ' &middot; Yahoo Finance, delayed (not CME settlements) &middot; live quotes above update in session</caption>',
           '<thead><tr><th scope="col">Contract</th><th scope="col" class="num">' +
           ("Last" if in_session else "Close") + '</th>'
           '<th scope="col" class="num">Change</th><th scope="col" class="num">52-wk range</th>'
           '</tr></thead><tbody>']
    n = 0
    for label, q in rows:
        usd = grain_dollars(q)
        if not usd:
            continue
        n += 1
        rng = "n/a"
        if q.get("wk52_lo") and q.get("wk52_hi"):
            rng = "$%.2f&ndash;$%.2f" % (q["wk52_lo"] / 100.0, q["wk52_hi"] / 100.0)
        stale = " (last good quote)" if q.get("stale") else ""
        # class="num" -> tabular figures, ranged right. A price column set in a
        # proportional face and ranged left is the loudest "not a finance site"
        # signal there is; the styling rule lives once in components/styles.css.
        out.append('<tr><td>' + label + stale + '</td><td class="num">$' + usd +
                   '</td><td class="num">' + (_chg(q) or "n/a") +
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
    rgen = m.get("recent_generated", "")
    if not total:
        return False
    # TWO VINTAGES, BOTH STATED. The multi-year archive rebuilds monthly
    # ("generated"); the 30-day layer refreshes daily ("recent_generated").
    # One "data through" date next to both counts was wrong for one of them
    # (Oct 10, 2026: "data through 2026-10-01" beside reports from Oct 9).
    def _nice(iso):
        try:
            d = datetime.strptime(str(iso)[:10], "%Y-%m-%d")
            return f"{MON3[d.month - 1]} {d.day}, {d.year}"
        except Exception:
            return str(iso)
    line = (f"{total:,} NWS hail reports on the map, {years[0]} through {_nice(gen)}" if gen
            else f"{total:,} NWS hail reports on the map ({years[0]}\u2013{years[-1]})")
    if recent:
        line += (f" \u00b7 {int(recent):,} in the {m.get('recent_days',30)} days to {_nice(rgen)}" if rgen
                 else f" \u00b7 {int(recent):,} in the last {m.get('recent_days',30)} days")
    t2, ch = seed_between(t, "hailstats", line)
    if ch:
        open("hail-map.html", "w", encoding="utf-8").write(t2)
    return ch


# seed_cashrent() lived here until 2026-10: /cash-rent retired to a stub that
# forwards to /rent/, whose builder (build_state_rent_pages.py) bakes its own
# numbers. Nothing to seed.

# ---------------------------------------------------------------- data pages
# v1.5 — 2026-10-06. Seven data pages showed a JS-blind crawler nothing but
# placeholders: /markets was eighteen em-dashes, /news said "Loading the
# wire...", /conditions carried "Corn 54%" in its title over a body that said
# "Loading USDA data...". Same doctrine as the futures pages: bake a short,
# plain-HTML reading of the page's own data file INSIDE the container the
# page's script already fills, so the script replaces it when it runs and a
# crawler sees the number when it does not.
#
# Rules, all pages:
#   - every number carries the as-of date the DATA FILE gives it, never the
#     run date
#   - a missing or stale file bakes an em-dash line that says why, never a
#     number (a seed that outlives its data is a confident wrong page)
#   - no meta description or title here: bake_seo.py owns those on these
#     pages, and one field gets one writer

MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct",
        "Nov", "Dec"]

# how old a data file may be before its numbers are withheld, in days
STALE_DAYS = {"prices": 4, "news": 10, "conditions": 14, "basis": 21,
              "elevators": 30, "predictions": 21}


def _e(s):
    """Text-node escape. Quotes stay literal: "Dec '26", not "Dec &#x27;26".
    Em dashes in data prose print as a comma, the way the pages' JS shows them."""
    s = re.sub(r"\s*\u2014\s*", ", ", re.sub(r"^\s*\u2014\s*", "", str(s)))
    return H.escape(s, quote=False)


def _iso_date(s):
    """'2026-10-04', '2026-10-06T01:23:55+00:00', '...Z' -> date or None."""
    try:
        return datetime.strptime(str(s)[:10], "%Y-%m-%d").date()
    except Exception:
        return None


def _md(d):
    return f"{MON3[d.month - 1]} {d.day}"


def _mdy(d):
    return f"{MON3[d.month - 1]} {d.day}, {d.year}"


def _asof_time(ts, feed, fallback_day=None):
    """The site's one "Updated" stamp (components/asof.js), baked: a <time>
    the page's script re-renders and marks stale when it ages. Central time,
    absolute ("Updated Oct 8, 7:10 pm") since the baked copy is read later."""
    try:
        t = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        if t.tzinfo is None:
            t = t.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return f"Updated {_mdy(fallback_day)}" if fallback_day else ""
    c = t.astimezone(CT) if CT else t
    hm = c.strftime("%I:%M").lstrip("0") + " " + c.strftime("%p").lower()
    # The ISO stamp is built outside the f-string: reusing the outer quote
    # inside one is Python 3.12+, and the COT watcher ran 3.11, so on
    # 2026-10-09 this line was a SyntaxError that stopped cot.html's bake.
    iso = t.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return (f'<time class="asof" data-asof="{feed}" datetime="{iso}">'
            f"Updated {_md(c)}, {hm}</time>")


def _stale(d, today, key):
    """True when date d is missing or older than the page's limit."""
    if d is None:
        return True
    t = datetime.strptime(today, "%Y-%m-%d").date()
    return (t - d).days > STALE_DAYS[key]


def _fixed(v, n):
    """JavaScript Number.prototype.toFixed: exact binary value, ties away
    from zero. Python's '%.2f' rounds ties to even, so 0.125 would seed 0.12
    and the page's own script would print 0.13 over it."""
    from decimal import Decimal, ROUND_HALF_UP
    q = Decimal(1).scaleb(-n)
    return str(Decimal(float(v)).quantize(q, rounding=ROUND_HALF_UP))


def _jsround(v):
    """Math.round: halves go up."""
    import math
    return int(math.floor(float(v) + 0.5))


def _commas(v):
    return f"{int(v):,}"


def _load_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _write_seeds(page, seeds, extra=None):
    """Apply {tag: html} to page; returns True when the file changed. A tag
    the page does not carry is reported, not invented."""
    try:
        t = open(page, encoding="utf-8").read()
    except FileNotFoundError:
        print(f"  {page}: missing — skipped")
        return False
    orig = t
    missing = []
    for tag, val in seeds.items():
        if ("<!--SEED:" + tag + "-->") not in t:
            missing.append(tag)
            continue
        t, _ = seed_between(t, tag, val)
    if extra:
        t = extra(t)
    if missing:
        print(f"  {page}: no marker for {', '.join(missing)}")
    if t != orig:
        open(page, "w", encoding="utf-8").write(t)
        print(f"  {page}: {len(seeds) - len(missing)} seeds written")
        return True
    print(f"  {page}: no change")
    return False


# --- /markets ----------------------------------------------------------------
# id on the page -> (quote key, grain?) ; mirrors the page script's map
MK_MAP = [
    ("corn-near", "pcp-corn-near", "pcc-corn-near", "corn", True),
    ("corn-dec", "pcp-corn-dec", "pcc-corn-dec", "corn-dec", True),
    ("bean-near", "pcp-bean-near", "pcc-bean-near", "beans", True),
    ("bean-nov", "pcp-bean-nov", "pcc-bean-nov", "beans-nov", True),
    ("wheat", "pcp-wheat", "pcc-wheat", "wheat", True),
    ("oats", "pcp-oats", "pcc-oats", "oats", True),
    ("cattle", "pcp-cattle", "pcc-cattle", "cattle", False),
    ("feeder", "pcp-feeder", "pcc-feeder", "feeders", False),
    ("hogs", "pcp-hogs", "pcc-hogs", "hogs", False),
    ("milk", "pcp-milk", "pcc-milk", "milk", False),
    ("crude", "pcp-crude", "pcc-crude", "crude", False),
    ("natgas", "pcp-natgas", "pcc-natgas", "natgas", False),
    ("meal", "pcp-meal", "pcc-meal", "meal", False),
    ("oil", "pcp-oil", "pcc-oil", "soyoil", False),
    ("gold", "pc-gold", "pcc-gold", "gold", False),
    ("silver", "pc-silver", "pcc-silver", "silver", False),
    ("dxy", "pcp-dxy", "pcc-dxy", "dollar", False),
    ("sp500", "pcp-sp500", "pcc-sp500", "sp500", False),
]


def _frac_cents(d):
    """The page's fmtCents: 4.25 -> '4¼¢'."""
    import math
    a = abs(float(d))
    w = int(math.floor(a))
    f = _jsround((a - w) * 4)
    if f == 4:
        w += 1
        f = 0
    fr = {1: "¼", 2: "½", 3: "¾"}.get(f, "")
    return (str(w) if (w or not fr) else "") + fr + "¢"


def _chg_str(net, pct, grain):
    """The page's chgStr, character for character."""
    if net is None:
        return "-"
    a = "▲" if net > 0 else ("▼" if net < 0 else "")
    s = "+" if net > 0 else ("−" if net < 0 else "")
    mv = _frac_cents(net) if grain else _fixed(abs(net), 2)
    return f"{a + ' ' if a else ''}{s}{mv} ({s}{_fixed(abs(float(pct or 0)), 2)}%)"


def seed_markets(prices, today):
    seeds = {}
    q = dict((prices or {}).get("quotes") or {})
    fetched = (prices or {}).get("fetched", "")
    fd = _iso_date(fetched)
    if not q or _stale(fd, today, "prices"):
        why = (f"price file last updated {_mdy(fd)}" if fd else "price file missing")
        seeds["mk:status"] = f"Quotes unavailable: {why}; nothing is shown rather than an old number."
        for _, p, c, _, _ in MK_MAP:
            seeds["mk:" + p] = "-"
            seeds["mk:" + c] = "-"
        for i in ("rlo-corn", "rhi-corn", "rlo-beans", "rhi-beans"):
            seeds["mk:" + i] = "-"
        for i in ("pct-corn", "pct-beans", "pct-wheat"):
            seeds["mk:" + i] = "front"
        return _write_seeds("markets.html", seeds)

    # the page swaps in the true nearest contract when the fetcher publishes it
    for crop, chip in (("corn", "pct-corn"), ("beans", "pct-beans"), ("wheat", "pct-wheat")):
        nb = q.get(crop + "-nearby")
        if nb and nb.get("close") is not None:
            q[crop] = nb
            lab = nb.get("contract") or (((prices.get("nearby") or {}).get(crop) or {}).get("label")) or "nearby"
            seeds["mk:" + chip] = _e(lab) + " &middot; nearby"
        else:
            seeds["mk:" + chip] = "most-active"
    n = 0
    for _, pid, cid, key, grain in MK_MAP:
        d = q.get(key) or {}
        c = d.get("close")
        if c is None:
            seeds["mk:" + pid] = "-"
            seeds["mk:" + cid] = "-"
            continue
        n += 1
        seeds["mk:" + pid] = "$" + (_fixed(float(c) / 100.0, 2) if grain else "{:,.2f}".format(float(_fixed(c, 2))))  # $4,162.40, as the page script prints it
        cd = _iso_date(d.get("close_date")) or fd
        when = " &middot; " + _md(cd)
        if d.get("stale"):
            when += " (last good quote)"
        if d.get("roll"):
            seeds["mk:" + cid] = "contract roll" + when
        else:
            seeds["mk:" + cid] = _chg_str(d.get("netChange"), d.get("pctChange"), grain) + when
    for crop, sym in (("corn", "corn"), ("beans", "beans")):
        d = q.get(crop) or {}
        lo, hi = d.get("wk52_lo"), d.get("wk52_hi")
        seeds["mk:rlo-" + sym] = ("$" + _fixed(lo / 100.0, 2)) if lo is not None else "-"
        seeds["mk:rhi-" + sym] = ("$" + _fixed(hi / 100.0, 2)) if hi is not None else "-"
    # the nearby card and the deferred card are the same contract in the fall;
    # the page hides the repeat once prices load, so the build hides it too
    # (a card vanishing after first paint pulled the whole grid up)
    dup = []
    for crop, dk, card in (("corn", "corn-dec", "pc-card-corn-dec"), ("beans", "beans-nov", "pc-card-bean-nov")):
        nb, dq = (prices.get("quotes") or {}).get(crop + "-nearby"), (prices.get("quotes") or {}).get(dk)
        if nb and dq and nb.get("ticker") and nb.get("ticker") == dq.get("ticker"):
            dup.append("#" + card)
    seeds["mk:dup"] = ('<style id="mk-dup-css">' + ",".join(dup) + "{display:none}</style>") if dup else ""
    seeds["mk:status"] = _asof_time(fetched, "prices", fd) + " &middot; each change line carries its own close date"
    print(f"  markets.html: {n} of {len(MK_MAP)} quotes seeded")
    return _write_seeds("markets.html", seeds)


def seed_homepage(prices, today):
    """The homepage's two lead price cards (corn and soybean, front month).

    Before 2026-10-06 the cards shipped empty and geo.js filled them, so a
    crawler or a reader whose script failed saw no price on the page whose
    title promises "Corn, Soybean & Wheat Prices". The seed is the same quote
    geo.js reads (data/prices.json "corn"/"beans"), and the line under it says
    when it is from, because the bake runs twice a day and a price with no time
    on it would be fake freshness. Only the lead cards are seeded: the deferred
    cards stay empty so collapseSameContract never sees two equal seeds and
    folds a card before the live quotes arrive.
    """
    q = (prices or {}).get("quotes") or {}
    fetched = (prices or {}).get("fetched", "")
    fd = _iso_date(fetched)
    seeds = {}
    if not q or _stale(fd, today, "prices"):
        why = (f"price file last updated {_mdy(fd)}" if fd else "price file missing")
        for k in ("corn", "beans"):
            seeds["hp:" + k] = "-"
            seeds["hp:" + k + "-when"] = "Quotes unavailable: " + why
        return _write_seeds("index.html", seeds)
    for k in ("corn", "beans"):
        d = q.get(k) or {}
        usd = grain_dollars(d)
        if not usd:
            seeds["hp:" + k] = "-"
            seeds["hp:" + k + "-when"] = "No quote in the last price file"
            continue
        # the card's own format (index.html qc): quarter cents as " 1/2", so
        # the seed and the live price never print the same quote two ways
        t = round(float(d["close"]) * 4) / 4.0
        w = int(t)
        frac = {0.25: " 1/4", 0.5: " 1/2", 0.75: " 3/4"}.get(round(t - w, 2), "")
        seeds["hp:" + k] = "$" + _fixed(w / 100.0, 2) + frac
        live, label = quote_state(d, fetched, "grain")
        seeds["hp:" + k + "-when"] = (state_words(live)[1] + (" " + label if label else "") +
                                      (" (last good quote)" if d.get("stale") else "") +
                                      " &middot; Yahoo Finance, delayed")
    return _write_seeds("index.html", seeds)


# --- /news -------------------------------------------------------------------
NEWS_KIND = {"usda": "USDA", "positioning": "Positioning", "board": "Board",
             "crop": "Crop", "weather": "Weather"}
NEWS_MAX = 10
DOW = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
MONFULL = ["January", "February", "March", "April", "May", "June", "July",
           "August", "September", "October", "November", "December"]


def seed_news(today):
    d = _load_json("data/news.json")
    upd = _iso_date((d or {}).get("updated"))
    seeds = {}
    datemod = None
    if not d or _stale(upd, today, "news"):
        why = (f"the wire file was last written {_mdy(upd)}" if upd else "the wire file is missing")
        seeds["newsupd"] = "-"
        seeds["newslist"] = ('\n      <div class="nw-empty">No current items: ' + why +
                             '. The <a href="/daily" style="color:var(--gold)">morning briefing</a> runs every morning regardless.</div>\n    ')
    else:
        u = str(d.get("updated"))
        seeds["newsupd"] = f"Updated {_mdy(upd)}, {u[11:16]} UTC"
        datemod = upd.isoformat()
        items = (d.get("items") or [])[:NEWS_MAX]
        if not items:
            seeds["newslist"] = ('\n      <div class="nw-empty">Nothing has cleared the bar as of ' + _mdy(upd) +
                                 '. That is the honest state of a quiet market, not a broken page.</div>\n    ')
        else:
            out, last = ["\n"], None
            for i in items:
                ts = str(i.get("ts") or "")
                day = _iso_date(ts)
                if day and day != last:
                    out.append(f'      <div class="nw-day">{DOW[day.weekday()]}, {MONFULL[day.month - 1]} {day.day}, {day.year}</div>\n')
                    last = day
                url = str(i.get("url") or "/")
                if not url.startswith("/"):
                    url = "/"                       # the wire links to its own pages only
                clock = "" if i.get("day_only") or len(ts) < 16 else f'<span class="nw-time">{ts[11:16]} UTC</span>'
                kind = NEWS_KIND.get(i.get("kind"), i.get("kind") or "")
                out.append(
                    f'      <a class="nw-item{" is-high" if i.get("significance") == "high" else ""}" href="{H.escape(url, quote=True)}">'
                    f'<div class="nw-top"><span class="nw-kind">{_e(kind)}</span>{clock}</div>'
                    f'<div class="nw-h">{_e(i.get("headline") or "")}</div>'
                    f'<p class="nw-d">{_e(i.get("detail") or "")}</p>'
                    + (f'<div class="nw-src">{_e(i["source"])}</div>' if i.get("source") else "")
                    + "</a>\n")
            out.append("    ")
            seeds["newslist"] = "".join(out)

    def stamp(t):
        if not datemod:
            return t
        return re.sub(r'("dateModified":")(\d{4}-\d{2}-\d{2})(")',
                      lambda m: m.group(1) + datemod + m.group(3), t, count=1)
    return _write_seeds("news.html", seeds, stamp)


# --- /conditions ---------------------------------------------------------------
def seed_conditions(today):
    cp = _load_json("data/crop-progress.json")
    cj = _load_json("data/conditions/conditions.json")
    seeds = {}
    # national line, from the same file bake_seo titles the page from
    rd = _iso_date((cp or {}).get("corn", {}).get("report_date") or (cp or {}).get("report_date"))
    corn = (cp or {}).get("corn") or {}
    soy = (cp or {}).get("soybeans") or {}
    if cp and cp.get("in_season") and corn.get("good_excellent") is not None and not _stale(rd, today, "conditions"):
        ge = corn["good_excellent"]
        line = f"USDA Crop Progress, week ending {_mdy(rd)}: US corn <strong>{ge:g}%</strong> good-to-excellent"
        if corn.get("good_excellent_prev_week") is not None:
            line += f" ({corn['good_excellent_prev_week']:g}% the week before)"
        sd = _iso_date(soy.get("report_date")) or rd
        if soy.get("good_excellent") is not None and sd == rd:
            line += f"; soybeans <strong>{soy['good_excellent']:g}%</strong>"
            if soy.get("good_excellent_prev_week") is not None:
                line += f" ({soy['good_excellent_prev_week']:g}%)"
        line += "."
        hv = corn.get("harvest_pct")
        if hv is not None and _iso_date(corn.get("harvest_date")) == rd:
            line += f" Corn harvest {hv:g}% done"
            if corn.get("harvest_5yr_avg") is not None:
                line += f" vs a {corn['harvest_5yr_avg']:g}% five-year average"
            line += "."
        vsent = (f"US corn is rated <b>{ge:g}% good or better</b> for the week ending {_mdy(rd)} "
                 f"(USDA NASS). Pick a state for its rank against the same week since 2000.")
    else:
        why = ("USDA is between seasons" if cp and not cp.get("in_season") else
               (f"the latest national report on file is the week ending {_mdy(rd)}" if rd else "the national file is missing"))
        line = f"No current national rating: {why}."
        vsent = f"No current rating: {why}."
    # state table: the page script's table, corn tab, worst first
    pkg = ((cj or {}).get("crops") or {}).get("corn")
    we = _iso_date((pkg or {}).get("week_ending"))
    if pkg and pkg.get("states") and not _stale(we, today, "conditions"):
        rows = sorted(pkg["states"].items(), key=lambda kv: kv[1].get("pctile", 0))
        line += (f" {len(pkg['states'])} corn states rated for the week ending {_mdy(we)}, each ranked "
                 f"against the same week of every year 2000&ndash;present (rank 1 = worst on record).")
        h = [f"<caption>Corn, week ending {_mdy(we)} &middot; worst first</caption>"
             "<tr><th>State</th><th style=\"text-align:right\">G+E now</th>"
             "<th style=\"text-align:right\">Own avg</th><th style=\"text-align:right\">Rank (1 = worst)</th></tr>"]
        for ab, s in rows:
            h.append(f"<tr><td>{_e(ab)}</td><td class=\"num\">{_fixed(s['ge'], 0)}%</td>"
                     f"<td class=\"num\">{_fixed(s['avg'], 0)}%</td>"
                     f"<td class=\"num\">{s['rank_from_worst']} of {s['of']}</td></tr>")
        seeds["condtable"] = "".join(h)
        seeds["condfresh"] = f"week ending {we.isoformat()}"
    else:
        why = (f"latest state file is the week ending {_mdy(we)}" if we else "state file missing or off-season")
        seeds["condtable"] = f'<tr><td style="color:#8a948f">No current state ratings: {why}</td></tr>'
        seeds["condfresh"] = "-"
    seeds["condstats"] = line
    seeds["condvsent"] = vsent
    return _write_seeds("conditions.html", seeds)


# --- /scorecard ----------------------------------------------------------------
PB_VERDICT = {"not_enough": "Not enough calls yet.", "coin_flip": "Coin flip.",
              "held_up": "This one held up.", "worse_than_coin": "Worse than a coin flip."}
PB_SIGNAL = {"crowded_long": "Managed money crowded long", "crowded_short": "Managed money crowded short",
             "trend_up": "13-week trend up", "trend_down": "13-week trend down"}


def _pb_n(x):
    return "-" if x is None else _commas(x)


def _pb_rate(x):
    return "-" if x is None else _fixed(x, 1) + "%"


def _pb_luck(p):
    if p is None:
        return "-"
    return "under 1 in 100" if p < 0.01 else f"about {_jsround(p * 100)} in 100"


def _pb_date(iso):
    d = _iso_date(iso)
    return _mdy(d) if d else "-"


def _pb_dollars(c):
    if c is None:
        return "-"
    s = _fixed(c / 100.0, 4).rstrip("0")
    if len(s.split(".")[1]) < 2:
        s = _fixed(c / 100.0, 2)
    return "$" + s


def _pb_ord(x):
    v = x % 100
    if 11 <= v <= 13:
        return f"{x}th"
    return f"{x}" + {1: "st", 2: "nd", 3: "rd"}.get(x % 10, "th")


def _pb_verdict(r, label, R):
    if not r:
        return "-", "", ""
    if r.get("verdict") == "not_enough":
        return (PB_VERDICT["not_enough"],
                f"{_pb_n(r.get('graded'))} graded so far. A rate is shown from {_pb_n(R.get('min_graded_for_rate'))} "
                f"graded calls and {_pb_n(R.get('min_windows_for_rate'))} non-overlapping windows.", "")
    v = _e(r.get("verdict_text") or PB_VERDICT.get(r.get("verdict"), "")) or "-"
    line = (f"Right on {_pb_n(r.get('hits'))} of {_pb_n(r.get('graded'))} {label} ({_pb_rate(r.get('hit_rate'))}). "
            f"Across four non-overlapping groups of calls: {_pb_rate(r.get('spell_rate_low'))} to "
            f"{_pb_rate(r.get('spell_rate_high'))} ({_pb_n(r.get('windows'))} windows).")
    luck = (f"Odds pure guessing does at least this well: {_pb_luck(r.get('p_luck'))}; at least this badly: "
            f"{_pb_luck(r.get('p_worse'))} ({_pb_luck(r.get('p_worse_adjusted'))} after adjusting for the records tested at once).")
    return v, line, luck


def seed_scorecard(today):
    d = _load_json("data/predictions.json")
    upd = _iso_date((d or {}).get("updated"))
    seeds = {}
    if not d or _stale(upd, today, "predictions"):
        why = (f"the record file was last written {_mdy(upd)}" if upd else "the record file is missing")
        for k in ("pb-live-verdict", "pb-bt-verdict"):
            seeds["pb:" + k] = "-"
        for k in ("pb-live-line", "pb-bt-line", "pb-live-luck", "pb-bt-luck", "pb-bt-base", "pb-latest-when"):
            seeds["pb:" + k] = ""
        seeds["pb:pb-live-line"] = f"Record not shown: {why}."
        seeds["pb:latest"] = f'<tr><td colspan="6">{why}.</td></tr>'
        seeds["pb:bycrop"] = f'<tr><td colspan="6">{why}.</td></tr>'
        seeds["pb:pb-updated"] = "-"
        return _write_seeds("scorecard.html", seeds)
    labels = {c["key"]: c["label"] for c in d.get("crops") or []}
    R = d.get("rules") or {}
    u = str(d.get("updated"))
    seeds["pb:pb-updated"] = u.replace("T", " ").replace("Z", " UTC")
    live = ((d.get("live") or {}).get("records") or {}).get("all")
    v, line, luck = _pb_verdict(live, "graded calls", R)
    seeds["pb:pb-live-verdict"] = v
    seeds["pb:pb-live-line"] = (line + " " if line else "") + f"Record as of {_mdy(upd)}."
    if live and live.get("verdict") == "not_enough":
        o = (d.get("live") or {}).get("open")
        luck = ((f"{_pb_n(o)} calls are waiting for their grading day. " if o else "") +
                f"The first live calls are made at the {_pb_date(d.get('first_live_call') or d.get('live_start'))} close and graded four weeks later.")
    seeds["pb:pb-live-luck"] = luck
    bt = d.get("backtest") or {}
    ba = (bt.get("records") or {}).get("all")
    v, line, luck = _pb_verdict(ba, "weekly calls", R)
    seeds["pb:pb-bt-verdict"] = v
    seeds["pb:pb-bt-line"] = (f"{_pb_date(ba.get('first'))} to {_pb_date(ba.get('last'))}. {line}" if ba else "Backtest not computed yet.")
    seeds["pb:pb-bt-luck"] = luck
    seeds["pb:pb-bt-base"] = (f"Always saying down: {_pb_rate(ba.get('fell_rate'))}. Always saying up: {_pb_rate(ba.get('rose_rate'))} "
                              f"({_pb_n(ba.get('moves_of'))} windows)." if ba and ba.get("moves_of") else "")
    lt = d.get("latest") or {}
    lc = lt.get("calls") or []
    seeds["pb:pb-latest-when"] = (f"Made at the {_pb_date(lt['date'])} close." if lt.get("date") else
                                  f"No live call yet. The first calls are made at the {_pb_date(d.get('first_live_call') or d.get('live_start'))} close.")

    def dir_span(x):
        return ('<span class="pb-up">Up</span>' if x == "up" else
                ('<span class="pb-down">Down</span>' if x == "down" else "n/a"))
    rows = []
    for c in lc:
        why = _e(PB_SIGNAL.get(c.get("signal"), c.get("signal") or ""))
        if c.get("cot_pct") is not None:
            why += f" (managed money at the {_pb_ord(_jsround(c['cot_pct']))} percentile)"
        rows.append(f"<tr><td>{_e(labels.get(c.get('crop'), c.get('crop') or ''))}</td><td>{dir_span(c.get('direction'))}</td>"
                    f"<td>{_e(c.get('contract') or '')}</td><td class=\"num\">{_pb_dollars(c.get('entry'))}</td>"
                    f"<td>{_pb_date(c.get('exit_day'))}</td><td>{why}</td></tr>")
    seeds["pb:latest"] = "".join(rows) or '<tr><td colspan="6">No calls yet.</td></tr>'
    lr = (d.get("live") or {}).get("records") or {}
    br = bt.get("records") or {}
    rows = []
    for c in d.get("crops") or []:
        a, b = lr.get(c["key"]) or {}, br.get(c["key"]) or {}
        lv = (f"{_pb_n(a.get('hits'))} of {_pb_n(a.get('graded'))} ({_pb_rate(a.get('hit_rate'))})" if a.get("gate_ok")
              else f"{_pb_n(a.get('graded'))} graded")
        ls = _pb_n(a.get("windows")) if a.get("gate_ok") else "n/a"
        bv = f"{_pb_n(b.get('hits'))} of {_pb_n(b.get('graded'))} ({_pb_rate(b.get('hit_rate'))})" if b.get("graded") else "n/a"
        bs = (f"{_pb_rate(b.get('spell_rate_low'))}&ndash;{_pb_rate(b.get('spell_rate_high'))} ({_pb_n(b.get('windows'))} windows)"
              if b.get("graded") else "n/a")
        bvt = _e(b.get("verdict_text") or PB_VERDICT.get(b.get("verdict"), "")) or "n/a"
        rows.append(f"<tr><td>{_e(c['label'])}</td><td class=\"num\">{lv}</td><td class=\"num\">{ls}</td>"
                    f"<td class=\"num\">{bv}</td><td class=\"num\">{bs}</td><td>{bvt}</td></tr>")
    seeds["pb:bycrop"] = "".join(rows) or '<tr><td colspan="6">n/a</td></tr>'
    return _write_seeds("scorecard.html", seeds)


# --- /basis --------------------------------------------------------------------
def _basis_money(v):
    return ("-" if v < 0 else "+") + "$" + _fixed(abs(v), 2)


def basis_summary(j, today=None, crop="Corn"):
    """Regions for one crop on the page's rules (2026-10-10): ONE WEEK PER
    TABLE. The week is the one scripts/fetch_transport.py wrote for the crop
    (basis.weeks; it steps back a week when a new week is held as a jump),
    else the newest posting. Returns (week, rows, newest) where rows is
    [(region, series, age_days_behind_week)]; age 0 = posted that week."""
    ser = (j or {}).get("series") or {}
    newest = None
    for s in ser.values():
        dt = _iso_date(s.get("date"))
        if dt and (newest is None or dt > newest):
            newest = dt
    wk = _iso_date((((j or {}).get("weeks") or {}).get(f"{crop}|Elevator Bid") or {}).get("week")) or newest
    rows = []
    for k, s in ser.items():
        p = k.split("|")
        if len(p) != 3 or p[0] != crop or p[2] != "Elevator Bid":
            continue
        dt = _iso_date(s.get("date"))
        age = (wk - dt).days if (wk and dt) else 999
        rows.append((p[1], s, age))
    rows.sort(key=lambda r: 9 if r[1].get("delta") is None else r[1]["delta"])
    return wk, rows, newest


def basis_counts(rows):
    """(under, over, near, n) among the rows posted in the table's week with a
    normal: more than 10c under, more than 10c over, within 10c."""
    cur = [r for r in rows if r[2] == 0 and r[1].get("delta") is not None]
    under = sum(1 for r in cur if r[1]["delta"] < -0.1)
    over = sum(1 for r in cur if r[1]["delta"] > 0.1)
    return under, over, len(cur) - under - over, len(cur)


def basis_held_text(j, crop, wk):
    w = (((j or {}).get("weeks") or {}).get(f"{crop}|Elevator Bid") or {})
    held = w.get("held") or []
    if not held:
        return ""
    gate = ((((j or {}).get("jump") or {}).get("by_crop") or {}).get("Wheat" if "Wheat" in crop else crop) or {})
    g = _jsround(100 * gate["threshold"]) if gate.get("threshold") is not None else 50
    ex = []
    for k in held[:3]:
        h = next((x for x in (j.get("held") or {}).get(k, []) if x.get("date") == w.get("newest")), None)
        ex.append(f"{k.split('|')[1]} {_basis_money(h['prev'])} to {_basis_money(h['value'])}" if h else k.split("|")[1])
    nd = _iso_date(w.get("newest"))
    return (f"USDA&rsquo;s week of {_md(nd)} moved {len(held)} region{'s' if len(held) != 1 else ''} more than {g}&cent; "
            f"in one week ({', '.join(ex)}{', and more' if len(held) > 3 else ''}). That looks like a break in "
            f"USDA&rsquo;s file, not the market, so this table shows the week of {_md(wk)} for every region until "
            f"the next week confirms or undoes it.")


def seed_basis(today):
    j = _load_json("data/transport/basis.json")
    wk, rows, newest = basis_summary(j)
    seeds = {}
    if not rows or _stale(wk, today, "basis"):
        why = (f"the newest USDA week on file is {_mdy(wk)}" if wk else "the basis file is missing")
        seeds["basisstats"] = f"No current regional basis: {why}."
        seeds["basistable"] = f'<tr><td style="color:#8a948f">No current USDA basis: {why}</td></tr>'
        seeds["basisfresh"] = f"week of {wk.isoformat()}" if wk else "no current week"
        seeds["basisheld"] = ""
    else:
        parts = []
        for crop, word in (("Corn", "corn"), ("Soybeans", "soybeans")):
            cwk, cr, _ = basis_summary(j, crop=crop)
            under, over, near, n = basis_counts(cr)
            if not n:
                continue
            w = next(r for r in cr if r[2] == 0 and r[1].get("delta") is not None)
            parts.append(f"{word}: <strong>{under} of {n}</strong> regions more than 10&cent; under normal, "
                         f"{over} more than 10&cent; over, {near} within 10&cent; (weakest vs normal {_e(w[0])} "
                         f"{_basis_money(w[1]['latest'])}/bu against {_basis_money(w[1]['avg5'])})")
        seeds["basisstats"] = (f"USDA AgTransport elevator-bid basis against each region&rsquo;s own 5-year normal "
                               f"for the same week, week of {_mdy(wk)}. " + "; ".join(parts) +
                               ". Barge rates and origin-to-Gulf spreads below; USDA posts weekly.")
        seeds["basisfresh"] = f"week of {wk.isoformat()}"
        seeds["basisheld"] = basis_held_text(j, "Corn", wk)
        h = [f"<caption>Corn, week of {_mdy(wk)} &middot; weakest vs normal first</caption>"
             "<tr><th>Region</th><th style=\"text-align:right\">Basis now</th>"
             "<th style=\"text-align:right\">5-yr normal</th><th style=\"text-align:right\">Vs normal, $/bu</th></tr>"]
        for name, s, age in rows:
            if age != 0:
                now = f"no USDA posting for the week of {_md(wk)}; last {_md(_iso_date(s['date']))}"
                vs = ""
            else:
                now = _basis_money(s["latest"])
                dl = s.get("delta")
                # a delta that rounds to a cent of nothing reads "even", not "+$0.00"
                vs = ("" if dl is None else "even" if abs(dl) < 0.005 else _basis_money(dl))
            nrm = "" if s.get("avg5") is None else (_basis_money(s["avg5"]) + (f" n={s['avg5_n']} yrs" if s.get("avg5_n") is not None else ""))
            h.append(f"<tr><td>{_e(name)}</td><td class=\"num\">{now}</td><td class=\"num\">{nrm}</td><td class=\"num\">{vs}</td></tr>")
        seeds["basistable"] = "".join(h)
    seeds["storage"] = storage_html(_load_json("data/storage/storage.json"), today)
    return _write_seeds("basis.html", seeds)


# --- storage (the "why basis is wide" section of /basis) -----------------------
FARMDOC = ("farmdoc daily (Dhakal and Janzen, &ldquo;Enough Room for the Harvest? Grain Storage Pressure in the "
           "Corn Belt,&rdquo; Oct 7, 2026)")
FARMDOC_URL = "https://farmdocdaily.illinois.edu/wp-content/uploads/2026/10/fdd100726.pdf"
ST_NAME = {"AL": "Alabama", "AR": "Arkansas", "CO": "Colorado", "GA": "Georgia", "ID": "Idaho", "IL": "Illinois",
           "IN": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky", "MI": "Michigan", "MN": "Minnesota",
           "MS": "Mississippi", "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NY": "New York",
           "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon",
           "PA": "Pennsylvania", "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "VA": "Virginia",
           "WA": "Washington", "WI": "Wisconsin", "WY": "Wyoming", "DE": "Delaware", "MD": "Maryland",
           "SC": "South Carolina", "LA": "Louisiana", "CA": "California", "AZ": "Arizona", "NM": "New Mexico",
           "UT": "Utah", "FL": "Florida", "NV": "Nevada", "NJ": "New Jersey", "WV": "West Virginia"}


def storage_html(d, today):
    """This fall's grain against bin space. Computed only from the pipeline's
    fall block for THIS year (Sept 1 stocks + this year's crop / capacity);
    until NASS's numbers are pulled, farmdoc's published finding is cited
    with its date instead, and last year's crop-only ratio is not shown."""
    yr = int(today[:4])
    lead = ("<p>Basis has to pay for space. When the grain that has to be held this fall is more than the bins "
            "can take, elevators bid less to slow it down or pay to ship it out, and that comes out of your basis.</p>")
    cr = (d or {}).get("crunch")
    if not cr or int(cr.get("year") or 0) != yr:
        return (lead + f"<p>{FARMDOC} found that the United States as a whole has room for this year&rsquo;s "
                f"carry-in stocks and the fall harvest, but that carry-in plus this year&rsquo;s crop is more than "
                f"storage capacity in most Corn Belt states. <a href=\"{FARMDOC_URL}\">Read their study</a>.</p>"
                f"<p>Our own state-by-state version of that math (USDA NASS September 1 stocks plus the latest {yr} "
                f"crop forecast, over on-farm plus off-farm capacity) fills in here once our next NASS pull "
                f"lands. Until then this section shows no state numbers of its own.</p>")
    rows = [(st, r) for st, r in cr["states"].items() if r.get("ratio") is not None]
    rows.sort(key=lambda x: -x[1]["ratio"])
    short = [st for st, r in rows if r["ratio"] > 1]
    per = sorted({v[1] for _, r in rows for v in r.get("fall", {}).values()})
    per_txt = ", ".join(p.replace("YEAR - ", "").replace(" FORECAST", " forecast").title().replace("Year", "final")
                        for p in per) or "forecast"
    trs = "".join(
        f"<tr><td>{_e(ST_NAME.get(st, st))}</td><td class=\"num\">{r['ratio']:.2f}&times;</td>"
        f"<td class=\"num\">{_commas(round(sum(r['stocks'].values()) / 1e6))}</td>"
        f"<td class=\"num\">{_commas(round(sum(v[0] for v in r['fall'].values()) / 1e6))}</td>"
        f"<td class=\"num\">{_commas(round(r['cap'] / 1e6))}</td></tr>" for st, r in rows)
    none = sorted(ST_NAME.get(st, st) for st, r in cr["states"].items() if r.get("ratio") is None and r.get("why"))
    out = (lead + f"<p>This fall, <strong>{len(short)} of {len(rows)}</strong> states with full NASS figures have "
           f"more grain to hold than bin space: September 1 stocks plus the {yr} corn, soybean and sorghum crop "
           f"({_e(per_txt)}), over on-farm plus off-farm capacity. Over 1.00&times; means more grain than bins.</p>"
           f"<div class=\"tblscroll\"><table class=\"bs-tbl\"><caption>Million bushels &middot; most crowded first"
           f"</caption><tr><th>State</th><th style=\"text-align:right\">Grain vs bins</th>"
           f"<th style=\"text-align:right\">Sept 1 stocks</th><th style=\"text-align:right\">{yr} fall crop</th>"
           f"<th style=\"text-align:right\">Capacity</th></tr>{trs}</table></div>")
    if none:
        out += f"<p>No ratio where NASS has no state figure for a crop the state grows: {_e(', '.join(none))}.</p>"
    out += (f"<p>Same measure as {FARMDOC}. Wheat, barley and oats are harvested by September 1, so they count once, "
            f"in the stocks. Source: USDA NASS Quick Stats, Grain Stocks and Crop Production.</p>")
    return out


# --- /elevators ----------------------------------------------------------------
def _ct(iso):
    """'2026-10-05T19:11:21.424Z' -> 'Oct 5, 2026, 2:11 PM CT' (the page's fmtCT)."""
    try:
        from zoneinfo import ZoneInfo
        t = datetime.strptime(str(iso)[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
        c = t.astimezone(ZoneInfo("America/Chicago"))
        h = c.hour % 12 or 12
        return f"{_mdy(c.date())}, {h}:{c.minute:02d} {'AM' if c.hour < 12 else 'PM'} CT"
    except Exception:
        return ""


def seed_elevators(today):
    d = _load_json("data/elevator-coverage.json")
    gen = (d or {}).get("directoryGenerated") or (d or {}).get("generated")
    gd = _iso_date(gen)
    n = (d or {}).get("counts") or {}
    seeds = {}
    if not d or not isinstance(n.get("read"), int) or not isinstance(n.get("known"), int) or _stale(gd, today, "elevators"):
        why = (f"the coverage file was last built {_mdy(gd)}" if gd else "the coverage file is missing")
        for k in ("read", "quiet", "known"):
            seeds["elev:cov-n-" + k] = "-"
        seeds["elev:foot"] = f"Counts not shown: {why}."
        seeds["elev:net"] = f"Network counts: {why}."
        return _write_seeds("elevators.html", seeds)
    for k in ("read", "quiet", "known"):
        seeds["elev:cov-n-" + k] = _commas(n[k]) if isinstance(n.get(k), int) else "-"
    foot = ""
    if n.get("elevators") is not None:
        foot += f"{_commas(n['elevators'])} elevators tracked. "
    if n.get("unplaced"):
        foot += f"{_commas(n['unplaced'])} could not be placed on the map and are not drawn. "
    foot += "Several share a town centre, so one pin can cover more than one. Click to see what is there."
    if n.get("readers") is not None:
        when = str(d.get("directoryGenerated") or "")[:16].replace("T", " ")
        foot += (f" We have readers for {_commas(n['readers'])} of them; {_commas(n.get('read') or 0)} answered the pass "
                 f"this map was built from" + (f" ({when} UTC)" if when else "") + ".")
    seeds["elev:foot"] = foot
    when = _ct(gen)
    net = (f"In the read {'of ' + when if when else 'this page was built from'}, AGSIST read "
           f"<span class=\"num\">{_commas(n['read'])}</span> elevator boards direct. ")
    if isinstance(n.get("quiet"), int) and n["quiet"] > 0:
        net += f"<span class=\"num\">{_commas(n['quiet'])}</span> more have a reader that did not answer that pass. "
    net += (f"It knows <span class=\"num\">{_commas(n['known'])}</span> more elevators that have no reader yet. "
            "<a href=\"#coverage-map\">See the map</a>.")
    seeds["elev:net"] = net
    seeds["elev:bids"] = elevator_bids_line(_load_json("data/elevator-counts.json"), today)
    return _write_seeds("elevators.html", seeds)


def elevator_bids_line(c, today):
    """How many network elevators have a current bid, from data/elevator-counts.json,
    the one file the site counts them in (scripts/build_cash_bid_pages.py). A
    different question from boards read: a board can be read and post nothing
    current. Empty (the line hides) when the file is missing or a day old."""
    b = (c or {}).get("bids") or {}
    gd = _iso_date((c or {}).get("generated"))
    if not isinstance(b.get("elevators"), int) or not isinstance(b.get("towns"), int) or gd is None \
            or (datetime.strptime(today, "%Y-%m-%d").date() - gd).days > 1:
        return ""
    return (f"On {_mdy(gd)}, <span class=\"num\">{_commas(b['elevators'])}</span> network elevators had a current "
            f"bid on our cash bids pages, across <span class=\"num\">{_commas(b['towns'])}</span> towns.")


def seed_data_pages(prices, today):
    """Each page fails alone: one bad file never stops the others."""
    ch = False
    for name, fn in (("markets", lambda: seed_markets(prices, today)),
                     ("homepage", lambda: seed_homepage(prices, today)),
                     ("news", lambda: seed_news(today)),
                     ("conditions", lambda: seed_conditions(today)),
                     ("scorecard", lambda: seed_scorecard(today)),
                     ("basis", lambda: seed_basis(today)),
                     ("elevators", lambda: seed_elevators(today))):
        try:
            ch = fn() or ch
        except Exception as e:                        # noqa: BLE001
            print(f"  {name}: seed skipped — {type(e).__name__}: {e}")
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


# --- futures heroes: the parts the page script fills in -----------------------
# The hero's contract label, day change and the new-crop / deferred line used to
# arrive with the fetch, after first paint. Each one adds or rewraps a line, and
# the price block below jumped (CLS 0.6 to 0.7 on a phone). Baking them here, in
# the page script's exact words, means the live fill rewrites text in place.
def _fut_chg(q):
    """The futures pages' chgTxt for a grain quote: (text, class) or None."""
    if not q:
        return None
    if q.get("roll"):
        return ("contract roll", "roll")
    net, pct = q.get("netChange"), q.get("pctChange")
    if net is None or pct is None:
        return None
    a = "\u25b2" if net >= 0 else "\u25bc"
    s = "+" if net > 0 else ("\u2212" if net < 0 else "")
    return (f"{a} {s}{_frac_cents(net)} ({s}{_fixed(abs(float(pct)), 2)}%)", "up" if net >= 0 else "dn")


def _chg_seed(c):
    return ('<span class="' + c[1] + '">' + H.escape(c[0], quote=False) + "</span>") if c else ""


def _nearby_label(prices, crop, fallback):
    """'Nearby Dec \'26' the way each page script builds it, else its fallback."""
    q = (prices.get("quotes") or {}).get(crop + "-nearby")
    if not q or q.get("close") is None:
        return fallback
    lab = q.get("contract") or (((prices.get("nearby") or {}).get(crop) or {}).get("label"))
    return ("Nearby " + lab) if lab else fallback


def futures_hero_seeds(page, prices):
    """{tag: html} for the hero seeds a futures page carries."""
    q = prices.get("quotes") or {}
    out = {}
    if page.startswith("corn"):
        hq = q.get("corn-nearby") or q.get("corn")
        out["exch"] = "CBOT &middot; CME Group &middot; " + _e(_nearby_label(prices, "corn", "Most-active (ZC)")) + " &middot; Refreshed in session"
        out["chg"] = _chg_seed(_fut_chg(hq))
        cd = q.get("corn-dec")
        if cd and cd.get("close") is not None:
            pc = cd.get("pctChange")
            if cd.get("roll"):
                chg = '<span id="nc-chg" class="roll">(contract roll)</span>'
            elif pc is not None:
                net = cd.get("netChange") or 0
                sg = "+" if net > 0 else ("\u2212" if net < 0 else "")
                chg = '<span id="nc-chg" class="' + ("up" if net >= 0 else "dn") + '">(' + sg + _fixed(abs(float(pc)), 2) + "%)</span>"
            else:
                chg = '<span id="nc-chg"></span>'
            out["nc"] = ('<div class="nc-glance" id="nc-glance">Dec \'26 new crop: <strong id="nc-price">$' +
                         grain_dollars(cd) + "</strong> " + chg + "</div>")
        else:
            out["nc"] = ('<div class="nc-glance" id="nc-glance" style="display:none">Dec \'26 new crop: '
                         '<strong id="nc-price"></strong> <span id="nc-chg"></span></div>')
    elif page.startswith("soybean"):
        hq = q.get("beans-nearby") if (q.get("beans-nearby") or {}).get("close") is not None else q.get("beans")
        out["contract"] = _e(_nearby_label(prices, "beans", "Most-active (ZS)"))
        out["chg"] = _chg_seed(_fut_chg(hq))
        nq = q.get("beans-nov")
        if nq and nq.get("close") is not None:
            h = "Nov '26 new crop: <strong>$" + grain_dollars(nq) + "</strong>"
            np_ = nq.get("pctChange")
            if np_ is not None and not nq.get("roll"):
                h += (' <span class="' + ("up" if np_ >= 0 else "dn") + '">(' +
                      ("+" if np_ > 0 else ("\u2212" if np_ < 0 else "")) + _fixed(abs(float(np_)), 1) + "%)</span>")
            out["nc"] = '<div class="nc-line" id="nc-line">' + h + "</div>"
        else:
            out["nc"] = '<div class="nc-line" id="nc-line" style="display:none"></div>'
    elif page.startswith("wheat"):
        n = q.get("wheat-nearby")
        hq = n if (n and n.get("close") is not None) else q.get("wheat")
        out["contract"] = "&middot; " + _e(("Nearby " + n["contract"]) if (n and n.get("contract")) else "Most-active (ZW)")
        out["chg"] = _chg_seed(_fut_chg(hq))
        d26 = q.get("wheat-dec26")
        if d26 and d26.get("close") is not None:
            pc = d26.get("pctChange")
            chg = (" (" + ("+" if pc >= 0 else "\u2212") + _fixed(abs(float(pc)), 1) + "%)") if pc is not None else ""
            out["bench"] = ('<div class="benchline" id="benchline">Dec \'26 (deferred): <strong>$' + grain_dollars(d26) +
                            "</strong>" + chg + ", winter wheat new-crop is July</div>")
        else:
            out["bench"] = '<div class="benchline" id="benchline" style="display:none"></div>'
    elif page.startswith("cattle"):
        le = q.get("cattle") or {}
        if le.get("close") is not None and le.get("pctChange") is not None:
            net = le.get("netChange")
            hu = (net or 0) >= 0
            txt = (("\u25b2 +" if hu else "\u25bc \u2212") + (("$" + _fixed(abs(float(net)), 2) + " ") if net is not None else "")
                   + "(" + ("+" if hu else "\u2212") + _fixed(abs(float(le["pctChange"])), 2) + "%)")
            out["chg"] = _chg_seed((txt, "up" if hu else "dn"))
        else:
            out["chg"] = ""
    return out


def seed_futures_pages(prices, today):
    """The four futures pages: price seed, note, last-close/last-trade table and
    (grains) meta description. Callable on its own so the futures seeds can be
    refreshed without rewriting every other page main() touches."""
    quotes = prices.get("quotes", {})
    fetched = prices.get("fetched", "")
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
        # the benchmark is often the same contract as the nearby (Dec corn in Sep); list it once
        if mon and bq and bench_label[:3].lower() == mon[:3].lower():
            bq = None
        f_usd = grain_dollars(fq)
        b_usd = grain_dollars(bq)
        changed = False
        if f_usd:
            stale = " (last good quote)" if fq.get("stale") else ""
            front_label = ("Nearby " + mon + " " + crop) if mon else ("Front-month " + crop)
            live, flabel = quote_state(fq, fetched, "grain")
            flabel = flabel or today
            verb = state_words(live)[0]
            t, c1 = seed_between(t, "px", "$" + f_usd)
            note = (front_label + " " + verb + " near <strong>$" + f_usd +
                    "</strong>" + stale +
                    ((" &middot; " + bench_label + " near $" + b_usd) if b_usd else "") +
                    " &middot; as of " + flabel +
                    " &middot; Yahoo Finance, delayed &middot; refreshed every 15 minutes during trading hours. Reload for the latest.")
            t, c2 = seed_between(t, "note", note)
            changed = c1 or c2

            # crawler-visible last-close table (marker optional per page)
            rows = [((("Nearby " + mon) if mon else "Front month"), fq),
                    (bench_label, bq)]
            if page.startswith("wheat"):
                rows += [("KC HRW (KE, most-active)", quotes.get("kcwheat")),
                         ("Minneapolis HRS (MWE, most-active)", quotes.get("mplswheat"))]
            tbl = px_table(rows, flabel, live is True)
            if tbl:
                t, c4 = seed_between(t, "pxtable", tbl)
                changed = changed or c4

            # freshly-priced meta description
            tmpl = DESC.get(page)
            if tmpl:
                kc_usd = grain_dollars(quotes.get("kcwheat"))
                desc, dnote = render_desc(
                    tmpl, px=f_usd, chg=_chg(fq) or "flat", mon=mon or "front month",
                    verb=verb,
                    when=(("at " + flabel.split(", ", 1)[1] + " " + flabel.split(", ", 1)[0])
                          if live is True else ("on " + flabel)),
                    kc=(" &middot; KC HRW $" + kc_usd) if kc_usd else "")
                if desc is None:
                    print(f"  {page}: description {dnote}")
                else:
                    # entity-decode for attribute text: &middot; is fine in content=""
                    t, c5 = stamp_meta_description(t, desc)
                    changed = changed or c5
        else:
            print(f"  {page}: no usable {crop_key} quote — seeds left as-is")
        for tag, val in futures_hero_seeds(page, prices).items():
            t, c6 = seed_between(t, tag, val)
            changed = changed or c6
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
            live, flabel = quote_state(quotes.get("cattle"), fetched, "cattle")
            flabel = flabel or today
            t, c1 = seed_between(t, "px", "$" + lc)
            note = ("Live cattle " + state_words(live)[0] + " near <strong>$" + lc + "</strong>" + stale
                    + ((" &middot; feeders near $" + gf) if gf else "")
                    + " &middot; $/cwt &middot; as of " + flabel
                    + " &middot; Yahoo Finance, delayed &middot; refreshed every 15 minutes during trading hours. Reload for the latest.")
            t, c2 = seed_between(t, "note", note)
            changed = c1 or c2
        else:
            print(f"  {page}: no usable cattle quote — seeds left as-is")
        for tag, val in futures_hero_seeds(page, prices).items():
            t, c6 = seed_between(t, tag, val)
            changed = changed or c6
        t, c3 = stamp_datemodified(t, today)
        if changed or c3:
            open(page, "w", encoding="utf-8").write(t)
            any_change = True
            print(f"  {page}: seeded ${lc or '—'}{(' / $' + gf) if gf else ''} · dateModified {today}")
        else:
            print(f"  {page}: no change")
    except FileNotFoundError:
        print(f"  {page}: missing — skipped")

    return any_change


def main():
    now = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")
    print(f"seed_static.py — {now.strftime('%Y-%m-%d %H:%M UTC')}")

    try:
        prices = load_prices()
    except Exception as e:
        print(f"FATAL: cannot read {PRICES}: {e}")
        sys.exit(1)
    any_change = bool(seed_futures_pages(prices, today))

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
                + (f", {rc:,} in the last 30 days" if rc else "")
                + ". Recent reports refresh daily; the full archive rebuilds monthly.") if yrs else None
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

    if seed_data_pages(prices, today):
        any_change = True

    if bump_sitemap(today):
        any_change = True
        print(f"  sitemap.xml: lastmod → {today} on {len(SITEMAP_URLS)} URLs")
    else:
        print("  sitemap.xml: no change")

    print("CHANGED" if any_change else "NO-CHANGE")


if __name__ == "__main__":
    main()
