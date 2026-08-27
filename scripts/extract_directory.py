#!/usr/bin/env python3
"""
extract_directory.py — take the whole national elevator directory off Barchart
while we still have a key, and keep the elevators without the prices.

WHY

Sig, 2026-08-27: "i have a feeling that i wont be continuing my barchart api
subscription when it comes up for renewal ... i want a complete directory of
every elevator in the country and their basis and data whenever possible,
whoever we cant get, i want a list of them" and then "yeah get all the barchart
elevators info, addreseess, etc."

The prices are licensed and they stop at renewal. That a company operates a
facility at a street address in a town is a fact about the world, it is the
target list for every adapter still to be written, and once written down it
does not expire. So this walks the country and writes the who and the where,
and nothing else: no cash price, no basis, no futures symbol, no delivery
window. Nothing that is theirs to sell.

WHAT WE HAD BEEN ASKING FOR, AND WHAT IS ACTUALLY THERE

fetch_bids.py sends zipCode, maxDistance and getAllBids, and takes whatever
comes back by default: facility, branch, city, state, zip, phone. The published
getGrainBids reference lists far more on the location half of the response --

    address, city, state, zip, county, county_code, fips_code, crop_district,
    lat, lng, phone, url, company, facility_type, locationId, elevatorId

-- behind a `fields` parameter nobody had ever sent. `lat` and `lng` mean these
elevators do not need geocoding at all, `address` means the ones we scrape can
stop being town centroids, and `url` is the elevator's own site, which is the
first thing an adapter needs.

There is also a `requestType=locations` mode that returns the directory without
the bids. That is what this uses: it is the cheap question, and it is the only
question we are entitled to keep the answer to.

THE GRID, AND WHY IT IS 590 POINTS

fetch_bids.py sweeps 50 hand-picked ZIPs at 60 miles, which is a sample of the
country, not the country -- on 2026-08-27 it saw 407 facilities and the slim
committed extract of it yielded 41. data/zip-grid.json is generated from the
41,291 continental ZIP centroids on a 1.10 by 1.45 degree lattice, taking the
real ZIP nearest each lattice point. Measured against 6,000 randomly sampled
ZIPs, the furthest any of them sits from its nearest grid point is 58 miles, so
maxDistance 75 covers the continental United States with overlap to spare.

SATURATION IS REPORTED, NOT HIDDEN. A point that returns exactly
totalLocations has almost certainly been truncated, and the fix is a denser
grid there rather than a bigger number. fetch_bids.py's own comment records
this trap: it sent no totalLocations at all for months, took Barchart's default
of 30, and logged kept BIDS rather than locations -- so a saturated ZIP looked
exactly like an empty one, and "this elevator is absent from Barchart" was an
unsafe claim for as long as that lasted.
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FULL = ROOT / "bids-full.json"
SLIM = ROOT / "data" / "bids.json"
GRID = ROOT / "data" / "zip-grid.json"
OUT = ROOT / "data" / "elevator-directory.json"

# Overridable ONLY so the sweep can be exercised against a stand-in that
# speaks the documented response shape. The real endpoint is unreachable from
# a sandbox and the key is a repository secret, so without this the parsing,
# the dedup, the saturation detection and the null-island guard would all ship
# having never once been run.
BASE = (os.environ.get("BARCHART_BASE") or "").strip() or \
       "https://ondemand.websol.barchart.com/getGrainBids.json"
UA = "AGSIST/1.0 (+https://agsist.com; sig@farmers1st.com)"

# Every location field the reference documents. Asking for one that a plan does
# not carry costs nothing -- it simply does not come back -- and the run prints
# which ones actually arrived, so this list never has to be believed.
FIELDS = ("address,city,state,zip,county,county_code,fips_code,crop_district,"
          "lat,lng,phone,url,company,facility_type,locationId,elevatorId,distance")

# Directory only. Anything not in here is price data and is left behind.
KEEP = ("company", "facility", "branch", "location", "address", "city", "state", "zip",
        "county", "county_code", "fips_code", "crop_district", "lat", "lng",
        "phone", "url", "facility_type", "locationId", "elevatorId")


def ident(r):
    """One physical elevator. Barchart's own ids first; a name-and-town tuple
    only as a fallback, because company name alone is never an identity --
    'CHS' is two hundred businesses and 'Council Bluffs' is two companies'
    yards."""
    for k in ("elevatorId", "locationId"):
        v = r.get(k)
        if v not in (None, "", 0):
            return "%s:%s" % (k, v)
    return "n:%s|%s|%s|%s" % ((r.get("company") or r.get("facility") or "").strip().lower(),
                              (r.get("branch") or r.get("location") or "").strip().lower(),
                              (r.get("city") or "").strip().lower(),
                              (r.get("state") or "").strip().upper())


US_STATES = set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN "
                "MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV "
                "WI WY PR".split())
CITY_ST = re.compile(r"^(.*?),\s*([A-Za-z]{2})\s*$")


def tidy(r):
    out = {}
    for k in KEEP:
        v = r.get(k)
        if v in (None, ""):
            continue
        if k in ("lat", "lng"):
            try:
                v = round(float(v), 6)
            except (TypeError, ValueError):
                continue
            if abs(v) < 0.001:          # null island, same trap as the ZIP tables
                continue
        out[k] = v
    if out.get("zip"):
        out["zip"] = str(out["zip"])[:5]

    # THE STATE IS SOMETIMES INSIDE THE CITY. Measured on the first live run:
    # 725 of 727 records carried `state`, and of the two that did not, one had
    # city "Golden City, MO". Two records is nothing until you remember that
    # the state is what every downstream guard keys on -- the map's
    # in-state check, the per-state counts, the licence-registry join -- so a
    # record without one is a record that quietly cannot be placed.
    m = CITY_ST.match(str(out.get("city") or ""))
    if m:
        out["city"] = m.group(1).strip()
        out.setdefault("state", m.group(2).upper())
    if out.get("state"):
        out["state"] = str(out["state"]).strip().upper()
        # Barchart carries Canadian elevators too: 29 of the first 727, in ON,
        # MB, SK, AB and QC. They are real and worth keeping; they are simply
        # not part of a map of the United States, so they are labelled rather
        # than dropped.
        if out["state"] not in US_STATES:
            out["country"] = "CA"
    return out


def ask(zip_code, key, max_distance, total, timeout):
    q = urllib.parse.urlencode({
        "apikey": key, "zipCode": zip_code, "maxDistance": max_distance,
        "requestType": "locations", "totalLocations": total, "fields": FIELDS,
    })
    req = urllib.request.Request(BASE + "?" + q, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        d = json.loads(r.read().decode())
    if str(d.get("status", {}).get("code", 200)) not in ("200", "0"):
        raise RuntimeError("barchart said: %s" % json.dumps(d.get("status"))[:160])
    res = d.get("results") or []
    return res if isinstance(res, list) else []


def from_bids():
    """No extra calls: squeeze what we can out of a price pull we already made.
    Fewer fields, because the price endpoint returns fewer by default."""
    src = FULL if FULL.exists() else SLIM
    if not src.exists():
        return None, [], 0
    d = json.loads(src.read_text())
    rows = d if isinstance(d, list) else (d.get("bids") or d.get("rows") or [])
    fac = {}
    for r in rows:
        if isinstance(r, dict) and r.get("city") and r.get("state"):
            fac.setdefault(ident(r), {}).update({k: v for k, v in tidy(r).items() if v})
    return src.name, list(fac.values()), len(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from-bids", action="store_true",
                    help="derive from a price pull already on disk; make no API calls")
    ap.add_argument("--max-distance", type=int, default=75)
    ap.add_argument("--total-locations", type=int, default=500)
    ap.add_argument("--start", type=int, default=0, help="skip this many grid points (resume)")
    ap.add_argument("--limit", type=int, default=0, help="ask at most this many (0 = all)")
    ap.add_argument("--minutes", type=float, default=0, help="stop cleanly after this long")
    ap.add_argument("--pause", type=float, default=0.4)
    ap.add_argument("--probe-cap", action="store_true",
                    help="ask ONE point at rising totalLocations and report where it stops "
                         "growing. Measures the real ceiling instead of guessing at it.")
    ap.add_argument("--timeout", type=int, default=30)
    a = ap.parse_args()

    key = (os.environ.get("BARCHART_API_KEY") or "").strip()

    if a.probe_cap:
        # MEASURE THE CEILING, DO NOT ASSUME IT.
        # The first live run showed maxDistance is IGNORED by
        # requestType=locations: five points on the Canadian border returned
        # facilities in 37 states, median 616 miles away and up to 1,364, with
        # only 2% inside the 75 miles asked for. So this is a nearest-N query,
        # not a radius query, and the only thing that decides how much of the
        # country one call returns is totalLocations. Everything about how many
        # grid points are needed follows from where that number stops working.
        grid = json.loads(GRID.read_text())
        g = grid[a.start] if a.start < len(grid) else grid[0]
        print("probing %s (%s) at rising caps; maxDistance %d is sent but appears to be ignored"
              % (g["zip"], g["label"], a.max_distance))
        prev = None
        for cap in (100, 500, 1000, 2500, 5000, 10000):
            t0 = time.time()
            try:
                res = ask(g["zip"], key, a.max_distance, cap, max(a.timeout, 90))
            except Exception as ex:
                print("   %6d -> FAILED %s: %s" % (cap, type(ex).__name__, str(ex)[:120]))
                break
            uniq = len({ident(r) for r in res})
            print("   %6d -> %5d rows, %5d unique facilities, %4.1fs%s"
                  % (cap, len(res), uniq, time.time() - t0,
                     "  <-- stopped growing" if prev is not None and uniq <= prev else ""))
            if prev is not None and uniq <= prev:
                break
            prev = uniq
            time.sleep(1)
        print("\nWhatever the last growing number was, that is the real cap. If it is large "
              "enough, the country needs a handful of calls rather than 590.")
        return 0
    facilities, saturated, failed, source, rows_read = {}, [], [], None, 0

    if a.from_bids or not key:
        if not key and not a.from_bids:
            print("no BARCHART_API_KEY — falling back to the price pull on disk")
        source, got, rows_read = from_bids()
        for f in got:
            facilities[ident(f)] = f
        complete = False
    else:
        grid = json.loads(GRID.read_text())
        pts = grid[a.start:]
        if a.limit:
            pts = pts[:a.limit]
        deadline = time.time() + a.minutes * 60 if a.minutes else None
        seen_fields, done = set(), 0
        print("sweeping %d of %d grid points, %d mile radius, up to %d locations each"
              % (len(pts), len(grid), a.max_distance, a.total_locations))
        for i, g in enumerate(pts):
            if deadline and time.time() > deadline:
                print("time box reached after %d points — resume with --start %d"
                      % (done, a.start + done))
                break
            try:
                res = ask(g["zip"], key, a.max_distance, a.total_locations, a.timeout)
            except Exception as ex:
                failed.append((g["zip"], "%s: %s" % (type(ex).__name__, str(ex)[:90])))
                continue
            done += 1
            if len(res) >= a.total_locations:
                saturated.append(g["zip"])
            for r in res:
                seen_fields.update(k for k, v in r.items() if v not in (None, ""))
                facilities[ident(r)] = tidy(r)
            if done % 25 == 0:
                print("  %4d/%d  %-6s %-22s  %5d facilities so far"
                      % (done, len(pts), g["zip"], g["label"][:22], len(facilities)))
            time.sleep(a.pause)
        source = "getGrainBids requestType=locations"
        complete = not saturated and not failed and a.start == 0 and not a.limit
        print("\nfields Barchart actually returned: %s" % ", ".join(sorted(seen_fields)))
        for want in ("address", "lat", "lng", "url", "phone", "elevatorId"):
            print("   %-11s %s" % (want, "yes" if want in seen_fields else "NOT RETURNED"))

    out = sorted(facilities.values(),
                 key=lambda e: ((e.get("state") or ""), (e.get("company") or e.get("facility") or ""),
                                (e.get("city") or "")))
    have = lambda k: sum(1 for e in out if e.get(k))
    counts = {"facilities": len(out), "states": len({e.get("state") for e in out if e.get("state")}),
              "with_address": have("address"), "with_coords": sum(1 for e in out if e.get("lat") and e.get("lng")),
              "with_url": have("url"), "with_phone": have("phone"),
              "saturated_zips": len(saturated), "failed_zips": len(failed), "rows_read": rows_read}

    OUT.write_text(json.dumps({
        "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "from": source, "complete": complete,
        "note": ("Directory only: who operates a facility and where. No prices, no basis, "
                 "no symbols, no delivery windows."),
        "counts": counts,
        "saturated": saturated,
        "failed": [{"zip": z, "why": w} for z, w in failed],
        "elevators": out,
    }, indent=1) + "\n")

    print("\n%d facilities in %d states" % (counts["facilities"], counts["states"]))
    for k in ("with_address", "with_coords", "with_url", "with_phone"):
        print("   %-13s %5d" % (k, counts[k]))
    if saturated:
        print("   %d ZIPs returned a full page — densify the grid there rather than "
              "raising the cap: %s" % (len(saturated), ", ".join(saturated[:12])))
    if failed:
        print("   %d ZIPs failed: %s" % (len(failed), ", ".join(z for z, _ in failed[:12])))
    if not complete:
        print("   NOT a complete national picture — see 'complete': false in the file.")
    print("wrote %s" % OUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
