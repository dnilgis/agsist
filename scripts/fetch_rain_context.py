#!/usr/bin/env python3
"""fetch_rain_context.py: two more facts per county rain page, from RCC-ACIS.

Run by .github/workflows/county-rain.yml right after fetch_county_rain.py, best effort.
Writes data/rain/context/<st>.json (a subfolder, so build_county_rain.py's
data/rain/*.json glob and fetch_county_rain.py --check never see it).

  1. County average (PRISM). GridData grid 21 (PRISM, 4 km, daily), the state, Jan 1 to
     the state file's edate, area_reduce county_mean: one rain total per county.
     The usual: Grid2 ncei-norm:91-20 (NCEI 1991-2020 gridded normals), same reduction.
     A check on the one station each page reads: a gauge that catches or misses a storm
     shows up as a gap between the two.
  2. On record. MultiStnData for the chosen stations, interval [1,0,0], duration ytd,
     reduce sum: rain from Jan 1 to the same day in every year of the station's record.
     Years over the missing-day limit come back "M" and are not counted.
     One call per distinct "last day reported" in the state (most stations share one).

All three calls were run by hand on 2026-10-24 (Wisconsin, Cumberland 471923, through
Oct 22); the answers are test/fixtures/rain-context/. The sandbox cannot reach ACIS.

A state whose calls fail keeps its published context file. build_county_rain.py uses a
context file only when its "fetched" equals the state file's, so a stale one prints nothing.

  python3 scripts/fetch_rain_context.py              every state in data/rain
  python3 scripts/fetch_rain_context.py --states WI  some states
  python3 scripts/fetch_rain_context.py --selftest   offline, on the saved answers
"""
import glob
import json
import os
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAIN = os.path.join(ROOT, "data", "rain")
OUT = os.path.join(RAIN, "context")
SCHEMA = "agsist-rain-context/1"
GRID_URL = "https://data.rcc-acis.org/GridData"
GRID2_URL = "https://grid2.rcc-acis.org/GridData"
MULTI_URL = "https://data.rcc-acis.org/MultiStnData"
UA = "agsist.com county rain (https://agsist.com/rain; daily)"
TIMEOUT_S = 120
BACKOFF_S = (15, 45)
MAX_MINUTES = 20
FIRST_YEAR = 1850          # ACIS answers "M" for years before a station began
MIN_YEARS = 30             # fewer counted years than this: no "on record" line
NO_GRID = {"AK", "HI"}
YTD = {"name": "pcpn", "interval": "dly", "duration": "ytd", "reduce": "sum", "area_reduce": "county_mean"}


class Net:
    def __init__(self, deadline):
        self.deadline = deadline

    def get(self, url, params):
        q = url + "?" + urllib.parse.urlencode({"params": json.dumps(params, separators=(",", ":"))})
        err = None
        for attempt in range(len(BACKOFF_S) + 1):
            if time.time() > self.deadline:
                raise TimeoutError("time cap reached")
            try:
                req = urllib.request.Request(q, headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
                    return json.loads(r.read().decode("utf-8"))
            except Exception as e:  # noqa: BLE001
                err = e
                if attempt < len(BACKOFF_S):
                    print(f"  ACIS: {e}; retrying in {BACKOFF_S[attempt]}s", flush=True)
                    time.sleep(BACKOFF_S[attempt])
        raise RuntimeError(f"ACIS failed after retries: {err}")


class Saved:
    """Answers saved by hand (test/fixtures/rain-context): grid-<st>.json, norm-<st>.json, hist-<st>.json."""
    def __init__(self, d):
        self.d = d

    def get(self, url, params):
        kind = "norm" if url == GRID2_URL else "grid" if url == GRID_URL else "hist"
        st = (params.get("state") or params.get("_st") or "").lower()
        p = os.path.join(self.d, f"{kind}-{st}.json")
        return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else {"error": "no saved answer"}


def num(v):
    """ACIS value -> float or None. 'T' (trace) is 0; an 'A' (accumulated) suffix is dropped."""
    if v in (None, "M", "", -999):
        return None
    if v == "T":
        return 0.0
    try:
        x = float(str(v).rstrip("A"))
    except ValueError:
        return None
    return None if x <= -998 else x


def area_values(j, st_fips):
    """{fips: inches} for this state's counties from a county_mean answer (the bounding box brings neighbours)."""
    try:
        row = j["data"][0][1]
    except (KeyError, IndexError, TypeError):
        return {}
    return {f: round(v, 2) for f, v in row.items() if f[:2] == st_fips and isinstance(v, (int, float)) and v >= 0}


def rank_of(vals, first_year):
    """vals: one year-to-date total per year from first_year, the last being this year.
    Returns the counted years and where this year sits, or None when it cannot be said."""
    this = num(vals[-1]) if vals else None
    years = [(first_year + i, num(v)) for i, v in enumerate(vals[:-1])]
    years = [(y, v) for y, v in years if v is not None]
    if this is None or len(years) + 1 < MIN_YEARS:
        return None
    wetter = [y for y, v in years if v > this + 0.005]
    drier = [y for y, v in years if v < this - 0.005]
    return {"this": round(this, 2), "n": len(years) + 1, "first": years[0][0],
            "wetter": len(wetter), "drier": len(drier),
            "last_wetter": max(wetter) if wetter else None, "last_drier": max(drier) if drier else None}


def state_fips(d):
    f = next(iter(d.get("counties") or {}), "")
    return f[:2]


def build_state(src, d):
    st, edate = d["state"], d["edate"]
    year = int(edate[:4])
    sf = state_fips(d)
    out = {}
    # PRISM and the gridded normals cover the lower 48 only: Alaska and Hawaii get the rank, no county average
    # (2026-10-24: ACIS answered 400 for both and the whole state was skipped, rank included)
    gv = nv = {}
    if st not in NO_GRID:
        g = src.get(GRID_URL, {"state": st.lower(), "grid": "21", "date": edate, "elems": [YTD]})
        n = src.get(GRID2_URL, {"state": st.lower(), "grid": "ncei-norm:91-20", "date": edate, "elems": [YTD]})
        gv, nv = area_values(g, sf), area_values(n, sf)
    for f in d["counties"]:
        if f in gv:
            out.setdefault(f, {})["grid"] = {"total": gv[f], "usual": nv.get(f)}
    # stations by their last reported day; Feb 29 has no same day in other years, so no rank that day
    by_day = {}
    for f, c in d["counties"].items():
        asof = c.get("as_of") or ""
        if asof[:4] == str(year) and asof[5:] != "02-29":
            by_day.setdefault(asof, []).append((f, c["station"]["sid"], c.get("days") or 0))
    for asof, rows in sorted(by_day.items()):
        allow = max(3, max(r[2] for r in rows) // 20)          # 5% of the days, at least 3
        j = src.get(MULTI_URL, {"_st": st, "sids": ",".join(r[1] for r in rows), "sdate": f"{FIRST_YEAR}{asof[4:]}",
                                "edate": asof, "meta": "sids",
                                "elems": [{"name": "pcpn", "interval": [1, 0, 0], "duration": "ytd", "reduce": "sum", "maxmissing": allow}]})
        hist = {}
        for s in j.get("data") or []:
            for sid in (s.get("meta") or {}).get("sids") or []:
                hist[sid] = [v[0] if isinstance(v, list) else v for v in s.get("data") or []]
        for f, sid, _ in rows:
            vals = hist.get(sid)
            r = rank_of(vals, FIRST_YEAR) if vals else None
            # this year's figure must be the page's own total, or the two reads disagree: say nothing
            if r and abs(r["this"] - d["counties"][f]["total"]) < 0.015:
                r.pop("this")
                out.setdefault(f, {})["rank"] = r
    return {"schema": SCHEMA, "state": st, "year": d["year"], "edate": edate, "fetched": d["fetched"],
            "source": "RCC-ACIS: PRISM grid 21 and NCEI 1991-2020 gridded normals (county means); station records (MultiStnData)",
            "counties": out}


def run(src, states=None, rain=RAIN, out=OUT):
    os.makedirs(out, exist_ok=True)
    ok = bad = 0
    for p in sorted(glob.glob(os.path.join(rain, "*.json"))):
        d = json.load(open(p, encoding="utf-8"))
        st = d.get("state")
        if not st or (states and st not in states) or not d.get("counties"):
            continue
        try:
            res = build_state(src, d)
        except Exception as e:  # noqa: BLE001
            print(f"  {st}: kept the published context ({e})", flush=True)
            bad += 1
            continue
        if not res["counties"]:
            print(f"  {st}: nothing came back; kept the published context", flush=True)
            bad += 1
            continue
        json.dump(res, open(os.path.join(out, st.lower() + ".json"), "w", encoding="utf-8"), separators=(",", ":"))
        g = sum(1 for c in res["counties"].values() if "grid" in c)
        r = sum(1 for c in res["counties"].values() if "rank" in c)
        print(f"  {st}: county average {g}, on record {r} of {len(d['counties'])}", flush=True)
        ok += 1
    print(f"rain context: {ok} states written, {bad} kept", flush=True)
    return 0


def selftest():
    import tempfile
    fx = os.path.join(ROOT, "test", "fixtures", "rain-context")
    fails = []

    def ok(c, m):
        if not c:
            fails.append(m)
    ok(num("T") == 0.0 and num("1.20A") == 1.2 and num("M") is None and num(-999) is None, "num")
    # Cumberland (471923), saved 2026-10-24: 1850 is index 0; 2026 = 28.05, 2025 = 32.01
    h = json.load(open(os.path.join(fx, "hist-wi.json"), encoding="utf-8"))["data"][0]["data"]
    vals = [v[0] for v in h]
    r = rank_of(vals, FIRST_YEAR)
    ok(r and r["this"] == 28.05, f"this year {r}")
    ok(r and r["last_wetter"] == 2025, f"last wetter {r}")
    ok(r and r["n"] == r["wetter"] + r["drier"] + 1 + sum(1 for v in vals[:-1] if num(v) == 28.05), f"counts {r}")
    ok(rank_of(vals[-20:], FIRST_YEAR) is None, "under 30 years says nothing")
    ok(rank_of(vals[:-1] + ["M"], FIRST_YEAR) is None, "this year missing says nothing")
    # whole state through the saved answers
    with tempfile.TemporaryDirectory() as t:
        rain, out = os.path.join(t, "rain"), os.path.join(t, "ctx")
        os.makedirs(rain)
        d = {"state": "WI", "year": 2026, "edate": "2026-10-22", "fetched": "x",
             "counties": {"55005": {"as_of": "2026-10-22", "days": 295, "total": 28.05, "station": {"sid": "471923 2"}},
                          "55003": {"as_of": "2026-10-22", "days": 295, "total": 99.0, "station": {"sid": "000000 2"}}}}
        json.dump(d, open(os.path.join(rain, "wi.json"), "w"))
        run(Saved(fx), None, rain, out)
        c = json.load(open(os.path.join(out, "wi.json")))
        b = c["counties"].get("55005", {})
        ok(b.get("grid") == {"total": 24.22, "usual": 29.47}, f"Barron grid {b.get('grid')}")
        ok("rank" in b, "Barron rank")
        ok("rank" not in c["counties"].get("55003", {}), "a station with no record gets no rank")
        ok("27045" not in c["counties"], "a Minnesota county in the bounding box is dropped")
        ok(c["fetched"] == "x", "fetched carried over")
        # Alaska: no grid asked at all, the rank still written
        asked = []
        class Spy(Saved):
            def get(self, url, params):
                asked.append(url)
                return Saved.get(self, url, dict(params, _st="wi")) if url == MULTI_URL else {"error": "outside the grid"}
        dak = dict(d, state="AK", counties={"02020": dict(d["counties"]["55005"])})
        rak = build_state(Spy(fx), dak)
        ok(GRID_URL not in asked and GRID2_URL not in asked, "no grid asked for Alaska")
        ok("rank" in rak["counties"].get("02020", {}) and "grid" not in rak["counties"]["02020"], "Alaska keeps its rank")
    print("fetch_rain_context selftest:", "ok" if not fails else "FAIL " + "; ".join(fails))
    return 1 if fails else 0


def main(argv):
    if "--selftest" in argv:
        return selftest()
    states = None
    if "--states" in argv and argv.index("--states") + 1 < len(argv):
        states = {s.strip().upper() for s in argv[argv.index("--states") + 1].split(",") if s.strip()}
    return run(Net(time.time() + MAX_MINUTES * 60), states)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
