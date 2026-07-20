#!/usr/bin/env python3
"""
test_mark_rolls.py — offline selftest for fetch_prices.mark_rolls().

Runs with NO network and NO yfinance installed (a stub module is injected
before import — mark_rolls is a pure function and never touches Yahoo).
Planted failure modes, per doctrine:
  1. The real 2026-07-17 case: corn-jul26 expired Jul 15 → corn tagged.
  2. Outside the window (Jul 20+): nothing tagged.
  3. Before expiry (Jul 14): nothing tagged.
  4. A crop with no dated key in window: untouched.
  5. Continuous key absent from quotes (failed fetch): rolls entry still
     written, no crash.
  6. Benchmark aliases (corn-dec) must NOT trigger a roll.

Run:  python3 scripts/test_mark_rolls.py   (exit 1 on any failure)
"""
import sys
import types
from datetime import datetime, timezone

# fetch_prices imports yfinance at module top; stub it so this test runs
# offline. mark_rolls never calls it.
sys.modules.setdefault("yfinance", types.ModuleType("yfinance"))

sys.path.insert(0, "scripts")
sys.path.insert(0, ".")
from fetch_prices import mark_rolls  # noqa: E402

SYMBOLS = {
    "corn": "ZC=F", "corn-dec": "ZCZ26.CBT", "beans": "ZS=F",
    "beans-nov": "ZSX26.CBT", "wheat": "ZW=F", "oats": "ZO=F",
    "corn-jul26": "ZCN26.CBT", "corn-sep26": "ZCU26.CBT",
    "beans-aug26": "ZSQ26.CBT", "wheat-sep26": "ZWU26.CBT",
}

T = lambda y, m, d: datetime(y, m, d, 13, 0, tzinfo=timezone.utc)
failures = []


def chk(cond, msg):
    print(("  OK   " if cond else "  FAIL ") + msg)
    if not cond:
        failures.append(msg)


print("mark_rolls selftest")

# 1. The real bug day: Jul 17, corn-jul26 expired Jul 15
q = {"corn": {"close": 444.75}, "beans": {"close": 1204.5}, "wheat": {"close": 683.0}}
rolls = mark_rolls(q, SYMBOLS, T(2026, 7, 17))
chk("corn" in rolls, "Jul 17: corn in roll window (the phantom -3.58% day)")
chk(rolls.get("corn", {}).get("rolled_off") == "jul26", "roll names the dead contract (jul26)")
chk(rolls.get("corn", {}).get("expired") == "2026-07-15", "roll carries the expiry date")
chk(q["corn"].get("roll") is True, "quotes.corn tagged roll:true in place")
chk("beans" not in rolls and "wheat" not in rolls, "beans/wheat untouched (their fronts didn't die)")
chk("roll" not in q["beans"] and "roll" not in q["wheat"], "beans/wheat quotes untagged")

# 2. Outside the window
q2 = {"corn": {"close": 450.0}}
rolls2 = mark_rolls(q2, SYMBOLS, T(2026, 7, 20))
chk(rolls2 == {}, "Jul 20: window closed, no rolls")
chk("roll" not in q2["corn"], "no tag outside window")

# 3. Before expiry
rolls3 = mark_rolls({"corn": {"close": 460.0}}, SYMBOLS, T(2026, 7, 14))
chk(rolls3 == {}, "Jul 14: contract still live, no roll")

# 4/6. Benchmark aliases never trigger — a SYMBOLS set with ONLY aliases
rolls4 = mark_rolls({"corn": {"close": 450.0}}, {"corn": "ZC=F", "corn-dec": "ZCZ26.CBT"}, T(2026, 7, 17))
chk(rolls4 == {}, "corn-dec alias alone never triggers a roll")

# 5. Continuous key missing from quotes (failed fetch) — no crash, roll still reported
q5 = {}
rolls5 = mark_rolls(q5, SYMBOLS, T(2026, 7, 16))
chk("corn" in rolls5 and q5 == {}, "roll reported even when corn quote failed; no crash")

# beans roll in its own month: beans-aug26 dies Aug 15 → beans tagged Aug 17
q6 = {"beans": {"close": 1100.0}, "corn": {"close": 430.0}}
rolls6 = mark_rolls(q6, SYMBOLS, T(2026, 8, 17))
chk("beans" in rolls6 and q6["beans"].get("roll") is True, "Aug 17: beans front (aug26) in roll window")

if failures:
    print(f"\nSELFTEST FAILED — {len(failures)} failure(s)")
    sys.exit(1)
print("\nSELFTEST OK")
