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
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass

import json
import os
import sys
import urllib.request
import urllib.parse
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo


def ct_today():
    """The Central-time date. The runner's clock is UTC, so an evening run stamped tomorrow
    and the pages disagreed with /conditions by a day (audit N13, Oct 17)."""
    return datetime.now(timezone.utc).astimezone(ZoneInfo("America/Chicago")).strftime("%Y-%m-%d")

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


# Nov 2, 2026 (audit item 12): the two published weeks either side of a date
# may be at most this many days apart for a straight line between them to
# stand in for the week. The fall 2025 shutdown left no corn harvest week
# between Sep 28 (18%) and Nov 16 (91%); a line across those 49 days put
# Oct 25, 2025 at 58% and fed it into the Oct 25, 2026 5-year average (66%).
MAX_GAP_DAYS = 21


def value_on(series: dict, target: datetime, season_days: int = 200):
    """Value on `target` interpolated between the published weeks either side.
    Only weeks within `season_days` of target count, so a different season of
    the same year cannot bracket it. None if not bracketed, or if the weeks
    either side are more than MAX_GAP_DAYS apart (a gap in publishing is not
    a straight line), except a finished crop: last week before target already
    at 100 -> 100."""
    near = sorted((d, v) for d, v in series.items() if abs((d - target).days) <= season_days)
    before = [(d, v) for d, v in near if d <= target]
    after = [(d, v) for d, v in near if d >= target]
    if before and before[-1][0] == target:
        return float(before[-1][1])
    if before and after:
        (d0, v0), (d1, v1) = before[-1], after[0]
        if (d1 - d0).days > MAX_GAP_DAYS:
            return 100.0 if v0 >= 100 else None
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
    # the week before: the published week 5-10 days earlier, else None (a
    # gap is a gap; no carrying a two-week-old number forward as last week's)
    before = [d for d in series if 5 <= (cur - d).days <= 10]
    pw = series[max(before)] if before else None
    return {"date": cur.strftime("%Y-%m-%d"), "pct": series[cur], "prev_week": pw,
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


# ── The NASS-printed 5-year average and last year (Nov 7, 2026) ────────────
#
# Why the file carried avg5 null all fall: Quick Stats has no average column,
# so the average above is computed from the weekly series, and NASS published
# no Crop Progress for the weeks ending Oct 5 to Nov 9, 2025 (the shutdown).
# Every Oct to mid-Nov 2026 week has one of its five years in that gap, so
# five_year_avg() withholds it (rightly: a straight line across 49 days is
# not a week). The weekly report itself still prints a 2021-2025 average for
# every progress table, nationally and for each state in the report; NASS
# says it uses its published weeks for 2021-2024 and its own imputed weeks
# for 2025 (Special Note, report of Oct 5, 2026). Its last-year column reads
# (NA) for the cancelled weeks, the same gap Quick Stats has.
#
# So the report is read as well: the PDF, through pdftotext -layout, one
# table per crop and stage. A table is used only when its own header names
# this week and the week before, its average spans the five years before
# this one, and a place's this-week figure equals the Quick Stats figure for
# the same place and week (a different file or week can never slip in). The
# printed average then replaces ours for that place, marked avg5_by "NASS";
# places not in the report keep our arithmetic (or None).

REPORT_URL = "https://www.nass.usda.gov/Publications/Todays_Reports/reports/prog{ww:02d}{yy:02d}.pdf"

# report table title -> PROGRESS_SERIES key
REPORT_TABLES = {
    "Corn Harvested": "corn_harvested",
    "Soybeans Harvested": "soybeans_harvested",
    "Winter Wheat Planted": "winter_wheat_planted",
    "Winter Wheat Emerged": "winter_wheat_emerged",
    "Cotton Harvested": "cotton_harvested",
    "Rice Harvested": "rice_harvested",
    "Peanuts Harvested": "peanuts_harvested",
    "Sorghum Harvested": "sorghum_harvested",
}

STATE_ALPHA = {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA", "Colorado": "CO",
    "Connecticut": "CT", "Delaware": "DE", "Florida": "FL", "Georgia": "GA", "Hawaii": "HI", "Idaho": "ID",
    "Illinois": "IL", "Indiana": "IN", "Iowa": "IA", "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA",
    "Maine": "ME", "Maryland": "MD", "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN",
    "Mississippi": "MS", "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV",
    "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC",
    "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK", "Oregon": "OR", "Pennsylvania": "PA",
    "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX",
    "Utah": "UT", "Vermont": "VT", "Virginia": "VA", "Washington": "WA", "West Virginia": "WV",
    "Wisconsin": "WI", "Wyoming": "WY",
}

import re as _re

_TITLE_RE = _re.compile(r"^\s*(%s)\s+[–—-]\s+Selected States\s*$" % "|".join(REPORT_TABLES))
_ANY_TITLE_RE = _re.compile(r"[–—-]\s+Selected States")
_ROW_RE = _re.compile(r"^\s*([A-Z][A-Za-z ]*?|\d+ States)\s*\.{2,}\s+(.+?)\s*$")
_HDR_DATE_RE = _re.compile(r"([A-Z][a-z]+ \d{1,2}),")
_AVG_YEARS_RE = _re.compile(r"\b(\d{4})-(\d{4})\b")


def _cell(tok: str):
    """A report cell: a whole percent, '-' (NASS: represents zero), or a
    marker such as (NA), (X), (D), (Z) -> None. Anything else: not a cell."""
    if tok == "-":
        return 0
    if _re.fullmatch(r"\d{1,3}", tok):
        return int(tok)
    if _re.fullmatch(r"\([A-Z]{1,2}\)", tok):
        return None
    raise ValueError(tok)


def parse_report(text: str) -> dict:
    """pdftotext -layout text of a weekly Crop Progress report ->
    {key: {"dates": (last_year, week_before, this_week) as YYYY-MM-DD,
           "avg_years": (first, last),
           "rows": {"US" or ST: {"prev_year", "prev_week", "pct", "avg5"}}}}
    Only the tables in REPORT_TABLES. A table whose header cannot be read
    (three dates, an average span) is left out, never guessed."""
    lines = text.splitlines()
    out: dict = {}
    i = 0
    while i < len(lines):
        m = _TITLE_RE.match(lines[i])
        if not m:
            i += 1
            continue
        key = REPORT_TABLES[m.group(1)]
        dates, avg_years, rows = None, None, {}
        j = i + 1
        while j < len(lines) and not _ANY_TITLE_RE.search(lines[j]):
            ln = lines[j]
            if avg_years is None:
                ay = _AVG_YEARS_RE.search(ln)
                if ay and "State" not in ln:
                    avg_years = (int(ay.group(1)), int(ay.group(2)))
            if dates is None and _re.match(r"^\s*State\b", ln) and "Average" in ln:
                md = _HDR_DATE_RE.findall(ln)
                yrs = _re.findall(r"\b(\d{4})\b", lines[j + 1]) if j + 1 < len(lines) else []
                if len(md) == 3 and len(yrs) == 3:
                    try:
                        dates = tuple(datetime.strptime(f"{a} {y}", "%B %d %Y").strftime("%Y-%m-%d")
                                      for a, y in zip(md, yrs))
                    except ValueError:
                        dates = None
            r = _ROW_RE.match(ln)
            if r:
                name, toks = r.group(1).strip(), r.group(2).split()
                loc = "US" if name.endswith(" States") else STATE_ALPHA.get(name)
                if loc and len(toks) == 4:
                    try:
                        ly, pw, tw, av = (_cell(t) for t in toks)
                    except ValueError:
                        ly = pw = tw = av = None
                        loc = None
                    if loc and tw is not None:
                        rows[loc] = {"prev_year": ly, "prev_week": pw, "pct": tw, "avg5": av}
                if loc == "US":
                    j += 1
                    break
            j += 1
        if dates and avg_years and rows:
            out[key] = {"dates": dates, "avg_years": avg_years, "rows": rows}
        else:
            print(f"    report table {m.group(1)!r}: header or rows not read; left out", flush=True)
        i = j
    return out


def apply_report(national: dict, states: dict, report: dict) -> list[str]:
    """Puts the NASS-printed 5-year average and last year into the summaries
    from build_progress, in place. Per table: its this-week date must be the
    national summary's date, the week before 7 days earlier, the average
    span the five years before this one. Per place: the report's this-week
    figure must equal the Quick Stats figure, else that place is skipped and
    logged. Returns the keys that took the report."""
    used = []
    for key, tbl in report.items():
        nat = national.get(key)
        ly_d, pw_d, tw_d = tbl["dates"]
        try:
            tw = datetime.strptime(tw_d, "%Y-%m-%d")
            ok = (nat is not None and nat["date"] == tw_d
                  and (tw - datetime.strptime(pw_d, "%Y-%m-%d")).days == 7
                  and tbl["avg_years"] == (tw.year - 5, tw.year - 1))
        except ValueError:
            ok = False
        if not ok:
            print(f"    report {key}: week {tw_d}, average {tbl['avg_years']} does not match "
                  f"this week ({nat and nat['date']}); not used", flush=True)
            continue
        took = 0
        for loc, row in tbl["rows"].items():
            sm = nat if loc == "US" else (states.get(loc) or {}).get(key)
            if sm is None:
                continue        # no Quick Stats row to check it against: left out
            if sm.get("date") != tw_d or sm.get("pct") != row["pct"]:
                print(f"    report {key} {loc}: {row['pct']} vs Quick Stats "
                      f"{sm.get('date')} {sm.get('pct')}; not used", flush=True)
                continue
            sm["avg5"] = row["avg5"]
            sm["avg5_by"] = "NASS"
            if row["prev_year"] is not None:
                sm["prev_year"] = row["prev_year"]
            if row["prev_week"] is not None:
                sm["prev_week"] = row["prev_week"]
            took += 1
        if took:
            used.append(key)
        print(f"    report {key}: NASS average for {took} of {len(tbl['rows'])} places", flush=True)
    return used


def report_numbers(week_end: str) -> list[int]:
    """Candidate report numbers for a week: NASS names the file progWWYY.pdf,
    WW the week of the year (the Oct 5, 2026 report, week ending Oct 4, is
    prog4026). The week-ending Sunday's ISO week first, then the neighbours;
    the content check in apply_report decides, never the name."""
    d = datetime.strptime(week_end, "%Y-%m-%d")
    w = d.isocalendar()[1]
    out = []
    for n in (w, int((d + timedelta(days=1)).strftime("%U")), w + 1, w - 1):
        if 1 <= n <= 53 and n not in out:
            out.append(n)
    return out


def fetch_report(week_end: str) -> dict:
    """Downloads and parses the report for week_end. {} on any failure
    (no pdftotext, no file, no table for that week): the caller keeps its
    own arithmetic."""
    import shutil
    import subprocess
    import tempfile
    if not shutil.which("pdftotext"):
        print("  report: pdftotext not found; NASS average not read", flush=True)
        return {}
    yy = int(week_end[2:4])
    for ww in report_numbers(week_end):
        url = REPORT_URL.format(ww=ww, yy=yy)
        print(f"  GET {url}", flush=True)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "AGSIST/1.0"})
            with urllib.request.urlopen(req, timeout=60) as resp:
                pdf = resp.read()
            with tempfile.NamedTemporaryFile(suffix=".pdf") as tf:
                tf.write(pdf)
                tf.flush()
                txt = subprocess.run(["pdftotext", "-layout", "-enc", "UTF-8", tf.name, "-"],
                                     capture_output=True, text=True, timeout=120).stdout
        except Exception as e:
            print(f"    not read: {e}", flush=True)
            continue
        rep = parse_report(txt)
        weeks = {t["dates"][2] for t in rep.values()}
        if week_end in weeks:
            print(f"    {len(rep)} tables for the week ending {week_end}", flush=True)
            return {k: t for k, t in rep.items() if t["dates"][2] == week_end}
        print(f"    tables are for {sorted(weeks)}, not {week_end}", flush=True)
    return {}


PROGRESS_METHOD = (
    "5-year average: the one NASS prints in the weekly Crop Progress report where a "
    "figure carries avg5_by NASS (the national row and the states in the report; for "
    "2021-2025 NASS used its own estimates for the October 2025 weeks it did not "
    "publish). Elsewhere AGSIST's arithmetic on the NASS weekly series, each of the "
    "five prior years interpolated to the same calendar date, then averaged; withheld "
    "if any year lacks a published week on both sides, and can differ from the "
    "NASS-printed average by a point.")


def merge_report(result: dict, national: dict, states: dict, get_report) -> list[str]:
    """Reads the report for the newest national week through get_report
    (injectable for the selftest), applies it, and copies the national corn
    and soybean figures onto result[crop] (harvest_5yr_avg, and
    harvest_prev_year when Quick Stats had none). Fail-soft."""
    used = []
    weeks = sorted({sm["date"] for sm in national.values()})
    if weeks:
        try:
            used = apply_report(national, states, get_report(weeks[-1]) or {})
        except Exception as e:
            print(f"  report read failed (non-fatal): {e}", flush=True)
    for crop in ("corn", "soybeans"):
        sm = national.get(crop + "_harvested")
        if result.get(crop) and sm and sm["date"] == result[crop].get("harvest_date"):
            result[crop]["harvest_5yr_avg"] = sm["avg5"]
            if result[crop].get("harvest_prev_year") is None and sm.get("prev_year") is not None:
                result[crop]["harvest_prev_year"] = sm["prev_year"]
    result["progress"] = national
    result["states"] = states
    result["progress_method"] = PROGRESS_METHOD
    return used


def is_in_season() -> bool:
    """Crop Progress runs April through November."""
    m = datetime.now().month
    return 4 <= m <= 11


COND_KEYS = ("good_excellent", "report_date", "good_excellent_prev_week", "good_excellent_prev_year")


def hold_last_condition(result: dict, path: str, today=None, max_age_days: int = 14) -> list[str]:
    """Oct 27, 2026: a later run that day got no condition rows back from Quick
    Stats and wrote good_excellent and report_date as null over the 56% read
    that morning, blanking the conditions card. When this run has no condition
    reading for a crop but the file on disk has one for the same season, no
    more than max_age_days old, keep it and say so. Never invents a value."""
    from datetime import date as _d
    try:
        with open(path) as f:
            old = json.load(f)
    except Exception:
        return []
    today = today or _d.today()
    held = []
    for key in ("corn", "soybeans", "winter_wheat", "spring_wheat"):
        new_c, old_c = result.get(key), (old or {}).get(key)
        if not isinstance(new_c, dict) or not isinstance(old_c, dict):
            continue
        if new_c.get("good_excellent") is not None or old_c.get("good_excellent") is None:
            continue
        rd = old_c.get("report_date")
        try:
            age = (today - _d.fromisoformat(str(rd)[:10])).days
        except Exception:
            continue
        if not (0 <= age <= max_age_days) or str(rd)[:4] != str(today.year):
            continue
        for k in COND_KEYS:
            if new_c.get(k) is None and old_c.get(k) is not None:
                new_c[k] = old_c[k]
        new_c["condition_held_from"] = rd
        held.append(key)
    if held and not result.get("report_date"):
        result["report_date"] = (old or {}).get("report_date") or result[held[0]].get("report_date")
    if held:
        print(f"  condition held from the last good read for {', '.join(held)} (no rows this run)", flush=True)
    return held



def main():
    os.makedirs("data", exist_ok=True)

    if not API_KEY:
        print("WARNING: NASS_API_KEY not set. Get a free key at https://quickstats.nass.usda.gov/api/")
        print("Writing off-season placeholder.")
        out = {
            "updated": ct_today(),
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
        "updated":     ct_today(),
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
        merge_report(result, national, states, fetch_report)
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

    hold_last_condition(result, OUT_FILE)

    # compact: with every state row the indented file passed 30 KB (Nov 7, 2026)
    with open(OUT_FILE, "w") as f:
        json.dump(result, f, separators=(",", ":"))
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

    print("\nA GAP IN PUBLISHING IS NOT A STRAIGHT LINE (audit Nov 2, 2026)")
    g = {D("2025-10-01"): 20, D("2025-10-22"): 41}
    check(value_on(g, D("2025-10-08")) == 27.0, "weeks 21 days apart: still a line", value_on(g, D("2025-10-08")))
    g = {D("2025-10-01"): 20, D("2025-10-23"): 42}
    check(value_on(g, D("2025-10-08")) is None, "weeks 22 days apart: None", value_on(g, D("2025-10-08")))
    check(value_on({D("2025-10-01"): 100, D("2025-11-16"): 100}, D("2025-10-20")) == 100.0, "already 100 before the gap: 100")
    # the real national corn harvest weeks: the fall 2025 shutdown, Sep 28 (18%) to Nov 16 (91%)
    fx = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "test", "fixtures",
                                     "crop-progress-corn-harvest-us.json")))
    corn = {D(k): v for k, v in fx["weeks"].items()}
    check(corn[D("2025-09-28")] == 18 and corn[D("2025-11-16")] == 91
          and not [d for d in corn if D("2025-09-28") < d < D("2025-11-16")], "fixture: no 2025 week between Sep 28 and Nov 16")
    check(value_on(corn, D("2025-10-25")) is None, "Oct 25, 2025 falls in the shutdown gap: None, not 58",
          value_on(corn, D("2025-10-25")))
    others = [round(value_on(corn, D(f"{y}-10-25")), 2) for y in (2024, 2023, 2022, 2021)]
    check(others == [76.43, 64.14, 65.29, 67.14], "the four other years still interpolate within a week", others)
    line = 18 + (91 - 18) * 27 / 49          # what the uncapped line gave for Oct 25, 2025
    check(int((sum(others) + line) / 5 + 0.5) == 66, "before the fix: the Oct 25, 2026 average was 66 with the line")
    sm = summarize({d: v for d, v in corn.items() if d <= D("2026-10-25")})
    check(sm["date"] == "2026-10-25" and sm["pct"] == 60 and sm["avg5"] is None,
          "Oct 25, 2026 corn harvested 60%: 5-year average withheld (one of the five years has no week near it)", sm)

    print("\nTHE WEEK BEFORE")
    wb = summarize({D("2026-10-11"): 33, D("2026-10-04"): 23, D("2026-09-27"): 15})
    check(wb["prev_week"] == 23, "week before = the published week 7 days earlier", wb)
    wb = summarize({D("2026-10-11"): 33, D("2026-09-27"): 15})
    check(wb["prev_week"] is None, "a skipped week leaves the week before blank, not two weeks back", wb)

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

    print("\nTHE NASS-PRINTED 5-YEAR AVERAGE FROM THE WEEKLY REPORT (Nov 7, 2026)")
    # the real report of Oct 5, 2026 (week ending Oct 4), pdftotext -layout, saved copy
    rtxt = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "test", "fixtures",
                             "crop-progress-report-2026-10-04.txt"), encoding="utf-8").read()
    rep = parse_report(rtxt)
    check(sorted(rep) == sorted(REPORT_TABLES.values()), "all eight progress tables read", sorted(rep))
    ch = rep.get("corn_harvested", {})
    check(ch.get("dates") == ("2025-10-04", "2026-09-27", "2026-10-04") and ch.get("avg_years") == (2021, 2025),
          "corn harvested header: Oct 4 2025, Sep 27 2026, Oct 4 2026; 2021-2025 average", ch.get("dates"))  # pin-ok: fixture
    check(ch["rows"]["US"] == {"prev_year": None, "prev_week": 18, "pct": 23, "avg5": 27},
          "18 States row: 23% harvested, 18% the week before, last year (NA) -> None, average 27", ch["rows"]["US"])  # pin-ok: fixture
    check(ch["rows"]["IA"] == {"prev_year": None, "prev_week": 5, "pct": 7, "avg5": 20}, "Iowa corn 7%, average 20",
          ch["rows"]["IA"])  # pin-ok: fixture
    check(len(ch["rows"]) == 19 and ch["rows"]["CO"]["prev_week"] == 0 and ch["rows"]["PA"]["prev_week"] == 0,
          "18 states and the total; '-' (represents zero) is 0", ch["rows"].get("CO"))  # pin-ok: fixture
    check(rep["soybeans_harvested"]["rows"]["US"]["avg5"] == 33 and rep["soybeans_harvested"]["rows"]["IA"]["avg5"] == 38,
          "soybeans: US average 33, Iowa 38")  # pin-ok: fixture
    check(rep["winter_wheat_planted"]["rows"]["US"]["pct"] == 36 and rep["winter_wheat_planted"]["rows"]["US"]["avg5"] == 46,
          "winter wheat planted 36%, average 46")  # pin-ok: fixture
    check(rep["cotton_harvested"]["rows"]["US"]["avg5"] == 21 and len(rep["cotton_harvested"]["rows"]) == 16,
          "cotton: 15 states and the total, average 21")  # pin-ok: fixture
    check(parse_report(rtxt.replace("2021-2025", "")) == {}, "no average span in the header: every table left out")
    check(parse_report("Corn Harvested – Selected States\nIowa ........ 1 2 3\n") == {},
          "a table without its header is left out, never guessed")

    # Quick Stats summaries for the same week: national corn from the saved series
    # (the fall 2025 gap leaves our own average None), Iowa and a non-report state
    qs_nat = {"corn_harvested": summarize({d: v for d, v in corn.items() if d <= D("2026-10-04")}),
              "soybeans_harvested": {"date": "2026-10-04", "pct": 25, "prev_week": 17, "prev_year": None, "avg5": None},
              "winter_wheat_planted": {"date": "2026-10-04", "pct": 36, "prev_week": 27, "prev_year": None, "avg5": None}}
    check(qs_nat["corn_harvested"]["pct"] == 23 and qs_nat["corn_harvested"]["avg5"] is None,
          "before: Quick Stats corn 23% on Oct 4, our average withheld (2025 gap)", qs_nat["corn_harvested"])
    qs_st = {"IA": {"corn_harvested": {"date": "2026-10-04", "pct": 7, "prev_week": 5, "prev_year": None, "avg5": None},
                    "soybeans_harvested": {"date": "2026-10-04", "pct": 6, "prev_week": 3, "prev_year": None, "avg5": None}},
             "NY": {"corn_harvested": {"date": "2026-10-04", "pct": 4, "prev_week": 2, "prev_year": None, "avg5": None}}}
    res = {"corn": {"harvest_pct": 23, "harvest_date": "2026-10-04", "harvest_prev_year": None},
           "soybeans": {"harvest_pct": 25, "harvest_date": "2026-10-04", "harvest_prev_year": None}}
    used = merge_report(res, qs_nat, qs_st, lambda wk: {k: t for k, t in rep.items() if t["dates"][2] == wk})
    check(res["corn"]["harvest_5yr_avg"] == 27 and res["soybeans"]["harvest_5yr_avg"] == 33,
          "after: corn harvest_5yr_avg 27, soybeans 33 (NASS-printed)", res)  # pin-ok: fixture
    check(res["corn"]["harvest_prev_year"] is None, "last year stays None: NASS printed (NA) for the cancelled week")
    check(res["progress"]["corn_harvested"]["avg5_by"] == "NASS" and res["progress"]["winter_wheat_planted"]["avg5"] == 46,
          "national rows marked avg5_by NASS; winter wheat planted average 46")  # pin-ok: fixture
    check(qs_st["IA"]["corn_harvested"]["avg5"] == 20 and qs_st["IA"]["corn_harvested"]["avg5_by"] == "NASS",
          "Iowa corn takes the printed 20", qs_st["IA"]["corn_harvested"])  # pin-ok: fixture
    check(qs_st["IA"]["soybeans_harvested"]["avg5"] is None and "avg5_by" not in qs_st["IA"]["soybeans_harvested"],
          "Iowa soybeans 6% in Quick Stats vs 5% in the report: not used", qs_st["IA"]["soybeans_harvested"])
    check("avg5_by" not in qs_st["NY"]["corn_harvested"], "a state not in the report keeps our arithmetic")
    check("cotton_harvested" not in used and "corn_harvested" in used, "a table with no Quick Stats week is skipped", used)
    check(res["progress_method"] == PROGRESS_METHOD and "NASS prints" in PROGRESS_METHOD, "method says whose average")
    # a report for another week, or the wrong average span, is never applied
    n2 = {"corn_harvested": {"date": "2026-10-11", "pct": 23, "prev_week": 18, "prev_year": None, "avg5": None}}
    check(apply_report(n2, {}, {"corn_harvested": rep["corn_harvested"]}) == [] and n2["corn_harvested"]["avg5"] is None,
          "report week Oct 4 against a Quick Stats week of Oct 11: not used")
    n3 = {"corn_harvested": {"date": "2026-10-04", "pct": 23, "prev_week": 18, "prev_year": None, "avg5": None}}
    bad = dict(rep["corn_harvested"], avg_years=(2020, 2024))
    check(apply_report(n3, {}, {"corn_harvested": bad}) == [] and n3["corn_harvested"]["avg5"] is None,
          "an average over 2020-2024 for a 2026 week: not used")
    res2 = {"corn": {"harvest_pct": 23, "harvest_date": "2026-10-04"}}
    n4 = {"corn_harvested": {"date": "2026-10-04", "pct": 23, "prev_week": 18, "prev_year": None, "avg5": None}}
    def boom(wk):
        raise RuntimeError("simulated outage")
    merge_report(res2, n4, {}, boom)
    check(res2["corn"]["harvest_5yr_avg"] is None and res2["progress"] is n4, "report outage: our figures stand, no crash")
    check(report_numbers("2026-10-04")[0] == 40, "week ending Oct 4, 2026 -> prog4026 first", report_numbers("2026-10-04"))

    print("HOLD THE LAST GOOD CONDITION READ (Oct 27, 2026: a later run wrote nulls)")
    import tempfile
    from datetime import date as _d
    old = {"report_date": "2026-10-25", "corn": {"good_excellent": 56, "report_date": "2026-10-25",
           "good_excellent_prev_week": 56, "harvest_pct": 55}}
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as tf:
        json.dump(old, tf)
    new = {"report_date": None, "corn": {"good_excellent": None, "report_date": None,
           "good_excellent_prev_week": None, "harvest_pct": 60}, "soybeans": None}
    held = hold_last_condition(new, tf.name, today=_d(2026, 10, 27))
    check(held == ["corn"] and new["corn"]["good_excellent"] == 56, "no rows this run: the Oct 25 56% is kept", new)
    check(new["corn"]["harvest_pct"] == 60, "this run's harvest figure is not replaced")
    check(new["corn"]["condition_held_from"] == "2026-10-25" and new["report_date"] == "2026-10-25",
          "held reading says where it came from; report date filled")
    new2 = {"corn": {"good_excellent": 58, "report_date": "2026-11-01"}}
    check(hold_last_condition(new2, tf.name, today=_d(2026, 11, 2)) == [] and new2["corn"]["good_excellent"] == 58,
          "a fresh reading is never replaced")
    new3 = {"corn": {"good_excellent": None, "report_date": None}}
    check(hold_last_condition(new3, tf.name, today=_d(2026, 11, 20)) == [] and new3["corn"]["good_excellent"] is None,
          "a reading older than 14 days is not carried forward")
    os.unlink(tf.name)

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
