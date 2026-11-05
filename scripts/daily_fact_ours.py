#!/usr/bin/env python3
"""
daily_fact_ours.py -- the computed ("ours") facts for the Daily's "I didn't know that" slot (scripts/daily_fact.py
picks the day's fact; this file makes the ones we work out from our own files).

Every generator takes (day, repo) and returns one fact dict or None:
  {"id", "kind": "ours", "category", "text", "source", "file", "url": None, "as_of"}
It reads only files that existed on that day (a file read after the day, or a row dated on or after it, is not used:
no look-ahead), names the file it read, and returns None when the data is thin, stale or cannot be read. None means
the slot is filled from the pool; a guess is never printed (honest-numbers).

  id                  category               file(s)
  ours-rain-day       weather and climate    data/rain/<st>.json (in daily_fact.py, kept as it was)
  ours-dry-spell      weather and climate    data/rain/<st>.json (in daily_fact.py, kept as it was)
  ours-hail-big       weather and climate    data/hail/events-<year>.json
  ours-drought        weather and climate    data/drought/summary.json
  ours-wasde-corn     markets and prices     data/wasde-history/corn.json (+ corn-1990s.json)
  ours-wasde-soy      markets and prices     data/wasde-history/soybeans.json (+ soybeans-1990s.json)
  ours-land-top       land and rent          data/land-sales/<st>/<fips>.json
  ours-rent-range     land and rent          data/cash-rent/<ST>.json
  ours-harvest-us     agronomy               data/crop-progress.json
  ours-harvest-state  agronomy               data/crop-progress.json
  ours-china-soy      global trade           data/export-sales.json
  ours-export-pace    global trade           data/export-sales.json
  ours-steer-top      livestock              data/cattle-auction.json

    python3 scripts/daily_fact_ours.py --date 2026-11-02     every generator for that day
    python3 scripts/daily_fact_ours.py --selftest            hand-worked cases on made-up files
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import glob
import json
import os
import sys
import tempfile
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from credits import NASS_NOTICE  # noqa: E402  the NASS API notice
REPO = os.path.dirname(HERE)
FARM_STATES = ("IA", "IL", "IN", "OH", "MN", "NE", "SD", "ND", "WI", "MO", "KS", "MI", "KY")
MONTHS = ("January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
          "November", "December")
STATE_NAMES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado",
    "CT": "Connecticut", "DE": "Delaware", "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho",
    "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana",
    "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota",
    "MS": "Mississippi", "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York", "NC": "North Carolina",
    "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania",
    "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas",
    "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington", "WV": "West Virginia",
    "WI": "Wisconsin", "WY": "Wyoming", "DC": "the District of Columbia"}

# gates (withhold under these)
WASDE_MIN_YEARS = 10        # this month on file in at least 10 years
WASDE_MAX_GAP = 45          # the report before must be the month before (days apart)
LAND_MIN_ACRES = 40
LAND_MIN_SALES = 10         # judged farmland sales of 40+ acres in the state that month
LAND_MAX_AGE = 60           # days after the month ends that the month is still news
RENT_MIN_COUNTIES = 10
HAIL_CORROBORATE = 0.75     # another report that day in that state at 75% of the size or more
HAIL_MIN_REPORTS = 500      # reports so far this year before "the biggest this year" means anything
FRESH_DAYS = 10             # weekly reports: older than this is not today's news
STEER_MIN_HEAD = 20
STEER_MIN_BARNS = 5
STEER_DAYS = 7


def _md(iso):
    d = date.fromisoformat(iso[:10])
    return "%s %d" % (MONTHS[d.month - 1], d.day)


def _load(repo, rel):
    try:
        with open(os.path.join(repo, rel), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _iso(s):
    try:
        return date.fromisoformat(str(s)[:10])
    except ValueError:
        return None


def _num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def _fmt_int(x):
    return "{:,}".format(int(round(x)))


def _fact(gid, cat, text, source, rel, as_of):
    assert "—" not in text
    return {"id": gid, "kind": "ours", "category": cat, "text": text, "source": source, "file": rel, "url": None,
            "as_of": as_of}


# ---------------------------------------------------------------- WASDE: this month in WASDE history
def _wasde_rows(repo, crop):
    """[(report_date, market_year, {series_index: value})...] per report, from both parts of the archive."""
    main = _load(repo, "data/wasde-history/%s.json" % crop)
    if not main or not main.get("reports") or not main.get("series"):
        return None, None
    old = _load(repo, "data/wasde-history/%s-1990s.json" % crop) or {}
    years = dict(old.get("years") or {})
    years.update(main.get("years") or {})
    return main, years


def wasde_month(day, repo, crop):
    main, years = _wasde_rows(repo, crop)
    if not main:
        return None
    reports = main["reports"]
    lines = [s.get("line") for s in main["series"]]
    month = day.month
    use_yield = month in (8, 9, 10, 11, 12, 1)
    want = "Yield per Harvested Acre" if use_yield else "Ending Stocks"
    if want not in lines:
        return None
    si = str(lines.index(want))
    vals = {}                                    # (report index, market year) -> value
    for my, y in years.items():
        for ri, v in (y.get("s") or {}).get(si) or []:
            if _num(v):
                vals[(int(ri), my)] = v
    cases = []
    for i, r in enumerate(reports):
        rd = _iso(r[0])
        if not rd or rd.month != month or rd >= day or i == 0:
            continue
        pd = _iso(reports[i - 1][0])
        if not pd or (rd - pd).days > WASDE_MAX_GAP:
            continue                             # the month before is missing from the file: no change to state
        mys = sorted(my for (ri, my) in vals if ri == i and (i - 1, my) in vals)
        if not mys:
            continue
        my = mys[-1]                             # the newest crop both reports carry
        a, b = vals[(i - 1, my)], vals[(i, my)]
        cases.append((abs(b - a), rd, my, a, b))
    if len(cases) < WASDE_MIN_YEARS:
        return None
    cases.sort(key=lambda c: (-c[0], c[1]))
    ch, rd, my, a, b = cases[0]
    if ch == 0:
        return None
    first = min(c[1] for c in cases).year
    name = {"corn": "corn", "soybeans": "soybean", "wheat": "wheat"}[crop]
    up = "raised" if b > a else "cut"
    if use_yield:
        what = "the US %s yield" % name
        amt = "%s bushels an acre, to %s" % (("%.1f" % ch).rstrip("0").rstrip("."), ("%.1f" % b).rstrip("0").rstrip("."))
    else:
        what = "US %s ending stocks" % name
        amt = "%s million bushels, to %s million" % (_fmt_int(ch), _fmt_int(b))
    text = ("This month in WASDE history: the biggest %s change to %s since %d came in %s %d, when USDA %s it %s "
            "for the %s crop year. %d years with %s %s report before it."
            % (MONTHS[month - 1], what, first, MONTHS[month - 1], rd.year, up, amt, my, len(cases),
               "an" if MONTHS[month - 2][0] in "AEIOU" else "a", MONTHS[month - 2]))
    rel = "data/wasde-history/%s.json" % crop
    return _fact("ours-wasde-" + ("corn" if crop == "corn" else "soy"), "markets and prices", text,
                 "USDA World Agricultural Outlook Board, WASDE reports as printed", rel, rd.isoformat())


def wasde_corn(day, repo=REPO):
    return wasde_month(day, repo, "corn")


def wasde_soy(day, repo=REPO):
    return wasde_month(day, repo, "soybeans")


# ---------------------------------------------------------------- land: top $/acre farm sale last month
def _land_month(day, repo, end):
    """[(ST, rows)] for the month ending on `end`, from state files read before the day that hold the whole month."""
    start = date(end.year, end.month, 1)
    states = []
    for p in sorted(glob.glob(os.path.join(repo, "data", "land-sales", "??.json"))):
        st = os.path.basename(p)[:2]
        top = _load(repo, "data/land-sales/%s.json" % st) or {}
        fetched, through = _iso(top.get("fetched")), _iso(top.get("through"))
        if not fetched or fetched >= day or not through or through < end:
            continue                             # read on or after the day, or the month not fully in the file
        rows = []
        for cp in sorted(glob.glob(os.path.join(repo, "data", "land-sales", st, "*.json"))):
            c = _load(repo, os.path.relpath(cp, repo)) or {}
            cols = c.get("cols") or []
            try:
                ix = {k: cols.index(k) for k in ("when", "acres", "ppa", "kind", "flag")}
            except ValueError:
                continue
            for r in c.get("s") or []:
                if not isinstance(r, list) or len(r) < len(cols):
                    continue
                w = _iso(r[ix["when"]])
                if (w and start <= w <= end and r[ix["kind"]] == "f" and r[ix["flag"]] == 0
                        and _num(r[ix["acres"]]) and r[ix["acres"]] >= LAND_MIN_ACRES and _num(r[ix["ppa"]])
                        and r[ix["ppa"]] > 0):
                    rows.append((r[ix["ppa"]], r[ix["acres"]], c.get("county") or "", w))
        if len(rows) >= LAND_MIN_SALES:
            states.append((st.upper(), rows))
    return states


def land_top(day, repo=REPO):
    """The newest complete month the state files hold (last month, else the one before), while it is still news."""
    end = date(day.year, day.month, 1) - timedelta(days=1)
    states = []
    for _ in range(2):
        if (day - end).days > LAND_MAX_AGE:
            break
        states = _land_month(day, repo, end)
        if states:
            break
        end = date(end.year, end.month, 1) - timedelta(days=1)
    if not states:
        return None
    st, rows = states[day.toordinal() % len(states)]
    rows.sort(key=lambda x: (-x[0], -x[1], x[2]))
    ppa, acres, county, w = rows[0]
    ac = ("%.1f" % acres).rstrip("0").rstrip(".")
    text = ("The top price per acre on a farmland sale of %d acres or more in %s in %s: $%s an acre for %s "
            "acres in %s County. That is the top of %d such sales; sales far from their county's usual price are left out."
            % (LAND_MIN_ACRES, STATE_NAMES.get(st, st), MONTHS[end.month - 1], _fmt_int(ppa), ac, county, len(rows)))
    src = (_load(repo, "data/land-sales/%s.json" % st.lower()) or {}).get("source") or "state sale records"
    return _fact("ours-land-top", "land and rent", text, src, "data/land-sales/%s/" % st.lower(), w.isoformat())


# ---------------------------------------------------------------- cash rent: highest and lowest county
def rent_range(day, repo=REPO):
    got = []
    for st in FARM_STATES:
        d = _load(repo, "data/cash-rent/%s.json" % st)
        if not d or not _iso(d.get("generated")) or _iso(d["generated"]) >= day:
            continue
        years = sorted(int(y) for y in d.get("years") or [] if int(y) <= day.year)
        for y in reversed(years):
            rows = [(c["rent"]["nonirr"][str(y)], c.get("name") or "") for c in d.get("counties") or []
                    if _num(((c.get("rent") or {}).get("nonirr") or {}).get(str(y)))]
            if len(rows) >= RENT_MIN_COUNTIES:
                got.append((st, y, rows))
                break
    if not got:
        return None
    st, y, rows = got[day.toordinal() % len(got)]
    rows.sort(key=lambda r: (-r[0], r[1]))
    hi, lo = rows[0], rows[-1]
    if hi[0] == lo[0]:
        return None
    text = ("Cash rent on %s cropland without irrigation, %d: the highest county was %s at $%s an acre, the lowest %s "
            "at $%s. That is a gap of $%s an acre across %d counties with a USDA figure."
            % (STATE_NAMES[st], y, hi[1], _fmt_int(hi[0]), lo[1], _fmt_int(lo[0]), _fmt_int(hi[0] - lo[0]), len(rows)))
    return _fact("ours-rent-range", "land and rent", text, "USDA NASS Cash Rents Survey, county estimates. " + NASS_NOTICE,
                 "data/cash-rent/%s.json" % st, "%d" % y)


# ---------------------------------------------------------------- hail: biggest reported stone this year
def hail_big(day, repo=REPO):
    rel = "data/hail/events-%d.json" % day.year
    d = _load(repo, rel)
    if not d or not isinstance(d.get("ev"), list):
        return None
    man = _load(repo, "data/hail/manifest.json") or {}
    gen = _iso(man.get("generated"))
    if not gen or gen >= day:
        return None
    cut = day.strftime("%m-%d")
    ev = [e for e in d["ev"] if isinstance(e, list) and len(e) >= 5 and _num(e[2]) and e[2] > 0
          and isinstance(e[3], str) and e[3] < cut]
    if len(ev) < HAIL_MIN_REPORTS:
        return None
    by = {}
    for e in ev:
        by.setdefault((e[3], e[4]), []).append(e[2])
    ev.sort(key=lambda e: (-e[2], e[3]))
    for e in ev[:30]:
        same = sorted(by[(e[3], e[4])], reverse=True)
        if len(same) < 2 or same[1] < HAIL_CORROBORATE * e[2]:
            continue                             # one report alone could be a typo: it is not said
        size = ("%.2f" % e[2]).rstrip("0").rstrip(".")
        text = ("The biggest hail reported in the US so far this year: %s inches across, in %s on %s. "
                "Another report there that day was %s inches. %s hail reports this year through %s."
                % (size, STATE_NAMES.get(e[4], e[4]), _md("%d-%s" % (day.year, e[3])),
                   ("%.2f" % same[1]).rstrip("0").rstrip("."), _fmt_int(len(ev)),
                   _md("%d-%s" % (day.year, max(x[3] for x in ev)))))
        return _fact("ours-hail-big", "weather and climate", text,
                     "National Weather Service storm reports (NOAA Storm Prediction Center)", rel,
                     "%d-%s" % (day.year, e[3]))
    return None


# ---------------------------------------------------------------- drought: share of the Lower 48 now and a year ago
def drought(day, repo=REPO):
    rel = "data/drought/summary.json"
    d = _load(repo, rel)
    if not d:
        return None
    valid, fetched = _iso(d.get("valid")), _iso(d.get("fetched"))
    dates = d.get("dates") or []
    c = d.get("conus") or []
    if not valid or not fetched or fetched >= day or (day - valid).days > FRESH_DAYS or len(dates) < 4 or len(c) < 4:
        return None
    now, ago = c[0], c[3]
    if not (now and ago and _num(now[1]) and _num(ago[1])) or dates[0] != valid.isoformat():
        return None
    a, b = now[1], ago[1]
    if abs(a - b) < 1:
        how = "about the same as"
    else:
        how = "up from" if a > b else "down from"
    text = ("%.0f%% of the Lower 48 was in drought (moderate or worse) on %s, %s %.0f%% a year earlier. "
            "%.0f%% was in severe drought or worse." % (a, _md(valid.isoformat()), how, b, now[2]))
    return _fact("ours-drought", "weather and climate", text, "U.S. Drought Monitor (NDMC, University of Nebraska-Lincoln)",
                 rel, valid.isoformat())


# ---------------------------------------------------------------- crop progress: harvest pace vs the 5-year average
def _progress(day, repo):
    d = _load(repo, "data/crop-progress.json")
    if not d or not d.get("in_season"):
        return None
    up = _iso(d.get("updated"))
    if not up or up >= day:
        return None
    return d


def _pace_row(row, day):
    if not isinstance(row, dict):
        return None
    when = _iso(row.get("date"))
    if not when or when >= day or (day - when).days > FRESH_DAYS:
        return None
    if not (_num(row.get("pct")) and _num(row.get("avg5"))) or row["pct"] >= 100 or row["pct"] <= 0:
        return None
    return when, row["pct"], row["avg5"]


def harvest_us(day, repo=REPO):
    d = _progress(day, repo)
    if not d:
        return None
    best = None
    for crop, key in (("corn", "corn_harvested"), ("soybean", "soybeans_harvested")):
        r = _pace_row((d.get("progress") or {}).get(key), day)
        if r and (best is None or abs(r[1] - r[2]) > abs(best[2] - best[3])):
            best = (crop,) + r
    if not best:
        return None
    crop, when, pct, avg = best
    if pct == avg:
        rel = "right on"
    else:
        rel = "%d points %s" % (abs(pct - avg), "ahead of" if pct > avg else "behind")
    text = ("The US %s harvest was %d%% done on %s, %s the 5-year average of %d%% for that date."
            % (crop, pct, _md(when.isoformat()), rel, avg))
    return _fact("ours-harvest-us", "agronomy", text,
                 "USDA NASS Crop Progress; 5-year average is a calculation by AGSIST on the NASS weekly series. " + NASS_NOTICE,
                 "data/crop-progress.json", when.isoformat())


def harvest_state(day, repo=REPO):
    d = _progress(day, repo)
    if not d:
        return None
    rows = []
    for crop, key in (("corn", "corn_harvested"), ("soybean", "soybeans_harvested")):
        for st, v in sorted((d.get("states") or {}).items()):
            r = _pace_row((v or {}).get(key), day)
            if r:
                rows.append((abs(r[1] - r[2]), st, crop) + r)
    if len(rows) < 10:
        return None
    rows.sort(key=lambda r: (-r[0], r[1], r[2]))
    gap, st, crop, when, pct, avg = rows[0]
    if gap < 5:
        return None
    text = ("Furthest from its usual harvest pace this week: %s %s, %d%% harvested on %s against a 5-year average of "
            "%d%%, %d points %s." % (STATE_NAMES.get(st, st), crop, pct, _md(when.isoformat()), avg, gap,
                                     "ahead" if pct > avg else "behind"))
    return _fact("ours-harvest-state", "agronomy", text,
                 "USDA NASS Crop Progress; 5-year average is a calculation by AGSIST on the NASS weekly series. " + NASS_NOTICE,
                 "data/crop-progress.json", when.isoformat())


# ---------------------------------------------------------------- export sales
def _exports(day, repo):
    d = _load(repo, "data/export-sales.json")
    if not d:
        return None
    up = _iso(d.get("updated"))
    if not up or up >= day or (day - up).days > FRESH_DAYS:
        return None
    return d


def china_soy(day, repo=REPO):
    d = _exports(day, repo)
    s = (d or {}).get("soybeans") or {}
    c = s.get("china") or {}
    if not (c and _num(c.get("commitments_mt")) and _num(c.get("shipped_mt")) and _num(c.get("outstanding_mt"))):
        return None
    if c["commitments_mt"] <= 0 or abs(c["shipped_mt"] + c["outstanding_mt"] - c["commitments_mt"]) > 1000:
        return None                                  # the parts must add up to the whole
    wk = _iso(c.get("week_ending"))
    if not wk or wk >= day:
        return None
    m = lambda x: ("%.1f" % (x / 1e6))
    text = ("US soybean sales to China for the %s marketing year stood at %s million metric tons as of the week "
            "ending %s: %s million shipped and %s million still to ship."
            % (c.get("marketing_year") or s.get("marketing_year"), m(c["commitments_mt"]), _md(wk.isoformat()),
               m(c["shipped_mt"]), m(c["outstanding_mt"])))
    return _fact("ours-china-soy", "global trade", text, "USDA FAS Export Sales Reporting", "data/export-sales.json",
                 wk.isoformat())


def export_pace(day, repo=REPO):
    d = _exports(day, repo)
    if not d:
        return None
    best = None
    for crop, name in (("corn", "corn"), ("soybeans", "soybean"), ("wheat", "wheat")):
        s = d.get(crop) or {}
        if not (_num(s.get("cumulative_mt")) and _num(s.get("prev_year_cumulative_mt")) and s["prev_year_cumulative_mt"] > 0):
            continue
        wk = _iso(s.get("report_date"))
        if not wk or wk >= day:
            continue
        pct = 100.0 * (s["cumulative_mt"] / s["prev_year_cumulative_mt"] - 1)
        if best is None or abs(pct) > abs(best[0]):
            best = (pct, name, s, wk)
    if not best:
        return None
    pct, name, s, wk = best
    if abs(pct) < 5:
        return None
    text = ("US %s export sales for %s reached %s million metric tons by the week ending %s, %d%% %s than at the same "
            "point a year earlier." % (name, s.get("marketing_year"), "%.1f" % (s["cumulative_mt"] / 1e6),
                                       _md(wk.isoformat()), round(abs(pct)), "more" if pct > 0 else "less"))
    return _fact("ours-export-pace", "global trade", text, "USDA FAS Export Sales Reporting", "data/export-sales.json",
                 wk.isoformat())


# ---------------------------------------------------------------- sale barns: top 500-weight steer price this week
def steer_top(day, repo=REPO):
    rel = "data/cattle-auction.json"
    d = _load(repo, rel)
    if not d:
        return None
    up = _iso(d.get("updated"))
    if not up or up >= day:
        return None
    rows, barns = [], set()
    for b in d.get("barns") or []:
        for s in b.get("sales") or []:
            w = _iso(s.get("date"))
            if not w or w >= day or (day - w).days > STEER_DAYS:
                continue
            c = ((s.get("classes") or {}).get("steers|1") or {}).get("500") or {}
            if _num(c.get("cwt")) and _num(c.get("head")) and c["head"] >= STEER_MIN_HEAD:
                rows.append((c["cwt"], c["head"], b.get("town") or "", b.get("state") or "", w))
                barns.add(b.get("id"))
    if len(barns) < STEER_MIN_BARNS:
        return None
    rows.sort(key=lambda r: (-r[0], -r[1], r[2]))
    cwt, head, town, st, w = rows[0]
    text = ("The best average price for No. 1 feeder steers weighing 500 to 599 pounds at any sale barn report we read "
            "this past week: $%.2f per hundredweight at %s, %s, on %s, for %s head. %d barns reported that class."
            % (cwt, town, STATE_NAMES.get(st, st), _md(w.isoformat()), _fmt_int(head), len(barns)))
    return _fact("ours-steer-top", "livestock", text, "USDA AMS Livestock Market News, auction reports", rel, w.isoformat())


ALL_YEAR = tuple(range(1, 13))
# name, category, function, the months it is on the schedule (rain_day and dry_spell live in daily_fact.py).
# A generator is only scheduled in the months its data can carry it, so a withheld day is rare and not a pattern.
GENERATORS = (
    ("ours-hail-big", "weather and climate", hail_big, tuple(range(5, 13))),   # 500 reports in by May
    ("ours-drought", "weather and climate", drought, ALL_YEAR),
    ("ours-wasde-corn", "markets and prices", wasde_corn, ALL_YEAR),
    ("ours-wasde-soy", "markets and prices", wasde_soy, ALL_YEAR),
    ("ours-land-top", "land and rent", land_top, ALL_YEAR),
    ("ours-rent-range", "land and rent", rent_range, ALL_YEAR),
    ("ours-harvest-us", "agronomy", harvest_us, (9, 10, 11)),                 # NASS harvest progress weeks
    ("ours-harvest-state", "agronomy", harvest_state, (9, 10, 11)),
    ("ours-china-soy", "global trade", china_soy, ALL_YEAR),
    ("ours-export-pace", "global trade", export_pace, ALL_YEAR),
    ("ours-steer-top", "livestock", steer_top, ALL_YEAR),
)


# ---------------------------------------------------------------- selftest on made-up files
def _w(root, rel, obj):
    p = os.path.join(root, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(obj, f)


def _selftest():
    bad = []

    def ok(c, m):
        if not c:
            bad.append(m)
            print("FAIL", m)

    root = tempfile.mkdtemp(prefix="dfo-")
    day = date(2026, 11, 3)
    # WASDE: 12 Novembers, 2014 has the biggest cut (3.0); one November with its October missing is not counted
    reps, years = [], {}
    for y in range(2010, 2022):
        reps += [["%d-10-10" % y, "x"], ["%d-11-09" % y, "x"]]
    reps.append(["2026-11-10", "x"])                 # after the day: never read
    for k, y in enumerate(range(2010, 2022)):
        my = "%d/%02d" % (y, (y + 1) % 100)
        a = 170.0
        b = {2014: 167.0, 2018: 172.5}.get(y, 170.5)
        years[my] = {"s": {"2": [[2 * k, a], [2 * k + 1, b]]}}
    years["2026/27"] = {"s": {"2": [[len(reps) - 1, 150.0]]}}
    _w(root, "data/wasde-history/corn.json", {"reports": reps, "series": [{"line": "Area Planted"}, {"line": "Area Harvested"},
                                                                         {"line": "Yield per Harvested Acre"}], "years": years})
    f = wasde_corn(day, root)
    ok(f and "November 2014" in f["text"] and "cut it 3 bushels an acre, to 167" in f["text"] and "since 2010" in f["text"]
       and "12 years with an October report before it" in f["text"], "WASDE: the biggest November yield change, hand-worked (%s)" % (f or {}).get("text"))
    ok(f and f["file"] == "data/wasde-history/corn.json" and f["category"] == "markets and prices", "WASDE names its file")
    ok(wasde_corn(date(2026, 11, 9), root) is None or "2014" in wasde_corn(date(2026, 11, 9), root)["text"], "WASDE no look-ahead")
    years2 = {k: v for k, v in years.items() if k < "2013"}
    _w(root, "data/wasde-history/soybeans.json", {"reports": reps, "series": [{"line": "x"}, {"line": "y"},
                                                                             {"line": "Yield per Harvested Acre"}], "years": years2})
    ok(wasde_soy(day, root) is None, "WASDE withheld under %d years" % WASDE_MIN_YEARS)
    # land: October sales in IL, 12 farmland sales of 40+ acres inside the usual range; the higher flagged one is skipped
    cols = ["id", "when", "recorded", "acres", "price", "ppa", "place", "kind", "flag"]
    s = [["a%d" % i, "2026-10-%02d" % (i + 1), 0, 80.0, 800000, 10000 + i * 100, "T", "f", 0] for i in range(12)]
    s += [["hi", "2026-10-20", 0, 80.0, 2000000, 25000, "T", "f", 1], ["bl", "2026-10-21", 0, 80.0, 2000000, 24000, "T", "b", 0],
          ["sm", "2026-10-22", 0, 20.0, 400000, 20000, "T", "f", 0], ["nov", "2026-11-01", 0, 80.0, 2000000, 23000, "T", "f", 0]]
    _w(root, "data/land-sales/il.json", {"fetched": "2026-11-02", "through": "2026-10-31", "source": "Illinois Department of Revenue"})
    _w(root, "data/land-sales/il/17001.json", {"cols": cols, "county": "Adams", "s": s})
    f = land_top(day, root)
    ok(f and "$11,100 an acre for 80 acres in Adams County" in f["text"] and "of 12 such sales" in f["text"]
       and "October" in f["text"], "land: top judged farmland sale, hand-worked (%s)" % (f or {}).get("text"))
    ok(land_top(date(2026, 11, 2), root) is None, "land: a file read on the day is not used")
    _w(root, "data/land-sales/il.json", {"fetched": "2026-11-02", "through": "2026-10-15"})
    ok(land_top(day, root) is None, "land: withheld when the month is not all in the file (and September is thin)")
    s += [["sep%d" % i, "2026-09-%02d" % (i + 1), 0, 50.0, 500000, 9000 + i, "T", "f", 0] for i in range(10)]
    _w(root, "data/land-sales/il/17001.json", {"cols": cols, "county": "Adams", "s": s})
    f = land_top(day, root)
    ok(f and "in September: $9,009 an acre for 50 acres" in f["text"], "land: falls back to the newest whole month (%s)" % (f or {}).get("text"))
    ok(land_top(date(2026, 12, 3), root) is None, "land: a month more than %d days old is not news" % LAND_MAX_AGE)
    # rent
    cs = [{"name": "C%d" % i, "rent": {"nonirr": {"2026": 200.0 + i, "2025": 1.0}}} for i in range(11)]
    _w(root, "data/cash-rent/IA.json", {"generated": "2026-10-06", "years": [2025, 2026], "counties": cs})
    f = rent_range(day, root)
    ok(f and "highest county was C10 at $210" in f["text"] and "lowest C0 at $200" in f["text"] and "gap of $10" in f["text"]
       and "11 counties" in f["text"], "rent: highest and lowest county (%s)" % (f or {}).get("text"))
    _w(root, "data/cash-rent/IA.json", {"generated": "2026-10-06", "years": [2026], "counties": cs[:5]})
    ok(rent_range(day, root) is None, "rent: withheld under %d counties" % RENT_MIN_COUNTIES)
    # hail: a lone 7-inch report is not said; the 5-inch pair is
    ev = [[40, -90, 1.0, "05-01", "KS"]] * 600 + [[40, -90, 7.0, "06-01", "NE"], [40, -90, 5.0, "06-02", "IA"],
                                                 [40, -90, 4.0, "06-02", "IA"], [40, -90, 9.0, "11-05", "TX"]]
    _w(root, "data/hail/events-2026.json", {"ev": ev})
    _w(root, "data/hail/manifest.json", {"generated": "2026-11-01"})
    f = hail_big(day, root)
    ok(f and "5 inches across, in Iowa on June 2" in f["text"] and "was 4 inches" in f["text"] and "603 hail reports this year through June 2." in f["text"],
       "hail: the biggest corroborated report (%s)" % (f or {}).get("text"))
    # drought
    _w(root, "data/drought/summary.json", {"valid": "2026-10-27", "fetched": "2026-10-30T19:00:00Z",
                                           "dates": ["2026-10-27", "2026-10-20", "2026-09-29", "2025-10-28"],
                                           "conus": [[72.7, 49.5, 26.7, 9.4, 1.6], [0] * 5, [0] * 5, [69.2, 43.6, 21, 4.2, 0.1]]})
    f = drought(day, root)
    ok(f and f["text"].startswith("50% of the Lower 48") and "up from 44%" in f["text"] and "27% was in severe" in f["text"],
       "drought: now and a year ago (%s)" % (f or {}).get("text"))
    ok(drought(date(2026, 11, 20), root) is None, "drought: stale is withheld")
    # crop progress
    st = {s_: {"corn_harvested": {"date": "2026-10-25", "pct": 60, "avg5": 60 + (i if s_ != "OH" else -12)}}
          for i, s_ in enumerate(["IA", "IL", "IN", "OH", "MN", "NE", "SD", "ND", "WI", "MO", "KS"])}
    _w(root, "data/crop-progress.json", {"in_season": True, "updated": "2026-10-28",
                                         "progress": {"corn_harvested": {"date": "2026-10-25", "pct": 60, "avg5": 66},
                                                      "soybeans_harvested": {"date": "2026-10-25", "pct": 79, "avg5": 77}},
                                         "states": st})
    f = harvest_us(day, root)
    ok(f and "US corn harvest was 60% done on October 25, 6 points behind the 5-year average of 66%" in f["text"],
       "harvest: the crop furthest from its average (%s)" % (f or {}).get("text"))
    f = harvest_state(day, root)
    ok(f and "Ohio corn, 60% harvested" in f["text"] and "12 points ahead" in f["text"], "harvest: the state furthest off (%s)" % (f or {}).get("text"))
    ok(harvest_us(date(2026, 10, 28), root) is None, "harvest: not before the file was read")
    # exports
    _w(root, "data/export-sales.json", {"updated": "2026-10-30",
                                        "soybeans": {"marketing_year": "2026/27", "report_date": "2026-10-22",
                                                     "cumulative_mt": 28777702, "prev_year_cumulative_mt": 15947886,
                                                     "china": {"commitments_mt": 15074187, "shipped_mt": 5978187,
                                                               "outstanding_mt": 9096000, "week_ending": "2026-10-22",
                                                               "marketing_year": "2026/27"}},
                                        "corn": {"marketing_year": "2026/27", "report_date": "2026-10-22",
                                                 "cumulative_mt": 110, "prev_year_cumulative_mt": 100}})
    f = china_soy(day, root)
    ok(f and "15.1 million metric tons" in f["text"] and "6.0 million shipped and 9.1 million still to ship" in f["text"],
       "exports: China soybeans add up (%s)" % (f or {}).get("text"))
    f = export_pace(day, root)
    ok(f and "US soybean export sales" in f["text"] and "80% more" in f["text"], "exports: pace vs a year ago (%s)" % (f or {}).get("text"))
    # steers: five barns, the top one wins; a 10-head lot is too thin
    barns = [{"id": "b%d" % i, "town": "T%d" % i, "state": "NE",
              "sales": [{"date": "2026-10-30", "classes": {"steers|1": {"500": {"cwt": 400.0 + i, "head": 30}}}}]} for i in range(5)]
    barns.append({"id": "x", "town": "Thin", "state": "IA",
                  "sales": [{"date": "2026-10-30", "classes": {"steers|1": {"500": {"cwt": 900.0, "head": 10}}}}]})
    _w(root, "data/cattle-auction.json", {"updated": "2026-10-31T07:00:00Z", "barns": barns})
    f = steer_top(day, root)
    ok(f and "$404.00 per hundredweight at T4, Nebraska, on October 30, for 30 head" in f["text"] and "5 barns" in f["text"],
       "steers: the top average, thin lots left out (%s)" % (f or {}).get("text"))
    # Nov 2 audit: "for 1782 head" printed with no comma
    barns.append({"id": "big", "town": "Big", "state": "KS",
                  "sales": [{"date": "2026-10-30", "classes": {"steers|1": {"500": {"cwt": 410.0, "head": 1782}}}}]})
    _w(root, "data/cattle-auction.json", {"updated": "2026-10-31T07:00:00Z", "barns": barns})
    f = steer_top(day, root)
    ok(f and "for 1,782 head" in f["text"], "steers: a head count over 999 takes a comma (%s)" % (f or {}).get("text"))
    # a missing file is None, never an error
    empty = tempfile.mkdtemp(prefix="dfo-empty-")
    for gid, cat, fn, _m in GENERATORS:
        try:
            ok(fn(day, empty) is None, "%s: no file, no fact" % gid)
        except Exception as ex:
            ok(False, "%s raised %s on a missing file" % (gid, type(ex).__name__))
    print("daily_fact_ours selftest " + ("FAILED" if bad else "ok"))
    return 1 if bad else 0


def main(argv):
    if "--selftest" in argv:
        return _selftest()
    d = date.fromisoformat(argv[argv.index("--date") + 1]) if "--date" in argv else date.today()
    for gid, cat, fn, _m in GENERATORS:
        try:
            f = fn(d, REPO)
        except Exception as ex:
            f = {"error": type(ex).__name__}
        print("%-20s %s" % (gid, json.dumps(f, ensure_ascii=False) if f else "withheld"))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
