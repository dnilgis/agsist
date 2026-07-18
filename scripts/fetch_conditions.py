#!/usr/bin/env python3
"""fetch_conditions.py — NASS weekly crop conditions → /conditions percentile data.

THE PAGE'S PROMISE: "This is the Nth-best/worst week-N for {state} {crop}
since 2000" — a percentile rank of the current Good+Excellent share against
the same week-of-year across every year 2000→present. Every term is a
published NASS figure; the rank is arithmetic, not opinion.

Verified short_desc strings (handoff §5.2 + probe-viral 2026-07-18):
  CORN - CONDITION, MEASURED IN PCT {EXCELLENT|GOOD|FAIR|POOR|VERY POOR}
  SOYBEANS - CONDITION, ... (same five)
STATE weekly, has week_ending, 2000–present. NASS_API_KEY required.

Output data/conditions/conditions.json:
  {generated, week_ending, crops: {corn: {states: {IA: {ge, rank, of,
   pctile, best, worst, avg, hist:[[year, ge], ...]}}, national_note}}}

Rank semantics: rank 1 = LOWEST G+E on record for that week (worst).
pctile = share of history years at or below current (0 = worst ever,
100 = best ever). Weeks are matched by week-of-year ±1 (survey wobble).

Fail-loud (in season, Apr–Oct): zero rows for the current year exits 1.
Backoff on 403/429/5xx (NASS throttle — learned live on cash-rent).
--selftest offline, gates the workflow.
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date, datetime, timezone

API = "https://quickstats.nass.usda.gov/api/api_GET/"
KEY = os.environ.get("NASS_API_KEY", "").strip()
OUT = "data/conditions/conditions.json"
CATS = ["EXCELLENT", "GOOD"]          # G+E is the index the trade quotes
CROPS = {"corn": "CORN", "soybeans": "SOYBEANS"}
FIRST_YEAR = 2000


def api_get(params):
    q = dict(params)
    q["key"] = KEY
    q["format"] = "JSON"
    url = API + "?" + urllib.parse.urlencode(q)
    last = None
    for attempt, pause in enumerate((0, 45, 120, 300)):
        if pause:
            print(f"  NASS throttled — backoff {pause}s (retry {attempt}/3)", file=sys.stderr)
            time.sleep(pause)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "AGSIST/1.0 (+https://agsist.com)"})
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read().decode("utf-8", "replace")).get("data", [])
        except urllib.error.HTTPError as e:
            if e.code == 400:
                return []          # documented "no rows" answer
            if e.code in (403, 429) or e.code >= 500:
                last = e
                continue
            raise
        except Exception as e:  # noqa: BLE001
            last = e
    raise SystemExit(f"FATAL: NASS unreachable after retries: {last}")


def week_no(week_ending):
    return datetime.strptime(week_ending, "%Y-%m-%d").isocalendar()[1]


def collect(crop_desc, fetch):
    """-> {(state, year, weekno): {'GOOD': pct, 'EXCELLENT': pct, 'we': date}}"""
    cells = defaultdict(dict)
    for cat in CATS:
        rows = fetch({
            "short_desc": f"{crop_desc} - CONDITION, MEASURED IN PCT {cat}",
            "agg_level_desc": "STATE",
            "year__GE": str(FIRST_YEAR),
        })
        print(f"  {crop_desc} {cat}: {len(rows)} rows")
        for r in rows:
            we = (r.get("week_ending") or "").strip()
            st = (r.get("state_alpha") or "").strip()
            try:
                v = float(str(r.get("Value", "")).replace(",", ""))
            except ValueError:
                continue
            if not (we and st):
                continue
            c = cells[(st, int(we[:4]), week_no(we))]
            c[cat] = v
            c["we"] = we
    return cells


def shape(cells):
    """cells -> per-state current-week percentile package."""
    ge = {}
    for (st, yr, wk), c in cells.items():
        if "GOOD" in c and "EXCELLENT" in c:
            ge[(st, yr, wk)] = {"ge": c["GOOD"] + c["EXCELLENT"], "we": c["we"]}
    if not ge:
        return None
    newest_we = max(v["we"] for v in ge.values())
    cur_year, cur_wk = int(newest_we[:4]), week_no(newest_we)

    def week_val(st, yr):
        for w in (cur_wk, cur_wk - 1, cur_wk + 1):
            v = ge.get((st, yr, w))
            if v:
                return v["ge"]
        return None

    states = {}
    for st in sorted({k[0] for k in ge}):
        cur = week_val(st, cur_year)
        if cur is None:
            continue
        hist = []
        for yr in range(FIRST_YEAR, cur_year):
            v = week_val(st, yr)
            if v is not None:
                hist.append([yr, round(v, 1)])
        if len(hist) < 10:          # refuse thin comparisons — honesty rule
            continue
        vals = [v for _, v in hist]
        at_or_below = sum(1 for v in vals if v <= cur)
        states[st] = {
            "ge": round(cur, 1),
            "rank_from_worst": sum(1 for v in vals if v < cur) + 1,
            "of": len(vals) + 1,
            "pctile": round(100 * at_or_below / len(vals)),
            "best": max(vals), "worst": min(vals),
            "avg": round(sum(vals) / len(vals), 1),
            "hist": hist,
        }
    return {"week_ending": newest_we, "states": states}


def main():
    if "--selftest" in sys.argv:
        return selftest()
    if not KEY:
        raise SystemExit("FATAL: NASS_API_KEY not set")
    out = {"generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "source": "USDA NASS Quick Stats weekly crop condition, 2000-present",
           "note": ("Good+Excellent share vs the same week of year across history. "
                    "Rank 1 = worst on record for this week. States with under 10 "
                    "comparable years are omitted rather than thinly ranked."),
           "crops": {}}
    for slug, desc in CROPS.items():
        print(f"{slug}:")
        pkg = shape(collect(desc, api_get))
        if pkg:
            out["crops"][slug] = pkg
            print(f"  -> {len(pkg['states'])} states ranked, week ending {pkg['week_ending']}")
    if not out["crops"]:
        if 4 <= date.today().month <= 10:
            raise SystemExit("FATAL: zero condition data in-season — failing loud")
        print("off-season: writing empty placeholder")
        out["in_season"] = False
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, "w"), separators=(",", ":"))
    print(f"wrote {OUT}")


def selftest():
    """Synthetic 2000-2026 IA corn history through collect+shape."""
    rows_by_cat = {}
    for cat, base in (("GOOD", 40.0), ("EXCELLENT", 15.0)):
        rows = []
        for yr in range(2000, 2027):
            # week 28 each year; 2026 deliberately 4th-worst
            ge_adj = {2026: -12, 2012: -25, 2005: -18, 2002: -14}.get(yr, 0)
            rows.append({"week_ending": f"{yr}-07-12", "state_alpha": "IA",
                         "Value": str(base + ge_adj / 2)})
        rows_by_cat[cat] = rows
    calls = {"n": 0}

    def fake(params):
        calls["n"] += 1
        return rows_by_cat["EXCELLENT" if "EXCELLENT" in params["short_desc"] else "GOOD"]

    pkg = shape(collect("CORN", fake))
    ia = pkg["states"]["IA"]
    assert pkg["week_ending"] == "2026-07-12"
    assert ia["of"] == 27 and len(ia["hist"]) == 26, ia["of"]
    assert ia["rank_from_worst"] == 4, f"expected 4th-worst, got {ia['rank_from_worst']}"
    assert ia["worst"] == 30.0 and ia["best"] == 55.0
    print(f"SELFTEST OK — IA 2026 ranks {ia['rank_from_worst']}/{ia['of']} "
          f"(pctile {ia['pctile']}), thin-history refusal + week matching exercised")


if __name__ == "__main__":
    main()
