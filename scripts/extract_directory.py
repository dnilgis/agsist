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

THE SWEEP IS ONE CALL. MEASURED, 2026-08-27.

A grid was built for this -- 590 points from the continental ZIP centroids,
proved to put every US ZIP within 58 miles of a point -- and then the API made
it pointless. Probing Ames IA, Miami FL and Spokane WA, each at totalLocations
500 and 5000:

    every one returned 4,079 rows and the SAME 727 unique facilities

Neither `zipCode`, nor `maxDistance`, nor `totalLocations` changes the answer by
a single record. requestType=locations returns this key's entire entitlement
every time. So the sweep is one call, half a second, and there is no 728th
elevator to be had from Barchart at any price of cleverness.

That is worth knowing precisely because it is a ceiling, not a setting: the rest
of the country has to come from state licence registries and the platform
directories, and no amount of grid design here will substitute for that.

The grid file is kept because it is the thing that made the question answerable
and it costs nothing, but nothing reads it any more.

THE OLD GRID NOTE, KEPT FOR THE REASONING

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
# fetch_bids.py writes the Barchart rows ALONE here, before the network is merged
# in. See from_bids() for why that file exists.
RAW = ROOT / "barchart-raw.json"
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
    # Stamp every record, not just the file. Once these are merged with state
    # licence registries and platform directories, "where did this come from"
    # is a per-record question and the file header cannot answer it.
    out["source"] = "barchart"

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


def _norm_name(x):
    t = re.sub(r"[^a-z0-9]+", " ", str(x or "").lower()).replace("co op", "coop").split()
    legal = {"llc", "lc", "inc", "incorporated", "co", "corp", "corporation", "ltd", "company"}
    while t and t[-1] in legal:
        t.pop()
    return "".join("coop" if w in ("cooperative", "coops") else w for w in t)


def name_key(r):
    """Company + branch + town + state, spelling-tolerant. The second way to say
    'the same elevator', for when one record carries Barchart's ids and the
    other, read off a price pull, does not."""
    plain = lambda v: re.sub(r"[^a-z0-9]", "", str(v or "").lower())
    return "%s|%s|%s|%s" % (_norm_name(r.get("company") or r.get("facility")),
                            _norm_name(r.get("branch") or r.get("location")),
                            plain(r.get("city")), plain(r.get("state")))


def contaminated(r):
    """A record the AGSIST network wrote into the roster while wearing
    source=barchart.

    From 2026-09-23 fetch_bids.py merged the elevator network into
    bids-full.json, and from_bids() read that file and stamped every row
    "barchart". 964 of 970 rows with no branch matched a network place by
    operator, town and state; on 2026-09-22, before the merge, all 1,807 rows
    carried a branch. Barchart's own rows always have a branch, a location, an
    elevatorId or a locationId; ours never do."""
    if r.get("source") != "barchart":
        return False
    return not any(r.get(k) for k in ("branch", "location", "elevatorId", "locationId", "address"))


def union(prior, fresh):
    """The roster only ever grows. Barchart's answer changes from run to run
    (and drops a row whenever the network displaces it in the merge), and a
    directory rewritten from each run's answer forgot 289 elevators in three
    days. Fields from the fresh record win where they are non-empty; a prior
    record nothing has replaced is kept as it was."""
    by_id, by_name, out = {}, {}, []
    for r in prior:
        by_id[ident(r)] = r
        by_name.setdefault(name_key(r), r)
        out.append(r)
    for f in fresh:
        hit = by_id.get(ident(f))
        if hit is None:
            cand = by_name.get(name_key(f))
            # Two records that each carry a DIFFERENT Barchart id are two
            # yards, whatever their spelling says.
            fi, ci = ident(f), (ident(cand) if cand else None)
            both_ids = (f.get("elevatorId") or f.get("locationId")) and cand and \
                       (cand.get("elevatorId") or cand.get("locationId"))
            if cand is not None and not (both_ids and fi != ci):
                hit = cand
        if hit is not None:
            hit.update({k: v for k, v in f.items() if v not in (None, "")})
            by_id[ident(hit)] = hit
            by_id[ident(f)] = hit
            continue
        by_id[ident(f)] = f
        by_name.setdefault(name_key(f), f)
        out.append(f)
    return out


def prior_roster():
    """What is already in the file, minus anything that was never Barchart's."""
    try:
        rows = json.loads(OUT.read_text()).get("elevators") or []
    except (OSError, ValueError):
        return [], 0
    keep = [r for r in rows if isinstance(r, dict) and not contaminated(r)]
    dropped = len(rows) - len(keep)
    if len(rows) >= 100 and dropped > 0.25 * len(rows):
        # Never delete a quarter of the roster on a rule's say-so. Stop and
        # let a person look.
        raise SystemExit("refusing to drop %d of %d roster records as the network's; "
                         "check contaminated()" % (dropped, len(rows)))
    return keep, dropped


def from_bids():
    """No extra calls: squeeze what we can out of a price pull we already made.
    Fewer fields, because the price endpoint returns fewer by default.

    BARCHART'S ROWS ONLY. bids-full.json is the merged feed, and since
    2026-09-23 it carries the AGSIST network too; reading it as-is put our own
    places into the roster of what Barchart sells, which is the list the
    cancellation is measured against. fetch_bids.py now writes
    barchart-raw.json before the merge, and that is read first. Failing that,
    rows stamped source=network are skipped."""
    src = RAW if RAW.exists() else (FULL if FULL.exists() else SLIM)
    if not src.exists():
        return None, [], 0
    d = json.loads(src.read_text())
    rows = d if isinstance(d, list) else (d.get("bids") or d.get("rows") or [])
    fac = {}
    for r in rows:
        if isinstance(r, dict) and r.get("source") != "network" and r.get("city") and r.get("state"):
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
        # TWO QUESTIONS, ONE RUN, BECAUSE THEY LOOK THE SAME FROM OUTSIDE.
        #
        # Measured 2026-08-27: one grid point and five grid points returned
        # BYTE-IDENTICAL sets of 727 facilities, and all five were on the
        # Canadian border while the results spanned 37 states at a median 616
        # miles away. So zipCode is not selecting anything, and maxDistance is
        # not either. That leaves two possibilities and they are worth telling
        # apart before anyone designs another grid:
        #
        #   A. totalLocations is the binding constraint, and a bigger number
        #      returns more of the country.
        #   B. 727 is simply every elevator this key is entitled to, and no
        #      parameter will ever return a 728th.
        #
        # If far-apart ZIPs give the same set, geography is irrelevant. If a
        # much larger cap gives the same count, the cap is irrelevant too — and
        # then B is the answer, which means the rest of the country has to come
        # from somewhere that is not Barchart.
        probes = [("50010", "Ames, IA"), ("33101", "Miami, FL"), ("99201", "Spokane, WA")]
        sets = {}
        for z, label in probes:
            for cap in (a.total_locations, max(a.total_locations * 10, 5000)):
                t0 = time.time()
                try:
                    res = ask(z, key, a.max_distance, cap, max(a.timeout, 120))
                except Exception as ex:
                    print("   %-6s cap %-6d FAILED %s: %s"
                          % (z, cap, type(ex).__name__, str(ex)[:110]))
                    continue
                ids = {ident(r) for r in res}
                sets[(z, cap)] = ids
                print("   %-6s %-13s cap %-6d -> %5d rows, %5d unique, %4.1fs"
                      % (z, label, cap, len(res), len(ids), time.time() - t0))
                time.sleep(1)

        if len(sets) >= 2:
            keys = list(sets)
            base = sets[keys[0]]
            same_everywhere = all(sets[k] == base for k in keys)
            print("\n   every probe returned the SAME set: %s" % same_everywhere)
            biggest = max(len(v) for v in sets.values())
            union_all = set().union(*sets.values())
            print("   largest single answer: %d   union of all probes: %d" % (biggest, len(union_all)))
            if same_everywhere:
                print("\n   ==> Neither the ZIP nor the cap changes the answer. %d is what this\n"
                      "       key is entitled to, and no sweep design will get a %dth. Everything\n"
                      "       beyond it has to come from state licence registries and the platform\n"
                      "       directories, not from Barchart." % (len(base), len(base) + 1))
            else:
                print("\n   ==> The answer DOES vary, so a sweep is worth designing. Use the\n"
                      "       largest cap that still returns, and enough points to cover the union.")
        return 0

    facilities, saturated, failed, source, rows_read = {}, [], [], None, 0

    if a.from_bids or not key:
        if not key and not a.from_bids:
            print("no BARCHART_API_KEY — falling back to the price pull on disk")
        source, got, rows_read = from_bids()
        prior, dropped = prior_roster()
        for f in union(prior, got):
            facilities[ident(f)] = f
        if dropped:
            print("dropped %d records that were the AGSIST network's, not Barchart's" % dropped)
        print("kept %d prior records, %d read from this pull -> %d" % (len(prior), len(got), len(facilities)))
        complete = False
    else:
        # ONE POINT, BECAUSE THE ANSWER IS THE SAME FROM ANY OF THEM. Kept as a
        # list so --limit and --start still work if a future plan ever does
        # respond to geography; measured today, they change nothing.
        grid = json.loads(GRID.read_text()) if GRID.exists() else [{"zip": "50010", "label": "Ames, IA"}]
        pts = grid[a.start:a.start + 1] if not a.limit else grid[a.start:a.start + a.limit]
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
            # Saturation is measured but no longer means what it used to: the
            # cap is ignored, so a full-looking page is not evidence of
            # truncation. Kept as a tripwire in case a plan change ever makes
            # totalLocations bind again.
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
        # COMPLETE MEANS "everything this key will give", which is now a
        # question about the call succeeding, not about grid coverage.
        complete = bool(facilities) and not failed
        # A live key that returns nothing (subscription lapsed, key still set)
        # must not overwrite the roster with an empty one. Union with what we
        # have, and refuse to write if the answer is thin.
        prior, dropped = prior_roster()
        if len(facilities) < 0.5 * len(prior):
            print("ERROR: Barchart returned %d facilities against %d on file; "
                  "not overwriting the roster." % (len(facilities), len(prior)))
            return 1
        merged = {}
        for f in union(prior, list(facilities.values())):
            merged[ident(f)] = f
        facilities = merged
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


def selftest():
    fails = []

    def ck(name, cond):
        print("  %s   %s" % ("ok" if cond else "FAIL", name))
        if not cond:
            fails.append(name)

    barchart = {"facility": "Kanza Co-op", "branch": "Iuka", "city": "Iuka", "state": "KS",
                "zip": "67066", "phone": "620-555-0101", "source": "barchart"}
    ours = {"facility": "Kanza Cooperative", "city": "Iuka", "state": "KS", "zip": "67066",
            "lat": 37.7, "source": "barchart"}      # what the old step wrote for a network place
    harvest = {"company": "Kanza Co-op", "location": "Iuka", "city": "Iuka", "state": "KS",
               "address": "1 Main St", "lat": 37.71, "lng": -98.7, "elevatorId": 7,
               "locationId": 70, "phone": "620-555-0101"}
    ck("a record with a branch is Barchart's", not contaminated(barchart))
    ck("a record with an elevatorId is Barchart's", not contaminated(harvest))
    ck("a record with none of them was written by the network", contaminated(ours))
    ck("a record that never claimed Barchart is not called contaminated",
       not contaminated({"facility": "X", "source": "registry"}))
    ck("Co-op and Cooperative are one name", name_key(barchart) == name_key(harvest))

    got = union([harvest], [tidy(dict(barchart, company="Kanza Co-op"))])
    ck("a harvested record and a price-pull record of the same elevator become one", len(got) == 1)
    ck("the harvest's address survives the merge", got[0].get("address") == "1 Main St")
    ck("the harvest's ids survive the merge", got[0].get("elevatorId") == 7)
    ck("fresh fields win where they are present", got[0].get("phone") == "620-555-0101")

    other = {"facility": "Central Valley Ag", "branch": "York", "city": "York", "state": "NE",
             "source": "barchart"}
    kept = union([tidy(other)], [])
    ck("a prior record no run replaced is kept: the roster only grows", len(kept) == 1)

    two = union([tidy(other)], [tidy(dict(other, branch="Waco", city="Waco"))])
    ck("two branches of one company are two records", len(two) == 2)

    # from_bids() end to end against a scratch directory
    import tempfile, shutil
    g = globals()
    keep = {k: g[k] for k in ("RAW", "FULL", "SLIM", "OUT")}
    d = Path(tempfile.mkdtemp())
    try:
        g["RAW"], g["FULL"], g["SLIM"], g["OUT"] = d / "raw.json", d / "full.json", d / "slim.json", d / "dir.json"
        rows = [dict(barchart), dict(ours, source="network"),
                {"facility": "Ours Only", "city": "Ames", "state": "IA", "source": "network"}]
        g["FULL"].write_text(json.dumps({"bids": rows}))
        name, fac, n = from_bids()
        ck("no raw file: network rows in the merged file are skipped",
           name == "full.json" and len(fac) == 1 and fac[0]["facility"] == "Kanza Co-op")
        g["RAW"].write_text(json.dumps({"bids": [dict(barchart)]}))
        name, fac, n = from_bids()
        ck("the raw Barchart file is read first", name == "raw.json" and len(fac) == 1)
        g["OUT"].write_text(json.dumps({"elevators": [tidy(ours), tidy(harvest)]}))
        prior, dropped = prior_roster()
        ck("the prior file loses only the network's records", len(prior) == 1 and dropped == 1)

        # main() ITSELF, the way the workflow runs it. 2026-09-26: every helper
        # passed its tests and main() crashed on the runner, because a probe
        # branch assigned a local named `union` and shadowed the function for
        # the whole of main(). Calling helpers never touches that.
        import io, contextlib
        g["RAW"].write_text(json.dumps({"bids": [dict(barchart)]}))
        g["OUT"].write_text(json.dumps({"elevators": [tidy(ours), tidy(harvest)]}))
        argv0 = sys.argv
        sys.argv = ["extract_directory.py", "--from-bids"]
        buf = io.StringIO()
        try:
            with contextlib.redirect_stdout(buf):
                rc = main()
        except Exception as ex:
            rc = "raised %s: %s" % (type(ex).__name__, ex)
        finally:
            sys.argv = argv0
        after = json.loads(g["OUT"].read_text()).get("elevators", [])
        ck("main --from-bids runs to the end", rc == 0)
        ck("main --from-bids writes the roster with no network records in it",
           len(after) >= 1 and not any(contaminated(r) for r in after) and not any((r.get("facility") or "") == "Ours Only" for r in after))
    finally:
        for k, v in keep.items():
            g[k] = v
        shutil.rmtree(d, ignore_errors=True)

    # two yards of one company in one town, each with its own Barchart id
    a = {"company": "AGP", "city": "Manning", "state": "IA", "elevatorId": 1, "branch": "Manning"}
    b = {"company": "AGP", "city": "Manning", "state": "IA", "elevatorId": 2, "branch": "Manning"}
    ck("two different Barchart ids stay two records", len(union([dict(a)], [dict(b)])) == 2)
    # a record that gains an id by name match is findable by that id afterwards
    old = {"company": "Kanza Co-op", "city": "Iuka", "state": "KS", "branch": "Iuka", "source": "barchart"}
    new1 = {"company": "Kanza Co-op", "city": "Iuka", "state": "KS", "branch": "Iuka", "elevatorId": 7}
    new2 = {"company": "Kanza Co-op", "city": "Iuka", "state": "KS", "branch": "Iuka", "elevatorId": 7, "phone": "1"}
    ck("a later row with a learned id does not duplicate", len(union([old], [new1, new2])) == 1)
    print()
    if fails:
        print("%d FAILED" % len(fails))
        return 1
    print("all extract_directory checks pass")
    return 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    sys.exit(main())
