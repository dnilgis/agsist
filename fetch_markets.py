#!/usr/bin/env python3
"""
Fetch commodity, crypto, and index prices from Yahoo Finance.
Writes to data/markets.json for AGSIST dashboard consumption.
Runs via GitHub Actions on schedule.
"""

import yfinance as yf
import json
import time
from datetime import datetime, timezone
import os

# ═══════════════════════════════════════════════════════════════════════════
# SYMBOLS CONFIG — grouped by category for the dashboard
# ═══════════════════════════════════════════════════════════════════════════

SYMBOLS = {
    "grains": {
        "corn": {"symbol": "ZC=F", "name": "Corn", "unit": "¢/bu"},
        "corn_dec": {"symbol": "ZCZ26.CBT", "name": "Corn Dec '26", "unit": "¢/bu"},
        "soybeans": {"symbol": "ZS=F", "name": "Soybeans", "unit": "¢/bu"},
        "soybeans_nov": {"symbol": "ZSX26.CBT", "name": "Soybeans Nov '26", "unit": "¢/bu"},
        "wheat": {"symbol": "ZW=F", "name": "Wheat", "unit": "¢/bu"},
        "oats": {"symbol": "ZO=F", "name": "Oats", "unit": "¢/bu"},
    },
    "livestock": {
        "cattle": {"symbol": "LE=F", "name": "Live Cattle", "unit": "¢/lb"},
        "feeder": {"symbol": "GF=F", "name": "Feeder Cattle", "unit": "¢/lb"},
        "hogs": {"symbol": "HE=F", "name": "Lean Hogs", "unit": "¢/lb"},
        "milk": {"symbol": "DC=F", "name": "Class III Milk", "unit": "$/cwt"},
    },
    "indices": {
        "sp500": {"symbol": "^GSPC", "name": "S&P 500", "unit": "$"},
        "dow": {"symbol": "^DJI", "name": "Dow Jones", "unit": "$"},
        "dollar": {"symbol": "DX-Y.NYB", "name": "US Dollar Index", "unit": "$"},
    },
    "energy": {
        "oil": {"symbol": "CL=F", "name": "Crude Oil", "unit": "$/bbl"},
        "natgas": {"symbol": "NG=F", "name": "Natural Gas", "unit": "$/MMBtu"},
    },
    "metals": {
        "gold": {"symbol": "GC=F", "name": "Gold", "unit": "$/oz"},
        "silver": {"symbol": "SI=F", "name": "Silver", "unit": "$/oz"},
    },
    "crypto": {
        "bitcoin": {"symbol": "BTC-USD", "name": "Bitcoin", "unit": "$"},
        "ethereum": {"symbol": "ETH-USD", "name": "Ethereum", "unit": "$"},
        "kaspa": {"symbol": "KAS-USD", "name": "Kaspa", "unit": "$"},
        "xrp": {"symbol": "XRP-USD", "name": "XRP", "unit": "$"},
    },
}

# ═══════════════════════════════════════════════════════════════════════════
# FALLBACK SYMBOLS — try these if the primary symbol fails (low-liquidity)
# ═══════════════════════════════════════════════════════════════════════════

FALLBACK_SYMBOLS = {
    "ZO=F": ["ZOH26.CBT", "ZOK26.CBT", "ZON26.CBT", "ZOU26.CBT"],
}

MAX_RETRIES = 3
RETRY_DELAY = 2  # seconds

# ═══════════════════════════════════════════════════════════════════════════
# NEWS FEEDS — scraped from ag RSS for the ticker
# ═══════════════════════════════════════════════════════════════════════════

NEWS_FEEDS = [
    {"url": "https://www.farmprogress.com/feed/", "source": "FarmProgress"},
    {"url": "https://brownfieldagnews.com/feed/", "source": "Brownfield"},
    {"url": "https://agdaily.com/feed/", "source": "AGDAILY"},
    {"url": "https://www.agweek.com/index.rss", "source": "Agweek"},
]


def fetch_quote(symbol, name):
    """Fetch current quote data for a Yahoo Finance symbol.
    Three methods: 1) yfinance fast_info, 2) yfinance history, 3) raw Yahoo HTTP API.
    Tries each method for each symbol (primary + fallbacks) with retries."""
    from urllib.request import urlopen, Request

    def _try_fast_info(sym):
        """Attempt fetch via yfinance fast_info (primary method)."""
        ticker = yf.Ticker(sym)
        info = ticker.fast_info

        price = info.get("lastPrice", info.get("previousClose", 0))
        if not price or price == 0:
            raise ValueError(f"fast_info returned no price for {sym}")

        prev_close = info.get("previousClose", price)
        if prev_close and prev_close != 0:
            change = price - prev_close
            change_pct = (change / prev_close) * 100
        else:
            change = 0
            change_pct = 0

        low52 = info.get("yearLow", None)
        high52 = info.get("yearHigh", None)

        return {"price": price, "prevClose": prev_close, "change": change,
                "changePct": change_pct, "low52": low52, "high52": high52}

    def _try_history(sym):
        """Fallback: fetch via yfinance history() for low-liquidity contracts."""
        ticker = yf.Ticker(sym)
        hist = ticker.history(period="5d")

        if hist.empty:
            raise ValueError(f"history() returned empty for {sym}")

        last_row = hist.iloc[-1]
        price = float(last_row["Close"])
        if not price or price == 0:
            raise ValueError(f"history() close=0 for {sym}")

        if len(hist) >= 2:
            prev_close = float(hist.iloc[-2]["Close"])
        else:
            prev_close = float(last_row.get("Open", price))

        if prev_close and prev_close != 0:
            change = price - prev_close
            change_pct = (change / prev_close) * 100
        else:
            change = 0
            change_pct = 0

        low52 = float(hist["Low"].min()) if "Low" in hist else None
        high52 = float(hist["High"].max()) if "High" in hist else None

        return {"price": price, "prevClose": prev_close, "change": change,
                "changePct": change_pct, "low52": low52, "high52": high52}

    def _try_raw_http(sym):
        """Last resort: bypass yfinance entirely and hit Yahoo Finance v8 chart API."""
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?interval=1d&range=5d"
        req = Request(url, headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        })
        with urlopen(req, timeout=15) as resp:
            raw = json.loads(resp.read())

        chart = raw.get("chart", {}).get("result", [])
        if not chart:
            raise ValueError(f"v8 chart API returned no data for {sym}")

        meta = chart[0].get("meta", {})
        price = meta.get("regularMarketPrice", 0)
        prev_close = meta.get("chartPreviousClose", meta.get("previousClose", price))

        if not price or price == 0:
            # Try from indicators
            closes = chart[0].get("indicators", {}).get("quote", [{}])[0].get("close", [])
            valid = [c for c in closes if c is not None and c > 0]
            if valid:
                price = valid[-1]
                prev_close = valid[-2] if len(valid) >= 2 else price
            else:
                raise ValueError(f"v8 chart API: no valid prices for {sym}")

        if prev_close and prev_close != 0:
            change = price - prev_close
            change_pct = (change / prev_close) * 100
        else:
            change = 0
            change_pct = 0

        low52 = meta.get("fiftyTwoWeekLow", None)
        high52 = meta.get("fiftyTwoWeekHigh", None)

        return {"price": price, "prevClose": prev_close, "change": change,
                "changePct": change_pct, "low52": low52, "high52": high52}

    def _get_contract(sym, name_str):
        """Determine contract label."""
        if sym.endswith("-USD") or sym.startswith("^") or sym.startswith("DX"):
            return "Spot"
        try:
            ticker = yf.Ticker(sym)
            full_info = ticker.info
            contract = full_info.get("contractSymbol", full_info.get("shortName", "Spot"))
            for month in ["Mar", "Apr", "May", "Jul", "Sep", "Nov", "Dec"]:
                if month in str(contract) or month in name_str:
                    return f"{month} '26"
        except Exception:
            pass
        return "Front Month"

    # Build list of symbols to try: primary + any fallbacks
    symbols_to_try = [symbol] + FALLBACK_SYMBOLS.get(symbol, [])

    methods = [
        ("fast_info", _try_fast_info),
        ("history", _try_history),
        ("raw_http", _try_raw_http),
    ]

    for sym in symbols_to_try:
        for attempt in range(1, MAX_RETRIES + 1):
            for method_name, method_fn in methods:
                try:
                    data = method_fn(sym)

                    contract = _get_contract(sym, name)

                    result = {
                        "price": round(data["price"], 4),
                        "change": round(data["change"], 4),
                        "changePct": round(data["changePct"], 2),
                        "prevClose": round(data["prevClose"], 4) if data["prevClose"] else None,
                        "contract": contract,
                    }

                    if data.get("low52") is not None:
                        result["low52"] = round(data["low52"], 4)
                    if data.get("high52") is not None:
                        result["high52"] = round(data["high52"], 4)

                    if sym != symbol or method_name != "fast_info":
                        print(f"    ↪ Got data via {method_name}" + (f" (fallback {sym})" if sym != symbol else ""))

                    return result

                except Exception as e:
                    if method_name == methods[-1][0]:
                        print(f"    ⚠ Attempt {attempt}/{MAX_RETRIES} all methods failed for {sym}: {e}")

            if attempt < MAX_RETRIES:
                time.sleep(RETRY_DELAY * attempt)

    print(f"  ✗ All attempts exhausted for {name} ({symbol})")
    return None


def fetch_news():
    """Fetch latest ag news headlines from RSS feeds."""
    import xml.etree.ElementTree as ET
    from urllib.request import urlopen, Request
    from urllib.error import URLError

    articles = []

    for feed in NEWS_FEEDS:
        try:
            req = Request(feed["url"], headers={"User-Agent": "AGSIST/1.0"})
            with urlopen(req, timeout=10) as resp:
                xml = resp.read()
            root = ET.fromstring(xml)

            ns = {"atom": "http://www.w3.org/2005/Atom"}
            items = root.findall(".//item") or root.findall(".//atom:entry", ns)

            for item in items[:3]:
                title_el = item.find("title")
                link_el = item.find("link")
                pubdate_el = item.find("pubDate") or item.find("atom:published", ns) or item.find("atom:updated", ns)

                title = title_el.text.strip() if title_el is not None and title_el.text else ""
                link = link_el.text.strip() if link_el is not None and link_el.text else ""

                # Atom links use href attribute
                if not link and link_el is not None:
                    link = link_el.get("href", "")

                pub_time = pubdate_el.text.strip() if pubdate_el is not None and pubdate_el.text else ""

                if title and len(title) > 10:
                    articles.append({
                        "source": feed["source"],
                        "title": title[:200],
                        "link": link,
                        "time": pub_time,
                        "category": "news",
                    })

            print(f"  ✓ {feed['source']} ({min(3, len(items))} items)")
        except Exception as e:
            print(f"  ✗ {feed['source']}: {e}")

    # Sort by time (newest first) and dedupe
    seen = set()
    unique = []
    for a in articles:
        if a["link"] not in seen:
            seen.add(a["link"])
            unique.append(a)

    return unique[:12]


def fetch_usda():
    """Placeholder for USDA report data."""
    return []


def main():
    print("═══════════════════════════════════════════════════════")
    print("AGSIST Market Data Fetcher")
    print("═══════════════════════════════════════════════════════\n")

    data = {
        "updated": datetime.now(timezone.utc).isoformat(),
        "markets": {},
        "news": [],
        "usda": [],
    }

    # Fetch all market quotes
    for category, items in SYMBOLS.items():
        data["markets"][category] = {}
        for key, config in items.items():
            print(f"  Fetching {config['name']} ({config['symbol']})...")
            quote = fetch_quote(config["symbol"], config["name"])
            if quote:
                data["markets"][category][key] = {
                    "name": config["name"],
                    "symbol": config["symbol"],
                    "unit": config["unit"],
                    **quote,
                }
                pct = quote["changePct"]
                arrow = "▲" if pct >= 0 else "▼"
                print(f"    ${quote['price']} {arrow} {abs(pct):.2f}%")

    # Fetch news
    print("\nFetching news...")
    data["news"] = fetch_news()

    # Fetch USDA
    data["usda"] = fetch_usda()

    # Write output
    out_dir = os.path.join(os.getcwd(), "data")
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, "markets.json")

    # Stale-data preservation: carry forward missing symbols from previous run
    try:
        if os.path.exists(out_path):
            with open(out_path) as f:
                prev_data = json.load(f)
            prev_markets = prev_data.get("markets", {})
            for category, items in prev_markets.items():
                if category not in data["markets"]:
                    data["markets"][category] = {}
                for key, val in items.items():
                    if key not in data["markets"].get(category, {}):
                        val["_stale"] = True
                        data["markets"].setdefault(category, {})[key] = val
                        print(f"  ♻ Carried forward stale data for {val.get('name', key)}")
    except Exception as e:
        print(f"  ⚠ Could not load previous data: {e}")

    with open(out_path, "w") as f:
        json.dump(data, f, indent=2)

    total = sum(len(v) for v in data["markets"].values())
    print(f"\n═══════════════════════════════════════════════════════")
    print(f"✅ {total} quotes + {len(data['news'])} news → {out_path}")
    print(f"═══════════════════════════════════════════════════════")


if __name__ == "__main__":
    main()
