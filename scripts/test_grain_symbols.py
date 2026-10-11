#!/usr/bin/env python3
"""test_grain_symbols.py: offline selftest for the generated grain curves in
fetch_prices.build_symbols() (2026-10-11).

No network: build_symbols is a pure function of the date. Run:
    python3 scripts/test_grain_symbols.py

What it pins:
  1. On 2026-10-11 the generated grain keys and the corn-dec / beans-nov
     aliases equal the hand list they replaced, live part, ticker for ticker.
     The only addition is wheat-sep27 (the hand list skipped it).
  2. The aliases roll the day the dated contract dies, and always point at a
     dated key in the same map.
  3. Day by day for three years: a key leaves the map only when its contract
     has expired (dnilgis/flashgrain and the pages read these keys, so one
     disappearing early is a break), and expired keys are never fetched live.
"""
import re
import sys
from datetime import date, datetime, timedelta, timezone

sys.path.insert(0, "scripts")
from fetch_prices import build_symbols, grain_curve_symbols, RETIRE_LOOKBACK_DAYS
from contract_calendar import is_expired, expiry_date

T = lambda y, m, d: datetime(y, m, d, 13, 0, tzinfo=timezone.utc)
ROOTS = ("corn", "beans", "wheat", "kcwheat")

# The hand list in fetch_prices.py SYMBOLS as of 2026-10-11, before it was
# generated. Expired entries (jul26, aug26, sep26) were already retired by
# main() and never written; they are kept here to show the comparison is
# against the real list.
HAND_2026_10_11 = {
    "corn-dec": "ZCZ26.CBT", "beans-nov": "ZSX26.CBT",
    "corn-jul26": "ZCN26.CBT", "corn-sep26": "ZCU26.CBT", "corn-dec26": "ZCZ26.CBT",
    "corn-mar27": "ZCH27.CBT", "corn-may27": "ZCK27.CBT", "corn-jul27": "ZCN27.CBT",
    "corn-sep27": "ZCU27.CBT", "corn-dec27": "ZCZ27.CBT", "corn-dec28": "ZCZ28.CBT",
    "beans-jul26": "ZSN26.CBT", "beans-aug26": "ZSQ26.CBT", "beans-sep26": "ZSU26.CBT",
    "beans-nov26": "ZSX26.CBT", "beans-jan27": "ZSF27.CBT", "beans-mar27": "ZSH27.CBT",
    "beans-may27": "ZSK27.CBT", "beans-jul27": "ZSN27.CBT", "beans-aug27": "ZSQ27.CBT",
    "beans-sep27": "ZSU27.CBT", "beans-nov27": "ZSX27.CBT", "beans-nov28": "ZSX28.CBT",
    "wheat-jul26": "ZWN26.CBT", "wheat-sep26": "ZWU26.CBT", "wheat-dec26": "ZWZ26.CBT",
    "wheat-mar27": "ZWH27.CBT", "wheat-may27": "ZWK27.CBT", "wheat-jul27": "ZWN27.CBT",
    "wheat-dec27": "ZWZ27.CBT",
    "kcwheat-dec26": "KEZ26.CBT", "kcwheat-mar27": "KEH27.CBT", "kcwheat-may27": "KEK27.CBT",
}


def grains(sym):
    return {k: v for k, v in sym.items() if "-" in k and k.split("-")[0] in ROOTS}


def live(sym, now):
    return {k: v for k, v in sym.items() if not is_expired(k, now)}


def main():
    ok = True

    def chk(cond, msg):
        nonlocal ok
        print(("  OK   " if cond else "  FAIL ") + msg)
        if not cond:
            ok = False

    print("test_grain_symbols selftest")

    # 1. the replaced hand list ------------------------------------------------
    now = T(2026, 10, 11)
    gen = grains(build_symbols(now))
    hand_live, gen_live = live(HAND_2026_10_11, now), live(gen, now)
    extra = {k: v for k, v in gen_live.items() if k not in hand_live}
    missing = {k: v for k, v in hand_live.items() if k not in gen_live}
    differ = {k: (hand_live[k], gen_live[k]) for k in hand_live if k in gen_live and hand_live[k] != gen_live[k]}
    chk(not missing, f"2026-10-11: every live hand-listed key is generated (missing={missing})")
    chk(not differ, f"2026-10-11: same ticker for every key (differ={differ})")
    chk(extra == {"wheat-sep27": "ZWU27.CBT"}, f"2026-10-11: only addition is wheat-sep27 (extra={extra})")
    gen_dead = sorted(set(gen) - set(gen_live))
    chk(gen_dead == ["beans-sep26", "corn-sep26", "wheat-sep26"],
        f"2026-10-11: expired keys listed only for retirement, the Sep '26 contracts ({gen_dead})")
    chk(gen["corn-dec"] == "ZCZ26.CBT" and gen["beans-nov"] == "ZSX26.CBT", "2026-10-11 aliases are Dec '26 / Nov '26")

    # 2. alias roll ------------------------------------------------------------
    chk(build_symbols(T(2026, 12, 14))["corn-dec"] == "ZCZ26.CBT", "corn-dec is Dec '26 on Dec 14 2026 (last trading day)")
    chk(build_symbols(T(2026, 12, 15))["corn-dec"] == "ZCZ27.CBT", "corn-dec rolls to Dec '27 on Dec 15 2026")
    chk(build_symbols(T(2026, 11, 14))["beans-nov"] == "ZSX26.CBT", "beans-nov is Nov '26 on Nov 14 2026")
    chk(build_symbols(T(2026, 11, 15))["beans-nov"] == "ZSX27.CBT", "beans-nov rolls to Nov '27 on Nov 15 2026")

    s = grains(build_symbols(T(2026, 12, 15)))
    chk(is_expired("corn-dec26", T(2026, 12, 15)) and "corn-dec26" in s,
        "Dec 15 2026: corn-dec26 still listed, so main() retires it by name and mark_rolls sees the roll")
    chk("corn-dec28" in s and "beans-nov28" in s, "Dec 15 2026: flashgrain's corn-dec28 / beans-nov28 still listed")
    chk(sorted(k for k in live(s, T(2026, 12, 15)) if k.startswith("kcwheat-")) ==
        ["kcwheat-jul27", "kcwheat-mar27", "kcwheat-may27"], "Dec 15 2026: KC rolls to Mar/May/Jul '27")

    s = grains(build_symbols(T(2027, 1, 1)))
    chk("corn-dec29" in s and "beans-nov29" in s and "wheat-dec28" in s and "wheat-dec29" not in s,
        "Jan 1 2027: horizon moves a year (corn Dec '29, beans Nov '29, wheat through Dec '28)")
    chk("corn-dec26" in s, "Jan 1 2027: corn-dec26 (dead Dec 15) still inside the retirement lookback")
    chk("corn-dec26" not in grains(build_symbols(T(2027, 1, 20))), "Jan 20 2027: corn-dec26 past the lookback and gone")

    s = grains(build_symbols(T(2027, 7, 15)))
    chk("corn-dec27" in s and "corn-jul28" in s, "Jul 15 2027: corn-dec27 and corn-jul28 are generated")

    # 3. three years, day by day ----------------------------------------------
    tick = re.compile(r"^(ZC|ZS|ZW|KE)[FGHJKMNQUVXZ]\d{2}\.CBT$")
    early, bad_tick, bad_alias, thin = [], [], [], []
    prev = None
    d = date(2026, 10, 11)
    while d <= date(2029, 12, 31):
        t = datetime(d.year, d.month, d.day, 13, tzinfo=timezone.utc)
        sym = build_symbols(t)
        g = grains(sym)
        for k, v in g.items():
            if not tick.match(v):
                bad_tick.append((d, k, v))
        for alias in ("corn-dec", "beans-nov"):
            dated = [k for k, v in g.items() if v == g[alias] and k != alias]
            if not dated or any(is_expired(k, t) for k in dated):
                bad_alias.append((d, alias, g[alias]))
        if prev is not None:
            for k in prev:
                if k not in g and not is_expired(k, t):
                    early.append((d, k))
        for root in ROOTS:
            n = sum(1 for k in g if k.startswith(root + "-") and not is_expired(k, t))
            if n < 3:
                thin.append((d, root, n))
        # nothing expired long ago lingers
        for k in g:
            exp = expiry_date(k)
            if exp and (d - exp.date()).days > RETIRE_LOOKBACK_DAYS:
                early.append((d, k + " (lingering)"))
        prev = g
        d += timedelta(days=1)
    chk(not early, f"2026-10-11..2029-12-31: no key leaves before it expires, none lingers ({early[:3]})")
    chk(not bad_tick, f"every ticker is ROOT+CODE+YY.CBT ({bad_tick[:3]})")
    chk(not bad_alias, f"corn-dec / beans-nov always equal a live dated key ({bad_alias[:3]})")
    chk(not thin, f"each root always has at least three live months ({thin[:3]})")

    # the generator does not touch the hand-listed curves
    chk(build_symbols(now)["cattle-oct26"] == "LEV26.CME", "livestock curves are untouched")
    chk(set(grain_curve_symbols(now)) <= set(build_symbols(now)), "grain_curve_symbols feeds build_symbols")

    print("SELFTEST OK" if ok else "SELFTEST FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
