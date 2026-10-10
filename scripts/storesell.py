"""The store-or-sell calculation for the build: the Python twin of
components/storesell.js (window.AgsistStoreSell carryNet / holdLine).

The town pages (scripts/build_cash_bid_pages.py) bake a "Hold to Jan?" line
from each elevator's own posted later bid; the browser prints the same line on
store-or-sell.html, the futures pages and the cash bids page. The two must say
the same thing, so test/storesell.test.mjs runs both on the same inputs and
compares the characters.

    carry    = later posted (or futures) price - nearest one, $/bu
    storage  = cost x months                     (default 3.5 cents a month)
    interest = spot x rate% x months / 12        (default 7% a year)
    shrink   = shrink% x (spot + carry)          (default 0%)
    net      = carry - storage - interest - shrink

    python3 scripts/storesell.py --selftest
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pricefmt  # noqa: E402

DEFAULTS = {"cost": 0.035, "rate": 7, "shrink": 0}
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _js_round(x):
    return int(math.floor(x + 0.5))


def _num(v):
    try:
        return v is not None and math.isfinite(float(v))
    except (TypeError, ValueError):
        return False


def with_defaults(inputs=None):
    inputs = inputs or {}
    o = {"assumed": []}
    for k in ("cost", "rate", "shrink"):
        v = inputs.get(k)
        if not _num(v):
            o[k] = DEFAULTS[k]
            o["assumed"].append(k)
        else:
            o[k] = float(v)
    return o


def carry_net(spot, carry, months, inputs):
    inputs = inputs or {}
    out = {"carry": carry, "months": months, "storage": None, "interest": None, "shrink": None, "net": None}
    if not _num(inputs.get("cost")):
        return out
    out["storage"] = inputs["cost"] * months
    out["interest"] = 0 if inputs.get("rate") is None else spot * (inputs["rate"] / 100) * months / 12
    out["shrink"] = 0 if inputs.get("shrink") is None else (inputs["shrink"] / 100) * (spot + carry)
    out["net"] = carry - out["storage"] - out["interest"] - out["shrink"]
    return out


def net_cents(d):
    return _js_round(d * 100)


def net_text(d):
    c = net_cents(d)
    return "0¢" if c == 0 else ("+" if c > 0 else "−") + str(abs(c)) + "¢"


def carry_text(d):
    c = d * 100
    if pricefmt.quarters(c) == 0:
        return "even"
    return pricefmt.move(c, style="slash", sign=True)


def cash_q(d):
    return pricefmt.price(d * 100, style="slash")


def cents_word(d):
    c = _js_round(d * 1000) / 10
    return (str(int(c)) if c % 1 == 0 else f"{c:.1f}") + "¢"


def _pct(v):
    """A percent the way JavaScript prints a number: 7 not 7.0."""
    return str(int(v)) if float(v) == int(v) else repr(float(v))


def hold_line(to, carry, months, spot, kind="posted", inputs=None):
    inputs = inputs or with_defaults({})
    n = carry_net(spot, carry, months, inputs)
    c = net_cents(n["net"])
    what = " futures carry" if kind == "futures" else " posted carry"
    costs = "storage and interest" + (" and shrink" if inputs.get("shrink") else "")
    ct = carry_text(carry)
    return (f"Hold to {to}? {'0¢' if ct == 'even' else ct}{what}, net of {costs}: "
            + ("about even" if c == 0 else net_text(n["net"])) + " a bushel.")


def cost_note(inputs, months, spot=None):
    inputs = inputs or with_defaults({})
    a = inputs.get("assumed") or []
    lead = "storage" if months is None else f"{months} month{'' if months == 1 else 's'} of storage"
    parts = [f"{lead} at {cents_word(inputs['cost'])} a month"
             + (" (default)" if "cost" in a else ""),
             f"interest at {_pct(inputs['rate'])}% a year" + (f" on {cash_q(spot)}" if spot is not None else "")
             + (" (default)" if "rate" in a else "")]
    if inputs.get("shrink"):
        parts.append(f"{_pct(inputs['shrink'])}% shrink" + (" (default)" if "shrink" in a else ""))
    else:
        parts.append("no shrink" + (" (default)" if "shrink" in a else ""))
    return ", ".join(parts) + "."


def _ym(k):
    import re
    m = re.fullmatch(r"(\d{4})-(\d{2})", str(k or ""))
    return (int(m.group(1)), int(m.group(2))) if m else None


def months_apart(a, b):
    x, y = _ym(a), _ym(b)
    return (y[0] - x[0]) * 12 + (y[1] - x[1]) if x and y else None


def new_crop_from(k, crop):
    """storesell.js newCropFrom: September for corn and soybeans, June for wheat and oats."""
    x = _ym(k)
    if not x:
        return ""
    ncm = 6 if crop in ("wheat", "oats", "barley") else 9
    y = x[0] if x[1] < ncm else x[0] + 1
    return f"{y}-{ncm:02d}"


def build_periods(rows, crop):
    """storesell.js buildPeriods: rows [{start, end, cash}] for one elevator and
    crop. The nearest start is "now"; a later period starts after it ends and
    before next year's crop. Same start month keeps the higher cash."""
    by = {}
    for r in rows or []:
        if not r or not _ym(r.get("start")) or not _num(r.get("cash")) or r["cash"] <= 0:
            continue
        end = r["end"] if _ym(r.get("end")) and r["end"] >= r["start"] else r["start"]
        o = by.get(r["start"])
        if not o or r["cash"] > o["cash"]:
            by[r["start"]] = {"start": r["start"], "end": end, "cash": r["cash"]}
    keys = sorted(by)
    if not keys:
        return None
    spot, later, dropped = by[keys[0]], [], []
    cut = new_crop_from(spot["start"], crop)
    for k in keys[1:]:
        p = by[k]
        if p["start"] <= spot["end"]:
            continue
        if cut and p["start"] >= cut:
            dropped.append(p["start"])
            continue
        later.append({"key": p["start"], "cash": p["cash"], "months": months_apart(spot["start"], p["start"]),
                      "carry": p["cash"] - spot["cash"]})
    return {"spot": spot, "later": later, "newCrop": dropped}


def pick_period(model, inputs):
    """storesell.js pickPeriod without a reader's pick: the best net; ties go
    to the earlier month."""
    best, bv = None, -math.inf
    for p in (model or {}).get("later") or []:
        n = carry_net(model["spot"]["cash"], p["carry"], p["months"], inputs)["net"]
        v = p["carry"] if n is None else n
        if v > bv + 1e-9:
            best, bv = p, v
    return best


def short_mon(k):
    x = _ym(k)
    return f"{MON[x[1] - 1]} '{str(x[0])[2:]}" if x else ""


def _selftest():
    d = with_defaults({})
    assert d["cost"] == 0.035 and d["rate"] == 7 and d["shrink"] == 0 and d["assumed"] == ["cost", "rate", "shrink"]
    # Cadott Grain corn, Oct 9 2026: Harvest $4.18, Jan '27 $4.23, 3 months.
    n = carry_net(4.18, 0.05, 3, d)
    assert abs(n["net"] - (0.05 - 0.105 - 4.18 * 0.07 * 3 / 12)) < 1e-12, n
    assert hold_line("Jan", 0.05, 3, 4.18, inputs=d) == "Hold to Jan? +5¢ posted carry, net of storage and interest: −13¢ a bushel."
    assert cost_note(d, 3, 4.18) == "3 months of storage at 3.5¢ a month (default), interest at 7% a year on $4.18 (default), no shrink (default)."
    # the futures pages' old verdict: Dec '26 to Jul '27 corn, +17.75c over 7 months,
    # "storing makes sense" at 3.5c with no interest; with interest it loses.
    n2 = carry_net(4.805, 0.1775, 7, d)
    assert n2["net"] < 0, n2
    assert cost_note(d, None) == "storage at 3.5¢ a month (default), interest at 7% a year (default), no shrink (default)."
    assert carry_text(0.0025) == "+1/4¢" and carry_text(0) == "even"
    assert hold_line("Nov", 0, 1, 12.0, inputs=d).startswith("Hold to Nov? 0¢ posted carry")
    # build_periods / pick_period: nearest Oct, later Jan and Mar, Oct '27 is new crop
    m = build_periods([{"start": "2026-10", "end": "2026-10", "cash": 4.18},
                       {"start": "2027-01", "end": "2027-01", "cash": 4.23},
                       {"start": "2027-03", "end": "2027-03", "cash": 4.40},
                       {"start": "2027-10", "end": "2027-11", "cash": 4.50}], "corn")
    assert [p["key"] for p in m["later"]] == ["2027-01", "2027-03"] and m["newCrop"] == ["2027-10"], m
    # Jan: .05-.105-.0732=-.128; Mar: .22-.175-.1219=-.077 -> Mar nets the most
    assert pick_period(m, d)["key"] == "2027-03"
    assert short_mon("2027-03") == "Mar '27" and months_apart("2026-10", "2027-03") == 5
    print("storesell selftest ok")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        _selftest()
    elif "--json" in sys.argv:
        cases = json.loads(sys.stdin.read())
        out = []
        for c in cases:
            inp = with_defaults(c.get("inputs"))
            if "rows" in c:
                m = build_periods(c["rows"], c["crop"])
                pk = pick_period(m, inp) if m else None
                out.append({"later": [p["key"] for p in m["later"]] if m else None,
                            "newCrop": m["newCrop"] if m else None, "pick": pk["key"] if pk else None,
                            "note": cost_note(inp, None)})
                continue
            out.append({"line": hold_line(c["to"], c["carry"], c["months"], c["spot"], c.get("kind", "posted"), inp),
                        "note": cost_note(inp, c["months"], c["spot"]),
                        "net": carry_net(c["spot"], c["carry"], c["months"], inp)["net"]})
        print(json.dumps(out))
