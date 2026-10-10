"""Grain price text for the build: the Python twin of components/util.js AG.px.

A page's seed (the price baked into the HTML) and the price its script prints
after load must be the same characters, or the number changes in front of the
reader. So the build prints grain prices with exactly the rules the browser
uses, and test/pricefmt.test.mjs runs both on the same inputs and compares.

Rules (same as util.js):
  - grains print to the quarter cent: 480.5 -> "$4.80½"
  - rounding is done once, on quarter-cents, after stripping float noise
  - a 52-week low rounds DOWN and a high rounds UP (never inward)
  - style "glyph" ($4.80½) or "slash" ($4.80 1/2)
  - a minus is U+2212; zero carries no sign
Inputs are cents per bushel.

    python3 scripts/pricefmt.py --selftest
"""
import math
import sys

GLYPH = ["", "¼", "½", "¾"]
SLASH = ["", "1/4", "1/2", "3/4"]
MINUS = "−"


def _js_round(x):
    """Math.round: halves go toward +infinity."""
    return math.floor(x + 0.5)


def quarters(c, mode=None):
    x = float(c) * 4
    r = _js_round(x * 1e6) / 1e6
    if mode == "down":
        return int(math.floor(r))
    if mode == "up":
        return int(math.ceil(r))
    return int(-_js_round(-r)) if r < 0 else int(_js_round(r))


def _ok(v):
    if v is None or v == "":
        return False
    try:
        return math.isfinite(float(v))
    except (TypeError, ValueError):
        return False


def price(c, style="glyph", mode=None, frac_class=None, dollar=True):
    if not _ok(c):
        return ""
    q = quarters(c, mode)
    a = abs(q)
    whole, f = a // 4, a % 4
    d, cc = whole // 100, whole % 100
    fr = ""
    if f:
        fr = (" " + SLASH[f]) if style == "slash" else GLYPH[f]
        if frac_class:
            fr = '<span class="%s">%s</span>' % (frac_class, fr)
    return (MINUS if q < 0 else "") + ("$" if dollar else "") + "%d.%02d" % (d, cc) + fr


def move(c, style="glyph", sign=False, cent=True):
    if not _ok(c):
        return ""
    q = quarters(c)
    a = abs(q)
    whole, f = a // 4, a % 4
    fr = (SLASH[f] if style == "slash" else GLYPH[f]) if f else ""
    body = (str(whole) if (whole or not fr) else "") + (" " if (whole and fr and style == "slash") else "") + fr
    sg = ("+" if q > 0 else (MINUS if q < 0 else "")) if sign else ""
    return sg + body + ("¢" if cent else "")


def _to_fixed(v, n):
    """Number.prototype.toFixed: exact binary value, ties away from zero."""
    from decimal import Decimal, ROUND_HALF_UP
    return str(Decimal(float(v)).quantize(Decimal(1).scaleb(-n), rounding=ROUND_HALF_UP))


def pct(p, dp=2):
    if not _ok(p):
        return ""
    n = float(p)
    t = _to_fixed(abs(n), dp)
    if float(t) == 0:
        return t + "%"
    return ("+" if n > 0 else MINUS) + t + "%"


def change(net, pc, style="glyph", dp=2, sep=None, arrow=True):
    if not _ok(net):
        return ("", "nc")
    q = quarters(net)
    if q == 0:
        return ("unch", "nc")
    ar = ("▲ " if q > 0 else "▼ ") if arrow else ""
    mv = move(net, style=style, sign=True)
    pt = pct(pc, dp) if _ok(pc) else ""
    tail = ((sep + pt) if sep is not None else " (" + pt + ")") if pt else ""
    return (ar + mv + tail, "up" if q > 0 else "dn")


def range_ends(lo, hi, style="glyph"):
    return (price(lo, style=style, mode="down"), price(hi, style=style, mode="up"))


def _selftest():
    assert price(480.5) == "$4.80½"
    assert price(480.5, style="slash") == "$4.80 1/2"
    assert price(480.49999999) == "$4.80½"
    assert price(4.805 * 100) == "$4.80½"
    assert price(1292.25) == "$12.92¼"
    assert price(5) == "$0.05"
    assert price(None) == "" and price(0) == "$0.00"
    assert range_ends(410.3, 512.6) == ("$4.10¼", "$5.12¾")
    assert range_ends(410.25, 512.75) == ("$4.10¼", "$5.12¾")
    assert move(19.75) == "19¾¢"
    assert move(-19.75, sign=True) == MINUS + "19¾¢"
    assert move(20.75, style="slash") == "20 3/4¢"
    assert move(0.5, style="slash") == "1/2¢"
    assert pct(-3.951) == MINUS + "3.95%"
    assert pct(0.001) == "0.00%"
    assert pct(0.125) == "+0.13%"
    assert change(-19.75, -3.95) == ("▼ " + MINUS + "19¾¢ (" + MINUS + "3.95%)", "dn")
    assert change(0, 0) == ("unch", "nc")
    print("pricefmt selftest ok")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        _selftest()
    elif "--json" in sys.argv:
        # used by test/pricefmt.test.mjs to compare with util.js
        import json
        cases = json.loads(sys.stdin.read())
        out = []
        for c in cases:
            fn, args, kw = c["fn"], c.get("args", []), c.get("kw", {})
            r = {"price": price, "move": move, "pct": pct, "change": change, "range": range_ends}[fn](*args, **kw)
            out.append(list(r) if isinstance(r, tuple) else r)
        print(json.dumps(out))
