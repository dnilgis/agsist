#!/usr/bin/env python3
"""Soil for each recorded farm sale's section, and the test of whether it narrows the comp spread
(Oct 29, 2026, property panel step 6: "soil per comp, hypothesis, test first").

Nothing here writes to a page. The fetch runs in Actions (land-data.yml task soil-probe or soil:<ST>,
dispatch only) because the sandbox cannot reach the services; the answers go to data/land-raw/soil/,
which the run saves to the raw branch (never deployed). The test reads them back offline.

WHICH SALES. The one land rule (scripts/build_land_summary.py farm_comp): a market sale, 20+ known
acres, $500+/acre, no buildings, not forest; and a section key (column "str", scripts/land_keys.py).

WHERE THE SECTION IS. BLM's national PLSS (CadNSDI), the first-division (section) layer, asked by
township with the meridian left open (our keys rarely carry it). Of the sections that come back with
the sale's township, range and section number, the one inside the sale's county (Census county
outline, data/atlas/counties.geo.json) is the sale's section; none or two inside: no soil, counted.

WHAT SOIL. USDA NRCS SSURGO through Soil Data Access, the section outline clipped against the soil
map (the same SDA macros as the Field Scout worker). Per map unit: acres in the section, dominant
nonirrigated capability class, NCCPI 3.0 (component-weighted), and the state crop productivity index
(component cropprodindex, where the state fills it). Per section:
  nccpi      NCCPI over every rated acre in the section
  nccpi_c14  NCCPI over capability class 1 to 4 acres only, a stand-in for the cropland in it
  cpi        the state crop productivity index, same weights, where populated
  c14        share of the section's mapped acres in class 1 to 4
A section average is not the field's soil. That limit is stated wherever a number from here shows.

THE TEST (fixed before the answers were read, Oct 29):
  Groups: county and sale year, 5+ sales with soil. Spread: middle half (q3 - q1) of $/acre.
  Adjustment: adj = $/acre - b * (points - group median points), points = NCCPI x 100.
  b ($ per point) is fit per state on ONE year (OLS of group-demeaned $/acre on group-demeaned
  points) and applied to the NEXT year only. No look-ahead.
  Report per state and test year: groups, sales, median spread before and after, the share of
  groups that narrowed, the pooled change with a bootstrap 90% interval over groups, and a placebo
  (points shuffled inside each group, the same b, 200 times).
  HOLDS for a state only if, pooled over test years: the median group narrows 5% or more, the
  bootstrap interval of the pooled change stays below zero, and fewer than 5% of placebo draws
  narrow as much. Otherwise it does not hold, and nothing ships on pages.

  python3 scripts/land_soil.py --selftest
  python3 scripts/land_soil.py --keys                      count the sections needed (offline)
  python3 scripts/land_soil.py --fetch IL [--limit N] [--minutes M]   (Actions)
  python3 scripts/land_soil.py --test [dir]                the test, from the saved answers (offline)
"""
import concurrent.futures as cf
import gzip
import json
import math
import os
import random
import re
import sys
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import build_land_summary as B  # noqa: E402

GEO = os.path.join(ROOT, "data", "atlas", "counties.geo.json")
RAW = os.path.join(ROOT, "data", "land-raw", "soil")
STATES = ("IL", "IN", "WI")
BLM = "https://gis.blm.gov/arcgis/rest/services/Cadastral/BLM_Natl_PLSS_CadNSDI/MapServer"
SDA = "https://sdmdataaccess.nrcs.usda.gov/Tabular/post.rest"
UA = "agsist.com land research (contact via agsist.com)"
NCCPI_RULE = "NCCPI - National Commodity Crop Productivity Index (Ver 3.0)"
NEAR_DEG = 0.015        # a section centroid this close outside its county still counts (20m county outlines)
MIN_GROUP = 5
KEY_RE = re.compile(r"^(\d{1,2})-(\d{1,3})([NS?])-(\d{1,3})([EW?])(?:-(\d))?$")


# ── keys ────────────────────────────────────────────────────────────────────

def parse_key(k):
    """'29-15N-6E-4' -> (29, 15, 'N', 6, 'E', 4); '17-11?-5?' -> (17, 11, '?', 5, '?', None); else None."""
    m = KEY_RE.match(str(k or ""))
    if not m:
        return None
    sec, t, ns, r, ew, pm = m.groups()
    sec, t, r = int(sec), int(t), int(r)
    if not (1 <= sec <= 36 and t > 0 and r > 0):
        return None
    return (sec, t, ns, r, ew, int(pm) if pm else None)


def twp_like(st, t, ns, r, ew):
    """A PLSSID pattern for one township, meridian (and a '?' direction) left open: IL__0140S0020E_."""
    return "%s__%03d0%s%03d0%s_" % (st, t, "_" if ns == "?" else ns, r, "_" if ew == "?" else ew)


def comps(st, today):
    """Every sale that may feed a middle and carries a section key, as dicts."""
    out = []
    for f in B.load_state(st):
        for r in B.county_rows(f, today):
            if B.farm_comp(r, st) and parse_key(r.get("str")):
                out.append(r)
    return out


def needed(rows):
    """{(fips, key)} and {township pattern}."""
    secs, twps = set(), set()
    for r in rows:
        p = parse_key(r["str"])
        secs.add((str(r["fips"]), r["str"]))
        twps.add(twp_like(r["st"], p[1], p[2], p[3], p[4]))
    return secs, twps


# ── geometry ────────────────────────────────────────────────────────────────

def load_counties(states, geo=GEO):
    with open(geo, encoding="utf-8") as fh:
        d = json.load(fh)
    out = {}
    for f in d["features"]:
        if f.get("properties", {}).get("st") not in states:
            continue
        g = f["geometry"]
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        out[str(f["id"])] = polys
    return out


def in_ring(x, y, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def seg_dist(x, y, a, b):
    ax, ay, bx, by = a[0], a[1], b[0], b[1]
    dx, dy = bx - ax, by - ay
    L = dx * dx + dy * dy
    t = 0 if L == 0 else max(0, min(1, ((x - ax) * dx + (y - ay) * dy) / L))
    return math.hypot(x - (ax + t * dx), y - (ay + t * dy))


def dist_to_county(x, y, polys):
    """0 inside the county, else degrees to its nearest edge."""
    best = float("inf")
    for poly in polys:
        if in_ring(x, y, poly[0]) and not any(in_ring(x, y, h) for h in poly[1:]):
            return 0.0
        for ring in poly:
            for i in range(len(ring) - 1):
                best = min(best, seg_dist(x, y, ring[i], ring[i + 1]))
    return best


def centroid(ring):
    """Area centroid of one ring (shoelace), vertex mean when degenerate."""
    a = cx = cy = 0.0
    for i in range(len(ring) - 1):
        x0, y0, x1, y1 = ring[i][0], ring[i][1], ring[i + 1][0], ring[i + 1][1]
        c = x0 * y1 - x1 * y0
        a += c
        cx += (x0 + x1) * c
        cy += (y0 + y1) * c
    if abs(a) < 1e-14:
        n = len(ring)
        return (sum(p[0] for p in ring) / n, sum(p[1] for p in ring) / n)
    return (cx / (3 * a), cy / (3 * a))


def pick_section(cands, polys, pm=None):
    """The one candidate (dicts with cx, cy, mer) inside or within NEAR_DEG of the county, else None.
    A meridian on the key breaks a tie; it never overrides the county."""
    near = [c for c in cands if dist_to_county(c["cx"], c["cy"], polys) <= NEAR_DEG]
    if len(near) > 1 and pm is not None:
        m = [c for c in near if c.get("mer") == "%02d" % pm]
        near = m if m else near
    if len(near) > 1:
        inside = [c for c in near if dist_to_county(c["cx"], c["cy"], polys) == 0]
        near = inside if len(inside) == 1 else near
    return near[0] if len(near) == 1 else None


# ── fetch (Actions) ─────────────────────────────────────────────────────────

def http(url, data=None, timeout=90, tries=3):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": UA, **({"Content-Type": "application/json"} if data else {})})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(3 * (i + 1))
    raise last


def blm_layer():
    d = json.loads(http(BLM + "?f=json"))
    for L in d.get("layers", []):
        if re.search(r"first\s*division", L.get("name", ""), re.I):
            return L["id"], d
    raise SystemExit("BLM PLSS: no first division layer in " + ", ".join(L.get("name", "") for L in d.get("layers", [])))


def blm_sections(layer, pats, out_raw=None):
    """Section polygons for a batch of township patterns -> list of dicts."""
    where = "(" + " OR ".join("PLSSID LIKE '%s'" % p for p in pats) + ")"
    got, off = [], 0
    while True:
        q = {"where": where, "outFields": "PLSSID,FRSTDIVNO,FRSTDIVTYP", "returnGeometry": "true",
             "outSR": "4326", "geometryPrecision": "5", "resultOffset": str(off), "resultRecordCount": "1000", "f": "json"}
        d = json.loads(http(BLM + "/%d/query?" % layer + urllib.parse.urlencode(q), timeout=120))
        if "error" in d:
            raise RuntimeError("BLM error: " + json.dumps(d["error"])[:300])
        if out_raw is not None and not out_raw:
            out_raw.append({k: d.get(k) for k in ("fields", "exceededTransferLimit")} | {"first": (d.get("features") or [None])[0]})
        feats = d.get("features") or []
        for f in feats:
            a, g = f.get("attributes") or {}, f.get("geometry") or {}
            rings = g.get("rings") or []
            if not rings or str(a.get("FRSTDIVTYP") or "").upper() not in ("SN", ""):
                continue
            try:
                no = int(str(a.get("FRSTDIVNO")).lstrip("0") or 0)
            except ValueError:
                continue
            ring = max(rings, key=len)
            cx, cy = centroid(ring)
            pid = str(a.get("PLSSID") or "")
            got.append({"pid": pid, "mer": pid[2:4], "sec": no, "cx": round(cx, 5), "cy": round(cy, 5), "rings": rings})
        if not d.get("exceededTransferLimit") or not feats:
            return got
        off += len(feats)


def pid_parts(pid):
    """IL030140S0020E0 -> (14, 'S', 2, 'E')."""
    m = re.match(r"^[A-Z]{2}\d\d(\d{3})\d([NS])(\d{3})\d([EW])", pid)
    return (int(m.group(1)), m.group(2), int(m.group(3)), m.group(4)) if m else None


def match_key(c, p):
    t = pid_parts(c["pid"])
    return bool(t) and c["sec"] == p[0] and t[0] == p[1] and t[2] == p[3] and (p[2] == "?" or t[1] == p[2]) and (p[4] == "?" or t[3] == p[4])


def soil_sql(rings):
    wkt = "POLYGON(" + ",".join("(" + ",".join("%.5f %.5f" % (x, y) for x, y in r) + ")" for r in rings) + ")"
    sub = ("(SELECT SUM(ci.interphr*c.comppct_r)/NULLIF(SUM(c.comppct_r),0) FROM component c JOIN cointerp ci ON ci.cokey=c.cokey"
           " WHERE c.mukey=a.mukey AND ci.ruledepth=0 AND ci.mrulename='" + NCCPI_RULE + "' AND ci.interphr IS NOT NULL)")
    cpi = ("(SELECT SUM(CAST(c.cropprodindex AS float)*c.comppct_r)/NULLIF(SUM(c.comppct_r),0) FROM component c"
           " WHERE c.mukey=a.mukey AND c.cropprodindex IS NOT NULL)")
    return ("~DeclareGeometry(@aoi)~\nSELECT @aoi = geometry::STGeomFromText('" + wkt + "', 4326)\n"
            "~DeclareIdGeomTable(@clip)~\n~GetClippedMapunits(@aoi,polygon,geo,@clip)~\n"
            "SELECT a.mukey, a.deg2, ma.niccdcd, " + sub + " AS nccpi, " + cpi + " AS cpi"
            " FROM (SELECT id AS mukey, SUM(geom.STArea()) AS deg2 FROM @clip GROUP BY id) a"
            " LEFT JOIN muaggatt ma ON ma.mukey=a.mukey")


def deg2_to_ac(deg2, lat):
    return deg2 * (111320.0 ** 2) * math.cos(math.radians(lat)) * 0.000247105


def sda_section(sec):
    body = json.dumps({"format": "JSON", "query": soil_sql(sec["rings"])}).encode()
    d = json.loads(http(SDA, data=body, timeout=90) or b"{}")
    rows = []
    for t in d.get("Table") or []:
        mk, dg, cl, nc, cp = t[:5]
        ac = deg2_to_ac(float(dg or 0), sec["cy"])
        rows.append([str(mk), round(ac, 2), None if cl in (None, "") else str(cl),
                     None if nc in (None, "") else round(float(nc), 4), None if cp in (None, "") else round(float(cp), 2)])
    return rows


def fetch(st, limit=None, minutes=120, today=None):
    today = today or time.strftime("%Y-%m-%d")
    os.makedirs(RAW, exist_ok=True)
    rows = comps(st, today)
    secs, twps = needed(rows)
    cos = load_counties((st,))
    layer, info = blm_layer()
    twps = sorted(twps)
    if limit:
        keep = sorted(secs)[:limit]
        secs = set(keep)
        twps = sorted({twp_like(st, *(lambda p: (p[1], p[2], p[3], p[4]))(parse_key(k))) for _, k in keep})
    probe = []
    cands = []
    for i in range(0, len(twps), 20):
        try:
            cands += blm_sections(layer, twps[i:i + 20], probe)
        except Exception as e:  # noqa: BLE001
            print("::warning::BLM batch %d failed: %s" % (i, str(e)[:200]))
    by = {}
    for c in cands:
        t = pid_parts(c["pid"])
        if t:
            by.setdefault((c["sec"], t[0], t[2]), []).append(c)
    sections, miss = {}, {"no_section": 0, "two_in_county": 0, "no_county": 0}
    for fips, k in sorted(secs):
        p = parse_key(k)
        cs = [c for c in by.get((p[0], p[1], p[3]), []) if match_key(c, p)]
        if fips not in cos:
            miss["no_county"] += 1
            continue
        if not cs:
            miss["no_section"] += 1
            continue
        c = pick_section(cs, cos[fips], p[5])
        if not c:
            miss["two_in_county"] += 1
            continue
        sections[fips + "|" + k] = c
    print("%s: %d sales, %d section keys, %d townships, %d sections found; %s" % (st, len(rows), len(secs), len(twps), len(sections), miss))
    # one soil answer per distinct section (two keys can name one section)
    uniq = {}
    for key, c in sections.items():
        uniq.setdefault(c["pid"] + "|" + str(c["sec"]), c)
    soil, fails, t0 = {}, 0, time.time()
    todo = sorted(uniq.items())

    def one(item):
        return item[0], sda_section(item[1])

    with cf.ThreadPoolExecutor(max_workers=4) as ex:
        futs = []
        for it in todo:
            futs.append(ex.submit(one, it))
        for n, fu in enumerate(cf.as_completed(futs)):
            if time.time() - t0 > minutes * 60:
                for f2 in futs:
                    f2.cancel()
                print("::warning::%s soil: stopped at the time budget after %d sections" % (st, len(soil)))
                break
            try:
                k, rws = fu.result()
                soil[k] = rws
            except Exception as e:  # noqa: BLE001
                fails += 1
                if fails <= 5:
                    print("::warning::SDA failed: %s" % str(e)[:200])
            if n % 500 == 0:
                print("%s soil %d/%d (%d failed), %.0f s" % (st, n, len(todo), fails, time.time() - t0))
    secmap = {k: {"pid": c["pid"], "sec": c["sec"], "cx": c["cx"], "cy": c["cy"]} for k, c in sections.items()}
    meta = {"state": st, "fetched_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "sales": len(rows), "keys": len(secs),
            "townships": len(twps), "sections": len(sections), "distinct": len(uniq), "soil": len(soil), "sda_failed": fails,
            "miss": miss, "blm_layer": layer, "blm_probe": probe[:1], "sources": [BLM, SDA]}
    with gzip.open(os.path.join(RAW, "%s-soil.json.gz" % st), "wt", encoding="utf-8") as fh:
        json.dump({"meta": meta, "sections": secmap, "soil": soil}, fh, separators=(",", ":"))
    with open(os.path.join(RAW, "%s-meta.json" % st), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=1)
    print(json.dumps(meta)[:2000])
    return meta


# ── per-section numbers ─────────────────────────────────────────────────────

def summarize(rows):
    """rows [[mukey, ac, cls, nccpi, cpi]] -> {nccpi, nccpi_c14, cpi, c14, ac}."""
    tot = sum(r[1] for r in rows if r[1])
    if not tot:
        return None

    def w(sel, i):
        num = den = 0.0
        for r in rows:
            if sel(r) and r[i] is not None and r[1]:
                num += r[i] * r[1]
                den += r[1]
        return (num / den, den) if den else (None, 0)

    c14 = lambda r: r[2] in ("1", "2", "3", "4")  # noqa: E731
    n_all, d_all = w(lambda r: True, 3)
    n_c, d_c = w(c14, 3)
    cp, d_cp = w(lambda r: True, 4)
    return {"ac": round(tot, 1), "nccpi": n_all, "nccpi_c14": n_c, "cpi": cp, "cpi_ac": round(d_cp, 1),
            "c14": sum(r[1] for r in rows if c14(r) and r[1]) / tot, "rated": d_all / tot}


# ── the test ────────────────────────────────────────────────────────────────

def med(v):
    v = sorted(v)
    return B.quantile(v, 0.5)


def iqr(v):
    v = sorted(v)
    return B.quantile(v, 0.75) - B.quantile(v, 0.25)


def groups_of(sales):
    g = {}
    for s in sales:
        g.setdefault((s["fips"], s["year"]), []).append(s)
    return {k: v for k, v in g.items() if len(v) >= MIN_GROUP}


def fit_b(groups):
    """OLS slope of group-demeaned $/acre on group-demeaned points."""
    sxy = sxx = 0.0
    n = 0
    for v in groups.values():
        mp = sum(s["ppa"] for s in v) / len(v)
        mx = sum(s["pts"] for s in v) / len(v)
        for s in v:
            sxy += (s["ppa"] - mp) * (s["pts"] - mx)
            sxx += (s["pts"] - mx) ** 2
            n += 1
    return (sxy / sxx if sxx else None), n


def theil_sen_b(groups, cap=4000, rng=None):
    """Median of within-group pairwise slopes (robust check on the OLS slope)."""
    sl = []
    for v in groups.values():
        for i in range(len(v)):
            for j in range(i + 1, len(v)):
                dx = v[j]["pts"] - v[i]["pts"]
                if abs(dx) >= 1:
                    sl.append((v[j]["ppa"] - v[i]["ppa"]) / dx)
    return med(sl) if sl else None


def spreads(groups, b, shuffle=None):
    """[(before, after)] per group with b applied; shuffle (a Random) permutes points inside each group."""
    out = []
    for v in groups.values():
        pts = [s["pts"] for s in v]
        if shuffle is not None:
            shuffle.shuffle(pts)
        mx = med(pts)
        before = iqr([s["ppa"] for s in v])
        after = iqr([s["ppa"] - b * (p - mx) for s, p in zip(v, pts)])
        out.append((before, after))
    return out


def pooled(sp):
    b = sum(x[0] for x in sp)
    return (sum(x[1] for x in sp) / b - 1) if b else None


def run_test(sales, years, soil_key="pts", seed=7):
    """sales: dicts with fips, year, ppa, pts. Fit on year y, test on y+1, for each y in years."""
    rng = random.Random(seed)
    res = []
    allsp = []
    plc_all = None
    for y in years:
        tr = groups_of([s for s in sales if s["year"] == y])
        te = groups_of([s for s in sales if s["year"] == y + 1])
        if len(tr) < 5 or len(te) < 5:
            continue
        b, n_tr = fit_b(tr)
        if b is None:
            continue
        ts = theil_sen_b(tr)
        sp = spreads(te, b)
        rel = [a / x - 1 for x, a in sp if x > 0]
        res.append({"fit_year": y, "test_year": y + 1, "b": round(b, 1), "b_theil_sen": None if ts is None else round(ts, 1),
                    "fit_sales": n_tr, "fit_groups": len(tr), "test_groups": len(te), "test_sales": sum(len(v) for v in te.values()),
                    "median_before": round(med([x for x, _ in sp])), "median_after": round(med([a for _, a in sp])),
                    "median_group_change": round(med(rel), 4) if rel else None,
                    "narrowed_share": round(sum(1 for x, a in sp if a < x) / len(sp), 3), "pooled_change": round(pooled(sp), 4),
                    "_groups": te, "_b": b})
        allsp += sp
    if not res:
        return {"tests": [], "verdict": "no test: too few county-years"}
    # pooled over test years: bootstrap over groups, and a placebo with the same b per year
    boots = []
    for _ in range(1000):
        smp = [allsp[rng.randrange(len(allsp))] for _ in allsp]
        boots.append(pooled(smp))
    boots.sort()
    lo, hi = boots[int(0.05 * len(boots))], boots[int(0.95 * len(boots)) - 1]
    obs = pooled(allsp)
    rel_all = [a / x - 1 for x, a in allsp if x > 0]
    placebo = []
    for _ in range(200):
        sp = []
        for r in res:
            sp += spreads(r["_groups"], r["_b"], shuffle=rng)
        placebo.append(pooled(sp))
    p_plc = sum(1 for x in placebo if x <= obs) / len(placebo)
    mg = med(rel_all)
    holds = mg <= -0.05 and hi < 0 and p_plc < 0.05
    for r in res:
        r.pop("_groups")
        r.pop("_b")
    return {"tests": res, "groups": len(allsp), "pooled_change": round(obs, 4), "pooled_90": [round(lo, 4), round(hi, 4)],
            "median_group_change": round(mg, 4), "narrowed_share": round(sum(1 for x, a in allsp if a < x) / len(allsp), 3),
            "placebo_share_as_narrow": round(p_plc, 3), "placebo_median": round(med(placebo), 4), "holds": holds}


def sale_soil(st, src, today):
    """Join the sales to their section's soil -> (dicts, counts)."""
    with gzip.open(src, "rt", encoding="utf-8") as fh:
        d = json.load(fh)
    out, cnt = [], {"sales": 0, "section": 0, "soil": 0}
    for r in comps(st, today):
        cnt["sales"] += 1
        c = d["sections"].get(str(r["fips"]) + "|" + r["str"])
        if not c:
            continue
        cnt["section"] += 1
        rows = d["soil"].get(c["pid"] + "|" + str(c["sec"]))
        s = summarize(rows) if rows else None
        if not s or s["nccpi"] is None:
            continue
        cnt["soil"] += 1
        out.append({"fips": str(r["fips"]), "year": int(str(r["date"])[:4]), "ppa": float(r["ppa"]), "acres": float(r["acres"]),
                    "pts": s["nccpi"] * 100, "pts_c14": None if s["nccpi_c14"] is None else s["nccpi_c14"] * 100,
                    "cpi": s["cpi"], "c14": s["c14"], "sec_ac": s["ac"], "pid": c["pid"], "sec": c["sec"]})
    return out, cnt, d["meta"]


def within_corr(sales, a, b):
    """Pearson correlation of a and b after removing county-year means."""
    xs, ys = [], []
    for v in groups_of(sales).values():
        ma = sum(s[a] for s in v) / len(v)
        mb = sum(s[b] for s in v) / len(v)
        for s in v:
            xs.append(s[a] - ma)
            ys.append(s[b] - mb)
    if len(xs) < 10:
        return None
    sxy = sum(x * y for x, y in zip(xs, ys))
    sxx = sum(x * x for x in xs)
    syy = sum(y * y for y in ys)
    return round(sxy / math.sqrt(sxx * syy), 3) if sxx and syy else None


def test(src_dir=RAW, today=None):
    today = today or time.strftime("%Y-%m-%d")
    report = {}
    for st in STATES:
        p = os.path.join(src_dir, "%s-soil.json.gz" % st)
        if not os.path.exists(p):
            report[st] = "no saved answers"
            continue
        sales, cnt, meta = sale_soil(st, p, today)
        years = sorted({s["year"] for s in sales})
        rep = {"counts": cnt, "fetch": {k: meta.get(k) for k in ("fetched_utc", "keys", "sections", "distinct", "soil", "sda_failed", "miss")},
               "by_year": {y: sum(1 for s in sales if s["year"] == y) for y in years}}
        for s in sales:
            s["logac"] = math.log(s["acres"])
        rep["primary"] = run_test(sales, years[:-1])
        c14 = [dict(s, pts=s["pts_c14"]) for s in sales if s["pts_c14"] is not None]
        rep["class_1_4"] = run_test(c14, years[:-1])
        if st == "IL":
            cp = [dict(s, pts=s["cpi"]) for s in sales if s["cpi"] is not None]
            rep["state_index"] = {"sales": len(cp), "test": run_test(cp, years[:-1]) if len(cp) > 50 else "too few"}
        rep["within_corr"] = {"pts_vs_log_acres": within_corr(sales, "pts", "logac"), "pts_vs_ppa": within_corr(sales, "pts", "ppa"),
                              "pts_vs_class14_share": within_corr(sales, "pts", "c14")}
        same = {}
        for s in sales:
            same.setdefault((s["pid"], s["sec"]), 0)
            same[(s["pid"], s["sec"])] += 1
        rep["sections_with_2plus_sales"] = sum(1 for v in same.values() if v > 1)
        report[st] = rep
    return report


# ── selftest ────────────────────────────────────────────────────────────────

def selftest():
    fails = 0

    def ck(name, ok):
        nonlocal fails
        print(("ok   " if ok else "FAIL ") + name)
        fails += 0 if ok else 1

    ck("key with meridian", parse_key("29-15N-6E-4") == (29, 15, "N", 6, "E", 4))
    ck("Indiana key without directions", parse_key("17-11?-5?") == (17, 11, "?", 5, "?", None))
    ck("section 37 is no key", parse_key("37-15N-6E") is None)
    ck("township pattern leaves the meridian open", twp_like("IL", 14, "S", 2, "E") == "IL__0140S0020E_")
    ck("township pattern leaves a missing direction open", twp_like("IN", 11, "?", 5, "?") == "IN__0110_0050__")
    ck("PLSSID read", pid_parts("IL030140S0020E0") == (14, "S", 2, "E"))
    sq = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]
    ck("centroid of a square", centroid(sq) == (0.5, 0.5))
    ck("inside county", dist_to_county(0.5, 0.5, [[sq]]) == 0)
    ck("outside county by 0.5", abs(dist_to_county(1.5, 0.5, [[sq]]) - 0.5) < 1e-9)
    a = {"pid": "IL030140S0020E0", "mer": "03", "sec": 36, "cx": 0.5, "cy": 0.5}
    b = {"pid": "IL040140S0020E0", "mer": "04", "sec": 36, "cx": 5.5, "cy": 0.5}
    ck("the section inside the county is picked", pick_section([a, b], [[sq]]) is a)
    b2 = dict(b, cx=0.6)
    ck("two inside and no meridian: none", pick_section([a, b2], [[sq]]) is None)
    ck("two inside, the key's meridian breaks the tie", pick_section([a, b2], [[sq]], 4) is b2)
    ck("match key", match_key(a, (36, 14, "S", 2, "E", None)) and not match_key(a, (35, 14, "S", 2, "E", None)))
    ck("match key, open direction", match_key(a, (36, 14, "?", 2, "?", None)))
    s = summarize([["1", 300, "1", 0.8, 120], ["2", 100, "6", 0.2, None], ["3", 40, None, None, None]])
    ck("section NCCPI area-weighted over rated acres", abs(s["nccpi"] - 0.65) < 1e-9)
    ck("class 1 to 4 NCCPI", abs(s["nccpi_c14"] - 0.8) < 1e-9 and abs(s["c14"] - 300 / 440) < 1e-9)
    ck("state index where populated", s["cpi"] == 120 and s["cpi_ac"] == 300)
    ck("acres from square degrees at the equator", abs(deg2_to_ac(1, 0) - 111320 ** 2 * 0.000247105) < 1e-6)
    sql = soil_sql([sq])
    ck("SDA query clips the outline", "GetClippedMapunits(@aoi,polygon,geo,@clip)" in sql and "POLYGON((0.00000 0.00000," in sql)
    # the test on made-up sales: price = 100 * points + noise, so the soil adjustment must narrow the spread
    rng = random.Random(1)
    sales = []
    for y in (2021, 2022, 2023):
        for c in range(20):
            for i in range(8):
                p = rng.uniform(40, 90)
                sales.append({"fips": str(c), "year": y, "ppa": 3000 + c * 50 + 100 * p + rng.gauss(0, 300), "pts": p})
    r = run_test(sales, [2021, 2022])
    ck("made-up soil effect: holds", r["holds"] and abs(r["tests"][0]["b"] - 100) < 15)
    noise = [dict(s, ppa=3000 + rng.gauss(0, 2000)) for s in sales]
    r2 = run_test(noise, [2021, 2022])
    ck("made-up no effect: does not hold", not r2["holds"])
    ck("fit on one year, tested on the next only", [t["test_year"] - t["fit_year"] for t in r["tests"]] == [1, 1])
    with open(__file__, encoding="utf-8") as fh:
        ck("no em dash in this file", chr(0x2014) not in fh.read())
    print("FAILS=%d" % fails)
    return fails


def main(argv):
    if "--selftest" in argv:
        return 1 if selftest() else 0
    today = time.strftime("%Y-%m-%d")
    if "--keys" in argv:
        for st in STATES:
            secs, twps = needed(comps(st, today))
            print(st, "section keys", len(secs), "townships", len(twps))
        return 0
    if "--fetch" in argv:
        st = argv[argv.index("--fetch") + 1].upper()
        lim = int(argv[argv.index("--limit") + 1]) if "--limit" in argv else None
        mins = float(argv[argv.index("--minutes") + 1]) if "--minutes" in argv else 120
        if st not in STATES:
            raise SystemExit("state must be one of " + ", ".join(STATES))
        fetch(st, lim, mins, today)
        return 0
    if "--test" in argv:
        i = argv.index("--test")
        src = argv[i + 1] if len(argv) > i + 1 and not argv[i + 1].startswith("--") else RAW
        print(json.dumps(test(src, today), indent=1, default=str))
        return 0
    print(__doc__)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
