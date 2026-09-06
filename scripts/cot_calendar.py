#!/usr/bin/env python3
"""
cot_calendar.py — the two calendars /cot's forward returns depend on.

1. WHEN A REPORT WAS ACTUALLY PUBLISHED.
   Positions are as of Tuesday. CFTC publishes the following Friday at 3:30pm
   ET -- except when a federal holiday falls in the report week, and then, in
   CFTC's own words on the release schedule, "federal holidays may delay
   release by one or two days." That is roughly one week in seven.

   A pipeline that assumes Friday and measures a forward return from the
   Monday close is, in those weeks, using a price that printed BEFORE the
   report existed. It is the same look-ahead this page is built to avoid,
   hidden in the one place nobody checks.

2. WHEN THE FRONT MONTH ROLLS.
   Yahoo's continuous futures (ZC=F and friends) are spliced, not
   back-adjusted: on the day the front month changes, the series steps by the
   whole calendar spread. Corn's July-to-September roll is old crop to new
   crop and is routinely 20-50 cents on a 450-cent contract. A thirteen-week
   forward return crosses one or two of those, always at the same point in the
   calendar -- so the error does not average out, and it does not cancel
   between a conditional sample and its base rate, because positioning is
   seasonal too.

   Roll dates come from scripts/contract_calendar.py, which already carries
   the sourced CME/CBOT expiry rules this site uses everywhere else. Reusing
   it means the roll a price series is repaired for is the same roll the cash
   pages mark against.
"""

import calendar as _cal
import os
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    from contract_calendar import dead_from, rule_for   # noqa: F401
    HAVE_CALENDAR = True
except Exception:                                        # pragma: no cover
    HAVE_CALENDAR = False


# ── federal holidays ────────────────────────────────────────────────────────

def _nth_weekday(year, month, weekday, n):
    d = date(year, month, 1)
    d += timedelta(days=(weekday - d.weekday()) % 7)
    return d + timedelta(days=7 * (n - 1))


def _last_weekday(year, month, weekday):
    d = date(year, month, _cal.monthrange(year, month)[1])
    return d - timedelta(days=(d.weekday() - weekday) % 7)


def federal_holidays(year):
    """Observed US federal holidays. A holiday on Saturday is observed Friday,
    on Sunday the following Monday -- which is what actually closes the
    government office that publishes this report."""
    raw = [
        date(year, 1, 1),
        _nth_weekday(year, 1, 0, 3),          # MLK
        _nth_weekday(year, 2, 0, 3),          # Washington
        _last_weekday(year, 5, 0),            # Memorial
        date(year, 7, 4),
        _nth_weekday(year, 9, 0, 1),          # Labor
        _nth_weekday(year, 10, 0, 2),         # Columbus / Indigenous Peoples
        date(year, 11, 11),                   # Veterans
        _nth_weekday(year, 11, 3, 4),         # Thanksgiving
        date(year, 12, 25),
    ]
    if year >= 2021:
        raw.append(date(year, 6, 19))         # Juneteenth, federal from 2021
    out = set()
    for d in raw:
        if d.weekday() == 5:
            d -= timedelta(days=1)
        elif d.weekday() == 6:
            d += timedelta(days=1)
        out.add(d)
    return out


_HOL_CACHE = {}


def is_federal_holiday(d):
    y = d.year
    if y not in _HOL_CACHE:
        _HOL_CACHE[y] = federal_holidays(y)
    return d in _HOL_CACHE[y]


def next_business_day(d):
    d += timedelta(days=1)
    while d.weekday() > 4 or is_federal_holiday(d):
        d += timedelta(days=1)
    return d


def release_date(as_of):
    """The date CFTC published the report for this Tuesday as-of date.

    Base case: the Friday of the same week. Each federal holiday falling
    Monday-to-Friday of that week pushes it one business day, capped at two,
    which is the delay CFTC's own schedule note describes.
    """
    monday = as_of - timedelta(days=as_of.weekday())
    delay = sum(1 for i in range(5) if is_federal_holiday(monday + timedelta(days=i)))
    d = as_of + timedelta(days=3)                     # the Friday
    for _ in range(min(delay, 2)):
        d = next_business_day(d)
    while d.weekday() > 4 or is_federal_holiday(d):
        d = next_business_day(d)
    return d


def entry_date(as_of):
    """The first session close a reader of this report could have traded on.

    The report lands at 3:30pm ET. CBOT grains settled at 2:15pm ET; the
    livestock pits closed earlier still. So the release day's close is already
    gone. The next session's close is the first honest entry, and that is what
    this returns -- deliberately one full session later than the first
    tradable PRINT (the Sunday evening reopen for grains, Monday morning for
    livestock), so no study on this page can claim any part of the market's
    reaction to the release itself.
    """
    return next_business_day(release_date(as_of))


# ── roll dates ──────────────────────────────────────────────────────────────
# Listed contract months per market. Getting one of these wrong repairs a roll
# that did not happen and leaves one that did, so they are written out rather
# than inferred.
CONTRACT_MONTHS = {
    "corn":         [3, 5, 7, 9, 12],
    "beans":        [1, 3, 5, 7, 8, 9, 11],
    "wheat":        [3, 5, 7, 9, 12],
    "kcwheat":      [3, 5, 7, 9, 12],
    "mplswheat":    [3, 5, 7, 9, 12],
    "soymeal":      [1, 3, 5, 7, 8, 9, 10, 12],
    "soyoil":       [1, 3, 5, 7, 8, 9, 10, 12],
    "livecattle":   [2, 4, 6, 8, 10, 12],
    "feedercattle": [1, 3, 4, 5, 8, 9, 10, 11],
    "leanhogs":     [2, 4, 6, 7, 8, 10, 12],
    "milk":         list(range(1, 13)),
}
# COT key -> the family name contract_calendar.py keys its rules on.
_FAMILY = {
    "corn": "corn", "beans": "beans", "wheat": "wheat", "kcwheat": "kcwheat",
    "mplswheat": "mplswheat", "soymeal": "meal", "soyoil": "soyoil",
    "livecattle": "cattle", "feedercattle": "feeders", "leanhogs": "hogs",
    "milk": "milk",
}


def roll_dates(key, start, end):
    """Every date on which the front month for this market changes hands.

    Falls back to the grain rule (the business day before the 15th) if
    contract_calendar.py cannot be imported, which is the conservative
    direction: it repairs a day near the real roll rather than none at all.
    """
    months = CONTRACT_MONTHS.get(key, [3, 5, 7, 9, 12])
    fam = _FAMILY.get(key, key)
    rule = rule_for(fam) if HAVE_CALENDAR else "GRAIN"
    out = set()
    for y in range(start.year, end.year + 1):
        for m in months:
            if HAVE_CALENDAR:
                d = dead_from(y, m, rule)
            else:
                d = date(y, m, 15)
            if start <= d <= end + timedelta(days=40):
                out.add(d)
    return out


def roll_adjust(closes, key):
    """Return {date: index} — the same series with the splice steps removed.

    Method: chain the daily returns and drop the return across each roll. The
    level is an index, not a price, and is only ever used for percentage
    change; the quoted price the page prints stays the raw close.

    This is the honest repair available from a single spliced series. A true
    back-adjustment needs both contracts' closes on the roll date, which this
    feed does not carry. Dropping the roll return removes the spread step
    without inventing a number to replace it, at the cost of the one day of
    genuine market movement that shared it. One day in roughly sixty, against
    a 5-11% phantom move at every old-crop-to-new-crop roll.
    """
    if not closes:
        return {}
    days = sorted(closes)
    rolls = roll_dates(key, days[0], days[-1])
    out = {days[0]: 100.0}
    lvl = 100.0
    for i in range(1, len(days)):
        prev, cur = days[i - 1], days[i]
        a, b = closes[prev], closes[cur]
        crossed = any(prev < r <= cur for r in rolls)
        if a and b and a > 0 and not crossed:
            lvl *= (b / a)
        out[cur] = round(lvl, 6)
    return out


def selftest():
    fails = []

    def ck(name, got, want):
        ok = got == want
        print(f"{'PASS' if ok else 'FAIL'}  {name:56s} {got}" + ("" if ok else f"  -- want {want}"))
        if not ok:
            fails.append(name)

    # An ordinary week: Tue 2026-10-20, no federal holiday in it or after it.
    ck("ordinary week releases Friday", release_date(date(2026, 10, 20)), date(2026, 10, 23))
    ck("ordinary week entry is the Monday", entry_date(date(2026, 10, 20)), date(2026, 10, 26))

    # THE CASE THAT MOTIVATED THIS FILE. The week of Tue 2026-09-01 has no
    # holiday in it, so CFTC publishes on Friday Sep 4 as usual -- but the next
    # session is LABOR DAY. Assuming "Friday release, therefore Monday entry"
    # would have used a Monday close that did not exist.
    ck("no holiday in the report week -> Friday release", release_date(date(2026, 9, 1)), date(2026, 9, 4))
    ck("but Labor Day pushes the entry to Tuesday", entry_date(date(2026, 9, 1)), date(2026, 9, 8))

    # A holiday INSIDE the report week delays the release itself.
    ck("holiday week release slips", release_date(date(2026, 9, 8)), date(2026, 9, 14))
    ck("holiday week entry slips", entry_date(date(2026, 9, 8)), date(2026, 9, 15))
    ck("thanksgiving week release", release_date(date(2026, 11, 24)), date(2026, 11, 30))
    ck("release day that IS the holiday moves", release_date(date(2026, 12, 29)), date(2027, 1, 4))
    ck("entry is always after the release", entry_date(date(2026, 12, 29)) > release_date(date(2026, 12, 29)), True)

    ck("observed: Jul 4 2026 is a Saturday, observed Friday",
       is_federal_holiday(date(2026, 7, 3)), True)
    ck("Juneteenth was not federal in 2020", is_federal_holiday(date(2020, 6, 19)), False)
    ck("Juneteenth is federal from 2021", is_federal_holiday(date(2021, 6, 18)), True)

    # ── roll repair ──
    # A flat series with a single 20% splice ON the roll date. Raw carries the
    # step; repaired does not. Corn's grain rule puts the July roll on the 15th.
    rd = dead_from(2026, 7, "GRAIN") if HAVE_CALENDAR else date(2026, 7, 15)
    closes, d = {}, date(2026, 6, 1)
    while d <= date(2026, 8, 20):
        closes[d] = 100.0 * (1.20 if d >= rd else 1.0)
        d += timedelta(days=1)
    adj = roll_adjust(closes, "corn")
    days = sorted(adj)
    ck("raw series carries the 20% splice",
       round(closes[days[-1]] / closes[days[0]], 4), 1.2)
    ck("repaired series does not", round(adj[days[-1]] / adj[days[0]], 4), 1.0)
    ck("repair leaves the level positive", adj[days[-1]] > 0, True)

    # A series with no roll in it must come back untouched.
    flat = {date(2026, 2, 2) + timedelta(days=i): 100.0 * (1.01 ** i) for i in range(20)}
    fadj = roll_adjust(flat, "corn")
    fd = sorted(fadj)
    ck("no roll in range leaves the series alone",
       round(fadj[fd[-1]] / fadj[fd[0]], 4), round(flat[fd[-1]] / flat[fd[0]], 4))

    ck("corn rolls five times a year", len([m for m in CONTRACT_MONTHS["corn"]]), 5)
    ck("feeders are not on the grain rule",
       (rule_for("feeders") if HAVE_CALENDAR else "GRAIN") != "GRAIN", HAVE_CALENDAR)

    print()
    if fails:
        print(f"{len(fails)} check(s) failed: " + ", ".join(fails))
        return 1
    print("All checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(selftest())
