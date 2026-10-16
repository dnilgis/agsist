#!/usr/bin/env python3
"""
AGSIST -- data/fall-nitrogen.json: measured 4 in soil temperature for /fall-nitrogen.

Fall anhydrous guidance from Iowa State, Nebraska and K-State: wait until soil
at 4 in stays below 50 F and is trending cooler. This file holds the station
readings the page needs to say where each county stands: the station list,
the last 10 daily readings at each, and the nearest station (within 50 miles)
for every county in the fall nitrogen states. Stdlib only.

Networks (each read on its own; one failing never blocks the others):
  uscrn   NOAA US Climate Reference Network, daily01 files, SOIL_TEMP_10_DAILY
          (10 cm, 3.9 in, daily mean, Celsius). The column is found by name
          in the published HEADERS.txt, never by position alone.
  scan    USDA NRCS Soil Climate Analysis Network through the AWDB REST API,
          element STO at -4 in (daily, degF).
  isusm   Iowa State Soil Moisture Network through the Iowa Environmental
          Mesonet daily download (4 in soil temperature).
  ksmeso  Kansas Mesonet REST service (10 cm soil temperature, daily).
The sandbox cannot reach any of these hosts. GitHub runners can.

Modes:
  (default)   fetch every network, check, write data/fall-nitrogen.json and
              stamp the state summary into fall-nitrogen.html. A network that
              fails its checks is left out (its last good stations carry over
              until they age out). If fewer than MIN_STATIONS stations pass,
              NOTHING is written and the exit code is 1.
  --probe     fetch station lists, docs and a sample of data from every
              network, save them trimmed to data/fall-nitrogen-raw/ with a
              summary of what would parse. Writes no feed.
  --selftest  offline tests, non-zero exit on any failure.
  --stamp     re-stamp fall-nitrogen.html from the data file on disk.

WHAT THIS FILE WILL NOT DO
  * Write a reading whose unit it cannot name (Celsius or Fahrenheit from the
    source's own header, column name or element metadata).
  * Write a reading outside -10 to 100 F, or a station whose reading jumps
    more than 18 F from one day to the next (a sensor fault, not weather).
  * Write a station whose newest reading is more than MAX_AGE_DAYS old, or
    one with fewer than 5 of its last 7 days.
  * Write a reading dated after today.
  * Fill a county from a model or from a station farther than 50 miles.
  * Call any reading "go". The page says where the soil is; the farmer decides.
"""
import datetime
import html
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = "data/fall-nitrogen.json"
RAW_DIR = "data/fall-nitrogen-raw"
PAGE = "fall-nitrogen.html"
COUNTIES = "data/atlas/counties.geo.json"
UA = "AGSIST/1.0 (+https://agsist.com)"

# The fall nitrogen states: where extension programs give fall anhydrous
# timing advice. Stations are read in these states only.
STATES = ["IA", "IL", "IN", "KS", "MI", "MN", "MO", "ND", "NE", "OH", "SD", "WI"]
NAMES = {"IA": "Iowa", "IL": "Illinois", "IN": "Indiana", "KS": "Kansas", "MI": "Michigan",
         "MN": "Minnesota", "MO": "Missouri", "ND": "North Dakota", "NE": "Nebraska",
         "OH": "Ohio", "SD": "South Dakota", "WI": "Wisconsin"}
DAYS = 10                 # daily readings kept per station
MAX_AGE_DAYS = 3          # newest reading older than this: station left out
MIN_STATIONS = 8          # fewer than this pass: write nothing
MAX_MI = 50               # county to station
RANGE_F = (-10.0, 100.0)
JUMP_F = 18.0

USCRN = "https://www.ncei.noaa.gov/pub/data/uscrn/products/daily01/"
AWDB = "https://wcc.sc.egov.usda.gov/awdbRestApi/services/v1/"
IEM = "https://mesonet.agron.iastate.edu/"
KSM = "https://mesonet.k-state.edu/rest/"


class Refuse(Exception):
    """A check failed."""


# ---------------------------------------------------------------- small helpers
def c_to_f(c):
    return c * 9.0 / 5.0 + 32.0


def num(s):
    try:
        v = float(str(s).strip())
    except (TypeError, ValueError):
        return None
    if not math.isfinite(v) or v <= -999:      # -9999 is "missing" in USCRN; anything that low is not a reading
        return None
    return v


def to_f(v, unit):
    if v is None:
        return None
    u = str(unit or "").strip().lower()
    if u in ("c", "celsius", "degc", "deg c", "°c"):
        return c_to_f(v)
    if u in ("f", "fahrenheit", "degf", "deg f", "°f"):
        return v
    raise Refuse("unknown unit %r" % unit)


def iso(d):
    return d.isoformat()


def day(s):
    s = str(s).strip()
    m = re.match(r"^(\d{4})-?(\d{2})-?(\d{2})", s)
    if not m:
        return None
    try:
        return datetime.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None


def when(s):
    """'YYYY-MM-DD HH:MM[:SS]' (or with a T) -> datetime, else None."""
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})", str(s).strip())
    if not m:
        return None
    try:
        return datetime.datetime(*(int(x) for x in m.groups()))
    except ValueError:
        return None


MIN_HOURS = 20            # hourly readings a day needs before its mean counts


def hourly_means(points):
    """[(datetime, degF)] -> {date: mean degF} for days with MIN_HOURS or more
    readings. A reading stamped on the hour closes the hour before it (the
    logger convention), so 00:00 belongs to the day that just ended. A day
    still in progress never has enough hours to count."""
    by = {}
    for t, v in points:
        if t is None or v is None:
            continue
        d = (t - datetime.timedelta(minutes=30)).date()
        by.setdefault(d, []).append(v)
    return {d: sum(vs) / len(vs) for d, vs in by.items() if len(vs) >= MIN_HOURS}


def miles(lat1, lon1, lat2, lon2):
    r = 3958.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def in_states(lat, lon):
    """Loose box around the fall nitrogen states (station coordinates sanity)."""
    return 35.5 <= lat <= 49.5 and -105.0 <= lon <= -80.0


# ---------------------------------------------------------------- the station check
def series(readings, today):
    """{date: degF} -> (last_date, [DAYS values ending at last_date]) or raise Refuse."""
    pts = {d: v for d, v in readings.items() if d is not None and v is not None}
    if not pts:
        raise Refuse("no readings")
    future = [d for d in pts if d > today]
    if future:
        raise Refuse("reading dated %s is after today" % max(future))
    last = max(pts)
    if (today - last).days > MAX_AGE_DAYS:
        raise Refuse("newest reading %s is more than %d days old" % (last, MAX_AGE_DAYS))
    vals = []
    for i in range(DAYS - 1, -1, -1):
        v = pts.get(last - datetime.timedelta(days=i))
        if v is not None and not (RANGE_F[0] <= v <= RANGE_F[1]):
            raise Refuse("%.1f F on %s is outside %s" % (v, last - datetime.timedelta(days=i), RANGE_F))
        vals.append(None if v is None else round(v, 1))
    if sum(1 for v in vals[-7:] if v is not None) < 5:
        raise Refuse("fewer than 5 of the last 7 days")
    prev = None
    for v in vals:
        if v is not None and prev is not None and abs(v - prev) > JUMP_F:
            raise Refuse("day-to-day jump of %.1f F" % abs(v - prev))
        if v is not None:
            prev = v
    return last, vals


def station(net, sid, name, st, lat, lon, depth, stat, readings, today):
    lat, lon = num(lat), num(lon)
    if lat is None or lon is None or not in_states(lat, lon):
        raise Refuse("coordinates %r, %r outside the fall nitrogen states" % (lat, lon))
    last, vals = series(readings, today)
    return {"id": "%s:%s" % (net, sid), "net": net, "name": name.strip(), "st": st,
            "lat": round(lat, 4), "lon": round(lon, 4), "depth": depth, "stat": stat,
            "last": iso(last), "t": vals}


# ---------------------------------------------------------------- HTTP
def get(url, tries=3, sleep=time.sleep, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            try:
                body = e.read().decode("utf-8", "replace")[:400]
            except Exception:  # noqa: BLE001
                body = ""
            last = "HTTP %s %s" % (e.code, " ".join(body.split()))
            if e.code in (400, 404, 422):
                break
        except Exception as e:  # noqa: BLE001
            last = "%s: %s" % (type(e).__name__, e)
        if i < tries - 1:
            sleep(3 * (i + 1))
    raise Refuse("%s failed: %s" % (url, last))


# ---------------------------------------------------------------- USCRN
def uscrn_columns(headers_txt):
    """HEADERS.txt: line 1 field numbers, line 2 names, line 3 units."""
    lines = [ln.split() for ln in headers_txt.splitlines() if ln.strip()]
    if len(lines) < 3:
        raise Refuse("USCRN HEADERS.txt has fewer than 3 lines")
    names, units = lines[1], lines[2]
    need = ["WBANNO", "LST_DATE", "LONGITUDE", "LATITUDE", "SOIL_TEMP_10_DAILY"]
    col = {}
    for n in need:
        if n not in names:
            raise Refuse("USCRN HEADERS.txt has no %s" % n)
        col[n] = names.index(n)
    if len(units) != len(names):
        raise Refuse("USCRN HEADERS.txt units line does not match names")
    unit = units[col["SOIL_TEMP_10_DAILY"]]
    if unit.lower() != "celsius":
        raise Refuse("USCRN SOIL_TEMP_10_DAILY unit is %r, not Celsius" % unit)
    col["_n"] = len(names)
    return col


def uscrn_files(index_html, year):
    out = {}
    for m in re.finditer(r'href="(CRND0103-%d-([A-Z]{2})_([A-Za-z0-9_.\-]+?)\.txt)"' % year, index_html):
        if m.group(2) in STATES:
            out[m.group(1)] = (m.group(2), m.group(3).replace("_", " "))
    return out


def uscrn_parse(text, col):
    rows, lat, lon, wban = {}, None, None, None
    for ln in text.splitlines():
        p = ln.split()
        if len(p) != col["_n"]:
            continue
        d = day(p[col["LST_DATE"]])
        rows[d] = to_f(num(p[col["SOIL_TEMP_10_DAILY"]]), "C")
        lat, lon, wban = p[col["LATITUDE"]], p[col["LONGITUDE"]], p[col["WBANNO"]]
    return wban, lat, lon, rows


def fetch_uscrn(today, log):
    col = uscrn_columns(get(USCRN + "HEADERS.txt"))
    years = [today.year] + ([today.year - 1] if today.timetuple().tm_yday <= DAYS + 2 else [])
    files = {}
    for y in years:
        for fn, meta in uscrn_files(get(USCRN + "%d/" % y), y).items():
            files.setdefault(meta, []).append((y, fn))
    if not files:
        raise Refuse("USCRN index lists no files for the fall nitrogen states")
    out = []
    for (st, name), fl in sorted(files.items()):
        rows, lat, lon, wban = {}, None, None, None
        for y, fn in sorted(fl):
            w, la, lo, r = uscrn_parse(get(USCRN + "%d/%s" % (y, fn)), col)
            rows.update(r)
            lat, lon, wban = la or lat, lo or lon, w or wban
        try:
            out.append(station("USCRN", wban or name, name + ", " + st, st, lat, lon,
                               "10 cm (3.9 in)", "daily mean", rows, today))
        except Refuse as e:
            log("  uscrn %s %s: left out (%s)" % (st, name, e))
    return out


# ---------------------------------------------------------------- NRCS SCAN (AWDB)
def scan_station_list(doc):
    out = {}
    for s in doc if isinstance(doc, list) else []:
        trip = str(s.get("stationTriplet", ""))
        parts = trip.split(":")
        if len(parts) != 3 or parts[2] != "SCAN" or parts[1] not in STATES:
            continue
        out[trip] = {"name": str(s.get("name", parts[0])), "st": parts[1],
                     "lat": s.get("latitude"), "lon": s.get("longitude")}
    return out


def scan_parse(doc):
    """AWDB /data response, HOURLY -> {triplet: {date: daily mean degF}}.
    Each element block must say STO, depth -4, HOURLY and a degF or degC
    unit, or it is refused. AWDB's own DAILY STO value is not used: its
    response does not say whether it is a mean or a single reading."""
    out = {}
    for s in doc if isinstance(doc, list) else []:
        trip = str(s.get("stationTriplet", ""))
        for blk in s.get("data") or []:
            el = blk.get("stationElement") or {}
            if str(el.get("elementCode")) != "STO":
                continue
            depth = num(el.get("heightDepth"))
            if depth is None or int(depth) != -4:
                continue
            unit = str(el.get("storedUnitCode") or el.get("originalUnitCode") or "")
            if unit.lower() not in ("degf", "degc"):
                raise Refuse("SCAN %s STO unit %r" % (trip, unit))
            dur = str(el.get("durationName") or "").upper()
            if dur != "HOURLY":
                raise Refuse("SCAN %s STO duration %r, expected HOURLY" % (trip, dur))
            pts = [(when(v.get("date")), to_f(num(v.get("value")), unit[-1])) for v in blk.get("values") or []]
            out[trip] = hourly_means(pts)
    return out


def scan_url(trips, begin, today):
    q = {"stationTriplets": ",".join(trips), "elements": "STO:-4:1", "duration": "HOURLY",
         "beginDate": iso(begin) + " 00:00", "endDate": iso(today + datetime.timedelta(days=1)) + " 00:00",
         "returnFlags": "false"}
    return AWDB + "data?" + urllib.parse.urlencode(q)


def fetch_scan(today, log):
    q = {"stationTriplets": ",".join("*:%s:SCAN" % s for s in STATES), "activeOnly": "true",
         "returnStationElements": "false"}
    meta = scan_station_list(json.loads(get(AWDB + "stations?" + urllib.parse.urlencode(q))))
    if not meta:
        raise Refuse("AWDB lists no SCAN stations in the fall nitrogen states")
    begin = today - datetime.timedelta(days=DAYS + 2)
    data, trips = {}, sorted(meta)
    for i in range(0, len(trips), 8):
        data.update(scan_parse(json.loads(get(scan_url(trips[i:i + 8], begin, today)))))
    out = []
    for trip, m in sorted(meta.items()):
        try:
            out.append(station("SCAN", trip.split(":")[0], m["name"].title() + ", " + m["st"], m["st"],
                               m["lat"], m["lon"], "4 in", "daily mean of hourly readings", data.get(trip, {}), today))
        except Refuse as e:
            log("  scan %s: left out (%s)" % (trip, e))
    return out


# ---------------------------------------------------------------- ISU Soil Moisture Network (IEM)
# Known names for the 4 in daily mean, with their unit. Any other column is ignored.
ISUSM_COLS = {"t4_c_avg_qc": "C", "t4_c_avg": "C", "soil04t_avg": "F", "soil04t": "F", "soil04t_f": "F",
              "tsoil_4in_f": "F", "soil04tavg": "F"}


def isusm_station_list(doc):
    out = {}
    for f in (doc or {}).get("features") or []:
        p = f.get("properties") or {}
        sid = str(p.get("sid") or f.get("id") or "")
        g = (f.get("geometry") or {}).get("coordinates") or [None, None]
        if sid and p.get("online", True) is not False and not p.get("archive_end"):
            out[sid] = {"name": str(p.get("sname") or sid), "lat": g[1], "lon": g[0],
                        "st": str(p.get("state") or "IA")}
    return out


def isusm_parse(csv_text):
    """CSV with a station column, a date column and one known 4 in column."""
    lines = [ln for ln in csv_text.splitlines() if ln.strip() and not ln.startswith("#")]
    if not lines:
        raise Refuse("ISUSM CSV is empty")
    head = [h.strip().lower() for h in lines[0].split(",")]
    col = next((c for c in ISUSM_COLS if c in head), None)
    if col is None:
        raise Refuse("ISUSM CSV has no known 4 in column (got %s)" % ",".join(head[:20]))
    si = next((head.index(c) for c in ("station", "sid", "id") if c in head), None)
    di = next((head.index(c) for c in ("valid", "date", "day") if c in head), None)
    if si is None or di is None:
        raise Refuse("ISUSM CSV has no station or date column")
    ci, out = head.index(col), {}
    for ln in lines[1:]:
        p = ln.split(",")
        if len(p) != len(head):
            continue
        out.setdefault(p[si].strip(), {})[day(p[di])] = to_f(num(p[ci]), ISUSM_COLS[col])
    return out


def isusm_urls(sids, today):
    """The IEM daily download, in the forms it may accept. The first run's
    sts=YYYY-MM-DD drew HTTP 422 (the service wants a time zone on sts/ets).
    Each form is tried in turn; the first one that returns a CSV with a known
    4 in column is used."""
    begin = today - datetime.timedelta(days=DAYS + 2)
    end = today + datetime.timedelta(days=1)
    base = [("mode", "daily"), ("format", "comma"), ("todisk", "no")] + [("station", s) for s in sids]
    forms = [
        [("sts", iso(begin) + "T00:00Z"), ("ets", iso(end) + "T00:00Z"), ("vars", "soil04t")],
        [("year1", begin.year), ("month1", begin.month), ("day1", begin.day),
         ("year2", end.year), ("month2", end.month), ("day2", end.day), ("vars", "soil04t")],
        [("sts", iso(begin) + "T00:00Z"), ("ets", iso(end) + "T00:00Z")],
    ]
    return [IEM + "cgi-bin/request/isusm.py?" + urllib.parse.urlencode(base + f) for f in forms]


def isusm_fetch(sids, today, log):
    errs = []
    for u in isusm_urls(sids, today):
        try:
            return isusm_parse(get(u))
        except Refuse as e:
            errs.append(str(e)[-300:])
            log("  isusm: %s" % errs[-1])
    raise Refuse("no ISUSM request form worked: " + " | ".join(errs))


def fetch_isusm(today, log):
    meta = isusm_station_list(json.loads(get(IEM + "geojson/network/ISUSM.geojson")))
    if not meta:
        raise Refuse("IEM lists no ISUSM stations")
    data = isusm_fetch(sorted(meta), today, log)
    out = []
    for sid, m in sorted(meta.items()):
        try:
            out.append(station("ISUSM", sid, m["name"] + ", IA", "IA", m["lat"], m["lon"],
                               "4 in", "daily mean", data.get(sid, {}), today))
        except Refuse as e:
            log("  isusm %s: left out (%s)" % (sid, e))
    return out


# ---------------------------------------------------------------- Kansas Mesonet
def ksm_station_list(csv_text):
    lines = [ln for ln in csv_text.splitlines() if ln.strip()]
    if not lines:
        raise Refuse("Kansas Mesonet station list is empty")
    head = [h.strip().upper() for h in lines[0].split(",")]
    try:
        ni, la, lo = head.index("NAME"), head.index("LATITUDE"), head.index("LONGITUDE")
    except ValueError:
        raise Refuse("Kansas Mesonet station list has no NAME/LATITUDE/LONGITUDE (got %s)" % ",".join(head))
    out = {}
    for ln in lines[1:]:
        p = [x.strip() for x in ln.split(",")]
        if len(p) == len(head) and p[ni]:
            out[p[ni]] = {"name": p[ni], "lat": p[la], "lon": p[lo]}
    return out


def ksm_parse(csv_text):
    """Hourly stationdata CSV -> {station: {date: daily mean degF}}. Needs
    TIMESTAMP, STATION and a 10 cm average column (Celsius, per /rest/variables/:
    SOILTMP10AVG from the thermistor first, else SOILTMP10AVG655 from the CS655
    probe). Hourly, not the service's daily rows: a daily row stamped 00:00
    does not say which day it covers."""
    lines = [ln for ln in csv_text.splitlines() if ln.strip()]
    if not lines:
        return {}
    head = [h.strip().upper() for h in lines[0].split(",")]
    cols = [head.index(h) for h in ("SOILTMP10AVG", "SOILTMP10AVG655") if h in head]
    if not cols:
        raise Refuse("Kansas Mesonet data has no SOILTMP10AVG column (got %s)" % ",".join(head))
    if "TIMESTAMP" not in head or "STATION" not in head:
        raise Refuse("Kansas Mesonet data has no TIMESTAMP or STATION")
    ti, si, pts = head.index("TIMESTAMP"), head.index("STATION"), {}
    for ln in lines[1:]:
        p = [x.strip() for x in ln.split(",")]
        if len(p) != len(head):
            continue
        v = next((num(p[c]) for c in cols if num(p[c]) is not None), None)
        pts.setdefault(p[si], []).append((when(p[ti]), to_f(v, "C")))
    return {s: hourly_means(v) for s, v in pts.items()}


def ksm_url(names, today):
    begin = today - datetime.timedelta(days=DAYS + 2)
    q = {"stn": ",".join(names), "int": "hour", "t_start": begin.strftime("%Y%m%d000000"),
         "t_end": (today + datetime.timedelta(days=1)).strftime("%Y%m%d000000"),
         "vars": "SOILTMP10AVG,SOILTMP10AVG655"}
    return KSM + "stationdata/?" + urllib.parse.urlencode(q)


def fetch_ksmeso(today, log):
    meta = ksm_station_list(get(KSM + "stationnames/"))
    data = {}
    names = sorted(meta)
    for i in range(0, len(names), 10):
        data.update(ksm_parse(get(ksm_url(names[i:i + 10], today))))
    out = []
    for n, m in sorted(meta.items()):
        try:
            out.append(station("KSMESO", n, n + ", KS", "KS", m["lat"], m["lon"],
                               "10 cm (3.9 in)", "daily mean of hourly readings", data.get(n, {}), today))
        except Refuse as e:
            log("  ksmeso %s: left out (%s)" % (n, e))
    return out


NETWORKS = [("USCRN", fetch_uscrn), ("SCAN", fetch_scan), ("ISUSM", fetch_isusm), ("KSMESO", fetch_ksmeso)]
NET_LABEL = {"USCRN": "NOAA Climate Reference Network", "SCAN": "USDA NRCS Soil Climate Analysis Network",
             "ISUSM": "Iowa State Soil Moisture Network", "KSMESO": "Kansas Mesonet"}


# ---------------------------------------------------------------- counties
def ring_centroid(ring):
    a = cx = cy = 0.0
    for i in range(len(ring) - 1):
        x0, y0 = ring[i][0], ring[i][1]
        x1, y1 = ring[i + 1][0], ring[i + 1][1]
        f = x0 * y1 - x1 * y0
        a += f
        cx += (x0 + x1) * f
        cy += (y0 + y1) * f
    if abs(a) < 1e-12:
        xs = [p[0] for p in ring]
        ys = [p[1] for p in ring]
        return sum(xs) / len(xs), sum(ys) / len(ys), 0.0
    return cx / (3 * a), cy / (3 * a), abs(a) / 2


def county_points(geo):
    """counties.geo.json -> {fips: (name, st, lat, lon)} for the fall N states.
    The point is the centroid of the county's largest polygon."""
    out = {}
    for f in geo.get("features") or []:
        p = f.get("properties") or {}
        st = p.get("st")
        if st not in STATES:
            continue
        g = f.get("geometry") or {}
        polys = g.get("coordinates") or []
        if g.get("type") == "Polygon":
            polys = [polys]
        best = None
        for poly in polys:
            if poly and len(poly[0]) > 2:
                x, y, a = ring_centroid(poly[0])
                if best is None or a > best[2]:
                    best = (x, y, a)
        if best:
            out[str(f.get("id"))] = (p.get("name", ""), st, round(best[1], 3), round(best[0], 3))
    return out


def assign(points, stations):
    """{fips: [name, st, lat, lon]} plus [station index, miles] when a station
    is within MAX_MI of the county's center."""
    out = {}
    for fips, (name, st, lat, lon) in sorted(points.items()):
        best = None
        for i, s in enumerate(stations):
            d = miles(lat, lon, s["lat"], s["lon"])
            if d <= MAX_MI and (best is None or d < best[1]):
                best = (i, d)
        out[fips] = [name, st, lat, lon] + ([best[0], int(round(best[1]))] if best else [])
    return out


# ---------------------------------------------------------------- cross-check
CHECK_NETS = ("ISUSM", "KSMESO")   # read through guessed request forms: must agree with neighbors
CHECK_MI = 60
CHECK_F = 12.0


def cross_check(net, mine, others):
    """Median gap between this network's newest readings and the nearest
    station of another network (within CHECK_MI, same day). A unit or date
    mistake shows up as a large gap; ordinary field-to-field spread does not.
    Fewer than 3 pairs: no verdict (passes)."""
    gaps = []
    for s in mine:
        best = None
        for o in others:
            if o["last"] != s["last"]:
                continue
            d = miles(s["lat"], s["lon"], o["lat"], o["lon"])
            if d <= CHECK_MI and (best is None or d < best[0]):
                best = (d, o)
        if best and s["t"][-1] is not None and best[1]["t"][-1] is not None:
            gaps.append(s["t"][-1] - best[1]["t"][-1])
    if len(gaps) < 3:
        return None
    gaps.sort()
    med = gaps[len(gaps) // 2]
    if abs(med) > CHECK_F:
        raise Refuse("%s reads %.1f F off its neighbors (median of %d pairs)" % (net, med, len(gaps)))
    return med


# ---------------------------------------------------------------- build
def build(results, today, now_utc, prev=None, points=None, log=print):
    """results: {net: [stations] or Refuse}. Carries a failed network's last
    good stations from prev while they are still fresh enough."""
    stations, nets = [], {}
    for net, got in results.items():
        if isinstance(got, Exception):
            old = []
            for s in (prev or {}).get("stations") or []:
                if s.get("net") != net:
                    continue
                last = day(s.get("last"))
                if last and (today - last).days <= MAX_AGE_DAYS:
                    old.append(s)
            nets[net] = {"ok": False, "why": str(got)[:200], "carried": len(old)}
            stations += old
            log("%s failed (%s); carried %d stations from the last good file" % (net, got, len(old)))
        else:
            nets[net] = {"ok": True, "stations": len(got)}
            stations += got
    seen, uniq = set(), []
    for s in sorted(stations, key=lambda s: (s["st"], s["name"], s["id"])):
        if s["id"] not in seen:
            seen.add(s["id"])
            uniq.append(s)
    if len(uniq) < MIN_STATIONS:
        raise Refuse("only %d stations passed (need %d)" % (len(uniq), MIN_STATIONS))
    doc = {
        "about": "Measured soil temperature near 4 in for /fall-nitrogen. t is the last %d daily values in F, oldest first, ending on 'last'; null means the station sent nothing that day. counties: fips -> [name, state, lat, lon] (center of the county) plus [station index, miles] when a station is within max_miles." % DAYS,
        "updated_utc": now_utc,
        "max_miles": MAX_MI,
        "max_age_days": MAX_AGE_DAYS,
        "networks": nets,
        "net_labels": NET_LABEL,
        "state_names": NAMES,
        "stations": uniq,
    }
    if points:
        doc["counties"] = assign(points, uniq)
    return doc


# ---------------------------------------------------------------- reading a station (mirrors the page)
def read(s):
    t = s["t"]
    week = [v for v in t[-7:] if v is not None]
    latest = next((v for v in reversed(t) if v is not None), None)
    first = next((v for v in t[-7:] if v is not None), None)
    below = sum(1 for v in week if v < 50)
    if latest is None:
        state = None
    elif latest >= 50:
        state = "warm"
    elif below == len(week) and len(week) >= 5:
        state = "holding"
    else:
        state = "dipping"
    return {"latest": latest, "change": None if first is None or latest is None else round(latest - first, 1),
            "below": below, "n": len(week), "state": state}


def summary(doc):
    rows = []
    by = {}
    for s in doc["stations"]:
        by.setdefault(s["st"], []).append(s)
    for st in sorted(by, key=lambda k: NAMES.get(k, k)):
        ss = by[st]
        r = [read(s) for s in ss]
        lat = [x["latest"] for x in r if x["latest"] is not None]
        rows.append({"st": st, "name": NAMES.get(st, st), "n": len(ss),
                     "holding": sum(1 for x in r if x["state"] == "holding"),
                     "warm": sum(1 for x in r if x["state"] == "warm"),
                     "lo": min(lat) if lat else None, "hi": max(lat) if lat else None,
                     "last": max(s["last"] for s in ss)})
    return rows


# ---------------------------------------------------------------- stamping
STAMP_RE = re.compile(r"(<!--FALLN:STATIC-->)([\s\S]*?)(<!--/FALLN:STATIC-->)")
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def fmt_date(s):
    d = day(s)
    return "%s %d, %d" % (MON[d.month - 1], d.day, d.year) if d else ""


def static_html(doc):
    rows = summary(doc)
    newest = max(r["last"] for r in rows)
    h = ['<p class="fn-static-lede">Station readings through %s. %d stations in %d states. '
         'A station counts as &ldquo;under 50&deg;F all week&rdquo; when every one of its last 7 daily readings was under 50&deg;F.</p>'
         % (fmt_date(newest), sum(r["n"] for r in rows), len(rows))]
    h.append('<table class="fn-t"><caption>Soil near 4 in, by state, newest daily readings</caption><thead><tr>'
             '<th scope="col">State</th><th scope="col">Stations</th><th scope="col">Under 50&deg;F all week</th>'
             '<th scope="col">50&deg;F+ now</th><th scope="col">Now</th></tr></thead><tbody>')
    for r in rows:
        lo, hi = (None, None) if r["lo"] is None else (round(r["lo"]), round(r["hi"]))
        rng = "" if lo is None else '<span style="white-space:nowrap">%s&deg;F</span>' % (lo if lo == hi else "%d&ndash;%d" % (lo, hi))
        h.append('<tr><th scope="row">%s</th><td>%d</td><td>%d</td><td>%d</td><td>%s</td></tr>'
                 % (html.escape(r["name"]), r["n"], r["holding"], r["warm"], rng))
    h.append("</tbody></table>")
    return "\n" + "\n".join(h) + "\n"


def stamp(page_text, doc):
    if not STAMP_RE.search(page_text):
        raise Refuse("no <!--FALLN:STATIC--> markers in %s" % PAGE)
    body = static_html(doc)
    return STAMP_RE.sub(lambda m: m.group(1) + body + m.group(3), page_text, count=1)


# ---------------------------------------------------------------- modes
def load_prev():
    p = ROOT / OUT
    try:
        return json.loads(p.read_text())
    except Exception:  # noqa: BLE001
        return None


def write_all(doc):
    p = ROOT / OUT
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(doc, separators=(",", ":")) + "\n")
    pg = ROOT / PAGE
    pg.write_text(stamp(pg.read_text(), doc))


def main_run():
    today = datetime.datetime.now(datetime.timezone.utc).date()
    now_utc = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    results = {}
    for net, fn in NETWORKS:
        print("reading", net)
        try:
            results[net] = fn(today, print)
            print("  %s: %d stations passed" % (net, len(results[net])))
        except Refuse as e:
            results[net] = e
        except Exception as e:  # noqa: BLE001  a network's surprise never blocks the others
            results[net] = Refuse("%s: %s" % (type(e).__name__, e))
    for net in CHECK_NETS:
        got = results.get(net)
        if isinstance(got, list):
            others = [s for n, r in results.items() if n != net and isinstance(r, list) for s in r]
            try:
                med = cross_check(net, got, others)
                print("  %s vs neighbors: %s" % (net, "no pairs" if med is None else "median gap %.1f F" % med))
            except Refuse as e:
                results[net] = e
    points = county_points(json.loads((ROOT / COUNTIES).read_text()))
    try:
        doc = build(results, today, now_utc, prev=load_prev(), points=points)
    except Refuse as e:
        print("REFUSED:", e, "- nothing written")
        for net, r in results.items():
            if isinstance(r, Exception):
                print("::warning::fall-nitrogen %s: %s" % (net, r))
        return 1
    for net, r in results.items():
        if isinstance(r, Exception):
            print("::warning::fall-nitrogen %s: %s" % (net, r))
    write_all(doc)
    print("wrote %s: %d stations, %d counties with a station within %d mi" % (
        OUT, len(doc["stations"]), sum(1 for v in doc["counties"].values() if len(v) > 4), MAX_MI))
    return 0


def probe():
    """Save what each network returns, trimmed, plus a summary. No feed."""
    today = datetime.datetime.now(datetime.timezone.utc).date()
    raw = ROOT / RAW_DIR
    raw.mkdir(parents=True, exist_ok=True)
    summ = {"run_utc": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}

    def save(name, url):
        try:
            body = get(url)
            (raw / name).write_text("# %s\n%s" % (url, body[:150000]))
            return body
        except Refuse as e:
            (raw / name).write_text("# %s\nFAILED: %s\n" % (url, e))
            return None

    save("uscrn-HEADERS.txt", USCRN + "HEADERS.txt")
    save("uscrn-README.txt", USCRN + "README.txt")
    idx = save("uscrn-index.html.txt", USCRN + "%d/" % today.year)
    if idx:
        fl = sorted(uscrn_files(idx, today.year))
        summ["uscrn_files"] = fl
        if fl:
            save("uscrn-sample.txt", USCRN + "%d/%s" % (today.year, fl[0]))
    q = {"stationTriplets": ",".join("*:%s:SCAN" % s for s in STATES), "activeOnly": "true"}
    st = save("scan-stations.json", AWDB + "stations?" + urllib.parse.urlencode(q))
    try:
        meta = scan_station_list(json.loads(st or "[]"))
        summ["scan_stations"] = len(meta)
        if meta:
            few = sorted(meta)[:3]
            q = {"stationTriplets": ",".join(few), "elements": "STO:-4:1", "duration": "DAILY",
                 "beginDate": iso(today - datetime.timedelta(days=DAYS)), "endDate": iso(today)}
            daily = save("scan-data-sample.json", AWDB + "data?" + urllib.parse.urlencode(q))
            hourly = save("scan-hourly-sample.json", scan_url(few, today - datetime.timedelta(days=4), today))
            # What AWDB's DAILY value is: compare it with the mean of the hours.
            if daily and hourly:
                hm = scan_parse(json.loads(hourly))
                cmp = []
                for s in json.loads(daily):
                    for blk in s.get("data") or []:
                        for v in blk.get("values") or []:
                            m = hm.get(s.get("stationTriplet"), {}).get(day(v.get("date")))
                            if m is not None and num(v.get("value")) is not None:
                                cmp.append([s.get("stationTriplet"), v.get("date"), v.get("value"), round(m, 1)])
                summ["scan_daily_vs_hourly_mean"] = cmp
    except Exception as e:  # noqa: BLE001
        summ["scan_error"] = str(e)
    g = save("isusm-network.geojson", IEM + "geojson/network/ISUSM.geojson")
    save("isusm-help.html.txt", IEM + "cgi-bin/request/isusm.py?help")
    try:
        meta = isusm_station_list(json.loads(g or "{}"))
        summ["isusm_stations"] = len(meta)
        if meta:
            for k, u in enumerate(isusm_urls(sorted(meta)[:3], today)):
                save("isusm-daily-sample-%d.csv" % (k + 1), u)
    except Exception as e:  # noqa: BLE001
        summ["isusm_error"] = str(e)
    names = save("ksmeso-stationnames.csv", KSM + "stationnames/")
    save("ksmeso-variables.txt", KSM + "variables/")
    try:
        meta = ksm_station_list(names or "")
        summ["ksmeso_stations"] = len(meta)
        if meta:
            few = sorted(meta)[:3]
            save("ksmeso-hourly-sample.csv", ksm_url(few, today))
            begin = today - datetime.timedelta(days=DAYS + 2)
            q = {"stn": ",".join(few), "int": "day", "t_start": begin.strftime("%Y%m%d000000"),
                 "t_end": today.strftime("%Y%m%d000000"), "vars": "SOILTMP10AVG,SOILTMP10AVG655"}
            save("ksmeso-data-sample.csv", KSM + "stationdata/?" + urllib.parse.urlencode(q))
    except Exception as e:  # noqa: BLE001
        summ["ksmeso_error"] = str(e)
    # What would parse right now, network by network.
    for net, fn in NETWORKS:
        try:
            got = fn(today, lambda m: None)
            summ[net] = {"ok": True, "stations": len(got), "sample": got[:2]}
        except Exception as e:  # noqa: BLE001
            summ[net] = {"ok": False, "why": "%s: %s" % (type(e).__name__, e)}
    (raw / "summary.json").write_text(json.dumps(summ, indent=1) + "\n")
    print(json.dumps({k: v if not isinstance(v, dict) else {kk: vv for kk, vv in v.items() if kk != "sample"}
                      for k, v in summ.items()}, indent=1))
    return 0


# ---------------------------------------------------------------- selftest
def selftest():
    fails = []

    def check(name, cond):
        if not cond:
            fails.append(name)

    def refuses(name, f):
        try:
            f()
        except Refuse:
            return
        fails.append(name + " (did not refuse)")

    today = datetime.date(2026, 10, 16)

    def fixture(name):
        txt = (ROOT / "test/fixtures/fall-nitrogen" / name).read_text()
        return txt.split("\n", 1)[1] if txt.startswith("# http") else txt
    D = lambda n: today - datetime.timedelta(days=n)  # noqa: E731

    check("c_to_f 10 C = 50 F", c_to_f(10) == 50)
    check("c_to_f 0 C = 32 F", c_to_f(0) == 32)
    check("num -9999 is missing", num("-9999.0") is None and num("x") is None and num("12.5") == 12.5)
    refuses("unknown unit", lambda: to_f(1.0, "K"))
    check("miles Ames to Des Moines about 30", 25 < miles(42.03, -93.62, 41.59, -93.62) < 35)

    # USCRN headers: found by name, unit must be Celsius.
    names = ["WBANNO", "LST_DATE", "CRX_VN", "LONGITUDE", "LATITUDE", "T_DAILY_MAX", "SOIL_TEMP_5_DAILY", "SOIL_TEMP_10_DAILY"]
    units = ["XXXXX", "YYYYMMDD", "XXXXXX", "Decimal_degrees", "Decimal_degrees", "Celsius", "Celsius", "Celsius"]
    hdr = "%s\n%s\n%s\n" % (" ".join(str(i + 1) for i in range(len(names))), " ".join(names), " ".join(units))
    col = uscrn_columns(hdr)
    check("uscrn col by name", col["SOIL_TEMP_10_DAILY"] == 7 and col["_n"] == 8)
    refuses("uscrn wrong unit", lambda: uscrn_columns(hdr.replace("Celsius\n", "Fahrenheit\n")))
    refuses("uscrn missing column", lambda: uscrn_columns(hdr.replace("SOIL_TEMP_10_DAILY", "SOIL_X")))
    body = "\n".join("54902 %s 2.622 -93.29 41.56 20.1 9.0 %s" % (D(i).strftime("%Y%m%d"), "-9999.0" if i == 3 else "%.1f" % (12.0 - i * 0.2))
                     for i in range(10, -1, -1))
    w, la, lo, rows = uscrn_parse(body, col)
    check("uscrn parse 12.0 C -> 53.6 F", abs(rows[today] - 53.6) < 1e-6)
    check("uscrn missing day is None", rows[D(3)] is None)
    s = station("USCRN", w, "Des Moines 17 E, IA", "IA", la, lo, "10 cm (3.9 in)", "daily mean", rows, today)
    check("uscrn station keeps 10 days", len(s["t"]) == DAYS and s["t"][-1] == 53.6 and s["t"][-4] is None)
    idx = '<a href="CRND0103-2026-IA_Des_Moines_17_E.txt">x</a><a href="CRND0103-2026-TX_Austin_33_NW.txt">y</a>'
    check("uscrn index keeps fall N states only", list(uscrn_files(idx, 2026).values()) == [("IA", "Des Moines 17 E")])

    # The station checks.
    good = {D(i): 48.0 - i * 0.5 for i in range(10)}
    check("fresh station passes", series(good, today)[0] == today)
    refuses("stale station", lambda: series({D(i + 4): 45.0 for i in range(10)}, today))
    refuses("future reading", lambda: series(dict(good, **{}) | {today + datetime.timedelta(days=1): 45.0}, today))
    refuses("out of range", lambda: series(good | {today: 140.0}, today))
    refuses("sensor jump", lambda: series(good | {D(1): 70.0}, today))
    refuses("too few days", lambda: series({today: 45.0, D(1): 45.0, D(2): 45.0, D(3): 45.0}, today))
    refuses("station outside the region", lambda: station("X", "1", "a", "TX", 30.2, -97.7, "4 in", "m", good, today))

    # SCAN (AWDB): hourly STO at -4 in only, averaged per day; unit read from the block.
    hrs = lambda d0, base: [{"date": "%s %02d:00" % (iso(d0 if h else d0 + datetime.timedelta(days=1)), h), "value": base + (h % 3)}  # noqa: E731
                            for h in list(range(1, 24)) + [0]]
    blk = {"stationElement": {"elementCode": "STO", "heightDepth": -4, "durationName": "HOURLY", "storedUnitCode": "degF"},
           "values": [v for i in range(1, 10) for v in hrs(D(i), 45.0 + i)]}
    doc = [{"stationTriplet": "2031:IA:SCAN", "data": [blk,
        {"stationElement": {"elementCode": "STO", "heightDepth": -8, "durationName": "HOURLY", "storedUnitCode": "degF"},
         "values": [{"date": iso(D(1)) + " 05:00", "value": 99.0}]}]}]
    p = scan_parse(doc)["2031:IA:SCAN"]
    # 24 hours of base + (h mod 3): 8 hours each of +0, +1, +2, so the mean is base + 1.
    check("scan hourly -> daily mean, -8 in ignored", p[D(1)] == 47.0 and p[D(9)] == 55.0 and len(p) == 9)
    check("scan 00:00 closes the day before", p[D(2)] == 48.0)
    part = json.loads(json.dumps(doc))
    part[0]["data"][0]["values"] += [{"date": iso(today) + " %02d:00" % h, "value": 40.0} for h in range(1, 13)]
    check("scan day in progress does not count", today not in scan_parse(part)["2031:IA:SCAN"])
    bad = json.loads(json.dumps(doc))
    bad[0]["data"][0]["stationElement"]["storedUnitCode"] = "pct"
    refuses("scan unknown unit", lambda: scan_parse(bad))
    # The real AWDB DAILY sample (probe, Oct 16 2026): refused, because the
    # response does not say whether the daily value is a mean.
    real = json.loads(fixture("scan-data-sample.json"))
    check("real scan daily sample: STO, -4 in, degF", all(b["stationElement"]["elementCode"] == "STO" and b["stationElement"]["heightDepth"] == -4
                                                      and b["stationElement"]["storedUnitCode"] == "degF" for s in real for b in s["data"]))
    refuses("real scan DAILY block is not used", lambda: scan_parse(real))
    sl = scan_station_list(json.loads(fixture("scan-stations.json")))
    check("real scan station list: 31 in the fall N states", len(sl) == 31 and sl["2001:NE:SCAN"]["name"] == "Rogers Farm #1")
    sl = scan_station_list([{"stationTriplet": "2031:IA:SCAN", "name": "AMES", "latitude": 42.0, "longitude": -93.7},
                            {"stationTriplet": "2001:TX:SCAN", "name": "X", "latitude": 30, "longitude": -97}])
    check("scan list keeps fall N states", list(sl) == ["2031:IA:SCAN"])

    # Real USCRN files: the column is found by name in the real HEADERS.txt.
    rc = uscrn_columns(fixture("uscrn-HEADERS.txt"))
    w, la, lo, rows = uscrn_parse(fixture("uscrn-sample.txt"), rc)
    # Des Moines 17 E, Oct 15 2026: SOIL_TEMP_10_DAILY 17.3 C = 63.14 F. Oct 16 is -9999 (not in yet).
    check("real uscrn Des Moines Oct 15 = 17.3 C", w == "54902" and abs(rows[datetime.date(2026, 10, 15)] - 63.14) < 1e-6)
    check("real uscrn missing day", rows[datetime.date(2026, 10, 16)] is None)

    # ISUSM CSV: known column names only, unit from the name.
    csv = "station,valid,t4_c_avg_qc\nAEEI4,%s,9.5\nAEEI4,%s,M\n" % (iso(today), iso(D(1)))
    p = isusm_parse(csv)
    check("isusm C column -> F", abs(p["AEEI4"][today] - 49.1) < 1e-6 and p["AEEI4"][D(1)] is None)
    p = isusm_parse("station,valid,soil04t\nAEEI4,%s,49.1\n" % iso(today))
    real = isusm_station_list(json.loads(fixture("isusm-network.geojson")))
    check("real ISUSM network: online stations with names", "AEEI4" in real and real["AEEI4"]["name"] == "Ames - Horticulture ISU-RDF" and len(real) >= 20)
    us = isusm_urls(["AEEI4"], today)
    check("isusm request carries a time zone on sts", "sts=2026-10-04T00%3A00Z" in us[0] and "year1=2026" in us[1])
    check("isusm F column stays F", p["AEEI4"][today] == 49.1)
    refuses("isusm unknown column", lambda: isusm_parse("station,valid,soil_mystery\nA,%s,1\n" % iso(today)))

    # Kansas Mesonet CSV: hourly, Celsius, thermistor column first.
    ks = "TIMESTAMP,STATION,SOILTMP10AVG,SOILTMP10AVG655\n" + "".join(
        "%s %02d:00:00,Manhattan,%s,11\n" % (iso(D(1) if h else today), h, "" if h == 5 else "10") for h in list(range(1, 24)) + [0])
    p = ksm_parse(ks)
    # 23 hours of 10 C (thermistor) and hour 5 from the CS655 (11 C): mean 10.0417 C = 50.075 F.
    check("ksmeso hourly C -> daily mean F", abs(p["Manhattan"][D(1)] - (10 + 1 / 24) * 1.8 - 32) < 1e-9 and today not in p["Manhattan"])
    # The real daily sample from the probe: one row a day is never enough hours.
    real = ksm_parse(fixture("ksmeso-data-sample.csv"))
    check("real ksmeso daily rows give no days", set(real) == {"Alma 5SE", "Ashland 8S", "Ashland Bottoms"} and all(not v for v in real.values()))
    check("real ksmeso station list", ksm_station_list(fixture("ksmeso-stationnames.csv"))["Alma 5SE"]["lat"] == "38.966150")
    refuses("ksmeso no soil column", lambda: ksm_parse("TIMESTAMP,STATION,TEMP2MAVG\n2026-10-16,Manhattan,10\n"))
    check("ksmeso station list", ksm_station_list("NAME,LATITUDE,LONGITUDE\nManhattan,39.2,-96.6\n")["Manhattan"]["lat"] == "39.2")

    # Reading a station, as the page does.
    mk = lambda vals: {"t": [None] * (DAYS - len(vals)) + vals}  # noqa: E731
    r = read(mk([52, 51, 50, 49, 48, 47, 46]))
    check("dipping: latest under 50, not all week", r["state"] == "dipping" and r["below"] == 4 and r["change"] == -6)
    r = read(mk([49, 48, 47, 47, 46, 45, 44]))
    check("holding: all 7 under 50", r["state"] == "holding" and r["change"] == -5)
    check("warm: latest 50 or more", read(mk([44, 45, 46, 47, 48, 49, 50]))["state"] == "warm")
    check("holding needs 5 days", read(mk([None, None, None, 45, 44, 43, 42]))["state"] == "dipping")

    # Counties: nearest station within 50 mi, else blank.
    pts = {"19169": ("Story", "IA", 42.04, -93.47), "19193": ("Woodbury", "IA", 42.39, -96.05)}
    sts = [{"lat": 41.56, "lon": -93.29}, {"lat": 42.0, "lon": -93.7}]
    a = assign(pts, sts)
    check("county gets nearest station", a["19169"][4] == 1 and a["19169"][5] < 15)
    check("county with no station within 50 mi stays blank", a["19193"] == ["Woodbury", "IA", 42.39, -96.05])
    sq = [[[-94, 42], [-93, 42], [-93, 43], [-94, 43], [-94, 42]]]
    cp = county_points({"features": [{"id": "19001", "properties": {"name": "Sq", "st": "IA"},
                                       "geometry": {"type": "Polygon", "coordinates": sq}}]})
    check("square centroid", cp["19001"][2:] == (42.5, -93.5))

    # Build: refuses too few, carries a failed network while fresh.
    many = [dict(s, id="USCRN:%d" % i, name="S%d" % i) for i in range(MIN_STATIONS)]
    d = build({"USCRN": many, "SCAN": Refuse("down")}, today, "2026-10-16T12:00:00Z",
              prev={"stations": [dict(s, id="SCAN:1", net="SCAN", last=iso(D(1))),
                                 dict(s, id="SCAN:2", net="SCAN", last=iso(D(9)))]})
    check("failed network carries fresh stations only", d["networks"]["SCAN"]["carried"] == 1 and len(d["stations"]) == MIN_STATIONS + 1)
    refuses("too few stations", lambda: build({"USCRN": many[:3]}, today, "x", log=lambda m: None))

    # Cross-check: a network reading in the wrong unit is refused.
    base = [dict(s, lat=41.5 + i * 0.1, lon=-93.3, last=iso(today), t=s["t"][:-1] + [48.0]) for i in range(4)]
    near = [dict(b, lat=b["lat"] + 0.05, t=b["t"][:-1] + [46.0]) for b in base]
    check("cross-check passes a close network", cross_check("ISUSM", near, base) == -2.0)
    refuses("cross-check refuses a Celsius mix-up", lambda: cross_check("ISUSM", [dict(b, t=b["t"][:-1] + [9.0]) for b in near], base))
    check("cross-check without pairs gives no verdict", cross_check("ISUSM", near[:2], base) is None)

    # Stamp.
    pg = "<p>a</p><!--FALLN:STATIC-->old<!--/FALLN:STATIC-->"
    out = stamp(pg, d)
    check("stamp names the state and the date", "Iowa" in out and "Oct 16, 2026" in out and "old" not in out)
    check("stamp has no em dash", "\u2014" not in out and "&mdash;" not in out)
    refuses("stamp needs markers", lambda: stamp("<p>a</p>", d))

    if fails:
        print("SELFTEST FAILED:", "; ".join(fails))
        return 1
    print("selftest ok")
    return 0


def main(argv):
    if "--selftest" in argv:
        return selftest()
    if "--probe" in argv:
        return probe()
    if "--stamp" in argv:
        doc = load_prev()
        if not doc:
            print("no %s on disk" % OUT)
            return 1
        pg = ROOT / PAGE
        pg.write_text(stamp(pg.read_text(), doc))
        return 0
    return main_run()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
