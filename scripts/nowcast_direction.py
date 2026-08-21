#!/usr/bin/env python3
"""
nowcast_direction.py — the AGSIST yield nowcast, on the record about DIRECTION.

THE CLAIM: before each WASDE, does the model say USDA's yield number gets
revised UP, DOWN, or stays put? Locked from data already in the repo, graded
by arithmetic when the print lands, appended forever, misses kept. Nobody
publishing yield opinions keeps this ledger; that is the point. (Same honesty
architecture as grade_calls.py: the model can talk, but a subtraction decides.)

  LOCK  (pre-WASDE):  direction = sign(nowcast - usda_current), with a dead
        band CALL_EPS inside which the call is "agree" (no revision expected).
        Inputs: data/yield-nowcast.json (the live weekly model) and
        data/crop-tour.json benchmarks.usda (the site's canonical USDA number,
        updated each WASDE per the release-day playbook).
  GRADE (post-WASDE): actual = sign(usda_after - usda_before) with dead band
        REV_EPS. correct iff call == actual ("agree" predicts "unchanged").
        Grading refuses to run until benchmarks.usda.as_of >= the WASDE date —
        it cannot grade against a number that has not been entered.

Both modes are idempotent: lock never duplicates a (wasde, crop) row, grade
never regrades. Runs at the end of cond-yield.yml every Tuesday; safe to
dispatch manually any time. Ledger: data/nowcast-direction.json.

Usage:
  python3 scripts/nowcast_direction.py --lock --grade      (normal CI call)
  python3 scripts/nowcast_direction.py --selftest
"""
import argparse
import json
import sys
from datetime import date, datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import usda_dates  # single-definition WASDE calendar

REPO = HERE.parent
LEDGER = REPO / "data" / "nowcast-direction.json"
NOWCAST = REPO / "data" / "yield-nowcast.json"
CROPTOUR = REPO / "data" / "crop-tour.json"

# Dead bands, in bu/acre. Inside CALL_EPS the model and USDA agree — calling a
# direction on a 0.3-bu gap would be manufacturing conviction from noise.
# REV_EPS is smaller: USDA prints to 0.1, so any printed change >= 0.1 is a
# real revision. Both published in the ledger so readers can audit the rules.
CALL_EPS = {"corn": 0.5, "soybeans": 0.2}
REV_EPS = 0.05

# ledger crop key -> benchmarks.usda field
USDA_FIELD = {"corn": "corn", "soybeans": "soy_yield"}


def _load(p, what):
    try:
        return json.loads(Path(p).read_text())
    except FileNotFoundError:
        print(f"[nowcast-dir] FATAL: {what} missing at {p}")
        raise


def _ledger():
    if LEDGER.exists():
        return json.loads(LEDGER.read_text())
    return {
        "note": ("Directional record of the AGSIST yield nowcast against USDA's next "
                 "WASDE print. Locked from the live model before each report, graded by "
                 "arithmetic after it, never edited. 'agree' means the model saw no "
                 "revision coming (gap inside call_eps). Misses stay."),
        "call_eps": CALL_EPS, "rev_eps": REV_EPS,
        "calls": [],
    }


def _direction(model, usda, eps):
    gap = model - usda
    if abs(gap) <= eps:
        return "agree"
    return "up" if gap > 0 else "down"


def lock(today=None, nowcast_path=NOWCAST, croptour_path=CROPTOUR, ledger=None):
    """Append call rows for the next WASDE. Returns (ledger, n_new)."""
    today = today or date.today()
    led = ledger if ledger is not None else _ledger()
    nw = usda_dates.next_wasde(today)
    if nw is None:
        print("[nowcast-dir] lock: WASDE calendar exhausted — revisit annually"); return led, 0
    ncast = _load(nowcast_path, "yield nowcast")
    bench = _load(croptour_path, "crop-tour benchmarks")["benchmarks"]["usda"]
    n_new = 0
    for crop in ("corn", "soybeans"):
        if any(c["wasde"] == nw.isoformat() and c["crop"] == crop for c in led["calls"]):
            continue  # idempotent
        c = (ncast.get("crops") or {}).get(crop) or {}
        model, week = c.get("nowcast"), c.get("week_ending")
        usda_now = bench.get(USDA_FIELD[crop])
        if model is None or usda_now is None:
            print(f"[nowcast-dir] lock: {crop}: missing model or USDA number — no call, no invention")
            continue
        # A model reading OLDER than the last WASDE would lock a stale opinion;
        # refuse rather than pretend. (Ratings pause -> nowcast pauses -> so do we.)
        pw = usda_dates.prior_wasde(nw)
        if pw and week and date.fromisoformat(week) < pw:
            print(f"[nowcast-dir] lock: {crop}: nowcast week {week} predates the prior WASDE — stale, skipping")
            continue
        row = {
            "wasde": nw.isoformat(), "crop": crop,
            "model": model, "model_week_ending": week, "band80": c.get("band80"),
            "usda_before": usda_now, "usda_before_label": bench.get("label"),
            "call": _direction(model, usda_now, CALL_EPS[crop]),
            "locked_on": today.isoformat(),
            "usda_after": None, "actual": None, "outcome": None, "graded_on": None,
        }
        led["calls"].append(row)
        n_new += 1
        print(f"[nowcast-dir] LOCKED {crop} for WASDE {nw}: model {model} vs USDA {usda_now} -> {row['call'].upper()}")
    return led, n_new


def grade(today=None, croptour_path=CROPTOUR, ledger=None):
    """Grade pending calls whose WASDE has printed AND whose USDA number has
    been entered (benchmarks.usda.as_of >= wasde). Returns (ledger, n_graded)."""
    today = today or date.today()
    led = ledger if ledger is not None else _ledger()
    bench = _load(croptour_path, "crop-tour benchmarks")["benchmarks"]["usda"]
    bench_asof = bench.get("as_of")
    n = 0
    for c in led["calls"]:
        if c["outcome"] is not None:
            continue  # idempotent
        wd = date.fromisoformat(c["wasde"])
        if today < wd:
            continue  # report not out yet
        if not bench_asof or date.fromisoformat(bench_asof) < wd:
            print(f"[nowcast-dir] grade: {c['crop']} {c['wasde']}: benchmarks.usda.as_of={bench_asof} "
                  f"predates the print — waiting for the number to be entered, not guessing")
            continue
        after = bench.get(USDA_FIELD[c["crop"]])
        if after is None:
            continue
        rev = after - c["usda_before"]
        actual = "unchanged" if abs(rev) <= REV_EPS else ("up" if rev > 0 else "down")
        ok = (c["call"] == "agree" and actual == "unchanged") or (c["call"] == actual)
        c.update({"usda_after": after, "actual": actual,
                  "outcome": "correct" if ok else "incorrect",
                  "graded_on": today.isoformat()})
        n += 1
        print(f"[nowcast-dir] GRADED {c['crop']} {c['wasde']}: called {c['call']}, USDA "
              f"{c['usda_before']} -> {after} ({actual}) => {c['outcome'].upper()}")
    return led, n


def save(led):
    led["updated"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    g = [c for c in led["calls"] if c["outcome"] is not None]
    # A CALL COMPUTED ON A CORRUPTED INPUT SERIES IS STILL A CALL. It stays in
    # the ledger, it stays GRADED, and it keeps counting against the record --
    # voiding a loss because the inputs were bad is the one move a scorecard
    # exists to prevent. What it also gets is a flag, so anyone reading the
    # record can see WHICH results rest on a known-bad input rather than having
    # to take the bare tally on trust.
    flagged = [c for c in led["calls"] if c.get("input_defect")]
    led["record"] = {"graded": len(g),
                     "correct": sum(1 for c in g if c["outcome"] == "correct"),
                     "pending": sum(1 for c in led["calls"] if c["outcome"] is None),
                     "on_defective_input": len(flagged)}
    LEDGER.write_text(json.dumps(led, indent=1, ensure_ascii=False))
    print(f"[nowcast-dir] ledger: {led['record']}")


# ─────────────────────────────── selftest ───────────────────────────────────
def selftest():
    import tempfile
    P = F = 0
    def check(name, cond, detail=""):
        nonlocal P, F
        if cond: P += 1; print(f"  ok    {name}")
        else:    F += 1; print(f"  FAIL  {name}  {detail}")

    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        nc = td / "nowcast.json"; ct = td / "croptour.json"
        nc.write_text(json.dumps({"crops": {
            "corn": {"nowcast": 183.6, "band80": 4.8, "week_ending": "2026-08-09"},
            "soybeans": {"nowcast": 53.1, "band80": 2.4, "week_ending": "2026-08-09"}}}))
        ct.write_text(json.dumps({"benchmarks": {"usda": {
            "corn": 183.0, "soy_yield": 53.0, "label": "USDA, July WASDE", "as_of": "2026-07-10"}}}))

        led = {"calls": [], "call_eps": CALL_EPS, "rev_eps": REV_EPS}
        led, n = lock(date(2026, 8, 11), nc, ct, led)
        check("locks both crops", n == 2)
        corn = next(c for c in led["calls"] if c["crop"] == "corn")
        soy = next(c for c in led["calls"] if c["crop"] == "soybeans")
        check("corn +0.6 vs 0.5 eps -> up", corn["call"] == "up", corn["call"])
        check("soy +0.1 inside 0.2 eps -> agree", soy["call"] == "agree", soy["call"])
        led, n = lock(date(2026, 8, 11), nc, ct, led)
        check("lock is idempotent", n == 0)

        led2, n = grade(date(2026, 8, 12), ct, led)
        check("no grade before number entered", n == 0)

        ct.write_text(json.dumps({"benchmarks": {"usda": {
            "corn": 183.5, "soy_yield": 53.0, "label": "USDA, August WASDE", "as_of": "2026-08-12"}}}))
        led, n = grade(date(2026, 8, 12), ct, led)
        check("grades both once entered", n == 2)
        check("corn up->up correct", corn["outcome"] == "correct", str(corn))
        check("soy agree->unchanged correct", soy["outcome"] == "correct", str(soy))
        led, n = grade(date(2026, 8, 13), ct, led)
        check("grade is idempotent", n == 0)

        # a miss stays a miss: down call, USDA revises up
        led["calls"].append({"wasde": "2026-09-11", "crop": "corn", "model": 180.0,
                             "usda_before": 183.5, "call": "down", "usda_after": None,
                             "actual": None, "outcome": None})
        ct.write_text(json.dumps({"benchmarks": {"usda": {
            "corn": 184.2, "soy_yield": 53.0, "label": "USDA, September WASDE", "as_of": "2026-09-11"}}}))
        led, n = grade(date(2026, 9, 11), ct, led)
        bad = next(c for c in led["calls"] if c["wasde"] == "2026-09-11")
        check("wrong-way call graded incorrect", bad["outcome"] == "incorrect", str(bad["outcome"]))

        # stale nowcast refuses to lock
        nc.write_text(json.dumps({"crops": {
            "corn": {"nowcast": 185.0, "band80": 4, "week_ending": "2026-07-05"},
            "soybeans": {"nowcast": 54.0, "band80": 2, "week_ending": "2026-07-05"}}}))
        led3, n = lock(date(2026, 9, 1), nc, ct, {"calls": []})
        check("pre-prior-WASDE nowcast refused", n == 0)

    print(f"\nnowcast-direction selftest: {P} passed, {F} failed")
    return 1 if F else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lock", action="store_true")
    ap.add_argument("--grade", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        sys.exit(selftest())
    led = _ledger()
    changed = 0
    if a.grade:   # grade BEFORE lock: on WASDE day the old call grades, then next month's locks
        led, n = grade(ledger=led); changed += n
    if a.lock:
        led, n = lock(ledger=led); changed += n
    if changed or not LEDGER.exists():
        save(led)
    else:
        print("[nowcast-dir] nothing to do")


if __name__ == "__main__":
    main()
