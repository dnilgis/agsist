#!/usr/bin/env python3
"""
fetch_prices.py — fetches commodity/futures/index/crypto prices via yfinance
Writes to data/prices.json. Run by GitHub Actions every 30min on weekdays.
All free, no API key needed.

v2 — 2026-03-24
  Added wk52_hi / wk52_lo from fast_info.year_high / year_low.
  These power the 52-week range bars on the homepage price cards.
  fast_info has year_high/year_low without a slow full .info() call.
"""

import json
import sys
from datetime import datetime, timezone
import yfinance as yf

# Map our internal keys → Yahoo Finance ticker symbols
SYMBOLS = {
    # ── Grains (CBOT) ──
    "corn":       "ZC=F",
    "corn-dec":   "ZCZ26.CBT",
    "beans":      "ZS=F",
    "beans-nov":  "ZSX26.CBT",
    "wheat":      "ZW=F",
    "oats":       "ZO=F",
    # ── Livestock ──
    "cattle":     "LE=F",
    "feeders":    "GF=F",
    "hogs":       "HE=F",
    "milk":       "DC=F",
    # ── Oilseeds / Feed ──
    "meal":       "ZM=F",
    "soyoil":     "ZL=F",
    # ── Energy ──
    "crude":      "CL=F",
    "natgas":     "NG=F",
    # ── Metals ──
    "gold":       "GC=F",
    "silver":     "SI=F",
    # ── Macro / Indices ──
    "dollar":     "DX=F",
    "treasury10": "^TNX",
    "sp500":      "^GSPC",
    # ── Crypto (replaces client-side CoinGecko) ──
    "bitcoin":    "BTC-USD",
    "ripple":     "XRP-USD",
    "kaspa":      "KAS-USD",
}


def fetch_quote(key, ticker):
    try:
        t = yf.Ticker(ticker)
        info = t.fast_info

        close  = getattr(info, 'last_price', None) or getattr(info, 'regular_market_price', None)
        prev   = getattr(info, 'previous_close', None) or getattr(info, 'regular_market_previous_close', None)
        # 52-week range — available on fast_info, no slow .info() call needed
        wk52_hi = getattr(info, 'year_high', None)
        wk52_lo = getattr(info, 'year_low', None)

        if close is None:
            # fallback: last 2 days of history
            hist = t.history(period="2d", interval="1d")
            if len(hist) >= 1:
                close = float(hist['Close'].iloc[-1])
                prev  = float(hist['Close'].iloc[-2]) if len(hist) >= 2 else close

        if close is None:
            print(f"  SKIP {key} ({ticker}) — no price data")
            return None

        close   = round(float(close), 5)
        prev    = round(float(prev), 5) if prev else close
        net     = round(close - prev, 5)
        pct     = round((net / prev * 100) if prev else 0, 4)
        wk52_hi = round(float(wk52_hi), 4) if wk52_hi else None
        wk52_lo = round(float(wk52_lo), 4) if wk52_lo else None

        range_str = f"  52wk: {wk52_lo}–{wk52_hi}" if wk52_hi and wk52_lo else "  52wk: n/a"
        print(f"  OK   {key:12s} ({ticker:12s})  {close:>12.4f}  {net:+.4f}  {pct:+.2f}%{range_str}")

        return {
            "ticker":    ticker,
            "close":     close,
            "open":      prev,
            "netChange": net,
            "pctChange": pct,
            "wk52_hi":   wk52_hi,
            "wk52_lo":   wk52_lo,
        }
    except Exception as e:
        print(f"  ERR  {key} ({ticker}): {e}")
        return None


def main():
    print(f"\nAGSIST fetch_prices.py v2 — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    print("-" * 70)

    # Load existing data so we can preserve last-known values on failure
    try:
        with open("data/prices.json", "r") as f:
            existing = json.load(f)
        old_quotes = existing.get("quotes", {})
    except Exception:
        old_quotes = {}

    quotes = {}
    ok = 0
    fail = 0

    for key, ticker in SYMBOLS.items():
        result = fetch_quote(key, ticker)
        if result:
            quotes[key] = result
            ok += 1
        else:
            # Preserve last known value rather than wiping it
            if key in old_quotes:
                quotes[key] = old_quotes[key]
                print(f"  KEPT {key} — using previous value")
            fail += 1

    output = {
        "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "ok":      ok,
        "failed":  fail,
        "quotes":  quotes
    }

    with open("data/prices.json", "w") as f:
        json.dump(output, f, indent=2)

    print(f"\nDone: {ok} fetched, {fail} failed → data/prices.json updated")
    if ok == 0:
        print("WARNING: All fetches failed — prices.json unchanged from seed")
        sys.exit(1)


if __name__ == "__main__":
    main()
