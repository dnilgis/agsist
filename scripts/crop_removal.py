#!/usr/bin/env python3
"""
The one crop-removal table every script prices a fertility bill with.

P2O5 and K2O per bushel come from components/nutrient-removal.js (UW
Extension A2809, Table 4.2, grain removal), the table /nutrient-removal
prints and /fertilizer quotes. This module reads that file instead of keeping
a second copy: on Oct 17, 2026 scripts/build_fert_prices.py still carried
older rates (corn 0.37 / 0.24, soybeans 0.80 / 1.30, wheat 0.50 / 0.30), and
/breakeven priced 57 lb K2O for 237 bu of corn where A2809 gives 69.

N per bushel is not a removal figure (A2809 gives none). N_RATE is the
yield-goal N budget estimate fertilizer.html CROPS uses (nRate) and labels as
an estimate, not a rate recommendation: corn 0.90, wheat 1.20, soybeans 0
(they fix their own). The shared price file's programs use it too.

/breakeven does not price corn N that way any more (2026-10-19 money audit 1:
0.90 lb a bushel put 213 lb N on 237 bu, against A2809's own MRTN of 120 after
soybeans, and no source said 0.90). corn_n() gives its corn N instead: the
A2809 Table 6.1 MRTN rate, read by components/a2809.js nRate() itself (run
under node, so there is one copy of the table and of its column rule), at the
N:corn ratio /fast-facts opens with: anhydrous when a co-op posts it, else
urea, against next December's corn futures (this December's before August).

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
A2809_JS = ROOT / "components" / "a2809.js"
# /breakeven's budgets are farmdoc's Illinois corn after soybeans (50-50
# rotation), so the matching Table 6.1 row is high-yield loamy, after soybean.
CORN_N_ROW = "hi_soy"
# N forms /fast-facts' N box can open on, in its order (components/fast-facts.js:
# "starts on anhydrous when a co-op posts it, else urea"): key, % N, name
N_FORMS = (("anhydrous", 0.82, "anhydrous"), ("urea", 0.46, "urea"))

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


def posted_corn(quotes, today):
    """The corn futures /fast-facts' N box uses (components/fast-facts.js
    newCropKey): next December from August on, this December before, else
    the first later December on file. today is a date (Central time).
    {usd, label, date} or None."""
    want = (today.year + 1 if today.month >= 8 else today.year) % 100
    best = None
    for k, x in (quotes or {}).items():
        m = re.match(r"^corn-dec(\d{2})$", k)
        if not m or not x or not x.get("close") or int(m.group(1)) < want:
            continue
        if best is None or int(m.group(1)) < best[0]:
            best = (int(m.group(1)), x)
    if not best:
        return None
    return {"usd": float(best[1]["close"]) / 100, "label": "Dec '%02d" % best[0], "date": best[1].get("close_date") or ""}


def n_price(prices):
    """The N price /fast-facts' box opens on, from data/fertilizer-prices.json
    prices: {key, name, ton, usd ($/lb N), label, as_of} or None."""
    rows = {r.get("key"): r for r in (prices or []) if r.get("price")}
    for key, pct, name in N_FORMS:
        r = rows.get(key)
        if r:
            return {"key": key, "name": name, "pct": pct, "ton": float(r["price"]), "usd": float(r["price"]) / (2000 * pct),
                    "label": r.get("src_label") or "", "as_of": r.get("as_of") or ""}
    return None


def a2809_rate(row, ratio, js_path=None):
    """components/a2809.js nRate({row, ratio}) run under node: {rate, lo, hi,
    col, off, soil, prev} or None. Raises when node is missing: a builder
    must not publish a rate it could not read."""
    import subprocess
    code = ("const A=require(process.argv[1]);"
            "process.stdout.write(JSON.stringify(A.nRate({row:process.argv[2],ratio:+process.argv[3]})))")
    out = subprocess.run(["node", "-e", code, str(js_path or A2809_JS), row, repr(float(ratio))],
                         check=True, capture_output=True, text=True).stdout
    return json.loads(out) if out.strip() else None


def corn_n(n, corn, js_path=None):
    """Corn N for /breakeven: the A2809 Table 6.1 rate after soybeans at the
    posted N:corn ratio, plus the after-corn rate in the same column.
    n from n_price(), corn from posted_corn(). None when either is missing."""
    if not n or not corn or not (n["usd"] > 0) or not (corn["usd"] > 0):
        return None
    ratio = n["usd"] / corn["usd"]
    r = a2809_rate(CORN_N_ROW, ratio, js_path)
    if not r:
        return None
    rc = a2809_rate("hi_corn", ratio, js_path)
    return {"lb": r["rate"], "lo": r["lo"], "hi": r["hi"], "col": r["col"], "off": r["off"], "ratio": ratio,
            "after_corn": rc["rate"] if rc else None, "n": n, "corn": corn}


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
    # Corn N at the posted ratio, worked by hand against A2809 Table 6.1
    # (test/fast-facts-nrate.test.mjs has the same cells):
    #   anhydrous $832.10 / (2,000 x 82%) = $0.5074 a lb of N; Dec '27 $5.0675:
    #   0.5074 / 5.0675 = 0.100 -> the 0.10 column: 120 (105-130) after
    #   soybean, 165 after corn.
    import datetime
    q = {"corn-dec26": {"close": 474.25, "close_date": "2026-10-16"}, "corn-dec27": {"close": 506.75, "close_date": "2026-10-16"},
         "corn-dec28": {"close": 508.0}}
    c = posted_corn(q, datetime.date(2026, 10, 19))
    assert c == {"usd": 5.0675, "label": "Dec '27", "date": "2026-10-16"}, c
    assert posted_corn(q, datetime.date(2026, 7, 31))["label"] == "Dec '26"
    assert posted_corn({"corn-dec26": q["corn-dec26"]}, datetime.date(2026, 10, 19)) is None
    pr = [{"key": "urea", "price": 615.95}, {"key": "anhydrous", "price": 832.1, "as_of": "2026-10-06"}]
    n = n_price(pr)
    assert n["key"] == "anhydrous" and abs(n["usd"] - 832.1 / 1640) < 1e-9, n
    assert n_price(pr[:1])["key"] == "urea" and n_price([]) is None
    cn = corn_n(n, c)
    assert (cn["lb"], cn["lo"], cn["hi"], cn["col"], cn["off"], cn["after_corn"]) == (120, 105, 130, 0.1, False, 165), cn
    # urea only: $615.95 / 920 = $0.6695; / 5.0675 = 0.132 -> 0.15 column: 105 (95-115), 150 after corn
    cu = corn_n(n_price(pr[:1]), c)
    assert (cu["lb"], cu["lo"], cu["hi"], cu["col"], cu["after_corn"]) == (105, 95, 115, 0.15, 150), cu
    assert corn_n(None, c) is None and corn_n(n, None) is None
    print("selftest ok")
    return 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    print(json.dumps(per_bu()))
