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
  * An "A" value is several days' rain, so it is never the biggest single day;
    and when an A value spread evenly over its days beats the biggest one-day
    reading, no biggest day is given at all (some day inside it was bigger).
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
ZERO_YEAR_DAYS = 60     # a gauge that reads 0.00 on every one of this many reported days is not working
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
    lons = [p[0] for poly in polys for p in poly[0]]
    if lons and max(lons) - min(lons) > 180:
        # the Aleutians cross the 180th meridian: put the east-of-180 islands
        # at -181 and so on, or the average lands in Colorado
        polys = [[[[p[0] - 360 if p[0] > 0 else p[0]] + list(p[1:]) for p in poly[0]]] for poly in polys]
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
        g = f["geometry"]
        ring_pts = [p for poly in ([g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]) for p in poly[0]]
        # reach: miles from the middle to the farthest corner (a station inside
        # the county can be this far out; Aleutians West is 580)
        reach = round(max(miles(lat, lon, p[1], p[0]) for p in ring_pts), 1)
        out[fips] = {"st": st, "name": name, "slug": sl, "lat": lat, "lon": lon, "reach": reach}
    return out


def neighbors():
    p = os.path.join(ROOT, "data", "atlas", "neighbors.json")
    return json.load(open(p, encoding="utf-8"))["counties"] if os.path.exists(p) else {}


# ---------------------------------------------------------------- stations

STN_WORD = {"AP": "Airport", "MUNI": "Municipal", "INTL": "International", "RGNL": "Regional", "CO": "County",
            "FLD": "Field", "ARPT": "Airport", "STN": "Station", "EXP": "Experiment", "AG": "Ag",
            "L/D": "Lock and Dam", "L&D": "Lock and Dam"}
AIR = {"AP", "ARPT", "AIRPORT", "INTL", "MUNI", "RGNL", "FLD", "FIELD", "INTERNATIONAL", "REGIONAL", "MUNICIPAL", "INDUSTRIAL"}
DIRS = {"N": "north", "S": "south", "E": "east", "W": "west", "NE": "northeast", "NW": "northwest",
        "SE": "southeast", "SW": "southwest", "NNE": "north-northeast", "ENE": "east-northeast",
        "ESE": "east-southeast", "SSE": "south-southeast", "SSW": "south-southwest", "WSW": "west-southwest",
        "WNW": "west-northwest", "NNW": "north-northwest"}
# "AMES 8 WSW", "WAUKON 3NNE", "SALEM1 S" with the number run into the town,
# and "EADS .45 E" with no 0 before the point (0.45 mile, not 45)
OFFSET = re.compile(r"^(.*?[A-Za-z.]) ?(\d*\.?\d+) ?([NSEW]{1,3})$")
# Words that are the weather office or the sensor, not the place:
# "MISSOULA 6 NW WFO", "TOPEKA ASOS", "SPRINGFIELD WSO AP", "ELKO NWS OFFICE"
OFFICE = re.compile(r"\b(?:NWS OFFICE|WFO|WSO|NWSO|ASOS|AWOS|MESONET)\b", re.I)
# Not a town: the answer says "at the NOAA station Eastern Band of Cherokee
# Indians", never "in Eastern Band ...". A name that starts with UNIVERSITY is a campus.
NOT_PLACE = {"INDIANS", "TRIBE", "TRIBAL", "RESERVATION", "NATION", "BAND"}
SMALL = {"OF", "THE", "AND"}


def _clean(raw):
    """A station name without what is not part of the place: parentheses
    ("(W9DBA)MORGANTOWN", "GRANTSBURG 0.6 SW (KWIGRANT1)", "BUFFALO (ASOS)")
    and weather office words. Falls back to the raw name if nothing is left."""
    s = re.sub(r"\s+", " ", str(raw or "").strip())
    t = re.sub(r"\([^)]*\)", " ", s)
    t = OFFICE.sub(" ", t)
    # "N FK ELK CREEK": a fork of a creek, in words
    t = re.sub(r"\b([NSEWM]) FK\b", lambda m: {"N": "NORTH", "S": "SOUTH", "E": "EAST", "W": "WEST", "M": "MIDDLE"}[m.group(1)] + " FORK", t)
    t = re.sub(r"\bFK\b", "FORK", t)
    t = re.sub(r"\s+", " ", t).strip(" -/")
    return t or s


def _offset(s):
    """(place, miles as text, direction) for "AMES 8 WSW", else None. ".45" -> "0.45"."""
    m = OFFSET.match(s)
    if not m:
        return None
    n = m.group(2)
    return m.group(1).rstrip(" ."), ("0" + n if n.startswith(".") else n), m.group(3)


def _title(words):
    out = []
    for i, w in enumerate(words):
        u = w.upper()
        after_number = i > 0 and re.search(r"\d", words[i - 1])
        if u in STN_WORD:
            out.append(STN_WORD[u])
        elif re.fullmatch(r"NO\.?(\d*)", u):         # MAPLETON NO.2, REMSEN NO. 2
            out.append("No. " + u.lstrip("NO.") if u.lstrip("NO.") else "No.")
        elif (u in DIRS and (len(u) < 3 or after_number)) or re.search(r"\d", w):
            # "NEW ULM" is a town, not north-east-west: only a real compass
            # word stays upper case, and a three-letter one only after a number
            out.append(u)
        elif u in SMALL and i > 0:
            out.append(u.lower())            # "Moscow U of I", "Lake of the Woods"
        else:
            # "Winston-Salem", "Glens Falls/Floyd Bennett", "T.F. Green"
            out.append(re.sub(r"([-/.])([a-z])", lambda x: x.group(1) + x.group(2).upper(), u[:1] + u[1:].lower()))
    return " ".join(out)


def station_name(raw):
    """Plain words for an ACIS station name, as Rain Print's stationName():
    "AMES 8 WSW" -> "Ames, 8 mi WSW", "DES MOINES INTL AP" -> "Des Moines International Airport"."""
    s = _clean(raw)
    o = _offset(s)
    tail = ""
    if o:
        s, tail = o[0], f", {o[1]} mi {o[2]}"
    return _title(s.split(" ")) + tail


# Words that end the town part of a station name: "GARDEN CITY EXP STN",
# "FORT RANDALL DAM", "AMES WTP", "LAKE CITY RSCH CTR". Everything from the
# first of these on is the site, not the town (Rain Print geocodes the town).
# Only cut after at least one word, so "PLANT CITY" stays a town.
NOT_TOWN = {"EXP", "EXPT", "EXPER", "EXPERIMENT", "STN", "FARM", "FARMS", "RSCH", "RESEARCH", "RES", "CTR",
            "UNIV", "UNIVERSITY", "AGRI", "AG", "DAM", "L&D", "L/D", "WTP", "WWTP", "STP", "PLANT", "LAB", "NWS",
            "RADIO", "HQ", "PWR", "SEWAGE", "FILTRATION", "STA", "PH", "MESONET", "R.S.", "S.P."}


def _cut_here(words, i):
    u, nxt = words[i].upper(), (words[i + 1].upper() if i + 1 < len(words) else "")
    if u in NOT_TOWN or u.split(".")[0] in NOT_TOWN - {"R", "S"}:   # "BEAUMONT EXP.STATION"
        return True
    if re.fullmatch(r"\d*\.?\d+[NSEW]{1,3}", u):   # "SULPHUR 4NNE MESONET": the offset is not the end
        return True
    if u == "CENTRAL" and nxt in DIRS:      # "GRAND ISLAND CENTRAL NE REGIONAL AP"
        return True
    if u in ("LOCK", "LOCKS"):            # LOCK AND DAM 10, LOCK 4, LOCKS AND DAM; not LOCK HAVEN
        return nxt in ("AND", "&", "DAM") or re.fullmatch(r"\d+", nxt) is not None
    if u == "RANGER":                     # RANGER STN; not the town of Ranger
        return nxt in ("STN", "STATION")
    return False


def station_town(raw):
    """The town a station is named for: offsets, airport words and site words
    (experiment station, dam, plant, #2) dropped."""
    s = _clean(raw)
    o = _offset(s)
    if o:
        s = o[0]
    # "PHILADELPHIA/MT. HOLLY WFO", "WILKES-BARRE/SCRANTON INTL AP": the first city
    # (a word of 2+ letters before the slash, so "GUTTENBERG L/D 10" stays whole)
    m = re.match(r"^(.*?[A-Za-z]{2,})/[A-Za-z]", s)
    if m:
        s = m.group(1)
    ws = s.split(" ")
    cut = next((i for i in range(1, len(ws)) if _cut_here(ws, i)), len(ws))
    words = [w for w in ws[:cut] if w.upper() not in AIR and not re.fullmatch(r"\d+|NO\.?\d*|#\d*", w.upper())]
    # a compass word left at the end with no miles before it: "CROOKSTON NW", "EFFINGHAM SE"
    while len(words) > 1 and words[-1].upper() in DIRS:
        words.pop()
    if words and words[-1].endswith(".") and len(words[-1].rstrip(".")) > 2:
        words[-1] = words[-1].rstrip(".")   # "DERR."; not "ST."
    return _title(words) if words else _title(s.split(" "))


def station_where(raw):
    """Words that place the station: "8 miles west-southwest of Ames",
    "at Des Moines International Airport", "in Ames"."""
    s = _clean(raw)
    o = _offset(s)
    if o and o[2] in DIRS:
        place, n, d = o
        x = float(n)
        # the page's own rule (miles_from): under a mile is "less than a mile"
        far = "less than a mile" if x < 1 else "1 mile" if x == 1 else f"{n} miles"
        return f"{far} {DIRS[d]} of {_title(place.split(' '))}"
    ws = s.upper().split(" ")
    if any(w in AIR for w in ws):
        return "at " + station_name(s)
    if (ws[0] == "UNIVERSITY" and len(ws) > 1) or any(w in NOT_PLACE for w in ws):
        return station_name(s)
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


# ---------------------------------------------------------------- daily values, packed
# data/rain/daily/<st>.json carries each chosen station's days (Jan 1 to its
# as-of day) for the Rain Print drawn on the county page
# (components/rain-county-print.js unpacks it). One token a day, ACIS's own
# reading kept: M, T, S, or the amount in hundredths of an inch with A when it
# covers several days ("125A" is 1.25A). A token repeated 3 or more times in a
# row is written once with *count ("0*12"). Tokens are joined with commas.

def _tok(raw):
    s = str(raw if raw is not None else "M").strip()
    if s in ("M", "", "T", "S"):
        return s or "M"
    a = s.endswith("A")
    try:
        v = float(s.rstrip("A"))
    except ValueError:
        return "M"
    if v < 0 or v != v:
        return "M"
    return str(int(round(v * 100))) + ("A" if a else "")


def pack_days(vals):
    """ACIS daily values -> the packed string."""
    out, i, toks = [], 0, [_tok(v) for v in vals]
    while i < len(toks):
        j = i
        while j < len(toks) and toks[j] == toks[i]:
            j += 1
        out.append(toks[i] + (f"*{j - i}" if j - i >= 3 else ("," + toks[i] if j - i == 2 else "")))
        i = j
    return ",".join(out)


def unpack_days(s):
    """The packed string -> ACIS-style values ("1.25", "1.50A", "T", "S", "M")."""
    out = []
    for t in (s.split(",") if s else []):
        k = 1
        if "*" in t:
            t, k = t.split("*")
            k = int(k)
        if t not in ("M", "T", "S"):
            a = t.endswith("A")
            t = f"{int(t.rstrip('A')) / 100:.2f}" + ("A" if a else "")
        out.extend([t] * k)
    return out


def close_s(parsed):
    """An S run must end in the A value that carries its rain. A run that ends
    in anything else (a plain value, a trace, a gap) has lost that rain, so its
    days are gaps (M), not reported days. A run at the very end is left alone:
    its A has not come in yet (summarize() stops before it)."""
    out = list(parsed)
    i = 0
    while i < len(out):
        if out[i][1] != "S":
            i += 1
            continue
        j = i
        while j < len(out) and out[j][1] == "S":
            j += 1
        if j < len(out) and out[j][1] != "A":
            for k in range(i, j):
                out[k] = (None, "M")
        i = j
    return out


def days_of(year, sdate, n):
    d0 = dt.date.fromisoformat(sdate)
    return [(d0 + dt.timedelta(days=i)).isoformat() for i in range(n)]


def row_values(row):
    """A MultiStnData day row is a list of element values; tolerate a bare value."""
    return row if isinstance(row, list) else [row]


def summarize(year, dates, vals, norms, edate, snows=None):
    """Everything a county page needs from one station's year so far, or a
    reason it does not qualify. dates/vals/norms are parallel (norms may be None);
    snows, the station's snowfall values beside them (None: no snowfall record).
    Returns (summary or None, reason)."""
    parsed = close_s([parse_pcpn(v) for v in vals])
    snowed = [(parse_pcpn(v)[0] or 0) > 0 for v in snows] if snows is not None else []
    # the last day reported; trailing S days wait for the A value that ends them
    last = max((i for i, (v, f) in enumerate(parsed) if v is not None and f != "S"), default=-1)
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
    nv = daily_normals(dates, norms)
    if nv is not None and any(nv[i] is None for i, (v, _) in enumerate(parsed) if v is not None):
        nv = None
    total = usual = 0.0
    trace = acc = unsplit = 0
    months = {}
    cum = []
    best = None
    acc_day = 0.0
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
            if flag == "A":
                # an A total covers the S days before it and its own day: at
                # least one of those days had value / days
                k = i
                while k > 0 and parsed[k - 1][1] == "S":
                    k -= 1
                acc_day = max(acc_day, v / (i - k + 1))
        # a dry day: a measured 0.00, plain or an A total of 0.00, with no snow
        # that day (Rain Print's derive, components/rain-print.js: an A total of
        # 0.00 is several dry days; snow falling is not a dry day, Sig).
        # 2026-10-19: Allerton IA (Wayne County), Feb 7 0.00A then 12 zeros: 13 days.
        if v is not None and flag in ("", "A") and v == 0 and not (i < len(snowed) and snowed[i]):
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
    # a month left out for its gaps whose reported days alone reach the winner's
    # total proves the winner is not the wettest: say nothing rather than that
    if wet and any(x[0] >= wet[1][0] for m, x in enumerate(mlist) if x[3] and x[2] < MIN_SHARE * x[3]):
        wet = None
    # 0.00 on every day for two months or more is a dead gauge, not a dry
    # year, even with no normal to say so (2026-10-13: Swain County NC, 285
    # days at zero; Monticello KY airport, 0.00 while its neighbors had 37 in)
    if total == 0 and reported >= ZERO_YEAR_DAYS:
        return None, f"0.00 on all {reported} days reported"
    usual_r = round(usual, 2) if nv is not None else None
    pct = round(100 * total / usual) if usual_r is not None and usual_r >= PCT_MIN_NORMAL else None
    return {
        "as_of": as_of, "days": n, "reported": reported, "missing": n - reported,
        "trace": trace, "acc": acc, "unsplit": unsplit,
        "total": round(total, 2), "usual": usual_r, "pct": pct,
        "months": mlist,
        "wet_month": [wet[0], wet[1][0]] if wet and wet[1][0] > 0 else None,
        # withheld when a multi-day report proves some day in it beat the
        # biggest one-day reading: that reading is then not the biggest day
        "max_day": list(best) if best and round(acc_day, 2) <= best[1] else None,
        "dry": list(dry) if dry else None,
        "cum": cum,
    }, "ok"


# ---------------------------------------------------------------- stuck gauges

# A run of plain 0.00 days long enough that a usual year would have put 3
# inches or more in the gauge, while the gauges around it caught rain, is a
# stuck, clogged or unread gauge, not a dry spell (2026-10-13: Moultrie GA,
# 61 days at zero from Feb 21 while the stations around it had runs of 19;
# Fort Lauderdale Executive airport, 47 days in Jan and Feb). The gauges
# around it are the check: in the 2026 Texas drought whole regions ran 50 to
# 70 days at zero together, and those runs are real. Desert runs never come
# near 3 inches of usual (Yuma's 59 days from Apr 14 are about 0.14 in).
STUCK_USUAL = 3.0       # inches of usual rain over the run
STUCK_MIN_DAYS = 7      # shorter runs are not looked at
STUCK_NEAR_MI = 40      # gauges this close are the check
STUCK_NEAR_CATCH = 1.0  # their median catch over the run that proves rain fell
STUCK_NEAR_SOME = 0.25  # or this much, with their longest zero run inside it under half of it


def daily_normals(dates, norms):
    """NOAA's daily normal for each day (None where ACIS gave none), Feb 29
    taking Feb 28's. None when there are no normals at all."""
    if norms is None:
        return None
    nv = []
    for i, d in enumerate(dates):
        x, _ = parse_pcpn(norms[i])
        if x is None and d[5:] == "02-29" and i > 0:
            x, _ = parse_pcpn(norms[i - 1])
        nv.append(x)
    return nv


def zero_runs(parsed):
    """(first, last) index of each run of plain 0.00 days. A trace, an S or A
    day, or a gap ends a run, as in the page's dry stretch."""
    out, start = [], None
    for i, (v, f) in enumerate(parsed):
        if v is not None and f == "" and v == 0:
            if start is None:
                start = i
        else:
            if start is not None:
                out.append((start, i - 1))
            start = None
    if start is not None:
        out.append((start, len(parsed) - 1))
    return out


def _median(xs):
    xs = sorted(xs)
    n = len(xs)
    return None if not n else xs[n // 2] if n % 2 else (xs[n // 2 - 1] + xs[n // 2]) / 2


def _span_normal(nv, i, j):
    if nv is None or j >= len(nv) or any(nv[k] is None for k in range(i, j + 1)):
        return None
    return sum(nv[i:j + 1])


def _span_catch(parsed, i, j):
    """Rain over days i..j, or None when under MIN_SHARE of them reported."""
    if j >= len(parsed):
        return None
    got = [v for v, _ in parsed[i:j + 1] if v is not None]
    return sum(got) if len(got) >= MIN_SHARE * (j - i + 1) else None


def _span_longest_zero(parsed, i, j):
    """Longest run of plain 0.00 days inside days i..j, or None when under MIN_SHARE reported."""
    if _span_catch(parsed, i, j) is None:
        return None
    return max((b - a + 1 for a, b in zero_runs(parsed[i:j + 1])), default=0)


def stuck_run(parsed, nv, near):
    """The first run of 0.00 days that a working gauge could not have had, or None.
    parsed: parse_pcpn() of each day; nv: daily_normals() (or None);
    near: [(parsed, nv)] of the gauges within STUCK_NEAR_MI, on the same days.
    Usual over the run is the station's own normals, or the median of the
    nearby gauges' normals when it has none. With 3 in or more of usual, the
    run is stuck when the nearby gauges' median catch over it is 1 in or more,
    or 0.25 in or more with their median longest zero run inside it under half
    its length (2026 Jan-Feb in south Florida: the gauges around Fort
    Lauderdale caught little, but on and off, with runs of 9 to 11 days; that
    airport read 0.00 for 47). A dry spell the gauges around shared is real.
    With no nearby gauge to check against, it is stuck: withheld, not guessed.
    Returns (first, last, usual, nearby catch or None)."""
    for i, j in zero_runs(parsed):
        if j - i + 1 < STUCK_MIN_DAYS:
            continue
        usual = _span_normal(nv, i, j)
        if usual is None:
            usual = _median([u for u in (_span_normal(n, i, j) for _, n in near) if u is not None])
        if usual is None or usual < STUCK_USUAL:
            continue
        catch = _median([c for c in (_span_catch(p, i, j) for p, _ in near) if c is not None])
        if catch is None or catch >= STUCK_NEAR_CATCH:
            return i, j, round(usual, 2), (round(catch, 2) if catch is not None else None)
        their = _median([r for r in (_span_longest_zero(p, i, j) for p, _ in near) if r is not None])
        if catch >= STUCK_NEAR_SOME and their is not None and their < (j - i + 1) / 2:
            return i, j, round(usual, 2), (round(catch, 2) if catch is not None else None)
    return None


def same_date_last_year(as_of):
    d = dt.date.fromisoformat(as_of)
    y = d.year - 1
    day = 28 if (d.month == 2 and d.day == 29) else d.day
    return dt.date(y, d.month, day).isoformat()


def last_year_total(vals, sdate, as_of_last, this=None):
    """Last year, Jan 1 through as_of_last, from that year's values (which
    start at sdate). None unless at least MIN_SHARE of those days reported.

    this: {"MM-DD": this year's raw value} for this year's days through its
    as-of date. With it, "both" counts the days reported in BOTH years, and
    this_both / last_both are each year's rain on just those days: a day one
    year missed adds nothing to either side, so the gaps cannot make one year
    look wetter than the other."""
    n = (dt.date.fromisoformat(as_of_last) - dt.date.fromisoformat(sdate)).days + 1
    vals = list(vals[:n])
    if len(vals) < n:
        vals += ["M"] * (n - len(vals))
    parsed = [v for v, _ in close_s([parse_pcpn(v) for v in vals])]
    rep = sum(1 for v in parsed if v is not None)
    if rep < MIN_SHARE * n:
        return None
    out = {"total": round(sum(v for v in parsed if v is not None), 2), "reported": rep, "days": n, "through": as_of_last}
    if this is not None:
        ks = sorted(this)
        this_p = dict(zip(ks, (v for v, _ in close_s([parse_pcpn(this[k]) for k in ks]))))
        both = tb = lb = 0
        for d, v in zip(days_of(0, sdate, n), parsed):
            t = this_p.get(d[5:])
            if v is not None and t is not None:
                both += 1
                tb += t
                lb += v
        out.update({"both": both, "this_both": round(tb, 2), "last_both": round(lb, 2)})
    return out


HIGH_FT = 1500   # this far above the county's middle station elevation is a mountain site


def snow_site(sids):
    """A SNOTEL snow site (GHCN USS..., or ACIS sid type 17): high in the
    mountains, where the rain is not what the farms below get."""
    return any(str(x).startswith("USS") or str(x).strip().endswith(" 17") for x in (sids or []))


def mark_mountain(cands):
    """Set cand["mountain"] on a county's qualifying stations: a snow site, or
    a station HIGH_FT or more above the median elevation of the county's other
    qualifying stations (snow sites left out of that median). 2026-10-13:
    Pondera MT's Pike Creek SNOTEL read 34.9 in while the plains around it read
    16; Hood River OR, San Juan CO and Franklin ID picked snow sites too."""
    def elev(x):
        return _elev(x.get("meta"))
    low = sorted(e for e in (elev(x) for x in cands if not snow_site((x.get("meta") or {}).get("sids"))) if e is not None)
    mid = (low[len(low) // 2] if len(low) % 2 else (low[len(low) // 2 - 1] + low[len(low) // 2]) / 2) if low else None
    for x in cands:
        e = elev(x)
        x["mountain"] = snow_site((x.get("meta") or {}).get("sids")) or (e is not None and mid is not None and e - mid >= HIGH_FT)
    return cands


# ---------------------------------------------------------------- snowfall

SNOW_MISS_OK = 10   # MISS_OK in components/rain-print.js: at most this many reported days without a snowfall value
SNOW_SLACK_MI = 10  # SNOW_SLACK_MI in components/rain-print.js: how much farther a station may sit for its snowfall record


def snow_state(vals, snows, year):
    """Would a Rain Print of these days draw snow? The engine's rule, step for step
    (components/rain-county-print.js daysOf, then rain-print.js lastRecorded,
    closeOpenS and snowCount). vals, snows: the station's raw daily rain and
    snowfall values from Jan 1. Counted over days with a rain report: at most
    SNOW_MISS_OK of them may lack a snowfall value, and at least 0.1 in must have
    fallen. In a year still going (the days end before Dec 31), the days after
    the last snowfall value have not come in yet and are not counted (2026-10-19:
    Eagle River WI, 70.0 in, missed only Oct 1 to 13 and one March day).
    "drawn", "none" (no snowfall value at all), "gaps" or "little" (under 0.1 in)."""
    sv = [parse_pcpn(x)[0] for x in (snows or [])]
    if not any(x is not None for x in sv):
        return "none"
    pp = [parse_pcpn(x) for x in vals]
    last = max((i for i, (v, f) in enumerate(pp) if v is not None and f != "S"), default=-1)
    pp = pp[:last + 1]
    i = 0
    while i < len(pp):                     # an S run not closed by an A day is missing days
        if pp[i][1] != "S":
            i += 1
            continue
        j = i
        while j < len(pp) and pp[j][1] == "S":
            j += 1
        if not (j < len(pp) and pp[j][1] == "A"):
            pp[i:j] = [(None, "M")] * (j - i)
        i = j
    end = len(pp)
    if dt.date(int(year), 1, 1) + dt.timedelta(days=len(pp) - 1) != dt.date(int(year), 12, 31):
        has = [k for k in range(min(len(pp), len(sv))) if sv[k] is not None]
        if has:
            end = has[-1] + 1
    miss, tot = 0, 0.0
    for k, (v, _f) in enumerate(pp[:end]):
        if v is None:
            continue
        x = sv[k] if k < len(sv) else None
        if x is None:
            miss += 1
        else:
            tot += x
    if miss > SNOW_MISS_OK:
        return "gaps"
    return "drawn" if tot >= 0.1 else "little"


def snow_country(st, lat, elev=None):
    """Where snow is normal: snowCountry in components/rain-print.js, the same map
    test (island states and territories and Florida never; south of 31 N never;
    the low Gulf and South Atlantic coast to 33 N; low Texas and New Mexico south
    of 33 N; the low deserts of California, Arizona and Nevada). elev: feet, None
    when unknown (unknown counts as low)."""
    st = str(st or "").upper()
    if st in ("HI", "PR", "VI", "GU", "AS", "MP", "FL"):
        return False
    try:
        lat = float(lat)
    except (TypeError, ValueError):
        return True
    if lat != lat:
        return True
    if lat < 31:
        return False

    def low(ft):
        return elev is None or elev < ft
    if st in ("LA", "MS", "AL", "GA", "SC") and lat < 33 and low(500):
        return False
    if st in ("TX", "NM") and lat < 33 and low(3000):
        return False
    if st in ("CA", "AZ", "NV") and low(3000):
        return False
    return True


def snow_limit_mi(mi):
    """How far a station may sit and still be taken over a nearer one for its
    snowfall record: snowLimitKm in components/rain-print.js, in miles."""
    return max(mi + SNOW_SLACK_MI, 2 * mi)


def _elev(meta):
    v = (meta or {}).get("elev")
    return float(v) if isinstance(v, (int, float)) or (isinstance(v, str) and re.fullmatch(r"-?\d+(\.\d+)?", v)) else None


def pick_order(cands, st, lat, year):
    """A county's qualifying stations (summary set, mark_mountain run) in pick
    order. rank_key first; then Sig's rule (2026-10-15, the one /rain-print
    follows): where snow is normal (snow_country), when the first pick's
    snowfall record is not whole (snow_state "gaps" or "none"), the nearest
    station that keeps BOTH a full rain record (at most SNOW_MISS_OK days
    missing) and a full snowfall record ("drawn" or "little") is taken instead,
    if it ranks the same on mountain and normals and sits within
    snow_limit_mi of the first pick's distance. 2026-10-19: Story County IA
    took a CoCoRaHS gauge with 95 snowfall gaps; the page's print drew no snow.
    cand["vals"], cand["snows"]: raw daily values from Jan 1."""
    ok = sorted(cands, key=rank_key)
    if not ok:
        return ok

    def whole(x):
        n = x["summary"]["days"]
        return snow_state(x["vals"][:n], (x.get("snows") or [])[:n], year) in ("drawn", "little")
    top = ok[0]
    if not snow_country(st, lat, _elev(top.get("meta"))) or whole(top):
        return ok
    lim, k = snow_limit_mi(top["mi"]), rank_key(top)[:2]
    for x in sorted(ok[1:], key=lambda y: y["mi"]):
        if rank_key(x)[:2] == k and x["mi"] <= lim and x["summary"]["missing"] <= SNOW_MISS_OK and whole(x):
            return [x] + [y for y in ok if y is not x]
    return ok


def rank_key(cand):
    """Pick order inside a county: mountain sites last (mark_mountain), then a
    station with NOAA normals first (the page's answer is "compared with a
    usual year"), then the most days reported, then nearest the middle of the
    county."""
    s = cand["summary"]
    return (1 if cand.get("mountain") else 0, 0 if s["usual"] is not None else 1, -s["reported"], cand["mi"])


# ---------------------------------------------------------------- share images
# One share image per state (img/og/rain-<st>.jpg, drawn by
# scripts/build_share_images.py) and one for /rain (img/og/rain.jpg). These
# give both the drawing and the page builder the same words, so the picture
# and its alt text can't say different things.

UNIT = {"LA": ("parish", "parishes"), "AK": ("borough or census area", "boroughs and census areas")}
TYPICAL_MIN = 5          # fewer counties with a percent than this: no "typical county" figure


def share_image(st=None):
    """Path of the share image for a state's pages (st) or for /rain (None)."""
    return f"img/og/rain-{st.lower()}.jpg" if st else "img/og/rain.jpg"


def _median_pct(ps):
    p = sorted(ps)
    if not p:
        return None
    k = len(p) // 2
    return p[k] if len(p) % 2 else round((p[k - 1] + p[k]) / 2)


def share_facts(d):
    """What a state's share card says, from its data file."""
    cs = d["counties"]
    ps = [c["pct"] for c in cs.values() if c["pct"] is not None]
    st = d["state"]
    return {
        "st": st, "state": STATES[st], "year": d["year"],
        "done": str(d.get("edate", "")).endswith("-12-31"),
        "asof": max(c["as_of"] for c in cs.values()) if cs else None,
        "n": len(cs), "n_pct": len(ps),
        "wetter": sum(1 for p in ps if p > 100), "drier": sum(1 for p in ps if p < 100),
        "typical": _median_pct(ps) if len(ps) >= TYPICAL_MIN else None,
        "unit": UNIT.get(st, ("county", "counties")),
    }


def _md(iso):
    y, m, dd = iso.split("-")
    return f"{MONTHS[int(m) - 1]} {int(dd)}, {y}"


def share_alt(d):
    f = share_facts(d)
    if not f["n"]:
        return f"Rain by county in {f['state']}, from weather stations."
    u1, un = f["unit"]
    s = (f"Map of {f['state']} by {u1}, shaded by rain {'in' if f['done'] else 'so far in'} {f['year']} "
         f"as a percent of a usual year, through {_md(f['asof'])}.")
    if f["n_pct"]:
        s += f" {f['wetter']} of {f['n_pct']} {un if f['n_pct'] != 1 else u1} are wetter than usual"
        s += f", and the typical {u1} is at {f['typical']}%." if f["typical"] is not None else "."
    return s


def share_alt_us(files):
    n = sum(len(d["counties"]) for d in files.values())
    years = sorted({d["year"] for d in files.values()}) or ["this year"]
    asof = max((c["as_of"] for d in files.values() for c in d["counties"].values()), default=None)
    done = bool(files) and all(str(d.get("edate", "")).endswith("-12-31") for d in files.values())
    return (f"Map of the US by county, shaded by rain {'in' if done else 'so far in'} {years[-1]} as a percent of a usual year"
            + (f", through {_md(asof)}" if asof else "") + f": {n:,} counties with a weather station.")
