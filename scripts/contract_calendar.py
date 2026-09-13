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

ONE RULE WAS NOT ENOUGH (2026-08-08)
  Everything below was written for CBOT grains, and then `cattle-*` keys were
  added to the feed and silently inherited the grain rule. Live cattle does not
  expire on the 15th. CME Rule 10102.H: "Trading shall terminate on the last
  Business Day of the contract month." August cattle trades through August 31.

  So from Aug 15 this file would have reported cattle-aug26 dead while it was
  still the front month, preflight would have reconciled the August continuous
  against the OCTOBER contract, found a 2.85% disagreement, and "repaired" live
  cattle from $231.70 to $225.275. That is $6.42/cwt, about $90 a head -- the
  same error, in the same direction, as the front-month bug fixed on Aug 7,
  arriving by a different road. Caught in simulation on 2026-08-08, seven days
  before it would have fired.

  The lesson is not "fix cattle". It is that a single expiry rule cannot cover
  products on three different exchanges' calendars, and that adding a key to the
  feed silently opted it into whatever rule happened to be here. Rules are now
  per product family, and the selftest covers each one, so the next product
  added has to declare which calendar it is on.

THE RULES
  GRAIN (CBOT: corn, beans, wheat, KC/MPLS wheat, oats, meal, soyoil)
      Last trading day is the business day BEFORE the 15th calendar day of the
      contract month, so the contract is dead from the 15th onward.

  MONTH_END (CME live cattle, and the unverified default for livestock/dairy)
      "Trading shall terminate on the last Business Day of the contract month"
      -- CME Rule 10102.H. Dead from the 1st of the following month.

  LAST_THURSDAY (CME feeder cattle)
      "Trading shall terminate on the last Thursday of the contract month,
      except: the November contract shall terminate on the Thursday prior to
      Thanksgiving Day..." -- CME Rule 10202. Dead from the day after.

  All of these are deliberately a hair CONSERVATIVE: on the true last trading
  day we still consider the contract live. That errs toward the contract
  everyone is still quoting, which is the safe direction -- rolling EARLY is
  what produces a wrong price under a right label, and rolling early is the
  failure this file now exists to prevent in two flavours rather than one.

  Exchange holidays are not modelled. A holiday can only move a real last
  trading day EARLIER, so ignoring them can only ever make us hold a contract
  slightly longer, never roll early. Dead contracts stop updating and get
  flagged `stale` upstream, and every consumer already skips stale quotes.

NOT VERIFIED -- see the note by PRODUCT_RULE before trusting these
  Lean hogs and Class III milk are on MONTH_END because I could not retrieve
  their termination rule from an authoritative source, not because I confirmed
  it. Both are believed to terminate EARLIER than month end (hogs on the 10th
  business day is the widely quoted rule). MONTH_END is the conservative choice
  -- it holds too long rather than rolling early -- but it is a placeholder.

USAGE
    from contract_calendar import is_expired, front_key
    if is_expired("corn-jul26"): ...
    k = front_key(["corn-jul26", "corn-sep26"])   # -> "corn-sep26" on Jul 15+

  Run `python scripts/contract_calendar.py` to execute the selftest.
"""

import calendar
from datetime import datetime, timezone, date, timedelta

__all__ = ["is_expired", "front_key", "month_num", "EXPIRY_DAY",
           "expiry_date", "recent_expiry", "ROLL_WINDOW_DAYS",
           "PRODUCT_RULE", "rule_for", "dead_from",
           "is_trading_day", "holiday_name", "prior_trading_day",
           "next_trading_day", "sessions_between", "market_holidays"]

# How long after a dated contract dies we consider the continuous front-month
# to be "in the roll window". Yahoo's continuous series (ZC=F etc.) switches
# to the next contract at expiry, and its previous_close still belongs to the
# OLD contract — so the first post-roll session prints a phantom day-change
# (2026-07-17: corn "-3.58%" that was the July→September switch, not a
# selloff). 5 calendar days covers expiry mid-week plus a weekend before the
# first clean close of the new front month.
ROLL_WINDOW_DAYS = 5

EXPIRY_DAY = 15   # GRAIN rule: dead from the 15th of the contract month, inclusive

_MONTH = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}

# Which exchange calendar each product family is on. The key is the part of a
# feed key before the first '-', so 'cattle-aug26' -> 'cattle'.
#
# ADDING A PRODUCT: put it here explicitly. The default is GRAIN, which is
# correct for CBOT ags and wrong for everything else -- that silent default is
# exactly how cattle ended up rolling 16 days early. If you do not know the
# rule, do not guess downward: MONTH_END holds too long, which is survivable,
# while rolling early publishes a wrong price under a right label.
#
# SOURCED:
#   cattle   CME Rule 10102.H -- last business day of the contract month
#   feeders  CME Rule 10202   -- last Thursday, November and holiday exceptions
#   grains   CBOT -- business day before the 15th (see docstring)
# NOT SOURCED (placeholder, conservative):
#   hogs     believed 10th business day; MONTH_END until confirmed
#   milk     believed tied to the USDA Class III announcement; MONTH_END until
#            confirmed
PRODUCT_RULE = {
    "corn": "GRAIN", "beans": "GRAIN", "wheat": "GRAIN",
    "kcwheat": "GRAIN", "mplswheat": "GRAIN", "oats": "GRAIN",
    "meal": "GRAIN", "soyoil": "GRAIN",
    "cattle": "MONTH_END",
    "feeders": "LAST_THURSDAY",
    "hogs": "MONTH_END",        # UNVERIFIED -- see docstring
    "milk": "MONTH_END",        # UNVERIFIED -- see docstring
}
_DEFAULT_RULE = "GRAIN"


def rule_for(key):
    """Which expiry rule a feed key is on. 'cattle-aug26' -> 'MONTH_END'."""
    return PRODUCT_RULE.get(str(key).split("-")[0].lower(), _DEFAULT_RULE)


def _last_weekday_of_month(yr, mon, weekday):
    """Date of the last given weekday (Mon=0 .. Sun=6) in that month."""
    last = date(yr, mon, calendar.monthrange(yr, mon)[1])
    return last - timedelta(days=(last.weekday() - weekday) % 7)


def _last_business_day(yr, mon):
    """Last Mon-Fri of the month. Exchange holidays are not modelled --
    see the docstring: that can only make us hold longer, never roll early."""
    d = date(yr, mon, calendar.monthrange(yr, mon)[1])
    while d.weekday() > 4:            # 5=Sat, 6=Sun
        d -= timedelta(days=1)
    return d


def _feeder_last_trading_day(yr, mon):
    """CME Rule 10202: last Thursday of the contract month, except November,
    which terminates on the Thursday prior to Thanksgiving (the 4th Thursday),
    i.e. the 3rd Thursday. The rule's further holiday exceptions are not
    modelled; they can only move the day earlier."""
    if mon == 11:
        first = date(yr, 11, 1)
        first_thu = first + timedelta(days=(3 - first.weekday()) % 7)
        return first_thu + timedelta(days=14)      # 3rd Thursday
    return _last_weekday_of_month(yr, mon, 3)      # 3 = Thursday


def dead_from(yr, mon, rule):
    """First date on which a contract of this month/rule is considered dead."""
    if rule == "MONTH_END":
        return (date(yr, mon, calendar.monthrange(yr, mon)[1])
                + timedelta(days=1))               # the 1st of the next month
    if rule == "LAST_THURSDAY":
        return _feeder_last_trading_day(yr, mon) + timedelta(days=1)
    return date(yr, mon, EXPIRY_DAY)               # GRAIN


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
    return now.date() >= dead_from(yr, mon, rule_for(key))


def expiry_date(key):
    """The UTC datetime this dated key dies -- the first moment it is treated as
    expired, which depends on the product's calendar (see PRODUCT_RULE).
    None for undated keys."""
    p = _parse(key)
    if p is None:
        return None
    d = dead_from(p[0], p[1], rule_for(key))
    return datetime(d.year, d.month, d.day, tzinfo=timezone.utc)


def recent_expiry(key, now=None, window_days=ROLL_WINDOW_DAYS):
    """True if this DATED key expired within the last `window_days` days —
    i.e. the continuous front-month for its crop is inside the roll window and
    its day-change may span two contracts. Undated keys: always False.

    Boundaries: True from the expiry day itself (the 15th) through
    expiry+window_days-1; False before expiry and from expiry+window_days on.
    """
    exp = expiry_date(key)
    if exp is None:
        return False
    now = now or datetime.now(timezone.utc)
    days = (now.date() - exp.date()).days
    return 0 <= days < window_days


def front_key(keys, now=None):
    """First non-expired key, in the order given. None if all are expired.

    Order is the caller's responsibility: pass the ladder nearest-first.
    """
    for k in keys:
        if not is_expired(k, now):
            return k
    return None


# ═══════════════════════════════════════════════════════════════════════════
# THE TRADING CALENDAR — ONE definition of "was there a session that day".
#
# Added 2026-09-13 with the grading fix. get_market_status() in
# generate_daily.py carried a hardcoded HOLIDAYS_2026 map marked "REFRESH
# ANNUALLY", and it could only answer the question for TODAY (it reads
# datetime.now()). The call grader needed the same question about an
# arbitrary past date, which is exactly how a second holiday list gets
# written and then disagrees with the first one in January.
#
# So the rule is computed, not listed, and get_market_status() imports it.
# _selftest pins the computed 2026 set against the map that was hardcoded,
# so if the computation is ever wrong for a year the repo has already
# published against, the test goes red rather than the briefing going out
# with a phantom session.
#
# These are CME/CBOT FULL closures. Nov 27 2026 (day after Thanksgiving) is
# an early close, not a closure, and is deliberately a trading day here.
# ═══════════════════════════════════════════════════════════════════════════

def _easter(y):
    """Anonymous Gregorian algorithm. Good Friday is Easter minus two days."""
    a = y % 19; b = y // 100; c = y % 100; d = b // 4; e = b % 4
    f = (b + 8) // 25; g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30; i = c // 4; k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    return date(y, (h + l - 7 * m + 114) // 31, ((h + l - 7 * m + 114) % 31) + 1)


def _nth_weekday(y, mon, weekday, n):
    d = date(y, mon, 1)
    d += timedelta(days=(weekday - d.weekday()) % 7)
    return d + timedelta(weeks=n - 1)


def _last_weekday_in(y, mon, weekday):
    d = (date(y, mon + 1, 1) - timedelta(days=1)) if mon < 12 else date(y, 12, 31)
    return d - timedelta(days=(d.weekday() - weekday) % 7)


def _observed(d):
    """A fixed-date holiday falling on a weekend is observed on the adjacent
    weekday. Saturday shifts BACK to Friday, Sunday FORWARD to Monday."""
    if d.weekday() == 5:
        return d - timedelta(days=1)
    if d.weekday() == 6:
        return d + timedelta(days=1)
    return d


def market_holidays(year):
    """{date: name} of full-closure holidays observed in `year`. A fixed-date
    holiday can be observed in the neighbouring year (Jan 1 2028 is a Saturday,
    observed Dec 31 2027), so is_trading_day checks three years."""
    y = int(year)
    return {
        _observed(date(y, 1, 1)): "New Year's Day",
        _nth_weekday(y, 1, 0, 3): "MLK Day",
        _nth_weekday(y, 2, 0, 3): "Presidents Day",
        _easter(y) - timedelta(days=2): "Good Friday",
        _last_weekday_in(y, 5, 0): "Memorial Day",
        _observed(date(y, 6, 19)): "Juneteenth",
        _observed(date(y, 7, 4)): "Independence Day",
        _nth_weekday(y, 9, 0, 1): "Labor Day",
        _nth_weekday(y, 11, 3, 4): "Thanksgiving",
        _observed(date(y, 12, 25)): "Christmas Day",
    }


def _as_date(d):
    if isinstance(d, datetime):
        return d.date()
    if isinstance(d, date):
        return d
    return date.fromisoformat(str(d)[:10])


def holiday_name(d):
    """The closure's name if `d` is a market holiday, else None."""
    d = _as_date(d)
    for y in (d.year - 1, d.year, d.year + 1):
        n = market_holidays(y).get(d)
        if n:
            return n
    return None


def is_trading_day(d):
    """True when a session settles on `d`: a weekday that is not a full-closure
    holiday. This is THE definition; do not write a second one."""
    d = _as_date(d)
    return d.weekday() < 5 and holiday_name(d) is None


def prior_trading_day(d):
    """The last session that settled strictly before `d`."""
    d = _as_date(d) - timedelta(days=1)
    for _ in range(30):
        if is_trading_day(d):
            return d
        d -= timedelta(days=1)
    raise ValueError("no trading day found in the 30 days before the date given")


def next_trading_day(d):
    """The first session that settles strictly after `d`."""
    d = _as_date(d) + timedelta(days=1)
    for _ in range(30):
        if is_trading_day(d):
            return d
        d += timedelta(days=1)
    raise ValueError("no trading day found in the 30 days after the date given")


def sessions_between(start, end):
    """Count of sessions that settled in [start, end). Zero means nothing
    traded between the two, which is why a briefing published on Sunday holds
    exactly the board Saturday's held."""
    a, b = _as_date(start), _as_date(end)
    if b <= a:
        return 0
    n = 0
    while a < b:
        if is_trading_day(a):
            n += 1
        a += timedelta(days=1)
    return n


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

    # --- roll window (the 2026-07-17 phantom -3.58% corn "crash") -----------
    chk(recent_expiry("corn-jul26", T(2026, 7, 15)) is True,  "roll window opens on expiry day (Jul 15)")
    chk(recent_expiry("corn-jul26", T(2026, 7, 17)) is True,  "Jul 17 in roll window (the phantom-move day)")
    chk(recent_expiry("corn-jul26", T(2026, 7, 19)) is True,  "Jul 19 last day inside 5-day window")
    chk(recent_expiry("corn-jul26", T(2026, 7, 20)) is False, "Jul 20 outside window")
    chk(recent_expiry("corn-jul26", T(2026, 7, 14)) is False, "not in window before expiry")
    chk(recent_expiry("corn", T(2026, 7, 17)) is False,       "undated key never in roll window")
    chk(recent_expiry("corn-dec", T(2026, 7, 17)) is False,   "benchmark alias never in roll window")
    chk(expiry_date("corn-jul26").strftime("%Y-%m-%d") == "2026-07-15", "expiry_date corn-jul26 = 2026-07-15")
    chk(expiry_date("corn") is None, "expiry_date undated = None")

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

    # --- per-product rules: the 2026-08-08 finding ---------------------------
    # cattle: CME Rule 10102.H, last business day of the contract month.
    # Under the old single grain rule cattle-aug26 died on Aug 15 while August
    # was still the front month, and preflight "repaired" $231.70 to October's
    # $225.275 -- $6.42/cwt, about $90 a head.
    chk(rule_for("cattle-aug26") == "MONTH_END", "cattle is on the month-end rule")
    chk(is_expired("cattle-aug26", T(2026, 8, 15)) is False, "cattle-aug26 LIVE on Aug 15 (the bug day)")
    chk(is_expired("cattle-aug26", T(2026, 8, 28)) is False, "cattle-aug26 live on Aug 28 (Fri, last business day)")
    chk(is_expired("cattle-aug26", T(2026, 8, 31)) is False, "cattle-aug26 live on Aug 31 (last calendar day)")
    chk(is_expired("cattle-aug26", T(2026, 9, 1)) is True,  "cattle-aug26 dead on Sep 1")
    chk(front_key(["cattle-aug26", "cattle-oct26"], T(2026, 8, 15)) == "cattle-aug26",
        "front stays AUG on Aug 15 (was rolling to Oct 16 days early)")
    chk(front_key(["cattle-aug26", "cattle-oct26"], T(2026, 9, 1)) == "cattle-oct26",
        "cattle rolls aug -> oct on Sep 1")

    # feeders: CME Rule 10202, last Thursday; November is the Thursday before
    # Thanksgiving. Aug 2026: Thursdays are 6, 13, 20, 27 -> last is the 27th.
    chk(rule_for("feeders-aug26") == "LAST_THURSDAY", "feeders are on the last-Thursday rule")
    chk(_last_weekday_of_month(2026, 8, 3).isoformat() == "2026-08-27", "last Thursday of Aug 2026 is the 27th")
    chk(is_expired("feeders-aug26", T(2026, 8, 27)) is False, "feeders-aug26 live on its last trading day")
    chk(is_expired("feeders-aug26", T(2026, 8, 28)) is True,  "feeders-aug26 dead the day after")
    chk(is_expired("feeders-aug26", T(2026, 8, 15)) is False, "feeders-aug26 NOT killed by the grain rule")
    # Nov 2026: Thursdays 5, 12, 19, 26. Thanksgiving is the 26th, so the
    # contract terminates on the 19th.
    chk(_feeder_last_trading_day(2026, 11).isoformat() == "2026-11-19",
        "feeders Nov 2026 terminate Nov 19, the Thursday before Thanksgiving")
    chk(is_expired("feeders-nov26", T(2026, 11, 19)) is False, "feeders-nov26 live on Nov 19")
    chk(is_expired("feeders-nov26", T(2026, 11, 20)) is True,  "feeders-nov26 dead on Nov 20")
    chk(is_expired("feeders-nov26", T(2026, 11, 26)) is True,  "feeders-nov26 not revived by the last Thursday")

    # grains keep the rule they always had -- this change must not move them
    for k in ("corn-jul26", "beans-jul26", "wheat-jul26", "oats-jul26",
              "meal-jul26", "soyoil-jul26"):
        chk(rule_for(k) == "GRAIN", f"{k} is on the grain rule")
        chk(is_expired(k, T(2026, 7, 15)) is True, f"{k} dead on Jul 15 (unchanged)")
        chk(is_expired(k, T(2026, 7, 14)) is False, f"{k} live on Jul 14 (unchanged)")

    # an unknown product falls back to the grain rule, as it always did
    chk(rule_for("sorghum-jul26") == "GRAIN", "unknown product defaults to the grain rule")

    # month-end handles month lengths and weekends
    chk(dead_from(2026, 2, "MONTH_END").isoformat() == "2026-03-01", "Feb month-end -> Mar 1")
    chk(dead_from(2026, 12, "MONTH_END").isoformat() == "2027-01-01", "Dec month-end -> Jan 1 next year")
    chk(_last_business_day(2026, 5).isoformat() == "2026-05-29", "last business day of May 2026 is Fri the 29th")

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

    # --- the trading calendar ----------------------------------------------
    # Pinned against the map that generate_daily.get_market_status carried
    # hardcoded until 2026-09-13. If the computation ever disagrees with a
    # year the site has already published against, this goes red.
    HARDCODED_2026 = {(1, 1), (1, 19), (2, 16), (4, 3), (5, 25), (6, 19),
                      (7, 3), (9, 7), (11, 26), (12, 25)}
    computed = {(d.month, d.day) for d in market_holidays(2026)}
    chk(computed == HARDCODED_2026,
        f"computed 2026 holidays == the map generate_daily used to hardcode "
        f"(extra={sorted(computed - HARDCODED_2026)} missing={sorted(HARDCODED_2026 - computed)})")
    chk(is_trading_day(date(2026, 9, 4)) is True, "Fri Sep 4 2026 is a session")
    chk(is_trading_day(date(2026, 9, 5)) is False, "Sat Sep 5 2026 is not")
    chk(is_trading_day(date(2026, 9, 6)) is False, "Sun Sep 6 2026 is not")
    chk(is_trading_day(date(2026, 9, 7)) is False, "Labor Day 2026 is not")
    chk(is_trading_day(date(2026, 9, 8)) is True, "Tue Sep 8 2026 is a session")
    chk(is_trading_day(date(2026, 11, 27)) is True,
        "day after Thanksgiving is an EARLY CLOSE, still a session")
    chk(holiday_name(date(2026, 9, 7)) == "Labor Day", "Labor Day named")
    chk(prior_trading_day(date(2026, 9, 8)) == date(2026, 9, 4),
        "the session before Tue Sep 8 is Fri Sep 4 (Labor Day weekend skipped)")
    chk(next_trading_day(date(2026, 9, 4)) == date(2026, 9, 8),
        "the session after Fri Sep 4 is Tue Sep 8")
    # sessions_between is what tells the grader a weekend issue adds nothing
    chk(sessions_between(date(2026, 9, 5), date(2026, 9, 6)) == 0, "Sat->Sun: no session")
    chk(sessions_between(date(2026, 9, 5), date(2026, 9, 8)) == 0,
        "Sat->Tue across Labor Day: still no session settled")
    chk(sessions_between(date(2026, 9, 5), date(2026, 9, 9)) == 1,
        "Sat->Wed: one session (Tuesday) settled")
    chk(sessions_between(date(2026, 8, 21), date(2026, 8, 22)) == 1, "Fri->Sat: Friday settled")
    # a fixed-date holiday observed in the neighbouring year
    chk(holiday_name(date(2027, 12, 31)) == "New Year's Day",
        "Jan 1 2028 falls on a Saturday, observed Fri Dec 31 2027")

    print("SELFTEST OK" if ok else "SELFTEST FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(_selftest())
