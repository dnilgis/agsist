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
    # 2026-10-15: the site's "picture from the data" share card
    # (scripts/share_cards.py): the example grid's years as bars, the answer in
    # the green band under them.
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import share_cards as SC
    ex = facts.get("example_years")
    if not ex:
        raise SystemExit("facts.json has no example_years")
    paid = ex["paid"]
    pic = ("yearbars", {
        "values": paid, "line": ex["you"], "line_label": "your premium",
        "first": ex["first"], "last": ex["last"],
        "legend": (f"Example: grid {facts['example']['grid']}, {facts['example']['county']}, 100 acres of grazing. "
                   "Bars: what it would have paid."),
    })
    head = [(f"What your PRF grid would have paid, every year since {meta['years']['first']}", False)]
    meta_line = (f"{meta['counts']['grids']:,} grids  ·  {meta['counts']['states']} states  ·  "
                 f"sign-up deadline {deadline}  ·  agsist.com/prf")
    data = SC.card_c(head, meta_line, f"PRF, crop year {meta['crop_year']}", pic)
    out = os.path.join(ROOT, "img/og/prf.jpg")
    with open(out, "wb") as f:
        f.write(data)
    alt = (f"PRF insurance: what grid {facts['example']['grid']} in {facts['example']['county']} would have paid "
           f"each year from {ex['first']} to {ex['last']}, with the premium as a dashed line. "
           f"Sign-up deadline {deadline}.")
    print("alt:", alt)
    print("wrote", out, os.path.getsize(out), "bytes")


if __name__ == "__main__":
    sys.exit(main())
