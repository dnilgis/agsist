#!/usr/bin/env python3
"""
fetch_bids.py — Barchart OnDemand getGrainBids fetcher for AGSIST
Runs via GitHub Actions every 30 min during market hours.
Fetches cash grain bids for a national grid of ZIP codes,
deduplicates, and writes /data/bids.json for the homepage preview card
and the National Basis map (build_basis_map.py reads this file).

The full cash-bids.html page calls Barchart directly (client-side)
for any ZIP — this file only powers the homepage preview widget and
the basis map. Its parsing MUST stay in lockstep with cash-bids.html's
flatten()/classify()/unit-normalization, because that page is the
ground-truth reader of the live response shape.

Environment:
  BARCHART_API_KEY — OnDemand API key (GitHub Secret)
"""

import json
import os
import sys
import time
from datetime import datetime, timezone
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError
from urllib.parse import urlencode

API_KEY = os.environ.get("BARCHART_API_KEY", "")
BASE_URL = "https://ondemand.websol.barchart.com/getGrainBids.json"
MAX_DISTANCE = 60  # miles from each ZIP

# ── The cap that was never lifted ────────────────────────────────
# getGrainBids takes a `totalLocations` parameter. This file never sent one,
# so every ZIP came back with Barchart's DEFAULT of 30 locations — and the
# per-ZIP log printed kept BIDS, not locations, so a ZIP that hit the ceiling
# looked exactly like one that did not. Fifty ZIPs times a silent 30-location
# ceiling is why "this elevator is absent from Barchart" has been an unsafe
# claim: absent from the first 30 within 60 miles is not absent.
#
# 200 is a starting point, not a finding. The run reports saturation per ZIP,
# so the first live run says whether 200 binds. If it does, raise it and run
# again. Measure, do not reason.
TOTAL_LOCATIONS = int(os.environ.get("BARCHART_TOTAL_LOCATIONS", "200"))
OUTPUT_PATH = "data/bids.json"

# ── National grid of ZIP codes ───────────────────────────────────
# ~50 ZIPs across all major US agricultural regions
# Each with 60mi radius gives good national overlap
ZIP_GRID = [
    # ── Upper Midwest ──
    {"zip": "53705", "lat": 43.07, "lng": -89.40, "label": "Madison, WI"},
    {"zip": "54703", "lat": 44.81, "lng": -91.50, "label": "Eau Claire, WI"},
    {"zip": "54481", "lat": 44.52, "lng": -89.57, "label": "Stevens Point, WI"},
    {"zip": "55101", "lat": 44.94, "lng": -93.10, "label": "St Paul, MN"},
    {"zip": "56001", "lat": 44.16, "lng": -93.99, "label": "Mankato, MN"},
    {"zip": "56560", "lat": 46.87, "lng": -96.77, "label": "Moorhead, MN"},
    {"zip": "55901", "lat": 44.02, "lng": -92.47, "label": "Rochester, MN"},
    # ── Corn Belt ──
    {"zip": "50010", "lat": 42.03, "lng": -93.62, "label": "Ames, IA"},
    {"zip": "52001", "lat": 42.50, "lng": -90.66, "label": "Dubuque, IA"},
    {"zip": "51501", "lat": 41.26, "lng": -95.86, "label": "Council Bluffs, IA"},
    {"zip": "50613", "lat": 42.47, "lng": -92.33, "label": "Cedar Falls, IA"},
    {"zip": "61701", "lat": 40.48, "lng": -88.99, "label": "Bloomington, IL"},
    {"zip": "61820", "lat": 40.12, "lng": -88.24, "label": "Champaign, IL"},
    {"zip": "62702", "lat": 39.80, "lng": -89.65, "label": "Springfield, IL"},
    {"zip": "47901", "lat": 40.42, "lng": -86.89, "label": "Lafayette, IN"},
    {"zip": "46077", "lat": 39.96, "lng": -86.16, "label": "Zionsville, IN"},
    {"zip": "43215", "lat": 39.96, "lng": -83.00, "label": "Columbus, OH"},
    {"zip": "45840", "lat": 40.99, "lng": -83.65, "label": "Findlay, OH"},
    {"zip": "48823", "lat": 42.74, "lng": -84.48, "label": "East Lansing, MI"},
    # ── Dakotas ──
    {"zip": "57101", "lat": 43.55, "lng": -96.73, "label": "Sioux Falls, SD"},
    {"zip": "57401", "lat": 45.46, "lng": -98.49, "label": "Aberdeen, SD"},
    {"zip": "58102", "lat": 46.88, "lng": -96.79, "label": "Fargo, ND"},
    {"zip": "58501", "lat": 46.81, "lng": -100.78, "label": "Bismarck, ND"},
    {"zip": "58701", "lat": 48.23, "lng": -101.30, "label": "Minot, ND"},
    # ── Plains ──
    {"zip": "68508", "lat": 40.81, "lng": -96.68, "label": "Lincoln, NE"},
    {"zip": "69101", "lat": 41.13, "lng": -100.76, "label": "North Platte, NE"},
    {"zip": "67002", "lat": 37.69, "lng": -97.33, "label": "Wichita, KS"},
    {"zip": "67501", "lat": 38.05, "lng": -97.93, "label": "Hutchinson, KS"},
    {"zip": "66502", "lat": 39.18, "lng": -96.57, "label": "Manhattan, KS"},
    {"zip": "65201", "lat": 38.95, "lng": -92.33, "label": "Columbia, MO"},
    {"zip": "64801", "lat": 37.08, "lng": -94.51, "label": "Joplin, MO"},
    # ── Southern / Delta ──
    {"zip": "73071", "lat": 35.22, "lng": -97.44, "label": "Norman, OK"},
    {"zip": "79101", "lat": 35.20, "lng": -101.83, "label": "Amarillo, TX"},
    {"zip": "38655", "lat": 34.37, "lng": -89.52, "label": "Oxford, MS"},
    {"zip": "72201", "lat": 34.75, "lng": -92.29, "label": "Little Rock, AR"},
    {"zip": "38301", "lat": 35.61, "lng": -88.81, "label": "Jackson, TN"},
    {"zip": "31201", "lat": 32.84, "lng": -83.63, "label": "Macon, GA"},
    {"zip": "36104", "lat": 32.38, "lng": -86.30, "label": "Montgomery, AL"},
    {"zip": "70503", "lat": 30.22, "lng": -92.02, "label": "Lafayette, LA"},
    # ── Mountain / West ──
    {"zip": "59715", "lat": 45.68, "lng": -111.04, "label": "Bozeman, MT"},
    {"zip": "59401", "lat": 47.51, "lng": -111.30, "label": "Great Falls, MT"},
    {"zip": "82001", "lat": 41.14, "lng": -104.82, "label": "Cheyenne, WY"},
    {"zip": "80525", "lat": 40.55, "lng": -105.07, "label": "Fort Collins, CO"},
    {"zip": "83301", "lat": 42.56, "lng": -114.46, "label": "Twin Falls, ID"},
    # ── Pacific Northwest ──
    {"zip": "99163", "lat": 46.73, "lng": -117.18, "label": "Pullman, WA"},
    {"zip": "99301", "lat": 46.24, "lng": -119.22, "label": "Pasco, WA"},
    {"zip": "97301", "lat": 44.94, "lng": -123.03, "label": "Salem, OR"},
    # ── Southeast / Mid-Atlantic ──
    {"zip": "27601", "lat": 35.78, "lng": -78.64, "label": "Raleigh, NC"},
    {"zip": "23219", "lat": 37.54, "lng": -77.44, "label": "Richmond, VA"},
    {"zip": "19901", "lat": 39.16, "lng": -75.52, "label": "Dover, DE"},
]


def _get(zip_code, max_distance, total_locations):
    """One request. Returns the decoded body, or raises."""
    q = {
        "apikey": API_KEY,
        "zipCode": zip_code,
        "maxDistance": max_distance,
        "getAllBids": 1,
    }
    if total_locations:
        q["totalLocations"] = total_locations
    req = Request(f"{BASE_URL}?{urlencode(q)}", headers={"User-Agent": "AGSIST/1.0"})
    with urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_bids_for_zip(zip_code, max_distance=MAX_DISTANCE,
                       total_locations=TOTAL_LOCATIONS):
    """Fetch grain bids for a single ZIP code.

    Mirrors cash-bids.html: passes getAllBids=1 so Barchart returns the
    full per-elevator payload (without it the response shape is thinner).
    Now also passes totalLocations — see the constant for why.

    Returns (data, degraded). `degraded` is True when the request had to fall
    back to the old no-totalLocations form because Barchart rejected the
    parameter. That fallback is DELIBERATELY LOUD: silently reverting to a
    30-location ceiling is the same class of failure as the green-but-empty
    run this file already carries two guards against.
    """
    try:
        return _get(zip_code, max_distance, total_locations), False
    except (URLError, HTTPError, json.JSONDecodeError) as e:
        if not total_locations:
            print(f"  ⚠ Error fetching ZIP {zip_code}: {e}", file=sys.stderr)
            return None, False
        print(f"  ⚠ ZIP {zip_code}: totalLocations={total_locations} rejected "
              f"({e}) — retrying WITHOUT it, coverage falls back to Barchart's "
              f"default 30 locations", file=sys.stderr)
    try:
        return _get(zip_code, max_distance, None), True
    except (URLError, HTTPError, json.JSONDecodeError) as e:
        print(f"  ⚠ Error fetching ZIP {zip_code}: {e}", file=sys.stderr)
        return None, True


def location_count(data):
    """How many distinct LOCATIONS the response carried.

    Not bids. The two differ by an order of magnitude and only the location
    count can be compared against totalLocations to see whether the ceiling
    bound. Handles both response shapes flatten() handles.
    """
    raw = (data.get("results") or data.get("bids") or data.get("data") or [])
    if not isinstance(raw, list):
        return 0
    if any(isinstance(i, dict) and isinstance(i.get("bids"), list) for i in raw):
        return sum(1 for i in raw
                   if isinstance(i, dict) and isinstance(i.get("bids"), list))
    seen = set()
    for i in raw:
        if not isinstance(i, dict):
            continue
        loc = i.get("location")
        seen.add((
            i.get("company") or i.get("name") or i.get("facility")
            or i.get("locationName") or "",
            loc if isinstance(loc, str) else "",
            i.get("city") or "", i.get("zip") or "",
        ))
    return len(seen)


def _float(val):
    if val is None:
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def _norm_cash(raw):
    """Normalize cash price to dollars/bu.
    Barchart sometimes returns cents (e.g. 370) — mirror cash-bids.html ppu():
    values >30 are treated as cents."""
    v = _float(raw)
    if v is None:
        return None
    if v > 30:
        v = v / 100.0
    return round(v, 4)


def _norm_basis(raw):
    """Normalize basis to dollars/bu.
    Mirror cash-bids.html basisCents() inverted: the feed may send basis in
    cents (e.g. -56) or dollars (e.g. -0.56). basisCents() treats |b|>=5 as
    already-cents, so anything with |b|>=5 is cents → divide by 100. The
    basis map (build_basis_map.py) and fmtB() both expect DOLLARS."""
    v = _float(raw)
    if v is None:
        return None
    if abs(v) >= 5:
        v = v / 100.0
    return round(v, 4)


def classify_commodity(name):
    """Identical logic to cash-bids.html classify()."""
    n = (name or "").lower()
    if "corn" in n:
        return "corn"
    if "soy" in n or "bean" in n:
        return "soybeans"
    if "wheat" in n or "hrw" in n or "srw" in n or "hrs" in n:
        return "wheat"
    if "oat" in n:
        return "oats"
    if "sorghum" in n or "milo" in n:
        return "sorghum"
    return "other"


def _commodity_name(obj):
    return (obj.get("commodity")
            or obj.get("commodity_display_name")
            or obj.get("commodityName")
            or "")


def flatten(data, source_zip):
    """Flatten the Barchart response into per-bid records.

    Ground-truth port of cash-bids.html flatten(): handles BOTH shapes —
    (1) per-elevator objects carrying a `bids` array, and
    (2) already-flat bid objects — using the exact same field fallbacks.
    Keeps a bid only if it has a cash price OR a basis (matching the page).
    """
    flat = []
    raw = (data.get("results")
           or data.get("bids")
           or data.get("data")
           or [])
    if not isinstance(raw, list):
        return flat

    for item in raw:
        if not isinstance(item, dict):
            continue
        nested = item.get("bids")
        if isinstance(nested, list):
            fac = item.get("company") or item.get("name") or item.get("locationName") or "Unknown"
            loc = item.get("location")
            branch = loc if isinstance(loc, str) else ""
            for bid in nested:
                if not isinstance(bid, dict):
                    continue
                cname = _commodity_name(bid)
                flat.append({
                    "facility": fac,
                    "branch": branch,
                    "city": item.get("city") or bid.get("city") or "",
                    "state": (item.get("state") or bid.get("state") or "").upper(),
                    "zip": item.get("zip") or bid.get("zip") or "",
                    "distance": _float(item.get("distance") if item.get("distance") is not None else bid.get("distance")),
                    "phone": item.get("phone") or bid.get("phone") or "",
                    "commodity": cname,
                    "symbol": bid.get("symbol") or bid.get("basisSymbol") or "",
                    "cashPrice": _norm_cash(bid.get("cashprice", bid.get("cashPrice"))),
                    "basis": _norm_basis(bid.get("basis")),
                    "notes": bid.get("notes", ""),
                    "deliveryMonth": bid.get("deliveryMonth") or bid.get("delivery_month") or "",
                    "deliveryStart": bid.get("deliveryStart") or bid.get("delivery_start") or "",
                    "deliveryEnd": bid.get("deliveryEnd") or bid.get("delivery_end") or "",
                    "category": classify_commodity(cname),
                    "sourceZip": source_zip,
                })
        elif (item.get("commodity") or item.get("commodityName")
              or item.get("cashprice") is not None or item.get("cashPrice") is not None):
            cname = _commodity_name(item)
            loc = item.get("location")
            branch = loc if isinstance(loc, str) else ""
            flat.append({
                "facility": item.get("company") or item.get("name") or item.get("facility") or item.get("locationName") or "Unknown",
                "branch": branch,
                "city": item.get("city") or "",
                "state": (item.get("state") or "").upper(),
                "zip": item.get("zip") or "",
                "distance": _float(item.get("distance")),
                "phone": item.get("phone") or "",
                "commodity": cname,
                "symbol": item.get("symbol") or item.get("basisSymbol") or "",
                "cashPrice": _norm_cash(item.get("cashprice", item.get("cashPrice"))),
                "basis": _norm_basis(item.get("basis")),
                "notes": item.get("notes", ""),
                "deliveryMonth": item.get("deliveryMonth") or item.get("delivery_month") or "",
                "deliveryStart": item.get("deliveryStart") or item.get("delivery_start") or "",
                "deliveryEnd": item.get("deliveryEnd") or item.get("delivery_end") or "",
                "category": classify_commodity(cname),
                "sourceZip": source_zip,
            })

    # keep filter — identical to cash-bids.html fetchBids()
    return [b for b in flat if b["cashPrice"] is not None or b["basis"] is not None]


def deduplicate(bids):
    """Deduplicate by facility + branch + commodity + delivery. Keep closest."""
    seen = {}
    for b in bids:
        key = "|".join([
            b.get("facility", ""), b.get("branch", ""), b.get("commodity", ""),
            b.get("deliveryStart", ""), b.get("deliveryEnd", ""), b.get("deliveryMonth", ""),
        ])
        if key not in seen or (b.get("distance") or 999) < (seen[key].get("distance") or 999):
            seen[key] = b
    return list(seen.values())


def main():
    if not API_KEY:
        print("ERROR: BARCHART_API_KEY not set", file=sys.stderr)
        sys.exit(1)

    print(f"[fetch_bids] Starting — {len(ZIP_GRID)} ZIP codes, "
          f"max {MAX_DISTANCE}mi radius, up to {TOTAL_LOCATIONS} locations each")

    all_bids = []
    errors = 0
    raw_total = 0  # bids Barchart returned (kept), for sanity vs. drops
    loc_total = 0
    saturated = []   # ZIPs that came back at the ceiling — the ceiling bound
    degraded = []    # ZIPs that fell back to the 30-location default

    for entry in ZIP_GRID:
        z = entry["zip"]
        print(f"  📍 {entry['label']} ({z})…", end=" ")
        data, fell_back = fetch_bids_for_zip(z)
        if fell_back:
            degraded.append(z)

        if data is None:
            errors += 1
            print("FAIL")
            continue

        locs = location_count(data)
        loc_total += locs
        kept = flatten(data, z)
        raw_total += len(kept)
        all_bids.extend(kept)
        # LOCATIONS as well as kept bids. The bid count alone cannot show a
        # ZIP sitting on the ceiling, which is the whole thing this run is
        # meant to measure.
        ceiling = TOTAL_LOCATIONS if not fell_back else 30
        hit = locs >= ceiling
        if hit:
            saturated.append((z, entry["label"], locs))
        print(f"{locs} locations, {len(kept)} bids{'  ← AT CEILING' if hit else ''}")
        time.sleep(0.3)

    # Report the ceiling BEFORE the dedup summary, because it is the finding
    # that decides whether this grid is complete or merely full.
    print(f"\n[fetch_bids] {loc_total} locations across {len(ZIP_GRID)} ZIPs")
    if degraded:
        print(f"[fetch_bids] ⚠ {len(degraded)} ZIP(s) fell back to Barchart's "
              f"default 30-location cap: {', '.join(degraded)}")
        if len(degraded) == len(ZIP_GRID):
            print("[fetch_bids] ⚠ EVERY ZIP fell back — Barchart is rejecting "
                  "totalLocations outright. Coverage is exactly what it was "
                  "before this parameter was added; do not read this run as "
                  "evidence of anything.")
    if saturated:
        print(f"[fetch_bids] ⚠ {len(saturated)} ZIP(s) returned at the ceiling — "
              f"there are more locations than we asked for. Raise "
              f"BARCHART_TOTAL_LOCATIONS above {TOTAL_LOCATIONS} and run again:")
        for z, label, n in saturated:
            print(f"[fetch_bids]     {label} ({z}): {n}")
        print("[fetch_bids] Until that is clear, 'absent from Barchart' is "
              "NOT a safe claim for anything near these ZIPs.")
    else:
        print(f"[fetch_bids] No ZIP reached {TOTAL_LOCATIONS} locations — the "
              f"ceiling did not bind, so this grid saw everything Barchart "
              f"has within {MAX_DISTANCE} miles of each point.")

    if not all_bids:
        # Fail LOUD: zero bids across every ZIP = dead/expired BARCHART_API_KEY
        # or total outage. Writing an empty bids.json at exit 0 once meant the
        # cash-bids page could go blank silently. Red workflow instead.
        print("[fetch_bids] FATAL: 0 bids collected across all ZIPs — failing loud", flush=True)
        raise SystemExit(1)
    before = len(all_bids)
    all_bids = deduplicate(all_bids)
    print(f"\n[fetch_bids] {before} kept → {len(all_bids)} after dedup")
    print(f"[fetch_bids] Errors: {errors}/{len(ZIP_GRID)} ZIPs")

    all_bids.sort(key=lambda b: (b.get("state") or "", b.get("city") or "", b.get("commodity") or ""))

    zip_index = [{"zip": e["zip"], "lat": e["lat"], "lng": e["lng"], "label": e["label"]} for e in ZIP_GRID]

    commodities = {}
    states = {}
    facilities = set()
    for b in all_bids:
        cat = b.get("category", "other")
        commodities[cat] = commodities.get(cat, 0) + 1
        st = b.get("state", "??")
        states[st] = states.get(st, 0) + 1
        facilities.add(b.get("facility", ""))

    # ── Safety guard ───────────────────────────────────────────────
    # Every ZIP errored, OR the feed returned bids but parsing kept none.
    # Either way: do NOT overwrite a good committed bids.json with an
    # empty one. Exit non-zero so the Action fails loudly instead of
    # going green-while-empty (the bug that hid for weeks).
    if errors == len(ZIP_GRID):
        print(f"ERROR: all {errors} ZIPs failed to fetch — not overwriting "
              f"{OUTPUT_PATH}", file=sys.stderr)
        sys.exit(2)
    if not all_bids:
        print("ERROR: fetch succeeded but ZERO bids parsed — likely a "
              "response-shape/field-name change. Refusing to overwrite "
              f"{OUTPUT_PATH} with an empty file.", file=sys.stderr)
        sys.exit(3)

    output = {
        "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "Barchart OnDemand getGrainBids",
        "zip_grid": zip_index,
        "stats": {
            "total_bids": len(all_bids),
            "facilities": len(facilities),
            "states": len(states),
            "by_commodity": commodities,
            "by_state": dict(sorted(states.items())),
        },
        "bids": all_bids,
    }

    os.makedirs(os.path.dirname(OUTPUT_PATH) or ".", exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(output, f, separators=(",", ":"))

    size_kb = os.path.getsize(OUTPUT_PATH) / 1024
    print(f"[fetch_bids] Wrote {OUTPUT_PATH} ({size_kb:.1f} KB)")
    print(f"[fetch_bids] {len(all_bids)} bids, {len(facilities)} facilities, {len(states)} states")
    print(f"[fetch_bids] Commodities: {commodities}")


def selftest():
    """Offline checks. No API key, no network.

    This file had none. It fetches money numbers into a public page and its
    only safety net was two end-of-run guards, both of which fire long after
    a parsing mistake has already been made.
    """
    import io
    from contextlib import redirect_stdout, redirect_stderr

    checks = 0
    fails = []

    def ck(name, cond):
        nonlocal checks
        checks += 1
        print(f"  {'ok  ' if cond else 'FAIL'} {name}")
        if not cond:
            fails.append(name)

    print("location_count counts LOCATIONS, not bids")
    nested = {"results": [
        {"company": "A", "location": "x", "bids": [{"cashprice": 4.0}, {"cashprice": 4.1}]},
        {"company": "B", "location": "y", "bids": [{"cashprice": 4.2}]},
    ]}
    ck("nested shape: one per elevator, not per bid", location_count(nested) == 2)
    ck("...and flatten sees more bids than there are locations",
       len(flatten(nested, "00000")) == 3)
    flat = {"results": [
        {"company": "A", "city": "Loyal", "zip": "1", "commodity": "Corn", "cashprice": 4.0},
        {"company": "A", "city": "Loyal", "zip": "1", "commodity": "Beans", "cashprice": 9.0},
        {"company": "B", "city": "Thorp", "zip": "2", "commodity": "Corn", "cashprice": 4.1},
    ]}
    ck("flat shape: two commodities at one elevator is ONE location",
       location_count(flat) == 2)
    ck("a response with no list is zero, not a crash",
       location_count({"results": "nope"}) == 0 and location_count({}) == 0)

    print()
    print("the request carries totalLocations, and only when it is set")
    seen = {}

    class FakeResp:
        def __init__(self, body):
            self.body = body
        def read(self):
            return json.dumps(self.body).encode()
        def __enter__(self):
            return self
        def __exit__(self, *a):
            return False

    def fake_open(req, timeout=None):
        seen["url"] = req.full_url
        if seen.get("boom") and "totalLocations" in req.full_url:
            raise HTTPError(req.full_url, 400, "Bad Request", None, None)
        return FakeResp({"results": []})

    real = globals()["urlopen"]
    globals()["urlopen"] = fake_open
    try:
        fetch_bids_for_zip("54436", 60, 200)
        ck("totalLocations is sent when set", "totalLocations=200" in seen["url"])
        ck("the other parameters survive",
           "getAllBids=1" in seen["url"] and "maxDistance=60" in seen["url"]
           and "zipCode=54436" in seen["url"])
        fetch_bids_for_zip("54436", 60, None)
        ck("totalLocations is absent when unset", "totalLocations" not in seen["url"])

        # Barchart rejects the parameter: fall back, but say so.
        seen["boom"] = True
        err = io.StringIO()
        with redirect_stderr(err):
            data, fell = fetch_bids_for_zip("54436", 60, 200)
        ck("a rejected totalLocations falls back rather than losing the ZIP",
           data is not None)
        ck("...and the fallback is reported, not silent", fell is True)
        ck("...loudly, naming the cap it fell back to",
           "default 30 locations" in err.getvalue())
        ck("...and the retry really did drop the parameter",
           "totalLocations" not in seen["url"])
    finally:
        globals()["urlopen"] = real

    print()
    print("saturation is judged against what was asked for")
    for asked, got, want in ((200, 200, True), (200, 199, False),
                             (30, 30, True), (200, 0, False)):
        ck(f"asked {asked}, got {got} -> {'at ceiling' if want else 'below'}",
           (got >= asked) is want)

    print()
    print("dedup still collapses the overlap a bigger radius creates")
    dup = [
        {"facility": "A", "branch": "", "commodity": "Corn", "deliveryStart": "",
         "deliveryEnd": "", "deliveryMonth": "Sep", "distance": 12.0},
        {"facility": "A", "branch": "", "commodity": "Corn", "deliveryStart": "",
         "deliveryEnd": "", "deliveryMonth": "Sep", "distance": 3.0},
        {"facility": "B", "branch": "", "commodity": "Corn", "deliveryStart": "",
         "deliveryEnd": "", "deliveryMonth": "Sep", "distance": 8.0},
    ]
    out = deduplicate(dup)
    ck("one row per facility+commodity+delivery", len(out) == 2)
    ck("the closest of a duplicate pair wins",
       [b for b in out if b["facility"] == "A"][0]["distance"] == 3.0)

    print()
    if fails:
        print(f"{len(fails)} FAILED of {checks}")
        for f in fails:
            print(f"  - {f}")
        return 1
    print(f"all {checks} fetch_bids checks pass")
    return 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    main()
