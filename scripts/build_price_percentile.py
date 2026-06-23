#!/usr/bin/env python3
"""
build_price_percentile.py  —  AGSIST 5-year price-position pipeline.

Fetches ~5 years of weekly front-month futures closes for corn, soybeans and
wheat, then writes data/price-stats.json with, per commodity:
  pct      : where today's close sits in the 5-yr distribution (0-100; high = expensive)
  cur      : latest close ($/bu)
  lo,hi    : 5-yr low / high ($/bu)
  median   : 5-yr median ($/bu)
  n        : number of weekly observations
  read     : plain-language "is this historically high or low" sentence

The commodity pages read this file and render a 5-Year Price Position bar beside
the existing 52-Week Range. Grain futures quote in cents on Yahoo; divided to $/bu.

Run in GitHub Actions (yfinance reaches Yahoo there). Exits non-zero on total
failure so a bad run never overwrites a good price-stats.json with junk.
"""
import json, sys, datetime as dt

TICKERS = {        # page-key : (yahoo continuous front-month, scale to display units)
    "corn":    ("ZC=F", 0.01),   # grains quote in cents -> $/bu
    "soybean": ("ZS=F", 0.01),
    "wheat":   ("ZW=F", 0.01),
    "cattle":  ("LE=F", 1.0),    # live cattle already in $/cwt
    "feeders": ("GF=F", 1.0),    # feeder cattle already in $/cwt
}
YEARS = 5

def read_sentence(pct, name):
    if pct is None:        return f"5-year history unavailable for {name}."
    if pct < 10:  band = "historically very low — near a 5-year bottom"
    elif pct < 25: band = "historically low — below most of the last 5 years"
    elif pct < 45: band = "below the 5-year midpoint"
    elif pct <= 55: band = "right around the 5-year midpoint"
    elif pct < 75: band = "above the 5-year midpoint"
    elif pct < 90: band = "historically high — above most of the last 5 years"
    else:          band = "historically very high — near a 5-year peak"
    return f"At the {pct}{ordinal(pct)} percentile of the last {YEARS} years — {band}."

def ordinal(n):
    if 10 <= n % 100 <= 20: return "th"
    return {1:"st",2:"nd",3:"rd"}.get(n % 10, "th")

def compute(closes_dollars):
    """closes_dollars: list of floats in $/bu (chronological)."""
    if not closes_dollars or len(closes_dollars) < 30:
        return None
    cur = closes_dollars[-1]
    n = len(closes_dollars)
    at_or_below = sum(1 for c in closes_dollars if c <= cur)
    pct = round(100.0 * at_or_below / n)
    pct = max(0, min(100, pct))
    s = sorted(closes_dollars)
    median = s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2.0
    return {
        "pct": pct,
        "cur": round(cur, 4),
        "lo": round(min(closes_dollars), 4),
        "hi": round(max(closes_dollars), 4),
        "median": round(median, 4),
        "n": n,
        "years": YEARS,
    }

def fetch_closes(ticker, scale):
    """Return (closes, pairs): closes is a chronological list of weekly closes in
    display units; pairs is a list of (calendar_month_0_11, close) for seasonality."""
    import yfinance as yf
    df = yf.Ticker(ticker).history(period=f"{YEARS}y", interval="1wk", auto_adjust=False)
    if df is None or df.empty:
        return [], []
    closes, pairs = [], []
    for idx, x in zip(df.index, df["Close"].tolist()):
        if x == x and x > 0:
            v = float(x) * scale
            closes.append(v)
            try:
                pairs.append((int(idx.month) - 1, v))
            except Exception:
                pass
    return closes, pairs


def compute_seasonality(pairs):
    """0-100 seasonal-strength index by calendar month, from the same 5-yr weekly
    closes. For each month, average its closes across the 5 years, then normalize the
    twelve monthly means so the cheapest month maps to 0 and the dearest to 100.
    Returns a 12-int list, or None if any month is missing data."""
    if not pairs:
        return None
    buckets = {m: [] for m in range(12)}
    for m, v in pairs:
        buckets[m].append(v)
    if any(len(buckets[m]) == 0 for m in range(12)):
        return None
    means = [sum(buckets[m]) / len(buckets[m]) for m in range(12)]
    lo, hi = min(means), max(means)
    if hi - lo < 1e-9:
        return [50] * 12
    return [int(round(100.0 * (mn - lo) / (hi - lo))) for mn in means]

def load_clean_cur():
    """Current front-month price per page-key, in display units, taken from the
    GATE-1-cleaned data/prices.json. build_price_percentile fetches its own 5-yr
    history from the CONTINUOUS tickers (ZC=F/ZS=F/ZW=F) — which splice across the
    contract roll — so the latest bar can be a fabricated value (the June-23 corn
    437 vs the real 409). We rank against the continuous history for context, but the
    CURRENT value that gets ranked + displayed must be the real front-month. Repairs
    in memory so this is correct even if the upstream prices.yml gate hasn't run.
    Returns {} if prices.json is unavailable."""
    try:
        with open("data/prices.json") as f:
            pdata = json.load(f)
    except Exception:
        return {}
    try:
        import preflight_prices
        preflight_prices.run(pdata, repair=True)   # defense-in-depth: resolve contamination in memory
    except Exception as e:
        print(f"[price-stats] preflight unavailable ({e}); using prices.json as-is", file=sys.stderr)
    quotes = pdata.get("quotes", {})
    keymap = {"corn": "corn", "soybean": "beans", "wheat": "wheat",
              "cattle": "cattle", "feeders": "feeders"}
    out = {}
    for page_key, jk in keymap.items():
        q = quotes.get(jk)
        if q and q.get("close") is not None:
            scale = TICKERS[page_key][1]
            out[page_key] = round(float(q["close"]) * scale, 4)
    return out


def main():
    out = {"updated": dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z"}
    clean_cur = load_clean_cur()
    if clean_cur:
        print(f"[price-stats] clean front-month current values: "
              + ", ".join(f"{k}=${v:.2f}" for k, v in clean_cur.items()))
    ok = 0
    for key, (tk, scale) in TICKERS.items():
        try:
            closes, pairs = fetch_closes(tk, scale)
            if key in clean_cur:
                # use the GATE-1-clean front-month as the current observation, so a
                # roll-splice in the continuous series can't poison cur/hi/percentile.
                if closes:
                    if abs(closes[-1] - clean_cur[key]) > 0.01 * max(clean_cur[key], 1):
                        print(f"[price-stats] {key}: continuous last {closes[-1]:.4f} "
                              f"replaced with clean front-month {clean_cur[key]:.4f}", file=sys.stderr)
                    closes[-1] = clean_cur[key]
                else:
                    closes = [clean_cur[key]]
            stats = compute(closes)
            if stats:
                stats["read"] = read_sentence(stats["pct"], key)
                seas = compute_seasonality(pairs)
                if seas:
                    stats["seasonality"] = seas
                out[key] = stats
                ok += 1
                print(f"{key}: {stats['pct']}{ordinal(stats['pct'])} pct  "
                      f"cur ${stats['cur']:.2f}  5y ${stats['lo']:.2f}-${stats['hi']:.2f}  n={stats['n']}")
            else:
                print(f"{key}: insufficient data ({tk})", file=sys.stderr)
        except Exception as e:
            print(f"{key}: fetch failed ({tk}): {e}", file=sys.stderr)
    if ok == 0:
        print("FATAL: no commodities fetched; refusing to overwrite price-stats.json", file=sys.stderr)
        sys.exit(2)
    import os
    os.makedirs("data", exist_ok=True)
    with open("data/price-stats.json", "w") as f:
        json.dump(out, f, indent=2)
    print(f"wrote data/price-stats.json ({ok}/{len(TICKERS)} commodities)")

if __name__ == "__main__":
    main()
