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
from build_basis_history import row_state  # noqa: E402  (the one rule for a row's state)

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


# A change-log row with no state (Nov 4, 2026: HILLSIDE GRAIN, LLC | GOLDEN CITY, MO, soybeans ZSX26,
# in changes-2026-08-03.json) was filed under the state "", so every run rewrote a nameless
# data/basis-sparklines/.json that no page can ask for. The logs are never rewritten, so the state is
# read the way build_basis_history.py reads it (the state at the end of the city field); a row with
# nothing to read is skipped and counted in build()'s `stateless`, never written.
def build(stats=None):
    files = sorted(glob.glob(CHANGES_GLOB))
    by_state = {}  # state -> key -> list of {date, to}
    stats = {} if stats is None else stats
    stats.update(recovered=0, stateless=0)
    for fp in files:
        with open(fp) as f:
            d = json.load(f)
        date = d["date"]
        for row in d["changes"]:
            state, facility, city, commodity, symbol, dm, frm, to = row[:8]   # a ninth column (idx) since Oct 27
            st = row_state(state, city)
            if st is None:
                stats["stateless"] += 1
                continue
            if st != state:
                stats["recovered"] += 1
            state = st
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
            "note": 'Basis change points from the network cash bids, by elevator and crop.',
            "screened": len(dropped),
            "series": state_out,
        }
    return out


def write(out, generated):
    os.makedirs(OUT_DIR, exist_ok=True)
    written = []
    for state, payload in out.items():
        if not re.fullmatch(r"[A-Z]{2}", str(state)):
            raise ValueError("refusing to write a sparkline file for state %r" % (state,))
        payload["generated"] = generated
        path = os.path.join(OUT_DIR, f"{state}.json")
        with open(path, "w") as f:
            json.dump(payload, f, separators=(",", ":"))
        written.append(path)
    return written


def remove_strays():
    """Delete sparkline files this builder wrote under a name that is not a state (the nameless
    data/basis-sparklines/.json, Nov 4, 2026). Only a file holding a sparkline payload goes; the bids
    job's `git add data/basis-sparklines` records the deletion. -> [removed paths]"""
    removed = []
    for name in sorted(os.listdir(OUT_DIR)) if os.path.isdir(OUT_DIR) else []:
        path = os.path.join(OUT_DIR, name)
        if not name.endswith(".json") or re.fullmatch(r"[A-Z]{2}\.json", name) or not os.path.isfile(path):
            continue
        try:
            with open(path) as f:
                d = json.load(f)
        except (OSError, ValueError):
            continue
        if isinstance(d, dict) and "series" in d and "units" in d:
            os.remove(path)
            removed.append(path)
    return removed


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

        # the real case (changes-2026-08-03.json): a row with a blank state is filed by the state
        # in its city field; a row with nothing to read is skipped and counted; neither writes ".json"
        with open(os.path.join(td, "data/basis/changes-2026-08-03.json"), "w") as f:
            json.dump({"date": "2026-08-03", "changes": [
                ["", "HILLSIDE GRAIN, LLC", "GOLDEN CITY, MO", "soybeans", "ZSX26", "NOV26", None, -70],
                ["", "NOWHERE CO", "SOMEWHERE", "corn", "ZCZ26", "DEC26", None, -20],
                [None, "NOWHERE CO", "", "corn", "ZCZ26", "DEC26", None, -20],
            ]}, f)
        global OUT_DIR
        old_out = OUT_DIR
        REPO, CHANGES_GLOB, OUT_DIR = td, os.path.join(td, "data/basis/changes-*.json"), os.path.join(td, "out")
        stats = {}
        out = build(stats)
        written = write(out, "2026-11-04T00:00:00Z")
        REPO, CHANGES_GLOB, OUT_DIR = old_repo, old_glob, old_out
        assert stats == {"recovered": 1, "stateless": 2}, stats
        assert "" not in out and None not in out, sorted(map(str, out))
        assert key_for("MO", "HILLSIDE GRAIN, LLC", "GOLDEN CITY, MO", "soybeans", "ZSX26", "NOV26") in out["MO"]["series"]
        names = sorted(os.listdir(os.path.join(td, "out")))
        assert names == ["IA.json", "MO.json"], names
        assert sorted(os.path.basename(w) for w in written) == names, written
        # the nameless file main carried is removed on the next run; anything else stays
        with open(os.path.join(td, "out", ".json"), "w") as f:
            json.dump({"generated": "x", "units": "integer cents per bushel", "series": {}}, f)
        with open(os.path.join(td, "out", "notes.json"), "w") as f:
            json.dump({"other": 1}, f)
        OUT_DIR = os.path.join(td, "out")
        gone = remove_strays()
        OUT_DIR = old_out
        assert [os.path.basename(g) for g in gone] == [".json"], gone
        assert sorted(os.listdir(os.path.join(td, "out"))) == ["IA.json", "MO.json", "notes.json"]
        try:
            write({"": out["MO"]}, "x")
            raise AssertionError("write() took a blank state")
        except ValueError:
            pass
        print("selftest OK: blank state read from the city field (MO), 2 stateless rows skipped, no nameless file")

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

    stats = {}
    out = build(stats)
    if stats["recovered"] or stats["stateless"]:
        print(f"{stats['recovered']} change row(s) with no state filed by the state in their city field; "
              f"{stats['stateless']} with nothing to read skipped (no file is written for a blank state)")
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
    for path in remove_strays():
        print(f"removed {path}: a sparkline file named for no state")
