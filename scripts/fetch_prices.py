#!/usr/bin/env python3
"""
fetch_prices.py — fetches commodity/futures/index/crypto prices via yfinance
Writes to data/prices.json. Run by GitHub Actions every 30min on weekdays.
All free, no API key needed.

v3.4 — 2026-06-02 (evening)
  Ticker fallback chains. A SYMBOLS value may now be a LIST of candidate tickers;
  fetch tries each in order and uses the first that returns data. Used for the
  dollar (DX=F delisted) so the fix doesn't depend on a single replacement symbol
  resolving via yfinance's API — if DX-Y.NYB works it wins, otherwise it falls
  through to DX=F/DXY, and only if ALL fail does it KEEP the last value. The
  ticker actually used is recorded in prices.json so you can see which resolved.

v3.3 — 2026-06-02 (evening)
  Dollar ticker fix. Yahoo stopped serving DX=F (the ICE dollar-index future):
  'Quote not found for symbol: DX=F ... possibly delisted', so every run logged
  "1 failed" and kept the dollar frozen on its last value. Swapped to DX-Y.NYB
  (the US Dollar Index spot), which is actively quoting. Note DX-Y.NYB has no
  fast_info year_high/year_low, so wk52 may be null for the dollar — handled
  (the page already guards the dollar tile for a missing 52wk range).

v3.2 — 2026-06-02
  Silent-staleness defense. A failed fetch was preserved from the prior run
  ("KEPT") but the file still reported a fresh top-level "fetched" time, so a
  stale (or expired-contract) quote looked current to the page. Now: preserved
  quotes are tagged {"stale": true, "stale_since": <ISO>}; the run log NAMES
  every failed ticker; and any quote stale longer than STALE_ALERT_DAYS is
  flagged as a LIKELY-EXPIRED contract needing a ticker update. A top-level
  "stale_keys" list lets the front-end surface per-quote staleness if desired.
  Fresh fetches clear any prior stale tags.

v3.1 — 2026-04-26 (afternoon)
  yfinance fast_info can return float('nan') for missing fields
  (e.g. previous_close on a thin-volume crypto). The old `... or ...`
  fallback and `if prev else close` checks both treat NaN as truthy,
  so NaN flowed through net/pctChange and into prices.json. Browsers
  refuse to parse JSON with bare NaN literals — every price card on
  the homepage went blank. Now sanitized via _num() and json.dump is
  invoked with allow_nan=False as a fail-fast backstop.

v3 — 2026-04-26
  Added 19 grain forward-curve contracts (corn, beans, wheat) with year-explicit
  keys. Wheat now has 6 deferred contracts (previously had none — forward curve
  was rendering with one data point). All keys use an explicit year suffix so
  there is no ambiguity about which contract the data refers to.

  ANNUAL CONTRACT MAINTENANCE — please read.
  ------------------------------------------
  CBOT grain contracts roll throughout the year as nearby months expire.
  Roughly:
    - Mar contracts (H) expire mid-March
    - May contracts (K) expire mid-May
    - Jul contracts (N) expire mid-July
    - Sep contracts (U) expire mid-September
    - Dec contracts (Z) expire mid-December
    - Beans add Jan (F), Aug (Q), Nov (X)

  When a contract expires, yfinance starts returning empty data and the
  "preserve last known value" logic in this script will keep the stale
  number until you replace the ticker.

  RECOMMENDED ROUTINE: Once a year (early Jan is convenient), audit the
  SYMBOLS dict below. For each grain ticker, advance the year suffix on
  any contract whose calendar month is now in the past. Pattern:

      "corn-jul26": "ZCN26.CBT",     becomes
      "corn-jul28": "ZCN28.CBT",     after July 2026 expires

  Also update the two new-crop benchmark aliases each fall:
      "corn-dec":  "ZCZ26.CBT"  →  ZCZ27.CBT  (around Nov-Dec each year)
      "beans-nov": "ZSX26.CBT"  →  ZSX27.CBT  (around Oct-Nov each year)

  These aliases are used by the corn-bean ratio business logic on the
  futures pages and must point to the current new-crop benchmark.

v2 — 2026-03-24
  Added wk52_hi / wk52_lo from fast_info.year_high / year_low.
"""

import json
import math
import sys
from datetime import datetime, timezone
import yfinance as yf


def _num(v):
    """
    yfinance fast_info returns float('nan') for missing fields. NaN is truthy
    in Python, so `x or fallback` and `if x` both let it through. This helper
    coerces None / NaN / +/-inf / non-numeric values to None — the rest of the
    code can then test `if v is None` and the math stays clean.
    """
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return f


from contract_calendar import is_expired   # ONE definition of contract expiry

# A transient yfinance hiccup clears within hours; a quote that cannot be
# fetched for this many days is almost certainly an expired/rolled contract
# whose ticker needs advancing (see ANNUAL CONTRACT MAINTENANCE above).
STALE_ALERT_DAYS = 3


def candidates(spec):
    """A SYMBOLS value may be a single ticker string or a list of fallback
    tickers to try in order (first that returns data wins). Lets a delisted
    symbol degrade to alternatives instead of silently freezing the quote."""
    return spec if isinstance(spec, list) else [spec]

# Map our internal keys → Yahoo Finance ticker symbols
SYMBOLS = {
    # ── Grains: front month + new-crop benchmark aliases ──
    "corn":       "ZC=F",
    "corn-dec":   "ZCZ26.CBT",     # Dec 2026 — current new-crop benchmark; used by corn-bean ratio
    "beans":      "ZS=F",
    "beans-nov":  "ZSX26.CBT",     # Nov 2026 — current new-crop benchmark; used by corn-bean ratio
    "wheat":      "ZW=F",
    "oats":       "ZO=F",

    # ── Grain forward curve (year-explicit; UPDATE ANNUALLY) ──
    # Corn active months: Mar (H), May (K), Jul (N), Sep (U), Dec (Z)
    "corn-jul26": "ZCN26.CBT",
    "corn-sep26": "ZCU26.CBT",
    "corn-mar27": "ZCH27.CBT",
    "corn-may27": "ZCK27.CBT",
    "corn-jul27": "ZCN27.CBT",
    "corn-dec27": "ZCZ27.CBT",

    # Beans active months: Jan (F), Mar (H), May (K), Jul (N), Aug (Q), Sep (U), Nov (X)
    "beans-jul26":"ZSN26.CBT",
    "beans-aug26":"ZSQ26.CBT",
    "beans-sep26":"ZSU26.CBT",
    "beans-jan27":"ZSF27.CBT",
    "beans-mar27":"ZSH27.CBT",
    "beans-jul27":"ZSN27.CBT",
    "beans-nov27":"ZSX27.CBT",

    # Wheat active months: Mar (H), May (K), Jul (N), Sep (U), Dec (Z)
    "wheat-jul26":"ZWN26.CBT",
    "wheat-sep26":"ZWU26.CBT",
    "wheat-dec26":"ZWZ26.CBT",
    "wheat-mar27":"ZWH27.CBT",
    "wheat-jul27":"ZWN27.CBT",
    "wheat-dec27":"ZWZ27.CBT",

    # ── Livestock ──
    "cattle":     "LE=F",
    "feeders":    "GF=F",
    "hogs":       "HE=F",
    "milk":       "DC=F",

    # ── Live cattle forward curve (CME; active months Feb G, Apr J, Jun M, Aug Q, Oct V, Dec Z) ──
    # Yahoo livestock deferred format is {ROOT}{MONTH}{YY}.CME. VERIFY on first run:
    # if any cattle-* key logs SKIP/LOST, the suffix/format needs adjusting (see note below).
    # UPDATE ANNUALLY like the grain contracts — advance the year suffix as months expire.
    "cattle-aug26": "LEQ26.CME",
    "cattle-oct26": "LEV26.CME",
    "cattle-dec26": "LEZ26.CME",
    "cattle-feb27": "LEG27.CME",
    "cattle-apr27": "LEJ27.CME",
    "cattle-jun27": "LEM27.CME",
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
    "dollar":     ["DX-Y.NYB", "DX=F", "DXY"],  # DX=F was delisted on Yahoo ~mid-2026; try the index spot first, then fallbacks. First that resolves wins.
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

        # _num() short-circuits None/NaN/inf to None so downstream math
        # never sees a poisoned value. Two-step fallback (instead of `a or b`)
        # is needed because a legitimate 0.0 close should not trigger fallback.
        close = _num(getattr(info, 'last_price', None))
        if close is None:
            close = _num(getattr(info, 'regular_market_price', None))
        prev = _num(getattr(info, 'previous_close', None))
        if prev is None:
            prev = _num(getattr(info, 'regular_market_previous_close', None))
        # 52-week range — available on fast_info, no slow .info() call needed
        wk52_hi = _num(getattr(info, 'year_high', None))
        wk52_lo = _num(getattr(info, 'year_low', None))

        if close is None:
            # fallback: last 2 days of history
            hist = t.history(period="2d", interval="1d")
            if len(hist) >= 1:
                close = _num(hist['Close'].iloc[-1])
                if close is not None and len(hist) >= 2:
                    prev = _num(hist['Close'].iloc[-2])

        if close is None:
            print(f"  SKIP {key} ({ticker}) — no price data")
            return None

        # If we have close but no prev, treat as flat day so net/pct = 0.
        if prev is None:
            prev = close

        close   = round(close, 5)
        prev    = round(prev, 5)
        net     = round(close - prev, 5)
        pct     = round((net / prev * 100) if prev else 0, 4)
        wk52_hi = round(wk52_hi, 4) if wk52_hi is not None else None
        wk52_lo = round(wk52_lo, 4) if wk52_lo is not None else None

        range_str = f"  52wk: {wk52_lo}–{wk52_hi}" if wk52_hi and wk52_lo else "  52wk: n/a"
        print(f"  OK   {key:14s} ({ticker:14s})  {close:>12.4f}  {net:+.4f}  {pct:+.2f}%{range_str}")

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


def _days_since(iso):
    try:
        t = datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - t).total_seconds() / 86400.0
    except Exception:
        return None


def main():
    print(f"\nAGSIST fetch_prices.py v3 — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
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

    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    failed_keys = []
    stale_keys = []
    expired_suspects = []

    retired = []
    for key, spec in SYMBOLS.items():
        # A dated contract past its last trading day is not "failing to fetch",
        # it is DEAD. Preserving its final settle is how wheat-jul26 sat in the
        # feed at 631.25 while live Sep wheat was 669.00 -- a 37c ghost that any
        # consumer reading the key would have swallowed as current. Drop it.
        if is_expired(key):
            retired.append(key)
            continue

        cands = candidates(spec)
        result = None
        for ticker in cands:
            result = fetch_quote(key, ticker)
            if result:
                if len(cands) > 1 and ticker != cands[0]:
                    print(f"  NOTE {key}: primary {cands[0]} failed; using fallback {ticker}")
                break
        ticker = cands[-1]  # for failure logging below
        if result:
            quotes[key] = result   # fresh fetch: no stale tag (prior tags dropped)
            ok += 1
        else:
            failed_keys.append(f"{key} ({', '.join(cands)})")
            fail += 1
            # Preserve last known value rather than wiping it — but TAG it so a
            # stale quote can never masquerade as fresh.
            if key in old_quotes:
                kept = dict(old_quotes[key])
                since = kept.get("stale_since") or now_iso
                kept["stale"] = True
                kept["stale_since"] = since
                quotes[key] = kept
                stale_keys.append(key)
                days = _days_since(since)
                if days is not None and days >= STALE_ALERT_DAYS:
                    expired_suspects.append((key, ticker, days))
                    print(f"  STALE {key} ({ticker}) — preserved {days}d "
                          f"\u2014 LIKELY EXPIRED CONTRACT, update ticker")
                else:
                    print(f"  KEPT {key} ({ticker}) — preserved (stale since {since})")
            else:
                print(f"  LOST {key} ({ticker}) — failed and no prior value to keep")

    if retired:
        print(f"\n  RETIRED {len(retired)} expired contract(s), not fetched, not written:")
        for k in retired:
            print(f"    - {k}  (past last trading day; advance the ticker in SYMBOLS when you roll it)")

    output = {
        "fetched":    datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "ok":         ok,
        "failed":     fail,
        "stale_keys": stale_keys,
        # Dated contracts dropped because they are past their last trading day.
        # Named, not hidden: a consumer that wants corn-jul26 should be able to
        # see it was retired on purpose rather than wonder why the key vanished.
        "retired_keys": retired,
        "quotes":     quotes
    }

    # allow_nan=False raises ValueError if any NaN/inf slipped past _num().
    # Better to fail the workflow run loudly than write invalid JSON
    # that breaks the homepage silently.
    with open("data/prices.json", "w") as f:
        json.dump(output, f, indent=2, allow_nan=False)

    if failed_keys:
        print(f"\n  Failed this run: {', '.join(failed_keys)}")
    if expired_suspects:
        print("\n  \u26A0\uFE0F  LIKELY-EXPIRED CONTRACTS (preserved >= "
              f"{STALE_ALERT_DAYS}d) — advance the year suffix in SYMBOLS:")
        for k, tk, d in expired_suspects:
            print(f"       {k:14s} {tk:14s}  stale {d:.1f}d")
    print(f"\nDone: {ok} fetched, {fail} failed, {len(stale_keys)} preserved-stale \u2192 data/prices.json updated")
    if ok == 0:
        print("WARNING: All fetches failed — prices.json unchanged from seed")
        sys.exit(1)


if __name__ == "__main__":
    main()
