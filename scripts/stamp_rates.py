#!/usr/bin/env python3
"""
PRICES ON THE OPEN SPONSOR SLOTS, FROM THE RATE CARD.

Every open slot on the site -- the 79 "Sponsor this page" ribbons, the
homepage "Become a sponsor" chip, the footer's open slot -- shows what it
costs. Those prices are written here from data/rate-card.json, into
<span ... data-rate="TIER">...</span>, and nowhere by hand. A price typed into
eighty pages is eighty copies that will disagree the first time it changes
(2026-10-07: the footer said $25/week while the card had moved on).

    python3 scripts/stamp_rates.py            rewrite every data-rate span; add one to any ribbon missing it;
                                              point every ribbon at /sponsor-apply; write data/sponsor-slots.json
    python3 scripts/stamp_rates.py --check    exit 1 on drift, write nothing (scripts/test_rate_card.py runs this)

data/sponsor-slots.json is the list the sign-up form offers (2026-10-07): one
entry per ribbon, read off the pages themselves, so a page that gains or
loses a ribbon is offered or withdrawn without anyone editing a list.

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


SLOTS = ROOT / "data" / "sponsor-slots.json"
RIBBON = re.compile(r'<aside class="ag-sponsor-ribbon"[^>]*>(.*?)</aside>', re.S)
SLOT_ID = re.compile(r'href="/sponsor(?:-apply)?\?slot=([a-z0-9-]+)')
OLD_HREF = re.compile(r'(<aside class="ag-sponsor-ribbon"(?:(?!</aside>).)*?href=")/sponsor\?slot=', re.S)


NAMES = {"whats-priced-in": "What's Priced In", "breakeven": "Break-Even Calculator",
         "presell-calculator": "Pre-Sell Calculator", "cash-rent": "Cash Rent by County",
         "conditions-yield": "Ratings vs Yield", "conditions": "Crop Conditions", "basis": "Basis vs Normal",
         "elevators": "Elevator Coverage Map", "fast-facts": "Reference Tables", "land-tenure": "Rented vs Owner-Farmed",
         "foreign-land": "Foreign-Owned Land", "spray": "Spray Advisory", "urea": "Urea Volatilization Risk",
         "archive": "Daily Archive", "tools": "All Tools", "cash-lease": "Cash Farm Lease"}


def slot_entry(rel, text):
    m = RIBBON.search(text)
    if not m:
        return None
    sid = SLOT_ID.search(m.group(1))
    if not sid:
        return None
    pitch = re.sub(r'<span class="ag-sponsor-(?:tag|price)"[^>]*>.*?</span>|<a\b.*?</a>', "", m.group(1), flags=re.S)
    pitch = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", pitch)).strip()
    url = "/" + rel[:-5].replace("index", "").rstrip("/") if rel.endswith(".html") else "/" + rel
    # A stable name from the address, not the <title>: several titles carry the
    # day's reading ("Weak in 6 of 10 USDA Regions") and would churn this file.
    parts = [x for x in url.split("/") if x]
    words = lambda x: " ".join(w if w in ("COT", "USDA", "GDU") else w.capitalize()
                               for w in x.replace("-", " ").replace("cot", "COT").replace("usda", "USDA").replace("gdu", "GDU").split())
    if parts and parts[0] == "rent":
        name = (words(parts[1]) + " cash rent") if len(parts) > 1 else "Cash rent by state"
    else:
        name = NAMES.get(parts[-1]) or words(parts[-1]) if parts else "Home"
    return {"id": sid.group(1), "page": url or "/", "name": name,
            "pitch": __import__("html").unescape(pitch)}


def stamp(text, card):
    text = OLD_HREF.sub(lambda m: m.group(1) + "/sponsor-apply?slot=", text)
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
    drift, slots = [], []
    for p in pages():
        s = p.read_text(encoding="utf-8")
        if "data-rate=" not in s and "ag-sponsor-ribbon" not in s:
            continue
        new = stamp(s, card)
        e = slot_entry(str(p.relative_to(ROOT)), new)
        if e:
            slots.append(e)
        if new != s:
            drift.append(str(p.relative_to(ROOT)))
            if not check:
                p.write_text(new, encoding="utf-8")
    slots.sort(key=lambda e: (e["page"].count("/"), e["page"]))
    ids = [e["id"] for e in slots]
    dup = sorted({i for i in ids if ids.count(i) > 1})
    if dup:
        raise SystemExit("two ribbons share a slot id: %s" % ", ".join(dup))
    want = json.dumps({"_": "Every open page slot, read off the ribbons by scripts/stamp_rates.py. Do not edit by hand.",
                       "slots": slots}, indent=1, ensure_ascii=False) + "\n"
    have = SLOTS.read_text() if SLOTS.exists() else ""
    if want != have:
        drift.append("data/sponsor-slots.json")
        if not check:
            SLOTS.write_text(want)
    if check:
        print("rate stamps: %s" % ("in sync" if not drift else "%d file(s) drifted: %s" % (len(drift), ", ".join(drift[:8]))))
        return 1 if drift else 0
    print("rate stamps: rewrote %d file(s)" % len(drift))
    return 0


if __name__ == "__main__":
    sys.exit(main())
