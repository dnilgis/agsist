#!/usr/bin/env python3
"""When a report became public: `released_at` beside the time we fetched it (god's-eye build 7, Nov 9 2026).

A forecast test may only use what was knowable on each date. `fetched` says when OUR job read a file, which
can be days after the release (a job that failed and caught up) or, for a file read on a schedule, minutes
after. Neither is when the market could have known it. So each fetcher of a weekly report also writes:

  released_at      ISO UTC time the report was public
  released_basis   how we know it:
                     source    the source's own date field (AgTransport: the dataset's rowsUpdatedAt)
                     schedule  the agency's published release schedule, from the report's own week
                     fetched   our fetch time, because it was earlier than the schedule allows (the report
                               was out early, so the schedule does not hold for that week) or the source
                               states nothing. Never earlier than the truth: we had it in hand by then.
  released_rule    the schedule in plain words

THE SCHEDULES
  usdm           U.S. Drought Monitor: map valid Tuesday, released Thursday 8:30 am ET. Never moved later; a
                 holiday week can move it EARLIER, so Thursday is the safe (never early) time.
  crop_progress  NASS Crop Progress: week ending Sunday, released Monday 4:00 pm ET; Tuesday when Monday is
                 a federal holiday.
  export_sales   FAS Weekly Export Sales: week ending Thursday, released the next Thursday 8:30 am ET; Friday
                 when that Thursday is a federal holiday.
  agtransport    USDA AgTransport (Socrata): no fixed hour (the Grain Transportation Report data posts when
                 AMS loads it, sometimes weeks behind), so the dataset's own rowsUpdatedAt, else the fetch.

    python3 scripts/released_at.py --selftest
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import sys
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")

RULES = {
    "usdm": "map valid Tuesday, released Thursday 8:30 am ET",
    "crop_progress": "week ending Sunday, released Monday 4:00 pm ET (Tuesday after a Monday holiday)",
    "export_sales": "week ending Thursday, released the next Thursday 8:30 am ET (Friday after a Thursday holiday)",
    "agtransport": "the dataset's own last-updated time (no fixed release hour)",
}


def iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _nth(year, month, weekday, n):
    d = date(year, month, 1)
    d += timedelta(days=(weekday - d.weekday()) % 7)
    return d + timedelta(weeks=n - 1)


def _last(year, month, weekday):
    d = date(year, month + 1, 1) - timedelta(days=1) if month < 12 else date(year, 12, 31)
    return d - timedelta(days=(d.weekday() - weekday) % 7)


def _observed(d):
    return d - timedelta(days=1) if d.weekday() == 5 else d + timedelta(days=1) if d.weekday() == 6 else d


def federal_holidays(year):
    """The eleven US federal holidays, as observed (a Saturday holiday on Friday, a Sunday one on Monday)."""
    fixed = [date(year, 1, 1), date(year, 6, 19), date(year, 7, 4), date(year, 11, 11), date(year, 12, 25)]
    out = {_observed(d) for d in fixed}
    out |= {_nth(year, 1, 0, 3), _nth(year, 2, 0, 3), _last(year, 5, 0), _nth(year, 9, 0, 1),
            _nth(year, 10, 0, 2), _nth(year, 11, 3, 4)}
    nxt = _observed(date(year + 1, 1, 1))
    if nxt.year == year:
        out.add(nxt)
    return out


def _is_holiday(d):
    return d in federal_holidays(d.year)


def _at_et(d, hh, mm):
    return datetime.combine(d, time(hh, mm), tzinfo=ET)


def scheduled(kind, day):
    """The scheduled release (an aware datetime) for a report's own date: the map's valid Tuesday (usdm), the
    week-ending Sunday (crop_progress) or the week-ending Thursday (export_sales)."""
    if isinstance(day, str):
        day = date.fromisoformat(day[:10])
    if kind == "usdm":
        return _at_et(day + timedelta(days=(3 - day.weekday()) % 7 or 7), 8, 30)   # the Thursday after
    if kind == "crop_progress":
        d = day + timedelta(days=(0 - day.weekday()) % 7 or 7)
        if _is_holiday(d):
            d += timedelta(days=1)
        return _at_et(d, 16, 0)
    if kind == "export_sales":
        d = day + timedelta(days=7)
        if _is_holiday(d):
            d += timedelta(days=1)
        return _at_et(d, 8, 30)
    raise ValueError(f"no schedule for {kind!r}")


def stamp(kind, day, fetched):
    """-> {released_at, released_basis, released_rule} from the schedule, or the fetch time when the
    schedule says later than we already had it. fetched: aware datetime or ISO string."""
    if isinstance(fetched, str):
        fetched = datetime.fromisoformat(fetched.replace("Z", "+00:00"))
    s = scheduled(kind, day)
    if s > fetched:
        return {"released_at": iso(fetched), "released_basis": "fetched", "released_rule": RULES[kind]}
    return {"released_at": iso(s), "released_basis": "schedule", "released_rule": RULES[kind]}


def socrata(metas, fetched):
    """AgTransport: the latest rowsUpdatedAt (epoch seconds) over the datasets a file reads, never after the
    fetch; the fetch time when no dataset states one."""
    if isinstance(fetched, str):
        fetched = datetime.fromisoformat(fetched.replace("Z", "+00:00"))
    ts = [m.get("rowsUpdatedAt") for m in metas if isinstance(m, dict)]
    ts = [t for t in ts if isinstance(t, (int, float)) and not isinstance(t, bool) and t > 0]
    if len(ts) == len(metas) and ts:
        at = datetime.fromtimestamp(max(ts), timezone.utc)
        if at <= fetched:
            return {"released_at": iso(at), "released_basis": "source", "released_rule": RULES["agtransport"]}
    return {"released_at": iso(fetched), "released_basis": "fetched", "released_rule": RULES["agtransport"]}


def selftest():
    ok = 0

    def ck(cond, msg):
        nonlocal ok
        if not cond:
            raise SystemExit("released_at selftest FAILED: " + msg)
        ok += 1

    late = "2026-12-31T00:00:00Z"
    # real files, Nov 9 2026. Drought: map valid Tue Nov 3, out Thu Nov 5 8:30 am EST = 13:30 UTC
    u = stamp("usdm", "2026-11-03", "2026-11-06T14:39:56Z")
    ck(u == {"released_at": "2026-11-05T13:30:00Z", "released_basis": "schedule", "released_rule": RULES["usdm"]}, str(u))
    ck(stamp("usdm", "2026-08-04", late)["released_at"] == "2026-08-06T12:30:00Z", "summer: EDT, 12:30 UTC")
    # Crop Progress: week ending Sun Oct 25, out Mon Oct 26 4 pm EDT = 20:00 UTC
    ck(stamp("crop_progress", "2026-10-25", late)["released_at"] == "2026-10-26T20:00:00Z", "crop progress Monday")
    # Columbus Day Mon Oct 12 2026: Tuesday Oct 13; Labor Day Sep 7 2026: Tuesday Sep 8
    ck(stamp("crop_progress", "2026-10-11", late)["released_at"] == "2026-10-13T20:00:00Z", "Columbus Day -> Tuesday")
    ck(stamp("crop_progress", "2026-09-06", late)["released_at"] == "2026-09-08T20:00:00Z", "Labor Day -> Tuesday")
    ck(stamp("crop_progress", "2026-11-08", late)["released_at"] == "2026-11-09T21:00:00Z", "after the clock change: EST")
    # Export sales: week ending Thu Oct 29, out Thu Nov 5 8:30 am EST; Thanksgiving Nov 26 2026 -> Fri Nov 27
    ck(stamp("export_sales", "2026-10-29", late)["released_at"] == "2026-11-05T13:30:00Z", "export sales Thursday")
    ck(stamp("export_sales", "2026-11-19", late)["released_at"] == "2026-11-27T13:30:00Z", "Thanksgiving -> Friday")
    # a fetch before the scheduled hour: the report was out early that week, so the fetch time stands
    e = stamp("export_sales", "2026-10-29", "2026-11-05T12:00:00Z")
    ck(e["released_at"] == "2026-11-05T12:00:00Z" and e["released_basis"] == "fetched", str(e))
    hol = federal_holidays(2026)
    ck({date(2026, 1, 1), date(2026, 1, 19), date(2026, 2, 16), date(2026, 5, 25), date(2026, 6, 19), date(2026, 7, 3),
        date(2026, 9, 7), date(2026, 10, 12), date(2026, 11, 11), date(2026, 11, 26), date(2026, 12, 25)} == hol, str(sorted(hol)))
    ck(date(2027, 12, 31) in federal_holidays(2027), "New Year 2028 (Saturday) is observed Fri Dec 31 2027")
    # AgTransport: the dataset's own rowsUpdatedAt
    # real: barge rates (deqi-uken) as the vintage job saved them Nov 9: rowsUpdatedAt 1793899242, Thu Nov 5
    # 17:20:42 UTC, newest week Nov 3
    t = 1793899242
    s = socrata([{"rowsUpdatedAt": t}, {"rowsUpdatedAt": t - 86400}], "2026-11-09T17:43:04Z")
    ck(s["released_at"] == "2026-11-05T17:20:42Z" and s["released_basis"] == "source", str(s))
    ck(socrata([{"rowsUpdatedAt": t}, {}], "2026-01-01T00:00:00Z")["released_basis"] == "fetched", "one dataset silent: fetch time")
    ck(socrata([], "2026-01-01T00:00:00Z")["released_basis"] == "fetched", "no metadata: fetch time")
    ck(socrata([{"rowsUpdatedAt": t}], "2026-11-01T00:00:00Z")["released_basis"] == "fetched", "never after the fetch")
    print(f"released_at selftest: ok ({ok} checks)")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
