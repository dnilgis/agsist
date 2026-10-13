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
    NOAA NCEP CFSv2, NOAA GFDL SPEAR, NASA GEOS-S2S, NCAR CESM1 (COLA-RSMAS),
    Environment Canada CanSIPS. Re-forecasts from 1982 (CFSv2 1982-2010,
    others vary), real-time forecasts after. 1 degree, leads 0.5 to 11.5
    months (CFSv2 to 9.5). Monthly precipitation, mm/day.
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
  python3 scripts/fetch_seasonal_models.py --check      # validate the file
  python3 scripts/fetch_seasonal_models.py --selftest   # synthetic data, no network, no key

Fetching needs numpy, xarray, netCDF4 and (for C3S) cdsapi; the workflow
installs pinned versions. The selftest needs only the standard library.
"""
import calendar
import datetime as dt
import glob
import json
import os
import sys
import tempfile
import time
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "data", "prf", "seasonal-fc.json")
MAX_BYTES = 2_000_000

LAT0, LON0, BOX_DEG = 20.0, -130.0, 2.0
AREA = {"north": 50.0, "south": 20.0, "west": -130.0, "east": -66.0}
INIT_MONTH = 11
N_INTERVALS = 11

# Each model's dataset. NMME: the Data Library paths, tried in order until one
# answers (the Library has renamed some entries over the years; the log says
# which one answered). leads: months from the start month, the start month
# being lead index 0 (NMME's lead 0.5).
NMME = {
    "cfsv2":   {"system": "NCEP-CFSv2", "leads": 10,
                "paths": ["NCEP-CFSv2/.HINDCAST/.PENTAD_SAMPLES_FULL/.MONTHLY", "NCEP-CFSv2/.HINDCAST/.MONTHLY",
                          "NCEP-CFSv2/.FORECAST/.EARLY_MONTH_SAMPLES/.MONTHLY", "NCEP-CFSv2/.FORECAST/.MONTHLY"]},
    "spear":   {"system": "GFDL-SPEAR", "leads": 12,
                "paths": ["GFDL-SPEAR/.HINDCAST/.MONTHLY", "GFDL-SPEAR/.FORECAST/.MONTHLY"]},
    "geos":    {"system": "NASA-GEOSS2S", "leads": 9,
                "paths": ["NASA-GEOSS2S/.HINDCAST/.MONTHLY", "NASA-GEOSS2S/.FORECAST/.MONTHLY"]},
    "cesm":    {"system": "COLA-RSMAS-CESM1", "leads": 12,
                "paths": ["COLA-RSMAS-CESM1/.HINDCAST/.MONTHLY", "COLA-RSMAS-CESM1/.FORECAST/.MONTHLY"]},
    "cansips": {"system": "CanSIPS-IC4", "leads": 12,
                "paths": ["CanSIPS-IC4/.HINDCAST/.MONTHLY", "CanSIPS-IC4/.FORECAST/.MONTHLY",
                          "CanSIPS-IC3/.HINDCAST/.MONTHLY", "CanSIPS-IC3/.FORECAST/.MONTHLY"]},
}
NMME_BASE = "https://iridl.ldeo.columbia.edu/SOURCES/.Models/.NMME/"
NMME_FIRST = 1982

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


# ---------------------------------------------------------------- fetching (runner only)
def http_get(url, tries=4):
    last = None
    for t in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "agsist.com PRF backtest"}), timeout=180) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001 - logged and retried
            last = e
            time.sleep(10 * (t + 1))
    raise last


def nc_open(blob):
    import xarray as xr  # noqa: E402 - runner only
    f = tempfile.NamedTemporaryFile(suffix=".nc", delete=False)
    f.write(blob)
    f.close()
    return xr.open_dataset(f.name, decode_times=False), f.name


def nmme_year(path, year, leads, keep):
    """one November start from the Data Library: ensemble mean, CONUS, every lead"""
    q = (NMME_BASE + path + "/.prec/S/(0000 1 Nov %d)VALUES/L/(0.5)(%.1f)RANGEEDGES/M/average/"
         "X/(%g)(%g)RANGEEDGES/Y/(%g)(%g)RANGEEDGES/data.nc"
         % (year - 1, leads - 0.5, AREA["west"] + 360, AREA["east"] + 360, AREA["south"], AREA["north"]))
    ds, fn = nc_open(http_get(q))
    try:
        da = ds["prec"].squeeze()
        lats, lons = da["Y"].values.tolist(), da["X"].values.tolist()
        per_lead = {}
        for li, L in enumerate(da["L"].values.tolist()):
            lead = int(round(L - 0.5))
            y, m = lead_month(year, lead)
            fld = (da.isel(L=li).values * calendar.monthrange(y, m)[1]).tolist()
            per_lead[lead] = box_means(fld, lats, lons, keep)
        return per_lead
    finally:
        ds.close()
        os.unlink(fn)


def fetch_nmme(key, cfg, keep, last_year):
    by_year, used = {}, []
    for path in cfg["paths"]:
        got = 0
        for year in range(NMME_FIRST, last_year + 1):
            if year in by_year:
                continue
            try:
                per = nmme_year(path, year, cfg["leads"], keep)
            except Exception as e:  # noqa: BLE001
                if got == 0 and year > NMME_FIRST + 2:
                    break      # this path does not hold these years
                continue
            tot = interval_totals(per, year, cfg["leads"])
            if tot:
                by_year[year] = tot
                got += 1
        if got:
            used.append("%s (%d years)" % (path, got))
    m = encode_model(by_year, reachable_intervals(cfg["leads"]), keep)
    if not m:
        raise RuntimeError("no November start came back from any path")
    m.update({"source": "NMME, IRI/LDEO Data Library", "system": cfg["system"], "url": NMME_BASE + cfg["system"] + "/", "paths": used})
    return m


def fetch_c3s(key, cfg, keep, last_year, api_key):
    import cdsapi  # noqa: E402 - runner only
    import xarray as xr  # noqa: E402 - runner only
    c = cdsapi.Client(url="https://cds.climate.copernicus.eu/api", key=api_key, quiet=True, progress=False)
    by_year = {}
    for y0 in range(C3S_FIRST, last_year + 1, 6):
        years = [str(y - 1) for y in range(y0, min(y0 + 6, last_year + 1))]
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
    old = json.load(open(OUT))["models"] if os.path.exists(OUT) else {}
    keep = prf_boxes()
    now = dt.date.today()
    # a policy year's November start is out by the 14th (C3S posts on the 13th)
    last_year = now.year + 1 if (now.month == 11 and now.day >= 14) or now.month == 12 else now.year
    log("boxes holding a PRF grid: %d; policy years up to %d" % (len(keep), last_year))
    new, failed = {}, []
    for k, cfg in NMME.items():
        if only and k not in only:
            continue
        try:
            new[k] = fetch_nmme(k, cfg, keep, last_year)
            log("  %s: %d-%d, %d boxes, intervals %s" % (k, new[k]["first"], new[k]["last"], len(new[k]["v"]), new[k]["intervals"]))
        except Exception as e:  # noqa: BLE001
            failed.append(k)
            log("  %s: FAILED %s" % (k, str(e)[:200]))
    api_key = os.environ.get("CDS_API_KEY", "").strip()
    if not api_key:
        log("CDS_API_KEY is not set: the Copernicus models (%s) are skipped, not failed." % ", ".join(C3S))
    else:
        for k, cfg in C3S.items():
            if only and k not in only:
                continue
            try:
                new[k] = fetch_c3s(k, cfg, keep, last_year, api_key)
                log("  %s: %d-%d, %d boxes, intervals %s" % (k, new[k]["first"], new[k]["last"], len(new[k]["v"]), new[k]["intervals"]))
            except Exception as e:  # noqa: BLE001
                failed.append(k)
                log("  %s: FAILED %s" % (k, str(e)[:200]))
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
    # no key is a skip, not a failure, and the key is never printed
    assert "CDS_API_KEY" not in json.dumps(NMME) and all("key" not in c for c in C3S.values())
    print("selftest ok")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
