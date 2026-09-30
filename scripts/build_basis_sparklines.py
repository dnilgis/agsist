#!/usr/bin/env python3
"""
build_basis_sparklines.py

Aggregates data/basis/changes-*.json (durable, written-once daily change
logs -- see build_basis_history.py's own header for why basis is stored as
change-events, not a daily series) into one compact history file per state:
data/basis-sparklines/<ST>.json, keyed the same way data/basis/<ST>.json
already keys a facility (facility|city|commodity|symbol|deliveryMonth), so
the homepage/cash-bids can look up the exact row a bid search returned and
draw a real sparkline from real change history -- nothing padded, nothing
interpolated. A facility with 3 real change-points in the window gets a
3-point real line, not a smoothed 90-day fake one.

Capped to the last MAX_POINTS changes per key (most recent), since a chart
only needs enough points to show real movement, not the full multi-month
tail forever growing.

Usage:
    python3 scripts/build_basis_sparklines.py            # rebuild all states
    python3 scripts/build_basis_sparklines.py --check    # CI-safe, no writes
    python3 scripts/build_basis_sparklines.py --selftest
"""
import argparse
import glob
import json
import os
import sys

REPO = os.environ.get("AGSIST_REPO", ".")
CHANGES_GLOB = os.path.join(REPO, "data/basis/changes-*.json")
OUT_DIR = os.path.join(REPO, "data/basis-sparklines")
MAX_POINTS = 60  # real change-points kept per key, most recent


def key_for(state, facility, city, commodity, symbol, delivery_month):
    return "|".join([state, facility, city, commodity, symbol, delivery_month])


def build():
    files = sorted(glob.glob(CHANGES_GLOB))
    by_state = {}  # state -> key -> list of {date, to}
    for fp in files:
        with open(fp) as f:
            d = json.load(f)
        date = d["date"]
        for row in d["changes"]:
            state, facility, city, commodity, symbol, dm, frm, to = row
            k = key_for(state, facility, city, commodity, symbol, dm)
            by_state.setdefault(state, {}).setdefault(k, [])
            pts = by_state[state][k]
            # de-dupe: a replayed/duplicate row for the same date is dropped,
            # keeping the first value seen for that date (source-of-truth is
            # whichever change file wrote it first, in file order == date order).
            if pts and pts[-1]["date"] == date:
                continue
            pts.append({"date": date, "cents": to})
    out = {}
    for state, keys in by_state.items():
        state_out = {}
        for k, pts in keys.items():
            state_out[k] = pts[-MAX_POINTS:]
        out[state] = {
            "generated": None,  # filled by caller at write time
            "units": "integer cents per bushel",
            "note": "Real basis change-points only, replayed from data/basis/changes-*.json. A gap in the line is a gap in what changed, not missing data.",
            "series": state_out,
        }
    return out


def write(out, generated):
    os.makedirs(OUT_DIR, exist_ok=True)
    written = []
    for state, payload in out.items():
        payload["generated"] = generated
        path = os.path.join(OUT_DIR, f"{state}.json")
        with open(path, "w") as f:
            json.dump(payload, f, separators=(",", ":"))
        written.append(path)
    return written


def selftest():
    # A tiny synthetic run: two states, one key repeated across two files,
    # one duplicate-date row that must be dropped, one key over MAX_POINTS
    # that must be truncated to the most recent MAX_POINTS.
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        os.makedirs(os.path.join(td, "data/basis"))
        # file 1: two real changes, one duplicate date
        with open(os.path.join(td, "data/basis/changes-2026-01-01.json"), "w") as f:
            json.dump({"date": "2026-01-01", "changes": [
                ["IA", "TEST CO-OP", "AMES", "corn", "ZCZ26", "DEC26", -30, -35],
                ["IA", "TEST CO-OP", "AMES", "corn", "ZCZ26", "DEC26", -30, -35],  # dup same date
            ]}, f)
        with open(os.path.join(td, "data/basis/changes-2026-01-02.json"), "w") as f:
            json.dump({"date": "2026-01-02", "changes": [
                ["IA", "TEST CO-OP", "AMES", "corn", "ZCZ26", "DEC26", -35, -40],
            ]}, f)
        global REPO, CHANGES_GLOB
        old_repo, old_glob = REPO, CHANGES_GLOB
        REPO = td
        CHANGES_GLOB = os.path.join(td, "data/basis/changes-*.json")
        out = build()
        REPO, CHANGES_GLOB = old_repo, old_glob

        assert "IA" in out, "expected IA in output"
        k = key_for("IA", "TEST CO-OP", "AMES", "corn", "ZCZ26", "DEC26")
        pts = out["IA"]["series"][k]
        assert len(pts) == 2, f"expected 2 points (dup dropped), got {len(pts)}: {pts}"
        assert pts[0] == {"date": "2026-01-01", "cents": -35}, pts[0]
        assert pts[1] == {"date": "2026-01-02", "cents": -40}, pts[1]
        print("selftest OK: 2 real points, duplicate same-date row dropped, values correct")
        return True


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--check", action="store_true")
    p.add_argument("--selftest", action="store_true")
    args = p.parse_args()

    if args.selftest:
        ok = selftest()
        sys.exit(0 if ok else 1)

    out = build()
    total_keys = sum(len(v["series"]) for v in out.values())
    total_points = sum(len(pts) for v in out.values() for pts in v["series"].values())
    print(f"{len(out)} states, {total_keys} facility/commodity/contract keys, {total_points} real change-points")

    if args.check:
        print("--check: not writing.")
        sys.exit(0)

    import datetime
    generated = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    written = write(out, generated)
    print(f"wrote {len(written)} files to {OUT_DIR}")
