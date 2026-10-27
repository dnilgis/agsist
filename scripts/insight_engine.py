#!/usr/bin/env python3
"""The weekly re-test engine (god's-eye panel build 3, the "insight machine", task 25; Sig, Oct 27 2026).

WHAT IT DOES. Re-runs every pre-registered relationship in scripts/insight_registry.json on the
history we hold, the same way each week, and appends one result row per spec to a private ledger.
It never publishes anything. When a spec meets every condition of Sig's "printable" rule except
his yes, its row says eligible (for Sig's review) and the run's log line and the Monday morning
report list it by id, counts only.

PRINTABLE (STANDING-DECISIONS, Oct 27 2026: "yes to all"): held-out test + placebo shuffle +
multiple-comparison correction across the whole test ledger + two seasons + Sig's yes, per test.
Here, a scored spec is:
  holdout   beats its benchmark on data the fit never saw: the bootstrap range of the gain
            (or of the contagion net) sits above zero and the sign is the one registered
  placebo   the real gain beats the shuffled ones: p = (1 + shuffles at least as good) / (1 + N),
            1,000 shuffles, 5,000 when p is under 0.01, 20,000 when p is within 10 times the
            ledger line (the line, 0.05 / M, needs more than 3,200 just to be reachable). Weekly
            series shuffle 8-week blocks; state-years shuffle states within a year; elevators
            shuffle which facility's change series sits where, within its state
  family    Holm within its family (every spec registered in the family counts; one not
            scored counts as p = 1)
  ledger    Bonferroni across the whole ledger: p x M <= 0.05, M = the tests spent before the
            registry (ledger_prior.count) plus every spec in it, retired or not
  seasons   the gain is above zero in at least two holdout seasons and in most of them
  verdict   HOLDS (all five) | PARTLY (holdout and placebo, but not the rest) | NO | WAIT (data
            missing, holdout window still open, too few rows) | ERROR (the spec changed after
            its first result, or the run broke)
  eligible  HOLDS, the same sign on the spec's last scored re-test, and no sig_yes yet
A first HOLDS is never eligible: it needs one re-test with the same sign first.

BENCHMARKS. A level is scored against persistence (the last value known that Friday). A change
is scored against the target's own last known change (a fit-years regression), and the model adds
x to that, so a predictor that only carries the target's own past earns nothing (seat 4's T1
placebo). State yield is scored against each state's own trend. Contagion against a control ring.

HONEST-NUMBERS RULES IT KEEPS. Predictors are read only once released (each series' release lag
in the registry; the decision time is the Friday). Seasonal means, trends and slopes come from
fit rows only. A holdout window is scored only after it has closed (plus the lag), so a weekly
re-test never peeks at a half-filled window and stops when it looks good. Every row carries n.

WHERE THINGS LIVE.
  scripts/insight_registry.json                     the specs (append only; the engine hashes each)
  private/ledger/tests/results/YYYY/YYYY-MM-DD.jsonl  one row per spec per run, written once,
                                                    never rewritten (a second run that day refuses)
  private/ledger/tests/latest.json                  the last run's counts, verdict changes and the
                                                    eligible ids (what the morning report reads)
The ledger folder is saved to the private-data branch of the private repo by
scripts/insight_engine.sh. /private/ is ignored on main: zero bytes on Pages.

INPUTS (missing ones turn their specs to WAIT, never to a guess):
  raw branch     history/agtransport/{barge_rates,grain_basis,inspections}, history/nass-progress/
                 {condition,progress}
  main           data/basis/changes-*.json, data/ids/elevators.json, data/nass/corn-yield.json
  private-data   private/ledger/bid-changes (the change-time ledger; empty until its backfill)

  python3 scripts/insight_engine.py due --ledger DIR [--today D]      exit 0 due, 3 not due
  python3 scripts/insight_engine.py run [--root .] [--raw .] [--ledger DIR] [--bid-ledger DIR]
        [--registry F] [--today D] [--only ID ...] [--dry-run] [--summary F]
  python3 scripts/insight_engine.py check-registry [--registry F]
  python3 scripts/insight_engine.py --selftest
"""
import argparse
import csv
import datetime as dt
import glob
import gzip
import hashlib
import io
import json
import math
import os
import random
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

ENGINE = "insight/1"
RESULT_SCHEMA = "agsist-insight-result/1"
LATEST_SCHEMA = "agsist-insight-latest/1"
REGISTRY_SCHEMA = "agsist-insight-registry/1"
REGISTRY = os.path.join(HERE, "insight_registry.json")
LEDGER_DIR = "private/ledger/tests"
BID_LEDGER_DIR = "private/ledger/bid-changes"
SHUFFLES, SHUFFLES_NEAR, NEAR_P = 1000, 5000, 0.01
SHUFFLES_LINE = 20000      # when p is within 10x the ledger-wide line
LINE = [None]              # alpha / M for this run (set by run())
BOOT = 1000
CHECK_PAIRS = []           # selftest only: compare the matrix counts with a pair-by-pair count
BLOCK_WEEKS = 8            # weekly placebo: shuffle 8-week blocks, not single weeks (autocorrelation)
WEEKDAY_RUN = 6            # Sunday (Python weekday), Central time
CATCH_UP_DAYS = 9          # a missed Sunday runs on the next morning once the last run is this old
VERDICTS = ("HOLDS", "PARTLY", "NO", "WAIT", "ERROR")
KINDS = ("weekly", "state_yield", "contagion")
SPEC_FIELDS = ("id", "registered", "family", "title", "kind", "x", "y", "grain", "expected_sign", "holdout",
               "benchmark", "placebo", "bootstrap", "else_explains", "sig_yes")

STATES = {
    "ALABAMA": "AL", "ALASKA": "AK", "ARIZONA": "AZ", "ARKANSAS": "AR", "CALIFORNIA": "CA", "COLORADO": "CO",
    "CONNECTICUT": "CT", "DELAWARE": "DE", "FLORIDA": "FL", "GEORGIA": "GA", "HAWAII": "HI", "IDAHO": "ID",
    "ILLINOIS": "IL", "INDIANA": "IN", "IOWA": "IA", "KANSAS": "KS", "KENTUCKY": "KY", "LOUISIANA": "LA",
    "MAINE": "ME", "MARYLAND": "MD", "MASSACHUSETTS": "MA", "MICHIGAN": "MI", "MINNESOTA": "MN",
    "MISSISSIPPI": "MS", "MISSOURI": "MO", "MONTANA": "MT", "NEBRASKA": "NE", "NEVADA": "NV",
    "NEW HAMPSHIRE": "NH", "NEW JERSEY": "NJ", "NEW MEXICO": "NM", "NEW YORK": "NY", "NORTH CAROLINA": "NC",
    "NORTH DAKOTA": "ND", "OHIO": "OH", "OKLAHOMA": "OK", "OREGON": "OR", "PENNSYLVANIA": "PA",
    "RHODE ISLAND": "RI", "SOUTH CAROLINA": "SC", "SOUTH DAKOTA": "SD", "TENNESSEE": "TN", "TEXAS": "TX",
    "UTAH": "UT", "VERMONT": "VT", "VIRGINIA": "VA", "WASHINGTON": "WA", "WEST VIRGINIA": "WV",
    "WISCONSIN": "WI", "WYOMING": "WY",
}


class Missing(Exception):
    """An input is not here. Its specs WAIT; nothing is guessed."""


def ct_today():
    from zoneinfo import ZoneInfo
    return dt.datetime.now(ZoneInfo("America/Chicago")).date()


def d(s):
    return dt.date.fromisoformat(str(s)[:10])


def r6(v):
    return None if v is None or (isinstance(v, float) and not math.isfinite(v)) else round(float(v), 6)


# ------------------------------------------------------------------ registry
def load_registry(path=REGISTRY):
    with open(path, encoding="utf-8") as f:
        reg = json.load(f)
    problems = check_registry(reg)
    if problems:
        raise ValueError("registry: " + "; ".join(problems[:8]))
    return reg


def check_registry(reg):
    out = []
    if reg.get("schema") != REGISTRY_SCHEMA:
        out.append("schema is not %s" % REGISTRY_SCHEMA)
    if not isinstance((reg.get("ledger_prior") or {}).get("count"), int):
        out.append("ledger_prior.count missing")
    fams = reg.get("families") or {}
    series = reg.get("series") or {}
    seen = set()
    for s in reg.get("specs") or []:
        sid = s.get("id", "?")
        for k in SPEC_FIELDS:
            if k not in s:
                out.append("%s: no %s" % (sid, k))
        if not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*-v\d+", str(sid)):
            out.append("%s: id must look like name-v1" % sid)
        if sid in seen:
            out.append("%s: id used twice" % sid)
        seen.add(sid)
        if s.get("family") not in fams:
            out.append("%s: family %s not in families" % (sid, s.get("family")))
        if s.get("kind") not in KINDS:
            out.append("%s: kind %s unknown" % (sid, s.get("kind")))
        if s.get("expected_sign") not in (1, -1):
            out.append("%s: expected_sign is 1 or -1" % sid)
        if s.get("sig_yes") not in (None,) and not re.fullmatch(r"\d{4}-\d\d-\d\d", str(s.get("sig_yes"))):
            out.append("%s: sig_yes is null or the date Sig said yes" % sid)
        try:
            d(s.get("registered"))
        except (TypeError, ValueError):
            out.append("%s: registered is a date" % sid)
        k = s.get("kind")
        if k == "weekly":
            for side in ("x", "y"):
                if (s.get(side) or {}).get("series") not in series:
                    out.append("%s: %s series unknown" % (sid, side))
            if s.get("benchmark_model", "own_past") not in ("persistence", "own_past", "fit_mean"):
                out.append("%s: benchmark_model is persistence, own_past or fit_mean" % sid)
            fy, hy = set(s["fit"]["years"]), set(s["holdout"]["years"])
            if fy & hy:
                out.append("%s: fit and holdout years overlap" % sid)
        elif k == "state_yield":
            if (s.get("x") or {}).get("series") not in ("corn_ge", "corn_planted"):
                out.append("%s: x series unknown" % sid)
        elif k == "contagion":
            if s.get("source") not in ("basis_log_corn", "bid_ledger_corn"):
                out.append("%s: source unknown" % sid)
            fit_to = d(s["fit"]["to"])
            for w in s["holdout"]["windows"]:
                if d(w["from"]) <= fit_to or d(w["to"]) < d(w["from"]):
                    out.append("%s: holdout window %s starts inside the fit" % (sid, w.get("season")))
    return out


def spec_hash(spec):
    body = {k: v for k, v in spec.items() if k != "sig_yes"}
    return hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode()).hexdigest()[:16]


def ledger_size(reg, previous_ids=()):
    """M for the ledger-wide correction: tests spent before the registry plus every spec ever registered."""
    ids = {s["id"] for s in reg["specs"]} | set(previous_ids)
    return int(reg["ledger_prior"]["count"]) + len(ids)


# ------------------------------------------------------------------ statistics
def holm(pvals, m=None):
    """Holm step-down adjusted p-values. pvals: {id: p}; m: family size (>= len, missing ones count as p=1)."""
    items = sorted(pvals.items(), key=lambda kv: (kv[1], kv[0]))
    m = max(m or 0, len(items))
    out, run = {}, 0.0
    for i, (k, p) in enumerate(items):
        run = max(run, min(1.0, (m - i) * p))
        out[k] = run
    return out


def bonferroni(p, m):
    return min(1.0, p * m)


def perm_p(obs, null, greater=True):
    """One-sided permutation p, counting the real statistic among the shuffles."""
    if greater:
        k = sum(1 for v in null if v >= obs - 1e-12)
    else:
        k = sum(1 for v in null if v <= obs + 1e-12)
    return (1 + k) / (1 + len(null))


def placebo(stat_of, shuffle, obs, rng, n=None, n_near=None, near=NEAR_P):
    """stat_of(shuffled) for n shuffles; to n_near in all when p comes out under `near`; to
    SHUFFLES_LINE when p is within 10 times the ledger-wide line (LINE), so a verdict at the line
    never rests on one or two shuffles."""
    n = SHUFFLES if n is None else n
    n_near = SHUFFLES_NEAR if n_near is None else n_near
    null = [stat_of(shuffle(rng)) for _ in range(n)]
    p = perm_p(obs, null)
    if p < near and n_near > n:
        null += [stat_of(shuffle(rng)) for _ in range(n_near - n)]
        p = perm_p(obs, null)
    if LINE[0] and p < 10 * LINE[0] and SHUFFLES_LINE > len(null):
        null += [stat_of(shuffle(rng)) for _ in range(SHUFFLES_LINE - len(null))]
        p = perm_p(obs, null)
    return p, len(null)


def quantile(xs, q):
    xs = sorted(xs)
    if not xs:
        return None
    i = (len(xs) - 1) * q
    lo, hi = int(math.floor(i)), int(math.ceil(i))
    return xs[lo] + (xs[hi] - xs[lo]) * (i - lo)


def boot_ci(blocks, stat, rng, n=None):
    """Percentile 95% range, resampling whole blocks (years or days) with replacement."""
    n = BOOT if n is None else n
    keys = list(blocks)
    if len(keys) < 2:
        return None, None
    vals = []
    for _ in range(n):
        pick = [blocks[keys[rng.randrange(len(keys))]] for _ in keys]
        v = stat(pick)
        if v is not None and math.isfinite(v):
            vals.append(v)
    if len(vals) < n // 2:
        return None, None
    return quantile(vals, 0.025), quantile(vals, 0.975)


def ols(xs, ys):
    n = len(xs)
    if n < 3:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    if sxx <= 0:
        return None
    b = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx
    return my - b * mx, b


def ols2(z, x, y):
    """y = a + g z + b x by least squares, or None."""
    n = len(y)
    if n < 5:
        return None
    mz, mx, my = sum(z) / n, sum(x) / n, sum(y) / n
    szz = sum((v - mz) ** 2 for v in z)
    sxx = sum((v - mx) ** 2 for v in x)
    szx = sum((u - mz) * (v - mx) for u, v in zip(z, x))
    szy = sum((u - mz) * (v - my) for u, v in zip(z, y))
    sxy = sum((u - mx) * (v - my) for u, v in zip(x, y))
    det = szz * sxx - szx * szx
    if abs(det) < 1e-12:
        return None
    g = (szy * sxx - sxy * szx) / det
    b = (sxy * szz - szy * szx) / det
    return my - g * mz - b * mx, g, b


def mae(pairs):
    return sum(abs(a - b) for a, b in pairs) / len(pairs) if pairs else None


def seasons_ok(per_season):
    """Two seasons: the gain is above zero in at least two holdout seasons and in most of them."""
    good = sum(1 for v in per_season.values() if v is not None and v > 0)
    closed = sum(1 for v in per_season.values() if v is not None)
    return good >= 2 and good * 2 > closed, good, closed


def seed_for(spec, salt=""):
    return int(hashlib.sha256((spec_hash(spec) + salt).encode()).hexdigest()[:12], 16)


# ------------------------------------------------------------------ inputs
class Inputs:
    """Every file the specs read, loaded once, raising Missing when absent."""

    def __init__(self, root=ROOT, raw=None, bid_ledger=None):
        self.root, self.raw = root, raw or root
        self.bid_ledger = bid_ledger or os.path.join(root, BID_LEDGER_DIR)
        self._cache = {}

    def _memo(self, key, fn):
        if key not in self._cache:
            try:
                self._cache[key] = fn()
            except Missing as e:
                self._cache[key] = e
        v = self._cache[key]
        if isinstance(v, Missing):
            raise v
        return v

    def csv_rows(self, rel):
        def load():
            files = sorted(glob.glob(os.path.join(self.raw, rel, "*.csv.gz")))
            if not files:
                raise Missing("%s (raw branch)" % rel)
            out = []
            for p in files:
                with gzip.open(p, "rt", encoding="utf-8", newline="") as f:
                    out.extend(csv.DictReader(f))
            return out
        return self._memo(("csv", rel), load)

    # weekly series: {obs_date: value}
    def series(self, name):
        return self._memo(("series", name), lambda: getattr(self, "_s_" + name)())

    def _s_barge3(self):
        by = {}
        for r in self.csv_rows("history/agtransport/barge_rates"):
            if r.get("location") in ("St. Louis", "Mid-Mississippi", "Lower Illinois"):
                try:
                    by.setdefault(d(r["date"]), []).append(float(r["rate"]))
                except (ValueError, KeyError):
                    pass
        return {k: sum(v) / len(v) for k, v in by.items() if len(v) >= 2}

    def _basis(self):
        def load():
            out = {}
            for r in self.csv_rows("history/agtransport/grain_basis"):
                if r.get("commodity") != "Corn":
                    continue
                try:
                    out[(r["market_name"], d(r["date"]))] = float(r["basis"]) * 100.0
                except (ValueError, KeyError):
                    pass
            return out
        return self._memo(("basis",), load)

    def _s_gulf_corn(self):
        return {k[1]: v for k, v in self._basis().items() if k[0] == "Gulf - Louisiana"}

    def _s_interior_corn(self):
        b = self._basis()
        il = {k[1]: v for k, v in b.items() if k[0] == "Illinois"}
        ia = {k[1]: v for k, v in b.items() if k[0] == "Iowa"}
        return {k: (il[k] + ia[k]) / 2 for k in il if k in ia}

    def _s_spread_gulf_interior(self):
        g, i = self.series("gulf_corn"), self.series("interior_corn")
        return {k: g[k] - i[k] for k in g if k in i}

    def _s_gulf_corn_inspections(self):
        by = {}
        for r in self.csv_rows("history/agtransport/inspections"):
            if r.get("grain") == "CORN" and r.get("ams_reg") == "GULF":
                try:
                    by[d(r["date"])] = by.get(d(r["date"]), 0.0) + float(r["mt"]) / 1000.0
                except (ValueError, KeyError):
                    pass
        return by

    # state-year
    def nass_week(self, kind, week):
        """{(state_alpha, year): value} for corn condition (good + excellent) or percent planted."""
        def load():
            rel = "history/nass-progress/condition" if kind == "corn_ge" else "history/nass-progress/progress"
            want = {"PCT GOOD", "PCT EXCELLENT"} if kind == "corn_ge" else {"PCT PLANTED"}
            cat = "CONDITION" if kind == "corn_ge" else "PROGRESS"
            parts = {}
            for r in self.csv_rows(rel):
                if (r.get("commodity_desc") != "CORN" or r.get("agg_level_desc") != "STATE"
                        or r.get("statisticcat_desc") != cat or r.get("unit_desc") not in want):
                    continue
                if str(r.get("begin_code")).strip() != str(week) or r.get("prodn_practice_desc") not in (None, "", "ALL PRODUCTION PRACTICES"):
                    continue
                try:
                    v = float(str(r["Value"]).replace(",", ""))
                    yr = int(r["year"])
                except (ValueError, KeyError):
                    continue
                parts.setdefault((r["state_alpha"], yr), {})[r["unit_desc"]] = v
            return {k: sum(v.values()) for k, v in parts.items() if set(v) == want}
        return self._memo(("nass", kind, week), load)

    def corn_yield(self):
        def load():
            p = os.path.join(self.root, "data/nass/corn-yield.json")
            if not os.path.exists(p):
                raise Missing("data/nass/corn-yield.json")
            with open(p, encoding="utf-8") as f:
                doc = json.load(f)
            out = {}
            for row in doc.get("rows") or []:
                st = STATES.get(str(row.get("state", "")).upper())
                for y, v in (row.get("values") or {}).items():
                    if st and isinstance(v, (int, float)):
                        out[(st, int(y))] = float(v)
            return out
        return self._memo(("yield",), load)

    # elevator-day
    def elevators(self):
        def load():
            p = os.path.join(self.root, "data/ids/elevators.json")
            if not os.path.exists(p):
                raise Missing("data/ids/elevators.json")
            with open(p, encoding="utf-8") as f:
                return json.load(f)["elevators"]
        return self._memo(("elev",), load)

    def corn_moves(self, source, since, until):
        """{day: {elevator id: direction}}; direction +1, -1 or 2 (moved, mixed directions). Weekdays only."""
        return self._memo(("moves", source, since, until), lambda: self._moves(source, since, until))

    def _moves(self, source, since, until):
        elev = self.elevators()
        out = {}
        if source == "basis_log_corn":
            key_to_id = {}
            for e in elev:
                for k in (e.get("sources") or {}).get("basis") or []:
                    key_to_id.setdefault(k, e["id"])
            files = sorted(glob.glob(os.path.join(self.root, "data/basis/changes-*.json")))
            if not files:
                raise Missing("data/basis/changes-*.json")
            for p in files:
                day = d(os.path.basename(p)[8:18])
                if day < since or day > until or day.weekday() >= 5:
                    continue
                with open(p, encoding="utf-8") as f:
                    doc = json.load(f)
                cols = doc.get("columns") or ["state", "facility", "city", "commodity", "symbol", "deliveryMonth", "from", "to"]
                ix = {c: i for i, c in enumerate(cols)}
                net = {}
                for r in doc.get("changes") or []:
                    if r[ix["commodity"]] != "corn" or r[ix["from"]] is None or r[ix["to"]] is None:
                        continue
                    eid = key_to_id.get("%s|%s|%s" % (r[ix["state"]], r[ix["facility"]], r[ix["city"]]))
                    if eid and r[ix["to"]] != r[ix["from"]]:
                        net.setdefault(eid, []).append(r[ix["to"]] - r[ix["from"]])
                out[day] = {k: _direction(v) for k, v in net.items()}
        else:
            files = sorted(glob.glob(os.path.join(self.bid_ledger, "*", "*.json.gz")))
            if not files:
                raise Missing("%s (change-time ledger; its backfill has not landed)" % BID_LEDGER_DIR)
            for p in files:
                day = d(os.path.basename(p)[:10])
                if day < since or day > until or day.weekday() >= 5:
                    continue
                with gzip.open(p, "rt", encoding="utf-8") as f:
                    doc = json.load(f)
                ix = {c: i for i, c in enumerate(doc["cols"])}
                net = {}
                for r in doc["rows"]:
                    if r[ix["crop"]] != "corn" or r[ix["kind"]] != "basis":
                        continue
                    a, b = r[ix["basisFrom"]], r[ix["basisTo"]]
                    if a is not None and b is not None and a != b:
                        net.setdefault(r[ix["elevId"]], []).append(b - a)
                out[day] = {k: _direction(v) for k, v in net.items()}
        if not out:
            raise Missing("%s: no weekday files between %s and %s" % (source, since, until))
        return out


def _direction(deltas):
    s = sum(deltas)
    return 1 if s > 0 else -1 if s < 0 else 2


# ------------------------------------------------------------------ kind: weekly
def week_friday(day):
    return day + dt.timedelta(days=(4 - day.weekday()) % 7)


def weekly_rows(spec, inputs, reg):
    """[(friday, x, y, bench)] with x known by the Friday under each series' release lag."""
    xs, ys = spec["x"], spec["y"]
    xser, yser = inputs.series(xs["series"]), inputs.series(ys["series"])
    xlag = int(reg["series"][xs["series"]]["release_lag_days"] or 0)
    ylag = int(reg["series"][ys["series"]]["release_lag_days"] or 0)
    fit_years = set(spec["fit"]["years"])
    xd = sorted(xser)
    yby = {week_friday(k): v for k, v in yser.items()}
    ydates = sorted(yser)
    seas = {}
    if xs["op"] == "seasonal_anomaly":
        acc = {}
        for k in xd:
            if k.year in fit_years:
                acc.setdefault(k.isocalendar()[1], []).append(xser[k])
        seas = {w: sum(v) / len(v) for w, v in acc.items() if len(v) >= 2}
    rows = []
    import bisect
    for fri in sorted(yby):
        cut = fri - dt.timedelta(days=xlag)          # an x observed on or before this is out by the Friday
        i = bisect.bisect_right(xd, cut) - 1
        if i < 0 or (fri - xd[i]).days > 14:
            continue
        if xs["op"] == "level":
            x = xser[xd[i]]
        elif xs["op"] == "change":
            if i < 1 or (xd[i] - xd[i - 1]).days > 10:
                continue
            x = xser[xd[i]] - xser[xd[i - 1]]
        elif xs["op"] == "seasonal_anomaly":
            w = xd[i].isocalendar()[1]
            if w not in seas:
                continue
            x = xser[xd[i]] - seas[w]
        else:
            raise ValueError("x op %s" % xs["op"])
        if ys["op"] == "level":
            y, end = yby[fri], fri
            j = bisect.bisect_right(ydates, fri - dt.timedelta(days=ylag)) - 1
            if j < 0 or (fri - ydates[j]).days > 14:
                continue
            bench = yser[ydates[j]]                  # persistence: the last y known on the Friday
        elif ys["op"] == "next_change":
            end = fri + dt.timedelta(days=7 * int(ys["weeks"]))
            if end not in yby:
                continue
            y = yby[end] - yby[fri]
            j = bisect.bisect_right(ydates, fri - dt.timedelta(days=ylag)) - 1
            bench = None                             # the target's own last known change (own_past)
            if j >= 1 and (fri - ydates[j]).days <= 14 and (ydates[j] - ydates[j - 1]).days <= 10:
                bench = yser[ydates[j]] - yser[ydates[j - 1]]
        else:
            raise ValueError("y op %s" % ys["op"])
        rows.append((fri, end, x, y, bench))
    return rows


def run_weekly(spec, inputs, reg, today):
    rows = weekly_rows(spec, inputs, reg)
    fy, hy = set(spec["fit"]["years"]), set(spec["holdout"]["years"])
    fit = [r for r in rows if r[0].year in fy and r[1].year in fy]
    hold = [r for r in rows if r[0].year in hy and r[1].year in hy and r[1] <= today]
    have = sorted({r[0].year for r in rows})
    if len(fit) < 30:
        return wait("fit years have %d usable weeks (data years %s)" % (len(fit), span(have)), n=len(fit))
    if len(hold) < int(spec.get("min_holdout_n", 50)):
        missing = sorted(hy - set(have))
        why = ("holdout years not on hand: %s" % span(missing)) if missing else "holdout has %d weeks" % len(hold)
        return wait(why + " (needs %d)" % int(spec.get("min_holdout_n", 50)), n=len(hold))
    bm = spec.get("benchmark_model") or ("persistence" if spec["y"]["op"] == "level" else "own_past")
    if bm == "own_past":
        fit = [r for r in fit if r[4] is not None]
        hold = [r for r in hold if r[4] is not None]
        if len(fit) < 30 or len(hold) < int(spec.get("min_holdout_n", 50)):
            return wait("too few weeks with the target's own last change known", n=len(hold))
        fb = ols([r[4] for r in fit], [r[3] for r in fit])
        fm = ols2([r[4] for r in fit], [r[2] for r in fit], [r[3] for r in fit])
        if not fb or not fm:
            return wait("the fit has no spread in x", n=len(fit))
        c0, phi = fb
        a, g, b = fm                         # model: a + g * own last change + b * x
        bench = [c0 + phi * r[4] for r in hold]
        zs = [r[4] for r in hold]
    else:
        fitted = ols([r[2] for r in fit], [r[3] for r in fit])
        if not fitted:
            return wait("the fit has no spread in x", n=len(fit))
        a, b = fitted
        g, zs = 0.0, [0.0] * len(hold)
        if bm == "persistence":
            bench = [r[4] for r in hold]
        else:
            m = sum(r[3] for r in fit) / len(fit)
            bench = [m] * len(hold)
    ys = [r[3] for r in hold]
    xs = [r[2] for r in hold]

    def pred(i, xv):
        return a + g * zs[i] + b * xv[i]

    def gain_of(xv, rows_idx=None):
        idx = range(len(ys)) if rows_idx is None else rows_idx
        mb = sum(abs(ys[i] - bench[i]) for i in idx)
        mm = sum(abs(ys[i] - pred(i, xv)) for i in idx)
        return (mb - mm) / len(idx)

    gain = gain_of(xs)
    mae_m = mae([(ys[i], pred(i, xs)) for i in range(len(ys))])
    mae_b = mae(list(zip(ys, bench)))
    if bm == "own_past":                     # x's own slope in the holdout, with the target's past held
        hb = ols2(zs, xs, ys)
        slope_h = hb[2] if hb else None
    else:
        hb = ols(xs, ys)
        slope_h = hb[1] if hb else None
    rng = random.Random(seed_for(spec, "boot"))
    by_year = {}
    for i, r in enumerate(hold):
        by_year.setdefault(r[0].year, []).append(i)
    lo, hi = boot_ci(by_year, lambda picks: gain_of(xs, [i for blk in picks for i in blk]), rng)
    per_season = {str(y): r6(gain_of(xs, idx)) for y, idx in sorted(by_year.items())}
    prng = random.Random(seed_for(spec, "placebo"))

    blk = int(spec.get("placebo_block_weeks", BLOCK_WEEKS))
    chunks = [list(range(i, min(i + blk, len(xs)))) for i in range(0, len(xs), blk)]

    def shuffle(rng_):
        # whole blocks of weeks move together, so x keeps its own week-to-week pattern
        order = chunks[:]
        rng_.shuffle(order)
        return [xs[i] for c_ in order for i in c_]
    p, nshuf = placebo(gain_of, shuffle, gain, prng)
    sign_ok = slope_h is not None and (slope_h > 0) == (spec["expected_sign"] > 0) and slope_h != 0
    ok2, good, closed = seasons_ok(per_season)
    return {
        "status": "scored", "n": len(hold), "n_detail": {"fit_weeks": len(fit), "holdout_weeks": len(hold),
                                                          "holdout_years": span(sorted(by_year))},
        "estimate": r6(gain), "range": [r6(lo), r6(hi)], "unit": "cents gained per week over the benchmark (MAE)",
        "slope": {"fit": r6(b), "holdout": r6(slope_h), "own_past_fit": r6(g) if bm == "own_past" else None},
        "holdout": {"mae_model": r6(mae_m), "mae_benchmark": r6(mae_b), "benchmark_model": bm,
                    "skill": r6(1 - mae_m / mae_b) if mae_b else None, "benchmark": spec["benchmark"],
                    "pass": bool(lo is not None and lo > 0 and sign_ok)},
        "placebo": {"p": r6(p), "shuffles": nshuf, "block_weeks": blk},
        "seasons": {"pass": ok2, "good": good, "closed": closed, "by_season": per_season},
        "sign": 1 if gain > 0 else -1, "sign_ok": sign_ok,
        "data": {"weeks_from": str(rows[0][0]) if rows else None, "weeks_to": str(rows[-1][0]) if rows else None},
    }


# ------------------------------------------------------------------ kind: state_yield
def run_state_yield(spec, inputs, reg, today):
    xv = inputs.nass_week(spec["x"]["series"], int(spec["x"]["week"]))
    yv = inputs.corn_yield()
    years = [int(y) for y in spec["holdout"]["years"]]
    minfit = int(spec.get("min_fit_years", 4))
    preds = []           # (year, state, y, trend, model)
    skipped = []
    for Y in years:
        if Y >= today.year:
            skipped.append(Y)
            continue
        fit_st = {}
        for (st, yr), v in yv.items():
            if yr < Y:
                fit_st.setdefault(st, []).append((yr, v))
        trend = {}
        for st, pts in fit_st.items():
            if len(pts) >= minfit:
                t = ols([p[0] for p in pts], [p[1] for p in pts])
                if t:
                    trend[st] = t
        # pooled slope on residuals vs the rating's distance from the state's earlier mean
        xmean = {}
        for (st, yr), v in xv.items():
            if yr < Y:
                xmean.setdefault(st, []).append(v)
        xmean = {k: sum(v) / len(v) for k, v in xmean.items() if len(v) >= minfit}
        rx, ry = [], []
        for (st, yr), v in xv.items():
            if yr < Y and st in trend and st in xmean and (st, yr) in yv:
                a, b = trend[st]
                rx.append(v - xmean[st])
                ry.append(yv[(st, yr)] - (a + b * yr))
        sl = ols(rx, ry)
        if not sl or len(rx) < 20:
            skipped.append(Y)
            continue
        for st in sorted(trend):
            if (st, Y) in yv and (st, Y) in xv and st in xmean:
                a, b = trend[st]
                tp = a + b * Y
                preds.append((Y, st, yv[(st, Y)], tp, tp + sl[1] * (xv[(st, Y)] - xmean[st]), sl[1], xmean[st], xv[(st, Y)]))
    if len(preds) < int(spec.get("min_holdout_n", 50)):
        return wait("holdout has %d state-years (needs %d); years without data: %s"
                    % (len(preds), int(spec.get("min_holdout_n", 50)), span(skipped) or "none"), n=len(preds))
    by_year = {}
    for i, p in enumerate(preds):
        by_year.setdefault(p[0], []).append(i)

    def gain_idx(idx, xs=None):
        tot = 0.0
        for i in idx:
            Y, st, y, tp, mp, b, xm, x = preds[i]
            if xs is not None:
                mp = tp + b * (xs[i] - xm)
            tot += abs(y - tp) - abs(y - mp)
        return tot / len(idx)

    allidx = list(range(len(preds)))
    gain = gain_idx(allidx)
    rng = random.Random(seed_for(spec, "boot"))
    lo, hi = boot_ci(by_year, lambda picks: gain_idx([i for blk in picks for i in blk]), rng)
    per_season = {str(y): r6(gain_idx(idx)) for y, idx in sorted(by_year.items())}
    base_x = [p[7] for p in preds]

    def shuffle(rng_):
        v = base_x[:]
        for idx in by_year.values():             # ratings shuffled across states within each year
            vals = [v[i] for i in idx]
            rng_.shuffle(vals)
            for i, val in zip(idx, vals):
                v[i] = val
        return v
    p, nshuf = placebo(lambda xs: gain_idx(allidx, xs), shuffle, gain, random.Random(seed_for(spec, "placebo")))
    slopes = sorted({round(pp[5], 4) for pp in preds})
    last_slope = preds[-1][5]
    sign_ok = (last_slope > 0) == (spec["expected_sign"] > 0)
    ok2, good, closed = seasons_ok(per_season)
    return {
        "status": "scored", "n": len(preds),
        "n_detail": {"holdout_state_years": len(preds), "holdout_years": span(sorted(by_year)), "years_left_out": span(skipped)},
        "estimate": r6(gain), "range": [r6(lo), r6(hi)], "unit": "bu per acre gained over the trend (MAE)",
        "slope": {"latest": r6(last_slope), "min": slopes[0], "max": slopes[-1]},
        "holdout": {"mae_model": r6(mae([(p[2], p[4]) for p in preds])), "mae_benchmark": r6(mae([(p[2], p[3]) for p in preds])),
                    "benchmark": spec["benchmark"], "pass": bool(lo is not None and lo > 0 and sign_ok)},
        "placebo": {"p": r6(p), "shuffles": nshuf},
        "seasons": {"pass": ok2, "good": good, "closed": closed, "by_season": per_season},
        "sign": 1 if gain > 0 else -1, "sign_ok": sign_ok,
    }


# ------------------------------------------------------------------ kind: contagion
def norm_company(s):
    return re.sub(r"[^A-Z0-9 ]+", " ", str(s or "").upper()).split()


def miles(lat1, lng1, lat2, lng2):
    import numpy as np
    p1, p2 = np.radians(lat1), np.radians(lat2)
    a = np.sin((p2 - p1) / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(np.radians(lng2 - lng1) / 2) ** 2
    return 3958.8 * 2 * np.arcsin(np.sqrt(np.minimum(1.0, a)))


def run_contagion(spec, inputs, reg, today):
    import numpy as np
    lag0, lag1 = spec["lag_days"]
    fit_from, fit_to = d(spec["fit"]["from"]), d(spec["fit"]["to"])
    windows = spec["holdout"]["windows"]
    last_to = max(d(w["to"]) for w in windows)
    moves = inputs.corn_moves(spec["source"], fit_from, min(today, last_to + dt.timedelta(days=14)))
    days = sorted(moves)
    if not days:
        return wait("no change days on hand", n=0)
    data_end = days[-1]

    def closed(w):
        after = [x for x in days if x > d(w["to"])]
        return today > d(w["to"]) and len(after) >= lag1
    shut = [w for w in windows if closed(w)]
    open_ = [w for w in windows if not closed(w)]
    elev = {e["id"]: e for e in inputs.elevators() if e.get("lat") is not None and e.get("lng") is not None}
    ids = sorted({k for day in days for k in moves[day] if k in elev})
    if len(ids) < 10:
        return wait("only %d located facilities in the change data" % len(ids), n=0)
    ix = {k: i for i, k in enumerate(ids)}
    n, T = len(ids), len(days)
    D = np.zeros((n, T), dtype=np.int8)
    for t, day in enumerate(days):
        for k, v in moves[day].items():
            if k in ix:
                D[ix[k], t] = v
    F = np.zeros((n, T), dtype=np.int8)        # direction of the first move in t+lag0 .. t+lag1
    for lag in range(lag1, lag0 - 1, -1):
        sh = np.zeros_like(D)
        sh[:, :T - lag] = D[:, lag:]
        F = np.where(sh != 0, sh, F)
    lat = np.array([elev[k]["lat"] for k in ids], dtype=float)
    lng = np.array([elev[k]["lng"] for k in ids], dtype=float)
    st = np.array([elev[k]["st"] for k in ids])
    comp = [norm_company(elev[k].get("company") or elev[k].get("name")) for k in ids]
    cj = np.array([" ".join(c) for c in comp])
    first = np.array([c[0] if c else "" for c in comp])
    dist = miles(lat[:, None], lng[:, None], lat[None, :], lng[None, :])
    other = cj[:, None] != cj[None, :]
    if spec.get("drop_shared_first_word"):
        other &= first[:, None] != first[None, :]
    near = other & (dist <= spec["near_mi"])
    np.fill_diagonal(near, False)
    c = spec["control"]
    ctrl = other & (dist > c["min_mi"]) & (dist <= c["max_mi"])
    if c.get("same_state"):
        ctrl &= st[:, None] == st[None, :]
    np.fill_diagonal(ctrl, False)
    ne, nr = np.nonzero(near)
    ce, cr = np.nonzero(ctrl)

    An, Ac = near.astype(np.float32), ctrl.astype(np.float32)

    def day_sums(Dm, Fm, cols):
        """Per trading day: (valid pairs, same-way follows, opposite follows) for near and control.
        A pair-day is valid when e moved one way on t and r did not move on t."""
        Dc, Fc = Dm[:, cols], Fm[:, cols]
        P, N, V = (Dc == 1).astype(np.float32), (Dc == -1).astype(np.float32), (Dc == 0)
        Qp, Qn = (V & (Fc == 1)).astype(np.float32), (V & (Fc == -1)).astype(np.float32)
        V = V.astype(np.float32)
        out = []
        for A in (An, Ac):
            AV, AQp, AQn = A @ V, A @ Qp, A @ Qn
            out.append(((P * AV + N * AV).sum(0).round().astype(np.int64),
                        (P * AQp + N * AQn).sum(0).round().astype(np.int64),
                        (P * AQn + N * AQp).sum(0).round().astype(np.int64)))
        return out

    def day_sums_pairs(Dm, Fm, cols):
        """The same counts pair by pair (the selftest checks the two agree)."""
        Dc, Fc = Dm[:, cols], Fm[:, cols]
        out = []
        for e_, r_ in ((ne, nr), (ce, cr)):
            E, R, FR = Dc[e_], Dc[r_], Fc[r_]
            valid = ((E == 1) | (E == -1)) & (R == 0)
            out.append((valid.sum(0), (valid & (FR == E)).sum(0), (valid & (FR == -E)).sum(0)))
        return out

    def net_of(sums, sel=None):
        (vn, sn, on), (vc, sc, oc) = sums
        if sel is not None:
            vn, sn, on, vc, sc, oc = (a[sel] for a in (vn, sn, on, vc, sc, oc))
        VN, VC = vn.sum(), vc.sum()
        if VN == 0 or VC == 0:
            return None
        return 100.0 * ((sn.sum() - on.sum()) / VN - (sc.sum() - oc.sum()) / VC)

    def cols_in(a, b):
        return np.array([i for i, x in enumerate(days) if a <= x <= b], dtype=int)

    fcols = cols_in(fit_from, fit_to)
    fit_net = net_of(day_sums(D, F, fcols)) if len(fcols) else None
    detail = {"fit_days": int(len(fcols)), "fit_net": r6(fit_net), "facilities": n,
              "near_pairs_possible": int(len(ne)), "control_pairs_possible": int(len(ce)),
              "data_through": str(data_end), "windows_open": [w["season"] for w in open_]}
    if not shut:
        w = open_[0]
        inside = len(cols_in(d(w["from"]), d(w["to"])))
        return wait("holdout %s (%s to %s) is still open: %d trading days in, scored after it closes"
                    % (w["season"], w["from"], w["to"], inside), n=0, n_detail=detail)
    hcols = np.concatenate([cols_in(d(w["from"]), d(w["to"])) for w in shut])
    season_of = {}
    for w in shut:
        for i in cols_in(d(w["from"]), d(w["to"])):
            season_of[int(i)] = w["season"]
    sums = day_sums(D, F, hcols)
    obs = net_of(sums)
    if CHECK_PAIRS:
        alt = day_sums_pairs(D, F, hcols)
        CHECK_PAIRS.append(all(np.array_equal(a, b) for x_, y_ in zip(sums, alt) for a, b in zip(x_, y_)))
    E = D[:, hcols]
    has_near = near.any(1)
    events = int((((E == 1) | (E == -1)) & has_near[:, None]).sum())
    near_pairs, ctrl_pairs = int(sums[0][0].sum()), int(sums[1][0].sum())
    detail.update({"holdout_days": int(len(hcols)), "events": events, "near_pairs": near_pairs, "control_pairs": ctrl_pairs,
                   "near_same_pct": r6(100.0 * sums[0][1].sum() / near_pairs) if near_pairs else None,
                   "near_opposite_pct": r6(100.0 * sums[0][2].sum() / near_pairs) if near_pairs else None,
                   "control_same_pct": r6(100.0 * sums[1][1].sum() / ctrl_pairs) if ctrl_pairs else None,
                   "control_opposite_pct": r6(100.0 * sums[1][2].sum() / ctrl_pairs) if ctrl_pairs else None})
    if obs is None or events < int(spec.get("min_events", 100)):
        return wait("holdout has %d events (needs %d)" % (events, int(spec.get("min_events", 100))), n=events, n_detail=detail)
    rng = random.Random(seed_for(spec, "boot"))
    blocks = {i: np.array([i]) for i in range(len(hcols))}
    lo, hi = boot_ci(blocks, lambda picks: net_of(sums, np.concatenate(picks)), rng)
    per_season = {}
    for s in sorted(set(season_of.values())):
        sel = np.array([j for j, c_ in enumerate(hcols) if season_of[int(c_)] == s], dtype=int)
        per_season[s] = r6(net_of(sums, sel))
    groups = {}
    for i, s_ in enumerate(st):
        groups.setdefault(s_, []).append(i)
    groups = [np.array(g) for g in groups.values() if len(g) > 1]
    nprng = np.random.default_rng(seed_for(spec, "placebo"))

    def shuffle(_):
        perm = np.arange(n)
        for g in groups:
            perm[g] = g[nprng.permutation(len(g))]
        return perm

    def stat(perm):
        v = net_of(day_sums(D[perm], F[perm], hcols))
        return -1e9 if v is None else v
    sign = spec["expected_sign"]
    p, nshuf = placebo(stat, shuffle, obs, random.Random(0)) if sign > 0 else (1.0, 0)
    sign_ok = (obs > 0) == (sign > 0)
    ok2, good, closed_n = seasons_ok(per_season)
    return {
        "status": "scored", "n": events, "n_detail": detail,
        "estimate": r6(obs), "range": [r6(lo), r6(hi)], "unit": "percentage points, near net minus control net",
        "holdout": {"benchmark": spec["benchmark"], "pass": bool(lo is not None and lo > 0 and sign_ok)},
        "placebo": {"p": r6(p), "shuffles": nshuf},
        "seasons": {"pass": ok2, "good": good, "closed": closed_n, "by_season": per_season,
                    "registered": [w["season"] for w in windows]},
        "sign": 1 if obs > 0 else -1, "sign_ok": sign_ok,
    }


RUNNERS = {"weekly": run_weekly, "state_yield": run_state_yield, "contagion": run_contagion}


def wait(why, n=None, n_detail=None):
    return {"status": "wait", "why": why, "n": n, "n_detail": n_detail or {}}


def span(years):
    years = sorted(years)
    if not years:
        return ""
    out, start, prev = [], years[0], years[0]
    for y in years[1:] + [None]:
        if y is not None and isinstance(y, int) and y == prev + 1:
            prev = y
            continue
        out.append(str(start) if start == prev else "%s-%s" % (start, prev))
        if y is not None:
            start = prev = y
    return ", ".join(out)


# ------------------------------------------------------------------ the gate
def gate(reg, cores, previous, today, M):
    """cores: {id: kind output}. previous: {id: [earlier rows, oldest first]}. Returns rows."""
    alpha = float(reg.get("alpha", 0.05))
    fam_size = {}
    for s in reg["specs"]:
        fam_size[s["family"]] = fam_size.get(s["family"], 0) + 1
    fam_p = {}
    for s in reg["specs"]:
        c = cores.get(s["id"]) or {}
        if c.get("status") == "scored":
            fam_p.setdefault(s["family"], {})[s["id"]] = c["placebo"]["p"]
    holm_adj = {}
    for fam, ps in fam_p.items():
        holm_adj.update(holm(ps, fam_size[fam]))
    rows = []
    for s in reg["specs"]:
        sid = s["id"]
        c = cores.get(sid) or {"status": "error", "why": "not run"}
        h = spec_hash(s)
        prev = previous.get(sid) or []
        row = {"schema": RESULT_SCHEMA, "date": str(today), "engine": ENGINE, "id": sid, "hash": h,
               "family": s["family"], "kind": s["kind"]}
        moved = [p for p in prev if p.get("hash") and p["hash"] != h]
        if moved:
            row.update({"verdict": "ERROR", "why": "spec changed after its first result (%s); register a new id and keep this one"
                        % moved[0]["date"], "eligible": False})
            rows.append(row)
            continue
        if c["status"] != "scored":
            row.update({"verdict": "ERROR" if c["status"] == "error" else "WAIT", "why": c.get("why"),
                        "n": c.get("n"), "n_detail": c.get("n_detail"), "eligible": False})
            rows.append(row)
            continue
        p = c["placebo"]["p"]
        fam_ok = holm_adj.get(sid, 1.0) <= alpha
        bonf = bonferroni(p, M)
        ledger_ok = bonf <= alpha
        conds = {"holdout": bool(c["holdout"]["pass"]), "placebo": p <= alpha, "family_holm": fam_ok,
                 "ledger_wide": ledger_ok, "two_seasons": bool(c["seasons"]["pass"])}
        if all(conds.values()):
            verdict = "HOLDS"
        elif conds["holdout"] and conds["placebo"]:
            verdict = "PARTLY"
        else:
            verdict = "NO"
        last = next((q for q in reversed(prev) if q.get("verdict") in ("HOLDS", "PARTLY", "NO") and q.get("date") != str(today)), None)
        stable = bool(last and last.get("sign") == c["sign"] and last.get("verdict") == "HOLDS")
        eligible = verdict == "HOLDS" and stable and not s.get("sig_yes")
        failed = [k for k, v in conds.items() if not v]
        row.update({
            "verdict": verdict,
            "why": "all printable conditions but Sig's yes" if verdict == "HOLDS" else "fails: " + ", ".join(failed),
            "n": c["n"], "n_detail": c.get("n_detail"), "estimate": c["estimate"], "range": c["range"], "unit": c["unit"],
            "sign": c["sign"], "holdout": c["holdout"], "placebo": c["placebo"],
            "holm_family": r6(holm_adj.get(sid, 1.0)), "family_size": fam_size[s["family"]],
            "ledger": {"M": M, "p_corrected": r6(bonf), "line": r6(alpha / M)},
            "seasons": c["seasons"], "conditions": conds, "sign_stable": stable,
            "sig_yes": s.get("sig_yes"), "eligible": eligible,
        })
        for k in ("slope",):
            if k in c:
                row[k] = c[k]
        rows.append(row)
    return rows


# ------------------------------------------------------------------ the ledger on disk
def result_path(ledger, day):
    return os.path.join(ledger, "results", str(day)[:4], "%s.jsonl" % day)


def read_results(ledger):
    out = []
    for p in sorted(glob.glob(os.path.join(ledger, "results", "*", "*.jsonl"))):
        with open(p, encoding="utf-8") as f:
            out.extend(json.loads(line) for line in f if line.strip())
    out.sort(key=lambda r: (r.get("date", ""), r.get("id", "")))
    return out


def last_run_date(ledger):
    ps = sorted(glob.glob(os.path.join(ledger, "results", "*", "*.jsonl")))
    return d(os.path.basename(ps[-1])[:10]) if ps else None


def is_due(ledger, today):
    last = last_run_date(ledger)
    if last is None:
        return True, "no run yet"
    if last >= today:
        return False, "already ran %s" % last
    if today.weekday() == WEEKDAY_RUN:
        return True, "Sunday re-test"
    if (today - last).days >= CATCH_UP_DAYS:
        return True, "catch-up: last run %s" % last
    return False, "next run Sunday (last %s)" % last


def counts_line(rows, today):
    c = {v: 0 for v in VERDICTS}
    for r in rows:
        c[r["verdict"]] = c.get(r["verdict"], 0) + 1
    el = [r["id"] for r in rows if r.get("eligible")]
    s = "insight: run %s: %d tests: %s; eligible for Sig's review: %d" % (
        today, len(rows), ", ".join("%s %d" % (k, c[k]) for k in VERDICTS), len(el))
    return s + (" (%s)" % ", ".join(el) if el else ""), c, el


def run(args):
    reg = load_registry(args.registry)
    today = d(args.today) if args.today else ct_today()
    ledger = args.ledger
    if not args.dry_run and os.path.exists(result_path(ledger, today)):
        print("insight: a run for %s is already in the ledger; results are written once, never rewritten" % today)
        return 2
    earlier = read_results(ledger)
    previous = {}
    for r in earlier:
        previous.setdefault(r["id"], []).append(r)
    M = ledger_size(reg, previous.keys())
    LINE[0] = float(reg.get("alpha", 0.05)) / M
    inputs = Inputs(root=args.root, raw=args.raw, bid_ledger=args.bid_ledger)
    cores = {}
    for s in reg["specs"]:
        if args.only and s["id"] not in args.only:
            continue
        try:
            cores[s["id"]] = RUNNERS[s["kind"]](s, inputs, reg, today)
        except Missing as e:
            cores[s["id"]] = wait("input missing: %s" % e)
        except Exception as e:                                # noqa: BLE001
            cores[s["id"]] = {"status": "error", "why": "%s: %s" % (type(e).__name__, str(e)[:200])}
    rows = gate(reg, cores, previous, today, M)
    if args.only:
        rows = [r for r in rows if r["id"] in args.only]
    line, counts, el = counts_line(rows, today)
    changes = []
    for r in rows:
        prev = [q for q in previous.get(r["id"], []) if q.get("date") != str(today)]
        if prev and prev[-1].get("verdict") != r["verdict"]:
            changes.append({"id": r["id"], "from": prev[-1]["verdict"], "to": r["verdict"]})
        elif not prev:
            changes.append({"id": r["id"], "from": None, "to": r["verdict"]})
    for r in rows:
        print("  %-34s %-6s n=%-6s %s" % (r["id"], r["verdict"], r.get("n"), r.get("why") or ""))
    print(line)
    if args.summary:
        with open(args.summary, "a", encoding="utf-8") as f:
            f.write("### Re-test engine\n\n%s\n\n" % line)
            for r in rows:
                f.write("- %s: %s, n %s\n" % (r["id"], r["verdict"], r.get("n")))
    if args.dry_run:
        return 0
    p = result_path(ledger, today)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "x", encoding="utf-8") as f:          # "x": never over an existing run
        for r in rows:
            f.write(json.dumps(r, sort_keys=True, separators=(",", ":")) + "\n")
    latest = {"schema": LATEST_SCHEMA, "date": str(today), "engine": ENGINE, "tests": len(rows), "counts": counts,
              "eligible": el, "changes": changes, "ledger_M": M,
              "note": "Counts and test ids only. Nothing here is published; eligible means every printable condition holds except Sig's yes."}
    with open(os.path.join(ledger, "latest.json"), "w", encoding="utf-8") as f:
        json.dump(latest, f, indent=1, sort_keys=True)
        f.write("\n")
    return 0


# ------------------------------------------------------------------ selftest (synthetic data, known answers)
class fewer_shuffles:
    """Calibration loops in the selftest: many null worlds, 200 shuffles each."""

    def __enter__(self):
        global SHUFFLES, SHUFFLES_NEAR, BOOT
        self.was = SHUFFLES, SHUFFLES_NEAR, BOOT
        SHUFFLES, SHUFFLES_NEAR, BOOT = 200, 200, 100

    def __exit__(self, *a):
        global SHUFFLES, SHUFFLES_NEAR, BOOT
        SHUFFLES, SHUFFLES_NEAR, BOOT = self.was


def selftest():
    import shutil
    import tempfile
    fails = []

    def ck(name, ok, detail=""):
        print(("  ok   " if ok else "  FAIL ") + name + ("" if ok else "  -- %s" % (detail,)))
        if not ok:
            fails.append(name)

    print("Holm and Bonferroni (textbook values)")
    h = holm({"a": 0.01, "b": 0.04, "c": 0.03, "d": 0.005})
    ck("Holm: 0.005, 0.01, 0.03, 0.04 -> 0.02, 0.03, 0.06, 0.06",
       all(abs(h[k] - v) < 1e-12 for k, v in {"d": 0.02, "a": 0.03, "c": 0.06, "b": 0.06}.items()), h)
    h2 = holm({"a": 0.01}, m=5)
    ck("Holm: a family member not scored still counts (m=5)", abs(h2["a"] - 0.05) < 1e-12, h2)
    ck("Holm never above 1", holm({"a": 0.6, "b": 0.7})["b"] == 1.0)
    ck("Bonferroni across the ledger: 0.0002 x 164 passes, 0.0004 x 164 does not",
       bonferroni(0.0002, 164) <= 0.05 < bonferroni(0.0004, 164))
    ck("permutation p counts the real one: 0 of 999 as high -> 0.001", abs(perm_p(5, [0] * 999) - 0.001) < 1e-12)
    ck("5,000 shuffles can reach the ledger line (1/5001 < 0.05/164)", 1 / 5001 < 0.05 / 164 < 1 / 1001)
    LINE[0] = 0.05 / 164
    cnt = [0]

    def st_(v):
        cnt[0] += 1
        return v
    pz, nz = placebo(st_, lambda r_: r_.random() * 0.5, 1.0, random.Random(1))
    ck("a real statistic above every shuffle: 1,000, then 5,000, then 20,000 near the line",
       nz == SHUFFLES_LINE and cnt[0] == SHUFFLES_LINE and abs(pz - 1 / (SHUFFLES_LINE + 1)) < 1e-15, (pz, nz))
    pf, nf = placebo(st_, lambda r_: r_.random(), 0.5, random.Random(1))
    ck("an ordinary p stops at 1,000", nf == SHUFFLES and 0.4 < pf < 0.6, (pf, nf))
    LINE[0] = None

    print("placebo on synthetic weekly data")
    reg = {"schema": REGISTRY_SCHEMA, "alpha": 0.05, "ledger_prior": {"count": 150},
           "series": {"xs": {"release_lag_days": 2}, "ys": {"release_lag_days": 0}},
           "families": {"f": "t"}, "specs": []}

    class Fake(Inputs):
        def __init__(self, ser):
            super().__init__(root="/nonexistent")
            self.ser = ser

        def series(self, name):
            if name not in self.ser:
                raise Missing(name)
            return self.ser[name]

    def weekly_data(beta, seed, noise=1.0):
        """x on Tuesdays (out Thursday); y on Fridays, a walk whose next-week step is beta x + noise."""
        rng = random.Random(seed)
        xs, ys, acc = {}, {}, 0.0
        tue = dt.date(2016, 1, 5)
        while tue.year <= 2025:
            xs[tue] = rng.gauss(0, 1)
            fri = tue + dt.timedelta(days=3)
            ys[fri] = acc
            acc += beta * xs[tue] + rng.gauss(0, noise)
            tue += dt.timedelta(days=7)
        return {"xs": xs, "ys": ys}

    def wspec(sid, sign=1):
        return {"id": sid, "registered": "2026-10-27", "family": "f", "title": "t", "kind": "weekly",
                "x": {"series": "xs", "op": "level"}, "y": {"series": "ys", "op": "next_change", "weeks": 1},
                "grain": "week", "expected_sign": sign, "fit": {"years": [2016, 2017, 2018, 2019, 2020]},
                "holdout": {"years": [2021, 2022, 2023, 2024, 2025]}, "min_holdout_n": 100,
                "benchmark": "fit mean", "placebo": "shuffle", "bootstrap": "year", "else_explains": [], "sig_yes": None}
    today = dt.date(2026, 10, 27)
    real = run_weekly(wspec("real-v1"), Fake(weekly_data(2.0, 1)), reg, today)
    ck("a planted lead is found: placebo p at its floor, 5,000 shuffles", real["status"] == "scored"
       and real["placebo"]["shuffles"] == SHUFFLES_NEAR and real["placebo"]["p"] < 0.001, real.get("placebo"))
    ck("... it beats the benchmark out of sample with a range above zero", real["holdout"]["pass"] and real["range"][0] > 0, real.get("range"))
    ck("... in every holdout season", real["seasons"]["good"] == 5 and real["seasons"]["pass"], real.get("seasons"))
    wrong = run_weekly(wspec("wrong-v1", sign=-1), Fake(weekly_data(2.0, 1)), reg, today)
    ck("the registered sign is the wrong one: holdout fails", not wrong["holdout"]["pass"] and not wrong["sign_ok"])
    nulls = []
    with fewer_shuffles():
        for sd in range(40):
            c = run_weekly(wspec("null-v1"), Fake(weekly_data(0.0, 100 + sd)), reg, today)
            nulls.append(c["placebo"]["p"])
    rate = sum(1 for p in nulls if p <= 0.05) / len(nulls)
    ck("no relationship: placebo p under 0.05 in about 5%% of 40 null worlds (%.0f%%)" % (100 * rate), rate <= 0.15, nulls)
    ck("... and p spreads out (median %.2f)" % quantile(nulls, 0.5), 0.2 < quantile(nulls, 0.5) < 0.8)

    print("release rule: no look-ahead")
    ser = {"xs": {dt.date(2020, 1, 7) + dt.timedelta(days=7 * i): float(i) for i in range(400)},
           "ys": {dt.date(2020, 1, 10) + dt.timedelta(days=7 * i): float(i) for i in range(400)}}
    sp = wspec("lag-v1")
    sp["x"] = {"series": "xs", "op": "level"}
    reg2 = dict(reg, series={"xs": {"release_lag_days": 4}, "ys": {"release_lag_days": 0}})
    rows = weekly_rows(sp, Fake(ser), reg2)
    ck("a Tuesday value out 4 days later is not known that Friday: the Friday uses the week before",
       all(x == (fri - dt.timedelta(days=10) - dt.date(2020, 1, 7)).days / 7 for fri, _, x, _, _ in rows), rows[:3])
    fake_missing = run_weekly(dict(wspec("hold-v1"), holdout={"years": [2007, 2008, 2009]}), Fake(weekly_data(2.0, 1)), reg, today)
    ck("holdout years not on hand: WAIT, naming them", fake_missing["status"] == "wait" and "2007-2009" in fake_missing["why"], fake_missing)

    print("state yield on synthetic data")

    class FakeY(Inputs):
        def __init__(self, beta, seed):
            super().__init__(root="/nonexistent")
            rng = random.Random(seed)
            self.x, self.y = {}, {}
            for st in ["S%02d" % i for i in range(18)]:
                for yr in range(2010, 2026):
                    xv = 60 + rng.gauss(0, 10)
                    self.x[(st, yr)] = xv
                    self.y[(st, yr)] = 150 + 2 * (yr - 2010) + beta * (xv - 60) + rng.gauss(0, 3)

        def nass_week(self, kind, week):
            return self.x

        def corn_yield(self):
            return self.y
    ys = {"id": "y-v1", "registered": "2026-10-27", "family": "f", "title": "t", "kind": "state_yield",
          "x": {"series": "corn_ge", "week": 33}, "y": {"series": "corn_yield_final"}, "grain": "state-year",
          "expected_sign": 1, "holdout": {"years": list(range(2017, 2026))}, "min_fit_years": 4, "min_holdout_n": 100,
          "benchmark": "trend", "placebo": "shuffle", "bootstrap": "year", "else_explains": [], "sig_yes": None}
    yr = run_state_yield(ys, FakeY(1.0, 3), reg, today)
    ck("ratings that carry yield beat the trend, p at floor", yr["status"] == "scored" and yr["holdout"]["pass"]
       and yr["placebo"]["p"] < 0.001 and yr["n"] == 9 * 18, (yr.get("n"), yr.get("placebo")))
    with fewer_shuffles():
        nps = [run_state_yield(ys, FakeY(0.0, 1000 + sd), reg, today) for sd in range(30)]
    rate = sum(1 for c in nps if c["placebo"]["p"] <= 0.05) / len(nps)
    ck("ratings that carry nothing: placebo p under 0.05 in about 5%% of 30 null worlds (%.0f%%)" % (100 * rate), rate <= 0.15)
    ck("... and the holdout test passes in few of them", sum(1 for c in nps if c["holdout"]["pass"]) <= 4)

    print("rival contagion on a synthetic network")

    class FakeC(Inputs):
        def __init__(self, follow, seed, days):
            super().__init__(root="/nonexistent")
            rng = random.Random(seed)
            self.el = []
            for i in range(160):
                stt = "AA" if i < 80 else "BB"
                self.el.append({"id": "e%03d" % i, "st": stt, "company": "Firm%d Grain" % i,
                                "lat": 40 + (i % 80) // 10 * 0.25 + rng.random() * 0.05,
                                "lng": -95 - (i % 10) * 0.25 - (1.5 if stt == "BB" else 0) - rng.random() * 0.05})
            self.days = days
            self.mv = {dd: {} for dd in days}
            near_of = {}
            for a in self.el:
                near_of[a["id"]] = [b["id"] for b in self.el if b is not a and b["st"] == a["st"]
                                    and miles(a["lat"], a["lng"], b["lat"], b["lng"]) <= 25]
            for t, dd in enumerate(days):
                for e in self.el:
                    if rng.random() < 0.12:
                        self.mv[dd][e["id"]] = rng.choice((1, -1))
                if follow and t >= 1:
                    for e, v in list(self.mv[days[t - 1]].items()):
                        for r in near_of[e]:
                            if r not in self.mv[dd] and rng.random() < follow:
                                self.mv[dd][r] = v

        def elevators(self):
            return self.el

        def corn_moves(self, source, since, until):
            if source == "bid_ledger_corn":
                raise Missing("private/ledger/bid-changes")
            return {k: v for k, v in self.mv.items() if since <= k <= until}

    wk = []
    dd0 = dt.date(2026, 9, 1)
    while dd0 <= dt.date(2026, 12, 20):
        if dd0.weekday() < 5:
            wk.append(dd0)
        dd0 += dt.timedelta(days=1)
    cs = {"id": "c-v1", "registered": "2026-10-27", "family": "f", "title": "t", "kind": "contagion", "x": "x", "y": "y",
          "grain": "elevator-day", "source": "basis_log_corn", "near_mi": 25,
          "control": {"min_mi": 25, "max_mi": 100, "same_state": True}, "drop_shared_first_word": True, "lag_days": [1, 3],
          "expected_sign": 1, "fit": {"from": "2026-09-01", "to": "2026-10-09"},
          "holdout": {"windows": [{"season": "s1", "from": "2026-10-12", "to": "2026-11-30"}]}, "min_events": 100,
          "benchmark": "control", "placebo": "shuffle", "bootstrap": "day", "else_explains": [], "sig_yes": None}
    later = dt.date(2026, 12, 10)
    CHECK_PAIRS.append("on")
    cr = run_contagion(cs, FakeC(0.25, 5, wk), reg, later)
    ck("the matrix pair counts equal a pair-by-pair count", CHECK_PAIRS[-1] is True, CHECK_PAIRS)
    CHECK_PAIRS.clear()
    ck("planted contagion is found: net above zero, range above zero, p small", cr["status"] == "scored"
       and cr["estimate"] > 0 and cr["holdout"]["pass"] and cr["placebo"]["p"] < 0.01, (cr.get("estimate"), cr.get("range"), cr.get("placebo")))
    ck("... one season is not two", not cr["seasons"]["pass"] and cr["seasons"]["closed"] == 1, cr.get("seasons"))
    cn = run_contagion(cs, FakeC(0.0, 6, wk), reg, later)
    ck("no contagion: placebo p above 0.05", cn["status"] == "scored" and cn["placebo"]["p"] > 0.05, (cn.get("estimate"), cn.get("placebo")))
    co = run_contagion(cs, FakeC(0.25, 5, wk), reg, dt.date(2026, 11, 20))
    ck("holdout window still open: WAIT, and no estimate is computed (no peeking)", co["status"] == "wait"
       and "still open" in co["why"] and "estimate" not in co, co)
    ck("the shared first word rule drops same-owner-looking pairs", norm_company("Heartland Co-op, Inc.")[0] == norm_company("HEARTLAND CO OP")[0])

    print("the gate")
    good = {"status": "scored", "n": 300, "estimate": 2.0, "range": [1.0, 3.0], "unit": "u", "sign": 1, "sign_ok": True,
            "holdout": {"pass": True}, "placebo": {"p": 0.0002, "shuffles": 5000},
            "seasons": {"pass": True, "good": 3, "closed": 3}}
    sA = dict(wspec("ga-v1"), family="f")
    sB = dict(wspec("gb-v1"), family="f")
    regG = dict(reg, specs=[sA, sB])
    M = ledger_size(regG)
    ck("M = prior tests plus every registered spec", M == 152, M)
    rws = gate(regG, {"ga-v1": good, "gb-v1": dict(good, placebo={"p": 0.03, "shuffles": 1000})}, {}, today, M)
    ck("all five conditions: HOLDS; first time is never eligible", rws[0]["verdict"] == "HOLDS" and not rws[0]["eligible"], rws[0])
    ck("placebo 0.03: holdout and placebo pass, ledger line fails: PARTLY", rws[1]["verdict"] == "PARTLY"
       and "ledger_wide" in rws[1]["why"], rws[1])
    prev = {"ga-v1": [dict(rws[0], date="2026-10-20")]}
    rws2 = gate(regG, {"ga-v1": good, "gb-v1": good}, prev, today, M)
    ck("HOLDS again with the same sign: eligible for Sig's review", rws2[0]["eligible"] and rws2[0]["sign_stable"], rws2[0])
    rws3 = gate(regG, {"ga-v1": dict(good, sign=-1, estimate=-2.0), "gb-v1": good}, prev, today, M)
    ck("sign flipped since the last re-test: not eligible", not rws3[0]["eligible"], rws3[0])
    sAy = dict(sA, sig_yes="2026-11-02")
    rws4 = gate(dict(regG, specs=[sAy, sB]), {"ga-v1": good, "gb-v1": good}, prev, today, M)
    ck("Sig's yes is not part of the hash, and a spec he said yes to is no longer listed for review",
       spec_hash(sAy) == spec_hash(sA) and rws4[0]["verdict"] == "HOLDS" and not rws4[0]["eligible"], rws4[0])
    one = gate(regG, {"ga-v1": dict(good, seasons={"pass": False, "good": 1, "closed": 1}), "gb-v1": good}, {}, today, M)
    ck("one season: PARTLY, never HOLDS", one[0]["verdict"] == "PARTLY" and "two_seasons" in one[0]["why"], one[0])
    bad = gate(regG, {"ga-v1": dict(good, holdout={"pass": False}), "gb-v1": good}, {}, today, M)
    ck("holdout fails: NO", bad[0]["verdict"] == "NO", bad[0])
    hf = gate(regG, {"ga-v1": dict(good, placebo={"p": 0.03, "shuffles": 1000}), "gb-v1": dict(good, placebo={"p": 0.04, "shuffles": 1000})}, {}, today, M)
    ck("Holm in the family: 0.03 and 0.04 both adjust to 0.06", hf[0]["holm_family"] == 0.06 and not hf[0]["conditions"]["family_holm"], hf[0])
    moved = dict(sA, title="changed after the fact")
    ch = gate(dict(regG, specs=[moved, sB]), {"ga-v1": good, "gb-v1": good}, prev, today, M)
    ck("a spec edited after its first result: ERROR, not scored", ch[0]["verdict"] == "ERROR" and "register a new id" in ch[0]["why"], ch[0])
    wt = gate(regG, {"ga-v1": wait("input missing: x"), "gb-v1": good}, {}, today, M)
    ck("a missing input: WAIT with its reason", wt[0]["verdict"] == "WAIT" and "input missing" in wt[0]["why"], wt[0])

    print("the run on disk")
    tmp = tempfile.mkdtemp(prefix="insight-")
    try:
        regf = os.path.join(tmp, "reg.json")
        r = dict(reg, series={"barge3": {"release_lag_days": 2}}, families={"contagion": "c"},
                 specs=[dict(cs, id="contagion-ledger-v1", family="contagion", source="bid_ledger_corn",
                             fit={"from": "2026-09-03", "to": "2026-10-26"},
                             holdout={"windows": [{"season": "fall 2026", "from": "2026-10-27", "to": "2026-11-30"}]})])
        with open(regf, "w") as f:
            json.dump(r, f)
        os.makedirs(os.path.join(tmp, "data/ids"))
        with open(os.path.join(tmp, "data/ids/elevators.json"), "w") as f:
            json.dump({"elevators": []}, f)
        led = os.path.join(tmp, "ledger")
        ns = argparse.Namespace(registry=regf, today="2026-11-01", ledger=led, root=tmp, raw=tmp,
                                bid_ledger=os.path.join(tmp, "none"), only=None, dry_run=False, summary=None)
        ck("due with no run yet", is_due(led, d("2026-11-01"))[0])
        rc = run(ns)
        rowsd = read_results(led)
        ck("the change-time ledger absent: the run goes on, that spec WAITs", rc == 0 and rowsd[0]["verdict"] == "WAIT"
           and "change-time ledger" in rowsd[0]["why"], rowsd)
        latest = json.load(open(os.path.join(led, "latest.json")))
        ck("latest.json: counts and ids only", set(latest) == {"schema", "date", "engine", "tests", "counts", "eligible", "changes", "ledger_M", "note"}
           and latest["counts"]["WAIT"] == 1, latest)
        before = open(result_path(led, d("2026-11-01"))).read()
        ck("a second run the same day refuses and leaves the day's file as it was", run(ns) == 2
           and open(result_path(led, d("2026-11-01"))).read() == before)
        ck("not due again until Sunday; a missed Sunday catches up 9 days on", not is_due(led, d("2026-11-03"))[0]
           and is_due(led, d("2026-11-08"))[0] and is_due(led, d("2026-11-10"))[0] and not is_due(led, d("2026-11-07"))[0])
        led2 = os.path.join(tmp, "ledger2")
        os.makedirs(os.path.join(led2, "results", "2026"))
        open(result_path(led2, "2026-11-04"), "w").close()
        ck("a first run midweek still runs again that Sunday", is_due(led2, d("2026-11-08"))[0]
           and not is_due(led2, d("2026-11-06"))[0])
        written = sorted(os.path.relpath(os.path.join(dp, fn), tmp) for dp, _, fns in os.walk(tmp) for fn in fns)
        ck("writes only inside the ledger folder", sorted(set(written) - {"reg.json", "data/ids/elevators.json", "ledger2/results/2026/2026-11-04.jsonl"}) == ["ledger/latest.json", "ledger/results/2026/2026-11-01.jsonl"], written)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print("the real registry")
    real_reg = load_registry()
    ck("the registry checks clean", check_registry(real_reg) == [])
    ck("no spec carries Sig's yes yet", all(s["sig_yes"] is None for s in real_reg["specs"]))
    print("\ninsight_engine selftest: %d failure(s)" % len(fails))
    return 1 if fails else 0


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--selftest":
        sys.exit(selftest())
    ap = argparse.ArgumentParser(description="weekly re-test engine")
    sub = ap.add_subparsers(dest="cmd", required=True)
    pr = sub.add_parser("run")
    pr.add_argument("--registry", default=REGISTRY)
    pr.add_argument("--root", default=ROOT)
    pr.add_argument("--raw", default=None)
    pr.add_argument("--ledger", default=os.path.join(ROOT, LEDGER_DIR))
    pr.add_argument("--bid-ledger", default=None)
    pr.add_argument("--today")
    pr.add_argument("--only", nargs="*")
    pr.add_argument("--dry-run", action="store_true")
    pr.add_argument("--summary")
    pd_ = sub.add_parser("due")
    pd_.add_argument("--ledger", default=os.path.join(ROOT, LEDGER_DIR))
    pd_.add_argument("--today")
    pc = sub.add_parser("check-registry")
    pc.add_argument("--registry", default=REGISTRY)
    a = ap.parse_args()
    if a.cmd == "run":
        sys.exit(run(a))
    if a.cmd == "due":
        ok, why = is_due(a.ledger, d(a.today) if a.today else ct_today())
        print("insight: %s (%s)" % ("due" if ok else "not due", why))
        sys.exit(0 if ok else 3)
    if a.cmd == "check-registry":
        with open(a.registry, encoding="utf-8") as f:
            probs = check_registry(json.load(f))
        for p in probs:
            print("registry: " + p)
        print("registry: %d problem(s)" % len(probs))
        sys.exit(1 if probs else 0)


if __name__ == "__main__":
    main()
