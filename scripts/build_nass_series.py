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
        # PIN THE PERIOD AT THE QUERY, not in a filter afterwards. This is the
        # fix fetch_cond_yield.py has carried since July ("reference_period_desc
        # ='YEAR' pins out the AUG..NOV FORECAST contamination"). This file
        # filtered on the substring instead and let the August 2026 forecast
        # through on ten of eleven datasets -- and inconsistently, which is the
        # tell: wheat-yield.json excluded it while wheat-yield-us.json did not,
        # from the same run, because the label differs by aggregation.
        "reference_period_desc": "YEAR",
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

IN_SEASON_SKIPPED = {"n": 0}

SCOPE = ("final estimates only; USDA in-season forecasts excluded "
         "(reference_period_desc pinned to YEAR at the query, and any year at or "
         "after the current calendar year dropped -- a crop year is not final "
         "until NASS's January annual summary)")


def assert_no_in_season(payload, key):
    """Refuse to WRITE a file whose scope string would be a lie.

    The old scope string was a constant stamped onto the payload whatever the
    rows contained, so for nine days ten of these files declared "in-season
    forecasts excluded" while carrying the August 2026 forecast. A claim that
    cannot fail is not a claim. This one fails the build.
    """
    year_now = datetime.date.today().year
    if payload["type"] == "national":
        bad = sorted(y for y in payload["values"] if int(y) >= year_now)
    else:
        bad = sorted({y for r in payload["rows"] for y in r["values"] if int(y) >= year_now})
    assert not bad, (f"{key}: in-season year(s) {bad} survived into a payload whose scope "
                     f"says forecasts are excluded. Do not publish it.")


def is_forecast(row):
    """True for NASS in-season forecast rows (AUG/SEP/OCT/NOV FORECAST).

    2026-08-15: `build_state_stats.py` published the Aug 12 Crop Production
    forecast as "USDA NASS final". These long-history files are the same trap
    one step worse -- a forecast appended here becomes an unlabelled point
    sitting beside sixteen finals in the USDA Data Explorer charts, and the
    payload schema has nowhere to say which is which. `fetch_cond_yield.py`
    learned this in July ("YEAR-only pin kills AUG-NOV FORECAST
    contamination"); this file never got the fix and fires on the 16th, four
    days after every August Crop Production release.

    These files are explicitly the HISTORICAL series. The in-season number has
    its own surfaces (fast-facts state cards, the nowcast, crop tour), so the
    honest choice here is to leave the forecast out and say so in the payload.
    """
    if "FORECAST" in str(row.get("reference_period_desc", "")).upper():
        return True
    # BELT, BECAUSE THE LABEL CANNOT BE TRUSTED ALONE. A crop year's yield is
    # not final until NASS publishes its annual summary the following January,
    # so any row for the current calendar year or later is an in-season
    # forecast whatever it calls itself. The substring test above was the only
    # guard for a year and it let 2026 through; this one does not depend on
    # NASS's wording staying put.
    try:
        return int(str(row.get("year", "")).strip()) >= datetime.date.today().year
    except ValueError:
        return True


def shape_state(rows, div, dig):
    by_state, years = {}, set()
    for r in rows:
        st = r.get("state_name")
        yr = str(r.get("year", "")).strip()
        if not st or st.upper() == "US TOTAL" or not yr.isdigit():
            continue
        if is_forecast(r):
            IN_SEASON_SKIPPED["n"] += 1
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
        if is_forecast(r):
            IN_SEASON_SKIPPED["n"] += 1
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
                   "source": "USDA NASS Quick Stats", "years": years, "rows": out_rows,
                   "scope": SCOPE, "newest_year": max(years) if years else None}
    else:
        years, vals = shape_national(rows, spec["div"], spec["dig"])
        if not years:
            print(f"  - {key}: no data, skipped"); return False
        payload = {"type": "national", "updated": now, "unit": spec["unit"],
                   "source": "USDA NASS Quick Stats", "years": years, "values": vals,
                   "scope": SCOPE, "newest_year": max(years) if years else None}
    assert_no_in_season(payload, key)
    path = os.path.join(outdir, key + ".json")
    with open(path, "w") as fh:
        json.dump(payload, fh, separators=(",", ":"))
    n = len(payload.get("rows", payload.get("values", [])))
    print(f"  + {key}: {len(years)} yrs, {n} {'states' if spec['agg']=='STATE' else 'points'} -> {path}")
    return True

def build(key_api, outdir):
    os.makedirs(outdir, exist_ok=True)
    wrote = sum(build_one(k, s, key_api, outdir) for k, s in DATASETS.items())
    print(f"[nass-series] wrote {wrote}/{len(DATASETS)} datasets to {outdir} "
          f"| in-season forecast rows excluded: {IN_SEASON_SKIPPED['n']}")
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

    # ---- 2026-08-15: in-season forecast contamination -------------------
    # The Aug 12 Crop Production release puts 2026 AUG FORECAST rows in the
    # same response as sixteen years of finals. This file runs on the 16th.
    # Unfiltered, 2026 lands in the chart as an ordinary point.
    before = IN_SEASON_SKIPPED["n"]
    mixed = [
        {"state_name": "IOWA", "year": "2025", "Value": "219",
         "reference_period_desc": "YEAR"},
        {"state_name": "IOWA", "year": "2026", "Value": "216",
         "reference_period_desc": "YEAR - AUG FORECAST"},
    ]
    yrs, rws = shape_state(mixed, 1, 1)
    assert yrs == [2025], f"in-season forecast leaked into the series: {yrs}"
    assert rws[0]["values"] == {"2025": 219.0}, rws[0]
    nyrs, nvals = shape_national(
        [{"year": "2025", "Value": "186.5", "reference_period_desc": "YEAR"},
         {"year": "2026", "Value": "180.7", "reference_period_desc": "YEAR - AUG FORECAST"}], 1, 1)
    assert nyrs == [2025] and nvals == {"2025": 186.5}, (nyrs, nvals)
    assert IN_SEASON_SKIPPED["n"] - before == 2, IN_SEASON_SKIPPED
    # a row with no reference_period_desc at all is still treated as final
    y2, r2 = shape_state([{"state_name": "IOWA", "year": "2024", "Value": "200"}], 1, 1)
    assert y2 == [2024], y2

    # ---- 2026-08-20: the label was never enough -------------------------
    # The substring test above catches a row that SAYS "AUG FORECAST". It let
    # 2026 through on ten of eleven datasets anyway, because the label is not
    # applied consistently across aggregations -- wheat-yield.json excluded it
    # while wheat-yield-us.json did not, from the same run. A current-year row
    # is an in-season forecast whatever it is called.
    yr = datetime.date.today().year
    assert is_forecast({"year": str(yr), "reference_period_desc": "YEAR"}), \
        "a current-year row labelled YEAR is still an in-season forecast"
    assert is_forecast({"year": str(yr + 1), "reference_period_desc": "YEAR"})
    assert not is_forecast({"year": str(yr - 1), "reference_period_desc": "YEAR"})
    assert is_forecast({"year": "", "reference_period_desc": "YEAR"}), \
        "an unparseable year must be refused, not admitted"
    ys, rs = shape_state([{"state_name": "IOWA", "year": str(yr - 1), "Value": "211"},
                          {"state_name": "IOWA", "year": str(yr), "Value": "216"}], 1, 1)
    assert ys == [yr - 1], ys
    assert str(yr) not in rs[0]["values"], rs

    # ---- the scope string must not be able to lie -----------------------
    # It used to be a constant stamped on whatever the rows contained, so for
    # nine days ten files declared "forecasts excluded" while carrying one.
    good = {"type": "national", "values": {str(yr - 1): 186.5}, "scope": SCOPE}
    assert_no_in_season(good, "good")
    for bad in ({"type": "national", "values": {str(yr): 180.7}},
                {"type": "state", "rows": [{"state": "Iowa", "values": {str(yr): 216.0}}]}):
        try:
            assert_no_in_season(bad, "bad")
            raise SystemExit("assert_no_in_season did not refuse an in-season year")
        except AssertionError as e:
            assert "Do not publish it" in str(e), e
    assert "YEAR" in SCOPE and "January" in SCOPE, "the scope must state the rule it applied"

    print("selftest OK — shaping, suppression, US-exclusion, conversion, "
          "in-season forecast exclusion")
    return 0

if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    api_key = os.environ.get("NASS_API_KEY", "").strip()
    if not api_key:
        print("ERROR: NASS_API_KEY not set.", file=sys.stderr); sys.exit(2)
    sys.exit(build(api_key, os.environ.get("OUT_DIR", "data/nass")))
