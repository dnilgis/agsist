#!/usr/bin/env python3
"""Section soil from the bulk gridded soil map, cropland only and whole section (Oct 29, 2026,
property panel step 6, the bulk route in the soil research: notes/chatgpt/2026-10-29-answers/soilcomps).

Why a second route. The Soil Data Access route (scripts/land_soil.py --fetch) clips each section
against the soil polygons, but the corn and soybean NCCPI it can read (component interpretations)
are filled in only some survey areas (Indiana yes; Illinois 27 of 8,464 map units, Wisconsin none).
The ready-made corn and soybean ratings (gSSURGO valu1: nccpi3corn, nccpi3soy, nccpi3all) are not in
Soil Data Access. They are published as 10 m rasters in gNATSGO, which in IL, IN and WI is the
detailed SSURGO survey everywhere (gNATSGO only fills gaps where SSURGO has none). We read them
from the Microsoft Planetary Computer copy (collection gnatsgo-rasters, cloud-optimized GeoTIFFs,
read by window, no statewide download) and the NASS Cropland Data Layer the same way
(collection usda-cdl).

Per section (BLM PLSS outline, the same match as land_soil.find_sections):
  whole section: mean nccpi3corn, nccpi3soy, nccpi3all over 10 m cells whose centre is inside
                 and that carry a rating (missing is missing, never 0), and the rated share
  cropland:      the same means over cells the Cropland Data Layer called cultivated in the mask
                 year, and the cropland share of the section. The mask year is the newest CDL
                 year before the sale year (never the sale year or later: no look-ahead)
  check:         the Soil Data Access map unit NCCPI averaged over the same 10 m cells, to set
                 beside the polygon-clipped average from land_soil.py (raster versus polygon)
A section average is not the field's soil.

Runs in Actions (land-data.yml task soilr-probe or soilr:<ST>, dispatch only). Output:
data/land-raw/soil/<ST>-raster.json.gz, saved to the raw branch, never deployed.

  python3 scripts/land_soil_raster.py --selftest
  python3 scripts/land_soil_raster.py --fetch IL [--limit N] [--minutes M]     (Actions)
"""
import concurrent.futures as cf
import gzip
import json
import math
import os
import sys
import threading
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import land_soil as L  # noqa: E402

STAC = "https://planetarycomputer.microsoft.com/api/stac/v1"
SOIL_COLL, CDL_COLL = "gnatsgo-rasters", "usda-cdl"
VALS = ("nccpi3corn", "nccpi3soy", "nccpi3all")
# NASS cultivated classes (the CDL "cultivated layer" definition): crops, fallow/idle, double crops.
CULTIVATED = frozenset(list(range(1, 62)) + list(range(66, 78)) + list(range(204, 255)))
STATE_BBOX = {"IL": (-91.52, 36.97, -87.49, 42.51), "IN": (-88.10, 37.77, -84.78, 41.77), "WI": (-92.89, 42.49, -86.80, 47.31)}
SQM_TO_AC = 0.000247105


def mask_year(sale_year, avail):
    """Newest CDL year strictly before the sale year, else None (a later map would be look-ahead)."""
    prior = [y for y in avail if y < sale_year]
    return max(prior) if prior else None


def zonal(sec, vals, crop=None, sda=None):
    """sec: int grid of section ids (0 = none); vals {name: float grid, NaN = no rating};
    crop {year: bool grid} or None; sda float grid or None ->
    {id: {"n", "rated", name..., "sda_r", "m": {year: [crop cells, corn, soy, all]}}}."""
    import numpy as np
    out = {}
    ids = [int(i) for i in np.unique(sec) if i]
    for i in ids:
        inside = sec == i
        n = int(inside.sum())
        if not n:
            continue
        rec = {"n": n}
        ok_c = inside & np.isfinite(vals[VALS[0]])
        rec["rated"] = round(float(ok_c.sum()) / n, 4)
        for name in VALS:
            v = vals[name]
            ok = inside & np.isfinite(v)
            rec[name] = round(float(v[ok].mean()), 4) if ok.any() else None
        if sda is not None:
            ok = inside & np.isfinite(sda)
            rec["sda_r"] = round(float(sda[ok].mean()), 4) if ok.any() else None
        if crop:
            m = {}
            for y, cg in crop.items():
                ci = inside & cg
                cn = int(ci.sum())
                row = [cn]
                for name in VALS:
                    v = vals[name]
                    ok = ci & np.isfinite(v)
                    row.append(round(float(v[ok].mean()), 4) if ok.any() else None)
                m[str(y)] = row
            rec["m"] = m
        out[i] = rec
    return out


# ── Actions only from here (rasterio, pyproj, pystac-client, planetary-computer) ──

_lock = threading.Lock()
_seen = {}


def client():
    import planetary_computer as pc
    import pystac_client
    return pystac_client.Client.open(STAC, modifier=pc.sign_inplace)


def items_for(cat, coll, bbox, **kw):
    its = list(cat.search(collections=[coll], bbox=bbox, **kw).items())
    return its


def item_year(it):
    d = it.datetime or it.common_metadata.start_datetime
    return d.year if d else None


def href(it, asset):
    import planetary_computer as pc
    with _lock:
        return pc.sign(it.assets[asset].href)


def bbox_hit(a, b):
    return not (a[2] < b[0] or b[2] < a[0] or a[3] < b[1] or b[3] < a[1])


def read_mosaic(its, asset, bounds, res, dtype, fill):
    """Read one grid (bounds in the rasters' CRS, cell size res, top-left anchored) from every
    item that covers part of it; the first non-fill value wins."""
    import numpy as np
    import rasterio
    from rasterio.windows import from_bounds
    x0, y0, x1, y1 = bounds
    w, h = int(round((x1 - x0) / res)), int(round((y1 - y0) / res))
    out = np.full((h, w), fill, dtype=dtype)
    got = False
    for it in its:
        with rasterio.open(href(it, asset)) as ds:
            b = ds.bounds
            if b.right <= x0 or b.left >= x1 or b.top <= y0 or b.bottom >= y1:
                continue
            win = from_bounds(x0, y0, x1, y1, ds.transform).round_offsets().round_lengths()
            a = ds.read(1, window=win, boundless=True, fill_value=ds.nodata if ds.nodata is not None else fill,
                        out_shape=(h, w)).astype(dtype)
            nd = ds.nodata
            if nd is not None:
                a = np.where(a == nd, fill, a) if not (isinstance(nd, float) and math.isnan(nd)) else a
            if np.issubdtype(np.dtype(dtype), np.floating):
                put = ~np.isfinite(out) & np.isfinite(a)
            else:
                put = (out == fill) & (a != fill)
            out[put] = a[put]
            got = True
    return out if got else None


def grid_of(its, asset):
    import rasterio
    with rasterio.open(href(its[0], asset)) as ds:
        t = ds.transform
        return ds.crs, t.a, t.c, t.f


def run(st, limit=None, minutes=120, today=None):
    import numpy as np
    from pyproj import Transformer
    from rasterio.features import rasterize
    today = today or time.strftime("%Y-%m-%d")
    t0 = time.time()
    rows, secs, twps, sections, miss, layer, fld, probe, cands = L.find_sections(st, limit, today)
    # sale years per section -> the CDL years each needs
    years_of = {}
    for r in rows:
        c = sections.get(str(r["fips"]) + "|" + r["str"])
        if c:
            years_of.setdefault(c["pid"] + "|" + str(c["sec"]), set()).add(int(str(r["date"])[:4]))
    uniq = {}
    for key, c in sections.items():
        uniq.setdefault(c["pid"] + "|" + str(c["sec"]), c)
    # the SDA map unit NCCPI from the saved polygon answers (raster versus polygon check)
    sda_mu, sda_poly = {}, {}
    sp = os.path.join(L.RAW, "%s-soil.json.gz" % st)
    if os.path.exists(sp):
        with gzip.open(sp, "rt", encoding="utf-8") as fh:
            sd = json.load(fh)
        for k, rws in sd["soil"].items():
            s = L.summarize(rws)
            sda_poly[k] = None if not s else s["nccpi"]
            for r in rws:
                if r[3] is not None:
                    sda_mu[str(r[0])] = r[3]
    print("%s: %d distinct sections, SDA map units on file %d" % (st, len(uniq), len(sda_mu)))
    cat = client()
    bb = STATE_BBOX[st]
    soil_its = items_for(cat, SOIL_COLL, bb)
    print("gnatsgo-rasters items over %s: %d; assets of the first: %s" % (st, len(soil_its), sorted(soil_its[0].assets) if soil_its else None))
    if not soil_its:
        raise SystemExit("no gnatsgo-rasters items")
    have = set(soil_its[0].assets)
    miss_assets = [a for a in VALS + ("mukey",) if a not in have]
    if miss_assets:
        raise SystemExit("gnatsgo-rasters lacks " + ", ".join(miss_assets))
    cdl_its = [it for it in items_for(cat, CDL_COLL, bb) if "cropland" in it.assets]
    cdl_by = {}
    for it in cdl_its:
        cdl_by.setdefault(item_year(it), []).append(it)
    avail = sorted(y for y in cdl_by if y)
    print("usda-cdl cropland years over %s: %s" % (st, avail))
    crs, res, gx0, gy0 = grid_of(soil_its, "mukey")
    print("soil grid: %s, %.1f m" % (crs, res))
    ccrs, cres, cx0, cy0 = (grid_of(cdl_by[avail[-1]], "cropland") if avail else (None, None, None, None))
    if avail:
        print("CDL grid: %s, %.1f m (newest year)" % (ccrs, cres))
    to_soil = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
    # townships -> sections
    by_twp = {}
    for k, c in uniq.items():
        by_twp.setdefault(c["pid"], []).append((k, c))
    out, fails, errs = {}, 0, []
    mu_pairs = {}

    def do_twp(pid):
        group = by_twp[pid]
        polys, xs, ys = [], [], []
        for idx, (k, c) in enumerate(group, start=1):
            prj = []
            for ring in c["rings"]:
                px, py = to_soil.transform([p[0] for p in ring], [p[1] for p in ring])
                prj.append(list(zip(px, py)))
                xs += list(px)
                ys += list(py)
            polys.append((idx, prj))
        x0 = math.floor((min(xs) - gx0) / res) * res + gx0 - res
        x1 = math.ceil((max(xs) - gx0) / res) * res + gx0 + res
        y1 = gy0 - math.floor((gy0 - max(ys)) / res) * res + res
        y0 = gy0 - math.ceil((gy0 - min(ys)) / res) * res - res
        w, h = int(round((x1 - x0) / res)), int(round((y1 - y0) / res))
        from rasterio.transform import from_origin
        tr = from_origin(x0, y1, res, res)
        shapes = []
        holes = []
        for idx, prj in polys:
            for ring in prj:
                a = sum(ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1] for i in range(len(ring) - 1))
                (holes if a > 0 else shapes).append(({"type": "Polygon", "coordinates": [ring]}, idx))  # ESRI outer rings run clockwise
        if not shapes:  # rings the other way round: treat all as outer
            shapes, holes = holes, []
        sec = rasterize(shapes, out_shape=(h, w), transform=tr, fill=0, dtype="int32")
        if holes:
            hm = rasterize([(g, 1) for g, _ in holes], out_shape=(h, w), transform=tr, fill=0, dtype="uint8")
            sec[hm == 1] = 0
        bounds = (x0, y0, x1, y1)
        # items whose footprint (WGS84 bbox) touches this township
        lon = [p[0] for _, c in group for r in c["rings"] for p in r]
        lat = [p[1] for _, c in group for r in c["rings"] for p in r]
        tb = (min(lon) - 0.01, min(lat) - 0.01, max(lon) + 0.01, max(lat) + 0.01)
        its = [it for it in soil_its if it.bbox is None or bbox_hit(it.bbox, tb)] or soil_its
        vals = {}
        for name in VALS:
            v = read_mosaic(its, name, bounds, res, "float32", np.nan)
            if v is None:
                raise RuntimeError("no %s over township %s" % (name, pid))
            if not _seen.get(name):
                _seen[name] = 1
                fin = v[np.isfinite(v)]
                print("first read %s: %s cells, raw range %s to %s" % (name, fin.size, fin.min() if fin.size else None, fin.max() if fin.size else None))
            v = np.where((v > 0) & (v <= 1), v, np.nan)
            vals[name] = v
        mk = read_mosaic(its, "mukey", bounds, res, "int64", 0)
        sda = None
        if sda_mu and mk is not None:
            u, inv = np.unique(mk, return_inverse=True)
            lut = np.array([sda_mu.get(str(int(x)), np.nan) for x in u], dtype="float64")
            sda = lut[inv].reshape(mk.shape)
        pairs = {}
        if mk is not None:
            flat = mk.ravel()
            fin = np.isfinite(vals["nccpi3corn"].ravel())
            u, first = np.unique(flat[fin], return_index=True)
            idxs = np.nonzero(fin)[0][first]
            for m_, ii in zip(u[:400], idxs[:400]):
                pairs[str(int(m_))] = [round(float(vals[n].ravel()[ii]), 4) if np.isfinite(vals[n].ravel()[ii]) else None for n in VALS]
        need = set()
        for k, _ in group:
            for y in years_of.get(k, ()):
                my = mask_year(y, avail)
                if my:
                    need.add(my)
        crop = {}
        if need:
            hh, ww = sec.shape
            cx = x0 + (np.arange(ww) + 0.5) * res
            cy = y1 - (np.arange(hh) + 0.5) * res
            for yr in sorted(need):
                cits = [it for it in cdl_by[yr] if it.bbox is None or bbox_hit(it.bbox, tb)] or cdl_by[yr]
                c_crs, c_res, c_x0, c_y0 = grid_of(cits, "cropland")
                # the 10 m cell centres in the CDL's own coordinates (the two Albers grids are
                # nominally the same projection; transform anyway rather than assume it)
                gx, gy = np.meshgrid(cx, cy)
                if c_crs != crs:
                    tx, ty = Transformer.from_crs(crs, c_crs, always_xy=True).transform(gx.ravel(), gy.ravel())
                    gx, gy = np.asarray(tx).reshape(gx.shape), np.asarray(ty).reshape(gy.shape)
                bx0 = math.floor((gx.min() - c_x0) / c_res) * c_res + c_x0 - c_res
                bx1 = math.ceil((gx.max() - c_x0) / c_res) * c_res + c_x0 + c_res
                by1 = c_y0 - math.floor((c_y0 - gy.max()) / c_res) * c_res + c_res
                by0 = c_y0 - math.ceil((c_y0 - gy.min()) / c_res) * c_res - c_res
                cg = read_mosaic(cits, "cropland", (bx0, by0, bx1, by1), c_res, "int16", 0)
                if cg is None:
                    continue
                ci = np.clip(((gx - bx0) // c_res).astype(int), 0, cg.shape[1] - 1)
                ri = np.clip(((by1 - gy) // c_res).astype(int), 0, cg.shape[0] - 1)
                sub = cg[ri, ci]
                if not _seen.get("cdl"):
                    _seen["cdl"] = 1
                    print("first CDL read %d: %s -> %s, crs equal %s, cultivated share of window %.2f" % (yr, c_crs, crs, c_crs == crs, float(np.isin(sub, list(CULTIVATED)).mean())))
                crop[yr] = np.isin(sub, list(CULTIVATED))
        z = zonal(sec, vals, crop, sda)
        if not _seen.get("zonal") and z:
            _seen["zonal"] = 1
            print("first township %s: %d sections, cells per section %s, first %s" % (pid, len(z), sorted(r["n"] for r in z.values()), json.dumps(next(iter(z.values())))[:400]))
        res_d = {}
        for idx, (k, c) in enumerate(group, start=1):
            r = z.get(idx)
            if r:
                r["ac"] = round(r["n"] * res * res * SQM_TO_AC, 1)
                r["sda_p"] = sda_poly.get(k)
                res_d[k] = r
        return res_d, pairs

    todo = sorted(by_twp)
    with cf.ThreadPoolExecutor(max_workers=6) as ex:
        futs = {ex.submit(do_twp, p): p for p in todo}
        for n, fu in enumerate(cf.as_completed(futs)):
            if time.time() - t0 > minutes * 60:
                for f2 in futs:
                    f2.cancel()
                print("::warning::%s raster soil: stopped at the time budget after %d townships" % (st, n))
                break
            try:
                d, pairs = fu.result()
                out.update(d)
                if len(mu_pairs) < 20000:
                    mu_pairs.update(pairs)
            except Exception as e:  # noqa: BLE001
                fails += 1
                if len(errs) < 5:
                    errs.append("%s: %s" % (futs[fu], str(e)[:300]))
                    print("::warning::township %s failed: %s" % (futs[fu], str(e)[:300]))
            if n % 100 == 0:
                print("%s raster %d/%d townships (%d failed), %.0f s" % (st, n, len(todo), fails, time.time() - t0))
    secmap = {k: c["pid"] + "|" + str(c["sec"]) for k, c in sections.items()}
    meta = {"state": st, "fetched_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "sales": len(rows), "keys": len(secs),
            "sections": len(sections), "distinct": len(uniq), "townships": len(todo), "done": len(out), "township_failed": fails,
            "errors": errs, "miss": miss, "cdl_years": avail, "soil_items": len(soil_its), "soil_grid": [str(crs), res],
            "sources": [L.BLM, STAC + "/collections/" + SOIL_COLL, STAC + "/collections/" + CDL_COLL],
            "minutes": round((time.time() - t0) / 60, 1)}
    os.makedirs(L.RAW, exist_ok=True)
    with gzip.open(os.path.join(L.RAW, "%s-raster.json.gz" % st), "wt", encoding="utf-8") as fh:
        json.dump({"meta": meta, "keys": secmap, "sections": out, "mukey_valu1": mu_pairs}, fh, separators=(",", ":"))
    with open(os.path.join(L.RAW, "%s-raster-meta.json" % st), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=1)
    print(json.dumps(meta)[:2000])
    return meta


def selftest():
    import numpy as np
    fails = 0

    def ck(name, ok):
        nonlocal fails
        print(("ok   " if ok else "FAIL ") + name)
        fails += 0 if ok else 1

    ck("mask year is the newest CDL year before the sale", mask_year(2024, [2019, 2022, 2023, 2024, 2025]) == 2023)
    ck("no CDL year before the sale: no mask", mask_year(2008, [2008, 2009]) is None)
    ck("cultivated: corn, soybeans, fallow, double crop", all(c in CULTIVATED for c in (1, 5, 61, 241)))
    ck("not cultivated: pasture, forest, water, developed", not any(c in CULTIVATED for c in (62, 176, 141, 111, 121, 190)))
    sec = np.array([[1, 1, 0], [1, 2, 2], [0, 2, 2]], dtype="int32")
    n = np.nan
    corn = np.array([[0.8, 0.6, 0.1], [n, 0.5, 0.3], [0.9, n, 0.7]], dtype="float32")
    vals = {"nccpi3corn": corn, "nccpi3soy": corn * 0.5, "nccpi3all": corn}
    crop = {2023: np.array([[True, False, True], [True, True, True], [False, False, False]])}
    sda = np.array([[0.7, 0.7, 0], [0.7, 0.4, 0.4], [0, 0.4, 0.4]])
    z = zonal(sec, vals, crop, sda)
    ck("whole-section mean over rated cells only", abs(z[1]["nccpi3corn"] - 0.7) < 1e-6 and abs(z[1]["rated"] - 2 / 3) < 1e-3)
    ck("section 2 mean", abs(z[2]["nccpi3corn"] - 0.5) < 1e-6 and z[2]["n"] == 4)
    ck("cropland cells only", z[1]["m"]["2023"][0] == 2 and abs(z[1]["m"]["2023"][1] - 0.8) < 1e-6)
    ck("cropland with no rated cell is missing, not 0", z[2]["m"]["2023"][0] == 2 and abs(z[2]["m"]["2023"][1] - 0.4) < 1e-6)
    ck("SDA values over the same cells", abs(z[1]["sda_r"] - 0.7) < 1e-6 and abs(z[2]["sda_r"] - 0.4) < 1e-6)
    ck("empty grid: no sections", zonal(np.zeros((2, 2), dtype="int32"), vals | {k: v[:2, :2] for k, v in vals.items()}) == {})
    with open(__file__, encoding="utf-8") as fh:
        ck("no em dash in this file", chr(0x2014) not in fh.read())
    print("FAILS=%d" % fails)
    return fails


def main(argv):
    if "--selftest" in argv:
        return 1 if selftest() else 0
    if "--fetch" in argv:
        st = argv[argv.index("--fetch") + 1].upper()
        lim = int(argv[argv.index("--limit") + 1]) if "--limit" in argv else None
        mins = float(argv[argv.index("--minutes") + 1]) if "--minutes" in argv else 120
        if st not in L.STATES:
            raise SystemExit("state must be one of " + ", ".join(L.STATES))
        run(st, lim, mins)
        return 0
    print(__doc__)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
