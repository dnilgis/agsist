#!/usr/bin/env python3
"""Join report (god's-eye panel, build 2, Oct 27 2026): how well each data set joins the county spine
and the elevator ids, per data set, in counts. Fails when a rate falls below its recorded floor.

Every county file is joined on the spine (data/atlas/counties.geo.json, 3,141 counties) through the
shared code table data/ids/geo-crosswalk.json (scripts/build_geo_crosswalk.py). For each data set:

  keys      county codes (or places, or points) the data set holds
  direct    keys that are spine counties as written
  folded    keys that land on a spine county through the crosswalk (rename, part, office, merger, split)
  lossy     the folded keys whose kind is part, office or split: they land on a county, but their
            numbers are a piece of it (or cover two), so they cannot stand in for the county's own row
  outside   keys outside the 50 states and DC (Puerto Rico): no spine county exists for them
  missed    everything else (Connecticut's planning regions, a code nobody knows, a point in no county)
  rate      (direct + folded) / (keys - outside)
  cover     spine counties the data set reaches after folding, for the sets meant to cover them all

Points (land sales, cattle barns, elevators) join by point in polygon (build_ids.Counties), own state's
counties only, never by a town name. Elevator joins read data/ids/elevators.json as built.

FLOORS below were recorded from the real run on Oct 27 2026 (each floor is that run's rate, rounded
down; the bids-fed rows sit a little lower because data/bids.json changes every pass). Lowering a
floor is a decision: change the number here in the same commit and say why. Raise one when a fix
lands. Counts only: this prints no name, no address, no sale party.

Usage: python3 scripts/join_report.py            print the report; exit 1 when any rate is below its floor
       python3 scripts/join_report.py --json     the same as JSON
       python3 scripts/join_report.py --selftest
"""
import glob
import json
import os
import re
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

LOSSY = {"part", "office", "split"}
OUTSIDE = ("72", "78", "60", "66", "69")   # Puerto Rico, Virgin Islands, the Pacific territories
# DC (11001) has no spine county either; any code whose state the spine does not hold is "outside"

# name: (rate floor, cover floor or None). Recorded Oct 27 2026 from the run on origin/main 8aef23b.
# The federal county files change a few times a year, so their floors are that run's rate, rounded down.
# Land sales refresh monthly and bids every pass, so those carry a little room below the run.
FLOORS = {
    "arc-plc counties":        (1.0, None),       # 2,772 of 2,772 (11 FSA office codes folded, 8 lossy)
    "fsa payments counties":   (1.0, None),       # 1,139 of 1,139; 9 Puerto Rico outside
    "drought counties":        (0.9971, 0.9974),  # 3,134 of 3,143 (9 CT regions missed); cover 3,133 of 3,141
    "rma planting dates":      (0.9961, None),    # 2,311 of 2,320 (9 CT regions missed)
    "census tenure":           (1.0, None),       # 3,029 of 3,029 (02010 split onto two counties)
    "cash rent counties":      (1.0, None),       # 2,934 of 2,934
    "rain counties":           (1.0, 0.8554),     # 2,687 of 2,687; cover 2,687 of 3,141
    "prf grid counties":       (1.0, None),       # 3,090 of 3,090; DC outside
    "land sale counties":      (1.0, None),       # 266 of 266
    "land sale points IL":     (0.99, None),      # 486 of 486 (township points)
    "land sale points IN":     (0.85, None),      # 484 of 544: postal-town ZIP centroids, 60 across the line
    "land sale points WI":     (0.99, None),      # 406 of 408
    "cattle barn points":      (0.97, None),      # 88 of 88
    "elevator points":         (0.98, None),      # 3,382 of 3,414 with a point
    # Raised Oct 27 (fx/bidkeys): build_ids now runs on every bids pass and retires folded ids, and every
    # network row carries its board's elevId. Real run: 248 of 248 places by key, 248 of 248 by elevId
    # (was 199 of 251, 79.3%, on an elevators.json from Oct 18). Room below 1.0 for a pass whose ids
    # step fails soft and leaves the last elevators.json in place.
    "bids places to ids":      (0.95, None),      # 248 of 248
    "bids places carry elevId": (0.95, None),     # 248 of 248; the feed's own board id, found in elevators.json
    "basis keys to ids":       (0.998, None),     # 3,556 of 3,559
}


# ------------------------------------------------------------------ helpers
def read(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def files(root, pattern, rx):
    return [p for p in sorted(glob.glob(os.path.join(root, pattern))) if re.match(rx, os.path.basename(p))]


class Spine:
    def __init__(self, root):
        self.codes = {str(ft["id"]) for ft in read(os.path.join(root, "data", "atlas", "counties.geo.json"))["features"]}
        xw = read(os.path.join(root, "data", "ids", "geo-crosswalk.json"))
        self.table = xw.get("codes") or {}
        self.states = {c[:2] for c in self.codes}

    def fold(self, code):
        """-> (spine codes, how): how is 'direct', a crosswalk kind, 'outside' or 'missed'."""
        code = str(code or "").strip()
        if code in self.codes:
            return [code], "direct"
        row = self.table.get(code)
        if row is not None:
            to = [t for t in (row.get("to") or []) if t in self.codes]
            return (to, row["kind"]) if to else ([], "missed")
        if code[:2] in OUTSIDE or code[:2] not in self.states:
            return [], "outside"
        return [], "missed"


def tally(name, keys, spine, cover_of=None):
    r = dict(name=name, keys=0, direct=0, folded=0, lossy=0, outside=0, missed=0)
    reached = set()
    for k in keys:
        r["keys"] += 1
        to, how = spine.fold(k)
        if how == "direct":
            r["direct"] += 1
        elif how in ("outside", "missed"):
            r[how] += 1
        else:
            r["folded"] += 1
            r["lossy"] += how in LOSSY
        reached.update(to)
    if cover_of:
        r["cover"] = [len(reached & cover_of), len(cover_of)]
    return r


def point_tally(name, rows, counties):
    """rows: (lat, lng, st, filed fips or None). matched = the point is in a county of its state
    (and, when a filed county is given, in that county)."""
    r = dict(name=name, keys=0, direct=0, folded=0, lossy=0, outside=0, missed=0, no_point=0)
    for lat, lng, st, filed in rows:
        if lat is None or lng is None:
            r["no_point"] += 1
            continue
        r["keys"] += 1
        got = counties.fips(lat, lng, st)
        if got and (filed is None or got == filed):
            r["direct"] += 1
        else:
            r["missed"] += 1
    return r


def share(direct, folded, keys, outside):
    n = keys - outside
    return (direct + folded) / n if n else 1.0


# ------------------------------------------------------------------ data sets
def county_sets(root, spine):
    out = []
    ks = [c.get("f") for p in files(root, "data/arc-plc/*.json", r"^[A-Z]{2}\.json$") for c in read(p).get("c") or []]
    out.append(tally("arc-plc counties", ks, spine))
    p = os.path.join(root, "data", "payments", "county.json")
    out.append(tally("fsa payments counties", list((read(p).get("counties") or {}).keys()) if os.path.exists(p) else [], spine))
    p = os.path.join(root, "data", "drought", "county-week.json")
    d = read(p) if os.path.exists(p) else {}
    out.append(tally("drought counties", list((d.get("c") or {}).keys()) + list(d.get("zero") or []), spine, spine.codes))
    p = os.path.join(root, "data", "rma-planting-dates.json")
    out.append(tally("rma planting dates", list((read(p).get("counties") or {}).keys()) if os.path.exists(p) else [], spine))
    p = os.path.join(root, "data", "tenure", "tenure.json")
    out.append(tally("census tenure", list((read(p).get("counties") or {}).keys()) if os.path.exists(p) else [], spine))
    ks = [c.get("fips") for p in files(root, "data/cash-rent/*.json", r"^[A-Z]{2}\.json$") for c in read(p).get("counties") or []]
    out.append(tally("cash rent counties", ks, spine))
    ks = [k for p in files(root, "data/rain/*.json", r"^[a-z]{2}\.json$") for k in (read(p).get("counties") or {})]
    out.append(tally("rain counties", ks, spine, spine.codes))
    ks = sorted({c for p in files(root, "data/prf/c/*.json", r"^[\d_]+\.json$")
                 for g in (read(p).get("g") or {}).values() for c in (g.get("c") or [])})
    out.append(tally("prf grid counties", ks, spine))
    ks = [k for p in files(root, "data/land-sales/*.json", r"^[a-z]{2}\.json$") for k in (read(p).get("counties") or {})]
    out.append(tally("land sale counties", ks, spine))
    return out


def point_sets(root, counties):
    out = []
    for p in files(root, "data/land-sales/*.json", r"^[a-z]{2}\.json$"):
        rows = []
        d = read(p)
        cols = d.get("cols") or []
        if "lat" not in cols or "lng" not in cols:
            continue
        ia, io = cols.index("lat"), cols.index("lng")
        st = (d.get("state") or os.path.basename(p)[:2]).upper()
        for fips, c in (d.get("counties") or {}).items():
            for s in c.get("s") or []:
                rows.append((s[ia] if len(s) > ia else None, s[io] if len(s) > io else None, st, fips))
        # one row per state: each state places its sales its own way (IL and WI by township,
        # IN at the postal town's ZIP centroid, which can sit across the county line)
        out.append(point_tally("land sale points " + st, rows, counties))
    p = os.path.join(root, "data", "cattle-auction.json")
    barns = read(p).get("barns") or [] if os.path.exists(p) else []
    out.append(point_tally("cattle barn points", [(b.get("lat"), b.get("lon"), b.get("state"), None) for b in barns], counties))
    return out


def id_sets(root, spine):
    from build_ids import place_str
    out = []
    doc = read(os.path.join(root, "data", "ids", "elevators.json"))
    el = doc.get("elevators") or []
    # elevator points: the file keeps the county build_ids found for each point (no point, no county),
    # so the denominator is the file's own count of facilities with a point
    c = doc.get("counts") or {}
    with_pt = c.get("with_point") or 0
    on_spine = sum(1 for e in el if e.get("fips") in spine.codes)
    out.append(dict(name="elevator points", keys=with_pt, direct=on_spine, folded=0, lossy=0, outside=0,
                    missed=max(0, with_pt - on_spine), no_point=(c.get("facilities") or len(el)) - with_pt))
    bids_keys = {k for e in el for k in ((e.get("sources") or {}).get("bids") or [])}
    basis_keys = {k for e in el for k in ((e.get("sources") or {}).get("basis") or [])}
    p = os.path.join(root, "data", "bids.json")
    places = sorted({place_str(b.get("facility"), b.get("branch"), b.get("city"), (b.get("state") or "").upper())
                     for b in (read(p).get("bids") or [])}) if os.path.exists(p) else []
    hit = sum(1 for x in places if x in bids_keys)
    out.append(dict(name="bids places to ids", keys=len(places), direct=hit, folded=0, lossy=0, outside=0, missed=len(places) - hit))
    # the board id the bids feed gives each network row (fetch_bids.board_keys), followed through the ledger's
    # retirements, must be a record in elevators.json: an id, not a spelling
    ids = {e.get("id") for e in el}
    led_p = os.path.join(root, "data", "ids", "elevator-ids.json")
    retired = (read(led_p).get("retired") or {}) if os.path.exists(led_p) else {}

    def live_id(e):
        seen = set()
        while e in retired and e not in seen:
            seen.add(e)
            e = retired[e].get("into")
        return e
    by_place = {}
    for b in (read(p).get("bids") or []) if os.path.exists(p) else []:
        k = place_str(b.get("facility"), b.get("branch"), b.get("city"), (b.get("state") or "").upper())
        by_place.setdefault(k, set())
        if b.get("elevId"):
            by_place[k].add(live_id(b["elevId"]))
    hit = sum(1 for v in by_place.values() if v & ids)
    out.append(dict(name="bids places carry elevId", keys=len(by_place), direct=hit, folded=0, lossy=0, outside=0,
                    missed=len(by_place) - hit))
    keys = []
    for p in files(root, "data/basis/*.json", r"^([A-Z]{2}|\?\?)\.json$"):
        d = read(p)
        st = d.get("state") or os.path.basename(p)[:2]
        keys += [f"{st}|{fk}" for fk in d.get("f") or []]
    hit = sum(1 for k in keys if k in basis_keys)
    out.append(dict(name="basis keys to ids", keys=len(keys), direct=hit, folded=0, lossy=0, outside=0, missed=len(keys) - hit))
    return out


def report(root):
    from build_ids import Counties
    spine = Spine(root)
    counties = Counties(os.path.join(root, "data", "atlas", "counties.geo.json"))
    rows = county_sets(root, spine) + point_sets(root, counties) + id_sets(root, spine)
    fails = []
    for r in rows:
        r["rate"] = round(share(r["direct"], r["folded"], r["keys"], r["outside"]), 4)
        fl = FLOORS.get(r["name"])
        r["floor"] = fl[0] if fl else None
        bad = []
        if fl and r["keys"] and r["rate"] < fl[0]:
            bad.append(f"rate {r['rate']:.4f} < floor {fl[0]}")
        if fl and fl[1] is not None and "cover" in r:
            cv = r["cover"][0] / r["cover"][1] if r["cover"][1] else 1.0
            r["cover_floor"] = fl[1]
            if cv < fl[1]:
                bad.append(f"cover {cv:.4f} < floor {fl[1]}")
        if fl and not r["keys"]:
            bad.append("no keys read (file missing or empty)")
        r["ok"] = not bad
        if bad:
            fails.append(r["name"] + ": " + "; ".join(bad))
    if root == ROOT:
        # a data set that vanished (a state's land file, a renamed folder) must not pass by not being there
        names = {r["name"] for r in rows}
        fails += [f"{n}: not read (no such data set this run)" for n in FLOORS if n not in names]
    return rows, fails


def fmt(rows, fails):
    lines = ["join report: county spine 3,141 (data/atlas/counties.geo.json) via data/ids/geo-crosswalk.json",
             f"{'data set':24} {'keys':>6} {'direct':>6} {'folded':>6} {'lossy':>5} {'outside':>7} {'missed':>6} {'rate':>7} {'floor':>7}  cover"]
    for r in rows:
        cv = f"{r['cover'][0]:,} of {r['cover'][1]:,}" if "cover" in r else ""
        if r.get("no_point"):
            cv = (cv + "  " if cv else "") + f"{r['no_point']:,} with no point"
        fl = f"{r['floor']:.4f}" if r.get("floor") is not None else "-"
        lines.append(f"{('FAIL ' if not r['ok'] else '') + r['name']:24} {r['keys']:>6,} {r['direct']:>6,} {r['folded']:>6,} "
                     f"{r['lossy']:>5,} {r['outside']:>7,} {r['missed']:>6,} {r['rate']*100:>6.2f}% {fl:>7}  {cv}")
    lines.append(f"join report: {len(rows)} data sets, {len(fails)} below floor" + ("".join("\n  " + f for f in fails)))
    return "\n".join(lines)


# ------------------------------------------------------------------ selftest
def selftest():
    n = 0

    def ck(cond, msg):
        nonlocal n
        if not cond:
            raise SystemExit("join_report selftest FAILED: " + msg)
        n += 1

    sq = lambda x, y: {"type": "Polygon", "coordinates": [[[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1], [x, y]]]}
    with tempfile.TemporaryDirectory() as d:
        def put(rel, doc):
            p = os.path.join(d, rel)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, "w") as f:
                json.dump(doc, f)
        put("data/atlas/counties.geo.json", {"features": [
            {"id": "29186", "geometry": sq(-90, 37)}, {"id": "19155", "geometry": sq(-95, 41)},
            {"id": "09001", "geometry": sq(-73, 41)}]})
        put("data/ids/geo-crosswalk.json", {"codes": {
            "29193": {"to": ["29186"], "kind": "rename"}, "19156": {"to": ["19155"], "kind": "part"},
            "09190": {"to": None, "kind": "reshape"}}})
        put("data/arc-plc/MO.json", {"c": [{"f": "29193"}, {"f": "29186"}, {"f": "19156"}]})
        put("data/payments/county.json", {"counties": {"29186": {}, "72001": {}}})
        put("data/drought/county-week.json", {"c": {"29186": [], "09190": []}, "zero": ["19155"]})
        put("data/land-sales/mo.json", {"state": "MO", "cols": ["id", "lat", "lng"], "counties": {
            "29186": {"s": [["a", 37.5, -89.5], ["b", 41.5, -94.5], ["c", None, None]]}}})
        put("data/ids/elevators.json", {"counts": {"facilities": 3, "with_point": 2}, "elevators": [
            {"id": "e1", "fips": "29186", "sources": {"bids": ["COOP|||MO"], "basis": ["MO|COOP|TOWN"]}},
            {"id": "e2", "fips": None, "sources": {}}, {"id": "e3", "fips": None, "sources": {}}]})
        put("data/bids.json", {"bids": [{"facility": "COOP", "city": "", "state": "MO", "elevId": "eold000001"},
                                        {"facility": "OTHER", "city": "X", "state": "MO", "elevId": "enobody001"}]})
        put("data/ids/elevator-ids.json", {"retired": {"eold000001": {"into": "e1", "rule": "phone"}}})
        put("data/basis/MO.json", {"state": "MO", "f": ["COOP|TOWN", "GONE|TOWN"]})
        rows, fails = report(d)
        by = {r["name"]: r for r in rows}
        a = by["arc-plc counties"]
        ck((a["keys"], a["direct"], a["folded"], a["lossy"], a["rate"]) == (3, 1, 2, 1, 1.0),
           f"real case: FSA 29193 Ste. Genevieve folds by rename, 19156 by part (lossy): {a}")
        p = by["fsa payments counties"]
        ck((p["outside"], p["rate"]) == (1, 1.0), f"Puerto Rico is outside, not a miss: {p}")
        dr = by["drought counties"]
        ck(dr["missed"] == 1 and dr["cover"] == [2, 3], f"a CT planning region is a miss, and 09001 stays dark: {dr}")
        ck(any(f.startswith("drought counties") for f in fails), "drought below its floor fails the report")
        ls = by["land sale points MO"]
        ck((ls["keys"], ls["direct"], ls["missed"], ls["no_point"]) == (2, 1, 1, 1),
           f"a sale point outside its filed county is a miss; no point is counted apart: {ls}")
        ck(by["bids places to ids"]["direct"] == 1 and by["basis keys to ids"]["missed"] == 1, "id joins by exact key")
        ev = by["bids places carry elevId"]
        ck((ev["keys"], ev["direct"], ev["missed"]) == (2, 1, 1),
           f"a row's elevId joins through a retirement; an id no record holds is a miss: {ev}")
        ev = by["elevator points"]
        ck((ev["keys"], ev["direct"], ev["no_point"]) == (2, 1, 1), f"elevator points use the file's own counts: {ev}")
        ck(any(f.startswith("rma planting dates") and "no keys" in f for f in fails), "a data set that reads nothing fails")
        txt = fmt(rows, fails)
        ck("FAIL drought counties" in txt and "@" not in txt, "the printout names the failing set, and holds no address")
    print(f"join_report selftest: ok ({n} checks)")


def main(argv):
    if "--selftest" in argv:
        return selftest()
    rows, fails = report(ROOT)
    if "--json" in argv:
        print(json.dumps({"rows": rows, "fails": fails}, indent=1))
    else:
        print(fmt(rows, fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]) or 0)
