#!/usr/bin/env python3
"""
build_yield_benchmarks.py — assembles data/yield-panel.json, the "what everyone
else says" panel on conditions-yield.html.

    python scripts/build_yield_benchmarks.py [--selftest]

WHY THIS PANEL EXISTS. The nowcast at the top of that page is one model with one
input: crop ratings. It publishes its own band and its own miss record, which is
most of the way to honest, but it was still the only number on the page. On
2026-09-09 it read 183.0 bu/acre for corn while USDA's August print was 180.7,
DTN's tour was 178.5 and Pro Farmer's was 173.2 — our number was the highest of
the four, by ten bushels over the lowest, and a reader could not see that.

Printing the others beside it is the same trade the page already makes with the
band. It is also the cheaper check: a model that is the outlier every month is
saying something about itself that no backtest statistic will say as plainly.

TWO SOURCE FILES, ONE OF THEM OURS:
  data/yield-benchmarks.json   hand-maintained, everyone else's numbers
  data/yield-nowcast.json      the model's own output, read not copied

Our figure is NOT hand-entered. If it were, this panel could disagree with the
tiles six inches above it, which is the failure mode the crop-tour page already
had to be rescued from once.

WHAT IT REFUSES TO DO:
  • publish a forecast with no source link or no as_of date — an unsourced
    number on this site is the same as an invented one
  • publish a number that contradicts data/crop-tour.json, which carries the
    same Pro Farmer and USDA figures for its own panel. Two pages disagreeing
    in front of a reader is worse than one page being late
  • score anybody before USDA prints the January final

Stdlib only. No secrets, no network.
"""
import json
import os
import sys
from datetime import datetime, timezone

BENCH_PATH = "data/yield-benchmarks.json"
NOWCAST_PATH = "data/yield-nowcast.json"
TOUR_PATH = "data/crop-tour.json"
OUT_PATH = "data/yield-panel.json"

CROPS = ("corn", "soybeans")
OURS = "agsist"


def _read(path, default=None):
    if not os.path.exists(path):
        return default
    with open(path) as f:
        return json.load(f)


def rows_for(crop, bench, nowcast):
    """Every forecaster with a number for this crop, ours included, sorted low
    to high. A forecaster with no number for this crop is left out of the table
    entirely rather than shown as a blank row — the count beside the table says
    how many are in it."""
    out = []
    for f in bench.get("forecasts", []):
        v = f.get(crop)
        if v is None:
            continue
        if not f.get("source") or not f.get("as_of"):
            raise ValueError(
                f"forecast {f.get('id') or '?'} has a {crop} number with "
                f"{'no source' if not f.get('source') else 'no as_of date'}. "
                "An unsourced number is an invented number. Refusing to write.")
        out.append({
            "id": f.get("id"), "name": f.get("name"), "kind": f.get("kind", ""),
            "value": round(float(v), 1), "as_of": f["as_of"], "source": f["source"],
            "method": f.get("method", ""), "ours": False,
            "low": f.get(crop + "_low"), "high": f.get(crop + "_high"),
        })

    # USDA'S IN-SEASON PRINT IS A FORECAST TOO, and it belongs in the sorted
    # column rather than pinned under it. Appended separately, it read 180.7
    # directly below our 183.0 in a table sorted low to high — a column that
    # looks ordered and is not is worse than no ordering at all. It is marked
    # `official` so the page can style it apart without moving it.
    meta = (bench.get("crops") or {}).get(crop) or {}
    if meta.get("usda_current") is not None:
        out.append({
            "id": "usda", "name": meta.get("usda_current_label") or "USDA",
            "kind": "official", "official": True,
            "value": round(float(meta["usda_current"]), 1),
            "as_of": meta.get("usda_current_as_of"),
            "source": bench.get("usda_source"),
            "method": "USDA's own survey-based estimate, the one the market trades.",
            "ours": False, "low": None, "high": None,
        })

    c = (nowcast.get("crops") or {}).get(crop) or {}
    if c.get("nowcast") is not None:
        out.append({
            "id": OURS, "name": "AGSIST nowcast", "kind": "model",
            "value": round(float(c["nowcast"]), 1),
            "as_of": c.get("week_ending"), "source": "/" + NOWCAST_PATH,
            "method": "Crop ratings only. Band is the 80th percentile of "
                      "leave-one-year-out backtest errors at this week.",
            "ours": True,
            "low": round(c["nowcast"] - c["band80"], 1) if c.get("band80") else None,
            "high": round(c["nowcast"] + c["band80"], 1) if c.get("band80") else None,
        })
    out.sort(key=lambda r: r["value"])
    return out


def spread_of(rows):
    """The shape of the disagreement, which is the reason to print the table."""
    if len(rows) < 2:
        return None
    vals = [r["value"] for r in rows]
    ours = next((r["value"] for r in rows if r["ours"]), None)
    d = {"low": min(vals), "high": max(vals), "spread": round(max(vals) - min(vals), 1),
         "n": len(rows)}
    if ours is not None:
        below = sum(1 for v in vals if v < ours)
        d["ours"] = ours
        d["rank"] = below + 1                       # 1 = lowest of the panel
        d["ours_vs_low"] = round(ours - min(vals), 1)
        d["ours_vs_high"] = round(ours - max(vals), 1)
        d["highest"] = ours == max(vals)
        d["lowest"] = ours == min(vals)
    return d


def cross_check(bench, tour):
    """crop-tour.json carries the same USDA and Pro Farmer figures for its own
    panel. If the two files ever drift, one of the two pages is lying to a
    reader and neither page can tell which. Fail here instead."""
    if not tour:
        return []
    checked = []
    b = tour.get("benchmarks") or {}
    pairs = []
    if "usda" in b:
        pairs.append(("USDA corn", b["usda"].get("corn"),
                      (bench["crops"]["corn"] or {}).get("usda_current")))
        pairs.append(("USDA soybeans", b["usda"].get("soy_yield"),
                      (bench["crops"]["soybeans"] or {}).get("usda_current")))
    pf = next((f for f in bench.get("forecasts", []) if f.get("id") == "profarmer"), None)
    if "tour" in b and pf:
        pairs.append(("Pro Farmer corn", b["tour"].get("corn"), pf.get("corn")))
    for label, theirs, mine in pairs:
        if theirs is None or mine is None:
            continue
        if abs(float(theirs) - float(mine)) > 0.001:
            raise ValueError(
                f"{label}: crop-tour.json says {theirs}, yield-benchmarks.json says "
                f"{mine}. Two pages would print different numbers for the same "
                "figure. Fix one of them; refusing to write.")
        checked.append(label)
    return checked


def grade(crop, rows, final):
    """Only once USDA's January final exists. Signed error is kept as well as
    absolute: a panel where everyone missed the same way is a different fact
    from one where they disagreed."""
    if final is None:
        return None
    g = []
    for r in rows:
        err = round(r["value"] - float(final), 1)
        g.append({"id": r["id"], "name": r["name"], "forecast": r["value"],
                  "error": err, "abs_error": abs(err)})
    g.sort(key=lambda x: x["abs_error"])
    for i, x in enumerate(g):
        x["place"] = i + 1
    return {"final": float(final), "scored": g}


def build(bench, nowcast, tour=None):
    checked = cross_check(bench, tour)
    crops = {}
    for crop in CROPS:
        meta = (bench.get("crops") or {}).get(crop) or {}
        rows = rows_for(crop, bench, nowcast)
        crops[crop] = {
            "unit": meta.get("unit", "bu/acre"),
            "rows": rows,
            "spread": spread_of(rows),
            "graded": grade(crop, rows, meta.get("final")),
        }
    return {
        "schema": "agsist-yield-panel/1",
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "season": bench.get("season"),
        "nowcast_generated": nowcast.get("generated"),
        "usda_source": bench.get("usda_source"),
        "cross_checked": checked,
        "note": "Independent 2026 US yield forecasts beside our own. Every "
                "figure carries the date it was published and a link to where "
                "it was published. Ours is read from the nowcast file, not "
                "typed here. Nobody is scored until USDA prints the January "
                "final.",
        "crops": crops,
    }


# ── selftest ──────────────────────────────────────────────────────────────
def selftest():
    bench = {
        "season": 2026,
        "crops": {"corn": {"unit": "bu/acre", "usda_current": 180.7, "final": None},
                  "soybeans": {"unit": "bu/acre", "usda_current": 52.7, "final": None}},
        "forecasts": [
            {"id": "a", "name": "A", "as_of": "2026-08-10", "source": "http://x",
             "corn": 178.5, "soybeans": 52.1},
            {"id": "b", "name": "B", "as_of": "2026-08-21", "source": "http://y",
             "corn": 173.2, "soybeans": None},
        ],
    }
    now = {"generated": "2026-09-08T08:05:08Z",
           "crops": {"corn": {"nowcast": 183.0, "band80": 6.0, "week_ending": "2026-08-30"},
                     "soybeans": {"nowcast": 53.9, "band80": 1.5, "week_ending": "2026-08-30"}}}
    p = build(bench, now)

    def eq(got, want, what):
        assert got == want, f"{what}: got {got!r}, want {want!r}"
        print(f"  ok  {what} = {want!r}")

    c = p["crops"]["corn"]
    # 173.2, 178.5, USDA 180.7, ours 183.0 — USDA sorts INTO the column.
    eq([r["id"] for r in c["rows"]], ["b", "a", "usda", "agsist"], "corn sorted low to high")
    eq(c["spread"]["spread"], 9.8, "corn spread 183.0 - 173.2")
    eq(c["spread"]["rank"], 4, "our corn rank of 4")
    eq(c["spread"]["highest"], True, "we are the highest corn number")
    eq(c["rows"][3]["low"], 177.0, "our band low is 183.0 - 6.0")
    eq(c["rows"][2]["official"], True, "USDA's row is marked official")
    # B published no soybean number, so B is absent from the soybean table.
    s = p["crops"]["soybeans"]
    eq([r["id"] for r in s["rows"]], ["a", "usda", "agsist"], "soybeans: B is left out, not blank")
    eq(s["spread"]["n"], 3, "three soybean rows")
    eq(c["graded"], None, "nobody is scored before the January final")

    # With a final, everyone is scored and ordered by how close they were.
    bench["crops"]["corn"]["final"] = 179.0
    g = build(bench, now)["crops"]["corn"]["graded"]
    # 178.5 misses by 0.5, 183.0 by 4.0, 173.2 by 5.8 — so the tour, the
    # furthest out on the low side, places last and we place second.
    eq([x["id"] for x in g["scored"]], ["a", "usda", "agsist", "b"], "scored by absolute error")
    eq([x["error"] for x in g["scored"]], [-0.5, 1.7, 4.0, -5.8], "signed errors kept")
    eq(g["scored"][0]["place"], 1, "closest takes first place")

    # An unsourced number stops the whole build.
    bad = json.loads(json.dumps(bench))
    bad["forecasts"][0]["source"] = ""
    try:
        build(bad, now)
        raise AssertionError("an unsourced forecast did not raise")
    except ValueError as e:
        assert "unsourced number is an invented number" in str(e), e
        print("  ok  an unsourced forecast refuses the whole build")

    # Two files disagreeing about the same figure stops it too.
    try:
        build(bench, now, {"benchmarks": {"usda": {"corn": 181.0, "soy_yield": 52.7}}})
        raise AssertionError("a cross-file disagreement did not raise")
    except ValueError as e:
        assert "different numbers for the same" in str(e), e
        print("  ok  crop-tour.json disagreeing about USDA corn refuses the build")

    # Only the two USDA figures are comparable here: the Pro Farmer check is
    # keyed on the forecaster id, and this fixture calls them "a" and "b".
    ok = build(bench, now, {"benchmarks": {"usda": {"corn": 180.7, "soy_yield": 52.7},
                                           "tour": {"corn": 173.2}}})
    eq(ok["cross_checked"], ["USDA corn", "USDA soybeans"],
       "the two USDA figures are cross-checked")

    # And the tour figure is compared as soon as the id matches the real one,
    # which is the pairing that actually ships.
    named = json.loads(json.dumps(bench))
    named["forecasts"][1]["id"] = "profarmer"
    ok2 = build(named, now, {"benchmarks": {"usda": {"corn": 180.7, "soy_yield": 52.7},
                                            "tour": {"corn": 173.2}}})
    eq(ok2["cross_checked"], ["USDA corn", "USDA soybeans", "Pro Farmer corn"],
       "the tour figure is cross-checked once the id matches")
    try:
        build(named, now, {"benchmarks": {"usda": {"corn": 180.7, "soy_yield": 52.7},
                                          "tour": {"corn": 174.0}}})
        raise AssertionError("a tour disagreement did not raise")
    except ValueError as e:
        assert "Pro Farmer corn" in str(e), e
        print("  ok  crop-tour.json disagreeing about the tour figure refuses the build")
    print("selftest passed")


def main():
    if "--selftest" in sys.argv:
        selftest()
        return
    bench = _read(BENCH_PATH)
    if not bench:
        raise SystemExit(f"{BENCH_PATH} is missing — nothing to build")
    nowcast = _read(NOWCAST_PATH, {})
    tour = _read(TOUR_PATH)
    payload = build(bench, nowcast, tour)
    with open(OUT_PATH, "w") as f:
        json.dump(payload, f)
        f.write("\n")
    print(f"wrote {OUT_PATH}")
    for crop in CROPS:
        c = payload["crops"][crop]
        sp = c["spread"] or {}
        names = ", ".join(f"{r['name']} {r['value']}" for r in c["rows"])
        print(f"  {crop}: {names}")
        if sp:
            where = ("highest" if sp.get("highest") else
                     "lowest" if sp.get("lowest") else f"{sp.get('rank')} of {sp['n']}")
            print(f"    spread {sp['spread']} {c['unit']} across {sp['n']}; ours is {where}")
    if payload["cross_checked"]:
        print(f"  cross-checked against crop-tour.json: {', '.join(payload['cross_checked'])}")


if __name__ == "__main__":
    main()
