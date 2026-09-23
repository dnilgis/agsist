#!/usr/bin/env python3
"""
build_basis_map.py — National basis map for the AGSIST cash-bids page.

Reads data/bids.json (produced by fetch_bids.py from Barchart OnDemand),
aggregates the Barchart-provided `basis` ($/bu, cash minus the futures month
that board quoted -- NOT necessarily the nearby contract, and this script
averages every delivery month a location posts) by location -> state ->
commodity for corn, soybeans, and the three wheat classes, and writes
data/basis-map.json, consumed by the "National Basis" section of cash-bids.html.

Barchart returns `basis` directly on each bid, so no futures lookup or
cents conversion is needed here. No API key required — this runs on the
already-fetched bids.json. In a GitHub Action, run it right after fetch_bids.py.
"""
import json, os, re, sys
from datetime import datetime, timezone
from collections import defaultdict

# data/bids.json is now SLIM -- a few hundred bids, only the ones the futures
# pages can select. A national basis map built from that would be wrong and
# would look fine. The full set is written by fetch_bids.py to BIDS_FULL_PATH
# and is NOT committed, so this script must run in the same job as the fetch.
BIDS_FULL_PATH = os.environ.get("BIDS_FULL_PATH", "bids-full.json")
BIDS_PATH = "data/bids.json"
OUT_PATH  = "data/basis-map.json"
COMMODITIES = ["corn", "soybeans", "wheat"]
# WHAT THE NUMBER IS AGAINST, IN THE BOARD'S OWN TERMS. This script averages
# every delivery month a location posts, so none of these is a nearby basis
# and none of them says it is.
FUTURES_REF = {"corn": "each board's posted futures month \u2014 CBOT corn (ZC)",
               "soybeans": "each board's posted futures month \u2014 CBOT soybeans (ZS)",
               "wheat-srw": "each board's posted futures month \u2014 Chicago SRW (CBOT, ZW)",
               "wheat-hrw": "each board's posted futures month \u2014 KC HRW (CBOT, KE)",
               "wheat-hrs": "each board's posted futures month \u2014 spring wheat (MGEX, MWE)",
               "wheat-sww": "each board's own reference \u2014 soft white has no CBOT, KC or MGEX contract; not comparable with the tabs above",
               "wheat-unstated": "each board's own reference \u2014 these boards did not say which wheat; not comparable with the tabs above"}

# Order matters: durum and spring are tested before the winter patterns so
# "Hard Red Spring" cannot be caught by a rule meant for "Hard Red Winter",
# and soft WHITE before soft RED so "Soft White Wheat" is not filed as SRW.
_WHEAT_RX = [
    ("durum",     re.compile(r"\bdurum\b", re.I)),
    # Hard white is a Plains crop priced off KC, not a Pacific soft white,
    # and it is tested before both white rules so neither can claim it.
    ("hdw",       re.compile(r"\b(hdw|hard\s*white)\b", re.I)),
    ("wheat-hrs", re.compile(r"\b(hrsw?|dns|dark\s*northern|mgex|mgx|spring)\b", re.I)),
    # "Soft 10.5% White" is the same crop with the protein written between
    # the two words; without the middle alternative it falls to unstated.
    ("sww",       re.compile(r"\b(sww|soft\s*white|soft\s*\d+(?:\.\d+)?%?\s*white|white\s*wheat|club)\b", re.I)),
    # hrww is an ordinary board abbreviation for hard red winter wheat, and
    # \bhrw\b could not match it -- the second w leaves no word boundary.
    ("wheat-hrw", re.compile(r"\b(hrww?|kcbt|kc|hard\s*red\s*winter)\b", re.I)),
    # NO BARE "soft". It does not name a class: it caught "WHEAT (SOFT)" and
    # would catch "Soft 10.5% White". A row that only says soft says nothing.
    ("wheat-srw", re.compile(r"\b(srw|soft\s*red)\b", re.I)),
]

# Which wheat this row is, read off the board's own words. Returns
# "wheat-srw", "wheat-hrw", "wheat-hrs", "durum", "sww", or None when the
# label names no class. Only the first three go on the map: durum and soft
# white have no contract among the three this page names, and a basis printed
# against an unnamed reference is the thing being fixed here.
def wheat_class(label):
    s = str(label or "")
    for name, rx in _WHEAT_RX:
        if rx.search(s):
            return name
    return None
# What the map actually publishes, after wheat is split by class. A pooled
# `wheat` block is deliberately absent: one wheat number is the bug this fixes.
MAP_COMMODITIES = ["corn", "soybeans", "wheat-srw", "wheat-hrw", "wheat-hrs",
                   "wheat-sww", "wheat-unstated"]
MIN_STATE_LOC = 2   # a state needs at least this many distinct locations to show

STATE_NAMES = {
 "AL":"Alabama","AK":"Alaska","AZ":"Arizona","AR":"Arkansas","CA":"California",
 "CO":"Colorado","CT":"Connecticut","DE":"Delaware","FL":"Florida","GA":"Georgia",
 "HI":"Hawaii","ID":"Idaho","IL":"Illinois","IN":"Indiana","IA":"Iowa","KS":"Kansas",
 "KY":"Kentucky","LA":"Louisiana","ME":"Maine","MD":"Maryland","MA":"Massachusetts",
 "MI":"Michigan","MN":"Minnesota","MS":"Mississippi","MO":"Missouri","MT":"Montana",
 "NE":"Nebraska","NV":"Nevada","NH":"New Hampshire","NJ":"New Jersey","NM":"New Mexico",
 "NY":"New York","NC":"North Carolina","ND":"North Dakota","OH":"Ohio","OK":"Oklahoma",
 "OR":"Oregon","PA":"Pennsylvania","RI":"Rhode Island","SC":"South Carolina",
 "SD":"South Dakota","TN":"Tennessee","TX":"Texas","UT":"Utah","VT":"Vermont",
 "VA":"Virginia","WA":"Washington","WV":"West Virginia","WI":"Wisconsin","WY":"Wyoming",
}

def resolve_bids_path():
    """The full feed, or a refusal. Never the slim file.

    fetch_bids.py stamps `full: true` on the complete payload and `full: false`
    on the browser copy. Reading the flag rather than the filename means a
    renamed or relocated file cannot sneak past this: what is checked is what
    the file says it is.
    """
    if os.path.exists(BIDS_FULL_PATH):
        return BIDS_FULL_PATH
    if os.path.exists(BIDS_PATH):
        with open(BIDS_PATH) as f:
            head = json.load(f)
        if head.get("full") is True:
            return BIDS_PATH
        n = len(head.get("bids") or [])
        raise SystemExit(
            f"[build_basis_map] REFUSING to run.\n"
            f"  {BIDS_FULL_PATH} is absent and {BIDS_PATH} is the slim browser\n"
            f"  copy ({n} bids, full=false). A national basis map built from it\n"
            f"  would average a handful of elevators per state and would look\n"
            f"  entirely plausible.\n"
            f"  This script must run in the SAME JOB as fetch_bids.py, which\n"
            f"  writes the full set to {BIDS_FULL_PATH}. See fetch_bids.yml."
        )
    raise SystemExit(f"[build_basis_map] no bids file at {BIDS_FULL_PATH} or {BIDS_PATH}")


def load_cash_bids(path=None):
    """Adapter over fetch_bids.py output. Returns basis records:
    {commodity, state, city, facility, name, basis}. Keeps only bids with a
    real basis value and a known state + tracked commodity."""
    path = path or resolve_bids_path()
    with open(path) as f:
        data = json.load(f)
    print(f"[build_basis_map] reading {path} "
          f"({len(data.get('bids') or []):,} bids, full={data.get('full')})")
    out = []
    for b in data.get("bids", []):
        cat   = (b.get("category") or "").strip().lower()
        state = (b.get("state") or "").strip().upper()
        basis = b.get("basis")
        if cat not in COMMODITIES:      continue
        if state not in STATE_NAMES:    continue
        if basis is None:               continue
        try:    basis = float(basis)
        except (TypeError, ValueError): continue
        # AUDIT 2026-08-11: unit/class sanity gate. Upstream rows sometimes
        # carry basis in cents (or belong to a different commodity class), and
        # one contaminated row poisons its state average AND the 'Strongest
        # basis' leaderboard. Grain basis in $/bu essentially never exceeds
        # ±$3.00; anything outside is a unit error, not a market.
        if abs(basis) > 3.0:
            continue
        city = (b.get("city") or "").strip()
        name = f"{city}, {state}" if city else (b.get("facility") or state)
        # WHEAT IS SPLIT HERE, where the record is made, so nothing
        # downstream can pool it again by accident. A row whose class the
        # board did not state is counted and never mapped.
        if cat == "wheat":
            wc = wheat_class(b.get("commodity"))
            if wc in ("wheat-srw", "wheat-hrw", "wheat-hrs"):
                cat = wc
            elif wc:
                cat = "wheat-" + wc
            else:
                cat = "wheat-unstated"
        out.append({"commodity": cat, "state": state, "city": city,
                    "facility": b.get("facility", ""), "name": name,
                    "basis": round(basis, 4)})
    return out

def build(records):
    commodities = {}
    withheld = {}
    for r in records:
        # Durum and hard white are the only two left off entirely: neither is
        # priced off any contract this map names, and between them they are a
        # handful of rows. Everything else is published under its own label.
        if r["commodity"] in ("wheat-durum", "wheat-hdw"):
            withheld[r["commodity"]] = withheld.get(r["commodity"], 0) + 1
    for c in MAP_COMMODITIES:
        recs = [r for r in records if r["commodity"] == c]
        # location-level average (dedupe repeated delivery rows at one place)
        loc = defaultdict(list); loc_state = {}
        for r in recs:
            loc[r["name"]].append(r["basis"]); loc_state[r["name"]] = r["state"]
        locations = [{"name": nm, "basis": round(sum(v)/len(v), 2), "_st": loc_state[nm]}
                     for nm, v in loc.items()]
        # state-level from location averages; n = distinct locations
        byst = defaultdict(list)
        for L in locations: byst[L["_st"]].append(L["basis"])
        states = [{"state": st, "name": STATE_NAMES[st],
                   "basis": round(sum(v)/len(v), 2), "n": len(v)}
                  for st, v in byst.items() if len(v) >= MIN_STATE_LOC]
        states.sort(key=lambda s: s["basis"], reverse=True)
        loclist = sorted(({"name": L["name"], "basis": L["basis"]} for L in locations),
                         key=lambda x: x["basis"], reverse=True)
        commodities[c] = {"futures_ref": FUTURES_REF[c],
                          "states": states, "locations": loclist}
    return commodities, withheld

def main():
    # resolve_bids_path() is the gate now: it refuses the slim browser copy
    # and says why. The old bare os.path.exists check would have passed the
    # slim file straight through.
    src = resolve_bids_path()
    records = load_cash_bids(src)
    commodities, withheld = build(records)
    has_data = any(commodities[c]["states"] for c in MAP_COMMODITIES)
    # AUDIT 2026-08-11: `updated` reflects the AGE OF THE BIDS, not the
    # build clock — rebuilding stale bids every 30 min used to relabel old
    # data as fresh. Falls back to build time only if bids carry no stamp.
    _src_ts = None
    try:
        with open(src) as _f:
            _src_ts = (json.load(_f).get("fetched") or "")[:10] or None
    except Exception:
        pass
    out = {"updated": _src_ts or datetime.now(timezone.utc).strftime("%Y-%m-%d"),
           "sample": (not has_data),
           "commodities": commodities,
           # Beside `commodities`, not inside it: every value in there is
           # {futures_ref, states, locations} and a consumer that iterates
           # the dict should not meet something else.
           "withheld": withheld}
    os.makedirs(os.path.dirname(OUT_PATH) or ".", exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    total_states = sum(len(commodities[c]["states"]) for c in MAP_COMMODITIES)
    print(f"[basis-map] {len(records)} basis records -> {total_states} state rows")
    for c in MAP_COMMODITIES:
        print(f"  {c}: {len(commodities[c]['states'])} states, "
              f"{len(commodities[c]['locations'])} locations")
    # The rows that carry a basis and are deliberately not on the map.
    for k, n in sorted(withheld.items()):
        print(f"  withheld {k}: {n} records (priced off no contract this map names)")
    print(f"[basis-map] sample={out['sample']} -> wrote {OUT_PATH}")

if __name__ == "__main__":
    main()
