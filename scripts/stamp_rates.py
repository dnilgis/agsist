#!/usr/bin/env python3
"""
PRICES FROM THE RATE CARD, AND THE OPEN SPONSOR SLOTS.

Prices are written from data/rate-card.json into <span ... data-rate="TIER">...</span>,
and nowhere by hand. A price typed into eighty pages is eighty copies that will
disagree the first time it changes (2026-10-07: the footer said $25/week while
the card had moved on). The sponsor kit pages (/sponsor, /sponsor-apply) keep
their prices this way.

An UNSOLD "Sponsor this page" ribbon carries no text at all (Sig, 2026-10-19):
since 2026-10-11 it is hidden on the page (components/styles.css), and the
"$29/mo, first month free" it still carried was read only by crawlers that skip
CSS. Each ribbon is now an empty aside with the slot id and nothing else:

    <aside class="ag-sponsor-ribbon" data-slot="whats-priced-in"></aside>

components/loader.js reads data-slot and fills the aside when the slot is sold.
The pitch the sign-up form shows lives in data/sponsor-slots.json: an old
ribbon's pitch is read once, as it is emptied, and kept there after.

    python3 scripts/stamp_rates.py            rewrite every data-rate span; empty every unsold ribbon to its
                                              slot id; write data/sponsor-slots.json
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


def label(card, tier):
    t = next((x for x in card["tiers"] if x["id"] == tier), None)
    if t is None:
        raise SystemExit("data-rate=%r: no such tier in data/rate-card.json" % tier)
    return "$%d/mo &middot; first month free" % t["price_month"]


def pages():
    out = []
    # cash-bids/<state>/index.html: one slot per state; its town pages carry the same
    # data-slot (scripts/build_cash_bid_pages.py) and are not read here.
    for pat in ("*.html", "rent/*.html", "basis/*.html", "yield/*.html", "hail-map/*.html", "prf/*.html",
                "cash-bids/*/index.html", "components/*.html"):
        out += sorted(ROOT.glob(pat))
    return out


SLOTS = ROOT / "data" / "sponsor-slots.json"
# An unsold page ribbon. The class is exactly "ag-sponsor-ribbon": sold and
# PRF ribbons (built in the browser) and the homepage idx1-sponsor carry more.
RIBBON = re.compile(r'<aside class="ag-sponsor-ribbon"([^>]*)>(.*?)</aside>', re.S)
SLOT_ATTR = re.compile(r'\sdata-slot="([a-z0-9-]+)"')
SLOT_ID = re.compile(r'href="/sponsor(?:-apply)?\?slot=([a-z0-9-]+)')


def empty_ribbon(attrs, sid):
    attrs = SLOT_ATTR.sub("", attrs)
    return '<aside class="ag-sponsor-ribbon"%s data-slot="%s"></aside>' % (attrs, sid)


NAMES = {"whats-priced-in": "What's Priced In", "breakeven": "Break-Even Calculator",
         "conditions-yield": "Ratings vs Yield", "conditions": "Crop Conditions", "basis": "Basis vs Normal",
         "elevators": "Elevator Coverage Map", "fast-facts": "Reference Tables",
         "foreign-land": "Foreign-Owned Land", "spray": "Spray Advisory", "urea": "Urea Volatilization Risk",
         "archive": "Daily Archive", "tools": "All Tools", "cash-lease": "Cash Farm Lease"}


def ribbon_slot(inner, attrs):
    """(slot id, pitch or None) for one unsold ribbon."""
    m = SLOT_ATTR.search(attrs) or SLOT_ID.search(inner)
    if not m:
        return None, None
    pitch = re.sub(r'<span class="ag-sponsor-(?:tag|price)"[^>]*>.*?</span>|<a\b.*?</a>', "", inner, flags=re.S)
    pitch = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", pitch)).strip()
    return m.group(1), (__import__("html").unescape(pitch) or None)


def slot_entry(rel, text, known):
    m = RIBBON.search(text)
    if not m:
        return None
    sid, pitch = ribbon_slot(m.group(2), m.group(1))
    if not sid:
        return None
    url = "/" + rel[:-5].replace("index", "").rstrip("/") if rel.endswith(".html") else "/" + rel
    # A stable name from the address, not the <title>: several titles carry the
    # day's reading ("Weak in 6 of 10 USDA Regions") and would churn this file.
    parts = [x for x in url.split("/") if x]
    words = lambda x: " ".join(w if w in ("COT", "USDA", "GDU") else w.capitalize()
                               for w in x.replace("-", " ").replace("cot", "COT").replace("usda", "USDA").replace("gdu", "GDU").split())
    if parts and parts[0] == "prf" and len(parts) > 1:
        name = "PRF insurance in " + words(parts[1])
    elif parts and parts[0] == "cash-bids" and len(parts) > 1:
        name = words(parts[1]) + " cash bids"
        pitch = pitch or (known.get(sid) or {}).get("pitch") or (
            "Your name beside the cash bids on the %s page and every %s town page. One category-exclusive slot."
            % (words(parts[1]), words(parts[1])))
    elif parts and parts[0] == "rent":
        name = (words(parts[1]) + " cash rent") if len(parts) > 1 else "Cash rent by state"
    else:
        name = NAMES.get(parts[-1]) or words(parts[-1]) if parts else "Home"
    # The pitch: off an old ribbon that still carries one, else as kept in
    # data/sponsor-slots.json, else a plain line from the page name.
    pitch = pitch or (known.get(sid) or {}).get("pitch") or ("Your name on the %s page. One category-exclusive slot." % name)
    return {"id": sid, "page": url or "/", "name": name, "pitch": pitch}


def stamp(text, card):
    def ribbon(m):
        sid, _ = ribbon_slot(m.group(2), m.group(1))
        return empty_ribbon(m.group(1), sid) if sid else m.group(0)
    text = RIBBON.sub(ribbon, text)
    return SPAN.sub(lambda m: m.group(1) + label(card, m.group(2)) + m.group(4), text)


def main():
    check = "--check" in sys.argv
    card = json.loads(CARD.read_text())
    drift, slots = [], []
    have = SLOTS.read_text() if SLOTS.exists() else ""
    known = {e["id"]: e for e in (json.loads(have).get("slots", []) if have else [])}
    for p in pages():
        s = p.read_text(encoding="utf-8")
        if "data-rate=" not in s and "ag-sponsor-ribbon" not in s:
            continue
        e = slot_entry(str(p.relative_to(ROOT)), s, known)
        new = stamp(s, card)
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
