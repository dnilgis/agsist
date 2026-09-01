#!/usr/bin/env python3
"""
fetch_mesh.py — radar-estimated hail swaths (MRMS MESH daily max) → GeoJSON.

THE POINT: the paid hail maps' core product is radar-derived MESH (Maximum
Estimated Size of Hail) swaths. MESH is public NOAA/MRMS data, archived by
Iowa State's mtarchive. This script pulls one day's CONUS daily-max MESH
grid, vectorizes it into contour polygons at damage-relevant thresholds
(0.75", 1", 1.5", 2"), and writes a small styleable GeoJSON the map renders
as swaths — the $249/month feature, at no charge, with the estimate honestly
labeled as an estimate.

Data: https://mtarchive.geol.iastate.edu/YYYY/MM/DD/mrms/ncep/MESH_Max_1440min/
      MESH_Max_1440min_00.50_YYYYMMDD-HHMMSS.grib2.gz  (we take the last file
      of the day = the full-day maximum). MESH values are millimeters.

Output: data/hail/mesh/YYYY-MM-DD.json  (FeatureCollection; each feature has
        properties {thresh_in, mesh_mm_min}) plus data/hail/mesh/index.json
        listing available dates. Grid is max-pooled to ~0.04° (~2.7 mi) before
        contouring — swaths stay honest at display scale and files stay small.

Retention: keeps the most recent KEEP_DAYS days plus any older date whose file
already exists (notable storms accumulate; nothing is deleted by default).

Usage:
  python scripts/fetch_mesh.py                # yesterday (UTC)
  python scripts/fetch_mesh.py 2026-06-12     # a specific date
  python scripts/fetch_mesh.py --selftest     # offline pipeline test, no network

v1 — 2026-07-03
"""

import gzip
import io
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone

import numpy as np

ARCHIVE = "https://mtarchive.geol.iastate.edu/{y}/{m:02d}/{d:02d}/mrms/ncep/MESH_Max_1440min/"
OUTDIR = "data/hail/mesh"
THRESH_IN = [0.75, 1.0, 1.5, 2.0]
MM_PER_IN = 25.4
POOL = 4            # 0.01° grid → 0.04° display grid (~2.7 mi) via max-pool
SIMPLIFY_DEG = 0.02 # ring simplification tolerance
KEEP_INDEX_DAYS = 400


def log(*a):
    print(*a, flush=True)


# ── contour engine (pure numpy + matplotlib; fully offline-testable) ────────
def maxpool(a, k):
    h, w = a.shape
    H, W = h // k, w // k
    return a[:H * k, :W * k].reshape(H, k, W, k).max(axis=(1, 3))


def simplify_ring(ring, tol):
    """Douglas-Peucker, iterative."""
    if len(ring) <= 4:
        return ring
    pts = np.asarray(ring, dtype=float)
    keep = np.zeros(len(pts), dtype=bool)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        seg = pts[j] - pts[i]
        L = np.hypot(*seg)
        if L == 0:
            d = np.hypot(*(pts[i + 1:j] - pts[i]).T)
        else:
            v = pts[i + 1:j] - pts[i]
            d = np.abs(seg[0] * v[:, 1] - seg[1] * v[:, 0]) / L  # 2-D cross magnitude
        k = int(np.argmax(d))
        if d[k] > tol:
            keep[i + 1 + k] = True
            stack += [(i, i + 1 + k), (i + 1 + k, j)]
    out = pts[keep].tolist()
    if out[0] != out[-1]:
        out.append(out[0])
    return out


def assemble(rings):
    """Contour rings → one valid MultiPolygon, with holes where holes belong.

    ── WHY THIS FUNCTION EXISTS ────────────────────────────────────────────
    Until 2026-09-01 each ring became its own hole-less polygon:

        polys.append([ring])

    matplotlib's `allsegs` returns OUTER boundaries and HOLE boundaries in the
    same flat list with nothing to tell them apart. So every hole in a hail
    swath was written out as a second solid shell sitting inside the first.
    Two things followed, and both were live for at least a month:

      1. A DOUGHNUT OF HAIL WAS PUBLISHED AS A FILLED DISC. The quiet middle
         of a swath counted as hail. This product mails growers to say hail
         passed over their field.
      2. The file was invalid GeoJSON — "Nested shells" — so every consumer
         that unions it was one GEOS call from an exception.

    Measured across the last 30 archived days: 25 carried an invalid band and
    9 of those made `unary_union` raise outright. `scripts/check_alerts.py`
    died on exactly that on 2026-09-01 and sent no alerts.

    THE ASSEMBLY IS EVEN-ODD, which is what a set of contour rings means: a
    point is inside the band when it is inside an odd number of rings. XOR
    gives that, and unlike a nesting test it does not care which way a ring
    was wound.

    Douglas-Peucker is also not self-intersection safe — it can fold a ring
    across itself, and rounding to three decimals can collapse two points onto
    one. So each ring is made valid before it joins the pile.
    """
    from functools import reduce
    from shapely.geometry import Polygon
    from shapely.geometry.base import BaseMultipartGeometry
    from shapely.validation import make_valid

    def areal(g):
        """make_valid can hand back stray lines and points; a band is an area."""
        if g.geom_type in ("Polygon", "MultiPolygon"):
            return g
        if isinstance(g, BaseMultipartGeometry):
            parts = [x for x in g.geoms if x.geom_type in ("Polygon", "MultiPolygon")]
            return reduce(lambda a, b: a.union(b), parts) if parts else None
        return None

    polys = []
    for ring in rings:
        p = Polygon(ring)
        if not p.is_valid:
            p = areal(make_valid(p))
        if p is not None and not p.is_empty and p.area > 0:
            polys.append(p)
    if not polys:
        return None

    # Largest first, so the common case — one outer ring and its holes — is a
    # single pass of subtractions rather than a pile of unions.
    polys.sort(key=lambda g: g.area, reverse=True)
    out = reduce(lambda a, b: a.symmetric_difference(b), polys)
    out = areal(out)
    if out is None or out.is_empty:
        return None
    if not out.is_valid:                      # belt and braces; never seen to fire
        out = areal(make_valid(out))
    return out


def geom_to_multipolygon(g):
    """shapely geometry → GeoJSON MultiPolygon coordinates, rounded as before."""
    parts = list(g.geoms) if g.geom_type == "MultiPolygon" else [g]
    coords = []
    for poly in parts:
        rings = [list(poly.exterior.coords)] + [list(r.coords) for r in poly.interiors]
        out = []
        for r in rings:
            ring = [[round(float(x), 3), round(float(y), 3)] for x, y in r]
            if ring[0] != ring[-1]:
                ring.append(ring[0])
            if len(ring) >= 4:
                out.append(ring)
        if out:
            coords.append(out)
    return coords


def contour_features(grid_mm, lons, lats):
    """grid → GeoJSON features per threshold (filled bands rendered as
    stacked polygons: each threshold's polygon covers everything ≥ it)."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    feats = []
    for t_in in THRESH_IN:
        t_mm = t_in * MM_PER_IN
        cs = plt.contourf(lons, lats, grid_mm, levels=[t_mm, 1e9])
        rings = []
        # matplotlib API: modern versions expose allsegs; each seg is a ring,
        # and an OUTER ring and a HOLE ring look identical here. assemble()
        # is what tells them apart.
        for seg in cs.allsegs[0]:
            if len(seg) < 4:
                continue
            ring = simplify_ring([[round(float(x), 3), round(float(y), 3)] for x, y in seg], SIMPLIFY_DEG)
            if len(ring) >= 4:
                rings.append(ring)
        plt.clf()
        g = assemble(rings) if rings else None
        polys = geom_to_multipolygon(g) if g is not None else []
        if polys:
            feats.append({
                "type": "Feature",
                "properties": {"thresh_in": t_in, "mesh_mm_min": round(t_mm, 1)},
                "geometry": {"type": "MultiPolygon", "coordinates": polys},
            })
    plt.close("all")
    return feats


# ── grib acquisition ────────────────────────────────────────────────────────
def fetch_day_grib(dt):
    """Return (values_mm ndarray, lons 1d, lats 1d) for the day's max, or None."""
    import requests

    def _get(u, timeout):
        """One transient blip must not crash the whole mesh run: retry once,
        then return None (caller already treats None/!=200 as a soft miss)."""
        for attempt in (1, 2):
            try:
                return requests.get(u, timeout=timeout)
            except requests.RequestException as e:
                log("  GET failed (attempt %d): %s" % (attempt, e))
                if attempt == 1:
                    time.sleep(5)
        return None

    url = ARCHIVE.format(y=dt.year, m=dt.month, d=dt.day)
    log("  listing", url)
    r = _get(url, timeout=30)
    if r is None:
        return None
    if r.status_code != 200:
        log("  archive listing HTTP", r.status_code)
        return None
    names = re.findall(r'href="(MESH_Max_1440min[^"]+\.grib2\.gz)"', r.text)
    if not names:
        log("  no MESH files listed for this date")
        return None
    fname = sorted(names)[-1]  # last file of the day = full-day maximum
    # Expose the observation time for partial-day runs. MUST be ISO 8601
    # EXTENDED (2026-07-14T17:00:00Z): the page does Date.parse(meta.as_of),
    # and basic format (20260714T170000Z) yields Invalid Date -> NaN age ->
    # the ">5h stale" guard silently fails open and labels old radar LIVE.
    fetch_day_grib.as_of = None
    m_ts = re.search(r"(\d{8})-(\d{6})", fname)
    if m_ts:
        d8, t6 = m_ts.group(1), m_ts.group(2)
        fetch_day_grib.as_of = "%s-%s-%sT%s:%s:%sZ" % (
            d8[:4], d8[4:6], d8[6:8], t6[:2], t6[2:4], t6[4:6])
    log("  fetching", fname)
    g = _get(url + fname, timeout=120)
    if g is None:
        return None
    if g.status_code != 200:
        log("  grib HTTP", g.status_code)
        return None
    raw = gzip.decompress(g.content)
    tmp = "/tmp/mesh.grib2"
    open(tmp, "wb").write(raw)
    import xarray as xr
    ds = xr.open_dataset(tmp, engine="cfgrib", backend_kwargs={"indexpath": ""})
    var = list(ds.data_vars)[0]
    vals = ds[var].values.astype(np.float32)
    lats = ds["latitude"].values.astype(float)
    lons = ds["longitude"].values.astype(float)
    if lons.max() > 180:      # MRMS uses 0–360 longitudes
        lons = lons - 360.0
    if lats[0] > lats[-1]:    # north-to-south → flip for contouring
        lats = lats[::-1]
        vals = vals[::-1, :]
    vals = np.nan_to_num(vals, nan=0.0)
    vals[vals < 0] = 0.0      # MRMS missing sentinels are negative
    return vals, lons, lats


def process_day(dt):
    got = fetch_day_grib(dt)
    if got is None:
        return None
    vals, lons, lats = got
    log("  grid", vals.shape, "max mesh", round(float(vals.max()), 1), "mm")
    vp = maxpool(vals, POOL)
    lp = lons[: (len(lons) // POOL) * POOL].reshape(-1, POOL).mean(axis=1)
    la = lats[: (len(lats) // POOL) * POOL].reshape(-1, POOL).mean(axis=1)
    feats = contour_features(vp, lp, la)
    return {
        "type": "FeatureCollection",
        "properties": {
            "date": dt.strftime("%Y-%m-%d"),
            "source": "NOAA MRMS MESH daily max via Iowa State mtarchive",
            "units_note": "MESH is a RADAR ESTIMATE of maximum hail size, ~1 km native resolution, pooled to ~0.04 deg for display. It is not a ground measurement.",
            "thresholds_in": THRESH_IN,
            "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
        "features": feats,
    }


def update_index():
    dates = sorted(
        f[:-5] for f in os.listdir(OUTDIR)
        if re.match(r"^\d{4}-\d{2}-\d{2}\.json$", f)
    )[-KEEP_INDEX_DAYS:]
    json.dump({"dates": dates, "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d")},
              open(os.path.join(OUTDIR, "index.json"), "w"))
    log("index:", len(dates), "dates")


def selftest():
    """Offline: synthetic MESH field → contours → valid GeoJSON, ring sanity."""
    log("SELFTEST: synthetic swath")
    lats = np.arange(38.0, 42.0, 0.01)
    lons = np.arange(-102.0, -96.0, 0.01)
    LN, LT = np.meshgrid(lons, lats)
    # a NE-tracking elliptical swath peaking at 55 mm (~2.2")
    d = ((LN + 99.4) * 0.9 + (LT - 40.0) * -1.1) ** 2 / 1.2 + ((LN + 99.4) * 1.1 + (LT - 40.0) * 0.9) ** 2 / 0.05
    vals = np.maximum(0, 55.0 * np.exp(-d)).astype(np.float32)
    vp = maxpool(vals, POOL)
    lp = lons[: (len(lons) // POOL) * POOL].reshape(-1, POOL).mean(axis=1)
    la = lats[: (len(lats) // POOL) * POOL].reshape(-1, POOL).mean(axis=1)
    feats = contour_features(vp, lp, la)
    assert feats, "no features from a 55 mm swath"
    ts = [f["properties"]["thresh_in"] for f in feats]
    assert 0.75 in ts and 2.0 in ts, f"threshold bands missing: {ts}"
    for f in feats:
        for poly in f["geometry"]["coordinates"]:
            for ring in poly:
                assert len(ring) >= 4 and ring[0] == ring[-1], "ring not closed"
                for x, y in ring:
                    assert -103 < x < -95 and 37 < y < 43, f"coord out of bounds {x},{y}"
    # nesting: the 2.0" polygon must sit inside the 0.75" polygon's bbox
    def bbox(f):
        xs = [p[0] for poly in f["geometry"]["coordinates"] for ring in poly for p in ring]
        ys = [p[1] for poly in f["geometry"]["coordinates"] for ring in poly for p in ring]
        return min(xs), min(ys), max(xs), max(ys)
    b75, b20 = bbox(feats[0]), bbox(feats[-1])
    assert b75[0] <= b20[0] and b75[2] >= b20[2], "bands not nested"
    # empty grid → no features
    assert contour_features(np.zeros_like(vp), lp, la) == [], "empty grid produced features"
    json.dumps({"type": "FeatureCollection", "features": feats})

    # ── EVERY BAND MUST BE VALID GEOMETRY ────────────────────────────────
    # This assertion did not exist until 2026-09-01, and that is the whole
    # reason a month of swath files shipped invalid. The old selftest checked
    # that rings were closed and inside the box — both true of a hole drawn
    # as a solid shell.
    from shapely.geometry import shape as _shape
    from shapely.validation import explain_validity as _why
    for f in feats:
        g = _shape(f["geometry"])
        assert g.is_valid, ("band %s is invalid: %s"
                            % (f["properties"]["thresh_in"], _why(g)))

    # ── A HOLE IN THE SWATH MUST COME OUT AS A HOLE ──────────────────────
    # A ring of hail with a quiet middle. Before assemble() this produced two
    # solid shells, one inside the other: nested shells, invalid, and the
    # quiet middle counted as hail on a page that mails growers about it.
    R = np.hypot(LN + 99.0, LT - 40.0)
    donut = np.where((R > 0.45) & (R < 1.05), 40.0, 0.0).astype(np.float32)
    dp = maxpool(donut, POOL)
    dfeats = contour_features(dp, lp, la)
    assert dfeats, "the donut produced no band at all"
    dg = _shape(dfeats[0]["geometry"])
    assert dg.is_valid, "donut band invalid: " + _why(dg)
    holes = sum(len(p.interiors) for p in
                (dg.geoms if dg.geom_type == "MultiPolygon" else [dg]))
    assert holes >= 1, "the donut came out solid — holes are being drawn as fill"
    from shapely.geometry import Point as _Point
    assert not dg.contains(_Point(-99.0, 40.0)), \
        "the quiet middle of the swath is inside the band"

    log("SELFTEST OK —", sum(len(f['geometry']['coordinates']) for f in feats),
        "polygons across", len(feats), "bands; donut kept", holes, "hole(s)")


def run_partial():
    """Rolling 24-hour MESH as of right now: today's UTC directory fills all
    day, so its newest file IS the last-24h maximum at fetch time. Writes a
    single overwriting file, never touches the dated archive or its index —
    the finished day still posts via the normal morning run."""
    dt = datetime.now(timezone.utc)
    os.makedirs(OUTDIR, exist_ok=True)
    out = os.path.join(OUTDIR, "today-partial.json")
    log("MESH partial (last 24h) as of", dt.strftime("%Y-%m-%d %H:%MZ"))
    fc = process_day(dt)
    if fc is None:
        log("no partial data yet today — removing any stale partial")
        if os.path.exists(out):
            os.remove(out)
        return
    # process_day() returns its header under "properties" (the dated-archive
    # contract). The page reads the PARTIAL's header as fc.meta.as_of, so the
    # partial file renames it. Writing fc["meta"][...] directly was a KeyError
    # on every run that found data — which is why no partial ever committed.
    fc["meta"] = fc.pop("properties")
    fc["meta"]["partial"] = True
    fc["meta"]["as_of"] = getattr(fetch_day_grib, "as_of", None) or dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    fc["meta"]["units_note"] = ("ROLLING 24-HOUR radar ESTIMATE of maximum hail size, still in progress. "
                                "Not a ground measurement; the finished day posts the next morning.")
    json.dump(fc, open(out, "w"), separators=(",", ":"))
    log("wrote", out, f"({os.path.getsize(out)//1024} KB, {len(fc['features'])} bands)")


def main():
    if "--selftest" in sys.argv:
        selftest()
        return
    if "--partial" in sys.argv:
        run_partial()
        return
    arg = next((a for a in sys.argv[1:] if re.match(r"^\d{4}-\d{2}-\d{2}$", a)), None)
    dt = (datetime.strptime(arg, "%Y-%m-%d") if arg
          else datetime.now(timezone.utc) - timedelta(days=1))
    os.makedirs(OUTDIR, exist_ok=True)
    # the finished day supersedes any partial from yesterday
    stale = os.path.join(OUTDIR, "today-partial.json")
    if os.path.exists(stale):
        try:
            pd = json.load(open(stale)).get("meta", {}).get("date")
            if pd and pd <= dt.strftime("%Y-%m-%d"):
                os.remove(stale)
                log("removed superseded partial for", pd)
        except (ValueError, KeyError):
            os.remove(stale)
    out = os.path.join(OUTDIR, dt.strftime("%Y-%m-%d") + ".json")
    log("MESH", dt.strftime("%Y-%m-%d"))
    fc = process_day(dt)
    if fc is None:
        log("no data for this date — leaving existing files untouched")
        # Fail-soft: still refresh the index so the front end stays truthful.
        update_index()
        return
    json.dump(fc, open(out, "w"), separators=(",", ":"))
    kb = os.path.getsize(out) // 1024
    log("wrote", out, f"({kb} KB, {len(fc['features'])} bands)")
    update_index()


if __name__ == "__main__":
    main()
