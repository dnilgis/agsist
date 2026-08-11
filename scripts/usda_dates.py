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
