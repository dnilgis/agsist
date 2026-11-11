#!/usr/bin/env python3
"""
THE RATE CARD AND THE SALES PAGE MUST AGREE.

data/rate-card.json exists because three surfaces quote prices -- sponsor.html,
about.html, and each sponsor's own portal -- and until 2026-09-13 the only copy
was prose typed into the HTML. data/supporters.json already carried the warning
in its own comment: "keep in sync with sponsor.html and about.html". A price
kept in sync by hand is a price that will be wrong the first time one changes.

This does NOT rewrite the pitch. sponsor.html is a hand-built sales page and its
argument is not generated. What it checks is that every price in the rate card
is still findable on the page that sells it, and that the supporters cap matches
the file that renders the strip. A number that disagrees with itself in public
is the only failure worth failing for.

    python3 scripts/test_rate_card.py
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CARD = ROOT / "data" / "rate-card.json"
SUPPORTERS = ROOT / "data" / "supporters.json"
PITCH = ROOT / "sponsor.html"
# Every page that sells a slot or quotes the card (Oct 29, 2026).
SELLING = ("sponsor.html",)
STATE_NAMES = {"IL": "Illinois", "MN": "Minnesota", "WI": "Wisconsin", "TX": "Texas", "CA": "California", "NV": "Nevada"}
# Plain numbers the page may print that are not audience figures: terms (10 months, 28 days, 30 days,
# net 30, 90 characters), never a count of readers or views.
TERMS = {"10", "28", "30", "90"}

FAILED = []


def check(ok, name, detail=""):
    print(("  ok    " if ok else "  FAIL  ") + name + ("" if ok else "  — " + str(detail)))
    if not ok:
        FAILED.append(name)
    return ok


def _text(p):
    s = p.read_text()
    s = re.sub(r"<script.*?</script>", " ", s, flags=re.S)
    s = re.sub(r"<style.*?</style>", " ", s, flags=re.S)
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", s)


def stray_numbers(src, prices):
    """Numbers left in a page's text (and its JSON-LD) once the data-a spans, the card's prices,
    the phone number, the og:image hash and the terms are taken out. A stale typed figure such as
    "14,928 page views" or "1,615 citations" is what this finds."""
    s = re.sub(r'<span data-a="[A-Za-z0-9]+">[^<]*</span>', " ", src)
    s = re.sub(r"<style.*?</style>", " ", s, flags=re.S)
    s = re.sub(r"<script(?![^>]*ld\+json)[^>]*>.*?</script>", " ", s, flags=re.S)
    s = re.sub(r'(?:href|src|content|style|class|id|width|height|viewBox|d)="[^"]*"', " ", s)
    s = re.sub(r'"(?:url|item|@id|position|price)":\s*"?[^",}]*"?', " ", s)
    s = re.sub(r"<[^>]+>", " ", s)
    s = re.sub(r"&#?[a-z0-9]+;", " ", s)
    s = re.sub(r"\$(\d{1,3}(?:,\d{3})+|\d+)", lambda m: " " if int(m.group(1).replace(",", "")) in prices else m.group(0), s)
    s = re.sub(r"\b\d{3}-\d{3}-\d{4}\b|\bW-9\b", " ", s)
    return [x for x in re.findall(r"\$?\d[\d,.]*", s) if x.rstrip(".,") not in TERMS]


def main():
    if not CARD.exists():
        print("FAIL: data/rate-card.json missing")
        return 1
    card = json.loads(CARD.read_text())
    tiers = card.get("tiers") or []

    print("the card is well formed: two spots only (Nov 11, 2026)")
    ids = [t.get("id") for t in tiers]
    check(ids == ["sitewide", "state"], "the card sells exactly the sitewide line and the state card", ids)
    for t in tiers:
        check(isinstance(t.get("price_month"), int) and t["price_month"] > 0,
              "%s carries a monthly price" % t.get("id"), t.get("price_month"))
        check("price_week" not in t, "%s carries no leftover weekly price" % t.get("id"))
        check(bool(t.get("placement")), "%s says where the ad goes" % t.get("id"))
    check(card.get("year_months") == 10, "a year costs 10 months", card.get("year_months"))
    sw = next((t for t in tiers if t["id"] == "sitewide"), None)
    check(sw is not None and sw.get("slots") == 1 and sw.get("price_month") == 750, "one sitewide sponsor at $750 a month", sw)

    print("\nevery price in the card is on the page that sells it")
    pitch = _text(PITCH)
    prices = {t["price_month"] for t in tiers} | {p for t in tiers for p in (t.get("price_by_state") or {}).values()}
    prices |= {p * card.get("year_months", 10) for p in prices}
    for t in tiers:
        p = t["price_month"]
        pat = re.compile(r"\$%s\s*(?:/\s*mo|\s*(?:per|a)\s+month)" % "{:,}".format(p).replace(",", ","))
        check(bool(pat.search(pitch)), "$%d (%s) appears on sponsor.html" % (p, t["id"]), "not found: the card and the page have drifted")
    check(("$%s a year" % "{:,}".format(sw["price_month"] * card["year_months"])) in pitch, "the sitewide year price is on sponsor.html")

    print("\nthe State Sponsor's state prices and the opening note are on the page")
    st = next((t for t in tiers if t["id"] == "state"), None)
    check(st is not None and st.get("one_per_state") is True, "the card has a State Sponsor, one per state")
    if st:
        for code, p in sorted((st.get("price_by_state") or {}).items()):
            check(isinstance(p, int) and p > st["price_month"], "%s pays more than the base state price" % code, p)
            check(bool(re.search(r"\$%d\s*(?:/\s*mo|\s*(?:per|a)\s+month)" % p, pitch)), "$%d (%s) appears on sponsor.html" % (p, code))
            check(STATE_NAMES[code] in pitch, "%s is named on sponsor.html" % STATE_NAMES[code])
        soon = st.get("opens_soon") or []
        m_ = re.search(r"([A-Z][a-z]+(?: [A-Z][a-z]+)*(?:, [A-Z][a-z]+(?: [A-Z][a-z]+)*)*(?: and [A-Z][a-z]+(?: [A-Z][a-z]+)*)?) opens? soon", pitch)
        said = set(re.split(r", | and ", m_.group(1))) if m_ else set()
        check(said == {STATE_NAMES.get(c, c) for c in soon}, "sponsor.html names exactly the states that open soon", (said, soon))
        geo_ = json.loads((ROOT / "data" / "geo-sponsors.json").read_text())
        held = {c for e in geo_.get("sponsors") or [] if e.get("active") is True for c in e.get("states") or []}
        check(held <= set(soon), "every state an active geo test runs in is held on the card (opens_soon)", (sorted(held), soon))

    print("\nthe terms on the card are the terms on the page")
    for k in ("pay", "refund", "terms", "prepay", "paperwork", "review"):
        check(bool(card.get(k)), "the card states its %s" % k)
    for k in ("trial", "day30", "founding"):
        check(k not in card, "the card carries no %s (no free month, no day-30 email, no founding rate)" % k)
    check("W-9 on request" in pitch, "W-9 line on sponsor.html")
    check("A year costs the same as 10 months" in pitch, "the year-for-10-months term is on sponsor.html")
    check("Money back if you ask inside 30 days" in pitch, "money back inside 30 days is on sponsor.html")
    check("net 30" in pitch and "yearly invoice" in pitch, "the mailed yearly invoice (net 30) is on sponsor.html")
    check("within one business day" in pitch, "live within one business day is on sponsor.html")
    links = card.get("pay_links") or {}
    check(set(links) == {"sitewide", "state"}, "card links per spot", sorted(links))
    for spot, ls in links.items():
        for k, u in (ls or {}).items():
            check(u == "" or re.fullmatch(r"https://(?:buy|checkout)\.stripe\.com/[^\s\"'<>]+", u) is not None,
                  "pay link %s.%s is empty or a Stripe link" % (spot, k), u)
    check("insurance" not in card, "the card carries no insurance line")
    for page in ("sponsor.html", "prf-sponsor.html", "prf-sponsor-kit.html", "terms.html"):
        t_ = _text(ROOT / page)
        check(not any(x in t_ for x in ("also owns", "may compete", "never takes a sponsor", "Loke Drone")),
              "no owner disclosure on %s" % page)

    print("\nretired spots are gone from the page that sells (Nov 11, 2026)")
    retired = [k for k in (card.get("retired") or {}) if not k.startswith("_")]
    check(set(retired) == {"daily", "cashbids", "page", "supporter"} and not (set(retired) & set(ids)),
          "the Daily, Cash Bids, Own a page and Supporter tiers are retired, and no live tier reuses their ids", retired)
    for page in SELLING:
        t_ = _text(ROOT / page)
        for bad in ("free month", "First month free", "founding", "Founding", "Featured listing", "Daily Sponsor",
                    "Cash Bids Sponsor", "day 30", "Own a page"):
            check(bad not in t_, "%s never offers %r" % (page, bad))
        check(re.search(r"\bSupporters?\b", t_) is None, "%s never offers a Supporter spot" % page)
        check(re.search(r"rate (?:is )?locked", t_, re.I) is None, "%s promises no rate lock" % page)
    for t in tiers:
        check(t["name"] in pitch, "sponsor.html names the %s" % t["name"])
    for stub in ("sponsor-rates.html", "sponsor-kit.html", "sponsor-apply.html"):
        s_ = (ROOT / stub).read_text()
        check('location.replace("/sponsor" + location.search' in s_ and 'rel="canonical" href="https://agsist.com/sponsor"' in s_,
              "%s sends readers to /sponsor and keeps its query" % stub)
    check("<title>Advertise on AGSIST</title>" in PITCH.read_text(), "the page title is Advertise on AGSIST")

    print("\nevery number on the sponsor pages is a price, a term, or a figure written in from data/audience.json")
    sys.path.insert(0, str(ROOT / "scripts"))
    import bake_audience
    r_ = subprocess.run([sys.executable, str(ROOT / "scripts" / "bake_audience.py"), "--check"], capture_output=True, text=True)
    check(r_.returncode == 0, "no audience figure on the pages is behind data/audience.json (bake_audience.py --check)",
          (r_.stdout + r_.stderr).strip()[-300:])
    vals = bake_audience.load()
    for page in bake_audience.PAGES:
        src = (ROOT / page).read_text()
        keys = [m.group(2) for m in bake_audience.SPAN.finditer(src)]
        check(len(keys) >= 4, "%s carries its figures in data-a spans" % page, keys)
        check(all(k in vals for k in keys), "%s: every span has a source" % page, [k for k in keys if k not in vals])
        stray = stray_numbers(src, prices)
        check(not stray, "%s: no number typed outside a span" % page, stray[:8])

    print("\nevery slot price on the site is the card's price")
    r = subprocess.run([sys.executable, str(ROOT / "scripts" / "stamp_rates.py"), "--check"],
                       capture_output=True, text=True)
    check(r.returncode == 0, "every ribbon's price matches the card (scripts/stamp_rates.py --check)",
          (r.stdout + r.stderr).strip()[-300:])

    print("\nan unsold page ribbon carries no price and no text, only its slot id (Sig, 2026-10-19)")
    import stamp_rates
    ribbons, bad = 0, []
    for p in stamp_rates.pages():
        s = p.read_text(encoding="utf-8")
        for m in re.finditer(r'<aside class="ag-sponsor-ribbon"([^>]*)>(.*?)</aside>', s, re.S):
            ribbons += 1
            if m.group(2).strip() or not re.search(r'\sdata-slot="[a-z0-9-]+"', m.group(1)):
                bad.append(str(p.relative_to(ROOT)))
        if 'class="ag-sponsor-ribbon"' in s and re.search(r"first month free|data-rate=", s, re.I) \
                and p.name not in ("sponsor.html", "sponsor-apply.html"):
            bad.append(str(p.relative_to(ROOT)) + " (price text)")
    check(ribbons >= 75, "the ribbons are still found (%d)" % ribbons, ribbons)
    check(not bad, "every unsold ribbon is an empty aside with data-slot", bad[:6])
    slots = json.loads((ROOT / "data" / "sponsor-slots.json").read_text())["slots"]
    check(len(slots) == ribbons and all(e.get("pitch") for e in slots),
          "every slot keeps its pitch in data/sponsor-slots.json", "%d slots, %d ribbons" % (len(slots), ribbons))
    loader = (ROOT / "components" / "loader.js").read_text()
    fill = loader[loader.index("function fillPageRibbons"):loader.index("function loadSponsorMetrics")]
    check("getAttribute('data-slot')" in fill, "loader.js reads the slot from data-slot, so a sold slot still fills")


    print("\na free test quotes no price the card does not, and says it is free (Oct 28, 2026)")
    conf = json.loads((ROOT / "data" / "sponsors.json").read_text())
    ids_ = {t["id"] for t in tiers}
    portal = (ROOT / "sponsor-report.html").read_text()
    for sp_ in conf.get("sponsors", []):
        b_ = sp_.get("billing") or {}
        if b_.get("free_test") is True:
            check(b_.get("tier") in ids_, "%s: the greyed plan is a tier on the card" % sp_["slug"], b_.get("tier"))
            check(not any(k in b_ for k in ("price", "price_month", "rate", "discount")),
                  "%s: no price is typed into a free deal" % sp_["slug"], b_)
    check("Free test: no charge" in portal and "d.freeTest" in portal, "the portal labels a free test in plain words")
    check(re.search(r"\$\s*0\b|\bfree forever\b", portal, re.I) is None, "the portal never prints a $0 price the card does not have")
    print()
    if FAILED:
        print("FAILED (%d): %s" % (len(FAILED), "; ".join(FAILED)))
        return 1
    print("rate card: all passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
