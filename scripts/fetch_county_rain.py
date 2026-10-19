#!/usr/bin/env python3
"""fetch_county_rain.py: this year's rain so far in every US county, one
NOAA station per county, written to data/rain/<st>.json.

Run by .github/workflows/county-rain.yml (Mondays, Jan 2, and by hand).
RCC-ACIS (data.rcc-acis.org) cannot be reached from the sandbox this was
built in; the workflow makes the real fetch on a GitHub runner.

HOW IT ASKS ACIS (politely: one state at a time, retries with backoff, a total time cap)
  1. One MultiStnData call per state: every station in the state, Jan 1 to
     yesterday (Central), two elements: daily precipitation and NOAA's daily
     1991-2020 normal for it ("normal": "91"; if ACIS refuses that, "1", the
     current normals, period not printed; if it refuses both, no normals and
     the pages print no percent).
  2. One more MultiStnData call per state for last year, Jan 1 to the same
     date, for the chosen stations only (sids=...).

WHICH STATION (scripts/county_rain.py has the rules)
  Inside the county (ACIS's county FIPS in the station's meta), reporting at
  least 90% of the days so far and current within 10 days. Among those:
  mountain sites last (SNOTEL, or 1,500 ft above the county's other
  stations), then one with NOAA normals, then the most days reported, then
  nearest the middle of the county. A county with none is listed as having no NOAA station
  that reported enough days, with the nearest county that has one.

WHAT IT WILL NOT DO
  A state whose call fails keeps the file already published. A state whose
  answer is much thinner than the published one (under half the counties, same
  year) is refused and kept. No file is written that fails --check.

  python3 scripts/fetch_county_rain.py                    fetch every state
  python3 scripts/fetch_county_rain.py --states IA,KS     some states
  python3 scripts/fetch_county_rain.py --year 2026        a year (default: this year; in January, last year)
  python3 scripts/fetch_county_rain.py --fixtures DIR --out DIR --edate YYYY-MM-DD
                                                          read saved ACIS answers instead of the network
  python3 scripts/fetch_county_rain.py --check            validate data/rain/*.json
  python3 scripts/fetch_county_rain.py --selftest         offline tests on test/fixtures/rain
"""
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
OUT = os.path.join(ROOT, "data", "rain")
URL = "https://data.rcc-acis.org/MultiStnData"
SCHEMA = "agsist-county-rain/1"
DAILY_SCHEMA = "agsist-county-rain-daily/1"
DAILY_DIR = "daily"    # data/rain/daily/<st>.json: the chosen stations' days, for the county pages' Rain Print
TIMEOUT_S = 180
BACKOFF_S = (15, 45, 120)
MAX_MINUTES = 40
NORMALS = (("91", "1991-2020"), ("1", None))
UA = "agsist.com county rain (https://agsist.com/rain; weekly)"


def central_today():
    # Central time without a tz database: CDT (UTC-5) Mar to early Nov, else CST.
    # A day early or late at the edge only moves "yesterday" by one day.
    now = dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)
    off = 5 if 3 <= now.month <= 10 else 6
    return (now - dt.timedelta(hours=off)).date()


def default_year_and_edate(today):
    """January fetches the finished year (through Dec 31); otherwise this year through yesterday."""
    if today.month == 1:
        return today.year - 1, f"{today.year - 1}-12-31"
    return today.year, (today - dt.timedelta(days=1)).isoformat()


# ---------------------------------------------------------------- talking to ACIS

class Source:
    """ACIS over the network, with a deadline."""

    def __init__(self, deadline):
        self.deadline = deadline
        self.calls = 0

    def call(self, params):
        body = urllib.parse.urlencode({"params": json.dumps(params)}).encode()
        err = None
        for attempt in range(len(BACKOFF_S) + 1):
            if time.time() > self.deadline:
                raise TimeoutError("time cap reached")
            try:
                self.calls += 1
                req = urllib.request.Request(URL, data=body, headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
                    j = json.loads(r.read().decode("utf-8"))
                return j
            except Exception as e:  # noqa: BLE001
                err = e
                if attempt < len(BACKOFF_S):
                    wait = BACKOFF_S[attempt]
                    print(f"  ACIS: {e}; retrying in {wait}s", flush=True)
                    time.sleep(wait)
        raise RuntimeError(f"ACIS failed after retries: {err}")


class FixtureSource:
    """Saved ACIS answers: DIR/<ST>-<year>.json (precipitation and normals,
    the whole state) and DIR/<ST>-<year>-last.json (last year, every station;
    filtered to the requested sids here, as ACIS would)."""

    def __init__(self, d):
        self.d = d
        self.calls = 0

    def call(self, params):
        self.calls += 1
        y = params["sdate"][:4]
        if "state" in params:
            p = os.path.join(self.d, f"{params['state']}-{y}.json")
            if not os.path.exists(p):
                return {"error": "no fixture"}
            j = json.load(open(p))
            want_norm = any(isinstance(e, dict) and e.get("normal") for e in params["elems"])
            norm_code = next((e.get("normal") for e in params["elems"] if isinstance(e, dict) and e.get("normal")), None)
            fx_norm = j.get("_normal", "91")
            if want_norm and norm_code != fx_norm:
                return {"error": f"Unknown normal: {norm_code}"}
            j = {k: v for k, v in j.items() if not k.startswith("_")}
            return trim(j, params)
        sids = set(params["sids"].split(","))
        p = os.path.join(self.d, f"{params['_st']}-{y}.json")
        if not os.path.exists(p):
            return {"error": "no fixture"}
        j = json.load(open(p))
        rows = [s for s in j["data"] if sids & set(s["meta"].get("sids", []))]
        return trim({"data": rows}, params)


def trim(j, params):
    """Cut saved rows to the asked dates, as ACIS answers only for sdate..edate."""
    n = (dt.date.fromisoformat(params["edate"]) - dt.date.fromisoformat(params["sdate"])).days + 1
    out = []
    for s in j.get("data", []):
        out.append({"meta": s["meta"], "data": s["data"][:n]})
    return {"data": out}


SNOW = {"name": "snow", "interval": "dly"}


def ask_state(src, st, year, edate):
    """(rows, normals period or None, normals used?, snowfall column or None)
    for one state. Snowfall rides along for the county pages' Rain Print
    (data/rain/daily); if ACIS refuses it, the rain still comes."""
    base = {"state": st, "sdate": f"{year}-01-01", "edate": edate, "meta": "name,state,sids,ll,county,elev"}
    pcpn = {"name": "pcpn", "interval": "dly"}
    for code, period in NORMALS:
        for snow in (True, False):
            elems = [pcpn, {"name": "pcpn", "interval": "dly", "normal": code}] + ([SNOW] if snow else [])
            j = src.call(dict(base, elems=elems))
            if "error" not in j and isinstance(j.get("data"), list):
                return j["data"], period, True, (2 if snow else None)
            print(f"  {st}: normals '{code}'{' with snowfall' if snow else ''} refused ({j.get('error')})", flush=True)
    for snow in (True, False):
        j = src.call(dict(base, elems=[pcpn] + ([SNOW] if snow else [])))
        if "error" not in j and isinstance(j.get("data"), list):
            return j["data"], None, False, (1 if snow else None)
    raise RuntimeError(f"{st}: {j.get('error') or 'no data'}")


def ask_last_year(src, st, sids, as_of_last):
    if not sids:
        return []
    y = as_of_last[:4]
    j = src.call({"sids": ",".join(sids), "_st": st, "sdate": f"{y}-01-01", "edate": as_of_last,
                  "elems": [{"name": "pcpn", "interval": "dly"}], "meta": "name,state,sids,ll,county,elev"})
    if "error" in j or not isinstance(j.get("data"), list):
        print(f"  {st}: last year not available ({j.get('error')})", flush=True)
        return []
    return j["data"]


# ---------------------------------------------------------------- one state

def nearby(pool, g, mi=None):
    """The other gauges in pool within mi miles (default R.STUCK_NEAR_MI) of g."""
    mi = mi or R.STUCK_NEAR_MI
    dlat = mi / 69.0
    out = []
    for h in pool:
        if h is g or h["sid"] == g["sid"] or abs(h["lat"] - g["lat"]) > dlat:
            continue
        if R.miles(g["lat"], g["lon"], h["lat"], h["lon"]) <= mi:
            out.append(h)
    return out


def daily_rec(vals, snows):
    """One county's days for data/rain/daily/<st>.json: the rain (p) and, when
    the station kept a snowfall record at all, the snowfall (s), packed
    (county_rain.pack_days). Jan 1 to the county's as-of day."""
    r = {"p": R.pack_days(vals)}
    if any(R.parse_pcpn(v)[0] is not None for v in snows):
        r["s"] = R.pack_days(snows)
    return r


REACH_SLACK = 15   # miles past the county outline's farthest corner a station may sit

def build_state(src, st, year, edate, C, fetched):
    rows, period, has_norm, snow_col = ask_state(src, st, year, edate)
    n = (dt.date.fromisoformat(edate) - dt.date.fromisoformat(f"{year}-01-01")).days + 1
    dates = R.days_of(year, f"{year}-01-01", n)
    mine = {f: c for f, c in C.items() if c["st"] == st}
    cands = {}
    pool = []      # every gauge in the state with a place: the check on stuck gauges
    seen = 0
    for s in rows:
        meta = s.get("meta") or {}
        if not meta.get("ll") or not meta.get("sids"):
            continue
        data = [R.row_values(r) for r in (s.get("data") or [])][:n]
        if len(data) < n:
            data += [["M", "M"]] * (n - len(data))
        vals = [r[0] if r else "M" for r in data]
        snows = [r[snow_col] if snow_col and len(r) > snow_col else "M" for r in data]
        norms = [r[1] if len(r) > 1 else "M" for r in data] if has_norm else None
        gauge = {"sid": meta["sids"][0], "lat": meta["ll"][1], "lon": meta["ll"][0],
                 "parsed": R.close_s([R.parse_pcpn(v) for v in vals]), "nv": R.daily_normals(dates, norms)}
        pool.append(gauge)
        fips = str(meta.get("county") or "")
        if fips not in mine:
            continue
        seen += 1
        summ, why = R.summarize(year, dates, vals, norms, edate, snows if snow_col else None)
        lon, lat = meta["ll"][0], meta["ll"][1]
        c = mine[fips]
        mi = R.miles(c["lat"], c["lon"], lat, lon)
        # Farther from the middle than any corner of the county: NOAA's county
        # code and the station's place disagree (2026-10-13: WHITESTONE FARMS,
        # near Delta Junction, filed under North Slope Borough, 411 mi out).
        # Leave that station out of this county instead of refusing the state.
        # REACH_SLACK covers islands the simplified outline leaves out
        # (Ocracoke, in Hyde County NC, is 33 mi out; the outline reaches 24).
        if c.get("reach") and mi > c["reach"] + REACH_SLACK:
            print(f"  {st} {fips}: skipping {meta.get('name')} ({mi:.0f} mi out, the county reaches {c['reach']:.0f})", flush=True)
            continue
        cand = {"meta": meta, "summary": summ, "why": why, "mi": mi, "vals": vals, "snows": snows, "gauge": gauge}
        cands.setdefault(fips, []).append(cand)
    # a run of zeros the gauges around it did not have: leave that gauge out
    # so the next one in the county can answer
    for fips, cs in sorted(cands.items()):
        for x in cs:
            g = x["gauge"]
            if not x["summary"] or not any(j - i + 1 >= R.STUCK_MIN_DAYS for i, j in R.zero_runs(g["parsed"])):
                continue
            bad = R.stuck_run(g["parsed"], g["nv"], [(h["parsed"], h["nv"]) for h in nearby(pool, g)])
            if bad:
                i, j, u, got = bad
                print(f"  {st} {fips}: skipping {x['meta'].get('name')} (0.00 for {j - i + 1} days, {dates[i]} to {dates[j]}, "
                      f"usual {u:.1f} in; gauges within {R.STUCK_NEAR_MI} mi "
                      + (f"caught {got:.1f} in)" if got is not None else "none to check)"), flush=True)
                x["summary"], x["why"] = None, f"stuck at 0.00 {dates[i]} to {dates[j]}"
    picked, none = {}, {}
    for fips, c in sorted(mine.items()):
        ok = R.pick_order(R.mark_mountain([x for x in cands.get(fips, []) if x["summary"]]), st, c["lat"], year)
        if ok:
            picked[fips] = dict(ok[0], n_ok=len(ok))
        else:
            got = cands.get(fips, [])
            none[fips] = {"name": c["name"], "stations": len(got)}
    # last year, the same days, the same stations
    by_asof = {}
    for fips, x in picked.items():
        by_asof.setdefault(R.same_date_last_year(x["summary"]["as_of"]), []).append(fips)
    last = {}
    if by_asof:
        through = max(by_asof)
        sids = sorted({picked[f]["meta"]["sids"][0] for f in picked})
        for s in ask_last_year(src, st, sids, through):
            ss = set((s.get("meta") or {}).get("sids") or [])
            vals = [R.row_values(r)[0] if R.row_values(r) else "M" for r in (s.get("data") or [])]
            for f, x in picked.items():
                if x["meta"]["sids"][0] in ss:
                    k = dates.index(x["summary"]["as_of"]) + 1
                    this = {d[5:]: v for d, v in zip(dates[:k], x["vals"][:k])}
                    last[f] = R.last_year_total(vals, f"{int(year) - 1}-01-01", R.same_date_last_year(x["summary"]["as_of"]), this)
                    x["last_vals"] = vals
        # a stuck run last year makes last year's total wrong, and the
        # comparison with it: the same test as this year, with this year's
        # normals for those calendar days and the other chosen stations'
        # last years within 40 mi as the check (2026-10-13: Fort Lauderdale
        # Executive airport, 7.15 in by Oct 12 of 2025)
        lg = {}
        for f, x in picked.items():
            if last.get(f) and "last_vals" in x:
                nl = (dt.date.fromisoformat(last[f]["through"]) - dt.date(int(year) - 1, 1, 1)).days + 1
                ld = R.days_of(int(year) - 1, f"{int(year) - 1}-01-01", nl)
                md = dict(zip((d[5:] for d in dates), x["gauge"]["nv"] or []))
                lv = (x["last_vals"] + ["M"] * nl)[:nl]
                lg[f] = {"sid": x["gauge"]["sid"], "lat": x["gauge"]["lat"], "lon": x["gauge"]["lon"],
                         "parsed": R.close_s([R.parse_pcpn(v) for v in lv]),
                         "nv": [md.get(d[5:] if d[5:] != "02-29" else "02-28") for d in ld] if md else None}
        for f, g in sorted(lg.items()):
            bad = R.stuck_run(g["parsed"], g["nv"], [(h["parsed"], h["nv"]) for h in nearby(list(lg.values()), g)])
            if bad:
                i, j, u, got = bad
                print(f"  {st} {f}: no {int(year) - 1} comparison ({picked[f]['meta'].get('name')} read 0.00 for {j - i + 1} days "
                      f"from {R.days_of(0, f'{int(year) - 1}-01-01', i + 1)[-1]}, usual {u:.1f} in)", flush=True)
                last[f] = None
    out, daily = {}, {}
    for fips, x in sorted(picked.items()):
        m, s = x["meta"], x["summary"]
        rec = {"name": mine[fips]["name"],
               "station": {"raw": m.get("name", ""), "name": R.station_name(m.get("name", "")),
                           "sid": m["sids"][0], "net": R.network(m["sids"]),
                           "ll": [round(m["ll"][0], 4), round(m["ll"][1], 4)], "mi": round(x["mi"], 1)}}
        rec.update(s)
        rec["n_ok"] = x["n_ok"]
        rec["last"] = last.get(fips)
        out[fips] = rec
        daily[fips] = daily_rec(x["vals"][:s["days"]], x["snows"][:s["days"]])
    return {"schema": SCHEMA, "state": st, "year": int(year), "edate": edate, "fetched": fetched,
            "normals": ("1991-2020" if period else "current") if has_norm else None,
            "pick": 3,   # 2: mountain sites ranked last (county_rain.mark_mountain); 3: and a full snowfall record (county_rain.pick_order); the pages say so
            "source": "NOAA daily records through RCC-ACIS (MultiStnData)",
            "stations_in_counties": seen, "counties": out, "none": none, "_daily": daily}


# A gauge that reads under 40% of what the counties around it read, where a
# usual year to date is 10 inches or more, is far more likely stuck or
# clogged than that dry (2026-10-13: Blytheville airport, Mississippi County
# AR, 7.68 in and 24% of usual with every neighbor near 77%). Dry country is
# left alone: there one storm can make a county look nothing like the next.
ODD_LOW, ODD_MIN_USUAL, ODD_MIN_NBRS = 0.40, 10.0, 3


def _median(xs):
    xs = sorted(xs)
    n = len(xs)
    return None if not n else xs[n // 2] if n % 2 else (xs[n // 2 - 1] + xs[n // 2]) / 2


def hold_outliers(files, new, N):
    """Move a county whose gauge reads far below all its neighbors into "none".
    With a percent, percent against the neighbors' percents; a gauge with no
    NOAA normal has no percent, so its total is held against the neighbors'
    totals instead, where those reach 10 inches (dry country left alone)."""
    pct = {f: c["pct"] for d in files.values() for f, c in d["counties"].items() if c.get("pct")}
    tot = {f: c["total"] for d in files.values() for f, c in d["counties"].items() if c.get("total") is not None}
    held = []
    for st, d in new.items():
        for f, c in list(d["counties"].items()):
            if c.get("pct"):
                if (c.get("usual") or 0) < ODD_MIN_USUAL:
                    continue
                nb = [pct[n] for n in N.get(f, []) if n in pct]
                mid = _median(nb)
                if len(nb) < ODD_MIN_NBRS or not c["pct"] < ODD_LOW * mid:
                    continue
                why = f"{c['pct']}% of usual, the counties around it {mid:.0f}%"
            else:
                # and under 40% of every neighbor, not just the middle one: with
                # no normal, a rain-shadow town next to mountain counties looks
                # low against the median (Gardnerville NV, 4.11 in, Carson City
                # 4.36, the Sierra counties 22 to 30)
                nb = [tot[n] for n in N.get(f, []) if n in tot]
                mid = _median(nb)
                if len(nb) < ODD_MIN_NBRS or mid < ODD_MIN_USUAL or not c["total"] < ODD_LOW * min(nb):
                    continue
                why = f"{c['total']:.2f} in, the counties around it {mid:.1f} in"
            d["none"][f] = {"name": c["name"], "stations": c.get("n_ok") or 1, "held": c["station"]["raw"]}
            del d["counties"][f]
            held.append(f)
            print(f"  {st} {f}: holding {c['station']['raw']} ({why})", flush=True)
    return held


def hold_last_year(files, new, N):
    """Drop last year's comparison where last year's rain on the shared days is
    under 40% of this year's and the counties around did not drop the same way
    (3 or more of them with a ratio under 40% too). Only where this year has
    10 inches or more on those days: in dry country one storm swings it.
    A gauge that was stuck last year reads this way (2026-10-13: Broward FL,
    7.15 in in 2025 against 49 in 2026, the counties around it near 1 to 1)."""
    def ratio(c):
        L = c.get("last")
        if not L:
            return None, None
        tb, lb = (L["this_both"], L["last_both"]) if "both" in L else (c["total"], L["total"])
        return (lb / tb if tb else None), tb
    rat = {}
    for d in files.values():
        for f, c in d["counties"].items():
            r, _ = ratio(c)
            if r is not None:
                rat[f] = r
    dropped = []
    for st, d in new.items():
        for f, c in d["counties"].items():
            r, tb = ratio(c)
            if r is None or tb < ODD_MIN_USUAL or r >= ODD_LOW:
                continue
            nb = [rat[n] for n in N.get(f, []) if n in rat]
            mid = _median(nb)
            if len(nb) >= ODD_MIN_NBRS and mid < ODD_LOW:
                continue
            c["last"] = None
            dropped.append(f)
            print(f"  {st} {f}: no last-year comparison ({c['station']['raw']}: last year {100 * r:.0f}% of this year, "
                  + (f"the counties around it {100 * mid:.0f}%)" if mid is not None else "no counties around to check)"), flush=True)
    return dropped


def add_nearest(files, C):
    """For each county with no station, the nearest county (any state) that has one."""
    have = [(f, C[f]["lat"], C[f]["lon"]) for d in files.values() for f in d["counties"] if f in C]
    for d in files.values():
        for f, x in d["none"].items():
            if f not in C or not have:
                x["near"] = None
                continue
            la, lo = C[f]["lat"], C[f]["lon"]
            best = min(have, key=lambda h: R.miles(la, lo, h[1], h[2]))
            x["near"] = best[0]


# ---------------------------------------------------------------- checking

def problems(d, path="", C=None):
    """What is wrong with one state file. C (county_rain.counties()) lets a
    station sit as far out as its county reaches (Alaska's are huge)."""
    bad = []
    if d.get("schema") != SCHEMA:
        bad.append(f"{path}: schema {d.get('schema')}")
    y = d.get("year")
    for f, c in (d.get("counties") or {}).items():
        w = f"{path} {f}"
        try:
            if not (str(y) == c["as_of"][:4]):
                bad.append(f"{w}: as_of {c['as_of']} not in {y}")
            if not (0 <= c["total"] < 250):
                bad.append(f"{w}: total {c['total']}")
            if c["reported"] < R.MIN_SHARE * c["days"] or c["reported"] + c["missing"] != c["days"]:
                bad.append(f"{w}: reported {c['reported']} of {c['days']}")
            if abs(sum(m[0] for m in c["months"]) - c["total"]) > 0.02 * len(c["months"]) + 0.01:
                bad.append(f"{w}: months do not add to the total")
            if c["usual"] is not None and c["pct"] is not None and abs(round(100 * c["total"] / c["usual"]) - c["pct"]) > 1:
                bad.append(f"{w}: pct {c['pct']} vs {c['total']}/{c['usual']}")
            if c["usual"] is None and c["pct"] is not None:
                bad.append(f"{w}: a percent with no usual")
            if c["max_day"] and c["max_day"][1] > c["total"] + 0.001:
                bad.append(f"{w}: biggest day over the total")
            if c["cum"] and abs(c["cum"][-1][1] - c["total"]) > 0.011:
                bad.append(f"{w}: running total ends at {c['cum'][-1][1]}, total {c['total']}")
            if not c["station"]["name"] or c["station"]["mi"] > max(200, (C or {}).get(f, {}).get("reach", 0) + REACH_SLACK):
                bad.append(f"{w}: station {c['station']}")
        except (KeyError, TypeError, IndexError) as e:
            bad.append(f"{w}: malformed ({e})")
    return bad


def daily_problems(dd, d, path=""):
    """What is wrong with one daily file against its state file: every county's
    days run Jan 1 to its as-of day and add up to its total."""
    bad = []
    if dd.get("schema") != DAILY_SCHEMA or dd.get("state") != d.get("state") or dd.get("year") != d.get("year"):
        return [f"{path}: schema, state or year differs from the state file"]
    for f, x in (dd.get("counties") or {}).items():
        c = (d.get("counties") or {}).get(f)
        if not c:
            bad.append(f"{path} {f}: no such county in the state file")
            continue
        try:
            p = R.close_s([R.parse_pcpn(v) for v in R.unpack_days(x["p"])])
            if len(p) != c["days"]:
                bad.append(f"{path} {f}: {len(p)} days, the state file says {c['days']}")
            elif abs(sum(v for v, _ in p if v is not None) - c["total"]) > 0.011:
                bad.append(f"{path} {f}: days add to {sum(v for v, _ in p if v is not None):.2f}, total {c['total']}")
            if "s" in x and len(R.unpack_days(x["s"])) != c["days"]:
                bad.append(f"{path} {f}: snowfall has {len(R.unpack_days(x['s']))} days")
        except (KeyError, TypeError, ValueError) as e:
            bad.append(f"{path} {f}: malformed ({e})")
    return bad


def check(dirpath=OUT):
    bad = []
    files = sorted(glob.glob(os.path.join(dirpath, "*.json")))
    C = R.counties() if files else None
    for p in files:
        try:
            d = json.load(open(p))
        except ValueError as e:
            bad.append(f"{p}: {e}")
            continue
        bad += problems(d, os.path.basename(p), C)
        dp = os.path.join(dirpath, DAILY_DIR, os.path.basename(p))
        if os.path.exists(dp):
            try:
                bad += daily_problems(json.load(open(dp)), d, DAILY_DIR + "/" + os.path.basename(p))
            except ValueError as e:
                bad.append(f"{dp}: {e}")
    for b in bad[:20]:
        print("BAD", b)
    print(f"{len(files)} state files, {len(bad)} problem(s)")
    return 1 if bad else 0


# ---------------------------------------------------------------- run

def run(src, states, year, edate, out_dir, C, deadline=None):
    fetched = dt.datetime.now(dt.timezone.utc).replace(microsecond=0, tzinfo=None).isoformat() + "Z"
    os.makedirs(out_dir, exist_ok=True)
    new, failed = {}, []
    for st in states:
        if deadline and time.time() > deadline:
            print(f"time cap reached; {st} and later states keep their published files", flush=True)
            failed.append(st)
            continue
        t0 = time.time()
        try:
            d = build_state(src, st, year, edate, C, fetched)
        except Exception as e:  # noqa: BLE001
            print(f"{st}: FAILED ({e}); kept the published file", flush=True)
            failed.append(st)
            continue
        p = os.path.join(out_dir, st.lower() + ".json")
        old = json.load(open(p)) if os.path.exists(p) else None
        if old and old.get("year") == d["year"] and len(d["counties"]) < 0.5 * len(old.get("counties", {})):
            print(f"{st}: refusing a thin answer ({len(d['counties'])} counties, published {len(old['counties'])}); kept", flush=True)
            failed.append(st)
            continue
        bad = problems(d, st, C)
        if bad:
            print(f"{st}: refusing ({bad[0]}); kept", flush=True)
            failed.append(st)
            continue
        new[st] = d
        print(f"{st}: {len(d['counties'])} counties with a station, {len(d['none'])} without "
              f"({d['stations_in_counties']} stations, {time.time() - t0:.0f}s)", flush=True)
    # nearest neighbor across every state file we will have on disk
    allf = {}
    for p in glob.glob(os.path.join(out_dir, "*.json")):
        st = os.path.basename(p)[:-5].upper()
        if st not in new:
            try:
                allf[st] = json.load(open(p))
            except ValueError:
                pass
    allf.update(new)
    NB = R.neighbors()
    hold_outliers(allf, new, NB)
    hold_last_year(allf, new, NB)
    add_nearest(allf, C)
    for st, d in new.items():
        daily = d.pop("_daily", None) or {}
        with open(os.path.join(out_dir, st.lower() + ".json"), "w") as fh:
            json.dump(d, fh, separators=(",", ":"), sort_keys=True)
            fh.write("\n")
        # the days behind each county still in the file (a held county's go too)
        dd = os.path.join(out_dir, DAILY_DIR)
        os.makedirs(dd, exist_ok=True)
        with open(os.path.join(dd, st.lower() + ".json"), "w") as fh:
            json.dump({"schema": DAILY_SCHEMA, "state": st, "year": d["year"], "edate": d["edate"], "fetched": d["fetched"],
                       "counties": {f: daily[f] for f in sorted(d["counties"]) if f in daily}},
                      fh, separators=(",", ":"), sort_keys=True)
            fh.write("\n")
    return new, failed


def selftest():
    import subprocess
    import tempfile
    fx = os.path.join(ROOT, "test", "fixtures", "rain")
    fails = []

    def ok(c, m):
        if not c:
            fails.append(m)

    # one day's value
    ok(R.parse_pcpn("M") == (None, "M"), "M is a gap")
    ok(R.parse_pcpn("T") == (0.0, "T"), "T is a reported 0")
    ok(R.parse_pcpn("S") == (0.0, "S"), "S is reported, counted on the A day")
    ok(R.parse_pcpn("1.25A") == (1.25, "A"), "A keeps its amount")
    ok(R.parse_pcpn("0.31") == (0.31, ""), "plain value")
    ok(R.parse_pcpn(" ") == (None, "M"), "blank is a gap")
    # a little year by hand: gaps, trace, S/A, a dry run broken by a gap
    dates = R.days_of(2026, "2026-01-01", 12)
    vals = ["0.00", "0.00", "0.00", "M", "0.00", "T", "S", "S", "1.50A", "0.40", "M", "M"]
    norms = ["0.10"] * 12
    s, why = R.summarize(2026, dates, vals[:10] + ["0.00", "M"], norms, "2026-01-12")
    ok(s and s["as_of"] == "2026-01-11", f"trailing M is not yet reported, not a gap: {s and s['as_of']}")
    ok(s and s["missing"] == 1 and s["reported"] == 10, f"one gap inside the year: {s}")
    ok(s and abs(s["total"] - 1.90) < 1e-9, f"S days count once, on the A day: {s and s['total']}")
    ok(s and abs(s["usual"] - 1.00) < 1e-9, f"usual leaves the gap out too: {s and s['usual']}")
    # 1.50A covers Jan 7 to 9, so one of those days had at least 0.50, more than
    # Jan 10's 0.40: the A total is not a day, and 0.40 is not the biggest day either
    ok(s and s["max_day"] is None, f"an A total is not the biggest day, and hides a bigger one: {s and s['max_day']}")
    ok(s and s["dry"] == [3, "2026-01-01", "2026-01-03"], f"a gap ends a dry stretch: {s and s['dry']}")
    ok(s and s["trace"] == 1 and s["acc"] == 1 and s["unsplit"] == 2, "trace, A and S counted")
    ok(s and s["pct"] == 190, f"percent of usual: {s and s['pct']}")
    # 0.40 on one day, then S, S, 3.10A: some day in those three had at least 1.03
    d14 = R.days_of(2026, "2026-01-01", 14)
    s, _ = R.summarize(2026, d14, ["0"] * 10 + ["0.40", "S", "S", "3.10A"], ["0.1"] * 14, "2026-01-14")
    ok(s and s["max_day"] is None, f"a multi-day report that beats the biggest day withholds it: {s and s['max_day']}")
    s, _ = R.summarize(2026, d14, ["0"] * 10 + ["1.40", "S", "S", "3.10A"], ["0.1"] * 14, "2026-01-14")
    ok(s and s["max_day"] == ["2026-01-11", 1.4], f"a multi-day report smaller per day keeps the biggest day: {s and s['max_day']}")
    # wettest month: March missed 5 days mid-month but its 26 reported days beat every full month
    d90 = R.days_of(2026, "2026-01-01", 120)
    s, _ = R.summarize(2026, d90, ["0.05"] * 31 + ["0.02"] * 28 + ["0.5"] * 10 + ["M"] * 5 + ["0.5"] * 16 + ["0.01"] * 30, ["0.1"] * 120, "2026-04-30")
    ok(s and s["wet_month"] is None, f"a skipped month that beats the wettest withholds it: {s and s['wet_month']}")
    s, _ = R.summarize(2026, d90, ["0.05"] * 31 + ["0.02"] * 28 + ["0.01"] * 10 + ["M"] * 5 + ["0.01"] * 16 + ["0.01"] * 30, ["0.1"] * 120, "2026-04-30")
    ok(s and s["wet_month"] == [0, 1.55], f"a skipped month below the wettest keeps it: {s and s['wet_month']}")
    # a station whose NOAA county code disagrees with its place is left out of
    # that county, and the rest of the state still publishes
    class _Src:
        def __init__(self, rows): self.rows = rows
        def call(self, q): return {"data": self.rows} if "state" in q else {"data": []}
    _C = {"02185": {"st": "AK", "name": "North Slope Borough", "slug": "x", "lat": 69.3, "lon": -153.5, "reach": 330},
          "02090": {"st": "AK", "name": "Fairbanks North Star Borough", "slug": "y", "lat": 64.8, "lon": -146.6, "reach": 110}}
    _d = R.days_of(2026, "2026-01-01", 20)
    _row = lambda name, sid, ll, fips: {"meta": {"name": name, "sids": [sid], "ll": ll, "county": fips}, "data": [["0.10", "0.05"]] * 20}
    _out = build_state(_Src([_row("WHITESTONE FARMS", "509793 2", [-145.8894, 64.1539], "02185"),
                             _row("FAIRBANKS INTL AP", "502968 2", [-147.8761, 64.8039], "02090")]),
                       "AK", 2026, "2026-01-20", _C, "2026-01-21T00:00:00Z")
    ok("02185" not in _out["counties"] and "02090" in _out["counties"],
       f"a station 400 mi outside its county is skipped, not the state: {sorted(_out['counties'])}")
    # a stuck gauge: 40 days at 0.00 where a usual year gives 4 in and the gauges
    # around it caught rain. It is left out and the next gauge in the county answers.
    _SC = {"19001": {"st": "IA", "name": "A County", "slug": "a", "lat": 42.0, "lon": -93.0, "reach": 30},
           "19003": {"st": "IA", "name": "B County", "slug": "b", "lat": 42.0, "lon": -93.4, "reach": 30}}

    def _wet(i, dry):
        return "0.00" if dry and 30 <= i < 70 else ("0.30" if i % 3 == 0 else "0.00")

    def _g(name, sid, ll, fips, dry, nrm="0.10", gap=False):
        return {"meta": {"name": name, "sids": [sid], "ll": ll, "county": fips},
                "data": [["M" if gap and i == 5 else _wet(i, dry), nrm] for i in range(100)]}

    def _pick(rows):
        o = build_state(_Src(rows), "IA", 2026, "2026-04-10", _SC, "2026-04-11T00:00:00Z")
        return o["counties"].get("19001", {}).get("station", {}).get("raw")
    _near = [_g("GOOD", "2 2", [-93.05, 42.05], "19001", False, gap=True), _g("NEAR", "3 2", [-93.3, 42.0], "19003", False)]
    ok(_pick([_g("STUCK", "1 2", [-93.0, 42.0], "19001", True)] + _near) == "GOOD",
       f"a gauge at 0.00 for 40 days while its neighbors caught rain is left out: {_pick([_g('STUCK', '1 2', [-93.0, 42.0], '19001', True)] + _near)}")
    ok(_pick([_g("STUCK", "1 2", [-93.0, 42.0], "19001", True, nrm="M"),
              _g("GOOD", "2 2", [-93.05, 42.05], "19001", False, nrm="M", gap=True), _near[1]]) == "GOOD",
       "with no normal of its own, the neighbors' normals say what a usual year would have given")
    _dry = [_g("GOOD", "2 2", [-93.05, 42.05], "19001", True, gap=True), _g("NEAR", "3 2", [-93.3, 42.0], "19003", True)]
    ok(_pick([_g("STUCK", "1 2", [-93.0, 42.0], "19001", True)] + _dry) == "STUCK",
       "a dry spell every gauge around shared is real: the most complete gauge still answers")
    # mountain sites last: a snow site with normals loses to a valley gauge without
    _snow = _g("SNOW PASS", "USS0013A26S 6", [-93.0, 42.0], "19001", False)
    _val = _g("VALLEY", "4 2", [-93.2, 42.1], "19001", False, nrm="M")
    ok(_pick([_snow, _val, _near[1]]) == "VALLEY", f"a SNOTEL site is picked last: {_pick([_snow, _val, _near[1]])}")
    ok(_pick([_snow, _near[1]]) == "SNOW PASS", "a SNOTEL site still answers when it is the only one")
    _hi = dict(_g("HIGH CAMP", "5 2", [-93.0, 42.0], "19001", False))
    _hi["meta"] = dict(_hi["meta"], elev=6400)
    _lo1, _lo2 = _g("LOW ONE", "6 2", [-93.25, 42.1], "19001", False), _g("LOW TWO", "7 2", [-93.3, 42.1], "19001", False)
    _lo1["meta"]["elev"], _lo2["meta"]["elev"] = 3100, "3300"
    ok(_pick([_hi, _lo1, _lo2, _near[1]]) == "LOW ONE", f"a station far above the county's others is picked last: {_pick([_hi, _lo1, _lo2, _near[1]])}")
    _lo1["meta"]["elev"] = 5900
    ok(_pick([_hi, _lo1, _near[1]]) == "HIGH CAMP", "a station only a little higher keeps the usual order")
    ok(build_state(_Src([_val]), "IA", 2026, "2026-04-10", _SC, "2026-04-11T00:00:00Z").get("pick") == 3, "the data file says which pick rule it used")
    # Sig's rule (2026-10-15): where snow is normal, a station with full rain AND
    # snowfall records beats a nearer gauge whose snowfall has gaps, within 10 mi
    # farther or twice as far. Story County IA style: the real Ames 1.5 NNE
    # CoCoRaHS days (95 snowfall gaps, 7.8 mi from the middle) against a co-op
    # farther out that keeps both (its rain is the gauge's, its snowfall whole).
    _sx = json.load(open(os.path.join(ROOT, "test", "fixtures", "rain-snow", "days.json")))["story_ia"]
    _ap, _as = R.unpack_days(_sx["p"]), R.unpack_days(_sx["s"])
    _cs = [x if R.parse_pcpn(x)[0] is not None else "0.0" for x in _as]
    _ST = {"19169": {"st": "IA", "name": "Story County", "slug": "story-county", "lat": 42.04, "lon": -93.46, "reach": 40}}

    def _st_row(name, sid, mi, p, sn, nrm="0.08", st="19169"):
        return {"meta": {"name": name, "sids": [sid], "ll": [-93.46, 42.04 + mi / 69.0], "county": st, "elev": 950},
                "data": [[p[i], nrm, sn[i]] for i in range(len(p))]}

    def _st_pick(rows, C=_ST, st="IA"):
        o = build_state(_Src(rows), st, 2026, _sx["as_of"], C, "2026-10-14T00:00:00Z")
        return next(iter(o["counties"].values()), {}).get("station", {}).get("raw")
    _gauge = _st_row("AMES 1.5 NNE", "US1IASR0002 6", 7.8, _ap, _as)
    ok(_st_pick([_gauge, _st_row("COOP 14 N", "130000 2", 14.0, _ap, _cs)]) == "COOP 14 N",
       "Story IA: a co-op 14 mi out with rain and snowfall beats the 7.8 mi gauge with snowfall gaps")
    ok(_st_pick([_gauge, _st_row("COOP 30 N", "130000 2", 30.0, _ap, _cs)]) == "AMES 1.5 NNE",
       "past 10 mi farther and twice as far, the nearer gauge stays")
    ok(_st_pick([_gauge, _st_row("COOP 14 N", "130000 2", 14.0, _ap, _cs, nrm="M")]) == "AMES 1.5 NNE",
       "NOAA normals still come before the snowfall record")
    _gappy = ["M" if 40 <= i < 51 else x for i, x in enumerate(_ap)]
    ok(_st_pick([_gauge, _st_row("COOP 14 N", "130000 2", 14.0, _gappy, _cs)]) == "AMES 1.5 NNE",
       "a co-op with 11 rain days missing is not a full record of both")
    ok(_st_pick([_gauge, _st_row("COOP 14 N", "130000 2", 14.0, _ap, ["M"] * 200 + _cs[200:])]) == "AMES 1.5 NNE",
       "a co-op whose snowfall has gaps too is no better")
    _TX = {"48001": {"st": "TX", "name": "Hot County", "slug": "hot-county", "lat": 29.0, "lon": -97.0, "reach": 40}}
    ok(_st_pick([dict(_gauge, meta=dict(_gauge["meta"], county="48001", ll=[-97.0, 29.0 + 7.8 / 69])),
                 dict(_st_row("COOP 14 N", "410000 2", 14.0, _ap, _cs), meta={"name": "COOP 14 N", "sids": ["410000 2"], "ll": [-97.0, 29.0 + 14 / 69], "county": "48001"})],
                C=_TX, st="TX") == "AMES 1.5 NNE", "where snow is not normal, the nearer gauge stays")
    ok(R.snow_state(_ap, _as, 2026) == "gaps" and R.snow_state(_ap, _cs, 2026) == "drawn" and R.snow_state(_ap, ["M"] * len(_ap), 2026) == "none",
       "snow_state on the Story days")
    # snowfall comes in the third column and is packed beside the rain
    _sn = {"meta": _val["meta"], "data": [[r[0], r[1], "1.5" if i == 3 else "T" if i == 4 else "0.0"] for i, r in enumerate(_val["data"])]}
    _o = build_state(_Src([_sn]), "IA", 2026, "2026-04-10", _SC, "2026-04-11T00:00:00Z")
    _dl = _o["_daily"]["19001"]
    ok(R.unpack_days(_dl.get("s", ""))[3:5] == ["1.50", "T"] and len(R.unpack_days(_dl["p"])) == _o["counties"]["19001"]["days"],
       f"snowfall packed beside the rain, day for day: {_dl}")
    for _v in (["0.00"] * 5 + ["T", "1.25", "S", "S", "2.50A", "M", "M", "0.10", "0.10", "0.00"], [], ["M"], ["0.004", "12.30"]):
        ok(R.unpack_days(R.pack_days(_v)) == [x if x in ("M", "T", "S") else f"{round(float(x.rstrip('A')) * 100) / 100:.2f}" + ("A" if x.endswith("A") else "") for x in _v],
           f"pack and unpack round trip: {_v}")
    # the gauges around caught little, but on and off (south Florida, Jan-Feb 2026)
    def _sprinkle(name, sid, ll, fips, gap=False):
        return {"meta": {"name": name, "sids": [sid], "ll": ll, "county": fips},
                "data": [["M" if gap and i == 5 else _wet(i, True) if not 30 <= i < 70 else ("0.05" if i % 5 == 0 else "0.00"), "0.10"]
                         for i in range(100)]}
    _spr = [_sprinkle("GOOD", "2 2", [-93.05, 42.05], "19001", gap=True), _sprinkle("NEAR", "3 2", [-93.3, 42.0], "19003")]
    ok(_pick([_g("STUCK", "1 2", [-93.0, 42.0], "19001", True)] + _spr) == "GOOD",
       "0.00 for 44 days while the gauges around caught a little every few days is left out")
    _des = [_g(x[0], x[1], x[2], x[3], False, nrm="0.01", gap=x[4]) for x in (("GOOD", "2 2", [-93.05, 42.05], "19001", True), ("NEAR", "3 2", [-93.3, 42.0], "19003", False))]
    ok(_pick([_g("STUCK", "1 2", [-93.0, 42.0], "19001", True, nrm="0.01")] + _des) == "STUCK",
       "desert: 40 days at 0.00 is 0.4 in of usual, not a stuck gauge")
    # last year stuck at 0.00 for 40 days while the station next door caught rain:
    # no comparison with last year; the same station with a sound last year keeps it
    class _Src2:
        def __init__(self, this, last): self.this, self.last = this, last
        def call(self, q): return {"data": self.this if "state" in q else self.last}

    def _ly(name, sid, ll, fips, dry):
        return {"meta": {"name": name, "sids": [sid], "ll": ll, "county": fips},
                "data": [[_wet(i, dry)] for i in range(100)]}
    _this = [_g("A", "1 2", [-93.0, 42.0], "19001", False), _g("B", "3 2", [-93.3, 42.0], "19003", False)]
    _o = build_state(_Src2(_this, [_ly("A", "1 2", [-93.0, 42.0], "19001", True), _ly("B", "3 2", [-93.3, 42.0], "19003", False)]),
                     "IA", 2026, "2026-04-10", _SC, "2026-04-11T00:00:00Z")
    ok(_o["counties"]["19001"]["last"] is None and _o["counties"]["19003"]["last"] is not None,
       f"a stuck run last year withholds last year: {[_o['counties'][f]['last'] and _o['counties'][f]['last']['total'] for f in ('19001', '19003')]}")
    # last year under 40% of this year on the shared days, the counties around near 1 to 1: withheld
    def _l(tb, lb): return {"name": "x", "total": tb, "station": {"raw": "G"}, "last": {"both": 280, "this_both": tb, "last_both": lb, "total": lb}}
    _files = {"FL": {"counties": {"1": _l(49.0, 7.15), "2": _l(48.0, 45.0), "3": _l(50.0, 52.0), "4": _l(47.0, 40.0),
                                  "5": _l(30.0, 9.0), "6": _l(30.0, 9.5), "7": _l(31.0, 10.0), "8": _l(29.0, 8.0),
                                  "9": _l(4.0, 1.0)}, "none": {}}}
    _dropped = hold_last_year(_files, _files, {"1": ["2", "3", "4"], "5": ["6", "7", "8"], "6": ["5", "7", "8"],
                                                "7": ["5", "6", "8"], "8": ["5", "6", "7"], "9": ["2", "3", "4"]})
    ok(_dropped == ["1"] and _files["FL"]["counties"]["1"]["last"] is None and _files["FL"]["counties"]["5"]["last"],
       f"a last year far under this one is withheld unless the counties around fell the same way; dry country kept: {_dropped}")
    # Ocracoke is in Hyde County NC, but the simplified outline leaves the island out
    _H = {"37095": {"st": "NC", "name": "Hyde County", "slug": "h", "lat": 35.5294, "lon": -76.2645, "reach": 24.2}}
    _out = build_state(_Src([_row("OCRACOKE", "316349 2", [-75.9872, 35.1075], "37095")]),
                       "NC", 2026, "2026-01-20", _H, "2026-01-21T00:00:00Z")
    ok("37095" in _out["counties"], f"an island station just past the county outline is kept: {sorted(_out['counties'])}")
    # a gauge far below every county around it is held; dry country is not
    def _c(p, u): return {"name": "x", "pct": p, "usual": u, "n_ok": 2, "station": {"raw": "GAUGE"}}
    _files = {"AR": {"counties": {"1": _c(24, 25.0), "2": _c(77, 25.0), "3": _c(80, 25.0), "4": _c(70, 25.0),
                                  "5": _c(30, 2.6)}, "none": {}}}
    _N = {"1": ["2", "3", "4"], "5": ["2", "3", "4"]}
    _held = hold_outliers(_files, _files, _N)
    ok(_held == ["1"] and "1" in _files["AR"]["none"] and "5" in _files["AR"]["counties"],
       f"stuck gauge held, desert county kept: {_held}")
    # a gauge with no normal (no percent) is held on its total; a dry-country one is not
    def _t(t): return {"name": "x", "pct": None, "usual": None, "total": t, "n_ok": 1, "station": {"raw": "GAUGE"}}
    _files = {"KY": {"counties": {"1": _t(3.1), "2": _t(37.0), "3": _t(40.2), "4": _t(38.5),
                                  "5": _t(1.2), "6": _t(6.0), "7": _t(7.5), "8": _t(5.0)}, "none": {}}}
    _files["KY"]["counties"].update({"9": _t(4.11), "10": _t(29.5), "11": _t(23.2), "12": _t(4.36), "13": _t(2.85), "14": _t(22.5)})
    _held = hold_outliers(_files, _files, {"1": ["2", "3", "4"], "5": ["6", "7", "8"], "9": ["10", "11", "12", "13", "14"]})
    ok(_held == ["1"], f"no-normal gauge far under its neighbors' totals held; dry country and a rain shadow kept: {_held}")
    # a dry run counts an A total of 0.00 as dry and ends on a day snow fell,
    # as Rain Print's derive does (2026-10-19: Allerton IA, Wayne County, Feb 7
    # 0.00A then 12 days at 0.00 is 13 days; the page said 12)
    _fx = json.load(open(os.path.join(ROOT, "test", "fixtures", "rain-snow", "days.json")))["wayne_ia"]
    _wp, _ws = R.unpack_days(_fx["p"]), R.unpack_days(_fx["s"])
    _wd = R.days_of(2026, "2026-01-01", len(_wp))
    s, _ = R.summarize(2026, _wd, _wp, None, _fx["as_of"], _ws)
    ok(s and s["dry"] == [13, "2026-02-07", "2026-02-19"], f"Allerton's dry run takes in the 0.00A day: {s and s['dry']}")
    s, _ = R.summarize(2026, d14, ["0.20"] + ["0.00"] * 13, None, "2026-01-14", ["0.0"] * 6 + ["1.5"] + ["0.0"] * 7)
    ok(s and s["dry"] == [7, "2026-01-08", "2026-01-14"], f"a day snow fell ends a dry run: {s and s['dry']}")
    s, _ = R.summarize(2026, d14, ["0.20"] + ["0.00"] * 13, None, "2026-01-14")
    ok(s and s["dry"] == [13, "2026-01-02", "2026-01-14"], f"no snowfall record: zeros are dry: {s and s['dry']}")
    # 0.00 for 60 days or more is refused outright, with or without a normal
    d70 = R.days_of(2026, "2026-01-01", 70)
    s, why = R.summarize(2026, d70, ["0.00"] * 70, None, "2026-03-11")
    ok(s is None and "0.00" in why, f"a gauge at 0.00 for 70 days is refused: {why}")
    s, why = R.summarize(2026, d70[:50], ["0.00"] * 50, None, "2026-02-19")
    ok(s is not None, f"50 days at 0.00 (a desert winter) is not refused by this rule: {why}")
    # an S run that ends in a plain value, not an A, lost its rain: those days are gaps
    d40 = R.days_of(2026, "2026-01-01", 40)
    s, _ = R.summarize(2026, d40[:20], ["0.10"] * 10 + ["S", "S", "0.30"] + ["0.10"] * 7, ["0.05"] * 20, "2026-01-20")
    ok(s and s["missing"] == 2 and s["unsplit"] == 0 and s["reported"] == 18, f"S run not closed by an A is M: {s and (s['missing'], s['unsplit'])}")
    s, _ = R.summarize(2026, d40[:30], ["0.10"] * 10 + ["S", "S", "M"] + ["0.10"] * 17, ["0.05"] * 30, "2026-01-30")
    ok(s and s["missing"] == 3, f"S run ended by a gap is a gap: {s and s['missing']}")
    s, _ = R.summarize(2026, d40[:20], ["0.10"] * 10 + ["S", "S", "0.90A"] + ["0.10"] * 7, ["0.05"] * 20, "2026-01-20")
    ok(s and s["missing"] == 0 and s["unsplit"] == 2 and s["acc"] == 1, f"S run closed by its A stays reported: {s and (s['missing'], s['unsplit'])}")
    # trailing S days (the A that ends them has not come in) are not reported yet
    d40 = R.days_of(2026, "2026-01-01", 40)
    s, _ = R.summarize(2026, d40, ["0.10"] * 36 + ["S", "S", "S", "M"], ["0.05"] * 40, "2026-02-09")
    ok(s and s["as_of"] == "2026-02-05" and s["unsplit"] == 0 and s["acc"] == 0, f"trailing S days wait for their A: {s and (s['as_of'], s['unsplit'])}")
    s, why = R.summarize(2026, dates, ["0.1", "M", "M", "0.1", "0.1", "0.1", "0.1", "0.1", "0.1", "0.1", "0.1", "0.1"], norms, "2026-01-12")
    ok(s is None and "83%" in why, f"under 90% of days: withheld ({why})")
    s, why = R.summarize(2026, dates, ["0.1"] * 12, norms, "2026-01-30")
    ok(s is None and "last report" in why, f"a station gone quiet is not current: {why}")
    s, _ = R.summarize(2026, dates, ["0.1"] * 12, ["0.1"] * 5 + ["M"] + ["0.1"] * 6, "2026-01-12")
    ok(s and s["usual"] is None and s["pct"] is None, "a reported day without a normal withholds the comparison")
    s, _ = R.summarize(2026, dates, ["0.05"] * 12, ["0.05"] * 12, "2026-01-12")
    ok(s and s["usual"] == 0.6 and s["pct"] is None, f"early in the year: no percent ({s and s['pct']})")
    # leap year: Feb 29 is a day, its normal falls back to Feb 28's, last year stops at Feb 28
    ld = R.days_of(2024, "2024-01-01", 60)
    ok(ld[-1] == "2024-02-29", f"leap day is in the year: {ld[-1]}")
    s, _ = R.summarize(2024, ld, ["0.05"] * 60, ["0.04"] * 59 + ["M"], "2024-02-29")
    ok(s and s["usual"] == 2.4 and s["days"] == 60, f"Feb 29 normal from Feb 28: {s and s['usual']}")
    ok(R.same_date_last_year("2024-02-29") == "2023-02-28", "Feb 29 compares with Feb 28")
    lt = R.last_year_total(["0.10"] * 59, "2023-01-01", "2023-02-28")
    ok(lt and lt["total"] == 5.9 and lt["days"] == 59, f"last year to the same date: {lt}")
    ok(R.last_year_total(["0.10"] * 40, "2023-01-01", "2023-02-28") is None, "last year with too few days: withheld")
    # last year missed 28 June days: compared only on the days both years reported
    ty = R.days_of(2026, "2026-01-01", 285)
    this = {d[5:]: "0.10" for d in ty}
    lv = ["0.10" if not d[5:].startswith("06-") or d[8:] > "28" else "M" for d in R.days_of(2025, "2025-01-01", 285)]
    lt = R.last_year_total(lv, "2025-01-01", "2025-10-12", this)
    ok(lt and lt["reported"] == 257 and lt["both"] == 257 and lt["this_both"] == lt["last_both"] == 25.7,
       f"last year's gaps are left out of this year's side too: {lt}")
    this["03-03"] = "M"
    lt = R.last_year_total(lv, "2025-01-01", "2025-10-12", this)
    ok(lt and lt["both"] == 256 and lt["last_both"] == 25.6, f"this year's gaps are left out of last year's side: {lt}")
    ok(R.station_name("AMES 8 WSW") == "Ames, 8 mi WSW", "station name plain words")
    ok(R.station_where("AMES 8 WSW") == "8 miles west-southwest of Ames", R.station_where("AMES 8 WSW"))
    ok(R.station_town("DES MOINES INTL AP") == "Des Moines", "town of an airport station")
    # the town is what Rain Print geocodes: site words are not part of it
    for raw, town in (("GARDEN CITY EXP STN", "Garden City"), ("FORT RANDALL DAM", "Fort Randall"),
                      ("CEDAR RAPIDS NO 1", "Cedar Rapids"), ("WALNUT GROVE #2", "Walnut Grove"),
                      ("LAKE CITY RSCH CTR", "Lake City"), ("ROSEMOUNT AGRI EXP STN", "Rosemount"),
                      ("DUBUQUE LOCK AND DAM 11", "Dubuque"), ("GUTTENBERG L&D 10", "Guttenberg"),
                      ("OTTUMWA WTP", "Ottumwa"), ("ESTES PARK RANGER STN", "Estes Park"),
                      ("LOCK HAVEN", "Lock Haven"), ("PLANT CITY", "Plant City"), ("RANGER", "Ranger"),
                      ("COLLEGE STATION", "College Station"), ("NEW ULM 2 SE", "New Ulm"),
                      # the places left after the first full run (2026-10-13 polish)
                      ("PHILADELPHIA/MT. HOLLY WFO", "Philadelphia"), ("WILKES-BARRE/SCRANTON INTERNATIONAL AIRPORT", "Wilkes-Barre"),
                      ("GLENS FALLS/FLOYD BENNETT MEMORIAL AIRPORT", "Glens Falls"), ("GUTTENBERG L/D 10", "Guttenberg"),
                      ("CROOKSTON NW EXP STA", "Crookston"), ("EFFINGHAM SE", "Effingham"), ("SULPHUR 4NNE MESONET", "Sulphur"),
                      ("THOMPSON FALLS PH", "Thompson Falls"), ("BEAUMONT EXP.STATION", "Beaumont"),
                      ("GRAND ISLAND CENTRAL NE REGIONAL AP", "Grand Island"), ("N FK ELK CREEK", "North Fork Elk Creek"),
                      ("DERR.", "Derr"), ("ST. GEORGE", "St. George"), ("CENTRAL CITY", "Central City"), ("WEST POINT", "West Point")):
        ok(R.station_town(raw) == town, f"station_town({raw!r}) = {R.station_town(raw)!r}, want {town!r}")
    ok(R.station_where("NEW ULM 2 SE") == "2 miles southeast of New Ulm", f"NEW is not a direction: {R.station_where('NEW ULM 2 SE')}")
    ok(R.station_name("NEW HAMPTON") == "New Hampton", f"NEW HAMPTON: {R.station_name('NEW HAMPTON')}")
    ok(R.station_name("OAKES 2 S") == "Oakes, 2 mi S", R.station_name("OAKES 2 S"))
    # names from the first real Iowa run (2026-10-13)
    for raw, name, town in (("SALEM1 S", "Salem, 1 mi S", "Salem"), ("MAPLETON NO.2", "Mapleton No. 2", "Mapleton"),
                            ("REMSEN NO. 2", "Remsen No. 2", "Remsen"), ("BELLEVUE L/D 12", "Bellevue Lock and Dam 12", "Bellevue"),
                            ("OTTUMWA INDUSTRIAL AP", "Ottumwa Industrial Airport", "Ottumwa"), ("MANCHESTER #2", "Manchester #2", "Manchester"),
                            ("ANAMOSA 3 SSW", "Anamosa, 3 mi SSW", "Anamosa"), ("MUSCATINE 2N", "Muscatine, 2 mi N", "Muscatine")):
        ok(R.station_name(raw) == name, f"station_name({raw!r}) = {R.station_name(raw)!r}, want {name!r}")
        ok(R.station_town(raw) == town, f"station_town({raw!r}) = {R.station_town(raw)!r}, want {town!r}")
    # names from the first full run (2026-10-13 accuracy review)
    for raw, where, town in (("EADS .45 E", "less than a mile east of Eads", "Eads"),
                             ("RED LEVEL 0.5 SW", "less than a mile southwest of Red Level", "Red Level"),
                             ("(W9DBA)MORGANTOWN", "in Morgantown", "Morgantown"),
                             ("(W9DBA)MORGANTOWN 6.7 SSE", "6.7 miles south-southeast of Morgantown", "Morgantown"),
                             ("MISSOULA 6 NW WFO", "6 miles northwest of Missoula", "Missoula"),
                             ("NORTH LITTLE ROCK WFO", "in North Little Rock", "North Little Rock"),
                             ("GRANTSBURG 0.6 SW (KWIGRANT1)", "less than a mile southwest of Grantsburg", "Grantsburg"),
                             ("GLOVERSVILLE 7NW (PECK LAKE)", "7 miles northwest of Gloversville", "Gloversville"),
                             ("SPRINGFIELD WSO AP", "at Springfield Airport", "Springfield"),
                             ("WINSTON-SALEM 4.2 NNE", "4.2 miles north-northeast of Winston-Salem", "Winston-Salem"),
                             ("CAMDEN 1.0 NNE", "1 mile north-northeast of Camden", "Camden"),
                             ("UNIVERSITY", "in University", "University"),
                             ("UNIVERSITY OF MN ST. PAUL", "University of Mn St. Paul", "University of Mn St. Paul"),
                             ("GREENUP LOCKS AND DAM", "in Greenup", "Greenup"),
                             ("Eastern Band of Cherokee Indians", "Eastern Band of Cherokee Indians", "Eastern Band of Cherokee Indians")):
        ok(R.station_where(raw) == where, f"station_where({raw!r}) = {R.station_where(raw)!r}, want {where!r}")
        ok(R.station_town(raw) == town, f"station_town({raw!r}) = {R.station_town(raw)!r}, want {town!r}")
        ok(" ." not in R.station_name(raw) + R.station_town(raw), f"a stray point in {raw!r}")
    ok(R.station_name("EADS .45 E") == "Eads, 0.45 mi E", R.station_name("EADS .45 E"))
    ok(R.station_name("MOSCOW U OF I") == "Moscow U of I", R.station_name("MOSCOW U OF I"))
    ok(R._title(["A", "1"]).split() == ["A", "1"], "a word is written once")
    ok(R.network(["US1IAST0001 10"]) == "cocorahs" and R.network(["130200 2"]) == "noaa", "network from sid type")
    # the whole pipeline on saved ACIS answers
    C = R.counties()
    aw = C.get("02016")
    ok(aw and aw["lon"] < -160 and 50 < aw["lat"] < 58, f"Aleutians West's middle is in the Aleutians, not Colorado: {aw}")
    ok(all(c["lon"] < -125 for c in C.values() if c["st"] == "AK"), "every Alaska county's middle is in Alaska")
    stp = {"schema": SCHEMA, "year": 2026, "counties": {"02016": {
        "as_of": "2026-10-10", "total": 10, "reported": 280, "missing": 3, "days": 283, "months": [[10, None, 280, 283]],
        "usual": None, "pct": None, "max_day": None, "cum": [[0, 10, None]],
        "station": {"name": "St Paul Island Airport", "mi": round(R.miles(aw["lat"], aw["lon"], 57.155, -170.222), 1)}}}}
    ok(problems(stp, "AK", C) == [], f"St Paul Island, inside Aleutians West, is not refused as too far: {problems(stp, 'AK', C)}")
    stp["counties"]["19169"] = dict(stp["counties"]["02016"], station={"name": "x", "mi": 330})
    ok(len(problems(stp, "IA", C)) == 1, "a station 330 miles from an Iowa county's middle is still refused")
    with tempfile.TemporaryDirectory() as d:
        for st, year, ed in (("IA", 2026, "2026-10-12"), ("KS", 2026, "2026-10-12"), ("DE", 2024, "2024-12-31")):
            n2, f2 = run(FixtureSource(fx), [st], year, ed, d, C)
            ok(st in n2 and not f2, f"{st} fixture runs: {f2}")
        ia = json.load(open(os.path.join(d, "ia.json")))
        ok(ia["normals"] == "1991-2020", f"normals period recorded: {ia['normals']}")
        st = ia["counties"].get("19169")
        ok(st is not None, "Story County has a station")
        if st:
            ok(st["station"]["raw"] == "AMES 8 WSW", f"the complete station wins over a nearer gappy one: {st['station']}")
            ok(st["last"] and st["last"]["through"] == "2025-10-12", f"last year to the same date: {st['last']}")
            ok(st["missing"] > 0 and st["usual"] is not None, "Story has gaps and a usual")
        ok("19079" in ia["none"] and ia["none"]["19079"]["near"] in ia["counties"], f"Hamilton: no station, nearest given: {ia['none'].get('19079')}")
        ok(ia["none"].get("19015", {}).get("stations") == 1, f"Boone: one station, too few days: {ia['none'].get('19015')}")
        ks = json.load(open(os.path.join(d, "ks.json")))
        ok(ks["normals"] == "current", f"normals '91' refused falls back to '1', period not claimed: {ks['normals']}")
        kc = next(iter(ks["counties"].values()), None)
        ok(kc and kc["acc"] >= 1 and kc["unsplit"] >= 1, "KS fixture carries S and A days")
        de = json.load(open(os.path.join(d, "de.json")))
        dc = next(iter(de["counties"].values()), None)
        ok(dc and dc["days"] == 366 and dc["as_of"] == "2024-12-31", f"leap year has 366 days: {dc and dc['days']}")
        ok(check(d) == 0, "fixture output passes --check")
        # the days behind each county, for the county page's Rain Print
        iad = json.load(open(os.path.join(d, DAILY_DIR, "ia.json")))
        ok(iad["schema"] == DAILY_SCHEMA and sorted(iad["counties"]) == sorted(ia["counties"]),
           f"a daily file with every county in the state file: {len(iad['counties'])} of {len(ia['counties'])}")
        if st:
            sd = R.unpack_days(iad["counties"]["19169"]["p"])
            ok(len(sd) == st["days"] and "M" in sd, f"Story's days run Jan 1 to its as-of day, gaps kept: {len(sd)} of {st['days']}")
            ok("s" not in iad["counties"]["19169"], "no snowfall record, no snowfall in the daily file")
        kd = json.load(open(os.path.join(d, DAILY_DIR, "ks.json")))
        ok(any("S" in R.unpack_days(x["p"]) for x in kd["counties"].values()), "S days are kept as S, not as 0")
        bad = json.loads(json.dumps(iad))
        f0 = sorted(bad["counties"])[0]
        bad["counties"][f0]["p"] = R.pack_days(R.unpack_days(bad["counties"][f0]["p"])[:-1])
        ok(daily_problems(bad, ia, "x"), "a daily file a day short of its county is refused")
        bad["counties"][f0]["p"] = R.pack_days(["9.99"] + R.unpack_days(iad["counties"][f0]["p"])[1:])
        ok(daily_problems(bad, ia, "x"), "a daily file that does not add to the county's total is refused")
        # a thin answer is refused and the published file kept
        p = os.path.join(d, "ia.json")
        fat = json.load(open(p))
        for i in range(40):
            fat["counties"][f"19{900 + i}"] = dict(next(iter(fat["counties"].values())))
        json.dump(fat, open(p, "w"))
        n3, f3 = run(FixtureSource(fx), ["IA"], 2026, "2026-10-12", d, C)
        ok(f3 == ["IA"] and len(json.load(open(p))["counties"]) == len(fat["counties"]), "thin answer refused, published file kept")
        # a state with no saved answer fails alone
        n4, f4 = run(FixtureSource(fx), ["WY"], 2026, "2026-10-12", d, C)
        ok(f4 == ["WY"] and not os.path.exists(os.path.join(d, "wy.json")), "a failed state writes nothing")
    ok(default_year_and_edate(dt.date(2027, 1, 2)) == (2026, "2026-12-31"), "January fetches the finished year")
    ok(default_year_and_edate(dt.date(2026, 10, 13)) == (2026, "2026-10-12"), "otherwise through yesterday")
    for f in fails:
        print("FAIL", f)
    print("county rain fetch selftest:", "ok" if not fails else f"{len(fails)} failure(s)")
    return 0 if not fails else 1


def main(argv):
    def arg(k):
        return argv[argv.index(k) + 1] if k in argv and argv.index(k) + 1 < len(argv) else None
    if "--selftest" in argv:
        return selftest()
    out = arg("--out") or OUT
    if "--check" in argv:
        return check(out)
    year, edate = default_year_and_edate(central_today())
    if arg("--year"):
        year = int(arg("--year"))
        t = central_today()
        edate = (t - dt.timedelta(days=1)).isoformat() if year == t.year else f"{year}-12-31"
    if arg("--edate"):
        edate = arg("--edate")
        year = int(edate[:4])
    states = [s.strip().upper() for s in (arg("--states") or ",".join(R.STATES)).split(",") if s.strip()]
    C = R.counties()
    if arg("--fixtures"):
        src = FixtureSource(arg("--fixtures"))
        deadline = None
    else:
        deadline = time.time() + MAX_MINUTES * 60
        src = Source(deadline)
    print(f"county rain: {year}, Jan 1 to {edate}, {len(states)} states", flush=True)
    new, failed = run(src, states, year, edate, out, C, deadline)
    print(f"done: {len(new)} states written, {len(failed)} kept ({', '.join(failed) or 'none'}), {src.calls} ACIS calls")
    return 0 if new and not failed else (2 if new else 1)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
