#!/usr/bin/env python3
"""
generate_rss.py — Build feed.xml from data/daily-archive/index.json
Run via GitHub Actions after every daily briefing push.
Output: /feed.xml (root of repo / served at agsist.com/feed.xml)
"""

import json
import os
import sys
from datetime import datetime, timezone
from email.utils import format_datetime
from xml.sax.saxutils import escape

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

SITE     = "https://agsist.com"
TITLE    = "AGSIST Daily"
DESC     = ("Free morning market briefing for grain and livestock farmers: overnight "
            "futures, USDA reports and the news behind the moves. Posted most days "
            "between 5:45 and 6:30 a.m. Central, by Sigurd Lindquist, CCA.")
LINK     = f"{SITE}/daily"
IMG_URL  = f"{SITE}/img/og/agsist.jpg"
MAX_ITEMS = 30  # keep last 30 briefings in feed

def load_archive():
    path = os.path.join("data", "daily-archive", "index.json")
    if not os.path.exists(path):
        print(f"[RSS] index.json not found at {path}, skipping.")
        return []
    with open(path, "r") as f:
        data = json.load(f)
    return data.get("briefings", [])

def rfc822(date_iso: str, detail: dict = None) -> str:
    """RFC 822 pubDate: the moment the issue first went up (first_published_at,
    else generated_at, kept by generate_daily.keep_first_published). Before
    2026-10-16 every item claimed 05:00 -0600, which was an hour off in
    daylight time and not when anything posted. A date with no stamp gets
    noon Central so it can never land on the wrong day."""
    stamp = (detail or {}).get("first_published_at") or (detail or {}).get("generated_at")
    if stamp:
        try:
            dt = datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
            if dt.tzinfo:
                return format_datetime(dt.astimezone(timezone.utc).replace(microsecond=0))
        except Exception:
            pass
    try:
        dt = datetime.strptime(date_iso, "%Y-%m-%d")
        return dt.strftime("%a, %d %b %Y 12:00:00 -0500")
    except Exception:
        return date_iso

def load_briefing_detail(date_iso: str) -> dict:
    """Try to load the full briefing JSON for richer description."""
    path = os.path.join("data", "daily-archive", f"{date_iso}.json")
    if not os.path.exists(path):
        return {}
    try:
        with open(path, "r") as f:
            return json.load(f)
    except Exception:
        return {}

def build_description(entry: dict, detail: dict) -> str:
    """Build a plain-text RSS description from available data."""
    parts = []
    lead = detail.get("lead") or entry.get("headline", "")
    if lead:
        parts.append(lead)
    subheadline = detail.get("subheadline", "")
    if subheadline:
        parts.append(subheadline)
    # v5.1: one top-level action; per-section farmer_action only on old issues
    # 2026-10-09: the prediction bot's call (bot_call present) is not the
    # Daily's any more; it lives on /scorecard.
    top_action = "" if detail.get("bot_call") else detail.get("action", "")
    if top_action:
        parts.append(f"Action: {top_action}")
    sections = detail.get("sections", [])
    for sec in sections[:3]:  # first 3 sections only
        title = sec.get("title", "")
        action = sec.get("farmer_action", "")
        if title:
            parts.append(f"• {title}")
        if action:
            parts.append(f"  → {action}")
    parts.append(f"Read more: {SITE}/daily/{entry['date']}")
    return escape("\n".join(parts))

def _headline(b):
    """The issue page's own headline (generate_daily.news_headline), so the
    feed, the page and the news sitemap carry one title."""
    try:
        import generate_daily
        return generate_daily.news_headline(b)
    except Exception:
        return b.get("headline", "")


def generate():
    briefings = load_archive()
    if not briefings:
        print("[RSS] No briefings found, writing empty feed.")
        briefings = []

    # Sort newest first, cap at MAX_ITEMS
    briefings = sorted(briefings, key=lambda x: x.get("date", ""), reverse=True)[:MAX_ITEMS]

    now_rfc = format_datetime(datetime.now(timezone.utc).replace(microsecond=0))

    items = []
    for entry in briefings:
        date     = entry.get("date", "")
        detail   = load_briefing_detail(date)
        headline = escape(_headline(detail or entry) or f"AGSIST Daily, {date}")
        url      = f"{SITE}/daily/{date}"
        pub_date = rfc822(date, detail)
        desc     = build_description(entry, detail)

        items.append(f"""    <item>
      <title>{headline}</title>
      <link>{url}</link>
      <guid isPermaLink="true">{url}</guid>
      <pubDate>{pub_date}</pubDate>
      <dc:creator>Sigurd Lindquist</dc:creator>
      <description>{desc}</description>
    </item>""")

    feed = f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>{escape(TITLE)}</title>
    <link>{LINK}</link>
    <description>{escape(DESC)}</description>
    <language>en-us</language>
    <lastBuildDate>{now_rfc}</lastBuildDate>
    <atom:link href="{SITE}/feed.xml" rel="self" type="application/rss+xml"/>
    <image>
      <url>{IMG_URL}</url>
      <title>{escape(TITLE)}</title>
      <link>{LINK}</link>
    </image>
{chr(10).join(items)}
  </channel>
</rss>
"""

    out_path = "feed.xml"
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(feed)
    print(f"[RSS] Wrote {len(items)} items to {out_path}")

if __name__ == "__main__":
    generate()
