#!/usr/bin/env python3
"""fetch_transport.py — AgTransport (USDA Socrata) → the data behind two pages:

  /basis          "Your elevator didn't cut your basis. The river did."
  /bushel-journey what it costs to move a bushel to the ocean this week

Datasets (probe-verified live + current 2026-07-18, no API key needed):
  grain_basis          v85y-3hep  weekly regional basis since 2007
  grain_price_spreads  an4w-mnp7  origin bid vs destination bid (14 origins)
  barge_rates          deqi-uken  7 locations, % of 1976 tariff
  transport_cost_idx   8uye-ieij  truck/shuttle/barge/vessel cost indexes

Outputs (compact, page-ready):
  data/transport/basis.json    per commodity×market: latest basis, same-week
                               5-yr average, delta, 26-week history
  data/transport/journey.json  barge rates (latest vs 5-yr same-week avg per
                               location) + cost indexes + latest spreads

Honesty contract carried into the JSON: attribution is REGIONAL (named
markets/origins), never a specific elevator — the pages must say so.
Gotcha honored: the barge location is 'Lower Illinois' (the AMS docs'
'Illinois River' returns zero rows silently — probe-verified).

Fail-loud: zero rows from any dataset exits 1 (red workflow beats a
silently stale page). Retry/backoff on transport errors. --selftest is
offline and gates the workflow.
"""
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone

BASE = "https://agtransport.usda.gov/resource/{}.json"
UA = {"User-Agent": "AGSIST/1.0 (+https://agsist.com)"}
OUT_DIR = "data/transport"
HIST_WEEKS = 26
AVG_YEARS = 5
# Plausible basis band, $/bu vs futures. USDA's weekly regional basis sits
# well inside +/-$3 for every series this file carries; +/-$5 leaves room for
# a real extreme and still catches a typo or a cents-for-dollars slip.
# 2026-10-06: Soybeans|Atlantic Coast|30-Day to Arrive posted -10.248 for
# 2026-07-10 between -0.248 (Jul 2) and -0.25 (Jul 17). The pipeline does no
# unit conversion, so the figure came from the source as printed; it reads as
# -0.248 with a stray leading "10". It is rejected, not repaired: we do not
# guess what USDA meant.
BASIS_BAND = 5.0


def get_json(dataset, params):
    url = BASE.format(dataset) + "?" + urllib.parse.urlencode(params)
    last = None
    for attempt, pause in enumerate((0, 20, 60, 180)):
        if pause:
            print(f"  retry {attempt}/3 after {pause}s", file=sys.stderr)
            time.sleep(pause)
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001 — retried, then fatal below
            last = e
    raise SystemExit(f"FATAL: {dataset} unreachable after retries: {last}")


def week_of_year(date_s):
    return datetime.strptime(date_s[:10], "%Y-%m-%d").isocalendar()[1]


def iso_year_week(date_s):
    """(ISO year, ISO week). A late-December or early-January date belongs
    to the ISO year its week belongs to; keying on the calendar year put
    2025-12-29 (ISO 2026-W01) in 2025's week 1 (2026-10-05)."""
    y, w, _ = datetime.strptime(date_s[:10], "%Y-%m-%d").isocalendar()
    return y, w


def same_week_avg(rows_by_year_week, week, latest_year, value_key):
    """Average of this ISO-week's value over the prior AVG_YEARS years."""
    return same_week_avg_n(rows_by_year_week, week, latest_year, value_key)[0]


def same_week_avg_n(rows_by_year_week, week, latest_year, value_key):
    """(average, years found). WAVE1-A: the homepage prints the sample beside
    the comparison and withholds it under three years, so the count travels
    with the average."""
    vals = []
    for y in range(latest_year - AVG_YEARS, latest_year):
        # accept the exact week or a neighbour (weekly series wobble)
        for w in (week, week - 1, week + 1):
            v = rows_by_year_week.get((y, w), {}).get(value_key)
            if v is not None:
                vals.append(v)
                break
    return (round(sum(vals) / len(vals), 3) if vals else None), len(vals)


def basis_guard(rows, band=BASIS_BAND):
    """Split grain_basis rows into (kept, rejected). A row whose basis is not a
    number is left for series_stats to skip as before; a number outside
    +/-band is rejected with its reason, logged, and written to the JSON so the
    pages can say a point was left out."""
    kept, rejected = [], []
    for r in rows:
        try:
            v = float(r["basis"])
        except (KeyError, TypeError, ValueError):
            kept.append(r)
            continue
        if v != v or abs(v) > band:
            key = "|".join(str(r.get(f, "")).strip() for f in ("commodity", "market_name", "market_type"))
            why = f"basis {v} $/bu is outside the plausible band of +/-{band} $/bu"
            rejected.append({"series": key, "date": str(r.get("date", ""))[:10], "value": v, "reason": why})
            print(f"  grain_basis: rejected {key} {str(r.get('date', ''))[:10]}: {why}", file=sys.stderr)
            continue
        kept.append(r)
    rejected.sort(key=lambda x: (x["series"], x["date"]))
    return kept, rejected


# ONE-WEEK JUMPS ARE HELD UNTIL THE NEXT WEEK CONFIRMS THEM (2026-10-10).
# USDA's week of 2026-10-02 moved Kansas corn from -$0.35 to -$1.60, North
# Carolina soybeans from -$0.05 to -$4.50 and Kansas HRW from -$0.68 to -$3.94
# in one week, in most interior regions at once. That is a break in the file,
# not a market, and it sat inside the +/-$5 band. A point whose move from the
# last kept week is bigger than JUMP_FLOOR, or than the crop's own 99.5th
# percentile weekly move if that is bigger, is HELD: kept out of the history,
# the average and the table, and listed with the move. It is accepted when the
# week after it stays within the same distance of it (the new level held); a
# point that snaps back is dropped as a one-week blip.
# Why 50c: over the weekly changes this repo has on file (Apr-Sep 2026, about
# 260 per crop across the state elevator series) the 99.5th percentile was
# 26c corn, 27c soybeans, 46c wheat, and no corn or soybean elevator series
# moved more than 27c in a week. 50c is about twice that for corn and beans
# and still above wheat's tail. The run recomputes the percentile from its own
# 6-year pull and uses it when it is larger, so a crop whose ordinary weeks
# run wider gets a wider gate; both figures are written to the JSON.
JUMP_FLOOR = 0.50
JUMP_PCT = 0.995
JUMP_MAX_GAP_DAYS = 9      # consecutive weekly postings only; a gap is not a week
JUMP_RECENT_DAYS = 28      # the newest four weeks are judged, not used to set the gate


def crop_family(commodity):
    """'Corn', 'Soybeans', or 'Wheat' for any wheat class: the gate is set per
    crop, and the three wheat classes share one history to have enough of it."""
    c = str(commodity or "")
    return "Wheat" if "wheat" in c.lower() else c


def _days(a, b):
    return (datetime.strptime(b[:10], "%Y-%m-%d") - datetime.strptime(a[:10], "%Y-%m-%d")).days


def jump_thresholds(rows, floor=JUMP_FLOOR, pct=JUMP_PCT):
    """{crop family: {"threshold", "p995", "n"}} from every consecutive weekly
    change in the state elevator-bid series (the rows the page tables show).
    The percentile is nearest-rank on the sorted absolute changes. Changes
    landing in the last JUMP_RECENT_DAYS of the pull are left out: those are
    the weeks being judged, and a break across ten regions at once would
    otherwise widen its own gate."""
    by = defaultdict(list)
    for r in rows:
        if str(r.get("market_type", "")).strip() != "Elevator Bid":
            continue
        try:
            v = float(r["basis"])
        except (KeyError, TypeError, ValueError):
            continue
        by[(r.get("commodity"), r.get("market_name"))].append((str(r["date"])[:10], v))
    last = max((d for pts in by.values() for d, _ in pts), default="")
    ch = defaultdict(list)
    for (comm, _), pts in by.items():
        pts.sort()
        for (d0, v0), (d1, v1) in zip(pts, pts[1:]):
            if 0 < _days(d0, d1) <= JUMP_MAX_GAP_DAYS and _days(d1, last) >= JUMP_RECENT_DAYS:
                ch[crop_family(comm)].append(abs(v1 - v0))
    out = {}
    for fam, v in ch.items():
        v.sort()
        p = v[min(len(v) - 1, max(0, math.ceil(pct * len(v)) - 1))] if v else None
        out[fam] = {"threshold": round(max(floor, p or 0), 3), "p995": round(p, 3) if p is not None else None,
                    "n": len(v)}
    return out


def hold_jumps(pts, thr):
    """pts sorted [(date, value)] -> (kept, held). held: [{date, value, prev,
    prev_date, move, status}] where status is "held" (the newest point, no week
    after it yet) or "blip" (the week after snapped back)."""
    kept, held = [], []
    for i, (d, v) in enumerate(pts):
        if not kept:
            kept.append((d, v))
            continue
        pd, pv = kept[-1]
        if abs(v - pv) <= thr + 1e-9:
            kept.append((d, v))
            continue
        nxt = pts[i + 1] if i + 1 < len(pts) else None
        if nxt is not None and abs(nxt[1] - v) <= thr + 1e-9:
            kept.append((d, v))           # the next week stayed at the new level
            continue
        held.append({"date": d, "value": round(v, 3), "prev": round(pv, 3), "prev_date": pd,
                     "move": round(v - pv, 3), "status": "held" if nxt is None else "blip"})
    return kept, held


def apply_holds(rows, key_fields=("commodity", "market_name", "market_type"), thresholds=None):
    """rows -> (rows kept, {series key: [held points]}, thresholds).

    Then ONE WEEK PER TABLE: within each (commodity, market type), if any
    series has its newest posting held, every series in that group is cut back
    to the week before, so a table never prints one region's new week beside
    another region's old one. The cut is listed per group in "weeks"."""
    thresholds = thresholds if thresholds is not None else jump_thresholds(rows)
    grouped = defaultdict(list)
    for r in rows:
        try:
            float(r["basis"])
        except (KeyError, TypeError, ValueError):
            continue
        grouped[tuple(str(r.get(f, "")).strip() for f in key_fields)].append(r)
    kept_rows, held = [], {}
    for k, rs in grouped.items():
        rs.sort(key=lambda r: str(r["date"])[:10])
        fam = crop_family(k[0])
        thr = (thresholds.get(fam) or {}).get("threshold", JUMP_FLOOR)
        kept, h = hold_jumps([(str(r["date"])[:10], float(r["basis"])) for r in rs], thr)
        keep_dates = {d for d, _ in kept}
        kept_rows += [r for r in rs if str(r["date"])[:10] in keep_dates]
        if h:
            held["|".join(k)] = h
            for x in h:
                print(f"  grain_basis: held {'|'.join(k)} {x['date']}: {x['prev']} -> {x['value']} "
                      f"({x['move']:+.3f} $/bu in one week, gate {thr} $/bu, {x['status']})", file=sys.stderr)
    return kept_rows, held, thresholds


def one_week_per_group(rows, held, raw_rows, key_fields=("commodity", "market_name", "market_type")):
    """-> (rows cut to each group's table week, weeks doc). weeks[group] =
    {week, newest, held: [series...], waiting: [series...]}: `newest` is the
    newest week USDA posted for the group; `week` is the week the table
    shows. They differ only when a newest posting is held."""
    newest = defaultdict(str)
    for r in raw_rows:
        g = (str(r.get("commodity", "")).strip(), str(r.get("market_type", "")).strip())
        newest[g] = max(newest[g], str(r.get("date", ""))[:10])
    held_new = defaultdict(list)
    for key, hs in held.items():
        p = key.split("|")
        g = (p[0], p[2])
        if any(x["status"] == "held" and x["date"] == newest[g] for x in hs):
            held_new[g].append(key)
    weeks = {}
    out = []
    by_g = defaultdict(list)
    for r in rows:
        by_g[(str(r.get("commodity", "")).strip(), str(r.get("market_type", "")).strip())].append(r)
    for g, rs in by_g.items():
        week = newest[g]
        if held_new.get(g):
            week = max((str(r["date"])[:10] for r in rs if str(r["date"])[:10] < newest[g]), default="")
        cut = [r for r in rs if str(r["date"])[:10] <= week]
        out += cut
        waiting = sorted({"|".join(str(r.get(f, "")).strip() for f in key_fields)
                          for r in rs if str(r["date"])[:10] > week} - set(held_new.get(g, [])))
        weeks["|".join(g)] = {"week": week, "newest": newest[g], "held": sorted(held_new.get(g, [])),
                              "waiting": waiting}
    return out, weeks


def series_stats(rows, key_fields, value_field, date_field="date"):
    """rows -> {series_key: {latest, latest_date, avg5, delta, hist[]}}"""
    grouped = defaultdict(list)
    for r in rows:
        try:
            v = float(r[value_field])
        except (KeyError, TypeError, ValueError):
            continue
        k = tuple(str(r.get(f, "")).strip() for f in key_fields)
        grouped[k].append((r[date_field][:10], v))
    out = {}
    for k, pts in grouped.items():
        pts.sort()
        latest_date, latest = pts[-1]
        y, w = iso_year_week(latest_date)
        byw = {iso_year_week(d): {"v": v} for d, v in pts}
        avg5, avg5_n = same_week_avg_n(byw, w, y, "v")
        out["|".join(k)] = {
            "latest": round(latest, 3),
            "date": latest_date,
            "avg5": avg5,
            "avg5_n": avg5_n,
            "delta": round(latest - avg5, 3) if avg5 is not None else None,
            "hist": [[d, round(v, 3)] for d, v in pts[-HIST_WEEKS:]],
        }
    return out


def build(fetch=get_json):
    since = f"{datetime.now(timezone.utc).year - AVG_YEARS - 1}-01-01"
    basis_rows = fetch("v85y-3hep", {
        "$where": f"date >= '{since}'", "$limit": 50000,
        "$select": "date,market_name,market_type,commodity,basis"})
    barge_rows = fetch("deqi-uken", {
        "$where": f"date >= '{since}'", "$limit": 50000,
        "$select": "date,location,rate"})
    cost_rows = fetch("8uye-ieij", {
        "$where": f"date >= '{since}'", "$limit": 50000})
    spread_rows = fetch("an4w-mnp7", {
        "$order": "date DESC", "$limit": 400,
        "$select": "date,commodity,origin,destination,origin_bid,destination_bid,price_spread"})

    for name, rows in (("grain_basis", basis_rows), ("barge_rates", barge_rows),
                       ("transport_cost_idx", cost_rows), ("grain_price_spreads", spread_rows)):
        if not rows:
            raise SystemExit(f"FATAL: {name} returned zero rows — refusing to write stale data")
        print(f"  {name}: {len(rows)} rows")

    # AUDIT 2026-08-11: USDA AgTransport currently publishes "Southeast" rows
    # byte-identical to "North Dakota" (verified upstream on four consecutive
    # weeks). Drop any region whose full series duplicates another region's —
    # republishing the copy as regional data is worse than omitting it.
    _sig = {}
    for r in basis_rows:
        k = (r.get("commodity"), r.get("market_name"))
        _sig.setdefault(k, []).append((r.get("date"), r.get("basis")))
    _dupes = set()
    _seen = {}
    for (comm, mkt), series in _sig.items():
        key = (comm, tuple(sorted(series)))
        if key in _seen and mkt != _seen[key]:
            _dupes.add((comm, mkt))
            print(f"  grain_basis: dropping {mkt!r} ({comm}) — series identical to {_seen[key]!r}")
        else:
            _seen.setdefault(key, mkt)
    if _dupes:
        basis_rows = [r for r in basis_rows
                      if (r.get("commodity"), r.get("market_name")) not in _dupes]
    basis_rows, rejected = basis_guard(basis_rows)
    raw_rows = basis_rows
    basis_rows, held, thresholds = apply_holds(basis_rows)
    basis_rows, weeks = one_week_per_group(basis_rows, held, raw_rows)
    basis = series_stats(basis_rows, ["commodity", "market_name", "market_type"], "basis")
    barge = series_stats(barge_rows, ["location"], "rate")

    cost_latest = max(cost_rows, key=lambda r: r["date"])
    spreads_latest = {}
    for r in spread_rows:  # newest-first; keep first per (commodity, origin, dest)
        k = f"{r.get('commodity','')}|{r.get('origin','')}|{r.get('destination','')}"
        if k not in spreads_latest:
            try:
                spreads_latest[k] = {
                    "date": r["date"][:10],
                    "origin_bid": round(float(r["origin_bid"]), 4),
                    "destination_bid": round(float(r["destination_bid"]), 4),
                    "spread": round(float(r["price_spread"]), 4),
                }
            except (KeyError, TypeError, ValueError):
                continue

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    note = ("Attribution is regional (named markets and origins), not any specific "
            "elevator. Basis in $/bu vs futures; barge rate is % of 1976 benchmark tariff.")
    basis_doc = {"generated": stamp, "source": "USDA AgTransport grain_basis v85y-3hep",
                 "note": note, "band": BASIS_BAND, "rejected": rejected,
                 "jump": {"floor": JUMP_FLOOR, "pct": JUMP_PCT, "by_crop": thresholds},
                 "held": held, "weeks": weeks, "series": basis}
    journey_doc = {"generated": stamp, "note": note,
                   "barge": barge,
                   "cost_index": {k: v for k, v in cost_latest.items()},
                   "spreads": spreads_latest}
    return basis_doc, journey_doc


def selftest():
    """Offline: synthetic rows through the whole shaping path."""
    rows = []
    for y in range(2020, 2026):
        for wk in range(1, 53):
            d = datetime.strptime(f"{y}-W{wk:02d}-5", "%G-W%V-%u").strftime("%Y-%m-%d")
            rows.append({"date": d, "market_name": "Iowa", "market_type": "Elevator Bid",
                         "commodity": "Corn", "basis": -0.30 - (0.05 if y == 2025 else 0)})
    s = series_stats(rows, ["commodity", "market_name", "market_type"], "basis")
    k = "Corn|Iowa|Elevator Bid"
    assert k in s, "series key missing"
    assert s[k]["avg5"] is not None, "same-week avg failed"
    assert abs(s[k]["delta"] - (-0.05)) < 0.011, f"delta wrong: {s[k]['delta']}"
    assert len(s[k]["hist"]) == HIST_WEEKS, "history window wrong"
    # WAVE1-A: the sample travels with the average. 2020-2024 behind 2025: five.
    assert s[k]["avg5_n"] == 5, f"avg5_n wrong: {s[k]['avg5_n']}"
    short = [r for r in rows if r["date"][:4] in ("2023", "2024", "2025")]
    s2 = series_stats(short, ["commodity", "market_name", "market_type"], "basis")
    assert s2[k]["avg5_n"] == 2, f"two prior years should count two: {s2[k]['avg5_n']}"
    # ISO year, not calendar year: 2025-12-29 is ISO 2026-W01 (hand-checked).
    assert iso_year_week("2025-12-29") == (2026, 1) and iso_year_week("2021-01-01") == (2020, 53)
    # A latest posting of 2025-12-31 is ISO 2026-W01: its prior years are
    # 2021-2025 week 1. Keyed on the calendar year it would average 2020-2024
    # week 1 and pull in 2020's -0.50 (avg -0.26).
    jan = [{"date": "2025-12-31", "market_name": "Iowa", "market_type": "Elevator Bid", "commodity": "Corn", "basis": -0.10}]
    for y in range(2020, 2026):
        d = datetime.strptime(f"{y}-W01-5", "%G-W%V-%u").strftime("%Y-%m-%d")
        jan.append({"date": d, "market_name": "Iowa", "market_type": "Elevator Bid", "commodity": "Corn",
                    "basis": -0.50 if y == 2020 else -0.20})
    sj = series_stats(jan, ["commodity", "market_name", "market_type"], "basis")[k]
    assert sj["avg5_n"] == 5 and abs(sj["avg5"] - (-0.20)) < 1e-9, sj
    # basis guard: the Atlantic Coast soybean typo is rejected and logged, the
    # weeks around it are kept, and the same-week stats never see it.
    atl = [{"date": d, "market_name": "Atlantic Coast", "market_type": "30-Day to Arrive",
            "commodity": "Soybeans", "basis": b}
           for d, b in (("2026-07-02", "-0.248"), ("2026-07-10", "-10.248"), ("2026-07-17", "-0.25"))]
    kept, rej = basis_guard(atl + [{"date": "2026-07-10", "basis": "n/a"}])
    assert [r["basis"] for r in kept[:2]] == ["-0.248", "-0.25"] and len(kept) == 3, kept
    assert len(rej) == 1 and rej[0]["value"] == -10.248 and rej[0]["date"] == "2026-07-10", rej
    assert rej[0]["series"] == "Soybeans|Atlantic Coast|30-Day to Arrive" and "band" in rej[0]["reason"]
    sa = series_stats(kept, ["commodity", "market_name", "market_type"], "basis")
    assert min(v for _, v in sa["Soybeans|Atlantic Coast|30-Day to Arrive"]["hist"]) == -0.25
    # a real wide basis stays; a cents-for-dollars slip (-25 for -0.25) goes
    assert len(basis_guard([{"basis": "-2.95"}, {"basis": "3.1"}])[0]) == 2
    assert len(basis_guard([{"basis": "-25"}])[1]) == 1
    # one-week jumps: held at the newest week, accepted when the next week
    # stays at the new level, dropped when it snaps back (hand-worked).
    k2, h2 = hold_jumps([("2026-09-18", -0.366), ("2026-09-25", -0.352), ("2026-10-02", -1.598)], 0.5)
    assert [v for _, v in k2] == [-0.366, -0.352] and h2[0]["status"] == "held" and h2[0]["move"] == -1.246, h2
    k3, h3 = hold_jumps([("2026-09-25", -0.35), ("2026-10-02", -1.60), ("2026-10-09", -1.55)], 0.5)
    assert len(k3) == 3 and not h3, (k3, h3)
    k4, h4 = hold_jumps([("2026-09-25", -0.35), ("2026-10-02", -1.60), ("2026-10-09", -0.36)], 0.5)
    assert [v for _, v in k4] == [-0.35, -0.36] and h4[0]["status"] == "blip", h4
    k5, h5 = hold_jumps([("2026-09-25", -0.35), ("2026-10-02", -0.84)], 0.5)
    assert len(k5) == 2 and not h5, "a 49c move is inside a 50c gate"
    # the gate: nearest-rank 99.5th percentile of the weekly moves, floored at
    # 50c. 199 moves of 10c and one of 90c: rank ceil(.995*200)=199 -> 10c, so
    # the floor rules; with two 60c moves on top, rank 199 is 60c.
    def series_of(moves, name):
        out, v = [], 0.0
        for i, m in enumerate([0.0] + moves):
            v += m if i % 2 else -m
            d = (datetime(2022, 1, 7) + timedelta(days=7 * i)).strftime("%Y-%m-%d")
            out.append({"date": d, "market_name": name, "market_type": "Elevator Bid",
                        "commodity": "Corn", "basis": round(v, 4)})
        return out
    quiet = [0.0] * 4          # the last four weeks are judged, not counted
    t1 = jump_thresholds(series_of([0.1] * 199 + [0.9] + quiet, "A"))["Corn"]
    assert t1 == {"threshold": 0.5, "p995": 0.1, "n": 200}, t1
    t2 = jump_thresholds(series_of([0.1] * 198 + [0.6, 0.6] + quiet, "A"))["Corn"]
    assert t2["threshold"] == 0.6 and t2["n"] == 200, t2
    # a ten-region break in the newest week does not widen its own gate
    t3 = jump_thresholds(series_of([0.1] * 200 + [1.2], "A"))["Corn"]
    assert t3["threshold"] == 0.5 and t3["n"] == 197, t3
    assert crop_family("Hard Red Winter Wheat") == crop_family("Soft Red Winter Wheat") == "Wheat"
    # one week per table: Kansas held at Oct 2 cuts Iowa back to Sep 25 too.
    wk = []
    for mkt, vals in (("Kansas", (-0.366, -0.352, -1.598)), ("Iowa", (-0.466, -0.432, -0.418))):
        for d, b in zip(("2026-09-18", "2026-09-25", "2026-10-02"), vals):
            wk.append({"date": d, "market_name": mkt, "market_type": "Elevator Bid", "commodity": "Corn", "basis": b})
    kept6, held6, _ = apply_holds(wk, thresholds={"Corn": {"threshold": 0.5}})
    cut6, weeks6 = one_week_per_group(kept6, held6, wk)
    assert weeks6["Corn|Elevator Bid"] == {"week": "2026-09-25", "newest": "2026-10-02",
                                           "held": ["Corn|Kansas|Elevator Bid"],
                                           "waiting": ["Corn|Iowa|Elevator Bid"]}, weeks6
    s6 = series_stats(cut6, ["commodity", "market_name", "market_type"], "basis")
    assert s6["Corn|Iowa|Elevator Bid"]["latest"] == -0.432 and s6["Corn|Kansas|Elevator Bid"]["latest"] == -0.352
    assert {x["date"] for x in s6.values()} == {"2026-09-25"}, "one week per table"
    # fail-loud path: empty dataset must raise
    try:
        build(fetch=lambda ds, p: [])
        raise AssertionError("empty dataset did not fail loud")
    except SystemExit:
        pass
    print("SELFTEST OK: shaping, same-week avg, delta, history window, jump hold, one week per table, fail-loud")


def main():
    if "--selftest" in sys.argv:
        return selftest()
    basis_doc, journey_doc = build()
    os.makedirs(OUT_DIR, exist_ok=True)
    json.dump(basis_doc, open(f"{OUT_DIR}/basis.json", "w"), separators=(",", ":"))
    json.dump(journey_doc, open(f"{OUT_DIR}/journey.json", "w"), separators=(",", ":"))
    print(f"wrote {OUT_DIR}/basis.json ({len(basis_doc['series'])} series) and "
          f"journey.json ({len(journey_doc['barge'])} barge locations, "
          f"{len(journey_doc['spreads'])} spreads)")


if __name__ == "__main__":
    main()
