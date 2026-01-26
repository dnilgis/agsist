#!/usr/bin/env python3
"""
Fetch commodity prices AND news feeds (RSS)
Writes to data/markets.json for static site consumption
"""

import yfinance as yf
import json
import html
import os
import re
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

SYMBOLS = {
    "grains": {
        "corn": {"symbol": "ZC=F", "name": "Corn", "unit": "¢/bu"},
        "corn_dec": {"symbol": "ZCZ26.CBT", "name": "Corn Dec '26", "unit": "¢/bu"},
        "soybeans": {"symbol": "ZS=F", "name": "Soybeans", "unit": "¢/bu"},
        "soybeans_nov": {"symbol": "ZSX26.CBT", "name": "Soybeans Nov '26", "unit": "¢/bu"},
        "wheat": {"symbol": "ZW=F", "name": "Wheat", "unit": "¢/bu"},
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
    }
}

RSS_FEEDS = [
    # Ag news feeds (most reliable)
    {"source": "FarmProgress", "url": "https://www.farmprogress.com/rss.xml", "category": "news"},
    {"source": "AgWeb", "url": "https://www.agweb.com/rss/news", "category": "news"},
    {"source": "DTN", "url": "https://www.dtnpf.com/agriculture/web/ag/news/rss/xml", "category": "news"},
    {"source": "Brownfield", "url": "https://brownfieldagnews.com/feed/", "category": "news"},
    {"source": "AGDAILY", "url": "https://www.agdaily.com/feed/", "category": "news"},
    {"source": "WorldGrain", "url": "https://www.world-grain.com/ext/rss/channel/5", "category": "news"},
    {"source": "Agweek", "url": "https://www.agweek.com/index.rss", "category": "news"},
    # USDA feeds
    {"source": "USDA", "url": "https://www.usda.gov/rss/latest-releases.xml", "category": "usda"},
    {"source": "USDA-ERS", "url": "https://www.ers.usda.gov/rss/feeds/ers-homepage.xml", "category": "usda"},
    {"source": "USDA-NASS", "url": "https://www.nass.usda.gov/rss/feeds/nassr01.xml", "category": "usda"},
]

def clean_contract_name(short_name, symbol):
    if not short_name:
        return ""
    if "USD" in symbol or "^" in symbol:
        return "Spot"
    match = re.search(r'\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s-]?(\d{2,4})', short_name, re.IGNORECASE)
    if match:
        month = match.group(1).title()
        year = match.group(2)
        if len(year) == 4:
            year = year[2:]
        return f"{month} '{year}"
    return "Spot"

def fetch_quote(symbol):
    try:
        ticker = yf.Ticker(symbol)
        fast_info = ticker.fast_info
        price = fast_info.get('lastPrice', fast_info.get('previousClose', 0))
        prev_close = fast_info.get('previousClose', price)
        year_low = fast_info.year_low
        year_high = fast_info.year_high
        
        if price <= 0:
            print(f"Invalid price for {symbol}: {price}")
            return None
        
        change = price - prev_close if prev_close else 0
        change_pct = (change / prev_close) * 100 if prev_close else 0
        
        contract_str = ""
        try:
            contract_str = clean_contract_name(ticker.info.get('shortName', ''), symbol)
        except Exception:
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
    news_items = []
    print("Fetching news feeds...")
    
    for feed in RSS_FEEDS:
        try:
            req = urllib.request.Request(
                feed['url'], 
                data=None, 
                headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
            )
            with urllib.request.urlopen(req, timeout=15) as response:
                xml_data = response.read()
                try:
                    root = ET.fromstring(xml_data)
                except ET.ParseError:
                    print(f"XML parse error for {feed['source']}")
                    continue 
                
                count = 0
                for item in root.findall('.//item'):
                    if count >= 3:
                        break 
                    
                    title_el = item.find('title')
                    link_el = item.find('link')
                    pub_el = item.find('pubDate')
                    
                    title = title_el.text if title_el is not None else "News Update"
                    link = link_el.text if link_el is not None else "#"
                    
                    time_str = datetime.now(timezone.utc).isoformat()
                    if pub_el is not None and pub_el.text:
                        try:
                            time_str = parsedate_to_datetime(pub_el.text).isoformat()
                        except Exception:
                            pass
                    
                    title = html.unescape(title).strip()
                    
                    news_items.append({
                        "source": feed['source'],
                        "title": title,
                        "link": link,
                        "time": time_str,
                        "category": feed.get('category', 'news')
                    })
                    count += 1
                    
                print(f"  ✓ {feed['source']}: {count} items")
        except Exception as e:
            print(f"  ✗ Error fetching RSS {feed['source']}: {e}")
            
    return news_items

def main():
    data = {
        "updated": datetime.now(timezone.utc).isoformat(),
        "markets": {
            "grains": {}, "livestock": {}, "indices": {}, "energy": {}, "metals": {}, "crypto": {}
        },
        "news": [],
        "usda": []
    }

    for category, items in SYMBOLS.items():
        for key, config in items.items():
            print(f"Fetching {config['name']}...")
            quote = fetch_quote(config["symbol"])
            if quote:
                data["markets"][category][key] = {
                    "name": config["name"],
                    "symbol": config["symbol"],
                    "unit": config["unit"],
                    **quote
                }
    
    all_news = fetch_news()
    data["news"] = [n for n in all_news if n.get('category') == 'news']
    data["usda"] = [n for n in all_news if n.get('category') == 'usda']
    
    os.makedirs("data", exist_ok=True)
    with open("data/markets.json", "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    
    print(f"\n✓ Success! Written to data/markets.json")
    print(f"  - {len(data['news'])} news items")
    print(f"  - {len(data['usda'])} USDA items")

if __name__ == "__main__":
    main()
