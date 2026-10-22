#!/usr/bin/env python3
"""build_land_index.py -- the AGSIST farmland sale index (/farmland-index).

Reads the committed county transfer files (data/land/<st>/<fips>.json) through the one
market-sale rule in scripts/build_land_summary.py (imported, never copied) and writes:

  data/land/index.json     the index, county medians, price-to-rent and buyer types (small)
  farmland-index.html      the page (the answer, the chart and the method are baked in;
                           the county table loads from data/land/index.json)

OFFLINE: committed files only.

  python3 scripts/build_land_index.py             build both files
  python3 scripts/build_land_index.py --check     build to memory, compare with the committed files
  python3 scripts/build_land_index.py --selftest  the fixture (test/fixtures/land-index.json) and hand-worked cases

WHICH SALES (every rule here is applied to every quarter alike):
  - A market sale by build_land_summary.county_rows (deed type, whole interest, not related
    parties, not exempt, a price, not dated after the fetch; deeds of one parcel within 31 days
    are one sale).
  - One parcel on the return. Since about October 2025 Illinois' open data stopped giving the
    acres of returns with several parcels (multi-parcel returns with known acres: 941 of 1,434
    in 2018, 26 of 1,201 in 2026), and Wisconsin's file gives them only from 2026. A series that
    mixed them in would change what it measures partway through, so the index uses one-parcel
    returns in every quarter.
  - Known acres, 20 acres or more, and no "with buildings" flag on the return.
  - $1,000 to $40,000 an acre (a farm price band; under it is a misread or a family price the
    deed type did not catch, over it is building lots or development ground).
  - Dated on or after the state's first year and on or before "through", the last day of the
    last full month before the files were fetched (the same rule as the Atlas summaries).

THE INDEX: a time-dummy model, fit by least squares on the log of $/acre:
  log $/acre = county effect + quarter effect + acres band effect (20-40, 40-80, 80-160, 160+)
  The quarter effects carry the index, so a quarter in which more sales came from high-priced
  counties does not read as a price rise. Base: the first year's four quarters average 100.
  Ranges: a county-cluster bootstrap (counties drawn with replacement, BOOT draws, fixed seed),
  the 5th to 95th percentile, called the 90% range.
  - A quarter with fewer than MIN_Q sales is withheld (not fit, not printed).
  - Provisional: the latest quarter always; and any of the last four quarters whose count of
    market sales (all sizes, before the filters above) is under LAG_SHORT of the same quarter a
    year earlier, because deeds still to be filed may change it.
  - A state is published only when it holds up on its own: every quarter from its first year
    to its latest settled quarter has MIN_Q sales, the median 90% range is no wider than
    MAX_RANGE points, and its latest settled quarter is no more than MAX_STALE quarters before
    the latest quarter. The reason is written when a state is held back.

COUNTY MEDIANS: by calendar year, the same sales, withheld under 5 (the site's rule).
PRICE TO RENT: a county's median sale price over its NASS non-irrigated cash rent for the same
  year (latest year with both, 5+ sales), with n and the year.
BUYER TYPE: a pattern on the buyer field, run in memory, one word per sale (individual, trust or
  estate, company, government or other). No name is kept: the row's name is read, classed and
  dropped in the same line. leaks() from build_land_summary checks the output against every name,
  legal description, parcel and document number in the source files before anything is written.
NASS: USDA NASS state cropland value per acre (data/atlas/state-value.json), put on the same
  base year as a separate line. Never blended into the index.
"""
import datetime
import html
import json
import math
import os
import re
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_land_summary as B  # noqa: E402  the one market-sale rule

ROOT = B.ROOT
OUT = os.path.join(ROOT, "data", "land", "index.json")
PAGE = os.path.join(ROOT, "farmland-index.html")
FIXTURE = os.path.join(ROOT, "test", "fixtures", "land-index.json")

STATES = {"IL": {"name": "Illinois", "start": 2018}, "IN": {"name": "Indiana", "start": 2022},
          "WI": {"name": "Wisconsin", "start": 2021}}
MIN_ACRES = 20
PPA_LO, PPA_HI = 1000, 40000
BANDS = (20, 40, 80, 160)          # acres band lower edges
MIN_Q = 100                        # sales a quarter needs to be printed
MIN_N = B.MIN_N                    # county median: 5 sales
PTR_YEARS = 3                      # price to rent: the latest three full years only
LAG_SHORT = 0.85                   # a recent quarter under 85% of the year-before count is provisional
MAX_RANGE = 12.0                   # a state's median 90% range may be no wider than this, in index points
MAX_STALE = 2                      # latest settled quarter at most this many quarters behind the latest
BOOT = 400
SEED = 20181
LO_P, HI_P = 5, 95

ENT = re.compile(r"\b(LLC|L\s?L\s?C|INC|INCORPORATED|CORP|CORPORATION|COMPANY|CO|LP|LLP|LTD|FARMS?|PARTNERSHIP|PARTNERS|HOLDINGS?|INVESTMENTS?|PROPERTIES|PROPERTY|LAND|LANDS|ENTERPRISES?|GROUP|FUND|REIT|ACRES|AGRI\w*|BANK|ASSOCIATES|VENTURES?|CAPITAL|DEVELOPMENT|REALTY|MANAGEMENT)\b")
TRU = re.compile(r"\b(TRUST|TRUSTS|TRUSTEES?|TR|TRST|TRS|REVOCABLE|IRREVOCABLE|ESTATE|EST)\b")
GOV = re.compile(r"\b(STATE OF|COUNTY|CITY OF|VILLAGE|TOWN OF|TOWNSHIP|DISTRICT|UNITED STATES|USA|DEPARTMENT|DEPT|CONSERVATION|UNIVERSITY|COLLEGE|SCHOOL|CHURCH|PARISH|DIOCESE|MINISTRIES|FOUNDATION|DNR|COMMISSION|AUTHORITY|PARK|FOREST PRESERVE|AUDUBON|NATURE)\b")
TYPES = ("individual", "trust", "company", "other")


def buyer_type(name):
    """One word for a buyer field. Reads the name, returns the class; the name goes no further."""
    n = re.sub(r"[.,]", " ", (name or "").upper())
    if not n.strip():
        return None
    if GOV.search(n):
        return "other"
    if TRU.search(n):
        return "trust"
    if ENT.search(n):
        return "company"
    return "individual"


def quarter(iso):
    return "%sQ%d" % (iso[:4], (int(iso[5:7]) - 1) // 3 + 1)


def q_range(q0, q1):
    y, k = int(q0[:4]), int(q0[5])
    out = []
    while True:
        q = "%dQ%d" % (y, k)
        out.append(q)
        if q == q1:
            return out
        k += 1
        if k > 4:
            k, y = 1, y + 1


def band(a):
    i = 0
    for j, e in enumerate(BANDS):
        if a >= e:
            i = j
    return i


def state_rows(files, start, through):
    """(sales, counts): sales are dicts with fips, county, date, q, year, ppa, acres, band, buyer;
    counts are all market sales by quarter (any size), for the filing-lag check."""
    sales, counts, names = [], {}, {}
    for f in files:
        today = (f.get("fetched_utc") or "")[:10]
        names[f["fips"]] = f.get("county")
        for r in B.county_rows(f, today):
            d = str(r.get("date") or "")[:10]
            if len(d) < 10 or d < "%d-01-01" % start or d > through:
                continue
            counts[quarter(d)] = counts.get(quarter(d), 0) + 1
            a = B.num(r.get("acres"))
            if (B.num(r.get("np")) or 1) > 1:
                continue
            if r.get("acUnsure") or not a or a < MIN_ACRES or not B.stat_ok(r):
                continue
            if "BUILDING" in str(r.get("conv") or "").upper():
                continue
            if not (PPA_LO <= r["ppa"] <= PPA_HI):
                continue
            sales.append({"fips": f["fips"], "date": d, "q": quarter(d), "year": int(d[:4]), "ppa": r["ppa"],
                          "acres": a, "band": band(a), "buyer": buyer_type(r.get("grantee"))})
    return sales, counts, names


def design(sales, quarters, fips):
    qi = {q: i for i, q in enumerate(quarters)}
    fi = {f: i for i, f in enumerate(fips)}
    nq, nf, nb = len(quarters), len(fips), len(BANDS)
    X = np.zeros((len(sales), nq + nf - 1 + nb - 1))
    for r, s in enumerate(sales):
        X[r, qi[s["q"]]] = 1.0
        c = fi[s["fips"]]
        if c > 0:
            X[r, nq + c - 1] = 1.0
        if s["band"] > 0:
            X[r, nq + nf - 1 + s["band"] - 1] = 1.0
    y = np.log(np.array([s["ppa"] for s in sales], dtype=float))
    cl = np.array([fi[s["fips"]] for s in sales])
    return X, y, cl


def fit(X, y, w=None):
    if w is not None:
        sw = np.sqrt(w)
        X, y = X * sw[:, None], y * sw
    b, *_ = np.linalg.lstsq(X, y, rcond=None)
    return b


def to_index(bq, base_ix):
    e = np.exp(bq)
    return 100.0 * e / e[base_ix].mean()


def model(sales, quarters, base_year, boot=BOOT, seed=SEED):
    fips = sorted({s["fips"] for s in sales})
    X, y, cl = design(sales, quarters, fips)
    nq = len(quarters)
    base_ix = [i for i, q in enumerate(quarters) if q.startswith(str(base_year))]
    b = fit(X, y)
    point = to_index(b[:nq], base_ix)
    rng = np.random.default_rng(seed)
    draws = []
    for _ in range(boot):
        pick = rng.integers(0, len(fips), len(fips))
        wc = np.bincount(pick, minlength=len(fips)).astype(float)
        w = wc[cl]
        keep = w > 0
        bb = fit(X[keep], y[keep], w[keep])
        draws.append(to_index(bb[:nq], base_ix))
    D = np.array(draws) if draws else np.zeros((0, nq))
    return point, D, fips


def pct(a, p):
    return float(np.percentile(a, p))


def r1(x):
    return None if x is None else round(float(x), 1)


def build_state(st, files, rents, nass, boot=BOOT):
    cfg = STATES[st]
    fetched = max((f.get("fetched_utc") or "") for f in files)
    through = B.month_end_before(fetched).isoformat()
    sales, counts, names = state_rows(files, cfg["start"], through)
    qs = q_range("%dQ1" % cfg["start"], quarter(through))
    nq = {q: sum(1 for s in sales if s["q"] == q) for q in qs}
    kept = [q for q in qs if nq[q] >= MIN_Q]
    fitted = [s for s in sales if s["q"] in kept]
    out = {"state": st, "name": cfg["name"], "fetched": fetched[:10], "through": through, "start": cfg["start"],
           "n_sales": len(fitted), "n_counties": len({s["fips"] for s in fitted})}
    base_ok = all(q in kept for q in qs if q.startswith(str(cfg["start"])))
    if not kept or not base_ok:
        out["held"] = "fewer than %d sales in a quarter of %d, the base year" % (MIN_Q, cfg["start"])
        return out, sales, names
    point, D, _ = model(fitted, kept, cfg["start"], boot=boot)
    # provisional quarters: the latest, and any of the last four short of the same quarter a year earlier
    prov = {qs[-1]}
    lag = []
    for q in qs[-4:]:
        qa = "%d%s" % (int(q[:4]) - 1, q[4:])
        if counts.get(qa):
            ratio = counts.get(q, 0) / counts[qa]
            lag.append({"q": q, "n": counts.get(q, 0), "q_year_before": qa, "n_year_before": counts[qa], "ratio": round(ratio, 2)})
            if ratio < LAG_SHORT:
                prov.add(q)
    rows = []
    for q in qs:
        r = {"q": q, "n": nq[q]}
        if q in kept:
            i = kept.index(q)
            r.update({"ix": r1(point[i]), "lo": r1(pct(D[:, i], LO_P)) if len(D) else None, "hi": r1(pct(D[:, i], HI_P)) if len(D) else None})
            if q in prov:
                r["prov"] = 1
        else:
            r["why"] = "fewer than %d sales" % MIN_Q
        rows.append(r)
    out["quarters"] = rows
    out["lag"] = lag
    settled = [q for q in kept if q not in prov]
    widths = [r["hi"] - r["lo"] for r in rows if r.get("ix") is not None and r.get("lo") is not None]
    out["median_range"] = r1(np.median(widths)) if widths else None
    # year-ago change at the latest settled quarter
    if settled:
        L = settled[-1]
        La = "%d%s" % (int(L[:4]) - 1, L[4:])
        out["latest"] = L
        if La in kept:
            i, j = kept.index(L), kept.index(La)
            ch = (point[i] / point[j] - 1) * 100
            dch = (D[:, i] / D[:, j] - 1) * 100
            out["yoy"] = {"q": L, "vs": La, "pct": r1(ch), "lo": r1(pct(dch, LO_P)), "hi": r1(pct(dch, HI_P))}
    # the headline: the latest four settled quarters against the four before them (one quarter
    # holds 200 to 600 sales, so a single quarter's change is mostly noise)
    def four(endq):
        e = qs.index(endq)
        win, prev = qs[e - 3:e + 1], qs[e - 7:e - 3]
        if e < 7 or any(q not in kept for q in win + prev):
            return None
        a, b_ = [kept.index(q) for q in win], [kept.index(q) for q in prev]
        ch = (point[a].mean() / point[b_].mean() - 1) * 100
        dch = (D[:, a].mean(axis=1) / D[:, b_].mean(axis=1) - 1) * 100
        return {"from": win[0], "to": win[-1], "prev_from": prev[0], "prev_to": prev[-1], "ix": r1(point[a].mean()),
                "ix_prev": r1(point[b_].mean()), "pct": r1(ch), "lo": r1(pct(dch, LO_P)), "hi": r1(pct(dch, HI_P)),
                "n": sum(nq[q] for q in win), "n_prev": sum(nq[q] for q in prev)}
    if settled:
        y4 = four(settled[-1])
        if y4:
            out["y4"] = y4
    if kept[-1] in prov:
        y4p = four(kept[-1])
        if y4p:
            y4p["prov"] = 1
            out["y4_first_look"] = y4p
    # the latest (provisional) quarter's change, shown as a first look only
    P = kept[-1]
    Pa = "%d%s" % (int(P[:4]) - 1, P[4:])
    if P in prov and Pa in kept:
        i, j = kept.index(P), kept.index(Pa)
        dch = (D[:, i] / D[:, j] - 1) * 100
        out["first_look"] = {"q": P, "vs": Pa, "ix": r1(point[i]), "pct": r1((point[i] / point[j] - 1) * 100),
                             "lo": r1(pct(dch, LO_P)), "hi": r1(pct(dch, HI_P)), "n": nq[P]}
    # annual index (full years only: four kept quarters) beside NASS
    ann = []
    years = sorted({int(q[:4]) for q in qs})
    nv = (nass or {}).get("cropland") or {}
    base_nass = nv.get(str(cfg["start"]))
    for y in years:
        ix = [kept.index(q) for q in qs if q.startswith(str(y)) and q in kept]
        a = {"y": y}
        if len(ix) == 4 and not any(kept[i] in prov for i in ix):
            a["ix"] = r1(point[ix].mean())
            dd = D[:, ix].mean(axis=1)
            a["lo"], a["hi"] = r1(pct(dd, LO_P)), r1(pct(dd, HI_P))
        rawv = sorted(s_["ppa"] for s_ in fitted if s_["year"] == y)
        if len(rawv) >= MIN_N:
            a["raw_med"], a["n"] = med(rawv), len(rawv)
        if base_nass and nv.get(str(y)):
            a["nass"] = r1(nv[str(y)] / base_nass * 100)
            a["nass_usd"] = int(nv[str(y)])
        ann.append(a)
    out["annual"] = ann
    # does it hold up on its own
    why = []
    missing = [q for q in qs if q not in prov and q not in kept]
    if missing:
        why.append("%d settled quarter%s with fewer than %d sales (%s)" % (len(missing), "" if len(missing) == 1 else "s", MIN_Q, ", ".join(missing[:4])))
    if out["median_range"] is not None and out["median_range"] > MAX_RANGE:
        why.append("the typical 90%% range is %.1f points wide, more than %.0f" % (out["median_range"], MAX_RANGE))
    if settled and qs.index(settled[-1]) < len(qs) - 1 - MAX_STALE:
        why.append("the latest settled quarter is %s; later quarters are still filling in" % settled[-1])
    if why:
        out["held"] = "; ".join(why)
    # county medians by year, price to rent, buyer types
    out["counties"] = county_table(sales, names, years, rents, through)
    out["buyers"] = buyer_table(sales, years)
    return out, sales, names


def med(v):
    v = sorted(v)
    return B.js_round(B.quantile(v, 0.5)) if v else None


def county_table(sales, names, years, rents, through):
    by = {}
    for s in sales:
        by.setdefault(s["fips"], []).append(s)
    out = []
    rent_by = {c["fips"]: c for c in rents or []}
    for fips in sorted(names):
        ss = by.get(fips, [])
        row = {"fips": fips, "name": names[fips], "y": {}}
        for y in years:
            v = [s["ppa"] for s in ss if s["year"] == y]
            row["y"][str(y)] = [med(v), len(v)] if len(v) >= MIN_N else [None, len(v)]
        rr = ((rent_by.get(fips) or {}).get("rent") or {}).get("nonirr") or {}
        full = [y for y in years if "%d-12-31" % y <= through]
        # the same age rule as the Atlas rent tiles: a rent more than three survey years old is not used
        for y in sorted(full, reverse=True)[:PTR_YEARS]:
            v = [s["ppa"] for s in ss if s["year"] == y]
            if len(v) >= MIN_N and rr.get(str(y)):
                m = med(v)
                row["ptr"] = {"y": y, "x": round(m / rr[str(y)], 1), "rent": rr[str(y)], "med": m, "n": len(v)}
                break
        if "ptr" not in row:
            row["ptr_why"] = "no year since %d with both a NASS rent and %d+ sales" % (sorted(full)[-PTR_YEARS], MIN_N) if len(full) >= PTR_YEARS else "too few years"
        out.append(row)
    return out


def buyer_table(sales, years):
    out = []
    for y in years:
        ss = [s for s in sales if s["year"] == y]
        k = [s["buyer"] for s in ss if s["buyer"]]
        row = {"y": y, "n": len(k), "blank": len(ss) - len(k)}
        if len(k) >= 50:
            for t in TYPES:
                row[t] = round(100.0 * sum(1 for x in k if x == t) / len(k), 1)
        out.append(row)
    return out


# ---------------------------------------------------------------- assemble and check

def build_all(boot=BOOT):
    nass = load_json(os.path.join(ROOT, "data", "atlas", "state-value.json")) or {}
    out = {"built": None, "rule": {"min_acres": MIN_ACRES, "ppa_band": [PPA_LO, PPA_HI], "one_parcel": True, "no_buildings": True,
                                   "bands": list(BANDS), "min_q": MIN_Q, "min_n": MIN_N, "lag_short": LAG_SHORT,
                                   "max_range": MAX_RANGE, "max_stale": MAX_STALE, "boot": boot, "range": [LO_P, HI_P]},
           "states": {}}
    files_all = []
    for st in STATES:
        files = B.load_state(st)
        if not files:
            continue
        files_all += files
        rents = (load_json(os.path.join(ROOT, "data", "cash-rent", st + ".json")) or {}).get("counties") or []
        s, _, _ = build_state(st, files, rents, (nass.get("states") or {}).get(st), boot=boot)
        if s.get("held"):
            # a state that does not hold up on its own prints no index number at all
            s = {k: s[k] for k in ("state", "name", "start", "fetched", "through", "n_sales", "n_counties", "median_range", "held", "lag") if k in s}
        out["states"][st] = s
    out["built"] = max((s.get("fetched") or "") for s in out["states"].values())
    out["nass_source"] = nass.get("source")
    out["nass_item"] = (nass.get("items") or {}).get("cropland")
    return out, files_all


def load_json(p):
    try:
        with open(p, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return None


def dump(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n"


# ---------------------------------------------------------------- the page

URL = "https://agsist.com/farmland-index"
MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]


def esc(x):
    return html.escape(str(x if x is not None else ""), quote=True)


def qwords(q, long=False):
    k = int(q[5])
    m = MONTH if long else MON
    return "%s to %s %s" % (m[3 * k - 3], m[3 * k - 1], q[:4])


def span_words(q0, q1):
    k0, k1 = int(q0[5]), int(q1[5])
    return "%s %s to %s %s" % (MONTH[3 * k0 - 3], q0[:4], MONTH[3 * k1 - 1], q1[:4])


def day_words(iso):
    d = datetime.date.fromisoformat(iso[:10])
    return "%s %d, %d" % (MON[d.month - 1], d.day, d.year)


def pct_words(p):
    if p is None:
        return ""
    if abs(p) < 0.05:
        return "no change"
    return "%s%% %s" % (fmt1(abs(p)), "higher" if p > 0 else "lower")


def fmt1(x):
    return ("%.1f" % x)


def signed(p):
    return ("+" if p > 0 else "") + fmt1(p) + "%"


def money(x):
    return "${:,.0f}".format(x)


def comma(n):
    return "{:,}".format(n)


def nav_blocks():
    """The static header and footer exactly as scripts/inject_static_nav.py writes them,
    copied from a page it maintains (the same way scripts/cash_bid_index.py does)."""
    src = open(os.path.join(ROOT, "grain-emc.html"), encoding="utf-8").read()
    h = re.search(r"<!-- static-nav:header.*?<!-- /static-nav:header -->", src, re.S).group(0)
    f = re.search(r"<!-- static-nav:footer.*?<!-- /static-nav:footer -->", src, re.S).group(0)
    fonts = re.search(r"<!-- static-nav:fonts.*?<!-- /static-nav:fonts -->", src, re.S).group(0)
    early = re.search(r"<script>/\* agsist-theme-early.*?</script><script>/\* agsist-ga-guard.*?</script>", src, re.S).group(0)
    return h, f, fonts, early


def share_card():
    path = os.path.join(ROOT, "img", "og", "farmland-index.jpg")
    if not os.path.exists(path):
        return "https://agsist.com/img/og/agsist.jpg", "AGSIST farmland sale index"
    import hashlib
    with open(path, "rb") as fh:
        v = hashlib.sha1(fh.read()).hexdigest()[:8]
    return "https://agsist.com/img/og/farmland-index.jpg?v=" + v, "AGSIST farmland sale index: Illinois farm sales, county mix held fixed."


def chart_svg(s):
    """Quarterly index with its 90% range, and NASS cropland value as its own line."""
    qs = [r for r in s["quarters"]]
    pts = [r for r in qs if r.get("ix") is not None]
    W, H, L, R, T, Bm = 640, 320, 50, 12, 14, 40
    vals = [r["lo"] for r in pts] + [r["hi"] for r in pts] + [a["nass"] for a in s["annual"] if a.get("nass")]
    lo = math.floor(min(vals) / 10) * 10
    hi = math.ceil(max(vals) / 10) * 10
    n = len(qs)
    x = lambda i: L + (W - L - R) * (i + 0.5) / n
    y = lambda v: T + (H - T - Bm) * (hi - v) / (hi - lo)
    ix = {r["q"]: i for i, r in enumerate(qs)}
    out = ['<svg class="li-chart" viewBox="0 0 %d %d" role="img" aria-labelledby="li-ch-t li-ch-d" preserveAspectRatio="xMinYMin meet">' % (W, H),
           '<title id="li-ch-t">%s farmland sale index by quarter, %d = 100, with NASS cropland value on the same base</title>' % (esc(s["name"]), s["start"])]
    last = [a for a in s["annual"] if a.get("ix")][-1]
    out.append('<desc id="li-ch-d">The index runs from %s in %s to %s in %s. NASS cropland value went from 100 in %d to %s in %d.</desc>' % (
        fmt1(pts[0]["ix"]), qwords(pts[0]["q"]), fmt1(pts[-1]["ix"]), qwords(pts[-1]["q"]), s["start"],
        fmt1([a for a in s["annual"] if a.get("nass")][-1]["nass"]), [a for a in s["annual"] if a.get("nass")][-1]["y"]))
    for v in range(lo, hi + 1, 10 if hi - lo <= 80 else 20):
        out.append('<line x1="%d" x2="%d" y1="%.1f" y2="%.1f" class="li-grid"/><text x="%d" y="%.1f" text-anchor="end" class="li-ax">%d</text>' % (L, W - R, y(v), y(v), L - 6, y(v) + 4, v))
    yrs = sorted({int(r["q"][:4]) for r in qs})
    for yv in yrs:
        i0 = ix.get("%dQ1" % yv)
        if i0 is None:
            continue
        xx = L + (W - L - R) * i0 / n
        out.append('<line x1="%.1f" x2="%.1f" y1="%d" y2="%d" class="li-tick"/>' % (xx, xx, H - Bm, H - Bm + 5))
        lab = str(yv) if yv == yrs[0] or yv % 2 == 0 else "&#8217;" + str(yv)[2:]
        out.append('<text x="%.1f" y="%d" class="li-ax">%s</text>' % (xx + 2, H - Bm + 24, lab))
    # range band (settled and provisional), then the line
    top = " ".join("%.1f,%.1f" % (x(ix[r["q"]]), y(r["hi"])) for r in pts)
    bot = " ".join("%.1f,%.1f" % (x(ix[r["q"]]), y(r["lo"])) for r in reversed(pts))
    out.append('<polygon points="%s %s" class="li-band"/>' % (top, bot))
    settled = [r for r in pts if not r.get("prov")]
    out.append('<polyline points="%s" class="li-line"/>' % " ".join("%.1f,%.1f" % (x(ix[r["q"]]), y(r["ix"])) for r in settled))
    prov = [r for r in pts if r.get("prov")]
    if prov and settled:
        seg = [settled[-1]] + prov
        out.append('<polyline points="%s" class="li-line li-prov"/>' % " ".join("%.1f,%.1f" % (x(ix[r["q"]]), y(r["ix"])) for r in seg))
        for r in prov:
            out.append('<circle cx="%.1f" cy="%.1f" r="4" class="li-dot-prov"/>' % (x(ix[r["q"]]), y(r["ix"])))
    # NASS: one value a year, drawn between the second and third quarters
    nass = [(a["y"], a["nass"]) for a in s["annual"] if a.get("nass")]
    np_ = []
    for yv, v in nass:
        i2 = ix.get("%dQ2" % yv)
        if i2 is None:
            continue
        np_.append((L + (W - L - R) * (i2 + 1) / n, y(v)))
    out.append('<polyline points="%s" class="li-nass"/>' % " ".join("%.1f,%.1f" % p for p in np_))
    for p in np_:
        out.append('<rect x="%.1f" y="%.1f" width="7" height="7" class="li-nass-pt"/>' % (p[0] - 3.5, p[1] - 3.5))
    out.append("</svg>")
    return "".join(out)


def quarter_table(s):
    rows = []
    for r in reversed(s["quarters"]):
        if r.get("ix") is None:
            rows.append('<tr><th scope="row">%s</th><td data-l="Sales">%s</td><td colspan="2" class="li-why">withheld: %s</td></tr>' % (qwords(r["q"]), comma(r["n"]), esc(r["why"])))
            continue
        tag = ' <span class="li-tag">provisional</span>' if r.get("prov") else ""
        rows.append('<tr><th scope="row">%s%s</th><td data-l="Sales">%s</td><td data-l="Index">%s</td><td data-l="90%% range">%s to %s</td></tr>' % (
            qwords(r["q"]), tag, comma(r["n"]), fmt1(r["ix"]), fmt1(r["lo"]), fmt1(r["hi"])))
    return ('<div class="li-tw" tabindex="0" role="region" aria-label="Index by quarter (scrolls sideways)"><table class="li-t li-q"><caption>%s index by quarter, %d = 100</caption>'
            '<thead><tr><th scope="col">Quarter</th><th scope="col">Sales</th><th scope="col">Index</th><th scope="col">90%% range</th></tr></thead><tbody>%s</tbody></table></div>') % (
        esc(s["name"]), s["start"], "".join(rows))


def annual_table(s):
    rows = []
    for a in s["annual"]:
        if a["y"] == s["start"] and a.get("ix") is not None:
            ixc = '<td data-l="Sale index">100.0 <span class="li-rng">(the base year)</span></td>'
        elif a.get("ix") is not None:
            ixc = '<td data-l="Sale index">%s <span class="li-rng">(%s to %s)</span></td>' % (fmt1(a["ix"]), fmt1(a["lo"]), fmt1(a["hi"]))
        else:
            ixc = '<td data-l="Sale index" class="li-why">not a full settled year yet</td>'
        nc = ('<td data-l="NASS cropland">%s <span class="li-rng">(%s an acre)</span></td>' % (fmt1(a["nass"]), money(a["nass_usd"]))) if a.get("nass") else '<td data-l="NASS cropland" class="li-why">not published</td>'
        rows.append('<tr><th scope="row">%d</th>%s%s</tr>' % (a["y"], ixc, nc))
    return ('<div class="li-tw" tabindex="0" role="region" aria-label="Sale index and NASS by year (scrolls sideways)"><table class="li-t"><caption>By year, both on %d = 100</caption>'
            '<thead><tr><th scope="col">Year</th><th scope="col">Sale index (90%% range)</th><th scope="col">NASS cropland value</th></tr></thead><tbody>%s</tbody></table></div>') % (s["start"], "".join(rows))


def buyer_table_html(s):
    rows = []
    for b in s["buyers"]:
        if b.get("individual") is None:
            rows.append('<tr><th scope="row">%d</th><td colspan="4" class="li-why">withheld: %d sales with a buyer field, under 50</td></tr>' % (b["y"], b["n"]))
            continue
        rows.append('<tr><th scope="row">%d%s</th><td data-l="Sales">%s</td><td data-l="Individuals">%s%%</td><td data-l="Trusts, estates">%s%%</td><td data-l="Companies">%s%%</td><td data-l="Public, other">%s%%</td></tr>' % (
            b["y"], ' <span class="li-tag">through %s</span>' % day_words(s["through"]) if str(b["y"]) == s["through"][:4] else "",
            comma(b["n"]), fmt1(b["individual"]), fmt1(b["trust"]), fmt1(b["company"]), fmt1(b["other"])))
    return ('<div class="li-tw" tabindex="0" role="region" aria-label="Who bought, by year (scrolls sideways)"><table class="li-t li-b"><caption>Who bought, share of index sales</caption>'
            '<thead><tr><th scope="col">Year</th><th scope="col">Sales</th><th scope="col">Individuals</th><th scope="col">Trusts, estates</th><th scope="col">Companies</th><th scope="col">Public, other</th></tr></thead><tbody>%s</tbody></table></div>') % "".join(rows)


CSS = """
.li{max-width:860px;margin:0 auto;padding:1rem 1rem 3rem}
.li .breadcrumb{font-size:.8rem;margin:0 0 .5rem}
.li h1{font-size:clamp(1.4rem,4.3vw,2rem);line-height:1.2;margin:0 0 .3rem;color:var(--text)}
.li h2{font-size:1.25rem;line-height:1.3;margin:2rem 0 .5rem;color:var(--text)}
.li h3{font-size:1.05rem;line-height:1.3;margin:1.4rem 0 .4rem;color:var(--text)}
.li p,.li li{font-size:.97rem;line-height:1.6;color:var(--text-dim)}
.li a{color:var(--link,var(--brand));text-underline-offset:2px;text-decoration:underline}
.li b{color:var(--text)}
.li .by{font-size:.82rem;color:var(--text-muted);margin:0 0 .8rem}
.li-ans{border:1px solid var(--border);border-left:4px solid var(--green);border-radius:8px;background:var(--surface);padding:.8rem .95rem;margin:.6rem 0 1rem}
.li-ans p{margin:.2rem 0 .5rem}
.li-ans .li-big{font-size:1.08rem;color:var(--text);line-height:1.5}
.li-tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.55rem;margin:.6rem 0 0}
.li-tile{border:1px solid var(--border);border-radius:8px;padding:.5rem .65rem;background:var(--bg,transparent)}
.li-tile b{display:block;font-family:'JetBrains Mono',monospace;font-size:1.25rem;line-height:1.25}
.li-tile span{display:block;font-size:.76rem;color:var(--text-muted);line-height:1.35}
@media (min-width:700px){.li-tiles{grid-template-columns:repeat(4,minmax(0,1fr))}}
.li-fig{margin:1rem 0;padding:.6rem .4rem;border:1px solid var(--border);border-radius:8px;background:var(--surface)}
.li-fig figcaption{font-size:.8rem;color:var(--text-muted);padding:.3rem .4rem 0;line-height:1.45}
.li-chart{width:100%;max-width:720px;height:auto;display:block;margin:0 auto}
.li-ax{font-family:'JetBrains Mono',monospace;font-size:11px;fill:var(--text-muted)}
.li-grid{stroke:var(--border);stroke-width:1}
.li-tick{stroke:var(--text-muted);stroke-width:1}
.li-band{fill:var(--green);opacity:.18}
.li-line{fill:none;stroke:var(--green);stroke-width:2.5;stroke-linejoin:round}
.li-prov{stroke-dasharray:5 4}
.li-dot-prov{fill:var(--surface);stroke:var(--green);stroke-width:2}
.li-nass{fill:none;stroke:#c9853a;stroke-width:2;stroke-dasharray:2 3}
.li-nass-pt{fill:#c9853a}
.li-key{display:flex;flex-wrap:wrap;gap:.3rem 1rem;font-size:.8rem;color:var(--text-dim);padding:.2rem .4rem 0;margin:0;list-style:none}
.li-key li{font-size:.8rem;display:flex;align-items:center;gap:.35rem}
.li-sw{display:inline-block;width:18px;height:0;border-top:3px solid var(--green)}
.li-sw.b{height:10px;border:0;background:var(--green);opacity:.25}
.li-sw.n{border-top:3px dotted #c9853a}
.li-tw{overflow-x:auto;margin:.8rem 0;border:1px solid var(--border);border-radius:8px}
.li-t{border-collapse:collapse;width:100%;font-size:.84rem}
.li-t caption{text-align:left;font-weight:700;color:var(--text);padding:.55rem .7rem}
.li-t th,.li-t td{padding:.4rem .6rem;border-top:1px solid var(--border);text-align:right;color:var(--text-dim)}
.li-t th[scope=row],.li-t thead th:first-child{text-align:left;color:var(--text)}
.li-t thead th{font-family:'JetBrains Mono',monospace;font-size:.7rem;letter-spacing:.04em;color:var(--text-muted);font-weight:700}
.li-why{text-align:left!important;color:var(--text-muted)!important;font-style:italic}
.li-rng{color:var(--text-muted);font-size:.78rem}
.li-tag{font-family:'JetBrains Mono',monospace;font-size:.66rem;color:var(--text-muted);border:1px solid var(--border);border-radius:4px;padding:0 .3rem;white-space:nowrap;font-weight:400}
.li-find{display:flex;gap:.5rem;align-items:center;margin:.4rem 0}
.li-find label{font-size:.85rem;color:var(--text-dim)}
.li-find input{flex:1;max-width:260px;padding:.5rem .6rem;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);font-size:1rem}
.li-c td.li-why{white-space:normal}
.li-c tr.li-more{display:none}
.li-all .li-c tr.li-more{display:table-row}
.li-more-b{margin:.2rem 0 .6rem;padding:.55rem .9rem;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--link,var(--brand));font-size:.9rem;cursor:pointer}
.li-all .li-more-b{display:none}
.li-note{font-size:.84rem!important;color:var(--text-muted)!important}
.li-faq dt{font-weight:700;color:var(--text);margin:1rem 0 .25rem}
.li-faq dd{margin:0;color:var(--text-dim);line-height:1.6;font-size:.95rem}
.li-src li{font-size:.9rem}
.li-dl a{display:inline-block;padding:.55rem .9rem;border:1px solid var(--border);border-radius:6px;text-decoration:none!important}
@media (max-width:600px){
.li-tw{overflow:visible;border:0}
.li-t{display:block}
.li-t caption{display:block;padding:.2rem 0 .4rem}
.li-t thead{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.li-t tbody{display:block}
.li-t tr{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:.6rem;margin:0 0 .45rem;padding:.45rem .65rem;border:1px solid var(--border);border-radius:8px;background:var(--surface)}
.li-t th,.li-t td{border:0;padding:.15rem 0;text-align:left}
.li-t th[scope=row]{grid-column:1/-1;font-size:.95rem;padding-bottom:.25rem}
.li-t td[data-l]::before{content:attr(data-l);display:block;font-family:'JetBrains Mono',monospace;font-size:.66rem;letter-spacing:.03em;color:var(--text-muted);font-weight:400}
.li-q td.li-why,.li-b td.li-why{grid-column:1/-1}
.li-t td.li-why::before{font-style:normal}
.li-c tr.li-more{display:none}
.li-all .li-c tr.li-more{display:grid}
.li-ax{font-size:19px}
}
"""

COUNTY_JS = r"""
(function(){
  var box=document.getElementById('li-counties'); if(!box||!window.fetch) return;
  var esc=function(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});};
  var usd=function(v){return '$'+Math.round(v).toLocaleString('en-US');};
  fetch('/data/land/index.json?v=__V__').then(function(r){if(!r.ok) throw 0; return r.json();}).then(function(d){
    var s=d.states&&d.states.IL; if(!s||!s.counties) throw 0;
    var yrs=Object.keys(s.counties[0].y).sort(); var full=yrs.filter(function(y){return y+'-12-31'<=s.through;});
    var y1=full[full.length-1], y0=full[full.length-2], yp=yrs[yrs.length-1]>y1?yrs[yrs.length-1]:null;
    var cell=function(c,y,l){var v=c.y[y]; if(!v) return '<td data-l="'+l+'" class="li-why">no sales</td>';
      if(v[0]==null) return '<td data-l="'+l+'" class="li-why">'+(v[1]?'withheld: '+v[1]+' sale'+(v[1]==1?'':'s')+', under 5':'no sales')+'</td>';
      return '<td data-l="'+l+'">'+usd(v[0])+' <span class="li-rng">('+v[1]+')</span></td>';};
    var head='<thead><tr><th scope="col">County</th><th scope="col">'+y0+' median (sales)</th><th scope="col">'+y1+' median (sales)</th>'+(yp?'<th scope="col">'+yp+' so far</th>':'')+'<th scope="col">Price to rent</th></tr></thead>';
    var rows=s.counties.map(function(c,i){
      var p=c.ptr?'<td data-l="Price to rent">'+c.ptr.x.toFixed(1)+'x <span class="li-rng">('+c.ptr.y+', '+usd(c.ptr.rent)+' rent, '+c.ptr.n+' sales)</span></td>':'<td data-l="Price to rent" class="li-why">'+esc(c.ptr_why)+'</td>';
      return '<tr'+(i>=12?' class="li-more"':'')+' data-n="'+esc(c.name.toLowerCase())+'"><th scope="row">'+esc(c.name)+'</th>'+cell(c,y0,y0+' median')+cell(c,y1,y1+' median')+(yp?cell(c,yp,yp+' so far'):'')+p+'</tr>';}).join('');
    box.innerHTML='<div class="li-find"><label for="li-q">Find a county</label><input id="li-q" type="search" autocomplete="off" placeholder="McLean"></div>'+
      '<div class="li-tw" tabindex="0" role="region" aria-label="Illinois counties (scrolls sideways)"><table class="li-t li-c"><caption>Illinois counties: median sale price an acre</caption>'+head+'<tbody>'+rows+'</tbody></table></div>'+
      (s.counties.length>12?'<button type="button" class="li-more-b">Show all '+s.counties.length+' counties</button>':'');
    var mb=box.querySelector('.li-more-b'); if(mb) mb.addEventListener('click',function(){box.classList.add('li-all');});
    var q=document.getElementById('li-q');
    q.addEventListener('input',function(){var v=q.value.trim().toLowerCase(); if(v) box.classList.add('li-all'); box.querySelectorAll('tbody tr').forEach(function(tr){tr.hidden=v&&tr.getAttribute('data-n').indexOf(v)<0;});});
  }).catch(function(){box.innerHTML='<p class="li-note">The county table did not load. The numbers are in <a href="/data/land/index.json">the data file</a>.</p>';});
})();
"""


def answer_bits(s):
    y4, fl = s.get("y4"), s.get("y4_first_look")
    same = y4["lo"] < 0 < y4["hi"]
    verb = "about the same as" if same else ("more than" if y4["pct"] > 0 else "less than")
    chg = ("%s than in" % pct_words(y4["pct"])) if abs(y4["pct"]) >= 0.05 else "no different from"
    big = ("%s farm ground that sold from %s brought %s a year earlier. The index stood at <b>%s</b>, %s the 12 months before "
           "(90%% range: %s to %s). %d = 100, so sale prices ran about %d%% above %d.") % (
        s["name"], span_words(y4["from"], y4["to"]), verb, fmt1(y4["ix"]), chg,
        pct_words(y4["lo"]), pct_words(y4["hi"]), s["start"], round(y4["ix"] - 100), s["start"])
    first = ""
    if fl:
        k = int(fl["to"][5])
        first = ("First look, still filling in: the 12 months through %s %s read %s, %s than a year earlier (90%% range %s to %s), "
                 "with %s sales so far in %s." % (MONTH[3 * k - 1], fl["to"][:4], fmt1(fl["ix"]), pct_words(fl["pct"]),
                                                  pct_words(fl["lo"]), pct_words(fl["hi"]), comma(s["first_look"]["n"]) if s.get("first_look") else "?",
                                                  qwords(fl["to"], True)))
    return big, first, same


def faq_items(s, others):
    y4 = s["y4"]
    ann = [a for a in s["annual"] if a.get("ix") is not None and a.get("raw_med")]
    a0, a1 = ann[0], ann[-1]
    lagq = s["lag"][-1] if s.get("lag") else None
    nass_last = [a for a in s["annual"] if a.get("nass")][-1]
    held = "; ".join("%s: %s" % (o["name"], o["held"]) for o in others) or "none"
    items = [
        ("What does the farmland sale index measure?",
         "What Illinois farm ground has sold for, quarter by quarter, from the state's own record of every sale (the PTAX-203 transfer declarations on Illinois' open data portal). "
         "It counts arm's-length sales of bare land, 20 acres or more, one parcel per sale, and compares each county with itself, so a quarter when more of the "
         "sales came from high-priced counties does not read as a price rise. The four quarters of %d average 100." % s["start"]),
        ("Why not just use the median sale price?",
         "Because the median moves with which counties happened to sell. From %d to %d the plain median of these sales went from %s to %s an acre (%s), "
         "while the index, which holds the county mix and tract size fixed, went from %s to %s (%s)." % (
             a0["y"], a1["y"], money(a0["raw_med"]), money(a1["raw_med"]), signed((a1["raw_med"] / a0["raw_med"] - 1) * 100),
             fmt1(a0["ix"]), fmt1(a1["ix"]), signed(a1["ix"] - a0["ix"]) if a0["ix"] == 100 else signed((a1["ix"] / a0["ix"] - 1) * 100))),
        ("How is this different from the USDA number?",
         "USDA NASS publishes one survey value a year for all Illinois cropland (%s an acre in %d), from what farmers and landowners report their ground is worth, "
         "sold or not. This index comes from sales that actually closed. The two are shown on the same base, side by side, and never mixed. Illinois' farm managers "
         "and appraisers (ISPFMRA) run a third, survey-based report; its numbers are not on this page." % (money(nass_last["nass_usd"]), nass_last["y"])),
        ("Why is the latest quarter marked provisional?",
         "Deeds are filed after the sale, so the newest months fill in late. %s Until a quarter's count of sales catches up to the same quarter a year earlier "
         "(85%% or more), and always for the latest quarter, the number is marked provisional and can change." % (
             ("For %s, %s market sales are on file so far, against %s for the same months a year earlier (%d%%)." % (
                 qwords(lagq["q"], True), comma(lagq["n"]), comma(lagq["n_year_before"]), round(lagq["ratio"] * 100))) if lagq else "")),
        ("How sure is the number?",
         "Each quarter carries a 90%% range from re-running the index on counties drawn at random, with replacement, %d times. The typical quarter's range is "
         "%s points wide, so a move of a few points from one quarter to the next is mostly noise. The headline uses four quarters together for that reason; "
         "its range for the latest 12 months is %s to %s." % (BOOT, fmt1(s["median_range"]), pct_words(y4["lo"]), pct_words(y4["hi"]))),
        ("Why are Indiana and Wisconsin not shown?",
         "Each state has to hold up on its own before it gets an index: enough sales every quarter, a range no wider than %d points in the typical quarter, "
         "and recent quarters on file. Held back this run: %s." % (MAX_RANGE, held)),
        ("Are buyer or seller names on this page?",
         "No. The public record carries names, but this page and its data file hold only counts, prices and acres. Buyer type (individual, trust or estate, "
         "company, public or other) comes from a word pattern on the buyer field, read in memory; no name is written anywhere."),
    ]
    return items


def page_html(data):
    s = data["states"]["IL"]
    others = [o for k, o in data["states"].items() if k != "IL" and o.get("held")]
    head_nav, foot_nav, fonts, early = nav_blocks()
    og_img, og_alt = share_card()
    big, first, same = answer_bits(s)
    y4 = s["y4"]
    nass_last = [a for a in s["annual"] if a.get("nass")][-1]
    title = "Illinois farmland sale index: what farm ground sold for"
    desc = ("What Illinois farm ground sold for, %s: index %s (%d = 100), %s than a year earlier. Bare-land sales, county mix held fixed.") % (
        span_words(y4["from"], y4["to"]), fmt1(y4["ix"]), s["start"], pct_words(y4["pct"]))
    faqs = faq_items(s, others)
    v = data["built"].replace("-", "")
    ld = {"@context": "https://schema.org", "@graph": [
        {"@type": "Dataset", "@id": URL + "#dataset", "name": "AGSIST Illinois farmland sale index",
         "description": "Quarterly index of Illinois farmland sale prices per acre from PTAX-203 transfer declarations: arm's-length bare-land sales of 20 acres or more, one parcel, county and tract size held fixed by a time-dummy model, %d = 100, with county-cluster bootstrap ranges, annual county medians, price-to-rent multiples and buyer-type shares." % s["start"],
         "url": URL, "creator": {"@type": "Organization", "name": "AGSIST", "url": "https://agsist.com/"},
         "author": {"@type": "Person", "name": "Sigurd Lindquist", "jobTitle": "Certified Crop Adviser (CCA)", "url": "https://agsist.com/about"},
         "license": "https://agsist.com/terms", "isAccessibleForFree": True, "inLanguage": "en-US",
         "keywords": ["farmland values", "Illinois farmland", "land sales", "farmland price index", "cash rent"],
         "spatialCoverage": {"@type": "Place", "name": "Illinois, United States"},
         "temporalCoverage": "%d-01-01/%s" % (s["start"], s["through"]), "dateModified": data["built"],
         "isBasedOn": ["https://data.illinois.gov/d/it54-y4c6", "https://quickstats.nass.usda.gov/"],
         "variableMeasured": ["farmland sale price index", "median sale price per acre", "price to cash rent multiple", "buyer type share"],
         "distribution": [{"@type": "DataDownload", "encodingFormat": "application/json", "contentUrl": "https://agsist.com/data/land/index.json"}]},
        {"@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in faqs]},
        {"@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": "https://agsist.com/"},
            {"@type": "ListItem", "position": 2, "name": "Farmland Atlas", "item": "https://agsist.com/farmland-atlas"},
            {"@type": "ListItem", "position": 3, "name": "Farmland sale index", "item": URL}]}]}
    ld_json = json.dumps(ld, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    tiles = "".join('<div class="li-tile"><b>%s</b><span>%s</span></div>' % (a, b) for a, b in [
        (fmt1(y4["ix"]), "index, %s (%d = 100)" % (span_words(y4["from"], y4["to"]), s["start"])),
        (signed(y4["pct"]), "vs the 12 months before (range %s to %s)" % (signed(y4["lo"]), signed(y4["hi"]))),
        (comma(y4["n"]), "sales in those 12 months, %d counties in the whole series" % s["n_counties"]),
        (money(nass_last["nass_usd"]), "USDA NASS Illinois cropland value, %d (its own survey, not a sale)" % nass_last["y"]),
    ])
    lag = s.get("lag") or []
    lag_txt = "; ".join("%s: %s on file vs %s a year earlier (%d%%)" % (qwords(l["q"]), comma(l["n"]), comma(l["n_year_before"]), round(l["ratio"] * 100)) for l in lag)
    held_txt = "".join("<li><b>%s</b> (sales from %d, %s sales in %d counties): held back because %s.</li>" % (
        esc(o["name"]), o["start"], comma(o["n_sales"]), o["n_counties"], esc(o["held"])) for o in others)
    faq_html = "".join("<dt>%s</dt><dd>%s</dd>" % (esc(q), esc(a)) for q, a in faqs)
    first_html = ('<p>%s</p>' % esc(first)) if first else ""
    return f"""<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#111a0a">
  <title>{esc(title)} | AGSIST</title>
  <meta name="description" content="{esc(desc)}">
  <meta name="author" content="Sigurd Lindquist">
  <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">
  <link rel="canonical" href="{URL}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="AGSIST">
  <meta property="og:locale" content="en_US">
  <meta property="og:title" content="{esc(title)}">
  <meta property="og:description" content="{esc(desc)}">
  <meta property="og:url" content="{URL}">
  <meta property="og:image" content="{og_img}">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="{esc(og_alt)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="{og_img}">
  <meta name="twitter:title" content="{esc(title)}">
  <meta name="twitter:description" content="{esc(desc)}">
  {early}
  <script>window.dataLayer=window.dataLayer||[];function gtag(){{dataLayer.push(arguments);}}gtag('js',new Date());gtag('config','G-6KXCTD5Z9H');</script>
  {fonts}
  <link rel="preload" href="/components/styles.css?v=26" as="style">
  <link rel="stylesheet" href="/components/styles.css?v=26">
  <link rel="icon" href="/img/favicon.ico" sizes="32x32">
  <link rel="icon" type="image/svg+xml" href="/img/icon.svg">
  <style>{CSS}</style>
  <script type="application/ld+json">{ld_json}</script>
</head>
<body>
  <a href="#main" class="skip">Skip to content</a>
  <div id="site-header">
{head_nav}
</div>
  <main id="main" tabindex="-1">
    <article class="li">
      <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/">Home</a> &rarr; <a href="/farmland-atlas">Farmland Atlas</a> &rarr; Farmland sale index</nav>
      <h1>Illinois farmland sale index</h1>
      <p class="by">Sales through {esc(day_words(s["through"]))}. Built from the state's file of {esc(day_words(s["fetched"]))}.</p>
      <section class="li-ans" aria-label="The answer">
        <p class="li-big">{big}</p>
        {first_html}
        <div class="li-tiles">{tiles}</div>
      </section>
      <figure class="li-fig">
        {chart_svg(s)}
        <ul class="li-key"><li><span class="li-sw"></span>Sale index by quarter</li><li><span class="li-sw b"></span>90% range</li><li><span class="li-sw n"></span>USDA NASS cropland value, once a year</li></ul>
        <figcaption>Illinois, {s["start"]} = 100. The dashed end and hollow dot are provisional. NASS is its own survey, drawn on the same base for comparison only.</figcaption>
      </figure>
      <h2 id="years">By year, beside USDA</h2>
      {annual_table(s)}
      <p class="li-note">Since {s["start"]} the sales have risen faster than the NASS survey value. The survey asks what ground is worth; the index is what sold, and buyers of bare ground that comes up for sale are not a sample of all cropland.</p>
      <h2 id="counties">By county</h2>
      <p>Median price an acre of the same sales, by calendar year, with the number of sales. Under 5 sales, no median. Price to rent is the median sale price over the county's USDA NASS non-irrigated cash rent for the same year.</p>
      <div id="li-counties"><p class="li-note">Loading the county table from <a href="/data/land/index.json">the data file</a>.</p></div>
      <h2 id="buyers">Who bought</h2>
      <p>Share of the index sales by the kind of buyer on the deed. "Companies" includes a family's own farm LLC or corporation, so a rising share is not the same as outside money.</p>
      {buyer_table_html(s)}
      <h2 id="quarters">Every quarter</h2>
      <details><summary>Show the {len(s["quarters"])} quarters</summary>{quarter_table(s)}</details>
      <h2 id="method">How it is built, and its limits</h2>
      <ul class="li-method">
        <li><b>Which sales.</b> Every Illinois transfer declaration for farm parcels that passes the same market-sale rule the Farmland Atlas uses: a deed type that normally carries a market price (no quit claims, gifts, court or sheriff deeds, trades), a whole interest, not between related parties, not exempt. Then: one parcel on the return, known acres, 20 acres or more, no "with buildings" flag, and {money(PPA_LO)} to {money(PPA_HI)} an acre. {comma(s["n_sales"])} sales from {s["start"]} through {esc(day_words(s["through"]))}.</li>
        <li><b>Why one parcel.</b> Since about October 2025 the state's open data stopped giving acres for returns that cover several parcels, so including them would change what the index measures partway through. Every quarter uses one-parcel sales alike.</li>
        <li><b>County mix held fixed.</b> The index comes from a model of each sale's log price an acre with a county effect, a quarter effect and a tract-size band (20 to 40, 40 to 80, 80 to 160, 160+ acres). The quarter effects are the index. A county that sells more often in one quarter does not move it.</li>
        <li><b>Ranges.</b> The index is re-run {BOOT} times on counties drawn at random with replacement; the 90% range is the middle 90% of those runs. Quarters with fewer than {MIN_Q} sales are withheld.</li>
        <li><b>Filing lag.</b> Deeds are filed after the sale. Market sales on file for the last four quarters against the same quarter a year earlier: {esc(lag_txt)}. The latest quarter is always provisional, and so is any recent quarter under 85% of its year-earlier count.</li>
        <li><b>What it is not.</b> Not an appraisal of any farm. Quality of the ground (soil productivity, drainage, tillable share) is not in the record, so a quarter when better ground sold reads higher. Auctions, listed and private sales all count alike.</li>
        <li><b>Other states.</b> {"<ul>" + held_txt + "</ul>" if held_txt else "None this run."}</li>
      </ul>
      <p class="li-dl"><a href="/data/land/index.json">Download the data (JSON)</a></p>
      <h2 id="faq">Questions</h2>
      <dl class="li-faq">{faq_html}</dl>
      <h2 id="sources">Sources</h2>
      <ul class="li-src">
        <li>Illinois Department of Revenue, MyDec real estate transfer declarations (Form PTAX-203), <a href="https://data.illinois.gov/d/it54-y4c6">Illinois open data portal</a>.</li>
        <li>USDA NASS, Land Values (state cropland value per acre) and Cash Rents (county non-irrigated rent), <a href="https://quickstats.nass.usda.gov/">Quick Stats</a>.</li>
        <li>Illinois Society of Professional Farm Managers and Rural Appraisers, <a href="https://www.ispfmra.org/">ISPFMRA</a>, for its own land value survey (not used in these numbers).</li>
        <li>Built by <code>scripts/build_land_index.py</code>. Recorded sales for one county: the <a href="/farmland-atlas">Farmland Atlas</a> county pages. Questions or corrections: <a href="mailto:sig@agsist.com">sig@agsist.com</a>.</li>
      </ul>
    </article>
    <div data-signup-ask="Email me the farm markets and my top local bid every morning" data-source="page:farmland-index"></div>
    <p class="by-end" style="font-size:.78rem;color:var(--text-muted);margin:1.2rem 0 .4rem">Made by <a href="/about">Sigurd Lindquist, CCA</a>, Chetek, Wisconsin.</p>
  </main>
  <div id="site-footer">
{foot_nav}
</div>
  <script>{COUNTY_JS.replace("__V__", v)}</script>
  <script src="/components/loader.js?v=19" defer></script>
  <script src="/components/next-links.js?v=3" defer></script>
</body>
</html>
"""


def main(argv):
    if "--selftest" in argv:
        return selftest()
    check = "--check" in argv
    data, files = build_all()
    text = dump(data)
    page = page_html(data)
    bad = 0
    lk = B.leaks(text, files) + B.leaks(page, files)
    if lk:
        print("FAIL: output carries a name, legal description, parcel or document number from the source (%d found); nothing written" % len(lk), file=sys.stderr)
        return 1
    if "—" in text + page:
        print("FAIL: an em dash in the output; nothing written", file=sys.stderr)
        return 1
    if len(text.encode()) > 150 * 1024:
        print("FAIL: data/land/index.json is %.0f KB, over 150 KB" % (len(text.encode()) / 1024), file=sys.stderr)
        return 1
    for path, body in ((OUT, text), (PAGE, page)):
        if check:
            old = open(path, encoding="utf-8").read() if os.path.exists(path) else None
            if old != body:
                print("FAIL %s is not current; run python3 scripts/build_land_index.py" % os.path.relpath(path, ROOT), file=sys.stderr)
                bad += 1
            else:
                print("ok   %s current" % os.path.relpath(path, ROOT))
            continue
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(body)
        print("wrote %s, %.1f KB" % (os.path.relpath(path, ROOT), len(body.encode()) / 1024))
    for st, s in data["states"].items():
        if s.get("held"):
            print("%s held back: %s" % (st, s["held"]))
        else:
            y4 = s["y4"]
            print("%s: %d sales, %d counties; 12 months %s to %s: %s (%s, range %s to %s)" % (
                st, s["n_sales"], s["n_counties"], y4["from"], y4["to"], y4["ix"], y4["pct"], y4["lo"], y4["hi"]))
    return 1 if bad else 0


def backfit(sales, quarters, iters=3000, tol=1e-12):
    """The same model solved a different way (alternating means, no matrix), for the selftest."""
    y = [math.log(x["ppa"]) for x in sales]
    q = {k: 0.0 for k in quarters}
    c = {x["fips"]: 0.0 for x in sales}
    b = {x["band"]: 0.0 for x in sales}
    for _ in range(iters):
        delta = 0.0
        for key, eff in (("q", q), ("fips", c), ("band", b)):
            acc = {}
            for x, yy in zip(sales, y):
                r = yy - (q[x["q"]] if key != "q" else 0) - (c[x["fips"]] if key != "fips" else 0) - (b[x["band"]] if key != "band" else 0)
                acc.setdefault(x[key], []).append(r)
            for k, v in acc.items():
                m = sum(v) / len(v)
                delta = max(delta, abs(m - eff[k]))
                eff[k] = m
        if delta < tol:
            break
    return np.array([q[k] for k in quarters])


def selftest():
    global MIN_Q
    fails = []

    def ck(name, ok):
        if not ok:
            fails.append(name)
            print("FAIL", name)

    fx = load_json(FIXTURE)
    files = fx["files"]
    save = MIN_Q
    try:
        MIN_Q = 5
        sales, counts, names = state_rows(files, 2018, "2019-12-31")
        ck("fixture: 78 index sales from 300 real rows", len(sales) == 78)
        qn = {}
        for x in sales:
            qn[x["q"]] = qn.get(x["q"], 0) + 1
        ck("fixture: sales by quarter", qn == {"2018Q1": 7, "2018Q2": 12, "2018Q3": 9, "2018Q4": 9, "2019Q1": 15, "2019Q2": 11, "2019Q3": 6, "2019Q4": 9})
        ck("fixture: market sales by quarter (the filing-lag count)", counts == {"2018Q1": 23, "2018Q2": 26, "2018Q3": 17, "2018Q4": 19, "2019Q1": 28, "2019Q2": 28, "2019Q3": 14, "2019Q4": 25})
        bt = {}
        for x in sales:
            bt[x["buyer"]] = bt.get(x["buyer"], 0) + 1
        ck("fixture: buyer types", bt == {"individual": 64, "company": 9, "trust": 5})
        ck("every index sale: 20+ acres, in the price band, one parcel", all(x["acres"] >= MIN_ACRES and PPA_LO <= x["ppa"] <= PPA_HI for x in sales))
        ck("no name kept on a sale row", all(set(x) == {"fips", "date", "q", "year", "ppa", "acres", "band", "buyer"} for x in sales))
        qs = q_range("2018Q1", "2019Q4")
        point, D, _ = model(sales, qs, 2018, boot=60)
        ck("base year averages 100", abs(point[:4].mean() - 100) < 1e-9)
        bf = backfit(sales, qs)
        alt = 100 * np.exp(bf) / np.exp(bf[:4]).mean()
        ck("least squares and alternating means agree (max %.2e)" % float(np.abs(alt - point).max()), float(np.abs(alt - point).max()) < 1e-6)
        ck("fixture index, 2019Q4", round(float(point[-1]), 1) == FIX_LAST)
        p2, D2, _ = model(sales, qs, 2018, boot=60)
        ck("bootstrap repeats with its seed", np.array_equal(D, D2))
        lo, hi = np.percentile(D, LO_P, axis=0), np.percentile(D, HI_P, axis=0)
        ck("ranges hold the point (after the base year)", all(lo[i] <= point[i] <= hi[i] for i in range(4, len(qs))))
        rents = [{"fips": "17009", "rent": {"nonirr": {"2019": 200.0}}}, {"fips": "17061", "rent": {"nonirr": {"2015": 180.0}}}]
        st, _, _ = build_state("IL", files, rents, {"cropland": {"2018": 7280.0, "2019": 7300.0}}, boot=40)
        ck("the latest quarter is provisional", [r for r in st["quarters"] if r["q"] == "2019Q4"][0].get("prov") == 1)
        q3 = [r for r in st["quarters"] if r["q"] == "2019Q3"][0]
        ck("a recent quarter under 85% of its year-earlier count is provisional (14 vs 17)", q3.get("prov") == 1)
        ck("NASS on the same base, its own field", [a.get("nass") for a in st["annual"]] == [100.0, 100.3])
        cty = {c["fips"]: c for c in st["counties"]}
        ck("price to rent from the same year", cty["17009"]["ptr"]["y"] == 2019 and cty["17009"]["ptr"]["rent"] == 200.0)
        ck("an old rent is not used", "ptr" not in cty["17061"] and "ptr_why" in cty["17061"])
        ck("county median withheld under 5, the count kept", all((v[0] is None) == (v[1] < MIN_N) for c in st["counties"] for v in c["y"].values()))
        text = dump(st)
        ck("no synthetic name, legal, parcel or document token in the output", "SYN" not in text and not B.leaks(text, files))
        ck("the leak check finds a planted name", bool(B.leaks(text + files[0]["rows"][0][files[0]["cols"].index("grantee")], files)))
        MIN_Q = 8
        st2, _, _ = build_state("IL", files, rents, None, boot=10)
        ck("a base-year quarter under the minimum holds the whole state back", "held" in st2 and "base year" in st2["held"])
    finally:
        MIN_Q = save
    for name, want in (("SMITH JOHN & MARY", "individual"), ("DOE FAMILY FARMS LLC", "company"), ("JONES REVOCABLE TRUST", "trust"),
                       ("ESTATE OF A B", "trust"), ("COUNTY OF CHAMPAIGN", "other"), ("ST MARYS CHURCH", "other"),
                       ("ACME AG INC.", "company"), ("", None), ("BROWN, CO", "company"), ("TRUSTEE OF THE X TRUST LLC", "trust")):
        ck("buyer type %r" % name, buyer_type(name) == want)
    ck("quarters", quarter("2026-09-30") == "2026Q3" and quarter("2026-10-01") == "2026Q4" and q_range("2025Q3", "2026Q2") == ["2025Q3", "2025Q4", "2026Q1", "2026Q2"])
    ck("acres bands", [band(a) for a in (20, 39.9, 40, 80, 159, 160, 640)] == [0, 0, 1, 2, 2, 3, 3])
    # the committed page and data
    data = load_json(OUT)
    if data:
        page = page_html(data)
        ck("page: no em dash", "\u2014" not in page and "&mdash;" not in page)
        ck("page: byline only at the end", page.index("Sigurd Lindquist, CCA") > page.index('id="sources"'))
        ck("page: no sponsor slot", not re.search(r"data-sponsor|ag-sponsor|sponsor-slot", page))
        ck("page: withheld quarters and held states say why", "withheld" in page or all(r.get("ix") is not None for r in data["states"]["IL"]["quarters"]))
        ck("page: a Dataset and a FAQPage", '"@type":"Dataset"' in page and '"@type":"FAQPage"' in page)
        ck("data file under 150 KB", len(dump(data).encode()) < 150 * 1024)
    print("selftest: %s" % ("FAIL (%d)" % len(fails) if fails else "ok"))
    return 1 if fails else 0


FIX_LAST = 107.5               # the fixture's 2019Q4 index, frozen from the first run (alternating means agrees)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
