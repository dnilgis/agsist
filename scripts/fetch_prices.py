#!/usr/bin/env python3
"""
fetch_prices.py — fetches commodity/futures/index/crypto prices via yfinance
Writes to data/prices.json. Run by GitHub Actions every 30min on weekdays.
All free, no API key needed.

v3.7 — 2026-10-17
  Settle or last trade, said every time. v3.6 recorded the bar between the
  1:20 p.m. close and the reopen as the day's settle and then preferred it to
  the bar Yahoo later corrected, so on Oct 16 Nov soybeans printed "closed
  $12.60 1/2 (-3 3/4c)" against a CBOT settle of $12.61 1/4 (-1 3/4c): both
  ends of the change were last trades. Yahoo's bar becomes the settle late
  in the evening (RESTATED_BY, with the cases). Each quote now carries
  close_kind ("settle" or "last"), close_time for a last trade, prev_kind,
  and settle / settle_date / settle_net, the newest settle on file. Only a
  settle may be called closed or settled. The settles map holds settles only
  (settles_v 2); the afternoon trade is kept apart in day_last.
  Livestock and milk continuous keys now copy the front month
  (pin_continuous): HE=F printed dead Oct '26 hogs at $75.55 on Oct 16.

v3.6 — 2026-10-15
  Settled close kept apart from the evening trade. Yahoo puts a market's
  evening reopen into the bar of the day that just closed, under that day's
  date, so at 03:16 UTC Oct 15 Dec corn read 478.75 "close_date Oct 14" when
  the Oct 14 close was 481.0. split_settle() uses each market's session
  times (SESSIONS): in the evening the close is the settle recorded between
  the close and the reopen (carried run to run in each quote's `settles`),
  and the trade goes to last / last_time / last_date / last_net. With no
  settle on record the close steps back to the last known one under its own
  date and settle_pending names the missing day. Selftest:
  scripts/test_overnight_settle.py.

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

  CONTRACT MAINTENANCE (automatic for grains since 2026-10-11)
  -------------------------------------------------------------
  The dated corn, soybean, Chicago wheat and KC wheat tickers, and the two
  new-crop benchmark aliases (corn-dec, beans-nov), are generated on every
  run from scripts/contract_calendar.py: see GRAIN_CURVES and
  grain_curve_symbols(). A contract drops out of the fetch the day the
  calendar calls it dead (the 15th of its month), and the next year's months
  come in on their own. corn-dec rolls to next year's Dec on Dec 15, beans-nov
  to next year's Nov on Nov 15. Nothing to edit each year.

  STILL BY HAND: the cattle, feeder, hog, oats, meal, soyoil and milk curves
  below. Their exchange calendars differ (see PRODUCT_RULE in
  contract_calendar.py), so advance their year suffixes as months expire.
  An expired key is retired (not fetched, not written, named in
  retired_keys) whether it is generated or hand listed.

v2 — 2026-03-24
  Added wk52_hi / wk52_lo from fast_info.year_high / year_low.
"""

import json
import math
import sys
from datetime import datetime, timezone, timedelta
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


from contract_calendar import is_expired, recent_expiry, expiry_date, month_num, dead_from, next_live_year  # ONE definition of contract expiry

# A transient yfinance hiccup clears within hours; a quote that cannot be
# fetched for this many days is almost certainly an expired/rolled contract
# whose ticker needs advancing (grain curves roll themselves; livestock and
# soy product curves are still listed by hand, see CONTRACT MAINTENANCE above).
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


# Every root with dated months on file gets a <root>-nearby alias (2026-10-16).
# The class wheats, oats, meal, oil, feeders, hogs and milk had none, so their
# cards read the continuous series (KE=F, ZM=F, GF=F ...), fetched at a
# different moment than the dated month beside it: the corn page's wheat card
# said -10 1/2 while the wheat page said -11 1/4 for the same Dec contract.
NEARBY_ROOTS = ("corn", "beans", "wheat", "cattle", "kcwheat", "mplswheat", "oats",
                "meal", "soyoil", "feeders", "hogs", "milk")


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
    for crop in NEARBY_ROOTS:
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


# Roots whose continuous Yahoo series is replaced by the true front month
# (2026-10-17). HE=F kept printing Oct '26 lean hogs at $75.55 "unch" on
# Oct 16, two days after Oct hogs stopped trading (Oct 14), while Dec hogs
# rose 0.30 to $66.875; GF=F had already moved to Nov feeders while Oct
# feeders still trade to Oct 29. For livestock and milk the page means the
# front month, so the continuous key becomes a copy of <root>-nearby. Any
# other root's continuous key is replaced the same way when it is stale.
FRONT_PINNED = ("cattle", "feeders", "hogs", "milk")


def pin_continuous(quotes, nearby, stale_keys=None):
    """Point continuous keys at the nearby contract (see FRONT_PINNED).
    Returns the list of keys replaced. Mutates quotes (and stale_keys).
    Pure function of its inputs; selftested in scripts/test_nearby.py."""
    done = []
    for root, nb in (nearby or {}).items():
        alias = quotes.get(root + "-nearby")
        cq = quotes.get(root)
        if not alias:
            continue
        if root in FRONT_PINNED or (isinstance(cq, dict) and cq.get("stale")):
            q = dict(alias)
            q["continuous_ticker"] = (cq or {}).get("ticker")
            quotes[root] = q
            done.append(root)
            if stale_keys is not None and root in stale_keys:
                stale_keys.remove(root)
    return done


# ── Unit guard for the symbols no run has confirmed yet (2026-10-03) ─────────
# key -> (low, high, unit the page prints). A close outside the range means
# Yahoo is quoting in a different unit than the page labels (cents vs dollars),
# and printing it would be a wrong number under a right-looking label. The
# quote is left out of `quotes` and named in `withheld_keys` with the reason,
# so the page prints an em dash and says why. Ranges are deliberately wide:
# they only separate units, they do not judge the price.
UNIT_RANGE = {
    "cotton": (20.0, 250.0, "cents per lb"),
    "rice":   (5.0, 50.0, "dollars per cwt"),
}


def unit_guard(quotes):
    """Drop quotes whose close is outside UNIT_RANGE; return {key: reason}.
    Pure function of its inputs; selftested in scripts/test_class_spreads.py."""
    withheld = {}
    for key, (lo, hi, unit) in UNIT_RANGE.items():
        q = quotes.get(key)
        if not isinstance(q, dict) or q.get("close") is None:
            continue
        c = float(q["close"])
        if not (lo <= c <= hi):
            withheld[key] = (f"{q.get('ticker', key)} closed at {c}, outside {lo}-{hi}; "
                             f"the page prints {unit}, so the quote is held back until the "
                             f"unit is confirmed")
            del quotes[key]
    return withheld


# The two other wheat classes against Chicago SRW, in cents per bushel.
CLASS_SPREADS = {"kcwheat": "KC HRW", "mplswheat": "MGEX HRS"}


def first_notice_day(yr, mon):
    """CBOT first notice day for a grain contract month: the last business day
    of the month BEFORE delivery. Dec 2026 -> Mon Nov 30 2026. Business day is
    contract_calendar.is_trading_day, the one definition of a session, so an
    exchange holiday on the last weekday pushes it a day earlier."""
    from datetime import date, timedelta
    from contract_calendar import is_trading_day
    d = date(yr, mon, 1) - timedelta(days=1)
    while not is_trading_day(d):
        d -= timedelta(days=1)
    return d


def class_spreads(quotes, now=None):
    """KC HRW and MGEX HRS minus Chicago SRW (2026-10-03, wave1-C; wave3-J).

    Month against month only: the nearest delivery month for which BOTH
    <class>-<mon><yy> and wheat-<mon><yy> carry a fresh close, and which has
    not reached first notice day. From first notice day the month is in
    delivery and thinly traded, so it no longer stands for the class; the next
    month is used.

    There is no fallback to the two continuous series. KE=F and ZW=F follow
    volume, so they can sit on different months (KC on March while Chicago is
    still on December), and the difference is then a calendar spread printed
    as a class spread. When no same-month pair is on file, cents is None and
    `reason` says why. Pure function of its inputs; selftested in
    scripts/test_class_spreads.py.
    """
    def fresh(q):
        return isinstance(q, dict) and q.get("close") is not None and not q.get("stale")

    today = (now or datetime.now(timezone.utc)).date()
    out = {}
    for cls, name in CLASS_SPREADS.items():
        months = []
        past_notice = []
        for k in quotes:
            if not k.startswith(cls + "-"):
                continue
            suffix = k[len(cls) + 1:]
            exp = expiry_date(k)
            if exp is None or is_expired(k, now):
                continue
            mon, yr = month_num(suffix[:3]), 2000 + int(suffix[3:])
            if today >= first_notice_day(yr, mon):
                past_notice.append(_month_label(k))
                continue
            months.append((exp, suffix))
        months.sort()
        hit = None
        for exp, suffix in months:
            a, b = quotes.get(f"{cls}-{suffix}"), quotes.get(f"wheat-{suffix}")
            if fresh(a) and fresh(b):
                hit = {"cents": round(float(a["close"]) - float(b["close"]), 4),
                       "basis": "same-month", "month": _month_label(f"{cls}-{suffix}"),
                       "class_key": f"{cls}-{suffix}", "chicago_key": f"wheat-{suffix}",
                       "class_close": a["close"], "chicago_close": b["close"]}
                break
        if hit is None:
            if not months and not past_notice and not fresh(quotes.get(cls)):
                reason = f"no current {name} quote on file"
            else:
                reason = (f"no current {name} and Chicago SRW quotes for the same delivery "
                          f"month on file; the most-active series can sit on different "
                          f"months, so they are not subtracted")
                if past_notice:
                    reason += f" ({', '.join(past_notice)} past first notice day)"
            hit = {"cents": None, "reason": reason}
        out[cls] = hit
    return out


def candidates(spec):
    """A SYMBOLS value may be a single ticker string or a list of fallback
    tickers to try in order (first that returns data wins). Lets a delisted
    symbol degrade to alternatives instead of silently freezing the quote."""
    return spec if isinstance(spec, list) else [spec]

# ── Grain curves: generated from the calendar (2026-10-11) ──────────────────
# Until 2026-10-11 every dated corn, bean, wheat and KC wheat ticker was typed
# by hand, with a note to advance the year suffixes once a year and to move
# the corn-dec / beans-nov aliases each fall. Nobody has to now: the list is
# computed on every run from contract_calendar, the one definition of expiry.
#
# Per root: every listed month from the contract that died most recently
# (within RETIRE_LOOKBACK_DAYS, so mark_rolls can see the roll and the feed
# names it in retired_keys) through the root's horizon.
#   corn   all months through Dec of next calendar year, plus Dec of the
#          year after (dnilgis/flashgrain reads corn-dec28 today)
#   beans  all months through Nov of next calendar year, plus Nov of the
#          year after (flashgrain reads beans-nov28)
#   wheat  all months through Dec of next calendar year
# The horizon moves on Jan 1, so a new year's far months arrive together;
# a key only ever leaves the fetch when its contract dies.
#   KC     the next KC_LIVE_COUNT live months (the class spread needs only the
#          nearest same-month pair with Chicago, which the wheat curve covers)
# On 2026-10-11 that is exactly the live part of the old hand list, plus
# wheat-sep27, which the hand list skipped for no stated reason.
RETIRE_LOOKBACK_DAYS = 31
KC_LIVE_COUNT = 3
FCODE = "FGHJKMNQUVXZ"
_MON3 = ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")
# key root, Yahoo root, listed months, horizon month, add that month two years out
GRAIN_CURVES = (
    ("corn",  "ZC", (3, 5, 7, 9, 12), 12, True),
    ("beans", "ZS", (1, 3, 5, 7, 8, 9, 11), 11, True),
    ("wheat", "ZW", (3, 5, 7, 9, 12), 12, False),
)
KC_CURVE = ("kcwheat", "KE", (3, 5, 7, 9, 12))


def _today(now=None):
    d = now or datetime.now(timezone.utc)
    return d.date() if isinstance(d, datetime) else d


def _grain_entry(root, yroot, yr, mon):
    yy = f"{yr % 100:02d}"
    return f"{root}-{_MON3[mon - 1]}{yy}", f"{yroot}{FCODE[mon - 1]}{yy}.CBT"


def grain_curve_symbols(now=None):
    """{key: ticker} for the dated corn, bean, wheat and KC wheat contracts a
    run fetches, in calendar order per root. Expired months inside the
    lookback are listed so main() retires them by name and mark_rolls sees
    the roll; main() never fetches or writes them. Pure function of the
    date; selftested in scripts/test_grain_symbols.py."""
    today = _today(now)
    floor = today - timedelta(days=RETIRE_LOOKBACK_DAYS)
    out = {}

    def ladder(months, last):
        for yr in range(today.year - 1, last[0] + 1):
            for mon in months:
                if (yr, mon) <= last and dead_from(yr, mon, "GRAIN") >= floor:
                    yield yr, mon

    y = today.year
    for root, yroot, months, bmon, far in GRAIN_CURVES:
        for yr, mon in ladder(months, (y + 1, bmon)):
            k, t = _grain_entry(root, yroot, yr, mon)
            out[k] = t
        if far:
            k, t = _grain_entry(root, yroot, y + 2, bmon)
            out[k] = t
    root, yroot, months = KC_CURVE
    live = 0
    for yr, mon in ladder(months, (today.year + 2, 12)):
        if today >= dead_from(yr, mon, "GRAIN"):
            continue          # KC has no continuous roll to mark; live months only
        if live == KC_LIVE_COUNT:
            break
        live += 1
        k, t = _grain_entry(root, yroot, yr, mon)
        out[k] = t
    return out


def benchmark_ticker(yroot, mon, now=None):
    """The rolling new-crop benchmark: the next live contract in month `mon`.
    'ZC', 12 -> 'ZCZ26.CBT' through Dec 14 2026, 'ZCZ27.CBT' from Dec 15."""
    yr = next_live_year(mon, _today(now))
    return f"{yroot}{FCODE[mon - 1]}{yr % 100:02d}.CBT"


def build_symbols(now=None):
    """Our internal keys -> Yahoo Finance ticker symbols, as of `now`."""
    return {
        # ── Grains: front month + new-crop benchmark aliases ──
        "corn":       "ZC=F",
        # corn-dec / beans-nov: the next live Dec corn / Nov beans contract. They
        # roll the day the dated contract dies (Dec 15 / Nov 15, contract_calendar),
        # so each always carries the same quote as one dated key (corn-dec26 now).
        # Read by the futures pages, price watch, the briefing and sparklines.
        "corn-dec":   benchmark_ticker("ZC", 12, now),
        "beans":      "ZS=F",
        "beans-nov":  benchmark_ticker("ZS", 11, now),
        "wheat":      "ZW=F",
        # Wheat classes (2026-07-28): the wheat page was Chicago-only while two
        # thirds of the site's own wheat bids quote against KC or Minneapolis.
        # Continuous most-active series, same as ZW=F. Tickers match the ones
        # enrich_cot_prices.py already resolves via yfinance.
        "kcwheat":    "KE=F",     # KC HRW (hard red winter)
        # MGEX HRS (hard red spring). MWE=F has never landed in prices.json, and
        # cot_deep.py's first run logged "Quote not found for symbol: MWE=F" for
        # MW=F and MWE=F alike after MGEX became MIAX Futures. Kept as a fallback
        # list so the first symbol Yahoo serves wins; until then the key is absent
        # and the homepage prints an em dash with that reason.
        "mplswheat":  ["MWE=F", "MW=F"],
        "oats":       "ZO=F",

        # ── Southern crops (2026-10-03, wave1-C) ──
        # UNVERIFIED: neither symbol appears anywhere else in this repo or in its
        # data, so the first Actions run is what confirms them. Same continuous
        # root=F pattern as ZC=F/ZW=F/ZO=F above. A symbol Yahoo does not serve
        # logs LOST and nothing else breaks; the homepage prints an em dash.
        # UNIT_RANGE below withholds a quote that arrives in a unit the page does
        # not expect, instead of printing it under the wrong unit.
        "cotton":     "CT=F",     # ICE cotton No. 2, cents per lb
        "rice":       "ZR=F",     # CBOT rough rice, dollars per cwt
        # Canola (ICE) left out: no canola symbol is used anywhere in this
        # pipeline, so there is nothing to follow. Sorghum and peanuts have no
        # liquid US futures; the site carries them through cash bids and RMA.

        # ── Grain forward curves: generated, see GRAIN_CURVES above ──
        **grain_curve_symbols(now),

        # ── Livestock ──
        "cattle":     "LE=F",
        "feeders":    "GF=F",
        "hogs":       "HE=F",
        "milk":       "DC=F",

        # ── Live cattle forward curve (CME; active months Feb G, Apr J, Jun M, Aug Q, Oct V, Dec Z) ──
        # Yahoo livestock deferred format is {ROOT}{MONTH}{YY}.CME. VERIFY on first run:
        # if any cattle-* key logs SKIP/LOST, the suffix/format needs adjusting (see note below).
        # UPDATE ANNUALLY (by hand; only the grain curves roll themselves): advance the year suffix as months expire.
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
        # UPDATE ANNUALLY by hand, like the cattle curve above.
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


SYMBOLS = build_symbols()


def close_and_prev(bars):
    """The printed close and the close the day-change is measured against,
    both from the daily bars (2026-10-03, wave3-J).

    `bars` is a list of (date_iso, close) in date order, as history() returns
    them. NaN/None closes are dropped first. Returns
    (close, prev, close_date, prev_date); prev and prev_date are None when
    fewer than two bars carry a close.

    WHY: fast_info.previous_close was wrong. On 2026-10-02 it said 1276.5 for
    Nov beans when the Oct 1 settle was 1284 (harvest-prices.json and RMA
    agree), so beans printed up 3/4 on a day they fell 6 3/4. The previous
    close is the second-to-last daily bar, the same way
    fetch_harvest_prices.py reads settles. The close comes from the last bar
    of the SAME series, so the pair always belongs to two adjacent sessions
    of one source. Pure function; selftested in scripts/test_prev_close.py.
    """
    clean = [(str(d)[:10], _num(c)) for d, c in bars]
    clean = [(d, c) for d, c in clean if c is not None]
    if not clean:
        return None, None, None, None
    close_date, close = clean[-1]
    if len(clean) < 2:
        return close, None, close_date, None
    prev_date, prev = clean[-2]
    return close, prev, close_date, prev_date


# ── Settled close vs last trade (2026-10-15) ────────────────────────────────
# Yahoo folds a market's evening reopen into the daily bar of the session that
# just closed, under that session's date. data/prices.json at 03:16 UTC Oct 15
# 2026 said Dec corn 478.75, close_date Oct 14; the Oct 14 close was 481.0
# (the 18:46 and 00:01 UTC fetches, and the 4.81 settle in harvest-prices.json).
# So every evening page printed an overnight trade as a close, and the change
# was measured from the day before's close.
#
# Session times, Central time:
#   close         the end of the day session for the bar's date
#   reopen        when the next session starts trading
#   reopen_eve    True when that is the evening BEFORE the next trading day
#                 (the trades then land in the old bar); False when it is the
#                 next trading day's morning (no evening session, no problem)
#   settle_in_bar True when the bar between close and reopen IS the day's
#                 final price. False for energy and metals: they settle at
#                 13:30 / 12:30 CT and keep trading to 16:00, so the bar is
#                 never the settle and nothing is recorded from it.
# Sources: CBOT grains 19:00-07:45 and 08:30-13:20 CT (13:15 for rough rice);
# CME live cattle, feeders, hogs 08:30-13:05 CT, no evening; CME Class III
# milk Sun-Fri 17:00-13:55 CT (CME dairy advisory); ICE cotton 21:00-14:20 ET;
# CME Globex energy and COMEX metals 17:00-16:00 CT. Indexes, the dollar and
# crypto are not here and are left exactly as the bars give them.
SESSIONS = {
    "grain":     {"close": (13, 20), "reopen": (19, 0),  "reopen_eve": True,  "settle_in_bar": True},
    "rice":      {"close": (13, 15), "reopen": (19, 0),  "reopen_eve": True,  "settle_in_bar": True},
    "livestock": {"close": (13, 5),  "reopen": (8, 30),  "reopen_eve": False, "settle_in_bar": True},
    "dairy":     {"close": (13, 55), "reopen": (17, 0),  "reopen_eve": True,  "settle_in_bar": True},
    "softs":     {"close": (13, 20), "reopen": (20, 0),  "reopen_eve": True,  "settle_in_bar": True},
    "energy":    {"close": (16, 0),  "reopen": (17, 0),  "reopen_eve": True,  "settle_in_bar": False},
    "metals":    {"close": (16, 0),  "reopen": (17, 0),  "reopen_eve": True,  "settle_in_bar": False},
}
_MARKET_OF_ROOT = {
    "corn": "grain", "beans": "grain", "wheat": "grain", "kcwheat": "grain",
    "mplswheat": "grain", "oats": "grain", "meal": "grain", "soyoil": "grain",
    "rice": "rice",
    "cattle": "livestock", "feeders": "livestock", "hogs": "livestock",
    "milk": "dairy",
    "cotton": "softs",
    "crude": "energy", "natgas": "energy",
    "gold": "metals", "silver": "metals",
}
SETTLES_KEPT = 3          # dates of settles (and day-session last trades) carried per quote
# The settles map format. Until v3.7 `settles` held whatever the bar said
# between the close and the reopen, which is the last trade, not the settle;
# a map without this version mark is not carried.
SETTLES_V = 2

# ── When a bar becomes the settle (2026-10-17) ──────────────────────────────
# Yahoo's daily bar for a session holds the LAST TRADE until late evening,
# then Yahoo replaces it with the exchange settle. Every case on file agrees:
#   Nov '26 soybeans Oct 16: 1260.50 at 18:46 UTC (13:46 CT), CBOT settle
#     1261.25 (-1.75, Barchart and Successful Farming, Oct 16). We printed
#     "closed $12.60 1/2 (-3 3/4c)".
#   Nov '26 soybeans Oct 15: 1264.25 at 18:46 UTC; the bar read from 04:16 UTC
#     on was 1263.00, which is the settle the -1.75 above is measured from.
#   Dec '26 corn Oct 15: 478.25 at 18:46 UTC; the bar later read 478.00, the
#     settle (Oct 16 settled 474.25, -3.75).
#   Dec '26 corn Oct 14: 481.00 at 18:46 UTC; the bar later read 480.75.
#   Dec '26 lean hogs Oct 15: 66.625 at 18:46 UTC, 66.575 from 03:46 UTC.
#   Oct '26 feeders Oct 15: 343.50, then 343.375 from 03:46 UTC.
# So a bar is called a settle only when Yahoo has had the evening to replace
# it: any bar older than the newest one, or the newest one fetched at or after
# RESTATED_BY Central on its own date (or any later date), and never while an
# evening session is trading into it. Before that the price is the last trade
# and says so (close_kind "last", close_time).
RESTATED_BY = (23, 30)


def restate_at(day, market):
    """When the bar for session `day` is taken to hold the settle (CT, aware)."""
    from datetime import date as _date
    d = day if isinstance(day, _date) else datetime.strptime(str(day)[:10], "%Y-%m-%d").date()
    return datetime(d.year, d.month, d.day, *RESTATED_BY, tzinfo=_ct())


def market_of(key):
    """'corn-dec26' -> 'grain'; None for keys with no session table."""
    return _MARKET_OF_ROOT.get(str(key).split("-")[0])


def _ct():
    from zoneinfo import ZoneInfo
    return ZoneInfo("America/Chicago")


def session_bounds(day, market):
    """(close, reopen) as aware CT datetimes for the session dated `day`, or
    None for a market with no table. reopen is the start of the next session:
    the evening before the next trading day (Sunday for a Friday), or that
    day's morning for livestock."""
    from datetime import date as _date
    from contract_calendar import next_trading_day
    s = SESSIONS.get(market)
    if not s:
        return None
    d = day if isinstance(day, _date) else datetime.strptime(str(day)[:10], "%Y-%m-%d").date()
    tz = _ct()
    close = datetime(d.year, d.month, d.day, *s["close"], tzinfo=tz)
    nxt = next_trading_day(d)
    rd = nxt - timedelta(days=1) if s["reopen_eve"] else nxt
    reopen = datetime(rd.year, rd.month, rd.day, *s["reopen"], tzinfo=tz)
    return close, reopen


def _iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def carried_settles(key, old_q, old_fetched=None):
    """{"settles": {date: px}, "day_last": {date: {"px", "at"}}} that a quote
    carries into this run from the previous file. Only a v2 map (settles_v ==
    SETTLES_V) is carried: older files filled `settles` with the afternoon's
    last trade. A stale quote carries nothing new but keeps its maps.
    `old_fetched` is accepted for the old call shape and not used. Pure;
    selftested in scripts/test_overnight_settle.py."""
    out = {"settles": {}, "day_last": {}}
    if not isinstance(old_q, dict) or old_q.get("settles_v") != SETTLES_V:
        return out
    for d, px in (old_q.get("settles") or {}).items():
        v = _num(px)
        if v is not None:
            out["settles"][str(d)[:10]] = v
    for d, rec in (old_q.get("day_last") or {}).items():
        if isinstance(rec, dict) and _num(rec.get("px")) is not None and rec.get("at"):
            out["day_last"][str(d)[:10]] = {"px": _num(rec["px"]), "at": str(rec["at"])}
    return out


def split_settle(key, bars, now, carried=None):
    """The settle and the last trade, kept apart.

    `bars` as for close_and_prev, `now` the fetch time (aware), `carried` what
    carried_settles() returned for the previous file. Returns a dict:
      close, prev, close_date, prev_date   as close_and_prev, except in the
                   evening session (see below)
      close_kind   "settle" when close is the exchange settle for close_date,
                   "last" when it is a trade (in session, or after the close
                   but before Yahoo has replaced the bar with the settle)
      close_time   for a "last" close: when the trade was current (the fetch
                   time in session, the session close after it)
      prev_kind    "settle" when prev is a settle (an older bar), else None
      settle, settle_date, settle_net   the newest settle known for this
                   contract and its change from the settle before it (None
                   when that one is not on file)
      settled      True when an evening session has traded into the newest
                   bar; that trade is moved to last / last_date / last_net
      settle_pending  the date whose settle is not known yet (evening only)
      settles, day_last   the maps to carry forward
    Markets with no session table (indexes, the dollar, crypto) pass through
    with close_kind None. Energy and metals settle mid-session, so their bar
    is never the settle: close_kind is always "last" for them.
    Pure function of its inputs; selftested in scripts/test_overnight_settle.py.
    """
    from contract_calendar import next_trading_day
    clean = [(str(d)[:10], _num(c)) for d, c in bars]
    clean = [(d, c) for d, c in clean if c is not None]
    close, prev, close_date, prev_date = close_and_prev(clean)
    out = {"close": close, "prev": prev, "close_date": close_date, "prev_date": prev_date,
           "close_kind": None}
    carried = carried or {}
    settles = dict(carried.get("settles") or {})
    day_last = dict(carried.get("day_last") or {})
    mkt = market_of(key)
    if not mkt or not clean:
        return out
    s = SESSIONS[mkt]
    trusted = s["settle_in_bar"]
    older = clean[:-1]
    if trusted:
        for d, px in older:
            settles[d] = px          # Yahoo has replaced these with the settle
    c_at, r_at = session_bounds(close_date, mkt)
    nxt = next_trading_day(datetime.strptime(close_date, "%Y-%m-%d").date())
    next_close = session_bounds(nxt, mkt)[0]
    evening = s["reopen_eve"] and r_at <= now < next_close
    if evening:
        out["settled"] = True
        out["last"] = close
        out["last_date"] = nxt.isoformat()
        if close_date in settles:
            out.update({"close": settles[close_date], "close_kind": "settle"})
        elif close_date in day_last:
            out.update({"close": day_last[close_date]["px"], "close_kind": "last",
                        "close_time": day_last[close_date]["at"]})
        else:
            # Nothing on file for the newest session: the newest one that
            # is known, under its own date.
            c2, p2, cd2, pd2 = close_and_prev(older)
            out.update({"close": c2, "prev": p2, "close_date": cd2, "prev_date": pd2,
                        "close_kind": "settle" if trusted else "last",
                        "settle_pending": close_date})
            if not trusted:
                out["close_time"] = _iso(session_bounds(cd2, mkt)[0]) if cd2 else None
        if "settle_pending" not in out:
            out["prev"] = older[-1][1] if older else None
            out["prev_date"] = older[-1][0] if older else None
            out["last_net"] = round(out["last"] - out["close"], 5)
        else:
            out["last_net"] = None
    elif trusted and now >= restate_at(close_date, mkt):
        out["close_kind"] = "settle"
        settles[close_date] = close
    else:
        out["close_kind"] = "last"
        out["close_time"] = _iso(min(now, c_at))
        if trusted and now >= c_at:
            day_last[close_date] = {"px": close, "at": _iso(c_at)}
    if trusted and out.get("prev_date") is not None:
        out["prev_kind"] = "settle"
    # The newest settle on file and its change.
    if out["close_kind"] == "settle" and trusted:
        sd = out["close_date"]
    else:
        sd = out.get("prev_date") if trusted else None
    if sd is not None and sd in settles:
        out["settle"] = settles[sd]
        out["settle_date"] = sd
        from contract_calendar import prior_trading_day
        pd0 = prior_trading_day(datetime.strptime(sd, "%Y-%m-%d").date()).isoformat()
        out["settle_net"] = round(settles[sd] - settles[pd0], 5) if pd0 in settles else None
    keep = sorted(settles)[-SETTLES_KEPT:]
    out["settles"] = {d: settles[d] for d in keep}
    keep = sorted(day_last)[-SETTLES_KEPT:]
    out["day_last"] = {d: day_last[d] for d in keep}
    return out


def planting_year(today):
    """The crop year the corn/bean planting ratio is about.

    Up to the harvest roll it is this year's crop (Nov beans / Dec corn of
    this year are the new-crop contracts). From the day September corn goes
    off the board (contract_calendar dead_from: the 15th, CBOT's business day
    before the 15th being the last trade), the Dec and Nov contracts of this
    year are the crop being harvested, and the next planting decision is
    priced on next year's Nov beans / Dec corn. On 2026-10-09 the pages
    still divided Nov '26 by Dec '26 (2.69, "beans favored") while the 2027
    acreage pair read 2.47, neutral."""
    return today.year + (1 if today >= dead_from(today.year, 9, "GRAIN") else 0)


def planting_ratio(quotes, today):
    """{value, beans, corn, label, crop_year} from Nov beans / Dec corn of the
    planting year, or {reason} when either quote is missing. Pure; selftested
    in scripts/test_nearby.py."""
    y = planting_year(today)
    yy = str(y)[2:]
    bk, ck = f"beans-nov{yy}", f"corn-dec{yy}"
    b, c = (quotes.get(bk) or {}).get("close"), (quotes.get(ck) or {}).get("close")
    label = f"Nov '{yy} beans \u00f7 Dec '{yy} corn"
    if not b or not c:
        return {"crop_year": y, "beans": bk, "corn": ck, "label": label, "value": None,
                "reason": f"no quote for {bk if not b else ck}"}
    return {"crop_year": y, "beans": bk, "corn": ck, "label": label,
            "value": round(float(b) / float(c), 4)}


def widen_range(lo, hi, close):
    """The 52-week range must contain the latest close.

    fast_info.year_low/year_high lag the last bar: on 2026-10-09 lean hogs
    closed 75.15 under a published 52-week low of 75.75, rice 16.97 over a
    16.935 high (4 of 82 quotes). A page then drew the dot outside its own bar
    and printed a low that the price had already broken. The close IS the new
    low (or high), so the range is widened to it. A missing end stays missing.
    Pure function; selftested in scripts/test_prev_close.py.
    """
    if close is None:
        return lo, hi
    if lo is not None and close < lo:
        lo = close
    if hi is not None and close > hi:
        hi = close
    return lo, hi


def _bars(t):
    """Daily (date_iso, close) pairs for the last ten days, oldest first."""
    hist = t.history(period="10d", interval="1d", auto_adjust=False)
    if hist is None or len(hist) == 0:
        return []
    return [(idx.strftime("%Y-%m-%d"), v) for idx, v in hist["Close"].items()]


def fetch_quote(key, ticker, now=None, carried=None):
    try:
        t = yf.Ticker(ticker)
        info = t.fast_info
        now = now or datetime.now(timezone.utc)

        # Close AND previous close come from the daily bars (close_and_prev).
        # fast_info.previous_close is not used: it disagreed with the
        # exchange settle (see close_and_prev). _num() short-circuits
        # None/NaN/inf to None so downstream math never sees a poisoned value.
        # split_settle keeps an evening trade out of the close (2026-10-15).
        bars = _bars(t)
        sp = split_settle(key, bars, now, carried)
        close, prev, close_date, prev_date = sp["close"], sp["prev"], sp["close_date"], sp["prev_date"]
        live = _num(getattr(info, 'last_price', None))
        ref = sp.get("last", close)
        if sp.get("settled"):
            print(f"  NOTE {key} ({ticker}): bar {sp['last_date']} trade {sp['last']} kept as last; "
                  f"close {close} ({close_date}, {sp.get('close_kind')})"
                  + (f", settle of {sp['settle_pending']} not on record yet" if sp.get("settle_pending") else ""))
        if close is None and not bars:
            # No bars at all: the live quote is the only close there is, and
            # there is no previous close to measure a change against.
            close = live
        elif live is not None and ref and abs(live - ref) / abs(ref) > 0.0025:
            print(f"  NOTE {key} ({ticker}): last_price {live} differs from the last "
                  f"daily bar {close} ({close_date}); the bar pair is used")
        # 52-week range — available on fast_info, no slow .info() call needed
        wk52_hi = _num(getattr(info, 'year_high', None))
        wk52_lo = _num(getattr(info, 'year_low', None))

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
        wk52_lo, wk52_hi = widen_range(wk52_lo, wk52_hi, close)

        range_str = f"  52wk: {wk52_lo}–{wk52_hi}" if wk52_hi and wk52_lo else "  52wk: n/a"
        print(f"  OK   {key:14s} ({ticker:14s})  {close:>12.4f}  {net:+.4f}  {pct:+.2f}%{range_str}")

        out = {
            "ticker":    ticker,
            "close":     close,
            "open":      prev,
            "netChange": net,
            "pctChange": pct,
            "wk52_hi":   wk52_hi,
            "wk52_lo":   wk52_lo,
            # The sessions the two numbers belong to, so a reader (and
            # harvest_crosscheck) can match the change to an exchange settle.
            "close_date": close_date,
            "prev_date":  prev_date,
        }
        # Evening session (split_settle): close is a finished session's close;
        # the evening trade is `last`, at or before `last_time` (the fetch),
        # for trade date `last_date`, `last_net` from that close (None when
        # that close is not on record and settle_pending names its date).
        if sp.get("settled"):
            out["settled"] = True
            out["last"] = round(sp["last"], 5)
            out["last_time"] = now.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            out["last_date"] = sp["last_date"]
            out["last_net"] = sp["last_net"]
            if sp.get("settle_pending"):
                out["settle_pending"] = sp["settle_pending"]
        # Settle or last trade (2026-10-17). Only a "settle" close may be
        # called closed or settled anywhere on the site; a "last" close is a
        # trade as of close_time. settle / settle_date / settle_net are the
        # newest exchange settle on file, for text that says "settled".
        out["close_kind"] = sp.get("close_kind")
        if sp.get("close_time"):
            out["close_time"] = sp["close_time"]
        if sp.get("prev_kind"):
            out["prev_kind"] = sp["prev_kind"]
        if sp.get("settle") is not None:
            out["settle"] = round(sp["settle"], 5)
            out["settle_date"] = sp["settle_date"]
            out["settle_net"] = sp.get("settle_net")
        if sp.get("settles") or sp.get("day_last"):
            out["settles_v"] = SETTLES_V
            out["settles"] = sp.get("settles") or {}
            out["day_last"] = sp.get("day_last") or {}
        return out
    except Exception as e:
        print(f"  ERR  {key} ({ticker}): {e}")
        return None


# harvest-prices.json labels -> the dated prices.json key prefix.
_HARVEST_PREFIX = {"Corn": "corn", "Soybeans": "beans"}


def harvest_crosscheck(quotes, harvest):
    """Compare each dated quote's previous close with the CBOT settle that
    fetch_harvest_prices.py recorded for the same contract and date.

    `harvest` is data/harvest-prices.json loaded. Contract "Dec '26" for Corn
    maps to quotes["corn-dec26"]. Only a quote whose prev_date appears in that
    contract's projected or harvest series is compared. Returns a list of
    mismatch strings (settles in dollars x 100 = cents; tolerance a tenth of a
    cent). Pure function; selftested in scripts/test_prev_close.py.
    """
    out = []
    for c in (harvest or {}).get("commodities", []):
        prefix = _HARVEST_PREFIX.get(c.get("label"))
        contract = str(c.get("contract", ""))
        parts = contract.replace("'", " ").split()
        if not prefix or len(parts) != 2:
            continue
        key = f"{prefix}-{parts[0].lower()}{parts[1]}"
        q = quotes.get(key)
        if not isinstance(q, dict) or not q.get("prev_date") or q.get("open") is None:
            continue
        for leg in ("projected", "harvest"):
            for row in (c.get(leg) or {}).get("series") or []:
                if row.get("d") == q["prev_date"] and row.get("s") is not None:
                    settle = round(float(row["s"]) * 100, 4)
                    if abs(settle - float(q["open"])) > 0.1:
                        out.append(f"{key}: previous close {q['open']} on {q['prev_date']} "
                                   f"but the CBOT settle in harvest-prices.json is {settle}")
    return out


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
        old_fetched = existing.get("fetched")
    except Exception:
        old_quotes = {}
        old_fetched = None

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
        carried = carried_settles(key, old_quotes.get(key), old_fetched)
        for ticker in cands:
            result = fetch_quote(key, ticker, carried=carried)
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
            print(f"    - {k}  (past last trading day)")

    rolls = mark_rolls(quotes, SYMBOLS)
    if rolls:
        print("\n  ROLL WINDOW: " + ", ".join(
            f"{c} (front rolled off {v['rolled_off']}, expired {v['expired']})"
            for c, v in rolls.items()))

    nearby = add_nearby(quotes, SYMBOLS)
    pinned = pin_continuous(quotes, nearby, stale_keys)
    if pinned:
        print("  FRONT: continuous " + ", ".join(f"{r} -> {nearby[r]['key']}" for r in pinned))

    # Cross-check the previous close against the settles fetch_harvest_prices
    # recorded for the same contract and day. Reported, never "repaired": the
    # two writers run on different schedules, so a miss is for a human.
    try:
        with open("data/harvest-prices.json") as f:
            for _m in harvest_crosscheck(quotes, json.load(f)):
                print(f"::warning title=previous close disagrees with the settle::{_m}")
    except FileNotFoundError:
        pass

    withheld_keys = unit_guard(quotes)
    for _k, _why in withheld_keys.items():
        print(f"  WITHHELD {_k}: {_why}")
    spreads = class_spreads(quotes)
    for _k, _v in spreads.items():
        print(f"  SPREAD {_k}-wheat: {_v.get('cents')} ({_v.get('basis') or _v.get('reason')})")

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
        # Quotes left out because they arrived outside the unit the page
        # prints (UNIT_RANGE). Named with the reason, never silently dropped.
        "withheld_keys": withheld_keys,
        # KC HRW and MGEX HRS minus Chicago SRW, cents per bushel. See
        # class_spreads(): a same-month pair before first notice day, or a reason.
        "spreads":    spreads,
        # Corn/bean planting ratio on the planting year's contracts
        # (planting_year: next year's after the September roll), so every
        # page divides the same two quotes and names them.
        "planting_ratio": planting_ratio(quotes, datetime.now(timezone.utc).date()),
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
              f"{STALE_ALERT_DAYS}d) — check the ticker in SYMBOLS / GRAIN_CURVES:")
        for k, tk, d in expired_suspects:
            print(f"       {k:14s} {tk:14s}  stale {d:.1f}d")
    print(f"\nDone: {ok} fetched, {fail} failed, {len(stale_keys)} preserved-stale \u2192 data/prices.json updated")
    if ok == 0:
        print("WARNING: All fetches failed — prices.json unchanged from seed")
        sys.exit(1)


if __name__ == "__main__":
    main()
