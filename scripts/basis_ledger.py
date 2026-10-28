#!/usr/bin/env python3
"""Private basis forecast ledger (rule set basis-ledger-v1, registered 2026-10-28).

WHY
---
Nobody publishes an auditable elevator-level basis forecast record. That record
only exists if forecasts are frozen when they are made and graded later on a
fixed rule. The Oct 28 backtest on our own snapshots found that "no change"
beats every level model, so no change (M0) is the benchmark here, and the
ledger also makes EVENT calls (will this series' basis move within 1, 5 and 20
trading days, and which way) next to the level calls. A second ChatGPT run the
same day (feedbag notes/chatgpt/2026-10-28-answers/basis-event/) found a small
logistic model beat the crop x state base rate on held-out 1 and 5 day moves,
and that the peer-move sign rule beat trained sign models; both are frozen here
so the live record can confirm or refute it.

NOTHING HERE IS PUBLISHED. Everything goes to the private raw branch
(scripts/push_raw.sh), never to main or the site. Sig decides when the record
is shown (STANDING-DECISIONS, Oct 21: basis findings not published yet).

THE DISCIPLINE (copied from scripts/prediction_bot.py)
------------------------------------------------------
- RULES below carry a version and a registration date. Changing any rule is a
  new version with a new, separate record. Never edit them in place.
- A call file is frozen when written: one gz file per day, never rewritten.
  Ledger.write(frozen=True) refuses to replace a file whose bytes differ, and the
  workflow writes only days that are not on raw yet. The P(move) model fitted for
  a month is frozen the same way, with its own version.
- A call is graded only when the target day's snapshot exists AND holds the
  series. A missing target stays ungraded ("no snapshot", "not observed",
  "pending"), never counted right or wrong.
- Every rate carries n beside it and is withheld below the minimum sample.
- LIVE calls are made on the day, from that day's snapshot. REPLAY calls are
  what the same rules WOULD have made on the snapshots taken before the ledger
  existed. Separate folders, kind=replay in the file, separate summary blocks,
  separate models. Never mixed.

THE RULES (per series, at each origin day d, from snapshots on or before d only)
--------------------------------------------------------------------------------
Series = elevator (permanent id, else the board's facility|branch|city|state) x
crop x delivery_start x futures contract (boards' symbol forms read to one code;
an unclear contract is not used). A contract roll is a new series. A missing row
means not observed, never unchanged. CONFLICTS: when one series key carries two
different basis values on one day (mostly boards posting first-half and
last-half bids under one delivery start), the key is dropped for that day and
counted, never silently picked. A basis over $5/bu either way is a gross error,
dropped and counted. A row whose posted time equals the series' previous
observation is stale (the board did not update); stale origins still get calls
and carry the flag.
  M0  no change: the basis at d.
  M1  the state median basis at d (same crop, futures contract and delivery
      month, at least 3 elevators) plus this series' median premium to that
      median over the 20 trading days ending d (at least 3 days). Without
      either, M1 falls back to M0 and says why.
  P_base(move within h)  THE BENCHMARK: the crop x state share of series that
      moved within h trading days, over origins in the 60 trading days ending d
      whose target day is on or before d (the outcome was known on d). Needs 30
      outcomes, else withheld.
  P_logit(move within h)  logistic regression on exactly four features: trading
      days since the series' last confirmed change (capped at 20; 20 = none in
      the last 20), confirmed changes in the 20 trading days ending d, and
      whether 3+ board groups other than the elevator's own, at elevators within
      100 miles, had a confirmed change in the same crop on d (1 day) and in the
      5 trading days ending d. A confirmed change = the basis differs by 0.5 c or
      more from the previous trading day's, both days observed, and the posted
      time is not the same (a move under an unchanged posted time is a
      contradiction, not a change). Fitted once a month, on the first call day of
      the month, only on outcomes whose target day is before that day; the
      coefficients are frozen and versioned (pmove-v1-YYYY-MM). Withheld when the
      fit has under 2,000 rows or 10 origin days.
  Direction  the median 5-trading-day basis change at other elevators within
      100 miles (one value per elevator, same crop), from at least 3 board
      groups other than the elevator's own: up if at least +0.5 c, down if at
      most -0.5 c, otherwise no call.
"Moved within h" = some observed basis on a trading day in (d, target] differs
from the basis at d by at least 0.5 cents. Graded only when the target day
holds the series. Ties: a direction call whose net change at the target is zero
is "flat", neither right nor wrong, counted beside the hit rate.

FILES (raw branch, private; /basis-ledger/ is in .gitignore on main)
--------------------------------------------------------------------
  basis-ledger/<kind>/calls/YYYY/D.json.gz     frozen calls (kind = live | replay)
  basis-ledger/<kind>/models/pmove-YYYY-MM.json frozen monthly P(move) coefficients
  basis-ledger/<kind>/grades/YYYY/D.json.gz    grades for that day's calls, written ONCE
                                               when every target has settled (10 trading
                                               days past the last target), never rewritten.
                                               Until then the grades are computed on the
                                               fly for the summary and not stored, so raw's
                                               history grows only by frozen files.
  basis-ledger/summary.json                    MAE, Brier, direction, n beside each

USAGE
-----
  python3 scripts/basis_ledger.py --selftest
  python3 scripts/basis_ledger.py run [--live-day D] [--ref origin/raw | --dir DIR] [--out-dir .] [--replay-max N]
      the workflow step: freeze today's live calls (only for today's CT day),
      replay any snapshot day before the first live call day (and before today)
      not replayed yet, freeze the grade files that settled, rebuild the summary.
      Writes only what is new (and the summary).
  python3 scripts/basis_ledger.py summary [--ref origin/raw | --dir DIR] [--out-dir .]
"""
import argparse
import datetime as dt
import functools
import gzip
import hashlib
import io
import json
import math
import os
import re
import statistics
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
    "horizons": [1, 5, 20],
    "crops": ["corn", "soybeans", "wheat"],
    "series_key": "elevator id (else board facility|branch|city|state) x crop x delivery_start x futures contract",
    "conflict_rule": "a series key with two different basis values on one day is dropped for that day and counted",
    "gross_basis_dollars": 5.0,
    "move_cents": 0.5,
    "m1_state_min_elevators": 3,
    "m1_premium_days": 20,
    "m1_premium_min_days": 3,
    "base_rate_days": 60,
    "base_rate_min_n": 30,
    "pmove_model": "logistic: intercept + days_since_change/20 + changes_prior20/20 + peer_moved_1d + peer_moved_5d",
    "pmove_refit": "monthly, on the first call day of the month, on outcomes whose target day is before that day",
    "pmove_days_cap": 20,
    "pmove_min_rows": 2000,
    "pmove_min_days": 10,
    "pmove_ridge": 1e-4,
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
SCHEMA_CALLS = "agsist-basis-ledger-calls/1"
SCHEMA_GRADES = "agsist-basis-ledger-grades/1"
SCHEMA_MODEL = "agsist-basis-ledger-pmove/1"
SCHEMA_SUMMARY = "agsist-basis-ledger-summary/1"
OUT = "basis-ledger"
KINDS = ("live", "replay")
SETTLE_DAYS = 10                  # grades stop being rebuilt this many trading days after the last target
SCALE = 10000                     # basis held as integer 1/100 cents, so 0.5 c is exactly 50
MOVE = int(round(RULES["move_cents"] / 100 * SCALE))
PEER_MOVE = int(round(RULES["peer_min_move_cents"] / 100 * SCALE))
GROSS = int(round(RULES["gross_basis_dollars"] * SCALE))
CALL_COLS = ["series", "state", "basis", "stale", "m1", "m1_note", "direction", "peer_move", "peer_groups",
             "peer_elevs", "features", "horizons"]
H_COLS = ["h", "target", "p_base", "p_base_n", "p_logit"]
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


@functools.lru_cache(maxsize=None)
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
    y = 2020 + y if len(yr) == 1 else y
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
    """-> (series {key: (basis_int, posted)}, elevs {elev: (latlon|None, group, state)}, counts).
    An exact repeat keeps one row; a key with two different basis values is dropped and counted."""
    series, elevs, conflicted = {}, {}, set()
    c = {"rows": 0, "used": 0, "no_basis": 0, "gross": 0, "other_crop": 0, "no_contract": 0,
         "repeats": 0, "conflict_keys": 0, "conflict_rows": 0}
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
        bi = int(round(b * SCALE))
        if abs(bi) > GROSS:
            c["gross"] += 1
            continue
        k = norm_contract(r.get("futures"), crop)
        if not k:
            c["no_contract"] += 1
            continue
        elev = r.get("locId") or ("k:" + r["key"])
        start = str(r.get("start") or "")[:10] or ("d:" + str(r.get("delivery") or ""))
        sk = "|".join((elev, crop, start, k))
        if sk in series:
            if series[sk][0] == bi:
                c["repeats"] += 1
            else:
                conflicted.add(sk)
                c["conflict_rows"] += 1
            continue
        series[sk] = (bi, r.get("posted"))
        if elev not in elevs:
            lat, lon = r.get("lat"), r.get("lon")
            ok = isinstance(lat, (int, float)) and isinstance(lon, (int, float))
            elevs[elev] = ((lat, lon) if ok else None, board_group(r.get("board"), r.get("facility")), r.get("state"))
    for sk in conflicted:
        del series[sk]
    c["conflict_keys"] = len(conflicted)
    c["conflict_rows"] += len(conflicted)
    c["used"] = len(series)
    return series, elevs, c


def skey_parts(sk):
    return tuple(sk.rsplit("|", 3))


# ------------------------------------------------------------------ the store and the no-look-ahead view
class Store:
    """Snapshots from a folder (holding bids-daily/) or a git ref, parsed once."""

    def __init__(self, dir=None, ref=BS.RAW_REF):
        self.dir, self.ref = dir, (None if dir else ref)
        self.days = list(BS.list_days(dir=dir, ref=self.ref))
        self.have = set(self.days)
        self._obs, self._sha, self.cache = {}, {}, {}

    def raw(self, day):
        if self.dir:
            with open(os.path.join(self.dir, BS.path_for(day)), "rb") as f:
                return f.read()
        r = BS._git("show", f"{self.ref}:{BS.path_for(day)}", text=False)
        if r.returncode != 0:
            raise SystemExit(f"[basis-ledger] {BS.path_for(day)} not on {self.ref}")
        return r.stdout

    def obs(self, day):
        if day not in self._obs:
            if day in self.have:
                data = self.raw(day)
                self._sha[day] = hashlib.sha256(data).hexdigest()
                self._obs[day] = parse_snapshot(BS.decode(data))
            else:
                self._obs[day] = None
        return self._obs[day]

    def sha(self, day):
        self.obs(day)
        return self._sha.get(day)


class View:
    """What a forecaster could know at the end of `asof`: any read of a later day raises."""

    def __init__(self, store, asof):
        self.store, self.asof = store, asof

    def obs(self, day):
        if day > self.asof:
            raise LookAhead(f"read {day} while forecasting on {self.asof}")
        return self.store.obs(day)

    def cached(self, key, upto, fn):
        """A cached value that needed days up to `upto`: refused when upto is after asof."""
        if upto > self.asof:
            raise LookAhead(f"{key[0]} needs {upto}, asked on {self.asof}")
        c = self.store.cache
        if key not in c:
            c[key] = fn()
        return c[key]


_BACK = {}


def tdays_back(d, n):
    """The n trading days ending d, oldest first (d included when it is a trading day)."""
    if (d, n) not in _BACK:
        _BACK[(d, n)] = tuple(_tdays_back(d, n))
    return list(_BACK[(d, n)])


def _tdays_back(d, n):
    out, x = [], dt.date.fromisoformat(d)
    if not CC.is_trading_day(x):
        x = CC.prior_trading_day(x)
    while len(out) < n:
        out.append(x.isoformat())
        x = CC.prior_trading_day(x)
    return out[::-1]


_ADD = {}


def tday_add(d, n):
    if (d, n) not in _ADD:
        x = dt.date.fromisoformat(d)
        for _ in range(n):
            x = CC.next_trading_day(x)
        _ADD[(d, n)] = x.isoformat()
    return _ADD[(d, n)]


# ------------------------------------------------------------------ outcomes: ONE definition, used by the base rate, the model fit AND the grading
def outcomes(view, o, h):
    """{series: (moved, net_int)} for series observed at origin o AND at its target day.
    None when either day has no snapshot. Reads only days up to the target."""
    t = tday_add(o, h)

    def calc():
        ob_o, ob_t = view.obs(o), view.obs(t)
        if ob_o is None or ob_t is None:
            return None
        between, x = [], o
        while x < t:
            x = tday_add(x, 1)
            ob = view.obs(x)
            if ob is not None:
                between.append(ob[0])
        s_t, out = ob_t[0], {}
        for sk, (b0, _) in ob_o[0].items():
            if sk in s_t:
                out[sk] = (any(sk in s and abs(s[sk][0] - b0) >= MOVE for s in between), s_t[sk][0] - b0)
        return out
    return view.cached(("outcomes", o, h), t, calc)


def base_counts(view, o, h):
    """{(crop, state): [n, moved]} for origin o, horizon h (None if unknown)."""
    def calc():
        oc = outcomes(view, o, h)
        if oc is None:
            return None
        elevs, cs = view.obs(o)[1], {}
        for sk, (moved, _) in oc.items():
            elev, crop = sk.split("|", 2)[:2]
            v = cs.setdefault((crop, elevs.get(elev, (None, None, None))[2]), [0, 0])
            v[0] += 1
            v[1] += moved
        return cs
    return view.cached(("base", o, h), tday_add(o, h), calc)


def base_rates(view, d, h):
    """Crop x state base rates at d: origins in the window ending d whose target is on or before d."""
    cs = {}
    for o in tdays_back(d, RULES["base_rate_days"]):
        if tday_add(o, h) > d:
            break
        bc = base_counts(view, o, h)
        for k, (n, m) in (bc or {}).items():
            v = cs.setdefault(k, [0, 0])
            v[0] += n
            v[1] += m
    return cs


# ------------------------------------------------------------------ confirmed changes and the P(move) features
def changes(view, x):
    """{series} with a confirmed change on trading day x vs the previous trading day."""
    prev = tdays_back(x, 2)[0]

    def calc():
        a, b = view.obs(x), view.obs(prev)
        if a is None or b is None:
            return set()
        sb, out = b[0], set()
        for sk, (v, posted) in a[0].items():
            if sk in sb and abs(v - sb[sk][0]) >= MOVE and not (posted and posted == sb[sk][1]):
                out.add(sk)
        return out
    return view.cached(("changes", x), x, calc)


def _near(elevs_pts, radius):
    """{elev: [neighbour elevs within radius]} using a 1.5 degree grid."""
    grid = {}
    for e, ll in elevs_pts.items():
        grid.setdefault((int(ll[0] // 1.5), int(ll[1] // 1.5)), []).append(e)
    out = {}
    for e, ll in elevs_pts.items():
        cy, cx = int(ll[0] // 1.5), int(ll[1] // 1.5)
        out[e] = [p for dy in (-1, 0, 1) for dx in (-2, -1, 0, 1, 2) for p in grid.get((cy + dy, cx + dx), ())
                  if p != e and miles(ll, elevs_pts[p]) <= radius]
    return out


def neighbours(view, d):
    def calc():
        ob = view.obs(d)
        if ob is None:
            return {}
        return _near({e: v[0] for e, v in ob[1].items() if v[0]}, RULES["peer_radius_miles"])
    return view.cached(("near", d), d, calc)


def features(view, d):
    """{series: [days_since_change, changes_prior20, peer_moved_1d, peer_moved_5d]} for series observed
    on d. Peer flags are None when the elevator has no coordinates (unknown, never zero)."""
    def calc():
        ob = view.obs(d)
        if ob is None:
            return {}
        series, elevs = ob[0], ob[1]
        win = tdays_back(d, RULES["pmove_days_cap"])
        ch = [changes(view, x) for x in win]                      # oldest first, d last
        moved_by = [{}, {}]                                        # [1d, 5d]: (elev, crop) -> set of groups seen moving
        for i, x in enumerate(win[-RULES["peer_lookback_days"]:]):
            for sk in ch[len(win) - RULES["peer_lookback_days"] + i]:
                e, crop = sk.split("|", 2)[:2]
                g = (view.obs(x)[1].get(e) or (None, None, None))[1]
                moved_by[1].setdefault((e, crop), set()).add(g)
                if x == d:
                    moved_by[0].setdefault((e, crop), set()).add(g)
        near = neighbours(view, d)
        out = {}
        for sk in series:
            e, crop = sk.split("|", 2)[:2]
            since = RULES["pmove_days_cap"]
            for k in range(len(win) - 1, -1, -1):
                if sk in ch[k]:
                    since = len(win) - 1 - k
                    break
            n20 = sum(sk in s for s in ch)
            info = elevs.get(e)
            if not info or not info[0]:
                out[sk] = [since, n20, None, None]
                continue
            flags = []
            for mb in moved_by:
                gs = set()
                for p in near.get(e, ()):
                    gs |= mb.get((p, crop), set())
                gs.discard(info[1])
                flags.append(1 if len(gs) >= RULES["peer_min_groups"] else 0)
            out[sk] = [since, n20, flags[0], flags[1]]
        return out
    return view.cached(("features", d), d, calc)


def xrow(f):
    cap = float(RULES["pmove_days_cap"])
    return [1.0, f[0] / cap, f[1] / cap, float(f[2]), float(f[3])]


def fit_logistic(cells, ridge=None):
    """cells: {feature tuple: [n, moved]} -> coefficients (IRLS, small ridge on the slopes)."""
    ridge = RULES["pmove_ridge"] if ridge is None else ridge
    X = [(xrow(f), n, m) for f, (n, m) in cells.items() if n]
    k = 5
    w = [0.0] * k
    tot = sum(n for _, n, _ in X)
    for _ in range(50):
        g = [0.0] * k
        H = [[0.0] * k for _ in range(k)]
        for x, n, m in X:
            z = sum(a * b for a, b in zip(w, x))
            p = 1 / (1 + math.exp(-max(-30, min(30, z))))
            for i in range(k):
                g[i] += x[i] * (m - n * p)
                for j in range(k):
                    H[i][j] += x[i] * x[j] * n * p * (1 - p)
        for i in range(1, k):
            g[i] -= ridge * tot * w[i]
            H[i][i] += ridge * tot
        step = _solve(H, g)
        w = [a + b for a, b in zip(w, step)]
        if max(abs(s) for s in step) < 1e-9:
            break
    return [round(v, 6) for v in w]


def _solve(A, b):
    n = len(b)
    M = [row[:] + [b[i]] for i, row in enumerate(A)]
    for c in range(n):
        p = max(range(c, n), key=lambda r: abs(M[r][c]))
        M[c], M[p] = M[p], M[c]
        if abs(M[c][c]) < 1e-12:
            return [0.0] * n
        for r in range(n):
            if r != c:
                f = M[r][c] / M[c][c]
                M[r] = [x - f * y for x, y in zip(M[r], M[c])]
    return [M[i][n] / M[i][i] for i in range(n)]


def p_logit(coef, f):
    if coef is None or f[2] is None or f[3] is None:
        return None
    z = sum(a * b for a, b in zip(coef, xrow(f)))
    return round(1 / (1 + math.exp(-max(-30, min(30, z)))), 4)


def fit_month(store, fit_day, kind):
    """The frozen P(move) model for fit_day's month: trained only on outcomes whose target is before fit_day."""
    asof = tdays_back(fit_day, 2)[0] if CC.is_trading_day(fit_day) else tdays_back(fit_day, 1)[0]
    view = View(store, asof)
    first = min(store.days) if store.days else fit_day
    out = {"schema": SCHEMA_MODEL, "kind": kind, "version": f"pmove-v1-{fit_day[:7]}",
           "rules_version": RULES["version"], "model": RULES["pmove_model"], "fit_day": fit_day,
           "trained_on": f"outcomes with target day on or before {asof}", "horizons": {}}
    for h in RULES["horizons"]:
        cells, days = {}, set()
        o = first if CC.is_trading_day(first) else tday_add(first, 1)
        while tday_add(o, h) <= asof:
            oc = outcomes(view, o, h) if o in store.have else None
            if oc:
                fs = features(view, o)
                for sk, (moved, _) in oc.items():
                    f = fs.get(sk)
                    if f is None or f[2] is None or f[3] is None:
                        continue
                    v = cells.setdefault(tuple(f), [0, 0])
                    v[0] += 1
                    v[1] += moved
                days.add(o)
            o = tday_add(o, 1)
        n = sum(v[0] for v in cells.values())
        ok = n >= RULES["pmove_min_rows"] and len(days) >= RULES["pmove_min_days"]
        out["horizons"][str(h)] = {"n": n, "moved": sum(v[1] for v in cells.values()), "origin_days": len(days),
                                   "coef": fit_logistic(cells) if ok else None,
                                   "withheld": None if ok else (f"{n} rows over {len(days)} origin day(s); needs "
                                                                f"{RULES['pmove_min_rows']} over {RULES['pmove_min_days']}")}
    return out


# ------------------------------------------------------------------ the calls
def state_medians(series, elevs):
    """{(state, crop, contract, month): (median_int, n_elevators)}, one value per elevator."""
    per = {}
    for sk, (b, _) in series.items():
        elev, crop, start, k = skey_parts(sk)
        st = elevs.get(elev, (None, None, None))[2]
        per.setdefault((st, crop, k, start[:7]), {}).setdefault(elev, []).append(b)
    return {g: (statistics.median([statistics.median(v) for v in by.values()]), len(by)) for g, by in per.items()}


def medians(view, d):
    def calc():
        ob = view.obs(d)
        return None if ob is None else state_medians(ob[0], ob[1])
    return view.cached(("medians", d), d, calc)


def peer_moves(view, d):
    """{(elev, crop): (median change, groups, elevs)} from other elevators' 5-day changes within the radius."""
    back = tdays_back(d, RULES["peer_lookback_days"] + 1)[0]
    now, then = view.obs(d), view.obs(back)
    if now is None or then is None:
        return {}
    s_now, elevs, s_then = now[0], now[1], then[0]
    ch = {}
    for sk, (b, _) in s_now.items():
        if sk in s_then:
            elev, crop = sk.split("|", 2)[:2]
            ch.setdefault(elev, {}).setdefault(crop, []).append(b - s_then[sk][0])
    val = {e: {c: statistics.median(v) for c, v in cs.items()} for e, cs in ch.items()}
    near = neighbours(view, d)
    out = {}
    for e, (ll, grp, _) in elevs.items():
        if not ll:
            continue
        ps = [p for p in near.get(e, ()) if p in val and elevs[p][1] != grp]
        for c in {c for p in ps for c in val[p]}:
            vals = [(val[p][c], elevs[p][1]) for p in ps if c in val[p]]
            out[(e, c)] = (statistics.median(v for v, _ in vals), len({g for _, g in vals}), len(vals))
    return out


def previous_posted(view, d, sk):
    for x in tdays_back(d, 11)[-2::-1]:
        ob = view.obs(x)
        if ob is not None and sk in ob[0]:
            return True, ob[0][sk][1]
    return False, None


def make_calls(store, d, kind, model=None, made_at=None):
    """The frozen call document for origin d. Reads only snapshots on or before d."""
    if kind not in KINDS:
        raise ValueError(kind)
    view = View(store, d)
    ob = view.obs(d)
    if ob is None:
        raise ValueError(f"no snapshot for {d}")
    series, elevs, counts = ob
    med_by_day = {x: (medians(view, x), view.obs(x)[0]) for x in tdays_back(d, RULES["m1_premium_days"])
                  if view.obs(x) is not None}
    med_today = med_by_day[d][0] if d in med_by_day else state_medians(series, elevs)
    peers = peer_moves(view, d)
    feats = features(view, d)
    rates = {h: base_rates(view, d, h) for h in RULES["horizons"]}
    targets = {h: tday_add(d, h) for h in RULES["horizons"]}
    coefs = {h: ((model or {}).get("horizons", {}).get(str(h)) or {}).get("coef") for h in RULES["horizons"]}
    rows = []
    for sk in sorted(series):
        b, posted = series[sk]
        elev, crop, start, k = skey_parts(sk)
        st = elevs.get(elev, (None, None, None))[2]
        gk = (st, crop, k, start[:7])
        found, prev = previous_posted(view, d, sk)
        stale = None if (posted is None or not found or prev is None) else (posted == prev)
        m1, note = None, None
        med = med_today.get(gk)
        if not med or med[1] < RULES["m1_state_min_elevators"]:
            note = "no state median"
        else:
            prem = [ser[sk][0] - meds[gk][0] for meds, ser in med_by_day.values()
                    if sk in ser and gk in meds and meds[gk][1] >= RULES["m1_state_min_elevators"]]
            if len(prem) < RULES["m1_premium_min_days"]:
                note = "too little premium history"
            else:
                m1 = med[0] + statistics.median(prem)
        pm = peers.get((elev, crop))
        direction = None
        if pm and pm[1] >= RULES["peer_min_groups"]:
            direction = "up" if pm[0] >= PEER_MOVE else ("down" if pm[0] <= -PEER_MOVE else None)
        f = feats.get(sk)
        hs = []
        for h in RULES["horizons"]:
            n, m = rates[h].get((crop, st), [0, 0])
            hs.append([h, targets[h], round(m / n, 4) if n >= RULES["base_rate_min_n"] else None, n,
                       p_logit(coefs[h], f) if f else None])
        rows.append([sk, st, b / SCALE, stale, None if m1 is None else round(m1 / SCALE, 4), note, direction,
                     None if not pm else round(pm[0] / SCALE, 4), pm[1] if pm else 0, pm[2] if pm else 0, f, hs])
    return {
        "schema": SCHEMA_CALLS, "kind": kind, "day": d,
        "rules_version": RULES["version"], "rules": RULES,
        "model_version": (model or {}).get("version"),
        "made_at": made_at,
        "input": {"path": BS.path_for(d), "sha256": store.sha(d), "counts": counts},
        "note": ("Frozen basis forecasts (scripts/basis_ledger.py). One row per series observed on this day. "
                 "M0 (no change) is the basis column. m1 = state median + this series' 20-day median premium, "
                 "null with m1_note when it falls back to M0. p_base = the crop x state share that moved within h "
                 "trading days over the trailing window (known outcomes only), the benchmark; p_logit = the "
                 "month's frozen logistic model on features [days since change, changes in 20 days, peer groups "
                 "moved 1 day, 5 days]. direction = sign of the median 5-day move at other elevators within 100 "
                 "miles from 3+ other board groups, else null. PRIVATE: not for publication." + (
                     " REPLAY: what the rules would have made on this day; never counted with live calls."
                     if kind == "replay" else "")),
        "cols": CALL_COLS, "hcols": H_COLS,
        "calls": rows,
    }


# ------------------------------------------------------------------ grading
def grade(store, calls_doc, asof):
    """Grade rows for one call document as known at the end of asof."""
    view = View(store, asof)
    d = calls_doc["day"]
    rows, final = [], True
    for h in RULES["horizons"]:
        t = tday_add(d, h)
        if t > asof:
            oc, status, final = None, "pending", False
        else:
            oc = outcomes(view, d, h)
            status = "no snapshot" if oc is None else None
            if tday_add(t, SETTLE_DAYS) > asof:
                final = False
        for c in calls_doc["calls"]:
            sk = c[0]
            if oc is None:
                rows.append([sk, h, t, status, None, None, None])
            elif sk not in oc:
                rows.append([sk, h, t, "not observed", None, None, None])
            else:
                moved, net = oc[sk]
                rows.append([sk, h, t, "graded", round((round(c[2] * SCALE) + net) / SCALE, 4), moved,
                             round(net / SCALE, 4)])
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
    acc, status, days_made, conflicts = {}, {}, set(), [0, 0]

    def bucket(*k):
        return acc.setdefault(k, {"n": 0, "days": set(), "series": set(), "abs": 0.0, "fb": 0,
                                  "bb": 0.0, "bl": 0.0, "obs": 0, "pb": 0.0, "pl": 0.0,
                                  "dn": 0, "hit": 0, "flat": 0})
    for calls, grades in pairs:
        days_made.add(calls["day"])
        cc = calls.get("input", {}).get("counts", {})
        conflicts[0] += cc.get("conflict_keys", 0)
        conflicts[1] += cc.get("used", 0)
        by = {c[0]: c for c in calls["calls"]}
        for sk, h, t, st, actual, moved, net in grades["rows"]:
            status[(h, st)] = status.get((h, st), 0) + 1
            if st != "graded":
                continue
            c = by[sk]
            crop = sk.split("|", 2)[1]
            hrow = next(x for x in c[11] if x[0] == h)
            for cr in (crop, "ALL"):
                for model, fc in (("M0", c[2]), ("M1", c[4] if c[4] is not None else c[2])):
                    a = bucket("level", model, h, cr)
                    a["n"] += 1
                    a["days"].add(t)
                    a["series"].add(sk)
                    a["abs"] += abs(actual - fc)
                    a["fb"] += model == "M1" and c[4] is None
                y = 1.0 if moved else 0.0
                if hrow[2] is not None:
                    a = bucket("base", h, cr)
                    a["n"] += 1
                    a["days"].add(t)
                    a["bb"] += (hrow[2] - y) ** 2
                    a["obs"] += y
                    a["pb"] += hrow[2]
                if hrow[2] is not None and hrow[4] is not None:
                    a = bucket("move", h, cr)
                    a["n"] += 1
                    a["days"].add(t)
                    a["bb"] += (hrow[2] - y) ** 2
                    a["bl"] += (hrow[4] - y) ** 2
                    a["obs"] += y
                    a["pb"] += hrow[2]
                    a["pl"] += hrow[4]
                if c[6]:
                    a = bucket("dir", h, cr)
                    a["dn"] += 1
                    if net == 0:
                        a["flat"] += 1
                    else:
                        a["n"] += 1
                        a["days"].add(t)
                        a["hit"] += (net > 0) == (c[6] == "up")
    level, move, base, dirs = [], [], [], []
    for k in sorted(acc, key=str):
        a = acc[k]
        nd = len(a["days"])
        w = gate(a["n"], nd)
        if k[0] == "level":
            level.append({"model": k[1], "h": k[2], "crop": k[3], "n": a["n"], "series": len(a["series"]),
                          "target_days": nd, "m1_fallback_n": a["fb"] if k[1] == "M1" else None,
                          "mae_cents": None if w else round(100 * a["abs"] / a["n"], 3), "withheld": w})
        elif k[0] == "base":
            base.append({"h": k[1], "crop": k[2], "n": a["n"], "target_days": nd,
                         "brier_base": None if w else round(a["bb"] / a["n"], 4),
                         "observed_rate": None if w else round(a["obs"] / a["n"], 4),
                         "mean_p_base": None if w else round(a["pb"] / a["n"], 4), "withheld": w})
        elif k[0] == "move":
            bb, bl = a["bb"] / a["n"], a["bl"] / a["n"]
            move.append({"h": k[1], "crop": k[2], "n": a["n"], "target_days": nd,
                         "brier_base": None if w else round(bb, 4), "brier_logit": None if w else round(bl, 4),
                         "skill_logit_vs_base": None if w or bb == 0 else round(1 - bl / bb, 4),
                         "observed_rate": None if w else round(a["obs"] / a["n"], 4),
                         "mean_p_base": None if w else round(a["pb"] / a["n"], 4),
                         "mean_p_logit": None if w else round(a["pl"] / a["n"], 4), "withheld": w})
        else:
            dirs.append({"h": k[1], "crop": k[2], "calls_graded": a["dn"], "flat": a["flat"], "n": a["n"],
                         "target_days": nd, "hit_rate": None if w else round(a["hit"] / a["n"], 4),
                         "vs": 0.5, "withheld": w})
    return {"call_days": len(days_made), "first": min(days_made) if days_made else None,
            "last": max(days_made) if days_made else None,
            "conflict_keys_excluded": conflicts[0], "series_days_used": conflicts[1],
            "status": [{"h": h, "status": s, "n": n} for (h, s), n in sorted(status.items(), key=str)],
            "level": level, "move": move, "move_base": base, "direction": dirs}


# ------------------------------------------------------------------ files
def encode(doc):
    raw = json.dumps(doc, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    buf = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=buf, compresslevel=9, mtime=0) as g:
        g.write(raw)
    return buf.getvalue()


def decode(data):
    return json.loads(gzip.decompress(data).decode("utf-8"))


def doc_sha(doc):
    return hashlib.sha256(encode(doc)).hexdigest()


def rel(kind, what, day):
    if kind not in KINDS or what not in ("calls", "grades", "models"):
        raise ValueError((kind, what))
    if what == "models":
        return f"{OUT}/{kind}/models/pmove-{day[:7]}.json"
    return f"{OUT}/{kind}/{what}/{day[:4]}/{day}.json.gz"


class Ledger:
    """Reads ledger files from the out dir first, then the ref (or a folder); writes to the out dir."""

    def __init__(self, out_dir, ref=None, dir=None):
        self.out_dir, self.ref, self.dir = out_dir, ref, dir

    def read(self, p):
        for top in [self.out_dir] + ([self.dir] if self.dir else []):
            q = os.path.join(top, p)
            if os.path.exists(q):
                with open(q, "rb") as f:
                    return f.read()
        if self.ref and not self.dir:
            r = BS._git("show", f"{self.ref}:{p}", text=False)
            return r.stdout if r.returncode == 0 else None
        return None

    def list(self, kind, what):
        pat = re.compile(r"(\d{4}-\d{2}-\d{2})\.json\.gz$")
        base = f"{OUT}/{kind}/{what}"
        out = set()
        for top in [self.out_dir] + ([self.dir] if self.dir else []):
            for _, _, fs in os.walk(os.path.join(top, base)):
                out |= {m.group(1) for f in fs for m in [pat.search(f)] if m}
        if self.ref and not self.dir:
            r = BS._git("ls-tree", "-r", "--name-only", self.ref, "--", base)
            if r.returncode == 0:
                out |= {m.group(1) for line in r.stdout.splitlines() for m in [pat.search(line)] if m}
        return sorted(out)

    def write(self, p, data, frozen):
        """frozen=True: refuse to replace a file whose bytes differ (calls and models never change)."""
        old = self.read(p)
        if old is not None and old != data and frozen:
            raise Frozen(f"{p} is frozen and differs; it is never rewritten")
        if old == data:
            return False
        q = os.path.join(self.out_dir, p)
        os.makedirs(os.path.dirname(q), exist_ok=True)
        with open(q, "wb") as f:
            f.write(data)
        return True


def model_for(ledger, store, kind, d):
    """The month's frozen model: read it, or fit it now (d is the month's first call day) and freeze it."""
    p = rel(kind, "models", d)
    old = ledger.read(p)
    if old is not None:
        return json.loads(old)
    m = fit_month(store, d, kind)
    ledger.write(p, (json.dumps(m, indent=1) + "\n").encode(), frozen=True)
    return m


def replay_before(ledger, today):
    """Replay covers only days before the ledger existed: before the first live call day, and
    before today when there is no live call yet. A live day that was missed is never back-filled."""
    live = ledger.list("live", "calls")
    return min([today] + live[:1])


def freeze_calls(ledger, doc, today):
    if doc["kind"] == "replay" and doc["day"] >= replay_before(ledger, today):
        raise ValueError(f"replay covers days before {replay_before(ledger, today)} only, not {doc['day']}")
    return ledger.write(rel(doc["kind"], "calls", doc["day"]), encode(doc), frozen=True)


def regrade(ledger, store, kind, asof):
    """Grades for every call day. A settled grade file is read and never rebuilt; a grade
    that settled now is frozen to its file once; an open one is computed for the summary
    and not stored. -> (files written, pairs for the summary)."""
    n, pairs = 0, []
    for d in ledger.list(kind, "calls"):
        calls = decode(ledger.read(rel(kind, "calls", d)))
        if calls.get("kind") != kind:
            raise ValueError(f"{rel(kind, 'calls', d)} says kind={calls.get('kind')}")
        old = ledger.read(rel(kind, "grades", d))
        if old is not None:
            g = decode(old)
            if not g.get("final") or g.get("calls_sha256") != doc_sha(calls):
                raise ValueError(f"{rel(kind, 'grades', d)} is not a settled grade of these calls; "
                                 "a stored grade file is never rebuilt")
        else:
            g = grade(store, calls, asof)
            if g["final"]:
                n += ledger.write(rel(kind, "grades", d), encode(g), frozen=True)
        pairs.append((calls, g))
    return n, pairs


def write_summary(ledger, blocks, asof):
    doc = {"schema": SCHEMA_SUMMARY, "rules_version": RULES["version"], "registered": RULES["registered"],
           "asof": asof, "private": True,
           "note": ("PRIVATE: not deployed, not for publication until Sig says (STANDING-DECISIONS Oct 21). "
                    "live and replay are separate records and are never added together. mae_cents is the mean "
                    "absolute error of the basis forecast at the target day, in cents. brier_base is the crop x "
                    "state trailing rate (the benchmark), brier_logit the month's frozen logistic model, on the "
                    "same rows; skill = 1 - logit/base. move_base is the base rate alone on every graded row that has one (more rows, for months before the logistic model could be fitted). hit_rate = direction calls right among those whose net "
                    "change was not zero (flat counted beside it). n and target days beside every number; under "
                    "the minimum sample the value is null with the reason. Rows within one day are correlated: "
                    "target_days is the closer count of independent tries."),
           "live": blocks.get("live"), "replay": blocks.get("replay")}
    ledger.write(f"{OUT}/summary.json", (json.dumps(doc, indent=1, ensure_ascii=False) + "\n").encode(), frozen=False)
    return doc


def run(store, ledger, today, live_day=None, made_at=None, replay=True, replay_max=None, log=print):
    """The workflow step. Frozen live calls for live_day (only today's), replay of
    missing days before the first live call day, open grades, the summary."""
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
            doc = make_calls(store, live_day, "live", model=model_for(ledger, store, "live", live_day), made_at=made_at)
            freeze_calls(ledger, doc, today)
            log(f"[basis-ledger] froze {len(doc['calls'])} live calls for {live_day} ({doc['model_version']})")
    if replay:
        done = set(ledger.list("replay", "calls"))
        limit = replay_before(ledger, today)
        todo = [d for d in store.days if d < limit and d not in done and CC.is_trading_day(d)]
        if replay_max is not None and len(todo) > replay_max:
            log(f"[basis-ledger] replay: {len(todo)} day(s) to go, {replay_max} this run (oldest first)")
            todo = todo[:replay_max]
        for d in todo:
            doc = make_calls(store, d, "replay", model=model_for(ledger, store, "replay", d), made_at=made_at)
            freeze_calls(ledger, doc, today)
            log(f"[basis-ledger] replay {d}: {len(doc['calls'])} calls, "
                f"{doc['input']['counts']['conflict_keys']} conflicting keys excluded")
    blocks = {}
    for kind in KINDS:
        n, pairs = regrade(ledger, store, kind, today)
        blocks[kind] = summarize(pairs)
        log(f"[basis-ledger] {kind}: {len(pairs)} call day(s), {n} settled grade file(s) frozen")
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
    import shutil
    import tempfile
    fails = []

    def ck(name, ok):
        print(("ok   " if ok else "FAIL ") + name)
        if not ok:
            fails.append(name)

    def raises(exc, fn):
        try:
            fn()
        except exc:
            return True
        return False

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
    ck("horizons count CME trading days (Thanksgiving skipped)", tday_add("2026-11-20", 5) == "2026-11-30")

    # REAL ROWS from the 2026-10-27 snapshot on raw (business names, towns, posted basis only). Bunge Decatur
    # posted FH Nov +0.45 and LH Nov +0.55 under one delivery start: a conflict, dropped and counted.
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
        {"id": "eezwa2de11", "facility": "Bunge", "city": "Decatur", "state": "IL", "lat": 39.84, "lon": -88.95,
         "board": "bunge-decatur", "category": "soybeans", "delivery": "FH Nov", "start": "2026-11-01", "futures": "ZSX26",
         "basis": 0.45, "posted": "2026-10-27T19:00:00Z"},
        {"id": "eezwa2de11", "facility": "Bunge", "city": "Decatur", "state": "IL", "lat": 39.84, "lon": -88.95,
         "board": "bunge-decatur", "category": "soybeans", "delivery": "LH Nov", "start": "2026-11-01", "futures": "ZSX26",
         "basis": 0.55, "posted": "2026-10-27T19:00:00Z"},
        {"id": "e42vv1d8gq", "facility": "The Equity", "city": "Effingham", "state": "IL", "lat": 39.1217, "lon": -88.5611,
         "board": "theequity-effingham", "category": "corn", "delivery": "Jan 2027", "start": "2027-01-01",
         "futures": "@C7H", "basis": -0.30, "posted": "2026-10-27T18:30:32.432Z"},
        {"id": "e42vv1d8gq", "facility": "The Equity", "city": "Effingham", "state": "IL", "lat": 39.1217, "lon": -88.5611,
         "board": "theequity-effingham", "category": "corn", "start": "2026-11-01", "futures": "ZCZ26", "basis": -45.9,
         "posted": "2026-10-27T18:30:32.432Z"},
    ]
    s, e, c = parse_snapshot(_fake_snap("2026-10-27", real))
    ck("real rows: three series kept; no contract, a gross typo and the FH/LH conflict are not used",
       len(s) == 3 and c["no_contract"] == 1 and c["gross"] == 1 and "e42vv1d8gq|corn|2027-01-01|ZCH27" in s)
    ck("a conflicting key is dropped and counted, never picked",
       c["conflict_keys"] == 1 and c["conflict_rows"] == 2 and not any(k.startswith("eezwa2de11") for k in s))
    ck("the same bid under two symbol forms is one series, not a conflict", c["repeats"] == 1)
    ck("real rows: basis held exactly, board group and state kept",
       s["extasr98hc|wheat|2026-11-01|KEZ26"][0] == -6400 and e["extasr98hc"][1:] == ("farmerscooperative", "NE"))

    # logistic fit by hand: one binary feature, 100 rows each; 10% move without it, 50% with it
    cells = {(20, 0, 0, 0): [100, 10], (20, 0, 1, 1): [100, 50]}
    w = fit_logistic(cells, ridge=1e-6)
    ck("logistic fit recovers 10% and 50% (intercept + peer flags)",
       abs(p_logit(w, [20, 0, 0, 0]) - 0.10) < 0.002 and abs(p_logit(w, [20, 0, 1, 1]) - 0.50) < 0.002)
    ck("no coordinates: P_logit is withheld, never computed with zero peers", p_logit(w, [3, 2, None, None]) is None)

    # A small world: 4 IA elevators of 4 companies within 100 miles, 1 far away in TX, 30 trading days.
    days, x = [], dt.date(2026, 9, 1)
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
                with open(p, "wb") as f:
                    f.write(BS.encode(sn))
        src = os.path.join(tmp, "raw")
        put(world(skip=(days[27],)), src)
        st = Store(dir=src)
        d21 = days[21]
        doc = make_calls(st, d21, "live", made_at="t")
        rows = {r[0]: r for r in doc["calls"]}
        A, B_, D_ = "ea|corn|2026-12-01|ZCZ26", "eb|corn|2026-12-01|ZCZ26", "ed|corn|2026-12-01|ZCZ26"
        ra = rows[A]
        ck("direction: ea's three peers (3 companies) firmed 3 c over 5 days -> up", ra[6] == "up" and ra[8] == 3)
        ck("the far elevator has no peers and no direction", rows["ez|corn|2026-12-01|ZCZ26"][6] is None)
        ck("M0 is the basis at the origin", ra[2] == -0.40)
        # IA medians today: ea -0.40, eb -0.35, ec -0.33, ed -0.31 -> -0.34. ea's premium to the IA median was
        # -0.03 on days 0-19 (median of -0.40/-0.38/-0.36/-0.34 is -0.37) and -0.06 on days 20-21 -> median -0.03
        ck("M1 = state median + the series' 20-day median premium", ra[4] == round(-0.34 - 0.03, 4))
        ck("stale: ed's posted time never changes", rows[D_][3] is True and ra[3] is False)
        # features at day 21: eb changed on day 20 (since 1, one change); ed's move came under an unchanged posted time
        ck("features: days since change and changes in 20 days", rows[B_][10][:2] == [1, 1])
        ck("a move under an unchanged posted time is not a confirmed change", rows[D_][10][:2] == [20, 0])
        ck("features: peers moved within 5 days (eb, ec of 2 other groups only: under 3), none today",
           ra[10] == [20, 0, 0, 0])
        ck("the input snapshot's sha256 is recorded",
           doc["input"]["sha256"] == hashlib.sha256(open(os.path.join(src, BS.path_for(d21)), "rb").read()).hexdigest())
        put({days[25]: _fake_snap(days[25], [dict(real[0], id="ea", lat=42.0, lon=-93.0, basis=1.99)])}, src)
        ck("a later snapshot cannot change a call made earlier",
           encode(make_calls(Store(dir=src), d21, "live", made_at="t")) == encode(doc))
        put(world(skip=(days[27],)), src)
        ck("the view refuses a day after the origin", raises(LookAhead, lambda: View(st, d21).obs(days[22])))
        ck("a cached outcome is refused to a view that could not know it",
           raises(LookAhead, lambda: outcomes(View(st, days[22]), d21, 5)))
        # base rate: by day 21, h=5 origins 0..16 -> 17 x 4 IA series = 68 outcomes
        p5 = ra[11][1]
        ck("P_base(move within 5): crop x state rate from known outcomes only, with n",
           p5[0] == 5 and p5[1] == days[26] and p5[3] == 68 and p5[2] is not None and 0 < p5[2] < 1)
        ck("P_base(move within 20) withheld: too few known outcomes", ra[11][2][2] is None and ra[11][2][3] < 30)
        ck("h=1 is a horizon", ra[11][0][:2] == [1, days[22]])
        # the monthly model: fitted only on outcomes before the fit day; too little data -> withheld
        m = fit_month(st, days[21], "live")
        ck("the month's model is withheld under 2,000 rows, with the reason",
           m["horizons"]["5"]["coef"] is None and m["horizons"]["5"]["withheld"].startswith("80 rows over 16 origin")
           and m["version"] == "pmove-v1-" + days[21][:7])
        old = RULES["pmove_min_rows"], RULES["pmove_min_days"]
        RULES["pmove_min_rows"], RULES["pmove_min_days"] = 10, 2
        try:
            m = fit_month(st, days[21], "live")
        finally:
            RULES["pmove_min_rows"], RULES["pmove_min_days"] = old
        ck("the fit reads only outcomes with a target before the fit day",
           m["trained_on"].endswith(days[20]) and m["horizons"]["1"]["origin_days"] == 20)
        dm = make_calls(st, d21, "live", model=m)
        ck("calls carry the model version and a P_logit", dm["model_version"] == "pmove-v1-" + days[21][:7]
           and all(r[11][0][4] is not None for r in dm["calls"]))

        out = os.path.join(tmp, "out")
        L = Ledger(out, dir=src)
        ck("a call file is written once", freeze_calls(L, doc, days[29]) is True and freeze_calls(L, doc, days[29]) is False)
        ck("a frozen call file is never rewritten with different content",
           raises(Frozen, lambda: freeze_calls(L, dict(doc, made_at="other"), days[29])))
        before = open(os.path.join(out, rel("live", "calls", d21)), "rb").read()
        g = grade(st, doc, days[29])
        gr = {(r[0], r[1]): r for r in g["rows"]}
        ga = gr[(A, 5)]
        ck("graded at h=5 with the target's basis, moved and net",
           ga[3] == "graded" and ga[5] is True and ga[6] == 0.03 and ga[4] == -0.37)
        ck("h=20 target after the as-of day is pending, not graded", gr[(A, 20)][3] == "pending" and g["final"] is False)
        g22 = grade(st, make_calls(st, days[22], "live"), days[29])
        ck("a target day with no snapshot stays ungraded", {r[3] for r in g22["rows"] if r[1] == 5} == {"no snapshot"})
        drop = Store(dir=src)
        drop.obs(days[26])[0].pop(B_)
        g2 = grade(drop, doc, days[29])
        ck("a series missing from the target day stays ungraded",
           [r[3] for r in g2["rows"] if r[0] == B_ and r[1] == 5] == ["not observed"])
        sm = summarize([(doc, g2), (make_calls(st, days[22], "live"), g22)])
        st_n = {(x["h"], x["status"]): x["n"] for x in sm["status"]}
        ck("summary: ungraded rows are counted by reason, never as right or wrong",
           st_n[(5, "graded")] == 4 and st_n[(5, "not observed")] == 1 and st_n[(5, "no snapshot")] == 5)
        lv = [x for x in sm["level"] if x["model"] == "M0" and x["h"] == 5 and x["crop"] == "ALL"][0]
        ck("summary: under the minimum sample the rate is withheld with n beside it",
           lv["n"] == 4 and lv["mae_cents"] is None and lv["withheld"].startswith("withheld: 4 graded over 1"))
        rdoc = make_calls(st, d21, "replay", made_at="t")
        ck("replay and live are the same calls under a different kind", rdoc["calls"] == doc["calls"])
        ck("replay is refused on or after the first live call day",
           raises(ValueError, lambda: freeze_calls(L, rdoc, days[29])))
        rdoc = make_calls(st, days[20], "replay", made_at="t")
        freeze_calls(L, rdoc, days[29])
        d21r = days[20]
        ck("replay goes to its own folder", os.path.exists(os.path.join(out, rel("replay", "calls", d21r)))
           and rel("replay", "calls", d21r) != rel("live", "calls", d21r))
        ck("replay never covers today or a later day",
           raises(ValueError, lambda: freeze_calls(Ledger(os.path.join(tmp, "out3"), dir=src),
                                                   dict(rdoc, day=days[29]), days[29])))
        shutil.copy(os.path.join(out, rel("replay", "calls", d21r)), os.path.join(out, rel("live", "calls", days[19])))
        ck("a replay file in the live folder is refused", raises(ValueError, lambda: regrade(L, st, "live", days[29])))
        os.remove(os.path.join(out, rel("live", "calls", days[19])))
        ck("a live call is only made on its own day",
           raises(ValueError, lambda: run(st, L, today=days[29], live_day=days[28], log=lambda *a: None)))
        s = run(st, L, today=days[29], live_day=days[29], made_at="t", replay=False, log=lambda *a: None)
        ck("run freezes today's live calls and the month's model, and keeps the earlier file byte for byte",
           os.path.exists(os.path.join(out, rel("live", "calls", days[29])))
           and os.path.exists(os.path.join(out, rel("live", "models", days[29])))
           and open(os.path.join(out, rel("live", "calls", d21)), "rb").read() == before)
        ck("summary keeps live and replay as two records", s["live"]["call_days"] == 2 and s["replay"]["call_days"] == 1
           and s["private"] is True)
        L2 = Ledger(os.path.join(tmp, "out2"), dir=src)
        run(st, L2, today=days[29], replay_max=2, log=lambda *a: None)
        ck("replay goes oldest first, at most replay_max days a run", L2.list("replay", "calls") == days[:2]
           and L2.list("live", "calls") == [])
        L3 = Ledger(os.path.join(tmp, "out3b"), dir=src)
        run(st, L3, today=days[5], live_day=days[5], made_at="t", log=lambda *a: None)
        run(st, L3, today=days[7], log=lambda *a: None)
        ck("replay stops before the first live call day and never fills a later missed day",
           L3.list("replay", "calls") == days[:5] and L3.list("live", "calls") == [days[5]])
        # grade files: none while open, written once when settled, never rewritten
        hmax = max(RULES["horizons"])
        mid = tday_add(days[0], hmax + SETTLE_DAYS + 1)     # days[0] and days[1] settled, days[11] open
        far = tday_add(days[11], hmax + SETTLE_DAYS)
        L4 = Ledger(os.path.join(tmp, "out4"), dir=src)
        run(st, L4, today=mid, replay_max=12, log=lambda *a: None)
        gl = L4.list("replay", "grades")
        ck("an open grade is not stored; one past the settle window is", gl == days[:2])
        gp = os.path.join(tmp, "out4", rel("replay", "grades", days[0]))
        g0 = open(gp, "rb").read()
        ck("a stored grade file is settled", decode(g0)["final"] is True)
        gone = Store(dir=src)
        for x in days[1:21]:
            gone.obs(x)[0].clear()
        n4, pairs4 = regrade(L4, gone, "replay", far)
        ck("a settled grade file is never rewritten, even when the snapshots read differently later",
           open(gp, "rb").read() == g0 and decode(g0) == dict(pairs4[0][1]))
        ck("the open grades settle into files once, then nothing more is written",
           n4 > 0 and set(L4.list("replay", "grades")) == set(days[:12]) and regrade(L4, gone, "replay", far)[0] == 0)
        ck("a settled grade file that would change is refused",
           raises(Frozen, lambda: L4.write(rel("replay", "grades", days[0]), encode(dict(decode(g0), asof="x")),
                                           frozen=True)))
        with open(gp, "wb") as f:
            f.write(encode(dict(decode(g0), final=False)))
        ck("a stored grade file that is not settled is an error, never rebuilt",
           raises(ValueError, lambda: regrade(L4, st, "replay", far)))
        # tie rule, Brier and MAE on a hand case
        hz = [[5, "t1", 0.2, 40, 0.3]]
        cd = {"day": "x", "calls": [[k, "IA", -0.4, False, None, "no state median", dr, 0.03, 3, 3, [0, 0, 1, 1], hz]
                                    for k, dr in (("a|corn|s|ZCZ26", "up"), ("b|corn|s|ZCZ26", "up"), ("c|corn|s|ZCZ26", "down"))]}
        gd = {"rows": [["a|corn|s|ZCZ26", 5, "t1", "graded", -0.37, True, 0.03],
                       ["b|corn|s|ZCZ26", 5, "t1", "graded", -0.40, False, 0.0],
                       ["c|corn|s|ZCZ26", 5, "t1", "graded", -0.38, True, 0.02]]}
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
        # base p=0.2 vs outcomes 1,0,1 -> (0.64+0.04+0.64)/3 = 0.44; logit 0.3 -> (0.49+0.09+0.49)/3 = 0.3567
        ck("Brier by hand: base 0.44, logit 0.3567", mv["brier_base"] == 0.44 and mv["brier_logit"] == 0.3567)
        mb = [x for x in sm["move_base"] if x["crop"] == "ALL"][0]
        ck("base rate alone: Brier 0.44 on the same 3 rows, observed 0.6667", (mb["n"], mb["brier_base"],
           mb["observed_rate"]) == (3, 0.44, 0.6667))
        # MAE M0: 3 c + 0 + 2 c over 3 = 1.667 c
        ck("MAE by hand: 1.667 cents; M1 falls back to M0 and counts it",
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
            s.add_argument("--replay-max", type=int, help="replay at most this many days this run")
    a = ap.parse_args(argv)
    today = a.today or BS.ct_now().date().isoformat()
    store = Store(dir=a.dir, ref=a.ref)
    ledger = Ledger(a.out_dir, ref=None if a.dir else a.ref, dir=a.dir)
    made_at = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if a.cmd == "run":
        doc = run(store, ledger, today, live_day=a.live_day or None, made_at=made_at, replay=not a.no_replay,
                  replay_max=a.replay_max)
    else:
        doc = write_summary(ledger, {k: summarize(regrade(ledger, store, k, today)[1]) for k in KINDS}, today)
    for kind in KINDS:
        b = doc[kind]
        print(f"[basis-ledger] {kind}: {b['call_days']} call day(s) {b['first']}..{b['last']}, "
              f"{b['conflict_keys_excluded']} conflicting series-day keys excluded")
        for x in b["level"]:
            if x["crop"] == "ALL":
                print(f"  {x['model']} h={x['h']}: MAE {x['mae_cents']} c, n={x['n']}, days={x['target_days']}")
        for x in b["move"]:
            if x["crop"] == "ALL":
                print(f"  P(move) h={x['h']}: Brier base {x['brier_base']} logit {x['brier_logit']}, n={x['n']}, days={x['target_days']}")
        for x in b["move_base"]:
            if x["crop"] == "ALL":
                print(f"  P(move) h={x['h']} base rate alone: Brier {x['brier_base']} observed {x['observed_rate']} "
                      f"mean p {x['mean_p_base']}, n={x['n']}, days={x['target_days']}")
        for x in b["direction"]:
            if x["crop"] == "ALL":
                print(f"  direction h={x['h']}: hit {x['hit_rate']} n={x['n']} flat={x['flat']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
