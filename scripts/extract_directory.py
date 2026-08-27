#!/usr/bin/env python3
"""
extract_directory.py — keep the elevators, drop the prices.

WHY

Sig, 2026-08-27: "i have a feeling that i wont be continuing my barchart api
subscription when it comes up for renewal ... i want a complete directory of
every elevator in the country ... whoever we cant get, i want a list of them."

The prices in that feed are licensed and they stop when the subscription does.
The DIRECTORY -- that a business called X operates a facility called Y in town
Z -- is a fact about the world, it is what we need to know who is out there,
and once written down it does not expire. So this walks the feed and writes out
the who and the where, and nothing else. No cash price, no basis, no futures
symbol, no delivery window. Nothing that is theirs to sell.

WHY IT LIVES IN AGSIST

Because the key lives here, and the full national pull -- 18,646 bids across
407 facilities on 2026-08-27 -- is written here and gitignored here. Pulling
the licensed feed into the public bids repository to do this would republish it
from a second place. The small directory this writes is what crosses over.

IT PREFERS THE FULL FILE AND SAYS WHEN IT DID NOT GET IT. bids.json is a slim
50-ZIP sample and yields about forty facilities; bids-full.json is the national
sweep and yields hundreds. A run that quietly used the sample would report a
tenth of the country as if it were the country.
"""
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FULL = ROOT / "bids-full.json"
SLIM = ROOT / "data" / "bids.json"
OUT = ROOT / "data" / "elevator-directory.json"

# Everything else in a row is price data and is deliberately left behind.
KEEP = ("facility", "branch", "city", "state", "zip", "phone")


def rows_from(path):
    d = json.loads(path.read_text())
    if isinstance(d, list):
        return d
    for k in ("bids", "rows", "full"):
        v = d.get(k)
        if isinstance(v, list):
            return v
    return []


def main():
    src = FULL if FULL.exists() else SLIM
    if not src.exists():
        print("FATAL: neither %s nor %s is present" % (FULL.name, SLIM.name), file=sys.stderr)
        return 1
    rows = rows_from(src)
    if not rows:
        print("FATAL: %s parsed to zero rows" % src.name, file=sys.stderr)
        return 1

    facilities = {}
    for r in rows:
        if not isinstance(r, dict):
            continue
        city, st = (r.get("city") or "").strip(), (r.get("state") or "").strip().upper()
        if not city or not st:
            continue
        # A facility is a company AND a site. "CHS" alone is two hundred
        # businesses and "Council Bluffs" is two different companies' yards, so
        # neither half identifies a place on its own.
        key = (r.get("facility") or "").strip(), (r.get("branch") or "").strip(), city, st
        e = facilities.setdefault(key, {k: (r.get(k) or "") for k in KEEP})
        # Take the first non-empty of anything the later rows fill in.
        for k in KEEP:
            if not e.get(k) and r.get(k):
                e[k] = r[k]

    out = []
    for (fac, br, city, st), e in sorted(facilities.items()):
        out.append({
            "operator": fac or None,
            "branch": br or None,
            "location": city,
            "state": st,
            "zip": (str(e.get("zip") or "")[:5] or None),
            "phone": e.get("phone") or None,
            "source": "barchart",
        })

    OUT.write_text(json.dumps({
        "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "from": src.name,
        "complete": src is FULL,
        "note": ("Directory only: who operates a facility and where. No prices, no basis, "
                 "no symbols. " + ("National sweep." if src is FULL else
                 "Built from the SLIM 50-ZIP sample, so this is a fraction of the country — "
                 "run this beside the full fetch to get all of it.")),
        "counts": {"facilities": len(out),
                   "states": len({e["state"] for e in out}),
                   "rows_read": len(rows)},
        "elevators": out,
    }, indent=1) + "\n")

    print("%s -> %d facilities in %d states (from %d rows)%s"
          % (src.name, len(out), len({e["state"] for e in out}), len(rows),
             "" if src is FULL else "  ** SLIM SAMPLE, not the country **"))
    print("wrote", OUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
