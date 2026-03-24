#!/usr/bin/env python3
"""
generate_rss.py — Build feed.xml from data/daily-archive/index.json
Run via GitHub Actions after every daily briefing push.
Output: /feed.xml (root of repo / served at agsist.com/feed.xml)
"""

import json
import os
from datetime import datetime
from xml.sax.saxutils import escape

SITE     = "https://agsist.com"
TITLE    = "AGSIST Daily — Morning Agricultural Intelligence Briefing"
DESC     = ("Free daily agricultural market briefing for corn, soybean, and grain "
            "producers. Overnight surprises, farmer actions, market analysis — "
            "every morning at 5 AM CT.")
LINK     = f"{SITE}/daily"
IMG_URL  = f"{SITE}/img/og/daily.jpg"
MAX_ITEMS = 30  # keep last 30 briefings in feed

def load_archive():
    path = os.path.join("data", "daily-archive", "index.json")
    if not os.path.exists(path):
        print(f"[RSS] index.json not found at {path}, skipping.")
        return []
    with open(path, "r") as f:
        data = json.load(f)
    return data.get("briefings", [])

def rfc822(date_iso: str) -> str:
    """Convert YYYY-MM-DD to RFC 822 date string for RSS."""
    try:
        dt = datetime.strptime(date_iso, "%Y-%m-%d")
        return dt.strftime("%a, %d %b %Y 05:00:00 -0600")
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

def generate():
    briefings = load_archive()
    if not briefings:
        print("[RSS] No briefings found, writing empty feed.")
        briefings = []

    # Sort newest first, cap at MAX_ITEMS
    briefings = sorted(briefings, key=lambda x: x.get("date", ""), reverse=True)[:MAX_ITEMS]

    now_rfc = datetime.utcnow().strftime("%a, %d %b %Y %H:%M:%S +0000")

    items = []
    for entry in briefings:
        date     = entry.get("date", "")
        headline = escape(entry.get("headline", f"AGSIST Daily — {date}"))
        url      = f"{SITE}/daily/{date}"
        pub_date = rfc822(date)
        detail   = load_briefing_detail(date)
        desc     = build_description(entry, detail)

        items.append(f"""    <item>
      <title>{headline}</title>
      <link>{url}</link>
      <guid isPermaLink="true">{url}</guid>
      <pubDate>{pub_date}</pubDate>
      <description>{desc}</description>
    </item>""")

    feed = f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
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
