#!/usr/bin/env python3
"""
AGSIST fetch_markets.py  v4
════════════════════════════
Fetches prediction-market odds relevant to agriculture from Kalshi
and Polymarket.  Runs once daily via GitHub Actions (6 AM CT).

v4 changes (2026-03-02):
  • Lowered minimum relevance to 40 (was 60) — macro/weather markets
    like interest rates, recession odds, dollar moves ARE relevant to ag
  • Massively expanded meme/junk filter — catches sports teams, players,
    entertainment by pattern, not just exact strings
  • Added category-aware sports detection (team names, league patterns)
  • Graceful empty-state: output always valid even with 0 markets
  • Better dedup across platforms

Sources (public, no API keys required):
  • Kalshi      — https://api.elections.kalshi.com/trade-api/v2/markets
  • Polymarket  — https://gamma-api.polymarket.com/markets
"""

import json
import re
import os
import math
import time
from datetime import datetime, timezone

try:
    import urllib.request as urllib_request
    import urllib.error as urllib_error
except ImportError:
    import urllib2 as urllib_request


# ═════════════════════════════════════════════════════════════════
# 1. SEARCH QUERIES — targeted, deduplicated
# ═════════════════════════════════════════════════════════════════

SEARCH_QUERIES = [
    # Direct ag commodities
    "corn", "soybean", "wheat", "grain", "cattle", "livestock",
    "ethanol", "dairy", "cotton", "sugar", "pork",
    # Ag policy & trade
    "tariff", "usda", "farm bill", "crop",
    "china trade", "brazil soybean",
    # Energy (input costs)
    "oil price", "crude oil", "natural gas", "diesel",
    # Weather
    "drought", "hurricane", "flood", "el nino",
    # Macro (affects exports, rates, dollar)
    "interest rate", "inflation", "recession", "federal reserve",
    "fed funds rate", "rate cut", "rate hike",
    # Infrastructure
    "rail strike", "mississippi river", "supply chain",
    # Disease
    "bird flu", "avian influenza",
    # Fertilizer
    "fertilizer", "nitrogen",
]


# ═════════════════════════════════════════════════════════════════
# 2. KEYWORD TIERS — for relevance scoring
# ═════════════════════════════════════════════════════════════════

TIER1_KEYWORDS = [
    "corn", "soybean", "wheat", "grain", "crop", "usda", "wasde",
    "drought", "farm", "cattle", "hog", "livestock", "ethanol",
    "harvest", "planting", "acreage", "export inspection",
    "fertilizer", "urea", "canola", "sorghum", "cotton", "rice",
    "pork", "beef", "dairy", "milk", "oat", "barley", "sugar",
    "poultry", "chicken", "egg", "crop insurance", "farm bill",
    "food price", "food inflation", "cropland", "grazing",
    "soil moisture", "growing season", "yield", "bushel",
    "commodity", "grain elevator", "feedlot",
]

TIER2_KEYWORDS = [
    "tariff", "trade war", "trade deal", "trade agreement",
    "china trade", "china import", "china export", "china ban",
    "brazil", "argentina", "ukraine", "black sea",
    "usmca", "nafta", "wto", "trade dispute", "sanction",
    "crude oil", "natural gas", "diesel", "gasoline", "energy price",
    "oil price", "opec", "pipeline", "renewable fuel", "biofuel",
    "carbon tax", "carbon credit", "emission",
    "epa", "environmental regulation", "water rights",
    "mississippi river", "panama canal", "suez canal",
    "rail strike", "railroad", "freight", "shipping",
    "port strike", "supply chain", "trucking",
    "immigration", "farm labor", "h-2a", "migrant worker",
    "bird flu", "avian influenza", "african swine fever",
    "mad cow", "food safety", "fda",
]

TIER3_KEYWORDS = [
    "interest rate", "fed rate", "federal reserve", "fed funds",
    "rate cut", "rate hike", "fomc", "powell",
    "inflation", "cpi", "ppi", "recession", "gdp", "unemployment",
    "dollar", "usd", "currency", "yuan", "peso", "real",
    "government shutdown", "debt ceiling", "budget",
    "el nino", "la nina", "hurricane", "flood", "wildfire",
    "heat wave", "polar vortex", "frost", "freeze",
    "climate change", "climate policy", "paris agreement",
    "water shortage", "aquifer", "irrigation",
    "land use", "deforestation", "amazon",
    "food security", "famine", "world food programme",
    "fertilizer ban", "nitrogen", "phosphate", "potash",
]

# ═════════════════════════════════════════════════════════════════
# 3. MEME / JUNK MARKET FILTER — aggressive
# ═════════════════════════════════════════════════════════════════

# Exact substrings that instantly disqualify a market
MEME_BLACKLIST = [
    # Gaming
    "gta", "grand theft auto", "video game", "gaming", "esports",
    "playstation", "xbox", "nintendo", "steam", "fortnite",
    "minecraft", "call of duty", "league of legends", "valorant",
    # Entertainment
    "oscar", "grammy", "emmy", "golden globe", "tony award",
    "bachelor", "bachelorette", "reality tv", "survivor",
    "movie", "box office", "netflix", "disney", "hulu",
    "celebrity", "kardashian", "swift", "beyonce", "drake",
    "album", "billboard", "spotify", "concert", "tour",
    # Social media
    "tiktok", "instagram", "youtube", "twitch", "streamer",
    "subscriber", "follower count", "viral",
    # Space/sci-fi
    "spacex", "mars colony", "moon landing", "alien", "ufo",
    # Crypto memes (keep bitcoin/eth but filter meme coins)
    "dogecoin", "shiba", "pepe coin", "meme coin", "nft",
    # Politics gossip (not policy)
    "dating", "divorce", "wedding", "baby", "pregnant",
    "tweet", "twitter feud", "social media post",
    # Awards/rankings
    "time person of the year", "most popular", "best dressed",
]

# Sports teams, leagues, and patterns
# These catch markets about games, scores, championships
SPORTS_BLACKLIST = [
    # Leagues
    "nfl", "nba", "mlb", "nhl", "mls", "wnba", "xfl",
    "premier league", "la liga", "bundesliga", "serie a",
    "champions league", "world cup", "olympics", "ncaa",
    "march madness", "super bowl", "world series",
    "stanley cup", "playoff", "playoffs",
    # NBA teams
    "lakers", "celtics", "warriors", "nuggets", "bucks",
    "76ers", "sixers", "knicks", "nets", "heat", "bulls",
    "cavaliers", "mavericks", "clippers", "suns", "kings",
    "timberwolves", "thunder", "pelicans", "grizzlies",
    "hawks", "raptors", "pacers", "magic", "wizards",
    "pistons", "hornets", "blazers", "spurs", "rockets",
    "jazz",
    # NFL teams
    "chiefs", "eagles", "49ers", "ravens", "bills",
    "cowboys", "packers", "lions", "dolphins", "bengals",
    "steelers", "broncos", "chargers", "seahawks",
    "vikings", "cardinals", "falcons", "saints",
    "buccaneers", "raiders", "colts", "jaguars",
    "texans", "titans", "panthers", "commanders",
    "bears", "rams", "patriots", "jets", "giants",
    # MLB teams
    "yankees", "dodgers", "astros", "braves", "phillies",
    "padres", "mets", "orioles", "guardians", "twins",
    "rangers", "mariners", "diamondbacks", "brewers",
    "red sox", "blue jays", "white sox", "royals",
    "athletics", "pirates", "reds", "nationals", "marlins",
    "rockies", "cubs", "rays",
    # NHL teams
    "bruins", "avalanche", "panthers", "oilers",
    "hurricanes", "rangers", "penguins", "maple leafs",
    "lightning", "canucks", "wild", "flames",
    "golden knights", "islanders", "capitals", "sabres",
    "blackhawks", "devils", "senators", "kraken",
    "predators", "sharks", "ducks", "coyotes", "flyers",
    # Common sports terms
    "mvp", "touchdown", "home run", "hat trick", "slam dunk",
    "draft pick", "free agent", "trade deadline",
    "rushing yards", "passing yards", "batting average",
    "championship", "finals mvp", "all-star",
    "win total", "over/under", "point spread",
    "regular season", "postseason",
]

# Player name patterns — sports player names that commonly appear
SPORTS_PLAYER_PATTERNS = [
    r"antetokounmpo", r"mahomes", r"jokic", r"luka\b", r"lebron",
    r"curry\b", r"giannis", r"ohtani", r"tatum", r"embiid",
    r"messi\b", r"ronaldo", r"haaland", r"mbappe",
    r"lamar jackson", r"josh allen", r"patrick mahomes",
    r"judge\b.*homer", r"batting\b", r"rushing\b", r"passing\b",
]

# Patterns that look like sports scores/stats
SPORTS_STAT_PATTERNS = [
    r"\d+\+.*points",       # "20+ points"
    r"\d+\+.*goals",        # "3+ goals"
    r"\d+\+.*rebounds",     # "10+ rebounds"
    r"\d+\+.*assists",
    r"\d+\+.*strikeouts",
    r"\d+\+.*touchdowns",
    r"over \d+\.?\d* (points|goals|runs|yards)",
    r"win.*game\s*\d",      # "win game 7"
    r"wins?\s+the\s+(title|trophy|cup|ring|belt)",
]


def is_meme_market(title):
    """Return True if market title matches meme/junk/sports patterns."""
    t = title.lower()

    # Check exact substring blacklists
    for pattern in MEME_BLACKLIST:
        if pattern in t:
            return True

    for pattern in SPORTS_BLACKLIST:
        if pattern in t:
            return True

    # Check sports player patterns (regex)
    for pattern in SPORTS_PLAYER_PATTERNS:
        if re.search(pattern, t):
            return True

    # Check sports stat patterns (regex)
    for pattern in SPORTS_STAT_PATTERNS:
        if re.search(pattern, t):
            return True

    return False


# ═════════════════════════════════════════════════════════════════
# 4. RELEVANCE SCORING
# ═════════════════════════════════════════════════════════════════

def score_relevance(text):
    """Score 0-100 how relevant a market is to agriculture.
    Tier 1 (100): direct ag — corn, cattle, USDA
    Tier 2 (70):  trade/energy — tariffs, crude oil, bird flu
    Tier 3 (40):  macro/weather — interest rates, recession, floods
    All three tiers matter to farmers.
    """
    t = text.lower()
    score = 0
    matched_tier = 0

    for kw in TIER1_KEYWORDS:
        if kw in t:
            score = max(score, 100)
            matched_tier = max(matched_tier, 1)
            break

    if score < 100:
        for kw in TIER2_KEYWORDS:
            if kw in t:
                score = max(score, 70)
                matched_tier = max(matched_tier, 2)
                break

    if score < 70:
        for kw in TIER3_KEYWORDS:
            if kw in t:
                score = max(score, 40)
                matched_tier = max(matched_tier, 3)
                break

    # Cross-tier bonus
    if matched_tier == 3:
        for kw in TIER1_KEYWORDS:
            if kw in t:
                score = min(100, score + 30)
                break
        for kw in TIER2_KEYWORDS:
            if kw in t:
                score = min(100, score + 15)
                break

    return score, matched_tier


# ═════════════════════════════════════════════════════════════════
# 5. "WHY IT MATTERS" + CATEGORY
# ═════════════════════════════════════════════════════════════════

WHY_IT_MATTERS = [
    (["corn price", "corn futures", "corn"],
     "Corn is the #1 U.S. crop by acreage. Price moves directly affect revenue, forward contracts, and crop insurance guarantees."),
    (["soybean", "soy"],
     "Soybeans are the #2 U.S. row crop. Price shifts ripple through crush margins, meal/oil markets, and export competitiveness."),
    (["wheat"],
     "Wheat prices affect rotation decisions, export demand, and food-grade premiums across the Plains and upper Midwest."),
    (["cattle", "beef"],
     "Cattle markets drive feeder prices and feed demand — higher beef prices pull more corn and distillers' grains into feedlots."),
    (["hog", "pork"],
     "Hog markets influence corn and soybean meal demand. Export disruptions or disease outbreaks move feed costs fast."),
    (["dairy", "milk"],
     "Dairy margins are squeezed by feed costs (corn, hay) and milk price. Policy shifts hit Class III and IV pricing."),
    (["poultry", "chicken", "egg"],
     "Poultry is the largest single consumer of soybean meal. Egg and broiler prices affect feed demand nationwide."),
    (["ethanol", "biofuel", "renewable fuel"],
     "~40% of U.S. corn goes to ethanol. Biofuel mandates, blend rates, and RFS waivers directly move corn basis."),
    (["cotton"],
     "Cotton competes for Southern acreage with corn and soybeans. Price moves shift planting intentions."),
    (["sugar"],
     "Sugar policy and prices affect crop rotation in the South and ethanol-vs-sugar economics in global markets."),
    (["usda", "wasde", "crop report"],
     "USDA reports (WASDE, Prospective Plantings, Crop Progress) are the single biggest scheduled price movers in grain markets."),
    (["farm bill"],
     "The Farm Bill sets crop insurance subsidies, conservation programs, SNAP funding, and commodity reference prices for 5+ years."),
    (["drought"],
     "Drought is the #1 yield threat. Even moderate dryness during pollination can cut corn yields 20-40%."),
    (["fertilizer", "urea", "nitrogen", "phosphate", "potash"],
     "Fertilizer is farmers' largest input cost after land. Price spikes compress margins and may shift acres toward soybeans."),
    (["crop insurance"],
     "Crop insurance guarantees are set by spring futures prices. Changes to policy affect risk management for every producer."),
    (["acreage", "planting"],
     "Planting intentions drive the supply outlook for the entire marketing year. Acreage shifts between corn and soybeans move prices."),
    (["tariff", "trade war"],
     "Tariffs on ag exports or retaliatory duties can close markets overnight — U.S. soy exports to China dropped 75% during 2018 trade tensions."),
    (["china"],
     "China is the world's largest ag importer. Any shift in Chinese demand or policy ripples through U.S. grain and oilseed markets."),
    (["brazil"],
     "Brazil is the #1 soybean exporter and a major corn exporter. Their crop size, currency, and logistics set the global price floor."),
    (["argentina"],
     "Argentina is the top soybean meal/oil exporter. Export taxes, drought, or political instability disrupt global crush margins."),
    (["ukraine", "black sea"],
     "The Black Sea region exports ~30% of global wheat and significant corn. Conflict or shipping disruptions spike world grain prices."),
    (["sanction"],
     "Sanctions can disrupt fertilizer supply chains (Russia produces ~15% of global nitrogen) and redirect grain trade flows."),
    (["immigration", "farm labor", "h-2a", "migrant"],
     "Agriculture depends on seasonal labor. Labor policy changes hit specialty crops and livestock processing hardest."),
    (["crude oil", "oil price", "opec"],
     "Diesel is a top 3 farm input cost. Oil prices also move fertilizer costs (natural gas → ammonia) and ethanol economics."),
    (["natural gas"],
     "Natural gas is the primary feedstock for nitrogen fertilizer. Price spikes flow directly to anhydrous ammonia and urea costs."),
    (["diesel", "gasoline", "fuel"],
     "Fuel costs for planting, spraying, harvesting, and grain drying can swing $20-40/acre. Diesel price is a direct margin input."),
    (["carbon tax", "carbon credit", "emission"],
     "Carbon markets create potential new revenue for farmers through cover crops and no-till — or add costs through fuel taxes."),
    (["hurricane"],
     "Hurricanes disrupt Gulf Coast grain export terminals and can flood rivers that move 60% of U.S. grain exports."),
    (["el nino"],
     "El Niño typically brings wetter conditions to the southern U.S. and drier weather in Australia — reshuffling global feed grain supply."),
    (["la nina"],
     "La Niña often means drier conditions across the southern Plains and Corn Belt, plus drought risk in South America."),
    (["flood"],
     "Flooding delays planting (prevent-plant claims spike), damages stored grain, and closes river barge traffic."),
    (["heat wave", "heat"],
     "Extreme heat during corn pollination can slash yields. Heat stress also reduces livestock feed efficiency and milk production."),
    (["wildfire", "fire"],
     "Wildfires destroy rangeland, displace livestock, and can trigger emergency grazing on CRP land."),
    (["frost", "freeze"],
     "Late spring frost kills emerged crops. Early fall frost ends the growing season before grain reaches maturity."),
    (["interest rate", "fed rate", "federal reserve", "fed funds", "rate cut", "rate hike", "fomc"],
     "Higher rates raise operating loan costs and farmland financing. They also strengthen the dollar, making U.S. exports less competitive."),
    (["inflation", "cpi"],
     "Inflation drives up input costs (seed, chemicals, fuel, labor) and land rents — but can also support higher commodity prices."),
    (["recession", "gdp"],
     "Recessions cut meat demand (consumers trade down from beef to chicken) and reduce ethanol consumption with lower driving miles."),
    (["dollar", "usd", "currency"],
     "A strong dollar makes U.S. grain more expensive for foreign buyers. A 10% dollar move can shift export competitiveness by $0.50+/bu."),
    (["government shutdown", "debt ceiling"],
     "Shutdowns halt USDA reports, delay FSA payments, freeze crop insurance processing, and stop conservation sign-ups."),
    (["rail strike", "railroad", "freight"],
     "Rail moves ~30% of U.S. grain. Disruptions widen basis, strand grain at elevators, and delay fertilizer deliveries."),
    (["mississippi river"],
     "The Mississippi system moves 60%+ of U.S. grain exports. Low water levels restrict barge loads and spike transport costs."),
    (["panama canal", "suez canal", "shipping", "port"],
     "Global shipping routes affect export competitiveness. Canal restrictions or port strikes reroute grain and add transit costs."),
    (["supply chain"],
     "Supply chain disruptions hit ag through delayed equipment parts, chemical shortages, and fertilizer logistics."),
    (["bird flu", "avian influenza"],
     "Avian influenza outbreaks force flock depopulation, spike egg prices, and shift soybean meal demand."),
    (["african swine fever"],
     "ASF decimated China's hog herd in 2018-19, reshaping global pork trade and soybean meal demand for years."),
    (["food price", "food inflation", "food security", "famine"],
     "Global food prices are driven by grain and oilseed markets. Food security concerns can trigger export bans that disrupt trade."),
    (["war", "conflict", "invasion"],
     "Armed conflicts disrupt grain exports, fertilizer supply, energy markets, and shipping lanes."),
]


def get_why_it_matters(title):
    t = title.lower()
    for keywords, explanation in WHY_IT_MATTERS:
        if any(kw in t for kw in keywords):
            return explanation
    return "This market reflects conditions that can influence commodity prices, input costs, or trade flows."


def get_category(title):
    t = title.lower()
    cats = {
        "Commodities": ["corn", "soybean", "wheat", "grain", "cattle", "hog",
                        "pork", "beef", "dairy", "milk", "cotton", "sugar",
                        "poultry", "egg", "rice", "oat", "barley", "ethanol"],
        "Trade & Policy": ["tariff", "trade", "china", "brazil", "argentina",
                           "ukraine", "sanction", "usda", "farm bill", "export",
                           "import", "wto", "nafta", "usmca"],
        "Energy & Inputs": ["oil", "crude", "natural gas", "diesel",
                            "biofuel", "fertilizer", "urea", "nitrogen",
                            "carbon", "renewable", "opec"],
        "Weather & Climate": ["drought", "hurricane", "el nino", "la nina",
                              "flood", "heat", "wildfire", "frost", "freeze",
                              "climate"],
        "Economy & Markets": ["interest rate", "fed", "inflation", "recession",
                              "dollar", "currency", "gdp", "unemployment",
                              "shutdown", "debt ceiling", "fomc", "rate cut",
                              "rate hike"],
        "Infrastructure": ["rail", "mississippi", "panama", "shipping", "port",
                           "supply chain", "freight", "trucking"],
    }
    for cat, keywords in cats.items():
        if any(kw in t for kw in keywords):
            return cat
    return "Other"


# ═════════════════════════════════════════════════════════════════
# 6. HTTP HELPER
# ═════════════════════════════════════════════════════════════════

def http_get_json(url, timeout=15):
    try:
        req = urllib_request.Request(url, headers={
            "User-Agent": "AGSIST/4.0 (agsist.com; agricultural data aggregator)",
            "Accept": "application/json",
        })
        with urllib_request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception as e:
        print(f"  ✗ HTTP error {url[:80]}: {e}")
        return None


def time_remaining(close_str):
    if not close_str:
        return ""
    try:
        close = datetime.fromisoformat(close_str.replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        diff = close - now
        days = diff.days
        if days < 0:    return "Closed"
        if days == 0:   return "Closes today"
        if days == 1:   return "Closes tomorrow"
        if days <= 30:  return f"Closes in {days}d"
        months = days // 30
        return f"Closes in ~{months}mo"
    except Exception:
        return ""


# ═════════════════════════════════════════════════════════════════
# 7. KALSHI FETCHER
# ═════════════════════════════════════════════════════════════════

KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2"


def fetch_kalshi():
    print("\n[Kalshi] Fetching prediction markets…")
    markets = []
    seen = set()

    url = f"{KALSHI_BASE}/markets?limit=50&status=open"
    data = http_get_json(url)
    if not data:
        print("  ✗ Kalshi API unreachable")
        return []

    items = data.get("markets", [])
    print(f"  Fetched {len(items)} open markets")

    # Paginate
    cursor = data.get("cursor", "")
    page = 1
    while cursor and page < 10:
        data2 = http_get_json(f"{url}&cursor={cursor}")
        if not data2:
            break
        new_items = data2.get("markets", [])
        if not new_items:
            break
        items.extend(new_items)
        cursor = data2.get("cursor", "")
        page += 1
        print(f"  Page {page}: +{len(new_items)} (total: {len(items)})")
        time.sleep(0.3)

    for m in items:
        ticker = m.get("ticker", "")
        if not ticker or ticker in seen:
            continue

        title = m.get("title") or m.get("subtitle") or ticker
        event_ticker = m.get("event_ticker", "")
        full_text = f"{title} {ticker} {m.get('subtitle', '')} {event_ticker}"

        if is_meme_market(full_text):
            continue

        relevance, tier = score_relevance(full_text)
        if relevance < 40:  # v4: lowered from 60
            continue

        yes_price = m.get("yes_price")
        yes_bid = m.get("yes_bid")
        yes_ask = m.get("yes_ask")

        if yes_price is not None:
            prob = yes_price
        elif yes_bid is not None and yes_ask is not None:
            prob = round((yes_bid + yes_ask) / 2)
        elif yes_bid is not None:
            prob = yes_bid
        elif yes_ask is not None:
            prob = yes_ask
        else:
            continue

        if prob <= 0 or prob >= 100:
            continue

        volume = m.get("volume", 0) or m.get("volume_24h", 0) or 0
        close_time = m.get("close_time") or m.get("expiration_time") or ""
        tl = time_remaining(close_time)
        if tl == "Closed":
            continue

        seen.add(ticker)
        markets.append({
            "platform":       "Kalshi",
            "ticker":         ticker,
            "title":          title,
            "yes":            prob,
            "no":             100 - prob,
            "volume_24h":     volume,
            "close_time":     close_time,
            "time_left":      tl,
            "url":            f"https://kalshi.com/markets/{ticker.split('-')[0]}",
            "relevance":      relevance,
            "tier":           tier,
            "category":       get_category(full_text),
            "why_it_matters": get_why_it_matters(full_text),
        })

    print(f"  → {len(markets)} ag-relevant markets ({len(seen)} unique)")
    return markets


# ═════════════════════════════════════════════════════════════════
# 8. POLYMARKET FETCHER
# ═════════════════════════════════════════════════════════════════

POLYMARKET_BASE = "https://gamma-api.polymarket.com"


def fetch_polymarket():
    print("\n[Polymarket] Fetching prediction markets…")
    markets = []
    seen = set()
    queries_tried = 0

    for kw in SEARCH_QUERIES:
        encoded = kw.replace(" ", "%20")
        url = (f"{POLYMARKET_BASE}/markets"
               f"?active=true&closed=false&limit=20"
               f"&_q={encoded}")

        data = http_get_json(url)
        queries_tried += 1

        if not data:
            url2 = (f"{POLYMARKET_BASE}/markets"
                    f"?active=true&closed=false&limit=20"
                    f"&keyword={encoded}")
            data = http_get_json(url2)

        if not data:
            continue

        items = (data if isinstance(data, list)
                 else data.get("results", data.get("markets", data.get("data", []))))

        if not isinstance(items, list):
            continue

        if items:
            print(f"  '{kw}': {len(items)} results")

        for m in items:
            mid = m.get("id") or m.get("condition_id") or m.get("conditionId")
            if not mid or mid in seen:
                continue

            question = (m.get("question") or m.get("title") or "").strip()
            if not question:
                continue

            if is_meme_market(question):
                continue

            relevance, tier = score_relevance(question)
            if relevance < 40:  # v4: lowered from 60
                continue

            # Parse probability
            prob = None
            outcome_prices = m.get("outcomePrices")
            if outcome_prices:
                try:
                    if isinstance(outcome_prices, str):
                        prices = json.loads(outcome_prices)
                    else:
                        prices = outcome_prices
                    if isinstance(prices, list) and prices:
                        first = prices[0]
                        if isinstance(first, str):
                            prob = round(float(first) * 100)
                        elif isinstance(first, (int, float)):
                            val = float(first)
                            prob = round(val * 100) if val <= 1 else round(val)
                        elif isinstance(first, dict):
                            prob = round(float(first.get("price", 0.5)) * 100)
                except Exception:
                    pass

            if prob is None:
                for field in ["bestBid", "lastTradePrice", "best_bid"]:
                    val = m.get(field)
                    if val is not None:
                        try:
                            fval = float(val)
                            prob = round(fval * 100) if fval <= 1 else round(fval)
                            break
                        except Exception:
                            pass

            if prob is None or prob <= 0 or prob >= 100:
                continue

            volume = 0
            for vol_field in ["volume", "volumeNum", "volume24hr"]:
                v = m.get(vol_field)
                if v:
                    try:
                        volume = float(v)
                        break
                    except Exception:
                        pass

            slug = m.get("slug", "")
            if slug:
                market_url = f"https://polymarket.com/event/{slug}"
            else:
                market_url = m.get("url", f"https://polymarket.com/event/{mid}")

            end_date = (m.get("endDate") or m.get("end_date_iso")
                        or m.get("endDateIso") or "")
            tl = time_remaining(end_date)
            if tl == "Closed":
                continue

            seen.add(mid)
            markets.append({
                "platform":       "Polymarket",
                "ticker":         str(mid)[:20],
                "title":          question[:140],
                "yes":            prob,
                "no":             100 - prob,
                "volume_24h":     volume,
                "close_time":     end_date,
                "time_left":      tl,
                "url":            market_url,
                "slug":           slug,
                "relevance":      relevance,
                "tier":           tier,
                "category":       get_category(question),
                "why_it_matters": get_why_it_matters(question),
            })

        time.sleep(0.25)

    print(f"  → {len(markets)} ag-relevant markets "
          f"(from {queries_tried} queries, {len(seen)} unique)")
    return markets


# ═════════════════════════════════════════════════════════════════
# 9. RANKING
# ═════════════════════════════════════════════════════════════════

def composite_score(market):
    relevance = market.get("relevance", 0)
    volume = max(market.get("volume_24h", 0), 1)
    return relevance * 1.5 + math.log10(volume) * 10


# ═════════════════════════════════════════════════════════════════
# 10. MAIN
# ═════════════════════════════════════════════════════════════════

def main():
    now = datetime.now(timezone.utc)
    print(f"\nAGSIST fetch_markets.py v4 — {now.strftime('%Y-%m-%d %H:%M UTC')}")
    print("=" * 60)

    kalshi = fetch_kalshi()
    polymarket = fetch_polymarket()

    combined = kalshi + polymarket

    # Deduplicate across platforms
    deduped = []
    seen_titles = set()
    for m in sorted(combined, key=composite_score, reverse=True):
        norm = re.sub(r'[^a-z0-9 ]', '', m["title"].lower()).strip()
        if norm not in seen_titles:
            seen_titles.add(norm)
            deduped.append(m)

    top_markets = deduped[:20]

    # Group by category
    categories = {}
    for m in top_markets:
        cat = m["category"]
        if cat not in categories:
            categories[cat] = []
        categories[cat].append(m)

    # Stats
    tier_counts = {100: 0, 70: 0, 40: 0}
    for m in combined:
        r = m.get("relevance", 0)
        if r >= 100:   tier_counts[100] += 1
        elif r >= 70:  tier_counts[70] += 1
        else:          tier_counts[40] += 1

    output = {
        "fetched":        now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "version":        2,
        "count":          len(top_markets),
        "total_found":    len(combined),
        "tier_breakdown": {
            "direct_ag":    tier_counts[100],
            "trade_energy": tier_counts[70],
            "macro_weather": tier_counts[40],
        },
        "categories":     categories,
        "markets":        top_markets,
    }

    os.makedirs("data", exist_ok=True)
    with open("data/markets.json", "w") as f:
        json.dump(output, f, indent=2)

    print(f"\n{'=' * 60}")
    print(f"✓ data/markets.json written")
    print(f"  Total found:  {len(combined)}")
    print(f"  Top selected: {len(top_markets)}")
    print(f"  Direct ag:    {tier_counts[100]}")
    print(f"  Trade/energy: {tier_counts[70]}")
    print(f"  Macro/weather:{tier_counts[40]}")
    if top_markets:
        print(f"\n  Top 10:")
        for i, m in enumerate(top_markets[:10], 1):
            score = composite_score(m)
            print(f"  {i:2d}. [{m['platform']:10s}] {m['yes']:3d}%  "
                  f"(rel={m['relevance']}, cat={m['category']})  "
                  f"{m['title'][:55]}")
            print(f"      └─ {m['why_it_matters'][:75]}")
    else:
        print("\n  ⚠ No markets found — check API connectivity")
    print(f"{'=' * 60}\nDone.\n")


if __name__ == "__main__":
    main()
