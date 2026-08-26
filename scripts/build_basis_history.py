#!/usr/bin/env python3
"""
build_basis_history.py  —  the basis monitor, lite.

WHAT IT KEEPS, AND WHY IT HAD TO EXIST
--------------------------------------
`data/bids.json` used to commit every row it fetched, so its git history was
also, by accident, a per-elevator basis history. On 2026-08-19 it was slimmed
to the few hundred rows the futures pages can actually select -- correctly; a
browser should never be sent 18,000 bids -- and the accident stopped. From
that day the fetch has been seeing 18,590 bids at 407 facilities and keeping
344 at 35. The history for the other 758 elevators ended, and unlike a bug
that cannot be repaired afterwards: a basis that moved on 2026-08-23 and was
not written down is simply gone.

This keeps it, cheaply, and it is deliberately not a time series. A basis is
sticky -- 19 of 19 rows on one captured board were unchanged over seven days --
so storing a number a day per key would be storing the same number a day. What
is stored instead is the CURRENT basis, the one before it, and the day it
changed. That is what a grower asks ("has my basis moved, and when"), it is
what /cash-bids draws, and it is small enough to send to a phone.

THREE THINGS ARE WRITTEN, and they have different jobs:

  data/basis/<ST>.json          one shard per state. What /cash-bids fetches,
                                after the bids land and it knows which states
                                are on screen. Rewritten daily, but only the
                                handful of rows that moved differ, so git
                                deltas it to nearly nothing.

  data/basis/changes-<date>.json   only what moved that day. WRITTEN ONCE AND
                                NEVER REWRITTEN -- this is the durable record.
                                Every shard above can be rebuilt from these,
                                which is the property that makes the shards
                                safe to regenerate.

  data/basis/index.json         which states exist, how many rows, when.

BACKFILL. `--backfill-from-git` replays `data/bids.json` out of git history,
newest-commit-per-day, and seeds the shards with everything from 2026-06-09
(the first day the bids array was populated -- the commits go back to March but
carry no rows) to 2026-08-19. That is 68 populated days and about ten weeks of
depth on day one. Run it once.

UNITS. `data/bids.json` normalises basis to DOLLARS (-0.55). The live Barchart
payload /cash-bids reads gives CENTS ("-55.00"). Everything here is integer
cents, converted once, on the way in, and never again -- the boundary is
crossed in exactly one place on purpose.

Usage:
    python3 scripts/build_basis_history.py --backfill-from-git     # once
    python3 scripts/build_basis_history.py                         # each run
    python3 scripts/build_basis_history.py --check                 # CI-safe
"""
import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone

FULL_PATH = os.environ.get("BIDS_FULL_PATH", "bids-full.json")
OUT_DIR = "data/basis"
COMMITTED = "data/bids.json"
FIRST_POPULATED = "2026-06-09"
CATS = ["corn", "soybeans", "wheat", "other"]
CAT_IX = {c: i for i, c in enumerate(CATS)}


# ---------------------------------------------------------------- keys -----
def _norm(s):
    return " ".join(str(s or "").strip().upper().split())


def key_of(b):
    """A row's identity. Facility, town and state, then WHICH CONTRACT.

    The symbol is in the key and not merely along for the ride. Two rows at one
    elevator can carry the same delivery month against different contracts, and
    without the symbol they collapse into one key that then appears to change
    basis several times a day -- an early version of this counted 123 changes
    in 68 days on a single Big River row, which is more changes than there were
    days, and every one of them was two rows arguing rather than a board
    moving.
    """
    return (_norm(b.get("facility")), _norm(b.get("city")), _norm(b.get("state")),
            _norm(b.get("category")), _norm(b.get("symbol")), _norm(b.get("deliveryMonth")))


def cents(v):
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if f != f or f in (float("inf"), float("-inf")):
        return None
    return int(round(f * 100))


def day_rows(bids):
    """One basis per key for one day. FIRST ROW WINS on a same-key collision.

    It has to be a rule and it has to be stable, because 'whichever came last'
    would make a change out of nothing but the feed reordering itself.
    """
    out = {}
    for b in bids or []:
        c = cents(b.get("basis"))
        if c is None:
            continue
        k = key_of(b)
        if k in out:
            continue
        out[k] = c
    return out


# ------------------------------------------------------------- the state ---
def load_state(out_dir):
    """Read the shards back into one dict. The shards are the state."""
    st = {}
    idx_path = os.path.join(out_dir, "index.json")
    if not os.path.exists(idx_path):
        return st
    with open(idx_path) as f:
        idx = json.load(f)
    for state in idx.get("states", {}):
        p = os.path.join(out_dir, state + ".json")
        if not os.path.exists(p):
            continue
        with open(p) as f:
            sh = json.load(f)
        fac = sh.get("f", [])
        dates = sh.get("d", [])
        for r in sh.get("r", []):
            fi, ci, sym, month, cur, prev, since_i, first_i, last_i = r
            facility, city = (fac[fi].split("|", 1) + [""])[:2]
            g = lambda i: dates[i] if i is not None and i < len(dates) else None
            st[(facility, city, state, CATS[ci].upper(), sym, month)] = {
                "cur": cur, "prev": prev,
                "since": g(since_i), "first": g(first_i), "last": g(last_i),
            }
    return st


def apply_day(state, rows, date):
    """Fold one day into the running state. Returns the day's changes."""
    changed = []
    for k, c in rows.items():
        s = state.get(k)
        if s is None:
            state[k] = {"cur": c, "prev": None, "since": date, "first": date,
                        "last": date}
            continue
        # THE DAY WE LAST SAW THIS ROW AT ALL, changed or not. Without it the
        # page cannot honestly date a basis that has moved since the file was
        # built: it knows the old number and that it is stale, but "moved since
        # <the day we last looked>" is only true if we wrote that day down.
        s["last"] = date
        if c != s["cur"]:
            changed.append((k, s["cur"], c))
            s["prev"] = s["cur"]
            s["cur"] = c
            s["since"] = date
    return changed


# ------------------------------------------------------------- the write ---
def write_shards(state, out_dir, generated):
    os.makedirs(out_dir, exist_ok=True)
    by_state = {}
    for (facility, city, st, cat, sym, month), v in state.items():
        by_state.setdefault(st or "??", []).append((facility, city, cat, sym, month, v))
    index = {"generated": generated, "units": "integer cents per bushel",
             "note": ("Per elevator, per commodity, per contract, per delivery month: "
                      "the basis now, the basis before it, and the day it changed. "
                      "Rebuildable in full from the changes-*.json files beside this."),
             "states": {}}
    for st in sorted(by_state):
        # Sorted on the five identity fields ONLY. `sorted(...)` on the whole
        # tuple compares the trailing dict when all five tie and raises; it
        # survived the backfill because nothing tied there, which is exactly
        # the kind of luck that fails later on somebody else's data.
        rows = sorted(by_state[st], key=lambda r: r[:5])
        facs, fi = [], {}
        dates, di = [], {}

        def date_ix(d):
            if d is None:
                return None
            if d not in di:
                di[d] = len(dates)
                dates.append(d)
            return di[d]

        packed = []
        for facility, city, cat, sym, month, v in rows:
            fk = facility + "|" + city
            if fk not in fi:
                fi[fk] = len(facs)
                facs.append(fk)
            packed.append([fi[fk], CAT_IX.get(cat.lower(), 3), sym, month,
                           v["cur"], v["prev"], date_ix(v["since"]),
                           date_ix(v["first"]), date_ix(v.get("last"))])
        shard = {"state": st, "generated": generated, "c": CATS,
                 "cols": ["facility", "commodity", "symbol", "deliveryMonth",
                          "basis", "basisBefore", "changedOn", "firstSeen",
                          "lastSeen"],
                 "f": facs, "d": dates, "r": packed}
        p = os.path.join(out_dir, st + ".json")
        with open(p, "w") as f:
            json.dump(shard, f, separators=(",", ":"))
        index["states"][st] = {"rows": len(packed), "facilities": len(facs),
                               "kb": round(os.path.getsize(p) / 1024, 1)}
    with open(os.path.join(out_dir, "index.json"), "w") as f:
        json.dump(index, f, separators=(",", ":"), indent=1)
    return index


def write_changes(changed, out_dir, date):
    """The day's movements. Appended to, never overwritten.

    This first REFUSED to touch an existing file for the day, which sounds like
    the same rule and is not. The fetch can run more than once a day, and on
    the second run of a day when a board had moved between them, the change was
    folded into the state and then dropped on the floor here -- the shards were
    right, the record they are supposed to be rebuildable from was not, and the
    log cheerfully said "0 moved". A change already on file is skipped by its
    own identity; a new one is added.
    """
    p = os.path.join(out_dir, "changes-%s.json" % date)
    doc = {"date": date, "units": "integer cents per bushel",
           "columns": ["state", "facility", "city", "commodity", "symbol",
                       "deliveryMonth", "from", "to"],
           "changes": []}
    if os.path.exists(p):
        try:
            with open(p) as f:
                prior = json.load(f)
            if isinstance(prior.get("changes"), list):
                doc["changes"] = prior["changes"]
        except (OSError, json.JSONDecodeError):
            pass                       # a corrupt day is rebuilt, not trusted
    seen = {tuple(r[:6]) for r in doc["changes"]}
    added = 0
    for (k, old_v, new_v) in sorted(changed, key=lambda x: (x[0][2], x[0][0], x[0][5])):
        row = [k[2], k[0], k[1], k[3].lower(), k[4], k[5], old_v, new_v]
        if tuple(row[:6]) in seen:
            continue
        seen.add(tuple(row[:6]))
        doc["changes"].append(row)
        added += 1
    doc["changes"].sort(key=lambda r: (r[0], r[1], r[5]))
    os.makedirs(out_dir, exist_ok=True)
    with open(p, "w") as f:
        json.dump(doc, f, separators=(",", ":"))
    return p, added


# ---------------------------------------------------------------- backfill --
def git_days(path):
    out = subprocess.run(["git", "log", "--date=format-local:%Y-%m-%d",
                          "--format=%ad %H", "--", path],
                         capture_output=True, text=True, check=True).stdout
    newest = {}
    for line in out.strip().splitlines():
        d, _, h = line.partition(" ")
        newest.setdefault(d, h)          # git log is newest-first
    return dict(sorted(newest.items()))


def git_show_json(rev, path):
    r = subprocess.run(["git", "show", "%s:%s" % (rev, path)],
                       capture_output=True, text=True)
    if r.returncode != 0:
        return None
    try:
        return json.loads(r.stdout)
    except json.JSONDecodeError:
        return None


def backfill(out_dir):
    days = git_days(COMMITTED)
    state, total_changes, used = {}, 0, 0
    for date, rev in days.items():
        if date < FIRST_POPULATED:
            continue
        doc = git_show_json(rev, COMMITTED)
        if not doc:
            continue
        rows = day_rows(doc.get("bids"))
        if not rows:
            continue
        used += 1
        changed = apply_day(state, rows, date)
        total_changes += len(changed)
        if changed:
            write_changes(changed, out_dir, date)
    print("[basis-history] backfilled %d populated days, %s -> %s"
          % (used, min(d for d in days if d >= FIRST_POPULATED), max(days)))
    print("[basis-history] %d keys, %d recorded changes" % (len(state), total_changes))
    return state


# -------------------------------------------------------------------- main --
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--full", default=FULL_PATH)
    ap.add_argument("--out", default=OUT_DIR)
    ap.add_argument("--backfill-from-git", action="store_true")
    ap.add_argument("--check", action="store_true")
    a = ap.parse_args()
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    if a.backfill_from_git:
        state = backfill(a.out)
    else:
        state = load_state(a.out)
        # --check with no full file to fold in is still a useful question:
        # do the shards on disk read back? A CI step can ask it, and it must
        # not fail merely because the runner does not have the day's pull.
        if a.check and not os.path.exists(a.full):
            print("[basis-history] --check: %d keys read back from %d shards; "
                  "no full pull present, nothing folded in."
                  % (len(state), len(set(k[2] for k in state))))
            return 0
        if not os.path.exists(a.full):
            print("[basis-history] %s is not here. This runs in the same job as "
                  "fetch_bids.py, while the full set still exists; the full file "
                  "is never committed. Nothing written." % a.full, file=sys.stderr)
            return 3
        with open(a.full) as f:
            doc = json.load(f)
        if not doc.get("full"):
            print("[basis-history] REFUSING a file that does not say full:true. "
                  "The slim bids.json carries a few hundred rows at 35 grid "
                  "facilities; folding it in would record 'no change' for every "
                  "elevator it does not contain.", file=sys.stderr)
            return 4
        rows = day_rows(doc.get("bids"))
        if len(rows) < 1000:
            print("[basis-history] REFUSING %d rows — that is not a national "
                  "pull, and a short day must not be written down as a quiet "
                  "one." % len(rows), file=sys.stderr)
            return 5
        changed = apply_day(state, rows, today)
        if a.check:
            print("[basis-history] --check: %d keys, %d would change today."
                  % (len(state), len(changed)))
            return 0
        p, n = write_changes(changed, a.out, today)
        print("[basis-history] %d rows in, %d moved -> %s" % (len(rows), n, p))

    if a.check:
        print("[basis-history] --check: %d keys, nothing written." % len(state))
        return 0
    index = write_shards(state, a.out, today)
    tot = sum(v["kb"] for v in index["states"].values())
    big = sorted(index["states"].items(), key=lambda kv: -kv[1]["kb"])[:5]
    print("[basis-history] wrote %d state shards, %.0f KB total (largest: %s)"
          % (len(index["states"]), tot,
             ", ".join("%s %.0fKB" % (k, v["kb"]) for k, v in big)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
