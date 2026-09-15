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
        check(isinstance(t.get("price_week"), int) and t["price_week"] > 0,
              "%s carries a weekly price" % t.get("id"), t.get("price_week"))
        check(bool(t.get("placement")), "%s says where the ad goes" % t.get("id"))

    print("\nevery price in the card is still on the page that sells it")
    pitch = _text(PITCH)
    for t in tiers:
        p = t["price_week"]
        # "$100 / week", "$100/week", "$100/wk", "$100 /week" all count.
        pat = re.compile(r"\$%d\s*(?:/|\s*per\s)" % p)
        check(bool(pat.search(pitch)),
              "$%d (%s) appears on sponsor.html" % (p, t["id"]),
              "not found — the card and the pitch have drifted")

    fnd = next((t for t in tiers if t["id"] == "founding"), None)
    if fnd and fnd.get("year_equivalent"):
        yr = fnd["year_equivalent"]
        check(yr == fnd["price_week"] * 52,
              "the annual figure is 52 weeks of the weekly one", "%s vs %s" % (yr, fnd["price_week"] * 52))
        check(("$%s" % f"{yr:,}") in pitch or ("$%d" % yr) in pitch,
              "and it is the figure the page quotes", yr)

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
