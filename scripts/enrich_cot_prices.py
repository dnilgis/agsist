#!/usr/bin/env python3
"""
enrich_cot_prices.py  —  AGSIST COT price enrichment

Adds a COT-date-aligned futures close ("price") to every record in
data/cot-history.json (and the latest snapshot in data/cot.json), so the
/cot page can compute net-vs-price divergence and forward-return reads.

Why this exists
---------------
The CFTC COT "net" is reported as-of TUESDAY. To compare positioning against
price honestly we need the TUESDAY close for each report week, on a series that
is continuous across contract rolls. This script pulls daily front-month
history via yfinance and snaps each COT Tuesday to its close (or the nearest
prior trading day if that Tuesday was a holiday).

Caveats (read before trusting the signal)
------------------------------------------
* yfinance ZC=F / ZS=F / ZW=F are FRONT-MONTH continuous and are NOT
  roll-adjusted, so there can be small level jumps at contract rolls. For a
  DIRECTIONAL divergence read (net rising while price isn't, etc.) this is
  acceptable, but it is not a back-adjusted research series. If you later want
  a roll-adjusted series, swap the fetch for your preferred provider and keep
  the same output shape.
* Prices are in the exchange's native units (US cents per bushel for grains,
  e.g. 462.0 = $4.62/bu). The /cot divergence math only uses direction and
  percentile, so units don't matter — but keep them consistent.

Output shape (unchanged structure, one new key per record)
----------------------------------------------------------
  data/cot-history.json
    history.corn[i]  = {date, net, long, short, price}   # price added
  data/cot.json
    corn = {..., price, price_prev}                       # added

Idempotent: re-running overwrites the price fields cleanly. Safe in CI.

Requires: pip install yfinance pandas   (you already use yfinance)
"""

import json
import os
import sys
import datetime as dt

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.normpath(os.path.join(HERE, "..", "data"))
HIST_PATH = os.path.join(DATA, "cot-history.json")
CUR_PATH = os.path.join(DATA, "cot.json")

# COT commodity key -> yfinance front-month continuous symbol
SYMBOLS = {
    "corn": "ZC=F",
    "beans": "ZS=F",
    "wheat": "ZW=F",
}


def log(*a):
    print("[enrich_cot_prices]", *a)


def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path, obj):
    # compact but stable; matches the existing single-line history style
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, separators=(",", ":"), ensure_ascii=False)
        f.write("\n")


def fetch_daily(symbol, start, end):
    """Return {date_str 'YYYY-MM-DD': close_float} for a symbol over [start,end]."""
    import yfinance as yf

    # pad the window so the first COT Tuesday has a prior trading day to snap to
    start_pad = (dt.date.fromisoformat(start) - dt.timedelta(days=10)).isoformat()
    end_pad = (dt.date.fromisoformat(end) + dt.timedelta(days=3)).isoformat()

    df = yf.download(
        symbol,
        start=start_pad,
        end=end_pad,
        interval="1d",
        auto_adjust=False,
        progress=False,
        threads=False,
    )
    if df is None or df.empty:
        raise RuntimeError("no data returned for %s" % symbol)

    # yfinance may return a multiindex column frame; normalize to a Close series
    close = df["Close"]
    if hasattr(close, "columns"):  # DataFrame (multiindex) -> first column
        close = close.iloc[:, 0]

    out = {}
    for ts, val in close.items():
        try:
            if val != val:  # NaN
                continue
            out[ts.date().isoformat()] = round(float(val), 2)
        except Exception:
            continue
    return out


def snap_price(daily, target_date):
    """Close on target_date, else nearest PRIOR trading day within 7 days."""
    d = dt.date.fromisoformat(target_date)
    for back in range(0, 8):
        key = (d - dt.timedelta(days=back)).isoformat()
        if key in daily:
            return daily[key]
    return None


def main():
    if not os.path.exists(HIST_PATH):
        log("ERROR: %s not found" % HIST_PATH)
        return 1

    hist = load_json(HIST_PATH)
    history = hist.get("history", {})

    # date span across all commodities
    all_dates = []
    for k in SYMBOLS:
        for r in history.get(k, []):
            all_dates.append(r["date"])
    if not all_dates:
        log("ERROR: no dated records in history")
        return 1
    all_dates.sort()
    start, end = all_dates[0], all_dates[-1]
    log("COT date span:", start, "->", end)

    # fetch + attach
    missing_total = 0
    for k, sym in SYMBOLS.items():
        rows = history.get(k, [])
        if not rows:
            continue
        log("fetching %s (%s) ..." % (k, sym))
        daily = fetch_daily(sym, start, end)
        miss = 0
        for r in rows:
            p = snap_price(daily, r["date"])
            if p is None:
                miss += 1
                r.pop("price", None)
            else:
                r["price"] = p
        missing_total += miss
        log("  %s: %d records, %d unmatched" % (k, len(rows), miss))

    save_json(HIST_PATH, hist)
    log("wrote", HIST_PATH)

    # also enrich the current snapshot (price + prior-week price) if present
    if os.path.exists(CUR_PATH):
        cur = load_json(CUR_PATH)
        for k in SYMBOLS:
            rows = history.get(k, [])
            if k in cur and rows:
                if rows[-1].get("price") is not None:
                    cur[k]["price"] = rows[-1]["price"]
                if len(rows) >= 2 and rows[-2].get("price") is not None:
                    cur[k]["price_prev"] = rows[-2]["price"]
        save_json(CUR_PATH, cur)
        log("wrote", CUR_PATH)

    if missing_total:
        log("WARN: %d total unmatched dates (left without price)" % missing_total)
    log("done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
