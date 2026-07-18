#!/usr/bin/env python3
"""
contract_calendar.py — ONE definition of "is this contract dead yet".

WHY THIS FILE EXISTS
  On 2026-07-15 the daily briefing was blocked from sending. The cause was not
  a data outage: it was that this rule existed in TWO places and they disagreed
  by one day.

      preflight_prices._expired :  now > (yr, mon, 15)        -> dead on the 15th
      generate_daily._front_expired: (yr, mon, 16) <= today   -> dead on the 16th

  They agreed on 364 days a year. On the 15th of a contract month, preflight
  repaired the feed to September while generate locked July -- a contract that
  had stopped trading the previous day. The briefing was written about a corpse:
  it reported wheat "breaking" below $6.25 off a dead $6.15 July contract while
  live September wheat was $6.63 and UP on the day. Same market, opposite story.
  The locked-drift gate caught it. Nothing else would have.

  fetch_prices.py was about to become the THIRD copy of this rule. So instead:
  every script imports from here. If this rule is wrong, it is wrong once, in
  one place, and every consumer is wrong together and visibly -- which is
  survivable. Two copies quietly disagreeing is not.

THE RULE
  CBOT grain last trading day is the business day BEFORE the 15th calendar day
  of the contract month. So from the 15th onward the contract is done. We treat
  a dated contract as expired from the 15th of its contract month.

  This is deliberately a hair CONSERVATIVE: on the 14th (the true last trading
  day) we still consider it live. That errs toward the contract everyone is
  still quoting, and it matches what preflight has always done -- and preflight
  writes the feed, so preflight is the authority. If this ever needs to change,
  change it HERE and every consumer moves together.

USAGE
    from contract_calendar import is_expired, front_key
    if is_expired("corn-jul26"): ...
    k = front_key(["corn-jul26", "corn-sep26"])   # -> "corn-sep26" on Jul 15+

  Run `python scripts/contract_calendar.py` to execute the selftest.
"""

from datetime import datetime, timezone

__all__ = ["is_expired", "front_key", "month_num", "EXPIRY_DAY"]

EXPIRY_DAY = 15   # dead from the 15th of the contract month, inclusive

_MONTH = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}


def month_num(mon3):
    """'jul' -> 7. None if not a month name."""
    return _MONTH.get(str(mon3).strip().lower()[:3])


def _parse(key):
    """'corn-jul26' -> (2026, 7). None for undated keys like 'corn' or
    benchmark aliases like 'corn-dec' / 'beans-nov' (no year suffix)."""
    suffix = str(key).split("-")[-1]
    mon = _MONTH.get(suffix[:3].lower())
    if mon is None:
        return None
    yr2 = suffix[3:]
    if not yr2.isdigit() or len(yr2) != 2:
        return None            # 'corn-dec' alias: month but no year -> undated
    return 2000 + int(yr2), mon


def is_expired(key, now=None):
    """True if this dated contract key is past its last trading day.

    Undated keys ('corn', 'corn-dec', 'beans-nov', 'cattle') are NEVER expired:
    they are continuous series or rolling benchmark aliases, not a fixed month.
    """
    p = _parse(key)
    if p is None:
        return False
    yr, mon = p
    now = now or datetime.now(timezone.utc)
    return (now.year, now.month, now.day) >= (yr, mon, EXPIRY_DAY)


def front_key(keys, now=None):
    """First non-expired key, in the order given. None if all are expired.

    Order is the caller's responsibility: pass the ladder nearest-first.
    """
    for k in keys:
        if not is_expired(k, now):
            return k
    return None


def _selftest():
    ok = True

    def chk(cond, msg):
        nonlocal ok
        print(("  OK   " if cond else "  FAIL ") + msg)
        if not cond:
            ok = False

    T = lambda y, m, d: datetime(y, m, d, 13, 0, tzinfo=timezone.utc)

    print("contract_calendar selftest")

    # --- the exact boundary that broke the 2026-07-15 briefing --------------
    chk(is_expired("corn-jul26", T(2026, 7, 15)) is True, "corn-jul26 dead on Jul 15 (the bug day)")
    chk(is_expired("corn-jul26", T(2026, 7, 14)) is False, "corn-jul26 live on Jul 14 (last trading day)")
    chk(is_expired("corn-jul26", T(2026, 7, 16)) is True, "corn-jul26 dead on Jul 16")
    chk(is_expired("corn-sep26", T(2026, 7, 15)) is False, "corn-sep26 live on Jul 15")

    # --- undated keys are never expired -------------------------------------
    for k in ("corn", "beans", "wheat", "cattle", "bitcoin", "corn-dec", "beans-nov"):
        chk(is_expired(k, T(2026, 12, 31)) is False, f"{k!r} never expires (continuous/alias)")

    # --- front_key picks the ladder correctly -------------------------------
    chk(front_key(["corn-jul26", "corn-sep26"], T(2026, 7, 15)) == "corn-sep26", "front rolls to sep on Jul 15")
    chk(front_key(["corn-jul26", "corn-sep26"], T(2026, 7, 14)) == "corn-jul26", "front stays jul on Jul 14")
    chk(front_key(["corn-jul26"], T(2026, 8, 1)) is None, "all-expired ladder -> None (never a stale fallback)")
    chk(front_key(["beans-jul26", "beans-aug26"], T(2026, 7, 17)) == "beans-aug26", "beans roll jul -> aug")
    chk(front_key(["wheat-jul26", "wheat-sep26"], T(2026, 7, 17)) == "wheat-sep26", "wheat roll jul -> sep")

    # --- year rollover -------------------------------------------------------
    chk(is_expired("corn-mar27", T(2026, 7, 15)) is False, "next-year contract live")
    chk(is_expired("corn-dec26", T(2027, 1, 2)) is True, "last-year contract dead")
    chk(is_expired("beans-jan27", T(2027, 1, 15)) is True, "jan27 dead on Jan 15 2027")
    chk(is_expired("beans-jan27", T(2027, 1, 14)) is False, "jan27 live on Jan 14 2027")

    # --- garbage in, False out (never crash a pipeline over a weird key) ----
    for k in ("", "corn-", "corn-xyz26", "corn-jul2", "corn-jul266", 12345):
        chk(is_expired(k, T(2026, 7, 15)) is False, f"unparseable key {k!r} -> not expired (no crash)")

    # --- the divergence that caused the outage cannot recur -----------------
    def old_generate_rule(key, now):
        p = _parse(key)
        if p is None:
            return False
        yr, mon = p
        return (yr, mon, 16) <= (now.year, now.month, now.day)

    mism = []
    for m in range(1, 13):
        for d in range(1, 29):
            t = T(2026, m, d)
            for mo in _MONTH:
                k = f"corn-{mo}26"
                if is_expired(k, t) != old_generate_rule(k, t):
                    mism.append((m, d, k))
    chk(len(mism) > 0, f"old generate rule differs from canon on {len(mism)} day/contract pairs "
                       f"(proves the bug was real)")
    days = sorted({d for _, d, _ in mism})
    chk(days == [EXPIRY_DAY], f"...and ONLY on day {days} of a contract month — the exact outage signature")

    print("SELFTEST OK" if ok else "SELFTEST FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(_selftest())
