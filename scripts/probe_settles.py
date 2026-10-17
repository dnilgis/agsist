#!/usr/bin/env python3
"""probe_settles.py — can the Actions runner read an official CME settle?

Diagnostic only (2026-10-17). Reads, prints, writes nothing, commits nothing.

The site's settles come from Yahoo Finance's daily bar once Yahoo replaces
the last trade with the settle late in the evening (fetch_prices.py v3.7,
RESTATED_BY). That matched the CBOT settle in every case on file, but it is
not the exchange's own copy. CME publishes daily settlements on its site; the
sandbox cannot reach cmegroup.com, and the references fetcher got HTTP 403
from the runner on an education page (refs index: bench-usda-calendar-5). This
asks the settlements endpoints directly and prints what came back, so the
choice to wire one in rests on a real response, not a guess.

For each URL: HTTP status, content type, bytes, and, for JSON, whether a
settlement row for the expected contract month is there with a settle field.
Each result is also a ::notice:: annotation so it reads from the run page.

Run (Actions): workflow_dispatch on probe-settles.yml, input trade_date
MM/DD/YYYY (default: the last weekday).
"""
import json
import os
import sys
import urllib.request
from datetime import date, timedelta

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

# CME product ids as the settlements page URLs use them. Not checked from here
# (the sandbox cannot reach cmegroup.com); a wrong id shows as an empty list.
PRODUCTS = {"corn": 300, "soybeans": 320, "chicago wheat": 323,
            "live cattle": 22, "feeder cattle": 34, "lean hogs": 19}


def last_weekday(d=None):
    d = d or date.today()
    d -= timedelta(days=1)
    while d.weekday() > 4:
        d -= timedelta(days=1)
    return d


def get(url):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA, "Accept": "application/json, text/plain, */*",
        "Referer": "https://www.cmegroup.com/"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.headers.get("Content-Type", ""), r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("Content-Type", "") if e.headers else "", b""
    except Exception as e:                                   # noqa: BLE001
        return None, type(e).__name__ + ": " + str(e)[:120], b""


def summarize(body):
    """What a settlements JSON holds: rows, months, and whether settles are there."""
    try:
        j = json.loads(body.decode("utf-8", "replace"))
    except ValueError:
        return "not JSON"
    rows = j.get("settlements") if isinstance(j, dict) else None
    if not isinstance(rows, list):
        return "JSON without a settlements list: keys " + ",".join(list(j)[:8]) if isinstance(j, dict) else "JSON list"
    with_settle = [r for r in rows if isinstance(r, dict) and str(r.get("settle", "")).strip() not in ("", "-")]
    months = [str(r.get("month")) for r in with_settle[:4]]
    first = with_settle[0] if with_settle else {}
    return (f"{len(rows)} rows, {len(with_settle)} with a settle; first months {months}; "
            f"tradeDate {j.get('tradeDate')}; first row settle {first.get('settle')!r} change {first.get('change')!r}")


def main():
    td = (os.environ.get("TRADE_DATE") or "").strip() or last_weekday().strftime("%m/%d/%Y")
    print(f"probe_settles: trade date {td}")
    urls = []
    for name, pid in PRODUCTS.items():
        urls.append((name, f"https://www.cmegroup.com/CmeWS/mvc/Settlements/Futures/Settlements/{pid}/FUT"
                           f"?strategy=DEFAULT&tradeDate={td}&pageSize=50"))
    urls.append(("settlements page", "https://www.cmegroup.com/markets/agriculture/grains/corn.settlements.html"))
    any_ok = False
    for name, url in urls:
        status, ctype, body = get(url)
        line = f"{name}: HTTP {status} {ctype} {len(body)} bytes"
        if status == 200 and "json" in (ctype or "").lower():
            line += " | " + summarize(body)
            any_ok = any_ok or "with a settle" in line and " 0 with a settle" not in line
        print(line)
        print(f"::notice title=CME settle probe::{line}")
    print("READABLE" if any_ok else "NOT READABLE from this runner")
    return 0


if __name__ == "__main__":
    sys.exit(main())
