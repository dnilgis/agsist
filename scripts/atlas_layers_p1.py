#!/usr/bin/env python3
"""
atlas_layers_p1.py — the second set of Farmland Atlas layers, one function per
raw file, called by build_farmland_atlas.py. Same rules as the first set: a
missing value is a status string that says why; every gate is a named
constant printed on the page; nothing is averaged across counties of
different size; no layer is combined with another into a score.

  sob_layer      data/atlas/raw/sob.json      the loss ratio the cause-of-loss file could not give
  value_layer    data/atlas/raw/value.json    census land value and gross rent-to-value
  crp_layer      data/atlas/raw/crp.json      CRP acres, share of cropland, acres expiring
  drought_layer  data/atlas/raw/drought.json  weeks a year in D2+ since 2000
  energy_layer   data/atlas/raw/energy.json   solar, wind, storage MW on the ground and proposed
  wells_layer    data/atlas/raw/wells.json    Nebraska wells, Kansas water rights

  national_p1, summarize_p1, seed_p1 add these to the Atlas summary, the map
  record and the static seed block.
"""

import statistics

NOT_YET = "not yet measured: this layer publishes after the first data run"
MIN_RATIO_PREMIUM = 1_000_000      # dollars of premium before a loss ratio is printed
MIN_RATIO_YEARS = 5                # years in a period before a period ratio is printed
MIN_CRP_ACRES = 100                # enrolled acres before a share is printed
FULL_YEAR_MAPS = 40                # weekly maps in a year before it counts as a full year (52 or 53 when complete)
HALF_YEAR_WEEKS = 26
PERIODS = [("1989-1999", 1989, 1999), ("2000-2009", 2000, 2009), ("2010-2019", 2010, 2019)]


def _ratio(indem, prem):
    return round(indem / prem, 2) if prem and prem >= MIN_RATIO_PREMIUM else None


# ---------------------------------------------------------------- RMA Summary of Business

def sob_layer(s, latest_year, ran=False, partial_year=None, col_total_indemnity=None):
    """s: {"years": {y: {liab, prem, indem, policies}}, "corn": {y: {...}}, "prf": {y: {...}}}
    from fetch_atlas_sob.py. Premium here is total premium on every policy,
    paid or not, so indemnity / premium is the loss ratio as RMA defines it.
    col_total_indemnity: the cause-of-loss file's total for the same county,
    so the two RMA files can be checked against each other on the page."""
    if not s:
        return {"status": "withheld: RMA Summary of Business has no rows for this county"} if ran else {"status": NOT_YET}
    years = {int(k): v for k, v in (s.get("years") or {}).items()}
    if not years:
        return {"status": "withheld: RMA Summary of Business has no rows for this county"}
    out = {"status": "ok", "first_year": min(years), "last_year": max(years),
           "partial_year": partial_year if partial_year and partial_year in years else None}
    ti = sum(v.get("indem", 0) for v in years.values())
    tp = sum(v.get("prem", 0) for v in years.values())
    out["total_indemnity"] = round(ti)
    out["total_premium"] = round(tp)
    out["loss_ratio_all"] = _ratio(ti, tp)
    if out["loss_ratio_all"] is None:
        out["loss_ratio_all_status"] = f"withheld: under ${MIN_RATIO_PREMIUM:,} of premium since {min(years)}"
    per_year = {}
    over_one = 0
    worst = None
    for y in sorted(years):
        v = years[y]
        r = _ratio(v.get("indem", 0), v.get("prem", 0))
        per_year[y] = {"indem": round(v.get("indem", 0)), "prem": round(v.get("prem", 0)), "liab": round(v.get("liab", 0)),
                       "policies": int(round(v.get("policies", 0))), "ratio": r}
        if r is not None:
            if r > 1:
                over_one += 1
            if worst is None or r > worst["ratio"]:
                worst = {"year": y, "ratio": r}
    out["per_year"] = per_year
    out["years_with_ratio"] = sum(1 for v in per_year.values() if v["ratio"] is not None)
    out["years_over_one"] = over_one
    out["worst_year"] = worst
    latest = per_year.get(max(years))
    out["latest"] = {"year": max(years), "liability": latest["liab"], "premium": latest["prem"], "policies": latest["policies"]}
    periods = PERIODS + [(f"2020-{latest_year}", 2020, latest_year)] if latest_year else PERIODS
    out["periods"] = {}
    for label, a, b in periods:
        ys = [y for y in years if a <= y <= b]
        pi = sum(years[y].get("indem", 0) for y in ys)
        pp = sum(years[y].get("prem", 0) for y in ys)
        rec = {"years_present": len(ys), "indemnity": round(pi), "premium": round(pp)}
        if len(ys) < MIN_RATIO_YEARS:
            rec["ratio"] = None
            rec["ratio_status"] = f"withheld: {len(ys)} of the period's years present (gate {MIN_RATIO_YEARS})"
        else:
            rec["ratio"] = _ratio(pi, pp)
            if rec["ratio"] is None:
                rec["ratio_status"] = f"withheld: under ${MIN_RATIO_PREMIUM:,} of premium in the period"
        out["periods"][label] = rec
    # last ten crop years, the horizon a lender or an agent actually looks at
    last10 = [y for y in years if y > max(years) - 10]
    i10 = sum(years[y].get("indem", 0) for y in last10)
    p10 = sum(years[y].get("prem", 0) for y in last10)
    out["last10"] = {"from": min(last10), "to": max(last10), "years": len(last10), "indemnity": round(i10), "premium": round(p10), "ratio": _ratio(i10, p10)}
    corn = {int(k): v for k, v in (s.get("corn") or {}).items()}
    if corn:
        ci = sum(v.get("indem", 0) for v in corn.values())
        cp = sum(v.get("prem", 0) for v in corn.values())
        out["corn"] = {"indemnity": round(ci), "premium": round(cp), "ratio": _ratio(ci, cp), "years": len(corn)}
    prf = {int(k): v for k, v in (s.get("prf") or {}).items()}
    out["prf_excluded"] = {"indemnity": round(sum(v.get("indem", 0) for v in prf.values())),
                           "premium": round(sum(v.get("prem", 0) for v in prf.values()))}
    if col_total_indemnity is not None and ti:
        # the cause-of-loss file and the summary of business are two RMA
        # products; they should agree to within their own revisions
        out["cause_of_loss_check"] = {"col_indemnity": round(col_total_indemnity), "sob_indemnity": round(ti),
                                      "col_over_sob": round(col_total_indemnity / ti, 3)}
    return out


# ---------------------------------------------------------------- land value

def _cagr(a, b, years):
    if not a or not b or a <= 0 or b <= 0 or years <= 0:
        return None
    return round(((b / a) ** (1 / years) - 1) * 100, 1)


def value_layer(v, rent_nonirr=None, ran=False):
    """v: {"years": {"2012": $, "2017": $, "2022": $}} (None = suppressed).
    rent_nonirr: {year: $/acre} non-irrigated cash rent series for the county."""
    if not v:
        return {"status": "withheld: the census publishes no land value row for this county"} if ran else {"status": NOT_YET}
    years = {int(k): x for k, x in (v.get("years") or {}).items()}
    if not years:
        return {"status": "withheld: the census publishes no land value row for this county"}
    out = {"status": "ok", "values": {}}
    for y in sorted(years):
        out["values"][y] = {"per_acre": round(years[y]) if years[y] is not None else None,
                            **({} if years[y] is not None else {"status": "suppressed: NASS published (D) for this county"})}
    latest = max(y for y in years)
    out["latest_year"] = latest
    out["latest"] = out["values"][latest]["per_acre"]
    prev = [y for y in years if y < latest and years[y] is not None]
    if out["latest"] is not None and prev:
        p = max(prev)
        out["change"] = {"from_year": p, "to_year": latest, "from": round(years[p]), "to": out["latest"],
                         "pct": round((out["latest"] / years[p] - 1) * 100, 1), "cagr_pct": _cagr(years[p], years[latest], latest - p)}
    rent = {int(k): x for k, x in (rent_nonirr or {}).items() if x}
    if out["latest"] is None:
        out["rent_to_value"] = {"status": "withheld: land value suppressed for the census year"}
    elif latest in rent:
        out["rent_to_value"] = {"year": latest, "rent": rent[latest], "value": out["latest"],
                                "pct": round(rent[latest] / out["latest"] * 100, 2)}
    else:
        out["rent_to_value"] = {"status": f"withheld: NASS published no non-irrigated cash rent for this county in {latest}"}
    return out


# ---------------------------------------------------------------- CRP

def crp_layer(c, harvested_cropland=None, ran=False, this_fy=None):
    """c: {"acres": {year: acres}, "expiring": {fy: acres}}.
    harvested_cropland: census 2022 harvested cropland acres, for the share."""
    if not c:
        return {"status": "withheld: FSA lists no CRP enrollment for this county"} if ran else {"status": NOT_YET}
    acres = {int(k): x for k, x in (c.get("acres") or {}).items()}
    exp = {int(k): x for k, x in (c.get("expiring") or {}).items()}
    if not acres and not exp:
        return {"status": "withheld: FSA lists no CRP enrollment for this county"}
    out = {"status": "ok"}
    if acres:
        latest = max(acres)
        peak = max(acres, key=acres.get)
        out["latest"] = {"year": latest, "acres": round(acres[latest])}
        out["peak"] = {"year": peak, "acres": round(acres[peak])}
        out["change_from_peak_pct"] = round((acres[latest] / acres[peak] - 1) * 100, 1) if acres[peak] else None
        out["first_year"] = min(acres)
        out["series"] = {y: round(a) for y, a in sorted(acres.items())}
        if acres[latest] < MIN_CRP_ACRES:
            out["share_of_cropland"] = {"status": f"withheld: under {MIN_CRP_ACRES} acres enrolled"}
        elif harvested_cropland:
            # share of the land in crops + CRP: how much of the county's arable base sits in the program
            out["share_of_cropland"] = {"pct": round(acres[latest] / (acres[latest] + harvested_cropland) * 100, 1),
                                        "basis": "CRP acres ÷ (CRP acres + harvested cropland, 2022 census)"}
        else:
            out["share_of_cropland"] = {"status": "withheld: no 2022 harvested cropland for this county"}
    else:
        out["latest"] = {"status": "withheld: no enrollment history row"}
    if exp:
        out["expiring"] = {fy: round(a) for fy, a in sorted(exp.items())}
        fys = sorted(exp)
        start = this_fy if this_fy else fys[0]
        window = [fy for fy in fys if start <= fy <= start + 2]
        tot = sum(exp[fy] for fy in window)
        out["expiring_next3"] = {"from": start, "to": start + 2, "acres": round(tot)}
        enrolled = acres.get(max(acres)) if acres else None
        if enrolled and enrolled >= MIN_CRP_ACRES:
            out["expiring_next3"]["share_of_enrolled_pct"] = round(min(tot / enrolled, 1.0) * 100, 1)
    else:
        out["expiring"] = None
    return out


# ---------------------------------------------------------------- drought

def drought_layer(d, half=50.0, ran=False, this_year=None):
    """d: {year: {"maps": n, "d2": n, "d3": n}} from fetch_atlas_drought.py."""
    if not d:
        return {"status": "withheld: no Drought Monitor rows for this county"} if ran else {"status": NOT_YET}
    years = {int(k): v for k, v in d.items()}
    full = {y: v for y, v in years.items() if v.get("maps", 0) >= FULL_YEAR_MAPS}
    if not full:
        return {"status": f"withheld: no year with {FULL_YEAR_MAPS} weekly maps"}
    out = {"status": "ok", "half_pct": half, "first_year": min(full), "last_full_year": max(full),
           "series": {y: {"d2": v["d2"], "d3": v["d3"], "maps": v["maps"]} for y, v in sorted(years.items())}}
    maps = sum(v["maps"] for v in full.values())
    d2 = sum(v["d2"] for v in full.values())
    d3 = sum(v["d3"] for v in full.values())
    out["weeks"] = {"counted": maps, "d2": d2, "d3": d3, "share_d2_pct": round(d2 / maps * 100, 1), "share_d3_pct": round(d3 / maps * 100, 1)}
    worst = max(full, key=lambda y: (full[y]["d2"], full[y]["d3"]))
    out["worst_year"] = {"year": worst, "d2": full[worst]["d2"], "d3": full[worst]["d3"]}
    out["years_half_or_more"] = sorted(y for y, v in full.items() if v["d2"] >= HALF_YEAR_WEEKS)
    last5 = sorted(full)[-5:]
    out["last5"] = {"from": last5[0], "to": last5[-1], "d2": sum(full[y]["d2"] for y in last5), "d3": sum(full[y]["d3"] for y in last5),
                    "maps": sum(full[y]["maps"] for y in last5)}
    if this_year and this_year in years and this_year not in full:
        out["partial_year"] = {"year": this_year, **years[this_year]}
    return out


# ---------------------------------------------------------------- energy

def energy_layer(e, ran=False, year=None):
    """e: {"operable": {solar, wind, storage, other, plants, first_solar, first_wind},
           "proposed": {solar, wind, storage, other, earliest_year}} or None.
    Form 860 covers every plant of 1 MW or more, so a county with no record has
    none of that size; that is a zero, not a hole, once the file has been read."""
    if e is None and not ran:
        return {"status": NOT_YET}
    if e is None:
        return {"status": "ok", "year": year, "none_reported": True,
                "operable": {"solar": 0.0, "wind": 0.0, "storage": 0.0, "other": 0.0, "plants": 0, "first_solar": None, "first_wind": None},
                "proposed": {"solar": 0.0, "wind": 0.0, "storage": 0.0, "other": 0.0, "earliest_year": None}}
    o, p = e.get("operable") or {}, e.get("proposed") or {}
    return {"status": "ok", "year": year, "none_reported": False,
            "operable": {k: round(o.get(k) or 0.0, 1) for k in ("solar", "wind", "storage", "other")} | {"plants": o.get("plants", 0), "first_solar": o.get("first_solar"), "first_wind": o.get("first_wind")},
            "proposed": {k: round(p.get(k) or 0.0, 1) for k in ("solar", "wind", "storage", "other")} | {"earliest_year": p.get("earliest_year")}}


# ---------------------------------------------------------------- wells and rights

def wells_layer(state, ne=None, ks=None, ran=False):
    if not ran:
        return {"status": NOT_YET}
    if state == "NE":
        if not ne:
            return {"status": "withheld: no registered well placed in this county"}
        ne = dict(ne)
        for k in ("depth_median_ft", "static_median_ft"):
            if ne.get(k) is not None:
                ne[k] = round(ne[k], 1)
        return {"status": "ok", "register": "Nebraska DNR registered wells", **ne}
    if state == "KS":
        if not ks:
            return {"status": "withheld: no WIMAS point of diversion placed in this county"}
        return {"status": "ok", "register": "Kansas DWR WIMAS points of diversion", **ks}
    return {"status": f"withheld: no open state well or water-right register read for {state} yet"}


# ---------------------------------------------------------------- across the Atlas

def national_p1(counties, this_fy=None):
    out = {}
    # loss ratio: dollars summed, one ratio
    ti = tp = 0.0
    n = 0
    by_period = {}
    over_one = 0
    for c in counties.values():
        s = c.get("sob") or {}
        if s.get("status") != "ok":
            continue
        n += 1
        ti += s["total_indemnity"]
        tp += s["total_premium"]
        if s.get("loss_ratio_all") is not None and s["loss_ratio_all"] > 1:
            over_one += 1
        for k, p in (s.get("periods") or {}).items():
            bp = by_period.setdefault(k, {"indemnity": 0.0, "premium": 0.0})
            bp["indemnity"] += p["indemnity"]
            bp["premium"] += p["premium"]
    if n and tp:
        out["sob"] = {"counties": n, "total_indemnity": round(ti), "total_premium": round(tp), "loss_ratio": round(ti / tp, 2),
                      "counties_over_one": over_one,
                      "periods": {k: {"indemnity": round(v["indemnity"]), "premium": round(v["premium"]),
                                      "ratio": round(v["indemnity"] / v["premium"], 2) if v["premium"] else None} for k, v in sorted(by_period.items())}}
    # value
    vals = [c["value"]["latest"] for c in counties.values() if (c.get("value") or {}).get("status") == "ok" and c["value"].get("latest")]
    rtv = [c["value"]["rent_to_value"]["pct"] for c in counties.values() if (c.get("value") or {}).get("status") == "ok" and (c["value"].get("rent_to_value") or {}).get("pct") is not None]
    if vals:
        yr = max(c["value"]["latest_year"] for c in counties.values() if (c.get("value") or {}).get("status") == "ok")
        out["value"] = {"year": yr, "counties": len(vals), "median_per_acre": round(statistics.median(vals)),
                        "min_per_acre": round(min(vals)), "max_per_acre": round(max(vals)),
                        "counties_with_rent_to_value": len(rtv),
                        "median_rent_to_value_pct": round(statistics.median(rtv), 2) if rtv else None,
                        "rent_to_value_under_2pct": sum(1 for x in rtv if x < 2), "rent_to_value_over_4pct": sum(1 for x in rtv if x > 4)}
    # CRP
    crp = [c["crp"] for c in counties.values() if (c.get("crp") or {}).get("status") == "ok"]
    if crp:
        acres = sum(x["latest"]["acres"] for x in crp if x.get("latest", {}).get("acres"))
        exp3 = sum(x["expiring_next3"]["acres"] for x in crp if x.get("expiring_next3"))
        shares = [x["share_of_cropland"]["pct"] for x in crp if (x.get("share_of_cropland") or {}).get("pct") is not None]
        yrs = [x["latest"]["year"] for x in crp if x.get("latest", {}).get("year")]
        out["crp"] = {"counties": len(crp), "year": max(yrs) if yrs else None, "acres": acres, "expiring_next3_acres": exp3,
                      "expiring_window": next((x["expiring_next3"] for x in crp if x.get("expiring_next3")), {}).get("from"),
                      "counties_over_10pct": sum(1 for s in shares if s >= 10), "counties_with_share": len(shares)}
    # drought: county-weeks by year, so the worst year across the Atlas is a count of county-weeks, not an average
    cw = {}
    n_d = 0
    half_latest = 0
    latest_full = None
    for c in counties.values():
        d = c.get("drought") or {}
        if d.get("status") != "ok":
            continue
        n_d += 1
        for y, v in d["series"].items():
            if v["maps"] >= FULL_YEAR_MAPS:
                cw[y] = cw.get(y, 0) + v["d2"]
        lf = d["last_full_year"]
        latest_full = lf if latest_full is None else max(latest_full, lf)
    if n_d:
        for c in counties.values():
            d = c.get("drought") or {}
            if d.get("status") == "ok" and d["series"].get(latest_full, {}).get("d2", 0) >= HALF_YEAR_WEEKS:
                half_latest += 1
        worst = max(cw, key=cw.get)
        out["drought"] = {"counties": n_d, "half_pct": next(c["drought"]["half_pct"] for c in counties.values() if (c.get("drought") or {}).get("status") == "ok"),
                          "county_weeks_d2_by_year": dict(sorted(cw.items())), "worst_year": {"year": worst, "county_weeks_d2": cw[worst]},
                          "latest_full_year": latest_full, "counties_half_year_or_more_latest": half_latest}
    # energy
    en = [c["energy"] for c in counties.values() if (c.get("energy") or {}).get("status") == "ok"]
    if en:
        out["energy"] = {"counties": len(en), "year": next((x.get("year") for x in en if x.get("year")), None),
                         "solar_mw": round(sum(x["operable"]["solar"] for x in en)), "wind_mw": round(sum(x["operable"]["wind"] for x in en)),
                         "storage_mw": round(sum(x["operable"]["storage"] for x in en)),
                         "proposed_solar_mw": round(sum(x["proposed"]["solar"] for x in en)), "proposed_wind_mw": round(sum(x["proposed"]["wind"] for x in en)),
                         "counties_with_solar": sum(1 for x in en if x["operable"]["solar"] > 0), "counties_with_wind": sum(1 for x in en if x["operable"]["wind"] > 0),
                         "counties_with_proposed": sum(1 for x in en if x["proposed"]["solar"] + x["proposed"]["wind"] + x["proposed"]["storage"] > 0)}
    # wells
    ne = [c["wells"] for c in counties.values() if (c.get("wells") or {}).get("status") == "ok" and c["state"] == "NE"]
    ks = [c["wells"] for c in counties.values() if (c.get("wells") or {}).get("status") == "ok" and c["state"] == "KS"]
    if ne or ks:
        out["wells"] = {}
        if ne:
            out["wells"]["NE"] = {"counties": len(ne), "wells": sum(x["wells"] for x in ne), "irrigation_active": sum(x["irrigation_active"] for x in ne),
                                  "median_of_county_median_depth_ft": round(statistics.median([x["depth_median_ft"] for x in ne if x.get("depth_median_ft") is not None]), 1) if any(x.get("depth_median_ft") is not None for x in ne) else None}
        if ks:
            pys = [x["priority_year_median"] for x in ks if x.get("priority_year_median")]
            out["wells"]["KS"] = {"counties": len(ks), "points": sum(x["points"] for x in ks), "irrigation_active": sum(x["irrigation_active"] for x in ks),
                                  "median_of_county_median_priority_year": int(statistics.median(pys)) if pys else None}
    return out


# ---------------------------------------------------------------- map record

def summarize_p1(rec):
    out = {}
    s = rec.get("sob") or {}
    out["sob"] = {"status": s.get("status")}
    if s.get("status") == "ok":
        rec20 = next((p.get("ratio") for k, p in (s.get("periods") or {}).items() if k.startswith("2020")), None)
        out["sob"].update({"loss_ratio_all": s.get("loss_ratio_all"), "ratio_2020s": rec20, "ratio_last10": (s.get("last10") or {}).get("ratio"),
                           "years_over_one": s.get("years_over_one"), "years_with_ratio": s.get("years_with_ratio"),
                           "first_year": s.get("first_year"), "last_year": s.get("last_year"), "partial_year": s.get("partial_year"),
                           "liability_latest": (s.get("latest") or {}).get("liability"), "corn_ratio": (s.get("corn") or {}).get("ratio")})
    v = rec.get("value") or {}
    out["value"] = {"status": v.get("status")}
    if v.get("status") == "ok":
        out["value"].update({"latest_year": v.get("latest_year"), "latest": v.get("latest"),
                             "change_cagr_pct": (v.get("change") or {}).get("cagr_pct"), "change_from_year": (v.get("change") or {}).get("from_year"),
                             "rent_to_value_pct": (v.get("rent_to_value") or {}).get("pct"), "rent_to_value_status": (v.get("rent_to_value") or {}).get("status")})
    c = rec.get("crp") or {}
    out["crp"] = {"status": c.get("status")}
    if c.get("status") == "ok":
        out["crp"].update({"latest": c.get("latest"), "share_pct": (c.get("share_of_cropland") or {}).get("pct"), "share_status": (c.get("share_of_cropland") or {}).get("status"),
                           "change_from_peak_pct": c.get("change_from_peak_pct"), "peak_year": (c.get("peak") or {}).get("year"),
                           "expiring_next3": c.get("expiring_next3")})
    d = rec.get("drought") or {}
    out["drought"] = {"status": d.get("status")}
    if d.get("status") == "ok":
        out["drought"].update({"first_year": d.get("first_year"), "last_full_year": d.get("last_full_year"), "weeks": d.get("weeks"),
                               "worst_year": d.get("worst_year"), "last5": d.get("last5"), "years_half_or_more": len(d.get("years_half_or_more") or []),
                               "latest_d2": (d["series"].get(d["last_full_year"]) or {}).get("d2")})
    e = rec.get("energy") or {}
    out["energy"] = {"status": e.get("status")}
    if e.get("status") == "ok":
        out["energy"].update({"solar": e["operable"]["solar"], "wind": e["operable"]["wind"], "storage": e["operable"]["storage"],
                              "proposed": round(e["proposed"]["solar"] + e["proposed"]["wind"] + e["proposed"]["storage"], 1),
                              "proposed_solar": e["proposed"]["solar"], "proposed_wind": e["proposed"]["wind"],
                              "first_solar": e["operable"]["first_solar"], "first_wind": e["operable"]["first_wind"], "year": e.get("year")})
    w = rec.get("wells") or {}
    out["wells"] = {"status": w.get("status")}
    if w.get("status") == "ok":
        out["wells"].update({k: w.get(k) for k in ("register", "wells", "irrigation_active", "depth_median_ft", "static_median_ft", "depth_n", "static_n",
                                                     "points", "active", "priority_year_median", "priority_n", "priority_before_1970", "groundwater", "surface") if k in w})
    return out


# ---------------------------------------------------------------- seed

def seed_p1(n, money, pct_of_unit):
    """n: the national dict. money(x) and pct_of_unit are the builder's formatters.
    Returns a list of <p> strings."""
    parts = []
    s = n.get("sob")
    if s:
        per = " · ".join(f"{k} {v['ratio']:.2f}" for k, v in s["periods"].items() if v.get("ratio") is not None)
        parts.append(f'<p>Loss ratio: across {s["counties"]} counties RMA has paid {money(s["total_indemnity"])} of indemnity on {money(s["total_premium"])} of premium since 1989, a loss ratio of {s["loss_ratio"]:.2f}; in {s["counties_over_one"]} counties indemnities have exceeded premium over the whole record. By period: {per}. Rainfall-index pasture policies excluded.</p>')
    else:
        parts.append('<p>Loss ratio: not yet measured.</p>')
    v = n.get("value")
    if v:
        parts.append(f'<p>Land value, {v["year"]} census: the median county reports {money(v["median_per_acre"])} an acre for land and buildings (range {money(v["min_per_acre"])} to {money(v["max_per_acre"])}, {v["counties"]} counties). Non-irrigated cash rent as a share of that value is published for {v["counties_with_rent_to_value"]} counties, median {v["median_rent_to_value_pct"]:.2f}%; under 2% in {v["rent_to_value_under_2pct"]}, over 4% in {v["rent_to_value_over_4pct"]}.</p>')
    else:
        parts.append('<p>Land value: not yet measured.</p>')
    c = n.get("crp")
    if c:
        parts.append(f'<p>CRP: {c["acres"]:,} acres enrolled across {c["counties"]} counties in {c["year"]}; {c["expiring_next3_acres"]:,} acres expire in the three fiscal years from {c["expiring_window"]}. In {c["counties_over_10pct"]} of {c["counties_with_share"]} counties CRP is a tenth or more of the cropland base.</p>')
    else:
        parts.append('<p>CRP: not yet measured.</p>')
    d = n.get("drought")
    if d:
        w = d["worst_year"]
        parts.append(f'<p>Drought: summed over {d["counties"]} counties, the year with the most county-weeks with at least half the county in severe drought or worse since 2000 was {w["year"]} ({w["county_weeks_d2"]:,} county-weeks). In {d["latest_full_year"]}, the latest full year, {d["counties_half_year_or_more_latest"]} counties spent half the year or more in that condition.</p>')
    else:
        parts.append('<p>Drought: not yet measured.</p>')
    e = n.get("energy")
    if e:
        parts.append(f'<p>Solar and wind, Form 860 {e["year"]}: {e["solar_mw"]:,} MW of solar in {e["counties_with_solar"]} counties and {e["wind_mw"]:,} MW of wind in {e["counties_with_wind"]}; {e["storage_mw"]:,} MW of batteries. Proposed to EIA: {e["proposed_solar_mw"]:,} MW solar and {e["proposed_wind_mw"]:,} MW wind, touching {e["counties_with_proposed"]} counties.</p>')
    else:
        parts.append('<p>Solar and wind: not yet measured.</p>')
    w = n.get("wells")
    if w:
        bits = []
        if w.get("NE"):
            ne = w["NE"]
            bits.append(f'Nebraska: {ne["wells"]:,} registered wells, {ne["irrigation_active"]:,} of them irrigation wells not decommissioned' + (f', median county median depth {ne["median_of_county_median_depth_ft"]:.0f} ft' if ne.get("median_of_county_median_depth_ft") is not None else ''))
        if w.get("KS"):
            ks = w["KS"]
            bits.append(f'Kansas: {ks["points"]:,} points of diversion, {ks["irrigation_active"]:,} active irrigation' + (f', median county median priority year {ks["median_of_county_median_priority_year"]}' if ks.get("median_of_county_median_priority_year") else ''))
        parts.append('<p>Wells and rights. ' + '. '.join(bits) + '.</p>')
    else:
        parts.append('<p>Wells and rights: not yet measured.</p>')
    return parts


# ---------------------------------------------------------------- selftest

def selftest():
    # sob: hand worked. 2012: indem 3M on prem 1.5M -> 2.00; 2019: 0.2M on 1M -> 0.20; total 3.2M / 2.5M = 1.28
    s = {"years": {"2012": {"liab": 30e6, "prem": 1.5e6, "indem": 3e6, "policies": 300}, "2019": {"liab": 40e6, "prem": 1e6, "indem": 0.2e6, "policies": 310},
                   "2021": {"liab": 40e6, "prem": 0.5e6, "indem": 0.1e6, "policies": 300}},
         "corn": {"2012": {"liab": 20e6, "prem": 1e6, "indem": 2.5e6}}, "prf": {"2012": {"liab": 1e6, "prem": 80e3, "indem": 500e3}}}
    L = sob_layer(s, 2025, ran=True, col_total_indemnity=3.1e6)
    assert L["loss_ratio_all"] == 1.1 and L["total_premium"] == 3_000_000 and L["years_over_one"] == 1, L
    assert L["per_year"][2012]["ratio"] == 2.0 and L["per_year"][2021]["ratio"] is None, L["per_year"]
    assert L["worst_year"] == {"year": 2012, "ratio": 2.0} and L["years_with_ratio"] == 2
    assert L["periods"]["2010-2019"]["ratio"] is None and "2 of the period" in L["periods"]["2010-2019"]["ratio_status"]
    assert L["periods"]["1989-1999"]["years_present"] == 0 and L["corn"]["ratio"] == 2.5
    assert L["last10"]["from"] == 2012 and L["last10"]["years"] == 3 and L["last10"]["ratio"] == 1.1 and L["prf_excluded"]["indemnity"] == 500_000
    assert L["cause_of_loss_check"]["col_over_sob"] == 0.939, L["cause_of_loss_check"]
    assert L["latest"] == {"year": 2021, "liability": 40_000_000, "premium": 500_000, "policies": 300}
    # a period with enough years and enough premium prints
    s2 = {"years": {str(y): {"liab": 1, "prem": 300_000, "indem": 150_000 if y % 2 else 450_000, "policies": 1} for y in range(2010, 2020)}}
    L2 = sob_layer(s2, 2025, ran=True)
    assert L2["periods"]["2010-2019"]["ratio"] == 1.0 and L2["periods"]["2010-2019"]["years_present"] == 10, L2["periods"]
    assert sob_layer(None, 2025, ran=True)["status"].startswith("withheld") and sob_layer(None, 2025)["status"].startswith("not yet")
    # value: 10,000 -> 12,100 over 2017..2022 = +21%, CAGR 3.9%; rent 300 / 12,100 = 2.48%
    V = value_layer({"years": {"2012": 8000, "2017": 10000, "2022": 12100}}, {"2022": 300, "2025": 320}, ran=True)
    assert V["latest"] == 12100 and V["change"]["pct"] == 21.0 and V["change"]["cagr_pct"] == 3.9 and V["change"]["from_year"] == 2017, V
    assert V["rent_to_value"] == {"year": 2022, "rent": 300, "value": 12100, "pct": 2.48}, V["rent_to_value"]
    V2 = value_layer({"years": {"2017": 10000, "2022": None}}, {"2022": 300}, ran=True)
    assert V2["latest"] is None and "suppressed" in V2["values"][2022]["status"] and "suppressed" in V2["rent_to_value"]["status"] and "change" not in V2
    V3 = value_layer({"years": {"2022": 5000}}, {"2025": 300}, ran=True)
    assert "no non-irrigated cash rent" in V3["rent_to_value"]["status"] and "change" not in V3
    assert value_layer(None, ran=True)["status"].startswith("withheld")
    # crp: 20,000 acres of 180,000 harvested -> 10.0% of the base; peak 30,000 in 2007 -> -33.3%; expiring FY2026-2028 = 5,000 = 25% of enrolled
    C = crp_layer({"acres": {"2007": 30000, "2020": 25000, "2025": 20000}, "expiring": {"2025": 100, "2026": 2000, "2027": 2000, "2028": 1000, "2029": 9000}},
                  harvested_cropland=180000, ran=True, this_fy=2026)
    assert C["latest"] == {"year": 2025, "acres": 20000} and C["peak"] == {"year": 2007, "acres": 30000} and C["change_from_peak_pct"] == -33.3, C
    assert C["share_of_cropland"]["pct"] == 10.0 and C["expiring_next3"] == {"from": 2026, "to": 2028, "acres": 5000, "share_of_enrolled_pct": 25.0}, C
    C2 = crp_layer({"acres": {"2025": 50}, "expiring": {}}, harvested_cropland=1000, ran=True)
    assert "under 100" in C2["share_of_cropland"]["status"] and C2["expiring"] is None
    assert crp_layer(None, ran=True)["status"].startswith("withheld")
    # drought: 2012 full year 30 weeks D2+; 2013 full 0; 2026 partial 20 maps
    D = drought_layer({"2012": {"maps": 52, "d2": 30, "d3": 10}, "2013": {"maps": 53, "d2": 0, "d3": 0}, "2026": {"maps": 20, "d2": 5, "d3": 0}}, ran=True, this_year=2026)
    assert D["weeks"] == {"counted": 105, "d2": 30, "d3": 10, "share_d2_pct": 28.6, "share_d3_pct": 9.5}, D["weeks"]
    assert D["worst_year"] == {"year": 2012, "d2": 30, "d3": 10} and D["years_half_or_more"] == [2012] and D["last_full_year"] == 2013
    assert D["partial_year"] == {"year": 2026, "maps": 20, "d2": 5, "d3": 0} and D["last5"]["d2"] == 30
    assert drought_layer({"2026": {"maps": 20, "d2": 5, "d3": 0}}, ran=True)["status"].startswith("withheld")
    # energy: absent after a run is zero, not a hole
    E = energy_layer(None, ran=True, year=2025)
    assert E["status"] == "ok" and E["none_reported"] and E["operable"]["solar"] == 0.0
    E2 = energy_layer({"operable": {"solar": 10.5, "wind": 100, "plants": 2, "first_solar": 2019}, "proposed": {"solar": 50, "earliest_year": 2027}}, ran=True, year=2025)
    assert E2["operable"]["wind"] == 100 and E2["operable"]["storage"] == 0.0 and E2["proposed"]["earliest_year"] == 2027 and E2["operable"]["first_wind"] is None
    assert energy_layer(None)["status"].startswith("not yet")
    # wells
    assert wells_layer("IA", ran=True)["status"].startswith("withheld: no open state")
    assert wells_layer("NE", ne={"wells": 5}, ran=True)["wells"] == 5 and wells_layer("NE", ran=True)["status"].startswith("withheld")
    assert wells_layer("KS", ran=False)["status"].startswith("not yet")
    # summary and national on a two-county Atlas
    cs = {"19001": {"state": "IA", "sob": L2, "value": V, "crp": C, "drought": D, "energy": E2, "wells": wells_layer("IA", ran=True)},
          "31001": {"state": "NE", "sob": L, "value": V3, "crp": C2, "drought": drought_layer({"2013": {"maps": 52, "d2": 26, "d3": 1}}, ran=True),
                    "energy": E, "wells": wells_layer("NE", ne={"wells": 100, "irrigation_active": 60, "depth_median_ft": 210.0, "static_median_ft": 90.0}, ran=True)}}
    N = national_p1(cs)
    assert N["sob"]["counties"] == 2 and N["sob"]["loss_ratio"] == round((3e6 + 3.3e6) / (3e6 + 3e6), 2) and N["sob"]["counties_over_one"] == 1, N["sob"]
    assert N["value"]["median_per_acre"] == 8550 and N["value"]["counties_with_rent_to_value"] == 1 and N["value"]["median_rent_to_value_pct"] == 2.48
    assert N["crp"]["acres"] == 20050 and N["crp"]["expiring_next3_acres"] == 5000 and N["crp"]["counties_over_10pct"] == 1
    assert N["drought"]["county_weeks_d2_by_year"] == {2012: 30, 2013: 26} and N["drought"]["worst_year"]["year"] == 2012 and N["drought"]["counties_half_year_or_more_latest"] == 1
    assert N["energy"]["solar_mw"] == 10 and N["energy"]["wind_mw"] == 100 and N["energy"]["counties_with_proposed"] == 1
    assert N["wells"]["NE"]["irrigation_active"] == 60 and "KS" not in N["wells"]
    sm = summarize_p1(cs["31001"])
    assert sm["sob"]["loss_ratio_all"] == 1.1 and sm["sob"]["ratio_2020s"] is None and sm["value"]["rent_to_value_pct"] is None
    assert sm["crp"]["share_pct"] is None and sm["drought"]["latest_d2"] == 26 and sm["energy"]["proposed"] == 0.0 and sm["wells"]["depth_median_ft"] == 210.0
    assert "series" not in sm["drought"] and "per_year" not in sm["sob"]
    parts = seed_p1(N, lambda x: f"${x:,.0f}", None)
    assert any("loss ratio of" in p for p in parts) and any("Nebraska: 100 registered wells" in p for p in parts), parts
    print("selftest ok")


if __name__ == "__main__":
    import sys
    if "--selftest" in sys.argv:
        selftest()
