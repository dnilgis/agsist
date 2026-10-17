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
import bisect
import datetime as _dt
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from basis_method import relative_outlier  # noqa: E402  (the one outlier rule)

REPO = os.environ.get("AGSIST_REPO", ".")
CHANGES_GLOB = os.path.join(REPO, "data/basis/changes-*.json")
OUT_DIR = os.path.join(REPO, "data/basis-sparklines")
MAX_POINTS = 60  # real change-points kept per key, most recent
SCREEN_DAYS = 14  # another elevator's basis counts as "near in time" this long


def norm_symbol(sym):
    """'ZCZ6' and 'ZCZ26' are the same contract: -> 'ZCZ26'."""
    m = re.match(r"^([A-Z]{2,3}?)([FGHJKMNQUVXZ])(\d{1,2})$", str(sym or "").upper().strip())
    if not m:
        return str(sym or "").upper().strip()
    yy = m.group(3) if len(m.group(3)) == 2 else "2" + m.group(3)
    return m.group(1) + m.group(2) + yy


def screen(state_keys, days=SCREEN_DAYS, passes=5):
    """screen_once until nothing more drops: taking a misread out can tighten
    the spread of its neighbors enough to show the next one (Iowa, Oct 17:
    24 more -200c soybean points on a second pass). -> (kept, dropped)."""
    kept, dropped = dict(state_keys), []
    for _ in range(passes):
        kept, d = screen_once(kept, days)
        dropped += d
        if not d:
            break
    return kept, dropped


def screen_once(state_keys, days=SCREEN_DAYS):
    """Drop logged points the cash-bid pages would call a misread.

    2026-10-17 audit (N5): the Decatur log printed "low -200c" for Primient
    (Jan '27 corn, Aug 27), a board misread the bid pages already set aside.
    Each point is tested with scripts/basis_method.py relative_outlier()
    against the other elevators in the state (same crop, same futures
    contract), each at its latest logged basis in the SCREEN_DAYS before the
    point. Fewer than four others: the point stays (nothing safe to say).
    -> (kept {key: pts}, dropped [(key, point, test)])."""
    groups = {}
    for k, pts in state_keys.items():
        p = k.split("|")
        if len(p) < 6:
            continue
        g = groups.setdefault((p[3], norm_symbol(p[4])), [])
        fac = (p[1].upper(), p[2].upper())
        for pt in pts:
            g.append((pt["date"], fac, pt["cents"], k))
    bad = set()
    dropped = []
    for g in groups.values():
        g.sort()
        dates = [x[0] for x in g]
        for date, fac, cents, k in g:
            lo = (_dt.date.fromisoformat(date) - _dt.timedelta(days=days)).isoformat()
            i0, i1 = bisect.bisect_left(dates, lo), bisect.bisect_right(dates, date)
            latest = {}
            for d2, f2, c2, _k2 in g[i0:i1]:
                if f2 != fac:
                    latest[f2] = c2          # g is date-sorted: the last one wins
            t = relative_outlier(cents / 100, [c / 100 for c in latest.values()])
            if t is not None and t["via"] == "nearby":
                bad.add((k, date))
                dropped.append((k, {"date": date, "cents": cents}, t))
    kept = {}
    for k, pts in state_keys.items():
        keep = [pt for pt in pts if (k, pt["date"]) not in bad]
        if keep:
            kept[k] = keep
    return kept, dropped


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
        kept, dropped = screen(keys)
        state_out = {}
        for k, pts in kept.items():
            state_out[k] = pts[-MAX_POINTS:]
        out[state] = {
            "generated": None,  # filled by caller at write time
            "units": "integer cents per bushel",
            "note": "Real basis change-points only, replayed from data/basis/changes-*.json. A gap in the line is a gap in what changed, not missing data. "
                    "Points the cash-bid pages would call a misread (scripts/basis_method.py relative_outlier against the other elevators, same crop and contract, "
                    "latest basis in the 14 days before) are left out; screened counts them.",
            "screened": len(dropped),
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

    # the misread screen, hand-worked: five elevators at -10 to -20c on Dec '26
    # corn, one logs -200c. Median of the others -15, MAD 2.5c -> scale floors
    # at 15c, gate 75c; -200 is 185c off: dropped. -40 is 25c off: kept.
    assert norm_symbol("ZCZ6") == "ZCZ26" and norm_symbol("ZSH27") == "ZSH27" and norm_symbol("x") == "X"
    keys = {key_for("IL", f"E{i}", "T", "corn", "ZCZ26", "DEC26"): [{"date": "2026-09-01", "cents": c}]
            for i, c in enumerate((-10, -15, -20, -12, -18))}
    keys[key_for("IL", "PRIMIENT", "DECATUR", "corn", "ZCZ6", "JAN27")] = [{"date": "2026-09-02", "cents": -200}, {"date": "2026-09-05", "cents": -40}]
    kept, dropped = screen(keys)
    pk = key_for("IL", "PRIMIENT", "DECATUR", "corn", "ZCZ6", "JAN27")
    assert kept[pk] == [{"date": "2026-09-05", "cents": -40}], kept[pk]
    assert [d[1]["cents"] for d in dropped] == [-200], dropped
    # a soybean board is not compared with corn, and an old value (over 14 days) does not count
    keys2 = {key_for("IL", f"E{i}", "T", "corn", "ZCZ26", "DEC26"): [{"date": "2026-08-01", "cents": -10}] for i in range(5)}
    keys2[key_for("IL", "X", "Y", "corn", "ZCZ26", "DEC26")] = [{"date": "2026-09-02", "cents": -200}]
    keys2[key_for("IL", "Z", "Y", "soybeans", "ZSX26", "NOV26")] = [{"date": "2026-08-01", "cents": 300}]
    kept2, dropped2 = screen(keys2)
    assert not dropped2 and len(kept2) == 7, dropped2
    print("selftest OK: misread screen drops -200c among -10 to -20c, keeps -40c, needs 4 recent others")
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
