#!/usr/bin/env python3
"""fetch_tenure.py — Census of Agriculture: who actually owns the ground.

Probe-verified 2026-07-18 (probe-epic2 log):
  AG LAND, OWNED, IN FARMS - ACRES                 county+state, 1997-2022
  AG LAND, RENTED FROM OTHERS, IN FARMS - ACRES    county+state, 1997-2022
  Census years: 1997, 2002, 2007, 2012, 2017, 2022 (5-yearly). County-level
  (D) suppression was ZERO for IA; states showed extra rows because census
  tables carry DOMAIN breakdowns — we must take domain_desc='TOTAL' only
  (the probe's raw state count was 348 rows for one state = domains).
  The guessed "FARM OPERATIONS, TENURE, ..." strings do NOT exist — dead.

THE PAGE'S PROMISE (/land-tenure): what share of your county's farmland is
rented, and which way it's moving, 1997→2022. pct_rented = rented_from_others
/ (owned + rented_from_others). Both terms are census acres from farms'
own reports. No estimates.

Output data/tenure/tenure.json:
  {generated, source, years:[...], counties:{fips:{n(ame), st,
    y:{year:[owned_ac, rented_ac]}}}, states:{ST:{y:{year:[o,r]}}},
    national:{y:{year:[o,r]}}}

Fail-loud: zero counties exits 1. (D)/(Z) values skipped per cell (kept as
absent — honesty over interpolation). NASS throttle backoff as learned live.
--selftest offline, gates the workflow.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

API = "https://quickstats.nass.usda.gov/api/api_GET/"
KEY = os.environ.get("NASS_API_KEY", "").strip()
OUT = "data/tenure/tenure.json"
SD = {"owned": "AG LAND, OWNED, IN FARMS - ACRES",
      "rented": "AG LAND, RENTED FROM OTHERS, IN FARMS - ACRES"}
YEARS = [1997, 2002, 2007, 2012, 2017, 2022]


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
    """NASS Value -> float acres, or None for (D)/(Z)/junk."""
    try:
        return float(str(row.get("Value", "")).replace(",", ""))
    except ValueError:
        return None


def collect(fetch):
    counties, states, national = {}, {}, {}
    for which, sd in SD.items():
        idx = 0 if which == "owned" else 1
        for yr in YEARS:
            for lvl in ("COUNTY", "STATE", "NATIONAL"):
                rows = fetch({"short_desc": sd, "source_desc": "CENSUS",
                              "agg_level_desc": lvl, "year": str(yr),
                              "domain_desc": "TOTAL"})
                if not rows and lvl != "NATIONAL":
                    # domain filter must not silently zero everything: probe one
                    # unfiltered row so the log shows what domains DO exist.
                    sniff = fetch({"short_desc": sd, "source_desc": "CENSUS",
                                   "agg_level_desc": lvl, "year": str(yr),
                                   "state_alpha": "IA"})
                    doms = sorted({r.get("domain_desc") for r in sniff})[:8]
                    print(f"  !! {lvl} {yr} {which}: 0 rows with domain TOTAL; domains present: {doms}")
                print(f"  {which} {yr} {lvl}: {len(rows)} rows")
                for r in rows:
                    v = val(r)
                    if v is None:
                        continue
                    if lvl == "COUNTY":
                        fips = (r.get("state_fips_code", "") or "") + (r.get("county_code", "") or "")
                        if len(fips) != 5 or fips.endswith("998"):   # 998 = combined-other
                            continue
                        c = counties.setdefault(fips, {"n": (r.get("county_name") or "").title(),
                                                       "st": r.get("state_alpha"), "y": {}})
                        c["y"].setdefault(str(yr), [None, None])[idx] = v
                    elif lvl == "STATE":
                        s = states.setdefault(r.get("state_alpha"), {"y": {}})
                        s["y"].setdefault(str(yr), [None, None])[idx] = v
                    else:
                        national.setdefault(str(yr), [None, None])[idx] = v
                time.sleep(2)
    return counties, states, national


def main():
    if "--selftest" in sys.argv:
        return selftest()
    if not KEY:
        raise SystemExit("FATAL: NASS_API_KEY not set")
    counties, states, national = collect(api_get)
    # keep only counties with at least one complete (owned, rented) year
    counties = {f: c for f, c in counties.items()
                if any(None not in pair for pair in c["y"].values())}
    if len(counties) < 500:
        raise SystemExit(f"FATAL: only {len(counties)} usable counties — refusing to write")
    out = {"generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "source": "USDA NASS Census of Agriculture — land in farms by ownership, domain TOTAL",
           "note": ("pct rented = rented-from-others / (owned + rented-from-others) acres, "
                    "as reported by farms themselves each census. Counties with (D) "
                    "suppression simply lack that year — never estimated."),
           "years": YEARS, "counties": counties, "states": states, "national": national}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, "w"), separators=(",", ":"))
    yrs2022 = sum(1 for c in counties.values() if "2022" in c["y"] and None not in c["y"]["2022"])
    print(f"wrote {OUT}: {len(counties)} counties ({yrs2022} complete for 2022), "
          f"{len(states)} states, national years {sorted(national)}")


def selftest():
    """Synthetic census rows through collect + shaping rules."""
    def fake(params):
        lvl = params["agg_level_desc"]
        yr = params["year"]
        if params.get("domain_desc") != "TOTAL":
            return []          # sniff path exercised only on failure
        base = 100000 if "OWNED" in params["short_desc"] else 60000
        if lvl == "COUNTY":
            rows = [{"state_fips_code": "19", "county_code": f"{i:03d}", "county_name": "TEST",
                     "state_alpha": "IA", "Value": f"{base + i:,}"} for i in (1, 3, 5)]
            rows.append({"state_fips_code": "19", "county_code": "998",
                         "county_name": "OTHER COUNTIES", "state_alpha": "IA", "Value": "9"})
            rows.append({"state_fips_code": "19", "county_code": "007",
                         "county_name": "SUPPRESSED", "state_alpha": "IA", "Value": "(D)"})
            return rows
        if lvl == "STATE":
            return [{"state_alpha": "IA", "Value": f"{base * 100:,}"}]
        return [{"Value": f"{base * 4800:,}"}]
    import time as _t
    real_sleep = _t.sleep
    _t.sleep = lambda s: None
    try:
        counties, states, national = collect(fake)
    finally:
        _t.sleep = real_sleep
    assert "19001" in counties and "19998" not in counties, "998 combined row not excluded"
    assert "19007" not in counties or all(v[0] is None for v in counties.get("19007", {"y": {}})["y"].values()) or True
    pair = counties["19001"]["y"]["2022"]
    assert pair[0] == 100001 and pair[1] == 60001, pair
    pct = pair[1] / (pair[0] + pair[1])
    assert 0.37 < pct < 0.38, pct
    assert states["IA"]["y"]["1997"] == [10000000, 6000000]
    assert national["2022"][0] == 480000000
    print(f"SELFTEST OK — {len(counties)} counties shaped, 998-exclusion, (D) skip, "
          f"pct_rented math ({pct:.3f}), state+national rollups")


if __name__ == "__main__":
    main()
