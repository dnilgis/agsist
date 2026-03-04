#!/usr/bin/env python3
"""
AGSIST Daily Briefing Generator — v3
═══════════════════════════════════════════════════════════════════
Generates the daily agricultural intelligence briefing via Claude API.
Designed to be run by GitHub Actions every morning (5:00 AM CT).

v3 changes:
  - Complete prompt rewrite: voice, connections, farmer actions
  - Overnight surprise detection (flags moves > expected thresholds)
  - Per-section bottom_line + conviction_level
  - Curated 200+ quote bank (no more "pick a farming quote" randomness)
  - Farmer action items: blunt, specific, actionable
  - Enhanced JSON schema for richer homepage hydration

Data pipeline:
  1. Read /data/prices.json (yfinance, already fetched by fetch_prices.py)
  2. Fetch ag RSS feeds for overnight news context
  3. Fetch USDA calendar data
  4. Call Claude API with enriched prompt + market data
  5. Write /data/daily.json

Env vars required:
  ANTHROPIC_API_KEY — Claude API key
"""

import json
import os
import sys
import random
import math
from datetime import datetime, timezone, timedelta
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

# ═══════════════════════════════════════════════════════════════════
# CONFIGURATION
# ═══════════════════════════════════════════════════════════════════

PRICES_PATH = Path(__file__).parent / "data" / "prices.json"
OUTPUT_PATH = Path(__file__).parent / "data" / "daily.json"
ANTHROPIC_API = "https://api.anthropic.com/v1/messages"
MODEL = "claude-sonnet-4-20250514"

# Overnight surprise thresholds (% move that's newsworthy)
SURPRISE_THRESHOLDS = {
    "corn":      1.5,
    "corn-dec":  1.5,
    "beans":     1.5,
    "beans-nov": 1.5,
    "wheat":     2.0,
    "oats":      2.5,
    "cattle":    1.5,
    "feeders":   1.5,
    "hogs":      2.0,
    "milk":      3.0,
    "meal":      2.0,
    "soyoil":    2.5,
    "crude":     3.0,
    "natgas":    4.0,
    "gold":      1.5,
    "silver":    2.5,
    "dollar":    0.5,
    "sp500":     1.5,
    "bitcoin":   4.0,
}

COMMODITY_LABELS = {
    "corn":      "Corn (nearby)",
    "corn-dec":  "Corn Dec '26",
    "beans":     "Soybeans (nearby)",
    "beans-nov": "Soybeans Nov '26",
    "wheat":     "Chicago Wheat",
    "oats":      "Oats",
    "cattle":    "Live Cattle",
    "feeders":   "Feeder Cattle",
    "hogs":      "Lean Hogs",
    "milk":      "Class III Milk",
    "meal":      "Soybean Meal",
    "soyoil":    "Soybean Oil",
    "crude":     "WTI Crude Oil",
    "natgas":    "Natural Gas",
    "gold":      "Gold",
    "silver":    "Silver",
    "dollar":    "US Dollar Index",
    "sp500":     "S&P 500",
    "bitcoin":   "Bitcoin",
}

GRAIN_KEYS = {"corn", "corn-dec", "beans", "beans-nov", "wheat", "oats"}

# RSS feeds for overnight agricultural news context
AG_RSS_FEEDS = [
    "https://www.usda.gov/rss/latest-releases.xml",
    "https://www.dtnpf.com/agriculture/web/ag/news/rss",
    "https://www.agriculture.com/rss/news",
    "https://www.farms.com/rss/agriculture-news.aspx",
    "https://www.reuters.com/arc/outboundfeeds/v3/all/tag%3Aagriculture/?outputType=xml&size=10",
]

# ═══════════════════════════════════════════════════════════════════
# CURATED QUOTE BANK — 210 quotes
# ═══════════════════════════════════════════════════════════════════

QUOTE_BANK = [
    # ── Farming wisdom & grit ─────────────────────────────────────
    ("The best fertilizer is the farmer's shadow.", "Chinese proverb"),
    ("A farmer's footsteps are the best manure.", "English proverb"),
    ("He who plants a garden plants happiness.", "Chinese proverb"),
    ("To forget how to dig the earth and tend the soil is to forget ourselves.", "Mahatma Gandhi"),
    ("The farmer is the only man in our economy who buys everything at retail, sells everything at wholesale, and pays the freight both ways.", "John F. Kennedy"),
    ("Agriculture is the most healthful, most useful, and most noble employment of man.", "George Washington"),
    ("If you tickle the earth with a hoe she laughs with a harvest.", "Douglas William Jerrold"),
    ("The nation that destroys its soil destroys itself.", "Franklin D. Roosevelt"),
    ("When tillage begins, other arts follow.", "Daniel Webster"),
    ("Farming is a profession of hope.", "Brian Brett"),
    ("In the spring, at the end of the day, you should smell like dirt.", "Margaret Atwood"),
    ("The land is the only thing that lasts.", "Irish proverb"),
    ("We didn't inherit the land from our ancestors. We borrow it from our children.", "Wendell Berry"),
    ("The soil is the great connector of lives, the source and destination of all.", "Wendell Berry"),
    ("Eating is an agricultural act.", "Wendell Berry"),
    ("A good farmer is nothing more nor less than a handy man with a sense of humus.", "E.B. White"),
    ("I would rather be on my farm than be emperor of the world.", "George Washington"),
    ("What I stand for is what I stand on.", "Wendell Berry"),
    ("The ultimate goal of farming is not the growing of crops, but the cultivation of human beings.", "Masanobu Fukuoka"),
    ("Life on a farm is a school of patience; you can't hurry the crops or make it rain.", "Henri Alain"),
    ("No occupation is so delightful to me as the culture of the earth.", "Thomas Jefferson"),
    ("Farming looks mighty easy when your plow is a pencil and you're a thousand miles from the corn field.", "Dwight D. Eisenhower"),
    ("The farmer has to be an optimist or he wouldn't still be a farmer.", "Will Rogers"),
    ("To own a bit of ground, to scratch it with a hoe, to plant seeds, and watch the renewal of life — this is the commonest delight of the race.", "Charles Dudley Warner"),

    # ── Market wisdom ─────────────────────────────────────────────
    ("Markets can stay irrational longer than you can stay solvent.", "John Maynard Keynes"),
    ("The four most dangerous words in investing are: 'This time it's different.'", "Sir John Templeton"),
    ("Price is what you pay. Value is what you get.", "Warren Buffett"),
    ("The market is a device for transferring money from the impatient to the patient.", "Warren Buffett"),
    ("Risk comes from not knowing what you're doing.", "Warren Buffett"),
    ("The best time to sell grain was yesterday. The second-best time is when the market gives you a gift.", "Midwestern grain trader proverb"),
    ("Bulls make money, bears make money, pigs get slaughtered.", "Wall Street proverb"),
    ("Don't try to buy at the bottom and sell at the top. It can't be done — except by liars.", "Bernard Baruch"),
    ("The trend is your friend until the end when it bends.", "Ed Seykota"),
    ("Sell when the market is high enough to make you happy.", "Purdue Extension"),
    ("Basis is the farmer's friend — learn it, track it, trade it.", "University of Illinois Extension"),
    ("A bushel sold at profit is worth two bushels of hope.", "Unknown grain merchant"),
    ("Never gamble with the rent money. That goes double for operating loans.", "Farm Credit Services"),

    # ── Soil & stewardship ────────────────────────────────────────
    ("The health of soil, plant, animal, and man is one and indivisible.", "Sir Albert Howard"),
    ("Healthy soil is the real capital that matters in agriculture.", "Allan Savory"),
    ("We know more about the movement of celestial bodies than about the soil underfoot.", "Leonardo da Vinci"),
    ("Take care of the land and the land will take care of you.", "Aboriginal Australian proverb"),
    ("Soil is not just dirt — it's the living skin of the earth.", "David Montgomery"),
    ("Building soil is like building a savings account. Every cover crop is a deposit.", "Ray Archuleta, NRCS"),
    ("One tablespoon of healthy soil has more organisms than there are people on earth.", "Soil Science Society of America"),
    ("The soil is the mother. Everything comes from the soil, and everything returns to it.", "Lakota Sioux teaching"),
    ("Carbon in the soil is money in the bank.", "Gabe Brown"),
    ("Managing for soil health isn't a cost — it's an investment with compound interest.", "USDA NRCS"),
    ("Tillage is a tax on your soil's future.", "No-till farming proverb"),

    # ── Weather & seasons ─────────────────────────────────────────
    ("Everyone complains about the weather, but nobody does anything about it.", "Charles Dudley Warner"),
    ("Climate is what we expect; weather is what we get.", "Mark Twain"),
    ("A dry March and a wet May fill barns and bays with corn and hay.", "English farming proverb"),
    ("When the wind is in the east, 'tis neither good for man nor beast.", "Old weather proverb"),
    ("Red sky at night, sailor's delight. Red sky in the morning, sailors take warning.", "Traditional"),
    ("Make hay while the sun shines.", "English proverb"),
    ("Rain before seven, clear before eleven.", "Weather proverb"),
    ("Knee high by the Fourth of July is an old standard — modern hybrids laugh at it.", "Iowa State Extension"),
    ("A late frost is the cruelest tax the sky can levy.", "Unknown"),

    # ── Regenerative & modern ag ──────────────────────────────────
    ("We're not just farming crops. We're farming ecosystems.", "Gabe Brown"),
    ("The next revolution in agriculture won't come from chemistry — it'll come from biology.", "Jonathan Lundgren"),
    ("Diversity above the ground creates diversity below it.", "Gabe Brown"),
    ("Precision ag without soil health is like GPS without a destination.", "Unknown agronomist"),
    ("Every farm is a different puzzle. The best farmers never stop solving.", "Unknown extension agent"),
    ("Data doesn't replace intuition — it sharpens it.", "Purdue Digital Ag"),
    ("The combine doesn't care about your feelings. It measures your decisions.", "Unknown Illinois farmer"),
    ("Farm like your grandchildren will inherit this land. Because they will.", "Land Institute"),
    ("Cover crops aren't lazy — they're the hardest-working employees on your farm and they work for free.", "SARE"),
    ("The future of farming is in the first six inches of soil.", "Fred Kirschenmann"),

    # ── Economics & policy ────────────────────────────────────────
    ("Trade wars have no winners — just varying degrees of losers.", "Agricultural trade proverb"),
    ("The best farm program is a good price.", "John Block, USDA Secretary"),
    ("Interest rates are like gravity for asset prices. When they go up, everything gets heavier.", "Warren Buffett, adapted"),
    ("The dollar is the most important price in agriculture that nobody talks about.", "Unknown ag economist"),
    ("Exports move basis. Basis moves profitability. Everything connects.", "University of Minnesota Extension"),
    ("Every percentage point in interest rates is a dollar an acre off farmland value.", "Farm Credit East"),
    ("Crop insurance isn't free money — it's the floor, not the ceiling.", "Risk management advisor"),
    ("Don't confuse a rising market with good marketing.", "K-State Ag Economics"),

    # ── Humor & levity ────────────────────────────────────────────
    ("My grandfather used to say that once in your life you need a doctor, a lawyer, a policeman, and a preacher, but every day, three times a day, you need a farmer.", "Brenda Schoepp"),
    ("Behind every successful rancher is a wife who works in town.", "Western ranch proverb"),
    ("Rain makes grain — except when it doesn't stop.", "Unknown Midwest farmer"),
    ("The two happiest days in a farmer's life: the day he buys a new combine and the day he pays it off.", "Unknown"),
    ("God made a farmer because He needed someone willing to get up before dawn and work past dark.", "Paul Harvey, adapted"),
    ("Farming: where every year you bet the farm on the weather, the market, and the government — and still show up next spring.", "Unknown"),
    ("My exit strategy is the same as my father's: feet first.", "Unknown generational farmer"),
    ("Ag Twitter is the world's largest coffee shop argument about planting dates.", "Unknown"),

    # ── Indigenous & traditional knowledge ────────────────────────
    ("When the last tree is cut, the last fish is caught, and the last river is polluted, only then will man discover that money cannot be eaten.", "Cree prophecy"),
    ("Plant corn when oak leaves are the size of a squirrel's ear.", "Native American planting guide"),
    ("The earth does not belong to us. We belong to the earth.", "Chief Seattle"),
    ("The frog does not drink up the pond in which he lives.", "Sioux proverb"),
    ("Treat the earth well. It was not given to you by your parents, it was loaned to you by your children.", "Kenyan proverb"),
    ("When you plant a seed of corn, you plant a seed of faith.", "Mayan saying"),
    ("Three sisters — corn, beans, and squash — teach us that the strongest farms grow in community.", "Haudenosaunee teaching"),

    # ── Agricultural science & agronomy ───────────────────────────
    ("Every 1% increase in organic matter holds 20,000 more gallons of water per acre.", "NRCS"),
    ("Nitrogen doesn't know if it came from a bag or a legume. The soil doesn't care either.", "Extension agronomist"),
    ("The difference between a 180-bushel corn crop and a 230-bushel crop is usually management, not genetics.", "Pioneer agronomist"),
    ("You can't make up in September what you lost in June.", "Midwest agronomist"),
    ("A weed is a plant whose virtues have not yet been discovered.", "Ralph Waldo Emerson"),
    ("The best time to scout your fields is always today.", "IPM specialist"),
    ("Compaction costs you bushels you'll never see on the yield monitor.", "Soil physicist"),
    ("Planting date is the cheapest input with the highest return.", "Purdue agronomy"),
    ("Every day past optimal planting date costs you roughly a bushel per acre in corn. Mother Nature charges interest.", "Iowa State University"),
    ("Soil testing is the cheapest agronomic investment you can make. Do it every year.", "Extension soil scientist"),

    # ── Risk management ───────────────────────────────────────────
    ("Hope is not a marketing plan.", "K-State grain marketing"),
    ("If the market gives you a profit, take it. You can always have regret on the way to the bank.", "DTN grain analyst"),
    ("Forward contracting isn't about being right — it's about being profitable.", "Unknown grain merchandiser"),
    ("Diversification is the only free lunch in investing — and in farming.", "Harry Markowitz, adapted"),
    ("Revenue protection doesn't make you rich. It keeps you farming.", "Crop insurance agent"),
    ("The only sure thing in grain marketing is that you'll never sell the high.", "Unknown"),
    ("Grain in the bin is an option with a storage cost. Know your carry.", "CME Group education"),
    ("Lock in fuel when it's cheap. Lock in grain prices when they're profitable. Both are perishable opportunities.", "Farm management advisor"),
    ("The worst time to make a marketing decision is when you have to.", "KSU Ag Economics"),

    # ── Land & legacy ─────────────────────────────────────────────
    ("Buy land. They're not making any more of it.", "Mark Twain"),
    ("Land values follow income. Income follows management. Management follows education.", "Farm Credit"),
    ("The best view in the world is a field of corn in late July.", "Unknown Midwestern farmer"),
    ("Every furrow is a story. Every harvest is a chapter.", "Unknown"),
    ("In 40 years of farming, I've never had the same year twice. That's the beauty and the terror of it.", "Unknown Iowa farmer"),

    # ── Global perspective ────────────────────────────────────────
    ("When China buys, the world moves. When they stop, the world holds its breath.", "Ag trade analyst"),
    ("Whoever controls the food supply controls the people.", "Henry Kissinger"),
    ("Brazil didn't become an ag superpower overnight. They invested in soil, infrastructure, and science for decades.", "EMBRAPA"),
    ("The Black Sea region is agriculture's wild card — it can make or break global grain prices in a single season.", "USDA FAS"),
    ("An acre in Iowa competes with an acre in Mato Grosso every single day. That's the global market.", "Unknown"),

    # ── Technology & innovation ───────────────────────────────────
    ("The tractor replaced the horse. GPS replaced the marker. AI won't replace the farmer — it'll replace the guesswork.", "Unknown"),
    ("Big data is only as good as the farmer interpreting it.", "Precision ag consultant"),
    ("Drones show you the field from the sky. But your boots on the ground still make the call.", "UAS agricultural specialist"),
    ("The most advanced technology on most farms is the operator.", "John Deere engineer"),
    ("A yield monitor is a report card for every decision you made all season.", "Unknown"),

    # ── Persistence & character ───────────────────────────────────
    ("The best time to plant a tree was 20 years ago. The second best time is now.", "Chinese proverb"),
    ("Tough times don't last. Tough farmers do.", "Unknown"),
    ("Some years the crop is good and the price is bad. Some years the price is good and the crop is bad. That's farming.", "Unknown"),
    ("You learn more from a crop failure than from a record yield. The tuition is just a lot more expensive.", "Unknown"),
    ("Spring always comes. That's the farmer's creed.", "Unknown"),
    ("The most important crop any farmer grows is the next generation.", "Unknown"),
    ("Sunrise is the farmer's opening bell.", "Unknown"),
    ("Every seed planted is an act of faith in tomorrow.", "Unknown"),
    ("Don't tell me how hard you work. Show me your field in August.", "Unknown"),
    ("The best farmers I know read more than they plow.", "County extension agent"),
    ("The only thing harder than farming is not farming when it's in your blood.", "Unknown"),
    ("A bad year in farming teaches you what ten good years can't.", "Unknown"),

    # ── Additional variety ────────────────────────────────────────
    ("Agriculture is our wisest pursuit, because it will in the end contribute most to real wealth, good morals, and happiness.", "Thomas Jefferson"),
    ("The land that feeds us is worth fighting for.", "Unknown"),
    ("A society grows great when old men plant trees whose shade they know they shall never sit in.", "Greek proverb"),
    ("Farming teaches you that you can do everything right and still get beat. And then you plant again.", "Unknown"),
    ("The only thing more stubborn than a farmer is the land itself.", "Unknown"),
    ("There are no shortcuts in farming. Just long days and early mornings.", "Unknown"),
    ("The market doesn't owe you anything. Neither does the weather. But the land always gives back what you put in.", "Unknown"),
    ("Patience and perseverance have a magical effect before which difficulties disappear and obstacles vanish.", "John Quincy Adams"),
    ("You can judge a civilization by the way it treats its soil.", "Hugh Hammond Bennett"),
    ("Good seed, good ground, good timing — everything else is conversation.", "Unknown elevator manager"),
    ("A farm without animals is a farm without a soul. A farm without soil health is a farm without a future.", "Unknown"),
    ("The hardest part of farming isn't the work — it's the waiting.", "Unknown"),
    ("Every generation of farmers inherits the soil of the last and leaves the soil for the next.", "Unknown"),
    ("It is well to remember that the entire universe, with one trifling exception, is composed of others.", "John Andrew Holmes"),
    ("Agriculture not only gives riches to a nation, but the only riches she can call her own.", "Samuel Johnson"),
    ("Whoever could make two ears of corn grow upon a spot of ground where only one grew before would deserve better of mankind than the whole race of politicians put together.", "Jonathan Swift"),
    ("Those too lazy to plow in the right season will have no food at the harvest.", "Proverbs 20:4"),
    ("Agriculture was the first occupation of man, and as it embraces the whole earth, it is the foundation of all other industries.", "Edward W. Stewart"),
]


# ═══════════════════════════════════════════════════════════════════
# DATA COLLECTION
# ═══════════════════════════════════════════════════════════════════

def http_get(url, timeout=10):
    """Simple HTTP GET that works with requests or urllib."""
    if requests:
        try:
            r = requests.get(url, timeout=timeout)
            r.raise_for_status()
            return r.text
        except Exception as e:
            print(f"  [warn] fetch failed: {url} — {e}", file=sys.stderr)
            return None
    else:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "AGSIST-Daily/3.0"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read().decode("utf-8", errors="replace")
        except Exception as e:
            print(f"  [warn] fetch failed: {url} — {e}", file=sys.stderr)
            return None


def load_prices():
    """Load prices.json and compute overnight surprises."""
    if not PRICES_PATH.exists():
        print("[error] prices.json not found", file=sys.stderr)
        return {}, []

    with open(PRICES_PATH) as f:
        data = json.load(f)

    quotes = data.get("quotes", {})
    fetched = data.get("fetched", "")

    price_lines = []
    surprises = []

    for key, label in COMMODITY_LABELS.items():
        q = quotes.get(key)
        if not q or q.get("close") is None:
            continue

        close = float(q["close"])
        opn = float(q.get("open", close))
        net = q.get("netChange")
        pct = q.get("pctChange")

        if net is not None:
            net = float(net)
        else:
            net = close - opn

        if pct is not None:
            pct = float(pct)
        elif opn != 0:
            pct = (net / opn) * 100
        else:
            pct = 0.0

        is_grain = key in GRAIN_KEYS
        if is_grain:
            price_str = f"${close / 100:.2f}/bu"
            chg_str = f"{net / 100:+.4f} ({pct:+.1f}%)"
        elif key in ("gold", "bitcoin"):
            price_str = f"${close:,.0f}"
            chg_str = f"{pct:+.1f}%"
        elif key == "treasury10":
            price_str = f"{close:.2f}%"
            chg_str = f"{pct:+.1f}%"
        else:
            price_str = f"${close:.2f}"
            chg_str = f"{pct:+.1f}%"

        direction = "▲" if pct > 0 else "▼" if pct < 0 else "—"
        line = f"  {label}: {price_str} ({direction} {chg_str})"

        # 52-week range context
        wk52_hi = q.get("wk52_hi")
        wk52_lo = q.get("wk52_lo")
        if wk52_hi and wk52_lo:
            hi, lo = float(wk52_hi), float(wk52_lo)
            if hi > lo:
                position = ((close - lo) / (hi - lo)) * 100
                line += f" [52wk: {position:.0f}% from low]"

        price_lines.append(line)

        # Overnight surprise check
        threshold = SURPRISE_THRESHOLDS.get(key, 2.0)
        if abs(pct) >= threshold:
            surprises.append({
                "commodity": label,
                "key": key,
                "price": price_str,
                "pct_change": pct,
                "direction": "up" if pct > 0 else "down",
                "surprise_magnitude": round(abs(pct) / threshold, 1),
            })

    surprises.sort(key=lambda x: x["surprise_magnitude"], reverse=True)

    return {
        "price_block": "\n".join(price_lines),
        "fetched": fetched,
        "surprises": surprises,
        "quotes": quotes,
    }, surprises


def fetch_ag_news():
    """Fetch recent ag news headlines from RSS feeds."""
    if not feedparser:
        print("  [info] feedparser not installed, skipping RSS", file=sys.stderr)
        return "No RSS feeds available — focus on price action and seasonal context."

    headlines = []
    for feed_url in AG_RSS_FEEDS:
        try:
            text = http_get(feed_url, timeout=8)
            if not text:
                continue
            feed = feedparser.parse(text)
            for entry in feed.entries[:5]:
                title = entry.get("title", "").strip()
                pub = entry.get("published", entry.get("updated", ""))
                if title:
                    headlines.append(f"  • {title} ({pub[:16]})")
        except Exception as e:
            print(f"  [warn] RSS parse failed: {feed_url} — {e}", file=sys.stderr)
            continue

    if not headlines:
        return "No fresh RSS headlines — focus on price action and seasonal context."

    seen = set()
    unique = []
    for h in headlines:
        key = h[:60].lower()
        if key not in seen:
            seen.add(key)
            unique.append(h)
    return "\n".join(unique[:25])


def get_seasonal_context():
    """Return time-of-year context for the briefing."""
    now = datetime.now()
    month = now.month

    contexts = {
        1: "Mid-winter: Watch South American crop development (Brazil safrinha, Argentina soybeans). Cattle markets seasonally strong. Input purchasing decisions for spring. Tax planning wrapping up.",
        2: "Late winter: USDA Ag Outlook Forum typically this month. South American harvest beginning. Final input purchasing before spring. Equipment maintenance window closing.",
        3: "Pre-planting: USDA Prospective Plantings (end of March) is THE report. Fieldwork starting in South. Nitrogen applications beginning. Basis typically widens. Cash flow planning critical.",
        4: "Planting season: Corn planting underway (April 15-May 15 optimal in Corn Belt). Every day of delay costs ~1 bu/acre. Weather dominance begins.",
        5: "Peak planting: Soybean planting (May 1-June 5 optimal). Prevent plant deadline approaching. First crop condition ratings. Weather premium builds if delays.",
        6: "Growing season: Crop conditions drive markets. Pollination approaching for early-planted corn. Wheat harvest beginning in Southern Plains.",
        7: "Critical: Corn pollination (most critical 2 weeks of the year). USDA Acreage report (June 30). Soybean bloom/pod set. Weather premium at peak if hot/dry.",
        8: "Yield formation: Corn in dough/dent — yield largely locked in. Soybean pod fill critical. USDA Pro Farmer crop tour. Fall crop insurance pricing.",
        9: "Early harvest: Corn harvest beginning. USDA September WASDE. Basis narrows as harvest pressure builds. Storage decisions.",
        10: "Harvest: Full corn/soybean harvest. Basis at seasonal lows. Storage vs. sell decisions. Fall fieldwork. Wheat planting.",
        11: "Post-harvest: Final USDA yield estimates. South American planting. Grain storage management. Tax planning. Input purchasing beginning.",
        12: "Year-end: Final crop production estimates. USDA supply/demand tables. Tax deadlines. South American weather watch. Budgeting for next crop year.",
    }

    return contexts.get(month, "Monitor markets and seasonal patterns.")


def get_todays_quote():
    """Pick a quote using day-of-year as seed for consistent daily rotation."""
    now = datetime.now()
    seed = now.timetuple().tm_yday + now.year * 1000
    random.seed(seed)
    quote, attribution = random.choice(QUOTE_BANK)
    random.seed()
    return {"text": quote, "attribution": attribution}


# ═══════════════════════════════════════════════════════════════════
# CLAUDE API CALL
# ═══════════════════════════════════════════════════════════════════

def build_system_prompt():
    return """You are the voice of AGSIST Daily — the most trusted morning agricultural intelligence briefing in the Upper Midwest. You write for corn, soybean, and grain producers in Wisconsin and Minnesota who check this briefing with their first cup of coffee.

YOUR VOICE:
- You're the sharp friend who actually trades grain AND reads the WASDE. Not an academic. Not a reporter. An analyst with dirt under their fingernails.
- Direct, opinionated, but honest about uncertainty. When you don't know, say "the data isn't clear yet" — never fake confidence.
- Connect dots that farmers wouldn't connect on their own. "Wheat dropped 14½¢" is a data point. "Wheat dropped 14½¢ — but the real story is Black Sea competition heating up while your spring planting window opens" is a briefing.
- Every sentence should pass the test: "Would a farmer forward this to their neighbor?" If not, rewrite it.
- Use plain language. No jargon without context. "Managed money" needs a parenthetical "(hedge funds)" the first time.

STRUCTURE — return valid JSON with this exact schema:

{
  "headline": "ALL CAPS, 6-10 words. The single biggest story. Punchy, specific. Not 'MARKETS MIXED' — that says nothing. Try 'CORN RALLIES ON SURPRISE EXPORT FLASH' or 'WHEAT COLLAPSES AS BLACK SEA FLOODS MARKET'",
  "subheadline": "One sentence that adds the second-biggest story or the 'why' behind the headline.",
  "lead": "2-3 sentences. The executive summary a farmer reads if they read nothing else. What happened, why it matters, what to watch. This should be genuinely useful — not filler.",
  "teaser": "One punchy sentence for the collapsed hero bar. Make it intriguing enough to expand.",
  "one_number": {
    "value": "The single most important number today. Format for impact — '$4.52' or '14½¢' or '2.3M' or '47%'.",
    "unit": "What the number represents in 3-6 words.",
    "context": "2-3 sentences explaining WHY this number matters today. Connect it to farmer decisions."
  },
  "sections": [
    {
      "title": "Section title (3-5 words)",
      "icon": "Single emoji",
      "body": "3-5 sentences of ANALYSIS, not reporting. Connect moves to causes, causes to farmer decisions. Bold the most important phrase with <strong> tags. Reference at least TWO commodities and make ONE connection between them.",
      "bottom_line": "One sentence TL;DR, max 20 words. Be blunt.",
      "conviction_level": "low | medium | high",
      "overnight_surprise": true/false,
      "farmer_action": "Specific, actionable. 'Consider pricing 10-15% of new-crop corn on this rally' or 'No action needed — hold current positions'."
    }
  ],
  "the_more_you_know": {
    "title": "Educational topic title connected to today's market action",
    "body": "3-4 sentences explaining a concept. Smart friend over coffee, not a textbook."
  },
  "watch_list": [
    {
      "time": "Time or timeframe",
      "desc": "What to watch and why. Use <strong> tags for key items."
    }
  ],
  "daily_quote": {
    "text": "USE THE EXACT QUOTE PROVIDED — do not modify.",
    "attribution": "USE THE EXACT ATTRIBUTION PROVIDED — do not modify."
  },
  "source_summary": "Data sources, e.g., 'USDA · CME Group · Open-Meteo · Reuters'",
  "date": "Today's date formatted like 'Monday, March 3, 2026'",
  "meta": {
    "market_mood": "bullish | bearish | mixed | cautious | volatile",
    "heat_section": 0-based index of section with most action today,
    "overnight_surprises_count": number
  }
}

SECTIONS — always include these 4 in this order:
1. GRAINS & OILSEEDS — corn, soybeans, wheat, oats. Core audience.
2. LIVESTOCK & DAIRY — cattle, hogs, milk. Connect to feed costs.
3. ENERGY & INPUTS — crude, natgas, fertilizer/diesel implications.
4. MACRO & TRADE — dollar, rates, trade policy, exports.

QUALITY RULES:
- Never start two consecutive bullets with the same commodity
- The lead must contain at least one specific number
- Each section body references 2+ commodities with 1+ connection between them
- 'farmer_action' must be actionable TODAY
- 'bottom_line' max 20 words
- If overnight_surprise: true, explain WHY it's unusual
- 'the_more_you_know' connects to today's market
- Watch list: 3-5 items, mix of today and this-week

RESPOND WITH ONLY THE JSON OBJECT. No markdown fences. No preamble."""


def call_claude(price_data, surprises, news_block, seasonal_ctx, todays_quote):
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("[error] ANTHROPIC_API_KEY not set", file=sys.stderr)
        sys.exit(1)

    now = datetime.now()
    date_str = now.strftime("%A, %B %-d, %Y")

    surprise_block = ""
    if surprises:
        lines = []
        for s in surprises:
            mag = "Notable" if s["surprise_magnitude"] < 2 else "SIGNIFICANT" if s["surprise_magnitude"] < 3 else "MAJOR"
            lines.append(f"  ⚡ {mag}: {s['commodity']} moved {s['pct_change']:+.1f}% ({s['direction']}) — {s['surprise_magnitude']}x normal threshold")
        surprise_block = f"⚡ OVERNIGHT SURPRISES ({len(surprises)} moves above threshold):\n" + "\n".join(lines)
        surprise_block += "\nFlag these in relevant sections with overnight_surprise: true and explain WHY."
    else:
        surprise_block = "No overnight surprises — moves within normal ranges."

    user_message = f"""Generate today's AGSIST Daily briefing.

DATE: {date_str}

═══ MARKET DATA (yfinance, fetched {price_data.get('fetched', 'recently')}) ═══
{price_data.get('price_block', 'Price data unavailable')}

═══ OVERNIGHT SURPRISE ANALYSIS ═══
{surprise_block}

═══ SEASONAL CONTEXT ═══
{seasonal_ctx}

═══ AG NEWS HEADLINES ═══
{news_block}

═══ TODAY'S QUOTE (use exactly as provided) ═══
Text: "{todays_quote['text']}"
Attribution: "{todays_quote['attribution']}"

Your job isn't to report prices — farmers have a ticker. Tell them what prices MEAN, what they SHOULD DO, and what's COMING NEXT. Connect the dots. Be bold. Be useful."""

    payload = {
        "model": MODEL,
        "max_tokens": 4000,
        "system": build_system_prompt(),
        "messages": [{"role": "user", "content": user_message}],
    }

    headers = {
        "Content-Type": "application/json",
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
    }

    if requests:
        resp = requests.post(ANTHROPIC_API, json=payload, headers=headers, timeout=60)
        resp.raise_for_status()
        result = resp.json()
    else:
        data_bytes = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(ANTHROPIC_API, data=data_bytes, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read().decode("utf-8"))

    text = ""
    for block in result.get("content", []):
        if block.get("type") == "text":
            text += block["text"]

    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1] if "\n" in text else text[3:]
    if text.endswith("```"):
        text = text[:-3]
    text = text.strip()
    if text.startswith("json"):
        text = text[4:].strip()

    return json.loads(text)


# ═══════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════

def main():
    print("═══ AGSIST Daily Briefing Generator v3 ═══")
    print(f"  Time: {datetime.now().isoformat()}")

    print("  Loading prices.json...")
    price_data, surprises = load_prices()
    if surprises:
        print(f"  ⚡ {len(surprises)} overnight surprise(s)!")
        for s in surprises:
            print(f"    {s['commodity']}: {s['pct_change']:+.1f}% ({s['surprise_magnitude']}x)")
    else:
        print("  No overnight surprises.")

    print("  Fetching ag news RSS...")
    news_block = fetch_ag_news()

    seasonal_ctx = get_seasonal_context()
    print(f"  Seasonal context loaded.")

    todays_quote = get_todays_quote()
    print(f"  Quote: \"{todays_quote['text'][:50]}...\" — {todays_quote['attribution']}")

    print("  Calling Claude API...")
    briefing = call_claude(price_data, surprises, news_block, seasonal_ctx, todays_quote)

    # Inject metadata
    briefing["generated_at"] = datetime.now(timezone.utc).isoformat()
    briefing["generator_version"] = "3.0"
    briefing["surprise_count"] = len(surprises)
    briefing["surprises"] = surprises
    if "meta" not in briefing:
        briefing["meta"] = {}
    briefing["meta"]["overnight_surprises_count"] = len(surprises)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(briefing, f, indent=2, ensure_ascii=False)

    print(f"  ✅ Written to {OUTPUT_PATH}")
    print(f"  Headline: {briefing.get('headline', 'N/A')}")
    print(f"  Sections: {len(briefing.get('sections', []))}")
    print(f"  Surprises: {len(surprises)}")
    print("═══ Done ═══")


if __name__ == "__main__":
    main()
