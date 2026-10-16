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


# THE OTHER 11:00 a.m. CT REPORTS THE BRIEFING MUST NAME ON THE DAY
# (scripts/report_day.py). Grain Stocks, Plantings and Acreage match
# usda-calendar.html. Crop Production is listed on the days it carries the corn
# and soybean yield the site grades (Aug to Nov, with the WASDE) plus the April
# update and the January annual; the May to July winter wheat editions are left
# out, so on those days the briefing names the WASDE alone.
GRAIN_STOCKS_2026 = {date(2026, 1, 12), date(2026, 3, 31), date(2026, 6, 30), date(2026, 9, 30)}
CROP_PRODUCTION_2026 = {date(2026, 1, 12), date(2026, 4, 9), date(2026, 8, 12), date(2026, 9, 11),
                        date(2026, 10, 9), date(2026, 11, 10)}
PROSPECTIVE_PLANTINGS_2026 = {date(2026, 3, 31)}
ACREAGE_2026 = {date(2026, 6, 30)}


def major_reports(day):
    """The market-moving USDA reports released on `day`, in the order a
    farmer would name them. [] on any other day."""
    out = []
    if day in WASDE_2026:
        out.append("WASDE")
    if day in CROP_PRODUCTION_2026:
        out.append("Crop Production")
    if day in GRAIN_STOCKS_2026:
        out.append("Grain Stocks")
    if day in PROSPECTIVE_PLANTINGS_2026:
        out.append("Prospective Plantings")
    if day in ACREAGE_2026:
        out.append("Acreage")
    return out


def next_wasde(today):
    """The next WASDE date >= today, or None past the table's horizon."""
    future = sorted(d for d in WASDE_2026 if d >= today)
    return future[0] if future else None


def prior_wasde(today):
    """The most recent WASDE date < today, or None."""
    past = sorted(d for d in WASDE_2026 if d < today)
    return past[-1] if past else None


# ── WEEKLY RELEASES AND FEDERAL HOLIDAYS: ONE RULE ──────────────────────────
#
# 2026-10-11: three places named the Columbus Day week's Crop Progress three
# ways. /usda-calendar moved it to Tuesday Oct 13 (changed 2026-10-10), the
# homepage strip kept Monday Oct 12 with "Holiday: date may shift", and the
# daily prompt told the model "Monday 3:00 PM CT" and had no Columbus Day in
# its holiday list at all (CME is open that day, so the market-status check
# never saw it; NASS is closed). This is the rule all three now follow:
#
#   * federal holidays are computed (fixed by law, 5 U.S.C. 6103), with the
#     Saturday-to-Friday and Sunday-to-Monday observed shifts;
#   * a weekly USDA release whose normal day is a federal holiday comes out
#     the next business day (Crop Progress on Tuesday after a Monday holiday,
#     Export Sales on Friday of Thanksgiving week).
#
# usda-calendar.html carries the same holidays as a literal set and
# index.html computes them with the same law; the selftest below reads the
# first and test/usda-holidays.test.mjs runs the second against it.

CROP_PROGRESS_TIME_CT = "3:00 PM CT"     # 4:00 PM ET, as /usda-calendar shows
EXPORT_SALES_TIME_CT = "7:30 AM CT"      # 8:30 AM ET


def _nth_weekday(year, month, weekday, n):
    d = date(year, month, 1)
    return d + timedelta(days=(weekday - d.weekday()) % 7 + 7 * (n - 1))


def _last_weekday(year, month, weekday):
    d = (date(year + (month == 12), month % 12 + 1, 1) - timedelta(days=1))
    return d - timedelta(days=(d.weekday() - weekday) % 7)


def _observed(d):
    if d.weekday() == 5:
        return d - timedelta(days=1)
    if d.weekday() == 6:
        return d + timedelta(days=1)
    return d


def federal_holidays(year):
    """{date: name} of US federal holidays (observed dates) for `year`."""
    return {
        _observed(date(year, 1, 1)): "New Year's Day",
        _nth_weekday(year, 1, 0, 3): "Martin Luther King Jr. Day",
        _nth_weekday(year, 2, 0, 3): "Presidents Day",
        _last_weekday(year, 5, 0): "Memorial Day",
        _observed(date(year, 6, 19)): "Juneteenth",
        _observed(date(year, 7, 4)): "Independence Day",
        _nth_weekday(year, 9, 0, 1): "Labor Day",
        _nth_weekday(year, 10, 0, 2): "Columbus Day",
        _observed(date(year, 11, 11)): "Veterans Day",
        _nth_weekday(year, 11, 3, 4): "Thanksgiving",
        _observed(date(year, 12, 25)): "Christmas Day",
    }


def federal_holiday_name(day):
    return federal_holidays(day.year).get(day)


def next_business_day(day):
    """The first weekday after `day` that is not a federal holiday."""
    d = day + timedelta(days=1)
    while d.weekday() >= 5 or federal_holiday_name(d):
        d += timedelta(days=1)
    return d


def _weekly(day, weekday):
    """The release date of the week containing `day` for a report whose
    normal day is `weekday` (0=Mon)."""
    normal = day - timedelta(days=day.weekday()) + timedelta(days=weekday)
    return next_business_day(normal) if federal_holiday_name(normal) else normal


# The last Crop Progress of a season, where NASS's own calendar for that year
# lists it. 2026: Mon Nov 30, the Monday after Thanksgiving (NASS 2026
# Agricultural Statistics Board calendar, fetched 2026-10-16). A year not
# listed here falls back to the Monday of Thanksgiving week.
CROP_PROGRESS_LAST = {2026: date(2026, 11, 30)}


def crop_progress_season(monday):
    """Is the week starting `monday` a Crop Progress week? From the first
    Monday of April to the season's last Monday (CROP_PROGRESS_LAST, else the
    Monday of Thanksgiving week): the seasons usda-calendar.html lists (2025:
    Apr 7 to Nov 24, 2026: Apr 6 to Nov 30; the selftest compares them) and
    the rule components/home.js applies."""
    first = _nth_weekday(monday.year, 4, 0, 1)
    last = CROP_PROGRESS_LAST.get(monday.year) or (_nth_weekday(monday.year, 11, 3, 4) - timedelta(days=3))
    return first <= monday <= last


def crop_progress_date(day):
    """The Crop Progress release date for the week containing `day`, or
    None outside the season. Monday, or the next business day after a
    Monday federal holiday."""
    d = _weekly(day, 0)
    return d if crop_progress_season(d - timedelta(days=d.weekday())) else None


def export_sales_date(day):
    """The weekly Export Sales release date for the week containing `day`:
    Thursday, or the next business day after a Thursday federal holiday."""
    return _weekly(day, 3)


def next_crop_progress(today):
    """The next Crop Progress release on or after `today`, or None."""
    for wk in range(0, 3):
        d = crop_progress_date(today + timedelta(days=7 * wk))
        if d and d >= today:
            return d
    return None


def weekly_releases(day):
    """[(name, time_ct, moved_from)] of weekly USDA releases on `day`.
    moved_from is the holiday date the release moved from, else None."""
    out = []
    cp = crop_progress_date(day)
    if cp == day:
        normal = day - timedelta(days=day.weekday())
        out.append(("USDA Crop Progress", CROP_PROGRESS_TIME_CT, None if normal == day else normal))
    es = export_sales_date(day)
    if es == day:
        normal = day - timedelta(days=day.weekday()) + timedelta(days=3)
        out.append(("USDA Weekly Export Sales", EXPORT_SALES_TIME_CT, None if normal == day else normal))
    return out


def describe_release(day, normal):
    """'Tuesday, Oct 13 (moved from Monday, Oct 12, Columbus Day)'."""
    s = "%s, %s %d" % (day.strftime("%A"), day.strftime("%b"), day.day)
    if normal and normal != day:
        s += " (moved from %s, %s %d, %s)" % (normal.strftime("%A"), normal.strftime("%b"),
                                             normal.day, federal_holiday_name(normal))
    return s


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
    print("weekly releases move off a federal holiday to the next business day")
    check(federal_holiday_name(date(2026, 10, 12)) == "Columbus Day", "Oct 12, 2026 is Columbus Day")
    check(crop_progress_date(date(2026, 10, 12)) == date(2026, 10, 13),
          "Crop Progress in Columbus Day week is Tuesday Oct 13", str(crop_progress_date(date(2026, 10, 12))))
    check(next_crop_progress(date(2026, 10, 11)) == date(2026, 10, 13),
          "seen from Sunday Oct 11, the next Crop Progress is Tue Oct 13")
    check(next_crop_progress(date(2026, 10, 13)) == date(2026, 10, 13), "on Oct 13 it is today")
    check(next_crop_progress(date(2026, 10, 14)) == date(2026, 10, 19), "after it, Monday Oct 19")
    check(weekly_releases(date(2026, 10, 12)) == [], "nothing weekly on Columbus Day itself")
    wr = weekly_releases(date(2026, 10, 13))
    check(wr == [("USDA Crop Progress", "3:00 PM CT", date(2026, 10, 12))],
          "Tue Oct 13 carries the moved Crop Progress", str(wr))
    check(crop_progress_date(date(2026, 9, 7)) == date(2026, 9, 8), "Labor Day week: Tuesday Sep 8")
    check(crop_progress_date(date(2026, 5, 25)) == date(2026, 5, 26), "Memorial Day week: Tuesday May 26")
    check(crop_progress_date(date(2026, 10, 19)) == date(2026, 10, 19), "an ordinary week: Monday")
    check(crop_progress_date(date(2026, 12, 7)) is None, "no Crop Progress in December")
    check(export_sales_date(date(2026, 11, 26)) == date(2026, 11, 27), "Thanksgiving: Export Sales Friday")
    check(export_sales_date(date(2026, 10, 12)) == date(2026, 10, 15),
          "Export Sales in Columbus Day week stays Thursday (what /usda-calendar shows)")
    check(describe_release(date(2026, 10, 13), date(2026, 10, 12))
          == "Tuesday, Oct 13 (moved from Monday, Oct 12, Columbus Day)", "the moved release is described")

    print()
    print("usda-calendar.html carries the same federal holidays")
    import os
    import re
    here = os.path.dirname(os.path.abspath(__file__))
    cal = open(os.path.join(here, "..", "usda-calendar.html"), encoding="utf-8").read()
    m = re.search(r"FED_HOLIDAYS=new Set\(\[([^\]]*)\]\)", cal)
    check(bool(m), "found FED_HOLIDAYS in usda-calendar.html")
    if m:
        page = set(re.findall(r"'(\d{4}-\d{2}-\d{2})'", m.group(1)))
        years = sorted({int(x[:4]) for x in page})
        rule = {d.isoformat() for y in years for d in federal_holidays(y)}
        check(page == rule, "same dates as federal_holidays() for %s" % years, str(sorted(page ^ rule)))
    sm = re.search(r"const seasons=\[(.*?)\];", cal)
    page_seasons = set(re.findall(r"start:'([\d-]+)',end:'([\d-]+)'", sm.group(1))) if sm else set()
    table = set()
    for a, _b in page_seasons:
        y = int(a[:4])
        mons = [date(y, 1, 1) + timedelta(days=k) for k in range(366)]
        mons = [m for m in mons if m.year == y and m.weekday() == 0 and crop_progress_season(m)]
        table.add((mons[0].isoformat(), mons[-1].isoformat()))
    check(page_seasons == table, "same Crop Progress seasons", str(page_seasons ^ table))
    check(crop_progress_date(date(2026, 11, 30)) == date(2026, 11, 30),
          "Mon Nov 30, 2026 is the last Crop Progress (NASS 2026 calendar)")
    check(crop_progress_date(date(2026, 12, 7)) is None, "no Crop Progress after the last season week")
    check("nextBizDay(iso)" in cal and "type:'croprog'" in cal,
          "and moves a holiday Crop Progress to the next business day")
    idx = open(os.path.join(here, "..", "index.html"), encoding="utf-8").read()
    # the homepage page script moved to components/home.js (2026-10-12)
    idx += open(os.path.join(here, "..", "components", "home.js"), encoding="utf-8").read()
    check("date may shift" not in idx, "the homepage strip no longer leaves the date open")

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
