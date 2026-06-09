#!/usr/bin/env python3
"""
build_basis_map.py  -  AGSIST basis heatmap pipeline.

Reads your cash-bid locations, computes basis = cash - futures for each, aggregates
by state, and writes data/basis-map.json (what /basis-map reads).

THE ONE ADAPTER POINT: load_cash_bids() below. Point it at whatever your cash-bids
pipeline already produces (the Barchart OnDemand pull). It must return a flat list of
records, one per location/commodity, each a dict with:
    commodity : "corn" | "soybeans" | "wheat"
    state     : 2-letter postal code, e.g. "IA"
    name      : display location, e.g. "Mason City, IA"
    cash      : cash bid ($/bu, float)
    futures   : the nearby futures price the bid is quoted against ($/bu, float)
Everything downstream is generic and needs no changes.
"""

import json
import os
import datetime as dt
from collections import defaultdict

DATA_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "basis-map.json")

STATE_NAMES = {
    "AL": "Alabama", "AR": "Arkansas", "CO": "Colorado", "GA": "Georgia",
    "IA": "Iowa", "IL": "Illinois", "IN": "Indiana", "KS": "Kansas",
    "KY": "Kentucky", "MI": "Michigan", "MN": "Minnesota", "MO": "Missouri",
    "MT": "Montana", "NC": "North Carolina", "ND": "North Dakota", "NE": "Nebraska",
    "OH": "Ohio", "OK": "Oklahoma", "SD": "South Dakota", "TN": "Tennessee",
    "TX": "Texas", "WI": "Wisconsin",
}

# nearby futures label shown on the page, per commodity (cosmetic only)
FUTURES_REF = {
    "corn": "nearby CBOT",
    "soybeans": "nearby CBOT",
    "wheat": "nearby KC HRW",
}


def load_cash_bids():
    """ADAPTER -- replace this with a read of your real cash-bids data.

    Example shape of what it should return:
        [{"commodity":"corn","state":"IA","name":"Mason City, IA",
          "cash":4.32,"futures":4.50}, ...]
    """
    raise NotImplementedError(
        "Point load_cash_bids() at your Barchart cash-bids output. "
        "Until then, data/basis-map.json keeps its seeded sample."
    )


def build(records):
    by_c = defaultdict(list)
    for r in records:
        try:
            basis = round(float(r["cash"]) - float(r["futures"]), 2)
        except (KeyError, TypeError, ValueError):
            continue
        by_c[r["commodity"]].append({"state": r["state"], "name": r.get("name", ""), "basis": basis})

    commodities = {}
    for c, rows in by_c.items():
        st_acc = defaultdict(list)
        for row in rows:
            st_acc[row["state"]].append(row["basis"])
        states = []
        for st, vals in st_acc.items():
            states.append({
                "state": st,
                "name": STATE_NAMES.get(st, st),
                "basis": round(sum(vals) / len(vals), 2),
                "n": len(vals),
            })
        states.sort(key=lambda s: s["basis"], reverse=True)
        locations = sorted(rows, key=lambda x: x["basis"], reverse=True)
        commodities[c] = {
            "futures_ref": FUTURES_REF.get(c, "nearby futures"),
            "states": states,
            "locations": [{"name": x["name"], "basis": x["basis"]} for x in locations if x["name"]],
        }
    return commodities


def main():
    records = load_cash_bids()
    out = {
        "updated": dt.date.today().isoformat(),
        "sample": False,
        "commodities": build(records),
    }
    os.makedirs(os.path.dirname(DATA_PATH), exist_ok=True)
    with open(DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print(f"wrote {DATA_PATH}")


if __name__ == "__main__":
    main()
