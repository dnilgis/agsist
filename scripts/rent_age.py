#!/usr/bin/env python3
"""rent_age.py: the one rule for how old a county cash rent may be before a page stops printing it,
and the one ten-year base year (Nov 10, 2026).

THE AGE RULE (Sig, Oct 19, 2026): a rent more than three survey years older than the newest survey shows
"n/a, last published YYYY" and is treated as no value: it does not sort with real rents, it gives no state
comparison, and no title or description prints it. Until Nov 10 the Atlas tiles carried this rule in
build_atlas_pages.py while the state rent tables filled a missing cell with a rent of any age (Fayette IA
irrigated, $203 from 2010) and the Atlas titles printed Otero CO's 2009 rent. Every caller imports it from here.

THE TEN-YEAR BASE: the newest survey year at or before latest - 10, no older than latest - 12 (NASS ran no
survey in 2015 or 2018). The state rent pages compared 2026 with 2017 and the Atlas with 2016; both use this now.

Stdlib only, no I/O. python3 scripts/rent_age.py --selftest
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import sys

MAX_SURVEY_AGE = 3


def too_old(year, latest):
    """True when a rent from `year` is more than three survey years older than `latest`."""
    try:
        return bool(year and latest and int(year) < int(latest) - MAX_SURVEY_AGE)
    except (TypeError, ValueError):
        return False


def current(entry, latest):
    """{"year", "value"} -> True when it carries a value that is not too old to print."""
    return bool(entry and entry.get("value") is not None and not too_old(entry.get("year"), latest))


def old_words(year):
    """What a cell says in place of a rent that is too old."""
    return "n/a, last published %d" % int(year)


def headline(kinds, latest, order=("nonirr", "irr")):
    """(kind, value, year) of the first land type in `order` whose rent is current, else None.
    `kinds` maps a kind to {"year", "value"}. A title or description names a rent only through this."""
    for k in order:
        e = (kinds or {}).get(k)
        if current(e, latest):
            return k, e["value"], int(e["year"])
    return None


def ten_year_base(years, latest):
    """The base year of a ten-year change: the newest year in `years` from latest-12 to latest-10, else None."""
    if not latest:
        return None
    c = [int(y) for y in years if int(latest) - 12 <= int(y) <= int(latest) - 10]
    return max(c) if c else None


def selftest():
    fails = []

    def ok(c, m):
        if not c:
            fails.append(m)
            print("FAIL", m)
    ok(not too_old(2023, 2026), "2023 on the 2026 survey is three years old: still printed")
    ok(too_old(2022, 2026), "2022 on the 2026 survey is too old")
    ok(too_old(2010, 2026), "Fayette IA irrigated 2010 is too old")
    ok(not too_old(None, 2026) and not too_old(2010, None) and not too_old(2010, 0), "no year or no latest: no rule")
    ok(too_old("2009", "2026"), "years as strings")
    ok(old_words(2010) == "n/a, last published 2010", old_words(2010))
    ok(current({"year": 2026, "value": 375.0}, 2026) and not current({"year": 2021, "value": 28.0}, 2026), "current")
    ok(not current({"year": 2026, "value": None}, 2026) and not current(None, 2026), "no value is not current")
    # Colusa CA: dry $28 (2021), irrigated $375 (2026) -> the irrigated rent heads the title
    ok(headline({"nonirr": {"year": 2021, "value": 28.0}, "irr": {"year": 2026, "value": 375.0}}, 2026) == ("irr", 375.0, 2026), "Colusa")
    # Otero CO: dry $35 (2009), no current irrigated -> no rent in the title
    ok(headline({"nonirr": {"year": 2009, "value": 35.0}, "irr": {"year": 2012, "value": 90.0}}, 2026) is None, "Otero")
    ok(headline({"nonirr": {"year": 2026, "value": 266.0}}, 2026) == ("nonirr", 266.0, 2026), "a current dry rent leads")
    ok(ten_year_base([2008, 2014, 2016, 2017, 2019, 2026], 2026) == 2016, "2026 -> 2016, not 2017")
    ok(ten_year_base([2013, 2014, 2016, 2025], 2025) == 2014, "2025: no 2015 survey -> 2014")
    ok(ten_year_base([2019, 2026], 2026) is None, "no base inside twelve years")
    print("rent_age selftest:", "FAIL" if fails else "ok")
    return 1 if fails else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    print(__doc__)
