#!/usr/bin/env python3
"""
INDEXNOW SENDS EVERY SITEMAP ROBOTS.TXT LISTS, IN LEGAL BATCHES.

scripts/indexnow_submit.py used to read sitemap.xml only, so the ARC/PLC,
cash-bid town and atlas pages never reached Bing. This proves, offline, that
it reads every Sitemap: line in robots.txt, follows a sitemap index, drops
other hosts, never puts more than 10,000 URLs in one request, and that the
real repo's robots.txt names sitemap-arc-plc.xml. Nothing is sent.

    python3 scripts/test_indexnow_submit.py
"""
import os
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import indexnow_submit as I  # noqa: E402

FAILED = []


def check(ok, name, detail=""):
    print(("  ok    " if ok else "  FAIL  ") + name + ("" if ok else "  :: " + str(detail)))
    if not ok:
        FAILED.append(name)


def urlset(*locs):
    return ('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
            + "".join(f"<url><loc>{u}</loc></url>" for u in locs) + "</urlset>")


with tempfile.TemporaryDirectory() as td:
    root = Path(td).resolve()
    (root / "robots.txt").write_text(
        "User-agent: *\nAllow: /\nSitemap: https://agsist.com/sitemap.xml\n"
        "sitemap: https://agsist.com/sitemap-arc-plc.xml\nSitemap: https://agsist.com/sitemap-index.xml\n")
    (root / "sitemap.xml").write_text(urlset("https://agsist.com/", "https://evil.example/x"))
    (root / "sitemap-arc-plc.xml").write_text(urlset("https://agsist.com/arc-plc", "https://agsist.com/arc-plc/iowa/story"))
    (root / "sitemap-index.xml").write_text(
        '<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
        "<sitemap><loc>https://agsist.com/sitemap-a.xml</loc></sitemap>"
        "<sitemap><loc>https://agsist.com/sitemap.xml</loc></sitemap></sitemapindex>")
    (root / "sitemap-a.xml").write_text(urlset("https://agsist.com/a"))

    sms = I.robots_sitemaps(root)
    check(len(sms) == 3 and sms[1].endswith("sitemap-arc-plc.xml"), "every Sitemap: line read, any case", sms)
    urls = I.fetch_sitemap_urls(root)
    check("https://agsist.com/arc-plc/iowa/story" in urls, "ARC/PLC sitemap URLs included")
    check("https://agsist.com/a" in urls, "sitemap index followed")
    check(not any("evil.example" in u for u in urls), "other hosts dropped")

    empty = root / "none"
    empty.mkdir()
    check(I.robots_sitemaps(empty) == [I.SITEMAP_URL], "no robots.txt falls back to sitemap.xml")

big = [f"https://agsist.com/p{i}" for i in range(25_001)]
b = I.chunks(big)
check([len(x) for x in b] == [10_000, 10_000, 5_001], "25,001 URLs go as 10,000 + 10,000 + 5,001", [len(x) for x in b])
check(sum(b, []) == big, "batches keep every URL in order")
check(max(len(x) for x in I.chunks(big, 50_000)) == I.MAX_PER_REQUEST, "batch size never above the limit")

repo = HERE.parent
check(any(s.endswith("/sitemap-arc-plc.xml") for s in I.robots_sitemaps(repo)), "repo robots.txt lists sitemap-arc-plc.xml")

if FAILED:
    print(f"\n{len(FAILED)} failed")
    sys.exit(1)
print("\nall indexnow checks pass")
