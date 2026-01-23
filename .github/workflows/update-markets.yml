#!/usr/bin/env python3
"""
Fetch commodity and crypto prices from Yahoo Finance
Writes to data/markets.json for static site consumption
"""

import yfinance as yf
import json
from datetime import datetime, timezone
import os
import re

# Yahoo Finance ticker symbols
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

def clean_contract_name(short_name, symbol):
    """
    Extracts the month/year from the shortName if possible.
    Example: "Corn Futures, Dec-2025" -> "Dec '25"
    """
    if not short_name:
        return ""
    
    # Don't try to format crypto or indices (usually spot prices)
    if "USD" in symbol or "^" in symbol:
        return "Spot"

    # Regex to find Month Year patterns like "Dec 25", "Dec 2025", "Dec-2025"
    match = re.search(r'\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s-]?(\d{2,4})', short_name, re.IGNORECASE)
    
    if match:
        month = match.group(1).title()
        year = match.group(2)
        # Shorten 2025 to 25
        if len(year) == 4:
            year = year[2:]
        return f"{month} '{year}"
    
    return "Spot"

def fetch_quote(symbol):
    """Fetch current quote, range, and metadata for a symbol"""
    try:
        ticker = yf.Ticker(symbol)
        
        # 'fast_info' is efficient for price and range
        fast_info = ticker.fast_info
        
        # Get price data
        price = fast_info.get('lastPrice', fast_info.get('previousClose', 0))
        prev_close = fast_info.get('previousClose', price)
        
        # Get 52 Week Range
        year_low = fast_info.year_low
        year_high = fast_info.year_high
        
        if prev_close and prev_close != 0:
            change = price - prev_close
            change_pct = (change / prev_close) * 100
        else:
            change = 0
            change_pct = 0
            
        # Try to get the contract month string (requires network call for .info)
        contract_str = ""
        try:
            # We use .info to get the 'shortName'
            info = ticker.info 
            short_name = info.get('shortName', '')
            contract_str = clean_contract_name(short_name, symbol)
        except Exception:
            contract_str = ""
        
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

def main():
    data = {
        "updated": datetime.now(timezone.utc).isoformat(),
        "source": "Yahoo Finance",
        "markets": {}
    }
    
    for category, items in SYMBOLS.items():
        data["markets"][category] = {}
        for key, config in items.items():
            print(f"Fetching {config['name']} ({config['symbol']})...")
            quote = fetch_quote(config["symbol"])
            if quote:
                data["markets"][category][key] = {
                    "name": config["name"],
                    "symbol": config["symbol"],
                    "unit": config["unit"],
                    **quote
                }
    
    # Ensure data directory exists
    os.makedirs("data", exist_ok=True)
    
    # Write JSON
    with open("data/markets.json", "w") as f:
        json.dump(data, f, indent=2)
    
    print(f"\nData written to data/markets.json at {data['updated']}")

if __name__ == "__main__":
    main()
