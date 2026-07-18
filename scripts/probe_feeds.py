#!/usr/bin/env python3
"""
probe_feeds.py — find out WHY 13 of 22 news feeds are dark, and what fixes them.

CONTEXT
  The 2026-07-15 run reported "RSS feeds: 9/22 returned recent content". The
  briefing leads on news. Running it on 41% of its intended news base is a
  quality problem that never announces itself -- there is no error, the prose
  just gets thinner and leans harder on the few feeds that answer.

  The obvious guess -- "add a User-Agent" -- is WRONG. generate_daily.py already
  sends a full Chrome UA with proper Accept headers and still gets 403s. So the
  cause is something else, and guessing again would waste another day.

WHAT THIS TESTS, PER FEED
  A  current    : the exact headers generate_daily.py sends today (Chrome/124)
  B  modern_ua  : same, but a current Chrome UA. A two-year-old UA string is
                  itself a bot signal to Cloudflare/Akamai.
  C  long_to    : current headers, 30s timeout instead of 12s. usda.gov and
                  ams.usda.gov TIMED OUT rather than 403'd -- a different
                  disease needing a different medicine.
  D  gnews      : the same publisher via Google News RSS. Google News is built
                  to be fetched and does not blacklist datacenter IPs, so it can
                  recover publishers whose own WAF blocks GitHub's Azure ranges.
                  Headlines + links only -- which is all the briefing uses.

  Every attempt reports status, bytes, item count, and newest item age, so a
  feed that returns 200 but is six weeks stale is not mistaken for a win.

Writes nothing. Prints a verdict table.
"""

import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

FEEDS = [
    ("nass_reports",  "https://www.nass.usda.gov/rss/reports.xml",              None),
    ("nass_news",     "https://www.nass.usda.gov/rss/news.xml",                 None),
    ("usda_releases", "https://www.usda.gov/rss/latest-releases.xml",           None),
    ("ams_news",      "https://www.ams.usda.gov/rss/news.xml",                  None),
    ("fas_news",      "https://www.fas.usda.gov/rss/news.xml",                  None),
    ("eia_energy",    "https://www.eia.gov/rss/todayinenergy.xml",              None),
    ("agri_pulse",    "https://www.agri-pulse.com/articles.rss",                "agri-pulse.com"),
    ("world_grain",   "https://www.world-grain.com/rss",                        "world-grain.com"),
    ("agweb",         "https://www.agweb.com/rss",                              "agweb.com"),
    ("agproud",       "https://www.agproud.com/rss",                            "agproud.com"),
    ("brownfield",    "https://brownfieldagnews.com/feed/",                     "brownfieldagnews.com"),
    ("fencepost",     "https://www.thefencepost.com/feed/",                     "thefencepost.com"),
    ("drovers",       "https://www.drovers.com/rss",                            "drovers.com"),
    ("beefmagazine",  "https://www.beefmagazine.com/rss.xml",                   "beefmagazine.com"),
    ("dairyherd",     "https://www.dairyherd.com/rss",                          "dairyherd.com"),
    ("porkbusiness",  "https://www.porkbusiness.com/rss",                       "porkbusiness.com"),
    ("feedstuffs",    "https://www.feedstuffs.com/rss.xml",                     "feedstuffs.com"),
    ("feednavigator", "https://www.feednavigator.com/Info/Feed-Navigator-RSS",  "feednavigator.com"),
    ("notillfarmer",  "https://www.no-tillfarmer.com/rss/articles",             "no-tillfarmer.com"),
    ("oilprice",      "https://oilprice.com/rss/main",                          "oilprice.com"),
    ("farmpolicy",    "https://farmpolicynews.illinois.edu/feed/",              "farmpolicynews.illinois.edu"),
    ("farmdoc",       "https://farmdocdaily.illinois.edu/feed",                 "farmdocdaily.illinois.edu"),
]

UA_CURRENT = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
UA_MODERN = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
             "(KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36")

ACCEPT = ("application/rss+xml, application/atom+xml, application/xml;q=0.9, "
          "text/xml;q=0.9, */*;q=0.8")


def headers(ua):
    return {"User-Agent": ua, "Accept": ACCEPT, "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate", "Cache-Control": "no-cache"}


def get(url, ua, timeout):
    req = urllib.request.Request(url, headers=headers(ua))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                import gzip
                raw = gzip.decompress(raw)
            return r.status, raw.decode("utf-8", "replace"), None
    except urllib.error.HTTPError as e:
        return e.code, "", f"HTTP {e.code}"
    except Exception as e:
        return None, "", f"{type(e).__name__}: {str(e)[:60]}"


def analyse(body):
    """-> (n_items, age_days_of_newest or None). A 200 that is six weeks stale
    is not a working feed, and must not be counted as one."""
    items = re.findall(r"<(?:item|entry)\b", body)
    dates = re.findall(r"<(?:pubDate|updated|published)>([^<]+)</", body)
    newest = None
    for d in dates[:14]:
        dt = None
        try:
            dt = parsedate_to_datetime(d.strip())
        except Exception:
            try:
                dt = datetime.fromisoformat(d.strip().replace("Z", "+00:00"))
            except Exception:
                pass
        if dt:
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            age = (datetime.now(timezone.utc) - dt).total_seconds() / 86400
            newest = age if newest is None else min(newest, age)
    return len(items), newest


def gnews_url(domain):
    q = urllib.parse.quote(f"site:{domain}")
    return f"https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en"


def main():
    print("PROBE FEEDS — reads only, writes nothing")
    print(f"runner egress IP class matters here; this runs from GitHub's Azure ranges\n")
    rows = []
    for name, url, domain in FEEDS:
        print(f"── {name}  {url}")
        res = {}

        for label, ua, to in (("A current", UA_CURRENT, 12),
                              ("B modern_ua", UA_MODERN, 12),
                              ("C long_to", UA_CURRENT, 30)):
            st, body, err = get(url, ua, to)
            if body:
                n, age = analyse(body)
                ok = n > 0 and (age is None or age < 7)
                res[label] = ok
                print(f"     {label:<12} {str(st):<5} {len(body):>7}B  items={n:<3} "
                      f"newest={'?' if age is None else f'{age:.1f}d'}  {'OK' if ok else 'stale/empty'}")
            else:
                res[label] = False
                print(f"     {label:<12} {str(st):<5} {'':>7}   {err}")
            time.sleep(0.4)

        if domain:
            st, body, err = get(gnews_url(domain), UA_MODERN, 20)
            if body:
                n, age = analyse(body)
                ok = n > 0 and (age is None or age < 7)
                res["D gnews"] = ok
                print(f"     {'D gnews':<12} {str(st):<5} {len(body):>7}B  items={n:<3} "
                      f"newest={'?' if age is None else f'{age:.1f}d'}  {'OK' if ok else 'stale/empty'}")
            else:
                res["D gnews"] = False
                print(f"     {'D gnews':<12} {str(st):<5} {'':>7}   {err}")
            time.sleep(0.4)
        else:
            res["D gnews"] = None   # USDA/EIA: no point routing gov feeds via Google

        rows.append((name, res))
        print()

    print("=" * 78)
    print("  VERDICT")
    print("=" * 78)
    print(f"  {'feed':<15} {'current':<9} {'modern_ua':<11} {'long_to':<9} {'gnews':<7} recommendation")
    fixes = {"modern_ua": [], "long_to": [], "gnews": [], "dead": [], "already": []}
    for name, r in rows:
        def m(k):
            v = r.get(k)
            return "-" if v is None else ("yes" if v else "no")
        if r.get("A current"):
            rec = "keep as-is"; fixes["already"].append(name)
        elif r.get("B modern_ua"):
            rec = "UPDATE UA STRING"; fixes["modern_ua"].append(name)
        elif r.get("C long_to"):
            rec = "RAISE TIMEOUT to 30s"; fixes["long_to"].append(name)
        elif r.get("D gnews"):
            rec = "ROUTE VIA GOOGLE NEWS"; fixes["gnews"].append(name)
        else:
            rec = "DEAD — drop it or find another source"; fixes["dead"].append(name)
        print(f"  {name:<15} {m('A current'):<9} {m('B modern_ua'):<11} {m('C long_to'):<9} {m('D gnews'):<7} {rec}")

    print()
    print(f"  working today          : {len(fixes['already'])}/22")
    print(f"  fixed by modern UA     : {len(fixes['modern_ua'])}  {fixes['modern_ua']}")
    print(f"  fixed by 30s timeout   : {len(fixes['long_to'])}  {fixes['long_to']}")
    print(f"  recoverable via gnews  : {len(fixes['gnews'])}  {fixes['gnews']}")
    print(f"  genuinely dead         : {len(fixes['dead'])}  {fixes['dead']}")
    total = len(fixes['already']) + len(fixes['modern_ua']) + len(fixes['long_to']) + len(fixes['gnews'])
    print(f"\n  ACHIEVABLE COVERAGE    : {total}/22  (today: {len(fixes['already'])}/22)")
    print("\n  Paste this log back and the fixes get written against these results.")


if __name__ == "__main__":
    main()
