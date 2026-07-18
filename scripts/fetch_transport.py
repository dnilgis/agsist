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
import os
import sys
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone

BASE = "https://agtransport.usda.gov/resource/{}.json"
UA = {"User-Agent": "AGSIST/1.0 (+https://agsist.com)"}
OUT_DIR = "data/transport"
HIST_WEEKS = 26
AVG_YEARS = 5


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


def same_week_avg(rows_by_year_week, week, latest_year, value_key):
    """Average of this ISO-week's value over the prior AVG_YEARS years."""
    vals = []
    for y in range(latest_year - AVG_YEARS, latest_year):
        # accept the exact week or a neighbour (weekly series wobble)
        for w in (week, week - 1, week + 1):
            v = rows_by_year_week.get((y, w), {}).get(value_key)
            if v is not None:
                vals.append(v)
                break
    return round(sum(vals) / len(vals), 3) if vals else None


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
        y, w = int(latest_date[:4]), week_of_year(latest_date)
        byw = {(int(d[:4]), week_of_year(d)): {"v": v} for d, v in pts}
        avg5 = same_week_avg(byw, w, y, "v")
        out["|".join(k)] = {
            "latest": round(latest, 3),
            "date": latest_date,
            "avg5": avg5,
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
                 "note": note, "series": basis}
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
    # fail-loud path: empty dataset must raise
    try:
        build(fetch=lambda ds, p: [])
        raise AssertionError("empty dataset did not fail loud")
    except SystemExit:
        pass
    print("SELFTEST OK — shaping, same-week avg, delta, history window, fail-loud")


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
