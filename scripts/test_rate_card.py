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
SELLING = ("sponsor.html", "sponsor-apply.html", "sponsor-kit.html")
STATE_NAMES = {"IL": "Illinois", "MN": "Minnesota", "WI": "Wisconsin", "TX": "Texas", "CA": "California", "NV": "Nevada"}
# Plain numbers the pages may print that are not audience figures: terms (5 sponsors, 24 months,
# 12 for 10, day 30, 28 days, 50 words, 250 KB), never a count of readers or views.
TERMS = {"5", "10", "12", "24", "28", "30", "50", "250"}

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
    s = re.sub(r"\$(\d+)", lambda m: " " if int(m.group(1)) in prices else m.group(0), s)
    s = re.sub(r"\b\d{3}-\d{3}-\d{4}\b|\bW-9\b", " ", s)
    return [x for x in re.findall(r"\$?\d[\d,.]*", s) if x.rstrip(".,") not in TERMS]


def main():
    if not CARD.exists():
        print("FAIL: data/rate-card.json missing")
        return 1
    card = json.loads(CARD.read_text())
    tiers = card.get("tiers") or []

    print("the card is well formed")
    check(len(tiers) >= 1, "it has tiers")
    ids = [t.get("id") for t in tiers]
    check(len(ids) == len(set(ids)), "tier ids are unique", ids)
    for t in tiers:
        check(isinstance(t.get("price_month"), int) and t["price_month"] > 0,
              "%s carries a monthly price" % t.get("id"), t.get("price_month"))
        check("price_week" not in t,
              "%s carries no leftover weekly price" % t.get("id"),
              "two prices for one tier is two answers to one question")
        check(bool(t.get("placement")), "%s says where the ad goes" % t.get("id"))

    print("\nevery price in the card is still on the page that sells it")
    pitch = _text(PITCH)
    prices = {t["price_month"] for t in tiers} | {p for t in tiers for p in (t.get("price_by_state") or {}).values()}
    for t in tiers:
        p = t["price_month"]
        # "$149 / month", "$149/month", "$149/mo", "$149 a month" all count.
        pat = re.compile(r"\$%d\s*(?:/\s*mo|\s*(?:per|a)\s+month)" % p)
        check(bool(pat.search(pitch)),
              "$%d (%s) appears on sponsor.html" % (p, t["id"]),
              "not found — the card and the pitch have drifted")

    print("\nthe State Sponsor's state prices and the opening note are on the page (Oct 29, 2026)")
    st = next((t for t in tiers if t["id"] == "state"), None)
    check(st is not None, "the card has a State Sponsor")
    if st:
        for code, p in sorted((st.get("price_by_state") or {}).items()):
            check(isinstance(p, int) and p > st["price_month"], "%s pays more than the base state price" % code, p)
            check(bool(re.search(r"\$%d\s*(?:/\s*mo|\s*(?:per|a)\s+month)" % p, pitch)), "$%d (%s) appears on sponsor.html" % (p, code))
            check(STATE_NAMES[code] in pitch, "%s is named on sponsor.html" % STATE_NAMES[code])
        soon = st.get("opens_soon") or []
        m_ = re.search(r"([A-Z][a-z]+(?: [A-Z][a-z]+)*(?:, [A-Z][a-z]+(?: [A-Z][a-z]+)*)*(?: and [A-Z][a-z]+(?: [A-Z][a-z]+)*)?) opens? soon", pitch)
        said = set(re.split(r", | and ", m_.group(1))) if m_ else set()
        check(said == {STATE_NAMES.get(c, c) for c in soon}, "sponsor.html names exactly the states that open soon", (said, soon))
        # Oct 29, 2026 (Sig, option A): a state a state-targeted test runs in is held, not sold.
        geo_ = json.loads((ROOT / "data" / "geo-sponsors.json").read_text())
        held = {c for e in geo_.get("sponsors") or [] if e.get("active") is True for c in e.get("states") or []}
        check(held <= set(soon), "every state an active geo test runs in is held on the card (opens_soon)", (sorted(held), soon))

    print("\nthe terms on the card are the terms on the page")
    for k in ("trial", "day30", "terms", "prepay", "paperwork", "insurance"):
        check(bool(card.get(k)), "the card states its %s" % k)
    check(card.get("paperwork", "x") in pitch, "W-9 line on sponsor.html", card.get("paperwork"))
    check(re.search(r"12 months for the price of 10|Pay 12 months up front and you pay for 10", pitch) is not None,
          "the 12-for-10 prepay is on sponsor.html")
    check("12" in card.get("prepay", "") and "10" in card.get("prepay", ""), "and on the card")
    f_ = card.get("founding") or {}
    check(("the first %d paying sponsors keep their price for %d months" % (f_.get("sponsors", 0), f_.get("months", 0))) in pitch,
          "the founding rate on sponsor.html matches the card", f_)
    check("No reply means the ad comes down and nothing is owed" in pitch and "day 30" in pitch.lower(),
          "the day-30 yes or no is on sponsor.html")
    for page in ("sponsor.html", "sponsor-kit.html", "about.html", "prf-sponsor.html", "prf-sponsor-kit.html"):
        check(card.get("insurance", "x") in _text(ROOT / page), "the insurance line is on %s" % page)

    print("\nretired tiers are gone from every page that sells (Oct 29, 2026)")
    retired = [k for k in (card.get("retired") or {}) if not k.startswith("_")]
    check(set(retired) == {"page", "supporter"} and not (set(retired) & set(ids)),
          "Supporter and Own a page are retired, and no live tier reuses their ids", retired)
    raw_card = CARD.read_text().lower()
    check("rate locked" not in raw_card and "hail" not in raw_card, "no rate lock and no hail-page note on the card")
    for page in SELLING:
        t_ = _text(ROOT / page)
        check(re.search(r"\bSupporters?\b", t_) is None, "%s never offers a Supporter spot" % page)
        check("Own a page" not in t_ and "own page $29" not in t_, "%s never offers Own a page" % page)
        check(re.search(r"\$15\b", t_) is None, "%s carries no $15 price" % page)
        check(re.search(r"rate (?:is )?locked", t_, re.I) is None, "%s promises no 12-month rate lock" % page)
        check("1,615" not in t_ and "citations a day" not in t_, "%s has no undated Bing citation line" % page)
        for t in tiers:
            check(t["name"] in t_, "%s names the %s" % (page, t["name"]))
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
