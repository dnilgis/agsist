#!/usr/bin/env python3
"""
PRICES ON THE OPEN SPONSOR SLOTS, FROM THE RATE CARD.

Every open slot on the site -- the 79 "Sponsor this page" ribbons, the
homepage "Become a sponsor" chip, the footer's open slot -- shows what it
costs. Those prices are written here from data/rate-card.json, into
<span ... data-rate="TIER">...</span>, and nowhere by hand. A price typed into
eighty pages is eighty copies that will disagree the first time it changes
(2026-10-07: the footer said $25/week while the card had moved on).

    python3 scripts/stamp_rates.py            rewrite every data-rate span; add one to any ribbon missing it
    python3 scripts/stamp_rates.py --check    exit 1 on drift, write nothing (scripts/test_rate_card.py runs this)

Change a price in data/rate-card.json, run this, commit both.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CARD = ROOT / "data" / "rate-card.json"

SPAN = re.compile(r'(<span\b[^>]*\bdata-rate="([a-z]+)"[^>]*>)(.*?)(</span>)', re.S)
# A ribbon's link to the sponsor page, with no price span before it yet.
RIBBON_LINK = re.compile(r'(<aside class="ag-sponsor-ribbon"[^>]*>(?:(?!</aside>).)*?)(<a href="/sponsor)', re.S)


def label(card, tier):
    t = next((x for x in card["tiers"] if x["id"] == tier), None)
    if t is None:
        raise SystemExit("data-rate=%r: no such tier in data/rate-card.json" % tier)
    return "$%d/mo &middot; first month free" % t["price_month"]


def pages():
    out = []
    for pat in ("*.html", "rent/*.html", "basis/*.html", "yield/*.html", "hail-map/*.html",
                "components/*.html"):
        out += sorted(ROOT.glob(pat))
    return out


def stamp(text, card):
    def ribbon(m):
        if 'data-rate=' in m.group(1):
            return m.group(0)
        return (m.group(1) + '<span class="ag-sponsor-price" data-rate="page">'
                + label(card, "page") + '</span> ' + m.group(2))
    text = RIBBON_LINK.sub(ribbon, text)
    return SPAN.sub(lambda m: m.group(1) + label(card, m.group(2)) + m.group(4), text)


def main():
    check = "--check" in sys.argv
    card = json.loads(CARD.read_text())
    drift = []
    for p in pages():
        s = p.read_text(encoding="utf-8")
        if "data-rate=" not in s and "ag-sponsor-ribbon" not in s:
            continue
        new = stamp(s, card)
        if new != s:
            drift.append(str(p.relative_to(ROOT)))
            if not check:
                p.write_text(new, encoding="utf-8")
    if check:
        print("rate stamps: %s" % ("in sync" if not drift else "%d file(s) drifted: %s" % (len(drift), ", ".join(drift[:8]))))
        return 1 if drift else 0
    print("rate stamps: rewrote %d file(s)" % len(drift))
    return 0


if __name__ == "__main__":
    sys.exit(main())
