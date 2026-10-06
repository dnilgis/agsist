#!/usr/bin/env python3
"""
fetch_crop_progress.py — USDA NASS Crop Progress weekly fetcher
Writes data/crop-progress.json with G/E ratings and planting pace for corn and
soybeans, plus winter/spring wheat condition and harvest pace (added 2026-07-28
for the wheat futures page; fail-soft — wheat outages never block the corn write).

Data source: USDA NASS QuickStats API (free key — see README)
Get your free key at: https://quickstats.nass.usda.gov/api/
Store as GitHub secret: NASS_API_KEY

Runs Mondays 4:30 PM CT via GitHub Actions (after 4:00 PM ET NASS release).
Off-season (Dec–Mar) still runs but writes in_season: false.
"""

import json
import os
import sys
import urllib.request
import urllib.parse
from datetime import datetime, timedelta

OUT_FILE = "data/crop-progress.json"
BASE_URL = "https://quickstats.nass.usda.gov/api/api_GET/"
API_KEY  = os.environ.get("NASS_API_KEY", "")


def nass_get(params: dict) -> list[dict]:
    params["key"] = API_KEY
    params["format"] = "JSON"
    url = BASE_URL + "?" + urllib.parse.urlencode(params)
    print(f"  GET {url[:120]}…", flush=True)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "AGSIST/1.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read())
        rows = data.get("data", [])
        print(f"    → {len(rows)} rows", flush=True)
        return rows
    except Exception as e:
        print(f"  NASS API error: {e}", flush=True)
        return []


def fetch_condition(commodity: str, year: int, class_desc: str | None = None) -> list[dict]:
    p = {
        "source_desc": "SURVEY",
        "sector_desc": "CROPS",
        "commodity_desc": commodity,
        "statisticcat_desc": "CONDITION",
        "agg_level_desc": "NATIONAL",
        "freq_desc": "WEEKLY",
        "year": str(year),
    }
    if class_desc:
        p["class_desc"] = class_desc
    return nass_get(p)


def fetch_progress(commodity: str, year: int, unit: str = "PCT PLANTED",
                   class_desc: str | None = None) -> list[dict]:
    p = {
        "source_desc": "SURVEY",
        "sector_desc": "CROPS",
        "commodity_desc": commodity,
        "statisticcat_desc": "PROGRESS",
        "unit_desc": unit,
        "agg_level_desc": "NATIONAL",
        "freq_desc": "WEEKLY",
        "year": str(year),
    }
    if class_desc:
        p["class_desc"] = class_desc
    return nass_get(p)


def _ge_complete(rows: list[dict]) -> dict:
    """{week_ending: GOOD + EXCELLENT} for weeks where BOTH were published."""
    parts: dict[str, dict] = {}
    for r in rows:
        week = r.get("week_ending", "")
        unit = r.get("unit_desc", "").upper()
        try:
            val = int(str(r.get("Value", "")).replace(",", "").strip())
        except ValueError:
            continue
        if not week:
            continue
        if "EXCELLENT" in unit:
            parts.setdefault(week, {})["excellent"] = val
        elif "GOOD" in unit:
            parts.setdefault(week, {})["good"] = val
    return {w: p["good"] + p["excellent"] for w, p in parts.items()
            if "good" in p and "excellent" in p}


def latest_ge(rows: list[dict]) -> dict | None:
    """
    Group rows by week_ending, sum GOOD + EXCELLENT for latest available week.
    Returns {date, good_excellent, week_ending_str} or None.
    """
    by_week: dict[str, dict] = {}
    for r in rows:
        week = r.get("week_ending", "")
        unit = r.get("unit_desc", "").upper()
        try:
            val = int(str(r.get("Value", "")).replace(",", "").strip())
        except ValueError:
            continue
        if not week:
            continue
        if week not in by_week:
            by_week[week] = {}
        if "EXCELLENT" in unit:
            by_week[week]["excellent"] = val
        elif "GOOD" in unit and "EXCELLENT" not in unit:
            by_week[week]["good"] = val

    if not by_week:
        return None

    latest_date = max(by_week.keys())
    w = by_week[latest_date]
    # Both halves or nothing. A week with GOOD posted and EXCELLENT missing
    # used to print GOOD alone as "good to excellent" -- a missing value
    # turned into a 0 and added.
    if w.get("good") is None or w.get("excellent") is None:
        return None
    return {"date": latest_date, "good_excellent": w["good"] + w["excellent"]}


def latest_planting(rows: list[dict]) -> dict | None:
    """Return most recent PCT PLANTED value."""
    valid = []
    for r in rows:
        week = r.get("week_ending", "")
        try:
            val = int(str(r.get("Value", "")).replace(",", "").strip())
        except ValueError:
            continue
        if week:
            valid.append((week, val))
    if not valid:
        return None
    valid.sort(key=lambda x: x[0], reverse=True)
    return {"date": valid[0][0], "pct": valid[0][1]}


def same_week_prev(rows: list[dict], cur_date: str | None) -> int | None:
    """2026-10-01 harvest pace: last year's value for the week nearest to 364 days before
    cur_date (within 4 days), not last year's final number."""
    if not cur_date:
        return None
    try:
        target = datetime.strptime(cur_date, "%Y-%m-%d") - timedelta(days=364)
    except ValueError:
        return None
    best = None
    for r in rows:
        try:
            wk = datetime.strptime(r.get("week_ending", ""), "%Y-%m-%d")
            val = int(str(r.get("Value", "")).replace(",", "").strip())
        except ValueError:
            continue
        gap = abs((wk - target).days)
        if gap <= 4 and (best is None or gap < best[0]):
            best = (gap, val)
    return best[1] if best else None


def ge_same_week_prev(rows: list[dict], cur_date: str | None) -> int | None:
    """2026-10-01 same-week: good + excellent for last year's week nearest 364 days before
    cur_date (within 4 days), not last year's final week."""
    if not cur_date:
        return None
    by_week = _ge_complete(rows)
    return same_week_prev([{"week_ending": w, "Value": str(v)} for w, v in by_week.items()], cur_date)


# ── Five-year average and the reader's state (2026-10-03, wave1-C) ──────────
#
# The homepage printed "Corn 18% 18% a year ago" with nothing to say which
# number was which, national only. NASS prints a 5-year average beside every
# progress figure in the weekly report, but Quick Stats does not carry that
# column, so it is computed here from the same weekly series:
#
#   for each of the five prior years, the value on the same calendar date,
#   interpolated linearly between the two published weeks around it;
#   then the plain mean of the five, rounded to a whole percent.
#
# That is the method NASS describes for its own column (prior years
# interpolated to the current week-ending date), but it is OUR arithmetic and
# can differ from the printed NASS figure by a point; the page says so. If any
# of the five years has no published week on both sides of the date, the
# average is withheld (None) rather than computed from four. One exception,
# stated: a year whose last published week is before the date and already at
# 100 counts as 100, because NASS stops publishing a crop once it is done.

# (key, commodity_desc, unit_desc, class_desc or None)
PROGRESS_SERIES = [
    ("corn_harvested",          "CORN",     "PCT HARVESTED", None),
    ("soybeans_harvested",      "SOYBEANS", "PCT HARVESTED", None),
    ("winter_wheat_planted",    "WHEAT",    "PCT PLANTED",   "WINTER"),
    ("winter_wheat_emerged",    "WHEAT",    "PCT EMERGED",   "WINTER"),
    ("cotton_harvested",        "COTTON",   "PCT HARVESTED", None),
    ("rice_harvested",          "RICE",     "PCT HARVESTED", None),
    ("peanuts_harvested",       "PEANUTS",  "PCT HARVESTED", None),
    ("sorghum_harvested",       "SORGHUM",  "PCT HARVESTED", None),
]
# A state's latest week older than this many days before the national report
# week is a finished season (winter wheat HARVESTED in July), not this week.
CURRENT_WINDOW_DAYS = 10


def fetch_progress_all(commodity: str, unit: str, class_desc: str | None, since_year: int) -> list[dict]:
    """National AND state rows for one progress series, since_year onward, in
    one call. Filtered on week_ending dates downstream, never on `year`, so it
    does not matter which year NASS files fall winter-wheat seeding under."""
    p = {
        "source_desc": "SURVEY",
        "sector_desc": "CROPS",
        "commodity_desc": commodity,
        "statisticcat_desc": "PROGRESS",
        "unit_desc": unit,
        "freq_desc": "WEEKLY",
        "year__GE": str(since_year),
    }
    if class_desc:
        p["class_desc"] = class_desc
    return nass_get(p)


def _val(r):
    try:
        return int(str(r.get("Value", "")).replace(",", "").strip())
    except ValueError:
        return None


def _wk(r):
    try:
        return datetime.strptime(r.get("week_ending", ""), "%Y-%m-%d")
    except ValueError:
        return None


def clean_series(rows: list[dict]) -> dict[str, dict]:
    """rows -> {loc: {date: value}}, loc = state_alpha or "US".

    Drops silage rows, and when more than one short_desc survives (a crop
    published under two descriptions) keeps the one with the most rows and
    logs the rest, so two series can never be averaged into one."""
    rows = [r for r in rows if "SILAGE" not in str(r.get("short_desc", "")).upper()]
    descs: dict[str, int] = {}
    for r in rows:
        descs[r.get("short_desc", "")] = descs.get(r.get("short_desc", ""), 0) + 1
    if len(descs) > 1:
        keep = max(descs, key=descs.get)
        print(f"    several series {sorted(descs)}; keeping {keep!r}", flush=True)
        rows = [r for r in rows if r.get("short_desc", "") == keep]
    out: dict[str, dict] = {}
    for r in rows:
        agg = str(r.get("agg_level_desc", "")).upper()
        if agg == "NATIONAL":
            loc = "US"
        elif agg == "STATE":
            loc = (r.get("state_alpha") or "").strip()
        else:
            continue
        d, v = _wk(r), _val(r)
        if not loc or d is None or v is None:
            continue
        out.setdefault(loc, {})[d] = v
    return out


def value_on(series: dict, target: datetime, season_days: int = 200):
    """Value on `target` interpolated between the published weeks either side.
    Only weeks within `season_days` of target count, so a different season of
    the same year cannot bracket it. None if not bracketed, except a finished
    crop: last week before target already at 100 -> 100."""
    near = sorted((d, v) for d, v in series.items() if abs((d - target).days) <= season_days)
    before = [(d, v) for d, v in near if d <= target]
    after = [(d, v) for d, v in near if d >= target]
    if before and before[-1][0] == target:
        return float(before[-1][1])
    if before and after:
        (d0, v0), (d1, v1) = before[-1], after[0]
        return v0 + (v1 - v0) * (target - d0).days / (d1 - d0).days
    if before and not after and before[-1][1] >= 100:
        return 100.0
    return None


def five_year_avg(series: dict, cur: datetime):
    vals = []
    for k in range(1, 6):
        try:
            t = cur.replace(year=cur.year - k)
        except ValueError:          # 29 Feb
            t = cur.replace(year=cur.year - k, day=28)
        v = value_on(series, t)
        if v is None:
            return None
        vals.append(v)
    return int(sum(vals) / 5 + 0.5)


def summarize(series: dict):
    """{date: value} for one place -> latest week, its value, same week last
    year (same rule as same_week_prev) and the 5-year average."""
    if not series:
        return None
    cur = max(series)
    prev = same_week_prev([{"week_ending": d.strftime("%Y-%m-%d"), "Value": str(v)}
                           for d, v in series.items()], cur.strftime("%Y-%m-%d"))
    return {"date": cur.strftime("%Y-%m-%d"), "pct": series[cur],
            "prev_year": prev, "avg5": five_year_avg(series, cur)}


def build_progress(fetch, year: int, report_date: str | None):
    """Runs every PROGRESS_SERIES through `fetch` (injectable for the
    selftest). Returns (national, states):
      national: {key: summary}
      states:   {ST: {key: summary}} -- only weeks within CURRENT_WINDOW_DAYS
                of the national report week, so a state shows this week's
                numbers or none."""
    national, states = {}, {}
    ref = None
    if report_date:
        try:
            ref = datetime.strptime(report_date, "%Y-%m-%d")
        except ValueError:
            ref = None
    for key, comm, unit, cls in PROGRESS_SERIES:
        print(f"\n── progress {key} ──", flush=True)
        try:
            by_loc = clean_series(fetch(comm, unit, cls, year - 6))
        except Exception as e:
            print(f"  {key} failed (non-fatal): {e}", flush=True)
            continue
        for loc, series in by_loc.items():
            sm = summarize(series)
            if not sm:
                continue
            if loc == "US":
                national[key] = sm
                continue
            if ref is not None and abs((datetime.strptime(sm["date"], "%Y-%m-%d") - ref).days) > CURRENT_WINDOW_DAYS:
                continue
            states.setdefault(loc, {})[key] = sm
        print(f"  US {national.get(key)} | {sum(1 for s in states.values() if key in s)} states current", flush=True)
    return national, states


def is_in_season() -> bool:
    """Crop Progress runs April through November."""
    m = datetime.now().month
    return 4 <= m <= 11


def main():
    os.makedirs("data", exist_ok=True)

    if not API_KEY:
        print("WARNING: NASS_API_KEY not set. Get a free key at https://quickstats.nass.usda.gov/api/")
        print("Writing off-season placeholder.")
        out = {
            "updated": datetime.now().strftime("%Y-%m-%d"),
            "report_date": None,
            "in_season": False,
            "error": "NASS_API_KEY not configured",
            "corn": None,
            "soybeans": None,
        }
        with open(OUT_FILE, "w") as f:
            json.dump(out, f, indent=2)
        print(f"Written {OUT_FILE}")
        sys.exit(0)

    year  = datetime.now().year
    year1 = year - 1  # prior year for comparison

    print(f"\nFetching crop progress for {year} (prior year {year1})…", flush=True)
    in_season = is_in_season()

    result: dict = {
        "updated":     datetime.now().strftime("%Y-%m-%d"),
        "report_date": None,
        "in_season":   in_season,
        "corn":         None,
        "soybeans":     None,
        "winter_wheat": None,
        "spring_wheat": None,
    }

    for commodity, key in [("CORN", "corn"), ("SOYBEANS", "soybeans")]:
        print(f"\n── {commodity} ──", flush=True)

        # Current year G/E
        cond_cur  = fetch_condition(commodity, year)
        cond_prev = fetch_condition(commodity, year1)

        cur  = latest_ge(cond_cur)
        prev = latest_ge(cond_prev)

        # Planting progress
        plant_cur  = fetch_progress(commodity, year)
        plant_prev = fetch_progress(commodity, year1)

        lp_cur  = latest_planting(plant_cur)
        lp_prev = latest_planting(plant_prev)

        # Prior week G/E (second-most-recent week in current year)
        ge_prev_week = None
        if cond_cur:
            # The week before the latest PUBLISHED week, and only if both
            # halves posted for it -- a half week is None, not GOOD alone.
            all_weeks = sorted({r.get("week_ending", "") for r in cond_cur if r.get("week_ending")},
                               reverse=True)
            if len(all_weeks) >= 2:
                ge_prev_week = _ge_complete(cond_cur).get(all_weeks[1])

        result[key] = {
            "good_excellent":           cur["good_excellent"] if cur else None,
            "report_date":              cur["date"] if cur else None,
            "good_excellent_prev_week": ge_prev_week,
            "good_excellent_prev_year": ge_same_week_prev(cond_prev, cur["date"]) if cur else None,
            "planting_pct":             lp_cur["pct"] if lp_cur else None,
            "planting_prev_year":       same_week_prev(plant_prev, lp_cur["date"]) if lp_cur else None,
        }

        # Harvest pace (2026-10-01 harvest pace). Fail-soft: null on any error.
        try:
            h_rows = [r for r in fetch_progress(commodity, year, "PCT HARVESTED")
                      if "SILAGE" not in str(r.get("short_desc", "")).upper()]
            h_cur = latest_planting(h_rows)
            h_prev_rows = [r for r in fetch_progress(commodity, year1, "PCT HARVESTED")
                           if "SILAGE" not in str(r.get("short_desc", "")).upper()] if h_cur else []
            result[key]["harvest_pct"] = h_cur["pct"] if h_cur else None
            result[key]["harvest_date"] = h_cur["date"] if h_cur else None
            result[key]["harvest_prev_year"] = same_week_prev(h_prev_rows, h_cur["date"]) if h_cur else None
            if commodity == "CORN":
                m_cur = latest_planting(fetch_progress(commodity, year, "PCT MATURE"))
                result[key]["mature_pct"] = m_cur["pct"] if m_cur else None
            print(f"  Harvested: {result[key]['harvest_pct']}% (same week last year {result[key]['harvest_prev_year']}%)", flush=True)
        except Exception as e:
            print(f"  {commodity} harvest fetch failed (non-fatal): {e}", flush=True)
            for k in ("harvest_pct", "harvest_date", "harvest_prev_year"):
                result[key].setdefault(k, None)

        # Set overall report date from corn
        if key == "corn" and cur:
            result["report_date"] = cur["date"]

        print(f"  G/E: {result[key]['good_excellent']}% | prev wk: {result[key]['good_excellent_prev_week']}% | prev yr: {result[key]['good_excellent_prev_year']}%", flush=True)
        print(f"  Planting: {result[key]['planting_pct']}% | prev yr: {result[key]['planting_prev_year']}%", flush=True)

    # ── Wheat classes (2026-07-28) ──────────────────────────────────────────
    # The wheat futures page had a dead-wired crop-progress card while NASS
    # publishes exactly what moves KE and MWE: winter wheat harvest % and
    # spring wheat condition. Fetched separately by class_desc so winter and
    # spring rows never mix. Fail-soft: a wheat outage leaves the keys null
    # (the page hides the card); it never blocks the corn/soybean write.
    for cls, key, prog_unit in [("WINTER", "winter_wheat", "PCT HARVESTED"),
                                ("SPRING, (EXCL DURUM)", "spring_wheat", "PCT HARVESTED")]:
        print(f"\n── WHEAT, {cls} ──", flush=True)
        try:
            cond_cur  = fetch_condition("WHEAT", year, class_desc=cls)
            cond_prev = fetch_condition("WHEAT", year1, class_desc=cls)
            cur  = latest_ge(cond_cur)
            prev = latest_ge(cond_prev)

            h_cur  = latest_planting(fetch_progress("WHEAT", year, prog_unit, class_desc=cls))
            h_prev_rows = fetch_progress("WHEAT", year1, prog_unit, class_desc=cls)

            result[key] = {
                "good_excellent":           cur["good_excellent"] if cur else None,
                "report_date":              cur["date"] if cur else (h_cur["date"] if h_cur else None),
                "good_excellent_prev_year": ge_same_week_prev(cond_prev, cur["date"]) if cur else None,
                "harvest_pct":              h_cur["pct"] if h_cur else None,
                "harvest_prev_year":        same_week_prev(h_prev_rows, h_cur["date"]) if h_cur else None,
            }
            print(f"  G/E: {result[key]['good_excellent']}% (prev yr {result[key]['good_excellent_prev_year']}%) | "
                  f"harvested: {result[key]['harvest_pct']}% (prev yr {result[key]['harvest_prev_year']}%)", flush=True)
        except Exception as e:
            print(f"  wheat {cls} fetch failed (non-fatal): {e}", flush=True)
            result[key] = None

    # ── 5-year averages, more crops, and every state (2026-10-03) ──────────
    # Fail-soft: an outage here leaves the new keys out; it never blocks the
    # condition write above.
    try:
        national, states = build_progress(fetch_progress_all, year, result.get("report_date"))
        for crop in ("corn", "soybeans"):
            sm = national.get(crop + "_harvested")
            if result.get(crop) and sm and sm["date"] == result[crop].get("harvest_date"):
                result[crop]["harvest_5yr_avg"] = sm["avg5"]
        result["progress"] = national
        result["states"] = states
        result["progress_method"] = (
            "5-year average: AGSIST's arithmetic on the NASS weekly series, each of "
            "the five prior years interpolated to the same calendar date, then "
            "averaged; withheld if any year lacks a published week on both sides. "
            "Can differ from the NASS-printed average by a point.")
    except Exception as e:
        print(f"  progress build failed (non-fatal): {e}", flush=True)

    if not result["corn"] and not result["soybeans"]:
        # Off-season (Nov–Mar): a placeholder is honest. In-season (Apr–Oct):
        # zero data means a dead key/outage — fail LOUD instead of silently
        # freezing the page on last week's numbers.
        from datetime import date
        if 4 <= date.today().month <= 10:
            print("\nFATAL: zero condition data in-season — failing the run so it shows red")
            raise SystemExit(1)
        print("\nNo data returned — writing off-season placeholder.")
        result["in_season"] = False

    with open(OUT_FILE, "w") as f:
        json.dump(result, f, indent=2)
    print(f"\nWritten {OUT_FILE}")


def selftest():
    """Hand-worked, no network, no key."""
    fails = []

    def check(cond, label, detail=""):
        print(("  ok    " if cond else "  FAIL  ") + label + ("" if cond else "  -- " + str(detail)))
        if not cond:
            fails.append(label)

    D = lambda s: datetime.strptime(s, "%Y-%m-%d")

    print("INTERPOLATION TO THE SAME DATE")
    ser = {D("2025-09-21"): 10, D("2025-09-28"): 24}
    check(value_on(ser, D("2025-09-27")) == 22.0, "Sep 27 between 10 (Sep 21) and 24 (Sep 28) = 22",
          value_on(ser, D("2025-09-27")))
    check(value_on(ser, D("2025-09-28")) == 24.0, "a published week is used as is")
    check(value_on(ser, D("2025-09-14")) is None, "before the first week: not bracketed, None")
    done = {D("2025-11-02"): 97, D("2025-11-09"): 100}
    check(value_on(done, D("2025-11-20")) == 100.0, "after a finished crop's last week (100): 100")
    check(value_on({D("2025-11-09"): 96}, D("2025-11-20")) is None, "after a last week below 100: None")

    print("\nFIVE-YEAR AVERAGE")
    # Each prior year has weeks a few days either side of Sep 27, values chosen
    # so the interpolated value on Sep 27 is 10, 20, 30, 40, 50 -> mean 30.
    series = {D("2026-09-27"): 18}
    for k, v in zip(range(1, 6), (10, 20, 30, 40, 50)):
        y = 2026 - k
        series[D(f"{y}-09-24")] = v - 3
        series[D(f"{y}-10-01")] = v + 4
    check(five_year_avg(series, D("2026-09-27")) == 30, "mean of 10,20,30,40,50 = 30",
          five_year_avg(series, D("2026-09-27")))
    gap = dict(series); del gap[D("2021-09-24")]
    check(five_year_avg(gap, D("2026-09-27")) is None, "one year not bracketed -> withheld, not a 4-year mean")
    check(five_year_avg({D("2026-09-27"): 1, D("2025-09-27"): 2}, D("2026-09-27")) is None,
          "fewer than five years -> withheld")
    half = {D("2026-09-27"): 18}
    for k in range(1, 6):
        half[D(f"{2026-k}-09-20")] = 0
        half[D(f"{2026-k}-10-04")] = 1
    check(five_year_avg(half, D("2026-09-27")) == 1, "0.5 rounds up to 1 (half up, not banker's)",
          five_year_avg(half, D("2026-09-27")))

    print("\nSERIES CLEANING")
    rows = [
        {"agg_level_desc": "NATIONAL", "state_alpha": "US", "week_ending": "2026-09-27", "Value": "18",
         "short_desc": "CORN, GRAIN - PROGRESS, MEASURED IN PCT HARVESTED"},
        {"agg_level_desc": "STATE", "state_alpha": "WI", "week_ending": "2026-09-27", "Value": "6",
         "short_desc": "CORN, GRAIN - PROGRESS, MEASURED IN PCT HARVESTED"},
        {"agg_level_desc": "STATE", "state_alpha": "WI", "week_ending": "2026-09-27", "Value": "40",
         "short_desc": "CORN, SILAGE - PROGRESS, MEASURED IN PCT HARVESTED"},
        {"agg_level_desc": "STATE", "state_alpha": "IA", "week_ending": "2026-09-27", "Value": "(D)",
         "short_desc": "CORN, GRAIN - PROGRESS, MEASURED IN PCT HARVESTED"},
    ]
    cs = clean_series(rows)
    check(cs.get("US") == {D("2026-09-27"): 18}, "national row lands under US")
    check(cs.get("WI") == {D("2026-09-27"): 6}, "silage is dropped, grain kept (6, not 40)", cs.get("WI"))
    check("IA" not in cs, "a suppressed (D) value is not a zero")

    print("\nGOOD + EXCELLENT NEEDS BOTH")
    gr = lambda wk, u, v: {"week_ending": wk, "unit_desc": u, "Value": v}
    check(latest_ge([gr("2026-10-04", "PCT GOOD", "40"), gr("2026-10-04", "PCT EXCELLENT", "14")])
          == {"date": "2026-10-04", "good_excellent": 54}, "40 good + 14 excellent = 54")
    check(latest_ge([gr("2026-09-27", "PCT GOOD", "41"), gr("2026-09-27", "PCT EXCELLENT", "16"),
                     gr("2026-10-04", "PCT GOOD", "40")]) is None,
          "latest week missing EXCELLENT -> None, not GOOD alone and not last week's")

    print("\nSTATES SHOW THIS WEEK OR NOTHING")
    def fake(comm, unit, cls, since):
        if (comm, unit) == ("WHEAT", "PCT PLANTED"):
            return [{"agg_level_desc": "STATE", "state_alpha": "KS", "week_ending": "2026-09-27",
                     "Value": "41", "short_desc": "WHEAT, WINTER - PROGRESS, MEASURED IN PCT PLANTED"}]
        if (comm, unit) == ("RICE", "PCT HARVESTED"):
            return [{"agg_level_desc": "STATE", "state_alpha": "AR", "week_ending": "2026-08-02",
                     "Value": "3", "short_desc": "RICE - PROGRESS, MEASURED IN PCT HARVESTED"}]
        if comm == "PEANUTS":
            raise RuntimeError("simulated outage")
        return []
    nat, st = build_progress(fake, 2026, "2026-09-27")
    check(st.get("KS", {}).get("winter_wheat_planted", {}).get("pct") == 41, "Kansas wheat planted 41 kept")
    check("AR" not in st, "a state week eight weeks old is not shown as this week", st.get("AR"))
    check(st["KS"]["winter_wheat_planted"]["avg5"] is None, "no history -> 5-year avg withheld (None)")

    print()
    if fails:
        print("FAILED (%d): %s" % (len(fails), "; ".join(fails)))
        return 1
    print("crop progress: all passed")
    return 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    main()
