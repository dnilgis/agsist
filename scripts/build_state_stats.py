#!/usr/bin/env python3
"""
AGSIST — build data/state-stats.json from USDA NASS Quick Stats.

National per-state corn / soybean / winter-wheat acreage, yield, and production
for the latest final crop year. Output feeds the Fast Facts "State-Level
Production Data" tab (read as data.stateStats).

Requires env NASS_API_KEY (free: https://quickstats.nass.usda.gov/api).
Stdlib only. Run with --selftest to validate parsing/conversion offline.
"""
import os, sys, json, time, datetime, urllib.request, urllib.parse

API = "https://quickstats.nass.usda.gov/api/api_GET/"

# field -> NASS short_desc (uniquely identifies the series)
SERIES = {
    "corn_yield":            "CORN, GRAIN - YIELD, MEASURED IN BU / ACRE",
    "corn_prod":             "CORN, GRAIN - PRODUCTION, MEASURED IN BU",
    "corn_acres_planted":    "CORN - ACRES PLANTED",
    "corn_acres_harvested":  "CORN, GRAIN - ACRES HARVESTED",
    "bean_yield":            "SOYBEANS - YIELD, MEASURED IN BU / ACRE",
    "bean_prod":             "SOYBEANS - PRODUCTION, MEASURED IN BU",
    "bean_acres_planted":    "SOYBEANS - ACRES PLANTED",
    "bean_acres_harvested":  "SOYBEANS - ACRES HARVESTED",
    "wheat_yield":           "WHEAT, WINTER - YIELD, MEASURED IN BU / ACRE",
    "wheat_prod":            "WHEAT, WINTER - PRODUCTION, MEASURED IN BU",
}
# field -> (divisor, round_digits) for display units used by the page
CONV = {
    "corn_yield": (1, 1), "corn_prod": (1e6, 0),
    "corn_acres_planted": (1e6, 1), "corn_acres_harvested": (1e6, 1),
    "bean_yield": (1, 1), "bean_prod": (1e6, 0),
    "bean_acres_planted": (1e6, 1), "bean_acres_harvested": (1e6, 1),
    "wheat_yield": (1, 1), "wheat_prod": (1e6, 0),
}
STATE_NAMES = {
 "AL":"Alabama","AK":"Alaska","AZ":"Arizona","AR":"Arkansas","CA":"California","CO":"Colorado",
 "CT":"Connecticut","DE":"Delaware","FL":"Florida","GA":"Georgia","HI":"Hawaii","ID":"Idaho",
 "IL":"Illinois","IN":"Indiana","IA":"Iowa","KS":"Kansas","KY":"Kentucky","LA":"Louisiana",
 "ME":"Maine","MD":"Maryland","MA":"Massachusetts","MI":"Michigan","MN":"Minnesota","MS":"Mississippi",
 "MO":"Missouri","MT":"Montana","NE":"Nebraska","NV":"Nevada","NH":"New Hampshire","NJ":"New Jersey",
 "NM":"New Mexico","NY":"New York","NC":"North Carolina","ND":"North Dakota","OH":"Ohio","OK":"Oklahoma",
 "OR":"Oregon","PA":"Pennsylvania","RI":"Rhode Island","SC":"South Carolina","SD":"South Dakota",
 "TN":"Tennessee","TX":"Texas","UT":"Utah","VT":"Vermont","VA":"Virginia","WA":"Washington",
 "WV":"West Virginia","WI":"Wisconsin","WY":"Wyoming",
}

def parse_val(v):
    """NASS values are comma-formatted strings; suppressed flags ((D),(NA),(Z),(X)) -> None."""
    if v is None:
        return None
    v = str(v).strip().replace(",", "")
    if not v or v[0] == "(":
        return None
    try:
        return float(v)
    except ValueError:
        return None

def convert(field, raw):
    if raw is None:
        return None
    div, dig = CONV[field]
    val = raw / div
    val = round(val, dig)
    return int(val) if dig == 0 else val

def fetch_series(key, short_desc, year_ge, _opener=None):
    params = {
        "key": key, "short_desc": short_desc, "agg_level_desc": "STATE",
        "source_desc": "SURVEY", "format": "JSON", "year__GE": str(year_ge),
    }
    url = API + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "AGSIST/1.0 (+https://agsist.com)"})
    opener = _opener or urllib.request.urlopen
    last = None
    for attempt in range(4):
        try:
            with opener(req, timeout=60) as r:
                return json.load(r).get("data", [])
        except Exception as e:               # noqa: BLE001 - network/JSON, retry
            last = e
            time.sleep(2 * (attempt + 1))
    print("  ! series failed after retries:", short_desc, "->", last, file=sys.stderr)
    return []

def anchor_year(rows):
    ys = [int(r["year"]) for r in rows if str(r.get("year", "")).isdigit()]
    return max(ys) if ys else None

def field_map(rows, year):
    out = {}
    for r in rows:
        if str(r.get("year")) != str(year):
            continue
        sa = r.get("state_alpha")
        if not sa or sa == "US":
            continue
        out[sa] = parse_val(r.get("Value"))
    return out

def assemble(raw_by_field, year):
    states = set()
    for f in ("corn_yield", "corn_prod", "bean_yield", "bean_prod"):
        states |= set(raw_by_field.get(f, {}).keys())
    stats = {}
    for sa in sorted(states):
        rec = {"name": STATE_NAMES.get(sa, sa), "meta": f"{year} crop year \u00b7 USDA NASS final"}
        has = False
        for field in SERIES:
            val = convert(field, raw_by_field.get(field, {}).get(sa))
            rec[field] = val
            if val is not None:
                has = True
        if has:
            stats[sa] = rec
    return stats

def build(key, out_path):
    this_year = datetime.date.today().year
    year_ge = this_year - 3
    raw_rows = {f: fetch_series(key, sd, year_ge) for f, sd in SERIES.items()}
    yr = anchor_year(raw_rows["corn_yield"]) or anchor_year(raw_rows["bean_yield"])
    if not yr:
        print("No usable NASS data returned; leaving existing file untouched.", file=sys.stderr)
        return 1
    raw_by_field = {f: field_map(rows, yr) for f, rows in raw_rows.items()}
    stats = assemble(raw_by_field, yr)
    payload = {
        "updated": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "year": yr, "source": "USDA NASS Quick Stats",
        "stateStats": stats,
    }
    with open(out_path, "w") as fh:
        json.dump(payload, fh, separators=(",", ":"))
    print(f"[state-stats] year={yr} | states={len(stats)} -> wrote {out_path}")
    return 0

# ---- offline self-test (no network) -------------------------------------
def selftest():
    assert parse_val("2,620,000,000") == 2620000000.0
    assert parse_val("(D)") is None and parse_val("(NA)") is None and parse_val("") is None
    assert convert("corn_prod", 2620000000.0) == 2620          # BU -> M bu (int)
    assert convert("corn_acres_planted", 12900000.0) == 12.9   # AC -> M ac
    assert convert("corn_yield", 211.0) == 211.0               # bu/ac passthrough
    assert convert("bean_prod", None) is None
    mock = {
        "corn_yield":  [{"state_alpha":"IA","year":"2025","Value":"211"},
                        {"state_alpha":"US","year":"2025","Value":"186.5"},
                        {"state_alpha":"IA","year":"2023","Value":"201"}],
        "corn_prod":   [{"state_alpha":"IA","year":"2025","Value":"2,620,000,000"}],
        "bean_yield":  [{"state_alpha":"IA","year":"2025","Value":"60"}],
        "bean_prod":   [{"state_alpha":"IA","year":"2025","Value":"598,000,000"}],
        "wheat_yield": [{"state_alpha":"KS","year":"2025","Value":"50"}],
    }
    for f in SERIES:
        mock.setdefault(f, [])
    yr = anchor_year(mock["corn_yield"]); assert yr == 2025, yr
    raw = {f: field_map(rows, yr) for f, rows in mock.items()}
    assert "US" not in raw["corn_yield"] and raw["corn_yield"]["IA"] == 211.0
    stats = assemble(raw, yr)
    assert stats["IA"]["corn_yield"] == 211.0
    assert stats["IA"]["corn_prod"] == 2620
    assert stats["IA"]["bean_prod"] == 598
    assert stats["IA"]["name"] == "Iowa" and "2025" in stats["IA"]["meta"]
    assert "KS" not in stats  # KS had only wheat, no corn/bean anchor -> excluded
    print("selftest OK:", json.dumps(stats["IA"], separators=(",", ":")))
    return 0

if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    api_key = os.environ.get("NASS_API_KEY", "").strip()
    if not api_key:
        print("ERROR: NASS_API_KEY not set.", file=sys.stderr); sys.exit(2)
    sys.exit(build(api_key, os.environ.get("OUT", "data/state-stats.json")))
