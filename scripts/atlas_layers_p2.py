#!/usr/bin/env python3
"""
atlas_layers_p2.py — weather, storms, livestock and freeze-date layers, and
the other states' well registers, for build_farmland_atlas.py.

Each layer function takes one county's raw record and returns the block the
county file carries: {"status": "ok", ...} or {"status": "withheld: why"} or
{"status": "not yet measured"} when the source has not been fetched. The
gates are the numbers at the top of this file; the page prints them.

summarize_p2(rec) is the map's slice of these blocks (first paint only).
"""

import statistics
import sys
from datetime import date, timedelta

NOT_YET = "not yet measured"
NORMAL = (1991, 2020)
MIN_NORMAL_N = 27            # of 30 years for a 1991-2020 normal
MIN_RECENT_N = 8             # of the last 10 for a recent mean
MIN_STORM_YEARS = 10
MIN_FROST_YEARS = 20         # of 30 seasons for a median date
MIN_HEAD = 50                # cattle head before a density or a change is printed
MIN_GS_FOR_PCT = 6.0         # inches of normal Apr-Sep rain before a percent of normal or a swing is printed
LATE_FREEZE = (5, 15)        # a spring freeze on or after May 15 counts as late
EARLY_FREEZE = (9, 30)       # a fall freeze on or before Sep 30 counts as early


def _mean(xs):
    return sum(xs) / len(xs) if xs else None


def _r(x, k=1):
    """Half away from zero, as the page rounds; whole numbers come back as int."""
    if x is None:
        return None
    v = round(x + (1e-9 if x >= 0 else -1e-9), k)
    return int(v) if k == 0 else v


def doy_label(doy):
    """Day of year (non-leap reference) -> 'May 2'."""
    d = date(2021, 1, 1) + timedelta(days=int(doy) - 1)
    return d.strftime("%b ") + str(d.day)


def _doy(md):
    return date(2021, md[0], md[1]).timetuple().tm_yday


# ---------------------------------------------------------------- rain and July highs

def climate_layer(rec, gs_latest=None, tmax_latest=None, ran=False):
    if not ran:
        return {"status": NOT_YET}
    if not rec:
        return {"status": "withheld: NOAA nClimDiv has no county series here (Alaska and Hawaii are not in it)"}
    pcp = {int(y): v for y, v in (rec.get("pcp") or {}).items()}
    gs = {y: v[1] for y, v in pcp.items() if v and v[1] is not None and (gs_latest is None or y <= gs_latest)}
    ann = {y: v[0] for y, v in pcp.items() if v and v[0] is not None}
    out = {"status": "ok"}
    norm = [gs[y] for y in range(NORMAL[0], NORMAL[1] + 1) if y in gs]
    if len(norm) >= MIN_NORMAL_N:
        nm = _mean(norm)
        out["gs_normal_in"] = _r(nm, 1)
        # On an inch or two of summer rain (the Central Valley, the desert) a percent of
        # normal or a swing is noise: 300% of one inch is three inches (panel 9/20)
        wet = nm >= MIN_GS_FOR_PCT
        pc = (lambda v: _r(v / nm * 100, 0)) if wet else (lambda v: None)
        sd = statistics.pstdev(norm)
        out["gs_cv_pct"] = _r(sd / nm * 100, 0) if wet else None
        if not wet:
            out["gs_pct_status"] = f"withheld: under {MIN_GS_FOR_PCT:.0f} inches of normal April-September rain, so a percent of normal is noise"
        last = max(gs)
        rec10 = [gs[y] for y in range(last - 9, last + 1) if y in gs]
        if len(rec10) >= MIN_RECENT_N:
            out["gs_recent"] = {"from": last - 9, "to": last, "n": len(rec10), "mean_in": _r(_mean(rec10), 1),
                                "pct_of_normal": pc(_mean(rec10))}
        out["gs_latest"] = {"year": last, "in": _r(gs[last], 1), "pct_of_normal": pc(gs[last])}
        dy = min(gs, key=gs.get)
        out["gs_driest"] = {"year": dy, "in": _r(gs[dy], 1), "pct_of_normal": pc(gs[dy])}
        if wet:
            out["gs_years_under_75pct"] = {"n": sum(1 for v in gs.values() if v < 0.75 * nm), "of": len(gs), "from": min(gs), "to": last}
    else:
        out["gs_status"] = f"withheld: fewer than {MIN_NORMAL_N} of the 30 growing seasons 1991-2020 are complete"
    an = [ann[y] for y in range(NORMAL[0], NORMAL[1] + 1) if y in ann]
    if len(an) >= MIN_NORMAL_N:
        out["annual_normal_in"] = _r(_mean(an), 1)
    out["gs_series"] = {str(y): _r(v, 2) for y, v in sorted(gs.items())}
    tx = {int(y): v for y, v in (rec.get("tmax_jul") or {}).items() if tmax_latest is None or int(y) <= tmax_latest}
    tn = [tx[y] for y in range(NORMAL[0], NORMAL[1] + 1) if y in tx]
    if tx:
        last = max(tx)
        t10 = [tx[y] for y in range(last - 9, last + 1) if y in tx]
        out["jul_high"] = {"normal_f": _r(_mean(tn), 1) if len(tn) >= MIN_NORMAL_N else None,
                           "recent": {"from": last - 9, "to": last, "n": len(t10), "mean_f": _r(_mean(t10), 1)} if len(t10) >= MIN_RECENT_N else None}
    return out


# ---------------------------------------------------------------- storm reports

def storms_layer(rec, years, ran=False):
    if not ran:
        return {"status": NOT_YET}
    if not years or len(years) < MIN_STORM_YEARS:
        return {"status": f"withheld: fewer than {MIN_STORM_YEARS} complete years of Storm Events"}
    rec = rec or {}
    n = len(years)
    tot = [0, 0, 0, 0]
    worst = (None, 0)
    for y in years:
        v = rec.get(str(y)) or [0, 0, 0, 0]
        for i in range(4):
            tot[i] += v[i]
        if v[0] > worst[1]:
            worst = (y, v[0])
    return {"status": "ok", "from": years[0], "to": years[-1], "years": n,
            "hail_1in_days_per_year": _r(tot[0] / n, 1), "hail_2in_days_per_year": _r(tot[1] / n, 2),
            "wind_days_per_year": _r(tot[2] / n, 1), "tornadoes": tot[3],
            "hail_1in_days": tot[0], "hail_2in_days": tot[1], "wind_days": tot[2],
            "worst_hail_year": {"year": worst[0], "days": worst[1]} if worst[0] else None,
            "note": "reports, not storms: a zero is no report"}


# ---------------------------------------------------------------- cattle, hogs, pasture

def livestock_layer(rec, none_if_absent=None, failed=None, land_in_farms=None, items=None, ran=False):
    if not ran:
        return {"status": NOT_YET}
    none_if_absent = none_if_absent or {}
    failed = failed or []
    y = (rec or {}).get("y") or {}
    out = {"status": "ok"}

    def item(year, k, commodity):
        row = y.get(year) or {}
        if k in row:
            return {"value": row[k]} if row[k] is not None else {"status": "withheld: suppressed by NASS (D) to protect a single operation"}
        if any(x.endswith(f"{year} {commodity}") for x in failed):
            return {"status": f"withheld: the {year} census pull for this state returned nothing"}
        if items is not None and f"{year} {k}" not in items:
            # the item's NASS wording was never matched anywhere: not the county's census, the fetcher's pattern
            return {"status": "withheld: this item was not found in NASS's data under the wording the Atlas looks for"}
        if none_if_absent.get(f"{year} {k}"):
            return {"value": 0.0, "none_reported": True}
        return {"status": f"withheld: the {year} census did not publish this for the county"}

    spec = {"cattle": "CATTLE", "beef_cows": "CATTLE", "milk_cows": "CATTLE", "on_feed": "CATTLE", "cattle_ops": "CATTLE",
            "hogs": "HOGS", "pasture": "AG LAND"}
    for k, com in spec.items():
        out[k] = item("2022", k, com)
    c22 = out["cattle"].get("value")
    c17 = item("2017", "cattle", "CATTLE").get("value")
    if c22 is not None and c17 is not None and c17 >= MIN_HEAD:
        out["cattle_change"] = {"from": 2017, "to": 2022, "from_head": round(c17), "to_head": round(c22),
                                "pct": _r((c22 / c17 - 1) * 100, 1)}
    if c22 is not None and land_in_farms and land_in_farms > 0:
        out["cattle_per_1000ac"] = _r(c22 / land_in_farms * 1000, 1)
    if not any("value" in out[k] for k in spec):
        return {"status": "withheld: the census published no livestock or pasture figure for this county"}
    return out


# ---------------------------------------------------------------- freeze dates, GDD

def _median_censored(vals, lo_mark=None, hi_mark=None):
    """Median of day numbers where some are only known to be before/after the window.
    -> (doy or None, 'before'/'after'/None). A censored value sits at its end of the
    order; the median is exact whenever it lands on an uncensored value."""
    key = []
    for v in vals:
        if v == lo_mark:
            key.append((-1, 0))
        elif v == hi_mark:
            key.append((1, 0))
        else:
            key.append((0, v))
    key.sort()
    n = len(key)
    if n == 0:
        return None, None
    mids = [key[(n - 1) // 2], key[n // 2]]
    if all(m[0] == -1 for m in mids):
        return None, "before"
    if all(m[0] == 1 for m in mids):
        return None, "after"
    if any(m[0] != 0 for m in mids):
        # one middle value is censored: the median is only bounded by the other one
        exact = [m[1] for m in mids if m[0] == 0][0]
        return exact, ("le" if any(m[0] == -1 for m in mids) else "ge")
    return (mids[0][1] + mids[1][1]) / 2, None


def frost_layer(rec, first_year=None, last_year=None, ran=False):
    if not ran:
        return {"status": NOT_YET}
    if not rec:
        return {"status": "withheld: no nClimGrid county series here (Alaska and Hawaii are not in it)"}
    ys = {int(y): v for y, v in rec.items()}
    spring = [v[0] for v in ys.values() if v[0] is not None]
    fall = [v[1] for v in ys.values() if v[1] is not None]
    out = {"status": "ok", "from": min(ys), "to": max(ys)}
    if len(spring) >= MIN_FROST_YEARS:
        m, cen = _median_censored(spring, lo_mark=-1)
        out["last_spring_freeze"] = {"median_doy": _r(m, 0) if m is not None else None,
                                     "median": (("on or before " if cen == "le" else "") + doy_label(_r(m, 0))) if m is not None else None,
                                     "censored": cen, "n": len(spring),
                                     "late": {"on_or_after": doy_label(_doy(LATE_FREEZE)),
                                              "years": sum(1 for v in spring if v != -1 and v >= _doy(LATE_FREEZE))}}
        lat = [(y, v[0]) for y, v in ys.items() if v[0] not in (None, -1)]
        if lat:
            ly = max(lat, key=lambda t: t[1])
            out["last_spring_freeze"]["latest"] = {"year": ly[0], "date": doy_label(ly[1])}
    if len(fall) >= MIN_FROST_YEARS:
        m, cen = _median_censored(fall, hi_mark=999)
        out["first_fall_freeze"] = {"median_doy": _r(m, 0) if m is not None else None,
                                    "median": (("on or after " if cen == "ge" else "") + doy_label(_r(m, 0))) if m is not None else None,
                                    "censored": cen, "n": len(fall),
                                    "early": {"on_or_before": doy_label(_doy(EARLY_FREEZE)),
                                              "years": sum(1 for v in fall if v != 999 and v <= _doy(EARLY_FREEZE))}}
        ea = [(y, v[1]) for y, v in ys.items() if v[1] not in (None, 999)]
        if ea:
            ey = min(ea, key=lambda t: t[1])
            out["first_fall_freeze"]["earliest"] = {"year": ey[0], "date": doy_label(ey[1])}
    # A year with no freeze inside a window had a season LONGER than the window can
    # measure; it is ranked above every measured year, not dropped (dropping the
    # longest seasons biased the median short; panel 9/20)
    both = [v for v in ys.values() if v[0] is not None and v[1] is not None]
    if len(both) >= MIN_FROST_YEARS:
        lens = [9999 if (v[0] == -1 or v[1] == 999) else v[1] - v[0] - 1 for v in both]
        m, cen = _median_censored(lens, hi_mark=9999)
        if m is not None:
            out["frost_free_days"] = {"median": _r(m, 0), "at_least": cen == "ge", "n": len(both),
                                      "open_years": sum(1 for x in lens if x == 9999)}
        else:
            out["frost_free_days"] = {"status": "withheld: in half or more of years the season runs past the March 1 to November 30 window, so no length is measured"}
    g = {y: v[2] for y, v in ys.items() if v[2] is not None}
    if len(g) >= MIN_FROST_YEARS:
        last = max(g)
        g10 = [g[y] for y in range(last - 9, last + 1) if y in g]
        out["gdd"] = {"median": _r(statistics.median(g.values()), 0), "n": len(g),
                      "recent": {"from": last - 9, "to": last, "mean": _r(_mean(g10), 0)} if len(g10) >= MIN_RECENT_N else None,
                      "basis": "corn GDD, May 1 to Sep 30, 86/50 method"}
    h = {y: v[3] for y, v in ys.items() if v[3] is not None}
    if len(h) >= MIN_FROST_YEARS:
        last = max(h)
        h10 = [h[y] for y in range(last - 9, last + 1) if y in h]
        out["hot_days"] = {"per_year": _r(_mean(list(h.values())), 1), "n": len(h),
                           "recent": {"from": last - 9, "to": last, "per_year": _r(_mean(h10), 1)} if len(h10) >= MIN_RECENT_N else None,
                           "basis": "days with a county-average high of 95 F or more, June to August"}
    if len(out) <= 3:
        return {"status": f"withheld: fewer than {MIN_FROST_YEARS} complete seasons"}
    return out


# ---------------------------------------------------------------- other states' well registers

def wells_state_block(st, meta, rec):
    """A state register summary shaped for the page. rec is the county's summary or None."""
    if not rec:
        return {"status": f"withheld: no irrigation well placed in this county in the {meta['register']}"}
    out = {"status": "ok", "register": meta["register"], "kind": "state_register",
           "irrigation_wells": rec["irrigation_wells"], "depth_median_ft": rec.get("depth_median_ft"), "depth_n": rec.get("depth_n"),
           "level_median_ft": rec.get("level_median_ft"), "level_n": rec.get("level_n"), "level_kind": meta.get("level_kind"),
           "by_decade": rec.get("by_decade") or {}}
    # no fetch stamp here: this block is in the county fingerprint, and a monthly stamp
    # would move 577 fingerprints with no number changed (panel 9/20); it sits in layers.wells_states
    if "rated_100gpm" in rec:
        out["rated_100gpm"] = rec["rated_100gpm"]
        out["rate_n"] = rec.get("rate_n")
    return out


# ---------------------------------------------------------------- the map's slice

def summarize_p2(rec):
    out = {}
    cl = rec.get("climate") or {}
    out["climate"] = {"status": cl.get("status")}
    if cl.get("status") == "ok":
        out["climate"].update({"gs_normal_in": cl.get("gs_normal_in"), "gs_cv_pct": cl.get("gs_cv_pct"),
                               "gs_recent_pct": (cl.get("gs_recent") or {}).get("pct_of_normal"),
                               "gs_latest_pct": (cl.get("gs_latest") or {}).get("pct_of_normal"),
                               "jul_high": ((cl.get("jul_high") or {}).get("recent") or {}).get("mean_f")})
    s = rec.get("storms") or {}
    out["storms"] = {"status": s.get("status")}
    if s.get("status") == "ok":
        out["storms"].update({k: s.get(k) for k in ("hail_1in_days_per_year", "hail_2in_days_per_year", "wind_days_per_year")})
    lv = rec.get("livestock") or {}
    out["livestock"] = {"status": lv.get("status")}
    if lv.get("status") == "ok":
        out["livestock"].update({k: (lv.get(k) or {}).get("value") for k in ("cattle", "beef_cows", "milk_cows")})
        out["livestock"]["per_1000ac"] = lv.get("cattle_per_1000ac")
        out["livestock"]["chg_pct"] = (lv.get("cattle_change") or {}).get("pct")
    fr = rec.get("frost") or {}
    out["frost"] = {"status": fr.get("status")}
    if fr.get("status") == "ok":
        ls, fs = fr.get("last_spring_freeze") or {}, fr.get("first_fall_freeze") or {}
        # -1 / 999: the median year had no freeze inside the window; the page says so instead of greying it
        out["frost"].update({"spring": ls.get("median_doy") if ls.get("median_doy") is not None else (-1 if ls.get("censored") == "before" else None),
                             "fall": fs.get("median_doy") if fs.get("median_doy") is not None else (999 if fs.get("censored") == "after" else None),
                             "ffd": (fr.get("frost_free_days") or {}).get("median"),
                             "gdd": (fr.get("gdd") or {}).get("median"),
                             "hot": (fr.get("hot_days") or {}).get("per_year")})
    return out


# The sidecar form: one short array per block, fixed order, so 3,100 counties do
# not repeat the field names. The page reads them by the same order (MORE_KEYS).
MORE_KEYS = {
    "c": ("climate", ["gs_normal_in", "gs_cv_pct", "gs_recent_pct", "gs_latest_pct", "jul_high"]),
    "s": ("storms", ["hail_1in_days_per_year", "hail_2in_days_per_year", "wind_days_per_year"]),
    "l": ("livestock", ["cattle", "beef_cows", "milk_cows", "per_1000ac", "chg_pct"]),
    "f": ("frost", ["spring", "fall", "ffd", "gdd", "hot"]),
}


def more_row(rec):
    sm = summarize_p2(rec)
    out = {}
    for short, (name, keys) in MORE_KEYS.items():
        b = sm.get(name) or {}
        if b.get("status") == "ok":
            out[short] = [b.get(k) for k in keys]
    return out


# ---------------------------------------------------------------- selftest

def selftest():
    # climate: 30 normal seasons of 20", recent 10 of 18"
    pcp = {str(y): [32.0, 20.0, 7.0] for y in range(1991, 2016)}
    pcp.update({str(y): [30.0, 18.0, 6.0] for y in range(2016, 2026)})
    pcp["2026"] = [None, None, 5.0]
    c = climate_layer({"pcp": pcp, "tmax_jul": {str(y): 85.0 for y in range(1976, 2026)}}, gs_latest=2025, tmax_latest=2025, ran=True)
    assert c["gs_normal_in"] == round((25 * 20 + 5 * 18) / 30, 1), c["gs_normal_in"]
    assert c["gs_recent"]["from"] == 2016 and c["gs_recent"]["mean_in"] == 18.0 and c["gs_latest"]["year"] == 2025, c
    assert c["gs_years_under_75pct"]["n"] == 0 and c["jul_high"]["recent"]["mean_f"] == 85.0 and c["jul_high"]["normal_f"] == 85.0
    dry = climate_layer({"pcp": {str(y): [6.0, 1.0, 0.1] for y in range(1991, 2026)}}, gs_latest=2025, ran=True)
    assert dry["gs_normal_in"] == 1.0 and dry["gs_cv_pct"] is None and dry["gs_latest"]["pct_of_normal"] is None and "gs_pct_status" in dry
    assert climate_layer(None, ran=True)["status"].startswith("withheld") and climate_layer(None)["status"] == NOT_YET
    # storms
    s = storms_layer({"2010": [2, 1, 3, 1], "2012": [4, 0, 1, 0]}, list(range(2010, 2026)), ran=True)
    assert s["hail_1in_days"] == 6 and s["hail_1in_days_per_year"] == 0.4 and s["worst_hail_year"] == {"year": 2012, "days": 4}, s
    z = storms_layer(None, list(range(2010, 2026)), ran=True)
    assert z["hail_1in_days"] == 0 and z["worst_hail_year"] is None, "a county with no report is zero reports"
    # livestock
    lv = livestock_layer({"y": {"2022": {"cattle": 61234.0, "beef_cows": 9000.0, "milk_cows": None}, "2017": {"cattle": 55000.0}}},
                         none_if_absent={"2022 hogs": True, "2022 on_feed": False}, land_in_farms=500000, ran=True)
    assert lv["cattle"] == {"value": 61234.0} and lv["milk_cows"]["status"].startswith("withheld: suppressed")
    assert lv["hogs"] == {"value": 0.0, "none_reported": True} and lv["on_feed"]["status"].startswith("withheld: the 2022 census did not")
    assert lv["cattle_change"]["pct"] == 11.3 and lv["cattle_per_1000ac"] == 122.5, lv
    nw = livestock_layer({"y": {"2022": {"cattle": 5.0}}}, items={"2022 cattle": "CATTLE, INCL CALVES - INVENTORY"}, ran=True)
    assert nw["hogs"]["status"].endswith("wording the Atlas looks for"), nw["hogs"]
    f2 = livestock_layer({"y": {}}, failed=["TX 2022 CATTLE"], ran=True)
    assert f2["status"].startswith("withheld"), f2
    # frost: spring freeze Apr 20 (110) most years, three years none after Mar 1, fall Oct 10 (283)
    rec = {str(y): [110, 283, 2800, 3] for y in range(1996, 2023)}
    rec.update({"2023": [-1, 283, 2900, 5], "2024": [-1, 999, 3000, 6], "2025": [-1, 283, 3100, 4]})
    fr = frost_layer(rec, ran=True)
    assert fr["last_spring_freeze"]["median"] == "Apr 20" and fr["first_fall_freeze"]["median"] == "Oct 10", fr
    assert fr["frost_free_days"]["median"] == 172 and fr["frost_free_days"]["n"] == 30 and fr["frost_free_days"]["open_years"] == 3, fr["frost_free_days"]
    # 16 measured years of 200 days and 14 open ones: the median sits among the long seasons, not at 200
    mix = {str(1996 + i): [100, 301, 3000, 1] for i in range(16)}
    mix.update({str(2012 + i): [-1, 301, 3000, 1] for i in range(14)})
    mf = frost_layer(mix, ran=True)["frost_free_days"]
    assert mf["median"] == 200 and mf["open_years"] == 14, mf
    mix.update({"2012": [-1, 301, 3000, 1], "2011": [-1, 301, 3000, 1]})
    hb = frost_layer(mix, ran=True)["frost_free_days"]
    assert hb["median"] == 200 and hb["at_least"] is True, hb
    mix.update({"2010": [-1, 301, 3000, 1]})
    assert "status" in frost_layer(mix, ran=True)["frost_free_days"], "more than half open: withheld"
    assert fr["gdd"]["median"] == 2800 and fr["gdd"]["recent"]["mean"] == 2860, fr["gdd"]
    south = frost_layer({str(y): [-1, 999, 5000, 40] for y in range(1996, 2026)}, ran=True)
    assert south["last_spring_freeze"]["censored"] == "before" and south["first_fall_freeze"]["censored"] == "after"
    assert south["frost_free_days"]["status"].startswith("withheld")
    assert _median_censored([100, -1, -1], lo_mark=-1) == (None, "before")
    assert _median_censored([100, 120, -1, 130], lo_mark=-1) == (110.0, None)
    assert _median_censored([100, -1, 130, -1], lo_mark=-1) == (100, "le")
    assert doy_label(110) == "Apr 20"
    w = wells_state_block("MN", {"register": "X", "level_kind": "static"}, {"irrigation_wells": 3, "depth_median_ft": 141.0, "by_decade": {}})
    assert w["status"] == "ok" and w["kind"] == "state_register" and "rated_100gpm" not in w
    sm = summarize_p2({"climate": c, "storms": s, "livestock": lv, "frost": fr})
    assert sm["frost"]["ffd"] == 172 and sm["livestock"]["cattle"] == 61234.0 and sm["storms"]["hail_1in_days_per_year"] == 0.4
    mr = more_row({"climate": c, "storms": s, "livestock": lv, "frost": fr})
    assert mr["f"][2] == 172 and mr["s"][0] == 0.4 and mr["l"][0] == 61234.0 and set(mr) == {"c", "s", "l", "f"}, mr
    print("selftest ok")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
