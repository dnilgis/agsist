#!/usr/bin/env python3
"""
fetch_prf_outlook.py: NOAA's long-range precipitation outlooks, the ENSO
status and the US Drought Monitor, read at every PRF grid -> data/prf/outlook.json

WHY THIS EXISTS
  The /prf page's "Long-range outlook" panel (components/prf-outlook.js) shows,
  for the grid a reader has found, what NOAA's Climate Prediction Center (CPC)
  says about precipitation over the coming seasons, the ENSO alert, and the
  drought category today. It is information beside the calculator, not a
  forecast of the PRF index and not advice on which months to insure.

THE SOURCES (none can be reached from the sandbox this repo is maintained in;
the workflow .github/workflows/prf-outlook.yml runs this on a GitHub runner)
  1. CPC seasonal precipitation outlook, 13 overlapping 3-month seasons
     ("leads" 1 to 13), issued the third Thursday of each month, 8:30 ET.
       NWS map service, one polygon layer per lead (layer id = lead - 1):
         https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/cpc_sea_precip_outlk/MapServer
       fields: fcst_date (date), valid_seas (text), prob (number), cat (text)
       asked for as GeoJSON with /<layer>/query?where=1=1&outFields=*&f=geojson
     Fallback if that service fails: CPC's own shapefile zips listed at
       https://ftp.cpc.ncep.noaa.gov/GIS/us_tempprcpfcst/
     read by the small shapefile reader below (no GIS library on the runner).
  2. CPC one-month precipitation outlook (the next month), issued with the
     seasonal one and updated on the last day of the month:
         .../outlooks/cpc_mthly_precip_outlk/MapServer (same fields)
  3. ENSO: the alert status and synopsis from the ENSO Diagnostic Discussion
       https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso_advisory/ensodisc.shtml
     and the official probability table (La Nina / Neutral / El Nino by season)
       https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso/roni/probabilities.php
     Both are issued the second Thursday of each month.
  4. US Drought Monitor (NDMC, UNL), the weekly map as GeoJSON, property DM
     (0 = D0 abnormally dry ... 4 = D4 exceptional):
       https://droughtmonitor.unl.edu/data/json/usdm_<YYYYMMDD>.json
     <YYYYMMDD> is the map's valid Tuesday; it is released Thursday. The dated
     file is asked for, newest Tuesday first, so the map date is known and not
     guessed. Fallback: the dated shapefile
       https://droughtmonitor.unl.edu/data/shapefiles_m/USDM_<YYYYMMDD>_M.zip
     No repo file carries the current USDM category: /drought-monitor shows
     USDM's own images and data/outlooks/ holds a PNG, so this reads the map.

HOW A GRID GETS ITS VALUE
  Each of the 13,414 PRF grids (the keys of data/prf/g/*.json) is read at its
  centre point, a quarter degree box from fetch_prf.py's numbering (row x 300 +
  column + 1 from 20N 130W). Where polygons overlap, the strongest call wins
  (CPC and USDM both draw higher categories inside lower ones in some files).
  CPC map convention: an area with no polygon is "equal chances" only when the
  layer itself draws no EC polygons; if it does, an uncovered point is "-"
  (no data) and the page says so. USDM: no polygon = no drought category.

THE CODES (one per grid and product)
  B4 = below normal favoured, CPC's 40 to 50% band; A3 = above, 33 to 40%;
  N5 = near normal, 50 to 60%; E = equal chances; "-" = no data at this grid.
  The digit is CPC's band floor / 10 (3 = 33 to 40, 4 = 40 to 50 ... 9 = 90 to
  100). CPC's prob field is the band's lower edge; that is all a polygon says.
  Drought: N = none, 0..4 = D0..D4.

SIZE (CLAUDE.md budget)
  Grids are stored per row as runs: [first column, run, call index, run, call
  index, ...] into a short list of distinct calls. Neighbouring grids share a
  call, so a real outlook is tens of KB for all 13,414 grids, not 13,414
  records. The fetch refuses to write past MAX_BYTES and says so.

WHEN A FETCH FAILS
  Each section (seasonal, monthly, enso, drought) stands alone with its own
  issued date. A section that fails, comes back thin (fewer than MIN_COVERED of
  grids with a value) or is older than the one already published keeps the
  published one. The page withholds any section past its own age limit, so a
  dead source shows as withheld, never as a current outlook.
  Every request has a 60 s socket timeout and at most 3 tries; ArcGIS paging
  stops at MAX_PAGES or on a page that repeats; the four sources run side by
  side, each under SOURCE_BUDGET seconds, all under TOTAL_BUDGET, so a source
  that hangs is reported and skipped and the run ends in about 4 minutes at
  worst.

USAGE
  python scripts/fetch_prf_outlook.py --selftest     # offline, fixtures in test/fixtures/prf-outlook/
  python scripts/fetch_prf_outlook.py                # fetch, write data/prf/outlook.json when it changes
  python scripts/fetch_prf_outlook.py --check        # the published file is well formed
  python scripts/fetch_prf_outlook.py --fixture-doc  # rebuild the page tests' sample file from the fixtures
"""

import datetime as dt
import glob
from html import unescape as html_unescape
import io
import json
import math
import os
import re
import struct
import sys
import threading
import time
import urllib.parse
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = "data/prf/outlook.json"
FIX = os.path.join(ROOT, "test", "fixtures", "prf-outlook")
UA = "AGSIST-PRF-Outlook/1 (+https://agsist.com/prf)"
TIMEOUT = 60

MAPS = os.environ.get("PRF_OUTLOOK_MAPS", "https://mapservices.weather.noaa.gov/vector/rest/services/outlooks/")
SEAS_SVC = MAPS + "cpc_sea_precip_outlk/MapServer"
MON_SVC = MAPS + "cpc_mthly_precip_outlk/MapServer"
CPC_GIS = "https://ftp.cpc.ncep.noaa.gov/GIS/us_tempprcpfcst/"
ENSO_DISC = "https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso_advisory/ensodisc.shtml"
ENSO_PROBS = "https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso/roni/probabilities.php"
USDM_JSON = "https://droughtmonitor.unl.edu/data/json/usdm_{d}.json"
USDM_SHP = "https://droughtmonitor.unl.edu/data/shapefiles_m/USDM_{d}_M.zip"
LINKS = {
    "cpc_seasonal": "https://www.cpc.ncep.noaa.gov/products/predictions/long_range/seasonal.php?lead=1",
    "cpc_monthly": "https://www.cpc.ncep.noaa.gov/products/predictions/long_range/lead14/",
    "cpc_enso": ENSO_DISC,
    "usdm": "https://droughtmonitor.unl.edu/",
}

LAT0, LON0, STEP, COLS = 20.0, -130.0, 0.25, 300
MIN_COVERED = 0.95      # share of grids that must get a value, or the section is refused
MAX_BYTES = 400_000     # the whole file; data/ has a 300 MB budget and this is one file
SEASONS = ["JFM", "FMA", "MAM", "AMJ", "MJJ", "JJA", "JAS", "ASO", "SON", "OND", "NDJ", "DJF"]
MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]


_log_lock = threading.Lock()


def log(*a):
    with _log_lock:             # sources log from their own threads
        print(*a, flush=True)


# ------------------------------------------------------------------ fetching
# The first run on a runner (Oct 2026) was cancelled at the 20-minute job limit
# with nothing logged. Every request now has a socket timeout, a capped number
# of tries and a size cap, and runs under its source's deadline; pagination is
# capped; and each source runs against a budget, so a slow or dead source is
# skipped (its published section kept) and the others still write.
TRIES = 3
MAX_DOWNLOAD = 150_000_000      # bytes, any one response
MAX_PAGES = 40                  # ArcGIS query pages per layer
SOURCE_BUDGET = 150             # seconds, any one source, network and mapping
TOTAL_BUDGET = 240              # seconds, every source together (they run side by side)
_tl = threading.local()


class Timeout(RuntimeError):
    pass


def remaining():
    d = getattr(_tl, "deadline", None)
    return None if d is None else d - time.monotonic()


def check_deadline(what=""):
    r = remaining()
    if r is not None and r <= 0:
        raise Timeout("out of time for this source%s" % ((" at " + what) if what else ""))


def get(url, tries=TRIES):
    last = None
    for i in range(tries):
        check_deadline(url)
        try:
            to = TIMEOUT if remaining() is None else max(1, min(TIMEOUT, remaining()))
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
            with urllib.request.urlopen(req, timeout=to) as r:
                buf = bytearray()
                while True:
                    check_deadline(url)        # a server that trickles bytes is cut off too
                    chunk = r.read1(1 << 20)    # what has arrived, not a full MB (read() would wait for it)
                    if not chunk:
                        break
                    buf += chunk
                    if len(buf) > MAX_DOWNLOAD:
                        raise RuntimeError("over %d bytes" % MAX_DOWNLOAD)
                return bytes(buf)
        except Timeout:
            raise
        except Exception as e:      # noqa: BLE001 - every failure is retried, then reported
            last = e
            if getattr(e, "code", None) == 404 or "over %d bytes" % MAX_DOWNLOAD in str(e):
                break
            if i + 1 < tries:
                r = remaining()
                time.sleep(min(3 * (i + 1), max(0, r - 1)) if r is not None else 3 * (i + 1))
    raise RuntimeError("%s: %s" % (url, last))


def arcgis_layers(svc, fetch=get):
    d = json.loads(fetch(svc + "?f=json"))
    return [(l["id"], l.get("name", "")) for l in d.get("layers", [])]


def feature_key(f):
    p = f.get("properties") or {}
    k = f.get("id", prop(p, "objectid", "fid", "oid"))
    return k if k is not None else json.dumps(p, sort_keys=True)[:200]


def arcgis_features(layer_url, fetch=get, max_pages=MAX_PAGES):
    """Every feature of a layer, paged with resultOffset. Stops with an error
    on a page that adds nothing new (a server that ignores resultOffset would
    otherwise answer the same page for ever) or past max_pages."""
    out, seen, offset = [], set(), 0
    for page in range(max_pages):
        q = urllib.parse.urlencode({"where": "1=1", "outFields": "*", "returnGeometry": "true",
                                    "outSR": "4326", "f": "geojson", "resultOffset": offset})
        d = json.loads(fetch(layer_url + "/query?" + q))
        if "error" in d:
            raise RuntimeError("%s: %s" % (layer_url, d["error"]))
        feats = d.get("features", [])
        keys = [feature_key(f) for f in feats]
        if page and feats and all(k in seen for k in keys):
            raise RuntimeError("%s: page at offset %d repeats earlier features (resultOffset ignored)" % (layer_url, offset))
        seen.update(keys)
        out += feats
        more = d.get("exceededTransferLimit") or (d.get("properties") or {}).get("exceededTransferLimit")
        if not more or not feats:
            return out
        offset += len(feats)
    raise RuntimeError("%s: more than %d pages" % (layer_url, max_pages))


def vertex_count(features):
    return sum(len(r) for f in features for rings in rings_of(f.get("geometry")) for r in rings)


# ------------------------------------------------- shapefile, read by hand
def read_shp(b):
    """Polygons (type 5) from a .shp, as a list of ring lists. Null shapes -> []."""
    out, pos = [], 100
    while pos + 8 <= len(b):
        _, clen = struct.unpack(">ii", b[pos:pos + 8])
        rec = b[pos + 8: pos + 8 + clen * 2]
        pos += 8 + clen * 2
        st = struct.unpack("<i", rec[:4])[0]
        if st not in (5, 15, 25):
            out.append([])
            continue
        nparts, npts = struct.unpack("<ii", rec[36:44])
        parts = list(struct.unpack("<%di" % nparts, rec[44:44 + 4 * nparts]))
        p0 = 44 + 4 * nparts
        pts = [struct.unpack("<dd", rec[p0 + 16 * i: p0 + 16 * i + 16]) for i in range(npts)]
        parts.append(npts)
        out.append([pts[parts[i]:parts[i + 1]] for i in range(nparts)])
    return out


def read_dbf(b):
    n, hlen, rlen = struct.unpack("<IHH", b[4:12])
    fields, p = [], 32
    while b[p] != 0x0D:
        name = b[p:p + 11].split(b"\0")[0].decode("latin-1")
        fields.append((name, chr(b[p + 11]), b[p + 16]))
        p += 32
    rows = []
    for i in range(n):
        r = b[hlen + i * rlen: hlen + (i + 1) * rlen]
        if r[:1] == b"*":
            continue
        o, row = 1, {}
        for name, typ, ln in fields:
            v = r[o:o + ln].decode("latin-1").strip()
            o += ln
            if typ in "NF":
                try:
                    v = float(v) if v else None
                except ValueError:
                    v = None
            row[name] = v
        rows.append(row)
    return rows


def zip_layers(zb):
    """{shapefile base name: [geojson-like features]} from a zip of shapefiles."""
    z = zipfile.ZipFile(io.BytesIO(zb))
    names = {n.lower(): n for n in z.namelist()}
    out = {}
    for low, n in names.items():
        if not low.endswith(".shp"):
            continue
        base = low[:-4]
        dbf = names.get(base + ".dbf")
        if not dbf:
            continue
        polys, rows = read_shp(z.read(n)), read_dbf(z.read(dbf))
        feats = [{"properties": rows[i] if i < len(rows) else {},
                  "geometry": {"type": "Polygon_rings", "rings": polys[i]}} for i in range(len(polys))]
        out[os.path.basename(base)] = feats
    return out


# --------------------------------------------------------------- geometry
def rings_of(geom):
    """Every polygon in a feature as a list of rings (outer and holes)."""
    t = (geom or {}).get("type")
    c = (geom or {}).get("coordinates")
    if t == "Polygon":
        return [c]
    if t == "MultiPolygon":
        return list(c)
    if t == "Polygon_rings":         # shapefile: all rings of one record, even-odd
        return [geom["rings"]] if geom["rings"] else []
    return []


def prep(features, value):
    """[(bbox, rings, value)] with value(props) -> comparable or None (skip)."""
    out = []
    for f in features:
        v = value(f.get("properties") or {})
        if v is None:
            continue
        for rings in rings_of(f.get("geometry")):
            xs = [p[0] for r in rings for p in r]
            ys = [p[1] for r in rings for p in r]
            if xs:
                out.append(((min(xs), min(ys), max(xs), max(ys)), rings, v))
    return out


def inside(rings, x, y):
    """Even-odd over every ring, so holes are holes."""
    c = False
    for r in rings:
        n = len(r)
        j = n - 1
        for i in range(n):
            xi, yi = r[i][0], r[i][1]
            xj, yj = r[j][0], r[j][1]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                c = not c
            j = i
    return c


def centre(gid):
    row, col = (gid - 1) // COLS, (gid - 1) % COLS
    return LON0 + (col + 0.5) * STEP, LAT0 + (row + 0.5) * STEP


def raster_rows(rings, row0, row1):
    """{row: [(first col, last col), ...]} of the grid centres inside one polygon
    (all its rings, even-odd), for rows row0..row1. A scanline fill on the
    quarter-degree lattice: every edge is visited once and only the rows it
    crosses get its crossing, so the cost is the vertices plus the crossings,
    not grids x vertices. It answers what inside() answers at each centre: the
    same crossing test and the same arithmetic, so the two agree to the bit."""
    xs = {}
    for r in rings:
        n = len(r)
        j = n - 1
        for i in range(n):
            xi, yi = r[i][0], r[i][1]
            xj, yj = r[j][0], r[j][1]
            j = i
            if yi == yj:
                continue
            lo, hi = (yi, yj) if yi < yj else (yj, yi)
            a = max(row0, int(math.floor((lo - LAT0) / STEP - 0.5)))
            b = min(row1, int(math.ceil((hi - LAT0) / STEP - 0.5)))
            for row in range(a, b + 1):
                y = LAT0 + (row + 0.5) * STEP
                if (yi > y) != (yj > y):
                    xs.setdefault(row, []).append((xj - xi) * (y - yi) / (yj - yi) + xi)
    out = {}
    for row, cs in xs.items():
        cs.sort()
        spans = []
        for k in range(0, len(cs) - 1, 2):
            # inside(): odd number of crossings strictly right of x, i.e. cs[k] <= x < cs[k+1]
            c0 = max(0, int(math.ceil((cs[k] - LON0) / STEP - 0.5)) - 1)
            c1 = min(COLS - 1, int(math.ceil((cs[k + 1] - LON0) / STEP - 0.5)))
            while c0 <= c1 and LON0 + (c0 + 0.5) * STEP < cs[k]:
                c0 += 1
            while c1 >= c0 and not (LON0 + (c1 + 0.5) * STEP < cs[k + 1]):
                c1 -= 1
            if c0 <= c1:
                spans.append((c0, c1))
        if spans:
            out[row] = spans
    return out


def sample(polys, grids, rank, empty):
    """Value at each grid's centre: the polygon with the highest rank wins.
    Each polygon is rasterised to the grid lattice (raster_rows) inside the
    rows that hold PRF grids; a 13,414-grid read of a detailed map takes
    seconds where testing every centre against every polygon took minutes."""
    want = {}
    for g in grids:
        want.setdefault((g - 1) // COLS, set()).add((g - 1) % COLS)
    if not want:
        return {}
    rmin, rmax = min(want), max(want)
    best = {}
    for (x0, y0, x1, y1), rings, v in polys:
        rv = rank(v)
        for row, spans in raster_rows(rings, rmin, rmax).items():
            cols = want.get(row)
            if not cols:
                continue
            base = row * COLS + 1
            for c0, c1 in spans:
                if c1 - c0 + 1 > len(cols):
                    hit = [c for c in cols if c0 <= c <= c1]
                else:
                    hit = [c for c in range(c0, c1 + 1) if c in cols]
                for c in hit:
                    g = base + c
                    b = best.get(g)
                    if b is None or rv > b[0]:
                        best[g] = (rv, v)
    return {g: best[g][1] if g in best else empty for g in grids}


def sample_slow(polys, grids, rank, empty):
    """The plain point-in-polygon read sample() replaced; the selftest checks
    the two agree."""
    out = {}
    for g in grids:
        x, y = centre(g)
        found = None
        for (x0, y0, x1, y1), rings, v in polys:
            if x0 <= x <= x1 and y0 <= y <= y1 and inside(rings, x, y):
                if found is None or rank(v) > rank(found):
                    found = v
        out[g] = found if found is not None else empty
    return out


def encode(values, grids):
    """{row: [first col, run, idx, run, idx ...]}, calls list. Columns between two
    PRF grids in a row extend the run (they are never asked for)."""
    calls, index, rows = [], {}, {}
    byrow = {}
    for g in sorted(grids):
        byrow.setdefault((g - 1) // COLS, []).append(g)
    for row, gs in byrow.items():
        c0 = (gs[0] - 1) % COLS
        seq, prev_col, cur = [], c0 - 1, None
        for g in gs:
            col = (g - 1) % COLS
            v = values[g]
            if v not in index:
                index[v] = len(calls)
                calls.append(v)
            k = index[v]
            span = col - prev_col
            if seq and seq[-1][1] == k:
                seq[-1][0] += span
            else:
                if seq and span > 1:
                    seq[-1][0] += span - 1
                seq.append([1, k])
            prev_col = col
        flat = [c0]
        for n, k in seq:
            flat += [n, k]
        rows[str(row)] = flat
    return calls, rows


def decode(section, gid):
    row, col = (gid - 1) // COLS, (gid - 1) % COLS
    r = section["rows"].get(str(row))
    if not r:
        return None
    c = r[0]
    for i in range(1, len(r), 2):
        if c <= col < c + r[i]:
            return section["calls"][r[i + 1]]
        c += r[i]
    return None


# ----------------------------------------------------------- CPC outlooks
def norm_cat(v):
    s = str(v or "").strip().lower()
    if not s:
        return None
    if s.startswith("ec") or "equal" in s:
        return "E"
    if s.startswith("a"):
        return "A"
    if s.startswith("b"):
        return "B"
    if s.startswith("n"):
        return "N"
    return None


def prop(p, *names):
    low = {k.lower(): v for k, v in p.items()}
    for n in names:
        if n in low and low[n] not in (None, ""):
            return low[n]
    return None


def cpc_code(p):
    cat = norm_cat(prop(p, "cat", "category"))
    if cat is None:
        return None
    if cat == "E":
        return "E"
    pr = prop(p, "prob", "probability")
    try:
        pr = float(pr)
    except (TypeError, ValueError):
        return None
    if pr < 1:                     # a fraction, not a percent
        pr *= 100
    if pr < 33:
        return "E"
    return cat + str(min(9, max(3, int(pr // 10))))


def code_rank(c):
    if c in (None, "-"):
        return -1
    if c == "E":
        return 0
    return int(c[1:])


def parse_date(v):
    """fcst_date as epoch ms, YYYYMMDD, YYYY-MM-DD or M/D/YYYY -> date."""
    if v is None:
        return None
    if isinstance(v, (int, float)) and abs(v) > 1e11:
        return dt.datetime.fromtimestamp(v / 1000, dt.timezone.utc).date()
    s = str(v).strip()
    m = re.match(r"(\d{4})-?(\d{2})-?(\d{2})", s)
    if m:
        return dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", s)
    if m:
        return dt.date(int(m.group(3)), int(m.group(1)), int(m.group(2)))
    return None


def ym_add(y, m, k):
    t = y * 12 + (m - 1) + k
    return t // 12, t % 12 + 1


def season_for(issued, lead, label):
    """(start 'YYYY-MM', end 'YYYY-MM', code). CPC's lead L season starts L
    months after the issue month (mid-month issue, half-month lead). The
    letters in valid_seas, when present, must agree, else they decide and the
    year is the one that puts the start 0 to 14 months after the issue."""
    y, m = ym_add(issued.year, issued.month, lead)
    letters = re.search(r"\b([A-Z]{3})\b", str(label or "").upper())
    code = letters.group(1) if letters and letters.group(1) in SEASONS else None
    if code and SEASONS.index(code) + 1 != m:
        want = SEASONS.index(code) + 1
        for k in range(0, 15):
            yy, mm = ym_add(issued.year, issued.month, k)
            if mm == want:
                y, m = yy, mm
                break
    ey, em = ym_add(y, m, 2)
    return "%04d-%02d" % (y, m), "%04d-%02d" % (ey, em), SEASONS[m - 1]


def month_for(issued, label):
    y, m = ym_add(issued.year, issued.month, 1)
    letters = re.search(r"\b([A-Z]{3})", str(label or "").upper())
    if letters and letters.group(1) in MONTHS and MONTHS.index(letters.group(1)) + 1 != m:
        want = MONTHS.index(letters.group(1)) + 1
        for k in range(0, 3):
            yy, mm = ym_add(issued.year, issued.month, k)
            if mm == want:
                y, m = yy, mm
                break
    return "%04d-%02d" % (y, m)


def layer_values(features, grids):
    """codes per grid for one CPC layer, and the layer's issue date and label."""
    has_ec = any(norm_cat(prop(f.get("properties") or {}, "cat", "category")) == "E" for f in features)
    polys = prep(features, cpc_code)
    vals = sample(polys, grids, code_rank, "-" if has_ec else "E")
    p0 = features[0].get("properties") or {} if features else {}
    issued = None
    for f in features:
        issued = parse_date(prop(f.get("properties") or {}, "fcst_date", "fcstdate", "issued"))
        if issued:
            break
    label = prop(p0, "valid_seas", "validseas", "season", "valid_month")
    return vals, issued, label, ("polygons" if has_ec else "unshaded")


def covered(vals):
    n = len(vals)
    return sum(1 for v in vals.values() if v not in (None, "-")) / n if n else 0


def build_seasonal(layers, grids, source):
    """layers: {lead: features}. -> section, or raises with the reason."""
    leads, perlead, issued_all, ec = [], {}, set(), set()
    for lead in sorted(layers):
        vals, issued, label, ecr = layer_values(layers[lead], grids)
        if not issued:
            raise RuntimeError("lead %d has no fcst_date" % lead)
        if covered(vals) < MIN_COVERED:
            raise RuntimeError("lead %d covers %.1f%% of grids" % (lead, 100 * covered(vals)))
        issued_all.add(issued)
        ec.add(ecr)
        s, e, code = season_for(issued, lead, label)
        leads.append({"lead": lead, "season": code, "start": s, "end": e})
        perlead[lead] = vals
    if len(issued_all) != 1:
        raise RuntimeError("leads carry different issue dates: %s" % sorted(map(str, issued_all)))
    if not leads:
        raise RuntimeError("no leads")
    joined = {g: ".".join(perlead[l["lead"]][g] for l in leads) for g in grids}
    calls, rows = encode(joined, grids)
    return {"issued": issued_all.pop().isoformat(), "source": source, "link": LINKS["cpc_seasonal"],
            "ec": sorted(ec)[0] if len(ec) == 1 else "mixed",
            "leads": leads, "calls": calls, "rows": rows}


def build_monthly(features, grids, source):
    vals, issued, label, ecr = layer_values(features, grids)
    if not issued:
        raise RuntimeError("monthly outlook has no fcst_date")
    if covered(vals) < MIN_COVERED:
        raise RuntimeError("monthly outlook covers %.1f%% of grids" % (100 * covered(vals)))
    calls, rows = encode(vals, grids)
    return {"issued": issued.isoformat(), "month": month_for(issued, label), "source": source,
            "link": LINKS["cpc_monthly"], "ec": ecr, "calls": calls, "rows": rows}


def lead_of(name, i):
    m = re.search(r"lead\s*_?(\d+)", name, re.I)
    return int(m.group(1)) if m else i + 1


def fetch_seasonal(grids, fetch=get):
    try:
        layers = {}
        for lid, name in arcgis_layers(SEAS_SVC, fetch):
            lead = lead_of(name, lid)
            if 1 <= lead <= 13:
                t = time.monotonic()
                layers[lead] = arcgis_features("%s/%d" % (SEAS_SVC, lid), fetch)
                log("  seasonal: lead %d, %d features, %d vertices, %.1fs"
                    % (lead, len(layers[lead]), vertex_count(layers[lead]), time.monotonic() - t))
        if len(layers) < 13:
            raise RuntimeError("only %d of 13 leads in the map service" % len(layers))
        t = time.monotonic()
        sec = build_seasonal(layers, grids, SEAS_SVC)
        log("  seasonal: %d leads read at %d grids, %.1fs" % (len(layers), len(grids), time.monotonic() - t))
        return sec
    except Exception as e:      # noqa: BLE001
        log("  seasonal: map service failed (%s); trying CPC's shapefiles" % e)
    zb, url = newest_zip(r"seas\w*prcp\w*?(\d{6})\.zip", fetch)
    by = zip_layers(zb)
    layers = {lead_of(n, i): f for i, (n, f) in enumerate(sorted(by.items()))}
    return build_seasonal({k: v for k, v in layers.items() if 1 <= k <= 13}, grids, url)


def fetch_monthly(grids, fetch=get):
    try:
        lid = arcgis_layers(MON_SVC, fetch)[0][0]
        t = time.monotonic()
        feats = arcgis_features("%s/%d" % (MON_SVC, lid), fetch)
        log("  monthly: %d features, %d vertices, %.1fs" % (len(feats), vertex_count(feats), time.monotonic() - t))
        return build_monthly(feats, grids, MON_SVC)
    except Exception as e:      # noqa: BLE001
        log("  monthly: map service failed (%s); trying CPC's shapefiles" % e)
    zb, url = newest_zip(r"month\w*prcp\w*?(\d{6})\.zip", fetch)
    by = zip_layers(zb)
    return build_monthly(next(iter(by.values())), grids, url)


def newest_zip(pattern, fetch=get):
    idx = fetch(CPC_GIS).decode("latin-1", "replace")
    found = sorted(set(re.findall(r'href="([^"]*?%s)"' % pattern, idx, re.I)), key=lambda t: (t[1], "upd" in t[0].lower()))
    if not found:
        raise RuntimeError("no file like %s in %s" % (pattern, CPC_GIS))
    url = urllib.parse.urljoin(CPC_GIS, found[-1][0])
    return fetch(url), url


# ------------------------------------------------------------------- ENSO
def text_of(html):
    t = re.sub(r"(?is)<(script|style).*?</\1>", " ", html)
    t = re.sub(r"(?i)<br\s*/?>|</p>|</tr>|</h\d>|</div>", "\n", t)
    t = re.sub(r"<[^>]+>", " ", t)
    # every entity, not a hand list: CPC writes "83&#37; chance" (ENSO discussion, Oct 8, 2026)
    t = html_unescape(t).replace("\xa0", " ").replace("ñ", "n").replace("Ñ", "N")
    return re.sub(r"[ \t]+", " ", t)


def parse_enso_disc(html):
    t = text_of(html)
    st = re.search(r"ENSO Alert System Status:\s*([^\n]+)", t)
    if not st:
        raise RuntimeError("no ENSO Alert System Status line")
    status = re.sub(r"\s+", " ", st.group(1)).strip().rstrip(".")
    MON = r"(January|February|March|April|May|June|July|August|September|October|November|December)"
    when = re.search(r"issued by.{0,300}?\b(\d{1,2})\s+" + MON + r"\s+(\d{4})", t, re.S | re.I) or re.search(r"\b(\d{1,2})\s+" + MON + r"\s+(\d{4})", t)
    if not when:
        raise RuntimeError("no issue date")
    issued = dt.datetime.strptime(" ".join(when.groups()), "%d %B %Y").date()
    syn = re.search(r"Synopsis:\s*(.+?)(?:\n\s*\n|$)", t, re.S)
    synopsis = re.sub(r"\s+", " ", syn.group(1)).strip() if syn else None
    return {"status": status, "issued": issued.isoformat(), "synopsis": synopsis}


def parse_enso_probs(html):
    """Rows of the official table: season, La Nina, Neutral, El Nino (percent).
    Column order is read from the header, not assumed."""
    t = text_of(html)
    order = []
    for m in re.finditer(r"La Nina|Neutral|El Nino", t, re.I):
        k = m.group(0).lower()
        k = "la" if k.startswith("la") else "el" if k.startswith("el") else "neutral"
        if k not in order:
            order.append(k)
        if len(order) == 3:
            break
    if len(order) != 3:
        raise RuntimeError("probability table header not found")
    rows = []
    for m in re.finditer(r"\b(%s)\b[^\n\d]*(\d{1,3})\s*%%?[^\n\d]*(\d{1,3})\s*%%?[^\n\d]*(\d{1,3})\s*%%?" % "|".join(SEASONS), t):
        vals = [int(m.group(i)) for i in (2, 3, 4)]
        if not 98 <= sum(vals) <= 102:
            continue
        row = {"season": m.group(1)}
        row.update(dict(zip(order, vals)))
        rows.append(row)
    if len(rows) < 3:
        raise RuntimeError("only %d probability rows" % len(rows))
    iss = re.search(r"Issued:?\s*(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})", t, re.I)
    return {"month": dt.datetime.strptime(" ".join(iss.groups()), "%B %Y").strftime("%Y-%m") if iss else None,
            "rows": rows}


def fetch_enso(fetch=get):
    sec = parse_enso_disc(fetch(ENSO_DISC).decode("utf-8", "replace"))
    sec.update({"source": ENSO_DISC, "link": LINKS["cpc_enso"]})
    try:
        p = parse_enso_probs(fetch(ENSO_PROBS).decode("utf-8", "replace"))
        # rule 8: the table is shown only when it is the same month's issue
        if p["month"] and p["month"] == sec["issued"][:7]:
            sec["probs"] = p["rows"]
            sec["probs_source"] = ENSO_PROBS
        else:
            log("  enso: probability table is %s, discussion is %s; table left out" % (p["month"], sec["issued"][:7]))
    except Exception as e:      # noqa: BLE001
        log("  enso: probability table not read (%s)" % e)
    return sec


# ------------------------------------------------------------------- USDM
def dm_value(p):
    v = prop(p, "dm", "category", "dm_cat")
    try:
        v = int(float(str(v).upper().lstrip("D")))
    except (TypeError, ValueError):
        return None
    return v if 0 <= v <= 4 else None


def build_drought(features, grids, map_date, source):
    polys = prep(features, dm_value)
    if not polys:
        raise RuntimeError("no drought polygons")
    vals = sample(polys, grids, lambda v: -1 if v == "N" else v, "N")
    vals = {g: str(v) for g, v in vals.items()}
    calls, rows = encode(vals, grids)
    return {"map_date": map_date.isoformat(), "released": (map_date + dt.timedelta(days=2)).isoformat(),
            "source": source, "link": LINKS["usdm"], "calls": calls, "rows": rows}


def recent_tuesdays(today, n=3):
    d = today - dt.timedelta(days=(today.weekday() - 1) % 7)
    return [d - dt.timedelta(days=7 * i) for i in range(n)]


def fetch_drought(grids, today, fetch=get):
    errs = []
    for d in recent_tuesdays(today):
        if d + dt.timedelta(days=2) > today:
            continue                 # released Thursday; not out yet
        k = d.strftime("%Y%m%d")
        try:
            t = time.monotonic()
            gj = json.loads(fetch(USDM_JSON.format(d=k)))
            log("  drought: %s map, %d features, %d vertices, %.1fs"
                % (k, len(gj.get("features", [])), vertex_count(gj.get("features", [])), time.monotonic() - t))
            return build_drought(gj.get("features", []), grids, d, USDM_JSON.format(d=k))
        except Exception as e:      # noqa: BLE001
            errs.append(str(e))
        try:
            by = zip_layers(fetch(USDM_SHP.format(d=k)))
            return build_drought(next(iter(by.values())), grids, d, USDM_SHP.format(d=k))
        except Exception as e:      # noqa: BLE001
            errs.append(str(e))
    raise RuntimeError("no Drought Monitor map: " + "; ".join(errs[-2:]))


# ------------------------------------------------------------------ assembly
def load_grids():
    gs = set()
    for f in glob.glob(os.path.join(ROOT, "data", "prf", "g", "*.json")):
        gs.update(int(k) for k in json.load(open(f))["g"])
    return sorted(gs)


def crop_year():
    try:
        return json.load(open(os.path.join(ROOT, "data", "prf", "meta.json")))["crop_year"]
    except Exception:           # noqa: BLE001
        return None


def stamp(sec):
    return sec.get("issued") or sec.get("map_date") or ""


def merge(prev, new, failed):
    """Per section: keep the published one when the new one failed or is older."""
    out = {}
    for k in ("seasonal", "monthly", "enso", "drought"):
        p, n = (prev or {}).get(k), new.get(k)
        if n and (not p or stamp(n) >= stamp(p)):
            out[k] = n
        elif p:
            out[k] = p
            if n:
                log("  %s: fetched %s is older than published %s; kept the published one" % (k, stamp(n), stamp(p)))
            else:
                log("  %s: kept the published one (%s): %s" % (k, stamp(p), failed.get(k, "")))
    return out


def assemble(sections, cy, now):
    doc = {"v": 1, "built": now, "crop_year": cy,
           "grid": {"lat0": LAT0, "lon0": LON0, "step": STEP, "cols": COLS, "point": "centre"},
           "note": "Read at each PRF grid's center. Codes: B/A/N + CPC band floor/10 (B4 = below normal favored, 40 to 50%), E = equal chances, - = no data; drought N = none, 0-4 = D0-D4. Written by scripts/fetch_prf_outlook.py."}
    doc.update(sections)
    return doc


def dumps(doc):
    return json.dumps(doc, separators=(",", ":"), ensure_ascii=False, sort_keys=False) + "\n"


def check_doc(doc, grids=None):
    errs = []
    if doc.get("v") != 1:
        errs.append("v")
    for k in ("seasonal", "monthly", "drought"):
        s = doc.get(k)
        if not s:
            continue
        if not s.get("calls") or not s.get("rows"):
            errs.append(k + " has no calls/rows")
        for r in s.get("rows", {}).values():
            if any(not (0 <= r[i + 1] < len(s["calls"])) for i in range(1, len(r), 2)):
                errs.append(k + " call index out of range")
                break
    s = doc.get("seasonal")
    if s:
        if [l["lead"] for l in s["leads"]] != list(range(1, len(s["leads"]) + 1)):
            errs.append("seasonal leads not 1..n")
        if any(len(c.split(".")) != len(s["leads"]) for c in s["calls"]):
            errs.append("seasonal call length != leads")
    if grids:
        for k in ("seasonal", "monthly", "drought"):
            if doc.get(k):
                miss = sum(1 for g in grids if decode(doc[k], g) is None)
                if miss:
                    errs.append("%s: %d grids with no value" % (k, miss))
    return errs


def run(grids, today, now, fetchers, prev, budget=SOURCE_BUDGET, total=TOTAL_BUDGET):
    """Every source side by side, each in its own thread under its own deadline
    (budget seconds); whatever has not answered when total seconds are up is
    marked failed and left behind, so the published section is kept for it."""
    new, failed, took = {}, {}, {}
    t0 = time.monotonic()

    def one(k, fn):
        _tl.deadline = time.monotonic() + budget
        t = time.monotonic()
        try:
            new[k] = fn()
            took[k] = time.monotonic() - t
            log("  %s: ok, issued %s, %.1fs" % (k, stamp(new[k]), took[k]))
        except Exception as e:      # noqa: BLE001
            took[k] = time.monotonic() - t
            failed[k] = str(e)
            log("  %s: FAILED after %.1fs: %s" % (k, took[k], e))

    threads = {k: threading.Thread(target=one, args=(k, fn), daemon=True, name="src-" + k) for k, fn in fetchers.items()}
    for th in threads.values():
        th.start()
    for k, th in threads.items():
        th.join(max(0, total - (time.monotonic() - t0)))
    for k, th in threads.items():
        if th.is_alive():
            failed[k] = "timed out after %ds" % total
            log("  %s: FAILED: timed out after %ds, left behind" % (k, total))
    new = {k: new[k] for k in fetchers if k in new and k not in failed}
    log("  sources done in %.1fs" % (time.monotonic() - t0))
    sections = merge(prev, new, failed)
    return assemble(sections, crop_year(), now), failed


def main(argv):
    if "--selftest" in argv:
        return selftest()
    if "--fixture-doc" in argv:
        with open(os.path.join(FIX, "outlook-sample.json"), "w") as fh:
            fh.write(dumps(fixture_doc()))
        log("wrote test/fixtures/prf-outlook/outlook-sample.json")
        return 0
    os.chdir(ROOT)
    if "--check" in argv:
        if not os.path.exists(OUT):
            log("no %s yet (first run not made)" % OUT)
            return 0
        errs = check_doc(json.load(open(OUT)), load_grids())
        log("outlook check: " + ("ok" if not errs else "; ".join(errs)))
        return 1 if errs else 0
    grids = load_grids()
    if len(grids) < 10000:
        log("only %d PRF grids found in data/prf/g; refusing" % len(grids))
        return 1
    today = dt.datetime.now(dt.timezone.utc).date()
    now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    prev = json.load(open(OUT)) if os.path.exists(OUT) else None
    doc, failed = run(grids, today, now, {
        "seasonal": lambda: fetch_seasonal(grids),
        "monthly": lambda: fetch_monthly(grids),
        "enso": fetch_enso,
        "drought": lambda: fetch_drought(grids, today),
    }, prev)
    if not any(doc.get(k) for k in ("seasonal", "monthly", "enso", "drought")):
        log("refusing to write: no section came back and none is published")
        return 1
    errs = check_doc(doc, grids)
    if errs:
        log("refusing to write: " + "; ".join(errs))
        return 1
    text = dumps(doc)
    if len(text.encode()) > MAX_BYTES:
        log("refusing to write: %d bytes is over MAX_BYTES %d" % (len(text.encode()), MAX_BYTES))
        return 1
    same = prev is not None and {k: v for k, v in prev.items() if k != "built"} == {k: v for k, v in doc.items() if k != "built"}
    if same:
        log("unchanged")
    else:
        with open(OUT, "w") as fh:
            fh.write(text)
        log("wrote %s, %d bytes" % (OUT, len(text.encode())))
    return 1 if failed else 0


# ------------------------------------------------------------------ selftest
def make_shp_zip(polys, rows, name):
    """A minimal polygon shapefile in a zip, written by hand, so the reader is
    tested against bytes laid out as the ESRI spec says."""
    recs = b""
    for i, rings in enumerate(polys, 1):
        pts = [p for r in rings for p in r]
        parts, k = [], 0
        for r in rings:
            parts.append(k)
            k += len(r)
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        body = struct.pack("<i4d2i", 5, min(xs), min(ys), max(xs), max(ys), len(rings), len(pts))
        body += struct.pack("<%di" % len(parts), *parts) + b"".join(struct.pack("<2d", *p) for p in pts)
        recs += struct.pack(">2i", i, len(body) // 2) + body
    shp = struct.pack(">7i", 9994, 0, 0, 0, 0, 0, (100 + len(recs)) // 2) + struct.pack("<2i4d4d", 1000, 5, -130, 20, -60, 50, 0, 0, 0, 0) + recs
    fields = [(k, "C" if isinstance(rows[0][k], str) else "N", 20) for k in rows[0]]
    hdr = struct.pack("<B3BIHH20x", 3, 126, 1, 1, len(rows), 32 + 32 * len(fields) + 1, 1 + sum(f[2] for f in fields))
    for n, t, ln in fields:
        hdr += n.encode().ljust(11, b"\0") + t.encode() + b"\0\0\0\0" + bytes([ln]) + b"\0" * 15
    hdr += b"\x0d"
    body = b"".join(b" " + b"".join(str(r[n]).encode().ljust(ln)[:ln] for n, _, ln in fields) for r in rows) + b"\x1a"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr(name + ".shp", shp)
        z.writestr(name + ".dbf", hdr + body)
    return buf.getvalue()


def gid(lat, lon):
    return int((lat - LAT0) // STEP) * COLS + int((lon - LON0) // STEP) + 1


FIX_KS = [int((38.1 - LAT0) // STEP) * COLS + int((-99.9 + 0.25 * i - LON0) // STEP) + 1 for i in range(8)]
FIX_TX = [int((31.1 - LAT0) // STEP) * COLS + int((-99.9 + 0.25 * i - LON0) // STEP) + 1 for i in range(8)]


def synth_blob(cx, cy, r, n, seed, hole=False):
    """A closed ring of n vertices round (cx, cy), radius r degrees, with a
    wavy, noisy edge: the shape of a CPC contour or a USDM area."""
    import random
    rng = random.Random(seed)
    ph = [rng.uniform(0, 6.3) for _ in range(3)]
    pts = []
    for i in range(n):
        t = 2 * math.pi * i / n
        rr = r * (1 + 0.25 * math.sin(3 * t + ph[0]) + 0.12 * math.sin(7 * t + ph[1])
                  + 0.05 * math.sin(23 * t + ph[2]) + 0.02 * rng.uniform(-1, 1))
        pts.append([cx + 1.3 * rr * math.cos(t), cy + rr * math.sin(t)])
    if hole:
        pts.reverse()
    pts.append(pts[0])
    return pts


def synth_cpc_layer(lead, verts=12000):
    """One CPC lead at real-world size: a below and an above area, each four
    nested bands (33/40/50/60), about 54,000 vertices in all, as a coast-
    clipped outlook map draws them."""
    import random
    rng = random.Random(lead)
    feats = []
    for side, cx, cy in (("Below", -105 + rng.uniform(-5, 5), 35), ("Above", -85 + rng.uniform(-5, 5), 42)):
        for k, (pr, r) in enumerate(((33, 9), (40, 6), (50, 3.5), (60, 1.8))):
            feats.append({"properties": {"cat": side, "prob": pr, "fcst_date": 1789603200000,
                                         "valid_seas": "%s 2026" % SEASONS[(8 + lead) % 12]},
                          "geometry": {"type": "Polygon", "coordinates": [synth_blob(cx, cy, r, max(400, int(verts * r / 9)), lead * 100 + k)]}})
    return feats


def synth_usdm():
    """A Drought Monitor map at real-world size: D0 to D4 as multipolygons,
    large areas with detailed edges and holes, about 360,000 vertices."""
    import random
    rng = random.Random(5)
    feats = []
    for dm, n, r, v in ((0, 4, 8.0, 40000), (1, 6, 5.0, 15000), (2, 8, 3.0, 6000), (3, 10, 1.5, 2500), (4, 6, 0.8, 1000)):
        polys = []
        for i in range(n):
            cx, cy = rng.uniform(-115, -80), rng.uniform(30, 45)
            polys.append([synth_blob(cx, cy, r, v, dm * 77 + i), synth_blob(cx, cy, r * 0.2, v // 10, dm * 77 + i + 9, hole=True)])
        feats.append({"properties": {"DM": dm}, "geometry": {"type": "MultiPolygon", "coordinates": polys}})
    return feats


def fixture_doc():
    """The fixtures assembled into one outlook file, for the page tests
    (test/fixtures/prf-outlook/outlook-sample.json is this, committed)."""
    def fx(name):
        with open(os.path.join(FIX, name), "rb") as fh:
            return fh.read()
    grids = sorted(FIX_KS + FIX_TX)
    seas = json.loads(fx("cpc-seasonal-sample.json"))
    e = parse_enso_disc(fx("ensodisc-sample.html").decode())
    e.update({"source": "fixture", "link": LINKS["cpc_enso"], "probs": parse_enso_probs(fx("enso-probs-sample.html").decode())["rows"]})
    sections = {
        "seasonal": build_seasonal({int(k): v["features"] for k, v in seas["layers"].items()}, grids, "fixture"),
        "monthly": build_monthly(json.loads(fx("cpc-monthly-sample.json"))["features"], grids, "fixture"),
        "enso": e,
        "drought": build_drought(json.loads(fx("usdm-sample.json"))["features"], grids, dt.date(2026, 10, 6), "fixture"),
    }
    doc = assemble(sections, 2027, "2026-10-12T15:00:00Z")
    doc["_note"] = "SYNTHETIC TEST FIXTURE built from the other files in this folder by fetch_prf_outlook.py --fixture-doc. Not a real outlook."
    return doc


def selftest():
    fails = []

    def ok(c, what):
        if not c:
            fails.append(what)
            log("  FAIL", what)

    def fx(name):
        with open(os.path.join(FIX, name), "rb") as fh:
            return fh.read()

    # grids: a strip across Kansas and Texas (fixtures draw boxes over these)
    KS, TX = FIX_KS, FIX_TX                                   # 38.0-38.25N and 31.0-31.25N, 100W eastward
    ok(KS[0] == gid(38.1, -99.9) and TX[7] == gid(31.1, -98.15), "fixture grid ids")
    grids = sorted(KS + TX)

    # codes and bands
    ok(cpc_code({"cat": "Below", "prob": 40}) == "B4", "Below 40 -> B4")
    ok(cpc_code({"Cat": "Above", "Prob": 33.33}) == "A3", "Above 33.33 -> A3")
    ok(cpc_code({"cat": "EC", "prob": 33.33}) == "E", "EC -> E")
    ok(cpc_code({"cat": "Normal", "prob": 0.5}) == "N5", "fraction prob read as percent")
    ok(cpc_code({"cat": "Below", "prob": 20}) == "E", "a prob under 33 is no tilt")
    ok(cpc_code({"cat": "???", "prob": 50}) is None, "unknown category skipped")
    ok(parse_date(1789603200000) == dt.date(2026, 9, 17), "epoch ms date")
    ok(parse_date("20260917") == dt.date(2026, 9, 17) and parse_date("2026-09-17") == dt.date(2026, 9, 17), "text dates")
    iss = dt.date(2026, 9, 17)
    ok(season_for(iss, 1, "OND 2026") == ("2026-10", "2026-12", "OND"), "lead 1 from Sep = OND")
    ok(season_for(iss, 4, "JFM 2027") == ("2027-01", "2027-03", "JFM"), "lead 4 = JFM 2027")
    ok(season_for(iss, 13, None) == ("2027-10", "2027-12", "OND"), "lead 13 = OND 2027 with no label")
    ok(season_for(iss, 2, "DJF") == ("2026-12", "2027-02", "DJF"), "letters decide when they disagree with the lead")
    ok(month_for(iss, "OCT 2026") == "2026-10" and month_for(dt.date(2026, 10, 31), "NOV") == "2026-11", "monthly month")

    # point in polygon with a hole
    sq = [[(0, 0), (10, 0), (10, 10), (0, 10), (0, 0)], [(4, 4), (6, 4), (6, 6), (4, 6), (4, 4)]]
    ok(inside(sq, 1, 1) and not inside(sq, 5, 5) and not inside(sq, 11, 5), "even-odd with a hole")

    # run-length round trip, gaps in a row
    vals = {g: ("x" if i % 3 else "y") for i, g in enumerate(grids)}
    sparse = [g for i, g in enumerate(grids) if i % 4 != 1]
    calls, rows = encode({g: vals[g] for g in sparse}, sparse)
    sec = {"calls": calls, "rows": rows}
    ok(all(decode(sec, g) == vals[g] for g in sparse), "run-length round trip over gaps")
    ok(decode(sec, gid(45.1, -99.9)) is None, "a row with no grids answers None")

    # seasonal fixture: 13 layers as the map service answers them
    seas = json.loads(fx("cpc-seasonal-sample.json"))
    layers = {int(k): v["features"] for k, v in seas["layers"].items()}
    s = build_seasonal(layers, grids, "fixture")
    ok(s["issued"] == "2026-09-17", "seasonal issued %s" % s["issued"])
    ok([l["season"] for l in s["leads"]][:4] == ["OND", "NDJ", "DJF", "JFM"], "season codes %s" % [l["season"] for l in s["leads"]][:4])
    ok(s["leads"][12]["start"] == "2027-10", "lead 13 starts 2027-10")
    ks = decode(s, KS[0]).split(".")
    tx = decode(s, TX[0]).split(".")
    ok(ks[0] == "E" and ks[2] == "B4" and ks[3] == "B3", "Kansas grid calls %s" % ks[:4])
    ok(tx[2] == "B5", "Texas: nested 50 polygon inside the 40 one wins, %s" % tx[2])
    ok(tx[5] == "A3", "Texas lead 6 above %s" % tx[5])
    ok(s["ec"] == "unshaded", "no EC polygons drawn -> uncovered is EC")
    ok(not check_doc({"v": 1, "seasonal": s}, grids), "seasonal passes check_doc")

    # a layer that draws EC polygons and misses a grid -> "-" and a refused section
    l2 = dict(layers)
    l2[1] = l2[1] + [{"properties": {"cat": "EC", "prob": 33.33, "fcst_date": 1789603200000, "valid_seas": "OND 2026"},
                      "geometry": {"type": "Polygon", "coordinates": [[[-90, 25], [-80, 25], [-80, 30], [-90, 25]]]}}]
    try:
        build_seasonal(l2, grids, "fixture")
        ok(False, "a thin layer must be refused")
    except RuntimeError as e:
        ok("covers" in str(e), "thin layer refused: %s" % e)

    # monthly
    mon = json.loads(fx("cpc-monthly-sample.json"))
    m = build_monthly(mon["features"], grids, "fixture")
    ok(m["month"] == "2026-10" and m["issued"] == "2026-09-30", "monthly %s %s" % (m["month"], m["issued"]))
    ok(decode(m, TX[1]) == "A4" and decode(m, KS[1]) == "E", "monthly calls")

    # shapefile path gives the same answer as the GeoJSON path
    feats = layers[3]
    polys = [rings_of(f["geometry"])[0] for f in feats]
    rws = [{"Fcst_Date": "20260917", "Valid_Seas": "DJF 2027", "Prob": f["properties"]["prob"], "Cat": f["properties"]["cat"]} for f in feats]
    zl = zip_layers(make_shp_zip(polys, rws, "lead3_DJF_prcp"))
    ok(list(zl) == ["lead3_djf_prcp"] and lead_of("lead3_djf_prcp", 0) == 3, "shapefile name and lead")
    v1, _, _, _ = layer_values(feats, grids)
    v2, iss2, lab2, _ = layer_values(zl["lead3_djf_prcp"], grids)
    ok(v1 == v2 and iss2 == dt.date(2026, 9, 17) and lab2 == "DJF 2027", "shapefile reader agrees with GeoJSON")

    # USDM
    um = json.loads(fx("usdm-sample.json"))
    d = build_drought(um["features"], grids, dt.date(2026, 10, 6), "fixture")
    ok(decode(d, TX[0]) == "2" and decode(d, TX[7]) == "1" and decode(d, KS[0]) == "N", "drought %s %s %s" % (decode(d, TX[0]), decode(d, TX[7]), decode(d, KS[0])))
    ok(d["released"] == "2026-10-08", "USDM released Thursday")
    ok(recent_tuesdays(dt.date(2026, 10, 12))[0] == dt.date(2026, 10, 6), "latest Tuesday")

    # ENSO
    e = parse_enso_disc(fx("ensodisc-sample.html").decode())
    ok(e["status"] == "El Nino Advisory", "enso status %r" % e["status"])
    ok(e["issued"] == "2026-10-08", "enso issued %s" % e["issued"])
    ok(e["synopsis"] and e["synopsis"].startswith("El Nino is expected"), "synopsis %r" % e["synopsis"])
    p = parse_enso_probs(fx("enso-probs-sample.html").decode())
    ok(p["month"] == "2026-10" and len(p["rows"]) == 9, "probs %s %d rows" % (p["month"], len(p["rows"])))
    ok(p["rows"][0] == {"season": "OND", "la": 0, "neutral": 2, "el": 98}, "first row, columns by header %s" % p["rows"][0])

    # assembly: a failed section keeps the published one; an older one never replaces it
    prev = {"seasonal": dict(s, issued="2026-08-20"), "enso": dict(e), "drought": d}
    doc, failed = run(grids, dt.date(2026, 10, 12), "2026-10-12T15:00:00Z", {
        "seasonal": lambda: s,
        "monthly": lambda: m,
        "enso": lambda: (_ for _ in ()).throw(RuntimeError("down")),
        "drought": lambda: dict(d, map_date="2026-09-29"),
    }, prev)
    ok(doc["seasonal"]["issued"] == "2026-09-17", "newer seasonal replaces the published one")
    ok(doc["enso"]["issued"] == "2026-10-08" and "enso" in failed, "failed ENSO keeps the published one")
    ok(doc["drought"]["map_date"] == "2026-10-06", "an older drought map does not replace a newer one")
    ok(not check_doc(doc, grids), "assembled doc passes check_doc: %s" % check_doc(doc, grids))

    # size: every PRF grid, worst case: no two neighbours share a call, from
    # 200 distinct 13-season calls (a real map has a few dozen, in broad areas)
    allg = load_grids() or grids
    import random
    rng = random.Random(7)
    pool = sorted({".".join(rng.choice(("B4", "B5", "A3", "A4", "N4", "E")) for _ in range(13)) for _ in range(200)})
    rnd = {g: pool[(g * 2654435761) % len(pool)] for g in allg}
    c2, r2 = encode(rnd, allg)
    size = len(dumps({"calls": c2, "rows": r2}).encode())
    log("  size check: %d grids, the worst case (no two neighbours alike) = %d bytes per section" % (len(allg), size))
    ok(size * 3 < MAX_BYTES, "three worst-case sections fit under MAX_BYTES")

    # fast grid read == plain point-in-polygon, on detailed shapes with holes
    sub = allg[::37]
    for what, feats, val, rk, empty in (("CPC", synth_cpc_layer(2), cpc_code, code_rank, "E"),
                                        ("USDM", synth_usdm(), dm_value, lambda v: -1 if v == "N" else v, "N")):
        pl = prep(feats, val)
        fast, slow = sample(pl, sub, rk, empty), sample_slow(pl, sub, rk, empty)
        ok(fast == slow and sum(1 for g in sub if fast[g] != empty) > 50,
           "%s: raster read agrees with point-in-polygon at %d grids" % (what, len(sub)))

    # full scale timing: 13 seasonal leads, the monthly and a drought map of
    # real-world complexity read at every PRF grid. The first runner run was
    # cancelled at 20 minutes; this read took ~7 minutes locally before the
    # raster read.
    if len(allg) > 10000:
        t = time.monotonic()
        lay = {lead: synth_cpc_layer(lead) for lead in range(1, 14)}
        ss = build_seasonal(lay, allg, "synthetic")
        mm = build_monthly(synth_cpc_layer(1), allg, "synthetic")
        dd = build_drought(synth_usdm(), allg, dt.date(2026, 10, 6), "synthetic")
        took = time.monotonic() - t
        nb = len(dumps({"seasonal": ss, "monthly": mm, "drought": dd}).encode())
        log("  full scale: %d grids, 13 leads + monthly + drought, %d vertices, %.1fs, %d bytes"
            % (len(allg), sum(vertex_count(f) for f in lay.values()) + vertex_count(synth_cpc_layer(1)) + vertex_count(synth_usdm()), took, nb))
        ok(took < 45, "full-scale read in under 45 s (took %.1f s)" % took)
        ok(not check_doc({"v": 1, "seasonal": ss, "monthly": mm, "drought": dd}, allg), "full-scale doc passes check_doc")
        ok(nb < MAX_BYTES, "full-scale doc under MAX_BYTES")

    # pagination: a server that ignores resultOffset, one that never stops, one that pages properly
    def pager(mode):
        def f(url):
            off = int(urllib.parse.parse_qs(urllib.parse.urlparse(url).query)["resultOffset"][0])
            base = 0 if mode == "ignores" else off
            feats = [{"id": base + i, "properties": {}} for i in range(2)]
            more = mode != "proper" or off < 4
            return json.dumps({"features": feats, "properties": {"exceededTransferLimit": more}}).encode()
        return f
    ok(len(arcgis_features("x", pager("proper"))) == 6, "pagination reads every page")
    for mode, word in (("ignores", "repeats"), ("endless", "pages")):
        try:
            arcgis_features("x", pager(mode), max_pages=5)
            ok(False, "pagination (%s) must stop" % mode)
        except RuntimeError as err:
            ok(word in str(err), "pagination (%s) stops: %s" % (mode, err))

    # a request past its source's deadline is not made
    _tl.deadline = time.monotonic() - 1
    try:
        get("http://127.0.0.1:9/never")
        ok(False, "get past the deadline must raise")
    except Timeout:
        ok(True, "")

    # a server that sends its headers, then a byte now and then, is cut off at the deadline
    import socket
    srv = socket.socket()
    srv.bind(("127.0.0.1", 0))
    srv.listen(1)

    def trickle():
        c, _ = srv.accept()
        c.recv(4096)
        c.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: 100000\r\n\r\n")
        try:
            for _ in range(20):
                c.sendall(b"x")
                time.sleep(0.25)
        except OSError:
            pass
        c.close()
    threading.Thread(target=trickle, daemon=True).start()
    _tl.deadline = time.monotonic() + 1.5
    t = time.monotonic()
    try:
        get("http://127.0.0.1:%d/" % srv.getsockname()[1])
        ok(False, "a trickling server must be cut off")
    except Timeout:
        ok(time.monotonic() - t < 3, "a trickling server is cut off at the deadline (%.1fs)" % (time.monotonic() - t))
    _tl.deadline = None
    srv.close()

    # a source that hangs is left behind; the others still write, the published section is kept
    t = time.monotonic()
    doc2, failed2 = run(grids, dt.date(2026, 10, 12), "2026-10-12T15:00:00Z", {
        "seasonal": lambda: s, "monthly": lambda: m, "enso": lambda: e,
        "drought": lambda: time.sleep(5) or d,
    }, {"drought": dict(d, map_date="2026-09-29")}, budget=1, total=1)
    ok(time.monotonic() - t < 3 and "drought" in failed2 and doc2["drought"]["map_date"] == "2026-09-29"
       and doc2["seasonal"]["issued"] == "2026-09-17" and doc2["enso"]["issued"] == "2026-10-08",
       "a hung source is skipped, the rest written, its published section kept")

    # the committed page fixture is what the fixtures build today
    fd = dumps(fixture_doc())
    with open(os.path.join(FIX, "outlook-sample.json")) as fh:
        ok(fh.read() == fd, "test/fixtures/prf-outlook/outlook-sample.json is current (run --fixture-doc)")

    log("prf outlook selftest:", "ok" if not fails else "%d failure(s)" % len(fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
