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
        for y in sorted(full, reverse=True):
            v = [s["ppa"] for s in ss if s["year"] == y]
            if len(v) >= MIN_N and rr.get(str(y)):
                m = med(v)
                row["ptr"] = {"y": y, "x": round(m / rr[str(y)], 1), "rent": rr[str(y)], "med": m, "n": len(v)}
                break
        if "ptr" not in row:
            row["ptr_why"] = "no year with both a NASS rent and %d+ sales" % MIN_N
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
