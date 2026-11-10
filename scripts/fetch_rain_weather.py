#!/usr/bin/env python3
"""fetch_rain_weather.py: the other measured weather at each county rain page's station.

Run by .github/workflows/county-rain.yml after the rain fetch, best effort, with its own
time cap. Reads data/rain/<st>.json (the chosen rain station per county) and writes
data/rain/wx/<st>.json, one small file per state that the county page loads when a reader
opens its weather fold (components/rain-wx.js) and that build_county_rain.py reads for the
one baked line and the two FAQ answers. Subfolders, so the data/rain/*.json globs never
see them.

WHAT IS MEASURED (NOAA daily highs and lows through RCC-ACIS; nothing modeled, nothing filled)
  * Corn growing degree days from May 1 (county_rain.corn_gdd: base 50 F, cap 86 F), against
    the station's own 1991 to 2020 average for the same reported days, with the years counted.
  * The hottest and coldest day of the year so far, days at 90 F or above, days at 32 F or
    below since Jul 1.
  * The last spring freeze and the first fall freeze (32 F and 28 F) against the station's
    own usual date (the middle year of 1991 to 2020).
  * Of note: the warmest or coldest day of this month or last month since a year, ranked
    against the station's own record (NOTE RULE below).

WHICH STATION
  The rain station itself when it keeps highs and lows (at least 90% of the days reported
  and current within 10 days, the rain rules). A volunteer rain gauge keeps none: then the
  station in the same county with the most days of highs and lows, nearest the rain gauge,
  never a mountain snow site. The page names it and its distance from the rain gauge.

MISSING DAYS (honest-numbers rules)
  Each figure counts its own missing days. A figure whose window has more than 5% of its
  days missing is withheld ("not enough days reported"). GDD and its normal are summed over
  the same reported days, so a missing day counts on neither side. No day is ever filled
  from another station.

NOTE RULE ("the warmest October day since 2011")
  For this month and last month (not February), this year's highest high H (lowest low L)
  is held against the station's own record: each past year's highest high in that month,
  ACIS MultiStnData interval [1,0,0], duration mtd, reduce max, at most 1 day missing
  (more and the year is "M"). The latest past year at or above H is Y. Printed only when
  the record has 20 or more full months, no year between Y and now is "M", and Y is 10 or
  more years back. No year at or above H: "the warmest in N years of record", only when
  no year after the first full one is "M". Coldest the same way with lows.

NORMALS CACHE (data/rain/wxnorm/<st>.json, not loaded by readers)
  Daily highs and lows 1991-2020 for a station never change, so they are read once per
  station (MultiStnData, a few stations a call) and kept as a summary: the mean corn GDD
  for each day May 1 to Dec 31 with its count of years, and the usual freeze dates. A run
  fills what it can inside its time cap; the rest waits for the next day's run. Until a
  station is in the cache its page prints no normal and no usual date.

ACIS cannot be reached from the sandbox this was built in. The calls follow the shapes
fetch_county_rain.py and fetch_rain_context.py already make (the record call is the same
interval/duration/reduce/maxmissing form as the context's year-to-date sums); the saved
answers in test/fixtures/rain-wx/ are MADE UP for the tests.

  python3 scripts/fetch_rain_weather.py              every state in data/rain
  python3 scripts/fetch_rain_weather.py --states IA  some states
  python3 scripts/fetch_rain_weather.py --selftest   offline, on the saved answers
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import datetime as dt
import glob
import json
import os
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import county_rain as R  # noqa: E402

ROOT = R.ROOT
RAIN = os.path.join(ROOT, "data", "rain")
OUT = os.path.join(RAIN, "wx")
NORM_DIR = os.path.join(RAIN, "wxnorm")
SCHEMA = "agsist-rain-wx/1"
NORM_SCHEMA = "agsist-rain-wxnorm/2"   # /2 (Nov 4): adds "e", the Jan 1 to Apr 30 GDD normal for the 30-day figure; a /1 cache is read again
URL = "https://data.rcc-acis.org/MultiStnData"
UA = "agsist.com county rain (https://agsist.com/rain; daily)"
TIMEOUT_S = 180
BACKOFF_S = (15, 45)
MAX_MINUTES = 12           # the whole step; the normals fill stops first, at FILL_MINUTES
FILL_MINUTES = 7
FILL_CHUNK = 12            # stations per normals call (12 x 30 years x 2 values: about 1.5 MB)

MISS_MAX = 0.05            # more than this share of a figure's days missing: withheld
TEMP_MIN_SHARE = R.MIN_SHARE
STALE_DAYS = R.STALE_DAYS
REACH_SLACK = 15           # fetch_county_rain.REACH_SLACK
NORM_Y0, NORM_Y1 = 1991, 2020
MIN_YEARS = 20             # fewer years than this: no normal, no usual date, no rank
GDD_FROM = (5, 1)          # May 1
HOT_F = 90
FREEZES = (32, 28)
FIRST_YEAR = 1850          # ACIS answers "M" for years before a station began
NOTE_MIN_SPAN = 10
NOTE_MAXMISSING = 1
WITHHELD = "m"             # a figure withheld for missing days, in the written file
RECENT_DAYS = 30           # the home card's last-30-days GDD figure ("g30")
GDD30_PCT_MIN = 50         # under this many GDDs of normal a 30-day percent is too jumpy to print (winter)

# a 365-day calendar for the normals: Feb 29 has no day of its own
_REF = 2021


def doy(md):
    """(month, day) -> day of a 365-day year, 1-based; Feb 29 -> Feb 28."""
    m, d = md
    if m == 2 and d == 29:
        d = 28
    return (dt.date(_REF, m, d) - dt.date(_REF, 1, 1)).days + 1


def md_of(n):
    d = dt.date(_REF, 1, 1) + dt.timedelta(days=n - 1)
    return d.month * 100 + d.day


GDD_DOY0 = doy(GDD_FROM)               # 121
GDD_DAYS = 365 - GDD_DOY0 + 1          # May 1 to Dec 31: 245


def mmdd(iso):
    return int(iso[5:7]) * 100 + int(iso[8:10])


def temp(v):
    """An ACIS daily high or low -> float F, or None (M, blank, a flag, out of range)."""
    if v in (None, "M", "", "T", "S"):
        return None
    try:
        x = float(str(v).rstrip("A"))
    except ValueError:
        return None
    return x if -80 <= x <= 135 else None


# ---------------------------------------------------------------- talking to ACIS

CALL_MARGIN_S = 30          # a call never runs past its window's end by more than this
CALL_MIN_S = 20             # nor starts with less than this left


class Net:
    def __init__(self, deadline):
        self.deadline = deadline
        self.limit = None       # set during the normals fill: that window's end (fill_until)
        self.calls = 0

    def budget(self):
        """Seconds this call may take: TIMEOUT_S, cut to the fill window's end plus CALL_MARGIN_S and to
        the run's deadline. Raises TimeoutError when too little is left to start a call."""
        now = time.time()
        ends = [self.deadline] + ([self.limit + CALL_MARGIN_S] if self.limit else [])
        left = min(ends) - now
        if left < CALL_MIN_S:
            raise TimeoutError("time cap reached")
        return min(TIMEOUT_S, left)

    def call(self, params):
        params = {k: v for k, v in params.items() if not k.startswith("_")}
        body = urllib.parse.urlencode({"params": json.dumps(params, separators=(",", ":"))}).encode()
        err = None
        for attempt in range(len(BACKOFF_S) + 1):
            t = self.budget()
            try:
                self.calls += 1
                req = urllib.request.Request(URL, data=body, headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=t) as r:
                    return json.loads(r.read().decode("utf-8"))
            except Exception as e:  # noqa: BLE001
                err = e
                if attempt < len(BACKOFF_S):
                    if self.budget() < BACKOFF_S[attempt] + CALL_MIN_S:
                        raise TimeoutError("time cap reached") from e
                    print(f"  ACIS: {e}; retrying in {BACKOFF_S[attempt]}s", flush=True)
                    time.sleep(BACKOFF_S[attempt])
        raise RuntimeError(f"ACIS failed after retries: {err}")


class Saved:
    """Saved answers (test/fixtures/rain-wx): year-<st>.json (the state's highs and lows this
    year), norm-<st>.json (1991-2020 daily rows, every station; cut to the asked sids here),
    rec-<st>-<MM>.json (the month record, every station; cut to the asked sids)."""

    def __init__(self, d):
        self.d = d
        self.calls = 0

    def call(self, params):
        self.calls += 1
        st = params.get("_st", params.get("state", "")).lower()
        kind = params.get("_kind")
        p = os.path.join(self.d, {"year": f"year-{st}.json", "norm": f"norm-{st}.json",
                                  "rec": f"rec-{st}-{params.get('_mm', '')}.json"}[kind])
        if not os.path.exists(p):
            return {"error": "no saved answer"}
        j = json.load(open(p, encoding="utf-8"))
        for s in j.get("data", []):
            if "rep" in s:                      # test-only shorthand: [[rows, times], ...]
                s["data"] = [r for rows, k in s.pop("rep") for _ in range(k) for r in rows]
        if "sids" in params:
            want = set(params["sids"].split(","))
            j = {"data": [s for s in j.get("data", []) if want & set((s.get("meta") or {}).get("sids") or [])]}
        if kind == "year":
            n = (dt.date.fromisoformat(params["edate"]) - dt.date.fromisoformat(params["sdate"])).days + 1
            j = {"data": [{"meta": s["meta"], "data": s["data"][:n]} for s in j.get("data", [])]}
        return j


def ask_year(src, st, year, edate):
    j = src.call({"_kind": "year", "state": st, "sdate": f"{year}-01-01", "edate": edate,
                  "elems": [{"name": "maxt", "interval": "dly"}, {"name": "mint", "interval": "dly"}],
                  "meta": "name,state,sids,ll,county,elev"})
    if "error" in j or not isinstance(j.get("data"), list):
        raise RuntimeError(f"{st}: highs and lows refused ({j.get('error')})")
    return j["data"]


def ask_norm(src, st, sids):
    j = src.call({"_kind": "norm", "_st": st, "sids": ",".join(sids), "sdate": f"{NORM_Y0}-01-01",
                  "edate": f"{NORM_Y1}-12-31", "meta": "sids",
                  "elems": [{"name": "maxt", "interval": "dly"}, {"name": "mint", "interval": "dly"}]})
    if "error" in j or not isinstance(j.get("data"), list):
        raise RuntimeError(f"{st}: 1991-2020 highs and lows refused ({j.get('error')})")
    return j["data"]


def month_end(year, m):
    return (dt.date(year + (m == 12), m % 12 + 1, 1) - dt.timedelta(days=1)).isoformat()


def ask_record(src, st, sids, year, m):
    """Each year's highest high and lowest low in month m, FIRST_YEAR to last year."""
    end = month_end(year - 1, m)
    j = src.call({"_kind": "rec", "_st": st, "_mm": f"{m:02d}", "sids": ",".join(sids),
                  "sdate": f"{FIRST_YEAR}{end[4:]}", "edate": end, "meta": "sids",
                  "elems": [{"name": "maxt", "interval": [1, 0, 0], "duration": "mtd", "reduce": "max", "maxmissing": NOTE_MAXMISSING},
                            {"name": "mint", "interval": [1, 0, 0], "duration": "mtd", "reduce": "min", "maxmissing": NOTE_MAXMISSING}]})
    if "error" in j or not isinstance(j.get("data"), list):
        print(f"  {st}: the {R.MONTHS_LONG[m - 1]} record refused ({j.get('error')})", flush=True)
        return {}
    out = {}
    for s in j["data"]:
        rows = [r if isinstance(r, list) else [r] for r in (s.get("data") or [])]
        for sid in (s.get("meta") or {}).get("sids") or []:
            out[sid] = rows
    return out


# ---------------------------------------------------------------- the station

def temp_station(c, rows, C, fips, n):
    """(row, as_of index, miles from the rain gauge) for a county, or None. rows: ACIS state rows."""
    rain_sid = c["station"]["sid"]
    rlon, rlat = c["station"]["ll"]
    cands = []
    for s in rows:
        meta = s.get("meta") or {}
        sids = meta.get("sids") or []
        if str(meta.get("county") or "") != fips and rain_sid not in sids:
            continue
        if not meta.get("ll"):
            continue
        same = rain_sid in sids
        if not same and R.snow_site(sids):
            continue
        data = [r if isinstance(r, list) else [r] for r in (s.get("data") or [])][:n]
        hi = [temp(r[0]) if r else None for r in data]
        lo = [temp(r[1]) if len(r) > 1 else None for r in data]
        last = max((i for i in range(len(hi)) if hi[i] is not None or lo[i] is not None), default=-1)
        if last < 0 or n - 1 - last > STALE_DAYS:
            continue
        k = last + 1
        rh, rl = sum(v is not None for v in hi[:k]), sum(v is not None for v in lo[:k])
        if min(rh, rl) < TEMP_MIN_SHARE * k:
            continue
        lon, lat = meta["ll"]
        cc = C.get(fips) or {}
        if not same and cc.get("reach") and R.miles(cc["lat"], cc["lon"], lat, lon) > cc["reach"] + REACH_SLACK:
            continue
        mi = 0.0 if same else R.miles(rlat, rlon, lat, lon)
        cands.append(((0 if same else 1, -min(rh, rl), mi), meta, hi[:k], lo[:k], mi))
    if not cands:
        return None
    cands.sort(key=lambda x: x[0])
    _, meta, hi, lo, mi = cands[0]
    return meta, hi, lo, mi


# ---------------------------------------------------------------- this year's figures

def withheld(miss, days):
    return days <= 0 or miss > MISS_MAX * days


def extreme(vals, dates, pick):
    """[value, MMDD, other days at that value] for the max (pick=max) or min, or None."""
    have = [(v, d) for v, d in zip(vals, dates) if v is not None]
    if not have:
        return None
    best = pick(v for v, _ in have)
    days = [d for v, d in have if v == best]
    return [int(round(best)), mmdd(days[0]), len(days) - 1]


def last_spring(lo, dates, t):
    """Last day Jan 1 to Jun 30 at or below t: MMDD, 0 for none, WITHHELD when Mar 1 to Jun 30
    misses more than 5% of its days. Needs the dates through Jun 30."""
    if dates[-1][5:] < "06-30":
        return None
    win = [(v, d) for v, d in zip(lo, dates) if "03-01" <= d[5:] <= "06-30"]
    if withheld(sum(v is None for v, _ in win), len(win)):
        return WITHHELD
    hit = [d for v, d in zip(lo, dates) if d[5:] <= "06-30" and v is not None and v <= t]
    return mmdd(hit[-1]) if hit else 0


def first_fall(lo, dates, t):
    """First day from Jul 1 at or below t: MMDD; 0 for none yet through the last day;
    WITHHELD when Jul 1 to that day (or to the last day) misses more than 5% of its days."""
    win = [(v, d) for v, d in zip(lo, dates) if d[5:] >= "07-01"]
    if not win:
        return None
    k = next((i for i, (v, _) in enumerate(win) if v is not None and v <= t), None)
    span = win[:k + 1] if k is not None else win
    if withheld(sum(v is None for v, _ in span), len(span)):
        return WITHHELD
    return mmdd(win[k][1]) if k is not None else 0


def gdd_year(hi, lo, dates):
    """(total, reported days, missing days, [day-of-year of each reported day]) from May 1."""
    tot, rep, miss = 0.0, [], 0
    for h, l, d in zip(hi, lo, dates):
        if (int(d[5:7]), int(d[8:10])) < GDD_FROM:
            continue
        if h is None or l is None:
            miss += 1
            continue
        tot += R.corn_gdd(h, l)
        rep.append(doy((int(d[5:7]), int(d[8:10]))))
    return tot, rep, miss


def county_row(meta, hi, lo, mi, year, same, norm, recs):
    """One county's row for data/rain/wx/<st>.json (see FORMAT)."""
    n = len(hi)
    dates = R.days_of(year, f"{year}-01-01", n)
    asof = dates[-1]
    mh, ml = sum(v is None for v in hi), sum(v is None for v in lo)
    row = {"a": mmdd(asof)}
    if not same:
        row["s"] = [R.station_where(meta.get("name", "")), meta["sids"][0], round(mi)]
    # GDD from May 1
    if (int(asof[5:7]), int(asof[8:10])) >= GDD_FROM:
        tot, rep, miss = gdd_year(hi, lo, dates)
        days = len(rep) + miss
        if withheld(miss, days):
            row["g"] = WITHHELD
        else:
            g = [int(round(tot)), miss]
            ng = (norm or {}).get("g")
            if ng:
                means, counts = ng["m"], unrle(ng["c"])
                ny = min(counts[k - GDD_DOY0] for k in rep) if rep else 0
                if ny >= MIN_YEARS:
                    nv = sum(means[k - GDD_DOY0] for k in rep) / 10.0
                    if nv > 0:
                        g += [int(round(nv)), ny, int(round(100 * tot / nv))]
            row["g"] = g
    g30 = gdd_recent(hi, lo, dates, norm)
    if g30 is not None:
        row["g30"] = g30
    row["gm"] = gdd_months(hi, lo, dates, norm)
    row["mh"], row["ml"], row["n"] = mh, ml, n
    row["h"] = WITHHELD if withheld(mh, n) else extreme(hi, dates, max)
    row["l"] = WITHHELD if withheld(ml, n) else extreme(lo, dates, min)
    row["d9"] = WITHHELD if withheld(mh, n) else sum(1 for v in hi if v is not None and v >= HOT_F)
    if asof[5:] >= "07-01":
        fall = [(v, d) for v, d in zip(lo, dates) if d[5:] >= "07-01"]
        fm = sum(v is None for v, _ in fall)
        row["d3"] = WITHHELD if withheld(fm, len(fall)) else sum(1 for v, _ in fall if v is not None and v <= FREEZES[0])
    # freezes: [this year, usual, years counted] per kind; this year's spring only once Jun 30 is in
    fr = {}
    us = (norm or {}).get("f") or {}
    for t in FREEZES:
        for kind, fn in (("s", last_spring), ("f", first_fall)):
            v = fn(lo, dates, t)
            if v is None:
                continue
            u = us.get(f"{kind}{t}")
            fr[f"{kind}{t}"] = [v] + (u if u else [])
    if fr:
        row["fr"] = fr
    notes = []
    for m, rec in recs:
        for kind, vals in (("h", hi), ("l", lo)):
            x = month_note(kind, m, vals, dates, year, rec)
            if x:
                notes.append(x)
    if notes:
        # the longest look back first, at most two
        notes.sort(key=lambda x: -(year - x[4] if x[4] else 1000 + x[5]))
        row["nt"] = notes[:2]
    return row


def month_note(kind, m, vals, dates, year, rec):
    """[kind, month, F, MMDD, since year or 0, years of record] or None. See NOTE RULE."""
    if m == 2 or not rec:
        return None
    pick = max if kind == "h" else min
    days = [(v, d) for v, d in zip(vals, dates) if int(d[5:7]) == m and v is not None]
    if not days:
        return None
    this = pick(v for v, _ in days)
    on = next(d for v, d in days if v == this)
    col = 0 if kind == "h" else 1
    hist = []
    for i, r in enumerate(rec):
        y = FIRST_YEAR + i
        if y >= year:
            break
        hist.append((y, temp(r[col]) if len(r) > col else None))
    full = [(y, v) for y, v in hist if v is not None]
    if len(full) < MIN_YEARS:
        return None
    first = full[0][0]
    beat = (lambda v: v >= this) if kind == "h" else (lambda v: v <= this)
    since = next((y for y, v in reversed(full) if beat(v)), None)
    if since is not None:
        if any(v is None for y, v in hist if since < y < year):
            return None
        if year - since < NOTE_MIN_SPAN:
            return None
        return [kind, m, int(round(this)), mmdd(on), since, len(full) + 1]
    if any(v is None for y, v in hist if y > first):
        return None
    return [kind, m, int(round(this)), mmdd(on), 0, len(full) + 1]


# ---------------------------------------------------------------- the normals cache

def rle(xs):
    out = []
    for x in xs:
        if out and out[-1][0] == x:
            out[-1][1] += 1
        else:
            out.append([x, 1])
    return out


def unrle(r):
    return [v for v, k in r for _ in range(k)]


def norm_day(norm, k):
    """(mean corn GDD x10, years counted) on day-of-year k from a station's cache entry, or None."""
    key, i = ("g", k - GDD_DOY0) if k >= GDD_DOY0 else ("e", k - 1)
    ng = (norm or {}).get(key)
    if not ng:
        return None
    c = unrle(ng["c"])
    return (ng["m"][i], c[i]) if 0 <= i < len(c) else None


def gdd_recent(hi, lo, dates, norm, days=RECENT_DAYS):
    """The last `days` days ending on the last day: [total, missing] plus [normal, years, percent or None]
    when every reported day has a normal of MIN_YEARS or more years, the normal summed over the same
    reported days (a missing day counts on neither side). WITHHELD over 5% missing; None under `days` days."""
    if len(hi) < days:
        return None
    tot, rep, miss = 0.0, [], 0
    for h, l, d in zip(hi[-days:], lo[-days:], dates[len(hi) - days:len(hi)]):
        if h is None or l is None:
            miss += 1
            continue
        tot += R.corn_gdd(h, l)
        rep.append(doy((int(d[5:7]), int(d[8:10]))))
    if withheld(miss, days):
        return WITHHELD
    g = [int(round(tot)), miss]
    nd = [norm_day(norm, k) for k in rep]
    if rep and all(nd):
        ny = min(c for _, c in nd)
        if ny >= MIN_YEARS:
            nv = sum(m for m, _ in nd) / 10.0
            g += [int(round(nv)), ny, int(round(100 * tot / nv)) if nv >= GDD30_PCT_MIN else None]
    return g


def gdd_months(hi, lo, dates, norm):
    """Corn GDDs by calendar month, Jan to the as-of month ("gm", the home card's GDDs by month chart, drawn
    like the county page's rain by month): one entry a month, [total, normal or None, days reported, days so
    far], the same daily 86/50 GDD as "g" and the normal summed over the same reported days from the station's
    own 1991 to 2020 cache (norm_day, as "g30": a missing day counts on neither side). The normal is None when
    the cache lacks a reported day or has under MIN_YEARS years for one. A month with more than 5% of its days
    so far missing is None (withheld, the rule of "g"); nothing is filled."""
    out = []
    for m in range(1, int(dates[-1][5:7]) + 1 if dates else 1):
        tot, rep, miss = 0.0, [], 0
        for h, l, d in zip(hi, lo, dates):
            if int(d[5:7]) != m:
                continue
            if h is None or l is None:
                miss += 1
                continue
            tot += R.corn_gdd(h, l)
            rep.append(doy((int(d[5:7]), int(d[8:10]))))
        days = len(rep) + miss
        if withheld(miss, days):
            out.append(None)
            continue
        nd = [norm_day(norm, k) for k in rep]
        nv = None
        if rep and all(nd) and min(c for _, c in nd) >= MIN_YEARS:
            nv = int(round(sum(x for x, _ in nd) / 10.0))
        out.append([int(round(tot)), nv, len(rep), days])
    return out


def carry_season(prev, res):
    """Last season's corn GDDs ("gp") for a row with no season of its own yet (Jan 1 to Apr 30 of a new
    year): from the published file of last year (its "g", with its as-of day and station), or carried on
    from a published file of this year that already has it. Read, never computed again (Nov 4:
 off-season the card still shows the last full season)."""
    if not isinstance(prev, dict) or not isinstance(prev.get("counties"), dict):
        return
    py, y = prev.get("year"), res.get("year")
    for f, row in res.get("counties", {}).items():
        if "g" in row:
            continue
        p = prev["counties"].get(f) or {}
        if py == y - 1 and p.get("g") not in (None, ""):
            gp = {"y": py, "a": p["a"], "g": p["g"]}
            if p.get("s"):
                gp["s"] = p["s"]
            row["gp"] = gp
        elif py == y and p.get("gp"):
            row["gp"] = p["gp"]


def median_date(xs, none_val):
    """Middle of the years' dates (day of year), none_val for a year with none. Returns
    MMDD, 0 when the middle year has none, or None when the middle falls between a date and none."""
    xs = sorted(xs)
    n = len(xs)
    a, b = xs[(n - 1) // 2], xs[n // 2]
    if a == none_val and b == none_val:
        return 0
    if none_val in (a, b):
        return None
    return md_of(int(round((a + b) / 2)))


def norm_summary(rows):
    """One station's 1991-2020 daily rows ([maxt, mint] from Jan 1 1991) -> the cache entry:
    g: {m: mean corn GDD x10 for each day May 1 to Dec 31, c: years counted per day (run-length)};
    f: {s32: [usual MMDD or 0, years], ...} only where 20 or more years count."""
    gs, gc = [0.0] * 365, [0] * 365
    years = {}
    d0 = dt.date(NORM_Y0, 1, 1)
    for i, r in enumerate(rows):
        d = d0 + dt.timedelta(days=i)
        if d.year > NORM_Y1:
            break
        r = r if isinstance(r, list) else [r]
        h = temp(r[0]) if r else None
        l = temp(r[1]) if len(r) > 1 else None
        years.setdefault(d.year, []).append((d, l))
        k = doy((d.month, d.day))
        if h is not None and l is not None and not (d.month == 2 and d.day == 29):
            gs[k - 1] += R.corn_gdd(h, l)
            gc[k - 1] += 1
    out = {}
    # g: May 1 to Dec 31 (the season); e: Jan 1 to Apr 30 (only the 30-day figure reads it)
    for key, a, b in (("g", GDD_DOY0 - 1, 365), ("e", 0, GDD_DOY0 - 1)):
        if min(gc[a:b]) >= MIN_YEARS:
            out[key] = {"m": [int(round(10 * s / c)) for s, c in zip(gs[a:b], gc[a:b])], "c": rle(gc[a:b])}
    f = {}
    for t in FREEZES:
        sp, fa = [], []
        for y, days in years.items():
            win = [l for d, l in days if (3, 1) <= (d.month, d.day) <= (6, 30)]
            if len(win) >= 120 and not withheld(sum(l is None for l in win), len(win)):
                hit = [doy((d.month, d.day)) for d, l in days if (d.month, d.day) <= (6, 30) and l is not None and l <= t]
                sp.append(hit[-1] if hit else -1)
            win = [(d, l) for d, l in days if d.month >= 7]
            if len(win) >= 180:
                k = next((i for i, (d, l) in enumerate(win) if l is not None and l <= t), None)
                span = win[:k + 1] if k is not None else win
                if not withheld(sum(l is None for _, l in span), len(span)):
                    fa.append(doy((win[k][0].month, win[k][0].day)) if k is not None else 999)
        for kind, xs, nv in (("s", sp, -1), ("f", fa, 999)):
            if len(xs) >= MIN_YEARS:
                u = median_date(xs, nv)
                if u is not None:
                    f[f"{kind}{t}"] = [u, len(xs)]
    if f:
        out["f"] = f
    return out


def load_norms(st, d=NORM_DIR):
    p = os.path.join(d, st.lower() + ".json")
    try:
        j = json.load(open(p, encoding="utf-8"))
        return j.get("stations", {}) if j.get("schema") == NORM_SCHEMA else {}
    except (OSError, ValueError):
        return {}


def write_json(path, obj, **kw):
    """Whole or not at all: a temp file beside it, then os.replace (a cut-off run never leaves half a file)."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, separators=(",", ":"), **kw)
    os.replace(tmp, path)


def save_norms(st, stations, d=NORM_DIR):
    write_json(os.path.join(d, st.lower() + ".json"),
               {"schema": NORM_SCHEMA, "state": st, "years": [NORM_Y0, NORM_Y1],
                "source": "NOAA daily highs and lows through RCC-ACIS, 1991-2020", "stations": stations}, sort_keys=True)


# ---------------------------------------------------------------- one state

def build_state(src, d, C, norms, fill_until):
    """(the wx file, how many stations the normals fill added)."""
    st, year, edate = d["state"], int(d["year"]), d["edate"]
    n = (dt.date.fromisoformat(edate) - dt.date(year, 1, 1)).days + 1
    rows = ask_year(src, st, year, edate)
    picked = {}
    for fips, c in sorted(d["counties"].items()):
        got = temp_station(c, rows, C, fips, n)
        if got:
            picked[fips] = got
    # the normals each picked station still needs
    need = sorted({p[0]["sids"][0] for p in picked.values()} - set(norms))
    added = 0
    for i in range(0, len(need), FILL_CHUNK):
        if time.time() > fill_until:
            print(f"  {st}: normals fill paused, {len(need) - i} stations wait for the next run", flush=True)
            break
        part = need[i:i + FILL_CHUNK]
        src.limit = fill_until                  # Net: this call ends by fill_until + CALL_MARGIN_S
        try:
            ans = ask_norm(src, st, part)
        except (RuntimeError, TimeoutError) as e:
            print(f"  {st}: normals not read ({e})", flush=True)
            break
        finally:
            src.limit = None
        for s in ans:
            sids = (s.get("meta") or {}).get("sids") or []
            sid = next((x for x in part if x in sids), None)
            if sid:
                norms[sid] = norm_summary(s.get("data") or [])
                added += 1
        for sid in part:
            norms.setdefault(sid, {})          # asked and nothing came back: not asked again every day
    # the month record: this month and last month of the state's last day
    sids = sorted({p[0]["sids"][0] for p in picked.values()})
    em = int(edate[5:7])
    months = [m for m in ([em - 1] if em > 1 else []) + [em] if m != 2]
    rec = {m: (ask_record(src, st, sids, year, m) if sids else {}) for m in months}
    out = {}
    for fips, (meta, hi, lo, mi) in sorted(picked.items()):
        sid = meta["sids"][0]
        same = d["counties"][fips]["station"]["sid"] in (meta.get("sids") or [])
        recs = [(m, rec[m].get(sid)) for m in months if rec[m].get(sid)]
        out[fips] = county_row(meta, hi, lo, mi, year, same, norms.get(sid), recs)
    return {"schema": SCHEMA, "state": st, "year": year, "edate": edate, "fetched": d["fetched"],
            "normals": f"{NORM_Y0}-{NORM_Y1}", "counties": out}, added


def written_at(out, st):
    """The fetch time of a state's published weather file, "" when it has none or it cannot be read."""
    try:
        return str(json.load(open(os.path.join(out, st.lower() + ".json"), encoding="utf-8")).get("fetched") or "")
    except (OSError, ValueError, AttributeError):
        return ""


def state_order(sts, out, day):
    """The order to read states in: the stalest published weather first (none at all first of all), so a
    run that hits its time cap leaves different states for the next run; ties start at a place that
    moves with the day of the year (day), so no state is always last."""
    n = len(sts) or 1
    k = {st: i for i, st in enumerate(sorted(sts))}
    return sorted(sts, key=lambda st: (written_at(out, st), (k[st] - day) % n))


def run(src, states=None, rain=RAIN, out=OUT, norm_dir=NORM_DIR, fill_minutes=FILL_MINUTES, deadline=None, day=None):
    os.makedirs(out, exist_ok=True)
    C = R.counties()
    fill_until = time.time() + fill_minutes * 60
    deadline = deadline if deadline is not None else getattr(src, "deadline", None)
    day = day if day is not None else dt.date.today().timetuple().tm_yday
    files = {}
    for p in sorted(glob.glob(os.path.join(rain, "*.json"))):
        try:
            d = json.load(open(p, encoding="utf-8"))
        except (OSError, ValueError) as e:
            print(f"  {os.path.basename(p)}: unreadable ({e})", flush=True)
            continue
        st = d.get("state")
        if st and (not states or st in states) and d.get("counties"):
            files[st] = d
    done, skipped = [], []
    for st in state_order(list(files), out, day):
        d = files[st]
        if deadline is not None and time.time() > deadline - CALL_MIN_S:
            skipped.append(st)
            continue
        norms = load_norms(st, norm_dir)
        before = len(norms)
        try:
            res, added = build_state(src, d, C, norms, fill_until)
        except (RuntimeError, TimeoutError, KeyError, ValueError) as e:
            print(f"  {st}: kept the published weather ({e})", flush=True)
            skipped.append(st)
            continue
        if len(norms) != before:
            save_norms(st, norms, norm_dir)
        try:
            prev = json.load(open(os.path.join(out, st.lower() + ".json"), encoding="utf-8"))
        except (OSError, ValueError):
            prev = None
        carry_season(prev, res)
        bad_rows = problems(res)
        if bad_rows or not res["counties"]:
            print(f"  {st}: kept the published weather ({'; '.join(bad_rows[:3]) or 'nothing came back'})", flush=True)
            skipped.append(st)
            continue
        write_json(os.path.join(out, st.lower() + ".json"), res)
        g = sum(1 for c in res["counties"].values() if isinstance(c.get("g"), list) and len(c["g"]) > 2)
        print(f"  {st}: weather for {len(res['counties'])} of {len(d['counties'])} counties, GDD normal for {g}; "
              f"normals cache +{added}", flush=True)
        done.append(st)
    if skipped:
        print(f"::warning::rain weather: {len(done)} of {len(files)} states updated, skipped: {','.join(sorted(skipped))}", flush=True)
    print(f"RAIN-WX updated={len(done)} stale={len(skipped)}", flush=True)
    return done, skipped


# ---------------------------------------------------------------- checking

def _is_date(v):
    return isinstance(v, int) and 101 <= v <= 1231 and 1 <= v % 100 <= 31


def problems(res):
    """Every figure in a written file carries its date or its window (the as-of day), and
    nothing is out of range."""
    bad = []
    for f, c in res.get("counties", {}).items():
        w = f
        if not _is_date(c.get("a")):
            bad.append(f"{w}: no as-of day")
            continue
        for k in ("h", "l"):
            v = c.get(k)
            if v not in (None, WITHHELD) and not (isinstance(v, list) and len(v) == 3 and _is_date(v[1]) and -80 <= v[0] <= 135):
                bad.append(f"{w}: {k} {v}")
        g = c.get("g")
        if g not in (None, WITHHELD) and not (isinstance(g, list) and len(g) in (2, 5) and 0 <= g[0] < 9000):
            bad.append(f"{w}: gdd {g}")
        g3 = c.get("g30")
        if g3 not in (None, WITHHELD) and not (isinstance(g3, list) and len(g3) in (2, 5) and 0 <= g3[0] <= 36 * RECENT_DAYS):
            bad.append(f"{w}: gdd 30 days {g3}")
        gm = c.get("gm")
        if gm is not None and not (isinstance(gm, list) and 1 <= len(gm) <= 12 and len(gm) == c["a"] // 100 and all(
                x is None or (isinstance(x, list) and len(x) == 4 and isinstance(x[0], int) and 0 <= x[0] <= 36 * 31
                              and (x[1] is None or (isinstance(x[1], int) and 0 <= x[1] <= 36 * 31))
                              and isinstance(x[2], int) and isinstance(x[3], int) and 0 <= x[2] <= x[3] <= 31
                              and (i + 1 < len(gm) or x[3] == c["a"] % 100)) for i, x in enumerate(gm))):
            bad.append(f"{w}: gdd by month {gm}")
        gp = c.get("gp")
        if gp is not None and not (isinstance(gp, dict) and isinstance(gp.get("y"), int) and _is_date(gp.get("a"))
                                   and (gp.get("g") == WITHHELD or (isinstance(gp.get("g"), list) and len(gp["g"]) in (2, 5)))):
            bad.append(f"{w}: last season {gp}")
        for k, v in (c.get("fr") or {}).items():
            if not (isinstance(v, list) and (v[0] == WITHHELD or v[0] == 0 or _is_date(v[0]))):
                bad.append(f"{w}: freeze {k} {v}")
        for x in c.get("nt") or []:
            if not (len(x) == 6 and _is_date(x[3]) and x[5] >= MIN_YEARS + 1):
                bad.append(f"{w}: note {x}")
    return bad


# ---------------------------------------------------------------- selftest

def selftest():
    import tempfile
    fails = []

    def ok(c, m):
        if not c:
            fails.append(m)
    # the one corn GDD (86/50), on known values
    for (h, l), want in (((90, 60), 23.0), ((45, 30), 0.0), ((70, 40), 10.0), ((95, 72), 29.0), ((86, 50), 18.0), ((100, 90), 36.0)):
        ok(R.corn_gdd(h, l) == want, f"corn_gdd({h}, {l}) = {R.corn_gdd(h, l)}, want {want}")
    ok(temp("M") is None and temp("85") == 85.0 and temp("-12") == -12.0 and temp("999") is None, "temp parse")
    ok(doy((5, 1)) == 121 and doy((2, 29)) == 59 and md_of(121) == 501 and GDD_DAYS == 245, "calendar")
    ok(median_date([100, 110, 120], 999) == md_of(110) and median_date([100, 999, 999], 999) == 0
       and median_date([100, 999], 999) is None, "median of freeze dates")
    ok(unrle(rle([30, 30, 29, 30])) == [30, 30, 29, 30], "run-length")
    year = 2026
    # a made-up year through Nov 3 (307 days): 80/60 every day from May 1 (20 GDD a day)
    n = 307
    dates = R.days_of(year, f"{year}-01-01", n)
    hi = [80.0 if d[5:] >= "05-01" else 40.0 for d in dates]
    lo = [60.0 if d[5:] >= "05-01" else 20.0 for d in dates]
    hi[dates.index("2026-07-21")] = 97.0
    lo[dates.index("2026-10-12")] = 31.0
    lo[dates.index("2026-10-20")] = 27.0
    tot, rep, miss = gdd_year(hi, lo, dates)
    ok(miss == 0 and len(rep) == 187 and abs(tot - (187 * 20 + (R.corn_gdd(97, 60) - 20) + (R.corn_gdd(80, 31) - 20) + (R.corn_gdd(80, 27) - 20))) < 1e-9,
       f"GDD sum {tot}")
    # a normal of 18 GDD a day, 30 years every day: 112%-ish
    norm = {"g": {"m": [180] * GDD_DAYS, "c": [[30, GDD_DAYS]]},
            "f": {"f32": [1008, 28], "s32": [425, 29]}}
    row = county_row({"name": "AMES 8 WSW", "sids": ["130203 2"]}, hi, lo, 0, year, True, norm, [])
    g = row["g"]
    ok(isinstance(g, list) and g[2] == 187 * 18 and g[3] == 30 and g[4] == int(round(100 * tot / (187 * 18))), f"GDD row {g}")
    ok(row["h"] == [97, 721, 0] and row["l"][0] == 20 and row["l"][1] == 101 and row["d9"] == 1, f"extremes {row['h']} {row['l']}")
    ok(row["fr"]["f32"] == [1012, 1008, 28] and row["fr"]["f28"] == [1020], f"fall freezes {row['fr']}")
    ok(row["fr"]["s32"] == [430, 425, 29], f"spring freeze {row['fr'].get('s32')}")
    ok(row["d3"] == 2, f"days at or below 32 since Jul 1 {row.get('d3')}")
    # the last 30 days (Oct 5 to Nov 3): 28 days at 20, Oct 12 and Oct 20 at 15 (low held at 50); normal 18 a day
    ok(row["g30"] == [590, 0, 540, 30, 109], f"30-day GDD by hand: {row.get('g30')}")
    hi30 = list(hi)
    hi30[-1] = hi30[-2] = None                # 2 of 30 days missing: 6.7%
    ok(county_row({"name": "X", "sids": ["1 2"]}, hi30, lo, 0, year, True, norm, [])["g30"] == WITHHELD, "30-day GDD withheld over 5% missing")
    hi30[-2] = 80.0                            # 1 of 30: 3.3%, left out of both sides
    ok(county_row({"name": "X", "sids": ["1 2"]}, hi30, lo, 0, year, True, norm, [])["g30"] == [570, 1, 522, 30, 109], "one missing day counts on neither side")
    # GDDs by month ("gm"), worked by hand on the same made-up year: 40/20 before May (0 a day), 80/60 from May 1
    # (20 a day), Jul 21 at 97 (high held at 86: (86 + 60) / 2 - 50 = 23), Oct 12 and Oct 20 lows held at 50 (15 each)
    gm = row["gm"]
    ok(len(gm) == 11 and gm[0] == [0, None, 31, 31] and gm[1] == [0, None, 28, 28], f"Jan and Feb with no Jan to Apr normal cached: {gm[:2]}")
    ok(gm[5] == [600, 540, 30, 30], f"a full month, June: 30 x 20 = 600 against 30 x 18 = 540: {gm[5]}")
    ok(gm[6] == [623, 558, 31, 31], f"July: 30 x 20 + 23 = 623 against 31 x 18 = 558: {gm[6]}")
    ok(gm[9] == [610, 558, 31, 31], f"October: 29 x 20 + 2 x 15 = 610: {gm[9]}")
    ok(gm[10] == [60, 54, 3, 3], f"November so far, 3 days: 60 against 54: {gm[10]}")
    ok(abs(sum(x[0] for x in gm[4:]) - g[0]) <= 4, f"the months from May add to the season's GDDs: {sum(x[0] for x in gm[4:])} vs {g[0]}")
    ne = dict(norm, e={"m": [10] * (GDD_DOY0 - 1), "c": [[30, GDD_DOY0 - 1]]})
    ok(county_row({"name": "X", "sids": ["1 2"]}, hi, lo, 0, year, True, ne, [])["gm"][0] == [0, 31, 31, 31], "January against the Jan to Apr normal: 31 x 1.0")
    hgm = list(hi)
    hgm[dates.index("2026-08-10")] = None       # 1 of 31 August days missing: 3.2%, left out of both sides
    ok(county_row({"name": "X", "sids": ["1 2"]}, hgm, lo, 0, year, True, norm, [])["gm"][7] == [600, 540, 30, 31], "a month with one missing day")
    hgm[dates.index("2026-08-11")] = None       # 2 of 31: 6.5%, withheld
    rgm = county_row({"name": "X", "sids": ["1 2"]}, hgm, lo, 0, year, True, norm, [])
    ok(rgm["gm"][7] is None and rgm["gm"][6] == [623, 558, 31, 31], f"a month over 5% missing is withheld, the others stay: {rgm['gm'][6:8]}")
    ok(county_row({"name": "X", "sids": ["1 2"]}, hi, lo, 0, year, True, None, [])["gm"][5] == [600, None, 30, 30], "no normals cached: the figure alone")
    rth = county_row({"name": "X", "sids": ["1 2"]}, hi, lo, 0, year, True,
                     {"g": {"m": [180] * GDD_DAYS, "c": [[30, 100], [19, GDD_DAYS - 100]]}}, [])["gm"]
    ok(rth[5] == [600, 540, 30, 30] and rth[7] == [620, None, 31, 31], f"a normal under 20 years for some days: no normal that month: {rth[7]}")
    ok(problems({"counties": {"1": rgm}}) == [] and problems({"counties": {"1": dict(row, gm=gm[:10])}})
       and problems({"counties": {"1": dict(row, gm=gm[:10] + [[60, 54, 4, 3]])}}), "the months are checked: one a month to the as-of day")
    # winter: Feb 14 to Mar 15 needs the Jan 1 to Apr 30 normal ("e"); a small normal prints no percent
    nw = 74
    hw, lw = [55.0] * nw, [45.0] * nw          # 2.5 GDD a day
    wn = {"g": norm["g"], "e": {"m": [10] * (GDD_DOY0 - 1), "c": [[30, GDD_DOY0 - 1]]}}
    rw = county_row({"name": "X", "sids": ["1 2"]}, hw, lw, 0, year, True, wn, [])
    ok("g" not in rw and rw["g30"] == [75, 0, 30, 30, None], f"winter 30-day GDD with its normal, no percent under {GDD30_PCT_MIN}: {rw.get('g30')}")
    ok(county_row({"name": "X", "sids": ["1 2"]}, hw, lw, 0, year, True, norm, [])["g30"] == [75, 0], "no Jan to Apr normal cached: the figure alone")
    ok(county_row({"name": "X", "sids": ["1 2"]}, hw[:29], lw[:29], 0, year, True, wn, []).get("g30") is None, "under 30 days in the year: no 30-day figure")
    ok(norm_day(wn, 1) == (10, 30) and norm_day(wn, 121) == (180, 30) and norm_day(wn, 365) == (180, 30) and norm_day(norm, 1) is None, "normal by day of year")
    # last season carried into the new year's rows that have no season yet
    prev = {"year": 2026, "counties": {"1": {"a": 1231, "g": [2950, 1, 2840, 30, 104], "s": ["8 miles west of Ames", "130203 2", 10]},
                                       "2": {"a": 1231, "g": WITHHELD}}}
    res = {"year": 2027, "counties": {"1": {"a": 314}, "2": {"a": 314}, "3": {"a": 314}}}
    carry_season(prev, res)
    ok(res["counties"]["1"]["gp"] == {"y": 2026, "a": 1231, "g": [2950, 1, 2840, 30, 104], "s": ["8 miles west of Ames", "130203 2", 10]}
       and res["counties"]["2"]["gp"]["g"] == WITHHELD and "gp" not in res["counties"]["3"], f"last season carried: {res['counties']}")
    nxt = {"year": 2027, "counties": {"1": {"a": 315}, "2": {"a": 501, "g": [0, 0]}}}
    carry_season(res, nxt)
    ok(nxt["counties"]["1"]["gp"]["y"] == 2026 and "gp" not in nxt["counties"]["2"], "carried on through the spring; dropped once the season starts")
    old = {"year": 2025, "counties": prev["counties"]}
    nxt2 = {"year": 2027, "counties": {"1": {"a": 315}}}
    carry_season(old, nxt2)
    ok("gp" not in nxt2["counties"]["1"], "a file two years old is no last season")
    ok(problems({"counties": res["counties"]}) == [] and problems({"counties": {"1": {"a": 314, "gp": {"y": 2026, "a": 0, "g": [1, 0]}}}}), "the last season is checked for its date")
    # withhold on missing days: 6% of the GDD days gone -> "m"; 5% kept
    hi2 = list(hi)
    gd = [i for i, d in enumerate(dates) if d[5:] >= "05-01"]
    for i in gd[:12]:                       # 12 of 187 = 6.4%
        hi2[i] = None
    r2 = county_row({"name": "X", "sids": ["1 2"]}, hi2, lo, 0, year, True, norm, [])
    ok(r2["g"] == WITHHELD, f"over 5% of the GDD days missing is withheld: {r2['g']}")
    hi3 = list(hi)
    for i in gd[:9]:                        # 9 of 187 = 4.8%
        hi3[i] = None
    r3 = county_row({"name": "X", "sids": ["1 2"]}, hi3, lo, 0, year, True, norm, [])
    ok(isinstance(r3["g"], list) and r3["g"][1] == 9 and r3["g"][2] == (187 - 9) * 18, f"missing days count on neither side: {r3['g']}")
    lo4 = list(lo)
    for i in range(16):                      # 16 of 307 = 5.2% of the year's lows
        lo4[i] = None
    r4 = county_row({"name": "X", "sids": ["1 2"]}, hi, lo4, 0, year, True, norm, [])
    ok(r4["l"] == WITHHELD and r4["h"] != WITHHELD, f"the coldest day withheld on its own missing days: {r4['l']}")
    lo5 = list(lo)
    for i in range(dates.index("2026-07-01"), dates.index("2026-07-01") + 12):
        lo5[i] = None                        # 12 of the 104 days Jul 1 to Oct 12: 11.5%
    r5 = county_row({"name": "X", "sids": ["1 2"]}, hi, lo5, 0, year, True, norm, [])
    ok(r5["fr"]["f32"][0] == WITHHELD, f"first fall freeze withheld when its window misses days: {r5['fr']['f32']}")
    # a normal with too few years: no percent
    thin = {"g": {"m": [180] * GDD_DAYS, "c": [[30, 100], [19, GDD_DAYS - 100]]}}
    r6 = county_row({"name": "X", "sids": ["1 2"]}, hi, lo, 0, year, True, thin, [])
    ok(len(r6["g"]) == 2, f"a normal under 20 years prints no percent: {r6['g']}")
    # the note rule: October's 88 on Oct 5 against a made-up record
    hi7 = list(hi)
    hi7[dates.index("2026-10-05")] = 88.0
    rec = [["M", "M"]] * (1980 - FIRST_YEAR) + [[f"{80 + (y % 3)}", "20"] for y in range(1980, 2026)]
    rec[2011 - FIRST_YEAR] = ["90", "15"]
    x = month_note("h", 10, hi7, dates, year, rec)
    ok(x == ["h", 10, 88, 1005, 2011, 47], f"warmest October day since 2011: {x}")
    rec_m = list(rec)
    rec_m[2015 - FIRST_YEAR] = ["M", "M"]
    ok(month_note("h", 10, hi7, dates, year, rec_m) is None, "a year with no full record between since and now withholds")
    short = [["M", "M"]] * (2008 - FIRST_YEAR) + [["80", "20"]] * (2026 - 2008)
    ok(month_note("h", 10, hi7, dates, year, short) is None, "the rank is withheld under 20 years of record")
    near = list(rec)
    near[2020 - FIRST_YEAR] = ["89", "20"]
    ok(month_note("h", 10, hi7, dates, year, near) is None, "a look back under 10 years is not of note")
    top = [["M", "M"]] * (1980 - FIRST_YEAR) + [["80", "20"]] * (2026 - 1980)
    ok(month_note("h", 10, hi7, dates, year, top) == ["h", 10, 88, 1005, 0, 47], "warmest in 47 years of record")
    ok(month_note("l", 10, lo, dates, year, rec) is None, "a low of 27 above every October low of 20 is not a cold note")
    # the normals summary from a made-up 1991-2020 record
    rows = []
    d0 = dt.date(NORM_Y0, 1, 1)
    for i in range((dt.date(NORM_Y1, 12, 31) - d0).days + 1):
        d = d0 + dt.timedelta(days=i)
        l = 25.0 if (d.month, d.day) == (4, 20) or (d.month, d.day) == (10, 10 + d.year % 3) else 55.0
        rows.append(["75", str(l)])
    s = norm_summary(rows)
    ok(s.get("g", {}).get("m", [None])[0] == 150 and s["g"]["c"] == [[30, GDD_DAYS]], f"normal GDD {s.get('g', {}).get('m', [None])[:1]}")
    ok(s.get("e", {}).get("m", [None])[0] == 150 and s["e"]["c"] == [[30, GDD_DOY0 - 1]] and len(s["e"]["m"]) == GDD_DOY0 - 1,
       f"the Jan 1 to Apr 30 normal beside it: {s.get('e', {}).get('c')}")
    ok(s.get("f", {}).get("s32") == [420, 30] and s["f"].get("f32") == [1011, 30], f"usual freezes {s.get('f')}")
    for i in range(0, 5000):
        rows[i] = ["M", "M"]                 # 1991 to mid-2004 gone: 16 full years
    s2 = norm_summary(rows)
    ok("g" not in s2 and "f" not in s2, f"under 20 years: no normal, no usual date ({s2})")
    # no figure without its date
    bad = problems({"counties": {"1": {"a": 1103, "h": [97, 0, 0]}, "2": {"a": 1103, "nt": [["h", 10, 88, 0, 2011, 47]]}}})
    ok(len(bad) == 2, f"a figure with no date is refused: {bad}")
    ok(problems({"counties": {"1": row}}) == [], f"the made-up row passes: {problems({'counties': {'1': row}})}")
    # a whole state through the saved answers (MADE UP, test/fixtures/rain-wx)
    fx = os.path.join(ROOT, "test", "fixtures", "rain-wx")
    with tempfile.TemporaryDirectory() as t:
        rain, out, nd = os.path.join(t, "rain"), os.path.join(t, "wx"), os.path.join(t, "wxnorm")
        os.makedirs(rain)
        st_file = json.load(open(os.path.join(fx, "rain-ia.json"), encoding="utf-8"))
        json.dump(st_file, open(os.path.join(rain, "ia.json"), "w"))
        run(Saved(fx), None, rain, out, nd)
        w = json.load(open(os.path.join(out, "ia.json"), encoding="utf-8"))
        cs = w["counties"]
        ok(w["fetched"] == st_file["fetched"], "fetched carried over")
        ok("s" not in cs.get("19015", {"s": 1}), f"Boone: the rain station's own highs and lows {cs.get('19015')}")
        st_ = cs.get("19169", {}).get("s")
        ok(st_ and st_[0] == "8 miles west-southwest of Ames" and st_[2] == 10, f"Story: a volunteer gauge, so the co-op station 10 mi away is named: {st_}")
        ok("19127" not in cs, "Marshall: no station with enough highs and lows, no weather")
        ok(isinstance(cs.get("19169", {}).get("g"), list) and len(cs["19169"]["g"]) == 5, f"Story GDD with its normal {cs.get('19169', {}).get('g')}")
        ok(any(x[4] == 2011 for x in cs.get("19169", {}).get("nt", [])), f"Story note {cs.get('19169', {}).get('nt')}")
        ok(os.path.exists(os.path.join(nd, "ia.json")), "the normals cache written")
        calls = Saved(fx)
        run(calls, None, rain, out, nd)
        ok(calls.calls == 3, f"a second run reads no normals again ({calls.calls} calls: the year and two month records)")
        ok(not [f for f in os.listdir(out) + os.listdir(nd) if f.endswith(".tmp")], "written whole: no temp file left behind")
        # the order: the stalest published weather first, missing first of all; ties move with the day
        for st, f in (("KS", "2026-11-03T13:00:00Z"), ("WY", "2026-11-01T13:00:00Z")):
            json.dump({"fetched": f}, open(os.path.join(out, st.lower() + ".json"), "w"))
        open(os.path.join(out, "va.json"), "w").write('{"fetched": "2026-11')     # cut off: as if none
        ok(state_order(["IA", "KS", "VA", "WY"], out, 0)[:2] == ["VA", "WY"], f"stalest first: {state_order(['IA', 'KS', 'VA', 'WY'], out, 0)}")
        ties = ["AK", "AL", "WI", "WY"]
        o0, o3 = state_order(ties, os.path.join(t, "none"), 0), state_order(ties, os.path.join(t, "none"), 3)
        ok(o0 == ["AK", "AL", "WI", "WY"] and o3[0] == "WY", f"ties start at a place that moves with the day: {o0} {o3}")
        ok({state_order(ties, os.path.join(t, "none"), k)[-1] for k in range(4)} == set(ties), "no state is always last")
        # a run out of time skips the rest and says which, with the marker line
        import io
        import contextlib
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            done, skipped = run(Saved(fx), None, rain, out, nd, deadline=time.time() - 1)
        ok(done == [] and skipped == ["IA"], f"past the deadline nothing starts: {done} {skipped}")
        ok("::warning::rain weather: 0 of 1 states updated, skipped: IA" in buf.getvalue()
           and "RAIN-WX updated=0 stale=1" in buf.getvalue(), f"the skip is said: {buf.getvalue()[-200:]}")
    # the normals window is hard: a call never runs past its end plus the margin, nor starts too late
    nt = Net(time.time() + 600)
    ok(abs(nt.budget() - TIMEOUT_S) < 1, "a call outside the fill window gets the full timeout")
    nt.limit = time.time() + 60
    ok(nt.budget() <= 60 + CALL_MARGIN_S + 0.5, f"inside the window a call ends by its end plus the margin ({nt.budget():.0f}s)")
    nt.limit = time.time() - CALL_MARGIN_S
    try:
        nt.budget()
        ok(False, "a call with no time left in the window must not start")
    except TimeoutError:
        pass
    print("fetch_rain_weather selftest:", "ok" if not fails else "FAIL " + "; ".join(fails))
    return 1 if fails else 0


def main(argv):
    if "--selftest" in argv:
        return selftest()
    states = None
    if "--states" in argv and argv.index("--states") + 1 < len(argv):
        states = {s.strip().upper() for s in argv[argv.index("--states") + 1].split(",") if s.strip()}
    run(Net(time.time() + MAX_MINUTES * 60), states)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
