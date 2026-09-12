#!/usr/bin/env python3
"""
usda_dates.py — THE definition of major USDA release dates. Single source,
imported by generate_daily.py (prompt grounding) and briefing_gate.py (the
fabricated-release check). Same pattern as grade_calls.iso_date: two copies
of a date table is how the 2026-08-11 incident happened in the first place —
the generator's calendar correctly said WASDE = Aug 12 while the model's
prose said "the WASDE on Tuesday", and nothing compared the two.

Hardcoded for 2026; revisit annually (grep 'revisit annually').
"""
from datetime import date, timedelta

WASDE_2026 = {
    date(2026, 1, 12), date(2026, 2, 10), date(2026, 3, 10), date(2026, 4, 9),
    date(2026, 5, 12), date(2026, 6, 11), date(2026, 7, 10), date(2026, 8, 12),
    date(2026, 9, 11), date(2026, 10, 9), date(2026, 11, 10), date(2026, 12, 10),
}


def next_wasde(today):
    """The next WASDE date >= today, or None past the table's horizon."""
    future = sorted(d for d in WASDE_2026 if d >= today)
    return future[0] if future else None


def prior_wasde(today):
    """The most recent WASDE date < today, or None."""
    past = sorted(d for d in WASDE_2026 if d < today)
    return past[-1] if past else None


# In the run-up to a WASDE, unqualified past tense ("the WASDE landed") can
# only be about the imminent one — the prior report is weeks old and nobody
# calls it "the WASDE" without a month word. 7 days covers the anticipation
# news cycle that misled the model on 2026-08-11 while leaving the
# post-release week free for honest recaps.
FABRICATION_WINDOW_DAYS = 7


def wasde_results_are_public(today, generated_at_utc=None):
    """Can a briefing legitimately describe "the WASDE" in the past tense?

    False (fabrication risk) inside the run-up window — the
    FABRICATION_WINDOW_DAYS before the next WASDE — and on release day
    itself until the 16:00 UTC print (the daily generates ~11:47 UTC,
    hours before the report exists). True otherwise, including a
    post-print regeneration on release day and the recap days after.
    """
    nw = next_wasde(today)
    if nw is None:
        return True                      # calendar exhausted; nothing to fabricate
    days_until = (nw - today).days
    if days_until > FABRICATION_WINDOW_DAYS or days_until < 0:
        return True
    if days_until > 0:
        return False                     # run-up window: "the WASDE landed" can
                                         # only be about the imminent, unreleased one
    # nw == today: release day. Results exist only after ~16:00 UTC.
    if generated_at_utc is not None:
        try:
            return (generated_at_utc.hour * 60 + generated_at_utc.minute) >= 16 * 60
        except AttributeError:
            pass
    return False


# ── THE CALENDAR RUNS OUT ON A DATE, AND NOTHING SAYS SO ─────────────────────
#
# WASDE_2026 ends 2026-12-10. From 11 December `next_wasde` returns None, and
# every one of the six things that ask it degrades quietly:
#
#   build_whats_priced_in.py  the flagship page's top card reads "No upcoming
#                             report is scheduled right now"
#   generate_daily.py         the run-up paragraph silently stops appearing
#   briefing_gate.py          the fabricated-release check passes everything
#   bake_seo.py               next_wasde goes into the page as None
#   nowcast_direction.py      locks, correctly, and says "revisit annually"
#   fetch_wasde.py            prior_wasde pins to 2026-12-10 for ever, so the
#                             January report is never graded
#
# Not one of them is wrong. Every one of them is silent, and the docstring at
# the top of this file has said "revisit annually" since it was written, which
# is a note to a person who is not reading it in December.
#
# Measured 2026-09-12: USDA's own WASDE page lists the twelve 2026 dates -- the
# same twelve in the table above, which is a useful independent check of it --
# and gives no 2027 schedule at all. So the dates cannot be filled in yet. What
# can be done is stop the horizon arriving unannounced.
#
# WHY THIS WARNS AND DOES NOT FAIL. Failing would put a December problem in
# front of the November WASDE: the watcher tests this file before it grades,
# and a guard that blocks the grading it was meant to protect is the exact
# shape that has already bitten this project twice. So it is amber in the
# run-up and red only once the calendar has actually run out, which is when the
# page really is showing nothing.
HORIZON_WARN_DAYS = 75

SCHEDULE_SOURCE = ("https://www.usda.gov/about-usda/general-information/staff-offices/"
                   "office-chief-economist/commodity-markets/wasde-report")


def _days(n):
    return "%d day%s" % (n, "" if n == 1 else "s")


def horizon(today):
    """How much calendar is left, and what to do about it.

    Returns (level, message) where level is "ok", "warn" or "exhausted".
    """
    last = max(WASDE_2026)
    days = (last - today).days
    if days < 0:
        return ("exhausted",
                "The WASDE calendar ran out on %s, %s ago. next_wasde() has been "
                "returning None since, so the What's Priced In card reads \"no upcoming "
                "report\", the daily brief has stopped mentioning the run-up, and "
                "fetch_wasde is pinned to the December release and will not grade "
                "January. Add WASDE_2027 to scripts/usda_dates.py from %s."
                % (last.isoformat(), _days(-days), SCHEDULE_SOURCE))
    if days <= HORIZON_WARN_DAYS:
        return ("warn",
                "The WASDE calendar ends on %s, %s away. When it does, six things "
                "go quiet at once and none of them says why. USDA had not published a "
                "2027 schedule as of 2026-09-12; it normally appears in the autumn. "
                "Check %s and add WASDE_2027."
                % (last.isoformat(), _days(days), SCHEDULE_SOURCE))
    return ("ok", "WASDE calendar runs to %s, %s out." % (last.isoformat(), _days(days)))


def _selftest():
    fails = []

    def check(ok, what, got=""):
        (print("  ok    " + what) if ok
         else (fails.append(what), print("  FAIL  %s  -- %s" % (what, got))))

    print("the table matches what USDA publishes")
    # Read from USDA's own WASDE page on 2026-09-12: "In 2026 the WASDE report
    # will be released on Jan. 12, Feb. 10, Mar. 10, Apr. 9, May 12, Jun. 11,
    # Jul. 10, Aug. 12, Sep. 11, Oct. 9, Nov. 10, and Dec. 10."
    published = {date(2026, 1, 12), date(2026, 2, 10), date(2026, 3, 10), date(2026, 4, 9),
                 date(2026, 5, 12), date(2026, 6, 11), date(2026, 7, 10), date(2026, 8, 12),
                 date(2026, 9, 11), date(2026, 10, 9), date(2026, 11, 10), date(2026, 12, 10)}
    check(WASDE_2026 == published, "all twelve 2026 dates, and no thirteenth",
          str(sorted(WASDE_2026 ^ published)))

    print()
    print("the horizon is announced before it arrives, not after")
    last = max(WASDE_2026)
    check(horizon(last - timedelta(days=HORIZON_WARN_DAYS + 1))[0] == "ok",
          "well before the window it says nothing")
    check(horizon(last - timedelta(days=HORIZON_WARN_DAYS))[0] == "warn",
          "at the edge of the window it warns")
    check(horizon(last)[0] == "warn", "on the last release day it is still only a warning")
    check(horizon(last + timedelta(days=1))[0] == "exhausted",
          "the day after the last release it is exhausted")

    lvl, msg = horizon(last + timedelta(days=1))
    check(SCHEDULE_SOURCE in msg, "and it says where to get the dates")
    check("WASDE_2027" in msg, "and what to add")
    lvl2, msg2 = horizon(last - timedelta(days=30))
    check(str(last) in msg2, "the warning names the date it runs out")
    check("30 days" in msg2, "and how long is left", msg2)

    print()
    print("the warning window is long enough to act in")
    check(HORIZON_WARN_DAYS >= 60,
          "at least two months, because this needs USDA to publish first")

    print()
    if fails:
        print("FAILED (%d): %s" % (len(fails), "; ".join(fails)))
        return 1
    print("usda_dates: all passed")
    return 0


if __name__ == "__main__":
    import sys
    if "--selftest" in sys.argv:
        sys.exit(_selftest())
    # THE CHECK THE WORKFLOWS RUN. Amber in the run-up, red once it has run out.
    lvl, msg = horizon(date.today())
    print("[usda-dates] %s" % msg)
    if lvl == "warn":
        print("::warning title=WASDE calendar::%s" % msg)
    elif lvl == "exhausted":
        print("::error title=WASDE calendar::%s" % msg)
        sys.exit(1)
    sys.exit(0)
