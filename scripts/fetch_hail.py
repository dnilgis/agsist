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
from datetime import datetime, timedelta, timezone

IEM = "https://mesonet.agron.iastate.edu/cgi-bin/request/gis/lsr.py"
OUT_DIR = "data/hail"
RECENT_PATH = "data/hail/recent.json"   # 2026-10-01 recent path: spelled out so build_feeds.py sees the writer
YEARS_BACK = 5
COORD_DP = 2          # ~1 km — plenty for a national heatmap, keeps files small
TIMEOUT = 240         # a full year of national LSRs is a large response
UA = "AGSIST-hail-pipeline/1.0 (sig@farmers1st.com)"
RECENT_DAYS = 30      # rolling window for the "recent hail" events layer


def fetch_year(year):
    """Return CSV rows (list of dicts) of national LSRs for the given year.

    IEM documents two formats for this endpoint: fmt=csv, or omit fmt for a
    zipped shapefile. (geojson is NOT a valid value here — it returns HTTP 422.)
    We use CSV and read columns by name so we adapt to IEM's exact headers.
    """
    # Storm days that START in `year`: Jan 1 12Z through Jan 1 12Z of the next
    # year, so Dec 31's evening storms stay in this year's file.
    sts = "%d-01-01T%02d:00Z" % (year, DAY_START_UTC_HOUR)
    ets = "%d-01-01T%02d:00Z" % (year + 1, DAY_START_UTC_HOUR)
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
        m = float(v)
    except (TypeError, ValueError):
        return None
    # The US record stone is 8.0 in (Vivian, SD, 2010). A bigger "hail size" is
    # a mis-filed report (a 65.0 in Goodlett, TX entry was a wind gust in mph),
    # so it counts as size unknown, not as a giant stone.
    return m if 0 < m <= MAX_HAIL_IN else None


MAX_HAIL_IN = 8.0


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


def events_year(rows, year):
    """Compact dated/sized events for the point-lookup: [[lat,lon,mag,"MM-DD"],...].
    mag is inches or null (unmeasured). Year lives in the filename, month-day in
    the row — keeps a 15k-report year around ~400 KB raw (~90 KB over the wire).
    This is what makes the map's address lookup and Field Scout's hail history
    fully static — no live upstream query, no worker, no way to silently 404."""
    ev = []
    for row in rows or []:
        if not is_hail(row):
            continue
        latv = _get(row, "lat", "latitude")
        lonv = _get(row, "lon", "long", "longitude")
        d = _date_of(row)
        if latv is None or lonv is None or not d or not d.startswith(str(year)):
            continue
        try:
            lat = round(float(latv), COORD_DP)
            lon = round(float(lonv), COORD_DP)
        except (TypeError, ValueError):
            continue
        if not (-180 <= lon <= 180 and -90 <= lat <= 90):
            continue
        m = mag_of(row)
        st = (_get(row, "st", "state") or "").strip().upper()[:2]
        ev.append([lat, lon, (round(m, 2) if m is not None else None), d[5:], st])
    return ev


# Storm day: the Storm Prediction Center's convective day, 12:00 UTC to
# 12:00 UTC, labeled by the date it starts (7 a.m. to 7 a.m. Central daylight
# time). IEM's "valid" and "valid2" are UTC. Grouping by the UTC calendar date
# (what this did until 2026-10-17) put every evening storm in the central and
# mountain zones on the NEXT day's page: the 3.00 inch Coleman County, Texas
# stone of 8:01 pm CDT May 21, 2024 (01:01 UTC May 22) showed on May 22.
DAY_RULE = "spc-12z"
DAY_START_UTC_HOUR = 12


def _valid_utc(row):
    """The report time as an aware UTC datetime, or None when it cannot be read."""
    v = (_get(row, "valid") or "").strip()
    if len(v) >= 12 and v[:12].isdigit():
        try:
            return datetime.strptime(v[:12], "%Y%m%d%H%M").replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    # valid2 is year-first with SLASHES ("2026/01/03 18:22"), also UTC
    v2 = (_get(row, "valid2", "valid_2") or "").strip().replace("/", "-").replace("T", " ")
    if len(v2) >= 16:
        try:
            return datetime.strptime(v2[:16], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    return None


def storm_day(t_utc):
    """YYYY-MM-DD of the SPC convective day (12Z to 12Z) holding UTC time t_utc."""
    return (t_utc - timedelta(hours=DAY_START_UTC_HOUR)).strftime("%Y-%m-%d")


def _date_of(row):
    # Storm day as YYYY-MM-DD with dashes, so every consumer (lookup, Field
    # Scout, hail-vigor correlation, the storm-day pages) compares dates
    # safely. A report with no readable time gets None: a bare date cannot be
    # placed in a 12Z-to-12Z day, and guessing would move it a day.
    t = _valid_utc(row)
    return storm_day(t) if t else None


def fetch_recent():
    """Last RECENT_DAYS of national hail, with date/size/place kept for markers."""
    now = datetime.now(timezone.utc)
    sts = (now - timedelta(days=RECENT_DAYS)).strftime("%Y-%m-%dT00:00Z")
    ets = now.strftime("%Y-%m-%dT%H:%MZ")
    url = "%s?wfo=ALL&sts=%s&ets=%s&fmt=csv" % (IEM, sts, ets)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        raw = r.read().decode("utf-8", "replace")
    reader = csv.DictReader(io.StringIO(raw))
    rows = [{(k or "").strip().lower(): v for k, v in row.items()} for row in reader]
    return rows


def reduce_recent(rows):
    out = []
    for row in rows or []:
        if not is_hail(row):
            continue
        latv = _get(row, "lat", "latitude")
        lonv = _get(row, "lon", "long", "longitude")
        if latv is None or lonv is None:
            continue
        try:
            lat = round(float(latv), 3)
            lon = round(float(lonv), 3)
        except (TypeError, ValueError):
            continue
        if not (-180 <= lon <= 180 and -90 <= lat <= 90):
            continue
        mag = mag_of(row)
        out.append({
            "lat": lat, "lon": lon,
            "mag": round(mag, 2) if mag is not None else None,
            "date": _date_of(row),
            "city": (_get(row, "city") or "").strip()[:40],
            "st": (_get(row, "state", "st") or "").strip()[:2].upper(),
        })
    # newest first so the map can show "latest" naturally
    out.sort(key=lambda r: (r["date"] or ""), reverse=True)
    return out


# hail >= this (inches) counts as damaging. 1 inch is the NWS severe-hail size,
# and the one line the whole site uses (Farmland Atlas 1-inch days, storm-day
# pages, state pages). Was 1.5 until 2026-10.
DAMAGING_IN = 1.0
_MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
           "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _month_of(row):
    d = _date_of(row)
    if d:
        m = int(d[5:7])
        if 1 <= m <= 12:
            return m
    return None


def tally_counties(rows, acc):
    """Fold one year's hail rows into the cross-year county accumulator `acc`.

    acc[(ST, COUNTY)] = {"total":int, "dmg":int, "months":[13 ints]}.
    Rows with no county (~1% IEM can't match to a boundary) are skipped.
    """
    for row in rows or []:
        if not is_hail(row):
            continue
        st = (_get(row, "state", "st") or "").strip().upper()[:2]
        county = (_get(row, "county") or "").strip()
        if not st or not county:
            continue
        key = (st, county)
        rec = acc.get(key)
        if rec is None:
            rec = {"total": 0, "dmg": 0, "months": [0] * 13}
            acc[key] = rec
        rec["total"] += 1
        mag = mag_of(row)
        if mag is not None and mag >= DAMAGING_IN:
            rec["dmg"] += 1
        mo = _month_of(row)
        if mo:
            rec["months"][mo] += 1


def elapsed_years(years, end_iso):
    """The span the record actually covers: Jan 1 of the first year to the
    pull date, in years. Five year files pulled on Oct 1 of the fifth year are
    4.75 years, not 5. Same rule as yrSpan() in hail-map.html."""
    try:
        start = datetime(int(years[0]), 1, 1, 12, tzinfo=timezone.utc)
        end = datetime.strptime(str(end_iso)[:10], "%Y-%m-%d").replace(hour=12, tzinfo=timezone.utc)
        y = (end - start).total_seconds() / (365.2425 * 86400)
        return y if y > 0.5 else max(1, len(years))
    except (ValueError, IndexError, TypeError):
        return max(1, len(years))


# The 50 states, DC and the territories the NWS reports for. Anything else in
# the state column is a malformed row (2026-10: "IT" with county "MS", "PL"
# with county "Ka") and is dropped rather than shown as a state.
VALID_ST = set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY "
               "NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR VI GU AS MP".split())


def finalize_counties(acc, years, per_state=12, end_iso=None):
    """Turn the accumulator into {ST: [ranked county rows]} for the page."""
    n_years = elapsed_years(years, end_iso or datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    by_state = {}
    for (st, county), rec in acc.items():
        if st not in VALID_ST:
            continue
        peak_i = 0
        for i in range(1, 13):
            if rec["months"][i] > rec["months"][peak_i]:
                peak_i = i
        row = {
            "county": county,
            "total": rec["total"],
            "avg": round(rec["total"] / n_years, 1),
            "peak": _MONTHS[peak_i] if peak_i else "\u2014",
            "dmg_pct": round(100.0 * rec["dmg"] / rec["total"]) if rec["total"] else 0,
        }
        by_state.setdefault(st, []).append(row)
    for st in by_state:
        by_state[st].sort(key=lambda r: r["total"], reverse=True)
        by_state[st] = by_state[st][:per_state]
    return by_state


def state_totals(events_by_year, years):
    """True statewide totals, not the top-12 county subtotal the ranked table
    carries. Read from the dated events files ([lat, lon, mag, "MM-DD", ST]),
    so a year whose fetch failed still counts from the file it kept.
    {ST: {"total": n, "dmg": n at DAMAGING_IN or larger, "months": [12 ints, Jan..Dec]}}"""
    out = {}
    for y in years:
        for e in events_by_year.get(y) or []:
            if len(e) < 5:
                continue
            st = str(e[4] or "").upper()
            if st not in VALID_ST:
                continue
            rec = out.setdefault(st, {"total": 0, "dmg": 0, "months": [0] * 12})
            rec["total"] += 1
            m = e[2]
            if isinstance(m, (int, float)) and DAMAGING_IN <= m <= MAX_HAIL_IN:
                rec["dmg"] += 1
            try:
                mo = int(str(e[3])[:2])
            except ValueError:
                mo = 0
            if 1 <= mo <= 12:
                rec["months"][mo - 1] += 1
    return out


def load_events(years):
    ev = {}
    for y in years:
        try:
            with open("%s/events-%d.json" % (OUT_DIR, y)) as fh:
                ev[y] = json.load(fh).get("ev") or []
        except (OSError, ValueError):
            ev[y] = []
    return ev


def existing_count(year):
    path = "%s/%d.json" % (OUT_DIR, year)
    if not os.path.exists(path):
        return None
    try:
        with open(path) as fh:
            return json.load(fh).get("count", 0)
    except (OSError, ValueError):
        return None


def refresh_recent_only():
    """Daily mode (--recent): refresh ONLY recent.json and the manifest's
    recent_* fields. The yearly files, counties, and events are monthly work;
    the last-30-days layer is what roofers, adjusters, and farmers check the
    morning after a storm — it must not sit up to a month stale. The
    manifest's top-level 'generated' (the yearly-data vintage the site quotes
    as "data through") is deliberately NOT touched here: a fresh recent
    layer must not make the 5-year archive claim a freshness it lacks."""
    os.makedirs(OUT_DIR, exist_ok=True)
    recent = reduce_recent(fetch_recent())   # let failures raise → nonzero exit, no commit
    with open(RECENT_PATH, "w") as fh:
        json.dump({
            "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "days": RECENT_DAYS, "day_rule": DAY_RULE, "count": len(recent), "reports": recent,
        }, fh, separators=(",", ":"))
    mpath = "%s/manifest.json" % OUT_DIR
    try:
        with open(mpath) as fh:
            manifest = json.load(fh)
    except (OSError, ValueError):
        manifest = {}
    manifest["recent_days"] = RECENT_DAYS
    manifest["recent_day_rule"] = DAY_RULE
    manifest["recent_count"] = len(recent)
    manifest["recent_generated"] = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    with open(mpath, "w") as fh:
        json.dump(manifest, fh, separators=(",", ":"))
    print("[recent-only] %d hail reports in the last %d days" % (len(recent), RECENT_DAYS))


def main():
    if "--recent" in sys.argv:
        refresh_recent_only()
        return
    os.makedirs(OUT_DIR, exist_ok=True)
    this_year = datetime.now(timezone.utc).year
    years = list(range(this_year - YEARS_BACK + 1, this_year + 1))
    counts = {}
    # Which day rule each year's events file was built with. A year whose
    # fetch fails keeps its old file, so it keeps its old rule too (absent =
    # the old UTC calendar day); the storm-day pages print the rule per file.
    try:
        with open("%s/manifest.json" % OUT_DIR) as fh:
            old_rules = json.load(fh).get("day_rules") or {}
    except (OSError, ValueError):
        old_rules = {}
    day_rules = {}
    cty_acc = {}          # cross-year county accumulator
    cty_years = []        # years that actually contributed to the tally

    for y in years:
        try:
            rows = fetch_year(y)
        except (urllib.error.URLError, TimeoutError, ValueError, OSError) as e:
            print("[%d] fetch failed: %s" % (y, e), file=sys.stderr)
            keep = existing_count(y)
            if keep is not None:
                print("[%d] keeping existing file (%d reports)" % (y, keep), file=sys.stderr)
                counts[str(y)] = keep
                if old_rules.get(str(y)):
                    day_rules[str(y)] = old_rules[str(y)]
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
            if old_rules.get(str(y)):
                day_rules[str(y)] = old_rules[str(y)]
            continue

        tally_counties(rows, cty_acc)
        cty_years.append(y)
        counts[str(y)] = len(pts)
        day_rules[str(y)] = DAY_RULE
        with open("%s/%d.json" % (OUT_DIR, y), "w") as fh:
            json.dump({"year": y, "count": len(pts), "points": pts}, fh, separators=(",", ":"))
        ev = events_year(rows, y)
        with open("%s/events-%d.json" % (OUT_DIR, y), "w") as fh:
            json.dump({"year": y, "n": len(ev), "ev": ev}, fh, separators=(",", ":"))
        print("[%d] %d hail reports (%d dated events)" % (y, len(pts), len(ev)))
        time.sleep(2)  # be polite to IEM between large requests

    # ── County rankings per state (only rewrite if we got fresh rows) ──
    if cty_acc:
        by_state = finalize_counties(cty_acc, cty_years)
        with open("%s/state-counties.json" % OUT_DIR, "w") as fh:
            json.dump({
                "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                "years": cty_years,
                "damaging_in": DAMAGING_IN,
                "states": by_state,
                # Every report in the state, not just the 12 ranked counties.
                "state_totals": state_totals(load_events(cty_years), cty_years),
            }, fh, separators=(",", ":"))
        print("[counties] ranked counties for %d states" % len(by_state))
    else:
        print("[counties] no fresh rows — keeping existing state-counties.json", file=sys.stderr)

    # ── Recent hail events (last 30 days) for the markers layer ──
    # The daily --recent mode (above) stamps the manifest with
    # "recent_generated", and status.html reads that key as the feed's
    # timestamp. This monthly full rebuild rewrote the manifest WITHOUT it,
    # so on the 1st of every month the key vanished until the next daily run
    # put it back -- and scripts/test_feeds.py went red for the day
    # (2026-10-01: 'data/hail/manifest.json has no "recent_generated"').
    # Same stamp here, and if the recent fetch fails keep the old one rather
    # than claim a refresh that did not happen.
    recent_count = None
    recent_generated = None
    recent_rule = None
    try:
        with open("%s/manifest.json" % OUT_DIR) as fh:
            _old = json.load(fh)
            recent_generated = _old.get("recent_generated")
            recent_rule = _old.get("recent_day_rule")
    except (OSError, ValueError):
        pass
    try:
        recent = reduce_recent(fetch_recent())
        with open(RECENT_PATH, "w") as fh:
            json.dump({
                "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                "days": RECENT_DAYS, "day_rule": DAY_RULE, "count": len(recent), "reports": recent,
            }, fh, separators=(",", ":"))
        recent_count = len(recent)
        recent_generated = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        print("[recent] %d hail reports in the last %d days" % (recent_count, RECENT_DAYS))
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as e:
        print("[recent] fetch failed: %s (keeping any existing recent.json)" % e, file=sys.stderr)

    manifest = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "years": years,
        "counts": counts,
        "recent_days": RECENT_DAYS,
        "day_rules": day_rules,
        "recent_day_rule": DAY_RULE if recent_count is not None else recent_rule,
        "recent_count": recent_count,
        "recent_generated": recent_generated,
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
