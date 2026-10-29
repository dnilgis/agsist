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
    python3 scripts/build_basis_history.py --selftest
"""
import argparse
import glob
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


def day_ids(bids):
    """{(FACILITY, CITY, STATE): [elevId, fips, fipsSure]} from the rows' own board keys
    (fetch_bids.board_keys, 2026-10-27). A basis key is facility and town, not board: when
    two boards of different ids share one key that day, the key gets no id (never a guess)."""
    out, bad = {}, set()
    for b in bids or []:
        e = b.get("elevId")
        if not e:
            continue
        k = (_norm(b.get("facility")), _norm(b.get("city")), _norm(b.get("state")))
        v = [e, b.get("fips") or None, b["fipsSure"] if isinstance(b.get("fipsSure"), bool) else None]
        if k in out and out[k][0] != e:
            bad.add(k)
        out.setdefault(k, v)
    for k in bad:
        out.pop(k, None)
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


# ------------------------------------------- the old feed's unit errors ---
# THE OCT 29 DATA CHECK (feedbag notes/audits/bids-dq-2026-10-29.md). The old
# Barchart feed's rows were read by fetch_bids.py `_norm_basis`, which divided
# by 100 only when |basis| >= 5: a basis of 1 to 4 CENTS was stored as 1 to 4
# DOLLARS, so this record holds 100 to 400 where the board meant 1 to 4. The
# feed is off (no Barchart row after 2026-10-09; nothing it wrote is seen after
# BARCHART_LAST), so those rows match no live bid; they are still read by the
# grain-on-the-move weekly basis and by anything that opens a whole shard.
# Measured on the daily snapshots, where the rows' cash prices let cash - basis
# be checked against that day's futures: among Barchart corn, soybean and wheat
# rows with a round +-2, +-3 or +-4 dollar basis, 2,088 were the unit error and 9
# were real; at -1 dollar most were real (5,654 to 325), at +1 mixed (187 to
# 257), so a lone -100 or +100 is not dropped. Dropped here, from the shards
# only (the changes-*.json files are the record and are never rewritten), are
# rows on the hand-flag list (scripts/bid_hand_flags.json: a person judged them
# bad, the evidence written beside each), and rows of the three crops last seen
# on or before BARCHART_LAST whose basis now
# or before is a round +-200, +-300 or +-400, or whose record holds the error's
# own step: a move of 90 cents or more between a round quarter-dollar value of
# at least 100 and a value under 100 (Consolidated Grain & Barge, Sherrill AR,
# soybeans Dec26: -300 then -7, a 3 cent basis read as dollars and then a 7 cent
# one read right). A live row is never dropped by this.
BARCHART_LAST = "2026-10-11"
UNIT_ERROR_ROUND = (200, 300, 400)
UNIT_ERROR_CROPS = ("CORN", "SOYBEANS", "WHEAT")


def unit_error_step(a, b):
    """True when a -> b is the old feed's cents-as-dollars step."""
    if a is None or b is None:
        return False
    lo, hi = sorted((abs(a), abs(b)))
    return hi >= 100 and hi % 25 == 0 and lo < 100 and abs(a - b) >= 90


def unit_error_rows(state, out_dir):
    """{key: reason} for the old feed's rows to drop from the shards (see above)."""
    steps = {}
    for p in sorted(glob.glob(os.path.join(out_dir, "changes-*.json"))):
        try:
            with open(p) as f:
                doc = json.load(f)
        except (OSError, json.JSONDecodeError):
            continue
        for r in doc.get("changes") or []:
            if len(r) >= 8 and unit_error_step(r[6], r[7]):
                steps[(r[1], r[2], r[0], str(r[3]).upper(), r[4], r[5])] = True
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import bid_flags            # the hand-flag list, read the same way the snapshot flags read it
    hand = bid_flags.hand_index()
    out = {}
    for k, v in state.items():
        hv = hand.get(k)
        if hv and (v.get("cur") in hv or v.get("prev") in hv):
            out[k] = "hand"
            continue
        if k[3] not in UNIT_ERROR_CROPS or not v.get("last") or v["last"] > BARCHART_LAST:
            continue
        if any(isinstance(x, int) and abs(x) in UNIT_ERROR_ROUND for x in (v.get("cur"), v.get("prev"))):
            out[k] = "round"
        elif k in steps or unit_error_step(v.get("prev"), v.get("cur")):
            out[k] = "step"
    return out


# ------------------------------------------------------------- the write ---
def write_shards(state, out_dir, generated):
    os.makedirs(out_dir, exist_ok=True)
    # ── A STATE THE ROW ALREADY CARRIES IS NOT A GUESS ────────────────────
    # This wrote `st or "??"`, and cash-bids.html fetches
    # /data/basis/{STATE}.json — so there is no control on the page that can
    # ever ask for "??". Every row that landed there was basis history
    # collected, written, committed and unreachable.
    #
    # Some of those rows state their own state in their city field:
    #
    #     HILLSIDE GRAIN, LLC | GOLDEN CITY, MO
    #
    # Reading "MO" off the end of that is reading, not inventing, so it is
    # done. A row with nothing to read stays stateless — and is REPORTED
    # rather than filed somewhere nobody can open.
    US_STATES = frozenset(
        ("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI "
         "MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT "
         "VA WA WV WI WY PR VI GU AS MP").split())

    def state_of(city, st):
        if st:
            return st
        tail = (city or "").strip().rsplit(",", 1)
        if len(tail) == 2:
            code = tail[1].strip().upper()
            if code in US_STATES:
                return code
        return None

    by_state, stateless = {}, []
    recovered = 0
    for (facility, city, st, cat, sym, month), v in state.items():
        code = state_of(city, st)
        if code is None:
            stateless.append("%s | %s" % (facility, city or "no city"))
            continue
        if not st:
            recovered += 1
        by_state.setdefault(code, []).append((facility, city, cat, sym, month, v))

    if recovered:
        print("  %d row(s) placed by the state written in their own city field"
              % recovered)
    if stateless:
        # Named, not counted. A number here is a shrug; a name is a fix.
        uniq = sorted(set(stateless))
        print("::warning::%d basis row(s) carry no state and were NOT written — "
              "the page can only fetch /data/basis/{STATE}.json, so a '??' shard "
              "would be collected and unreachable. Give these a state at the "
              "source: %s" % (len(stateless), "; ".join(uniq[:10])))
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


def write_changes(changed, out_dir, date, ids=None):
    """The day's movements. Appended to, never overwritten.

    This first REFUSED to touch an existing file for the day, which sounds like
    the same rule and is not. The fetch can run more than once a day, and on
    the second run of a day when a board had moved between them, the change was
    folded into the state and then dropped on the floor here -- the shards were
    right, the record they are supposed to be rebuildable from was not, and the
    log cheerfully said "0 moved". A change already on file is skipped by its
    own identity; a new one is added.
    """
    # THE BOARD'S ID, COUNTY AND fipsSure (2026-10-27). A ninth column, `idx`, points into the
    # file's own `ids` table ([elevId, fips, fipsSure], one entry per board that moved), so a
    # change is joined on the permanent id, not on spelling. A table and an index, not three
    # columns: a board moves about three rows a day, and the table holds it once. A row from
    # before this, or a key no single board holds, has no idx (8 columns, or null).
    p = os.path.join(out_dir, "changes-%s.json" % date)
    doc = {"date": date, "units": "integer cents per bushel",
           "columns": ["state", "facility", "city", "commodity", "symbol",
                       "deliveryMonth", "from", "to", "idx"],
           "idCols": ["elevId", "fips", "fipsSure"], "ids": [],
           "changes": []}
    if os.path.exists(p):
        try:
            with open(p) as f:
                prior = json.load(f)
            if isinstance(prior.get("changes"), list):
                doc["changes"] = prior["changes"]
            if isinstance(prior.get("ids"), list):
                doc["ids"] = prior["ids"]
        except (OSError, json.JSONDecodeError):
            pass                       # a corrupt day is rebuilt, not trusted
    seen = {tuple(r[:6]) for r in doc["changes"]}
    id_ix = {tuple(v): i for i, v in enumerate(doc["ids"])}
    added = 0
    for (k, old_v, new_v) in sorted(changed, key=lambda x: (x[0][2], x[0][0], x[0][5])):
        row = [k[2], k[0], k[1], k[3].lower(), k[4], k[5], old_v, new_v]
        if tuple(row[:6]) in seen:
            continue
        v = (ids or {}).get((k[0], k[1], k[2]))
        if v:
            t = tuple(v)
            if t not in id_ix:
                id_ix[t] = len(doc["ids"])
                doc["ids"].append(list(v))
            row.append(id_ix[t])
        elif ids is not None:
            row.append(None)
        seen.add(tuple(row[:6]))
        doc["changes"].append(row)
        added += 1
    if not doc["ids"]:
        del doc["ids"], doc["idCols"]
        doc["columns"] = doc["columns"][:8]
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
def selftest():
    """python3 scripts/build_basis_history.py --selftest"""
    import tempfile
    fails = []

    def ck(name, ok):
        print(("ok   " if ok else "FAIL ") + name)
        if not ok:
            fails.append(name)
    # Real rows (feed of 2026-10-27T18:07:59Z): Abbyville KS (street point, county sure) and the
    # Assumption Coop board at Assumption IL (ZIP-centroid point near a county line).
    ab = {"facility": "Abbyville Farmers Co-op Grain Co.", "city": "Abbyville", "state": "KS", "category": "wheat",
          "symbol": "December 2026", "deliveryMonth": "01 Sep 2026 to 30 Nov 2026", "basis": -0.60,
          "elevId": "epb8e8r7nr", "fips": "20155", "fipsSure": True}
    asm = {"facility": "Assumption Coop", "city": "Assumption", "state": "IL", "category": "corn", "symbol": "ZCZ26",
           "deliveryMonth": "10/01/2026", "basis": -0.30, "elevId": "e4sn84jb9v", "fips": "17021", "fipsSure": False}
    two = [dict(asm, elevId="e000000001", city="Twin"), dict(asm, elevId="e000000002", city="Twin", symbol="ZCH27")]
    ids = day_ids([ab, dict(ab, category="corn"), asm] + two)
    ck("a key carries its board's id, county and fipsSure",
       ids.get(("ABBYVILLE FARMERS CO-OP GRAIN CO.", "ABBYVILLE", "KS")) == ["epb8e8r7nr", "20155", True])
    ck("fipsSure false is kept", ids.get(("ASSUMPTION COOP", "ASSUMPTION", "IL")) == ["e4sn84jb9v", "17021", False])
    ck("two boards on one key: no id, never a guess", ("ASSUMPTION COOP", "TWIN", "IL") not in ids)
    with tempfile.TemporaryDirectory() as d:
        state = {}
        apply_day(state, day_rows([ab, dict(ab, category="corn"), asm] + two), "2026-10-26")
        moved = [dict(ab, basis=-0.55), dict(asm, basis=-0.28), dict(two[0], basis=-0.10), dict(ab, category="corn", basis=-0.4)]
        ch = apply_day(state, day_rows(moved[:3]), "2026-10-27")
        p, n = write_changes(ch, d, "2026-10-27", day_ids(moved + [two[1]]))
        doc = json.load(open(p))
        by = {r[1]: r for r in doc["changes"]}
        ck("each change points at its board in the file's id table",
           n == 3 and doc["columns"][8] == "idx" and doc["ids"][by["ABBYVILLE FARMERS CO-OP GRAIN CO."][8]] == ["epb8e8r7nr", "20155", True])
        twin = [r for r in doc["changes"] if r[2] == "TWIN"]
        ck("a key no single board holds has a null idx", len(twin) == 1 and twin[0][8] is None)
        ch2 = apply_day(state, day_rows([moved[3]]), "2026-10-27")
        write_changes(ch2, d, "2026-10-27", day_ids([moved[3]]))
        doc2 = json.load(open(p))
        ck("a second run that day adds its rows and reuses the board's table entry",
           len(doc2["changes"]) == 4 and len(doc2["ids"]) == len(doc["ids"])
           and all(doc2["ids"][r[8]][0] == "epb8e8r7nr" for r in doc2["changes"] if r[1].startswith("ABBYVILLE")))
        p3, _ = write_changes(ch, d, "2026-10-28", None)
        ck("a run without ids writes the old eight columns", json.load(open(p3))["columns"][-1] == "to"
           and "ids" not in json.load(open(p3)))
    # THE OLD FEED'S UNIT ERRORS (Oct 29). Real shard rows (data/basis on main, 2026-10-29).
    with tempfile.TemporaryDirectory() as d:
        st = {
            # CGB Sherrill AR soybeans Dec26: -300 then -7 (3 cents read as dollars, then 7 cents read right)
            ("CONSOLIDATED GRAIN & BARGE", "SHERRILL", "AR", "SOYBEANS", "ZSF27", "DEC26"):
                {"cur": -7, "prev": -300, "since": "2026-09-29", "first": "2026-06-09", "last": "2026-10-11"},
            # CGB Sherrill AR soybeans Feb27: 0 then 100 (one cent read as a dollar), and its step is in the log
            ("CONSOLIDATED GRAIN & BARGE", "SHERRILL", "AR", "SOYBEANS", "ZSH27", "FEB27"):
                {"cur": 100, "prev": 0, "since": "2026-10-05", "first": "2026-06-26", "last": "2026-10-11"},
            # CGB Sherrill AR corn Jul26: 400 then 200, both round dollars
            ("CONSOLIDATED GRAIN & BARGE", "SHERRILL", "AR", "CORN", "ZCU26", "JUL26"):
                {"cur": 200, "prev": 400, "since": "2026-07-30", "first": "2026-06-29", "last": "2026-07-30"},
            # a lone -100 on an old row is most often real (Central Farm Service beans posted -$1.00 all summer)
            ("CENTRAL FARM SERVICE", "TRUMAN", "MN", "SOYBEANS", "ZSX26", "NOV26"):
                {"cur": -100, "prev": None, "since": "2026-06-09", "first": "2026-06-09", "last": "2026-10-09"},
            # a LIVE row is never dropped: Prairie Ag Partners, Lake Preston SD posted KC wheat 0 then -100 on Oct 1
            ("PRAIRIE AG PARTNERS", "LAKE PRESTON", "SD", "WHEAT", "KEZ26", "10/01/2026"):
                {"cur": -100, "prev": 0, "since": "2026-10-01", "first": "2026-10-01", "last": "2026-10-29"},
            # a live row at 300 is the board's own number; the page's bounds handle it, not this
            ("LIVE CO", "TOWN", "IA", "CORN", "ZCZ26", "NOV26"):
                {"cur": 300, "prev": None, "since": "2026-10-20", "first": "2026-10-20", "last": "2026-10-29"},
            # a meal row ("other") is not one of the three crops
            ("ADM GRAIN", "FRANKFORT", "IN", "OTHER", "ZMN26", "JUN26"):
                {"cur": 4000, "prev": 200, "since": "2026-06-10", "first": "2026-06-09", "last": "2026-06-30"},
        }
        with open(os.path.join(d, "changes-2026-10-05.json"), "w") as f:
            json.dump({"date": "2026-10-05", "changes": [["AR", "CONSOLIDATED GRAIN & BARGE", "SHERRILL", "soybeans",
                                                          "ZSH27", "FEB27", 0, 100]]}, f)
        bad = unit_error_rows(st, d)
        ck("old-feed unit errors: the -300/-7 step, the 0/100 step and the round dollars are dropped",
           bad == {("CONSOLIDATED GRAIN & BARGE", "SHERRILL", "AR", "SOYBEANS", "ZSF27", "DEC26"): "round",
                   ("CONSOLIDATED GRAIN & BARGE", "SHERRILL", "AR", "SOYBEANS", "ZSH27", "FEB27"): "step",
                   ("CONSOLIDATED GRAIN & BARGE", "SHERRILL", "AR", "CORN", "ZCU26", "JUL26"): "round"})
        ck("a lone old -100, a live row and a meal row are kept",
           not any(k[0] in ("CENTRAL FARM SERVICE", "PRAIRIE AG PARTNERS", "LIVE CO", "ADM GRAIN") for k in bad))
        hb = {("H & B SPECIALTIES, INC.", "NAPLES", "IL", "CORN", "ZCK27", "MAY27"):
              {"cur": 100, "prev": None, "since": "2026-07-16", "first": "2026-07-16", "last": "2026-09-22"},
              ("H & B SPECIALTIES, INC.", "NAPLES", "IL", "CORN", "ZCH27", "MAR27"):
              {"cur": 100, "prev": 75, "since": "2026-08-07", "first": "2026-06-09", "last": "2026-09-22"},
              ("H & B SPECIALTIES, INC.", "NAPLES", "IL", "CORN", "ZCK27", "MAY27X"):
              {"cur": 100, "prev": None, "since": "2026-07-16", "first": "2026-07-16", "last": "2026-09-22"}}
        ck("hand list: H & B Naples IL +100 corn rows (Mar27, May27) are dropped, a key not on it is kept",
           unit_error_rows(hb, d) == {k: "hand" for k in list(hb)[:2]})
        ck("the step rule: 90 cents or more between a round value of 100+ and one under 100",
           unit_error_step(-300, -7) and unit_error_step(100, -25) and not unit_error_step(-100, -95)
           and not unit_error_step(-130, -40) and not unit_error_step(None, 100))
    print(f"FAILS={len(fails)}")
    return 1 if fails else 0


def main():
    if "--selftest" in sys.argv[1:]:
        return selftest()
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
        p, n = write_changes(changed, a.out, today, day_ids(doc.get("bids")))
        print("[basis-history] %d rows in, %d moved -> %s" % (len(rows), n, p))

    if a.check:
        print("[basis-history] --check: %d keys, nothing written." % len(state))
        return 0
    bad = unit_error_rows(state, a.out)
    if bad:
        for k in bad:
            del state[k]
        print("[basis-history] %d old-feed row(s) with a cents basis read as dollars left out of the shards "
              "(%d round, %d step, %d hand-flagged; the changes files keep the record)"
              % (len(bad), sum(v == "round" for v in bad.values()), sum(v == "step" for v in bad.values()),
                 sum(v == "hand" for v in bad.values())))
    index = write_shards(state, a.out, today)
    tot = sum(v["kb"] for v in index["states"].values())
    big = sorted(index["states"].items(), key=lambda kv: -kv[1]["kb"])[:5]
    print("[basis-history] wrote %d state shards, %.0f KB total (largest: %s)"
          % (len(index["states"]), tot,
             ", ".join("%s %.0fKB" % (k, v["kb"]) for k, v in big)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
