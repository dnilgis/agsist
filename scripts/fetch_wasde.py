#!/usr/bin/env python3
"""
fetch_wasde.py — fill in a USDA report's actual numbers the moment they exist.

WHAT IT REPLACES

Sig, 2026-09-10: "i want the wasde what priced in page to process the reports
the moment they are available for release."

Until now the second of the three hand steps in data/analyst-estimates.json —
"(2) after USDA releases, fill each metric's `actual`" — was a person typing a
number into the GitHub editor. Nothing on the page moves until that happens: an
ungraded report never reaches "Graded calls", every call filed for it drops off
"Calls on the board" the day after the release, and no forecaster gains a scored
call. The July WASDE went unscored exactly this way and the track record still
carries the gap.

WHERE THE NUMBER COMES FROM, AND WHY IT IS NOT THE WASDE PDF

The two metrics this board grades are the national corn and soybean YIELDS, and
those are NASS's numbers — WASDE prints what the Crop Production report
publishes the same morning. NASS has a documented JSON API, this repository
already reads it in eight workflows, and NASS_API_KEY is already a secret. The
WASDE's own XML would be a second acquisition route for the same figure.

    corn 2026, national, YIELD, BU / ACRE, reference_period_desc = "SEP"

THAT PERIOD FIELD IS THE WHOLE MECHANISM, and it is the opposite of the pin
build_nass_series.py uses. That file pins reference_period_desc = "YEAR" to keep
the in-season AUG..NOV forecasts OUT of a series of finals. Here the in-season
forecast is precisely what a September WASDE prints, so the query asks for the
release month by name. A row for "SEP" does not exist until NASS publishes it,
which makes "has the report landed" a question the data answers rather than one
the clock guesses at.

WHAT IT REFUSES TO DO

  • Write anything before the report is public. scripts/usda_dates.py already
    encodes that a WASDE's results do not exist before 16:00 UTC on release day,
    a rule written after the 2026-08-11 incident where a briefing announced a
    WASDE the day before it landed. This asks that function, not the clock.
  • Write a figure for a metric it cannot source. NASS publishes a survey yield
    in August, September, October and November, and a final in the January
    annual summary. A May WASDE's corn yield is USDA's own trend projection and
    is not in NASS at all; ending stocks are in no NASS table at any time of
    year. Those metrics are named in the run's output and left null.
  • Overwrite an actual somebody already filled. A number in the file is a
    decision; this only fills holes.
  • Touch a report other than the one that just released.

    python3 scripts/fetch_wasde.py                 fill what is available now
    python3 scripts/fetch_wasde.py --date 2026-09-11   a specific release
    python3 scripts/fetch_wasde.py --dry-run       print, write nothing
    python3 scripts/fetch_wasde.py --selftest      no network, hand-worked

Needs NASS_API_KEY. Stdlib only.
"""
import argparse
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import usda_dates  # noqa: E402

ROOT = HERE.parent
EST_PATH = ROOT / "data" / "analyst-estimates.json"
HIST_PATH = ROOT / "data" / "wpi-history.json"
OUT_PATH = ROOT / "data" / "wasde.json"

API = "https://quickstats.nass.usda.gov/api/api_GET/"
API_KEY = os.environ.get("NASS_API_KEY", "")
UA = "AGSIST/1.0 (+https://agsist.com)"

# WHICH NASS SERIES ANSWERS WHICH METRIC. Keyed on the metric `key` in
# data/analyst-estimates.json, so adding a metric to the board means adding a
# row here or being told, by name, that it cannot be graded.
#
# `short_desc` is stated in full rather than assembled from parts: NASS's own
# label is the identifier, and a query built from four separate fields can match
# a different series when one of them changes.
SERIES = {
    "corn_yield": {
        "short_desc": "CORN, GRAIN - YIELD, MEASURED IN BU / ACRE",
        "unit": "bu/acre",
    },
    "soy_yield": {
        "short_desc": "SOYBEANS - YIELD, MEASURED IN BU / ACRE",
        "unit": "bu/acre",
    },
}

# THE MONTHS NASS PUBLISHES A SURVEY YIELD, and what it calls the period.
# August is the first survey-based corn and soybean yield of the crop year;
# January's annual summary is the final. Everything else in the WASDE calendar
# prints a USDA projection that is not a NASS estimate, and this file will not
# pretend otherwise.
FORECAST_PERIOD = {8: "AUG", 9: "SEP", 10: "OCT", 11: "NOV", 1: "YEAR"}


def metric_series(key):
    """The NASS series for a metric key, or None with the reason."""
    k = str(key or "").lower()
    for name, spec in SERIES.items():
        if k.startswith(name):
            return name, spec
    return None, None


CROP_YEAR = re.compile(r"\b(19|20)(\d{2})\s*/\s*\d{2}\b")


def crop_year(label):
    """The first year of the crop year a metric is about, read off its label.

    "2026/27 corn yield" -> 2026. A label this cannot read gets no number:
    guessing a crop year would grade a forecaster against the wrong harvest."""
    m = CROP_YEAR.search(str(label or ""))
    return int(m.group(1) + m.group(2)) if m else None


def nass_rows(short_desc, year, period, key=None, opener=None):
    params = {"key": key if key is not None else API_KEY,
              "short_desc": short_desc,
              "agg_level_desc": "NATIONAL",
              "source_desc": "SURVEY",
              "year": str(year),
              "reference_period_desc": period,
              "format": "JSON"}
    url = API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with (opener or urllib.request.urlopen)(req, timeout=60) as r:
        return json.load(r).get("data", [])


def read_value(rows):
    """One number from a NASS answer, or (None, why).

    NASS suppresses values as "(D)", "(NA)", "(X)" and "(Z)"; those are answers
    about disclosure, not measurements, and are refused rather than coerced."""
    if not rows:
        return None, "NASS has no row for it yet"
    vals = []
    for r in rows:
        v = (r.get("Value") or "").strip().replace(",", "")
        if not v or v[0] == "(":
            continue
        try:
            vals.append((float(v), r))
        except ValueError:
            continue
    if not vals:
        return None, "NASS returned only suppressed values"
    # More than one row for one series, one year and one period should not
    # happen. If it does, the query is matching something it should not, and a
    # number picked out of an ambiguous answer is worse than none.
    distinct = {v for v, _ in vals}
    if len(distinct) > 1:
        return None, ("NASS returned %d different values for one series and period (%s)"
                      % (len(distinct), ", ".join(str(d) for d in sorted(distinct))))
    return vals[0][0], None


def plan(est, release):
    """What this release can and cannot fill, decided before anything is asked.

    Returns (jobs, skipped) where a job is a metric that has a NASS series, a
    readable crop year, a period NASS publishes in this month, and no actual
    already on file."""
    jobs, skipped = [], []
    iso = release.isoformat()
    period = FORECAST_PERIOD.get(release.month)
    for rep in est.get("reports", []):
        if (rep.get("date") or "") != iso:
            continue
        for met in rep.get("metrics", []):
            label = met.get("label") or met.get("key") or ""
            if met.get("actual") is not None:
                skipped.append((label, "already filled in"))
                continue
            name, spec = metric_series(met.get("key"))
            if not spec:
                skipped.append((label, "no NASS series answers this metric — "
                                       "ending stocks and balance-sheet lines are "
                                       "printed only in the WASDE itself"))
                continue
            year = crop_year(label)
            if year is None:
                skipped.append((label, "its label does not state a crop year"))
                continue
            if not period:
                skipped.append((label, "NASS publishes no survey yield in %s — this "
                                       "month's WASDE figure is USDA's own projection"
                                       % release.strftime("%B")))
                continue
            jobs.append({"report": rep.get("report", ""), "date": iso, "key": met.get("key"),
                         "label": label, "unit": met.get("unit") or spec["unit"],
                         "consensus": met.get("consensus"), "year": year,
                         "period": period, "short_desc": spec["short_desc"]})
    return jobs, skipped


def apply_actuals(est, hist, filled):
    """Write each number into both files that need it, and say what changed.

    THE CONSENSUS IS COPIED, NEVER RETYPED. data/wpi-history.json's `expected`
    and analyst-estimates.json's `consensus` are the same figure kept in two
    files by hand, with nothing checking them against each other. A row this
    creates takes the consensus from the estimates file, so the two cannot
    disagree about a report the machine filled."""
    changed = []
    by_key = {(f["date"], f["key"]): f for f in filled}
    for rep in est.get("reports", []):
        for met in rep.get("metrics", []):
            f = by_key.get((rep.get("date"), met.get("key")))
            if f and met.get("actual") is None:
                met["actual"] = f["value"]
                changed.append("actual %s = %s" % (f["label"], f["value"]))
    rows = hist.setdefault("history", [])
    for f in filled:
        row = next((r for r in rows if r.get("date") == f["date"]
                    and (r.get("metric") or "") == f["label"]), None)
        if row is None:
            rows.append({"date": f["date"], "report": f["report"], "metric": f["label"],
                         "expected": f["consensus"], "actual": f["value"],
                         "unit": f["unit"], "reaction": ""})
            changed.append("track-record row for %s" % f["label"])
        elif row.get("actual") is None:
            row["actual"] = f["value"]
            if row.get("expected") is None:
                row["expected"] = f["consensus"]
            changed.append("track-record actual for %s" % f["label"])
    return changed


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", help="release date to process, YYYY-MM-DD")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args(argv)
    if a.selftest:
        return selftest()

    now = datetime.now(timezone.utc)
    today = now.date()
    release = date.fromisoformat(a.date) if a.date else usda_dates.prior_wasde(today) or today
    if a.date is None and usda_dates.next_wasde(today) == today:
        release = today

    print("fetch_wasde: release %s, now %s UTC" % (release, now.strftime("%Y-%m-%d %H:%M")))

    # ── IS IT OUT YET? Asked of the shipped rule, not of a number here. ──
    if release == today and not usda_dates.wasde_results_are_public(today, now):
        print("  the report is not public yet — USDA prints at 16:00 UTC and it is "
              "%s. Nothing written." % now.strftime("%H:%M"))
        return 0
    if release > today:
        print("  %s has not happened. Nothing written." % release)
        return 0

    est = json.loads(EST_PATH.read_text())
    hist = json.loads(HIST_PATH.read_text()) if HIST_PATH.exists() else {"history": []}
    jobs, skipped = plan(est, release)
    for label, why in skipped:
        print("  skipped  %-32s %s" % (label[:32], why))
    if not jobs:
        print("  nothing to fill for %s." % release)
        return 0
    if not API_KEY:
        print("  NASS_API_KEY is not set. Get a free key at "
              "https://quickstats.nass.usda.gov/api/ and add it as a repository secret.")
        return 1

    filled, waiting = [], []
    for j in jobs:
        try:
            rows = nass_rows(j["short_desc"], j["year"], j["period"])
        except Exception as ex:
            waiting.append((j["label"], "%s: %s" % (type(ex).__name__, str(ex)[:80])))
            continue
        value, why = read_value(rows)
        if value is None:
            waiting.append((j["label"], why))
            continue
        j["value"] = value
        filled.append(j)
        print("  read     %-32s %s %s  (NASS %s %s)"
              % (j["label"][:32], value, j["unit"], j["year"], j["period"]))
    for label, why in waiting:
        print("  waiting  %-32s %s" % (label[:32], why))

    if not filled:
        # THIS IS THE NORMAL ANSWER BEFORE THE RELEASE LANDS, and it is not a
        # failure. The watcher runs every five minutes inside the window; the
        # run that finds nothing exits 0 so a red tick means something is
        # actually wrong.
        print("  nothing published yet. This run wrote nothing and that is not an error.")
        return 0

    changed = apply_actuals(est, hist, filled)
    stamp = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    doc = {"generated": stamp, "release": release.isoformat(),
           "source": "USDA NASS Quick Stats — https://quickstats.nass.usda.gov/api/",
           "note": ("What USDA actually printed, read from the NASS series the WASDE "
                    "yield figures come from. Written only after the release is public. "
                    "Metrics with no NASS series are listed in `unavailable` and are "
                    "filled by hand or not at all."),
           "metrics": [{"key": f["key"], "label": f["label"], "value": f["value"],
                        "unit": f["unit"], "consensus": f["consensus"],
                        "nass": {"short_desc": f["short_desc"], "year": f["year"],
                                 "period": f["period"]}} for f in filled],
           "unavailable": [{"metric": m, "why": w} for m, w in skipped + waiting]}
    if a.dry_run:
        print("\n--dry-run: would write %d change(s):" % len(changed))
        for c in changed:
            print("   " + c)
        return 0
    EST_PATH.write_text(json.dumps(est, indent=2) + "\n")
    HIST_PATH.write_text(json.dumps(hist, indent=2) + "\n")
    OUT_PATH.write_text(json.dumps(doc, indent=1) + "\n")
    print("\nwrote %d change(s):" % len(changed))
    for c in changed:
        print("   " + c)
    print("wrote %s, %s, %s" % (EST_PATH.name, HIST_PATH.name, OUT_PATH.name))
    return 0


def selftest():
    fails = []

    def check(cond, label, detail=""):
        print(("  ok    " if cond else "  FAIL  ") + label + ("" if cond else "  -- " + detail))
        if not cond:
            fails.append(label)

    print("THE RELEASE CALENDAR IS THE SHIPPED ONE")
    check(date(2026, 9, 11) in usda_dates.WASDE_2026, "September's WASDE is 2026-09-11")
    check(not usda_dates.wasde_results_are_public(
        date(2026, 9, 11), datetime(2026, 9, 11, 15, 59, tzinfo=timezone.utc)),
        "one minute before 16:00 UTC on release day, the results are not public")
    check(usda_dates.wasde_results_are_public(
        date(2026, 9, 11), datetime(2026, 9, 11, 16, 0, tzinfo=timezone.utc)),
        "and at 16:00 UTC they are")

    print("\nWHICH METRICS THIS CAN ANSWER, AND WHICH IT SAYS IT CANNOT")
    est = {"reports": [{"report": "September WASDE", "date": "2026-09-11", "metrics": [
        {"key": "corn_yield_2627", "label": "2026/27 corn yield", "unit": "bu/acre",
         "consensus": 182.5, "actual": None},
        {"key": "soy_yield_2627", "label": "2026/27 soybean yield", "unit": "bu/acre",
         "consensus": 53.1, "actual": None},
        {"key": "corn_stocks_2627", "label": "2026/27 corn ending stocks", "unit": "bil bu",
         "consensus": 1.96, "actual": None},
        {"key": "corn_yield_2526", "label": "2025/26 corn yield", "unit": "bu/acre",
         "consensus": 186.0, "actual": 186.5},
    ]}, {"report": "August WASDE", "date": "2026-08-12", "metrics": [
        {"key": "corn_yield_2627", "label": "2026/27 corn yield", "consensus": 182.0,
         "actual": None}]}]}
    jobs, skipped = plan(est, date(2026, 9, 11))
    check(len(jobs) == 2, "two of the four metrics can be filled", str(len(jobs)))
    check({j["key"] for j in jobs} == {"corn_yield_2627", "soy_yield_2627"},
          "the two yields", str([j["key"] for j in jobs]))
    check(all(j["period"] == "SEP" for j in jobs),
          "asked for the SEPTEMBER forecast, which is what a September WASDE prints")
    check(all(j["year"] == 2026 for j in jobs),
          "for the 2026 crop, read off the 2026/27 label")
    reasons = dict(skipped)
    check("ending stocks" in reasons.get("2026/27 corn ending stocks", ""),
          "ending stocks is refused BY NAME with the reason",
          str(reasons.get("2026/27 corn ending stocks")))
    check(reasons.get("2025/26 corn yield") == "already filled in",
          "a number already on file is left alone")
    check(all(j["date"] == "2026-09-11" for j in jobs),
          "and August's unfilled metric is not touched by a September run")

    print("\nA MONTH NASS DOES NOT SURVEY IS SAID OUT LOUD")
    may = {"reports": [{"report": "May WASDE", "date": "2026-05-12", "metrics": [
        {"key": "corn_yield_2627", "label": "2026/27 corn yield", "actual": None}]}]}
    jobs2, skipped2 = plan(may, date(2026, 5, 12))
    check(not jobs2, "May asks NASS for nothing")
    check("May" in dict(skipped2).get("2026/27 corn yield", ""),
          "and says why, naming the month", str(skipped2))

    print("\nWHAT COMES BACK IS READ, OR REFUSED")
    check(read_value([{"Value": "180.7"}]) == (180.7, None), "a plain number")
    check(read_value([{"Value": "1,234"}]) == (1234.0, None), "a thousands separator")
    check(read_value([])[0] is None, "no rows is not a number")
    check("no row" in read_value([])[1], "and says the report has not landed")
    check(read_value([{"Value": "(D)"}])[0] is None, "a disclosure flag is not a number")
    check(read_value([{"Value": "180.7"}, {"Value": "180.7"}]) == (180.7, None),
          "the same value twice is one answer")
    two = read_value([{"Value": "180.7"}, {"Value": "182.0"}])
    check(two[0] is None and "different values" in two[1],
          "two different values is an ambiguous query, and refused", str(two))

    print("\nA CROP YEAR IS READ, NEVER GUESSED")
    check(crop_year("2026/27 corn yield") == 2026, "2026/27 is the 2026 crop")
    check(crop_year("2025/26 corn ending stocks") == 2025, "2025/26 is the 2025 crop")
    check(crop_year("corn yield") is None, "a label with no crop year gets no year")

    print("\nBOTH FILES ARE FILLED, AND NEITHER IS OVERWRITTEN")
    est2 = {"reports": [{"report": "September WASDE", "date": "2026-09-11", "metrics": [
        {"key": "corn_yield_2627", "label": "2026/27 corn yield", "consensus": 182.5,
         "actual": None},
        {"key": "soy_yield_2627", "label": "2026/27 soybean yield", "consensus": 53.1,
         "actual": 52.0}]}]}
    hist2 = {"history": [{"date": "2026-09-11", "report": "September WASDE",
                          "metric": "2026/27 soybean yield", "expected": 53.1,
                          "actual": None, "unit": "bu/acre", "reaction": "typed by hand"}]}
    filled = [{"date": "2026-09-11", "report": "September WASDE", "key": "corn_yield_2627",
               "label": "2026/27 corn yield", "unit": "bu/acre", "consensus": 182.5,
               "value": 181.3},
              {"date": "2026-09-11", "report": "September WASDE", "key": "soy_yield_2627",
               "label": "2026/27 soybean yield", "unit": "bu/acre", "consensus": 53.1,
               "value": 53.4}]
    apply_actuals(est2, hist2, filled)
    mets = {m["key"]: m for m in est2["reports"][0]["metrics"]}
    check(mets["corn_yield_2627"]["actual"] == 181.3, "the empty actual is filled")
    check(mets["soy_yield_2627"]["actual"] == 52.0,
          "and one already on file is NOT overwritten", str(mets["soy_yield_2627"]["actual"]))
    rows = {r["metric"]: r for r in hist2["history"]}
    check(rows["2026/27 corn yield"]["actual"] == 181.3, "a new track-record row is created")
    check(rows["2026/27 corn yield"]["expected"] == 182.5,
          "carrying the consensus from the estimates file rather than a second typing")
    check(rows["2026/27 soybean yield"]["actual"] == 53.4,
          "an existing row gets its actual")
    check(rows["2026/27 soybean yield"]["reaction"] == "typed by hand",
          "and keeps the prose somebody wrote")
    check(len(hist2["history"]) == 2, "two rows, not three", str(len(hist2["history"])))

    print()
    if fails:
        print("FAILED (%d): %s" % (len(fails), "; ".join(fails)))
        return 1
    print("fetch_wasde: all passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
