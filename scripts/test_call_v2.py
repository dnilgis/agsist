#!/usr/bin/env python3
"""
test_call_v2.py — selftests for call-design v2 (calibration + feedback loop
+ scorecard series split). GATE 0 for any change to call_calibration.py,
the call block in generate_daily.py, or the v2 fields in build_scorecard.py.

Run: python3 scripts/test_call_v2.py       (exit 0 all pass, 1 otherwise)

Discipline note (HANDOFF 2026-08-09 §4B): several of these tests were run
against the PRE-change build_scorecard.py first and FAILED there (no
by_design, no instrument on records) — they bite.
"""
import json
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import call_calibration as cal   # noqa: E402

PASS = 0
FAIL = 0


def check(name, cond, detail=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok    {name}")
    else:
        FAIL += 1
        print(f"  FAIL  {name}  {detail}")


def make_archive(tmp, days):
    """days: list of (iso_date, {locked_key: close}) — writes minimal archive."""
    arch = Path(tmp) / "daily-archive"
    arch.mkdir(parents=True, exist_ok=True)
    for d, lp in days:
        (arch / f"{d}.json").write_text(json.dumps(
            {"date": d, "locked_prices": lp, "market_closed": False}))
    return str(arch)


def main():
    print("calibration math")
    with tempfile.TemporaryDirectory() as tmp:
        # closes 4.00, 4.10, 4.00, 4.10 ... -> every move exactly 0.10
        days = [(f"2026-07-{i:02d}", {"corn": 4.0 + 0.1 * (i % 2)}) for i in range(1, 11)]
        arch = make_archive(tmp, days)
        moves = cal.realized_moves(arch, "corn")
        check("moves counted", len(moves) == 9, f"got {len(moves)}")
        check("avg move exact", abs(cal.avg_move(arch, "corn") - 0.10) < 1e-9,
              f"got {cal.avg_move(arch, 'corn')}")
        lo, hi = cal.level_band(arch, "corn")
        check("band = [0.25x, 0.80x] avg",
              abs(lo - 0.025) < 1e-9 and abs(hi - 0.08) < 1e-9, f"got {(lo, hi)}")
        check("thin history -> no band", cal.level_band(arch, "wheat") is None)
        check("closed days skipped",
              cal.avg_move(make_archive(tmp + "/x",
                  days + [("2026-07-11", {"corn": 99.0})]), "corn") is not None)

    print("band_check verdicts")
    with tempfile.TemporaryDirectory() as tmp:
        days = [(f"2026-07-{i:02d}", {"corn": 4.0 + 0.1 * (i % 2)}) for i in range(1, 11)]
        arch = make_archive(tmp, days)
        s, _ = cal.band_check({"instrument": "corn", "level": 4.05}, 4.00, arch)
        check("inside band -> ok", s == "ok", s)
        s, d = cal.band_check({"instrument": "corn", "level": 4.20}, 4.00, arch)
        check("beyond 0.8x avg -> too_far", s == "too_far", s)
        check("too_far detail names the numbers", "$4.2" in d and "band" in d)
        s, _ = cal.band_check({"instrument": "corn", "level": 4.01}, 4.00, arch)
        check("inside 0.25x avg -> too_near", s == "too_near", s)
        s, _ = cal.band_check({"instrument": "kaspa", "level": 1}, 1.0, arch)
        check("unknown instrument -> unknown, never crash", s == "unknown", s)

    print("report-day regime")
    with tempfile.TemporaryDirectory() as tmp:
        days = [(f"2026-07-{i:02d}", {"corn": 4.0 + 0.1 * (i % 2)}) for i in range(1, 11)]
        arch = make_archive(tmp, days)
        lo, hi = cal.level_band(arch, "corn", report_day=True)
        check("report-day band = [0.50x, 2.00x] avg",
              abs(lo - 0.05) < 1e-9 and abs(hi - 0.20) < 1e-9, f"got {(lo, hi)}")
        # 4.20 is too_far on a normal day (see above) but fine on a report day
        s, d = cal.band_check({"instrument": "corn", "level": 4.20, "report_day": True}, 4.00, arch)
        check("report-day stamp widens the gate check", s == "ok", f"{s}: {d}")
        check("report-day check says so in the detail", "[report-day band]" in d, d)
        # and a quiet-day-sized level is now TOO NEAR on a report day
        s, _ = cal.band_check({"instrument": "corn", "level": 4.03, "report_day": True}, 4.00, arch)
        check("cheap level rejected on report day", s == "too_near", s)
        check("bands_text honors report_day",
              cal.bands_text(arch, report_day=True) != cal.bands_text(arch))

    print("feedback loop")
    with tempfile.TemporaryDirectory() as tmp:
        sc = Path(tmp) / "scorecard.json"
        # newest-first, as build_scorecard writes it
        recs = [
            {"made": "2026-08-07", "outcome": "didnt", "method": "deterministic",
             "instrument": "corn", "direction": "up", "level": 4.5, "call": "x"},
            {"made": "2026-08-06", "outcome": "didnt", "method": "deterministic",
             "instrument": "corn", "direction": "up", "level": 4.5, "call": "x"},
            {"made": "2026-08-05", "outcome": "didnt", "method": "deterministic",
             "instrument": "corn", "direction": "up", "level": 4.5, "call": "x"},
            {"made": "2026-08-04", "outcome": "played_out", "method": "deterministic",
             "instrument": "beans", "direction": "down", "level": 11.0, "call": "x"},
            {"made": "2026-08-01", "outcome": "played_out", "method": "self_reported",
             "call": "self-era row must be excluded"},
        ]
        sc.write_text(json.dumps({"records": recs}))
        block = cal.feedback_block(str(sc))
        check("block renders", bool(block))
        check("anti-repeat fires on 3 same-instrument misses",
              "WARNING" in block and "corn up" in block, block[:120])
        check("self-reported era excluded", "self-era" not in block)
        check("per-instrument rates present", "corn 0/3" in block and "beans 1/1" in block)
        check("hit total correct", "1/4 played out" in block)
        # streak: newest graded is a miss -> 0
        check("streak computed from newest", "streak: 0" in block)
        # flip newest to a hit -> anti-repeat must NOT fire
        recs[0]["outcome"] = "played_out"
        sc.write_text(json.dumps({"records": recs}))
        check("anti-repeat needs ALL misses", "WARNING" not in cal.feedback_block(str(sc)))
        check("missing scorecard -> empty block, never crash",
              cal.feedback_block(str(Path(tmp) / "nope.json")) == "")

    print("scorecard v2 fields (real builder, synthetic archive)")
    with tempfile.TemporaryDirectory() as tmp:
        arch = Path(tmp) / "daily-archive"
        arch.mkdir()
        # day1 makes a v1-design call; day2 grades it and makes a v2 call; day3 grades that.
        # day1 call: corn up 4.50 from close 4.40; day2 corn closes 4.55 -> played_out
        # day2 call (design v2): corn down 4.50 from 4.55; day3 closes 4.60 -> didnt, direction_ok False
        d1 = {"date": "2026-08-05", "locked_prices": {"corn": 4.40},
              "todays_call": {"instrument": "corn", "direction": "up", "level": 4.50},
              "yesterdays_call": {}}
        d2 = {"date": "2026-08-06", "locked_prices": {"corn": 4.55},
              "todays_call": {"instrument": "corn", "direction": "down", "level": 4.50, "design": "v2"},
              "yesterdays_call": {"summary": "corn call graded", "outcome": "played_out"}}
        d3 = {"date": "2026-08-07", "locked_prices": {"corn": 4.60},
              "yesterdays_call": {"summary": "corn call graded", "outcome": "didnt"}}
        for d in (d1, d2, d3):
            (arch / f"{d['date']}.json").write_text(json.dumps(d))

        import build_scorecard
        # point the module at the synthetic tree
        build_scorecard.ARCHIVE = arch
        build_scorecard.OUT = Path(tmp) / "scorecard.json"
        build_scorecard.main()
        out = json.loads(build_scorecard.OUT.read_text())

        check("by_design present", "by_design" in out, str(list(out.keys())))
        check("v1/v2 series split correctly",
              out["by_design"]["v1"]["graded"] == 1 and out["by_design"]["v2"]["graded"] == 1,
              json.dumps(out.get("by_design")))
        check("v1 row is the hit, v2 row is the miss",
              out["by_design"]["v1"]["played"] == 1 and out["by_design"]["v2"]["played"] == 0)
        check("direction_only computed",
              out["direction_only"]["graded"] == 2 and out["direction_only"]["right_way"] == 1,
              json.dumps(out.get("direction_only")))
        check("by_instrument present", out["by_instrument"].get("corn", {}).get("graded") == 2,
              json.dumps(out.get("by_instrument")))
        check("trailing20 present", out["trailing20"]["graded"] == 2)
        check("records carry structured call",
              all(("instrument" in r and "p0" in r) for r in out["records"]),
              json.dumps(out["records"])[:200])
        check("legacy fields untouched",
              all(k in out for k in ("hit_rate", "by_method", "current_streak", "mismatched")))

    print()
    print(f"call-v2 selftest: {PASS} passed, {FAIL} failed")
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
