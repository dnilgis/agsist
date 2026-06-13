#!/usr/bin/env python3
"""
AGSIST — National hail history pipeline.

Pulls NWS Local Storm Reports (hail only) for the last N years from the Iowa
Environmental Mesonet bulk LSR service, reduces each report to a compact
[lat, lon, intensity] triple, and writes one JSON per year plus a manifest.
The Hail Map page (hail-map.html) renders these as a Leaflet.heat heatmap.

Run by .github/workflows/hail-data.yml on a monthly schedule. No API key needed.
Stdlib only — nothing to pip install.

Design notes:
- We request fmt=csv (the format IEM documents) and read columns by header name,
  so the parser self-adapts instead of guessing positions. (geojson returns 422.)
- We NEVER overwrite a good year file with an empty one: a failed fetch keeps the
  existing file, and a fully empty run exits non-zero so the Action won't commit
  emptiness silently (same hard lesson as the cash-bids pipeline).
"""

import csv
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

IEM = "https://mesonet.agron.iastate.edu/cgi-bin/request/gis/lsr.py"
OUT_DIR = "data/hail"
YEARS_BACK = 5
COORD_DP = 2          # ~1 km — plenty for a national heatmap, keeps files small
TIMEOUT = 240         # a full year of national LSRs is a large response
UA = "AGSIST-hail-pipeline/1.0 (sig@farmers1st.com)"


def fetch_year(year):
    """Return CSV rows (list of dicts) of national LSRs for the given year.

    IEM documents two formats for this endpoint: fmt=csv, or omit fmt for a
    zipped shapefile. (geojson is NOT a valid value here — it returns HTTP 422.)
    We use CSV and read columns by name so we adapt to IEM's exact headers.
    """
    sts = "%d-01-01T00:00Z" % year
    ets = "%d-01-01T00:00Z" % (year + 1)
    url = "%s?wfo=ALL&sts=%s&ets=%s&fmt=csv" % (IEM, sts, ets)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        raw = r.read().decode("utf-8", "replace")
    reader = csv.DictReader(io.StringIO(raw))
    if not reader.fieldnames:
        raise ValueError("empty/headerless CSV response")
    # normalize header names: lowercase, strip
    rows = []
    for row in reader:
        rows.append({(k or "").strip().lower(): v for k, v in row.items()})
    return rows


def _get(row, *names):
    for n in names:
        if n in row and row[n] not in (None, ""):
            return row[n]
    return None


def is_hail(row):
    t = str(_get(row, "type", "typecode") or "").upper()
    tt = str(_get(row, "typetext", "type_text") or "").upper()
    return t == "H" or "HAIL" in tt


def mag_of(row):
    v = _get(row, "magnitude", "magf", "mag")
    if v in (None, "", "M"):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def intensity(mag):
    # Hail size (inches) -> heat weight. 3"+ stones = max heat; unknown size = light.
    if mag is None:
        return 0.3
    return max(0.15, min(1.0, mag / 3.0))


def reduce_year(rows):
    pts = []
    for row in rows or []:
        if not is_hail(row):
            continue
        latv = _get(row, "lat", "latitude")
        lonv = _get(row, "lon", "long", "longitude")
        if latv is None or lonv is None:
            continue
        try:
            lat = round(float(latv), COORD_DP)
            lon = round(float(lonv), COORD_DP)
        except (TypeError, ValueError):
            continue
        if not (-180 <= lon <= 180 and -90 <= lat <= 90):
            continue
        pts.append([lat, lon, round(intensity(mag_of(row)), 2)])
    return pts


def existing_count(year):
    path = "%s/%d.json" % (OUT_DIR, year)
    if not os.path.exists(path):
        return None
    try:
        with open(path) as fh:
            return json.load(fh).get("count", 0)
    except (OSError, ValueError):
        return None


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    this_year = datetime.now(timezone.utc).year
    years = list(range(this_year - YEARS_BACK + 1, this_year + 1))
    counts = {}

    for y in years:
        try:
            rows = fetch_year(y)
        except (urllib.error.URLError, TimeoutError, ValueError, OSError) as e:
            print("[%d] fetch failed: %s" % (y, e), file=sys.stderr)
            keep = existing_count(y)
            if keep is not None:
                print("[%d] keeping existing file (%d reports)" % (y, keep), file=sys.stderr)
                counts[str(y)] = keep
            else:
                counts[str(y)] = 0
            continue

        pts = reduce_year(rows)
        # Self-diagnosis: if IEM returned rows but none parsed as hail, the column
        # names differ from what we expect — dump them so the next run reveals the fix.
        if rows and not pts:
            print("[%d] %d rows but 0 hail parsed. Columns seen: %s"
                  % (y, len(rows), ",".join(sorted(rows[0].keys()))), file=sys.stderr)
        # Guard: an empty parse for a year we previously had data for is suspect —
        # keep the older, good file rather than blanking it.
        if not pts and existing_count(y):
            print("[%d] parsed 0 reports but a good file exists — keeping it" % y, file=sys.stderr)
            counts[str(y)] = existing_count(y)
            continue

        counts[str(y)] = len(pts)
        with open("%s/%d.json" % (OUT_DIR, y), "w") as fh:
            json.dump({"year": y, "count": len(pts), "points": pts}, fh, separators=(",", ":"))
        print("[%d] %d hail reports" % (y, len(pts)))
        time.sleep(2)  # be polite to IEM between large requests

    manifest = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "years": years,
        "counts": counts,
    }
    with open("%s/manifest.json" % OUT_DIR, "w") as fh:
        json.dump(manifest, fh, separators=(",", ":"))

    total = sum(counts.values())
    print("done: %d total hail reports across %d years" % (total, len(years)))
    if total == 0:
        # Fully empty run — fail loudly so the Action does not commit emptiness.
        sys.exit(2)


if __name__ == "__main__":
    main()
