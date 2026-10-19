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

Corn N is not per bushel (2026-10-19 money audit 1: the old 0.90 lb a bushel
had no source and put 213 lb N on 237 bu). It is the A2809 Table 6.1 MRTN rate
for corn after soybeans at the N:corn ratio /fast-facts opens with
(scripts/crop_removal.py corn_n(), which runs components/a2809.js itself),
priced at that N form's $/lb, the same for any yield. P and K follow the
yield. The corn futures price the ratio used is baked into FERT.cf; --check
reads it back, so a futures move does not make the page stale between
fertilizer runs (a write reads data/prices.json).

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
QUOTES = "data/prices.json"
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


def rate_words(r):
    """(0.38, 0.29) -> "0.38 and 0.29"."""
    a = ["%.2f" % x for x in r]
    return ", ".join(a[:-1]) + " and " + a[-1]


def page_yield(src, crop):
    m = re.search(r"\b" + crop + r":\{[^}]*?\byield:([\d.]+)", src[src.find("CROP_DEFAULTS"):])
    return float(m.group(1)) if m else None


def page_rates(cn):
    """Per-bushel rates as the page uses them: corn's N is not per bushel
    when there is an MRTN rate for it (cn); it is a flat lb an acre."""
    r = dict(rates())
    if cn:
        r["corn"] = (0.0,) + tuple(r["corn"][1:])
    return r


def program(crop, yld, per, cn=None):
    """Fertilizer $/acre for the page's own default yield, the same
    arithmetic as components/breakeven.js fertFor(). Corn takes the MRTN
    rate (cn) at that N form's $/lb, and has no default without one. None
    when a nutrient the crop needs has no live price: never a guess."""
    r = page_rates(cn).get(crop)
    if not r or not yld or (crop == "corn" and not cn):
        return None
    lbs = [round(yld * x) for x in r]
    flat = crop == "corn"
    if flat:
        lbs[0] = cn["lb"]
    need = [x for x, lb in zip("npk", lbs) if lb > 0 and not (flat and x == "n")]
    if any(x not in per or per[x].get("usd") is None for x in need):
        return None
    usd = sum(lb * per[x]["usd"] for x, lb in zip("npk", lbs) if x in need)
    dates = [per[x]["as_of"] for x in need]
    if flat:
        usd += lbs[0] * round(cn["n"]["usd"], 4)
        dates.append(cn["n"]["as_of"])
    return {"yield": int(yld) if yld == int(yld) else yld, "n_lb": lbs[0], "p_lb": lbs[1], "k_lb": lbs[2],
            "per_acre": round(usd), "as_of": max(d for d in dates if d)}


def js_const(per, cn=None):
    """The $/lb and rates the page needs to price fertilizer for another
    yield (a county trend, a budget region). Baked with the defaults.
    nf.corn is the flat corn N: [lb an acre, $/lb of that N form, the form]
    (an array: scripts/bake_seo.py finds CROP_DEFAULTS' corn:{ by its brace);
    cf is the corn futures price its ratio used (--check reads it back)."""
    if not all(x in per and per[x].get("usd") is not None for x in "npk"):
        return "var FERT=null;"
    r = page_rates(cn)
    asof = max(per[x]["as_of"] for x in "npk")
    rs = ",".join("%s:[%s]" % (k, ",".join("%g" % v for v in r[k])) for k in ("corn", "soybeans", "wheat"))
    nf = ""
    if cn:
        nf = (",nf:{corn:[%d,%g,'%s']},cf:{usd:%g,label:\"%s\",date:'%s'}"
              % (cn["lb"], round(cn["n"]["usd"], 4), cn["n"]["key"], cn["corn"]["usd"], cn["corn"]["label"], cn["corn"]["date"]))
    return "var FERT={n:%g,p:%g,k:%g,asof:'%s',r:{%s}%s};" % (per["n"]["usd"], per["p"]["usd"], per["k"]["usd"], asof, rs, nf)


def recorded_corn(src):
    """The corn futures price the last bake used (FERT.cf), for --check."""
    m = re.search(r"cf:\{usd:([\d.]+),label:\"([^\"]*)\",date:'([^']*)'\}", src)
    return {"usd": float(m.group(1)), "label": m.group(2), "date": m.group(3)} if m else None


def corn_rate(data, corn, js_path=None):
    """scripts/crop_removal.py corn_n() at the posted N and this corn price."""
    sys.path.insert(0, str(ROOT / "scripts"))
    import crop_removal  # noqa: E402
    return crop_removal.corn_n(crop_removal.n_price((data or {}).get("prices")), corn, js_path)


def ton_words(x):
    return "%.2f" % x


def bake(src, data, corn=None):
    per = (data or {}).get("per_lb") or {}
    cn = corn_rate(data, corn) if corn else None
    out = src
    progs = {}
    for crop in ("corn", "soybeans", "wheat"):
        p = program(crop, page_yield(src, crop), per, cn)
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
        nf, cf = cn["n"], cn["corn"]
        how = "; ".join(esc(per[x]["how"]) for x in "pk" if x in per)
        off = " That ratio is past the end of the table, so this is its nearest column." if cn["off"] else ""
        line = ("Fertilizer default, corn: $%d an acre = %d lb N, %d lb P&#8322;O&#8325; and %d lb K&#8322;O for %s bu, "
                "at prices posted through %s. "
                "N: %d lb an acre, the rate with the most return to N in UW A2809 Table 6.1 for corn after soybeans on "
                "high-yield loamy soil (profitable range %d to %d; %d after corn), from Wisconsin trials. "
                "It is the %.2f column for a %.3f N:corn price ratio: %s $%s a ton / (2,000 lb x %d%% N) = $%.2f a lb of N (%s), "
                "against %s corn futures $%.2f (%s close), the same rate <a href=\"/fast-facts#nitrogen\">Fast Facts</a> "
                "gives at these prices.%s It does not follow your yield. Your state's MRTN rate and your credits beat it. "
                "P and K: %s lb a bushel (UW A2809 grain removal), and they follow your yield until you type your own. "
                "Soybeans and wheat use their own rates. How the P and K prices are worked out: %s. "
                "<a href=\"/fertilizer\">Fertilizer prices</a>."
                % (c["per_acre"], c["n_lb"], c["p_lb"], c["k_lb"], c["yield"], day(c["as_of"]),
                   cn["lb"], cn["lo"], cn["hi"], cn["after_corn"],
                   cn["col"], cn["ratio"], esc(nf["name"]), ton_words(nf["ton"]), round(nf["pct"] * 100), nf["usd"], esc(nf["label"]),
                   esc(cf["label"]), cf["usd"], day(cf["date"]) if cf["date"] else "undated", off,
                   rate_words(rates()["corn"][1:]), how))
    elif cn is None and (data or {}).get("per_lb"):
        line = ("No corn N rate right now (no posted N price or corn futures price to set the N:corn ratio), "
                "so there is no corn fertilizer default. Type your own cost per acre.")
    else:
        line = "No live fertilizer price right now, so there is no fertilizer default. Type your own cost per acre."
    out, n = re.subn(r"(<!--FERT:SRC-->).*?(<!--/FERT:SRC-->)", lambda m: m.group(1) + line + m.group(2), out, count=1, flags=re.S)
    if n != 1:
        raise ValueError("FERT:SRC markers not found")
    out, n = re.subn(r"(/\*FERT:JS\*/).*?(/\*/FERT:JS\*/)", lambda m: m.group(1) + js_const(per, cn) + m.group(2), out, count=1, flags=re.S)
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
                       "k": {"usd": 0.39, "how": "potash c", "as_of": "2026-10-04"}},
            "prices": [{"key": "urea", "price": 615.95, "as_of": "2026-10-06", "src_label": "co-ops u"},
                       {"key": "anhydrous", "price": 832.1, "as_of": "2026-10-06", "src_label": "co-ops a"}]}
    corn = {"usd": 5.0675, "label": "Dec '27", "date": "2026-10-16"}
    out = bake(page, data, corn)
    # Corn N (2026-10-19 money audit 1), A2809 Table 6.1 after soybean, high-yield loamy:
    #   anhydrous $832.10 / 1,640 = $0.5074 a lb of N; / $5.0675 Dec '27 = 0.100 -> the
    #   0.10 column: 120 lb (105 to 130), 165 after corn. Flat: not per bushel.
    # P and K, A2809 removal: corn 0.38 / 0.29, soybeans 0.80 / 1.40; wheat N 1.20 a bushel.
    # 180 bu: 120 x 0.5074 + 68 x 0.74 + 52 x 0.39 = 60.888 + 50.32 + 20.28 = 131.49
    ck("corn default and input priced at the page's own yield", "corn:{yield:180,seed:125,fertilizer:131,x:1}" in out and 'value="131"' in out)
    # 55 bu: 44 x 0.74 + 77 x 0.39 = 62.59
    ck("soybeans at its own rates", "soybeans:{yield:55,fertilizer:63}" in out)
    # 70 bu: 84 x 0.68 + 35 x 0.74 + 24 x 0.39 = 92.38
    ck("wheat at its own rates", "wheat:{yield:70,fertilizer:92}" in out and "110" not in out)
    ck("the line names the MRTN source, the ratio, its prices and the date",
       "120 lb N" in out and "UW A2809 Table 6.1 for corn after soybeans" in out and "profitable range 105 to 130; 165 after corn" in out
       and "the 0.10 column for a 0.100 N:corn price ratio: anhydrous $832.10 a ton / (2,000 lb x 82% N) = $0.51 a lb of N (co-ops a)" in out
       and "Dec '27 corn futures $5.07 (Oct 16, 2026 close)" in out and "Oct 6, 2026" in out
       and "P and K: 0.38 and 0.29 lb a bushel" in out and "DAP b; potash c" in out and "0.90" not in out)
    ck("the page gets the $/lb, rates and flat corn N to price another yield",
       "var FERT={n:0.68,p:0.74,k:0.39,asof:'2026-10-06',r:{corn:[0,0.38,0.29],soybeans:[0,0.8,1.4],wheat:[1.2,0.5,0.35]},"
       "nf:{corn:[120,0.5074,'anhydrous']},cf:{usd:5.0675,label:\"Dec '27\",date:'2026-10-16'}};" in out)
    ck("--check reads back the corn price it used", recorded_corn(out) == corn)
    big = bake(page.replace("yield:180", "yield:237"), data, corn)
    # 237 bu: 120 x 0.5074 + 90 x 0.74 + 69 x 0.39 = 60.888 + 66.6 + 26.91 = 154.40; N does not follow the yield
    ck("a different page yield moves P and K, not N", "corn:{yield:237,seed:125,fertilizer:154,x:1}" in big and "120 lb N, 90 lb" in big and "for 237 bu" in big)
    uo = bake(page, dict(data, prices=data["prices"][:1]), corn)
    # urea only: $615.95 / 920 = $0.6695; / 5.0675 = 0.132 -> 0.15 column: 105 lb (95 to 115), 150 after corn
    # 180 bu: 105 x 0.6695 + 50.32 + 20.28 = 140.90
    ck("no anhydrous posted: urea, as /fast-facts", "fertilizer:141," in uo and "105 lb N" in uo and "the 0.15 column for a 0.132" in uo
       and "profitable range 95 to 115; 150 after corn" in uo and "nf:{corn:[105,0.6695,'urea']}" in uo)
    nc = bake(page, data, None)
    ck("no corn price: no corn default, says why; the others stay", "corn:{yield:180,seed:125,fertilizer:'',x:1}" in nc
       and 'value=""' in nc and "No corn N rate right now" in nc and "soybeans:{yield:55,fertilizer:63}" in nc and "nf:" not in nc)
    nok = bake(page, {"per_lb": {"n": data["per_lb"]["n"], "p": data["per_lb"]["p"]}, "prices": data["prices"]}, corn)
    ck("a nutrient with no live price: empty, not an old number", "corn:{yield:180,seed:125,fertilizer:'',x:1}" in nok and "var FERT=null;" in nok)
    none = bake(page, None, corn)
    ck("no file: no number, says type your own", 'value=""' in none and "175" not in none and "Type your own" in none)
    ck("baking twice changes nothing", bake(out, data, corn) == out)
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
    corn = recorded_corn(src) if "--check" in argv else None
    if corn is None:
        sys.path.insert(0, str(ROOT / "scripts"))
        import crop_removal  # noqa: E402
        from zoneinfo import ZoneInfo
        try:
            quotes = json.loads((ROOT / QUOTES).read_text()).get("quotes")
        except (OSError, ValueError):
            quotes = None
        corn = crop_removal.posted_corn(quotes, datetime.datetime.now(ZoneInfo("America/Chicago")).date())
    out = bake(src, data, corn)
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
