#!/usr/bin/env python3
"""
AGSIST Cash Bid Scraper — Hybrid: Farmbucks + Barchart
========================================================
Two-phase scraper for complete WI/MN grain elevator coverage.

Phase 1: Farmbucks.com (FREE, no key)
  - Scrapes SSR HTML tables for ~16 WI/MN companies
  - Covers ALCIVIA, Allied, United Coop, Country Visions, CFS,
    Farmers Win, Farmward, New Vision, ADM, POET, etc.
  - ~60-80 locations with real prices

Phase 2: Barchart getGrainBids API (FREE TRIAL key, optional)
  - Queries 25 zip codes across WI/MN
  - Returns 30 nearest elevators per zip
  - Catches EVERY elevator: CHS, small independents, processors
  - Only adds locations NOT already covered by Farmbucks
  - Set BARCHART_API_KEY env var to enable

Output: bids.json — THE database (no separate hardcoded elevator list)
        Only contains real scraped data, never fake/sample.

Usage:
  python scrape_bids.py                              # Farmbucks only
  BARCHART_API_KEY=xxx python scrape_bids.py         # Farmbucks + Barchart
  python scrape_bids.py --dry-run                    # just list sources

Schedule (GitHub Actions):
  Market hours Mon-Fri 8am-4pm CT: every 2 hours
  Off-hours/weekends: every 8 hours
  Harvest Sep-Nov: every 1 hour during market hours
"""

import json, re, sys, time, os
from datetime import datetime, timezone
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError

# ═══════════════════════════════════════════════════════════════════════
# PHASE 1: FARMBUCKS SOURCES
# ═══════════════════════════════════════════════════════════════════════
# (slug, state_filter, display_name, type)
FARMBUCKS = [
    # WI coops
    ("alcivia",          "wisconsin",  "ALCIVIA",                     "coop"),
    ("allied-coop",      None,         "Allied Cooperative",          "coop"),
    ("country-visions",  None,         "Country Visions Cooperative", "coop"),
    ("united-coop",      "wisconsin",  "United Cooperative",          "coop"),
    # WI ethanol
    ("ace-ethanol",      None,         "Ace Ethanol",                 "ethanol"),
    # MN coops
    ("cfs",              "minnesota",  "Central Farm Service (CFS)",  "coop"),
    ("farmers-win-coop", "minnesota",  "Farmers Win Coop",            "coop"),
    ("farmward",         None,         "Farmward Cooperative",        "coop"),
    ("new-vision-coop",  None,         "New Vision Co-op",            "coop"),
    ("nexus",            None,         "Nexus Cooperative",           "coop"),
    ("ag-plus",          None,         "Ag Plus Cooperative",         "coop"),
    ("stateline-coop",   None,         "StateLine Coop",              "coop"),
    # National with MN/WI presence
    ("adm",              "minnesota",  "ADM",                         "processor"),
    ("adm",              "wisconsin",  "ADM",                         "processor"),
    ("agp",              None,         "AG Processing (AGP)",         "processor"),
    ("al-corn",          None,         "Al-Corn Clean Fuel",          "ethanol"),
    ("poet",             "minnesota",  "POET Biorefining",            "ethanol"),
    ("bunge",            "minnesota",  "Bunge",                       "processor"),
    ("bunge",            "wisconsin",  "Bunge",                       "processor"),
    ("cargill",          "minnesota",  "Cargill",                     "processor"),
    ("cargill",          "wisconsin",  "Cargill",                     "processor"),
    ("jennie-o",         None,         "Jennie-O",                    "processor"),
    ("michael-foods",    None,         "Michael Foods",               "processor"),
    ("green-plains",     "minnesota",  "Green Plains",                "ethanol"),
]

# ═══════════════════════════════════════════════════════════════════════
# PHASE 2: BARCHART ZIP CODES (25 strategic points covering WI + MN)
# ═══════════════════════════════════════════════════════════════════════
# Each returns up to 30 nearest elevators within ~75 miles
BARCHART_ZIPS = [
    # Wisconsin — spread across grain country
    "53916",  # Beaver Dam (central WI grain belt)
    "53901",  # Portage
    "53703",  # Madison
    "54601",  # La Crosse (western WI)
    "54449",  # Marshfield (central)
    "53151",  # New Berlin / Waukesha (SE WI)
    "53545",  # Janesville (southern WI)
    "54880",  # Superior (NW WI)
    "54301",  # Green Bay (NE WI)
    "54401",  # Wausau (north central)
    "54701",  # Eau Claire (west central)
    "53965",  # Wisconsin Dells
    "54220",  # Manitowoc (lakeshore)
    # Minnesota — southern grain belt
    "56001",  # Mankato
    "55060",  # Owatonna
    "55901",  # Rochester
    "55987",  # Winona
    "56073",  # New Ulm
    "56258",  # Marshall
    "56187",  # Worthington
    "56003",  # St. Peter
    "55021",  # Faribault
    "56019",  # Blue Earth
    "55912",  # Austin
    "56201",  # Willmar
]


# ═══════════════════════════════════════════════════════════════════════
# FARMBUCKS PARSER
# ═══════════════════════════════════════════════════════════════════════

def fetch_url(url, timeout=30):
    """GET a URL. Returns text or None."""
    try:
        req = Request(url, headers={
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
            "Accept": "text/html,application/json",
        })
        with urlopen(req, timeout=timeout) as r:
            if r.status == 200:
                return r.read().decode("utf-8", errors="replace")
    except Exception as e:
        print(f"    ERR: {e}", file=sys.stderr)
    return None


def parse_farmbucks(html):
    """Parse Farmbucks SSR HTML → list of bid dicts."""
    bids = []
    p3 = re.compile(r'\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|')
    p2 = re.compile(r'^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$')

    sections = re.split(r'##\s+', html)
    for section in sections:
        header = section.split('\n')[0].strip()
        com = _commodity(header)
        if not com:
            continue

        cur_loc = ""
        for line in section.split('\n'):
            line = line.strip()
            if not line.startswith('|'):
                continue

            m3 = p3.search(line)
            if m3:
                c1, c2, c3 = m3.group(1).strip(), m3.group(2).strip(), m3.group(3).strip()
                if c1 == "Location" or "---" in c1:
                    continue
                price = _price(c3)
                if not price:
                    continue
                if re.search(r'(Wisconsin|Minnesota|Compare)', c1, re.I):
                    cur_loc = c1
                delivery = c2
            else:
                m2 = p2.search(line)
                if not m2:
                    continue
                c1, c2 = m2.group(1).strip(), m2.group(2).strip()
                price = _price(c2)
                if not price or not cur_loc:
                    continue
                delivery = c1

            if not cur_loc or not price:
                continue

            city, state = _location(cur_loc)
            if city and _is_spot(delivery):
                bids.append({"city": city, "state": state, "commodity": com,
                             "cashPrice": price, "delivery": delivery.strip()})
    return bids


def parse_farmbucks_locations(html):
    """Extract lat/lng from Google Maps links on Farmbucks page."""
    locs = {}
    for m in re.finditer(r'\[([^]]+,\s*(WI|MN))\]\(https://www\.google\.com/maps/place/([-\d.]+),([-\d.]+)', html):
        city = m.group(1).replace(f", {m.group(2)}", "").strip()
        locs[f"{city}|{m.group(2)}"] = {"lat": float(m.group(3)), "lng": float(m.group(4))}
    return locs


# ═══════════════════════════════════════════════════════════════════════
# BARCHART API PARSER
# ═══════════════════════════════════════════════════════════════════════

def fetch_barchart_bids(api_key, zip_code):
    """Query Barchart getGrainBids for a zip code. Returns parsed JSON or None."""
    url = (f"https://ondemand.websol.barchart.com/getGrainBids.json"
           f"?apikey={api_key}&zipCode={zip_code}"
           f"&commodityName=Corn%20(%232%20Yellow)|Soybeans%20(%232%20Yellow)"
           f"|Wheat%20(Soft%20Red%20Winter)|Oats"
           f"&maxDistance=75&getAllBids=0&totalLocations=30&numOfDecimals=2")
    text = fetch_url(url, timeout=15)
    if not text:
        return None
    try:
        data = json.loads(text)
        if data.get("status", {}).get("code") != 200:
            print(f"    API error: {data.get('status', {}).get('message', 'unknown')}", file=sys.stderr)
            return None
        return data.get("results", [])
    except json.JSONDecodeError:
        return None


def parse_barchart_results(results):
    """Convert Barchart API results → our bid format.

    Barchart returns: {elevator_name, city, state, commodity, basis, cashPrice,
                       deliveryMonth, deliveryStart, deliveryEnd, ...}
    """
    bids = []
    for r in results:
        state = r.get("county_state") or r.get("state", "")
        if state not in ("WI", "MN"):
            continue

        com = _commodity(r.get("commodity_display_name", "") or r.get("commodity", ""))
        if not com:
            continue

        cash = r.get("cashprice") or r.get("cashPrice")
        if not cash:
            continue
        try:
            cash = float(cash)
        except (ValueError, TypeError):
            continue

        basis = r.get("basis")
        try:
            basis = int(float(basis) * 100) if basis else None
        except (ValueError, TypeError):
            basis = None

        city = (r.get("elevator_city") or r.get("city") or "").strip()
        elevator = (r.get("elevator_name") or r.get("elevator") or "").strip()
        lat = r.get("latitude") or r.get("lat")
        lng = r.get("longitude") or r.get("lng")
        delivery = r.get("delivery_end") or r.get("deliveryEnd") or ""

        if not city or not elevator:
            continue

        bids.append({
            "elevator": elevator,
            "city": city,
            "state": state,
            "commodity": com,
            "cashPrice": cash,
            "basis": basis,
            "delivery": delivery,
            "lat": float(lat) if lat else None,
            "lng": float(lng) if lng else None,
            "type": _guess_type(elevator),
        })
    return bids


# ═══════════════════════════════════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════════════════════════════════

def _commodity(s):
    s = s.lower()
    if "corn" in s: return "corn"
    if "soybean" in s or "soy" in s: return "soy"
    if "wheat" in s: return "wheat"
    if "oat" in s: return "oats"
    return None

def _price(s):
    m = re.search(r'(\d+\.\d{2})', s.replace("USD","").replace("$",""))
    return float(m.group(1)) if m else None

def _location(raw):
    loc = re.sub(r'\[Compare prices\]\([^)]*\)', '', raw).strip()
    loc = re.sub(r'Compare prices.*$', '', loc).strip()
    m = re.search(r',?\s*(Wisconsin|Minnesota|WI|MN)\s*$', loc, re.I)
    if m:
        state = "WI" if m.group(1).lower() in ("wisconsin","wi") else "MN"
        city = loc[:m.start()].strip().rstrip(',').strip()
    else:
        state = ""
        city = loc.strip()
    return city, state

def _is_spot(d):
    now = datetime.now()
    mos = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"]
    dl = d.lower()
    return mos[now.month-1] in dl or mos[now.month % 12] in dl

def _guess_type(name):
    n = name.lower()
    if any(k in n for k in ("ethanol","poet","al-corn","ace eth","green plains","guardian","highwater","marquis","badger state","fox river","didion")):
        return "ethanol"
    if any(k in n for k in ("adm","cargill","bunge","agp","jennie","michael foods")):
        return "processor"
    return "coop"


# ═══════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════

def main():
    dry_run = "--dry-run" in sys.argv
    api_key = os.environ.get("BARCHART_API_KEY", "")
    ts = datetime.now(timezone.utc)

    print(f"AGSIST Cash Bid Scraper (Hybrid)")
    print(f"  {ts.strftime('%Y-%m-%d %H:%M UTC')}")
    print(f"  Phase 1: Farmbucks ({len(FARMBUCKS)} sources)")
    print(f"  Phase 2: Barchart ({'ENABLED — ' + str(len(BARCHART_ZIPS)) + ' zip codes' if api_key else 'DISABLED (no BARCHART_API_KEY)'})")
    print()

    if dry_run:
        print("Dry run — listing sources only.")
        for slug, st, name, _ in FARMBUCKS:
            print(f"  FB: {name} ({slug}/{st})" if st else f"  FB: {name} ({slug})")
        if api_key:
            for z in BARCHART_ZIPS:
                print(f"  BC: zip {z}")
        return

    all_elevators = {}  # "elevator|city|state" → {elevator data}
    all_locations = {}  # "city|state" → {lat, lng}

    # ── PHASE 1: FARMBUCKS ──────────────────────────────────────────
    print("─── Phase 1: Farmbucks ───")
    fb_ok, fb_fail, fb_bids = 0, 0, 0
    seen_sources = set()

    for i, (slug, state, name, etype) in enumerate(FARMBUCKS):
        sk = f"{slug}|{state or ''}"
        if sk in seen_sources:
            continue
        seen_sources.add(sk)

        label = f"{slug}/{state}" if state else slug
        print(f"  [{i+1:2d}] {label:35s}", end=" ", flush=True)

        url = f"https://farmbucks.com/grain-prices/{slug}"
        if state:
            url += f"/{state}"
        html = fetch_url(url)

        if not html:
            fb_fail += 1
            print("FAIL")
            time.sleep(2)
            continue

        bids = parse_farmbucks(html)
        locs = parse_farmbucks_locations(html)
        all_locations.update(locs)

        if not bids:
            fb_fail += 1
            print("0 bids")
            time.sleep(2)
            continue

        fb_ok += 1
        # Dedup + group
        for b in bids:
            ek = f"{name}|{b['city']}|{b['state']}"
            if ek not in all_elevators:
                lk = f"{b['city']}|{b['state']}"
                loc = all_locations.get(lk, {})
                all_elevators[ek] = {
                    "elevator": name, "city": b["city"], "state": b["state"],
                    "type": etype, "source": "farmbucks",
                    "lat": loc.get("lat"), "lng": loc.get("lng"),
                    "bids": {},
                }
            existing = all_elevators[ek]["bids"].get(b["commodity"])
            if not existing or b["cashPrice"] > existing["cashPrice"]:
                all_elevators[ek]["bids"][b["commodity"]] = {
                    "cashPrice": b["cashPrice"],
                    "delivery": b["delivery"],
                }
            fb_bids += 1

        loc_count = len(set(f"{b['city']}|{b['state']}" for b in bids))
        print(f"→ {len(bids)} bids, {loc_count} locations")
        time.sleep(2)

    fb_locations = len(all_elevators)
    print(f"\n  Farmbucks: {fb_ok} sources, {fb_locations} locations, {fb_bids} raw bids")

    # ── PHASE 2: BARCHART (if key provided) ─────────────────────────
    if api_key:
        print(f"\n─── Phase 2: Barchart ({len(BARCHART_ZIPS)} zip codes) ───")
        bc_new = 0
        bc_skip = 0

        # Track which city+state combos Farmbucks already covers
        covered = set()
        for e in all_elevators.values():
            covered.add(f"{e['city'].lower()}|{e['state']}")

        for i, zipcode in enumerate(BARCHART_ZIPS):
            print(f"  [{i+1:2d}] zip {zipcode}...", end=" ", flush=True)
            results = fetch_barchart_bids(api_key, zipcode)

            if not results:
                print("0")
                time.sleep(1)
                continue

            bids = parse_barchart_results(results)
            added = 0

            for b in bids:
                ck = f"{b['city'].lower()}|{b['state']}"

                # Skip if Farmbucks already has this city
                if ck in covered:
                    bc_skip += 1
                    continue

                ek = f"{b['elevator']}|{b['city']}|{b['state']}"
                if ek not in all_elevators:
                    all_elevators[ek] = {
                        "elevator": b["elevator"], "city": b["city"], "state": b["state"],
                        "type": b["type"], "source": "barchart",
                        "lat": b["lat"], "lng": b["lng"],
                        "bids": {},
                    }
                    added += 1

                existing = all_elevators[ek]["bids"].get(b["commodity"])
                if not existing or b["cashPrice"] > existing["cashPrice"]:
                    bid_data = {"cashPrice": b["cashPrice"], "delivery": b["delivery"]}
                    if b.get("basis") is not None:
                        bid_data["basis"] = b["basis"]
                    all_elevators[ek]["bids"][b["commodity"]] = bid_data

                covered.add(ck)

            bc_new += added
            print(f"→ {len(bids)} bids, {added} new locations")
            time.sleep(1)

        print(f"\n  Barchart: {bc_new} new locations added, {bc_skip} duplicates skipped")

    # ── OUTPUT ──────────────────────────────────────────────────────
    if not all_elevators:
        print("\n❌ No data scraped. bids.json NOT written.")
        sys.exit(1)

    # Count real bids
    total_bids = sum(len(e["bids"]) for e in all_elevators.values())

    output = {
        "generated": ts.isoformat(),
        "sources": ["farmbucks.com"] + (["barchart.com"] if api_key else []),
        "locationCount": len(all_elevators),
        "bidCount": total_bids,
        "elevators": sorted(all_elevators.values(),
                           key=lambda e: (e["state"], e["city"], e["elevator"])),
    }

    out_path = os.environ.get("OUTPUT_PATH", "bids.json")
    with open(out_path, "w") as f:
        json.dump(output, f, indent=2)

    # ── SUMMARY ─────────────────────────────────────────────────────
    wi = sum(1 for e in all_elevators.values() if e["state"] == "WI")
    mn = sum(1 for e in all_elevators.values() if e["state"] == "MN")
    fb_count = sum(1 for e in all_elevators.values() if e["source"] == "farmbucks")
    bc_count = sum(1 for e in all_elevators.values() if e["source"] == "barchart")

    by_com = {}
    for e in all_elevators.values():
        for c in e["bids"]:
            by_com[c] = by_com.get(c, 0) + 1

    print(f"\n{'═'*55}")
    print(f"  📍 Total locations: {len(all_elevators)}")
    print(f"     WI: {wi} | MN: {mn}")
    print(f"     Farmbucks: {fb_count} | Barchart: {bc_count}")
    print(f"  💰 Total bids: {total_bids}")
    for c in sorted(by_com):
        print(f"     {c}: {by_com[c]}")
    print(f"  📄 {out_path} ({os.path.getsize(out_path):,} bytes)")


if __name__ == "__main__":
    main()
