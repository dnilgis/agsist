#!/usr/bin/env python3
"""Seasonal forecast models, November starts, for the PRF optimizer's backtest.

Writes data/prf/seasonal-fc.json: for each model, its ensemble-mean
precipitation forecast for each PRF interval it reaches, started in November
of the year before the policy year, averaged over 2-degree boxes on the PRF
grid's own corner (20N 130W), in whole millimetres over the interval's two
months. Only boxes that hold a PRF grid. About 1 MB with every model in.
Never the models' own grids: those stay on the runner.

components/prf-optimize.js (seasonalRaw, zSeries, forecastSkill) reads it;
scripts/prf_opt_backtest.mjs tests each model, and their average, as a tilt
on the rate-led pick, only where and when the model's own earlier forecasts
tracked the index. The panel on /prf reads it only if one of them held up.

SOURCES
  NMME, through the IRI/LDEO Data Library (no key):
    https://iridl.ldeo.columbia.edu/SOURCES/.Models/.NMME/
    NOAA NCEP CFSv2, NOAA GFDL SPEAR, NASA GEOS-S2S, COLA-RSMAS CESM1,
    Environment Canada CanSIPS-IC4. Re-forecasts from 1982 (CFSv2), 1981
    (GEOS) or 1990-91 (the rest), real-time forecasts after. 1 degree, leads
    0.5 to 11.5 months (CFSv2 to 9.5, GEOS to 8.5). Monthly precipitation,
    mm/day. The exact datasets, and why, are listed at NMME below. NOAA
    CPC's real-time files fill a missing latest year.
  Copernicus C3S, through the Climate Data Store (needs the CDS_API_KEY
  secret; without it these are skipped and said so):
    https://cds.climate.copernicus.eu/datasets/seasonal-monthly-single-levels
    ECMWF SEAS5, UK Met Office, Meteo-France, DWD, CMCC, JMA. Re-forecasts
    1993-2016, real-time after, 6 months ahead, so a November start reaches
    Jan-Feb, Feb-Mar and Mar-Apr. Mean precipitation rate, m/s.
  NOAA's CFSv2 and Canada's CanSIPS are also on the CDS (as "ncep" and
  "eccc"); they are the same models, so they come from NMME only, where the
  record is longer, and are counted once in the test.

WHEN A NOVEMBER FORECAST IS OUT
  NMME about Nov 8-10, C3S on the 13th: both before the Dec 1 sales closing.

A model that fails or comes back thin keeps what was already published for it
(merge per model, never replace with less). Exit 1 if any source failed; what
did come back is written.

  python3 scripts/fetch_seasonal_models.py              # fetch and write
  python3 scripts/fetch_seasonal_models.py --only cfsv2,ecmwf
  python3 scripts/fetch_seasonal_models.py --minutes 40 # stop by then, whatever is left
  python3 scripts/fetch_seasonal_models.py --probe      # one cell from every path, 30 s each
  python3 scripts/fetch_seasonal_models.py --check      # validate the file
  python3 scripts/fetch_seasonal_models.py --selftest   # synthetic data, no network, no key

Fetching needs numpy, xarray, netCDF4 and (for C3S) cdsapi; the workflow
installs pinned versions. The selftest needs only the standard library.
"""
import calendar
import datetime as dt
import glob
import json
import math
import os
import sys
import tempfile
import time
import urllib.parse
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "data", "prf", "seasonal-fc.json")
MAX_BYTES = 2_000_000

LAT0, LON0, BOX_DEG = 20.0, -130.0, 2.0
AREA = {"north": 50.0, "south": 20.0, "west": -130.0, "east": -66.0}
INIT_MONTH = 11
N_INTERVALS = 11

# Each NMME model's datasets in the IRI/LDEO Data Library, as the Library's
# own catalog pages list them (checked Oct 2026):
#   https://iridl.ldeo.columbia.edu/SOURCES/.Models/.NMME/            (index)
#   .NCEP-CFSv2/.HINDCAST/.MONTHLY          24 members, starts 1982-2010
#   .NCEP-CFSv2/.FORECAST/.PENTAD_SAMPLES/.MONTHLY   starts Apr 2011 on,
#                                           "matching pattern of CFSv2 hindcast starts"
#   .GFDL-SPEAR/.HINDCAST/.MONTHLY          15 members, starts 1991-2020
#   .GFDL-SPEAR/.FORECAST/.MONTHLY          real time
#   .NASA-GEOSS2S/.HINDCAST/.MONTHLY        4 members, starts Feb 1981-2017, leads 0.5-8.5
#   .NASA-GEOSS2S/.FORECAST/.MONTHLY        10 members, starts Feb 2017 on
#   .COLA-RSMAS-CESM1/.MONTHLY              one set, hindcast and forecast: starts 1991 on
#   .CanSIPS-IC4/.HINDCAST/.MONTHLY and .FORECAST/.MONTHLY (CanESM5 + GEM5.2-NEMO);
#     each half also sits on its own (.CanSIPS-IC4/.CanESM5/..., .GEM5.2-NEMO/...),
#     and the two halves have the same member count, so their average is the
#     system's ensemble mean. That is the fallback.
# Variable .prec, mm/day; dimensions S (start, months since 1960-01-01),
# L (lead, 0.5 = the start month), M (member), X (0-359 E), Y.
#
# Each path carries the November starts it is documented to hold ("starts":
# first, last; None = still running), so a run never spends time asking a
# dataset for years it does not have. That was the old bug: every path was
# asked from 1982 and dropped after three empty years, so a set starting in
# 1991 was never read. Paths for the same years are fallbacks for each other.
# A model never mixes in a different system (CanSIPS-IC3 is not IC4).
#
# FALLBACK for the latest years: NOAA CPC's real-time NMME files over HTTPS,
#   https://ftp.cpc.ncep.noaa.gov/NMME/realtime_anom/ENSMEAN/YYYY110800/
#   <CPC name>.prate.YYYY11.ENSMEAN.fcst.nc   (full field, not the anomaly)
# netCDF from Nov 2022 (GRIB before). Used only for a November start the Data
# Library did not return, and only when the file's units and leads read
# cleanly. It holds no hindcasts, so it can never carry a model alone (see
# MIN_YEARS).
#
# leads: months from the start month, the start month being lead index 0.
NMME = {
    "cfsv2":   {"system": "NCEP-CFSv2", "leads": 10, "cpc": ["CFSv2"],
                "paths": [{"p": "NCEP-CFSv2/.HINDCAST/.MONTHLY", "starts": (1982, 2010)},
                          {"p": "NCEP-CFSv2/.FORECAST/.PENTAD_SAMPLES/.MONTHLY", "starts": (2011, None)},
                          {"p": "NCEP-CFSv2/.FORECAST/.EARLY_MONTH_SAMPLES/.MONTHLY", "starts": (2011, None)}]},
    "spear":   {"system": "GFDL-SPEAR", "leads": 12, "cpc": ["GFDL_SPEAR"],
                "paths": [{"p": "GFDL-SPEAR/.HINDCAST/.MONTHLY", "starts": (1991, 2020)},
                          {"p": "GFDL-SPEAR/.FORECAST/.MONTHLY", "starts": (2020, None)}]},
    "geos":    {"system": "NASA-GEOSS2S", "leads": 9, "cpc": ["NASA_GEOS5v2"],
                "paths": [{"p": "NASA-GEOSS2S/.HINDCAST/.MONTHLY", "starts": (1981, 2016)},
                          {"p": "NASA-GEOSS2S/.FORECAST/.MONTHLY", "starts": (2017, None)}]},
    "cesm":    {"system": "COLA-RSMAS-CESM1", "leads": 12, "cpc": ["COLA-RSMAS-CESM1"],
                "paths": [{"p": "COLA-RSMAS-CESM1/.MONTHLY", "starts": (1991, None)}]},
    "cansips": {"system": "CanSIPS-IC4", "leads": 12, "cpc": ["CanESM5", "GEM5.2_NEMO"],
                "paths": [{"p": "CanSIPS-IC4/.HINDCAST/.MONTHLY", "starts": (1990, 2020)},
                          {"p": "CanSIPS-IC4/.FORECAST/.MONTHLY", "starts": (2021, None)},
                          {"p": ["CanSIPS-IC4/.CanESM5/.HINDCAST/.MONTHLY", "CanSIPS-IC4/.GEM5.2-NEMO/.HINDCAST/.MONTHLY"],
                           "starts": (1990, 2020)},
                          {"p": ["CanSIPS-IC4/.CanESM5/.FORECAST/.MONTHLY", "CanSIPS-IC4/.GEM5.2-NEMO/.FORECAST/.MONTHLY"],
                           "starts": (2021, None)}]},
}
NMME_BASE = "https://iridl.ldeo.columbia.edu/SOURCES/.Models/.NMME/"
CPC_BASE = "https://ftp.cpc.ncep.noaa.gov/NMME/realtime_anom/ENSMEAN/"
CPC_FIRST_NC = 2022          # November starts before this are GRIB only
NMME_FIRST = 1982
MIN_YEARS = 10               # fewer November starts than this is a failure, not a model
PROBE_POINT = (267.0, 42.0)  # one Data Library cell in central Iowa (X east, Y)

# Time limits, so a dead path can never eat the run. A whole fetch stops at
# --minutes (default 40; the workflow step is capped at 45); each model gets
# a fair share of what is left when its turn comes.
T_BLOCK, T_YEAR, T_PROBE = 240, 75, 30     # seconds per request
DEFAULT_MINUTES = 40

C3S = {
    "ecmwf":       {"centre": "ecmwf", "system": "51"},
    "ukmo":        {"centre": "ukmo", "system": "604"},
    "meteofrance": {"centre": "meteo_france", "system": "9"},
    "dwd":         {"centre": "dwd", "system": "22"},
    "cmcc":        {"centre": "cmcc", "system": "35"},
    "jma":         {"centre": "jma", "system": "3"},
}
C3S_FIRST, C3S_LEADS = 1993, 6
C3S_DATASET = "seasonal-monthly-single-levels"


def log(*a):
    print(*a, flush=True)


# ---------------------------------------------------------------- pure reduction (selftested)
def reachable_intervals(leads):
    """Interval i covers months i+1 and i+2 of the policy year. From a
    November start, month m of the policy year is lead index m + 1 (Nov 0,
    Dec 1, Jan 2), so interval i needs lead indices i+2 and i+3."""
    return [i for i in range(N_INTERVALS) if i + 3 <= leads - 1]


def lead_month(policy_year, lead):
    """(year, month) of lead index `lead` for the forecast started November of policy_year - 1."""
    m = INIT_MONTH + lead
    y = policy_year - 1 + (m - 1) // 12
    return y, (m - 1) % 12 + 1


def box_key(lat, lon):
    if not (AREA["south"] <= lat < AREA["north"] and AREA["west"] <= lon < AREA["east"]):
        return None
    return "%d_%d" % (int((lat - LAT0) // BOX_DEG), int((lon - LON0) // BOX_DEG))


def grid_box(grid_id):
    """the 2-degree box of a PRF quarter-degree grid (300 across, from 20N 130W)"""
    row, col = (grid_id - 1) // 300, (grid_id - 1) % 300
    return "%d_%d" % (row // 8, col // 8)


def prf_boxes(root=ROOT):
    boxes = set()
    for f in glob.glob(os.path.join(root, "data", "prf", "g", "*.json")):
        with open(f) as fh:
            for gid in json.load(fh)["g"]:
                boxes.add(grid_box(int(gid)))
    return boxes


def to_lon180(lon):
    return ((lon + 180.0) % 360.0) - 180.0


def box_means(field, lats, lons, keep):
    """field[j][k] in mm for one month on lats[j], lons[k]; mean of the finite
    cells whose centres fall in each kept box."""
    acc = {}
    for j, la in enumerate(lats):
        for k, lo in enumerate(lons):
            v = field[j][k]
            if v is None or v != v:
                continue
            b = box_key(float(la), to_lon180(float(lo)))
            if b is None or b not in keep:
                continue
            s = acc.setdefault(b, [0.0, 0])
            s[0] += float(v)
            s[1] += 1
    return {b: s[0] / s[1] for b, s in acc.items() if s[1]}


def monthly_mm(rate, unit, year, month):
    days = calendar.monthrange(year, month)[1]
    if unit == "mm/day":
        return rate * days
    if unit == "m/s":
        return rate * 1000.0 * 86400.0 * days
    raise ValueError("unknown unit " + unit)


def interval_totals(per_lead, policy_year, leads):
    """per_lead[lead] = { box: mm in that month }. Returns { box: { i: mm } }."""
    out = {}
    for i in reachable_intervals(leads):
        a, b = per_lead.get(i + 2), per_lead.get(i + 3)
        if not a or not b:
            continue
        for box in a:
            if box in b:
                out.setdefault(box, {})[i] = a[box] + b[box]
    return out


B36 = "0123456789abcdefghijklmnopqrstuvwxyz"


def enc(v):
    if v is None or v != v:
        return "--"
    n = max(0, min(1295, int(round(v))))
    return B36[n // 36] + B36[n % 36]


def dec(c):
    return None if c == "--" else int(c, 36)


def encode_model(by_year, intervals, boxes):
    """by_year[year] = { box: { i: mm } } -> { first, last, intervals, v }"""
    years = sorted(y for y in by_year if by_year[y])
    if not years:
        return None
    first, last = years[0], years[-1]
    v = {}
    for box in sorted(boxes):
        s = "".join(enc(by_year.get(y, {}).get(box, {}).get(i)) for y in range(first, last + 1) for i in intervals)
        if s.strip("-"):
            v[box] = s
    return {"first": first, "last": last, "intervals": intervals, "v": v}


def merge(old, new):
    """per model, never replace with less: a model comes back with fewer years
    or boxes than published, the published one stays"""
    out = dict(old or {})
    for k, m in (new or {}).items():
        o = out.get(k)
        if o and (m["last"] - m["first"] < o["last"] - o["first"] or len(m["v"]) < 0.9 * len(o["v"])):
            log("  %s: came back with less than published (%d-%d, %d boxes vs %d-%d, %d); kept the published one"
                % (k, m["first"], m["last"], len(m["v"]), o["first"], o["last"], len(o["v"])))
            continue
        out[k] = m
    return out


def check(doc, raw_len=None):
    errs = []
    if doc.get("v") != 1 or doc.get("box_deg") != BOX_DEG or doc.get("init_month") != INIT_MONTH:
        errs.append("header")
    for k, m in (doc.get("models") or {}).items():
        if k not in NMME and k not in C3S:
            errs.append(k + ": not a declared model")
        L = (m["last"] - m["first"] + 1) * len(m["intervals"]) * 2
        if not m["intervals"] or any(not (0 <= i < N_INTERVALS) for i in m["intervals"]):
            errs.append(k + ": intervals")
        for b, s in m["v"].items():
            if len(s) != L:
                errs.append("%s %s: length %d, want %d" % (k, b, len(s), L))
                break
            for j in range(0, L, 2):
                c = s[j:j + 2]
                if c != "--" and not all(ch in B36 for ch in c):
                    errs.append("%s %s: bad value %r" % (k, b, c))
                    break
    if raw_len is not None and raw_len > MAX_BYTES:
        errs.append("file is %d bytes, over %d" % (raw_len, MAX_BYTES))
    return errs


def write(models, path=OUT):
    doc = {
        "v": 1,
        "written_by": "scripts/fetch_seasonal_models.py",
        "box_deg": BOX_DEG,
        "init_month": INIT_MONTH,
        "what": "Seasonal forecast models started in November, for the policy year after: ensemble-mean precipitation over each PRF interval's two months, "
                "whole millimetres, averaged over 2-degree boxes counted from 20N 130W (row_col). Two base-36 characters per year and interval, '--' missing.",
        "written": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "models": {k: models[k] for k in sorted(models)},
    }
    raw = json.dumps(doc, separators=(",", ":"), ensure_ascii=False) + "\n"
    errs = check(doc, len(raw.encode()))
    if errs:
        raise SystemExit("refusing to write: " + "; ".join(errs[:5]))
    tmp = path + ".tmp"
    with open(tmp, "w") as fh:
        fh.write(raw)
    os.replace(tmp, path)
    return len(raw)


class OutOfTime(Exception):
    pass


class Clock:
    """the run's deadline, and each model's share of it"""

    def __init__(self, minutes, now=time.monotonic):
        self.now = now
        self.end = now() + minutes * 60.0
        self.until = self.end

    def left(self):
        return max(0.0, self.until - self.now())

    def share(self, models_left):
        """give the next model an equal part of what is left"""
        self.until = self.now() + (self.end - self.now()) / max(1, models_left)
        return self.left()

    def timeout(self, t):
        left = self.left()
        if left < 5:
            raise OutOfTime("out of time")
        return min(t, left)


NO_CLOCK = Clock(10 ** 6)


# ---------------------------------------------------------------- Data Library URLs (selftested)
def lib_sel_starts(first, last):
    """the S selection: one November, or every November first..last in one go.
    Ingrid tokens are separated by slashes: (0000 1 Nov 1996)/VALUES, not
    (0000 1 Nov 1996)VALUES (the second run's probe got "Bad Request" pages).
    Several Novembers: the range of starts, then every 12th start."""
    if first == last:
        return "S/(0000 1 Nov %d)/VALUES/" % first
    return "S/(0000 1 Nov %d)/(0000 1 Nov %d)/RANGEEDGES/S/12/STEP/" % (first, last)


def lib_url(path, first, last, leads, point=None):
    """ensemble mean of .prec for November starts first..last (start years),
    every lead, over the PRF area (or one cell, for a probe), as netCDF"""
    if point:
        where = "X/(%g)/VALUES/Y/(%g)/VALUES/" % point
        lsel = "L/(0.5)/VALUES/"
    else:
        where = "X/(%g)/(%g)/RANGEEDGES/Y/(%g)/(%g)/RANGEEDGES/" % (AREA["west"] + 360, AREA["east"] + 360, AREA["south"], AREA["north"])
        lsel = "L/(0.5)/(%.1f)/RANGE/" % (leads - 0.5)
    # The Library's dates have spaces in them, "(0000 1 Nov 1990)". Sent raw,
    # Python refuses the URL before it leaves the runner ("URL can't contain
    # control characters"): that, retried with sleeps, was the first run's
    # hour and a half of nothing. They go as %20.
    # Every Data Library entry name starts with a dot: .NMME/.GFDL-SPEAR, not
    # .NMME/GFDL-SPEAR (the first run also dropped that dot).
    q = "." + path + "/.prec/" + lib_sel_starts(first, last) + lsel + where + "[M]average/data.nc"
    return NMME_BASE + urllib.parse.quote(q, safe="/().-_[]")


def cpc_url(name, start_year):
    return "%s%d110800/%s.prate.%d11.ENSMEAN.fcst.nc" % (CPC_BASE, start_year, name, start_year)


def months_since_to_ym(v, units):
    """an S value in the Data Library's 'months since 1960-01-01' -> (year, month)"""
    w = (units or "").lower().replace("-", " ").split()
    if len(w) < 4 or w[0] != "months" or w[1] != "since":
        raise ValueError("S units " + repr(units))
    y0, m0 = int(w[2]), int(w[3])
    total = y0 * 12 + (m0 - 1) + math.floor(float(v) + 1e-6)
    return total // 12, total % 12 + 1


def start_years(path_starts, last_start):
    """the November starts to ask a path for: what it is documented to hold,
    within the years the test uses"""
    a, b = path_starts
    a = max(a, NMME_FIRST - 1)
    b = last_start if b is None else min(b, last_start)
    return list(range(a, b + 1)) if a <= b else []


def runs(years):
    """[1990, 1991, 1992, 1995] -> [(1990, 1992), (1995, 1995)]"""
    out = []
    for y in sorted(years):
        if out and y == out[-1][1] + 1:
            out[-1] = (out[-1][0], y)
        else:
            out.append((y, y))
    return out


def average_halves(a, b):
    """two halves of one system with equal members, each {start: {lead: {box: mm}}}:
    their mean, only where both have the value"""
    out = {}
    for y in a:
        if y not in b:
            continue
        for lead, boxes in a[y].items():
            other = b[y].get(lead)
            if not other:
                continue
            m = {k: (v + other[k]) / 2.0 for k, v in boxes.items() if k in other}
            if m:
                out.setdefault(y, {})[lead] = m
    return out


def unit_scale(units):
    """precipitation units -> factor to mm/day, or None when unknown"""
    u = (units or "").lower().replace(" ", "")
    if u in ("mm/day", "mm/d", "mmday-1", "mm/24hr", "mmd-1"):
        return 1.0
    if u in ("kgm-2s-1", "kg/m2/s", "kg/m^2/s", "mm/s", "kgm**-2s**-1"):
        return 86400.0
    return None


# ---------------------------------------------------------------- fetching (runner only)
RETRY_CODES = (429, 500, 502, 503, 504)


def http_get(url, timeout, clock=NO_CLOCK, tries=2, headers=None):
    """one GET with a hard timeout; retried once only on a timeout or a
    server-busy answer, never on a 'not here' (404) or a refused request"""
    import urllib.error
    last = None
    for t in range(tries):
        h = {"User-Agent": "agsist.com PRF backtest (+https://agsist.com/prf)"}
        h.update(headers or {})
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=clock.timeout(timeout)) as r:
                return r.status, r.read(), dict(r.headers)
        except urllib.error.HTTPError as e:
            body = b""
            try:
                body = e.read()[:400]
            except Exception:  # noqa: BLE001
                pass
            last = RuntimeError("HTTP %d %s" % (e.code, body.decode("utf8", "replace").replace("\n", " ")[:160]))
            last.code = e.code
            if e.code not in RETRY_CODES:
                raise last
        except OutOfTime:
            raise
        except Exception as e:  # noqa: BLE001 - timeouts, resets
            last = e
        if t + 1 < tries:
            time.sleep(5)
    raise last


def nc_open(blob):
    import xarray as xr  # noqa: E402 - runner only
    if blob[:3] != b"CDF" and blob[:4] != b"\x89HDF":
        raise RuntimeError("not netCDF: " + blob[:120].decode("utf8", "replace").replace("\n", " "))
    f = tempfile.NamedTemporaryFile(suffix=".nc", delete=False)
    f.write(blob)
    f.close()
    return xr.open_dataset(f.name, decode_times=False), f.name


def lib_read(blob, first, last, leads, keep):
    """a Data Library netCDF of .prec (mm/day) -> {start year: {lead: {box: mm}}}"""
    ds, fn = nc_open(blob)
    try:
        da = ds["prec"]
        lats, lons = da["Y"].values.tolist(), da["X"].values.tolist()
        if "S" in da.dims:
            svals = da["S"].values.tolist()
            units = da["S"].attrs.get("units", "")
        else:
            svals, units = [None], ""
        out = {}
        for si, sv in enumerate(svals):
            if sv is None:
                if first != last:
                    raise RuntimeError("no S in a reply for several starts")
                year = first
            else:
                year, month = months_since_to_ym(sv, units)
                if month != INIT_MONTH:
                    continue
            sub = da.isel(S=si) if "S" in da.dims else da
            per_lead = {}
            for li, L in enumerate(sub["L"].values.tolist()):
                lead = int(round(L - 0.5))
                if lead >= leads:
                    continue
                y, m = lead_month(year + 1, lead)
                fld = sub.isel(L=li).transpose("Y", "X").values * calendar.monthrange(y, m)[1]
                per_lead[lead] = box_means(fld.tolist(), lats, lons, keep)
            if any(per_lead.values()):
                out[year] = per_lead
        return out
    finally:
        ds.close()
        os.unlink(fn)


def lib_fetch_path(path, years, leads, keep, clock, errs):
    """every November start in `years` from one Data Library path: all at
    once first, then year by year for whatever that missed. Stops a path
    after three misses in a row with nothing back."""
    got = {}
    for a, b in runs(years):
        try:
            _, blob, _ = http_get(lib_url(path, a, b, leads), T_BLOCK, clock)
            got.update(lib_read(blob, a, b, leads, keep))
        except OutOfTime:
            raise
        except Exception as e:  # noqa: BLE001 - logged; year by year next
            errs.append("%s %d-%d at once: %s" % (path, a, b, str(e)[:160]))
    misses = 0
    for y in years:
        if y in got:
            continue
        try:
            _, blob, _ = http_get(lib_url(path, y, y, leads), T_YEAR, clock)
            got.update(lib_read(blob, y, y, leads, keep))
            misses = 0
        except OutOfTime:
            raise
        except Exception as e:  # noqa: BLE001
            misses += 1
            errs.append("%s %d: %s" % (path, y, str(e)[:160]))
            if misses >= 3 and not got:
                errs.append("%s: three misses in a row, nothing back; next path" % path)
                break
    return got


def cpc_read(blob, start_year, leads, keep):
    """CPC's real-time ensemble-mean forecast file -> {lead: {box: mm}}, or
    an error when it does not read cleanly (units, leads, dimensions)"""
    ds, fn = nc_open(blob)
    try:
        cands = [v for v in ds.data_vars if len(ds[v].dims) >= 3]
        if not cands:
            raise RuntimeError("no gridded variable")
        da = ds[cands[0]]
        dims = list(da.dims)
        lat = next((d for d in dims if d.lower() in ("lat", "latitude", "y")), None)
        lon = next((d for d in dims if d.lower() in ("lon", "longitude", "x")), None)
        if not lat or not lon:
            raise RuntimeError("no lat/lon in %s" % dims)
        scale = unit_scale(da.attrs.get("units"))
        if scale is None:
            raise RuntimeError("units %r not read" % da.attrs.get("units"))
        for d in dims:
            if d not in (lat, lon) and da.sizes[d] == 1:
                da = da.isel({d: 0})
        rest = [d for d in da.dims if d not in (lat, lon)]
        if len(rest) != 1 or not (6 <= da.sizes[rest[0]] <= 12):
            raise RuntimeError("dimensions %s not read as leads" % dict(da.sizes))
        ld = rest[0]
        lats, lons = da[lat].values.tolist(), da[lon].values.tolist()
        per_lead = {}
        for lead in range(min(leads, da.sizes[ld])):
            y, m = lead_month(start_year + 1, lead)
            fld = da.isel({ld: lead}).transpose(lat, lon).values * scale * calendar.monthrange(y, m)[1]
            per_lead[lead] = box_means(fld.tolist(), lats, lons, keep)
        return per_lead
    finally:
        ds.close()
        os.unlink(fn)


def fetch_nmme(key, cfg, keep, last_year, clock=NO_CLOCK):
    """one model: each documented path for its own years, fallbacks for the
    years a path did not return, CPC for the latest starts still missing"""
    leads, last_start = cfg["leads"], last_year - 1
    by_start, used, errs = {}, [], []
    try:
        for entry in cfg["paths"]:
            want = [y for y in start_years(entry["starts"], last_start) if y not in by_start]
            if not want:
                continue
            paths = entry["p"] if isinstance(entry["p"], list) else [entry["p"]]
            parts = [lib_fetch_path(p, want, leads, keep, clock, errs) for p in paths]
            got = parts[0] if len(parts) == 1 else average_halves(parts[0], parts[1])
            if got:
                by_start.update(got)
                used.append("%s (%d starts)" % (" + ".join(paths), len(got)))
        missing = [y for y in range(max(CPC_FIRST_NC, NMME_FIRST - 1), last_start + 1) if y not in by_start]
        for y in missing:
            halves = []
            for name in cfg["cpc"]:
                try:
                    _, blob, _ = http_get(cpc_url(name, y), T_YEAR, clock)
                    halves.append({y: cpc_read(blob, y, leads, keep)})
                except OutOfTime:
                    raise
                except Exception as e:  # noqa: BLE001
                    errs.append("CPC %s %d: %s" % (name, y, str(e)[:160]))
                    break
            if len(halves) == len(cfg["cpc"]):
                got = halves[0] if len(halves) == 1 else average_halves(halves[0], halves[1])
                if got.get(y) and any(got[y].values()):
                    by_start[y] = got[y]
                    used.append("CPC %s %d" % ("+".join(cfg["cpc"]), y))
    except OutOfTime:
        errs.append("out of time: this model's share of the run ran out")
    for e in errs[:12]:
        log("    " + e)
    if len(errs) > 12:
        log("    ... %d more" % (len(errs) - 12))
    by_year = {}
    for s, per in by_start.items():
        tot = interval_totals(per, s + 1, leads)
        if tot:
            by_year[s + 1] = tot
    if len(by_year) < MIN_YEARS:
        raise RuntimeError("%d November starts came back (%s); need %d" % (len(by_year), "; ".join(used) or "no path answered", MIN_YEARS))
    m = encode_model(by_year, reachable_intervals(leads), keep)
    m.update({"source": "NMME, IRI/LDEO Data Library" + (" and NOAA CPC" if any(u.startswith("CPC") for u in used) else ""),
              "system": cfg["system"], "url": NMME_BASE + "." + cfg["system"] + "/", "paths": used})
    return m


# ---------------------------------------------------------------- probe
def probe(only=None, last_year=None):
    """one start, one lead, one cell from every path, 30 s each: which answer"""
    if last_year is None:
        last_year = default_last_year(dt.date.today())
    last_start = last_year - 1
    dead = []
    for k, cfg in NMME.items():
        if only and k not in only:
            continue
        ok = False
        for entry in cfg["paths"]:
            ys = start_years(entry["starts"], last_start - 1)     # last year's start is surely out
            if not ys:
                continue
            for p in (entry["p"] if isinstance(entry["p"], list) else [entry["p"]]):
                for label, a, b in (("one start", ys[len(ys) // 2], ys[len(ys) // 2]), ("all starts", ys[0], ys[-1])):
                    url = lib_url(p, a, b, cfg["leads"], point=PROBE_POINT)
                    ok |= probe_one("%-8s %-46s %-10s %d-%d" % (k, p, label, a, b), url)
        for name in cfg["cpc"]:
            ok |= probe_one("%-8s %-46s %-10s %d" % (k, "CPC " + name, "one start", last_start - 1),
                            cpc_url(name, last_start - 1), headers={"Range": "bytes=0-1023"})
        if not ok:
            dead.append(k)
    log("CDS_API_KEY is %s (the Copernicus models are not probed)." % ("set" if os.environ.get("CDS_API_KEY", "").strip() else "not set"))
    log("no path answered for: " + ", ".join(dead) if dead else "every NMME model has a path that answered")
    return 1 if dead else 0


def probe_one(label, url, headers=None):
    t0 = time.monotonic()
    try:
        status, blob, hdr = http_get(url, T_PROBE, tries=1, headers=headers)
        size = hdr.get("Content-Range", "").split("/")[-1] or str(len(blob))
        kind = "netCDF" if blob[:3] == b"CDF" or blob[:4] == b"\x89HDF" else "NOT netCDF: " + blob[:60].decode("utf8", "replace").replace("\n", " ")
        log("  %s %s  HTTP %d, %s bytes, %s, %.1f s" % ("OK  " if kind == "netCDF" else "FAIL", label, status, size, kind, time.monotonic() - t0))
        return kind == "netCDF"
    except Exception as e:  # noqa: BLE001
        log("  FAIL %s  %s, %.1f s" % (label, str(e)[:140], time.monotonic() - t0))
        log("       " + url)
        return False


def default_last_year(today):
    """a policy year's November start is out by the 14th (C3S posts on the 13th)"""
    return today.year + 1 if (today.month == 11 and today.day >= 14) or today.month == 12 else today.year


def fetch_c3s(key, cfg, keep, last_year, api_key, clock=NO_CLOCK):
    import cdsapi  # noqa: E402 - runner only
    import xarray as xr  # noqa: E402 - runner only
    c = cdsapi.Client(url="https://cds.climate.copernicus.eu/api", key=api_key, quiet=True, progress=False)
    by_year = {}
    for y0 in range(C3S_FIRST, last_year + 1, 6):
        years = [str(y - 1) for y in range(y0, min(y0 + 6, last_year + 1))]
        try:
            clock.timeout(60)
        except OutOfTime:
            log("  %s: out of time before %s-%s; stopped there" % (key, years[0], years[-1]))
            break
        fn = tempfile.NamedTemporaryFile(suffix=".nc", delete=False).name
        try:
            c.retrieve(C3S_DATASET, {
                "originating_centre": cfg["centre"], "system": cfg["system"], "variable": "total_precipitation",
                "product_type": "monthly_mean", "year": years, "month": "%02d" % INIT_MONTH,
                "leadtime_month": [str(i) for i in range(1, C3S_LEADS + 1)],
                "area": [AREA["north"], AREA["west"], AREA["south"], AREA["east"]], "data_format": "netcdf",
            }, fn)
        except Exception as e:  # noqa: BLE001 - a year block the system does not hold
            log("  %s %s-%s: %s" % (key, years[0], years[-1], str(e).splitlines()[0][:160]))
            continue
        ds = xr.open_dataset(fn)
        try:
            var = "tprate" if "tprate" in ds else list(ds.data_vars)[0]
            da = ds[var]
            if "number" in da.dims:
                da = da.mean("number")
            tdim = "forecast_reference_time" if "forecast_reference_time" in da.dims else "time"
            ldim = "forecastMonth" if "forecastMonth" in da.dims else "leadtime_month"
            lats, lons = da["latitude"].values.tolist(), da["longitude"].values.tolist()
            for ti, tv in enumerate(da[tdim].values):
                start_year = int(str(tv)[:4])
                py = start_year + 1
                per_lead = {}
                for li, lm in enumerate(da[ldim].values.tolist()):
                    lead = int(lm) - 1        # leadtime_month 1 is the start month
                    y, m = lead_month(py, lead)
                    fld = da.isel({tdim: ti, ldim: li}).values.tolist()
                    fld = [[None if v != v else monthly_mm(v, "m/s", y, m) for v in row] for row in fld]
                    per_lead[lead] = box_means(fld, lats, lons, keep)
                tot = interval_totals(per_lead, py, C3S_LEADS)
                if tot:
                    by_year[py] = tot
        finally:
            ds.close()
            os.unlink(fn)
    m = encode_model(by_year, reachable_intervals(C3S_LEADS), keep)
    if not m:
        raise RuntimeError("no November start came back")
    m.update({"source": "Copernicus C3S, Climate Data Store", "system": "%s system %s" % (cfg["centre"], cfg["system"]),
              "url": "https://cds.climate.copernicus.eu/datasets/" + C3S_DATASET})
    return m


def main(argv):
    if "--selftest" in argv:
        return selftest()
    if "--check" in argv:
        if not os.path.exists(OUT):
            log("no file yet: " + OUT)
            return 0
        raw = open(OUT).read()
        errs = check(json.loads(raw), len(raw.encode()))
        log("ok" if not errs else "FAILED: " + "; ".join(errs))
        return 1 if errs else 0
    only = None
    if "--only" in argv:
        only = set(argv[argv.index("--only") + 1].split(","))
    if "--probe" in argv:
        return probe(only)
    minutes = float(argv[argv.index("--minutes") + 1]) if "--minutes" in argv else DEFAULT_MINUTES
    clock = Clock(minutes)
    old = json.load(open(OUT))["models"] if os.path.exists(OUT) else {}
    keep = prf_boxes()
    last_year = default_last_year(dt.date.today())
    api_key = os.environ.get("CDS_API_KEY", "").strip()
    todo = [("nmme", k, cfg) for k, cfg in NMME.items() if not only or k in only]
    if not api_key:
        log("CDS_API_KEY is not set: the Copernicus models (%s) are skipped, not failed." % ", ".join(C3S))
    else:
        todo += [("c3s", k, cfg) for k, cfg in C3S.items() if not only or k in only]
    log("boxes holding a PRF grid: %d; policy years up to %d; %g minutes for %d models" % (len(keep), last_year, minutes, len(todo)))
    new, failed = {}, []
    for n, (src, k, cfg) in enumerate(todo):
        share = clock.share(len(todo) - n)
        t0 = time.monotonic()
        log("  %s: up to %.0f s" % (k, share))
        try:
            if src == "nmme":
                new[k] = fetch_nmme(k, cfg, keep, last_year, clock)
            else:
                new[k] = fetch_c3s(k, cfg, keep, last_year, api_key, clock)
            log("  %s: %d-%d, %d boxes, intervals %s, %.0f s" % (k, new[k]["first"], new[k]["last"], len(new[k]["v"]), new[k]["intervals"], time.monotonic() - t0))
        except Exception as e:  # noqa: BLE001
            failed.append(k)
            log("  %s: FAILED %s (%.0f s)" % (k, str(e)[:300], time.monotonic() - t0))
    models = merge(old, new)
    if models:
        n = write(models)
        log("wrote %s (%d bytes, %d models)" % (OUT, n, len(models)))
    else:
        log("nothing to write")
    return 1 if failed else 0


# ---------------------------------------------------------------- selftest
def selftest():
    assert reachable_intervals(12) == list(range(9)), reachable_intervals(12)        # NMME: through Sep-Oct
    assert reachable_intervals(10) == list(range(7))                                  # CFSv2: through Jul-Aug
    assert reachable_intervals(6) == [0, 1, 2]                                        # C3S: Jan-Feb to Mar-Apr
    assert lead_month(2001, 0) == (2000, 11) and lead_month(2001, 2) == (2001, 1) and lead_month(2001, 11) == (2001, 10)
    assert grid_box(30454) == "12_19" and box_key(45.3, -91.7) == "12_19" and box_key(51, -100) is None
    assert to_lon180(268.25) == -91.75
    assert monthly_mm(2.0, "mm/day", 2001, 2) == 56.0 and abs(monthly_mm(1e-8, "m/s", 2000, 2) - 25.056) < 1e-9
    # a synthetic model: two boxes, 1-degree cells, mm/day = box row + lead/10 + year/1000
    keep = {"12_19", "5_10"}
    lats = [45.5, 44.5, 30.5, 31.5, 49.5]
    lons = [268.5, 269.5, 250.5, 251.5]
    by_year = {}
    for year in range(1982, 1995):
        per = {}
        for lead in range(12):
            y, m = lead_month(year, lead)
            fld = [[(la - 20) // 2 + lead / 10 + year / 1000 if not (la == 49.5) else float("nan") for lo in lons] for la in lats]
            fld = [[v * calendar.monthrange(y, m)[1] for v in row] for row in fld]
            per[lead] = box_means(fld, lats, [lo - 360 if lo > 180 else lo for lo in lons], keep)
        by_year[year] = interval_totals(per, year, 12)
    assert set(by_year[1990]) == keep, by_year[1990].keys()
    jf = by_year[1990]["12_19"][0]                    # Jan + Feb 1990: leads 2 and 3
    want = (12 + 0.2 + 1.990) * 31 + (12 + 0.3 + 1.990) * 28
    assert abs(jf - want) < 1e-9, (jf, want)
    m = encode_model(by_year, reachable_intervals(12), keep | {"0_0"})
    assert m["first"] == 1982 and m["last"] == 1994 and "0_0" not in m["v"]
    s = m["v"]["12_19"]
    j = ((1990 - 1982) * 9 + 0) * 2
    assert dec(s[j:j + 2]) == round(want), (dec(s[j:j + 2]), want)
    assert enc(None) == "--" and enc(-4) == "00" and enc(5000) == "zz" and dec("zz") == 1295
    # merge never replaces with less
    shorter = dict(m, first=1990)
    assert merge({"cfsv2": m}, {"cfsv2": shorter})["cfsv2"] is m
    longer = dict(m, first=1980)
    assert merge({"cfsv2": m}, {"cfsv2": longer})["cfsv2"] is longer
    # writes a file that passes the check, and the JS reader agrees (same layout)
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "fc.json")
        n = write({"cfsv2": dict(m, source="synthetic", system="test")}, p)
        doc = json.load(open(p))
        assert not check(doc, n) and n < MAX_BYTES
        bad = json.loads(json.dumps(doc))
        bad["models"]["cfsv2"]["v"]["12_19"] = bad["models"]["cfsv2"]["v"]["12_19"][:-2]
        assert check(bad), "a short row is caught"
        bad["models"]["nope"] = bad["models"].pop("cfsv2")
        assert any("not a declared model" in e for e in check(bad))
    # the published file, if any, passes
    if os.path.exists(OUT):
        raw = open(OUT).read()
        assert not check(json.loads(raw), len(raw.encode())), check(json.loads(raw), len(raw.encode()))
    # the Data Library requests: documented datasets, November starts, every lead, ensemble mean
    u = lib_url("GFDL-SPEAR/.HINDCAST/.MONTHLY", 1991, 2020, 12)
    assert u.startswith("https://iridl.ldeo.columbia.edu/SOURCES/.Models/.NMME/.GFDL-SPEAR/.HINDCAST/.MONTHLY/.prec/"), u
    assert u == (NMME_BASE + ".GFDL-SPEAR/.HINDCAST/.MONTHLY/.prec/S/(0000%201%20Nov%201991)/(0000%201%20Nov%202020)/RANGEEDGES/S/12/STEP/L/(0.5)/(11.5)/RANGE/"
                 "X/(230)/(294)/RANGEEDGES/Y/(20)/(50)/RANGEEDGES/[M]average/data.nc"), u
    assert "S/(0000%201%20Nov%202005)/VALUES/" in lib_url("x", 2005, 2005, 10)
    # every URL can be sent: no spaces or control characters (the first run's failure)
    for k, cfg in NMME.items():
        for e in cfg["paths"]:
            for p in (e["p"] if isinstance(e["p"], list) else [e["p"]]):
                for url in (lib_url(p, 1991, 2020, cfg["leads"]), lib_url(p, 2005, 2005, cfg["leads"], point=PROBE_POINT)):
                    assert not any(ch <= " " or ch == "\x7f" for ch in url), url
                    urllib.request.Request(url)       # urllib's own check passes
    pu = lib_url("x", 2005, 2005, 10, point=PROBE_POINT)
    assert "L/(0.5)/VALUES/X/(267)/VALUES/Y/(42)/VALUES/[M]average/data.nc" in pu and "RANGE" not in pu
    assert cpc_url("CFSv2", 2023) == CPC_BASE + "2023110800/CFSv2.prate.202311.ENSMEAN.fcst.nc"
    assert months_since_to_ym(370, "months since 1960-01-01") == (1990, 11)
    assert months_since_to_ym(370.0, "months since 1960-01-01 00:00:00") == (1990, 11)
    assert months_since_to_ym(0, "months since 1960-1-1") == (1960, 1)
    try:
        months_since_to_ym(370, "days since 1960-01-01")
        raise AssertionError("days are not months")
    except ValueError:
        pass
    for k, cfg in NMME.items():
        for e in cfg["paths"]:
            for p in (e["p"] if isinstance(e["p"], list) else [e["p"]]):
                assert p.startswith(cfg["system"] + "/."), (k, p)        # never another system
        assert cfg["cpc"] and 1 <= len(cfg["cpc"]) <= 2 and 6 <= cfg["leads"] <= 12
    # each path is asked only for its own years, never past the latest start
    assert start_years((1991, 2020), 2025) == list(range(1991, 2021))
    assert start_years((2021, None), 2025) == [2021, 2022, 2023, 2024, 2025]
    assert start_years((1981, 2016), 2025)[0] == NMME_FIRST - 1
    assert start_years((2027, None), 2025) == []
    assert runs([1990, 1991, 1992, 1995, 1997, 1998]) == [(1990, 1992), (1995, 1995), (1997, 1998)] and runs([]) == []
    # the old bug: a set starting in 1991 is asked for 1991 on, not dropped after 1982-1984 came back empty
    assert NMME["spear"]["paths"][0]["starts"][0] == 1991 and NMME["cesm"]["paths"][0]["p"] == "COLA-RSMAS-CESM1/.MONTHLY"
    # two halves of CanSIPS: mean where both have the value, nothing where one is missing
    ha = {2000: {2: {"a": 10.0, "b": 4.0}}, 2001: {2: {"a": 1.0}}}
    hb = {2000: {2: {"a": 20.0}, 3: {"a": 1.0}}}
    assert average_halves(ha, hb) == {2000: {2: {"a": 15.0}}}
    assert unit_scale("mm/day") == 1.0 and unit_scale("kg m-2 s-1") == 86400.0 and unit_scale("inches") is None
    # the clock: a model gets its share of what is left, and a request past the deadline is refused
    tick = [0.0]
    c = Clock(10, now=lambda: tick[0])
    assert abs(c.share(4) - 150.0) < 1e-9
    assert c.timeout(240) == 150.0
    tick[0] = 148.0
    try:
        c.timeout(30)
        raise AssertionError("past its share, nothing is asked")
    except OutOfTime:
        pass
    assert abs(c.share(3) - (600 - 148) / 3.0) < 1e-9
    tick[0] = 601.0
    assert c.share(1) == 0.0
    assert default_last_year(dt.date(2026, 11, 13)) == 2026 and default_last_year(dt.date(2026, 11, 14)) == 2027
    assert default_last_year(dt.date(2026, 12, 1)) == 2027 and default_last_year(dt.date(2026, 3, 1)) == 2026
    # a model whose paths all fail, quickly, is a failure with the reasons, not an hour of waiting
    global http_get
    real_get, calls = http_get, []

    def dead_get(url, timeout, clock=NO_CLOCK, tries=2, headers=None):
        calls.append(url)
        e = RuntimeError("HTTP 404 not here")
        e.code = 404
        raise e
    http_get = dead_get
    try:
        t0 = time.monotonic()
        try:
            fetch_nmme("spear", NMME["spear"], keep, 2026, Clock(1))
            raise AssertionError("no data is a failure")
        except RuntimeError as e:
            assert "0 November starts" in str(e) and "no path answered" in str(e), e
        assert time.monotonic() - t0 < 5 and len(calls) < 20, len(calls)
        assert any("Nov%201991)/(0000%201%20Nov%202020)" in u for u in calls) and not any("Nov%201985" in u for u in calls)
    finally:
        http_get = real_get
    # no key is a skip, not a failure, and the key is never printed
    assert "CDS_API_KEY" not in json.dumps(NMME) and all("key" not in c for c in C3S.values())
    print("selftest ok")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
