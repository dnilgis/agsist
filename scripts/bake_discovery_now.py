#!/usr/bin/env python3
"""
bake_discovery_now.py — what RMA is averaging TODAY, on the tracker page.

WHY THIS EXISTS
---------------
On 2026-08-27, with sixteen price-discovery windows open — Spring wheat in
nineteen states, Winter wheat in nine, Durum in three, plus corn, sorghum,
oats, barley, rye, canola, rice and popcorn, all on day 26 of 31 — the harvest
price tracker showed a June 8th snapshot of corn and soybeans under the
headline "Corn and soybean harvest prices are set in October."

Nothing was broken. `fetch_harvest_prices.py` is corn-and-soybeans by
construction (`MONTH_CODE = {"Dec": "Z", "Nov": "X"}`), and for those two crops
in the Corn Belt "October" is right and will stay right until October. The
scope was the problem, and the data that fixes it was already on disk and
already fresh: `rma-prices.yml` builds `data/rma-prices.json` every day, 951
rows, every crop, type, practice and state, with RMA's own running average.

Nothing read it. This does.

WHAT IT WILL NOT DO
-------------------
**It will not print one number for a crop.** Winter wheat Conventional runs
$6.49 to $7.31 across nine states — an 82-cent spread — and Spring wheat
Organic is $13.20 against Conventional's $6.81. A grower reading "wheat: $6.81"
before an insurance decision would be reading a number that is not theirs. So:
a range whenever the members disagree, the practice always named, and the
per-state figures underneath whenever they differ.

**It will not compute a price.** Every figure here is RMA's, mirrored. The file
says so itself: "Prices whose status is 'In Discovery' are RMA's running
average to date." This script groups, counts days and formats. It never averages.

Usage:
    python3 scripts/bake_discovery_now.py           # bake in place
    python3 scripts/bake_discovery_now.py --check   # verify only, write nothing
"""
import html
import json
import re
import sys
from datetime import datetime, date
from pathlib import Path
from zoneinfo import ZoneInfo

REPO = Path(__file__).resolve().parent.parent
DATA = REPO / "data" / "rma-prices.json"
PAGE = REPO / "harvest-price-tracker.html"
CENTRAL = ZoneInfo("America/Chicago")
OPEN_MARK, CLOSE_MARK = "<!--SEED:discovery-->", "<!--/SEED:discovery-->"

# RMA calls the two legs by these names; the file prefixes them p_ and h_.
LEGS = {"p": "Projected price", "h": "Harvest price"}
# Crops a Corn Belt reader looks for first. Everything else follows, A-Z.
CROP_ORDER = ["Corn", "Soybeans", "Wheat", "Grain Sorghum", "Oats", "Barley"]


def today_central():
    return datetime.now(CENTRAL).date()


def _d(s):
    try:
        return date.fromisoformat(s)
    except (TypeError, ValueError):
        return None


def open_legs(rows, today):
    """Every (row, leg) whose discovery window contains today."""
    out = []
    for r in rows:
        for leg in ("p", "h"):
            s, e = _d(r.get(leg + "_start")), _d(r.get(leg + "_end"))
            if s and e and s <= today <= e:
                out.append((r, leg))
    return out


def group(open_rows):
    """crop · type · leg · practice — the four things that change the price.

    PRACTICE IS PART OF THE KEY AND NOT A FOOTNOTE. Organic spring wheat is
    $13.20 where Conventional is $6.81. Collapsing them would produce a range
    spanning both and a number belonging to neither.
    """
    g = {}
    for r, leg in open_rows:
        # THE WINDOW AND THE CONTRACT ARE PART OF THE KEY. Without them, corn's
        # two open windows -- six states averaging September through Aug 31 and
        # two states averaging DECEMBER through Sep 14 -- merged into one row
        # that took its contract month from whichever happened to be first and
        # printed "September" over both. That is a wrong number in front of a
        # grower, produced by a grouping choice.
        k = (r["crop"], r.get("type") or "", leg, r.get("practice") or "",
             r.get(leg + "_start"), r.get(leg + "_end"),
             r.get(leg + "_mon") or "", r.get(leg + "_exch") or "")
        g.setdefault(k, []).append(r)
    return g


def fmt_money(v):
    if v is None:
        return "&mdash;"
    # RMA quotes some crops per pound (cotton, rice, canola); those come back
    # as fractions of a dollar and must not be rounded to two places.
    s = ("%.4f" % v).rstrip("0").rstrip(".") if abs(v) < 1 else "%.2f" % v
    return "$" + s


def price_span(rows, leg):
    vals = sorted({r[leg + "_price"] for r in rows if r.get(leg + "_price") is not None})
    if not vals:
        return None, None, []
    return vals[0], vals[-1], vals


def esc(s):
    return html.escape(str(s if s is not None else ""), quote=True)


def crop_sort(k):
    crop = k[0]
    return (CROP_ORDER.index(crop) if crop in CROP_ORDER else len(CROP_ORDER),
            crop, k[1], k[2], k[4] if len(k) > 4 else "")


def build(rows, today):
    """A COMPACT national summary, and deliberately not a second detailed view.

    The page already has one. Pick a state and its own script reads
    data/rma-prices.json and renders "Your window" plus "Also in discovery right
    now in <state>", wheat included — and the page says why in its own comment:
    "Generic blocks suppress the moment a state is chosen. That is the whole
    point: picking your state has to make this page shorter, not longer."

    So this is not that. This is the DEFAULT view — what a first-time reader and
    every crawler get before touching the state picker, which on 2026-08-27 was
    "Corn and soybean harvest prices are set in October" over two corn and
    soybean cards, while sixteen windows were open and three of them were wheat.
    One table, suppressed the moment a state is chosen, saying what is being
    averaged today and pointing at the picker for the rest.
    """
    open_rows = open_legs(rows, today)
    if not open_rows:
        return ('<div class="pd-sect">Price discovery today</div>'
                '<p class="hp-lede" style="margin-bottom:.7rem">No RMA discovery '
                'window is open today. The crop-by-crop windows are below.</p>')

    g = group(open_rows)
    cards = {}
    for k in sorted(g, key=crop_sort):
        crop, typ, leg, practice, wstart, wend, mon, exch = k
        cards.setdefault((crop, typ, leg, wstart, wend, mon, exch), {})[practice] = g[k]

    any_leg = next(iter(open_rows))
    ends = sorted({_d(r[leg + "_end"]) for r, leg in open_rows})
    closes = ends[0]
    left = (closes - today).days
    left_txt = ("closing today" if left == 0 else
                "1 day left" if left == 1 else "%d days left" % left)

    out = [
        '<div class="pd-sect">In discovery right now &middot; %s crop year</div>'
        % rows[0].get("year", today.year),
        '<p class="hp-lede" style="margin-bottom:.7rem">USDA RMA is averaging '
        'settlements for <b>%d</b> crop and type combination%s today, the earliest '
        'closing <b>%s</b> (%s). Figures are RMA&rsquo;s own running average to date, '
        'mirrored without recalculation, and <b>none is final until its window '
        'closes</b>. Conventional and Organic are priced separately. '
        '<b>Pick your state above</b> and this page will show only yours, state by '
        'state.</p>' % (len(cards), "" if len(cards) == 1 else "s",
                        closes.strftime("%B %-d"), left_txt),
        '<div class="dn-wrap"><table class="dn-t"><thead><tr>'
        '<th class="c-crop">Crop</th><th class="r c-avg">Conventional</th>'
        '<th class="r c-avg">Organic</th><th class="r c-st">States</th>'
        '</tr></thead><tbody>',
    ]

    for (crop, typ, leg, wstart, wend, mon, exch), practices in cards.items():
        name = crop + ((" &middot; " + esc(typ)) if typ else "")
        states = sorted({r["state"] for rs in practices.values() for r in rs})
        wend_d = _d(wend)

        def cell(practice):
            rs = practices.get(practice)
            if not rs:
                return "<span class='dn-na'>&mdash;</span>"
            lo, hi, _ = price_span(rs, leg)
            if lo is None:
                return "<span class='dn-na'>pending</span>"
            # A RANGE WHENEVER THE STATES DISAGREE. Winter wheat Conventional
            # runs $6.49 to $7.31 across nine states; one number would be nobody's.
            return fmt_money(lo) if lo == hi else fmt_money(lo) + "&ndash;" + fmt_money(hi)

        # THE CONTRACT SITS UNDER THE CROP NAME, NOT IN ITS OWN COLUMN. As a
        # column it was the first thing to scroll off a phone -- and it is the
        # only thing distinguishing three rows that all read "Wheat - Winter":
        # six states on August CBOT at $6.49, two on September KCBT at $7.31,
        # one on September CBOT at $6.57. Three identical labels over three
        # different prices is worse than no table.
        out.append('<tr><td class="c-crop"><span class="dn-cn">%s</span>'
                   '<span class="dn-cx">%s%s &middot; closes %s</span></td>'
                   '<td class="r dn-p c-avg">%s</td><td class="r dn-p c-avg">%s</td>'
                   '<td class="r c-st">%d</td></tr>'
                   % (name, esc(mon), esc(" " + exch if exch else ""),
                      wend_d.strftime("%b %-d") if wend_d else "unknown",
                      cell("Conventional"), cell("Organic"), len(states)))

    out.append("</tbody></table></div>")
    out.append('<div class="dn-st">%s leg. Source: USDA RMA Price Discovery, read %s. '
               'The official price is RMA&rsquo;s.</div>'
               % (esc(LEGS[any_leg[1]]), today.strftime("%B %-d, %Y")))
    return "\n      ".join(out)


def main():
    check = "--check" in sys.argv
    doc = json.loads(DATA.read_text(encoding="utf-8"))
    rows = doc.get("rows") or []
    if not rows:
        print("[discovery] %s has no rows; nothing baked." % DATA.name, file=sys.stderr)
        return 3
    today = today_central()
    block = OPEN_MARK + "\n      " + build(rows, today) + "\n      " + CLOSE_MARK

    src = PAGE.read_text(encoding="utf-8")
    pat = re.compile(re.escape(OPEN_MARK) + ".*?" + re.escape(CLOSE_MARK), re.S)
    if not pat.search(src):
        print("[discovery] SEED:discovery markers missing from %s" % PAGE.name, file=sys.stderr)
        return 4
    out = pat.sub(lambda _: block, src, count=1)

    n_open = len(open_legs(rows, today))
    if check:
        print("[discovery] --check: %d open legs today; page %s"
              % (n_open, "already in sync" if out == src else "WOULD CHANGE"))
        return 0
    if out == src:
        print("[discovery] %d open legs; page already in sync." % n_open)
        return 0
    PAGE.write_text(out, encoding="utf-8")
    print("[discovery] baked %d open legs into %s" % (n_open, PAGE.name))
    return 0


if __name__ == "__main__":
    sys.exit(main())
