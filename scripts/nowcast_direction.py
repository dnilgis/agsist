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
        it cannot grade against a number that has not been entered — and
        refuses an as_of on or after the NEXT WASDE: a later report cannot
        grade an earlier call. Lock refuses a benchmark older than the WASDE
        before the target one (the 2026-09-15 October rows were locked
        against August's print; see lock()).

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
from datetime import date, datetime, timedelta, timezone
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


def _next_after(wd):
    """The WASDE after `wd`, or None past the calendar's horizon."""
    return usda_dates.next_wasde(wd + timedelta(days=1))


def _live(c):
    """A row that still counts: not superseded by a corrected lock."""
    return not c.get("superseded_by")


def lock(today=None, nowcast_path=NOWCAST, croptour_path=CROPTOUR, ledger=None):
    """Append call rows for the next WASDE. Returns (ledger, n_new).

    The USDA number a call is measured against must be the print IN FORCE for
    the window it is locked in: benchmarks.usda.as_of must fall on or after the
    WASDE before the target one. On 2026-09-15 the October calls were locked
    against the August print (180.7 / 52.7) because nobody had entered
    September's 178.5 / 52.8; grading those rows would score a revision across
    two reports, which is not the claim the ledger makes. lock() now refuses a
    stale benchmark rather than lock against it.

    A pending row whose baseline was not the print in force (the 09-15 defect)
    is never edited. It is flagged input_defect + superseded_by and a corrected
    row is APPENDED, reusing the original row's model reading exactly (model,
    week, band) so the correction carries no information the original call did
    not have. Allowed only before the target WASDE prints and only when the
    corrected call points the same way as the original -- so a correction can
    never turn a call into a different call, only measure it from the right
    starting number.
    """
    today = today or date.today()
    led = ledger if ledger is not None else _ledger()
    nw = usda_dates.next_wasde(today)
    if nw is None:
        print("[nowcast-dir] lock: WASDE calendar exhausted — revisit annually"); return led, 0
    ncast = _load(nowcast_path, "yield nowcast")
    bench = _load(croptour_path, "crop-tour benchmarks")["benchmarks"]["usda"]
    bench_asof = bench.get("as_of")
    pw = usda_dates.prior_wasde(nw)
    if pw and (not bench_asof or date.fromisoformat(bench_asof) < pw):
        print(f"[nowcast-dir] lock: benchmarks.usda.as_of={bench_asof} predates the prior WASDE "
              f"{pw} — the USDA number in force has not been entered. No call locked against a "
              f"superseded print.")
        return led, 0
    n_new = 0
    for crop in ("corn", "soybeans"):
        usda_now = bench.get(USDA_FIELD[crop])
        have = [c for c in led["calls"] if c["wasde"] == nw.isoformat() and c["crop"] == crop and _live(c)]
        if have:
            old = have[-1]
            stale_base = (usda_now is not None and old.get("outcome") is None
                          and abs(float(old["usda_before"]) - float(usda_now)) > 1e-9
                          and old.get("usda_before_as_of", "") != bench_asof)
            if not stale_base:
                continue  # idempotent
            if today >= nw:
                print(f"[nowcast-dir] lock: {crop} {nw}: baseline {old['usda_before']} was not the print in "
                      f"force ({usda_now}), but the report is out — too late to correct; graded as called")
                if not old.get("input_defect"):
                    old["input_defect"] = (
                        f"Locked against {old['usda_before']} when {bench.get('label')} ({usda_now}, "
                        f"{bench_asof}) was the print in force. Found after the report; graded as called.")
                    n_new += 1  # a flag, not a call -- but the ledger changed and must be saved
                continue
            new_call = _direction(old["model"], usda_now, CALL_EPS[crop])
            if new_call != old["call"]:
                print(f"[nowcast-dir] lock: {crop} {nw}: corrected baseline would change the call "
                      f"{old['call']} -> {new_call}; refusing — the original stays and is graded as called")
                continue
            row = dict(old)
            row.update({
                "usda_before": usda_now, "usda_before_label": bench.get("label"),
                "usda_before_as_of": bench_asof, "call": new_call,
                "locked_on": today.isoformat(),
                "corrects": f"{old['wasde']} {crop} row locked {old.get('locked_on')}",
                "model_reading_from": old.get("locked_on"),
                "usda_after": None, "actual": None, "outcome": None, "graded_on": None,
            })
            row.pop("input_defect", None); row.pop("superseded_by", None)
            old["input_defect"] = (
                f"Locked against {old.get('usda_before_label') or old['usda_before']} "
                f"({old['usda_before']}) after {bench.get('label')} ({usda_now}, {bench_asof}) had printed; "
                f"benchmarks.usda had not been updated. Same model reading, same call; re-measured "
                f"from the print in force in the row locked {today.isoformat()}, before the report.")
            old["superseded_by"] = f"relock {today.isoformat()}"
            led["calls"].append(row)
            n_new += 1
            print(f"[nowcast-dir] RELOCKED {crop} for WASDE {nw}: model {old['model']} vs USDA "
                  f"{usda_now} (was {old['usda_before']}) -> {new_call.upper()}; old row flagged, kept")
            continue
        c = (ncast.get("crops") or {}).get(crop) or {}
        model, week = c.get("nowcast"), c.get("week_ending")
        if model is None or usda_now is None:
            print(f"[nowcast-dir] lock: {crop}: missing model or USDA number — no call, no invention")
            continue
        # A model reading OLDER than the last WASDE would lock a stale opinion;
        # refuse rather than pretend. (Ratings pause -> nowcast pauses -> so do we.)
        if pw and week and date.fromisoformat(week) < pw:
            print(f"[nowcast-dir] lock: {crop}: nowcast week {week} predates the prior WASDE — stale, skipping")
            continue
        row = {
            "wasde": nw.isoformat(), "crop": crop,
            "model": model, "model_week_ending": week, "band80": c.get("band80"),
            "usda_before": usda_now, "usda_before_label": bench.get("label"),
            "usda_before_as_of": bench_asof,
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
    been entered: benchmarks.usda.as_of must fall in [wasde, next WASDE). A
    later report's number cannot grade an earlier call -- if a month was
    skipped, that call waits ("awaiting entry") rather than being scored
    against the wrong report. Superseded rows are never graded; their
    corrected row is. Returns (ledger, n_graded)."""
    today = today or date.today()
    led = ledger if ledger is not None else _ledger()
    bench = _load(croptour_path, "crop-tour benchmarks")["benchmarks"]["usda"]
    bench_asof = bench.get("as_of")
    n = 0
    for c in led["calls"]:
        if c["outcome"] is not None or not _live(c):
            continue  # idempotent; superseded rows are not graded
        wd = date.fromisoformat(c["wasde"])
        if today < wd:
            continue  # report not out yet
        if not bench_asof or date.fromisoformat(bench_asof) < wd:
            print(f"[nowcast-dir] grade: {c['crop']} {c['wasde']}: benchmarks.usda.as_of={bench_asof} "
                  f"predates the print — waiting for the number to be entered, not guessing")
            continue
        nxt = _next_after(wd)
        ba = date.fromisoformat(bench_asof)
        if (nxt is not None and ba >= nxt) or (nxt is None and (ba - wd).days > 45):
            print(f"[nowcast-dir] grade: {c['crop']} {c['wasde']}: benchmarks.usda.as_of={bench_asof} "
                  f"is a LATER report (next WASDE {nxt}) — it cannot grade this call; left ungraded")
            continue
        after = bench.get(USDA_FIELD[c["crop"]])
        if after is None:
            continue
        rev = after - c["usda_before"]
        actual = "unchanged" if abs(rev) <= REV_EPS else ("up" if rev > 0 else "down")
        ok = (c["call"] == "agree" and actual == "unchanged") or (c["call"] == actual)
        c.update({"usda_after": after, "usda_after_label": bench.get("label"),
                  "actual": actual,
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
    # Superseded rows (a baseline-defective lock replaced BEFORE its report
    # printed, same call) are never graded and are not in the tally; every
    # graded row on a defective input is, and is counted separately.
    flagged = [c for c in g if c.get("input_defect")]
    # Corn and soybeans locked for one WASDE come from one model run and are
    # graded against one report: they are not independent. The independent n
    # is the number of reports graded.
    reports = sorted({c["wasde"] for c in g})
    led["record"] = {"graded": len(g),
                     "correct": sum(1 for c in g if c["outcome"] == "correct"),
                     "reports": len(reports),
                     "pending": sum(1 for c in led["calls"] if c["outcome"] is None and _live(c)),
                     "on_defective_input": len(flagged),
                     "superseded": sum(1 for c in led["calls"] if not _live(c))}
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

        # (a) a USDA benchmark older than the prior WASDE is not the number in
        # force: on 2026-09-15 the Oct calls locked against August's 180.7.
        nc.write_text(json.dumps({"crops": {
            "corn": {"nowcast": 182.6, "band80": 5.5, "week_ending": "2026-09-13"},
            "soybeans": {"nowcast": 53.7, "band80": 1.4, "week_ending": "2026-09-13"}}}))
        ct.write_text(json.dumps({"benchmarks": {"usda": {
            "corn": 180.7, "soy_yield": 52.7, "label": "USDA, August WASDE", "as_of": "2026-08-12"}}}))
        led4, n = lock(date(2026, 9, 15), nc, ct, {"calls": []})
        check("(a) lock refuses a benchmark older than the prior WASDE", n == 0 and not led4["calls"],
              str(led4["calls"]))
        # the defective rows as they were actually written, then September entered
        bad_rows = [{"wasde": "2026-10-09", "crop": cr, "model": m, "model_week_ending": "2026-09-13",
                     "band80": b, "usda_before": u, "usda_before_label": "USDA, August WASDE",
                     "call": "up", "locked_on": "2026-09-15", "usda_after": None, "actual": None,
                     "outcome": None, "graded_on": None}
                    for cr, m, b, u in (("corn", 182.6, 5.5, 180.7), ("soybeans", 53.7, 1.4, 52.7))]
        led5 = {"calls": [dict(r) for r in bad_rows]}
        ct.write_text(json.dumps({"benchmarks": {"usda": {
            "corn": 178.5, "soy_yield": 52.8, "label": "USDA, September WASDE", "as_of": "2026-09-11"}}}))
        led5, n = lock(date(2026, 10, 6), nc, ct, led5)
        olds = [c for c in led5["calls"] if c.get("superseded_by")]
        news = [c for c in led5["calls"] if c.get("corrects")]
        check("(a) defective rows kept, flagged, superseded — not edited",
              len(olds) == 2 and all(o["usda_before"] in (180.7, 52.7) and o["call"] == "up"
                                     and o.get("input_defect") for o in olds), str(olds))
        check("(a) corrected rows appended against the print in force, same model reading",
              n == 2 and sorted(c["usda_before"] for c in news) == [52.8, 178.5]
              and sorted(c["model"] for c in news) == [53.7, 182.6], str(news))
        led5, n = lock(date(2026, 10, 7), nc, ct, led5)
        check("(a) relock is idempotent", n == 0 and len(led5["calls"]) == 4)
        late = {"calls": [dict(r) for r in bad_rows]}
        late, n = lock(date(2026, 10, 9), nc, ct, late)
        check("(a) no correction once the report is out; the defect is flagged, graded as called",
              not any(c.get("superseded_by") for c in late["calls"]) and len(late["calls"]) == 2
              and all(c.get("input_defect") for c in late["calls"]))

        # (b) a later report must not grade an earlier call
        led6 = {"calls": [{"wasde": "2026-09-11", "crop": "corn", "model": 182.6, "usda_before": 180.7,
                           "call": "up", "usda_after": None, "actual": None, "outcome": None}]}
        ct.write_text(json.dumps({"benchmarks": {"usda": {
            "corn": 176.0, "soy_yield": 52.0, "label": "USDA, October WASDE", "as_of": "2026-10-09"}}}))
        led6, n = grade(date(2026, 10, 10), ct, led6)
        check("(b) October's number cannot grade a September call", n == 0 and led6["calls"][0]["outcome"] is None)
        led5, n = grade(date(2026, 10, 10), ct, led5)
        check("(b) superseded rows are never graded; corrected ones are",
              n == 2 and all(c["outcome"] is None for c in led5["calls"] if c.get("superseded_by")))

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
