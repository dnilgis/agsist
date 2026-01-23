#!/usr/bin/env python3
"""
Fetch commodity and crypto prices from Yahoo Finance
Writes to data/markets.json for static site consumption
"""

import yfinance as yf
import json
from datetime import datetime, timezone
import os

# Yahoo Finance ticker symbols
SYMBOLS = {
    "grains": {
        "corn": {"symbol": "ZC=F", "name": "Corn", "unit": "¢/bu"},
        "soybeans": {"symbol": "ZS=F", "name": "Soybeans", "unit": "¢/bu"},
        "wheat": {"symbol": "ZW=F", "name": "Wheat", "unit": "¢/bu"},
        # Removed oats
    },
    "livestock": {
        "cattle": {"symbol": "LE=F", "name": "Live Cattle", "unit": "¢/lb"},
        "feeder": {"symbol": "GF=F", "name": "Feeder Cattle", "unit": "¢/lb"},
        # Removed hogs
        "milk": {"symbol": "DC=F", "name": "Class III Milk", "unit": "$/cwt"},
    },
    "indices": {
        "sp500": {"symbol": "^GSPC", "name": "S&P 500", "unit": "$"},
        "dow": {"symbol": "^DJI", "name": "Dow Jones", "unit": "$"},
    },
    "metals": {
        "gold": {"symbol": "GC=F", "name": "Gold", "unit": "$/oz"},
        "silver": {"symbol": "SI=F", "name": "Silver", "unit": "$/oz"},
        # Removed copper
    },
    "crypto": {
        "bitcoin": {"symbol": "BTC-USD", "name": "Bitcoin", "unit": "$"},
        "ethereum": {"symbol": "ETH-USD", "name": "Ethereum", "unit": "$"},
        "kaspa": {"symbol": "KAS-USD", "name": "Kaspa", "unit": "$"},
        "xrp": {"symbol": "XRP-USD", "name": "XRP", "unit": "$"},
    }
}

def fetch_quote(symbol):
    """Fetch current quote for a symbol"""
    try:
        ticker = yf.Ticker(symbol)
        info = ticker.fast_info
        
        price = info.get('lastPrice', info.get('previousClose', 0))
        prev_close = info.get('previousClose', price)
        
        if prev_close and prev_close != 0:
            change = price - prev_close
            change_pct = (change / prev_close) * 100
        else:
            change = 0
            change_pct = 0
        
        return {
            "price": round(price, 4),
            "change": round(change, 4),
            "changePct": round(change_pct, 2),
            "prevClose": round(prev_close, 4) if prev_close else None
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
    print(json.dumps(data, indent=2))

if __name__ == "__main__":
    main()
