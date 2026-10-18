#!/usr/bin/env python3
"""Permanent ids (step 3, Oct 18): everything AGSIST knows joins on a fixed id, not on spelling.

Writes, under data/ids/:
  elevators.json     one record per physical facility, with every key and spelling it was seen under
  elevator-ids.json  the id ledger: which key holds which id, AGSIST-minted ids, merges and splits
  ambiguous.json     keys that matched more than one facility; listed, never guessed
  parcel-rules.json  the parcel key rule per state, in words, and the repeat-sale counts
  parcel-key-fixtures.json  pid -> key pairs from this file; test/ids.test.mjs checks parcel-key.js agrees

ELEVATOR IDS
  The bids repo (dnilgis/bids) already gives every location it knows a permanent `elevId`
  (lib/elevid.mjs, ledger data/elevator-ids.jsonl, docs/ELEVATOR-IDS.md): 8,400+ rows, read or not.
  A facility that is one of those rows takes that elevId as its AGSIST id, so the two sites share one
  id. A facility no bids-repo row matches gets an AGSIST id, "a" plus five digits, the next number in
  the ledger. Rules, all in this file:
    1. A key in the ledger keeps its id. Ids are never renumbered and never reused.
    2. An "a" id whose keys now all match one bids-repo row is merged into that elevId, and the merge
       is written to the ledger (`into`). If only some of its keys move, that is a split (`split`).
    3. A new key matches, strongest evidence first:
         exact: the bids.json place string, or the directory's own "known:" key, is that row's
         company + 0.5 mi: same operator (legal words, the town and a trailing state taken out)
                           and both points within 0.5 mile
         name + town:      same operator key, same town key, same state
       A step that finds two or more facilities stops there: the key is written to ambiguous.json
       and gets its own record. It is never attached to a guess.
  Sources read: data/bids.json, data/basis/<ST>.json (facility keys), data/elevator-directory.json,
  the shrink/drying/storage schedules on the raw branch (company level, so they attach to every
  facility of that company in the states the schedule covers), and the bids repo's
  data/directory.json and data/merged-index.json (a local clone with --bids-dir or $BIDS_DIR, else
  the published copies).
  County (fips): point in polygon on data/atlas/counties.geo.json, own state's counties only. No
  point, or a point in no county of its state: null. Never guessed from a town name.

PARCEL KEYS
  "<county fips>:<normalized parcel number>". The per-state rule is parcel_key() below, mirrored in
  data/ids/parcel-key.js. Repeat sales (one key, two or more market sales) are counted with the
  site's one market-sale rule (field-scout-land.js FSLand.saleRows / marketSale), run in node.

Usage: python3 scripts/build_ids.py [--bids-dir DIR] [--schedules FILE] [--no-parcels]
       python3 scripts/build_ids.py --selftest
"""
import argparse
import datetime as dt
import glob
import json
import math
import os
import re
import subprocess
import sys
import urllib.request
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from build_cash_bid_pages import op_key as _op_key, town_key  # noqa: E402  (the cash-bid pages' own keys)
from build_state_basis_pages import STATE_NAMES, town_text  # noqa: E402
from elevator_names import display_name  # noqa: E402

OUT = os.path.join(ROOT, "data", "ids")
NEAR_MI = 0.5
NETWORK_BASE = os.environ.get("BIDS_NETWORK_BASE", "https://dnilgis.github.io/bids/")
SCHEDULES_REF = "origin/raw:apijobs/schedules-2026-10/schedules/schedules.json"
STATE_FIPS = {"AL": "01", "AK": "02", "AZ": "04", "AR": "05", "CA": "06", "CO": "08", "CT": "09", "DE": "10",
              "DC": "11", "FL": "12", "GA": "13", "HI": "15", "ID": "16", "IL": "17", "IN": "18", "IA": "19",
              "KS": "20", "KY": "21", "LA": "22", "ME": "23", "MD": "24", "MA": "25", "MI": "26", "MN": "27",
              "MS": "28", "MO": "29", "MT": "30", "NE": "31", "NV": "32", "NH": "33", "NJ": "34", "NM": "35",
              "NY": "36", "NC": "37", "ND": "38", "OH": "39", "OK": "40", "OR": "41", "PA": "42", "RI": "44",
              "SC": "45", "SD": "46", "TN": "47", "TX": "48", "UT": "49", "VT": "50", "VA": "51", "WA": "53",
              "WV": "54", "WI": "55", "WY": "56"}


# ------------------------------------------------------------------ names
def clean(s):
    return " ".join(str(s or "").split())


def op_key(name, town="", st=""):
    """build_cash_bid_pages.op_key, after a trailing ", WI" or ", Wisconsin" is taken off
    ("ALLIED COOPERATIVE, WI" in the basis history is Allied Cooperative)."""
    s = clean(name)
    if st:
        s = re.sub(rf",?\s+({st}|{re.escape(STATE_NAMES.get(st, st))})\.?$", "", s, flags=re.I)
    # "Co-op" first: the pattern's "co" alternative wins inside "co-op" and leaves "op"
    s = re.sub(r"\bco\s?-\s?op\b", "coop", s, flags=re.I)
    # a name that is all town and trade words ("Rice Lake Grain" in Rice Lake) keeps its own words
    return _op_key(s, town) or _op_key(s) or re.sub(r"[^a-z0-9]", "", s.lower())


def tkey(city, st=""):
    s = clean(city)
    if st:
        s = re.sub(rf",?\s+({st}|{re.escape(STATE_NAMES.get(st, st))})\.?$", "", s, flags=re.I)
    return town_key(s)


def title(s):
    """Display case for an all-caps registry or basis spelling (the state basis pages' own
    rule); anything posted in mixed case stays as posted."""
    t = town_text(clean(s))
    if t != clean(s):
        t = re.sub(r"\bUs\b", "US", t)
    return re.sub(r"(\d)(St|Nd|Rd|Th)\b", lambda m: m.group(1) + m.group(2).lower(), t)


def miles(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 3958.8 * 2 * math.asin(min(1, math.sqrt(h)))


def num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) else None


def pt(lat, lng):
    lat, lng = num(lat), num(lng)
    if lat is None or lng is None or (lat == 0 and lng == 0) or abs(lat) > 90 or abs(lng) > 180:
        return None
    return (round(lat, 5), round(lng, 5))


# ------------------------------------------------------------------ counties
class Counties:
    """Point in polygon on the Census 20m outlines the site already ships."""

    def __init__(self, path=os.path.join(ROOT, "data", "atlas", "counties.geo.json")):
        with open(path) as f:
            doc = json.load(f)
        self.by_state = defaultdict(list)
        for ft in doc["features"]:
            fid = str(ft.get("id") or "")
            g = ft.get("geometry") or {}
            polys = g.get("coordinates") or []
            if g.get("type") == "Polygon":
                polys = [polys]
            elif g.get("type") != "MultiPolygon":
                continue
            xs = [p[0] for poly in polys for ring in poly for p in ring]
            ys = [p[1] for poly in polys for ring in poly for p in ring]
            self.by_state[fid[:2]].append((fid, (min(xs), min(ys), max(xs), max(ys)), polys))

    @staticmethod
    def _in_ring(x, y, ring):
        inside = False
        j = len(ring) - 1
        for i in range(len(ring)):
            xi, yi = ring[i][0], ring[i][1]
            xj, yj = ring[j][0], ring[j][1]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                inside = not inside
            j = i
        return inside

    def fips(self, lat, lng, st):
        sf = STATE_FIPS.get((st or "").upper())
        if not sf or lat is None or lng is None:
            return None
        for fid, (x0, y0, x1, y1), polys in self.by_state.get(sf, []):
            if not (x0 <= lng <= x1 and y0 <= lat <= y1):
                continue
            for poly in polys:
                if poly and self._in_ring(lng, lat, poly[0]) and not any(self._in_ring(lng, lat, h) for h in poly[1:]):
                    return fid
        return None


# ------------------------------------------------------------------ loading
def read_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def bids_repo_doc(bids_dir, rel):
    if bids_dir:
        return read_json(os.path.join(bids_dir, rel))
    req = urllib.request.Request(NETWORK_BASE.rstrip("/") + "/" + rel, headers={"User-Agent": "agsist-ids (+agsist.com)"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read().decode("utf-8"))


def load_schedules(path):
    if path:
        return read_json(path)
    out = subprocess.run(["git", "-C", ROOT, "show", SCHEDULES_REF], capture_output=True, text=True)
    if out.returncode != 0:
        raise SystemExit(f"[ids] schedules not readable at {SCHEDULES_REF} (git fetch origin raw), or pass --schedules")
    return json.loads(out.stdout)


def anchors_from_bids_repo(directory, mindex):
    """{elevId: anchor} from the bids repo directory, every row, with a town for each."""
    place_of = defaultdict(list)       # source id -> merged-index places
    for p in mindex.get("places") or []:
        if p.get("source"):
            place_of[p["source"]].append(p)
    out = {}
    for r in directory.get("elevators") or []:
        eid = r.get("elevId")
        if not eid:
            continue
        rid = r.get("id") or ""
        st = (r.get("state") or "").upper()
        city = ""
        if rid.startswith("known:"):
            parts = rid[6:].split("|")
            city = parts[2] if len(parts) >= 4 else ""
            st = st or (parts[3] if len(parts) >= 4 else "")
        elif rid.startswith("reg:"):
            city = r.get("location") or ""
        else:
            ps = place_of.get(rid) or []
            if ps:
                city = ps[0].get("town") or ps[0].get("city") or ""
                st = st or (ps[0].get("state") or "").upper()
        city = clean(city) or clean(r.get("location"))
        a = out.setdefault(eid, {"eid": eid, "rows": [], "places": []})
        a["rows"].append(rid)
        if len(a["rows"]) == 1:
            a.update({"operator": clean(r.get("operator")), "location": clean(r.get("location")), "city": city, "st": st,
                      "pt": pt(r.get("lat"), r.get("lon")), "status": r.get("status"), "bfips": r.get("fips")})
        for p in place_of.get(rid) or []:
            a["places"].append(clean(p["place"]))
    return out


def place_str(fac, branch, city, st):
    return "|".join(clean(x) for x in (fac, branch or "", city, st))


def secondary_keys(root, schedules):
    """[(key, info)] for every AGSIST-side spelling of a facility, and the schedule companies."""
    keys = []
    bids = read_json(os.path.join(root, "data", "bids.json"))
    seen = set()
    for b in bids.get("bids") or []:
        st = (b.get("state") or "").upper()
        k = "bids:" + place_str(b.get("facility"), b.get("branch"), b.get("city"), st)
        if k in seen:
            continue
        seen.add(k)
        keys.append((k, {"src": "bids", "operator": clean(b.get("facility")), "location": clean(b.get("branch")),
                         "city": clean(b.get("city")), "st": st, "pt": pt(b.get("lat"), b.get("lon")),
                         "place": place_str(b.get("facility"), b.get("branch"), b.get("city"), st)}))
    for f in sorted(glob.glob(os.path.join(root, "data", "basis", "*.json"))):
        if not re.match(r"^[A-Z]{2}\.json$", os.path.basename(f)):
            continue
        d = read_json(f)
        st = d.get("state") or os.path.basename(f)[:2]
        for fk in d.get("f") or []:
            fac, city = (fk.split("|", 1) + [""])[:2]
            keys.append((f"basis:{st}|{fk}", {"src": "basis", "operator": clean(fac), "location": "", "city": clean(city),
                                              "st": st, "pt": None}))
    ed = read_json(os.path.join(root, "data", "elevator-directory.json"))
    for e in ed.get("elevators") or []:
        lid = e.get("locationId")
        if lid is None:
            continue
        st = (e.get("state") or "").upper()
        keys.append((f"dir:{lid}", {"src": "directory", "operator": clean(e.get("company")), "location": clean(e.get("location")),
                                    "city": clean(e.get("city")), "st": st, "pt": pt(e.get("lat"), e.get("lng")),
                                    "known": "known:" + "|".join(clean(x) for x in (e.get("company"), e.get("location"),
                                                                                     e.get("city"), st))}))
    sched = []
    for c in (schedules or {}).get("companies") or []:
        if not (c.get("schedules") or []):
            continue
        name = re.sub(r"^[RU]:", "", c.get("company") or "")
        sched.append((f"sched:{c.get('company')}", {"label": clean(c.get("label") or name), "name": clean(name),
                                                     "states": sorted((c.get("states") or {}).keys())}))
    return keys, sched


# ------------------------------------------------------------------ matching
class Index:
    def __init__(self, anchors):
        self.place = defaultdict(set)    # place string -> eids
        self.known = defaultdict(set)    # directory "known:" id -> eids
        self.op = defaultdict(set)       # (st, op key) -> eids
        self.optown = defaultdict(set)   # (st, op key with the town out, town key) -> eids
        self.upper = defaultdict(set)    # (st, OPERATOR|CITY) -> eids, the basis-history spelling
        self.anchors = anchors
        for eid, a in anchors.items():
            st = a["st"]
            for rid in a["rows"]:
                if rid.startswith("known:"):
                    self.known[rid].add(eid)
            for p in a["places"]:
                self.place[p].add(eid)
                op, _br, city, pst = (p.split("|") + ["", "", "", ""])[:4]
                self.upper[(pst, f"{op.upper()}|{city.upper()}")].add(eid)
                self.optown[(pst, op_key(op, city, pst), tkey(city, pst))].add(eid)
            self.op[(st, op_key(a["operator"], "", st))].add(eid)
            for town in {a["city"], a["location"]}:
                if town:
                    self.optown[(st, op_key(a["operator"], town, st), tkey(town, st))].add(eid)

    def match(self, info):
        """-> (eid or None, rule, candidates). Strongest evidence first; a step with 2+ stops."""
        st = info["st"]
        steps = []
        if info.get("place"):
            steps.append(("exact", self.place.get(info["place"], set())))
        if info.get("known"):
            steps.append(("exact", self.known.get(info["known"], set())))
        if info["src"] == "basis":
            steps.append(("exact", self.upper.get((st, f"{info['operator'].upper()}|{info['city'].upper()}"), set())))
        if info.get("pt"):
            near = {e for e in self.op.get((st, op_key(info["operator"], "", st)), set())
                    if self.anchors[e]["pt"] and miles(info["pt"], self.anchors[e]["pt"]) <= NEAR_MI}
            steps.append(("company+0.5mi", near))
        if info["city"]:
            steps.append(("name+town", self.optown.get((st, op_key(info["operator"], info["city"], st),
                                                        tkey(info["city"], st)), set())))
        for rule, c in steps:
            if len(c) == 1:
                return next(iter(c)), rule, []
            if len(c) > 1:
                return None, rule, sorted(c)
        return None, None, []


def local_group_key(info):
    """Keys no bids-repo row matched are grouped with each other by operator and town."""
    return (info["st"], op_key(info["operator"], info["city"], info["st"]), tkey(info["city"], info["st"]))


# ------------------------------------------------------------------ ledger
def load_ledger(path):
    if os.path.exists(path):
        d = read_json(path)
        d.setdefault("keys", {})
        d.setdefault("minted", {})
        d.setdefault("events", [])
        return d
    return {"schema": "agsist-elevator-ids/1", "next": 1, "keys": {}, "minted": {}, "events": []}


def mint(ledger, first_key, today):
    while True:
        aid = "a%05d" % ledger["next"]
        ledger["next"] += 1
        if aid not in ledger["minted"]:
            ledger["minted"][aid] = {"first": first_key, "since": today}
            return aid


def assign(anchors, keys, ledger, today):
    """-> ({id: [key...]}, ambiguous [...], rules Counter). Updates the ledger in place."""
    idx = Index(anchors)
    live = set(anchors)
    held = {}            # key -> id
    ambiguous = []
    rules = Counter()
    fresh = {}           # key -> (eid, rule, cands)
    for k, info in keys:
        fresh[k] = idx.match(info)
        e, rule, cands = fresh[k]
        if cands:
            ambiguous.append({"key": k, "rule": rule, "candidates": cands})
    # 1. keys already in the ledger keep their id; an "a" id whose keys now match one row moves there
    by_old = defaultdict(list)
    for k, _info in keys:
        old = ledger["keys"].get(k)
        if old:
            by_old[old].append(k)
    for old, ks in sorted(by_old.items()):
        minted = old in ledger["minted"]
        if not minted or ledger["minted"][old].get("into"):
            tgt = ledger["minted"].get(old, {}).get("into") if minted else None
            for k in ks:
                held[k] = tgt or old
                rules["kept"] += 1
            continue
        moves = {k: fresh[k][0] for k in ks if fresh[k][0]}
        if moves and len(set(moves.values())) == 1 and len(moves) == len(ks):
            tgt = next(iter(moves.values()))
            ledger["minted"][old]["into"] = tgt
            ledger["events"].append({"on": today, "merge": old, "into": tgt, "why": "every key now matches that bids-repo row"})
            for k in ks:
                held[k] = tgt
                rules["merged"] += 1
        elif moves:
            for k in ks:
                held[k] = moves.get(k, old)
                rules["split" if k in moves else "kept"] += 1
            ledger["events"].append({"on": today, "split": old, "moved": sorted(moves), "to": sorted(set(moves.values())),
                                     "why": "some keys now match a bids-repo row"})
        else:
            for k in ks:
                held[k] = old
                rules["kept"] += 1
    # 2. new keys: a match, else a group of unmatched keys that share operator and town
    for k, info in keys:
        if k in held:
            continue
        e, rule, cands = fresh[k]
        if e:
            held[k] = e
            rules[rule] += 1
            continue
        held[k] = ("local", local_group_key(info))
        rules["ambiguous" if cands else "unmatched"] += 1
    # existing local ids per group (from keys kept in step 1)
    group_id = {}
    info_of = dict(keys)
    for k, v in held.items():
        if isinstance(v, str) and v in ledger["minted"] and not ledger["minted"][v].get("into"):
            g = local_group_key(info_of[k])
            group_id.setdefault(g, v)
    for k in sorted(held):
        v = held[k]
        if isinstance(v, tuple):
            g = v[1]
            if g not in group_id:
                group_id[g] = mint(ledger, k, today)
            held[k] = group_id[g]
    for k, v in held.items():
        ledger["keys"][k] = v
    # a key held by a bids-repo id from an earlier build is settled; only open ones are listed
    ambiguous = [a for a in ambiguous if held[a["key"]] in ledger["minted"]]
    out = defaultdict(list)
    for k, v in held.items():
        out[v].append(k)
    for eid in live:
        out.setdefault(eid, [])
    return out, ambiguous, rules


# ------------------------------------------------------------------ records
def build_records(anchors, keys, sched, groups, counties, ambiguous=(), keep_all=False):
    info_of = dict(keys)
    maybe_of = {a["key"]: a["candidates"] for a in ambiguous}
    recs = []
    for fid in sorted(groups):
        ks = sorted(groups[fid])
        a = anchors.get(fid)
        if a is None and not ks:
            continue
        if a and not ks and not keep_all and a.get("status") == "known":
            continue    # a bids-repo row no AGSIST source names: it is in the bids repo's own directory
        infos = [info_of[k] for k in ks]
        order = {"directory": 0, "bids": 1, "basis": 2}
        infos_sorted = sorted(infos, key=lambda i: (order[i["src"]], i["operator"], i["city"]))
        if a:
            company, loc, city, st, p = a["operator"], a["location"], a["city"], a["st"], a["pt"]
        else:
            i0 = infos_sorted[0]
            company, loc, city, st, p = i0["operator"], i0["location"], i0["city"], i0["st"], None
            ps = [i["pt"] for i in infos_sorted if i["pt"]]
            p = ps[0] if ps else None
        if not p:
            ps = [i["pt"] for i in infos_sorted if i["pt"]]
            p = ps[0] if ps else None
        if not st:
            sts = [i["st"] for i in infos_sorted if i["st"]]
            st = sts[0] if sts else ""
        company = display_name(title(company)) or title(company)
        city = title(city)
        if not loc or tkey(loc, st) == tkey(city, st) or op_key(loc) == op_key(company):
            name = company
        elif clean(loc).lower().startswith(company.lower()) or op_key(loc, "", st).startswith(op_key(company, "", st)):
            name = title(loc)            # "Ridgeville Elevator- Ridgeville Corners" already says who
        else:
            name = f"{company} {title(loc)}"
        aliases = []
        for s in ([a["operator"], a["location"]] if a else []) + [x for i in infos for x in (i["operator"], i["location"])]:
            s = clean(s)
            if s and s not in aliases and s not in (name, company) and tkey(s, st) != tkey(city, st):
                aliases.append(s)
        srcs = defaultdict(list)
        for k in ks:
            kind, rest = k.split(":", 1)
            srcs[{"bids": "bids", "basis": "basis", "dir": "directory"}[kind]].append(rest)
        if a:
            srcs["bids_repo"] = sorted(a["rows"])
        ok = op_key(company, "", st)
        okr = op_key(a["operator"] if a else company, "", st)
        for sk, s in sched:
            if (st in s["states"] or not s["states"]) and {op_key(s["label"], "", st), op_key(s["name"], "", st)} & {ok, okr}:
                srcs["schedules"].append(sk.split(":", 1)[1])
        r = {"id": fid, "name": name, "company": company, "city": city, "st": st,
             "fips": counties.fips(p[0], p[1], st) if p else None}
        if p:
            r["lat"], r["lng"] = round(p[0], 4), round(p[1], 4)
        if aliases:
            r["aliases"] = aliases
        r["sources"] = {k: sorted(set(v)) for k, v in sorted(srcs.items())}
        maybe = sorted({e for k in ks for e in maybe_of.get(k, [])} - {fid})
        if maybe:
            r["maybe"] = maybe       # may be one of these bids-repo rows; see data/ids/ambiguous.json
        if a and a.get("bfips") and r["fips"] and a["bfips"] != r["fips"]:
            r["fips_bids_repo"] = a["bfips"]
        recs.append(r)
    return recs


# ------------------------------------------------------------------ parcels
def parcel_key(fips, pid):
    """'<fips>:<normalized pid>' or None. Twin of data/ids/parcel-key.js (tested to agree).
      IL  PINs are fixed width in each county, so dashes, dots and spaces are only layout:
          letters and digits, upper case ("25-14-400-004" = "2514400004"). Cook County (17031)
          writes the same PIN as 14 digits with a 0000 unit or as 10 digits: the 10 are kept.
      IN  the 18-digit state parcel number, digits only ("06-03-02-000-036.002-020" =
          "060302000036002020"). A 17-digit number whose county number (the first two digits,
          (county fips + 1) / 2) shows only after a leading zero is put back gets that zero:
          spreadsheets drop it.
      WI  each county writes its own layout and the same parcel turns up with and without zero
          padding ("012-00977-0008" and "12-00977-0008"): each run of digits without its leading
          zeros, letters kept, runs joined with "-" (the Field Scout "seg" key).
      Any other state: letters and digits, upper case."""
    f = re.sub(r"\D", "", str(fips or ""))
    s = clean(pid).upper()
    if len(f) != 5 or not s:
        return None
    strip = re.sub(r"[^A-Z0-9]", "", s)
    if not strip or re.fullmatch(r"0+", strip):
        return None
    st = f[:2]
    if st == "17":
        if f == "17031" and re.fullmatch(r"\d{10}0000", strip):
            strip = strip[:10]
        return f"{f}:{strip}"
    if st == "18":
        d = re.sub(r"\D", "", s)
        if not d or re.fullmatch(r"0+", d):
            return None
        cn = "%02d" % ((int(f[2:]) + 1) // 2)
        if len(d) == 17 and ("0" + d)[:2] == cn and d[:2] != cn:
            d = "0" + d
        return f"{f}:{d}"
    if st == "55":
        runs = re.findall(r"[A-Z]+|[0-9]+", s)
        return f"{f}:" + "-".join((r.lstrip("0") or "0") if r.isdigit() else r for r in runs)
    return f"{f}:{strip}"


PARCEL_FIXTURES = [
    # (fips, pid, key) written by hand; the build adds samples from the real files
    ("17011", "25-14-400-004", "17011:2514400004"),
    ("17011", "2514400004", "17011:2514400004"),
    ("17011", "25 14 400 004", "17011:2514400004"),
    ("17149", "42-014-05A", "17149:4201405A"),
    ("17119", "02-1-18-31-00-000-009.012", "17119:021183100000009012"),
    ("17031", "13-19-104-002-0000", "17031:1319104002"),
    ("17031", "13-19-104-002", "17031:1319104002"),
    ("17031", "13-19-104-002-1001", "17031:13191040021001"),
    ("17011", "0", None),
    ("17011", "", None),
    ("18011", "060302000036002020", "18011:060302000036002020"),
    ("18011", "06-03-02-000-036.002-020", "18011:060302000036002020"),
    ("18011", "60302000036002020", "18011:060302000036002020"),
    ("18139", "700734400005000012", "18139:700734400005000012"),
    ("18001", "10018402000000001", "18001:010018402000000001"),
    ("18139", "70073440000500001", "18139:70073440000500001"),
    ("55123", "012-00977-0008", "55123:12-977-8"),
    ("55123", "12-00977-0008", "55123:12-977-8"),
    ("55135", "08 29 13 02", "55135:8-29-13-2"),
    ("55135", "08 29 13 2", "55135:8-29-13-2"),
    ("55039", "T03-13-19-29-11-008-00", "55039:T-3-13-19-29-11-8-0"),
    ("55025", "002/051207180004", "55025:2-51207180004"),
    ("55047", "251-00403-0500", "55047:251-403-500"),
    ("5504", "251-00403-0500", None),
    ("55013", "07-022-2-37-14-14-1 04-000-011000", "55013:7-22-2-37-14-14-1-4-0-11000"),
    ("55015", "000123456789012345678901", "55015:123456789012345678901"),
    ("19153", "01-02-345-678", "19153:0102345678"),
]

REPEAT_JS = r"""
const F = require(process.argv[1] + '/field-scout-land.js');
const PK = require(process.argv[1] + '/data/ids/parcel-key.js');
const fs = require('fs'), path = require('path');
const today = process.argv[2];
const out = {};
for (const st of ['il', 'in', 'wi']) {
  const dir = path.join(process.argv[1], 'data/land', st);
  const by = {}; let sales = 0, keyed = 0, files = 0;
  for (const f of fs.readdirSync(dir).filter(n => /^\d{5}\.json$/.test(n)).sort()) {
    const doc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); files++;
    for (const r of F.saleRows(F.rowObjs(doc), today)) {
      if (!F.marketSale(r, today)) continue;
      sales++;
      const k = PK.parcelKey(doc.fips, r.pid);
      if (!k) continue;
      keyed++; by[k] = (by[k] || 0) + 1;
    }
  }
  const rep = Object.values(by).filter(n => n >= 2);
  out[st.toUpperCase()] = { county_files: files, market_sales: sales, with_parcel_key: keyed, parcels: Object.keys(by).length,
    parcels_sold_2plus: rep.length, sales_on_those: rep.reduce((a, b) => a + b, 0) };
}
console.log(JSON.stringify(out));
"""


def land_today(root):
    best = ""
    for f in glob.glob(os.path.join(root, "data", "land", "*", "[0-9]*.json")):
        with open(f, encoding="utf-8") as fh:
            m = re.search(r'"fetched_utc":\s*"(\d{4}-\d{2}-\d{2})', fh.read(4096))
        if m and m.group(1) > best:
            best = m.group(1)
    return best or dt.date.today().isoformat()


def parcel_outputs(root):
    samples = []
    for st in ("il", "in", "wi"):
        for f in sorted(glob.glob(os.path.join(root, "data", "land", st, "[0-9]*.json")))[::9]:
            d = read_json(f)
            pi = d["cols"].index("pid")
            seen = set()
            for r in d["rows"]:
                p = r[pi]
                if p is None:
                    continue
                shape = re.sub(r"[0-9]", "9", re.sub(r"[A-Za-z]", "A", str(p)))
                if shape in seen:
                    continue
                seen.add(shape)
                samples.append([d["fips"], str(p), parcel_key(d["fips"], p)])
                if len(seen) >= 4:
                    break
    today = land_today(root)
    res = subprocess.run(["node", "-e", REPEAT_JS, root, today], capture_output=True, text=True)
    if res.returncode != 0:
        raise SystemExit("[ids] repeat-sale count failed: " + res.stderr[-800:])
    counts = json.loads(res.stdout)
    rules = {
        "schema": "agsist-parcel-keys/1",
        "key": "<5-digit county fips>:<normalized parcel number>",
        "code": "scripts/build_ids.py parcel_key(); data/ids/parcel-key.js parcelKey() (tested to agree)",
        "states": {
            "IL": "Letters and digits, upper case: a county's PINs are fixed width, so dashes, dots and spaces are layout only. "
                  "Cook County (17031): a 14-digit PIN ending in a 0000 unit is the 10-digit PIN.",
            "IN": "Digits of the 18-digit state parcel number. A 17-digit number gets its dropped leading zero back only when "
                  "that makes the first two digits the county's number, (county fips + 1) / 2.",
            "WI": "Each run of digits without leading zeros, letters kept, joined with '-': counties write the same parcel with "
                  "and without zero padding.",
            "other": "Letters and digits, upper case.",
        },
        "repeat_sales": {"as_of": today, "rule": "market sales by FSLand.saleRows + FSLand.marketSale (field-scout-land.js), "
                                                 "one row per sale; a parcel sold 2+ times by that rule", "by_state": counts},
    }
    fixtures = [[f, p, k] for f, p, k in PARCEL_FIXTURES] + samples
    return rules, fixtures


# ------------------------------------------------------------------ main
def write_json(path, doc, compact=False):
    with open(path, "w", encoding="utf-8") as f:
        if compact:
            f.write("{\n" + ",\n".join(f"{json.dumps(k)}: " + (
                "[\n" + ",\n".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) for r in v) + "\n]"
                if isinstance(v, list) else json.dumps(v, ensure_ascii=False)) for k, v in doc.items()) + "\n}\n")
        else:
            json.dump(doc, f, ensure_ascii=False, indent=1, sort_keys=False)
            f.write("\n")


def build(root, bids_dir, schedules_path, out_dir, today, do_parcels=True, log=print):
    directory = bids_repo_doc(bids_dir, "data/directory.json")
    mindex = bids_repo_doc(bids_dir, "data/merged-index.json")
    anchors = anchors_from_bids_repo(directory, mindex)
    keys, sched = secondary_keys(root, load_schedules(schedules_path))
    os.makedirs(out_dir, exist_ok=True)
    lpath = os.path.join(out_dir, "elevator-ids.json")
    ledger = load_ledger(lpath)
    groups, ambiguous, rules = assign(anchors, keys, ledger, today)
    counties = Counties(os.path.join(root, "data", "atlas", "counties.geo.json"))
    recs = build_records(anchors, keys, sched, groups, counties, ambiguous)
    kinds = Counter()
    multi = 0
    for r in recs:
        s = [k for k in r["sources"] if k != "schedules"]
        multi += len(s) >= 2
        for k in s:
            kinds[k] += 1
    counts = {"facilities": len(recs), "with_fips": sum(1 for r in recs if r["fips"]),
              "with_point": sum(1 for r in recs if "lat" in r),
              "maybe_records": sum(1 for r in recs if r.get("maybe")),
              "matched_2plus_sources": multi, "ambiguous_keys": len(ambiguous),
              "with_schedules": sum(1 for r in recs if r["sources"].get("schedules")),
              "agsist_ids": sum(1 for r in recs if re.fullmatch(r"a\d{5}", r["id"])),
              "bids_repo_ids": sum(1 for r in recs if not re.fullmatch(r"a\d{5}", r["id"])),
              "fips_differs_from_bids_repo": sum(1 for r in recs if r.get("fips_bids_repo")),
              "by_source": dict(sorted(kinds.items())), "keys_by_rule": dict(sorted(rules.items()))}
    doc = {"schema": "agsist-elevators/1", "generated": today,
           "note": "One record per physical facility. id: the bids repo's permanent elevId when the facility is one of its "
                   "rows, else an AGSIST id (a + 5 digits) from data/ids/elevator-ids.json. Join on id, never on a name. "
                   "sources holds every key the facility is known by (bids: data/bids.json place, basis: ST|FACILITY|CITY "
                   "in data/basis/<ST>.json, directory: data/elevator-directory.json locationId, bids_repo: dnilgis/bids "
                   "data/directory.json id, schedules: company on the raw-branch schedules job). fips: point in "
                   "data/atlas/counties.geo.json, null without a point. Rules: scripts/build_ids.py.",
           "counts": counts, "elevators": recs}
    write_json(os.path.join(out_dir, "elevators.json"), doc, compact=True)
    ledger["keys"] = dict(sorted(ledger["keys"].items()))
    ledger["note"] = ("Which id each key holds. A key keeps its id; ids are never renumbered or reused. minted: AGSIST ids "
                      "(a + 5 digits) with the key that first held each; into: merged into a bids-repo elevId. events: every "
                      "merge and split. Rules: scripts/build_ids.py.")
    write_json(lpath, {k: ledger[k] for k in ("schema", "note", "next", "minted", "events", "keys")})
    write_json(os.path.join(out_dir, "ambiguous.json"),
               {"note": "Keys that matched more than one facility at the strongest step that matched at all. Each has its own "
                        "record; fix by hand with a ledger line, never by guessing.", "keys": ambiguous})
    if do_parcels:
        prules, fixtures = parcel_outputs(root)
        write_json(os.path.join(out_dir, "parcel-rules.json"), prules)
        write_json(os.path.join(out_dir, "parcel-key-fixtures.json"),
                   {"note": "[fips, pid, key] from scripts/build_ids.py parcel_key(); parcel-key.js must give the same.",
                    "cases": fixtures})
        counts["repeat_sales"] = prules["repeat_sales"]["by_state"]
    log(f"[ids] facilities {counts['facilities']}, with fips {counts['with_fips']}, matched across 2+ sources "
        f"{counts['matched_2plus_sources']}, ambiguous {counts['ambiguous_keys']}")
    log(f"[ids] ids: bids repo {counts['bids_repo_ids']}, AGSIST {counts['agsist_ids']}; with schedules "
        f"{counts['with_schedules']}; fips differs from bids repo {counts['fips_differs_from_bids_repo']}")
    log(f"[ids] keys by rule {counts['keys_by_rule']}")
    if do_parcels:
        for st, c in counts["repeat_sales"].items():
            log(f"[ids] {st} parcels sold 2+ times {c['parcels_sold_2plus']} of {c['parcels']} "
                f"({c['market_sales']} market sales)")
    return doc


# ------------------------------------------------------------------ selftest
def selftest():
    import shutil
    import tempfile
    fails = []

    def ck(name, ok):
        print(("ok   " if ok else "FAIL ") + name)
        if not ok:
            fails.append(name)

    for f, p, k in PARCEL_FIXTURES:
        ck(f"parcel_key {f} {p!r} -> {k}", parcel_key(f, p) == k)
    c = Counties()
    ck("fips Chetek WI 55005", c.fips(45.3141, -91.6510, "WI") == "55005")
    ck("fips Decatur IL 17115", c.fips(39.8403, -88.9548, "IL") == "17115")
    ck("fips Ames IA 19169", c.fips(42.0308, -93.6319, "IA") == "19169")
    ck("fips own state only (Chetek point asked as MN)", c.fips(45.3141, -91.6510, "MN") is None)
    ck("fips no point", c.fips(None, None, "WI") is None)
    ck("op_key drops a trailing state", op_key("ALLIED COOPERATIVE, WI", "ADAMS", "WI") == op_key("Allied Cooperative", "Adams", "WI"))

    # a tiny world: two bids-repo rows of one company in one town, one elsewhere
    tmp = tempfile.mkdtemp(prefix="ids-selftest-")
    try:
        root, bdir = os.path.join(tmp, "site"), os.path.join(tmp, "bids")
        for d in ("data/basis", "data/atlas", "data/land", "data"):
            os.makedirs(os.path.join(root, d), exist_ok=True)
        os.makedirs(os.path.join(bdir, "data"), exist_ok=True)
        shutil.copy(os.path.join(ROOT, "data", "atlas", "counties.geo.json"), os.path.join(root, "data", "atlas"))
        directory = {"elevators": [
            {"id": "coopx-chetek", "elevId": "e000000001", "operator": "Coop X", "location": "Chetek", "state": "WI",
             "status": "read", "lat": 45.3141, "lon": -91.6510, "fips": "55005"},
            {"id": "coopx-chetekeast", "elevId": "e000000002", "operator": "Coop X", "location": "Chetek East", "state": "WI",
             "status": "read", "lat": 45.3150, "lon": -91.6400, "fips": "55005"},
            {"id": "known:Grain Co|Ames|Ames|IA", "elevId": "e000000003", "operator": "Grain Co", "location": "Ames",
             "state": "IA", "status": "known", "lat": 42.0308, "lon": -93.6319, "fips": "19169"},
            {"id": "known:Nobody Named|Far|Far|IA", "elevId": "e000000004", "operator": "Nobody Named", "location": "Far",
             "state": "IA", "status": "known", "lat": 41.0, "lon": -93.0, "fips": "19117"},
            {"id": "rlg-ricelake", "elevId": "e000000006", "operator": "Rice Lake Grain", "location": "Rice Lake", "state": "WI",
             "status": "read", "lat": 45.5061, "lon": -91.7382, "fips": "55005"}]}
        mindex = {"places": [
            {"place": "Coop X||Chetek|WI", "source": "coopx-chetek", "operator": "Coop X", "city": "Chetek", "state": "WI"},
            {"place": "Coop X|East|Chetek|WI", "source": "coopx-chetekeast", "operator": "Coop X", "city": "Chetek", "state": "WI"},
            {"place": "Rice Lake Grain||Rice Lake|WI", "source": "rlg-ricelake", "operator": "Rice Lake Grain", "city": "Rice Lake",
             "state": "WI"}]}
        json.dump(directory, open(os.path.join(bdir, "data", "directory.json"), "w"))
        json.dump(mindex, open(os.path.join(bdir, "data", "merged-index.json"), "w"))
        json.dump({"bids": [{"facility": "Coop X", "branch": "", "city": "Chetek", "state": "WI", "lat": 45.3141, "lon": -91.651}]},
                  open(os.path.join(root, "data", "bids.json"), "w"))
        json.dump({"state": "WI", "f": ["COOP X|CHETEK", "COOP X, WI|CHETEK", "OLD MILL|BARRON", "OLD MILL INC|BARRON",
                                         "RICE LAKE GRAIN|RICE LAKE", "RICE LAKE GRAIN, WI|RICE LAKE"]},
                  open(os.path.join(root, "data", "basis", "WI.json"), "w"))
        json.dump({"state": "IA", "f": ["GRAIN CO|AMES"]}, open(os.path.join(root, "data", "basis", "IA.json"), "w"))
        json.dump({"elevators": [{"company": "Grain Co", "location": "Ames", "city": "Ames", "state": "IA", "locationId": 7},
                                 {"company": "Coop X", "location": "Chetek", "city": "Chetek", "state": "WI", "locationId": 8,
                                  "lat": 45.3145, "lng": -91.645}]},
                  open(os.path.join(root, "data", "elevator-directory.json"), "w"))
        sch = os.path.join(tmp, "s.json")
        json.dump({"companies": [{"company": "R:Coop X", "label": "Coop X", "states": {"WI": 2}, "schedules": [{"crop": "corn"}]}]},
                  open(sch, "w"))
        out = os.path.join(root, "data", "ids")
        d1 = build(root, bdir, sch, out, "2026-10-18", do_parcels=False, log=lambda *_: None)
        by = {r["id"]: r for r in d1["elevators"]}
        ck("exact place joins bids.json to its elevId", "Coop X||Chetek|WI" in by["e000000001"]["sources"].get("bids", []))
        ck("basis upper spelling exact", "WI|RICE LAKE GRAIN|RICE LAKE" in by["e000000006"]["sources"].get("basis", []))
        ck("basis spelling with a trailing state joins by name and town",
           "WI|RICE LAKE GRAIN, WI|RICE LAKE" in by["e000000006"]["sources"].get("basis", []))
        amb = {a["key"] for a in read_json(os.path.join(out, "ambiguous.json"))["keys"]}
        ck("two rows of one company in one town: the basis key (no branch) is ambiguous, not guessed",
           {"basis:WI|COOP X|CHETEK", "basis:WI|COOP X, WI|CHETEK"} <= amb)
        mb = [r for r in d1["elevators"] if "WI|COOP X|CHETEK" in r["sources"].get("basis", [])]
        ck("ambiguous spellings of one operator and town share one record that names both candidates",
           len(mb) == 1 and "WI|COOP X, WI|CHETEK" in mb[0]["sources"]["basis"]
           and mb[0].get("maybe") == ["e000000001", "e000000002"])
        ck("directory point within 0.5 mi of two rows of the company is ambiguous", "dir:8" in amb)
        ck("known: key is exact", "7" in by["e000000003"]["sources"].get("directory", []))
        ck("unread bids-repo row no AGSIST source names is left out", "e000000004" not in by)
        olds = [r for r in d1["elevators"] if r["id"].startswith("a") and "WI|OLD MILL|BARRON" in r["sources"].get("basis", [])]
        ck("unmatched keys of one operator and town share one AGSIST id",
           len(olds) == 1 and "WI|OLD MILL INC|BARRON" in olds[0]["sources"]["basis"])
        ck("fips by point", by["e000000001"]["fips"] == "55005" and by["e000000003"]["fips"] == "19169")
        ck("schedules attach by company and state", by["e000000001"]["sources"].get("schedules") == ["R:Coop X"]
           and "schedules" not in by["e000000003"]["sources"])
        ck("the basis spellings are kept as aliases",
           {"RICE LAKE GRAIN", "RICE LAKE GRAIN, WI"} <= set(by["e000000006"].get("aliases", [])))
        ids1 = {r["id"]: r["sources"] for r in d1["elevators"]}
        d2 = build(root, bdir, sch, out, "2026-10-19", do_parcels=False, log=lambda *_: None)
        ck("second build gives the same ids", {r["id"]: r["sources"] for r in d2["elevators"]} == ids1)
        # the old mill turns up in the bids repo: its AGSIST id is merged, not reused
        aid = olds[0]["id"]
        directory["elevators"].append({"id": "known:Old Mill|Barron|Barron|WI", "elevId": "e000000005", "operator": "Old Mill",
                                       "location": "Barron", "state": "WI", "status": "known", "lat": 45.4, "lon": -91.85})
        json.dump(directory, open(os.path.join(bdir, "data", "directory.json"), "w"))
        d3 = build(root, bdir, sch, out, "2026-10-20", do_parcels=False, log=lambda *_: None)
        led = read_json(os.path.join(out, "elevator-ids.json"))
        by3 = {r["id"]: r for r in d3["elevators"]}
        ck("AGSIST id merged into the new bids-repo row and recorded", led["minted"][aid].get("into") == "e000000005"
           and aid not in by3 and "WI|OLD MILL|BARRON" in by3["e000000005"]["sources"]["basis"]
           and any(e.get("merge") == aid for e in led["events"]))
        # a brand new unmatched key never gets the merged id back
        bw = read_json(os.path.join(root, "data", "basis", "WI.json"))
        bw["f"].append("NEW YARD|CUMBERLAND")
        json.dump(bw, open(os.path.join(root, "data", "basis", "WI.json"), "w"))
        d4 = build(root, bdir, sch, out, "2026-10-21", do_parcels=False, log=lambda *_: None)
        new = [r["id"] for r in d4["elevators"] if "WI|NEW YARD|CUMBERLAND" in r["sources"].get("basis", [])]
        ck("new key gets the next id, never a used one", len(new) == 1 and new[0] != aid and new[0] not in ids1)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print(f"FAILS={len(fails)}")
    return 1 if fails else 0


def main():
    ap = argparse.ArgumentParser(description="Permanent elevator ids and parcel keys.")
    ap.add_argument("--bids-dir", default=os.environ.get("BIDS_DIR"), help="local clone of dnilgis/bids")
    ap.add_argument("--schedules", help="schedules.json (default: the raw branch copy via git show)")
    ap.add_argument("--no-parcels", action="store_true")
    ap.add_argument("--today", default=dt.date.today().isoformat())
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    build(ROOT, a.bids_dir, a.schedules, OUT, a.today, do_parcels=not a.no_parcels)
    return 0


if __name__ == "__main__":
    sys.exit(main())
