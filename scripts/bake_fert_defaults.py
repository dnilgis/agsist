#!/usr/bin/env python3
"""
Bake breakeven.html's fertilizer defaults from data/fertilizer-prices.json.

The break-even calculator opens with a fertilizer cost per acre for corn,
soybeans and wheat. Those used to be typed in ($175, $45, $110) with no date.
Now each is the crop program in data/fertilizer-prices.json (programs, built
by scripts/build_fert_prices.py): the default yield times stated removal
rates, priced at the posted $/lb of N, P2O5 and K2O. This writes:

  * the fertilizer value in each crop's CROP_DEFAULTS entry and the corn
    input's opening value, and
  * the line under the input costs (<!--FERT:SRC--> markers) that says the
    rates assumed, the $/lb used, and the source and date.

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


def bake(src, data):
    progs = (data or {}).get("programs") or {}
    per = (data or {}).get("per_lb") or {}
    out = src
    for crop in ("corn", "soybeans", "wheat"):
        p = progs.get(crop)
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
        line = ("Fertilizer default, corn: $%d an acre = %d lb N, %d lb P&#8322;O&#8325; and %d lb K&#8322;O for %d bu "
                "(0.90, 0.37 and 0.24 lb a bushel), at prices posted through %s. Soybeans and wheat use their own rates. "
                "Your soil test and rates beat this. How each price per lb is worked out: %s. "
                "<a href=\"/fertilizer\">Fertilizer prices</a>."
                % (c["per_acre"], c["n_lb"], c["p_lb"], c["k_lb"], c["yield"], day(c["as_of"]), how))
    else:
        line = "No live fertilizer price right now, so there is no fertilizer default. Type your own cost per acre."
    out, n = re.subn(r"(<!--FERT:SRC-->).*?(<!--/FERT:SRC-->)", lambda m: m.group(1) + line + m.group(2), out, count=1, flags=re.S)
    if n != 1:
        raise ValueError("FERT:SRC markers not found")
    return out


def selftest():
    fails = []

    def ck(name, cond):
        print(("  ok   " if cond else "::error::bake_fert_defaults selftest FAIL ") + name)
        if not cond:
            fails.append(name)

    page = ('<input type="number" id="fertilizer" min="0" value="175" inputmode="numeric">'
            '<p><!--FERT:SRC-->old<!--/FERT:SRC--></p><script>var CROP_DEFAULTS={corn:{yield:180,seed:125,fertilizer:175,x:1},'
            'soybeans:{yield:55,fertilizer:45},wheat:{yield:70,fertilizer:110}};</script>')
    data = {"per_lb": {"n": {"usd": 0.68, "how": "urea a"}, "p": {"usd": 0.74, "how": "DAP b"}, "k": {"usd": 0.39, "how": "potash c"}},
            "programs": {"corn": {"yield": 180, "n_lb": 162, "p_lb": 67, "k_lb": 43, "per_acre": 177, "as_of": "2026-10-06"},
                         "soybeans": {"yield": 55, "n_lb": 0, "p_lb": 44, "k_lb": 72, "per_acre": 61, "as_of": "2026-10-06"},
                         "wheat": None}}
    out = bake(page, data)
    ck("corn default and input from the live program", "corn:{yield:180,seed:125,fertilizer:177,x:1}" in out and 'value="177"' in out)
    ck("soybeans from its program", "soybeans:{yield:55,fertilizer:61}" in out)
    ck("wheat with no program: empty, not the old $110", "wheat:{yield:70,fertilizer:''}" in out and "110" not in out)
    ck("the line names rates, date and the arithmetic", "162 lb N" in out and "Oct 6, 2026" in out and "urea a; DAP b; potash c" in out)
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
