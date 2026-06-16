#!/usr/bin/env python3
"""
AGSIST — build the /data/nass/*.json multi-year series for the USDA Quick Stats
"Data Explorer". One file per dataset, in the shape the page already renders:

  state-type:    {"type":"state","updated":...,"unit":...,"years":[...],
                  "rows":[{"state":"Iowa","values":{"2015":178,...}}, ...]}
  national-type: {"type":"national","updated":...,"unit":...,"years":[...],
                  "values":{"2015":4.55,...}}

Source: USDA NASS Quick Stats API. Requires env NASS_API_KEY. Stdlib only.
Run with --selftest to validate parsing/shaping offline.
"""
import os, sys, json, time, datetime, urllib.request, urllib.parse

API = "https://quickstats.nass.usda.gov/api/api_GET/"
START_YEAR = 2010

# dataset key -> query spec. agg: STATE (rows per state) or NATIONAL (one series).
# div: divide raw value; dig: round digits; unit: header label shown by the page.
DATASETS = {
    "corn-yield":  dict(short="CORN, GRAIN - YIELD, MEASURED IN BU / ACRE",          agg="STATE",    div=1,   dig=1, unit="bu/acre"),
    "soy-yield":   dict(short="SOYBEANS - YIELD, MEASURED IN BU / ACRE",             agg="STATE",    div=1,   dig=1, unit="bu/acre"),
    "wheat-yield": dict(short="WHEAT, WINTER - YIELD, MEASURED IN BU / ACRE",        agg="STATE",    div=1,   dig=1, unit="bu/acre"),
    "corn-acres":  dict(short="CORN - ACRES PLANTED",                                agg="STATE",    div=1e6, dig=2, unit="M acres"),
    "soy-acres":   dict(short="SOYBEANS - ACRES PLANTED",                            agg="STATE",    div=1e6, dig=2, unit="M acres"),
    "corn-price":  dict(short="CORN, GRAIN - PRICE RECEIVED, MEASURED IN $ / BU",    agg="NATIONAL", div=1,   dig=2, unit="$/bu"),
    "soy-price":   dict(short="SOYBEANS - PRICE RECEIVED, MEASURED IN $ / BU",       agg="NATIONAL", div=1,   dig=2, unit="$/bu"),
    "wheat-price": dict(short="WHEAT - PRICE RECEIVED, MEASURED IN $ / BU",          agg="NATIONAL", div=1,   dig=2, unit="$/bu"),
    # national yield series — power the homepage-style hero snapshot + trend sparklines
    "corn-yield-us":  dict(short="CORN, GRAIN - YIELD, MEASURED IN BU / ACRE", agg="NATIONAL", div=1, dig=1, unit="bu/acre"),
    "soy-yield-us":   dict(short="SOYBEANS - YIELD, MEASURED IN BU / ACRE",    agg="NATIONAL", div=1, dig=1, unit="bu/acre"),
    "wheat-yield-us": dict(short="WHEAT - YIELD, MEASURED IN BU / ACRE",       agg="NATIONAL", div=1, dig=1, unit="bu/acre"),
}

def parse_val(v):
    if v is None:
        return None
    v = str(v).strip().replace(",", "")
    if not v or v[0] == "(":            # (D)(NA)(Z)(X) suppression flags
        return None
    try:
        return float(v)
    except ValueError:
        return None

def conv(raw, div, dig):
    if raw is None:
        return None
    val = round(raw / div, dig)
    return int(val) if dig == 0 else val

def fetch(key, short, agg, year_ge, _opener=None):
    params = {
        "key": key, "short_desc": short, "agg_level_desc": agg,
        "source_desc": "SURVEY", "format": "JSON", "year__GE": str(year_ge),
    }
    url = API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "AGSIST/1.0 (+https://agsist.com)"})
    opener = _opener or urllib.request.urlopen
    last = None
    for attempt in range(4):
        try:
            with opener(req, timeout=90) as r:
                return json.load(r).get("data", [])
        except Exception as e:           # noqa: BLE001 network/json -> retry
            last = e
            time.sleep(2 * (attempt + 1))
    print("  ! failed:", short, "->", last, file=sys.stderr)
    return []

def shape_state(rows, div, dig):
    by_state, years = {}, set()
    for r in rows:
        st = r.get("state_name")
        yr = str(r.get("year", "")).strip()
        if not st or st.upper() == "US TOTAL" or not yr.isdigit():
            continue
        val = conv(parse_val(r.get("Value")), div, dig)
        if val is None:
            continue
        by_state.setdefault(st.title(), {})[yr] = val
        years.add(int(yr))
    years = sorted(years)
    out_rows = [{"state": st, "values": by_state[st]}
                for st in sorted(by_state, key=lambda s: -sum(1 for _ in by_state[s]))]
    out_rows.sort(key=lambda r: r["state"])
    return years, out_rows

def shape_national(rows, div, dig):
    vals, years = {}, set()
    for r in rows:
        yr = str(r.get("year", "")).strip()
        if not yr.isdigit():
            continue
        val = conv(parse_val(r.get("Value")), div, dig)
        if val is None:
            continue
        vals[yr] = val
        years.add(int(yr))
    return sorted(years), vals

def build_one(key, spec, key_api, outdir):
    rows = fetch(key_api, spec["short"], spec["agg"], START_YEAR)
    now = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    if spec["agg"] == "STATE":
        years, out_rows = shape_state(rows, spec["div"], spec["dig"])
        if not years:
            print(f"  - {key}: no data, skipped"); return False
        payload = {"type": "state", "updated": now, "unit": spec["unit"],
                   "source": "USDA NASS Quick Stats", "years": years, "rows": out_rows}
    else:
        years, vals = shape_national(rows, spec["div"], spec["dig"])
        if not years:
            print(f"  - {key}: no data, skipped"); return False
        payload = {"type": "national", "updated": now, "unit": spec["unit"],
                   "source": "USDA NASS Quick Stats", "years": years, "values": vals}
    path = os.path.join(outdir, key + ".json")
    with open(path, "w") as fh:
        json.dump(payload, fh, separators=(",", ":"))
    n = len(payload.get("rows", payload.get("values", [])))
    print(f"  + {key}: {len(years)} yrs, {n} {'states' if spec['agg']=='STATE' else 'points'} -> {path}")
    return True

def build(key_api, outdir):
    os.makedirs(outdir, exist_ok=True)
    wrote = sum(build_one(k, s, key_api, outdir) for k, s in DATASETS.items())
    print(f"[nass-series] wrote {wrote}/{len(DATASETS)} datasets to {outdir}")
    return 0 if wrote else 1

# ---- offline self-test ---------------------------------------------------
def selftest():
    assert parse_val("12,900,000") == 12900000.0 and parse_val("(D)") is None
    assert conv(12900000.0, 1e6, 2) == 12.9
    assert conv(178.0, 1, 1) == 178.0
    assert conv(4.55, 1, 2) == 4.55
    st_rows = [
        {"state_name": "IOWA", "year": "2025", "Value": "211"},
        {"state_name": "IOWA", "year": "2024", "Value": "211"},
        {"state_name": "ILLINOIS", "year": "2025", "Value": "217"},
        {"state_name": "US TOTAL", "year": "2025", "Value": "186.5"},   # excluded
        {"state_name": "IOWA", "year": "2023", "Value": "(D)"},          # suppressed
    ]
    years, rows = shape_state(st_rows, 1, 1)
    assert years == [2024, 2025], years
    names = [r["state"] for r in rows]
    assert names == ["Illinois", "Iowa"] and "Us Total" not in names, names
    iowa = next(r for r in rows if r["state"] == "Iowa")
    assert iowa["values"] == {"2024": 211.0, "2025": 211.0}, iowa
    nat_rows = [{"year": "2024", "Value": "4.55"}, {"year": "2025", "Value": "4.35"}]
    ny, nv = shape_national(nat_rows, 1, 2)
    assert ny == [2024, 2025] and nv == {"2024": 4.55, "2025": 4.35}, (ny, nv)
    # acres conversion end-to-end
    ac_years, ac_rows = shape_state([{"state_name": "IOWA", "year": "2025", "Value": "12,900,000"}], 1e6, 2)
    assert ac_rows[0]["values"]["2025"] == 12.9
    print("selftest OK — state+national shaping, suppression, US-exclusion, unit conversion")
    return 0

if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    api_key = os.environ.get("NASS_API_KEY", "").strip()
    if not api_key:
        print("ERROR: NASS_API_KEY not set.", file=sys.stderr); sys.exit(2)
    sys.exit(build(api_key, os.environ.get("OUT_DIR", "data/nass")))
