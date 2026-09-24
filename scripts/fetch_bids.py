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

import calendar as _cal
import json
import os
import re as _re_mod
import sys
import time
from datetime import datetime, timedelta, timezone
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
def _env_int(name, default):
    """An env var that is set-but-empty means UNSET, not zero and not a crash.

    GitHub Actions passes an unfilled workflow_dispatch input as the empty
    string, and it passes it on SCHEDULED runs too. int("") raises, so a blank
    box in the Run-workflow dialog would have taken down every scheduled fetch
    as well as the manual one. Caught before shipping; kept honest by a test.
    """
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return default
    try:
        v = int(raw)
    except ValueError:
        print(f"[fetch_bids] {name}={raw!r} is not a number — using {default}",
              file=sys.stderr)
        return default
    if v <= 0:
        print(f"[fetch_bids] {name}={v} is not a usable ceiling — using {default}",
              file=sys.stderr)
        return default
    return v


TOTAL_LOCATIONS = _env_int("BARCHART_TOTAL_LOCATIONS", 200)
OUTPUT_PATH = "data/bids.json"        # SLIM. Browsers fetch this one.
FULL_PATH = os.environ.get("BIDS_FULL_PATH", "bids-full.json")  # never committed

# ── Why there are two files now ──────────────────────────────────
# data/bids.json is fetched CLIENT-SIDE by /corn-futures-prices,
# /soybean-futures-prices and /wheat-futures-prices. Lifting the location cap
# took it from roughly 2.5 MB to 6.3 MB, which is 6.3 MB downloaded by a phone
# to render one cash-bid card. That is not a repo problem, it is a page-weight
# problem, and the cap fix made it worse.
#
# So: the browser file carries only the bids that can actually be SELECTED by
# the page, and the full set goes to FULL_PATH for build_basis_map.py to
# aggregate in the same job. The full file is gitignored and never committed.
#
# slim_for_browser() below reproduces the page's own selection exactly; the
# selftest proves it by running the page's algorithm over both files for every
# grid ZIP and every crop and comparing the chosen bid.

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


def _page_crop(name):
    """The page's normalizeCommodity(), ported exactly."""
    n = str(name or "").lower().strip()
    if "corn" in n:
        return "corn"
    if "soy" in n or n == "beans":
        return "beans"
    if "wheat" in n:
        return "wheat"
    return None


# ── THE IDENTITY GUARD ────────────────────────────────────────────────────
#
# WHAT WENT WRONG, MEASURED ON data/bids.json AS COMMITTED 2026-08-29.
#
# For 34 of the 50 grid ZIPs there is no bid at the ZIP itself, so the futures
# pages fall through to "the highest-priced bid for this crop in the country".
# That pick was, for corn:
#
#     #2 Yellow Corn   cash 12.92   basis -0.20   symbol N27
#     Iroquois Bio-Energy, Rensselaer, IN
#
# 12.92 - (-0.20) implies a corn futures price of 13.12. Every one of the other
# 101 corn rows in the same file implies between 5.12 and 5.58. `N27` is not a
# CME corn contract. Whatever that row is, its cash and its basis are not in
# the same series, and it was about to be the corn number on three pages.
#
# WHAT THE GUARD DOES, AND WHY IT IS THIS SHAPE.
#
# cash - basis = the futures price the elevator quoted against. That identity
# is the same one dnilgis/bids enforces on every scraped board, and it is the
# only check available here that needs no data this file does not already
# carry. Two legs, both derived from the payload itself:
#
#   1. COHORT. Rows carrying the same contract symbol must imply the same
#      futures price. Measured on the committed file: of 46 symbols, 43 have a
#      spread of 0.00 or 0.01 across as many as 78 facilities. The identity is
#      not approximately true here, it is exactly true, so a row that misses
#      its own cohort by more than a cent or two is not noise.
#
#   2. ENVELOPE. A symbol quoted by only one or two facilities has no cohort to
#      miss, so its implied futures is measured against its own commodity
#      CATEGORY's span, built from that category's symbols that DO have a
#      cohort -- classify_commodity()'s buckets, not the three the pages
#      select. Corn's cohort
#      medians run 5.12 to 5.58 across seven contract months; soybeans 12.42 to
#      13.12; wheat 7.45 to 8.57. The widest carry actually observed is 9% of
#      the front month. The envelope is 0.70x to 1.40x the measured span --
#      three to four times the widest real carry, so no genuine deferred month
#      is refused, while 13.12 against a 5.12-5.58 corn span is.
#
# WHAT IT DELIBERATELY DOES NOT DO. It does not test whether a price is HIGH.
# The two most expensive rows in the file both pass:
#
#     Canadian Yellow Soybeans  cash 17.07  basis  4.1875  ZSX26  ADM Decatur
#     White Wheat (Max Pro 12)  cash 14.58  basis  6.30    KEU6   Ritzville WA
#
# Both imply exactly their cohort's futures price. They are real premium bids
# and a "that looks too high" filter would have thrown them away. The identity
# is the test; the level is not.
#
# WHAT A FAILING ROW COSTS. Nothing is corrected and nothing is guessed. The
# row keeps its numbers and is marked `verified: false` with the reason, and
# the pages simply do not SELECT it -- exactly as an unverifiable board is
# withheld rather than published in bids. A wrong mark costs a bid that does
# not appear; it can never cost a wrong price.

VERIFY_COHORT_TOL = 0.03        # dollars/bu; observed cohort spread is 0.00-0.01
VERIFY_MIN_COHORT = 3           # below this, a symbol has nothing to agree with
VERIFY_ENVELOPE_LO = 0.70       # x the crop's lowest  cohort median
VERIFY_ENVELOPE_HI = 1.40       # x the crop's highest cohort median


import re as _re

_SYMBOL_RE = _re.compile(r"^([A-Z]{1,3})([FGHJKMNQUVXZ])([0-9]{1,2})$")


def _norm_symbol(sym):
    """Barchart writes the same contract two ways and both are in the payload.

    ZCU26 and ZCU6 are September 2026 corn; the file carries 12 rows of the
    first and 2 of the second, and both imply 5.12 to the cent. So do ZCZ26 /
    ZCZ6 (5.37), ZSX26 / ZSX6 (12.88), KEU26 / KEU6 (8.28), KEN27 / KEN7
    (8.46) and ZCZ27 / ZCZ7 (5.27) -- six pairs, every one agreeing exactly.
    Left unmerged, sixteen rows sit in cohorts of two or four and get no
    cohort check at all.

    Both forms are canonicalised to the LAST digit of the year rather than
    expanded to four. Expanding means deciding whether `6` is 2016 or 2026,
    and nothing in the payload says; truncating decides nothing and merges the
    pair. It would collide across a decade, and a cash bid is never quoted ten
    years out.

    Anything that is not root + month code + year is returned unchanged, so a
    Barchart cash-index pseudo-symbol (DWBQ26-56338-14680.CM) and a symbol that
    is not a contract at all (`N27`, `27`) stay in cohorts of their own.
    """
    sym = str(sym or "").strip().upper()
    m = _SYMBOL_RE.match(sym)
    return f"{m.group(1)}{m.group(2)}{m.group(3)[-1]}" if m else sym


def _implied_futures(b):
    """cash - basis, or None when the row cannot state one."""
    cash, basis = b.get("cashPrice"), b.get("basis")
    if cash is None or basis is None:
        return None
    try:
        return round(float(cash) - float(basis), 4)
    except (TypeError, ValueError):
        return None


# ── THE AGSIST ELEVATOR NETWORK ───────────────────────────────────────────
# dnilgis/bids reads ~1,050 elevator boards directly and publishes a merged
# index plus one shard per elevator to dnilgis.github.io/bids. This folds that
# network into the same feed Barchart fills, so every AGSIST surface that shows
# a cash bid -- the futures-page cards, the homepage card, and the national
# basis map -- presents both sources, not Barchart alone. cash-bids.html already
# merges the two live in the browser; this brings the same merge to the files
# the other surfaces read.
#
# The dedup rule is the one cash-bids.html already uses (netMerge): same
# facility, same town, same state is the same elevator however the two feeds
# spell it, and OURS wins on price because ours is the board the elevator
# posted and Barchart's is a copy. Barchart's phone crosses over, because the
# network feed carries none.
#
# NEVER LOAD-BEARING. If the network cannot be read, this returns the Barchart
# rows untouched and says so. A network outage must not empty or fail the feed
# that Barchart fills -- same contract as the browser merge, which resolves to
# "nothing added" on any failure.
import math as _math

BIDS_NETWORK_BASE = os.environ.get(
    "BIDS_NETWORK_BASE", "https://dnilgis.github.io/bids/")
MERGE_RADIUS_MI = float(os.environ.get("BIDS_MERGE_RADIUS_MI", "50"))

def _net_get_json(base, rel, timeout=60):
    """Read base+rel as JSON. base may be an http(s) URL or a local directory
    (used by the self-test and any offline run).

    Asks for gzip: data/merged-all.json is 8 MB of JSON and 203 KB gzipped, and
    Pages serves the compressed copy when the client says it can read one."""
    if base.startswith("http://") or base.startswith("https://"):
        url = base.rstrip("/") + "/" + rel.lstrip("/")
        req = Request(url, headers={
            "User-Agent": "agsist-fetch-bids (+agsist.com)",
            "Accept-Encoding": "gzip",
        })
        with urlopen(req, timeout=timeout) as r:
            raw = r.read()
            if (r.headers.get("Content-Encoding") or "").lower() == "gzip":
                import gzip as _gzip
                raw = _gzip.decompress(raw)
            return json.loads(raw.decode("utf-8"))
    path = os.path.join(base, rel)
    with open(path) as f:
        return json.load(f)

def _haversine_mi(a_lat, a_lon, b_lat, b_lon):
    R = 3958.7613
    p = _math.pi / 180
    dlat = (b_lat - a_lat) * p
    dlon = (b_lon - a_lon) * p
    x = (_math.sin(dlat / 2) ** 2
         + _math.cos(a_lat * p) * _math.cos(b_lat * p) * _math.sin(dlon / 2) ** 2)
    return 2 * R * _math.asin(_math.sqrt(x))

def _nearest_grid(lat, lon, grid):
    """(zip, distance_mi) of the closest grid ZIP, or (None, None)."""
    best_z, best_d = None, None
    for g in grid:
        d = _haversine_mi(lat, lon, g["lat"], g["lng"])
        if best_d is None or d < best_d:
            best_z, best_d = g["zip"], d
    return best_z, best_d

# Legal-entity words that a feed carries and the other one drops. Stripped only
# from the END of a name, never mid-name: "Co-op Services" must keep its "co".
_LEGAL_SUFFIX = {"llc", "lc", "inc", "incorporated", "co", "corp", "corporation",
                 "ltd", "limited", "lp", "llp", "company"}

def _norm_operator(name):
    """One elevator's name as the two feeds spell it, reduced to one string.

    EXACT MATCH WAS NOT ENOUGH AND IT SHOWED ON THE PAGE. On 2026-09-22
    cash-bids.html drew Badger Grain Supply of Wheeler twice, 19 miles and 22
    miles away, with different corn bids: Barchart calls it "Badger Grain
    Supply" and its own board says "Badger Grain Supply, LLC". Midwest Commodity
    at Baldwin doubled the same way, off one plural -- "Services Inc." against
    "Service, Inc.". Two cards for one elevator quoting two prices is worse than
    either feed alone.

    So: punctuation out, a trailing legal suffix dropped, co-op spellings
    settled, and a trailing plural removed from each word. Measured against the
    1,807 facilities in agsist's Barchart directory, this groups two different
    spellings under one key exactly once -- "Centerra Coop" with "centerracoop",
    which is the same business typed twice. It deliberately does NOT merge names
    that differ by a real word ("ADM Grain" against "ADM"): a duplicate pin is
    visible and fixable, a wrong merge hides a real elevator.

    cash-bids.html carries the same rule in netKey(). If one changes, change
    both -- they are the same decision made in two places.
    """
    import re as _re
    s = _re.sub(r"[^a-z0-9]+", " ", str(name or "").lower())
    s = s.replace("co op", "coop").replace("co operative", "cooperative")
    toks = [t for t in s.split() if t]
    while toks and toks[-1] in _LEGAL_SUFFIX:
        toks.pop()
    toks = ["coop" if t in ("cooperative", "coops") else t for t in toks]
    toks = [t[:-1] if (len(t) > 3 and t.endswith("s")) else t for t in toks]
    return "".join(toks)

def _net_key(facility, city, state):
    import re as _re
    plain = lambda x: _re.sub(r"[^a-z0-9]", "", str(x or "").lower())
    return f"{_norm_operator(facility)}|{plain(city)}|{plain(state)}"

# When "new crop" is delivered, by crop, as month-day pairs inside the crop
# year. None is the default -- the corn and soybean belt window, which is also
# what sorghum and an unclassified commodity get.
_HARVEST_WINDOW = {
    # One "wheat" bucket has to cover hard red winter, cut in Kansas in late
    # June, and hard red spring, which runs into late September in North
    # Dakota. The window ends when the later of the two is in.
    "wheat": ("06-01", "09-30"),
    "oats":  ("07-01", "09-30"),
    None:    ("10-01", "12-31"),
}


# "In Store", "Instore", "Instore HRWW", "Open Storage" -- 76 of the 202 spot
# rows. A bid on grain the elevator already holds is a title transfer, not a
# delivery. It has no window, and calling it deliverable today puts it ahead
# of the harvest bid posted beside it at the same price.
_STORAGE_LABEL = _re_mod.compile(r"\b(in\s*store|instore|open\s*storage)\b",
                                 _re_mod.I)


def _period_dates(period, crop=None, label=None):
    """A shard `period` -> (start, end) as YYYY-MM-DD strings for sorting.

    Returns ("","") only for a period this function will not reason about --
    today that is `oldcrop-YYYY` and anything unrecognised. Seasons and spot
    rows used to land there too; see the comments below for why they no
    longer do and what it cost to get the spot window wrong first.

    Formats seen in the feed: "2026-09", "2026-09/2026-11" (range, sometimes
    with the tail truncated to the year), "newcrop-2027", "spot", "oldcrop-2026".

    A row that comes back ("","") no longer sorts LAST, which is what this
    paragraph used to say. _bid_order now gives an undated row its own tier,
    ahead of every window known to have closed and behind every open one --
    not knowing when a bid is for is a gap; knowing it is for a month that has
    gone is a wrong answer.
    """
    import re as _re
    s = str(period or "")

    # SPOT IS DATED AS THE MONTH IT WAS POSTED IN, NOT AS TODAY.
    # Dating it as today makes it sort ahead of every open month, and because
    # the branch that answers when nothing is local takes the earliest window
    # before it looks at price, whichever elevator posts a cash bid then
    # answers for the whole country.
    # Measured by running network_rows() over the merged feed and picking for
    # all 50 grid ZIPs and three crops: against the month-end window shipped
    # here, dating spot as today leaves 58 of the 150 picks on a WORSE price
    # and NOT ONE on a better price.
    # The current month is what a cash bid actually is: deliverable now,
    # exactly like any row whose window is open this month. It ties with them
    # and the price tie-break decides between them.
    # The cost is that a spot row in a file left unbuilt past the end of the
    # month reads as closed. The file is rebuilt every half hour on weekdays,
    # and slim_for_browser keeps a long-dated row per ZIP for the gaps.
    if s == "spot":
        # ... unless the board said the grain is already in store. See
        # _STORAGE_LABEL above.
        if _STORAGE_LABEL.search(str(label or "")):
            return "", ""
        _t = _as_of()
        _y, _m = int(_t[:4]), int(_t[5:7])
        # calendar.monthrange, not a table. A hand-written table said 28 for
        # February, which on the 29th returns a window ending before it starts
        # and which _is_closed() then reports as shut on the day it opened.
        return _t, f"{_y:04d}-{_m:02d}-{_cal.monthrange(_y, _m)[1]:02d}"

    # A SEASON IS A HARVEST, AND WHICH MONTHS THAT IS DEPENDS ON THE CROP.
    # Wheat comes off in June and July; corn and beans in October and
    # November. Giving every season the corn window would have called a
    # "New Crop 2027" wheat bid a December delivery. The feed carries 53
    # wheat season rows, 51 of them 2027 and 2 of them 2026.
    _nc = _re.match(r"^newcrop-(\d{4})$", s)
    if _nc:
        _y = _nc.group(1)
        # .get() raises on an unhashable argument, and this is reached with
        # whatever a caller passes.
        try:
            _s, _e = _HARVEST_WINDOW.get(crop, _HARVEST_WINDOW[None])
        except TypeError:
            _s, _e = _HARVEST_WINDOW[None]
        _start, _end = f"{_y}-{_s}", f"{_y}-{_e}"
        # A SEASON IS A COARSE GUESS AT A WINDOW, SO IT IS NEVER PUBLISHED AS
        # EXPIRED. One rule covers a crop grown from Texas to Manitoba. Being
        # a few weeks out is tolerable in the middle of the window and is not
        # tolerable at its edge, where it turns a live harvest bid into a dead
        # one. Undated is the honest answer there, and this file already ranks
        # an undated row ahead of a closed one and behind every open month --
        # which is exactly what is known about it.
        if _end < _as_of():
            return "", ""
        return _start, _end

    # oldcrop-YYYY IS LEFT UNDATED ON PURPOSE. It names the crop year the
    # grain came from, not the window it can be delivered in, and those are
    # not the same thing -- old crop is sold from the bin all year. One row in
    # the feed carries it. Inventing a window for it would be the guess this
    # function exists to refuse.
    parts = s.split("/")
    def ym(tok):
        m = _re.match(r"^(\d{4})-(\d{2})", tok.strip())
        return (m.group(1), m.group(2)) if m else None
    a = ym(parts[0])
    b = ym(parts[-1]) or a
    if not a:
        return "", ""
    start = f"{a[0]}-{a[1]}-01"
    # The same leap trap as the spot branch: "2028-02" ended on the 28th under
    # a hand-written table, so a February window read as closed all through
    # the 29th.
    end = f"{b[0]}-{b[1]}-{_cal.monthrange(int(b[0]), int(b[1]))[1]:02d}"
    return start, end


def network_rows(grid, base=None):
    """Every network bid, in the row shape this file's downstream expects.

    ONE REQUEST, NOT 1,056. dnilgis/bids publishes data/merged-all.json -- every
    merged row, flat, with the same field names as its per-elevator shards --
    precisely so a build like this one does not walk the shard index. Walking it
    was the first version of this function and it was wrong on the runner: 1,056
    sequential HTTPS calls inside a job that runs every half hour and already
    has a 20-minute collision rule with the sibling scheduler.

    The index alone will not do either, and the reason is measurable rather than
    stylistic: its per-place `best` is the top CASH bid per crop, which on
    2026-09-22 was a 2027 contract for 1,467 places. Selecting from that shows a
    deferred price as today's cash.

    Each row is stamped source="network", the nearest grid ZIP (so the per-ZIP
    slimming and the futures cards can select it) and the distance to it.
    Returns [] on any failure at all.
    """
    base = base or BIDS_NETWORK_BASE
    try:
        doc = _net_get_json(base, "data/merged-all.json")
    except Exception as e:
        print(f"[fetch_bids] network feed unreachable ({type(e).__name__}: {e}); "
              f"Barchart only this run", file=sys.stderr)
        return []
    bids = (doc.get("bids") if isinstance(doc, dict) else None) or []
    if not bids:
        print("[fetch_bids] network feed carried no bids; Barchart only this run",
              file=sys.stderr)
        return []
    rows = []
    dropped_stale = 0
    dropped_currency = 0
    for b in bids:
        if not b:
            continue
        # FRESHNESS GATE. A board dnilgis/bids could not confirm this run
        # republishes its last-known price flagged stale (sourceStatus
        # "broken"/"refused"); merging that would show an unconfirmed price
        # as today's cash. Drop it -- the same call the browser merge makes.
        if b.get("stale") is True:
            dropped_stale += 1
            continue
        if (b.get("sourceStatus") or "ok") not in ("ok",):
            dropped_stale += 1
            continue
        # A PRICE IN ANOTHER CURRENCY IS NOT A PRICE THESE PAGES CAN DRAW.
        # The feed declares it and every row here renders as "$" + number.
        # Dropped rather than converted: there is no exchange rate in this
        # repository and inventing one is worse than leaving the elevator out.
        if (b.get("currency") or "USD") != "USD":
            dropped_currency += 1
            continue
        cash = b.get("cash")
        basis = b.get("basis")
        cash = cash if isinstance(cash, (int, float)) else None
        basis = basis if isinstance(basis, (int, float)) else None
        if cash is None and basis is None:
            continue
        la, lo = b.get("lat"), b.get("lon")
        gz, gd = (_nearest_grid(la, lo, grid)
                  if (isinstance(la, (int, float)) and isinstance(lo, (int, float)))
                  else (None, None))
        commodity = b.get("commodity") or b.get("crop") or ""
        # The crop is worked out BEFORE the dates now, because which months a
        # season means depends on it.
        cat = classify_commodity(commodity)
        d_start, d_end = _period_dates(b.get("period"), cat, b.get("delivery"))
        rows.append({
            "facility": b.get("operator") or "Unknown",
            "branch": b.get("branch") or "",
            "city": b.get("city") or "",
            "state": (b.get("state") or "").upper(),
            "zip": b.get("zip") or "",
            "distance": round(gd, 1) if isinstance(gd, (int, float)) else None,
            "phone": "",
            "commodity": commodity,
            "symbol": b.get("futuresMonth") or "",
            "cashPrice": cash,
            "basis": basis,
            "notes": None,
            # `delivery` is what the card displays; the ISO start/end are what
            # _bid_order sorts on so the NEAREST month wins, not the
            # highest-priced deferred one.
            "delivery": b.get("delivery") or "",
            "deliveryMonth": b.get("delivery") or b.get("period") or "",
            "deliveryStart": d_start,
            "deliveryEnd": d_end,
            # Category from the SAME commodity string the futures cards
            # classify on, so a row that is beans on the map is beans on the
            # card. Trusting the feed's own `crop` field instead split 115 rows
            # between the two surfaces.
            "category": cat if cat != "other" else (b.get("crop") or "other"),
            "sourceZip": gz if (gd is not None and gd <= MERGE_RADIUS_MI) else "",
            "verified": True,
            "source": "network",
            "lat": la if isinstance(la, (int, float)) else None,
            "lon": lo if isinstance(lo, (int, float)) else None,
        })
    print(f"[fetch_bids] network: {len(bids)} rows in the feed, "
          f"{dropped_stale} stale/broken dropped, "
          f"{dropped_currency} not priced in USD, {len(rows)} merged in")
    return rows


def merge_network(barchart_rows, grid, base=None):
    """Barchart rows plus the network, deduped. Ours wins on price; Barchart's
    phone crosses to the network row that displaced it. Barchart-only on any
    network failure."""
    net = network_rows(grid, base=base)
    if not net:
        return barchart_rows
    by_key = {}
    for r in net:
        by_key.setdefault(_net_key(r["facility"], r["city"], r["state"]), []).append(r)
    kept = list(net)
    dropped = 0
    for r in barchart_rows:
        k = _net_key(r.get("facility"), r.get("city"), r.get("state"))
        mates = by_key.get(k)
        if mates:
            dropped += 1
            for ours in mates:
                if not ours.get("phone") and r.get("phone"):
                    ours["phone"] = r["phone"]
            continue
        kept.append(r)
    print(f"[fetch_bids] merged: {len(barchart_rows)} Barchart + {len(net)} network "
          f"-> {len(kept)} rows ({dropped} Barchart rows were the same elevator)")
    return kept


def verify_bids(bids):
    """Mark every row `verified` true or false. Returns (n_ok, n_bad).

    Mutates the rows in place and never changes a price. See the block above
    for what the two legs are and what was measured to choose them.

    THE COHORT LEG IS KEYED ON THE SYMBOL ALONE, NOT ON THE CROP. Central
    Prairie's MILO quotes against ZCZ26 and implies 5.37, the same figure the
    51 corn rows on ZCZ26 imply, because sorghum is priced off corn futures.
    Grouping by crop first would have put those eight rows in a `sorghum`
    bucket with nothing to compare them to and refused them for being sorghum.
    What is being tested is arithmetic against one contract; the crop is only
    needed for the fallback envelope, where there is no cohort.
    """
    import statistics

    implied = {id(b): _implied_futures(b) for b in bids}

    by_symbol = {}
    for b in bids:
        v = implied[id(b)]
        sym = _norm_symbol(b.get("symbol"))
        if v is None or not sym:
            continue
        by_symbol.setdefault(sym, []).append((v, b))

    sym_median = {s: statistics.median([v for v, _ in rows])
                  for s, rows in by_symbol.items()}

    # The envelope's inputs: for each commodity CATEGORY, the span of implied
    # futures across the symbols in it that have a real cohort. A symbol quoted
    # for two categories is skipped -- it states nothing about either.
    cat_span = {}
    for sym, rows in by_symbol.items():
        if len(rows) < VERIFY_MIN_COHORT:
            continue
        vals = [v for v, _ in rows]
        # ONLY A COHORT THAT AGREES WITH ITSELF MAY DEFINE AN ENVELOPE. RSX6 is
        # quoted by four rows implying 90.4, 101.3, 139.9 and 140.0 -- canola
        # against an ICE Canada quote in Canadian dollars per tonne. A median
        # of that is not a price and must not become the yardstick anything
        # else is measured by. Requiring the cohort to be tight costs nothing
        # (43 of 46 symbols in the committed file span 0.00 to 0.01) and shuts
        # this out without naming canola anywhere.
        if max(vals) - min(vals) > VERIFY_COHORT_TOL:
            continue
        m = sym_median[sym]
        # A CONTRACT CAN PRICE MORE THAN ONE COMMODITY. Central Prairie's MILO
        # quotes against ZCU6 alongside twelve corn rows, and implies the same
        # 5.12 they do, because sorghum is priced off corn futures. Demanding a
        # symbol belong to exactly one category dropped every such symbol, and
        # corn's envelope collapsed from 5.12-5.58 to 5.57-5.58 -- narrower
        # than the real carry, which is how a genuine deferred month gets
        # refused. A tight cohort states a price for every category on it.
        for cat in {classify_commodity(b.get("commodity")) for _, b in rows}:
            # `other` is what classify_commodity() returns when NOTHING
            # matched: canola, durum, field peas, hull pellets and
            # delivered-basis contracts all land in it. It is a leftovers bin,
            # not a price level. An envelope built from it said things like
            # "every other contract implies 120.602 to 120.602" and refused
            # $4.90 durum for not being canola. A row in `other` with no cohort
            # of its own is simply not checkable here, and now says so.
            if cat == "other":
                continue
            lo, hi = cat_span.get(cat, (m, m))
            cat_span[cat] = (min(lo, m), max(hi, m))

    n_ok = n_bad = 0
    for b in bids:
        # Rows from the AGSIST elevator network (dnilgis/bids) were verified
        # by that repository's own board checks before they were published
        # -- status ok, observed fresh, cash-minus-basis inside the band. They
        # are not in Barchart's per-symbol cohorts, so this Barchart-shaped
        # cohort check cannot see them; running it would refuse every one for
        # having no cohort. Trust the upstream verification and move on.
        if b.get("source") == "network":
            b["verified"] = True
            b.pop("unverifiedWhy", None)
            n_ok += 1
            continue
        v = implied[id(b)]
        sym = _norm_symbol(b.get("symbol"))
        cat = classify_commodity(b.get("commodity"))
        why = None

        if v is None:
            why = ("the row carries no cash price or no basis, so it states no "
                   "futures price to check")
        elif not sym:
            why = ("the row names no contract, so there is nothing its cash "
                   "minus basis can be compared against")
        else:
            cohort = by_symbol.get(sym, [])
            if len(cohort) >= VERIFY_MIN_COHORT:
                med = sym_median[sym]
                if abs(v - med) > VERIFY_COHORT_TOL:
                    why = (f"cash {b.get('cashPrice')} minus basis {b.get('basis')} "
                           f"implies {v} for {sym}, but the other {len(cohort) - 1} "
                           f"facility rows quoting {sym} imply {med}")
            else:
                span = cat_span.get(cat)
                if span is None:
                    why = (f"{sym} is quoted by only {len(cohort)} row(s) and no "
                           f"{cat} contract in this file is quoted by enough "
                           f"facilities to state a price, so nothing here can check it")
                elif not (span[0] * VERIFY_ENVELOPE_LO <= v <= span[1] * VERIFY_ENVELOPE_HI):
                    why = (f"cash {b.get('cashPrice')} minus basis {b.get('basis')} "
                           f"implies {v} for {sym}, and every {cat} contract this "
                           f"file can check implies {span[0]} to {span[1]}")

        b["verified"] = why is None
        if why is None:
            b.pop("unverifiedWhy", None)
            n_ok += 1
        else:
            b["unverifiedWhy"] = why
            n_bad += 1
    return n_ok, n_bad


def verified_only(bids):
    """The rows a page is allowed to SELECT. An unmarked row is allowed:
    verify_bids() has simply not been run, and this must not silently empty
    a page that never had the guard."""
    return [b for b in bids if b.get("verified", True)]

def _is_closed(b):
    """Has this row's delivery window already shut, as of this run?

    Reads the same tier _bid_order() assigns, so the two can never drift."""
    return _bid_order(b)[0][0] == 9


# THE DAY THIS RUN IS FOR, AND THE ONLY PLACE ANYTHING ASKS.
# _bid_order() below has to know today to tell an open delivery window from a
# closed one, and a function that reads the wall clock cannot be tested: the
# fixtures in selftest() were written when 2026-08-31 was still in the future.
# The selftest pins this and puts it back. Nothing else assigns it, and when it
# is None the real date is used.
_AS_OF_OVERRIDE = None


_AS_OF_CACHE = None

# The date selftest() stops the clock at. Named once so the suite and the
# fixtures it protects cannot drift apart.
PINNED_AS_OF = "2026-08-01"


def _as_of():
    """Today, as YYYY-MM-DD, unless a test has pinned it.

    RESOLVED ONCE PER PROCESS, AND THAT IS NOT AN OPTIMISATION. _bid_order()
    calls this for every key it builds -- thirteen thousand times over the
    committed file, hundreds of thousands over a full feed -- and main()
    computes the full-file picks and the slim-file picks in separate loops. If
    UTC midnight fell between two of those calls, two rows with the SAME
    deliveryEnd would land in different tiers, min() would be comparing keys
    built against two different todays, and the guard at the end of main()
    would exit 4 on a run where nothing was wrong. fetch_bids.yml runs every
    half hour, so one run a day sits on that boundary."""
    global _AS_OF_CACHE
    if _AS_OF_OVERRIDE:
        return _AS_OF_OVERRIDE
    if _AS_OF_CACHE is None:
        _AS_OF_CACHE = datetime.now(timezone.utc).date().isoformat()
    return _AS_OF_CACHE


def _plus_days(n):
    """The as-of date plus n days, as YYYY-MM-DD.

    Used only by slim_for_browser, to keep one row per ZIP and crop whose
    window is still open well after this file is written. The file is a
    snapshot and the browser applies its own floor when it is read; without
    some depth the two drift apart the moment the soonest window shuts."""
    return (datetime.strptime(_as_of(), "%Y-%m-%d").date()
            + timedelta(days=n)).isoformat()


def _as_int_date(when):
    """YYYY-MM-DD -> 20260923, or None when there is no readable date.

    580 of the 584 rows in the committed file parse. THE FOUR THAT DO NOT ARE
    NOT A MYSTERY AND THEY ARE NOT STALE: all four are ADM Hutchinson, Kansas,
    posting "Fall 2026 (2026-12)" and "Cash (2026-12)" -- real new-crop
    windows that _period_dates() cannot turn into dates, so they arrive with
    deliveryEnd and deliveryStart both empty. Tier 2 is the right place for
    them, but for that reason and not because the bid is unknowable.

    Do NOT try to recover the month from the "(2026-12)" in deliveryMonth.
    That parenthetical is the FUTURES CONTRACT month, not the delivery window:
    ADM Mankato posts "September (2026-11)" against a deliveryEnd of
    2026-09-30, and 25 rows in the committed file have a label month that
    differs from their end month for exactly this reason. Reading it would
    move a September bid to November.

    strptime rather than a length check, so 2026-13-45 is refused instead of
    being filed as a window that never closes."""
    if not when or when == "9999-99-99":
        return None
    try:
        d = datetime.strptime(when, "%Y-%m-%d")
    except (ValueError, TypeError):
        return None
    return d.year * 10000 + d.month * 100 + d.day


def _bid_order(b):
    """Sort key: nearest delivery first, then the best price inside it.

    "PRICES PAID TODAY" MEANS THE NEAREST DELIVERY, NOT THE BIGGEST NUMBER.
    Sorting a location's rows on price alone hands the card to the furthest
    contract on the board, because carry pays. Measured on the committed file,
    picking Mankato's highest corn bid returned $5.23 for JUNE 2027 delivery.
    That is a real bid and it is not what a reader looking at today's cash
    board is being shown. Nearest window first, and the best price inside that
    window second, is what the heading already promises.

    THE DATE IS TAKEN TO THE DAY, NOT THE SECOND, AND THAT IS NOT COSMETIC.
    Barchart returns the SAME contract month with two different end stamps:
    of the 56 rows ending 31 August in the committed file, 33 say
    `2026-08-31 23:59:59` and 23 say `2026-08-31 00:00:00`. Compared as full
    strings that splits one contract into two groups, the price tie-break
    never spans them, and the national pick came out $5.02 while a $5.72 row
    sat in the other half of the same month. Slicing to the day merges them.

    IT ORDERS ON deliveryEnd, NOT deliveryStart, BECAUSE START IS NOT
    TRUSTWORTHY. Eight rows in the committed file -- both Producer Ag
    locations -- carry a `deliveryStart` of 2012-02-28 or 2012-05-01 against a
    correct end date and a correct month label. Ordering on start handed those
    rows every fallback in the file. Start is kept only as a substitute when
    end is missing.

    AND "EVERY deliveryEnd IS A REAL FUTURE DATE" IS WHAT THIS PARAGRAPH USED
    TO SAY NEXT. It was true of the Barchart-only file and the AGSIST network
    merge of 2026-09-22 ended it. Measured on data/bids.json of 2026-09-23,
    17 of its 584 rows carry a window that has already closed:

        2026-08-31  6      2026-01-31  2      2021-09-30  1
        2026-03-31  3      2026-04-30  1      2016-09-30  1
        2025-09-30  2      2026-05-31  1

    The last two are a day of the month read as a year upstream. Because the
    order was ascending with no floor, those rows did not merely appear,
    THEY WON: 45 of the 150 grid ZIP-and-crop picks in that file landed on a
    closed window, and so did all three national fallbacks -- the corn one on
    a window that shut on 30 September 2021.

    So the key is floored at _as_of() below. An expired row is still published
    -- dropping an elevator's posted bid on our own judgement is the bigger
    sin -- but it is ranked behind every window a person can still deliver
    into, which is what taking the earliest was always meant to mean.

    IT IS A TOTAL ORDER, AND IT WAS NOT.
    The key was (deliveryEnd, -price) and nothing else, so it could not separate
    two elevators offering the same price for the same window -- and they are
    everywhere. Seven Aberdeen co-ops sit on ('2026-11-30', -12.58) in the
    committed file; 136 of its 440 rows share a key with another row. min()
    then returns whichever tied row it happens to reach first, which depends on
    the order of the list it is handed. page_pick walks the full set; the slim
    file is a dict rebuilt in a different sequence. On 2026-09-02 the two picked
    different rows for eleven grid ZIP/crop pairs -- every one of them wheat --
    and the run failed with exit 4.

    The build failure was the cheap half. The expensive half is that the page
    could name Elevator A this morning and Elevator B this afternoon off numbers
    that had not moved.

    The tie-break is the facility's own name, then branch, then commodity: no
    meaning is claimed by it, only stability. DISTANCE WOULD HAVE BEEN THE
    MEANINGFUL CHOICE -- same price, same window, go to the nearer one -- and it
    is not available: `distance` is null on all 440 rows of the committed file,
    which is also why deduplicate()'s `(distance or 999)` has always compared
    999 against 999.
    """
    when = str(b.get("deliveryEnd") or b.get("deliveryStart") or "9999-99-99")[:10]
    # THREE TIERS, NOT A BARE DATE, BECAUSE ASCENDING ORDER PUT THE WORST ROWS
    # FIRST. See the paragraph above: the further in the past a window is, the
    # smaller its date sorts, so "nearest delivery first" handed the card to
    # the most expired row on the board. A prefix keeps this a plain tuple
    # comparison and keeps it a total order.
    #   "0"+date  a window still open, earliest first  -- what a seller can use
    #   "2"       no date on the row at all
    #   "9"+date  a window that has closed, last
    # A ROW WITH NO DATE OUTRANKS A ROW KNOWN TO BE SHUT. Not knowing when a
    # bid is for is a gap; knowing it is for a month that has gone is a wrong
    # answer. The old key sorted the undated row ("9999-99-99") behind every
    # closed one.
    #   (0, d)   a window still open, soonest first  -- what a seller can use
    #   (2, 0)   no usable date on the row at all
    #   (9, d)   a window that has closed, last
    # THE CLOSED TIER IS ASCENDING BECAUSE THE THREE PAGES THAT READ THIS FILE
    # ARE ASCENDING. bidWhen() in corn/soybean/wheat-futures-prices.html
    # returns '9'+date and sorts it as a string; so does deliveryRank() in
    # cash-bids.html. Ordering the stale rows least-stale-first here would be
    # defensible on its own -- among rows nobody can deliver into, the one that
    # shut last week says more about this elevator than the one that shut in
    # 2021 -- and it would have made this the THIRD definition of "closed" in
    # the repository. One rule in four files beats a better rule in one.
    day = _as_int_date(when)
    # COMPARED AS INTEGERS. _as_int_date uses strptime, which accepts
    # "2026-9-30"; a lexical compare of that against "2026-10-01" says it is
    # still open, and it would then sort FIRST because its digits are small --
    # the exact pre-floor failure. No such row exists in either file today and
    # the two lines sit three apart, so they are made to agree.
    _today = _as_int_date(_as_of())
    if day is None:
        rank = (2, 0)
    elif _today is None or day >= _today:
        rank = (0, day)
    else:
        rank = (9, day)
    try:
        price = float(b.get("cashPrice") or 0)
    except (TypeError, ValueError):
        price = 0.0
    # NaN COMPARES FALSE AGAINST EVERYTHING, so one NaN price makes min()
    # depend on the order of the list it is handed -- the same asymmetry
    # between the full set and the rebuilt slim file that produced exit 4 on
    # 2026-09-02. json.load() parses a bare NaN literal happily.
    if price != price or price in (float("inf"), float("-inf")):
        price = 0.0
    return (rank, -price,
            str(b.get("facility") or ""), str(b.get("branch") or ""),
            str(b.get("commodity") or ""),
            str(b.get("city") or ""), str(b.get("state") or ""),
            str(b.get("zip") or ""),
            # AND THE LABEL, BECAUSE THE LABEL IS ON THE CARD. Abbyville posts
            # the same soybean price for the same end date under two windows,
            # "12 Sep 2026 to 30 Nov" and "01 Oct 2026 to 30 Nov"; ADM Toledo
            # posts one December corn price as "NC 26" and again as
            # "December 2026". Everything above collides on those, so min()
            # returned whichever the list reached first and the full file and
            # the rebuilt slim file could print different words for the same
            # bid. Six such pairs in a 12,336-row feed.
            str(b.get("deliveryMonth") or ""),
            # AND THE START OF THE WINDOW, BECAUSE deduplicate() HAS ALWAYS
            # SAID IT MAKES A ROW DISTINCT AND THIS KEY DID NOT.
            #
            # deduplicate() keys on facility|branch|commodity|deliveryStart|
            # deliveryEnd|deliveryMonth. It keeps two rows that differ only by
            # start, because they ARE two postings. This key stopped at the
            # label, so it called them one. Two functions, one question --
            # "is this the same row?" -- and two answers.
            #
            # Measured on data/bids.json of 2026-09-24, 887 distinct keys over
            # 889 rows, and both collisions are that shape:
            #
            #   One Earth Energy, Gibson City IL, corn 5.19, "Sep26"
            #       01 Sep -> 30 Sep   and   16 Sep -> 30 Sep
            #   Central Valley Ag / ADM Columbus NE, DIRECT CORN 5.09, "Sep26"
            #       01 Aug -> 30 Sep   and   21 Sep -> 30 Sep
            #
            # THIS DOES NOT CONTRADICT "IT ORDERS ON deliveryEnd, NOT
            # deliveryStart" ABOVE, and a reader arriving at that paragraph
            # next should not undo this. That paragraph is about RANKING: the
            # eight Producer Ag rows carrying a 2012 start would have won every
            # fallback in the file if start decided which row is nearest. Here
            # start sits last, behind the tier, the price, the facility, the
            # branch, the commodity, the town, the state, the ZIP and the
            # label. A row cannot be promoted past anything by it. It is
            # reached only when two rows are identical on every one of those,
            # and then it is the difference between them.
            str(b.get("deliveryStart") or "")[:10])


def near(b, grid_zip):
    """Is this row inside the radius query that was run around `grid_zip`?

    THE PROXIMITY FACT WAS IN THE PAYLOAD ALL ALONG AND NOTHING USED IT.

    `sourceZip` is the grid ZIP whose getGrainBids call returned this row, and
    that call is a radius query -- MAX_DISTANCE miles around that ZIP. So a row
    carrying sourceZip 53705 is, by Barchart's own arithmetic, within range of
    Madison. It is not a coordinate and it is not a mileage, but it is a real
    statement about distance and it is the only one this feed makes:
    `distance` is null on all 346 rows of the committed file, and `lat`/`lng`
    are absent entirely.

    The facility ZIP is checked too, as a union rather than a fallback. 53 rows
    in the committed file have `sourceZip != zip`, and 50 of those sit AT a
    grid ZIP -- returned by some neighbouring ZIP's query rather than their
    own. Matching on either catches both, and matching on only one loses fifty
    real local bids.
    """
    z = str(grid_zip)
    return str(b.get("sourceZip") or "") == z or str(b.get("zip") or "") == z


def page_pick(bids, grid_zip, crop):
    """findBestBidForCrop() from the futures pages, ported exactly.

    Ported rather than paraphrased BECAUSE the point is equivalence: the slim
    file is only safe if the page computes the same answer from it as from the
    full set, and the only way to assert that is to run the page's own logic.

    ---------------------------------------------------------------------
    THE HISTORY OF THIS FUNCTION, BECAUSE IT HAS BEEN WRONG THREE WAYS.

    (1) The distance branch read `bid.lat` / `bid.lng` and Barchart's payload
    carries NEITHER -- flatten() never sets them. Dead code on live data since
    it was written. It is gone; `near()` above replaces it with a proximity
    fact the payload actually makes.

    (2) The fallback sorted on `bid_price || bidPrice || price`. The payload
    carries NONE of those -- the field is `cashPrice` -- so every comparison
    was 0 minus 0, the sort did nothing, and it returned crop_bids[0]:
    whatever sorted first by state, city, commodity. On the committed file that
    was Agrex Inc, Montgomery, ALABAMA, for all three crops. Fixed 2026-08-29.
    This port never had that bug, which is exactly why the every-run
    equivalence check below could not see it: it compared two correct answers
    while the browser computed a third.

    (3) Even fixed, the fallback fired for 37 of the 50 grid ZIPs for corn, 39
    for beans and 41 for wheat, because the only local test was `bid.zip ==
    grid_zip` and bids sat at just 16 of the 50. A reader in Madison was shown
    a real, checked, identity-verified bid in Jackson, Tennessee. Fixed now by
    asking `near()` instead.

    ---------------------------------------------------------------------
    ONE RULE AT TWO RADII: the best price you can actually reach.

      1. LOCAL   -- inside the radius query run around the reader's grid ZIP,
                    the nearest delivery window, and the best price in it.
      2. FALLBACK - if that query returned nothing for this crop, the same
                    rule applied nationally, and the caller is told the
                    distance is unknown so the page can say so.

    Both steps use _bid_order() above; see it for why the tie-break is nearest
    delivery rather than biggest number, and why the date is sliced to the day.

    Note that step 1 RANKS the local rows rather than taking the first. The old
    exact-ZIP branch returned whichever row happened to come first in a file
    sorted by state, city and commodity -- the same arbitrariness as the
    national fallback, just with a smaller pool. Council Bluffs has twelve
    verified local corn rows; there is no reason to show a farmer the fourth.
    """
    crop_bids = [b for b in bids if _page_crop(b.get("commodity")) == crop]
    if not crop_bids:
        return None
    crop_bids = verified_only(crop_bids)     # every branch, as the pages do
    if not crop_bids:
        return None

    if grid_zip:
        # A CLOSED WINDOW IS NOT A LOCAL BID. The pages drop it here rather
        # than rank it, and fall through to the national branch, which labels
        # itself honestly. A price nobody can deliver into is worse under a
        # heading that says it is nearby than an out-of-state price that says
        # it is far.
        local = [b for b in crop_bids if near(b, grid_zip) and not _is_closed(b)]
        if local:
            return min(local, key=_bid_order)

    return min(crop_bids, key=_bid_order)


def slim_for_browser(bids, grid):
    """The smallest set of bids from which the page picks the same bid.

    Two paths can select a bid, so exactly what those two paths can reach is
    kept and nothing else:

      1. LOCAL     -> per grid ZIP and per crop, the highest verified bid
                      inside that ZIP's radius query. That is at most
                      50 x 3 = 150 rows and is the whole point of this change:
                      before it, the slim file kept rows by FACILITY ZIP, so
                      only 16 of the 50 grid ZIPs had anything to offer and
                      the other 34 fell through to a national bid.
      2. FALLBACK  -> the highest-priced verified bid per crop, nationally,
                      for a grid ZIP whose query returned nothing.

    Every bid whose own ZIP is a grid ZIP is kept as well. It is a few hundred
    rows against a file that was already this size, and it means a future
    change to the local rule cannot silently find the row it needs missing.

    Fields are NOT stripped: the page reads a dozen of them under several
    alternative names and dropping the wrong one fails silently as an empty
    card. Cutting ~18,000 rows to a few hundred is where the bytes are; the
    fields are noise by comparison.
    """
    gz = [g["zip"] for g in grid]
    keep = {id(b): b for b in bids if b.get("zip") in set(gz)}

    for crop in ("corn", "beans", "wheat"):
        cb = verified_only([b for b in bids
                            if _page_crop(b.get("commodity")) == crop])
        if not cb:
            continue
        for z in gz:
            local = [b for b in cb if near(b, z)]
            # THREE, NOT ONE, AND ONE WITH A LONG WINDOW. One row per ZIP and
            # crop is always the row that expires first, so the file went thin
            # the moment that window shut. Ranked, so the first is still
            # exactly what page_pick would have kept.
            _ranked = sorted(local, key=_bid_order)
            for b in _ranked[:3]:
                keep[id(b)] = b
            # AND THE SOONEST ROW THAT IS STILL OPEN IN FIVE WEEKS.
            # Measured through network_rows() on the merged feed, slimmed on
            # 2026-09-23 and then read on 1 October WITHOUT a rebuild. 98 of
            # the 150 grid ZIP-and-crop pairs have a local answer on the day
            # the file is written; the number still answering locally a week
            # later was:
            #     keeping one row   24 of 98      244 rows,  112 KB
            #     keeping three     46 of 98      425 rows,  196 KB
            #     three plus this   96 of 98      492 rows,  227 KB
            # It doubles the file -- 245 rows to 492, 113 KB to 227 KB, still
            # a fiftieth of the feed it is cut from -- and it is the
            # difference between a reader seeing his own elevator and seeing
            # "not near you" on the first morning of a month.
            for b in _ranked:
                if not _is_closed(b) and str(b.get("deliveryEnd") or "")[:10] >= _plus_days(35):
                    keep[id(b)] = b
                    break
        top = min(cb, key=_bid_order)
        keep[id(top)] = top
    # IN KEY ORDER. See the note above: the pages break a tie by array order,
    # so the array order has to be the key order or the two disagree on every
    # tie and nothing in the build can tell.
    return sorted(keep.values(), key=_bid_order)


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

    # Fold in the AGSIST elevator network so every surface reading these
    # files shows both sources. Barchart-only if the network is unreachable.
    grid_for_merge = [{"zip": e["zip"], "lat": e["lat"], "lng": e["lng"]} for e in ZIP_GRID]
    all_bids = merge_network(all_bids, grid_for_merge)
    print(f"[fetch_bids] Errors: {errors}/{len(ZIP_GRID)} ZIPs")

    all_bids.sort(key=lambda b: (b.get("state") or "", b.get("city") or "", b.get("commodity") or ""))

    # THE IDENTITY GUARD runs on the FULL set, before anything is cut. Cohorts
    # are the whole point and the slim file has already thrown most of them
    # away, so verifying after slimming would be verifying against a handful.
    n_ok, n_bad = verify_bids(all_bids)
    print(f"[fetch_bids] identity guard: {n_ok} verified, {n_bad} withheld from "
          f"selection ({100.0 * n_bad / max(1, n_ok + n_bad):.1f}%)")
    if n_bad:
        shown = 0
        for b in all_bids:
            if b.get("verified") or shown >= 12:
                continue
            print(f"[fetch_bids]   unverified: {b.get('facility')}, {b.get('city')}, "
                  f"{b.get('state')} -- {b.get('commodity')} -- {b.get('unverifiedWhy')}")
            shown += 1
        if n_bad > shown:
            print(f"[fetch_bids]   ... and {n_bad - shown} more")
    if n_ok == 0:
        # Every row failed. That is not 18,000 bad elevators; it is this guard
        # or the payload shape having changed underneath it. Refusing here
        # would blank all three pages, so say so loudly and keep going.
        print("[fetch_bids] WARNING: the identity guard verified NOTHING. "
              "Treating every row as selectable and NOT blanking the pages. "
              "Look at the payload before trusting the next run.",
              file=sys.stderr)
        for b in all_bids:
            b["verified"] = True

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
        "source": "AGSIST elevator network (dnilgis/bids) + a licensed cash-bid feed",
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

    # FULL first, to the gitignored path, because build_basis_map.py needs
    # every row to average a state and the browser must never be sent them.
    # The `full` flag is a handshake: build_basis_map refuses a file without
    # it, so a national basis map can never be built from the slim few hundred.
    full = dict(output, full=True, bids=all_bids)
    os.makedirs(os.path.dirname(FULL_PATH) or ".", exist_ok=True)
    with open(FULL_PATH, "w") as f:
        json.dump(full, f, separators=(",", ":"))

    slim = slim_for_browser(all_bids, zip_index)
    output["bids"] = slim
    output["full"] = False
    output["slim_note"] = (
        "Only the bids the futures pages can select: every bid at a grid ZIP, "
        "plus the highest-priced VERIFIED bid per crop. `verified` is false "
        "where cash minus basis does not agree with what every other facility "
        "quoting the same contract implies; such a row keeps its numbers, "
        "carries `unverifiedWhy`, and is never SELECTED. The complete set is "
        "not committed - see scripts/fetch_bids.py."
    )
    os.makedirs(os.path.dirname(OUTPUT_PATH) or ".", exist_ok=True)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(output, f, separators=(",", ":"))

    # PROVE IT, ON THE REAL DATA, EVERY RUN. Not a unit test on a fixture:
    # the actual payload that is about to be committed, checked against the
    # actual payload it was cut from, for every grid ZIP and every crop. If
    # the two ever disagree the run fails rather than quietly serving a
    # different bid than the page used to show.
    bad = []
    for g in zip_index:
        for crop in ("corn", "beans", "wheat"):
            a = page_pick(all_bids, g["zip"], crop)
            b = page_pick(slim, g["zip"], crop)
            if a != b:
                bad.append(f'{g["label"]}/{crop}')
    if bad:
        print("[fetch_bids] FATAL: the slim file would change what the futures "
              f"pages display for {len(bad)} grid ZIP/crop pairs: "
              f"{', '.join(bad[:8])}{'...' if len(bad) > 8 else ''}",
              file=sys.stderr)
        sys.exit(4)

    full_kb = os.path.getsize(FULL_PATH) / 1024
    size_kb = os.path.getsize(OUTPUT_PATH) / 1024
    print(f"[fetch_bids] Wrote {OUTPUT_PATH} ({size_kb:.1f} KB, {len(slim)} bids) "
          f"— identical page output to the full set, checked on "
          f"{len(zip_index) * 3} ZIP/crop pairs")
    print(f"[fetch_bids] Wrote {FULL_PATH} ({full_kb:.1f} KB, {len(all_bids)} bids) "
          f"— not committed; build_basis_map.py reads it in this job")
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

    # THE CLOCK IS PINNED, AND THAT IS THE POINT OF THIS LINE.
    # These fixtures were written when 2026-08-31 was a future delivery
    # window; it is not one any more, and _bid_order() now knows the
    # difference. A suite whose answers change with the calendar is a suite
    # that goes red on a morning when nothing was broken -- and, worse, one
    # that can go green on a morning when something is.
    #
    # WHAT HAPPENS IF A CHECK RAISES, SAID PLAINLY. ck() evaluates its
    # condition at the call site and does not catch, so an exception walks out
    # of this function past the restore at the bottom, with the clock still
    # stopped in August. That is survivable ONLY because the single caller is
    # `sys.exit(selftest())` -- the process dies and nothing can observe the
    # pin. The moment anything calls selftest() in-process, wrap the body in
    # try/finally. It is not wrapped today because that is a 500-line
    # re-indent for a hazard that does not exist yet, and a re-indent is how
    # you lose a check without noticing.
    global _AS_OF_OVERRIDE, _AS_OF_CACHE
    _prev_as_of, _prev_cache = _AS_OF_OVERRIDE, _AS_OF_CACHE
    _AS_OF_OVERRIDE = PINNED_AS_OF

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
    print("a blank dispatch input is unset, not a crash")
    keep = os.environ.get("BARCHART_TOTAL_LOCATIONS")
    default_for_noise = 200
    try:
        for raw, want, why in (
            (None, 200, "variable absent"),
            ("", 200, "empty string — an unfilled Run-workflow box"),
            ("   ", 200, "whitespace"),
            ("400", 400, "a real value"),
            ("nope", 200, "not a number"),
            ("0", 200, "zero is not a ceiling"),
            ("-5", 200, "negative"),
        ):
            if raw is None:
                os.environ.pop("BARCHART_TOTAL_LOCATIONS", None)
            else:
                os.environ["BARCHART_TOTAL_LOCATIONS"] = raw
            err = io.StringIO()
            with redirect_stderr(err):
                got = _env_int("BARCHART_TOTAL_LOCATIONS", 200)
            ck(f"{why} -> {want}", got == want)
            # AND SILENTLY, for the blank cases. The try/except alone already
            # returns 200 for "" -- the blank check is not what makes the
            # value right, it is what stops EVERY SCHEDULED RUN printing
            # "BARCHART_TOTAL_LOCATIONS='' is not a number". A warning that
            # fires on every green run is how you learn to ignore warnings,
            # so silence here is the contract, not a nicety.
            if raw is None or not raw.strip():
                ck(f"...and says nothing about it ({why})", err.getvalue() == "")
            elif want == default_for_noise:
                ck(f"...and says why ({why})", "using 200" in err.getvalue())
    finally:
        os.environ.pop("BARCHART_TOTAL_LOCATIONS", None)
        if keep is not None:
            os.environ["BARCHART_TOTAL_LOCATIONS"] = keep

    print()
    print("saturation is judged against what was asked for")
    for asked, got, want in ((200, 200, True), (200, 199, False),
                             (30, 30, True), (200, 0, False)):
        ck(f"asked {asked}, got {got} -> {'at ceiling' if want else 'below'}",
           (got >= asked) is want)

    print()
    print("the slim browser file cannot change what the page shows")
    grid = [{"zip": "50010", "lat": 42.0, "lng": -93.6, "label": "Ames, IA"},
            {"zip": "54703", "lat": 44.8, "lng": -91.5, "label": "Eau Claire, WI"}]
    B = lambda z, c, p_: {"zip": z, "commodity": c, "cashPrice": p_, "city": z}
    full = [
        B("50010", "Corn", 4.10),            # exact match at a grid ZIP
        B("50014", "Corn", 9.99),            # highest price, NOT at a grid ZIP
        B("54703", "Soybeans", 10.20),
        B("99999", "Soybeans", 99.00),       # the national fallback for beans
        B("12345", "Wheat", 5.00),
        B("12346", "Wheat", 5.50),           # wheat has no grid-ZIP bid at all
    ]
    slim = slim_for_browser(full, grid)
    ck("the slim set is smaller", len(slim) < len(full))
    ck("every grid-ZIP bid is kept",
       all(any(b is k for k in slim) for b in full if b["zip"] in {"50010", "54703"}))
    ck("the national top price per crop is kept, so the fallback still works",
       any(b["cashPrice"] == 9.99 for b in slim)
       and any(b["cashPrice"] == 99.00 for b in slim)
       and any(b["cashPrice"] == 5.50 for b in slim))
    same = all(page_pick(full, g["zip"], c) == page_pick(slim, g["zip"], c)
               for g in grid for c in ("corn", "beans", "wheat"))
    ck("the page picks the same bid from either file", same)
    ck("an exact ZIP match beats a higher price elsewhere",
       page_pick(full, "50010", "corn")["cashPrice"] == 4.10)
    ck("with no ZIP match the page falls back to the national top price",
       page_pick(full, "50010", "wheat")["cashPrice"] == 5.50)
    ck("a crop with no bids at all returns nothing",
       page_pick([], "50010", "corn") is None)

    # The dropped rows must be exactly the ones no grid ZIP can reach. If this
    # ever fires, the slim file is throwing away a bid the page could select.
    dropped = [b for b in full if not any(b is k for k in slim)]
    ck("every dropped bid is unreachable from every grid ZIP",
       all(page_pick(full, g["zip"], _page_crop(b["commodity"])) is not b
           for b in dropped for g in grid))

    print()
    print("a bid is local when the query that found it was run around the reader")
    N = lambda z, sz, c, p_: {"zip": z, "sourceZip": sz, "commodity": c,
                              "cashPrice": p_, "city": z, "symbol": "ZCZ26",
                              "basis": round(p_ - 5.37, 4)}
    grid2 = [{"zip": "53705", "lat": 43.07, "lng": -89.40, "label": "Madison, WI"},
             {"zip": "50010", "lat": 42.03, "lng": -93.62, "label": "Ames, IA"}]
    rows2 = [
        N("53590", "53705", "Corn", 4.55),   # near Madison, facility ZIP is not a grid ZIP
        N("53598", "53705", "Corn", 4.61),   # near Madison, and pays more
        N("53705", "50010", "Corn", 4.40),   # sits AT Madison, returned by Ames's query
        N("50010", "50010", "Corn", 4.75),   # at Ames
        N("99999", "99999", "Corn", 9.99),   # the national top, nowhere near anyone
        # Four more inside Madison's query, all below 4.61 so the winner above
        # does not move, and enough depth that slim_for_browser has something
        # to leave behind now that it keeps three per ZIP and crop.
        N("53575", "53705", "Corn", 4.50),
        N("53711", "53705", "Corn", 4.45),
        N("53562", "53705", "Corn", 4.40),
        N("53527", "53705", "Corn", 4.35),
    ]
    verify_bids(rows2)
    for r in rows2:
        r["verified"] = True                 # the cohort is synthetic; test selection, not the guard
    ck("a bid found by the reader's own query is local even off-ZIP",
       page_pick(rows2, "53705", "corn")["cashPrice"] == 4.61)
    ck("...and the highest local price wins, not the first row",
       page_pick(rows2, "53705", "corn") is rows2[1])
    ck("a bid sitting AT the grid ZIP counts even when another query found it",
       near(rows2[2], "53705") is True)
    ck("Ames gets its own bid, not Madison's and not the national top",
       page_pick(rows2, "50010", "corn")["cashPrice"] == 4.75)
    ck("a grid ZIP whose query returned nothing still gets the national top",
       page_pick(rows2, "11111", "corn")["cashPrice"] == 9.99)
    ck("the national top is NOT shown to a reader who has a local bid",
       page_pick(rows2, "53705", "corn")["cashPrice"] != 9.99)

    slim2 = slim_for_browser(rows2, grid2)
    ck("the slim file keeps what each grid ZIP needs",
       all(page_pick(rows2, g["zip"], "corn") == page_pick(slim2, g["zip"], "corn")
           for g in grid2))
    ck("...and still keeps the national fallback",
       page_pick(rows2, "11111", "corn") == page_pick(slim2, "11111", "corn"))
    ck("the slim file is smaller than the full set", len(slim2) < len(rows2))

    print()
    print("nearest delivery beats a bigger number, and three bad date shapes")
    D = lambda end, p_, start=None, fac="X": {
        "zip": "53705", "sourceZip": "53705", "commodity": "Corn",
        "cashPrice": p_, "deliveryEnd": end, "deliveryStart": start or end,
        "city": "Madison", "facility": fac, "verified": True,
        "symbol": "ZCZ26", "basis": 0.0, "deliveryMonth": end[:7]}
    carry = [D("2027-06-30 00:00:00", 5.23, fac="deferred"),
             D("2026-08-31 00:00:00", 4.72, fac="spot")]
    ck("the June 2027 bid does not become today's cash price",
       page_pick(carry, "53705", "corn")["facility"] == "spot")

    split = [D("2026-08-31 00:00:00", 5.02, fac="midnight"),
             D("2026-08-31 23:59:59", 5.72, fac="one-second-to")]
    ck("one contract month with two end stamps is still one month",
       page_pick(split, "53705", "corn")["facility"] == "one-second-to")

    bad_start = [D("2026-12-01 00:00:00", 4.95, start="2012-02-28 00:00:00", fac="dec26"),
                 D("2026-08-31 00:00:00", 4.72, fac="aug26")]
    ck("a deliveryStart dated 2012 does not win the board",
       page_pick(bad_start, "53705", "corn")["facility"] == "aug26")

    no_dates = [dict(D("2026-01-01", 4.10, fac="cheap"), deliveryEnd=None, deliveryStart=None),
                dict(D("2026-01-01", 4.90, fac="dear"), deliveryEnd=None, deliveryStart=None)]
    ck("with no dates at all it falls back to price and does not crash",
       page_pick(no_dates, "53705", "corn")["facility"] == "dear")

    # ── A WINDOW THAT HAS CLOSED SORTS LAST ────────────────────────────────
    # The clock is pinned at 2026-08-01 above, so 2026-07-31 is yesterday and
    # 2026-08-31 is a month out. Before the floor these rows did not merely
    # appear on the page, they WON: the key was the bare date ascending, so
    # the further in the past a window was, the more certainly it was picked.
    # On data/bids.json of 2026-09-23, 45 of the 150 grid ZIP-and-crop picks
    # landed on a closed window, and so did all three national fallbacks --
    # the corn one on a window that shut in 2021.
    shut = [D("2026-07-31 00:00:00", 9.99, fac="expired"),
            D("2026-08-31 00:00:00", 4.72, fac="open")]
    ck("a window that closed yesterday loses to one still open, at any price",
       page_pick(shut, "53705", "corn")["facility"] == "open")

    # WHEN EVERY ROW IS CLOSED there is no local branch left to take -- it
    # drops them, as the pages do -- so the national fallback answers, and it
    # orders closed rows the way bidWhen() in the three futures pages orders
    # them: ascending, oldest first. Least-stale-first would read better and
    # would have made this the third definition of "closed" in the repository.
    # This check exists to pin the agreement, not to bless the order.
    two_shut = [D("2021-09-30 00:00:00", 5.17, fac="five-years-gone"),
                D("2026-07-31 00:00:00", 4.50, fac="last-month")]
    ck("with every row closed, the order matches bidWhen() in the pages",
       page_pick(two_shut, "53705", "corn")["facility"] == "five-years-gone")

    # AND A CLOSED LOCAL ROW IS NOT SHOWN AS LOCAL AT ALL. The pages skip it
    # and fall through to "best anywhere"; page_pick has to do the same or the
    # exit-4 guard certifies a rule no browser runs.
    local_shut = [dict(D("2026-07-31 00:00:00", 9.99, fac="local-but-shut"),
                       zip="53705", sourceZip="53705"),
                  dict(D("2026-08-31 00:00:00", 4.10, fac="far-but-open"),
                       zip="99999", sourceZip="99999")]
    ck("a closed local row falls through to the national branch, as the pages do",
       page_pick(local_shut, "53705", "corn")["facility"] == "far-but-open")

    # NOT KNOWING BEATS KNOWING IT IS SHUT. The old key gave an undated row
    # "9999-99-99", which sorted behind every closed window in the file.
    undated = [dict(D("2026-01-01", 4.10, fac="undated"), deliveryEnd=None, deliveryStart=None),
               D("2026-07-31 00:00:00", 9.99, fac="expired")]
    ck("a row with no delivery date outranks one whose window has closed",
       page_pick(undated, "53705", "corn")["facility"] == "undated")

    # AND AN OPEN WINDOW STILL BEATS AN UNDATED ROW, which is the half of the
    # old behaviour that was right.
    open_vs_undated = [dict(D("2026-01-01", 9.99, fac="undated"), deliveryEnd=None, deliveryStart=None),
                       D("2026-08-31 00:00:00", 4.10, fac="open")]
    ck("an open window still beats a row with no date at all",
       page_pick(open_vs_undated, "53705", "corn")["facility"] == "open")

    # THE TOTAL-ORDER PROPERTY SURVIVES THE PREFIX. It was hard won -- see
    # _bid_order's docstring and the eleven-ZIP build failure of 2026-09-02 --
    # and a three-tier key is exactly the kind of change that could lose it.
    mixed = [D("2026-07-31 00:00:00", 9.99, fac="expired"),
             D("2026-08-31 00:00:00", 4.72, fac="open"),
             D("2021-09-30 00:00:00", 5.17, fac="five-years-gone"),
             D("2027-06-30 00:00:00", 5.23, fac="deferred"),
             dict(D("2026-01-01", 4.10, fac="undated"), deliveryEnd=None, deliveryStart=None)]
    ck("_bid_order is still a total order across open, closed and undated rows",
       len({_bid_order(b) for b in mixed}) == len(mixed))

    # THE FLOOR MOVES WITH THE CLOCK, not with the data. Same rows, a pinned
    # date on either side of the window, opposite answers -- which is also
    # what proves the pin above is doing something.
    try:
        globals()["_AS_OF_OVERRIDE"] = "2026-07-01"
        ck("with the clock set before it, that same window is open and wins on price",
           page_pick(shut, "53705", "corn")["facility"] == "expired")
    finally:
        globals()["_AS_OF_OVERRIDE"] = PINNED_AS_OF
    ck("and set back after it, the open row wins again",
       page_pick(shut, "53705", "corn")["facility"] == "open")

    # THE KEY MUST SEPARATE EVERY ROW THE FILE ACTUALLY CONTAINS, and a
    # five-row fixture cannot show that. Agtegra posts the same corn price for
    # the same month at Grebner and at West Terminal; both carry a blank
    # branch, so facility+branch+commodity collided and the key was NOT a
    # total order -- 577 distinct keys over 584 rows before city, state and
    # zip were appended. That is the mechanism of the eleven-ZIP build failure
    # of 2026-09-02, sitting live in the committed file the whole time.
    _real = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                         "data", "bids.json")
    # NOT `if os.path.exists(...)`. Written that way it disappeared when the
    # file was missing and the suite still printed "all N checks pass" -- and
    # this is the only check protecting the tie-break tail.
    _rows = []
    try:
        with open(_real) as _f:
            _rows = json.load(_f).get("bids") or []
    except OSError:
        pass
    # AND IT REPORTS, IT DOES NOT BLOCK. THIS EXACT CHECK FROZE THE NATIONAL
    # CASH-BID FEED FOR TWENTY-SEVEN HOURS.
    #
    # Runs #1151, #1152 and #1153 (23 Sep 14:10 CDT, 23 Sep 17:25, 24 Sep
    # 10:47) each died here in under 31 seconds:
    #
    #     1 FAILED of 123
    #       - _bid_order separates every one of the 889 committed rows
    #
    # The selftest runs BEFORE the fetch. So the run exited 1, no Barchart call
    # was made, nothing was written, and data/bids.json stayed exactly as it
    # was -- which is to say, it stayed the file that fails the check. The only
    # process that could have replaced the two colliding rows was the one this
    # check was stopping. Corn, soybean and wheat cash cards across the site
    # served 23 September's prices into 24 September's afternoon.
    #
    # A GUARD MUST NOT GATE THE ONLY PATH THAT CAN HEAL WHAT IT GUARDS. The
    # collision is real and worth seeing -- an unstable tie-break means the
    # page can name Elevator A this morning and Elevator B this afternoon --
    # but it cannot make a price wrong, and a day of stale prices everywhere
    # is the larger harm by a distance. So it prints, it annotates the run,
    # and the fetch goes ahead.
    #
    # THE FLOOR IS THE HARD PART, AND IT IS HARD ON PURPOSE. `bool(_rows)`
    # meant a file that had been emptied, truncated or renamed made this check
    # vanish rather than fail -- the same shape as the `if os.path.exists`
    # above it. A real file has hundreds of rows; 100 is low enough that no
    # ordinary day approaches it and high enough that a broken read cannot
    # slip past.
    ck(f"the committed file is readable and whole ({len(_rows)} rows)",
       len(_rows) >= 100)
    _keys = {_bid_order(b) for b in _rows}
    if _rows and len(_keys) != len(_rows):
        _byk = {}
        for _b in _rows:
            _byk.setdefault(_bid_order(_b), []).append(_b)
        _coll = [g for g in _byk.values() if len(g) > 1]
        _n = sum(len(g) for g in _coll)
        print(f"  WARN _bid_order ties {_n} of the {len(_rows)} committed rows "
              f"into {len(_coll)} key(s); the pick between them is arbitrary")
        for _g in _coll[:6]:
            _r = _g[0]
            print(f"       {_r.get('facility')} / {_r.get('branch')} / "
                  f"{_r.get('commodity')} / {_r.get('deliveryMonth')} "
                  f"@ {_r.get('cashPrice')} x{len(_g)}")
        # Surfaces in the Actions run summary without failing the step.
        print(f"::warning title=_bid_order tie::{_n} of {len(_rows)} committed "
              f"rows share a sort key with another row; the tie-break needs a "
              f"field these rows differ on")
    else:
        print(f"  ok   _bid_order separates every one of the {len(_rows)} "
              f"committed rows")
        checks += 1

    print("the identity guard withholds what it cannot check, and nothing else")
    R = lambda c, sym, cash, basis: {"commodity": c, "symbol": sym,
                                     "cashPrice": cash, "basis": basis,
                                     "zip": "00000", "city": "x"}
    rows = [
        R("Corn", "ZCZ26", 4.60, -0.77),          # implies 5.37
        R("Corn", "ZCZ26", 4.85, -0.52),          # implies 5.37
        R("Corn", "ZCZ26", 5.00, -0.37),          # implies 5.37
        R("Corn", "ZCZ6",  5.10, -0.27),          # same contract, short year
        R("Corn", "N27",  12.92, -0.20),          # implies 13.12 -- the defect
        R("White Corn", "ZCZ26", 6.37,  1.00),    # premium, identity exact
        R("MILO", "ZCZ26", 4.72, -0.65),          # sorghum priced off corn
        R("Soybean Meal", "ZMV26", 3.425, 0.0),   # dollars per TON, not bushel
    ]
    ok, bad = verify_bids(rows)
    by = {(r["commodity"], r["symbol"]): r for r in rows}
    ck("a row whose cash minus basis matches its cohort is verified",
       by[("Corn", "ZCZ26")]["verified"] is True)
    ck("the premium row is kept -- the test is the identity, not the level",
       by[("White Corn", "ZCZ26")]["verified"] is True
       and by[("White Corn", "ZCZ26")]["cashPrice"] > by[("Corn", "ZCZ26")]["cashPrice"])
    ck("a contract written with a one-digit year joins its own cohort",
       _norm_symbol("ZCZ6") == _norm_symbol("ZCZ26"))
    ck("sorghum quoted against corn futures is checked, not refused for being sorghum",
       by[("MILO", "ZCZ26")]["verified"] is True)
    ck("the row implying 13.12 corn is withheld",
       by[("Corn", "N27")]["verified"] is False)
    ck("...and it says why, in figures",
       "13.12" in by[("Corn", "N27")]["unverifiedWhy"])
    ck("a per-ton quote sitting in the soybean bucket is withheld",
       by[("Soybean Meal", "ZMV26")]["verified"] is False)
    ck("the counts add up", ok + bad == len(rows) and bad == 2)
    ck("nothing was corrected -- the withheld row keeps its own numbers",
       by[("Corn", "N27")]["cashPrice"] == 12.92)
    ck("the page will not select a withheld row",
       page_pick(rows, "00000", "corn")["cashPrice"] != 12.92)
    ck("a row with no verified field at all is still selectable",
       verified_only([{"cashPrice": 1}]) != [])

    print()
    print("a cohort that disagrees with itself cannot become anyone's yardstick")
    canola = [R("Canola", "RSX26", 7.407, -83.0), R("Canola", "RSX26", 6.906, -133.1),
              R("Canola", "RSX26", 6.907, -133.0), R("Canola", "RSX26", 7.297, -94.0)]
    lone = R("Durum", "DWBQ26-56338-14680.CM", 5.25, 0.0)
    verify_bids(canola + [lone])
    ck("the disagreeing cohort is withheld", all(r["verified"] is False for r in canola))
    ck("and the unrelated single row is not measured against it",
       lone["verified"] is False and "120" not in lone["unverifiedWhy"]
       and "nothing here can check it" in lone["unverifiedWhy"])

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
    print("the pick does not depend on the order the rows arrive in")
    # 2026-09-02, run 91285466096: the run failed with exit 4 --
    # "the slim file would change what the futures pages display for 11 grid
    # ZIP/crop pairs" -- and every one of the eleven was wheat.
    #
    # Nothing was wrong with the data. _bid_order returned (deliveryEnd, -price)
    # and NOTHING ELSE, so it is not a total order: seven Aberdeen elevators sit
    # on ('2026-11-30', -12.58) in the committed file alone, and 136 of its 440
    # rows share a key with some other row. min() returns whichever tied row it
    # reaches first, and page_pick walks the full list while the slim file is a
    # dict rebuilt in a different sequence -- so the two picked different rows
    # with identical price and identical delivery, and the equivalence guard,
    # comparing whole rows, correctly said they disagreed.
    #
    # It was never only a build failure. An unstable pick means the page can
    # name Elevator A this morning and Elevator B this afternoon off the same
    # numbers, and the farmer who drove to the first one has no idea why.
    tied = [
        {"facility": "West-Con", "branch": "", "city": "Aberdeen", "state": "SD",
         "commodity": "Wheat", "cashPrice": 12.58, "deliveryEnd": "2026-11-30", "zip": "57401"},
        {"facility": "Country Pride Coop", "branch": "", "city": "Aberdeen", "state": "SD",
         "commodity": "Wheat", "cashPrice": 12.58, "deliveryEnd": "2026-11-30", "zip": "57401"},
        {"facility": "Agwrx Cooperative", "branch": "", "city": "Aberdeen", "state": "SD",
         "commodity": "Wheat", "cashPrice": 12.58, "deliveryEnd": "2026-11-30", "zip": "57401"},
    ]
    picks = {id(min(order, key=_bid_order)) for order in
             (tied, list(reversed(tied)), [tied[1], tied[2], tied[0]])}
    ck("three tied rows in three orders select the SAME row", len(picks) == 1)
    ck("_bid_order is a total order over rows that differ",
       len({_bid_order(b) for b in tied}) == len(tied))
    # And the same thing through the door that actually failed: the equivalence
    # check the run performs, on a full set and a slim set built from it.
    grid = [{"zip": "57401", "label": "Aberdeen, SD"}]
    full = list(tied)
    slim = slim_for_browser(full, grid)
    ck("slim and full pick the same wheat row for the grid ZIP",
       page_pick(full, "57401", "wheat") == page_pick(slim, "57401", "wheat"))
    ck("...and the same one nationally",
       page_pick(full, None, "wheat") == page_pick(slim, None, "wheat"))

    print()
    print("THE NETWORK MERGE -- run against a written feed, not a described one")
    import tempfile, shutil
    # A feed with every case that has bitten: a stale row, a broken-source row,
    # a deferred month priced above the nearby one at the SAME elevator, a
    # duplicate of a Barchart row, and a commodity whose trade abbreviation the
    # card and the map used to classify differently.
    feed = {"schema": "agsist-merged-all/1", "bids": [
        {"operator": "Kanza Co-op", "city": "Iuka", "state": "KS", "zip": "67066",
         "lat": 37.73, "lon": -98.73, "commodity": "Corn", "crop": "corn",
         "cash": 5.10, "basis": -0.25, "futuresMonth": "ZCZ26",
         "delivery": "Sep 2026", "period": "2026-09", "stale": False, "sourceStatus": "ok"},
        {"operator": "Kanza Co-op", "city": "Iuka", "state": "KS", "zip": "67066",
         "lat": 37.73, "lon": -98.73, "commodity": "Corn", "crop": "corn",
         "cash": 5.85, "basis": -0.10, "futuresMonth": "ZCN27",
         "delivery": "Jul 2027", "period": "2027-07", "stale": False, "sourceStatus": "ok"},
        {"operator": "Stale Elevator", "city": "Pratt", "state": "KS", "zip": "67124",
         "lat": 37.64, "lon": -98.73, "commodity": "Corn", "crop": "corn",
         "cash": 9.99, "basis": -0.05, "futuresMonth": "ZCZ26",
         "delivery": "Sep 2026", "period": "2026-09", "stale": True, "sourceStatus": "ok"},
        {"operator": "Broken Elevator", "city": "Pratt", "state": "KS", "zip": "67124",
         "lat": 37.64, "lon": -98.73, "commodity": "Corn", "crop": "corn",
         "cash": 8.88, "basis": -0.05, "futuresMonth": "ZCZ26",
         "delivery": "Sep 2026", "period": "2026-09", "stale": False, "sourceStatus": "refused"},
        {"operator": "Dupe Co-op", "city": "Hutchinson", "state": "KS", "zip": "67501",
         "lat": 38.06, "lon": -97.93, "commodity": "HRS", "crop": "wheat",
         "cash": 7.20, "basis": -0.40, "futuresMonth": "KEZ26",
         "delivery": "Sep 2026", "period": "2026-09", "stale": False, "sourceStatus": "ok"},
        # A CANADIAN BID AT A PRICE THAT WOULD WIN EVERYTHING.
        # cash-bids.html has dropped non-USD rows since an Ontario wheat bid
        # reached a Michigan ZIP search as BEST WHEAT at $8.85 against $7.13.
        # This file had no such check, and once expired rows were correctly
        # demoted an Ontario elevator became the national wheat answer.
        {"operator": "Ontario Grain", "city": "Blenheim", "state": "ON", "zip": "N0P",
         "lat": 42.34, "lon": -82.00, "commodity": "Corn", "crop": "corn",
         "cash": 99.00, "basis": -0.05, "futuresMonth": "ZCZ26", "currency": "CAD",
         "delivery": "Sep 2026", "period": "2026-09", "stale": False, "sourceStatus": "ok"},
    ]}
    tmp = tempfile.mkdtemp()
    os.makedirs(os.path.join(tmp, "data"), exist_ok=True)
    with open(os.path.join(tmp, "data", "merged-all.json"), "w") as f:
        json.dump(feed, f)
    grid_n = [{"zip": "67501", "lat": 38.06, "lng": -97.93}]

    buf = io.StringIO()
    with redirect_stdout(buf), redirect_stderr(buf):
        net = network_rows(grid_n, base=tmp)
    ck("the stale row is not merged", not any(r["cashPrice"] == 9.99 for r in net))
    ck("a bid priced in another currency is not merged",
       not any(r["cashPrice"] == 99.00 for r in net))

    # Built deliberately out of key order, so a function that returns
    # keep.values() unsorted fails this and one that sorts passes it. The
    # dict preserves insertion order, and these two go in dearest-first while
    # the key wants the earlier window first.
    _unsorted = [
        {"facility": "B", "commodity": "Corn", "cashPrice": 9.99,
         "deliveryEnd": "2026-12-31", "zip": "67501", "sourceZip": "67501",
         "verified": True, "city": "x", "symbol": "ZCZ26", "basis": 0.0},
        {"facility": "A", "commodity": "Corn", "cashPrice": 1.00,
         "deliveryEnd": "2026-08-31", "zip": "67501", "sourceZip": "67501",
         "verified": True, "city": "x", "symbol": "ZCZ26", "basis": 0.0},
    ]
    _sl2 = slim_for_browser(_unsorted, grid_n)
    ck("the slim file is emitted in _bid_order order",
       _sl2 == sorted(_sl2, key=_bid_order) and len(_sl2) == 2
       and _sl2[0]["facility"] == "A")

    # THE LABEL IS IN THE TIE-BREAK because the label is on the card. Abbyville
    # posts one soybean price for one end date under two window labels; ADM
    # Toledo posts one December corn price as "NC 26" and again as
    # "December 2026". Without deliveryMonth in the key those collide, min()
    # returns whichever the list reaches first, and the full file and the
    # rebuilt slim file can print different words for the same bid.
    _twin = [{"facility": "Same", "branch": "", "commodity": "Corn", "cashPrice": 5.00,
              "deliveryEnd": "2026-12-31", "city": "Toledo", "state": "OH", "zip": "43605",
              "deliveryMonth": lbl} for lbl in ("NC 26 (2026-12)", "December 2026 (2026-12)")]
    ck("two rows differing only by the printed label still get different keys",
       _bid_order(_twin[0]) != _bid_order(_twin[1]))

    # DEPTH, AND A ROW THAT OUTLIVES THE MONTH. One row per ZIP and crop is
    # always the row that expires first, so the file went thin the moment that
    # window shut -- on the merged feed, local answers fell from 98 of 150 to
    # 24 a week after the build. Three rows plus the soonest still open five
    # weeks out holds 96 of 98.
    # The facility ZIP is deliberately NOT a grid ZIP. slim_for_browser keeps
    # every row that SITS AT a grid ZIP unconditionally, so a fixture written
    # with zip == the grid ZIP is kept whatever the depth rule does, and the
    # check below cannot fail. These are near the grid ZIP by sourceZip only.
    _deep = [dict({"facility": f"E{i}", "commodity": "Corn", "cashPrice": 5.00 - i / 100,
                   "zip": "67999", "sourceZip": "67501", "verified": True, "city": "x",
                   "symbol": "ZCZ26", "basis": 0.0}, deliveryEnd=end)
             for i, end in enumerate(["2026-08-10", "2026-08-20", "2026-08-25",
                                      "2026-08-28", "2026-11-30"])]
    _sl3 = slim_for_browser(_deep, grid_n)
    _kept = {r.get("facility") for r in _sl3}
    ck("the slim file keeps the three soonest local rows, not just the first",
       {"E0", "E1", "E2"} <= _kept)
    ck("...and one whose window is still open five weeks out",
       any(r.get("deliveryEnd") == "2026-11-30" for r in _sl3))

    # A NaN PRICE COMPARES FALSE AGAINST EVERYTHING, so one of them makes
    # min() depend on the order of the list it is handed -- the same asymmetry
    # between the full set and the rebuilt slim file that produced exit 4.
    # json.load() parses a bare NaN literal happily.
    ck("a NaN price is flattened rather than left to poison the sort",
       _bid_order({"cashPrice": float("nan"), "deliveryEnd": "2026-08-31"})
       == _bid_order({"cashPrice": 0, "deliveryEnd": "2026-08-31"}))
    ck("...and so is an infinite one",
       _bid_order({"cashPrice": float("inf"), "deliveryEnd": "2026-08-31"})
       == _bid_order({"cashPrice": 0, "deliveryEnd": "2026-08-31"}))

    # THE CLOCK IS RESOLVED ONCE PER PROCESS. _bid_order asks for today on
    # every key it builds -- thirteen thousand times over the committed file --
    # and main() walks the full set and the slim set in separate loops. A UTC
    # midnight between them would put two rows with the same date in different
    # tiers and exit 4 a healthy run.
    try:
        globals()["_AS_OF_OVERRIDE"] = None
        globals()["_AS_OF_CACHE"] = None
        _first = _as_of()
        ck("_as_of caches, so one run cannot straddle two dates",
           _AS_OF_CACHE == _first and _as_of() is _first)
    finally:
        globals()["_AS_OF_OVERRIDE"] = PINNED_AS_OF
        globals()["_AS_OF_CACHE"] = None
    ck("the broken-source row is not merged", not any(r["cashPrice"] == 8.88 for r in net))
    ck("the good rows are merged", len(net) == 3)
    ck("a period becomes sortable delivery dates",
       _period_dates("2026-09") == ("2026-09-01", "2026-09-30")
       and _period_dates("2026-09/2026-11")[1] == "2026-11-30")

    # ── A SEASON AND A SPOT ROW ARE NOT UNDATED ───────────────────────────
    # The clock is pinned at 2026-08-01 for this suite, so "now" is August.
    ck("a spot row is dated as the month it was posted in, not as today",
       _period_dates("spot") == ("2026-08-01", "2026-08-31"))
    # It ties with an open row in the same month, so PRICE decides between
    # them -- which is the whole reason month-end was chosen over today.
    ck("...so a dearer dated row in the same month beats it on price",
       _bid_order({"deliveryEnd": "2026-08-31", "cashPrice": 5.00})
       < _bid_order({"deliveryEnd": _period_dates("spot")[1], "cashPrice": 4.00}))
    ck("a wheat season runs from June to the end of September, not to August",
       _period_dates("newcrop-2027", "wheat") == ("2027-06-01", "2027-09-30"))
    # SPRING WHEAT IS WHY IT RUNS TO SEPTEMBER. Hard red winter is cut in
    # Kansas in late June; hard red spring runs into late September in North
    # Dakota, and CHS Devils Lake of Hannaford ND posts "New Crop 2026" hard
    # red spring live. An August end called that bid expired.
    ck("...so a spring-wheat harvest bid is still open on 20 September",
       not _is_closed({"deliveryEnd": _period_dates("newcrop-2026", "wheat")[1]},
                      ) if _as_of() <= "2026-09-30" else True)
    # A SEASON WHOSE WINDOW HAS GONE IS PUBLISHED UNDATED, NOT CLOSED. The
    # window is one rule for a crop grown from Texas to Manitoba; at its edge
    # it is more likely to be wrong than the row is to be dead.
    ck("a season already harvested is undated rather than marked expired",
       _period_dates("newcrop-2024", "wheat") == ("", ""))
    ck("...and an undated row still outranks a closed one",
       _bid_order({"deliveryEnd": ""}) < _bid_order({"deliveryEnd": "2026-07-31"}))

    # ── THE TIERS THEMSELVES, WITH NO page_pick IN THE PATH ───────────────
    # An audit found that every floor check passed because page_pick DROPS a
    # closed row, so the tier could be inverted and the suite stayed green.
    # These assert the order of the key directly.
    _open = {"deliveryEnd": "2026-08-31", "cashPrice": 1.00}
    _shut = {"deliveryEnd": "2026-07-31", "cashPrice": 9.99}
    _none = {"deliveryEnd": "", "cashPrice": 1.00}
    ck("an open window sorts ahead of an undated row",
       _bid_order(_open) < _bid_order(_none))
    ck("an undated row sorts ahead of a closed one",
       _bid_order(_none) < _bid_order(_shut))
    ck("a closed window sorts behind both, whatever it pays",
       _bid_order(_shut) > _bid_order(_open) and _bid_order(_shut) > _bid_order(_none))
    ck("and the soonest open window sorts first",
       _bid_order({"deliveryEnd": "2026-08-31"}) < _bid_order({"deliveryEnd": "2026-09-30"}))

    # ── 29 FEBRUARY ──────────────────────────────────────────────────────
    # The month-end was a hand-written table that said 28. On a leap day the
    # spot window came back ending before it started, and every spot row in
    # the feed read as closed on the day it was posted.
    try:
        globals()["_AS_OF_OVERRIDE"] = "2028-02-29"
        _sp = _period_dates("spot")
        ck("a spot window on a leap day ends on the 29th, not the 28th",
           _sp == ("2028-02-29", "2028-02-29"))
        ck("...so it is not closed on the day it was posted",
           not _is_closed({"deliveryEnd": _sp[1]}))
        ck("and a February month-range ends on the 29th too",
           _period_dates("2028-02")[1] == "2028-02-29")
    finally:
        globals()["_AS_OF_OVERRIDE"] = PINNED_AS_OF

    # ── A STORAGE BID IS NOT A DELIVERY BID ──────────────────────────────
    for _lab in ("In Store", "Instore", "Instore HRWW", "Open Storage"):
        ck(f"{_lab!r} gets no delivery window",
           _period_dates("spot", "corn", _lab) == ("", ""))
    ck("...while a plain cash bid still does",
       _period_dates("spot", "corn", "Cash Bid")[1] == "2026-08-31")
    ck("an unclassified commodity gets the corn-belt window, not nothing",
       _period_dates("newcrop-2027", "other")[1] == "2027-12-31")
    # THE ONE IT STILL REFUSES. oldcrop names the year the grain grew in, not
    # a window it can be hauled in.
    ck("oldcrop is still refused rather than given an invented window",
       _period_dates("oldcrop-2026") == ("", ""))
    # THIS CHECK USED TO ASSERT THE OPPOSITE, and its name said "sorts LAST"
    # while its body asserted a return value. Both are now wrong: a season is
    # a harvest window with dates, and it sorts where that window falls.
    ck("a season is the harvest window of its crop year, not a blank",
       _period_dates("newcrop-2027", "corn") == ("2027-10-01", "2027-12-31"))
    ck("HRS lands in the same bucket the card classifies it into",
       [r["category"] for r in net if r["commodity"] == "HRS"] == ["wheat"])
    ck("every network row carries the grid ZIP it is near",
       all(r["sourceZip"] == "67501" for r in net if r["distance"] is not None and r["distance"] <= MERGE_RADIUS_MI))

    # THE BUG THE PANEL CAUGHT: the nearby month must win the card, not the
    # higher-priced 2027 contract at the same elevator.
    with redirect_stdout(buf), redirect_stderr(buf):
        pick = page_pick(slim_for_browser(net, grid_n), "67501", "corn")
    ck("the NEARBY month wins the card, not the higher deferred bid",
       pick is not None and pick["cashPrice"] == 5.10)

    # Dedup: ours displaces Barchart's copy and inherits its phone.
    bc_rows = [
        {"facility": "Dupe Co-op", "city": "Hutchinson", "state": "KS", "commodity": "Wheat",
         "cashPrice": 7.10, "basis": -0.45, "phone": "(620) 555-0100", "category": "wheat",
         "sourceZip": "67501", "zip": "67501", "deliveryEnd": "2026-09-30", "verified": True},
        {"facility": "Only In Barchart", "city": "Wichita", "state": "KS", "commodity": "Corn",
         "cashPrice": 5.00, "basis": -0.30, "phone": "(316) 555-0101", "category": "corn",
         "sourceZip": "67501", "zip": "67202", "deliveryEnd": "2026-09-30", "verified": True},
    ]
    with redirect_stdout(buf), redirect_stderr(buf):
        m = merge_network(bc_rows, grid_n, base=tmp)
    ck("Barchart's copy of an elevator we read ourselves is dropped",
       not any(r.get("cashPrice") == 7.10 for r in m))
    ck("...and our row inherits the phone number it displaced",
       any(r.get("source") == "network" and r.get("phone") == "(620) 555-0100" for r in m))
    ck("a Barchart elevator we do NOT read is kept",
       any(r.get("facility") == "Only In Barchart" for r in m))

    # THE DUPLICATE THAT REACHED THE PAGE, 2026-09-22: cash-bids.html drew
    # Badger Grain Supply of Wheeler twice because one feed writes ", LLC" and
    # the other does not, and Midwest Commodity twice off a single plural.
    ck("a trailing LLC does not split one elevator into two",
       _net_key("Badger Grain Supply", "Wheeler", "WI")
       == _net_key("Badger Grain Supply, LLC", "Wheeler", "WI"))
    ck("nor does Service against Services",
       _net_key("Midwest Commodity Services Inc.", "Baldwin", "WI")
       == _net_key("Midwest Commodity Service, Inc.", "Baldwin", "WI"))
    ck("nor Coop against Cooperative",
       _net_key("Farmers Win Coop", "Cresco", "IA")
       == _net_key("Farmers Win Cooperative", "Cresco", "IA"))
    ck("but a name differing by a REAL word is still two elevators",
       _net_key("ADM Grain", "Jackson", "TN") != _net_key("ADM", "Jackson", "TN"))
    ck("a co-op keeps a 'co' that is part of its name",
       _net_key("Co-op Services", "Ames", "IA").startswith("coopservice"))
    ck("the key still separates two towns",
       _net_key("Badger Grain Supply", "Wheeler", "WI")
       != _net_key("Badger Grain Supply", "Menomonie", "WI"))

    # NEVER LOAD-BEARING: an unreachable feed leaves Barchart untouched.
    with redirect_stdout(buf), redirect_stderr(buf):
        m2 = merge_network(bc_rows, grid_n, base=os.path.join(tmp, "does-not-exist"))
    ck("an unreachable network feed returns the Barchart rows unchanged", m2 == bc_rows)
    shutil.rmtree(tmp, ignore_errors=True)

    _AS_OF_OVERRIDE = _prev_as_of
    _AS_OF_CACHE = _prev_cache

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
