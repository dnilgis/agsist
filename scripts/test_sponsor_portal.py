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
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
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


# ── SPLIT BY SLOT: a fake GA4 that honours the filters it is sent ─────────
# The fake answers like GA4: it keeps only the rows each filter in the request
# allows, and a row before Oct 29, 2026 has slot "(not set)". A builder that
# forgot the slot filter would get every row on the site back from it, so
# these checks would see the other sponsor's numbers and fail.
class _O:
    def __init__(self, **kw):
        self.__dict__.update(kw)


class FakeTypes:
    class Filter(_O):
        class InListFilter(_O):
            pass

        class StringFilter(_O):
            pass

    class FilterExpression(_O):
        pass

    class FilterExpressionList(_O):
        pass

    class Dimension(_O):
        pass

    class Metric(_O):
        pass

    class DateRange(_O):
        pass

    class RunReportRequest(_O):
        pass


def _leaves(fe):
    if getattr(fe, "and_group", None) is not None:
        out = []
        for e in fe.and_group.expressions:
            out += _leaves(e)
        return out
    f = fe.filter
    if getattr(f, "in_list_filter", None) is not None:
        return [(f.field_name, set(f.in_list_filter.values))]
    return [(f.field_name, {f.string_filter.value})]


class FakeGA4:
    """rows: dicts with date (YYYY-MM-DD), page, slot, event, region, n."""

    def __init__(self, rows):
        self.data, self.asked = rows, []

    def run_report(self, req):
        self.asked.append(req)
        leaves = _leaves(req.dimension_filter)
        a, b = req.date_ranges[0].start_date, req.date_ranges[0].end_date
        field = {"eventName": "event", "pagePath": "page", "region": "region", "country": "country",
                 bsr.SLOT_DIMENSION: "slot", "date": "date"}
        groups = {}
        for r in self.data:
            if not (a <= r["date"] <= b):
                continue
            r = dict(r, country="United States")
            if r["date"] < bsr.SLOT_SINCE:
                r["slot"] = bsr.NOT_SET      # GA4 has no slot before it was registered
            if not all(r[field[k]] in vals for k, vals in leaves):
                continue
            key = tuple(r[field[d.name]].replace("-", "") if d.name == "date" else r[field[d.name]]
                        for d in req.dimensions)
            groups[key] = groups.get(key, 0) + r["n"]
        return _O(rows=[_O(dimension_values=[_O(value=v) for v in k], metric_values=[_O(value=str(n))])
                        for k, n in groups.items()])


def _day(d):
    from datetime import date as _d
    return _d.fromisoformat(d)


def _fake_rows():
    rows = []
    for d in ("2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"):
        rows += [
            {"date": d, "page": "/", "slot": "homepage-top", "event": "sponsor_viewable", "region": "Iowa", "n": 10},
            {"date": d, "page": "/daily", "slot": "daily-page", "event": "sponsor_viewable", "region": "Iowa", "n": 5},
            {"date": d, "page": "/", "slot": "daily-briefing", "event": "sponsor_click", "region": "Iowa", "n": 1},
            {"date": d, "page": "/rain/texas", "slot": "geo-bee", "event": "sponsor_viewable", "region": "Texas", "n": 100},
            {"date": d, "page": "/rain/texas", "slot": "geo-bee", "event": "sponsor_click", "region": "Texas", "n": 3},
            {"date": d, "page": "/basis", "slot": "footer-strip", "event": "sponsor_viewable", "region": "Ohio", "n": 1000},
            {"date": d, "page": "/basis", "slot": bsr.NOT_SET, "event": "sponsor_viewable", "region": "Ohio", "n": 7},
        ]
    return rows


def page_slot_tests():
    """THE RATE CARD OF OCT 29, 2026: a State Sponsor and the Cash Bids Sponsor are
    sold through /sponsor-apply and draw on page ribbons. Their day-30 report must be
    their own: a State Sponsor gets its state's ribbon events (the state page, its town
    pages, its cash rent page) and nobody else's."""
    from datetime import date as _d
    print("\na page ribbon sponsor's report is its own ribbons only (rate card, Oct 29, 2026)")
    A = {"slug": "acme", "name": "Acme", "token": "x" * 16, "start": "2026-10-30"}
    B = {"slug": "bee", "name": "Bee", "token": "y" * 16, "start": "2026-10-30", "geo": "bee", "regions": ["TX"]}
    W = {"slug": "wico", "name": "Wi Co", "token": "w" * 16, "start": "2026-10-30",
         "page_slots": ["cash-bids-wisconsin", "rent-wi"], "billing": {"tier": "state", "state": "WI"}}
    I = {"slug": "iaco", "name": "Ia Co", "token": "i" * 16, "start": "2026-10-30",
         "page_slots": ["cash-bids-iowa", "rent-ia"], "billing": {"tier": "state", "state": "IA"}}
    C = {"slug": "cbco", "name": "Cb Co", "token": "c" * 16, "start": "2026-10-30",
         "page_slots": ["cash-bids"], "billing": {"tier": "cashbids"}}
    check(bsr.sponsor_slots(W) == ["page:cash-bids-wisconsin", "page:rent-wi"], "a State Sponsor's slots are its state's ribbons", bsr.sponsor_slots(W))
    check(bsr.sponsor_slots(C) == ["page:cash-bids"], "the Cash Bids Sponsor's slot is the /cash-bids ribbon")
    check(bsr.sponsor_slots(dict(W, page_slots=["../x", "rent-wi"])) == ["page:rent-wi"], "only well-formed ribbon ids count")
    check(bsr.check_slots([A, B, W, I, C]) and True, "a Daily, a geo, two State and a Cash Bids sponsor share no slot")
    rows = []
    for d in ("2026-10-30", "2026-10-31"):
        rows += [
            {"date": d, "page": "/cash-bids/wisconsin", "slot": "page:cash-bids-wisconsin", "event": "sponsor_viewable", "region": "Wisconsin", "n": 40},
            {"date": d, "page": "/cash-bids/wisconsin/cadott", "slot": "page:cash-bids-wisconsin", "event": "sponsor_viewable", "region": "Wisconsin", "n": 20},
            {"date": d, "page": "/cash-bids/wisconsin/cadott", "slot": "page:cash-bids-wisconsin", "event": "sponsor_click", "region": "Wisconsin", "n": 2},
            {"date": d, "page": "/rent/wisconsin", "slot": "page:rent-wi", "event": "sponsor_viewable", "region": "Wisconsin", "n": 5},
            {"date": d, "page": "/cash-bids/iowa", "slot": "page:cash-bids-iowa", "event": "sponsor_viewable", "region": "Iowa", "n": 300},
            {"date": d, "page": "/cash-bids", "slot": "page:cash-bids", "event": "sponsor_viewable", "region": "Iowa", "n": 900},
            {"date": d, "page": "/spray", "slot": "page:spray", "event": "sponsor_viewable", "region": "Ohio", "n": 4000},
            {"date": d, "page": "/", "slot": "homepage-top", "event": "sponsor_viewable", "region": "Wisconsin", "n": 10},
            {"date": d, "page": "/rain/texas", "slot": "geo-bee", "event": "sponsor_viewable", "region": "Texas", "n": 100},
            {"date": d, "page": "/cash-bids/wisconsin", "slot": bsr.NOT_SET, "event": "sponsor_viewable", "region": "Wisconsin", "n": 7},
        ]
    saved = bsr.other_ads_live
    bsr.other_ads_live = lambda geo_id, today=None, slug=None: []
    try:
        fake = FakeGA4(rows)
        ga = bsr.GA4Reader(fake, FakeTypes, "1")
        end, today = _d(2026, 10, 31), _d(2026, 11, 1)
        allx = [A, B, W, I, C]
        pw, _ = bsr.sponsor_payload(W, ga, end, allx, today)
        pi, _ = bsr.sponsor_payload(I, ga, end, allx, today)
        pc, _ = bsr.sponsor_payload(C, ga, end, allx, today)
        check(pw["totals"]["viewable"] == 130 and pw["totals"]["clicks"] == 4,
              "the Wisconsin State Sponsor gets its state page, its town pages and its rent page, nothing else", pw["totals"])
        check({x["page"] for x in pw["byPage"]} == {"/cash-bids/wisconsin", "/cash-bids/wisconsin/cadott", "/rent/wisconsin"},
              "its pages are Wisconsin's own", pw["byPage"])
        check(pi["totals"]["viewable"] == 600 and pc["totals"]["viewable"] == 1800,
              "Iowa's sponsor and the Cash Bids Sponsor get only theirs", (pi["totals"], pc["totals"]))
        check(all(bsr.SLOT_DIMENSION in [n for n, _ in _leaves(q.dimension_filter)] for q in fake.asked),
              "every question carried the sponsor's slots")
        check("4000" not in json.dumps([pw, pi, pc]) and "8000" not in json.dumps([pw, pi, pc]),
              "a retired ribbon's events (page:spray) are nobody's")
    finally:
        bsr.other_ads_live = saved
    pend, _ = bsr.sponsor_payload(dict(W, start=None), None, _d(2026, 10, 31), [W], _d(2026, 11, 1))
    check(pend["pending"] is True and pend["totals"]["viewable"] == 0, "before it starts, the page says so with zeros")


def slot_tests():
    from datetime import date as _d
    A = {"slug": "acme", "name": "Acme", "token": "x" * 20, "start": "2026-10-30"}
    B = {"slug": "bee", "name": "Bee", "token": "y" * 20, "start": "2026-10-30", "geo": "bee", "regions": ["TX", "IA"]}
    end, today = _d(2026, 10, 31), _d(2026, 11, 1)

    check(bsr.SLOT_DIMENSION == "customEvent:slot" and bsr.SLOT_SINCE == "2026-10-29",
          "the slot is the registered custom dimension, filled from Oct 29, 2026")
    check(bsr.sponsor_slots(B) == ["geo-bee"], "a state-targeted sponsor's slot is geo-<id>", bsr.sponsor_slots(B))
    check(bsr.sponsor_slots(A) == ["daily-briefing", "homepage-top", "daily-page", "daily-archive"],
          "the daily sponsor's slots are the four surfaces its ad is drawn on", bsr.sponsor_slots(A))

    # COUNT THE COPIES: every slot name the site sends, read from the files
    # that send it, is either one of a sponsor's or named as nobody's report.
    found = {}
    pats = [r'data-sponsor-(?:slot|click)="([a-z][a-z0-9:-]*)"', r"data-sponsor-(?:slot|click)'\s*,\s*'([a-z][a-z0-9:-]*)'",
            r"\{\s*(?:slot|click)\s*:\s*'([a-z][a-z0-9:-]*)'\s*\}", r'slot="(daily-[a-z-]+)"\)']
    files = ["index.html", "daily.html", "scripts/generate_daily.py"] + sorted(
        str(p.relative_to(ROOT)) for p in (ROOT / "components").glob("*.js"))
    for f in files:
        t = (ROOT / f).read_text(encoding="utf-8")
        for pat in pats:
            for m in re.finditer(pat, t):
                found.setdefault(m.group(1), set()).add(f)
    for slot, where in sorted(found.items()):
        ok = (slot in bsr.DAILY_SLOTS or slot in bsr.UNREPORTED_SLOTS
              or slot.startswith(bsr.UNREPORTED_PREFIXES) or slot.startswith(bsr.GEO_SLOT_PREFIX)
              or slot.startswith(bsr.PAGE_SLOT_PREFIX))
        check(ok, "slot %r (from %s) is accounted for in build_sponsor_report.py" % (slot, ", ".join(sorted(where))))
    for slot in bsr.DAILY_SLOTS:
        check(slot in found, "the daily slot %r is really sent by some page" % slot, sorted(found))
    gjs = (ROOT / "components" / "geo-sponsor.js").read_text()
    check("{ slot: 'geo-' + e.id }" in gjs, "the state-targeted ad sends geo-<id>, the name the report filters on")
    lj = (ROOT / "components" / "loader.js").read_text()
    check("'page:' + id" in lj and "'footer-strip'" in lj, "page ribbons and the footer send page:<id> and footer-strip")
    pj = (ROOT / "components" / "prf-sponsor.js").read_text()
    check("'prf-' + kind + ':' + sp.st" in pj, "PRF state sponsors send prf-<kind>:<st>")
    mj = (ROOT / "components" / "sponsor-metrics.js").read_text()
    check(mj.count("slot: slot") == 1 and "slot: a.getAttribute('data-sponsor-click')" in mj,
          "both events carry the slot parameter the dimension reads")

    # a query with no slot filter is refused, so the refusal can lift only because the filter exists
    ga = bsr.GA4Reader(FakeGA4([]), FakeTypes, "1")
    for bad in (None, [], [""]):
        try:
            ga.request(["date"], ["sponsor_viewable"], "2026-10-30", "2026-10-31", bad)
            refused = False
        except ValueError:
            refused = True
        check(refused, "a sponsor's query with slots=%r is refused" % (bad,))
    try:
        ga.request(["date"], ["sponsor_viewable"], "2026-10-28", "2026-10-31", ["geo-bee"])
        refused = False
    except ValueError:
        refused = True
    check(refused, "a slot-filtered query reaching before Oct 29, 2026 is refused (GA4 has no slot then)")
    req = ga.request(["date", "pagePath"], ["sponsor_viewable"], "2026-10-30", "2026-10-31", ["geo-bee"])
    check(("customEvent:slot", {"geo-bee"}) in _leaves(req.dimension_filter), "the request filters on the sponsor's slot")
    check([d.name for d in req.dimensions][-1] == "customEvent:slot", "and asks for the slot back, to check every row")
    check("len(sponsors) > 1 and not SLOT_DIMENSION" in (ROOT / "scripts" / "build_sponsor_report.py").read_text(),
          "the old refusal is still there for an unset dimension")

    # two sponsors at once, both after Oct 29: each gets only its own rows
    saved = bsr.other_ads_live
    bsr.other_ads_live = lambda geo_id, today=None, slug=None: []
    try:
        fake = FakeGA4(_fake_rows())
        ga = bsr.GA4Reader(fake, FakeTypes, "1")
        pa, _ = bsr.sponsor_payload(A, ga, end, [A, B], today)
        pb, _ = bsr.sponsor_payload(B, ga, end, [A, B], today)
        check(pa["totals"]["viewable"] == 30 and pa["totals"]["clicks"] == 2,
              "the daily sponsor gets its homepage and /daily views and its clicks, nothing else", pa["totals"])
        check(pb["totals"]["viewable"] == 200 and pb["totals"]["clicks"] == 6,
              "the state-targeted sponsor gets only geo-bee", pb["totals"])
        check({x["page"] for x in pa["byPage"]} == {"/", "/daily"} and {x["page"] for x in pb["byPage"]} == {"/rain/texas"},
              "by page holds only each one's own pages", (pa["byPage"], pb["byPage"]))
        check([r["viewable"] for r in pb["regionAds"]["rows"]] == [0, 200] and pb["regionAds"]["elsewhere"]["viewable"] == 0,
              "the state rows are the sponsor's own too (Iowa's views are the other ad's)", pb["regionAds"])
        check("split" not in pa and "withheld" not in pa, "no day was withheld: both started after the slot")
        check(all(bsr.SLOT_DIMENSION in [n for n, _ in _leaves(q.dimension_filter)] for q in fake.asked),
              "every question asked for the two sponsors carried a slot filter", len(fake.asked))
        log = ga.slot_log(bsr.VIEWABLE_EVENTS + bsr.CLICK_EVENTS, bsr.SLOT_SINCE, "2026-10-31")
        check(log.get(bsr.NOT_SET) == 21 and log.get("footer-strip") == 3000,
              "(not set) and footer rows are counted for the log", log)
        check(bsr.NOT_SET not in json.dumps([pa, pb]), "and given to nobody")

        # both started before Oct 29: the days before are withheld, never the site total
        A2, B2 = dict(A, start="2026-10-26"), dict(B, start="2026-10-27")
        fake = FakeGA4(_fake_rows())
        ga = bsr.GA4Reader(fake, FakeTypes, "1")
        pa, _ = bsr.sponsor_payload(A2, ga, end, [A2, B2], today)
        pb, _ = bsr.sponsor_payload(B2, ga, end, [A2, B2], today)
        check(pa["totals"]["viewable"] == 45 and pb["totals"]["viewable"] == 300,
              "only Oct 29 on is counted, each its own", (pa["totals"], pb["totals"]))
        check(min(x["d"] for x in pa["series"]) == "2026-10-29" and min(x["d"] for x in pb["series"]) == "2026-10-29",
              "no day before Oct 29 is in either series")
        check(pa["split"]["withheldFrom"] == "2026-10-26" and pa["split"]["withheldThrough"] == "2026-10-28"
              and pb["split"]["withheldFrom"] == "2026-10-27", "the withheld days are named", (pa.get("split"), pb.get("split")))
        check(pa["split"]["note"].startswith("Split by slot from Oct 29, 2026.") and "Bee" in pa["split"]["note"]
              and "Acme" in pb["split"]["note"], "the report says split by slot from Oct 29, 2026, and why", pa["split"]["note"])
        check(pb["regionAds"]["start"] == "2026-10-29" and [r["viewable"] for r in pb["regionAds"]["rows"]] == [0, 300],
              "the state rows start Oct 29 too", pb["regionAds"])
        check(all(w.get("countedFrom") == "2026-10-29" for w in pa["windows"]), "a 7, 30 or 90 day window says it is counted from Oct 29")
        check(not any(q.date_ranges[0].start_date < bsr.SLOT_SINCE for q in fake.asked),
              "GA4 was never asked about a withheld day")

        # only days before Oct 29, two sponsors: everything withheld, said so
        fake = FakeGA4(_fake_rows())
        ga = bsr.GA4Reader(fake, FakeTypes, "1")
        pw, _ = bsr.sponsor_payload(B2, ga, _d(2026, 10, 28), [A2, B2], _d(2026, 10, 29))
        check(pw["totals"]["viewable"] is None and pw["series"] == [] and pw["regionAds"]["withheld"] is True,
              "with no day after the split, the numbers are withheld, not the site's", pw["totals"])
        check(pw["withheld"].startswith("Split by slot from Oct 29, 2026."), "and the page says why", pw.get("withheld"))
        check(fake.asked == [], "and GA4 is never asked")

        # the only ad running before Oct 29: today's rule, the site's sponsor count is its own
        fake = FakeGA4([r for r in _fake_rows() if r["slot"] in ("geo-bee",) or r["date"] >= "2026-10-29"])
        ga = bsr.GA4Reader(fake, FakeTypes, "1")
        ps, _ = bsr.sponsor_payload(B2, ga, end, [B2], today)
        check(ps["totals"]["viewable"] == 300 + 2 * 100 and "split" not in ps,
              "a sole sponsor keeps its days before Oct 29, read as before", ps["totals"])

        # an ad that ended before the days in question does not withhold them
        apex = {"slug": "old", "name": "Old", "active": False, "ended": "2026-10-08", "start": None}
        check(bsr.others_before(B2, [B2, apex], "2026-10-27", "2026-10-28") == [], "an ad that ended earlier is not another ad")
        check(bsr.others_before(B2, [B2, dict(apex, ended=None, start="2026-10-01")], "2026-10-27", "2026-10-28") == ["Old"],
              "an ad switched off with no end date might still have run: withheld")
        check(bsr.others_before(B2, [B2, dict(apex, ended=None)], "2026-10-27", "2026-10-28") == [],
              "an ad that never started is not another ad")
    finally:
        bsr.other_ads_live = saved
    check(bsr.others_before(B2, [B2], "2026-10-27", "2026-10-28", today) == bsr.other_ads_live("bee", today, slug="bee"),
          "ads outside sponsors.json that run now also withhold the days before (nothing records when they started)")

    # two sponsors may never share a slot
    try:
        bsr.check_slots([A, dict(A, slug="acme2")])
        shared = False
    except SystemExit:
        shared = True
    check(shared, "two daily sponsors at once fail the build: they would share every slot")
    check(bsr.check_slots([A, B]) and True, "a daily and a state-targeted sponsor do not share one")
    html = (ROOT / "sponsor-report.html").read_text()
    res_fn = html[html.index("function results("):html.index("function trendSection(")]
    check("d.split" in res_fn and "d.split.note" in res_fn, "the portal prints the split note beside the numbers")
    check("w.countedFrom" in html, "a window counted from Oct 29 says so on the portal")


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
    check("price_month" in html, "the tier block prints the rate-card price")
    check(re.search(r"\$\s*\d+\s*/\s*(?:week|month|mo)\b", html) is None,
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

    # ---- WHO READS AGSIST ---------------------------------------------------
    # The audience dashboard is what a sponsor quotes to their own boss. Every
    # number on it must come from data/audience.json and carry its window, and
    # a missing or malformed file must leave the portal exactly as it was.
    print("\nthe audience dashboard says only what the file says")
    check("/data/audience.json" in html, "the portal reads data/audience.json")
    check("a.schema === 'agsist-audience/2'" in html,
          "a file of the wrong shape is treated as absent, not drawn",
          "a half-drawn dashboard is worse than none")
    check(".catch(function () { return null; })" in html,
          "an unreachable audience file cannot break the sponsor's link")
    check("x[0] !== '#audience'" in html, "no nav link points at a section that was not drawn")
    check("var AUDP = fetch(" in html and "AUDP.then(" in html,
          "the audience promise has its own name",
          "it once shared AUD with the dashboard state; the state overwrote the promise and every link said 'not recognised'")
    for s_, what in (("14,340", "a reader count"), ("1501", "a state's count"), ("1,615", "an AI figure")):
        check(s_ not in html, "no audience figure is typed into the page (%s)" % what)
    check("Automated traffic rarely" not in html,
          "the page does not claim engaged visits screen out bots (Singapore made 1,706 at 2s a user)")
    af = ROOT / "data" / "audience.json"
    if af.exists():
        a = json.loads(af.read_text())
        rg = a.get("ranges") or []
        check(a.get("schema") == "agsist-audience/2", "audience.json is the shape the portal draws")
        check(bool(rg) and all(r.get("start") and r.get("end") and r.get("id") for r in rg), "every range carries its dates")
        ids = [r["id"] for r in rg]
        check(set(a.get("totals") or {}) == set(ids) and set(a.get("states") or {}) == set(ids),
              "totals and states exist for exactly the ranges offered")
        for rid in ids:
            rows = a["states"][rid]
            check(len({r["code"] for r in rows}) == len(rows) <= 51, "%s: one row per state, at most 50 and DC" % rid)
            check(all(rows[i]["engaged"] >= rows[i + 1]["engaged"] for i in range(len(rows) - 1)),
                  "%s: states are ranked by engaged visits" % rid)
            ranked = [r["rank"] for r in rows if r.get("flag") != "home"]
            check(ranked == list(range(1, len(ranked) + 1)), "%s: ranks run 1..n with no gaps" % rid)
            check(all(r["rank"] is None for r in rows if r.get("flag") == "home"),
                  "%s: the home state is shown and not ranked" % rid)
        fr = a.get("stateFlagRule")
        if fr:
            rows = a["states"][ids[0]]
            bad = [r["code"] for r in rows if r.get("flag") != "home" and
                   ((r.get("flag") == "server") != (r["users"] >= fr["minReaders"] and r["avgSeconds"] < fr["seconds"]))]
            check(not bad, "every server-traffic flag follows the printed rule, and nothing else is flagged", bad)
        if a.get("ai"):
            check(bool(a["ai"].get("start") and a["ai"].get("end")), "the AI figure carries its export's dates")
        blob = json.dumps(a)
        check("@" not in blob.replace("sig@agsist.com", ""), "no email address is written into the public file")

    print("\nthe requests box never pretends")
    # 2026-10-11: the post goes through components/form-post.js (the subs
    # worker first, the same Formspree form as the fallback), so the two
    # checks that used to read the page now read the helper the page loads.
    fp = (ROOT / "components" / "form-post.js").read_text()
    check('<script src="/components/form-post.js?v=' in html and "sendForm(" in html and "fetch(" not in html.split("function sendForm")[1].split("\n  }")[0],
          "approval and requests post through the shared form helper")
    check("agsist-api.dnilgis.workers.dev/form" in fp and "formspree.io/f/xnjbwepn" in fp,
          "requests post to the subs worker, with the site's own Formspree form as the fallback")
    check("That did not go through." in html and "mailto:" in html,
          "a failed request says so and hands over a written email")
    check("if (!j || j.ok === false || j.errors) throw" in fp and "j.ok === true" in fp,
          "only an explicit ok from the worker or from Formspree counts as sent")
    check("j.ok === false" not in html.split("function sendForm")[1],
          "the page keeps no second, older send path")
    check("Nothing changes until" in html, "the box says a person acts on it, not the button")
    conf_ls = [sp_.get("licensed_states") for sp_ in conf.get("sponsors", [])]
    for v in conf_ls:
        if v is not None:
            check(bsr.licensed_states(v) is not None, "a typed licensed-states list is valid US codes")

    # ---- NO CONTACT IN ANY PUBLIC FILE (Oct 19) -----------------------------
    # Every file in the repo is published. A sponsor's contact person, phone,
    # email or invoice address never goes into data/sponsors.json, a baked
    # portal file, or the portal page; Sig keeps them in his own email.
    print("\nno contact or invoice address in a public file")
    for sp_ in conf.get("sponsors", []):
        check("contact" not in sp_, "data/sponsors.json carries no contact")
        b_ = sp_.get("billing") or {}
        check(not any(k in b_ for k in bsr.PRIVATE_BILLING_KEYS), "and no invoice contact in its billing")
    got = bsr.portal_extras({"contact": "x", "billing": {"tier": "page", "invoice_contact": "y", "invoice_to": "z", "email": "e"}})
    check("contact" not in got and got.get("billing") == {"tier": "page"},
          "the builder drops a typed contact and invoice address", got)
    check(bsr.portal_extras({"billing": {"invoice_contact": "y"}}).get("billing") is None,
          "billing with only an invoice address writes nothing")
    for f_ in sorted((ROOT / "data" / "sponsors").glob("*.json")):
        d_ = json.loads(f_.read_text())
        check("contact" not in d_ and not any(k in (d_.get("billing") or {}) for k in bsr.PRIVATE_BILLING_KEYS),
              "%s carries no contact or invoice address" % f_.name)
    check("d.contact" not in html and "invoice_contact" not in html, "the portal page prints no contact field")
    tiers_ = [t["id"] for t in json.loads((ROOT / "data" / "rate-card.json").read_text())["tiers"]]
    check("founding" not in tiers_ and "daily" in tiers_, "the Daily tier is called daily, never founding", tiers_)

    # ---- A STATE-TARGETED SPONSOR ON A FREE TEST (Oct 28, 2026: RootLot) --
    print("\na state-targeted sponsor on a free test")
    geo_conf = [sp_ for sp_ in conf.get("sponsors", []) if sp_.get("geo")]
    check(any(sp_.get("slug") == "rootlot" for sp_ in geo_conf), "RootLot has a portal entry with its geo id")
    for sp_ in geo_conf:
        e = bsr.geo_entry(sp_["geo"])
        check(e is not None, "%s: its geo id is in data/geo-sponsors.json" % sp_["slug"])
        if not e:
            continue
        regs = bsr.licensed_states(sp_.get("regions"))
        check(regs == sorted(e.get("states") or []), "%s: the portal's states are the ad's states" % sp_["slug"], (regs, e.get("states")))
        blk = bsr.creative_block(sp_["slug"], sp_["geo"])
        check(blk is not None, "%s: the geo creative builds" % sp_["slug"])
        if not blk:
            continue
        f = blk["fields"]
        check(set(f) == set(bsr.CREATIVE_FIELDS), "%s: the geo proof covers the same fields" % sp_["slug"])
        check(f["advertiser"] == e["name"] and f["headline"] == e["headline"] and f["cta_url"] == e["url"],
              "%s: the proof is over the words the ad shows" % sp_["slug"])
        check(blk["proof_code"] == bsr.proof_code(f), "%s: its code is the code for those fields" % sp_["slug"])
        check(blk["live"] == (e.get("active") is True), "%s: live is the geo entry's active flag" % sp_["slug"])
        check("utm_" not in (e.get("url") or ""), "%s: the url in geo-sponsors.json is bare" % sp_["slug"])
        for k in bsr.GEO_SURFACES:
            check(blk["links"][k].endswith("utm_source=agsist&utm_medium=sponsor&utm_campaign=%s&utm_content=%s"
                                           % (e.get("utm_campaign") or "geo-" + e["id"], k)),
                  "%s: the %s link carries its own utm_content" % (sp_["slug"], k), blk["links"][k])
        check(bsr.creative_block(sp_["slug"]) is None or sp_["slug"] == (json.loads((ROOT / "data" / "sponsor.json").read_text()).get("slug")),
              "%s: the daily sponsor file is not read as its ad" % sp_["slug"])
        # the ad that runs is the ad that was approved, and the counter has its start
        if e.get("active") is True:
            # A paid ad runs only on an approval for its current words. A free
            # test whose copy Sig picked himself (RootLot, Oct 28) does not wait
            # on one; its approve button still works and is still recorded.
            if not (sp_.get("billing") or {}).get("free_test"):
                ap = (sp_.get("approved") or {}).get("proof")
                check(ap == blk["proof_code"], "%s: a live paid geo ad carries an approval for its current proof code" % sp_["slug"],
                      "approved %r, current %r" % (ap, blk["proof_code"]))
            cf = sp_.get("count_from")
            check(bool(sp_.get("start")) or bool(cf and re.match(r"^\d{4}-\d{2}-\d{2}$", cf)),
                  "%s: a live geo ad has a start date or a count_from day, so its counts have a floor" % sp_["slug"], (sp_.get("start"), cf))
            check(not (cf and sp_.get("start")), "%s: start and count_from are not both set" % sp_["slug"])
        else:
            check(sp_.get("start") is None, "%s: the ad is off, so the counter has not started" % sp_["slug"])
    # a geo ad switched on by hand: "live since" is the first day with data, never count_from itself
    B_ = (ROOT / "scripts" / "build_sponsor_report.py").read_text()
    check('live_since = next((x["d"] for x in series if x["v"] or x["c"]), None)' in B_,
          "live since is the first day with data")
    check('"start": live_since if count_from else start' in B_, "count_from is a floor for the query, never shown as the start")
    check("Live since " in html and "no full day counted yet" in html, "the portal says live since <date>, or that no full day is counted yet")
    # the same link string as components/geo-sponsor.js withUtm()
    for u, want in (("https://r.example", "https://r.example?"), ("https://r.example/a?b=1", "https://r.example/a?b=1&"),
                    ("https://r.example/a?", "https://r.example/a?"), ("https://r.example/a?b=1&", "https://r.example/a?b=1&")):
        got = bsr.geo_link(u, "geo-test", "state-page")
        check(got == want + "utm_source=agsist&utm_medium=sponsor&utm_campaign=geo-test&utm_content=state-page",
              "geo_link appends to %s correctly" % u, got)
    check(bsr.geo_link("https://r.example/a?b=1#t", "geo-test", "reader-state").endswith("&utm_content=reader-state#t"),
          "geo_link keeps a #fragment last")
    gjs = (ROOT / "components" / "geo-sponsor.js").read_text()
    check("utm_source=agsist&utm_medium=sponsor&utm_campaign=" in gjs and "'&utm_content='" in gjs,
          "the page builds the same tags as the portal's links")

    print("\nthe free deal is shown muted and charges nothing")
    free = bsr.portal_extras({"billing": {"tier": "page", "free_test": True}, "regions": ["ca", "TX"], "geo": "x"})
    check(free["freeTest"] is True and free["billing"] == {"tier": "page", "free_test": True}, "billing.free_test reaches the portal", free)
    check(free["regions"] == ["CA", "TX"], "regions are checked US codes, like licensed states")
    paid = bsr.portal_extras({"billing": {"tier": "daily", "trial_months": 1}})
    check(paid["freeTest"] is False and paid["regions"] is None and paid["geo"] is None, "a paying sponsor is not a free test", paid)
    check(bsr.portal_extras({"billing": {"tier": "page", "free_test": "yes"}})["freeTest"] is False, "only free_test true counts, never a truthy string")
    for sp_ in conf.get("sponsors", []):
        if (sp_.get("billing") or {}).get("free_test"):
            check(not any(k in sp_["billing"] for k in ("price", "price_month", "rate", "amount", "invoice")),
                  "%s: a free test carries no price of its own" % sp_["slug"], sp_["billing"])
    check("var FREE = 'Free test: no charge';" in html, "the portal's one label for a free test is plain words")
    bill_fn = html[html.index("function billingSection("):html.index("/* ───────────────────────────── links")]
    check("if (d.freeTest)" in bill_fn and "cp-muted" in bill_fn and "FREE" in bill_fn,
          "the billing section keeps its layout, muted, under the label")
    check(bill_fn.index("if (d.freeTest)") < bill_fn.index("if (!t) return h + '<div class=\"cp-card\"><p class=\"cp-note\" style=\"margin:0\">Your plan"),
          "the free test is handled before the paid plan is drawn")
    hero_fn = html[html.index("function hero("):html.index("function nav(")]
    check("if (d.freeTest) steps.forEach" in hero_fn and "x.d = FREE" in hero_fn, "the free-period and billing steps say Free test: no charge")
    req_fn = html[html.index("function requestsSection("):html.index("function wireApprove(")]
    check("d.freeTest && (a[0] === 'plan' || a[0] === 'extend')" in req_fn, "switching plan and renewing are muted on a free test")
    check(".cp-free .cp-muted,.cp-muted{opacity:.5;filter:grayscale(1)}" in html, "muted means greyed, not removed")

    print("\nyour states: readers from the audience file, the ad by GA4 region, never our own state event")
    reg_fn = html[html.index("function regBody("):html.index("function wireRegions(")]
    check("a.states" in reg_fn and "views" in reg_fn and "engagementRate" in reg_fn, "readers, page views and engagement come from data/audience.json")
    check("a.servers" in reg_fn and "Data-center traffic left out" in reg_fn, "the server towns in those states are named with what they carried")
    check("not started" in reg_fn, "before the ad runs its numbers read 0, not started")
    pend = bsr.region_ads_pending({"regions": ["CA", "NV", "TX"]})
    check(pend["pending"] is True and [r["viewable"] for r in pend["rows"]] == [0, 0, 0] and [r["clicks"] for r in pend["rows"]] == [0, 0, 0],
          "the pending ad rows are zeros, not blanks", pend)
    ra = bsr.region_ads({"regions": ["CA", "NV", "TX"]}, {"California": 50, "Texas": 20, "Iowa": 7, "(not set)": 3},
                        {"California": 2}, 85, 3, "2026-11-01", "2026-11-05")
    check([(r["code"], r["viewable"], r["clicks"]) for r in ra["rows"]] == [("CA", 50, 2), ("NV", 0, 0), ("TX", 20, 0)],
          "each state is GA4's region count", ra)
    check(ra["elsewhere"] == {"viewable": 15, "clicks": 1}, "everything else makes the parts add up to the totals", ra["elsewhere"])
    B = (ROOT / "scripts" / "build_sponsor_report.py").read_text()
    check('Dimension(name="region")' in B and 'field_name="country"' in B, "the ad's states come from GA4's standard region dimension, US visits")
    check("customEvent:region" not in B and "customEvent:state" not in B, "never an event parameter carrying a state")
    check(bsr.other_ads_live("rootlot") == [], "no other ad runs now, so RootLot's counts are its own", bsr.other_ads_live("rootlot"))
    check("payload[\"withheld\"]" in B, "if another ad runs, the geo numbers are withheld and the portal says why")
    check("if (d.withheld)" in html, "the portal shows the withheld reason instead of numbers")

    print("\nsplit by slot: each sponsor gets only its own rows (Oct 29, 2026)")
    slot_tests()
    page_slot_tests()


    print()
    if FAILED:
        print("FAILED (%d): %s" % (len(FAILED), "; ".join(FAILED)))
        return 1
    print("sponsor portal: all passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
