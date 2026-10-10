#!/usr/bin/env python3
"""
report_bands.py — one definition of "in line", used by everything that says it.

WHY THIS FILE EXISTS

On 2026-09-09 the What's Priced In page said two different things about one
number, on one screen, at the same time:

    Track record   2026/27 corn yield   BULLISH    182.0 -> 180.7
    Scored report  2026/27 corn yield   IN LINE    trade 182 -> actual 180.7

Same metric, same consensus, same print. Two builders, two bands.
build_whats_priced_in.py had been corrected on 2026-08-11 —

    "a flat 2% band is calibrated for ending stocks (2% of 2.1B bu = ~42M,
     sane) but absurd for YIELD (2% of 183 bu = 3.7 bu — nearly any August
     print would score 'in line'). Yield metrics get a tighter band: 0.5% of
     expected (~0.9 bu on corn, ~0.26 on beans) matches how the trade actually
     reads a yield print."

— and build_analyst_scorecard.py had not. Standing rule 37: two places applying
"the same" threshold must apply it to the same quantity. Export one function and
have both callers use it.

THE SECOND THING THIS FIXES. Both copies returned "in line" when there was NO
consensus to compare against:

    if consensus in (None, 0) or actual is None:
        return "in line"

That is not a withheld number, it is an asserted one — the page told a reader
that a print nobody had an estimate for landed where the trade expected. It now
returns "" and every caller prints the reason instead.

THE RULE CHANGED ON 2026-10-10 (Sig approved it). From 2026-10-03 to
2026-10-09 any print inside the trade's range was "in line", however far from
the average. On 2026-10-09 October corn stocks came in 10.3% over the trade
average and the corn yield 1.9% over, both read "in line", and corn fell 19 3/4
cents that day. The grade is the distance from the trade AVERAGE again, with a
band per kind of number (yield 0.5%, production 1%, stocks 2%). The range is
context printed beside the grade ("inside the range, near the top"), not the
grade. Every history row was regraded under this rule; RULE_CHANGED says when.

AND A SURVEY CAN ONLY GRADE A PRINT IF IT CAME FIRST. consensus_lock() refuses
any trade average, low or high whose source is not dated before the release.
That catches the other October mistake: ranges typed in Friday evening, after
the report, flipped two grades.

    python3 scripts/report_bands.py --selftest
"""
import sys
from datetime import date as _date, datetime, timezone

try:
    from zoneinfo import ZoneInfo
    _ET = ZoneInfo("America/New_York")
except Exception:          # pragma: no cover
    _ET = None

# The day the grading rule below took over. Pages print it in their method text.
RULE_CHANGED = "2026-10-10"

# Within this much of the trade AVERAGE counts as landing where the trade
# expected. Stocks run in the billions of bushels and move in tens of millions;
# production in billions and moves in tens of millions off a smaller miss;
# yields run in the tens and move in tenths.
IN_LINE_PCT = 0.02              # stocks, and anything not named below
IN_LINE_PCT_PRODUCTION = 0.01
IN_LINE_PCT_YIELD = 0.005

# WHAT KIND OF NUMBER IT IS, read off the label both source files carry
# ("2026/27 corn yield", "2026/27 corn production", "Corn stocks, all
# positions, Sept 1"). Yield is checked first so "yield per harvested acre"
# never lands in another band.
YIELD_WORDS = ("yield",)
PRODUCTION_WORDS = ("production",)

# Which way is bullish. A SUPPLY number (stocks, production, yield) printed
# above the trade average is more supply than expected: bearish. A DEMAND
# number (exports, crush, use) printed above it is bullish. analyst-estimates
# carries a `direction` on every metric; a row with none is supply, which is
# every kind this site grades today.
DIRECTIONS = ("supply", "demand")


def band_for(metric_label):
    """The in-line band for this metric, as a fraction of the trade average."""
    label = str(metric_label or "").lower()
    if any(w in label for w in YIELD_WORDS):
        return IN_LINE_PCT_YIELD
    if any(w in label for w in PRODUCTION_WORDS):
        return IN_LINE_PCT_PRODUCTION
    return IN_LINE_PCT


def _range(low, high):
    """(lo, hi) when both bounds are usable numbers in order, else None."""
    if low is None or high is None:
        return None
    try:
        lo, hi = float(low), float(high)
    except (TypeError, ValueError):
        return None
    return (lo, hi) if lo <= hi else None


def _direction(direction):
    d = str(direction or "supply").lower()
    if d not in DIRECTIONS:
        raise ValueError("unknown metric direction %r (want one of %s)" % (direction, ", ".join(DIRECTIONS)))
    return d


def surprise(expected, actual, metric_label="", low=None, high=None, direction="supply"):
    """"bullish" | "bearish" | "in line" | "" -- and "" means NOT COMPARABLE.

    gap = (actual - average) / average. Within the band for this kind of number
    (band_for) it is "in line". Outside it, a supply number above the average
    is bearish and below it bullish; a demand number the other way round.

    low and high are accepted so every caller passes the same arguments, but
    they do not change the grade. They are context, and range_context() words
    them. (From 2026-10-03 to 2026-10-09 the range decided the grade; see the
    header.)

    The empty string is the important return. It means there was no estimate to
    compare against, and a caller must print that in words rather than let a
    reader assume the print was unremarkable.
    """
    d = _direction(direction)
    if expected in (None, 0) or actual is None:
        return ""
    gap = (actual - expected) / abs(expected)
    if abs(gap) <= band_for(metric_label):
        return "in line"
    above = actual > expected
    if d == "supply":
        return "bearish" if above else "bullish"
    return "bullish" if above else "bearish"


def range_context(actual, low=None, high=None):
    """Where the print sat against the survey's own low and high, in words.

    "outside the trade range", "inside the range, near the top", "inside the
    range, near the bottom", "inside the range", or "" when no range is on file
    or nothing printed. Near the top / bottom is the outer third of the range.
    """
    rng = _range(low, high)
    if not rng or actual is None:
        return ""
    lo, hi = rng
    if actual < lo or actual > hi:
        return "outside the trade range"
    if hi == lo:
        return "inside the range"
    pos = (actual - lo) / (hi - lo)
    if pos >= 2 / 3:
        return "inside the range, near the top"
    if pos <= 1 / 3:
        return "inside the range, near the bottom"
    return "inside the range"


def describe(expected, actual, metric_label="", low=None, high=None, direction="supply"):
    """The words a card prints for one figure. One function, so the homepage
    card, What's Priced In, the Wire and the report-day email cannot phrase the
    same print two ways.

      "bearish, inside the range, near the top"
      "bullish, outside the trade range"
      "in line"                       (no range on file)
      "no trade estimate" / "not printed yet"
    """
    if actual is None:
        return "not printed yet"
    if expected in (None, 0):
        return "no trade estimate"
    v = surprise(expected, actual, metric_label, low, high, direction)
    ctx = range_context(actual, low, high)
    return v + (", " + ctx if ctx else "")


def gap_pct(expected, actual):
    """Signed distance from the trade estimate, in percent, or None."""
    if expected in (None, 0) or actual is None:
        return None
    return round((actual - expected) / abs(expected) * 100, 1)


# ── THE LOCK: A SURVEY HAS TO COME BEFORE THE PRINT IT GRADES ────────────────
#
# Every trade average, low and high in data/analyst-estimates.json carries
# consensus_source_date (YYYY-MM-DD), the date the source published it. It must
# fall before the report's release (12:00 PM ET on the report date). A source
# dated the report day itself can only pass with consensus_source_time_utc
# ("HH:MM") before the release; without a time it cannot be shown to come first.
#
# Reports dated after LOCK_REQUIRED_AFTER must carry the date or the build
# fails. Older entries whose source date could not be established are kept and
# come back "unknown" so the page can say "source date unknown" beside them.
LOCK_REQUIRED_AFTER = "2026-10-10"


class ConsensusLockError(ValueError):
    pass


def release_utc(report_date, hour_et=12):
    """The release moment in UTC: 12:00 PM ET on the report date, DST aware."""
    d = _date.fromisoformat(str(report_date)[:10])
    if _ET is None:        # pragma: no cover
        return datetime(d.year, d.month, d.day, hour_et + 4, tzinfo=timezone.utc)
    return datetime(d.year, d.month, d.day, hour_et, tzinfo=_ET).astimezone(timezone.utc)


def source_status(report_date, source_date, source_time_utc=None):
    """"dated" when the source is shown to come before the release, "unknown"
    when no source date is on file. Raises ConsensusLockError when the date is
    malformed, on or after the release, or the same day with no time."""
    if source_date in (None, ""):
        return "unknown"
    try:
        sd = _date.fromisoformat(str(source_date))
    except ValueError:
        raise ConsensusLockError("consensus_source_date %r is not YYYY-MM-DD" % (source_date,))
    rel = release_utc(report_date)
    if sd < _date.fromisoformat(str(report_date)[:10]):
        return "dated"
    if sd > _date.fromisoformat(str(report_date)[:10]):
        raise ConsensusLockError("source dated %s, after the %s report" % (sd, report_date))
    if not source_time_utc:
        raise ConsensusLockError("source dated %s, the report day, with no time: it cannot be "
                                 "shown to come before the 12:00 PM ET release" % sd)
    try:
        hh, mm = (int(x) for x in str(source_time_utc).split(":")[:2])
    except ValueError:
        raise ConsensusLockError("consensus_source_time_utc %r is not HH:MM" % (source_time_utc,))
    if datetime(sd.year, sd.month, sd.day, hh, mm, tzinfo=timezone.utc) >= rel:
        raise ConsensusLockError("source at %s %s UTC is not before the release at %s UTC"
                                 % (sd, source_time_utc, rel.strftime("%H:%M")))
    return "dated"


def consensus_lock(book):
    """Check every metric in an analyst-estimates book.

    Returns {(report date, label): "dated" | "unknown"} for every metric that
    carries a consensus or a range. Raises ConsensusLockError listing every
    violation at once, so a build fails loudly and says what to fix."""
    status, errors = {}, []
    for rpt in (book or {}).get("reports") or []:
        rdate = rpt.get("date")
        for m in rpt.get("metrics") or []:
            rng = [x for x in (m.get("consensus_range") or []) if x is not None]
            if m.get("consensus") is None and not rng:
                continue
            key = (rdate, m.get("label"))
            try:
                st = source_status(rdate, m.get("consensus_source_date"), m.get("consensus_source_time_utc"))
                if st == "unknown" and str(rdate) > LOCK_REQUIRED_AFTER:
                    raise ConsensusLockError("no consensus_source_date; required for reports after %s"
                                             % LOCK_REQUIRED_AFTER)
                status[key] = st
            except (ConsensusLockError, ValueError) as e:
                errors.append("%s %s: %s" % (rdate, m.get("label"), e))
    if errors:
        raise ConsensusLockError("trade estimates not dated before their report:\n  " + "\n  ".join(errors))
    return status


def _selftest():
    fails = []

    def check(got, want, label):
        ok = got == want
        print(("  ok    " if ok else "  FAIL  ") + label + ("" if ok else "  -- got %r want %r" % (got, want)))
        if not ok:
            fails.append(label)

    print("three bands, picked by the label")
    check(band_for("2026/27 corn yield"), 0.005, "a yield label gets 0.5%")
    check(band_for("2026/27 corn production"), 0.01, "a production label gets 1%")
    check(band_for("2026/27 winter wheat production"), 0.01, "winter wheat production is production")
    check(band_for("2026/27 corn ending stocks"), 0.02, "an ending stocks label gets 2%")
    check(band_for("Corn stocks, all positions, Sept 1"), 0.02, "a Grain Stocks label gets 2%")
    check(band_for(""), 0.02, "an unlabelled metric gets the widest band, not the tightest")
    check(band_for(None), 0.02, "and None does not throw")

    print("\nOctober 9 2026 WASDE, the day that changed the rule (the expected grades Sig approved)")
    OCT = [  # label, average, low, high, print, want
        ("2026/27 corn yield", 177.8, 173.2, 182.1, 181.2, "bearish, inside the range, near the top"),
        ("2026/27 soybean yield", 52.9, 51.4, 54.1, 53.1, "in line, inside the range"),
        ("2026/27 corn ending stocks", 1.677, 1.522, 1.895, 1.849, "bearish, inside the range, near the top"),
        ("2026/27 soybean ending stocks", 311, 245, 358, 315, "in line, inside the range"),
        ("2026/27 wheat ending stocks", 722, 701, 750, 740, "bearish, inside the range, near the top"),
        ("2026/27 corn production", 15.716, 15.344, 16.115, 16.034, "bearish, inside the range, near the top"),
        ("2026/27 soybean production", 4541, 4415, 4648, 4562, "in line, inside the range"),
    ]
    for label, avg, lo, hi, act, want in OCT:
        check(describe(avg, act, label, lo, hi), want, "%s %s -> %s" % (label, avg, act))
    # 181.2 vs 177.8 is +1.91%, almost four times the yield band. Inside the
    # range is no longer a pass: this read "in line" the day corn fell 19 3/4.
    check(surprise(177.8, 181.2, "2026/27 corn yield", 173.2, 182.1), "bearish",
          "corn yield +1.9% inside its range is bearish, not in line")
    # 4562 vs 4541 is +0.46%, under the 1% production band.
    check(surprise(4541, 4562, "2026/27 soybean production"), "in line", "soy production +0.46% is in line")
    # The production band sits between the other two: +0.85% passes on
    # production and would fail on a yield; +1.17% fails on production and
    # would pass on stocks.
    check(surprise(15.716, 15.85, "2026/27 corn yield"), "bearish", "+0.85% on a yield is bearish")
    check(surprise(15.716, 15.90, "2026/27 corn ending stocks"), "in line", "+1.17% on stocks is in line")
    check(surprise(15.716, 15.85, "2026/27 corn production"), "in line", "corn production +0.85% is in line")
    check(surprise(15.716, 15.90, "2026/27 corn production"), "bearish", "corn production +1.17% is not")
    check(describe(None, 1534, "2026/27 wheat production"), "no trade estimate", "wheat production is ungraded")

    print("\nthe other reports on file, regraded")
    # September 30 Grain Stocks, Pro Farmer survey published 2026-09-26.
    check(describe(1.918, 2.095, "Corn stocks, all positions, Sept 1", 1.843, 2.005),
          "bearish, outside the trade range", "corn stocks 2.095 over the 2.005 top: bearish, outside")
    # 0.315 vs 0.324 is -2.8%, past 2%. The side effect the plan named: this
    # read "in line" under the range rule and is bullish again.
    check(describe(0.324, 0.315, "Soybean stocks, all positions, Sept 1", 0.304, 0.349),
          "bullish, inside the range, near the bottom", "soy stocks 0.315: bullish, inside the range")
    # September 11 WASDE soybean yield: 52.5 -> 52.8 is +0.57%, past 0.5%.
    check(surprise(52.5, 52.8, "2026/27 soybean yield", 51.5, 53.3), "bearish", "Sept soy yield +0.57% is bearish")
    # August corn yield: 182.0 -> 180.7 is -0.71%.
    check(surprise(182.0, 180.7, "2026/27 corn yield"), "bullish", "Aug corn yield -0.7% is bullish")
    check(surprise(52.9, 52.7, "2026/27 soybean yield"), "in line", "Aug soy yield -0.38% is in line")
    # June wheat ending stocks: 765 -> 744 is -2.7%, outside 2%, inside 740-804.
    check(describe(765, 744, "2026/27 wheat ending stocks", 740, 804),
          "bullish, inside the range, near the bottom", "June wheat stocks -2.7% is bullish")
    check(surprise(2.138, 2.145, "2025/26 corn ending stocks", 2.087, 2.297), "in line", "June corn 25/26 +0.3% in line")
    check(surprise(1208, 1048, "2026/27 winter wheat production"), "bullish", "May winter wheat -13.2% bullish")
    check(surprise(1.922, 1.957, "2026/27 corn ending stocks"), "in line", "May corn stocks +1.8% in line")

    print("\nthe edge of the band is inside it")
    check(surprise(100.0, 102.0, "corn ending stocks"), "in line", "exactly +2.0% on stocks is in line")
    check(surprise(100.0, 102.01, "corn ending stocks"), "bearish", "and 2.01% is not")
    check(surprise(200.0, 201.0, "corn yield"), "in line", "exactly +0.5% on a yield is in line")

    print("\ndirection: a demand number reads the other way")
    check(surprise(100, 110, "2026/27 corn exports", direction="demand"), "bullish", "exports over the average are bullish")
    check(surprise(100, 90, "2026/27 corn exports", direction="demand"), "bearish", "exports under it are bearish")
    check(surprise(100, 110, "2026/27 corn ending stocks", direction="supply"), "bearish", "stocks over it are bearish")
    check(surprise(100, 110, "2026/27 corn ending stocks", direction=None), "bearish", "no direction means supply")
    try:
        surprise(100, 110, "x", direction="sideways")
        check("no error", "ValueError", "an unknown direction is refused, not guessed")
    except ValueError:
        check(True, True, "an unknown direction is refused, not guessed")

    print("\nthe range is context, worded the same everywhere")
    check(range_context(0.340, 0.304, 0.349), "inside the range, near the top", "upper third is near the top")
    check(range_context(0.326, 0.304, 0.349), "inside the range", "middle third is just inside")
    check(range_context(0.300, 0.304, 0.349), "outside the trade range", "under the low end is outside")
    check(range_context(0.349, 0.304, 0.349), "inside the range, near the top", "the high end itself is inside")
    check(range_context(0.33, 0.304, None), "", "a half range is no range")
    check(range_context(0.33, 0.349, 0.304), "", "a reversed range is no range")
    check(range_context(None, 0.304, 0.349), "", "nothing printed, nothing to place")
    check(describe(182.0, 180.7, "2026/27 corn yield"), "bullish", "no range on file: the grade alone")
    check(describe(0.324, None, "soy stocks", 0.304, 0.349), "not printed yet", "an unreleased print says so")

    print("\nno estimate is not the same as no surprise")
    check(surprise(None, 180.7, "2026/27 corn yield"), "", "a metric with no consensus returns the empty string")
    check(surprise(0, 180.7, "corn yield"), "", "and so does a zero consensus")
    check(surprise(182.0, None, "corn yield"), "", "and so does an unreleased actual")

    print("\nthe distance itself")
    check(gap_pct(182.0, 180.7), -0.7, "corn yield is 0.7% under the trade")
    check(gap_pct(1.677, 1.849), 10.3, "Oct corn stocks 10.3% over")
    check(gap_pct(None, 744), None, "no estimate, no distance")

    print("\nthe lock: a survey must be dated before the release")
    check(release_utc("2026-10-09").strftime("%Y-%m-%d %H:%M"), "2026-10-09 16:00", "Oct 9 noon ET is 16:00 UTC")
    check(release_utc("2026-12-10").strftime("%H:%M"), "17:00", "Dec 10 noon ET is 17:00 UTC (standard time)")
    check(source_status("2026-10-09", "2026-10-07"), "dated", "DTN's Oct 7 survey grades the Oct 9 print")
    check(source_status("2026-10-09", None), "unknown", "no date on file is unknown, not refused, for an old report")
    check(source_status("2026-10-09", "2026-10-09", "14:08"), "dated", "report-day source at 14:08 UTC is before 16:00")

    def refused(*a):
        try:
            source_status(*a)
            return False
        except ConsensusLockError:
            return True
    check(refused("2026-10-09", "2026-10-09"), True, "report-day source with no time is refused")
    check(refused("2026-10-09", "2026-10-09", "16:00"), True, "a source at the release minute is refused")
    check(refused("2026-10-09", "2026-10-10"), True, "a source dated after the report is refused")
    check(refused("2026-10-09", "2026-10"), True, "a month alone is not a date")
    book = {"reports": [
        {"date": "2026-10-09", "metrics": [
            {"label": "a", "consensus": 1, "consensus_source_date": "2026-10-07"},
            {"label": "b", "consensus": 1},
            {"label": "c", "consensus": None, "consensus_range": []}]},
        {"date": "2026-11-10", "metrics": [
            {"label": "a", "consensus": 1, "consensus_source_date": "2026-11-06"}]}]}
    st = consensus_lock(book)
    check(st, {("2026-10-09", "a"): "dated", ("2026-10-09", "b"): "unknown", ("2026-11-10", "a"): "dated"},
          "the book reads dated / unknown; an empty metric is skipped")
    for bad, why in (
            ({"date": "2026-11-10", "metrics": [{"label": "x", "consensus": 1}]},
             "a new report with no source date fails the build"),
            ({"date": "2026-11-10", "metrics": [{"label": "x", "consensus_range": [1, 2],
                                                 "consensus_source_date": "2026-11-10"}]},
             "a range alone typed from a report-day source fails too"),
            ({"date": "2026-10-09", "metrics": [{"label": "x", "consensus": 1,
                                                 "consensus_source_date": "2026-10-10"}]},
             "an old report with a post-release source fails")):
        try:
            consensus_lock({"reports": [bad]})
            check("passed", "refused", why)
        except ConsensusLockError:
            check(True, True, why)

    print()
    if fails:
        print("FAILED (%d): %s" % (len(fails), "; ".join(fails)))
        return 1
    print("report bands: all passed")
    return 0


if __name__ == "__main__":
    sys.exit(_selftest() if "--selftest" in sys.argv else 0)
