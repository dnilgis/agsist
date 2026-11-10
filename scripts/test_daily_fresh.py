#!/usr/bin/env python3
"""
test_daily_fresh.py -- fresh every morning (Nov 1 2026), pinned on the real
archive and on fixtures. Run by test/daily-fresh.test.mjs.

  replay     the 14 issues Oct 19 to Nov 1 2026 through daily_fresh.hits: which
             would have gone back to the writer, and why
  gate       briefing_gate holds a stamped issue that still repeats; an old
             issue (no stamp) is not re-judged; headline_fix never takes a
             repeat for a claim to rewrite
  stories    top story links come from the digest by id, a wrong id or a URL the
             model wrote is never used, a story with no digest item is cut, a
             shared-host link is refused; the archive page links each story
  feeds      the new feeds are on the list through Google News; a dead feed is
             skipped and counted dark; digest items carry ids and links
  prompt     3 to 5 top stories, one per tag, the weekend headline rule, no
             "EXACTLY 1 item" left
  week ahead the block label needs every item to be a dated upcoming event

    python3 scripts/test_daily_fresh.py

Fixtures only: no network, no model call, nothing sent.
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import copy
import datetime as dt
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import daily_fresh as F     # noqa: E402
import briefing_gate        # noqa: E402
import daily_schema         # noqa: E402
import generate_daily as g  # noqa: E402

FAILS = []
ARCH = os.path.join(REPO, "data", "daily-archive")


def ok(c, m):
    print(("ok   " if c else "FAIL ") + m)
    if not c:
        FAILS.append(m)


def load(iso):
    with open(os.path.join(ARCH, iso + ".json"), encoding="utf-8") as fh:
        return json.load(fh)


def replay():
    # "sentence" (Nov 2): Oct 24 retold Oct 23's Cattle on Feed line; Oct 25 the USDA data-error line, the
    # Cattle on Feed line and Saturday's natural gas line word for word; Nov 1 Saturday's corn settle line.
    want_hard = {"2026-10-24": {"weekend", "sentence"}, "2026-10-25": {"headline", "weekend", "story", "sentence"},
                 "2026-10-29": {"number"}, "2026-10-31": {"weekend", "number"},
                 "2026-11-01": {"headline", "weekend", "number", "story", "sentence"}}
    want_soft = {"2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28"}
    d = dt.date(2026, 10, 19)
    while d <= dt.date(2026, 11, 1):
        iso = d.isoformat()
        f = F.hits(load(iso), F.recent(d, ARCH), d, ARCH)
        hard = {k for k, _, _ in f if k not in F.SOFT}
        soft = {k for k, _, _ in f if k in F.SOFT}
        ok(hard == want_hard.get(iso, set()), "%s: repeats %s (want %s)" % (iso, sorted(hard), sorted(want_hard.get(iso, set()))))
        ok(bool(soft) == (iso in want_soft), "%s: a fourth issue led by the same market: %s" % (iso, bool(soft)))
        d += dt.timedelta(days=1)
    n = sum(1 for iso in want_hard)
    ok(n == 5, "5 of the 14 issues would have gone back for a repeat that holds the send")


def gate():
    nov1 = load("2026-11-01")
    passed, issues = briefing_gate.run(dict(nov1), None, today=dt.date(2026, 11, 1), archive_dir=ARCH)
    ok(not any(c.startswith("fresh") for _, c, _ in issues), "an issue from before the check (no stamp) is not re-judged")
    stamped = dict(nov1, freshness={"window": 7, "tries": 2, "hits": []})
    passed, issues = briefing_gate.run(stamped, None, today=dt.date(2026, 11, 1), archive_dir=ARCH)
    fresh = [(s, c) for s, c, _ in issues if c.startswith("fresh")]
    ok(("WARN", "fresh:headline") in fresh and ("WARN", "fresh:weekend") in fresh
       and ("WARN", "fresh:number") in fresh and ("WARN", "fresh:story") in fresh
       and not any(st == "FAIL" for st, _ in fresh), "Nov 1, stamped and uncut: its repeats warn, never hold %r" % fresh)
    # Nov 2 2026. The rule changed from "repeats warn, never hold" to: what still
    # repeats after the one rewrite is cut before the send (story, sentence, the day's number; a repeated
    # headline becomes the top story's title), and only what cannot be cut is left, as a warning. The email
    # always goes out.
    cut = copy.deepcopy(stamped)
    rec = F.recent(dt.date(2026, 11, 1), ARCH)
    left, log = F.cut_repeats(cut, F.hits(cut, rec, dt.date(2026, 11, 1), ARCH), rec, dt.date(2026, 11, 1), ARCH)
    passed, issues = briefing_gate.run(cut, None, today=dt.date(2026, 11, 1), archive_dir=ARCH)
    fresh = [(s_, c) for s_, c, _ in issues if c.startswith("fresh")]
    ok("one_number" not in cut and not cut.get("outside_the_pit"), "Nov 1: the 2.48 number and the farm bill story are cut %r" % log)
    ok(not [c for _s, c in fresh if c in ("fresh:number", "fresh:story")] and ("WARN", "fresh:headline") in fresh
       and not any(st == "FAIL" for st, _ in fresh),
       "Nov 1, cut: only the headline is left (no story to replace it), and it warns, never holds the send %r" % fresh)
    import headline_fix
    msgs = [m for s, c, m in issues if c.startswith("fresh")]
    ok(msgs and not any(headline_fix._LOC.match(m) for m in msgs), "headline_fix does not take a repeat for a claim")
    fresh_head = copy.deepcopy(stamped)
    fresh_head["headline"] = "Senate farm bill heads to a lame-duck vote with a $4.4 billion score"
    fresh_head["one_number"] = {"value": "61%", "unit": "corn harvested by Oct 25", "context": "x"}
    fresh_head["outside_the_pit"] = [{"title": "Brazil soybean planting runs ahead of last year", "body": "x", "tag": "TRADE"}]
    passed, issues = briefing_gate.run(fresh_head, None, today=dt.date(2026, 11, 1), archive_dir=ARCH)
    ok(not [c for s, c, _ in issues if c.startswith("fresh") and s == "FAIL"], "a new headline, number and story pass: %r"
       % [m for s, c, m in issues if c.startswith("fresh")])


def cut_nov2():
    """The Oct 30 to Nov 2 2026 repeats the owner named on Nov 2, from the real archive."""
    d = dt.date(2026, 11, 2)
    b = load("2026-11-02")
    rec = F.recent(d, ARCH)
    found = F.hits(b, rec, d, ARCH)
    kinds = [(k, loc) for k, loc, _ in found]
    ok(("number", "one_number.value") in kinds, "Nov 2: Brent $105 again (Oct 30) is a repeat")
    ok(("story", "outside_the_pit[1]") in kinds, "Nov 2: 'Screwworm found in Arizona' is Oct 29's Arizona case")
    ok(("story", "outside_the_pit[2]") in kinds, "Nov 2: the dyed diesel waiver ran in Nov 1's sections")
    ok(("story", "outside_the_pit[0]") not in kinds, "Nov 2: China's $17 billion pledge is new")
    ok(("sentence", "sections[1].body") in kinds, "Nov 2: AgWeb's 'healthy correction' (Oct 31, Nov 1) again")
    cut = copy.deepcopy(b)
    left, log = F.cut_repeats(cut, found, rec, d, ARCH)
    ok(left == [], "Nov 2: nothing repeats after the cut %r" % left)
    ok([x["title"] for x in cut["outside_the_pit"]] == [b["outside_the_pit"][0]["title"]], "Nov 2: the new story stays")
    ok("one_number" not in cut and "healthy correction" not in cut["sections"][1]["body"]
       and cut["sections"][1]["body"].strip(), "Nov 2: the number and the sentence are cut, the section keeps the rest")
    ok(cut["headline"] == b["headline"], "Nov 2: a fresh headline is not touched")
    # a repeated headline falls back to the top story's title, never the board
    h = copy.deepcopy(b)
    h["headline"] = load("2026-11-01")["headline"]
    left, log = F.cut_repeats(h, F.hits(h, rec, d, ARCH), rec, d, ARCH)
    ok(h["headline"] == b["outside_the_pit"][0]["title"] and not any(k == "headline" for k, _, _ in left),
       "a repeated headline becomes the top story: %r" % h["headline"])
    want = (b["outside_the_pit"][0].get("body") or "").strip()
    ok(want and h["teaser"] == want, "the teaser follows the new headline (the story's line), not the old board teaser")
    # Oct 29's Arizona item is a new turn from Oct 23/25 (a new state); a second case is a development
    ok(F.new_development({"title": "Arizona confirms its first New World screwworm case", "body": "x"},
                         {"title": "USDA confirms screwworm in a Texas elk", "body": "Pecos County"}), "a new state is new")
    ok(not F.new_development({"title": "Screwworm found in Arizona, third state affected",
                              "body": "USDA confirmed the first Arizona case."},
                             {"title": "Arizona confirms its first New World screwworm case", "body": "Drovers"}),
       "the same first case, retold, is not")


def stories():
    items = [
        {"id": "N1", "title": "USDA to pay $8 billion in harvest fuel aid", "link": "https://www.agweb.com/a",
         "source": "agweb.com", "publisher": "AgWeb", "bucket": "ENERGY & INPUTS"},
        {"id": "N2", "title": "Arizona confirms its first New World screwworm case", "link": "https://news.google.com/rss/articles/abc?oc=5",
         "source": "drovers.com", "publisher": "Drovers", "bucket": "ANIMAL HEALTH"},
        {"id": "N3", "title": "House Republicans raise concerns over Senate E15 plan", "link": "",
         "source": "agri-pulse.com", "publisher": "", "bucket": "POLICY & TRADE"},
    ]
    b = {"outside_the_pit": [
        {"title": "USDA will pay $8 billion in harvest fuel aid", "body": "x", "tag": "INPUTS", "ref": "N1",
         "link": "https://made-up.example/never"},
        {"title": "Screwworm reaches Arizona, its first case", "body": "x", "tag": "DISEASE", "ref": "N3"},
        {"title": "House Republicans question the Senate E15 plan", "body": "x", "tag": "POLICY"},
        {"title": "China buys a record 40 cargoes of US sorghum", "body": "x", "tag": "TRADE", "ref": "N9"},
    ]}
    log = g.attach_story_links(b, items)
    t = b["outside_the_pit"]
    ok(len(t) == 3 and t[0]["link"] == "https://www.agweb.com/a" and t[0]["source"] == "AgWeb",
       "a cited id brings its link and publisher; the model's own URL is dropped")
    ok(t[1]["news_id"] == "N2" and t[1]["link"].startswith("https://news.google.com/"),
       "a wrong id (N3 for the screwworm story) is matched by title instead")
    ok(t[2]["news_id"] == "N3" and "link" not in t[2] and t[2]["source"] == "agri-pulse.com",
       "no id: matched by title; no link in the digest, no link on the story")
    ok(any("cut story" in l and "sorghum" in l for l in log), "a story with no digest item is cut: %r" % log)
    ok(not any("ref" in x for x in t), "the ref field never reaches the issue")
    snip = "Lawmakers said on Tuesday that the new farm bill would not be taken up before the end of the year"
    cp = {"outside_the_pit": [
        {"title": "Farm bill waits on the new Congress", "ref": "N1", "tag": "POLICY",
         "body": "Lawmakers said on Tuesday that the new farm bill would not be taken up before the end of the year."},
        {"title": "Farm bill waits on the new Congress", "ref": "N2", "tag": "POLICY",
         "body": "Nothing moves on the farm bill until the new Congress sits in January."}]}
    cl = g.attach_story_links(cp, [
        {"id": "N1", "title": "Farm bill stalls", "summary": snip, "link": "", "source": "a.com", "publisher": "A"},
        {"id": "N2", "title": "Farm bill stalls", "summary": snip, "link": "", "source": "b.com", "publisher": "B"}])
    ok(len(cp["outside_the_pit"]) == 1 and cp["outside_the_pit"][0]["news_id"] == "N2"
       and any("repeats" in l and "N1" not in l and "publisher" in l for l in cl),
       "a story body that repeats 8 or more words from the publisher's summary is cut: %r" % cl)
    ok(g.copied_run("the new farm bill would not be taken up", snip) == 9, "copied_run counts shared words")
    ok(g.copied_run("Farm bill stalls", "farm bill stalls as the senate leaves") == 3, "a three word headline echo is under the limit")
    keep = {"outside_the_pit": [{"title": "Anything", "body": "x"}]}
    g.attach_story_links(keep, [])
    ok(len(keep["outside_the_pit"]) == 1, "with no digest at all the stories stay, unlinked, as before")
    for u, want in (("https://www.dtnpf.com/x", True), ("http://www.dtnpf.com/x", False),
                    ("https://agsist-api.dnilgis.workers.dev/x", False), ("https://user@evil.com/x", False),
                    ("https://x.com/a b", False), ("javascript:alert(1)", False)):
        ok(bool(g.safe_story_link(u)) == want, "safe_story_link(%r) is %s" % (u, want))
    html = g.render_outside_the_pit_html([{"title": "A <b> & C", "body": "line", "tag": "POLICY",
                                           "link": "https://www.agweb.com/a?x=1&y=2", "source": "AgWeb"}])
    ok('href="https://www.agweb.com/a?x=1&amp;y=2"' in html and "A &lt;b&gt; &amp; C" in html and "Source: AgWeb" in html
       and 'rel="noopener nofollow"' in html, "the archive page links each story and names its source")
    bad = {"headline": "h", "lead": "l", "sections": [], "date": "d", "generated_at": "x",
           "outside_the_pit": [{"title": "t", "link": "https://a.b.workers.dev/x"}]}
    _ok, errs, _w = daily_schema.validate(bad)
    ok(not _ok and any("outside_the_pit[0].link" in e_ for e_ in errs), "the schema refuses a shared-host story link: %r" % (errs,))
    many = dict(bad, outside_the_pit=[{"title": "t%d" % i} for i in range(6)])
    ok(any("top stories" in e_ for e_ in daily_schema.validate(many)[1]), "the schema refuses a sixth top story")


def feeds():
    hosts = [h for h, _ in g.AG_RSS_FEEDS]
    for h in ("usda.gov", "dtnpf.com", "agriculture.com", "farmprogress.com", "reuters.com",
              "extension.iastate.edu", "extension.umn.edu", "extension.purdue.edu", "cpc.ncep.noaa.gov"):
        ok(h in hosts, "feed on the list: %s" % h)
    for h, u in g.AG_RSS_FEEDS[-9:]:
        ok(u.startswith("https://news.google.com/rss/search?q=site%3A"), "%s goes through Google News: %s" % (h, u[:70]))
    ok("site%3Areuters.com+%28farmers+OR+grain" in dict(g.AG_RSS_FEEDS)["reuters.com"], "Reuters carries an ag query")
    ok(len(hosts) == len(set(hosts)), "no feed twice")
    ok(g._bucket_for("usda confirms screwworm in texas cattle") == "ANIMAL HEALTH", "animal disease has its own bucket")
    ok(g._bucket_for("deere settles right-to-repair case") == "TECHNOLOGY", "so does farm technology")
    ok(g._bucket_for("corn harvest 61% done") == "GRAINS & OILSEEDS", "grains still first for grain stories")

    class Feed:
        def __init__(self, entries):
            self.entries = entries

    class FP:
        @staticmethod
        def parse(text):
            n = int(text)
            return Feed([{"title": "Story %d about corn harvest pace - Publisher %d" % (n, n), "summary": "s",
                          "link": "https://news.google.com/rss/articles/s%d" % n,
                          "source": {"title": "Publisher %d" % n, "href": "https://p%d.com" % n}}])
    real_get, real_fp, real_feeds = g.http_get, g.feedparser, g.AG_RSS_FEEDS
    try:
        g.feedparser = FP
        g.AG_RSS_FEEDS = [("a.com", "1"), ("dead.com", "dead"), ("b.com", "2")]
        g.http_get = lambda url, timeout=10: None if url == "dead" else url
        block = g.fetch_ag_news()
    finally:
        g.http_get, g.feedparser, g.AG_RSS_FEEDS = real_get, real_fp, real_feeds
    cov, items = g.fetch_ag_news.coverage, g.fetch_ag_news.items
    ok(cov["ok"] == 2 and cov["total"] == 3 and cov["dark"] == ["dead.com"], "a dead feed is skipped and counted dark: %r" % cov)
    ok([x["id"] for x in items] == ["N1", "N2"] and all(x["link"].startswith("https://news.google.com/") for x in items),
       "digest items carry ids and links")
    ok(items[0]["title"] == "Story 1 about corn harvest pace" and items[0]["publisher"] == "Publisher 1",
       "the publisher comes off the Google News title and is kept as the source")
    ok("[N1] Story 1 about corn harvest pace" in block and "[N2]" in block, "the writer sees the ids")


def prompt():
    wk = {"is_closed": False, "day_name": "Tuesday", "reason": "", "note": ""}
    sat = {"is_closed": True, "day_name": "Saturday", "reason": "weekend", "note": "closed"}
    p, ps = g.build_system_prompt(wk, []), g.build_system_prompt(sat, [])
    ok("EXACTLY 1 item" not in p and "3 to 5 items" in p, "3 to 5 top stories, not one")
    ok("At most ONE item per tag" in p and '"ref"' in p, "one per tag; each names its digest id")
    ok("lead 45; each section body 40; so_what 12; one_number.context 25" in p, "the prompt states the re-split budget")
    ok("WEEKEND HEADLINE" in ps and "WEEKEND HEADLINE" not in p, "the weekend headline rule, weekends only")
    ok("Do not lead with corn by habit" in p, "rule 16e no longer sends a quiet day to corn")
    mb = F.memory_block(F.recent(dt.date(2026, 11, 1), ARCH))
    ok("ALREADY SAID THIS WEEK" in mb and "Corn ends the week at $4.47¾" in mb and "2.48" in mb
       and "Senate farm bill" in mb, "the writer's memory block lists headlines, numbers and news")


def week_ahead():
    fri = dt.date(2026, 10, 30)
    ev = {"title": "USDA Crop Progress Monday", "body": "x", "event_date": "2026-11-02"}
    done = {"title": "Senate farm bill scores $4.4 billion", "body": "x"}
    b = {"market_closed": True, "outside_the_pit": [dict(ev), dict(done)]}
    g.mark_week_ahead(b, fri)
    ok(b["otp_week_ahead"] is False, "one item that already happened keeps the block Outside the pit")
    b = {"market_closed": True, "outside_the_pit": [dict(ev), dict(ev, title="ARC and PLC sign-up ends Tuesday", event_date="2026-11-03")]}
    g.mark_week_ahead(b, fri)
    ok(b["otp_week_ahead"] is True, "every item a dated upcoming event: Week ahead in ag")


def main():
    replay()
    gate()
    cut_nov2()
    stories()
    feeds()
    prompt()
    week_ahead()
    print("test_daily_fresh: %d failure(s)" % len(FAILS))
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
