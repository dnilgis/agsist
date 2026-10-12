#!/usr/bin/env python3
"""build_prf_card.py: the share image for /prf, img/og/prf.jpg (1200x630).

Every figure on it comes from data/prf/meta.json and data/prf/facts.json, so
it is rebuilt with the data each crop year. The bars are the page's own worked
example (grid 30454, Barron County, Wisconsin, 100 acres of grazing, 90%,
April to May and June to July), year by year, from facts.json: no number on
the card is drawn by hand.

  python3 scripts/build_prf_card.py
"""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BG, TEXT, MUTED, GOLD, BAR, LINE = (10, 12, 13), (230, 235, 233), (150, 160, 156), (212, 162, 63), (57, 135, 201), (60, 70, 74)
FONTS = [os.path.join(ROOT, "scripts", "cardfonts"), "/usr/share/fonts/truetype/dejavu"]
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def font(names, size):
    for d in FONTS:
        for n in names:
            p = os.path.join(d, n)
            if os.path.exists(p):
                return ImageFont.truetype(p, size)
    raise SystemExit("no font found for " + names[0])


def main():
    meta = json.load(open(os.path.join(ROOT, "data/prf/meta.json")))
    facts = json.load(open(os.path.join(ROOT, "data/prf/facts.json")))
    if facts.get("built_from") != meta["built"]:
        raise SystemExit("facts.json is from another build of data/prf: run node scripts/prf_facts.mjs")
    y, m, d = meta["dates"]["sales_closing"].split("-")
    deadline = f"{MONTHS[int(m) - 1]} {int(d)}, {y}"
    W, H, S = 1200, 630, 2
    im = Image.new("RGB", (W * S, H * S), BG)
    dr = ImageDraw.Draw(im)
    sans_b = ["Archivo-Bold.ttf", "Inter-Bold.ttf", "DejaVuSans-Bold.ttf"]
    sans = ["Inter-Regular.ttf", "DejaVuSans.ttf"]
    mono = ["JetBrainsMono-Regular.ttf", "DejaVuSansMono.ttf"]
    mono_b = ["JetBrainsMono-Bold.ttf", "DejaVuSansMono-Bold.ttf"]
    x0 = 64 * S
    dr.text((x0, 56 * S), f"PRF INSURANCE CALCULATOR  ·  CROP YEAR {meta['crop_year']}", font=font(mono_b, 22 * S), fill=GOLD)
    f_h = font(sans_b, 58 * S)
    dr.text((x0, 100 * S), "What your grid would", font=f_h, fill=TEXT)
    dr.text((x0, 168 * S), f"have paid, every year", font=f_h, fill=TEXT)
    dr.text((x0, 236 * S), f"since {meta['years']['first']}", font=f_h, fill=TEXT)
    stats = f"{meta['counts']['grids']:,} grids  ·  {meta['counts']['states']} states  ·  {facts['years']['n']} years  ·  free"
    dr.text((x0, 326 * S), stats, font=font(mono, 24 * S), fill=MUTED)
    dr.text((x0, 364 * S), f"Sign-up deadline {deadline}", font=font(sans_b, 26 * S), fill=TEXT)
    # the example's years, as bars along the bottom
    ex = facts.get("example_years")
    if ex:
        top, base, left, right = 430 * S, 566 * S, x0, (W - 64) * S
        mx = max(ex["paid"]) or 1
        n, bw = len(ex["paid"]), (right - left) / len(ex["paid"])
        prem = ex["you"]
        for i, v in enumerate(ex["paid"]):
            if v > 0:
                h = max(3 * S, (v / mx) * (base - top))
                dr.rectangle([left + i * bw + S, base - h, left + (i + 1) * bw - S, base], fill=BAR)
        py = base - (prem / mx) * (base - top)
        for xx in range(int(left), int(right), 14 * S):
            dr.line([xx, py, xx + 8 * S, py], fill=TEXT, width=2 * S)
        dr.line([left, base, right, base], fill=LINE, width=S)
        dr.text((left, base + 10 * S), f"{ex['first']}", font=font(mono, 18 * S), fill=MUTED)
        dr.text((right - 60 * S, base + 10 * S), f"{ex['last']}", font=font(mono, 18 * S), fill=MUTED)
        cap = f"Example: grid {facts['example']['grid']}, {facts['example']['county']}, 100 acres of grazing. Bars: what it would have paid. Dashes: your premium."
        size = 17
        while size > 11 and dr.textlength(cap, font=font(sans, size * S)) > (right - left) - 170 * S:
            size -= 1
        dr.text(((left + right) / 2, base + 10 * S), cap, font=font(sans, size * S), fill=MUTED, anchor="ma")
    dr.text(((W - 64) * S, 58 * S), "agsist.com/prf", font=font(mono_b, 22 * S), fill=TEXT, anchor="ra")
    out = os.path.join(ROOT, "img/og/prf.jpg")
    im.resize((W, H), Image.LANCZOS).save(out, "JPEG", quality=88, optimize=True, progressive=True)
    print("wrote", out, os.path.getsize(out), "bytes")


if __name__ == "__main__":
    sys.exit(main())
