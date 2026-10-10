#!/usr/bin/env python3
"""basis_method.py -- THE one way a state's basis is stated on AGSIST.

Every surface that prints a state basis (the state section on
/cash-bids/<state>/, the "pick your state" answer and the all-states ranking
on /basis, data/basis-states.json) gets its number from state_basis() here.
Before 2026-10-10 there were two: the state pages took the median against one
named contract, and scripts/build_basis_map.py averaged every board's basis
against whatever futures month it happened to quote. Tennessee corn read
-$0.12 on one and +$0.05 on the other.

THE METHOD
  - input: one bid per elevator and crop (its nearest open delivery), already
    gated as fresh network bids by build_state_basis_pages.fresh_rows/nearby
  - grouped by the futures contract the board names. A bid whose board names
    no contract is listed and never counted: a basis against an unnamed month
    cannot be compared with one against December
  - a bid with |basis| beyond SANITY, or whose implied futures (cash - basis)
    is more than 3% off the network's for that contract, is a misread board
    and is left out (listed as suspect)
  - OUTLIER GUARD: within each contract group of at least OUTLIER_MIN_N bids,
    a bid further from the group median than OUTLIER_K robust standard
    deviations (1.4826 x the median absolute deviation, never less than
    OUTLIER_FLOOR) is left out of the median, the range and the strongest and
    weakest lists, and named in the detail with how far out it was. One Iowa
    board posting soybeans at +$1.40 against a -$0.63 state median topped the
    strongest list and set the range on 2026-10-09; it is a board to call, not
    the state's best basis.
  - headline = the contract most elevators in the state price against; its
    MEDIAN, with n (the elevators behind it) always printed beside it
  - week-over-week: the median of matched-pair changes (same board, crop,
    commodity, period and contract) against a snapshot about seven days back,
    with how many pairs it rests on; omitted, never estimated, without one

Selftest: python3 scripts/basis_method.py --selftest
"""
import statistics
import sys

MIN_STAT = 3          # elevators needed to print a median/range at all
SANITY = {"corn": 2.5, "soybeans": 2.5, "wheat": 3.0}   # |basis| $/bu beyond this = suspect parse
CROP_ORDER = ["corn", "soybeans", "wheat_hrw", "wheat_srw", "wheat_hrs"]
OUTLIER_MIN_N = 5     # below this a median absolute deviation says nothing
OUTLIER_K = 5.0       # robust standard deviations from the median
OUTLIER_FLOOR = 0.15  # $/bu: the robust SD is never taken as less than this
# Why 5 and 15c, so nothing closer than 75c to the median is ever cut: on the
# 2026-10-10 network snapshot many Iowa boards post the same corn number, the
# median absolute deviation is 4c, and a tighter gate cut 17 real bids,
# among them ADM Clinton and POET at even to +5c, river and plant bids a
# farmer can haul to, 45-50c over the country median. A real spread inside a
# state runs to about 55c; the boards this is for sit a dollar or more away
# (Iowa soybeans +$1.40 against -$0.63; Nebraska soybeans -$1.40 against
# -$0.59, 81c under).


def median(vals):
    return statistics.median(vals) if vals else None


def match_key(r):
    return (r["source"], r["group"], r["commodity"], r["period"], r["contract"])


def robust_split(rows, k=OUTLIER_K, floor=OUTLIER_FLOOR, min_n=OUTLIER_MIN_N):
    """-> (kept, outliers). Each outlier row gets r["outlier"] = {median,
    scale, dist} in $/bu. Fewer than min_n rows: nothing is excluded."""
    if len(rows) < min_n:
        return list(rows), []
    vals = [r["basis"] for r in rows]
    med = statistics.median(vals)
    mad = statistics.median(abs(v - med) for v in vals)
    scale = max(1.4826 * mad, floor)
    kept, out = [], []
    for r in rows:
        d = r["basis"] - med
        if abs(d) > k * scale:
            r["outlier"] = {"median": round(med, 4), "scale": round(scale, 4), "dist": round(d, 4)}
            out.append(r)
        else:
            kept.append(r)
    return kept, out


def state_basis(rows, prev_map):
    """Per crop group: headline contract stats + secondary contracts.

    rows: one per elevator and crop group (build_state_basis_pages.nearby),
    each with source, group, crop, commodity, period, contract, basis, cash,
    priced, city, operator and fut_off. prev_map: match_key -> basis a week
    back, or None. -> {group: {rows, contracts: [stat...], no_contract,
    suspect, outliers}}; a stat is {contract, n, rows, outliers} plus median,
    lo, hi, asof_*, strong, weak and wow_* when n >= MIN_STAT."""
    by_group = {}
    for r in rows:
        by_group.setdefault(r["group"], []).append(r)
    out = {}
    for g in CROP_ORDER:
        rs = by_group.get(g, [])
        if not rs:
            continue
        for r in rs:
            r.pop("outlier", None)
            r["suspect"] = abs(r["basis"]) > SANITY[r["crop"]] or r.get("fut_off", False)
            p = prev_map.get(match_key(r)) if prev_map is not None else None
            r["wow"] = round((r["basis"] - p) * 100, 2) if p is not None else None
        by_con = {}
        for r in rs:
            if r["contract"] is not None and not r["suspect"]:
                by_con.setdefault(r["contract"], []).append(r)
        groups, all_out = [], []
        for con, crs0 in sorted(by_con.items(), key=lambda kv: (-len(kv[1]), kv[0][2], kv[0][1])):
            crs, outl = robust_split(crs0)
            all_out += outl
            vals = [r["basis"] for r in crs]
            st = {"contract": con, "n": len(crs), "rows": crs,
                  "outliers": sorted(outl, key=lambda r: -abs(r["outlier"]["dist"]))}
            if len(crs) >= MIN_STAT:
                st["median"] = round(median(vals), 4)
                st["lo"], st["hi"] = min(vals), max(vals)
                st["asof_latest"] = max(r["priced"] for r in crs)
                st["asof_oldest"] = min(r["priced"] for r in crs)
                srt = sorted(crs, key=lambda r: (-r["basis"], r["city"]))
                k = 3 if len(crs) >= 6 else 1
                st["strong"], st["weak"] = srt[:k], list(reversed(srt[-k:]))
                if prev_map is not None:
                    ds = [r["wow"] for r in crs if r["wow"] is not None]
                    if len(ds) >= MIN_STAT:
                        st["wow_median"] = round(median(ds), 2)
                        st["wow_n"] = len(ds)
                        st["wow_up"] = sum(1 for d in ds if d > 0)
                        st["wow_dn"] = sum(1 for d in ds if d < 0)
            groups.append(st)
        out[g] = {"rows": rs, "contracts": groups,
                  "no_contract": [r for r in rs if r["contract"] is None],
                  "suspect": [r for r in rs if r["suspect"]],
                  "outliers": all_out}
    return out


MONTH_CODES = "FGHJKMNQUVXZ"
MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def headline_json(st):
    """One contract stat -> the compact record data/basis-states.json carries
    (and /basis renders). Only numbers the state section also prints."""
    con = st["contract"]
    rec = {"contract": f"{con[0]}{MONTH_CODES[con[1]]}{con[2] % 100:02d}",
           "label": f"{MONTH_ABBR[con[1]]} '{con[2] % 100:02d}", "n": st["n"],
           "outliers": len(st.get("outliers") or [])}
    if "median" in st:
        rec.update({"median": round(st["median"], 4), "lo": st["lo"], "hi": st["hi"]})
        if "wow_median" in st:
            rec.update({"wow": st["wow_median"], "wow_n": st["wow_n"]})
    return rec


def selftest():
    def row(i, b, con=("ZC", 11, 2026), crop="corn", group="corn", fut_off=False):
        return {"source": f"s{i}", "group": group, "crop": crop, "commodity": "Corn", "period": "2026-10",
                "contract": con, "basis": b, "cash": 4.2 + b, "priced": i, "city": f"T{i}",
                "operator": f"Op{i}", "fut_off": fut_off}
    # Hand-worked: 9 corn bids around -0.40 and one at +1.40.
    vals = [-0.30, -0.35, -0.38, -0.40, -0.40, -0.42, -0.45, -0.50, -0.55, 1.40]
    rs = [row(i, v) for i, v in enumerate(vals)]
    s = state_basis(rs, None)["corn"]
    h = s["contracts"][0]
    # median of all ten is -0.40; MAD = median(|x+0.40|) = median(.10,.05,.02,0,0,.02,.05,.10,.15,1.80)
    # = (0.05+0.05)/2 = 0.05 -> 1.4826*0.05 = 0.074, floored to 0.15 -> gate 0.75. +1.40 is 1.80 out: excluded.
    assert [r["basis"] for r in h["outliers"]] == [1.40], h["outliers"]
    assert h["n"] == 9 and h["hi"] == -0.30 and h["lo"] == -0.55, h
    assert abs(h["median"] - (-0.40)) < 1e-9
    assert h["strong"][0]["basis"] == -0.30, "the outlier must not top the strongest list"
    assert s["outliers"] and s["outliers"][0]["outlier"]["dist"] == 1.8
    # a tight group: MAD = 0 -> the scale floors at 0.15 -> gate 0.75. A plant
    # bid 50c over the crowd stays; one 80c over goes.
    tight = [-0.40] * 8 + [0.10, 0.40]
    t = state_basis([row(i, v) for i, v in enumerate(tight)], None)["corn"]["contracts"][0]
    assert [r["basis"] for r in t["outliers"]] == [0.40] and t["n"] == 9 and t["hi"] == 0.10, t
    # fewer than OUTLIER_MIN_N: nothing excluded
    few = state_basis([row(i, v) for i, v in enumerate([-0.4, -0.4, -0.4, 1.4])], None)["corn"]["contracts"][0]
    assert few["n"] == 4 and not few["outliers"]
    # unnamed contract: listed, never counted; another contract is its own group
    mix = [row(i, -0.4) for i in range(4)] + [row(9, 0.10, con=("ZC", 2, 2027)), row(10, -0.9, con=None)]
    m = state_basis(mix, None)["corn"]
    assert m["contracts"][0]["n"] == 4 and m["contracts"][1]["n"] == 1 and len(m["no_contract"]) == 1
    # suspect: implied futures off -> out of every statistic
    sus = state_basis([row(i, -0.4) for i in range(3)] + [row(5, -0.1, fut_off=True)], None)["corn"]
    assert sus["contracts"][0]["n"] == 3 and len(sus["suspect"]) == 1
    # week-over-week: matched pairs only, median of the changes in cents
    prev = {match_key(r): r["basis"] - 0.05 for r in rs[:6]}
    w = state_basis([row(i, v) for i, v in enumerate(vals)], prev)["corn"]["contracts"][0]
    assert w["wow_median"] == 5.0 and w["wow_n"] == 6, w
    j = headline_json(w)
    assert j["contract"] == "ZCZ26" and j["label"] == "Dec '26" and j["n"] == 9 and j["outliers"] == 1 and j["wow_n"] == 6
    print("basis_method selftest OK")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
