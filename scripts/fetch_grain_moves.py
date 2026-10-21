#!/usr/bin/env python3
"""fetch_grain_moves.py -- "Grain on the move" (/grain-transport).

Where grain is moving and what it costs to move it, set beside the basis the
AGSIST network reads. Runs in transport.yml after fetch_transport.py.

SOURCES (all free, no key; dataset ids from the AgTransport catalogue):
  USDA AgTransport (agtransport.usda.gov, Socrata). AMS posts the Grain
  Transportation Report tables here each week (Thursday):
    barge_rates     deqi-uken  downbound barge rate, % of 1976 tariff, 7 segments
    railcar         cvu8-kpyk  secondary railcar market bids, $/car, BNSF/UP/CPKC
    lock_tons       n4pw-9ygw  downbound grain barge tons by lock (USACE LPMS)
    car_orders      57pa-stwn  manifest grain car orders past due (STB EP 724)
    train_speed     2wy9-nmz4  train speed by train type (STB EP 724)
    carloads        tb7q-kn5i  weekly rail carloads (AAR, via AMS)
    inspections     sruw-w49i  grain inspected for export (FGIS)
    ocean           kscj-g8km  Gulf and PNW to Japan vessel rates and spread
    vessels         uiht-9xts  vessels loaded / due, Gulf and PNW
    cost_index      8uye-ieij  truck/shuttle/barge/vessel cost indicators
    grain_basis     v85y-3hep  USDA regional basis (the connection, below)
  USGS Water Data daily stage, Mississippi at St. Louis (07010000) and
  Memphis (07032000): context only.

FIELD NAMES ARE READ, NOT ASSUMED. Only deqi-uken, 8uye-ieij and v85y-3hep
were probe-verified (fetch_transport.py). For every other dataset the column
names are taken from the dataset's own metadata (/api/views/<id>.json) by
pattern, and the columns used are written into index.json beside two sample
rows. A dataset whose columns cannot be matched is reported "failed" with the
columns it does have; its last good file is kept, never overwritten with less.

OUR OWN DATA: the weekly state basis is replayed from data/basis/<ST>.json and
data/basis/changes-*.json (build_basis_history.py), the AGSIST network's
record since 2026-06-09. Offline.

THE CONNECTION is computed here, not on the page (honest-numbers rule 9): for
groups of USDA regions, weekly basis against its own same-week 5-year normal
next to freight against its normal. Pearson r, the number of weeks, the
independent weeks after autocorrelation, a p-value from Fisher's z on those,
and a Benjamini-Hochberg correction across every pair tested. A pair under
MIN_EFF_N independent weeks says "not enough history to say". Correlation
only: the wording never says one caused the other.

    python3 scripts/fetch_grain_moves.py               # fetch + write + bake
    python3 scripts/fetch_grain_moves.py --local       # our basis only, offline
    python3 scripts/fetch_grain_moves.py --selftest    # offline, fixtures
    python3 scripts/fetch_grain_moves.py --fixtures DIR  # whole build from fixtures into DIR
"""
import glob
import html
import json
import math
import os
import re
import statistics
import sys
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_transport import same_week_avg_n, iso_year_week  # noqa: E402
from basis_method import robust_split  # noqa: E402

REPO = os.environ.get("AGSIST_REPO", ".")
HOST = "https://agtransport.usda.gov"
UA = {"User-Agent": "AGSIST/1.0 (+https://agsist.com)"}
OUT_DIR = "data/transport/moves"
PAGE = "grain-transport.html"
FIX_DIR = "test/fixtures/transport"
YEARS_KEPT = 3          # chart window
YEARS_PULLED = 8        # 3 kept on the charts; the rest feeds the same-week normal and the connection's record
MIN_EFF_N = 20          # independent weeks before an r is printed
MIN_NORMAL_N = 3        # prior years before a "vs normal" is printed
Q_GATE = 0.05
BUDGET_BYTES = 5 * 1024 * 1024
# 1976 benchmark tariff, $/short ton, by segment. NOT YET CHECKED against the
# GTR's own table (the sandbox cannot open AMS); until it is, the page prints
# percent of tariff only and no cents per bushel. Set True only after reading
# the table in a Grain Transportation Report (references id ams-gtr-latest).
BENCHMARK_VERIFIED = False
BENCHMARK = {"Twin Cities": 6.19, "Mid-Mississippi": 5.32, "Lower Illinois": 4.64, "St. Louis": 3.99,
             "Cincinnati": 4.69, "Lower Ohio": 4.46, "Cairo-Memphis": 3.14}

AMS_GTR = "https://www.ams.usda.gov/services/transportation-analysis/gtr"


def ds_url(ds):
    return f"{HOST}/d/{ds}"


SRC = {
    "barge_rates": {"ds": "deqi-uken", "name": "USDA AMS, Grain Transportation Report: downbound barge rates",
                    "agency": "USDA AMS"},
    "railcar": {"ds": "cvu8-kpyk", "name": "USDA AMS, secondary railcar auction market bids", "agency": "USDA AMS"},
    "lock_tons": {"ds": "n4pw-9ygw", "name": "USDA AMS from Army Corps of Engineers lock records (LPMS): downbound grain barge tons",
                  "agency": "USDA AMS, USACE"},
    "car_orders": {"ds": "57pa-stwn", "name": "USDA AMS from Surface Transportation Board EP 724 filings: grain car orders past due (manifest)",
                   "agency": "USDA AMS, STB"},
    "train_speed": {"ds": "2wy9-nmz4", "name": "USDA AMS from STB EP 724 filings: train speed", "agency": "USDA AMS, STB"},
    "carloads": {"ds": "tb7q-kn5i", "name": "USDA AMS from Association of American Railroads weekly traffic: rail carloads",
                 "agency": "USDA AMS, AAR"},
    "inspections": {"ds": "sruw-w49i", "name": "USDA AMS from Federal Grain Inspection Service: grain inspected for export",
                    "agency": "USDA AMS, FGIS"},
    "ocean": {"ds": "kscj-g8km", "name": "USDA AMS: U.S. Gulf and Pacific Northwest to Japan grain vessel rates",
              "agency": "USDA AMS"},
    "vessels": {"ds": "uiht-9xts", "name": "USDA AMS: grain vessel loading activity, Gulf and PNW", "agency": "USDA AMS"},
    "cost_index": {"ds": "8uye-ieij", "name": "USDA AMS: grain transportation cost indicators", "agency": "USDA AMS"},
    "grain_basis": {"ds": "v85y-3hep", "name": "USDA AMS: weekly regional grain basis", "agency": "USDA AMS"},
    "river": {"ds": None, "name": "USGS Water Data, daily mean gage height", "agency": "USGS",
              "url": "https://waterdata.usgs.gov/monitoring-location/07010000/"},
}
for _k, _v in SRC.items():
    _v.setdefault("url", ds_url(_v["ds"]) if _v["ds"] else "")

RIVER_SITES = {"stl": ("07010000", "Mississippi River at St. Louis"),
               "mem": ("07032000", "Mississippi River at Memphis")}

# Regions grouped by how most of their grain leaves. Iowa and Minnesota ship
# both ways in volume and are left out of both groups (shown on their own).
RIVER_STATES = ["Illinois", "Indiana", "Ohio"]
RAIL_STATES = ["Nebraska", "Kansas", "South Dakota", "North Dakota"]
ST_CODE = {"Illinois": "IL", "Indiana": "IN", "Ohio": "OH", "Nebraska": "NE", "Kansas": "KS",
           "South Dakota": "SD", "North Dakota": "ND", "Iowa": "IA", "Minnesota": "MN"}


# --------------------------------------------------------------- network ----
def http_json(url, tries=(0, 15, 45)):
    last = None
    for pause in tries:
        if pause:
            time.sleep(pause)
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001 -- retried, then raised to the source's own handler
            last = e
    raise RuntimeError(f"{url.split('?')[0]}: {type(last).__name__}: {last}")


class Live:
    """The network. Fixtures replace it in the selftest (same three calls)."""

    def meta(self, ds):
        return http_json(f"{HOST}/api/views/{ds}.json")

    def rows(self, ds, params):
        params = dict(params)
        # newest first, so a pull that hits the row limit loses the oldest weeks, never the newest
        if "$order" not in params and "$group" not in params and "$where" in params:
            params["$order"] = params["$where"].split()[0] + " DESC"
        rows = http_json(f"{HOST}/resource/{ds}.json?" + urllib.parse.urlencode(params))
        if len(rows) >= int(params.get("$limit", 1000)):
            print(f"::warning::grain moves: {ds} returned {len(rows)} rows, the limit; the oldest weeks are cut")
        return rows

    def usgs(self, site, start, end):
        u = ("https://waterservices.usgs.gov/nwis/dv/?" + urllib.parse.urlencode(
            {"format": "json", "sites": site, "parameterCd": "00065", "statCd": "00003",
             "startDT": start, "endDT": end}))
        try:
            return parse_usgs_legacy(http_json(u))
        except Exception as e:  # noqa: BLE001 -- the newer USGS API, same numbers
            u2 = ("https://api.waterdata.usgs.gov/ogcapi/v0/collections/daily/items?" + urllib.parse.urlencode(
                {"f": "json", "monitoring_location_id": f"USGS-{site}", "parameter_code": "00065",
                 "statistic_id": "00003", "time": f"{start}/{end}", "limit": 10000}))
            try:
                return parse_usgs_ogc(http_json(u2))
            except Exception as e2:  # noqa: BLE001
                raise RuntimeError(f"USGS legacy: {e}; USGS OGC: {e2}")


def make_fixtures(out):
    """Synthetic rows from test/fixtures/transport/make_fixtures.py into out."""
    import subprocess
    subprocess.run([sys.executable, os.path.join(REPO, FIX_DIR, "make_fixtures.py"), out], check=True,
                   stdout=subprocess.DEVNULL)
    return out


class Fixtures:
    """<dir>/<ds>.meta.json, <ds>.rows.json, usgs-<site>.json, written by make_fixtures()."""

    def __init__(self, d):
        self.d = d

    def _load(self, name):
        p = os.path.join(self.d, name)
        if not os.path.exists(p):
            raise RuntimeError(f"no fixture {name}")
        return json.load(open(p))

    def meta(self, ds):
        return self._load(f"{ds}.meta.json")

    def rows(self, ds, params):
        rows = self._load(f"{ds}.rows.json")
        return rows

    def usgs(self, site, start, end):
        return parse_usgs_legacy(self._load(f"usgs-{site}.json"))


def parse_usgs_legacy(j):
    """WaterServices dv JSON -> [(YYYY-MM-DD, ft)]. noDataValue rows dropped."""
    out = []
    for ts in j["value"]["timeSeries"]:
        nd = ts.get("variable", {}).get("noDataValue")
        for blk in ts.get("values", []):
            for v in blk.get("value", []):
                try:
                    x = float(v["value"])
                except (KeyError, TypeError, ValueError):
                    continue
                if nd is not None and x == float(nd):
                    continue
                out.append((v["dateTime"][:10], round(x, 2)))
    if not out:
        raise RuntimeError("USGS: no values")
    return sorted(out)


def parse_usgs_ogc(j):
    out = []
    for f in j.get("features", []):
        p = f.get("properties", {})
        try:
            out.append((str(p["time"])[:10], round(float(p["value"]), 2)))
        except (KeyError, TypeError, ValueError):
            continue
    if not out:
        raise RuntimeError("USGS OGC: no values")
    return sorted(out)


# ------------------------------------------------------------- columns -----
def columns(meta):
    """[{field, name, type}] without Socrata's hidden :system columns."""
    out = []
    for c in meta.get("columns", []):
        f = c.get("fieldName", "")
        if not f or f.startswith(":"):
            continue
        out.append({"field": f, "name": str(c.get("name", "")), "type": str(c.get("dataTypeName", "")).lower()})
    return out


def pick(cols, pattern, types=None, not_pattern=None, used=()):
    """First column whose field name or display name matches `pattern`
    (case-insensitive), optionally of one of `types`, not matching
    `not_pattern`, not already used. -> field name or None."""
    rx = re.compile(pattern, re.I)
    nx = re.compile(not_pattern, re.I) if not_pattern else None
    for c in cols:
        if c["field"] in used:
            continue
        hay = c["field"] + " " + c["name"]
        if not rx.search(hay):
            continue
        if nx and nx.search(hay):
            continue
        if types and c["type"] not in types:
            continue
        return c["field"]
    return None


def need(colmap, *names):
    miss = [n for n in names if not colmap.get(n)]
    if miss:
        raise SchemaError("could not match column(s): " + ", ".join(miss))


class SchemaError(RuntimeError):
    pass


def date_col(cols):
    return (pick(cols, r"date|week", types=("calendar_date", "date", "floating_timestamp"))
            or pick(cols, r"^date$|report.?date|week.?end|date"))


def fnum(v):
    try:
        x = float(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return None
    return x if x == x and abs(x) != float("inf") else None


def d10(v):
    s = str(v or "")[:10]
    return s if re.match(r"^\d{4}-\d{2}-\d{2}$", s) else None


MONTHS = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}


def month_of(v, ref=None):
    """A delivery month in any of the shapes AMS has used -> (year, month).
    '2026-10-01T00:00:00.000', 'Oct 2026', 'October 2026', '10/2026', 'Oct-26',
    'Oct' (year taken from ref so the month is on or after ref's month)."""
    s = str(v or "").strip()
    m = re.match(r"^(\d{4})-(\d{2})", s)
    if m:
        return int(m.group(1)), int(m.group(2))
    m = re.match(r"^(\d{1,2})/(\d{4})$", s)
    if m:
        return int(m.group(2)), int(m.group(1))
    m = re.match(r"^([A-Za-z]{3})[A-Za-z]*\.?[\s\-']*(\d{2,4})?$", s)
    if m and m.group(1).lower() in MONTHS:
        mo = MONTHS[m.group(1).lower()]
        if m.group(2):
            y = int(m.group(2))
            return (2000 + y if y < 100 else y), mo
        if ref:
            ry, rm = int(ref[:4]), int(ref[5:7])
            return (ry if mo >= rm else ry + 1), mo
    return None


def railroad_of(v):
    s = str(v or "").upper()
    if "BNSF" in s:
        return "BNSF"
    if "UNION" in s or re.search(r"\bUP\b", s) or s == "UPRR":
        return "UP"
    if "CPKC" in s or "KCS" in s or re.search(r"\bCP\b", s):
        return "CPKC"
    if "CSX" in s:
        return "CSX"
    if "NORFOLK" in s or re.search(r"\bNS\b", s):
        return "NS"
    if s.startswith("CN") or "CANADIAN NATIONAL" in s:
        return "CN"
    return None


def shuttle_of(v):
    s = str(v or "").strip().lower()
    if s in ("true", "1", "y", "yes"):
        return True
    if s in ("false", "0", "n", "no"):
        return False
    if "non" in s or "manifest" in s or "single" in s:
        return False
    if "shuttle" in s or "unit" in s:
        return True
    return None


# -------------------------------------------------------------- shaping ----
def cutoff(today, years):
    return (today - timedelta(days=int(365.25 * years))).isoformat()


def weekly_mean(pts):
    """[(date, v)] -> one point per ISO week: the mean, dated by the week's
    newest posting. Several rows a week (delivery months, railroads) become one."""
    by = defaultdict(list)
    for d, v in pts:
        by[iso_year_week(d)].append((d, v))
    out = []
    for _, xs in by.items():
        out.append((max(d for d, _ in xs), sum(v for _, v in xs) / len(xs)))
    return sorted(out)


def series_doc(sid, title, unit, src_key, pts, today, *, note="", digits=2, extra=None, normal=True,
               dearer_when="up"):
    """The one shape every series file has. pts: [(YYYY-MM-DD, value)]."""
    pts = sorted((d, v) for d, v in pts if d and v is not None)
    src = SRC[src_key]
    doc = {"id": sid, "title": title, "unit": unit, "note": note,
           "source": {"name": src["name"], "url": src["url"], "agency": src["agency"]},
           "fetched": today.isoformat(), "points": [], "latest": None}
    if not pts:
        return doc
    _full_points[sid] = pts
    keep_from = cutoff(today, YEARS_KEPT)
    byw = {iso_year_week(d): {"v": v} for d, v in pts}
    doc["points"] = [[d, round(v, digits)] for d, v in pts if d >= keep_from]
    ld, lv = pts[-1]
    doc["latest"] = {"date": ld, "value": round(lv, digits)}
    if len(pts) > 1:
        pd, pv = pts[-2]
        gap = (date.fromisoformat(ld) - date.fromisoformat(pd)).days
        if gap <= 9:  # a week, not a gap
            doc["prev"] = {"date": pd, "value": round(pv, digits)}
            doc["chg"] = round(lv - pv, digits)
    if normal:
        y, w = iso_year_week(ld)
        avg, n = same_week_avg_n(byw, w, y, "v")
        if avg is not None and n >= MIN_NORMAL_N:
            doc["normal"] = {"value": round(avg, digits), "years": n,
                             "vs": round(lv - avg, digits)}
        elif avg is not None:
            doc["normal"] = {"value": None, "years": n, "why": f"only {n} earlier year(s) on file"}
    doc["dearer_when"] = dearer_when
    if extra:
        doc.update(extra)
    return doc


def shape_barge(cli, today):
    cols = columns(cli.meta(SRC["barge_rates"]["ds"]))
    cm = {"date": date_col(cols), "loc": pick(cols, r"location|segment"), "rate": pick(cols, r"rate|percent|tariff")}
    need(cm, "date", "loc", "rate")
    rows = cli.rows(SRC["barge_rates"]["ds"], {"$where": f"{cm['date']} >= '{cutoff(today, YEARS_PULLED)}'",
                                                "$limit": 50000, "$select": f"{cm['date']},{cm['loc']},{cm['rate']}"})
    by = defaultdict(list)
    for r in rows:
        d, v = d10(r.get(cm["date"])), fnum(r.get(cm["rate"]))
        if d and v is not None and 0 < v < 10000:
            by[str(r.get(cm["loc"], "")).strip()].append((d, v))
    if not by:
        raise SchemaError("no barge rows")
    docs = {}
    for loc, pts in by.items():
        slug = re.sub(r"[^a-z0-9]+", "-", loc.lower()).strip("-")
        extra = {"location": loc}
        if BENCHMARK_VERIFIED and loc in BENCHMARK:
            extra["benchmark_usd_ton"] = BENCHMARK[loc]
        docs[f"barge-{slug}"] = series_doc(f"barge-{slug}", f"Barge rate, {loc}", "% of 1976 tariff", "barge_rates",
                                           weekly_mean(pts), today, digits=1, extra=extra,
                                           note="Downbound to the Gulf. 100% is the 1976 benchmark tariff for the segment.")
    return docs, cm, rows[:2]


def shape_railcar(cli, today):
    ds = SRC["railcar"]["ds"]
    cols = columns(cli.meta(ds))
    cm = {"date": date_col(cols)}
    cm["rr"] = pick(cols, r"railroad|carrier|company|rail_?road")
    cm["deliv"] = pick(cols, r"deliver|month", not_pattern=r"report", used=(cm["date"],))
    cm["shuttle"] = pick(cols, r"shuttle|service|train.?type|car.?type")
    cm["kind"] = pick(cols, r"bid.?offer|bid.?type|^type$|measure|side", not_pattern=r"shuttle|train|car")
    cm["value"] = (pick(cols, r"bid", types=("number", "money", "double"), not_pattern=r"offer")
                   or pick(cols, r"average|value|price|amount|premium", types=("number", "money", "double")))
    need(cm, "date", "rr", "value")
    rows = cli.rows(ds, {"$where": f"{cm['date']} >= '{cutoff(today, YEARS_PULLED)}'", "$limit": 50000})
    # nearest delivery month on or after the report month, per report date x railroad x service
    cells = defaultdict(list)
    for r in rows:
        d, v = d10(r.get(cm["date"])), fnum(r.get(cm["value"]))
        rr = railroad_of(r.get(cm["rr"]))
        if not d or v is None or rr is None or abs(v) > 20000:
            continue
        if cm["kind"] and "offer" in str(r.get(cm["kind"], "")).lower():
            continue
        sh = shuttle_of(r.get(cm["shuttle"])) if cm["shuttle"] else True
        if sh is None:
            continue
        mo = month_of(r.get(cm["deliv"]), d) if cm["deliv"] else None
        cells[(d, rr, sh)].append((mo, v))
    by = defaultdict(list)
    for (d, rr, sh), xs in cells.items():
        ref = (int(d[:4]), int(d[5:7]))
        dated = [x for x in xs if x[0] is not None and x[0] >= ref]
        if dated:
            first = min(m for m, _ in dated)
            vals = [v for m, v in dated if m == first]
        else:
            vals = [v for m, v in xs if m is None]
        if vals:
            by[(rr, sh)].append((d, sum(vals) / len(vals)))
    docs = {}
    for (rr, sh), pts in by.items():
        if rr not in ("BNSF", "UP"):
            continue
        kind = "shuttle" if sh else "nonshuttle"
        lab = "shuttle train" if sh else "single car (non-shuttle)"
        sid = f"railcar-{rr.lower()}-{kind}"
        docs[sid] = series_doc(sid, f"{rr} {lab}, secondary market bid", "$ per car over tariff", "railcar",
                               weekly_mean(pts), today, digits=0,
                               note="Average bid for the nearest delivery month, on top of the railroad's tariff. "
                                    "Below zero means sellers pay buyers to take the car.")
    if not docs:
        raise SchemaError("no BNSF/UP rows after matching")
    return docs, cm, rows[:2]


LOCKS = [("lock27", r"\b27\b", "Mississippi River Lock 27 (near St. Louis)"),
         ("lagrange", r"la ?grange", "Illinois River, LaGrange Lock"),
         ("olmsted", r"olmsted|\b52\b|\b53\b", "Ohio River, Olmsted Locks"),
         ("ark1", r"arkansas|\bark", "Arkansas River Lock 1")]


def shape_locks(cli, today):
    ds = SRC["lock_tons"]["ds"]
    cols = columns(cli.meta(ds))
    cm = {"date": date_col(cols), "lock": pick(cols, r"lock|location|river")}
    cm["total"] = pick(cols, r"^total|total.?ton|grand", types=("number", "double"))
    cm["comm"] = pick(cols, r"commodity|grain|crop", types=("text",))
    crop_cols = [c["field"] for c in cols if c["type"] in ("number", "double")
                 and re.search(r"corn|soy|wheat|other", c["field"] + c["name"], re.I)]
    cm["value"] = None if (cm["total"] or crop_cols) else pick(cols, r"ton|value|amount", types=("number", "double"))
    need(cm, "date", "lock")
    if not (cm["total"] or crop_cols or (cm["comm"] and cm["value"])):
        raise SchemaError("no tonnage column")
    rows = cli.rows(ds, {"$where": f"{cm['date']} >= '{cutoff(today, YEARS_PULLED)}'", "$limit": 50000})
    by = defaultdict(lambda: defaultdict(float))
    for r in rows:
        d = d10(r.get(cm["date"]))
        name = str(r.get(cm["lock"], ""))
        if not d:
            continue
        if cm["total"]:
            v = fnum(r.get(cm["total"]))
        elif crop_cols:
            xs = [fnum(r.get(c)) for c in crop_cols]
            v = sum(x for x in xs if x is not None) if any(x is not None for x in xs) else None
        else:
            v = fnum(r.get(cm["value"]))
        if v is None:
            continue
        for key, rx, _ in LOCKS:
            if re.search(rx, name, re.I):
                by[key][d] += v
                break
    docs = {}
    for key, _, label in LOCKS:
        pts = sorted((d, v / 1000.0) for d, v in by[key].items())
        if pts:
            docs[f"locks-{key}"] = series_doc(f"locks-{key}", f"Grain barge tons, {label}", "thousand tons a week",
                                              "lock_tons", pts, today, digits=1, dearer_when=None,
                                              note="Downbound corn, soybeans and wheat through the lock. Grain loaded "
                                                   "below Lock 27 never passes it.")
    if "locks-lock27" not in docs:
        raise SchemaError("Lock 27 not found in lock names")
    return docs, cm, rows[:2]


def shape_car_orders(cli, today):
    ds = SRC["car_orders"]["ds"]
    cols = columns(cli.meta(ds))
    cm = {"date": date_col(cols), "rr": pick(cols, r"railroad|carrier|company")}
    due = [c["field"] for c in cols if c["type"] in ("number", "double")
           and re.search(r"past.?due|overdue|late|unfilled|\bdays?\b", c["field"] + " " + c["name"], re.I)]
    cm["past_due"] = ",".join(due) or None
    cm["metric"] = None
    if not due:
        cm["metric"] = pick(cols, r"metric|category|measure|days|type", types=("text",))
        cm["value"] = pick(cols, r"value|cars|count|number|orders", types=("number", "double"))
    need(cm, "date", "rr")
    if not (due or (cm["metric"] and cm.get("value"))):
        raise SchemaError("no past-due column")
    rows = cli.rows(ds, {"$where": f"{cm['date']} >= '{cutoff(today, YEARS_PULLED)}'", "$limit": 50000})
    by = defaultdict(lambda: defaultdict(float))
    for r in rows:
        d, rr = d10(r.get(cm["date"])), railroad_of(r.get(cm["rr"]))
        if not d or not rr:
            continue
        if due:
            xs = [fnum(r.get(c)) for c in due]
            if not any(x is not None for x in xs):
                continue
            v = sum(x for x in xs if x is not None)
        else:
            if not re.search(r"past|due|late|overdue", str(r.get(cm["metric"], "")), re.I):
                continue
            v = fnum(r.get(cm["value"]))
            if v is None:
                continue
        by[rr][d] += v
        by["ALL"][d] += v
    docs = {}
    for rr in ("ALL", "BNSF", "UP"):
        pts = sorted(by[rr].items())
        if pts:
            sid = f"carorders-{rr.lower()}"
            lab = "all reporting Class I railroads" if rr == "ALL" else rr
            docs[sid] = series_doc(sid, f"Grain car orders past due, {lab}", "cars", "car_orders", pts, today,
                                   digits=0, note="Manifest (single car) grain orders not filled by the date the "
                                                  "railroad's tariff promises, as filed weekly with the STB.")
    if not docs:
        raise SchemaError("no railroad rows after matching")
    return docs, cm, rows[:2]


def shape_train_speed(cli, today):
    ds = SRC["train_speed"]["ds"]
    cols = columns(cli.meta(ds))
    cm = {"date": date_col(cols), "rr": pick(cols, r"railroad|carrier|company"),
          "type": pick(cols, r"train.?type|type|category|service", types=("text",)),
          "value": pick(cols, r"speed|mph|value", types=("number", "double"))}
    need(cm, "date", "rr", "type", "value")
    rows = cli.rows(ds, {"$where": f"{cm['date']} >= '{cutoff(today, YEARS_PULLED)}'", "$limit": 50000})
    by = defaultdict(list)
    for r in rows:
        d, rr, v = d10(r.get(cm["date"])), railroad_of(r.get(cm["rr"])), fnum(r.get(cm["value"]))
        if d and rr in ("BNSF", "UP") and v is not None and 0 < v < 80 and re.search(r"grain", str(r.get(cm["type"], "")), re.I):
            by[rr].append((d, v))
    docs = {}
    for rr, pts in by.items():
        docs[f"speed-{rr.lower()}"] = series_doc(f"speed-{rr.lower()}", f"{rr} grain unit train speed", "mph",
                                                 "train_speed", weekly_mean(pts), today, digits=1, dearer_when="down")
    if not docs:
        raise SchemaError("no grain train rows for BNSF/UP")
    return docs, cm, rows[:2]


def shape_carloads(cli, today):
    ds = SRC["carloads"]["ds"]
    cols = columns(cli.meta(ds))
    cm = {"date": date_col(cols), "comm": pick(cols, r"commodity|category|type", types=("text",)),
          "value": pick(cols, r"carload|cars|value|count", types=("number", "double")),
          "rr": pick(cols, r"railroad|carrier|company"), "ctry": pick(cols, r"country|region|nation", types=("text",))}
    need(cm, "date", "comm", "value")
    rows = cli.rows(ds, {"$where": f"{cm['date']} >= '{cutoff(today, YEARS_PULLED)}'", "$limit": 50000})
    by = defaultdict(float)
    for r in rows:
        d, v = d10(r.get(cm["date"])), fnum(r.get(cm["value"]))
        c = str(r.get(cm["comm"], "")).strip().lower()
        if not d or v is None or "grain" not in c or re.search(r"mill|product|meal|oil", c):
            continue
        if cm["ctry"] and re.search(r"canad|mexic", str(r.get(cm["ctry"], "")), re.I):
            continue
        if cm["rr"] and re.search(r"total|all", str(r.get(cm["rr"], "")), re.I):
            continue  # a total row on top of the railroads would double count
        by[d] += v
    pts = sorted(by.items())
    if not pts:
        raise SchemaError("no grain carload rows")
    return {"carloads-grain": series_doc("carloads-grain", "U.S. grain carloads, Class I railroads", "cars a week",
                                         "carloads", pts, today, digits=0, dearer_when=None)}, cm, rows[:2]


def shape_inspections(cli, today):
    ds = SRC["inspections"]["ds"]
    cols = columns(cli.meta(ds))
    cm = {"date": date_col(cols), "region": pick(cols, r"port.?region|region|port", types=("text",)),
          "value": pick(cols, r"metric.?ton|\bmt\b|tons|quantity", types=("number", "double"))}
    need(cm, "date", "region", "value")
    rows = cli.rows(ds, {"$select": f"{cm['date']} as wk, {cm['region']} as region, sum({cm['value']}) as t",
                         "$where": f"{cm['date']} >= '{cutoff(today, YEARS_PULLED)}'",
                         "$group": f"{cm['date']}, {cm['region']}", "$limit": 50000})
    by = {"gulf": defaultdict(float), "pnw": defaultdict(float), "all": defaultdict(float)}
    for r in rows:
        d, v = d10(r.get("wk")), fnum(r.get("t"))
        reg = str(r.get("region", "")).lower()
        if not d or v is None:
            continue
        by["all"][d] += v
        if "gulf" in reg or "mississippi" in reg:
            by["gulf"][d] += v
        elif "pacific" in reg or "pnw" in reg or "columbia" in reg or "northwest" in reg:
            by["pnw"][d] += v
    docs = {}
    for k, lab in (("gulf", "Gulf ports"), ("pnw", "Pacific Northwest ports"), ("all", "all ports")):
        pts = sorted((d, v / 1000.0) for d, v in by[k].items())
        if pts:
            docs[f"inspections-{k}"] = series_doc(f"inspections-{k}", f"Grain inspected for export, {lab}",
                                                  "thousand metric tons a week", "inspections", pts, today, digits=0,
                                                  dearer_when=None, note="Corn, soybeans, wheat and other grains "
                                                                         "inspected for export, by port region.")
    if "inspections-gulf" not in docs:
        raise SchemaError("no Gulf region in inspections")
    return docs, {**cm, "query": "summed by week and port region"}, rows[:2]


def shape_ocean(cli, today):
    ds = SRC["ocean"]["ds"]
    cols = columns(cli.meta(ds))
    cm = {"date": date_col(cols),
          "gulf": pick(cols, r"gulf", types=("number", "double", "money")),
          "pnw": pick(cols, r"pnw|pacific|northwest", types=("number", "double", "money")),
          "spread": pick(cols, r"spread|difference", types=("number", "double", "money"))}
    need(cm, "date", "gulf", "pnw")
    rows = cli.rows(ds, {"$where": f"{cm['date']} >= '{cutoff(today, YEARS_PULLED)}'", "$limit": 50000})
    g, p, s = [], [], []
    for r in rows:
        d = d10(r.get(cm["date"]))
        gv, pv = fnum(r.get(cm["gulf"])), fnum(r.get(cm["pnw"]))
        if not d or gv is None or pv is None:
            continue
        g.append((d, gv))
        p.append((d, pv))
        s.append((d, gv - pv))   # computed, so the sign is ours to state: Gulf minus PNW
    if not s:
        raise SchemaError("no ocean rows")
    docs = {"ocean-gulf": series_doc("ocean-gulf", "Ocean freight, U.S. Gulf to Japan", "$ per metric ton", "ocean",
                                     weekly_mean(g), today, digits=2),
            "ocean-pnw": series_doc("ocean-pnw", "Ocean freight, Pacific Northwest to Japan", "$ per metric ton", "ocean",
                                    weekly_mean(p), today, digits=2),
            "ocean-spread": series_doc("ocean-spread", "Gulf minus PNW ocean freight to Japan", "$ per metric ton",
                                       "ocean", weekly_mean(s), today, digits=2, dearer_when=None,
                                       note="Positive: shipping to Asia costs more from the Gulf than from the PNW. "
                                            "A wide spread pulls export grain west, toward rail-served country.")}
    return docs, cm, rows[:2]


def shape_vessels(cli, today):
    ds = SRC["vessels"]["ds"]
    cols = columns(cli.meta(ds))
    cm = {"date": date_col(cols), "region": pick(cols, r"region|port", types=("text",)),
          "loaded": pick(cols, r"load", types=("number", "double"), not_pattern=r"due|expect|next"),
          "due": pick(cols, r"due|expect|next|10", types=("number", "double"))}
    need(cm, "date", "region", "loaded")
    rows = cli.rows(ds, {"$where": f"{cm['date']} >= '{cutoff(today, YEARS_PULLED)}'", "$limit": 50000})
    by = defaultdict(list)
    for r in rows:
        d = d10(r.get(cm["date"]))
        reg = str(r.get(cm["region"], "")).lower()
        k = "gulf" if "gulf" in reg else ("pnw" if re.search(r"pacific|pnw|northwest", reg) else None)
        if not d or not k:
            continue
        for what in ("loaded", "due"):
            if cm.get(what):
                v = fnum(r.get(cm[what]))
                if v is not None:
                    by[(k, what)].append((d, v))
    docs = {}
    for (k, what), pts in by.items():
        lab = {"gulf": "Gulf", "pnw": "PNW"}[k]
        title = f"{lab} grain vessels loaded, past 7 days" if what == "loaded" else f"{lab} grain vessels due in the next 10 days"
        docs[f"vessels-{k}-{what}"] = series_doc(f"vessels-{k}-{what}", title, "vessels", "vessels",
                                                 weekly_mean(pts), today, digits=0, dearer_when=None)
    if not docs:
        raise SchemaError("no Gulf/PNW vessel rows")
    return docs, cm, rows[:2]


def shape_cost(cli, today):
    ds = SRC["cost_index"]["ds"]
    cols = columns(cli.meta(ds))
    cm = {"date": date_col(cols)}
    for k in ("truck", "shuttle_train", "barge", "gulf_vessel", "pacific_vessel"):
        cm[k] = pick(cols, "^" + k + "$") or pick(cols, k.replace("_", "."), types=("number", "double", "text"))
    need(cm, "date", "barge")
    rows = cli.rows(ds, {"$where": f"{cm['date']} >= '{cutoff(today, YEARS_PULLED)}'", "$limit": 50000})
    docs = {}
    labels = {"truck": "Truck", "shuttle_train": "Shuttle train", "barge": "Barge", "gulf_vessel": "Ocean vessel, Gulf",
              "pacific_vessel": "Ocean vessel, PNW"}
    for k, lab in labels.items():
        if not cm.get(k):
            continue
        pts = [(d10(r.get(cm["date"])), fnum(r.get(cm[k]))) for r in rows]
        sid = "cost-" + k.replace("_", "-")
        docs[sid] = series_doc(sid, f"Cost indicator: {lab}", "index", "cost_index", pts, today, digits=1,
                               note="USDA's weekly index for the cost of moving grain by this mode.")
    return docs, cm, rows[:2]


def shape_river(cli, today):
    docs = {}
    start = cutoff(today, YEARS_KEPT)
    for key, (site, label) in RIVER_SITES.items():
        pts = cli.usgs(site, start, today.isoformat())
        docs[f"river-{key}"] = series_doc(f"river-{key}", f"River stage, {label}", "feet on the gage", "river", pts,
                                          today, digits=1, normal=False, dearer_when=None,
                                          extra={"site": site, "site_url": f"https://waterdata.usgs.gov/monitoring-location/{site}/"},
                                          note="Daily mean gage height. Low water means lighter barge loads and slower tows.")
    return docs, {"parameter": "00065", "stat": "00003"}, []


# ------------------------------------------------------ the connection -----
def pearson(xs, ys):
    n = len(xs)
    if n < 3:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in ys)
    if sxx <= 0 or syy <= 0:
        return None
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / math.sqrt(sxx * syy)


def lag1(xs):
    if len(xs) < 4:
        return 0.0
    r = pearson(xs[:-1], xs[1:])
    return r if r is not None else 0.0


def eff_n(xs, ys):
    """Weeks that count as separate after autocorrelation (Bartlett): a weekly
    series that moves slowly carries far fewer independent readings than weeks."""
    a, b = lag1(xs), lag1(ys)
    ab = max(min(a * b, 0.99), -0.99)
    return max(2.0, len(xs) * (1 - ab) / (1 + ab))


def p_value(r, n_eff):
    if r is None or n_eff <= 3:
        return None
    rr = max(min(r, 0.999999), -0.999999)
    z = math.atanh(rr) * math.sqrt(n_eff - 3)
    return math.erfc(abs(z) / math.sqrt(2))


def bh(pvals):
    """Benjamini-Hochberg adjusted q-values, same order. None stays None."""
    idx = [i for i, p in enumerate(pvals) if p is not None]
    m = len(idx)
    q = [None] * len(pvals)
    if not m:
        return q
    order = sorted(idx, key=lambda i: pvals[i])
    prev = 1.0
    for rank in range(m, 0, -1):
        i = order[rank - 1]
        prev = min(prev, pvals[i] * m / rank)
        q[i] = min(prev, 1.0)
    return q


def deviations(pts, years=5):
    """[(date, v)] weekly -> [(date, v - same-week normal)] where the normal
    has at least MIN_NORMAL_N prior years. Only earlier years are used, so a
    week is never compared with a normal that contains itself or the future."""
    byw = {iso_year_week(d): {"v": v} for d, v in pts}
    out = []
    for d, v in pts:
        y, w = iso_year_week(d)
        avg, n = same_week_avg_n(byw, w, y, "v")
        if avg is not None and n >= MIN_NORMAL_N:
            out.append((d, v - avg))
    return out


def group_weekly(per_state):
    """{state: [(date, v)]} -> [(date, median across states, n states)] by ISO
    week, kept where at least 2 states posted."""
    by = defaultdict(list)
    dt = {}
    for pts in per_state.values():
        for d, v in pts:
            k = iso_year_week(d)
            by[k].append(v)
            dt[k] = max(dt.get(k, ""), d)
    return sorted((dt[k], statistics.median(vs), len(vs)) for k, vs in by.items() if len(vs) >= 2)


def pair(a, b):
    """Join two [(date, v, ...)] on ISO week -> (dates, xs, ys)."""
    bm = {iso_year_week(x[0]): x[1] for x in b}
    ds, xs, ys = [], [], []
    for x in a:
        k = iso_year_week(x[0])
        if k in bm:
            ds.append(x[0])
            xs.append(x[1])
            ys.append(bm[k])
    return ds, xs, ys


def verdict(t):
    if t["n_eff"] < MIN_EFF_N or t["r"] is None:
        return "Not enough history to say."
    if t["q"] is not None and t["q"] < Q_GATE and abs(t["r"]) >= 0.3:
        side = "below" if t["r"] < 0 else "above"
        return f"Moved together: when freight ran above normal, basis here tended to run {side} normal."
    return "No clear connection in this record."


def connection(basis_rows, freight, ours, today):
    """basis_rows: USDA grain_basis rows. freight: {key: [(date, v)] weekly}.
    -> doc with group series (vs normal), the tests and the verdicts."""
    keep_from = cutoff(today, YEARS_KEPT)
    st_pts = defaultdict(list)
    for r in basis_rows:
        if str(r.get("market_type", "")).strip() != "Elevator Bid":
            continue
        v, d = fnum(r.get("basis")), d10(r.get("date"))
        if v is None or not d or abs(v) > 5:
            continue
        st_pts[(str(r.get("commodity", "")).strip(), str(r.get("market_name", "")).strip())].append((d, v))
    groups = {}
    for crop in ("Corn", "Soybeans"):
        for g, states in (("river", RIVER_STATES), ("rail", RAIL_STATES)):
            per = {s: deviations(weekly_mean(st_pts.get((crop, s), []))) for s in states}
            groups[(crop, g)] = group_weekly(per)
    fdev = {k: deviations(v) for k, v in freight.items() if v}
    tests = []
    for (crop, g), gpts in groups.items():
        for fk in ("barge-st-louis", "railcar-bnsf-shuttle", "railcar-up-shuttle"):
            if fk not in fdev:
                continue
            ds_, xs_, ys_ = pair(fdev[fk], gpts)   # every week both lines have a normal for
            r = pearson(xs_, ys_)
            ne = eff_n(xs_, ys_) if len(xs_) >= 4 else float(len(xs_))
            tests.append({"crop": crop, "group": g, "freight": fk, "n": len(xs_), "n_eff": round(ne, 1),
                          "r": round(r, 2) if r is not None else None,
                          "p": p_value(r, ne), "from": ds_[0] if ds_ else None, "to": ds_[-1] if ds_ else None})
    qs = bh([t["p"] for t in tests])
    for t, q in zip(tests, qs):
        t["q"] = round(q, 4) if q is not None else None
        t["p"] = round(t["p"], 4) if t["p"] is not None else None
        t["verdict"] = verdict(t)
    series = {f"{crop.lower()}-{g}": [[d, round(v, 3), n] for d, v, n in pts if d >= keep_from]
              for (crop, g), pts in groups.items()}
    fser = {k: [[d, round(v, 1)] for d, v in pts if d >= keep_from] for k, pts in fdev.items()}
    doc = {"generated": today.isoformat(),
           "method": ("Each week, each region's USDA elevator basis minus its own average for that week over the five "
                      "years before (at least 3 years needed); the group line is the middle of its regions. Freight is "
                      "treated the same way. r is the Pearson correlation of the two weekly lines; independent weeks "
                      "correct the week count for slow-moving series (Bartlett); q is the chance-adjusted p-value "
                      "across every pair tested here (Benjamini-Hochberg). A pair needs " + str(MIN_EFF_N) +
                      " independent weeks before any r is printed. Correlation only: two lines moving together does "
                      "not show that one moved the other."),
           "groups": {"river": RIVER_STATES, "rail": RAIL_STATES, "left_out": ["Iowa", "Minnesota"]},
           "tested": len(tests), "tests": tests, "basis_vs_normal": series, "freight_vs_normal": fser,
           "source": {"name": SRC["grain_basis"]["name"], "url": SRC["grain_basis"]["url"]}}
    if ours:
        doc["ours"] = ours_connection(ours, freight)
    return doc


def ours_connection(ours, freight):
    """Our own weekly state basis (since June 2026) beside freight levels.
    Never vs normal: there is no normal yet. Tested through the same gate,
    which it will fail until enough weeks build up; the page says so."""
    out = {"tests": []}
    for g, states in (("river", RIVER_STATES), ("rail", RAIL_STATES)):
        for crop in ("corn", "soybeans"):
            per = {}
            for s in states:
                c = ST_CODE[s]
                pts = [(p[0], p[1]) for p in ours.get("states", {}).get(c, {}).get(crop, []) if p[1] is not None]
                if pts:
                    per[s] = pts
            gp = group_weekly(per)
            fk = "barge-st-louis" if g == "river" else "railcar-bnsf-shuttle"
            ds, xs, ys = pair([(d, v) for d, v in freight.get(fk, [])], gp)
            r = pearson(xs, ys)
            ne = eff_n(xs, ys) if len(xs) >= 4 else float(len(xs))
            t = {"crop": crop, "group": g, "freight": fk, "n": len(xs), "n_eff": round(ne, 1),
                 "r": round(r, 2) if r is not None else None, "q": None}
            t["verdict"] = verdict(t) if t["n_eff"] < MIN_EFF_N else "Not tested yet: see the long record above."
            out["tests"].append(t)
            out[f"{crop}-{g}"] = [[d, round(v, 3), n] for d, v, n in gp]
    return out


# ------------------------------------------------- our own weekly basis ----
def norm_symbol(sym):
    m = re.match(r"^([A-Z]{2,3}?)([FGHJKMNQUVXZ])(\d{1,2})$", str(sym or "").upper().strip())
    if not m:
        return str(sym or "").upper().strip()
    yy = m.group(3) if len(m.group(3)) == 2 else "2" + m.group(3)
    return m.group(1) + m.group(2) + yy


CATS = ["corn", "soybeans", "wheat", "other"]
OUR_STATES = ["IA", "IL", "IN", "OH", "MN", "NE", "KS", "SD", "ND", "WI", "MO"]
OUR_MIN_N = 5


def our_weekly(repo=REPO, states=OUR_STATES):
    """The AGSIST network's weekly state basis, replayed from the shards and
    the change logs. For each week ending Friday: every row first seen by
    that Friday and seen at least once in its seven days, valued at its basis
    on the last day of the week it was seen; per elevator and crop the median
    of its rows on one futures contract (the one most of the state's
    elevators name, kept while at least half as many still name it); the
    state value is the median across elevators with the outlier guard of
    basis_method.py, kept at n >= 5. The contract travels with each point: a
    line that changes contract is a new line, not a move."""
    base = os.path.join(repo, "data/basis")
    changes = defaultdict(list)
    files = sorted(glob.glob(os.path.join(base, "changes-*.json")))
    for p in files:
        doc = json.load(open(p))
        dd = doc.get("date") or os.path.basename(p)[8:18]
        for row in doc.get("changes", []):
            st, fac, city, comm, sym, month, old, new = row[:8]
            if st in states:
                changes[(st, fac, city, comm, norm_symbol(sym), month)].append((dd, old, new))
    out = {"states": {}, "first": None, "last": None}
    if not files:
        return out
    last_day = None
    for st in states:
        p = os.path.join(base, f"{st}.json")
        if not os.path.exists(p):
            continue
        sh = json.load(open(p))
        fac, dates = sh.get("f", []), sh.get("d", [])
        last_day = max(last_day or "", sh.get("generated", ""))
        g = lambda i: dates[i] if i is not None and i < len(dates) else None  # noqa: E731
        rows = []
        for r in sh.get("r", []):
            fi, ci, sym, month, cur, prev, since_i, first_i, last_i = r
            if CATS[ci] not in ("corn", "soybeans"):
                continue
            facility, city = (fac[fi].split("|", 1) + [""])[:2]
            key = (st, facility, city, CATS[ci], norm_symbol(sym), month)
            ch = sorted(changes.get(key, []))
            rows.append({"elev": fac[fi], "crop": CATS[ci], "sym": norm_symbol(sym), "cur": cur,
                         "first": g(first_i), "last": g(last_i), "ch": ch})
        out["states"][st] = rows
    # Fridays from the first change log to the last shard day
    first = os.path.basename(files[0])[8:18]
    d0 = date.fromisoformat(first)
    d0 += timedelta(days=(4 - d0.weekday()) % 7)
    end = date.fromisoformat(last_day[:10]) if last_day else date.fromisoformat(os.path.basename(files[-1])[8:18])
    fridays = []
    d = d0
    while d <= end:
        fridays.append(d.isoformat())
        d += timedelta(days=7)
    # whole weeks only: the week in progress has seen only some boards (2026-10-20, a Tuesday: Missouri
    # corn read -$0.15 on 19 elevators against -$0.40 on 68 the Friday before)
    res = {"states": {}, "weeks": fridays, "through": fridays[-1] if fridays else None,
           "method": our_weekly.__doc__.split("\n\n")[0].strip().replace("\n    ", " "),
           "units": "$/bu, cash minus futures", "since": first}
    for st, rows in out["states"].items():
        res["states"][st] = {}
        for crop in ("corn", "soybeans"):
            line = []
            held = None
            for t in fridays:
                wk0 = (date.fromisoformat(t) - timedelta(days=6)).isoformat()
                vals = defaultdict(list)  # (elev, sym) -> cents
                for r in rows:
                    # seen at some point in the week ending t: first seen by t, last seen on or after its first day
                    if r["crop"] != crop or not r["first"] or r["first"] > t or (r["last"] or "") < wk0:
                        continue
                    v = value_at(r, min(t, r["last"]))
                    if v is None or abs(v) > 250:
                        continue
                    vals[(r["elev"], r["sym"])].append(v)
                if not vals:
                    line.append([t, None, 0, None])
                    continue
                by_sym = defaultdict(set)
                for (e, s) in vals:
                    by_sym[s].add(e)
                top = sorted(by_sym.items(), key=lambda kv: (-len(kv[1]), kv[0]))[0][0]
                # keep last week's contract while at least half as many elevators still name it: the
                # line follows one contract until it fades (an expiry), instead of flipping each week
                sym = held if held in by_sym and len(by_sym[held]) >= 0.5 * len(by_sym[top]) else top
                held = sym
                per = [{"basis": statistics.median(v) / 100.0} for (e, s), v in vals.items() if s == sym]
                kept, _ = robust_split(per)
                if len(kept) < OUR_MIN_N:
                    line.append([t, None, len(kept), sym])
                    continue
                line.append([t, round(statistics.median(r["basis"] for r in kept), 3), len(kept), sym])
            res["states"][st][crop] = line
    # the group lines the page draws: the middle of the group's states each week (2 states at least)
    res["groups"] = {}
    for g, names in (("river", RIVER_STATES), ("rail", RAIL_STATES)):
        for crop in ("corn", "soybeans"):
            per = {n: [(p[0], p[1]) for p in res["states"].get(ST_CODE[n], {}).get(crop, []) if p[1] is not None]
                   for n in names}
            res["groups"][f"{crop}-{g}"] = [[d, round(v, 3), n] for d, v, n in group_weekly(per)]
    return res


def value_at(r, t):
    """A row's basis (cents) on day t from its change log."""
    ch = r["ch"]
    if not ch:
        return r["cur"]
    v = ch[0][1]
    for dd, old, new in ch:
        if dd <= t:
            v = new
        else:
            break
    return v


# ------------------------------------------------------------ the page -----
TILES = [  # (series id, short label, what "up" means for the farmer)
    ("barge-st-louis", "Barge freight, St. Louis to the Gulf"),
    ("railcar-bnsf-shuttle", "BNSF shuttle car, secondary market"),
    ("railcar-up-shuttle", "UP shuttle car, secondary market"),
    ("locks-lock27", "Grain through Lock 27"),
    ("carorders-all", "Grain car orders past due"),
    ("ocean-spread", "Gulf minus PNW ocean freight"),
]


def fmt_val(doc):
    v, u = doc["latest"]["value"], doc["unit"]
    if u.startswith("% of"):
        return f"{v:,.0f}%"
    if u.startswith("$ per car"):
        return ("-" if v < 0 else "") + f"${abs(v):,.0f}"
    if u.startswith("$ per metric"):
        return ("-" if v < 0 else "") + f"${abs(v):,.2f}"
    if u.startswith("thousand"):
        return f"{v:,.0f}"
    return f"{v:,.0f}"


def fmt_day(d):
    dt = date.fromisoformat(d)
    return dt.strftime("%b ") + str(dt.day) + dt.strftime(", %Y")


def tile_html(sid, label, doc, status):
    esc = html.escape
    if not doc or not doc.get("latest"):
        why = status.get("error") if status else "not read yet"
        return (f'<div class="gt-tile gt-miss" data-s="{sid}"><p class="gt-tl">{esc(label)}</p>'
                f'<p class="gt-tv">&mdash;</p><p class="gt-tm">Not available: {esc(str(why)[:90])}</p></div>')
    chg = doc.get("chg")
    unit = doc["unit"]
    c = ""
    if chg is not None:
        if unit.startswith("% of"):
            c = f"{chg:+,.0f} pts in a week"
        elif unit.startswith("$"):
            c = f"{'+' if chg >= 0 else '-'}${abs(chg):,.{2 if 'metric' in unit else 0}f} in a week"
        else:
            c = f"{chg:+,.0f} in a week"
    nm = doc.get("normal") or {}
    n = ""
    if nm.get("value") is not None:
        n = f"; 5-yr normal for this week {fmt_val({'latest': {'value': nm['value']}, 'unit': unit})} ({nm['years']} yrs)"
    stale = ' <b class="gt-old">old</b>' if status and status.get("status") != "ok" else ""
    return (f'<div class="gt-tile" data-s="{sid}"><p class="gt-tl">{esc(label)}</p>'
            f'<p class="gt-tv">{esc(fmt_val(doc))} <span class="gt-tu">{esc(unit)}</span></p>'
            f'<p class="gt-tc">{esc(c)}{esc(n)}</p>'
            f'<p class="gt-tm">Week of {esc(fmt_day(doc["latest"]["date"]))}{stale}. '
            f'<a href="{esc(doc["source"]["url"])}">{esc(doc["source"]["agency"])}</a></p></div>')


NOT_BUILT = ("The long record has not been built yet: it needs the USDA regional basis and the barge and "
             "railcar series, read each Friday.")


def basis_line(conn):
    """One plain sentence on what freight has meant for basis, from the corn
    tests on the first two pairs (river vs barge, rail vs BNSF shuttle). Only a
    pair that passed the gate is stated as a finding; the rest say so."""
    if not conn or conn.get("status") not in ("ok", "stale"):
        return NOT_BUILT
    out = []
    for g, fk, what, where in (("river", "barge-st-louis", "barge freight", "river states"),
                               ("rail", "railcar-bnsf-shuttle", "BNSF shuttle bids", "rail states")):
        t = next((x for x in conn.get("tests", []) if x["crop"] == "Corn" and x["group"] == g and x["freight"] == fk), None)
        if not t:
            continue
        if t["verdict"].startswith("Moved together"):
            side = "under" if t["r"] < 0 else "over"
            out.append(f"in the {where}, corn basis has run {side} normal in weeks when {what} ran above normal "
                       f"(r = {t['r']:.2f}, {round(t['n_eff'])} separate weeks since {t['from'][:4]})")
        elif t["verdict"].startswith("No clear"):
            out.append(f"in the {where}, the record since {t['from'][:4]} shows no clear link between {what} and corn basis")
        else:
            out.append(f"in the {where}, there is not enough history yet to say how {what} and basis line up")
    if not out:
        return NOT_BUILT
    s = "; ".join(out) + ". Moving together is not proof one moved the other."
    return s[0].upper() + s[1:]


def answer(docs, conn=None):
    """The first-screen sentence, from the pipeline (rule 9)."""
    parts = []
    b = docs.get("barge-st-louis")
    if b and b.get("latest") and b.get("normal", {}).get("value") is not None:
        vs = b["normal"]["vs"]
        word = "dearer" if vs > 0 else "cheaper"
        parts.append(f"River freight is {word} than normal for this week: {b['latest']['value']:,.0f}% of tariff at "
                     f"St. Louis against a {b['normal']['value']:,.0f}% normal")
    r = docs.get("railcar-bnsf-shuttle")
    if r and r.get("latest"):
        v = r["latest"]["value"]
        if r.get("normal", {}).get("value") is not None:
            word = "dearer" if r["normal"]["vs"] > 0 else "cheaper"
            parts.append(f"rail is {word}: a BNSF shuttle trades at {'-' if v < 0 else ''}${abs(v):,.0f} a car over "
                         f"tariff against ${r['normal']['value']:,.0f} normal")
        else:
            parts.append(f"a BNSF shuttle trades at {'-' if v < 0 else ''}${abs(v):,.0f} a car over tariff")
    if not parts:
        return "This week's freight numbers have not been read yet. The last good week shows below where we have it."
    s = "; ".join(parts) + "."
    return s[0].upper() + s[1:]


def bake(page_path, docs, status, conn=None):
    if not os.path.exists(page_path):
        return False
    src = open(page_path, encoding="utf-8").read()
    tiles = "".join(tile_html(sid, lab, docs.get(sid), status.get(src_of(sid)))
                    for sid, lab in TILES)
    new = re.sub(r"<!--SEED:gtnow-->.*?<!--/SEED:gtnow-->", lambda m: f"<!--SEED:gtnow-->{tiles}<!--/SEED:gtnow-->",
                 src, flags=re.S)
    new = re.sub(r"<!--SEED:gtans-->.*?<!--/SEED:gtans-->",
                 lambda m: f"<!--SEED:gtans-->{html.escape(answer(docs))}<!--/SEED:gtans-->", new, flags=re.S)
    new = re.sub(r"<!--SEED:gtbasis-->.*?<!--/SEED:gtbasis-->",
                 lambda m: f"<!--SEED:gtbasis-->{html.escape(basis_line(conn))}<!--/SEED:gtbasis-->", new, flags=re.S)
    if new != src:
        open(page_path, "w", encoding="utf-8").write(new)
    return True


def src_of(sid):
    return {"barge": "barge_rates", "railcar": "railcar", "locks": "lock_tons", "carorders": "car_orders",
            "speed": "train_speed", "carloads": "carloads", "inspections": "inspections", "ocean": "ocean",
            "vessels": "vessels", "cost": "cost_index", "river": "river"}[sid.split("-")[0]]


# ------------------------------------------------------------- the run -----
SHAPERS = [("barge_rates", shape_barge), ("railcar", shape_railcar), ("lock_tons", shape_locks),
           ("car_orders", shape_car_orders), ("train_speed", shape_train_speed), ("carloads", shape_carloads),
           ("inspections", shape_inspections), ("ocean", shape_ocean), ("vessels", shape_vessels),
           ("cost_index", shape_cost), ("river", shape_river)]


def build(cli, today, out_dir, repo=REPO, page=None):
    os.makedirs(out_dir, exist_ok=True)
    _full_points.clear()
    prior = {}
    ip = os.path.join(out_dir, "index.json")
    if os.path.exists(ip):
        try:
            prior = json.load(open(ip)).get("sources", {})
        except (ValueError, OSError):
            prior = {}
    status, docs = {}, {}
    for key, fn in SHAPERS:
        s = {"name": SRC[key]["name"], "url": SRC[key]["url"], "dataset": SRC[key]["ds"], "checked": today.isoformat()}
        try:
            got, cm, sample = fn(cli, today)
            for sid, doc in got.items():
                if not doc.get("latest"):
                    continue
                docs[sid] = doc
            s.update(status="ok", series=sorted(got), columns_used=cm, sample=sample[:2],
                     newest=max((d["latest"]["date"] for d in got.values() if d.get("latest")), default=None),
                     last_good=today.isoformat())
            print(f"  {key}: ok, {len(got)} series, newest {s['newest']}")
        except Exception as e:  # noqa: BLE001 -- one source down never takes the others with it
            p = prior.get(key, {})
            s.update(status="failed", error=f"{type(e).__name__}: {e}"[:300],
                     last_good=p.get("last_good"), series=p.get("series", []), newest=p.get("newest"))
            try:
                if isinstance(e, SchemaError) and SRC[key]["ds"]:
                    s["columns_found"] = [c["field"] for c in columns(cli.meta(SRC[key]["ds"]))][:40]
            except Exception:  # noqa: BLE001
                pass
            print(f"::warning::grain moves: {key} failed: {s['error']}")
            for sid in s["series"]:  # the last good file stays; the page reads it with this status
                op = os.path.join(out_dir, f"{sid}.json")
                if os.path.exists(op):
                    docs[sid] = json.load(open(op))
        status[key] = s
    for sid, doc in docs.items():
        doc["status"] = status[src_of(sid)]["status"]
        json.dump(doc, open(os.path.join(out_dir, f"{sid}.json"), "w"), separators=(",", ":"))
    # our own weekly basis + the connection
    ours = our_weekly(repo)
    json.dump(ours, open(os.path.join(out_dir, "our-basis.json"), "w"), separators=(",", ":"))
    try:
        basis_rows = cli.rows(SRC["grain_basis"]["ds"], {"$where": f"date >= '{cutoff(today, YEARS_PULLED)}'",
                                                         "$limit": 50000,
                                                         "$select": "date,market_name,market_type,commodity,basis"})
        # the full pulled history (the normal needs the years before the chart window); a series
        # carried over from a failed source has only its file's points, and says so in its status
        freight = {k: _full_points.get(k) or [(p[0], p[1]) for p in docs[k]["points"]] for k in
                   ("barge-st-louis", "railcar-bnsf-shuttle", "railcar-up-shuttle") if k in docs}
        conn = connection(basis_rows, freight, ours, today)
        conn["status"] = "ok"
    except Exception as e:  # noqa: BLE001
        conn = {"status": "failed", "error": f"{type(e).__name__}: {e}"[:300], "generated": today.isoformat()}
        cp = os.path.join(out_dir, "connection.json")
        if os.path.exists(cp):
            old = json.load(open(cp))
            if old.get("status") == "ok":
                old["status"] = "stale"
                old["error"] = conn["error"]
                conn = old
        print(f"::warning::grain moves: connection failed: {conn.get('error')}")
    json.dump(conn, open(os.path.join(out_dir, "connection.json"), "w"), separators=(",", ":"))
    tiles = [{"id": sid, "label": lab} for sid, lab in TILES]
    index = {"generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "today": today.isoformat(),
             "tiles": tiles, "answer": answer(docs), "basis_line": basis_line(conn), "sources": status,
             "series": sorted(docs), "benchmark_verified": BENCHMARK_VERIFIED,
             "note": "Each series file carries its own source, the week it describes and the day we read it."}
    json.dump(index, open(ip, "w"), separators=(",", ":"), indent=None)
    total = sum(os.path.getsize(p) for p in glob.glob(os.path.join(out_dir, "*.json")))
    if total > BUDGET_BYTES:
        raise SystemExit(f"FATAL: {out_dir} is {total} bytes, over the {BUDGET_BYTES} budget")
    if page:
        bake(page, docs, status, conn)
    print(f"wrote {len(docs)} series, our basis for {len(ours.get('states', {}))} states, "
          f"connection {conn.get('status')}, {total} bytes")
    return docs, status, conn, ours


# the full pulled history per series id (for normals and the connection), filled by series_doc
_full_points = {}


# -------------------------------------------------------------- selftest ---
def selftest():
    import tempfile
    # parsers on their own
    assert month_of("2026-11-01T00:00:00.000") == (2026, 11)
    assert month_of("Oct 2026") == (2026, 10) and month_of("October 2026") == (2026, 10)
    assert month_of("10/2026") == (2026, 10) and month_of("Nov-26") == (2026, 11)
    assert month_of("Jan", "2026-12-03") == (2027, 1) and month_of("Dec", "2026-12-03") == (2026, 12)
    assert month_of("next") is None
    assert railroad_of("BNSF Railway") == "BNSF" and railroad_of("Union Pacific") == "UP" and railroad_of("UP") == "UP"
    assert railroad_of("CPKC") == "CPKC" and railroad_of("Totals") is None
    assert shuttle_of("True") is True and shuttle_of("Non-Shuttle") is False and shuttle_of("Shuttle") is True
    assert shuttle_of("") is None
    leg = {"value": {"timeSeries": [{"variable": {"noDataValue": -999999.0}, "values": [{"value": [
        {"value": "5.21", "dateTime": "2026-10-01T00:00:00.000"}, {"value": "-999999", "dateTime": "2026-10-02T00:00:00.000"},
        {"value": "4.9", "dateTime": "2026-10-03T00:00:00.000"}]}]}]}}
    assert parse_usgs_legacy(leg) == [("2026-10-01", 5.21), ("2026-10-03", 4.9)]
    assert parse_usgs_ogc({"features": [{"properties": {"time": "2026-10-01", "value": "3.0"}}]}) == [("2026-10-01", 3.0)]
    cols = columns({"columns": [{"fieldName": ":id"}, {"fieldName": "report_date", "name": "Report Date", "dataTypeName": "calendar_date"},
                                {"fieldName": "bid_offer", "name": "Bid/Offer", "dataTypeName": "text"},
                                {"fieldName": "average_bid", "name": "Average", "dataTypeName": "number"}]})
    assert [c["field"] for c in cols] == ["report_date", "bid_offer", "average_bid"]
    assert date_col(cols) == "report_date" and pick(cols, r"bid", types=("number",)) == "average_bid"
    # weekly mean: three delivery months in one week become one point
    assert weekly_mean([("2026-10-08", 100), ("2026-10-08", 200), ("2026-10-15", 50)]) == [("2026-10-08", 150.0), ("2026-10-15", 50.0)]
    # series doc: change only across a real week; normal needs 3 prior years (hand-worked)
    today = date(2026, 10, 20)
    pts = []
    for y in range(2021, 2027):
        d = datetime.strptime(f"{y}-W41-4", "%G-W%V-%u").date().isoformat()
        pts.append((d, 400.0 + (y - 2021) * 10))
    pts.append(("2026-10-15", 470.0))
    pts.sort()
    sd = series_doc("x", "x", "% of 1976 tariff", "barge_rates", pts, today)
    # latest 2026-10-15 is ISO 2026-W42; W41 2026 (2026-10-08 = 450) is the previous week
    assert sd["latest"] == {"date": "2026-10-15", "value": 470.0} and sd["chg"] == 20.0, sd
    # the W42 normal reaches the neighbouring W41 in 2021-2025: 400..440 -> 420, 5 years
    assert sd["normal"] == {"value": 420.0, "years": 5, "vs": 50.0}, sd["normal"]
    gap = series_doc("x", "x", "u", "barge_rates", [("2026-09-01", 1.0), ("2026-10-15", 2.0)], today)
    assert "chg" not in gap and "normal" not in gap
    # correlation pieces (hand-worked)
    assert abs(pearson([1, 2, 3, 4], [2, 4, 6, 8]) - 1) < 1e-12 and abs(pearson([1, 2, 3, 4], [8, 6, 4, 2]) + 1) < 1e-12
    assert pearson([1, 1, 1], [1, 2, 3]) is None
    assert bh([0.01, 0.04, None, 0.03]) == [0.03, 0.04, None, 0.04]
    assert abs(p_value(0.0, 50) - 1.0) < 1e-12
    # a slow series counts far fewer separate weeks than weeks
    slow = [math.sin(i / 8) for i in range(100)]
    assert eff_n(slow, slow) < 10, eff_n(slow, slow)
    import random
    rnd = random.Random(7)
    noise = [rnd.random() for _ in range(100)]
    assert eff_n(noise, [rnd.random() for _ in range(100)]) > 80
    assert verdict({"n_eff": 12, "r": -0.9, "q": 0.001}) == "Not enough history to say."
    assert verdict({"n_eff": 60, "r": -0.5, "q": 0.001}).startswith("Moved together") and "below" in verdict({"n_eff": 60, "r": -0.5, "q": 0.001})
    assert verdict({"n_eff": 60, "r": -0.2, "q": 0.001}) == "No clear connection in this record."
    assert verdict({"n_eff": 60, "r": -0.6, "q": 0.2}) == "No clear connection in this record."
    # no look-ahead in the normal: a week's own value never enters it
    dv = deviations([(datetime.strptime(f"{y}-W10-5", "%G-W%V-%u").date().isoformat(), float(y)) for y in range(2018, 2025)])
    assert dv[0] == ("2021-03-12", 2021 - 2019.0), dv[0]   # 2021 vs mean(2018..2020)
    # our weekly basis from a tiny shard + change log (hand-worked)
    with tempfile.TemporaryDirectory() as tmp:
        b = os.path.join(tmp, "data/basis")
        os.makedirs(b)
        dates = ["2026-06-10", "2026-06-17", "2026-06-20"]
        f = [f"E{i}|TOWN" for i in range(6)]
        r = []
        for i in range(6):   # six elevators on ZCZ26; E0 changes -30 -> -40 on 06-17; E5 a wild outlier
            cur = -40 if i == 0 else (-300 + 0 if i == 5 else -30 - i)
            r.append([i, 0, "ZCZ6", "NOV26", cur if i != 5 else 120, None, 0, 0, 2])
        r.append([0, 0, "ZCU26", "SEP26", -10, None, 0, 0, 2])   # a second contract, fewer elevators
        json.dump({"state": "IA", "generated": "2026-06-20", "f": f, "d": dates, "r": r}, open(os.path.join(b, "IA.json"), "w"))
        json.dump({"date": "2026-06-10", "changes": []}, open(os.path.join(b, "changes-2026-06-10.json"), "w"))
        json.dump({"date": "2026-06-17", "changes": [["IA", "E0", "TOWN", "corn", "ZCZ26", "NOV26", -30, -40]]},
                  open(os.path.join(b, "changes-2026-06-17.json"), "w"))
        ow = our_weekly(tmp, ["IA"])
        line = ow["states"]["IA"]["corn"]
        assert [p[0] for p in line] == ["2026-06-12", "2026-06-19"], line
        # Jun 12: E0 -30, E1..E4 -31..-34, E5 +120 (outlier, more than 75c out): median of 5 = -0.32
        assert line[0][1] == -0.32 and line[0][2] == 5 and line[0][3] == "ZCZ26", line[0]
        # Jun 19: E0 now -40: -40,-31,-32,-33,-34 -> -0.33
        assert line[1][1] == -0.33, line[1]
        assert ow["through"] == "2026-06-19"
    # whole build from fixtures: every source parses, the files fit, a broken source degrades
    with tempfile.TemporaryDirectory() as tmp:
        fx = make_fixtures(os.path.join(tmp, "fx"))
        if True:
            docs, status, conn, _ = build(Fixtures(fx), date(2026, 10, 20), os.path.join(tmp, "moves"), repo=REPO)
            bad = {k: v.get("error") for k, v in status.items() if v["status"] != "ok"}
            assert not bad, bad
            for sid, _ in TILES:
                assert sid in docs and docs[sid]["latest"], sid
            assert conn["status"] == "ok" and conn["tested"] >= 8, conn.get("error")
            assert all(t["verdict"] for t in conn["tests"])
            # a source that breaks keeps its last good file, marked failed
            class Broken(Fixtures):
                def meta(self, ds):
                    if ds == SRC["railcar"]["ds"]:
                        return {"columns": [{"fieldName": "nothing_useful", "dataTypeName": "text"}]}
                    return super().meta(ds)
            d2, s2, _, _ = build(Broken(fx), date(2026, 10, 20), os.path.join(tmp, "moves"), repo=REPO)
            assert s2["railcar"]["status"] == "failed" and "could not match" in s2["railcar"]["error"]
            assert s2["railcar"]["columns_found"] == ["nothing_useful"]
            assert d2["railcar-bnsf-shuttle"]["status"] == "failed" and d2["railcar-bnsf-shuttle"]["latest"]
    print("selftest ok: parsers, weekly shaping, normals, correlation gate, our weekly basis, fixtures build, degraded source")


def main():
    a = sys.argv[1:]
    today = datetime.now(timezone.utc).date()
    if "--selftest" in a:
        return selftest()
    if "--local" in a:
        ours = our_weekly(REPO)
        os.makedirs(OUT_DIR, exist_ok=True)
        json.dump(ours, open(os.path.join(OUT_DIR, "our-basis.json"), "w"), separators=(",", ":"))
        print(f"wrote our-basis.json, {len(ours.get('states', {}))} states, weeks {ours.get('weeks', [''])[0]}..{ours.get('weeks', [''])[-1]}")
        return
    if "--fixtures" in a:
        out = a[a.index("--fixtures") + 1]
        page = a[a.index("--page") + 1] if "--page" in a else None   # never the real page: fixtures are not data
        fx = make_fixtures(os.path.join(os.environ.get("TMPDIR", "/tmp"), "grain-moves-fx"))
        build(Fixtures(fx), date(2026, 10, 20), out, page=page)
        return
    build(Live(), today, OUT_DIR, page=PAGE)


if __name__ == "__main__":
    main()
