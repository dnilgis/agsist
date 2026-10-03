#!/usr/bin/env python3
"""test_prev_close.py — offline selftest for fetch_prices.close_and_prev()
and fetch_prices.harvest_crosscheck() (2026-10-03, wave3-J).

Hand-worked bars, no network. Run:
    python3 scripts/test_prev_close.py
"""
import sys

sys.path.insert(0, "scripts")
import fetch_prices
from fetch_prices import close_and_prev, harvest_crosscheck

NAN = float("nan")


def main():
    ok = True

    def chk(cond, msg):
        nonlocal ok
        print(("  OK   " if cond else "  FAIL ") + msg)
        if not cond:
            ok = False

    print("test_prev_close selftest")

    # 1. The Oct 2 2026 Nov beans case. CBOT settles: Sep 30 1279.00 (made up
    #    for padding, never read), Oct 1 1284.00, Oct 2 1277.25 (both from
    #    harvest-prices.json: 12.84 and 12.7725). Change = 1277.25 - 1284.00
    #    = -6.75. fast_info said prev 1276.5, which printed +0.75.
    bars = [("2026-09-30", 1279.0), ("2026-10-01", 1284.0), ("2026-10-02", 1277.25)]
    close, prev, cd, pd = close_and_prev(bars)
    chk(close == 1277.25 and prev == 1284.0, "beans: close 1277.25, prev 1284.00 (second-to-last bar)")
    chk(round(close - prev, 2) == -6.75, "beans: change is -6.75, down, not +0.75")
    chk(cd == "2026-10-02" and pd == "2026-10-01", "dates name the two sessions")

    # 2. Dec corn the same day: 502.25 then 497.25 -> -5.00 (fast_info said -2.00).
    close, prev, _, _ = close_and_prev([("2026-10-01", 502.25), ("2026-10-02", 497.25)])
    chk((close, prev) == (497.25, 502.25), "corn: close 497.25, prev 502.25 -> -5.00")

    # 3. A NaN bar in the middle is skipped; prev is the last bar WITH a close.
    close, prev, cd, pd = close_and_prev([("2026-10-01", 502.25), ("2026-10-02", NAN),
                                          ("2026-10-05", 499.0)])
    chk((close, prev, pd) == (499.0, 502.25, "2026-10-01"), "NaN bar skipped: prev 502.25 from Oct 1")

    # 4. A trailing NaN bar (today's bar opened, no trade yet) does not become the close.
    close, prev, cd, _ = close_and_prev([("2026-10-01", 502.25), ("2026-10-02", 497.25),
                                         ("2026-10-05", None)])
    chk((close, prev, cd) == (497.25, 502.25, "2026-10-02"), "trailing empty bar ignored")

    # 5. One bar: a close and no previous close (the caller prints a flat day).
    chk(close_and_prev([("2026-10-02", 497.25)]) == (497.25, None, "2026-10-02", None),
        "one bar -> prev None")
    chk(close_and_prev([]) == (None, None, None, None), "no bars -> all None")

    # 6. harvest_crosscheck against the repo's harvest-prices shape.
    harvest = {"commodities": [
        {"label": "Corn", "contract": "Dec '26",
         "projected": {"series": []},
         "harvest": {"series": [{"d": "2026-10-01", "s": 5.0225}, {"d": "2026-10-02", "s": 4.9725}]}},
        {"label": "Soybeans", "contract": "Nov '26",
         "projected": {"series": []},
         "harvest": {"series": [{"d": "2026-10-01", "s": 12.84}, {"d": "2026-10-02", "s": 12.7725}]}},
    ]}
    good = {"corn-dec26": {"close": 497.25, "open": 502.25, "prev_date": "2026-10-01"},
            "beans-nov26": {"close": 1277.25, "open": 1284.0, "prev_date": "2026-10-01"}}
    chk(harvest_crosscheck(good, harvest) == [], "bar-pair prevs agree with the recorded settles")
    bad = {"corn-dec26": {"close": 497.25, "open": 499.25, "prev_date": "2026-10-01"},
           "beans-nov26": {"close": 1277.25, "open": 1276.5, "prev_date": "2026-10-01"}}
    m = harvest_crosscheck(bad, harvest)
    chk(len(m) == 2 and "1284.0" in m[1] and "1276.5" in m[1],
        "the old fast_info prevs (499.25, 1276.5) are both caught, naming the settle")
    chk(harvest_crosscheck({"beans-nov26": {"open": 1276.5}}, harvest) == [],
        "no prev_date -> not compared (old preserved quotes)")
    chk(harvest_crosscheck({"beans-nov26": {"open": 1276.5, "prev_date": "2026-09-30"}}, harvest) == [],
        "prev_date not in the series -> not compared")
    chk(harvest_crosscheck({"beans": {"open": 1276.5, "prev_date": "2026-10-01"}}, harvest) == [],
        "only the dated key of the matching contract is compared")

    # 7. fetch_quote end to end with a fake yfinance Ticker that carries the
    #    exact wrong fast_info of Oct 2 (previous_close 1276.5). The written
    #    quote must take open = 1284.0 from the bars, net -6.75.
    import pandas as pd

    class FakeInfo:
        last_price = 1277.25
        previous_close = 1276.5
        regular_market_previous_close = 1276.5
        year_high = 1335.25
        year_low = 1050.75

    class FakeTicker:
        def __init__(self, sym):
            self.fast_info = FakeInfo()

        def history(self, **kw):
            idx = pd.to_datetime(["2026-09-30", "2026-10-01", "2026-10-02"])
            return pd.DataFrame({"Close": [1279.0, 1284.0, 1277.25]}, index=idx)

    real = fetch_prices.yf.Ticker
    fetch_prices.yf.Ticker = FakeTicker
    try:
        q = fetch_prices.fetch_quote("beans-nov26", "ZSX26.CBT")
    finally:
        fetch_prices.yf.Ticker = real
    chk(q is not None and q["open"] == 1284.0 and q["netChange"] == -6.75,
        f"fetch_quote ignores fast_info.previous_close: open {q and q['open']}, net {q and q['netChange']}")
    chk(q is not None and q["prev_date"] == "2026-10-01" and q["close_date"] == "2026-10-02",
        "fetch_quote records the two session dates")

    print("SELFTEST OK" if ok else "SELFTEST FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
