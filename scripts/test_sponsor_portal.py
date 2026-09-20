#!/usr/bin/env python3
"""
THE SPONSOR PORTAL: WHAT IT PROMISES AND WHAT IT MUST NOT DO.

sponsor-report.html is the one page a paying sponsor sees. It carries their
numbers, the copy they are being asked to approve, and the links they will
check against their own analytics. Three ways it can be wrong, all silent:

  1. It shows an approved badge over copy that changed after approval.
  2. It shows one surface's tagged link as if it were another's, so the
     sponsor's own numbers never reconcile with ours.
  3. It quotes a price /sponsor does not.

(3) is scripts/test_rate_card.py. This is (1) and (2), plus the shape the page
actually reads.

    python3 scripts/test_sponsor_portal.py

No network. Reads data/sponsor.json, data/rate-card.json and the page itself.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import build_sponsor_report as bsr          # noqa: E402
import sponsor_links as sl                  # noqa: E402

PAGE = ROOT / "sponsor-report.html"
FAILED = []


def check(ok, name, detail=""):
    print(("  ok    " if ok else "  FAIL  ") + name + ("" if ok else "  — " + str(detail)))
    if not ok:
        FAILED.append(name)
    return ok


def main():
    print("the proof code tracks the words a reader sees")
    base = {"advertiser": "A Co", "headline": "Head", "body": "Body",
            "facts": ["40+ carriers", "13 offices"], "cta_text": "Go",
            "cta_url": "https://a.example/", "phone": "715-555-0100",
            "logo": "/img/sponsors/a.webp", "disclosure": "Disc"}
    c0 = bsr.proof_code(base)
    check(bool(c0) and len(c0) == 8, "it is eight hex characters", c0)
    # PIN THE LIST, DO NOT LOOP OVER IT. Looping over CREATIVE_FIELDS means
    # deleting a field also deletes its own check: dropping "body" left this
    # green while the body text stopped being covered by the approval.
    # 2026-09-20: facts, phone and logo added. Each reaches a reader (the facts
    # row, the "or call" link, the logo tile) so each is part of what is approved.
    EXPECTED = {"advertiser", "headline", "body", "facts", "cta_text", "cta_url",
                "phone", "logo", "disclosure"}
    check(set(bsr.CREATIVE_FIELDS) == EXPECTED,
          "the code is over exactly the fields a reader sees",
          "missing %s / extra %s" % (sorted(EXPECTED - set(bsr.CREATIVE_FIELDS)),
                                     sorted(set(bsr.CREATIVE_FIELDS) - EXPECTED)))
    for f in sorted(EXPECTED):
        alt = dict(base)
        alt[f] = (list(alt[f]) + ["x"]) if isinstance(alt[f], list) else str(alt[f]) + "."
        check(bsr.proof_code(alt) != c0,
              "a change to %s moves the code" % f,
              "%s unchanged at %s" % (f, c0))
    # ...and things that are NOT the copy must not move it, or every deploy
    # invalidates an approval that is still good.
    for noise in ("active", "label", "is_house_ad", "tier", "slug"):
        check(bsr.proof_code(dict(base, **{noise: "x"})) == c0,
              "%s does not move the code" % noise)
    # A list is not flattened into something another list can collide with.
    check(bsr.proof_code(dict(base, facts=["a b", "c"])) != bsr.proof_code(dict(base, facts=["a", "b c"])),
          "two different fact lists with the same words do not share a code")
    check(bsr.proof_code({}) is None and bsr.proof_code(None) is None,
          "no creative yields no code, rather than a code for nothing")

    print("\nevery surface is tagged as itself")
    u = "https://a.example/x"
    tagged = sl.all_surfaces(u, "acme")
    check(len(set(tagged.values())) == len(tagged),
          "no two surfaces produce the same url", tagged)
    for surf, t in tagged.items():
        check(("utm_medium=" + sl.SURFACES[surf]) in t,
              "%s carries its own medium" % surf, t)
        check("utm_campaign=sponsor-acme" in t,
              "%s carries the sponsor's campaign" % surf, t)
    check(sl.tag(u, "daily_email", "acme") != sl.tag(u, "homepage", "acme"),
          "the email and the homepage cannot be confused for each other")

    print("\nthe live creative on file is renderable")
    src = ROOT / "data" / "sponsor.json"
    if src.exists():
        c = json.loads(src.read_text())
        blk = bsr.creative_block(c.get("slug") or "apex")
        check(blk is not None, "creative_block returns something for the sponsor on file")
        if blk:
            check(blk["proof_code"] == bsr.proof_code(c),
                  "the code on the block is the code for the file")
            check(set(blk["fields"]) == set(bsr.CREATIVE_FIELDS),
                  "it carries exactly the fields the code is over", sorted(blk["fields"]))
            check(blk["live"] == bool(c.get("active")),
                  "live reflects active, and nothing else")
            # THE URL IN THE FILE MUST BE BARE. Parameters written in by hand
            # are inherited by every surface, and the email would then report
            # inbox clicks as page clicks.
            check("utm_" not in (c.get("cta_url") or ""),
                  "cta_url in data/sponsor.json carries no utm of its own",
                  c.get("cta_url"))
        check(bsr.creative_block("someone-else") is None,
              "another sponsor's slug does not get this creative")
    else:
        print("  --    no data/sponsor.json; skipping the live-creative checks")

    print("\nthe house ad never reaches a sponsor's portal")
    import generate_daily as gd
    house = dict(gd.SPONSOR_HOUSE_AD, slug="apex")
    # creative_block reads the file, so prove the rule directly too.
    check(house.get("is_house_ad") is True, "the house ad is marked as one")
    import brief_email as be
    check(be.sponsor_block({"sponsor": house}) == "",
          "and the email refuses to render it")
    check(be.sponsor_block({"sponsor": dict(house, is_house_ad=False, active=False)}) == "",
          "an inactive sponsor renders nothing either")

    print("\nthe page reads what the builder writes")
    html = PAGE.read_text()
    for key in ("creative", "proof_code", "rateCard", "approveTo", "links", "tier"):
        check(key in html, "sponsor-report.html reads d.%s" % key)
    check("mailto:" in html and "Approve this ad" in html,
          "the approve action is a mailto the sponsor can actually send")
    check("d.approval" in html and "ap.proof === code" in html,
          "APPROVED is shown only when the approval on record is for THIS proof code")
    check("price_week" in html, "the tier block prints the rate-card price")
    check(re.search(r"\$\s*\d+\s*/\s*week", html) is None,
          "no price is typed into the page",
          "a hardcoded rate would drift from data/rate-card.json")

    # ---- THE PORTAL MUST NOT DRAW ITS OWN VERSION OF THE AD ----------------
    #
    # It used to: .sr-ad / .sr-ad-head / .sr-ad-cta, hand-styled in
    # sponsor-report.html, with `dv3-sponsor` appearing ZERO times in that file.
    # Same six fields in the same order, so it looked right -- and a change to
    # the real block's CSS would drift the proof from what ships WHILE THE
    # PROOF CODE STILL MATCHED, because the code is a hash over the text fields
    # and cannot see styling. The sponsor approves a picture of something else
    # and both sides hold a code saying they agreed.
    src = json.loads((ROOT / "data" / "sponsor.json").read_text())
    pv = bsr.previews(src)

    # 2026-09-20: the pages are drawn by components/sponsor-ad.js. The portal
    # loads that same file and calls it for the homepage and /daily tabs; the
    # archive tab is the Python renderer's output, which sponsor-checks.mjs
    # holds byte-identical to the JS. So: no lookalike anywhere.
    check("/components/sponsor-ad.js" in html and "AgsistAd.render" in html,
          "the portal draws the page previews with the live renderer",
          "a lookalike drifts from what ships and the proof code cannot see it")
    check("/components/sponsor-ad.css" in html,
          "and with the live stylesheet")
    check('class="sa-ad"' in (pv.get("archive") or ""),
          "the archive preview is the site's own block",
          "a lookalike drifts from what ships and the proof code cannot see it")
    blk2 = bsr.creative_block(src.get("slug") or "apex") or {}
    urls = blk2.get("cta_urls") or {}
    check(len(set(urls.values())) == len(urls) >= 3,
          "homepage, /daily and archive are tagged apart",
          urls)
    check("utm_medium=archive" in (pv.get("archive") or ""),
          "the archive preview's button carries the archive tag")
    check("<table" in (pv.get("email_html") or ""),
          "the html email preview is brief_email's own table",
          "most readers see the html email, not the text part")

    print("\nthe ad that runs is the ad that was approved")
    conf = json.loads((ROOT / "data" / "sponsors.json").read_text())
    for sp_ in conf.get("sponsors", []):
        if sp_.get("slug") != src.get("slug"):
            continue
        if src.get("active"):
            ap = (sp_.get("approved") or {}).get("proof")
            check(ap == bsr.proof_code(src),
                  "a live ad carries an approval for its current proof code",
                  "approved %r, current %r -- the words running are not the words approved"
                  % (ap, bsr.proof_code(src)))
        else:
            check(True, "the ad is not live, so no approval is needed yet")
    check("sr-ad-head" not in html and "sr-ad-cta" not in html,
          "the portal keeps no lookalike of its own")

    print()
    if FAILED:
        print("FAILED (%d): %s" % (len(FAILED), "; ".join(FAILED)))
        return 1
    print("sponsor portal: all passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
