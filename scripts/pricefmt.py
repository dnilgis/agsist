"""Grain price text for the build: the Python twin of components/util.js AG.px.

Also cash() (a bid as posted), basis() (signed cents, "even" at zero) and
contract() ("Dec '26"), each the twin of the util.js function of that name.

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


def cash(v, dollar=True):
    """A cash bid as the elevator posted it, in dollars: 4.2125 -> "$4.2125",
    12.475 -> "$12.475", 4.2 -> "$4.20". Twin of util.js AG.px.cash."""
    if not _ok(v):
        return ""
    n = float(v)
    r = _js_round(abs(n) * 10000) / 10000
    s = _to_fixed(r, 4).rstrip("0")
    if len(s) - s.index(".") - 1 < 2:
        s = _to_fixed(r, 2)
    return (MINUS if n < 0 and r else "") + ("$" if dollar else "") + s


def _num_text(a):
    """JS String(number) for a value already rounded to two places."""
    return ("%.2f" % a).rstrip("0").rstrip(".") if a != int(a) else str(int(a))


def basis(c, contract=None):
    """Basis in signed cents: -65 -> "−65¢", 12.5 -> "+12½¢", 0 -> "even".
    contract appends the month: "−65¢ Dec '26". Twin of util.js AG.px.basis."""
    if not _ok(c):
        return ""
    n = float(c)
    a = _js_round(abs(n) * 100) / 100
    if a == 0:
        body = "even"
    else:
        q = _js_round(a * 4 * 1e6) / 1e6
        if q == math.floor(q):
            q = int(q)
            w, f = q // 4, q % 4
            body = (str(w) if (w or not f) else "") + GLYPH[f]
        else:
            body = _num_text(a)
        body = ("+" if n > 0 else MINUS) + body + "¢"
    return body + ((" " + contract) if contract else "")


_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
_CODE = "FGHJKMNQUVXZ"


def contract(s):
    """One futures contract label: "Dec '26". Reads "Dec 2026", "December
    2026", "Dec26", "Dec ’26", ZCZ26, ZCZ6. Twin of util.js AG.px.contract."""
    import re
    t = str("" if s is None else s).strip()
    if not t:
        return ""
    m = re.match(r"^([A-Za-z]{3})[A-Za-z]*\.?\s*['\u2019]?(\d{4}|\d{2})(?!\d)\s*(.*)$", t, re.S)
    i = [x.lower() for x in _MON].index(m.group(1).lower()) if m and m.group(1).lower() in [x.lower() for x in _MON] else -1
    if i >= 0:
        return _MON[i] + " '" + m.group(2)[-2:] + ((" " + m.group(3)) if m.group(3) else "")
    k = re.match(r"^[A-Z]{1,3}([FGHJKMNQUVXZ])(\d{1,2})$", t.upper())
    if k:
        y = k.group(2)
        return _MON[_CODE.index(k.group(1))] + " '" + ("2" + y if len(y) == 1 else y)
    return t


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
    assert cash(4.2125) == "$4.2125" and cash(12.475) == "$12.475" and cash(4.2) == "$4.20"
    assert cash(-0.65) == MINUS + "$0.65" and cash(4.21, dollar=False) == "4.21"
    assert basis(-65) == MINUS + "65¢" and basis(12.5) == "+12½¢" and basis(0) == "even"
    assert basis(-65, "Dec '26") == MINUS + "65¢ Dec '26" and basis(-12.3) == MINUS + "12.3¢"
    assert contract("Dec 2026") == "Dec '26" and contract("ZCZ26") == "Dec '26"
    assert contract("Nov26") == "Nov '26" and contract("ZSF7") == "Jan '27"
    assert contract("Dec 26 KCBT Red Wheat") == "Dec '26 KCBT Red Wheat" and contract("Spot") == "Spot"
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
            r = {"price": price, "move": move, "pct": pct, "change": change, "range": range_ends,
                  "cash": cash, "basis": basis, "contract": contract}[fn](*args, **kw)
            out.append(list(r) if isinstance(r, tuple) else r)
        print(json.dumps(out))
