#!/usr/bin/env python3
"""Per-state place files for /here (the one box): data/atlas/pct/<ST>.json.

Each file holds, for every county in the state, the handful of Farmland Atlas
figures the place page ranks ("fingerprint" columns), the county's center, its
page links, and the 2 or 3 figures that sit furthest from its neighbors. The
page reads one county file (data/atlas/counties/<fips>.json) and its state's
file here, nothing per place. data/atlas/pct/index.json lists every county's
name and state, for a county typed without its state.

Ranks are computed in the browser (components/place.js) from the values here,
among the state's counties that carry the figure. Nothing is ranked across
years: a county whose latest figure is from another year than most of its
state keeps its own number and year, unranked, with the reason.

  python3 scripts/build_place_pct.py          write the files
  python3 scripts/build_place_pct.py --check  fail if any file is stale
  python3 scripts/build_place_pct.py --selftest

Built only from files already in the repo; no network.
"""
import collections
import json
import math
import os
import re
import sys
import unicodedata

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ATLAS = os.path.join(REPO, "data", "atlas")
OUT = os.path.join(ATLAS, "pct")
SCHEMA = "agsist-place-pct/1"
MIN_NEIGHBORS = 3       # a neighbor median needs at least this many neighbors with the figure
MIN_SCORE = 1.0         # in national middle-half widths (IQR); the page calls a gap this big "unusual"
MAX_UNUSUAL = 3

STATE_NAMES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California",
    "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware", "FL": "Florida", "GA": "Georgia",
    "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa",
    "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri",
    "MT": "Montana", "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey",
    "NM": "New Mexico", "NY": "New York", "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio",
    "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
    "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont",
    "VA": "Virginia", "WA": "Washington", "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
}


def get(d, *path):
    for p in path:
        if not isinstance(d, dict):
            return None
        d = d.get(p)
    return d


def ok(rec, block):
    b = rec.get(block)
    return isinstance(b, dict) and b.get("status") == "ok"


def why(rec, block):
    """The block's own reason when it is not ok, else a plain one."""
    b = rec.get(block)
    if not isinstance(b, dict):
        return "no figure in the source for this county"
    s = str(b.get("status") or "")
    if s and s != "ok":
        return s
    return "no figure in the source for this county"


def num(x):
    return x if isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) else None


# ------------------------------------------------------------------ the columns
# Each: id, registry layer id (data/layers.json), label, short label, unit, decimals,
# better ("higher"/"lower"/"none": what reads as good, for words only), years (text),
# and pick(rec) -> (value, year or None, reason when None).
def _rent(r):
    if not ok(r, "rent"):
        return None, None, why(r, "rent")
    v = get(r, "rent", "nonirr")
    if not v or num(v.get("value")) is None:
        return None, None, "NASS printed no nonirrigated cropland rent for this county"
    return v["value"], v.get("year"), None


def _value(r):
    if not ok(r, "value"):
        return None, None, why(r, "value")
    v = num(get(r, "value", "latest"))
    return (v, get(r, "value", "latest_year"), None) if v is not None else (None, None, "no census land value")


def _yield(r):
    if not ok(r, "yield"):
        return None, None, why(r, "yield")
    return num(get(r, "yield", "median")), None, None


def _ratio(r):
    if not ok(r, "sob"):
        return None, None, why(r, "sob")
    v = num(get(r, "sob", "last10", "ratio"))
    return (v, None, None) if v is not None else (None, None, "withheld: too little premium in the last 10 years for a ratio")


def _drought(r):
    if not ok(r, "drought"):
        return None, None, why(r, "drought")
    return num(get(r, "drought", "weeks", "share_d2_pct")), None, None


def _hail(r):
    if not ok(r, "storms"):
        return None, None, why(r, "storms")
    return num(get(r, "storms", "hail_1in_days_per_year")), None, None


def _gsrain(r):
    if not ok(r, "climate"):
        return None, None, why(r, "climate")
    v = num(get(r, "climate", "gs_normal_in"))
    return (v, None, None) if v is not None else (None, None, get(r, "climate", "gs_status") or "no 1991-2020 normal")


def _ffd(r):
    if not ok(r, "frost"):
        return None, None, why(r, "frost")
    f = get(r, "frost", "frost_free_days") or {}
    if f.get("at_least"):
        return None, None, "withheld: too many years with no frost on one side to give a middle length"
    return num(f.get("median")), None, None


def _gdd(r):
    if not ok(r, "frost"):
        return None, None, why(r, "frost")
    return num(get(r, "frost", "gdd", "median")), None, None


def _nights(r):
    if not ok(r, "heat"):
        return None, None, why(r, "heat")
    return num(get(r, "heat", "months", "jul", "recent", "mean")), None, None


def _irr(r):
    if not ok(r, "water"):
        return None, None, why(r, "water")
    v = num(get(r, "water", "irrigated_share_2022", "share"))
    return (round(v * 100, 1), 2022, None) if v is not None else (None, None, "no 2022 census irrigated acres")


def _practice(key):
    def pick(r):
        if not ok(r, "practices"):
            return None, None, why(r, "practices")
        p = get(r, "practices", key) or {}
        v = num(p.get("share"))
        if v is None:
            return None, None, p.get("status") or "not printed for this county"
        return round(v * 100, 1), 2022, None
    return pick


def _crp(r):
    if not ok(r, "crp"):
        return None, None, why(r, "crp")
    v = num(get(r, "crp", "share_of_cropland", "pct"))
    return (v, None, None) if v is not None else (None, None, "withheld: under 100 CRP acres, too few for a share")


def _cattle(r):
    if not ok(r, "livestock"):
        return None, None, why(r, "livestock")
    v = num(get(r, "livestock", "cattle_per_1000ac"))
    return (v, 2022, None) if v is not None else (None, None, "no 2022 census cattle count or farm acres")


def _energy(r):
    if not ok(r, "energy"):
        return None, None, why(r, "energy")
    o = get(r, "energy", "operable") or {}
    s, w = num(o.get("solar")), num(o.get("wind"))
    if s is None and w is None:
        return None, None, "no EIA 860 figure"
    return round((s or 0) + (w or 0), 1), get(r, "energy", "year"), None


COLUMNS = [
    ("rent", "rent", "Cash rent, nonirrigated cropland", "Rent", "$/ac", 0, "none", "NASS survey year", _rent),
    ("land_value", "land_value", "Farmland value, land and buildings", "Land value", "$/ac", 0, "none", "2022 census", _value),
    ("yield", "yield", "Corn yield, middle year since 2008", "Corn yield", "bu/ac", 1, "higher", "8 or more published years since 2008", _yield),
    ("loss_ratio", "insurance_loss_ratio", "Crop insurance loss ratio, last 10 years", "Loss ratio", "paid out / premium", 2, "lower", "2016-2025", _ratio),
    ("drought", "drought_history", "Weeks in severe drought or worse (D2+), since 2000", "Drought weeks", "% of weeks", 1, "lower", "2000 to date", _drought),
    ("hail", "storms", "Days with hail of 1 inch or more reported, a year", "Hail days", "days a year", 2, "lower", "2010-2025", _hail),
    ("gs_rain", "climate", "April to September rain, 1991-2020 normal", "Season rain", "inches", 1, "none", "1991-2020", _gsrain),
    ("frost_free", "frost", "Frost-free days, middle year", "Frost-free days", "days", 0, "none", "1996-2025", _ffd),
    ("gdd", "frost", "Corn growing degree days, May to September, middle year", "GDD", "GDD", 0, "none", "1996-2025", _gdd),
    ("july_nights", "night_heat", "July night lows, last 10 years", "July nights", "deg F", 1, "lower", "2017-2026", _nights),
    ("irrigated", "irrigation", "Harvested acres that are irrigated", "Irrigated", "% of acres", 1, "none", "2022 census", _irr),
    ("tile", "practices", "Cropland with tile drainage", "Tile", "% of cropland", 1, "none", "2022 census", _practice("tile")),
    ("notill", "practices", "Cropland in no-till", "No-till", "% of cropland", 1, "none", "2022 census", _practice("notill")),
    ("cover", "practices", "Cropland in cover crops", "Cover crops", "% of cropland", 1, "none", "2022 census", _practice("cover")),
    ("crp", "crp", "Cropland enrolled in CRP", "CRP", "% of cropland", 1, "none", "2025 FSA", _crp),
    ("cattle", "livestock", "Cattle per 1,000 acres of farmland", "Cattle", "head / 1,000 ac", 1, "none", "2022 census", _cattle),
    ("wind_solar", "power_plants", "Wind and solar running, megawatts", "Wind + solar", "MW", 1, "none", "EIA 860, 2025", _energy),
]


def norm_name(s):
    s = unicodedata.normalize("NFKD", str(s or ""))
    s = "".join(ch for ch in s if not unicodedata.combining(ch)).lower()
    return re.sub(r"[^a-z0-9]+", "-", s.replace("'", "").replace("’", "").replace("&", " and ")).strip("-") or "x"


def centroid(geom):
    """Area-weighted center of the largest ring set; plain mean as a fallback."""
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    A = cx = cy = 0.0
    for poly in polys:
        ring = poly[0]
        for i in range(len(ring) - 1):
            x0, y0 = ring[i]
            x1, y1 = ring[i + 1]
            c = x0 * y1 - x1 * y0
            A += c
            cx += (x0 + x1) * c
            cy += (y0 + y1) * c
    if abs(A) < 1e-12:
        pts = [p for poly in polys for p in poly[0]]
        return round(sum(p[1] for p in pts) / len(pts), 3), round(sum(p[0] for p in pts) / len(pts), 3)
    return round(cy / (3 * A), 3), round(cx / (3 * A), 3)


def quantiles(vals):
    v = sorted(vals)
    if len(v) < 4:
        return None
    def q(p):
        k = (len(v) - 1) * p
        lo, hi = math.floor(k), math.ceil(k)
        return v[lo] + (v[hi] - v[lo]) * (k - lo)
    return q(0.25), q(0.75)


def median(vals):
    v = sorted(vals)
    n = len(v)
    return None if not n else (v[n // 2] if n % 2 else (v[n // 2 - 1] + v[n // 2]) / 2)


def rnd(x, d):
    if x is None:
        return None
    r = round(x, d)
    return int(r) if d == 0 else r


def build(root=REPO):
    atlas = os.path.join(root, "data", "atlas")
    summary = json.load(open(os.path.join(atlas, "atlas.json"), encoding="utf-8"))
    generated = summary.get("generated")
    units = {f: c.get("u") for f, c in summary["counties"].items()}
    geo = json.load(open(os.path.join(atlas, "counties.geo.json"), encoding="utf-8"))
    cent = {f["id"]: centroid(f["geometry"]) for f in geo["features"]}
    nbs = json.load(open(os.path.join(atlas, "neighbors.json"), encoding="utf-8"))["counties"]
    recs = {}
    cdir = os.path.join(atlas, "counties")
    for fn in sorted(os.listdir(cdir)):
        if fn.endswith(".json"):
            r = json.load(open(os.path.join(cdir, fn), encoding="utf-8"))
            if r.get("state") in STATE_NAMES:
                recs[r["fips"]] = r

    # raw picks
    pick = {}
    for f, r in recs.items():
        pick[f] = [col[8](r) for col in COLUMNS]

    # the year most of a state's counties carry, per year-stamped column
    modal = {}
    for i, col in enumerate(COLUMNS):
        by_st = collections.defaultdict(collections.Counter)
        for f, r in recs.items():
            v, y, _ = pick[f][i]
            if v is not None and y is not None:
                by_st[r["state"]][y] += 1
        for st, cnt in by_st.items():
            top = cnt.most_common()
            modal[(i, st)] = max(y for y, n in top if n == top[0][1])

    def ranked(f, i):
        """(value, year, reason): the value only when it can be ranked in its state."""
        v, y, why_ = pick[f][i]
        if v is None:
            return None, None, why_
        m = modal.get((i, recs[f]["state"]))
        if y is not None and m is not None and y != m:
            return None, y, "%s figure; most %s counties have %s, so it is not ranked" % (y, STATE_NAMES[recs[f]["state"]], m)
        return v, y, None

    # national middle-half width per column (the yardstick for "unusual")
    iqr = []
    for i in range(len(COLUMNS)):
        vals = [ranked(f, i)[0] for f in recs]
        q = quantiles([v for v in vals if v is not None])
        iqr.append(None if not q or q[1] - q[0] <= 0 else q[1] - q[0])

    files = {}
    index = {}
    pages = {}
    for f, r in recs.items():
        st = r["state"]
        slug_st = norm_name(STATE_NAMES[st])
        u = units.get(f)
        label = r["name"] + (" " + (u if u is not None else "County") if u != "" else "")
        slug = norm_name(label)
        flags = ""
        for k, d in (("a", "farmland-atlas"), ("r", "rain"), ("p", "prf"), ("c", "arc-plc")):
            if os.path.exists(os.path.join(root, d, slug_st, slug + ".html")):
                flags += k
        pages[f] = (label, slug, flags)
        index[f] = [label, st]

    for st in sorted(STATE_NAMES):
        fl = sorted(f for f in recs if recs[f]["state"] == st)
        if not fl:
            continue
        metrics = []
        for i, col in enumerate(COLUMNS):
            n = sum(1 for f in fl if ranked(f, i)[0] is not None)
            m = {"id": col[0], "layer": col[1], "label": col[2], "short": col[3], "unit": col[4], "dp": col[5],
                 "better": col[6], "years": col[7], "n": n}
            if (i, st) in modal:
                m["year"] = modal[(i, st)]
            metrics.append(m)
        counties = {}
        for f in fl:
            r = recs[f]
            label, slug, flags = pages[f]
            row = {"n": label, "s": slug}
            if flags:
                row["k"] = flags
            if f in cent:
                row["c"] = list(cent[f])
            v, w, o = [], {}, {}
            for i, col in enumerate(COLUMNS):
                val, y, reason = ranked(f, i)
                v.append(rnd(val, col[5]))
                if val is None:
                    raw = pick[f][i][0]
                    if raw is not None:
                        o[str(i)] = [rnd(raw, col[5]), y]
                    w[str(i)] = reason
            row["v"] = v
            if w:
                row["w"] = w
            if o:
                row["o"] = o
            if r.get("yield", {}).get("window") and v[2] is not None:
                row["yw"] = r["yield"]["window"]
            # furthest from the neighbors
            cand = []
            for i, col in enumerate(COLUMNS):
                me = ranked(f, i)[0]
                if me is None or not iqr[i]:
                    continue
                nv = [ranked(g, i)[0] for g in nbs.get(f, []) if g in recs]
                nv = [x for x in nv if x is not None]
                if len(nv) < MIN_NEIGHBORS:
                    continue
                md = median(nv)
                cand.append((round(abs(me - md) / iqr[i], 2), i, md, len(nv)))
            cand.sort(key=lambda t: (-t[0], t[1]))
            if cand:
                row["u"] = [[i, rnd(md, COLUMNS[i][5] + (1 if COLUMNS[i][5] < 2 else 0)), n, s] for s, i, md, n in cand[:MAX_UNUSUAL]]
            nb = [g for g in nbs.get(f, []) if g in recs]
            if nb:
                row["nb"] = nb
            counties[f] = row
        doc = {
            "schema": SCHEMA,
            "note": "Built by scripts/build_place_pct.py from data/atlas/counties/*.json. Do not edit. v: one value per metric (null: not ranked, reason in w; a figure from another year in o). u: [metric, neighbor median, neighbors with the figure, distance in national middle-half widths]. Ranks are among this state's counties with the figure.",
            "state": st,
            "name": STATE_NAMES[st],
            "atlas_generated": generated,
            "unusual_rule": "u lists the 3 biggest gaps; the page calls one unusual when it is at least %s national middle-half widths (IQR) from the median of %d or more neighboring counties" % (MIN_SCORE, MIN_NEIGHBORS),
            "unusual_min": MIN_SCORE,
            "metrics": metrics,
            "counties": counties,
        }
        files[os.path.join(root, "data", "atlas", "pct", st + ".json")] = json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n"
    files[os.path.join(root, "data", "atlas", "pct", "index.json")] = json.dumps(
        {"schema": SCHEMA, "note": "Every county: [name, state]. Built by scripts/build_place_pct.py.", "atlas_generated": generated,
         "counties": dict(sorted(index.items()))}, ensure_ascii=False, separators=(",", ":")) + "\n"
    return files


def selftest():
    assert norm_name("St. Mary's Parish") == "st-marys-parish", norm_name("St. Mary's Parish")
    assert centroid({"type": "Polygon", "coordinates": [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]]}) == (1.0, 1.0)
    assert median([3, 1, 2]) == 2 and median([1, 2, 3, 4]) == 2.5
    assert quantiles([1, 2, 3, 4, 5]) == (2, 4)
    r = {"rent": {"status": "ok", "nonirr": {"value": 103.0, "year": 2026}}, "practices": {"status": "ok", "tile": {"share": 0.0071}}}
    assert _rent(r) == (103.0, 2026, None)
    assert _practice("tile")(r) == (0.7, 2022, None)
    assert _rent({"rent": {"status": "withheld: x"}})[2] == "withheld: x"
    assert _practice("cover")(r)[0] is None
    print("selftest ok")


def main():
    if "--selftest" in sys.argv:
        selftest()
        return
    files = build()
    have = set(os.path.join(OUT, f) for f in os.listdir(OUT)) if os.path.isdir(OUT) else set()
    if "--check" in sys.argv:
        bad = [p for p, t in files.items() if not os.path.exists(p) or open(p, encoding="utf-8").read() != t]
        bad += sorted(have - set(files))
        if bad:
            print("stale data/atlas/pct files (run scripts/build_place_pct.py):")
            for p in bad[:20]:
                print("  " + os.path.relpath(p, REPO))
            sys.exit(1)
        print("data/atlas/pct matches the Atlas county files (%d files)" % len(files))
        return
    os.makedirs(OUT, exist_ok=True)
    for p in sorted(have - set(files)):
        os.remove(p)
    total = 0
    for p, t in files.items():
        with open(p, "w", encoding="utf-8") as fh:
            fh.write(t)
        total += len(t.encode("utf-8"))
    print("wrote %d files under data/atlas/pct, %d KB" % (len(files), total // 1024))


if __name__ == "__main__":
    main()
