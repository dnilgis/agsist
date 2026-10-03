#!/usr/bin/env python3
"""test_class_spreads.py — offline selftest for fetch_prices.class_spreads()
and fetch_prices.unit_guard() (2026-10-03, wave1-C).

Synthetic quotes, frozen clock, hand-worked answers. Run:
    python3 scripts/test_class_spreads.py
"""
import sys
from datetime import datetime, timezone

sys.path.insert(0, "scripts")
from fetch_prices import class_spreads, unit_guard, SYMBOLS

T = lambda y, m, d: datetime(y, m, d, 13, 0, tzinfo=timezone.utc)


def q(close, **kw):
    d = {"ticker": "X", "close": close, "open": close, "netChange": 0.0, "pctChange": 0.0}
    d.update(kw)
    return d


def main():
    ok = True

    def chk(cond, msg):
        nonlocal ok
        print(("  OK   " if cond else "  FAIL ") + msg)
        if not cond:
            ok = False

    print("test_class_spreads selftest")
    now = T(2026, 10, 3)

    # 1. Same month wins over the continuous pair. KC Dec 734.50 - Chicago Dec
    #    683.00 = +51.50. The continuous pair (740 - 683 = 57) must be ignored.
    quotes = {"kcwheat": q(740.0), "wheat": q(683.0),
              "kcwheat-dec26": q(734.5), "wheat-dec26": q(683.0),
              "kcwheat-mar27": q(750.0), "wheat-mar27": q(700.0)}
    s = class_spreads(quotes, now)
    chk(s["kcwheat"]["cents"] == 51.5, "KC-Chicago Dec = 734.50 - 683.00 = 51.5")
    chk(s["kcwheat"]["basis"] == "same-month", "flagged same-month")
    chk(s["kcwheat"]["month"] == "Dec '26", "names Dec '26, the nearest common month")

    # 2. Dec expired (Dec 15 rule) -> Mar pair: 750 - 700 = 50.
    s = class_spreads(quotes, T(2026, 12, 16))
    chk(s["kcwheat"]["cents"] == 50.0 and s["kcwheat"]["month"] == "Mar '27",
        "after Dec 15 the Mar pair is used: 750 - 700 = 50")

    # 3. A stale dated leg is not a price: fall back to continuous, flagged.
    quotes2 = {"kcwheat": q(740.0), "wheat": q(683.0),
               "kcwheat-dec26": q(734.5, stale=True), "wheat-dec26": q(683.0)}
    s = class_spreads(quotes2, now)
    chk(s["kcwheat"]["cents"] == 57.0, "stale KC Dec -> continuous 740 - 683 = 57")
    chk(s["kcwheat"]["basis"] == "most-active" and s["kcwheat"]["month"] is None,
        "and says the months are not confirmed")

    # 4. Chicago in a roll window and no dated pair: no number, a reason.
    quotes3 = {"kcwheat": q(740.0), "wheat": q(683.0, roll=True)}
    s = class_spreads(quotes3, now)
    chk(s["kcwheat"]["cents"] is None and "roll" in s["kcwheat"]["reason"],
        "roll window without a dated pair -> None with the reason")

    # 5. No spring wheat quote at all (the state of prices.json today).
    s = class_spreads({"wheat": q(683.0)}, now)
    chk(s["mplswheat"]["cents"] is None and "MGEX HRS" in s["mplswheat"]["reason"],
        "no MGEX quote -> None, reason names MGEX HRS")

    # 6. Unit guard: cotton at 66.5 (cents/lb) stays; rice at 1350 (cents/cwt,
    #    not the dollars the page prints) is held back with a reason.
    qs = {"cotton": q(66.5), "rice": q(1350.0), "corn": q(500.0)}
    w = unit_guard(qs)
    chk("cotton" in qs and "rice" not in qs, "cotton 66.5 kept, rice 1350 dropped")
    chk("rice" in w and "1350" in w["rice"] and "dollars per cwt" in w["rice"],
        "and the reason names the close and the unit")
    chk("corn" in qs and "corn" not in w, "keys outside UNIT_RANGE are untouched")
    qs = {"rice": q(13.27)}
    chk(unit_guard(qs) == {} and "rice" in qs, "rice at 13.27 dollars per cwt is kept")

    # 7. The symbols the page reads are actually requested.
    for k in ("kcwheat", "mplswheat", "cotton", "rice", "oats", "kcwheat-dec26"):
        chk(k in SYMBOLS, f"SYMBOLS requests {k}")

    print("SELFTEST OK" if ok else "SELFTEST FAILED")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
