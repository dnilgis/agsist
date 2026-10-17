#!/usr/bin/env python3
"""
Bake breakeven.html's fertilizer defaults from data/fertilizer-prices.json.

The break-even calculator opens with a fertilizer cost per acre for corn,
soybeans and wheat. Those used to be typed in ($175, $45, $110) with no date.
Now each is the page's own default yield times the stated removal rates
(scripts/build_fert_prices.py PROGRAMS), priced at the posted $/lb of N,
P2O5 and K2O in data/fertilizer-prices.json (per_lb). This writes:

  * the fertilizer value in each crop's CROP_DEFAULTS entry and the corn
    input's opening value, and
  * the line under the input costs (<!--FERT:SRC--> markers) that says the
    rates assumed, the $/lb used, and the source and date, and
  * var FERT (/*FERT:JS*/ markers): the same $/lb and rates, so the page can
    price fertilizer for a county trend yield or another budget's yield.

A crop with no program (a nutrient it needs has no live price) gets an empty
default and the line says to type your own: never an old number.
scripts/bake_seo.py reads CROP_DEFAULTS for its example, so run this first.

  python3 scripts/bake_fert_defaults.py           write
  python3 scripts/bake_fert_defaults.py --check   exit 1 if stale
  python3 scripts/bake_fert_defaults.py --selftest
"""
import datetime
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE = "breakeven.html"
PRICES = "data/fertilizer-prices.json"
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def day(iso):
    d = datetime.date.fromisoformat(iso)
    return "%s %d, %d" % (MON[d.month - 1], d.day, d.year)


def esc(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


RATES = None


def rates():
    """Per-bushel removal rates, from the one place they are kept
    (scripts/build_fert_prices.py PROGRAMS)."""
    global RATES
    if RATES is None:
        sys.path.insert(0, str(ROOT / "scripts"))
        import build_fert_prices as B  # noqa: E402
        RATES = {k: tuple(v["per_bu"]) for k, v in B.PROGRAMS.items()}
    return RATES


def page_yield(src, crop):
    m = re.search(r"\b" + crop + r":\{[^}]*?\byield:([\d.]+)", src[src.find("CROP_DEFAULTS"):])
    return float(m.group(1)) if m else None


def program(crop, yld, per):
    """Fertilizer $/acre for the page's own default yield at the stated
    rates, the same arithmetic as build_fert_prices.programs(). None when a
    nutrient the crop needs has no live price: never a guess."""
    r = rates().get(crop)
    if not r or not yld:
        return None
    lbs = [round(yld * x) for x in r]
    need = [x for x, lb in zip("npk", lbs) if lb > 0]
    if any(x not in per or per[x].get("usd") is None for x in need):
        return None
    usd = sum(lb * per[x]["usd"] for x, lb in zip("npk", lbs) if lb > 0)
    return {"yield": int(yld) if yld == int(yld) else yld, "n_lb": lbs[0], "p_lb": lbs[1], "k_lb": lbs[2],
            "per_acre": round(usd), "as_of": max(per[x]["as_of"] for x in need)}


def js_const(per):
    """The $/lb and rates the page needs to price fertilizer for another
    yield (a county trend, a budget region). Baked with the defaults."""
    if not all(x in per and per[x].get("usd") is not None for x in "npk"):
        return "var FERT=null;"
    r = rates()
    asof = max(per[x]["as_of"] for x in "npk")
    rs = ",".join("%s:[%s]" % (k, ",".join("%g" % v for v in r[k])) for k in ("corn", "soybeans", "wheat"))
    return "var FERT={n:%g,p:%g,k:%g,asof:'%s',r:{%s}};" % (per["n"]["usd"], per["p"]["usd"], per["k"]["usd"], asof, rs)


def bake(src, data):
    per = (data or {}).get("per_lb") or {}
    out = src
    progs = {}
    for crop in ("corn", "soybeans", "wheat"):
        p = program(crop, page_yield(src, crop), per)
        progs[crop] = p
        val = str(p["per_acre"]) if p else "''"
        out, n = re.subn(r"(\b" + crop + r":\{[^}]*?\bfertilizer:)('?[\d.]*'?)", lambda m: m.group(1) + val, out, count=1)
        if n != 1:
            raise ValueError("CROP_DEFAULTS %s.fertilizer not found" % crop)
    c = progs.get("corn")
    out, n = re.subn(r'(<input type="number" id="fertilizer" min="0" value=")[^"]*(")',
                     lambda m: m.group(1) + (str(c["per_acre"]) if c else "") + m.group(2), out, count=1)
    if n != 1:
        raise ValueError("fertilizer input not found")
    if c:
        how = "; ".join(esc(per[x]["how"]) for x in "npk" if x in per)
        line = ("Fertilizer default, corn: $%d an acre = %d lb N, %d lb P&#8322;O&#8325; and %d lb K&#8322;O for %s bu "
                "(0.90, 0.37 and 0.24 lb a bushel), at prices posted through %s. It follows your yield until you type your own. "
                "Soybeans and wheat use their own rates. "
                "Your soil test and rates beat this. How each price per lb is worked out: %s. "
                "<a href=\"/fertilizer\">Fertilizer prices</a>."
                % (c["per_acre"], c["n_lb"], c["p_lb"], c["k_lb"], c["yield"], day(c["as_of"]), how))
    else:
        line = "No live fertilizer price right now, so there is no fertilizer default. Type your own cost per acre."
    out, n = re.subn(r"(<!--FERT:SRC-->).*?(<!--/FERT:SRC-->)", lambda m: m.group(1) + line + m.group(2), out, count=1, flags=re.S)
    if n != 1:
        raise ValueError("FERT:SRC markers not found")
    out, n = re.subn(r"(/\*FERT:JS\*/).*?(/\*/FERT:JS\*/)", lambda m: m.group(1) + js_const(per) + m.group(2), out, count=1, flags=re.S)
    if n != 1:
        raise ValueError("FERT:JS markers not found")
    return out


def selftest():
    fails = []

    def ck(name, cond):
        print(("  ok   " if cond else "::error::bake_fert_defaults selftest FAIL ") + name)
        if not cond:
            fails.append(name)

    page = ('<input type="number" id="fertilizer" min="0" value="175" inputmode="numeric">'
            '<p><!--FERT:SRC-->old<!--/FERT:SRC--></p><script>/*FERT:JS*/var FERT=null;/*/FERT:JS*/var CROP_DEFAULTS={corn:{yield:180,seed:125,fertilizer:175,x:1},'
            'soybeans:{yield:55,fertilizer:45},wheat:{yield:70,fertilizer:110}};</script>')
    data = {"per_lb": {"n": {"usd": 0.68, "how": "urea a", "as_of": "2026-10-06"}, "p": {"usd": 0.74, "how": "DAP b", "as_of": "2026-10-05"},
                       "k": {"usd": 0.39, "how": "potash c", "as_of": "2026-10-04"}}}
    out = bake(page, data)
    # 180 bu: 162 lb N x 0.68 + 67 lb P2O5 x 0.74 + 43 lb K2O x 0.39 = 176.51
    ck("corn default and input priced at the page's own yield", "corn:{yield:180,seed:125,fertilizer:177,x:1}" in out and 'value="177"' in out)
    # 55 bu: 44 x 0.74 + 72 x 0.39 = 60.64
    ck("soybeans at its own rates", "soybeans:{yield:55,fertilizer:61}" in out)
    # 70 bu: 84 x 0.68 + 35 x 0.74 + 21 x 0.39 = 91.11
    ck("wheat at its own rates", "wheat:{yield:70,fertilizer:91}" in out and "110" not in out)
    ck("the line names rates, date and the arithmetic", "162 lb N" in out and "Oct 6, 2026" in out and "urea a; DAP b; potash c" in out)
    ck("the page gets the $/lb and rates to price another yield", "var FERT={n:0.68,p:0.74,k:0.39,asof:'2026-10-06',r:{corn:[0.9,0.37,0.24],soybeans:[0,0.8,1.3],wheat:[1.2,0.5,0.3]}};" in out)
    big = bake(page.replace("yield:180", "yield:237"), data)
    # 237 bu: 213 x 0.68 + 88 x 0.74 + 57 x 0.39 = 232.19
    ck("a different page yield is priced at that yield", "corn:{yield:237,seed:125,fertilizer:232,x:1}" in big and "213 lb N" in big and "for 237 bu" in big)
    nok = bake(page, {"per_lb": {"n": data["per_lb"]["n"], "p": data["per_lb"]["p"]}})
    ck("a nutrient with no live price: empty, not an old number", "corn:{yield:180,seed:125,fertilizer:'',x:1}" in nok and "var FERT=null;" in nok)
    none = bake(page, None)
    ck("no file: no number, says type your own", 'value=""' in none and "175" not in none and "Type your own" in none)
    ck("baking twice changes nothing", bake(out, data) == out)
    if fails:
        print("selftest FAILED: %d" % len(fails))
        return 1
    print("selftest ok")
    return 0


def main(argv):
    if "--selftest" in argv:
        return selftest()
    try:
        data = json.loads((ROOT / PRICES).read_text())
    except (OSError, ValueError):
        data = None
    src = (ROOT / PAGE).read_text(encoding="utf-8")
    out = bake(src, data)
    if out == src:
        print("ok    " + PAGE)
        return 0
    if "--check" in argv:
        print("STALE %s: run python3 scripts/bake_fert_defaults.py" % PAGE)
        return 1
    (ROOT / PAGE).write_text(out, encoding="utf-8")
    print("wrote " + PAGE)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
