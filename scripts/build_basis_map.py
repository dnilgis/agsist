#!/usr/bin/env python3
"""
build_basis_map.py — National basis map for the AGSIST cash-bids page.

Reads data/bids.json (produced by fetch_bids.py from Barchart OnDemand),
aggregates the Barchart-provided `basis` ($/bu, cash minus nearby futures)
by location -> state -> commodity for corn, soybeans, and wheat, and writes
data/basis-map.json, consumed by the "National Basis" section of cash-bids.html.

Barchart returns `basis` directly on each bid, so no futures lookup or
cents conversion is needed here. No API key required — this runs on the
already-fetched bids.json. In a GitHub Action, run it right after fetch_bids.py.
"""
import json, os, sys
from datetime import datetime, timezone
from collections import defaultdict

BIDS_PATH = "data/bids.json"
OUT_PATH  = "data/basis-map.json"
COMMODITIES = ["corn", "soybeans", "wheat"]
FUTURES_REF = {"corn": "nearby CBOT futures",
               "soybeans": "nearby CBOT futures",
               "wheat": "nearby CBOT wheat"}
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

def load_cash_bids(path=BIDS_PATH):
    """Adapter over fetch_bids.py output. Returns basis records:
    {commodity, state, city, facility, name, basis}. Keeps only bids with a
    real basis value and a known state + tracked commodity."""
    with open(path) as f:
        data = json.load(f)
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
        city = (b.get("city") or "").strip()
        name = f"{city}, {state}" if city else (b.get("facility") or state)
        out.append({"commodity": cat, "state": state, "city": city,
                    "facility": b.get("facility", ""), "name": name,
                    "basis": round(basis, 4)})
    return out

def build(records):
    commodities = {}
    for c in COMMODITIES:
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
    return commodities

def main():
    if not os.path.exists(BIDS_PATH):
        print(f"ERROR: {BIDS_PATH} not found — run fetch_bids.py first", file=sys.stderr)
        sys.exit(1)
    records = load_cash_bids()
    commodities = build(records)
    has_data = any(commodities[c]["states"] for c in COMMODITIES)
    out = {"updated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
           "sample": (not has_data),
           "commodities": commodities}
    os.makedirs(os.path.dirname(OUT_PATH) or ".", exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    total_states = sum(len(commodities[c]["states"]) for c in COMMODITIES)
    print(f"[basis-map] {len(records)} basis records -> {total_states} state rows")
    for c in COMMODITIES:
        print(f"  {c}: {len(commodities[c]['states'])} states, "
              f"{len(commodities[c]['locations'])} locations")
    print(f"[basis-map] sample={out['sample']} -> wrote {OUT_PATH}")

if __name__ == "__main__":
    main()
