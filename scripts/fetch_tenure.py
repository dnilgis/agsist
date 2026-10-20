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

THE PROMISE (the Farmland Atlas tenure layer and its national picture,
components/atlas-tenure.js; /land-tenure retired 2026-10): what share of your county's farmland is
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



def county_name(fips, nass_title):
    """Census spelling by FIPS (McLean, not .title()'s "Mclean"); see fetch_cash_rent."""
    try:
        from fetch_cash_rent import county_name as cn
    except ImportError:
        return nass_title
    return cn(fips, nass_title)

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


def place_key(row, lvl):
    if lvl == "COUNTY":
        return (row.get("state_fips_code", "") or "") + (row.get("county_code", "") or "")
    if lvl == "STATE":
        return row.get("state_alpha") or ""
    return "US"


def resolve_totals(rows, lvl):
    """One total row per place.

    COUNTY: domain_desc=='TOTAL' only. A county with no TOTAL row is withheld
    for that year. FAULT FOUND 2026-10-20: the old rule took "a place's single
    row whatever its domain label" for pre-2022 counties. That single row is a
    tenure-class subset, not all farms: 1997-2017 counties summed to 46-78% of
    each state's TOTAL (US about 500M of 900M acres), no county-year had a zero
    owned or zero rented cell (full owners rent nothing, tenants own nothing,
    so it is the part-owner class), and the median county read 55% rented
    through 2017 against 35% in 2022. Story IA 2017: 75,063 owned + 133,965
    rented = 209,028 ac, 64.1% rented; 2022 TOTAL: 299,244 ac, 54.9%.

    STATE / NATIONAL: prefer TOTAL; a place's single row is accepted only
    because check_coherence() then holds it against the level below.
    Multiple non-TOTAL rows are ambiguous and DROPPED, not guessed."""
    by_place = {}
    for r in rows:
        by_place.setdefault(place_key(r, lvl), []).append(r)
    out, dropped = [], 0
    for _, rs in by_place.items():
        totals = [r for r in rs if r.get("domain_desc") == "TOTAL"]
        if totals:
            out.append(totals[0])
        elif lvl != "COUNTY" and len(rs) == 1:
            out.append(rs[0])
        else:
            dropped += 1
    if dropped:
        print(f"    !! {dropped} {lvl.lower()} places withheld (no TOTAL row)")
    return out


# A state's published counties must add up to its TOTAL row before any of
# them is printed for that year. Suppression (D) and the 998 combined row pull
# the sum down a little (2022: NV 0.88, AZ 0.90, every other state 0.96-1.00);
# the pre-2022 subset rows sat at 0.05-0.78. Outside the band: withhold.
COHERE_LO, COHERE_HI = 0.85, 1.02


def check_coherence(counties, states, national):
    """Withhold, in place, every county-year of a state whose counties do not
    add up to that state's total, and any national year that is not the sum
    of the states. Returns a list of (what, year, ratio) withheld."""
    gone = []
    for yr in sorted({y for c in counties.values() for y in c["y"]}):
        by_st = {}
        for c in counties.values():
            p = c["y"].get(yr)
            if p and None not in p:
                by_st[c["st"]] = by_st.get(c["st"], 0) + p[0] + p[1]
        for st in sorted({c["st"] for c in counties.values() if yr in c["y"]}):
            sp = (states.get(st) or {}).get("y", {}).get(yr)
            ratio = None if not sp or None in sp or sp[0] + sp[1] <= 0 else by_st.get(st, 0) / (sp[0] + sp[1])
            if ratio is None or not (COHERE_LO <= ratio <= COHERE_HI):
                gone.append((st, yr, None if ratio is None else round(ratio, 3)))
                for c in counties.values():
                    if c["st"] == st:
                        c["y"].pop(yr, None)
    for yr in sorted(national):
        n = national[yr]
        tot = sum(s["y"][yr][0] + s["y"][yr][1] for s in states.values()
                  if yr in s["y"] and None not in s["y"][yr])
        ratio = None if None in n or not tot else (n[0] + n[1]) / tot
        if ratio is None or not (0.98 <= ratio <= 1.02):
            gone.append(("US", yr, None if ratio is None else round(ratio, 3)))
            del national[yr]
    for what, yr, ratio in gone:
        print(f"    !! withheld {what} {yr}: county/state sum ratio {ratio}")
    return gone


def collect(fetch):
    counties, states, national = {}, {}, {}
    for which, sd in SD.items():
        idx = 0 if which == "owned" else 1
        for yr in YEARS:
            for lvl in ("COUNTY", "STATE", "NATIONAL"):
                # LEARNED LIVE (first run, 2026-07-18): pre-2022 county rows do
                # NOT carry domain_desc='TOTAL' — the server-side filter silently
                # dropped 1997-2017 county history. So: fetch UNFILTERED, resolve
                # the total row per place in code, and say what we saw.
                rows = fetch({"short_desc": sd, "source_desc": "CENSUS",
                              "agg_level_desc": lvl, "year": str(yr)})
                doms = sorted({str(r.get("domain_desc")) for r in rows})
                rows = resolve_totals(rows, lvl)
                print(f"  {which} {yr} {lvl}: {len(rows)} total-rows (domains seen: {doms[:6]})")
                for r in rows:
                    v = val(r)
                    if v is None:
                        continue
                    if lvl == "COUNTY":
                        fips = (r.get("state_fips_code", "") or "") + (r.get("county_code", "") or "")
                        if len(fips) != 5 or fips.endswith("998"):   # 998 = combined-other
                            continue
                        c = counties.setdefault(fips, {"n": county_name(fips, (r.get("county_name") or "").title()),
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
    check_coherence(counties, states, national)
    # keep every county with any published cell: a 2022 pair with one part (D)
    # still says the county farms (the Atlas reads it as size unknown, not as
    # no farmland); a county with nothing left after the guard is dropped
    counties = {f: c for f, c in counties.items()
                if any(v is not None for pair in c["y"].values() for v in pair)}
    if len(counties) < 500:
        raise SystemExit(f"FATAL: only {len(counties)} usable counties, refusing to write")
    out = {"generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "source": "USDA NASS Census of Agriculture, land in farms by ownership, domain TOTAL",
           "note": ("pct rented = rented-from-others / (owned + rented-from-others) acres, "
                    "as reported by farms themselves each census. Counties with (D) "
                    "suppression simply lack that year, never estimated. A county year "
                    "is kept only from a TOTAL row, and only where the state's counties "
                    "add up to the state total (pre-2022 county rows are a tenure-class "
                    "subset and are withheld)."),
           "years": YEARS, "counties": counties, "states": states, "national": national}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, "w"), separators=(",", ":"))
    if sum(1 for c in counties.values() if any(None not in p for p in c["y"].values())) < 500:
        raise SystemExit("FATAL: under 500 counties with a complete year, refusing to write")
    yrs2022 = sum(1 for c in counties.values() if "2022" in c["y"] and None not in c["y"]["2022"])
    print(f"wrote {OUT}: {len(counties)} counties ({yrs2022} complete for 2022), "
          f"{len(states)} states, national years {sorted(national)}")


def selftest():
    """Census rows through collect + shaping rules, built on the real 2026-07
    fault (see resolve_totals): pre-2022 county rows are a single non-TOTAL
    tenure-class row; states and the nation carry TOTAL rows."""
    # Real values from the 2026-07-19 file. Story IA (19169) and McLean IL
    # (17113): 2017 single-row subset vs the 2022 TOTAL row. State totals are
    # the real IA and IL TOTAL rows.
    REAL = {
        "19169": {"2017": (75063, 133965), "2022": (134824, 164420)},
        "17113": {"2017": (90624, 332432), "2022": (184802, 412595)},
    }
    ST_TOT = {"IA": {"2017": (14874668, 15689210), "2022": (15043032, 14935133)},
              "IL": {"2017": (11227047, 15779241), "2022": (11607971, 14684070)}}

    def fake(params):
        lvl = params["agg_level_desc"]
        yr = params["year"]
        assert "domain_desc" not in params, "must fetch unfiltered"
        idx = 0 if "OWNED" in params["short_desc"] else 1
        dom = "TOTAL" if yr == "2022" else "TENURE"
        if lvl == "COUNTY":
            rows = []
            for f, ys in REAL.items():
                v = ys["2017" if yr != "2022" else "2022"][idx]
                rows.append({"state_fips_code": f[:2], "county_code": f[2:], "county_name": "X",
                             "state_alpha": "IA" if f.startswith("19") else "IL",
                             "domain_desc": dom, "Value": f"{v:,}"})
            # the rest of each state, so the 2022 counties add up to the state total
            if yr == "2022":
                for st, fp in (("IA", "19"), ("IL", "17")):
                    mine = [REAL[f]["2022"][idx] for f in REAL if f.startswith(fp)]
                    rest = ST_TOT[st]["2022"][idx] - sum(mine)
                    rows.append({"state_fips_code": fp, "county_code": "500", "county_name": "REST",
                                 "state_alpha": st, "domain_desc": "TOTAL", "Value": f"{rest:,}"})
                # domain noise beside a TOTAL row: prefer-TOTAL path
                rows.append({"state_fips_code": "19", "county_code": "169", "county_name": "X",
                             "state_alpha": "IA", "domain_desc": "TENURE", "Value": "1"})
            rows.append({"state_fips_code": "19", "county_code": "998", "county_name": "OTHER COUNTIES",
                         "state_alpha": "IA", "domain_desc": dom, "Value": "9"})
            rows.append({"state_fips_code": "19", "county_code": "007", "county_name": "SUPPRESSED",
                         "state_alpha": "IA", "domain_desc": "TOTAL", "Value": "(D)"})
            return rows
        y = "2017" if yr != "2022" else "2022"
        if lvl == "STATE":
            return [{"state_alpha": st, "domain_desc": "TOTAL", "Value": f"{t[y][idx]:,}"}
                    for st, t in ST_TOT.items()]
        return [{"domain_desc": "TOTAL", "Value": f"{sum(t[y][idx] for t in ST_TOT.values()):,}"}]

    import time as _t
    real_sleep = _t.sleep
    _t.sleep = lambda s: None
    try:
        counties, states, national = collect(fake)
    finally:
        _t.sleep = real_sleep
    assert "19998" not in counties, "998 combined row not excluded"
    story = counties["19169"]["y"]
    assert story["2022"] == [134824, 164420], f"prefer-TOTAL failed: {story['2022']}"
    assert sorted(story) == ["2022"], f"a non-TOTAL county row leaked into the history: {sorted(story)}"
    assert sorted(counties["17113"]["y"]) == ["2022"]
    pct = story["2022"][1] / sum(story["2022"])
    assert 0.549 < pct < 0.550, pct

    # The guard, on the real fault: if a subset row ever arrives labelled
    # TOTAL, the state's counties no longer add up and the year is withheld.
    c2 = {"19169": {"st": "IA", "y": {"2017": [75063, 133965], "2022": [134824, 164420]}},
          "19001": {"st": "IA", "y": {"2017": [6000000, 6000000],
                                      "2022": [15043032 - 134824, 14935133 - 164420]}}}
    s2 = {"IA": {"y": {k: list(v) for k, v in ST_TOT["IA"].items()}}}
    n2 = {"2017": list(ST_TOT["IA"]["2017"]), "2022": list(ST_TOT["IA"]["2022"])}
    gone = check_coherence(c2, s2, n2)
    assert ("IA", "2017") in [(a, b) for a, b, _ in gone], gone
    assert "2017" not in c2["19169"]["y"] and "2022" in c2["19169"]["y"], c2["19169"]
    # suppression inside the band keeps the year (NV 2022 was 0.88)
    c3 = {"32001": {"st": "NV", "y": {"2022": [880, 0]}}}
    gone = check_coherence(c3, {"NV": {"y": {"2022": [1000, 0]}}}, {})
    assert gone == [] and "2022" in c3["32001"]["y"], gone
    # a national year that is not the sum of the states is withheld
    n4 = {"2022": [1, 1]}
    check_coherence({}, {"IA": {"y": {"2022": [10, 10]}}}, n4)
    assert n4 == {}, n4
    print(f"SELFTEST OK: pre-2022 non-TOTAL county rows withheld, prefer-TOTAL, coherence guard, "
          f"998-exclusion, (D) skip, pct math ({pct:.3f})")


if __name__ == "__main__":
    main()
