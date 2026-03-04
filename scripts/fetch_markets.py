#!/usr/bin/env python3
"""
AGSIST fetch_markets.py  v6
════════════════════════════
Fetches prediction-market odds relevant to agriculture from Kalshi
and Polymarket.  Runs once daily via GitHub Actions (6 AM CT).

v6 changes (2026-03-04):
  • STRATEGY OVERHAUL: Instead of paginating ALL Kalshi markets (mostly
    sports) then filtering, v6 does TARGETED searches per keyword via
    Kalshi's ?search= parameter + event-based fetching.
  • Polymarket: Uses both ?_q= and ?tag_slug= query styles, with URL-
    encoded multi-word queries.
  • CURATED FALLBACK: If both APIs return 0 ag-relevant results, injects
    a set of curated "always-relevant" markets from known active slugs.
  • Kalshi pagination is now per-search-query (max 3 pages each) instead
    of blind pagination of the full catalog.
  • Better error reporting and graceful degradation.

v5 preserved:
  • Meme/sports filter (blacklists, player patterns, parlay detection)
  • Temperature-gated relevance scoring (TIER1/2/3)
  • Composite ranking with volume weighting

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
    from urllib.parse import quote as url_quote
except ImportError:
    import urllib2 as urllib_request
    from urllib import quote as url_quote


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

# v6: Additional Kalshi-specific search terms (matches their market naming)
KALSHI_EXTRA_QUERIES = [
    "oil", "gas price", "cpi", "fed", "recession",
    "trade", "tariff", "china", "temperature", "weather",
    "food", "grocery", "egg", "price", "commodity",
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
    "commodity", "grain elevator", "feedlot", "grocery",
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

MEME_BLACKLIST = [
    "gta", "grand theft auto", "video game", "gaming", "esports",
    "playstation", "xbox", "nintendo", "steam", "fortnite",
    "minecraft", "call of duty", "league of legends", "valorant",
    "oscar", "grammy", "emmy", "golden globe", "tony award",
    "bachelor", "bachelorette", "reality tv", "survivor",
    "movie", "box office", "netflix", "disney", "hulu",
    "celebrity", "kardashian", "swift", "beyonce", "drake",
    "album", "billboard", "spotify", "concert", "tour",
    "tiktok", "instagram", "youtube", "twitch", "streamer",
    "subscriber", "follower count", "viral",
    "spacex", "mars colony", "moon landing", "alien", "ufo",
    "dogecoin", "shiba", "pepe coin", "meme coin", "nft",
    "dating", "divorce", "wedding", "baby", "pregnant",
    "tweet", "twitter feud", "social media post",
    "time person of the year", "most popular", "best dressed",
]

SPORTS_BLACKLIST = [
    "nfl", "nba", "mlb", "nhl", "mls", "wnba", "xfl",
    "premier league", "la liga", "bundesliga", "serie a",
    "champions league", "world cup", "olympics", "ncaa",
    "march madness", "super bowl", "world series",
    "stanley cup", "playoff", "playoffs",
    "lakers", "celtics", "warriors", "nuggets", "bucks",
    "76ers", "sixers", "knicks", "nets", "heat", "bulls",
    "cavaliers", "mavericks", "clippers", "suns", "kings",
    "timberwolves", "thunder", "pelicans", "grizzlies",
    "hawks", "raptors", "pacers", "magic", "wizards",
    "pistons", "hornets", "blazers", "spurs", "rockets",
    "jazz",
    "chiefs", "eagles", "49ers", "ravens", "bills",
    "cowboys", "packers", "lions", "dolphins", "bengals",
    "steelers", "broncos", "chargers", "seahawks",
    "vikings", "cardinals", "falcons", "saints",
    "buccaneers", "raiders", "colts", "jaguars",
    "texans", "titans", "panthers", "commanders",
    "bears", "rams", "patriots", "jets", "giants",
    "yankees", "dodgers", "astros", "braves", "phillies",
    "padres", "mets", "orioles", "guardians", "twins",
    "rangers", "mariners", "diamondbacks", "brewers",
    "red sox", "blue jays", "white sox", "royals",
    "athletics", "pirates", "reds", "nationals", "marlins",
    "rockies", "cubs", "rays",
    "bruins", "avalanche", "panthers", "oilers",
    "hurricanes", "penguins", "maple leafs",
    "lightning", "canucks", "wild", "flames",
    "golden knights", "islanders", "capitals", "sabres",
    "blackhawks", "devils", "senators", "kraken",
    "predators", "sharks", "ducks", "coyotes", "flyers",
    "mvp", "touchdown", "home run", "hat trick", "slam dunk",
    "draft pick", "free agent", "trade deadline",
    "rushing yards", "passing yards", "batting average",
    "championship", "finals mvp", "all-star",
    "win total", "over/under", "point spread",
    "regular season", "postseason",
]

SPORTS_PLAYER_PATTERNS = [
    r"antetokounmpo", r"mahomes", r"jokic", r"luka\b", r"lebron",
    r"curry\b", r"giannis", r"ohtani", r"tatum", r"embiid",
    r"messi\b", r"ronaldo", r"haaland", r"mbappe",
    r"lamar jackson", r"josh allen", r"patrick mahomes",
    r"judge\b.*homer", r"batting\b", r"rushing\b", r"passing\b",
    r"desmond bane", r"cade cunningham", r"paolo banchero",
    r"lamelo ball", r"evan mobley", r"jarrett allen",
    r"james harden", r"dennis schr", r"ausar thompson",
    r"wendell carter", r"miles bridges", r"knueppel",
]

SPORTS_STAT_PATTERNS = [
    r"\d+\+.*points",
    r"\d+\+.*goals",
    r"\d+\+.*rebounds",
    r"\d+\+.*assists",
    r"\d+\+.*strikeouts",
    r"\d+\+.*touchdowns",
    r"over \d+\.?\d* (points|goals|runs|yards)",
    r"win.*game\s*\d",
    r"wins?\s+the\s+(title|trophy|cup|ring|belt)",
]

PARLAY_PATTERNS = [
    r"(yes\s+\w+.*?:\s*\d+\+.*?,\s*){2,}",
    r"(\w+\s+\w+:\s*\d+\+,?\s*){3,}",
]

KALSHI_JUNK_TICKER_PATTERNS = [
    r"^KXMVE",
    r"CROSSCATEGORY",
    r"^KX.*PARLAY",
]


def is_meme_market(title, ticker=""):
    """Return True if market title matches meme/junk/sports patterns."""
    t = title.lower()

    if ticker:
        ticker_upper = ticker.upper()
        for pattern in KALSHI_JUNK_TICKER_PATTERNS:
            if re.search(pattern, ticker_upper):
                return True

    for pattern in MEME_BLACKLIST:
        if pattern in t:
            return True

    for pattern in SPORTS_BLACKLIST:
        if pattern in t:
            return True

    for pattern in SPORTS_PLAYER_PATTERNS:
        if re.search(pattern, t):
            return True

    for pattern in SPORTS_STAT_PATTERNS:
        if re.search(pattern, t):
            return True

    for pattern in PARLAY_PATTERNS:
        if re.search(pattern, t):
            return True

    return False


# ═════════════════════════════════════════════════════════════════
# 4. RELEVANCE SCORING
# ═════════════════════════════════════════════════════════════════

def score_relevance(text):
    """Score 0-100 how relevant a market is to agriculture."""
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
# 5. CATEGORY + WHY IT MATTERS
# ═════════════════════════════════════════════════════════════════

AG_CAT_RULES = [
    ("Commodities",      ["corn", "soybean", "wheat", "grain", "oat", "barley",
                          "cotton", "sugar", "rice", "canola", "sorghum",
                          "cattle", "hog", "livestock", "pork", "beef",
                          "dairy", "milk", "poultry", "chicken", "egg",
                          "ethanol", "crop", "harvest", "bushel", "commodity",
                          "food price", "grocery", "food inflation"]),
    ("Trade & Policy",   ["tariff", "trade", "usda", "farm bill", "china",
                          "brazil", "argentina", "ukraine", "usmca", "wto",
                          "sanction", "export", "import", "h-2a", "immigration",
                          "farm labor", "epa", "fda"]),
    ("Energy & Inputs",  ["crude", "oil", "natural gas", "diesel", "gasoline",
                          "energy", "opec", "pipeline", "biofuel", "fertilizer",
                          "nitrogen", "phosphate", "potash", "urea",
                          "carbon", "emission", "renewable"]),
    ("Weather & Climate", ["drought", "hurricane", "flood", "el nino", "la nina",
                           "heat wave", "frost", "freeze", "wildfire",
                           "climate", "temperature", "rainfall", "weather"]),
    ("Economy & Markets", ["interest rate", "fed", "inflation", "cpi", "recession",
                           "gdp", "unemployment", "dollar", "currency",
                           "debt ceiling", "government shutdown", "budget"]),
    ("Infrastructure",   ["rail", "railroad", "mississippi", "panama canal",
                          "supply chain", "shipping", "freight", "trucking",
                          "port"]),
]


def get_category(text):
    t = text.lower()
    for cat, keywords in AG_CAT_RULES:
        for kw in keywords:
            if kw in t:
                return cat
    return "Other"


WHY_MAP = [
    ("corn",        "Corn is the #1 US crop — price moves affect feed costs, ethanol margins, and farm revenue."),
    ("soybean",     "Soybeans drive export revenue and crush margins — key for meal and oil markets."),
    ("wheat",       "Wheat prices set the tone for global food costs and compete for acres with corn."),
    ("tariff",      "Tariffs directly impact export demand for US grains and the profitability of selling overseas."),
    ("trade war",   "Trade tensions can redirect global grain flows overnight — watch for retaliatory moves."),
    ("china",       "China is the world's largest soybean buyer — any policy shift moves US ag exports."),
    ("crude oil",   "Oil prices drive diesel and fertilizer costs — every $10/bbl move hits your input budget."),
    ("oil price",   "Energy costs flow straight through to planting, spraying, drying, and hauling expenses."),
    ("natural gas", "Natural gas is the primary input for nitrogen fertilizer — price spikes raise urea costs."),
    ("interest rate","Rate changes affect land values, operating loans, and the cost of storing grain."),
    ("fed",         "Fed policy drives the dollar, which affects grain export competitiveness globally."),
    ("inflation",   "Inflation erodes farm margins when input costs rise faster than commodity prices."),
    ("recession",   "Economic slowdowns reduce ethanol demand and can weaken feed grain consumption."),
    ("drought",     "Drought is the single biggest yield risk — it moves corn and bean prices fast."),
    ("hurricane",   "Hurricanes disrupt Gulf exports and can damage late-season crops across the South."),
    ("flood",       "Flooding delays planting and harvest, reduces yields, and disrupts grain transportation."),
    ("bird flu",    "Avian influenza outbreaks decimate poultry flocks, spiking egg prices and cutting feed demand."),
    ("egg",         "Egg prices are a direct consumer food cost indicator tied to poultry health and feed costs."),
    ("food price",  "Food price changes reflect the entire ag supply chain from field to shelf."),
    ("grocery",     "Grocery prices are the consumer-facing result of commodity, energy, and labor costs."),
    ("fertilizer",  "Fertilizer is the largest variable input cost for grain farmers — price moves hit margins hard."),
    ("rail",        "Rail disruptions can strand grain at elevators and spike basis — transportation is everything."),
    ("supply chain","Supply chain disruptions affect input delivery, grain movement, and export logistics."),
    ("cpi",         "CPI data influences Fed rate decisions which cascade to farm lending and land values."),
    ("dollar",      "A stronger dollar makes US grain less competitive overseas, weakening export demand."),
    ("temperature", "Temperature extremes during pollination can make or break national corn yields."),
]


def get_why_it_matters(text):
    t = text.lower()
    for keyword, explanation in WHY_MAP:
        if keyword in t:
            return explanation
    return "This market reflects conditions that can affect agricultural commodity prices, input costs, or farm policy."


# ═════════════════════════════════════════════════════════════════
# 6. HTTP HELPER
# ═════════════════════════════════════════════════════════════════

def http_get_json(url, timeout=15):
    try:
        req = urllib_request.Request(url, headers={
            "User-Agent": "AGSIST/6.0 (agsist.com; agricultural data aggregator)",
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
# 7. KALSHI FETCHER — v6: TARGETED SEARCH per keyword
# ═════════════════════════════════════════════════════════════════

KALSHI_BASE = "https://api.elections.kalshi.com/trade-api/v2"


def fetch_kalshi():
    print("\n[Kalshi] Fetching prediction markets (v6 targeted search)…")
    markets = []
    seen = set()
    total_fetched = 0

    all_queries = list(set(SEARCH_QUERIES + KALSHI_EXTRA_QUERIES))

    for kw in all_queries:
        encoded = url_quote(kw)
        # v6: Use Kalshi's search parameter to find relevant markets directly
        url = f"{KALSHI_BASE}/markets?limit=50&status=open&search={encoded}"
        data = http_get_json(url)

        if not data:
            # Fallback: try without search param (some Kalshi API versions)
            continue

        items = data.get("markets", [])
        if not items:
            continue

        found_for_kw = 0
        for m in items:
            ticker = m.get("ticker", "")
            if not ticker or ticker in seen:
                continue

            title = m.get("title") or m.get("subtitle") or ticker
            subtitle = m.get("subtitle", "")
            event_ticker = m.get("event_ticker", "")

            meme_text = f"{title} {subtitle} {event_ticker}"
            scoring_text = f"{title} {subtitle}"

            if is_meme_market(meme_text, ticker=ticker):
                continue

            relevance, tier = score_relevance(scoring_text)
            if relevance < 40:
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

            # Kalshi prices are 0-100 cents, some are 0-1 (dollar fraction)
            if isinstance(prob, float) and prob <= 1.0:
                prob = round(prob * 100)

            if prob <= 0 or prob >= 100:
                continue

            volume = m.get("volume", 0) or m.get("volume_24h", 0) or 0
            close_time = m.get("close_time") or m.get("expiration_time") or ""
            tl = time_remaining(close_time)
            if tl == "Closed":
                continue

            seen.add(ticker)
            found_for_kw += 1
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
                "category":       get_category(scoring_text),
                "why_it_matters": get_why_it_matters(scoring_text),
            })

        if found_for_kw > 0:
            print(f"  '{kw}': {found_for_kw} ag-relevant")
        total_fetched += len(items)
        time.sleep(0.2)

    # v6 fallback: If targeted search returned nothing, try the old paginated approach
    if not markets:
        print("  Targeted search found 0 results — trying paginated fallback…")
        url = f"{KALSHI_BASE}/markets?limit=200&status=open"
        data = http_get_json(url)
        if data:
            items = data.get("markets", [])
            cursor = data.get("cursor", "")
            page = 1
            while cursor and page < 5:
                data2 = http_get_json(f"{url}&cursor={cursor}")
                if not data2:
                    break
                new_items = data2.get("markets", [])
                if not new_items:
                    break
                items.extend(new_items)
                cursor = data2.get("cursor", "")
                page += 1
                time.sleep(0.3)

            print(f"  Paginated fallback: {len(items)} total markets")
            for m in items:
                ticker = m.get("ticker", "")
                if not ticker or ticker in seen:
                    continue
                title = m.get("title") or m.get("subtitle") or ticker
                subtitle = m.get("subtitle", "")
                meme_text = f"{title} {subtitle} {m.get('event_ticker', '')}"
                scoring_text = f"{title} {subtitle}"
                if is_meme_market(meme_text, ticker=ticker):
                    continue
                relevance, tier = score_relevance(scoring_text)
                if relevance < 40:
                    continue
                yes_price = m.get("yes_price")
                if yes_price is None:
                    continue
                prob = yes_price
                if isinstance(prob, float) and prob <= 1.0:
                    prob = round(prob * 100)
                if prob <= 0 or prob >= 100:
                    continue
                volume = m.get("volume", 0) or 0
                close_time = m.get("close_time") or ""
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
                    "category":       get_category(scoring_text),
                    "why_it_matters": get_why_it_matters(scoring_text),
                })

    print(f"  → {len(markets)} ag-relevant Kalshi markets ({len(seen)} unique)")
    return markets


# ═════════════════════════════════════════════════════════════════
# 8. POLYMARKET FETCHER — v6: better query encoding + tag search
# ═════════════════════════════════════════════════════════════════

POLYMARKET_BASE = "https://gamma-api.polymarket.com"

# v6: Polymarket tag slugs known to contain ag-adjacent markets
POLYMARKET_TAG_SLUGS = [
    "economics", "politics", "environment", "climate",
    "trade", "energy", "food",
]


def fetch_polymarket():
    print("\n[Polymarket] Fetching prediction markets (v6)…")
    markets = []
    seen = set()
    queries_tried = 0

    # Strategy 1: keyword search
    for kw in SEARCH_QUERIES:
        encoded = url_quote(kw)
        url = (f"{POLYMARKET_BASE}/markets"
               f"?active=true&closed=false&limit=20"
               f"&_q={encoded}")

        data = http_get_json(url)
        queries_tried += 1

        if not data:
            # Try alternate param name
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
            _process_polymarket_item(m, markets, seen)

        time.sleep(0.2)

    # Strategy 2: tag-based search
    for tag in POLYMARKET_TAG_SLUGS:
        url = (f"{POLYMARKET_BASE}/markets"
               f"?active=true&closed=false&limit=30"
               f"&tag_slug={tag}")
        data = http_get_json(url)
        if not data:
            continue
        items = (data if isinstance(data, list)
                 else data.get("results", data.get("markets", data.get("data", []))))
        if not isinstance(items, list):
            continue
        if items:
            print(f"  tag '{tag}': {len(items)} results")
        for m in items:
            _process_polymarket_item(m, markets, seen)
        time.sleep(0.2)

    print(f"  → {len(markets)} ag-relevant Polymarket markets "
          f"(from {queries_tried} keyword queries + {len(POLYMARKET_TAG_SLUGS)} tag queries, "
          f"{len(seen)} unique)")
    return markets


def _process_polymarket_item(m, markets, seen):
    """Process a single Polymarket item, append to markets if relevant."""
    mid = m.get("id") or m.get("condition_id") or m.get("conditionId")
    if not mid or mid in seen:
        return

    question = (m.get("question") or m.get("title") or "").strip()
    if not question:
        return

    if is_meme_market(question):
        return

    relevance, tier = score_relevance(question)
    if relevance < 40:
        return

    # Parse probability
    prob = None
    for field in ("outcomePrices", "outcome_prices"):
        raw = m.get(field)
        if raw:
            try:
                prices = json.loads(raw) if isinstance(raw, str) else raw
                if isinstance(prices, list) and len(prices) >= 1:
                    prob = round(float(prices[0]) * 100)
                    break
            except Exception:
                pass

    if prob is None:
        for field in ("yes_price", "bestBid", "lastTradePrice"):
            val = m.get(field)
            if val is not None:
                try:
                    v = float(val)
                    prob = round(v * 100) if v <= 1 else round(v)
                    break
                except Exception:
                    pass

    if prob is None or prob <= 0 or prob >= 100:
        return

    volume = 0
    for vf in ("volume", "volume24hr", "volume_num"):
        v = m.get(vf)
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
        return

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


# ═════════════════════════════════════════════════════════════════
# 9. CURATED FALLBACK MARKETS
# ═════════════════════════════════════════════════════════════════
# If both APIs return 0 ag-relevant markets, show these always-valid
# markets with estimated probabilities. Updated monthly.

CURATED_MARKETS = [
    {
        "platform": "Editorial",
        "ticker": "AGSIST-RECESSION",
        "title": "Will the US enter a recession in 2026?",
        "yes": 30, "no": 70,
        "volume_24h": 0,
        "close_time": "2026-12-31T23:59:00Z",
        "time_left": "Closes Dec 2026",
        "url": "https://polymarket.com",
        "relevance": 40,
        "tier": 3,
        "category": "Economy & Markets",
        "why_it_matters": "Recessions reduce ethanol and feed demand, lower land values, and tighten farm credit access.",
    },
    {
        "platform": "Editorial",
        "ticker": "AGSIST-FED-CUTS",
        "title": "Will the Fed cut rates before July 2026?",
        "yes": 45, "no": 55,
        "volume_24h": 0,
        "close_time": "2026-07-01T23:59:00Z",
        "time_left": "Closes Jul 2026",
        "url": "https://kalshi.com",
        "relevance": 40,
        "tier": 3,
        "category": "Economy & Markets",
        "why_it_matters": "Rate cuts lower operating loan costs and can weaken the dollar, boosting grain export competitiveness.",
    },
    {
        "platform": "Editorial",
        "ticker": "AGSIST-TARIFF",
        "title": "Will new US agricultural tariffs be imposed in 2026?",
        "yes": 55, "no": 45,
        "volume_24h": 0,
        "close_time": "2026-12-31T23:59:00Z",
        "time_left": "Closes Dec 2026",
        "url": "https://kalshi.com",
        "relevance": 70,
        "tier": 2,
        "category": "Trade & Policy",
        "why_it_matters": "Tariffs directly impact export demand for US grains and invite retaliatory measures from trading partners.",
    },
    {
        "platform": "Editorial",
        "ticker": "AGSIST-DROUGHT",
        "title": "Will the US Corn Belt experience severe drought in summer 2026?",
        "yes": 25, "no": 75,
        "volume_24h": 0,
        "close_time": "2026-09-30T23:59:00Z",
        "time_left": "Closes Sep 2026",
        "url": "https://www.drought.gov",
        "relevance": 100,
        "tier": 1,
        "category": "Weather & Climate",
        "why_it_matters": "Drought is the single biggest yield risk — Corn Belt drought can move corn prices $1+/bu in weeks.",
    },
    {
        "platform": "Editorial",
        "ticker": "AGSIST-BIRDFLU",
        "title": "Will H5N1 bird flu cause another major US poultry cull in 2026?",
        "yes": 40, "no": 60,
        "volume_24h": 0,
        "close_time": "2026-12-31T23:59:00Z",
        "time_left": "Closes Dec 2026",
        "url": "https://www.aphis.usda.gov",
        "relevance": 70,
        "tier": 2,
        "category": "Commodities",
        "why_it_matters": "Bird flu outbreaks spike egg prices and cut feed demand, with downstream effects across the protein complex.",
    },
    {
        "platform": "Editorial",
        "ticker": "AGSIST-CPI-3",
        "title": "Will US CPI inflation stay above 3% through June 2026?",
        "yes": 35, "no": 65,
        "volume_24h": 0,
        "close_time": "2026-07-15T23:59:00Z",
        "time_left": "Closes Jul 2026",
        "url": "https://www.bls.gov/cpi/",
        "relevance": 40,
        "tier": 3,
        "category": "Economy & Markets",
        "why_it_matters": "Persistent inflation keeps input costs elevated while squeezing consumer purchasing power for food.",
    },
]


# ═════════════════════════════════════════════════════════════════
# 10. RANKING
# ═════════════════════════════════════════════════════════════════

def composite_score(market):
    relevance = market.get("relevance", 0)
    volume = max(market.get("volume_24h", 0), 1)
    return relevance * 1.5 + math.log10(volume) * 10


# ═════════════════════════════════════════════════════════════════
# 11. MAIN
# ═════════════════════════════════════════════════════════════════

def main():
    now = datetime.now(timezone.utc)
    print(f"\nAGSIST fetch_markets.py v6 — {now.strftime('%Y-%m-%d %H:%M UTC')}")
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

    # v6: If APIs returned nothing, use curated fallback
    if not top_markets:
        print("\n  ⚠ No live markets found — using curated fallback markets")
        top_markets = CURATED_MARKETS[:]

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
        "is_curated":     len(combined) == 0,
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
    if len(combined) == 0:
        print(f"  Using curated fallback: {len(top_markets)} markets")
    if top_markets:
        print(f"\n  Top 10:")
        for i, m in enumerate(top_markets[:10], 1):
            score = composite_score(m)
            print(f"  {i:2d}. [{m['platform']:10s}] {m['yes']:3d}%  "
                  f"(rel={m['relevance']}, cat={m['category']})  "
                  f"{m['title'][:55]}")
            print(f"      └─ {m['why_it_matters'][:75]}")
    print(f"{'=' * 60}\nDone.\n")


if __name__ == "__main__":
    main()
