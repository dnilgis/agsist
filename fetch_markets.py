#!/usr/bin/env python3
"""
Fetch commodity prices AND news feeds (RSS)
Writes to data/markets.json for static site consumption
"""

import yfinance as yf
import json
from datetime import datetime, timezone
import os
import re
import urllib.request
import xml.etree.ElementTree as ET

# --- MARKET CONFIGURATION ---
SYMBOLS = {
    "grains": {
        "corn": {"symbol": "ZC=F", "name": "Corn", "unit": "¢/bu"},
        "soybeans": {"symbol": "ZS=F", "name": "Soybeans", "unit": "¢/bu"},
        "wheat": {"symbol": "ZW=F", "name": "Wheat", "unit": "¢/bu"},
    },
    "livestock": {
        "cattle": {"symbol": "LE=F", "name": "Live Cattle", "unit": "¢/lb"},
        "feeder": {"symbol": "GF=F", "name": "Feeder Cattle", "unit": "¢/lb"},
        "milk": {"symbol": "DC=F", "name": "Class III Milk", "unit": "$/cwt"},
    },
    "indices": {
        "sp500": {"symbol": "^GSPC", "name": "S&P 500", "unit": "$"},
        "dow": {"symbol": "^DJI", "name": "Dow Jones", "unit": "$"},
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
    }
}

# --- NEWS SOURCES (RSS) ---
RSS_FEEDS = [
    {"source": "USDA", "url": "https://www.usda.gov/rss/latest-releases.xml"},
    {"source": "AgWeb", "url": "https://www.agweb.com/rss/news"},
    {"source": "FarmProgress", "url": "https://www.farmprogress.com/rss.xml"}
]

def clean_contract_name(short_name, symbol):
    """Extracts month/year from Yahoo contract name"""
    if not short_name: return ""
    if "USD" in symbol or "^" in symbol: return "Spot"
    match = re.search(r'\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s-]?(\d{2,4})', short_name, re.IGNORECASE)
    if match:
        month = match.group(1).title()
        year = match.group(2)
        if len(year) == 4: year = year[2:]
        return f"{month} '{year}"
    return "Spot"

def fetch_quote(symbol):
    """Fetch market data from Yahoo Finance"""
    try:
        ticker = yf.Ticker(symbol)
        fast_info = ticker.fast_info
        price = fast_info.get('lastPrice', fast_info.get('previousClose', 0))
        prev_close = fast_info.get('previousClose', price)
        year_low = fast_info.year_low
        year_high = fast_info.year_high
        
        change = price - prev_close if prev_close else 0
        change_pct = (change / prev_close) * 100 if prev_close else 0
        
        contract_str = ""
        try:
            contract_str = clean_contract_name(ticker.info.get('shortName', ''), symbol)
        except:
            pass
        
        return {
            "price": round(price, 4),
            "change": round(change, 4),
            "changePct": round(change_pct, 2),
            "prevClose": round(prev_close, 4) if prev_close else None,
            "contract": contract_str,
            "low52": round(year_low, 4) if year_low else None,
            "high52": round(year_high, 4) if year_high else None
        }
    except Exception as e:
        print(f"Error fetching {symbol}: {e}")
        return None

def fetch_news():
    """Fetch and parse RSS feeds"""
    news_items = []
    print("Fetching news feeds...")
    
    for feed in RSS_FEEDS:
        try:
            # Use User-Agent to avoid blocking
            req = urllib.request.Request(
                feed['url'], 
                data=None, 
                headers={'User-Agent': 'Mozilla/5.0 (AgSist Dashboard)'}
            )
            with urllib.request.urlopen(req, timeout=10) as response:
                xml_data = response.read()
                root = ET.fromstring(xml_data)
                
                # RSS 2.0 usually has items under channel
                count = 0
                for item in root.findall('.//item'):
                    if count >= 3: break # Limit to top 3 per source to keep it fresh
                    
                    title = item.find('title').text if item.find('title') is not None else "No Title"
                    link = item.find('link').text if item.find('link') is not None else "#"
                    
                    # Clean title
                    title = title.replace('&#039;', "'").replace('&quot;', '"').strip()
                    
                    news_items.append({
                        "source": feed['source'],
                        "title": title,
                        "link": link,
                        "time": datetime.now(timezone.utc).isoformat() # Placeholder for now
                    })
                    count += 1
        except Exception as e:
            print(f"Error fetching RSS {feed['source']}: {e}")
            
    return news_items

def main():
    # 1. Fetch Markets
    markets = {}
    for category, items in SYMBOLS.items():
        markets[category] = {}
        for key, config in items.items():
            print(f"Fetching {config['name']} ({config['symbol']})...")
            quote = fetch_quote(config["symbol"])
            if quote:
                markets[category][key] = {
                    "name": config["name"],
                    "symbol": config["symbol"],
                    "unit": config["unit"],
                    **quote
                }
    
    # 2. Fetch News
    news = fetch_news()
    
    # 3. Compile Data
    data = {
        "updated": datetime.now(timezone.utc).isoformat(),
        "source": "Yahoo Finance & USDA",
        "markets": markets,
        "news": news
    }
    
    # 4. Save
    os.makedirs("data", exist_ok=True)
    with open("data/markets.json", "w") as f:
        json.dump(data, f, indent=2)
    
    print(f"\nSuccess! Markets: {sum(len(v) for v in markets.values())} symbols. News: {len(news)} headlines.")

if __name__ == "__main__":
    main()
