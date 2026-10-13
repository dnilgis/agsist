#!/usr/bin/env python3
"""county_rain.py: the arithmetic and the geography behind /rain/<state>/<county>.

Shared by scripts/fetch_county_rain.py (which reads NOAA's daily records from
RCC-ACIS and writes data/rain/<st>.json) and scripts/build_county_rain.py
(which turns those files into pages). Nothing here touches the network.

THE RULES (the same ones Rain Print follows, components/rain-print.js)
  * One daily value from ACIS: "M" is a day nobody recorded. It is a gap,
    never a dry day: it counts toward nothing, ends a dry stretch, and the
    usual year is summed without it too.
  * "T" is a trace: a reported day, counted as 0, not a dry day.
  * "S" is a day the observer did not read the gauge; that catch is in the
    next "A" value (a total over several days). An S day is reported (the
    rain is in the year's total, once, on the A day) but it is not a dry day.
  * An "A" value is several days' rain, so it is never the biggest single day.
  * The days after a station's last report have not come in yet (NOAA's
    daily numbers lag a few days). They are not gaps; the county's as-of date
    is that last report.
  * Usual to date = the sum of NOAA's daily normals over the SAME days the
    station reported. Missing days are left out on both sides.
"""
import datetime as dt
import json
import math
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

MIN_SHARE = 0.90        # a station must report at least this share of the year's days so far
STALE_DAYS = 10         # a station whose last report is older than this before the fetch's end date is not reporting
PCT_MIN_NORMAL = 1.0    # below this many inches of usual-to-date a percent is too jumpy to print (early January)
CUM_STEP = 7            # running-total points: every 7th day of the year, plus the last

STATES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado",
    "CT": "Connecticut", "DE": "Delaware", "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho",
    "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana",
    "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota",
    "MS": "Mississippi", "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York", "NC": "North Carolina",
    "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania",
    "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas",
    "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington", "WV": "West Virginia",
    "WI": "Wisconsin", "WY": "Wyoming",
}
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
               "October", "November", "December"]


def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


# ---------------------------------------------------------------- geography

def _ring_centroid(ring):
    """(signed area, cx, cy) of one ring, planar on lon/lat (fine at county size)."""
    a = cx = cy = 0.0
    for i in range(len(ring) - 1):
        x0, y0 = ring[i][0], ring[i][1]
        x1, y1 = ring[i + 1][0], ring[i + 1][1]
        c = x0 * y1 - x1 * y0
        a += c
        cx += (x0 + x1) * c
        cy += (y0 + y1) * c
    a /= 2.0
    if abs(a) < 1e-12:
        xs = [p[0] for p in ring]
        ys = [p[1] for p in ring]
        return 0.0, sum(xs) / len(xs), sum(ys) / len(ys)
    return a, cx / (6 * a), cy / (6 * a)


def centroid(geom):
    """Area-weighted centroid (lat, lon) of a Polygon or MultiPolygon's outer rings."""
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    A = X = Y = 0.0
    for poly in polys:
        a, x, y = _ring_centroid(poly[0])
        A += abs(a)
        X += x * abs(a)
        Y += y * abs(a)
    if A == 0:
        a, x, y = _ring_centroid(polys[0][0])
        return round(y, 4), round(x, 4)
    return round(Y / A, 4), round(X / A, 4)


def miles(lat1, lon1, lat2, lon2):
    R = 3958.8
    t = math.radians
    h = math.sin(t(lat2 - lat1) / 2) ** 2 + math.cos(t(lat1)) * math.cos(t(lat2)) * math.sin(t(lon2 - lon1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def _atlas_index():
    p = os.path.join(ROOT, "farmland-atlas", "data", "counties-index.json")
    out = {}
    if os.path.exists(p):
        for fips, label, href in json.load(open(p, encoding="utf-8")):
            out[fips] = (re.sub(r",\s*[A-Z]{2}$", "", label), href.rstrip("/").rsplit("/", 1)[-1])
    return out


def counties():
    """fips -> {st, name, slug, lat, lon} for every county in data/atlas/counties.geo.json.
    Names and slugs follow the Farmland Atlas, so /rain/iowa/story-county sits
    beside /prf/iowa/story-county and /farmland-atlas/iowa/story-county."""
    geo = json.load(open(os.path.join(ROOT, "data", "atlas", "counties.geo.json"), encoding="utf-8"))
    atl = _atlas_index()
    out = {}
    used = {}
    for f in sorted(geo["features"], key=lambda f: f["id"]):
        fips, st, adm = f["id"], f["properties"]["st"], f["properties"]["name"]
        if st not in STATES:
            continue
        if fips in atl:
            name, sl = atl[fips]
        else:
            name = adm if re.search(r"(County|Parish|Borough|Census Area|Municipality|city|City)$", adm) else (
                f"{adm} Parish" if st == "LA" else f"{adm} County")
            sl = slug(name)
        u = used.setdefault(st, set())
        if sl in u:
            sl = f"{sl}-{fips[2:]}"
        u.add(sl)
        lat, lon = centroid(f["geometry"])
        out[fips] = {"st": st, "name": name, "slug": sl, "lat": lat, "lon": lon}
    return out


def neighbors():
    p = os.path.join(ROOT, "data", "atlas", "neighbors.json")
    return json.load(open(p, encoding="utf-8"))["counties"] if os.path.exists(p) else {}


# ---------------------------------------------------------------- stations

STN_WORD = {"AP": "Airport", "MUNI": "Municipal", "INTL": "International", "RGNL": "Regional", "CO": "County",
            "FLD": "Field", "ARPT": "Airport", "STN": "Station", "EXP": "Experiment", "AG": "Ag"}
AIR = {"AP", "ARPT", "AIRPORT", "INTL", "MUNI", "RGNL", "FLD", "FIELD", "INTERNATIONAL", "REGIONAL", "MUNICIPAL"}
DIRS = {"N": "north", "S": "south", "E": "east", "W": "west", "NE": "northeast", "NW": "northwest",
        "SE": "southeast", "SW": "southwest", "NNE": "north-northeast", "ENE": "east-northeast",
        "ESE": "east-southeast", "SSE": "south-southeast", "SSW": "south-southwest", "WSW": "west-southwest",
        "WNW": "west-northwest", "NNW": "north-northwest"}
OFFSET = re.compile(r"^(.*?) (\d+(?:\.\d+)?) ?([NSEW]{1,3})$")


def _title(words):
    out = []
    for w in words:
        u = w.upper()
        if u in STN_WORD:
            out.append(STN_WORD[u])
        elif re.fullmatch(r"[NSEW]{1,3}", u) or re.search(r"\d", w):
            out.append(u)
        else:
            out.append(u[:1] + u[1:].lower())
    return " ".join(out)


def station_name(raw):
    """Plain words for an ACIS station name, as Rain Print's stationName():
    "AMES 8 WSW" -> "Ames, 8 mi WSW", "DES MOINES INTL AP" -> "Des Moines International Airport"."""
    s = re.sub(r"\s+", " ", str(raw or "").strip())
    m = OFFSET.match(s)
    tail = ""
    if m:
        s, tail = m.group(1), f", {m.group(2)} mi {m.group(3)}"
    return _title(s.split(" ")) + tail


def station_town(raw):
    """The town a station is named for: offsets and airport words dropped."""
    s = re.sub(r"\s+", " ", str(raw or "").strip())
    m = OFFSET.match(s)
    if m:
        s = m.group(1)
    words = [w for w in s.split(" ") if w.upper() not in AIR and not re.fullmatch(r"\d+|NO\.?|#\d*", w.upper())]
    return _title(words) if words else _title(s.split(" "))


def station_where(raw):
    """Words that place the station: "8 miles west-southwest of Ames",
    "at Des Moines International Airport", "in Ames"."""
    s = re.sub(r"\s+", " ", str(raw or "").strip())
    m = OFFSET.match(s)
    if m and m.group(3) in DIRS:
        n = m.group(2)
        unit = "mile" if n in ("1", "1.0") else "miles"
        return f"{n} {unit} {DIRS[m.group(3)]} of {_title(m.group(1).split(' '))}"
    if any(w.upper() in AIR for w in s.split(" ")):
        return "at " + station_name(s)
    return "in " + station_town(s)


def network(sids):
    """'cocorahs' for a CoCoRaHS volunteer gauge (ACIS sid type 10), else 'noaa'."""
    return "cocorahs" if any(str(x).strip().endswith(" 10") for x in (sids or [])) else "noaa"


# ---------------------------------------------------------------- one day, one station

def parse_pcpn(raw):
    """(value, flag) for one ACIS daily precipitation value. See the module docstring."""
    s = str(raw if raw is not None else "M").strip()
    if s in ("M", ""):
        return None, "M"
    if s == "T":
        return 0.0, "T"
    if s == "S":
        return 0.0, "S"
    acc = s.endswith("A")
    try:
        v = float(s.rstrip("A"))
    except ValueError:
        return None, "M"
    if v < 0:
        return None, "M"
    return v, ("A" if acc else "")


def days_of(year, sdate, n):
    d0 = dt.date.fromisoformat(sdate)
    return [(d0 + dt.timedelta(days=i)).isoformat() for i in range(n)]


def row_values(row):
    """A MultiStnData day row is a list of element values; tolerate a bare value."""
    return row if isinstance(row, list) else [row]


def summarize(year, dates, vals, norms, edate):
    """Everything a county page needs from one station's year so far, or a
    reason it does not qualify. dates/vals/norms are parallel (norms may be None).
    Returns (summary or None, reason)."""
    parsed = [parse_pcpn(v) for v in vals]
    last = max((i for i, (v, _) in enumerate(parsed) if v is not None), default=-1)
    if last < 0:
        return None, "no days reported"
    as_of = dates[last]
    if (dt.date.fromisoformat(edate) - dt.date.fromisoformat(as_of)).days > STALE_DAYS:
        return None, f"last report {as_of}"
    dates, parsed = dates[:last + 1], parsed[:last + 1]
    norms = norms[:last + 1] if norms is not None else None
    n = len(dates)
    reported = sum(1 for v, _ in parsed if v is not None)
    if reported < MIN_SHARE * n:
        return None, f"{round(100 * reported / n)}% of days reported"
    # normals: a reported day whose normal is missing withholds the comparison,
    # except Feb 29, which takes Feb 28's normal (NOAA's normals are 365 days)
    nv = None
    if norms is not None:
        nv = []
        for i, d in enumerate(dates):
            x, _ = parse_pcpn(norms[i])
            if x is None and d[5:] == "02-29" and i > 0:
                x, _ = parse_pcpn(norms[i - 1])
            nv.append(x)
        if any(nv[i] is None for i, (v, _) in enumerate(parsed) if v is not None):
            nv = None
    total = usual = 0.0
    trace = acc = unsplit = 0
    months = {}
    cum = []
    best = None
    run = run_start = 0
    dry = None
    for i, (d, (v, flag)) in enumerate(zip(dates, parsed)):
        m = int(d[5:7]) - 1
        mo = months.setdefault(m, [0.0, 0.0, 0, 0])   # total, usual, reported, days
        mo[3] += 1
        if v is not None:
            mo[2] += 1
            total += v
            mo[0] += v
            if nv is not None:
                usual += nv[i]
                mo[1] += nv[i]
            if flag == "T":
                trace += 1
            elif flag == "S":
                unsplit += 1
            elif flag == "A":
                acc += 1
            if flag == "" and v > 0 and (best is None or v > best[1]):
                best = (d, round(v, 2))
        if v is not None and flag == "" and v == 0:
            if run == 0:
                run_start = i
            run += 1
            if dry is None or run > dry[0]:
                dry = (run, dates[run_start], d)
        else:
            run = 0
        if (i + 1) % CUM_STEP == 0 or i == n - 1:
            cum.append([i, round(total, 2), round(usual, 2) if nv is not None else None])
    mlist = []
    for m in range(int(dates[0][5:7]) - 1, int(as_of[5:7])):
        t, u, r, k = months.get(m, [0.0, 0.0, 0, 0])
        mlist.append([round(t, 2), round(u, 2) if nv is not None else None, r, k])
    full = [(m, x) for m, x in enumerate(mlist) if x[3] and x[2] >= MIN_SHARE * x[3]]
    wet = max(full, key=lambda t: t[1][0], default=None)
    usual_r = round(usual, 2) if nv is not None else None
    pct = round(100 * total / usual) if usual_r is not None and usual_r >= PCT_MIN_NORMAL else None
    return {
        "as_of": as_of, "days": n, "reported": reported, "missing": n - reported,
        "trace": trace, "acc": acc, "unsplit": unsplit,
        "total": round(total, 2), "usual": usual_r, "pct": pct,
        "months": mlist,
        "wet_month": [wet[0], wet[1][0]] if wet and wet[1][0] > 0 else None,
        "max_day": list(best) if best else None,
        "dry": list(dry) if dry else None,
        "cum": cum,
    }, "ok"


def same_date_last_year(as_of):
    d = dt.date.fromisoformat(as_of)
    y = d.year - 1
    day = 28 if (d.month == 2 and d.day == 29) else d.day
    return dt.date(y, d.month, day).isoformat()


def last_year_total(vals, sdate, as_of_last):
    """Total for last year, Jan 1 through as_of_last, from that year's values
    (which start at sdate). None unless at least MIN_SHARE of those days reported."""
    n = (dt.date.fromisoformat(as_of_last) - dt.date.fromisoformat(sdate)).days + 1
    vals = list(vals[:n])
    if len(vals) < n:
        vals += ["M"] * (n - len(vals))
    parsed = [parse_pcpn(v)[0] for v in vals]
    rep = sum(1 for v in parsed if v is not None)
    if rep < MIN_SHARE * n:
        return None
    return {"total": round(sum(v for v in parsed if v is not None), 2), "reported": rep, "days": n, "through": as_of_last}


def rank_key(cand):
    """Pick order inside a county: a station with NOAA normals first (the page's
    answer is "compared with a usual year"), then the most days reported, then
    nearest the middle of the county."""
    s = cand["summary"]
    return (0 if s["usual"] is not None else 1, -s["reported"], cand["mi"])
