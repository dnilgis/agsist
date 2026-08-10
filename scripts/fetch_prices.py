#!/usr/bin/env python3
"""
fetch_prices.py — fetches commodity/futures/index/crypto prices via yfinance
Writes to data/prices.json. Run by GitHub Actions every 30min on weekdays.
All free, no API key needed.

v3.5 — 2026-07-28
  True-front-month aliases + wheat classes. Yahoo's continuous ZC=F/ZS=F
  track the most-active contract (Dec/Nov new-crop in summer), so "front
  month" on the pages was quoting the wrong contract by ~22c. add_nearby()
  now publishes <crop>-nearby copied from the nearest unexpired dated
  contract, labeled with its month; a top-level "nearby" map names it.
  Also added KC HRW (KE=F) and MGEX HRS (MWE=F) so the wheat page can show
  all three classes, plus the missing wheat-may27 curve point.

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


from contract_calendar import is_expired, recent_expiry, expiry_date, month_num  # ONE definition of contract expiry

# A transient yfinance hiccup clears within hours; a quote that cannot be
# fetched for this many days is almost certainly an expired/rolled contract
# whose ticker needs advancing (see ANNUAL CONTRACT MAINTENANCE above).
STALE_ALERT_DAYS = 3


def mark_rolls(quotes, symbols, now=None):
    """Contract-roll marking (2026-07-20).

    Yahoo's continuous grain series (ZC=F / ZS=F / ZW=F) switch to the next
    contract when the front month dies, but previous_close still belongs to
    the OLD contract — so the first post-roll session prints a phantom
    day-change (2026-07-17: corn showed -3.58% that was the July→September
    switch, not a selloff). Detection needs NO extra API call: a dated key of
    that crop expiring inside ROLL_WINDOW_DAYS *is* the front-month rolling.

    Tags quotes[<crop>]["roll"] = True in place and returns
    {crop: {"rolled_off": "jul26", "expired": "2026-07-15"}} for the feed.
    Pure function of its inputs — selftested offline in
    scripts/test_mark_rolls.py with synthetic data.
    """
    continuous = {"corn": "corn-", "beans": "beans-", "wheat": "wheat-"}
    rolls = {}
    for cont, prefix in continuous.items():
        for key in symbols:
            if not key.startswith(prefix):
                continue
            if recent_expiry(key, now):
                exp = expiry_date(key)
                rolls[cont] = {
                    "rolled_off": key.split("-")[-1],
                    "expired": exp.strftime("%Y-%m-%d") if exp else None,
                }
                if cont in quotes and isinstance(quotes[cont], dict):
                    quotes[cont]["roll"] = True
                break
    return rolls


def _month_label(key):
    """'corn-sep26' -> \"Sep '26\". None if the suffix isn't a dated month."""
    suffix = str(key).split("-")[-1]
    mon = suffix[:3].capitalize()
    yr = suffix[3:]
    if month_num(suffix[:3]) is None or not yr.isdigit() or len(yr) != 2:
        return None
    return f"{mon} '{yr}"


def add_nearby(quotes, symbols, now=None):
    """True-front-month aliases (2026-07-28).

    Yahoo's continuous grain series (ZC=F / ZS=F) track the MOST-ACTIVE
    contract, not the nearest. In late July 2026 that meant quotes["corn"]
    was byte-identical to quotes["corn-dec"] (474.75) while the actual
    nearby Sep contract sat 22c lower at 452.50 — so every page hero
    labeled "Front Month" was quoting December and the seed note read
    "front-month $4.73 · December new-crop $4.73", degenerate on its face.

    Fix: for each crop, copy the nearest unexpired DATED contract's quote
    to <crop>-nearby, stamped with its contract label. A top-level
    "nearby" map names which contract won. Pages that mean "front month"
    read <crop>-nearby and show the label; the continuous key stays for
    tickers/ratios and should be labeled "most-active" wherever shown.
    Pure function of its inputs — selftested in scripts/test_nearby.py.
    """
    nearby = {}
    for crop in ("corn", "beans", "wheat", "cattle"):
        dated = []
        for k in symbols:
            if not k.startswith(crop + "-"):
                continue
            exp = expiry_date(k)
            if exp is None:
                continue          # undated benchmark alias like corn-dec
            dated.append((exp, k))
        dated.sort()
        for exp, k in dated:
            q = quotes.get(k)
            if is_expired(k, now) or not q or q.get("close") is None:
                continue
            alias = dict(q)
            alias["alias_of"] = k
            alias["contract"] = _month_label(k)
            quotes[crop + "-nearby"] = alias
            nearby[crop] = {"key": k, "label": _month_label(k)}
            # Log when the continuous series has drifted to a different
            # contract than the true nearby — the exact condition that
            # produced the front==new-crop duplicate.
            cq = quotes.get(crop)
            if cq and cq.get("close") is not None and cq["close"] != q["close"]:
                print(f"  NOTE {crop}: continuous {cq['close']} != nearby "
                      f"{k} {q['close']} — continuous is tracking a deferred "
                      f"(most-active) contract; pages should use {crop}-nearby")
            break
    return nearby


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
    # Wheat classes (2026-07-28): the wheat page was Chicago-only while two
    # thirds of the site's own wheat bids quote against KC or Minneapolis.
    # Continuous most-active series, same as ZW=F. Tickers match the ones
    # enrich_cot_prices.py already resolves via yfinance.
    "kcwheat":    "KE=F",     # KC HRW (hard red winter)
    "mplswheat":  "MWE=F",    # MGEX HRS (hard red spring)
    "oats":       "ZO=F",

    # ── Grain forward curve (year-explicit; UPDATE ANNUALLY) ──
    # Corn active months: Mar (H), May (K), Jul (N), Sep (U), Dec (Z)
    "corn-jul26": "ZCN26.CBT",
    "corn-sep26": "ZCU26.CBT",
    "corn-dec26": "ZCZ26.CBT",   # dated Dec (same ticker as corn-dec alias) — REQUIRED so
                                 # add_nearby can roll Sep->Dec on Sep 15; without it the
                                 # nearby ladder would skip to Mar '27 (audit 2026-07-29)
    "corn-mar27": "ZCH27.CBT",
    "corn-may27": "ZCK27.CBT",
    "corn-jul27": "ZCN27.CBT",
    "corn-dec27": "ZCZ27.CBT",

    # Beans active months: Jan (F), Mar (H), May (K), Jul (N), Aug (Q), Sep (U), Nov (X)
    "beans-jul26":"ZSN26.CBT",
    "beans-aug26":"ZSQ26.CBT",
    "beans-sep26":"ZSU26.CBT",
    "beans-nov26":"ZSX26.CBT",   # dated Nov (same ticker as beans-nov alias) — REQUIRED so
                                 # add_nearby can roll Sep->Nov on Sep 15; without it the
                                 # nearby ladder would skip to Jan '27 (audit 2026-07-29)
    "beans-jan27":"ZSF27.CBT",
    "beans-mar27":"ZSH27.CBT",
    "beans-jul27":"ZSN27.CBT",
    "beans-nov27":"ZSX27.CBT",

    # Wheat active months: Mar (H), May (K), Jul (N), Sep (U), Dec (Z)
    "wheat-jul26":"ZWN26.CBT",
    "wheat-sep26":"ZWU26.CBT",
    "wheat-dec26":"ZWZ26.CBT",
    "wheat-mar27":"ZWH27.CBT",
    "wheat-may27":"ZWK27.CBT",
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

    # ── Forward curves for the products that had NONE (added 2026-08-08) ──
    # Why: on 2026-08-08 the briefing published "lean hogs had their biggest
    # single-session gain in years... up 16.9%". Lean hogs cannot move 16.9% in
    # a session -- that is 2.9x the CME expanded daily limit. HE=F had spliced
    # August's close onto October's prior close. It went out because hogs, oats,
    # feeders, meal, milk and soyoil had no dated contract anywhere in this feed,
    # so preflight_prices.py had nothing to reconcile them against. Corn, beans,
    # wheat and cattle were fine precisely because they DID have curves.
    #
    # VERIFY ON FIRST RUN. These symbols and contract-month sets have not been
    # confirmed against a live Yahoo response or an authoritative CME listing --
    # they are the widely published month cycles. A wrong symbol logs SKIP/LOST
    # for that key and nothing else breaks: preflight treats a missing optional
    # curve as a WARN, not a block (see FRONT_OPTIONAL in preflight_prices.py).
    # Once a full session runs clean with no SKIPs, promote these out of
    # FRONT_OPTIONAL into FRONT so a missing curve becomes a hard failure.
    # UPDATE ANNUALLY, like the grain and cattle curves above.
    #
    # Lean hogs (CME) active months: Feb G, Apr J, May K, Jun M, Jul N, Aug Q, Oct V, Dec Z
    "hogs-aug26": "HEQ26.CME",
    "hogs-oct26": "HEV26.CME",
    "hogs-dec26": "HEZ26.CME",
    "hogs-feb27": "HEG27.CME",
    "hogs-apr27": "HEJ27.CME",
    "hogs-jun27": "HEM27.CME",

    # Feeder cattle (CME) active months: Jan F, Mar H, Apr J, May K, Aug Q, Sep U, Oct V, Nov X
    "feeders-aug26": "GFQ26.CME",
    "feeders-sep26": "GFU26.CME",
    "feeders-oct26": "GFV26.CME",
    "feeders-nov26": "GFX26.CME",
    "feeders-jan27": "GFF27.CME",
    "feeders-mar27": "GFH27.CME",

    # Oats (CBOT) active months: Mar H, May K, Jul N, Sep U, Dec Z
    "oats-sep26": "ZOU26.CBT",
    "oats-dec26": "ZOZ26.CBT",
    "oats-mar27": "ZOH27.CBT",
    "oats-may27": "ZOK27.CBT",

    # Soybean meal (CBOT) active months: Jan F, Mar H, May K, Jul N, Aug Q, Sep U, Oct V, Dec Z
    "meal-aug26": "ZMQ26.CBT",
    "meal-sep26": "ZMU26.CBT",
    "meal-oct26": "ZMV26.CBT",
    "meal-dec26": "ZMZ26.CBT",
    "meal-jan27": "ZMF27.CBT",
    "meal-mar27": "ZMH27.CBT",

    # Soybean oil (CBOT) active months: same cycle as meal
    "soyoil-aug26": "ZLQ26.CBT",
    "soyoil-sep26": "ZLU26.CBT",
    "soyoil-oct26": "ZLV26.CBT",
    "soyoil-dec26": "ZLZ26.CBT",
    "soyoil-jan27": "ZLF27.CBT",
    "soyoil-mar27": "ZLH27.CBT",

    # Class III milk (CME) lists all twelve months
    "milk-aug26": "DCQ26.CME",
    "milk-sep26": "DCU26.CME",
    "milk-oct26": "DCV26.CME",
    "milk-nov26": "DCX26.CME",
    "milk-dec26": "DCZ26.CME",
    "milk-jan27": "DCF27.CME",

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

    rolls = mark_rolls(quotes, SYMBOLS)
    if rolls:
        print("\n  ROLL WINDOW: " + ", ".join(
            f"{c} (front rolled off {v['rolled_off']}, expired {v['expired']})"
            for c, v in rolls.items()))

    nearby = add_nearby(quotes, SYMBOLS)

    # ── derived-field normalization (2026-08-10) ──────────────────────────
    # net/pct are DERIVED here as close - open (open = the prior close), so the
    # identity net == close - open must hold for everything we write. It stopped
    # holding for soyoil on 2026-08-10: a live, moving close arrived alongside a
    # frozen net/open, so the site displayed a stale day-change for most of the
    # session and the briefing's feed gate blocked 9 of 12 refreshes — Monday's
    # briefing never generated. Recompute from close/open (both real observed
    # values) so a partially-updated upstream record can never publish a wrong
    # change number. Corrections are NAMED in the log, never silent.
    fixed_derived = []
    for _k, _q in quotes.items():
        if not isinstance(_q, dict):
            continue
        _close, _prev = _q.get("close"), _q.get("open")
        if _close is None or _prev in (None, 0):
            continue
        try:
            _close = float(_close); _prev = float(_prev)
        except (TypeError, ValueError):
            continue
        _cnet = round(_close - _prev, 5)
        _cpct = round(_cnet / _prev * 100, 4)
        _onet, _opct = _q.get("netChange"), _q.get("pctChange")
        if _onet is None or abs(float(_onet) - _cnet) > max(0.02, abs(_close) * 0.0005):
            fixed_derived.append(f"{_k}: net {_onet} -> {_cnet}, pct {_opct} -> {_cpct}")
            _q["netChange"] = _cnet
            _q["pctChange"] = _cpct
            _q["derived_recomputed"] = True
    if fixed_derived:
        print(f"\n  DERIVED-FIELD FIX ({len(fixed_derived)}): upstream close disagreed "
              f"with its own net/pct; recomputed from close-open:")
        for _line in fixed_derived:
            print(f"    - {_line}")

    output = {
        "fetched":    datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "ok":         ok,
        "failed":     fail,
        "stale_keys": stale_keys,
        # Continuous front-months currently inside a contract-roll window.
        # Pages use quotes[<crop>].roll to suppress the phantom day-change.
        "rolls":      rolls,
        # Which dated contract each <crop>-nearby alias points at, e.g.
        # {"corn": {"key": "corn-sep26", "label": "Sep '26"}}. Pages use the
        # label so "front month" always names its contract.
        "nearby":     nearby,
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
