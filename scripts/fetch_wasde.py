#!/usr/bin/env python3
"""
fetch_wasde.py — fill in a USDA report's actual numbers the moment they exist.

WHAT IT REPLACES

Sig, 2026-09-10: "i want the wasde what priced in page to process the reports
the moment they are available for release."

Until now the second of the three hand steps in data/analyst-estimates.json —
"(2) after USDA releases, fill each metric's `actual`" — was a person typing a
number into the GitHub editor. Nothing on the page moves until that happens: an
ungraded report never reaches "Scored, by report", every call filed for it drops off
"Filed for the next report" the day after the release, and no forecaster gains a scored
call. The July WASDE went unscored exactly this way and the track record still
carries the gap.

WHERE THE NUMBER COMES FROM, AND WHY IT IS NOT THE WASDE PDF

The two metrics this board grades are the national corn and soybean YIELDS, and
those are NASS's numbers — WASDE prints what the Crop Production report
publishes the same morning. NASS has a documented JSON API, this repository
already reads it in eight workflows, and NASS_API_KEY is already a secret. The
WASDE's own XML would be a second acquisition route for the same figure.

    corn 2026, national, YIELD, BU / ACRE  -- and NO period pin; see SURVEY_MONTHS

THE PERIOD FIELD WAS THE WHOLE MECHANISM, AND IT WAS WRONG. Corrected
2026-09-12; the paragraph that stood here described the design that produced a
day of HTTP 400s and is kept in outline so nobody rebuilds it.

It said: build_nass_series.py pins reference_period_desc = "YEAR" to keep the
in-season AUG..NOV forecasts OUT of a series of finals, so this file, wanting
exactly those forecasts, asks for the release month by name -- "SEP" -- and a
row that does not exist until NASS publishes it makes "has the report landed" a
question the data answers rather than one the clock guesses at.

Elegant, and NASS has no such value. Every call came back
{"error":["bad request - invalid query"]}. The obvious repair, "YEAR - SEP
FORECAST", is a spelling this repository has never measured: it appears only in
hand-typed fixtures, and build_state_stats.py records a real 2026-08-15 run
where the August forecast came back and "FORECAST" was not in the field at all.

So there is no pin. The query is the series, the crop year, NATIONAL and SURVEY,
and read_value's ambiguity guard decides -- one value is the answer, two
different values is a refusal naming both and the periods they came under. "Has
the report landed" is still a question the data answers; it is just answered by
whether a value comes back rather than by a string nobody has verified.

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
import urllib.error
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
# THE PERIOD, MEASURED. Third version of this block; the first two were guesses.
#
#   v1  pinned "SEP"                -> HTTP 400, {"error":["bad request - invalid query"]}
#   v2  pinned "YEAR - SEP FORECAST" -> inferred from hand-typed fixtures, and
#       build_state_stats.py's real 2026-08-15 run argued against it, so it was
#       not shipped
#   v3  pinned nothing, and let read_value's ambiguity guard report what came back
#
# v3 is what produced the answer. Run of 2026-09-12 12:52 UTC, verbatim:
#
#   NASS returned 2 different values for one series and year (178.5, 180.7)
#   across periods: YEAR, YEAR - AUG FORECAST, YEAR - SEP FORECAST
#
#   NASS returned 2 different values for one series and year (52.7, 52.8)
#   across periods: YEAR, YEAR - AUG FORECAST, YEAR - SEP FORECAST
#
# So "YEAR - SEP FORECAST" is real at NATIONAL level after all, and 178.5 and
# 52.8 are September's corn and soybean yields. build_state_stats.py's
# observation was about STATE rows and does not carry to these.
#
# This spelling is now measured against the live API rather than copied from a
# fixture, and the refusal that measured it is quoted above so the next person
# can see the evidence rather than trust the constant.
FORECAST_PERIOD = {8: "YEAR - AUG FORECAST", 9: "YEAR - SEP FORECAST",
                   10: "YEAR - OCT FORECAST", 11: "YEAR - NOV FORECAST",
                   1: "YEAR"}

# Kept alongside so a WASDE month NASS does not survey at all is skipped by name
# rather than queried and found empty.
SURVEY_MONTHS = {8: "August", 9: "September", 10: "October", 11: "November",
                 1: "the January annual summary"}



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


class NassRefused(Exception):
    """NASS answered, and the answer was a refusal.

    Kept apart from "no rows came back" on purpose. A refusal is a statement
    about our query or our key; no rows is a statement about the report. They
    were the same branch until 2026-09-12 and the difference is the whole
    question of whether anybody needs to do anything."""


def nass_rows(short_desc, year, period, key=None, opener=None):
    params = {"key": key if key is not None else API_KEY,
              "short_desc": short_desc,
              "agg_level_desc": "NATIONAL",
              "source_desc": "SURVEY",
              "year": str(year),
              "format": "JSON"}
    # period=None is the discovery call above: ask the same series without the
    # pin so NASS lists what it has, instead of sending the string "None".
    if period is not None:
        params["reference_period_desc"] = period
    url = API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with (opener or urllib.request.urlopen)(req, timeout=60) as r:
            return json.load(r).get("data", [])
    except urllib.error.HTTPError as e:
        # NASS SAYS WHY IN THE BODY, AND WE WERE THROWING IT AWAY.
        #
        # 2026-09-12: a hand-fired catch-up run for the September WASDE logged
        #   waiting  2026/27 corn yield   HTTPError: HTTP Error 400: Bad Request
        # twice and then "nothing published yet ... not an error", exit 0. Quick
        # Stats answers a 400 with a JSON body naming the fault -- an unusable
        # key, an unknown parameter value, a result set over its row cap. None
        # of that reached the log, so the run was green and the one sentence
        # that would have said what to fix was discarded unread.
        body = ""
        try:
            body = e.read().decode("utf-8", "replace")[:400]
        except Exception:
            pass
        raise NassRefused("HTTP %s from NASS%s" % (e.code, (": " + body) if body else
                          " (no body). Query: " + urllib.parse.urlencode(
                              {k: v for k, v in params.items() if k != "key"}))) from None


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
        # NAME THE PERIODS TOO. Without the period pin an ambiguous answer is
        # the one place NASS tells us how it distinguishes an in-season forecast
        # from a final, which is the fact this file has been missing.
        # PAIR THE VALUE WITH ITS PERIOD. The 2026-09-12 run printed the two
        # lists side by side -- (178.5, 180.7) and three period names -- which
        # settled the spelling but not which figure belonged to which. One line
        # of pairing would have said both.
        pairs = sorted({"%s=%s" % (r.get("reference_period_desc"), v) for v, r in vals})
        return None, ("NASS returned %d different values for one series and year: %s"
                      % (len(distinct), "; ".join(pairs)))
    return vals[0][0], None


def plan(est, release):
    """What this release can and cannot fill, decided before anything is asked.

    Returns (jobs, skipped) where a job is a metric that has a NASS series, a
    readable crop year, a period NASS publishes in this month, and no actual
    already on file."""
    jobs, skipped = [], []
    iso = release.isoformat()
    surveyed = SURVEY_MONTHS.get(release.month)
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
            if not surveyed:
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

    filled, waiting, refused = [], [], []
    for j in jobs:
        try:
            rows = nass_rows(j["short_desc"], j["year"], j["period"])
        except Exception as ex:
            # WAITING AND REFUSED ARE NOT THE SAME THING.
            # "waiting" means we asked and the report is not out. "refused"
            # means we could not ask. Filing the second as the first is what
            # printed "nothing published yet ... that is not an error" over two
            # HTTP 400s and exited 0.
            refused.append((j["label"], "%s: %s" % (type(ex).__name__, str(ex)[:300])))
            # WHEN A PIN IS REFUSED, ASK WHAT NASS ACTUALLY HAS.
            # "bad request - invalid query" does not say WHICH parameter is
            # wrong, and working that out by hand cost a day. One extra call,
            # only on failure, drops the period pin and reports the values that
            # do exist for this series and year. If NASS ever respells the
            # forecast periods, the log names the new spelling instead of
            # repeating the same dead end.
            try:
                probe = nass_rows(j["short_desc"], j["year"], None)
                seen = sorted({str(r.get("reference_period_desc")) for r in probe})
                print("  probe    %-32s NASS has these periods for %s %s: %s"
                      % (j["label"][:32], j["short_desc"][:20], j["year"],
                         ", ".join(seen[:8]) or "none"))
            except Exception as pex:
                print("  probe    %-32s could not list the periods either (%s)"
                      % (j["label"][:32], type(pex).__name__))
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
    for label, why in refused:
        print("  REFUSED  %-32s %s" % (label[:32], why))
        print("::error title=NASS refused the query::%s -- %s" % (label, why))

    if refused and not filled:
        print("  NASS refused every query. This is NOT 'the report has not landed':")
        print("  we never got an answer to read. Nothing was written, and this run")
        print("  is red on purpose so it is not mistaken for a quiet one.")
        return 1

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
    # THIS ASSERTION HAS BEEN WRONG TWICE AND IS NOW MEASURED.
    # "SEP" (what the code sent, so the gate ran into a 400), then briefly the
    # unpinned state. The value below came back from the live API on
    # 2026-09-12 in a refusal that listed every period NASS holds for this
    # series, quoted in full beside FORECAST_PERIOD.
    check(all(j["period"] == "YEAR - SEP FORECAST" for j in jobs),
          "asks for the September forecast in the spelling NASS answered with",
          str({j["period"] for j in jobs}))
    check(FORECAST_PERIOD[1] == "YEAR" and "FORECAST" in FORECAST_PERIOD[8],
          "January is the plain annual summary; the in-season months are forecasts")
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
    print("A REFUSAL IS NOT A REPORT THAT HAS NOT LANDED")
    # 2026-09-12: two HTTP 400s were filed as "waiting" and the run printed
    # "nothing published yet ... that is not an error" and exited 0.
    import io as _io

    def _http(code, body):
        def _open(req, timeout=None):
            raise urllib.error.HTTPError(req.full_url, code, "Bad Request", {},
                                         _io.BytesIO(body.encode()))
        return _open

    try:
        nass_rows("X", 2026, "SEP", key="k",
                  opener=_http(400, '{"error":["unauthorized"]}'))
        check(False, "a 400 raises", "it returned normally")
    except NassRefused as ex:
        check(True, "a 400 raises NassRefused, not a generic error")
        check("400" in str(ex), "and names the status")
        check("unauthorized" in str(ex),
              "AND CARRIES THE BODY NASS SENT, which is the part that says why")
        check("key=" not in str(ex), "without leaking the API key into the log")
    except Exception as ex:
        check(False, "a 400 raises NassRefused", type(ex).__name__)

    # a body-less refusal still has to be actionable
    try:
        nass_rows("X", 2026, "SEP", key="k", opener=_http(500, ""))
        check(False, "a 500 raises", "it returned normally")
    except NassRefused as ex:
        check("short_desc" in str(ex),
              "a refusal with no body prints the query instead, so it is still diagnosable")
        check("key=" not in str(ex), "and still does not leak the key")

    # and an ordinary empty answer is NOT a refusal: that is the real "waiting"
    def _empty(req, timeout=None):
        class R:
            def read(self): return b'{"data": []}'
            def __enter__(self): return self
            def __exit__(self, *a): return False
        return R()
    try:
        rows = nass_rows("X", 2026, "SEP", key="k", opener=_empty)
        check(rows == [], "an empty data array is an ordinary answer, not a refusal")
        v, why = read_value(rows)
        check(v is None and why, "and read_value calls it waiting, with a reason")
    except Exception as ex:
        check(False, "an empty answer does not raise", type(ex).__name__)


    # AND THE RUN ITSELF HAS TO GO RED. Everything above proves the refusal is
    # classified correctly; this proves it reaches the exit code, which is the
    # only part GitHub reads. Without it, `if refused and not filled` could be
    # deleted and every check above would still pass.
    # ON A FIXTURE, NOT ON data/analyst-estimates.json.
    #
    # This test ran main() against the repo's real estimates file. It passed on
    # 2026-09-12 at 12:58 UTC, the run wrote 178.5 and 52.8 into that same file,
    # and from 12:59 onwards the September metrics were "already filled in", so
    # main() had no jobs, refused nothing, and returned 0. The check went red and
    # stayed red -- and it is the first step of the WASDE watch, so the next
    # release would have been blocked by a gate failing over data, not code.
    #
    # A test whose answer depends on which figures happen to be on file is not
    # testing the reader. Two metrics, both empty, in a temporary file.
    import unittest.mock as _mock, tempfile as _tf
    global API_KEY, EST_PATH, HIST_PATH, OUT_PATH
    _saved = (API_KEY, EST_PATH, HIST_PATH, OUT_PATH)
    _dir = Path(_tf.mkdtemp())
    (_dir / "est.json").write_text(json.dumps({"reports": [{
        "report": "Fixture WASDE", "date": "2026-09-11", "metrics": [
            {"key": "corn_yield_2627", "label": "2026/27 corn yield",
             "unit": "bu/acre", "consensus": 178.1, "actual": None},
            {"key": "soy_yield_2627", "label": "2026/27 soybean yield",
             "unit": "bu/acre", "consensus": 52.5, "actual": None},
        ]}]}))
    (_dir / "hist.json").write_text(json.dumps({"history": []}))
    API_KEY = "test"
    EST_PATH = _dir / "est.json"
    HIST_PATH = _dir / "hist.json"
    OUT_PATH = _dir / "wasde.json"
    try:
        # the fixture really does give main() something to do, or the two checks
        # below would pass for the wrong reason -- which is how this broke.
        _jobs, _ = plan(json.loads(EST_PATH.read_text()), date(2026, 9, 11))
        check(len(_jobs) == 2, "the fixture leaves both metrics to fill",
              "got %d" % len(_jobs))

        with _mock.patch(__name__ + ".nass_rows",
                         side_effect=NassRefused('HTTP 400 from NASS: {"error":["unauthorized"]}')):
            rc = main(["--date", "2026-09-11"])
        check(rc == 1, "a run where NASS refused everything exits 1, not 0",
              "got %r" % rc)

        # and a genuine empty answer still exits 0 -- a quiet day is not a failure
        with _mock.patch(__name__ + ".nass_rows", return_value=[]):
            rc = main(["--date", "2026-09-11"])
        check(rc == 0, "a run where the report simply has not landed still exits 0",
              "got %r" % rc)

        # nothing was written to the repo's own files by either run
        check(not (_dir / "wasde.json").exists(),
              "a refused or empty run writes no output file at all")
    finally:
        API_KEY, EST_PATH, HIST_PATH, OUT_PATH = _saved


    # THE DISCOVERY CALL MUST DROP THE PIN, NOT SEND "None".
    # It only runs after a refusal, so nothing else exercises it, and a probe
    # that asks for reference_period_desc=None is a second invalid query
    # dressed as a diagnosis.
    _cap = {}

    def _capture(req, timeout=None):
        _cap["url"] = req.full_url

        class R:
            def read(self): return b'{"data":[]}'
            def __enter__(self): return self
            def __exit__(self, *a): return False
        return R()

    nass_rows("CORN, GRAIN - YIELD, MEASURED IN BU / ACRE", 2026, None,
              key="K", opener=_capture)
    _q = urllib.parse.parse_qs(urllib.parse.urlparse(_cap["url"]).query)
    check("reference_period_desc" not in _q,
          "the probe omits the period pin entirely, so NASS lists what it has",
          str(_q.get("reference_period_desc")))
    check(_q.get("year") == ["2026"] and _q.get("short_desc"),
          "and still pins the series and year, or it would list the whole database")

    nass_rows("CORN, GRAIN - YIELD, MEASURED IN BU / ACRE", 2026,
              "YEAR - SEP FORECAST", key="K", opener=_capture)
    _q = urllib.parse.parse_qs(urllib.parse.urlparse(_cap["url"]).query)
    check(_q.get("reference_period_desc") == ["YEAR - SEP FORECAST"],
          "while an ordinary call still sends the pin")


    # AN AMBIGUOUS ANSWER MUST SAY WHICH FIGURE CAME UNDER WHICH PERIOD.
    # The 2026-09-12 run printed the values and the periods as two separate
    # lists, which settled the spelling but not the mapping, and that cost a
    # round trip. Pairing them is the difference between a clue and an answer.
    _v, _why = read_value([
        {"Value": "178.5", "reference_period_desc": "YEAR - SEP FORECAST"},
        {"Value": "180.7", "reference_period_desc": "YEAR - AUG FORECAST"}])
    check(_v is None, "two different values are still refused, never picked between")
    check("YEAR - SEP FORECAST=178.5" in _why and "YEAR - AUG FORECAST=180.7" in _why,
          "and the refusal pairs each figure with the period it came under", _why)

    print()
    if fails:
        print("FAILED (%d): %s" % (len(fails), "; ".join(fails)))
        return 1

    print("fetch_wasde: all passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
