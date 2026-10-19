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
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CARD = ROOT / "data" / "rate-card.json"
SUPPORTERS = ROOT / "data" / "supporters.json"
PITCH = ROOT / "sponsor.html"

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
    for t in tiers:
        p = t["price_month"]
        # "$149 / month", "$149/month", "$149/mo", "$149 a month" all count.
        pat = re.compile(r"\$%d\s*(?:/\s*mo|\s*(?:per|a)\s+month)" % p)
        check(bool(pat.search(pitch)),
              "$%d (%s) appears on sponsor.html" % (p, t["id"]),
              "not found — the card and the pitch have drifted")

    fnd = next((t for t in tiers if t["id"] == "daily"), None)
    if fnd and fnd.get("year_equivalent"):
        yr = fnd["year_equivalent"]
        check(yr == fnd["price_month"] * 12,
              "the annual figure is 12 months of the monthly one", "%s vs %s" % (yr, fnd["price_month"] * 12))
        check(("$%s" % f"{yr:,}") in pitch or ("$%d" % yr) in pitch,
              "and it is the figure the page quotes", yr)

    print("\nevery slot price on the site is the card's price")
    import subprocess
    r = subprocess.run([sys.executable, str(ROOT / "scripts" / "stamp_rates.py"), "--check"],
                       capture_output=True, text=True)
    check(r.returncode == 0, "every ribbon's price matches the card (scripts/stamp_rates.py --check)",
          (r.stdout + r.stderr).strip()[-300:])

    print("\nan unsold page ribbon carries no price and no text, only its slot id (Sig, 2026-10-19)")
    sys.path.insert(0, str(ROOT / "scripts"))
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

    print("\nthe supporter cap is the one the strip renders")
    sup = next((t for t in tiers if t["id"] == "supporter"), None)
    if sup and SUPPORTERS.exists():
        s = json.loads(SUPPORTERS.read_text())
        check(sup.get("slots") == s.get("cap"),
              "rate-card supporter slots == supporters.json cap",
              "%s vs %s" % (sup.get("slots"), s.get("cap")))

    print()
    if FAILED:
        print("FAILED (%d): %s" % (len(FAILED), "; ".join(FAILED)))
        return 1
    print("rate card: all passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
