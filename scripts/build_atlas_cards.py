#!/usr/bin/env python3
"""
build_atlas_cards.py -- the share images for the Farmland Atlas.

One 1200 x 630 JPEG per county (3,148), per state (50), plus the hub and the
data page. Every number on a card is read from farmland-atlas/data/cards.json,
which build_atlas_pages.py writes: this script draws, it does not compute.
A card shows the same figures the page shows, with the same rules: a value
flagged to read with care is a dash and those words, a missing figure is a dash
and the reason, never a zero.

MACHINE-OWNED OUTPUT: farmland-atlas/og/*.png and farmland-atlas/og/stamps.json.
Edit this script, never the images.

INCREMENTAL. og/stamps.json holds the card key each image was drawn from. A
card is redrawn only when its key changed or its file is missing, so the
monthly run redraws the counties whose figures moved and leaves the rest alone
(the repo does not grow by 100 MB a month). Bump CARD_V in build_atlas_pages.py
to redraw everything after a design change.

USAGE
  python scripts/build_atlas_cards.py --selftest
  python scripts/build_atlas_cards.py                    # whatever is stale
  python scripts/build_atlas_cards.py --only 19169 state-ia hub
  python scripts/build_atlas_cards.py --all --preview /tmp/cards   # redraw all into a folder
  CHROME=/path/to/chrome python scripts/build_atlas_cards.py       # default: Playwright's own Chromium

Needs: pip install playwright pillow && python -m playwright install chromium
(or CHROME=/path/to/chrome).
"""

import argparse
import base64
import io
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_atlas_pages as gen  # noqa: E402  (World, money, fmt, STATE_NAMES)

OUT = gen.OUT
HERE = os.path.dirname(os.path.abspath(__file__))
W_, H_ = 1200, 630
BG, SURF, TEXT, DIM, GOLD = "#0a0c0d", "#101415", "#e6ebe9", "#8a948f", "#d4a23f"
RAMP = ["#3a3320", "#5e4d24", "#8a6d2a", "#b98f33", "#d4a23f"]     # five equal-count groups, light to heavy
NONE_FILL = "#1a2022"


def font_css():
    def b64(n):
        with open(os.path.join(HERE, "cardfonts", n), "rb") as fh:
            return base64.b64encode(fh.read()).decode()
    faces = ""
    for fam, wt, fn in (("Inter", 800, "inter-latin-800-normal.woff2"), ("Inter", 900, "inter-latin-900-normal.woff2"),
                        ("JetBrains Mono", 500, "jetbrains-mono-latin-500-normal.woff2"), ("JetBrains Mono", 700, "jetbrains-mono-latin-700-normal.woff2")):
        faces += "@font-face{font-family:'%s';font-weight:%d;src:url(data:font/woff2;base64,%s) format('woff2')}" % (fam, wt, b64(fn))
    return faces


CSS = """
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1200px;height:630px;background:%(bg)s;overflow:hidden}
.card{position:relative;width:1200px;height:630px;background:%(bg)s;color:%(text)s;font-family:'Inter',sans-serif;padding:52px 60px 46px}
.card:before{content:'';position:absolute;left:0;top:0;width:1200px;height:8px;background:%(gold)s}
.top{display:flex;justify-content:space-between;font-family:'JetBrains Mono',monospace;font-weight:700;font-size:21px;letter-spacing:.14em;text-transform:uppercase}
.top .k{color:%(gold)s}.top .u{color:%(dim)s;font-weight:500;letter-spacing:.04em;text-transform:none}
.body{position:absolute;left:60px;top:112px;width:%(lw)spx}
h1{font-weight:900;letter-spacing:-.025em;line-height:1.02;color:%(text)s}
.sub{font-weight:800;color:%(dim)s;margin-top:10px;font-size:32px;letter-spacing:-.01em}
.stats{position:absolute;left:60px;bottom:104px;display:flex;gap:44px}
.st .l{font-family:'JetBrains Mono',monospace;font-weight:500;font-size:17px;letter-spacing:.1em;text-transform:uppercase;color:%(dim)s;white-space:nowrap}
.st .v{font-family:'JetBrains Mono',monospace;font-weight:700;font-size:64px;letter-spacing:-.03em;margin-top:8px;color:%(text)s;white-space:nowrap}
.st .v small{font-size:26px;font-weight:500;color:%(dim)s;letter-spacing:0;margin-left:4px}
.st .v.w{font-size:34px;line-height:1.2;color:%(dim)s;letter-spacing:-.01em;padding-top:12px}
.st .v.n{color:%(dim)s}
.foot{position:absolute;left:60px;right:60px;bottom:40px;display:flex;justify-content:space-between;align-items:baseline;border-top:1px solid #232a2c;padding-top:16px;font-family:'JetBrains Mono',monospace;font-size:20px;color:%(dim)s}
.foot b{color:%(gold)s;font-weight:700;letter-spacing:.02em}
.map{position:absolute;right:52px;top:96px;width:%(mw)spx;height:%(mh)spx;background:%(surf)s;border:1px solid #232a2c;border-radius:14px}
.map svg{width:100%%;height:100%%;display:block}
.leg{position:absolute;right:52px;top:%(legtop)spx;width:%(mw)spx;display:flex;justify-content:space-between;font-family:'JetBrains Mono',monospace;font-size:16px;color:%(dim)s}
.leg i{display:inline-block;width:14px;height:14px;border-radius:3px;margin-right:6px;vertical-align:-2px}
""" % dict(bg=BG, text=TEXT, gold=GOLD, dim=DIM, surf=SURF, lw=600, mw=430, mh=284, legtop=388)


def esc(s):
    return gen.esc(s)


def project(rings_by_id, w, h, pad=14):
    xs = [p[0] for rs in rings_by_id.values() for r in rs for p in r]
    ys = [p[1] for rs in rings_by_id.values() for r in rs for p in r]
    lat0 = (min(ys) + max(ys)) / 2
    k = math.cos(math.radians(lat0))
    x0, x1, y0, y1 = min(xs) * k, max(xs) * k, min(ys), max(ys)
    sc = min((w - 2 * pad) / max(1e-9, x1 - x0), (h - 2 * pad) / max(1e-9, y1 - y0))
    ox, oy = (w - (x1 - x0) * sc) / 2, (h - (y1 - y0) * sc) / 2
    return lambda x, y: "%.1f %.1f" % (ox + (x * k - x0) * sc, oy + (y1 - y) * sc)


def rings_of(W, g, st):
    geom = W.geo[g]
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    return [[((x - 360) if (st == "AK" and x > 0) else x, y) for x, y in ring] for poly in polys for ring in poly]


def bins(vals):
    v = sorted(vals)
    n = len(v)
    if n < 10:
        return None
    return [v[(n * i) // 5] for i in range(1, 5)]


def shade(x, br):
    if x is None or br is None:
        return NONE_FILL
    return RAMP[sum(1 for b in br if x >= b)]


def county_map(W, f, w=430, h=284):
    if not W.mapped(f):
        return ""
    st = W.C[f]["state"]
    ids = [f] + [g for g in W.NB.get(f, []) if g in W.geo]
    R = {g: rings_of(W, g, st) for g in ids}
    P = project(R, w, h, 26)
    out = []
    for g in ids[1:]:
        out.append('<path d="%s" fill="#182022" stroke="%s" stroke-width="1.5"/>' % ("".join("M" + "L".join(P(x, y) for x, y in r) + "Z" for r in R[g]), SURF))
    out.append('<path d="%s" fill="%s" stroke="%s" stroke-width="2.5" stroke-linejoin="round"/>' % ("".join("M" + "L".join(P(x, y) for x, y in r) + "Z" for r in R[f]), GOLD, BG))
    return '<svg viewBox="0 0 %d %d">%s</svg>' % (w, h, "".join(out))


def state_map(W, st, cards, w=430, h=284):
    fs = [f for f in W.by_state[st] if f in W.geo]
    R = {g: rings_of(W, g, st) for g in fs}
    P = project(R, w, h, 22)
    cur = cards["rent_latest"]
    rent = {f: cards["counties"][f]["r"] for f in fs if f in cards["counties"] and cards["counties"][f]["r"] is not None and cards["counties"][f]["ry"] == cur}
    br = bins(list(rent.values()))
    out = []
    for f in fs:
        out.append('<path d="%s" fill="%s" stroke="%s" stroke-width="1" stroke-linejoin="round"/>' % (
            "".join("M" + "L".join(P(x, y) for x, y in r) + "Z" for r in R[f]), shade(rent.get(f), br), BG))
    leg = ""
    if br:
        lo, hi = min(rent.values()), max(rent.values())
        leg = '<div class="leg"><span><i style="background:%s"></i>%s</span><span>dry rent, %s survey</span><span><i style="background:%s"></i>%s</span></div>' % (
            RAMP[0], gen.money(lo), cur, RAMP[4], gen.money(hi))
    return '<svg viewBox="0 0 %d %d">%s</svg>' % (w, h, "".join(out)), leg


def us_map(W, cards, w=1000, h=520):
    fs = [f for f in W.geo if W.C.get(f) and W.C[f]["state"] not in ("AK", "HI")]
    R = {g: rings_of(W, g, W.C[g]["state"]) for g in fs}
    P = project(R, w, h, 6)
    cur = cards["rent_latest"]
    rent = {f: cards["counties"][f]["r"] for f in fs if f in cards["counties"] and cards["counties"][f]["r"] is not None and cards["counties"][f]["ry"] == cur}
    br = bins(list(rent.values()))
    out = []
    for f in fs:
        out.append('<path d="%s" fill="%s"/>' % ("".join("M" + "L".join(P(x, y) for x, y in r) + "Z" for r in R[f]), shade(rent.get(f), br)))
    return '<svg viewBox="0 0 %d %d">%s</svg>' % (w, h, "".join(out))


def title_size(name):
    n = len(name)
    return 96 if n <= 12 else 84 if n <= 16 else 72 if n <= 20 else 60 if n <= 26 else 50


def stat(label, value, unit="", why=None, warn=False):
    if value is None:
        return '<div class="st"><div class="l">%s</div><div class="v n">—<small>%s</small></div></div>' % (esc(label), esc(why or "not published"))
    cls = "v w" if warn else "v"
    return '<div class="st"><div class="l">%s</div><div class="%s">%s%s</div></div>' % (
        esc(label), cls, esc(value), ("<small>%s</small>" % esc(unit)) if unit else "")


def county_card(W, cards, f):
    c = cards["counties"][f]
    body = '<div class="body"><h1 style="font-size:%dpx">%s</h1><div class="sub">%s</div></div>' % (title_size(c["n"]), esc(c["n"]), esc(c["s"]))
    rent = stat("Dry cash rent, %s" % c["ry"], gen.money(c["r"]) if c["r"] is not None else None, "/ac", "no published rent") if c["r"] is not None else stat("Dry cash rent", None, why="no published rent")
    if c["vf"]:
        val = stat("Land and buildings, %s" % (c["vy"] or "census"), "read with care", warn=True)
    elif c["v"] is not None:
        val = stat("Land and buildings, %s" % c["vy"], gen.money(c["v"]), "/ac")
    else:
        val = stat("Land and buildings", None, why="census value withheld")
    yl = stat("Corn yield, median", gen.fmt(c["y"], 1), "bu/ac") if c["y"] is not None else stat("Corn yield", None, why="too few published years")
    m = county_map(W, f)
    mp = '<div class="map">%s</div>' % m if m else ""
    return ('<div class="card"><div class="top"><span class="k">Farmland Atlas · County record</span><span class="u">agsist.com</span></div>%s'
            '<div class="stats">%s%s%s</div>%s<div class="foot"><span><b>AGSIST</b> · free, sourced, every county</span><span>agsist.com/farmland-atlas</span></div></div>') % (
        body, rent, val, yl, mp)


def state_card(W, cards, st):
    s = cards["states"][st]
    sm, leg = state_map(W, st, cards)
    body = '<div class="body"><h1 style="font-size:%dpx">%s</h1><div class="sub">%d counties, each with its own page</div></div>' % (title_size(s["n"]) + 8, esc(s["n"]), s["cnt"])
    rent = stat("Median dry rent", gen.money(s["r"]), "/ac") if s["r"] is not None else stat("Median dry rent", None, why="too few counties")
    val = stat("Median land value", gen.money(s["v"]), "/ac") if s["v"] is not None else stat("Median land value", None, why="too few counties")
    yl = stat("Median corn yield", gen.fmt(s["y"], 1), "bu/ac") if s["y"] is not None else stat("Median corn yield", None, why="too few counties")
    return ('<div class="card"><div class="top"><span class="k">Farmland Atlas · State</span><span class="u">agsist.com</span></div>%s'
            '<div class="stats">%s%s%s</div><div class="map">%s</div>%s<div class="foot"><span><b>AGSIST</b> · free, sourced, every county</span><span>agsist.com/farmland-atlas</span></div></div>') % (
        body, rent, val, yl, sm, leg)


def hub_card(W, cards):
    return ('<div class="card"><div class="top"><span class="k">Farmland Atlas</span><span class="u">agsist.com</span></div>'
            '<div class="body" style="width:520px"><h1 style="font-size:78px">Every U.S. county, on its own page</h1>'
            '<div class="sub" style="font-size:28px;line-height:1.35">Cash rent, land value, corn yield, crop insurance and drought. Sourced. Free to download.</div></div>'
            '<div style="position:absolute;right:44px;top:96px;width:560px;height:410px">%s</div>'
            '<div class="foot"><span><b>AGSIST</b> · %s counties</span><span>agsist.com/farmland-atlas</span></div></div>') % (us_map(W, cards, 560, 410), "{:,}".format(len(cards["counties"])))


def data_card(W, cards):
    return ('<div class="card"><div class="top"><span class="k">Farmland Atlas · Data</span><span class="u">agsist.com</span></div>'
            '<div class="body" style="width:1000px"><h1 style="font-size:96px">Every county,<br>as a spreadsheet</h1>'
            '<div class="sub" style="font-size:30px">One row per county. Every column with its unit and its source. Free to use with credit.</div></div>'
            '<div class="stats" style="gap:56px"><div class="st"><div class="l">Rows</div><div class="v">%s</div></div>'
            '<div class="st"><div class="l">Columns</div><div class="v">%d</div></div><div class="st"><div class="l">Licence</div><div class="v">CC BY 4.0</div></div></div>'
            '<div class="foot"><span><b>AGSIST</b> · free, sourced</span><span>agsist.com/farmland-atlas/data</span></div></div>') % ("{:,}".format(len(cards["counties"])), len(gen.COLNAMES))


def compare_card(W, cards):
    return ('<div class="card"><div class="top"><span class="k">Farmland Atlas \u00b7 Compare</span><span class="u">agsist.com</span></div>'
            '<div class="body" style="width:1000px"><h1 style="font-size:96px">Compare counties,<br>side by side</h1>'
            '<div class="sub" style="font-size:30px">Rent, land value, yield, claims and drought for up to three counties. No score. No winner.</div></div>'
            '<div class="stats" style="gap:56px"><div class="st"><div class="l">Counties</div><div class="v">up to 3</div></div>'
            '<div class="st"><div class="l">Measures</div><div class="v">17</div></div><div class="st"><div class="l">Sources named</div><div class="v">every one</div></div></div>'
            '<div class="foot"><span><b>AGSIST</b> \u00b7 free, sourced</span><span>agsist.com/farmland-atlas/compare</span></div></div>')


def keyed(cards):
    """name -> (card key, builder)"""
    items = {}
    for f, c in cards["counties"].items():
        items[f] = (c["k"], lambda W, cards, f=f: county_card(W, cards, f))
    for st, s in cards["states"].items():
        items["state-" + st.lower()] = (s["k"], lambda W, cards, st=st: state_card(W, cards, st))
    items["hub"] = ("v" + cards["v"] + cards["built"], hub_card)
    items["compare"] = ("v" + cards["v"], compare_card)
    items["data"] = ("v" + cards["v"] + "-" + str(len(cards["counties"])) + "-" + str(len(gen.COLNAMES)), data_card)
    return items


def render(items, todo, W, cards, out_dir, chrome=None, colors=48):
    from playwright.sync_api import sync_playwright
    from PIL import Image
    os.makedirs(out_dir, exist_ok=True)
    shell = "<!doctype html><meta charset=utf-8><style>%s%s</style><body></body>" % (font_css(), CSS)
    made = {}
    with sync_playwright() as pw:
        kw = {"executable_path": chrome} if chrome else {}
        br = pw.chromium.launch(**kw)
        pg = br.new_page(viewport={"width": W_, "height": H_})
        pg.set_content(shell)
        pg.evaluate("document.fonts.load(\"900 40px Inter\")")
        pg.evaluate("Promise.all([document.fonts.load(\"800 20px Inter\"),document.fonts.load(\"500 20px 'JetBrains Mono'\"),document.fonts.load(\"700 20px 'JetBrains Mono'\")])")
        for n, name in enumerate(todo, 1):
            key, fn = items[name]
            pg.evaluate("h => { document.body.innerHTML = h }", fn(W, cards))
            png = pg.screenshot(type="png", clip={"x": 0, "y": 0, "width": W_, "height": H_})
            # flat colour and type: 48 colours keep it crisp at about 18 KB instead of 50
            Image.open(io.BytesIO(png)).convert("RGB").quantize(colors=colors, dither=Image.Dither.NONE).save(os.path.join(out_dir, name + ".png"), "PNG", optimize=True)
            made[name] = key
            if n % 200 == 0:
                print("  drew %d of %d" % (n, len(todo)), file=sys.stderr)
        br.close()
    return made


def selftest():
    fails = []

    def check(n, c):
        if not c:
            fails.append(n)
            print("FAIL", n)
    check("bins need 10", bins([1, 2, 3]) is None and len(bins(list(range(50)))) == 4)
    br = bins(list(range(100)))
    check("shade extremes", shade(0, br) == RAMP[0] and shade(99, br) == RAMP[4] and shade(None, br) == NONE_FILL and shade(5, None) == NONE_FILL)
    check("title size steps down", title_size("Story County") == 96 and title_size("Lake and Peninsula Borough") == 60 and title_size("x" * 40) == 50)
    d = stat("Corn yield", None, why="too few published years")
    check("missing is a dash and a reason, never a zero", "—" in d and "too few published years" in d and ">0<" not in d)
    check("flag is words", "read with care" in stat("Land", "read with care", warn=True))
    check("fonts present", all(os.path.exists(os.path.join(HERE, "cardfonts", n)) for n in (
        "inter-latin-800-normal.woff2", "inter-latin-900-normal.woff2", "jetbrains-mono-latin-500-normal.woff2", "jetbrains-mono-latin-700-normal.woff2")))
    print("selftest: " + ("FAIL (%d)" % len(fails) if fails else "ok"))
    return 1 if fails else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--all", action="store_true", help="redraw everything")
    ap.add_argument("--root", default=".")
    ap.add_argument("--preview", default=None, help="write here instead of farmland-atlas/og, and do not touch stamps")
    ap.add_argument("--chrome", default=os.environ.get("CHROME"))
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    root = a.root
    cards = json.load(open(os.path.join(root, OUT, "data", "cards.json"), encoding="utf-8"))
    W = gen.World(root)
    items = keyed(cards)
    out_dir = a.preview or os.path.join(root, OUT, "og")
    sp = os.path.join(root, OUT, "og", "stamps.json")
    try:
        have = json.load(open(sp, encoding="utf-8"))
    except Exception:
        have = {}
    if a.only:
        bad = [n for n in a.only if n not in items]
        if bad:
            print("unknown card: %s" % bad, file=sys.stderr)
            return 1
        todo = a.only
    elif a.all or a.preview:
        todo = sorted(items)
    else:
        todo = [n for n in sorted(items) if have.get(n) != items[n][0] or not os.path.exists(os.path.join(out_dir, n + ".png"))]
    print("cards: %d of %d to draw" % (len(todo), len(items)), file=sys.stderr)
    if not todo:
        return 0
    made = render(items, todo, W, cards, out_dir, a.chrome)
    if not a.preview:
        have.update(made)
        # a card whose page no longer exists is removed
        for n in list(have):
            if n not in items:
                try:
                    os.remove(os.path.join(out_dir, n + ".png"))
                except OSError:
                    pass
                del have[n]
        os.makedirs(os.path.dirname(sp), exist_ok=True)
        with open(sp, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(have, fh, separators=(",", ":"), sort_keys=True)
    missing = [n for n in todo if not os.path.exists(os.path.join(out_dir, n + ".png"))]
    if missing:
        print("FAIL: %d cards not written" % len(missing), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
