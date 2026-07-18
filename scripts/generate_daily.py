#!/usr/bin/env python3
"""
AGSIST Daily Briefing Generator, v4.6.3
═══════════════════════════════════════════════════════════════════
Generates the daily agricultural intelligence briefing via Claude API.

v4.6.3 (model migration, 2026-06-16): MODEL -> claude-sonnet-4-6 (the old
claude-sonnet-4-20250514 was retired from the Claude API on 2026-06-15, causing 404s);
retry loop now fails fast on non-429 4xx instead of retrying a permanent error.

v4.6.2 (streaming transport fix, 2026-06-15): call_claude now streams the API
response so long briefings cannot trip the read-timeout (fixes the 2026-06-15 outage);
dropped two dead 404 RSS feeds; per-feed timeout 8->12s.

v4.6.1 (the deterministic-scrubber patch, 2026-05-30):
  - DRAMA-VERB SCRUBBER added as deterministic post-pass. The critic's
    rewrite is single-target (one weakest_target per pass: lead OR
    section_N OR basis OR ...). When voice fails across 5+ blocks
    (headline, section titles, takeaways, TMYK titles, Number unit)
    the critic rewrites the worst one and leaves the others. Plus the
    critic cannot rewrite headlines at all - they're not in the
    weakest_target enum. Scrubber walks every text field, applies
    word-boundary regex substitutions for all banned CNBC drama verbs
    (crashed, crater, exploded, surged, plunged, soared, rocketed,
    skyrocketed, slashed, collapsed, rout, exodus, ignited, bloodbath,
    carnage, meltdown, vaulted, binary). Case-preserving (UPPER, Title,
    lower). Idempotent. Audit log of substitutions printed to workflow.

v4.6.0 (the editorial-hardening upgrade, 2026-05-18):
  - TONE CALIBRATION REPLACED. The old table at 877-880 prescribed
    "exploded"/"crashed" for moves above 3.5% and "surged"/"spiked"
    for 2.5-3.5%. Those are CNBC drama verbs, not how a Wisconsin
    crop insurance guy talks to working farmers. New table stays in
    the working-ag register at every magnitude. Big moves get
    described by size + rarity ("biggest day in three weeks"), not
    by drama verbs. Banned-phrases list extended with all standard
    financial-media drama vocabulary (explode, crater, surge, soar,
    plunge, slash, exodus, ignite, bloodbath, etc.) and mirrored in
    critic Rule 9 voice failures.
  - CALENDAR_FACTS_2026 hardcoded reference block. Generator was
    inferring USDA release times and US market holidays from training
    data and getting them wrong (Memorial Day placed May 11 instead
    of May 25; Crop Progress shown as Tuesday 7:30AM instead of
    Monday 3PM CT). Hardcoded list eliminates the entire class. Holiday
    list valid through 2026; refresh annually.
  - ONGOING SITUATIONS file (data/ongoing-situations.json). Standing
    macro/geopolitical facts that propagate across briefings to prevent
    continuity drift (Hormuz tanker counts contradicting between Mon
    and Thu briefings; "Iran crisis" appearing without anchor). Manually
    maintained editorial input; loader injects active situations into
    the system prompt.
  - EDITORIAL NOTES file (data/editorial-notes.md). Cumulative log of
    corrections/preferences from prior reviews. Loader pulls last 15
    bullets and injects into prompt. Turns ongoing editorial feedback
    into compounding prompt quality without bloating the static rules.
  - ANTI-REPETITION on one_number topic. past_one_number_topics loader
    mirrors past_tmyk_topics pattern; prompt explicitly excludes prior
    Number anchors. Forces editorial range on the most-prominent block.
  - ANTI-CLICHE check (light). past_phrases loader extracts 3-grams
    appearing 3+ times in the last 2 briefings, injects as "overused
    phrases" exclusion. Catches repetition of approved-but-overused
    vocabulary ("the funds got out of", "managed money rotating", etc.)
    without adding a new critic rule.
  - USDA RELEASE-DAY AWARENESS. get_usda_release_today() checks today's
    date against hardcoded 2026 release calendar (Crop Progress, WASDE,
    Export Sales, Cattle on Feed, Quarterly Stocks, Prospective Plantings,
    Acreage). On release days, the prompt directs anticipation framing
    rather than result-pretending. Refresh dates annually.

v4.5.0 (the math-sanity + markdown-cleanup upgrade, 2026-05-08):
  - LEVEL COHERENCE VALIDATOR: new validate_level_coherence() function
    runs after generation. Scans body prose for "broke $X" / "below $X"
    / "above $X" patterns, matches against the locked close for the
    cited commodity, and warns on contradictions. Catches the failure
    mode that hit Monday 2026-05-04 (cattle close $253 paired with
    headline "BREAK $252"). 0.2% tolerance allows editorial framing of
    round-number breaks without false positives. Tested against actual
    Monday failure plus 9 control cases.
  - HTML-TO-MARKDOWN SANITIZER: new sanitize_html_tags() converts any
    literal <strong>/<em> in body fields to **markdown**/*emphasis*.
    Frontend mdInline (daily.html v4.4.2, index.html v4.4.2) renders
    either format, but storing markdown in JSON keeps the source of
    truth clean for downstream consumers (email, RSS, AI crawlers).
    Idempotent. Field-scoped to body fields, leaves structural fields
    untouched.
  - PROMPT SCHEMA UPDATED: section.body and basis.body schema descriptions
    now require **markdown** instead of <strong> tags. Pairs with the
    sanitizer for defense in depth.
  - RULES 17 + 18 ADDED:
    * Rule 17 (LEVEL COHERENCE): math-sanity rule with explicit
      examples of valid/invalid framing. Reinforces the validator.
    * Rule 18 (MACRO EVENT ANCHORING): first reference to ongoing
      geopolitical thread per week requires a one-clause anchor (e.g.,
      "Iran-Iraq tensions over Hormuz, ongoing since March"). Helps new
      readers and improves AI citation context.
  - BANNED PHRASES EXTENDED: added "binary"/"binary level"/"binary
    week" (trader-tech jargon Sigurd flagged Sunday 2026-05-03),
    "decisively below"/"decisively above" (the math-contradiction
    risk), "referendum on" and "categorical" (press-release register).

v4.4 carried over:
  - News pipeline overhaul, news discipline flip
  - Outside the Pit, section catalyst chip
  - Banned phrases block
  - One Number rubric, Yesterday's Call outcome rubric

v4.3 carried over:
  - the_takeaway committable single-line callout
  - per-section vs_yesterday continuity chip
  - cash-bids inline conversion footer
  - weekend block sanitization

v4.2 carried over:
  - mood-aware quote re-selection
  - retry with exponential backoff on transient API failures

v4.0 carried over:
  - voice transplant in system prompt
  - yesterdays_call block + render
  - spread_to_watch
  - weekly thread (Mon sets, Tue-Fri advance, Fri resolves)

v4.5.0 pairs with critique_briefing.py v1.2 which adds matching critic
rules (14: level coherence, 15: one-number coherence, 16: markdown not
HTML, 17: macro anchoring). Run order unchanged: generator first, then
critic. Both must run for the full quality gate.

Env vars required:
  ANTHROPIC_API_KEY
"""

import json
import os
import sys
import random
import re
from datetime import datetime, timezone, timedelta

from contract_calendar import is_expired   # ONE definition of contract expiry
from pathlib import Path

try:
    import feedparser
except ImportError:
    feedparser = None

try:
    import requests
except ImportError:
    import urllib.request
    import urllib.error
    requests = None

REPO_ROOT = Path(__file__).resolve().parent.parent
PRICES_PATH = REPO_ROOT / "data" / "prices.json"
OUTPUT_PATH = REPO_ROOT / "data" / "daily.json"
QUOTE_POOL_PATH = REPO_ROOT / "data" / "quote-pool.json"
ANTHROPIC_API = "https://api.anthropic.com/v1/messages"
MODEL = "claude-sonnet-4-6"
OG_IMAGE_BASE = None

SURPRISE_THRESHOLDS = {
    "corn": 1.5, "corn-dec": 1.5, "beans": 1.5, "beans-nov": 1.5,
    "wheat": 2.0, "oats": 2.5, "cattle": 1.5, "feeders": 1.5,
    "hogs": 2.0, "milk": 3.0, "meal": 2.0, "soyoil": 2.5,
    "crude": 3.0, "natgas": 4.0, "gold": 1.5, "silver": 2.5,
    "dollar": 0.5, "sp500": 1.5, "bitcoin": 4.0,
}

COMMODITY_LABELS = {
    "corn": "Corn (nearby)", "corn-dec": "Corn Dec '26",
    "beans": "Soybeans (nearby)", "beans-nov": "Soybeans Nov '26",
    "wheat": "Chicago Wheat", "oats": "Oats",
    "cattle": "Live Cattle", "feeders": "Feeder Cattle",
    "hogs": "Lean Hogs", "milk": "Class III Milk",
    "meal": "Soybean Meal", "soyoil": "Soybean Oil",
    "crude": "WTI Crude Oil", "natgas": "Natural Gas",
    "gold": "Gold", "silver": "Silver",
    "dollar": "US Dollar Index", "sp500": "S&P 500",
    "bitcoin": "Bitcoin",
}

GRAIN_KEYS = {"corn", "corn-dec", "beans", "beans-nov", "wheat", "oats"}

# v4.5: rebuilt against the 2026-07-18 probe-feeds run (probe_feeds.py, from the
# real Actions runner IP — the only vantage point that matters). Findings:
#   - modern UA fixed nothing (0 feeds); 30s timeout fixed nothing (0 feeds)
#   - 5 feeds are genuinely dead from Azure: nass/news (newest item 296d old),
#     usda.gov + ams + fas (403 datacenter-IP block), feednavigator (empty even
#     via Google News). DROPPED — a permanently dark feed is noise in the
#     coverage tally and makes real degradation harder to see.
#   - 7 publishers block direct fetch but are fully recoverable via Google News
#     RSS (site: query, headlines+links — which is all the briefing uses).
#     Probe measured 100 items each, newest 0.2–3.1d.
# Entries are (label, url): label is the PUBLISHER domain, kept stable so
# `source` chips and the dark-feed diagnostics name the publication, not
# news.google.com seven times.
_GN = "https://news.google.com/rss/search?q=site%3A{}&hl=en-US&gl=US&ceid=US%3Aen"

AG_RSS_FEEDS = [
    # Tier 1: federal sources that answer from datacenter IPs (probe: OK)
    ("nass.usda.gov",    "https://www.nass.usda.gov/rss/reports.xml"),   # WASDE, Crop Progress, Cattle on Feed
    ("eia.gov",          "https://www.eia.gov/rss/todayinenergy.xml"),   # crude, ethanol
    # Tier 2: trade publications — direct where the probe says direct works
    ("agri-pulse.com",   _GN.format("agri-pulse.com")),                  # DC ag policy (direct = 404)
    ("world-grain.com",  _GN.format("world-grain.com")),                 # grain industry (direct = empty feed)
    ("agweb.com",        _GN.format("agweb.com")),                       # general ag (direct = 403 WAF)
    ("agproud.com",      _GN.format("agproud.com")),                     # dairy/cattle/forage (direct = empty feed)
    ("brownfieldagnews.com", "https://brownfieldagnews.com/feed/"),      # ag radio, livestock-strong
    ("thefencepost.com", "https://www.thefencepost.com/feed/"),          # western ag
    # Tier 3: livestock-specific
    ("drovers.com",      _GN.format("drovers.com")),                     # cattle (direct = 403 WAF)
    ("beefmagazine.com", "https://www.beefmagazine.com/rss.xml"),        # beef
    ("dairyherd.com",    _GN.format("dairyherd.com")),                   # dairy (direct = 403 WAF)
    ("porkbusiness.com", _GN.format("porkbusiness.com")),                # pork (direct = 403 WAF)
    ("feedstuffs.com",   "https://www.feedstuffs.com/rss.xml"),          # feed industry
    ("no-tillfarmer.com", "https://www.no-tillfarmer.com/rss/articles"), # no-till
    # Tier 4: energy / inputs
    ("oilprice.com",     "https://oilprice.com/rss/main"),               # crude/energy
    # Tier 5: policy / academic / DC insider
    ("farmpolicynews.illinois.edu", "https://farmpolicynews.illinois.edu/feed/"),
    ("farmdocdaily.illinois.edu",   "https://farmdocdaily.illinois.edu/feed"),
]

# v4.4: news clustering buckets, every story tags into one bucket so the
# model gets news organized by relevance to each section, not as a wall.
NEWS_BUCKETS = {
    "GRAINS & OILSEEDS": [
        "corn", "soybean", "soy ", "wheat", "oats", "barley", "sorghum",
        "grain", "planting", "crop progress", "harvest", "ethanol",
        "crush", "meal", "soyoil", "soybean oil", "yield", "acres",
    ],
    "LIVESTOCK & DAIRY": [
        "cattle", "beef", "feedlot", "feeder", "hog", "pork", "swine",
        "dairy", "milk", "cheese", "whey", "butter", "lean", "boxed beef",
        "cattle on feed", "cold storage", "bird flu", "h5n1", "avian",
    ],
    "ENERGY & INPUTS": [
        "crude", "wti", "brent", "ethanol mandate", "rfs", "fertilizer",
        "urea", "uan", "anhydrous", "potash", "phosphate", "diesel",
        "natural gas", "biofuel", "renewable diesel", "saf",
    ],
    "POLICY & TRADE": [
        "china", "tariff", "trade", "export", "import", "wasde", "usda",
        "epa", "farm bill", "policy", "rule", "regulation", "ustr",
        "section 232", "section 301", "phase one", "shipment", "vessel",
        "panama", "mississippi river", "rail strike", "stb",
    ],
    "WEATHER & CLIMATE": [
        "drought", "rain", "weather", "frost", "freeze", "flood",
        "la nina", "el nino", "noaa", "monsoon", "heat dome",
        "polar vortex", "blizzard", "hurricane", "tropical",
    ],
    "MACRO": [
        "dollar", "fed ", "fomc", "inflation", "recession", "treasury",
        "cpi", "ppi", "jobs report", "rate cut", "rate hike",
    ],
}

FILLER_ATTRIBUTIONS = {"unknown", "anonymous", "n/a", "", "\u2014", "\u2013", "-"}


# v4.6: Hardcoded calendar facts. Generator was inferring USDA release times
# and US market holidays from training data and getting them wrong (Memorial
# Day placed May 11 instead of May 25; Crop Progress shown as Tuesday 7:30AM
# instead of Monday 3PM CT). Hardcoded reference eliminates the entire class.
CALENDAR_FACTS_2026 = """
══ CALENDAR REFERENCE (2026) ══

US 2026 holidays (markets closed; never schedule events on these dates):
  - Jan 1 Thu       New Year's Day
  - Jan 19 Mon      MLK Day
  - Feb 16 Mon      Presidents Day
  - Apr 3 Fri       Good Friday (equities only; CME grain closed)
  - May 25 Mon      Memorial Day
  - Jun 19 Fri      Juneteenth
  - Jul 3 Fri       Independence Day observed (Jul 4 falls on Sat)
  - Sep 7 Mon       Labor Day
  - Nov 26 Thu      Thanksgiving
  - Nov 27 Fri      Early close (1 PM CT equities, 12:05 PM CT CBOT)
  - Dec 25 Fri      Christmas

USDA recurring report release times (use these exact day/time pairings):
  - Crop Progress:        Monday 3:00 PM CT during planting/growing/harvest season.
                          If Monday is a holiday, releases Tuesday 3:00 PM CT.
  - WASDE:                Monthly, around the 9th-12th, 11:00 AM CT.
  - Weekly Export Sales:  Every Thursday, 7:30 AM CT.
  - Cattle on Feed:       Monthly, third or fourth Friday, 2:00 PM CT.
  - Quarterly Stocks:     Jan/Mar/Jun/Sep, 11:00 AM CT.
  - Prospective Plantings: Late March (around Mar 31), 11:00 AM CT.
  - Acreage report:       Late June (around Jun 30), 11:00 AM CT.
  - Cold Storage:         Around 22nd of each month, 2:00 PM CT.

CME settlement times (relevant for "Friday's close" framing):
  - CBOT grain: 1:20 PM CT
  - CME livestock: 1:00 PM CT
  - NYMEX crude: 1:30 PM CT

If a watch_list item references one of these releases, the day-of-week and
time MUST match this table. Never invent alternate release times.
"""




def get_market_status():
    now = datetime.now()
    weekday = now.weekday()
    month, day = now.month, now.day
    if weekday == 5:
        return {"is_closed": True, "reason": "weekend", "day_name": "Saturday",
            "note": "TODAY IS SATURDAY. Markets CLOSED. Write WEEKEND RECAP and WEEK-AHEAD OUTLOOK. Reference 'Friday's close'. No overnight language."}
    if weekday == 6:
        return {"is_closed": True, "reason": "weekend", "day_name": "Sunday",
            "note": "TODAY IS SUNDAY. Markets CLOSED. Write SUNDAY PREVIEW and WEEK AHEAD. Reference 'Friday's close'. No overnight language."}
    fixed_holidays = {(1, 1): "New Year's Day", (7, 4): "Independence Day", (12, 25): "Christmas Day"}
    for (hm, hd), hname in fixed_holidays.items():
        if month == hm and day == hd:
            return {"is_closed": True, "reason": "holiday", "day_name": hname,
                "note": f"TODAY IS {hname.upper()}. Markets CLOSED."}
        if weekday == 4 and month == hm and day == hd - 1:
            return {"is_closed": True, "reason": "holiday", "day_name": f"{hname} (observed)",
                "note": f"TODAY IS {hname.upper()} OBSERVED. Markets CLOSED."}
        if weekday == 0 and month == hm and day == hd + 1:
            return {"is_closed": True, "reason": "holiday", "day_name": f"{hname} (observed)",
                "note": f"TODAY IS {hname.upper()} OBSERVED. Markets CLOSED."}
    y = now.year
    a = y % 19; b = y // 100; c = y % 100; d = b // 4; e = b % 4
    f = (b + 8) // 25; g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30; i = c // 4; k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m_val = (a + 11 * h + 22 * l) // 451
    easter_month = (h + l - 7 * m_val + 114) // 31
    easter_day = ((h + l - 7 * m_val + 114) % 31) + 1
    easter = datetime(y, easter_month, easter_day)
    good_friday = easter - timedelta(days=2)
    if now.month == good_friday.month and now.day == good_friday.day:
        return {"is_closed": True, "reason": "holiday", "day_name": "Good Friday",
            "note": "TODAY IS GOOD FRIDAY. Markets CLOSED."}
    day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
    return {"is_closed": False, "reason": "open", "day_name": day_names[weekday], "note": ""}


# Mood-affinity table for mood-aware quote selection (v4.2 / Phase 2 C2).
# When market_mood is set on the briefing meta, the generator can re-pick
# a quote from a tag-affinity bucket. If no tagged quote matches, falls
# back to full pool, never blocks the briefing on a mood mismatch.
QUOTE_MOOD_AFFINITY = {
    "bullish":   ["markets", "planting", "work", "innovation", "mindset"],
    "bearish":   ["risk", "wisdom", "thrift", "markets", "philosophy"],
    "mixed":     ["wisdom", "mindset", "strategy", "philosophy"],
    "cautious":  ["risk", "wisdom", "thrift", "planning"],
    "volatile":  ["risk", "markets", "mindset", "wisdom"],
}


def get_todays_quote(market_mood=None):
    """Pick a quote from the pool. If market_mood is given, prefer
    quotes whose tags match the mood's affinity table. Falls back to
    full-pool random if no mood match. Daily-deterministic seed so
    the same day always picks the same quote (idempotent reruns).

    v4.2: market_mood parameter added for two-pass selection. Generator
    calls this once before generation with mood=None, then re-calls after
    generation with the briefing's actual market_mood and overrides.
    """
    fallback = {"text": "Agriculture is our wisest pursuit, because it will in the end contribute most to real wealth, good morals, and happiness.",
                "attribution": "Thomas Jefferson"}
    if not QUOTE_POOL_PATH.exists(): return fallback
    try:
        with open(QUOTE_POOL_PATH) as f: pool = json.load(f)
    except Exception: return fallback
    quotes = [q for q in pool.get("quotes", [])
              if q.get("text") and q.get("attribution")
              and q["attribution"].strip().lower() not in FILLER_ATTRIBUTIONS]
    if not quotes: return fallback

    # Mood-affinity filter, soft preference, not hard requirement
    candidates = quotes
    if market_mood:
        wanted = set(QUOTE_MOOD_AFFINITY.get(market_mood.lower(), []))
        if wanted:
            tagged = [q for q in quotes
                      if wanted.intersection(set(q.get("tags") or []))]
            if tagged: candidates = tagged

    now = datetime.now()
    seed = now.timetuple().tm_yday + now.year * 1000
    if market_mood:
        # Different mood → different seed → different pick on the same day
        seed += sum(ord(c) for c in market_mood)
    random.seed(seed)
    q = random.choice(candidates)
    random.seed()
    return {"text": q["text"], "attribution": q["attribution"]}


def http_get(url, timeout=10):
    """v4.4.1: realistic browser headers fix the wave of 403 Forbidden
    responses we saw in v4.4. Many ag publications block requests that
    don't look like a real browser. Sending Chrome-style UA + Accept
    headers gets us past the bot wall."""
    headers = {
        "User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                       "AppleWebKit/537.36 (KHTML, like Gecko) "
                       "Chrome/124.0.0.0 Safari/537.36"),
        "Accept": ("application/rss+xml, application/atom+xml, "
                   "application/xml;q=0.9, text/xml;q=0.9, */*;q=0.8"),
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate",
        "Cache-Control": "no-cache",
    }
    if requests:
        try:
            r = requests.get(url, headers=headers, timeout=timeout,
                             allow_redirects=True)
            r.raise_for_status()
            return r.text
        except Exception as e:
            print(f"  [warn] fetch failed: {url}: {e}", file=sys.stderr)
            return None
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except Exception as e:
        print(f"  [warn] fetch failed: {url}: {e}", file=sys.stderr)
        return None


# ── Front-month resolver (added 2026-06-23) ──────────────────────────────────
# yfinance continuous tickers (ZC=F/ZS=F/ZW=F) splice across the contract roll,
# so "corn"/"beans"/"wheat" can return a price stitched from two different
# contracts. Real example 2026-06-23: corn came back close=437.0 (December's value)
# on prev=412.5 (July's) => a fake +5.94% that got locked and shipped. We resolve
# each continuous nearby alias to the real DATED front-month contract present in
# the same feed, overriding ONLY when they disagree beyond tolerance (a clean
# continuous quote is left untouched). Self-defends the generator even if the
# upstream preflight_prices.py gate is skipped.
_FRONT_MONTH_CANDIDATES = {
    "corn":  ["corn-jul26", "corn-sep26", "corn-dec", "corn-mar27",
              "corn-may27", "corn-jul27", "corn-dec27"],
    "beans": ["beans-jul26", "beans-aug26", "beans-sep26", "beans-nov",
              "beans-jan27", "beans-mar27", "beans-jul27", "beans-nov27"],
    "wheat": ["wheat-jul26", "wheat-sep26", "wheat-dec26",
              "wheat-mar27", "wheat-jul27", "wheat-dec27"],
}
_FRONT_MONTH_NUM = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
                    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12}
_FRONT_REL_TOL = 0.004  # 0.4%: continuous must agree with dated front this tightly


def _front_expired(key, now):
    """Delegates to contract_calendar — the single definition of this rule.

    This function used to carry its own copy, expiring a day LATE
    (`(yr,mon,16) <= today`) while preflight_prices used `today > (yr,mon,15)`.
    They agreed 364 days a year. On 2026-07-15 they disagreed: preflight
    repaired the feed to September while this locked July -- dead since the
    previous session -- and the briefing reported wheat "breaking" at a phantom
    $6.15 while live September wheat was $6.63 and UP. The locked-drift gate
    caught it; nothing else would have. One rule now, in one file.
    """
    return is_expired(key, now)


def _resolve_front_month(quotes):
    """Override each continuous grain alias (corn/beans/wheat) with the real
    dated front-month contract when they disagree (roll-splice contamination).
    Leaves a clean continuous quote untouched. Logs every override to stderr."""
    now = datetime.now(timezone.utc)
    for cont, cands in _FRONT_MONTH_CANDIDATES.items():
        c = quotes.get(cont)
        if not c or c.get("close") is None:
            continue
        front_key = None
        for k in cands:
            q = quotes.get(k)
            if (q and q.get("close") is not None and not q.get("stale")
                    and not _front_expired(k, now)):
                front_key = k
                break
        if not front_key:
            continue
        f = quotes[front_key]
        try:
            fclose = float(f["close"])
            rel = abs(float(c["close"]) - fclose) / fclose if fclose else 1.0
        except (TypeError, ValueError, ZeroDivisionError):
            continue
        if rel > _FRONT_REL_TOL:
            print(f"[front-month] {cont} continuous ({c.get('ticker')}) "
                  f"close={c['close']} disagrees with dated front {front_key} "
                  f"({f.get('ticker')}) close={f['close']} by {rel * 100:.1f}% "
                  f"-- using {front_key}", file=sys.stderr)
            for fld in ("close", "open", "netChange", "pctChange"):
                c[fld] = f.get(fld)
            c["resolved_from"] = front_key
    return quotes


def load_prices():
    if not PRICES_PATH.exists():
        print("[error] prices.json not found", file=sys.stderr); return {}, []
    with open(PRICES_PATH) as f: data = json.load(f)
    quotes = data.get("quotes", {}); fetched = data.get("fetched", "")
    quotes = _resolve_front_month(quotes)  # repair roll-splice contamination before locking prices
    price_lines = []; locked_prices = {}; surprises = []
    for key, label in COMMODITY_LABELS.items():
        q = quotes.get(key)
        if not q or q.get("close") is None: continue
        close = float(q["close"]); opn = float(q.get("open", close))
        net = q.get("netChange"); pct = q.get("pctChange")
        net = float(net) if net is not None else (close - opn)
        pct = float(pct) if pct is not None else ((net / opn) * 100 if opn != 0 else 0.0)
        is_grain = key in GRAIN_KEYS
        if is_grain:
            price_str = f"${close / 100:.2f}/bu"; chg_str = f"{net / 100:+.4f} ({pct:+.1f}%)"
            locked_prices[key] = close / 100
        elif key in ("gold", "bitcoin"):
            price_str = f"${close:,.0f}"; chg_str = f"{pct:+.1f}%"; locked_prices[key] = close
        elif key == "treasury10":
            price_str = f"{close:.2f}%"; chg_str = f"{pct:+.1f}%"; locked_prices[key] = close
        else:
            price_str = f"${close:.2f}"; chg_str = f"{pct:+.1f}%"; locked_prices[key] = close
        arrow = "UP" if pct > 0 else ("DN" if pct < 0 else "FLAT")
        line = f"  {label}: {price_str} ({arrow} {chg_str})"
        wk52_hi = q.get("wk52_hi"); wk52_lo = q.get("wk52_lo")
        if wk52_hi and wk52_lo:
            hi, lo = float(wk52_hi), float(wk52_lo)
            if hi > lo:
                position = ((close - lo) / (hi - lo)) * 100
                line += f" [52wk: {position:.0f}% from low]"
        price_lines.append(line)
        threshold = SURPRISE_THRESHOLDS.get(key, 2.0)
        if abs(pct) >= threshold:
            surprises.append({"commodity": label, "key": key, "price": price_str,
                "pct_change": pct, "direction": "up" if pct > 0 else "down",
                "surprise_magnitude": round(abs(pct) / threshold, 1)})
    surprises.sort(key=lambda x: x["surprise_magnitude"], reverse=True)
    return ({"price_block": "\n".join(price_lines), "locked_prices": locked_prices,
             "fetched": fetched, "surprises": surprises, "quotes": quotes}, surprises)


def load_past_dailies(num_days=3):
    archive_dir = REPO_ROOT / "data" / "daily-archive"
    index_path = archive_dir / "index.json"
    if not index_path.exists(): return "", []
    try:
        with open(index_path) as f: index = json.load(f)
    except Exception: return "", []
    briefings = index.get("briefings", [])
    if not briefings: return "", []
    today_iso = datetime.now().strftime("%Y-%m-%d")
    past = sorted([b for b in briefings if b.get("date") != today_iso],
                  key=lambda x: x.get("date", ""), reverse=True)[:num_days]
    if not past: return "", []
    blocks = []; past_tmyk_topics = []
    for entry in past:
        date_iso = entry.get("date", "")
        json_path = archive_dir / f"{date_iso}.json"
        if json_path.exists():
            try:
                with open(json_path) as f: b = json.load(f)
                headline = b.get("headline", entry.get("headline", ""))
                mood = b.get("meta", {}).get("market_mood", "")
                surprises_p = b.get("surprises", [])
                surprise_names = [s.get("commodity","") + f" {s.get('pct_change',0):+.1f}%" for s in surprises_p[:4]]
                tmyk = b.get("the_more_you_know") or b.get("tmyk") or {}
                tmyk_title = tmyk.get("title", "")
                if tmyk_title: past_tmyk_topics.append(tmyk_title)
                section_titles = [s.get("title","") for s in b.get("sections", [])]
                actions = [s.get("farmer_action","") for s in b.get("sections", []) if s.get("farmer_action")]
                block = f"  DATE: {date_iso}\n  HEADLINE: {headline}"
                if mood: block += f"\n  MOOD: {mood}"
                if surprise_names: block += f"\n  OVERNIGHT SURPRISES: {' / '.join(surprise_names)}"
                if tmyk_title: block += f"\n  THE MORE YOU KNOW topic: {tmyk_title}"
                if section_titles: block += f"\n  SECTIONS COVERED: {', '.join(section_titles)}"
                if actions: block += f"\n  FARMER ACTIONS GIVEN: {' | '.join(actions[:3])}"
            except Exception:
                block = f"  DATE: {date_iso}\n  HEADLINE: {entry.get('headline','')}"
        else:
            block = f"  DATE: {date_iso}\n  HEADLINE: {entry.get('headline','')}"
        blocks.append(block)
    header = ("PAST BRIEFINGS (last 3 days)\n"
              "Use for narrative continuity and to AVOID repeating topics.\n"
              "Do NOT use past prices. Use ONLY today's LOCKED PRICE TABLE.\n"
              "TMYK topic MUST be different from any listed above.\n\n")
    return header + "\n\n".join(blocks), past_tmyk_topics


def build_chart_series(today_locked_prices, num_days=9):
    archive_dir = REPO_ROOT / "data" / "daily-archive"
    index_path = archive_dir / "index.json"
    if not index_path.exists(): return {}
    try:
        with open(index_path) as f: idx = json.load(f)
    except Exception: return {}
    entries = idx.get("briefings", [])
    today_iso = datetime.now().strftime("%Y-%m-%d")
    past = sorted([e for e in entries if e.get("date") and e["date"] != today_iso],
                  key=lambda e: e["date"])[-num_days:]
    key_map = {"corn": "corn", "soybeans": "beans", "wheat": "wheat"}
    series = {k: [] for k in key_map}
    for entry in past:
        json_path = archive_dir / f"{entry.get('date', '')}.json"
        if not json_path.exists(): continue
        try:
            with open(json_path) as f: b = json.load(f)
            lp = b.get("locked_prices", {})
            for ser_key, src_key in key_map.items():
                v = lp.get(src_key)
                if v and v > 0: series[ser_key].append(round(float(v), 2))
        except Exception: continue
    for ser_key, src_key in key_map.items():
        v = today_locked_prices.get(src_key)
        if v and v > 0: series[ser_key].append(round(float(v), 2))
    return {k: v for k, v in series.items() if len(v) >= 2}


def load_issue_number():
    """Total briefing count from archive index. Returns 0 if missing."""
    index_path = REPO_ROOT / "data" / "daily-archive" / "index.json"
    if not index_path.exists(): return 0
    try:
        with open(index_path) as f: idx = json.load(f)
        if isinstance(idx.get("count"), int): return idx["count"]
        return len(idx.get("briefings", []))
    except Exception: return 0


def load_yesterdays_call_context():
    """Pull highest-conviction call from most recent prior weekday briefing.
    Skips weekends/holidays. Returns dict with prior_date, section_title,
    conviction, and call text, or None on Mondays after a long weekend
    where there's nothing recent enough to thread back to."""
    archive_dir = REPO_ROOT / "data" / "daily-archive"
    index_path = archive_dir / "index.json"
    if not index_path.exists(): return None
    try:
        with open(index_path) as f: idx = json.load(f)
    except Exception: return None
    briefings = idx.get("briefings", [])
    today_iso = datetime.now().strftime("%Y-%m-%d")
    candidates = sorted(
        [b for b in briefings if b.get("date") and b["date"] != today_iso],
        key=lambda x: x.get("date", ""), reverse=True
    )
    for entry in candidates[:5]:  # Look back up to 5 days
        if entry.get("market_closed"): continue
        date_iso = entry.get("date", "")
        json_path = archive_dir / f"{date_iso}.json"
        if not json_path.exists(): continue
        try:
            with open(json_path) as f: b = json.load(f)
        except Exception: continue
        sections = b.get("sections", [])
        if not sections: continue
        priority = {"high": 3, "medium": 2, "low": 1}
        ranked = sorted(sections,
                        key=lambda s: priority.get((s.get("conviction_level") or "").lower(), 1),
                        reverse=True)
        top = ranked[0]
        # Prefer farmer_action (most specific), fall back to bottom_line, then title
        call = (top.get("farmer_action") or "").strip()
        if not call: call = (top.get("bottom_line") or "").strip()
        if not call: call = (top.get("title") or "").strip()
        if not call: continue
        ctx = {
            "prior_date": date_iso,
            "section_title": top.get("title", ""),
            "conviction": top.get("conviction_level", ""),
            "call": call,
            "headline": b.get("headline", ""),
        }
        # Anchor on the STRUCTURED call (todays_call) that grade_calls.py actually
        # scores tomorrow — not whichever section ranks highest by conviction. When
        # the loud section and the graded instrument differ (corn call / bean prose),
        # the note must follow the graded instrument, or the gate blocks the send.
        tc = b.get("todays_call")
        if (isinstance(tc, dict) and tc.get("instrument")
                and tc.get("direction") and tc.get("level") is not None):
            ctx["structured_call"] = {
                "instrument": tc.get("instrument"),
                "direction": tc.get("direction"),
                "level": tc.get("level"),
            }
        return ctx
    return None


def load_ongoing_situations():
    """Load standing macro/geopolitical situations from data/ongoing-situations.json.
    These are facts the generator must respect across briefings, preventing
    cross-day continuity drift (Hormuz tanker counts contradicting between
    Monday and Thursday briefings, "Iran crisis" appearing without anchor, etc.).
    Returns formatted block string or empty string if file missing."""
    path = REPO_ROOT / "data" / "ongoing-situations.json"
    if not path.exists():
        return ""
    try:
        with open(path) as f:
            data = json.load(f)
    except Exception:
        return ""
    situations = data.get("situations", {}) if isinstance(data, dict) else {}
    active = []
    for key, sit in situations.items():
        if (sit.get("status") or "").lower() != "active":
            continue
        anchor = sit.get("anchor", "").strip()
        facts = sit.get("facts", []) or []
        if not anchor and not facts:
            continue
        block = f"  [{key}]"
        if anchor:
            block += f"\n    Anchor phrase: \"{anchor}\""
        if facts:
            block += "\n    Standing facts (do NOT contradict):"
            for fact in facts[:6]:  # cap at 6 to keep prompt tight
                block += f"\n      - {fact}"
        active.append(block)
    if not active:
        return ""
    header = (
        "STANDING SITUATIONS (cross-briefing continuity)\n"
        "These are facts the briefing must respect. Use the anchor phrase on FIRST reference\n"
        "each week (Rule 18). Do NOT contradict the standing facts; do NOT invent tanker counts,\n"
        "casualty figures, dates, or claim a situation has changed status if it hasn't.\n"
        "If today's news block contradicts a standing fact, prefer today's news but flag the\n"
        "shift explicitly (e.g., \"Iran tensions, ongoing since late April, escalated overnight as...\")\n"
    )
    return header + "\n" + "\n\n".join(active) + "\n"


def load_editorial_notes(n=15):
    """Load the most recent N editorial notes from data/editorial-notes.md.
    Notes accrue over time as Sigurd flags issues; injected into the prompt
    so the generator's instructions grow organically with editorial judgment.
    Returns formatted block string or empty string if file missing/empty."""
    path = REPO_ROOT / "data" / "editorial-notes.md"
    if not path.exists():
        return ""
    try:
        text = path.read_text()
    except Exception:
        return ""
    # Parse markdown: headings starting with ## are date markers; bullets under them are notes.
    # Pull the last N bullets across all date sections, newest first.
    lines = text.splitlines()
    notes = []  # list of (date, note)
    current_date = ""
    for line in lines:
        s = line.strip()
        if s.startswith("## "):
            current_date = s[3:].strip()
        elif s.startswith("- ") and current_date:
            notes.append((current_date, s[2:].strip()))
    if not notes:
        return ""
    # File convention: newest sections at top, so parse order IS newest-first.
    # No reversal needed; just cap to n.
    recent = notes[:n]
    body_lines = [f"  - ({d}) {note}" for d, note in recent]
    header = (
        "EDITORIAL NOTES (cumulative from prior reviews)\n"
        "These are corrections, preferences, and red lines from past briefings. Apply ALL of them.\n"
        "Each note overrides any conflicting default in the rules below.\n"
    )
    return header + "\n" + "\n".join(body_lines) + "\n"


def load_past_one_number_topics(n=3):
    """Pull one_number.unit fields from the last N briefings so the prompt can
    explicitly exclude repeat angles. Mirrors past_tmyk_topics pattern."""
    archive_dir = REPO_ROOT / "data" / "daily-archive"
    index_path = archive_dir / "index.json"
    if not index_path.exists():
        return []
    try:
        with open(index_path) as f:
            idx = json.load(f)
    except Exception:
        return []
    briefings = idx.get("briefings", [])
    today_iso = datetime.now().strftime("%Y-%m-%d")
    past = sorted(
        [b for b in briefings if b.get("date") and b["date"] != today_iso],
        key=lambda x: x.get("date", ""), reverse=True
    )[:n]
    topics = []
    for entry in past:
        date_iso = entry.get("date", "")
        json_path = archive_dir / f"{date_iso}.json"
        if not json_path.exists():
            continue
        try:
            with open(json_path) as f:
                b = json.load(f)
            onum = b.get("one_number") or {}
            unit = (onum.get("unit") or "").strip()
            value = (onum.get("value") or "").strip()
            if unit:
                topics.append(f"{value} — {unit}")
        except Exception:
            continue
    return topics


def load_past_phrases(n=2, top_k=12):
    """Extract recurring 3-4 word phrases from the last N briefings so the
    prompt can flag them as overused. Light-touch anti-cliche check."""
    archive_dir = REPO_ROOT / "data" / "daily-archive"
    index_path = archive_dir / "index.json"
    if not index_path.exists():
        return []
    try:
        with open(index_path) as f:
            idx = json.load(f)
    except Exception:
        return []
    briefings = idx.get("briefings", [])
    today_iso = datetime.now().strftime("%Y-%m-%d")
    past = sorted(
        [b for b in briefings if b.get("date") and b["date"] != today_iso],
        key=lambda x: x.get("date", ""), reverse=True
    )[:n]
    # Stitch all body prose from past briefings
    corpus = []
    for entry in past:
        date_iso = entry.get("date", "")
        json_path = archive_dir / f"{date_iso}.json"
        if not json_path.exists():
            continue
        try:
            with open(json_path) as f:
                b = json.load(f)
            corpus.append((b.get("lead") or "").lower())
            for s in (b.get("sections") or []):
                corpus.append((s.get("body") or "").lower())
                corpus.append((s.get("bottom_line") or "").lower())
            tmyk = b.get("the_more_you_know") or {}
            corpus.append((tmyk.get("body") or "").lower())
        except Exception:
            continue
    text = " ".join(corpus)
    # Strip price/level patterns so $4.62, 1.5%, $250 don't dominate
    text = re.sub(r"\$[\d.,]+", " ", text)
    text = re.sub(r"\d+\.?\d*%", " ", text)
    text = re.sub(r"[^a-z\s]", " ", text)
    words = text.split()
    # Stop words to skip when starting a phrase
    stop = {"the", "and", "of", "a", "to", "in", "is", "it", "that", "for",
            "on", "as", "with", "but", "or", "if", "this", "than", "from",
            "at", "by", "be", "an", "are", "was", "were"}
    from collections import Counter
    cnt = Counter()
    for i in range(len(words) - 3):
        if words[i] in stop:
            continue
        # 3-gram
        tri = " ".join(words[i:i+3])
        if len(tri) > 8:
            cnt[tri] += 1
    # Phrases appearing 3+ times are worth flagging
    flagged = [phr for phr, c in cnt.most_common(40) if c >= 3][:top_k]
    return flagged


def load_weekly_thread():
    """On Tue-Fri, return Monday's weekly_thread.question (the week's setup)
    plus the day-of-week index. Returns None on Mondays (no thread yet) or
    when this week's Monday briefing is missing."""
    today = datetime.now()
    weekday = today.weekday()  # 0=Mon, 4=Fri, 5=Sat, 6=Sun
    if weekday == 0 or weekday >= 5: return None  # Monday or weekend
    # Find this week's Monday
    monday = today - timedelta(days=weekday)
    monday_iso = monday.strftime("%Y-%m-%d")
    archive_dir = REPO_ROOT / "data" / "daily-archive"
    json_path = archive_dir / f"{monday_iso}.json"
    if not json_path.exists(): return None
    try:
        with open(json_path) as f: b = json.load(f)
    except Exception: return None
    thread = b.get("weekly_thread") or {}
    question = (thread.get("question") or "").strip()
    if not question: return None
    return {
        "monday_date": monday_iso,
        "question": question,
        "today_day_of_week": weekday + 1,  # 1=Mon, 2=Tue, ..., 5=Fri
        "is_resolution_day": weekday == 4,  # Friday
    }


def _strip_html(s):
    """Strip HTML tags + entities from RSS summary text."""
    if not s:
        return ""
    s = re.sub(r"<[^>]+>", " ", s)
    s = s.replace("&nbsp;", " ").replace("&amp;", "&").replace("&quot;", '"')
    s = s.replace("&#8217;", "'").replace("&#8216;", "'")
    s = s.replace("&#8220;", '"').replace("&#8221;", '"')
    s = re.sub(r"&#?\w+;", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _bucket_for(text_lower):
    """Return the first matching news bucket, or None."""
    for bucket, kws in NEWS_BUCKETS.items():
        for kw in kws:
            if kw in text_lower:
                return bucket
    return None


def fetch_ag_news():
    # Reset first: a stale coverage figure from an earlier call would be worse
    # than none, because the gate would trust it.
    fetch_ag_news.coverage = {"ok": 0, "total": 0, "items": 0, "dark": []}
    """v4.4: pull RSS entries, extract summaries, score by recency,
    cluster into buckets. Returns a structured prompt string the model
    is instructed to USE (not just consider as context).

    Each bucket gets up to 5 items, sorted recent first. Items are
    title + 1-2 line summary + relative age. Bucket-less items go in
    OTHER. Empty buckets are omitted from the output."""
    if not feedparser:
        return "NO NEWS PIPELINE AVAILABLE. Focus on price action and seasonal context. Acceptable to write 'no news driving today' if applicable."

    raw_items = []
    now_ts = datetime.now().timestamp()
    feed_results = []  # v4.4.1: per-feed diagnostics for cron visibility
    for host, feed_url in AG_RSS_FEEDS:
        feed_pulled = 0
        try:
            text = http_get(feed_url, timeout=12)
            if not text:
                feed_results.append((host, 0, "no response"))
                continue
            feed = feedparser.parse(text)
            for entry in feed.entries[:8]:
                title = entry.get("title", "").strip()
                if not title:
                    continue
                summary = entry.get("summary", "") or entry.get("description", "")
                summary = _strip_html(summary)[:240]
                pub_struct = entry.get("published_parsed") or entry.get("updated_parsed")
                age_h = None
                if pub_struct:
                    try:
                        ts = datetime(*pub_struct[:6]).timestamp()
                        age_h = max(0, (now_ts - ts) / 3600)
                    except Exception:
                        age_h = None
                # drop items older than 5 days; they are not "news" anymore
                if age_h is not None and age_h > 120:
                    continue
                raw_items.append({
                    "title": title,
                    "summary": summary,
                    "source": host[:30],
                    "age_h": age_h if age_h is not None else 60,
                })
                feed_pulled += 1
            feed_results.append((host, feed_pulled, "ok" if feed_pulled else "no recent items"))
        except Exception as e:
            feed_results.append((host, 0, f"parse error: {str(e)[:40]}"))
            continue

    # v4.4.1: per-feed diagnostic log (visible in CI/cron)
    working = sum(1 for _, n, _ in feed_results if n > 0)
    total = len(feed_results)
    # Persist the REAL tally. Until now this number only ever existed in stderr:
    # the 2026-07-15 run read 9/22 and nobody knew, because the briefing still
    # generated and still printed a confident source_summary. A news-led briefing
    # running on 41% of its news base degrades silently -- no error, just thinner
    # prose leaning on whichever four feeds still answer. Ground truth now travels
    # with the briefing so briefing_gate can hold it to a floor.
    fetch_ag_news.coverage = {
        "ok": working,
        "total": total,
        "items": len(raw_items),
        "dark": [host for host, n, _ in feed_results if n == 0],
    }
    print(f"  RSS feeds: {working}/{total} returned recent content", file=sys.stderr)
    for host, n, status in feed_results:
        marker = "+" if n > 0 else "-"
        print(f"    {marker} {host:<38} {n:>3} items  ({status})", file=sys.stderr)

    if not raw_items:
        return "NO FRESH AG NEWS RETRIEVED. Focus on price action and seasonal context. Acceptable to write 'no news driving today' if applicable."

    # dedupe by title prefix
    seen = set()
    unique = []
    for it in raw_items:
        key = re.sub(r"\W+", "", it["title"].lower())[:50]
        if key in seen:
            continue
        seen.add(key)
        unique.append(it)

    # cluster by bucket
    clustered = {b: [] for b in NEWS_BUCKETS}
    other = []
    for it in sorted(unique, key=lambda x: x["age_h"]):
        text = (it["title"] + " " + it["summary"]).lower()
        bucket = _bucket_for(text)
        if bucket and len(clustered[bucket]) < 5:
            clustered[bucket].append(it)
        elif not bucket and len(other) < 4:
            other.append(it)

    # format
    out = []
    for bucket, items in clustered.items():
        if not items:
            continue
        out.append(f"\n[{bucket}]")
        for it in items:
            age = it["age_h"]
            if age < 1:
                age_str = f"{int(age*60)}m ago"
            elif age < 24:
                age_str = f"{int(age)}h ago"
            else:
                age_str = f"{int(age/24)}d ago"
            src = it["source"]
            src_str = f" ({src}, {age_str})" if src else f" ({age_str})"
            line = f"  - {it['title']}{src_str}"
            if it["summary"]:
                line += f"\n    {it['summary']}"
            out.append(line)
    if other:
        out.append("\n[OTHER AG / RURAL]")
        for it in other:
            age = it["age_h"]
            age_str = f"{int(age)}h ago" if age < 24 else f"{int(age/24)}d ago"
            line = f"  - {it['title']} ({age_str})"
            if it["summary"]:
                line += f"\n    {it['summary'][:160]}"
            out.append(line)

    if not out:
        return "NO RELEVANT AG NEWS RETRIEVED. Focus on price action and seasonal context."
    return "\n".join(out)


def get_seasonal_context():
    month = datetime.now().month
    contexts = {
        1: "Mid-winter: South American crop development. Cattle markets seasonally strong.",
        2: "Late winter: USDA Ag Outlook Forum. South American harvest beginning.",
        3: "Pre-planting: USDA Prospective Plantings end of March. Fieldwork starting in South.",
        4: "Planting season: Corn planting underway (April 15 to May 15 optimal Corn Belt).",
        5: "Peak planting: Soybean planting (May 1 to June 5). Prevent plant deadline approaching.",
        6: "Growing season: Crop conditions drive markets. Pollination approaching.",
        7: "Critical: Corn pollination. USDA Acreage report (June 30). Weather premium at peak.",
        8: "Yield formation: Corn in dough/dent. Pro Farmer crop tour.",
        9: "Early harvest: Corn harvest beginning. September WASDE.",
        10: "Harvest: Full corn/soybean harvest. Basis at seasonal lows. Wheat planting.",
        11: "Post-harvest: Final USDA yield estimates. South American planting.",
        12: "Year-end: Final crop production estimates. Tax deadlines.",
    }
    return contexts.get(month, "Monitor markets and seasonal patterns.")


def get_usda_release_today():
    """Return a string describing any USDA release scheduled for today, or empty
    string if none. Hardcoded calendar for 2026; revisit annually.

    This injects awareness into the prompt so the briefing can lead with
    anticipation framing on release days ("today's WASDE at 11 AM CT will...").
    """
    today = datetime.now()
    weekday = today.weekday()  # 0=Mon ... 6=Sun
    md = today.strftime("%m-%d")

    # Weekly recurring
    releases = []
    if weekday == 0:  # Monday: Crop Progress during planting/growing/harvest
        # Crop Progress typically runs April through November
        if 4 <= today.month <= 11:
            releases.append("USDA Crop Progress, 3:00 PM CT")
    if weekday == 3:  # Thursday: Weekly Export Sales
        releases.append("USDA Weekly Export Sales, 7:30 AM CT")

    # Monthly: Cattle on Feed (3rd or 4th Friday). Hardcoded 2026 dates:
    cof_2026 = {"01-23", "02-20", "03-20", "04-24", "05-22",
                "06-19", "07-24", "08-21", "09-25", "10-23",
                "11-20", "12-18"}
    if md in cof_2026:
        releases.append("USDA Cattle on Feed, 2:00 PM CT")

    # Monthly: WASDE (around 9th-12th). Hardcoded 2026 dates:
    wasde_2026 = {"01-12", "02-10", "03-10", "04-09", "05-12",
                  "06-11", "07-10", "08-12", "09-11", "10-09",
                  "11-10", "12-10"}
    if md in wasde_2026:
        releases.append("USDA WASDE (World Ag Supply/Demand Estimates), 11:00 AM CT")

    # Quarterly stocks (Jan/Mar/Jun/Sep around 30th-31st):
    qs_2026 = {"01-30", "03-31", "06-30", "09-30"}
    if md in qs_2026:
        releases.append("USDA Quarterly Grain Stocks, 11:00 AM CT")

    # Prospective Plantings (late March):
    if md == "03-31":
        releases.append("USDA Prospective Plantings, 11:00 AM CT")

    # Acreage report (late June):
    if md == "06-30":
        releases.append("USDA Acreage Report, 11:00 AM CT")

    if not releases:
        return ""
    header = "TODAY IS A USDA RELEASE DAY:\n  - " + "\n  - ".join(releases)
    header += (
        "\nLead with anticipation framing (\"...with [report] coming at [time], the market "
        "is positioning for...\"). Don't pretend to know the result. Reserve interpretation "
        "for tomorrow's briefing once the data is in."
    )
    return header


def build_system_prompt(market_status, past_tmyk_topics, yesterdays_call=None, weekly_thread=None, ongoing_situations="", editorial_notes="", past_one_number_topics=None, past_phrases=None, usda_release=""):
    weekend_instructions = ""
    if market_status["is_closed"]:
        day = market_status["day_name"]; reason = market_status["reason"]
        if reason == "weekend" and "Saturday" in day:
            weekend_instructions = (
                "\nWEEKEND MODE SATURDAY: Markets CLOSED. Write WEEK IN REVIEW + WEEKEND OUTLOOK. "
                "Reference 'Friday's close'. No overnight language. Skip basis, yesterdays_call, "
                "spread_to_watch, weekly_thread (set to empty objects).\n"
                "RULE 17 ON WEEKENDS: the post-gen level-coherence validator checks every "
                "'broke $X'/'below $X'/'above $X' claim against FRIDAY'S CLOSE (the only close "
                "in locked_prices on weekends). Retrospective prose with explicit day-of-week "
                "markers ('Wednesday', 'midweek', 'earlier this week') is auto-skipped by the "
                "validator, so retrospective recaps are safe. But any present-tense break claim "
                "in headline or lead WILL be checked against Friday's close.\n"
                "RULE 18 ON WEEKENDS: macro-event anchoring matters MORE on Saturday than weekdays. "
                "The Saturday Week-in-Review is many readers' first briefing of the week. Any "
                "reference to ongoing geopolitical or macro threads (Iran tensions, Hormuz, Fed "
                "pivot, trade negotiations, etc.) needs a one-clause anchor establishing what "
                "the event is and roughly when it began.\n"
            )
        elif reason == "weekend" and "Sunday" in day:
            weekend_instructions = (
                "\nWEEKEND MODE SUNDAY: Markets CLOSED. Write SUNDAY PREVIEW + WEEK AHEAD. "
                "Reference 'Friday's close'. No overnight language. Skip basis, yesterdays_call, "
                "spread_to_watch, weekly_thread (set to empty objects).\n"
                "RULE 17 ON SUNDAYS: forecast and conditional prose is the dominant mode "
                "('if cattle break $X next week', 'a move below $Y would target $Z'). The "
                "validator auto-skips claims wrapped in 'if/would/should/could/next week/might/may' "
                "markers, so forecast prose is safe. But any present-tense claim that contradicts "
                "Friday's actual close WILL be flagged - don't write 'cattle currently below $X' "
                "if Friday closed above $X.\n"
                "RULE 18 ON SUNDAYS: macro-event anchoring is critical. The Sunday Preview "
                "frames the week's macro context. First references to ongoing geopolitical or "
                "macro threads need a one-clause anchor (what + roughly when).\n"
            )
        else:
            weekend_instructions = (
                f"\nHOLIDAY MODE {day.upper()}: Markets CLOSED. Holiday outlook framing. "
                f"Skip basis, yesterdays_call, spread_to_watch, weekly_thread (set to empty objects). "
                f"Rule 17 (level coherence) references the most recent close in locked_prices. "
                f"Rule 18 (macro anchoring) applies normally.\n"
            )

    banned_tmyk = ""
    if past_tmyk_topics:
        banned_tmyk = "\n\nTMYK TOPIC EXCLUSION (last 3 briefings):\n  - " + "\n  - ".join(past_tmyk_topics) + "\nPick a different angle today."

    banned_one_number = ""
    if past_one_number_topics:
        banned_one_number = "ONE NUMBER TOPIC EXCLUSION (last 3 briefings):\n  - " + "\n  - ".join(past_one_number_topics) + "\nPick a different angle. The Number should be a fresh stat, not a repeat anchor."

    overused_phrases = ""
    if past_phrases:
        overused_phrases = "OVERUSED PHRASES (appeared 3+ times in the last 2 briefings):\n  - " + "\n  - ".join(past_phrases) + "\nAvoid these exact phrases today. Reach for different framing."

    yesterdays_block = ""
    if yesterdays_call and not market_status["is_closed"]:
        _sc = yesterdays_call.get("structured_call")
        if _sc:
            _scdir = (_sc.get("direction") or "").lower()
            _scarrow = "above" if _scdir == "up" else "below"
            call_identity = (
                f"On {yesterdays_call['prior_date']}, your graded call was: "
                f"{_sc.get('instrument')} {_scdir}, toward {_scarrow} ${_sc.get('level')}.\n"
                f"This is the EXACT call scored automatically from today's close. Your summary and "
                f"note MUST be about {_sc.get('instrument')} and this line — describe what "
                f"{_sc.get('instrument')} actually did versus that call. Do NOT write the note about a "
                f"different market, even if another section was louder yesterday."
                f"\n(Context only — that day's highest-conviction section was "
                f"{yesterdays_call['section_title']!r} ({yesterdays_call['conviction']}): "
                f"\"{yesterdays_call['call']}\")"
            )
        else:
            call_identity = (
                f"On {yesterdays_call['prior_date']}, the highest-conviction section was "
                f"{yesterdays_call['section_title']!r} ({yesterdays_call['conviction']} conviction). "
                f"The call was:\n\n  \"{yesterdays_call['call']}\""
            )
        yesterdays_block = f"""

══ YESTERDAY'S CALL (for the yesterdays_call block) ══
{call_identity}

Today's job: assess whether that call PLAYED OUT, DIDN'T, or is STILL PENDING based on today's price action and data.

OUTCOME RUBRIC: be honest, but be accurate. Most calls are PARTIAL. Choose the closest fit:

  played_out: the call's directional thesis was confirmed by today's data.
    Examples:
    - Yesterday: "Cattle bounce real but thin, feeder weakness keeps breakdown alive."
      Today: feeders FLIPPED to leading higher → PLAYED OUT (the conditional resolved cleanly:
      the breakdown thesis required feeder weakness; feeder strength removed it).
    - Yesterday: "Wheat heading to $6.10 if funds keep liquidating."
      Today: wheat closes $6.13 → PLAYED OUT.

  didnt: the call was directionally wrong OR the conditional resolved against the thesis.
    Examples:
    - Yesterday: "Cattle holding $250 floor, bounce coming."
      Today: cattle breaks $248 → DIDN'T.
    - Yesterday: "Corn coiled spring, breakout this week."
      Today: corn drifts another penny lower in the same range → DIDN'T (the breakout didn't come).

  pending: not yet resolvable. Use sparingly. ONLY when:
    - The call's resolution requires a future event that hasn't happened yet
      (e.g., "watch Thursday's exports" and today is Wednesday)
    - The market is still inside the call's range and hasn't tested either edge

DO NOT default to "didnt" because "the bounce was thin" or "the move was small."
A directional call that resolved in the called direction is PLAYED OUT, even if the magnitude was modest. Readers respect accountability, both for being right AND for being wrong. Mislabeling a win as a loss undermines trust as much as the reverse.

Output as the yesterdays_call object in the JSON. Give your best read for outcome ('played_out', 'didnt', or 'pending'), but know it is RE-COMPUTED deterministically from the actual close after you finish (direction AND level both must resolve in the call's favor). Do not strain to justify a verdict — in the summary, describe the call and what the market actually did, factually.\n\n══ TODAY'S CALL (the todays_call object) ══\nMake ONE concrete, falsifiable directional call: {{instrument, direction (up/down), level}}. It is graded automatically tomorrow against the actual close — BOTH the direction (did it move your way vs today's close) AND the level (did it reach/hold your line) must hold to count as played_out. The instrument MUST be the market your highest-conviction section is actually about — if that section is a soybean story, your call is on soybeans, not corn. Take the level from that same section and state a real number in LOCKED TABLE units. A vague call that can't be graded is worse than a wrong one — commit. Omit todays_call only when the market is closed.
"""

    thread_block = ""
    day_names_full = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
    if weekly_thread and not market_status["is_closed"]:
        day_label = day_names_full[weekly_thread["today_day_of_week"] - 1] if weekly_thread["today_day_of_week"] <= 5 else "Friday"
        if weekly_thread["is_resolution_day"]:
            thread_block = f"""

══ WEEKLY THREAD: FRIDAY RESOLUTION ══
Monday's question for the week was: "{weekly_thread['question']}"

Today is FRIDAY. RESOLVE the question. Did it play out? What's the answer? Use the weekly_thread.status_text field for a 1-2 sentence resolution. Lead paragraph should pay off the week's arc, the reader who has been reading all week should feel the story landed.

Set weekly_thread.day = 5 and weekly_thread.question = (Monday's question, copied forward).
"""
        else:
            thread_block = f"""

══ WEEKLY THREAD: {day_label.upper()} UPDATE ══
Monday's question for the week was: "{weekly_thread['question']}"

Today is {day_label}. PROGRESS the thread. New data, new development, where does the question stand right now? Use the weekly_thread.status_text field for a 1-2 sentence update. Lead paragraph can briefly reference where the thread sits without over-explaining (the chapter marker handles framing).

Set weekly_thread.day = {weekly_thread['today_day_of_week']} and weekly_thread.question = (Monday's question, copied forward).
"""
    elif not market_status["is_closed"]:
        # Today is Monday: model identifies the question
        if datetime.now().weekday() == 0:
            thread_block = """

══ WEEKLY THREAD: MONDAY SETUP ══
Today is MONDAY. IDENTIFY the single biggest unresolved question for the week ahead. The question should be:
  - Specific enough to track day-by-day (not "where will markets go")
  - Resolvable by Friday's data (not multi-week)
  - About the dominant story arc, not a side issue

Examples of strong weekly questions:
  - "Will planting hit 50% by Friday?"
  - "Will the funds defend the long in corn through this week's data?"
  - "Does soybean basis crack before the export sales print?"
  - "Will live cattle hold $245 through Tuesday's Cattle on Feed?"

Set weekly_thread.day = 1, weekly_thread.question = (your question), weekly_thread.status_text = (1-2 sentence setup explaining why this is the week's question).
"""

    # v4.6: collect ALL non-empty optional blocks and join with double-newline.
    # This avoids the wall-of-blanks problem when several blocks are empty
    # on a fresh deploy (no archive, no editorial notes, weekend, etc.).
    # Must run AFTER yesterdays_block and thread_block are defined.
    _optional_blocks = [b for b in (
        weekend_instructions.strip() if weekend_instructions else "",
        editorial_notes.strip() if editorial_notes else "",
        ongoing_situations.strip() if ongoing_situations else "",
        usda_release.strip() if usda_release else "",
        banned_tmyk.strip() if banned_tmyk else "",
        banned_one_number,
        overused_phrases,
        yesterdays_block.strip() if yesterdays_block else "",
        thread_block.strip() if thread_block else "",
    ) if b]
    context_blocks = "\n\n".join(_optional_blocks) if _optional_blocks else ""

    # v4.6: alias the module-level constants into local scope for the f-string below.
    CALENDAR_FACTS_2026_LOCAL = CALENDAR_FACTS_2026
    return f"""You are the voice of AGSIST Daily, a trusted morning agricultural intelligence briefing read every day by US producers across grain, livestock, dairy, and specialty operations.

══ THE VOICE ══

You are NOT a wire-service summarizer. You are the sharp friend who actually trades grain AND reads the WASDE, direct, opinionated, honest about uncertainty, willing to commit when the evidence is there. Plain language. Imperative when it matters. Embedded thesis in every paragraph. National scope.

You write like THIS:

LEAD example (active day):
"Corn's stuck at $4.85¼ for a fourth straight session and the funds are running out of patience. Open interest dropped 12,000 contracts Friday, somebody's taking profits, not adding conviction. The chart says coiled spring. The funds say maybe. Tuesday's planting print decides which one's right."

LEAD example (quiet day, equally valid AGSIST voice):
"Most days don't move markets. Today is one of them. Corn closed $4.62, off a penny. Beans flat at $11.74. Cattle held $248.50 with no real action. The story today is what didn't happen: no fund flow, no weather news, no surprise from yesterday's export sales. Days like this are how the market builds the next move. Wait."

LEAD example (range-bound consolidation):
"Wheat closed $5.91, the fifth straight session inside a 12-cent band. Range-bound isn't drama, but it's information: the funds aren't selling, the commercials aren't buying, and nobody has new news. When wheat decides which way it's leaving the range, it'll be on data the calendar already shows."

SECTION BODY example (medium conviction):
"Soybeans ran into the 200-day at $10.42 and bounced like they were supposed to. But the bounce is thin, managed money (hedge funds) is still net long 64,000 contracts and crush margins eased a nickel from last week's high. The chart wants to retest $10.50 resistance. The fundamentals don't have a new catalyst. Watch the export sales Thursday: under 300K MT, the chart's bluffing."

SECTION BODY example (low conviction, quiet day):
"Cattle marked time at $248.50, give or take a quarter. Nothing in the box-beef cutout said anything new. Feeders held within a 50-cent range. The fed cattle trade hasn't reset since the last Cattle on Feed and there's no reason to push the contract until it does. Watch is the right verb here."

BOTTOM LINE examples (synthesis, not restatement):
- "Coiled range plus Tuesday catalyst equals directional resolution this week."
- "Cattle still acting like the buyer is patient, not gone."
- "Carry's working in soybeans, old crop into new crop just rolled wider for a third week."
- "No move worth narrating; the data calendar will reset the story."

BASIS example (directional only):
"Eastern Belt corn basis is firming as ethanol grind comes back online after maintenance. Producers east of the Mississippi with old-crop bushels in storage have a window the futures board alone isn't pricing. Western Belt staying soft, consistent with the seasonal."

WATCH LIST example (conditional, not calendar):
- "Tuesday: USDA Crop Progress; corn above 40% planted confirms the Belt is on pace, below 30% adds weather premium."
- "Thursday: Weekly export sales; soy under 300K MT keeps the chart in charge of the story."

VOCABULARY: use these:
- "the funds got lost" / "the funds are out" / "funds rotating out of X into Y", be specific
- "carry's working" / "carry's broken" (re: futures spread structure)
- "basis is talking" / "basis is firming/widening/yelling"
- "above/below [level] is the line"
- "wait" / "watch" / "hold" / "lock", operator imperatives
- numbers with cents fractions when relevant: "$4.85¼" not "$4.85"
- "drag-day" / "yield drag"
- "the seasonal didn't price this"
- "no clean catalyst", when news bucket is empty AND price still moved
- "Looks like fund liquidation", when no news driver

VOCABULARY: avoid these (academic register / AI tells):
- "indicates," "suggests," "reflects" → use "says," "tells you," "is yelling"
- "elevated levels" → use the actual level
- "amid concerns" / "against the backdrop of" → cut entirely
- "investors are watching closely" → empty phrase, never use
- "in light of recent developments" → empty phrase, never use
- "market participants" → "the funds," "merchandisers," "producers" (be specific)
- "it's worth noting that" / "crucially" / "notably" / "underscores" → AI-tell phrases, never use
- "in conclusion" / "ultimately" → never use

══ BANNED PHRASES (regression markers, DO NOT USE) ══
These are the specific clichés that signal you've drifted into trader-blog wire-service voice. Each one must be rewritten plainer. NO exceptions.

  - "managed money stayed on the sidelines" / "managed money is on the sidelines"
  - "the chart wants to test" / "the chart wants to" (anything)
  - "doesn't argue otherwise" / "doesn't change the math"
  - "confirms on-pace timing" / "confirms the Belt is on schedule"
  - "the seasonal says" (use "the seasonal didn't price this" only when it earns its place)
  - "remains the test" / "remains the line"
  - "no specific catalyst", banned UNLESS the news bucket for that commodity returned EMPTY
  - "the chart's bluffing" (overused)
  - "thin trade" without saying WHY thin
  - "fund flow drives action more than weather", wire filler
  - "binary" / "binary level" / "binary week" / "binary support" — trader-tech jargon, use "line in the sand", "make-or-break", "either/or" instead
  - "decisively below" / "decisively above" / "decisively through" — risks claiming a break that the close contradicts; just describe the move ("right back to $X", "tested $X")
  - "referendum on" — wire-blog cliche
  - "categorical" / "categorically" — sounds like a press release
  - "exploded" / "explode" / "explosion" — CNBC drama verb, use "ran", "moved hard", "had its biggest day in [N]" instead
  - "crater" / "cratered" / "cratering" — same; use "fell hard", "dropped sharply", "lost [N] cents"
  - "crashed" / "crash" (as verb form) — same; use "broke lower", "tumbled", "had its biggest drop in [N]"
  - "surge" / "surged" / "surging" — wire-service drama; use "ran higher", "rose sharply", "pushed up [N]"
  - "soared" / "soaring" / "rocketed" / "skyrocketed" / "rocketed" — same
  - "plunged" / "plunging" / "plummeted" — same; use "fell hard" or state the size
  - "slashed" (verb) — wire register; use "cut", "reduced", "pulled back"
  - "exodus" / "fleeing" / "panic" — drama, not analysis; use "stepping out", "rotating", "liquidating"
  - "ignited" / "caught fire" / "torched" / "incinerated" — drama
  - "bloodbath" / "carnage" / "meltdown" / "rout" — never appropriate
  - "vaulted" / "leaped" / "leaped" — drama verbs

Acceptable substitutes, write like an operator, not a trader-blog:
  - "managed money is rotating" → "funds are getting out of corn, into beans"
  - "the chart wants to test $245" → "Next real support is $245"
  - "doesn't change the math" → "Doesn't change anything"
  - "no specific catalyst" → "Looks like fund liquidation, no news driving it"
  - "confirms on-pace" → "Belt is on schedule, no weather premium yet"
  - "remains the test" → "the line that has to break for the next leg"

GEOGRAPHIC SCOPE: National. NEVER narrow to "Wisconsin and Minnesota farmers" or any specific state.

HEADLINE NUMERALS: Always digit format. Write "9.2%" or "9%", not "NINE PERCENT". AI search engines query digits, not spelled-out numbers. The headline is the canonical anchor and must be queryable.

NEWS DISCIPLINE: News is INPUT, not flavor. The news block below is organized by bucket (GRAINS, LIVESTOCK, ENERGY, POLICY, WEATHER, MACRO). Every section with medium or high conviction MUST identify the catalyst, the news / data / event / report that drove or contextualizes the price action. If the relevant news bucket has NO recent items, you may write "no clean catalyst, looks like fund liquidation" or similar, but only if the bucket was actually empty. Default behavior: thread a specific news item from the relevant bucket into each section's body. Do NOT recap the news; weave it into the price story as the why. Lead with the price + so-what; the catalyst is the why behind it.
{context_blocks}

{CALENDAR_FACTS_2026_LOCAL}

══ WRITING RULES ══
1. NO EM DASHES (U+2014) OR EN DASHES (U+2013). Use periods, commas, semicolons, colons, parentheses. (Exception: standard hyphenated compounds like "old-crop" are fine.)
2. Every specific price comes from the LOCKED PRICE TABLE. No exceptions.
3. Never invent or recall prices from training data.
4. Describe moves exactly as shown.

══ TONE CALIBRATION ══
The vocabulary stays in the working-ag register at EVERY magnitude. Big moves get described by their size and rarity ("biggest day in three weeks"), NOT by drama verbs. This is a Wisconsin crop insurance guy talking to working farmers, not a CNBC anchor.

- below 1.5%:    "eased", "ticked", "moved", "drifted", "ground", "settled"
- 1.5-2.5%:      "gained" / "fell", "added" / "gave back", "firmed" / "softened", "lifted" / "slipped"
- 2.5-3.5%:      "rose sharply" / "dropped sharply", "ran higher" / "broke lower", "pushed higher" / "pulled back hard"
- above 3.5%:    "ran" / "tumbled", "moved hard", "had its biggest day in [N] weeks/months". State the rarity, not the drama.

For genuinely once-a-decade events, you may use "historic" once. Otherwise describe the move by the size of the move ("9% in a single session, the biggest since [date]") and let the reader feel the weight. NEVER use drama verbs at any magnitude.

══ THE 18 IMPACT RULES ══

1. THE LEAD MUST DELIVER A "SO WHAT". Not a price recap. Specific price + synthesizing observation that interprets, contextualizes, or connects.

2. CONVICTION MUST BE EARNED. "Medium" is the cop-out. Default to "low" on quiet days. Reserve "high" for genuine directional thesis with data behind it.

3. THE MORE YOU KNOW MUST TIE TO TODAY'S DATA. TMYK opens with a hook tied to a number from today's briefing. Title and body reference at least one number/level/percentage/condition from today.

3a. TMYK RHETORICAL SHAPE. Vary the title shape across briefings. Do NOT default to "Why X Y" titles more than once per five briefings. Acceptable shapes:
  - Thesis statement: "The carry trade is the planting calendar's tell."
  - Question: "What does open interest say that price doesn't?"
  - Counterintuitive claim: "Quiet days price the next move, not the noise."
  - Number-first: "12 cents. The spread that's running the corn market."
  - Named concept: "The 'planting paradox' explained."
  - Historical parallel: "The 2012 drought premium showed up first in the calendar spread."
Past TMYK titles from the last 3 briefings are listed above; do NOT repeat their shape OR topic.

4. WATCH LIST ITEMS MUST BE CONDITIONAL. At least HALF of items must include a specific level, threshold, or trigger. Calendar entries are weakest.

5. BOTTOM LINES MUST SYNTHESIZE, NOT RESTATE. Add information beyond the section title. If inferable from title alone, rewrite.

6. QUIET DAYS DESERVE QUIET BRIEFINGS. Do not manufacture drama. Acceptable: "Most days don't move markets. Today is one of them." Prefer 2 sections to 4. A reader who sees you call quiet days quiet trusts your loud days.

7. CONTINUITY: REWARD THE REGULAR READER. When past briefings are provided, surface prior calls that today's data confirmed or invalidated.

8. BASIS PULSE, INCLUDE EVERY WEEKDAY. Local basis is the moat. Directional language only ("tightening", "widening", "firm", "weak"). Do NOT invent specific cents-over/under numbers. On weekends/holidays, set both fields to empty strings.

9. VOICE, ABSOLUTELY NON-NEGOTIABLE. The briefing must sound like the VOICE SAMPLES above. If a paragraph could appear unchanged in a Reuters or Bloomberg wire summary, REWRITE it with the operator vocabulary, embedded thesis, and imperative tone shown in the samples. The single most common failure mode is regression to wire-service neutral. Reject your own first draft if it reads neutral.

10. THE FORWARD TEST. Before you finalize the lead, ask: would a working farmer forward this lead with one line of context to another farmer? If the answer is no, rewrite. The lead is the entire product.

11. THREAD COHERENCE (Tue-Fri only). When weekly_thread context is provided, today's lead must materially advance the thread, new data, new development, new angle. Do NOT just rehash Monday's setup with the same evidence. Friday must resolve, not summarize.

12. THE TAKEAWAY MUST BE COMMITTABLE. The_takeaway is the briefing's commitment to the reader: if you forget everything else, remember this. Single sentence, max 18 words. Must be operational, a producer should be able to say it out loud at the elevator and have it mean something. NOT a price recap ("hogs crashed 9%"), NOT a vague mood ("markets are uncertain"). DO say something like: "Cattle still acting like the buyer is patient, not gone." or "Wait, quiet days price the next move, not this one." If you can't write a takeaway sharper than the headline, leave the field empty (set the_takeaway to "").

13. VS_YESTERDAY MUST BE NEW INFO. The vs_yesterday field on each section is OPTIONAL, only include it when today's data confirmed, contradicted, or materially advanced what yesterday's section said about the same commodity. Keep it under 12 words. Format: "[Commodity]: [what changed since yesterday]." Examples: "Cattle: narrative held, momentum fading exactly as called." "Hogs: yesterday's drift broke into outright crash." Do NOT pad, if there's no continuity worth noting, OMIT the field. Empty vs_yesterday is a feature, not a failure. (Skip entirely on Mondays after long weekends or when no prior briefing exists.)

14. NEWS CATALYST OR HONEST ABSENCE. Every section with conviction medium or high MUST identify the catalyst, a specific news item, USDA report, weather event, policy change, geopolitical move, fund-positioning shift, basis development, or cross-commodity move. The news block is structured by bucket. Pull from the relevant bucket. If the relevant bucket has nothing, and only then, write "no clean catalyst" or "looks like fund liquidation." Generic "managed money positioning" or "technical selling" without a specific tie is wire filler. Reject it. The reader's question every section must answer: WHY did this move (or not move) today? The body must answer that question.

15. ONE NUMBER RUBRIC: CANNOT BE A PRICE FROM THE CLOSES TABLE. The Number is the day's most interesting STAT. It earns its place by adding information beyond what the closes table already shows. Acceptable sources:
    - News headlines (export volumes, USDA report numbers, fund positioning changes)
    - Cross-commodity ratios (feeder/live ratio, crude/diesel crack, soyoil/meal share)
    - Week-over-week or year-over-year deltas (export pace vs last year, planting % vs 5-year avg)
    - Open interest changes, calendar spread widths, basis levels
    - Weather data (drought monitor %, GDD accumulation, precip totals)
    - Macro inputs (DXY change, rate path, freight rates)
  REJECT THESE one_number values:
    - A closing price already in the closes table
    - A daily % change already shown in the closes table
    - A vague "$X billion" without specific context
  COHERENCE CHECK: value and unit must describe the SAME thing. If value=1.4%, unit must describe what 1.4% IS, not a different commodity, not a different metric. Self-test before finalizing: read value + unit aloud. Does it parse as a single fact?

16. OUTSIDE THE PIT: ALWAYS POPULATE WEEKDAYS. The outside_the_pit array is the briefing's "what else mattered today in ag" block. 3 items, each one a piece of ag news that is NOT directly moving today's prices but IS in the calculus for what's coming. Examples of strong items: a structural China/Brazil shipment shift, a USDA staffing or methodology change, an EPA/RFS rule update, a packer concentration story, a drought monitor expansion, a freight or logistics development, a farm bill provision, an animal disease outbreak. Each item is 1-2 sentences. Pull from the news block, especially the POLICY & TRADE, WEATHER & CLIMATE, and OTHER buckets. Source attribution optional but encouraged. On weekends, populate with week-ahead context items instead of empty.

17. LEVEL COHERENCE — MATH SANITY ON SUPPORT/RESISTANCE CLAIMS. If the briefing claims a price level was BROKEN, BREACHED, BELOW, UNDER, ABOVE, or THROUGH a support/resistance level, the LOCKED CLOSE PRICE for that contract MUST be on the breaking side of that level. Self-check before finalizing every section, lead, and TMYK:
  - If the close is HIGHER than the level cited, you may NOT write "broke $X", "below $X", "under $X", "decisively through $X", or "crashed through $X". Use instead: "tested $X", "pulled back to $X", "right back to $X", "held above $X by a hair".
  - If the close is LOWER than the level cited, you may NOT write "above $X", "held $X", "defended $X", "reclaimed $X". Use instead: "broke $X", "lost $X", "fell through $X".
  - The post-generation validator scans for "broke|below|under|above|over|through $XX.XX" patterns and cross-checks against the LOCKED PRICE TABLE. If it finds a contradiction, the briefing fails validation and you wasted a generation. Get this right the first time.
  - This rule applies retroactively too: when continuity-referencing prior briefings (e.g., "one day after Monday broke $252"), do NOT carry forward false break claims. If you cannot verify the prior close from the past_dailies block, soften to "one day after Monday tested $252".

18. MACRO EVENT ANCHORING. The first time any briefing in a given week references an ongoing geopolitical or macro event (Iran tensions, Hormuz disruption, election cycle, Fed pivot, trade war, etc.), include a single anchoring clause that establishes what the event is and roughly when it began. Example: "...as Iran-Iraq tensions over the Strait of Hormuz, ongoing since March, eased on diplomatic progress." Subsequent briefings in the same week can reference shorthand. The reader who lands on this briefing for the first time should be able to follow the macro thread. This also helps AI search engines and LLM crawlers cite AGSIST as a primary source rather than getting stuck on uncited shorthand.

══ OUTPUT, return valid JSON with EXACTLY these fields ══

{{
  "headline": "ALL CAPS, 6-10 words.",
  "subheadline": "One sentence adding context.",
  "lead": "2-3 sentences. Specific price from table + synthesizing observation (RULE 1). Voice samples (RULE 9). Forward test (RULE 10). On Tue-Fri, advances the thread (RULE 11).",
  "the_takeaway": "Single sentence, max 18 words. The if-you-remember-one-thing (RULE 12). Empty string if you cannot write one sharper than the headline.",
  "teaser": "One punchy sentence for the collapsed hero bar.",
  "one_number": {{"value": "The day's most interesting number, see ONE NUMBER RUBRIC below.", "unit": "3-6 words DESCRIBING WHAT THE VALUE IS. Must be coherent with value. Wrong: value=1.4%, unit='live cattle decline' when the actual mover was feeders. Right: value=1.4%, unit='feeder cattle decline'.", "context": "2-3 sentences. Why this number matters today and what it tells you that prices alone don't."}},
  "yesterdays_call": {{
    "summary": "1 sentence describing the prior call (use the call text I gave you above as starting material; can be paraphrased for fit).",
    "outcome": "played_out | didnt | pending",
    "note": "1 sentence on what it means for today. OMIT field entirely on Mondays after long weekends or when no prior call was provided."
  }},
  "todays_call": {{
    "instrument": "The ONE instrument this briefing makes its sharpest directional bet on: corn, beans, wheat, cattle, feeders, hogs, crude, or natgas. Match your highest-conviction section.",
    "direction": "up | down",
    "level": "Number only, in the SAME units as the LOCKED PRICE TABLE ($/bu grains, $/cwt livestock, $/bbl crude). The price line your call hinges on."
  }},
  "sections": [
    {{"title": "3-5 words", "icon": "Single emoji", "body": "3-5 sentences with **bold** markdown for emphasis (NEVER <strong> HTML tags). All prices from LOCKED TABLE. VOICE. MUST thread the catalyst (RULE 14) into the body prose, do not just append it.",
      "catalyst": "OPTIONAL but recommended. 8-15 words naming the specific news/data/event that drove or contextualizes this section's price action. Example: 'USDA crop progress shows corn at 42%, ahead of 5-year avg.' Empty string allowed only when no relevant news in bucket.",
      "bottom_line": "TL;DR adding info beyond title (RULE 5). Max 20 words.",
      "conviction_level": "low | medium | high (earned per RULE 2)",
      "overnight_surprise": true/false,
      "farmer_action": "OPTIONAL. Specific thresholded recommendation only. Otherwise OMIT entirely.",
      "vs_yesterday": "OPTIONAL. Continuity marker per RULE 13. Under 12 words. OMIT if no real continuity to flag."}}
  ],
  "outside_the_pit": [
    {{"title": "Short headline of the news item, 6-12 words.",
      "body": "1-2 sentences in AGSIST voice. Why this matters even though it's not in today's prices.",
      "tag": "OPTIONAL. One-word category: POLICY, TRADE, WEATHER, DISEASE, LOGISTICS, INPUTS, MACRO, RURAL."}}
  ],
  "spread_to_watch": {{
    "label": "Specific spread name. Examples: 'November beans / July beans inverse', 'Dec corn / Jul wheat ratio', 'Cheese block / barrel', 'Live cattle / feeder ratio', 'Front-month crude / Brent'.",
    "level": "Where it is now plus direction. Examples: '$0.34 inverse, widening', '1.02 ratio, tight', '8 cents wide and rolling out'.",
    "commentary": "2 sentences. What is this spread saying that the headline price isn't? Embedded thesis. VOICE."
  }},
  "basis": {{"headline": "Short line capturing basis story (max 12 words).",
             "body": "2-4 sentences. Directional only (RULE 8). Bold key phrase with **markdown** (NEVER <strong> HTML tags)."}},
  "weekly_thread": {{
    "question": "Monday's question (copy forward Tue-Fri verbatim, set fresh on Mondays).",
    "day": "1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri",
    "status_text": "Today's contribution to the arc. 1-2 sentences. Setup on Mon, progress Tue-Thu, resolution on Fri (RULE 11)."
  }},
  "the_more_you_know": {{"title": "Differs from past TMYK topics. Tied to today's data (RULE 3).",
                          "body": "3-4 sentences. Open with reference to today's number/level/condition."}},
  "watch_list": [{{"time": "Time", "desc": "What. Half must include level/threshold (RULE 4)."}}],
  "daily_quote": {{"text": "EXACT quote.", "attribution": "EXACT attribution."}},
  "source_summary": "Data sources",
  "date": "Like 'Monday, April 27, 2026'",
  "meta": {{"market_mood": "bullish|bearish|mixed|cautious|volatile", "heat_section": 0, "overnight_surprises_count": 0}}
}}

SECTIONS:
- Default weekday: Grains & Oilseeds / Livestock & Dairy / Energy & Inputs / Macro & Trade
- MIN 2, MAX 5. If no story in a bucket, fold or OMIT. No padding.
- Quiet days: prefer 2-3 sections (RULE 6).
- vs_yesterday is OPTIONAL per section. Only include it when today's data
  meaningfully advanced or contradicted yesterday's coverage of the same
  commodity. Empty fields are correct when there's no continuity to note.

OMISSIONS, set fields to null or empty objects when not applicable:
- yesterdays_call: omit on Mondays after long weekends if no recent call provided. Otherwise required Tue-Fri.
- spread_to_watch: required every weekday. Pick something meaningful, not filler.\n- todays_call: required every weekday (a real direction+level call). Omit only when the market is closed.
- weekly_thread: required every weekday. Monday sets, Tue-Thu advance, Fri resolves.
- basis: required every weekday. Empty strings on weekends/holidays.
- outside_the_pit: REQUIRED every day, weekday and weekend. 3 items. Pull from news block. (Per RULE 16.)
- catalyst (per section): OPTIONAL field. Empty string allowed only when relevant news bucket is empty (per RULE 14).
- the_takeaway: STRING field. If you cannot write something committable per RULE 12, set to empty string "". Better empty than weak.
- vs_yesterday (per section): OMIT the field entirely when no continuity to mark (per RULE 13). Do not emit empty strings.

RESPOND WITH ONLY THE JSON OBJECT. No markdown. No preamble. No em dashes. VOICE OR DEATH."""


def _loads_lenient(text):
    """Parse model JSON, tolerating the two defects LLMs actually emit: prose or code
    fences wrapping the object, and trailing commas before } or ]. Tries STRICT first
    so clean output is byte-identical to before; repairs run only after a parse error."""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    s = text.strip()
    i = s.find("{"); j = s.rfind("}")          # drop any leading/trailing prose
    if i != -1 and j != -1 and j > i:
        s = s[i:j + 1]
    s = re.sub(r',(\s*[}\]])', r'\1', s)        # strip trailing commas — the #1 LLM JSON error
    return json.loads(s)


def call_claude(price_data, surprises, news_block, seasonal_ctx, todays_quote, past_dailies_block, past_tmyk_topics, market_status, yesterdays_call=None, weekly_thread=None, ongoing_situations="", editorial_notes="", past_one_number_topics=None, past_phrases=None, usda_release="", _parse_retry=True):
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("[error] ANTHROPIC_API_KEY not set", file=sys.stderr); sys.exit(1)
    now = datetime.now()
    date_str = now.strftime("%A, %B %-d, %Y")
    if surprises and not market_status["is_closed"]:
        lines = []
        for s in surprises:
            tier = "MAJOR" if s["surprise_magnitude"] >= 3.5 else ("SIGNIFICANT" if s["surprise_magnitude"] >= 2.5 else ("Notable" if s["surprise_magnitude"] >= 1.5 else "Mild"))
            lines.append(f"  {tier}: {s['commodity']} moved {s['pct_change']:+.1f}% ({s['direction']}), magnitude {s['surprise_magnitude']}x")
        surprise_block = f"OVERNIGHT SURPRISES ({len(surprises)} above threshold):\n" + "\n".join(lines) + "\nFlag in relevant sections with overnight_surprise: true."
    elif market_status["is_closed"]:
        surprise_block = "Markets closed. Do not frame as 'overnight surprises.' Friday's close vs Thursday's."
    else:
        surprise_block = "No overnight surprises. Quiet days deserve quiet briefings (RULE 6). Fewer sections if warranted."

    locked_table = price_data.get("price_block", "Price data unavailable")
    market_note = f"\nMARKET STATUS: {market_status['note']}\n" if market_status["is_closed"] else ""
    past_section = f"\n{past_dailies_block}\n" if past_dailies_block else ""

    user_message = f"""Generate today's AGSIST Daily briefing.

DATE: {date_str}
{market_note}
LOCKED PRICE TABLE (use ONLY these; do not invent):
{locked_table}

OVERNIGHT SURPRISES:
{surprise_block}

SEASONAL: {seasonal_ctx}
{past_section}
TODAY'S AG NEWS DIGEST, USE THIS to thread catalysts into sections (RULE 14) and to populate outside_the_pit (RULE 16). Items are clustered by bucket and sorted recent-first. Each item has title + summary + age:
{news_block}

TODAY'S QUOTE (copy exactly):
Text: "{todays_quote['text']}"
Attribution: "{todays_quote['attribution']}"

Apply all 18 IMPACT RULES. Voice samples are NON-NEGOTIABLE, no wire-service neutral. Forward test the lead before you finalize. If today is Tue-Fri, advance the weekly thread, do NOT rehash. Thread NEWS into every section's body, generic "fund positioning" without a specific catalyst tie is wire filler. Rule 17 (level coherence) is failure-mode-zero: the post-gen validator will reject contradictory break claims."""

    payload = {"model": MODEL, "max_tokens": 4500,
               "system": build_system_prompt(market_status, past_tmyk_topics, yesterdays_call, weekly_thread, ongoing_situations, editorial_notes, past_one_number_topics, past_phrases, usda_release),
               "messages": [{"role": "user", "content": user_message}]}
    headers = {"Content-Type": "application/json", "x-api-key": api_key, "anthropic-version": "2023-06-01"}

    # v4.2 (Phase 2 C5): retry with exponential backoff on transient failures.
    # 429 (rate-limited) and 5xx are retryable. 4xx auth/format errors are not.
    import time as _time
    MAX_RETRIES = 3
    BACKOFF_SECONDS = [4, 12, 30]
    last_err = None
    result = None
    for attempt in range(MAX_RETRIES):
        try:
            if requests:
                # v4.6.2: STREAM the response. A non-streaming POST puts the entire
                # generation under a single read-timeout window; a long briefing blows
                # past 60s and every retry hits the same wall (the 2026-06-15 outage).
                # With stream=True the read-timeout measures the gap *between* SSE chunks
                # (sub-second), so total generation time no longer trips it. Connect
                # timeout 10s (fail fast on network), read timeout 600s as a backstop.
                resp = requests.post(ANTHROPIC_API, json={**payload, "stream": True},
                                     headers=headers, stream=True, timeout=(10, 600))
                if resp.status_code == 429 or 500 <= resp.status_code < 600:
                    raise requests.exceptions.HTTPError(f"retryable HTTP {resp.status_code}")
                resp.raise_for_status()
                _parts = []
                for _line in resp.iter_lines(decode_unicode=True):
                    if not _line or not _line.startswith("data:"):
                        continue
                    _data = _line[5:].strip()
                    if not _data or _data == "[DONE]":
                        continue
                    try:
                        _evt = json.loads(_data)
                    except Exception:
                        continue
                    _t = _evt.get("type")
                    if _t == "content_block_delta":
                        _d = _evt.get("delta", {})
                        if _d.get("type") == "text_delta":
                            _parts.append(_d.get("text", ""))
                    elif _t == "error":
                        raise requests.exceptions.HTTPError(
                            f"stream error: {_evt.get('error')}")
                    elif _t == "message_stop":
                        break
                result = {"content": [{"type": "text", "text": "".join(_parts)}]}
                if not result["content"][0]["text"].strip():
                    raise RuntimeError("empty stream (no text deltas received)")
            else:
                # urllib fallback (requests absent): non-streaming with a generous read
                # timeout so a long generation still completes.
                data_bytes = json.dumps(payload).encode("utf-8")
                req = urllib.request.Request(ANTHROPIC_API, data=data_bytes, headers=headers, method="POST")
                with urllib.request.urlopen(req, timeout=600) as resp:
                    result = json.loads(resp.read().decode("utf-8"))
            break
        except Exception as e:
            last_err = e
            _sc = getattr(getattr(e, "response", None), "status_code", None)
            if _sc is not None and 400 <= _sc < 500 and _sc != 429:
                # Permanent client error (e.g. 404 model-not-found, 401 bad key) -
                # retrying cannot help, so fail fast with a pointed hint.
                print(f"  [error] non-retryable HTTP {_sc} from Anthropic API; not retrying. "
                      f"Verify MODEL is current (currently '{MODEL}').", file=sys.stderr)
                break
            if attempt < MAX_RETRIES - 1:
                wait = BACKOFF_SECONDS[attempt]
                print(f"  [warn] API call failed ({e}); retrying in {wait}s "
                      f"(attempt {attempt + 1}/{MAX_RETRIES})", file=sys.stderr)
                _time.sleep(wait)
    if result is None:
        raise last_err if last_err else RuntimeError("API call failed with no error captured")
    text = ""
    for block in result.get("content", []):
        if block.get("type") == "text": text += block["text"]
    text = text.strip()
    if text.startswith("```"): text = text.split("\n", 1)[1] if "\n" in text else text[3:]
    if text.endswith("```"): text = text[:-3]
    text = text.strip()
    if text.startswith("json"): text = text[4:].strip()
    try:
        return _loads_lenient(text)
    except json.JSONDecodeError as e:
        # The model emitted unparseable JSON even after repair. Regenerate ONCE
        # (a fresh sample is almost always clean); if it fails again, surface a
        # precise, debuggable error instead of a bare stack trace.
        if _parse_retry:
            print(f"  [warn] model returned malformed JSON ({e}); regenerating once...",
                  file=sys.stderr)
            return call_claude(price_data, surprises, news_block, seasonal_ctx, todays_quote,
                               past_dailies_block, past_tmyk_topics, market_status, yesterdays_call,
                               weekly_thread, ongoing_situations, editorial_notes,
                               past_one_number_topics, past_phrases, usda_release,
                               _parse_retry=False)
        _ctx = text[max(0, e.pos - 140): e.pos + 140].replace("\n", "\\n")
        print(f"  [error] model JSON unparseable after repair + one regeneration "
              f"(line {e.lineno} col {e.colno}). Near:\n    ...{_ctx}...", file=sys.stderr)
        raise


def validate_briefing(briefing, locked_prices):
    warnings = []
    known_values = {k: v for k, v in locked_prices.items() if v and v > 0}
    parts = [briefing.get("headline", ""), briefing.get("lead", ""), briefing.get("subheadline", ""),
             briefing.get("the_takeaway", "")]  # v4.3
    if briefing.get("one_number"): parts.append(briefing["one_number"].get("context", ""))
    for sec in briefing.get("sections", []):
        parts.append(sec.get("body", "")); parts.append(sec.get("bottom_line", ""))
        parts.append(sec.get("vs_yesterday", ""))  # v4.3
    tmyk = briefing.get("the_more_you_know") or briefing.get("tmyk") or {}
    parts.append(tmyk.get("body", ""))
    basis = briefing.get("basis") or {}
    parts.append(basis.get("body", ""))
    full_text = " ".join(parts)
    em = full_text.count("\u2014"); en = full_text.count("\u2013")
    if em: warnings.append(f"Em dash {em}x")
    if en: warnings.append(f"En dash {en}x")
    lower = full_text.lower()
    for phrase in ("wisconsin", "minnesota", "wi/mn"):
        if phrase in lower: warnings.append(f"Geo scope: '{phrase}'")
    q = briefing.get("daily_quote") or briefing.get("quote") or {}
    attr = (q.get("attribution") or "").strip().lower()
    if attr in FILLER_ATTRIBUTIONS:
        warnings.append(f"Quote attribution filler ({q.get('attribution')!r})")
    dollar_pattern = re.compile(r'\$([0-9,]+(?:\.[0-9]+)?)')
    found_values = []
    for m in dollar_pattern.finditer(full_text):
        try: found_values.append((float(m.group(1).replace(",", "")), m.group(0), m.start()))
        except ValueError: pass
    COMMODITY_RANGES = {"corn": (2.0, 9.0), "beans": (7.0, 20.0), "wheat": (3.0, 12.0),
                        "crude": (30.0, 200.0), "natgas": (1.0, 15.0), "gold": (500.0, 10000.0),
                        "silver": (5.0, 200.0), "cattle": (100.0, 350.0), "hogs": (40.0, 150.0),
                        "milk": (10.0, 35.0)}
    for fv, fs, fpos in found_values:
        matched = any(kv > 0 and abs(fv - kv) / kv <= 0.05 for kv in known_values.values())
        if not matched:
            tail = full_text[fpos+len(fs): fpos+len(fs)+12].lower().lstrip()
            if tail[:7] in ("billion", "million") or tail[:8] == "trillion" or tail[:3] in ("bn ", "mn ", "tn ") or tail[:2] in ("b ", "m "):
                continue  # aggregate value (e.g. "$17 billion"), not a per-unit commodity price
            lead = full_text[max(0, fpos-12):fpos].lower()
            if re.search(r'\b(down|up|off|gained|lost|added|shed|plus|minus|rose|fell|gaining|losing)\s*$', lead):
                continue  # a change amount ("down $1.35"), not a price level
            ctx = full_text[max(0, fpos-75):fpos+30].lower()
            if re.search(r'(spread|carry|new-crop|old-crop|december|november|deferred|back month|next month)', ctx):
                continue  # forward-contract / spread price, not the nearby quote in prices.json
            for key, (lo, hi) in COMMODITY_RANGES.items():
                if lo <= fv <= hi:
                    _ctx = full_text[max(0, fpos-55):fpos+25].replace("\n", " ").strip()
                    warnings.append(f"Price {fs} not in prices.json (possible {key}) | \"...{_ctx}...\"")
                    break
    # Hard blocks are reserved for genuine DATA-INTEGRITY problems, which the gate
    # (briefing_gate.py) already enforces deterministically: locked-price drift, call-
    # outcome mismatch, calendar errors, contaminated feed, regional scope. Everything
    # validate_briefing finds is EDITORIAL/voice — em/en dashes, geo phrasing, quote-
    # attribution filler, an unrecognized $ figure. Those are real signals worth logging,
    # but none should silently kill the morning send: a stray em-dash is a voice nit, not
    # a reason to publish nothing. So they are returned as warnings and never flip
    # price_validation_clean. Voice is still policed by the critic; scope is still hard-
    # blocked by the gate. (Add a token here only for a future genuine data-integrity
    # check that truly must stop the send.)
    NON_BLOCKING = ("not in prices.json", "Em dash", "En dash",
                    "Geo scope", "Quote attribution filler")
    fatal = [w for w in warnings if not any(tok in w for tok in NON_BLOCKING)]
    return len(fatal) == 0, warnings


def fix_weekday_labels(briefing, today=None):
    """Deterministically correct 'Weekday Month Day' strings whose weekday does not
    match the actual date (e.g. 'Monday June 30' when June 30 is a Tuesday). USDA
    report references in watch_list routinely get the day-of-week wrong; this fixes
    them so the briefing is factually correct and the gate's calendar check passes."""
    import calendar as _cal
    if today is None:
        today = datetime.now().date()
    MONTHS3 = {m[:3].lower(): i for i, m in enumerate(_cal.month_name) if m}
    WD3 = {"mon": "Monday", "tue": "Tuesday", "wed": "Wednesday", "thu": "Thursday",
           "fri": "Friday", "sat": "Saturday", "sun": "Sunday"}
    # Mirror the gate's calendar check: optional comma after the weekday. Also accept
    # abbreviated months/weekdays, so 'Thursday, July 3' and 'Thurs. Jul 3' are both
    # caught here BEFORE the gate hard-blocks the send on the mismatch.
    WD = (r'(Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:r|rs|rsday)?|'
          r'Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)')
    MO = (r'(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|'
          r'Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)')
    pat = re.compile(rf'\b{WD}\.?,?\s+{MO}\.?\s+(\d{{1,2}})\b', re.IGNORECASE)
    fixes = []

    def _resolve(mon_idx, day):
        for y in (today.year, today.year + 1):
            try:
                d = datetime(y, mon_idx, day).date()
            except ValueError:
                continue
            if d >= today - timedelta(days=2):
                return d
        try:
            return datetime(today.year, mon_idx, day).date()
        except ValueError:
            return None

    def _repl(m):
        wd_tok, mon_tok, day = m.group(1), m.group(2), int(m.group(3))
        mi = MONTHS3.get(mon_tok[:3].lower())
        if mi is None:
            return m.group(0)
        d = _resolve(mi, day)
        if d is None:
            return m.group(0)
        correct = d.strftime('%A')
        given_full = WD3.get(wd_tok[:3].lower(), wd_tok)
        if correct.lower() != given_full.lower():
            fixes.append(f"{wd_tok} {mon_tok} {day} -> {correct}")
            return m.group(0).replace(wd_tok, correct, 1)  # preserve comma + month style
        return m.group(0)

    for item in briefing.get("watch_list", []) or []:
        for k in ("time", "desc"):
            if isinstance(item.get(k), str):
                item[k] = pat.sub(_repl, item[k])
    return briefing, fixes


SPONSOR_OVERRIDE = None

SPONSOR_HOUSE_AD = {
    "active": False, "label": "FOUNDING SPONSOR \u00b7 1 SLOT", "advertiser": "AGSIST",
    "headline": "Sponsor the AGSIST Daily Briefing \u2014 $150/week.",
    "body": "One ag company per issue. Your message reaches working US producers across grain, cattle, dairy, and specialty operations \u2014 read every morning before the open. Founding rate locked in for 12 months from start date. Six-week minimum commitment ($900). After that, week-to-week.",
    "cta_text": "Become the founding sponsor",
    "cta_url": "mailto:sig@farmers1st.com?subject=AGSIST%20Daily%20founding%20sponsor%20inquiry",
    "disclosure": "One sponsor, one issue. No retargeting. No programmatic auctions. Reply or call 715-797-2428.",
    "is_house_ad": True,
}


def build_sponsor_block():
    if SPONSOR_OVERRIDE:
        out = dict(SPONSOR_OVERRIDE)
        out.setdefault("label", "SPONSORED"); out.setdefault("active", True)
        out.setdefault("is_house_ad", False)
        return out
    sponsor_path = REPO_ROOT / "data" / "sponsor.json"
    if sponsor_path.exists():
        try:
            with open(sponsor_path) as f: data = json.load(f)
            if data.get("active"):
                data.setdefault("label", "SPONSORED"); data.setdefault("is_house_ad", False)
                return data
        except Exception as e:
            print(f"  [warn] sponsor.json unreadable: {e}", file=sys.stderr)
    return dict(SPONSOR_HOUSE_AD)


def render_sparkline_svg(series, width=180, height=32):
    if not series or len(series) < 2: return ""
    mn, mx = min(series), max(series); rng = (mx - mn) or 1
    p = 3; step = (width - p * 2) / (len(series) - 1)
    pts = [(p + i * step, height - p - ((v - mn) / rng) * (height - p * 2)) for i, v in enumerate(series)]
    first, last = series[0], series[-1]
    stroke = "#4aab4c" if last >= first else "#e05a42"
    fill = "rgba(74,171,76,.14)" if last >= first else "rgba(224,90,66,.14)"
    pts_str = " ".join(f"{x:.1f},{y:.1f}" for x, y in pts)
    last_x, last_y = pts[-1]
    area_pts = pts_str + f" {last_x:.1f},{height} {p},{height}"
    return (f'<svg viewBox="0 0 {width} {height}" preserveAspectRatio="none" aria-hidden="true" style="width:100%;height:30px;display:block">'
            f'<polyline points="{area_pts}" fill="{fill}" stroke="none"/>'
            f'<polyline points="{pts_str}" fill="none" stroke="{stroke}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>'
            f'<circle cx="{last_x:.1f}" cy="{last_y:.1f}" r="2" fill="{stroke}"/></svg>')


ARCHIVE_JSON_DIR = REPO_ROOT / "data" / "daily-archive"
ARCHIVE_HTML_DIR = REPO_ROOT / "daily"


def html_esc(s):
    if not s: return ""
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def html_esc_preserve_strong(s):
    if not s: return ""
    parts = re.split(r'(</?(?:strong|em)>)', s, flags=re.IGNORECASE)
    out = []
    for part in parts:
        if part.lower() in ('<strong>', '</strong>', '<em>', '</em>'): out.append(part.lower())
        else: out.append(html_esc(part))
    joined = "".join(out)
    # v4.6.2: generator stores **markdown** emphasis in JSON by design
    # (v4.5.0 "markdown not HTML"). Convert to <strong> at render time so
    # archive pages match mdInline() in index.html / daily.html exactly.
    joined = re.sub(r'\*\*([^*]+?)\*\*', r'<strong>\1</strong>', joined)
    return joined


def js_esc(s):
    if s is None: return ""
    return (str(s).replace("\\", "\\\\").replace("'", "\\'").replace("\n", " ")
            .replace("\r", " ").replace("\u2028", " ").replace("\u2029", " "))


def og_image_for(date_iso):
    if OG_IMAGE_BASE: return f"{OG_IMAGE_BASE}{date_iso}.png"
    return "https://agsist.com/img/og/agsist.jpg"


def render_sponsor_block_html(sponsor):
    if not sponsor: return ""
    label = html_esc(sponsor.get("label", "SPONSORED"))
    advertiser = html_esc(sponsor.get("advertiser", ""))
    headline = html_esc(sponsor.get("headline", ""))
    body = html_esc(sponsor.get("body", ""))
    cta_text = html_esc(sponsor.get("cta_text", "Learn more"))
    cta_url = html_esc(sponsor.get("cta_url", "#"))
    disclosure = html_esc(sponsor.get("disclosure", ""))
    is_house = sponsor.get("is_house_ad", False)
    house_class = " dv3-sponsor--house" if is_house else ""
    advertiser_html = f'<span class="dv3-sponsor-by">{advertiser}</span>' if advertiser and not is_house else ""
    disclosure_html = f'<div class="dv3-sponsor-disclosure">{disclosure}</div>' if disclosure else ""
    target = ' target="_blank"' if cta_url.startswith('http') else ''
    return (f'<aside class="dv3-sponsor{house_class}" aria-label="Sponsored content">'
            f'<div class="dv3-sponsor-label-row"><span class="dv3-sponsor-label">{label}</span>{advertiser_html}</div>'
            f'<div class="dv3-sponsor-headline">{headline}</div>'
            f'<div class="dv3-sponsor-body">{body}</div>'
            f'<a class="dv3-sponsor-cta" href="{cta_url}" rel="sponsored noopener"{target}>{cta_text} &rarr;</a>'
            f'{disclosure_html}</aside>')


def render_basis_block_html(basis, market_closed=False):
    if not basis or market_closed: return ""
    headline = html_esc(basis.get("headline", "")).strip()
    body = html_esc_preserve_strong(basis.get("body", "")).strip()
    if not headline and not body: return ""
    headline_html = f'<div class="dv3-basis-headline">{headline}</div>' if headline else ""
    body_html = f'<div class="dv3-basis-body">{body}</div>' if body else ""
    return (f'<div class="dv3-basis"><div class="dv3-basis-label">&#x1F4CD; BASIS PULSE</div>'
            f'{headline_html}{body_html}</div>')


def render_forward_block_html(date_iso):
    return ('<div class="dv3-forward">'
            '<span class="dv3-forward-icon">&#x1F4E8;</span>'
            '<div class="dv3-forward-content">'
            '<div class="dv3-forward-headline">Know a farmer who&rsquo;d want this?</div>'
            '<div class="dv3-forward-sub">Forward this briefing. Or new here? Subscribe in one tap.</div>'
            '</div>'
            '<a class="dv3-forward-cta" href="https://agsist.com/daily?subscribe=1">Subscribe &rarr;</a>'
            '</div>')


def render_byline_block_html():
    return ('<div class="dv3-byline">'
            'Written by <strong>Sigurd Lindquist</strong>, founder. Reply at '
            '<a href="mailto:sig@farmers1st.com">sig@farmers1st.com</a> &mdash; I read everything.'
            '</div>')


def render_sponsor_attribution_html(sponsor):
    """Tiny single-line sponsor attribution that sits between the date and
    the headline. Renders 'Today's sponsor: [Name] \u2192' when paid, or
    'Sponsor this slot \u2192' when house-ad. Click-through goes to the same
    cta_url the main sponsor block uses."""
    if not sponsor: return ""
    is_house = sponsor.get("is_house_ad", False)
    cta_url = html_esc(sponsor.get("cta_url", "#"))
    target = ' target="_blank"' if cta_url.startswith('http') else ''
    rel_attr = ' rel="sponsored noopener"' if not is_house else ''
    if is_house:
        text = "&#x1F7E1; Sponsor this slot &rarr;"
        cls = "dv3-spattr dv3-spattr--house"
    else:
        advertiser = html_esc(sponsor.get("advertiser", "")).strip()
        if not advertiser: return ""
        text = f"&#x1F7E1; Today's sponsor: <strong>{advertiser}</strong> &rarr;"
        cls = "dv3-spattr dv3-spattr--paid"
    return (f'<a class="{cls}" href="{cta_url}"{target}{rel_attr} aria-label="Sponsor information">'
            f'{text}</a>')


def render_yesterdays_call_block_html(yc, market_closed=False):
    """yc is briefing.get('yesterdays_call') dict. Skip on weekends/holidays
    or when summary is empty (no prior call to thread)."""
    if not yc or market_closed: return ""
    summary = html_esc((yc.get("summary") or "").strip())
    outcome = (yc.get("outcome") or "").strip().lower()
    note = html_esc_preserve_strong((yc.get("note") or "").strip())
    if not summary: return ""
    outcome_map = {
        "played_out": ("PLAYED OUT", "#4aab4c", "rgba(74,171,76,.10)", "rgba(74,171,76,.32)"),
        "didnt": ("DIDN'T", "#e05a42", "rgba(224,90,66,.10)", "rgba(224,90,66,.32)"),
        "pending": ("STILL PENDING", "#e6b042", "rgba(218,165,32,.10)", "rgba(218,165,32,.32)"),
    }
    label, color, bg, border = outcome_map.get(outcome, outcome_map["pending"])
    note_html = f'<div class="dv3-yc-note">{note}</div>' if note else ""
    return (f'<div class="dv3-yc">'
            f'<div class="dv3-yc-label">&#x21BA; YESTERDAY\'S CALL '
            f'<span class="dv3-yc-outcome" style="color:{color};background:{bg};border:1px solid {border}">{label}</span>'
            f'</div>'
            f'<div class="dv3-yc-summary">{summary}</div>'
            f'{note_html}'
            f'</div>')


def render_spread_block_html(spread, market_closed=False):
    """spread is briefing.get('spread_to_watch') dict."""
    if not spread or market_closed: return ""
    label = html_esc((spread.get("label") or "").strip())
    level = html_esc((spread.get("level") or "").strip())
    commentary = html_esc_preserve_strong((spread.get("commentary") or "").strip())
    if not label and not commentary: return ""
    label_html = f'<div class="dv3-spread-label-text">{label}</div>' if label else ""
    level_html = f'<div class="dv3-spread-level">{level}</div>' if level else ""
    body_html = f'<div class="dv3-spread-body">{commentary}</div>' if commentary else ""
    return (f'<div class="dv3-spread">'
            f'<div class="dv3-spread-label">&#x21C4; THE SPREAD TO WATCH</div>'
            f'{label_html}{level_html}{body_html}'
            f'</div>')


def render_thread_marker_html(thread, market_closed=False):
    """thread is briefing.get('weekly_thread') dict. Renders as a small
    chapter-marker above the lead. Quietly fades on Tue-Thu, gets emphasis
    on Mon (setup) and Fri (resolution)."""
    if not thread or market_closed: return ""
    question = html_esc((thread.get("question") or "").strip())
    day = thread.get("day") or 0
    if not question: return ""
    day_labels = {1: "MONDAY SETUP", 2: "TUE UPDATE", 3: "WED UPDATE", 4: "THU UPDATE", 5: "FRIDAY RESOLUTION"}
    day_text = day_labels.get(day, "THIS WEEK")
    is_anchor = day in (1, 5)  # Setup or resolution = stronger emphasis
    cls = "dv3-thread dv3-thread--anchor" if is_anchor else "dv3-thread"
    return (f'<div class="{cls}">'
            f'<span class="dv3-thread-day">&#x1F9F5; {day_text}</span>'
            f'<span class="dv3-thread-q">{question}</span>'
            f'</div>')


def render_outside_the_pit_html(items, market_closed=False):
    """v4.4: render outside_the_pit block, ag news in the calculus that
    isn't moving today's prices but matters for what's coming. 3 items
    expected; renders whatever's provided. Empty/missing → no render."""
    if not items or not isinstance(items, list):
        return ""
    rendered_items = []
    for it in items:
        if not isinstance(it, dict):
            continue
        title = (it.get("title") or "").strip()
        body = (it.get("body") or "").strip()
        tag = (it.get("tag") or "").strip().upper()
        if not title and not body:
            continue
        tag_html = ""
        if tag:
            tag_html = (f'<span class="dv3-otp-tag">{html_esc(tag)}</span>')
        title_html = f'<div class="dv3-otp-title">{html_esc(title)}</div>' if title else ""
        body_html = f'<div class="dv3-otp-body">{html_esc_preserve_strong(body)}</div>' if body else ""
        rendered_items.append(
            f'<div class="dv3-otp-item">{tag_html}{title_html}{body_html}</div>'
        )
    if not rendered_items:
        return ""
    label_text = "WEEK AHEAD IN AG" if market_closed else "OUTSIDE THE PIT"
    label_sub = ("News not moving prices today but in the calculus."
                 if not market_closed else
                 "What's brewing for next week.")
    return (f'<div class="dv3-otp" aria-label="{label_text}">'
            f'<div class="dv3-otp-header">'
            f'<span class="dv3-otp-label">&#x1F4F0; {label_text}</span>'
            f'<span class="dv3-otp-sub">{label_sub}</span>'
            f'</div>'
            f'<div class="dv3-otp-grid">' + "".join(rendered_items) + '</div>'
            f'</div>')


def render_takeaway_block_html(takeaway):
    """v4.3: render the_takeaway as a prominent committable-statement card.
    Empty string or missing field → no render."""
    if not takeaway or not isinstance(takeaway, str):
        return ""
    text = takeaway.strip()
    if not text:
        return ""
    return (f'<div class="dv3-takeaway" role="note" aria-label="Today\'s key takeaway">'
            f'<span class="dv3-takeaway-label">&#x1F3AF; THE TAKEAWAY</span>'
            f'<p class="dv3-takeaway-text">{html_esc(text)}</p>'
            f'</div>')


def render_cashbids_footer_html(market_closed):
    """v4.3: weekday-only inline cash-bids conversion footer.
    Sits below byline, above share row. Skipped on weekends/holidays."""
    if market_closed:
        return ""
    return ('<a class="dv3-cashbids-cta" href="/cash-bids" '
            'aria-label="View your local cash bids">'
            '<span class="dv3-cashbids-icon">&#x1F4B5;</span>'
            '<span class="dv3-cashbids-text"><strong>Your local elevator bids</strong> '
            '<span class="dv3-cashbids-arrow">&rarr;</span></span>'
            '</a>')


def archive_neighbor_dates(date_iso):
    """Previous/next published briefing dates around date_iso (ISO strings or None)."""
    try:
        dates = sorted(p.stem for p in ARCHIVE_JSON_DIR.glob("*.json") if p.stem != "index")
    except Exception:
        return None, None
    if date_iso in dates:
        i = dates.index(date_iso)
        return (dates[i-1] if i > 0 else None,
                dates[i+1] if i < len(dates)-1 else None)
    earlier = [d for d in dates if d < date_iso]
    later = [d for d in dates if d > date_iso]
    return (earlier[-1] if earlier else None, later[0] if later else None)


def _nav_date_label(d):
    try:
        dt = datetime.strptime(d, "%Y-%m-%d")
        return dt.strftime("%b ") + str(dt.day)
    except Exception:
        return d


def generate_archive_html(briefing, date_iso, prev_date=None, next_date=None):
    date_display = briefing.get("date", date_iso)
    headline = html_esc(briefing.get("headline", "AGSIST Daily Briefing"))
    subheadline = html_esc(briefing.get("subheadline", ""))
    lead = html_esc(briefing.get("lead", ""))
    meta = briefing.get("meta", {})
    mood = meta.get("market_mood", "")
    heat_idx = meta.get("heat_section", -1)
    surprises = briefing.get("surprises", [])
    surprise_count = meta.get("overnight_surprises_count", 0)
    is_weekend_brief = briefing.get("market_closed", False)
    gen_at = briefing.get("generated_at", "")
    issue_num = briefing.get("issue_number", 0)

    og_image_url = og_image_for(date_iso)
    og_description_raw = briefing.get("teaser") or briefing.get("lead") or briefing.get("subheadline") or "AGSIST Daily morning market briefing"
    og_description = html_esc(og_description_raw[:180])
    desc_escaped = html_esc(lead[:160]) if lead else og_description
    issue_suffix = f" &middot; ISSUE #{issue_num}" if issue_num else ""

    surprise_html = ""
    if surprise_count > 0 and not is_weekend_brief:
        names = []
        for s in surprises:
            arrow = "UP" if s.get("direction") == "up" else "DN"
            names.append(f'{s.get("commodity","")} {arrow} {abs(s.get("pct_change",0)):.1f}%')
        surprise_html = (f'<div class="dv3-surprise-banner" style="display:flex">'
                         f'<span class="surprise-icon">&#x26A1;</span>'
                         f'<span class="surprise-text"><strong>Overnight Surprise{"s" if surprise_count > 1 else ""}:</strong> '
                         f'{" / ".join(names) if names else str(surprise_count) + " unusual move"}'
                         f'</span></div>')

    mood_html = ""
    if mood:
        mood_colors = {
            "bullish":  ("var(--green)", "rgba(58,139,60,.08)", "rgba(58,139,60,.22)"),
            "bearish":  ("var(--red)", "rgba(184,76,42,.08)", "rgba(184,76,42,.22)"),
            "mixed":    ("var(--gold)", "rgba(218,165,32,.08)", "rgba(218,165,32,.22)"),
            "cautious": ("var(--blue)", "rgba(74,143,186,.08)", "rgba(74,143,186,.22)"),
            "volatile": ("var(--orange)", "rgba(200,122,40,.08)", "rgba(200,122,40,.22)"),
        }
        mood_icons = {"bullish": "\u2197", "bearish": "\u2198", "mixed": "\u2194", "cautious": "\u26A0\uFE0F", "volatile": "\U0001F525"}
        mc = mood_colors.get(mood, mood_colors["mixed"])
        mi = mood_icons.get(mood, "\U0001F4CA")
        mood_html = (f'<span class="dv3-mood" style="display:inline-flex;color:{mc[0]};background:{mc[1]};border:1px solid {mc[2]}">'
                     f'{mi} {mood.capitalize()}</span>')

    chart_series = briefing.get("chart_series") or {}
    sparks_html = ""
    if chart_series:
        label_map = [("corn", "Corn"), ("soybeans", "Soybeans"), ("wheat", "Wheat")]
        cells = []
        for key, label in label_map:
            ser = chart_series.get(key) or []
            if len(ser) >= 2:
                last = ser[-1]
                try: last_str = f"${float(last):.2f}"
                except (TypeError, ValueError): last_str = str(last)
                svg = render_sparkline_svg(ser)
                cells.append(f'<div class="dv3-spark"><div class="dv3-spark-head">'
                             f'<span class="dv3-spark-label">{label}</span>'
                             f'<span class="dv3-spark-last">{last_str}</span></div>{svg}</div>')
        if cells: sparks_html = '<div class="dv3-sparks">' + "".join(cells) + '</div>'

    sections_html = ""
    for i, sec in enumerate(briefing.get("sections", [])):
        cls = "dv3-sec"
        if sec.get("overnight_surprise") and not is_weekend_brief: cls += " dv3-sec--surprise"
        if i == heat_idx: cls += " dv3-sec--heat"
        icon = html_esc(sec.get("icon", "\U0001F4CA"))
        title = html_esc(sec.get("title", ""))
        body = html_esc_preserve_strong(sec.get("body", ""))
        bottom_line = html_esc(sec.get("bottom_line", ""))
        farmer_action = html_esc(sec.get("farmer_action", ""))
        conviction = sec.get("conviction_level", "")
        conviction_html = ""
        if conviction:
            cv_colors = {
                "high":   ("var(--green)", "rgba(58,139,60,.10)", "rgba(58,139,60,.25)"),
                "medium": ("var(--gold)", "rgba(218,165,32,.10)", "rgba(218,165,32,.25)"),
                "low":    ("var(--text-muted)", "var(--surface2)", "var(--border)"),
            }
            cv = cv_colors.get(conviction, cv_colors["medium"])
            conviction_html = f'<span class="dv3-sec-conviction" style="color:{cv[0]};background:{cv[1]};border:1px solid {cv[2]}">{conviction.upper()} CONVICTION</span>'
        bottom_html = f'<div class="dv3-sec-bottomline">{bottom_line}</div>' if bottom_line else ""
        action_html = f'<div class="dv3-sec-action">&#x1F3AF; {farmer_action}</div>' if farmer_action else ""
        # v4.4: per-section catalyst marker (RULE 14)
        catalyst = (sec.get("catalyst") or "").strip()
        catalyst_html = ""
        if catalyst and not is_weekend_brief:
            catalyst_html = (f'<div class="dv3-sec-catalyst" aria-label="catalyst">'
                             f'<span class="dv3-sec-catalyst-icon">&#x1F4E1;</span>'
                             f'<span class="dv3-sec-catalyst-label">DRIVER</span>'
                             f'<span class="dv3-sec-catalyst-text">{html_esc(catalyst)}</span>'
                             f'</div>')
        # v4.3: per-section continuity marker (vs_yesterday)
        vs_y = (sec.get("vs_yesterday") or "").strip()
        vs_y_html = ""
        if vs_y and not is_weekend_brief:
            vs_y_html = (f'<div class="dv3-sec-vs" aria-label="vs yesterday">'
                         f'<span class="dv3-sec-vs-icon">&#x21BA;</span>'
                         f'<span class="dv3-sec-vs-text">{html_esc(vs_y)}</span>'
                         f'</div>')
        sections_html += (f'<div class="{cls}" style="position:relative">'
                          f'<div class="dv3-sec-header"><span class="dv3-sec-icon">{icon}</span>'
                          f'<span class="dv3-sec-title">{title}</span>{conviction_html}</div>'
                          f'{catalyst_html}'
                          f'{vs_y_html}'
                          f'<div class="dv3-sec-body">{body}</div>{bottom_html}{action_html}</div>')

    one_num = briefing.get("one_number", {})
    one_num_html = ""
    if one_num:
        one_num_html = (f'<div class="dv3-one-number">'
                        f'<div class="dv3-one-number-label">&#x1F4CA; THE NUMBER</div>'
                        f'<div class="dv3-one-number-val">{html_esc(one_num.get("value", "\u2014"))}</div>'
                        f'<div class="dv3-one-number-unit">{html_esc(one_num.get("unit", ""))}</div>'
                        f'<div class="dv3-one-number-ctx">{html_esc(one_num.get("context", ""))}</div>'
                        f'</div>')

    quote = briefing.get("daily_quote", {})
    quote_html = ""
    if quote:
        qt = quote.get("text", "").strip('"\u201c\u201d')
        qa = quote.get("attribution", "").lstrip("\u2014\u2013- ")
        quote_html = (f'<div class="dv3-quote-card">'
                      f'<div class="dv3-quote-label">&#x1F4AC; DAILY QUOTE</div>'
                      f'<p class="dv3-quote-text">\u201c{html_esc(qt)}\u201d</p>'
                      f'<cite class="dv3-quote-attr">{html_esc(qa)}</cite></div>')

    tmyk = briefing.get("the_more_you_know", {})
    tmyk_html = ""
    if tmyk:
        tmyk_html = (f'<div class="dv3-tmyk">'
                     f'<div class="dv3-tmyk-label">&#x1F9E0; THE MORE YOU KNOW</div>'
                     f'<div class="dv3-tmyk-title">{html_esc(tmyk.get("title", ""))}</div>'
                     f'<div class="dv3-tmyk-body">{html_esc_preserve_strong(tmyk.get("body", ""))}</div></div>')

    watch = briefing.get("watch_list", [])
    watch_items = ""
    for item in watch:
        watch_items += (f'<li class="dv3-watch-item">'
                        f'<span class="dv3-watch-time">{html_esc(item.get("time", ""))}</span>'
                        f'<span class="dv3-watch-desc">{html_esc_preserve_strong(item.get("desc", ""))}</span></li>')
    # v4.3: weekend editions show forward-week list, weekday show today
    watch_label = "THIS WEEK\'S WATCH LIST" if is_weekend_brief else "TODAY\'S WATCH LIST"
    watch_html = f'<div class="dv3-watch"><div class="dv3-watch-label">&#x1F4C5; {watch_label}</div><ul class="dv3-watch-list">{watch_items}</ul></div>' if watch else ""

    source = html_esc(briefing.get("source_summary", "USDA / CME Group / Open-Meteo"))

    weekend_badge = ""
    if is_weekend_brief:
        reason = briefing.get("market_status_reason", "")
        label = "WEEKEND EDITION" if reason == "weekend" else "HOLIDAY EDITION"
        weekend_badge = (f'<span style="display:inline-flex;align-items:center;gap:.3rem;'
                         f'font-family:\'JetBrains Mono\',monospace;font-size:.58rem;font-weight:700;'
                         f'letter-spacing:.1em;text-transform:uppercase;color:var(--gold);'
                         f'background:rgba(218,165,32,.08);border:1px solid rgba(218,165,32,.22);'
                         f'border-radius:3px;padding:.18rem .55rem;margin-left:.5rem">&#x1F4C5; {label}</span>')

    topbar_html = f'<div class="dv3-topbar">{one_num_html}{quote_html}</div>' if (one_num_html or quote_html) else ""

    sponsor = briefing.get("sponsor") or build_sponsor_block()
    sponsor_html = render_sponsor_block_html(sponsor)
    basis_html = render_basis_block_html(briefing.get("basis"), is_weekend_brief)
    forward_html = render_forward_block_html(date_iso)
    byline_html = render_byline_block_html()
    # v4.3: new render helpers
    takeaway_html = render_takeaway_block_html(briefing.get("the_takeaway", ""))
    cashbids_html = render_cashbids_footer_html(is_weekend_brief)
    yc_html = render_yesterdays_call_block_html(briefing.get("yesterdays_call"), is_weekend_brief)
    spread_html = render_spread_block_html(briefing.get("spread_to_watch"), is_weekend_brief)
    thread_html = render_thread_marker_html(briefing.get("weekly_thread"), is_weekend_brief)
    sponsor_attr_html = render_sponsor_attribution_html(sponsor)
    # v4.4: outside_the_pit (news in the calculus, not in today's prices)
    outside_pit_html = render_outside_the_pit_html(briefing.get("outside_the_pit"), is_weekend_brief)

    # v4.6.3: archive interlinking — static prev/next so crawlers (and
    # readers) can walk the briefing corpus. next_date is filled in for
    # yesterday's page by save_archive's re-render, and for the whole
    # backlog by rebuild_archive_html.py.
    nav_parts = []
    if prev_date:
        nav_parts.append(f'<a class="dv3-archnav-a" href="/daily/{prev_date}" rel="prev">&larr; {_nav_date_label(prev_date)} briefing</a>')
    nav_parts.append('<a class="dv3-archnav-a dv3-archnav-all" href="/archive">All briefings</a>')
    if next_date:
        nav_parts.append(f'<a class="dv3-archnav-a" href="/daily/{next_date}" rel="next">{_nav_date_label(next_date)} briefing &rarr;</a>')
    archive_nav_html = ('<nav class="dv3-archnav" aria-label="Briefing archive">'
                        + "".join(nav_parts) + '</nav>')

    share_html = (
        '<div class="dv3-share" role="group" aria-label="Share this briefing">'
        '<span class="dv3-share-label">Share</span>'
        '<button class="dv3-share-btn" data-share="twitter" type="button" aria-label="Post on X">'
        '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">'
        '<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>'
        '</svg> Post</button>'
        '<button class="dv3-share-btn" data-share="copy" type="button" aria-label="Copy link to this briefing">&#x1F517; Copy link</button>'
        '<button class="dv3-share-btn" data-share="email" type="button" aria-label="Email this briefing">&#x2709; Email</button>'
        '</div>')

    js_permalink = f"https://agsist.com/daily/{date_iso}"
    js_headline  = js_esc(briefing.get("headline", "AGSIST Daily Briefing"))
    js_datedisp  = js_esc(date_display)

    page = f"""<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="theme-color" content="#111a0a">
<title>AGSIST Daily &mdash; {html_esc(date_display)}: {headline}</title>
<meta name="description" content="{headline} &mdash; {desc_escaped}">
<meta name="author" content="Sigurd Lindquist">
<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">
<link rel="canonical" href="https://agsist.com/daily/{date_iso}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="AGSIST">
<meta property="og:locale" content="en_US">
<meta property="og:title" content="AGSIST Daily &mdash; {html_esc(date_display)}: {headline}">
<meta property="og:description" content="{og_description}">
<meta property="og:url" content="https://agsist.com/daily/{date_iso}">
<meta property="og:image" content="{og_image_url}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="AGSIST Daily &mdash; {headline}">
<meta property="article:published_time" content="{date_iso}">
<meta property="article:modified_time" content="{gen_at}">
<meta property="article:author" content="Sigurd Lindquist">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@agsist">
<meta name="twitter:creator" content="@agsist">
<meta name="twitter:title" content="AGSIST Daily &mdash; {html_esc(date_display)}">
<meta name="twitter:description" content="{og_description}">
<meta name="twitter:image" content="{og_image_url}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" href="/components/styles.css?v=10" as="style">
<link rel="stylesheet" href="/components/styles.css?v=10">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Oswald:wght@500;600;700&display=swap">
<link rel="icon" type="image/x-icon" href="/img/favicon.ico">
<link rel="icon" type="image/png" sizes="32x32" href="/img/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/img/favicon-16.png">
<link rel="apple-touch-icon" href="/img/apple-touch-icon.png">
<link rel="manifest" href="/manifest.json">
<script async src="https://www.googletagmanager.com/gtag/js?id=G-6KXCTD5Z9H"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){{dataLayer.push(arguments);}}gtag('js',new Date());gtag('config','G-6KXCTD5Z9H');</script>
<script type="application/ld+json">
{{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "{headline}",
  "datePublished": "{date_iso}",
  "dateModified": "{gen_at}",
  "description": "{html_esc(lead[:200])}",
  "image": "{og_image_url}",
  "author": {{"@type": "Person", "name": "Sigurd Lindquist", "url": "https://agsist.com"}},
  "publisher": {{"@type": "Organization", "name": "AGSIST", "url": "https://agsist.com"}},
  "mainEntityOfPage": {{"@type": "WebPage", "@id": "https://agsist.com/daily/{date_iso}"}}
}}
</script>
<style>
button,a,[role="button"]{{touch-action:manipulation;}}
html,body{{overflow-x:hidden;overflow-x:clip;width:100%;}}
.dv3-page{{max-width:900px;margin:0 auto;padding:2rem 1.25rem}}
.dv3-header{{margin-bottom:2rem;padding-bottom:1.5rem;border-bottom:2px solid var(--border)}}
.dv3-eyebrow{{display:inline-flex;align-items:center;gap:.5rem;font-family:'JetBrains Mono',monospace;font-size:.68rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--green);margin-bottom:.75rem;padding:.3rem .75rem;background:rgba(74,171,76,.06);border:1px solid rgba(74,171,76,.18);border-radius:3px}}
.dv3-eyebrow-dot{{width:7px;height:7px;border-radius:50%;background:var(--text-muted)}}
.dv3-date{{font-family:'JetBrains Mono',monospace;font-size:.78rem;color:var(--text-muted);letter-spacing:.08em;margin-bottom:.6rem;text-transform:uppercase}}
.dv3-spattr{{display:inline-flex;align-items:center;gap:.35rem;font-family:'JetBrains Mono',monospace;font-size:.7rem;font-weight:600;letter-spacing:.04em;color:var(--gold);text-decoration:none;padding:.3rem .65rem;border:1px solid rgba(218,165,32,.25);border-radius:4px;background:rgba(218,165,32,.04);margin-bottom:.85rem;transition:border-color .15s,background .15s,color .15s}}
.dv3-spattr:hover{{border-color:var(--gold);background:rgba(218,165,32,.10);color:var(--gold)}}
.dv3-spattr--house{{opacity:.75;color:var(--text-muted);border-color:var(--border)}}
.dv3-spattr--house:hover{{opacity:1;color:var(--gold);border-color:rgba(218,165,32,.4)}}
.dv3-spattr strong{{color:var(--text);font-weight:700}}
.dv3-headline{{font-family:'Oswald',sans-serif;font-size:clamp(2rem,4vw,3rem);font-weight:700;line-height:1.15;color:var(--text);margin-bottom:.6rem;letter-spacing:-.01em;text-transform:uppercase}}
.dv3-subheadline{{font-size:.92rem;color:var(--gold);font-weight:600;margin-bottom:.75rem}}
.dv3-lead{{font-size:1.05rem;line-height:1.75;color:var(--text-dim);max-width:720px}}
.dv3-surprise-banner{{display:none;align-items:center;gap:.6rem;padding:.65rem 1rem;background:linear-gradient(135deg,rgba(218,165,32,.06) 0%,rgba(240,145,58,.04) 100%);border:1px solid rgba(218,165,32,.20);border-radius:8px;margin-bottom:1.25rem}}
.dv3-surprise-banner .surprise-icon{{font-size:1.1rem;flex-shrink:0}}
.dv3-surprise-banner .surprise-text{{font-size:.85rem;color:var(--text-dim);line-height:1.45}}
.dv3-surprise-banner .surprise-text strong{{color:var(--gold);font-weight:700}}
.dv3-mood{{display:none;align-items:center;gap:.3rem;font-family:'JetBrains Mono',monospace;font-size:.62rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:.22rem .6rem;border-radius:3px;white-space:nowrap;margin-left:.75rem}}
.dv3-sparks{{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:.75rem;margin:0 0 1.5rem;padding:1rem;background:rgba(5,10,5,.35);border:1px solid var(--border);border-radius:8px}}
.dv3-spark{{display:flex;flex-direction:column;gap:.2rem}}
.dv3-spark-head{{display:flex;justify-content:space-between;align-items:baseline;gap:.4rem}}
.dv3-spark-label{{font-family:'JetBrains Mono',monospace;font-size:.62rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted)}}
.dv3-spark-last{{font-family:'JetBrains Mono',monospace;font-size:.78rem;font-weight:700;color:var(--text)}}
.dv3-topbar{{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:1.25rem;margin-bottom:2rem}}
.dv3-one-number{{background:var(--surface);border:2px solid var(--border-g);border-radius:8px;padding:1.2rem 1.4rem}}
.dv3-one-number-label{{font-family:'JetBrains Mono',monospace;font-size:.64rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--green);margin-bottom:.5rem}}
.dv3-one-number-val{{font-family:'Oswald',sans-serif;font-size:3.2rem;font-weight:700;color:var(--gold);line-height:1;margin-bottom:.15rem}}
.dv3-one-number-unit{{font-size:.85rem;color:var(--text-dim);margin-bottom:.4rem}}
.dv3-one-number-ctx{{font-size:.88rem;line-height:1.6;color:var(--text-dim)}}
.dv3-quote-card{{background:var(--surface);border:2px solid rgba(218,165,32,.15);border-radius:8px;padding:1.2rem 1.4rem;display:flex;flex-direction:column;justify-content:center}}
.dv3-quote-label{{font-family:'JetBrains Mono',monospace;font-size:.64rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--gold);margin-bottom:.6rem}}
.dv3-quote-text{{font-size:.95rem;font-style:italic;color:var(--text-dim);line-height:1.65;margin-bottom:.35rem}}
.dv3-quote-attr{{font-size:.76rem;color:var(--text-muted)}}
.dv3-sections{{display:flex;flex-direction:column;gap:1.25rem;margin-bottom:2rem}}
.dv3-sec{{background:var(--surface);border:2px solid var(--border);border-radius:8px;padding:1.2rem 1.4rem;position:relative;transition:border-color .2s}}
.dv3-sec:hover{{border-color:var(--border-g)}}
.dv3-sec--surprise{{border-color:rgba(218,165,32,.30)!important;background:linear-gradient(135deg,var(--surface) 0%,rgba(218,165,32,.03) 100%)}}
.dv3-sec--surprise::before{{content:'\u26A1 OVERNIGHT SURPRISE';position:absolute;top:-.55rem;right:.75rem;font-family:'JetBrains Mono',monospace;font-size:.5rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#fff;background:var(--gold);padding:.12rem .55rem;border-radius:2px}}
.dv3-sec--heat{{border-color:rgba(74,171,76,.35)!important}}
.dv3-sec--heat::after{{content:'\U0001F525 TOP STORY';position:absolute;top:-.55rem;left:.75rem;font-family:'JetBrains Mono',monospace;font-size:.5rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#fff;background:var(--green);padding:.12rem .55rem;border-radius:2px}}
.dv3-sec-header{{display:flex;align-items:center;gap:.55rem;margin-bottom:.65rem}}
.dv3-sec-icon{{font-size:1.3rem;flex-shrink:0}}
.dv3-sec-title{{font-family:'JetBrains Mono',monospace;font-size:.72rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--green);flex:1}}
.dv3-sec-conviction{{font-family:'JetBrains Mono',monospace;font-size:.55rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:.15rem .45rem;border-radius:3px;white-space:nowrap}}
.dv3-sec-body{{font-size:.95rem;line-height:1.75;color:var(--text-dim);margin-bottom:.65rem}}
.dv3-sec-body strong{{color:var(--text)}}
.dv3-sec-bottomline{{font-family:'JetBrains Mono',monospace;font-size:.78rem;font-weight:700;color:var(--text);padding:.5rem .75rem;background:var(--surface2);border-radius:6px;border-left:3px solid var(--gold);margin-bottom:.5rem;line-height:1.45}}
/* v4.3: takeaway card, committable statement, sits between lead and sparks */
.dv3-takeaway{{margin:1.1rem 0 0;padding:1rem 1.15rem;background:linear-gradient(135deg,rgba(218,165,32,.08) 0%,rgba(218,165,32,.02) 60%,var(--surface2) 100%);border:1px solid rgba(218,165,32,.3);border-left:4px solid var(--gold);border-radius:8px}}
.dv3-takeaway-label{{display:inline-block;font-family:'JetBrains Mono',monospace;font-size:.6rem;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--gold);margin-bottom:.45rem}}
.dv3-takeaway-text{{font-family:'Oswald',sans-serif;font-size:1.1rem;line-height:1.45;color:var(--text);margin:0;font-weight:600;letter-spacing:-.005em}}
@media(max-width:640px){{.dv3-takeaway-text{{font-size:1rem}}}}
/* v4.3: per-section vs_yesterday continuity chip */
.dv3-sec-vs{{display:flex;align-items:center;gap:.4rem;font-family:'JetBrains Mono',monospace;font-size:.66rem;color:var(--text-muted);margin:0 0 .55rem;padding:.3rem .55rem;background:rgba(74,143,186,.04);border-left:2px solid rgba(74,143,186,.32);border-radius:0 4px 4px 0}}
.dv3-sec-vs-icon{{color:#5aa0d2;font-size:.72rem;flex-shrink:0}}
.dv3-sec-vs-text{{font-weight:600;letter-spacing:.01em}}
/* v4.4: per-section catalyst (driver) chip */
.dv3-sec-catalyst{{display:flex;align-items:center;gap:.45rem;font-family:'JetBrains Mono',monospace;font-size:.66rem;color:var(--text-dim);margin:0 0 .55rem;padding:.35rem .6rem;background:rgba(218,165,32,.05);border-left:2px solid rgba(218,165,32,.4);border-radius:0 4px 4px 0;flex-wrap:wrap}}
.dv3-sec-catalyst-icon{{color:var(--gold);font-size:.72rem;flex-shrink:0}}
.dv3-sec-catalyst-label{{color:var(--gold);font-weight:700;letter-spacing:.12em;text-transform:uppercase;font-size:.6rem;flex-shrink:0}}
.dv3-sec-catalyst-text{{font-weight:500;letter-spacing:.01em;line-height:1.4}}
/* v4.4: outside_the_pit, news in the calculus, not in today's prices */
.dv3-otp{{background:var(--surface);border:1px solid var(--border);border-left:3px solid var(--gold);border-radius:8px;padding:1.2rem 1.4rem;margin-bottom:2rem}}
.dv3-otp-header{{display:flex;flex-direction:column;gap:.25rem;margin-bottom:1rem;padding-bottom:.85rem;border-bottom:1px solid var(--border)}}
.dv3-otp-label{{font-family:'JetBrains Mono',monospace;font-size:.68rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--gold)}}
.dv3-otp-sub{{font-size:.74rem;color:var(--text-muted);font-style:italic}}
.dv3-otp-grid{{display:grid;grid-template-columns:minmax(0,1fr);gap:1rem}}
@media(min-width:640px){{.dv3-otp-grid{{grid-template-columns:repeat(3,minmax(0,1fr))}}}}
.dv3-otp-item{{padding:.85rem 1rem;background:rgba(218,165,32,.03);border:1px solid rgba(218,165,32,.12);border-radius:6px;display:flex;flex-direction:column;gap:.4rem}}
.dv3-otp-tag{{display:inline-block;font-family:'JetBrains Mono',monospace;font-size:.58rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--gold);background:rgba(218,165,32,.08);padding:.2rem .55rem;border-radius:3px;align-self:flex-start;border:1px solid rgba(218,165,32,.22)}}
.dv3-otp-title{{font-size:.9rem;font-weight:700;color:var(--text);line-height:1.35}}
.dv3-otp-body{{font-size:.82rem;line-height:1.55;color:var(--text-dim)}}
/* v4.3: cash-bids inline conversion footer, weekday-only */
.dv3-cashbids-cta{{display:flex;align-items:center;gap:.65rem;padding:.85rem 1.15rem;background:rgba(74,171,76,.06);border:1px solid rgba(74,171,76,.22);border-radius:8px;margin:1rem 0 .65rem;text-decoration:none;color:var(--text);transition:border-color .15s,background .15s;min-height:44px}}
.dv3-cashbids-cta:hover{{border-color:var(--green);background:rgba(74,171,76,.10)}}
.dv3-cashbids-icon{{font-size:1.1rem;flex-shrink:0}}
.dv3-cashbids-text{{font-size:.88rem;line-height:1.4}}
.dv3-cashbids-text strong{{color:var(--text);font-weight:700}}
.dv3-cashbids-arrow{{color:var(--green);font-weight:700;margin-left:.2rem}}
.dv3-sec-action{{font-size:.82rem;font-weight:600;color:var(--green);padding:.45rem .7rem;background:rgba(74,171,76,.04);border:1px solid rgba(74,171,76,.15);border-radius:6px;line-height:1.45}}
.dv3-tmyk{{background:linear-gradient(135deg,var(--surface) 0%,rgba(74,143,186,.03) 100%);border:2px solid rgba(74,143,186,.20);border-radius:8px;padding:1.2rem 1.4rem;margin-bottom:2rem}}
.dv3-tmyk-label{{font-family:'JetBrains Mono',monospace;font-size:.68rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--blue);margin-bottom:.55rem}}
.dv3-tmyk-title{{font-size:1rem;font-weight:700;color:var(--text);margin-bottom:.35rem}}
.dv3-tmyk-body{{font-size:.92rem;line-height:1.75;color:var(--text-dim)}}
.dv3-watch{{background:var(--surface);border:2px solid var(--border);border-radius:8px;padding:1.2rem 1.4rem;margin-bottom:2rem}}
.dv3-watch-label{{font-family:'JetBrains Mono',monospace;font-size:.68rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--green);margin-bottom:.75rem}}
.dv3-watch-list{{list-style:none;padding:0;margin:0}}
.dv3-watch-item{{display:flex;gap:.75rem;align-items:flex-start;padding:.55rem 0;border-bottom:1px solid var(--border)}}
.dv3-watch-item:last-child{{border-bottom:none;padding-bottom:0}}
.dv3-watch-time{{font-family:'JetBrains Mono',monospace;color:var(--gold);font-weight:600;font-size:.85rem;white-space:nowrap;flex-shrink:0;min-width:72px}}
.dv3-watch-desc{{color:var(--text-dim);font-size:.88rem;line-height:1.55}}
.dv3-watch-desc strong{{color:var(--text)}}
.dv3-share{{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;margin:1.5rem 0 1rem;padding:.85rem 0;border-top:1px solid var(--border);border-bottom:1px solid var(--border)}}
.dv3-share-label{{font-family:'JetBrains Mono',monospace;font-size:.64rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--text-muted);margin-right:.35rem}}
.dv3-share-btn{{display:inline-flex;align-items:center;gap:.35rem;font-family:'JetBrains Mono',monospace;font-size:.74rem;font-weight:700;padding:.45rem .85rem;background:var(--surface2);border:1px solid var(--border);border-radius:6px;color:var(--text-dim);cursor:pointer;transition:border-color .15s,color .15s;min-height:38px;touch-action:manipulation}}
.dv3-share-btn:hover{{border-color:var(--gold);color:var(--text)}}
.dv3-share-btn svg{{flex-shrink:0}}
.dv3-archnav{{display:flex;justify-content:space-between;align-items:center;gap:.75rem;flex-wrap:wrap;margin:.4rem 0 1.2rem}}
.dv3-archnav-a{{font-family:'JetBrains Mono',monospace;font-size:.72rem;font-weight:700;color:var(--text-dim);padding:.45rem .7rem;border:1px solid var(--border);border-radius:6px;min-height:38px;display:inline-flex;align-items:center}}
.dv3-archnav-a:hover{{border-color:var(--gold);color:var(--text)}}
.dv3-archnav-all{{color:var(--text-muted)}}
.dv3-source{{font-size:.68rem;color:var(--text-muted);text-align:center;padding:.75rem 0;border-top:1px solid var(--border);margin-bottom:2rem}}
.dv3-nav{{display:flex;justify-content:space-between;align-items:center;padding:1rem 0;border-top:2px solid var(--border);border-bottom:2px solid var(--border);margin-bottom:2rem}}
.dv3-nav a{{display:inline-flex;align-items:center;gap:.35rem;font-size:.85rem;font-weight:600;color:var(--green);transition:opacity .15s}}
.dv3-nav a:hover{{opacity:.8}}
.dv3-nav-center{{font-family:'JetBrains Mono',monospace;font-size:.68rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.1em}}
.dv3-sponsor{{background:linear-gradient(135deg,var(--surface) 0%,rgba(218,165,32,.04) 100%);border:2px solid rgba(218,165,32,.30);border-radius:8px;padding:1.4rem 1.6rem;margin-bottom:1.75rem;position:relative;overflow:hidden}}
.dv3-sponsor::before{{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,var(--gold) 0%,rgba(218,165,32,.3) 60%,transparent 100%)}}

/* WEEKLY THREAD chapter marker, sits above the lead */
.dv3-thread{{display:flex;align-items:center;gap:.65rem;padding:.45rem .85rem;background:rgba(74,143,186,.06);border:1px solid rgba(74,143,186,.20);border-radius:6px;margin-bottom:1rem;flex-wrap:wrap}}
.dv3-thread--anchor{{background:rgba(74,143,186,.10);border-color:rgba(74,143,186,.32)}}
.dv3-thread-day{{font-family:'JetBrains Mono',monospace;font-size:.6rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#5aa0d2;white-space:nowrap;padding:.18rem .5rem;background:rgba(74,143,186,.08);border-radius:3px}}
.dv3-thread-q{{font-size:.86rem;font-weight:600;color:var(--text);line-height:1.4;flex:1;min-width:200px}}

/* YESTERDAY'S CALL, sits between sponsor and sections */
.dv3-yc{{background:var(--surface);border:2px solid var(--border);border-radius:8px;padding:1rem 1.2rem;margin-bottom:1.5rem;border-left:4px solid var(--green)}}
.dv3-yc-label{{font-family:'JetBrains Mono',monospace;font-size:.66rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--text-muted);margin-bottom:.45rem;display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}}
.dv3-yc-outcome{{font-family:'JetBrains Mono',monospace;font-size:.6rem;font-weight:700;letter-spacing:.08em;padding:.18rem .55rem;border-radius:3px;white-space:nowrap}}
.dv3-yc-summary{{font-size:.92rem;color:var(--text);line-height:1.65;font-weight:600;margin-bottom:.35rem}}
.dv3-yc-note{{font-size:.85rem;color:var(--text-dim);line-height:1.65}}

/* SPREAD TO WATCH, sits between sections and basis */
.dv3-spread{{background:linear-gradient(135deg,var(--surface) 0%,rgba(132,89,176,.04) 100%);border:2px solid rgba(132,89,176,.28);border-radius:8px;padding:1.1rem 1.3rem;margin:1.5rem 0 1.5rem}}
.dv3-spread-label{{font-family:'JetBrains Mono',monospace;font-size:.68rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#9b7fc4;margin-bottom:.5rem}}
.dv3-spread-label-text{{font-family:'Oswald',sans-serif;font-size:1.15rem;font-weight:700;color:var(--text);line-height:1.3;margin-bottom:.3rem;letter-spacing:-.005em}}
.dv3-spread-level{{font-family:'JetBrains Mono',monospace;font-size:.86rem;font-weight:700;color:var(--gold);margin-bottom:.5rem;letter-spacing:.02em}}
.dv3-spread-body{{font-size:.9rem;line-height:1.7;color:var(--text-dim)}}
.dv3-spread-body strong{{color:var(--text)}}

.dv3-sponsor--house{{border-style:dashed;border-color:rgba(218,165,32,.34)}}
.dv3-sponsor-label-row{{display:flex;align-items:center;justify-content:space-between;gap:.6rem;margin-bottom:.65rem;flex-wrap:wrap}}
.dv3-sponsor-label{{font-family:'JetBrains Mono',monospace;font-size:.6rem;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:var(--gold);padding:.2rem .6rem;border:1px solid rgba(218,165,32,.42);border-radius:3px;background:rgba(218,165,32,.06)}}
.dv3-sponsor-by{{font-family:'JetBrains Mono',monospace;font-size:.7rem;font-weight:600;color:var(--text-muted);letter-spacing:.04em}}
.dv3-sponsor-headline{{font-family:'Oswald',sans-serif;font-size:1.2rem;font-weight:700;color:var(--text);line-height:1.3;margin-bottom:.6rem;letter-spacing:-.005em}}
.dv3-sponsor-body{{font-size:.93rem;line-height:1.7;color:var(--text-dim);margin-bottom:.95rem}}
.dv3-sponsor-cta{{display:inline-flex;align-items:center;gap:.4rem;font-family:'JetBrains Mono',monospace;font-size:.78rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;text-decoration:none;color:#0a1a0a;background:var(--gold);padding:.65rem 1.05rem;border-radius:6px;transition:background .15s,transform .1s;min-height:44px}}
.dv3-sponsor-cta:hover{{background:#c9941d;transform:translateY(-1px)}}
.dv3-sponsor-disclosure{{font-size:.66rem;color:var(--text-muted);margin-top:.7rem;letter-spacing:.02em;line-height:1.5}}
.dv3-basis{{background:linear-gradient(135deg,var(--surface) 0%,rgba(185,122,58,.04) 100%);border:2px solid rgba(185,122,58,.28);border-radius:8px;padding:1.2rem 1.4rem;margin-bottom:2rem}}
.dv3-basis-label{{font-family:'JetBrains Mono',monospace;font-size:.68rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#c98a4a;margin-bottom:.55rem}}
.dv3-basis-headline{{font-size:1rem;font-weight:700;color:var(--text);margin-bottom:.4rem;line-height:1.4}}
.dv3-basis-body{{font-size:.92rem;line-height:1.75;color:var(--text-dim)}}
.dv3-basis-body strong{{color:var(--text)}}
.dv3-forward{{display:flex;align-items:center;gap:1rem;padding:1rem 1.2rem;background:rgba(58,139,60,.05);border:1px solid rgba(58,139,60,.22);border-radius:8px;margin:1.25rem 0 .75rem;flex-wrap:wrap}}
.dv3-forward-icon{{font-size:1.5rem;flex-shrink:0;line-height:1}}
.dv3-forward-content{{flex:1;min-width:200px}}
.dv3-forward-headline{{font-size:.95rem;font-weight:700;color:var(--text);line-height:1.3;margin-bottom:.18rem}}
.dv3-forward-sub{{font-size:.82rem;color:var(--text-dim);line-height:1.5}}
.dv3-forward-cta{{display:inline-flex;align-items:center;gap:.35rem;font-family:'JetBrains Mono',monospace;font-size:.74rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;text-decoration:none;color:#fff;background:var(--green);padding:.55rem .95rem;border-radius:6px;transition:background .15s;min-height:42px;white-space:nowrap}}
.dv3-forward-cta:hover{{background:#1b4d1c}}
.dv3-byline{{font-size:.86rem;color:var(--text-dim);line-height:1.65;padding:.85rem 0;border-top:1px solid var(--border);margin-top:.5rem}}
.dv3-byline strong{{color:var(--text);font-weight:700}}
.dv3-byline a{{color:var(--gold);text-decoration:none}}
.dv3-byline a:hover{{text-decoration:underline}}
@media(max-width:640px){{.dv3-page{{padding:1.25rem .9rem}}.dv3-topbar{{grid-template-columns:minmax(0,1fr)}}.dv3-one-number-val{{font-size:2.4rem}}.dv3-sec{{padding:.85rem 1rem}}.dv3-sponsor{{padding:1.1rem 1.2rem}}.dv3-sponsor-headline{{font-size:1.05rem}}.dv3-forward{{flex-direction:column;align-items:flex-start;gap:.7rem}}.dv3-forward-cta{{width:100%;justify-content:center}}}}
@media(max-width:380px){{.dv3-headline{{font-size:1.6rem}}.dv3-one-number-val{{font-size:2rem}}.dv3-sec-action{{display:none}}}}
</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<div id="site-header"></div>
<main id="main" tabindex="-1">
<div class="dv3-page">
  <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a> / <a href="/daily">Daily Briefing</a> / <strong>{html_esc(date_display)}</strong></nav>
  <article>
    <header class="dv3-header">
      <div style="display:flex;align-items:center;flex-wrap:wrap;gap:.5rem">
        <div class="dv3-eyebrow"><span class="dv3-eyebrow-dot"></span> AGSIST DAILY{issue_suffix} &mdash; ARCHIVE</div>
        {mood_html}
        {weekend_badge}
      </div>
      <div class="dv3-date">{html_esc(date_display)}</div>
      {sponsor_attr_html}
      <h1 class="dv3-headline">{headline}</h1>
      {"<p class='dv3-subheadline'>" + subheadline + "</p>" if subheadline else ""}
      {thread_html}
      {surprise_html}
      <p class="dv3-lead">{lead}</p>
      {takeaway_html}
    </header>
    {sparks_html}
    {topbar_html}
    {sponsor_html}
    {yc_html}
    <div class="dv3-sections">{sections_html}</div>
    {spread_html}
    {basis_html}
    {tmyk_html}
    {watch_html}
    {outside_pit_html}
    {byline_html}
    {cashbids_html}
    {forward_html}
    {share_html}
    {archive_nav_html}
    <div class="dv3-source">{source} &middot; Auto-compiled at 6:02 AM CT</div>
  </article>
  <nav class="dv3-nav" aria-label="Briefing navigation" id="dv3-archive-nav">
    <span></span>
    <span class="dv3-nav-center"><a href="/daily">&larr; Latest Briefing</a></span>
    <span></span>
  </nav>
  <div style="text-align:center;padding:1.5rem 0">
    <a href="/daily" class="btn-gold">Today's Briefing &rarr;</a>
    <div style="margin-top:.75rem"><a href="/daily#archive" style="font-size:.82rem;color:var(--text-muted)">Browse All Briefings &rarr;</a></div>
  </div>
</div>
</main>
<div id="site-footer"></div>
<script src="/components/loader.js" defer></script>
<script>
(function(){{
  fetch('/data/daily-archive/index.json',{{cache:'no-store'}}).then(function(r){{return r.ok?r.json():null;}}).then(function(idx){{
    if(!idx||!idx.briefings)return;
    var current='{date_iso}';
    var entries=idx.briefings;
    var curIdx=-1;
    for(var i=0;i<entries.length;i++){{if(entries[i].date===current){{curIdx=i;break;}}}}
    if(curIdx<0)return;
    var nav=document.getElementById('dv3-archive-nav');
    if(!nav)return;
    var prev=curIdx<entries.length-1?entries[curIdx+1]:null;
    var next=curIdx>0?entries[curIdx-1]:null;
    var spans=nav.querySelectorAll('span');
    if(prev&&spans[0])spans[0].innerHTML='<a href="/daily/'+prev.date+'">\u2190 '+prev.date+'</a>';
    if(next&&spans[2])spans[2].innerHTML='<a href="/daily/'+next.date+'">'+next.date+' \u2192</a>';
  }}).catch(function(){{}});
  var permalink='{js_permalink}';
  var headline='{js_headline}';
  var dateDisplay='{js_datedisp}';
  var btns=document.querySelectorAll('.dv3-share-btn');
  Array.prototype.forEach.call(btns,function(btn){{
    btn.addEventListener('click',function(){{
      var kind=btn.getAttribute('data-share');
      if(kind==='twitter'){{
        var text=encodeURIComponent('AGSIST Daily '+dateDisplay+': '+headline);
        var url=encodeURIComponent(permalink);
        window.open('https://twitter.com/intent/tweet?text='+text+'&url='+url,'_blank','noopener,noreferrer');
      }} else if(kind==='copy'){{
        var doCopy=function(){{
          if(navigator.clipboard&&navigator.clipboard.writeText){{return navigator.clipboard.writeText(permalink);}}
          return new Promise(function(res,rej){{
            var ta=document.createElement('textarea');
            ta.value=permalink;ta.style.position='fixed';ta.style.opacity='0';
            document.body.appendChild(ta);ta.select();
            try{{document.execCommand('copy');res();}}catch(e){{rej(e);}}
            document.body.removeChild(ta);
          }});
        }};
        doCopy().then(function(){{
          var orig=btn.innerHTML;
          btn.innerHTML='\u2713 Copied';
          setTimeout(function(){{btn.innerHTML=orig;}},1500);
        }}).catch(function(){{prompt('Copy this link:',permalink);}});
      }} else if(kind==='email'){{
        var subj=encodeURIComponent('AGSIST Daily '+dateDisplay+': '+headline);
        var body=encodeURIComponent(headline+'\\n\\n'+permalink+'\\n\\nFrom AGSIST (https://agsist.com/daily)');
        window.location.href='mailto:?subject='+subj+'&body='+body;
      }}
    }});
  }});
}})();
</script>
</body>
</html>"""
    return page


def update_archive_index(briefing, date_iso):
    index_path = ARCHIVE_JSON_DIR / "index.json"
    if index_path.exists():
        with open(index_path) as f: index = json.load(f)
    else:
        index = {"briefings": [], "updated": ""}
    entries = index.get("briefings", [])
    headline = briefing.get("headline", "")
    teaser = briefing.get("teaser", "")
    if not teaser and briefing.get("lead"):
        teaser = briefing["lead"][:140] + ("..." if len(briefing.get("lead", "")) > 140 else "")
    meta = briefing.get("meta", {})
    entry = {"date": date_iso, "date_display": briefing.get("date", date_iso),
             "headline": headline, "teaser": teaser,
             "market_mood": meta.get("market_mood", ""),
             "surprise_count": meta.get("overnight_surprises_count", 0),
             "sections": len(briefing.get("sections", [])),
             "url": f"/daily/{date_iso}",
             "market_closed": briefing.get("market_closed", False)}
    # v4.1: surface YC outcome on archive entries for the homepage grid dots
    yc = briefing.get("yesterdays_call") or {}
    if yc.get("outcome") and yc.get("summary"):
        entry["yc_outcome"] = yc["outcome"]  # played_out | didnt | pending
    found = False
    for i, e in enumerate(entries):
        if e.get("date") == date_iso:
            entries[i] = entry; found = True; break
    if not found: entries.insert(0, entry)
    entries.sort(key=lambda x: x.get("date", ""), reverse=True)
    index["briefings"] = entries
    index["updated"] = datetime.now(timezone.utc).isoformat()
    index["count"] = len(entries)
    with open(index_path, "w") as f:
        json.dump(index, f, indent=2, ensure_ascii=False)
    return len(entries)


def save_archive(briefing):
    date_iso = datetime.now().strftime("%Y-%m-%d")
    ARCHIVE_JSON_DIR.mkdir(parents=True, exist_ok=True)
    ARCHIVE_HTML_DIR.mkdir(parents=True, exist_ok=True)
    json_path = ARCHIVE_JSON_DIR / f"{date_iso}.json"
    with open(json_path, "w") as f:
        json.dump(briefing, f, indent=2, ensure_ascii=False)
    print(f"  Archive JSON: {json_path}")
    prev_d, next_d = archive_neighbor_dates(date_iso)
    html_content = generate_archive_html(briefing, date_iso, prev_d, next_d)
    html_path = ARCHIVE_HTML_DIR / f"{date_iso}.html"
    with open(html_path, "w") as f: f.write(html_content)
    print(f"  Archive HTML: {html_path}")
    # Re-render yesterday's page so its "next" link points at today.
    if prev_d:
        try:
            with open(ARCHIVE_JSON_DIR / f"{prev_d}.json") as pf:
                prev_briefing = json.load(pf)
            pp, pn = archive_neighbor_dates(prev_d)
            with open(ARCHIVE_HTML_DIR / f"{prev_d}.html", "w") as pf:
                pf.write(generate_archive_html(prev_briefing, prev_d, pp, pn))
            print(f"  Re-rendered {prev_d} (next -> {date_iso})")
        except Exception as e:
            print(f"  [warn] could not re-render {prev_d}: {e}")
    count = update_archive_index(briefing, date_iso)
    print(f"  Archive index: {count} briefings")


def sanitize_em_dashes(briefing):
    """v4.4.1: post-generation safety net for em/en dashes.

    The prompt explicitly bans em dashes (Writing Rule 1). v4.4 still
    produced 10 of them in one run, almost certainly because the prompt
    itself contained 60+ em dashes the model pattern-matched on. v4.4.1
    strips em dashes from the prompt source AND adds this sweep so any
    leftover gets cleaned before publish.

    Replacement: space-bracketed em dash becomes ", " (mid-sentence beat).
    Bare em dash becomes a hyphen. Hyphens, en dashes inside numeric
    ranges, and other characters are untouched."""
    def clean(s):
        if not isinstance(s, str):
            return s
        return (s.replace(" \u2014 ", ", ")
                 .replace("\u2014", "-")
                 .replace(" \u2013 ", ", ")
                 .replace("\u2013", "-"))

    def walk(obj):
        if isinstance(obj, dict):
            for k, v in obj.items():
                obj[k] = walk(v)
            return obj
        if isinstance(obj, list):
            return [walk(item) for item in obj]
        if isinstance(obj, str):
            return clean(obj)
        return obj

    walk(briefing)
    return briefing


# v4.5.0: BODY FIELDS that may contain prose with bold emphasis. The
# sanitize_html_tags walker only converts <strong>/<em> in these fields,
# leaving the rest of the briefing untouched (icons, IDs, etc).
_BOLD_BODY_FIELDS = {
    "lead", "subheadline", "the_takeaway", "teaser",
    "body", "bottom_line", "vs_yesterday", "catalyst",
    "context", "commentary", "status_text", "note", "summary",
}


def sanitize_html_tags(briefing):
    """v4.5.0: convert any literal <strong>...</strong> or <em>...</em>
    HTML tags in body fields to **markdown** equivalents.

    The model has historically emitted <strong> in body JSON fields
    despite the prompt asking for markdown. The frontend mdInline()
    helper (daily.html v4.4.2, index.html v4.4.2) handles either format
    so user-facing rendering is unaffected, but storing markdown in the
    JSON keeps the source of truth clean and prevents downstream
    consumers (email pipeline, RSS, AI crawlers) from having to do the
    same conversion.

    Only operates on the recognized body fields (_BOLD_BODY_FIELDS).
    Leaves headline, icon, label, and structural fields untouched.
    Idempotent: running twice produces the same result as once."""
    strong_re = re.compile(r"<strong>(.+?)</strong>", re.DOTALL | re.IGNORECASE)
    em_re = re.compile(r"<em>(.+?)</em>", re.DOTALL | re.IGNORECASE)

    def clean(s):
        if not isinstance(s, str):
            return s
        s = strong_re.sub(r"**\1**", s)
        s = em_re.sub(r"*\1*", s)
        return s

    def walk(obj):
        if isinstance(obj, dict):
            for k, v in obj.items():
                if k in _BOLD_BODY_FIELDS and isinstance(v, str):
                    obj[k] = clean(v)
                else:
                    obj[k] = walk(v)
            return obj
        if isinstance(obj, list):
            return [walk(item) for item in obj]
        return obj

    walk(briefing)
    return briefing


# v4.6.1: DRAMA VERB SCRUBBER. Deterministic catch-all that runs AFTER the
# critic rewrite, before save_briefing(). The critic rewrites the single
# weakest_target per pass (lead OR section_N OR basis OR ...), which means
# drama verbs in headlines, section titles, takeaways, TMYK titles, and the
# Number unit text can survive the critic pass. The critic also cannot rewrite
# the headline at all (not in the weakest_target enum). This scrubber catches
# every banned drama verb in every text field, deterministically, with no
# model judgment.
#
# Design choices:
# - Word-boundary regex prevents matching inside compounds (uncrashed, etc.)
# - Verb forms only: "crashed" matches, "crash" the noun in "the crash of 2020"
#   is preserved (no -ed/-ing/-es suffix means likely noun, leave it).
# - Case preserving: "CRATER" in headline becomes "FALL HARD" (upper).
#   "Crater" becomes "Fall hard" (title). "crater" becomes "fall hard" (lower).
# - Idempotent: replacements never reintroduce banned words.
# - Walks ALL text fields, not just body fields. Headlines/titles included.
# - Records substitutions made for audit logging.
_DRAMA_SUBSTITUTIONS = [
    # (pattern, replacement) - replacement is lowercase form;
    # case is restored from the matched span by _drama_sub_case_preserve.
    # Pattern uses \b word boundaries on BOTH sides and requires verb form.

    # CRASH family
    (r"\bcrashed\b", "fell sharply"),
    (r"\bcrashes\b", "falls sharply"),
    (r"\bcrashing\b", "falling sharply"),
    # Bare "crash" used as verb in headline-shorthand: "HOGS CRASH 6%", "CATTLE CRASH"
    # Verb interpretation is dominant in briefing context. "The crash of 2020" type
    # noun usage doesn't appear in this generator's vocabulary.
    (r"\bcrash\b", "fall"),

    # CRATER family (all forms - "crater" in price context is always verb/drama)
    (r"\bcratered\b", "fell sharply"),
    (r"\bcraters\b", "falls sharply"),
    (r"\bcratering\b", "falling sharply"),
    (r"\bcrater\b", "fall sharply"),

    # EXPLODE family
    (r"\bexploded\b", "ran higher"),
    (r"\bexplodes\b", "runs higher"),
    (r"\bexploding\b", "running higher"),
    (r"\bexplode\b", "run higher"),
    (r"\bexplosion\b", "sharp gain"),

    # SURGE family
    (r"\bsurged\b", "gained"),
    (r"\bsurges\b", "gains"),
    (r"\bsurging\b", "gaining"),
    (r"\bsurge\b", "move higher"),

    # SOAR family
    (r"\bsoared\b", "moved higher"),
    (r"\bsoars\b", "moves higher"),
    (r"\bsoaring\b", "moving higher"),
    (r"\bsoar\b", "rise"),

    # ROCKET / SKYROCKET
    (r"\brocketed\b", "ran higher"),
    (r"\brocketing\b", "running higher"),
    (r"\bskyrocketed\b", "ran higher"),
    (r"\bskyrocketing\b", "running higher"),

    # PLUNGE family
    (r"\bplunged\b", "fell"),
    (r"\bplunges\b", "falls"),
    (r"\bplunging\b", "falling"),
    (r"\bplunge\b", "drop"),

    # PLUMMET family
    (r"\bplummeted\b", "fell sharply"),
    (r"\bplummets\b", "falls sharply"),
    (r"\bplummeting\b", "falling sharply"),

    # SPIKE family - flagged as headline failure on 2026-05-28 (hogs spike 2%)
    # "Spike" verb form is drama; "spike" noun ("a spike in volatility") is fine
    # but rare in briefing language. Bare form treated as verb here.
    (r"\bspiked\b", "gained"),
    (r"\bspikes\b", "gains"),
    (r"\bspiking\b", "gaining"),
    (r"\bspike\b", "move higher"),

    # JUMP / JUMPS (verb form only - drama in headline/lead context)
    # The editorial-notes May 28 entry flagged "jumped" in lead specifically.
    (r"\bjumped\b", "gained"),
    (r"\bjumps\b", "gains"),
    (r"\bjumping\b", "gaining"),

    # TUMBLE - "tumble" is in my replacement vocabulary so this is intentionally NOT scrubbed.
    # It's working-ag voice for big drops, distinct from CNBC "crash/plunge/crater".

    # SLASH (verb form only, "slash" as noun e.g. "/" preserved)
    (r"\bslashed\b", "cut"),
    (r"\bslashes\b", "cuts"),
    (r"\bslashing\b", "cutting"),

    # COLLAPSE family
    (r"\bcollapsed\b", "broke down"),
    (r"\bcollapses\b", "breaks down"),
    (r"\bcollapsing\b", "breaking down"),
    (r"\bcollapse\b", "breakdown"),

    # ROUT
    (r"\brout\b", "selling"),
    (r"\brouted\b", "sold off"),

    # EXODUS / FLEEING / PANIC
    (r"\bexodus\b", "stepping out"),
    (r"\bfleeing\b", "rotating out"),
    (r"\bpanic\b", "selling pressure"),
    (r"\bpanicked\b", "stepped out"),

    # IGNITED / CAUGHT FIRE / TORCHED
    (r"\bignited\b", "started"),
    (r"\bignites\b", "starts"),
    (r"\bigniting\b", "starting"),
    (r"\bignite\b", "kick off"),
    (r"\btorched\b", "broke"),
    (r"\btorches\b", "breaks"),

    # BLOODBATH / CARNAGE / MELTDOWN
    (r"\bbloodbath\b", "heavy selling"),
    (r"\bcarnage\b", "heavy selling"),
    (r"\bmeltdown\b", "selloff"),

    # VAULTED / LEAPED
    (r"\bvaulted\b", "moved up"),
    (r"\bleaped\b", "moved up"),
    (r"\bleapt\b", "moved up"),

    # CAUGHT FIRE (multi-word - must come before single-word patterns)
    (r"\bcaught fire\b", "took off"),

    # BINARY (already in critic ban list, mechanically scrub anyway)
    (r"\bbinary level\b", "make-or-break level"),
    (r"\bbinary week\b", "make-or-break week"),
    (r"\bbinary support\b", "key support"),
    (r"\bbinary test\b", "make-or-break test"),
    (r"\bbinary\b", "make-or-break"),
]

# Pre-compile patterns once
_DRAMA_COMPILED = [(re.compile(pat, re.IGNORECASE), repl) for pat, repl in _DRAMA_SUBSTITUTIONS]


def _drama_sub_case_preserve(match, replacement):
    """Match case of the original token: upper -> upper, title -> title, lower -> lower.
    For multi-word replacements, applies case to first word; subsequent words follow
    the same case style if the match was all-caps, otherwise lowercase."""
    matched = match.group(0)
    if matched.isupper():
        return replacement.upper()
    if matched[0].isupper() and matched[1:].islower():
        # Title case: capitalize first letter only
        return replacement[0].upper() + replacement[1:].lower()
    return replacement.lower()


# Fields where we walk and scrub. Includes EVERY text-bearing field, not just
# body fields, because drama verbs in headlines/titles are exactly the failure
# mode the critic cannot fix.
_SCRUBBED_FIELDS = {
    # Top-level
    "headline", "subheadline", "lead", "subhead",
    "the_takeaway", "teaser", "title", "label", "name",
    # Section fields
    "body", "bottom_line", "vs_yesterday", "catalyst", "driver",
    "context", "commentary", "note", "status_text", "summary",
    "farmer_action", "action", "story",
    # Watch list / spread / basis
    "headline", "commentary", "question",
    # The Number
    "value", "unit", "explanation",
    # TMYK
    "title", "body",
    # Outside the Pit
    "headline", "summary",
    # Misc
    "call", "outcome_note", "level",
}


def scrub_drama_verbs(briefing):
    """v4.6.1: deterministic post-pass to remove banned CNBC drama verbs from
    every text field in the briefing. Runs AFTER the critic rewrite, before
    save_briefing(), as a belt-and-suspenders catch for fields the critic
    cannot rewrite (headlines, section titles) or chose not to rewrite (the
    critic rewrites only ONE weakest_target per pass).

    Records all substitutions made and prints a summary for the workflow log.
    Returns (modified_briefing, substitution_log) where log is a list of
    dicts: [{field_path, before_phrase, after_phrase}, ...].

    Idempotent: running this twice produces the same result as running once,
    because the replacements never reintroduce banned words.

    Case-preserving: handles UPPER, Title, and lower case input correctly.
    Headline "HOGS CRATER 6%" becomes "HOGS SHARP DROP 6%" (preserves caps).
    """
    log = []

    def scrub_string(s, field_path):
        if not isinstance(s, str) or not s:
            return s
        original = s
        for pattern, replacement in _DRAMA_COMPILED:
            def _sub(m):
                substituted = _drama_sub_case_preserve(m, replacement)
                log.append({
                    "field": field_path,
                    "before": m.group(0),
                    "after": substituted,
                })
                return substituted
            s = pattern.sub(_sub, s)
        return s

    def walk(obj, path="$"):
        if isinstance(obj, dict):
            for k, v in obj.items():
                child_path = f"{path}.{k}"
                if isinstance(v, str) and k in _SCRUBBED_FIELDS:
                    obj[k] = scrub_string(v, child_path)
                else:
                    obj[k] = walk(v, child_path)
            return obj
        if isinstance(obj, list):
            return [walk(item, f"{path}[{i}]") for i, item in enumerate(obj)]
        return obj

    walk(briefing)

    if log:
        print(f"  [v4.6.1 scrubber] applied {len(log)} drama-verb substitution(s):")
        # Group by field for readable output
        from collections import defaultdict
        by_field = defaultdict(list)
        for entry in log:
            by_field[entry["field"]].append((entry["before"], entry["after"]))
        for field, subs in by_field.items():
            print(f"    {field}: " + ", ".join(f"\"{b}\" -> \"{a}\"" for b, a in subs))
    else:
        print(f"  [v4.6.1 scrubber] no drama verbs found, briefing clean")

    return briefing, log


# v4.5.0: lookup table mapping commodity keywords found in prose to the
# locked_prices key. Only includes commodities Sigurd's audience trades
# in dollar-level support/resistance terms. Grain levels (per-bushel) and
# livestock levels (per-cwt) are the high-risk surface for false break
# claims; energy and milk get added defensively. Order matters - more
# specific words first so "feeder cattle" wins over generic "cattle".
_LEVEL_COMMODITY_KEYWORDS = [
    ("feeder cattle", "feeder_cattle"),
    ("feeders", "feeder_cattle"),
    ("live cattle", "live_cattle"),
    ("lean hogs", "hogs"),
    ("class iii milk", "milk"),
    ("natural gas", "natgas"),
    ("natgas", "natgas"),
    ("cattle", "live_cattle"),
    ("hogs", "hogs"),
    ("corn", "corn"),
    ("soybeans", "beans"),
    ("soybean", "beans"),
    ("beans", "beans"),
    ("wheat", "wheat"),
    ("crude", "crude"),
    ("oil", "crude"),
    ("milk", "milk"),
]

# Words that, when found preceding "$X" in close proximity, claim the
# close is BELOW the level. Pairing a "below" claim with a close ABOVE
# the level is the failure mode (see Monday 2026-05-04: cattle close $253,
# headline claimed broke $252).
_BREAK_BELOW_VERBS = (
    "broke", "broken", "breaking", "break", "breaks",
    "breach", "breached", "breaches",
    "below", "under", "beneath",
    "fell through", "lost", "crashed through", "crashed below",
    "fell below", "dropped below", "dropped through",
    "decisively below", "decisively through",
)

# Words claiming the close is ABOVE the level. Pairing an "above" claim
# with a close BELOW the level is the inverse failure mode.
_BREAK_ABOVE_VERBS = (
    "above", "over", "reclaimed", "defended",
    "held above", "back above", "rallied through",
    "decisively above",
)


def _find_close_for_text(text_window, locked_prices):
    """Given a slice of prose, return the locked close that matches the
    commodity referenced in that slice, or None if no match."""
    tw = text_window.lower()
    for keyword, lp_key in _LEVEL_COMMODITY_KEYWORDS:
        if keyword in tw:
            close = locked_prices.get(lp_key)
            if close and close > 0:
                return lp_key, float(close)
    return None, None


# v4.5.0: tense markers that signal a level claim is NOT about today's
# close. When any of these appear in the window around a verb+level
# match, the validator skips the contradiction check.
#
# This prevents false positives on:
#   - Saturday retrospective prose ("held above $258 Wednesday" with
#     Friday close $253: claim is past-tense, not a today contradiction).
#   - Sunday forecast prose ("if cattle break $250 next week" with
#     current close $253: claim is conditional, not a now contradiction).
#   - Mid-week continuity references ("Monday's break of $252 still in
#     play"): the validator can't verify Monday's close from
#     locked_prices, so soften by skipping rather than flagging.
#
# Cost: a Saturday recap that falsely claims a Friday break which the
# Friday close contradicts will get caught only if it's stated in
# present-tense, header, or lead form (which is the loud failure mode
# we actually care about).
_TENSE_SKIP_MARKERS = (
    # Conditional / forecast
    " if ", " if,", " if cattle ", " if corn ", " if beans ", " if wheat ",
    " would ", " could ", " should ", " might ", " may ",
    "next week", "this week's", "watch for", "looking for",
    "needs to", "has to", "would target", "could test",
    # Retrospective day markers (past-tense relative to today)
    "monday", "tuesday", "wednesday", "thursday",
    "midweek", "mid-week", "midweek's", "mid-week's",
    "earlier this week", "early in the week",
    "last week", "prior week",
)


def _has_tense_skip_marker(window):
    """Return True if any tense-skip marker appears in the window."""
    w = window.lower()
    return any(m in w for m in _TENSE_SKIP_MARKERS)


def validate_level_coherence(briefing, locked_prices):
    """v4.5.0: deterministic check for the math contradiction class
    (close above $X paired with claim that the level was broken).

    Scans body prose for patterns like 'broke $252' or 'above $250',
    matches the cited level against the locked close for the surrounding
    commodity, and warns when they contradict.

    Tolerance: 0.2% slack on the level comparison. At a $250 level that's
    50 cents - tight enough to catch the Monday 2026-05-04 contradiction
    (close $253 vs claim 'below $252', $1.00 differential) but loose
    enough to allow editorial framing like 'broke $250' when the close
    is $250.05 (5 cent differential, ~0.02% off the level).

    Returns a list of human-readable warnings (empty if all coherent)."""
    if not locked_prices:
        return []

    warnings = []
    parts = []

    # Build (text, location_label) tuples for each scannable field. Keep
    # the surrounding context tight so commodity inference works - we
    # don't want a section about cattle to inherit a level claim from a
    # different section's prose.
    for field in ("headline", "subheadline", "lead", "the_takeaway"):
        v = briefing.get(field, "")
        if isinstance(v, str) and v:
            parts.append((v, field))
    one_num = briefing.get("one_number") or {}
    if isinstance(one_num, dict):
        ctx = one_num.get("context", "")
        if isinstance(ctx, str) and ctx:
            parts.append((ctx, "one_number.context"))
    for i, sec in enumerate(briefing.get("sections", []) or []):
        if not isinstance(sec, dict):
            continue
        title = sec.get("title", "")
        for fname in ("body", "bottom_line", "catalyst", "vs_yesterday"):
            v = sec.get(fname, "")
            if isinstance(v, str) and v:
                # Carry the section title forward as commodity context;
                # it often names the commodity even when the body is
                # mid-sentence.
                parts.append((f"{title}. {v}", f"section[{i}].{fname}"))
    # yesterdays_call.{summary,note} are deliberately NOT scanned here. That block is
    # RETROSPECTIVE about a forward call's target level: on a miss it must honestly cite
    # a level price never reached ("called beans above $11.38; they closed $11.21"), which
    # this 'above $X vs close' heuristic misreads as a contradiction — and since any level
    # warning forces price_validation_clean=false, it would BLOCK THE SEND on every losing
    # call (~half of all days). yesterdays_call correctness is owned deterministically by
    # grade_calls.py and the gate's call-outcome check, not by this prose scanner.
    tmyk = briefing.get("the_more_you_know") or briefing.get("tmyk") or {}
    if isinstance(tmyk, dict):
        v = tmyk.get("body", "")
        if isinstance(v, str) and v:
            parts.append((v, "the_more_you_know.body"))

    # Pattern: any of the break verbs, then up to 30 chars, then $XX or
    # $XX.XX. The 30-char gap is generous enough to catch "broke through
    # the $252 floor" but tight enough to not cross sentence boundaries
    # most of the time.
    verb_alt_below = "|".join(re.escape(v) for v in _BREAK_BELOW_VERBS)
    verb_alt_above = "|".join(re.escape(v) for v in _BREAK_ABOVE_VERBS)
    re_below = re.compile(
        r"\b(" + verb_alt_below + r")\b[^\$]{0,30}\$([0-9]+(?:\.[0-9]+)?)",
        re.IGNORECASE,
    )
    re_above = re.compile(
        r"\b(" + verb_alt_above + r")\b[^\$]{0,30}\$([0-9]+(?:\.[0-9]+)?)",
        re.IGNORECASE,
    )

    for text, label in parts:
        for m in re_below.finditer(text):
            verb = m.group(1)
            try:
                level = float(m.group(2))
            except ValueError:
                continue
            # Look at a window around the match to find the commodity
            window_start = max(0, m.start() - 80)
            window_end = min(len(text), m.end() + 40)
            window = text[window_start:window_end]
            # v4.5.0: skip if tense markers indicate this is retrospective
            # ("Wednesday's break"), conditional ("if cattle break"), or
            # forward-looking ("next week's $250 test"). Prevents weekend
            # false positives without losing the present-tense Monday-style
            # contradiction catch.
            if _has_tense_skip_marker(window):
                continue
            commodity, close = _find_close_for_text(window, locked_prices)
            if not commodity or close is None:
                continue
            # Range guard: levels far outside any commodity's plausible
            # range are probably calendar dates ($101.94 in a sentence
            # about "Friday $101.94 close" is the close itself, not a
            # level reference). Use the commodity's locked close as the
            # anchor and require the cited level to be within 25% of it
            # for the contradiction check to apply.
            if close > 0 and (level < close * 0.75 or level > close * 1.25):
                continue
            # Tolerance: 0.2% of the level. At $250 that's 50 cents -
            # tight enough to catch the Monday $253-vs-$252 case, loose
            # enough to allow 'broke $250' when close is $250.05.
            tol = level * 0.002
            if close > level + tol:
                warnings.append(
                    f"Level coherence: {label!r} says {verb!r} ${level:g} "
                    f"but {commodity} close is ${close:.2f} (above)."
                )
        for m in re_above.finditer(text):
            verb = m.group(1)
            try:
                level = float(m.group(2))
            except ValueError:
                continue
            window_start = max(0, m.start() - 80)
            window_end = min(len(text), m.end() + 40)
            window = text[window_start:window_end]
            # v4.5.0: same tense-skip filter as the below-claim path.
            if _has_tense_skip_marker(window):
                continue
            commodity, close = _find_close_for_text(window, locked_prices)
            if not commodity or close is None:
                continue
            if close > 0 and (level < close * 0.75 or level > close * 1.25):
                continue
            tol = level * 0.002
            if close < level - tol:
                warnings.append(
                    f"Level coherence: {label!r} says {verb!r} ${level:g} "
                    f"but {commodity} close is ${close:.2f} (below)."
                )

    return warnings


def sanitize_weekend_blocks(briefing, market_status):
    """v4.2 (Phase 2 C4): the prompt instructs the model to set
    weekend-disallowed fields to empty on Sat/Sun/holidays. Models
    occasionally violate. Wipe them in post to enforce the contract
    regardless of what the model returned. Only acts when market_closed;
    weekday data is untouched."""
    if not market_status.get("is_closed"):
        return briefing
    weekend_disallowed = ["yesterdays_call", "spread_to_watch",
                          "weekly_thread", "basis"]
    for key in weekend_disallowed:
        if key in briefing:
            briefing[key] = {}
    return briefing


def main():
    print("=== AGSIST Daily Briefing Generator v4.6.3 ===")
    print(f"  Time: {datetime.now().isoformat()}")
    market_status = get_market_status()
    if market_status["is_closed"]:
        print(f"  Markets CLOSED: {market_status['day_name']} ({market_status['reason']})")
    else:
        print(f"  Markets OPEN: {market_status['day_name']}")
    print("  Loading prices.json...")
    price_data, surprises = load_prices()
    if market_status["is_closed"]:
        surprises = []
        print("  Weekend/holiday: surprise detection suppressed")
    elif surprises:
        print(f"  {len(surprises)} overnight surprise(s)")
        for s in surprises:
            print(f"    {s['commodity']}: {s['pct_change']:+.1f}%")
    else:
        print("  No overnight surprises")
    print("  Loading past dailies...")
    past_dailies_block, past_tmyk_topics = load_past_dailies(num_days=3)
    if past_dailies_block:
        print(f"  Past context loaded ({len(past_tmyk_topics)} prior TMYK to avoid)")
    # v4.6: new loaders for cross-day continuity, anti-cliche, anti-repetition,
    # editorial-notes cumulative learning, and USDA release-day awareness.
    ongoing_situations = load_ongoing_situations()
    editorial_notes = load_editorial_notes()
    past_one_number_topics = load_past_one_number_topics()
    past_phrases = load_past_phrases()
    usda_release = get_usda_release_today()
    if ongoing_situations:
        print(f"  [v4.6] loaded {ongoing_situations.count(chr(91))} ongoing situation(s)")
    if editorial_notes:
        n_notes = editorial_notes.count("- (")
        print(f"  [v4.6] loaded editorial notes ({n_notes} entries)")
    if past_one_number_topics:
        print(f"  [v4.6] excluded {len(past_one_number_topics)} prior one_number topics")
    if past_phrases:
        print(f"  [v4.6] flagged {len(past_phrases)} overused phrases for exclusion")
    if usda_release:
        print(f"  [v4.6] today is a USDA release day")

    # v4.0: load yesterday's call + weekly thread context
    yesterdays_call_ctx = None
    weekly_thread_ctx = None
    if not market_status["is_closed"]:
        yesterdays_call_ctx = load_yesterdays_call_context()
        if yesterdays_call_ctx:
            print(f"  Yesterday's call: {yesterdays_call_ctx['section_title']!r} ({yesterdays_call_ctx['conviction']}) from {yesterdays_call_ctx['prior_date']}")
        else:
            print("  Yesterday's call: none found (Monday after long weekend or fresh archive)")
        weekly_thread_ctx = load_weekly_thread()
        if weekly_thread_ctx:
            print(f"  Weekly thread: day {weekly_thread_ctx['today_day_of_week']}/5, Monday's question: {weekly_thread_ctx['question'][:60]}...")
        elif datetime.now().weekday() == 0:
            print("  Weekly thread: Monday, model will set this week's question")
        else:
            print("  Weekly thread: no Monday briefing found")

    print("  Fetching ag news...")
    news_block = fetch_ag_news()
    # v4.4: log how many bucketed sections came back so we can see if news
    # is dry vs the model just isn't using it
    bucket_count = sum(1 for line in news_block.split("\n") if line.startswith("["))
    print(f"  News block: {bucket_count} populated buckets, "
          f"{len(news_block)} chars")
    seasonal_ctx = get_seasonal_context()
    print("  Selecting today's quote...")
    # Phase 2 (v4.2): two-pass quote selection. First pass picks a
    # default quote (mood unknown pre-generation). After generation,
    # if the briefing has a market_mood, we re-pick from a mood-affinity
    # bucket and override briefing.daily_quote before save.
    todays_quote = get_todays_quote()
    print(f"  Quote: \"{todays_quote['text'][:60]}...\" ({todays_quote['attribution']})")
    print("  Calling Claude API (v4.0 prompt)...")
    briefing = call_claude(price_data, surprises, news_block, seasonal_ctx,
                           todays_quote, past_dailies_block, past_tmyk_topics,
                           market_status, yesterdays_call_ctx, weekly_thread_ctx,
                           ongoing_situations=ongoing_situations,
                           editorial_notes=editorial_notes,
                           past_one_number_topics=past_one_number_topics,
                           past_phrases=past_phrases,
                           usda_release=usda_release)

    # v4.2 (Phase 2 C4): enforce weekend block contract regardless of
    # what the model returned. On weekdays this is a no-op.
    briefing = sanitize_weekend_blocks(briefing, market_status)
    # v4.4.1: strip any em/en dashes that slipped through despite the
    # prompt rule. Final defense before validation.
    briefing = sanitize_em_dashes(briefing)
    # v4.5.0: convert any literal <strong>/<em> HTML tags in body fields
    # to **markdown**. The frontend mdInline helper handles either format
    # but storing markdown keeps the JSON clean for downstream consumers
    # (email pipeline, RSS, AI crawlers). Idempotent.
    briefing = sanitize_html_tags(briefing)

    # v4.6.1: drama-verb scrubber - deterministic post-pass after critic rewrite.
    # Catches drama verbs in headlines/section titles/takeaways/TMYK titles that
    # the critic cannot rewrite (not in weakest_target enum) or chose not to.
    briefing, _scrub_log = scrub_drama_verbs(briefing)

    briefing, _wd_fixes = fix_weekday_labels(briefing)
    if _wd_fixes:
        print(f"  Weekday corrections: {_wd_fixes}")

    locked_prices = price_data.get("locked_prices", {})
    is_clean, val_warnings = validate_briefing(briefing, locked_prices)
    # v4.5.0: deterministic level coherence check. Catches the math
    # contradiction class (close above $X paired with claim that $X was
    # broken) that hit Monday 2026-05-04 and propagated forward via the
    # continuity feature for two days.
    level_warnings = validate_level_coherence(briefing, locked_prices)
    if level_warnings:
        val_warnings.extend(level_warnings)
        # Level coherence is a PROSE heuristic: it can't tell "crude broke below $68
        # today" (a checkable claim) from "crude could fall below $68" / "support at
        # $68" (forward-looking). It false-blocked on yesterdays_call and again on a
        # crude support level. Per the design rule — prose heuristics WARN, only
        # deterministic data-integrity hard-blocks — these are logged for visibility
        # but do NOT flip price_validation_clean or block the send. The gate runs its
        # own guarded level check as a WARN, so a genuine "broke below $X when it
        # closed above" contradiction still surfaces there without halting the publish.
    if val_warnings:
        print(f"  Validation warnings ({len(val_warnings)}):")
        for w in val_warnings: print(f"    - {w}")
    else:
        print("  Validation passed")
    briefing["locked_prices"] = locked_prices
    chart_series = build_chart_series(locked_prices)
    if chart_series:
        briefing["chart_series"] = chart_series
        print(f"  Chart series: {{k: len(v) for k, v in chart_series.items()}}")
    sponsor = build_sponsor_block()
    briefing["sponsor"] = sponsor
    if sponsor.get("is_house_ad"):
        print("  Sponsor: HOUSE AD (no paid sponsor active)")
    else:
        print(f"  Sponsor: {sponsor.get('advertiser', 'unnamed')} (PAID)")
    pre_issue = load_issue_number()
    briefing["issue_number"] = pre_issue + 1
    print(f"  Issue number for today: #{briefing['issue_number']}")

    # v4.0: log new block presence for verification
    if briefing.get("yesterdays_call", {}).get("summary"):
        outcome = briefing["yesterdays_call"].get("outcome", "?")
        print(f"  Yesterday's call assessed: {outcome.upper()}")
    if briefing.get("spread_to_watch", {}).get("label"):
        print(f"  Spread to watch: {briefing['spread_to_watch']['label']}")
    wt = briefing.get("weekly_thread") or {}
    if wt.get("question"):
        print(f"  Weekly thread day {wt.get('day','?')}: {wt['question'][:60]}...")
    # v4.4: outside_the_pit + section catalyst presence
    otp = briefing.get("outside_the_pit") or []
    if otp:
        print(f"  Outside the Pit: {len(otp)} item(s)")
        for it in otp[:3]:
            tag = it.get("tag", "")
            tag_str = f"[{tag}] " if tag else ""
            print(f"    - {tag_str}{(it.get('title') or '')[:60]}")
    else:
        print("  Outside the Pit: EMPTY (model violated RULE 16)")
    cats_with = sum(1 for s in briefing.get("sections", [])
                    if (s.get("catalyst") or "").strip())
    cats_total = len(briefing.get("sections", []))
    if cats_total:
        print(f"  Section catalysts: {cats_with}/{cats_total} sections name a driver")

    briefing["generated_at"] = datetime.now(timezone.utc).isoformat()
    briefing["generator_version"] = "4.6.3"
    briefing["surprise_count"] = len(surprises)
    briefing["surprises"] = surprises
    briefing["price_validation_clean"] = is_clean
    briefing["market_closed"] = market_status["is_closed"]
    briefing["market_status_reason"] = market_status["reason"]
    if "meta" not in briefing: briefing["meta"] = {}
    briefing["meta"]["overnight_surprises_count"] = len(surprises)
    # Measured news coverage, not the model's claim about it. source_summary is
    # written BY the LLM and is a narrative; this is the tally. briefing_gate
    # holds it to a floor so a collapsing news base fails loudly instead of
    # quietly producing thinner prose over a confident-sounding source list.
    briefing["meta"]["news_coverage"] = getattr(
        fetch_ag_news, "coverage", {"ok": 0, "total": 0, "items": 0, "dark": []})

    # v4.2 (Phase 2 C2): two-pass quote re-selection. Now that we know the
    # market_mood the model assigned, re-pick from a mood-affinity bucket.
    # If the new pick is the same as the first pass (deterministic seeds),
    # this is a no-op. If the mood-bucket has no quotes, falls back to full
    # pool. Override briefing.daily_quote with the mood-aware pick.
    market_mood = (briefing.get("meta") or {}).get("market_mood", "")
    if market_mood:
        mood_quote = get_todays_quote(market_mood=market_mood)
        if mood_quote and mood_quote.get("text"):
            prev = briefing.get("daily_quote") or {}
            if prev.get("text") != mood_quote["text"]:
                print(f"  Quote re-picked for mood={market_mood!r}: "
                      f"\"{mood_quote['text'][:50]}...\" ({mood_quote['attribution']})")
            briefing["daily_quote"] = mood_quote

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(briefing, f, indent=2, ensure_ascii=False)
    print(f"  Written to {OUTPUT_PATH}")
    print("  Archiving briefing...")
    save_archive(briefing)
    print(f"  Headline: {briefing.get('headline', 'N/A')}")
    print(f"  Sections: {len(briefing.get('sections', []))}")
    print("=== Done. Run scripts/critique_briefing.py next for the v1.2 quality gate. ===")


if __name__ == "__main__":
    main()
