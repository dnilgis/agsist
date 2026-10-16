#!/usr/bin/env python3
"""test_nearby.py — offline selftest for fetch_prices.add_nearby().

Synthetic quotes, frozen clock. Run: python3 scripts/test_nearby.py
Guards the 2026-07-28 fix: continuous ZC=F tracked most-active Dec while
true nearby Sep sat 22c lower, so "Front Month" pages quoted December.
"""
import sys
from datetime import datetime, timezone

sys.path.insert(0, "scripts")
from fetch_prices import add_nearby, _month_label, build_symbols, planting_year, planting_ratio
from datetime import date

T = lambda y, m, d: datetime(y, m, d, 13, 0, tzinfo=timezone.utc)

# The symbol map is generated from the calendar (fetch_prices.build_symbols),
# so each case reads the map AS OF its own date, the way a run on that date
# would. Reading today's SYMBOLS would make these cases change meaning as the
# calendar moves.
SYMBOLS_AT = build_symbols


def q(close, net=-1.0):
    return {"ticker": "X", "close": close, "open": close - net,
            "netChange": net, "pctChange": 0.1, "wk52_hi": None, "wk52_lo": None}


def main():
    ok = True

    def chk(cond, msg):
        nonlocal ok
        print(("  OK   " if cond else "  FAIL ") + msg)
        if not cond:
            ok = False

    print("test_nearby selftest")

    # --- the exact 2026-07-28 situation --------------------------------------
    quotes = {
        "corn": q(474.75), "corn-dec": q(474.75),
        "corn-sep26": q(452.50), "corn-mar27": q(490.0),
        "beans": q(1209.25), "beans-nov": q(1209.25),
        "beans-aug26": q(1205.25), "beans-sep26": q(1195.5),
        "wheat": q(654.75), "wheat-sep26": q(654.75), "wheat-dec26": q(672.25),
    }
    now = T(2026, 7, 28)
    nearby = add_nearby(quotes, SYMBOLS_AT(now), now)

    chk(quotes["corn-nearby"]["close"] == 452.50, "corn-nearby = Sep 452.50, not most-active Dec 474.75")
    chk(quotes["corn-nearby"]["alias_of"] == "corn-sep26", "corn-nearby alias_of corn-sep26")
    chk(nearby["corn"] == {"key": "corn-sep26", "label": "Sep '26"}, "nearby map names Sep '26")
    chk(quotes["beans-nearby"]["close"] == 1205.25, "beans-nearby = Aug (jul26 expired on Jul 28)")
    chk(quotes["wheat-nearby"]["close"] == 654.75, "wheat-nearby = Sep, agrees with continuous")

    # --- expiry boundary: on Sep 15 the Sep contract is dead ------------------
    # Real ladder: dec26 is a SYMBOLS dated key (audit 2026-07-29), so the roll
    # lands on Dec '26 — the true nearby — not Mar '27.
    quotes2 = {"corn-sep26": q(452.50), "corn-dec26": q(474.75), "corn-mar27": q(490.0)}
    n2 = add_nearby(quotes2, SYMBOLS_AT(T(2026, 9, 15)), T(2026, 9, 15))
    chk(n2["corn"]["key"] == "corn-dec26", "Sep 15: nearby rolls Sep -> Dec '26 (dated dec26 in ladder)")
    chk(quotes2["corn-nearby"]["contract"] == "Dec '26", "label follows the roll")

    # beans same boundary: sep26 dead on Sep 15 -> Nov '26, not Jan '27
    quotes2b = {"beans-sep26": q(1195.5), "beans-nov26": q(1209.25), "beans-jan27": q(1216.0)}
    n2b = add_nearby(quotes2b, SYMBOLS_AT(T(2026, 9, 15)), T(2026, 9, 15))
    chk(n2b["beans"]["key"] == "beans-nov26", "Sep 15: beans nearby rolls Sep -> Nov '26 (dated nov26 in ladder)")

    # fall-through guard: if dec26 is missing from QUOTES (fetch failed), the
    # ladder still finds the next dated contract instead of crashing or stalling.
    quotes2c = {"corn-sep26": q(452.50), "corn-mar27": q(490.0)}
    n2c = add_nearby(quotes2c, SYMBOLS_AT(T(2026, 9, 15)), T(2026, 9, 15))
    chk(n2c["corn"]["key"] == "corn-mar27", "Sep 15 with dec26 quote missing: falls through to Mar '27 (no crash)")

    # --- missing/unusable quotes are skipped, never crash ---------------------
    quotes3 = {"corn-sep26": {"close": None}, "corn-mar27": q(490.0)}
    n3 = add_nearby(quotes3, SYMBOLS_AT(T(2026, 7, 28)), T(2026, 7, 28))
    chk(n3["corn"]["key"] == "corn-mar27", "unusable nearest (close=None) falls through to next dated")

    quotes4 = {"corn": q(474.75)}          # continuous only — no dated at all
    n4 = add_nearby(quotes4, SYMBOLS_AT(T(2026, 7, 28)), T(2026, 7, 28))
    chk("corn" not in n4 and "corn-nearby" not in quotes4, "no dated contracts -> no alias, no crash")

    # --- undated benchmark aliases are never candidates -----------------------
    quotes5 = {"corn-dec": q(474.75), "corn-sep26": q(452.5)}
    n5 = add_nearby(quotes5, SYMBOLS_AT(T(2026, 7, 28)), T(2026, 7, 28))
    chk(n5["corn"]["key"] == "corn-sep26", "corn-dec (undated alias) ignored as nearby candidate")

    # --- every root with dated months gets one alias (2026-10-16) -------------
    # The corn page's wheat card read ZW=F (-10 1/2) while the wheat page read
    # ZWZ26 (-11 1/4): one contract, two quotes. Each card now reads the alias.
    now6 = T(2026, 10, 16)
    quotes6 = {"kcwheat": q(702.5), "kcwheat-dec26": q(701.5), "kcwheat-mar27": q(714.25),
               "meal": q(356.6), "meal-dec26": q(356.5), "oats-dec26": q(399.0),
               "soyoil-dec26": q(67.14), "feeders-oct26": q(343.7), "feeders-nov26": q(342.1),
               "hogs-oct26": q(75.55), "milk-oct26": q(15.32), "milk-nov26": q(17.49)}
    n6 = add_nearby(quotes6, SYMBOLS_AT(now6), now6)
    chk(quotes6["kcwheat-nearby"]["close"] == 701.5 and n6["kcwheat"]["label"] == "Dec '26",
        "kcwheat-nearby = KEZ26 701.5, not continuous KE=F 702.5")
    chk(quotes6["meal-nearby"]["close"] == 356.5, "meal-nearby = Dec '26 meal, the crush leg")
    chk(n6["feeders"]["key"] == "feeders-oct26" and n6["hogs"]["key"] == "hogs-oct26"
        and n6["milk"]["key"] == "milk-oct26" and n6["oats"]["key"] == "oats-dec26"
        and n6["soyoil"]["key"] == "soyoil-dec26", "livestock, milk, oats and oil name their month")
    chk("mplswheat" not in n6, "no MGEX months on file -> no alias")

    # --- label helper ----------------------------------------------------------
    chk(_month_label("wheat-dec27") == "Dec '27", "_month_label wheat-dec27")
    chk(_month_label("corn-dec") is None, "_month_label undated alias -> None")

    # planting ratio: this year's Nov/Dec until September corn goes off the
    # board (dead from Sep 15), next year's after (2026-10-09: 2.69 on the
    # '26 pair, 2.47 on the '27 pair).
    chk(planting_year(date(2026, 9, 14)) == 2026, "planting year: Sep 14 is still this year's crop")
    chk(planting_year(date(2026, 9, 15)) == 2027, "planting year: Sep 15 (Sep corn dead) switches to next year")
    chk(planting_year(date(2027, 3, 1)) == 2027, "planting year: March is this year's planting")
    pq = {"beans-nov26": {"close": 1292.25}, "corn-dec26": {"close": 480.5},
          "beans-nov27": {"close": 1263.5}, "corn-dec27": {"close": 511.75}}
    pr = planting_ratio(pq, date(2026, 10, 9))
    chk(pr["beans"] == "beans-nov27" and pr["corn"] == "corn-dec27", "Oct 9 2026 divides Nov '27 by Dec '27")
    chk(abs(pr["value"] - 1263.5 / 511.75) < 1e-4 and round(pr["value"], 2) == 2.47, "Oct 9 2026 ratio 2.47, not 2.69")
    chk(pr["label"] == "Nov '27 beans \u00f7 Dec '27 corn", "the label names both contracts")
    pa = planting_ratio(pq, date(2026, 8, 1))
    chk(pa["beans"] == "beans-nov26" and round(pa["value"], 2) == 2.69, "Aug 1 2026 still divides the '26 pair")
    pm = planting_ratio({"beans-nov27": {"close": 1263.5}}, date(2026, 10, 9))
    chk(pm["value"] is None and "corn-dec27" in pm["reason"], "a missing quote gives a reason, not a number")

    print("SELFTEST OK" if ok else "SELFTEST FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
