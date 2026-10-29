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
  Secondary, reported beside it and never used to pass: the slope fit as percent per point (log
  $/acre), NCCPI over class 1 to 4 acres only, Illinois' state index where SSURGO carries it, the
  Theil-Sen slope, and the in-sample change (b applied to its own fit year: the ceiling).

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
# BLM moved the national PLSS service on Oct 14, 2026; the old address answers until Feb 1, 2027.
BLM_URLS = ("https://gis.blm.gov/natlplss/rest/services/Cadastral/BLM_Natl_PLSS_CadNSDI/MapServer",
            "https://gis.blm.gov/arcgis/rest/services/Cadastral/BLM_Natl_PLSS_CadNSDI/MapServer")
BLM = BLM_URLS[0]
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
    """The section layer (named "PLSS Section" or "First Division") and its field names."""
    global BLM
    d = None
    for u in BLM_URLS:
        try:
            d = json.loads(http(u + "?f=json", tries=2))
            if d.get("layers"):
                BLM = u
                break
        except Exception as e:  # noqa: BLE001
            print("::warning::BLM PLSS at %s: %s" % (u, str(e)[:200]))
    if not d:
        raise SystemExit("BLM PLSS: no answer at either address")
    print("BLM PLSS: " + BLM)
    for L in d.get("layers", []):
        if re.search(r"first\s*division|\bsection\b", L.get("name", ""), re.I) and not re.search(r"intersect", L.get("name", ""), re.I):
            info = json.loads(http(BLM + "/%d?f=json" % L["id"]))
            names = [f.get("name") for f in info.get("fields") or []]
            print("BLM layer %d %s, fields: %s" % (L["id"], L.get("name"), ", ".join(map(str, names))))
            fld = {}
            for want, pat in (("pid", r"^PLSSID$"), ("no", r"^(FRSTDIVNO|SECNO|SECTION|SEC)$"), ("typ", r"^FRSTDIVTYP$")):
                hit = [n for n in names if n and re.match(pat, n, re.I)]
                fld[want] = hit[0] if hit else None
            if not fld["pid"] or not fld["no"]:
                raise SystemExit("BLM PLSS: section layer fields not found by name: " + ", ".join(map(str, names)))
            return L["id"], fld
    raise SystemExit("BLM PLSS: no section layer in " + ", ".join(L.get("name", "") for L in d.get("layers", [])))


def blm_sections(layer, pats, out_raw=None, fld=None):
    """Section polygons for a batch of township patterns -> list of dicts."""
    fld = fld or {"pid": "PLSSID", "no": "FRSTDIVNO", "typ": "FRSTDIVTYP"}
    where = "(" + " OR ".join("%s LIKE '%s'" % (fld["pid"], p) for p in pats) + ")"
    got, off = [], 0
    while True:
        q = {"where": where, "outFields": ",".join(v for v in fld.values() if v), "returnGeometry": "true",
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
            if not rings or (fld.get("typ") and str(a.get(fld["typ"]) or "").upper() not in ("SN", "")):
                continue
            try:
                no = int(str(a.get(fld["no"])).lstrip("0") or 0)
            except ValueError:
                continue
            ring = max(rings, key=len)
            cx, cy = centroid(ring)
            pid = str(a.get(fld["pid"]) or "")
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


def find_sections(st, limit=None, today=None):
    """BLM section outlines for each keyed comp in the state -> (rows, secs, twps, sections, miss, layer, fld, probe, cands)."""
    today = today or time.strftime("%Y-%m-%d")
    rows = comps(st, today)
    secs, twps = needed(rows)
    cos = load_counties((st,))
    layer, fld = blm_layer()
    twps = sorted(twps)
    if limit:
        keep = sorted(secs)[:limit]
        secs = set(keep)
        twps = sorted({twp_like(st, *(lambda p: (p[1], p[2], p[3], p[4]))(parse_key(k))) for _, k in keep})
    probe = []
    cands = []
    for i in range(0, len(twps), 20):
        try:
            cands += blm_sections(layer, twps[i:i + 20], probe, fld)
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
    return rows, secs, twps, sections, miss, layer, fld, probe, cands


def fetch(st, limit=None, minutes=120, today=None):
    os.makedirs(RAW, exist_ok=True)
    rows, secs, twps, sections, miss, layer, fld, probe, cands = find_sections(st, limit, today)
    # one soil answer per distinct section (two keys can name one section)
    uniq = {}
    for key, c in sections.items():
        uniq.setdefault(c["pid"] + "|" + str(c["sec"]), c)
    soil, fails, t0, errs = {}, 0, time.time(), []
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
                errs.append(str(e)[:300]) if len(errs) < 3 else None
                if fails <= 5:
                    print("::warning::SDA failed: %s" % str(e)[:200])
            if n % 500 == 0:
                print("%s soil %d/%d (%d failed), %.0f s" % (st, n, len(todo), fails, time.time() - t0))
    secmap = {k: {"pid": c["pid"], "sec": c["sec"], "cx": c["cx"], "cy": c["cy"]} for k, c in sections.items()}
    meta = {"state": st, "fetched_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "sales": len(rows), "keys": len(secs),
            "townships": len(twps), "sections": len(sections), "distinct": len(uniq), "soil": len(soil), "sda_failed": fails, "sda_errors": errs,
            "miss": miss, "blm_layer": layer, "blm_url": BLM, "blm_fields": fld, "candidates": len(cands), "blm_probe": probe[:1], "sources": [BLM, SDA]}
    with gzip.open(os.path.join(RAW, "%s-soil.json.gz" % st), "wt", encoding="utf-8") as fh:
        json.dump({"meta": meta, "sections": secmap, "soil": soil}, fh, separators=(",", ":"))
    with open(os.path.join(RAW, "%s-meta.json" % st), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=1)
    print(json.dumps(meta)[:2000])
    return meta


def attrs_sql(mukeys):
    """NCCPI 3.0 overall, corn and soybean submodels per map unit (component-weighted over rated
    components), the same reading as the Field Scout worker; prefix match takes "(I)" or "(II)"."""
    ks = ",".join("'%s'" % int(k) for k in mukeys)

    def sub(rule, like):
        cond = ("ci.mrulename LIKE '" + rule + "%'") if like else ("ci.mrulename='" + rule + "'")
        return ("(SELECT SUM(ci.interphr*c.comppct_r)/NULLIF(SUM(c.comppct_r),0) FROM component c JOIN cointerp ci ON ci.cokey=c.cokey"
                " WHERE c.mukey=mu.mukey AND ci.ruledepth=0 AND " + cond + " AND ci.interphr IS NOT NULL)")
    return ("SELECT mu.mukey, " + sub(NCCPI_RULE, False) + ", " + sub("NCCPI - NCCPI Corn Submodel", True) + ", "
            + sub("NCCPI - NCCPI Soybeans Submodel", True) + " FROM mapunit mu WHERE mu.mukey IN (" + ks + ")")


def attrs(st):
    """Corn and soybean NCCPI for every map unit in the saved section answers -> <ST>-mukey.json.gz."""
    with gzip.open(os.path.join(RAW, "%s-soil.json.gz" % st), "rt", encoding="utf-8") as fh:
        d = json.load(fh)
    keys = sorted({r[0] for rows in d["soil"].values() for r in rows if str(r[0]).isdigit()})
    out, fails = {}, 0
    for i in range(0, len(keys), 400):
        try:
            a = json.loads(http(SDA, data=json.dumps({"format": "JSON", "query": attrs_sql(keys[i:i + 400])}).encode(), timeout=120))
            for t in a.get("Table") or []:
                out[str(t[0])] = [None if v in (None, "") else round(float(v), 4) for v in t[1:4]]
        except Exception as e:  # noqa: BLE001
            fails += 1
            print("::warning::SDA attrs batch %d failed: %s" % (i, str(e)[:200]))
    with gzip.open(os.path.join(RAW, "%s-mukey.json.gz" % st), "wt", encoding="utf-8") as fh:
        json.dump({"fetched_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "cols": ["nccpi", "corn", "soy"], "mukeys": out}, fh, separators=(",", ":"))
    print("%s: %d map units, %d with attributes, %d batches failed" % (st, len(keys), len(out), fails))


# ── per-section numbers ─────────────────────────────────────────────────────

C14 = ("1", "2", "3", "4")


def summarize(rows, mk=None):
    """rows [[mukey, ac, cls, nccpi, cpi]], mk {mukey: [nccpi, corn, soy]} ->
    {ac, nccpi, nccpi_c14, corn, corn_c14, soy, cpi, cpi_ac, c14, rated}. Means are area-weighted over
    the acres that carry the rating; a missing rating is missing, never 0."""
    tot = sum(r[1] for r in rows if r[1])
    if not tot:
        return None
    mk = mk or {}

    def val(r, what):
        if what == "nccpi":
            return r[3]
        if what == "cpi":
            return r[4]
        a = mk.get(str(r[0]))
        return None if not a else a[{"corn": 1, "soy": 2}[what]]

    def w(what, only14=False):
        num = den = 0.0
        for r in rows:
            v = val(r, what)
            if v is not None and r[1] and (not only14 or r[2] in C14):
                num += v * r[1]
                den += r[1]
        return (num / den if den else None), den

    out = {"ac": round(tot, 1), "c14": sum(r[1] for r in rows if r[2] in C14 and r[1]) / tot}
    out["nccpi"], d_all = w("nccpi")
    out["rated"] = d_all / tot
    out["nccpi_c14"], _ = w("nccpi", True)
    out["corn"], d_corn = w("corn")
    out["rated_corn"] = d_corn / tot
    out["corn_c14"], _ = w("corn", True)
    out["soy"], _ = w("soy")
    out["cpi"], d_cp = w("cpi")
    out["cpi_ac"] = round(d_cp, 1)
    return out


# ── the test (scripts/land_soil.py docstring; test_design.md, Oct 29) ─────────

def med(v):
    return B.quantile(sorted(v), 0.5)


def iqr(v):
    v = sorted(v)
    return B.quantile(v, 0.75) - B.quantile(v, 0.25)


def groups_of(sales, min_n):
    g = {}
    for s in sales:
        g.setdefault((s["fips"], s["year"]), []).append(s)
    return {k: v for k, v in g.items() if len(v) >= min_n}


def fit(groups, cols, log=False):
    """OLS on cell-demeaned data: $/acre (or log) on the named columns. Returns {col: slope} or None."""
    X, Y = [], []
    for v in groups.values():
        ys = [math.log(s["ppa"]) if log else s["ppa"] for s in v]
        my = sum(ys) / len(v)
        mx = [sum(s[c] for s in v) / len(v) for c in cols]
        for s, y in zip(v, ys):
            X.append([s[c] - m for c, m in zip(cols, mx)])
            Y.append(y - my)
    k = len(cols)
    if len(Y) < 10 * k:
        return None
    A = [[sum(x[i] * x[j] for x in X) for j in range(k)] for i in range(k)]
    bvec = [sum(x[i] * y for x, y in zip(X, Y)) for i in range(k)]
    # Gauss-Jordan on a small k x k system
    M = [row[:] + [bv] for row, bv in zip(A, bvec)]
    for i in range(k):
        piv = M[i][i]
        if abs(piv) < 1e-12:
            return None
        M[i] = [m / piv for m in M[i]]
        for j in range(k):
            if j != i:
                f = M[j][i]
                M[j] = [a - f * b for a, b in zip(M[j], M[i])]
    return {c: M[i][k] for i, c in enumerate(cols)}


def adj_price(s, b, x0, log=False, pts=None):
    p = s["pts"] if pts is None else pts
    return s["ppa"] * math.exp(-b * (p - x0)) if log else s["ppa"] - b * (p - x0)


def cell_spreads(groups, b, x0s, shuffle=None, log=False):
    """[(key, n, raw IQR, adjusted IQR)]: the frozen slope b applied in each held-out cell;
    x0s {fips: training-year county median points} (an IQR does not move with this constant)."""
    out = []
    for k, v in groups.items():
        pts = [s["pts"] for s in v]
        if shuffle is not None:
            shuffle.shuffle(pts)
        x0 = x0s.get(k[0], med(pts))
        raw = iqr([s["ppa"] for s in v])
        adj = iqr([adj_price(s, b, x0, log, p) for s, p in zip(v, pts)])
        out.append((k, len(v), raw, adj))
    return out


def gains(sp):
    """IQR gain per cell, 1 - adjusted/raw."""
    return [1 - a / r for _, _, r, a in sp if r > 0]


def agg_gain(sp):
    r = sum(x[2] for x in sp)
    return 1 - sum(x[3] for x in sp) / r if r else None


def micro_gain(sp):
    r = sum(x[1] * x[2] for x in sp)
    return 1 - sum(x[1] * x[3] for x in sp) / r if r else None


def m0_m1(train, test):
    """Dispersion test: within-cell residuals after slopes fit on the training year.
    M0 log(acres), M1 log(acres) + soil points; M0c and M1c add the section's class 1 to 4 share to
    both, so soil has to beat the share of tillable-looking ground, not stand in for it.
    MAE and IQR of cell-centred residuals."""
    specs = {"M0": ["logac"], "M1": ["logac", "pts"], "M0c": ["logac", "c14"], "M1c": ["logac", "c14", "pts"]}
    fits = {k: fit(train, v) for k, v in specs.items()}
    if not all(fits.values()):
        return None
    res = {k: [] for k in specs}
    for v in test.values():
        for name, f in fits.items():
            r = [s["ppa"] - sum(f[c] * s[c] for c in f) for s in v]
            m = med(r)
            res[name] += [x - m for x in r]
    out = {}
    for name in res:
        out[name] = {"mae": round(sum(abs(x) for x in res[name]) / len(res[name])), "iqr": round(iqr(res[name]))}
    out["soil_slope_with_acres"] = round(fits["M1"]["pts"], 1)
    out["soil_slope_with_acres_and_share"] = round(fits["M1c"]["pts"], 1)
    return out


def county_boot(sp, reps, rng):
    by = {}
    for x in sp:
        by.setdefault(x[0][0], []).append(x)
    cs = sorted(by)
    vals = []
    for _ in range(reps):
        smp = []
        for _ in cs:
            smp += by[cs[rng.randrange(len(cs))]]
        g = agg_gain(smp)
        if g is not None:
            vals.append(g)
    vals.sort()
    return [vals[int(0.025 * len(vals))], vals[int(0.975 * len(vals)) - 1]] if vals else None


def run_test(sales, years, min_n=20, log=False, seed=7, placebo_n=200):
    """Rolling origin: the slope is fit on year y alone and frozen; the cells of year y+1 are scored.
    sales: dicts with fips, year, ppa, pts, logac."""
    rng = random.Random(seed)
    tests, allsp, frozen = [], [], []
    for y in years:
        tr_all = [s for s in sales if s["year"] == y]
        tr = groups_of(tr_all, 3)          # the slope fits on every cell of 3+ sales in the training year
        te = groups_of([s for s in sales if s["year"] == y + 1], min_n)
        if len(tr) < 5 or not te:
            continue
        f = fit(tr, ["pts"], log)
        if not f:
            continue
        b = f["pts"]
        x0s = {}
        for s in tr_all:
            x0s.setdefault(s["fips"], []).append(s["pts"])
        x0s = {k: med(v) for k, v in x0s.items()}
        sp = cell_spreads(te, b, x0s, log=log)
        g = gains(sp)
        t = {"fit_year": y, "test_year": y + 1, "b": round(b, 5 if log else 1), "fit_sales": sum(len(v) for v in tr.values()),
             "test_cells": len(te), "test_sales": sum(len(v) for v in te.values()),
             "median_raw_iqr": round(med([x[2] for x in sp])), "median_adj_iqr": round(med([x[3] for x in sp])),
             "median_gain": round(med(g), 4) if g else None, "positive_share": round(sum(1 for x in g if x > 0) / len(g), 3) if g else None,
             "agg_gain": round(agg_gain(sp), 4)}
        if not log:
            t["m0_m1"] = m0_m1(tr, te)
        tests.append(t)
        allsp += sp
        frozen.append((te, b, x0s))
    if not allsp:
        return {"tests": [], "cells": 0, "verdict": "no held-out county-year with %d+ sales" % min_n}
    g = gains(allsp)
    obs = agg_gain(allsp)
    ci = county_boot(allsp, 1000, rng)
    plc = []
    for _ in range(placebo_n):
        sp = []
        for te, b, x0s in frozen:
            sp += cell_spreads(te, b, x0s, shuffle=rng, log=log)
        plc.append(agg_gain(sp))
    p_plc = sum(1 for x in plc if x >= obs) / len(plc)
    mae_ok = all(t["m0_m1"]["M1"]["mae"] <= t["m0_m1"]["M0"]["mae"] for t in tests if t.get("m0_m1")) if not log else None
    mae_c = None
    if not log and any(t.get("m0_m1") for t in tests):
        w = [t for t in tests if t.get("m0_m1")]
        mae_c = {"years_M1c_better": sum(1 for t in w if t["m0_m1"]["M1c"]["mae"] < t["m0_m1"]["M0c"]["mae"]), "years": len(w),
                 "mae_M0c_mean": round(sum(t["m0_m1"]["M0c"]["mae"] for t in w) / len(w)), "mae_M1c_mean": round(sum(t["m0_m1"]["M1c"]["mae"] for t in w) / len(w))}
    mg, pos = med(g), sum(1 for x in g if x > 0) / len(g)
    holds = bool(mg >= 0.05 and pos >= 0.60 and ci and ci[0] > 0 and p_plc < 0.05 and (log or mae_ok))
    return {"tests": tests, "cells": len(allsp), "sales": sum(x[1] for x in allsp), "counties": len({x[0][0] for x in allsp}),
            "median_gain": round(mg, 4), "positive_share": round(pos, 3), "agg_gain": round(obs, 4),
            "micro_gain": round(micro_gain(allsp), 4), "agg_gain_95_county_boot": [round(ci[0], 4), round(ci[1], 4)] if ci else None,
            "placebo_share_as_good": round(p_plc, 3), "placebo_median": round(med(plc), 4), "m1_mae_not_worse": mae_ok, "with_share_control": mae_c,
            "gain_pctiles": [round(B.quantile(sorted(g), q), 3) for q in (0.1, 0.25, 0.5, 0.75, 0.9)], "holds": holds}


def sale_soil(st, src, today, mk_src=None):
    """Join the sales to their section's soil -> (dicts, counts, fetch meta)."""
    with gzip.open(src, "rt", encoding="utf-8") as fh:
        d = json.load(fh)
    mk = {}
    if mk_src and os.path.exists(mk_src):
        with gzip.open(mk_src, "rt", encoding="utf-8") as fh:
            mk = json.load(fh)["mukeys"]
    out, cnt = [], {"sales": 0, "section": 0, "soil": 0, "quality": 0}
    for r in comps(st, today):
        cnt["sales"] += 1
        c = d["sections"].get(str(r["fips"]) + "|" + r["str"])
        if not c:
            continue
        cnt["section"] += 1
        rows = d["soil"].get(c["pid"] + "|" + str(c["sec"]))
        s = summarize(rows, mk) if rows else None
        if not s or s["nccpi"] is None:
            continue
        cnt["soil"] += 1
        q = s["rated"] >= 0.5 and s["c14"] >= 0.25        # quality floor (test_design.md)
        cnt["quality"] += 1 if q else 0
        pct = lambda v: None if v is None else v * 100  # noqa: E731
        out.append({"fips": str(r["fips"]), "year": int(str(r["date"])[:4]), "ppa": float(r["ppa"]), "acres": float(r["acres"]),
                    "logac": math.log(float(r["acres"])), "q": q, "all": pct(s["nccpi"]), "all_c14": pct(s["nccpi_c14"]),
                    "corn": pct(s["corn"]), "corn_c14": pct(s["corn_c14"]), "soy": pct(s["soy"]), "cpi": s["cpi"],
                    "c14": s["c14"], "rated": s["rated"], "pid": c["pid"], "sec": c["sec"]})
    return out, cnt, d["meta"], bool(mk)


def within_corr(sales, a, b):
    """Pearson correlation of a and b after removing county-year means (cells of 3+)."""
    xs, ys = [], []
    for v in groups_of(sales, 3).values():
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


def with_pts(sales, col, quality=True):
    return [dict(s, pts=s[col]) for s in sales if s.get(col) is not None and (s["q"] or not quality)]


def test(src_dir=RAW, today=None):
    today = today or time.strftime("%Y-%m-%d")
    report = {}
    for st in STATES:
        p = os.path.join(src_dir, "%s-soil.json.gz" % st)
        if not os.path.exists(p):
            report[st] = "no saved answers"
            continue
        sales, cnt, meta, has_mk = sale_soil(st, p, today, os.path.join(src_dir, "%s-mukey.json.gz" % st))
        years = sorted({s["year"] for s in sales})
        last_full = max([y for y in years if y < int(today[:4])] or [0])
        roll = [y for y in years if y + 1 <= int(today[:4])]
        cells = {}
        for n in (5, 10, 20, 30):
            cells[n] = len(groups_of([s for s in sales if s["q"]], n))
        # corn only where the SDA corn submodel is filled for most sales (Indiana); else the overall NCCPI
        corn_share = sum(1 for s in sales if s.get("corn") is not None) / len(sales) if sales else 0
        prim = "corn" if has_mk and corn_share >= 0.8 else "all"
        rep = {"counts": cnt, "primary_index": "nccpi3 %s, whole section, quality floor" % prim, "corn_attrs": has_mk,
               "fetch": {k: meta.get(k) for k in ("fetched_utc", "keys", "sections", "distinct", "soil", "sda_failed", "miss")},
               "by_year": {y: sum(1 for s in sales if s["year"] == y) for y in years}, "cells_by_min_sales": cells}
        P = with_pts(sales, prim)
        rep["primary_20"] = run_test(P, roll, 20)
        rep["primary_30"] = run_test(P, roll, 30)
        rep["sens_10"] = run_test(P, roll, 10)
        rep["sens_5"] = run_test(P, roll, 5)
        rep["final_untouched_%d" % last_full] = run_test(P, [last_full - 1], 10)
        rep["class_1_4_10"] = run_test(with_pts(sales, prim + "_c14"), roll, 10)
        rep["no_quality_floor_10"] = run_test(with_pts(sales, prim, False), roll, 10)
        if has_mk:
            rep["nccpi_all_10"] = run_test(with_pts(sales, "all"), roll, 10)
        rep["percent_per_point_10"] = run_test(P, roll, 10, log=True)
        if st == "IL":
            cp = with_pts(sales, "cpi")
            rep["state_index"] = {"sales": len(cp), "test": run_test(cp, roll, 10) if len(cp) > 100 else "too few: SSURGO carries no state index here"}
        rep["within_corr"] = {"pts_vs_log_acres": within_corr(P, "pts", "logac"), "pts_vs_ppa": within_corr(P, "pts", "ppa"),
                              "pts_vs_class14_share": within_corr(P, "pts", "c14")}
        same = {}
        for s in P:
            same[(s["pid"], s["sec"])] = same.get((s["pid"], s["sec"]), 0) + 1
        rep["sections_with_2plus_sales"] = sum(1 for v in same.values() if v > 1)
        rp = os.path.join(src_dir, "%s-raster.json.gz" % st)
        if os.path.exists(rp):
            rep["raster"] = test_raster(st, rp, today, roll, last_full)
        report[st] = rep
    return report


# ── the gridded route (scripts/land_soil_raster.py): primary index, fixed Oct 29 before its answers ──
# Primary: 100 x valu1 nccpi3corn over the section's cropland (CDL, newest year before the sale).
# Quality floor: 50%+ of the section's cells rated and 25%+ of it cropland in the mask year.
# Same test and the same HOLDS rule as above, cells of 20+ sales; 10 and 30 beside it.
# The share control (M0c, M1c) uses the cropland share, so soil must beat "how much is cropped".

def sale_soil_raster(st, src, today):
    with gzip.open(src, "rt", encoding="utf-8") as fh:
        d = json.load(fh)
    avail = d["meta"].get("cdl_years") or []
    out, cnt = [], {"sales": 0, "section": 0, "soil": 0, "mask": 0, "quality": 0}
    for r in comps(st, today):
        cnt["sales"] += 1
        k = d["keys"].get(str(r["fips"]) + "|" + r["str"])
        z = d["sections"].get(k) if k else None
        if not z:
            continue
        cnt["section"] += 1
        if z.get("nccpi3corn") is None:
            continue
        cnt["soil"] += 1
        y = int(str(r["date"])[:4])
        prior = [a for a in avail if a < y]
        my = max(prior) if prior else None
        m = (z.get("m") or {}).get(str(my)) if my else None
        share = m[0] / z["n"] if m and z["n"] else None
        cnt["mask"] += 1 if m else 0
        q = z["rated"] >= 0.5 and share is not None and share >= 0.25
        cnt["quality"] += 1 if q else 0
        pct = lambda v: None if v is None else v * 100  # noqa: E731
        out.append({"fips": str(r["fips"]), "year": y, "ppa": float(r["ppa"]), "acres": float(r["acres"]),
                    "logac": math.log(float(r["acres"])), "q": q, "mask_year": my,
                    "corn_m": pct(m[1]) if m else None, "soy_m": pct(m[2]) if m else None, "all_m": pct(m[3]) if m else None,
                    "corn_u": pct(z["nccpi3corn"]), "soy_u": pct(z["nccpi3soy"]), "all_u": pct(z["nccpi3all"]),
                    "sda_p": pct(z.get("sda_p")), "c14": share if share is not None else 0.0, "rated": z["rated"],
                    "pid": k.split("|")[0], "sec": k.split("|")[1]})
    return out, cnt, d


def raster_check(d, n_sample=100):
    """Raster versus polygon: the same SDA map unit NCCPI averaged over 10 m cells (sda_r) and over the
    clipped polygons (sda_p), in NCCPI points; all sections and a stratified sample (deciles of sda_p).
    Then valu1 nccpi3all against the SDA overall NCCPI per map unit (the attribute, not the geometry)."""
    pairs = [(k, z["sda_r"] * 100, z["sda_p"] * 100) for k, z in sorted(d["sections"].items())
             if z.get("sda_r") is not None and z.get("sda_p") is not None]
    if not pairs:
        return "no sections with both"
    diffs = sorted(abs(a - b) for _, a, b in pairs)
    pairs.sort(key=lambda t: t[2])
    step = max(1, len(pairs) // n_sample)
    smp = sorted(abs(a - b) for _, a, b in pairs[::step][:n_sample])
    q = lambda v, f: round(B.quantile(v, f), 2)  # noqa: E731
    out = {"sections": len(pairs), "abs_diff_points": {"median": q(diffs, 0.5), "p90": q(diffs, 0.9), "p99": q(diffs, 0.99), "max": round(diffs[-1], 2)},
           "share_within_1_point": round(sum(1 for x in diffs if x <= 1) / len(diffs), 3),
           "stratified_sample": {"n": len(smp), "median": q(smp, 0.5), "p90": q(smp, 0.9), "max": round(smp[-1], 2)}}
    return out


def test_raster(st, src, today, roll, last_full):
    sales, cnt, d = sale_soil_raster(st, src, today)
    rep = {"counts": cnt, "meta": {k: d["meta"].get(k) for k in ("fetched_utc", "distinct", "done", "township_failed", "cdl_years", "soil_grid")},
           "primary_index": "100 x valu1 nccpi3corn over cropland (CDL year before the sale), quality floor",
           "raster_vs_polygon": raster_check(d)}
    P = with_pts(sales, "corn_m")
    rep["cells_by_min_sales"] = {n: len(groups_of(P, n)) for n in (5, 10, 20, 30)}
    rep["primary_20"] = run_test(P, roll, 20)
    rep["primary_30"] = run_test(P, roll, 30)
    rep["sens_10"] = run_test(P, roll, 10)
    rep["final_untouched_%d" % last_full] = run_test(P, [last_full - 1], 10)
    rep["corn_unmasked_10"] = run_test(with_pts(sales, "corn_u"), roll, 10)
    rep["soy_masked_10"] = run_test(with_pts(sales, "soy_m"), roll, 10)
    rep["all_unmasked_10"] = run_test(with_pts(sales, "all_u"), roll, 10)
    rep["percent_per_point_10"] = run_test(P, roll, 10, log=True)
    rep["within_corr"] = {"pts_vs_log_acres": within_corr(P, "pts", "logac"), "pts_vs_ppa": within_corr(P, "pts", "ppa"),
                          "pts_vs_crop_share": within_corr(P, "pts", "c14")}
    return rep


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
    s2 = summarize([["1", 300, "1", 0.8, None], ["2", 100, "6", 0.2, None]], {"1": [0.8, 0.9, 0.7], "2": [0.2, 0.1, 0.3]})
    ck("corn NCCPI from the map unit table", abs(s2["corn"] - 0.7) < 1e-9 and abs(s2["corn_c14"] - 0.9) < 1e-9)
    ck("a map unit without the table is missing, not 0", summarize([["1", 100, "1", 0.5, None]], {})["corn"] is None)
    # the test on made-up sales: price = 100 * points + noise, so the frozen slope must narrow the spread
    rng = random.Random(1)
    sales = []
    for y in (2021, 2022, 2023):
        for c in range(12):
            for i in range(25):
                p, ac = rng.uniform(40, 90), rng.uniform(20, 160)
                sales.append({"fips": str(c), "year": y, "ppa": 3000 + c * 50 + 100 * p + rng.gauss(0, 300), "pts": p, "logac": math.log(ac), "c14": rng.uniform(0.3, 1)})
    r = run_test(sales, [2021, 2022], placebo_n=40)
    ck("made-up soil effect: holds", r["holds"] and abs(r["tests"][0]["b"] - 100) < 15)
    ck("made-up soil effect: M1 beats M0", r["tests"][0]["m0_m1"]["M1"]["mae"] < r["tests"][0]["m0_m1"]["M0"]["mae"])
    noise = [dict(s, ppa=3000 + rng.gauss(0, 2000)) for s in sales]
    r2 = run_test(noise, [2021, 2022], placebo_n=40)
    ck("made-up no effect: does not hold", not r2["holds"])
    ck("fit on one year, tested on the next only", [t["test_year"] - t["fit_year"] for t in r["tests"]] == [1, 1])
    ck("cells under the minimum are not scored", run_test(sales, [2021], min_n=30)["cells"] == 0)
    f2 = fit({("a", 1): [{"ppa": 2 * x + 3 * z, "x": x, "z": z} for x, z in [(1, 0), (0, 1), (1, 1), (2, 1), (3, 5), (1, 4), (2, 2), (5, 1), (4, 4), (0, 3), (6, 2), (3, 3), (2, 7), (7, 1), (1, 6), (5, 5), (4, 0), (0, 6), (6, 6), (3, 1)]]}, ["x", "z"])
    ck("two-column fit", abs(f2["x"] - 2) < 1e-6 and abs(f2["z"] - 3) < 1e-6)
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
        attrs(st)
        return 0
    if "--attrs" in argv:
        for st in STATES:
            if os.path.exists(os.path.join(RAW, "%s-soil.json.gz" % st)):
                attrs(st)
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
