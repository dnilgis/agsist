#!/usr/bin/env python3
"""
The one crop-removal table every script prices a fertility bill with.

P2O5 and K2O per bushel come from components/nutrient-removal.js (UW
Extension A2809, Table 4.2, grain removal), the table /nutrient-removal
prints and /fertilizer quotes. This module reads that file instead of keeping
a second copy: on Oct 17, 2026 scripts/build_fert_prices.py still carried
older rates (corn 0.37 / 0.24, soybeans 0.80 / 1.30, wheat 0.50 / 0.30), and
/breakeven priced 57 lb K2O for 237 bu of corn where A2809 gives 69.

N per bushel is not a removal figure (A2809 gives none). It is the program's
own N rate, the same one fertilizer.html CROPS uses (nRate): corn 0.90,
wheat 1.20, soybeans 0 (they fix their own). A stated assumption, not advice.

test/crop-removal-one-table.test.mjs holds fertilizer.html, breakeven.html and
this module to the same numbers.

    python3 scripts/crop_removal.py            # prints the table
    python3 scripts/crop_removal.py --selftest
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "components" / "nutrient-removal.js"

# program crop -> the nutrient-removal.js row id
ROWS = {"corn": "corn_grain", "soybeans": "soy_grain", "wheat": "wheat_grain"}
# lb N a bushel the program applies (not removal; see above)
N_RATE = {"corn": 0.90, "soybeans": 0.0, "wheat": 1.20}


def parse(js):
    """{row id: (p2o5, k2o)} for the grain rows of nutrient-removal.js."""
    out = {}
    for rid in ROWS.values():
        m = re.search(r"\{\s*id:\s*'" + re.escape(rid) + r"'[^}]*?\bp:\s*([\d.]+),\s*k:\s*([\d.]+)", js)
        if not m:
            raise ValueError("nutrient-removal.js has no " + rid + " row with p and k")
        out[rid] = (float(m.group(1)), float(m.group(2)))
    return out


def per_bu(js=None):
    """{crop: (n, p2o5, k2o)} lb a bushel."""
    rows = parse(js if js is not None else SRC.read_text())
    return {crop: (N_RATE[crop],) + rows[rid] for crop, rid in ROWS.items()}


def selftest():
    js = ("{ id: 'corn_grain', group: 'Corn', basis: 'bu', p: 0.38, k: 0.29, n: null },"
          "{ id: 'soy_grain', basis: 'bu', p: 0.8, k: 1.4 },{ id: 'wheat_grain', p: 0.5, k: 0.35 }")
    assert per_bu(js) == {"corn": (0.9, 0.38, 0.29), "soybeans": (0.0, 0.8, 1.4), "wheat": (1.2, 0.5, 0.35)}
    try:
        per_bu("{ id: 'corn_grain', p: 0.38 }")
        raise AssertionError("a missing row must refuse")
    except ValueError:
        pass
    live = per_bu()
    # A2809 Table 4.2, hand-checked against refs/uw-a2809-2026.txt on Oct 17, 2026
    assert live == {"corn": (0.9, 0.38, 0.29), "soybeans": (0.0, 0.8, 1.4), "wheat": (1.2, 0.5, 0.35)}, live
    print("selftest ok")
    return 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    print(json.dumps(per_bu()))
