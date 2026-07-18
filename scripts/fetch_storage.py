#!/usr/bin/env python3
"""fetch_storage.py — grain storage capacity vs what the state actually grew.

Probe-verified 2026-07-18 (probe-epic2 log), traps confirmed and handled:
  GRAIN STORAGE CAPACITY, OFF FARM - CAPACITY, MEASURED IN BU
  GRAIN STORAGE CAPACITY, ON FARM - CAPACITY, MEASURED IN BU
    STATE level; 2020+ rows are ALL reference_period_desc='FIRST OF DEC'
    (single ref period — we still pin it explicitly and say so).
    'OT' pseudo-state (= "other states", combined small states) EXCLUDED
    from rankings, kept in the national sum with a note.
  Production: reference_period_desc='YEAR' ONLY (probe shows AUG/SEP/OCT/NOV
    FORECAST rows living beside finals — the classic contamination).

THE PAGE'S PROMISE (/storage-crunch): this state grew X bu of grain and has
Y bu of licensed+on-farm space — a crunch ratio, ranked, with history.
Grain = corn + soybeans + wheat + sorghum + barley + oats (page says exactly
this; soybeans are an oilseed but they sit in the same bins).

Output data/storage/storage.json:
  {generated, states:{ST:{cap:{year:[on,off]}, prod:{year:total_bu},
   ratio:{year: prod/cap_total}}}, national:{...}, latest_year}

Fail-loud: zero capacity rows or zero production rows exits 1.
--selftest offline, gates the workflow.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone

API = "https://quickstats.nass.usda.gov/api/api_GET/"
KEY = os.environ.get("NASS_API_KEY", "").strip()
OUT = "data/storage/storage.json"
FIRST_YEAR = 2000
CAP = {"on": "GRAIN STORAGE CAPACITY, ON FARM - CAPACITY, MEASURED IN BU",
       "off": "GRAIN STORAGE CAPACITY, OFF FARM - CAPACITY, MEASURED IN BU"}
CAP_REF = "FIRST OF DEC"
PROD = ["CORN, GRAIN - PRODUCTION, MEASURED IN BU",
        "SOYBEANS - PRODUCTION, MEASURED IN BU",
        "WHEAT - PRODUCTION, MEASURED IN BU",
        "SORGHUM, GRAIN - PRODUCTION, MEASURED IN BU",
        "BARLEY - PRODUCTION, MEASURED IN BU",
        "OATS - PRODUCTION, MEASURED IN BU"]


def api_get(params):
    q = dict(params)
    q["key"] = KEY
    q["format"] = "JSON"
    url = API + "?" + urllib.parse.urlencode(q)
    last = None
    for attempt, pause in enumerate((0, 45, 120, 300)):
        if pause:
            print(f"  NASS throttled — backoff {pause}s (retry {attempt}/3)", file=sys.stderr)
            time.sleep(pause)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "AGSIST/1.0 (+https://agsist.com)"})
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.loads(r.read().decode("utf-8", "replace")).get("data", [])
        except urllib.error.HTTPError as e:
            if e.code == 400:
                return []
            if e.code in (403, 429) or e.code >= 500:
                last = e
                continue
            raise
        except Exception as e:  # noqa: BLE001
            last = e
    raise SystemExit(f"FATAL: NASS unreachable after retries: {last}")


def val(row):
    try:
        return float(str(row.get("Value", "")).replace(",", ""))
    except ValueError:
        return None


def collect(fetch):
    cap = defaultdict(lambda: defaultdict(lambda: [None, None]))   # st -> yr -> [on, off]
    for which, sd in CAP.items():
        idx = 0 if which == "on" else 1
        rows = fetch({"short_desc": sd, "agg_level_desc": "STATE",
                      "year__GE": str(FIRST_YEAR),
                      "reference_period_desc": CAP_REF})
        print(f"  capacity {which}-farm: {len(rows)} rows")
        for r in rows:
            v = val(r)
            st, yr = r.get("state_alpha"), str(r.get("year"))
            if v is not None and st and yr:
                cap[st][yr][idx] = v
        time.sleep(2)
    prod = defaultdict(lambda: defaultdict(float))                 # st -> yr -> bu
    prod_n = 0
    for sd in PROD:
        rows = fetch({"short_desc": sd, "agg_level_desc": "STATE",
                      "year__GE": str(FIRST_YEAR),
                      "reference_period_desc": "YEAR"})
        print(f"  production {sd.split(' -')[0]}: {len(rows)} rows")
        prod_n += len(rows)
        for r in rows:
            v = val(r)
            st, yr = r.get("state_alpha"), str(r.get("year"))
            if v is not None and st and yr:
                prod[st][yr] += v
        time.sleep(2)
    return cap, prod, prod_n


def shape(cap, prod):
    states, national = {}, {"cap": {}, "prod": {}, "ratio": {}}
    nat_cap, nat_prod = defaultdict(float), defaultdict(float)
    for st in sorted(cap):
        c = {yr: p for yr, p in cap[st].items()}
        entry = {"cap": {}, "prod": {}, "ratio": {}}
        for yr, (on, off) in sorted(c.items()):
            total = (on or 0) + (off or 0)
            if total <= 0:
                continue
            entry["cap"][yr] = [on, off]
            nat_cap[yr] += total
            p = prod.get(st, {}).get(yr)
            if p:
                entry["prod"][yr] = round(p)
                entry["ratio"][yr] = round(p / total, 3)
        for yr, p in prod.get(st, {}).items():
            nat_prod[yr] += p
        if st != "OT" and entry["ratio"]:
            states[st] = entry
    for yr in sorted(nat_cap):
        national["cap"][yr] = round(nat_cap[yr])
        if nat_prod.get(yr):
            national["prod"][yr] = round(nat_prod[yr])
            national["ratio"][yr] = round(nat_prod[yr] / nat_cap[yr], 3)
    return states, national


def main():
    if "--selftest" in sys.argv:
        return selftest()
    if not KEY:
        raise SystemExit("FATAL: NASS_API_KEY not set")
    cap, prod, prod_n = collect(api_get)
    if not cap:
        raise SystemExit("FATAL: zero capacity rows — refusing to write")
    if prod_n == 0:
        raise SystemExit("FATAL: zero production rows — refusing to write")
    states, national = shape(cap, prod)
    if len(states) < 15:
        raise SystemExit(f"FATAL: only {len(states)} states shaped — something is wrong")
    latest = max(yr for s in states.values() for yr in s["ratio"])
    out = {"generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "source": "USDA NASS Quick Stats — Grain Stocks (capacity, first of Dec) + Crop Production annual",
           "note": ("Grain = corn+soybeans+wheat+sorghum+barley+oats, final YEAR figures only "
                    "(forecast rows excluded). Capacity is on-farm + off-farm, first-of-December. "
                    "'OT' combined-small-states rows are in the national total but never ranked. "
                    "Ratio over 1.0 = the state grew more grain than it can store."),
           "latest_year": latest, "states": states, "national": national}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, "w"), separators=(",", ":"))
    r = {st: s["ratio"].get(latest) for st, s in states.items() if s["ratio"].get(latest)}
    top = max(r, key=r.get)
    print(f"wrote {OUT}: {len(states)} states, latest {latest}, "
          f"tightest {top} at {r[top]:.2f}x capacity")


def selftest():
    """Synthetic capacity+production through collect+shape, traps exercised."""
    def fake(params):
        sd = params["short_desc"]
        if "CAPACITY" in sd:
            assert params["reference_period_desc"] == "FIRST OF DEC", "ref pin missing"
            base = 1000 if "ON FARM" in sd else 800
            rows = []
            for yr in (2023, 2024):
                rows += [{"state_alpha": "IA", "year": yr, "Value": f"{base * 2:,}"},
                         {"state_alpha": "KS", "year": yr, "Value": f"{base:,}"},
                         {"state_alpha": "OT", "year": yr, "Value": "99"},
                         {"state_alpha": "MN", "year": yr, "Value": "(D)"}]
            return rows
        assert params["reference_period_desc"] == "YEAR", "forecast filter missing"
        per = {"CORN": 2000, "SOYBEANS": 600}.get(sd.split(",")[0].split(" -")[0], 100)
        return [{"state_alpha": "IA", "year": yr, "Value": f"{per * 2:,}"}
                for yr in (2023, 2024)] + \
               [{"state_alpha": "KS", "year": yr, "Value": f"{per:,}"} for yr in (2023, 2024)]
    import time as _t
    real_sleep = _t.sleep
    _t.sleep = lambda s: None
    try:
        cap, prod, n = collect(fake)
    finally:
        _t.sleep = real_sleep
    states, national = shape(cap, prod)
    assert "OT" not in states, "OT pseudo-state ranked"
    assert "MN" not in states, "(D)-only state kept"
    ia = states["IA"]
    assert ia["cap"]["2024"] == [2000, 1600]
    # IA prod = (2000+600+100*4)*2 = 6000; cap total 3600 -> 1.667
    assert abs(ia["ratio"]["2024"] - round(6000 / 3600, 3)) < 1e-9, ia["ratio"]
    assert national["cap"]["2024"] == 2000 + 1600 + 1000 + 800 + 99 * 2  # OT in national sum
    print(f"SELFTEST OK — ref-period pins, OT exclusion (rank) + inclusion (national), "
          f"(D) skip, ratio math (IA {ia['ratio']['2024']}x)")


if __name__ == "__main__":
    main()
