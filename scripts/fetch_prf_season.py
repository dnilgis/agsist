#!/usr/bin/env python3
"""
fetch_prf_season.py: where each PRF grid stands in the intervals that are still
open, from NOAA CPC's daily rain, before RMA publishes the final index.
-> data/prf/now/<ST>.json (one small file per state, loaded on demand by
   components/prf-now.js on /prf and the PRF county pages)

WHY THIS EXISTS
  A PRF interval is two months long and RMA publishes the final index weeks
  after it ends. A rancher sees nothing in between, so one late rain can turn
  a payment he was counting on into almost nothing with no warning. CPC posts
  its gauge analysis every day. Totaling it over the interval so far, against
  the grid's long-run average, shows where the grid stands now.

THE SOURCE (read on a GitHub runner, Oct 17, 2026; data/prf-season-raw/ on the
raw branch keeps the listings, the README and one daily file)
  NOAA CPC Unified Gauge-Based Analysis of Daily Precipitation over CONUS,
  real-time version (RT), 0.25 degree:
    https://ftp.cpc.ncep.noaa.gov/precip/CPC_UNI_PRCP/GAUGE_CONUS/RT/<YYYY>/
        PRCP_CU_GAUGE_V1.0CONUS_0.25deg.lnx.<YYYYMMDD>.RT
  (NOAA PSL serves the same analysis as yearly netCDF at
   https://downloads.psl.noaa.gov/Datasets/cpc_us_precip/RT/.)
  CPC's README (DOCU/PRCP_CU_GAUGE_V1.0CONUS_0.25deg.README) and RT.ctl:
    * two fields of 300 x 120 4-byte little-endian floats: daily rain in
      0.1 mm, then the number of gauges in the box; undefined is -999.0
    * the first box is centred at 129.875W 20.125N, west to east, then south
      to north. That is RMA's grid numbering exactly: grid id - 1 is the
      index into the field (all 13,414 PRF grids land on a defined box; the
      field read north-first misses 7,153 of them)
    * a day ends at 12Z. An RT file is posted the next afternoon and posted
      again a day later with more gauges ("the analysis for the day is based
      on the real-time station data and will be reprocessed later")
  RMA says (Rainfall Index Data, 2027 and Beyond, June 2026) the index used
  CPC data through crop year 2026 and uses NOAA NCEI's nClimGrid, monthly
  final, from crop year 2027. So this file tracks crop year 2026 intervals
  from CPC and WITHHOLDS 2027 intervals (CPC_LAST_CROP_YEAR) until it reads
  NCEI's files.

THE ARITHMETIC (components/prf-now.js does the same, test/prf-now.test.mjs)
  precip so far   = sum of CPC's daily rain at the grid, first day of the
                    interval through the newest day CPC has posted, mm
  average         = the grid's average for the whole interval in RMA's record
                    for that crop year. RMA's PRF service gives every past
                    year against one average (the 'a' fetch_prf.py keeps,
                    1951-2025) and each year Y against 1951 to Y-2, so
                    average(Y) = a x mean(index 1951..Y-2). Checked against
                    the service's own 2026 averages in the backtest.
  index so far    = precip so far / average x 100, preliminary
  rain to reach c = c/100 x average - precip so far (none when already there)
  A grid with a missing CPC value on any day of the interval gets no number.
  A day missing from CPC in the middle of an interval stops that interval.

HOW GOOD IT IS: --backtest-collect on a runner, --backtest-analyze here. The
end-of-interval CPC total for past intervals, against RMA's published final
index, for a sample of grids. test/fixtures/prf-season/ pins the rows and the
summary; the card prints the summary.

USAGE
  python scripts/fetch_prf_season.py --selftest
  python scripts/fetch_prf_season.py                  # build data/prf/now/
  python scripts/fetch_prf_season.py --check          # the files are well formed
  python scripts/fetch_prf_season.py --backtest-collect OUT_DIR
  python scripts/fetch_prf_season.py --backtest-analyze ROWS.json[.gz]
"""

import argparse
import array
import base64
import concurrent.futures
import datetime as dt
import glob
import gzip
import json
import os
import statistics
import struct
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRF = os.path.join(ROOT, "data", "prf")
OUT = os.path.join(PRF, "now")
BACKTEST = os.path.join(ROOT, "test", "fixtures", "prf-season", "backtest.json")

CPC_DIR = "https://ftp.cpc.ncep.noaa.gov/precip/CPC_UNI_PRCP/GAUGE_CONUS/RT/"
CPC_NAME = "PRCP_CU_GAUGE_V1.0CONUS_0.25deg.lnx.{d}.RT"
RMA_API = ("https://public-rma.fpac.usda.gov/apps/PrfWebApi/PrfExternalIndexes/GetIndexValues"
           "?intervalType=BiMonthly&sampleYearMinimum={y0}&sampleYearMaximum={y1}&gridId={g}")
NCEI_MONTH = "https://www.ncei.noaa.gov/monitoring-content/data/us/usda/monthly/final/{ym}.usda.csv"
UA = "agsist.com PRF interval tracker (https://agsist.com/prf)"
SOURCE = ("NOAA CPC Unified Gauge-Based Analysis of Daily Precipitation over CONUS, "
          "real-time version, 0.25 degree")

COLS, ROWS = 300, 120
CELLS = COLS * ROWS
FILE_BYTES = 2 * CELLS * 4
UNDEF = -999.0
MAX_DAY_TENTHS = 15000          # 1,500 mm in a day is not rain, it is a broken file
LAND_MIN, LAND_MAX = 13000, 14500   # boxes with a value; 13,626 on 2026-10-15
FIRST_YEAR = 1951
CPC_LAST_CROP_YEAR = 2026       # RMA: CPC through crop year 2026, NCEI nClimGrid from 2027
KEEP_ENDED_DAYS = 75            # an ended interval stays on the card this long, or until RMA publishes it
PUBLISHED_SHARE = 0.9           # RMA has published an interval when this share of grids has it
COVERAGE = [70, 75, 80, 85, 90]
IV = ["Jan-Feb", "Feb-Mar", "Mar-Apr", "Apr-May", "May-Jun", "Jun-Jul",
      "Jul-Aug", "Aug-Sep", "Sep-Oct", "Oct-Nov", "Nov-Dec"]
MAX_STATE_BYTES = 150_000       # one state file; Texas is the biggest
WORKERS = 8


def log(*a):
    print(*a, flush=True)


# ---------------------------------------------------------------- the decoder

def decode_cpc(raw):
    """One CPC RT daily file -> list of CELLS values in mm (None where CPC has none).
    Refuses anything that is not the documented layout."""
    if len(raw) != FILE_BYTES:
        raise ValueError(f"CPC file is {len(raw)} bytes, expected {FILE_BYTES}")
    a = array.array("f")
    a.frombytes(raw)
    if sys.byteorder != "little":
        a.byteswap()
    rain, nstn = a[:CELLS], a[CELLS:]
    out, land = [None] * CELLS, 0
    for k in range(CELLS):
        v, n = rain[k], nstn[k]
        if v == UNDEF:
            if n != UNDEF:
                raise ValueError(f"box {k}: no rain value but a gauge count {n}")
            continue
        if not (0 <= v <= MAX_DAY_TENTHS) or v != v:
            raise ValueError(f"box {k}: rain {v} tenths of a mm is out of range")
        if not (0 <= n <= 1000):
            raise ValueError(f"box {k}: gauge count {n} is out of range")
        out[k] = v / 10.0
        land += 1
    if not (LAND_MIN <= land <= LAND_MAX):
        raise ValueError(f"{land} boxes have a value, expected {LAND_MIN} to {LAND_MAX}")
    return out


def cpc_url(day):
    return CPC_DIR + f"{day.year}/" + CPC_NAME.format(d=day.strftime("%Y%m%d"))


# ---------------------------------------------------------------- intervals

def month_end(y, m):
    return (dt.date(y + (m == 12), m % 12 + 1, 1) - dt.timedelta(days=1))


def interval(y, i):
    """Interval i (0 = Jan-Feb ... 10 = Nov-Dec) of year y -> (first day, last day)."""
    return dt.date(y, i + 1, 1), month_end(y, i + 2)


def open_intervals(through, published):
    """Intervals that have started by `through` and are not over and done:
    still running, or ended within KEEP_ENDED_DAYS and not yet published.
    published(y, i) -> True when RMA has the final index."""
    out = []
    for y in (through.year - 1, through.year):
        for i in range(11):
            a, b = interval(y, i)
            if a > through:
                continue
            if b < through and ((through - b).days > KEEP_ENDED_DAYS or published(y, i)):
                continue
            out.append((y, i))
    return out


# ---------------------------------------------------------------- the math

def index_so_far(precip, avg):
    """percent of the full-interval average, one decimal; None when either is missing."""
    if precip is None or not avg:
        return None
    return round(precip / avg * 100, 1)


def rain_to_reach(precip, avg, cov):
    """mm more that would lift the index to cov percent; 0 when it is there already."""
    if precip is None or not avg:
        return None
    return max(0.0, round(cov / 100 * avg - precip, 1))


def average_for_year(a10, idx1000, year):
    """The grid's interval average RMA uses for crop year `year`, mm.
    a10 = fetch_prf's 'a' (mm x 10, against 1951-2025), idx1000 = {year: index x 1000}.
    Years 1951..year-2 must all be there, or None."""
    if a10 is None:
        return None
    years = range(FIRST_YEAR, year - 1)
    vals = [idx1000.get(y) for y in years]
    if not vals or any(v is None for v in vals):
        return None
    return a10 / 10 * (sum(vals) / len(vals) / 1000)


# ---------------------------------------------------------------- RMA's record (data/prf)

def unpack16(b64):
    raw = base64.b64decode(b64)
    return list(struct.unpack("<%dH" % (len(raw) // 2), raw))


def load_record(prf=PRF):
    """{grid: (a10 list, {year: [11 index x1000 or None]})} from data/prf/g and y."""
    rec = {}
    for f in glob.glob(os.path.join(prf, "g", "*.json")):
        d = json.load(open(f))
        y0, y1 = d["y0"], d["y1"]
        for g, r in d["g"].items():
            flat = unpack16(r["h"])
            years = {}
            for k, y in enumerate(range(y0, y1 + 1)):
                row = flat[k * 11:(k + 1) * 11]
                years[y] = [None if v == 65535 else v for v in row]
            rec[int(g)] = (r.get("a") or [None] * 11, years)
    for f in glob.glob(os.path.join(prf, "y", "*.json")):
        d = json.load(open(f))
        for g, yrs in d["g"].items():
            if int(g) in rec:
                for y, vals in yrs.items():
                    rec[int(g)][1][int(y)] = vals
    return rec


def state_grids(prf=PRF):
    out = {}
    for f in sorted(glob.glob(os.path.join(prf, "s", "*.json"))):
        d = json.load(open(f))
        gs = set()
        for c in d["counties"].values():
            gs.update(c["g"])
        out[d["st"]] = sorted(gs)
    return out


# ---------------------------------------------------------------- fetching

def http_get(url, timeout=60, tries=4):
    last = None
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            last = e
        except Exception as e:      # network: try again
            last = e
        time.sleep(3 * (k + 1))
    raise RuntimeError(f"{url}: {last}")


def fetch_days(days, cache=None, fresh_from=None):
    """{day: decoded field or None when CPC has not posted it}. Days on or after
    fresh_from are always read again (CPC re-posts each day once)."""
    def one(day):
        path = os.path.join(cache, day.strftime("%Y%m%d")) if cache else None
        if path and os.path.exists(path) and (fresh_from is None or day < fresh_from):
            raw = open(path, "rb").read()
        else:
            raw = http_get(cpc_url(day))
            if raw is None:
                return day, None
            if path:
                os.makedirs(cache, exist_ok=True)
                open(path, "wb").write(raw)
        return day, decode_cpc(raw)
    out = {}
    with concurrent.futures.ThreadPoolExecutor(WORKERS) as ex:
        for day, field in ex.map(one, days):
            out[day] = field
    return out


def newest_day(today, fetch=http_get):
    """The newest day CPC has posted, looking back up to 10 days."""
    for back in range(1, 11):
        d = today - dt.timedelta(days=back)
        raw = fetch(cpc_url(d))
        if raw is not None:
            decode_cpc(raw)
            return d
    raise RuntimeError("CPC has posted nothing in the last 10 days")


# ---------------------------------------------------------------- build

def interval_totals(fields, grids, first, last):
    """{grid: mm} over first..last; a grid with any undefined day is None.
    Raises when a day in the range is missing from `fields`."""
    tot = {g: 0.0 for g in grids}
    d = first
    while d <= last:
        f = fields.get(d)
        if f is None:
            raise LookupError(f"CPC has no file for {d}")
        for g in grids:
            t = tot[g]
            if t is None:
                continue
            v = f[g - 1]
            tot[g] = None if v is None else t + v
        d += dt.timedelta(days=1)
    return tot


def build(today=None, fetch_fields=None, prf=PRF, out_dir=OUT, through=None, backtest_path=BACKTEST):
    today = today or dt.datetime.now(dt.timezone.utc).date()
    rec = load_record(prf)
    by_state = state_grids(prf)
    all_grids = sorted({g for gs in by_state.values() for g in gs})
    through = through or newest_day(today)

    def published(y, i):
        have = sum(1 for g in all_grids if g in rec and (rec[g][1].get(y) or [None] * 11)[i] is not None)
        return have >= PUBLISHED_SHARE * len(all_grids)

    ivs = open_intervals(through, published)
    days = sorted({interval(y, i)[0] + dt.timedelta(days=k)
                   for y, i in ivs if y <= CPC_LAST_CROP_YEAR
                   for k in range((min(interval(y, i)[1], through) - interval(y, i)[0]).days + 1)})
    fields = (fetch_fields or (lambda ds: fetch_days(ds, os.environ.get("PRF_SEASON_CACHE"), through - dt.timedelta(days=3))))(days)

    meta, cols = [], []
    for y, i in ivs:
        a, b = interval(y, i)
        upto = min(b, through)
        m = {"y": y, "i": i, "name": IV[i], "from": a.isoformat(), "to": b.isoformat(),
             "days": (b - a).days + 1, "have": (upto - a).days + 1}
        if y > CPC_LAST_CROP_YEAR:
            m["withheld"] = "From crop year 2027 RMA uses NOAA NCEI's nClimGrid, not CPC; this tracker does not read it yet."
            meta.append(m)
            cols.append(None)
            continue
        try:
            tot = interval_totals(fields, all_grids, a, upto)
        except LookupError as e:
            m["withheld"] = f"CPC is missing a day ({e}); no number until it is posted."
            meta.append(m)
            cols.append(None)
            continue
        avg = {}
        for g in all_grids:
            if g in rec:
                idx = {yy: v[i] for yy, v in rec[g][1].items()}
                avg[g] = average_for_year(rec[g][0][i], idx, y)
        meta.append(m)
        cols.append((tot, avg))

    acc = None
    if backtest_path and os.path.exists(backtest_path):
        acc = json.load(open(backtest_path)).get("summary")
    built = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    os.makedirs(out_dir, exist_ok=True)
    wrote = []
    for st, gs in by_state.items():
        g_out = {}
        for g in gs:
            row = []
            for c in cols:
                if c is None:
                    row.append(None)
                    continue
                p, av = c[0].get(g), c[1].get(g)
                row.append([None if p is None else int(round(p * 10)), None if not av else int(round(av * 10))])
            g_out[str(g)] = row
        doc = {"v": 1, "st": st, "built": built, "through": through.isoformat(), "src": SOURCE,
               "iv": meta, "g": g_out, "acc": acc,
               "note": "Preliminary. Rain so far from CPC's real-time daily analysis, mm x 10; average for the "
                       "whole interval from RMA's record, mm x 10. Not RMA's final index. "
                       "Written by scripts/fetch_prf_season.py."}
        text = json.dumps(doc, separators=(",", ":"), sort_keys=True)
        check_doc(json.loads(text))
        path = os.path.join(out_dir, f"{st}.json")
        open(path, "w").write(text)
        wrote.append((st, len(text)))
    log(f"wrote {len(wrote)} state files through {through}, intervals: "
        + ", ".join(f"{IV[m['i']]} {m['y']}" + (" (withheld)" if m.get('withheld') else "") for m in meta))
    log("largest: " + ", ".join(f"{s} {n:,}" for s, n in sorted(wrote, key=lambda t: -t[1])[:3]))
    return wrote


def check_doc(d):
    assert d["v"] == 1 and len(d["st"]) == 2, "header"
    dt.date.fromisoformat(d["through"])
    n = len(d["iv"])
    assert 1 <= n <= 6, f"{n} intervals"
    for m in d["iv"]:
        assert 0 <= m["i"] <= 10 and 1 <= m["have"] <= m["days"] <= 62, f"interval {m}"
    good = 0
    for g, row in d["g"].items():
        assert 1 <= int(g) <= CELLS and len(row) == n, f"grid {g}"
        for k, cell in enumerate(row):
            if cell is None:
                assert d["iv"][k].get("withheld"), f"grid {g}: empty cell in an open interval"
                continue
            p, a = cell
            if p is not None:
                assert 0 <= p <= 62 * MAX_DAY_TENTHS, f"grid {g}: precip {p}"
            if a is not None:
                assert 0 < a < 40000, f"grid {g}: average {a}"
            good += p is not None and a is not None
    if not all(m.get("withheld") for m in d["iv"]):
        assert good >= 0.9 * len(d["g"]), f"only {good} grid cells have both numbers"
    return True


def check(out_dir=OUT):
    files = sorted(glob.glob(os.path.join(out_dir, "*.json")))
    if not files:
        log("no data/prf/now files yet (the card shows its empty state)")
        return True
    for f in files:
        if os.path.basename(f) == "backtest.json":
            continue
        d = json.load(open(f))
        check_doc(d)
        size = os.path.getsize(f)
        assert size <= MAX_STATE_BYTES, f"{f} is {size} bytes"
    log(f"{len(files)} state files ok")
    return True


# ---------------------------------------------------------------- backtest

def sample_grids(prf=PRF, every=25):
    gs = sorted({g for v in state_grids(prf).values() for g in v})
    return gs[::every]


def backtest_collect(out_dir, years=(2024, 2025, 2026), every=25):
    """On a runner: for a sample of grids, CPC's end-of-interval totals for every
    finished interval of `years`, and RMA's published record for the same."""
    grids = sample_grids(every=every)
    log(f"backtest: {len(grids)} grids")
    api = {}

    def one(g):
        raw = http_get(RMA_API.format(y0=years[0], y1=years[-1], g=g), timeout=120)
        doc = json.loads(raw)
        rows = []
        for r in doc.get("HistoricalIndexRows") or []:
            for c in r.get("HistoricalIndexDataColumns") or []:
                if c.get("PercentOfNormal") is None:
                    continue
                rows.append([int(c["Year"]), int(c["IntervalCode"]) - 625, c["PercentOfNormal"],
                             c.get("IntervalMeasurement"), c.get("AverageIntervalMeasurement"), c.get("FilingStatusId")])
        return g, rows
    with concurrent.futures.ThreadPoolExecutor(WORKERS) as ex:
        for g, rows in ex.map(one, grids):
            api[g] = rows
    need = sorted({(y, i) for rows in api.values() for y, i, *_ in rows})
    # NCEI nClimGrid monthly final at 0.25 degree (RMA's source from crop year 2027),
    # to see which source the published record follows
    want = set(grids)
    ncei = {}

    def month(ym):
        raw = http_get(NCEI_MONTH.format(ym=ym), timeout=120)
        vals = {}
        if raw:
            for line in raw.decode("utf-8", "replace").splitlines()[1:]:
                try:
                    la, lo, p = (float(x) for x in line.split(","))
                except ValueError:
                    continue
                g = int(round((la - 20.125) / 0.25)) * COLS + int(round((lo + 129.875) / 0.25)) + 1
                if g in want:
                    vals[g] = p
        return ym, vals
    yms = sorted({f"{y}{m:02d}" for y, i in need for m in (i + 1, i + 2)})
    with concurrent.futures.ThreadPoolExecutor(4) as ex:
        for ym, vals in ex.map(month, yms):
            ncei[ym] = vals
    log(f"  NCEI months read: {sum(1 for v in ncei.values() if v)} of {len(yms)}")

    def ncei_total(g, y, i):
        a, b = ncei.get(f"{y}{i + 1:02d}", {}).get(g), ncei.get(f"{y}{i + 2:02d}", {}).get(g)
        return None if a is None or b is None else round(a + b, 2)
    out = []
    for y in years:
        ivs = [i for yy, i in need if yy == y]
        if not ivs:
            continue
        first, last = interval(y, min(ivs))[0], interval(y, max(ivs))[1]
        days = [first + dt.timedelta(days=k) for k in range((last - first).days + 1)]
        log(f"  {y}: {len(days)} CPC days")
        fields = fetch_days(days, os.environ.get("PRF_SEASON_CACHE"))
        missing = [d.isoformat() for d, f in fields.items() if f is None]
        if missing:
            log(f"  {y}: CPC has no file for {len(missing)} day(s): {missing[:5]}")
        for i in ivs:
            a, b = interval(y, i)
            try:
                tot = interval_totals(fields, grids, a, b)
            except LookupError as e:
                log(f"  {IV[i]} {y}: skipped, {e}")
                continue
            for g in grids:
                for yy, ii, pon, meas, avg, fs in api[g]:
                    if yy == y and ii == i:
                        out.append({"g": g, "y": y, "i": i, "cpc": None if tot[g] is None else round(tot[g], 2),
                                    "ncei": ncei_total(g, y, i),
                                    "rma_idx": pon, "rma_mm": meas, "rma_avg": avg, "fs": fs})
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, "backtest-rows.json")
    json.dump({"collected": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
               "grids": grids, "every": every, "source": SOURCE, "rows": out}, open(path, "w"), separators=(",", ":"))
    log(f"backtest: {len(out)} rows -> {path}")


def summarize(rows, rec=None):
    """Index points: CPC's end-of-interval index (CPC total / RMA's average for
    that year x 100) minus RMA's published final index x 100."""
    diffs, by_iv, abs_d = [], {}, []
    for r in rows:
        if r["cpc"] is None or not r["rma_avg"] or r["rma_idx"] is None:
            continue
        est = r["cpc"] / r["rma_avg"] * 100
        d = est - r["rma_idx"] * 100
        diffs.append(d)
        abs_d.append(abs(d))
        by_iv.setdefault((r["y"], r["i"]), []).append(d)
    if not diffs:
        return None
    abs_sorted = sorted(abs_d)

    def q(p):
        return round(abs_sorted[min(len(abs_sorted) - 1, int(p * len(abs_sorted)))], 1)
    within = lambda t: round(100 * sum(1 for x in abs_d if x <= t) / len(abs_d))
    per = [{"y": y, "i": i, "name": IV[i], "n": len(v), "median_diff": round(statistics.median(v), 1),
            "median_abs": round(statistics.median([abs(x) for x in v]), 1)} for (y, i), v in sorted(by_iv.items())]
    return {"n": len(diffs), "grids": len({r["g"] for r in rows}), "intervals": len(by_iv),
            "median_abs": round(statistics.median(abs_d), 1), "median_diff": round(statistics.median(diffs), 1),
            "p90_abs": q(0.9), "within5": within(5), "within10": within(10),
            "first": f"{IV[min(by_iv)[1]]} {min(by_iv)[0]}", "last": f"{IV[max(by_iv)[1]]} {max(by_iv)[0]}",
            "per_interval": per}


def backtest_analyze(path, out=BACKTEST):
    op = gzip.open if path.endswith(".gz") else open
    doc = json.load(op(path, "rt"))
    s = summarize(doc["rows"])
    full = {"what": "CPC real-time daily totals over each whole interval, divided by RMA's average for that "
                    "grid and year, against RMA's published final index (PRF service), index points.",
            "collected": doc["collected"], "every": doc["every"], "source": doc["source"],
            "summary": {k: v for k, v in s.items() if k != "per_interval"}, "per_interval": s["per_interval"]}
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump(full, open(out, "w"), indent=1, sort_keys=True)
    log(json.dumps(full["summary"], indent=1))
    return full


# ---------------------------------------------------------------- selftest

def synth_file(values_tenths, gauges=None, land=13626):
    """A CPC-shaped file: the given {cell: tenths}, other land boxes dry, the rest undefined."""
    rain = [UNDEF] * CELLS
    nst = [UNDEF] * CELLS
    for k in range(land):
        rain[k], nst[k] = 0.0, 0.0
    for k, v in values_tenths.items():
        rain[k], nst[k] = float(v), float((gauges or {}).get(k, 1))
    return struct.pack("<%df" % (2 * CELLS), *(rain + nst))


def selftest():
    fails = []

    def ok(c, what):
        if not c:
            fails.append(what)
            log("FAIL", what)

    # the decoder, on a real file (CPC RT, 2026-10-15) and on broken ones
    fx = os.path.join(ROOT, "test", "fixtures", "prf-season", "cpc-20261015.RT.gz")
    if os.path.exists(fx):
        f = decode_cpc(gzip.open(fx).read())
        pins = json.load(open(os.path.join(ROOT, "test", "fixtures", "prf-season", "cpc-20261015-pins.json")))
        for g, mm in pins["mm"].items():
            v = f[int(g) - 1]
            ok((v is None and mm is None) or (v is not None and mm is not None and abs(v - mm) < 1e-4), f"pin grid {g}: {v} vs {mm}")
        ok(sum(1 for v in f if v is not None) == pins["land"], "land box count")
    else:
        ok(False, "decoder fixture missing")
    good = synth_file({0: 125, 299: 3})
    f = decode_cpc(good)
    ok(f[0] == 12.5 and f[299] == 0.3 and f[CELLS - 1] is None, "synthetic decode")
    for bad, why in ((good[:-4], "short file"),
                     (synth_file({5: -5}), "negative rain"),
                     (synth_file({5: 20000}), "2,000 mm in a day"),
                     (synth_file({}, land=500), "too few land boxes")):
        try:
            decode_cpc(bad)
            ok(False, f"decoder took a {why}")
        except ValueError:
            pass

    # intervals
    ok(interval(2024, 0) == (dt.date(2024, 1, 1), dt.date(2024, 2, 29)), "leap Jan-Feb")
    ok(interval(2026, 10) == (dt.date(2026, 11, 1), dt.date(2026, 12, 31)), "Nov-Dec")
    got = open_intervals(dt.date(2026, 10, 16), lambda y, i: (y, i) <= (2026, 5))
    ok(got == [(2026, 6), (2026, 7), (2026, 8), (2026, 9)], f"open intervals Oct 16: {got}")
    got = open_intervals(dt.date(2027, 1, 10), lambda y, i: False)
    ok(got == [(2026, 8), (2026, 9), (2026, 10), (2027, 0)], f"open intervals Jan 10: {got}")

    # the math, worked by hand: 3.00 in so far (76.2 mm) on a 5.00 in (127.0 mm) average
    ok(index_so_far(76.2, 127.0) == 60.0, "index so far 60.0")
    ok(rain_to_reach(76.2, 127.0, 90) == 38.1, "38.1 mm (1.50 in) more to reach 90")
    ok(rain_to_reach(120.0, 127.0, 90) == 0.0, "already past 90")
    ok(index_so_far(None, 127.0) is None and rain_to_reach(5, 0, 90) is None, "missing stays missing")
    # average for a year: a = 100.0 mm, indexes 1951..2024 all 1.000 except 2024 = 0.260
    idx = {y: 1000 for y in range(1951, 2026)}
    idx[2024] = 260
    ok(abs(average_for_year(1000, idx, 2027) - 100 * (74 + 0.26) / 75) < 1e-9, "2027 average uses 1951-2025")
    ok(abs(average_for_year(1000, idx, 2026) - 100 * (73 + 0.26) / 74) < 1e-9, "2026 average uses 1951-2024")
    del idx[1960]
    ok(average_for_year(1000, idx, 2026) is None, "a hole in the record gives no average")

    # totals: a missing day stops the interval, an undefined box empties one grid
    d0 = dt.date(2026, 9, 1)
    fields = {d0 + dt.timedelta(days=k): [1.0] * 10 + [None] * (CELLS - 10) for k in range(3)}
    tot = interval_totals(fields, [1, 2, 11], d0, d0 + dt.timedelta(days=2))
    ok(tot == {1: 3.0, 2: 3.0, 11: None}, f"totals {tot}")
    try:
        interval_totals(fields, [1], d0, d0 + dt.timedelta(days=3))
        ok(False, "a missing day did not stop the interval")
    except LookupError:
        pass

    # summary arithmetic
    rows = [{"g": 1, "y": 2025, "i": 0, "cpc": 90.0, "rma_avg": 100.0, "rma_idx": 0.95},
            {"g": 2, "y": 2025, "i": 0, "cpc": 110.0, "rma_avg": 100.0, "rma_idx": 1.0},
            {"g": 3, "y": 2025, "i": 1, "cpc": 50.0, "rma_avg": 50.0, "rma_idx": 1.02}]
    s = summarize(rows)
    ok(s["median_abs"] == 5.0 and s["median_diff"] == -2.0 and s["within5"] == 67 and s["n"] == 3, f"summary {s}")

    log("prf season selftest:", "ok" if not fails else f"{len(fails)} failure(s)")
    return not fails


def main():
    ap = argparse.ArgumentParser(description="PRF intervals so far from CPC daily rain")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--backtest-collect", metavar="OUT_DIR")
    ap.add_argument("--backtest-analyze", metavar="ROWS")
    ap.add_argument("--today", help="YYYY-MM-DD, for tests")
    args = ap.parse_args()
    if args.selftest:
        sys.exit(0 if selftest() else 1)
    if args.check:
        sys.exit(0 if check() else 1)
    if args.backtest_collect:
        backtest_collect(args.backtest_collect)
        return
    if args.backtest_analyze:
        backtest_analyze(args.backtest_analyze)
        return
    today = dt.date.fromisoformat(args.today) if args.today else None
    build(today)


if __name__ == "__main__":
    main()
