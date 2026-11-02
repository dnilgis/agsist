#!/usr/bin/env python3
"""agstocks_index.py -- the AGSIST Ag 20 and the two side baskets, from stored closes.

Pure functions, no network. scripts/agstocks.py calls build() each run with the
whole stored history (data/agstocks/closes/<year>.json), so a level is always
rebuilt from the rows it came from.

THE RULES (design A in the research note, the method published on /ag-stocks)
  Equal weight, price return, base 1000.00 at the first session on or after the
  base date (2026-11-02) on which every eligible member has a close.
  Eligible on a date, using only rows from BEFORE that date:
    at least 60 sessions of closes, and a median daily dollar volume (close x
    shares traded) of at least $1 million over the last 60 of them.
  Too few eligible (Ag 20: under 13; a side basket: under 5): the index is not
  published and says why.
  Notional shares: at the base and at each rebalance close every member gets
  level / n dollars, so shares[i] = level / n / close[i]. Between rebalances the
  level is sum(shares[i] * close[i]) and the weights drift with the prices.
  Rebalance: at the close of the first session of January, April, July and
  October (after each quarter end), members re-checked with rows before that
  session. The level at that close is the same before and after (the divisor
  test in --selftest).
  A split multiplies the member's shares by the split ratio on its date, so the
  split itself moves nothing.
  A member removed (it stops trading, is bought out) leaves at its last close:
  its value is spread over the others in proportion, the level does not move.
  A missing close is never a 0% day of its own: the member's last close is
  carried for ONE session and the day is marked stale with its ticker. Missing
  two sessions or more, the level is held (the last level, change None) and the
  day says which member has no close since when. When the close comes back the
  level is computed from the prices again.

    build(spec, sessions, closes, volumes, splits=None, removals=None, base_from=...)
      -> {"status": "pending"|"live"|"suppressed", "levels": [...], "members": [...], ...}

    python3 scripts/agstocks_index.py --selftest
"""
try: import _argguard; _argguard.guard(__file__)  # --help and bad flags exit before any work
except ImportError: pass
import statistics
import sys

BASE_FROM = "2026-11-02"
BASE_LEVEL = 1000.0
MIN_SESSIONS = 60
MIN_DOLLAR_VOL = 1_000_000.0
REBAL_MONTHS = (1, 4, 7, 10)


def eligible(tickers, sessions, closes, volumes, before, min_sessions=MIN_SESSIONS, min_dv=MIN_DOLLAR_VOL):
    """(eligible tickers, {ticker: why not}) using only sessions strictly before `before`."""
    prior = [d for d in sessions if d < before]
    ok, why = [], {}
    for t in tickers:
        c, v = closes.get(t) or {}, volumes.get(t) or {}
        have = [d for d in prior if c.get(d) is not None]
        if len(have) < min_sessions:
            why[t] = f"{len(have)} sessions of closes before {before}, needs {min_sessions}"
            continue
        last = have[-min_sessions:]
        dv = [c[d] * v[d] for d in last if v.get(d) is not None]
        if len(dv) < min_sessions // 2:
            why[t] = "no trading volume on file"
            continue
        med = statistics.median(dv)
        if med < min_dv:
            why[t] = f"median daily dollar volume ${med:,.0f}, needs ${min_dv:,.0f}"
            continue
        ok.append(t)
    return ok, why


def _is_rebalance(prev_d, d):
    return prev_d is not None and int(d[5:7]) in REBAL_MONTHS and d[:7] != prev_d[:7]


def build(spec, sessions, closes, volumes, splits=None, removals=None, base_from=BASE_FROM,
          base_level=BASE_LEVEL, min_sessions=MIN_SESSIONS, min_dv=MIN_DOLLAR_VOL):
    """spec: {"key", "name", "tickers": [...], "min_members": int}
    sessions: sorted session dates (YYYY-MM-DD). closes / volumes: {ticker: {date: float}}.
    splits: {ticker: {date: ratio}} (2.0 = two for one). removals: {ticker: date}."""
    splits = splits or {}
    removals = removals or {}
    tickers = list(spec["tickers"])
    out = {"key": spec["key"], "name": spec["name"], "base_from": base_from, "base_level": base_level,
           "levels": [], "rebalances": [], "excluded": {}, "removed": []}
    later = [d for d in sessions if d >= base_from]
    if not later:
        out["status"] = "pending"
        return out
    # The base: first session on/after base_from where every eligible member has a close.
    base = None
    for d in later:
        ok, why = eligible(tickers, sessions, closes, volumes, d, min_sessions, min_dv)
        ok = [t for t in ok if not (t in removals and removals[t] <= d)]
        if len(ok) < spec["min_members"]:
            out.update(status="suppressed", excluded=why,
                       why=f"{len(ok)} members qualify on {d}, needs {spec['min_members']}")
            return out
        if all(closes.get(t, {}).get(d) is not None for t in ok):
            base, members, out["excluded"] = d, ok, why
            break
    if base is None:
        out["status"] = "pending"
        return out
    level = base_level
    shares = {t: level / len(members) / closes[t][base] for t in members}
    last_px = {t: closes[t][base] for t in members}
    last_seen = {t: base for t in members}
    out["levels"].append({"d": base, "v": round(level, 2), "chg": None, "n": len(members), "base": True})
    out["rebalances"].append({"d": base, "members": list(members), "kind": "base"})
    prev_d, pending_rebal = base, False
    for d in [x for x in sessions if x > base]:
        if _is_rebalance(prev_d, d):
            pending_rebal = True
        missing2, stale = [], []
        px = {}
        for t in members:
            r = splits.get(t, {}).get(d)
            if r:
                shares[t] *= r
                last_px[t] /= r
            c = closes.get(t, {}).get(d)
            if c is not None:
                px[t] = c
                last_px[t] = c
                last_seen[t] = d
            else:
                gap = sum(1 for s in sessions if last_seen[t] < s <= d)
                px[t] = last_px[t]
                (stale if gap == 1 else missing2).append(t)
        prev_level = out["levels"][-1]["v"]
        if missing2:
            out["levels"].append({"d": d, "v": prev_level, "chg": None, "n": len(members), "held": True,
                                  "why": [[t, last_seen[t]] for t in sorted(missing2)]})
            prev_d = d
            continue
        level = sum(shares[t] * px[t] for t in members)
        row = {"d": d, "v": round(level, 2), "chg": round((level / prev_level - 1) * 100, 2), "n": len(members)}
        if stale:
            row["stale"] = sorted(stale)
        held_before = out["levels"][-1].get("held")
        if held_before:
            row["since"] = next(x["d"] for x in reversed(out["levels"]) if not x.get("held"))
        # Removals at this close: spread the leaver's value over the others.
        for t in [t for t in members if t in removals and removals[t] <= d]:
            v_out = shares[t] * px[t]
            rest = [m for m in members if m != t]
            k = level / (level - v_out)
            for m in rest:
                shares[m] *= k
            members = rest
            del shares[t]
            out["removed"].append({"t": t, "d": d})
        if pending_rebal and not stale:
            ok, why = eligible(tickers, sessions, closes, volumes, d, min_sessions, min_dv)
            ok = [t for t in ok if not (t in removals and removals[t] <= d) and closes.get(t, {}).get(d) is not None]
            if len(ok) < spec["min_members"]:
                row["note"] = f"rebalance skipped: {len(ok)} qualify, needs {spec['min_members']}"
            else:
                members = ok
                shares = {t: level / len(members) / closes[t][d] for t in members}
                for t in members:
                    last_px[t] = closes[t][d]
                    last_seen[t] = d
                out["rebalances"].append({"d": d, "members": list(members), "kind": "quarterly", "excluded": why})
                row["rebalance"] = True
                row["n"] = len(members)
            pending_rebal = False
        out["levels"].append(row)
        prev_d = d
    out["status"] = "live"
    out["base"] = base
    out["members"] = list(members)
    return out


# ── selftest: a fixed fixture, every rule ────────────────────────────────────
def _fixture(n_tickers=4, n_pre=62, n_post=8, start="2026-08-01"):
    from datetime import date, timedelta
    d0 = date.fromisoformat(start)
    days = []
    d = d0
    while len(days) < n_pre + n_post:
        if d.weekday() < 5:
            days.append(d.isoformat())
        d += timedelta(days=1)
    tick = [f"T{i}" for i in range(n_tickers)]
    closes = {t: {} for t in tick}
    vols = {t: {} for t in tick}
    for i, t in enumerate(tick):
        for j, dd in enumerate(days):
            closes[t][dd] = 10.0 * (i + 1) + j * 0.1 * (i + 1)
            vols[t][dd] = 1_000_000.0
    return days, tick, closes, vols


def selftest():
    fails = []

    def check(cond, msg):
        if not cond:
            fails.append(msg)

    days, tick, closes, vols = _fixture()
    base_from = days[62]
    spec = {"key": "t", "name": "Test", "tickers": tick, "min_members": 3}

    # 1. pending before the base date
    r = build(spec, days[:62], closes, vols, base_from=base_from)
    check(r["status"] == "pending" and not r["levels"], "pending before base date")

    # 2. equal weight at the base: each member holds 250 of 1000
    r = build(spec, days, closes, vols, base_from=base_from)
    check(r["status"] == "live" and r["base"] == base_from, f"base on {base_from}: {r.get('base')}")
    check(r["levels"][0]["v"] == 1000.0, "base level 1000.00")
    # day 2 by hand: sum 250 * p1/p0
    d0, d1 = days[62], days[63]
    want = sum(250.0 * closes[t][d1] / closes[t][d0] for t in tick)
    check(abs(r["levels"][1]["v"] - round(want, 2)) < 1e-9, f"equal weight day 2 {r['levels'][1]['v']} vs {want}")

    # 3. a member with too little history is left out, and says why
    c2 = {t: dict(v) for t, v in closes.items()}
    for dd in days[:30]:
        del c2["T3"][dd]
    r = build(spec, days, c2, vols, base_from=base_from)
    check(r["members"] == ["T0", "T1", "T2"] and "T3" in r["excluded"], "seasoning gate")
    # thin volume
    v2 = {t: dict(v) for t, v in vols.items()}
    v2["T0"] = {dd: 10.0 for dd in days}
    r = build(spec, days, closes, v2, base_from=base_from)
    check("T0" not in r["members"] and "dollar volume" in r["excluded"]["T0"], "dollar volume gate")
    # too few: suppressed
    spec5 = dict(spec, min_members=5)
    r = build(spec5, days, closes, vols, base_from=base_from)
    check(r["status"] == "suppressed" and "needs 5" in r["why"], "suppressed under the minimum")

    # 4. stale: one missing session is carried and marked, two hold the level
    c3 = {t: dict(v) for t, v in closes.items()}
    del c3["T1"][days[64]]
    r = build(spec, days, c3, vols, base_from=base_from)
    row = next(x for x in r["levels"] if x["d"] == days[64])
    check(row.get("stale") == ["T1"] and row["chg"] is not None, "one missing session: stale, carried")
    want = sum(250.0 * (closes[t][days[64]] if t != "T1" else closes[t][days[63]]) / closes[t][d0] for t in tick)
    check(abs(row["v"] - round(want, 2)) < 1e-9, "stale carries the last close")
    del c3["T1"][days[65]]
    r = build(spec, days, c3, vols, base_from=base_from)
    row = next(x for x in r["levels"] if x["d"] == days[65])
    prev = next(x for x in r["levels"] if x["d"] == days[64])
    check(row.get("held") and row["v"] == prev["v"] and row["chg"] is None, "two missing: level held, no 0% change")
    check(row["why"] == [["T1", days[63]]], f"held says which member and since when: {row.get('why')}")
    back = next(x for x in r["levels"] if x["d"] == days[66])
    want = sum(250.0 * closes[t][days[66]] / closes[t][d0] for t in tick)
    check(abs(back["v"] - round(want, 2)) < 1e-9 and back.get("since") == days[64], "back from held: priced again")

    # 5. rebalance: divisor continuity at the rebalance close, equal weight after
    days2, tick2, closes2, vols2 = _fixture(n_pre=62, n_post=70, start="2026-07-01")
    bf = "2026-09-25"
    r = build(dict(spec, tickers=tick2), days2, closes2, vols2, base_from=bf)
    rb = [x for x in r["levels"] if x.get("rebalance")]
    check(len(rb) == 1 and rb[0]["d"][:7] == "2026-10", f"one rebalance, first session of October: {[x['d'] for x in rb]}")
    if rb:
        i = next(k for k, x in enumerate(r["levels"]) if x.get("rebalance"))
        base = r["levels"][0]["d"]
        before = sum(250.0 * closes2[t][rb[0]["d"]] / closes2[t][base] for t in tick2)
        check(abs(rb[0]["v"] - round(before, 2)) < 1e-9, "divisor continuity: level at the rebalance close unchanged")
        nxt = r["levels"][i + 1]
        L = before
        want = sum(L / 4 * closes2[t][nxt["d"]] / closes2[t][rb[0]["d"]] for t in tick2)
        check(abs(nxt["v"] - round(want, 2)) < 1e-6, "equal weight again after the rebalance")

    # 6. a split moves nothing
    c4 = {t: dict(v) for t, v in closes.items()}
    for dd in days[65:]:
        c4["T2"][dd] = closes["T2"][dd] / 2.0
    r_split = build(spec, days, c4, vols, splits={"T2": {days[65]: 2.0}}, base_from=base_from)
    r_plain = build(spec, days, closes, vols, base_from=base_from)
    check([x["v"] for x in r_split["levels"]] == [x["v"] for x in r_plain["levels"]], "split is zero return")

    # 7. a removal does not move the level, the rest carry on in proportion
    r = build(spec, days, closes, vols, removals={"T3": days[65]}, base_from=base_from)
    lv = {x["d"]: x["v"] for x in r["levels"]}
    check(lv[days[65]] == r_plain["levels"][3]["v"], "removal day priced with the leaver")
    check(r["members"] == ["T0", "T1", "T2"] and r["removed"] == [{"t": "T3", "d": days[65]}], "member removed")
    L = sum(250.0 * closes[t][days[65]] / closes[t][d0] for t in tick)
    v_out = 250.0 * closes["T3"][days[65]] / closes["T3"][d0]
    k = L / (L - v_out)
    want = sum(k * 250.0 * closes[t][days[66]] / closes[t][d0] for t in ["T0", "T1", "T2"])
    check(abs(lv[days[66]] - round(want, 2)) < 1e-9, "after removal: others scaled, no jump")

    if fails:
        for f in fails:
            print("FAIL", f)
        return 1
    print("agstocks_index selftest: ok (equal weight, gates, stale, held, rebalance continuity, split, removal)")
    return 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sys.exit(selftest())
    print(__doc__)
