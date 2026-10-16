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

import pricefmt  # grain price text, the twin of components/util.js AG.px
from contract_calendar import is_expired, _parse as _contract_ym
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
    # wheat's deferred benchmark is not a fixed key: it is the next live dated
    # contract after the nearby (wheat_deferred below), labeled from its ticker
    "wheat-futures-prices.html":   ("wheat", None,         "Deferred",          "wheat"),
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
    # 2026-10-13: "every 30 min" on corn and wheat said what the prices loop
    # did before 2026-10-07; the page body and the loop say 15. "Live" is
    # dropped: the body says these are delayed quotes. Corn and soybeans spell
    # out Chicago Board of Trade, the words of the named queries ("chicago
    # board of trade corn price", "cbot soybeans").
    # 2026-10-15: only a finished session goes in (settled_close): {px} is a
    # close, {date} its own day, {chg} its cents change or nothing. No
    # percent, no clock time; a snippet can sit in search for a day and this
    # wording is still true when it is read.
    "corn-futures-prices.html": (
        "Corn {mon} closed ${px}{chg} on {date}. Chicago Board of Trade (CBOT) corn "
        "futures, refreshed every 15 min in session.",
        " December new-crop, basis, daily read."),
    "soybean-futures-prices.html": (
        "Soybeans {mon} closed ${px}{chg} on {date}. Chicago Board of Trade (CBOT) "
        "soybean futures, refreshed every 15 min in session.",
        " Crush spread, cash bids."),
    "wheat-futures-prices.html": (
        "Wheat {mon} closed ${px}{chg} on {date}. Chicago SRW wheat futures, refreshed "
        "every 15 min in session{kc}.",
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
    """Grain quote (cents) -> display dollars string without the "$", to the
    quarter cent ("4.80½"), or None if unusable. Same characters as the page
    scripts print (scripts/pricefmt.py is util.js AG.px's twin)."""
    if not q:
        return None
    c = q.get("close")
    if c is None:
        return None
    return pricefmt.price(c, dollar=False)


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
    """Signed pct-change string for a quote, e.g. '−0.30%'. '' if missing."""
    p = q.get("pctChange")
    if p is None:
        return ""
    return pricefmt.pct(p)


def _chg_cents(q):
    """Cents first, percent second, as the live tiles print it: '+1¾¢ (+0.36%)'."""
    if q.get("netChange") is None:
        return _chg(q)
    return pricefmt.change(q["netChange"], q.get("pctChange"), arrow=False)[0]


# Day-session close, Central time. CBOT grains 1:20 p.m. CT; CME live and
# feeder cattle 1:05 p.m. CT. freshness.yml runs at 13:35 and 20:35 UTC, so the
# morning run lands IN SESSION and prices.json then carries close_date = today
# for a price that is a delayed last trade, not a close. Yahoo quotes are never
# CME settlements either way, so the words used are "closed" and "last trade".
CLOSE_CT = {"grain": (13, 20), "cattle": (13, 5)}
# When Yahoo's bar for the day becomes the settlement, Central time. Until then
# the day's "close" is the last trade before the bell, not the settle. Live
# cattle Oct 14 2026: 223.95 in every fetch from 18:16 UTC (1:16 p.m. CT) to
# 03:46 UTC, then 223.90 from 04:01 UTC (11:01 p.m. CT) on. Oct 8, 12 and 13
# turned over at the same 04:01 UTC fetch. Titles baked in that window said
# "closed $223.95". A cattle bar counts as finished only from 11 p.m. CT on its
# own date (a fetch before that reads the previous close).
SETTLE_CT = {"cattle": 23}


def _grain_overnight(fc, cdd, market):
    """True when a fetch at CT time fc is in the grain overnight session and
    the quote's bar (dated cdd) is still the day that closed before it."""
    return market == "grain" and cdd <= fc.date() and (
        (fc.hour >= 19 and fc.weekday() in (6, 0, 1, 2, 3)) or
        (fc.hour < 2 and fc.weekday() < 5 and cdd < fc.date()))


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
    if (q or {}).get("settled") and cdd:
        # fetch_prices.split_settle already moved the evening trade to `last`;
        # close is that session's finished close (2026-10-15).
        return False, md(cdd)
    if fu is None or cdd is None or CT is None:
        lab = md(cdd) if cdd else (md(fu) if fu else "")
        return None, lab
    fc = fu.astimezone(CT)
    hm = CLOSE_CT.get(market, CLOSE_CT["grain"])
    before_close = fc.weekday() < 5 and (fc.hour, fc.minute) < hm
    # Grain overnight session (CBOT reopens 7 p.m. CT, Sunday to Thursday).
    # Yahoo folds those trades into the bar of the day that just closed, under
    # that day's date: data/prices.json at 03:16 UTC Oct 15 2026 called Dec
    # corn "478.75, close_date Oct 14" while the Oct 14 close (18:46 UTC and
    # 00:01 UTC fetches) was 481.0. That is a trade, not a close.
    # Just after midnight the bar still carries yesterday's date (it moved
    # to the new day between 23:01 and 00:31 CT on Oct 13-14).
    unsettled = market in SETTLE_CT and cdd == fc.date() and fc.hour < SETTLE_CT[market]
    if _grain_overnight(fc, cdd, market) or cdd > fc.date() or (cdd == fc.date() and before_close) or unsettled:
        h12 = fc.hour % 12 or 12
        ampm = "a.m." if fc.hour < 12 else "p.m."
        return True, f"{md(fc)}, {h12}:{fc.minute:02d} {ampm} CT"
    return False, md(cdd)


def settled_close(q, fetched, market="grain"):
    """The newest FINISHED session in a quote, for text that has to stay true
    after it is baked (titles and meta descriptions).

    Returns {"px", "date" (YYYY-MM-DD), "label" ("Oct 13"), "net", "pct"} or
    None. A quote taken after the close is that close, with its change. A
    quote taken in the day session is a trade that will move; the finished
    session is then the previous close, close - netChange on prev_date, and
    its own change is not in the file, so net and pct are None. In the grain
    overnight, and with no timing in the file, there is nothing safe to say:
    None, and the page keeps what the post-close run baked.

    2026-10-15: the 8:31 a.m. CT Oct 14 quote was baked into the soybean
    description as "$12.88¼ (+0.35%)" and stood overnight, because the
    post-close run's push was rejected. Beans finished the day lower."""
    if not q:
        return None
    st, _ = quote_state(q, fetched, market)
    close = q.get("close")
    if not isinstance(close, (int, float)) or st is None:
        return None
    if st is True:
        # In the overnight the newest finished session is the day that just
        # closed, and its close is already buried under overnight trades;
        # the previous close would step a good bake back a day. Say nothing.
        try:
            fc = datetime.strptime(fetched, "%Y-%m-%dT%H:%M:%SZ").replace(
                tzinfo=timezone.utc).astimezone(CT)
            if _grain_overnight(fc, datetime.strptime(q.get("close_date"), "%Y-%m-%d").date(), market):
                return None
        except Exception:
            return None
        net, pd = q.get("netChange"), q.get("prev_date")
        if not isinstance(net, (int, float)) or not pd or q.get("roll"):
            return None
        px, d, net, pct = round(close - net, 4), pd, None, None
    else:
        px, d = float(close), q.get("close_date")
        net, pct = q.get("netChange"), q.get("pctChange")
        if q.get("roll"):
            net = pct = None
    try:
        dd = datetime.strptime(d, "%Y-%m-%d").date()
    except Exception:
        return None
    return {"px": px, "date": d, "label": dd.strftime("%b ") + str(dd.day),
            "net": net, "pct": pct}


def desc_change(sc):
    """' (-1¾¢)' for a close with its change in the file, ' (unch)' for a flat
    one, '' when the change is not known (a previous close)."""
    net = (sc or {}).get("net")
    if not isinstance(net, (int, float)):
        return ""
    mv = pricefmt.move(net, sign=True)
    return " (" + (mv if pricefmt.quarters(net) else "unch") + ")"


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
           ' &middot; Yahoo Finance, delayed (not CME settlements) &middot; quotes above refresh every 15 minutes in session</caption>',
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
            rng = "&ndash;".join(pricefmt.range_ends(q["wk52_lo"], q["wk52_hi"]))
        stale = " (last good quote)" if q.get("stale") else ""
        # class="num" -> tabular figures, ranged right. A price column set in a
        # proportional face and ranged left is the loudest "not a finance site"
        # signal there is; the styling rule lives once in components/styles.css.
        out.append('<tr><td>' + label + stale + '</td><td class="num">$' + usd +
                   '</td><td class="num">' + (_chg_cents(q) or "n/a") +
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


_MK_TICK, _MK_CENTS, _MK_INDEX = {"cattle", "feeders", "hogs"}, {"soyoil"}, {"dollar", "sp500"}

_MON3 = ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")


def nearby_of(q, root):
    """(quote, label) for a market's one quote (2026-10-16): the <root>-nearby
    alias, else the nearest dated month on file (fetch_prices writes only live
    months), else the continuous series with label None (most-active). None
    when nothing is on file. Twin of nearbyOf in components/futures.js and
    markets.html."""
    q = q or {}
    n = q.get(root + "-nearby")
    if n and n.get("close") is not None:
        return n, n.get("contract")
    best = None
    for k, v in q.items():
        m = re.match(r"^" + re.escape(root) + r"-([a-z]{3})(\d{2})$", k)
        if not m or m.group(1) not in _MON3 or not v or v.get("close") is None:
            continue
        i = int(m.group(2)) * 12 + _MON3.index(m.group(1))
        if best is None or i < best[0]:
            best = (i, v, m.group(1).capitalize() + " '" + m.group(2))
    if best:
        return best[1], best[2]
    c = q.get(root)
    return (c, None) if (c and c.get("close") is not None) else None


# every other markets card names its month the same way (pct-* chips)
MK_CHIPS = (("oats", "pct-oats"), ("cattle", "pct-cattle"), ("feeders", "pct-feeder"), ("hogs", "pct-hogs"),
            ("milk", "pct-milk"), ("meal", "pct-meal"), ("soyoil", "pct-oil"))


def _mk_num(v, key):
    """markets.html num(): livestock to the tick, everything else two places."""
    if key in _MK_TICK:
        return pricefmt.cash(v, dollar=False)
    return "{:,.2f}".format(float(_fixed(v, 2)))


def _mk_price(c, key):
    """markets.html dollar$(): $224.975, 67.72¢, 102.42 (index), $4,162.40."""
    t = _mk_num(abs(float(c)), key)
    return ("−" if float(c) < 0 else "") + ("" if key in _MK_INDEX or key in _MK_CENTS else "$") + t + ("¢" if key in _MK_CENTS else "")


def _chg_str(net, pct, grain, key=None):
    """markets.html chgStr, character for character."""
    if net is None:
        return "-"
    if grain:
        return pricefmt.change(net, pct)[0]
    a = "▲" if net > 0 else ("▼" if net < 0 else "")
    s = "+" if net > 0 else ("−" if net < 0 else "")
    return f"{a + ' ' if a else ''}{s}{_mk_num(abs(net), key)}{'¢' if key in _MK_CENTS else ''} ({pricefmt.pct(pct)})"


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
        for _, chip in MK_CHIPS:
            seeds["mk:" + chip] = "-"
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
    for root, chip in MK_CHIPS:
        r = nearby_of(q, root)
        if r:
            q[root] = r[0]
        seeds["mk:" + chip] = _e(r[1] or "most-active") if r else "-"
    n = 0
    for _, pid, cid, key, grain in MK_MAP:
        d = q.get(key) or {}
        c = d.get("close")
        if c is None:
            seeds["mk:" + pid] = "-"
            seeds["mk:" + cid] = "-"
            continue
        n += 1
        seeds["mk:" + pid] = (pricefmt.price(c) if grain else _mk_price(c, key))  # as the page script prints it
        cd = _iso_date(d.get("close_date")) or fd
        when = " &middot; " + _md(cd)
        if d.get("stale"):
            when += " (last good quote)"
        if d.get("roll"):
            seeds["mk:" + cid] = "contract roll" + when
        else:
            seeds["mk:" + cid] = _chg_str(d.get("netChange"), d.get("pctChange"), grain, key) + when
    for crop, sym in (("corn", "corn"), ("beans", "beans")):
        d = q.get(crop) or {}
        lo, hi = d.get("wk52_lo"), d.get("wk52_hi")
        rlo, rhi = pricefmt.range_ends(lo, hi) if (lo is not None and hi is not None) else ("-", "-")
        seeds["mk:rlo-" + sym] = rlo
        seeds["mk:rhi-" + sym] = rhi
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
        # the card's own format (geo.js / index.html qc, both AG.px slash
        # style), so the seed and the live price never print a quote two ways
        seeds["hp:" + k] = pricefmt.price(d["close"], style="slash")
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
            seeds["newslist"] = ('\n      <div class="nw-empty">Nothing has moved enough to post as of ' + _mdy(upd) +
                                 '. Quiet markets can go days without one.</div>\n    ')
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
# 2026-10-15: the page showed two weeks at once (title "Corn 54%" and the
# summary on Oct 4 while the data and the live table were on Oct 11) because
# these seeds were only re-baked by the freshness job. The two data workflows
# (crop_progress.yml, conditions.yml) now run `seed_static.py --only
# conditions` and `bake_seo.py --page conditions.html` right after each fetch,
# and test/conditions-week.test.mjs fails if any line names another week.
STATE_NAMES = {"AL": "Alabama", "AR": "Arkansas", "AZ": "Arizona", "CA": "California", "CO": "Colorado",
               "DE": "Delaware", "FL": "Florida", "GA": "Georgia", "IA": "Iowa", "ID": "Idaho",
               "IL": "Illinois", "IN": "Indiana", "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana",
               "MD": "Maryland", "MI": "Michigan", "MN": "Minnesota", "MO": "Missouri", "MS": "Mississippi",
               "MT": "Montana", "NC": "North Carolina", "ND": "North Dakota", "NE": "Nebraska",
               "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York", "OH": "Ohio", "OK": "Oklahoma",
               "OR": "Oregon", "PA": "Pennsylvania", "SC": "South Carolina", "SD": "South Dakota",
               "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VA": "Virginia", "WA": "Washington",
               "WI": "Wisconsin", "WV": "West Virginia", "WY": "Wyoming"}


def missing_years(pkg, first=2000):
    """Years before the current one that NO state in the package has a rating
    for at this week (2000 and 2012 at mid-October, 2025 for the shutdown).
    -> (first year any state has, [missing years])"""
    yrs = {y for s in (pkg or {}).get("states", {}).values() for y, _ in s.get("hist", [])}
    if not yrs:
        return None, []
    cur = int(str(pkg.get("week_ending", "0000"))[:4]) or max(yrs) + 1
    return min(yrs), [y for y in range(first, cur) if y not in yrs]


def _years_txt(ys):
    ys = [str(y) for y in ys]
    return ys[0] if len(ys) == 1 else (", ".join(ys[:-1]) + " or " + ys[-1])


def harvest_rows(cp, key, rd):
    """State harvest rows for one crop from crop-progress.json, only states on
    the national report week. -> [(ST, pct, prev_week, avg5)] most behind first."""
    out = []
    for st, d in sorted(((cp or {}).get("states") or {}).items()):
        s = (d or {}).get(key)
        if not s or s.get("pct") is None or _iso_date(s.get("date")) != rd:
            continue
        out.append((st, s["pct"], s.get("prev_week"), s.get("avg5"), s.get("prev_year")))
    out.sort(key=lambda r: ((r[1] - r[3]) if r[3] is not None else 999, r[0]))
    return out


def harvest_table(cp, key, crop, rd):
    rows = harvest_rows(cp, key, rd)
    if not rows:
        return ""
    lw = any(r[2] is not None for r in rows)
    ly = any(r[4] is not None for r in rows)
    pc = lambda v: "" if v is None else f"{v:g}%"
    h = [f"<caption>{crop} harvested, week ending {_mdy(rd)} &middot; furthest behind first</caption>"
         "<tr><th>State</th><th style=\"text-align:right\">Harvested</th>"
         + ("<th style=\"text-align:right\">Week before</th>" if lw else "")
         + ("<th style=\"text-align:right\">Last year</th>" if ly else "")
         + "<th style=\"text-align:right\">5-yr avg</th><th style=\"text-align:right\">vs avg</th></tr>"]
    for st, pct, pw, av, py in rows:
        gap = "" if av is None else (f"{pct - av:+g}".replace("-", "&minus;") + " pts")
        h.append(f"<tr><td>{_e(STATE_NAMES.get(st, st))}</td><td class=\"num\">{pct:g}%</td>"
                 + (f"<td class=\"num\">{pc(pw)}</td>" if lw else "")
                 + (f"<td class=\"num\">{pc(py)}</td>" if ly else "")
                 + f"<td class=\"num\">{pc(av)}</td>"
                 f"<td class=\"num\">{gap}</td></tr>")
    return "".join(h)


# 2026-10-16 audit: the page opened "Every drought summer..." in October with
# harvest pace buried under the condition ranks. In Oct and Nov (when USDA has
# harvest numbers on this week) the lede and a top block lead with harvest pace
# by state vs the five-year average; the summer lede runs Jun-Sep only.
COND_LEDE = {
    "harvest": ("Harvest pace first: how far each state&rsquo;s <strong>corn and soybean harvest</strong> is "
                "ahead of or behind its <strong>five-year average</strong>, from Monday&rsquo;s USDA Crop Progress. "
                "Below that, each state&rsquo;s Good+Excellent share, ranked against the same week of every "
                "year USDA rated it since 2000."),
    "summer": ("Every drought summer the coffee shop decides the crop is &ldquo;the worst ever.&rdquo; Sometimes "
               "it is. Usually it isn&rsquo;t. Below: each state&rsquo;s <strong>Good+Excellent share this "
               "week</strong>, ranked against <strong>the same week of every year USDA rated it since "
               "2000</strong>, so &ldquo;how bad&rdquo; gets a number."),
    "off": ("Each state&rsquo;s <strong>Good+Excellent share</strong> from USDA&rsquo;s weekly Crop Progress, "
            "ranked against <strong>the same week of every year USDA rated it since 2000</strong>. USDA rates "
            "crops from late spring into fall; between seasons the last ratings on file are shown."),
}
# the big corn and soybean states, in the order a reader looks for them
HARVEST_LEAD_STATES = ["IA", "IL", "NE", "MN", "IN", "SD", "OH", "ND", "KS", "MO", "WI", "MI"]


def cond_season(today, has_harvest):
    """'harvest' in Oct-Nov when this week's harvest numbers are in,
    'summer' Jun-Sep, else 'off'."""
    m = int(today[5:7])
    if m in (10, 11) and has_harvest:
        return "harvest"
    return "summer" if 6 <= m <= 9 else "off"


def harvest_lead(cp, rd):
    """Top-of-page block for harvest season: corn and soybeans harvested vs
    the five-year average for the big states on this week's report."""
    sts = (cp or {}).get("states") or {}

    def cell(st, key):
        s = (sts.get(st) or {}).get(key) or {}
        if s.get("pct") is None or _iso_date(s.get("date")) != rd:
            return None
        return s["pct"], s.get("avg5")

    def td(c):
        if c is None:
            return '<td class="num" style="color:#8a948f">&ndash;</td>'
        pct, av = c
        if av is None:
            return f'<td class="num">{pct:g}%</td>'
        g = pct - av
        cls = " lo" if g <= -10 else (" hi" if g >= 10 else "")
        gs = f"{g:+g}".replace("-", "&minus;")
        return f'<td class="num">{pct:g}% <span class="cd-hl-gap{cls}">{gs}</span></td>'

    rows = []
    for st in HARVEST_LEAD_STATES:
        c, s = cell(st, "corn_harvested"), cell(st, "soybeans_harvested")
        if c is None and s is None:
            continue
        rows.append(f"<tr><td>{_e(STATE_NAMES.get(st, st))}</td>{td(c)}{td(s)}</tr>")
    if not rows:
        return ""
    return ('<section class="cd-panel cd-hl" aria-labelledby="cd-hl-t">'
            '<div class="cd-panel-hd"><span class="cd-panel-t" id="cd-hl-t">Harvest pace by state vs average</span>'
            f'<span class="cd-fresh">week ending {rd.isoformat()}</span></div><div class="cd-panel-b">'
            f'<div class="tblscroll"><table class="cd-tbl cd-hl-t"><caption>Percent harvested, week ending {_mdy(rd)}, '
            'and points ahead (+) or behind (&minus;) the five-year average</caption>'
            '<tr><th>State</th><th style="text-align:right">Corn</th><th style="text-align:right">Soybeans</th></tr>'
            + "".join(rows) +
            '</table></div><p class="cd-hl-more">Every state USDA reported: <a href="#harvest">full harvest '
            'table</a>. A dash means USDA did not report that crop for that state this week.</p></div></section>')


def seed_conditions(today):
    cp = _load_json("data/crop-progress.json")
    cj = _load_json("data/conditions/conditions.json")
    seeds = {}
    # national line, from the same file bake_seo titles the page from
    rd = _iso_date((cp or {}).get("corn", {}).get("report_date") or (cp or {}).get("report_date"))
    corn = (cp or {}).get("corn") or {}
    soy = (cp or {}).get("soybeans") or {}
    prog = (cp or {}).get("progress") or {}
    live = bool(cp and cp.get("in_season") and corn.get("good_excellent") is not None
                and not _stale(rd, today, "conditions"))
    if live:
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
                 f"(USDA NASS). Pick a state for its rank against the same week in past years.")
        # first-screen line: the week and the national numbers, before any state
        wk = f"Week ending {_mdy(rd)} (USDA NASS): US corn <b>{ge:g}%</b> good-to-excellent"
        if soy.get("good_excellent") is not None and sd == rd:
            wk += f", soybeans <b>{soy['good_excellent']:g}%</b>"
        bits = []
        for k, nm in (("corn_harvested", "corn"), ("soybeans_harvested", "soybeans")):
            p = prog.get(k) or {}
            if p.get("pct") is not None and _iso_date(p.get("date")) == rd:
                b = f"{nm} {p['pct']:g}%"
                if p.get("avg5") is not None:
                    b += f" (avg {p['avg5']:g}%)"
                bits.append(b)
        if bits:
            wk += ". Harvested: " + ", ".join(bits)
        wk += "."
        # harvest by state
        hl = []
        for k, nm in (("corn_harvested", "Corn"), ("soybeans_harvested", "Soybeans")):
            p = prog.get(k) or {}
            if p.get("pct") is not None and _iso_date(p.get("date")) == rd:
                s = f"{nm} <strong>{p['pct']:g}%</strong> harvested"
                if p.get("avg5") is not None:
                    s += f" vs a {p['avg5']:g}% five-year average"
                hl.append(s)
        hline = (f"US, week ending {_mdy(rd)}: " + "; ".join(hl) + ".") if hl else \
            f"No national harvest figure for the week ending {_mdy(rd)}."
        htab = harvest_table(cp, "corn_harvested", "Corn", rd)
        nst = len(harvest_rows(cp, "corn_harvested", rd))
        if nst:
            hline += f" {nst} corn states reported this week."
        seeds["condharvline"] = hline
        has_h = any(((prog.get(k) or {}).get("pct") is not None and _iso_date((prog.get(k) or {}).get("date")) == rd)
                    for k in ("corn_harvested", "soybeans_harvested"))
        season = cond_season(today, has_h)
        seeds["condharvlead"] = harvest_lead(cp, rd) if season == "harvest" else ""
        seeds["condharvtable"] = htab or f'<tr><td style="color:#8a948f">No state harvest numbers for the week ending {_mdy(rd)}</td></tr>'
    else:
        why = ("USDA is between seasons" if cp and not cp.get("in_season") else
               (f"the latest national report on file is the week ending {_mdy(rd)}" if rd else "the national file is missing"))
        line = f"No current national rating: {why}."
        vsent = f"No current rating: {why}."
        wk = f"No current national rating: {why}."
        seeds["condharvline"] = f"No current harvest numbers: {why}."
        seeds["condharvtable"] = f'<tr><td style="color:#8a948f">No current harvest numbers: {why}</td></tr>'
        season = cond_season(today, False)
        seeds["condharvlead"] = ""
    # state table: the page script's table, corn tab, worst first
    pkg = ((cj or {}).get("crops") or {}).get("corn")
    # The lede names the first year the ratings actually have at this week (2001 in mid-October,
    # not the 2000 the query starts at), so it never contradicts the table note below it.
    fy0 = missing_years(pkg)[0] if pkg else None
    seeds["condlede"] = COND_LEDE[season].replace("since 2000", f"since {fy0}" if fy0 else "on record")
    we = _iso_date((pkg or {}).get("week_ending"))
    if pkg and pkg.get("states") and not _stale(we, today, "conditions"):
        rows = sorted(pkg["states"].items(), key=lambda kv: kv[1].get("pctile", 0))
        fy, miss = missing_years(pkg)
        line += (f" {len(pkg['states'])} corn states rated for the week ending {_mdy(we)}, each ranked "
                 f"against the same week of every year USDA rated it, {fy}&ndash;present (rank 1 = worst on record).")
        if miss:
            line += (f" No state has a rating at this week in {_years_txt(miss)} in the USDA file, so those "
                     f"years are not in the comparison.")
        h = [f"<caption>Corn, week ending {_mdy(we)} &middot; worst first</caption>"
             "<tr><th>State</th><th style=\"text-align:right\">G+E now</th>"
             "<th style=\"text-align:right\">Own avg</th><th style=\"text-align:right\">Rank (1 = worst)</th></tr>"]
        for ab, s in rows:
            h.append(f"<tr><td>{_e(ab)}</td><td class=\"num\">{_fixed(s['ge'], 0)}%</td>"
                     f"<td class=\"num\">{_fixed(s['avg'], 0)}%</td>"
                     f"<td class=\"num\">{s['rank_from_worst']} of {s['of']}</td></tr>")
        seeds["condtable"] = "".join(h)
        seeds["condfresh"] = f"week ending {we.isoformat()}"
        if live and we != rd:
            # the two files are fetched by different jobs; say so rather than
            # let a reader take two weeks for one
            line += (f" The state ranks are still on the week ending {_mdy(we)}; the ranking job has not "
                     f"caught up to USDA's {_mdy(rd)} report yet.")
    else:
        why = (f"latest state file is the week ending {_mdy(we)}" if we else "state file missing or off-season")
        seeds["condtable"] = f'<tr><td style="color:#8a948f">No current state ratings: {why}</td></tr>'
        seeds["condfresh"] = "-"
    seeds["condstats"] = line
    seeds["condvsent"] = vsent
    seeds["condweek"] = wk
    return _write_seeds("conditions.html", seeds)


# --- /scorecard ----------------------------------------------------------------
PB_VERDICT = {"not_enough": "Not enough calls yet.", "coin_flip": "Coin flip.",
              "held_up": "This one held up.", "worse_than_coin": "Worse than a coin flip."}
# "crowded" is the COT page's word for its own measure (cot_analysis.py); the
# bot's three-year rank is labeled as the bot's rule.
PB_SIGNAL = {"crowded_long": "The bot\u2019s own rule: funds in the top tenth of 3 years",
             "crowded_short": "The bot\u2019s own rule: funds in the bottom tenth of 3 years",
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


def _pb_why(c):
    """The Why cell. Same words as why() in scorecard.html. For a trend call
    the fund rank is said to be what let the trend decide (2026-10-16: "13-week
    trend up (87th percentile ...)" read as if the percentile were the trend)."""
    s = PB_SIGNAL.get(c.get("signal"), c.get("signal") or "")
    pct = c.get("cot_pct")
    if str(c.get("signal") or "").startswith("trend_"):
        t = c.get("trend_pct")
        if t is not None:
            s += f" ({'+' if t > 0 else ''}{_fixed(t, 1)}% over 13 weeks)"
        if pct is not None:
            s += (f". Funds at the {_pb_ord(_jsround(pct))} percentile of the last 156 reports, "
                  "not in the top or bottom tenth, so the trend decides")
    elif pct is not None:
        s += f" ({_pb_ord(_jsround(pct))} percentile of the last 156 reports)"
    return s


def _pb_cents(x):
    s = _fixed(abs(x), 2)
    return s.rstrip("0").rstrip(".") if "." in s else s


def _pb_stand(c):
    """Where an open call stands: the bot's latest close of the same contract
    against the entry. Not a grade and never counted. Same words as stand()
    in scorecard.html."""
    if c.get("status") == "graded":
        return "Graded: right" if c.get("outcome") == "hit" else "Graded: wrong"
    if c.get("status") != "open":
        return "-"
    m = c.get("mark") or {}
    if m.get("close") is None or c.get("entry") is None:
        return "Shows after the bot\u2019s next run"
    d = round((m["close"] - c["entry"]) * 100) / 100
    md = _iso_date(m.get("date"))
    head = f"{_pb_dollars(m['close'])} on {_md(md) if md else '-'}, "
    if d == 0:
        return head + "level with entry (a tie grades as a miss)"
    right = (c.get("direction") == "up" and d > 0) or (c.get("direction") == "down" and d < 0)
    return (head + f"{_pb_cents(d)} cents {'under' if d < 0 else 'over'} entry: "
            + ("right side so far" if right else "wrong side so far"))


def _pb_next(ne):
    if not ne or not ne.get("day"):
        return ""
    out = f"Next calls: at the {_pb_date(ne['day'])} close, on the {_pb_date(ne.get('report'))} report."
    if ne.get("after_holiday"):
        out += f" {_pb_date(ne['after_holiday'])} is a federal holiday, so the entry moves to the next business day."
    return out


PB_PLAIN_COIN = {"coin_flip": "no better than a coin flip", "worse_than_coin": "worse than a coin flip",
                 "held_up": "better than a coin flip on this page's test"}


def pb_plain(d):
    """One plain sentence for the top of /scorecard: what the backtest says, why
    the page exists anyway, and when the open calls get graded. The same words
    as plainLine() in scorecard.html."""
    ba = ((d.get("backtest") or {}).get("records") or {}).get("all") or {}
    out = []
    first = _iso_date(ba.get("first"))
    if ba.get("hit_rate") is not None and first:
        coin = PB_PLAIN_COIN.get(ba.get("verdict"))
        out.append(f"In plain words: replayed on history since {first.year}, the bot&rsquo;s rule was right "
                   f"{_pb_rate(ba.get('hit_rate'))} of the time" + (f", {coin}." if coin else "."))
        out.append("I publish its calls anyway, graded by code, so you can hold any market call to the same test.")
    opn = [c for c in d.get("calls") or [] if c.get("status") == "open" and c.get("exit_day")]
    if opn:
        days = sorted({c["exit_day"] for c in opn})
        n = len(opn)
        out.append(f"{'The open call is' if n == 1 else f'The {_pb_n(n)} open calls are'} not graded until "
                   f"{_pb_date(days[0])}" + ("" if len(days) == 1 else " or later") + ", on that day&rsquo;s close only.")
    return " ".join(out)


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
        seeds["pb:latest"] = f'<tr><td colspan="7">{why}.</td></tr>'
        seeds["pb:pb-next"] = ""
        seeds["pb:bycrop"] = f'<tr><td colspan="6">{why}.</td></tr>'
        seeds["pb:pb-updated"] = "-"
        seeds["pb:pb-plain"] = ""
        return _write_seeds("scorecard.html", seeds)
    labels = {c["key"]: c["label"] for c in d.get("crops") or []}
    R = d.get("rules") or {}
    seeds["pb:pb-plain"] = pb_plain(d)
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
        rows.append(f"<tr><td>{_e(labels.get(c.get('crop'), c.get('crop') or ''))}</td><td>{dir_span(c.get('direction'))}</td>"
                    f"<td>{_e(c.get('contract') or '')}</td><td class=\"num\">{_pb_dollars(c.get('entry'))}</td>"
                    f"<td>{_pb_date(c.get('exit_day'))}</td><td>{_e(_pb_stand(c))}</td><td>{_e(_pb_why(c))}</td></tr>")
    seeds["pb:latest"] = "".join(rows) or '<tr><td colspan="7">No calls yet.</td></tr>'
    seeds["pb:pb-next"] = _e(_pb_next(d.get("next_entry")))
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
    """USDA basis ($/bu, to the cent) in signed cents: −91¢, +4¢, even.
    The twin of basis.html fmt$ (AG.px.basis on the rounded cent)."""
    return pricefmt.basis(pricefmt._js_round(v * 100))


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
                         f"{_basis_money(w[1]['latest'])} against {_basis_money(w[1]['avg5'])})")
        seeds["basisstats"] = (f"USDA AgTransport elevator-bid basis against each region&rsquo;s own 5-year normal "
                               f"for the same week, week of {_mdy(wk)}. " + "; ".join(parts) +
                               ". Barge rates and origin-to-Gulf spreads below; USDA posts weekly.")
        seeds["basisfresh"] = f"week of {wk.isoformat()}"
        seeds["basisheld"] = basis_held_text(j, "Corn", wk)
        h = [f"<caption>Corn, week of {_mdy(wk)} &middot; weakest vs normal first</caption>"
             "<tr><th>Region</th><th style=\"text-align:right\">Basis now</th>"
             "<th style=\"text-align:right\">5-yr normal</th><th style=\"text-align:right\">Vs normal, cents/bu</th></tr>"]
        for name, s, age in rows:
            if age != 0:
                now = f"no USDA posting for the week of {_md(wk)}; last {_md(_iso_date(s['date']))}"
                vs = ""
            else:
                now = _basis_money(s["latest"])
                dl = s.get("delta")
                # a delta that rounds to a cent of nothing reads "even", not "+$0.00"
                vs = ("" if dl is None else _basis_money(dl))
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
    # A state missing one NASS figure still has a floor: the grain NASS did
    # publish over the bins. A missing crop can only push it up, so when the
    # floor is already over 1.00x it is shown as "at least" instead of dropped.
    # A floor is cut, not rounded: Wisconsin 2026 is 808.5 / 780 = 1.0366 with
    # no wheat stocks figure, so "at least 1.03x" (rounding would print 1.04).
    floors = []
    for st, r in cr["states"].items():
        if r.get("ratio") is not None or not r.get("cap") or not str(r.get("why", "")).startswith("NASS has no state figure for "):
            continue
        held = sum((r.get("stocks") or {}).values()) + sum(v[0] for v in (r.get("fall") or {}).values())
        if held / r["cap"] > 1:
            floors.append((st, r, held))
    floors.sort(key=lambda x: -x[2] / x[1]["cap"])
    per = sorted({v[1] for _, r in rows for v in r.get("fall", {}).values()})
    # NASS's annual final for a crop comes the January after harvest, and this
    # block only ever runs for the current year, so a "YEAR" row here is NASS's
    # latest estimate, never the final. It printed "(final)" on 2026-10-14.
    per_txt = ", ".join("latest NASS estimate" if p == "YEAR" else
                        p.replace("YEAR - ", "").replace(" FORECAST", " forecast").title().replace("Forecast", "forecast")
                        for p in per) or "forecast"
    mb = lambda x: _commas(round(x / 1e6)) if x else "-"
    floor2 = lambda x: int(x * 100) / 100

    def tr(st, ratio_txt, stocks, fall, cap, note=""):
        # on a phone the three input columns fold into one line under the state
        name = _e(ST_NAME.get(st, st)) + (f" <span class=\"st-note\">{note}</span>" if note else "")
        held_txt = (f"{mb(stocks)} stocks + " if stocks else "") + f"{mb(fall)} crop"
        return (f"<tr><td>{name}<span class=\"st-in\">{held_txt}, {mb(cap)} bins</span></td>"
                f"<td class=\"num\">{ratio_txt}</td><td class=\"num st-c\">{mb(stocks)}</td>"
                f"<td class=\"num st-c\">{mb(fall)}</td><td class=\"num st-c\">{mb(cap)}</td></tr>")
    trs = "".join(tr(st, f"{r['ratio']:.2f}&times;", sum(r['stocks'].values()),
                     sum(v[0] for v in r['fall'].values()), r['cap']) for st, r in rows)
    if floors:
        trs += ("<tr class=\"st-sub\"><td colspan=\"5\">Missing a NASS figure, so a floor: the grain NASS did "
                "publish is already more than the bins</td></tr>")
        trs += "".join(tr(st, f"at least {floor2(held / r['cap']):.2f}&times;", sum((r.get('stocks') or {}).values()),
                          sum(v[0] for v in (r.get('fall') or {}).values()), r['cap'],
                          _e(r["why"].replace("NASS has no state figure for ", "no figure for ")))
                       for st, r, held in floors)
    none = sorted(ST_NAME.get(st, st) for st, r in cr["states"].items()
                  if r.get("ratio") is None and r.get("why") and st not in {f[0] for f in floors})
    out = (lead + f"<p>This fall, <strong>{len(short)} of {len(rows)}</strong> states with full NASS figures have "
           f"more grain to hold than bin space: September 1 stocks plus the {yr} corn, soybean and sorghum crop "
           f"({_e(per_txt)}), over on-farm plus off-farm capacity. Over 1.00&times; means more grain than bins.</p>")
    if yr == 2026:
        # farmdoc's own conclusion, read 2026-10-15; it is about this year only
        out += (f"<p>That does not mean the bins run out. {FARMDOC} looked at how fast each state has cleared the "
                f"pressure from September to December in past years and concluded that, on current production "
                f"expectations, a storage crunch is unlikely in 2026. It can still pinch in some places, because bins, "
                f"stocks and crops are spread unevenly. <a href=\"{FARMDOC_URL}\">Read their study</a>.</p>")
    out += (f"<div class=\"tblscroll\"><table class=\"bs-tbl bs-st\"><caption>Million bushels &middot; most crowded first"
            f"</caption><tr><th>State</th><th style=\"text-align:right\">Grain vs bins</th>"
            f"<th class=\"st-c\" style=\"text-align:right\">Sept 1 stocks</th><th class=\"st-c\" style=\"text-align:right\">{yr} fall crop</th>"
            f"<th class=\"st-c\" style=\"text-align:right\">Capacity</th></tr>{trs}</table></div>")
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



# --- /milk-prices ---------------------------------------------------------------
# The dated figures on milk-prices.html, from data/dairy-data.json (written by
# scripts/fetch_dairy.py, the dairy workflow). Until 2026-10-13 these were typed
# by hand and the page body sat on August ($16.64) for crawlers and no-JS
# readers while the file already held September ($16.04). Every string here is
# the page script's own (classBlock, verdict, allMilk, states, render), so the
# live fill rewrites text in place and both say the same thing. Runs from the
# dairy workflow right after a fetch, and from freshness daily, which is what
# turns a class month into a dash once the next one is due and missing.
MILK_PAGE = "milk-prices.html"
MILK_DATA = "data/dairy-data.json"
MONL = ["January", "February", "March", "April", "May", "June", "July", "August",
        "September", "October", "November", "December"]
MINUS = "−"
# Class III teaching model, the page's classIII(): 7 CFR 1000.50 as amended 2025
MILK_MA_CHEESE, MILK_MA_WHEY = 0.2519, 0.2668
MILK_LB = {"protein": 3.30, "fat": 3.50, "os": 6.00}


def _mkey(k):
    m = re.match(r"^(\d{4})-(\d{2})$", str(k or ""))
    if not m or not 1 <= int(m.group(2)) <= 12:
        return None
    return int(m.group(1)) * 12 + int(m.group(2)) - 1


def _mlabel_idx(s):
    m = re.match(r"^\s*([A-Za-z]+)\s+(\d{4})\s*$", str(s or ""))
    if not m:
        return None
    low = [x.lower() for x in MONL]
    return int(m.group(2)) * 12 + low.index(m.group(1).lower()) if m.group(1).lower() in low else None


def _ilong(i):
    return f"{MONL[i % 12]} {i // 12}"


def _ishort(i):
    return f"{MON3[i % 12]} {i // 12}"


def _pos(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and v > 0 and v != float("inf")


def _fin(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and abs(v) != float("inf")


def _cwt(v):
    return "$" + _fixed(v, 2)


def _money4(v):
    return "$" + _fixed(v, 4)


def _sg(v, dp):
    r = float(_fixed(v, dp))
    return ("+" if r > 0 else MINUS if r < 0 else "") + "$" + _fixed(abs(r), dp)


def _arr(v):
    r = float(_fixed(v, 4))
    return "▲" if r > 0 else "▼" if r < 0 else "–"


def _cl(v):
    r = float(_fixed(v, 4))
    return "dp-pos" if r > 0 else "dp-neg" if r < 0 else "dp-flat"


def _jr(x, n):
    """Math.round(x*10^n)/10^n, halves up, as the page's r2/r4."""
    import math
    f = 10 ** n
    return math.floor(x * f + 0.5) / f


def milk_class3(cheese, whey, fat):
    """The page's classIII() teaching model, step for step."""
    c = cheese - MILK_MA_CHEESE
    pp = _jr(c * 1.383 + (c * 1.589 - fat * 0.91) * 1.17, 4)
    os_ = _jr((whey - MILK_MA_WHEY) * 1.03, 4)
    se = _jr(pp * MILK_LB["protein"] + os_ * MILK_LB["os"], 4)
    sk = _jr(se, 2)
    return {"pp": pp, "os": os_, "skimExact": se, "skim": sk,
            "val": _jr(0.965 * sk + MILK_LB["fat"] * fat, 2)}


def _milk_now(today):
    t = datetime.strptime(today, "%Y-%m-%d").date()
    now_idx = t.year * 12 + t.month - 1
    # last month's prices are announced on or before the 5th (7 CFR 1000.53):
    # until the 6th the month before that is still the newest that must exist
    return now_idx, now_idx - (1 if t.day > 5 else 2)


def _cell(cid, name, val, unit, chg, chg_cls, meta, attrs=""):
    chg_html = (f'<span class="dp-cell-chg {chg_cls}" id="{cid}-chg">{chg}</span>'
                if chg is not None else "")
    v = (val + f'<span class="dp-cell-unit">{unit}</span>') if unit else val
    return (f'<div class="dp-cell"><span class="dp-cell-name">{name}</span>'
            f'<span class="dp-cell-val" id="{cid}-val"{attrs}>{v}</span>{chg_html}'
            f'<span class="dp-cell-meta" id="{cid}-meta">{meta}</span></div>')


def milk_class_state(d, today):
    """(idx, stale) for the class block, or None when the file cannot seed it
    (no class prices, no month, or a month in the future)."""
    if not d or not (_pos(d.get("class3")) or _pos(d.get("class4")) or _pos(d.get("class2"))):
        return None
    idx = _mkey(d.get("class_month_key"))
    if idx is None:
        idx = _mlabel_idx(d.get("class_month"))
    now_idx, due = _milk_now(today)
    if idx is None or idx > now_idx:
        return None
    return idx, idx < due


def milk_allmilk_ok(a, today):
    """The page's window for NASS figures: this month back to two months ago."""
    if not a:
        return None
    idx = _mkey(a.get("month_key"))
    if idx is None:
        idx = _mlabel_idx(a.get("month"))
    now_idx, _ = _milk_now(today)
    if idx is None:
        return None
    return idx, not (now_idx - 2 <= idx <= now_idx)


def milk_seeds(d, today):
    """{tag: html} plus the class month key, or ({}, None) when nothing can be seeded."""
    seeds = {}
    cs = milk_class_state(d, today)
    seed_key = None
    STRIP_TAIL = []
    if cs:
        idx, stale = cs
        seed_key = f"{idx // 12}-{idx % 12 + 1:02d}"
        m = _e(d.get("class_month") or _ilong(idx))
        sh, pv = _ishort(idx), MON3[(idx + 11) % 12]
        c3, c4 = d.get("class3"), d.get("class4")
        p3, p4 = d.get("class3_prev"), d.get("class4_prev")
        cells = []
        if stale:
            why = f"Latest on file: {_ilong(idx)}. Older than last month’s announcement."
            for cid, name in (("c3", "Class III milk"), ("c4", "Class IV milk"), ("c2", "Class II milk")):
                cells.append(_cell(cid, name, "-", "", "", "dp-flat", why))
            seeds["milkverdict"] = f"The newest announced milk prices held here are from {_ilong(idx)}. A new month is due."
            seeds["milkvcls"] = (f'<li><span class="n">{MON3[idx % 12]}</span><span id="dp-v-aug">'
                                 "Class prices are not shown until the new month is loaded.</span></li>")
            seeds["milkcompsrc"] = "Component prices are not shown: the newest figures held are too old."
            seeds["milkprodsrc"] = "Product prices are not shown: the newest figures held are too old."
            seeds["milkcomp"] = "".join(_cell(cid, name, "-", "", None, "", why) for cid, name in (
                ("bf", "Butterfat"), ("pr", "Protein"), ("nf", "Nonfat solids"), ("os", "Other solids")))
            seeds["milkprod"] = "".join(_cell(cid, name, "-", "", "", "dp-flat", why) for cid, name in (
                ("chz", "Cheese"), ("but", "Butter"), ("ndm", "Nonfat dry milk"), ("dw", "Dry whey")))
        else:
            meta = f"{sh} · USDA announced"
            for cid, name, v, p in (("c3", "Class III milk", c3, p3), ("c4", "Class IV milk", c4, p4),
                                    ("c2", "Class II milk", d.get("class2"), d.get("class2_prev"))):
                if _pos(v):
                    dl = v - p if _pos(p) else None
                    attrs = f' data-v="{_fixed(v, 2)}"' if cid in ("c3", "c4") else ""
                    cells.append(_cell(cid, name, _cwt(v), "/cwt",
                                       "" if dl is None else f"{_arr(dl)} {_sg(dl, 2)} vs {pv}",
                                       "dp-flat" if dl is None else _cl(dl), meta, attrs))
                else:
                    cells.append(_cell(cid, name, "-", "", "", "dp-flat", "Not in the latest announcement feed"))
            # the verdict line and its list item (verdict())
            if _pos(c3) and _pos(c4):
                v = f"{_e(d.get('class_month') or _ilong(idx))} announced prices: Class III {_cwt(c3)}, Class IV {_cwt(c4)}."
                if _pos(p3) and _pos(p4):
                    d3, d4 = c3 - p3, c4 - p4

                    def mv(x):
                        return ("rose" if x > 0 else "fell" if x < 0 else "was unchanged") + (f" {_cwt(abs(x))}" if x else "")
                    v = f"{MON3[idx % 12]}: Class III {mv(d3)} to {_cwt(c3)}. Class IV {mv(d4)} to {_cwt(c4)}."
                seeds["milkverdict"] = v
                t = f"Class III, USDA announced: <strong>{_cwt(c3)}/cwt</strong>"
                if _pos(p3):
                    x = c3 - p3
                    t += (f", {'up ' if x > 0 else 'down '}{_cwt(abs(x))} from {MONL[(idx + 11) % 12]}"
                          if x else f", unchanged from {MONL[(idx + 11) % 12]}")
                t += f". Class IV: <strong>{_cwt(c4)}/cwt</strong>"
                if _pos(p4):
                    y = c4 - p4
                    t += f", {'up ' if y > 0 else 'down '}{_cwt(abs(y))}" if y else ", unchanged"
                seeds["milkvcls"] = (f'<li><span class="n">{MON3[idx % 12]}</span>'
                                     f'<span id="dp-v-aug">{t}.</span></li>')
            # components
            cp = d.get("components") or {}
            comp = []
            for cid, name, k, meta2 in (("bf", "Butterfat", "butterfat", "per lb of butterfat"),
                                        ("pr", "Protein", "protein", "per lb of protein"),
                                        ("nf", "Nonfat solids", "nonfat_solids", "per lb of nonfat solids"),
                                        ("os", "Other solids", "other_solids", "per lb of other solids")):
                v = cp.get(k)
                comp.append(_cell(cid, name, _money4(v), "/lb", None, "", meta2) if _pos(v) else
                            _cell(cid, name, "-", "", None, "", "Not in the latest announcement feed"))
            seeds["milkcomp"] = "".join(comp)
            src = "USDA AMS announcement of class and component prices"
            rel = _iso_date(d.get("class_release")) if d.get("class_release") else None
            if rel:
                src += f" · released {_mdy(rel)}"
            seeds["milkcompsrc"] = f"{m} · {src}. What each is paid per pound in your milk if you are on component pricing."
            # products: USDA survey averages
            sd = d.get("spot_date")
            pm = _e(sd) if isinstance(sd, str) and sh.lower() in sd.lower() else f"USDA survey avg · {sh}"
            prod = []
            for cid, name, k, ck in (("chz", "Cheese", "cheese", "cheese_chg"), ("but", "Butter", "butter", "butter_chg"),
                                     ("ndm", "Nonfat dry milk", "ndm", "ndm_chg"), ("dw", "Dry whey", "whey", "whey_chg")):
                v, c = d.get(k), d.get(ck)
                if _pos(v):
                    chg = (f"{_arr(c)} {re.sub(r'[.]0$', '', _fixed(abs(c * 100), 1))}¢ vs {pv}" if _fin(c) else "")
                    prod.append(_cell(cid, name, "$" + _fixed(v, 2), "/lb", chg, _cl(c) if _fin(c) else "dp-flat", pm))
                else:
                    prod.append(_cell(cid, name, "-", "", "", "dp-flat", "Not in the latest announcement feed"))
            seeds["milkprod"] = "".join(prod)
            seeds["milkprodsrc"] = f"USDA survey averages of what plants sold, {sh}. They feed the formulas. They are not CME spot closes."
        STRIP_TAIL = cells
        # the spread line (spread()); hidden, as the script hides it, when the block is not shown
        if _pos(c3) and _pos(c4):
            s = _jr(c3 - c4, 2)
            a = _fixed(abs(s), 2)
            words = "Class III equals Class IV." if s == 0 else f"Class III is ${a}{' above' if s > 0 else ' below'} Class IV."
            seeds["milkspread"] = (f'<p class="dp-spread" id="dp-spread"{" hidden" if stale else ""}>'
                                   f"<strong>Class III minus Class IV, {sh}: <span id=\"dp-spread-val\">"
                                   f"{'+' if s > 0 else MINUS if s < 0 else ''}${a}/cwt</span>.</strong> "
                                   f'<span id="dp-spread-words">{words}</span>'
                                   f'<span id="dp-spread-why">{milk_spread_why(s)}</span></p>')
            seeds["milktrapnow"] = (f'<p class="dp-sec-intro dp-trap-now" id="dp-trap-now"{" hidden" if stale else ""}>'
                                    f"{milk_trap_now(s, sh)}</p>")
        # the waterfall (render(..., true)) and the sandbox's starting point
        sc = d.get("survey_cheese") if _pos(d.get("survey_cheese")) else d.get("cheese")
        sw = d.get("survey_whey") if _pos(d.get("survey_whey")) else d.get("whey")
        sf = cp_fat = (d.get("components") or {}).get("butterfat")
        if not _pos(cp_fat):
            sf = d.get("survey_fat")
        if _pos(sc) and _pos(sw) and _pos(sf) and _pos(c3) and abs(milk_class3(sc, sw, sf)["val"] - c3) <= 0.02:
            seeds.update(milk_fall(sc, sw, sf, c3, d.get("class_month") or _ilong(idx), d.get("class3_math")))
    # all-milk (allMilk())
    a = (d or {}).get("all_milk")
    am = milk_allmilk_ok(a, today) if a and _pos(a.get("value")) else None
    am_cell = None
    if am:
        aidx, astale = am
        alab = _e(a.get("month") or _ilong(aidx))
        key = f"{aidx // 12}-{aidx % 12 + 1:02d}"
        if astale:
            am_cell = (f'<div class="dp-cell"><span class="dp-cell-name">All-milk price</span>'
                       f'<span class="dp-cell-val" id="am-val" data-key="{key}">-</span>'
                       f'<span class="dp-cell-chg dp-flat" id="am-chg"></span>'
                       f'<span class="dp-cell-meta" id="am-meta">Latest held: {_ilong(aidx)}. Too old to show.</span></div>')
            seeds["milkamsrc"] = "All-milk price is not shown: the newest figure held is too old."
            seeds["milkvam"] = (f'<li><span class="n">{MON3[aidx % 12]}</span><span id="dp-v-jul">'
                                "All-milk price is not shown until a newer month is loaded.</span></li>")
        else:
            v = a["value"]
            pvm, yl = MON3[(aidx + 11) % 12], f"{MON3[aidx % 12]} {aidx // 12 - 1}"
            parts = []
            if _pos(a.get("prev_month")):
                x = v - a["prev_month"]
                parts.append(f'<span class="{_cl(x)}">{_arr(x)} {_sg(x, 2)} vs {pvm}</span>')
            if _pos(a.get("year_ago")):
                x = v - a["year_ago"]
                parts.append(f'<span class="{_cl(x)}">{_arr(x)} {_sg(x, 2)} vs {yl}</span>')
            am_cell = (f'<div class="dp-cell"><span class="dp-cell-name">All-milk price</span>'
                       f'<span class="dp-cell-val" id="am-val" data-key="{key}">{_cwt(v)}<span class="dp-cell-unit">/cwt</span></span>'
                       f'<span class="dp-cell-chg" id="am-chg">{"<br>".join(parts)}</span>'
                       f'<span class="dp-cell-meta" id="am-meta">USDA NASS · {alab}</span></div>')
            seeds["milkamsrc"] = (f"All-milk price: USDA NASS, Agricultural Prices, {alab}; before hauling, "
                                  "includes quality, quantity and other premiums.")
            s = f"All-milk price, USDA NASS: <strong>{_cwt(v)}/cwt</strong>"
            pl = MONL[(aidx + 11) % 12]
            if _pos(a.get("prev_month")):
                e1 = v - a["prev_month"]
                s += f", {'up ' if e1 > 0 else 'down '}{_cwt(abs(e1))} from {pl}" if e1 else f", unchanged from {pl}"
            if _pos(a.get("year_ago")):
                e2 = v - a["year_ago"]
                s += (" and " if _pos(a.get("prev_month")) else ", ") + (
                    f"{'up ' if e2 > 0 else 'down '}{_cwt(abs(e2))} from a year earlier" if e2 else "unchanged from a year earlier")
            seeds["milkvam"] = (f'<li><span class="n">{MON3[aidx % 12]}</span>'
                                f'<span id="dp-v-jul">{s}. It is paid before hauling.</span></li>')
            seeds["milkexample"] = milk_example(v, alab)
    if cs and am_cell is None:
        am_cell = ('<div class="dp-cell"><span class="dp-cell-name">All-milk price</span>'
                   '<span class="dp-cell-val" id="am-val">-</span><span class="dp-cell-chg dp-flat" id="am-chg"></span>'
                   '<span class="dp-cell-meta" id="am-meta">Not in the latest NASS feed</span></div>')
    if cs:
        seeds["milkstrip"] = "\n      ".join(STRIP_TAIL + [am_cell])
    st = milk_states((d or {}).get("all_milk_states"), today)
    if st:
        seeds["milkstates"] = st
    return seeds, seed_key


MILK_MB_DATA = "data/dairy-mailbox.json"
MILK_MB_LINK = '<a href="https://mymarketnews.ams.usda.gov/viewReport/3357" rel="noopener">AMS mailbox report</a>'


def milk_mailbox_seeds(mb, today):
    """The mailbox price, dated, from data/dairy-mailbox.json (scripts/
    fetch_mailbox.py). AMS posts each month about three months after it ends,
    so a month up to four back is the newest there is. Five or more back means
    newer months are out and not loaded: the strip cell becomes a dash with the
    reason and the dated figure stays only in the list, labeled older.
    Until 2026-10-15 March 2026 was typed by hand, labeled "not current", with
    no way to pick up a newer month."""
    if not isinstance(mb, dict) or not _pos(mb.get("value")):
        return {}
    idx = _mkey(mb.get("month_key"))
    now_idx, _ = _milk_now(today)
    if idx is None or idx >= now_idx:
        return {}
    v, ml, sh = mb["value"], _ilong(idx), MON3[idx % 12]
    yc = mb.get("year_ago_change")
    behind = now_idx - idx >= 5
    yr = ""
    if _fin(yc):
        r = float(_fixed(yc, 2))
        yr = (", unchanged from a year earlier" if r == 0 else
              f", {'up' if r > 0 else 'down'} ${_fixed(abs(r), 2)} from a year earlier")
    lag = "AMS posts each month about three months after it ends."
    if behind:
        li_txt = (f"Older figure: the newest mailbox month loaded here is {ml}. Federal-order average "
                  f"<strong>{_cwt(v)}/cwt</strong>{yr}. {lag} Newer months should be out; see the {MILK_MB_LINK}.")
        # no id on the dash: components/loader.js shimmers an id'd dash for 6 s
        # waiting for a fill that never comes here (nothing fills it live)
        cell = _cell("mb", "Mailbox price", "-", "", "", "dp-flat",
                     f"Newest loaded: {ml}. Newer AMS months not loaded yet.").replace(' id="mb-val">', ' data-mb="none">')
    else:
        li_txt = (f"Mailbox price, {ml}: federal-order average <strong>{_cwt(v)}/cwt</strong>{yr}. "
                  f"{lag} Source: {MILK_MB_LINK}.")
        chg, cls = "", "dp-flat"
        if _fin(yc):
            chg, cls = f"{_arr(yc)} {_sg(yc, 2)} vs {_ishort(idx - 12)}", _cl(yc)
        cell = _cell("mb", "Mailbox price", _cwt(v), "/cwt", chg, cls, f"USDA AMS · {ml}")
    row = (f'<div class="dp-row dp-final"><div class="dp-row-main"><div class="dp-row-name">Your mailbox price</div>'
           f'<div class="dp-row-desc">What actually landed. In {ml} the federal-order mailbox average was {_cwt(v)}/cwt{yr}'
           f'{" (an older month: newer AMS figures are out and not loaded here yet)" if behind else ""}. '
           "This is the only number that pays your bills, and it's the one the market reports never lead with.</div></div>"
           f'<div class="dp-row-val">{_cwt(v)}<span class="u">/cwt</span></div></div>')
    return {"milkmbli": f'<li><span class="n">{sh}</span><span id="dp-v-mb">{li_txt}</span></li>',
            "milkmbcell": cell, "milkmbrow": row, "milkmbareas": milk_mailbox_areas(mb, idx, behind)}


# What each starred AMS reporting area covers (MMPR-0626 footnote, page 3).
MILK_MB_GROUPS = {
    "New England States": "CT, ME, MA, NH, RI, VT",
    "Eastern Pennsylvania": "PA east of the Western PA line",
    "Appalachian States": "KY, NC, SC, TN, VA",
    "Southeast States": "AL, AR, GA, LA, MS",
    "Southern Missouri": "southern Missouri counties",
    "Western Pennsylvania": "Warren to Fayette counties and west",
    "Corn Belt States": "KS, NE, northern Missouri",
    "Western Texas": "Texas west of the Fannin to Shelby county line",
    "Northwest States": "OR, WA",
}


def milk_mailbox_areas(mb, idx, behind):
    """The mailbox price by AMS reporting area for the same month as the
    average (fetch_mailbox.parse_areas, which checks each area against the
    report's by-month table). Empty when the areas are missing, for another
    month, or the month is too old to show; an old table never lingers."""
    a = mb.get("areas") if isinstance(mb, dict) else None
    rows = (a or {}).get("rows") if isinstance(a, dict) else None
    if (behind or not rows or a.get("month_key") != mb.get("month_key")
            or not all(isinstance(r, dict) and _pos(r.get("value")) for r in rows)):
        return '<div id="dp-mb-areas" hidden></div>'
    ml, sh = _ilong(idx), _ishort(idx)
    hi = max(rows, key=lambda r: r["value"])
    lo = min(rows, key=lambda r: r["value"])

    def chg(v):
        return (f'<td class="num {_cl(v)}">{_arr(v)} {_sg(v, 2)}</td>' if _fin(v) else '<td class="num">-</td>')
    body = []
    for r in rows:
        g = MILK_MB_GROUPS.get(r["area"])
        name = _e(r["area"]) + (f' <span class="dp-mb-grp">({_e(g)})</span>' if g else "")
        p, y = r.get("prev"), r.get("year_ago")
        body.append(f'<tr><th scope="row">{name}</th><td class="num">{_cwt(r["value"])}</td>'
                    + chg(r["value"] - p if _pos(p) else None) + chg(r["value"] - y if _pos(y) else None) + "</tr>")
    body.append(f'<tr class="dp-mb-all"><th scope="row">All federal order areas</th><td class="num">{_cwt(mb["value"])}</td>'
                + chg(mb.get("prev_month_change")) + chg(mb.get("year_ago_change")) + "</tr>")
    return (f'<div id="dp-mb-areas"><details class="dp-states">'
            f'<summary>Mailbox price by area, {ml} ({len(rows)} areas): highest {_e(hi["area"])} {_cwt(hi["value"])}, '
            f'lowest {_e(lo["area"])} {_cwt(lo["value"])}.</summary>'
            '<div class="dp-tbl-wrap"><table class="dp-tbl" aria-describedby="dp-mb-areas-cap">'
            '<caption class="dp-sr">Mailbox milk price by USDA AMS reporting area, dollars per hundredweight</caption>'
            f'<thead><tr><th scope="col">Area</th><th scope="col" class="num">{sh} $/cwt</th>'
            f'<th scope="col" class="num">vs {MON3[(idx - 1) % 12]}</th><th scope="col" class="num">vs {_ishort(idx - 12)}</th></tr></thead>'
            "<tbody>" + "".join(body) + "</tbody></table></div>"
            '<p class="dp-note-src" id="dp-mb-areas-cap">Net pay price after hauling and co-op deductions, as USDA AMS '
            "reports it for each area. Areas in AMS order; some are groups of states or parts of a state. "
            f"Source: {MILK_MB_LINK}.</p></details></div>")


def milk_spread_why(s):
    """The spread line's tail, the page script's spreadWhy(). The trap section
    is written for cheese on top; when Class IV leads, say so instead of
    pointing at it as this month's story (2026-10-15 head to head: Sep 2026
    had Class IV $2.90 over Class III under a line that read as the trap)."""
    if s < 0:
        return (" The trap below is the reverse case, cheese above butter and powder. With Class IV on top "
                "the same pooling math works against butter and powder plants instead. "
                '<a class="dp-jump" href="#dp-trap">See the trap</a>')
    return (' How far apart the two classes sit matters for your check. <a class="dp-jump" '
            'href="#dp-trap">Why: the trap, when your best milk pays you less</a>')


def milk_trap_now(s, sh):
    """The line under the trap heading, the page script's trapNow()."""
    a = _fixed(abs(s), 2)
    if s < 0:
        return f"Which way it runs now: in {sh}, Class IV was ${a} above Class III. That is the reverse of the case below."
    if s > 0:
        return f"Which way it runs now: in {sh}, Class III was ${a} above Class IV. That is the case below."
    return f"Which way it runs now: in {sh}, Class III and Class IV were equal."


def milk_fall(cheese, whey, fat, c3, month, math=None):
    """The waterfall as the page's render(SEED..., true) draws it, the sandbox
    sliders at the same point, and the script's SEED object."""
    r = milk_class3(cheese, whey, fat)
    mm = math if isinstance(math, dict) and math.get("class3") == c3 else None
    if mm:
        r = {"pp": mm.get("protein"), "os": mm.get("other_solids"), "skimExact": mm.get("skim_exact"),
             "skim": mm.get("skim"), "val": r["val"], "fat": mm.get("butterfat")}
    mon = _e(month)

    def row(cls, icon, name, desc, val, unit):
        return (f'<div class="dp-row {cls}"><div class="dp-row-main"><div class="dp-row-name">'
                + (f'<svg class="ic" aria-hidden="true"><use href="#{icon}"/></svg> ' if icon else "") + name + "</div>"
                + (f'<div class="dp-row-desc">{desc}</div>' if desc else "")
                + f'</div><div class="dp-row-val">{val}' + (f'<span class="u">{unit}</span>' if unit else "") + "</div></div>")
    skim_round = (f", which the federal order rounds to {_cwt(r['skim'])}"
                  if _jsround(r["skimExact"] * 10000) != _jsround(r["skim"] * 10000) else "")
    rows = [
        row("", "i-package", "Cheese price", "The USDA survey price for 40-lb cheddar blocks. Barrels left this survey in June 2025, so it is no longer a block-and-barrel weighted average.", _money4(cheese), "/lb"),
        row("dp-op deduct", "", "&minus; Make allowance (cheese)", "A fixed credit for turning milk into cheese, subtracted before the value reaches the farmer: a standard assumed cost across the order, not any one plant’s actual cost. Raised in 2025.", "&minus;" + _money4(MILK_MA_CHEESE), "/lb"),
        row("dp-result", "", "Protein price", "What’s left of the cheese value, converted to a per-pound milk-protein price by the federal yield formula.", _money4(r["pp"]), "/lb"),
        row("", "i-package", "Dry whey price", "The other cheese-plant output; its value becomes \"other solids\", the lactose and minerals in milk.", _money4(whey), "/lb"),
        row("dp-op deduct", "", "&minus; Make allowance (whey)", "The processing credit for drying whey, subtracted the same way.", "&minus;" + _money4(MILK_MA_WHEY), "/lb"),
        row("dp-result", "", "Other solids price", "", _money4(r["os"]), "/lb"),
        row("", "i-droplet", "Butterfat price", "Derived from the butter market (shared with Class IV). The fat in your milk.", _money4(fat), "/lb"),
        row("dp-op credit", "", "Component math &middot; per cwt at test",
            f"Skim milk price = protein {_money4(r['pp'])} × {_fixed(MILK_LB['protein'], 2)} lb + other solids {_money4(r['os'])} "
            f"× {_fixed(MILK_LB['os'], 2)} lb = {_money4(r['skimExact'])}{skim_round}. Class III = 0.965 × {_cwt(r['skim'])}, "
            f"plus butterfat {_money4(r.get('fat') if r.get('fat') is not None else fat)} × {_fixed(MILK_LB['fat'], 2)} lb.",
            "+ sum", ""),
        row("dp-final", "", "Class III milk price", "The federal minimum a cheese plant must pay for 100 lb of milk this month, as announced by USDA. What lands in the mailbox is this, blended with the other classes and adjusted by the producer price differential and hauling.", _cwt(c3), "/cwt"),
    ]

    def slider(key, label, lo, hi, v, aria):
        return (f'<div class="dp-slider-row">\n          <span class="dp-slider-lbl">{label}</span>\n'
                f'          <input type="range" class="dp-slider" id="sl-{key}" min="{lo}" max="{hi}" step="0.0001" '
                f'value="{_fixed(v, 4)}" aria-label="{aria}">\n'
                f'          <span class="dp-slider-val" id="sv-{key}">{_money4(v)}</span>\n        </div>')
    js = {"cheese": float(_fixed(cheese, 4)), "whey": float(_fixed(whey, 4)), "fat": float(_fixed(fat, 4)),
          "classIII": c3, "month": str(month)}
    if mm:
        js["math"] = mm
    return {
        "milkfallmonth": f"Class III &middot; <b>{mon}</b> &middot; the cheese-milk formula",
        "milkreset": f"&#x21BA; Reset to {mon} actuals",
        "milkfallbody": "\n        " + "\n\n        ".join(rows),
        "milksliders": "\n        ".join([
            slider("cheese", "Cheese", "1.00", "2.60", cheese, "Cheese price per pound"),
            slider("whey", "Dry whey", "0.20", "1.00", whey, "Dry whey price per pound"),
            slider("fat", "Butterfat", "1.00", "3.50", fat, "Butterfat price per pound")]),
        "__js": "var SEED=" + json.dumps(js, separators=(",", ":")).replace("</", "<\\/") + ";",
    }


MILK_EX_CWT, MILK_EX_COST = 2170, 19


def milk_example(v, alab):
    """One farm, one month: 2,170 cwt at the all-milk price against ERS's ~$19."""
    gross = _jr(MILK_EX_CWT * v, 0)
    cost = MILK_EX_CWT * MILK_EX_COST
    left = gross - cost
    lc = "pos" if left >= 0 else "neg"
    ls = ("" if left >= 0 else "&minus;") + "$" + _commas(abs(left))
    return (f'<div class="dp-example-line"><span>Ships ~217,000 lb/mo (2,170 cwt) at the {alab} all-milk price</span>'
            f'<span class="v">{_cwt(v)}/cwt</span></div>\n'
            f'      <div class="dp-example-line"><span>Gross milk check, before hauling</span><span class="v">${_commas(gross)}</span></div>\n'
            f'      <div class="dp-example-line"><span>Est. cost to produce at ~$19/cwt (ERS avg herd)</span>'
            f'<span class="v neg">&minus;${_commas(cost)}</span></div>\n'
            f'      <div class="dp-example-line tot"><span>Left for the mortgage, family, and reinvestment</span>'
            f'<span class="v {lc}">{ls}</span></div>\n'
            f"      <p class=\"dp-example-note\">Illustrative, using USDA NASS's {alab} all-milk price (before hauling and "
            "co-op deductions) and ERS's average cost of production. The mailbox price itself isn't published in real "
            "time (see above), so the true net figure, after hauling and PPD, sits lower than this. Beef and cull-cow "
            "income and each farm's own cost structure move the real number, which is exactly why the only cost that "
            "matters is <a href=\"/breakeven\" style=\"color:var(--gold);text-decoration:none\">your own</a>.</p>")


def milk_states(f, today):
    """The by-state table as the page's states() draws it. A table outside the
    page's window ships hidden behind the same dash line the script shows."""
    if not f or not isinstance(f.get("rows"), list) or not f["rows"]:
        return None
    mi = _mkey(f.get("month_key"))
    if mi is None:
        return None
    now_idx, _ = _milk_now(today)
    stale = not (now_idx - 2 <= mi <= now_idx)
    mlabel = _ilong(mi)
    rows = [r for r in f["rows"] if isinstance(r, dict) and isinstance(r.get("state"), str)]
    us = next((r for r in rows if r["state"] == "United States"), None)
    st = sorted((r for r in rows if r["state"] != "United States"),
                key=lambda r: (-(r["value"] if _pos(r.get("value")) else -1), r["state"]))
    have = [r for r in st if _pos(r.get("value"))]
    s = f"By state, {mlabel}: "
    if us and _pos(us.get("value")):
        s += f"United States {_cwt(us['value'])}/cwt. "
    if len(have) > 1:
        hi, lo = have[0], have[-1]
        s += (f"Highest {_e(hi['state'])} {_cwt(hi['value'])}, lowest {_e(lo['state'])} {_cwt(lo['value'])}, "
              f"gap {_cwt(hi['value'] - lo['value'])}.")

    def chg(v, base):
        if _pos(v) and _pos(base):
            x = v - base
            return f'<td class="num {_cl(x)}">{_arr(x)} {_sg(x, 2)}</td>'
        return '<td class="num">-</td>'
    body = []
    for r in ([us] if us else []) + st:
        cls = ' class="dp-us"' if r["state"] == "United States" else ""
        val = (f'<td class="num">{_cwt(r["value"])}</td>' if _pos(r.get("value"))
               else '<td class="num" title="Not reported in this table">-</td>')
        body.append(f'<tr{cls} data-state="{H.escape(r["state"])}"><th scope="row">{_e(r["state"])}</th>{val}'
                    f'{chg(r.get("value"), r.get("prev_month"))}{chg(r.get("value"), r.get("year_ago"))}</tr>')
    src = f"USDA NASS, Agricultural Prices, {mlabel}."
    src = (f"A dash means NASS gave no value for that state. {src}" if any(not _pos(r.get("value")) for r in st)
           else f"{src} Sorted high to low. Only states in the NASS table are shown.")
    none = (f'<p class="dp-fut-none" id="dp-states-none">- State prices are not shown: the newest held ({mlabel}) are too old.</p>'
            if stale else '<p class="dp-fut-none" id="dp-states-none" hidden></p>')
    seed_json = json.dumps({"month": f.get("month") or mlabel, "month_key": f.get("month_key"), "rows": rows},
                           separators=(",", ":"), ensure_ascii=False).replace("</", "<\\/")
    return (none + "\n"
            f'      <details class="dp-states" id="dp-states"{" hidden" if stale else ""}>\n'
            f'        <summary id="dp-states-sum">{s}</summary>\n'
            '        <div class="dp-states-pick"><label for="dp-state-sel">Highlight my state</label> <select id="dp-state-sel"><option value="">None</option></select></div>\n'
            '        <div class="dp-tbl-wrap"><table class="dp-tbl" aria-describedby="dp-states-cap">\n'
            '          <caption class="dp-sr">All-milk price received by farmers, by state, dollars per hundredweight</caption>\n'
            f'          <thead><tr><th scope="col">State</th><th scope="col" class="num" id="dp-st-h1">{_ishort(mi)} $/cwt</th>'
            f'<th scope="col" class="num" id="dp-st-h2">vs {MON3[(mi + 11) % 12]}</th>'
            f'<th scope="col" class="num" id="dp-st-h3">vs {MON3[mi % 12]} {mi // 12 - 1}</th></tr></thead>\n'
            '          <tbody id="dp-states-body">\n' + "\n".join(body) + "\n          </tbody>\n"
            '        </table></div>\n'
            f'        <p class="dp-note-src" id="dp-states-cap">Before hauling. Includes premiums. Not your mailbox price. <span id="dp-states-src">{src}</span></p>\n'
            '      </details>\n'
            f'      <script type="application/json" id="dp-states-seed">{seed_json}</script>')


MILK_JS_SEED = re.compile(r"var SEED=\{[^\n]*\};")
MILK_SEC = re.compile(r'(<section class="dp-sec" aria-labelledby="dp-mkt" id="dp-mkt-sec" data-seed-month=")([^"]*)(")')


def seed_milk(today):
    d = _load_json(MILK_DATA)
    if not isinstance(d, dict):
        print(f"  {MILK_PAGE}: {MILK_DATA} missing or unreadable, left alone")
        return False
    seeds, key = milk_seeds(d, today)
    js = seeds.pop("__js", None)
    seeds.update(milk_mailbox_seeds(_load_json(MILK_MB_DATA), today))

    def extra(t):
        if key:
            t = MILK_SEC.sub(lambda m: m.group(1) + key + m.group(3), t, count=1)
        if js:
            t = MILK_JS_SEED.sub(lambda m: js, t, count=1)
        return t
    if not seeds and not js:
        print(f"  {MILK_PAGE}: nothing seedable in {MILK_DATA}")
        return False
    changed = _write_seeds(MILK_PAGE, seeds, extra)
    if changed:
        t = open(MILK_PAGE, encoding="utf-8").read()
        t2, c = stamp_datemodified(t, today)
        if c:
            open(MILK_PAGE, "w", encoding="utf-8").write(t2)
        bump_sitemap(today, ["https://agsist.com/milk-prices"])
    return changed


def seed_data_pages(prices, today):
    """Each page fails alone: one bad file never stops the others."""
    ch = False
    for name, fn in (("markets", lambda: seed_markets(prices, today)),
                     ("homepage", lambda: seed_homepage(prices, today)),
                     ("news", lambda: seed_news(today)),
                     ("conditions", lambda: seed_conditions(today)),
                     ("scorecard", lambda: seed_scorecard(today)),
                     ("basis", lambda: seed_basis(today)),
                     ("elevators", lambda: seed_elevators(today)),
                     ("milk", lambda: seed_milk(today))):
        try:
            ch = fn() or ch
        except Exception as e:                        # noqa: BLE001
            print(f"  {name}: seed skipped — {type(e).__name__}: {e}")
    return ch


def bump_sitemap(today, urls=None):
    try:
        t = open(SITEMAP, "r", encoding="utf-8").read()
    except FileNotFoundError:
        print("  sitemap.xml not found — skipped")
        return False
    orig = t
    for url in (SITEMAP_URLS if urls is None else urls):
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
    return pricefmt.change(net, pct)


def _chg_seed(c):
    return ('<span class="' + c[1] + '">' + H.escape(c[0], quote=False) + "</span>") if c else ""


_FCODE = "FGHJKMNQUVXZ"
_MON_ABBR = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def _ticker_label(q, fallback):
    """The month label, Dec '26, from a dated quote's ticker (ZCZ26.CBT). corn-dec and
    beans-nov roll to next year's contract on their own (fetch_prices), so
    the seed names the month the quote actually is, never a typed year."""
    m = re.match(r"^[A-Z]{2}([FGHJKMNQUVXZ])(\d{2})\.", str((q or {}).get("ticker") or ""))
    return (_MON_ABBR[_FCODE.index(m.group(1))] + " '" + m.group(2)) if m else fallback


def _ct_now():
    n = datetime.now(timezone.utc)
    return n.astimezone(CT) if CT else n


def wheat_deferred(quotes, now=None):
    """(key, quote) of the wheat page's deferred card: the next live dated
    Chicago wheat contract after the front (the nearby), by the GRAIN calendar
    in contract_calendar.py. Twin of components/futures.js wheatDeferred, which
    uses storesell.js forwardCurve. It rolls on its own: Mar '27 while Dec '26
    is the nearby, May '27 from Dec 15 when Mar '27 becomes the nearby.
    (None, None) when nothing qualifies."""
    now = now or _ct_now()
    q = quotes or {}
    live = []
    for k, v in q.items():
        if not re.match(r"^wheat-[a-z]{3}\d{2}$", k):
            continue
        ym = _contract_ym(k)
        if not ym or is_expired(k, now) or not v or v.get("close") is None:
            continue
        live.append((ym, k, v))
    live.sort()
    if not live:
        return None, None
    n = q.get("wheat-nearby") or {}
    ft = n.get("ticker") if n.get("close") is not None else None
    fym = None
    m = re.match(r"^ZW([FGHJKMNQUVXZ])(\d{2})\.", str(ft or ""))
    if m:
        fym = (2000 + int(m.group(2)), _FCODE.index(m.group(1)) + 1)
    else:
        fym = live[0][0]   # no dated nearby: the nearest live contract is the front
    for ym, k, v in live:
        if ym > fym and v.get("ticker") != ft:
            return k, v
    return None, None


def wheat_class_quote(prices, cls):
    """(quote, month label) the wheat page's class card shows: the month the
    pipeline's same-month class spread uses (prices["spreads"]), else the
    class's nearby. Twin of classQ in components/futures.js. (None, None)
    when nothing is on file."""
    q = prices.get("quotes") or {}
    sp = (prices.get("spreads") or {}).get(cls) or {}
    k = sp.get("class_key")
    if sp.get("cents") is not None and k and (q.get(k) or {}).get("close") is not None:
        return q[k], sp.get("month") or _ticker_label(q[k], None)
    r = nearby_of(q, cls)
    return (r[0], r[1]) if r else (None, None)


def _nearby_label(prices, crop, fallback):
    """'Nearby Dec \'26' the way each page script builds it, else its fallback."""
    q = (prices.get("quotes") or {}).get(crop + "-nearby")
    if not q or q.get("close") is None:
        return fallback
    lab = q.get("contract") or (((prices.get("nearby") or {}).get(crop) or {}).get("label"))
    return ("Nearby " + lab) if lab else fallback


def futures_hero_seeds(page, prices, now=None):
    """{tag: html} for the hero seeds a futures page carries."""
    q = prices.get("quotes") or {}
    out = {}
    if page.startswith("corn"):
        hq = q.get("corn-nearby") or q.get("corn")
        out["exch"] = "CBOT &middot; CME Group &middot; " + _e(_nearby_label(prices, "corn", "Most-active (ZC)")) + " &middot; Refreshed in session"
        out["chg"] = _chg_seed(_fut_chg(hq))
        cd = q.get("corn-dec")
        # nearby == new crop (Dec corn from Sep on): the hero already shows it
        same = bool(cd and hq and hq.get("ticker") and hq.get("ticker") == cd.get("ticker"))
        if cd and cd.get("close") is not None and not same:
            pc = cd.get("pctChange")
            if cd.get("roll"):
                chg = '<span id="nc-chg" class="roll">(contract roll)</span>'
            elif pc is not None:
                net = cd.get("netChange") or 0
                chg = '<span id="nc-chg" class="' + ("up" if net >= 0 else "dn") + '">(' + pricefmt.pct(pc) + ")</span>"
            else:
                chg = '<span id="nc-chg"></span>'
            out["nc"] = ('<div class="nc-glance" id="nc-glance"><span id="nc-lbl">' + _ticker_label(cd, "Dec") + '</span> new crop: <strong id="nc-price">$' +
                         grain_dollars(cd) + "</strong> " + chg + "</div>")
        else:
            out["nc"] = ('<div class="nc-glance" id="nc-glance" style="display:none"><span id="nc-lbl">Dec</span> new crop: '
                         '<strong id="nc-price"></strong> <span id="nc-chg"></span></div>')
    elif page.startswith("soybean"):
        hq = q.get("beans-nearby") if (q.get("beans-nearby") or {}).get("close") is not None else q.get("beans")
        out["contract"] = _e(_nearby_label(prices, "beans", "Most-active (ZS)"))
        out["chg"] = _chg_seed(_fut_chg(hq))
        nq = q.get("beans-nov")
        same = bool(nq and hq and hq.get("ticker") and hq.get("ticker") == nq.get("ticker"))
        if nq and nq.get("close") is not None and not same:
            h = _ticker_label(nq, "Nov") + " new crop: <strong>$" + grain_dollars(nq) + "</strong>"
            np_ = nq.get("pctChange")
            if np_ is not None and not nq.get("roll"):
                h += (' <span class="' + ("up" if np_ >= 0 else "dn") + '">(' + pricefmt.pct(np_) + ")</span>")
            out["nc"] = '<div class="nc-line" id="nc-line">' + h + "</div>"
        else:
            out["nc"] = '<div class="nc-line" id="nc-line" style="display:none"></div>'
    elif page.startswith("wheat"):
        n = q.get("wheat-nearby")
        hq = n if (n and n.get("close") is not None) else q.get("wheat")
        out["contract"] = "&middot; " + _e(("Nearby " + n["contract"]) if (n and n.get("contract")) else "Most-active (ZW)")
        out["chg"] = _chg_seed(_fut_chg(hq))
        _, dq = wheat_deferred(q, now)
        same = bool(dq and hq and hq.get("ticker") and hq.get("ticker") == dq.get("ticker"))
        if dq and not same:
            pc = dq.get("pctChange")
            chg = (" (" + pricefmt.pct(pc) + ")") if (pc is not None and not dq.get("roll")) else ""
            out["bench"] = ('<div class="benchline" id="benchline">' + _e(_ticker_label(dq, "Deferred")) + ' (deferred): <strong>$' + grain_dollars(dq) +
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


def moved_seed(page, today):
    """The page's dated line of what USDA last printed and the board that day
    (moved_line.py), from the data files on disk. Facts side by side only."""
    import moved_line as ML
    crop = page.split("-")[0]
    if crop not in ML.CROPS:
        return ""
    tdate = _iso_date(today)
    if not tdate:
        return ML.moved_html(crop, None, None, None, None, None)
    return ML.moved_html(crop, _load_json("data/wasde.json"), _load_json("data/whats-priced-in.json"),
                         _load_json("data/harvest-prices.json"), _load_json("data/crop-progress.json"), tdate)


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
        if bench_key is None:      # wheat: next live contract after the nearby
            bq = wheat_deferred(quotes)[1]
            if bq:
                bench_label = _ticker_label(bq, "Deferred") + " (deferred)"
        else:
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

            # crawler-visible last-close table (marker optional per page)
            rows = [((("Nearby " + mon) if mon else "Front month"), fq),
                    (bench_label, bq)]
            if page.startswith("wheat"):
                for cls, nm in (("kcwheat", "KC HRW (KE"), ("mplswheat", "Minneapolis HRS (MWE")):
                    cq, cl = wheat_class_quote(prices, cls)
                    rows.append((nm + ", " + (cl or "most-active") + ")", cq))
            tbl = px_table(rows, flabel, live is True)
            has_tbl = bool(tbl) and "<!--SEED:pxtable-->" in t
            # the table caption names the source and delay; when it is on the
            # page the sentence above it does not repeat them (2026-10-11)
            note = (front_label + " " + verb + " near <strong>$" + f_usd +
                    "</strong>" + stale +
                    ((" &middot; " + bench_label + " near $" + b_usd) if b_usd else "") +
                    " &middot; as of " + flabel +
                    ("." if has_tbl else
                     " &middot; Yahoo Finance, delayed &middot; refreshed every 15 minutes during trading hours. Reload for the latest."))
            t, c2 = seed_between(t, "note", note)
            changed = c1 or c2
            if tbl:
                t, c4 = seed_between(t, "pxtable", tbl)
                changed = changed or c4

            # meta description: the newest finished session only
            tmpl = DESC.get(page)
            sc = settled_close(fq, fetched, "grain")
            if tmpl and sc is None:
                print(f"  {page}: no finished session in the file — description left as-is")
            if tmpl and sc:
                kc = settled_close(wheat_class_quote(prices, "kcwheat")[0], fetched, "grain")
                kc_usd = grain_dollars({"close": kc["px"]}) if kc and kc["date"] == sc["date"] else None
                desc, dnote = render_desc(
                    tmpl, px=grain_dollars({"close": sc["px"]}), mon=mon or "front month",
                    chg=desc_change(sc), date=sc["label"],
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
        # the dated "latest from USDA" line under the hero (scripts/moved_line.py)
        t, c7 = seed_between(t, "moved", moved_seed(page, today))
        changed = changed or c7
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

    # --only milk: the dairy workflow seeds milk-prices.html right after a
    # fetch, without touching the price pages it has no business committing
    if sys.argv[1:] == ["--only", "milk"]:
        print("CHANGED" if seed_milk(today) else "NO-CHANGE")
        return
    # --only conditions: the two crop-data workflows re-bake /conditions from
    # the files they just wrote, so its summary never trails its own data
    if sys.argv[1:] == ["--only", "conditions"]:
        print("CHANGED" if seed_conditions(today) else "NO-CHANGE")
        return

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
