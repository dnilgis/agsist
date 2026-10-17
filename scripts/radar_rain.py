#!/usr/bin/env python3
"""radar_rain.py: how much rain fell on a field, from NOAA's radar and gauge
estimate (MRMS multi-sensor QPE, Pass 2), one small file per state.

Run by .github/workflows/radar-rain.yml. The sandbox this was built in can
reach the NOAA open data bucket on AWS, so this also runs by hand.

WHERE THE NUMBERS COME FROM
  NOAA MRMS MultiSensor_QPE_<NN>H_Pass2 on the NOAA open data bucket
  (noaa-mrms-pds on AWS, CONUS/). Pass 2 is the gauge-corrected run, posted
  about an hour after its end time (the 12:00Z file shows up near 12:58Z).
  Native grid 0.01 degree (7000 x 3500 over the lower 48), millimeters,
  GRIB2 with PNG packing (template 5.41). No Alaska, Hawaii or Puerto Rico.

  The hail map's MESH reader (scripts/fetch_mesh.py) reads GRIB2 with
  xarray + cfgrib + the eccodes system library. This file reads the one
  layout MRMS uses with the standard library plus Pillow for the PNG, and
  refuses anything else, so the decoder runs and is tested anywhere.

WINDOWS (all end at the newest hour H that has Pass 2 24H and 72H files)
  24h   one 24H file at H
  3d    one 72H file at H
  7d    72H at H + 72H at H-72h + 24H at H-144h
  month since local midnight Central on the 1st, built from 72H, 24H, 12H,
        6H, 3H and 1H blocks that tile the window exactly
  A window with any missing piece is left out. Nothing is guessed.

  Gauge days: 24H files ending 12:00Z (7 am CDT, 6 am CST) for each of the
  last GAUGE_DAYS days, sampled at the county rain stations (data/rain/), so
  the page can put a real gauge's week beside radar at the same gauge.

THE FILE  data/radar-rain/<st>.bin  (one per state, all windows)
  "RR01", uint32 LE header length, header JSON (UTF-8), then one zlib blob
  per window. A window's grid is row-major, north row first, in hundredths
  of an inch, -1 = no data. Windows run shortest first and each one after
  the first is stored as its difference from the one before ("base"). The
  blob holds the gradient-predictor residual of that grid (cell minus
  left + above - above-left) as int16 LE ("t": "i2", or i4 if one will not
  fit). Cell (r, c) center is lat = y0 - r*d, lon = x0 + c*d.
  components/radar-rain.js reads it.

  python3 scripts/radar_rain.py                  fetch, build every state
  python3 scripts/radar_rain.py --states IA,KS   some states
  python3 scripts/radar_rain.py --selftest       offline tests (fixture)
  python3 scripts/radar_rain.py --validate 2026-10-01 2026-10-13 [--out f.json] [--shift N]
                                                 radar vs county gauges, one day at a time
  python3 scripts/radar_rain.py --check          validate data/radar-rain/*.bin
"""
import datetime as dt
import gzip
import io
import json
import os
import re
import struct
import sys
import time
import urllib.request
import zlib

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "radar-rain")
BUCKET = "https://noaa-mrms-pds.s3.amazonaws.com"
PROD = "CONUS/MultiSensor_QPE_{h:02d}H_Pass2_00.00"
SOURCE = "NOAA MRMS multi-sensor QPE, Pass 2 (radar corrected with rain gauges), noaa-mrms-pds"
UA = "agsist.com radar rain (https://agsist.com/rain-radar)"
SCHEMA = "agsist-radar-rain/1"

# The MRMS CONUS grid. Anything else is refused.
NI, NJ, DEG = 7000, 3500, 0.01
LA1, LO1 = 54.995, -129.995          # first cell center (north-west), lon in -180..180

POOL = 2                 # 0.01 deg cells averaged 2 x 2 -> 0.02 deg (about 2.2 km N-S)
PAD = 0.3                # degrees of neighbor around each state's box, for the map
MM_PER_IN = 25.4
MISSING = -1
BLOCKS = (72, 24, 12, 6, 3, 1)
GAUGE_DAYS = 21          # gauge-day radar kept at the stations (county gauges post weekly)
STATES_GEO = os.path.join(ROOT, "data", "us-states.geo.json")
LOWER48 = ["AL", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "ID", "IL", "IN", "IA", "KS", "KY",
           "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC",
           "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY"]


def log(*a):
    print(*a, flush=True)


# ---------------------------------------------------------------- GRIB2 (MRMS layout only)

def _sm(b):
    """GRIB2 signed integers are sign-and-magnitude, not two's complement."""
    v = int.from_bytes(b, "big")
    n = len(b) * 8
    return -(v & ((1 << (n - 1)) - 1)) if v >> (n - 1) else v


class GribError(ValueError):
    pass


def decode_grib2(raw):
    """One MRMS GRIB2 message (gzipped or not) -> dict with 'mm' (float32
    array, north row first, NaN where MRMS has no data), the grid, and the
    reference time. Refuses any layout it was not written for."""
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    if raw[:4] != b"GRIB" or raw[7] != 2:
        raise GribError("not a GRIB2 message")
    total = int.from_bytes(raw[8:16], "big")
    if total > len(raw):
        raise GribError("message cut short")
    p, secs = 16, {}
    while raw[p:p + 4] != b"7777":
        if p + 5 > len(raw):
            raise GribError("no end marker")
        n = struct.unpack(">I", raw[p:p + 4])[0]
        num = raw[p + 4]
        if num in secs:
            raise GribError("more than one field in the message")
        secs[num] = raw[p:p + n]
        p += n
    for k in (1, 3, 4, 5, 6, 7):
        if k not in secs:
            raise GribError("section %d missing" % k)
    s1 = secs[1]
    yr = struct.unpack(">H", s1[12:14])[0]
    ref = dt.datetime(yr, s1[14], s1[15], s1[16], s1[17], s1[18], tzinfo=dt.timezone.utc)
    s3 = secs[3]
    if struct.unpack(">H", s3[12:14])[0] != 0:
        raise GribError("grid is not lat/lon (template 3.0)")
    g = s3[14:]
    ni, nj = struct.unpack(">II", g[16:24])
    la1, lo1 = _sm(g[32:36]) / 1e6, _sm(g[36:40]) / 1e6
    di, dj = _sm(g[49:53]) / 1e6, _sm(g[53:57]) / 1e6
    scan = g[57]
    if lo1 > 180:
        lo1 -= 360.0
    if scan != 0:
        raise GribError("scan mode %d (expected 0: west to east, north to south)" % scan)
    s5 = secs[5]
    npts = struct.unpack(">I", s5[5:9])[0]
    if struct.unpack(">H", s5[9:11])[0] != 41:
        raise GribError("packing is not PNG (template 5.41)")
    ref_v = struct.unpack(">f", s5[11:15])[0]
    e, d, bits = _sm(s5[15:17]), _sm(s5[17:19]), s5[19]
    if secs[6][5] != 255:
        raise GribError("bitmap present; not the MRMS layout")
    if npts != ni * nj:
        raise GribError("point count does not match the grid")
    from PIL import Image
    im = Image.open(io.BytesIO(secs[7][5:]))
    if im.size != (ni, nj):
        raise GribError("PNG size %s does not match the grid %dx%d" % (im.size, ni, nj))
    if bits == 16:
        x = np.asarray(im, dtype=np.uint16) if im.mode.startswith("I;16") else np.asarray(im.convert("I"))
    elif bits == 8:
        x = np.asarray(im, dtype=np.uint8)
    else:
        raise GribError("%d-bit PNG not handled" % bits)
    mm = ((ref_v + x.astype(np.float64) * (2.0 ** e)) / (10.0 ** d)).astype(np.float32)
    mm[mm < 0] = np.nan          # MRMS: -3 no data, -1 no coverage
    return {"mm": mm, "ni": ni, "nj": nj, "la1": la1, "lo1": lo1, "di": di, "dj": dj,
            "ref": ref, "cat": secs[4][9], "num": secs[4][10]}


def check_conus(gr):
    if (gr["ni"], gr["nj"]) != (NI, NJ) or abs(gr["di"] - DEG) > 1e-6 or abs(gr["dj"] - DEG) > 1e-6:
        raise GribError("not the MRMS CONUS grid")
    if abs(gr["la1"] - LA1) > 1e-4 or abs(gr["lo1"] - LO1) > 1e-4:
        raise GribError("grid corner moved: %s %s" % (gr["la1"], gr["lo1"]))


# ---------------------------------------------------------------- fetching

def key(hours, t):
    return "%s/%s/MRMS_MultiSensor_QPE_%02dH_Pass2_00.00_%s.grib2.gz" % (
        PROD.format(h=hours), t.strftime("%Y%m%d"), hours, t.strftime("%Y%m%d-%H%M%S"))


def http(url, timeout=120, tries=3):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (403, 404):
                return None          # not posted (yet); the bucket answers 403/404 for that
            last = e
        except Exception as e:      # noqa: BLE001 - network blips retry, then give up
            last = e
        time.sleep(5 * (i + 1))
    raise RuntimeError("fetch failed: %s (%s)" % (url, last))


def listing(hours, day):
    """Hours (datetimes) with a Pass 2 file of this length posted on this UTC day."""
    url = "%s/?list-type=2&prefix=%s/%s/" % (BUCKET, PROD.format(h=hours), day.strftime("%Y%m%d"))
    body = http(url, timeout=60)
    if body is None:
        return []
    out = []
    for m in re.finditer(r"_(\d{8})-(\d{2})0000\.grib2\.gz</Key>", body.decode()):
        out.append(dt.datetime.strptime(m.group(1) + m.group(2), "%Y%m%d%H").replace(tzinfo=dt.timezone.utc))
    return sorted(out)


class Store:
    """Downloads each file once per run, decodes it, keeps only the cropped
    float grid. Holds at most a few CONUS grids in memory at a time."""

    def __init__(self):
        self.cache = {}
        self.fetched = 0

    def get(self, hours, t):
        k = (hours, t)
        if k not in self.cache:
            raw = http(BUCKET + "/" + key(hours, t))
            if raw is None:
                self.cache[k] = None
            else:
                gr = decode_grib2(raw)
                check_conus(gr)
                if gr["ref"] != t:
                    raise GribError("file time %s is not %s" % (gr["ref"], t))
                self.fetched += 1
                self.cache[k] = gr["mm"]
        return self.cache[k]


def tile(span_h):
    """Split a whole number of hours into Pass 2 block lengths, largest first."""
    out, left = [], int(span_h)
    for b in BLOCKS:
        while left >= b:
            out.append(b)
            left -= b
    return out


def accumulate(store, end, span_h):
    """Sum of Pass 2 blocks tiling (end - span_h, end]. None if any block is missing."""
    tot, t = None, end
    for b in tile(span_h):
        a = store.get(b, t)
        if a is None:
            return None
        tot = a.astype(np.float32) if tot is None else tot + a
        t = t - dt.timedelta(hours=b)
    return tot


def month_start(end):
    """Local midnight Central on the 1st of end's month (Central month), in UTC.
    CDT (UTC-5) from the 2nd Sunday of March to the 1st Sunday of November."""
    def central_offset(u):
        y = u.year
        mar = dt.datetime(y, 3, 8, 8, tzinfo=dt.timezone.utc)
        mar += dt.timedelta(days=(6 - mar.weekday()) % 7)          # 2nd Sunday, 2 am CST = 08Z
        nov = dt.datetime(y, 11, 1, 7, tzinfo=dt.timezone.utc)
        nov += dt.timedelta(days=(6 - nov.weekday()) % 7)          # 1st Sunday, 2 am CDT = 07Z
        return 5 if mar <= u < nov else 6
    local = end - dt.timedelta(hours=central_offset(end))
    first = dt.datetime(local.year, local.month, 1, tzinfo=dt.timezone.utc)
    guess = first + dt.timedelta(hours=6)
    return first + dt.timedelta(hours=central_offset(guess))


# ---------------------------------------------------------------- grids and the file

def state_boxes():
    g = json.load(open(STATES_GEO))
    out = {}
    for f in g["features"]:
        p = f["properties"].get("postal")
        if p not in LOWER48 or f["properties"].get("iso_a2") not in (None, "US"):
            continue
        geo = f["geometry"]
        polys = geo["coordinates"] if geo["type"] == "MultiPolygon" else [geo["coordinates"]]
        xs = [c[0] for po in polys for r in po for c in r]
        ys = [c[1] for po in polys for r in po for c in r]
        out[p] = (min(xs), min(ys), max(xs), max(ys))
    return out


def crop_index(bbox, pad=PAD, pool=POOL):
    """Native row/col range for a box, aligned to the pool so cells match across states."""
    w, s, e, n = bbox[0] - pad, bbox[1] - pad, bbox[2] + pad, bbox[3] + pad
    c0 = max(0, int(np.floor((w - (LO1 - DEG / 2)) / DEG / pool)) * pool)
    c1 = min(NI, int(np.ceil((e - (LO1 - DEG / 2)) / DEG / pool)) * pool)
    r0 = max(0, int(np.floor(((LA1 + DEG / 2) - n) / DEG / pool)) * pool)
    r1 = min(NJ, int(np.ceil(((LA1 + DEG / 2) - s) / DEG / pool)) * pool)
    return r0, r1, c0, c1


def pool_mean(a, k=POOL):
    """k x k mean; a cell is no data if any of its parts is (no half-blind averages)."""
    h, w = (a.shape[0] // k) * k, (a.shape[1] // k) * k
    b = a[:h, :w].reshape(h // k, k, w // k, k)
    return b.mean(axis=(1, 3))        # NaN propagates


def quantize(mm):
    """mm -> hundredths of an inch, int16, -1 where no data."""
    v = np.round(np.nan_to_num(mm, nan=-1.0) / MM_PER_IN * 100.0)
    v[np.isnan(mm)] = MISSING
    return np.clip(v, MISSING, 32767).astype(np.int16)


SPIKE_MIN = 200          # hundredths: only cells of 2 in or more are tested
SPIKE_RATIO = 20         # ...and blanked when 20 times the middle of the 5 x 5 cells around them


def despike(q):
    """MRMS has a few fixed bad cells (one near Mt. Baker, WA read 95 in for
    half of October 2026 beside neighbors near 1 in). A cell of 2 in or more
    that is 20 times the median of the 5 x 5 cells around it is set to no
    data. A real storm core that steep is rare; if one is caught, the page
    says no data for that cell instead of printing a number it cannot back."""
    q = q.copy()
    rs, cs = np.nonzero(q >= SPIKE_MIN)
    if not len(rs):
        return q, 0
    f = np.pad(np.where(q < 0, np.nan, q.astype(float)), 2, constant_values=np.nan)
    offs = [(dr, dc) for dr in range(-2, 3) for dc in range(-2, 3) if (dr, dc) != (0, 0)]
    nb = np.stack([f[rs + 2 + dr, cs + 2 + dc] for dr, dc in offs], axis=1)
    has = ~np.all(np.isnan(nb), axis=1)
    med = np.full(len(rs), np.inf)
    if has.any():
        med[has] = np.nanmedian(nb[has], axis=1)
    bad = q[rs, cs] >= SPIKE_RATIO * np.maximum(med, 1.0)
    q[rs[bad], cs[bad]] = MISSING
    return q, int(bad.sum())


def predict_residual(q):
    """Gradient predictor (the PNG/LOCO-I 'a + b - c' guess): each cell minus
    left + above - above-left. First row: minus left; first column: minus above."""
    q = q.astype(np.int64)
    d = q.copy()
    d[0, 1:] = q[0, 1:] - q[0, :-1]
    d[1:, 0] = q[1:, 0] - q[:-1, 0]
    d[1:, 1:] = q[1:, 1:] - (q[1:, :-1] + q[:-1, 1:] - q[:-1, :-1])
    return d


def undo_residual(d):
    """Inverse of predict_residual: a 2-D running sum."""
    return np.cumsum(np.cumsum(d.astype(np.int64), axis=0), axis=1)


def encode_grid(q):
    """int grid -> (zlib bytes, dtype tag). int16 unless a residual will not fit."""
    d = predict_residual(q)
    t = "i2" if (d.min() >= -32768 and d.max() <= 32767) else "i4"
    return zlib.compress(d.astype("<" + t).tobytes(), 9), t


def decode_grid(blob, ny, nx, t="i2"):
    d = np.frombuffer(zlib.decompress(blob), dtype="<" + t).reshape(ny, nx)
    return undo_residual(d)


def write_bin(path, header, grids):
    """grids: list of (window dict, int16 array), shortest window first. Each
    window after the first is stored as its difference from the one before
    it (the 7 days hold the 3 days, and so on), which is exact in integers
    and much smaller. Window dicts get off, len, t and base."""
    blobs, wins, off, prev = [], [], 0, None
    for w, q in grids:
        q = q.astype(np.int32)
        b, t = encode_grid(q if prev is None else q - prev[1])
        w = dict(w, off=off, len=len(b), t=t, base=None if prev is None else prev[0])
        off += len(b)
        blobs.append(b)
        wins.append(w)
        prev = (w["id"], q)
    header = dict(header, windows=wins)
    hj = json.dumps(header, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    data = b"RR01" + struct.pack("<I", len(hj)) + hj + b"".join(blobs)
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path)
    return len(data)


def read_bin(path_or_bytes):
    b = open(path_or_bytes, "rb").read() if isinstance(path_or_bytes, str) else path_or_bytes
    if b[:4] != b"RR01":
        raise ValueError("not a radar rain file")
    n = struct.unpack("<I", b[4:8])[0]
    h = json.loads(b[8:8 + n].decode("utf-8"))
    base = 8 + n
    grids = {}
    for w in h["windows"]:
        g = decode_grid(b[base + w["off"]: base + w["off"] + w["len"]], h["ny"], h["nx"], w.get("t", "i2"))
        if w.get("base"):
            g = g + grids[w["base"]]
        grids[w["id"]] = g.astype(np.int16)
    return h, grids


def lookup(h, q, lat, lon):
    """Hundredths of an inch at a point (nearest cell), None outside or no data."""
    c = int(round((lon - h["x0"]) / h["d"]))
    r = int(round((h["y0"] - lat) / h["d"]))
    if not (0 <= r < h["ny"] and 0 <= c < h["nx"]):
        return None
    v = int(q[r, c])
    return None if v < 0 else v


# ---------------------------------------------------------------- the county gauges

def gauge_days(st, end_day, n=GAUGE_DAYS):
    """{fips: {name, sid, net, ll, mi, county, days: {date: 'value'}}} for the
    state's county rain stations (morning readers only: CoCoRaHS and NOAA
    co-op; airport stations close their day at midnight and are left out)."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import county_rain as R
    p = os.path.join(ROOT, "data", "rain", st.lower() + ".json")
    dp = os.path.join(ROOT, "data", "rain", "daily", st.lower() + ".json")
    if not (os.path.exists(p) and os.path.exists(dp)):
        return {}, None
    d, dd = json.load(open(p)), json.load(open(dp))
    year = int(dd["year"])
    out = {}
    for fips, c in d.get("counties", {}).items():
        s = c.get("station") or {}
        sid = str(s.get("sid", ""))
        if not s.get("ll") or not (sid.endswith(" 2") or sid.endswith(" 10")):
            continue
        rec = dd["counties"].get(fips)
        if not rec:
            continue
        vals = R.unpack_days(rec["p"])
        days = {}
        for i, v in enumerate(vals):
            day = dt.date(year, 1, 1) + dt.timedelta(days=i)
            if (end_day - day).days < n and day <= end_day:
                days[day.isoformat()] = v
        if days:
            page = "/rain/%s/%s" % (R.slug(R.STATES.get(st.upper(), st)), R.slug(c.get("name") or ""))
            out[fips] = {"name": s.get("name"), "sid": sid, "net": s.get("net"), "ll": s["ll"],
                         "county": c.get("name"), "days": days,
                         "page": page if os.path.exists(os.path.join(ROOT, page.lstrip("/") + ".html")) else None}
    return out, dd.get("edate")


def gauge_value(v):
    """County-rain day string -> hundredths of an inch, or None when the day
    cannot be compared (missing, not read, or a multi-day total)."""
    if v in (None, "", "M", "S") or str(v).endswith("A"):
        return None
    if v == "T":
        return 0
    try:
        return int(round(float(v) * 100))
    except ValueError:
        return None


def sample_native(mm, lat, lon):
    r = int(round((LA1 - lat) / DEG))
    c = int(round((lon - LO1) / DEG))
    if not (0 <= r < NJ and 0 <= c < NI):
        return None
    v = mm[r, c]
    return None if np.isnan(v) else int(round(float(v) / MM_PER_IN * 100))


def sample_pooled(mm, lat, lon, k=POOL):
    """What the shipped grid would say at this point: the k x k block mean."""
    r = int((LA1 + DEG / 2 - lat) / DEG) // k * k
    c = int((lon - (LO1 - DEG / 2)) / DEG) // k * k
    if not (0 <= r < NJ - k and 0 <= c < NI - k):
        return None
    v = mm[r:r + k, c:c + k].mean()
    return None if np.isnan(v) else int(round(float(v) / MM_PER_IN * 100))


# ---------------------------------------------------------------- the run

def iso(t):
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def newest_hour(now):
    for back in range(0, 3):
        day = (now - dt.timedelta(days=back)).date()
        hrs24 = set(listing(24, day))
        hrs72 = set(listing(72, day))
        both = sorted(hrs24 & hrs72)
        if both:
            return both[-1]
    return None


def previous(path):
    try:
        h, _ = read_bin(path)
        return h
    except Exception:            # noqa: BLE001 - no file yet, or an old one: start fresh
        return None


def build(states, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    end = newest_hour(now)
    if end is None:
        log("no Pass 2 24H/72H pair posted in the last 3 days; nothing written")
        return 1
    log("newest Pass 2 hour:", iso(end))
    store = Store()
    wins = [("24h", 24), ("3d", 72), ("7d", 168)]
    ms = month_start(end)
    mh = int((end - ms).total_seconds() // 3600)
    if mh >= 24:
        wins.append(("month", mh))
    fields = {}
    for wid, span in wins:
        a = accumulate(store, end, span)
        if a is None:
            log("  window", wid, "has a missing piece; left out")
            continue
        fields[wid] = (a, span)
        log("  window", wid, span, "h ok")
        # 72H blocks are reused by 7d and month; smaller ones are not worth keeping
        for k in list(store.cache):
            if k[0] != 72:
                store.cache.pop(k, None)
    if "24h" not in fields:
        log("24h window missing; nothing written")
        return 1

    # gauge days: 24H ending 12Z, for the stations of every state asked for
    last12 = end.replace(hour=12) if end.hour >= 12 else (end - dt.timedelta(days=1)).replace(hour=12)
    boxes = state_boxes()
    os.makedirs(OUT, exist_ok=True)
    gauge = {}
    for st in states:
        gauge[st], _ = gauge_days(st, last12.date())
    # radar at the gauges for each 12Z day, reusing what the last file already holds
    prior = {}
    for st in states:
        h = previous(os.path.join(OUT, st.lower() + ".bin"))
        for g in (h or {}).get("gauges", []):
            prior[(st, g["sid"])] = dict(zip(g.get("dates", []), g.get("radar", [])))
    days = [(last12 - dt.timedelta(days=i)) for i in range(GAUGE_DAYS)]
    need = [t for t in days if any(t.date().isoformat() in g["days"]
                                   and t.date().isoformat() not in prior.get((st, g["sid"]), {})
                                   for st in states for g in gauge[st].values())]
    radar_at = {}
    for t in need:
        a = store.get(24, t)
        store.cache.pop((24, t), None)
        if a is None:
            continue
        for st in states:
            for g in gauge[st].values():
                radar_at[(st, g["sid"], t.date().isoformat())] = sample_pooled(a, g["ll"][1], g["ll"][0])
    log("gauge days fetched:", len(need))

    total = 0
    for st in states:
        r0, r1, c0, c1 = crop_index(boxes[st])
        ny, nx = (r1 - r0) // POOL, (c1 - c0) // POOL
        grids = []
        for wid, (a, span) in fields.items():
            q, spikes = despike(quantize(pool_mean(a[r0:r1, c0:c1])))
            grids.append(({"id": wid, "start": iso(end - dt.timedelta(hours=span)), "end": iso(end), "hours": span,
                           "blanked": spikes}, q))
        gl = []
        for g in sorted(gauge[st].values(), key=lambda x: x["sid"]):
            dates, gv, rv = [], [], []
            for t in sorted(days):
                ds = t.date().isoformat()
                if ds not in g["days"]:
                    continue
                r = radar_at.get((st, g["sid"], ds), prior.get((st, g["sid"]), {}).get(ds))
                dates.append(ds)
                gv.append(gauge_value(g["days"][ds]))
                rv.append(r)
            if dates:
                gl.append({"sid": g["sid"], "name": g["name"], "county": g["county"], "net": g["net"],
                           "ll": g["ll"], "page": g.get("page"), "dates": dates, "gauge": gv, "radar": rv})
        hdr = {
            "schema": SCHEMA, "st": st, "source": SOURCE, "data_end": iso(end),
            "x0": round(LO1 + (c0 + (POOL - 1) / 2) * DEG, 4), "y0": round(LA1 - (r0 + (POOL - 1) / 2) * DEG, 4),
            "d": round(DEG * POOL, 4), "nx": nx, "ny": ny, "unit": "0.01 in", "missing": MISSING,
            "gauge_day_end": "12:00Z", "gauges": gl,
        }
        n = write_bin(os.path.join(OUT, st.lower() + ".bin"), hdr, grids)
        total += n
        log("  %s %dx%d %d KB, %d gauges" % (st, nx, ny, n // 1024, len(gl)))
    idx = {"schema": SCHEMA, "data_end": iso(end),
           "windows": {w: {"start": iso(end - dt.timedelta(hours=s)), "end": iso(end), "hours": s}
                       for w, (_, s) in fields.items()},
           "states": {st: [round(v, 2) for v in (boxes[st][0] - PAD, boxes[st][1] - PAD,
                                                  boxes[st][2] + PAD, boxes[st][3] + PAD)]
                      for st in sorted(set(states) | set(existing_states()))}}
    json.dump(idx, open(os.path.join(OUT, "index.json"), "w"), separators=(",", ":"))
    log("wrote %d states, %d KB; %d files fetched" % (len(states), total // 1024, store.fetched))
    return 0


def existing_states():
    if not os.path.isdir(OUT):
        return []
    return [f[:-4].upper() for f in os.listdir(OUT) if f.endswith(".bin")]


# ---------------------------------------------------------------- checks

def check(path=OUT):
    bad = []
    files = sorted(f for f in os.listdir(path) if f.endswith(".bin")) if os.path.isdir(path) else []
    for f in files:
        try:
            h, g = read_bin(os.path.join(path, f))
        except Exception as e:      # noqa: BLE001
            bad.append("%s: unreadable (%s)" % (f, e))
            continue
        if h.get("schema") != SCHEMA or "24h" not in g:
            bad.append("%s: schema or 24h window missing" % f)
        for wid, q in g.items():
            if q.shape != (h["ny"], h["nx"]):
                bad.append("%s %s: shape" % (f, wid))
            if q.min() < MISSING or q.max() > 6000:
                bad.append("%s %s: value out of range (%d..%d hundredths)" % (f, wid, q.min(), q.max()))
    for e in bad:
        print("FAIL", e)
    print("radar rain check: %d files, %s" % (len(files), "ok" if not bad else "%d problem(s)" % len(bad)))
    return 0 if not bad else 1


FIXTURE = os.path.join(ROOT, "test", "fixtures", "radar-rain")


def selftest():
    fails = []

    def ok(c, m):
        if not c:
            fails.append(m)

    # 1. the real-file fixture: a crop of NOAA's 24H Pass 2 file ending
    #    2026-10-16 12:00Z, re-packed with the file's own headers.
    raw = open(os.path.join(FIXTURE, "mrms-24h-crop.grib2.gz"), "rb").read()
    exp = json.load(open(os.path.join(FIXTURE, "mrms-24h-crop.expect.json")))
    gr = decode_grib2(raw)
    ok(gr["ref"] == dt.datetime(2026, 10, 16, 12, tzinfo=dt.timezone.utc), "fixture time %s" % gr["ref"])
    ok((gr["ni"], gr["nj"]) == tuple(exp["shape"][::-1]), "fixture shape")
    ok(abs(gr["la1"] - exp["la1"]) < 1e-6 and abs(gr["lo1"] - exp["lo1"]) < 1e-6, "fixture corner")
    for (r, c), v in zip(exp["cells"], exp["mm"]):
        got = gr["mm"][r, c]
        ok((v is None and np.isnan(got)) or (v is not None and abs(float(got) - v) < 1e-4),
           "cell %d,%d: %s vs %s" % (r, c, got, v))
    ok(abs(float(np.nanmax(gr["mm"])) - exp["max_mm"]) < 1e-4, "fixture max")
    ok(int(np.isnan(gr["mm"]).sum()) == exp["n_missing"], "fixture missing count")
    try:
        check_conus(gr)
        fails.append("a crop passed as the CONUS grid")
    except GribError:
        pass
    bad = bytearray(gzip.decompress(raw))
    i = bad.find(b"\x00\x29", 16)      # template 5.41 -> 5.40
    bad[i + 1] = 40
    try:
        decode_grib2(bytes(bad))
        fails.append("a non-PNG packing was decoded")
    except GribError:
        pass

    # 2. quantize, pool, encode, decode, round trip
    mm = np.array([[0, 2.54, np.nan, 25.4], [1.27, 1.27, 0, 0]], dtype=np.float32)
    q = quantize(mm)
    ok(q.tolist() == [[0, 10, -1, 100], [5, 5, 0, 0]], "quantize %s" % q.tolist())
    p = pool_mean(np.array([[1, 3, 0, np.nan], [1, 3, 0, 0]], dtype=np.float32))
    ok(p[0, 0] == 2 and np.isnan(p[0, 1]), "pool: mean, and no-data spreads %s" % p)
    rng = np.random.default_rng(7)
    big = rng.integers(-1, 900, size=(57, 83)).astype(np.int16)
    blob, t = encode_grid(big)
    ok(t == "i2" and np.array_equal(decode_grid(blob, 57, 83, t), big), "grid round trip")
    huge = np.zeros((4, 5), dtype=np.int32)
    huge[0, 0], huge[0, 1], huge[0, 2] = 32767, -1, 32767     # -1 then 32767: a step of 32768
    blob, t = encode_grid(huge)
    ok(t == "i4" and np.array_equal(decode_grid(blob, 4, 5, t), huge), "grid round trip, wide residuals")
    ok(tile(168) == [72, 72, 24] and tile(400) == [72] * 5 + [24, 12, 3, 1] and sum(tile(397)) == 397, "tile")

    # 2b. a lone bad cell is blanked; a storm core with wet neighbors is kept
    f = np.full((9, 9), 20, dtype=np.int16)
    f[4, 4] = 900
    f[1, 1] = -1
    g_, n_ = despike(f)
    ok(n_ == 1 and g_[4, 4] == -1 and g_[0, 0] == 20, "despike: lone 9 in cell among 0.20 in")
    core = np.full((9, 9), 30, dtype=np.int16)
    core[3:6, 3:6] = 150
    core[4, 4] = 400
    g_, n_ = despike(core)
    ok(n_ == 0 and g_[4, 4] == 400, "despike keeps a 4 in core inside 1.5 in rain")

    # 3. a file, written and read, and a point lookup
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        h = {"schema": SCHEMA, "st": "ZZ", "x0": -95.0, "y0": 42.0, "d": 0.02, "nx": 83, "ny": 57, "gauges": []}
        big2 = np.where(big < 0, -1, big * 2).astype(np.int16)
        n = write_bin(os.path.join(d, "zz.bin"), h, [({"id": "24h"}, big), ({"id": "7d"}, big2)])
        h2, g2 = read_bin(os.path.join(d, "zz.bin"))
        ok(n == os.path.getsize(os.path.join(d, "zz.bin")), "size")
        ok(np.array_equal(g2["24h"], big) and np.array_equal(g2["7d"], big2), "file round trip")
        r, c = 10, 20
        ok(lookup(h2, g2["24h"], 42.0 - r * 0.02, -95.0 + c * 0.02) == (None if big[r, c] < 0 else big[r, c]), "lookup")
        ok(lookup(h2, g2["24h"], 42.0 - r * 0.02 - 0.009, -95.0 + c * 0.02 + 0.009) == lookup(h2, g2["24h"], 42.0 - r * 0.02, -95.0 + c * 0.02), "lookup rounds to nearest")
        ok(lookup(h2, g2["24h"], 50, -95) is None, "lookup outside")
        ok(check(d) == 0, "check passes a good file")

    # 4. month start is local midnight Central
    ok(month_start(dt.datetime(2026, 10, 17, 13, tzinfo=dt.timezone.utc)) ==
       dt.datetime(2026, 10, 1, 5, tzinfo=dt.timezone.utc), "month start CDT")
    ok(month_start(dt.datetime(2026, 12, 1, 3, tzinfo=dt.timezone.utc)) ==
       dt.datetime(2026, 11, 1, 5, tzinfo=dt.timezone.utc), "month start: 9 pm Nov 30 Central is still November")
    ok(month_start(dt.datetime(2026, 12, 20, 3, tzinfo=dt.timezone.utc)) ==
       dt.datetime(2026, 12, 1, 6, tzinfo=dt.timezone.utc), "month start CST")

    # 5. gauge strings
    ok([gauge_value(v) for v in ("1.50", "T", "M", "S", "0.40A", "0.00")] == [150, 0, None, None, None, 0], "gauge values")

    for f in fails:
        print("FAIL", f)
    print("radar rain selftest:", "ok" if not fails else "%d failure(s)" % len(fails))
    return 0 if not fails else 1


def validate(day_list, out_json=None, shift=0):
    """Radar 24H (ending 12Z) vs every morning county gauge in the lower 48,
    one day at a time. Prints and returns the error summary."""
    rows = []
    boxes = state_boxes()
    store = Store()
    gauges = {st: gauge_days(st, max(day_list), n=(max(day_list) - min(day_list)).days + 1)[0] for st in boxes}
    for day in day_list:
        t = dt.datetime(day.year, day.month, day.day, 12, tzinfo=dt.timezone.utc) + dt.timedelta(days=shift)
        a = store.get(24, t)
        store.cache.clear()
        if a is None:
            log("no 24H file for", t)
            continue
        for st, gs in gauges.items():
            for g in gs.values():
                gv = gauge_value(g["days"].get(day.isoformat()))
                if gv is None:
                    continue
                rn = sample_native(a, g["ll"][1], g["ll"][0])
                rp = sample_pooled(a, g["ll"][1], g["ll"][0])
                if rn is None or rp is None:
                    continue
                rows.append({"day": day.isoformat(), "st": st, "sid": g["sid"], "net": g["net"],
                             "gauge": gv, "native": rn, "pooled": rp})
        log(day, len(rows))
    res = summarize(rows)
    if out_json:
        json.dump({"summary": res, "rows": rows}, open(out_json, "w"))
    print(json.dumps(res, indent=1))
    return res


def summarize(rows):
    def stats(sel, k):
        if not sel:
            return None
        d = np.array([r[k] - r["gauge"] for r in sel], dtype=float) / 100
        g = np.array([r["gauge"] for r in sel], dtype=float) / 100
        x = np.array([r[k] for r in sel], dtype=float) / 100
        return {"n": len(sel), "median_abs_in": round(float(np.median(np.abs(d))), 3),
                "mean_bias_in": round(float(d.mean()), 3), "median_bias_in": round(float(np.median(d)), 3),
                "within_0.10_in": round(float((np.abs(d) <= 0.10).mean()), 3),
                "within_25pct_or_0.10": round(float(((np.abs(d) <= np.maximum(0.10, 0.25 * g))).mean()), 3),
                "gauge_total_in": round(float(g.sum()), 2), "radar_total_in": round(float(x.sum()), 2)}
    wet = [r for r in rows if r["gauge"] >= 10 or r["native"] >= 10]
    big = [r for r in rows if r["gauge"] >= 50]
    out = {}
    for k in ("native", "pooled"):
        out[k] = {"all_days": stats(rows, k), "wet_days_0.10": stats(wet, k), "gauge_0.50_plus": stats(big, k),
                  "cocorahs_wet": stats([r for r in wet if r["net"] == "cocorahs"], k),
                  "coop_wet": stats([r for r in wet if r["net"] != "cocorahs"], k)}
    return out


def main(argv):
    if "--selftest" in argv:
        return selftest()
    if "--check" in argv:
        return check()
    if "--validate" in argv:
        i = argv.index("--validate")
        a = argv[i + 1] if len(argv) > i + 1 and not argv[i + 1].startswith("--") else None
        b = argv[i + 2] if len(argv) > i + 2 and not argv[i + 2].startswith("--") else a
        d0, d1 = dt.date.fromisoformat(a), dt.date.fromisoformat(b)
        days = [d0 + dt.timedelta(days=k) for k in range((d1 - d0).days + 1)]
        out = argv[argv.index("--out") + 1] if "--out" in argv else None
        shift = int(argv[argv.index("--shift") + 1]) if "--shift" in argv else 0
        validate(days, out, shift)
        return 0
    states = LOWER48
    if "--states" in argv:
        states = [s.strip().upper() for s in argv[argv.index("--states") + 1].split(",") if s.strip()]
        unknown = [s for s in states if s not in LOWER48]
        if unknown:
            print("not in MRMS coverage:", unknown)
            return 2
    return build(states)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
