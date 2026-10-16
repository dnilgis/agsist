#!/usr/bin/env python3
"""Hand-worked checks for the Daily's news surfaces (generate_daily.py):
first-published stamps, the Google News sitemap window, Central-time dates,
the dateline and the one-headline rule. No network, writes only to a temp dir.
test/daily-news.test.mjs runs this."""
import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import generate_daily as g  # noqa: E402

fails = []


def ck(name, ok, got=""):
    print(("  ok    " if ok else "  FAIL  ") + name + ("" if ok else f"  (got {got!r})"))
    if not ok:
        fails.append(name)


# Central time, with the offset. 10:47:49Z in October is CDT (UTC-5): 5:47:49 AM.
ck("iso_ct CDT", g.iso_ct("2026-10-16T10:47:49.880541+00:00") == "2026-10-16T05:47:49-05:00",
   g.iso_ct("2026-10-16T10:47:49.880541+00:00"))
# After Nov 1 it is CST (UTC-6): 11:47:00Z is 5:47 AM.
ck("iso_ct CST", g.iso_ct("2026-11-16T11:47:00+00:00") == "2026-11-16T05:47:00-06:00",
   g.iso_ct("2026-11-16T11:47:00+00:00"))
ck("human_ct", g.human_ct("2026-10-16T10:47:49+00:00") == "5:47 AM CT Oct 16, 2026",
   g.human_ct("2026-10-16T10:47:49+00:00"))
ck("a bare date is not a time", g.iso_ct("2026-10-16", "x") == "x")

with tempfile.TemporaryDirectory() as td:
    td = Path(td)
    jp = td / "2026-09-04.json"
    # First save of the day keeps generated_at.
    b = g.keep_first_published({"generated_at": "2026-09-04T11:16:26+00:00"}, jp)
    ck("first save: first_published_at = generated_at", b["first_published_at"] == "2026-09-04T11:16:26+00:00", b)
    jp.write_text(json.dumps(b))
    # The 5:04 PM regeneration keeps the morning stamp.
    b2 = g.keep_first_published({"generated_at": "2026-09-04T22:04:33+00:00"}, jp)
    ck("regeneration keeps the morning stamp", b2["first_published_at"] == "2026-09-04T11:16:26+00:00", b2)
    # A stamp carried over from another day never back-dates the issue.
    b3 = g.keep_first_published({"generated_at": "2026-09-05T11:00:00+00:00",
                                 "first_published_at": "2026-09-04T11:16:26+00:00"}, td / "2026-09-05.json")
    ck("another day's stamp is ignored", b3["first_published_at"] == "2026-09-05T11:00:00+00:00", b3)

    # News sitemap: last 48 hours only, newest first, XML-escaped titles.
    jd, hd = td / "j", td / "h"
    jd.mkdir(); hd.mkdir()
    for d, gen, hl in (("2026-10-13", "2026-10-13T10:47:00+00:00", "Old news"),
                       ("2026-10-15", "2026-10-15T10:47:41+00:00", "Beans & corn <hold>"),
                       ("2026-10-16", "2026-10-16T10:47:49+00:00", "Corn slips 2¾ cents to $4.75½")):
        (jd / f"{d}.json").write_text(json.dumps({"generated_at": gen, "headline": hl}))
        (hd / f"{d}.html").write_text("x")
    (jd / "2026-10-14.json").write_text(json.dumps({"generated_at": "2026-10-14T10:47:00+00:00", "headline": "No page"}))
    now = datetime(2026, 10, 16, 18, 0, tzinfo=timezone.utc)
    xml, n = g.news_sitemap_xml(now, jd, hd)
    # 10-16 is 7.2 h old, 10-15 is 31.2 h, 10-14 has no page, 10-13 is 79.2 h (> 48).
    ck("two issues in the window", n == 2, n)
    ck("newest first", xml.index("daily/2026-10-16") < xml.index("daily/2026-10-15"))
    ck("old issue left out", "2026-10-13" not in xml)
    ck("issue without a page left out", "2026-10-14" not in xml)
    ck("publication date with offset", "<news:publication_date>2026-10-16T05:47:49-05:00</news:publication_date>" in xml)
    ck("title escaped", "<news:title>Beans &amp; corn &lt;hold&gt;</news:title>" in xml)
    ck("publication name and language", xml.count("<news:name>AGSIST</news:name><news:language>en</news:language>") == 2)
    xml0, n0 = g.news_sitemap_xml(datetime(2026, 10, 20, 12, 0, tzinfo=timezone.utc), jd, hd)
    ck("empty window is a valid empty urlset", n0 == 0 and xml0.strip().endswith("</urlset>") and "<url>" not in xml0)

# One headline: H1 = title prefix = og:title prefix = NewsArticle headline.
br = {"headline": "Corn slips 2¾ cents to $4.75½ as funds sell into harvest",
      "generated_at": "2026-10-16T10:47:49+00:00", "first_published_at": "2026-10-16T10:47:49+00:00",
      "lead": "Corn is at $4.75½ overnight. " * 6, "date": "Friday, October 16, 2026"}
page = g.generate_archive_html(br, "2026-10-16")
hl = g.news_headline(br)
ck("H1 is the headline", f'<h1 class="dv3-headline">{g.html_esc(hl)}</h1>' in page)
ck("title starts with it", f"<title>{g.html_esc(hl)} | Oct 16, 2026" in page)
ck("NewsArticle headline", f'"headline": "{hl}"' in page and '"@type": "NewsArticle"' in page)
ck("dateline shows the published time", 'Published <time datetime="2026-10-16T05:47:49-05:00">5:47 AM CT Oct 16, 2026</time>' in page)
ck("no Updated when not rewritten", "Updated <time" not in page)
br2 = dict(br, generated_at="2026-10-16T20:05:00+00:00")
p2 = g.generate_archive_html(br2, "2026-10-16")
ck("Updated after a rewrite", 'Updated <time datetime="2026-10-16T15:05:00-05:00">3:05 PM CT Oct 16, 2026</time>' in p2)
ck("dateModified after a rewrite", '"dateModified": "2026-10-16T15:05:00-05:00"' in p2 and '"datePublished": "2026-10-16T05:47:49-05:00"' in p2)
long = dict(br, headline="Corn " + "and beans " * 30)
ck("headline capped at 110", len(g.news_headline(long)) <= 110, len(g.news_headline(long)))
ck("links how the briefing is made", 'href="/editorial-standards#how-the-daily-is-made"' in page)
ck("links corrections", 'href="/editorial-standards#corrections"' in page)
ck("no correction box without corrections", "<aside class=\"dv3-corrections\"" not in page)
p3 = g.generate_archive_html(dict(br, corrections=[{"date": "2026-10-17", "text": "Beans were off 6 cents, not 8."}]), "2026-10-16")
ck("correction box", "<strong>Correction, Oct 17, 2026:</strong> Beans were off 6 cents, not 8." in p3)
ck("no em dash in the page chrome", "—" not in page)

print("daily news checks: " + ("all passed" if not fails else f"{len(fails)} FAILED"))
sys.exit(1 if fails else 0)
