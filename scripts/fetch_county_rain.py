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
  least 90% of the days so far and current within 10 days. Among those: one
  with NOAA normals first, then the most days reported, then nearest the
  middle of the county. A county with none is listed as having no NOAA station
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


def ask_state(src, st, year, edate):
    """(rows, normals period or None, normals used?) for one state."""
    base = {"state": st, "sdate": f"{year}-01-01", "edate": edate, "meta": "name,state,sids,ll,county"}
    for code, period in NORMALS:
        j = src.call(dict(base, elems=[{"name": "pcpn", "interval": "dly"}, {"name": "pcpn", "interval": "dly", "normal": code}]))
        if "error" not in j and isinstance(j.get("data"), list):
            return j["data"], period, True
        print(f"  {st}: normals '{code}' refused ({j.get('error')})", flush=True)
    j = src.call(dict(base, elems=[{"name": "pcpn", "interval": "dly"}]))
    if "error" in j or not isinstance(j.get("data"), list):
        raise RuntimeError(f"{st}: {j.get('error') or 'no data'}")
    return j["data"], None, False


def ask_last_year(src, st, sids, as_of_last):
    if not sids:
        return []
    y = as_of_last[:4]
    j = src.call({"sids": ",".join(sids), "_st": st, "sdate": f"{y}-01-01", "edate": as_of_last,
                  "elems": [{"name": "pcpn", "interval": "dly"}], "meta": "name,state,sids,ll,county"})
    if "error" in j or not isinstance(j.get("data"), list):
        print(f"  {st}: last year not available ({j.get('error')})", flush=True)
        return []
    return j["data"]


# ---------------------------------------------------------------- one state

def build_state(src, st, year, edate, C, fetched):
    rows, period, has_norm = ask_state(src, st, year, edate)
    n = (dt.date.fromisoformat(edate) - dt.date.fromisoformat(f"{year}-01-01")).days + 1
    dates = R.days_of(year, f"{year}-01-01", n)
    mine = {f: c for f, c in C.items() if c["st"] == st}
    cands = {}
    seen = 0
    for s in rows:
        meta = s.get("meta") or {}
        fips = str(meta.get("county") or "")
        if fips not in mine or not meta.get("ll") or not meta.get("sids"):
            continue
        seen += 1
        data = [R.row_values(r) for r in (s.get("data") or [])][:n]
        if len(data) < n:
            data += [["M", "M"]] * (n - len(data))
        vals = [r[0] if r else "M" for r in data]
        norms = [r[1] if len(r) > 1 else "M" for r in data] if has_norm else None
        summ, why = R.summarize(year, dates, vals, norms, edate)
        lon, lat = meta["ll"][0], meta["ll"][1]
        c = mine[fips]
        mi = R.miles(c["lat"], c["lon"], lat, lon)
        # Farther from the middle than any corner of the county: NOAA's county
        # code and the station's place disagree (2026-10-13: WHITESTONE FARMS,
        # near Delta Junction, filed under North Slope Borough, 411 mi out).
        # Leave that station out of this county instead of refusing the state.
        if c.get("reach") and mi > c["reach"] + 5:
            print(f"  {st} {fips}: skipping {meta.get('name')} ({mi:.0f} mi out, the county reaches {c['reach']:.0f})", flush=True)
            continue
        cand = {"meta": meta, "summary": summ, "why": why, "mi": mi, "vals": vals}
        cands.setdefault(fips, []).append(cand)
    picked, none = {}, {}
    for fips, c in sorted(mine.items()):
        ok = sorted((x for x in cands.get(fips, []) if x["summary"]), key=R.rank_key)
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
    out = {}
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
    return {"schema": SCHEMA, "state": st, "year": int(year), "edate": edate, "fetched": fetched,
            "normals": ("1991-2020" if period else "current") if has_norm else None,
            "source": "NOAA daily records through RCC-ACIS (MultiStnData)",
            "stations_in_counties": seen, "counties": out, "none": none}


# A gauge that reads under 40% of what the counties around it read, where a
# usual year to date is 10 inches or more, is far more likely stuck or
# clogged than that dry (2026-10-13: Blytheville airport, Mississippi County
# AR, 7.68 in and 24% of usual with every neighbor near 77%). Dry country is
# left alone: there one storm can make a county look nothing like the next.
ODD_LOW, ODD_MIN_USUAL, ODD_MIN_NBRS = 0.40, 10.0, 3


def hold_outliers(files, new, N):
    """Move a county whose gauge reads far below all its neighbors into "none"."""
    pct = {f: c["pct"] for d in files.values() for f, c in d["counties"].items() if c.get("pct")}
    held = []
    for st, d in new.items():
        for f, c in list(d["counties"].items()):
            if not c.get("pct") or (c.get("usual") or 0) < ODD_MIN_USUAL:
                continue
            nb = sorted(pct[n] for n in N.get(f, []) if n in pct)
            if len(nb) < ODD_MIN_NBRS:
                continue
            mid = nb[len(nb) // 2] if len(nb) % 2 else (nb[len(nb) // 2 - 1] + nb[len(nb) // 2]) / 2
            if c["pct"] < ODD_LOW * mid:
                d["none"][f] = {"name": c["name"], "stations": c.get("n_ok") or 1, "held": c["station"]["raw"]}
                del d["counties"][f]
                held.append(f)
                print(f"  {st} {f}: holding {c['station']['raw']} ({c['pct']}% of usual, the counties around it {mid:.0f}%)", flush=True)
    return held


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
            if not c["station"]["name"] or c["station"]["mi"] > max(200, (C or {}).get(f, {}).get("reach", 0) + 5):
                bad.append(f"{w}: station {c['station']}")
        except (KeyError, TypeError, IndexError) as e:
            bad.append(f"{w}: malformed ({e})")
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
    hold_outliers(allf, new, R.neighbors())
    add_nearest(allf, C)
    for st, d in new.items():
        with open(os.path.join(out_dir, st.lower() + ".json"), "w") as fh:
            json.dump(d, fh, separators=(",", ":"), sort_keys=True)
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
    # a gauge far below every county around it is held; dry country is not
    def _c(p, u): return {"name": "x", "pct": p, "usual": u, "n_ok": 2, "station": {"raw": "GAUGE"}}
    _files = {"AR": {"counties": {"1": _c(24, 25.0), "2": _c(77, 25.0), "3": _c(80, 25.0), "4": _c(70, 25.0),
                                  "5": _c(30, 2.6)}, "none": {}}}
    _N = {"1": ["2", "3", "4"], "5": ["2", "3", "4"]}
    _held = hold_outliers(_files, _files, _N)
    ok(_held == ["1"] and "1" in _files["AR"]["none"] and "5" in _files["AR"]["counties"],
       f"stuck gauge held, desert county kept: {_held}")
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
                      ("COLLEGE STATION", "College Station"), ("NEW ULM 2 SE", "New Ulm")):
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
