#!/usr/bin/env python3
"""
AGSIST — frost/freeze alert pull, for the Wire.

Pulls active frost/freeze alerts from the National Weather Service's public
alerts API (api.weather.gov) and writes a compact data/weather-alerts.json
that scripts/build_news.py's weather() detector reads. No API key needed,
stdlib only.

WHY THIS AND NOT A HAND-WRITTEN THRESHOLD. An earlier project writeup
flagged "frost advisory" as a phrase that only ever appeared as example copy
in a code comment -- never a real data source. NWS already does the
meteorology (what counts as a frost vs. a hard freeze, which counties are
under which watch) and publishes it as a public feed; this reads that feed
rather than inventing a temperature cutoff of our own.

SCOPE. Only the alert types a row-crop or livestock producer would act on:
Frost Advisory, Freeze Watch, Freeze Warning, Hard Freeze Warning. Nationwide
-- AGSIST is a national site and NWS's own event filter already does the
agricultural relevance filtering; no state list to keep in sync here.

ONE ALERT, ONE RECORD. NWS issues one alert per affected zone-group, not one
per county, so a single Midwest freeze warning already reads as one record
covering however many counties it names -- nothing here fans it out further
or merges separate alerts into one.

NEVER OVERWRITE GOOD DATA WITH EMPTY. A network failure or a malformed
response keeps the existing file and exits non-zero so the Action does not
commit a false "no alerts active" over a real one. A genuinely empty response
(the ordinary case most of the year) is written as an empty list -- that is
not a failure, it is the honest state most days.
"""

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "weather-alerts.json")
TIMEOUT = 30
UA = "AGSIST/1.0 (+https://agsist.com/contact; weather-alerts job)"

# The only events this job asks for. Widen this list, never add a temperature
# threshold of our own -- NWS already decides what counts as which of these.
EVENTS = ["Frost Advisory", "Freeze Watch", "Freeze Warning", "Hard Freeze Warning"]

API = "https://api.weather.gov/alerts/active"


def fetch():
    """Return the raw NWS feature list, or raise on any network/format problem
    (the caller decides what to do with a failure; this never swallows one)."""
    qs = "&".join("event=" + urllib.parse.quote(e) for e in EVENTS)
    url = API + "?" + qs
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/geo+json"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        data = json.loads(r.read().decode("utf-8"))
    feats = data.get("features")
    if feats is None:
        raise ValueError("response has no 'features' key -- not the shape this reads")
    return feats


def record(feat):
    """One NWS alert feature -> our compact record, or None if a field this
    detector needs is missing. A detector that cannot find its field writes
    nothing, same rule as every other reader on this site."""
    p = (feat or {}).get("properties") or {}
    event = p.get("event")
    area = p.get("areaDesc")
    aid = p.get("id") or feat.get("id")
    if not (event and area and aid):
        return None
    return {
        "id": aid,
        "event": event,
        "area": area,
        "headline": p.get("headline") or f"{event} for {area}",
        "severity": p.get("severity"),
        "effective": p.get("effective"),
        "expires": p.get("expires") or p.get("ends"),
        # The alert's own NWS page -- not a page of ours, because none exists
        # for this yet. Honest sourcing over a fabricated internal link.
        "url": p.get("@id") or aid,
    }


def main():
    try:
        feats = fetch()
    except (urllib.error.URLError, ValueError, TimeoutError) as e:
        print(f"fetch failed, leaving existing file in place: {e}", file=sys.stderr)
        return 1

    alerts = []
    seen = set()
    for feat in feats:
        rec = record(feat)
        if rec is None or rec["id"] in seen:
            continue
        seen.add(rec["id"])
        alerts.append(rec)
    alerts.sort(key=lambda r: r.get("effective") or "", reverse=True)

    out = {
        "fetched": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "source": "api.weather.gov/alerts/active",
        "events_requested": EVENTS,
        "count": len(alerts),
        "alerts": alerts,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
        f.write("\n")
    print(f"wrote {OUT}: {len(alerts)} active alert(s)")
    return 0


def _selftest():
    ok = 0

    def check(cond, what):
        nonlocal ok
        if not cond:
            print(f"FAIL: {what}", file=sys.stderr)
            sys.exit(1)
        ok += 1

    # Real NWS property names (api.weather.gov/alerts/active), hand-copied
    # from the API's own documented schema -- not guessed.
    feat = {
        "id": "https://api.weather.gov/alerts/urn:oid:2.49.0.1.840.0.abc",
        "properties": {
            "id": "urn:oid:2.49.0.1.840.0.abc",
            "event": "Freeze Warning",
            "areaDesc": "Boone, IA; Story, IA; Marshall, IA",
            "headline": "Freeze Warning issued for central Iowa",
            "severity": "Severe",
            "effective": "2026-10-05T03:00:00-05:00",
            "expires": "2026-10-05T13:00:00-05:00",
            "@id": "https://api.weather.gov/alerts/urn:oid:2.49.0.1.840.0.abc",
        },
    }
    r = record(feat)
    check(r is not None, "a well-formed feature is accepted")
    check(r["event"] == "Freeze Warning", "event comes through unchanged")
    check(r["area"] == "Boone, IA; Story, IA; Marshall, IA", "area is the real NWS zone list, not re-parsed")
    check(r["url"] == "https://api.weather.gov/alerts/urn:oid:2.49.0.1.840.0.abc",
          "links to the real NWS alert page, not a page of ours that doesn't exist")

    check(record({"properties": {"event": "Freeze Warning"}}) is None,
          "missing areaDesc/id writes nothing rather than guessing")
    check(record({}) is None, "an empty feature writes nothing")

    # Dedup: the same alert id appearing twice (NWS sometimes re-sends an
    # update under the same id) must not become two records.
    feats = [feat, dict(feat)]
    seen, out = set(), []
    for f in feats:
        rr = record(f)
        if rr and rr["id"] not in seen:
            seen.add(rr["id"])
            out.append(rr)
    check(len(out) == 1, "the same alert id twice is one record, not two")

    print(f"weather alerts: all {ok} checks passed")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        _selftest()
    else:
        sys.exit(main())
