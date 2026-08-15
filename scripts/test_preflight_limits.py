#!/usr/bin/env python3
"""Selftest for the two holes found on 2026-08-08 in preflight_prices.py.

Both are regression-locked here because both shipped. On 2026-08-08 the gate
returned CLEAN on a feed that produced this published briefing:

    "Lean hogs had their biggest single-session gain in years, closing at
     $95.50, up 16.9%, while corn fell hard to $4.39."

Neither move happened. The fixture below is the real feed from that morning,
trimmed to the keys that matter.

  HOLE 1 (prior-close): the reconciliation compared only `close`. Yahoo had
  already rolled corn's close to September (439.00) while still carrying
  December's settle (464.25) as the prior close -- so close matched the dated
  contract exactly, rel==0, gate passed, and the briefing published -5.4%
  against September's real -0.62%.

  HOLE 2 (exchange limit): hogs, oats, milk and soyoil have no dated contracts
  in this feed, so there is nothing to reconcile them against. The exchange
  daily limit is an absolute bound that needs no reference contract.

Run: python scripts/test_preflight_limits.py     (exits non-zero on failure)
"""
import copy
import sys
from datetime import datetime, timezone

from preflight_prices import run, limit_for, LIMIT_EXPANDED, FRONT

# ── AS-OF PIN (added 2026-08-15 after this suite took the site down) ────────
# The fixture below is a snapshot of ONE MORNING, so every assertion about it
# must be evaluated AS OF that morning. Unpinned, `run()` defaults to
# datetime.now() and the suite silently changes meaning as the calendar moves.
# It did: on Saturday 2026-08-15 the fixture's `beans-aug26` expired under the
# CBOT grain rule (dead from the 15th of the contract month), `front_key`
# found no live beans contract in the fixture, and SIX assertions failed on a
# 'no-front' error that has nothing to do with what any of them test. This
# suite is GATE 0 in daily.yml, so a green production feed never got checked
# and the Saturday briefing never generated.
#
# Rule this encodes: a test built on a dated fixture pins the date. The one
# test here that already did (test_cattle_does_not_roll_early) was the only
# one that survived Aug 15.
AS_OF = datetime(2026, 8, 8, 7, 5, tzinfo=timezone.utc)

# The 2026-08-08 07:05Z feed, trimmed. Values are verbatim from data/prices.json
# as committed that morning. Schema note: "open" holds the PREVIOUS CLOSE.
FEED_2026_08_08 = {
    "fetched": "2026-08-08T07:05:19Z",
    "quotes": {
        # close agrees with corn-sep26 to the cent; only the prior close is stale
        "corn":       {"ticker": "ZC=F",       "close": 439.0,  "open": 464.25,
                       "netChange": -25.25, "pctChange": -5.4389},
        "corn-sep26": {"ticker": "ZCU26.CBT",  "close": 439.0,  "open": 441.75,
                       "netChange": -2.75,  "pctChange": -0.6225},
        "corn-dec":   {"ticker": "ZCZ26.CBT",  "close": 462.0,  "open": 464.25,
                       "netChange": -2.25,  "pctChange": -0.4847},
        "beans":      {"ticker": "ZS=F",       "close": 1156.5, "open": 1184.5,
                       "netChange": -28.0,  "pctChange": -2.3639},
        "beans-aug26": {"ticker": "ZSQ26.CBT", "close": 1156.5, "open": 1157.5,
                        "netChange": -1.0,  "pctChange": -0.0864},
        "cattle":      {"ticker": "LE=F",      "close": 231.7,  "open": 225.2,
                        "netChange": 6.5,   "pctChange": 2.8863},
        "cattle-aug26": {"ticker": "LEQ26.CME", "close": 231.7, "open": 231.3,
                         "netChange": 0.4,  "pctChange": 0.1729},
        # no dated hog contracts exist in the feed -- only the limit can see this
        "hogs":       {"ticker": "HE=F",       "close": 95.5,   "open": 81.675,
                       "netChange": 13.825, "pctChange": 16.9268},
        # clean: wheat rolled cleanly, both close and prior agree
        "wheat":      {"ticker": "ZW=F",       "close": 639.75, "open": 631.5,
                       "netChange": 8.25,   "pctChange": 1.3064},
        "wheat-sep26": {"ticker": "ZWU26.CBT", "close": 639.75, "open": 631.5,
                        "netChange": 8.25,  "pctChange": 1.3064},
    },
}

FAILURES = []


def check(label, condition, detail=""):
    if condition:
        print(f"  ok    {label}")
    else:
        print(f"  FAIL  {label} {detail}")
        FAILURES.append(label)


def codes(issues, sev=None):
    return {c for s, c, _ in issues if sev is None or s == sev}


def test_limit_table():
    print("limit table")
    check("dated curve keys inherit the parent limit",
          limit_for("corn-sep26") == LIMIT_EXPANDED["corn"])
    check("beans-nov inherits beans", limit_for("beans-nov") == LIMIT_EXPANDED["beans"])
    check("cattle-aug26 inherits cattle", limit_for("cattle-aug26") == LIMIT_EXPANDED["cattle"])
    check("instruments with no daily limit return None", limit_for("gold") is None)
    check("bitcoin has no daily limit", limit_for("bitcoin") is None)


def test_blocks_the_shipped_feed():
    print("check mode on the 2026-08-08 feed")
    passed, issues, _ = run(copy.deepcopy(FEED_2026_08_08), today=AS_OF, repair=False)
    check("gate BLOCKS (it returned CLEAN on 2026-08-08)", passed is False)
    check("prior-close contamination is reported", "prior-close" in codes(issues))
    check("exchange-limit violation is reported", "limit" in codes(issues))
    msgs = " ".join(m for _, _, m in issues)
    check("corn is named", "corn" in msgs)
    check("beans is named", "beans" in msgs)
    check("cattle is named", "cattle" in msgs)
    check("hogs is named", "hogs" in msgs)
    check("clean wheat is NOT flagged", "ZW=F" not in msgs)


def test_repair_produces_the_real_numbers():
    print("repair mode")
    passed, issues, data = run(copy.deepcopy(FEED_2026_08_08), today=AS_OF, repair=True)
    q = data["quotes"]
    check("repair resolves to a passing feed", passed is True)
    check("corn change becomes September's -2.75",
          q["corn"]["netChange"] == -2.75, f'got {q["corn"]["netChange"]}')
    check("corn pct becomes -0.6225",
          q["corn"]["pctChange"] == -0.6225, f'got {q["corn"]["pctChange"]}')
    check("corn close is untouched (it was already right)", q["corn"]["close"] == 439.0)
    check("beans change becomes -1.0", q["beans"]["netChange"] == -1.0)
    check("cattle change becomes +0.4", q["cattle"]["netChange"] == 0.4)
    check("the fabricated corn move is kept for audit under _orig",
          q["corn"]["_orig"]["netChange"] == -25.25)
    check("hogs is suppressed rather than published", q["hogs"]["close"] is None)
    check("hogs suppression is recorded", "hogs" in data.get("suppressed_keys", []))
    check("the fabricated hog move is kept for audit",
          q["hogs"]["_orig"]["pctChange"] == 16.9268)
    check("clean wheat is untouched", q["wheat"]["netChange"] == 8.25)


def test_repair_is_idempotent():
    print("idempotence")
    _, _, once = run(copy.deepcopy(FEED_2026_08_08), today=AS_OF, repair=True)
    passed, issues, _ = run(copy.deepcopy(once), today=AS_OF, repair=False)
    check("a repaired feed passes a second check", passed is True,
          f"issues={[c for _, c, _ in issues]}")


def test_no_false_positives():
    print("clean feed regression")
    clean = copy.deepcopy(FEED_2026_08_08)
    q = clean["quotes"]
    for cont, dated in (("corn", "corn-sep26"), ("beans", "beans-aug26"),
                        ("cattle", "cattle-aug26")):
        for fld in ("close", "open", "netChange", "pctChange"):
            q[cont][fld] = q[dated][fld]
    # a large but legal hog day: 2.375 against a 7.00 expanded limit
    q["hogs"].update({"close": 84.5, "open": 82.125,
                      "netChange": 2.375, "pctChange": 2.891})
    passed, issues, _ = run(clean, today=AS_OF, repair=False)
    check("a genuinely clean feed passes", passed is True,
          f"issues={[(s, c) for s, c, _ in issues]}")


def test_move_exactly_at_limit_is_legal():
    print("boundary")
    feed = copy.deepcopy(FEED_2026_08_08)
    # limit-down is a real thing that must never be blocked
    feed["quotes"]["hogs"].update({"close": 75.125, "open": 82.125,
                                   "netChange": -7.0, "pctChange": -8.52})
    _, issues, _ = run(feed, today=AS_OF, repair=False)
    hog_limit = [m for s, c, m in issues if c == "limit" and "hogs" in m]
    check("a move exactly AT the expanded limit is allowed", not hog_limit,
          f"got {hog_limit}")

    feed["quotes"]["hogs"].update({"close": 75.0, "open": 82.125,
                                   "netChange": -7.125, "pctChange": -8.68})
    _, issues, _ = run(feed, today=AS_OF, repair=False)
    hog_limit = [m for s, c, m in issues if c == "limit" and "hogs" in m]
    check("a move one tick BEYOND the limit is blocked", bool(hog_limit))


def test_optional_curve_absent_is_a_warning_not_a_block():
    """The new hogs/oats/feeders/meal/soyoil/milk curves must never be able to
    stop a send just because a ticker symbol was wrong. Until they are confirmed
    against a live response they are advisory; the limit gate covers them."""
    print("optional curves absent")
    feed = copy.deepcopy(FEED_2026_08_08)
    # make the provable failures go away so only the curve question is left
    q = feed["quotes"]
    for cont, dated in (("corn", "corn-sep26"), ("beans", "beans-aug26"),
                        ("cattle", "cattle-aug26")):
        for fld in ("close", "open", "netChange", "pctChange"):
            q[cont][fld] = q[dated][fld]
    q["hogs"].update({"close": 84.5, "open": 82.125,
                      "netChange": 2.375, "pctChange": 2.891})
    passed, issues, _ = run(feed, today=AS_OF, repair=False)
    warns = {c for s, c, _ in issues if s == "WARN"}
    fails = {c for s, c, _ in issues if s == "FAIL"}
    check("a missing optional curve does NOT block", passed is True, f"fails={fails}")
    check("it is reported as a warning", "no-front" in warns)
    check("corn/beans/wheat/cattle stay hard requirements",
          "corn" in FRONT and "cattle" in FRONT and "hogs" not in FRONT)


def test_optional_curve_present_repairs_instead_of_suppressing():
    """Once the curve arrives, the whole point: hogs keeps its real price and
    loses only the fabricated move, instead of being suppressed entirely."""
    print("optional curves present")
    feed = copy.deepcopy(FEED_2026_08_08)
    feed["quotes"]["hogs-aug26"] = {"ticker": "HEQ26.CME", "close": 95.5,
                                    "open": 94.9, "netChange": 0.6,
                                    "pctChange": 0.632}
    feed["quotes"]["hogs-oct26"] = {"ticker": "HEV26.CME", "close": 81.675,
                                    "open": 82.1, "netChange": -0.425,
                                    "pctChange": -0.518}
    passed, issues, data = run(feed, today=AS_OF, repair=True)
    h = data["quotes"]["hogs"]
    check("feed passes after repair", passed is True)
    check("hogs keeps its real August price", h["close"] == 95.5, f'got {h["close"]}')
    check("the fabricated +13.825 becomes the real +0.6",
          h["netChange"] == 0.6, f'got {h["netChange"]}')
    check("hogs is NOT suppressed once it can be verified",
          h.get("suppressed") is not True)
    check("the repair names its source", h.get("repaired_from") == "hogs-aug26")


def test_cattle_does_not_roll_early():
    """2026-08-08: cattle inherited the CBOT grain expiry rule, so from Aug 15
    the gate would reconcile August cattle against the OCTOBER contract and
    'repair' $231.70 to $225.275 -- about $90 a head."""
    print("cattle expiry rule")
    from contract_calendar import rule_for
    feed = copy.deepcopy(FEED_2026_08_08)
    feed["quotes"]["cattle-oct26"] = {"ticker": "LEV26.CME", "close": 225.275,
                                      "open": 225.2, "netChange": 0.075,
                                      "pctChange": 0.033}
    check("cattle is on the month-end calendar, not the grain one",
          rule_for("cattle-aug26") == "MONTH_END")
    aug15 = datetime(2026, 8, 15, 13, 0, tzinfo=timezone.utc)
    _, _, data = run(feed, today=aug15, repair=True)
    c = data["quotes"]["cattle"]
    check("on Aug 15 cattle still tracks August, not October",
          c["close"] == 231.7, f'got {c["close"]}')
    check("and it is repaired from the August contract",
          c.get("repaired_from") in (None, "cattle-aug26"),
          f'got {c.get("repaired_from")}')
    sep1 = datetime(2026, 9, 1, 13, 0, tzinfo=timezone.utc)
    _, _, data2 = run(copy.deepcopy(feed), today=sep1, repair=True)
    check("on Sep 1 it does roll to October",
          data2["quotes"]["cattle"].get("repaired_from") == "cattle-oct26",
          f'got {data2["quotes"]["cattle"].get("repaired_from")}')


def test_suite_does_not_depend_on_the_wall_clock():
    """THE 2026-08-15 REGRESSION. Six assertions in this file failed that
    Saturday — not because the gate broke, but because the fixture aged past
    an expiry boundary while the assertions were still reading the real clock.
    GATE 0 fails closed, so the daily briefing never generated.

    A dated fixture must produce the same verdict forever. This runs the
    clean-feed case at the pin, one day after the fixture's own front months
    die, and five years out; all three must agree. Delete the `today=AS_OF`
    pins above and this test fails immediately."""
    print("date independence (the 2026-08-15 outage)")
    clean = copy.deepcopy(FEED_2026_08_08)
    q = clean["quotes"]
    for cont, dated in (("corn", "corn-sep26"), ("beans", "beans-aug26"),
                        ("cattle", "cattle-aug26")):
        for fld in ("close", "open", "netChange", "pctChange"):
            q[cont][fld] = q[dated][fld]
    q["hogs"].update({"close": 84.5, "open": 82.125,
                      "netChange": 2.375, "pctChange": 2.891})

    baseline, _, _ = run(copy.deepcopy(clean), today=AS_OF, repair=False)
    check("clean feed passes at the as-of pin", baseline is True)

    # Aug 15 2026: the exact day it broke. beans-aug26 is expired now, so an
    # UNPINNED run finds no front beans contract and fails — pinned, it can't.
    from contract_calendar import is_expired
    aug15 = datetime(2026, 8, 15, 11, 22, tzinfo=timezone.utc)
    check("the fixture's beans contract IS dead by Aug 15 (the trigger)",
          is_expired("beans-aug26", aug15) is True)

    # Move the WALL CLOCK, not the argument. `run(today=...)` IS the pin, so
    # passing it a date proves nothing about clock-independence — the first cut
    # of this test looped over dates it never used and asserted two tautologies
    # (caught in the 2026-08-15 audit, same day it was written). Freezing
    # datetime.now() is the only way to exercise run()'s DEFAULT path.
    import preflight_prices as _pp

    def _frozen(when):
        class _Clock(datetime):
            @classmethod
            def now(cls, tz=None):
                return when
        return _Clock

    _real = _pp.datetime
    try:
        for label, when in (("Aug 15 2026", aug15),
                            ("five years on", datetime(2031, 8, 8, 7, 5, tzinfo=timezone.utc))):
            _pp.datetime = _frozen(when)
            pinned, issues, _ = run(copy.deepcopy(clean), today=AS_OF, repair=False)
            check(f"pinned verdict unchanged with the clock at {label}",
                  pinned is baseline, f"issues={[(s, c) for s, c, _ in issues]}")
            # ...and the same feed with NO pin really does break, which is both
            # the proof the pin is load-bearing and a replay of the outage.
            unpinned, _, _ = run(copy.deepcopy(clean), repair=False)
            check(f"UNPINNED run fails with the clock at {label} (the outage)",
                  unpinned is False)
    finally:
        _pp.datetime = _real

    check("the clock was restored after the freeze",
          _pp.datetime is _real)

    # Structural lock: no future edit may add an unpinned fixture call. This
    # catches the regression at the source rather than by symptom.
    import pathlib, re as _re
    _src = pathlib.Path(__file__).read_text()
    _body = _src.split("def test_suite_does_not_depend_on_the_wall_clock", 1)[0]
    _bad = [c for c in _re.findall(r"run\(\s*(?:copy\.deepcopy\([^)]*\)|\w+)[^)]*\)", _body)
            if "today=" not in c]
    check("every fixture-driven run() above passes an explicit today=",
          not _bad, f"unpinned: {_bad}")


if __name__ == "__main__":
    for t in (test_limit_table, test_blocks_the_shipped_feed,
              test_repair_produces_the_real_numbers, test_repair_is_idempotent,
              test_no_false_positives, test_move_exactly_at_limit_is_legal,
              test_optional_curve_absent_is_a_warning_not_a_block,
              test_optional_curve_present_repairs_instead_of_suppressing,
              test_cattle_does_not_roll_early,
              test_suite_does_not_depend_on_the_wall_clock):
        t()
    print()
    if FAILURES:
        print(f"FAILED {len(FAILURES)}: " + "; ".join(FAILURES))
        sys.exit(1)
    print("preflight limit/prior-close selftest: all passed")
