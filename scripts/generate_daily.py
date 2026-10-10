#!/usr/bin/env python3
"""
AGSIST Daily Briefing Generator, v5.1 (the cut)
═══════════════════════════════════════════════════════════════════
Generates the daily agricultural intelligence briefing via Claude API.

v5.1 (the cut, 2026-09-13): the briefing is ~400 words, hard ceiling 450,
enforced by scripts/briefing_cut.py (one definition, imported by the
generator, the critic and the schema check). Fields retired from the
model output: subheadline, the_takeaway, catalyst, vs_yesterday,
the_more_you_know, weekly_thread, per-section farmer_action, and
yesterdays_call.summary. bottom_line is now so_what (15 words). One
mandatory thresholded `action`. outside_the_pit is 1 item, watch_list
is 3 items of 20 words, sections are 2-3 of 55 words. The lede may not
end by pointing forward (RULE 3). "Word budget" is no longer in
NON_BLOCKING: a briefing still over 450 after deterministic truncation
fails the run. yesterdays_call is graded in the generator (grade_calls,
imported) before the archive is rendered, and carries a deterministic
call_line in place of the model's summary. Renderers keep drawing the
retired fields for the 185 archived issues that carry them.

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
from datetime import datetime, timezone, timedelta, date

from contract_calendar import is_expired, holiday_name   # ONE expiry rule + ONE trading calendar
import briefing_cut                         # ONE definition of the word budget
import arc_plc_link                         # first ARC/PLC mention links /arc-plc
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
DAILY_QUOTE_ENABLED = False   # 2026-10-09: off; the pool's attributions are unsourced (see main)
ANTHROPIC_API = "https://api.anthropic.com/v1/messages"
# 2026-09-19: claude-sonnet-5 by default, $2/$10 per million tokens against
# $3/$15 for claude-sonnet-4-6 on Anthropic's pricing page that day. The
# repository variable BRIEFING_MODEL overrides it without a code change, and a
# model the API does not know falls back to FALLBACK_MODEL once, in the same
# run, with a ::warning:: on the run page -- so a name change at Anthropic
# costs an annotation and not a morning.
MODEL = os.environ.get("BRIEFING_MODEL", "").strip() or "claude-sonnet-5"
FALLBACK_MODEL = "claude-sonnet-4-6"


def _refused_model(e):
    """(status, body) if an exception is the API saying it does not know the
    model -- a 404, or a 400 naming "model:" -- else None. Reads both a
    requests error (e.response) and a urllib one (e.code, e.read())."""
    resp = getattr(e, "response", None)
    sc = getattr(resp, "status_code", None) if resp is not None else getattr(e, "code", None)
    body = ""
    try:
        body = (getattr(resp, "text", "") if resp is not None else e.read().decode("utf-8", "replace")) or ""
    except Exception:
        pass
    if sc == 404 or (sc == 400 and "model:" in body.lower()):
        return sc, body[:200]
    return None
# Dated social card rendered by build_social_card.py in the same daily.yml run
# (card step runs after generate, both commit together — so the published page
# and its image land at the same moment). If a card ever fails to render, the
# og:image 404s for that day and scrapers fall back to text — degrade, not break.
OG_IMAGE_BASE = "https://agsist.com/data/social/card-"

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
    # Full-closure US market holidays. v5.2 (2026-09-13): the hardcoded 2026 map
    # that used to live here, with its "REFRESH ANNUALLY" note, moved into
    # contract_calendar.market_holidays, which COMPUTES the closures for any
    # year. The call grader needs the same question answered about arbitrary
    # PAST dates, and this function can only answer it about today (it reads
    # datetime.now()). A second holiday list is how two graders come to disagree
    # in January. contract_calendar's selftest pins the computed 2026 set
    # against the map this function used to carry.
    # (Nov 27 is an early close, not a full closure, so it stays a trading day.)
    hname = holiday_name(now.date())
    if hname:
        return {"is_closed": True, "reason": "holiday", "day_name": hname,
            "note": f"TODAY IS {hname.upper()}. Markets CLOSED (CBOT grain + equities). "
                    f"Write a HOLIDAY OUTLOOK — do not describe an overnight session or "
                    f"'today's trade'; reference the most recent actual close and what's ahead."}
    # Degraded fallback for years other than 2026 (map above needs a yearly
    # refresh): still catch the three fixed-date holidays + observed shifts.
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


def _resolve_front_month(data):
    """Self-defence copy of the feed gate, in case preflight_prices.py was skipped.

    This used to be a SECOND, independently-maintained implementation of the
    reconciliation in preflight_prices.py, and it drifted exactly the way the two
    copies of the expiry rule drifted (see _front_expired above). On 2026-08-08
    the drift cost us a published briefing: both copies compared only `close`,
    neither looked at the prior close, and neither covered cattle/hogs/oats/milk
    at all -- so "corn fell hard, down 5.4%" and a 16.9% lean hog rally that
    exceeded the exchange daily limit by 2.9x both sailed through.

    So this no longer holds its own copy of the rule. It calls the gate. One
    definition, in one file, the same lesson as is_expired. Repair mode is used
    because the generator's job is to publish something correct where it can, and
    the gate suppresses (rather than invents) whatever it cannot verify.
    """
    try:
        from preflight_prices import run as _preflight_run
    except ImportError as e:                       # never block a send on this
        print(f"[front-month] preflight_prices unavailable ({e}) -- "
              f"feed passed through UNGATED", file=sys.stderr)
        return data.get("quotes", {})
    _passed, issues, data = _preflight_run(data, repair=True)
    for sev, code, msg in issues:
        if sev in ("FAIL", "REPAIR"):
            print(f"[front-month] {sev} {code}: {msg}", file=sys.stderr)
    if not _passed:
        print("[front-month] feed still has unrepairable FAILs after repair -- "
              "affected instruments were suppressed, not published",
              file=sys.stderr)
    return data.get("quotes", {})


def load_prices():
    if not PRICES_PATH.exists():
        print("[error] prices.json not found", file=sys.stderr); return {}, []
    with open(PRICES_PATH) as f: data = json.load(f)
    fetched = data.get("fetched", "")
    quotes = _resolve_front_month(data)  # repair roll-splice contamination before locking prices
    price_lines = []; locked_prices = {}; locked_changes = {}; surprises = []
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
        # v5.4 (2026-09-13): LOCK THE CHANGE, not just the price.
        # `pct` here is the source's own close-over-close move, read at fetch
        # time. Until now only the price survived, so every consumer that wanted
        # a change re-derived one by walking the archive and comparing two
        # SNAPSHOTS taken at different times of day — which mixes in overnight
        # drift. Measured on 2026-09-12: the walk gave corn -0.49% and beans
        # -1.39% where the fetch had -0.63% and -1.81%. The number was here all
        # along and was being thrown away one line above.
        locked_changes[key] = {"prev": round(opn / 100, 4) if is_grain else round(opn, 4),
                               "pct": round(pct, 4)}
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
             "locked_changes": locked_changes,
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


def build_chart_series(today_locked_prices, today_market_closed=False, num_days=9):
    """The last briefing-morning locks, one point per TRADING day, one CONTRACT
    per series, full precision — plus the dates, so the window can be printed.

    Three rules, each bought with a shipped defect (audit 2026-09-22):

    - DATED CONTRACTS ONLY. The `corn` key is the nearby alias, and the
      Sep'26->Dec'26 roll landed inside one 10-entry window: the strip printed
      "corn up 4.7% / 24c" when the Dec contract had moved one cent. 22.5 of
      those cents were the carry spread. The dated key is found from today's
      locked table (corn-<mon>, beans-<mon>) and every archive day must carry
      THAT key, so a series can never straddle a roll. Wheat has no dated key
      in the archive and is therefore not charted at all — absent beats wrong.
    - MARKET-CLOSED DAYS ARE SKIPPED. Weekend briefings re-lock Friday, and
      the three-point plateaus rendered as "consolidation".
    - NO ROUNDING HERE. round(v, 2) before differencing showed 24c on a 23.5c
      move, and could print 'unch' across a real half-cent move depending on
      which side of the boundary it fell. Settles are on a quarter-cent grid;
      they are stored as locked.

    A date enters only when every charted key has a price on it, so the
    series stay the same length and aligned — a renderer that assumes equal
    spacing cannot be handed a silently shifted series.

    Returns (series, dates): series maps name -> [floats], dates is ISO per
    point, shared by all series. ({}, []) when fewer than 2 points survive.
    """
    archive_dir = REPO_ROOT / "data" / "daily-archive"
    index_path = archive_dir / "index.json"
    if not index_path.exists(): return {}, []
    try:
        with open(index_path) as f: idx = json.load(f)
    except Exception: return {}, []
    key_map = {}
    for name, base in (("corn", "corn"), ("soybeans", "beans")):
        dated = sorted(k for k in (today_locked_prices or {})
                       if k.startswith(base + "-") and today_locked_prices.get(k))
        if dated: key_map[name] = dated[0]
    if not key_map: return {}, []
    entries = idx.get("briefings", [])
    today_iso = datetime.now().strftime("%Y-%m-%d")
    # Strictly BEFORE today, not merely != today: this also keeps a re-run on a
    # later day (or a skewed clock) from charting the same lock twice.
    past = sorted([e for e in entries if e.get("date") and e["date"] < today_iso],
                  key=lambda e: e["date"])
    rows = []
    for entry in reversed(past):
        if len(rows) >= num_days: break
        json_path = archive_dir / f"{entry.get('date', '')}.json"
        if not json_path.exists(): continue
        try:
            with open(json_path) as f: b = json.load(f)
        except Exception: continue
        if b.get("market_closed") is True: continue
        lp = b.get("locked_prices") or {}
        vals = {}
        for name, key in key_map.items():
            v = lp.get(key)
            if isinstance(v, (int, float)) and v > 0: vals[name] = float(v)
        if len(vals) == len(key_map): rows.append((entry["date"], vals))
    rows.reverse()
    if rows and rows[-1][0] >= today_iso: rows.pop()  # belt to the guard above
    if not today_market_closed:
        vals = {}
        for name, key in key_map.items():
            v = (today_locked_prices or {}).get(key)
            if isinstance(v, (int, float)) and v > 0: vals[name] = float(v)
        if len(vals) == len(key_map): rows.append((today_iso, vals))
    if len(rows) < 2: return {}, []
    return ({name: [v[name] for _, v in rows] for name in key_map},
            [d for d, _ in rows])


def _chart_window_label(dates):
    """"Sep 8 - Sep 21" from the first and last ISO dates of the series."""
    def short(iso):
        try:
            dt = datetime.strptime(iso, "%Y-%m-%d")
            return f"{dt.strftime('%b')} {dt.day}"
        except Exception: return iso
    if not dates: return ""
    return f"{short(dates[0])} - {short(dates[-1])}" if len(dates) > 1 else short(dates[0])


STRIP_DISPLAY = {"corn": "Corn", "beans": "Soybeans", "wheat": "Wheat"}

def build_quote_strip(locked_prices, locked_changes, board):
    """The market strip both pages render: the DAY move, against the prior
    settle, with the contract named — never an unlabeled multi-day percent.

    Replaces two things the 2026-09-22 audit killed: the archive pages'
    frameless sparklines (autoscaled, always shaped by whatever the series
    happened to contain, no window, no change figure) and the live strip's
    first-to-last percent over a never-labeled window that contradicted the
    page's own locked_changes on the same screen.

    Uses the dated contract where today's lock carries one (corn, beans) and
    the nearby where none exists (wheat, labeled "nearby"). prev and pct come
    from locked_changes — the same numbers the prose is written against, so
    the strip can no longer disagree with the lead.
    """
    lp = locked_prices or {}
    lc = locked_changes or {}
    quotes = []
    for base in ("corn", "beans", "wheat"):
        dated = sorted(k for k in lp if k.startswith(base + "-") and lp.get(k))
        key = dated[0] if dated else base
        last = lp.get(key)
        ch = lc.get(key) or {}
        prev, pct = ch.get("prev"), ch.get("pct")
        if not isinstance(last, (int, float)) or last <= 0: continue
        if not isinstance(prev, (int, float)) or prev <= 0: continue
        if not isinstance(pct, (int, float)): continue
        name = STRIP_DISPLAY.get(base, base.title())
        if dated:
            label = COMMODITY_LABELS.get(key, "")
            parts = label.rsplit(" ", 2)
            contract = f"{parts[1]} {parts[2]}" if len(parts) == 3 else key.split("-", 1)[1].capitalize()
        else:
            contract = "nearby"
        quotes.append({"key": key, "name": name, "contract": contract,
                       "last": last, "prev": prev, "pct": pct})
    if not quotes: return None
    b = board or {}
    return {"asof": b.get("fetched") or None,
            "session": b.get("quote_session") or None,
            "vs_session": b.get("prev_close_session") or None,
            "quotes": quotes}


def _ct_stamp(iso_utc, with_day=True):
    """"5:57 AM CT Mon" from an ISO UTC stamp; '' when unparseable."""
    try:
        from zoneinfo import ZoneInfo
        dt = datetime.fromisoformat(str(iso_utc).replace("Z", "+00:00"))
        dt = dt.astimezone(ZoneInfo("America/Chicago"))
        out = dt.strftime("%I:%M %p").lstrip("0") + " CT"
        if with_day: out += " " + dt.strftime("%a")
        return out
    except Exception:
        return ""


def _ct_weekday(iso_date):
    """"Fri" from an ISO date; '' when unparseable."""
    try:
        return datetime.strptime(str(iso_date), "%Y-%m-%d").strftime("%a")
    except Exception:
        return ""


def render_quote_strip_html(strip):
    """One HTML for both surfaces: same classes as daily.html's renderer, so
    the baked archive page and the live page cannot drift apart visually."""
    if not strip or not strip.get("quotes"): return ""
    cells = []
    for q in strip["quotes"]:
        last, prev, pct = q["last"], q["prev"], q["pct"]
        d = last - prev
        if abs(d) < 0.0001: direction = "flat"
        elif d > 0: direction = "up"
        else: direction = "down"
        arrow = {"up": "\u25B2", "down": "\u25BC"}.get(direction, "")
        cls = {"up": "pos", "down": "neg"}.get(direction, "flat")
        cents = abs(d) * 100
        cents_str = ""
        if cents >= 0.005:
            cents_str = f"{cents:.2f}".rstrip("0").rstrip(".") + "¢"
        pct_str = "unch" if direction == "flat" else f"{arrow} {abs(pct):.1f}%"
        price_str = f"${last:.2f}"
        aria = (f"{q['name']} {q['contract']}, {price_str}, "
                + ("unchanged" if direction == "flat" else f"{direction} {abs(pct):.1f}%")
                + " vs the prior close")
        cells.append(
            f'<div class="dv3-quote" role="img" aria-label="{html_esc(aria)}">'
            f'<div class="dv3-quote-top"><span class="dv3-quote-name">{html_esc(q["name"])}</span>'
            f'<span class="dv3-quote-win">{html_esc(q["contract"])}</span></div>'
            f'<span class="dv3-quote-price">{price_str}</span>'
            f'<span class="dv3-quote-chg {cls}">{pct_str}'
            + (f'<span class="cents">{cents_str}</span>' if cents_str else "")
            + '</span></div>')
    bits = []
    asof = _ct_stamp(strip.get("asof")) if strip.get("asof") else ""
    if asof: bits.append(f"Quotes as of {asof}")
    vs = _ct_weekday(strip.get("vs_session")) if strip.get("vs_session") else ""
    if vs: bits.append(f"change vs {vs} close")
    bits.append("CME futures, delayed")
    asof_html = f'<div class="dv3-quote-asof">{html_esc(" · ".join(bits))}</div>'
    return '<div class="dv3-quotes">' + "".join(cells) + "</div>" + asof_html


def load_issue_number():
    """Total briefing count from archive index. Returns 0 if missing."""
    index_path = REPO_ROOT / "data" / "daily-archive" / "index.json"
    if not index_path.exists(): return 0
    try:
        with open(index_path) as f: idx = json.load(f)
        if isinstance(idx.get("count"), int): return idx["count"]
        return len(idx.get("briefings", []))
    except Exception: return 0


def load_yesterdays_call_context(today_briefing=None):
    """The call TODAY actually grades, as prompt context.

    v5.2: this used to walk back to "the most recent weekday briefing", which
    could hand the model a call the grader was not going to score, or one it had
    already scored on Saturday. The model then wrote an honest-sounding note
    about the wrong call. One question, one answer: ask grade_calls, which the
    grader, the gate and the public record all ask too. Returns None when no
    session has settled since the last issue, and the block is then omitted."""
    archive_dir = REPO_ROOT / "data" / "daily-archive"
    only_date = None
    try:
        import grade_calls as _gc
        _probe = dict(today_briefing or {})
        _probe.setdefault("date", datetime.now().strftime("%Y-%m-%d"))
        _probe.setdefault("generated_at", datetime.now(timezone.utc).isoformat())
        made, _prior, why = _gc.find_graded_call(_probe, str(archive_dir))
        if made is None:
            print(f"  Yesterday's call: nothing to grade ({why})")
            return None
        only_date = made
    except Exception as _e:
        print(f"  [warn] call-context selector unavailable ({type(_e).__name__}: {_e})")
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
    if only_date:
        candidates = [b for b in candidates if b.get("date") == only_date]
    for entry in candidates[:5]:  # Look back up to 5 days
        if only_date is None and entry.get("market_closed"): continue
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
        # v5.1: so_what is the field; the older names are read for archived issues.
        call = (top.get("so_what") or top.get("farmer_action") or "").strip()
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


# How old data/ongoing-situations.json may get before the prompt is told to
# distrust its dates. Two weeks spans a normal refresh cadence without letting
# a whole report cycle go by unflagged.
STALE_SITUATIONS_DAYS = 14


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

    # ── staleness guard (2026-08-15) ──────────────────────────────────────
    # This file is standing context the model is told NOT to contradict, so a
    # stale fact in here outranks today's news in the model's head. On
    # 2026-08-15 it still said "Pro Farmer scouts are in fields the week of
    # Aug 3" (the tour is Aug 17-20), called the Aug 12 WASDE "the next
    # catalyst" three days after it printed, and carried USDA's superseded
    # 183.0/53.0 as current. That is the same shape as the 2026-08-11
    # fabrication: a wrong date in trusted context, narrated as fact.
    # We cannot auto-refresh it, but we can stop presenting it as timeless.
    stale_note = ""
    _lu = (data.get("_last_updated") or "").strip() if isinstance(data, dict) else ""
    if _lu:
        try:
            _age = (datetime.now().date() - datetime.strptime(_lu, "%Y-%m-%d").date()).days
            if _age > STALE_SITUATIONS_DAYS:
                print(f"  [v4.6] ⚠ ongoing-situations.json is {_age} days old "
                      f"(updated {_lu}) — prompt will flag it as possibly stale")
                stale_note = (
                    f"\n  ⚠ THIS BLOCK WAS LAST UPDATED {_lu}, {_age} DAYS AGO. Treat every DATE and\n"
                    f"  every 'upcoming'/'next' claim in it as possibly overtaken. If a date in here has\n"
                    f"  already passed, the event has happened — never describe a past date as upcoming,\n"
                    f"  and never resolve it from these facts alone. Today's news block and the release\n"
                    f"  calendar outrank this block on anything time-sensitive.\n")
            else:
                print(f"  [v4.6] ongoing-situations.json is {_age} days old (updated {_lu})")
        except ValueError:
            pass

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
    return header + stale_note + "\n" + "\n\n".join(active) + "\n"


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
                corpus.append((s.get("so_what") or s.get("bottom_line") or "").lower())
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


# Pro Farmer Crop Tour window. The tour's own file carries its dates; this
# tuple is only the fallback for a missing or unreadable one.
#
# IT USED TO BE THE ONLY SOURCE, hardcoded, with a comment saying UPDATE EACH
# YEAR. data/crop-tour.json already holds tour.start, tour.end and
# tour.final_expected, maintained by the crop tour workflow, so the dates are
# read from there and nobody has to remember.
_SEPT_BASE = "Early harvest: Corn harvest beginning. September WASDE."
PRO_FARMER_TOUR = (8, 17, 20)  # (month, first_day, last_day) — fallback only


def _tour_dates():
    """(start, end, final, final_label, year) from the tour's own file, or None."""
    try:
        import json as _json
        from pathlib import Path as _Path
        p = _Path(__file__).resolve().parent.parent / "data" / "crop-tour.json"
        t = (_json.loads(p.read_text(encoding="utf-8")) or {}).get("tour") or {}
        start = date.fromisoformat(t["start"])
        end = date.fromisoformat(t["end"])
        final = date.fromisoformat(t.get("final_expected") or t["end"])
        label = (t.get("final_expected_label") or final.strftime("%A, %b %-d")).strip()
        return start, end, final, label, int(t.get("year") or start.year)
    except Exception:
        return None


def _tour_is_over_note(span, label, final_date=None, today=None):
    """THE SENTENCE THAT STOPS THE TOUR BEING NARRATED AS UPCOMING.

    This is the branch that did not exist. The old code had three states --
    not started, underway, and "wrapped" -- and the wrapped one EXPIRED four
    days after the tour ended (`now.day <= t1 + 4`). From the 25th onward the
    model was told nothing about the tour at all, so nothing contradicted it
    when it decided the number was still coming.

    It did exactly that. The briefing published 2026-08-26 told readers "The
    Pro Farmer tour number Friday is the next real test" and repeated it in the
    takeaway -- five days after the tour had finished and four days after its
    final number was out. Sig caught it in his own inbox.

    A guard that stops guarding is worse than no guard, because the shape of
    the code implies the case is handled. This one does not expire.

    ── AND THEN IT BECAME THE HEADLINE. Corrected 2026-08-29. ───────────────
    The paragraph above went in on 2026-08-27 and it worked: nothing has
    described the tour as upcoming since. What it also did was hand the model
    the loudest, most emphatic sentence in the entire seasonal context, every
    single day, for six weeks. On Friday 2026-08-28 -- EIGHT DAYS after the
    tour ended -- the briefing led with

        PRO FARMER DONE; SEPTEMBER WASDE HOLDS THE ANSWER
        "The Pro Farmer tour is in the rearview."

    Sig caught that one in his inbox too. A prohibition written at full volume
    reads as a topic. The fix for the last headline defect authored the next.

    So the note now FADES, and says out loud that it is not news:

      * days 0-4 after the final number -- still genuinely recent. Full note.
      * day 5 onward -- one quiet line whose whole job is suppression, and
        which BANS the tour from the headline, lead, action
        and teaser by name. A guard belongs in the guard rails, not in the
        lede.

    The general form of this mistake is rule 21 in the prompt: nothing that
    has not moved since the last briefing may lead it.
    """
    fresh = True
    if final_date is not None and today is not None:
        try:
            fresh = (today - final_date).days <= 4
        except Exception:
            fresh = True

    if fresh:
        return (f"The Pro Farmer Crop Tour is FINISHED. It ran {span} "
                f"and published its final national estimate on {label}. Do NOT describe "
                f"the tour, its scouts, its samples or its number as upcoming, "
                f"forthcoming, 'this Friday', or 'the next test' -- it has already "
                f"happened. Reference it only in the past tense, and only with figures "
                f"that appear in the news block. The next scheduled yield event is the "
                f"September WASDE.")

    days = (today - final_date).days if (final_date and today) else None
    age = f"{days} days ago" if days is not None else "earlier this season"
    return (f"BACKGROUND ONLY, NOT NEWS: the Pro Farmer Crop Tour ran {span} and "
            f"its final national estimate came out on {label}, {age}. That is old "
            f"news and it is NOT a story. Do NOT put the tour, its number, or the "
            f"fact that it is over in the headline, lead, action "
            f"or teaser. Do not frame the day around 'the tour is behind us' or "
            f"'now we wait for the WASDE'. Mention it at all only if the news block "
            f"carries something new about it, and never in the future tense.")


def _august_context():
    """August seasonal context, day-aware around the Pro Farmer Crop Tour so the
    generator neither narrates tour findings before they exist nor describes a
    finished tour as still to come."""
    today = datetime.now().date()
    base = "Yield formation: corn in dough/dent, soybeans filling pods."
    d = _tour_dates()
    if d:
        t_start, t_end, t_final, t_label, _yr = d
    else:
        m, a, b = PRO_FARMER_TOUR
        t_start, t_end = date(today.year, m, a), date(today.year, m, b)
        t_final, t_label = t_end, t_end.strftime("%A, %b %-d")
    span = f"{t_start.strftime('%b %-d')}-{t_end.strftime('%-d')}"

    if today < t_start:
        days = (t_start - today).days
        return (f"{base} The Pro Farmer Crop Tour runs {span} — it has NOT "
                f"started yet ({days} days out). Do NOT describe tour scouts, pod "
                f"counts, ear samples, or tour findings as if they exist; the tour "
                f"is only upcoming. Weather and crop-condition ratings drive the crop story now.")
    if today <= t_end:
        return (f"{base} The Pro Farmer Crop Tour is underway ({span}) — "
                f"scouts are sampling corn ears and soybean pods across the Belt "
                f"this week. Only cite specific tour figures if they appear in the news block.")
    # <= AND NOT <. The briefing goes out in the MORNING and Pro Farmer
    # publishes in the afternoon, so on the day of the final number the honest
    # line is "due today", not "published".
    if today <= t_final:
        return (f"{base} The Pro Farmer Crop Tour has finished sampling ({span}); its "
                f"final national estimate is due {t_label} and is NOT out yet as this "
                f"briefing is written. Only cite figures present in the news block.")
    return f"{base} {_tour_is_over_note(span, t_label, t_final, today)}"


def get_seasonal_context():
    month = datetime.now().month
    if month == 8:
        return _august_context()
    if month == 9:
        # SEPTEMBER NEEDED IT TOO. The August guard could be perfect and a
        # briefing on 3 September would still be free to invent a tour date,
        # because the tour instruction only ever existed inside the August
        # branch. The tour is over for the rest of the crop year, so say so
        # for the rest of the crop year.
        d = _tour_dates()
        if d:
            t_start, t_end, _t_final, t_label, yr = d
            if yr == datetime.now().year:
                span = f"{t_start.strftime('%b %-d')}-{t_end.strftime('%-d')}"
                return (_SEPT_BASE + " " + _tour_is_over_note(
                    span, t_label, _t_final, datetime.now().date()))
        return _SEPT_BASE
    contexts = {
        1: "Mid-winter: South American crop development. Cattle markets seasonally strong.",
        2: "Late winter: USDA Ag Outlook Forum. South American harvest beginning.",
        3: "Pre-planting: USDA Prospective Plantings end of March. Fieldwork starting in South.",
        4: "Planting season: Corn planting underway (April 15 to May 15 optimal Corn Belt).",
        5: "Peak planting: Soybean planting (May 1 to June 5). Prevent plant deadline approaching.",
        6: "Growing season: Crop conditions drive markets. Pollination approaching.",
        7: "Critical: Corn pollination. USDA Acreage report (June 30). Weather premium at peak.",
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

    # Holiday awareness: USDA shifts the weekly reports around federal holidays.
    # A Monday-holiday pushes Crop Progress to Tuesday; a Thursday-holiday
    # (Thanksgiving) pushes Export Sales to Friday. Reuse the authoritative
    # market-status check so we never assert a report on a closed day.
    status = get_market_status()
    is_holiday_today = status["is_closed"] and status["reason"] == "holiday"
    yday = today - timedelta(days=1)

    releases = []
    if not is_holiday_today:
        # Weekly recurring — normal schedule
        if weekday == 0 and 4 <= today.month <= 11:   # Monday: Crop Progress
            releases.append("USDA Crop Progress, 3:00 PM CT")
        if weekday == 3:                               # Thursday: Weekly Export Sales
            releases.append("USDA Weekly Export Sales, 7:30 AM CT")
        # Day-after-holiday shifts: Tue-after-Mon-holiday, Fri-after-Thu-holiday
        if weekday == 1 and 4 <= today.month <= 11 and today.year == 2026 \
                and (yday.month, yday.day) in {(1,19),(2,16),(5,25),(9,7)}:
            releases.append("USDA Crop Progress, 3:00 PM CT (shifted from Monday holiday)")
        if weekday == 4 and today.year == 2026 and (yday.month, yday.day) == (11, 26):
            releases.append("USDA Weekly Export Sales, 7:30 AM CT (shifted from Thanksgiving)")

    # Monthly: Cattle on Feed (3rd or 4th Friday). Hardcoded 2026 dates:
    cof_2026 = {"01-23", "02-20", "03-20", "04-24", "05-22",
                "06-19", "07-24", "08-21", "09-25", "10-23",
                "11-20", "12-18"}
    if md in cof_2026:
        releases.append("USDA Cattle on Feed, 2:00 PM CT")

    # Monthly: WASDE — single-definition table in usda_dates.py (shared with
    # briefing_gate's fabricated-release check; see 2026-08-11 incident).
    import usda_dates
    if today.date() in usda_dates.WASDE_2026:
        releases.append("USDA WASDE (World Ag Supply/Demand Estimates), 11:00 AM CT")

    # Quarterly stocks, Prospective Plantings, Acreage: the same table the
    # report-day line uses (usda_dates; the January stocks report is Jan 12,
    # with the WASDE, not Jan 30 as this block used to say).
    if today.date() in usda_dates.GRAIN_STOCKS_2026:
        releases.append("USDA Quarterly Grain Stocks, 11:00 AM CT")
    if today.date() in usda_dates.PROSPECTIVE_PLANTINGS_2026:
        releases.append("USDA Prospective Plantings, 11:00 AM CT")
    if today.date() in usda_dates.ACREAGE_2026:
        releases.append("USDA Acreage Report, 11:00 AM CT")

    if not releases:
        # 2026-08-11 incident: with no block at all here, the model was free to
        # believe the news cycle's WASDE anticipation meant the report had
        # ALREADY printed — Monday's briefing called the WASDE "Tuesday",
        # Tuesday's briefing inherited that via the weekly thread and published
        # "WASDE DELIVERS" a full day before the release. When a major report
        # is coming within the week, say so explicitly, in the negative.
        nw = usda_dates.next_wasde(today.date())
        if nw and (nw - today.date()).days <= 7:
            days = (nw - today.date()).days
            when = "TOMORROW" if days == 1 else nw.strftime("%A, %B %-d")
            return ("UPCOMING RELEASE — GROUNDING, NOT NEWS:\n"
                    f"  The next USDA WASDE is {when} at 11:00 AM CT. It has NOT been released. "
                    "No number from it exists yet. Anything in today's news about it is preview, "
                    "positioning, or analyst expectation — never its contents. Do not write that it "
                    "printed, landed, or confirmed anything, and do not resolve the weekly thread "
                    "with it. If a prior briefing misstated its date, this line is authoritative.")
        return ""
    header = "TODAY IS A USDA RELEASE DAY:\n  - " + "\n  - ".join(releases)
    header += (
        "\nLead with anticipation framing (\"...with [report] coming at [time], the market "
        "is positioning for...\"). Don't pretend to know the result. THE REPORT HAS NOT "
        "PRINTED YET as you write — this briefing goes out hours before it. Never use past "
        "tense about today's report. Reserve interpretation for tomorrow's briefing once "
        "the data is in."
        # 2026-08-12: the paragraph above was not enough — on WASDE morning the
        # model fabricated the report in TWO independent generations (both
        # blocked by the gate). The failure shape: a real overnight move plus a
        # weekly thread that mentions the report reads, to the model, like a
        # report reaction. Spell the rules out as hard constraints:
        "\nHARD RULES — a deterministic gate blocks the send on violation:"
        "\n  1. Today's report's numbers DO NOT EXIST yet. Any overnight or morning move"
        "\n     happened BEFORE the report: it is positioning, never reaction. Do not"
        "\n     attribute any price move to the report's contents."
        "\n  2. Headline, lead and action must frame the report as UPCOMING"
        "\n     (\"WASDE prints at 11 CT\", \"ahead of the report\") — never as having"
        "\n     printed, landed, delivered, dropped, confirmed, showed, or come in."
        "\n  3. If a prior briefing implied the report already came out, that was an"
        "\n     error — THIS block is authoritative."
    )
    return header


def build_system_prompt(market_status, past_tmyk_topics, yesterdays_call=None, weekly_thread=None, ongoing_situations="", editorial_notes="", past_one_number_topics=None, past_phrases=None, usda_release=""):
    weekend_instructions = ""
    if market_status["is_closed"]:
        day = market_status["day_name"]; reason = market_status["reason"]
        if reason == "weekend" and "Saturday" in day:
            weekend_instructions = (
                "\nWEEKEND MODE SATURDAY: Markets CLOSED. Write WEEK IN REVIEW + WEEKEND OUTLOOK. "
                "Reference 'Friday's close'. No overnight language.\n"
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
                "Reference 'Friday's close'. No overnight language.\n"
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
                f"The board is the last close, unchanged. "
                f"Rule 17 (level coherence) references the most recent close in locked_prices. "
                f"Rule 18 (macro anchoring) applies normally.\n"
            )

    banned_tmyk = ""   # v5.1: the_more_you_know is retired; nothing to exclude

    banned_one_number = ""
    if past_one_number_topics:
        banned_one_number = "ONE NUMBER TOPIC EXCLUSION (last 3 briefings):\n  - " + "\n  - ".join(past_one_number_topics) + "\nPick a different angle. The Number should be a fresh stat, not a repeat anchor."

    overused_phrases = ""
    if past_phrases:
        overused_phrases = "OVERUSED PHRASES (appeared 3+ times in the last 2 briefings):\n  - " + "\n  - ".join(past_phrases) + "\nAvoid these exact phrases today. Reach for different framing."

    # ══ TODAY'S CALL: RETIRED 2026-10-03 ═══════════════════════════════
    # The model used to write a one-session call (todays_call) that grade_calls
    # scored the next day; that was the old call scorecard, now retired and
    # archived. The briefing's one call is the prediction bot's, inserted by
    # insert_bot_call() after the model finishes. The model is told below not
    # to write a call, an action or a trade instruction at all.
    call_block = ""

    yesterdays_block = ""
    # v5.2: no is_closed condition. Saturday's issue holds Friday's closes and
    # is where Friday morning's call is scored; the selector decides, not the
    # weekday. When nothing is gradeable the caller passes None and this block
    # is absent.
    if yesterdays_call:
        _sc = yesterdays_call.get("structured_call")
        if _sc:
            _scdir = (_sc.get("direction") or "").lower()
            _scarrow = "above" if _scdir == "up" else "below"
            call_identity = (
                f"On {yesterdays_call['prior_date']}, your graded call was: "
                f"{_sc.get('instrument')} {_scdir}, toward {_scarrow} ${_sc.get('level')}.\n"
                f"This is the EXACT call scored automatically from today's close. Your "
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

Output as the yesterdays_call object in the JSON: {{"outcome": your best read ('played_out', 'didnt', or 'pending'), "note": ONE sentence, MAX 25 WORDS}}. The outcome is RE-COMPUTED deterministically from the actual close after you finish (direction AND level both must resolve in the call's favor), and the call itself is printed from the record, so do NOT restate what the call was. The note says what the market did against it and what that means today. A miss is a miss: 'Miss; beans stopped a nickel short of the line and the thesis is still live' beats a paragraph of replay.
"""

    # v5.1: weekly_thread is retired. The thread block, its Monday setup, its
    # Friday resolution and the release-day thread rule all left with it. The
    # parameter stays on the signature so the call sites did not have to move.
    thread_block = ""

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
        call_block.strip() if call_block else "",
        thread_block.strip() if thread_block else "",
    ) if b]
    context_blocks = "\n\n".join(_optional_blocks) if _optional_blocks else ""

    # v4.6: alias the module-level constants into local scope for the f-string below.
    CALENDAR_FACTS_2026_LOCAL = CALENDAR_FACTS_2026
    return f"""You are writing the AGSIST Daily, a morning farm markets briefing read every day by US producers across grain, livestock, dairy, and specialty operations. It goes out under Sig Lindquist's name. Sig is a Certified Crop Adviser (CCA) who works with farmers. Write it the way he would talk to a neighbor at the elevator.

══ THE VOICE ══

Plain words. Short sentences. Calm. Say what happened, why, and what it means, then stop. Sig is direct and practical, a little humble, and he never hypes anything. He says what he means once and does not oversell it. He explains the market; he never tells the reader what to do with their grain, livestock, fuel or inputs (RULE 11). National scope.

What that means on the page:
- Short, common words. "Says" not "indicates". "About" not "approximately". "Bought" not "acquired".
- Most sentences under 20 words. One idea per sentence.
- Calm at every size of move. A big day is described by its size ("the biggest day in three weeks"), never by excitement.
- Honest about what nobody knows. "Hard to say yet." "Nothing in the news explains it." That is a full answer when it is true.
- Farm talk where it fits: bushels, the board, cash bids, basis, combines, the bins, a load. No trading-desk slang and no Wall Street jargon.
- No clever lines, puns, wordplay or charts that "say" or "want" things. Plain statements of fact and plain opinion.
- No barking orders at the reader. "Corn under $5.00 would change the picture" is the voice; "Watch $5.00 now" is not.
- Proper capitalization, spelling and punctuation.

FIRST PERSON, AND THE ONE HARD LINE:
- First person only where it sounds natural, and only to frame an opinion: "I'd keep an eye on $5.00." "I think the market already knew that." "My read is the bounce is thin." "We'll see Thursday."
- NEVER invent an experience, a conversation, a place or an action Sig did not report. No "I talked to elevators today", "my neighbor said", "a buyer told me", "I sold some corn", "we hauled beans", "around here the combines are parked", "I'm hearing". You do not know what Sig did today. Every sentence like that is a made-up fact under a real man's name. A machine scans for them after you finish: a draft with one is thrown out and regenerated, and any left after that are cut.
- Most briefings need no first person at all. When in doubt, leave it out.

How Sig writes, in his own words: "I thought that was backwards." "I fix things fast when I know about them." "I won't pretend that's forever." "Keep one price." Short, plain, says it once.

VOICE SAMPLES. These are real AGSIST issues rewritten in Sig's voice, same facts and numbers. Write like THIS:

HEADLINE examples (sentence case, a plain statement of what happened, 6-10 words):
- "Corn holds $5 even with heavy grain stocks"
- "Crude up 5% after another tanker hit; soy oil down 3%"
- "Cattle and feeders up about 2% overnight; corn slips"

LEAD example (report day, from the 2026-10-06 issue):
"Corn is at $5.00 overnight, up 3 cents from Monday's $4.97¼ settle. That's after USDA put old-crop corn stocks at 2.10 billion bushels, 35% more than a year ago. The big number was no surprise, and corn is still sitting on $5."

LEAD example (active day, from the 2026-10-08 issue):
"Crude is at $92.61 overnight, up 4.9%, after another tanker was hit off Qatar. Soybean oil went the other way, down 3.1%, while meal gained 3.5%. Beans barely moved at $12.94, but the crush margin has already shifted toward meal."

LEAD example (quiet day, equally good, from the 2026-10-08 issue):
"Not much happened in corn. It's at $5.02½ overnight, up half a cent, right where it has been since it got back over $5 three sessions ago. Three quiet sessions in, $5 is still holding."

SECTION BODY example (from the 2026-10-05 issue), 2-3 bullet lines, each ONE sentence, "- " prefix, MAX 55 WORDS; the so-what goes in so_what, not in a trailing bullet:
"- Soybean oil gained 2.7% to **$68.27** and meal added 0.8% to $344.30.
- Beans only gained 7¾ cents to $12.89, so the products are pulling the soy complex, not bean demand."

SECTION BODY example (quiet, from the 2026-10-08 issue), 2 bullets is plenty:
"- Corn was up half a cent at **$5.02½**, about where it has sat for three sessions.
- Farmdoc says Corn Belt storage covers carry-in plus this harvest overall, but ten of thirteen states come up short locally."

SECTION BODY example (livestock, from the 2026-10-07 issue):
"- Live cattle are at **$221.23** overnight, up 1.8% from Tuesday's $217.25 settle, and feeders are up 2.0% to $340.50.
- There was no Cattle on Feed report behind it, so the move came from the cash side."

SO WHAT examples (adds something the title does not say, MAX 15 WORDS):
- "The market already knew the corn was there."
- "This is a crush story, not an export story."
- "Short local storage can weigh on basis even when futures sit still."
- "Nothing new today, so there is nothing to explain."

WATCH LIST examples (a level or a trigger, plainly said, MAX 20 WORDS each):
- "Thursday 7:30 a.m. CT: Export sales. Soybeans under 1.5 MMT would look soft next to the meal and oil split."
- "Ongoing: Corn back under $5.00 would say harvest supply is winning."
- "Ongoing: Another tanker attack could push WTI toward $95; a calm week could let it slip back toward $88."

NO ACTION FIELD. The briefing's one call ("The Action") is the AGSIST prediction bot's call, inserted by the machine after you finish, with its graded record beside it. You do not write it, preview it, agree or disagree with it, or mention it.

WORDS THAT FIT:
- "the board", "cash bids", "basis firmed" / "basis widened", "a load", "bushels"
- "the funds are buying" / "the funds are selling", only when the news or positioning data says so
- "the carry widened" / "the carry narrowed" (futures spread structure)
- "above/below [level] is the line"
- "watch" for a level or a report (an observation, never an instruction to trade)
- numbers with cents fractions when relevant: "$4.85¼" not "$4.85"
- "nothing in the news explains it, looks like the funds", only when the news bucket for that commodity is EMPTY and price still moved

WORDS TO SKIP:
- academic register: "indicates," "suggests," "reflects" → "says," "shows"; "elevated levels" → the actual level; "amid concerns" / "against the backdrop of" → cut; "market participants" → "the funds," "merchandisers," "farmers" (be specific); "investors are watching closely", "in light of recent developments" → cut
- machine tells, never use: "delve", "landscape", "navigate", "it's worth noting", "in today's [anything]", "game-changer", "unprecedented", "robust", "tapestry", "crucially", "notably", "underscores", "furthermore", "moreover", "pivotal", "in conclusion", "ultimately", "leverage", "deep dive"
- machine shapes, never use: "not just X but Y" / "isn't just X, it's Y"; three adjectives in a row ("volatile, uncertain and fragile"); em dashes
- hype, never use: "massive", "stunning", "staggering", "blockbuster", "whopping", "eye-popping"
- trader slang Sig does not use: "basis is talking" / "basis is yelling", "carry's working" / "carry's broken", "the funds got lost", "coiled spring", "the tape", "the $5 handle", "drag-day", "the chart says" / "the chart wants"

══ BANNED PHRASES (regression markers, DO NOT USE) ══
These are the specific clichés that signal you've drifted into trader-blog or wire-service voice. Each one must be rewritten plainer. NO exceptions.

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
  - "binary" / "binary level" / "binary week" / "binary support": trader-tech jargon, use "line in the sand", "make-or-break", "either/or" instead
  - "decisively below" / "decisively above" / "decisively through": risks claiming a break that the close contradicts; just describe the move ("right back to $X", "tested $X")
  - "referendum on": wire-blog cliche
  - "categorical" / "categorically": sounds like a press release
  - "exploded" / "explode" / "explosion": CNBC drama verb, use "ran", "moved hard", "had its biggest day in [N]" instead
  - "crater" / "cratered" / "cratering": same; use "fell hard", "dropped sharply", "lost [N] cents"
  - "crashed" / "crash" (as verb form): same; use "broke lower", "tumbled", "had its biggest drop in [N]"
  - "surge" / "surged" / "surging": wire-service drama; use "ran higher", "rose sharply", "pushed up [N]"
  - "soared" / "soaring" / "rocketed" / "skyrocketed" / "rocketed": same
  - "plunged" / "plunging" / "plummeted": same; use "fell hard" or state the size
  - "slashed" (verb): wire register; use "cut", "reduced", "pulled back"
  - "exodus" / "fleeing" / "panic": drama, not analysis; use "stepping out", "rotating", "liquidating"
  - "ignited" / "caught fire" / "torched" / "incinerated": drama
  - "bloodbath" / "carnage" / "meltdown" / "rout": never appropriate
  - "vaulted" / "leaped" / "leaped": drama verbs

Plainer ways to say them, the way Sig would:
  - "managed money is rotating" → "funds are getting out of corn, into beans"
  - "the chart wants to test $245" → "Next real support is $245"
  - "doesn't change the math" → "Doesn't change anything"
  - "no specific catalyst" → "Looks like fund liquidation, no news driving it"
  - "confirms on-pace" → "Belt is on schedule, no weather premium yet"
  - "remains the test" → "the line that has to break for the next leg"

GEOGRAPHIC SCOPE: National. NEVER narrow to "Wisconsin and Minnesota farmers" or any specific state.

HEADLINE NUMERALS: Always digit format. Write "9.2%" or "9%", not "NINE PERCENT". AI search engines query digits, not spelled-out numbers. The headline is the canonical anchor and must be queryable.

NEWS DISCIPLINE: News is INPUT, not flavor. The news block below is organized by bucket (GRAINS, LIVESTOCK, ENERGY, POLICY, WEATHER, MACRO). Every section with medium or high conviction MUST identify the catalyst, the news / data / event / report that drove or contextualizes the price action. If the relevant news bucket has NO recent items, you may write "no clean catalyst, looks like fund liquidation" or similar, but only if the bucket was actually empty. Default behavior: thread a specific news item from the relevant bucket into each section's body. Do NOT recap the news; weave it into the price story as the why. Lead with the price + so-what; the news is the why behind it. There is no separate catalyst field; the why lives in the bullets or it does not exist.
{context_blocks}

{CALENDAR_FACTS_2026_LOCAL}

══ WRITING RULES ══
1. NO EM DASHES (U+2014) OR EN DASHES (U+2013). Use periods, commas, semicolons, colons, parentheses. (Exception: standard hyphenated compounds like "old-crop" are fine.)
2. Every specific price comes from the LOCKED PRICE TABLE. No exceptions.
3. Never invent or recall prices from training data.
4. Describe moves exactly as shown.
5. Headline and every title in sentence case.
6. First person is for opinion only. Never invent something Sig did, saw, heard, sold or was told (THE VOICE). A machine checks.

══ TONE CALIBRATION ══
The vocabulary stays plain and calm at EVERY magnitude. Big moves get described by their size and rarity ("biggest day in three weeks"), NOT by drama verbs. This is Sig talking to farmers he knows, not a TV anchor.

- below 1.5%:    "eased", "ticked", "moved", "drifted", "ground", "settled"
- 1.5-2.5%:      "gained" / "fell", "added" / "gave back", "firmed" / "softened", "lifted" / "slipped"
- 2.5-3.5%:      "rose sharply" / "dropped sharply", "ran higher" / "broke lower", "pushed higher" / "pulled back hard"
- above 3.5%:    "ran" / "tumbled", "moved hard", "had its biggest day in [N] weeks/months". State the rarity, not the drama.

For genuinely once-a-decade events, you may use "historic" once. Otherwise describe the move by the size of the move ("9% in a single session, the biggest since [date]") and let the reader feel the weight. NEVER use drama verbs at any magnitude.

══ THE 16 IMPACT RULES ══

1. THE LEAD MUST DELIVER A "SO WHAT". Not a price recap. Specific price + synthesizing observation that interprets, contextualizes, or connects.

2. CONVICTION MUST BE EARNED. "Medium" is the cop-out. Default to "low" on quiet days. Reserve "high" for genuine directional thesis with data behind it.

3. THE LEDE MAY NOT DEFER. The LAST sentence of the lead states a consequence that is ALREADY TRUE: what today's close already did to a bushel, a load, a margin, a decision. It may not point forward. Banned as a closing sentence: "Tuesday's print decides", "the question is whether", "this week tells you", "will set", "holds the answer", "watch Thursday". The 2026-09-13 issue closed its lede with "The question is whether $12.99 holds or breaks." That is a promise, not a briefing. Write instead: "Every unpriced bushel is worth 24 cents less than it was Thursday." The forward pointer belongs in the watch list, which exists for it.

4. WATCH LIST: EXACTLY 3 ITEMS, EACH UNDER 20 WORDS, CONDITIONAL. At least two of the three must include a specific level, threshold, or trigger. Calendar entries are weakest.

5. SO WHAT MUST SYNTHESIZE, NOT RESTATE. Each section's so_what is MAX 15 WORDS and adds information beyond the section title. If inferable from the title alone, rewrite.

6. QUIET DAYS DESERVE QUIET BRIEFINGS. Do not manufacture drama. Acceptable: "Most days don't move markets. Today is one of them." Prefer 2 sections to 3. A reader who sees you call quiet days quiet trusts your loud days.

7. CONTINUITY: REWARD THE REGULAR READER. When past briefings are provided, connect today's move to the story they told, using only prices from today's LOCKED TABLE. Do not grade or restate a past call: there is no yesterdays_call block any more, and a verdict written from memory has printed the wrong direction before.

8. THE WORD BUDGET IS THE PRODUCT. The whole briefing is about 400 words of prose. 450 is a hard ceiling: anything over it is cut by a machine after you finish, weakest block first, and if it is still over, the run fails and nobody gets a briefing. It used to run 1,090 words and the reader who pays for this said he barely reads it. Per-field caps: lead 55; each section body 55; so_what 15; one_number.context 30; outside_the_pit body 30; each watch item 20. The way to hit budget is to CUT the weakest material, not to compress everything equally. A 2-section briefing at 350 words beats a 3-section briefing at 460.

9. VOICE, ABSOLUTELY NON-NEGOTIABLE. The briefing must sound like the VOICE SAMPLES above: Sig talking plainly to a neighbor. Reject your own draft for either of two failures. Wire-service neutral: a paragraph that could run unchanged in a Reuters or Bloomberg summary. Hype or trading-desk swagger: clever lines, slang, drama, commands at the reader. Rewrite either into plain, calm, specific sentences that still say what the move means. And never invent a first-person experience (THE VOICE, FIRST PERSON).

10. THE FORWARD TEST. Before you finalize the lead, ask: would a working farmer forward this lead with one line of context to another farmer? If the answer is no, rewrite. The lead is the entire product.

11. NO TRADE INSTRUCTIONS, ANYWHERE. Never tell the reader to buy, sell, price, lock, book, hedge, hold, wait on, store or forward-contract anything, in any field: not grain, not livestock, not fuel, not fertilizer. No "price 10% here", no "lock diesel now", no "sell the rally". Describe what the market did, why, and which level or report matters next; the reader decides. Do NOT emit an action, todays_call or yesterdays_call field: The Action is the prediction bot's call, inserted by the machine, and a past call is graded by code, not by you.

12. ONE FACT, ONE HOME. Every stat, story, and price move is told ONCE, in the one block where it does the most work. The one_number is NEVER re-explained in a section (a six-word pointer like "the Yanbu decline covered above" is the maximum). Weather forecasts get one full telling; every later mention is four words or fewer. Before finalizing, scan your own draft: any sentence that restates an earlier sentence gets deleted, not reworded. The Jul 24 issue told the same Saudi pipeline story twice word-for-word and mentioned the same heat forecast six times; that is the failure mode this rule exists to kill.

13. LEVEL COHERENCE: MATH SANITY ON SUPPORT/RESISTANCE CLAIMS. If the briefing claims a price level was BROKEN, BREACHED, BELOW, UNDER, ABOVE, or THROUGH a support/resistance level, the LOCKED CLOSE PRICE for that contract MUST be on the breaking side of that level. Self-check before finalizing every section and the lead:
  - If the close is HIGHER than the level cited, you may NOT write "broke $X", "below $X", "under $X", "decisively through $X", or "crashed through $X". Use instead: "tested $X", "pulled back to $X", "right back to $X", "held above $X by a hair".
  - If the close is LOWER than the level cited, you may NOT write "above $X", "held $X", "defended $X", "reclaimed $X". Use instead: "broke $X", "lost $X", "fell through $X".
  - The post-generation validator scans for "broke|below|under|above|over|through $XX.XX" patterns and cross-checks against the LOCKED PRICE TABLE. If it finds a contradiction, the briefing fails validation and you wasted a generation. Get this right the first time.
  - This rule applies retroactively too: when continuity-referencing prior briefings (e.g., "one day after Monday broke $252"), do NOT carry forward false break claims. If you cannot verify the prior close from the past_dailies block, soften to "one day after Monday tested $252".

14. ONE NUMBER RUBRIC: CANNOT BE A PRICE FROM THE CLOSES TABLE. The Number is the day's most interesting STAT. It earns its place by adding information beyond what the closes table already shows. Acceptable sources:
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

15. MACRO EVENT ANCHORING. The first time any briefing in a given week references an ongoing geopolitical or macro event (Iran tensions, Hormuz disruption, election cycle, Fed pivot, trade war, etc.), include a single anchoring clause that establishes what the event is and roughly when it began. Example: "...as Iran-Iraq tensions over the Strait of Hormuz, ongoing since March, eased on diplomatic progress." Subsequent briefings in the same week can reference shorthand. The reader who lands on this briefing for the first time should be able to follow the macro thread.

16. CLEAN OUTPUT MECHANICS. (a) NEVER write internal field names (one_number, watch_list, outside_the_pit, so_what) in reader-facing prose; say "today's number" or restructure the sentence. A published issue once printed "the one_number today". (b) Percent-of-range figures are 0-100 by definition; if a close sits at or beyond the top of its 52-week range, write "at the top of its 52-week range" or "a fresh 52-week high", never "102% of the range". (c) If the current spread/ratio setup (bean/corn ratio, carry structure) is genuinely at a decision threshold, it earns ONE bolded sentence inside the relevant section, with the acreage/storage logic stated CORRECTLY (a high bean/corn ratio pulls acres toward beans); there is no standalone spread block. (d) NEVER use emoji or pictographic symbols in ANY field, headline, titles, bodies, everywhere. Plain text only; the page chrome supplies its own glyphs. (e) THE LEAD MUST BE NEW. The headline, lead and teaser may only be built on something that happened since the previous briefing: an overnight or prior-session price move, a report released, a forecast that changed, a story in today's news block. A fact that was equally true a week ago cannot lead, however important it is. Two published failures, both caught by the reader and not by any check here: on 2026-08-26 the briefing promised a Pro Farmer number that had already been published, and on 2026-08-28, eight days after the tour ended, it led with "PRO FARMER DONE; SEPTEMBER WASDE HOLDS THE ANSWER" over the sentence "The Pro Farmer tour is in the rearview." Nothing about that had changed in over a week. The seasonal and background context in this prompt exists to keep you from getting the CALENDAR wrong; it is not a source of stories, and an instruction telling you NOT to say something is never itself the thing to say. Before finalizing, ask of the headline: what changed to make this true today? If the honest answer is "nothing", the day is a quiet one, lead with the price action and say it was quiet. A quiet day reported as quiet is a good briefing. A stale fact dressed as news is not.

══ OUTPUT, return valid JSON with EXACTLY these fields ══

{{
  "headline": "Sentence case, 6-10 words: capitalize only the first word, names and acronyms (USDA, WASDE). A plain statement of what happened. No wordplay, no puns, no ALL CAPS, no Title Case.",
  "lead": "2-3 sentences, MAX 55 WORDS (RULE 8). Specific price from table + synthesizing observation (RULE 1). Voice samples (RULE 9). Forward test (RULE 10). LAST SENTENCE states a consequence already true, never a pointer forward (RULE 3).",
  "teaser": "One plain sentence, max 18 words, for the collapsed hero bar and the archive index.",
  "one_number": {{"value": "The day's most interesting number, see ONE NUMBER RUBRIC (RULE 14).", "unit": "3-6 words DESCRIBING WHAT THE VALUE IS. Must be coherent with value. Wrong: value=1.4%, unit='live cattle decline' when the actual mover was feeders. Right: value=1.4%, unit='feeder cattle decline'.", "context": "1-2 sentences, MAX 30 WORDS. Why this number matters today and what it tells you that prices alone don't. This is the ONLY place this stat gets explained (RULE 12)."}},
  "sections": [
    {{"title": "3-5 words, sentence case", "body": "2-3 BULLET LINES, MAX 55 WORDS TOTAL. Each line starts with '- ' and is ONE sentence, separated by newline (\\n). Exactly ONE **bold** number per section, the price or the threshold that matters (markdown bold, NEVER <strong>). All prices from LOCKED TABLE. VOICE. The news that drove the move is IN a bullet (NEWS DISCIPLINE), not a separate field. The so-what belongs in so_what, not a trailing bullet.",
      "so_what": "MAX 15 WORDS. Synthesis beyond the title (RULE 5).",
      "conviction_level": "low | medium | high (earned per RULE 2)",
      "overnight_surprise": true/false}}
  ],
  "outside_the_pit": [
    {{"title": "Short headline of the news item, 6-12 words, sentence case.",
      "body": "1-2 sentences, MAX 30 WORDS, in the same plain voice. Why this matters even though it's not in today's prices.",
      "tag": "OPTIONAL. One-word category: POLICY, TRADE, WEATHER, DISEASE, LOGISTICS, INPUTS, MACRO, RURAL."}}
  ],
  "watch_list": [{{"time": "Time", "desc": "What. EXACTLY 3 items, each under 20 words. Two of three carry a level or threshold (RULE 4)."}}],
  "daily_quote": {{"text": "EXACT quote.", "attribution": "EXACT attribution."}},
  "source_summary": "Data sources",
  "date": "Like 'Monday, April 27, 2026'",
  "meta": {{"market_mood": "bullish|bearish|mixed|cautious|volatile", "heat_section": 0, "overnight_surprises_count": 0}}
}}

SECTIONS:
- Default weekday: Grains & Oilseeds / Livestock & Dairy / Energy & Inputs (Macro & Trade only when it moved a price today)
- MIN 2, MAX 3. If no story in a bucket, fold or OMIT. No padding. A fourth section is deleted by the machine, lowest conviction first, before anyone reads it.
- Quiet days: 2 sections (RULE 6).

OMISSIONS, set fields to null or empty objects when not applicable:
- action, todays_call, yesterdays_call: NEVER emit them (RULE 11). A machine deletes them if you do.
- outside_the_pit: REQUIRED every day, weekday and weekend. EXACTLY 1 item. Pull from the news block.
- watch_list: REQUIRED every day. EXACTLY 3 items.
- Do NOT emit these fields at all; they are retired and a machine deletes them: subheadline, the_takeaway, the_more_you_know, weekly_thread, catalyst, vs_yesterday, bottom_line, farmer_action, summary.

RESPOND WITH ONLY THE JSON OBJECT. No markdown. No preamble. No em dashes. Plain words in Sig's voice, and no invented first person."""



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


# ══ OVERNIGHT IS NOT A CLOSE (2026-10-06) ═══════════════════════════════════
# The Oct 6 issue led "Corn closed $5.00, up 3 cents" from a board fetched at
# 10:56Z -- 5:56 a.m. CT, the overnight session -- while the Oct 5 settle was
# $4.97 1/2 (the bot call in the same issue said so). The price table never
# told the model WHEN its numbers were from, so it called a live overnight
# quote a close. quote_timing() says it; the prompt passes it on; and
# validate_briefing() refuses a draft that calls an unsettled number "closed".
CBOT_GRAIN_CLOSE_CT = (13, 20)   # 1:20 p.m. CT, the day session's close
DAY_OPEN_CT = (8, 30)            # before this a live grain quote is overnight

def _frac_price(v):
    """$4.975 -> '$4.97½', the way the pit writes a bushel price."""
    try:
        c = round(float(v) * 400) / 4
    except (TypeError, ValueError):
        return ""
    w = int(c + 1e-9); f = round((c - w) * 4)
    if f == 4: w += 1; f = 0
    return f"${w / 100:.2f}" + ("", "\u00bc", "\u00bd", "\u00be")[f]

def quote_timing(fetched_iso, market_status=None, locked_changes=None):
    """When the board's numbers are from, and whether they are settlements.
    settled is True on a closed day (weekend/holiday), when the fetch is on a
    later calendar day than the quote session, or at/after the CBOT grain
    close. Otherwise the quotes are live: 'overnight' before 8:30 a.m. CT,
    'intraday' after. prev_settles maps each locked key to its previous
    settle (the feed's `open`, which holds the prior close)."""
    out = {"settled": True, "phase": "settle", "as_of": "", "quote_session": None,
           "prev_session": None, "prev_settles": {}}
    for k, v in (locked_changes or {}).items():
        if isinstance(v, dict) and v.get("prev") is not None:
            out["prev_settles"][k] = float(v["prev"])
    try:
        dt = datetime.fromisoformat(str(fetched_iso).replace("Z", "+00:00"))
        from zoneinfo import ZoneInfo
        ct = dt.astimezone(ZoneInfo("America/Chicago"))
    except Exception:
        return out
    try:
        import market_board as _mb
        qs, ps = _mb.quote_session(fetched_iso), _mb.prev_close_session(fetched_iso)
    except Exception:
        qs, ps = ct.date(), None
    out["quote_session"], out["prev_session"] = qs, ps
    out["as_of"] = ct.strftime("%-I:%M %p").replace("AM", "a.m.").replace("PM", "p.m.") + " CT"
    if market_status and market_status.get("is_closed"):
        return out
    hm = (ct.hour, ct.minute)
    if qs is not None and ct.date() == qs and hm < CBOT_GRAIN_CLOSE_CT:
        out["settled"] = False
        out["phase"] = "overnight" if hm < DAY_OPEN_CT else "intraday"
    return out

def price_timing_block(timing):
    """The prompt's statement of when the prices are from. Empty when settled."""
    if not timing or timing.get("settled"):
        return ""
    ps = timing.get("prev_session")
    psl = (ps.strftime("%a %b ") + str(ps.day)) if ps else "the previous session"
    lines = []
    for k, label in COMMODITY_LABELS.items():
        v = timing["prev_settles"].get(k)
        if v is None: continue
        lines.append(f"  {label}: " + (_frac_price(v) if k in GRAIN_KEYS else f"{v:,.2f}"))
    return (f"PRICE TIMING (HARD RULE): the prices above are {timing['phase'].upper()} quotes, "
            f"as of {timing['as_of']}, NOT settlements. The day session has not closed. "
            f"NEVER write that any of them 'closed', 'settled' or 'finished' at a price; say "
            f"'overnight', 'trading at', 'sits at' or 'as of {timing['as_of']}'. The change "
            f"column is measured against the previous settle. The PREVIOUS SETTLES ({psl}), "
            f"which are the only prices you may call a close or a settle:\n" + "\n".join(lines))

_CLOSE_CLAIM_RE = re.compile(
    r"\b(closed|closing|settled|settling|finished)\b"
    r"((?:\s+(?:up|down|higher|lower|flat|unchanged|at|near|around|just|on|the\s+day|"
    r"a\s+(?:penny|nickel|dime)|\d+(?:\s*[\u00bc\u00bd\u00be])?\s*cents?),?){0,5})"
    r"\s*\$([0-9]+(?:\.[0-9]+)?)\s*(\u00bc|\u00bd|\u00be|\s1/4|\s1/2|\s3/4)?",
    re.I)

def close_claims_on_live_quotes(text, timing):
    """Every 'closed $X' / 'settled at $X' in `text` whose X is not a previous
    settle, while the board is live. [] when the board is settled."""
    if not timing or timing.get("settled"):
        return []
    prevs = list(timing.get("prev_settles", {}).values())
    bad = []
    for m in _CLOSE_CLAIM_RE.finditer(text or ""):
        x = float(m.group(3))
        fr = (m.group(4) or "").strip()
        x += {"\u00bc": .0025, "1/4": .0025, "\u00bd": .005, "1/2": .005, "\u00be": .0075, "3/4": .0075}.get(fr, 0)
        # a written fraction must match to the quarter cent; a bare "$4.97" may be
        # the settle rounded or truncated to the cent
        tol = 0.0013 if fr else 0.0076
        if any(abs(x - p) <= max(tol, abs(p) * 0.0002) for p in prevs):
            continue
        bad.append(m.group(0).strip())
    # "the close didn't blink" (2026-10-06, an overnight board): the bare noun
    # names a settle that has not happened. A named past session ("Monday's
    # close", "Friday's settle") is fine and is not matched.
    for m in _BARE_CLOSE_RE.finditer(text or ""):
        bad.append(m.group(0).strip())
    return bad


_BARE_CLOSE_RE = re.compile(r"\b(?:the|today'?s|today\u2019s|this)\s+(?:close|settle|settlement)\b", re.I)


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
    _timing = quote_timing(price_data.get("fetched", ""), market_status, price_data.get("locked_changes"))
    _tb = price_timing_block(_timing)
    if _tb:
        locked_table += "\n\n" + _tb
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
TODAY'S AG NEWS DIGEST, USE THIS to thread the why into section bullets (NEWS DISCIPLINE) and to populate the one outside_the_pit item. Items are clustered by bucket and sorted recent-first. Each item has title + summary + age:
{news_block}

TODAY'S QUOTE (copy exactly):
Text: "{todays_quote['text']}"
Attribution: "{todays_quote['attribution']}"

Apply all 16 IMPACT RULES. Voice samples are NON-NEGOTIABLE: plain and calm, no wire-service neutral, no hype, no invented first person. Forward test the lead before you finalize, and check its last sentence against RULE 3. About 400 words, 450 is cut by a machine. Thread NEWS into every section's body, generic "fund positioning" without a specific news tie is wire filler. Rule 13 (level coherence) is failure-mode-zero: the post-gen validator will reject contradictory break claims."""

    payload = {"model": MODEL, "max_tokens": 4500, "thinking": {"type": "disabled"},   # Sonnet 5 thinks by default; that eats max_tokens and is billed
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
    _fell_back = False
    # One extra pass is allowed for the model fallback, so a refusal on the
    # last ordinary attempt still gets its one try on FALLBACK_MODEL.
    for attempt in range(MAX_RETRIES + 1):
        if attempt == MAX_RETRIES and not _fell_back:
            break
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
            _ref = _refused_model(e)
            if _ref and payload["model"] != FALLBACK_MODEL:
                print(f"::warning title=Briefing model fallback::'{payload['model']}' refused "
                      f"(HTTP {_ref[0]}: {_ref[1][:120]}); this briefing is written on {FALLBACK_MODEL}",
                      flush=True)
                payload["model"] = FALLBACK_MODEL
                # and for the rest of this run, so a regenerate after a bad
                # parse does not ask for the refused model a second time
                globals()["MODEL"] = FALLBACK_MODEL
                _fell_back = True
                continue
            if _sc is None:
                _sc = getattr(e, "code", None)
            if _sc is not None and 400 <= _sc < 500 and _sc != 429:
                # Permanent client error (e.g. 404 model-not-found, 401 bad key) -
                # retrying cannot help, so fail fast with a pointed hint.
                print(f"  [error] non-retryable HTTP {_sc} from Anthropic API; not retrying. "
                      f"Verify the model is current (this call used '{payload['model']}').", file=sys.stderr)
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


def validate_briefing(briefing, locked_prices, timing=None):
    warnings = []
    known_values = {k: v for k, v in locked_prices.items() if v and v > 0}
    # v5.1: the prose the price scan walks. Retired fields are read when
    # present (an old archive re-validated) but a new briefing never has them.
    parts = [briefing.get("headline", ""), briefing.get("lead", ""), briefing.get("subheadline", ""),
             briefing.get("the_takeaway", ""), briefing.get("action", "")]
    if briefing.get("one_number"): parts.append(briefing["one_number"].get("context", ""))
    for sec in briefing.get("sections", []):
        parts.append(sec.get("body", "")); parts.append(sec.get("so_what", "") or sec.get("bottom_line", ""))
        parts.append(sec.get("vs_yesterday", ""))
    tmyk = briefing.get("the_more_you_know") or briefing.get("tmyk") or {}
    parts.append(tmyk.get("body", ""))
    full_text = " ".join(parts)
    # v5.1 the cut: ONE word count (briefing_cut.word_count), and the ceiling
    # BLOCKS. enforce_budget() has already truncated deterministically before
    # this runs, so a briefing that is still over 450 here is one the machine
    # could not save; the run fails rather than the reader getting 1,090 words.
    _total = briefing_cut.word_count(briefing)
    if _total > briefing_cut.HARD_CEILING:
        warnings.append(f"Word budget: {_total} words total (hard ceiling {briefing_cut.HARD_CEILING}, target {briefing_cut.TARGET_WORDS})")
    _fc = briefing_cut.field_counts(briefing)
    _caps = {"lead": briefing_cut.CAP_LEAD, "action": briefing_cut.CAP_ACTION,
             "one_number.context": briefing_cut.CAP_ONE_NUMBER_CONTEXT,
             "yesterdays_call.note": briefing_cut.CAP_YC_NOTE}
    for _k, _n in _fc.items():
        cap = _caps.get(_k)
        if cap is None and _k.startswith("sections[") and _k.endswith(".body"): cap = briefing_cut.CAP_SECTION_BODY
        if cap is None and _k.endswith(".so_what"): cap = briefing_cut.CAP_SO_WHAT
        if cap is None and _k.startswith("watch_list["): cap = briefing_cut.CAP_WATCH_DESC
        if cap is None and _k.startswith("outside_the_pit[") and _k.endswith(".body"): cap = briefing_cut.CAP_OTP_BODY
        if cap is not None and _n > cap:
            warnings.append(f"Field cap: {_k} {_n}w (cap {cap})")
    if len(briefing.get("sections") or []) > briefing_cut.MAX_SECTIONS:
        warnings.append(f"Section count: {len(briefing['sections'])} (max {briefing_cut.MAX_SECTIONS})")
    for _rf in briefing_cut.RETIRED_FIELDS:
        if briefing.get(_rf): warnings.append(f"Retired field emitted: {_rf}")
    for _i, _sec in enumerate(briefing.get("sections") or []):
        for _rf in briefing_cut.RETIRED_SECTION_FIELDS:
            if _sec.get(_rf): warnings.append(f"Retired field emitted: sections[{_i}].{_rf}")
    # v5.5: no "action missing" warning. The model no longer writes one; The
    # Action is the prediction bot's line, inserted after this check by
    # insert_bot_call(), and left out when the bot has no fresh call.
    _defer = briefing_cut.lede_defers(briefing.get("lead", ""))
    if _defer:
        warnings.append(f"Lede deferral: last sentence points forward | \"{_defer}\"")
    # 2026-10-06: a live overnight/intraday quote called a close. BLOCKS: it is a
    # false statement of fact about a price, not a voice nit. "closed $X" is
    # allowed only where X is a previous settle. The headline, lead, sections
    # and so_what are all in full_text.
    for _c in close_claims_on_live_quotes(full_text, timing):
        warnings.append(f"Live quote called a close: \"{_c}\" -- the board is {timing['phase']} "
                        f"as of {timing['as_of']}; only a previous settle may be called closed/settled")
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
    # v5.1: "Word budget" LEFT this tuple. It sat here from v5.0 and the
    # briefing drifted to 1,090 words with every run green. The ceiling is a
    # product rule now, enforced by truncation first and by this flag second.
    # "Field cap", "Retired field", "Lede deferral" and "Action missing" stay
    # non-blocking: enforce_budget already clamped the fields, the retired
    # fields are stripped, and the lede rule is a prose heuristic the critic
    # owns (Rule 3).
    NON_BLOCKING = ("not in prices.json", "Em dash", "En dash",
                    "Geo scope", "Quote attribution filler",
                    "Field cap", "Retired field", "Lede deferral", "Action missing",
                    "Section count")
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
    "active": False, "label": "SPONSOR \u00b7 1 SLOT", "advertiser": "AGSIST",
    "headline": "Sponsor the AGSIST Daily Briefing: $149 a month, first month free.",
    "body": "One ag company per issue. Your message reaches working US producers across grain, cattle, dairy, and specialty operations, who read it every morning before the open. Rate locked in for 12 months from start date. No minimum, cancel anytime. First month free.",
    "cta_text": "Become the sponsor",
    "cta_url": "mailto:sig@farmers1st.com?subject=AGSIST%20Daily%20sponsor%20inquiry",
    "disclosure": "One sponsor, one issue. No retargeting. No programmatic auctions. Reply or call 715-797-2428.",
    "is_house_ad": True,
}


def sponsor_cta_urls(sponsor):
    """{surface: tagged url} for the pages that draw the ad in the browser.

    The homepage and the live /daily page render from data/daily.json with
    components/sponsor-ad.js, which cannot import scripts/sponsor_links.py. So
    the tagged links are made HERE, by the one definition, and carried in the
    file. Before this the homepage and /daily used the bare cta_url and every
    click from them reached the sponsor's analytics untagged.
    """
    url = sponsor.get("cta_url") or ""
    if not url or sponsor.get("is_house_ad"):
        return {}
    try:
        import sponsor_links
        slug = sponsor.get("slug") or "sponsor"
        return {s: sponsor_links.tag(url, s, slug) for s in ("homepage", "daily_page", "archive")}
    except Exception as e:
        print(f"  [warn] sponsor links not tagged ({type(e).__name__}: {e})")
        return {}


# 2026-10-01 owner disclosure: an insurance sponsor may compete with the
# owner's own agency, so every surface fed from here (homepage, archive,
# RSS, the email) says so next to the sponsor's own disclosure.
OWNER_SPONSOR_NOTE = "AGSIST's founder also owns Farmers First Agri Service LLC in Chetek, WI (crop insurance, agronomy and ag technology services; a licensed crop-insurance agency) and Loke Drone LC (agricultural drone spraying), which may compete with this sponsor. Sponsors never change data, rankings or bid order."


OWNER_SPONSOR_RX = "insurance|spray|drone|aerial|agronom|fertili"


def _owner_note_text(sp):
    disc = sp.get("disclosure") or ""
    if sp.get("is_house_ad"):
        return disc
    # 2026-10-07 (Sig): no disclaimer line on a paid ad, anywhere it runs. The
    # SPONSORED label is the disclosure; the owner's other businesses are on
    # /about, /terms and /sponsor.
    return ""
    hay = " ".join(str(sp.get(k) or "") for k in ("advertiser", "headline", "body", "disclosure"))
    if re.search(OWNER_SPONSOR_RX, hay, re.I) and "Farmers First" not in disc:
        return (disc + " " + OWNER_SPONSOR_NOTE) if disc else OWNER_SPONSOR_NOTE
    return disc


def _owner_note(d):
    d["disclosure"] = _owner_note_text(d)
    return d


def build_sponsor_block():
    if SPONSOR_OVERRIDE:
        out = dict(SPONSOR_OVERRIDE)
        out.setdefault("label", "SPONSORED"); out.setdefault("active", True)
        out.setdefault("is_house_ad", False)
        out["cta_urls"] = sponsor_cta_urls(out)
        return _owner_note(out)
    sponsor_path = REPO_ROOT / "data" / "sponsor.json"
    if sponsor_path.exists():
        try:
            with open(sponsor_path) as f: data = json.load(f)
            if data.get("active"):
                data.setdefault("label", "SPONSORED"); data.setdefault("is_house_ad", False)
                data["cta_urls"] = sponsor_cta_urls(data)
                return _owner_note(data)
        except Exception as e:
            print(f"  [warn] sponsor.json unreadable: {e}", file=sys.stderr)
    return dict(SPONSOR_HOUSE_AD)


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


def render_section_body_html(body):
    """v5.0 briefing diet: section bodies are 2-3 '- ' bullet lines. Render
    them as a real <ul>; any non-bullet line renders as a closing sentence.
    Old archive JSONs with paragraph bodies fall through unchanged."""
    lines = [ln.strip() for ln in (body or "").split("\n") if ln.strip()]
    bullets = [ln[2:].strip() for ln in lines if ln.startswith("- ")]
    rest = [ln for ln in lines if not ln.startswith("- ")]
    if not bullets:
        return html_esc_preserve_strong(body or "")
    lis = "".join(f"<li>{html_esc_preserve_strong(b)}</li>" for b in bullets)
    tail = "".join(f'<div class="dv3-sec-sowhat">{html_esc_preserve_strong(r)}</div>' for r in rest)
    return f'<ul class="dv3-sec-bullets">{lis}</ul>{tail}'


def js_esc(s):
    if s is None: return ""
    return (str(s).replace("\\", "\\\\").replace("'", "\\'").replace("\n", " ")
            .replace("\r", " ").replace("\u2028", " ").replace("\u2029", " "))


OG_IMAGE_FALLBACK = "https://agsist.com/img/og/agsist.jpg"
SOCIAL_CARD_DIR = REPO_ROOT / "data" / "social"


def og_image_for(date_iso, require_file=False):
    """The dated social card, or the generic image when there is no card.

    require_file=False is the LIVE path and must stay that way: daily.yml
    renders the card AFTER generate_daily writes the page, so at the moment
    this is called for today's issue the PNG does not exist yet. Checking the
    disk there would point every new issue at the generic image.

    require_file=True is for re-rendering the backlog.
    scripts/rebuild_archive_html.py redraws all 185 archive pages from the
    CURRENT template, and cards only exist from 2026-07-18 -- 59 of 185. Before
    this check a full rebuild pointed 126 published pages at a PNG that does
    not exist and never will, silently breaking their social preview. The
    fallback is the image those pages already carry, so a rebuild leaves them
    exactly as they are.
    """
    if not OG_IMAGE_BASE:
        return OG_IMAGE_FALLBACK
    if require_file and not (SOCIAL_CARD_DIR / f"card-{date_iso}.png").exists():
        return OG_IMAGE_FALLBACK
    return f"{OG_IMAGE_BASE}{date_iso}.png"



def _sponsor_cta(sponsor, surface):
    """The sponsor's destination with this surface's attribution on it.

    ONE definition, in scripts/sponsor_links.py. data/sponsor.json holds the
    bare url: parameters written in by hand would be inherited by every
    surface, and the email would then report inbox clicks as page clicks.
    """
    url = sponsor.get("cta_url") or "#"
    if url == "#" or sponsor.get("is_house_ad"):
        return url            # the house ad points at our own inbox
    try:
        import sponsor_links
        return sponsor_links.tag(url, surface, sponsor.get("slug") or "sponsor")
    except Exception as e:
        print(f"  [warn] sponsor link not tagged ({type(e).__name__}: {e})")
        return url


def _sa_fact(f):
    """"40+ carriers" -> <b>40+</b> carriers. Mirrors fact() in
    components/sponsor-ad.js; scripts/sponsor-checks.mjs holds the two equal."""
    m = re.match(r"^([0-9][0-9,.+%]*)\s+([\s\S]+)$", str(f if f is not None else ""))
    return f"<b>{html_esc(m.group(1))}</b> {html_esc(m.group(2))}" if m else html_esc(f)


def _sa_tel(p):
    d = re.sub(r"\D", "", str(p or ""))
    if len(d) == 11 and d[0] == "1":
        d = d[1:]
    return "tel:+1" + d if len(d) == 10 else ""


def render_sponsor_block_html(sponsor, surface="archive", slot=None):
    """THE SAME MARKUP components/sponsor-ad.js WRITES, IN PYTHON.

    The archive pages are static and are drawn here; the homepage and /daily
    are drawn in the browser by the JS renderer. scripts/sponsor-checks.mjs
    renders one sponsor through both and fails on a single differing byte, so
    the ad on an archive page is the ad on the homepage is the ad the sponsor
    approved. The look is components/sponsor-ad.css, linked by every page.

    surface picks the tagged link (see scripts/sponsor_links.py). slot, when
    given and the ad is paid, adds the measurement attributes that
    components/sponsor-metrics.js counts.
    """
    if not sponsor: return ""
    sp = sponsor
    house = bool(sp.get("is_house_ad"))
    slot = str(slot) if (slot and not house) else ""
    adv = sp.get("advertiser") or ""
    urls = sp.get("cta_urls") or {}
    url = urls.get(surface) or (_sponsor_cta(sp, surface) if sp.get("cta_url") else "") or "#"
    ext = bool(re.match(r"^https?:", url, re.I))
    click = f' data-sponsor-click="{html_esc(slot)}"' if slot else ""
    h = []
    aria = "Sponsor this slot" if house else "Sponsored: " + adv
    h.append(f'<aside class="sa-ad{" sa-ad--house" if house else ""}" aria-label="{html_esc(aria)}"'
             + (f' data-sponsor-slot="{html_esc(slot)}"' if slot else "") + ">")
    h.append(f'<div class="sa-top"><span class="sa-label">{html_esc(sp.get("label") or "SPONSORED")}</span>'
             + (f'<span class="sa-by">{html_esc(adv)}</span>' if (adv and not house) else "") + "</div>")
    h.append('<div class="sa-main">')
    if sp.get("logo") and not house:
        h.append(f'<div class="sa-logo"><img src="{html_esc(sp.get("logo"))}" alt="{html_esc(adv + " logo")}" '
                 'loading="lazy" decoding="async" onerror="this.parentNode.className+=\' sa-logo--text\'">'
                 f'<span class="sa-wordmark">{html_esc(adv)}</span></div>')
    h.append(f'<div class="sa-copy"><div class="sa-headline">{html_esc(sp.get("headline"))}</div>'
             f'<p class="sa-body">{html_esc(sp.get("body"))}</p></div>')
    h.append("</div>")
    facts = sp.get("facts") if (not house and sp.get("facts")) else []
    if facts:
        h.append('<ul class="sa-facts">' + "".join(f"<li>{_sa_fact(f)}</li>" for f in facts) + "</ul>")
    h.append(f'<div class="sa-actions"><a class="sa-cta" href="{html_esc(url)}" rel="sponsored noopener"'
             + (' target="_blank"' if ext else "") + click + ">"
             + html_esc(sp.get("cta_text") or "Learn more")
             + ' <span class="sa-cta-arrow" aria-hidden="true">&rarr;</span></a>')
    t = "" if house else _sa_tel(sp.get("phone"))
    if t:
        h.append(f'<a class="sa-phone" href="{t}" rel="sponsored"{click}>'
                 f'<span class="sa-phone-k">or call</span> {html_esc(sp.get("phone"))}</a>')
    h.append("</div>")
    if _owner_note_text(sp):
        h.append(f'<p class="sa-disc">{html_esc(_owner_note_text(sp))}</p>')
    h.append("</aside>")
    return "".join(h)


def render_forward_block_html(date_iso):
    return ('<div class="dv3-forward">'
            '<div class="dv3-forward-content">'
            '<div class="dv3-forward-headline">Know a farmer who&rsquo;d want this?</div>'
            '<div class="dv3-forward-sub">Forward this briefing. Or new here? Subscribe in one tap.</div>'
            '</div>'
            '<a class="dv3-forward-cta" href="https://agsist.com/daily?subscribe=1">Subscribe &rarr;</a>'
            '</div>')


def render_byline_block_html():
    return ('<div class="dv3-byline">'
            'Written by <strong>Sigurd Lindquist</strong>, founder. Reply at '
            '<a href="mailto:sig@farmers1st.com">sig@farmers1st.com</a>. I read everything.'
            '</div>')


def render_sponsor_attribution_html(sponsor, surface="archive"):
    """Tiny single-line sponsor attribution that sits between the date and
    the headline. Renders 'Today's sponsor: [Name] \u2192' when paid, or
    'Sponsor this slot \u2192' when house-ad. Click-through goes to the same
    cta_url the main sponsor block uses."""
    if not sponsor: return ""
    is_house = sponsor.get("is_house_ad", False)
    cta_url = html_esc(_sponsor_cta(sponsor, surface))
    target = ' target="_blank"' if cta_url.startswith('http') else ''
    rel_attr = ' rel="sponsored noopener"' if not is_house else ''
    if is_house:
        text = "&#x25CF; Sponsor this slot &rarr;"
        cls = "dv3-spattr dv3-spattr--house"
    else:
        advertiser = html_esc(sponsor.get("advertiser", "")).strip()
        if not advertiser: return ""
        text = f"&#x25CF; Today's sponsor: <strong>{advertiser}</strong> &rarr;"
        cls = "dv3-spattr dv3-spattr--paid"
    return (f'<a class="{cls}" href="{cta_url}"{target}{rel_attr} aria-label="Sponsor information">'
            f'{text}</a>')


def render_yesterdays_call_block_html(yc, market_closed=False):
    """yc is briefing.get('yesterdays_call') dict. Skip on weekends/holidays
    or when there is no call to show. v5.1: the line is `call_line`, written
    deterministically by grade_calls.plain_call from the structured call and
    the two closes; `summary` (the model's prose) is read only for archived
    issues that predate the cut."""
    if not yc or market_closed: return ""
    summary = html_esc((yc.get("call_line") or yc.get("summary") or "").strip())
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
            f'<span class="dv3-thread-day">{day_text}</span>'
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
    label_sub = ("Not moving prices today, but worth knowing."
                 if not market_closed else
                 "Coming up next week.")
    return (f'<div class="dv3-otp" aria-label="{label_text}">'
            f'<div class="dv3-otp-header">'
            f'<span class="dv3-otp-label">{label_text}</span>'
            f'<span class="dv3-otp-sub">{label_sub}</span>'
            f'</div>'
            f'<div class="dv3-otp-grid">' + "".join(rendered_items) + '</div>'
            f'</div>')


def render_takeaway_block_html(takeaway):
    """v4.3: render the_takeaway as a prominent committable-statement card.
    v5.1: the_takeaway is retired; this stays only for archived issues that
    carry one. Empty string or missing field → no render."""
    if not takeaway or not isinstance(takeaway, str):
        return ""
    text = takeaway.strip()
    if not text:
        return ""
    return (f'<div class="dv3-takeaway" role="note" aria-label="Today\'s key takeaway">'
            f'<span class="dv3-takeaway-label">THE TAKEAWAY</span>'
            f'<p class="dv3-takeaway-text">{html_esc(text)}</p>'
            f'</div>')


def render_action_block_html(action, bot_call=None):
    """THE ACTION, in the slot the takeaway used to hold. v5.5: the text is
    the prediction bot's line (bot_call present), with a link to its record
    and method. An archived pre-v5.5 issue has no bot_call and keeps its
    original, model-written action as published. Empty → no render."""
    if not action or not isinstance(action, str):
        return ""
    text = action.strip()
    if not text:
        return ""
    src = ""
    label = "THE ACTION"
    if bot_call:
        label = (bot_call.get("label") or "BOT CALL") if isinstance(bot_call, dict) else "BOT CALL"
        src = ('<p class="dv3-action-src">From the AGSIST prediction bot, a fixed statistical rule '
               'graded by code. Not advice. <a href="/scorecard">Record and method &rarr;</a></p>')
    return (f'<div class="dv3-takeaway dv3-action" role="note" aria-label="Today\'s action">'
            f'<span class="dv3-takeaway-label">{label}</span>'
            f'<p class="dv3-takeaway-text">{html_esc_preserve_strong(text)}</p>'
            f'{src}'
            f'</div>')


def render_harvest_clock_html(block):
    """The harvest price clock (scripts/harvest_clock.py): RMA's running
    harvest price against its projected price, with RMA's as-of date. The
    block is only in an issue generated inside the window from a fresh RMA
    file; an archive page is that day's snapshot and keeps its as-of date."""
    if not isinstance(block, dict) or not block.get("lines"):
        return ""
    lines = "".join(f'<p class="dv3-hclock-line">{html_esc(x)}</p>' for x in block["lines"])
    url = html_esc(block.get("url") or "/harvest-price-tracker")
    return (f'<div class="dv3-hclock" role="note" aria-label="Harvest price clock">'
            f'<div class="dv3-hclock-label">Harvest price clock</div>{lines}'
            f'<p class="dv3-hclock-note">{html_esc(block.get("note") or "")} '
            f'<a href="{url}">Harvest price tracker &rarr;</a></p></div>')


def render_cashbids_footer_html(market_closed):
    """v4.3: weekday-only inline cash-bids conversion footer.
    Sits below byline, above share row. Skipped on weekends/holidays."""
    if market_closed:
        return ""
    return ('<a class="dv3-cashbids-cta" href="/cash-bids" '
            'aria-label="View your local cash bids">'
            '<span class="dv3-cashbids-icon">$</span>'
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


# ── SEO head for /daily/YYYY-MM-DD (2026-10-06) ─────────────────────────────
# The title used to be "AGSIST Daily — Tuesday, October 6, 2026: <HEADLINE IN
# CAPS>" — 67 to 101 characters, so Google cut every one before the headline
# finished, and the part it kept was the same boilerplate on 207 pages. Now:
# the headline first, in sentence case, then a short date and the brand.
# The meta description used to be "<CAPS HEADLINE> — <lead cut at 160>", and
# og/twitter used the one-line teaser (18 of them under 70 characters). One
# description now serves all four, built from the day's own lead, ending on a
# whole sentence or a word boundary with an ellipsis — never mid-word.
# rebuild_daily_heads.py-style backfills import these same functions, so the
# head a page was published with and the head a backfill writes cannot drift.
DAILY_TITLE_MAX = 66
DAILY_DESC_MIN, DAILY_DESC_MAX = 120, 160
DAILY_AUTHOR = {"@type": "Person", "name": "Sigurd Lindquist", "url": "https://agsist.com/about"}

_HL_ACRONYMS = {
    "USDA", "WASDE", "CBOT", "CME", "COT", "COF", "CT", "ET", "PM", "AM", "US", "U.S.",
    "EU", "UK", "EPA", "CHS", "ETF", "ZC", "ZS", "ZW", "ZM", "ZL",
    "OPEC", "NASS", "FSA", "RFS", "EIA", "WTI", "LNG", "GDP", "CPI", "FOMC", "NOPA",
    "FAO", "RMA", "PLC", "CFTC", "MGEX", "KC", "SRW", "HRW", "HRS", "DDGS",
    "USMCA", "WTO", "IGC", "CONAB", "BAGE", "NOAA", "ENSO", "NWS", "USTR", "NAFTA",
}
_HL_PROPER = {w.upper(): w for w in (
    "China Chinese Iran Iranian Hormuz Brent Saudi Yanbu Gulf Cargill Trump Xi "
    "Brazil Brazilian Argentina Argentine Mexico Mexican Canada Canadian Ukraine "
    "Russia Russian India Japan Europe European Midwest Washington Congress Senate "
    "Israel Venezuela Australia Australian Tyson JBS ADM Bunge Deere Chicago "
    "Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February "
    "March April June July August September October November December "
    "Christmas Thanksgiving Easter"
).split()}
_HL_PROPER.update({"JBS": "JBS", "ADM": "ADM"})
_HL_PHRASES = (("pro farmer", "Pro Farmer"), ("memorial day", "Memorial Day"),
               ("labor day", "Labor Day"), ("corn belt", "Corn Belt"),
               ("cattle on feed", "Cattle on Feed"), ("new year", "New Year"),
               ("independence day", "Independence Day"), ("white house", "White House"),
               ("supreme court", "Supreme Court"), ("black sea", "Black Sea"))
_HL_DANGLING = {"a", "an", "and", "as", "at", "by", "for", "from", "in", "into", "of",
                "on", "or", "the", "to", "with", "while", "after", "ahead", "before",
                "than", "vs", "its", "their"}
_MON_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def sentence_case_headline(h):
    """ALL-CAPS headline -> sentence case, keeping acronyms and proper nouns.

    A headline that already has lowercase letters is left as written (only its
    first letter is raised). A token glued to a digit ("$700M", "7:30") is
    left alone, and so is anything in _HL_ACRONYMS.
    """
    h = re.sub(r"\s+", " ", str(h or "")).strip()
    if not h:
        return ""
    letters = [c for c in h if c.isalpha()]
    upper = sum(1 for c in letters if c.isupper())
    if letters and upper / len(letters) < 0.8:
        return h[0].upper() + h[1:]

    def word(m):
        w = m.group(0)
        start = m.start()
        if start > 0 and h[start - 1].isdigit():
            return w                                   # 700M, 52-WEEK stays as unit
        core, tail = w, ""
        pm = re.match(r"^(.*?)(['’]S)$", w)
        if pm:
            core, tail = pm.group(1), pm.group(2).lower()
        if core in _HL_ACRONYMS or core.rstrip(".") in _HL_ACRONYMS:
            return core + tail
        if core in _HL_PROPER:
            return _HL_PROPER[core] + tail
        return core.lower() + tail

    out = re.sub(r"[A-Za-z][A-Za-z.]*(?:['’][A-Za-z]+)?", word, h)
    out = out.replace("U.s.", "U.S.")
    low = out.lower()
    for ph, rep in _HL_PHRASES:
        i = low.find(ph)
        while i != -1:
            out = out[:i] + rep + out[i + len(ph):]
            i = low.find(ph, i + len(ph))
    # Words that are a name in one sense and an ordinary word in another:
    # "May corn" vs "corn may test $5"; "the Fed" vs "fed cattle".
    out = re.sub(r"\bmay (?=(?:corn|beans|soybeans|wheat|futures|contracts?|cattle|hogs|milk|meal|oil)\b)", "May ", out)
    out = re.sub(r"\bfed\b(?! (?:cattle|steers?|heifers?|beef|hogs?))", "Fed", out)
    for i, c in enumerate(out):
        if c.isalpha():
            out = out[:i] + c.upper() + out[i + 1:]
            break
    return out


def fix_headline_case(briefing):
    """Headline and every title in sentence case (2026-10-09). The prompt asks
    for sentence case; this makes it so. ALL CAPS goes through
    sentence_case_headline (it knows the acronyms); Title Case through
    voice_lint.fix_case, which leaves a title alone rather than guess at a
    name. Returns the briefing."""
    if not isinstance(briefing, dict):
        return briefing
    if isinstance(briefing.get("headline"), str) and briefing["headline"].strip():
        briefing["headline"] = sentence_case_headline(briefing["headline"])
    for key in ("sections", "outside_the_pit"):
        for item in briefing.get(key) or []:
            if isinstance(item, dict) and isinstance(item.get("title"), str) and item["title"].strip():
                item["title"] = sentence_case_headline(item["title"])
    try:
        import voice_lint as _vl
        briefing, _ = _vl.fix_case(briefing)
    except Exception as _e:
        print(f"  [warn] title case pass skipped ({type(_e).__name__}: {_e})")
    return briefing


def _short_date(date_iso):
    try:
        d = datetime.strptime(date_iso, "%Y-%m-%d")
        return f"{_MON_ABBR[d.month - 1]} {d.day}, {d.year}"
    except Exception:
        return date_iso


def _trim_words(text, limit, ellipsis="…"):
    """Cut text to <= limit chars at a word boundary, ending in an ellipsis.
    Drops trailing punctuation and dangling little words so it never ends on
    "…the other …" or "…support and…"."""
    text = text.strip()
    if len(text) <= limit:
        return text
    words = text[: limit - len(ellipsis) + 1].split(" ")
    if len(words) > 1:
        words = words[:-1]                     # last piece may be a half word
    while len(words) > 1 and (words[-1].lower().strip(",;:—–-") in _HL_DANGLING
                              or not words[-1].strip(",;:—–-.")):
        words = words[:-1]
    out = " ".join(words).rstrip(" ,;:—–-.")
    return out + ellipsis


def daily_page_title(briefing, date_iso):
    """'Corn holds $5 as grain stocks come in heavy | Oct 6, 2026 | AGSIST'.
    Plain text (escape it for HTML). Never longer than DAILY_TITLE_MAX."""
    hl = sentence_case_headline(briefing.get("headline") or "") or "Daily ag market briefing"
    hl = hl.rstrip(" .;:,")
    dated = f" | {_short_date(date_iso)}"
    brand = " | AGSIST"
    # Headline first; the brand is the first thing to give way (Google shows
    # the site name above the result anyway), the headline the last.
    if len(hl) + len(dated) + len(brand) <= DAILY_TITLE_MAX:
        return hl + dated + brand
    if len(hl) + len(dated) > DAILY_TITLE_MAX:
        hl = _trim_words(hl, DAILY_TITLE_MAX - len(dated))
    return hl + dated


def _plain(s):
    s = re.sub(r"<[^>]+>", "", str(s or ""))
    s = s.replace("**", "").replace("__", "")
    return re.sub(r"\s+", " ", s).strip()


def daily_page_description(briefing):
    """120-160 chars of the day's own words: whole sentences of the lead when
    they fit, else the lead plus the teaser, else the lead cut at a word
    boundary with an ellipsis. Nothing here is written by this function."""
    lead = _plain(briefing.get("lead"))
    extras = [_plain(briefing.get(k)) for k in ("teaser", "subheadline")]
    extras = [e for e in extras if e]
    if not lead:
        lead = " ".join(extras) or "AGSIST Daily morning ag market briefing: grain, livestock and dairy futures, weather and the reports to watch."
        extras = []
    sents = re.split(r"(?<=[.!?])\s+(?=[A-Z$0-9\"“])", lead)
    acc = ""
    for s in sents:
        nxt = (acc + " " + s).strip()
        if len(nxt) > DAILY_DESC_MAX:
            break
        acc = nxt
    if len(acc) >= DAILY_DESC_MIN:
        return acc
    for e in extras:
        if acc and e.lower() not in acc.lower():
            e2 = e if e[-1:] in ".!?" else e + "."
            cand = (acc + " " + e2).strip()
            if DAILY_DESC_MIN <= len(cand) <= DAILY_DESC_MAX:
                return cand
    if len(lead) <= DAILY_DESC_MAX:
        joined = lead
        for e in extras:
            e2 = e if e[-1:] in ".!?" else e + "."
            if e.lower() not in joined.lower() and len(joined) + 1 + len(e2) <= DAILY_DESC_MAX:
                joined += " " + e2
        return joined
    return _trim_words(lead, DAILY_DESC_MAX)


def _jsonld(obj):
    """JSON-LD for a <script> block: real JSON (not HTML-escaped text), with
    "</" broken so no string can close the script element."""
    return json.dumps(obj, ensure_ascii=False, indent=2).replace("</", "<\\/")


def daily_page_jsonld(briefing, date_iso, description, og_image_url):
    url = f"https://agsist.com/daily/{date_iso}"
    hl = sentence_case_headline(briefing.get("headline") or "") or "AGSIST Daily briefing"
    article = {
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": hl[:110],
        "datePublished": date_iso,
        "dateModified": briefing.get("generated_at") or date_iso,
        "description": description,
        "image": og_image_url,
        "author": DAILY_AUTHOR,
        "publisher": {"@type": "Organization", "name": "AGSIST", "url": "https://agsist.com"},
        "mainEntityOfPage": {"@type": "WebPage", "@id": url},
    }
    crumbs = {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://agsist.com/"},
            {"@type": "ListItem", "position": 2, "name": "Daily briefing archive", "item": "https://agsist.com/archive"},
            {"@type": "ListItem", "position": 3, "name": _short_date(date_iso), "item": url},
        ],
    }
    return ('<script type="application/ld+json">\n' + _jsonld(article) + '\n</script>\n'
            '<script type="application/ld+json">\n' + _jsonld(crumbs) + '\n</script>')


# ── Crawlable archive lists (2026-10-06) ────────────────────────────────────
# Every /daily/YYYY-MM-DD page was reachable only through its neighbours'
# prev/next links: archive.html and daily.html built their lists in JS from
# index.json, so a crawler that does not run JS saw no briefing at all. These
# bake plain <a href> lists between named SEED markers. save_archive() calls
# refresh_archive_link_lists() after every write (the critic's re-save too),
# so the lists follow each day's publish; the JS still upgrades them in place.
ARCHIVE_PAGE = REPO_ROOT / "archive.html"
DAILY_PAGE = REPO_ROOT / "daily.html"
DAILY_RECENT_N = 7  # keep in step with DV3_RECENT_N in daily.html


def _published_briefings():
    """(date_iso, headline, market_closed) for every daily/YYYY-MM-DD.html that exists,
    newest first. Headline from the archive JSON; a page with no readable JSON
    is still listed (by date) so no published page goes unlinked."""
    out = []
    for p in sorted(ARCHIVE_HTML_DIR.glob("*.html"), reverse=True):
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", p.stem):
            continue
        hl, closed = "", False
        try:
            with open(ARCHIVE_JSON_DIR / f"{p.stem}.json") as f:
                b = json.load(f)
            hl, closed = b.get("headline", ""), bool(b.get("market_closed"))
        except Exception:
            pass
        # older archive JSONs predate sanitize_em_dashes; the lists print none
        hl = re.sub(r"\s*\u2014\s*", ", ", hl or "")
        out.append((p.stem, sentence_case_headline(hl), closed))
    return out


def _dow_label(date_iso):
    try:
        d = datetime.strptime(date_iso, "%Y-%m-%d")
        return f"{d.strftime('%a')} {_MON_ABBR[d.month - 1]} {d.day}"
    except Exception:
        return date_iso


def render_archive_static_list(items):
    """Full list for archive.html, grouped by month, newest first."""
    parts, cur = [], None
    for d, hl, _closed in items:
        mk = d[:7]
        if mk != cur:
            if cur is not None:
                parts.append("</ul>")
            try:
                label = datetime.strptime(mk, "%Y-%m").strftime("%B %Y")
            except Exception:
                label = mk
            parts.append(f'<h2 class="arc-static-month">{label}</h2>')
            parts.append('<ul class="arc-static-list">')
            cur = mk
        y = d[:4]
        parts.append(f'<li><a href="/daily/{d}"><time datetime="{d}">{_dow_label(d)}, {y}</time> '
                     f'&middot; {html_esc(hl or "Daily briefing")}</a></li>')
    if cur is not None:
        parts.append("</ul>")
    return "\n".join(parts)


def render_daily_recent_list(items, n=DAILY_RECENT_N):
    """Recent briefings for daily.html, as the same cards its JS draws."""
    cards = []
    for d, hl, closed in items[:n]:
        try:
            wk = closed or datetime.strptime(d, "%Y-%m-%d").weekday() >= 5
        except Exception:
            wk = closed
        cls, badge = ("wkend", "Weekend") if wk else ("wkday", "Market day")
        cards.append(f'<a href="/daily/{d}" class="dv3-arc-card" title="{_dow_label(d)} briefing">'
                     f'<div class="dv3-arc-card-head"><span class="dv3-arc-card-date">{_dow_label(d)}</span>'
                     f'<span class="dv3-arc-card-badge {cls}">{badge}</span></div>'
                     f'<div class="dv3-arc-card-hl">{html_esc(hl or "Daily briefing")}</div></a>')
    return "\n".join(cards)


def _replace_seed(text, tag, body):
    pat = re.compile(r"(<!--SEED:" + re.escape(tag) + r"-->)(.*?)(<!--/SEED:" + re.escape(tag) + r"-->)", re.S)
    if not pat.search(text):
        return text, False
    return pat.sub(lambda m: m.group(1) + "\n" + body + "\n" + m.group(3), text, count=1), True


def refresh_archive_link_lists():
    """Rewrite the SEED:archivelist block in archive.html and SEED:dailyrecent
    in daily.html. Idempotent; a missing marker is reported, never invented."""
    items = _published_briefings()
    for page, tag, body in ((ARCHIVE_PAGE, "archivelist", render_archive_static_list(items)),
                            (DAILY_PAGE, "dailyrecent", render_daily_recent_list(items))):
        try:
            text = page.read_text(encoding="utf-8")
        except Exception as e:
            print(f"  [warn] {page.name}: {e}")
            continue
        new, ok = _replace_seed(text, tag, body)
        if not ok:
            print(f"  [warn] {page.name}: SEED:{tag} markers missing — list not refreshed")
            continue
        if new != text:
            page.write_text(new, encoding="utf-8")
        print(f"  {page.name}: SEED:{tag} lists {len(items) if tag == 'archivelist' else min(len(items), DAILY_RECENT_N)} briefings")


def generate_archive_html(briefing, date_iso, prev_date=None, next_date=None,
                         og_require_file=False):
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

    og_image_url = og_image_for(date_iso, require_file=og_require_file)
    # THE DIMENSIONS MUST DESCRIBE THE IMAGE THAT IS ACTUALLY LINKED. They were
    # hardcoded to the dated card's 2400x1350; when the fallback is served that
    # declared a size the file does not have, which is how a scraper crops the
    # wrong region or refuses the image outright.
    og_image_w, og_image_h = (("1200", "630") if og_image_url == OG_IMAGE_FALLBACK
                              else ("2400", "1350"))
    # 2026-10-06 SEO: one title and one description for <title>, meta, og and
    # twitter, built by daily_page_title / daily_page_description (see there).
    page_title = html_esc(daily_page_title(briefing, date_iso))
    page_desc_raw = daily_page_description(briefing)
    og_description = html_esc(page_desc_raw)
    desc_escaped = og_description
    headline_sc = html_esc(sentence_case_headline(briefing.get("headline", "")) or "AGSIST Daily Briefing")
    issue_suffix = f" &middot; ISSUE #{issue_num}" if issue_num else ""

    surprise_html = ""
    if surprise_count > 0 and not is_weekend_brief:
        names = []
        for s in surprises:
            arrow = "UP" if s.get("direction") == "up" else "DN"
            names.append(f'{s.get("commodity","")} {arrow} {abs(s.get("pct_change",0)):.1f}%')
        surprise_html = (f'<div class="dv3-surprise-banner" style="display:flex">'
                         f'<span class="surprise-icon">!</span>'
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
        mood_icons = {"bullish": "\u25B2", "bearish": "\u25BC", "mixed": "\u2194", "cautious": "!", "volatile": "~"}
        mc = mood_colors.get(mood, mood_colors["mixed"])
        mi = mood_icons.get(mood, "\u2194")
        mood_html = (f'<span class="dv3-mood" style="display:inline-flex;color:{mc[0]};background:{mc[1]};border:1px solid {mc[2]}">'
                     f'{mi} {mood.capitalize()}</span>')

    # The market strip: the day move vs the prior settle, labeled — built by
    # the generator when this issue was made, or rebuilt here from the same
    # locked numbers for issues that predate quote_strip. Issues older than
    # locked_changes (pre v5.4) get no strip: absent beats an unlabeled line.
    # The real compile time, not a fiction: "Auto-compiled at 6:02 AM CT" was
    # a hardcoded string matching none of daily.yml's cron slots.
    _stamp = _ct_stamp(briefing.get("generated_at"))
    compiled_html = f" &middot; Compiled {_stamp}" if _stamp else ""

    sparks_html = render_quote_strip_html(
        briefing.get("quote_strip")
        or build_quote_strip(briefing.get("locked_prices"),
                             briefing.get("locked_changes"),
                             briefing.get("board")))

    sections_html = ""
    for i, sec in enumerate(briefing.get("sections", [])):
        cls = "dv3-sec"
        if sec.get("overnight_surprise") and not is_weekend_brief: cls += " dv3-sec--surprise"
        if i == heat_idx: cls += " dv3-sec--heat"
        title = html_esc(sec.get("title", ""))
        body = render_section_body_html(sec.get("body", ""))
        # v5.1: so_what is the field; bottom_line is read for archived issues.
        bottom_line = html_esc(sec.get("so_what") or sec.get("bottom_line", ""))
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
        action_html = f'<div class="dv3-sec-action">&rarr; {farmer_action}</div>' if farmer_action else ""
        # v4.4: per-section catalyst marker (RULE 14)
        catalyst = (sec.get("catalyst") or "").strip()
        catalyst_html = ""
        if catalyst and not is_weekend_brief:
            catalyst_html = (f'<div class="dv3-sec-catalyst" aria-label="catalyst">'
                             f'<span class="dv3-sec-catalyst-icon">&#x25CF;</span>'
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
                          f'<div class="dv3-sec-header">'
                          f'<span class="dv3-sec-title">{title}</span>{conviction_html}</div>'
                          f'{catalyst_html}'
                          f'{vs_y_html}'
                          f'<div class="dv3-sec-body">{body}</div>{bottom_html}{action_html}</div>')

    one_num = briefing.get("one_number", {})
    one_num_html = ""
    # No value, no card (it used to print "THE NUMBER -").
    _onv = str((one_num or {}).get("value", "")).strip() if isinstance(one_num, dict) else ""
    if one_num and _onv and _onv.strip("-\u2013\u2014"):
        one_num_html = (f'<div class="dv3-one-number">'
                        f'<div class="dv3-one-number-label">THE NUMBER</div>'
                        f'<div class="dv3-one-number-val">{html_esc(one_num.get("value", "-"))}</div>'
                        f'<div class="dv3-one-number-unit">{html_esc(one_num.get("unit", ""))}</div>'
                        f'<div class="dv3-one-number-ctx">{html_esc(one_num.get("context", ""))}</div>'
                        f'</div>')

    quote = briefing.get("daily_quote", {})
    quote_html = ""
    if quote:
        qt = quote.get("text", "").strip('"\u201c\u201d')
        qa = quote.get("attribution", "").lstrip("\u2014\u2013- ")
        quote_html = (f'<div class="dv3-quote-card">'
                      f'<div class="dv3-quote-label">DAILY QUOTE</div>'
                      f'<p class="dv3-quote-text">\u201c{html_esc(qt)}\u201d</p>'
                      f'<cite class="dv3-quote-attr">{html_esc(qa)}</cite></div>')

    tmyk = briefing.get("the_more_you_know", {})
    tmyk_html = ""
    if tmyk:
        tmyk_html = (f'<div class="dv3-tmyk">'
                     f'<div class="dv3-tmyk-label">THE MORE YOU KNOW</div>'
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
    watch_html = f'<div class="dv3-watch"><div class="dv3-watch-label">{watch_label}</div><ul class="dv3-watch-list">{watch_items}</ul></div>' if watch else ""

    source = html_esc(briefing.get("source_summary", "USDA / CME Group / Open-Meteo"))

    weekend_badge = ""
    if is_weekend_brief:
        reason = briefing.get("market_status_reason", "")
        label = "WEEKEND EDITION" if reason == "weekend" else "HOLIDAY EDITION"
        weekend_badge = (f'<span style="display:inline-flex;align-items:center;gap:.3rem;'
                         f'font-family:\'JetBrains Mono\',monospace;font-size:.58rem;font-weight:700;'
                         f'letter-spacing:.1em;text-transform:uppercase;color:var(--gold);'
                         f'background:rgba(218,165,32,.08);border:1px solid rgba(218,165,32,.22);'
                         f'border-radius:3px;padding:.18rem .55rem;margin-left:.5rem">{label}</span>')

    topbar_html = f'<div class="dv3-topbar">{one_num_html}{quote_html}</div>' if (one_num_html or quote_html) else ""

    sponsor = briefing.get("sponsor") or build_sponsor_block()
    sponsor_html = render_sponsor_block_html(sponsor, surface="archive", slot="daily-archive")
    forward_html = render_forward_block_html(date_iso)
    byline_html = render_byline_block_html()
    # v4.3: new render helpers
    # v5.1: the action takes the takeaway's slot. An archived issue from
    # before the cut has no action and keeps its takeaway.
    takeaway_html = (render_action_block_html(briefing.get("action", ""), briefing.get("bot_call"))
                     or render_takeaway_block_html(briefing.get("the_takeaway", "")))
    cashbids_html = render_cashbids_footer_html(is_weekend_brief)
    hclock_html = render_harvest_clock_html(briefing.get("harvest_clock"))
    # v5.5: no "Yesterday's call" block on new issues (the model wrote its
    # note, and it once printed the wrong direction). An archived issue
    # re-rendered from its JSON keeps the block it was published with.
    yc_html = ("" if briefing.get("bot_call") or str(briefing.get("generator_version") or "") >= "5.5"
               else render_yesterdays_call_block_html(briefing.get("yesterdays_call"), is_weekend_brief))
    thread_html = render_thread_marker_html(briefing.get("weekly_thread"), is_weekend_brief)
    sponsor_attr_html = render_sponsor_attribution_html(sponsor)
    # A paid sponsor's credit stays by the headline. The house "Sponsor this
    # slot" chip is an ad for the ad slot, so it sits below the article and
    # the header keeps to one row above the title.
    _house_attr = bool((sponsor or {}).get("is_house_ad"))
    top_attr_html = "" if _house_attr else sponsor_attr_html
    bottom_attr_html = sponsor_attr_html if _house_attr else ""
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
        '<button class="dv3-share-btn" data-share="copy" type="button" aria-label="Copy link to this briefing">Copy link</button>'
        '<button class="dv3-share-btn" data-share="email" type="button" aria-label="Email this briefing">Email</button>'
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
<title>{page_title}</title>
<meta name="description" content="{desc_escaped}">
<meta name="author" content="Sigurd Lindquist">
<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">
<link rel="canonical" href="https://agsist.com/daily/{date_iso}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="AGSIST">
<meta property="og:locale" content="en_US">
<meta property="og:title" content="{page_title}">
<meta property="og:description" content="{og_description}">
<meta property="og:url" content="https://agsist.com/daily/{date_iso}">
<meta property="og:image" content="{og_image_url}">
<meta property="og:image:width" content="{og_image_w}">
<meta property="og:image:height" content="{og_image_h}">
<meta property="og:image:alt" content="AGSIST Daily: {headline_sc}">
<meta property="article:published_time" content="{date_iso}">
<meta property="article:modified_time" content="{gen_at}">
<meta property="article:author" content="Sigurd Lindquist">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@agsist">
<meta name="twitter:creator" content="@agsist">
<meta name="twitter:title" content="{page_title}">
<meta name="twitter:description" content="{og_description}">
<meta name="twitter:image" content="{og_image_url}">
<link rel="preload" href="/components/styles.css?v=23" as="style">
<link rel="stylesheet" href="/components/styles.css?v=23">
<link rel="stylesheet" href="/components/sponsor-ad.css?v=1">
<!-- 2026-09-30: JetBrains Mono and Oswald are self-hosted in styles.css now
     (see components/styles.css) -- no more separate Google Fonts fetch here,
     and no preconnect to an origin nothing fetches from anymore. -->
<link rel="icon" type="image/x-icon" href="/img/favicon.ico">
<link rel="icon" type="image/png" sizes="32x32" href="/img/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/img/favicon-16.png">
<link rel="apple-touch-icon" href="/img/apple-touch-icon.png">
<link rel="manifest" href="/manifest.json">
<script>/* agsist-theme-early: saved theme, else the device's, set before first paint so pages do not flash the wrong color. loader.js applies the same rule. */try{{var _t=localStorage.getItem('agsist-theme');if(_t!=='light'&&_t!=='dark')_t=window.matchMedia&&matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';document.documentElement.setAttribute('data-theme',_t);}}catch(e){{}}</script><script>/* agsist-ga-guard 2026-10-09: Google Analytics loads only when the browser sends no Global Privacy Control signal and the off switch on /privacy is not set, and only once the page is shown (a page loaded ahead in the background is not a visit). dataLayer and gtag always exist, so page code that calls them never throws. */(function(w,d,n){{var off=false,v,i,s;w.dataLayer=w.dataLayer||[];if(typeof w.gtag!=='function'){{w.gtag=function(){{w.dataLayer.push(arguments);}};}}try{{off=w.localStorage.getItem('agsist-ga-off')==='1';}}catch(e){{}}if(n.globalPrivacyControl===true){{off=true;}}w.agsistGaOff=off;w.gtag('set','allow_google_signals',false);w.gtag('set','allow_ad_personalization_signals',false);if(off){{return;}}i=function(){{s=d.createElement('script');s.async=true;s.src='https://www.googletagmanager.com/gtag/js?id=G-6KXCTD5Z9H';(d.head||d.documentElement).appendChild(s);}};if(d.prerendering){{d.addEventListener('prerenderingchange',i,{{once:true}});}}else{{i();}}}})(window,document,navigator);</script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){{dataLayer.push(arguments);}}gtag('js',new Date());gtag('config','G-6KXCTD5Z9H');</script>
{daily_page_jsonld(briefing, date_iso, page_desc_raw, og_image_url)}
<style>
button,a,[role="button"]{{touch-action:manipulation;}}
html,body{{overflow-x:hidden;overflow-x:clip;width:100%;}}
.dv3-page{{max-width:900px;margin:0 auto;padding:2rem 1.25rem}}
.dv3-header{{margin-bottom:2rem;padding-bottom:1.5rem;border-bottom:2px solid var(--border)}}
.dv3-eyebrow{{display:inline-flex;align-items:center;gap:.5rem;font-family:'JetBrains Mono',monospace;font-size:.68rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--green);margin-bottom:.75rem;padding:.3rem .75rem;background:rgba(74,171,76,.03);border:1px solid rgba(74,171,76,.18);border-radius:3px}}
.dv3-eyebrow-dot{{width:7px;height:7px;border-radius:50%;background:var(--text-muted)}}
.dv3-date{{font-family:'JetBrains Mono',monospace;font-size:.78rem;color:var(--text-muted);letter-spacing:.08em;margin-bottom:.6rem;text-transform:uppercase}}
.dv3-spattr{{display:inline-flex;align-items:center;gap:.35rem;font-family:'JetBrains Mono',monospace;font-size:.7rem;font-weight:600;letter-spacing:.04em;color:var(--ad-orange);text-decoration:none;padding:.3rem .65rem;border:1px solid rgba(var(--ad-orange-rgb),.34);border-radius:4px;background:rgba(var(--ad-orange-rgb),.06);margin-bottom:.85rem;transition:border-color .15s,background .15s,color .15s}}
.dv3-spattr:hover{{border-color:var(--ad-orange);background:rgba(var(--ad-orange-rgb),.12);color:var(--ad-orange)}}
.dv3-spattr--house{{color:var(--text-muted);border-color:var(--border)}}
.dv3-spattr--house:hover{{color:var(--ad-orange);border-color:rgba(var(--ad-orange-rgb),.4)}}
.dv3-spattr strong{{color:var(--text);font-weight:700}}
.dv3-headline{{font-family:'Oswald',sans-serif;font-size:clamp(2rem,4vw,3rem);font-weight:700;line-height:1.15;color:var(--text);margin-bottom:.6rem;letter-spacing:-.01em}}
.dv3-subheadline{{font-size:.92rem;color:var(--gold);font-weight:600;margin-bottom:.75rem}}
.dv3-lead{{font-size:1.05rem;line-height:1.75;color:var(--text-dim);max-width:720px}}
.dv3-surprise-banner{{display:none;align-items:center;gap:.6rem;padding:.65rem 1rem;background:linear-gradient(135deg,rgba(218,165,32,.06) 0%,rgba(240,145,58,.04) 100%);border:1px solid rgba(218,165,32,.20);border-radius:8px;margin-bottom:1.25rem}}
.dv3-surprise-banner .surprise-icon{{font-size:1.1rem;flex-shrink:0}}
.dv3-surprise-banner .surprise-text{{font-size:.85rem;color:var(--text-dim);line-height:1.45}}
.dv3-surprise-banner .surprise-text strong{{color:var(--gold);font-weight:700}}
.dv3-mood{{display:none;align-items:center;gap:.3rem;font-family:'JetBrains Mono',monospace;font-size:.62rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:.22rem .6rem;border-radius:3px;white-space:nowrap;margin-left:.75rem}}
.dv3-quotes{{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1px;margin:0 0 .4rem;background:var(--border);border:1px solid var(--border);border-radius:8px;overflow:hidden}}
@media(max-width:480px){{.dv3-quotes{{grid-template-columns:1fr}}}}
.dv3-quote{{display:flex;flex-direction:column;gap:.28rem;padding:.7rem .85rem;background:var(--surface);min-width:0}}
.dv3-quote-top{{display:flex;align-items:baseline;justify-content:space-between;gap:.5rem}}
.dv3-quote-name{{font-family:'JetBrains Mono',monospace;font-size:.75rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--text-muted)}}
.dv3-quote-win{{font-family:'JetBrains Mono',monospace;font-size:.72rem;letter-spacing:.04em;color:var(--text-muted);white-space:nowrap}}
.dv3-quote-price{{font-family:'JetBrains Mono',monospace;font-size:1.15rem;font-weight:700;color:var(--text);line-height:1;letter-spacing:-.01em}}
.dv3-quote-chg{{display:flex;align-items:baseline;gap:.45rem;font-family:'JetBrains Mono',monospace;font-size:.765rem;font-weight:700}}
.dv3-quote-chg .cents{{font-weight:600}}
.dv3-quote .pos{{color:var(--green,#5fc28a)}}.dv3-quote .neg{{color:var(--red,#e0685f)}}.dv3-quote .flat{{color:var(--text-muted)}}
.dv3-quote-asof{{font-family:'JetBrains Mono',monospace;font-size:.68rem;letter-spacing:.03em;color:var(--text-muted);margin:0 0 1.1rem}}
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
.dv3-sec--surprise::before{{content:'! OVERNIGHT SURPRISE';position:absolute;top:-.55rem;right:.75rem;font-family:'JetBrains Mono',monospace;font-size:.5rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#fff;background:var(--gold-fill,var(--gold));padding:.12rem .55rem;border-radius:2px}}
.dv3-sec--heat{{border-color:rgba(74,171,76,.35)!important}}
.dv3-sec--heat::after{{content:'TOP STORY';position:absolute;top:-.55rem;left:.75rem;font-family:'JetBrains Mono',monospace;font-size:.5rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#fff;background:var(--green);padding:.12rem .55rem;border-radius:2px}}
.dv3-sec-header{{display:flex;align-items:center;flex-wrap:wrap;gap:.35rem .55rem;margin-bottom:.65rem}}
.dv3-sec-icon{{font-size:1.3rem;flex-shrink:0}}
.dv3-sec-title{{font-family:'JetBrains Mono',monospace;font-size:.72rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--green);flex:1}}
.dv3-sec-conviction{{font-family:'JetBrains Mono',monospace;font-size:.55rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:.15rem .45rem;border-radius:3px;white-space:nowrap}}
.dv3-sec-bullets{{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.45rem}}
.dv3-sec-bullets li{{position:relative;padding-left:1.05rem;font-size:.92rem;line-height:1.65;color:var(--text-dim)}}
.dv3-sec-bullets li::before{{content:"";position:absolute;left:0;top:.62em;width:.42rem;height:.42rem;border-radius:2px;background:rgba(218,165,32,.55)}}
.dv3-sec-bullets li strong{{color:var(--text)}}
.dv3-sec-sowhat{{margin-top:.55rem;font-size:.88rem;line-height:1.6;color:var(--text-dim);font-style:italic}}
.dv3-sec-body{{font-size:.95rem;line-height:1.75;color:var(--text-dim);margin-bottom:.65rem}}
.dv3-sec-body strong{{color:var(--text)}}
.dv3-sec-bottomline{{font-family:'JetBrains Mono',monospace;font-size:.78rem;font-weight:700;color:var(--text);padding:.5rem .75rem;background:var(--surface2);border-radius:6px;border-left:3px solid var(--gold);margin-bottom:.5rem;line-height:1.45}}
/* v4.3: takeaway card, committable statement, sits between lead and sparks */
.dv3-takeaway{{margin:1.1rem 0 0;padding:1rem 1.15rem;background:linear-gradient(135deg,rgba(218,165,32,.08) 0%,rgba(218,165,32,.02) 60%,var(--surface2) 100%);border:1px solid rgba(218,165,32,.3);border-left:4px solid var(--gold);border-radius:8px}}
.dv3-takeaway-label{{display:inline-block;font-family:'JetBrains Mono',monospace;font-size:.6rem;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--gold);margin-bottom:.45rem}}
.dv3-takeaway-text{{font-family:'Oswald',sans-serif;font-size:1.1rem;line-height:1.45;color:var(--text);margin:0;font-weight:600;letter-spacing:-.005em}}
.dv3-action-src{{margin:.5rem 0 0;font-size:.8rem;line-height:1.5;color:var(--text-muted)}}
.dv3-action-src a{{color:var(--gold)}}
.dv3-hclock{{margin:1rem 0 0;padding:.75rem 1rem;background:var(--surface2);border:1px solid var(--border);border-left:3px solid var(--gold);border-radius:8px}}
.dv3-hclock-label{{font-family:'JetBrains Mono',monospace;font-size:.72rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--gold);margin:0 0 .35rem}}
.dv3-hclock-line{{margin:.15rem 0;font-size:.94rem;line-height:1.5;color:var(--text)}}
.dv3-hclock-note{{margin:.4rem 0 0;font-size:.8rem;line-height:1.5;color:var(--text-muted)}}
.dv3-hclock-note a{{color:var(--gold);white-space:nowrap}}
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
.dv3-share-btn{{display:inline-flex;align-items:center;gap:.35rem;font-family:'JetBrains Mono',monospace;font-size:.74rem;font-weight:700;padding:.45rem .85rem;background:var(--surface2);border:1px solid var(--border);border-radius:6px;color:var(--text-dim);cursor:pointer;transition:border-color .15s,color .15s;min-height:40px;touch-action:manipulation}}
.dv3-share-btn:hover{{border-color:var(--gold);color:var(--text)}}
.dv3-share-btn svg{{flex-shrink:0}}
.dv3-archnav{{display:flex;justify-content:space-between;align-items:center;gap:.75rem;flex-wrap:wrap;margin:.4rem 0 1.2rem}}
.dv3-archnav-a{{font-family:'JetBrains Mono',monospace;font-size:.72rem;font-weight:700;color:var(--text-dim);padding:.45rem .7rem;border:1px solid var(--border);border-radius:6px;min-height:40px;display:inline-flex;align-items:center}}
.dv3-archnav-a:hover{{border-color:var(--gold);color:var(--text)}}
.dv3-archnav-all{{color:var(--text-muted)}}
.dv3-source{{font-size:.68rem;color:var(--text-muted);text-align:center;padding:.75rem 0;border-top:1px solid var(--border);margin-bottom:2rem}}

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

.dv3-forward{{display:flex;align-items:center;gap:1rem;padding:1rem 1.2rem;background:rgba(58,139,60,.05);border:1px solid rgba(58,139,60,.22);border-radius:8px;margin:1.25rem 0 .75rem;flex-wrap:wrap}}
.dv3-forward-icon{{font-size:1.5rem;flex-shrink:0;line-height:1}}
.dv3-forward-content{{flex:1;min-width:200px}}
.dv3-forward-headline{{font-size:.95rem;font-weight:700;color:var(--text);line-height:1.3;margin-bottom:.18rem}}
.dv3-forward-sub{{font-size:.82rem;color:var(--text-dim);line-height:1.5}}
.dv3-forward-cta{{display:inline-flex;align-items:center;gap:.35rem;font-family:'JetBrains Mono',monospace;font-size:.74rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;text-decoration:none;color:#fff;background:var(--green);padding:.55rem .95rem;border-radius:6px;transition:background .15s;min-height:42px;white-space:nowrap}}
.dv3-forward-cta:hover{{background:#1b4d1c}}
:root:not([data-theme="light"]) .dv3-forward-cta{{color:#06110b}}
:root:not([data-theme="light"]) .dv3-forward-cta:hover{{background:#4aab4c;color:#06110b}}
:root:not([data-theme="light"]) .dv3-sec--heat::after{{color:#06110b}}
.dv3-header-row{{display:flex;align-items:center;flex-wrap:wrap;gap:.5rem .75rem;margin-bottom:.85rem}}
.dv3-header-row .dv3-eyebrow,.dv3-header-row .dv3-date{{margin:0}}
.dv3-header-row .dv3-mood,.dv3-header-row>span{{margin-left:0!important}}
.dv3-takeaway+.dv3-lead{{margin-top:1.1rem}}
.dv3-after{{display:flex;flex-direction:column;align-items:center;gap:.9rem;padding:1.25rem 0 1.75rem}}
.dv3-after .dv3-spattr{{margin:0}}
.dv3-todaylink{{display:inline-flex;align-items:center;min-height:44px;padding:0 1.1rem;font-family:'JetBrains Mono',monospace;font-size:.78rem;font-weight:700;letter-spacing:.04em;color:var(--gold);border:1px solid var(--border);border-radius:6px}}
.dv3-todaylink:hover{{border-color:var(--gold);color:var(--text)}}
.dv3-byline{{font-size:.86rem;color:var(--text-dim);line-height:1.65;padding:.85rem 0;border-top:1px solid var(--border);margin-top:.5rem}}
.dv3-byline strong{{color:var(--text);font-weight:700}}
.dv3-byline a{{color:var(--gold);text-decoration:none;display:inline-block;padding:.75rem 0;margin:-.75rem 0}}
.dv3-byline a:hover{{text-decoration:underline}}
@media(max-width:640px){{.dv3-page{{padding:1.25rem .9rem}}.dv3-topbar{{grid-template-columns:minmax(0,1fr)}}.dv3-one-number-val{{font-size:2.4rem}}.dv3-sec{{padding:.85rem 1rem}}.dv3-forward{{flex-direction:column;align-items:flex-start;gap:.7rem}}.dv3-forward-cta{{width:100%;justify-content:center}}}}
@media(max-width:380px){{.dv3-headline{{font-size:1.6rem}}.dv3-one-number-val{{font-size:2rem}}.dv3-sec-action{{display:none}}}}
@media(max-width:500px){{.dv3-watch-item{{flex-direction:column;gap:.15rem}}.dv3-watch-time{{min-width:0;white-space:normal}}.dv3-sec-title{{min-width:70%}}.dv3-sec--heat.dv3-sec--surprise{{padding-top:2.35rem}}.dv3-sec--heat.dv3-sec--surprise::before{{top:.9rem;left:.75rem;right:auto}}}}
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
      <div class="dv3-header-row">
        <div class="dv3-eyebrow"><span class="dv3-eyebrow-dot"></span> AGSIST DAILY{issue_suffix} &middot; ARCHIVE</div>
        <div class="dv3-date">{html_esc(date_display)}</div>
        {mood_html}
        {weekend_badge}
      </div>
      {top_attr_html}
      <h1 class="dv3-headline">{headline}</h1>
      {"<p class='dv3-subheadline'>" + subheadline + "</p>" if subheadline else ""}
      {thread_html}
      {surprise_html}
      {takeaway_html}
      <p class="dv3-lead">{lead}</p>
      {hclock_html}
    </header>
    {sparks_html}
    {topbar_html}
    {yc_html}
    <div class="dv3-sections">{sections_html}</div>
    {sponsor_html}
    {tmyk_html}
    {watch_html}
    {outside_pit_html}
    {byline_html}
    {cashbids_html}
    {forward_html}
    {share_html}
    {archive_nav_html}
    <div class="dv3-source">{source}{compiled_html}</div>
  </article>
  <div class="dv3-after">
    <a class="dv3-todaylink" href="/daily">Today's briefing &rarr;</a>
    {bottom_attr_html}
  </div>
</div>
</main>
<div id="site-footer"></div>
<script src="/components/loader.js" defer></script>
<script>
(function(){{
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
    return arc_plc_link.link_first(page)


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
    if yc.get("outcome") and (yc.get("call_line") or yc.get("summary")):
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
    # Crawlable link lists on archive.html / daily.html (see refresh_archive_link_lists).
    try:
        refresh_archive_link_lists()
    except Exception as e:
        print(f"  [warn] archive link lists not refreshed: {e}")


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
    "lead", "subheadline", "the_takeaway", "teaser", "action",
    "body", "bottom_line", "so_what", "vs_yesterday", "catalyst",
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
    "body", "bottom_line", "so_what", "vs_yesterday", "catalyst", "driver",
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


_EMOJI_RE = re.compile(
    "[\u2600-\u26FF\u2700-\u2712\u2714-\u2716\u2718-\u27BF"  # misc symbols + dingbats, sparing check/x
    "\u2B00-\u2BFF\uFE0F\u200D"
    "\U0001F000-\U0001FBFF]"
)


def scrub_emoji(briefing):
    """v4.7: strip emoji/pictographs from every string in the briefing and
    delete sections[].icon (the frontends render nothing when absent).
    Keeps plain UI glyphs (checkmark U+2713, ballot X U+2717, arrows,
    geometric shapes). Idempotent."""
    def clean(s):
        out = _EMOJI_RE.sub("", s)
        if out != s:
            out = re.sub(r"  +", " ", out).strip()
        return out

    def walk(obj):
        if isinstance(obj, dict):
            obj.pop("icon", None)
            return {k: walk(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [walk(v) for v in obj]
        if isinstance(obj, str):
            return clean(obj)
        return obj

    return walk(briefing)


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
        for fname in ("body", "so_what", "bottom_line", "catalyst", "vs_yesterday"):
            v = sec.get(fname, "")
            if isinstance(v, str) and v:
                # Carry the section title forward as commodity context;
                # it often names the commodity even when the body is
                # mid-sentence.
                parts.append((f"{title}. {v}", f"section[{i}].{fname}"))
    # `action` is deliberately NOT scanned here either (v5.1): it is a conditional
    # threshold by definition ("a settle below $12.85 is the signal") and this
    # heuristic would flag it every day. The gate's guarded level check reads it.
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


def strip_retired_fields(briefing):
    """v5.1: the prompt says not to emit them; the model sometimes will. Drop
    them so the JSON contract is the schema, not the model's mood. Returns
    (briefing, list of what was dropped)."""
    dropped = []
    for k in briefing_cut.RETIRED_FIELDS:
        if k in briefing:
            dropped.append(k); briefing.pop(k, None)
    for i, sec in enumerate(briefing.get("sections") or []):
        if not isinstance(sec, dict): continue
        # a model that still writes bottom_line meant so_what
        if sec.get("bottom_line") and not sec.get("so_what"):
            sec["so_what"] = sec.pop("bottom_line"); dropped.append(f"sections[{i}].bottom_line->so_what")
        for k in briefing_cut.RETIRED_SECTION_FIELDS + ("farmer_action",):
            if k in sec:
                dropped.append(f"sections[{i}].{k}"); sec.pop(k, None)
    # v5.5 (2026-10-03): the model may not write a call, an action, or a
    # verdict on a past call. The prompt says so; this makes it true. The
    # Action is put back by insert_bot_call() from data/predictions.json.
    for k in MODEL_CALL_FIELDS:
        if k in briefing:
            dropped.append(k); briefing.pop(k, None)
    return briefing, dropped


# Fields the model is not allowed to author from v5.5 on. "Yesterday's call"
# printed false text (crude rose; the note said it fell), and the action was
# an LLM-written trade instruction ("lock diesel now").
MODEL_CALL_FIELDS = ("action", "todays_call", "yesterdays_call")

PREDICTIONS_PATH = REPO_ROOT / "data" / "predictions.json"
BOT_CALL_MAX_AGE_DAYS = 8   # bot-v1.1 calls once per weekly report; a call holds until the next report's (a holiday week enters a day late)


def insert_bot_call(briefing, today=None, path=None):
    """THE ACTION, v5.5: the prediction bot's latest call and its record,
    copied from data/predictions.json. Nothing here computes a statistic;
    scripts/prediction_bot.py owns every number and wrote action_text.

    Left out, never invented, when the file is missing, has no call yet, or
    its latest call is older than BOT_CALL_MAX_AGE_DAYS. Every renderer hides
    The Action box when the field is empty."""
    today = today or datetime.now().date()
    path = path or PREDICTIONS_PATH
    try:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError) as e:
        print(f"  [bot] no predictions file ({type(e).__name__}); The Action is left out")
        return briefing
    latest = d.get("latest") or {}
    text = (d.get("action_text") or "").strip()
    ld = latest.get("date")
    if not text or not ld or not latest.get("calls"):
        print("  [bot] the bot has made no call yet; The Action is left out")
        return briefing
    try:
        age = (today - datetime.strptime(ld, "%Y-%m-%d").date()).days
    except ValueError:
        print(f"  [bot] unreadable call date {ld!r}; The Action is left out")
        return briefing
    if age > BOT_CALL_MAX_AGE_DAYS or age < 0:
        print(f"  [bot] latest call is from {ld} ({age} days); too old to print. The Action is left out")
        return briefing
    labels = {c.get("key"): c.get("label") for c in d.get("crops") or []}
    live = ((d.get("live") or {}).get("records") or {}).get("all") or {}
    bt = (((d.get("backtest") or {}).get("records") or {}).get("all")) or {}
    keep = ("graded", "hits", "hit_rate", "windows", "spell_rate_low", "spell_rate_high",
            "fell_rate", "p_luck", "gate_ok", "verdict", "verdict_text")
    briefing["action"] = text
    briefing["bot_call"] = {
        "date": ld,
        "text": text,
        "rules_version": (d.get("rules") or {}).get("version"),
        "horizon": (d.get("rules") or {}).get("horizon_label"),
        "label": d.get("action_label") or "BOT CALL",
        "calls": [{"crop": c.get("crop"), "label": labels.get(c.get("crop"), c.get("crop")),
                   "direction": c.get("direction"), "contract": c.get("contract"), "entry": c.get("entry"),
                   "exit_day": c.get("exit_day"), "signal": c.get("signal")}
                  for c in latest["calls"]],
        "record": {k: live.get(k) for k in keep},
        "backtest": {k: bt.get(k) for k in keep},
        "source": "data/predictions.json",
        "url": "/scorecard",
    }
    print(f"  [bot] The Action: {text}")
    return briefing


def grade_in_generator(briefing, market_status):
    """v5.1: grade yesterday's call HERE, before the archive HTML is rendered,
    so the page and the email show the deterministic verdict and call_line on
    the first render. grade_calls.py still runs as its own workflow step and
    writes the identical result (one function, two callers). Fails open.

    v5.2: WHICH call gets graded comes from grade_calls.find_graded_call, which
    requires a session to have SETTLED since the previous issue. This now runs
    on closed days too, because Saturday's issue holds Friday's closes and is
    exactly where Friday morning's call should be scored. The weekday is not
    the question; the session is."""
    try:
        import grade_calls as _gc
        made, prior_daily, why = _gc.find_graded_call(briefing, str(ARCHIVE_JSON_DIR))
        if made is None:
            # NOT a miss. A Sunday issue, or a Monday before the open, holds the
            # same closes as the issue before it, so there is nothing new to
            # score. Dropping the block is the honest answer; grading it against
            # the board the call was made from is how 20 of 81 calls were
            # recorded as misses before any market opened.
            print(f"  [grade] nothing to grade: {why}")
            briefing["yesterdays_call"] = {}
            return briefing
        outcome, call, p0, p1, note = _gc.grade_from_archives(briefing, prior_daily)
        if outcome is None:
            briefing["yesterdays_call"] = {}
            return briefing
        yc = briefing.get("yesterdays_call") or {}
        yc["outcome"] = outcome
        yc["computed"] = {"outcome": outcome, "made": made, "p0": p0, "p1": p1,
                          "instrument": call.get("instrument"), "direction": call.get("direction"),
                          "level": call.get("level")}
        yc["call_line"] = _gc.plain_call(call, p0, p1, outcome)
        briefing["yesterdays_call"] = yc
        print(f"  [grade] {note}")
    except Exception as _e:
        print(f"  [warn] in-generator grading skipped ({type(_e).__name__}: {_e})")
    return briefing


def sanitize_weekend_blocks(briefing, market_status):
    """v4.2 (Phase 2 C4): the prompt instructs the model to set
    weekend-disallowed fields to empty on Sat/Sun/holidays. Models
    occasionally violate. Wipe them in post to enforce the contract
    regardless of what the model returned. Only acts when market_closed;
    weekday data is untouched."""
    if not market_status.get("is_closed"):
        return briefing
    # v5.2: todays_call JOINS this list and yesterdays_call LEAVES it.
    # A weekend issue cannot make a forward call: it holds Friday's closes, so
    # its "call" is the same claim, from the same board, that Friday's issue
    # already made, and the record scored both. 25 of the archived calls were
    # made on closed days.
    # yesterdays_call is no longer wiped here, because Saturday's issue holds
    # Friday's closes and is the right place to score Friday morning's call.
    # grade_in_generator decides that from the session, not from the weekday.
    weekend_disallowed = ["weekly_thread", "todays_call"]
    for key in weekend_disallowed:
        if key in briefing:
            briefing[key] = {}
    return briefing


def main():
    print("=== AGSIST Daily Briefing Generator v5.5 (the bot's call) ===")
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
        print("  Past context loaded")
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
    # v5.2: asked on EVERY day, closed ones included. The selector returns None
    # unless a session has settled since the last issue, so Saturday grades
    # Friday's call and Sunday grades nothing. weekly_thread_ctx stays None (v5.1).
    weekly_thread_ctx = None
    # v5.5: no yesterday's-call context. The model no longer grades a past
    # call; the prediction bot grades its own by code (predictions.yml).
    yesterdays_call_ctx = None

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

    # ── WASDE self-heal (2026-08-12) ─────────────────────────────────────
    # On WASDE morning the model fabricated the report's results in two
    # independent generations; briefing_gate blocked both sends. Correct
    # behavior, but a blocked morning is still no briefing. So: run the
    # gate's OWN fabrication scan (single definition, imported — never a
    # copy) on the draft, and if it hits, regenerate ONCE with the offending
    # lines quoted back as a correction. Fail-open on any error: the draft
    # stands and the downstream gate remains the backstop.
    try:
        import briefing_gate as _bg
        import usda_dates as _ud
        from datetime import timezone as _tz
        _today_d = datetime.now().date()
        # Post-print regenerations (>=16:00Z on release day) legitimately
        # describe the report — self-heal must not fire on those. Same
        # public-clock rule the gate uses, evaluated on the real current time.
        _fab_hits = []
        if not _ud.wasde_results_are_public(_today_d, datetime.now(_tz.utc)):
            _fab_hits, _ = _bg.wasde_fabrication_hits(briefing, today=_today_d)
        if _fab_hits:
            print(f"  [wasde-self-heal] draft fabricates the unreleased WASDE in "
                  f"{len(_fab_hits)} place(s); regenerating once with correction...")
            for _loc, _snip in _fab_hits:
                print(f"    - {_loc}: {_snip!r}")
            _corr = (
                "\n\nCORRECTION — YOUR PREVIOUS DRAFT WAS REJECTED. It claimed the WASDE "
                "already printed. IT HAS NOT. These exact phrases were the violations:\n"
                + "\n".join(f"  - {_l}: \"{_s}\"" for _l, _s in _fab_hits)
                + "\nRewrite treating the report as strictly UPCOMING (it prints at 11:00 "
                "AM CT today, hours after this briefing goes out). Attribute every price "
                "move to positioning ahead of it, never to its contents."
            )
            _brief2 = call_claude(price_data, surprises, news_block, seasonal_ctx,
                                  todays_quote, past_dailies_block, past_tmyk_topics,
                                  market_status, yesterdays_call_ctx, weekly_thread_ctx,
                                  ongoing_situations=ongoing_situations,
                                  editorial_notes=editorial_notes,
                                  past_one_number_topics=past_one_number_topics,
                                  past_phrases=past_phrases,
                                  usda_release=usda_release + _corr)
            _hits2, _ = _bg.wasde_fabrication_hits(_brief2, today=_today_d)
            if _hits2:
                print(f"  [wasde-self-heal] regenerated draft STILL dirty "
                      f"({len(_hits2)} hit(s)); keeping it — the gate decides")
            else:
                print("  [wasde-self-heal] regenerated draft is clean; using it")
            briefing = _brief2
    except Exception as _e:
        print(f"  [warn] wasde-self-heal skipped ({type(_e).__name__}: {_e})")

    # ── VOICE self-heal (2026-10-09) ─────────────────────────────────────
    # The briefing carries Sig's name. voice_lint (one definition, shared with
    # the critic and the gate) finds invented first-person experiences ("I
    # talked to elevators today", "my neighbor said") and machine tells
    # ("navigate", "robust", "not just X but Y"). Any hit regenerates ONCE
    # with the lines quoted back, the WASDE self-heal's pattern. The cleaner
    # draft wins. Fail-open: the critic and the gate stay the backstop.
    try:
        import voice_lint as _vl
        briefing = fix_headline_case(briefing)
        _vr = _vl.lint(briefing)
        if _vl.needs_regen(_vr):
            print(f"  [voice-self-heal] {len(_vr['fabricated'])} fabricated, "
                  f"{len(_vr['tells'])} tell(s); regenerating once with correction...")
            for _c, _loc, _s in _vr["fabricated"] + _vr["tells"]:
                print(f"    - {_loc} [{_c}]: {_s!r}")
            _brief2 = call_claude(price_data, surprises, news_block, seasonal_ctx,
                                  todays_quote, past_dailies_block, past_tmyk_topics,
                                  market_status, yesterdays_call_ctx, weekly_thread_ctx,
                                  ongoing_situations=ongoing_situations,
                                  editorial_notes=editorial_notes,
                                  past_one_number_topics=past_one_number_topics,
                                  past_phrases=past_phrases,
                                  usda_release=(usda_release or "") + "\n\n" + _vl.correction(_vr))
            _brief2 = fix_headline_case(_brief2)
            _vr2 = _vl.lint(_brief2)
            _wasde_ok = True
            try:
                import briefing_gate as _bg2
                import usda_dates as _ud2
                from datetime import timezone as _tz2
                if not _ud2.wasde_results_are_public(datetime.now().date(), datetime.now(_tz2.utc)):
                    _wasde_ok = not _bg2.wasde_fabrication_hits(_brief2, today=datetime.now().date())[0]
            except Exception:
                pass

            def _vscore(r):
                return (len(r["fabricated"]),
                        sum(1 for c, _, _ in r["tells"] if c not in _vl.FIXABLE))
            if _wasde_ok and _vscore(_vr2) <= _vscore(_vr):
                print(f"  [voice-self-heal] regenerated draft: {len(_vr2['fabricated'])} fabricated, "
                      f"{len(_vr2['tells'])} tell(s); using it")
                briefing = _brief2
            else:
                print("  [voice-self-heal] regenerated draft is no better; keeping the first")
    except Exception as _e:
        print(f"  [warn] voice-self-heal skipped ({type(_e).__name__}: {_e})")

    # call-design v2 (2026-08-13): stamp which claim design produced this
    # call, so build_scorecard can keep the v1 and v2 series separate (the
    # by_method precedent — a methodology change never blends into the old
    # record). Stamped by the generator, not the model: the model cannot be
    # trusted to label its own methodology era.
    # v5.5: the todays_call design stamp is gone with todays_call itself.

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

    # v4.7: EMOJI SCRUBBER. The briefing is emoji-free by prompt rule 20(d),
    # but the model occasionally decorates anyway. Deterministic strip of all
    # pictographs from every string field (keeps plain UI glyphs like check
    # marks and arrows), and drops the legacy per-section icon field entirely.
    briefing = scrub_emoji(briefing)

    # 2026-10-09: the voice fix of last resort. A fabricated first-person
    # sentence that survived the self-heal is cut out (never reworded), and
    # headlines and titles go to sentence case. The gate blocks anything left.
    try:
        import voice_lint as _vl
        briefing, _vcut = _vl.strip_fabricated(briefing)
        for _l in _vcut:
            print(f"  [voice] {_l}")
        briefing = fix_headline_case(briefing)
        _vr = _vl.lint(briefing)
        for _c, _loc, _s in _vr["fabricated"] + _vr["tells"]:
            print(f"  [voice] still in draft: {_loc} [{_c}]: {_s!r}")
    except Exception as _e:
        print(f"  [warn] voice pass skipped ({type(_e).__name__}: {_e})")

    briefing, _wd_fixes = fix_weekday_labels(briefing)
    if _wd_fixes:
        print(f"  Weekday corrections: {_wd_fixes}")

    # v5.1 the cut, in this order: drop what the prompt retired, then cut to
    # the budget deterministically (weakest block first), then grade the call
    # so the archive render below carries the verdict.
    briefing, _dropped = strip_retired_fields(briefing)
    if _dropped:
        print(f"  Retired fields stripped: {', '.join(_dropped)}")
    briefing, _cut_log = briefing_cut.enforce_budget(briefing)
    for _l in _cut_log:
        print(f"  [cut] {_l}")
    # 2026-10-10: ON A USDA REPORT DAY THE BRIEFING NAMES THE REPORT, BY CODE.
    # The Oct 9 watch list left out the WASDE printing at 11 that morning. The
    # fixed watch line and the lead mention come from scripts/report_day.py
    # (dates from usda_dates), never from the model; the critic puts them back
    # after any rewrite and briefing_gate refuses to publish without them.
    import report_day
    briefing = report_day.apply(briefing, datetime.now().date(), datetime.now(timezone.utc))
    if briefing.get("report_day"):
        print(f"  Report day: {', '.join(briefing['report_day']['reports'])}; fixed watch line in place")
    _wc_total = briefing_cut.word_count(briefing)
    print(f"  Word count: {_wc_total} (target {briefing_cut.TARGET_WORDS}, ceiling {briefing_cut.HARD_CEILING})")

    locked_prices = price_data.get("locked_prices", {})
    _timing = quote_timing(price_data.get("fetched", ""), market_status, price_data.get("locked_changes"))
    if not _timing.get("settled"):
        print(f"  Quote timing: {_timing['phase']} as of {_timing['as_of']} (not settlements)")
    is_clean, val_warnings = validate_briefing(briefing, locked_prices, _timing)
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
    # v5.4: the change column, locked with the prices it belongs to, plus the
    # sessions the two numbers belong to. Recorded once here so no reader has to
    # infer them from a publish time or reconstruct them from the archive.
    briefing["locked_changes"] = price_data.get("locked_changes", {}) or {}
    _fetched = price_data.get("fetched", "")
    try:
        import market_board as _mb
        _qs, _ps = _mb.quote_session(_fetched), _mb.prev_close_session(_fetched)
        briefing["board"] = {
            "fetched": _fetched,
            "quote_session": _qs.isoformat() if _qs else None,
            "prev_close_session": _ps.isoformat() if _ps else None,
        }
        print(f"  Board: {len(briefing['locked_changes'])} locked changes; "
              f"quotes are the {_qs} session, change is against the {_ps} close")
    except Exception as _e:
        briefing["board"] = {"fetched": _fetched}
        print(f"  [warn] board session stamp unavailable ({type(_e).__name__}: {_e})")
    # 2026-10-09, Sig: the prediction bot is out of the Daily for now. It
    # lives on /scorecard (data/predictions.json), not in the briefing, the
    # homepage teaser or the email. insert_bot_call() is kept, uncalled, so
    # putting it back is one line. With no action the box stays hidden.
    briefing.pop("action", None)
    briefing.pop("bot_call", None)
    # Harvest price clock: RMA's running harvest price against the projected
    # price, only inside the discovery window and only from a fresh RMA file.
    # None (out of window, stale, missing) leaves the field out.
    try:
        import harvest_clock as _hc
        _clock = _hc.build_from_files(REPO_ROOT)
        if _clock:
            briefing["harvest_clock"] = _clock
            print("  Harvest clock: " + " | ".join(_clock["lines"]))
        else:
            print("  Harvest clock: none (out of window, stale or missing RMA data)")
    except Exception as _e:
        print(f"  [warn] harvest clock skipped ({type(_e).__name__}: {_e})")
    chart_series, chart_dates = build_chart_series(
        locked_prices, briefing.get("market_closed") is True)
    if chart_series:
        briefing["chart_series"] = chart_series
        briefing["chart_dates"] = chart_dates
        briefing["chart_window"] = _chart_window_label(chart_dates)
        print(f"  Chart series: { {k: len(v) for k, v in chart_series.items()} }"
              f" over {briefing['chart_window']} ({len(chart_dates)} trading days)")
    strip = build_quote_strip(locked_prices, briefing["locked_changes"], briefing.get("board"))
    if strip:
        briefing["quote_strip"] = strip
        print("  Quote strip: " + ", ".join(
            f"{q['name']} {q['contract']} {q['pct']:+.2f}%" for q in strip["quotes"]))
    sponsor = build_sponsor_block()
    briefing["sponsor"] = sponsor
    if sponsor.get("is_house_ad"):
        print("  Sponsor: HOUSE AD (no paid sponsor active)")
    else:
        print(f"  Sponsor: {sponsor.get('advertiser', 'unnamed')} (PAID)")
    pre_issue = load_issue_number()
    briefing["issue_number"] = pre_issue + 1
    print(f"  Issue number for today: #{briefing['issue_number']}")

    # v5.1: log block presence for verification
    otp = briefing.get("outside_the_pit") or []
    if otp:
        print(f"  Outside the Pit: {len(otp)} item(s)")
        for it in otp[:3]:
            tag = it.get("tag", "")
            tag_str = f"[{tag}] " if tag else ""
            print(f"    - {tag_str}{(it.get('title') or '')[:60]}")
    else:
        print("  Outside the Pit: EMPTY (model violated the OMISSIONS contract)")

    briefing["generated_at"] = datetime.now(timezone.utc).isoformat()
    briefing["generator_version"] = "5.5.0"
    briefing["surprise_count"] = len(surprises)
    briefing["surprises"] = surprises
    briefing["price_validation_clean"] = is_clean
    briefing["market_closed"] = market_status["is_closed"]
    briefing["market_status_reason"] = market_status["reason"]
    if "meta" not in briefing: briefing["meta"] = {}
    briefing["meta"]["overnight_surprises_count"] = len(surprises)
    briefing["meta"]["word_count"] = _wc_total
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
    # 2026-10-09: no quote of the day. data/quote-pool.json carries no source
    # for any attribution and 19 of its 413 entries say "Attributed to" (one
    # printed "Quality means doing it right when no one is looking",
    # "Attributed to Henry Ford"). A line we cannot source does not go out
    # under a name. Every renderer hides the block when the field is absent.
    if DAILY_QUOTE_ENABLED:
        market_mood = (briefing.get("meta") or {}).get("market_mood", "")
        if market_mood:
            mood_quote = get_todays_quote(market_mood=market_mood)
            if mood_quote and mood_quote.get("text"):
                briefing["daily_quote"] = mood_quote
    else:
        briefing.pop("daily_quote", None)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(briefing, f, indent=2, ensure_ascii=False)
    print(f"  Written to {OUTPUT_PATH}")
    print("  Archiving briefing...")
    save_archive(briefing)
    print(f"  Headline: {briefing.get('headline', 'N/A')}")
    print(f"  Sections: {len(briefing.get('sections', []))}")
    print("=== Done. Run scripts/critique_briefing.py next for the v2.0 quality gate. ===")


if __name__ == "__main__":
    if "--refresh-archive-lists" in sys.argv:
        # Rebake the crawlable lists on archive.html / daily.html only —
        # no model call, no briefing. Safe to run any time.
        refresh_archive_link_lists()
    else:
        main()
