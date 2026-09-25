#!/usr/bin/env python3
"""build_atlas_pages.py -- one static page per county, one per state, a browse
hub, a data page, and the downloads, from data/atlas/. OFFLINE: reads committed
files, writes farmland-atlas/**.

WHY GENERATED. The Atlas was one URL and a hash. Google indexes the page, not
the hash, so 3,148 counties counted as one search result and nothing could be
linked or cited. These pages give every county a URL that carries its own
numbers in plain HTML, readable with no JavaScript by a crawler, a reporter's
link checker or an answer engine.

MACHINE-OWNED. Like sitemap.xml: edit this script, never the emitted files.

OUTPUT (all under farmland-atlas/)
  <state>/<county>.html       3,148 county pages  -> /farmland-atlas/iowa/story-county
  <state>/index.html             50 state pages   -> /farmland-atlas/iowa/
  states/index.html               the browse hub  -> /farmland-atlas/states/
  data.html                       downloads, columns, how to cite -> /farmland-atlas/data
  data/counties.csv               one row per county, every column documented
  data/counties.json              the same rows, for the compare page
  data/counties-index.json        [fips, "Story County, IA", url] for search boxes
  data/<st>.csv                   one state's rows
  ../sitemap-atlas.xml            every URL above, listed in robots.txt

HONESTY RULES CARRIED IN (read the sheet's JS in farmland-atlas/sheet.html: this
is a port, and the selftest compares against its rules)
  - A missing value is a dash and the reason. Never zero, never carried forward.
  - A rank counts counties with 10,000 acres or more in farms, in the same
    survey year for rent, in the same state. A code with no boundary (a
    Connecticut planning region) is never ranked against counties.
  - A land value flagged by the builder (a city county whose 2022 census value
    fell while its neighbours rose) prints with "read with care" and shows no
    change, ratio or rank.
  - The county file and the summary file must carry the same build stamp; a
    page whose two files disagree is not written, it is reported.
  - A written read appears only when its fingerprint matches the county's.
  - No combined score, no value estimate, no owner names.

--selftest builds a fixture set to a temp dir and asserts invariants.
--print-urls prints every URL after building (the workflow feeds IndexNow).
"""
import argparse
import csv
import datetime
import hashlib
import html
import io
import json
import math
import unicodedata
from decimal import Decimal, ROUND_HALF_UP
import os
import re
import statistics
import sys

SITE = "https://agsist.com"
DATA = "data/atlas"
OUT = "farmland-atlas"
CARD_V = "1"          # bump when the share-card design changes; every card URL changes with it
LICENSE_URL = "https://creativecommons.org/licenses/by/4.0/"
CREDIT = "AGSIST Farmland Atlas, agsist.com/farmland-atlas"

STATE_NAMES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California",
    "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware", "FL": "Florida", "GA": "Georgia",
    "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa",
    "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
    "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire",
    "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York", "NC": "North Carolina",
    "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania",
    "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota", "TN": "Tennessee",
    "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington",
    "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
}
CAUSE = {"heat_drought": "heat and drought", "wet": "excess moisture", "hail": "hail",
         "wind": "wind", "cold": "freeze", "irrigation": "irrigation failure",
         "price": "price decline (revenue policies)", "unassigned": "area plans", "other": "other"}


# ---------------------------------------------------------------- formatting
def esc(s):
    return html.escape("" if s is None else str(s), quote=True)


def card_key(*parts):
    """Eight hex characters that change only when a figure printed on the share card does."""
    return hashlib.sha1(json.dumps(parts, sort_keys=True, default=str).encode("utf-8")).hexdigest()[:8]


def rh(v, k):
    """The sheet's rh(): half away from zero with a 1e-9 nudge, then toFixed.
    Used where the sheet uses rh (f1, dollars with cents, loss ratios)."""
    m = 10 ** k
    n = math.floor(abs(v) * m + 1e-9 + 0.5)
    r = (n / m) * (1 if v > 0 else -1 if v < 0 else 0)
    return f"{(r if r else 0.0):.{k}f}"


def rfmt(v, k):
    """toLocaleString(maximumFractionDigits=k): ICU rounds the shortest decimal
    that round-trips the double, half away from zero. 2.135 prints 2.14 and
    0.575*100 (57.49999999999999) prints 57. Used by fmt() and pct()."""
    d = Decimal(repr(float(v))).quantize(Decimal(1).scaleb(-k), rounding=ROUND_HALF_UP)
    if d == 0:
        d = abs(d)
    return f"{d:.{k}f}"


def rfix(v, k):
    """Number.toFixed(k): rounds the exact binary value, ties away from zero.
    Used by sgn(), as the sheet does."""
    d = Decimal(float(v)).quantize(Decimal(1).scaleb(-k), rounding=ROUND_HALF_UP)
    if d == 0:
        d = abs(d)
    return f"{d:.{k}f}"


def fmt(x, k=1):
    """en-US, at most k places, no trailing zeros, thousands commas."""
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return "—"
    s = rfmt(float(x), k)
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    neg = s.startswith("-")
    s = s.lstrip("-")
    ip, _, fp = s.partition(".")
    ip = f"{int(ip):,}"
    out = ip + ("." + fp if fp else "")
    return ("−" if neg and float(s) != 0 else "") + out


def money(x):
    if x is None:
        return "—"
    v = int(math.floor(abs(x) + 0.5))
    return ("−$" if x < 0 else "$") + f"{v:,}"


def usd2(v):
    return "$" + rh(float(v), 2)


def musd(x):
    if x is None:
        return "—"
    a = abs(x)
    if a >= 1e9:
        return f"${x / 1e9:.2f} billion"
    if a >= 1e6:
        return f"${x / 1e6:.1f} million"
    return money(x)


def pct(x, k=0):
    """x is a ratio."""
    return "—" if x is None else fmt(x * 100, k) + "%"


def sgn(v, k):
    t = rfix(float(v), k)
    if float(t) == 0:
        t = rfix(0.0, k)
    n = float(t)
    return ("+" if n > 0 else "−" if n < 0 else "") + t.lstrip("-")


def ord_(n):
    s = ["th", "st", "nd", "rd"]
    v = n % 100
    return f"{n:,}" + (s[(v - 20) % 10] if (v - 20) % 10 < 4 and (v - 20) >= 0 else s[v] if v < 4 else s[0])


def f1(v):
    return rh(float(v), 1)


def get(o, *ks):
    for k in ks:
        if o is None or not isinstance(o, dict):
            return None
        o = o.get(k)
    return o


def ok(layer):
    return isinstance(layer, dict) and layer.get("status") == "ok"


def why(layer):
    if isinstance(layer, dict) and layer.get("status"):
        return re.sub(r"^(withheld|not yet measured):\s*", "", str(layer["status"]))
    return "no data"


def slugify(s):
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = s.lower().replace("&", " and ").replace("'", "").replace("\u2019", "")
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s or "x"


# ------------------------------------------------------------------- loading
class World:
    """Everything the pages share. Built once."""

    def __init__(self, root="."):
        j = lambda p: json.load(open(os.path.join(root, p), encoding="utf-8"))
        self.root = root
        self.atlas = j(f"{DATA}/atlas.json")
        self.C = self.atlas["counties"]
        self.generated = self.atlas["generated"]
        self.built = str(self.generated)[:10]
        self.NB = j(f"{DATA}/neighbors.json")["counties"]
        try:
            self.reads = j(f"{DATA}/reads.json")["counties"]
        except Exception:
            self.reads = {}
        self.cards = {"counties": {}, "states": {}}
        try:
            self.TEN = j("data/tenure/tenure.json")["counties"]
        except Exception:
            self.TEN = None
        geo = j(f"{DATA}/counties.geo.json")
        self.geo = {f["id"]: f["geometry"] for f in geo["features"]}
        self.rent_latest = 0
        for c in self.C.values():
            y = get(c, "rent", "nonirr", "year")
            if y and y > self.rent_latest:
                self.rent_latest = y
        # names and slugs
        self.label = {}
        self.slug = {}
        used = {}
        for f in sorted(self.C):
            c = self.C[f]
            self.label[f] = self._label(f, c)
            st_slug = slugify(STATE_NAMES.get(c["state"], c["state"]))
            base = slugify(self.label[f])
            key = (st_slug, base)
            if key in used and used[key] != f:
                base = f"{base}-{f}"
            used[(st_slug, base)] = f
            self.slug[f] = f"{st_slug}/{base}"
        self.by_state = {}
        for f, c in self.C.items():
            self.by_state.setdefault(c["state"], []).append(f)
        for st in self.by_state:
            self.by_state[st].sort(key=lambda f: self.label[f].lower())

    def mapped(self, f):
        return f in self.geo and f in self.NB

    def _label(self, f, c):
        name = c["name"]
        if f not in self.geo:
            name = re.sub(r"\s+Ct$", "", str(name))
            u = "planning region" if c["state"] == "CT" else "reporting district"
        else:
            u = c["u"] if "u" in c else "County"
        return name + (" " + u if u else "")

    def url(self, f):
        return f"{SITE}/{OUT}/{self.slug[f]}"

    def path(self, f):
        return f"{OUT}/{self.slug[f]}.html"

    # ---- the sheet's measures, on the summary records
    def farm_acres(self, f):
        c = self.TEN and self.TEN.get(f)
        p = c and c.get("y", {}).get("2022")
        if not p:
            return 0
        return p[0] + p[1] if p[0] is not None and p[1] is not None else None

    def is_farm(self, f):
        if not self.TEN:
            return True
        a = self.farm_acres(f)
        return a is None or a >= 10000

    def ten_share(self, f, y):
        c = self.TEN and self.TEN.get(f)
        p = c and c.get("y", {}).get(y)
        if not p or p[0] is None or p[1] is None or p[0] + p[1] <= 0:
            return None
        return p[1] / (p[0] + p[1])

    def m(self, key, f):
        c = self.C[f]
        if key == "rent":
            r = get(c, "rent", "nonirr")
            if not r or r.get("value") is None:
                return None
            if r.get("year") and self.rent_latest and r["year"] < self.rent_latest - 3:
                return None
            return r["value"]
        if key == "irr":
            r = get(c, "rent", "irr")
            if r and r.get("value") is not None and (not r.get("year") or r["year"] >= self.rent_latest - 3):
                return r["value"]
            return None
        if key == "value":
            return get(c, "value", "latest")
        if key == "yld":
            n = get(c, "yield", "n")
            return None if (n is not None and n < 15) else get(c, "yield", "median")
        if key == "cost":
            x = get(c, "sob", "loss_cost_last10")
            return None if x is None else x * 100
        if key == "heat":
            return get(c, "heat", "months", "jul", "recent", "mean")
        if key == "rented":
            return self.ten_share(f, "2022")
        raise KeyError(key)

    def stat(self, key, st, f):
        """State median and the county's rank, or None, or {'none': why}.
        Port of stat() in sheet.html."""
        if not self.mapped(f) or not self.TEN:
            return None
        yk = "nonirr" if key == "rent" else "irr" if key == "irr" else None
        yr = get(self.C[f], "rent", yk, "year") if yk else None
        vals, mine = [], None
        for g in self.by_state.get(st, []):
            c = self.C[g]
            if not self.mapped(g):
                continue
            if yk and get(c, "rent", yk, "year") != yr:
                continue
            v = self.m(key, g)
            if v is None:
                continue
            if g == f:
                mine = v
            if not self.is_farm(g):
                continue
            if key == "value" and get(c, "value", "flag"):
                continue
            vals.append(v)
        off = bool(yr and yr != self.rent_latest)
        if len(vals) < (10 if off else 3):
            return {"none": f"too few {yr} county surveys in the state to compare"} if off else None
        vals.sort()
        n = len(vals)
        med = vals[(n - 1) // 2] if n % 2 else (vals[n // 2 - 1] + vals[n // 2]) / 2
        in_pool = (mine is not None and self.is_farm(f)
                   and not (key == "value" and get(self.C[f], "value", "flag")))
        words = ""
        if in_pool:
            words = rank_words(sum(1 for x in vals if x > mine) + 1, n, sum(1 for x in vals if x == mine))
        return {"med": med, "yr": yr, "words": words, "n": n}


def rank_words(r, n, t=1):
    if n < 2 or t >= n:
        return ""
    tie = "tied for " if t > 1 else ""
    last = r + t - 1
    N = f"{n:,}"
    if r == 1:
        return tie + "highest of " + N
    if last == n:
        return tie + "lowest of " + N
    if r <= n / 2:
        return tie + ord_(r) + " highest of " + N
    return tie + ord_(n - last + 1) + " lowest of " + N


def recent_yield(y, rent_latest):
    """Five years ending at the newest, high and low dropped, at least four."""
    if not y or not y.get("hist") or not y.get("last_year"):
        return None
    last = y["last_year"]
    if rent_latest and last < rent_latest - 3:
        return None
    ys = [k for k in range(last - 4, last + 1) if str(k) in y["hist"]]
    if len(ys) < 4:
        return None
    vals = sorted(y["hist"][str(k)] for k in ys)[1:-1]
    return {"from": last - 4, "to": last, "n": len(ys), "avg": sum(vals) / len(vals)}


def jsround(x):
    """Math.round: halves go up. Python's round() sends 12.5 to 12."""
    return int(math.floor(x + 0.5))


def flag_words(fl, short=False):
    d = fl.get("dir") or "fell"
    nb = ("rose a median %d%%" % jsround(fl["nb_pct"])) if fl["nb_pct"] >= 0 else ("fell a median %d%%" % jsround(abs(fl["nb_pct"])))
    return "%s %d%% from 2017 while %s%s" % (d, jsround(abs(fl["own_pct"])),
                                             "next door " if short else "the %d counties next door " % fl["n"], nb)


# ------------------------------------------------------------ flat record
# One definition, used by the CSV, the JSON the compare page reads, the state
# tables and the data page. (name, unit, source, what it is)
COLUMNS = [
    ("fips", "", "Census", "five-digit county code"),
    ("state", "", "Census", "state abbreviation"),
    ("county", "", "Census", "county name"),
    ("rent_dry_usd_ac", "$/acre", "NASS Cash Rents Survey", "non-irrigated cropland cash rent, county average"),
    ("rent_dry_year", "year", "NASS Cash Rents Survey", "survey year of that rent"),
    ("rent_dry_chg10_pct", "%", "NASS Cash Rents Survey", "change in dry rent over ten years, nominal"),
    ("rent_irr_usd_ac", "$/acre", "NASS Cash Rents Survey", "irrigated cropland cash rent"),
    ("rent_irr_year", "year", "NASS Cash Rents Survey", "survey year of that rent"),
    ("rent_pasture_usd_ac", "$/acre", "NASS Cash Rents Survey", "permanent pasture cash rent"),
    ("value_usd_ac", "$/acre", "Census of Agriculture", "land and buildings, operators' own estimate, not a sale price"),
    ("value_year", "year", "Census of Agriculture", "census year of that value"),
    ("value_flag", "", "AGSIST", "rose or fell when the 2022 value moved against its neighbours; the change, ratio and rank are withheld"),
    ("value_cagr_pct", "% a year", "Census of Agriculture", "compound annual change between the last two censuses, nominal"),
    ("rent_to_value_pct", "%", "NASS and Census", "dry rent divided by census value, same year"),
    ("corn_yield_median_bu_ac", "bu/acre", "NASS county yields", "median published county corn yield"),
    ("corn_yield_years", "years", "NASS county yields", "published years behind that median"),
    ("corn_yield_trend_bu_yr", "bu/acre/yr", "NASS county yields", "least-squares trend over the published years"),
    ("claims_per_100_usd", "$", "RMA Summary of Business", "indemnity per $100 of liability, last ten closed crop years"),
    ("loss_ratio_last10", "ratio", "RMA Summary of Business", "indemnity over total premium (farmer share plus subsidy), last ten closed years"),
    ("loss_ratio_all", "ratio", "RMA Summary of Business", "the same, 1989 to the last closed year"),
    ("years_loss_over_1", "years", "RMA Summary of Business", "years in which claims exceeded premium"),
    ("d2_week_share_pct", "%", "U.S. Drought Monitor", "share of weeks with half the county or more in D2 (severe) drought or worse, 2000 on"),
    ("jul_low_recent_f", "°F", "NOAA nClimDiv", "July average of daily lows, most recent ten years"),
    ("jul_low_normal_f", "°F", "NOAA nClimDiv", "July average of daily lows, 1991 to 2020 normal"),
    ("jul_low_trend_f_decade", "°F/decade", "NOAA nClimDiv", "trend in July lows since 1976"),
    ("irrigated_share_2022", "ratio", "Census of Agriculture", "share of harvested cropland irrigated"),
    ("tile_share_2022", "ratio", "Census of Agriculture", "share of cropland drained by tile"),
    ("notill_share_2022", "ratio", "Census of Agriculture", "share of cropland farmed no-till"),
    ("crp_acres", "acres", "FSA", "CRP acres enrolled, latest year"),
    ("crp_share_pct", "%", "FSA and Census", "CRP acres over CRP plus harvested cropland"),
    ("crp_expiring_next3_acres", "acres", "FSA", "CRP acres with contracts ending in the next three fiscal years"),
    ("rented_share_2022", "ratio", "Census of Agriculture", "share of farmland rented from others"),
    ("solar_mw", "MW", "EIA Form 860", "operating solar nameplate"),
    ("wind_mw", "MW", "EIA Form 860", "operating wind nameplate"),
    ("gs_rain_normal_in", "inches", "NOAA nClimDiv", "April to September rain, 1991 to 2020 normal"),
    ("hail_1in_days_yr", "days/year", "NOAA Storm Events", "days a year with a report of hail 1 inch or larger (reports, not storms)"),
    ("cattle_2022", "head", "Census of Agriculture", "cattle and calves"),
]
COLNAMES = [c[0] for c in COLUMNS]


def flat_record(W, f, d=None):
    """One county as a flat dict. `d` is the detail file when the page has it;
    the summary record carries all but a few series-derived fields."""
    c = W.C[f]
    d = d or c
    R, V, Y, S = d.get("rent") or {}, d.get("value") or {}, d.get("yield") or {}, d.get("sob") or {}
    rec = dict.fromkeys(COLNAMES)
    rec.update(fips=f, state=c["state"], county=W.label[f])
    rv = R.get("nonirr") if ok(R) else None
    ri = R.get("irr")
    if rv:
        rec["rent_dry_usd_ac"], rec["rent_dry_year"] = rv.get("value"), rv.get("year")
        rec["rent_dry_chg10_pct"] = get(R, "nonirr_change10", "pct")
    if ri:
        rec["rent_irr_usd_ac"], rec["rent_irr_year"] = ri.get("value"), ri.get("year")
    if R.get("pasture"):
        rec["rent_pasture_usd_ac"] = R["pasture"].get("value")
    if ok(V):
        rec["value_usd_ac"] = V.get("latest")
        rec["value_year"] = V.get("latest_year") or get(W.atlas, "national", "value", "year")
        rec["value_flag"] = V.get("flag")
        if not V.get("flag"):
            rec["value_cagr_pct"] = V.get("change_cagr_pct", get(V, "change", "cagr_pct"))
            rec["rent_to_value_pct"] = V.get("rent_to_value_pct", get(V, "rent_to_value", "pct"))
    if ok(Y):
        rec["corn_yield_median_bu_ac"] = Y.get("median")
        rec["corn_yield_years"] = Y.get("n")
        rec["corn_yield_trend_bu_yr"] = Y.get("slope")
    if ok(S):
        lc = S.get("loss_cost_last10", get(S, "last10", "loss_cost"))
        rec["claims_per_100_usd"] = None if lc is None else round(lc * 100, 4)
        rec["loss_ratio_last10"] = S.get("ratio_last10", get(S, "last10", "ratio"))
        rec["loss_ratio_all"] = S.get("loss_ratio_all")
        rec["years_loss_over_1"] = S.get("years_over_one")
    Dr = d.get("drought") or {}
    if ok(Dr):
        rec["d2_week_share_pct"] = get(Dr, "weeks", "share_d2_pct")
    H = d.get("heat") or {}
    jul = get(H, "months", "jul") if ok(H) else None
    if jul:
        rec["jul_low_recent_f"] = get(jul, "recent", "mean")
        rec["jul_low_normal_f"] = get(jul, "normal_1991_2020", "mean")
        rec["jul_low_trend_f_decade"] = get(jul, "trend", "per_decade")
    Wt = d.get("water") or {}
    if ok(Wt):
        rec["irrigated_share_2022"] = get(Wt, "irrigated_share_2022", "share")
    Pr = d.get("practices") or {}
    if ok(Pr):
        rec["tile_share_2022"] = get(Pr, "tile", "share")
        rec["notill_share_2022"] = get(Pr, "notill", "share")
    Cr = d.get("crp") or {}
    if ok(Cr):
        rec["crp_acres"] = get(Cr, "latest", "acres")
        rec["crp_share_pct"] = Cr.get("share_pct", get(Cr, "share_of_cropland", "pct"))
        rec["crp_expiring_next3_acres"] = get(Cr, "expiring_next3", "acres")
    rec["rented_share_2022"] = None if not W.TEN else (None if W.ten_share(f, "2022") is None else round(W.ten_share(f, "2022"), 4))
    E = d.get("energy") or {}
    if ok(E) and isinstance(E.get("operable"), dict):
        rec["solar_mw"] = E["operable"].get("solar")
        rec["wind_mw"] = E["operable"].get("wind")
    Cl = d.get("climate") or {}
    if ok(Cl):
        rec["gs_rain_normal_in"] = Cl.get("gs_normal_in")
    Sm = d.get("storms") or {}
    if ok(Sm):
        rec["hail_1in_days_yr"] = Sm.get("hail_1in_days_per_year")
    Lv = d.get("livestock") or {}
    if ok(Lv):
        rec["cattle_2022"] = get(Lv, "cattle", "value")
    return rec


# ---------------------------------------------------------------------- SVG
GOLD, BLUE = "var(--gold)", "var(--blue)"   # series colours; the CSS classes below use the same tokens


def bars_svg(series, label, unit_fmt, w=640, h=170, ref=None, ref_label=None, hatch_last=False, every=None):
    """Labelled bar chart. series: {year:int -> value}. Every axis and the
    endpoints are labelled; a year with no value is a gap, never a zero.
    Colours are CSS classes so the light theme works and the markup stays small."""
    ys = sorted(series)
    if len(ys) < 3:
        return ""
    vmax = max(max(series.values()), ref or 0)
    if vmax <= 0:
        return ""
    L, R, T, B = 8, 8, 16, 22
    n = ys[-1] - ys[0] + 1
    bw = (w - L - R) / n
    top = vmax * 1.12
    Y = lambda v: T + (1 - v / top) * (h - T - B)
    base = h - B
    path = []
    for i, y in enumerate(ys):
        if hatch_last and i == len(ys) - 1:
            continue
        path.append("M%.1f %.1fh%.1fV%dh-%.1fz" % (L + (y - ys[0]) * bw + bw * 0.12, Y(series[y]), bw * 0.76, base, bw * 0.76))
    s = ['<path class="bf" d="%s"/>' % "".join(path)]
    step = every or (1 if n <= 14 else 2 if n <= 30 else 5)
    for y in range(ys[0], ys[-1] + 1):
        if (y - ys[0]) % step == 0 or (y == ys[-1] and n <= 14):
            s.append('<text class="ta" x="%.1f" y="%d">%d</text>' % (L + (y - ys[0] + 0.5) * bw, h - 6, y))
    peak = max(ys, key=lambda y: series[y])
    lab = set(ys) if len(ys) <= 12 else {ys[0], ys[-1], peak}
    for y in sorted(lab):
        s.append('<text class="tv" x="%.1f" y="%.1f">%s</text>' % (L + (y - ys[0] + 0.5) * bw, Y(series[y]) - 3, esc(unit_fmt(series[y]))))
    if ref is not None:
        s.append('<path class="rf" d="M%d %.1fH%d"/>' % (L, Y(ref), w - R))
        s.append('<text class="tr" x="%d" y="%.1f">%s</text>' % (L + 2, Y(ref) - 3, esc(ref_label or "")))
    s.append('<path class="ax" d="M%d %dH%d"/>' % (L, base, w - R))
    return '<svg viewBox="0 0 %d %d" role="img" aria-label="%s" class="ch">%s</svg>' % (w, h, esc(label), "".join(s))


def lines_svg(seriesets, label, unit_fmt, w=640, h=170):
    """Rent by survey year, dry and irrigated. A break in the years breaks the line."""
    allp = [(y, v) for sd in seriesets for y, v in sd["d"].items()]
    if len(allp) < 3:
        return ""
    x0, x1 = min(p[0] for p in allp), max(p[0] for p in allp)
    vmax = max(p[1] for p in allp)
    L, R, T, B = 34, 70, 14, 22
    top = vmax * 1.1
    X = lambda y: L + (0 if x1 == x0 else (y - x0) / (x1 - x0)) * (w - L - R)
    Y = lambda v: T + (1 - v / top) * (h - T - B)
    s = []
    step = 100 if vmax > 400 else 50 if vmax > 150 else 20 if vmax > 60 else 10
    grid, g = [], 0
    while g <= top:
        grid.append("M%d %.1fH%d" % (L, Y(g), w - R))
        s.append('<text class="ta tay" x="%d" y="%.1f">$%d</text>' % (L - 4, Y(g) + 3, g))
        g += step
    s.insert(0, '<path class="gr" d="%s"/>' % "".join(grid))
    span = x1 - x0
    xs = 5 if span > 12 else 2 if span > 6 else 1
    y = -(-x0 // xs) * xs
    while y <= x1:
        s.append('<text class="ta" x="%.1f" y="%d">%d</text>' % (X(y), h - 6, y))
        y += xs
    for i, sd in enumerate(seriesets):
        ys = sorted(sd["d"])
        path, prev = "", None
        for y in ys:
            path += ("L" if prev is not None and y - prev == 1 else "M") + "%.1f %.1f" % (X(y), Y(sd["d"][y]))
            prev = y
        cls = "s1" if sd["n"] == "irrigated" else "s0"
        s.append('<path class="ln %s" d="%s"/>' % (cls, path))
        dots = "".join("M%.1f %.1fh.01" % (X(y), Y(sd["d"][y])) for y in ys)
        s.append('<path class="dt %s" d="%s"/>' % (cls, dots))
        a, b = ys[0], ys[-1]
        s.append('<text class="tl %s" x="%.1f" y="%.1f">%s</text>' % (cls, X(a) + 2, Y(sd["d"][a]) - 6, unit_fmt(sd["d"][a])))
        s.append('<text class="tl %s" x="%.1f" y="%.1f">%s %s</text>' % (cls, X(b) + 5, Y(sd["d"][b]) + 3, unit_fmt(sd["d"][b]), esc(sd["n"])))
    return '<svg viewBox="0 0 %d %d" role="img" aria-label="%s" class="ch">%s</svg>' % (w, h, esc(label), "".join(s))


def quint(vals):
    """Four breakpoints that cut the sorted values into five equal-count bins."""
    v = sorted(vals)
    n = len(v)
    if n < 10:
        return None
    return [v[(n * k) // 5] for k in range(1, 5)]


def bin_of(x, br):
    k = 0
    for b in br:
        if x >= b:
            k += 1
    return k


def state_map(W, st, recs):
    """The state, every county a link to its page, coloured by one figure.
    The colours are baked for dry rent (no JavaScript needed); the selector
    recolours from the data-* attributes."""
    fs = [f for f in W.by_state[st] if f in W.geo]
    if not fs:
        return "", None

    def rings(f):
        g = W.geo[f]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        return [[((x - 360) if (st == "AK" and x > 0) else x, y) for x, y in ring] for poly in polys for ring in poly]

    R = {f: rings(f) for f in fs}
    xs = [p[0] for f in fs for r in R[f] for p in r]
    ys = [p[1] for f in fs for r in R[f] for p in r]
    lat0 = (min(ys) + max(ys)) / 2
    k = math.cos(math.radians(lat0))
    x0, x1, y0, y1 = min(xs) * k, max(xs) * k, min(ys), max(ys)
    w = 760
    sc = (w - 8) / max(1e-9, x1 - x0)
    h = min(560, (y1 - y0) * sc + 8)
    sc = min(sc, (h - 8) / max(1e-9, y1 - y0))
    ox, oy = (w - (x1 - x0) * sc) / 2, (h - (y1 - y0) * sc) / 2
    P = lambda x, y: "%.1f %.1f" % (ox + (x * k - x0) * sc, oy + (y1 - y) * sc)
    rent = {f: recs[f]["rent_dry_usd_ac"] for f in fs if recs[f]["rent_dry_usd_ac"] is not None and recs[f]["rent_dry_year"] == W.rent_latest}
    br = quint(list(rent.values()))
    out = []
    for f in fs:
        r = recs[f]
        d = "".join("M" + "L".join(P(x, y) for x, y in ring) + "Z" for ring in R[f])
        q = ("q%d" % bin_of(rent[f], br)) if (br and f in rent) else "qn"
        at = ""
        for code, v in (("r", rent.get(f)), ("v", None if r["value_flag"] else r["value_usd_ac"]), ("y", r["corn_yield_median_bu_ac"]),
                        ("c", r["claims_per_100_usd"]), ("d", r["d2_week_share_pct"])):
            if v is not None:
                at += ' data-%s="%s"' % (code, v)
        tip = "%s: %s" % (W.label[f], money(rent[f]) if f in rent else "no current rent")
        out.append('<a href="/%s/%s"><path class="%s" d="%s"%s><title>%s</title></path></a>' % (OUT, W.slug[f], q, d, at, esc(tip)))
    leg = ""
    if br:
        lo = min(rent.values())
        hi = max(rent.values())
        edges = [lo] + br + [hi]
        leg = "".join('<span><i class="q%d"></i>%s\u2013%s</span>' % (i, money(edges[i]), money(edges[i + 1])) for i in range(5))
    return ('<div class="smw"><svg viewBox="0 0 %d %d" class="sm" role="group" aria-label="%s counties, click one to open its page">%s</svg>'
            '<div class="leg" id="leg">%s</div></div>' % (w, int(h), esc(STATE_NAMES.get(st, st)), "".join(out), leg)), br


def locator_svg(W, f, w=260, h=190):
    """The county, gold, with the counties that share a boundary in grey."""
    if not W.mapped(f):
        return ""
    ids = [f] + [g for g in W.NB.get(f, []) if g in W.geo]
    st = W.C[f]["state"]

    def rings(g):
        geom = W.geo[g]
        polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
        out = []
        for poly in polys:
            for ring in poly:
                out.append([((x - 360) if (st == "AK" and x > 0) else x, y) for x, y in ring])
        return out

    R = {g: rings(g) for g in ids}
    xs = [p[0] for g in ids for r in R[g] for p in r]
    ys = [p[1] for g in ids for r in R[g] for p in r]
    lat0 = (min(ys) + max(ys)) / 2
    k = math.cos(math.radians(lat0))
    x0, x1, y0, y1 = min(xs) * k, max(xs) * k, min(ys), max(ys)
    sc = min((w - 8) / max(1e-9, x1 - x0), (h - 8) / max(1e-9, y1 - y0))
    ox = (w - (x1 - x0) * sc) / 2
    oy = (h - (y1 - y0) * sc) / 2
    P = lambda x, y: "%.1f %.1f" % (ox + (x * k - x0) * sc, oy + (y1 - y) * sc)
    s = []
    for g in ids:
        d = "".join("M" + "L".join(P(x, y) for x, y in r) + "Z" for r in R[g])
        me = g == f
        s.append('<path class="%s" d="%s"/>' % ("lm" if me else "ln0", d))
    return '<svg viewBox="0 0 %d %d" role="img" aria-label="%s on the map with the counties that border it" class="loc">%s</svg>' % (w, h, esc(W.label[f]), "".join(s))


# ------------------------------------------------------------------ CSS/JS
CSS = """
.ap{max-width:1040px;margin:0 auto;padding:0 1rem 3rem}
.ap .bc{padding:.65rem 0 0;font-size:.795rem;color:var(--text-dim)}
.ap .bc a{color:var(--text-dim);text-decoration:none}.ap .bc a:hover{color:var(--gold)}.ap .bc i{margin:0 .35rem;opacity:.45;font-style:normal}
.ap h1{font-family:var(--font-display);font-size:1.7rem;font-weight:800;text-transform:uppercase;margin:.7rem 0 .3rem;letter-spacing:.01em}
.ap .kick{font-size:.75rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--gold)}
:root[data-theme="light"] .ap .kick,:root[data-theme="light"] .ap .leg{color:#6f5209}
.ap .sub{color:var(--text-dim);font-size:.9rem;line-height:1.55;max-width:760px;margin:0 0 .8rem}
.ap h2{font-family:var(--font-mono);font-size:.78rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--text-muted);margin:1.7rem 0 .55rem;padding-bottom:.3rem;border-bottom:1px solid var(--border)}
.ap .act{display:flex;flex-wrap:wrap;gap:.5rem;margin:.6rem 0 1rem}
.ap .act a,.ap .act button{font:inherit;font-size:.82rem;font-weight:700;color:var(--text);background:var(--surface,#12161a);border:1px solid var(--border);border-radius:8px;padding:.5rem .85rem;min-height:40px;text-decoration:none;cursor:pointer}
.ap .act a:hover,.ap .act button:hover{border-color:var(--gold);color:var(--gold)}
.ap .read{border-left:2px solid var(--gold);padding:.2rem 0 .2rem .9rem;margin:0 0 1.1rem;font-size:.95rem;line-height:1.65;max-width:75ch}
.ap .keys{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.6rem;margin:.4rem 0 1rem}
.ap .k{border:1px solid var(--border);border-radius:8px;padding:.6rem .75rem}
.ap .k .t{font-size:.76rem;color:var(--text-dim);line-height:1.3;min-height:2.1em}
.ap .k .v{font-family:var(--font-mono);font-size:1.35rem;font-weight:700;margin:.15rem 0}
.ap .k .v small{font-size:.72rem;font-weight:600;color:var(--text-dim);margin-left:.15rem}
.ap .k .s{font-size:.76rem;color:var(--text-muted);line-height:1.4}
.ap .two{display:grid;grid-template-columns:minmax(0,1fr) 270px;gap:1.2rem;align-items:start}
.ap .loc{width:100%;height:auto;display:block;background:var(--surface);border:1px solid var(--border);border-radius:8px}
.ap .fact{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.2rem .8rem;padding:.38rem 0;border-bottom:1px dotted var(--border);font-size:.88rem}
.ap .fact .l{color:var(--text-dim)}.ap .fact .r{text-align:right;font-weight:700;font-family:var(--font-mono)}
.ap .fact .r small{display:block;font-weight:400;color:var(--text-muted);font-family:inherit;font-size:.74rem}
.ap .fact.w .r{font-weight:400;color:var(--text-muted);font-family:inherit}
.ap .fact.st{grid-template-columns:minmax(0,1fr)}.ap .fact.st .r{text-align:left}
.ap .smw{margin:.4rem 0 1rem}.ap .sm{width:100%;height:auto;display:block;background:var(--surface);border:1px solid var(--border);border-radius:8px}
.ap .sm path{stroke:var(--bg);stroke-width:.6;stroke-linejoin:round;cursor:pointer}.ap .sm a:hover path,.ap .sm a:focus path{stroke:var(--text);stroke-width:1.4}
.ap .q0{fill:rgba(var(--gold-rgb),.16)}.ap .q1{fill:rgba(var(--gold-rgb),.34)}.ap .q2{fill:rgba(var(--gold-rgb),.52)}.ap .q3{fill:rgba(var(--gold-rgb),.74)}.ap .q4{fill:rgba(var(--gold-rgb),1)}.ap .qn{fill:var(--surface3)}
.ap .leg{display:flex;flex-wrap:wrap;gap:.3rem .9rem;font-family:var(--font-mono);font-size:.74rem;color:var(--text-dim);margin:.5rem 0 0}
.ap .leg span{display:inline-flex;align-items:center;gap:.35rem}.ap .leg i{display:inline-block;width:14px;height:14px;border-radius:3px;border:1px solid var(--border-2)}
.ap .mp{display:flex;flex-wrap:wrap;gap:.6rem 1rem;align-items:center;margin:.4rem 0}.ap .mp select{font:inherit;font-size:.9rem;min-height:40px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text);padding:.3rem .6rem}
.ap .ch{width:100%;height:auto;display:block;margin:.4rem 0 .2rem}
.ap .note{font-size:.8rem;color:var(--text-muted);line-height:1.55;margin:.2rem 0 .6rem}
.ap .warn{border:1px solid var(--border);border-left:2px solid var(--gold);padding:.6rem .8rem;border-radius:6px;font-size:.85rem;color:var(--text-dim);margin:.6rem 0;line-height:1.55}
.ap table{width:100%;border-collapse:collapse;font-size:.84rem}
.ap th{font-size:.7rem;letter-spacing:.05em;text-transform:uppercase;color:var(--text-muted);text-align:right;font-weight:700;border-bottom:1px solid var(--border);padding:.35rem .4rem;vertical-align:bottom}
.ap td{padding:.38rem .4rem;border-bottom:1px dotted var(--border);text-align:right;font-family:var(--font-mono);white-space:nowrap}
.ap th:first-child,.ap td:first-child{text-align:left;font-family:inherit}
.ap tr.me td{color:var(--gold);font-weight:700}.ap tr.med td{font-style:italic;color:var(--text-dim)}
.ap td a{color:var(--text);text-decoration:none;border-bottom:1px solid var(--border)}.ap td a:hover{color:var(--gold)}
.ap .tw{overflow-x:auto}
.ap .cite{border:1px solid var(--border);border-radius:8px;padding:.8rem 1rem;font-size:.86rem;line-height:1.6;color:var(--text-dim)}
.ap .cite code{font-family:var(--font-mono);font-size:.8rem;color:var(--text);word-break:break-word}
.ap details{border:1px solid var(--border);border-radius:8px;padding:.6rem .9rem;margin:.6rem 0;font-size:.85rem;color:var(--text-dim);line-height:1.6}
.ap details summary{cursor:pointer;font-weight:700;color:var(--text)}
.ap .nav2{display:flex;justify-content:space-between;gap:1rem;margin:1.4rem 0 0;font-size:.85rem}
.ap .nav2 a{color:var(--text-dim);text-decoration:none}.ap .nav2 a:hover{color:var(--gold)}
.ap .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:.3rem .8rem;margin:.6rem 0}
.ap .grid a{color:var(--text-dim);text-decoration:none;font-size:.86rem;padding:.25rem 0;border-bottom:1px dotted var(--border)}.ap .grid a:hover{color:var(--gold)}
.ap input[type=search]{font:inherit;font-size:.95rem;min-height:44px;width:100%;max-width:420px;border-radius:8px;border:1px solid var(--border);background:var(--surface,#12161a);color:var(--text);padding:.4rem .8rem}
.ap .dl{width:100%}.ap .dl td:nth-child(n+2){white-space:normal;text-align:left;font-family:inherit}
.ap th.s{cursor:pointer}.ap th.s:hover{color:var(--gold)}
@media (max-width:760px){.ap .keys{grid-template-columns:repeat(2,minmax(0,1fr))}.ap .two{grid-template-columns:minmax(0,1fr)}.ap h1{font-size:1.35rem}.ap .loc{max-width:300px}}
@media (max-width:420px){.ap .keys{grid-template-columns:minmax(0,1fr)}}
.ap .ch .bf{fill:var(--gold)}.ap .ch text{font-size:10px}.ap .ch .ta{fill:var(--text-muted);text-anchor:middle}.ap .ch .tay{text-anchor:end}
.ap .ch .tv{font-weight:700;fill:var(--text);text-anchor:middle}.ap .ch .rf{stroke:var(--blue);stroke-dasharray:4 3;fill:none}.ap .ch .tr{fill:var(--blue)}
.ap .ch .ax{stroke:var(--border-2);fill:none}.ap .ch .gr{stroke:var(--border-2);stroke-width:.6;fill:none}
.ap .ch .ln{fill:none;stroke-width:2}.ap .ch .dt{fill:none;stroke-width:4.4;stroke-linecap:round}
.ap .ch .s0{stroke:var(--gold)}.ap .ch .s1{stroke:var(--blue)}.ap .ch .ln.s1{stroke-dasharray:4 3}
.ap .ch text.tl{font-weight:700;stroke:none}.ap .ch text.tl.s0{fill:var(--gold)}.ap .ch text.tl.s1{fill:var(--blue)}
.ap .loc .lm{fill:var(--gold);stroke:var(--bg);stroke-width:1.2}.ap .loc .ln0{fill:var(--surface3);stroke:var(--bg);stroke-width:.7}
@media print{.ap .act,#site-header,#site-footer{display:none}}
"""
CSS_FILE = "atlas-pages.css"
CSS_V = hashlib.sha1(CSS.encode()).hexdigest()[:8]

GA = ("<script async src=\"https://www.googletagmanager.com/gtag/js?id=G-6KXCTD5Z9H\"></script>\n"
      "  <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-6KXCTD5Z9H');function gaEvent(n,p){try{gtag('event',n,p||{});}catch(e){}}</script>")


def head(title, desc, canon, extra_ld=None, robots=None, image=None, alt=None):
    image = image or "/img/og/agsist.jpg"
    alt = alt or "AGSIST Farmland Atlas: cash rent, land value and risk for every U.S. county"
    ld = json.dumps({"@context": "https://schema.org", "@graph": extra_ld or []}, ensure_ascii=False, indent=1)
    ld = ld.replace("</", "<\\/")
    return f"""<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#0a0c0d">
  <link rel="preconnect" href="https://fonts.googleapis.com" crossorigin>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  {GA}
  <link rel="preload" href="/components/styles.css?v=16" as="style">
  <link rel="stylesheet" href="/components/styles.css?v=16">
  <link rel="icon" type="image/x-icon" href="/img/favicon.ico">
  <link rel="icon" type="image/png" sizes="32x32" href="/img/favicon-32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/img/favicon-16.png">
  <link rel="apple-touch-icon" href="/img/apple-touch-icon.png">
  <link rel="manifest" href="/manifest.json">
  <title>{esc(title + ' | AGSIST' if len(title) <= 50 else title)}</title>
  <meta name="description" content="{esc(desc)}">
  <link rel="canonical" href="{esc(canon)}">
{('  <meta name="robots" content="%s">' % robots) if robots else ''}
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="AGSIST">
  <meta property="og:locale" content="en_US">
  <meta property="og:title" content="{esc(title)}">
  <meta property="og:description" content="{esc(desc)}">
  <meta property="og:url" content="{esc(canon)}">
  <meta property="og:image" content="{esc(SITE + image)}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:type" content="{"image/png" if ".png" in image else "image/jpeg"}">
  <meta property="og:image:alt" content="{esc(alt)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:site" content="@agsist">
  <meta name="twitter:title" content="{esc(title)}">
  <meta name="twitter:description" content="{esc(desc)}">
  <meta name="twitter:image" content="{esc(SITE + image)}">
  <meta name="twitter:image:alt" content="{esc(alt)}">
  <script type="application/ld+json">
{ld}
  </script>
  <link rel="stylesheet" href="/farmland-atlas/{CSS_FILE}?v={CSS_V}">
</head>
<body>
<div id="site-header"></div>
"""


FOOT = """
<div id="site-footer"></div>
<script src="/components/loader.js?v=14"></script>
</body>
</html>
"""


def crumbs(items):
    """items: [(name, url or None)]. Visible trail and JSON-LD together."""
    vis = '<nav class="bc" aria-label="Breadcrumb">' + '<i>/</i>'.join(
        (f'<a href="{esc(u)}">{esc(n)}</a>' if u else f'<span aria-current="page">{esc(n)}</span>') for n, u in items) + "</nav>"
    ld = {"@type": "BreadcrumbList", "itemListElement": [
        {"@type": "ListItem", "position": i + 1, "name": n, **({"item": (SITE + u if u.startswith("/") else u)} if u else {})}
        for i, (n, u) in enumerate(items)]}
    return vis, ld


def fact(label, value, small=None):
    long_ = len(str(value)) + len(small or "") > 34 or len(label) > 44
    return ('<div class="fact%s"><span class="l">%s</span><span class="r">%s%s</span></div>'
            % (" st" if long_ else "", esc(label), esc(value), ("<small>%s</small>" % esc(small)) if small else ""))


def fwith(label, reason):
    r = str(reason).replace("(D)", "to protect individual farms")
    return '<div class="fact w"><span class="l">%s</span><span class="r">— %s</span></div>' % (esc(label), esc(r))


def key(label, val, unit, sub, s, fm, state):
    cmp_ = ""
    none = None
    if s and s.get("none"):
        none, s = s["none"], None
    if s:
        cmp_ = "%s median%s %s%s" % (state, (" of %s surveys" % s["yr"]) if s.get("yr") and s["yr"] != s.get("latest") else "",
                                    fm(s["med"]), (" · " + s["words"]) if s["words"] else "")
    vv = "<small>—</small>" if val is None else esc(val) + (("<small>%s</small>" % esc(unit)) if unit else "")
    extra = ("<br>" + esc(cmp_)) if cmp_ else (("<br>" + esc(none)) if none else "")
    return '<div class="k"><div class="t">%s</div><div class="v">%s</div><div class="s">%s%s</div></div>' % (esc(label), vv, esc(sub or ""), extra)


# ------------------------------------------------------------- county page
def read_ok(text, d, flag):
    """The written read is model prose, checked against the record before it is
    printed under AGSIST's name. It is dropped from the static page (the record
    above it still stands) when it:
      - speaks of the census land value on a county whose land value is flagged;
      - quotes a loss ratio for a period other than the last ten closed years,
        or a different number for that period;
      - prints a rent that is the half-dollar rounded down (the page rounds
        half up, so $36.50 is $37, and two answers on one page is one too many).
    Each rule is a class of error found in the shipped reads on 2026-09-25."""
    t = text
    if flag and re.search(r"land value|census value|land and buildings", t, re.I):
        return False
    m = re.search(r"loss ratio[^.;]*?(\d{4})\D{1,3}(\d{4})[^.;]*?(\d+\.\d+)", t, re.I)
    if m:
        l10 = get(d, "sob", "last10") or {}
        if not l10 or (int(m.group(1)), int(m.group(2))) != (l10.get("from"), l10.get("to")) or l10.get("ratio") is None or m.group(3) != rh(l10.get("ratio"), 2):
            return False
    halves = set()

    def walk(o):
        if isinstance(o, dict):
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
        elif isinstance(o, float) and abs(o * 2 - round(o * 2)) < 1e-9 and abs(o - round(o)) > 0.4:
            halves.add(int(math.floor(o)))
    walk(d.get("rent") or {})
    for n_ in re.findall(r"\$(\d{1,3})(?![\d,.])", t):
        if int(n_) in halves and (int(n_) + 1) not in halves:
            return False
    return True


def lede(W, f, rec, first_year=None):
    """A sentence built only from the record. No adjectives, no comparison
    the data does not carry."""
    bits = []
    if rec["rent_dry_usd_ac"] is not None:
        bits.append("non-irrigated cash rent %s an acre (%s)" % (money(rec["rent_dry_usd_ac"]), rec["rent_dry_year"]))
    elif rec["rent_irr_usd_ac"] is not None:
        bits.append("irrigated cash rent %s an acre (%s)" % (money(rec["rent_irr_usd_ac"]), rec["rent_irr_year"]))
    if rec["value_usd_ac"] is not None:
        bits.append("land and buildings %s an acre in the %s census%s" % (money(rec["value_usd_ac"]), rec["value_year"], ", flagged to read with care" if rec["value_flag"] else ""))
    if rec["corn_yield_median_bu_ac"] is not None:
        bits.append("median corn yield %s bu/ac" % f1(rec["corn_yield_median_bu_ac"]))
    if rec["loss_ratio_all"] is not None:
        bits.append("crop insurance loss ratio %s since %s" % (rh(rec["loss_ratio_all"], 2), first_year) if first_year else "crop insurance loss ratio %s" % rh(rec["loss_ratio_all"], 2))
    if not bits:
        return "%s, %s: the public record carries few figures here. Each missing figure is shown with its reason." % (W.label[f], W.C[f]["state"])
    while len(bits) > 1 and len("%s, %s: %s." % (W.label[f], W.C[f]["state"], "; ".join(bits))) > 158:
        bits.pop()
    return "%s, %s: %s." % (W.label[f], W.C[f]["state"], "; ".join(bits))


def county_page(W, f, d, stamp):
    c = W.C[f]
    st = c["state"]
    stn = STATE_NAMES.get(st, st)
    lab = W.label[f]
    url = W.url(f)
    rec = flat_record(W, f, d)
    R, V, Y, S = d.get("rent") or {}, d.get("value") or {}, d.get("yield") or {}, d.get("sob") or {}
    Lo, Dr, Wt, E = d.get("loss") or {}, d.get("drought") or {}, d.get("water") or {}, d.get("energy") or {}
    Cr, Pr, Wl = d.get("crp") or {}, d.get("practices") or {}, d.get("wells") or {}
    jul = get(d, "heat", "months", "jul") or {}
    RL = W.rent_latest
    rv = R.get("nonirr") if ok(R) else None
    ri = R.get("irr")
    lc = S["last10"]["loss_cost"] * 100 if ok(S) and get(S, "last10", "loss_cost") is not None else None
    rs = W.ten_share(f, "2022")
    jr = jul.get("recent") if jul.get("recent") and jul["recent"].get("mean") is not None else None
    ish = get(Wt, "irrigated_share_2022", "share")
    if ish is None and ok(Wt):
        ia, ha = get(Wt, "applied_2015", "irrigated_acres"), get(Wt, "irrigated_share_2022", "harvested_acres")
        if ia and ha:
            ish = min(1, ia / ha)
        elif re.search(r"under 1,000", get(Wt, "applied_2015", "status") or "") and ha and ha >= 10000:
            ish = 0
    irr_low = ok(Wt) and ish is not None and ish < 0.10
    irr_high = ok(Wt) and ish is not None and ish >= 0.10
    ry5 = recent_yield(Y, RL) if ok(Y) else None
    fl = V.get("flag") if ok(V) else None
    crumb_vis, crumb_ld = crumbs([("AGSIST", "/"), ("Farmland Atlas", "/farmland-atlas"), (stn, f"/{OUT}/{slugify(stn)}/"), (lab, None)])

    title = f"{lab}, {stn}: Farmland Rent, Value and Risk"
    desc = lede(W, f, rec, get(d, "loss", "first_year") if ok(d.get("loss")) else None)
    if len(desc) > 300:
        desc = desc[:297].rsplit(" ", 1)[0] + "..."

    # ---- key tiles
    def val_sub():
        if not ok(V):
            return why(V)
        if fl:
            return "%s census · read with care: %s" % (V.get("latest_year"), flag_words(fl, True))
        return "%s: what operators guessed land and buildings were worth" % V.get("latest_year")
    st_rent = W.stat("rent", st, f) if rv else None
    st_irr = W.stat("irr", st, f) if ri else None
    st_val = W.stat("value", st, f) if ok(V) and not fl else None
    st_yld = W.stat("yld", st, f) if ok(Y) and Y.get("n", 0) >= 15 else None
    st_cost = W.stat("cost", st, f) if lc is not None else None
    st_rent_ = W.stat("rented", st, f) if rs is not None else None
    for s_ in (st_rent, st_irr, st_val, st_yld, st_cost, st_rent_):
        if s_ and not s_.get("none"):
            s_["latest"] = RL
    keys = ""
    keys += key("Cash rent, non-irrigated", money(rv["value"]) if rv else None, "/ac",
                (str(rv["year"]) + " county average") if rv else ("no dry rent published" if ri else why(R)), st_rent, money, st)
    if ri:
        keys += key("Cash rent, irrigated", money(ri["value"]), "/ac", "%s county average" % ri["year"], st_irr, money, st)
    keys += key("Land and buildings", money(V["latest"]) if ok(V) and V.get("latest") is not None else None, "/ac", val_sub(), st_val, money, st)
    rtv = get(V, "rent_to_value", "pct")
    if not ri:
        if rtv is None and rv and ry5 and irr_low:
            keys += key("Dry rent per bushel of corn", usd2(rv["value"] / ry5["avg"]), "", "%s ÷ %s bu, recent yield %d–%d" % (
                money(rv["value"]), f1(ry5["avg"]), ry5["from"], ry5["to"]), None, None, st)
        else:
            keys += key("Rent as % of land value", (fmt(rtv, 2) + "%") if rtv is not None else None, "",
                        ("%s dry rent ÷ %s land and buildings, both %s" % (money(V["rent_to_value"]["rent"]), money(V["rent_to_value"]["value"]), V["rent_to_value"]["year"]))
                        if rtv is not None else "not shown" + ((": " + why(V["rent_to_value"])) if get(V, "rent_to_value", "status") else ""), None, None, st)
    keys += key("Corn yield, %s median" % ("%d–%d" % (Y["first_year"], Y["last_year"]) if ok(Y) else ""),
                f1(Y["median"]) if ok(Y) else None, " bu/ac",
                ((("recent level %d–%d: %s" % (ry5["from"], ry5["to"], f1(ry5["avg"]))) if ry5 else "%s published years" % Y.get("n"))
                 + (" · irrigated and dryland combined" if irr_high else "")) if ok(Y) else why(Y), st_yld, f1, st)
    keys += key("Claims paid per $100 of coverage", usd2(lc) if lc is not None else None, "",
                ("%d–%d, closed crop years" % (S["last10"]["from"], S["last10"]["to"])) if lc is not None else ("under the premium floor for a figure" if ok(S) else why(S)),
                st_cost, usd2, st)
    keys += key("Farmland rented", pct(rs, 0) if rs is not None else None, "",
                "2022 census, rented from others" if rs is not None else ("suppressed by NASS" if W.TEN else "tenure file missing"), st_rent_, lambda v: pct(v, 0), st)

    # ---- sections
    S1 = ""
    sn = {int(k): v for k, v in (get(R, "series_nonirr") or {}).items()}
    si = {int(k): v for k, v in (get(R, "series_irr") or {}).items()}
    sets = []
    if len(sn) > 2:
        sets.append({"d": sn, "c": GOLD, "n": "dry"})
    if len(si) > 2:
        sets.append({"d": si, "c": BLUE, "n": "irrigated", "dash": True})
    ch = lines_svg(sets, "Cash rent by survey year, dollars per acre", money) if sets else ""
    S1 += "<h2>Cash rent</h2>" + ch
    if ch:
        S1 += '<p class="note">Dollars per acre, USDA NASS county survey. A break in a line is a year with no published survey; nothing is drawn across it.</p>'
    if ok(R):
        if rv:
            S1 += fact("Non-irrigated, %s" % rv["year"], money(rv["value"]) + "/ac")
        if R.get("nonirr_change10"):
            x = R["nonirr_change10"]
            S1 += fact("Change %s to %s" % (x["from_year"], x["to_year"]), sgn(x["pct"], 1) + "%", "nominal, %s to %s" % (money(x["from"]), money(x["to"])) if x.get("from") is not None else "nominal")
        if ri:
            S1 += fact("Irrigated, %s" % ri["year"], money(ri["value"]) + "/ac")
        p = R.get("pasture")
        if p and (not RL or p["year"] >= RL - 3):
            S1 += fact("Pasture, %s" % p["year"], money(p["value"]) + "/ac")
        if rv and ry5 and irr_low:
            S1 += fact("Dry rent per bushel of corn", usd2(rv["value"] / ry5["avg"]), "%s ÷ %s bu, county yield %d–%d" % (money(rv["value"]), f1(ry5["avg"]), ry5["from"], ry5["to"]))
    elif ri:
        S1 += fact("Irrigated, %s" % ri["year"], money(ri["value"]) + "/ac", "no dry rent published")
    else:
        S1 += fwith("Cash rent", why(R))

    S2 = "<h2>Land value</h2>"
    if ok(V):
        S2 += fact("Land and buildings, %s" % V["latest_year"], money(V["latest"]) + "/ac", "operators' own estimate, not a sale price")
        vs = {int(k): v for k, v in (V.get("values") or {}).items() if v and v.get("per_acre") is not None}
        if len(vs) > 1:
            S2 += "".join(fact("Census %d" % y, money(vs[y]["per_acre"]) + "/ac") for y in sorted(vs) if y != V["latest_year"])
        if fl:
            S2 += fwith("Read with care", "the %s census value %s. The census counts buildings and small residential farms, so the change since 2017, the rent-to-value ratio and the rank are withheld" % (V["latest_year"], flag_words(fl)))
        else:
            if get(V, "change", "pct") is not None:
                x = V["change"]
                S2 += fact("Change %s to %s" % (x["from_year"], x["to_year"]), sgn(x["pct"], 1) + "%", "%s a year, nominal" % (sgn(x["cagr_pct"], 1) + "%"))
            if rtv is not None:
                x = V["rent_to_value"]
                S2 += fact("Dry cropland rent ÷ census value, %s" % x["year"], fmt(x["pct"], 2) + "%",
                           "%s ÷ %s%s" % (money(x["rent"]), money(x["value"]), ("; cropland %s%% of land in farms" % x["cropland_share_pct"]) if x.get("cropland_share_pct") is not None else ""))
            elif get(V, "rent_to_value", "status"):
                S2 += fwith("Dry rent ÷ census value", why(V["rent_to_value"]))
    else:
        S2 += fwith("Land value", why(V))

    S3 = "<h2>Corn yield</h2>"
    if ok(Y):
        hist = {int(k): v for k, v in (Y.get("hist") or {}).items()}
        S3 += bars_svg(hist, "County corn yield by year, bushels per acre", lambda v: f1(v), ref=Y.get("median"), ref_label="median %s" % f1(Y["median"]))
        S3 += '<p class="note">Bushels per acre, USDA NASS county yields, all practices. The dashed line is the median of the published years.</p>'
        S3 += fact("Median, %s–%s" % (Y["first_year"], Y["last_year"]), f1(Y["median"]) + " bu/ac", "%s published years%s" % (Y["n"], ", irrigated and dryland combined" if irr_high else ""))
        if ry5:
            S3 += fact("Recent level, %d–%d" % (ry5["from"], ry5["to"]), f1(ry5["avg"]) + " bu/ac", "%d published years, high and low dropped" % ry5["n"])
        if Y.get("worst"):
            S3 += fact("Lowest published year", "%s: %s bu/ac" % (Y["worst"]["year"], f1(Y["worst"]["value"])), pct(Y["worst"]["share_of_median"], 0) + " of median")
        if Y.get("slope") is not None:
            S3 += fact("Trend, %s" % str(Y.get("window") or "").replace("-", "–"), sgn(Y["slope"], 1) + " bu/ac a year", "±%s (95%% interval)" % f1(Y["slope_ci95"]) if Y.get("slope_ci95") is not None else None)
    else:
        S3 += fwith("County corn yield", why(Y))

    S4 = "<h2>Crop insurance record</h2>"
    if ok(S):
        per = {int(k): v for k, v in (S.get("per_year") or {}).items() if v.get("ratio") is not None}
        closed = {y: v["ratio"] for y, v in per.items() if not per[y].get("partial")}
        S4 += bars_svg(closed, "Loss ratio by crop year: claims paid over total premium", lambda v: rh(v, 2), ref=1.0, ref_label="1.00: claims equal premium", every=5)
        S4 += ('<p class="note">Claims paid divided by total premium (the farmer share plus the federal subsidy), each closed crop year since %s. '
               'Above the dashed line, the county\'s insurance book paid out more than it took in.%s</p>' % (
                   S.get("first_year"), (" %s, still open, is left out." % S["partial_year"]) if S.get("partial_year") else ""))
        if lc is not None:
            S4 += fact("Claims paid per $100 of coverage, %d–%d" % (S["last10"]["from"], S["last10"]["to"]), usd2(lc))
        if get(S, "last10", "ratio") is not None:
            S4 += fact("Loss ratio, %d–%d" % (S["last10"]["from"], S["last10"]["to"]), rh(S["last10"]["ratio"], 2), "claims ÷ total premium")
        if S.get("loss_ratio_all") is not None:
            S4 += fact("Loss ratio, %s–%s" % (S["first_year"], S["last_year"]), rh(S["loss_ratio_all"], 2), "%s paid" % musd(S["total_indemnity"]))
        if S.get("years_over_one") is not None:
            S4 += fact("Years claims exceeded premium", "%s of %s" % (S["years_over_one"], S["years_with_ratio"]))
        if S.get("worst_year"):
            S4 += fact("Worst year", str(S["worst_year"]["year"]), "ratio %s" % rh(S["worst_year"]["ratio"], 2))
    else:
        S4 += fwith("Premium and payouts", why(S))
    if ok(Lo) and Lo.get("share_all"):
        top = sorted((k for k, v in Lo["share_all"].items() if v is not None), key=lambda k: -Lo["share_all"][k])[:3]
        S4 += fact("Largest causes of loss, %s–%s" % (Lo["first_year"], Lo["last_year"]), " · ".join("%s %s" % (CAUSE.get(k, k), pct(Lo["share_all"][k], 0)) for k in top), "share of dollars paid")

    S5 = "<h2>Drought and weather</h2>"
    if ok(Dr):
        ser = {int(k): v["d2"] for k, v in (Dr.get("series") or {}).items() if v.get("maps") and int(k) <= Dr["last_full_year"]}
        S5 += bars_svg(ser, "Weeks per year with half the county or more in severe drought or worse", lambda v: fmt(v, 0), every=5)
        S5 += '<p class="note">Weeks per year, U.S. Drought Monitor, with half the county or more in D2 (severe) drought or worse.</p>'
        wk = Dr.get("weeks") or {}
        S5 += fact("D2 or worse for half the county, %s–%s" % (Dr["first_year"], Dr["last_full_year"]), "%s of %s weeks" % (fmt(wk.get("d2"), 0), fmt(wk.get("counted"), 0)), "%s%% of weeks" % fmt(wk.get("share_d2_pct"), 0))
        if wk.get("d2") and Dr.get("worst_year"):
            S5 += fact("Year with the most D2+ weeks", str(Dr["worst_year"]["year"]), "%s weeks" % Dr["worst_year"]["d2"])
        if Dr.get("last5"):
            S5 += fact("Last five years, %s–%s" % (Dr["last5"]["from"], Dr["last5"]["to"]), "%s weeks" % fmt(Dr["last5"]["d2"], 0))
    else:
        S5 += fwith("Drought", why(Dr))
    if ok(d.get("heat")) and jr:
        nm = jul.get("normal_1991_2020")
        S5 += fact("July average of daily lows, %d–%d" % (jr["from"], jr["to"]), f1(jr["mean"]) + " °F",
                   ("1991–2020 normal %s °F" % f1(nm["mean"])) if nm and nm.get("mean") is not None else None)
        tr = jul.get("trend")
        if tr and tr.get("per_decade") is not None:
            S5 += fact("Trend in July lows since %s" % tr.get("from"), sgn(tr["per_decade"], 2) + " °F a decade", tr.get("direction"))
    Cl, Sm = d.get("climate") or {}, d.get("storms") or {}
    if ok(Cl) and Cl.get("gs_normal_in") is not None:
        S5 += fact("Rain, April to September", f1(Cl["gs_normal_in"]) + " in",
                   ("1991–2020 normal; last ten years %s%% of it" % Cl["gs_recent"]["pct_of_normal"]) if get(Cl, "gs_recent", "pct_of_normal") is not None else "1991–2020 normal")
    if ok(Sm):
        S5 += fact("Days with hail 1 inch or larger", f1(Sm["hail_1in_days_per_year"]) + " a year", "reports, %s–%s; a zero is no report, not proof of no hail" % (Sm["from"], Sm["to"]))

    S6 = "<h2>Land, water and programs</h2>"
    if ok(Wt):
        sh = Wt.get("irrigated_share_2022") or {}
        if sh.get("share") is not None and sh.get("reported") is False:
            S6 += fact("Harvested cropland irrigated, 2022", "none reported")
        elif sh.get("share") is not None:
            S6 += fact("Harvested cropland irrigated, 2022", pct(sh["share"], 0))
        else:
            S6 += fwith("Harvested cropland irrigated, 2022", why(sh))
    if ok(Pr):
        for label, x in (("Drained by tile, 2022", Pr.get("tile")), ("Farmed no-till, 2022", Pr.get("notill")), ("Cover crops, 2022", Pr.get("cover"))):
            if not x:
                continue
            if x.get("reported") is False:
                S6 += fact(label, "none reported")
            elif x.get("share") is not None:
                s0 = x["acres"] / Pr["cropland"] if Pr.get("cropland") else x["share"]
                S6 += fact(label, ("under 1%" if 0 < s0 < 0.005 else pct(x["share"], 0)) + " of cropland", "%s ac" % fmt(x["acres"], 0))
    elif Pr.get("status"):
        S6 += fwith("Tile drainage and tillage", why(Pr))
    if ok(Cr):
        ser = {int(k): v for k, v in (Cr.get("series") or {}).items()}
        if len(ser) > 3:
            S6 += bars_svg(ser, "CRP acres enrolled by year", lambda v: fmt(v, 0), every=5)
            S6 += '<p class="note">Acres enrolled in the Conservation Reserve Program, USDA FSA, by fiscal year.</p>'
        if get(Cr, "latest", "acres") is not None:
            S6 += fact("CRP enrolled, %s" % Cr["latest"]["year"], fmt(Cr["latest"]["acres"], 0) + " ac",
                       ("%s%% of harvested cropland + CRP" % fmt(Cr["share_of_cropland"]["pct"], 1)) if get(Cr, "share_of_cropland", "pct") is not None else None)
        if Cr.get("expiring_next3"):
            x = Cr["expiring_next3"]
            S6 += fact("CRP expiring FY%s–%s" % (x["from"], x["to"]), fmt(x["acres"], 0) + " ac", "%s%% of enrolled acres" % fmt(x["share_of_enrolled_pct"], 0) if x.get("share_of_enrolled_pct") is not None else None)
        if get(Cr, "rate", "usd_per_acre") is not None:
            S6 += fact("CRP average rental payment, FY%s" % Cr["rate"]["year"], money(Cr["rate"]["usd_per_acre"]) + "/ac", "all contracts in force, old ones included; not today's offer")
    elif Cr.get("status"):
        S6 += fwith("CRP", why(Cr))
    if ok(Wl):
        if Wl.get("kind") == "state_register":
            S6 += fact("Irrigation wells on record", fmt(Wl.get("irrigation_wells"), 0), Wl.get("register"))
        elif Wl.get("wells") is not None:
            S6 += fact("Irrigation wells in use (Nebraska register)", fmt(Wl.get("irrigation_active"), 0))
        else:
            S6 += fact("Active irrigation water rights (Kansas)", fmt(Wl.get("irrigation_active"), 0))
            if Wl.get("priority_year_median") is not None:
                S6 += fact("Median priority year", str(Wl["priority_year_median"]))
        if Wl.get("depth_median_ft") is not None:
            S6 += fact("Median well depth", fmt(Wl["depth_median_ft"], 0) + " ft")
    if ok(E) and isinstance(E.get("operable"), dict):
        o = E["operable"]
        if any((o.get(k) or 0) for k in ("solar", "wind", "storage")):
            S6 += fact("Solar and wind operating, %s" % E.get("year"), "%s MW solar · %s MW wind" % (fmt(o.get("solar"), 1), fmt(o.get("wind"), 1)), "nameplate, EIA Form 860")
    Lv = d.get("livestock") or {}
    if ok(Lv) and get(Lv, "cattle", "none_reported"):
        S6 += fact("Cattle and calves, 2022", "none reported")
    elif ok(Lv) and get(Lv, "cattle", "value") is not None:
        S6 += fact("Cattle and calves, 2022", fmt(Lv["cattle"]["value"], 0), (sgn(Lv["cattle_change"]["pct"], 1) + "% since 2017") if Lv.get("cattle_change") else None)
    own = rs
    o02 = W.ten_share(f, "2002")
    if own is not None:
        S6 += fact("Farmland rented from others, 2022", pct(own, 0), "census tenure, owned plus rented acres in farms")

    # ---- next door
    ND = ""
    nb = [g for g in W.NB.get(f, []) if g in W.C]
    if nb:
        rows = [f] + sorted(nb, key=lambda g: (W.C[g]["state"], W.label[g]))
        cols = [("Dry rent", "rent", money, "nonirr"), ("Irr. rent", "irr", money, "irr"), ("Land value", "value", money, None),
                ("Corn yield", "yld", f1, None), ("Claims per $100", "cost", usd2, None)]
        cols = [k for k in cols if any(W.m(k[1], g) is not None for g in rows)]
        ND = "<h2>Next door</h2><div class=\"tw\"><table><thead><tr><th scope=\"col\">County</th>" + "".join("<th scope=\"col\">%s</th>" % esc(k[0]) for k in cols) + "</tr></thead><tbody>"
        for g in rows:
            cg = W.C[g]
            nm = W.label[g] + ((", " + cg["state"]) if cg["state"] != st else "")
            cell = ""
            for k in cols:
                v = W.m(k[1], g)
                y = get(cg, "rent", k[3], "year") if k[3] else None
                cell += "<td>%s%s</td>" % (esc(k[2](v)) if v is not None else "—", (" <small>%s</small>" % y) if (v is not None and y and y != RL) else "")
            link = nm if g == f else '<a href="/%s/%s">%s</a>' % (OUT, W.slug[g], esc(nm))
            ND += '<tr%s><td>%s</td>%s</tr>' % (' class="me" aria-current="true"' if g == f else "", link if g != f else esc(nm), cell)
        med = ""
        for k in cols:
            v = sorted(W.m(k[1], g) for g in nb if W.m(k[1], g) is not None and (not k[3] or get(W.C[g], "rent", k[3], "year") == RL))
            if not v:
                med += "<td>—</td>"
                continue
            n = len(v)
            md = v[(n - 1) // 2] if n % 2 else (v[n // 2 - 1] + v[n // 2]) / 2
            med += "<td>%s%s</td>" % (esc(k[2](md)), (" <small>%d co.</small>" % n) if n < 3 else "")
        ND += '<tr class="med"><td>Median next door</td>%s</tr></tbody></table></div>' % med
        ND += '<p class="note">Counties that share a stretch of boundary. An older rent carries its year and stays out of the median.</p>'

    # ---- assemble
    read_html = ""
    rd = W.reads.get(f)
    if rd and rd.get("text") and rd.get("sha") == c.get("sha") and read_ok(rd["text"], d, fl):
        read_html = '<div class="read"><p style="margin:0">%s</p></div>' % esc(rd["text"])
    if W.TEN and W.farm_acres(f) is not None and W.farm_acres(f) < 10000:
        fa = W.farm_acres(f)
        warn = '<p class="warn">%s had %s in farms in the 2022 census. County averages here describe very little farmland; read them with care.</p>' % (
            esc(lab), (fmt(fa, 0) + " acres") if fa else "no acres published")
    else:
        warn = ""
    if not W.mapped(f):
        warn += '<p class="warn">%s is a planning region or reporting district with no county boundary on the map. It is not ranked against counties.</p>' % esc(lab)

    prev_next = ""
    sib = W.by_state[st]
    i = sib.index(f)
    pv, nx = (sib[i - 1] if i > 0 else None), (sib[i + 1] if i + 1 < len(sib) else None)
    prev_next = '<div class="nav2"><span>%s</span><a href="/%s/%s/">All %s counties</a><span>%s</span></div>' % (
        ('<a href="/%s/%s">← %s</a>' % (OUT, W.slug[pv], esc(W.label[pv]))) if pv else "",
        OUT, slugify(stn), esc(stn),
        ('<a href="/%s/%s">%s →</a>' % (OUT, W.slug[nx], esc(W.label[nx]))) if nx else "")

    cite = ("AGSIST Farmland Atlas. %s, %s. Figures as of %s, from USDA NASS, USDA RMA, USDA FSA, the U.S. Drought Monitor and NOAA. %s"
            % (lab, stn, stamp, url))
    csv_id = "rec"
    rec_json = json.dumps(rec, ensure_ascii=False).replace("</", "<\\/")
    body = f"""
<main class="ap">
{crumb_vis}
<div class="kick">Farmland Atlas · county record</div>
<h1>{esc(lab)}, {esc(stn)}</h1>
<p class="sub">{esc(desc)} County averages from public records, not an appraisal of any farm. FIPS {esc(f)}. Figures as of {esc(stamp)}.</p>
<div class="act">
  <a href="/farmland-atlas#{esc(f)}">Open on the map</a>
  <a href="/farmland-atlas/compare#{esc(f)}">Compare</a>
  <a href="/farmland-atlas/sheet#{esc(f)}">Printable sheet</a>
  <button type="button" id="dl">Download CSV</button>
  <button type="button" id="cp">Copy link</button>
</div>
{warn}{read_html}
<div class="two"><div><section class="keys" aria-label="Key figures">{keys}</section></div><div>{locator_svg(W, f)}</div></div>
{S1}{S2}{S3}{S4}{S5}{S6}{ND}
<h2>Cite this page</h2>
<div class="cite"><code>{esc(cite)}</code><br>Every figure is a county average from the sources named below. Ranks count counties with 10,000 acres or more in farms, in the same survey year for rent, within the state. Methods: <a href="/farmland-atlas/methods">how each figure is built</a>. Downloads: <a href="/farmland-atlas/data">all counties, CSV</a>.</div>
<details><summary>Sources, dates and arithmetic</summary>
<p>"Figures as of" is the date this page's numbers last changed; it moves only when a figure on the page does. Source files and their retrieval dates are listed on the <a href="/farmland-atlas/data">data page</a>.</p>
<p>Rent: USDA NASS Cash Rents Survey, county. Land value: Census of Agriculture, operators' estimate of land and buildings. Yield: NASS county corn yields, trend fitted here over every published year since 2008. Loss ratio: claims (indemnity) divided by total premium, USDA RMA Summary of Business, 1989 on, open crop year left out. Drought: U.S. Drought Monitor, weeks with half the county or more in D2 or worse. July lows: NOAA nClimDiv county monthly minimum temperature. A dash means the record does not carry the figure or the source withheld it; the reason is printed beside it.</p></details>
{prev_next}
</main>
<script type="application/json" id="{csv_id}">{rec_json}</script>
<script>
(function(){{
var rec=JSON.parse(document.getElementById('rec').textContent);
document.getElementById('dl').addEventListener('click',function(){{
  var k=Object.keys(rec),q=function(v){{v=v==null?'':String(v);return /[",\\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;}};
  var t=k.join(',')+'\\n'+k.map(function(x){{return q(rec[x]);}}).join(',')+'\\n';
  var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([t],{{type:'text/csv'}}));a.download='agsist-atlas-'+rec.fips+'.csv';
  document.body.appendChild(a);a.click();a.remove();try{{gaEvent('atlas_county_csv',{{fips:rec.fips}});}}catch(e){{}}
}});
var cp=document.getElementById('cp');
cp.addEventListener('click',function(){{
  var u=location.origin+location.pathname;
  var done=function(){{cp.textContent='Link copied';setTimeout(function(){{cp.textContent='Copy link';}},1800);}};
  if(navigator.clipboard&&navigator.clipboard.writeText){{navigator.clipboard.writeText(u).then(done,function(){{window.prompt('Copy this link',u);}});}}
  else window.prompt('Copy this link',u);
  try{{gaEvent('atlas_county_share',{{fips:rec.fips}});}}catch(e){{}}
}});
try{{gaEvent('atlas_county_page',{{fips:rec.fips}});}}catch(e){{}}
}})();
</script>
"""
    ld = [crumb_ld, {
        "@type": "Dataset", "@id": url + "#dataset",
        "name": "%s, %s: farmland rent, land value and risk record" % (lab, stn),
        "description": desc, "url": url, "isAccessibleForFree": True,
        "license": LICENSE_URL, "creditText": CREDIT,
        "creator": {"@type": "Organization", "name": "AGSIST", "url": SITE},
        "dateModified": stamp, "temporalCoverage": "1989/..",
        "spatialCoverage": {"@type": "Place", "name": "%s, %s, United States" % (lab, stn)},
        "isBasedOn": ["https://www.nass.usda.gov/Surveys/Guide_to_NASS_Surveys/Cash_Rents_by_County/",
                      "https://www.rma.usda.gov/tools-reports/reports/summary-of-business",
                      "https://droughtmonitor.unl.edu/"],
        "variableMeasured": [{"@type": "PropertyValue", "name": n, "unitText": u}
                             for (n, u, _s, _w) in COLUMNS if n in ("rent_dry_usd_ac", "value_usd_ac", "corn_yield_median_bu_ac", "loss_ratio_all", "d2_week_share_pct", "jul_low_recent_f")
                             and rec.get(n) is not None],
        "distribution": [{"@type": "DataDownload", "encodingFormat": "text/csv", "contentUrl": f"{SITE}/{OUT}/data/{st.lower()}.csv"}],
    }]
    ck = card_key(CARD_V, lab, st, rec["rent_dry_usd_ac"], rec["rent_dry_year"], None if rec["value_flag"] else rec["value_usd_ac"], bool(rec["value_flag"]),
                  rec["corn_yield_median_bu_ac"], rec["claims_per_100_usd"])
    W.cards["counties"][f] = {"n": lab, "s": stn, "st": st, "r": rec["rent_dry_usd_ac"], "ry": rec["rent_dry_year"],
                              "v": rec["value_usd_ac"], "vy": rec["value_year"], "vf": bool(rec["value_flag"]),
                              "y": rec["corn_yield_median_bu_ac"], "c": rec["claims_per_100_usd"], "k": ck}
    return head(title, desc, url, ld, image="/%s/og/%s.png?v=%s" % (OUT, f, ck),
                alt="%s, %s: dry cash rent %s an acre, land and buildings %s, median corn yield %s" % (
                    lab, stn, money(rec["rent_dry_usd_ac"]), "read with care" if rec["value_flag"] else money(rec["value_usd_ac"]),
                    (f1(rec["corn_yield_median_bu_ac"]) + " bu/ac") if rec["corn_yield_median_bu_ac"] is not None else "not published")) + body + FOOT


# --------------------------------------------------------------- state page
def state_page(W, st):
    stn = STATE_NAMES.get(st, st)
    fs = W.by_state[st]
    url = f"{SITE}/{OUT}/{slugify(stn)}/"
    recs = {f: flat_record(W, f) for f in fs}
    pool = [f for f in fs if W.mapped(f) and W.is_farm(f)]

    def med(key):
        def keep(f):
            if key == "rent":
                return get(W.C[f], "rent", "nonirr", "year") == W.rent_latest
            if key == "value":
                return not get(W.C[f], "value", "flag")
            return True
        v = sorted(x for x in (W.m(key, f) for f in pool if keep(f)) if x is not None)
        n = len(v)
        return None if n < 3 else (v[(n - 1) // 2] if n % 2 else (v[n // 2 - 1] + v[n // 2]) / 2), n

    rows = ""
    for f in fs:
        r = recs[f]
        rows += ('<tr><td><a href="/%s/%s">%s</a></td><td data-v="%s">%s</td><td data-v="%s">%s</td><td data-v="%s">%s</td><td data-v="%s">%s</td><td data-v="%s">%s</td><td data-v="%s">%s</td></tr>' % (
            OUT, W.slug[f], esc(W.label[f]),
            r["rent_dry_usd_ac"] if r["rent_dry_usd_ac"] is not None else "", (money(r["rent_dry_usd_ac"]) + ("" if r["rent_dry_year"] == W.rent_latest else " <small>%s</small>" % r["rent_dry_year"])) if r["rent_dry_usd_ac"] is not None else "—",
            r["rent_irr_usd_ac"] if r["rent_irr_usd_ac"] is not None else "", money(r["rent_irr_usd_ac"]) if r["rent_irr_usd_ac"] is not None else "—",
            r["value_usd_ac"] if r["value_usd_ac"] is not None else "", (money(r["value_usd_ac"]) + (" *" if r["value_flag"] else "")) if r["value_usd_ac"] is not None else "—",
            r["corn_yield_median_bu_ac"] if r["corn_yield_median_bu_ac"] is not None else "", f1(r["corn_yield_median_bu_ac"]) if r["corn_yield_median_bu_ac"] is not None else "—",
            r["claims_per_100_usd"] if r["claims_per_100_usd"] is not None else "", usd2(r["claims_per_100_usd"]) if r["claims_per_100_usd"] is not None else "—",
            r["d2_week_share_pct"] if r["d2_week_share_pct"] is not None else "", (fmt(r["d2_week_share_pct"], 0) + "%") if r["d2_week_share_pct"] is not None else "—"))
    facts = ""
    smed = {}
    for label, key_, fm in (("Median dry cash rent", "rent", money), ("Median land and buildings, %s census" % get(W.atlas, "national", "value", "year"), "value", money),
                            ("Median corn yield", "yld", f1), ("Median claims per $100 of coverage", "cost", usd2)):
        m, n = med(key_)
        smed[key_] = m
        why_ = {"rent": ", %s survey" % W.rent_latest, "value": ", value not flagged", "yld": ", 15+ published years"}.get(key_, "")
        facts += fact(label, fm(m) if m is not None else "—", ("median of %d counties with 10,000+ farm acres%s" % (n, why_)) if m is not None else "too few counties to give a median")
    crumb_vis, crumb_ld = crumbs([("AGSIST", "/"), ("Farmland Atlas", "/farmland-atlas"), ("By state", f"/{OUT}/states/"), (stn, None)])
    smap, smbr = state_map(W, st, recs)
    title = f"{stn} Farmland by County: Rent and Value"
    desc = "%s: %d counties, each with USDA cash rent, census land value, corn yield, crop insurance claims and drought weeks. Free, sourced, updated monthly." % (stn, len(fs))
    body = f"""
<main class="ap">
{crumb_vis}
<div class="kick">Farmland Atlas · state</div>
<h1>{esc(stn)} farmland by county</h1>
<p class="sub">{esc(desc)} Click a heading to sort.</p>
<div class="act"><a href="/farmland-atlas#s={esc(st)}">Open {esc(stn)} on the map</a><a href="/{OUT}/data/{st.lower()}.csv" download>Download {esc(st)} CSV</a></div>
<h2>{esc(stn)} at a glance</h2>
{facts}
<h2>Map: every county is a link</h2>
<div class="mp"><label for="mm">Colour by</label><select id="mm"><option value="r">Dry cash rent</option><option value="v">Land and buildings</option><option value="y">Corn yield</option><option value="c">Claims per $100 of coverage</option><option value="d">Drought weeks</option></select></div>
{smap}
<p class="note" id="mn">Dry cash rent, {get(W.atlas, "national", "rent", "year") or W.rent_latest} survey. Five equal-count groups of the state's counties: each swatch shows the range it covers. Grey is a county with no figure. Land values flagged to read with care are left grey.</p>
<h2>Every county</h2>
<div class="tw"><table id="t"><thead><tr><th class="s" scope="col">County</th><th class="s" scope="col">Dry rent</th><th class="s" scope="col">Irr. rent</th><th class="s" scope="col">Land value</th><th class="s" scope="col">Corn yield</th><th class="s" scope="col">Claims per $100</th><th class="s" scope="col">Drought weeks</th></tr></thead><tbody>{rows}</tbody></table></div>
<p class="note">Rent is dollars per acre, NASS county survey; an older year is shown beside the figure. Land value is the census of agriculture estimate; a star marks a value flagged to read with care. Corn yield is the median of published years. Claims per $100 of coverage are the last ten closed crop years. Drought weeks are the share of weeks since 2000 with half the county or more in D2 drought or worse. A dash means the source withheld the figure or the record does not carry it.</p>
</main>
<script>
(function(){{
var svg=document.querySelector('.sm'),sel=document.getElementById('mm'),leg=document.getElementById('leg'),note=document.getElementById('mn');
var M={{r:['Dry cash rent, {W.rent_latest} survey',function(v){{return '$'+Math.round(v).toLocaleString('en-US');}}],
  v:['Land and buildings, census of agriculture',function(v){{return '$'+Math.round(v).toLocaleString('en-US');}}],
  y:['Median corn yield, bu/ac',function(v){{return (Math.round(v*10)/10).toFixed(1);}}],
  c:['Claims paid per $100 of coverage, last ten closed years',function(v){{return '$'+(Math.round(v*100)/100).toFixed(2);}}],
  d:['Share of weeks with half the county in D2 drought or worse',function(v){{return Math.round(v)+'%';}}]}};
function paint(k){{
  var ps=[].slice.call(svg.querySelectorAll('path')),vals=[];
  ps.forEach(function(p){{var v=p.getAttribute('data-'+k);if(v!==null)vals.push(+v);}});
  vals.sort(function(a,b){{return a-b;}});var n=vals.length;
  if(n<10){{leg.textContent='Too few counties with this figure to colour a map.';ps.forEach(function(p){{p.setAttribute('class','qn');}});return;}}
  var br=[1,2,3,4].map(function(i){{return vals[Math.floor(n*i/5)];}}),e=[vals[0]].concat(br,[vals[n-1]]),f=M[k][1];
  ps.forEach(function(p){{var v=p.getAttribute('data-'+k);if(v===null){{p.setAttribute('class','qn');return;}}
    var c=0;br.forEach(function(x){{if(+v>=x)c++;}});p.setAttribute('class','q'+c);}});
  leg.innerHTML=[0,1,2,3,4].map(function(i){{return '<span><i class="q'+i+'"></i>'+f(e[i])+'\u2013'+f(e[i+1])+'</span>';}}).join('');
  note.textContent=M[k][0]+'. Five equal-count groups of the state\\'s counties: each swatch shows the range it covers. Grey is a county with no figure.';
  try{{gaEvent('atlas_state_map',{{metric:k}});}}catch(x){{}}
}}
sel.addEventListener('change',function(){{paint(sel.value);}});
var t=document.getElementById('t'),b=t.tBodies[0],dir={{}};
[].forEach.call(t.tHead.rows[0].cells,function(th,i){{th.addEventListener('click',function(){{
  var rows=[].slice.call(b.rows),d=dir[i]=!dir[i];
  rows.sort(function(a,c){{
    var x=a.cells[i],y=c.cells[i],xv=x.getAttribute('data-v'),yv=y.getAttribute('data-v');
    if(i===0){{return d?x.textContent.localeCompare(y.textContent):y.textContent.localeCompare(x.textContent);}}
    if(xv===''||xv===null){{return 1;}} if(yv===''||yv===null){{return -1;}}
    return d?yv-xv:xv-yv;}});
  rows.forEach(function(r){{b.appendChild(r);}});
}});}});
}})();
</script>
"""
    ld = [crumb_ld, {"@type": "Dataset", "@id": url + "#dataset", "name": "%s county farmland record" % stn, "description": desc, "url": url,
                     "isAccessibleForFree": True, "license": LICENSE_URL, "creditText": CREDIT,
                     "creator": {"@type": "Organization", "name": "AGSIST", "url": SITE}, "dateModified": W.built,
                     "spatialCoverage": {"@type": "Place", "name": "%s, United States" % stn},
                     "distribution": [{"@type": "DataDownload", "encodingFormat": "text/csv", "contentUrl": f"{SITE}/{OUT}/data/{st.lower()}.csv"}]}]
    sk = card_key(CARD_V, stn, len(fs), *[smed.get(k_) for k_ in ("rent", "value", "yld", "cost")])
    W.cards["states"][st] = {"n": stn, "cnt": len(fs), "r": smed.get("rent"), "v": smed.get("value"), "y": smed.get("yld"), "c": smed.get("cost"), "k": sk}
    return head(title, desc, url, ld, image="/%s/og/state-%s.png?v=%s" % (OUT, st.lower(), sk),
                alt="%s farmland by county: median dry cash rent %s an acre across %d counties" % (stn, money(smed.get("rent")) if smed.get("rent") is not None else "not published", len(fs))) + body + FOOT


def hub_page(W):
    url = f"{SITE}/{OUT}/states/"
    crumb_vis, crumb_ld = crumbs([("AGSIST", "/"), ("Farmland Atlas", "/farmland-atlas"), ("By state", None)])
    links = "".join('<a href="/%s/%s/">%s <span style="opacity:.6">(%d)</span></a>' % (OUT, slugify(STATE_NAMES[s]), esc(STATE_NAMES[s]), len(W.by_state[s]))
                    for s in sorted(W.by_state, key=lambda s: STATE_NAMES[s]))
    title = "Farmland Atlas by State and County"
    desc = "Every U.S. county: cash rent, land value, corn yield, crop insurance record and drought, on its own page. Pick a state or search a county."
    body = f"""
<main class="ap">
{crumb_vis}
<div class="kick">Farmland Atlas</div>
<h1>Every county, on its own page</h1>
<p class="sub">{esc(desc)} Built {esc(W.built)}. Every figure names its source; nothing is added into a score.</p>
<input type="search" id="q" list="ql" placeholder="Find a county, e.g. Story, IA" aria-label="Find a county" autocomplete="off"><datalist id="ql"></datalist>
<p class="note" id="m" role="status"></p>
<h2>By state</h2>
<div class="grid">{links}</div>
<div class="act"><a href="/{OUT}/data">Download every county (CSV)</a><a href="/farmland-atlas">The map</a><a href="/{OUT}/compare">Compare counties</a></div>
</main>
<script>
(function(){{
var IDX=[],q=document.getElementById('q'),dl=document.getElementById('ql'),m=document.getElementById('m');
function norm(s){{return String(s).toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\\b(county|parish|borough|census area)\\b/g,' ').replace(/\\s+/g,' ').trim();}}
fetch('/{OUT}/data/counties-index.json').then(function(r){{return r.ok?r.json():[];}}).catch(function(){{return [];}}).then(function(a){{
  IDX=a;a.forEach(function(x){{var o=document.createElement('option');o.value=x[1];dl.appendChild(o);}});
}});
function go(){{var v=norm(q.value);if(!v)return;
  var h=IDX.filter(function(x){{return norm(x[1])===v;}})[0]||IDX.filter(function(x){{return norm(x[1]).indexOf(v)===0;}})[0];
  if(h)location.href=h[2];else m.textContent='No county called "'+q.value+'". Try "Name, ST".';}}
q.addEventListener('change',go);q.addEventListener('keydown',function(e){{if(e.key==='Enter'){{e.preventDefault();go();}}}});
}})();
</script>
"""
    return head(title, desc, url, [crumb_ld], image="/%s/og/hub.png?v=%s" % (OUT, CARD_V), alt="AGSIST Farmland Atlas: a page for every U.S. county, with cash rent, land value, yield and risk") + body + FOOT


def data_page(W):
    url = f"{SITE}/{OUT}/data"
    crumb_vis, crumb_ld = crumbs([("AGSIST", "/"), ("Farmland Atlas", "/farmland-atlas"), ("Data", None)])
    rows = "".join("<tr><td><code>%s</code></td><td>%s</td><td>%s</td><td>%s</td></tr>" % (esc(n), esc(u), esc(s), esc(w)) for n, u, s, w in COLUMNS)
    states = " ".join('<a href="/%s/data/%s.csv" download>%s</a>' % (OUT, s.lower(), s) for s in sorted(W.by_state))
    title = "Farmland Atlas Data: County CSV and How to Cite"
    desc = "One row per U.S. county: cash rent, land value, corn yield, crop insurance loss ratio, drought and more, as a CSV. Every column, its unit and its source."
    cite = "AGSIST Farmland Atlas, county data, built %s. %s/%s/data" % (W.built, SITE, OUT)
    vint = ""
    for k, x in sorted((W.atlas.get("layers") or {}).items()):
        if not isinstance(x, dict):
            continue
        vint += "<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>" % (
            esc(k), esc((x.get("source") or "")[:160]), esc(str(x.get("fetched") or x.get("vintage") or "\u2014")[:10]),
            esc(x.get("latest_year") or x.get("census_year") or "\u2014"))
    body = f"""
<main class="ap">
{crumb_vis}
<div class="kick">Farmland Atlas</div>
<h1>County data and how to cite it</h1>
<p class="sub">{esc(desc)} Built {esc(W.built)}. The files are rebuilt from the Atlas each month.</p>
<div class="act"><a href="/{OUT}/data/counties.csv" download>All {len(W.C):,} counties, CSV</a><a href="/{OUT}/data/counties.json" download>Same rows, JSON</a><a href="/data/atlas/atlas.json" download>Full Atlas record, JSON</a></div>
<h2>By state</h2>
<p class="note">{states}</p>
<h2>Cite this</h2>
<div class="cite"><code>{esc(cite)}</code><br>Cite the county page for a single county's figures: each carries its own build date. The underlying figures are U.S. government data (USDA NASS, RMA and FSA, NOAA, the U.S. Drought Monitor); AGSIST compiles, matches and ranks them. A blank cell is a figure the source withheld or the record does not carry, never a zero.</div>
<h2>Licence</h2>
<p class="note">AGSIST's compilation, the county pages and these files are licensed <a href="{LICENSE_URL}" rel="license">Creative Commons Attribution 4.0</a>: use them, including commercially, with credit to "{esc(CREDIT)}" and a link. The underlying figures are U.S. government data and stay in the public domain. The AGSIST name, logo and page design are not part of the licence. Data is provided as is.</p>
<h2>Columns</h2>
<div class="tw"><table class="dl"><thead><tr><th scope="col">Column</th><th scope="col">Unit</th><th scope="col">Source</th><th scope="col">What it is</th></tr></thead><tbody>{rows}</tbody></table></div>
<p class="note">Years are printed beside every figure that is not the latest survey. Ratios are 0 to 1 unless the unit says percent. Ranks are not in the file: they depend on the comparison group and are shown on each page with the group named.</p>
<h2>Source files and when they were pulled</h2>
<div class="tw"><table class="dl"><thead><tr><th scope="col">Layer</th><th scope="col">Source</th><th scope="col">Retrieved</th><th scope="col">Latest year</th></tr></thead><tbody>{vint}</tbody></table></div>
<h2>Not in the file, on purpose</h2>
<p class="note">No combined score of any kind, no estimate of what a farm is worth, and no owner names. The Atlas shows what the public record says about a county and leaves the judgement to the reader. <a href="/farmland-atlas/methods">Methods</a>.</p>
</main>
"""
    ld = [crumb_ld, {"@type": "Dataset", "@id": url + "#dataset", "name": "AGSIST Farmland Atlas: county table", "description": desc, "url": url,
                     "isAccessibleForFree": True, "license": LICENSE_URL, "creditText": CREDIT,
                     "creator": {"@type": "Organization", "name": "AGSIST", "url": SITE}, "dateModified": W.built,
                     "spatialCoverage": {"@type": "Place", "name": "United States"},
                     "variableMeasured": [{"@type": "PropertyValue", "name": n, "unitText": u} for n, u, _s, _w in COLUMNS[3:]],
                     "distribution": [{"@type": "DataDownload", "encodingFormat": "text/csv", "contentUrl": f"{SITE}/{OUT}/data/counties.csv"},
                                      {"@type": "DataDownload", "encodingFormat": "application/json", "contentUrl": f"{SITE}/{OUT}/data/counties.json"}]}]
    return head(title, desc, url, ld, image="/%s/og/data.png?v=%s" % (OUT, CARD_V), alt="AGSIST Farmland Atlas county data: one row per U.S. county, free to download") + body + FOOT


# ------------------------------------------------------------------- output
def csv_text(recs):
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(COLNAMES)
    for r in recs:
        w.writerow(["" if r[k] is None else r[k] for k in COLNAMES])
    return buf.getvalue()


def write(path, text):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)


def build(root=".", out_root=None, only=None, quiet=False):
    """Writes everything. Returns (urls, problems)."""
    W = World(root)
    out_root = out_root or root
    problems, urls = [], []
    recs = {}
    stamps_path = os.path.join(out_root, OUT, "data", "page-stamps.json")
    try:
        prev = json.load(open(stamps_path, encoding="utf-8")) if not only else {}
    except Exception:
        prev = {}
    stamps = {}
    write(os.path.join(out_root, OUT, CSS_FILE), CSS)
    for f in sorted(W.C):
        if only and f not in only:
            continue
        p = os.path.join(root, DATA, "counties", f + ".json")
        try:
            d = json.load(open(p, encoding="utf-8"))
        except Exception as e:
            problems.append("%s: county file unreadable (%s)" % (f, e))
            continue
        if d.get("generated") != W.generated:
            problems.append("%s: county file is from %s, summary from %s; not written" % (f, d.get("generated"), W.generated))
            continue
        try:
            raw = county_page(W, f, d, "@@STAMP@@")
            h = hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]
            date = prev[f][1] if f in prev and prev[f][0] == h else W.built
            stamps[f] = [h, date]
            write(os.path.join(out_root, W.path(f)), raw.replace("@@STAMP@@", date))
        except Exception as e:  # one bad county must not stop 3,147
            problems.append("%s: %s: %s" % (f, type(e).__name__, e))
            continue
        recs[f] = flat_record(W, f, d)
        urls.append(W.url(f))
    ordered = [recs[f] for f in sorted(recs, key=lambda f: (W.C[f]["state"], W.label[f].lower()))]
    if not only and not problems:
        keep = {os.path.normpath(os.path.join(out_root, W.path(f))) for f in recs}
        for st in W.by_state:
            fold = os.path.join(out_root, OUT, slugify(STATE_NAMES[st]))
            if os.path.isdir(fold):
                for nm in os.listdir(fold):
                    fp = os.path.normpath(os.path.join(fold, nm))
                    if nm.endswith(".html") and nm != "index.html" and fp not in keep:
                        os.remove(fp)
                        if not quiet:
                            print("  removed orphan page %s/%s" % (os.path.basename(fold), nm), file=sys.stderr)
    for st in sorted(W.by_state):
        if only:
            continue
        write(os.path.join(out_root, OUT, slugify(STATE_NAMES[st]), "index.html"), state_page(W, st))
        urls.append(f"{SITE}/{OUT}/{slugify(STATE_NAMES[st])}/")
        write(os.path.join(out_root, OUT, "data", st.lower() + ".csv"), csv_text([r for r in ordered if r["state"] == st]))
    if not only:
        write(os.path.join(out_root, OUT, "states", "index.html"), hub_page(W))
        write(os.path.join(out_root, OUT, "data.html"), data_page(W))
        urls += [f"{SITE}/{OUT}/states/", f"{SITE}/{OUT}/data"]
        write(os.path.join(out_root, OUT, "data", "counties.csv"), csv_text(ordered))
        write(os.path.join(out_root, OUT, "data", "counties.json"),
              json.dumps({"generated": W.generated, "built": W.built, "columns": COLNAMES,
                          "rows": [[r[k] for k in COLNAMES] for r in ordered]}, ensure_ascii=False, separators=(",", ":")))
        write(stamps_path, json.dumps(stamps, separators=(",", ":"), sort_keys=True))
        write(os.path.join(out_root, OUT, "data", "cards.json"),
              json.dumps({"v": CARD_V, "built": W.built, "rent_latest": W.rent_latest, "counties": W.cards["counties"], "states": W.cards["states"]},
                         ensure_ascii=False, separators=(",", ":"), sort_keys=True))
        write(os.path.join(out_root, OUT, "data", "counties-index.json"),
              json.dumps([[f, W.label[f] + ", " + W.C[f]["state"], "/%s/%s" % (OUT, W.slug[f])] for f in sorted(recs, key=lambda f: (W.C[f]["state"], W.label[f].lower()))],
                         ensure_ascii=False, separators=(",", ":")))
        # the sitemap lists the extras that are hand-owned too
        extra = [f"{SITE}/{OUT}/compare"]
        lm = W.built
        by_url = {W.url(f): stamps[f][1] for f in stamps}
        body = "".join("  <url><loc>%s</loc><lastmod>%s</lastmod><changefreq>monthly</changefreq><priority>%s</priority></url>\n" % (
            u, by_url.get(u, lm), "0.6" if u in by_url else "0.7") for u in urls + extra)
        write(os.path.join(out_root, "sitemap-atlas.xml"),
              '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + body + "</urlset>\n")
    if not quiet:
        print("pages: %d urls, %d problems" % (len(urls), len(problems)), file=sys.stderr)
        for p in problems[:40]:
            print("  PROBLEM " + p, file=sys.stderr)
    return urls, problems, W


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--print-urls", action="store_true")
    ap.add_argument("--only", nargs="*", default=None, help="build only these FIPS (no state, hub or data pages)")
    ap.add_argument("--root", default=".")
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    urls, problems, W = build(a.root, a.out, set(a.only) if a.only else None)
    if a.print_urls:
        print("\n".join(urls))
    # a run that wrote almost nothing is a failure, not a green build
    if not a.only and len(urls) < 0.95 * (len(W.C) + 50):
        print("FAIL: only %d pages of %d expected" % (len(urls), len(W.C) + 50), file=sys.stderr)
        return 1
    if problems and not a.only:
        print("FAIL: %d problems; a partial build is not published" % len(problems), file=sys.stderr)
        return 1
    return 0


def selftest():
    fails = []

    def check(name, cond):
        if not cond:
            fails.append(name)
            print("FAIL", name)
    # formatting: hand-worked
    check("rh half up", rh(2.135, 2) == "2.14" and rh(-2.135, 2) == "-2.14" and rh(0.5, 0) == "1" and rh(216.64999999999998, 1) == "216.7")
    check("toFixed exact", rfix(2.135, 2) == "2.13" and rfix(3.2075, 1) == "3.2")
    check("pct binary value, as ICU rounds it", pct(0.575) == "57%" and pct(0.5) == "50%" and rfmt(0.575 * 100, 0) == "57")  # corrected 2026-09-25: epsilon fudge printed 58
    check("money", money(290) == "$290" and money(10914.5) == "$10,915" and money(None) == "—")
    check("fmt", fmt(188.75, 1) == "188.8" and fmt(2.0, 2) == "2" and fmt(1234567, 0) == "1,234,567" and fmt(None) == "—")
    check("sgn", sgn(26.1, 1) == "+26.1" and sgn(-0.04, 1) == "0.0" and sgn(-2.3, 1) == "−2.3")
    check("ord", ord_(1) == "1st" and ord_(2) == "2nd" and ord_(3) == "3rd" and ord_(11) == "11th" and ord_(22) == "22nd" and ord_(100) == "100th")
    check("rank words", rank_words(1, 99) == "highest of 99" and rank_words(99, 99) == "lowest of 99"
          and rank_words(10, 99) == "10th highest of 99" and rank_words(80, 99) == "20th lowest of 99"
          and rank_words(1, 99, 3) == "tied for highest of 99" and rank_words(1, 1) == "")
    check("half rounds up like the sheet", jsround(12.5) == 13 and jsround(12.4) == 12 and flag_words({"dir": "fell", "own_pct": -12.5, "nb_pct": 15.5, "n": 6}, True) == "fell 13% from 2017 while next door rose a median 16%")
    check("slugify accents and apostrophes", slugify("Do\u00f1a Ana County") == "dona-ana-county" and slugify("Prince George's County") == "prince-georges-county")
    d0 = {"sob": {"last10": {"from": 2016, "to": 2025, "ratio": 0.5634}}, "rent": {"nonirr": {"value": 36.5}}}
    check("read gate: wrong loss ratio period", not read_ok("the loss ratio over 2017-2026 stands at 0.51.", d0, None) and read_ok("the loss ratio over 2016-2025 stands at 0.56.", d0, None))
    check("read gate: half dollar rounded down", not read_ok("rent runs $36 per acre", d0, None) and read_ok("rent runs $37 per acre", d0, None))
    check("read gate: flagged land value", not read_ok("against a census land value of $3,293 per acre", d0, {"dir": "rose"}) and read_ok("against a census land value of $3,293 per acre", d0, None))
    check("slugify", slugify("St. Louis City") == "st-louis-city" and slugify("Lower Ct River Valley") == "lower-ct-river-valley")
    check("recent yield", recent_yield({"last_year": 2025, "hist": {"2021": 200, "2022": 100, "2023": 210, "2024": 220, "2025": 230}}, 2026)["avg"] == 210.0)
    check("recent yield stale", recent_yield({"last_year": 2020, "hist": {str(y): 1 for y in range(2016, 2021)}}, 2026) is None)
    # bars: a gap year is a gap, not a zero
    svg = bars_svg({2000: 5, 2001: 6, 2003: 7}, "t", lambda v: str(v))
    # (corrected 2026-09-25: bars became one path, so count its closed subpaths, not <rect>s)
    d = re.search(r'class="bf" d="([^"]*)"', svg).group(1)
    check("gap not drawn", d.count("z") == 3 and "M" in d)
    check("labels escaped", "<script" not in head("a<script>", "b", "https://x", []).split("<title>")[1].split("</title>")[0])
    # a full build against the real data when present
    if os.path.exists(os.path.join(DATA, "atlas.json")):
        import tempfile
        tmp = tempfile.mkdtemp()
        urls, problems, W = build(".", tmp, quiet=True)
        check("no problems", not problems)
        check("every county has a page", sum(1 for u in urls if u.count("/") >= 5 and not u.endswith("/") and "/states/" not in u and not u.endswith("/data")) == len(W.C))
        check("slugs unique", len(set(W.slug.values())) == len(W.slug))
        for f in ("19169", "51760", "09110", "24510"):
            p = os.path.join(tmp, W.path(f))
            check("page " + f, os.path.exists(p))
            if os.path.exists(p):
                t = open(p, encoding="utf-8").read()
                check(f + " canonical", '<link rel="canonical" href="%s">' % W.url(f) in t)
                check(f + " no nan", "NaN" not in t and "undefined" not in t and "None" not in t.replace("None reported", ""))
                check(f + " json-ld parses", all(json.loads(m) for m in re.findall(r'<script type="application/ld\+json">\s*(.*?)</script>', t, re.S)))
        # CSV columns line up
        rows = list(csv.reader(open(os.path.join(tmp, OUT, "data", "counties.csv"), encoding="utf-8")))
        check("csv header", rows[0] == COLNAMES)
        check("csv width", all(len(r) == len(COLNAMES) for r in rows))
        check("csv rows", len(rows) - 1 == len(W.C))
        # a withheld value is blank in the CSV, never 0
        story = [r for r in rows if r[0] == "19169"][0]
        check("story rent", story[COLNAMES.index("rent_dry_usd_ac")] == "290.0")
        check("story irr blank", story[COLNAMES.index("rent_irr_usd_ac")] == "")
        # flagged land value keeps no change or ratio
        for f in [f for f, c in W.C.items() if get(c, "value", "flag")][:5]:
            r = [x for x in rows if x[0] == f][0]
            check("flag withholds " + f, r[COLNAMES.index("value_cagr_pct")] == "" and r[COLNAMES.index("rent_to_value_pct")] == "")
        check("sitemap", "<loc>%s/%s/data</loc>" % (SITE, OUT) in open(os.path.join(tmp, "sitemap-atlas.xml"), encoding="utf-8").read())
        # a second build over the first changes no byte: the stamp moves only with content
        before = open(os.path.join(tmp, W.path("19169")), "rb").read()
        build(".", tmp, quiet=True)
        check("rebuild is byte-identical", before == open(os.path.join(tmp, W.path("19169")), "rb").read())
        st = json.load(open(os.path.join(tmp, OUT, "data", "page-stamps.json")))
        st["19169"][0] = "000000000000"     # pretend the page's content changed since the last stamp
        st["19169"][1] = "2000-01-01"
        json.dump(st, open(os.path.join(tmp, OUT, "data", "page-stamps.json"), "w"))
        build(".", tmp, quiet=True)
        check("changed content moves the date", ("Figures as of " + W.built) in open(os.path.join(tmp, W.path("19169")), encoding="utf-8").read())
        import shutil
        shutil.rmtree(tmp, ignore_errors=True)
    print("selftest: %s" % ("FAIL (%d)" % len(fails) if fails else "ok"))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
