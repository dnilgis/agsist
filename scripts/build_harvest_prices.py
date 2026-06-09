#!/usr/bin/env python3
"""
build_harvest_prices.py  -  AGSIST harvest/projected price tracker pipeline.

Banks the daily futures settlement during each RMA price-discovery window and
recomputes the running average, writing data/harvest-prices.json (the file the
/harvest-price-tracker page reads).

Design (deliberately simple):
  - One CONFIG row per commodity: the discovery contract, exchange, the projected
    window month, the harvest window month, and the Yahoo/yfinance ticker.
  - Run this on a DAILY cron. During an open window it appends today's settle to
    the series and recomputes the running average. Outside a window it leaves the
    series alone. Once a window has fully passed, the average is marked "final".
  - It is append-only inside a window, so the banked series is the source of truth;
    re-running on the same day will not double-count (it keys on the date).

WIRING NOTE: set "ticker" to whatever symbol your existing price pipeline already
uses for the *dated* discovery contract (Dec corn / Nov soybean of the crop year).
yfinance continuous symbols (ZC=F, ZS=F) work as a fallback but track the front
month, not the specific discovery contract - confirm against your price pipeline.
"""

import json
import os
import sys
import datetime as dt

DATA_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "harvest-prices.json")

CROP_YEAR = 2026

# month numbers for each discovery window
PROJECTED_MONTH = 2    # February (corn/soybeans)
HARVEST_MONTH = 10     # October  (corn/soybeans)

CONFIG = [
    {"label": "Corn",     "contract": "Dec '26", "exchange": "CBOT",
     "ticker": "ZC=F", "scale": 1.0},
    {"label": "Soybeans", "contract": "Nov '26", "exchange": "CBOT",
     "ticker": "ZS=F", "scale": 1.0},
    # Phase 2 (fill verified projected prices before enabling):
    # {"label": "Winter Wheat (SRW)", "contract": "Jul", "exchange": "CBOT (Chicago)",
    #  "ticker": "ZW=F", "scale": 1.0},   # winter-wheat projected keys off Sep Chicago
]


def window_status(today, month):
    """pending (window in the future), active (this month), or final (window passed)."""
    if today.year < CROP_YEAR or (today.year == CROP_YEAR and today.month < month):
        return "pending"
    if today.year == CROP_YEAR and today.month == month:
        return "active"
    return "final"


def fetch_settle(ticker, day):
    """Return the settlement (close) for `ticker` on calendar date `day`, or None."""
    try:
        import yfinance as yf
    except ImportError:
        print("yfinance not installed; skipping fetch", file=sys.stderr)
        return None
    start = day.isoformat()
    end = (day + dt.timedelta(days=1)).isoformat()
    try:
        h = yf.Ticker(ticker).history(start=start, end=end, interval="1d")
        if h is None or h.empty:
            return None
        return round(float(h["Close"].iloc[-1]), 4)
    except Exception as e:  # network / symbol issues should never crash the cron
        print(f"fetch failed for {ticker} {day}: {e}", file=sys.stderr)
        return None


def load_existing():
    try:
        with open(DATA_PATH, encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def avg(series):
    vals = [p["v"] for p in series]
    return round(sum(vals) / len(vals), 2) if vals else None


def update_window(win, status, cfg, today):
    """Mutate one window dict (projected/harvest) in place for today's run."""
    win["status"] = status
    if status == "pending":
        return
    series = win.get("_bank", [])  # internal banked [{d,v}]
    if status == "active":
        settle = fetch_settle(cfg["ticker"], today)
        if settle is not None and not any(p["d"] == today.isoformat() for p in series):
            series.append({"d": today.isoformat(), "v": settle * cfg["scale"]})
        win["_bank"] = series
        win["series"] = [round(p["v"], 4) for p in series]
        win["days_counted"] = len(series)
        win["running_avg"] = avg(series)
        win["price"] = None
    elif status == "final":
        win["_bank"] = series
        win["series"] = [round(p["v"], 4) for p in series]
        if series:
            win["price"] = avg(series)
        # if we never banked the window (e.g. first deploy), keep any seeded price
        win["running_avg"] = None


def main():
    today = dt.date.today()
    existing = load_existing()
    prev = {c["label"]: c for c in existing["commodities"]} if existing else {}

    commodities = []
    for cfg in CONFIG:
        old = prev.get(cfg["label"], {})
        proj = old.get("projected", {"window": "February", "days_total": 19})
        harv = old.get("harvest", {"window": "October", "days_total": 23})

        update_window(proj, window_status(today, PROJECTED_MONTH), cfg, today)
        update_window(harv, window_status(today, HARVEST_MONTH), cfg, today)

        commodities.append({
            "label": cfg["label"],
            "contract": cfg["contract"],
            "exchange": cfg["exchange"],
            "projected": proj,
            "harvest": harv,
        })

    out = {
        "crop_year": CROP_YEAR,
        "updated": today.isoformat(),
        "source": "CBOT futures settlements averaged per RMA Commodity Exchange Price Provisions",
        "commodities": commodities,
    }
    os.makedirs(os.path.dirname(DATA_PATH), exist_ok=True)
    with open(DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print(f"wrote {DATA_PATH} ({today})")


if __name__ == "__main__":
    main()
