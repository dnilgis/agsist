#!/usr/bin/env python3
"""Private basis forecast ledger (rule set basis-ledger-v1, registered 2026-10-28).

WHY
---
Nobody publishes an auditable elevator-level basis forecast record. That record
only exists if forecasts are frozen when they are made and graded later on a
fixed rule. The Oct 28 backtest on our own snapshots found that "no change"
beats every level model, so no change (M0) is the benchmark here, and the
ledger also makes an EVENT call (will this series' basis move within 5 and 20
trading days, and which way) next to the level calls.

NOTHING HERE IS PUBLISHED. Everything goes to the private raw branch
(scripts/push_raw.sh), never to main or the site. Sig decides when the record
is shown (STANDING-DECISIONS, Oct 21: basis findings not published yet).

THE DISCIPLINE (copied from scripts/prediction_bot.py)
------------------------------------------------------
- RULES below carry a version and a registration date. Changing any rule is a
  new version with a new, separate record. Never edit them in place.
- A call file is frozen when written: one gz file per day, never rewritten.
  freeze() refuses to replace a file whose bytes differ, and the workflow only
  writes days that are not on raw yet.
- A call is graded only when the target day's snapshot exists AND holds the
  series. A missing target stays ungraded ("no snapshot", "not observed",
  "pending"), never counted right or wrong.
- Every rate carries n beside it and is withheld below the minimum sample.
- LIVE calls are made on the day, from that day's snapshot. REPLAY calls are
  what the same rules WOULD have made on the snapshots taken before the ledger
  existed. They live in separate folders, carry kind=replay, and are summarised
  separately. They are never mixed.

THE RULES (per series, at each origin day d, from snapshots on or before d only)
--------------------------------------------------------------------------------
Series = elevator x crop x delivery_start x futures contract x source (the
snapshot note's keying; source added because a Barchart row and a board row for
one elevator are two instruments). A contract roll is a new series. A missing
row means not observed, never unchanged. A row whose posted time equals the
series' previous observation is stale (the board did not update); stale origins
still get calls and carry the flag.
  M0  no change: the basis at d.
  M1  the state median basis at d (same crop, futures contract and delivery
      month, at least 3 elevators) plus this series' median premium to that
      median over the 20 trading days ending d (at least 3 days). Without
      either, M1 falls back to M0 and says why.
  P(move within h)  the crop x state share of series that moved within h
      trading days, over origins in the 60 trading days ending d whose target
      day is on or before d (so the outcome was known on d). Needs 30 graded
      outcomes, else withheld. Reference: the same share for the crop
      nationally (the benchmark the Brier score is compared with).
  Direction  the median 5-trading-day basis change at other elevators within
      100 miles (one value per elevator, same crop), from at least 3 board
      groups other than the elevator's own: up if at least +0.5 cents, down if
      at most -0.5 cents, otherwise no call.
"Moved within h" = some observed basis on a trading day in (d, target] differs
from the basis at d by at least 0.5 cents. Graded only when the target day
holds the series.
Ties: a direction call whose net change at the target is zero is "flat",
neither right nor wrong, and its count is printed beside the hit rate.

FILES (raw branch, private; path roots in .gitignore on main)
-------------------------------------------------------------
  basis-ledger/live/calls/YYYY/D.json.gz     frozen live calls
  basis-ledger/replay/calls/YYYY/D.json.gz   frozen replay calls
  basis-ledger/<kind>/grades/YYYY/D.json.gz  grades for that day's calls (rebuilt
                                             until every target is past and settled)
  basis-ledger/summary.json                  MAE, Brier, direction, n beside each

USAGE
-----
  python3 scripts/basis_ledger.py --selftest
  python3 scripts/basis_ledger.py run [--live-day D] [--ref origin/raw | --dir DIR] [--out-dir .]
      the workflow step: freeze today's live calls (only for today's CT day),
      replay any snapshot day through REPLAY_THROUGH not replayed yet, rebuild
      open grades and the summary. Writes only what changed.
  python3 scripts/basis_ledger.py summary [--ref origin/raw | --dir DIR] [--out-dir .]
"""
import argparse
import datetime as dt
import gzip
import hashlib
import io
import json
import math
import os
import re
import statistics
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import bid_snapshots as BS       # noqa: E402  the snapshot reader (one copy)
import contract_calendar as CC   # noqa: E402  THE trading calendar

# ── THE RULES. Changing any of these is a new rule set with a new version and
# a new, separate record. Never edit them in place. ─────────────────────────
RULES = {
    "version": "basis-ledger-v1",
    "registered": "2026-10-28",
    "horizons": [5, 20],
    "crops": ["corn", "soybeans", "wheat"],
    "series_key": "elevator id (else board facility|branch|city|state) x crop x delivery_start x futures contract x source",
    "move_cents": 0.5,
    "m1_state_min_elevators": 3,
    "m1_premium_days": 20,
    "m1_premium_min_days": 3,
    "base_rate_days": 60,
    "base_rate_min_n": 30,
    "peer_radius_miles": 100,
    "peer_min_groups": 3,
    "peer_lookback_days": 5,
    "peer_min_move_cents": 0.5,
    "stale_rule": "posted time equal to the series' previous observation (within 10 trading days)",
    "tie_rule": "a direction call with zero net change at the target is flat: neither right nor wrong, counted beside the rate",
    "missing_rule": "a call whose target day has no snapshot, or whose series is not in it, stays ungraded",
    "min_graded_for_rate": 200,
    "min_target_days_for_rate": 20,
}
REPLAY_THROUGH = "2026-10-28"     # the last day replay may cover; later days are live only
SCHEMA_CALLS = "agsist-basis-ledger-calls/1"
SCHEMA_GRADES = "agsist-basis-ledger-grades/1"
SCHEMA_SUMMARY = "agsist-basis-ledger-summary/1"
OUT = "basis-ledger"
KINDS = ("live", "replay")
SETTLE_DAYS = 10                  # grades stop being rebuilt this many trading days after the last target
SCALE = 10000                     # basis held as integer 1/100 cents, so 0.5 c is exactly 50
MOVE = int(round(RULES["move_cents"] / 100 * SCALE))
PEER_MOVE = int(round(RULES["peer_min_move_cents"] / 100 * SCALE))
CALL_COLS = ["series", "state", "basis", "stale", "m1", "m1_note", "direction", "peer_move", "peer_groups", "peer_elevs"]
H_COLS = ["h", "target", "p_move", "p_n", "p_ref", "p_ref_n"]
GRADE_COLS = ["series", "h", "target", "status", "actual", "moved", "net"]


class LookAhead(Exception):
    pass


class Frozen(Exception):
    pass


# ------------------------------------------------------------------ contracts
ROOTS = {"corn": {"ZC"}, "soybeans": {"ZS"}, "wheat": {"ZW", "KE", "MW", "MWO"}}
BARCHART = {"C": "ZC", "S": "ZS", "W": "ZW", "KW": "KE", "MW": "MW"}
MONTHS = {m: c for m, c in zip(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], "FGHJKMNQUVXZ")}


def norm_contract(sym, crop):
    """A canonical contract ('ZCZ26') from the forms boards post, or None when it is
    not clear (a month name for wheat without its exchange, a basis-contract code, a
    root that does not match the crop). None means the row is not used."""
    s = " ".join(str(sym or "").split())
    if not s:
        return None
    root = mon = yr = None
    m = re.fullmatch(r"(ZC|ZS|ZW|KE|MWO|MW)([FGHJKMNQUVXZ])(\d{1,2})", s, re.I)
    if m:
        root, mon, yr = m.group(1).upper(), m.group(2).upper(), m.group(3)
    else:
        m = re.fullmatch(r"@(KW|MW|C|S|W)(\d)([FGHJKMNQUVXZ])", s, re.I)
        if m:
            root, yr, mon = BARCHART[m.group(1).upper()], m.group(2), m.group(3).upper()
        else:
            m = re.fullmatch(r"([A-Za-z]{3})[a-z]*\.? (\d{2}|\d{4})(?: (.*))?", s)
            if m and m.group(1).lower() in MONTHS:
                mon, yr, rest = MONTHS[m.group(1).lower()], m.group(2), (m.group(3) or "").lower()
                if crop == "corn" and rest in ("", "corn"):
                    root = "ZC"
                elif crop == "soybeans" and rest in ("", "soybeans"):
                    root = "ZS"
                elif crop == "wheat" and "kcbt" in rest:
                    root = "KE"
                elif crop == "wheat" and "spring" in rest:
                    root = "MW"
                elif crop == "wheat" and rest == "wheat":
                    root = "ZW"
    if not root or root not in ROOTS.get(crop, ()):
        return None
    y = int(yr)
    y = 2020 + y if len(yr) == 1 else (y % 100)
    return f"{root}{mon}{y % 100:02d}"


def board_group(board, facility):
    """The company or feed that posts the board: the board slug before its first '-',
    else the facility name squeezed (Barchart-era rows carry no board)."""
    b = str(board or "")
    if b:
        return b.split("-")[0].lower()
    return "f:" + re.sub(r"[^a-z0-9]", "", str(facility or "").lower())


def miles(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 3958.8 * 2 * math.asin(min(1.0, math.sqrt(h)))


# ------------------------------------------------------------------ one day's observations
def parse_snapshot(snap):
    """-> (series {key: (basis_int, posted)}, elevs {elev: (lat, lon, group, state)}, counts).
    One row per series; on a repeat the first wins (as the snapshot does)."""
    series, elevs = {}, {}
    c = {"rows": 0, "used": 0, "no_basis": 0, "other_crop": 0, "no_contract": 0, "dupes": 0}
    for r in BS.rows_of(snap):
        c["rows"] += 1
        crop = r.get("category")
        if crop not in RULES["crops"]:
            c["other_crop"] += 1
            continue
        b = r.get("basis")
        if not isinstance(b, (int, float)) or isinstance(b, bool) or b != b:
            c["no_basis"] += 1
            continue
        k = norm_contract(r.get("futures"), crop)
        if not k:
            c["no_contract"] += 1
            continue
        elev = r.get("locId") or ("k:" + r["key"])
        start = str(r.get("start") or "")[:10] or ("d:" + str(r.get("delivery") or ""))
        sk = "|".join((elev, crop, start, k, r.get("src") or ""))
        if sk in series:
            c["dupes"] += 1
            continue
        series[sk] = (int(round(b * SCALE)), r.get("posted"))
        c["used"] += 1
        if elev not in elevs:
            lat, lon = r.get("lat"), r.get("lon")
            ok = isinstance(lat, (int, float)) and isinstance(lon, (int, float))
            elevs[elev] = ((lat, lon) if ok else None, board_group(r.get("board"), r.get("facility")), r.get("state"))
    return series, elevs, c


def skey_parts(sk):
    elev, crop, start, k, src = sk.rsplit("|", 4)
    return elev, crop, start, k, src


# ------------------------------------------------------------------ the store and the no-look-ahead view
class Store:
    """Snapshots from a folder (holding bids-daily/) or a git ref, parsed once."""

    def __init__(self, dir=None, ref=BS.RAW_REF):
        self.dir, self.ref = dir, (None if dir else ref)
        self.days = [d for d in BS.list_days(dir=dir, ref=self.ref)]
        self.have = set(self.days)
        self._raw, self._obs, self._snap, self.outcome_cache = {}, {}, {}, {}

    def raw(self, day):
        if day not in self._raw:
            if self.dir:
                with open(os.path.join(self.dir, BS.path_for(day)), "rb") as f:
                    self._raw[day] = f.read()
            else:
                r = BS._git("show", f"{self.ref}:{BS.path_for(day)}", text=False)
                if r.returncode != 0:
                    raise SystemExit(f"[basis-ledger] {BS.path_for(day)} not on {self.ref}")
                self._raw[day] = r.stdout
        return self._raw[day]

    def snap(self, day):
        if day not in self._snap:
            self._snap[day] = BS.decode(self.raw(day))
        return self._snap[day]

    def obs(self, day):
        if day not in self._obs:
            self._obs[day] = parse_snapshot(self.snap(day)) if day in self.have else None
            self._snap.pop(day, None)
            self._raw.pop(day, None)
        return self._obs[day]


class View:
    """What a forecaster could know at the end of `asof`: any read of a later day raises."""

    def __init__(self, store, asof):
        self.store, self.asof = store, asof

    def obs(self, day):
        if day > self.asof:
            raise LookAhead(f"read {day} while forecasting on {self.asof}")
        return self.store.obs(day)


def tdays_back(d, n):
    """The n trading days ending d, oldest first (d included when it is a trading day)."""
    out, x = [], dt.date.fromisoformat(d)
    if not CC.is_trading_day(x):
        x = CC.prior_trading_day(x)
    while len(out) < n:
        out.append(x.isoformat())
        x = CC.prior_trading_day(x)
    return out[::-1]


def tday_add(d, n):
    x = dt.date.fromisoformat(d)
    for _ in range(n):
        x = CC.next_trading_day(x)
    return x.isoformat()


# ------------------------------------------------------------------ outcomes: ONE definition, used by the base rate AND the grading
def outcomes(view, o, h):
    """{series: (moved, net_int)} for series observed at origin o AND at its target day.
    None when the target day has no snapshot. Reads only days up to the target."""
    t = tday_add(o, h)
    cache = view.store.outcome_cache
    if (o, h) in cache:
        if t > view.asof:
            raise LookAhead(f"outcome of {o}+{h} ({t}) asked on {view.asof}")
        return cache[(o, h)]
    ob_t = view.obs(t)
    ob_o = view.obs(o)
    if ob_o is None or ob_t is None:
        cache[(o, h)] = None
        return None
    between = []
    x = o
    while x < t:
        x = tday_add(x, 1)
        ob = view.obs(x)
        if ob is not None:
            between.append(ob[0])
    s_t = ob_t[0]
    out = {}
    for sk, (b0, _) in ob_o[0].items():
        if sk not in s_t:
            continue
        moved = any(sk in s and abs(s[sk][0] - b0) >= MOVE for s in between)
        out[sk] = (moved, s_t[sk][0] - b0)
    cache[(o, h)] = out
    return out


def base_counts(view, o, h):
    """{(crop, state): [n, moved]} and {crop: [n, moved]} for origin o, horizon h (None if unknown)."""
    key = ("bc", o, h)
    cache = view.store.outcome_cache
    if key not in cache:
        oc = outcomes(view, o, h)
        if oc is None:
            cache[key] = None
        else:
            elevs = view.obs(o)[1]
            cs, cn = {}, {}
            for sk, (moved, _) in oc.items():
                elev, crop = sk.split("|", 2)[:2]
                st = elevs.get(elev, (None, None, None))[2]
                for d, k in ((cs, (crop, st)), (cn, crop)):
                    v = d.setdefault(k, [0, 0])
                    v[0] += 1
                    v[1] += moved
            cache[key] = (cs, cn)
    elif tday_add(o, h) > view.asof:
        raise LookAhead(f"base counts of {o}+{h} asked on {view.asof}")
    return cache[key]


def base_rates(view, d, h):
    """Trailing base rates at d for horizon h: origins in the window ending d whose target is on or before d."""
    cs, cn = {}, {}
    for o in tdays_back(d, RULES["base_rate_days"]):
        if tday_add(o, h) > d:
            break
        bc = base_counts(view, o, h)
        if bc is None:
            continue
        for src, dst in ((bc[0], cs), (bc[1], cn)):
            for k, (n, m) in src.items():
                v = dst.setdefault(k, [0, 0])
                v[0] += n
                v[1] += m
    return cs, cn


# ------------------------------------------------------------------ the calls
def state_medians(series, elevs):
    """{(state, crop, contract, month): (median_int, n_elevators)}, one value per elevator."""
    per = {}
    for sk, (b, _) in series.items():
        elev, crop, start, k, _src = skey_parts(sk)
        st = elevs.get(elev, (None, None, None))[2]
        per.setdefault((st, crop, k, start[:7]), {}).setdefault(elev, []).append(b)
    out = {}
    for g, by in per.items():
        vals = [statistics.median(v) for v in by.values()]
        out[g] = (statistics.median(vals), len(vals))
    return out


def peer_moves(view, d):
    """{(elev, crop): (median change, groups, elevs)} from other elevators within the radius."""
    back = tdays_back(d, RULES["peer_lookback_days"] + 1)[0]
    now, then = view.obs(d), view.obs(back)
    if now is None or then is None:
        return {}
    s_now, elevs = now[0], now[1]
    s_then = then[0]
    ch = {}
    for sk, (b, _) in s_now.items():
        if sk in s_then:
            elev, crop = sk.split("|", 2)[:2]
            ch.setdefault(elev, {}).setdefault(crop, []).append(b - s_then[sk][0])
    pts = {e: (elevs[e][0], elevs[e][1], {c: statistics.median(v) for c, v in cs.items()})
           for e, cs in ch.items() if e in elevs and elevs[e][0]}
    grid = {}
    for e, (ll, g, _) in pts.items():
        grid.setdefault((int(ll[0] // 1.5), int(ll[1] // 1.5)), []).append(e)
    out = {}
    r = RULES["peer_radius_miles"]
    for e, (ll, grp, _) in elevs.items():
        if not ll:
            continue
        cy, cx = int(ll[0] // 1.5), int(ll[1] // 1.5)
        near = [p for dy in (-1, 0, 1) for dx in (-2, -1, 0, 1, 2) for p in grid.get((cy + dy, cx + dx), ())
                if p != e and pts[p][1] != grp and miles(ll, pts[p][0]) <= r]
        crops = {c for p in near for c in pts[p][2]}
        for c in crops:
            vals = [(pts[p][2][c], pts[p][1]) for p in near if c in pts[p][2]]
            out[(e, c)] = (statistics.median(v for v, _ in vals), len({g for _, g in vals}), len(vals))
    return out


def previous_posted(view, d, sk):
    for x in tdays_back(d, 11)[-2::-1]:
        ob = view.obs(x)
        if ob is not None and sk in ob[0]:
            return True, ob[0][sk][1]
    return False, None


def make_calls(store, d, kind, made_at=None):
    """The frozen call document for origin d. Reads only snapshots on or before d."""
    if kind not in KINDS:
        raise ValueError(kind)
    view = View(store, d)
    ob = view.obs(d)
    if ob is None:
        raise ValueError(f"no snapshot for {d}")
    series, elevs, counts = ob
    hist = [x for x in tdays_back(d, RULES["m1_premium_days"])]
    med_by_day = {}
    for x in hist:
        o = view.obs(x)
        if o is not None:
            med_by_day[x] = (state_medians(o[0], o[1]), o[0])
    med_today = med_by_day[d][0] if d in med_by_day else state_medians(series, elevs)
    peers = peer_moves(view, d)
    rates = {h: base_rates(view, d, h) for h in RULES["horizons"]}
    targets = {h: tday_add(d, h) for h in RULES["horizons"]}
    rows = []
    for sk in sorted(series):
        b, posted = series[sk]
        elev, crop, start, k, _src = skey_parts(sk)
        st = elevs.get(elev, (None, None, None))[2]
        grp_key = (st, crop, k, start[:7])
        found, prev = previous_posted(view, d, sk)
        stale = None if (posted is None or not found or prev is None) else (posted == prev)
        m1, note = None, None
        med = med_today.get(grp_key)
        if not med or med[1] < RULES["m1_state_min_elevators"]:
            note = "no state median"
        else:
            prem = []
            for x, (meds, ser) in med_by_day.items():
                mm = meds.get(grp_key)
                if sk in ser and mm and mm[1] >= RULES["m1_state_min_elevators"]:
                    prem.append(ser[sk][0] - mm[0])
            if len(prem) < RULES["m1_premium_min_days"]:
                note = "too little premium history"
            else:
                m1 = med[0] + statistics.median(prem)
        pm = peers.get((elev, crop))
        direction = None
        if pm and pm[1] >= RULES["peer_min_groups"]:
            direction = "up" if pm[0] >= PEER_MOVE else ("down" if pm[0] <= -PEER_MOVE else None)
        hs = []
        for h in RULES["horizons"]:
            cs, cn = rates[h]
            n1, m_1 = cs.get((crop, st), [0, 0])
            n2, m_2 = cn.get(crop, [0, 0])
            ok1, ok2 = n1 >= RULES["base_rate_min_n"], n2 >= RULES["base_rate_min_n"]
            hs.append([h, targets[h], round(m_1 / n1, 4) if ok1 else None, n1,
                       round(m_2 / n2, 4) if ok2 else None, n2])
        rows.append([sk, st, b / SCALE, stale,
                     None if m1 is None else round(m1 / SCALE, 4), note, direction,
                     None if not pm else round(pm[0] / SCALE, 4), pm[1] if pm else 0, pm[2] if pm else 0, hs])
    raw = store.raw(d) if d not in store._obs or store._raw.get(d) else None
    snap_sha = store_sha(store, d)
    return {
        "schema": SCHEMA_CALLS, "kind": kind, "day": d,
        "rules_version": RULES["version"], "rules": RULES,
        "made_at": made_at,
        "input": {"path": BS.path_for(d), "sha256": snap_sha, "counts": counts},
        "note": ("Frozen basis forecasts (scripts/basis_ledger.py). One row per series observed on this day. "
                 "m0 (no change) is the basis column. m1 = state median + this series' 20-day median premium, "
                 "null with m1_note when it falls back to m0. p_move = crop x state share that moved within h "
                 "trading days over the trailing window (known outcomes only); p_ref = the crop's national share. "
                 "direction = sign of the median 5-day move at other elevators within 100 miles from 3+ other "
                 "board groups, else null. PRIVATE: not for publication." + (
                     " REPLAY: what the rules would have made on this day; never counted with live calls."
                     if kind == "replay" else "")),
        "cols": CALL_COLS + ["horizons"], "hcols": H_COLS,
        "calls": rows,
    }


_SHA = {}


def store_sha(store, d):
    if (id(store), d) not in _SHA:
        data = store._raw.get(d)
        if data is None:
            if store.dir:
                with open(os.path.join(store.dir, BS.path_for(d)), "rb") as f:
                    data = f.read()
            else:
                data = BS._git("show", f"{store.ref}:{BS.path_for(d)}", text=False).stdout
        _SHA[(id(store), d)] = hashlib.sha256(data).hexdigest()
    return _SHA[(id(store), d)]


# ------------------------------------------------------------------ grading
def grade(store, calls_doc, asof):
    """Grade rows for one call document as known at the end of asof."""
    view = View(store, asof)
    d = calls_doc["day"]
    hi = calls_doc["hcols"]
    rows, final = [], True
    for h in RULES["horizons"]:
        t = tday_add(d, h)
        if t > asof:
            oc, status = None, "pending"
            final = False
        else:
            oc = outcomes(view, d, h)
            status = "no snapshot" if oc is None else None
            if oc is None and tday_add(t, SETTLE_DAYS) > asof:
                final = False
        if t <= asof and tday_add(t, SETTLE_DAYS) > asof:
            final = False
        for c in calls_doc["calls"]:
            sk = c[0]
            if oc is None:
                rows.append([sk, h, t, status, None, None, None])
            elif sk not in oc:
                rows.append([sk, h, t, "not observed", None, None, None])
            else:
                moved, net = oc[sk]
                rows.append([sk, h, t, "graded", round((round(c[2] * SCALE) + net) / SCALE, 4), moved, round(net / SCALE, 4)])
    return {"schema": SCHEMA_GRADES, "kind": calls_doc["kind"], "day": d,
            "rules_version": calls_doc["rules_version"], "calls_sha256": doc_sha(calls_doc),
            "asof": asof, "final": final, "cols": GRADE_COLS, "rows": rows}


# ------------------------------------------------------------------ summary
def gate(n, days):
    if n >= RULES["min_graded_for_rate"] and days >= RULES["min_target_days_for_rate"]:
        return None
    return (f"withheld: {n} graded over {days} target day(s); needs {RULES['min_graded_for_rate']} "
            f"over {RULES['min_target_days_for_rate']}")


def summarize(pairs):
    """pairs: [(calls_doc, grades_doc)] of ONE kind. -> the summary block."""
    acc = {}
    status = {}
    days_made = set()

    def bucket(*k):
        return acc.setdefault(k, {"n": 0, "days": set(), "series": set(), "abs": 0.0, "fb": 0,
                                  "bm": 0.0, "br": 0.0, "nb": 0, "obs": 0, "pm": 0.0,
                                  "dn": 0, "hit": 0, "flat": 0})
    for calls, grades in pairs:
        days_made.add(calls["day"])
        by = {c[0]: c for c in calls["calls"]}
        hi = {r[0]: i for i, r in enumerate(calls["calls"])}
        for sk, h, t, st, actual, moved, net in grades["rows"]:
            status[(h, st)] = status.get((h, st), 0) + 1
            if st != "graded":
                continue
            c = by[sk]
            crop = sk.split("|", 2)[1]
            hrow = next(x for x in c[10] if x[0] == h)
            for cr in (crop, "ALL"):
                for model, fc in (("M0", c[2]), ("M1", c[4] if c[4] is not None else c[2])):
                    a = bucket("level", model, h, cr)
                    a["n"] += 1
                    a["days"].add(t)
                    a["series"].add(sk)
                    a["abs"] += abs(actual - fc)
                    a["fb"] += model == "M1" and c[4] is None
                if hrow[2] is not None and hrow[4] is not None:
                    a = bucket("move", h, cr)
                    y = 1.0 if moved else 0.0
                    a["n"] += 1
                    a["days"].add(t)
                    a["bm"] += (hrow[2] - y) ** 2
                    a["br"] += (hrow[4] - y) ** 2
                    a["obs"] += y
                    a["pm"] += hrow[2]
                if c[6]:
                    a = bucket("dir", h, cr)
                    a["dn"] += 1
                    if net == 0:
                        a["flat"] += 1
                    else:
                        a["n"] += 1
                        a["days"].add(t)
                        a["hit"] += (net > 0) == (c[6] == "up")
    level, move, dirs = [], [], []
    for k in sorted(acc, key=str):
        a = acc[k]
        nd = len(a["days"])
        w = gate(a["n"], nd)
        if k[0] == "level":
            level.append({"model": k[1], "h": k[2], "crop": k[3], "n": a["n"], "series": len(a["series"]),
                          "target_days": nd, "m1_fallback_n": a["fb"] if k[1] == "M1" else None,
                          "mae_cents": None if w else round(100 * a["abs"] / a["n"], 3), "withheld": w})
        elif k[0] == "move":
            bm, br = a["bm"] / a["n"], a["br"] / a["n"]
            move.append({"h": k[1], "crop": k[2], "n": a["n"], "target_days": nd,
                         "brier": None if w else round(bm, 4), "brier_ref": None if w else round(br, 4),
                         "skill_vs_ref": None if w or br == 0 else round(1 - bm / br, 4),
                         "observed_rate": None if w else round(a["obs"] / a["n"], 4),
                         "mean_p": None if w else round(a["pm"] / a["n"], 4), "withheld": w})
        else:
            dirs.append({"h": k[1], "crop": k[2], "calls_graded": a["dn"], "flat": a["flat"], "n": a["n"],
                         "target_days": nd, "hit_rate": None if w else round(a["hit"] / a["n"], 4),
                         "vs": 0.5, "withheld": w})
    return {"call_days": len(days_made), "first": min(days_made) if days_made else None,
            "last": max(days_made) if days_made else None,
            "status": [{"h": h, "status": s, "n": n} for (h, s), n in sorted(status.items(), key=str)],
            "level": level, "move": move, "direction": dirs}


# ------------------------------------------------------------------ files
def encode(doc):
    raw = json.dumps(doc, separators=(",", ":"), ensure_ascii=False, sort_keys=False).encode("utf-8")
    buf = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=buf, compresslevel=9, mtime=0) as g:
        g.write(raw)
    return buf.getvalue()


def decode(data):
    return json.loads(gzip.decompress(data).decode("utf-8"))


def doc_sha(doc):
    return hashlib.sha256(encode(doc)).hexdigest()


def rel(kind, what, day):
    if kind not in KINDS or what not in ("calls", "grades"):
        raise ValueError((kind, what))
    return f"{OUT}/{kind}/{what}/{day[:4]}/{day}.json.gz"


class Ledger:
    """Reads ledger files from the ref and the out dir (the out dir wins); writes to the out dir."""

    def __init__(self, out_dir, ref=None, dir=None):
        self.out_dir, self.ref, self.dir = out_dir, ref, dir

    def _ref_read(self, p):
        if self.dir:
            q = os.path.join(self.dir, p)
            return open(q, "rb").read() if os.path.exists(q) else None
        if not self.ref:
            return None
        r = BS._git("show", f"{self.ref}:{p}", text=False)
        return r.stdout if r.returncode == 0 else None

    def read(self, p):
        q = os.path.join(self.out_dir, p)
        if os.path.exists(q):
            return open(q, "rb").read()
        return self._ref_read(p)

    def list(self, kind, what):
        pat = re.compile(r"(\d{4}-\d{2}-\d{2})\.json\.gz$")
        base = f"{OUT}/{kind}/{what}"
        out = set()
        for top in [self.out_dir] + ([self.dir] if self.dir else []):
            for b, _, fs in os.walk(os.path.join(top, base)):
                out |= {m.group(1) for f in fs for m in [pat.search(f)] if m}
        if self.ref and not self.dir:
            r = BS._git("ls-tree", "-r", "--name-only", self.ref, "--", base)
            if r.returncode == 0:
                out |= {m.group(1) for line in r.stdout.splitlines() for m in [pat.search(line)] if m}
        return sorted(out)

    def write(self, p, data, frozen):
        """frozen=True: refuse to replace a file whose bytes differ (calls never change)."""
        old = self.read(p)
        if old is not None and frozen:
            if old != data:
                raise Frozen(f"{p} is frozen and differs; a call file is never rewritten")
            return False
        if old == data:
            return False
        q = os.path.join(self.out_dir, p)
        os.makedirs(os.path.dirname(q), exist_ok=True)
        with open(q, "wb") as f:
            f.write(data)
        return True


def freeze_calls(ledger, doc):
    if doc["kind"] == "replay" and doc["day"] > REPLAY_THROUGH:
        raise ValueError(f"replay covers days through {REPLAY_THROUGH} only, not {doc['day']}")
    return ledger.write(rel(doc["kind"], "calls", doc["day"]), encode(doc), frozen=True)


def regrade(ledger, store, kind, asof):
    """Rebuild every grade file that is not final yet. -> (written, pairs for the summary)."""
    n, pairs = 0, []
    for d in ledger.list(kind, "calls"):
        calls = decode(ledger.read(rel(kind, "calls", d)))
        if calls.get("kind") != kind:
            raise ValueError(f"{rel(kind, 'calls', d)} says kind={calls.get('kind')}")
        old = ledger.read(rel(kind, "grades", d))
        g = decode(old) if old else None
        if not g or not g.get("final") or g.get("calls_sha256") != doc_sha(calls):
            g = grade(store, calls, asof)
            n += ledger.write(rel(kind, "grades", d), encode(g), frozen=False)
        pairs.append((calls, g))
    return n, pairs


def write_summary(ledger, blocks, asof):
    doc = {"schema": SCHEMA_SUMMARY, "rules_version": RULES["version"], "registered": RULES["registered"],
           "asof": asof, "private": True,
           "note": ("PRIVATE: not deployed, not for publication until Sig says (STANDING-DECISIONS Oct 21). "
                    "live and replay are separate records and are never added together. mae_cents is the mean "
                    "absolute error of the basis forecast at the target day, in cents. brier is for P(move "
                    "within h); brier_ref the crop's national trailing rate; skill_vs_ref = 1 - brier/brier_ref. "
                    "hit_rate = direction calls right among those whose net change was not zero (flat counted "
                    "beside it). n beside every number; a value under the minimum sample is null with the reason."),
           "live": blocks.get("live"), "replay": blocks.get("replay")}
    data = (json.dumps(doc, indent=1, ensure_ascii=False) + "\n").encode()
    ledger.write(f"{OUT}/summary.json", data, frozen=False)
    return doc


def run(store, ledger, today, live_day=None, made_at=None, replay=True, log=print):
    """The workflow step. Frozen live calls for live_day (only today's), replay of
    missing days through REPLAY_THROUGH, open grades, the summary."""
    if live_day:
        if live_day != today:
            raise ValueError(f"a live call is made on its own day: {live_day} is not today ({today})")
        if live_day not in store.have:
            log(f"[basis-ledger] no snapshot for {live_day} yet; no live calls")
        elif not CC.is_trading_day(live_day):
            log(f"[basis-ledger] {live_day} is not a trading day; no live calls")
        elif ledger.read(rel("live", "calls", live_day)) is not None:
            log(f"[basis-ledger] live calls for {live_day} already frozen")
        else:
            doc = make_calls(store, live_day, "live", made_at=made_at)
            freeze_calls(ledger, doc)
            log(f"[basis-ledger] froze {len(doc['calls'])} live calls for {live_day}")
    if replay:
        done = set(ledger.list("replay", "calls"))
        todo = [d for d in store.days if d <= REPLAY_THROUGH and d not in done and CC.is_trading_day(d)]
        for d in todo:
            doc = make_calls(store, d, "replay", made_at=made_at)
            freeze_calls(ledger, doc)
            log(f"[basis-ledger] replay {d}: {len(doc['calls'])} calls")
    blocks = {}
    for kind in KINDS:
        n, pairs = regrade(ledger, store, kind, today)
        blocks[kind] = summarize(pairs)
        log(f"[basis-ledger] {kind}: {len(pairs)} call day(s), {n} grade file(s) rewritten")
    return write_summary(ledger, blocks, today)


# ------------------------------------------------------------------ selftest
def _fake_snap(day, rows, partial=None):
    """A snapshot in the bid_snapshots file shape from flat rows."""
    locs, ix = [], {}
    for r in rows:
        k = (r["id"], r["facility"], r["city"], r["state"])
        if k not in ix:
            ix[k] = len(locs)
            locs.append([r["id"], r["facility"], "", r["city"], "", r["state"], "", r["lat"], r["lon"], r["board"],
                         None, None, []])
        locs[ix[k]][-1].append([r.get("commodity", "Corn"), r["category"], r.get("delivery", ""), r["start"], None,
                                r.get("cash"), r["basis"], r["futures"], None, r.get("posted"), "network"])
    return {"schema": BS.SCHEMA, "day": day, "partial": partial, "locCols": BS.LOC_COLS, "rowCols": BS.ROW_COLS,
            "counts": {"locs": len(locs), "rows": len(rows)}, "locs": locs}


def selftest():
    import tempfile
    fails = []

    def ck(name, ok):
        print(("ok   " if ok else "FAIL ") + name)
        if not ok:
            fails.append(name)

    # contracts, as boards really post them (forms counted on the 101 snapshots on raw, Oct 28)
    ck("ZCZ26 / ZCZ6 / @C6Z / 'Dec 26' are one corn contract",
       {norm_contract(s, "corn") for s in ("ZCZ26", "ZCZ6", "@C6Z", "Dec 26", "December 2026", "zcz26")} == {"ZCZ26"})
    ck("KC and spring wheat month names keep their exchange",
       norm_contract("Dec 26 KCBT Red Wheat", "wheat") == "KEZ26" and norm_contract("Mar 27 MIAX Spring Wheat", "wheat") == "MWH27"
       and norm_contract("@KW7N", "wheat") == "KEN27")
    ck("a wheat month name without its exchange is not used", norm_contract("December 2026", "wheat") is None)
    ck("a contract that does not match the crop is not used (corn row posted ZSX26)", norm_contract("ZSX26", "corn") is None)
    ck("basis-contract codes and bare prices are not used",
       norm_contract("ZCBZ26-12345-67890.CM", "corn") is None and norm_contract("4.2350s", "corn") is None
       and norm_contract("Z26", "wheat") is None)
    ck("board group is the board slug's company; Barchart rows use the facility",
       board_group("ceagrain-bentley", "x") == "ceagrain" and board_group(None, "ADM Inc.") == "f:adminc")
    ck("Balaton to Marshall MN is under 100 miles, Decatur IL to Des Moines is not",
       miles((44.23, -95.87), (44.45, -95.79)) < 20 and miles((39.84, -88.95), (41.59, -93.62)) > 100)

    # calendar: Thanksgiving is skipped, 5 trading days from Fri Nov 20 2026 is Mon Nov 30
    ck("horizons count CME trading days (Thanksgiving skipped)", tday_add("2026-11-20", 5) == "2026-11-30")

    # REAL ROWS: three boards from the 2026-10-27 snapshot on raw (business names, towns, posted basis only)
    real = [
        {"id": "e42vv1d8gq", "facility": "The Equity", "city": "Effingham", "state": "IL", "lat": 39.1217, "lon": -88.5611,
         "board": "theequity-effingham", "category": "corn", "start": "2027-01-01", "futures": "ZCH27", "basis": -0.30,
         "posted": "2026-10-27T18:30:32.432Z"},
        {"id": "extasr98hc", "facility": "Farmers Cooperative Dorchester", "city": "WILBER", "state": "NE", "lat": 40.4821,
         "lon": -96.9757, "board": "farmerscooperative-wilber", "category": "wheat", "start": "2026-11-01",
         "futures": "KEZ26", "basis": -0.64, "posted": "2026-10-27T19:40:31.496Z"},
        {"id": "egt32v70q0", "facility": "Heartland Co-op", "city": "Malcom", "state": "IA", "lat": 41.7695, "lon": -92.5354,
         "board": "heartlandcoop-malcom", "category": "soybeans", "start": "2027-10-01", "futures": "ZSX27",
         "basis": -0.80, "posted": "2026-10-26T21:20:28.185Z"},
        {"id": "e1mspjwg0x", "facility": "NEW Cooperative, Inc.", "city": "Humeston", "state": "IA", "lat": 40.8469,
         "lon": -93.5101, "board": "newcoop-humeston", "category": "soybeans", "start": "2027-03-01", "futures": None,
         "basis": -0.65, "posted": "2026-10-22T20:36:54.209Z"},
    ]
    s, e, c = parse_snapshot(_fake_snap("2026-10-27", real))
    ck("real rows: three series kept, the one with no futures contract is not used",
       len(s) == 3 and c["no_contract"] == 1 and "e42vv1d8gq|corn|2027-01-01|ZCH27|network" in s)
    ck("real rows: basis held exactly, board group and state kept",
       s["extasr98hc|wheat|2026-11-01|KEZ26|network"][0] == -6400 and e["extasr98hc"][1:] == ("farmerscooperative", "NE"))

    # A small world: 4 IA elevators of 4 companies within 100 miles, 1 far away, 30 trading days.
    days = []
    x = dt.date(2026, 9, 1)
    while len(days) < 30:
        if CC.is_trading_day(x):
            days.append(x.isoformat())
        x += dt.timedelta(days=1)
    E = [("ea", "alpha-a", 42.0, -93.0), ("eb", "beta-b", 42.3, -93.2), ("ec", "gamma-c", 41.8, -92.8),
         ("ed", "delta-d", 42.1, -93.5), ("ez", "zeta-z", 30.0, -100.0)]

    def world(skip=()):
        snaps = {}
        for i, d in enumerate(days):
            if d in skip:
                continue
            rows = []
            for j, (eid, board, la, lo) in enumerate(E):
                b = -0.40 + 0.02 * j
                if eid in ("eb", "ec", "ed") and i >= 20:
                    b += 0.03                              # the peers firm 3 cents on day 20
                if eid == "ea" and i >= 22:
                    b += 0.03                              # ea follows two days later
                rows.append({"id": eid, "facility": board, "city": eid, "state": "IA" if eid != "ez" else "TX",
                             "lat": la, "lon": lo, "board": board, "category": "corn", "start": "2026-12-01",
                             "futures": "ZCZ26", "basis": round(b, 4),
                             "posted": f"{d}T19:00:00Z" if eid != "ed" else "2026-08-31T19:00:00Z"})
            snaps[d] = _fake_snap(d, rows)
        return snaps

    with tempfile.TemporaryDirectory() as tmp:
        def put(snaps, where):
            for d, sn in snaps.items():
                p = os.path.join(where, BS.path_for(d))
                os.makedirs(os.path.dirname(p), exist_ok=True)
                open(p, "wb").write(BS.encode(sn))
        src = os.path.join(tmp, "raw")
        put(world(skip=(days[27],)), src)
        st = Store(dir=src)
        d21 = days[21]
        doc = make_calls(st, d21, "live", made_at="t")
        rows = {r[0]: r for r in doc["calls"]}
        ra = rows["ea|corn|2026-12-01|ZCZ26|network"]
        ck("direction: ea's three peers (3 companies) firmed 3 c over 5 days -> up", ra[6] == "up" and ra[8] == 3)
        ck("the far elevator has no peers and no direction", rows["ez|corn|2026-12-01|ZCZ26|network"][6] is None)
        ck("M0 is the basis at the origin", ra[2] == -0.40)
        # IA medians: today ea -0.40, eb -0.35, ec -0.33, ed -0.31 -> median -0.34; ea's premium over 20 days
        # is -0.04 on days 2..19 (median of -0.38/-0.36 etc), after day 20 -0.07: median of 20 days -> -0.04
        ck("M1 = state median + the series' 20-day median premium", ra[4] == round(-0.34 - 0.04, 4))
        ck("stale: ed's posted time never changes", rows["ed|corn|2026-12-01|ZCZ26|network"][3] is True and ra[3] is False)
        ck("the input snapshot's sha256 is recorded",
           doc["input"]["sha256"] == hashlib.sha256(open(os.path.join(src, BS.path_for(d21)), "rb").read()).hexdigest())
        # no look-ahead: a later snapshot that changes does not change the call
        put({days[25]: _fake_snap(days[25], [dict(real[0], id="ea", lat=42.0, lon=-93.0, basis=9.99)])}, src)
        ck("a later snapshot cannot change a call made earlier", encode(make_calls(Store(dir=src), d21, "live", made_at="t"))
           == encode(doc))
        put(world(skip=(days[27],)), src)
        try:
            View(st, d21).obs(days[22])
            ck("the view refuses a day after the origin", False)
        except LookAhead:
            ck("the view refuses a day after the origin", True)
        # base rate: needs 30 outcomes. 4 IA series a day; by day 21 there are origins 0..16 for h=5 -> 17*4 = 68
        p = ra[10][0]
        ck("P(move within 5): crop x state rate from known outcomes only, with n",
           p[0] == 5 and p[1] == days[26] and p[3] == 68 and p[2] is not None and 0 < p[2] < 1)
        ck("P(move within 20) withheld: too few known outcomes", ra[10][1][2] is None and ra[10][1][3] < 30)

        out = os.path.join(tmp, "out")
        L = Ledger(out, dir=src)
        ck("a call file is written once", freeze_calls(L, doc) is True and freeze_calls(L, doc) is False)
        try:
            freeze_calls(L, dict(doc, made_at="other"))
            ck("a frozen call file is never rewritten with different content", False)
        except Frozen:
            ck("a frozen call file is never rewritten with different content", True)
        before = open(os.path.join(out, rel("live", "calls", d21)), "rb").read()
        # grading: day 21 + 5 = day 26 graded; a target day with no snapshot (day 27 for origin 22) stays ungraded
        g = grade(st, doc, days[29])
        gr = {(r[0], r[1]): r for r in g["rows"]}
        ga = gr[("ea|corn|2026-12-01|ZCZ26|network", 5)]
        ck("graded at h=5 with the target's basis, moved and net", ga[3] == "graded" and ga[5] is True and ga[6] == 0.03
           and ga[4] == -0.37)
        ck("h=20 target after the as-of day is pending, not graded", gr[("ea|corn|2026-12-01|ZCZ26|network", 20)][3] == "pending"
           and g["final"] is False)
        d22 = days[22]
        g22 = grade(st, make_calls(st, d22, "live"), days[29])
        ck("a target day with no snapshot stays ungraded", {r[3] for r in g22["rows"] if r[1] == 5} == {"no snapshot"})
        drop = Store(dir=src)
        drop.obs(days[26])[0].pop("eb|corn|2026-12-01|ZCZ26|network")
        g2 = grade(drop, doc, days[29])
        ck("a series missing from the target day stays ungraded",
           [r[3] for r in g2["rows"] if r[0].startswith("eb|") and r[1] == 5] == ["not observed"])
        sm = summarize([(doc, g2), (make_calls(st, d22, "live"), g22)])
        st_n = {(x["h"], x["status"]): x["n"] for x in sm["status"]}
        ck("summary: ungraded rows are counted by reason, never as right or wrong",
           st_n[(5, "graded")] == 4 and st_n[(5, "not observed")] == 1 and st_n[(5, "no snapshot")] == 5)
        lv = [x for x in sm["level"] if x["model"] == "M0" and x["h"] == 5 and x["crop"] == "ALL"][0]
        ck("summary: under the minimum sample the rate is withheld with n beside it",
           lv["n"] == 4 and lv["mae_cents"] is None and lv["withheld"].startswith("withheld: 4 graded over 1"))
        # replay and live stay apart
        rdoc = make_calls(st, d21, "replay", made_at="t")
        ck("replay and live are the same calls under a different kind", rdoc["calls"] == doc["calls"])
        freeze_calls(L, rdoc)
        ck("replay goes to its own folder", os.path.exists(os.path.join(out, rel("replay", "calls", d21)))
           and rel("replay", "calls", d21) != rel("live", "calls", d21))
        try:
            freeze_calls(L, dict(rdoc, day="2026-11-02"))
            ck("replay never covers a day after REPLAY_THROUGH", False)
        except ValueError:
            ck("replay never covers a day after REPLAY_THROUGH", True)
        os.makedirs(os.path.join(out, OUT, "live", "calls", "2026"), exist_ok=True)
        import shutil
        shutil.copy(os.path.join(out, rel("replay", "calls", d21)), os.path.join(out, rel("live", "calls", days[20])))
        try:
            regrade(L, st, "live", days[29])
            ck("a replay file in the live folder is refused", False)
        except ValueError:
            ck("a replay file in the live folder is refused", True)
        os.remove(os.path.join(out, rel("live", "calls", days[20])))
        try:
            run(st, L, today=days[29], live_day=days[28])
            ck("a live call is only made on its own day", False)
        except ValueError:
            ck("a live call is only made on its own day", True)
        s = run(st, L, today=days[29], live_day=days[29], made_at="t", replay=False)
        ck("run freezes today's live calls and keeps the earlier file byte for byte",
           os.path.exists(os.path.join(out, rel("live", "calls", days[29])))
           and open(os.path.join(out, rel("live", "calls", d21)), "rb").read() == before)
        ck("summary keeps live and replay as two records", s["live"]["call_days"] == 2 and s["replay"]["call_days"] == 1
           and s["private"] is True)
        # direction tie rule and hit counting on a hand case
        cd = {"day": "x", "calls": [["a|corn|s|ZCZ26|n", "IA", -0.4, False, None, "no state median", "up", 0.03, 3, 3,
                                     [[5, "t1", 0.2, 40, 0.3, 90]]],
                                    ["b|corn|s|ZCZ26|n", "IA", -0.4, False, None, "no state median", "up", 0.03, 3, 3,
                                     [[5, "t1", 0.2, 40, 0.3, 90]]],
                                    ["c|corn|s|ZCZ26|n", "IA", -0.4, False, None, "no state median", "down", -0.03, 3, 3,
                                     [[5, "t1", 0.2, 40, 0.3, 90]]]]}
        gd = {"rows": [["a|corn|s|ZCZ26|n", 5, "t1", "graded", -0.37, True, 0.03],
                       ["b|corn|s|ZCZ26|n", 5, "t1", "graded", -0.40, False, 0.0],
                       ["c|corn|s|ZCZ26|n", 5, "t1", "graded", -0.38, True, 0.02]]}
        old = RULES["min_graded_for_rate"], RULES["min_target_days_for_rate"]
        RULES["min_graded_for_rate"], RULES["min_target_days_for_rate"] = 1, 1
        try:
            sm = summarize([(cd, gd)])
        finally:
            RULES["min_graded_for_rate"], RULES["min_target_days_for_rate"] = old
        dr = [x for x in sm["direction"] if x["crop"] == "ALL"][0]
        mv = [x for x in sm["move"] if x["crop"] == "ALL"][0]
        lv = [x for x in sm["level"] if x["model"] == "M0" and x["crop"] == "ALL"][0]
        ck("direction: a flat target is neither right nor wrong; 1 of 2 right", (dr["flat"], dr["n"], dr["hit_rate"]) == (1, 2, 0.5))
        # Brier: p=0.2 vs outcomes 1,0,1 -> (0.64+0.04+0.64)/3 = 0.44; ref 0.3 -> (0.49+0.09+0.49)/3 = 0.3567
        ck("Brier by hand: 0.44 vs the reference 0.3567", mv["brier"] == 0.44 and mv["brier_ref"] == 0.3567)
        # MAE M0: |(-0.37)-(-0.40)| + 0 + |(-0.38)-(-0.40)| = 0.05 / 3 = 1.667 cents
        ck("MAE by hand: 1.667 cents, M1 falls back to M0 and counts it",
           lv["mae_cents"] == 1.667 and [x for x in sm["level"] if x["model"] == "M1" and x["crop"] == "ALL"][0]["m1_fallback_n"] == 3)
    print("selftest: %d failure(s)" % len(fails))
    return 1 if fails else 0


# ------------------------------------------------------------------ cli
def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if argv[:1] == ["--selftest"]:
        return selftest()
    ap = argparse.ArgumentParser(prog="basis_ledger.py")
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("run", "summary"):
        s = sub.add_parser(name)
        s.add_argument("--dir", help="a folder holding bids-daily/ (and any basis-ledger/ already made)")
        s.add_argument("--ref", default=BS.RAW_REF)
        s.add_argument("--out-dir", default=ROOT)
        s.add_argument("--today")
        if name == "run":
            s.add_argument("--live-day", default="")
            s.add_argument("--no-replay", action="store_true")
    a = ap.parse_args(argv)
    today = a.today or BS.ct_now().date().isoformat()
    store = Store(dir=a.dir, ref=a.ref)
    ledger = Ledger(a.out_dir, ref=None if a.dir else a.ref, dir=a.dir)
    made_at = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if a.cmd == "run":
        doc = run(store, ledger, today, live_day=a.live_day or None, made_at=made_at, replay=not a.no_replay)
    else:
        blocks = {k: summarize(regrade(ledger, store, k, today)[1]) for k in KINDS}
        doc = write_summary(ledger, blocks, today)
    for kind in KINDS:
        b = doc[kind]
        print(f"[basis-ledger] {kind}: {b['call_days']} call day(s) {b['first']}..{b['last']}")
        for x in b["level"]:
            if x["crop"] == "ALL":
                print(f"  {x['model']} h={x['h']}: MAE {x['mae_cents']} c, n={x['n']}, days={x['target_days']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
