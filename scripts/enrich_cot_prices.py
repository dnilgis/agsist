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
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass

import json
import os
import sys
import datetime as dt

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.normpath(os.path.join(HERE, "..", "data"))
HIST_PATH = os.path.join(DATA, "cot-history.json")
CUR_PATH = os.path.join(DATA, "cot.json")

# COT commodity key -> yfinance front-month continuous symbol.
# Units differ by complex (cents/bu grains, cents/lb livestock, $/cwt milk) but
# the /cot divergence math uses only direction + percentile, so units are fine
# as long as each series is internally consistent.
# NOTE: MGEX/MIAX spring wheat (MW=F) is not always carried by Yahoo; if it
# returns nothing the record is simply left without a price (handled below) and
# the COT positioning still shows — only the price-divergence overlay is blank.
SYMBOLS = {
    "corn":         "ZC=F",
    "beans":        "ZS=F",
    "wheat":        "ZW=F",   # SRW / Chicago
    "kcwheat":      "KE=F",   # HRW / Kansas City
    "mplswheat":    "MWE=F",  # HRS / Minneapolis (Yahoo coverage unreliable since MGEX->MIAX; failure handled gracefully below)
    "soymeal":      "ZM=F",
    "soyoil":       "ZL=F",
    "livecattle":   "LE=F",
    "feedercattle": "GF=F",
    "leanhogs":     "HE=F",
    "milk":         "DC=F",   # Class III milk
}


# PRICES THAT ARE WITHHELD ARE NOT WRITTEN. cot_analysis.UNREPAIRED_ROLL names
# the markets whose roll rule is not verified (lean hogs). Writing their raw
# front-month close here put the roll steps (-14.6%, -15.8% in a week) on the
# /cot chart overlay beside a method note saying no hogs price is shown. One
# list, imported, so the analysis and this file cannot disagree.
sys.path.insert(0, HERE)
try:
    from cot_analysis import UNREPAIRED_ROLL
except Exception as _e:                      # never let an import break the run silently
    print("[enrich_cot_prices] WARN: could not import UNREPAIRED_ROLL (%s); withholding leanhogs" % _e)
    UNREPAIRED_ROLL = {"leanhogs": "roll rule not verified"}


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


# ── THE REPORT-DAY CLOSE OF EACH DATED CONTRACT (Nov 4, 2026) ────────────
# "Since Oct 27" on the home COT card compared the continuous front month (ZS=F,
# still Nov '26) while every headline on the site had rolled to Jan '27 at first
# notice (#320). The card now compares the headline contract with ITSELF: its close
# today against its close on the report Tuesday. So each market in cot.json carries
# `px_by_contract` {"ZSF27.CBT": 1245.5, ...}: the report-Tuesday close of the next
# few dated contracts from the report month on (the headline today and after any
# roll before the next report: corn Dec '26 to Mar '27 on Nov 30). Which contracts
# exist comes from data/prices.json, the file the page compares against. A contract
# Yahoo does not answer for is left out, and the page then prints nothing for it.
COT_TO_PRICES = {"corn": "corn", "beans": "beans", "wheat": "wheat", "kcwheat": "kcwheat",
                 "soymeal": "meal", "soyoil": "soyoil", "livecattle": "cattle",
                 "feedercattle": "feeders", "leanhogs": "hogs", "milk": "milk"}
PRICES_PATH = os.path.join(DATA, "prices.json")
_FCODE = "FGHJKMNQUVXZ"
_DATED = __import__("re").compile(r"^[A-Z]{2,3}([FGHJKMNQUVXZ])(\d{2})\.[A-Z]{3}$")
CONTRACTS_AHEAD = 3


def dated_tickers(quotes, prefix, report_date, ahead=CONTRACTS_AHEAD):
    """The first `ahead` dated tickers for a market from the report month on, in
    month order, read from the price file's <prefix>-<mon><yy> keys."""
    rd = dt.date.fromisoformat(report_date)
    floor = rd.year * 12 + rd.month - 1
    seen = {}
    for k, q in (quotes or {}).items():
        if not isinstance(q, dict) or not k.startswith(prefix + "-"):
            continue
        m = _DATED.match(str(q.get("ticker") or ""))
        if not m:
            continue
        ym = (2000 + int(m.group(2))) * 12 + _FCODE.index(m.group(1))
        if ym >= floor:
            seen[q["ticker"]] = ym
    return [t for t, _ in sorted(seen.items(), key=lambda kv: kv[1])][:ahead]


def contract_closes(quotes, prefix, report_date, fetch=None):
    """{ticker: report-Tuesday close} for the next dated contracts. fetch(symbol,
    start, end) -> {date: close} (fetch_daily by default). A failed or empty fetch
    leaves that ticker out; nothing is guessed."""
    fetch = fetch or fetch_daily
    out = {}
    for t in dated_tickers(quotes, prefix, report_date):
        try:
            p = snap_price(fetch(t, report_date, report_date), report_date)
        except Exception as e:
            log("  WARN: %s close for %s failed: %s" % (t, report_date, str(e)[:120]))
            continue
        if p is not None:
            out[t] = p
    return out


def selftest():
    q = {"beans": {"ticker": "ZS=F", "close": 1194.25},
         "beans-nov26": {"ticker": "ZSX26.CBT", "close": 1194.25},
         "beans-nov": {"ticker": "ZSX26.CBT", "close": 1194.25},
         "beans-jan27": {"ticker": "ZSF27.CBT", "close": 1206.25},
         "beans-mar27": {"ticker": "ZSH27.CBT", "close": 1212.75},
         "beans-may27": {"ticker": "ZSK27.CBT", "close": 1221.5},
         "beans-sep26": {"ticker": "ZSU26.CBT", "close": 1100.0},
         "beans-nearby": {"ticker": "ZSF27.CBT", "close": 1206.25},
         "corn-dec26": {"ticker": "ZCZ26.CBT", "close": 442.0}}
    t = dated_tickers(q, "beans", "2026-10-27")
    assert t == ["ZSX26.CBT", "ZSF27.CBT", "ZSH27.CBT"], t          # Sep '26 is past; one Nov even with two keys
    asked = []
    def fake(sym, a, b):
        asked.append(sym)
        if sym == "ZSH27.CBT":
            raise RuntimeError("no data")
        return {"2026-10-26": 1.0, "2026-10-27": {"ZSX26.CBT": 1229.25, "ZSF27.CBT": 1245.5}[sym]}
    got = contract_closes(q, "beans", "2026-10-27", fetch=fake)
    assert got == {"ZSX26.CBT": 1229.25, "ZSF27.CBT": 1245.5}, got     # a failed contract is left out
    # a holiday Tuesday snaps to the trading day before
    got = contract_closes(q, "corn", "2026-11-24", fetch=lambda s, a, b: {"2026-11-23": 440.0})
    assert got == {"ZCZ26.CBT": 440.0}, got      # Dec '26 is still ahead of a Nov report; holiday snaps back
    print("enrich_cot_prices selftest: ok")
    return 0


def main():
    if "--selftest" in sys.argv[1:]:
        return selftest()
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
        if k in UNREPAIRED_ROLL:
            log("  %s: price withheld (%s)" % (k, UNREPAIRED_ROLL[k][:60]))
            for r in rows:
                r.pop("price", None)
            continue
        log("fetching %s (%s) ..." % (k, sym))
        try:
            daily = fetch_daily(sym, start, end)
        except Exception as e:
            # One unavailable symbol (e.g. MPLS spring wheat on Yahoo) must NOT
            # abort the whole job. Leave that commodity without a price -- its COT
            # positioning still renders, only the price-divergence overlay is blank.
            log("  WARN: %s (%s) price fetch failed: %s -- leaving without price" % (k, sym, e))
            for r in rows:
                r.pop("price", None)
            missing_total += len(rows)
            continue
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
            if k in cur and k in UNREPAIRED_ROLL and isinstance(cur[k], dict):
                cur[k].pop("price", None)
                cur[k].pop("price_prev", None)
                continue
            if k in cur and rows:
                if rows[-1].get("price") is not None:
                    cur[k]["price"] = rows[-1]["price"]
                if len(rows) >= 2 and rows[-2].get("price") is not None:
                    cur[k]["price_prev"] = rows[-2]["price"]
        # the report-Tuesday close of each dated contract (see contract_closes)
        quotes = {}
        try:
            quotes = (load_json(PRICES_PATH) or {}).get("quotes") or {}
        except Exception as e:
            log("  WARN: %s unreadable (%s); no per-contract closes" % (PRICES_PATH, e))
        rd = None
        for k in SYMBOLS:
            rows = history.get(k, [])
            if rows:
                rd = max(rd or "", rows[-1]["date"])
        for k, pfx in COT_TO_PRICES.items():
            if k not in cur or not isinstance(cur[k], dict):
                continue
            cur[k].pop("px_by_contract", None)
            if k in UNREPAIRED_ROLL or not rd or not quotes:
                continue
            rows = history.get(k, [])
            if not rows or rows[-1]["date"] != rd:
                continue
            px = contract_closes(quotes, pfx, rd)
            if px:
                cur[k]["px_by_contract"] = px
                cur[k]["px_date"] = rd
                log("  %s: %d dated contract closes for %s" % (k, len(px), rd))
        save_json(CUR_PATH, cur)
        log("wrote", CUR_PATH)

    if missing_total:
        log("WARN: %d total unmatched dates (left without price)" % missing_total)
    log("done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
